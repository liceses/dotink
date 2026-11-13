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
 *   api = { dot, glyph, measureGlyph, opts, cols, rows, cell, rMax, scale, cssW, cssH, devW, devH }
 *       glyph(ch, cx, cy, px, wt, font?)  —— px 就是 CSS 字号（写多大就是多大）；font 省略则用 body 字体
 *       measureGlyph(ch, px, wt, font?)   —— { w, h, adv } 全 CSS px；排字用 adv，别猜 px 的倍数
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
    /* 点列的**设备像素半径下限**（0 = 关）。点列的 r 是 CSS px，画布缩到 1014 CSS 宽时
       0.97 CSS px 只剩 0.77 设备像素 —— 每颗粒就变成 1 个像素，一串沙读不出"颗粒"。
       给一个下限（如 1.2 设备 px）让颗粒在小尺寸下仍然是一颗圆点；
       它是**可见性下限**，不是调幅：只有比下限还小的点被抬到下限，大点一个不动。 */
    minPointDev: 0,
    duration: 12,
    shutter: 1 / 28,       /* 运动模糊：两帧叠（t 与 t−shutter）。0 = 关 */
    seed: 1,

    /* 字形模式：用字代替点（字要读得清 —— 那是**实墨**的活，不是网点的活） */
    glyph: null,           /* {ch:'·', px:20, wt:600, cap:3.8, minPx:4.5, rMin:0.75} */

    /* 叠加层（尺 / 字幕 / 角标…）：单函数或数组，签名 (api, t)。不传 = 只有场。 */
    overlays: null,

    /* 净空分区（**格坐标**：列/行）：用来把墨分成"信息"与"装饰"（judge.js 读它） */
    regions: null,          /* {info:[{x,y,w,h}], deco:[{x,y,w,h}]} */

    /* 只要掩膜（不给画面）：给 press.js 这种"一帧多版"的调用方复用圆盘栅格化用。
       maskOnly 时 draw() 只填 MASK，不 compose、不 putImageData —— 于是**一个实例**
       就能被反复用来栅格化 N 张版，不必为每版各留一份 1080p 缓冲（N=4 时省 ~57MB）。 */
    maskOnly: false,
    /* maskTarget + maskBit：maskOnly 时把墨像素 **按位 OR 进外部数组**（press.js 用它
       直接合成多版套印码），省掉"每版拷一份掩膜再整帧扫"的开销。
       掩膜语义不变：maskTarget 为空时仍然写 core.mask。 */
    maskTarget: null, maskBit: 1,
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
    /* maskOnly 的落点：外部给了 maskTarget 就写它（press 的套印码），否则写自己的 MASK */
    const MT = o.maskOnly ? (o.maskTarget || null) : null;
    /* MBIT 是**可变**的：press 用同一个 render 实例逐版换位（每版一位），
       于是"合成套印码"就在栅格化里顺带完成，不需要事后按版扫全帧。 */
    let MBIT = o.maskBit | 0 || 1;
    const TARGET = MT || MASK;
    /* 本版新盖到的像素数（精确：只在"这一位原本是 0"时 +1，重叠的圆盘不重复计） */
    let inkNew = 0;
    const stampIdx = (idx) => { if (!(TARGET[idx] & MBIT)) { TARGET[idx] |= MBIT; inkNew++; } };
    let draws = 0, lastT = 0;
    /* maskOnly 直接栅格化进 MASK，**不经 RGBA**：省掉每帧 PX.set(PB) 的 8MB 拷贝
       与 toMask() 的 8MB 回读。press.js 逐版取用时这正好是全部开销的大头。 */
    const clear = o.maskOnly ? () => {} : () => { PX.set(PB); };
    /* 判墨**不能**按亮度阈值。旧写法 `PX[i] < 128` 只在浅纸深墨下成立；
       换到深色画布（夜墨套 ink=[242,243,242] / paper=[12,13,14]）时纸也被判成墨，
       compose() 于是把整帧写成墨色 —— 实测整屏翻转、覆盖率虚报 100%。
       这里按**精确等于 INK** 判：toMask 跑的时候 PX 里只可能有两个值
       （dot / inkGlyph 写 INK，clear / PB 写 PAPER，没有中间值）。
       ⚠ 只置 1、不清零 —— 覆盖层那一轮前面已经 clear() 过 PX，场只活在 MASK 里。 */
    const toMask = o.maskOnly ? () => {} : () => {
      const r = INK[0], g = INK[1], b = INK[2];
      for (let i = 0, j = 0; i < PX.length; i += 4, j++) {
        if (PX[i] === r && PX[i + 1] === g && PX[i + 2] === b) MASK[j] = 1;
      }
    };
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
    const dot = o.maskOnly ? function (cx, cy, r) {
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
          stampIdx(base + x + dx);
        }
      }
    } : function (cx, cy, r) {
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

    /* ── 字形（可选）：字是**实墨**，不是网点。只在 glyph 模式 / 叠加层（字幕、画布内标题）里用 ──
       ⚠ 字号语义（2.2 修正）：传进来的 px **就是**字的 CSS 字号，写多大就是多大。
       旧版是"按 px 栅格化 → 再乘 f = min(cap, px/20)" —— px 被记了两次，有效字号是 px²/20：
        px=20 恰好对，40 变成 2 倍、80 变成 3.8 倍（cap 拦的就是这一头）。
       后果不是"字大一点"：advance 仍按 px 算，于是整行字幕重叠 3.8 倍、糊成一块墨
        （实测 demo/index.html 的三段字幕全是黑块）；§14 那条"画布内实墨大字标题"
       也就根本走不通，各页只能退回 DOM 覆盖层。现在按**设备像素**栅格化、1:1 上屏。
       代价：一次 getImageData 每个 (字, 字号, 字重) 只付一次（RC 缓存）。 */
    const RC = new Map();
    let off = null, offCtx = null;
    const fontOf = () => o.glyph && o.glyph.font ? o.glyph.font
      : (getComputedStyle(document.body).fontFamily || 'sans-serif');
    /* 按**设备像素字号**栅格化（缓存键含实际栅格尺寸，所以贴图是 1:1，不放大也不缩小） */
    function rasterGlyph(ch, pxDev, wt, font) {
      const ff = font || fontOf();
      const key = 'g|' + ch + '|' + pxDev + '|' + wt + '|' + ff;
      const hit = RC.get(key); if (hit) return hit;
      const pad = Math.max(4, Math.ceil(pxDev * 0.22));   /* 留白：防斜体/全角字形出框 */
      const S0 = Math.ceil(pxDev * 2.2) + pad * 2;        /* 2.2em 宽足够任何单字形 */
      if (!off) { off = document.createElement('canvas'); offCtx = off.getContext('2d'); }
      if (off.width < S0) { off.width = off.height = S0; }
      offCtx.clearRect(0, 0, off.width, off.height);
      offCtx.font = (wt || 600) + ' ' + pxDev + 'px ' + ff;
      offCtx.textBaseline = 'top'; offCtx.fillStyle = '#000';
      offCtx.fillText(ch, pad, pad);
      const adv = offCtx.measureText(ch).width;           /* 排字用**步进宽**，不是墨宽 */
      const d = offCtx.getImageData(0, 0, S0, S0).data;
      const runs = []; let x0 = -1, wMax = 0, yMax = 0, firstRow = -1;
      /* 行段行程编码：只留 α>110 的实墨像素（与 1-bit 口径一致） */
      for (let y = 0; y < S0; y++) {
        const row = []; x0 = -1;
        for (let x = 0; x < S0; x++) {
          const on = d[(y * S0 + x) * 4 + 3] > 110;
          if (on && x0 < 0) x0 = x; else if (!on && x0 >= 0) { row.push([x0, x - 1]); x0 = -1; }
        }
        if (x0 >= 0) row.push([x0, S0 - 1]);
        if (row.length) {
          if (firstRow < 0) firstRow = y;
          runs.push([y, row]); yMax = y + 1;
          for (const [a, b] of row) wMax = Math.max(wMax, b + 1);
        }
      }
      /* top = 墨框顶相对 **em 框顶** 的偏移（设备 px 存，取用时 /S）。底对齐要用它：
         没有它就只能按 px·0.5 猜，中文黑体与西文的字面率不同，猜出来会差几个像素。 */
      const rec = { w: wMax, h: yMax, adv: adv, pad: pad, runs: runs,
                    top: firstRow - pad, bot: yMax - pad };
      if (RC.size > 400) RC.clear();                      /* glyph 模式下字号连续 → 别让缓存无限长 */
      RC.set(key, rec);
      return rec;
    }
    /* 贴一个实墨字：(cx, cy) 是字的位置，px 是 CSS 字号。
       横：按**墨框**居中（单个字/角标要的是"看起来在正中"）；
       纵：按 **em 框**定位（所有字共用一条基线 —— 逐字按各自墨框居中会让 abc 的基线上下跳）。 */
    function inkGlyph(ch, cx, cy, px, wt, font) {
      const size = px > 0 ? px : 20;
      const pxDev = Math.max(1, Math.round(size * S));
      const L = rasterGlyph(ch, pxDev, wt, font);
      if (!L.runs.length) return;
      const xC = Math.round(cx * S - L.w / 2) - L.pad;
      const yT = Math.round(cy * S - pxDev / 2) - L.pad;
      for (let i = 0; i < L.runs.length; i++) {
        const yy = yT + L.runs[i][0];
        if (yy < 0 || yy >= DH) continue;
        const rowBase = yy * DW;
        const segs = L.runs[i][1];
        for (let j = 0; j < segs.length; j++) {
          const xa = Math.max(0, xC + segs[j][0]);
          const xb = Math.min(DW, xC + segs[j][1] + 1);
          if (o.maskOnly) { for (let xx = xa; xx < xb; xx++) stampIdx(rowBase + xx); }
          else for (let xx = xa; xx < xb; xx++) {
            const t = (rowBase + xx) * 4;
            PX[t] = INK[0]; PX[t + 1] = INK[1]; PX[t + 2] = INK[2]; PX[t + 3] = 255;
          }
        }
      }
    }
    /* 字的量（CSS px）：w/h 是墨框，adv 是步进宽 —— 排字只认 adv，猜 px 的倍数必然重叠 */
    function measureGlyph(ch, px, wt, font) {
      const pxDev = Math.max(1, Math.round((px > 0 ? px : 20) * S));
      const L = rasterGlyph(ch, pxDev, wt, font);
      /* top / bot：墨框的**上/下边**相对 **em 框顶** 的偏移（CSS px，负值 = 出框）。
         排版的底对齐只认这两个：inkBottom = cy − px/2 + bot（见 hud.js 的 plate()）。
         别用 h（它是"从栅格原点算的墨高"，含 pad，按它对底会差 pad 那几个像素）。 */
      return { w: L.w / S, h: L.h / S, adv: L.adv / S, top: L.top / S, bot: L.bot / S };
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
          /* minPointDev：设备像素下限（见 DEFAULTS 注释）。0 = 原样，一个字节都不动。 */
          const minDev = o.minPointDev > 0 ? o.minPointDev / S : 0;
          for (let k = 0; k + 2 < P.length; k += 3) {
            let r = P[k + 2];
            if (r > 0) {
              if (r < minDev) r = minDev;
              dot(P[k], P[k + 1], r); ptsDrawn++;
            }
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
            /* 字形模式：字要读得清才用字；小到读不清就降级成点（**降级半径 = rMin，全片一致**）。
               size 是**字号**（CSS px）；minPx 是"再小就读不成字"的门槛。 */
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
    /* 叠加层可以**擦出一块纸**（画布内标题的净空）：只清 MASK 里那些位、把 PX 写回纸色。
       这是 1-bit 合法的"减法" —— 它不加灰，只让那里"格子值不翻，墨就不存在"。
       顺序上有讲究：overlays 跑在 compose() 之后，第二次 compose() 会用 MASK 重新上墨，
       所以擦除必须同时清 MASK（只清 PX 等于没擦）。 */
    const clearRect = function (x, y, w, h) {
      const x0 = Math.max(0, Math.round(x * S)), y0 = Math.max(0, Math.round(y * S));
      const x1 = Math.min(DW, Math.round((x + w) * S)), y1 = Math.min(DH, Math.round((y + h) * S));
      for (let yy = y0; yy < y1; yy++) {
        const row = yy * DW;
        /* 三个都要写：MASK（别让第二次 compose 再上墨）、PX 的 RGB（toMask 看的是红通道，
           只清 alpha 的话红通道还是墨值 → 又被记成 1）与 alpha。 */
        for (let xx = x0; xx < x1; xx++) {
          const t = (row + xx) * 4;
          MASK[row + xx] = 0;
          PX[t] = PAPER[0]; PX[t + 1] = PAPER[1]; PX[t + 2] = PAPER[2]; PX[t + 3] = 255;
        }
      }
    };
    const LAYER = {
      dot: dot, glyph: inkGlyph, measureGlyph: measureGlyph, clear: clearRect,
      opts: o, cols: COLS, rows: ROWS, cell: CELL, rMax: RMAX,
      scale: S, cssW: CW, cssH: CH, devW: DW, devH: DH,
    };

    /* ── draw(t)：纯函数 ── */
    function draw(t) {
      draws = 0; lastT = t;
      /* 外部目标（press 的 CODE）由调用方每帧自己清零 —— 这里清会把别的版一起擦掉 */
      if (!MT) MASK.fill(0);
      inkNew = 0;
      /* 运动模糊：快门内两帧取并集（不这样快速 3D 移动会频闪） */
      const sh = o.shutter || 0;
      clear(); paint(t + sh * 0.5); toMask();
      if (sh > 0) { clear(); paint(t - sh * 0.5); toMask(); }
      /* maskOnly：到此为止 —— MASK 就是产物（press.js 逐版取用），不落屏、不留色 */
      if (o.maskOnly) { draws = 1; return { t: t, draws: draws, points: ptsDrawn, ink: inkNew }; }
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
      /* 换本版在目标数组里的位（只对 maskOnly 有意义；同时把像素计数归零） */
      setMaskBit: function (b) { MBIT = b | 0 || 1; inkNew = 0; },
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
