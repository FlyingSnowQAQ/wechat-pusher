/**
 * 一键生成三栏目完整样文脚本
 * 分别用龙虎斗、绣花针、烽向标的 System Prompt 调用 DeepSeek
 * 生成完整约2000字文章，并用对应的 HTML 模板渲染
 */

require('dotenv').config({ path: __dirname + '/.env' });
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const ACCOUNT_NAME = process.env.ACCOUNT_NAME || '雕龙绣虎';
const OUTPUT_DIR = __dirname;

// ── 从 push.js 复制必要的函数（独立脚本不能 require） ──
function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// ── Persona Head ──
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
- 设计2-3句可截屏传播的"金句"

🚫 **绝对禁止（违反将导致内容作废）**：
1. **禁止任何第一人称虚构经历**——不得写"我去年在XX"、"我同事""我朋友""我遇到过一个客户"等
2. **禁止具体地理位置**——不出现深圳、上海、杭州、金华等任何城市名
3. **禁止编造人物和对话**——不写"小李说""张工吐槽道"等虚构角色
4. **禁止编造具体公司内部细节**——不写"某省运营商内部会议透露"等无法核实的信息
5. 用**第三人称行业分析**的口吻写作，如"行业数据显示""从公开信息看""据行业观察"`;
}

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

const FENGXIANGBIAO_SYSTEM = `${getPersonaHead()}

## 栏目：「烽向标」—— 一周通信见闻精华（周三/周六）

你现在正在写「烽向标」栏目。这个栏目的定位是：**一周通信圈最重要的事，讲给不想被落下的人**。

素材来源：
- 实际新闻素材（C114通信网等行业媒体抓取）会作为上下文提供
- 如果新闻素材为空，则凭行业知识撰写本周回顾

写作方向：
1. **精选本周4件事**：从本周众多新闻中选出最有价值的4条
2. 标题格式：第一行写 📡 烽向标 | YYYY年M月D日
3. 每条新闻用 --- 分隔。每条的结构：先写事件概述（事实性、客观），后写烽评（以"烽评："开头）
4. **1个"本周值得关注"**：挑一个下周话题前瞻
5. 末尾用 💬 抛一个讨论问题
6. 整体控制在2000字左右

🚫 严格禁止：
- 禁止"咱们""通信同行们""各位读者"等主观称呼
- 禁止"第一件事""第二件事""说白了""这背后"等口语
- 禁止"这周信息量有点大""挑了4件最值得聊的"等主观引导
- 禁止内容重复，💬讨论只出现一次
- 使用客观中立的新闻报道语态，类似C114通信网的行文风格
- 不要使用任何 Markdown 标记（##、**、*等）

// ── 调用 DeepSeek ──
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

function cleanTitle(title) {
  return title.replace(/^(标题[：:]\s*)/i, '').replace(/^[#＃《》\s]+/, '').trim().substring(0, 64);
}

function countChineseChars(text) {
  const chineseChars = text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g);
  return chineseChars ? chineseChars.length : 0;
}

// ── 三栏目配置 ──
const columns = [
  {
    name: '龙虎斗',
    tag: '🐉 龙虎斗 · 周一/周四',
    systemPrompt: LONGHUDOU_SYSTEM,
    userPrompt: '请写一篇关于「烽火通信如何在5G承载网集采中逆势崛起」的深度分析文章。从运营商集采数据切入，分析烽火的技术路线选择和国产替代红利。直接输出完整文章正文，不要输出"标题："等标记。',
    useBriefHtml: false,
    file: 'sample_longhudou.html'
  },
  {
    name: '绣花针',
    tag: '🧵 绣花针 · 周二/周五',
    systemPrompt: XIUHUAZHEN_SYSTEM,
    userPrompt: '请写一篇关于「为什么5G信号满格却刷不出视频」的科普趣文。从一个日常困惑切入，用通俗易懂的比喻解释背后的技术原理。直接输出完整文章正文，不要输出"标题："等标记。',
    useBriefHtml: false,
    file: 'sample_xiuhuazhen.html'
  },
  {
    name: '烽向标',
    tag: '📡 烽向标 · 周三/周六',
    systemPrompt: FENGXIANGBIAO_SYSTEM,
    userPrompt: '本周通信行业的主要新闻包括：①三大运营商发布2026年中期财报 ②5G-A商用网络覆盖突破300城 ③工信部推进6G研发 ④光通信产业链涨价。请据此写一篇烽向标周报，精选本周4条新闻逐一点评。开头用📡标注标题行。每条新闻用---分隔，每条内包含事件概述和烽评。末尾加本周关注和讨论问题。注意：不要使用任何 Markdown 标记（## ** *等），使用纯自然语言。直接输出完整文章正文。',
    useBriefHtml: true,
    file: 'sample_fengxiangbiao.html'
  }
];

// ── 构建 HTML 的函数 ──
function formatWithBold(text) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map(part => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return '<strong>' + escapeXml(part.slice(2, -2)) + '</strong>';
    }
    return escapeXml(part);
  }).join('');
}

function buildArticleHtml(title, content, columnName) {
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  let html = '';
  let paragraphCount = 0;

  const colTag = columnName;
  const colTagStyle = colTag === '烽向标'
    ? 'background:linear-gradient(135deg,#00acc1,#26c6da);'
    : 'background:linear-gradient(135deg,#1a73e8,#2979ff);';

  html += `<div style="text-align:center;padding:28px 0 14px;position:relative;">`;
  html += `<div style="position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,#1a73e8,#00acc1,#1a73e8);"></div>`;
  html += `<span style="display:inline-block;padding:3px 14px;${colTagStyle}color:#fff;font-size:11px;font-weight:600;border-radius:12px;letter-spacing:1px;margin-bottom:14px;">${escapeXml(colTag)}</span>`;
  html += `<h1 style="font-size:21px;font-weight:700;color:#1a2332;line-height:1.55;margin:0 0 10px;letter-spacing:0.3px;">${escapeXml(title)}</h1>`;
  const today = new Date();
  html += `<div style="font-size:12px;color:#94a3b8;display:flex;align-items:center;justify-content:center;gap:8px;">`;
  html += `<span>${ACCOUNT_NAME}</span>`;
  html += `<span style="width:3px;height:3px;border-radius:50%;background:#cbd5e1;display:inline-block;"></span>`;
  html += `<span>${today.toLocaleDateString('zh-CN')}</span>`;
  html += `</div>`;
  html += `<div style="width:48px;height:3px;background:linear-gradient(90deg,#1a73e8,#00acc1);border-radius:2px;margin:12px auto 0;"></div>`;
  html += `</div>\n`;

  for (const line of lines) {
    if (/^-{3,}$/.test(line) || /^📡/.test(line)) continue;
    paragraphCount++;

    if (/^💬/.test(line)) {
      html += `<div style="margin:1.5em 0 1em 0;padding:16px 18px;background:linear-gradient(135deg,#f0f5ff,#e3f0ff);border-radius:10px;">`;
      html += `<span style="display:inline-block;padding:2px 10px;background:#1a73e8;color:#fff;font-size:11px;font-weight:600;border-radius:4px;margin-bottom:8px;">💬 讨论</span>`;
      html += `<p style="font-size:14px;color:#1a365d;line-height:1.85;margin:0;">${formatWithBold(line.replace(/^💬\s*/, ''))}</p></div>\n`;
      continue;
    }

    if (line.startsWith('✦') || line.startsWith('◆')) {
      html += `<div style="margin:1.5em 0;padding:18px 20px;text-align:center;background:linear-gradient(135deg,#faf6eb,#fdf8ee);border-radius:10px;border:1px solid #e8dcc8;">`;
      html += `<p style="font-size:16px;font-weight:600;color:#8b6914;line-height:1.8;margin:0;letter-spacing:0.5px;">${formatWithBold(line)}</p></div>\n`;
      continue;
    }

    if (/^📌/.test(line)) {
      html += `<div style="margin:1.2em 0;padding:14px 18px;background:linear-gradient(135deg,#fff8f0,#fff3e0);border-radius:8px;border-left:3px solid #ff6d00;">`;
      html += `<p style="font-size:14px;color:#3d2e1a;line-height:1.8;margin:0;">${formatWithBold(line)}</p></div>\n`;
      continue;
    }

    if (/^【.*】/.test(line) || line.startsWith('##')) {
      const sub = line.replace(/^##\s*/, '').replace(/^【([^】]+)】/, '$1');
      html += `<h2 style="font-size:17px;font-weight:700;color:#1a2332;margin:1.5em 0 0.6em;line-height:1.5;padding-left:14px;position:relative;">`;
      html += `<span style="position:absolute;left:0;top:4px;bottom:4px;width:3px;background:linear-gradient(180deg,#1a73e8,#00acc1);border-radius:2px;display:inline-block;"></span>`;
      html += `${formatWithBold(sub)}</h2>\n`;
      continue;
    }

    const pStyle = paragraphCount === 1 ? 'font-size:16px;color:#1a2332;font-weight:500;' : 'font-size:15px;color:#334155;';
    html += `<p style="margin:0.75em 0;${pStyle}line-height:1.9;letter-spacing:0.2px;">${formatWithBold(line)}</p>\n`;
  }

  html += `<div style="margin-top:2em;padding:24px 20px;text-align:center;background:linear-gradient(135deg,#f0f7ff,#e3f0ff);border-radius:12px;border:1px solid #d0e1fd;">`;
  html += `<p style="font-size:18px;font-weight:800;color:#1a2332;letter-spacing:3px;margin:0 0 6px;">${ACCOUNT_NAME}</p>`;
  html += `<div style="width:30px;height:2px;background:linear-gradient(90deg,#1a73e8,#00acc1);margin:12px auto;border-radius:1px;"></div>`;
  html += `<p style="font-size:12px;color:#64748b;letter-spacing:1px;margin:0 0 14px;">📡 一个通信老炮的技术笔记</p>`;
  html += `<div style="display:flex;justify-content:center;gap:10px;">`;
  html += `<span style="display:inline-block;padding:6px 22px;font-size:13px;border-radius:20px;font-weight:500;background:#e8f0fe;color:#1a73e8;">👍 点个在看</span>`;
  html += `<span style="display:inline-block;padding:6px 22px;font-size:13px;border-radius:20px;font-weight:500;background:linear-gradient(135deg,#1a73e8,#2979ff);color:#ffffff;box-shadow:0 2px 6px rgba(26,115,232,0.25);">+ 关注</span>`;
  html += `</div></div>\n`;

  return html;
}

function buildBriefHtml(content, wxImageUrls) {
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  let html = '';
  let imgIdx = 0;
  const maxImages = Math.min(wxImageUrls?.length || 0, 3);

  const blocks = [];
  let cur = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^-{3,}$/.test(lines[i])) { if (cur.length > 0) { blocks.push(cur); cur = []; } continue; }
    cur.push(lines[i]);
  }
  if (cur.length > 0) blocks.push(cur);

  const titleBlock = blocks[0] || [];
  const newsBlocks = blocks.slice(1).filter(b => b.length > 0 && !b[0].startsWith('💬'));

  for (const line of titleBlock) {
    if (/^📡/.test(line)) {
      html += `<div style="text-align:center;margin-bottom:1em;padding:20px 0 10px;">`;
      html += `<h1 style="font-size:20px;font-weight:700;color:#1a2332;line-height:1.5;margin:0 0 10px;letter-spacing:0.5px;">${escapeXml(line)}</h1>`;
      html += `<div style="width:40px;height:3px;background:linear-gradient(90deg,#00acc1,#1a73e8);border-radius:2px;margin:0 auto;"></div></div>\n`;
    }
  }

  for (let n = 0; n < newsBlocks.length; n++) {
    const block = newsBlocks[n];
    if (block.length === 0) continue;
    const srcIdx = block.findIndex(l => l.startsWith('📎'));
    const bodyLines = srcIdx >= 0 ? block.slice(0, srcIdx) : [...block];
    const srcLine = srcIdx >= 0 ? block[srcIdx] : null;
    if (bodyLines.length === 0) continue;

    const firstPara = bodyLines[0];
    let title = firstPara;
    let firstParaRemainder = '';
    const sentMatch = firstPara.match(/^([^。？！]*[。？！])/);
    if (sentMatch) { title = sentMatch[1].trim(); firstParaRemainder = firstPara.substring(sentMatch[1].length).trim(); }

    const paras = [];
    if (firstParaRemainder) paras.push(firstParaRemainder);
    for (let c = 1; c < bodyLines.length; c++) paras.push(bodyLines[c]);

    let commentary = '';
    const bodyParas = paras.length > 0 ? paras.slice(0, -1) : [];
    if (paras.length > 0) commentary = paras[paras.length - 1];

    html += `<div style="margin:1em 0;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.03);">\n`;

    if (n < maxImages && imgIdx < maxImages && wxImageUrls && wxImageUrls[imgIdx]) {
      html += `<div style="line-height:0;"><img src="${wxImageUrls[imgIdx]}" alt="" style="width:100%;display:block;" /></div>\n`;
      imgIdx++;
    }

    html += `<div style="padding:11px 16px;background:linear-gradient(135deg,#1a73e8,#2979ff);"><p style="margin:0;font-size:15px;font-weight:700;color:#fff;line-height:1.55;">${escapeXml(title)}</p></div>\n`;

    if (bodyParas.length > 0) {
      html += `<div style="padding:10px 16px;background:#f8fafc;">\n`;
      for (const p of bodyParas) html += `<p style="margin:0.45em 0;font-size:15px;line-height:1.85;color:#334155;">${escapeXml(p)}</p>\n`;
      html += `</div>\n`;
    }

    if (commentary) {
      html += `<div style="padding:10px 16px;background:#f0f5ff;border-top:1px solid #e2e8f0;">`;
      html += `<p style="margin:0;font-size:13px;line-height:1.8;color:#475569;"><span style="display:inline-block;padding:1px 8px;margin-right:4px;background:#1a73e8;color:#fff;font-size:11px;font-weight:700;border-radius:3px;">◆ 烽评</span>${escapeXml(commentary)}</p></div>\n`;
    }

    if (srcLine) {
      html += `<div style="padding:5px 16px;background:#f8fafc;border-top:1px solid #e2e8f0;"><p style="margin:0;font-size:12px;color:#94a3b8;">${escapeXml(srcLine)}</p></div>\n`;
    }
    html += `</div>\n`;
  }

  const il = lines.find(l => l.startsWith('💬'));
  if (il) {
    html += `<div style="margin:1.5em 0 1em;padding:16px 18px;background:linear-gradient(135deg,#f0f5ff,#e3f0ff);border-radius:10px;">`;
    html += `<span style="display:inline-block;padding:2px 10px;background:#1a73e8;color:#fff;font-size:11px;font-weight:600;border-radius:4px;margin-bottom:8px;">💬 讨论</span>`;
    html += `<p style="font-size:14px;color:#1a365d;line-height:1.85;margin:0;">${escapeXml(il.replace(/^💬\s*/, ''))}</p></div>\n`;
  }

  return html;
}

function wrapPage(title, bodyHtml, columnName) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>${title} - ${columnName}样文</title>
<style>
  * { margin:0;padding:0;box-sizing:border-box; }
  body { background:#f2f2f2;padding:0;font-family:-apple-system,"PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif;-webkit-font-smoothing:antialiased; }
  .article { max-width:640px;margin:0 auto;background:#fff;min-height:100vh; }
  .article-inner { padding:20px 18px 30px; }
  img { max-width:100%;border-radius:4px;display:block;margin:0 auto; }
  .stat { margin-top:20px;padding:12px 16px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0; }
  .stat p { font-size:12px;color:#94a3b8;margin:0;line-height:1.8; }
  @media (min-width:641px) { .article { box-shadow:0 0 0 1px #e8ecf1;margin:30px auto;border-radius:8px;min-height:auto; } }
</style>
</head>
<body>
<div class="article">
<div class="article-inner">
  <div style="padding:6px 12px;background:#1a73e8;color:#fff;font-size:12px;border-radius:4px;display:inline-block;margin-bottom:8px;">${escapeXml(columnName)}</div>
  ${bodyHtml}
</div>
</div>
</body>
</html>`;
}

// ── 主流程 ──
async function main() {
  console.log('========================================');
  console.log('三栏目完整样文生成 - 开始');
  console.log('========================================\n');

  for (const col of columns) {
    console.log(`\n✍️ 正在生成【${col.name}】...`);
    process.stdout.write('   调用 DeepSeek...');

    const articleRaw = await callDeepSeek([
      { role: 'system', content: col.systemPrompt },
      { role: 'user', content: col.userPrompt },
    ], 0.85);

    // 提取标题和正文
    const lines = articleRaw.split('\n').map(l => l.trim()).filter(Boolean);
    const rawTitle = lines[0] || '';
    let title = cleanTitle(rawTitle);
    if (!title || title.length < 4) {
      const firstLine = lines.find(l => l.length > 5 && !l.startsWith('```'));
      if (firstLine) title = cleanTitle(firstLine);
    }

    const bodyText = articleRaw.replace(/^[\s]*标题[：:]\s*[^\n]*\n?/, '');
    const cleanText = bodyText.replace(new RegExp('^\\s*' + escapeXml(title) + '\\s*\\n?'), '').trim();

    const charCount = countChineseChars(cleanText);
    console.log(` ✅ 完成（约 ${charCount} 中文字符）`);
    console.log(`   标题：《${title}》`);

    // 渲染 HTML
    process.stdout.write('   渲染排版...');
    let bodyHtml;
    if (col.useBriefHtml) {
      bodyHtml = buildBriefHtml(articleRaw, []);
    } else {
      bodyHtml = buildArticleHtml(title, cleanText, col.name);
    }

    const fullHtml = wrapPage(title, bodyHtml, col.name);
    const filePath = path.join(OUTPUT_DIR, col.file);
    fs.writeFileSync(filePath, fullHtml, 'utf8');
    console.log(` ✅ 保存到 ${col.file}`);
  }

  console.log('\n========================================');
  console.log('三篇样文全部生成完毕！');
  console.log('========================================');
  console.log('\n📌 预览文件：');
  console.log('   1. sample_longhudou.html    🐉 龙虎斗');
  console.log('   2. sample_xiuhuazhen.html   🧵 绣花针');
  console.log('   3. sample_fengxiangbiao.html 📡 烽向标');
}

main().catch(err => {
  console.error('\n❌ 生成失败：', err.message || err);
  process.exit(1);
});
