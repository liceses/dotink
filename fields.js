/* fields.js · 点墨的场构造器
 * ============================================================================
 * 场是点墨的唯一输入：**每格一份墨 0..1**。两种形态可互换：
 *   · 静态：Float32Array（行主序，长度 cols×rows）
 *   · 动态：函数 (i, cx, cy, t) => 0..1（"动只能来自格子值在翻"）
 *
 * 本文件不碰 DOM、不建画布 —— 因此在 Node 里可直接测（见 check/core.mjs）。
 * 经典脚本（file:// 下 ESM 会被 CORS 拦死）。挂 window.DotInk.fields。
 * 依赖：无。
 * ============================================================================
 */
(function (global) {
  'use strict';

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

  /* 导出用**加法式**，不要整体赋值（会把后加载/预挂的其它件冲掉）。 */
  global.DotInk = Object.assign(global.DotInk || {}, {
    fields: fields,
    _mulberry32: mulberry32,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
