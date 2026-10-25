/* render.js · 点墨的渲染核心：场 → 1-bit 帧
 * ============================================================================
 * 只管一件事：把"每格一份墨"画成**只有墨与纸两种像素**的画面。
 *
 * 三条实现纪律：
 *   ① 1-bit：compose() 之后任何像素非墨即纸（无灰阶、无 alpha 混合）
 *   ② 面积映射：r = rMax·√w —— 墨面积 ∝ w，才是线性调子（线性映射会让中间调整体偏亮）
 *   ③ 纯函数：draw(t) 同 t 两次逐像素一致；渲染路径无 Math.random / Date.now / CSS 过渡
 *
 * 本文件**不认识** HUD / 字幕 / 尺 —— 那些是叠加层：
 *   overlays: [ (api, t) => void, … ]    // 在 compose() 之后画进同一张 1-bit 帧
 *   api = { dot, glyph, opts, cols, rows, cell, rMax, scale, cssW, cssH, devW, devH }
 * 现成的尺/字幕在 hud.js（可选脚本）；判据在 judge.js（读 inst.core）。
 *
 * 经典脚本（file:// 下 ESM 会被 CORS 拦死）。挂 window.DotInk.render。
 * 依赖：无。
 * ============================================================================
 */
(function (global) {
  'use strict';

  const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

  /* ============================================================================
   * DEFAULTS —— 这些默认值就是标准（改之前先读 STANDARD.md）
   * ========================================================================== */
  const DEFAULTS = {
    /* 画布契约：与 B 线 / onetake 同一口径（1280×720 CSS，×1.5 = 真 1920×1080） */
    canvas: null, scale: 1.5, cssW: 1280, cssH: 720,

    /* 令牌：就是 wireframe 的 --ink / --paper（RGB 数组形式） */
    ink: [12, 13, 14], paper: [242, 243, 242],

    /* 网点几何 */
    cell: 12,              /* 点距（CSS px）。格 = cell×cell */
    cols: null, rows: null,/* 不给则按 cssW/cssH ÷ cell 推 */
    maxFrac: 0.48,         /* 满墨半径 rMax = maxFrac·cell。**上限 0.5**（点径=点距 → 相切，覆盖率≈π/4≈79%） */
    areaMap: true,         /* ★ r = rMax·√w（面积映射）配**原样**场；false = 线性 r = rMax·w 配**已标定**场
                              （pheno.js、fromImageData 默认 γ.45/×1.6）。按 STANDARD §3 配对，γ 只记一头 */

    /* 调子映射 */
    gain: 1.0,             /* w = min(1, v·gain) */
    gamma: 1.0,            /* v = field^gamma（<1 抬暗部，给细线留可见性） */
    floor: 0.035,          /* v·gain < floor → 当纸，不落墨（防底噪） */

    /* 场：函数 (i, cx, cy, t) => 0..1，或 {v: Float32Array}，或 Float32Array */
    field: null,
    /* 逐帧**点列**通道（与 field 互斥，优先级更高）：`(t) => Float32Array [x,y,r, x,y,r, …]`，
       x/y/r 全是 CSS px。给"粒子 / 沙粒"这类装置用 —— 颗粒各走各的，硬塞进网格会丢掉颗粒感
       （lab-field4 的 01 沙粒就是这么画的：3200 颗，颗粒半径 1.45 设备px ≈ 0.97 CSS px）。 */
    pointsAt: null,
    duration: 12,
    shutter: 1 / 28,       /* 运动模糊：两帧叠（t 与 t−shutter）。0 = 关 */
    seed: 1,

    /* 字形模式：用字代替点（字要读得清 —— 那是**实墨**的活，不是网点的活） */
    glyph: null,           /* {ch:'·', px:20, wt:600, cap:3.8, minPx:4.5, rMin:0.75} */

    /* 叠加层（尺 / 字幕 / 角标…）：单函数或数组，签名 (api, t)。不传 = 只有场。 */
    overlays: null,

    /* 净空分区（**格坐标**：列/行）：用来把墨分成"信息"与"装饰"（judge.js 读它） */
    regions: null,          /* {info:[{x,y,w,h}], deco:[{x,y,w,h}]} */
  };

  function merge(base, o) {
    const r = {};
    for (const k in base) r[k] = base[k];
    for (const k in o) {
      if (o[k] === undefined) continue;
      if (o[k] === false && base[k] && typeof base[k] === 'object') { r[k] = false; continue; }
      r[k] = (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k]) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]))
        ? merge(base[k], o[k]) : o[k];
    }
    return r;
  }

  /* ============================================================================
   * 参考实现
   * ========================================================================== */
  function create(opts) {
    const o = merge(DEFAULTS, opts || {});
    const cv = o.canvas;
    if (!cv) throw new Error('DotInk.create 需要 canvas（或把它交给 DotInk.host 建）');
    const S = o.scale, CW = o.cssW, CH = o.cssH;
    const DW = Math.round(CW * S), DH = Math.round(CH * S);
    if (cv.width !== DW || cv.height !== DH) { cv.width = DW; cv.height = DH; }
    const CTX = cv.getContext('2d', { alpha: false, willReadFrequently: false });
    const INK = o.ink, PAPER = o.paper;

    const COLS = o.cols || Math.max(2, Math.round(CW / o.cell));
    const ROWS = o.rows || Math.max(2, Math.round(CH / o.cell));
    const CS = CW / COLS;                       /* 实际格宽（CSS px） */
    const CELL = CS;                            /* 点距（CSS px）= 格宽 */
    const RMAX = o.maxFrac * CELL;              /* 满墨半径（CSS px） */

    /* 三块缓冲：纸底（PB）、当前帧（PX/IMG）、运动模糊累积掩膜（MASK） */
    const PB = new Uint8ClampedArray(DW * DH * 4);
    for (let k = 0; k < PB.length; k += 4) { PB[k] = PAPER[0]; PB[k + 1] = PAPER[1]; PB[k + 2] = PAPER[2]; PB[k + 3] = 255; }
    const IMG = CTX.createImageData(DW, DH), PX = IMG.data;
    const MASK = new Uint8Array(DW * DH);
    let draws = 0, lastT = 0;
    const clear = () => { PX.set(PB); };
    const toMask = () => { for (let i = 0, j = 0; i < PX.length; i += 4, j++) if (PX[i] < 128) MASK[j] = 1; };
    /* ① 1-bit 纪律的落点：非墨即纸，不留灰阶 */
    const compose = () => {
      for (let i = 0, j = 0; i < PX.length; i += 4, j++) {
        if (MASK[j]) { PX[i] = INK[0]; PX[i + 1] = INK[1]; PX[i + 2] = INK[2]; PX[i + 3] = 255; }
        else { PX[i] = PAPER[0]; PX[i + 1] = PAPER[1]; PX[i + 2] = PAPER[2]; PX[i + 3] = 255; }
      }
    };

    /* 解析圆盘：**像素中心落在真半径内**才算墨（旧版是 `Math.round(r·S)` 查整数表，
       那会把 0.06→0.165 这么宽的一段场值压成同一个点径 —— 调幅就断了）。
       包围盒按 ceil(rf) 走，再按画布边界收窄；半径本身不设上限（clamp 到边界即可）。 */
    const dot = function (cx, cy, r) {
      const x = Math.round(cx * S), y = Math.round(cy * S);
      if (x < 0 || y < 0 || x >= DW || y >= DH) return;
      const rf = r * S;
      if (!(rf > 0)) return;
      const r2 = rf * rf;
      const ed = Math.min(x, y, DW - 1 - x, DH - 1 - y);
      let lim = Math.ceil(rf); if (lim > ed) lim = ed; if (lim < 0) return;
      for (let dy = -lim; dy <= lim; dy++) {
        const dy2 = dy * dy, base = (y + dy) * DW;
        for (let dx = -lim; dx <= lim; dx++) {
          if (dx * dx + dy2 > r2) continue;
          const t = (base + x + dx) * 4;
          PX[t] = INK[0]; PX[t + 1] = INK[1]; PX[t + 2] = INK[2]; PX[t + 3] = 255;
        }
      }
    };

    /* ── 字形（可选）：字是**实墨**，不是网点。只在 glyph 模式 / 字幕里用 ── */
    const RC = new Map();
    let off = null, offCtx = null;
    const fontOf = () => o.glyph && o.glyph.font ? o.glyph.font
      : (getComputedStyle(document.body).fontFamily || 'sans-serif');
    function rasterGlyph(ch, px, wt) {
      const key = 'g|' + ch + '|' + px + '|' + wt;
      const hit = RC.get(key); if (hit) return hit;
      if (!off) { off = document.createElement('canvas'); off.width = 256; off.height = 256; offCtx = off.getContext('2d'); }
      offCtx.clearRect(0, 0, 256, 256);
      offCtx.font = (wt || 600) + ' ' + (px || 20) + 'px ' + fontOf();
      offCtx.textBaseline = 'top'; offCtx.fillStyle = '#000';
      offCtx.fillText(ch, 8, 8);
      const d = offCtx.getImageData(0, 0, 256, 256).data;
      const runs = []; let x0 = -1, wMax = 0, yMax = 0;
      /* 行段行程编码：只留 α>110 的实墨像素（与 1-bit 口径一致） */
      for (let y = 0; y < 256; y++) {
        const row = []; x0 = -1;
        for (let x = 0; x < 256; x++) {
          const on = d[(y * 256 + x) * 4 + 3] > 110;
          if (on && x0 < 0) x0 = x; else if (!on && x0 >= 0) { row.push([x0, x - 1]); x0 = -1; }
        }
        if (x0 >= 0) row.push([x0, 255]);
        if (row.length) { runs.push([y, row]); yMax = y + 1; for (const [a, b] of row) wMax = Math.max(wMax, b + 1); }
      }
      const rec = { w: wMax, h: yMax, runs };
      RC.set(key, rec);
      return rec;
    }
    function inkGlyph(ch, cx, cy, px, wt) {
      const L = rasterGlyph(ch, px, wt);
      const gl = o.glyph || {};                     /* 叠加层可以在没开 glyph 模式时用（字仍是实墨） */
      const f = Math.min(gl.cap || 3.8, px / (gl.px || 20));
      const ox = cx - L.w * f / 2, oy = cy - L.h * f / 2;
      for (let i = 0; i < L.runs.length; i++) {
        const y = L.runs[i][0];
        const yy0 = Math.round((oy + y * f) * S), yy1 = Math.round((oy + (y + 1) * f) * S);
        for (const [a, b] of L.runs[i][1]) {
          const x0 = Math.round((ox + a * f) * S), x1 = Math.round((ox + (b + 1) * f) * S);
          for (let yy = yy0; yy < Math.max(yy1, yy0 + 1); yy++) {
            if (yy < 0 || yy >= DH) continue;
            const rowBase = yy * DW;
            for (let xx = Math.max(0, x0); xx < Math.min(DW, Math.max(x1, x0 + 1)); xx++) {
              const t = (rowBase + xx) * 4;
              PX[t] = INK[0]; PX[t + 1] = INK[1]; PX[t + 2] = INK[2]; PX[t + 3] = 255;
            }
          }
        }
      }
    }

    /* ── 调子映射：**面积映射**是标准的核心公式 ── */
    function radiusOf(v) {
      const w = Math.min(1, v * o.gain);
      if (w <= 0 || w < o.floor) return 0;
      return o.areaMap ? RMAX * Math.sqrt(w) : RMAX * w;
    }

    /* ── 场求值 ──
       ⚠ 这里踩过一个**静默吞场**的坑（marks.html 的厂标墙全空，查了三轮）：
         原来的写法 `(o.field && (o.field instanceof Float32Array || …)) || null`
         在传 Float32Array 时整体求值成布尔 **true**（`&&` 返回的是条件表达式的值），
         于是 `staticField.v` 是 undefined → 场被当成"空"，一帧画 0 个点、不报错。
         现在用 `ArrayBuffer.isView` 判"是不是类型化数组"：**跨 realm 也成立**（CDP 注入的
         数组与页面不是同一个 realm，`instanceof` 会假否定），并且把数组本身取出来。 */
    const fld = o.field;
    const isView = (x) => !!x && (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(x));
    const staticV = isView(fld) ? fld : (fld && isView(fld.v) ? fld.v : null);
    const fnField = typeof fld === 'function' ? fld : null;
    const vAt = (i, cx, cy, t) => {
      let v;
      if (staticV) v = staticV[i] || 0;
      else if (fnField) v = fnField(i, cx, cy, t);
      else v = 0;
      v = clamp01(v);
      if (o.gamma !== 1) v = Math.pow(v, o.gamma);
      return v;
    };

    /* ── 一帧：把场画成点 ── */
    let ptsDrawn = 0;
    let dbg = null;                      /* 诊断口：哪条分支、第一格取值（见 debug()） */
    function paint(t) {
      ptsDrawn = 0;
      dbg = { mode: typeof o.pointsAt === 'function' ? 'points' : (o.glyph ? 'glyph' : 'grid'),
              cols: COLS, rows: ROWS, floor: o.floor, gain: o.gain, rmax: RMAX, cell: CELL,
              skippedFloor: 0, skippedR: 0, drawn: 0, v0: null, w0: null, r0: null };
      /* 点列通道（沙粒/粒子）：不走网格，直接按 (x,y,r) 落墨 —— 颗粒感才留得住 */
      if (typeof o.pointsAt === 'function') {
        const P = o.pointsAt(t);
        if (P) {
          for (let k = 0; k + 2 < P.length; k += 3) {
            const r = P[k + 2];
            if (r > 0) { dot(P[k], P[k + 1], r); ptsDrawn++; }
          }
        }
        return;
      }
      const gl = o.glyph;
      for (let cy = 0; cy < ROWS; cy++) {
        for (let cx = 0; cx < COLS; cx++) {
          const i = cy * COLS + cx;
          const v = vAt(i, cx, cy, t);
          const w = Math.min(1, v * o.gain);
          if (i === 0) { dbg.v0 = v; dbg.w0 = w; }
          if (w < o.floor) { dbg.skippedFloor++; continue; }   /* floor 之下当纸（防底噪） */
          const px = cx * CELL + CELL / 2, py = cy * CELL + CELL / 2;
          if (gl) {
            /* 字形模式：字要读得清才用字；小到读不清就降级成点（**降级半径 = rMin，全片一致**） */
            const size = RMAX * 2 * (o.areaMap ? Math.sqrt(w) : w);
            if (size >= (gl.minPx || 4.5)) {
              inkGlyph(gl.ch || '·', px, py, size, gl.wt || 600);
              ptsDrawn++; continue;
            }
            dot(px, py, gl.rMin === undefined ? 0.75 : gl.rMin);
            ptsDrawn++; continue;
          }
          const r = radiusOf(v);
          if (i === 0) dbg.r0 = r;
          if (r <= 0) { dbg.skippedR++; continue; }
          dot(px, py, r);
          dbg.drawn++;
          ptsDrawn++;
        }
      }
    }

    /* ── 叠加层：同一个 api 给所有 overlay，动的是同一张 1-bit 帧 ── */
    const OV = o.overlays ? (typeof o.overlays === 'function' ? [o.overlays] : o.overlays) : null;
    const LAYER = {
      dot: dot, glyph: inkGlyph,
      opts: o, cols: COLS, rows: ROWS, cell: CELL, rMax: RMAX,
      scale: S, cssW: CW, cssH: CH, devW: DW, devH: DH,
    };

    /* ── draw(t)：纯函数 ── */
    function draw(t) {
      draws = 0; lastT = t;
      MASK.fill(0);
      /* 运动模糊：快门内两帧取并集（不这样快速 3D 移动会频闪） */
      const sh = o.shutter || 0;
      clear(); paint(t + sh * 0.5); toMask();
      if (sh > 0) { clear(); paint(t - sh * 0.5); toMask(); }
      compose();
      if (OV && OV.length) {
        /* ⚠ 这里**不能** clear MASK —— 场已经记在掩膜里了；只需清 PX 再叠覆盖层，
           然后并进掩膜（toMask 只置 1、不清零）。曾经的写法会把整幅场擦掉。 */
        clear();
        for (let i = 0; i < OV.length; i++) OV[i](LAYER, t);
        toMask(); compose();
      }
      CTX.putImageData(IMG, 0, 0);
      draws = 1;
      return { t: t, draws: draws, points: ptsDrawn };
    }

    /* ── 内部量：judge.js 只读这里（不再回头摸闭包） ── */
    const core = {
      canvas: cv, ctx: CTX, ink: INK, paper: PAPER,
      devW: DW, devH: DH, scale: S, cssW: CW, cssH: CH,
      cols: COLS, rows: ROWS, cell: CELL, rMax: RMAX,
      opts: o, mask: MASK,
      radiusOf: radiusOf, valueAt: vAt,
      lastT: function () { return lastT; },
      points: function () { return ptsDrawn; },
      draws: function () { return draws; },
    };

    return {
      draw: draw, reset: function () { RC.clear(); },
      debug: function () { return dbg; },
      opts: o, cols: COLS, rows: ROWS, cell: CELL, rMax: RMAX,
      duration: o.duration, canvas: cv, draws: () => draws,
      core: core,
    };
  }

  /* 标准里的公式单独导出，便于测试与对照 */
  function radius(v, cell, maxFrac, areaMap, gain) {
    const w = Math.min(1, (v || 0) * (gain === undefined ? 1 : gain));
    if (w <= 0) return 0;
    const rMax = (maxFrac === undefined ? 0.48 : maxFrac) * cell;
    return (areaMap === false) ? rMax * w : rMax * Math.sqrt(w);
  }

  /* 圆盘偏移表已删（点径改解析圆盘，见 dot()）：`discMax` / `_disc` 不再导出。
     保留一个最小偏移表给需要"整数半径圆盘"的调用方自己用。 */
  function discOffsets(r) {
    const ri = Math.max(1, Math.round(r)), p = [];
    for (let dy = -ri; dy <= ri; dy++) for (let dx = -ri; dx <= ri; dx++) if (dx * dx + dy * dy <= ri * ri) p.push(dx, dy);
    return p;
  }

  /* 导出用**加法式**。旧的顶层别名（DEFAULTS / radius / discOffsets）保留。 */
  global.DotInk = Object.assign(global.DotInk || {}, {
    render: { create: create, DEFAULTS: DEFAULTS, merge: merge, radius: radius, discOffsets: discOffsets },
    DEFAULTS: DEFAULTS,
    radius: radius,
    discOffsets: discOffsets,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
