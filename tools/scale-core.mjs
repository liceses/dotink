/* ============================================================================
 * scale-core.mjs · 界面尺度的纯函数层（零依赖，被 build-scale.mjs 与 check/scale.mjs 共用）
 * ----------------------------------------------------------------------------
 * 为什么要有这个文件：与 theme-core.mjs 完全同构 —— 生成与验收必须用**同一套代码**
 * 算字阶与间距，否则"生成器说过了、检查器说不过"这种双口径迟早出现。
 *
 * 这里只读 scale.json、只产出字符串，不碰磁盘、不碰浏览器。
 * ========================================================================== */

/* ── 常量 ───────────────────────────────────────────────────────────────── */

export const SPACE_KEYS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10'];
export const FAMILIES = ['sans', 'mono'];

/** clamp(32px,5.2vw,64px) → {min:32,max:64,mid:'5.2vw'}；不是 clamp 就返回 null */
export function parseClamp(v) {
  const m = /^clamp\(\s*(\d+(?:\.\d+)?)px\s*,\s*([\d.]+vw)\s*,\s*(\d+(?:\.\d+)?)px\s*\)$/.exec(String(v || '').trim());
  if (!m) return null;
  return { min: Number(m[1]), mid: m[2], max: Number(m[3]) };
}

/** 令牌值 → 像素数（数值直接返回；clamp 取两端，返回 {min,max}）*/
export function pxOf(v) {
  if (typeof v === 'number') return v;
  const c = parseClamp(v);
  return c ? { min: c.min, max: c.max } : null;
}

/** × unit 判定（容忍浮点）*/
export function onLadder(v, unit) {
  if (typeof v !== 'number' || !isFinite(v)) return false;
  const q = v / unit;
  return Math.abs(q - Math.round(q)) < 1e-9;
}

/* ── 读盘 ───────────────────────────────────────────────────────────────── */

export function loadScale(root, fs, path) {
  return JSON.parse(fs.readFileSync(path.join(root, 'theme', 'scale.json'), 'utf8'));
}

/* ── 门禁（生成前必过）──────────────────────────────────────────────────── */

export function gates(json) {
  const out = [];
  const unit = json.unit;
  const add = (key, ok, value, why) => out.push({ key, ok, value, why });

  add('unit', Number.isInteger(unit) && unit > 0, unit, '--u 必须是正整数');

  /* 间距：全部是 unit 的倍数，且严格递增 */
  const space = json.space || {};
  let prev = -1;
  let spaceOk = true;
  for (const k of SPACE_KEYS) {
    const v = space[k];
    const ok = onLadder(v, unit) && v > prev;
    if (!ok) spaceOk = false;
    prev = v;
  }
  add('space.ladder', spaceOk, SPACE_KEYS.map(k => space[k]).join('/'), '间距阶必须递增且落在 --u 的整数倍上');

  const fluid = json.fluid || {};
  let fluidOk = true;
  for (const k of Object.keys(fluid)) {
    const c = parseClamp(fluid[k]);
    if (!c || !onLadder(c.min, unit) || !onLadder(c.max, unit) || c.max < c.min) fluidOk = false;
  }
  add('fluid.ends', fluidOk, Object.keys(fluid).join('/'), '自适应沟槽的两端必须是 --u 的倍数');

  /* 字阶：键唯一、字号是整数、**行高**落在阶上、行高 ≥ 字号、族合法
     —— 字号不必是 --u 的倍数（10 / 14 / 26 这类是字体的光学尺寸），
        版面节奏由行高与间距承担；把字号硬掰到 4 的倍数会让所有标题都长 2px。 */
  const keys = new Set();
  let typeOk = true;
  let lhOnLadder = true;
  let lhOk = true;
  let famOk = true;
  for (const t of json.type || []) {
    if (!t.key || keys.has(t.key)) typeOk = false;
    keys.add(t.key);
    if (t.fluid) {
      const c = parseClamp(t.size);
      if (!c || !onLadder(c.min, unit) || !onLadder(c.max, unit)) typeOk = false;
    } else if (!Number.isInteger(t.size)) {
      typeOk = false;
    }
    if (typeof t.lh === 'number') {
      /* lh ≤ 2 视为倍数（display/hero 用 1）；大于 2 视为 px，必须落在阶上 */
      const unitless = t.lh <= 2;
      if (!unitless && !onLadder(t.lh, unit)) lhOnLadder = false;
      if (!unitless && typeof t.size === 'number' && t.lh < t.size) lhOk = false;
      if (t.lh <= 0) lhOk = false;
    }
    if (!FAMILIES.includes(t.family)) famOk = false;
  }
  add('type.size', typeOk, (json.type || []).length + ' 档', '字号必须是整数 px（display 档允许 clamp，但两端要在阶上）');
  add('type.leading', lhOnLadder && lhOk, '', '行高必须是 --u 的整数倍且 ≥ 字号 —— 版面的节奏在行高，不在字号');
  add('type.family', famOk, FAMILIES.join('|'), '字族只能是 sans / mono（两套族够用，多一套就要多一份字体文件）');

  /* 线宽：只有两种，且 2 倍关系 */
  const line = json.line || {};
  add('line.two', line.hair === unit / 4 && line.frame === line.hair * 2, line.hair + '/' + line.frame,
    '只有两种线：1px 纸缝 / 2px 墨框（frame = hair × 2）');

  /* 中文最小字号：必须存在恰好这一档，否则"中文最小 12px"就只是句口号 */
  const minCjk = (json.lang || {}).minCjk;
  const hasCjkStep = (json.type || []).some(t => !t.fluid && t.size === minCjk);
  add('lang.minCjk', Number.isInteger(minCjk) && minCjk >= 12, minCjk, '中文最小字号不得小于 12px（10px 档只给拉丁与数字）');
  add('lang.step', hasCjkStep, '', '字阶里必须真有一档正好是 ' + minCjk + 'px —— 否则中文会落到 10px 那档上');

  return out;
}

/* ── 合法性（比门禁更硬的结构检查）────────────────────────────────────── */

export function validate(json) {
  const errs = [];
  if (!Number.isInteger(json.unit) || json.unit <= 0) errs.push('unit 必须是正整数');
  if (!Array.isArray(json.type) || json.type.length < 5) errs.push('type 至少要 5 档');
  if (!Array.isArray(json.lineHeight) || json.lineHeight.length > 8) errs.push('lineHeight 白名单不得超过 8 个');
  const seen = new Set();
  for (const t of json.type || []) {
    const tag = t.key || '(无 key)';
    if (!/^[a-z][a-z0-9-]*$/.test(t.key || '')) errs.push(tag + '：key 必须是 kebab-case');
    if (seen.has(t.key)) errs.push(tag + '：key 重复');
    seen.add(t.key);
    if (t.fluid) {
      if (!parseClamp(t.size)) errs.push(tag + '：fluid 档的 size 必须是 clamp(minpx,vw,maxpx)');
    } else if (typeof t.size !== 'number') {
      errs.push(tag + '：非 fluid 档的 size 必须是数字（px）');
    }
    if (!FAMILIES.includes(t.family)) errs.push(tag + '：family 只能是 ' + FAMILIES.join(' / '));
    if (typeof t.lh !== 'number' || t.lh <= 0) errs.push(tag + '：lh 必须是正数');
  }
  if (!json.space || !SPACE_KEYS.every(k => typeof json.space[k] === 'number')) {
    errs.push('space 必须含 ' + SPACE_KEYS.join(' '));
  }
  for (const k of ['gutter', 'section']) {
    if (!parseClamp((json.fluid || {})[k])) errs.push('fluid.' + k + ' 必须是 clamp(minpx,vw,maxpx)');
  }
  if (!json.line || json.line.hair !== 1 || json.line.frame !== 2) errs.push('line 必须是 {hair:1, frame:2}');
  if (!json.lang || json.lang.minCjk !== 12) errs.push('lang.minCjk 必须是 12');
  return errs;
}

/* ── 生成 scale.css ─────────────────────────────────────────────────────── */

const FAMILY_VAR = { sans: '--f-d', mono: '--f-m' };

/** 行高写法：≤2 是倍数（display 用 1），>2 是 px —— 与门禁的判定口径必须一致 */
function lhStr(t) {
  return t.lh <= 2 ? String(t.lh) : t.lh + 'px';
}

export function renderCss(json) {
  const L = [];
  L.push('/* ============================================================================');
  L.push(' * scale.css · 界面尺度（间距阶 / 字阶 / 线宽 / 时长）');
  L.push(' * ----------------------------------------------------------------------------');
  L.push(' * ⚠ 这是**生成件**：由 `node tools/build-scale.mjs` 从 theme/scale.json 生成。');
  L.push(' *   要改字号或间距请改 scale.json，然后重跑；check/scale.mjs 会比对逐字节一致。');
  L.push(' *');
  L.push(' * 为什么界面也要有阶：画布只有 0/1 两色、网点只有面积差别 —— 它没有中间调。');
  L.push(' * 界面如果留着 9.5px / 13.5px 这种半像素档，就等于在承诺一种画布给不了的分辨率。');
  L.push(' *');
  L.push(' * 引入顺序：theme.css → scale.css → ink.css → 页面自己的 <style>。');
  L.push(' * ========================================================================== */');
  L.push('');
  L.push(':root{');
  L.push('  /* 基础单位：4px。能整除画布点距 8 / 12 / 24；DPR 1 / 1.5 / 2 下都是整数设备像素 */');
  L.push('  --u:' + json.unit + 'px;');
  L.push('');
  L.push('  /* 间距阶（全部是 --u 的整数倍） */');
  const sp = SPACE_KEYS.map(k => '--' + k + ':' + json.space[k] + 'px;');
  for (let i = 0; i < sp.length; i += 5) L.push('  ' + sp.slice(i, i + 5).join(' '));
  L.push('  --s-gutter:' + json.fluid.gutter + '; --s-section:' + json.fluid.section + ';');
  L.push('');
  L.push('  /* 字阶：零件（--t-* 尺寸 / --lh-* 行高 / --tr-* 字距） */');
  for (const t of json.type) {
    const size = typeof t.size === 'number' ? t.size + 'px' : t.size;
    let line = '  --t-' + t.key + ':' + size + '; --lh-' + t.key + ':' + lhStr(t) + ';';
    if (t.tracking && t.tracking !== '0') line += ' --tr-' + t.key + ':' + t.tracking + ';';
    L.push(line);
  }
  L.push('');
  L.push('  /* 字阶：成品（font 简写；页面上写 font:var(--font-body)，不再出现数字） */');
  for (const t of json.type) {
    const size = typeof t.size === 'number' ? t.size + 'px' : t.size;
    L.push('  --font-' + t.key + ':' + t.weight + ' ' + size + '/' + lhStr(t) + ' var(' + FAMILY_VAR[t.family] + ');');
  }
  L.push('');
  L.push('  /* 线宽：只有两种 */');
  L.push('  --bw-hair:' + json.line.hair + 'px; --bw-frame:' + json.line.frame + 'px;');
  L.push('');
  L.push('  /* 时长：只有两档（界面没有"微妙"的过渡，STANDARD §9 禁的是渲染路径，不是 DOM） */');
  L.push('  --dur-fast:' + json.motion.fast + 'ms; --dur-base:' + json.motion.base + 'ms;');
  L.push('}');
  L.push('');
  return L.join('\n');
}

/* ── 生成 scale.js ──────────────────────────────────────────────────────── */

export function renderJs(json) {
  const L = [];
  L.push('/* ============================================================================');
  L.push(' * scale.js · 尺度数据（零依赖，`file://` 双击可用）');
  L.push(' * ----------------------------------------------------------------------------');
  L.push(' * ⚠ 这是**生成件**：由 `node tools/build-scale.mjs` 从 theme/scale.json 生成。');
  L.push(' *');
  L.push(' * 谁用它：system.html（设计系统页）拿它把样张现画出来 —— 于是"文档写的"与');
  L.push(' * "CSS 里生效的"永远是同一份数据，不会像手写文档那样慢慢漂走。');
  L.push(' *');
  L.push(' * 对外：DotInkScale.unit / .space / .fluid / .type / .line / .motion / .lang');
  L.push(' *       DotInkScale.onLadder(px)   → 这个值在不在阶上');
  L.push(' *       DotInkScale.pxRange(size)  → 数值原样返回；clamp 返回 {min,max}');
  L.push(' * ========================================================================== */');
  L.push('(function (global) {');
  L.push("  'use strict';");
  L.push('');
  L.push('  var unit = ' + json.unit + ';');
  L.push('  var space = ' + JSON.stringify(json.space) + ';');
  L.push('  var fluid = ' + JSON.stringify(json.fluid) + ';');
  L.push('  var line = ' + JSON.stringify(json.line) + ';');
  L.push('  var motion = ' + JSON.stringify(json.motion) + ';');
  L.push('  var lang = ' + JSON.stringify(json.lang) + ';');
  L.push('  var lineHeight = ' + JSON.stringify(json.lineHeight) + ';');
  L.push('  var type = [');
  const rows = json.type.map(t => {
    const parts = [
      'key: ' + JSON.stringify(t.key),
      'size: ' + (typeof t.size === 'number' ? t.size : JSON.stringify(t.size)),
      'lh: ' + t.lh,
      'family: ' + JSON.stringify(t.family),
      'weight: ' + t.weight,
      'tracking: ' + JSON.stringify(t.tracking || '0'),
      'note: ' + JSON.stringify(t.note || '')
    ];
    if (t.fluid) parts.push('fluid: true');
    return '    { ' + parts.join(', ') + ' }';
  });
  L.push(rows.join(',\n'));
  L.push('  ];');
  L.push('');
  L.push('  function onLadder(px) {');
  L.push('    if (typeof px !== "number" || !isFinite(px)) return false;');
  L.push('    var q = px / unit;');
  L.push('    return Math.abs(q - Math.round(q)) < 1e-9;');
  L.push('  }');
  L.push('');
  L.push('  function pxRange(size) {');
  L.push('    if (typeof size === "number") return size;');
  L.push('    var m = /^clamp\\(\\s*(\\d+(?:\\.\\d+)?)px\\s*,\\s*([\\d.]+vw)\\s*,\\s*(\\d+(?:\\.\\d+)?)px\\s*\\)$/.exec(String(size));');
  L.push('    return m ? { min: Number(m[1]), max: Number(m[3]), mid: m[2] } : null;');
  L.push('  }');
  L.push('');
  L.push('  var API = {');
  L.push('    unit: unit, space: space, fluid: fluid, type: type, line: line,');
  L.push('    motion: motion, lang: lang, lineHeight: lineHeight,');
  L.push('    onLadder: onLadder, pxRange: pxRange');
  L.push('  };');
  L.push('');
  L.push('  global.DotInkScale = API;');
  L.push("  if (typeof module === 'object' && module.exports) module.exports = API;");
  L.push("}(typeof window !== 'undefined' ? window : this));");
  L.push('');
  return L.join('\n');
}
