/* judge.js · 点墨的判据：把标准里"能算的"变成数值
 * ============================================================================
 * 只读 render.js 暴露的 `inst.core`，自己**不碰**缓冲、不改像素：
 *   · measure(core)  → 覆盖率 / 中位点径 / 点距:点径 / 净空（装饰:信息）
 *   · judge(core, opts) → 逐条判据 + `pass`（M1/M2/M3 是互斥体裁，只算当前模式的门禁）
 *   · countNonBinary(core) → 真读画布像素，数既不是墨也不是纸的像素
 *
 * 用法：`DotInk.create()` 返回的实例上已有 `inst.measure()` / `inst.judge(t, opts)`。
 * 经典脚本。挂 window.DotInk.judge。
 * ============================================================================
 */
(function (global) {
  'use strict';

  function inkCount(core) {
    const M = core.mask; let n = 0;
    for (let j = 0; j < M.length; j++) if (M[j]) n++;
    return n;
  }

  function countIn(core, rect) {           /* rect 用**格坐标** */
    const COLS = core.cols, ROWS = core.rows, CELL = core.cell, S = core.scale;
    const DW = core.devW, DH = core.devH, M = core.mask;
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
        if (M[yy * DW + xx]) n++;
      }
    }
    return n;
  }

  function measure(core) {
    const DW = core.devW, DH = core.devH, COLS = core.cols, ROWS = core.rows;
    const CELL = core.cell, S = core.scale, RMAX = core.rMax, o = core.opts;
    const total = DW * DH;
    const ink = inkCount(core);
    const cover = ink / total;
    /* 中位点径：按**当前 t** 的场取值估（面积映射下 r ∝ √w）——判据必须跟着画面走 */
    const rs = [];
    const lt = core.lastT();
    for (let i = 0; i < COLS * ROWS; i++) {
      const cx = i % COLS, cy = (i / COLS) | 0;
      const r = core.radiusOf(core.valueAt(i, cx, cy, lt));
      if (r > 0) rs.push(r * 2 * S);
    }
    let pitchRatio = null;
    if (rs.length) { rs.sort((a, b) => a - b); const med = rs[rs.length >> 1]; if (med > 0) pitchRatio = (CELL * S) / med; }
    const out = {
      cell: CELL, cellDev: CELL * S, rMax: RMAX * S,
      pitchRatioAtFull: (CELL * S) / (RMAX * 2 * S),      /* 满墨时的 点距:点径 */
      pitchRatioMedian: pitchRatio,                        /* 该屏中位点径下的 点距:点径 */
      coverage: cover,                                     /* 全画布墨量占比 */
      points: core.points(),
      /* 没有 regions 时也要给 null —— 曾经不给，judge() 里 `!== null` 判成"有值"，
         于是在 undefined 上调 .toFixed 抛错（画廊的判据面板因此整块空白）。 */
      decoVsInfo: null,
    };
    if (o.regions) {
      const sum = rs2 => rs2.reduce((a, r) => a + countIn(core, r), 0);
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

  /* ── 1-bit 的**实测**：把画布读回来，数既不是墨也不是纸的像素 ──
     旧版这一行是写死的 `true`（文案"compose() 保证"）—— 那不是判据，是信念：
     标准 §7-1 警告的"DOM 覆盖层被拍进帧"它抓不到，画布内部的破功也抓不到。
     现在真数。代价是一次 `getImageData`（约 2M 像素），所以留了 `pixels:false` 的口子。 */
  function countNonBinary(core) {
    const DW = core.devW, DH = core.devH, INK = core.ink, PAPER = core.paper;
    const d = core.ctx.getImageData(0, 0, DW, DH).data;
    let bad = 0; const kinds = new Set();
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      if ((r === INK[0] && g === INK[1] && b === INK[2]) ||
          (r === PAPER[0] && g === PAPER[1] && b === PAPER[2])) continue;
      bad++;
      if (kinds.size < 6) kinds.add(r + ',' + g + ',' + b);
    }
    return { bad: bad, kinds: kinds.size };
  }

  /* 模式推断：**M1/M2/M3 是互斥体裁**（STANDARD §4），只能挑一个当门禁。
     auto = 点读得成点（中位比 ≥3:1）→ M1；否则按"点当面用" → M2。
     ⚠ 结构型画面（节线 / 枝 / 条纹，整区覆盖率天然 2–5%）**必须显式传 `mode:'M3'`** ——
       auto 不会替你把"太稀"解释成"勾线"（那样 pass 又会变成没意义）。 */
  function autoMode(m) {
    return (m.pitchRatioMedian !== null && m.pitchRatioMedian >= 3) ? 'M1' : 'M2';
  }

  /* 标准自检：把判据一次报全，但 **pass 只算当前模式的门禁行**。
     旧版把 M1 与 M2 同时当硬门禁 —— 做网点的画必然卡覆盖率、做面场的画必然卡 3:1，
     于是 pass 实践上恒为 false（实测 11 种真实用法 9 种报"不过"，连 README 自己的示例都不过）。
     返回：`{ mode, modes, measures, checks, failed, untested, pass }`；
     `checks[].gate === false` 的是参考行，不计入 pass。 */
  function judge(core, opts) {
    opts = opts || {};
    const m = measure(core);
    const MODES = ['M1', 'M2', 'M3'];
    let mode = opts.mode || core.opts.mode || 'auto';
    if (mode === 'auto') mode = autoMode(m);
    if (MODES.indexOf(mode) < 0) mode = 'M2';

    const J = [];
    const add = (name, ok, val, rule, gate) => J.push({ name: name, ok: ok, value: val, rule: rule, gate: gate !== false });
    const pr = m.pitchRatioMedian;
    const ratioTxt = pr === null ? 'n/a' : pr.toFixed(2) + ':1';
    const covTxt = (m.coverage * 100).toFixed(2) + '%';

    /* 通用（三种模式都硬） */
    if (opts.pixels === false || !core.draws()) {
      add('1-bit 无灰阶', null, core.draws() ? '未测（pixels:false）' : '未测（还没 draw）', '硬', true);
    } else {
      const nb = countNonBinary(core);
      add('1-bit 无灰阶', nb.bad === 0,
        nb.bad === 0 ? '0 / ' + (core.devW * core.devH) + ' px' : nb.bad + ' px（' + nb.kinds + ' 种色）', '硬', true);
    }
    add('点径上限 ≤ 点距', (core.rMax * 2) <= core.cell + 1e-6, (core.rMax * 2).toFixed(2) + '/' + core.cell.toFixed(2) + 'px', 'maxFrac ≤ 0.5', true);
    if (m.decoVsInfo !== null && m.decoVsInfo !== undefined) {
      add('装饰墨:信息墨', m.decoVsInfo <= 1.0, m.decoVsInfo.toFixed(2) + ':1', '≤1:1（目标 ≤0.33:1）', true);
    }

    /* 按模式（§4：三种体裁的判据不同，别混） */
    if (mode === 'M1') {
      add('点距:点径（中位）', pr === null ? null : pr >= 3, ratioTxt, '≥3:1（网点：点要读成点）', true);
      /* §4 的「点径 < 点距/2」说的是**实际（中位）**点径，不是满墨值 ——
         满墨那一条是"硬上限 maxFrac ≤ 0.5"，已经在上面的通用门禁里。
         而"中位比 ≥3:1"本身就蕴含"中位点径 ≤ 点距/3 < 点距/2"，所以这里只报数。 */
      add('点径 < 点距/2（中位）', null,
        pr === null ? 'n/a' : (core.cell / pr).toFixed(2) + '/' + (core.cell / 2).toFixed(2) + 'px',
        '参考（中位比 ≥3:1 已蕴含）', false);
      add('区域覆盖率', null, covTxt, '参考（M1 不看覆盖率）', false);
    } else if (mode === 'M2') {
      add('区域覆盖率 ≥ 8%', m.coverage >= 0.08, covTxt, '≥8%（面场：点当面用）', true);
      add('区域覆盖率 ≤ 55%', m.coverage <= 0.55, covTxt, '≤55%（糊成一堵墙的天花板）', true);
      add('点距:点径（中位）', null, ratioTxt, '参考（M2 不卡 3:1）', false);
    } else {
      /* M3 的阈值在标准里是**待标定**（§4），所以这里只放一道"别是全纸"的地板 ——
         真正的判断是"结构处局部覆盖率 + 1:1 看一眼"，不能拿 M2 的 8% 去卡它
         （画廊 01 沙粒版整区只有 0.51%，但节线看得清清楚楚）。 */
      add('区域覆盖率 > 0.2%', m.coverage > 0.002, covTxt, '只防"整屏全纸"；M3 的局部阈值待标定，必须 1:1 看', true);
      add('点距:点径（中位）', null, ratioTxt, '参考（M3 看结构处局部覆盖率 + 1:1）', false);
    }

    const gates = J.filter(x => x.gate);
    const failed = gates.filter(x => x.ok === false).map(x => x.name);
    const untested = gates.filter(x => x.ok === null || x.ok === undefined).map(x => x.name);
    return {
      mode: mode, modes: MODES, measures: m, checks: J,
      failed: failed, untested: untested,
      pass: failed.length === 0 && untested.length === 0,
    };
  }

  /* 导出用**加法式**（与其它件同一命名空间）。 */
  global.DotInk = Object.assign(global.DotInk || {}, {
    judge: { measure: measure, judge: judge, autoMode: autoMode, countNonBinary: countNonBinary },
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
