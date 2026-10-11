/* dotink/markplate.js · 字版厂标（MarkPlate）—— **代码逐字节移植**自主库
 * `modules/markplate/markplate.js`，未改一行；只在文件最上面加了这段出处头。
 * 生成：node tools/vendor-markplate.mjs <主库>/modules/markplate/markplate.js
 * 用途：把厂标用**字**拼出来（每格一个字，字的大小按厂标的距离场走），
 *       「阅读波」(`reveal`) 让字逐格浮现 —— 见 marks-type.html。
 * 许可：厂标路径来自 simple-icons（**CC0 1.0**），**商标归各家**；详见 NOTICE.md。
 */
/* ============================================================================
   MarkPlate 1.0 —— 把一段正文长成厂标（「文字即场景」的可复用件）
   ----------------------------------------------------------------------------
   一句话：**整幅画面就是一段字**，每个字的大小由"该处在不在标里、离边缘多远"决定。
   于是标不是贴上去的图层，标是那段正文长出来的；正文一个字都没有被改动。

   设计空间固定 1280×720 CSS，画布按 scale（默认 1.5）放大到 1920×1080 设备像素。
   一切是绝对时间 t 的纯函数：同一个 t 画两次，逐字节相同。

   用法（经典脚本，**不能**用 ESM —— file:// 下 import 会被 CORS 拦死）：

     <script src="../../../modules/markplate/markplate.js"></script>
     <script src="../../../modules/markplate/icons.js"></script>   <!-- 可选：window.MarkPlate.ICONS -->
     <script>
       const mp = MarkPlate.create({
         canvas: document.getElementById('bleed'),
         marks: [['openai','OpenAI'], ['anthropic','Anthropic']],
         text: '本周模型更新密集。推理成本继续下降……'
       });
       window.__seek = async t => { mp.draw(t); };   // 渲染器按 t 逐帧寻址
       mp.draw(0);
     </script>

   依赖注入：`icons` 不传就用 `MarkPlate.ICONS`（由 icons.js 提供）。
   厂标路径来自 simple-icons（路径数据 CC0；**商标归各家**）。
   ========================================================================== */
(function (global) {
  'use strict';

  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

  const DEFAULTS = {
    scale: 1.5,                                  /* 设备像素 / CSS 像素 */
    cssW: 1280, cssH: 720,
    ink: [12, 13, 14], paper: [242, 243, 242],
    /* 字版 */
    cell: 24, cols: 52, rows: 25, y0: 76, x0: null,
    text: '本周模型更新密集。推理成本继续下降，上下文窗口翻倍，端侧部署开始铺开。'
      + '开源权重与闭源旗舰在同一张榜上互有胜负。评测口径仍不统一，榜单只能当参考。',
    glyphPx: 20,                                  /* 字的栅格基准（缩放靠 runs 乘系数） */
    textPx: [26, 44],                             /* 26–44：**大于格距**才咬得住、成墨块 */
    maxY: 664,                                    /* 字版的最后一行（超过就跳过，别压到进度条） */
    /* 字形缩放上限。**保持它是个显式参数**：我一度把它写成 textPx 上限换算（44/20=2.2），
       想"顺手顺一点"，结果把行为藏进了一句推导里。
       注：改成 3.8 之后输出**一个像素都没变** —— 所以它跟那 0.4% 的残留差**无关**（别再把锅安给它）。 */
    fCap: 3.8,
    /* 形 */
    markPx: 700,                                  /* 距离场分辨率（越大越贵，700 约几十毫秒） */
    markSize: null,                               /* 标在设计空间里多大（px）。null = 用 markPx。
                                                     这两个**必须能分开**：绑在一起时，
                                                     分辨率给小 → 笔画核心太薄、标发灰；
                                                     给大 → 标被放大到出画（目录小样就栽在这）。 */
    marks: null,                                  /* [['slug','显示名'], …] */
    actSeconds: 4.8,
    morph: [0.34, 0.90],                          /* 一幕里"融过去"的起止进度 */
    zoom: [0.94, 1.24],                           /* 全程推镜 */
    /* 持续运动：字版的动只能靠**格子值翻转**，不能靠把一张静态图挪一挪 */
    ripple: { amp: 13, len: 0.34, speed: 4.4 },
    reveal: 1.0,                                  /* 阅读波扫完的秒数（每格只翻一次，自带"慢"） */
    paperTint: 0.055,                             /* 暗处不是纯白，只有约 6% 的墨 */
    /* 下层：名字（实墨点阵）+ 尺与读数。catalog / 小样可以把它们整个关掉。 */
    caption: { x: 120, y: 626, px: 40, weight: 700, gap: 2.4, rule: true },
    hud: { ruler: true, progress: true, timecode: true, ruleY: [40, 78], progY: 690, tcY: 12 }
  };

  function merge(base, o) {
    const r = {};
    for (const k in base) r[k] = base[k];
    for (const k in o) {
      if (o[k] === undefined) continue;
      /* caption: false / hud: false —— 整个关掉一层（目录小样要用） */
      if (o[k] === false && base[k] && typeof base[k] === 'object') { r[k] = false; continue; }
      r[k] = (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k]) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) ? merge(base[k], o[k]) : o[k];
    }
    return r;
  }

  const F5 = {
    '0': '01110,10001,10011,10101,11001,10001,01110', '1': '00100,01100,00100,00100,00100,00100,01110',
    '2': '01110,10001,00001,00010,00100,01000,11111', '3': '11111,00010,00100,00010,00001,10001,01110',
    '4': '00010,00110,01010,10010,11111,00010,00010', '5': '11111,10000,11110,00001,00001,10001,01110',
    '6': '00110,01000,10000,11110,10001,10001,01110', '7': '11111,00001,00010,00100,01000,01000,01000',
    '8': '01110,10001,10001,01110,10001,10001,01110', '9': '01110,10001,10001,01111,00001,00010,01100',
    ':': '00000,00100,00100,00000,00100,00100,00000'
  };

  function create(opts) {
    const o = merge(DEFAULTS, opts || {});
    const cv = o.canvas;
    if (!cv) throw new Error('MarkPlate.create 需要 canvas');
    const icons = o.icons || global.MarkPlate.ICONS;
    if (!icons) throw new Error('没有厂标路径：传 opts.icons，或先引 modules/markplate/icons.js');
    const marks = (o.marks && o.marks.length ? o.marks : Object.keys(icons).slice(0, 4).map(k => [k, (icons[k].title || k)]));
    if (marks.length < 2) throw new Error('marks 至少要 2 个（要能"融"过去）');
    for (const [slug] of marks) if (!icons[slug]) throw new Error('厂标库里没有：' + slug);

    const S = o.scale, CW = o.cssW, CH = o.cssH;
    const DW = Math.round(CW * S), DH = Math.round(CH * S);
    if (cv.width !== DW || cv.height !== DH) { cv.width = DW; cv.height = DH; }
    const CTX = cv.getContext('2d');
    const INK = o.ink, PAPER = o.paper;

    const COLS = o.cols, ROWS = o.rows, CS = o.cell;
    const X0 = o.x0 === null ? Math.round((CW - COLS * CS) / 2) : o.x0;
    const Y0 = o.y0, NCELL = COLS * ROWS;
    const lastProg = o.textPx[1];
    const DUR = marks.length * o.actSeconds;

    /* ---------- 网点 ---------- */
    const DISC = [];
    for (let r = 0; r <= 6; r++) {
      const off = [];
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + 0.4) off.push(dy * DW + dx);
      DISC.push(Int32Array.from(off));
    }
    const PB = new Uint8ClampedArray(DW * DH * 4);
    for (let k = 0; k < PB.length; k += 4) { PB[k] = PAPER[0]; PB[k + 1] = PAPER[1]; PB[k + 2] = PAPER[2]; PB[k + 3] = 255; }
    const IMG = CTX.createImageData(DW, DH), PX = IMG.data;
    let draws = 0;
    const stamp = () => { PX.set(PB); };
    const flush = () => { draws++; CTX.putImageData(IMG, 0, 0); };
    function dot(cx, cy, r) {
      const x = (cx * S) | 0, y = (cy * S) | 0;
      if (x < 0 || y < 0 || x >= DW || y >= DH) return;
      let rr = Math.round(r * S); if (rr < 1) rr = 1; if (rr > DISC.length - 1) rr = DISC.length - 1;
      const ed = Math.min(x, y, DW - 1 - x, DH - 1 - y);
      if (rr > ed) rr = ed;
      if (rr < 1) return;
      const off = DISC[rr], base = y * DW + x;
      for (let p = 0; p < off.length; p++) { const t = (base + off[p]) * 4; PX[t] = INK[0]; PX[t + 1] = INK[1]; PX[t + 2] = INK[2]; PX[t + 3] = 255; }
    }
    /* 实墨一律**在设备像素上描**（按 CSS 行循环会每三行漏一行 —— 这是踩过的） */
    function inkDev(x0, y, n) {
      if (y < 0 || y >= DH) return;
      for (let i = 0; i < n; i++) { const x = x0 + i; if (x < 0 || x >= DW) continue; const t = (y * DW + x) * 4; PX[t] = INK[0]; PX[t + 1] = INK[1]; PX[t + 2] = INK[2]; PX[t + 3] = 255; }
    }

    /* ---------- 栅格与距离场 ---------- */
    const RC = new Map(), SD = new Map(), NC = new Map();
    const FD = () => getComputedStyle(document.getElementById('stage') || document.body).fontFamily || 'sans-serif';
    function runsFrom(data, w, h) {
      const runs = [];
      for (let y = 0; y < h; y++) {
        const row = []; let x0 = -1;
        for (let x = 0; x < w; x++) {
          const on = data[(y * w + x) * 4 + 3] > 110;
          if (on && x0 < 0) x0 = x; else if (!on && x0 >= 0) { row.push([x0, x - 1]); x0 = -1; }
        }
        if (x0 >= 0) row.push([x0, w - 1]);
        runs.push(row);
      }
      return runs;
    }
    function rasterText(ch, px, wt) {
      px = px || o.glyphPx; wt = wt || 600;
      const key = 't|' + ch + '|' + px + '|' + wt;
      const hit = RC.get(key); if (hit) return hit;
      const c = document.createElement('canvas');
      let g = c.getContext('2d');
      const f = wt + ' ' + px + 'px ' + FD();
      g.font = f;
      const w = Math.max(6, Math.ceil(g.measureText(ch).width) + Math.ceil(px * 0.2) + 4), h = Math.ceil(px * 1.4);
      c.width = w; c.height = h;
      g = c.getContext('2d'); g.font = f;
      g.textBaseline = 'top'; g.fillStyle = '#000';
      g.fillText(ch, 2, px * 0.1);
      const out = { w, h, runs: runsFrom(g.getImageData(0, 0, w, h).data, w, h) };
      RC.set(key, out);
      return out;
    }
    function rasterMark(name, px) {
      const key = 'm|' + name + '|' + px;
      const hit = RC.get(key); if (hit) return hit;
      const c = document.createElement('canvas');
      c.width = px; c.height = px;
      const g = c.getContext('2d');
      g.setTransform(px / 24, 0, 0, px / 24, 0, 0);        /* simple-icons 是 24×24 viewBox */
      g.fillStyle = '#000';
      g.fill(new Path2D(icons[name].d));
      const out = { w: px, h: px, runs: runsFrom(g.getImageData(0, 0, px, px).data, px, px) };
      RC.set(key, out);
      return out;
    }
    /* 有向距离场：两趟 chamfer（从墨 dOut、从非墨 dIn），sdf = dOut − dIn。
       有它才能在两个标之间**融** —— 覆盖率插值是并集，那是"叠"，不是过渡。 */
    function sdfOf(name) {
      const hit = SD.get(name); if (hit) return hit;
      const R = rasterMark(name, o.markPx);
      const w = R.w, h = R.h, INF = 1e9, K = 1.4142;
      const dOut = new Float32Array(w * h), dIn = new Float32Array(w * h);
      for (let y = 0; y < h; y++) {
        const row = R.runs[y];
        for (let x = 0; x < w; x++) { dOut[y * w + x] = INF; dIn[y * w + x] = 0; }
        for (let r = 0; r < row.length; r++) for (let x = row[r][0]; x <= row[r][1]; x++) { dOut[y * w + x] = 0; dIn[y * w + x] = INF; }
      }
      const dt = d => {
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const i = y * w + x; let v = d[i];
          if (x > 0) v = Math.min(v, d[i - 1] + 1);
          if (y > 0) v = Math.min(v, d[i - w] + 1);
          if (x > 0 && y > 0) v = Math.min(v, d[i - w - 1] + K);
          if (x < w - 1 && y > 0) v = Math.min(v, d[i - w + 1] + K);
          d[i] = v;
        }
        for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
          const i = y * w + x; let v = d[i];
          if (x < w - 1) v = Math.min(v, d[i + 1] + 1);
          if (y < h - 1) v = Math.min(v, d[i + w] + 1);
          if (x < w - 1 && y < h - 1) v = Math.min(v, d[i + w + 1] + K);
          if (x > 0 && y < h - 1) v = Math.min(v, d[i + w - 1] + K);
          d[i] = v;
        }
      };
      dt(dOut); dt(dIn);
      for (let i = 0; i < dOut.length; i++) dOut[i] = (dOut[i] > 1e8 ? 999 : dOut[i]) - (dIn[i] > 1e8 ? 999 : dIn[i]);
      /* 体检：墨内应当为负、墨外为正。**这个值域不对，整个字版就画不出来** ——
         tile 小样曾只画出一小撮字，就是这里出了问题（外面看着像"有墨"，其实全是底噪点）。 */
      let mn = 1e9, mx = -1e9, neg = 0;
      for (let i = 0; i < dOut.length; i++) { const v = dOut[i]; if (v < mn) mn = v; if (v > mx) mx = v; if (v < 0) neg++; }
      const out = { w, h, d: dOut, stats: { min: +mn.toFixed(1), max: +mx.toFixed(1), negFrac: +(neg / dOut.length).toFixed(3) } };
      SD.set(name, out);
      return out;
    }
    function sdfAt(Sd, gx, gy) {
      const x = gx | 0, y = gy | 0;
      if (x < 0 || y < 0 || x >= Sd.w || y >= Sd.h) return 99;
      return Sd.d[y * Sd.w + x];
    }
    function nameDots(name, px) {
      const key = name + '|' + px;
      const hit = NC.get(key); if (hit) return hit;
      const R = rasterText(name, px, 700), out = [];
      const g = o.caption.gap;
      for (let y = 0; y < R.h; y += g) for (let x = 0; x < R.w; x += g) {
        const row = R.runs[Math.min(R.h - 1, y | 0)];
        for (let r = 0; r < row.length; r++) if (x >= row[r][0] && x <= row[r][1]) { out.push(x, y); break; }
      }
      NC.set(key, out);
      return out;
    }

    function markSet(i, t) {
      const slug = marks[i][0];
      const Sd = sdfOf(slug);
      const z = o.zoom[0] + (o.zoom[1] - o.zoom[0]) * (t / Math.max(0.001, DUR)) + 0.025 * Math.sin(0.9 * t);
      /* 设计空间 → 距离场的比例：显示尺寸 markSize（× 推镜 z）对应整个距离场宽度。
         把 markSize 默认成 markPx，就与"分辨率和尺寸绑一起"的老行为逐像素一致。 */
      const k = Sd.w / (Math.max(1, o.markSize || o.markPx) * z);
      return { Sd, k, z, name: marks[i][1], ox: CW / 2 + 12 * Math.sin(0.33 * t), oy: (Y0 + ROWS * CS) / 2 + 9 * Math.sin(0.27 * t + 1.1) };
    }

    function draw(t) {
      t = t === undefined ? 0 : t;
      const k = Math.min(marks.length - 1, Math.max(0, Math.floor(t / o.actSeconds)));
      const u = clamp01((t - k * o.actSeconds) / o.actSeconds);
      draws = 0;
      stamp();

      /* 阅读波：按**字序**扫一遍，压到 1 秒内 —— 它每格只翻一次、自带"慢"，
         一慢整片就被判成静止段（实测）。开场该交给持续的边界波。 */
      const wave = clamp01((t - 0.08) / o.reveal) * (NCELL + 520) - 260;

      /* 纸面底纹：暗处不是纯白 */
      if (o.paperTint > 0) {
        const P8 = 8, NW8 = Math.ceil(CW / P8), NH8 = Math.ceil(CH / P8);
        for (let j = 0; j < NH8; j++) for (let i = 0; i < NW8; i++) {
          const v = o.paperTint + 0.02 * Math.sin((i * 0.21 + j * 0.13) + 0.5 * t);
          if (v < 0.03) continue;
          const x = (i + 0.5) * P8, y = (j + 0.5) * P8;
          if (y < 74 || y > 660) continue;
          dot(x, y, 1.15 * Math.sqrt(v / 0.075));
        }
      }

      /* 字版：一格一字 */
      const A = markSet(k, t), B = markSet((k + 1) % marks.length, t);
      const m = sstep(o.morph[0], o.morph[1], u);
      for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
        const idx = row * COLS + col;
        const ch = o.text.charAt(idx % o.text.length);
        const cx = X0 + col * CS + CS / 2, cy = Y0 + row * CS + CS / 2;
        if (cy > o.maxY) continue;
        const sa = sdfAt(A.Sd, (cx - A.ox) * A.k + A.Sd.w / 2, (cy - A.oy) * A.k + A.Sd.h / 2);
        const sb = sdfAt(B.Sd, (cx - B.ox) * B.k + B.Sd.w / 2, (cy - B.oy) * B.k + B.Sd.h / 2);
        const sm = sa * (1 - m) + sb * m;
        const rp = o.ripple.amp * Math.sin(idx * o.ripple.len - o.ripple.speed * t);
        let v = clamp01((1.0 - sm + rp) / 11);
        v *= sstep(0, 1, (wave - idx) / 40);
        if (v < 0.45) { dot(cx, cy, 0.45 + 1.25 * (v / 0.45)); continue; }
        const px = o.textPx[0] + (o.textPx[1] - o.textPx[0]) * (v - 0.45) / 0.55;
        const f = Math.min(o.fCap, px / o.glyphPx);
        const L = rasterText(ch);
        const ox = cx - L.w * f / 2, oy = cy - L.h * f / 2 + 1.5;
        for (let y = 0, h = Math.round(L.h * f); y < h; y++) {
          const r2 = L.runs[Math.min(L.h - 1, (y / f) | 0)];
          if (!r2.length) continue;
          const dy = Math.round((oy + y) * S);
          if (dy < 0 || dy >= DH) continue;
          for (let q = 0; q < r2.length; q++) {
            const a = Math.round((ox + r2[q][0] * f) * S), b = Math.round((ox + (r2[q][1] + 1) * f) * S);
            if (b > a) inkDev(a, dy, b - a);
          }
        }
      }

      /* 名字：实墨点阵。换标时**不能两个名字叠着走**（会读成 OpenAInthropic）；
         旧的先消失、新的后出现，中间空一拍。 */
      const ca = o.caption;
      if (ca) {
        const nmA = nameDots(A.name, ca.px), nmB = nameDots(B.name, ca.px);
        const wA = clamp01(1 - m * 2.2), wB = clamp01((m - 0.45) * 1.82);
        if (wA > 0.02) for (let i = 0; i < nmA.length; i += 2) dot(ca.x + nmA[i], ca.y + nmA[i + 1], 1.25 * wA);
        if (wB > 0.02) for (let i = 0; i < nmB.length; i += 2) dot(ca.x + nmB[i], ca.y + nmB[i + 1], 1.25 * wB);
        if (ca.rule) for (let x = ca.x; x <= ca.x + ca.px * 7.5; x += 4.4) dot(x, ca.y + ca.px * 1.15, 0.85);
      }

      /* 尺与读数 */
      const H = o.hud;
      if (H) {
        if (H.ruler) {
          for (let i = 0; i <= 60; i++) {
            const x = 48 + i * 1184 / 60, long = (i % 5 === 0);
            const len = long ? 14 : 8, r = long ? 1.3 : 0.9;
            for (let y = H.ruleY[0]; y <= H.ruleY[0] + len; y += 2.4) dot(x, y, r);
          }
        }
        if (H.progress) {
          const prog = clamp01(t / DUR);
          for (let i = 0; i < 148; i++) {
            const x = 48 + i * (1184 / 147);
            dot(x, H.progY, (i / 147) <= prog ? (0.9 + 2.3 * (i / 147)) : 0.5);
          }
        }
        if (H.timecode) {
          const fn = Math.round(t * 30), pad = v => (v < 10 ? '0' : '') + v;
          const tc = pad(Math.floor(t / 3600) % 24) + ':' + pad(Math.floor(t / 60) % 60) + ':' + pad(Math.floor(t) % 60) + ':' + pad(fn % 30);
          let ci = 0;
          for (let c = 0; c < tc.length; c++) {
            const rows = F5[tc[c]]; if (!rows) { ci++; continue; }
            const rr = rows.split(',');
            for (let ry = 0; ry < 7; ry++) for (let rx = 0; rx < 5; rx++) if (rr[ry][rx] === '1') dot(1037 + ci * 18 + rx * 3, H.tcY + ry * 3, 1.15);
            ci++;
          }
        }
      }

      flush();
      return { act: k, u: +u.toFixed(4), morph: +m.toFixed(4), draws };
    }

    return {
      draw,
      duration: DUR,
      marks: marks.map(m2 => m2[0]),
      opts: o,
      /* 字体加载完成后必须清掉字形缓存：否则会一直用**回退字体**那批栅格，
         measureText 与字形对不上（field18 踩过的）。SDF 不依赖字体，不用清。 */
      reset: () => { RC.clear(); NC.clear(); },
      warm: () => { for (const [slug] of marks) sdfOf(slug); }
    };
  }

  global.MarkPlate = { version: '1.0', ICONS: null, create, sstep, clamp01 };
})(typeof window !== 'undefined' ? window : globalThis);
