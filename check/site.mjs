/* 零依赖测试：站点信息架构（不需要浏览器）
 * 跑法：node --test check/site.mjs
 * ----------------------------------------------------------------------------
 * 覆盖：
 *   ① site/nav.json 合法（分区 / 页面 / 唯一性）
 *   ② 登记的文件真的存在；分区 slug 与页面 title 不重复
 *   ③ 每页的五个标记区成对、顺序正确
 *   ④ 零漂移：site-core 现算的结果与磁盘上的字节完全一致（忘了跑 build-site 就红）
 *   ⑤ 全页恰好一个 aria-current="page"（顶栏分区多页时用 "true" 让位给副条）
 *   ⑥ 面包屑末项 = 该页 title；副条只在分区多页时出现
 *   ⑦ h2 的 id 与页内目录互相指得上（锚点不许悬空）
 *   ⑧ 没有孤儿页（磁盘上有、nav.json 里没有）
 *   ⑨ meta description 长度合理、title 不重复、canonical 指向自己
 *
 * 这一层管的是"信息架构有没有漂"，不是"好不好看"（后者仍然签字的是人的眼睛）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MARK, validateNav, locate, allPages, renderMeta, renderHead, renderGuide, renderFoot, tagHeadings, fillBlock } from '../tools/site-core.mjs';
import { renderBoot, loadPalettes } from '../tools/theme-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nav = JSON.parse(fs.readFileSync(path.join(ROOT, 'site', 'nav.json'), 'utf8'));
const pal = loadPalettes(ROOT);
/* ⚠ 归一 CRLF：Windows 上 core.autocrlf=true 时 checkout 出来是 CRLF，
   不归一的话「零漂移」在全新 clone / worktree 里必红（实测：3 条同时红）。 */
const readFile = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

/* build-site 会把这个写进 nav：默认套的纸色 */
const defPal = pal.palettes.find(p => p.slug === pal.default);

/* 登记过的页面：分区页 + 资源页 + 额外页 */
function entries() {
  const out = [
    ...allPages(nav).map(p => ({ file: p.file, page: p, chrome: true })),
    ...(nav.resources || []).map(r => ({ file: r.file, page: r, chrome: true })),
    ...(nav.extra || []).map(e => ({ file: e.file, page: e, chrome: e.chrome !== false }))
  ];
  return out;
}

/* 磁盘上的 html（跳过 node_modules / _release / 点开头目录 / media 下的产物） */
function onDisk(dir = ROOT) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '_release' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'media') out.push(...onDisk(p)); }
    else if (e.name.endsWith('.html')) out.push(path.relative(ROOT, p).replace(/\\/g, '/'));
  }
  return out.sort();
}

test('nav.json：合法（分区、页面、唯一性）', () => {
  assert.deepEqual(validateNav(nav), [], 'nav.json 必须无错');
  assert.ok(nav.sections.length >= 3, '分区太少了：信息架构的意义就是把页面分门别类');
  const titles = allPages(nav).map(p => p.title);
  assert.deepEqual(titles, [...new Set(titles)], '页面 title 重复了（副条与面包屑会分不清）');
});

test('nav.json：登记的文件都真的存在', () => {
  const missing = entries().filter(e => !fs.existsSync(path.join(ROOT, e.file))).map(e => e.file);
  assert.deepEqual(missing, [], '登记了但文件不存在：\n' + missing.join('\n'));
});

test('每个登记页都有标记区，且成对、顺序正确', () => {
  /* meta + boot 每页都要；head + foot 只有装站点外壳的页要（index.html 是跳转壳，chrome:false） */
  const bad = [];
  for (const { file, chrome } of entries()) {
    const html = readFile(file);
    for (const [name, [B, E]] of Object.entries(MARK)) {
      if (name === 'guide') continue;                    /* 导览是可选的 */
      if ((name === 'head' || name === 'foot') && !chrome) continue;
      const i = html.indexOf(B), j = html.indexOf(E);
      if (i < 0 || j < 0) { bad.push(file + '：缺 ' + name + ' 标记'); continue; }
      if (j < i) bad.push(file + '：' + name + ' 标记顺序反了');
      if ((html.split(B).length - 1) > 1) bad.push(file + '：' + name + ' 标记重复');
    }
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('零漂移：磁盘上的骨架 = site-core 现算的结果', () => {
  /* 与 tools/build-site.mjs 同一套调用顺序（tagHeadings → meta/boot/head/guide/foot）。
     任何一页忘了跑构建、或者有人手改了头/脚，这里就红。 */
  nav.themeColor = defPal.ui.page;
  const boot = renderBoot(pal);
  const bad = [];
  for (const e of entries()) {
    let html = readFile(e.file);
    const tagged = tagHeadings(html);
    html = tagged.html;
    nav.__toc = tagged.toc;
    nav.__minimal = !!e.page.minimal;
    const blocks = [['meta', renderMeta(nav, e.file, e.page)], ['boot', boot]];
    if (e.chrome) {
      blocks.push(['head', renderHead(nav, e.file)]);
      if (html.includes(MARK.guide[0])) blocks.push(['guide', renderGuide(nav)]);
      blocks.push(['foot', renderFoot(nav, e.file, e.page)]);
    }
    for (const [name, body] of blocks) {
      const r = fillBlock(html, name, body);
      if (!r.ok) { bad.push(e.file + '：' + r.why); break; }
      html = r.html;
    }
    if (html !== readFile(e.file)) bad.push(e.file + '：与 nav.json 不一致 —— 跑 `node tools/build-site.mjs`');
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('恰好一个 aria-current="page"（顶栏多页分区只能 "true"）', () => {
  const bad = [];
  for (const { file, page, chrome } of entries()) {
    const html = readFile(file);
    const n = (html.match(/aria-current="page"/g) || []).length;
    /* 没有站点外壳的页（index.html 跳转壳）与满屏舞台（hero）不参与导航 */
    if (!chrome || page.minimal) {
      if (n !== 0) bad.push(file + '：没有导航的页不该有 aria-current="page"（拿到 ' + n + ' 个）');
      continue;
    }
    if (n !== 1) bad.push(file + '：aria-current="page" 有 ' + n + ' 个（必须恰好 1 个）');
  }
  assert.deepEqual(bad, [], bad.join('\n') +
    '\n（规则：顶栏分区有多页时用 aria-current="true"，精确的那一页由副条标 "page"，面包屑末项是普通 span）');
});

test('面包屑末项 = 页面 title；副条只在分区多页时出现', () => {
  const bad = [];
  for (const { file, page, chrome } of entries()) {
    /* 满屏舞台只留顶栏（renderHead 的 __minimal 分支）；跳转壳没有外壳 */
    if (!chrome || page.minimal) continue;
    const html = readFile(file);
    const hit = locate(nav, file);
    const crumb = html.match(/<nav class="crumbs"[^>]*>([\s\S]*?)<\/nav>/);
    if (!crumb) { bad.push(file + '：没有面包屑'); continue; }
    const last = crumb[1].replace(/<[^>]+>/g, '|').split('|').filter(Boolean).pop() || '';
    if (hit && last.trim() !== hit.page.title) bad.push(file + '：面包屑末项「' + last.trim() + '」≠ title「' + hit.page.title + '」');
    const hasSub = html.includes('class="subnav"');
    if (hit && hit.section.pages.length > 1 && !hasSub) bad.push(file + '：分区有多页却没有副条');
    if (hit && hit.section.pages.length === 1 && hasSub) bad.push(file + '：分区只有一页却出了副条');
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('页内目录的锚点指得上（toc-jump ⇄ h2 id）', () => {
  const bad = [];
  for (const { file } of entries()) {
    const html = readFile(file);
    const ids = new Set([...html.matchAll(/<h2[^>]*\sid="([^"]+)"/g)].map(m => m[1]));
    const toc = html.match(/<nav class="toc-jump"[^>]*>([\s\S]*?)<\/nav>/);
    if (!toc) continue;
    for (const m of toc[1].matchAll(/href="#([^"]+)"/g)) {
      if (!ids.has(m[1])) bad.push(file + '：目录指向 #' + m[1] + '，但没有这个 id');
    }
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('没有孤儿页（磁盘上有、nav.json 里没有）', () => {
  const known = new Set(entries().map(e => e.file));
  /* 这两个刻意不登记：demo 是最小接入示例（不许有 DOM 导航），press-reel 是离线出片工具 */
  const allowed = new Set(['demo/index.html', 'tools/press-reel.html']);
  const orphans = onDisk().filter(f => !known.has(f) && !allowed.has(f));
  assert.deepEqual(orphans, [], '这些页面没有进信息架构：\n' + orphans.join('\n'));
});

test('meta：description 长度合理、title 不重复、canonical 指向自己', () => {
  const bad = [], seen = new Map();
  for (const { file } of entries()) {
    const html = readFile(file);
    const desc = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1];
    if (!desc) { bad.push(file + '：没有 meta description'); continue; }
    if (desc.length < 24) bad.push(file + '：description 太短（' + desc.length + ' 字）—— 搜索引擎会自己截一段，不如你写好');
    if (desc.length > 160) bad.push(file + '：description 太长（' + desc.length + ' 字 > 160）会被截断');
    const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
    if (!title) bad.push(file + '：没有 <title>');
    if (seen.has(title)) bad.push(file + '：title 与 ' + seen.get(title) + ' 重复：' + title);
    seen.set(title, file);
    const canon = (html.match(/<link rel="canonical" href="([^"]*)"/) || [])[1];
    if (canon !== file) bad.push(file + '：canonical 指向「' + canon + '」，应指向自己');
    for (const k of ['og:type', 'og:title', 'og:description', 'og:site_name']) {
      if (!html.includes('property="' + k + '"')) bad.push(file + '：缺 ' + k);
    }
    if (!/name="theme-color"/.test(html)) bad.push(file + '：缺 theme-color');
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('结构：装外壳的登记页都有 <main> 与唯一 h1', () => {
  const bad = [];
  for (const { file, page, chrome } of entries()) {
    if (!chrome || page.minimal) continue;              /* 跳转壳 / 满屏舞台，结构另算 */
    const html = readFile(file);
    const mains = (html.match(/<main[\s>]/g) || []).length;
    const h1 = (html.match(/<h1[\s>]/g) || []).length;
    if (mains !== 1) bad.push(file + '：<main> 有 ' + mains + ' 个（必须恰好 1 个）');
    if (h1 !== 1) bad.push(file + '：<h1> 有 ' + h1 + ' 个（必须恰好 1 个）');
    /* 顶栏链接数 = 分区数 + 资源数：多一个少一个都说明手改过头 */
    const want = nav.sections.length + (nav.resources || []).length;
    const got = (html.match(/<nav class="site-nav"[^>]*>([\s\S]*?)<\/nav>/) || [, ''])[1].match(/<a /g) || [];
    if (got.length !== want) bad.push(file + '：顶栏 ' + got.length + ' 项，nav.json 说是 ' + want + ' 项');
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});
