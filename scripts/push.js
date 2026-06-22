/**
 * 雕龙绣虎 公众号自动推送系统 v7.0（三栏目 · 混合配图 · 表情包封面）
 * ─────────────────────────────────────────────────────
 * 栏目体系（3栏 x 每周2次 = 周一到周六每天推送）：
 *   周一/周四 → 龙虎斗（行业深度分析，硬核观点）
 *   周二/周五 → 绣花针（冷知识/趣闻，小切口大道理）
 *   周三/周六 → 烽向标（一周通信见闻精华盘点）
 *
 * 人设：进入通信行业5年的资深技术支持工程师
 *   有实战经验、有行业洞察、敢说真话、接地气
 *
 * 配图策略（混合方案）：
 *   表情包（fabiaoqing等4个来源）做正文点缀和封面
 *   stock photo（loremflickr）做信息图/场景配图
 *   封面：表情包缩放 900×383
 *
 * 字数：每篇约2000字
 */

require('dotenv').config({ path: __dirname + '/.env' });
const fs         = require('fs');
const path       = require('path');
const fetch      = require('node-fetch');
const sharp      = require('sharp');
const { AbortController } = require('abort-controller');

// ──────────────────────────────────────────────────────
// 配置
// ──────────────────────────────────────────────────────

const WX_APPID     = process.env.WX_APPID;
const WX_APPSECRET = process.env.WX_APPSECRET;
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const STATE_FILE   = path.resolve(__dirname, process.env.STATE_FILE || './state.json');
const COVER_FILE   = path.resolve(__dirname, './cover_temp.jpg');
const ACCOUNT_NAME = process.env.ACCOUNT_NAME || '雕龙绣虎';
const IMAGE_DIR    = path.resolve(__dirname, './article_images');

// ─── 栏目配置 ─────────────────────────────────────────
// key = getDay(): 1=周一, 2=周二, ..., 6=周六
// 三栏目轮回：龙虎斗→绣花针→烽向标→龙虎斗→绣花针→烽向标
const COLUMN_MAP = {
  1: { key: 'longhudou',     name: '龙虎斗', style: 'deep_analysis',    needNews: false },
  2: { key: 'xiuhuazhen',    name: '绣花针', style: 'fun_fact',        needNews: false },
  3: { key: 'fengxiangbiao', name: '烽向标', style: 'weekly_review',   needNews: true  },
  4: { key: 'longhudou',     name: '龙虎斗', style: 'deep_analysis',    needNews: false },
  5: { key: 'xiuhuazhen',    name: '绣花针', style: 'fun_fact',        needNews: false },
  6: { key: 'fengxiangbiao', name: '烽向标', style: 'weekly_review',   needNews: true  },
};

// ─── 外部配图主题分类（loremflickr，用于信息图配图） ──
const STOCK_CATEGORIES = [
  { name: 'telecom_tower',    tags: 'telecommunication,antenna,tower,wireless,5G',        desc: '通信基站/天线' },
  { name: 'fiber_optic',      tags: 'fiber,optic,cable,communication,network',            desc: '光纤通信' },
  { name: 'data_center',      tags: 'data,center,server,network,technology',              desc: '数据中心/服务器' },
  { name: 'satellite',        tags: 'satellite,space,communication,technology',            desc: '卫星通信' },
  { name: 'ai_chip',          tags: 'microchip,processor,semiconductor,technology',        desc: 'AI芯片/处理器' },
  { name: 'network_protocol', tags: 'network,connection,router,technology,communication', desc: '网络连接/协议' },
  { name: 'ai_technology',    tags: 'artificial,intelligence,technology,robot',            desc: 'AI技术' },
  { name: 'radio_wave',       tags: 'radio,signal,transmission,communication',            desc: '无线电/信号' },
];

// ─── 表情包情绪分类库 ─────────────────────────────────
// 来源：fabiaoqing.com / dogetu.com / ChineseBQB / uapis.cn
const MEME_CATEGORIES = {
  encouragement: {
    keywords: ['加油', '坚持', '坚守', '奋斗', '守护', '努力', '拼搏', '进步', '向前'],
    count: 0
  },
  heartwarming: {
    keywords: ['感动', '温暖', '暖心', '亲情', '爱', '可爱', '治愈', '温柔', '陪伴'],
    count: 0
  },
  funny: {
    keywords: ['笑', '搞笑', '幽默', '调侃', '滑稽', '哈哈哈', '笑死', '整活', '离谱'],
    count: 0
  },
  approval: {
    keywords: ['赞', '点赞', '自豪', '认可', '佩服', '牛逼', '优秀', '厉害', '好活'],
    count: 0
  },
  worklife: {
    keywords: ['加班', '熬夜', '辛苦', '累', '打工人', '社畜', '搬砖', '疲惫', '倒霉'],
    count: 0
  },
  cover: {
    keywords: ['封面', '醒目', '开场', '吸引', '标题'],
    count: 0
  }
};

// ─── 硬编码表情包备选库 ───────────────────────────────
// 使用 picsum.photos 可靠图片作为兜底（广受好评的免费图片服务）
// 当网络表情包抓取失败时使用，保证配图不空
const FALLBACK_MEMES = [
  { url: 'https://picsum.photos/seed/meme1/400/300', alt: '加油', source: 'fallback' },
  { url: 'https://picsum.photos/seed/meme2/400/300', alt: '努力', source: 'fallback' },
  { url: 'https://picsum.photos/seed/meme3/400/300', alt: '点赞', source: 'fallback' },
  { url: 'https://picsum.photos/seed/meme4/400/300', alt: '优秀', source: 'fallback' },
  { url: 'https://picsum.photos/seed/meme5/400/300', alt: '可爱', source: 'fallback' },
  { url: 'https://picsum.photos/seed/meme6/400/300', alt: '加班', source: 'fallback' },
  { url: 'https://picsum.photos/seed/meme7/400/300', alt: '打工人', source: 'fallback' },
  { url: 'https://picsum.photos/seed/meme8/400/300', alt: '哈哈哈', source: 'fallback' },
  { url: 'https://picsum.photos/seed/meme9/400/300', alt: '坚持', source: 'fallback' },
  { url: 'https://picsum.photos/seed/meme10/400/300', alt: '微笑', source: 'fallback' },
  { url: 'https://picsum.photos/seed/meme11/400/300', alt: '点赞2', source: 'fallback' },
  { url: 'https://picsum.photos/seed/meme12/400/300', alt: '滑稽', source: 'fallback' },
  { url: 'https://picsum.photos/seed/meme13/400/300', alt: '摸鱼', source: 'fallback' },
  { url: 'https://picsum.photos/seed/meme14/400/300', alt: '熬夜', source: 'fallback' },
  { url: 'https://picsum.photos/seed/meme15/400/300', alt: '靠谱', source: 'fallback' },
];


// ─── 模式检测 ─────────────────────────────────────────
const MODE = (() => {
  const idx = process.argv.indexOf('--mode');
  return (idx >= 0 && process.argv[idx + 1]) ? process.argv[idx + 1] : 'auto';
})();

// ──────────────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────────────

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  }
  return { push_count: 0, last_push_date: null, recent_titles: [], used_image_urls: [], image_pool: [], meme_pool: [], pexels_page: {} };
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function getTodayColumn() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  return COLUMN_MAP[day] || null;
}

// ─── 文本处理 ─────────────────────────────────────────

/**
 * 标题去特殊字符：只保留中文、英文、数字和空格
 * 移除所有特殊符号、emoji、标点等
 */
function sanitizeTitle(title) {
  return title
    // 移除 emoji（Unicode 表情符号范围）
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    // 移除常见特殊符号
    .replace(/[@#$%&*^()+={\[}\]\\|;:"'<>,.~`！@#￥%……&*（）——+\-={}【】；：""''，。、？《》「」『』︿〝〞‵′″]/g, '')
    // 移除多余空格
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 64);
}

function cleanTitle(title) {
  return title
    .replace(/^(标题[：:]\s*)/i, '')
    .replace(/^【.*?(投稿|来源|部门|机构).*?】/, '')
    .replace(/[（(]\s*改\s*[）)]$/g, '')
    .replace(/^[#＃《》\s]+/, '')
    .trim()
    .substring(0, 64);
}

function cleanBodyText(rawText, articleTitle) {
  let text = rawText;
  // 移除 AI 可能生成的 font/span 标签（只移除标签本身，保留内容）
  text = text.replace(/<\/?font[^>]*>/gi, '');
  text = text.replace(/<\/?span[^>]*>/gi, '');
  text = text.replace(/<\/?p[^>]*>/gi, '');
  text = text.replace(/<\/?br\s*\/?>/gi, '\n');
  text = text.replace(/^[\s]*标题[：:]\s*[^\n]*\n?/, '');
  if (articleTitle) {
    text = text.replace(new RegExp('^\\s*' + escapeRegex(articleTitle) + '\\s*\\n?'), '');
  }
  // ⚠️ 安全清理：仅移除 inline markdown 标记，不影响正文内容
  // 加粗/斜体：只移除语法符号，保留文字
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');       // **bold** → bold
  text = text.replace(/(?<!\*)\*(?!\*)([^*]+)(?<!\*)\*(?!\*)/g, '$1'); // *italic* → italic
  text = text.replace(/__([^_]+)__/g, '$1');             // __text__ → text
  // 行内代码
  text = text.replace(/`([^`]+)`/g, '$1');               // `code` → code
  // 标题标记（行首 #）
  text = text.replace(/^#{1,4}\s+/gm, '');
  // markdown 链接：[text](url) → text
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');
  // 引用标记：仅移除行首 >，保留内容
  text = text.replace(/^>\s?/gm, '');
  // 列表标记：仅移除行首的 - */\d. 标记，保留文字
  text = text.replace(/^[\s]*[-*+]\s+/gm, '');
  // 注意：不移除 --- 分隔线（烽向标依赖）
  // 不移除任何只有标点的行（避免误删正文）
  // 不移除孤立 * _ 等字符（避免误伤中文中出现的这些符号）
  // 不移除总结性标题行（只移除特定中文短语）
  text = text.replace(/^(金句时间|一句话总结|写在最后|结语|总结|本期小结)[：:】\s]*/gm, '');
  return text.trim();
}

/**
 * 分析文章关键词，匹配最合适的表情包类别
 */
function analyzeMood(text) {
  const scores = {};
  for (const [cat, data] of Object.entries(MEME_CATEGORIES)) {
    scores[cat] = 0;
    for (const kw of data.keywords) {
      const regex = new RegExp(kw, 'g');
      const matches = text.match(regex);
      if (matches) scores[cat] += matches.length;
    }
  }
  // 排除 cover 类别（封面专用）
  const { cover, ...moodCats } = scores;
  const sorted = Object.entries(moodCats).sort((a, b) => b[1] - a[1]);
  if (sorted[0] && sorted[0][1] > 0) return sorted[0][0];
  return 'funny'; // 默认
}

// ──────────────────────────────────────────────────────
// AI 风格系统提示（v7 — 5年资深技术支持工程师人设）
// ──────────────────────────────────────────────────────

/**
 * 人设说明（通用 — 注入到所有 Prompt 中）
 * "你是一个进入通信行业5年的资深技术支持工程师。
 *  你见过各种设备、踩过各种坑、跟运营商和厂商都打过交道。
 *  你写东西有技术深度但不装逼，接地气但不油腻，
 *  能用行业老炮的视角把复杂事情讲得明明白白。"
 */

function getPersonaHead() {
  return `你是公众号"${ACCOUNT_NAME}"的主笔。你的人设是：一个进入通信行业5年的资深技术支持工程师。

你的核心特质：
1. **有行业洞察**：对通信行业的格局、技术趋势、厂商竞争有清晰认知
2. **技术功底扎实**：能讲原理但不用术语砸人，能把复杂技术用大白话说清楚
3. **敢说真话**：行业潜规则、厂商套路、运营商骚操作，不避讳
4. **接地气**：善用对比、比喻、数据来佐证观点，不端不装

写作风格要求：
- **约2000字**——每篇保持在1800-2200字之间，保证信息密度和阅读深度
- 语气像跟同行聊天——专业、坦诚、有观点
- 每篇文章必须有明确的观点立场，不说片汤话
- 至少使用2个具体数据/案例支撑观点
- 可在文中自然融入1-2句有传播力的观点句，但禁止在文末以"金句时间""一句话总结""写在最后""结语""总结"等标题或段落形式收尾

🚫 **绝对禁止（违反将导致内容作废）**：
1. **禁止任何第一人称虚构经历**——不得写"我去年在XX"、"我同事""我朋友""我遇到过一个客户"等
2. **禁止具体地理位置**——不出现深圳、上海、杭州、金华等任何城市名
3. **禁止编造人物和对话**——不写"小李说""张工吐槽道"等虚构角色
4. **禁止编造具体公司内部细节**——不写"某省运营商内部会议透露"等无法核实的信息
5. 用**第三人称行业分析**的口吻写作，如"行业数据显示""从公开信息看""据行业观察"
6. **禁止使用任何 markdown 格式**——不要用 **、*、__、反引号、#、>、-、1. 等标记。输出纯文本即可，无需任何格式化标记`;
}

/**
 * 龙虎斗（周一/周四）—— 行业深度分析
 * 定位：通信圈最敢说的硬核分析。深扒行业事件、公司战略、技术迭代的内幕和逻辑。
 * 目标读者：懂点通信的技术人、行业从业者
 */
const LONGHUDOU_SYSTEM = `${getPersonaHead()}

## 栏目：「龙虎斗」—— 行业深扒（周一/周四）

你现在正在写「龙虎斗」栏目。这个栏目的定位是：**通信行业最有料的深度分析**。

选题范围（从以下方向中选，也可结合热点确定）：
1. 通信设备商（华为/中兴/烽火/爱立信/诺基亚）的竞争格局和战略解读
2. **重点：烽火（FiberHome）在光通信、5G承载网、国产替代中的角色和成就**
3. 三大运营商（移动/电信/联通）的竞合博弈，KPI 内卷，基层生态
4. 技术迭代的产业逻辑：从 TDM→IP→5G→6G，背后的产业博弈
5. 通信国产化的真实进展：哪些真的突破了，哪些还在"卡脖子"
6. 算力网络、卫星通信、物联网等新赛道的格局和机会
7. 通信圈的价格战、专利战、人才战

写作方向：
1. 从**一个具体的事件/数据/现象**切入，层层展开分析
2. 要有格局感：不只说现象，要点出背后的行业逻辑
3. 要有态度：支持谁、质疑谁、看好什么、不看好什么，立场明确
4. 结构推荐：现象引入 → 背景铺垫 → 深度分析 → 观点总结
5. 整体控制在1800-2200字

注意：
- **不写个人暖心故事**，只写公司、行业、技术层面的分析
- **不写烽火干线维护、光纤施工等具体一线工作内容**
- **不写纯技术教程**，要有观点、有态度、有行业视角
- 近期已发布标题列表会提供，不得重复

### 烽火宣传方向提示（重要）
写烽火（FiberHome）时，聚焦以下方面：
- 烽火在光通信领域的行业地位和技术积累
- 烽火5G承载网、OTN、光接入等产品线的创新
- 烽火在国产化替代进程中的角色和贡献
- 烽火与中国移动/电信/联通的合作案例
- 光通信产业格局：烽火与华为/中兴在光领域的竞合关系
注意：**不要涉及烽火干线维护人员的具体工作细节和内部运营流程**`;

/**
 * 绣花针（周二/周五）—— 冷知识/趣闻
 * 定位：通信圈最有趣的冷知识和行业趣闻。
 * 从一个小切口讲一个有意思的道理，让外行也能看懂、愿意转发。
 */
const XIUHUAZHEN_SYSTEM = `${getPersonaHead()}

## 栏目：「绣花针」—— 冷知识·趣闻·小切口（周二/周五）

你现在正在写「绣花针」栏目。这个栏目的定位是：**通信圈最有意思的小故事**。

选题范围（从以下方向中选，也可自由发挥）：
1. 通信冷知识：为什么手机信号满格却刷不出视频？5G 到底比4G快多少？
2. 行业趣闻：运营商/设备商之间的"爱恨情仇"、通信圈奇葩事
3. 通信和生活：一个通信技术如何改变了普通人的生活
4. 辟谣时间：那些流传很广的通信谣言，真相是什么
5. 技术对比：4G vs 5G、光纤 vs 5G、华为 vs 中兴的技术路线差异
6. 烽火趣知识：光通信领域的有趣冷知识和行业典故

写作方向：
1. 从**一个具体的问题/现象**切入
2. 要有"啊哈时刻"：读者看完会说"原来是这样！"
3. 有趣优先：可以有吐槽、有行业八卦、有恍然大悟
4. 结构推荐：悬念/问题开场 → 层层揭秘 → 结论/升华
5. 整体控制在1800-2200字

注意：
- 这是"社交传播"的主力栏目，要让外行看完也愿意转发
- **不要太硬核**：技术细节点到为止，重点是有趣和 relatable
- 近期已发布标题列表会提供，不得重复`;

/**
 * 烽向标（周三/周六）—— 一周通信见闻
 * 定位：替读者把这一周最重要的通信圈大事过一遍。
 * 是精华版、观点版，不是新闻汇总。
 */
const FENGXIANGBIAO_SYSTEM = `${getPersonaHead()}

## 栏目：「烽向标」—— 一周通信见闻精华（周三/周六）

你现在正在写「烽向标」栏目。定位：**一周通信圈最重要的事，以客观、中立的新闻综述形式呈现**。

素材来源：
- 实际新闻素材（C114通信网、东方财富等渠道抓取）会作为上下文提供
- 素材覆盖：运营商、华为、中兴、烽火、光通信、国内通信政策、通信行业财经等
- 如果新闻素材为空，则凭行业知识撰写本周回顾

写作方向：
1. **精选本周4件事**：从本周众多新闻中选出最有价值的4条
2. 标题格式：第一行写 📡 烽向标 | YYYY年M月D日
3. 每条新闻用 --- 分隔。每条的结构：先写事件概述（事实性、客观），后写烽评（以"烽评："开头带观点）
4. **每条新闻最后两行必须写**：先写 \`📎 原文链接:\`（单独一行），下一行写该条新闻的URL\n   （URL从素材中对应新闻的链接原样复制，不可省略，不可编造）
5. **1个"本周值得关注"**：挑一个下周话题前瞻
6. 末尾用 💬 抛一个讨论问题

结构要求（请严格遵守）：
- 开头：**一段简短客观的综述开场**，说明本周覆盖的主题范围。请用浅蓝底框单独标出
- 正文：4条新闻，每条用 --- 分隔
- 本周关注：单独一段
- 结尾：💬 讨论问题

🚫 **严格禁止（违反将导致内容作废）**：
1. **禁止任何主观称呼**：不得出现"咱们""通信同行们""咱们这行""各位读者"等称呼
2. **禁止口语化表述**：严禁使用"第一件事""第二件事""说白了""这背后""说白了就是""值得一提的是""不难看出""可以说""换言之"等口语化/自媒体式用语
3. **禁止个人色彩开场**：不得写"这周信息量有点大""挑了4件最值得聊的"等主观引导
4. **禁止内容重复**：本周关注、烽评、💬讨论 三者内容不得重叠
5. **禁止 Markdown 标记**（注意：--- 分隔线属于文章结构要求，必须保留，不是 Markdown 格式标记）
6. **每条新闻的烽评必须写"烽评："开头**（不要写成"◆烽评"或其他格式）
7. **💬 讨论问题只出现一次**，放在全文最后

写作语态要求：
- 保持**客观中立的新闻报道语态**
- 使用规范新闻格式，类似 C114通信网、人民邮电报的行文风格
- 事实陈述部分不加修饰语
- 烽评部分可以直接给出分析判断，但措辞需严谨`;

// ──────────────────────────────────────────────────────
// 新闻抓取（从 v6.5 继承，烽向标栏目使用）
// ──────────────────────────────────────────────────────

const NEWS_SOURCES = {
  c114_operator: 'https://www.c114.com.cn/news/16.html',
  c114_huawei: 'https://www.c114.com.cn/news/126.html',
  c114_home: 'https://www.c114.com.cn/',
  c114_device: 'https://www.c114.com.cn/ftth/',
  c114_domestic: 'https://www.c114.com.cn/news/22.html',
  c114_news_main: 'https://www.c114.com.cn/news/',
  c114_interview: 'https://www.c114.com.cn/interview/',
  eastmoney_telecom: 'https://finance.eastmoney.com/a/cgsxw.html',
};

const NEWS_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

// 清洗新闻标题：去除 · 前缀、HTML 实体、多余空白
function cleanNewsTitle(title) {
  return title
    .replace(/^·\s*/, '')           // 去掉 · 前缀
    .replace(/&amp;/g, '&')          // HTML 实体
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, '')         // 去掉嵌套标签
    .trim();
}

// 从列表页提取新闻（含封面图）
async function fetchC114News(url) {
  const iconv = require('iconv-lite');
  const res = await fetch(url, { headers: NEWS_HEADERS, timeout: 10000 });
  const buffer = await res.buffer();
  const html = iconv.decode(buffer, 'gbk');

  const items = [];
  const seen = new Set();

  // 方式1：从 new_list_c 块提取（含封面图）
  const blockRegex = /<div class="new_list_c">([\s\S]*?)<\/div>\s*(?=<div class="new_list_c"|<div class="recommendation|<\/div>\s*<\/div>)/g;
  let match;
  while ((match = blockRegex.exec(html)) !== null) {
    const block = match[1];
    const linkMatch = block.match(/<a href="(https?:\/\/www\.c114\.com\.cn\/[^"]+\.html)"[^>]*>([^<]+)<\/a>/);
    const imgMatch = block.match(/<img[^>]+src="([^"]*image\.c114\.com\.cn[^"]*)"/);
    if (linkMatch) {
      const title = cleanNewsTitle(linkMatch[2]);
      if (title.length > 5 && !seen.has(title)) {
        seen.add(title);
        let imgUrl = imgMatch ? imgMatch[1] : null;
        if (imgUrl && imgUrl.startsWith('//')) imgUrl = 'https:' + imgUrl;
        items.push({ title, link: linkMatch[1], coverImage: imgUrl, source: 'C114通信网' });
      }
    }
  }

  // 方式2：通用正则（处理 news/22.html 等不带 new_list_c 结构的页面）
  if (items.length === 0) {
    const itemRegex = /href="(https?:\/\/www\.c114\.com\.cn\/[^"]+\.html)"[^>]*?>([^<]+)<\/a>/g;
    while ((match = itemRegex.exec(html)) !== null) {
      const link = match[1];
      const title = cleanNewsTitle(match[2]);
      // 过滤导航类链接和非新闻链接
      if (title && title.length > 5 && !seen.has(title) &&
          !link.includes('/topic/') && !link.includes('/aboutus/') &&
          !link.includes('/expo/') && !title.includes('回新闻首页')) {
        seen.add(title);
        items.push({ title, link, coverImage: null, source: 'C114通信网' });
      }
    }
  }

  return items.slice(0, 25);
}

// 从东方财富抓取通信相关财经新闻
async function fetchEastMoneyNews(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': NEWS_HEADERS['User-Agent'], 'Accept': 'text/html,*/*' },
      timeout: 10000, redirect: 'follow'
    });
    const html = await res.text();
    const items = [];
    const seen = new Set();

    const linkRegex = /href="(https?:\/\/finance\.eastmoney\.com\/a\/\d+\.html)"[^>]*>([^<]{10,})<\/a>/g;
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      const link = match[1];
      const title = match[2].trim();
      // 过滤通信/AI/半导体/算力相关的新闻
      if (title.match(/通信|5G|6G|光纤|光通信|芯片|半导体|算力|数据中心|华为|中兴|烽火|运营商|电信|移动|联通|AI|服务器|基站|卫星|网络|互联网|数字化|智能|云计算|量子|宽带|物联网|光模块/i)) {
        if (!seen.has(title)) {
          seen.add(title);
          items.push({ title, link, coverImage: null, source: '东方财富' });
        }
      }
    }
    return items.slice(0, 15);
  } catch (e) {
    console.warn(`   ⚠️  东方财富抓取失败: ${e.message}`);
    return [];
  }
}

// 从详情页提取正文首图（当列表页无封面图时使用）
async function fetchArticleImage(url) {
  const iconv = require('iconv-lite');
  try {
    const res = await fetch(url, { headers: NEWS_HEADERS, timeout: 10000 });
    const buffer = await res.buffer();
    const html = iconv.decode(buffer, 'gbk');

    // 优先找正文区域的 image.c114.com.cn 图片（非 cover 路径）
    const contentImgRegex = /<img[^>]+src="(https?:)?\/\/image\.c114\.com\.cn\/(?!cover\/)[^"]+"/gi;
    let m = contentImgRegex.exec(html);
    if (m) {
      let src = m[0].match(/src="([^"]+)"/)[1];
      if (src.startsWith('//')) src = 'https:' + src;
      return src;
    }

    // 降级：找 cover 图
    const coverImgRegex = /<img[^>]+src="(https?:)?\/\/image\.c114\.com\.cn\/cover\/[^"]+"/gi;
    m = coverImgRegex.exec(html);
    if (m) {
      let src = m[0].match(/src="([^"]+)"/)[1];
      if (src.startsWith('//')) src = 'https:' + src;
      return src;
    }

    return null;
  } catch (_) {
    return null;
  }
}

async function fetchAllNews() {
  let allItems = [];

  // DYNAMIC_ONLY=1 时跳过 HTTP 源，仅用动态抓取
  const dynamicOnly = process.env.DYNAMIC_ONLY === '1';

  if (!dynamicOnly) {
    try {
      // HTTP 抓取：C114 + 东方财富（快速，毫秒级）
      const [opItems, hwItems, homeItems, deviceItems, domesticItems, newsMainItems, interviewItems, emItems] = await Promise.all([
        fetchC114News(NEWS_SOURCES.c114_operator).catch(() => []),
        fetchC114News(NEWS_SOURCES.c114_huawei).catch(() => []),
        fetchC114News(NEWS_SOURCES.c114_home).catch(() => []),
        fetchC114News(NEWS_SOURCES.c114_device).catch(() => []),
        fetchC114News(NEWS_SOURCES.c114_domestic).catch(() => []),
        fetchC114News(NEWS_SOURCES.c114_news_main).catch(() => []),
        fetchC114News(NEWS_SOURCES.c114_interview).catch(() => []),
        fetchEastMoneyNews(NEWS_SOURCES.eastmoney_telecom).catch(() => []),
      ]);
      allItems = [...opItems, ...hwItems, ...homeItems, ...deviceItems, ...domesticItems, ...newsMainItems, ...interviewItems, ...emItems];
      console.log(`   📰 HTTP源: C114运营商${opItems.length} 华为${hwItems.length} 首页${homeItems.length} FTTH${deviceItems.length} 国内${domesticItems.length} 新闻主站${newsMainItems.length} 访谈${interviewItems.length} 东方财富${emItems.length}`);
    } catch (err) {
      console.warn(`   ⚠️  HTTP新闻抓取失败: ${err.message}`);
    }
  } else {
    console.log('   🔒 DYNAMIC_ONLY 模式：跳过 HTTP 源，仅用动态抓取');
  }

  // 动态抓取：华为/中兴/烽火官网（Playwright + Edge，秒级）
  try {
    const { scrapeDynamicSites, closeBrowser } = require('./dynamic-scraper');
    console.log('   🌐 启动动态抓取（华为/中兴/烽火官网）...');
    const dynamicItems = await scrapeDynamicSites();
    if (dynamicItems.length > 0) {
      allItems.push(...dynamicItems);
      const bySource = {};
      dynamicItems.forEach(it => { bySource[it.source] = (bySource[it.source] || 0) + 1; });
      console.log(`   📰 动态源: ${Object.entries(bySource).map(([s, c]) => `${s}${c}`).join(' ')}`);
    }
    // 关闭浏览器释放资源
    await closeBrowser();
  } catch (err) {
    console.warn(`   ⚠️  动态抓取失败（不影响推送）: ${err.message}`);
  }

  const seen = new Set();
  const unique = [];
  for (const item of allItems) {
    if (!seen.has(item.title)) {
      seen.add(item.title);
      unique.push(item);
    }
  }

  const topArticles = unique.slice(0, 50);

  // 对没有封面图的新闻，从详情页提取正文首图（并发但限流）
  const noImageItems = topArticles.filter(it => !it.coverImage);
  if (noImageItems.length > 0) {
    console.log(`   📸 ${noImageItems.length} 条新闻无列表页封面图，从详情页提取...`);
    // 并发提取，最多同时5个
    const batchSize = 5;
    for (let i = 0; i < noImageItems.length; i += batchSize) {
      const batch = noImageItems.slice(i, i + batchSize);
      await Promise.all(batch.map(async (item) => {
        // C114/东方财富 用 HTTP 提取，华为/中兴/烽火用 Playwright 提取
        if (item.source === 'C114通信网' || item.source === '东方财富') {
          const img = await fetchArticleImage(item.link);
          if (img) item.coverImage = img;
        } else if (['华为官网', '中兴官网', '烽火官网'].includes(item.source)) {
          const { fetchArticleImageDynamic } = require('./dynamic-scraper');
          const img = await fetchArticleImageDynamic(item.link);
          if (img) item.coverImage = img;
        }
      }));
    }
    const found = noImageItems.filter(it => it.coverImage).length;
    console.log(`   ✅ 详情页提取到 ${found}/${noImageItems.length} 张配图`);
  }

  const text = topArticles.map((item, i) =>
    `${i + 1}. ${item.title} (来源: ${item.source} ${item.link})`
  ).join('\n');

  return { text, articles: topArticles };
}

// ──────────────────────────────────────────────────────
// 配图系统（混合方案：表情包 + stock photo）
// 图源优先级：Pexels API(需Key) → 千图网爬取 → Picsum动态种子 → loremflickr
// ── 主题种子映射（按用户指定关键词构建） ──
const PICSUM_BASE_SEEDS = {
  telecom_tower:    'Base-Station-Antenna-Array-5G-NR-Cell-Tower',
  fiber_optic:      'Fiber-Optic-Optical-Module-Fiber-Splice-Submarine-Cable',
  data_center:      'Data-Center-Rack-Server-Room-Signal-Propagation',
  satellite:        'Satellite-Communication-Network-Topology',
  ai_chip:          'Optical-Module-Signal-Propagation-Network-Topology',
  network_protocol: 'Network-Topology-Signal-Propagation-Network-Cable',
  ai_technology:    'Telecom-Engineer-Antenna-Array-Network-Topology',
  radio_wave:       'Signal-Propagation-Antenna-Array-5G-NR',
};

/**
 * 生成不重复的 Picsum 种子 URL（基于日期+自增，确保每次新图）
 */
function generatePicsumUrls(category, count) {
  const base = PICSUM_BASE_SEEDS[category];
  if (!base) return [];
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const categoryDesc = {
    telecom_tower: '基站铁塔/天线阵列', fiber_optic: '光纤熔接/海底光缆', data_center: '数据中心机柜/机房',
    satellite: '卫星通信/网络拓扑', ai_chip: '光模块/信号传播', network_protocol: '网络拓扑/通信连接',
    ai_technology: '通信工程师/网络拓扑', radio_wave: '信号传播/天线阵列',
  };
  const desc = categoryDesc[category] || category;
  const urls = [];
  for (let i = 0; i < count; i++) {
    const seed = `${base}-${dateStr}-${i}`;
    urls.push({ url: `https://picsum.photos/seed/${seed}/1920/1080`, category, desc, type: 'picsum' });
  }
  return urls;
}

/**
 * Pexels API 搜索（需环境变量 PEXELS_API_KEY）
 */
async function searchPexels(query, count = 2, page = 1) {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) return [];
  try {
    const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${count * 3}&page=${page}&orientation=landscape`, {
      headers: { 'Authorization': apiKey },
      timeout: 10000
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.photos || []).slice(0, count).map(p => ({
      url: p.src.large2x || p.src.large,
      desc: query,
      category: 'pexels',
      type: 'pexels'
    }));
  } catch (_) { return []; }
}

/**
 * 千图网搜索爬取（按用户指定关键词）
 */
async function scrapeQiantu(keyword, count = 2) {
  const results = [];
  try {
    const res = await fetch(`https://www.58pic.com/tupian/${encodeURIComponent(keyword)}.html`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' },
      timeout: 8000
    });
    const html = await res.text();
    // 千图网图片URL匹配
    const imgRegex = /https?:\/\/[\w.-]+\.58pic\.com\/files\/[^"'\s]+\.(jpg|jpeg|png|webp)/gi;
    let m;
    while ((m = imgRegex.exec(html)) !== null) {
      if (results.length >= count) break;
      results.push({ url: m[0], desc: keyword, category: 'qiantu', type: 'qiantu' });
    }
  } catch (_) {}
  return results;
}

/**
 * Pexels/千图网 搜索词映射（根据 analyzeTopic 分类）
 */
const IMAGE_SEARCH_QUERIES = {
  telecom_tower:    { pexels: '5G base station cell tower antenna telecommunication', qiantu: '5G基站' },
  fiber_optic:      { pexels: 'fiber optic cable optical network telecommunication', qiantu: '光纤熔接' },
  data_center:      { pexels: 'data center server room rack technology network', qiantu: '数据中心机房' },
  satellite:        { pexels: 'satellite communication antenna dish space', qiantu: '卫星通信' },
  ai_chip:          { pexels: 'microchip processor semiconductor technology circuit', qiantu: '芯片半导体' },
  network_protocol: { pexels: 'network cable router connection technology internet', qiantu: '网络拓扑' },
  ai_technology:    { pexels: 'artificial intelligence robot technology automation', qiantu: '人工智能' },
  radio_wave:       { pexels: 'radio antenna signal transmission communication 5G', qiantu: '信号传播' },
};

/**
 * 从图库获取通信主题的 stock photo（Pexels → 千图网 → Picsum → loremflickr）
 */
async function fetchStockImages(usedUrlSet, count = 2, preferredCats) {
  console.log('\n🖼️  从图库获取通信主题配图...');
  const found = [];
  const usedSet = usedUrlSet || new Set();
  const preferred = preferredCats || new Set();
  const needed = count * 2;

  // ── 第一梯队：Pexels API（需 .env 中配置 PEXELS_API_KEY） ──
  const hasPexelsKey = !!process.env.PEXELS_API_KEY;
  if (hasPexelsKey) {
    const searchCats = preferred.size > 0 ? [...preferred] : Object.keys(IMAGE_SEARCH_QUERIES);
    for (const cat of searchCats) {
      if (found.length >= needed) break;
      const query = IMAGE_SEARCH_QUERIES[cat]?.pexels;
      if (!query) continue;
      const items = await searchPexels(query, 2);
      for (const item of items) {
        if (!usedSet.has(item.url) && found.length < needed) {
          found.push(item);
        }
      }
    }
    if (found.length > 0) {
      console.log(`   📸 Pexels 获取到 ${found.length} 张配图`);
    }
  }

  // ── 第二梯队：千图网爬取 ──
  if (found.length < count) {
    const searchCats = preferred.size > 0 ? [...preferred] : Object.keys(IMAGE_SEARCH_QUERIES);
    for (const cat of searchCats) {
      if (found.length >= needed) break;
      const query = IMAGE_SEARCH_QUERIES[cat]?.qiantu;
      if (!query) continue;
      const items = await scrapeQiantu(query, 2);
      for (const item of items) {
        if (!usedSet.has(item.url) && found.length < needed) {
          found.push(item);
        }
      }
    }
    if (found.length > 0) {
      console.log(`   🏢 千图网补充 ${found.length} 张配图`);
    }
  }

  // ── 第三梯队：Picsum 动态种子（日期+自增，确保不重复） ──
  const catList = preferred.size > 0 ? [...preferred] : Object.keys(PICSUM_BASE_SEEDS);
  const picsumItems = [];
  for (const cat of catList) {
    const urls = generatePicsumUrls(cat, 3);
    for (const item of urls) {
      if (!usedSet.has(item.url)) {
        picsumItems.push(item);
      }
    }
  }
  // 按主题匹配度排序：优先取匹配分类
  picsumItems.sort((a, b) => {
    const aP = preferred.has(a.category) ? 0 : 1;
    const bP = preferred.has(b.category) ? 0 : 1;
    return aP - bP;
  });
  for (const item of picsumItems) {
    if (found.length >= needed) break;
    found.push(item);
  }

  // 如果 Picsum 不够，从全部分类补充（用不同日期偏移量生成新种子）
  if (found.length < needed) {
    const prevDate = new Date(Date.now() - 86400000).toISOString().slice(0, 10).replace(/-/g, '');
    for (const [cat] of Object.entries(PICSUM_BASE_SEEDS)) {
      if (found.length >= needed) break;
      if (catList.includes(cat)) continue;
      for (let v = 0; v < 2 && found.length < needed; v++) {
        const seed = `${PICSUM_BASE_SEEDS[cat]}-${prevDate}-${v}`;
        const imageUrl = `https://picsum.photos/seed/${seed}/1920/1080`;
        if (!usedSet.has(imageUrl)) {
          const categoryDesc = {
            telecom_tower: '通信基站/天线', fiber_optic: '光纤通信', data_center: '数据中心/服务器',
            satellite: '卫星通信', ai_chip: 'AI芯片/处理器', network_protocol: '网络连接/协议',
            ai_technology: 'AI技术', radio_wave: '无线电/信号',
          };
          found.push({ url: imageUrl, category: cat, desc: categoryDesc[cat] || cat, type: 'picsum' });
        }
      }
    }
  }

  // ── 降级：loremflickr（当 Picsum 拿不到时） ──
  if (found.length < count) {
    console.log('   ⚠️  Picsum 图片不足，降级到 loremflickr');
    let lock = 1;
    const orderedCats = [...STOCK_CATEGORIES].sort((a, b) => {
      const aP = preferred.has(a.name) ? 0 : 1;
      const bP = preferred.has(b.name) ? 0 : 1;
      return aP - bP;
    });

    for (let attempt = 0; attempt < count * 8 && found.length < needed; attempt++) {
      const cat = orderedCats[attempt % orderedCats.length];
      const imageUrl = `https://loremflickr.com/1920/1080/${cat.tags}?lock=${lock}`;
      if (!usedSet.has(imageUrl)) {
        found.push({ url: imageUrl, category: cat.name, desc: cat.desc, type: 'stock' });
      }
      lock++;
    }
  }

  // 打乱
  for (let i = found.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [found[i], found[j]] = [found[j], found[i]];
  }

  const selected = found.slice(0, count);
  const catInfo = selected.map(s => s.desc).join('、');
  const unsplashCount = selected.filter(s => s.type === 'picsum').length;
  const matchedCount = selected.filter(s => preferred.has(s.category)).length;
  console.log(`   ✅ 获取到 ${selected.length} 张配图（Picsum ${unsplashCount}张${unsplashCount > 0 && matchedCount > 0 ? `，${matchedCount}张匹配主题` : ''}）：${catInfo}`);
  return selected;
}

/**
 * 分析文章主题关键词（Plan C 增强版：返回含 Unsplash 搜索词）
 */
function analyzeTopic(text) {
  const topics = {
    telecom_tower:    { keywords: ['5G', '基站', '移动通信', '蜂窝', '无线', '覆盖', '信号', '承载网', 'SPN', 'MIMO'] },
    fiber_optic:      { keywords: ['光纤', '光通信', '光模块', '光缆', '烽火', '传输网', 'OTN', '光', '波分'] },
    data_center:      { keywords: ['数据中心', '服务器', '算力', '云', 'AI', 'GPU', '大模型', '芯片', '英伟达', '云计算'] },
    satellite:        { keywords: ['卫星', '星链', 'Starlink', '低轨', '航天', '太空', 'SpaceX', '卫星通信'] },
    ai_chip:          { keywords: ['芯片', '半导体', '处理器', '代工', '晶圆', '算力', '英伟达', '台积电', '三星', '制程'] },
    network_protocol: { keywords: ['网络', '协议', '路由', '交换', '互联', 'IP', 'TCP', 'SDN', 'NFV'] },
    ai_technology:    { keywords: ['AI', '人工智能', '大模型', '深度', '智能', '自动化', 'GPT', '神经网络'] },
    radio_wave:       { keywords: ['频谱', '频率', '无线电', '频段', '毫米波', '太赫兹', '电磁'] },
  };
  const scores = {};
  for (const [topic, data] of Object.entries(topics)) {
    scores[topic] = 0;
    for (const kw of data.keywords) {
      const regex = new RegExp(kw, 'gi');
      const matches = text.match(regex);
      if (matches) scores[topic] += matches.length;
    }
  }
  return Object.entries(scores).sort((a, b) => b[1] - a[1]).filter(e => e[1] > 0);
}
async function refreshMemePool() {
  console.log('\n😀 刷新表情包池...');
  const memes = [];

  // 来源1: fabiaoqing.com — 搜索"通信"表情包
  try {
    const res = await fetch('https://www.fabiaoqing.com/search/search/keyword/通信.html', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      },
      timeout: 6000
    });
    const html = await res.text();
    const imgRegex = /<img[^>]+src="(https?:\/\/img\.soutula\.com[^"]+)"[^>]*alt="([^"]*)"/g;
    let m;
    while ((m = imgRegex.exec(html)) !== null) {
      memes.push({ url: m[1].replace(/!thumbnail/, ''), alt: m[2], source: 'fabiaoqing' });
    }
  } catch (_) {}

  // 来源2: ChineseBQB
  try {
    const res = await fetch('https://www.chinesebqb.com/api/random/batch?count=20', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 6000
    });
    const data = await res.json();
    if (Array.isArray(data)) {
      for (const item of data) {
        if (item.url) memes.push({ url: item.url, alt: item.name || '', source: 'chinesebqb' });
      }
    }
  } catch (_) {}

  // 来源3: uapis.cn
  try {
    const res = await fetch('https://www.uapis.cn/api/bqb/random?count=10', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 6000
    });
    const data = await res.json();
    if (data && Array.isArray(data.data)) {
      for (const item of data.data) {
        if (item.url) memes.push({ url: item.url, alt: item.name || '', source: 'uapis' });
      }
    }
  } catch (_) {}

  // 来源4: dogetu.com
  try {
    const res = await fetch('https://www.dogetu.com/search?keyword=通信', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      },
      timeout: 6000
    });
    const html = await res.text();
    const imgRegex = /<img[^>]+src="(https?:\/\/[^"]+)"[^>]*alt="([^"]*)"/g;
    let m;
    while ((m = imgRegex.exec(html)) !== null) {
      if (m[1].match(/\.(jpg|jpeg|png|gif|webp)/i)) {
        memes.push({ url: m[1], alt: m[2], source: 'dogetu' });
      }
    }
  } catch (_) {}

  // 如果网络来源都失败了，用硬编码备选库
  if (memes.length < 5) {
    console.log('   ⚠️ 网络表情包来源不可用，使用硬编码备选库');
    // 从 FALLBACK_MEMES 中随机选一部分
    const shuffled = [...FALLBACK_MEMES].sort(() => Math.random() - 0.5);
    memes.push(...shuffled);
  }

  // 去重
  const seen = new Set();
  const unique = [];
  for (const m of memes) {
    const key = m.url.split('?')[0]; // 去掉 query 参数后去重
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(m);
    }
  }

  console.log(`   ✅ 表情包池: ${unique.length} 张（网络 ${memes.length} 张）`);
  return unique;
}

/**
 * 下载图片到本地（带多重防盗链兼容）
 */
async function downloadImage(url, filePath) {
  // 根据来源选择 referrer
  let referrer = 'https://www.fabiaoqing.com/';
  if (url.includes('chinesebqb')) referrer = 'https://www.chinesebqb.com/';
  else if (url.includes('dogetu')) referrer = 'https://www.dogetu.com/';
  else if (url.includes('uapis')) referrer = 'https://www.uapis.cn/';
  else if (url.includes('picsum')) referrer = 'https://picsum.photos/';

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
    'Referer': referrer,
  };

  // 尝试两轮：先用精准 referrer，不行再用通用
  for (let attempt = 0; attempt < 2; attempt++) {
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 10000);
    try {
      const res = await fetch(url, { signal: ac.signal, headers, timeout: 10000, follow: 5 });
      clearTimeout(timeout);
      if (res.ok) {
        const buffer = await res.buffer();
        if (buffer.length > 1024) { // 至少1KB才算有效图片
          fs.writeFileSync(filePath, buffer);
          return filePath;
        }
      }
      // 第一轮失败，第二轮用不同的 referrer
      headers['Referer'] = 'https://www.baidu.com/';
    } catch (err) {
      clearTimeout(timeout);
      headers['Referer'] = 'https://www.baidu.com/';
    }
  }
  return null;
}

/**
 * 混合配图选择器
 * 返回：{ coverMeme, bodyMemes[], stockPhotos[] }
 */
async function selectHybridImages(articleText, state) {
  const usedUrls = new Set(state.used_image_urls || []);
  const memePool = state.meme_pool || [];

  // 1. 补充表情包池（如果不足或已耗尽）
  let freshMemes = memePool.filter(m => !usedUrls.has(m.url));
  if (freshMemes.length < 10) {
    // 先尝试从网络刷新
    console.log('   表情包池不足，从网络刷新...');
    const newMemes = await refreshMemePool();
    const existingUrls = new Set(memePool.map(m => m.url));
    const uniqueNew = newMemes.filter(m => !existingUrls.has(m.url) && !usedUrls.has(m.url));

    if (uniqueNew.length > 0) {
      freshMemes = [...freshMemes, ...uniqueNew];
      state.meme_pool = [...memePool, ...uniqueNew].slice(0, 100);
    }

    // 如果网络刷新也没拿到新图，清空已使用记录，循环使用
    if (freshMemes.length < 10) {
      console.log('   网络刷新无新图，回收已使用记录以循环利用');
      // 重置 meme_pool 的使用记录（只对 meme 类型的 URL 重置）
      const memeUrls = new Set(memePool.map(m => m.url));
      const remaining = [...usedUrls].filter(u => !memeUrls.has(u));
      state.used_image_urls = [...remaining];
      freshMemes = memePool.slice(); // 全部可用了
    }
  }

  // 2. 选择封面（优先 Pexels 通信主题配图 → 降级表情包）
  let coverMeme = null;
  const pexelsKey = process.env.PEXELS_API_KEY;
  if (pexelsKey) {
    const topicRanking = analyzeTopic(articleText);
    const topCat = topicRanking[0]?.[0];
    const coverQuery = IMAGE_SEARCH_QUERIES[topCat]?.pexels || 'telecommunication technology network';
    // 轮询 Pexels 分页，避免重复
    const pexelsPage = state.pexels_page?.[topCat] || 1;
    try {
      const pexelCovers = await searchPexels(coverQuery, 5, pexelsPage);
      const unusedCover = pexelCovers.find(c => !usedUrls.has(c.url));
      if (unusedCover) {
        coverMeme = { url: unusedCover.url, alt: coverQuery, source: 'pexels' };
        console.log(`   📸 封面: Pexels "${coverQuery}" (第${pexelsPage}页)`);
      }
      // 更新分页
      state.pexels_page = state.pexels_page || {};
      state.pexels_page[topCat] = (pexelsPage % 10) + 1;
    } catch (_) {}
  }
  // 降级：Pexels 不可用或没找到，用表情包池
  if (!coverMeme) {
    const coverCandidates = freshMemes.filter(m => !state.used_image_urls?.includes(m.url));
    coverMeme = coverCandidates.length > 0
      ? coverCandidates[Math.floor(Math.random() * Math.min(coverCandidates.length, 8))]
      : null;
  }

  // 3. 正文配图（优先 Pexels → 降级表情包）
  const mood = analyzeMood(articleText);
  console.log(`   📊 文章情绪分析: ${mood}`);

  let bodyMemes = [];
  // 先从 Pexels 获取正文配图
  if (pexelsKey) {
    const topicRanking = analyzeTopic(articleText);
    const cat = topicRanking[1]?.[0] || topicRanking[0]?.[0];
    const bodyQuery = IMAGE_SEARCH_QUERIES[cat]?.pexels || 'telecommunication technology';
    const bodyPage = state.pexels_page?.['body_' + cat] || 1;
    try {
      const pexelBodies = await searchPexels(bodyQuery, 3, bodyPage);
      for (const item of pexelBodies) {
        if (!usedUrls.has(item.url) && bodyMemes.length < 2) {
          bodyMemes.push({ url: item.url, alt: bodyQuery, source: 'pexels' });
        }
      }
      if (bodyMemes.length > 0) {
        console.log(`   📸 正文配图: Pexels "${bodyQuery}" (第${bodyPage}页)`);
      }
      state.pexels_page = state.pexels_page || {};
      state.pexels_page['body_' + cat] = (bodyPage % 10) + 1;
    } catch (_) {}
  }

  // 降级：Pexels 不足时用表情包池补充
  const remainingMemes = coverMeme
    ? freshMemes.filter(m => m.url !== coverMeme.url)
    : freshMemes;
  while (bodyMemes.length < 2 && remainingMemes.length > 0) {
    const idx = Math.floor(Math.random() * remainingMemes.length);
    bodyMemes.push(remainingMemes[idx]);
    remainingMemes.splice(idx, 1);
  }

  // 4. 根据文章内容选择 stock photo（语义匹配）
  let stockPhotos = [];
  const stockNeeded = 2;
  try {
    // 分析文章主题，确定首选分类
    const topicRanking = analyzeTopic(articleText);
    const preferredCats = new Set(topicRanking.slice(0, 3).map(t => t[0]));
    if (preferredCats.size > 0) {
      console.log(`   📋 文章主题分析: ${topicRanking.slice(0, 3).map(t => `${t[0]}(${t[1]}次)`).join(', ')}`);
    }
    // 优先从匹配的分类中获取
    const stockItems = await fetchStockImages(usedUrls, stockNeeded, preferredCats);
    for (const item of stockItems) {
      stockPhotos.push(item);
    }
  } catch (_) {}

  console.log(`   🎨 配图方案：封面表情包 ${coverMeme ? 1 : 0}张 + 正文表情包 ${bodyMemes.length}张 + stock photo ${stockPhotos.length}张`);

  return { coverMeme, bodyMemes, stockPhotos };
}

/**
 * 下载所有配图到本地
 */
async function downloadAllImages(coverMeme, bodyMemes, stockPhotos) {
  const results = { coverPath: null, bodyPaths: [], stockPaths: [] };

  if (!fs.existsSync(IMAGE_DIR)) {
    fs.mkdirSync(IMAGE_DIR, { recursive: true });
  }

  // 下载封面表情包 → 缩放为 900×383
  if (coverMeme) {
    const coverPath = path.resolve(IMAGE_DIR, 'cover_original.jpg');
    const downloaded = await downloadImage(coverMeme.url, coverPath);
    if (downloaded) {
      try {
        const coverFinalPath = path.resolve(IMAGE_DIR, 'cover.jpg');
        await sharp(downloaded)
          .resize(900, 383, { fit: 'cover', position: 'center' })
          .jpeg({ quality: 85 })
          .toFile(coverFinalPath);
        results.coverPath = coverFinalPath;
        console.log(`   ✅ 封面表情包已缩放: 900×383`);
        // 清理原始文件
        try { fs.unlinkSync(downloaded); } catch (_) {}
      } catch (err) {
        console.warn(`   ⚠️  封面缩放失败: ${err.message}`);
      }
    }
  }

  // 下载正文表情包
  for (let i = 0; i < bodyMemes.length; i++) {
    const p = path.resolve(IMAGE_DIR, `meme_${i + 1}.jpg`);
    const downloaded = await downloadImage(bodyMemes[i].url, p);
    if (downloaded) {
      try {
        // 适当缩放，保持比例
        await sharp(downloaded)
          .resize(600, null, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toFile(p.replace('.jpg', '_resized.jpg'));
        results.bodyPaths.push(p.replace('.jpg', '_resized.jpg'));
      } catch (_) {
        results.bodyPaths.push(downloaded);
      }
    }
  }

  // 下载 stock photo
  for (let i = 0; i < stockPhotos.length; i++) {
    const item = stockPhotos[i];
    const p = path.resolve(IMAGE_DIR, `stock_${i + 1}.jpg`);
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
    };
    try {
      const ac = new AbortController();
      const timeout = setTimeout(() => ac.abort(), 20000);
      const res = await fetch(item.url, { signal: ac.signal, headers, timeout: 20000, follow: 5 });
      clearTimeout(timeout);
      if (res.ok) {
        const buffer = await res.buffer();
        await sharp(buffer)
          .resize(800, 450, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 88 })
          .toFile(p);
        results.stockPaths.push({ path: p, desc: item.desc });
      }
    } catch (_) {}
  }

  console.log(`   ✅ 下载完成: 封面 ${results.coverPath ? 1 : 0}张, 正文表情包 ${results.bodyPaths.length}张, stock photo ${results.stockPaths.length}张`);
  return results;
}

// ──────────────────────────────────────────────────────
// HTML 构建（v7 版 — 适配三栏目的通用排版）
// ──────────────────────────────────────────────────────
// 格式化工具：将 **bold** 转为 HTML <strong>，同时转义其他内容
// ──────────────────────────────────────────────────────
function formatWithBold(text) {
  const markers = {};
  let idx = 0;
  // Handle **text**
  let result = text.replace(/\*\*([^*]+)\*\*/g, (_, content) => {
    const key = '%%B' + (idx++) + '%%';
    markers[key] = content;
    return key;
  });
  // Handle __text__
  result = result.replace(/__([^_]+)__/g, (_, content) => {
    const key = '%%B' + (idx++) + '%%';
    markers[key] = content;
    return key;
  });
  // Escape XML
  result = escapeXml(result);
  // Restore bold markers
  for (const [key, content] of Object.entries(markers)) {
    result = result.split(key).join('<strong>' + escapeXml(content) + '</strong>');
  }
  return result;
}

/**
 * 构建文章 HTML（v7 科技通信风 · 亮色调）
 * 排版元素：
 *   - 渐变顶条 + 栏目标签 + 金色分割线
 *   - 左蓝色竖线小标题
 *   - 蓝色数据高亮卡
 *   - 浅金句区
 *   - 暖色调要点框
 *   - 蓝色渐变互动区
 *   - 品牌CTA底部
 * 全文使用 inline style 适配微信公众号
 */
function buildArticleHtml(title, rawText, wxMemeUrls, wxStockUrls, columnName) {
  const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  let html = '';
  let memeIdx = 0;
  let stockIdx = 0;

  const maxBodyMemes = Math.min(wxMemeUrls?.length || 0, 2);
  const maxStocks = Math.min(wxStockUrls?.length || 0, 2);

  const colTag = columnName || ACCOUNT_NAME;
  const colTagStyle = colTag === '烽向标'
    ? 'background:linear-gradient(135deg,#1a365d,#2d3748);'
    : 'background:linear-gradient(135deg,#1a365d,#2b6cb0);';

  // ── 标题区 ──
  html += `<div style="text-align:center;padding:28px 0 14px;position:relative;">`;
  // 渐变顶条
  html += `<div style="position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,#1a365d,#c5a55a,#1a365d);"></div>`;
  // 栏目标签
  html += `<span style="display:inline-block;padding:3px 14px;${colTagStyle}color:#fff;font-size:11px;font-weight:600;border-radius:12px;letter-spacing:1px;margin-bottom:14px;">${escapeXml(colTag)}</span>`;
  // 标题
  html += `<h1 style="font-size:21px;font-weight:700;color:#1a2332;line-height:1.55;margin:0 0 10px;letter-spacing:0.3px;">${escapeXml(title)}</h1>`;
  // 元信息
  const today = new Date();
  html += `<div style="font-size:12px;color:#94a3b8;display:flex;align-items:center;justify-content:center;gap:8px;">`;
  html += `<span>${ACCOUNT_NAME}</span>`;
  html += `<span style="width:3px;height:3px;border-radius:50%;background:#cbd5e1;display:inline-block;"></span>`;
  html += `<span>${today.toLocaleDateString('zh-CN')}</span>`;
  html += `</div>`;
  // 分割线
  html += `<div style="width:48px;height:3px;background:linear-gradient(90deg,#1a365d,#c5a55a);border-radius:2px;margin:12px auto 0;"></div>`;
  html += `</div>\n`;

  // ── 正文 ──
  let paragraphCount = 0;
  let insideDataCard = false;
  let insideQuoteBox = false;
  let insideGoldQuote = false;
  let insideKeyPoint = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 跳过纯分隔线
    if (/^-{3,}$/.test(line)) continue;
    if (/^📡/.test(line)) continue;

    paragraphCount++;

    // ── 配图插入（在段落间） ──
    if (paragraphCount > 0 && (paragraphCount % Math.max(Math.floor(lines.length / 3), 1) === 0)) {
      if (memeIdx < maxBodyMemes && wxMemeUrls[memeIdx]) {
        html += `<div style="text-align:center;margin:1.2em 0;"><img src="${wxMemeUrls[memeIdx]}" alt="" style="max-width:80%;border-radius:8px;display:inline-block;box-shadow:0 2px 8px rgba(0,0,0,0.06);" /></div>\n`;
        memeIdx++;
      } else if (stockIdx < maxStocks && wxStockUrls[stockIdx]) {
        html += `<div style="text-align:center;margin:1.2em 0;"><img src="${wxStockUrls[stockIdx]}" alt="" style="width:100%;border-radius:8px;display:block;box-shadow:0 2px 8px rgba(0,0,0,0.06);" /></div>\n`;
        stockIdx++;
      }
    }

    // ── 段落类型检测 ──

    // 数据高亮卡：[数据: xxx]
    const dataMatch = line.match(/^\[数据[：:]\s*(.+?)\s*[|丨]\s*(.+)$/);
    if (dataMatch) {
      html += `<div style="margin:1.2em 0;padding:16px 18px;background:linear-gradient(135deg,#f5f0eb,#efe8dd);border-radius:10px;border-left:3px solid #c5a55a;">`;
      html += `<div style="font-size:28px;font-weight:800;color:#1a365d;line-height:1.2;">${formatWithBold(dataMatch[1])}</div>`;
      html += `<div style="font-size:13px;color:#475569;margin-top:4px;line-height:1.6;">${formatWithBold(dataMatch[2])}</div>`;
      html += `</div>\n`;
      continue;
    }

    // 金句：✦ ...
    if (line.startsWith('✦') || line.startsWith('◆')) {
      html += `<div style="margin:1.5em 0;padding:18px 20px;text-align:center;background:linear-gradient(135deg,#faf6eb,#fdf8ee);border-radius:10px;border:1px solid #e8dcc8;">`;
      html += `<p style="font-size:16px;font-weight:600;color:#8b6914;line-height:1.8;margin:0;letter-spacing:0.5px;">${formatWithBold(line)}</p>`;
      html += `</div>\n`;
      continue;
    }

    // 引用：[引用] ...
    const quoteMatch = line.match(/^\[引用\](.+)/);
    if (quoteMatch) {
      html += `<div style="margin:1.2em 0;padding:14px 18px;background:#f8fafc;border-radius:8px;border-left:3px solid #c5a55a;">`;
      html += `<p style="font-size:14px;color:#475569;line-height:1.85;margin:0;font-style:italic;">${formatWithBold(quoteMatch[1])}</p>`;
      html += `</div>\n`;
      continue;
    }

    // 要点框：📌 或 【核心】
    if (line.startsWith('📌') || line.startsWith('【核心') || line.startsWith('【总结')) {
      html += `<div style="margin:1.2em 0;padding:14px 18px;background:linear-gradient(135deg,#fff8f0,#fff3e0);border-radius:8px;border-left:3px solid #c5a55a;">`;
      html += `<p style="font-size:14px;color:#3d2e1a;line-height:1.8;margin:0;">${formatWithBold(line)}</p>`;
      html += `</div>\n`;
      continue;
    }

    // 互动区：💬
    if (/^💬/.test(line)) {
      html += `<div style="margin:1.5em 0 1em 0;padding:16px 18px;background:linear-gradient(135deg,#f5f0eb,#efe8dd);border-radius:10px;">`;
      html += `<span style="display:inline-block;padding:2px 10px;background:#1a365d;color:#c5a55a;font-size:11px;font-weight:600;border-radius:4px;margin-bottom:8px;">💬 讨论</span>`;
      html += `<p style="font-size:14px;color:#1a2332;line-height:1.85;margin:0;">${formatWithBold(line.replace(/^💬\s*/, ''))}</p>`;
      html += `</div>\n`;
      continue;
    }

    // 来源标注：📎 —— 拆分为两行显示
    if (/^📎/.test(line)) {
      const srcParts = line.split(/(https?:\/\/[^\s）)]+)/);
      const srcLabel = srcParts[0]?.trim() || line;
      const srcUrl = srcParts[1]?.trim() || '';
      if (srcUrl) {
        html += `<p style="font-size:12px;color:#94a3b8;margin:0.3em 0 0.8em;padding-left:12px;border-left:2px solid #e2e8f0;">${escapeXml(srcLabel)}<br><span style="word-break:break-all;">${escapeXml(srcUrl)}</span></p>\n`;
      } else {
        html += `<p style="font-size:12px;color:#94a3b8;margin:0.3em 0 0.8em;padding-left:12px;border-left:2px solid #e2e8f0;">${escapeXml(line)}</p>\n`;
      }
      continue;
    }

    // 小标题：【】或 ##
    if (/^【.*】/.test(line) || line.startsWith('##')) {
      const sub = line.replace(/^##\s*/, '').replace(/^【([^】]+)】/, '$1');
      html += `<h2 style="font-size:17px;font-weight:700;color:#1a2332;margin:1.5em 0 0.6em;line-height:1.5;padding-left:14px;position:relative;">`;
      html += `<span style="position:absolute;left:0;top:4px;bottom:4px;width:3px;background:linear-gradient(180deg,#1a365d,#c5a55a);border-radius:2px;display:inline-block;"></span>`;
      html += `${formatWithBold(sub)}</h2>\n`;
      continue;
    }

    // 普通段落
    // 首段加大字号
    const pStyle = paragraphCount === 1
      ? 'font-size:16px;color:#1a2332;font-weight:500;'
      : 'font-size:15px;color:#334155;';
    html += `<p style="margin:0.75em 0;${pStyle}line-height:1.9;letter-spacing:0.2px;">${formatWithBold(line)}</p>\n`;
  }

  // ── 底部CTA ──
  html += `<div style="margin-top:2em;padding:24px 20px;text-align:center;background:linear-gradient(135deg,#1a2332,#2d3748);border-radius:12px;">`;
  html += `<p style="font-size:16px;font-weight:700;color:#c5a55a;letter-spacing:2px;margin:0 0 4px;">${ACCOUNT_NAME}</p>`;
  html += `<div style="width:24px;height:2px;background:#c5a55a;margin:10px auto;border-radius:1px;"></div>`;
  html += `<p style="font-size:12px;color:#94a3b8;letter-spacing:1px;margin:0 0 12px;">通信行业观察与技术笔记</p>`;
  html += `<p style="font-size:12px;color:#64748b;line-height:1.6;margin:0;">欢迎在微信搜索「${ACCOUNT_NAME}」关注</p>`;
  html += `<p style="font-size:11px;color:#475569;margin:8px 0 0;">觉得有帮助可以点个在看，让更多同行看到</p>`;
  html += `</div>\n`;

  return html;
}

// ──────────────────────────────────────────────────────
// 微信 API
// ──────────────────────────────────────────────────────

async function getWxToken() {
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${WX_APPID}&secret=${WX_APPSECRET}`;
  const res  = await fetch(url);
  const data = await res.json();
  if (data.errcode) throw new Error(`获取微信Token失败: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function uploadThumb(token) {
  const fileBuffer = fs.readFileSync(COVER_FILE);
  const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);
  const header = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="cover.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`);
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([header, fileBuffer, footer]);

  const res = await fetch(`https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${token}&type=thumb`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length },
    body
  });
  const data = await res.json();
  if (!data.media_id) throw new Error(`上传封面图失败: ${JSON.stringify(data)}`);
  console.log(`   封面图已上传（永久素材）: media_id=${data.media_id}`);
  return data.media_id;
}

async function addDraft(token, title, content, thumbMediaId, author = ACCOUNT_NAME, digest = '') {
  const url  = `https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${token}`;
  const body = {
    articles: [{
      article_type: 'news', title, author, content,
      digest: digest || '',
      content_source_url: '', thumb_media_id: thumbMediaId,
      need_open_comment: 1, only_fans_can_comment: 0, copyright_type: 11
    }]
  };
  const res  = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (data.errcode && data.errcode !== 0) {
    if (String(data.errcode) === '40004' || (data.errmsg && data.errmsg.includes('copyright'))) {
      console.log('   ⚠️  原创标签字段不支持，创建不带原创的草稿...');
      body.articles[0].copyright_type = undefined;
      const res2 = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data2 = await res2.json();
      if (data2.errcode && data2.errcode !== 0) throw new Error(`创建草稿失败: ${JSON.stringify(data2)}`);
      return data2.media_id;
    }
    throw new Error(`创建草稿失败: ${JSON.stringify(data)}`);
  }
  return data.media_id;
}

async function publishDraft(token, mediaId) {
  const res = await fetch(`https://api.weixin.qq.com/cgi-bin/freepublish/submit?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ media_id: mediaId })
  });
  const data = await res.json();
  if (data.errcode === 48001) {
    console.log('   ⚠️  自动发布需要已认证的服务号，草稿已保存到公众号后台');
    console.log('   📌 请登录 mp.weixin.qq.com → 草稿箱 → 手动点击发布');
    return data;
  }
  if (data.errcode && data.errcode !== 0) throw new Error(`发布失败: ${JSON.stringify(data)}`);
  return data;
}

/**
 * 上传配图到微信（media/uploadimg 返回永久URL）
 */
async function uploadImageToWx(token, filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const ext = path.extname(filePath).toLowerCase();
  const contentType = ext === '.gif' ? 'image/gif' : 'image/jpeg';
  const fileBuffer = fs.readFileSync(filePath);

  const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);
  const header = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="img${ext}"\r\nContent-Type: ${contentType}\r\n\r\n`
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([header, fileBuffer, footer]);

  try {
    const res = await fetch(`https://api.weixin.qq.com/cgi-bin/media/uploadimg?access_token=${token}`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      },
      body,
      timeout: 30000
    });
    const data = await res.json();
    if (data.url) return data.url;
    console.warn(`   ⚠️  图片上传返回异常: ${JSON.stringify(data)}`);
    return null;
  } catch (err) {
    console.warn(`   ⚠️  图片上传失败: ${err.message}`);
    return null;
  }
}

// ──────────────────────────────────────────────────────
// DeepSeek API
// ──────────────────────────────────────────────────────

async function callDeepSeek(messages, temperature = 0.85) {
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), 120000);
  try {
    const res = await fetch(`${DEEPSEEK_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_KEY}` },
      body: JSON.stringify({ model: 'deepseek-chat', messages, temperature, max_tokens: 4096 }),
      signal: ac.signal
    });
    const data = await res.json();
    if (!data.choices || !data.choices[0]) throw new Error(`DeepSeek 失败: ${JSON.stringify(data)}`);
    return data.choices[0].message.content.trim();
  } finally { clearTimeout(timeout); }
}

/**
 * 标题工厂：生成3个候选标题
 */
async function generateTitleCandidates(articleContent, columnName) {
  const prompt = `你是一个公众号主编。以下是一篇即将发布的"${columnName}"栏目文章的内容。请为这篇文章设计3个候选标题。

要求：
1. 每个标题要有爆款潜质——要么有悬念、要么有冲突、要么有价值暗示
2. 长度控制在15-25字之间
3. 3个标题要有不同风格（如：悬念型、观点型、数据型）
4. 不要用"揭秘"、"震惊"等烂大街词汇

文章内容（摘要）：
${articleContent.substring(0, 800)}

请只输出3个标题，每个一行，不要序号，不要额外说明。`;

  const result = await callDeepSeek([
    { role: 'system', content: '你是一个精通微信公众号标题设计的专家。输出格式：每行一个标题，不要序号。' },
    { role: 'user', content: prompt }
  ], 0.9);

  const titles = result.split('\n').map(l => l.replace(/^\d+[.、\s]*/, '').replace(/^[""「」]|[""」」]$/g, '').trim()).filter(Boolean);
  return titles.slice(0, 3);
}

// ──────────────────────────────────────────────────────
// 主流程
// ──────────────────────────────────────────────────────

async function main() {
  const state = loadState();

  // ── 1. 检测今天是否推送日 ──
  const forceCol = process.env.FORCE_COLUMN;
  const column = forceCol
    ? (Object.values(COLUMN_MAP).find(c => c.key === forceCol) || getTodayColumn())
    : getTodayColumn();
  if (!column) {
    const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const todayName = days[new Date().getDay()];
    console.log(`\n📅 今天是 ${todayName}（休息日），不推送`);
    console.log('   推送日为 周一至周六：龙虎斗→绣花针→烽向标→龙虎斗→绣花针→烽向标');
    return;
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`[${new Date().toLocaleString('zh-CN')}] 「${ACCOUNT_NAME}」${column.name} 任务启动`);
  console.log(`   栏目：${column.name} | 模式：${column.style}`);
  console.log('='.repeat(50));

  const recentTitles = state.recent_titles || [];
  const DRY_RUN = process.env.DRY_RUN === '1';

  // ── 2. 如果需要新闻，抓取新闻 ──
  let newsText = '';
  let newsArticles = [];
  if (column.needNews) {
    console.log('\n📰 从多渠道抓取行业新闻（C114 + 东方财富 + 原文配图）...');
    const newsResult = await fetchAllNews();
    newsText = newsResult.text || '';
    newsArticles = newsResult.articles || [];
    const newsCount = newsText.split('\n').filter(l => l.trim()).length;
    const imgCount = newsArticles.filter(a => a.coverImage).length;
    console.log(`   ✅ 抓取到 ${newsCount} 条新闻，其中 ${imgCount} 条有原文配图`);
  }

  // ── 3. 选择 System Prompt ──
  let systemPrompt;
  switch (column.key) {
    case 'longhudou':
      systemPrompt = LONGHUDOU_SYSTEM;
      break;
    case 'xiuhuazhen':
      systemPrompt = XIUHUAZHEN_SYSTEM;
      break;
    case 'fengxiangbiao':
      systemPrompt = FENGXIANGBIAO_SYSTEM;
      break;
    default:
      throw new Error(`未知栏目: ${column.key}`);
  }

  console.log(`\n✍️ AI 生成文章（${column.name}）...`);

  // 构造 user prompt
  let userPrompt = `请写一篇「${column.name}」栏目的文章。\n\n`;
  if (column.needNews && newsText) {
    userPrompt += `以下是今日最新的新闻素材：\n${newsText}\n\n`;
  }
  userPrompt += `📅 今天的日期：${new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}\n\n`;
  userPrompt += `⚠️ 近期已发布标题，不可重复：\n${(recentTitles || []).map(t => `- ${t}`).join('\n')}\n\n`;
  // 烽向标专用：注入上次已报道的新闻关键词，避免内容重复
  if (column.key === 'fengxiangbiao' && state.recent_news_keys && state.recent_news_keys.length > 0) {
    userPrompt += `⚠️ 以下是上次烽向标已报道过的新闻关键词，本次必须选择不同的新闻，不得重复选题：\n${state.recent_news_keys.map(k => `- ${k}`).join('\n')}\n\n`;
  }
  userPrompt += `请开始写作。直接输出文章正文，不要输出"标题："等额外标记。`;

  const articleRaw = await callDeepSeek([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ], 0.85);

  // 提取标题
  const storyLines = articleRaw.split('\n').map(l => l.trim()).filter(Boolean);
  const rawTitle = storyLines[0] || '';
  let title = sanitizeTitle(cleanTitle(rawTitle)).substring(0, 64);

  // 如果标题不合适，从文章第一句提取
  if (!title || title.length < 4) {
    const firstLine = storyLines.find(l => l.length > 5 && !l.startsWith('```'));
    if (firstLine) title = sanitizeTitle(cleanTitle(firstLine)).substring(0, 64);
  }

  const articleBody = cleanBodyText(articleRaw, rawTitle);
  console.log(`   ✅ 文章生成完成，标题：《${title}》`);

  // ── 4. 标题工厂：生成候选标题 ──
  console.log('\n🏭 标题工厂：生成候选标题...');
  let titleCandidates = [title];
  try {
    const candidates = await generateTitleCandidates(articleRaw, column.name);
    if (candidates && candidates.length > 0) {
      titleCandidates = [...new Set([title, ...candidates])].slice(0, 3);
      console.log(`   候选标题：`);
      titleCandidates.forEach((t, i) => console.log(`     ${i === 0 ? '★ 原始' : '  '} 标题${i + 1}: ${t}`));
    }
  } catch (err) {
    console.warn(`   ⚠️  标题工厂失败: ${err.message}，使用原标题`);
  }

  // ── 5. 选择配图 ──
  // 烽向标栏目：使用新闻原文配图（替代 Pexels 图库图）
  let newsImageUrls = []; // 每条新闻绑定的原文配图 URL
  let newsImagePaths = []; // 下载到本地的配图路径
  let coverMeme = null;
  let bodyMemes = [];
  let stockPhotos = [];
  let downloaded = { coverPath: null, bodyPaths: [], stockPaths: [] };

  if (column.key === 'fengxiangbiao' && newsArticles.length > 0) {
    console.log('\n🎨 烽向标配图：匹配新闻原文配图...');
    newsImageUrls = matchNewsImages(articleBody, newsArticles);
    const matchedCount = newsImageUrls.filter(u => u).length;
    console.log(`   ✅ 匹配到 ${matchedCount}/${newsImageUrls.length} 条新闻的原文配图`);

    // 下载原文配图到本地
    console.log('\n📥 下载新闻原文配图...');
    newsImagePaths = await downloadNewsImages(newsImageUrls);

    // 封面仍用 Pexels（原文配图作为正文配图，封面单独处理）
    console.log('\n🎨 封面配图系统启动...');
    const coverResult = await selectHybridImages(articleBody, state);
    coverMeme = coverResult.coverMeme;
    // 下载封面
    if (coverMeme) {
      const coverDownloaded = await downloadAllImages(coverMeme, [], []);
      downloaded = coverDownloaded;
    } else {
      downloaded = { coverPath: null, bodyPaths: [], stockPaths: [] };
    }
  } else {
    console.log('\n🎨 配图系统启动（混合方案）...');
    const hybridResult = await selectHybridImages(articleBody, state);
    coverMeme = hybridResult.coverMeme;
    bodyMemes = hybridResult.bodyMemes;
    stockPhotos = hybridResult.stockPhotos;

    // ── 6. 下载配图 ──
    console.log('\n📥 下载配图...');
    downloaded = await downloadAllImages(coverMeme, bodyMemes, stockPhotos);
  }

  // ── 7. 发布前质量检查 ──
  console.log('\n🔍 发布前质量检查...');
  let validationPassed = true;

  // 7a. 检查标题：无 emoji、无特殊字符
  const titleCleanCheck = title.replace(/[\u{1F000}-\u{1FFFF}]/gu, '').replace(/[@#$%&*]/g, '');
  if (titleCleanCheck !== title) {
    console.warn(`   ⚠️  标题包含特殊字符，已自动清理: "${title}" → "${titleCleanCheck}"`);
    title = titleCleanCheck;
  }

  // 7b. 检查正文：无残留 markdown 标记（全面检查，除了 --- 分隔线外不应有任何 markdown 语法）
  const htmlTagsInBody = (articleBody.match(/<\/?[a-z]+[^>]*>/gi) || []).length;
  if (htmlTagsInBody > 0) {
    console.warn(`   ⚠️  正文发现 ${htmlTagsInBody} 处 HTML 标签残留，将在 cleanBodyText 中清理`);
  }
  const mdInBody = (articleBody.match(/\*\*|\*|__|%%B\d+%%|`|~~|^>\s|^[-*+]\s|^\d+[.、]/gm) || []).length;
  if (mdInBody > 0) {
    console.warn(`   ⚠️  正文发现 ${mdInBody} 处 markdown 残留标记，已在 cleanBodyText 中全面清理`);
  }

  // 7c. 检查封面：至少有方案尝试过
  if (downloaded.coverPath || downloaded.stockPaths.length > 0) {
    console.log(`   ✅ 封面素材就绪`);
  } else {
    console.log(`   ℹ️  封面素材缺失，将使用品牌封面模板`);
  }

  // 7d. 检查配图数量
  if (column.key === 'fengxiangbiao' && newsImageUrls.length > 0) {
    const matchedCount = newsImageUrls.filter(u => u).length;
    console.log(`   ℹ️  烽向标新闻原文配图: ${matchedCount}/${newsImageUrls.length} 张`);
  } else {
    const totalImages = downloaded.bodyPaths.filter(Boolean).length + downloaded.stockPaths.length;
    console.log(`   ℹ️  配图: ${downloaded.bodyPaths.filter(Boolean).length}张表情包 + ${downloaded.stockPaths.length}张 stock photo`);
  }

  console.log(`   ✅ 质量检查完成，${validationPassed ? '继续推送' : '推送终止'}`);

  // ── 8. 推送到微信 ──
  if (DRY_RUN) {
    console.log('\n🔍 [DRY RUN 模式] 跳过微信推送');
    // DRY_RUN 路径：也组装烽向标的完整标题，供预览用
    let dryRunTitle = titleCandidates[0] || title;
    let dryRunDigest = '';
    if (column.key === 'fengxiangbiao') {
      const now = new Date();
      const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
      const subTitle = titleCandidates.find(t => !/^\s*烽向标\s+\d{4}年/.test(t) && t !== title) || titleCandidates[1] || '';
      const cleanSub = subTitle
        ? subTitle.replace(/[\u{1F000}-\u{1FFFF}]/gu, '').replace(/[@#$%&*^()+={\[}\]\\|;"'<>~`！@#￥%……&*（）+\-={}【】《》「」『』︿〝〞‵′″]/g, '').trim()
        : '';
      dryRunTitle = cleanSub
        ? `烽向标 ${dateStr}：${cleanSub}`.substring(0, 64)
        : `烽向标 ${dateStr}`;
      dryRunDigest = cleanSub || '';
    }

    console.log(`   栏目：${column.name}`);
    console.log(`   标题：《${dryRunTitle}》`);
    if (dryRunDigest) console.log(`   简介：${dryRunDigest}`);
    console.log(`   候选标题：`);
    titleCandidates.forEach((t, i) => console.log(`     ${i + 1}. ${t}`));
    console.log(`   封面：${coverMeme ? coverMeme.url.substring(0, 60) + '...' : '无'}`);
    if (column.key === 'fengxiangbiao') {
      const matchedCount = newsImageUrls.filter(u => u).length;
      console.log(`   新闻原文配图：${matchedCount}/${newsImageUrls.length} 张`);
    } else {
      console.log(`   正文表情包：${bodyMemes.length}张`);
      console.log(`   Stock photo：${stockPhotos.length}张`);
    }

    // 生成预览 HTML
    // DRY_RUN 模式用本地路径占位
    const fakeMemeUrls = downloaded.bodyPaths.map(p => p || '');
    const fakeStockUrls = downloaded.stockPaths.map(s => s.path || '');

    let previewHtml;
    if (column.key === 'fengxiangbiao') {
      // 烽向标：优先使用新闻原文配图（本地路径），降级使用 stock photo
      const newsLocalUrls = newsImagePaths.filter(Boolean).length > 0
        ? newsImagePaths.map(p => p ? path.resolve(p).replace(/\\/g, '/') : null)
        : null;
      previewHtml = buildBriefHtml(articleBody, fakeStockUrls, title, newsLocalUrls, dryRunDigest || subTitle || '');
    } else {
      previewHtml = buildArticleHtml(title, articleBody, fakeMemeUrls, fakeStockUrls, column.name);
    }

    const fullHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>${escapeXml(title)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #f2f2f2;
    padding: 0;
    font-family: -apple-system, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .article {
    max-width: 640px;
    margin: 0 auto;
    background: #ffffff;
    min-height: 100vh;
  }
  .article-inner { padding: 20px 18px 30px; }
  img { max-width: 100%; border-radius: 4px; display: block; margin: 0 auto; }
  .img-wrap { text-align: center; margin: 1em 0; }
  @media (min-width: 641px) {
    .article { border-radius: 0; box-shadow: none; }
  }
</style>
</head>
<body>
<div class="article">
<div class="article-inner">
  <div style="padding:6px 12px;background:#1a365d;color:#c5a55a;font-size:12px;border-radius:4px;display:inline-block;margin-bottom:8px;">${escapeXml(column.name)}</div>
  ${previewHtml}
  <div style="margin-top:2em;padding:14px;text-align:center;background:#f8f9fb;border-radius:8px;border:1px solid #e8ecf1;">
    <p style="font-size:13px;color:#94a3b8;">💡 DRY RUN 预览 — 正式推送将去除本提示</p>
  </div>
</div>
</div>
</body>
</html>`;

    const outputPath = path.resolve(__dirname, 'preview_output.html');
    fs.writeFileSync(outputPath, fullHtml, 'utf8');
    console.log(`\n   ✅ 预览文件: ${outputPath}`);
    console.log(`   📌 请在浏览器中打开查看效果`);

    // 输出候选标题供用户选择
    console.log(`\n${'='.repeat(50)}`);
    console.log('📋 候选标题列表：');
    titleCandidates.forEach((t, i) => console.log(`   ${i + 1}. ${t}`));
    console.log('='.repeat(50));
    console.log('\n💡 确认标题后，去掉 DRY_RUN=1 即可正式推送');
    console.log('   也可手动修改 titleCandidates 数组顺序来选择首选标题');

  } else {
    // ── 正式推送 ──
    // 1. 组装最终标题
    // 烽向标栏目：格式为 "烽向标 YYYY年M月D日：副标题"
    // 副标题 = 标题工厂生成的第1个候选（排除原始 AI 标题）
    let finalTitle;
    let articleDigest = ''; // 微信草稿简介字段
    if (column.key === 'fengxiangbiao') {
      const now = new Date();
      const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
      const subTitle = titleCandidates.find(t => !/^\s*烽向标\s+\d{4}年/.test(t) && t !== title) || titleCandidates[1] || '';
      // 烽向标标题只清 emoji，保留中文标点（问号、冒号等），不走 sanitizeTitle
      const cleanSub = subTitle
        ? subTitle.replace(/[\u{1F000}-\u{1FFFF}]/gu, '').replace(/[@#$%&*^()+={\[}\]\\|;"'<>~`！@#￥%……&*（）+\-={}【】《》「」『』︿〝〞‵′″]/g, '').trim()
        : '';
      finalTitle = cleanSub
        ? `烽向标 ${dateStr}：${cleanSub}`.substring(0, 64)
        : `烽向标 ${dateStr}`;
      articleDigest = cleanSub || '';
    } else {
      finalTitle = titleCandidates[0] || title;
    }

    // 2. 获取微信Token
    console.log('\n🔑 获取微信 access_token...');
    const token = await getWxToken();

    // 3. 上传正文配图到微信
    const wxMemeUrls = [];
    for (const p of downloaded.bodyPaths) {
      if (p) {
        const url = await uploadImageToWx(token, p);
        if (url) wxMemeUrls.push(url);
      }
    }
    const wxStockUrls = [];
    for (const s of downloaded.stockPaths) {
      if (s.path) {
        const url = await uploadImageToWx(token, s.path);
        if (url) wxStockUrls.push(url);
      }
    }

    // 3b. 烽向标：上传新闻原文配图到微信
    let wxNewsImageUrls = null;
    if (column.key === 'fengxiangbiao' && newsImagePaths.filter(Boolean).length > 0) {
      console.log('\n📤 上传新闻原文配图到微信...');
      wxNewsImageUrls = [];
      for (let i = 0; i < newsImagePaths.length; i++) {
        if (newsImagePaths[i]) {
          const url = await uploadImageToWx(token, newsImagePaths[i]);
          wxNewsImageUrls.push(url);
          console.log(`   ✅ 新闻配图 ${i + 1}: 已上传`);
        } else {
          wxNewsImageUrls.push(null);
          console.log(`   ⚠️  新闻配图 ${i + 1}: 无配图`);
        }
      }
    }

    // 4. 构建HTML
    console.log('\n📝 构建文章HTML...');
    let articleHtml;
    if (column.key === 'fengxiangbiao') {
      articleHtml = buildBriefHtml(articleBody, wxStockUrls, finalTitle, wxNewsImageUrls, articleDigest || '');
    } else {
      articleHtml = buildArticleHtml(finalTitle, articleBody, wxMemeUrls, wxStockUrls, column.name);
    }

    // 5. 处理封面（优先级：表情包 > stock photo > 品牌SVG）
    console.log('🖼️  处理封面...');
    let thumbMediaId;
    let coverReady = false;

    if (downloaded.coverPath) {
      // 方案1: 使用表情包封面
      fs.copyFileSync(downloaded.coverPath, COVER_FILE);
      thumbMediaId = await uploadThumb(token);
      try { fs.unlinkSync(COVER_FILE); } catch (_) {}
      coverReady = true;
    }

    if (!coverReady && downloaded.stockPaths.length > 0) {
      // 方案2: 使用第一张 stock photo 缩放为封面
      try {
        const stockPath = downloaded.stockPaths[0].path;
        console.log('   ℹ️  用 stock photo 缩放为封面');
        await sharp(stockPath)
          .resize(900, 383, { fit: 'cover', position: 'center' })
          .jpeg({ quality: 85 })
          .toFile(COVER_FILE);
        thumbMediaId = await uploadThumb(token);
        try { fs.unlinkSync(COVER_FILE); } catch (_) {}
        coverReady = true;
      } catch (_) {
        console.log('   ⚠️  stock photo 缩放失败');
      }
    }

    if (!coverReady) {
      // 方案3: 品牌 SVG 封面模板兜底
      console.log('   ℹ️  使用品牌封面模板');
      const displayTitle = finalTitle.length > 14 ? finalTitle.substring(0, 14) + '…' : finalTitle;
      const columnTag = column.name;
      const svg = Buffer.from(`<svg width="900" height="383" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#1a365d"/>
            <stop offset="50%" style="stop-color:#2b6cb0"/>
            <stop offset="100%" style="stop-color:#1a365d"/>
          </linearGradient>
          <linearGradient id="gold" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" style="stop-color:#d4af37"/>
            <stop offset="100%" style="stop-color:#f0d060"/>
          </linearGradient>
        </defs>
        <rect width="900" height="383" fill="url(#bg)"/>
        <!-- 装饰网格线 -->
        <g opacity="0.04">
          ${Array.from({length: 8}, (_, i) => `<line x1="0" y1="${i*50}" x2="900" y2="${i*50}" stroke="white" stroke-width="0.5"/>`).join('')}
          ${Array.from({length: 18}, (_, i) => `<line x1="${i*50}" y1="0" x2="${i*50}" y2="383" stroke="white" stroke-width="0.5"/>`).join('')}
        </g>
        <!-- 顶部标签 -->
        <rect x="50" y="40" width="80" height="26" rx="13" fill="url(#gold)"/>
        <text x="90" y="57" font-family="SimHei,Microsoft YaHei,sans-serif" font-size="12" fill="#1a365d" font-weight="bold" text-anchor="middle">${escapeXml(columnTag)}</text>
        <!-- 标题 -->
        <text x="50" y="190" font-family="SimHei,Microsoft YaHei,sans-serif" font-size="34" fill="white" font-weight="bold">${escapeXml(displayTitle)}</text>
        <!-- 装饰线 -->
        <rect x="50" y="210" width="60" height="3" rx="1.5" fill="url(#gold)"/>
        <!-- 底部 -->
        <text x="50" y="330" font-family="SimHei,Microsoft YaHei,sans-serif" font-size="13" fill="rgba(255,255,255,0.3)">${ACCOUNT_NAME} · 通信行业观察</text>
      </svg>`);
      await sharp(svg).jpeg({ quality: 88 }).toFile(COVER_FILE);
      thumbMediaId = await uploadThumb(token);
      try { fs.unlinkSync(COVER_FILE); } catch (_) {}
    }

    // 6. 创建草稿
    console.log('📝 创建草稿...');
    const mediaId = await addDraft(token, finalTitle, articleHtml, thumbMediaId, ACCOUNT_NAME, articleDigest);
    console.log(`   草稿 media_id: ${mediaId}`);

    // 7. 清理临时文件
    try {
      if (fs.existsSync(IMAGE_DIR)) {
        const files = fs.readdirSync(IMAGE_DIR);
        for (const f of files) {
          try { fs.unlinkSync(path.resolve(IMAGE_DIR, f)); } catch (_) {}
        }
        try { fs.rmdirSync(IMAGE_DIR); } catch (_) {}
      }
    } catch (_) {}

    // 8. 尝试自动发布
    console.log('🚀 尝试自动发布...');
    const pubResult = await publishDraft(token, mediaId);
    console.log('   发布结果：', JSON.stringify(pubResult));

    // 9. 更新状态
    state.push_count = (state.push_count || 0) + 1;
    state.last_push_date = new Date().toISOString();
    state.recent_titles = [finalTitle, ...(state.recent_titles || [])].slice(0, 10);

    // 烽向标专用：保存本次已报道的新闻关键词，用于下次去重
    if (column.key === 'fengxiangbiao' && newsArticles.length > 0) {
      // 从本次 AI 文章正文中提取新闻卡片标题作为关键词（---分隔的第一行）
      const bodyLines = articleBody.split('\n').map(l => l.trim()).filter(Boolean);
      const newsKeys = [];
      let afterSep = false;
      let blockFirstLine = '';
      for (const line of bodyLines) {
        if (/^-{3,}$/.test(line)) {
          if (blockFirstLine) {
            newsKeys.push(blockFirstLine.replace(/^事件(概述)?[：:]\s*/, '').substring(0, 30));
          }
          afterSep = true;
          blockFirstLine = '';
        } else if (afterSep && !blockFirstLine && line.length > 3) {
          blockFirstLine = line;
        }
      }
      if (blockFirstLine) newsKeys.push(blockFirstLine.replace(/^事件(概述)?[：:]\s*/, '').substring(0, 30));
      // 同时保存本次使用的原始新闻标题关键词
      const rawNewsKeys = newsArticles.slice(0, 30).map(a => a.title.substring(0, 20));
      state.recent_news_keys = [...new Set([...newsKeys, ...rawNewsKeys])].slice(0, 40);
    }

    // 记录已使用的配图URL
    const allUsed = new Set(state.used_image_urls || []);
    if (coverMeme) allUsed.add(coverMeme.url);
    for (const m of bodyMemes) allUsed.add(m.url);
    for (const s of stockPhotos) allUsed.add(s.url);
    state.used_image_urls = [...allUsed];
    state.image_pool = (state.image_pool || []).slice(0, 30);

    // 记录栏目类型
    state.last_column = column.key;
    state.title_candidates = titleCandidates;

    saveState(state);

    console.log(`\n✅ 第 ${state.push_count} 次推送完成！`);
    console.log(`   栏目：${column.name}`);
    console.log(`   标题：《${finalTitle}》`);
    if (column.key === 'fengxiangbiao' && wxNewsImageUrls) {
      const imgCount = wxNewsImageUrls.filter(Boolean).length;
      console.log(`   新闻原文配图：${imgCount}/${wxNewsImageUrls.length} 张`);
    } else {
      console.log(`   配图：${wxMemeUrls.length}张表情包 + ${wxStockUrls.length}张 stock photo`);
    }
    console.log(`   📌 请登录 mp.weixin.qq.com → 草稿箱 → 手动发布`);
  }
}

/**
 * 将 AI 生成的烽向标文章中的新闻标题与原始新闻列表匹配，提取每条新闻的原文配图
 * @param {string} articleBody - AI 生成的文章正文
 * @param {Array} newsArticles - 原始新闻列表 [{title, link, coverImage, source}]
 * @returns {Array} - 按文章中新闻出现顺序排列的配图 URL 数组（null 表示未匹配到）
 */
function matchNewsImages(articleBody, newsArticles) {
  if (!newsArticles || newsArticles.length === 0) return [];

  // 按 📎 原文链接行分割文章为新闻块
  // 正确逻辑：📎 行归属于其所在新闻块（作为该块的最后一行），遇到📎时先加入当前块再保存
  const lines = articleBody.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const blocks = [];
  let cur = [];
  for (const line of lines) {
    cur.push(line);
    if (line.startsWith('📎')) {
      if (cur.length > 0) { blocks.push(cur); cur = []; }
    }
  }
  if (cur.length > 0) blocks.push(cur);

  // 也要支持以 --- 分隔（兼容旧格式）
  if (blocks.length <= 1 && lines.some(l => /^-{3,}$/.test(l))) {
    // 退回到按 --- 分割
    const fallbackBlocks = [];
    let fbCur = [];
    for (const line of lines) {
      if (/^-{3,}$/.test(line)) {
        if (fbCur.length > 0) { fallbackBlocks.push(fbCur); fbCur = []; }
        continue;
      }
      fbCur.push(line);
    }
    if (fbCur.length > 0) fallbackBlocks.push(fbCur);
    // 跳过第一个块（标题/开头综述），其余为新闻块
    const newsBlocks = fallbackBlocks.slice(1).filter(b => b.length > 0 && !b[0].startsWith('💬'));
    return matchNewsBlocks(newsBlocks, newsArticles);
  }

  // 按 📎 分割：跳过第一个块（标题/开头综述），其余为新闻块
  // blocks[0] = 标题+综述（可能有 📎 链接引用，不是新闻块），必须跳过
  const newsBlocks = blocks.slice(1).filter(b => b.length > 0 && !b[0].startsWith('💬') && b.some(l => l.startsWith('📎')));
  // 如果没有 📎 锚点，说明文章没有标准新闻块结构
  if (newsBlocks.length === 0) {
    console.log('   ⚠️  未检测到 📎 标记的新闻块，无法匹配原文配图');
    return [];
  }

  return matchNewsBlocks(newsBlocks, newsArticles);
}

/**
 * 将新闻块与新闻文章匹配，返回配图 URL 数组
 */
function matchNewsBlocks(newsBlocks, newsArticles) {
  function normalizeUrl(u) {
    if (!u) return '';
    return u.replace(/\/$/, '')  // 去尾部斜杠
            .replace(/^http:\/\//, 'https://')  // 统一 https
            .replace(/\/\//g, '/')  // 去双斜杠
            .replace(/https:\/\/www\./, 'https://');  // 去 www（统一处理）
  }
  const urlMap = new Map(); // 归一化URL → info
  const titleMap = new Map(); // title → {coverImage, source}
  for (const news of newsArticles) {
    if (news.coverImage && news.link) {
      const info = { coverImage: news.coverImage, title: news.title, source: news.source };
      urlMap.set(normalizeUrl(news.link), info);
      // 也存 www 和无 www 两个版本
      if (news.link.includes('://www.')) {
        urlMap.set(normalizeUrl(news.link.replace('://www.', '://')), info);
      } else {
        urlMap.set(normalizeUrl(news.link.replace('://', '://www.')), info);
      }
      // 按标题去重存储（多个来源同标题只保留第一个有图的）
      if (news.title && !titleMap.has(news.title)) {
        titleMap.set(news.title, info);
      }
    }
  }

  const matchLog = [];
  const result = [];
  for (let bi = 0; bi < newsBlocks.length; bi++) {
    const block = newsBlocks[bi];
    let matchedImage = null;
    let matchedBy = 'none';

    const blockText = block.join('');
    const firstPara = block[0] || '';

    // ───── 策略1：标题精确匹配（最强信号） ─────
    // 如果新闻块首段直接包含某篇文章的完整标题，100% 命中
    for (const [title, info] of titleMap) {
      if (title.length >= 5 && blockText.includes(title)) {
        matchedImage = info.coverImage;
        matchedBy = `title_exact:「${title}」`;
        break;
      }
    }

    // ───── 策略2：📎 URL 匹配（支持两行格式：📎 原文链接: + 下行URL） ─────
    if (!matchedImage) {
      const srcIdx = block.findIndex(l => l.startsWith('📎'));
      if (srcIdx >= 0) {
        // 尝试从 📎 行本身提取URL
        let rawUrl = null;
        const srcLine = block[srcIdx];
        let urlMatch = srcLine.match(/(https?:\/\/[^\s）)]+)/);
        if (urlMatch) {
          rawUrl = urlMatch[1];
        } else if (srcIdx + 1 < block.length) {
          // 也尝试从下一行提取URL
          urlMatch = block[srcIdx + 1].match(/(https?:\/\/[^\s）)]+)/);
          if (urlMatch) rawUrl = urlMatch[1];
        }
        if (rawUrl) {
          const normUrl = normalizeUrl(rawUrl);
          // 精确查找归一化URL
          if (urlMap.has(normUrl)) {
            matchedImage = urlMap.get(normUrl).coverImage;
            matchedBy = `url_exact:${normUrl.substring(0, 60)}`;
          } else {
            // 模糊URL匹配：用路径最后一段（文件名/ID）匹配
            const lastSeg = normUrl.substring(normUrl.lastIndexOf('/') + 1);
            if (lastSeg.length > 5) {
              for (const [articleNormUrl, info] of urlMap) {
                if (articleNormUrl.endsWith('/' + lastSeg)) {
                  matchedImage = info.coverImage;
                  matchedBy = `url_fuzzy_seg:${lastSeg}`;
                  break;
                }
              }
            }
          }
        }
      }
    }

    // ───── 策略3：标题子串匹配（比关键词更强，比精确标题弱） ─────
    // 从文章标题中提取5+字符的关键子串，看是否出现在块文本中
    if (!matchedImage) {
      let bestSeg = '';
      let bestImg = null;
      for (const [title, info] of titleMap) {
        // 提取标题中最长的2~3个连续中文字段作为匹配锚
        const segs = title.match(/[\u4e00-\u9fa5]{5,}/g);
        if (!segs) continue;
        for (const seg of segs) {
          if (seg.length >= 5 && blockText.includes(seg) && seg.length > bestSeg.length) {
            bestSeg = seg;
            bestImg = info.coverImage;
          }
        }
      }
      if (bestImg) {
        matchedImage = bestImg;
        matchedBy = `title_substr:「${bestSeg}」`;
      }
    }

    // ───── 策略4：全文关键词加权匹配（改进版） ─────
    if (!matchedImage) {
      let bestScore = 0;
      let bestImage = null;
      let secondScore = 0;
      let bestTitle = '';
      for (const news of newsArticles) {
        if (!news.coverImage) continue;
        const keywords = news.title.match(/[\u4e00-\u9fa5]{2,}/g) || [];
        // 过滤单字和过于通用的词
        const significantKw = keywords.filter(k => k.length >= 2 && k !== '中国' && k !== '全球' && k !== '行业' && k !== '美国');
        let score = 0;
        for (const kw of significantKw) {
          if (blockText.includes(kw)) score += kw.length;
        }
        // 加权：完整标题子串额外加分
        for (const kw of significantKw) {
          if (kw.length >= 5 && blockText.includes(kw)) score += 3;
        }
        if (score > bestScore) {
          secondScore = bestScore;
          bestScore = score;
          bestImage = news.coverImage;
          bestTitle = news.title;
        } else if (score > secondScore) {
          secondScore = score;
        }
      }
      if (bestScore >= 8 && bestScore > secondScore * 1.8) {
        matchedImage = bestImage;
        matchedBy = `keyword_best:${bestScore}>(×1.8)次高${secondScore} 「${bestTitle.substring(0, 24)}」`;
      }
    }

    matchLog.push(`   📎 第${bi + 1}条新闻匹配: ${matchedBy}`);
    result.push(matchedImage);
  }

  // 输出匹配日志
  for (const log of matchLog) {
    console.log(log);
  }

  return result;
}

/**
 * 下载新闻原文配图到本地
 * @param {Array} imageUrls - 配图 URL 数组（含 null）
 * @returns {Array} - 本地文件路径数组（null 表示下载失败）
 */
async function downloadNewsImages(imageUrls) {
  if (!fs.existsSync(IMAGE_DIR)) {
    fs.mkdirSync(IMAGE_DIR, { recursive: true });
  }
  const paths = [];
  for (let i = 0; i < imageUrls.length; i++) {
    const url = imageUrls[i];
    if (!url) { paths.push(null); continue; }
    const p = path.resolve(IMAGE_DIR, `news_${i + 1}.jpg`);
    try {
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
      };
      const res = await fetch(url, { headers, timeout: 15000, follow: 5 });
      if (res.ok) {
        const buffer = await res.buffer();
        // 用 sharp 统一格式和尺寸
        await sharp(buffer)
          .resize(800, 450, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 88 })
          .toFile(p);
        paths.push(p);
        console.log(`   ✅ 新闻配图 ${i + 1}: ${url.substring(0, 60)}...`);
      } else {
        paths.push(null);
      }
    } catch (e) {
      console.warn(`   ⚠️  新闻配图 ${i + 1} 下载失败: ${e.message}`);
      paths.push(null);
    }
  }
  return paths;
}

/**
 * 烽向标新闻卡片排版（v9 · 三段式：开头结尾同款暖蓝渐变，中间新闻卡片 + 原文配图）
 * 排版规则：
 *   - 开头综述 + 💬结尾：暖蓝渐变底 + 深色标签，样式统一
 *   - 中间新闻：白色卡片 + 深海军蓝标题条，独立风格
 */
function buildBriefHtml(rawText, wxImageUrls, fallbackTitle, newsImages, subTitle) {
  const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  let html = '';
  let imgIdx = 0;
  let discussionRendered = false; // guard: only render first 💬

  // newsImages: 每条新闻绑定的原文配图 URL（按新闻块顺序），优先使用
  const hasNewsImages = newsImages && newsImages.length > 0;
  // fallback: 如果没有 newsImages，降级使用 wxImageUrls
  const maxImages = hasNewsImages
    ? newsImages.length
    : Math.min(wxImageUrls?.length || 0, 3);

  const blocks = [];
  let cur = [];
  const hasDashSep = lines.some(l => /^-{3,}$/.test(l));
  const hasAnchorSep = lines.some(l => l.startsWith('📎'));
  if (hasAnchorSep && !hasDashSep) {
    // 按 📎 分割：📎 行归属于所在新闻块（作为最后一行），遇到 📎 时先加入当前块再保存
    for (const line of lines) {
      cur.push(line);
      if (line.startsWith('📎')) {
        if (cur.length > 0) { blocks.push(cur); cur = []; }
      }
    }
    if (cur.length > 0) blocks.push(cur);
  } else {
    // 按 --- 分割（传统格式）
    for (let i = 0; i < lines.length; i++) {
      if (/^-{3,}$/.test(lines[i])) {
        if (cur.length > 0) { blocks.push(cur); cur = []; }
        continue;
      }
      cur.push(lines[i]);
    }
    if (cur.length > 0) blocks.push(cur);
  }

  const titleBlock = blocks[0] || [];
  const newsBlocks = blocks.slice(1).filter(b => b.length > 0 && !b[0].startsWith('💬'));

  // ── Render title ──
  // subTitle 优先：直接展示副标题（标题工厂产出的有料标题），不展示"📡 烽向标 | 日期"前缀
  let titleRendered = false;
  if (subTitle) {
    html += `<div style="text-align:center;margin-bottom:1.2em;"><h1 style="font-size:20px;font-weight:700;color:#1a1a2e;line-height:1.45;margin:0 0 8px 0;">${escapeXml(subTitle)}</h1><div style="width:40px;height:3px;background:#d4af37;border-radius:2px;margin:0 auto;"></div></div>\n`;
    titleRendered = true;
  } else {
    for (const line of titleBlock) {
      if (/^📡/.test(line)) {
        html += `<div style="text-align:center;margin-bottom:1.2em;"><h1 style="font-size:20px;font-weight:700;color:#1a1a2e;line-height:1.45;margin:0 0 8px 0;">${escapeXml(line)}</h1><div style="width:40px;height:3px;background:#d4af37;border-radius:2px;margin:0 auto;"></div></div>\n`;
        titleRendered = true;
      }
    }
  }
  if (!titleRendered && fallbackTitle) {
    html += `<div style="text-align:center;margin-bottom:1.2em;"><h1 style="font-size:20px;font-weight:700;color:#1a1a2e;line-height:1.45;margin:0 0 8px 0;">${escapeXml(fallbackTitle)}</h1><div style="width:40px;height:3px;background:#d4af37;border-radius:2px;margin:0 auto;"></div></div>\n`;
  }

  // Determine actual news blocks and intro
  let actualNewsBlocks;
  let introText = '';
  if (titleRendered) {
    actualNewsBlocks = newsBlocks;
  } else {
    actualNewsBlocks = blocks;
  }
  // Check if first block is an intro (overview/summary before the news)
  if (actualNewsBlocks.length > 0) {
    const firstBlock = actualNewsBlocks[0];
    const firstLine = firstBlock[0] || '';
    const firstTwoLines = firstBlock.slice(0, 2).join('');
    // Treat as intro if: starts with 本周/近期/过去一周, or mentions 本周/关注 without being a news title
    const isIntro = (
      /^本周/.test(firstLine) || 
      /^(过去一周|近期|本期)/.test(firstLine) ||
      (firstBlock.length <= 3 && (firstLine.length > 20 && !firstLine.startsWith('1.') && !firstLine.startsWith('事件')))
    );
    if (isIntro) {
      // Join all lines and clean
      introText = firstBlock.join('');
      actualNewsBlocks = actualNewsBlocks.slice(1);
    }
  }

  // ── Render intro (matching ending style — warm light blue) ──
  if (introText) {
    const cleanIntro = introText.replace(/^◆\s*烽评\s*/g, '').trim();
    html += `<div style="margin:1em 0;padding:16px 18px;background:linear-gradient(135deg,#f0f5ff,#e3f0ff);border-radius:10px;">`;
    html += `<span style="display:inline-block;padding:2px 10px;background:#1a365d;color:#fff;font-size:11px;font-weight:600;border-radius:4px;margin-bottom:8px;">📋 概述</span>`;
    html += `<p style="font-size:14px;color:#1a365d;line-height:1.85;margin:0;">${formatWithBold(cleanIntro)}</p>`;
    html += `</div>\n`;
  }

  // ── Render news cards ──
  for (let n = 0; n < actualNewsBlocks.length; n++) {
    const block = actualNewsBlocks[n];
    if (block.length === 0) continue;

    // Filter out ◆ 烽评 standalone lines and duplicate 💬
    const cleaned = block.filter(l => !/^◆\s*烽评/.test(l) && !/^💬/.test(l));
    if (cleaned.length === 0) continue;

    const srcIdx = cleaned.findIndex(l => l.startsWith('📎'));
    const bodyLines = srcIdx >= 0 ? cleaned.slice(0, srcIdx) : [...cleaned];
    const srcLine = srcIdx >= 0 ? cleaned[srcIdx] : null;
    if (bodyLines.length === 0) continue;

    const firstPara = bodyLines[0];
    // 移除小标题中的"事件："或"事件概述："前缀
    let title = firstPara.replace(/^事件(概述)?[：:]\s*/, '');
    let firstParaRemainder = '';
    if (title !== firstPara) {
      // 前缀被移除，剩余内容作为正文
      firstParaRemainder = '';
    } else {
      const sentMatch = firstPara.match(/^([^。？！]*[。？！])/);
      if (sentMatch) {
        title = sentMatch[1].trim();
        firstParaRemainder = firstPara.substring(sentMatch[1].length).trim();
      }
    }

    const paras = [];
    if (firstParaRemainder) paras.push(firstParaRemainder);
    for (let c = 1; c < bodyLines.length; c++) {
      paras.push(bodyLines[c]);
    }

    // Split into body and commentary: find the line with "烽评："
    const fengpingIdx = paras.findIndex(p => p.startsWith('烽评'));
    let commentary = '';
    const bodyParas = paras;
    if (fengpingIdx >= 0) {
      commentary = paras[fengpingIdx].replace(/^烽评[：:]\s*/, '');
      bodyParas.splice(fengpingIdx);
    } else if (paras.length > 0) {
      // fallback: last paragraph as commentary
      commentary = paras[paras.length - 1];
      bodyParas.pop();
    }

    html += `<div style="margin:1em 0;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.03);">\n`;

    // Image: 优先使用新闻绑定的原文配图 (newsImages)，降级使用 wxImageUrls
    let imgUrl = null;
    if (hasNewsImages && n < newsImages.length && newsImages[n]) {
      imgUrl = newsImages[n];
    } else if (!hasNewsImages && n < maxImages && imgIdx < maxImages && wxImageUrls && wxImageUrls[imgIdx]) {
      imgUrl = wxImageUrls[imgIdx];
      imgIdx++;
    }
    if (imgUrl) {
      html += `<div style="line-height:0;"><img src="${imgUrl}" alt="" style="width:100%;display:block;" /></div>\n`;
    }

    // Title (blue header)
    html += `<div style="padding:11px 16px;background:linear-gradient(135deg,#1a365d,#2b6cb0);"><p style="margin:0;font-size:15px;font-weight:700;color:#fff;line-height:1.55;">${formatWithBold(title)}</p></div>\n`;

    // Body
    if (bodyParas.length > 0) {
      html += `<div style="padding:10px 16px;background:#f8fafc;">\n`;
      for (const p of bodyParas) {
        html += `<p style="margin:0.45em 0;font-size:15px;line-height:1.85;color:#334155;">${formatWithBold(p)}</p>\n`;
      }
      html += `</div>\n`;
    }

    // Commentary (烽评)
    if (commentary) {
      html += `<div style="padding:10px 16px;background:#f0f5ff;border-top:1px solid #e2e8f0;">`;
      html += `<p style="margin:0;font-size:13px;line-height:1.8;color:#475569;"><span style="display:inline-block;padding:1px 8px;margin-right:4px;background:#1a365d;color:#fff;font-size:11px;font-weight:700;border-radius:3px;">◆ 烽评</span>${formatWithBold(commentary)}</p>`;
      html += `</div>\n`;
    }

    // Source：拆分为两行显示，"📎 原文链接:" 和 URL 分开放
    if (srcLine) {
      // 尝试从 📎 行提取URL，如果没有则看下一行（AI 可能将URL放在下一行）
      let srcUrl = '';
      let srcLabel = srcLine;
      const urlInLine = srcLine.match(/(https?:\/\/[^\s）)]+)/);
      if (urlInLine) {
        const beforeUrl = srcLine.substring(0, urlInLine.index).trim();
        srcLabel = beforeUrl || srcLine;
        srcUrl = urlInLine[1];
      } else if (srcIdx + 1 < cleaned.length) {
        const nextLine = cleaned[srcIdx + 1];
        const urlNext = nextLine.match(/(https?:\/\/[^\s）)]+)/);
        if (urlNext) {
          srcUrl = urlNext[1];
        }
      }
      if (srcUrl) {
        html += `<div style="padding:5px 16px;background:#f8fafc;border-top:1px solid #e2e8f0;"><p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.7;">${escapeXml(srcLabel)}<br><span style="word-break:break-all;">${escapeXml(srcUrl)}</span></p></div>\n`;
      } else {
        html += `<div style="padding:5px 16px;background:#f8fafc;border-top:1px solid #e2e8f0;"><p style="margin:0;font-size:12px;color:#94a3b8;">${escapeXml(srcLine)}</p></div>\n`;
      }
    }
    html += `</div>\n`;
  }

  // ── Render 💬 discussion (only first occurrence, dedup) ──
  const discussionLines = lines.filter(l => l.startsWith('💬'));
  const seenDiscussions = new Set();
  for (const dl of discussionLines) {
    const clean = dl.replace(/^💬\s*/, '').trim();
    if (clean && !seenDiscussions.has(clean)) {
      seenDiscussions.add(clean);
      if (!discussionRendered) {
        html += `<div style="margin:1.5em 0 1em;padding:16px 18px;background:linear-gradient(135deg,#f0f5ff,#e3f0ff);border-radius:10px;">`;
        html += `<span style="display:inline-block;padding:2px 10px;background:#1a365d;color:#fff;font-size:11px;font-weight:600;border-radius:4px;margin-bottom:8px;">💬 讨论</span>`;
        html += `<p style="font-size:14px;color:#1a365d;line-height:1.85;margin:0;">${escapeXml(clean)}</p></div>\n`;
        discussionRendered = true;
      }
    }
  }

  return html;
}

// ─── 启动 ─────────────────────────────────────────────
main().catch(err => {
  console.error('\n❌ 推送失败：', err.message || err);
  process.exit(1);
});
