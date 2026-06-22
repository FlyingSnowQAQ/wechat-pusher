/**
 * 雕龙绣虎 自定义文章推送脚本
 * - 使用 custom_article.txt 的文章内容
 * - 使用 custom_img_0/1/2.jpg 作为配图
 * - 小标题加粗、3张AI配图、原创标签
 */

require('dotenv').config({ path: __dirname + '/.env' });
const fs         = require('fs');
const path       = require('path');
const fetch      = require('node-fetch');

// ─── 配置 ──────────────────────────────────────────────
const WX_APPID     = process.env.WX_APPID;
const WX_APPSECRET = process.env.WX_APPSECRET;
const STATE_FILE   = path.resolve(__dirname, process.env.STATE_FILE || './state.json');
const ACCOUNT_NAME = process.env.ACCOUNT_NAME || '雕龙绣虎';
const ARTICLE_FILE = path.resolve(__dirname, './custom_article.txt');
const IMAGE_FILES  = [
  path.resolve(__dirname, './custom_img_0.jpg'),
  path.resolve(__dirname, './custom_img_1.jpg'),
  path.resolve(__dirname, './custom_img_2.jpg')
];
const COVER_FILE   = path.resolve(__dirname, './cover_temp.jpg');

// ─── 工具函数 ──────────────────────────────────────────

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  }
  return { push_count: 0, last_push_date: null, recent_titles: [] };
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// ─── 文本处理 ──────────────────────────────────────────

function cleanTitle(title) {
  return title
    .replace(/^(标题[：:]\s*)/i, '')
    .replace(/^【.*?(投稿|来源|部门|机构).*?】/, '')
    .replace(/[（(]\s*改\s*[）)]$/g, '')
    .replace(/^[#＃《》\s]+/, '')
    .trim()
    .substring(0, 64);
}

function isSubtitleLine(line) {
  if (/^#{1,4}\s/.test(line)) return true;
  if (/^[【《]/.test(line) && line.length <= 40) return true;
  if (/^[一二三四五六七八九十百]+[、．.](\s|$)/.test(line)) return true;
  if (/^[（(][一二三四五六七八九十]+[）)]/.test(line)) return true;
  if (/^\d{1,3}[、．.\s]/.test(line) && line.length <= 40) return true;
  if (/^第.+[章节部分篇]/.test(line) && line.length <= 40) return true;
  if (line.length <= 25 && /[：:！!]$/.test(line)) return true;
  if (line.length <= 20 && /^[「"『"《"【\[]/.test(line)) return true;
  return false;
}

function buildArticleHtml(rawText, imageUrls) {
  const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const total = lines.length;

  const validImages = (imageUrls || []).filter(Boolean);
  const imgPositions = total >= 8 && validImages.length > 0
    ? [
        Math.floor(total * 0.25),
        Math.floor(total * 0.5),
        Math.min(Math.floor(total * 0.75), total - 1)
      ]
    : [];

  let html = '';
  let imgIdx = 0;

  for (let i = 0; i < total; i++) {
    if (imgPositions.includes(i) && imgIdx < validImages.length) {
      html += `<p style="text-align:center;margin:2em 0 1.5em 0;">`
            + `<img src="${validImages[imgIdx]}" `
            + `style="max-width:100%;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,0.1);" />`
            + `</p>\n`;
      imgIdx++;
    }

    const line = lines[i];
    if (isSubtitleLine(line)) {
      html += `<p style="margin:1.8em 0 0.8em 0;line-height:1.9;font-size:17px;color:#333;">`
            + `<strong>${escapeXml(line)}</strong></p>\n`;
    } else {
      html += `<p style="margin:1.2em 0;line-height:1.9;font-size:16px;color:#333;">`
            + `${escapeXml(line)}</p>\n`;
    }
  }

  return html;
}

// ─── 封面图生成 ─────────────────────────────────────────

async function generateCover(titleText) {
  const sharp = require('sharp');
  const w = 900, h = 383;
  const displayTitle = titleText.length > 22
    ? titleText.substring(0, 22) + '…'
    : titleText;

  const svg = Buffer.from(`
    <svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#1a1a2e"/>
          <stop offset="50%" style="stop-color:#16213e"/>
          <stop offset="100%" style="stop-color:#0f3460"/>
        </linearGradient>
      </defs>
      <rect width="${w}" height="${h}" fill="url(#g)"/>
      <text x="450" y="150" font-family="SimHei, Microsoft YaHei, sans-serif"
            font-size="48" fill="#e0c097" text-anchor="middle" font-weight="bold">雕龙绣虎</text>
      <text x="450" y="220" font-family="SimHei, Microsoft YaHei, sans-serif"
            font-size="24" fill="rgba(255,255,255,0.7)" text-anchor="middle">───────────</text>
      <text x="450" y="280" font-family="SimHei, Microsoft YaHei, sans-serif"
            font-size="26" fill="white" text-anchor="middle">${escapeXml(displayTitle)}</text>
    </svg>
  `);

  await sharp(svg).jpeg({ quality: 88 }).toFile(COVER_FILE);
}

// ─── 微信 API ──────────────────────────────────────────

async function getWxToken() {
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${WX_APPID}&secret=${WX_APPSECRET}`;
  const res  = await fetch(url);
  const data = await res.json();
  if (data.errcode) throw new Error(`获取微信Token失败: ${JSON.stringify(data)}`);
  return data.access_token;
}

function buildMultipartBody(fileBuffer, filename, fieldName) {
  const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);
  const header = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: image/jpeg\r\n\r\n`
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([header, fileBuffer, footer]);
  return { body, boundary };
}

async function uploadThumb(token) {
  const fileBuffer = fs.readFileSync(COVER_FILE);
  const { body, boundary } = buildMultipartBody(fileBuffer, 'cover.jpg', 'media');

  const url = `https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${token}&type=thumb`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': body.length
    },
    body
  });
  const data = await res.json();
  if (!data.media_id) throw new Error(`上传封面图失败: ${JSON.stringify(data)}`);
  console.log(`   封面图已上传（永久素材）: media_id=${data.media_id}`);
  return data.media_id;
}

async function uploadArticleImage(token, imagePath) {
  const fileBuffer = fs.readFileSync(imagePath);
  const { body, boundary } = buildMultipartBody(fileBuffer, 'article.jpg', 'media');

  const url = `https://api.weixin.qq.com/cgi-bin/media/uploadimg?access_token=${token}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': body.length
    },
    body
  });
  const data = await res.json();
  if (data.url) return data.url;
  console.warn(`   配图上传返回: ${JSON.stringify(data)}`);
  return null;
}

async function uploadAllArticleImages(token, imagePaths) {
  const urls = [];
  for (let i = 0; i < imagePaths.length; i++) {
    if (!fs.existsSync(imagePaths[i])) {
      console.warn(`   配图${i + 1} 文件不存在: ${imagePaths[i]}，跳过`);
      urls.push(null);
      continue;
    }
    console.log(`   上传配图${i + 1}...`);
    const url = await uploadArticleImage(token, imagePaths[i]);
    urls.push(url);
  }
  return urls;
}

async function addDraft(token, title, content, thumbMediaId, author = ACCOUNT_NAME) {
  const url  = `https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${token}`;
  const body = {
    articles: [{
      article_type: 'news',
      title,
      author,
      content,
      content_source_url: '',
      thumb_media_id: thumbMediaId,
      need_open_comment: 1,
      only_fans_can_comment: 0,
      copyright_type: 11
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
  const url  = `https://api.weixin.qq.com/cgi-bin/freepublish/submit?access_token=${token}`;
  const res  = await fetch(url, {
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

// ─── 主流程 ────────────────────────────────────────────

async function main() {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`[${new Date().toLocaleString('zh-CN')}] 「${ACCOUNT_NAME}」自定义推送任务启动`);
  console.log('='.repeat(50));

  // 1. 读取文章
  if (!fs.existsSync(ARTICLE_FILE)) {
    throw new Error(`文章文件不存在: ${ARTICLE_FILE}`);
  }
  const rawText = fs.readFileSync(ARTICLE_FILE, 'utf8').trim();
  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
  const title = cleanTitle(lines[0]).substring(0, 64);
  console.log(`\n📄 文章读取成功，标题：《${title}》`);

  // 2. 验证配图是否存在
  for (let i = 0; i < IMAGE_FILES.length; i++) {
    if (!fs.existsSync(IMAGE_FILES[i])) {
      console.warn(`   ⚠️  配图${i + 1} 文件不存在: ${IMAGE_FILES[i]}`);
    } else {
      const stat = fs.statSync(IMAGE_FILES[i]);
      console.log(`   ✅ 配图${i + 1} 就绪 (${(stat.size / 1024).toFixed(1)}KB)`);
    }
  }

  // 3. 生成封面图
  console.log('\n🖼️  生成封面图...');
  await generateCover(title);
  console.log(`   ✅ 封面图已生成`);

  // 4. 获取微信Token
  console.log('\n🔑 获取微信 access_token...');
  const token = await getWxToken();
  console.log('   ✅ Token获取成功');

  // 5. 上传配图到微信
  console.log('\n📤 上传配图到微信...');
  const imageUrls = await uploadAllArticleImages(token, IMAGE_FILES);
  console.log(`   ✅ 配图上传完成，${imageUrls.filter(Boolean).length} 张成功`);

  // 6. 构建文章HTML（配图插入在25%、50%、75%位置）
  console.log('\n📝 构建文章HTML...');
  const articleHtml = buildArticleHtml(rawText, imageUrls);
  console.log(`   ✅ HTML构建完成，长度: ${articleHtml.length} 字符`);

  // 7. 上传封面缩略图（永久素材）
  console.log('\n📤 上传封面缩略图（永久素材）...');
  const thumbMediaId = await uploadThumb(token);

  // 8. 创建草稿
  console.log('\n📝 创建草稿（原创标签已开启）...');
  const mediaId = await addDraft(token, title, articleHtml, thumbMediaId);
  console.log(`   ✅ 草稿创建成功! media_id: ${mediaId}`);

  // 清理临时文件
  try { fs.unlinkSync(COVER_FILE); } catch (_) {}

  // 9. 尝试自动发布
  console.log('\n🚀 尝试自动发布...');
  const pubResult = await publishDraft(token, mediaId);
  console.log('   发布结果：', JSON.stringify(pubResult));

  // 10. 更新状态
  const state = loadState();
  state.push_count     = (state.push_count || 0) + 1;
  state.last_push_date = new Date().toISOString();
  state.recent_titles = [title, ...(state.recent_titles || [])].slice(0, 10);
  saveState(state);

  console.log(`\n${'='.repeat(50)}`);
  console.log(`✅ 第 ${state.push_count} 次推送完成！《${title}》`);
  console.log('='.repeat(50));
}

main().catch(err => {
  console.error('\n❌ 推送失败：', err.message || err);
  process.exit(1);
});
