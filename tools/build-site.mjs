/* ============================================================================
 * build-site.mjs · 把 site/nav.json 写进每页的标记区（站点骨架的生成器）
 * ----------------------------------------------------------------------------
 * 跑法：
 *   node tools/build-site.mjs            写盘
 *   node tools/build-site.mjs --check    只比对，有漂移 exit 1
 *
 * 它只写四类标记区：site:meta / site:boot / site:head / site:foot。
 * 唯一会碰到标记区之外的改动：给缺 id 的 <h2> 补 `id="sec-N"`（只加属性，不改文本），
 * 这样页内目录不需要 JS。除此之外页面正文一个字节都不动。
 * ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, MARK, validateNav, locate, allPages, renderMeta, renderHead, renderGuide, renderFoot, tagHeadings, fillBlock } from './site-core.mjs';
import { renderBoot } from './theme-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

const nav = JSON.parse(fs.readFileSync(path.join(ROOT, 'site', 'nav.json'), 'utf8'));
const pal = JSON.parse(fs.readFileSync(path.join(ROOT, 'theme', 'palettes.json'), 'utf8'));

const errs = validateNav(nav);
if (errs.length) {
  console.error('✗ nav.json 不合法：');
  for (const e of errs) console.error('  ' + e);
  process.exit(1);
}

const defPal = pal.palettes.find(p => p.slug === pal.default);
nav.themeColor = defPal.ui.page;

/* 所有登记过的页面（分区页 + 资源页 + 额外页） */
const entries = [
  ...allPages(nav).map(p => ({ file: p.file, page: p, chrome: true })),
  ...(nav.resources || []).map(r => ({ file: r.file, page: r, chrome: true })),
  ...(nav.extra || []).map(e => ({ file: e.file, page: e, chrome: e.chrome !== false }))
];

let drift = 0, changed = 0;
const boot = renderBoot(pal);

for (const e of entries) {
  const abs = path.join(ROOT, e.file);
  if (!fs.existsSync(abs)) { console.error('✗ 登记了但文件不存在：' + e.file); drift++; continue; }
  /* ⚠ 读进来先归一 CRLF：Windows 上 core.autocrlf=true 时 checkout 出来的是 CRLF，
     直接和生成的 LF 比会整片判成漂移（实测：全新 worktree 里三条零漂移测试全红）。 */
  const before = fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');
  let html = before;

  /* ① h2 补 id（幂等：已有 id 的不动） */
  const tagged = tagHeadings(html);
  html = tagged.html;
  nav.__toc = tagged.toc;
  nav.__minimal = !!e.page.minimal;

  /* ② 五类标记区（guide 只在页面里真的标了才写） */
  const blocks = [
    ['meta', renderMeta(nav, e.file, e.page)],
    ['boot', boot]
  ];
  if (e.chrome) {
    blocks.push(['head', renderHead(nav, e.file)]);
    if (html.includes(MARK.guide[0])) blocks.push(['guide', renderGuide(nav)]);
    blocks.push(['foot', renderFoot(nav, e.file, e.page)]);
  }
  for (const [name, body] of blocks) {
    const r = fillBlock(html, name, body);
    if (!r.ok) { console.error('✗ ' + e.file + '：' + r.why); drift++; continue; }
    html = r.html;
  }

  if (html === before) continue;
  changed++;
  if (CHECK) {
    drift++;
    const i = firstDiff(before, html);
    console.error('✗ 漂移：' + e.file + '（偏移 ' + i + '）');
  } else {
    fs.writeFileSync(abs, html, 'utf8');
  }
}

/* 孤儿页：磁盘上有、nav.json 里没有（只警告，不阻断） */
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => {
  if (d.name === 'node_modules' || d.name === '_release' || d.name.startsWith('.')) return [];
  const p = path.join(dir, d.name);
  return d.isDirectory() ? walk(p) : (d.name.endsWith('.html') ? [path.relative(ROOT, p).replace(/\\/g, '/')] : []);
});
const known = new Set(entries.map(e => e.file));
const orphans = walk(ROOT).filter(f => !known.has(f) && !f.startsWith('media/'));
if (orphans.length) console.log('· 未登记的页面（不影响构建）：' + orphans.join('、'));

if (CHECK) {
  if (drift) {
    console.error('\n' + drift + ' 个页面与 nav.json 不一致 —— 跑 `node tools/build-site.mjs`。');
    process.exit(1);
  }
  console.log('✓ 站点骨架零漂移（' + entries.length + ' 个页面）');
} else {
  console.log('✓ 站点骨架已写入：改动 ' + changed + ' / ' + entries.length + ' 个页面');
}

function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return n;
}
