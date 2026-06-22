---
name: wechat-pusher
description: |
  雕龙绣虎公众号自动推送系统。
  三栏目（龙虎斗/绣花针/烽向标）轮转，AI 生成通信行业文章，
  多渠道新闻抓取（C114 + Playwright 动态抓取华为/中兴/烽火），
  原文配图匹配，Pexels 封面，微信草稿自动创建。
agent_created: true
---

# 雕龙绣虎 公众号自动推送系统

## 概览

一个完全自动化的 WeChat Official Account 推送系统，服务于公众号"雕龙绣虎"。
三栏目（龙虎斗/绣花针/烽向标）周一至周六每天推送。

### 核心功能

1. **三栏目轮转**：龙虎斗（行业深扒）、绣花针（冷知识趣闻）、烽向标（一周见闻）
2. **多渠道新闻抓取**：C114通信网（8个频道）+ 东方财富 + 华为/中兴/烽火官网（Playwright 动态渲染）
3. **AI 内容生成**：通过 DeepSeek API 根据新闻素材自动生成文章
4. **原文配图匹配**：从新闻原文 URL 精确匹配封面图，支持标题/子串/关键词多级降级
5. **封面配图系统**：Pexels API 通信主题照片（首选）+ Picsum 降级 + 品牌 SVG 兜底
6. **微信草稿推送**：自动上传配图、创建草稿到微信后台
7. **发布前质量检查**：标题/markdown/配图/封面 全链路检查
8. **动态抓取引擎**：Playwright + 系统 Edge 浏览器，突破 JS 渲染限制

## 何时使用

- 需要为公众号"雕龙绣虎"生成每日推送内容时
- 需要从华为/中兴/烽火/运营商官网抓取 JS 渲染的新闻时
- 需要对 AI 生成的文章进行 markdown 清洗和 HTML 排版时
- 需要将文章和配图自动上传到微信草稿箱时
- 需要重新部署或迁移推送系统时

## 快速开始

### 环境要求

- Node.js 22.x（managed runtime）
- Playwright（workspace 安装）：`npm install playwright`
- 系统 Edge 浏览器（Windows 自带）
- Python 3.13+（可选，用于配图处理）

### 安装

```bash
cd wechat-pusher
npm install
```

### 配置 `.env`

复制 `assets/config/.env.example` 为 `.env`，填写：

```
WX_APPID=你的公众号AppID
WX_APPSECRET=你的公众号AppSecret
DEEPSEEK_API_KEY=你的DeepSeek API Key
DEEPSEEK_BASE_URL=https://api.deepseek.com
PEXELS_API_KEY=你的Pexels API Key
```

### 运行

```bash
# 测试模式（不推送到微信）
set DRY_RUN=1
set FORCE_COLUMN=fengxiangbiao
npm install
node push.js

# 仅用动态新闻源（跳过 C114）
set DYNAMIC_ONLY=1
node push.js

# 正式推送
node push.js
```

## 文件结构

```
wechat-pusher/
├── SKILL.md                          # 本技能描述文件
├── scripts/
│   ├── push.js                       # 主推送脚本 v7（约2800行）
│   ├── dynamic-scraper.js            # Playwright 动态抓取模块
│   ├── custom_push.js                # 自定义推送变体
│   └── generate_three_articles.js    # 批量文章生成器
├── references/
│   ├── column-prompts.md             # 三栏目 AI 系统提示词
│   ├── architecture.md               # 系统架构说明
│   └── js-rendered-scraping-guide.md # JS 渲染页面抓取技术方案
├── assets/
│   ├── templates/                    # 各栏目 HTML 预览模板
│   │   ├── fengxiangbiao.html
│   │   ├── longhudou.html
│   │   └── xiuhuazhen.html
│   ├── config/                       # 配置模板
│   │   ├── .env.example
│   │   └── state.example.json
│   └── batch/                        # Windows 批处理脚本
│       ├── run.bat
│       ├── install-task.bat
│       └── uninstall-task.bat
├── package.json                      # 依赖管理
├── README.md                         # GitHub 项目说明
└── .gitignore
```

## 推送流程

### 主流程（push.js）

```
main()
├── 1. 检测推送日（dayOfWeek → 栏目映射）
│     周一/周四 → 龙虎斗 | 周二/周五 → 绣花针 | 周三/周六 → 烽向标
│     FORCE_COLUMN 环境变量可覆盖
├── 2. fetchAllNews() 多渠道新闻抓取
│   ├── HTTP 源：C114（8频道）+ 东方财富
│   ├── 动态源：华为/中兴/烽火官网（Playwright）
│   └── 详情页配图提取（无列表图时）
├── 3. AI 文章生成（callDeepSeek）
│   ├── 栏目系统提示词 + 新闻素材
│   └── 新闻去重（state.recent_news_keys）
├── 4. 标题工厂（generateTitleCandidates）
├── 5. 配图匹配（四层策略）
│   ① 标题精确匹配 → ② URL归一化匹配 → ③ 标题子串 → ④ 关键词加权
├── 6. 封面配图（Pexels → Picsum → SVG兜底）
├── 7. 发布前质量检查
├── 8. 微信上传（Token → 配图上传 → 封面上传 → 草稿创建）
└── 9. 保存状态（去重关键词/推送计数）
```

### 烽向标特殊流程

烽向标栏目使用 `buildBriefHtml()` 而非普通 `buildArticleHtml()`：

```
三段式排版：
1. 开头综述：暖蓝渐变底（与结尾一致）
2. 新闻卡片：白底 + 深海军蓝标题条 + 原文配图
3. 💬 讨论：暖蓝渐变底
```

每条新闻的 `📎 原文链接:` 和 URL 渲染为两行（含 `word-break:break-all`）。

## 配图匹配机制（v3）

四层策略，逐级降级：

| 优先级 | 策略 | 说明 | 阈值 |
|--------|------|------|------|
| 1 | 标题精确匹配 | 块文本包含完整标题 → 100%命中 | title.length &gt;= 5 |
| 2 | URL 归一化匹配 | 去尾部斜杠/统一https/兼容www | 精确或模糊(lastSeg) |
| 3 | 标题子串匹配 | 提取5+字中文段作为匹配锚 | 最长优先 |
| 4 | 关键词加权 | 全文匹配，过滤停用词 | bestScore&gt;=8, 超过次高分×1.8 |

`📎` 行支持两种格式兼容：
- `📎 原文链接: URL`（单行旧格式）
- `📎 原文链接:\nURL`（两行新格式）

## markdown 清洗规则

`cleanBodyText()` 全面剥离 AI 生成的 markdown 标记：

| 语法 | 处理方式 | 示例 |
|------|---------|------|
| `**bold**` | 剥离符号保留文字 | `**bold**` → `bold` |
| `*italic*` | 剥离符号保留文字 | `*italic*` → `italic` |
| `__text__` | 剥离符号保留文字 | `__text__` → `text` |
| `` `code` `` | 剥离符号保留文字 | `` `code` `` → `code` |
| `[text](url)` | 转换为纯文本 | `[text](url)` → `text` |
| `# heading` | 移除标题标记 | `# head` → `head` |
| `&gt; quote` | 移除引用标记 | `&gt; quote` → `quote` |
| `- list` | 移除列表标记 | `- item` → `item` |
| `---` | **保留**（结构依赖） | |

`formatWithBold()` 作为兜底，将残留的 `**`/`__` 转为 HTML strong 标签。

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `WX_APPID` | 微信公众号 AppID | 必填 |
| `WX_APPSECRET` | 微信公众号 AppSecret | 必填 |
| `DEEPSEEK_API_KEY` | DeepSeek API Key | 必填 |
| `DEEPSEEK_BASE_URL` | DeepSeek 接口地址 | `https://api.deepseek.com` |
| `ACCOUNT_NAME` | 公众号名称 | `雕龙绣虎` |
| `FORCE_COLUMN` | 强制指定栏目 | 自动（不设则按星期） |
| `DRY_RUN` | 测试模式（不推微信） | 0 |
| `DYNAMIC_ONLY` | 仅用动态新闻源 | 0 |

## 自动化设置

系统已注册 WorkBuddy 定时任务：
- 任务名：雕龙绣虎每日推送
- 排期：周一至周六 10:00
- ID：`automation-1781607733757`
- 工作目录：`learned/wechat-pusher/`

也可通过 Windows 任务计划程序注册（`install-task.bat`）。

## 数据文件

`state.json` 记录推送状态（自动维护）：
- `push_count`：总推送次数
- `last_push_date`：最近推送时间
- `recent_titles`：近期标题列表（去重用）
- `recent_news_keys`：近期新闻关键词（去重）
- `pexels_page`：Pexels 分页状态
- `used_image_urls`：已用图片去重

## 依赖

- `node-fetch` — HTTP 请求
- `sharp` — 图片处理（缩放/格式转换）
- `dotenv` — 环境变量加载
- `abort-controller` — 请求超时控制
- `iconv-lite` — GBK 编码转换
- `playwright` — 动态渲染抓取（workspace 级安装）

## 注意事项

1. **订阅号限制**：自动发布接口返回 48001，草稿需手动在微信后台发布
2. **IP 白名单**：运行环境 IP 需加入微信公众平台白名单
3. **Playwright 安装**：需在 workspace 安装，运行前设置 NODE_PATH
4. **Pexels API**：需申请 Key，配置于 `.env`
5. **去重机制**：state.recent_news_keys 最多40条，自动 FIFO
