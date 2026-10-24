/* host.js · 独立短片的最小宿主：实现 __seek / __ready / __meta 契约
 * ============================================================================
 * 这样任何逐帧渲染器（B 线 render.mjs、onetake render.py）都能直接渲它：
 *   · B 线 render.mjs：`typeof __ready === 'function'`，且会调 `__ready()` / `__seekInit()`，
 *     并读 `__meta.scenes`（不给会 TypeError）
 *   · onetake render.py：`await window.__ready` —— 要的是 thenable
 * 于是 __ready 做成"**函数 + thenable**"，两边都认。
 *
 * 依赖 DotInk.create（汇总入口定义的装配版）—— 本文件要在 dotink.js **之前**加载。
 * 经典脚本。挂 window.DotInk.host。
 * ============================================================================
 */
(function (global) {
  'use strict';

  function host(opts) {
    const o = opts || {};
    const stage = document.getElementById(o.stage || 'stage') || document.body;
    let cv = document.getElementById('bleed');
    if (!cv) { cv = document.createElement('canvas'); cv.id = 'bleed'; stage.appendChild(cv); }
    const cssW = o.cssW || 1280, cssH = o.cssH || 720, S = o.scale || 1.5;
    cv.style.width = cssW + 'px'; cv.style.height = cssH + 'px';
    const inst = global.DotInk.create(Object.assign({ canvas: cv, cssW: cssW, cssH: cssH, scale: S }, o));
    /* __meta 要满足 B 线 render.mjs 的读取面：dur / fps / w / h / kind / inFrame / **scenes**
       （render.mjs 用 scenes 分块投喂与报幕；不给 scenes 会 TypeError） */
    const scenes = (o.scenes && o.scenes.length) ? o.scenes : [{ i: 0, name: o.name || '全片', t0: 0, t1: inst.duration, dur: inst.duration }];
    window.__meta = { dur: inst.duration, fps: o.fps || 30, w: cssW, h: cssH, kind: o.kind || 'design', inFrame: o.inFrame || {}, scenes: scenes };
    const readyFn = function () { return Promise.resolve(true); };
    readyFn.then = function (res, rej) { return Promise.resolve(true).then(res, rej); };
    window.__ready = readyFn;
    window.__seekInit = function () { inst.draw(0); return Promise.resolve(); };
    window.__seek = function (t) { inst.draw(t === undefined ? 0 : t); return Promise.resolve(); };
    /* check.mjs 会逐幕跳；独立片没有幕的概念就跳到该幕起点 */
    window.__seekJump = function (i) { const s = scenes[i] || scenes[0]; inst.draw(s ? s.t0 : 0); return Promise.resolve(); };
    /* B 线 render.mjs 只做一次存在性探测；本页不依赖线框引擎，给一个诚实的最小宿主位。 */
    if (typeof window.wireframeMotion === 'undefined') {
      window.wireframeMotion = {
        dotinkHost: true,
        getState: function () { return { cur: 0, clock: 0, tc: '', playing: false, k: 1, TOTAL: 1 }; },
        play: function () {}, pause: function () {}, go: function () {},
      };
    }
    if (new URLSearchParams(location.search).has('play')) {
      const t0 = performance.now();                   /* 只在 ?play 下走墙钟（渲染路径禁自动播） */
      (function loop() { inst.draw((performance.now() - t0) / 1000 % inst.duration); requestAnimationFrame(loop); })();
    } else inst.draw(0);
    return inst;
  }

  global.DotInk = Object.assign(global.DotInk || {}, { host: host });
})(typeof globalThis !== 'undefined' ? globalThis : this);
