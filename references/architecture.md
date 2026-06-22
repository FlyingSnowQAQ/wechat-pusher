# 系统架构说明

## 主流程

```
main()
│
├─ [Phase 1] 推送日检测
│   ├─ new Date().getDay() → 0=周日(休息) / 1=周一(龙虎斗) / ...
│   └─ FORCE_COLUMN 环境变量可覆盖（用于调试/手动推送）
│
├─ [Phase 2] 新闻抓取 fetchAllNews()
│   ├─ HTTP 源（并行抓取，毫秒级）
│   │   ├─ C114 运营商 (news/16.html)
│   │   ├─ C114 华为 (news/126.html)
│   │   ├─ C114 首页 (/)
│   │   ├─ C114 FTTH (/ftth/)
│   │   ├─ C114 国内 (news/22.html)
│   │   ├─ C114 新闻主站 (news/)
│   │   ├─ C114 访谈 (interview/)
│   │   └─ 东方财富通信板块
│   └─ 动态源（Playwright，秒级）
│       ├─ 华为官网
│       ├─ 中兴官网
│       └─ 烽火官网
│
├─ [Phase 3] AI 文章生成
│   ├─ 构建 system prompt（栏目专用）
│   ├─ 构建 user prompt（新闻素材 + 去重关键词）
│   └─ callDeepSeek() → articleRaw
│
├─ [Phase 4] 标题工厂
│   ├─ sanitizeTitle(articleRaw) → 原始标题
│   └─ generateTitleCandidates() → 3个候选标题
│
├─ [Phase 5] 配图匹配
│   ├─ matchNewsBlocks()：四层策略
│   └─ 烽向标特殊处理：原文配图（C114/动态源详情页）
│
├─ [Phase 6] 封面配图
│   ├─ Pexels API（首选，自动分页）
│   ├─ Picsum 动态种子（降级）
│   └─ SVG 品牌模板（兜底）
│
├─ [Phase 7] 质量检查
│   ├─ 标题：emoji/特殊字符检查
│   ├─ 正文：HTML标签/markdown标记检查
│   ├─ 封面：素材就绪检查
│   └─ 配图：数量检查
│
├─ [Phase 8] 微信推送
│   ├─ getWxToken() → access_token
│   ├─ uploadNewsImage() → 配图上传
│   ├─ uploadThumb() → 封面上传
│   └─ addDraft() → 草稿创建
│
└─ [Phase 9] 状态保存
    ├─ 更新 push_count
    ├─ 记录 recent_titles
    ├─ 记录 recent_news_keys
    └─ 更新 pexels_page
```

## 数据流

```
新闻源 → fetchAllNews() → topArticles[50] (去重)
                                    │
                                    ▼
                           AI 生成文章 (articleBody)
                                    │
                                    ▼
                        cleanBodyText(markdown剥离)
                                    │
                                    ▼
                        buildBriefHtml() / buildArticleHtml()
                                    │
                                    ▼
                             微信草稿 HTML
```

## 配图匹配数据流

```
articleBody (含 📎 行)
      │
      ▼
按 📎 / --- 分割为 blocks
      │
      ▼
blocks.slice(1) 跳过标题块
      │
      ▼
matchNewsBlocks(newsBlocks, newsArticles)
      │
      ├─ title_exact: 块文本包含完整标题 → 100%命中
      ├─ url_exact: URL归一化精确匹配
      ├─ title_substr: 5+字中文段子串匹配
      └─ keyword: 加权关键词（最佳分≥8, >次高×1.8）
      │
      ▼
newsImages[] → buildBriefHtml() → 新闻卡片配图
```

## 模块依赖图

```
push.js (主入口, ~2800行)
  ├── dynamic-scraper.js (Playwright 动态抓取)
  ├── node_modules/
  │   ├── node-fetch (HTTP请求)
  │   ├── sharp (图片处理)
  │   ├── dotenv (环境变量)
  │   ├── iconv-lite (GBK编码)
  │   └── abort-controller (超时控制)
  └── data files
      ├── .env (API凭据)
      ├── state.json (推送状态)
      └── article_images/ (临时配图缓存)
```

## 关键设计决策

| 决策点 | 选择 | 原因 |
|--------|------|------|
| 浏览器引擎 | Playwright + Edge | Puppeteer Chromium 下载超时，系统Edge即时可用 |
| 链接提取 | href正则匹配 | 不依赖CSS选择器，网站改版不影响 |
| 等待策略 | domcontentloaded + 3s | networkidle在部分站点超时 |
| 抓取模式 | 串行 | 避免Windows服务器内存压力 |
| 配图匹配 | 📎锚点分割 | AI输出格式变化时也能正确匹配 |
| 去重机制 | 标题关键词 | 避免一次推送出现重复选题 |
| markdown处理 | 全面剥离+formatWithBold兜底 | 用户硬性要求 |
