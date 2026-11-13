/* ============================================================================
 * theme.js · 配色切换（零依赖，`file://` 双击可用）
 * ----------------------------------------------------------------------------
 * ⚠ 这是**生成件**：由 `node tools/build-theme.mjs` 从 theme/palettes.json 生成。
 *   调色板数据内联在这里，是因为 `file://` 下 fetch 一个 json 会被 CORS 拦死 ——
 *   与 marks.js / logo.js 内联同一套做法。
 *
 * 对外：
 *   DotInkTheme.slugs()             → [slug, …]（顺序即切换器顺序）
 *   DotInkTheme.current()           → 当前 slug
 *   DotInkTheme.palette()           → {name,en,mode,conformance,note,canvas,ui}
 *   DotInkTheme.canvas()            → {ink:[r,g,b], paper:[r,g,b]}（给 DotInk.create）
 *   DotInkTheme.set(slug|null)      → 切换并持久化；null = 跟随系统
 *   DotInkTheme.onChange(fn)        → 登记回调（换色后自己重建画布，别改运行中的实例）
 *   DotInkTheme.mount(el?)          → 渲染切换器（页面里放 <div data-theme-switch>）
 *
 * 约定：画布不会自动重画。onChange 里必须**重建实例** —— render.js 的 ink/paper
 * 是创建时定下的，原地改色只会得到一帧里两种纸。
 * ========================================================================== */
(function (global) {
  'use strict';

  var PALETTES = {
    "original": { name: "原件", en: "ORIGINAL", mode: "light", conformance: "standard",
      note: "标准即默认。画布两个颜色逐位等于 STANDARD §1 的 ink/paper，不许改。",
      canvas: { ink: [12,13,14], paper: [242,243,242] },
      ui: { page: "#F2F3F2", panel: "#E4E7E6", fg: "#0C0D0E", fgDeep: "#22262A", fgMute: "#5A5F61", rule: "#D2D6D5", accent: "#FF4B1F", accentFg: "#0C0D0E", alert: "#B23A0D", focus: "#FF4B1F" } },
    "night": { name: "夜墨", en: "NIGHT INK", mode: "dark", conformance: "edition",
      note: "纸墨翻转。暗底上强调色反而更亮（6.84），六套里唯一越暗越好用的。",
      canvas: { ink: [242,243,242], paper: [12,13,14] },
      ui: { page: "#0C0D0E", panel: "#17191B", fg: "#F2F3F2", fgDeep: "#D8DCDD", fgMute: "#9AA0A2", rule: "#2A2E30", accent: "#FF6A3D", accentFg: "#0C0D0E", alert: "#FF8A66", focus: "#FF6A3D" } },
    "newsprint": { name: "新闻纸", en: "NEWSPRINT", mode: "light", conformance: "edition",
      note: "暖纸深褐墨，印刷感最强的一套。",
      canvas: { ink: [23,19,14], paper: [244,239,226] },
      ui: { page: "#F4EFE2", panel: "#EAE3D3", fg: "#17130E", fgDeep: "#2E271E", fgMute: "#5F564A", rule: "#D8CFBE", accent: "#B3261E", accentFg: "#F4EFE2", alert: "#B3261E", focus: "#B3261E" } },
    "cyanotype": { name: "蓝晒", en: "CYANOTYPE", mode: "light", conformance: "edition",
      note: "冷蓝铁锈红。墨/纸 11.67，比原件低一档但仍远过 AA。",
      canvas: { ink: [16,50,63], paper: [233,239,242] },
      ui: { page: "#E9EFF2", panel: "#DCE7EB", fg: "#10323F", fgDeep: "#1B4552", fgMute: "#4E6570", rule: "#C8D7DD", accent: "#B23A0D", accentFg: "#E9EFF2", alert: "#B23A0D", focus: "#B23A0D" } },
    "xerox": { name: "静电", en: "XEROX", mode: "light", conformance: "edition",
      note: "中性灰配电光蓝，最“机器”的一套，也是唯一强调色不走暖色的。",
      canvas: { ink: [17,17,18], paper: [236,236,234] },
      ui: { page: "#ECECEA", panel: "#E0E0DD", fg: "#111112", fgDeep: "#24242A", fgMute: "#59595B", rule: "#CFCFCC", accent: "#1B4DFF", accentFg: "#ECECEA", alert: "#1B4DFF", focus: "#1B4DFF" } },
    "vermilion": { name: "朱墨", en: "VERMILION", mode: "light", conformance: "edition",
      note: "米纸朱砂，最“东方”的一套。与新闻纸同属暖纸，看版面上二选一。",
      canvas: { ink: [42,36,32], paper: [246,241,231] },
      ui: { page: "#F6F1E7", panel: "#EDE6D8", fg: "#2A2420", fgDeep: "#3A322B", fgMute: "#6A6058", rule: "#DCD3C4", accent: "#A33B2A", accentFg: "#F6F1E7", alert: "#A33B2A", focus: "#A33B2A" } }
  };
  var ORDER = ["original","night","newsprint","cyanotype","xerox","vermilion"];
  var DEFAULT = "original";
  var DARK = "night";
  var KEY = 'dotink.theme';

  var listeners = [];
  var current = null;   /* null = 跟随系统 */

  /* ── 对比度（源码来自 tools/theme-core.mjs，不要在这里改）────────────── */
  function hexToRgb(hex) {
    const m = /^#([0-9a-fA-F]{6})$/.exec(String(hex || '').trim());
    if (!m) throw new Error('不是 6 位 hex：' + hex);
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function relLum(hex) {
    const [r, g, b] = hexToRgb(hex).map(v => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function contrast(a, b) {
    const x = relLum(a), y = relLum(b);
    const hi = Math.max(x, y), lo = Math.min(x, y);
    return (hi + 0.05) / (lo + 0.05);
  }
  var GATES = [{"key":"fg","against":"page","min":4.5,"why":"正文"},{"key":"fgDeep","against":"page","min":4.5,"why":"正文（深一档）"},{"key":"fgMute","against":"page","min":4.5,"why":"辅助文字"},{"key":"alert","against":"page","min":4.5,"why":"文字级强调"},{"key":"accentFg","against":"accent","min":4.5,"why":"强调底上的字"},{"key":"accent","against":"page","min":3,"why":"装饰 / UI 边界"},{"key":"rule","against":"page","min":1.2,"why":"描边（只需可见）"},{"key":"panel","against":"page","min":1.02,"why":"面板底（只需与纸区分）"}];
  function gatesOf(slug) {
    var p = PALETTES[slug], out = [];
    for (var i = 0; i < GATES.length; i++) {
      var g = GATES[i], v = contrast(p.ui[g.key], p.ui[g.against]);
      out.push({ key: g.key, against: g.against, min: g.min, why: g.why, value: v, ok: v >= g.min - 1e-9 });
    }
    return out;
  }

  function store(v) {
    try {
      if (v === null) global.localStorage.removeItem(KEY);
      else global.localStorage.setItem(KEY, v);
    } catch (e) { /* 沙箱 / 隐私模式下 localStorage 会抛：退化成"仅本次会话" */ }
  }
  function restore() {
    try {
      var v = global.localStorage.getItem(KEY);
      return v && PALETTES[v] ? v : null;
    } catch (e) { return null; }
  }
  function prefersDark() {
    try { return !!(global.matchMedia && global.matchMedia('(prefers-color-scheme:dark)').matches); }
    catch (e) { return false; }
  }
  function resolve() { return current || (prefersDark() ? DARK : DEFAULT); }

  function applyAttr(slug) {
    var el = global.document && global.document.documentElement;
    if (!el) return;
    if (slug === DEFAULT) el.removeAttribute('data-theme');
    else el.setAttribute('data-theme', slug);
    var meta = global.document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', PALETTES[slug].ui.page);
  }

  function emit() {
    var p = PALETTES[resolve()];
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](resolve(), p); } catch (e) { /* 一个回调炸了不该拖累别的 */ }
    }
  }

  function set(slug) {
    if (slug !== null && !PALETTES[slug]) throw new Error('没有这套配色：' + slug);
    current = slug;
    store(slug);
    applyAttr(resolve());
    emit();
    return resolve();
  }

  function mount(host) {
    var doc = global.document;
    if (!doc) return null;
    var box = host || doc.querySelector('[data-theme-switch]');
    if (!box) return null;
    box.innerHTML = '';
    var group = doc.createElement('div');
    group.className = 'theme-switch';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', '配色');
    function btn(slug, label, sw) {
      var b = doc.createElement('button');
      b.type = 'button';
      b.className = 'theme-dot';
      b.setAttribute('data-theme-slug', slug || 'auto');
      b.setAttribute('title', label);
      b.setAttribute('aria-label', label);
      if (sw) {
        b.style.background = sw.page;
        b.style.borderColor = sw.fg;
        b.style.color = sw.accent;
      }
      b.textContent = sw ? '' : 'A';
      b.addEventListener('click', function () { set(slug); paint(); });
      group.appendChild(b);
      return b;
    }
    for (var i = 0; i < ORDER.length; i++) {
      var s = ORDER[i];
      btn(s, PALETTES[s].name + ' ' + PALETTES[s].en, PALETTES[s].ui);
    }
    btn(null, '跟随系统', null);
    function paint() {
      var kids = group.children, now = resolve();
      for (var j = 0; j < kids.length; j++) {
        var on = kids[j].getAttribute('data-theme-slug') === (current || 'auto');
        kids[j].setAttribute('aria-pressed', on ? 'true' : 'false');
      }
      box.setAttribute('data-current', now);
    }
    paint();
    box.appendChild(group);
    return group;
  }

  current = restore();
  applyAttr(resolve());

  global.DotInkTheme = {
    pals: PALETTES,
    slugs: function () { return ORDER.slice(); },
    current: function () { return current; },
    resolved: resolve,
    palette: function () { return PALETTES[resolve()]; },
    canvas: function () {
      var c = PALETTES[resolve()].canvas;
      return { ink: c.ink.slice(), paper: c.paper.slice() };
    },
    set: set,
    onChange: function (fn) {
      if (typeof fn === 'function') listeners.push(fn);
      return function () { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
    },
    mount: mount,
    /* 验收口径：theme.html 直接用这两个渲染对比度表，数字与 check 同源 */
    contrast: contrast,
    GATES: GATES,
    gates: gatesOf
  };

  if (global.document) {
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', function () { mount(); });
    } else { mount(); }
    try {
      var mq = global.matchMedia && global.matchMedia('(prefers-color-scheme:dark)');
      if (mq && mq.addEventListener) mq.addEventListener('change', function () { if (!current) { applyAttr(resolve()); emit(); } });
    } catch (e) { /* 老浏览器没有 addEventListener，忽略 */ }
  }

  if (typeof module === 'object' && module && module.exports) module.exports = global.DotInkTheme;
})(typeof globalThis !== 'undefined' ? globalThis : this);
