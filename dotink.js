/* dotink.js · 点墨参考实现（v1.0）
 * ============================================================================
 * 一句话：**画面只有墨与纸两种像素**；所有中间调由**点的面积**表达。
 *
 * 这是 STANDARD.md 的可执行部分。三条实现纪律：
 *   ① 1-bit：compose() 之后任何像素非墨即纸（无灰阶、无 alpha 混合）
 *   ② 面积映射：r = rMax·√w —— 墨面积 ∝ w，才是线性调子（线性映射会让中间调整体偏亮）
 *   ③ 纯函数：draw(t) 同 t 两次逐像素一致；渲染路径无 Math.random / Date.now / CSS 过渡
 *
 * 经典脚本（file:// 下 ESM 会被 CORS 拦死）。挂 window.DotInk。
 * 依赖：无。
 * ============================================================================
 */
(function (global) {
  'use strict';

  /* ── 圆盘偏移表：DISC[r] = [dx,dy, dx,dy, …]（设备像素偏移，绘制时乘 DW） ── */
  const DISC_MAX = 64;
  const DISC = (function () {
    const out = [null];
    for (let r = 1; r <= DISC_MAX; r++) {
      const p = [];
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) p.push(dx, dy);
      }
      out.push(p);
    }
    return out;
  })();

  /* ── 可复现伪随机（渲染路径禁 Math.random） ── */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
  const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

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
    areaMap: true,         /* ★ r = rMax·√w（面积映射）。false = 线性 r = rMax·w → 中间调偏亮，只在对照试验里用 */

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
    /* 静的位/覆盖场：由 fields.* 构造器产出 */
    duration: 12,
    shutter: 1 / 28,       /* 运动模糊：两帧叠（t 与 t−shutter）。0 = 关 */
    seed: 1,

    /* 字形模式：用字代替点（字要读得清 —— 那是**实墨**的活，不是网点的活） */
    glyph: null,           /* {ch:'·', px:20, wt:600, cap:3.8, minPx:4.5, rMin:0.75} */

    /* 自绘 HUD（点构成的尺与读数）—— 属"装饰墨"，会被净空判据计入 */
    hud: true,
    hudC: { ruleY: 40, progY: 690, tcY: 12, ruleLen: 300 },
    caption: null,          /* {x,y,px,texts:[{t0,t1,lines:[]}]} */

    /* 净空分区（**格坐标**：列/行）：用来把墨分成"信息"与"装饰" */
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
   * 场的构造器（都返回 Float32Array，值域 0..1，行长 = cols*rows）
   * ========================================================================== */
  const fields = {
    /* 横条渐变：左 1 → 右 0 */
    ramp(cols, rows) {
      const v = new Float32Array(cols * rows);
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) v[y * cols + x] = 1 - x / (cols - 1);
      return v;
    },
    /* 双源干涉：两个点源的正弦干涉条纹（公式本身就是画面） */
    interference(cols, rows, o) {
      o = o || {};
      const s1 = o.s1 || [cols * 0.3, rows * 0.5], s2 = o.s2 || [cols * 0.7, rows * 0.5];
      const k = o.k || 0.55, phase = o.phase || 0;
      const v = new Float32Array(cols * rows);
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const d1 = Math.hypot(x - s1[0], y - s1[1]), d2 = Math.hypot(x - s2[0], y - s2[1]);
        const amp = Math.cos(k * d1 + phase) + Math.cos(k * d2 + phase);
        v[y * cols + x] = clamp01(0.5 + 0.25 * amp);
      }
      return v;
    },
    /* 平滑噪声（固定种子、多倍频） */
    noise(cols, rows, o) {
      o = o || {};
      const rnd = mulberry32(o.seed === undefined ? 1 : o.seed);
      const oct = o.octaves || 3, base = o.base || 4;
      const grids = [];
      for (let k = 0; k < oct; k++) {
        const w = Math.max(2, Math.round(base * Math.pow(2, k))), h = Math.max(2, Math.round(w * rows / cols));
        const g = new Float32Array(w * h);
        for (let i = 0; i < g.length; i++) g[i] = rnd();
        grids.push([w, h, g]);
      }
      const v = new Float32Array(cols * rows);
      let norm = 0; for (let k = 0; k < oct; k++) norm += 1 / Math.pow(2, k);
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        let s = 0;
        for (let k = 0; k < oct; k++) {
          const [w, h, g] = grids[k];
          const fx = x / cols * (w - 1), fy = y / rows * (h - 1);
          const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
          const sx = sstep(0, 1, tx), sy = sstep(0, 1, ty);
          const a = g[y0 * w + x0], b = g[y0 * w + Math.min(w - 1, x0 + 1)];
          const c = g[Math.min(h - 1, y0 + 1) * w + x0], d = g[Math.min(h - 1, y0 + 1) * w + Math.min(w - 1, x0 + 1)];
          s += ((a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy) / Math.pow(2, k);
        }
        v[y * cols + x] = clamp01(s / norm);
      }
      return v;
    },
    /* 距离场 → 覆盖率：shape(cx,cy) 返回"到形状的带符号距离（格为单位）" */
    sdf(cols, rows, shape, o) {
      o = o || {};
      const width = o.width || 2.0, floorV = o.floor === undefined ? 0 : o.floor;
      const v = new Float32Array(cols * rows);
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const d = shape(x + 0.5, y + 0.5);
        v[y * cols + x] = clamp01(floorV + (1 - floorV) * clamp01(0.5 - d / (2 * width)));
      }
      return v;
    },
    /* 真图 → 覆盖率场（img2field v2 的口径：**先二值化再算每格深色占比**，绝不做面积平均）
     * 为什么：白底细线的图做面积平均会被平均成 8%，整张图消失（踩过）。 */
    fromImageData(data, w, h, cols, rows, o) {
      o = o || {};
      const thr = o.thr === undefined ? 0.62 : o.thr;   /* 亮度阈值（0..1） */
      const gamma = o.gamma === undefined ? 0.45 : o.gamma;
      const gain = o.gain === undefined ? 1.6 : o.gain;
      const acc = new Float32Array(cols * rows), cnt = new Float32Array(cols * rows);
      for (let y = 0; y < h; y++) {
        const cy = Math.min(rows - 1, Math.floor(y / h * rows));
        for (let x = 0; x < w; x++) {
          const cx = Math.min(cols - 1, Math.floor(x / w * cols));
          const i = (y * w + x) * 4;
          const lum = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
          const dark = lum < thr ? 1 : 0;
          acc[cy * cols + cx] += dark; cnt[cy * cols + cx] += 1;
        }
      }
      const v = new Float32Array(cols * rows);
      for (let i = 0; i < v.length; i++) {
        const cov = cnt[i] ? acc[i] / cnt[i] : 0;                 /* 每格深色像素占比 */
        v[i] = clamp01(Math.pow(cov, gamma) * gain);
      }
      return v;
    },
    /* 双源干涉 —— **活的**版本：返回 fn(i,x,y,t)，相位随时间走（"动只能来自格子值在翻"） */
    interferenceFn(cols, rows, o) {
      o = o || {};
      const s1 = o.s1 || [cols * 0.3, rows * 0.5], s2 = o.s2 || [cols * 0.7, rows * 0.5];
      const k = o.k || 0.55, w = o.w || 0.25, speed = o.speed === undefined ? 1.4 : o.speed, drift = o.drift || 0;
      return function (i, x, y, t) {
        const p = speed * t;
        const yy = y + drift * Math.sin(t * 0.4);
        const d1 = Math.hypot(x - s1[0] - 1.5 * Math.sin(t * 0.31), yy - s1[1]);
        const d2 = Math.hypot(x - s2[0] + 1.5 * Math.cos(t * 0.27), yy - s2[1]);
        return clamp01(0.5 + w * (Math.cos(k * d1 + p) + Math.cos(k * d2 + p)));
      };
    },
    /* 把一张静态场**按整格滚动**（不插值）：格子值在翻，才是这类画面的动 */
    scrollFn(grid, cols, rows, o) {
      o = o || {};
      const vx = o.vx === undefined ? 1 : o.vx, vy = o.vy === undefined ? 0 : o.vy, sp = o.speed === undefined ? 3 : o.speed;
      return function (i, x, y, t) {
        const sx = ((x + Math.round(vx * sp * t)) % cols + cols) % cols;
        const sy = ((y + Math.round(vy * sp * t)) % rows + rows) % rows;
        return grid[sy * cols + sx] || 0;
      };
    },
    /* 1-bit 实墨：行段行程编码 → 场（"传真机"的口径：每个像素非墨即纸，保留全部细节）
     * runs: [[y, x0, x1], …]（像素坐标）；输出的场是**分辨率**而不是覆盖率 */
    bits(runs, cols, rows, w, h) {
      const on = new Uint8Array(cols * rows);
      for (const [y, x0, x1] of runs) {
        const cy = Math.min(rows - 1, Math.floor(y / h * rows));
        const a = Math.max(0, Math.floor(x0 / w * cols)), b = Math.min(cols - 1, Math.floor(x1 / w * cols));
        for (let cx = a; cx <= b; cx++) on[cy * cols + cx] = 1;
      }
      const v = new Float32Array(cols * rows);
      for (let i = 0; i < v.length; i++) v[i] = on[i];
      return v;
    },
  };

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

    const dot = (function () {
      return function (cx, cy, r) {
        const x = Math.round(cx * S), y = Math.round(cy * S);
        if (x < 0 || y < 0 || x >= DW || y >= DH) return;
        let rr = Math.round(r * S); if (rr < 1) rr = 1; if (rr > DISC_MAX) rr = DISC_MAX;
        const ed = Math.min(x, y, DW - 1 - x, DH - 1 - y); if (rr > ed) rr = ed; if (rr < 1) return;
        const p = DISC[rr];
        for (let i = 0; i < p.length; i += 2) {
          const t = ((y + p[i + 1]) * DW + (x + p[i])) * 4;
          PX[t] = INK[0]; PX[t + 1] = INK[1]; PX[t + 2] = INK[2]; PX[t + 3] = 255;
        }
      };
    })();

    /* ── 字形（可选）：字是**实墨**，不是网点。只在 glyph 模式用 ── */
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
      const gl = o.glyph || {};                     /* 字幕可以在没开 glyph 模式时用（字仍是实墨） */
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

    /* ── HUD（装饰墨）与字幕 ── */
    function drawHud(t) {
      if (!o.hud) return;
      const h = o.hudC;
      const prog = o.duration > 0 ? clamp01(t / o.duration) : 0;
      for (let x = 0; x < h.ruleLen; x += 2.4) dot(48 + x, h.ruleY, 0.85);
      for (let i = 0; i < 148; i++) dot(48 + i * 8.1, h.progY, (i / 147) <= prog ? 0.9 + 2.3 * (i / 147) : 0.5);
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
      const fr = Math.max(0, Math.round(t * 30));
      const tc = String(Math.floor(fr / 108000) % 10) + String(Math.floor(fr / 10800) % 10) + ':' +
        String(Math.floor(fr / 1800) % 6) + String(Math.floor(fr / 300) % 6) + ':' +
        String(Math.floor(fr / 30) % 10) + String(Math.floor(fr) % 30).padStart(2, '0');
      let ci = 0;
      for (const ch of tc) {
        const grid = F5[ch]; if (!grid) { ci++; continue; }
        const rowsT = grid.split(',');
        for (let ry = 0; ry < 7; ry++) for (let rx = 0; rx < 5; rx++)
          if (rowsT[ry][rx] === '1') dot(1037 + ci * 18 + rx * 3, h.tcY + ry * 3, 0.9);
        ci++;
      }
    }
    function drawCaption(t) {
      const c = o.caption; if (!c) return;
      const line = (c.texts || []).find(L => t >= L.t0 && t < L.t1);
      if (!line) return;
      const px = c.px || 40;
      let ci = 0;
      for (const ch of (line.lines || []).join('')) {
        inkGlyph(ch, c.x + ci * px * 0.5, c.y, px, 700);
        ci++;
      }
    }

    /* ── 测量：标准里的判据全靠它（数值，不是"觉得好看"） ── */
    function inkCount() { let n = 0; for (let j = 0; j < MASK.length; j++) if (MASK[j]) n++; return n; }
    function countIn(rect) {           /* rect 用**格坐标** */
      const x0 = Math.max(0, rect.x | 0), y0 = Math.max(0, rect.y | 0);
      const x1 = Math.min(COLS, x0 + (rect.w | 0)), y1 = Math.min(ROWS, y0 + (rect.h | 0));
      let n = 0;
      for (let cy = y0; cy < y1; cy++) for (let cx = x0; cx < x1; cx++) {
        const px = cx * CELL + CELL / 2, py = cy * CELL + CELL / 2;
        const x = Math.round(px * S), y = Math.round(py * S);
        /* 采样格心的 3×3：够用于分区统计，且与"这格有没有墨"同义 */
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= DW || yy >= DH) continue;
          if (MASK[yy * DW + xx]) n++;
        }
      }
      return n;
    }
    function measure() {
      const total = DW * DH;
      const ink = inkCount();
      const cover = ink / total;
      /* 中位点径：按**当前 t** 的场取值估（面积映射下 r ∝ √w）——判据必须跟着画面走 */
      const rs = [];
      for (let i = 0; i < COLS * ROWS; i++) {
        const cx = i % COLS, cy = (i / COLS) | 0;
        const r = radiusOf(vAt(i, cx, cy, lastT));
        if (r > 0) rs.push(r * 2 * S);
      }
      let pitchRatio = null;
      if (rs.length) { rs.sort((a, b) => a - b); const med = rs[rs.length >> 1]; if (med > 0) pitchRatio = (CELL * S) / med; }
      const out = {
        cell: CELL, cellDev: CELL * S, rMax: RMAX * S,
        pitchRatioAtFull: (CELL * S) / (RMAX * 2 * S),      /* 满墨时的 点距:点径 */
        pitchRatioMedian: pitchRatio,                        /* 该屏中位点径下的 点距:点径 */
        coverage: cover,                                     /* 全画布墨量占比 */
        points: ptsDrawn,
        /* 没有 regions 时也要给 null —— 曾经不给，judge() 里 `!== null` 判成"有值"，
           于是在 undefined 上调 .toFixed 抛错（画廊的判据面板因此整块空白）。 */
        decoVsInfo: null,
      };
      if (o.regions) {
        const sum = rs2 => rs2.reduce((a, r) => a + countIn(r), 0);
        const info = o.regions.info ? sum(o.regions.info) : 0;
        const deco = o.regions.deco ? sum(o.regions.deco) : 0;
        const iArea = (o.regions.info || []).reduce((a, r) => a + r.w * r.h, 0) * 9;
        const dArea = (o.regions.deco || []).reduce((a, r) => a + r.w * r.h, 0) * 9;
        out.info = { ink: info, area: iArea, ratio: iArea ? info / iArea : 0 };
        out.deco = { ink: deco, area: dArea, ratio: dArea ? deco / dArea : 0 };
        out.decoVsInfo = info > 0 ? deco / info : null;      /* ★ 净空判据 */
      }
      return out;
    }

    /* ── draw(t)：纯函数 ── */
    function draw(t) {
      draws = 0; lastT = t;
      MASK.fill(0);
      /* 运动模糊：快门内两帧取并集（不这样快速 3D 移动会频闪） */
      const sh = o.shutter || 0;
      clear(); paint(t + sh * 0.5); toMask();
      if (sh > 0) { clear(); paint(t - sh * 0.5); toMask(); }
      compose();
      if (o.hud || o.caption) {
        /* ⚠ 这里**不能** clear MASK —— 场已经记在掩膜里了；只需清 PX 再叠 HUD/字幕，
           然后并进掩膜（toMask 只置 1、不清零）。曾经的写法会把整幅场擦掉。 */
        clear(); drawHud(t); drawCaption(t);
        toMask(); compose();
      }
      CTX.putImageData(IMG, 0, 0);
      draws = 1;
      return { t: t, draws: draws, points: ptsDrawn };
    }

    /* 标准自检：把判据一次报全（preview 与片体都用它） */
    function judge(t) {
      const m = measure();
      const J = [];
      const add = (name, ok, val, rule) => J.push({ name: name, ok: ok, value: val, rule: rule });
      add('1-bit 无灰阶', true, 'compose() 保证', '硬');
      add('点距:点径（中位）', m.pitchRatioMedian === null ? null : m.pitchRatioMedian >= 3,
        m.pitchRatioMedian === null ? 'n/a' : m.pitchRatioMedian.toFixed(2) + ':1', '≥3:1（网点模式）');
      add('点径上限 ≤ 点距/2', (RMAX * 2) <= CELL + 1e-6, (RMAX * 2).toFixed(2) + '/' + CELL.toFixed(2) + 'px', 'maxFrac ≤ 0.5');
      add('覆盖率（当"面"用）', m.coverage >= 0.08, (m.coverage * 100).toFixed(2) + '%', '≥8%');
      add('覆盖率（看不见的下限）', m.coverage >= 0.02, (m.coverage * 100).toFixed(2) + '%', '≥2%（实测 1.4% 看不见）');
      if (m.decoVsInfo !== null && m.decoVsInfo !== undefined) add('装饰墨:信息墨', m.decoVsInfo <= 1.0,
        m.decoVsInfo.toFixed(2) + ':1', '≤1:1（目标 ≤0.33:1）');
      return { measures: m, checks: J, pass: J.every(x => x.ok !== false) };
    }

    return {
      draw: draw, judge: judge, measure: measure, reset: function () { RC.clear(); },
      debug: function () { return dbg; },
      opts: o, cols: COLS, rows: ROWS, cell: CELL, rMax: RMAX,
      duration: o.duration, canvas: cv, draws: () => draws,
    };
  }

  /* ============================================================================
   * host：给"独立短片"用的最小宿主 —— 实现 __seek / __ready / __meta 契约，
   * 这样任何逐帧渲染器（B 线 render.mjs、onetake render.py）都能直接渲它。
   * ========================================================================== */
  function host(opts) {
    const o = opts || {};
    const stage = document.getElementById(o.stage || 'stage') || document.body;
    let cv = document.getElementById('bleed');
    if (!cv) { cv = document.createElement('canvas'); cv.id = 'bleed'; stage.appendChild(cv); }
    const cssW = o.cssW || 1280, cssH = o.cssH || 720, S = o.scale || 1.5;
    cv.style.width = cssW + 'px'; cv.style.height = cssH + 'px';
    const inst = create(Object.assign({ canvas: cv, cssW: cssW, cssH: cssH, scale: S }, o));
    /* __meta 要满足 B 线 render.mjs 的读取面：dur / fps / w / h / kind / inFrame / **scenes**
       （render.mjs 用 scenes 分块投喂与报幕；不给 scenes 会 TypeError） */
    const scenes = (o.scenes && o.scenes.length) ? o.scenes : [{ i: 0, name: o.name || '全片', t0: 0, t1: inst.duration, dur: inst.duration }];
    window.__meta = { dur: inst.duration, fps: o.fps || 30, w: cssW, h: cssH, kind: o.kind || 'design', inFrame: o.inFrame || {}, scenes: scenes };
    /* 契约差异在一处抹平（两套渲染器的要求不一样）：
       · B 线 render.mjs：`typeof __ready === 'function'`，且会调 `__ready()` 与 `__seekInit()`
       · onetake render.py：`await window.__ready` —— 需要它是 thenable
       于是 __ready 做成"函数 + thenable"，两边都认。 */
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

  /* 导出用**加法式**，不要整体赋值：整体赋值会把后加载/预挂的其它件冲掉
     （踩过：pheno.js 在 dotink.js 之后加载时，DotInk.pheno 会被这一行抹掉）。 */
  global.DotInk = Object.assign(global.DotInk || {}, {
    version: '1.4.0',
    create: create, host: host, fields: fields,
    DEFAULTS: DEFAULTS, discMax: DISC_MAX,
    /* 标准里的公式单独导出，便于测试与对照 */
    radius: function (v, cell, maxFrac, areaMap, gain) {
      const w = Math.min(1, (v || 0) * (gain === undefined ? 1 : gain));
      if (w <= 0) return 0;
      const rMax = (maxFrac === undefined ? 0.48 : maxFrac) * cell;
      return (areaMap === false) ? rMax * w : rMax * Math.sqrt(w);
    },
    _disc: DISC, _mulberry32: mulberry32,
  });
})(typeof window !== 'undefined' ? window : this);
