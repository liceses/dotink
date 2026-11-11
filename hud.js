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
     c = { x, y, px, wt?, tracking?, lineH?, align?, knock?, knockPad?, texts: [{ t0, t1, lines: [...] }] }

     knock：先擦一条纸再写字（与 plate 的 knock 同一件事、同一个理由）。
       1-bit 上「实墨字」与「网点场」直接相遇会互相咬：实测 demo 的字幕带
       （1440×810、px 40、场是铺满的双源干涉）墨量 **45.51%**、横向墨列段 **21** 段 ——
       字和点连成一片，读不出「中间调由点的面积表达」；擦出一条净空后同一块降到
       **12.69% / 13 段**（13 = 12 个字 + 标点），字立刻可读。
       默认 false：老行为一字不改（marks / transition 等页的字幕本来就压在空场上）。
       参考件 media/phenomena-8/still-0*.png 的排法也是「母题绕开标题」，不是「标题压在母题上」。

     ⚠ 排字必须用**实测步进宽**（api.measureGlyph().adv），不能猜"半角 = px·0.5"：
       中文字宽就是 1em，按 0.5em 排会**重叠一倍**（实测 9 个字挤成 1 个墨团；
       demo/index.html 的三段字幕原先全是黑块）。西文按各自字宽走，空格只占位不落墨。 */
  function caption(c) {
    return function (api, t) {
      const band = (c.texts || []).find(L => t >= L.t0 && t < L.t1);
      if (!band) return;
      const px = c.px || 40, wt = c.wt || 700;
      const track = c.tracking || 0;                 /* 额外字距（CSS px） */
      const lineH = c.lineH || px * 1.34;
      const lines = band.lines || [];
      /* 先量一遍：align 要整行宽，knock 要净空的框 —— 两件事都得在落墨之前知道 */
      const measured = [];
      let widest = 0, top0 = Infinity, bot0 = -Infinity;
      for (let li = 0; li < lines.length; li++) {
        const text = lines[li];
        let total = 0;
        const advs = [];
        for (const ch of text) {
          const m = api.measureGlyph(ch, px, wt);
          advs.push(m.adv);
          total += m.adv + track;
        }
        if (total > widest) widest = total;
        /* 行心 y → 该行墨框的上/下边（top/bot 是相对 em 框顶的 CSS px 偏移） */
        const y = c.y + li * lineH;
        for (const ch of text) {
          if (ch === ' ') continue;
          const m = api.measureGlyph(ch, px, wt);
          if (m.top !== undefined) top0 = Math.min(top0, y - px / 2 + m.top);
          if (m.bot !== undefined) bot0 = Math.max(bot0, y - px / 2 + m.bot);
        }
        measured.push({ text: text, advs: advs, total: total });
      }
      /* 净空（可选）：擦一条纸再写字。框按**实测墨框**给，不按 px 猜 —— 中文黑体的字面率
         只有 ~0.74em，按 em 框擦会在上下各多擦掉半行网点（plate 那边踩过同一个坑）。 */
      if (c.knock && typeof api.clear === 'function') {
        const padX = c.knockPad === undefined ? px * 0.34 : c.knockPad;
        const padY = c.knockPadY === undefined ? px * 0.30 : c.knockPadY;
        const t0 = top0 === Infinity ? c.y - px / 2 : top0;
        const b0 = bot0 === -Infinity ? c.y + px / 2 : bot0;
        let left = c.x, w = widest;
        if (c.align === 'center') { left = c.x - widest / 2; }
        else if (c.align === 'right') { left = c.x - widest; }
        api.clear(left - padX, t0 - padY, w + padX * 2, (b0 - t0) + padY * 2);
      }
      for (let li = 0; li < lines.length; li++) {
        const r = measured[li], y = c.y + li * lineH;
        let x = c.x;
        if (c.align === 'center') x -= r.total / 2;
        else if (c.align === 'right') x -= r.total;
        for (let i = 0; i < r.text.length; i++) {
          const ch = r.text[i];
          if (ch !== ' ') api.glyph(ch, x + r.advs[i] / 2, y, px, wt);
          x += r.advs[i] + track;
        }
      }
    };
  }


  /* ── 画布内版式（§14 的落点）：一句大字标题 + 公式 + 来源，全在画布上（实墨层）──────
     参考件 media/phenomena-8/still-0*.png（1728×744）实测就是这么排的：大字标题在**下带**、
     占该带 11–14% 墨量、1-bit 硬边；小字公式/来源在**左上**。DOM 覆盖层两件事都违：
     ① §14「画面区域不压 DOM」；② §7-1 实测——DOM 字是反锯齿的，被逐帧渲染器拍进帧就是
     几千个灰阶像素（一行 12px 提示实测带进 2403 个）。所以标题必须走 api.glyph。

     cfg = {
       kicker / formula / source   —— 左上三行小字（可省任意行）
       title                       —— 大字标题，可用 \n 分多行
       x, top, bottom              —— 边距（CSS px）：小字距顶 / 标题**墨框底**距底
       px, wt, lineH               —— 标题字号 / 字重 / 行距（倍 px）
       smallPx / smallWt / smallLH / smallFont
       maxW, font                  —— 标题最大宽（超了自动缩字号）/ 标题字体
       knock                       —— 净空：true = 标题下面垫一块纸（api.clear 擦掉场里的墨）。
                                      参考件 still-0*.png 的母题是**绕开标题**的（不是标题压在网点上
                                      再读不出来）。擦除是 1-bit 合法的减法：格子值不翻，墨就不存在。
                                      默认 false（老行为不变），gallery 这类"母题铺满"的页要开。
     }
     与 hud/caption 同一种 (api, t) => void 纯函数叠加层。 */
  const PLATE_DEFAULTS = {
    x: 56, top: 26, bottom: 48,
    px: 60, wt: 700, lineH: 1.06, knock: false,
    smallPx: 13, smallWt: 500, smallLH: 1.62,
    smallFont: 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
  };
  function plate(c) {
    const q = Object.assign({}, PLATE_DEFAULTS, c || {});
    const small = [q.kicker, q.formula, q.source].filter(s => s !== undefined && s !== null && s !== '');
    /* 量一遍标题（排字只认实测 adv / top / bot，不猜 px 的倍数 —— 这是本库踩过两次的坑） */
    function layout(api) {
      const lines = String(q.title === undefined ? '' : q.title).split('\n');
      const maxW = q.maxW === undefined ? (api.cssW - 2 * q.x) : q.maxW;
      let px = q.px, rows = null;
      for (let guard = 0; guard < 48; guard++) {
        rows = lines.map(s => {
          let w = 0, h = 0, top = 0, bot = px, advs = [];
          for (const ch of s) {
            const m = api.measureGlyph(ch, px, q.wt, q.font);
            advs.push(m.adv); w += m.adv;
            if (m.bot - m.top > h) { h = m.bot - m.top; top = m.top; bot = m.bot; }
          }
          return { s: s, w: w, top: top, bot: bot, advs: advs };
        });
        const widest = rows.reduce((a, r) => Math.max(a, r.w), 0);
        if (widest <= maxW || px <= 16) break;
        px = Math.max(16, px - Math.max(1, Math.round(px * 0.06)));   /* 超宽就缩字号，不压字距 */
      }
      return { rows: rows, px: px };
    }
    return function (api, t) {
      const L = layout(api), px = L.px, n = L.rows.length;
      /* 净空（可选）：先擦一块纸，再把字写上去。
         参考件是**母题绕开标题**（still-08 的小字区墨量 ~8%，母题从 x≈700 才开始密）；
         直接把字压在场上的话，1-bit 上字和点会互相咬，谁都读不清。 */
      if (q.knock && typeof api.clear === 'function') {
        /* 小字区：左上三行（行高 smallLH）+ 一点边；标题区：下带整条 */
        if (small.length) {
          let wMax = 0;
          for (const ln of small) {
            let w = 0;
            for (const ch of ln) w += api.measureGlyph(ch, q.smallPx, q.smallWt, q.smallFont).adv;
            if (w > wMax) wMax = w;
          }
          api.clear(q.x - 10, q.top - 8, wMax + 20, small.length * q.smallPx * q.smallLH + 16);
        }
        if (n && L.rows.some(r => r.s)) {
          const widest = L.rows.reduce((a, r) => Math.max(a, r.w), 0);
          /* 用**首行墨框**算上边界（不能用 px 猜：bot−top 才是真墨高，中文黑体约 0.74em，
             按 px·1.0 猜会多擦掉一圈 —— 第一版就是这么擦歪的，测试当场抓到）。 */
          const r0 = L.rows.find(r => r.s) || L.rows[0];
          const inkBottom0 = api.cssH - q.bottom - (n - 1) * px * q.lineH;
          const top = inkBottom0 - (r0.bot - r0.top) - px * 0.10;
          api.clear(q.x - 12, top, Math.max(1, widest) + 24, api.cssH - q.bottom + px * 0.14 - top);
        }
      }
      /* 左上小字：按 em 框排，逐行往下，同一个左边界 */
      if (small.length) {
        const lp = q.smallPx, lh = lp * q.smallLH;
        for (let li = 0; li < small.length; li++) {
          let cx = q.x;
          const cy = q.top + li * lh + lp / 2;
          for (const ch of small[li]) {
            const m = api.measureGlyph(ch, lp, q.smallWt, q.smallFont);
            if (ch !== ' ') api.glyph(ch, cx + m.adv / 2, cy, lp, q.smallWt, q.smallFont);
            cx += m.adv;
          }
        }
      }
      /* 大字标题：墨框**底**对齐 bottom，多行往上叠 */
      for (let li = 0; li < n; li++) {
        const r = L.rows[li];
        if (!r.s) continue;
        const inkBottom = api.cssH - q.bottom - (n - 1 - li) * px * q.lineH;
        const cy = inkBottom - r.bot + px / 2;      /* inkBottom = cy − px/2 + bot */
        let x = q.x;
        for (let i = 0; i < r.s.length; i++) {
          const ch = r.s[i], adv = r.advs[i];
          if (ch !== ' ') api.glyph(ch, x + adv / 2, cy, px, q.wt, q.font);
          x += adv;
        }
      }
    };
  }

  global.DotInk = Object.assign(global.DotInk || {}, {
    hud: hud, caption: caption, plate: plate, hudDefaults: HUD_DEFAULTS, plateDefaults: PLATE_DEFAULTS,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
