/* ============================================================================
 * theme-core.mjs · 配色令牌的纯函数层（零依赖，被 build-theme.mjs 与 check/theme.mjs 共用）
 * ----------------------------------------------------------------------------
 * 为什么要有这个文件：生成与验收必须用**同一套代码**算 CSS 与对比度，
 * 否则"生成器说过了、检查器说不过"这种双口径迟早出现（check-links 与 core 的跳过
 * 规则曾经就差点分裂过一次）。
 *
 * 这里只读 palettes.json、只产出字符串，不碰磁盘、不碰浏览器。
 * ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';

/* ── 颜色算术 ───────────────────────────────────────────────────────────── */

export function hexToRgb(hex) {
  const m = /^#([0-9a-fA-F]{6})$/.exec(String(hex || '').trim());
  if (!m) throw new Error('不是 6 位 hex：' + hex);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function relLum(hex) {
  const [r, g, b] = hexToRgb(hex).map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 对比度，返回 1…21 */
export function contrast(a, b) {
  const x = relLum(a), y = relLum(b);
  const hi = Math.max(x, y), lo = Math.min(x, y);
  return (hi + 0.05) / (lo + 0.05);
}

/** 对比度门禁：一条色的下限表（阈值改了这里一处就够） */
export const GATES = [
  { key: 'fg', against: 'page', min: 4.5, why: '正文' },
  { key: 'fgDeep', against: 'page', min: 4.5, why: '正文（深一档）' },
  { key: 'fgMute', against: 'page', min: 4.5, why: '辅助文字' },
  { key: 'alert', against: 'page', min: 4.5, why: '文字级强调' },
  { key: 'accentFg', against: 'accent', min: 4.5, why: '强调底上的字' },
  { key: 'accent', against: 'page', min: 3.0, why: '装饰 / UI 边界' },
  { key: 'rule', against: 'page', min: 1.2, why: '描边（只需可见）' },
  { key: 'panel', against: 'page', min: 1.02, why: '面板底（只需与纸区分）' }
];

/** 逐条算门禁，返回 [{key,against,min,value,ok,why}] */
export function gates(p) {
  return GATES.map(g => {
    const value = contrast(p.ui[g.key], p.ui[g.against]);
    return { key: g.key, against: g.against, min: g.min, value, ok: value >= g.min - 1e-9, why: g.why };
  });
}

/* ── 读盘 ───────────────────────────────────────────────────────────────── */

export function loadPalettes(root) {
  const file = path.join(root, 'theme', 'palettes.json');
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  return json;
}

export const UI_KEYS = ['page', 'panel', 'fg', 'fgDeep', 'fgMute', 'rule', 'accent', 'accentFg', 'alert', 'focus'];

/* ── 合法性 ─────────────────────────────────────────────────────────────── */

export function validate(json) {
  const errs = [];
  const seen = new Set();
  if (!Array.isArray(json.palettes) || !json.palettes.length) errs.push('palettes 必须是非空数组');
  if (!json.default) errs.push('缺 default');
  for (const p of json.palettes || []) {
    const tag = p.slug || '(无 slug)';
    if (!/^[a-z][a-z0-9-]*$/.test(p.slug || '')) errs.push(tag + '：slug 必须是 kebab-case');
    if (seen.has(p.slug)) errs.push(tag + '：slug 重复');
    seen.add(p.slug);
    if (!p.name || !p.en) errs.push(tag + '：缺 name / en');
    if (p.mode !== 'light' && p.mode !== 'dark') errs.push(tag + '：mode 只能是 light | dark');
    if (p.conformance !== 'standard' && p.conformance !== 'edition') errs.push(tag + '：conformance 只能是 standard | edition');
    for (const k of UI_KEYS) {
      try { hexToRgb(p.ui && p.ui[k]); } catch (e) { errs.push(tag + '：ui.' + k + ' 不是 6 位 hex'); }
    }
    const c = p.canvas || {};
    for (const k of ['ink', 'paper']) {
      const v = c[k];
      if (!Array.isArray(v) || v.length !== 3 || v.some(x => !Number.isInteger(x) || x < 0 || x > 255)) {
        errs.push(tag + '：canvas.' + k + ' 必须是 3 个 0–255 整数');
      }
    }
  }
  if (json.default && !seen.has(json.default)) errs.push('default 指向不存在的 slug：' + json.default);
  if (json.darkDefault && !seen.has(json.darkDefault)) errs.push('darkDefault 指向不存在的 slug：' + json.darkDefault);
  const std = (json.palettes || []).filter(p => p.conformance === 'standard');
  if (std.length !== 1) errs.push('conformance=standard 的必须恰好一套（现在是 ' + std.length + '）');
  return errs;
}

/* ── 生成 theme.css ─────────────────────────────────────────────────────── */

const rgbStr = arr => arr.join(',');

function varsBlock(p, indent) {
  const ui = p.ui;
  const c = p.canvas;
  /* 画布层不能直接用 ui.fg：画布是 RGB 三元组，且"与界面同值"只是巧合，不是契约 */
  const out = [];
  const hex = arr => '#' + arr.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  out.push(indent + '--c-ink:' + hex(c.ink) + '; --c-ink-rgb:' + rgbStr(c.ink) + ';');
  out.push(indent + '--c-paper:' + hex(c.paper) + '; --c-paper-rgb:' + rgbStr(c.paper) + ';');
  out.push(indent + '--page:' + ui.page + '; --page-rgb:' + rgbStr(hexToRgb(ui.page)) + ';');
  out.push(indent + '--panel:' + ui.panel + '; --fg:' + ui.fg + '; --fg-deep:' + ui.fgDeep + ';');
  out.push(indent + '--fg-mute:' + ui.fgMute + '; --rule:' + ui.rule + ';');
  out.push(indent + '--accent:' + ui.accent + '; --accent-rgb:' + rgbStr(hexToRgb(ui.accent)) + ';');
  out.push(indent + '--accent-fg:' + ui.accentFg + '; --alert:' + ui.alert + '; --focus:' + ui.focus + ';');
  return out.join('\n');
}

export function renderCss(json) {
  const all = json.palettes;
  const def = all.find(p => p.slug === json.default) || all[0];
  const L = [];
  L.push('/* ============================================================================');
  L.push(' * theme.css · 配色令牌（三层：画布 / 界面 / 兼容别名）');
  L.push(' * ----------------------------------------------------------------------------');
  L.push(' * ⚠ 这是**生成件**：由 `node tools/build-theme.mjs` 从 theme/palettes.json 生成。');
  L.push(' *   要改配色请改 palettes.json，然后重跑；check/theme.mjs 会比对逐字节一致。');
  L.push(' *');
  L.push(' * 三层令牌（STANDARD §1 的墨水纸只约束①，②是 DOM 界面，可以抗锯齿）：');
  L.push(' *   ① --c-ink / --c-paper      进 canvas 的两个颜色，由页面传给 DotInk.create({ink,paper})');
  L.push(' *   ② --page --panel --fg …    只有 DOM 用');
  L.push(' *   ③ --ink/--paper/--mute/--hair  兼容别名，旧页面不改一个字也能跟着换');
  L.push(' *');
  L.push(' * 引入顺序：theme.css → ink.css → 页面自己的 <style>。');
  L.push(' * ========================================================================== */');
  L.push('');
  L.push(':root{');
  L.push(varsBlock(def, '  '));
  L.push('  /* ③ 兼容别名（指向②，所以换主题时自动跟随） */');
  L.push('  --ink:var(--fg); --paper:var(--page); --mute:var(--fg-mute); --hair:var(--rule);');
  L.push('}');
  for (const p of all) {
    if (p.slug === def.slug) continue;
    L.push('');
    L.push('/* ' + p.name + ' ' + p.en + ' · ' + (p.conformance === 'standard' ? '标准' : 'edition') + ' · ' + p.mode + ' */');
    L.push('[data-theme="' + p.slug + '"]{');
    L.push(varsBlock(p, '  '));
    L.push('}');
  }
  L.push('');
  L.push('/* 打印：暗色主题打在纸上是全黑，强制回到默认套（html[data-theme] 的权重高于 [data-theme="…"]） */');
  L.push('@media print{');
  L.push('  html[data-theme]{');
  L.push(varsBlock(def, '    '));
  L.push('  }');
  L.push('}');
  L.push('');
  return L.join('\n');
}

/* ── 生成 theme.js ──────────────────────────────────────────────────────── */

export function renderJs(json) {
  const slim = {};
  for (const p of json.palettes) {
    slim[p.slug] = {
      name: p.name, en: p.en, mode: p.mode, conformance: p.conformance, note: p.note,
      canvas: { ink: p.canvas.ink.slice(), paper: p.canvas.paper.slice() },
      ui: Object.fromEntries(UI_KEYS.map(k => [k, p.ui[k]]))
    };
  }
  /* 手写紧凑字面量：JSON.stringify(…, null, 2) 会把 [12,13,14] 摊成三行，读起来像噪音 */
  const lit = [];
  for (const slug of Object.keys(slim)) {
    const p = slim[slug];
    lit.push(
      '    ' + JSON.stringify(slug) + ': { name: ' + JSON.stringify(p.name) +
      ', en: ' + JSON.stringify(p.en) + ', mode: ' + JSON.stringify(p.mode) +
      ', conformance: ' + JSON.stringify(p.conformance) + ',\n' +
      '      note: ' + JSON.stringify(p.note || '') + ',\n' +
      '      canvas: { ink: [' + p.canvas.ink.join(',') + '], paper: [' + p.canvas.paper.join(',') + '] },\n' +
      '      ui: { ' + UI_KEYS.map(k => k + ': ' + JSON.stringify(p.ui[k])).join(', ') + ' } }'
    );
  }
  const L = [];
  L.push('/* ============================================================================');
  L.push(' * theme.js · 配色切换（零依赖，`file://` 双击可用）');
  L.push(' * ----------------------------------------------------------------------------');
  L.push(' * ⚠ 这是**生成件**：由 `node tools/build-theme.mjs` 从 theme/palettes.json 生成。');
  L.push(' *   调色板数据内联在这里，是因为 `file://` 下 fetch 一个 json 会被 CORS 拦死 ——');
  L.push(' *   与 marks.js / logo.js 内联同一套做法。');
  L.push(' *');
  L.push(' * 对外：');
  L.push(' *   DotInkTheme.slugs()             → [slug, …]（顺序即切换器顺序）');
  L.push(' *   DotInkTheme.current()           → 当前 slug');
  L.push(' *   DotInkTheme.palette()           → {name,en,mode,conformance,note,canvas,ui}');
  L.push(' *   DotInkTheme.canvas()            → {ink:[r,g,b], paper:[r,g,b]}（给 DotInk.create）');
  L.push(' *   DotInkTheme.set(slug|null)      → 切换并持久化；null = 跟随系统');
  L.push(' *   DotInkTheme.onChange(fn)        → 登记回调（换色后自己重建画布，别改运行中的实例）');
  L.push(' *   DotInkTheme.mount(el?)          → 渲染切换器（页面里放 <div data-theme-switch>）');
  L.push(' *');
  L.push(' * 约定：画布不会自动重画。onChange 里必须**重建实例** —— render.js 的 ink/paper');
  L.push(' * 是创建时定下的，原地改色只会得到一帧里两种纸。');
  L.push(' * ========================================================================== */');
  L.push('(function (global) {');
  L.push("  'use strict';");
  L.push('');
  L.push('  var PALETTES = {');
  L.push(lit.join(',\n'));
  L.push('  };');
  L.push('  var ORDER = ' + JSON.stringify(json.palettes.map(p => p.slug)) + ';');
  L.push('  var DEFAULT = ' + JSON.stringify(json.default) + ';');
  L.push('  var DARK = ' + JSON.stringify(json.darkDefault || json.default) + ';');
  L.push("  var KEY = 'dotink.theme';");
  L.push('');
  L.push('  var listeners = [];');
  L.push('  var current = null;   /* null = 跟随系统 */');
  L.push('');
  /* 对比度：**同一份代码**（生成时把上面三个函数的源码 toString 过来），
   * 所以 theme.html 上算出来的数一定等于 check/theme.mjs 判的数。 */
  L.push('  /* ── 对比度（源码来自 tools/theme-core.mjs，不要在这里改）────────────── */');
  L.push('  ' + hexToRgb.toString().replace(/\n/g, '\n  '));
  L.push('  ' + relLum.toString().replace(/\n/g, '\n  '));
  L.push('  ' + contrast.toString().replace(/\n/g, '\n  '));
  L.push('  var GATES = ' + JSON.stringify(GATES) + ';');
  L.push('  function gatesOf(slug) {');
  L.push('    var p = PALETTES[slug], out = [];');
  L.push('    for (var i = 0; i < GATES.length; i++) {');
  L.push('      var g = GATES[i], v = contrast(p.ui[g.key], p.ui[g.against]);');
  L.push('      out.push({ key: g.key, against: g.against, min: g.min, why: g.why, value: v, ok: v >= g.min - 1e-9 });');
  L.push('    }');
  L.push('    return out;');
  L.push('  }');
  L.push('');
  L.push('  function store(v) {');
  L.push('    try {');
  L.push("      if (v === null) global.localStorage.removeItem(KEY);");
  L.push('      else global.localStorage.setItem(KEY, v);');
  L.push('    } catch (e) { /* 沙箱 / 隐私模式下 localStorage 会抛：退化成"仅本次会话" */ }');
  L.push('  }');
  L.push('  function restore() {');
  L.push('    try {');
  L.push('      var v = global.localStorage.getItem(KEY);');
  L.push('      return v && PALETTES[v] ? v : null;');
  L.push('    } catch (e) { return null; }');
  L.push('  }');
  L.push('  function prefersDark() {');
  L.push("    try { return !!(global.matchMedia && global.matchMedia('(prefers-color-scheme:dark)').matches); }");
  L.push('    catch (e) { return false; }');
  L.push('  }');
  L.push('  function resolve() { return current || (prefersDark() ? DARK : DEFAULT); }');
  L.push('');
  L.push('  function applyAttr(slug) {');
  L.push('    var el = global.document && global.document.documentElement;');
  L.push('    if (!el) return;');
  L.push('    if (slug === DEFAULT) el.removeAttribute(\'data-theme\');');
  L.push("    else el.setAttribute('data-theme', slug);");
  L.push('    var meta = global.document.querySelector(\'meta[name="theme-color"]\');');
  L.push('    if (meta) meta.setAttribute(\'content\', PALETTES[slug].ui.page);');
  L.push('  }');
  L.push('');
  L.push('  function emit() {');
  L.push('    var p = PALETTES[resolve()];');
  L.push('    for (var i = 0; i < listeners.length; i++) {');
  L.push('      try { listeners[i](resolve(), p); } catch (e) { /* 一个回调炸了不该拖累别的 */ }');
  L.push('    }');
  L.push('  }');
  L.push('');
  L.push('  function set(slug) {');
  L.push('    if (slug !== null && !PALETTES[slug]) throw new Error(\'没有这套配色：\' + slug);');
  L.push('    current = slug;');
  L.push('    store(slug);');
  L.push('    applyAttr(resolve());');
  L.push('    emit();');
  L.push('    return resolve();');
  L.push('  }');
  L.push('');
  L.push('  function mount(host) {');
  L.push('    var doc = global.document;');
  L.push('    if (!doc) return null;');
  L.push("    var box = host || doc.querySelector('[data-theme-switch]');");
  L.push('    if (!box) return null;');
  L.push("    box.innerHTML = '';");
  L.push("    var group = doc.createElement('div');");
  L.push("    group.className = 'theme-switch';");
  L.push("    group.setAttribute('role', 'group');");
  L.push("    group.setAttribute('aria-label', '配色');");
  L.push('    function btn(slug, label, sw) {');
  L.push("      var b = doc.createElement('button');");
  L.push("      b.type = 'button';");
  L.push("      b.className = 'theme-dot';");
  L.push("      b.setAttribute('data-theme-slug', slug || 'auto');");
  L.push("      b.setAttribute('title', label);");
  L.push("      b.setAttribute('aria-label', label);");
  L.push('      if (sw) {');
  L.push("        b.style.background = sw.page;");
  L.push("        b.style.borderColor = sw.fg;");
  L.push("        b.style.color = sw.accent;");
  L.push('      }');
  L.push("      b.textContent = sw ? '' : 'A';");
  L.push("      b.addEventListener('click', function () { set(slug); paint(); });");
  L.push('      group.appendChild(b);');
  L.push('      return b;');
  L.push('    }');
  L.push('    for (var i = 0; i < ORDER.length; i++) {');
  L.push('      var s = ORDER[i];');
  L.push('      btn(s, PALETTES[s].name + \' \' + PALETTES[s].en, PALETTES[s].ui);');
  L.push('    }');
  L.push("    btn(null, '跟随系统', null);");
  L.push('    function paint() {');
  L.push("      var kids = group.children, now = resolve();");
  L.push('      for (var j = 0; j < kids.length; j++) {');
  L.push("        var on = kids[j].getAttribute('data-theme-slug') === (current || 'auto');");
  L.push("        kids[j].setAttribute('aria-pressed', on ? 'true' : 'false');");
  L.push('      }');
  L.push("      box.setAttribute('data-current', now);");
  L.push('    }');
  L.push('    paint();');
  L.push('    box.appendChild(group);');
  L.push('    return group;');
  L.push('  }');
  L.push('');
  L.push('  current = restore();');
  L.push('  applyAttr(resolve());');
  L.push('');
  L.push('  global.DotInkTheme = {');
  L.push('    pals: PALETTES,');
  L.push('    slugs: function () { return ORDER.slice(); },');
  L.push('    current: function () { return current; },');
  L.push('    resolved: resolve,');
  L.push('    palette: function () { return PALETTES[resolve()]; },');
  L.push('    canvas: function () {');
  L.push('      var c = PALETTES[resolve()].canvas;');
  L.push('      return { ink: c.ink.slice(), paper: c.paper.slice() };');
  L.push('    },');
  L.push('    set: set,');
  L.push('    onChange: function (fn) {');
  L.push("      if (typeof fn === 'function') listeners.push(fn);");
  L.push('      return function () { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };');
  L.push('    },');
  L.push('    mount: mount,');
  L.push('    /* 验收口径：theme.html 直接用这两个渲染对比度表，数字与 check 同源 */');
  L.push('    contrast: contrast,');
  L.push('    GATES: GATES,');
  L.push('    gates: gatesOf');
  L.push('  };');
  L.push('');
  L.push("  if (global.document) {");
  L.push("    if (global.document.readyState === 'loading') {");
  L.push("      global.document.addEventListener('DOMContentLoaded', function () { mount(); });");
  L.push('    } else { mount(); }');
  L.push("    try {");
  L.push("      var mq = global.matchMedia && global.matchMedia('(prefers-color-scheme:dark)');");
  L.push("      if (mq && mq.addEventListener) mq.addEventListener('change', function () { if (!current) { applyAttr(resolve()); emit(); } });");
  L.push('    } catch (e) { /* 老浏览器没有 addEventListener，忽略 */ }');
  L.push('  }');
  L.push("");
  L.push("  if (typeof module === 'object' && module && module.exports) module.exports = global.DotInkTheme;");
  L.push("})(typeof globalThis !== 'undefined' ? globalThis : this);");
  L.push('');
  return L.join('\n');
}

/** boot 片段：放进每页 <head> 末尾，防 FOUC（内联，不阻塞、不报错） */
export function renderBoot(json) {
  const def = JSON.stringify(json.default);
  const dark = JSON.stringify(json.darkDefault || json.default);
  return [
    '<script>/* 防 FOUC：首帧之前就把主题定下来（规则与 theme.js 一致，别在这里加逻辑） */',
    '(function(){try{',
    "  var k='dotink.theme',v=localStorage.getItem(k),d=document.documentElement,pals=" + JSON.stringify((json.palettes || []).map(p => p.slug)) + ';',
    '  if(v&&pals.indexOf(v)<0)v=null;',
    "  if(!v&&window.matchMedia&&matchMedia('(prefers-color-scheme:dark)').matches)v=" + dark + ';',
    "  if(v&&v!==" + def + ")d.setAttribute('data-theme',v);",
    '}catch(e){}})();</script>'
  ].join('\n');
}
