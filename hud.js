/* hud.js · 点墨的可选叠加层：尺 / 进度 / 5×7 点阵时间码 / 实墨字幕
 * ============================================================================
 * 核心（dotink.js / render.js）**不认识 HUD** —— 想用就显式挂上：
 *
 *   const inst = DotInk.create({
 *     …,
 *     overlays: [ DotInk.hud({ ruleY: 40 }), DotInk.caption({ x: 96, y: 596, px: 40, texts }) ],
 *   });
 *
 * 两件都是 (api, t) => void 的纯函数式叠加层，画进同一张 1-bit 帧。
 * 它们属**装饰墨**：judge() 的净空判据（regions.deco）会把它们算进去 —— 所以别铺满。
 * 默认坐标是 1280×720 原生位置；换画幅请自己传 hudC 同款的键。
 *
 * 经典脚本（file:// 下 ESM 会被 CORS 拦死）。挂 window.DotInk.hud / .caption。
 * 依赖：无（只用叠加层 api.dot / api.glyph）。
 * ============================================================================
 */
(function (global) {
  'use strict';

  const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

  const HUD_DEFAULTS = {
    ruleY: 40,       /* 横尺的 y（CSS px） */
    progY: 690,      /* 进度条的 y */
    tcY: 12,         /* 时间码的 y（7 行点阵的左上） */
    ruleLen: 300,    /* 横尺长度 */
    ruleX: 48,       /* 横尺 / 进度条的起点 x */
    tcX: 1037,       /* 时间码起点 x */
  };

  /* 时间码用 5×7 点阵写（点墨的"字"） */
  const F5 = {
    '0': '01110,10001,10011,10101,11001,10001,01110', '1': '00100,01100,00100,00100,00100,00100,01110',
    '2': '01110,10001,00001,00010,00100,01000,11111', '3': '11111,00010,00100,00010,00001,10001,01110',
    '4': '00010,00110,01010,10010,11111,00010,00010', '5': '11111,10000,11110,00001,00001,10001,01110',
    '6': '00110,01000,10000,11110,10001,10001,01110', '7': '11111,00001,00010,00100,01000,01000,01000',
    '8': '01110,10001,10001,01110,10001,10001,01110', '9': '01110,10001,10001,01111,00001,00010,01100',
    ':': '00000,00100,00100,00000,00100,00100,00000', '.': '00000,00000,00000,00000,00000,00000,00100',
    '-': '00000,00000,00000,11111,00000,00000,00000',
  };

  /* 尺 + 进度 + 时间码 → overlay */
  function hud(opts) {
    const h = Object.assign({}, HUD_DEFAULTS, opts || {});
    return function (api, t) {
      const dot = api.dot;
      const prog = api.opts.duration > 0 ? clamp01(t / api.opts.duration) : 0;
      for (let x = 0; x < h.ruleLen; x += 2.4) dot(h.ruleX + x, h.ruleY, 0.85);
      for (let i = 0; i < 148; i++) dot(h.ruleX + i * 8.1, h.progY, (i / 147) <= prog ? 0.9 + 2.3 * (i / 147) : 0.5);
      /* 时间码：5×7 点阵，30fps */
      const fr = Math.max(0, Math.round(t * 30));
      const tc = String(Math.floor(fr / 108000) % 10) + String(Math.floor(fr / 10800) % 10) + ':' +
        String(Math.floor(fr / 1800) % 6) + String(Math.floor(fr / 300) % 6) + ':' +
        String(Math.floor(fr / 30) % 10) + String(fr % 30).padStart(2, '0');
      let ci = 0;
      for (const ch of tc) {
        const grid = F5[ch]; if (!grid) { ci++; continue; }
        const rowsT = grid.split(',');
        for (let ry = 0; ry < 7; ry++) for (let rx = 0; rx < 5; rx++)
          if (rowsT[ry][rx] === '1') dot(h.tcX + ci * 18 + rx * 3, h.tcY + ry * 3, 0.9);
        ci++;
      }
    };
  }

  /* 字幕（实墨层，不过网屏）→ overlay
     c = { x, y, px, texts: [{ t0, t1, lines: [...] }] } */
  function caption(c) {
    return function (api, t) {
      const line = (c.texts || []).find(L => t >= L.t0 && t < L.t1);
      if (!line) return;
      const px = c.px || 40;
      let ci = 0;
      for (const ch of (line.lines || []).join('')) {
        api.glyph(ch, c.x + ci * px * 0.5, c.y, px, 700);
        ci++;
      }
    };
  }

  global.DotInk = Object.assign(global.DotInk || {}, {
    hud: hud, caption: caption, hudDefaults: HUD_DEFAULTS,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
