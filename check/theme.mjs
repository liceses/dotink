/* 零依赖测试：配色令牌（不需要浏览器）
 * 跑法：node --test check/theme.mjs
 * 覆盖：palettes.json 合法性 · 对比度门禁 · 生成件零漂移 · 默认套的画布逐位等于标准 ·
 *       裸色禁令（页面 CSS 里不许出现 hex/rgba 数字）· 兼容别名 · 打印回落 · theme.js 无 ESM
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPalettes, validate, gates, contrast, renderCss, renderJs, hexToRgb } from '../tools/theme-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = loadPalettes(ROOT);
const css = renderCss(json);
const js = renderJs(json);

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

/* 页面清单：根目录的 10 个 + demo。跳过点开头目录 / node_modules / _release */
function pages() {
  const out = [];
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '_release' || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.html')) out.push(path.relative(ROOT, p));
    }
  };
  walk(ROOT);
  return out.sort();
}

test('palettes.json：结构与枚举合法', () => {
  assert.deepEqual(validate(json), [], 'palettes.json 必须无错');
  assert.ok(json.palettes.length >= 2, '至少两套配色');
});

test('palettes.json：恰好一套 standard，且它就是 default', () => {
  const std = json.palettes.filter(p => p.conformance === 'standard');
  assert.equal(std.length, 1);
  assert.equal(std[0].slug, json.default);
});

test('画布令牌：默认套必须逐位等于 STANDARD §1 的墨与纸', () => {
  const p = json.palettes.find(x => x.slug === json.default);
  assert.deepEqual(p.canvas.ink, [12, 13, 14], '墨必须是 [12,13,14]');
  assert.deepEqual(p.canvas.paper, [242, 243, 242], '纸必须是 [242,243,242]');
});

test('画布令牌：每套恰好两个颜色，3 个 0–255 整数，且不是同一个', () => {
  for (const p of json.palettes) {
    assert.equal(p.canvas.ink.length, 3, p.slug);
    assert.equal(p.canvas.paper.length, 3, p.slug);
    assert.notDeepEqual(p.canvas.ink, p.canvas.paper, p.slug + ' 的墨与纸不能相同');
    for (const v of [...p.canvas.ink, ...p.canvas.paper]) {
      assert.ok(Number.isInteger(v) && v >= 0 && v <= 255, p.slug + ' 画布值越界：' + v);
    }
  }
});

test('对比度门禁：六套全部达标（fail 时打印是哪一条）', () => {
  const bad = [];
  for (const p of json.palettes) {
    for (const g of gates(p)) {
      if (!g.ok) bad.push(`${p.slug} ${g.key}/${g.against} = ${g.value.toFixed(2)} < ${g.min}（${g.why}）`);
    }
  }
  assert.deepEqual(bad, [], '配色不过 AA：\n' + bad.join('\n'));
});

test('对比度算术：自反 1:1、黑白 21:1（防止对比度函数写错还全绿）', () => {
  assert.equal(contrast('#000000', '#000000'), 1);
  assert.ok(Math.abs(contrast('#000000', '#FFFFFF') - 21) < 1e-9);
  assert.equal(hexToRgb('#0C0D0E').join(','), '12,13,14');
});

test('生成件零漂移：theme.css 与 palettes.json 一致', () => {
  assert.equal(read('theme.css'), css, 'theme.css 与 palettes.json 不一致 —— 跑 node tools/build-theme.mjs');
});

test('生成件零漂移：theme.js 与 palettes.json 一致', () => {
  assert.equal(read('theme.js'), js, 'theme.js 与 palettes.json 不一致 —— 跑 node tools/build-theme.mjs');
});

test('theme.css：六套都有，且兼容别名指向②', () => {
  for (const p of json.palettes) {
    if (p.slug === json.default) assert.match(css, /^:root\{/m);
    else assert.ok(css.includes('[data-theme="' + p.slug + '"]{'), '缺主题块：' + p.slug);
  }
  assert.match(css, /--ink:var\(--fg\)/, '--ink 必须指向 --fg');
  assert.match(css, /--paper:var\(--page\)/, '--paper 必须指向 --page');
  assert.match(css, /--mute:var\(--fg-mute\)/);
  assert.match(css, /--hair:var\(--rule\)/);
});

test('theme.css：打印回落存在且权重高于主题块', () => {
  assert.match(css, /@media print\{[\s\S]*html\[data-theme\]\{/, '打印必须用 html[data-theme] 覆盖');
});

test('theme.js：是经典脚本（不许 import / export / fetch）', () => {
  assert.ok(!/^\s*(import|export)\s/m.test(js), 'theme.js 不能用 ESM（file:// 会被 CORS 拦）');
  assert.ok(!/\bfetch\s*\(/.test(js), 'theme.js 不许 fetch（file:// 读不了 json）');
  assert.match(js, /global\.DotInkTheme\s*=/, '必须挂到 global.DotInkTheme');
});

test('theme.js：onChange 回调里"重建"是唯一正确用法（至少有 API）', () => {
  assert.match(js, /onChange:\s*function/, '必须有 onChange');
  assert.match(js, /canvas:\s*function/, '必须有 canvas()');
});

test('裸色禁令：页面 CSS 与 ink.css 里不许出现 hex / rgba 数字', () => {
  /* 豁免：
   *   icon.html           品牌图标是标准自身的应用，色值必须锁死
   *   press.html          暖色在 <script> 里，是作品美术，不属站点配色
   *   demo/index.html     「最小接入」示例，故意不装主题（装了就不是最小了）
   *   tools/press-reel.html 离线出片工具，不出网
   */
  const EXEMPT = new Set(['icon.html', 'press.html', 'index.html', 'demo/index.html', 'tools/press-reel.html']);
  const bad = [];
  for (const rel of pages()) {
    if (EXEMPT.has(rel.replace(/\\/g, '/'))) continue;
    let html = read(rel);
    /* 只看 <style> 与 style="" 属性，脚本里的画布色不在此列（那是 JS 传参） */
    const styles = [];
    for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) styles.push(m[1]);
    for (const m of html.matchAll(/style="([^"]*)"/gi)) styles.push(m[1]);
    styles.forEach((s, i) => {
      const hits = s.match(/#[0-9A-Fa-f]{3,8}\b|rgba?\(\s*[0-9]/g) || [];
      for (const h of hits) bad.push(rel + ' <style#' + i + '> ' + h);
    });
  }
  /* ink.css 单独查（它是最容易被加回硬编码的地方） */
  const ink = read('ink.css');
  for (const h of ink.match(/#[0-9A-Fa-f]{3,8}\b|rgba?\(\s*[0-9]/g) || []) bad.push('ink.css ' + h);
  assert.deepEqual(bad, [], '这些地方写死了颜色，换主题会露白：\n' + bad.join('\n'));
});

test('页面引入顺序：theme.css 必须在 ink.css 之前', () => {
  const bad = [];
  for (const rel of pages()) {
    const html = read(rel);
    const ti = html.search(/<link[^>]*href="(\.\/)?theme\.css"/);
    const ii = html.search(/<link[^>]*href="(\.\/)?ink\.css"/);
    if (ii >= 0 && ti < 0) { bad.push(rel + '：装了 ink.css 却没装 theme.css'); continue; }
    if (ti >= 0 && ii >= 0 && ti > ii) bad.push(rel + '：theme.css 必须在 ink.css 之前');
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('每个用画布的页面都从令牌取色（不许自己写三元组）', () => {
  /* 豁免（每条都有理由，不是"暂时先放过"）：
   *   icon.html          品牌图标是**标准自身的应用**：它必须逐位等于 §1 的墨与纸，不能跟主题漂
   *   press.html         多版套印，ink 是多色 inks（P1–P4 另一套判据），不属这条口径
   *   demo/index.html    「最小接入」示例，故意不装 theme.js
   *   tools/press-reel.html 离线出片工具，自己起不了主题
   */
  const EXEMPT = new Set(['icon.html', 'press.html', 'demo/index.html', 'tools/press-reel.html']);
  const bad = [];
  for (const rel of pages()) {
    const key = rel.replace(/\\/g, '/');
    if (EXEMPT.has(key)) continue;
    const html = read(rel);
    if (!/render\.js/.test(html)) continue;         /* 不渲染的页不查 */
    if (!/DotInkTheme\.canvas\s*\(/.test(html)) bad.push(rel + '：画布没有从 DotInkTheme 取色');
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});
