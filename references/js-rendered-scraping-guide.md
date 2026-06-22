# JavaScript 渲染页面抓取技术方案

> 适用场景：华为/中兴/烽火/运营商官网等 JS 动态渲染页面新闻抓取
> 环境约束：Node.js 22.x，Windows 服务器，需集成到 wechat-pusher 自动化推送系统

---

## 一、问题本质：为什么 HTTP 抓不到内容

现代企业官网（华为、中兴、烽火、三大运营商）普遍采用 SPA 架构（Vue/React/Angular），页面加载流程：

```
浏览器请求 HTML → 收到空壳 HTML（仅 <div id="app"></div> + <script>）
  → 浏览器执行 JS → JS 发起 AJAX 请求获取数据 → JS 渲染 DOM → 用户看到内容
```

传统 HTTP 客户端（node-fetch / axios）只完成第一步，拿到的是空壳，看不到任何新闻内容。

### 判断方法

```javascript
// 方法1：对比 view-source 和 DevTools
// 如果 Ctrl+U 看到的 HTML 很少，但 F12 Elements 面板内容丰富 → JS 渲染页面

// 方法2：检查 HTML 中是否有框架特征
const isSPA = html.includes('__NUXT__')  // Nuxt.js (Vue SSR/SPA)
  || html.includes('__NEXT_DATA__')       // Next.js (React SSR/SPA)
  || html.includes('ng-version')          // Angular
  || html.includes('window.__INITIAL_STATE__')  // Vue/Pinia
  || /<div id="app"><\/div>/.test(html);  // 通用 SPA 挂载点

// 方法3：检查是否有 API 端点线索
const hasApiHint = html.includes('/api/') || html.includes('/content/')
  || html.includes('fetch(') || html.includes('axios');
```

---

## 二、五层抓取策略（由简到复杂）

### 策略层级总览

| 层级 | 方法 | 速度 | 资源消耗 | 适用场景 | 成功率 |
|------|------|------|---------|---------|--------|
| L1 | 直接 HTTP 请求 | 毫秒级 | 极低 | 服务端渲染页面（C114） | 高 |
| L2 | 分析并直接调用 API | 毫秒级 | 低 | API 端点可逆向的 SPA | 高 |
| L3 | Headless 浏览器渲染 | 秒级 | 中 | JS 渲染页面（通用） | 高 |
| L4 | Stealth 浏览器 + 反检测 | 秒级 | 中高 | 有基础反爬的网站 | 中高 |
| L5 | 代理池 + 指纹轮换 | 秒级 | 高 | 有高级反爬（Cloudflare等） | 中 |

**原则：从 L1 开始尝试，失败则升级，不盲目使用最复杂方案。**

### L1：直接 HTTP 请求（已有方案）

当前 C114 抓取使用的方式。适用于服务端渲染页面。

```javascript
const res = await fetch(url, { headers: NEWS_HEADERS });
const html = await res.text(); // 或 iconv.decode(buffer, 'gbk')
// 用正则/cheerio 解析 HTML
```

### L2：API 端点逆向（推荐优先尝试）

很多 SPA 虽然页面是 JS 渲染的，但数据来自后端 API。如果能找到 API 端点，直接调用比浏览器渲染快 100 倍。

**发现 API 的方法：**

```
1. 打开目标页面 → F12 → Network 面板 → XHR/Fetch 过滤
2. 刷新页面，观察网络请求
3. 找到返回 JSON 数据的请求
4. 复制该请求的 URL、Headers、Body
5. 在代码中用 fetch 直接调用
```

**代码实现：**

```javascript
// 示例：某 SPA 新闻列表 API
async function fetchViaAPI() {
  const res = await fetch('https://www.example.com/api/news/list?page=1&size=20', {
    headers: {
      'User-Agent': 'Mozilla/5.0 ...',
      'Referer': 'https://www.example.com/news',
      'Accept': 'application/json',
      // 有些 API 需要 token，从页面 HTML 或 cookie 中提取
      'Authorization': 'Bearer ...',
    }
  });
  const data = await res.json();
  // data.data.list 就是新闻列表
  return data.data.list.map(item => ({
    title: item.title,
    link: item.url,
    coverImage: item.cover,
    source: '某官网',
  }));
}
```

**优点：** 速度极快（毫秒级），资源消耗极低，可高并发
**缺点：** 需要人工分析 API 结构，API 可能变更，可能有鉴权

### L3：Headless 浏览器渲染（核心方案）

使用 Puppeteer 或 Playwright 启动无头浏览器，执行 JS 渲染后提取 DOM 内容。

**安装：**

```bash
# 在 managed workspace 安装
cd C:\Users\Administrator\.workbuddy\binaries\node\workspace
C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2\node.exe npm install puppeteer
# puppeteer 会自动下载 Chromium 浏览器
```

**基础用法：**

```javascript
const puppeteer = require('puppeteer');

async function scrapeWithBrowser(url, waitSelector) {
  const browser = await puppeteer.launch({
    headless: 'new',  // 新版无头模式，更接近真实浏览器
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();

  // 设置真实 User-Agent
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ...');

  // 拦截并阻止不必要的资源（图片/字体/CSS），提升速度
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const type = req.resourceType();
    if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
      req.abort();
    } else {
      req.continue();
    }
  });

  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

  // 等待目标内容出现
  if (waitSelector) {
    await page.waitForSelector(waitSelector, { timeout: 15000 });
  }

  // 在浏览器上下文中执行 JS 提取数据
  const data = await page.evaluate(() => {
    const items = document.querySelectorAll('.news-item');
    return Array.from(items).map(item => ({
      title: item.querySelector('.title')?.textContent?.trim(),
      link: item.querySelector('a')?.href,
      date: item.querySelector('.date')?.textContent?.trim(),
    }));
  });

  await browser.close();
  return data;
}
```

### L4：Stealth 模式 + 反检测

基础 Puppeteer 会被 `navigator.webdriver`、WebGL 指纹、Canvas 指纹等特征暴露。使用 `puppeteer-extra-plugin-stealth` 规避。

**安装：**

```bash
cd C:\Users\Administrator\.workbuddy\binaries\node\workspace
C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2\node.exe npm install puppeteer-extra puppeteer-extra-plugin-stealth
```

**使用：**

```javascript
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const browser = await puppeteer.launch({
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',  // 隐藏自动化特征
  ],
});
```

**Stealth 插件规避的检测项：**

| 检测项 | 原始值 | 规避后 |
|--------|--------|--------|
| navigator.webdriver | true | undefined |
| navigator.plugins | 空 | 模拟真实插件 |
| navigator.languages | undefined | ['zh-CN', 'zh', 'en'] |
| WebGL Vendor | "Google Inc." | 模拟真实 GPU |
| Chrome.runtime | undefined | 模拟真实 Chrome |
| Canvas 指纹 | 服务器特征 | 添加噪声 |
| window.outerWidth/Height | 0 | 真实值 |
| iframe.contentWindow | 泄露原始 window | 代理重定向 |

### L5：代理池 + 指纹轮换（重型方案）

针对 Cloudflare、Akamai 等高级反爬系统。本项目暂不需要，仅作知识储备。

**核心要素：**
- 住宅 IP 代理轮换（每个请求不同 IP）
- TLS 指纹对齐（JA3/JA4 匹配真实浏览器）
- HTTP/2 帧指纹匹配
- 浏览器指纹随机化（Canvas/WebGL 噪声）

---

## 三、AJAX/API 请求拦截技术

这是 L3/L4 方案中最有价值的技巧：不解析渲染后的 DOM，而是直接拦截浏览器发出的 AJAX 请求，获取原始 JSON 数据。

### 原理

```
浏览器加载页面 → JS 执行 → 发起 XHR/Fetch 请求获取数据
                                    ↓
                           page.on('response') 拦截
                                    ↓
                           response.json() 提取数据
```

### 完整实现

```javascript
async function scrapeViaAjaxInterception(url) {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();

  const apiResponses = [];

  // 监听所有网络响应
  page.on('response', async (response) => {
    const reqUrl = response.url();
    const contentType = response.headers()['content-type'] || '';

    // 只关心 JSON 类型的 XHR 响应
    if (contentType.includes('application/json') && response.ok()) {
      try {
        const json = await response.json();
        apiResponses.push({ url: reqUrl, data: json });
      } catch (e) {
        // 不是有效 JSON，跳过
      }
    }
  });

  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

  // 等待所有 AJAX 请求完成
  await page.waitForTimeout(3000);

  await browser.close();

  // 从所有 API 响应中找到包含新闻数据的那个
  for (const resp of apiResponses) {
    const data = resp.data;
    // 检查 JSON 结构是否像新闻列表
    if (containsNewsData(data)) {
      return extractNewsFromJson(data, resp.url);
    }
  }

  return [];
}

function containsNewsData(json) {
  // 启发式判断：JSON 中有数组，数组项有 title 字段
  const check = (obj) => {
    if (!obj || typeof obj !== 'object') return false;
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (Array.isArray(val) && val.length > 0 && val[0]?.title) return true;
      if (typeof val === 'object' && check(val)) return true;
    }
    return false;
  };
  return check(json);
}
```

### 优势对比

| 方法 | 数据质量 | 速度 | 可靠性 |
|------|---------|------|--------|
| DOM 解析 | 依赖 CSS 选择器，易变 | 慢（需完整渲染） | 中（改版就挂） |
| AJAX 拦截 | 原始 JSON，结构化 | 快（跳过渲染） | 高（API 不轻易改） |

---

## 四、等待策略（关键）

JS 渲染页面的内容是异步加载的，必须等待内容出现后才能提取。

### 等待策略选择

```javascript
// 策略1：等待特定选择器出现（最可靠）
await page.waitForSelector('.news-list .news-item', { timeout: 15000 });

// 策略2：等待网络空闲（适用于 AJAX 加载完后不再有请求的场景）
await page.goto(url, { waitUntil: 'networkidle2' }); // 500ms 内不超过2个连接

// 策略3：等待特定函数返回 true（灵活但需了解页面逻辑）
await page.waitForFunction(
  () => document.querySelectorAll('.news-item').length >= 5,
  { timeout: 15000 }
);

// 策略4：固定延时（最简单但最不可靠，仅作兜底）
await page.waitForTimeout(5000);

// 策略5：等待特定 XHR 请求完成（配合 AJAX 拦截）
await page.waitForResponse(
  response => response.url().includes('/api/news/list') && response.status() === 200,
  { timeout: 15000 }
);
```

### 推荐组合策略

```javascript
// 1. 先用 networkidle2 等网络稳定
await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

// 2. 再等关键选择器出现（双重保障）
try {
  await page.waitForSelector('.news-item, .article-list li, .list-item', { timeout: 10000 });
} catch {
  // 选择器没出现，可能页面结构不同，降级到固定延时
  await page.waitForTimeout(3000);
}
```

---

## 五、反爬虫对抗技术详解

### 5.1 被检测的途径

```
┌─────────────────────────────────────────────────┐
│              反爬检测层级                          │
├──────────┬──────────┬──────────┬────────────────┤
│ 网络层   │ 浏览器层 │ 行为层    │ 内容层          │
├──────────┼──────────┼──────────┼────────────────┤
│ TLS指纹  │ webdriver│ 鼠标轨迹 │ 请求频率        │
│ HTTP/2帧 │ plugins  │ 点击间隔 │ User-Agent一致性│
│ IP信誉   │ WebGL    │ 滚动模式 │ Referer 链      │
│ DNS特征  │ Canvas   │ 表单填写 │ Cookie 连续性   │
└──────────┴──────────┴──────────┴────────────────┘
```

### 5.2 各层应对策略

#### 网络层

```javascript
// 问题：node-fetch/axios 的 TLS 指纹与浏览器不同
// 解决：使用 Puppeteer 自带的浏览器网络栈（天然匹配）

// 如果必须用 HTTP 客户端，可使用带 TLS 指纹伪装的库：
// - curl-impersonate (C 库，Node 可通过 child_process 调用)
// - got-scraping (Node.js，内置 TLS 指纹伪装)
```

#### 浏览器层

```javascript
// 使用 stealth 插件自动处理
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

// 额外手动设置
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080 }); // 真实分辨率
await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

// 额外注入反检测脚本
await page.evaluateOnNewDocument(() => {
  // 覆盖 permissions API
  const originalQuery = window.navigator.permissions.query;
  window.navigator.permissions.query = (parameters) =>
    parameters.name === 'notifications'
      ? Promise.resolve({ state: Notification.permission })
      : originalQuery(parameters);

  // 覆盖 plugins
  Object.defineProperty(navigator, 'plugins', {
    get: () => [1, 2, 3, 4, 5],
  });

  // 覆盖 languages
  Object.defineProperty(navigator, 'languages', {
    get: () => ['zh-CN', 'zh', 'en-US', 'en'],
  });
});
```

#### 行为层

```javascript
// 模拟人类浏览行为
async function humanLikeBrowse(page) {
  // 随机鼠标移动
  await page.mouse.move(100 + Math.random() * 500, 100 + Math.random() * 300);
  await page.waitForTimeout(500 + Math.random() * 1000);

  // 随机滚动
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let scrolled = 0;
      const interval = setInterval(() => {
        window.scrollBy(0, 100 + Math.random() * 200);
        scrolled += 100;
        if (scrolled >= document.body.scrollHeight * 0.5) {
          clearInterval(interval);
          resolve();
        }
      }, 200 + Math.random() * 300);
    });
  });

  await page.waitForTimeout(1000 + Math.random() * 2000);
}
```

#### 频率控制

```javascript
// 请求间隔随机化
const delay = (min, max) => new Promise(r => setTimeout(r, min + Math.random() * (max - min)));

// 每个请求之间随机等待 2-5 秒
await delay(2000, 5000);

// 每日请求总量限制
const MAX_DAILY_REQUESTS = 100;
```

### 5.3 各网站反爬强度评估

| 网站 | 反爬强度 | 主要手段 | 推荐策略 |
|------|---------|---------|---------|
| C114 通信网 | 低 | 无 | L1 直接 HTTP |
| 东方财富 | 低 | 无 | L1 直接 HTTP |
| 华为官网 | 中 | JS 渲染 | L3 浏览器渲染 |
| 中兴官网 | 中 | JS 渲染 | L3 浏览器渲染 |
| 烽火官网 | 中 | JS 渲染 | L3 浏览器渲染 |
| 中国移动 | 中高 | JS + 验证 | L4 Stealth |
| 中国电信 | 中高 | JS + 验证 | L4 Stealth |
| 中国联通 | 中高 | JS + 验证 | L4 Stealth |

---

## 六、性能优化策略

### 6.1 浏览器实例复用

```javascript
// 错误：每抓一个页面启动一个浏览器
for (const url of urls) {
  const browser = await puppeteer.launch(); // 慢！
  // ...
  await browser.close();
}

// 正确：一个浏览器，多个页面
const browser = await puppeteer.launch();
for (const url of urls) {
  const page = await browser.newPage();
  await page.goto(url);
  // ...
  await page.close();
}
await browser.close();
```

### 6.2 资源拦截

```javascript
// 阻止图片/CSS/字体加载，只保留 JS 和 XHR
await page.setRequestInterception(true);
page.on('request', (req) => {
  const type = req.resourceType();
  if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
    req.abort();
  } else {
    req.continue();
  }
});
// 效果：页面加载时间减少 60-80%
```

### 6.3 并发控制

```javascript
// 同时打开多个页面，但限制并发数
const MAX_CONCURRENT = 3;

async function scrapeMultiple(urls) {
  const browser = await puppeteer.launch();
  const results = [];

  for (let i = 0; i < urls.length; i += MAX_CONCURRENT) {
    const batch = urls.slice(i, i + MAX_CONCURRENT);
    const batchResults = await Promise.all(
      batch.map(async (url) => {
        const page = await browser.newPage();
        try {
          const data = await scrapePage(page, url);
          return data;
        } finally {
          await page.close();
        }
      })
    );
    results.push(...batchResults);
  }

  await browser.close();
  return results;
}
```

### 6.4 超时与重试

```javascript
async function scrapeWithRetry(url, maxRetries = 2) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const browser = await puppeteer.launch({ headless: 'new' });
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
      const data = await page.evaluate(extractData);
      await browser.close();
      return data;
    } catch (err) {
      console.warn(`  尝试 ${attempt + 1}/${maxRetries + 1} 失败: ${err.message}`);
      if (attempt === maxRetries) return []; // 最终失败返回空数组
      await new Promise(r => setTimeout(r, 3000 * (attempt + 1))); // 指数退避
    }
  }
}
```

---

## 七、多站点适配架构

### 7.1 站点配置化

```javascript
// 每个站点一个配置对象，描述如何抓取
const SITE_CONFIGS = {
  huawei: {
    name: '华为官网',
    url: 'https://www.huawei.com/cn/news',
    strategy: 'browser',  // L3
    waitSelector: '.news-list .news-item',
    extract: () => {
      return Array.from(document.querySelectorAll('.news-item')).map(item => ({
        title: item.querySelector('.title')?.textContent?.trim(),
        link: item.querySelector('a')?.href,
        coverImage: item.querySelector('img')?.src,
        source: '华为官网',
      }));
    },
    timeout: 20000,
  },
  zte: {
    name: '中兴官网',
    url: 'https://www.zte.com.cn/china/news',
    strategy: 'browser',
    waitSelector: '.news-list li',
    extract: () => { /* ... */ },
  },
  fiberhome: {
    name: '烽火官网',
    url: 'https://www.fiberhome.com/cn/news',
    strategy: 'browser',
    waitSelector: '.news-item',
    extract: () => { /* ... */ },
  },
  // ... 更多站点
};
```

### 7.2 通用抓取引擎

```javascript
async function scrapeSite(config) {
  const browser = await getBrowser(); // 复用浏览器实例
  const page = await browser.newPage();

  try {
    // 设置资源拦截
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (['image', 'stylesheet', 'font'].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.goto(config.url, { waitUntil: 'networkidle2', timeout: config.timeout || 20000 });

    if (config.waitSelector) {
      await page.waitForSelector(config.waitSelector, { timeout: 10000 });
    } else {
      await page.waitForTimeout(3000);
    }

    // 执行站点特定的提取逻辑
    const data = await page.evaluate(config.extract);
    return data;
  } catch (err) {
    console.warn(`  ⚠️  ${config.name} 抓取失败: ${err.message}`);
    return [];
  } finally {
    await page.close();
  }
}
```

---

## 八、加密数据处理

### 8.1 常见加密场景

| 场景 | 特征 | 应对 |
|------|------|------|
| API 响应加密 | JSON 字段值是 Base64/Hex | 逆向 JS 解密函数 |
| 请求参数加密 | POST body 是加密字符串 | 分析 JS 加密逻辑 |
| Cookie 加密 | Cookie 值被 JS 加密 | 浏览器自动处理 |
| 字体反爬 | 数字被自定义字体替换 | OCR 或映射表 |

### 8.2 加密数据逆向流程

```
1. F12 → Sources 面板 → 搜索解密函数名
2. 在解密函数处下断点
3. 触发请求，断点命中
4. 查看输入（密文）和输出（明文）
5. 在 Node.js 中复现解密逻辑
```

### 8.3 简化方案：直接用浏览器执行解密

```javascript
// 不逆向加密算法，直接在浏览器上下文中调用页面的解密函数
const decrypted = await page.evaluate((encryptedData) => {
  // 如果页面的 JS 暴露了解密函数
  if (window.decryptData) {
    return window.decryptData(encryptedData);
  }
  // 或者找到 JS 中的解密方法
  return eval(`(${decryptFunctionSource})(${JSON.stringify(encryptedData)})`);
}, encryptedData);
```

---

## 九、完整架构图

```
┌──────────────────────────────────────────────────────────────┐
│                    新闻抓取系统架构                            │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────┐   ┌──────────┐   ┌────────────┐               │
│  │ C114 HTTP│   │东方财富HTTP│   │ 通用API调用 │                │
│  │ (L1)     │   │ (L1)     │   │ (L2)      │               │
│  └────┬─────┘   └────┬─────┘   └─────┬──────┘               │
│       │              │               │                       │
│       └──────────┬───┴───────────────┘                      │
│                  ▼                                           │
│         ┌────────────────┐                                  │
│         │  新闻合并去重池  │                                  │
│         └───────┬────────┘                                  │
│                 │                                           │
│  ┌──────────────┼──────────────┐                            │
│  │              │              │                             │
│  ▼              ▼              ▼                             │
│ ┌─────┐   ┌─────────┐   ┌──────────┐                        │
│ │华为  │   │中兴/烽火 │   │运营商官网 │                        │
│ │(L3)  │   │(L3/L4)  │   │(L4)      │                        │
│ └──┬──┘   └────┬────┘   └────┬─────┘                        │
│    │           │             │                               │
│    └───────────┴─────────────┘                               │
│                │                                             │
│                ▼                                             │
│    ┌──────────────────────┐                                 │
│    │ Puppeteer + Stealth  │                                 │
│    │ (浏览器实例池)        │                                 │
│    └──────────────────────┘                                 │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 十、注意事项

1. **合法合规**：只抓取公开可见的新闻资讯，不涉及需要登录的私有数据
2. **robots.txt**：尊重目标网站的 robots.txt 规则
3. **频率控制**：单站点每分钟不超过 5 次请求，每日不超过 100 次
4. **错误兜底**：任何站点抓取失败返回空数组，不阻断整体推送流程
5. **资源释放**：浏览器实例使用完毕必须 close()，否则内存泄漏
6. **Chromium 体积**：约 200-300MB，首次安装需要较长时间
7. **Windows 兼容**：Puppeteer 在 Windows 上需要 `--no-sandbox` 参数
8. **无头检测**：始终使用 stealth 插件，不裸跑 Puppeteer
