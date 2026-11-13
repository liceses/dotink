/* press.js · 多色版套印：点阵艺术 → 动态套印不齐（misregistration）
 * ============================================================================
 * 继承 render.js 的点阵纪律，只加一件事：**一帧不再只有墨与纸，而是 N 张版叠印**。
 *
 * 三条约定的由来（都是印刷厂的真实规矩，不是比喻）：
 *   ① 每版仍是 1-bit —— 每一张版上只有"有墨"和"没墨"，没有灰。颜色是**叠**出来的，
 *      不是画出来的。所以一帧最多只有 2^N 种颜色（N=4 → 16 色），这就是 1-bit 在
 *      多色上的推广：**不是"无灰阶"，而是"只在套印格点集上"**（下面 palette 就是那个集合）。
 *   ② 网屏角度必须分开（青 15° / 品红 75° / 黄 0° / 黑 45°）—— 三块版同角度会撞出摩尔纹，
 *      45° 是"最不碍眼"的角度所以给黑。角度一散开，叠出来的就是印刷的玫瑰斑（rosette）。
 *   ③ 叠印是**乘法**（透明油墨的减色混合），不是加法：纸 × 青 × 品红 = 蓝。所以 inks 里的
 *      RGB 就是"这版满版印在这张纸上时的颜色"，透过率 = rgb / paper。
 *
 * 「套印不齐」= 某几版相对其余版平移/微转。偏移一旦发生，边缘一圈就露出只有单版的颜色
 * （漏色重影 / color fringe）。drift 让这个偏移随时间走 —— 那就是要的动态。
 *
 * 经典脚本（file:// 下 ESM 会被 CORS 拦死）。挂 window.DotInk.press。
 * 依赖：render.js（几何与圆盘栅格化全用它，本文件不重复实现）。
 * ============================================================================
 */
(function (global) {
  'use strict';

  const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

  /* 可复现伪随机（渲染路径禁 Math.random）。
     ⚠ 这里**自带一份私有实现**，不再去全局上借 DotInk._mulberry32。
     原因是一个真实的静默失效：借用时的兜底 `|| (() => () => 0.5)` 会让每版相位固定成同一个
     常数 → 四版位移完全相同（整体平移、版间零相对错位）→ 套印不齐这个核心现象根本不发生，
     而且不报错。实测只装 render.js + press.js 时：四版位移 uniq=1（应 4）、色数 4（应 13）、
     fringe 0.1838（应 0.2608）—— 看起来「有偏移」，其实只是整体平移了 2px。
     算法与 fields.js:16 的 mulberry32 逐位相同，所以装载顺序再也影响不到结果
     （pheno.js:32 是「优先借全局、没有才自带」；这里更严一层：一律用自带的，杜绝顺序依赖）。 */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* 经典四色的角度与"满版色"：角度是 §4 的行业值，色值是 sRGB 的 SWOP 近似 */
  const CLASSIC = [
    { name: 'C', title: '青',   rgb: [0, 174, 239],  angle: 15 },
    { name: 'M', title: '品红', rgb: [236, 0, 140],  angle: 75 },
    { name: 'Y', title: '黄',   rgb: [255, 241, 0],  angle: 0 },
    { name: 'K', title: '黑',   rgb: [12, 13, 14],   angle: 45 },
  ];

  const DEFAULTS = {
    canvas: null, scale: 1.5, cssW: 1280, cssH: 720,
    paper: [242, 243, 242],
    /* 网点几何：与 render.js 同口径（点距 / 满墨半径 / 面积映射 / 调子） */
    cell: 8, cols: null, rows: null,
    maxFrac: 0.40, areaMap: true, gain: 1, gamma: 1, floor: 0.035,
    /* 版：顺序就是 palette 的位序（第 i 版 = 第 i 位） */
    inks: CLASSIC,
    /* 每版的场：{C: Float32Array | (i,cx,cy,t)=>0..1, …}；缺版 = 空（不落墨） */
    plates: null,
    /* 套印偏移：{amp, speed, seed, rot}（CSS px / 度）或 (name, t, i) => [dx, dy] */
    drift: null,
    /* 每版的点增益（半径乘子）：真实印刷的网点扩大，也是"油墨多少"的旋钮 */
    dotGain: 1,
    minPointDev: 0,
    /* 分色默认参数（separate / fromCanvas 用） */
    ucr: 0.55,
    /* 总墨量上限（四版墨量之和，1.0 = 100%）。真实胶印的上限是 240–300%：
       不设它，暗部四块版全部拉满，叠出来是一坨死黑（4 版 × 满墨 = 100% 覆盖的纯黑），
       印刷厂会拒印，观感上也丢掉"网点的呼吸"。超限时**按比例一起缩**，保持色相不变。 */
    tacLimit: 2.4,
    /* 时长（秒）：只为与 render 的实例面一致（host / 播放循环可以统一读它） */
    duration: 12,
  };

  const R = () => global.DotInk && global.DotInk.render;

  /* ==========================================================================
   * 纯函数①：套印格点集（palette）
   * --------------------------------------------------------------------------
   * 一帧里**只允许**出现这 2^N 个颜色 —— 第 k 项 = 位掩码 k 的那些版叠在一起的颜色。
   * 这条就是"多色版的 1-bit"：判据不再问"有没有灰阶"，而问"有没有跑出这个集合"。
   * 单版、ink = 纸上的墨色时，palette[1] 精确等于 ink（因为透过率就是 ink/paper）——
   * 于是"单版 press ≡ 原来的单色 render"是**逐字节**成立的，不是近似。
   * ========================================================================== */
  function paletteOf(inks, paper) {
    const N = inks.length;
    if (N > 8) throw new Error("press: 版数上限 8（2^8=256 色已经够多，再多 palette 反而不受控）");
    const pal = new Uint8Array((1 << N) * 3);
    /* ⚠ 格点集**会碰撞**：减色乘法下 CMY 叠印与 CMYK 叠印都收敛到 (0,0,0)
       （实测 CLASSIC 四色里 code 7 与 15 同色）。所以 2^N 是"上限"，不是"色数"。
       paletteOf 只负责映射；"实际几个色"由 distinctColors() 从映射结果里数。 */
    for (let k = 0; k < (1 << N); k++) {
      for (let c = 0; c < 3; c++) {
        let v = paper[c];
        for (let i = 0; i < N; i++) {
          if (k & (1 << i)) v *= clamp01(inks[i].rgb[c] / paper[c]);   /* 减色：透过率相乘 */
        }
        pal[k * 3 + c] = Math.round(v);
      }
    }
    return pal;
  }

  /* 格点集里**实际有几个不同颜色**（碰撞会把它压到 2^N 以下）。
     判据与报告都必须用这个数，不能拿 1<<N 冒充色数。 */
  function distinctColors(pal) {
    const seen = {};
    let n = 0;
    for (let k = 0; k * 3 < pal.length; k++) {
      const key = pal[k * 3] * 65536 + pal[k * 3 + 1] * 256 + pal[k * 3 + 2];
      if (!seen[key]) { seen[key] = 1; n++; }
    }
    return n;
  }

  /* 碰撞对：哪些不同掩码落到了同一个颜色（给文档与判据用） */
  function collisionsOf(pal) {
    const seen = {}, out = [];
    for (let k = 0; k * 3 < pal.length; k++) {
      const key = pal[k * 3] * 65536 + pal[k * 3 + 1] * 256 + pal[k * 3 + 2];
      if (seen[key] === undefined) seen[key] = k; else out.push([seen[key], k]);
    }
    return out;
  }

  /* ==========================================================================
   * 纯函数②：套印偏移（确定性，无 Math.random）
   * --------------------------------------------------------------------------
   * 每版的相位由 (seed, i) 决定，两个不同频率的正弦叠加 —— 看起来像"版在机器里晃"，
   * 但同 (seed,i,t) 永远同一结果（视频要能逐帧复现）。
   * ========================================================================== */
  function regOf(drift, name, i, t) {
    if (typeof drift === "function") { const r = drift(name, t, i) || [0, 0]; return [r[0] || 0, r[1] || 0]; }
    if (!drift) return [0, 0];
    const amp = drift.amp === undefined ? 0 : drift.amp;
    const sp = drift.speed === undefined ? 0.8 : drift.speed;
    const seed = drift.seed === undefined ? 1 : drift.seed;
    if (!(t > -1e15 && t < 1e15)) t = 0;   /* NaN / ±Infinity 归 0：否则整张 reg 表变 NaN，
                                              而 measure() 的 Math.sqrt(NaN) 比较恒 false 会把它
                                              掩盖成「完全对齐」(regPx 报 0)。 */
    const rnd = mulberry32;
    const a = rnd(seed * 7919 + i * 131)();
    const b = rnd(seed * 104729 + i * 37)();
    const ph1 = a * Math.PI * 2, ph2 = b * Math.PI * 2;
    const dx = amp * (0.45 + 0.55 * b) * Math.sin(sp * t + ph1);
    const dy = amp * (0.45 + 0.55 * a) * Math.sin(sp * 0.77 * t + ph2);
    return [dx, dy];
  }

  /* ==========================================================================
   * 纯函数③：分色（RGB → C/M/Y/K 每格的墨量）
   * --------------------------------------------------------------------------
   * UCR（底色去除）系数 ucr：0 = 四色硬扛（黑版不用），1 = 100% GCR（暗部全交给黑）。
   * 为什么要这个旋钮：ucr=1 时暗部只有黑版有墨，套印不齐在暗部**看不出来**；
   * 默认 .55 让暗部仍带一点三色，偏移才会在暗部也漏色。
   * 输出是"每格墨量"，配 areaMap:true（原样场配 √，STANDARD §3）。
   * ========================================================================== */
  function separate(rgba, w, h, cols, rows, o) {
    o = o || {};
    const ucr = o.ucr === undefined ? 0.55 : o.ucr;
    const out = { C: new Float32Array(cols * rows), M: new Float32Array(cols * rows),
                  Y: new Float32Array(cols * rows), K: new Float32Array(cols * rows) };
    const cnt = new Float32Array(cols * rows);
    for (let y = 0; y < h; y++) {
      const cy = Math.min(rows - 1, Math.floor(y / h * rows));
      for (let x = 0; x < w; x++) {
        const cx = Math.min(cols - 1, Math.floor(x / w * cols));
        const j = cy * cols + cx;
        const i = (y * w + x) * 4;
        const r = rgba[i] / 255, g = rgba[i + 1] / 255, b = rgba[i + 2] / 255;
        const mx = Math.max(r, g, b);
        const k = clamp01(ucr * (1 - mx));
        let c = 0, m = 0, yy = 0;
        if (k < 0.999) {
          const d = 1 - k;
          c = clamp01((1 - r - k) / d); m = clamp01((1 - g - k) / d); yy = clamp01((1 - b - k) / d);
        }
        out.C[j] += c; out.M[j] += m; out.Y[j] += yy; out.K[j] += k; cnt[j] += 1;
      }
    }
    for (let j = 0; j < cols * rows; j++) {
      if (cnt[j] > 1) { const n = cnt[j]; out.C[j] /= n; out.M[j] /= n; out.Y[j] /= n; out.K[j] /= n; }
    }
    return out;
  }

  /* ==========================================================================
   * 纯函数④：N 版分色（任意墨组，不限于 CMYK）
   * --------------------------------------------------------------------------
   * 为什么需要它：palette 支持到 8 版（2^8 = 256 个色项），但 `separate` 只会拆 CMYK。
   * 想「增强色彩表现」就得能上 6 版（Hexachrome：CMYK + 橙 + 绿），而 6 版的分色不能靠
   * 四条硬编码的减法公式 —— 必须有一个**对任意墨组都成立**的解法。
   *
   * 数学基础（这是它敢叫"解"而不是"拍脑袋"的原因）：
   *   减色叠印是**乘法**：印出来的颜色 = 纸 × Π(墨_i / 纸)^a_i，a_i ∈ [0,1] 是这版的墨量。
   *   两边取对数，乘法就变成**线性**：
   *       y = log(像素 / 纸) = Σ_i a_i · log(墨_i / 纸) = A · a
   *   于是"这一格该各版上多少墨"就是一个 **3 行的非负最小二乘**：
   *       min ‖A a − y‖²   s.t.  0 ≤ a_i ≤ 1
   *       min ‖A a − y‖² + λ‖a‖²   s.t.  0 ≤ a_i ≤ 1
   *
   * 为什么"非负"和"加岭"必须一起做：
   *   ① 墨量不能是负的 —— 印厂没法"减墨"，所以是 NNLS 而不是普通最小二乘。
   *   ② 三个方程、N 个未知数：N=4 时解已经不唯一（4 > 3），N=6 时严重不唯一。不加岭，
   *      同一个颜色有无穷多组墨量能配出来，逐帧解出来的版会在等价解之间乱跳（颜色对、
   *      版不对 → 视频会抖）。加一个极小的 λ‖a‖² 让解唯一，并按"墨少的优先"排序 ——
   *      省墨本来就是印厂的硬指标。实测 λ = 迹的 1e-4 时误差 14.250 → 14.276，可忽略。
   *
   * 求解器是**逐版坐标下降**（每版一维、有闭式解、投影到 [0,1]），不是投影梯度。换掉梯度
   * 是因为实测：6 版时投影梯度 1200 次迭代还卡在 err 24.8；坐标下降 64 轮扫到 11.17、
   * 128 轮 10.76 —— 条件数差（3 个方程撑 6 个未知数）时梯度步长被最坏方向锁死。
   *
   * 对 CMYK 它**不是**替代品：`separate` 那套带 UCR/GCR 的公式仍然是四色的正解
   * （它把暗部交给黑版的控制力是 NNLS 给不出的）。这里给的是"墨组变了怎么办"。
   * ========================================================================== */
  /* 一小组墨（N 个）的求解器：给定目标 y（3 维 log 残差），返回 N 个墨量。
     逐版坐标下降 + 岭，见上面那段"为什么"。抽成内部函数是因为 base 模式要解两层。 */
  function solveGroup(A, AtA, N, yv, sweeps, out) {
    const rhs = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let c = 0; c < 3; c++) s += A[c][i] * yv[c];
      rhs[i] = s;
      const v0 = s / AtA[i][i];
      out[i] = v0 < 0 ? 0 : (v0 > 1 ? 1 : v0);
    }
    for (let sw = 0; sw < sweeps; sw++) {
      for (let i = 0; i < N; i++) {
        let s = rhs[i];
        for (let k = 0; k < N; k++) if (k !== i) s -= AtA[i][k] * out[k];
        const v = s / AtA[i][i];
        out[i] = v < 0 ? 0 : (v > 1 ? 1 : v);
      }
    }
    return out;
  }

  function makeA(inks, floor, paper) {
    const N = inks.length, A = [[], [], []];
    for (let i = 0; i < N; i++) {
      for (let c = 0; c < 3; c++) {
        const t = Math.min(1, Math.max(floor, (inks[i].rgb[c] || 0) / (paper[c] || 255)));
        A[c].push(Math.log(t));
      }
    }
    return A;
  }
  function makeAtA(A, N, ridge) {
    const M = [];
    for (let i = 0; i < N; i++) {
      M.push([]);
      for (let j = 0; j < N; j++) { let s = 0; for (let c = 0; c < 3; c++) s += A[c][i] * A[c][j]; M[i].push(s); }
    }
    let tr = 0;
    for (let i = 0; i < N; i++) tr += M[i][i];
    const lam = ridge * tr / N;
    for (let i = 0; i < N; i++) M[i][i] += lam;
    return M;
  }

  function separateN(inks, rgba, w, h, cols, rows, o) {
    o = o || {};
    const N = inks.length;
    const sweeps = o.sweeps === undefined ? (o.iters === undefined ? 64 : o.iters) : o.sweeps;
    const paper = o.paper || [242, 243, 242];
    const INK_FLOOR = o.inkFloor === undefined ? 0.03 : o.inkFloor;
    const ridge = o.ridge === undefined ? 1e-4 : o.ridge;
    /* 两种解法，差别是**哪一版背调子**，不是"哪个颜色更准"：
       free —— 六版一起解。误差最小，但会把暗部的墨全摊给彩版：
               实测一张深蓝紫风景解出来是 M .34 / G .36 / O .13、**C 与 K 近零**。
               颜色对，可 1-bit 下"暗"是由**点阵的疏密**表达的不是由颜色表达的 ——
               墨摊到三张彩版上，暗部就成了彩点拼贴（看起来像彩色噪点，不像印出来的画）。
       base —— 先让 CMYK 那一组背调子（K 吃暗部，这就是 UCR/GCR 存在的理由），
               剩下的 O/G 只能吃"CMYK 到不了的残差"。印厂的 Hexachrome 就是这么分的。
       默认 base：印刷体裁要看得出"这是一张印出来的画"。 */
    const mode = o.mode || (o.free ? "free" : "base");
    const A = makeA(inks, INK_FLOOR, paper);
    const AtA = makeAtA(A, N, ridge);

    /* base 模式的两层：先 CMYK 组，再其余。组按 name 认，认不出就整组当 base。 */
    let baseIdx = [], restIdx = [];
    if (mode === "base" && N > 4) {
      for (let i = 0; i < N; i++) {
        const nm = inks[i].name;
        if (nm === "C" || nm === "M" || nm === "Y" || nm === "K") baseIdx.push(i); else restIdx.push(i);
      }
      if (baseIdx.length === 0 || restIdx.length === 0) { baseIdx = []; restIdx = []; }
    }
    const layered = baseIdx.length > 0;
    let A1, AtA1, A2, AtA2;
    if (layered) {
      const g1 = baseIdx.map(function (i) { return inks[i]; });
      const g2 = restIdx.map(function (i) { return inks[i]; });
      A1 = makeA(g1, INK_FLOOR, paper); AtA1 = makeAtA(A1, g1.length, ridge);
      A2 = makeA(g2, INK_FLOOR, paper); AtA2 = makeAtA(A2, g2.length, ridge);
    }

    const out = {};
    for (let i = 0; i < N; i++) out[inks[i].name] = new Float32Array(cols * rows);
    const cnt = new Float32Array(cols * rows);
    const tmpV = new Float32Array(cols * rows * 3);
    for (let y = 0; y < h; y++) {
      const cy = Math.min(rows - 1, Math.floor(y / h * rows));
      for (let x = 0; x < w; x++) {
        const cx = Math.min(cols - 1, Math.floor(x / w * cols));
        const j = cy * cols + cx, i4 = (y * w + x) * 4;
        tmpV[j * 3] += rgba[i4] / 255;
        tmpV[j * 3 + 1] += rgba[i4 + 1] / 255;
        tmpV[j * 3 + 2] += rgba[i4 + 2] / 255;
        cnt[j] += 1;
      }
    }
    const yv = new Float64Array(3);
    const av = new Float64Array(N);
    const a1 = new Float64Array(N);
    const nCells = cols * rows;
    for (let j = 0; j < nCells; j++) {
      const n = cnt[j] || 1;
      for (let c = 0; c < 3; c++) {
        const px = tmpV[j * 3 + c] / n;
        yv[c] = Math.log(Math.max(1e-4, Math.min(1, px)) / (paper[c] / 255));
      }
      if (!layered) {
        solveGroup(A, AtA, N, yv, sweeps, av);
        for (let i = 0; i < N; i++) out[inks[i].name][j] = av[i];
        continue;
      }
      /* 第一层：CMYK 组背调子 */
      solveGroup(A1, AtA1, baseIdx.length, yv, sweeps, a1);
      const res = new Float64Array([yv[0], yv[1], yv[2]]);
      for (let k = 0; k < baseIdx.length; k++) {
        const i = baseIdx[k];
        out[inks[i].name][j] = a1[k];
        for (let c = 0; c < 3; c++) res[c] -= A[c][i] * a1[k];
      }
      /* 第二层：只剩 O/G。它们只能"加墨"（加暗），所以只吃负残差。 */
      for (let c = 0; c < 3; c++) res[c] = Math.min(0, res[c]);
      const a2 = new Float64Array(restIdx.length);
      solveGroup(A2, AtA2, restIdx.length, res, sweeps, a2);
      for (let k = 0; k < restIdx.length; k++) out[inks[restIdx[k]].name][j] = a2[k];
    }
    return out;
  }
  /* 每格的**源色平均**（0..1）。分色是"格"级别的，所以还原误差也必须在格级别比，
     否则拿源像素和格墨量比，误差里混着"格内本来就有梯度"这件事，读不出编码好坏。 */
  function cellAverages(rgba, w, h, cols, rows) {
    const out = new Float32Array(cols * rows * 3);
    const cnt = new Float32Array(cols * rows);
    for (let y = 0; y < h; y++) {
      const cy = Math.min(rows - 1, Math.floor(y / h * rows));
      for (let x = 0; x < w; x++) {
        const cx = Math.min(cols - 1, Math.floor(x / w * cols));
        const j = cy * cols + cx, i4 = (y * w + x) * 4;
        out[j * 3] += rgba[i4] / 255; out[j * 3 + 1] += rgba[i4 + 1] / 255; out[j * 3 + 2] += rgba[i4 + 2] / 255;
        cnt[j] += 1;
      }
    }
    for (let j = 0; j < cols * rows; j++) { const n = cnt[j] || 1; out[j * 3] /= n; out[j * 3 + 1] /= n; out[j * 3 + 2] /= n; }
    return out;
  }

  /* 分色的**还原误差**：把每格的 a 代回乘法模型 A·a，与同一格的源色平均比，
     返回 0..255 的欧氏 RGB 距离（mean / p95 / max）。
     ⚠ 这个函数曾经写错过一版：它把 A·a 再 exp 回 RGB，然后跟 A·a 自己比，恒等于 0。
     判据必须落在**源图**上才有意义 —— 所以要求传 srcAvg（cellAverages 的输出）。 */
  function reconstructError(inks, plates, srcAvg, cols, rows, paper, o) {
    paper = paper || [242, 243, 242];
    /* ⚠ 这里的下限**必须**与 separateN 里的 INK_FLOOR 一致。曾经这里写 1e-4、separateN 写 0.03，
       于是同一组墨量代回去，红通道被算成几乎全黑 —— 还原误差报 191（255 制），像"分色全错"，
       其实是两边模型不是同一个。物理量只能有一个口径。 */
    const INK_FLOOR = (o && o.inkFloor !== undefined) ? o.inkFloor : 0.03;
    const N = inks.length, nCells = cols * rows;
    const d2 = new Float64Array(nCells);
    let worst = 0, sum = 0, bad = 0;
    for (let j = 0; j < nCells; j++) {
      let ddx = 0;
      for (let c = 0; c < 3; c++) {
        let lg = 0;
        for (let i = 0; i < N; i++) {
          const arr = plates[inks[i].name]; if (!arr) continue;
          const a = arr[j]; if (!(a > 0)) continue;
          lg += a * Math.log(Math.min(1, Math.max(INK_FLOOR, (inks[i].rgb[c] || 0) / (paper[c] || 255))));
        }
        const rec = paper[c] * Math.exp(lg) / 255;        /* 还原色 0..1 */
        const d = rec - srcAvg[j * 3 + c];
        ddx += d * d;
      }
      const dist = Math.sqrt(ddx) * 255;
      d2[j] = dist; sum += dist; if (dist > worst) worst = dist;
      if (!(dist >= 0)) bad++;                            /* NaN 也要被抓出来 */
    }
    const sorted = Array.from(d2).sort(function (a, b) { return a - b; });
    const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0;
    return { mean: sum / nCells, p95: p95, max: worst, nan: bad };
  }

  /* ==========================================================================
   * 纯函数⑤：覆盖率曲线（墨量 → 这一版**真**盖住了多少格面积）
   * --------------------------------------------------------------------------
   * 为什么需要它：render 里 r = rMax·√w（areaMap），圆盘面积按 πr² 长，于是覆盖率
   * ≈ π·maxFrac²·w —— 这条线性关系**只在圆盘互不相交时**成立。maxFrac 越大，
   * 相邻圆盘越早碰在一起，并集的覆盖率就被几何压住。实测（cell 7 × scale 1.5）：
   *   maxFrac 1/√2：w 0.20→0.322、0.50→0.763、0.75→0.937、1.00→0.977（斜率 1.57 一路压到 0）
   *   maxFrac 0.5 ：w 1.00→0.763（圆盘只盖住 π/4 的格面积，四个角永远露纸）
   * 分色必须知道这条曲线，否则「解出来的墨量」和「印出来的深浅」不是同一件事。
   * 代价实测过：按密度（log 空间）解出来的墨量直接当 w 去印，灰 60 印成 164，
   * 15 色平均偏差 117 —— 色相没错，调子全丢。
   *
   * 做法是**实测**而不是解析近似：理想圆盘并集的解析式在小 w 处与引擎差 14%
   * （引擎是逐像素栅格化 + 抗锯齿，不是解析圆盘）。这里用 N 次平版渲染把曲线量出来，
   * 每次只画 24×24 格的小画布 —— 量的是**这个引擎**的曲线，换 cell / scale / maxFrac
   * 都自动跟着变。量一次约 24×3 ms，应该缓存（见 press-reel.html 的用法）。
   * ========================================================================== */
  function coverageCurve(o) {
    o = o || {};
    const RD = R();
    if (!RD) throw new Error("press 需要 render.js（装载顺序：render.js → press.js）");
    const paper = o.paper || DEFAULTS.paper;
    const maxFrac = o.maxFrac === undefined ? DEFAULTS.maxFrac : o.maxFrac;
    const areaMap = o.areaMap === false ? false : true;
    const cell = o.cell === undefined ? DEFAULTS.cell : o.cell;
    const scale = o.scale === undefined ? 1 : o.scale;
    const N = Math.max(4, o.steps || 24);
    const G = o.grid || 24;                       /* 24×24 格平版：边界效应 <1% */
    const cv = o.canvas || (typeof document !== "undefined" ? document.createElement("canvas") : null);
    if (!cv) throw new Error("coverageCurve 需要 canvas（Node 里请传 o.canvas）");
    const ink = { name: "K", rgb: [0, 0, 0], angle: 0 };
    const arr = new Float32Array(G * G);
    const tab = new Float64Array(N + 1);
    for (let i = 1; i <= N; i++) {
      arr.fill(i / N);
      const ins = create({
        canvas: cv, scale: scale, cssW: G * cell, cssH: G * cell,
        cell: cell, cols: G, rows: G, maxFrac: maxFrac, areaMap: areaMap,
        floor: 0, gain: 1, gamma: 1, tacLimit: 0, drift: null,
        paper: paper, inks: [ink], plates: { K: arr },
      });
      tab[i] = ins.draw(0).plates.K.cov;
    }
    /* 覆盖率只能随墨量单调不减；抗锯齿的数值抖动不该让反查出现双值 */
    for (let i = 1; i <= N; i++) if (tab[i] < tab[i - 1]) tab[i] = tab[i - 1];
    const maxCov = tab[N];
    function covAt(w) {
      if (!(w > 0)) return 0;
      if (w >= 1) return maxCov;
      const x = w * N, i = Math.floor(x), f = x - i;
      return tab[i] * (1 - f) + tab[Math.min(N, i + 1)] * f;
    }
    function wAt(c) {
      if (!(c > 0)) return 0;
      if (c >= maxCov) return 1;
      let lo = 0, hi = N;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tab[m] < c) lo = m; else hi = m; }
      const c0 = tab[lo], c1 = tab[hi];
      const f = c1 > c0 ? (c - c0) / (c1 - c0) : 0;
      return (lo + f) / N;
    }
    return { steps: N, cell: cell, maxFrac: maxFrac, areaMap: areaMap,
             maxCov: maxCov, table: tab, cov: covAt, w: wAt };
  }

  /* ==========================================================================
   * 纯函数⑥：按**覆盖率**分色（separateCov）
   * --------------------------------------------------------------------------
   * separateN 解的是「密度」（log 空间 y = A·a）：物理上对，前提是渲染器按 t^a 的
   * 密度记账。但这个引擎按**覆盖率**记账 —— 一格上这版盖了多少面积，合成就是
   * (1−c) + c·t。两个模型在小墨量时近似相等，墨一多就分开，暗部差得最狠。
   * 所以「六版分色渲出来发白」不是分色错了，是**记账口径**错位。
   *
   * 正模型直接写在覆盖率域：
   *     R_c = Π_i (1 − c_i·d_ic)        d_ic = 1 − t_ic（这版在该通道最多能压掉多少）
   * 也就是「每版独立地盖住 c_i 的格面积，叠印是乘法」。这是异角度（玫瑰斑）的精确模型：
   * 各版点位互不相干，覆盖率可以独立取。实测（12 色靶 / 同 45° / maxFrac 1/√2）：
   *     平均偏差 22.0 —— 公式分色的同一批是 52.3，NNLS 密度是 128.2。
   *
   * ⚠ 同角度时它不是**解析**精确的那一个：各版圆盘同心，真实分区是嵌套环
   * （第 k 环面积 = c_k − c_{k+1}，颜色 = 前 k 版相乘）。但引擎报的 c_i 里已经含了
   * 圆盘并集的重叠压缩，所以独立模型仍然是好用的近似；真要做解析版得每格枚举墨序。
   * 这一条写在注释里，免得后来人以为它是精确解。
   *
   * 求解：逐版**闭式**坐标下降（一维二次、投影到 [0, maxCov]），不需要梯度、不需要雅可比。
   * 实测 183×103 格 × 4 版 × 24 轮 ≈ 60 ms，够实时。
   * ========================================================================== */
  function separateCov(inks, rgba, w, h, cols, rows, o) {
    o = o || {};
    const N = inks.length;
    const out = {};
    for (let i = 0; i < N; i++) out[inks[i].name] = new Float32Array(cols * rows);
    if (!N) return out;
    const paper = o.paper || DEFAULTS.paper;
    const src = o.srcAvg || cellAverages(rgba, w, h, cols, rows);
    const curve = o.curve || coverageCurve({
      paper: paper, maxFrac: o.maxFrac, areaMap: o.areaMap,
      cell: o.cell, scale: o.scale, steps: o.steps, canvas: o.canvas,
    });
    const cMax = curve.maxCov;
    const sweeps = o.sweeps === undefined ? 24 : o.sweeps;
    const lam = o.ridge === undefined ? 1e-3 : o.ridge;
    /* 两层（base）：先让 CMYK 那一组把调子背下来，剩下的 O/G 只吃残差。
       为什么必须有这一层：3 个方程撑 6 个未知数，解**严重欠定**。不加约束时坐标下降
       从均匀初值出发，会把暗部的墨平摊给六张版 —— 均色对得上，但每一颗网点都是不同
       的颜色，整片天变成彩色纸屑（实测：天空里长出饱和的品红点与绿点）。
       印厂的 Hexachrome 也是这么分的：CMYK 出主体，橙绿补色域。 */
    const mode = o.mode || "free";   /* free 一起解 | base 先 CMYK 再让彩版吃残差 */
    let baseIdx = [], restIdx = [];
    if (mode === "base" && N > 4) {
      for (let i = 0; i < N; i++) {
        const nm = inks[i].name;
        if (nm === "C" || nm === "M" || nm === "Y" || nm === "K") baseIdx.push(i); else restIdx.push(i);
      }
      if (baseIdx.length === 0 || restIdx.length === 0) { baseIdx = []; restIdx = []; }
    }
    /* d[i][c] = 1 − t_ic：这一版在该通道最多能压掉多少（0 = 它在这个通道不吸光） */
    const d = [];
    for (let i = 0; i < N; i++) {
      const v = [0, 0, 0];
      for (let c = 0; c < 3; c++) v[c] = 1 - clamp01((inks[i].rgb[c] || 0) / (paper[c] || 255));
      d.push(v);
    }
    /* 顺序：坐标下降解的是**一个**最优解；N>3 时欠定、有无穷多等价解，顺序决定
       「省下来的墨记在谁头上」。默认按 inks 顺序，可传 o.order 覆盖。 */
    const order = (o.order && o.order.length === N) ? o.order : null;
    const cov = new Float64Array(N);
    const tgt = new Float64Array(3);
    const Q = new Float64Array(3);
    const nCells = cols * rows;
    for (let j = 0; j < nCells; j++) {
      /* 目标是「相对纸的码值比」，不是线性光比：press 的合成是 8-bit 码值直接相乘，
         分色与合成必须用同一条算术，否则解出来和印出来之间还差一层 gamma。 */
      for (let c = 0; c < 3; c++) {
        tgt[c] = clamp01((src[j * 3 + c] * 255) / (paper[c] || 255));
      }
      /* 初值：灰阶近似（每版都盖 1−target），比从 0 起步省一半轮数 */
      const g0 = Math.min(cMax, Math.max(0, 1 - tgt[0]));
      for (let i = 0; i < N; i++) cov[i] = g0;
      /* 一层里的坐标下降。group 是下标数组（null = 全部）。 */
      function sweep(group, target3) {
        const M = group ? group.length : N;
        for (let s = 0; s < sweeps; s++) {
          for (let kk = 0; kk < M; kk++) {
            const i = group ? group[kk] : (order ? order[kk] : kk);
            Q[0] = 1; Q[1] = 1; Q[2] = 1;
            for (let m = 0; m < M; m++) {
              const mi = group ? group[m] : m;
              if (mi === i) continue;
              const cm = cov[mi];
              if (cm <= 0) continue;
              const dm = d[mi];
              Q[0] *= 1 - cm * dm[0]; Q[1] *= 1 - cm * dm[1]; Q[2] *= 1 - cm * dm[2];
            }
            const di = d[i];
            let A = 0, B = 0;
            for (let c = 0; c < 3; c++) {
              const qd = Q[c] * di[c];
              A += qd * qd;
              B += qd * (Q[c] - target3[c]);
            }
            let v = A > 1e-18 ? B / (A * (1 + lam)) : 0;
            if (!(v > 0)) v = 0;
            if (v > cMax) v = cMax;
            cov[i] = v;
          }
        }
      }
      if (!baseIdx.length) {
        sweep(null, tgt);
      } else {
        for (let k = 0; k < restIdx.length; k++) cov[restIdx[k]] = 0;
        sweep(baseIdx, tgt);
        /* 第二层：先算出 CMYK 盖完之后「还剩多少没被压掉」，再让 O/G 去补。
           残差按通道算：prod_c = Π_base(1 − c·d)，目标比值 = tgt_c / prod_c。
           彩版只能加墨（加暗）、不能减墨，所以欠定方向上的解一律取正部分。 */
        const prod = [1, 1, 1];
        for (let k = 0; k < baseIdx.length; k++) {
          const i = baseIdx[k], ci = cov[i], di = d[i];
          if (ci <= 0) continue;
          for (let c = 0; c < 3; c++) prod[c] *= 1 - ci * di[c];
        }
        const sub = [0, 0, 0];
        let need = false;
        for (let c = 0; c < 3; c++) {
          /* ⚠ 0/0：底色已经被 CMYK 压到 0（饱和橙的蓝通道就是这种），此时「还差多少」是 1，
             不是 0。写成 tgt/prod 会得到 0，于是第二层的目标要求「这个通道不许再暗」——
             O/G 一版都上不去，六版退化成四版（实测 rose+base 时 O/G 覆盖率恒为 0）。
             判据是「CMYK 压过头了没有」，不是「比值小于 1」。 */
          if (prod[c] <= tgt[c] + 1e-6) { sub[c] = 1; continue; }
          sub[c] = clamp01(tgt[c] / prod[c]);
          need = true;
        }
        if (need) {
          const s0 = Math.min(cMax, 1 - sub[0]);
          for (let k = 0; k < restIdx.length; k++) cov[restIdx[k]] = s0;
          sweep(restIdx, sub);
        }
      }
      for (let i = 0; i < N; i++) out[inks[i].name][j] = curve.w(cov[i]);
    }
    return out;
  }
  /* ==========================================================================
   * 实例
   * ========================================================================== */
  function create(opts) {
    const RD = R();
    if (!RD || typeof RD.create !== "function") throw new Error("press 需要 render.js（装载顺序：render.js → press.js）");
    const o = RD.merge(DEFAULTS, opts || {});
    const cv = o.canvas;
    if (!cv) throw new Error("press.create 需要 canvas（或交给 DotInk.host 建）");
    const S = o.scale, CW = o.cssW, CH = o.cssH;
    const DW = Math.round(CW * S), DH = Math.round(CH * S);
    if (cv.width !== DW || cv.height !== DH) { cv.width = DW; cv.height = DH; }
    const CTX = cv.getContext("2d", { alpha: false });
    const INKS = o.inks || CLASSIC;
    const N = INKS.length;
    /* 同名 inks 会**静默合并**：buf / plates 都按 name 索引，两版都叫 C 时后版覆盖前版，
       调色板却按 2^N 分配 → 少一版墨、颜色对不上，且不报错。这里当场拦住。 */
    {
      const seenName = {};
      for (let i = 0; i < N; i++) {
        const nm = INKS[i] && INKS[i].name;
        if (!nm) throw new Error("press: 第 " + i + " 版缺少 name（版名是缓冲与 plates 的键，不能省）");
        if (seenName[nm]) throw new Error("press: 版名重复 \"" + nm + "\"（同名两版会被静默合并成一份墨）");
        seenName[nm] = 1;
      }
    }
    const PAPER = o.paper;
    const PAL = paletteOf(INKS, PAPER);
    const DISTINCT = distinctColors(PAL), COLLISIONS = collisionsOf(PAL);
    /* 哪一版是"黑"（单版盖到它是正常的黑网点，不算漏色）。没有黑版 → 0，
       于是四色里任何单版面积都算漏色 —— 这是 CMY 三色套印的正确口径。 */
    const K_IDX = INKS.findIndex(function (p) { return p && p.name === "K"; });
    const K_BLACK_BIT = K_IDX >= 0 ? (1 << K_IDX) : 0;

    const COLS = o.cols || Math.max(2, Math.round(CW / o.cell));
    const ROWS = o.rows || Math.max(2, Math.round(CH / o.cell));
    const CELL = CW / COLS;
    const RMAX = o.maxFrac * CELL;

    /* 套印码：每个像素记"哪几版盖到了它"（位掩码）—— 这是本模块的中心数据结构。
       有了它，颜色是查表得到的，不是叠出来的：一帧最多 2^N 色这条门禁就成了同义反复。 */
    const CODE = new Uint8Array(DW * DH);
    const IMG = CTX.createImageData(DW, DH), PX = IMG.data;

    /* 每一版都用**同一个** render 实例（只换 pointsAt）：省下 N 份缓冲（1080p 下每份 ~19MB）。
       maskOnly 让它只填 MASK、不 compose 不上屏 —— 圆盘栅格化与边界处理全在 render 里，这里不重写。 */
    const sub = RD.create({
      canvas: cv, scale: S, cssW: CW, cssH: CH, cols: COLS, rows: ROWS, cell: CELL,
      maxFrac: o.maxFrac, areaMap: o.areaMap, gain: 1, gamma: 1, floor: 0,
      ink: [0, 0, 0], paper: [255, 255, 255],
      pointsAt: function () { return curPts; },   /* curPts 是**数组**，别包成函数（会静默画 0 点） */
      minPointDev: o.minPointDev, shutter: 0, maskOnly: true,
      /* 直接把每版 OR 进 CODE，不再"拷一份掩膜再整帧扫" */
      maskTarget: CODE, maskBit: 1,
    });

    /* 每版一份"物化后"的场（函数场每帧求值一次成网格，之后走同一条双线性采样） */
    const buf = {};
    for (let i = 0; i < N; i++) buf[INKS[i].name] = new Float32Array(COLS * ROWS);

    function materialize(name, f, t) {
      const b = buf[name];
      if (!b) return null;
      if (!f) { b.fill(0); return b; }
      if (typeof f === "function") {
        for (let cy = 0; cy < ROWS; cy++) for (let cx = 0; cx < COLS; cx++) {
          b[cy * COLS + cx] = clamp01(f(cy * COLS + cx, cx, cy, t));
        }
        return b;
      }
      const src = ArrayBuffer.isView(f) ? f : (f && ArrayBuffer.isView(f.v) ? f.v : null);
      if (!src) { b.fill(0); return b; }
      if (src.length === b.length) { b.set(src); return b; }
      for (let j = 0; j < b.length; j++) b[j] = src[j] || 0;
      return b;
    }

    /* 总墨量限制：把四版在**同一格**上的墨量之和压到 tacLimit 以内（等比缩，色相不动）。
       这是"能不能上机印"的门槛，也是观感的分水岭 —— 不压的话暗部会糊成一块死黑。 */
    function limitTac() {
      const lim = o.tacLimit;
      if (!(lim > 0) || lim >= N) return;
      const names = []; for (let i = 0; i < N; i++) names.push(INKS[i].name);
      for (let j = 0; j < COLS * ROWS; j++) {
        let s = 0;
        for (let i = 0; i < names.length; i++) s += buf[names[i]][j];
        if (s > lim) { const k = lim / s; for (let i = 0; i < names.length; i++) buf[names[i]][j] *= k; }
      }
    }

    /* 双线性：格心在 ((cx+0.5)·CELL, (cy+0.5)·CELL)。θ=0 时落点正好是格心，
       整数判等必须**精确**返回原值 —— 否则"单版 press ≡ 单色 render"就只是近似了。 */
    function sampleAt(b, X, Y) {
      let fx = X / CELL - 0.5, fy = Y / CELL - 0.5;
      const rx = Math.round(fx), ry = Math.round(fy);
      if (Math.abs(fx - rx) < 1e-9) fx = rx;
      if (Math.abs(fy - ry) < 1e-9) fy = ry;
      if (fx < 0) fx = 0; if (fy < 0) fy = 0;
      if (fx > COLS - 1) fx = COLS - 1; if (fy > ROWS - 1) fy = ROWS - 1;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const x1 = Math.min(COLS - 1, x0 + 1), y1 = Math.min(ROWS - 1, y0 + 1);
      const tx = fx - x0, ty = fy - y0;
      const a = b[y0 * COLS + x0], bb = b[y0 * COLS + x1];
      const c = b[y1 * COLS + x0], d = b[y1 * COLS + x1];
      return (a * (1 - tx) + bb * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    }

    /* 调子映射：与 render.radiusOf 同一条式子（gain/floor 在这里，areaMap 在 radius 里） */
    function toneR(v) {
      v = clamp01(v);
      if (o.gamma !== 1) v = Math.pow(v, o.gamma);
      const w = Math.min(1, v * o.gain);
      if (w <= 0 || w < o.floor) return 0;
      return RD.radius(w, CELL, o.maxFrac, o.areaMap, 1);
    }

    /* 一版的点列：**旋转点阵**上逐点采样场。θ=0 时点阵正好落在格心，与 grid 通道等价。 */
    let ptsArr = new Float32Array(4096);
    const NO_PTS = new Float32Array(0);
    let curPts = NO_PTS;
    function buildPoints(plate, b, t, i) {
      const th = ((plate.angle || 0) + (o.drift && o.drift.rot ? regRot(plate, t, i) : 0)) * Math.PI / 180;
      const c = Math.cos(th), s = Math.sin(th);
      const reg = regOf(o.drift, plate.name, i, t);
      const ox = CELL / 2 + reg[0], oy = CELL / 2 + reg[1];
      const p = CELL;
      /* 画布四角反旋到点阵坐标，取 (u,v) 包围盒 */
      let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
      const pts = [[0, 0], [CW, 0], [0, CH], [CW, CH]];
      for (let k = 0; k < 4; k++) {
        const dx = pts[k][0] - ox, dy = pts[k][1] - oy;
        const u = (dx * c + dy * s) / p, v = (-dx * s + dy * c) / p;
        if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
      }
      u0 = Math.floor(u0) - 1; u1 = Math.ceil(u1) + 1; v0 = Math.floor(v0) - 1; v1 = Math.ceil(v1) + 1;
      let n = 0;
      const dg = plate.dotGain === undefined ? o.dotGain : plate.dotGain;
      for (let v = v0; v <= v1; v++) {
        const vp = v * p;
        for (let u = u0; u <= u1; u++) {
          const up = u * p;
          const X = ox + (up * c - vp * s), Y = oy + (up * s + vp * c);
          if (X < 0 || Y < 0 || X > CW || Y > CH) continue;
          const r = toneR(sampleAt(b, X, Y)) * dg;
          if (!(r > 0)) continue;
          if (n + 3 > ptsArr.length) { const q = new Float32Array(ptsArr.length * 2); q.set(ptsArr); ptsArr = q; }
          ptsArr[n++] = X; ptsArr[n++] = Y; ptsArr[n++] = r;
        }
      }
      return n === ptsArr.length ? ptsArr : ptsArr.subarray(0, n);
    }
    function regRot(plate, t, i) {
      const rot = o.drift.rot, sp = o.drift.speed === undefined ? 0.8 : o.drift.speed;
      const rnd = mulberry32;
      const ph = rnd((o.drift.seed === undefined ? 1 : o.drift.seed) * 3163 + i * 17)() * Math.PI * 2;
      return rot * Math.sin(sp * 0.6 * t + ph);
    }

    let lastT = 0, lastStats = null;
    function draw(t) {
      /* 入口把 t 归成一个有限数：draw(NaN) / draw(undefined) 会让 reg 表全成 NaN，
         且 measure() 用 Math.sqrt(NaN) 比较恒 false，会把 NaN 静默报成「完全对齐」。 */
      t = +t; if (!(t > -1e15 && t < 1e15)) t = 0;
      lastT = t;
      CODE.fill(0);
      const plates = o.plates || {};
      const st = { t: t, plates: {}, reg: {}, tac: 0, colors: 0, fringe: 0 };
      const total = DW * DH;
      /* 先把 N 版全部物化，再统一压总墨量 —— 顺序反了就成了"每版各自压"，
         等于把 TAC 限制失效（压的时候别的版还是 0）。 */
      for (let i = 0; i < N; i++) materialize(INKS[i].name, plates[INKS[i].name], t);
      limitTac();
      /* 每版：算点列 → 栅格化（顺带把这一版 OR 进 CODE）→ 取回精确的覆盖率。
         render 在 maskOnly 下直接写 CODE、并回报"本版新盖到多少像素"，
         所以这里**没有**任何整帧扫描 —— 4 版 1080p 的全部逐像素开销只剩最后一趟合成。 */
      let tac = 0;
      for (let i = 0; i < N; i++) {
        const plate = INKS[i];
        const b = buf[plate.name];
        const pts = buildPoints(plate, b, t, i);
        curPts = pts.length ? pts : NO_PTS;
        sub.setMaskBit(1 << i);
        const rr = sub.draw(t);
        const cov = (rr.ink || 0) / total;
        tac += cov;
        const reg = regOf(o.drift, plate.name, i, t);
        st.plates[plate.name] = { dots: pts.length / 3, cov: cov, angle: plate.angle || 0 };
        st.reg[plate.name] = [reg[0], reg[1], o.drift && o.drift.rot ? regRot(plate, t, i) : 0];
      }
      /* 合成 + 统计：一次顺序扫过 CODE，写像素、记色数、记漏色 */
      const seen = new Uint8Array(1 << N);
      let fringe = 0, single = 0, inkCov = 0;
      /* 黑版位**按名字找**，不能假设"最后一版就是黑版"：三色 CMY 里没有黑版，
         最后一版是黄 —— 那时把黄当成"正常黑网点"统计，漏色重影会被系统性低估。 */
      const kBlack = K_BLACK_BIT;
      for (let j = 0, t4 = 0; j < total; j++, t4 += 4) {
        const k = CODE[j];
        const q = k * 3;
        PX[t4] = PAL[q]; PX[t4 + 1] = PAL[q + 1]; PX[t4 + 2] = PAL[q + 2]; PX[t4 + 3] = 255;
        if (!seen[k]) seen[k] = 1;
        if (k) {
          inkCov++;
          /* 只盖到一版：黑版是正常黑网点，其余单版就是"漏色重影" */
          if ((k & (k - 1)) === 0) { single++; if (!kBlack || k !== kBlack) fringe++; }
        }
      }
      /* 真色数：按**颜色**折叠，不按掩码数 —— 格点集自己会碰撞（CLASSIC 里
         CMY(code 7) 与 CMYK(code 15) 都是纯黑），拿出现的掩码个数当色数是虚的。
         掩码最多 2^N ≤ 256 个，用一条小数组去重就够，别再开 16MB 的表。 */
      const keys = [];
      let cnt = 0, codes = 0;
      for (let k = 0; k < seen.length; k++) {
        if (!seen[k]) continue;
        codes++;
        const q = k * 3, key = (PAL[q] << 16) | (PAL[q + 1] << 8) | PAL[q + 2];
        if (keys.indexOf(key) < 0) { keys.push(key); cnt++; }
      }
      st.tac = tac; st.colors = cnt; st.codes = codes;
      st.fringe = fringe / total; st.single = single / total;
      st.inkCov = inkCov / total;
      /* 每颗着墨像素**平均叠了几版**：这是"套得准不准"的内容无关量 ——
         对齐时各版圆点同心，同一像素被多版覆盖的比例最高；一错位，圆盘错开，
         重叠区就掉下来（极端错位时接近 1 = 各版几乎互不重叠）。
         对玫瑰斑它也天然偏低（各版点位本来就不同），所以它是**同角度基准**的判据。 */
      st.platesPerInk = inkCov > 0 ? tac / st.inkCov : 0;
      lastStats = st;
      CTX.putImageData(IMG, 0, 0);
      return st;
    }
    /* ── 判据（press 自己的口径，M1/M2 不适用：那是单色网点的判据） ──
       · paletteOnly：画布上有没有跑出 2^N 格点集之外的像素（真读回，不靠信念）
       · tac：总墨量 = 各版覆盖率之和（真实印刷 ≤300% 是硬的）  · colors：实到色数
       · fringe：单色版独有的面积占比 = 肉眼看到的"漏色重影"有多少 */
    function measure() {
      const st = lastStats || { plates: {}, tac: 0, colors: 0, fringe: 0 };
      const d = CTX.getImageData(0, 0, DW, DH).data;
      let bad = 0;
      for (let j = 0, t4 = 0; j < CODE.length; j++, t4 += 4) {
        const q = CODE[j] * 3;
        if (d[t4] !== PAL[q] || d[t4 + 1] !== PAL[q + 1] || d[t4 + 2] !== PAL[q + 2]) bad++;
      }
      /* colors = 画布上真出现的不同 RGB 数（draw 里已按颜色折叠）；
         codes = 用到的掩码个数（≥ colors，差值就是碰撞被合并掉的那几项）。
         paletteSize 是 1<<N 的**上限**，paletteColors 是格点集真实色数。 */
      /* 套印偏差的**量**（CSS px / 度）：report 与判据都读这一对，
         不要让使用者自己去 reg 表里开方。regPx 是各版位移的**最大**值，
         因为"有没有错位"看的就是最歪的那一版。 */
      let regPx = 0, regRot = 0, sumPx = 0;
      const reg = st.reg || {};
      for (let i = 0; i < N; i++) {
        const r = reg[INKS[i].name];
        if (!r) continue;
        const mag = Math.sqrt(r[0] * r[0] + r[1] * r[1]);
        sumPx += mag;
        if (mag > regPx) regPx = mag;
        if (Math.abs(r[2] || 0) > regRot) regRot = Math.abs(r[2] || 0);
      }
      return {
        plates: st.plates, reg: reg, tac: st.tac,
        regPx: regPx, regPxMean: N ? sumPx / N : 0, regRot: regRot,
        inkCov: st.inkCov || 0, platesPerInk: st.platesPerInk || 0,
        colors: st.colors, codes: st.codes,
        paletteSize: 1 << N, paletteColors: DISTINCT, collisions: COLLISIONS,
        fringe: st.fringe || 0, badPixels: bad,
        cell: CELL, scale: S, devW: DW, devH: DH,
      };
    }

    const core = {
      canvas: cv, ctx: CTX, code: CODE, palette: PAL, inks: INKS, paper: PAPER,
      devW: DW, devH: DH, scale: S, cssW: CW, cssH: CH,
      cols: COLS, rows: ROWS, cell: CELL, rMax: RMAX,
      opts: o, lastT: () => lastT,
    };

    return {
      draw: draw, core: core,
      measure: measure,
      stats: () => lastStats,
      palette: PAL, inks: INKS,
      cols: COLS, rows: ROWS, cell: CELL, canvas: cv,
      duration: o.duration === undefined ? 12 : o.duration,
      opts: o,
      /* 换一套分色场（分色参数变了不必重建实例：缓冲按版名走，键不变） */
      setPlates: function (p) { o.plates = p || null; },
      /* 换 inks 必须重建（palette 与缓冲名都跟着变）—— 这里明确说不支持，免得静默出错 */
      setInks: function () {
        throw new Error("press: 换 inks 会改调色板与缓冲名，请重建实例（new DotInk.press.create）");
      },
      /* 分色助手（浏览器里才有 document）：任何一张设计稿 → 四版的场 */
      separateFrom: function (src, so) {
        so = so || {};
        const cols = so.cols || COLS, rows = so.rows || ROWS;
        const tmp = document.createElement("canvas");
        tmp.width = cols; tmp.height = rows;
        const tc = tmp.getContext("2d");
        tc.imageSmoothingEnabled = true;
        if ("imageSmoothingQuality" in tc) tc.imageSmoothingQuality = "high";
        tc.drawImage(src, 0, 0, cols, rows);
        const data = tc.getImageData(0, 0, cols, rows).data;
        return separate(data, cols, rows, cols, rows, { ucr: so.ucr === undefined ? o.ucr : so.ucr });
      },
    };
  }

  global.DotInk = Object.assign(global.DotInk || {}, {
    press: { create: create, paletteOf: paletteOf, separate: separate,
             separateN: separateN, cellAverages: cellAverages, reconstructError: reconstructError,
             separateCov: separateCov, coverageCurve: coverageCurve,
             regOf: regOf,
             distinctColors: distinctColors, collisionsOf: collisionsOf,
             DEFAULTS: DEFAULTS, CLASSIC: CLASSIC },
  });
})(typeof globalThis !== "undefined" ? globalThis : this);