/* 零依赖测试：界面尺度（不需要浏览器）
 * 跑法：node --test check/scale.mjs
 * 覆盖：scale.json 合法性 · 四条门禁 · 生成件零漂移 · 令牌齐全 · 裸字号禁令 ·
 *       离阶禁令 · 字体令牌单源 · 形制禁令（圆角/投影）· 引入顺序 · 行高种数
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, gates, renderCss, renderJs, SPACE_KEYS, onLadder } from '../tools/scale-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'theme', 'scale.json'), 'utf8').replace(/^\uFEFF/, ''));
const css = renderCss(json);
const js = renderJs(json);

/* ⚠ 归一 CRLF：Windows 上 core.autocrlf=true 时 checkout 出来是 CRLF */
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

/* 页面清单：跳过点开头目录 / node_modules / _release */
function pages() {
  const out = [];
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '_release' || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.html')) out.push(path.relative(ROOT, p).replace(/\\/g, '/'));
    }
  };
  walk(ROOT);
  return out.sort();
}

/* 豁免：
 * demo/index.html —— 最小接入示例，故意只留三行，不参与组件规范
 * tools/press-reel.html —— 片场夹具，不在站点内
 * system.html —— 设计系统页，样张必须显示"真值"，是唯一允许写数字的地方 */
const EXEMPT = new Set(['demo/index.html', 'tools/press-reel.html', 'system.html']);

/* 跳转壳：只有 theme.css + scale.css，不装 ink.css（没有可见界面） */
const SHELL = new Set(['index.html']);

/** 取页面里全部 <style> 的 CSS，并去掉注释（注释里写 12px 不该报红） */
function styleOf(file) {
  const html = read(file);
  const blocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]);
  return blocks.join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
}

function styleFiles() {
  return pages().filter(f => !EXEMPT.has(f));
}

test('scale.json：结构与枚举合法', () => {
  assert.deepEqual(validate(json), [], 'scale.json 必须无错');
  assert.ok(json.type.length >= 5 && json.type.length <= 9, '字阶 5–9 档');
  assert.equal(SPACE_KEYS.length, Object.keys(json.space).length, '间距阶必须是 s1…s10');
});

test('尺度上限：字号 ≤ 9 种、间距原子值 ≤ 10 种', () => {
  const sizes = new Set(json.type.map(t => (t.fluid ? 'clamp' : t.size)));
  assert.ok(sizes.size <= 9, '字号种数 ' + sizes.size + ' > 9');
  const spacings = new Set([...Object.values(json.space), json.unit]);
  assert.ok(spacings.size <= 10, '间距原子值 ' + spacings.size + ' > 10');
});

test('四条门禁全过（失败时打印是哪一条）', () => {
  const bad = gates(json).filter(g => !g.ok);
  assert.deepEqual(bad, [], bad.map(g => g.key + '：' + g.why).join('\n'));
});

test('生成件零漂移：scale.css 与 scale.json 一致', () => {
  assert.equal(read('scale.css'), css, '跑 node tools/build-scale.mjs');
});

test('生成件零漂移：scale.js 与 scale.json 一致', () => {
  assert.equal(read('scale.js'), js, '跑 node tools/build-scale.mjs');
});

test('scale.css：令牌齐全（间距 / 字阶 / 字距 / 线宽 / 时长）', () => {
  for (const k of SPACE_KEYS) assert.match(css, new RegExp('--' + k + ':\\d+px'), '缺 --' + k);
  assert.match(css, /--s-gutter:clamp\(/);
  assert.match(css, /--s-section:clamp\(/);
  for (const t of json.type) {
    assert.match(css, new RegExp('--t-' + t.key + ':'), '缺 --t-' + t.key);
    assert.match(css, new RegExp('--lh-' + t.key + ':'), '缺 --lh-' + t.key);
    assert.match(css, new RegExp('--font-' + t.key + ':'), '缺 --font-' + t.key);
  }
  assert.match(css, /--bw-hair:1px; --bw-frame:2px/);
  assert.match(css, /--dur-fast:\d+ms; --dur-base:\d+ms/);
});

test('scale.js：经典脚本，且不许偷偷 fetch 数据', () => {
  assert.ok(!/\bexport\b|\bimport\s/.test(js), '必须是经典脚本（双击可用）');
  assert.ok(!/fetch\(/.test(js), '不许 fetch（file:// 下会被 CORS 拦死）');
  assert.match(js, /global\.DotInkScale = API;/);
});

test('裸字号禁令：页面 <style> 里不许出现 font-size 数字 / font 简写里带 px 尺寸', () => {
  const bad = [];
  for (const f of styleFiles()) {
    const cssText = styleOf(f);
    for (const m of cssText.matchAll(/font-size\s*:\s*([^;}]+)/g)) {
      if (/\d+(?:\.\d+)?px/.test(m[1])) bad.push(f + '  font-size:' + m[1].trim());
    }
    for (const m of cssText.matchAll(/(^|[;{}\s])font\s*:\s*([^;}]+)/g)) {
      const v = m[2];
      if (/\d+(?:\.\d+)?px/.test(v)) bad.push(f + '  font:' + v.trim());
    }
  }
  assert.deepEqual(bad, [], '字号必须走 --t-* / --font-*：\n' + bad.join('\n'));
});

test('离阶禁令：padding / margin / gap 的 px 必须是 4 的倍数', () => {
  const SPACING = /^(padding|margin|gap|row-gap|column-gap)(-(top|right|bottom|left|block|inline))?$/;
  const bad = [];
  for (const f of [...styleFiles(), 'ink.css']) {
    const cssText = styleOf(f);
    for (const decl of cssText.split(';')) {
      const m = /^\s*([a-z-]+)\s*:\s*(.+)$/.exec(decl);
      if (!m || !SPACING.test(m[1])) continue;
      for (const n of m[2].matchAll(/(\d+)px/g)) {
        if (!onLadder(parseInt(n[1], 10), json.unit)) bad.push(f + '  ' + m[1] + ':' + n[1] + 'px');
      }
    }
  }
  assert.deepEqual(bad, [], '间距必须落在 ' + json.unit + 'px 阶上：\n' + bad.join('\n'));
});

test('字体令牌单源：--fd/--fm 出现 0 次，页面 :root 不许声明字体栈', () => {
  const bad = [];
  for (const f of [...styleFiles(), 'ink.css']) {
    const cssText = styleOf(f);
    if (/--fd\s*:|--fm\s*:/.test(cssText)) bad.push(f + ' 用了旧令牌名 --fd / --fm');
    if (f === 'ink.css') continue;
    for (const m of cssText.matchAll(/:root\s*\{([^}]*)\}/g)) {
      if (/font-family|--f-d\s*:|--f-m\s*:/.test(m[1])) bad.push(f + ' 在 :root 里重抄了字体栈');
    }
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('令牌单源：页面不许自己声明 --t-* / --lh-* / --s[0-9]+ 令牌', () => {
  const bad = [];
  for (const f of styleFiles()) {
    for (const m of styleOf(f).matchAll(/(--t-[a-z0-9-]+|--lh-[a-z0-9-]+|--s(?:[1-9]|10))\s*:/g)) {
      bad.push(f + ' 声明了 ' + m[1]);
    }
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('形制禁令：border-radius 只能是 0 或 50%（圆点），box-shadow 只许 inset / 0 0 0 环', () => {
  const bad = [];
  for (const f of [...styleFiles(), 'ink.css']) {
    const cssText = styleOf(f);
    for (const m of cssText.matchAll(/border-radius\s*:\s*([^;}]+)/g)) {
      const v = m[1].trim();
      if (v !== '0' && v !== '0px' && v !== '50%') bad.push(f + '  border-radius:' + v);
    }
    for (const m of cssText.matchAll(/box-shadow\s*:\s*([^;}]+)/g)) {
      const v = m[1].trim();
      /* 允许：inset 内阴影（下划线）、0 0 0 Npx 环（焦点/选中） */
      if (/^none$/i.test(v)) continue;
      if (/^inset\b/.test(v) || /^0\s+0\s+0\s+\d/.test(v)) continue;
      bad.push(f + '  box-shadow:' + v);
    }
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('引入顺序：theme.css → scale.css → ink.css', () => {
  for (const f of styleFiles().filter(x => !SHELL.has(x))) {
    const html = read(f);
    const at = s => html.indexOf(s);
    const t = at('href="theme.css"'), s = at('href="scale.css"'), i = at('href="ink.css"');
    assert.ok(t >= 0, f + ' 缺 theme.css');
    assert.ok(s >= 0, f + ' 缺 scale.css');
    assert.ok(i >= 0, f + ' 缺 ink.css');
    assert.ok(t < s && s < i, f + ' 引入顺序必须是 theme → scale → ink');
  }
});

test('行高种数 ≤ 8（含 font: 简写里的比值）', () => {
  const seen = new Map();
  for (const f of [...styleFiles(), 'ink.css']) {
    const cssText = styleOf(f);
    for (const m of cssText.matchAll(/font\s*:\s*[^;}]*?\/(\d*\.?\d+)/g)) {
      seen.set(m[1], (seen.get(m[1]) || 0) + 1);
    }
    for (const m of cssText.matchAll(/(?:^|[;{}\s])line-height\s*:\s*(\d*\.?\d+)/g)) {
      seen.set(m[1], (seen.get(m[1]) || 0) + 1);
    }
  }
  const keys = [...seen.keys()].sort();
  assert.ok(keys.length <= 8, '行高种数 ' + keys.length + ' > 8：' + keys.join(' / '));
});
