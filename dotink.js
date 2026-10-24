/* dotink.js · 汇总入口（v2.0）
 * ============================================================================
 * 核心已拆成四个经典脚本（file:// 下 ESM 会被 CORS 拦死，所以还是 <script>）：
 *
 *   fields.js  → 场构造器（ramp / noise / interference / sdf / fromImageData / …）
 *   render.js  → 渲染核心（场 → 1-bit 帧；overlays 钩子）
 *   judge.js   → 判据（measure / judge / M1/M2/M3 门禁）
 *   host.js    → 独立短片的宿主契约（__seek / __ready / __meta）
 *   dotink.js  → 本文件：只做装配与导出
 *
 * 装载顺序就是上面的顺序，**本文件最后**。hud.js 是可选叠加层，不在核心里：
 *
 *   <script src="hud.js"></script>
 *   overlays: [ DotInk.hud(), DotInk.caption({ x, y, px, texts }) ]
 *
 * Node/CJS：require('./dotink.js') 会自己按顺序 require 兄弟文件。
 * ============================================================================
 */
(function (global) {
  'use strict';

  if (typeof module === 'object' && module && module.exports && typeof require === 'function') {
    try {
      require('./fields.js'); require('./render.js'); require('./judge.js'); require('./host.js');
    } catch (e) { /* 浏览器里被 define/module 误判时忽略：缺件由下面统一报 */ }
  }

  const D = global.DotInk || {};
  const missing = [];
  if (!D.fields) missing.push('fields.js');
  if (!D.render || typeof D.render.create !== 'function') missing.push('render.js');
  if (!D.judge || typeof D.judge.measure !== 'function') missing.push('judge.js');
  if (typeof D.host !== 'function') missing.push('host.js');
  if (missing.length) {
    throw new Error('DotInk 装配失败：缺 ' + missing.join(' / ') +
      '。装载顺序：fields.js → render.js → judge.js → host.js → dotink.js');
  }

  /* 装配版 create：渲染来自 render.js，measure()/judge() 来自 judge.js（读 inst.core）。
     两个方法挂回实例 —— 调用面与 v1 一致（inst.judge()）。 */
  function create(opts) {
    const inst = D.render.create(opts);
    inst.measure = function () { return D.judge.measure(inst.core); };
    inst.judge = function (t, o) { return D.judge.judge(inst.core, o); };
    return inst;
  }

  global.DotInk = Object.assign(D, { version: '2.0.0', create: create });

  if (typeof module === 'object' && module && module.exports) {
    module.exports = global.DotInk;
    module.exports.DotInk = global.DotInk;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);