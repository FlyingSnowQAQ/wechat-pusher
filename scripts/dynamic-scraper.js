/**
 * dynamic-scraper.js
 * JS 渲染页面动态抓取模块
 *
 * 技术栈：Playwright + 系统 Edge 浏览器
 * 用途：抓取华为/中兴/烽火等 JS 渲染官网的新闻
 *
 * 集成方式：
 *   const { scrapeDynamicSites } = require('./dynamic-scraper');
 *   const news = await scrapeDynamicSites();
 *
 * 环境要求：
 *   - Playwright 安装在 Node workspace: npm install playwright
 *   - 系统安装 Microsoft Edge 浏览器（Windows 自带）
 */

const path = require('path');

// Node workspace 的 node_modules 路径
const NODE_MODULES_PATH = path.join(
  'C:', 'Users', 'Administrator', '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules'
);

// 延迟加载 Playwright（避免未安装时整个 push.js 崩溃）
let _chromium = null;

function getChromium() {
  if (!_chromium) {
    try {
      const { chromium } = require(path.join(NODE_MODULES_PATH, 'playwright'));
      _chromium = chromium;
    } catch (err) {
      console.warn('  ⚠️  Playwright 未安装，动态抓取不可用。请在 Node workspace 安装：');
      console.warn('     npm install playwright');
      return null;
    }
  }
  return _chromium;
}

// 浏览器实例池（单例复用）
let _browserInstance = null;

async function getBrowser() {
  const chromium = getChromium();
  if (!chromium) return null;

  if (_browserInstance) {
    try {
      // 验证浏览器还活着
      const pages = await _browserInstance.pages();
      if (pages) return _browserInstance;
    } catch {
      _browserInstance = null;
    }
  }

  _browserInstance = await chromium.launch({
    headless: true,
    channel: 'msedge', // 使用系统 Edge 浏览器，无需下载 Chromium
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  return _browserInstance;
}

async function closeBrowser() {
  if (_browserInstance) {
    try { await _browserInstance.close(); } catch {}
    _browserInstance = null;
  }
}

// ─── 通用工具函数 ───

function cleanTitle(title) {
  if (!title) return '';
  return title
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^·\s*/, '')
    .replace(/^【[^】]+】\s*/, '')
    .trim();
}

// ─── 站点配置 ───
// Playwright 验证结果：
// - 华为: 12 条新闻，链接格式 /cn/news/YYYY/M/xxx
// - 中兴: 33 条新闻，链接格式 /china/about/news/YYYYMMDDCx.html，有列表页配图
// - 烽火: 104 条新闻，链接格式 /xwzx/YYYYMMDD/XXXXX.html

const SITE_CONFIGS = [
  {
    key: 'huawei',
    name: '华为官网',
    url: 'https://www.huawei.com/cn/news',
    linkPatterns: [/\/cn\/news\/\d{4}\/\d/i],
    sourceName: '华为官网',
    waitTimeout: 20000,
  },
  {
    key: 'zte',
    name: '中兴官网',
    url: 'https://www.zte.com.cn/china/about/news.html',
    linkPatterns: [/\/china\/about\/news\/\d{8}/i],
    sourceName: '中兴官网',
    waitTimeout: 20000,
  },
  {
    key: 'fiberhome',
    name: '烽火官网',
    url: 'https://www.fiberhome.com/',
    linkPatterns: [/\/xwzx\/\d{8}\/\d+\.html/i],
    sourceName: '烽火官网',
    waitTimeout: 20000,
  },
];

// ─── 核心抓取引擎 ───

/**
 * 抓取单个站点
 * 策略：通过 href 模式匹配新闻链接（Playwright 验证有效的方案）
 */
async function scrapeSite(browser, config) {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'zh-CN',
  });

  // 阻止不必要的资源
  await context.route('**/*', (route) => {
    const type = route.request().resourceType();
    if (['stylesheet', 'font', 'media'].includes(type)) {
      route.abort();
    } else {
      route.continue();
    }
  });

  const page = await context.newPage();

  try {
    console.log(`  🌐 正在抓取 ${config.name}...`);

    await page.goto(config.url, {
      waitUntil: 'domcontentloaded',
      timeout: config.waitTimeout || 20000,
    });

    // 等待 JS 渲染完成
    await page.waitForTimeout(3000);

    // 链接提取：通过 href 模式匹配新闻链接
    const patterns = config.linkPatterns.map(p => p.source);
    const sourceName = config.sourceName;

    const items = await page.evaluate(({ pats, srcName }) => {
      const regexes = pats.map(p => new RegExp(p));
      const allLinks = document.querySelectorAll('a');
      const results = [];
      const seen = new Set();
      allLinks.forEach(a => {
        const href = a.href;
        const text = a.textContent.trim();
        if (text.length < 8 || !href || href.includes('javascript') || href.includes('#')) return;
        const matched = regexes.some(r => r.test(href));
        if (!matched) return;
        if (seen.has(href)) return;
        seen.add(href);
        // 清理标题：去掉日期后缀和多余空白
        const cleanText = text
          .replace(/\d{4}[-年]\d{1,2}[-月]\d{1,2}日?/, '')
          .replace(/\s+/g, ' ')
          .trim();
        if (cleanText.length > 5) {
          // 尝试找到同层级的图片
          const parent = a.closest('li, div, article, .item') || a.parentElement;
          const img = parent?.querySelector('img');
          let imgSrc = img?.src || img?.getAttribute('data-src') || img?.getAttribute('data-original') || null;
          if (imgSrc && (imgSrc.includes('logo') || imgSrc.includes('icon') || imgSrc.includes('banner'))) {
            imgSrc = null;
          }
          results.push({
            title: cleanText,
            link: href,
            coverImage: imgSrc,
            source: srcName,
          });
        }
      });
      return results;
    }, { pats: patterns, srcName: sourceName });

    if (items && items.length > 0) {
      console.log(`  ✅ ${config.name}: 提取到 ${items.length} 条新闻`);
      await context.close();
      return items.slice(0, 15);
    }

    console.warn(`  ⚠️  ${config.name}: 未抓到新闻内容`);
    await context.close();
    return [];
  } catch (err) {
    console.warn(`  ⚠️  ${config.name} 抓取失败: ${err.message}`);
    try { await context.close(); } catch {}
    return [];
  }
}

/**
 * 批量抓取所有动态站点
 * @param {string[]} siteKeys - 要抓取的站点 key 列表，默认全部
 * @returns {Promise<Array>} 新闻数组 { title, link, coverImage, source }
 */
async function scrapeDynamicSites(siteKeys) {
  const chromium = getChromium();
  if (!chromium) {
    console.warn('  ⚠️  Playwright 不可用，跳过动态抓取');
    return [];
  }

  const configs = siteKeys
    ? SITE_CONFIGS.filter(c => siteKeys.includes(c.key))
    : SITE_CONFIGS;

  const browser = await getBrowser();
  if (!browser) return [];

  const allNews = [];

  // 串行抓取（避免同时打开太多页面导致内存压力）
  for (const config of configs) {
    const items = await scrapeSite(browser, config).catch(() => []);
    allNews.push(...items);
  }

  return allNews;
}

/**
 * 抓取单篇文章详情页中的图片
 * 用于动态站点新闻的配图提取
 */
async function fetchArticleImageDynamic(url) {
  const browser = await getBrowser();
  if (!browser) return null;

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000);

    // 提取正文中的第一张图片
    const imgUrl = await page.evaluate(() => {
      const selectors = ['article img', '.content img', '.article-content img', '.text img', 'p img', '.news-content img'];
      for (const sel of selectors) {
        const imgs = document.querySelectorAll(sel);
        for (const img of imgs) {
          const src = img.src || img.dataset.src || img.getAttribute('data-original');
          if (src && !src.includes('logo') && !src.includes('icon') && !src.includes('banner')) {
            return src;
          }
        }
      }
      return null;
    });

    await context.close();
    return imgUrl;
  } catch {
    try { await context.close(); } catch {}
    return null;
  }
}

// 导出
module.exports = {
  scrapeDynamicSites,
  fetchArticleImageDynamic,
  closeBrowser,
  getBrowser,
  SITE_CONFIGS,
};
