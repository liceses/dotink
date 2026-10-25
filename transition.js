/* transition.js · 点墨的场转场：同网格、同调子编码的两张场 A → B
 * ============================================================================
 * 五种转场，全部是"**进度 p 的纯函数**"，差别只在"每格的次序 m"从哪来：
 *   · wipe      定向擦除：沿任意角度的一道前沿扫过去
 *   · radial    径向揭示：从一点向外开（或 invert：从外向内收）
 *   · dissolve  种子溶解：按固定种子的随机格序逐格（或逐块）换过去
 *   · tone      按墨量显影：按 B（或 A）每格的**墨量**排先后 —— 先暗后亮（invert：先亮后暗）
 *   · mask      遮罩揭示：按到字形 / logo 轮廓的**带符号距离**排先后 —— 从骨架长满字形再沿轮廓向外长
 *               （invert：从画幅四周向轮廓收拢，字形最后合上）
 *
 * 四条纪律（都是可测的，见 check/transition.mjs）：
 *   ① 端点严格：p ≤ 0 → 逐格**就是** A；p ≥ 1 → 逐格**就是** B（走分支，不靠浮点凑）
 *   ② 确定性：同参数两个实例、同 p 逐格相同；渲染路径无 Math.random / Date.now
 *   ③ 可倒放 / 随机 seek：输出只取决于 p，不取决于调用历史（没有内部播放状态）
 *   ④ 不改源场：from / to 只读；at() 写进新数组或调用方给的 out
 *
 * 调子编码（§3 的配对规则在转场里的落点）：
 *   A、B 必须**同网格**（cols×rows 一致）且**同编码** —— 都是"覆盖率原样"（配 √），
 *   或都是"已做感知标定"（配线性）。转场只在**场的值域里**做选择 / 插值，
 *   **从不再套 gamma**；renderHints 给出与编码配对的 render 选项（gamma 恒 1）。
 *   默认 blend:'select' —— 每一格每一刻都**恰好等于** A[i] 或 B[i]，不引入任何新调子，
 *   于是编码问题根本不会出现；blend:'mix' 只在过渡带内线性插值（在场域，不在半径域）。
 *
 * 与 markplate 的 morph / reveal 不是一回事（不要重复造）：
 *   · morph：两个厂标的**距离场**插值 —— 形状在融；这里从不插形状
 *   · reveal：阅读波按**字序**把墨从纸上浮出来（经过一张白纸）；这里 A 直接被 B 替换，不经过白纸
 *
 * 经典脚本（file:// 下 ESM 会被 CORS 拦死）。挂 window.DotInk.transition。
 * 依赖：无（不需要 dotink.js；放在它之前或之后都行）。
 * ============================================================================
 */
(function (global) {
  'use strict';

  const MODES = ['wipe', 'radial', 'dissolve', 'tone', 'mask'];
  const BYS = ['to', 'from'];
  /* 次序的进度分配（tone / mask 共用）：65% 按格数均分 + 35% 按键值差。
     键值差单个空档封顶 1/32 —— 二值图（墨量只有 0/1）不会在中间停一大段，
     连续调的图则保留"调子决定快慢"。 */
  const PACE_W = 0.35, PACE_GAP = 1 / 32;
  /* mask：形内占的进度份额 = 形内面积占比，夹在 [0.3, 0.6] */
  const MASK_SHARE = [0.3, 0.6];
  const INF = 1e20;
  const BLENDS = ['select', 'mix'];
  /* 编码 → 与之配对的半径映射（STANDARD §3）。gamma 恒 1：标定只许记在一头。 */
  const ENCODINGS = {
    coverage:   { areaMap: true,  note: '场是覆盖率原样（物理量）→ r = rMax·√w' },
    calibrated: { areaMap: false, note: '场已做感知标定（自带 gamma）→ r = rMax·w' },
  };
  /* 切换点上限：严格 < 1，保证 p 逼近 1 时所有格都已切换（p ≥ 1 另有分支兜底） */
  const SW_MAX = 1 - 1e-12;

  const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
  const isView = x => !!x && typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(x) && typeof x.length === 'number';
  /* 不同视图也可能改到同一段源内存；同 buffer 的不重叠区间仍可作为输出。 */
  const overlapsSource = (out, src) => !!src && isView(out) && out.buffer === src.buffer &&
    out.byteOffset < src.byteOffset + src.byteLength && src.byteOffset < out.byteOffset + out.byteLength;

  /* 无状态整数哈希 → [0,1)：同 (seed, k) 永远同值（lowbias32 的混合常数） */
  function hash01(seed, k) {
    let h = (seed ^ Math.imul(k + 0x632BE5AB, 0x9E3779B1)) >>> 0;
    h ^= h >>> 16; h = Math.imul(h, 0x7FEB352D);
    h ^= h >>> 15; h = Math.imul(h, 0x846CA68B);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  /* 缓动（可选；进度怎么走是调用方的事）。端点精确：ease(0)=0、ease(1)=1。 */
  const ease = {
    linear: p => clamp01(p),
    inOut: p => { p = clamp01(p); return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; },
  };

  /* 源：Float32Array（或任意类型化数组）/ {v: 数组} / 函数 (i,x,y,t) */
  function asSource(src, n, name) {
    if (typeof src === 'function') return { kind: 'fn', fn: src, v: null };
    const v = isView(src) ? src : (src && isView(src.v) ? src.v : null);
    if (!v) throw new TypeError('DotInk.transition: ' + name + ' 必须是类型化数组、{v: 数组} 或函数 (i,x,y,t)');
    if (v.length !== n) throw new RangeError('DotInk.transition: ' + name + ' 长度 ' + v.length + ' ≠ cols×rows = ' + n + '（A/B 必须同网格）');
    return { kind: 'array', fn: null, v: v };
  }

  function num(x, dflt) { const v = Number(x); return Number.isFinite(v) ? v : dflt; }

  /* 键 → 次序 m ∈ [0,1]。键小的先换；同键按种子哈希打散（不按格号扫，免得出现行扫描纹）。
     返回 flat = 键处处相同（此时 m 就是纯种子次序 = 溶解）。 */
  function pace(key, seed) {
    const n = key.length, m = new Float64Array(n);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) { const k = key[i]; if (k < lo) lo = k; if (k > hi) hi = k; }
    const span = hi - lo, flat = !(span > 1e-12);
    const tie = new Float64Array(n), idx = new Array(n), ts = (seed ^ 0xA511E9B3) >>> 0;
    for (let i = 0; i < n; i++) { tie[i] = hash01(ts, i); idx[i] = i; }
    idx.sort((a, b) => (key[a] - key[b]) || (tie[a] - tie[b]) || (a - b));
    if (n < 2) return { m: m, flat: flat };
    const step = (1 - PACE_W) / (n - 1);
    let c = 0;
    for (let r = 1; r < n; r++) {
      const gap = flat ? 0 : (key[idx[r]] - key[idx[r - 1]]) / span;
      c += step + PACE_W * Math.min(gap, PACE_GAP);
      m[idx[r]] = c;
    }
    for (let i = 0; i < n; i++) m[i] /= c;
    return { m: m, flat: flat };
  }

  /* 精确欧氏距离变换（Felzenszwalb–Huttenlocher，O(n)）：每格到最近"特征格"的平方距离（格为单位） */
  function edt1(f, n, d, v, z) {
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const dq = q - v[k]; d[q] = dq * dq + f[v[k]]; }
  }
  function edt(feature, cols, rows) {
    const g = new Float64Array(cols * rows), L = Math.max(cols, rows);
    const f = new Float64Array(L), d = new Float64Array(L), v = new Int32Array(L), z = new Float64Array(L + 1);
    for (let i = 0; i < g.length; i++) g[i] = feature[i] ? 0 : INF;
    for (let x = 0; x < cols; x++) {
      for (let y = 0; y < rows; y++) f[y] = g[y * cols + x];
      edt1(f, rows, d, v, z);
      for (let y = 0; y < rows; y++) g[y * cols + x] = d[y];
    }
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) f[x] = g[y * cols + x];
      edt1(f, cols, d, v, z);
      for (let x = 0; x < cols; x++) g[y * cols + x] = d[x];
    }
    return g;
  }

  /* 遮罩 → 每格带符号距离（格；内负外正，与 fields.sdf 的 shape(cx,cy) 同号）。
     · 函数：就是 fields.sdf 用的那个 shape(x, y)，在格心 (x+.5, y+.5) 取值 —— 解析、平滑
     · 数组：覆盖率场（≥ 0.5 算形内），在格网上做精确 EDT；轮廓两侧各差半格 */
  function maskDistance(mask, cols, rows) {
    const n = cols * rows, d = new Float64Array(n);
    if (typeof mask === 'function') {
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const v = Number(mask(x + 0.5, y + 0.5));
        if (Number.isNaN(v)) throw new RangeError('DotInk.transition: mask 函数在格 (' + x + ',' + y + ') 返回 NaN');
        d[y * cols + x] = v > 1e9 ? 1e9 : v < -1e9 ? -1e9 : v;
      }
      return { d: d, empty: false, full: false };
    }
    const v = isView(mask) ? mask : (mask && isView(mask.v) ? mask.v : null);
    if (!v) throw new TypeError('DotInk.transition: mode "mask" 需要 mask —— 覆盖率数组（≥0.5 为形内）、{v: 数组}，或 fields.sdf 式距离函数 (x, y) → 带符号格距');
    if (v.length !== n) throw new RangeError('DotInk.transition: mask 长度 ' + v.length + ' ≠ cols×rows = ' + n + '（遮罩必须同网格）');
    const inside = new Uint8Array(n), outside = new Uint8Array(n);
    let nin = 0;
    for (let i = 0; i < n; i++) { if (v[i] >= 0.5) { inside[i] = 1; nin++; } else outside[i] = 1; }
    if (nin === 0 || nin === n) return { d: d, empty: nin === 0, full: nin === n };   /* d 全 0 → 键平 → 种子次序 */
    const dOut = edt(inside, cols, rows), dIn = edt(outside, cols, rows);
    for (let i = 0; i < n; i++) d[i] = inside[i] ? -(Math.sqrt(dIn[i]) - 0.5) : Math.sqrt(dOut[i]) - 0.5;
    return { d: d, empty: false, full: false };
  }

  /* ── 每格的"基准次序" m ∈ [0,1]：越小越早换 ── */
  function baseOrder(P, cols, rows, ctx) {
    if (P.mode === 'tone') {
      /* 墨量 = 这一格真正落到纸上的墨面积占比，按编码换算，**只换算一次**：
         coverage   场值就是覆盖率            → ink = v
         calibrated 场值带 γ，半径线性，面积 ∝ v² → ink = v²
         （拿 calibrated 的 v 直接当墨量 = 把 γ 再记一遍；对 coverage 开方也是同一个错）
         量化到 1e-6：同一张画两种编码互换时，浮点尾差不改变次序。 */
      const src = P.by === 'from' ? ctx.A : ctx.B, n = cols * rows, key = new Float64Array(n);
      for (let y = 0, i = 0; y < rows; y++) for (let x = 0; x < cols; x++, i++) {
        let v = src.v ? src.v[i] : src.fn(i, x, y, 0);      /* 活场按 t = 0 取一次 */
        v = clamp01(Number(v) || 0);
        const ink = Math.round((P.encoding === 'calibrated' ? v * v : v) * 1e6) / 1e6;
        key[i] = P.invert ? ink : 1 - ink;                    /* 默认先暗后亮：墨多的先换 */
      }
      const r = pace(key, P.seed);
      return { m: r.m, fallback: r.flat ? 'flat' : null };
    }
    if (P.mode === 'mask') {
      const md = maskDistance(ctx.mask, cols, rows), n = cols * rows, key = new Float64Array(n);
      for (let i = 0; i < n; i++) key[i] = P.invert ? -md.d[i] : md.d[i];
      const fb = md.empty ? 'empty-mask' : md.full ? 'full-mask' : null;
      /* 形内 / 形外**分段**分配进度：字形往往只占画幅几个百分点，混在一起排，
         字形一眨眼就长完、紧接着被外扩的圆团吞掉（实拍过：0.45 时已认不出标）。
         现在形内固定拿 MASK_SHARE（按形内面积夹在 0.3..0.6），先从骨架长满、让人看清，
         再沿轮廓的等距线向外；invert 时形外先收、形内最后合上。 */
      const inIdx = [], outIdx = [];
      for (let i = 0; i < n; i++) (md.d[i] < 0 ? inIdx : outIdx).push(i);
      if (fb || !inIdx.length || !outIdx.length) {
        const r = pace(key, P.seed);
        return { m: r.m, fallback: fb || (r.flat ? 'flat' : null) };
      }
      const share = Math.max(MASK_SHARE[0], Math.min(MASK_SHARE[1], inIdx.length / n));
      const m = new Float64Array(n);
      const part = (idx, off, len) => {
        const k = new Float64Array(idx.length);
        for (let j = 0; j < idx.length; j++) k[j] = key[idx[j]];
        const r = pace(k, P.seed);
        for (let j = 0; j < idx.length; j++) m[idx[j]] = off + len * r.m[j];
      };
      const gap = Math.min(share, 1 - share) / n;            /* 两段之间留一格的步长，次序严格不并列 */
      if (!P.invert) { part(inIdx, 0, share - gap); part(outIdx, share, 1 - share); }
      else { part(outIdx, 0, 1 - share - gap); part(inIdx, 1 - share, share); }
      return { m: m, fallback: null };
    }
    return { m: baseOrderGeom(P, cols, rows), fallback: null };
  }

  function baseOrderGeom(P, cols, rows) {
    const n = cols * rows, m = new Float64Array(n);
    if (P.mode === 'wipe') {
      const th = P.angle * Math.PI / 180, ux = Math.cos(th), uy = Math.sin(th);
      let lo = Infinity, hi = -Infinity;
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const d = (x + 0.5) * ux + (y + 0.5) * uy;
        m[y * cols + x] = d; if (d < lo) lo = d; if (d > hi) hi = d;
      }
      const span = hi - lo;
      for (let i = 0; i < n; i++) m[i] = span > 1e-12 ? (m[i] - lo) / span : 0;
    } else if (P.mode === 'radial') {
      const ox = P.cx * cols, oy = P.cy * rows;
      let hi = 0;
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const d = Math.hypot(x + 0.5 - ox, y + 0.5 - oy);       /* 格是正方形 → 格坐标里的圆就是真圆 */
        m[y * cols + x] = d; if (d > hi) hi = d;
      }
      for (let i = 0; i < n; i++) {
        const r = hi > 1e-12 ? m[i] / hi : 0;
        m[i] = P.invert ? 1 - r : r;
      }
    } else {                                                     /* dissolve：按块排名，块数均分进度 */
      const g = P.grain, bw = Math.ceil(cols / g), bh = Math.ceil(rows / g), nb = bw * bh;
      const key = new Float64Array(nb), idx = new Array(nb);
      for (let b = 0; b < nb; b++) { key[b] = hash01(P.seed, b); idx[b] = b; }
      idx.sort((a, b) => (key[a] - key[b]) || (a - b));           /* 平局按块号 → 全平台同序 */
      const rank = new Float64Array(nb);
      for (let r = 0; r < nb; r++) rank[idx[r]] = r / nb;         /* ∈ [0,1)，等间距 */
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        m[y * cols + x] = rank[((y / g) | 0) * bw + ((x / g) | 0)];
      }
    }
    return m;
  }

  function create(opts) {
    const o = opts || {};
    const cols = o.cols | 0, rows = o.rows | 0;
    if (!(cols > 0 && rows > 0) || cols !== o.cols || rows !== o.rows) {
      throw new RangeError('DotInk.transition: cols / rows 必须是正整数（拿到 ' + o.cols + '×' + o.rows + '）');
    }
    const n = cols * rows;
    const mode = o.mode === undefined ? 'wipe' : o.mode;
    if (MODES.indexOf(mode) < 0) throw new RangeError('DotInk.transition: 未知 mode "' + mode + '"（可选 ' + MODES.join(' / ') + '）');
    const blend = o.blend === undefined ? 'select' : o.blend;
    if (BLENDS.indexOf(blend) < 0) throw new RangeError('DotInk.transition: 未知 blend "' + blend + '"（可选 ' + BLENDS.join(' / ') + '）');
    const encoding = o.encoding === undefined ? 'coverage' : o.encoding;
    if (!Object.prototype.hasOwnProperty.call(ENCODINGS, encoding)) throw new RangeError('DotInk.transition: 未知 encoding "' + encoding + '"（可选 coverage / calibrated）');

    const A = asSource(o.from, n, 'from'), B = asSource(o.to, n, 'to');

    /* 参数规整（冻结一份，便于读回 / 显示 / 复现） */
    const P = Object.freeze({
      mode: mode, blend: blend, encoding: encoding,
      edge: clamp01(num(o.edge, mode === 'dissolve' ? 0 : 0.12)),
      seed: num(o.seed, 1) >>> 0,
      angle: ((num(o.angle, 0) % 360) + 360) % 360,
      cx: clamp01(num(o.cx, 0.5)), cy: clamp01(num(o.cy, 0.5)),
      invert: !!o.invert,
      grain: Math.max(1, Math.min(64, Math.round(num(o.grain, 1)))),
      by: o.by === undefined ? 'to' : o.by,
      mask: mode === 'mask' ? (typeof o.mask === 'function' ? 'function' : 'array') : null,
    });
    if (BYS.indexOf(P.by) < 0) throw new RangeError('DotInk.transition: 未知 by "' + P.by + '"（可选 to / from）');

    const ord = baseOrder(P, cols, rows, { A: A, B: B, mask: o.mask });
    const m = ord.m;
    /* 退化情形（明确、不报错）：墨量处处相同 / 遮罩为空 / 遮罩全满 → 键平 → 次序就是种子次序（= 溶解） */
    const info = Object.freeze({ fallback: ord.fallback });
    const e = P.edge;
    /* select：每格一个切换点 sw ∈ [0, 1)，p > sw 即换成 B。
       过渡带内用种子抖动把"何时换"摊开 —— 带内读起来是 A→B 的网点渐变，但每格仍只取 A 或 B。 */
    const sw = new Float64Array(n);
    const js = (P.seed ^ 0x5BD1E995) >>> 0;
    for (let i = 0; i < n; i++) {
      const j = e > 0 ? hash01(js, i) : 0;
      let s = (m[i] + e * j) / (1 + e);
      if (s < 0) s = 0; else if (s > SW_MAX) s = SW_MAX;
      sw[i] = s;
    }

    const aFn = A.fn, bFn = B.fn, aV = A.v, bV = B.v;
    const mix = blend === 'mix' && e > 0;
    const k1 = 1 + e;

    /* 单格求值：热路径。`!(p > 0)` 同时兜住 NaN（当作 A）。 */
    function value(i, p, x, y, t) {
      if (!(p > 0)) return aV ? aV[i] : aFn(i, x, y, t);
      if (p >= 1) return bV ? bV[i] : bFn(i, x, y, t);
      if (mix) {
        const s = (p * k1 - m[i]) / e;
        if (s <= 0) return aV ? aV[i] : aFn(i, x, y, t);
        if (s >= 1) return bV ? bV[i] : bFn(i, x, y, t);
        const a = aV ? aV[i] : aFn(i, x, y, t), b = bV ? bV[i] : bFn(i, x, y, t);
        return a + (b - a) * s;
      }
      return p > sw[i] ? (bV ? bV[i] : bFn(i, x, y, t)) : (aV ? aV[i] : aFn(i, x, y, t));
    }

    /* 整张场：写进 out（给了就复用，长度必须对）或新数组。永远不返回源数组本身。 */
    function at(p, out, t) {
      const dst = out || new Float32Array(n);
      if (dst.length !== n) throw new RangeError('DotInk.transition.at: out 长度 ' + dst.length + ' ≠ ' + n);
      if (overlapsSource(dst, aV) || overlapsSource(dst, bV)) throw new TypeError('DotInk.transition.at: out 不能与源场共享重叠内存（会改坏源）');
      const tt = t === undefined ? 0 : t;
      for (let y = 0, i = 0; y < rows; y++) for (let x = 0; x < cols; x++, i++) dst[i] = value(i, p, x, y, tt);
      return dst;
    }

    /* 交给 DotInk.create 的场函数。默认 t 就是进度（draw(p)）；
       源是活场时传 pOf(t) → p，t 原样传给源。 */
    function field(pOf) {
      const f = typeof pOf === 'function' ? pOf : null;
      return function (i, x, y, t) { return value(i, f ? f(t) : t, x, y, t); };
    }

    /* 已换成 B 的格数（select 口径；mix 按 s ≥ 1 计） */
    function countB(p) {
      if (!(p > 0)) return 0;
      if (p >= 1) return n;
      let c = 0;
      if (mix) { for (let i = 0; i < n; i++) if ((p * k1 - m[i]) / e >= 1) c++; }
      else { for (let i = 0; i < n; i++) if (p > sw[i]) c++; }
      return c;
    }

    const hints = Object.freeze({ areaMap: ENCODINGS[encoding].areaMap, gamma: 1, gain: 1, shutter: 0 });

    return Object.freeze({
      cols: cols, rows: rows, n: n,
      mode: mode, blend: blend, encoding: encoding,
      params: P, info: info,
      /* 与编码配对的 render 选项：直接展开进 DotInk.create({...tr.renderHints})。
         shutter 必须 0 —— 运动模糊会把 p±δ 两个状态取并集，端点就不严格了。 */
      renderHints: hints,
      value: value, at: at, field: field, countB: countB,
      /* 切换点表的拷贝（只读语义；给测试 / 可视化用） */
      switchMap: function () { return Float64Array.from(sw); },
      /* 基准次序表的拷贝（tone / mask 的可视化与测试用） */
      orderMap: function () { return Float64Array.from(m); },
    });
  }

  global.DotInk = Object.assign(global.DotInk || {}, {
    transition: Object.freeze({
      version: '1.1.0',
      create: create,
      MODES: MODES.slice(), BLENDS: BLENDS.slice(), BYS: BYS.slice(), ENCODINGS: ENCODINGS,
      ease: ease,
      _hash01: hash01,
    }),
  });
  if (typeof module === 'object' && module && module.exports && !module.exports.transition) {
    /* CJS 单独 require('./transition.js') 时也能拿到（不挂到 dotink.js 的导出上，免得改汇总入口） */
    module.exports = global.DotInk.transition;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
