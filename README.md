# 雕龙绣虎 公众号自动推送系统

> 一个完全自动化的微信公众号推送系统，三栏目轮转（龙虎斗/绣花针/烽向标），AI 生成通信行业文章，多渠道新闻抓取，自动配图匹配，微信草稿一键创建。

## ✨ 特性

- **三栏目轮转**：周一/四 龙虎斗（行业深扒）、周二/五 绣花针（冷知识趣闻）、周三/六 烽向标（一周见闻）
- **AI 文章生成**：通过 DeepSeek API 根据实时新闻素材自动撰写通信行业文章
- **多渠道新闻源**：C114通信网（8个频道）+ 东方财富 + 华为/中兴/烽火官网动态抓取
- **动态抓取引擎**：Playwright + 系统 Edge 浏览器，突破 JS 渲染限制
- **智能配图匹配**：四层策略（标题精确匹配 → URL归一化 → 标题子串 → 关键词加权）
- **封面配图系统**：Pexels API 通信主题照片 → Picsum 降级 → 品牌 SVG 兜底
- **WeChat 深度集成**：自动上传配图、创建草稿，订阅号手动发布

## 📦 快速开始

### 前置条件

- Node.js 22.x
- Microsoft Edge 浏览器（Windows 自带）
- 微信公众号（订阅号/服务号均可）
- DeepSeek API Key
- Pexels API Key（可选）

### 安装

```bash
# 安装依赖
npm install

# 安装 Playwright（动态抓取引擎）
cd /path/to/node/workspace
npm install playwright
```

### 配置

复制配置模板后填写：

```bash
cp assets/config/.env.example .env
```

编辑 `.env`，填入你的 API 凭据。

### 运行

```bash
# 测试模式（不推送到微信，本地预览）
set DRY_RUN=1
set FORCE_COLUMN=fengxiangbiao
node scripts/push.js

# 仅用动态新闻源（跳过 C114）
set DYNAMIC_ONLY=1
node scripts/push.js

# 正式推送
node scripts/push.js
```

## 📐 架构

```
┌──────────────────────────────────────────────────┐
│                  推送主流程                        │
├──────────────────────────────────────────────────┤
│  main()                                           │
│   ├─ 检测推送日 → 栏目映射                        │
│   ├─ 多渠道新闻抓取                               │
│   │   ├─ HTTP源：C114(8频道) + 东方财富           │
│   │   └─ 动态源：华为/中兴/烽火(Playwright)       │
│   ├─ AI 生成文章（DeepSeek）                      │
│   ├─ 标题工厂（候选标题生成）                      │
│   ├─ 配图匹配（四层策略）                          │
│   ├─ 封面配图（Pexels → Picsum → SVG）           │
│   ├─ 发布前质量检查                               │
│   ├─ 微信上传（Token → 配图 → 封面 → 草稿）      │
│   └─ 状态保存                                     │
└──────────────────────────────────────────────────┘
```

## 🔧 配置说明

| 环境变量 | 说明 | 必填 |
|---------|------|------|
| `WX_APPID` | 微信公众号 AppID | ✅ |
| `WX_APPSECRET` | 微信公众号 AppSecret | ✅ |
| `DEEPSEEK_API_KEY` | DeepSeek API Key | ✅ |
| `FORCE_COLUMN` | 强制指定栏目（longhudou/xiuhuazhen/fengxiangbiao） | ❌ |
| `DRY_RUN` | 测试模式 `=1` 跳过微信推送 | ❌ |
| `DYNAMIC_ONLY` | 仅用动态新闻源 `=1` | ❌ |

## 📁 项目结构

```
wechat-pusher/
├── SKILL.md                       # WorkBuddy 技能描述
├── scripts/                       # 核心脚本
│   ├── push.js                    # 主推送脚本（~2800行）
│   ├── dynamic-scraper.js         # Playwright 动态抓取模块
│   ├── custom_push.js             # 自定义推送变体
│   └── generate_three_articles.js # 批量文章生成器
├── references/                    # 技术文档
│   ├── js-rendered-scraping-guide.md   # JS渲染页面抓取方案
│   └── column-prompts.md               # 三栏目系统提示词
├── assets/                        # 模板和配置
│   ├── templates/                 # HTML 预览模板
│   ├── config/                    # 配置模板（.env.example 等）
│   └── batch/                     # Windows 批处理脚本
├── package.json
├── .gitignore
└── README.md
```

## 🚀 自动化

系统已在 WorkBuddy 中注册定时任务，周一至周六 10:00 自动推送。

也可通过 Windows 任务计划程序注册（`run.bat` + `install-task.bat`）。

## 🤝 贡献

欢迎提交 Issue 和 PR。主要改进方向：

- 更多新闻源（三大运营商官网）
- 更好的 AI 提示词模板
- 多语言内容支持
- 图片生成能力

## 📝 许可

MIT License

---

**Made with ❤️ for 雕龙绣虎**
