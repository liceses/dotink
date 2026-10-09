/* dotink/pheno.js · 现象场库 v1.0.0
 * ============================================================================
 * 把 lab/PHENOMENA.md 的 01–08 做成**同一个签名**的场函数：
 *
 *   DotInk.pheno.<name>(cols, rows, opts) -> function (i, x, y, t) -> v
 *     i = y*cols + x（格序号）· t 秒（0 起，可到 60）· v ∈ [0,1] = 这一格此刻的墨量
 *
 * 为什么切成"每格一个数"：网点画面上一个格就是一份固定墨量，现象只要回答
 * "这一格有多少墨"。八个现象于是全退化成同一件事 —— 给每个格算一个 [0,1] 的密度。
 *
 * 三条纪律（都是踩过的坑）：
 *   ① **渲染路径禁 Math.random / Date.now**：随机只在**构造时**消费一次固定种子的 mulberry32。
 *   ② **演化型在构造时算完**（grayScott / dla / kuramoto / deJong）：按固定步长预计算 N 帧，
 *      之后 t 只做"帧号 + 相邻帧线性插值" —— 单帧 O(1)/格，绝不逐帧从零积分。
 *   ③ **值域真的用满 [0,1]**：0 = 纸（有留白）、1 = 满墨（有实墨）。
 *      每个现象收尾都有"归一化 + 增益"：不给增益的话算出来的半径大量是 1px ——
 *      "在渲染"但不"看得见"（PHENOMENA 通用坑 4）。
 *
 * 加载顺序：本文件要在 dotink.js **之后**。dotink.js 结尾是整体赋值 global.DotInk，
 * 反序加载会把 DotInk.pheno 冲掉（那边不在本次交付范围，没动它）。
 * ============================================================================
 */
(function (global) {
  'use strict';

  const TAU = Math.PI * 2, PI = Math.PI;
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const smooth = (p) => { p = clamp01(p); return p * p * (3 - 2 * p); };

  /* 可复现伪随机：**优先用全局上已有的** DotInk._mulberry32（dotink.js 导出，同一个算法），
     没有就自带一份**同算法**的私有实现 —— 本文件要能单独加载（"零依赖"这条是硬的）。 */
  const mulberry32 = (global.DotInk && typeof global.DotInk._mulberry32 === 'function')
    ? global.DotInk._mulberry32
    : function (seed) {
        let a = seed >>> 0;
        return function () {
          a = (a + 0x6D2B79F5) >>> 0;
          let t = Math.imul(a ^ (a >>> 15), 1 | a);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      };

  /* 帧库采样器：u8 = F 帧 × n 格的 Uint8（1/255 的量化在网点上不可见，
     内存只有 Float32 的 1/4）；t → 帧号线性、相邻帧线性插值 → 不跳帧。
     **超过 span 停在末态、不循环** —— 循环会在整点跳一帧，那是"逐帧不一致"的另一种写法。 */
  function bankSampler(u8, F, n, span) {
    return function (q, t) {
      const kf = t / span * (F - 1);
      if (kf <= 0) return u8[q] / 255;
      if (kf >= F - 1) return u8[(F - 1) * n + q] / 255;
      const k0 = kf | 0, f = kf - k0, b = k0 * n + q;
      return (u8[b] + (u8[b + n] - u8[b]) * f) / 255;
    };
  }

  /* ==========================================================================
   * 01 克拉德尼图形（Chladni figures）· PHENOMENA 01
   *   φ_mn = cos(mπu)cos(nπv) + α·cos(nπu)cos(mπv) ，节线 = {|φ| < ε}
   *   墨量 v = gain·(1 − |φ|/ε)⁺ —— "沙落在节线"直接就是"墨落在节线"。
   *   来源：novasolver.jp《Chladni Figures Simulator》（含简并模推导）。
   *   判据：数一下就能读出 m、n —— 画面本身就是模数。
   *   坑：m、n 必须是**整数**（简并本征模），所以演化只能是"扫 α + 整数档换模式"，
   *       绝不能把 m、n 插值。α = cos(2πt/period) 在 +1 ↔ −1 之间走 = 两个简并模的
   *       连续线性组合，图形自己拧过去。
   *   值域：节线上 φ≈0 → 被 gain 顶到 1；|φ| > ε 的格 = 0（大片留白）。
   * ======================================================================== */
  function chladni(cols, rows, o) {
    o = o || {};
    const modes = o.modes || [[4, 3], [5, 4], [3, 5], [6, 5]];
    const eps = o.eps === undefined ? 0.22 : o.eps;
    const gain = o.gain === undefined ? 1.35 : o.gain;
    const period = o.period === undefined ? 18 : o.period;     // α 往返周期（秒）
    const modeStep = o.modeStep === undefined ? 6 : o.modeStep; // 整数档换模式的周期（秒）
    return function (i, x, y, t) {
      const u = (x + 0.5) / cols, v = (y + 0.5) / rows;
      const md = modes[((t / modeStep) | 0) % modes.length];
      const m = md[0], n = md[1];
      const al = Math.cos(TAU * t / period);
      const phi = Math.cos(m * PI * u) * Math.cos(n * PI * v)
                + al * Math.cos(n * PI * u) * Math.cos(m * PI * v);
      return clamp01((1 - Math.abs(phi) / eps) * gain);
    };
  }

  /* ==========================================================================
   * 02 向日葵（Vogel 模型 1979）· PHENOMENA 02
   *   r = c√n ，θ = n·137.50776°（黄金角 = 360°/φ²，φ=(1+√5)/2）
   *   来源：Vogel 1979（"In order to describe the pattern of florets in a sunflower
   *   head, Vogel proposed the formula…"）。
   *   判据：数叶序螺旋的条数（Fibonacci 数）；135°（=360°×3/8）→ 真黄金角的扫描
   *       把"为什么偏偏是 137.50776°"演出来 —— 8 条笔直辐射臂越拧越均匀。
   *   落地：**从中心往外长**（种子按 n 一个个出现，半径 ∝ √n），角度同时从 135° 拧到黄金角。
   *       每帧按该帧最大密度归一化 + gain（不归一化，早期稀疏帧会全是 0）。
   *   值域：种子稀疏处 = 0（纸），密堆处顶到 1。
   * ======================================================================== */
  function sunflower(cols, rows, o) {
    o = o || {};
    const F = o.frames || 64, span = o.span || 32;
    const N = o.seeds || 1200;
    const a0 = o.a0 === undefined ? 135 : o.a0;
    const a1 = o.a1 === undefined ? 137.50776 : o.a1;
    const gamma = o.gamma === undefined ? 0.6 : o.gamma;
    const gain = o.gain === undefined ? 1.3 : o.gain;
    const fill = o.fill === undefined ? 0.46 : o.fill;   // 椭圆半径 = 短边×fill，铺满画幅
    const n = cols * rows, buf = new Uint8Array(F * n), acc = new Float32Array(n);
    const cx = cols * 0.5, cy = rows * 0.5, rx = cols * fill, ry = rows * fill;
    for (let k = 0; k < F; k++) {
      /* 种子数按 √(k/F) 长（先快后慢）：线性长的话前几秒整幅几乎空白（t=1 才 3% 的种子），
         而"从中心往外旋着长"这件事在头几秒就该看得见。 */
      const cnt = Math.max(1, Math.round(N * Math.sqrt((k + 1) / F)));
      const ang = (a0 + (a1 - a0) * (F > 1 ? k / (F - 1) : 0)) * PI / 180;
      acc.fill(0);
      for (let s = 1; s <= cnt; s++) {
        const r = Math.sqrt(s / N), th = s * ang;
        const px = cx + rx * r * Math.cos(th) - 0.5, py = cy + ry * r * Math.sin(th) - 0.5;
        const x0 = px | 0, y0 = py | 0, fx = px - x0, fy = py - y0;
        /* 双线性撒点：一颗种子分给最近四格。纯最近邻会在斜向上出现硬边/空行，
           而叶序的螺旋正好是斜的 —— 那会把要看的条纹吃成网格噪声。 */
        if (x0 >= 0 && y0 >= 0 && x0 + 1 < cols && y0 + 1 < rows) {
          acc[y0 * cols + x0] += (1 - fx) * (1 - fy);
          acc[y0 * cols + x0 + 1] += fx * (1 - fy);
          acc[(y0 + 1) * cols + x0] += (1 - fx) * fy;
          acc[(y0 + 1) * cols + x0 + 1] += fx * fy;
        }
      }
      let mx = 0;
      for (let q = 0; q < n; q++) if (acc[q] > mx) mx = acc[q];
      const base = k * n, inv = mx > 0 ? 1 / mx : 0;
      for (let q = 0; q < n; q++) buf[base + q] = Math.round(255 * clamp01(Math.pow(acc[q] * inv, gamma) * gain));
    }
    const samp = bankSampler(buf, F, n, span);
    return function (i, x, y, t) { return samp(y * cols + x, t); };
  }

  /* ==========================================================================
   * 03 de Jong 吸引子 · PHENOMENA 03
   *   x' = sin(a·y) − cos(b·x) ，y' = sin(c·x) − cos(d·y)
   *   做法（Bourke 那一套）：不是把点画上去，是统计每格被穿过多少次 → 占用直方图 → 密度。
   *   来源：Paul Bourke《Peter de Jong attractors》（含 7 组参数）。
   *   判据：这一条**不合格**（读不出 a、b、c、d）—— 它只是参数化的图案，留着是因为好看。
   *   坑：参数**不能在两组之间插值** —— Bourke 的参数是按"单个吸引子好看"挑的，
   *       中间取值常退化成一颗点/小循环（实测插到一半整幅只剩两颗点）。所以改成
   *       **同一帧里按比例各迭代一段**（A 段 + B 段 → 密度混合），两端都是完整吸引子。
   *   演化：A → B 的混合比随帧号单调推进（构造时算完，t 只查表 + 插值）。
   * ======================================================================== */
  function deJong(cols, rows, o) {
    o = o || {};
    const sets = o.sets || [[1.641, 1.902, 0.316, 1.525], [1.4, -2.3, 2.4, -2.1]];
    const F = o.frames || 48, span = o.span || 32, IT = o.iter || 60000;
    const gamma = o.gamma === undefined ? 0.32 : o.gamma;
    const gain = o.gain === undefined ? 1.9 : o.gain;
    const n = cols * rows, buf = new Uint8Array(F * n), h = new Int32Array(n);
    const A = sets[0], B = sets[1 % sets.length];
    /* 一次"按参数迭代 it 步并落进直方图"：x,y ∈ [−2,2] 正好是 sin−cos 的值域，
       按 0.25/单位 映射，不切边（切边会让边缘出现假的直壁）。 */
    const run = (pr, it) => {
      let x = 0.13, y = -0.27;
      for (let s = 0; s < 400; s++) { const nx = Math.sin(pr[0] * y) - Math.cos(pr[1] * x); y = Math.sin(pr[2] * x) - Math.cos(pr[3] * y); x = nx; }
      for (let s = 0; s < it; s++) {
        const nx = Math.sin(pr[0] * y) - Math.cos(pr[1] * x), ny = Math.sin(pr[2] * x) - Math.cos(pr[3] * y);
        x = nx; y = ny;
        const i = ((x * 0.25 + 0.5) * cols) | 0, j = ((y * 0.25 + 0.5) * rows) | 0;
        if (i >= 0 && i < cols && j >= 0 && j < rows) h[j * cols + i]++;
      }
    };
    for (let k = 0; k < F; k++) {
      const f = F > 1 ? k / (F - 1) : 0;
      h.fill(0);
      const itA = Math.round((1 - f) * IT);
      if (itA > 0) run(A, itA);
      if (IT - itA > 0) run(B, IT - itA);
      let mx = 1;
      for (let q = 0; q < n; q++) if (h[q] > mx) mx = h[q];
      const base = k * n;
      for (let q = 0; q < n; q++) {
        /* 密度跨好几个量级（中心比边缘高千倍）→ 弱开方压一下才有"墨的层次"；
           gain 是必须的：不乘，绝大多数格算出来的半径是 1px，等于看不见。 */
        buf[base + q] = Math.round(255 * clamp01(Math.pow(h[q] / mx, gamma) * gain));
      }
    }
    const samp = bankSampler(buf, F, n, span);
    return function (i, x, y, t) { return samp(y * cols + x, t); };
  }

  /* ==========================================================================
   * 04 Gray-Scott 反应扩散（图灵斑图）· PHENOMENA 04
   *   ∂u/∂t = D_u∇²u − uv² + F(1−u) ，∂v/∂t = D_v∇²v + uv² − (F+k)v
   *   拉普拉斯用 9 点各向同性（[[.05,.20,.05],[.20,−1,.20],[.05,.20,.05]]）——
   *   5 点会按坐标轴取向，斑图会"方"。
   *   来源：pearson 参数图系；F=0.042, k=0.061 取自 ANEForge 的 Gray-Scott 例（branching-labyrinth 区）。
   *   判据：能看出"斑/条/迷宫"落在哪一段参数区（半个 —— 读不出 F、k 的值）。
   *   坑（同一件事栽了两次）：① 只从中心一块起核 → 前沿只爬十几格，整幅一小团；
   *     ② 只铺噪声底、不给强种子 → 平凡态稳定，V 衰减到 0，整幅空白**而且不报错**。
   *     正确配方 = 随机位置的强种子 + 噪声底 + U = 1 − V 初始化。
   *   落地：构造时先跑 warm 步（起核瞬态，不存帧）再推进 steps 步、每 every 步存一帧；
   *       t 只查表插值（逐帧零成本）。
   *   值域：图上"有反应的地方"= 墨，未反应的地 = 0（纸）；峰值帧顶到 1。
   * ======================================================================== */
  function grayScott(cols, rows, o) {
    o = o || {};
    const Fk = o.F === undefined ? 0.042 : o.F;
    const Kk = o.k === undefined ? 0.061 : o.k;
    const Du = o.Du === undefined ? 0.16 : o.Du, Dv = o.Dv === undefined ? 0.08 : o.Dv;
    const steps = o.steps || 1600, every = o.every || 10;
    const warm = o.warm === undefined ? 150 : o.warm;   // 起核瞬态：跑掉但不存帧
    const span = o.span || 36, nSeed = o.seeds || 34;
    const gain = o.gain === undefined ? 1.08 : o.gain;
    const seed = o.seed === undefined ? 20261005 : o.seed;
    const n = cols * rows, F = Math.floor(steps / every) + 1;
    const U = new Float32Array(n).fill(1), V = new Float32Array(n);
    const U2 = new Float32Array(n), V2 = new Float32Array(n);
    const rnd = mulberry32(seed);
    for (let q = 0; q < n; q++) { const f0 = 0.02 + 0.06 * rnd(); V[q] = f0; U[q] = 1 - f0; }
    /* 起核点用**纯随机位置**：抖动网格会让所有畴同期长到一样大，出来是一张规整的蜂窝壁纸。 */
    for (let s = 0; s < nSeed; s++) {
      const ci = 3 + ((rnd() * (cols - 7)) | 0), cj = 3 + ((rnd() * (rows - 7)) | 0);
      for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) {
        const q = ((cj + b) % rows) * cols + ((ci + a) % cols);
        V[q] = 1; U[q] = 0;
      }
    }
    const raw = new Float32Array(F * n);
    let mx = 1e-6, fr = 0;
    /* warm 步先跑掉、不存：刚起核那几十步整幅还是"种子 + 噪声底"，存进去就是一段空白开场；
       而且那一瞬 V=1 的种子会把归一化用的峰值顶到 1，后面所有帧都被压暗。 */
    for (let s = 0; s <= warm + steps; s++) {
      if (s >= warm && (s - warm) % every === 0) {
        const base = fr++ * n;
        for (let q = 0; q < n; q++) { const v = V[q]; raw[base + q] = v; if (v > mx) mx = v; }
      }
      if (s === warm + steps) break;
      for (let j = 0; j < rows; j++) {
        const jc = j * cols, jm = ((j - 1 + rows) % rows) * cols, jp = ((j + 1) % rows) * cols;
        for (let i = 0; i < cols; i++) {
          const im = (i - 1 + cols) % cols, ip = (i + 1) % cols;
          const u = U[jc + i], v = V[jc + i], uvv = u * v * v;
          const lu = 0.2 * (U[jc + im] + U[jc + ip] + U[jm + i] + U[jp + i])
                   + 0.05 * (U[jm + im] + U[jm + ip] + U[jp + im] + U[jp + ip]) - u;
          const lv = 0.2 * (V[jc + im] + V[jc + ip] + V[jm + i] + V[jp + i])
                   + 0.05 * (V[jm + im] + V[jm + ip] + V[jp + im] + V[jp + ip]) - v;
          U2[jc + i] = u + Du * lu - uvv + Fk * (1 - u);
          V2[jc + i] = v + Dv * lv + uvv - (Fk + Kk) * v;
        }
      }
      U.set(U2); V.set(V2);
    }
    /* 全局归一化（不是逐帧）：墨量是**同一条反应跑出来的相对浓度**，
       逐帧拉伸会把"斑图在长/在粗化"这件事一起抹掉。V=0 的地 = 纸。 */
    const buf = new Uint8Array(F * n), inv = gain / mx;
    for (let q = 0; q < F * n; q++) buf[q] = Math.round(255 * clamp01(raw[q] * inv));
    const samp = bankSampler(buf, F, n, span);
    return function (i, x, y, t) { return samp(y * cols + x, t); };
  }

  /* ==========================================================================
   * 05 扩散限制凝聚（DLA，Witten & Sander 1981）· PHENOMENA 05
   *   算法没有公式，是一句话：**随机游走，碰到已占的格就粘住。**（屏蔽效应：内枝被饿死）
   *   来源：Witten & Sander 1981 / 闪电分形模型的文献线索（见 PHENOMENA 05）。
   *   判据：合格 —— "扩散限制"直接写在画面上：内枝被饿死，分维度看得见。
   *   坑：从边界出发 + 向下偏置 → 游走者走出边界即丢，1200 颗里只凝住一小团。
   *       正确做法是**在簇的外圈投放**、越界就回收重投。椭圆投放（不是圆）：画幅 16:9，
   *       圆投放会让纵横长得不一样长。
   *   落地：构造时把**生长顺序**记下来，第 k 帧 = 长到第 ⌈cnt·(k+1)/F⌉ 颗 → t 只查表。
   * ======================================================================== */
  function dla(cols, rows, o) {
    o = o || {};
    const NP = o.particles || 1100, F = o.frames || 64, span = o.span || 30;
    const seed = o.seed === undefined ? 778899 : o.seed;
    const IDX = 107;   // 四邻半调（= 0.42 墨量）：枝条看起来有肉，不是一根一根的骨头
    const n = cols * rows, rnd = mulberry32(seed);
    const occ = new Uint8Array(n), order = new Int32Array(NP);
    const CX = cols * 0.5, CY = rows * 0.5;
    const c0 = ((CY | 0) * cols) + (CX | 0);
    occ[c0] = 1; order[0] = c0;
    let cnt = 1, R = 3;
    for (let guard = 0; cnt < NP && guard < NP * 90; guard++) {
      const th = rnd() * TAU;
      let x = Math.round(CX + R * 1.35 * Math.cos(th)), y = Math.round(CY + R * 0.95 * Math.sin(th));
      if (x < 1 || y < 1 || x >= cols - 1 || y >= rows - 1) continue;
      for (let st = 0; st < 4000; st++) {
        if (st & 1) x += rnd() < 0.5 ? 1 : -1; else y += rnd() < 0.5 ? 1 : -1;
        if (y < 1 || y >= rows - 1) break;               // 纵向越界 → 丢弃，外层重投
        if (x < 1) x = cols - 2; else if (x >= cols - 1) x = 1;   // 横向周期，配合椭圆投放
        const c = y * cols + x;
        if (occ[c]) break;
        if (occ[c - 1] || occ[c + 1] || occ[c - cols] || occ[c + cols]) {
          occ[c] = 1; order[cnt++] = c;
          const dx = (x - CX) / 1.35, dy = (y - CY) / 0.95, d = Math.sqrt(dx * dx + dy * dy);
          if (d > R) R = d;
          break;
        }
      }
    }
    const buf = new Uint8Array(F * n);
    let drawn = 0;
    for (let k = 0; k < F; k++) {
      const base = k * n;
      if (k > 0) buf.copyWithin(base, base - n, base);   // 上一帧打底（只长不缩）
      const lim = Math.max(1, Math.round(cnt * (k + 1) / F));
      for (; drawn < lim && drawn < cnt; drawn++) {
        const c = order[drawn], ci = c % cols, cj = (c / cols) | 0;
        buf[base + c] = 255;
        if (ci > 0) buf[base + c - 1] = Math.max(buf[base + c - 1], IDX);
        if (ci < cols - 1) buf[base + c + 1] = Math.max(buf[base + c + 1], IDX);
        if (cj > 0) buf[base + c - cols] = Math.max(buf[base + c - cols], IDX);
        if (cj < rows - 1) buf[base + c + cols] = Math.max(buf[base + c + cols], IDX);
      }
    }
    const samp = bankSampler(buf, F, n, span);
    return function (i, x, y, t) { return samp(y * cols + x, t); };
  }

  /* ==========================================================================
   * 06 Kuramoto 同步 · PHENOMENA 06
   *   dθᵢ/dt = ωᵢ + (K/N)Σⱼ sin(θⱼ−θᵢ) ，r·e^{iψ} = (1/N)Σⱼ e^{iθⱼ}
   *   这一版是**格点版**（每格一个振子，耦合取四邻）—— 因为接口要的是"每格一个数"，
   *   而不是一串点。本地耦合的 Kuramoto 会先长出锁相畴、畴再粗化（"散 → 聚"本身就是要看的）。
   *   耦合项用恒等变形算，不是近似：
   *     Σⱼ sin(θⱼ−θᵢ) = cosθᵢ·Σⱼ sinθⱼ − sinθᵢ·Σⱼ cosθⱼ
   *   来源：Kuramoto 1975；洛伦兹本征频率下临界耦合可解 K_c = 2γ（PHENOMENA 06）。
   *   落地：构造时按固定步长积分，K 从 0 爬到 K（ramp：先散后聚），存帧；t 只查表 + 双线性。
   *   本征频率 = 随机离散（seed 固定）+ 一层**空间慢变**分量：
   *     只有随机频率的话，锁相后整幅会塌成一片平色，0 和 1 都不出现；
   *     带空间梯度时锁相态仍是一条沿 x 的相位斜坡 → 画面剩下列行波，值域用满。
   * ======================================================================== */
  function kuramoto(cols, rows, o) {
    o = o || {};
    const gw = Math.max(24, cols >> 1), gh = Math.max(14, rows >> 1), gn = gw * gh;
    const steps = o.steps || 500, every = o.every || 5;
    const F = Math.floor(steps / every) + 1, span = o.span || 36;
    const spread = o.spread === undefined ? 0.9 : o.spread;
    const wave = o.wave === undefined ? 1.1 : o.wave;
    const kmax = o.K === undefined ? 4.5 : o.K;
    const dt = o.dt === undefined ? 0.03 : o.dt;
    const gain = o.gain === undefined ? 1.5 : o.gain;
    const seed = o.seed === undefined ? 31415 : o.seed;
    const rnd = mulberry32(seed);
    const th = new Float64Array(gn), om = new Float64Array(gn);
    const c = new Float64Array(gn), s = new Float64Array(gn);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      const q = j * gw + i;
      th[q] = rnd() * TAU;                                  // 起手完全不相干 → 各走各的
      om[q] = spread * (2 * rnd() - 1) + wave * Math.sin(TAU * (i + 0.5) / gw);
    }
    const buf = new Uint8Array(F * gn);
    let fr = 0;
    for (let st = 0; st <= steps; st++) {
      if (st % every === 0) {
        const base = fr++ * gn;
        for (let q = 0; q < gn; q++) buf[base + q] = Math.round(255 * clamp01(0.5 + 0.5 * gain * Math.cos(th[q])));
      }
      if (st === steps) break;
      const K = kmax * Math.min(1, st / (steps * 0.8));     // 前 80% 爬升、后 20% 保持
      for (let q = 0; q < gn; q++) { c[q] = Math.cos(th[q]); s[q] = Math.sin(th[q]); }
      for (let j = 0; j < gh; j++) {
        const jc = j * gw, jm = ((j - 1 + gh) % gh) * gw, jp = ((j + 1) % gh) * gw;
        for (let i = 0; i < gw; i++) {
          const im = (i - 1 + gw) % gw, ip = (i + 1) % gw, q = jc + i;
          const sx = c[jc + im] + c[jc + ip] + c[jm + i] + c[jp + i];
          const sy = s[jc + im] + s[jc + ip] + s[jm + i] + s[jp + i];
          th[q] += dt * (om[q] + 0.25 * K * (c[q] * sy - s[q] * sx));
        }
      }
    }
    /* 采样：内部格 → 调用方格的双线性 + 相邻帧插值（8 次读，单格仍是常数成本） */
    const sxg = gw / cols, syg = gh / rows;
    const bil = (base, gx, gy) => {
      let x0 = gx | 0, y0 = gy | 0;
      if (x0 < 0) x0 = 0; else if (x0 > gw - 2) x0 = Math.max(0, gw - 2);
      if (y0 < 0) y0 = 0; else if (y0 > gh - 2) y0 = Math.max(0, gh - 2);
      const fx = clamp01(gx - x0), fy = clamp01(gy - y0), r0 = base + y0 * gw + x0;
      const a = buf[r0] + (buf[r0 + 1] - buf[r0]) * fx;
      const b = buf[r0 + gw] + (buf[r0 + gw + 1] - buf[r0 + gw]) * fx;
      return a + (b - a) * fy;
    };
    return function (i, x, y, t) {
      const kf = t / span * (F - 1);
      const gx = (x + 0.5) * sxg - 0.5, gy = (y + 0.5) * syg - 0.5;
      if (kf <= 0) return bil(0, gx, gy) / 255;
      if (kf >= F - 1) return bil((F - 1) * gn, gx, gy) / 255;
      const k0 = kf | 0, f = kf - k0, a = bil(k0 * gn, gx, gy), b = bil((k0 + 1) * gn, gx, gy);
      return (a + (b - a) * f) / 255;
    };
  }

  /* ==========================================================================
   * 07 倍周期分叉 / Feigenbaum · PHENOMENA 07
   *   x_{n+1} = r·x_n(1−x_n) ，r ∈ [2.4, 4]
   *   画面：满幅分叉树 —— 主干 → 一分为二 → 级联 →（约 3.56995 之后）混沌的海，
   *         海里的**白窗** = 周期窗（最显眼那个是周期 3）。白窗自明，不用一个字解释。
   *   来源：Feigenbaum 1978；δ = 4.6692016…，α = 2.5029078…
   *   做法：r 轴上预先把 bins 列的占用直方图算好（构造时一次），**逐列按该列自己的最大密度
   *       归一化** —— 否则 1-周期那一列会把整棵树压扁。t 只做"视窗平移/拉远"：视窗内的
   *       每列在预计算表里查两条相邻 bin 再插值（在 r 上连续）。
   *   坑：不做"往累积点里钻"看自相似 —— 深层缩放看到的本来就是 Cantor 尘，纵向一拉就是条形码
   *       （实测两版）。"能证明 ≠ 能看见"，所以后半改成**拉远**，露出右边的混沌海。
   * ======================================================================== */
  function bifurcation(cols, rows, o) {
    o = o || {};
    const bins = o.bins || 512, rLo = 2.4, rHi = o.rHi === undefined ? 3.9995 : o.rHi;
    const transient = o.transient || 600, samples = o.samples || 1600;
    const period = o.period === undefined ? 26 : o.period;
    const gamma = o.gamma === undefined ? 0.5 : o.gamma;
    const gain = o.gain === undefined ? 1.12 : o.gain;
    const RINF = 3.569945672;                       // 累积点：级联聚到这里
    const h = new Float32Array(rows), buf = new Uint8Array(bins * rows);
    for (let b = 0; b < bins; b++) {
      const r = rLo + (rHi - rLo) * (b + 0.5) / bins;
      let x = 0.41;
      for (let k = 0; k < transient; k++) { x = r * x * (1 - x); if (!isFinite(x)) { x = 0.41; break; } }
      h.fill(0);
      for (let k = 0; k < samples; k++) {
        x = r * x * (1 - x);
        if (!isFinite(x)) break;
        const j = ((1 - x) * (rows - 1)) | 0;       // x 大在上（经典树的朝向）
        if (j >= 0 && j < rows) h[j]++;
      }
      let mx = 0;
      for (let j = 0; j < rows; j++) if (h[j] > mx) mx = h[j];
      const base = b * rows, inv = mx > 0 ? 1 / mx : 0;
      for (let j = 0; j < rows; j++) buf[base + j] = Math.round(255 * clamp01(Math.pow(h[j] * inv, gamma) * gain));
    }
    /* 视窗：前半把右端从 r≈2.5 爬到累积点（树长出来），后半拉远到 4（海 + 白窗）。
       用周期函数（不是"t 单向跑完就停"）→ t 到 60 也连续、无跳变。 */
    return function (i, x, y, t) {
      const p = ((t / period) % 1 + 1) % 1;
      let hi;
      if (p < 0.5) hi = rLo + (RINF - rLo) * (0.10 + 0.90 * smooth(p / 0.5));
      else hi = RINF + (rHi - RINF) * smooth((p - 0.5) / 0.5);
      const r = rLo + (hi - rLo) * (x + 0.5) / cols;
      const bf = clamp01((r - rLo) / (rHi - rLo)) * bins - 0.5;
      let b0 = bf | 0; if (b0 < 0) b0 = 0; else if (b0 > bins - 1) b0 = bins - 1;
      const b1 = b0 + 1 < bins ? b0 + 1 : b0, f = clamp01(bf - b0);
      const a = buf[b0 * rows + y], c = buf[b1 * rows + y];
      return (a + (c - a) * f) / 255;
    };
  }

  /* ==========================================================================
   * 08 两源干涉 · PHENOMENA 08
   *   A(x,y,t) = Σᵢ sin(k·rᵢ − ωᵢt) / √rᵢ
   *   画面上能直接读出来的事：**波在动、条纹不动** —— 亮纹位置是 |r₁−r₂| = nλ，与 t 无关
   *   （这就是"干涉"的全部含义）。戏放在**两源分开**：d 变大，中间那套双曲线条纹随之变密。
   *   纯解析、零模拟、零随机：每格两个 sqrt + 两个 sin。
   *   两点自己加的：
   *     · 源间距 d(t) 用周期函数来回走（t 到 60 也不跳）；d 变 → 条纹密度变，这是"看得见"的那一项。
   *     · 两源频率差 Δω ≠ 0：同频时 |A| 里 t 会被消掉（条纹完全静止，画面被判"静止"），
   *       有 Δω 就有慢拍频在走 —— 物理上就是"两只看似同频的音叉"。
   *   值域：近源处振幅相长 → 顶到 1；破坏性干涉的暗纹上 |A|≈0 → 纸。1/√r 的衰减让远处条纹自然变淡。
   * ======================================================================== */
  function interference(cols, rows, o) {
    o = o || {};
    const lamU = o.lam === undefined ? 0.056 : o.lam;        // λ / 画幅宽（field4 用 72/1280）
    const dU0 = o.d0 === undefined ? 0.07 : o.d0;            // 源间距 / 画幅宽（合拢端）
    const dU1 = o.d1 === undefined ? 0.48 : o.d1;            // 源间距 / 画幅宽（分开端）
    const period = o.period === undefined ? 24 : o.period;
    const omega = o.omega === undefined ? 1.2 : o.omega;
    const domega = o.domega === undefined ? 0.35 : o.domega;
    const cut = o.cut === undefined ? 0.03 : o.cut;
    /* gain 是量出来的：两源分开到最远时，近源处 |A| ≈ 1 + 1/√(1+d/6) ≈ 1.3 ——
       乘 0.85 才顶到 1（乘 0.65 时那一端只有 0.84，画面上"满墨"就缺一角）。 */
    const gain = o.gain === undefined ? 0.85 : o.gain;
    const lam = lamU * cols, kk = TAU / lam, sy = rows * 0.46, cx = cols * 0.5;
    return function (i, x, y, t) {
      const d = cols * (dU0 + (dU1 - dU0) * (0.5 - 0.5 * Math.cos(TAU * t / period)));
      const X = x + 0.5, Y = y + 0.5 - sy;
      const q0 = X - (cx - d * 0.5), q1 = X - (cx + d * 0.5);
      const r1 = Math.sqrt(q0 * q0 + Y * Y), r2 = Math.sqrt(q1 * q1 + Y * Y);
      const a = Math.sin(kk * r1 - omega * t) / Math.sqrt(1 + r1 / 6)
              + Math.sin(kk * r2 - (omega + domega) * t) / Math.sqrt(1 + r2 / 6);
      return clamp01((Math.abs(a) - cut) * gain);
    };
  }

  global.DotInk = global.DotInk || {};
  global.DotInk.pheno = {
    chladni: chladni, sunflower: sunflower, deJong: deJong, grayScott: grayScott,
    dla: dla, kuramoto: kuramoto, bifurcation: bifurcation, interference: interference,
  };
  global.DotInk.pheno.version = '1.0.0';
})(typeof window !== 'undefined' ? window : globalThis);
