/* 零依赖测试：多色版套印（press.js）
 * 跑法：node --test check/press.mjs        （与别的检查一起：node --test check/*.mjs）
 * 覆盖：调色板与碰撞 · 单版 ≡ 单色 render 逐字节 · 确定性（跨实例/跨 realm/种子）· 分色与 TAC
 *       · 色数 ≤ 格点集 · 每版都有墨 · 漂移单调性（同角度基准）· 换 inks 必须重建 · 文件与装载顺序
 *
 * ⚠ 两个"只在同角度基准下才有意义"的指标（fringe / platesPerInk）：见 §7 的注释。
 * ⚠ 假画布只实现 press.js 真正用到的那三条（createImageData / putImageData / getImageData）：
 *    press 不比 render 要得多 —— 它不碰 fillRect / drawImage / 字体。
 * ⚠ 所有与 vm 里跑出来的对象比较，一律先 Array.from / 摊平成数字再比：经典脚本跑在独立
 *    realm 里，它的 Object/Array 原型与本文件不是同一个，assert/strict 的 deepEqual 会当场判不等。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ── 断言计数：每条测试自己报数（"只跑不断"的空测试在这里过不去） ──
   包一层 assert：每个断言 +1，测试结束时把数字打到该条测试的诊断里。
   断言失败照常抛，计数不影响 node:test 的判定。 */
const STATS = [];
let CUR = null;
const RAW = {};
for (const k of ['ok', 'equal', 'notEqual', 'deepEqual', 'notDeepEqual', 'throws', 'match']) {
  RAW[k] = assert[k].bind(assert);
  assert[k] = function () { if (CUR) CUR.n++; return RAW[k].apply(null, arguments); };
}
/* 用 T() 代替 test()：多一层"跑完报数"，别的行为与 node:test 一致 */
const T = (name, fn) => test(name, function (t) {
  CUR = { name: name, n: 0 };
  try { fn(t); }
  finally {
    STATS.push(CUR);
    t.diagnostic('断言 ' + CUR.n + ' 条');
    CUR = null;
  }
});

/** 把经典脚本放进干净的 vm 上下文里加载（各件加载期不碰 DOM） */
function load(...files) {
  const ctx = vm.createContext({ console: console });
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  return ctx;
}
/* ⚠ press 需要 render.js，但 **fields.js 也必须在**：press.regOf 用的是 DotInk._mulberry32，
   那是 fields.js 挂上去的。press.js:122 的兜底是 "DotInk._mulberry32 || (() => () => 0.5)"
   这个兜底会让四版相位退化成同一个常数 —— 四版整体平移、套印偏差恒为 0，**而且不报错**。
   §3 的「漂移真的在动」那条测试专门守这个静默失效。 */
const D = load('fields.js', 'render.js', 'press.js').DotInk;
const P = D.press;

/* ── 假画布：press 只用到这三条 ── */
function mkCanvas(W, H) {
  const px = new Uint8ClampedArray(W * H * 4);
  const ctx = {
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData: (img) => { px.set(img.data); },
    getImageData: () => ({ data: px.slice() }),
  };
  return { width: W, height: H, getContext: () => ctx, pixels: px };
}
const pxDiff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; };
/* 把 vm 里的"每版读数"摊平成数字数组（跨 realm 的 deepEqual 会判原型不等） */
const flatPlates = (st) => {
  const out = [];
  for (const name of ['C', 'M', 'Y', 'K']) {
    const p = st.plates[name];
    if (!p) { out.push(name, null); continue; }
    out.push(name, p.dots, p.cov, p.angle);
  }
  return out;
};
const flatReg = (reg) => {
  const out = [];
  for (const name of ['C', 'M', 'Y', 'K']) {
    const r = reg[name];
    out.push(name, r ? r[0] : null, r ? r[1] : null, r ? r[2] : null);
  }
  return out;
};

/* ════════════════ 夹具：确定性彩色源 → 分色 → 四版 ════════════════ */
const SW = 120, SH = 68;
const SRC = new Uint8ClampedArray(SW * SH * 4);
for (let y = 0; y < SH; y++) {
  const v = y / (SH - 1), l = 0.30 + 0.46 * Math.sin(Math.PI * v);      /* 明度：中间亮、上下暗 */
  for (let x = 0; x < SW; x++) {
    const u = x / (SW - 1), o = (y * SW + x) * 4;
    SRC[o]     = Math.round(255 * l * (0.5 + 0.5 * Math.cos(6.2831853 * u)));
    SRC[o + 1] = Math.round(255 * l * (0.5 + 0.5 * Math.cos(6.2831853 * (u - 1 / 3))));
    SRC[o + 2] = Math.round(255 * l * (0.5 + 0.5 * Math.cos(6.2831853 * (u - 2 / 3))));
    SRC[o + 3] = 255;
  }
}
const CW = 360, CH = 200, CELL = 8, S = 1;
const COLS = Math.round(CW / CELL), ROWS = Math.round(CH / CELL);
const MAXFRAC = 0.40;
const PLATES = P.separate(SRC, SW, SH, COLS, ROWS, { ucr: 0.55 });
/* 四版同角度 45°：这是**基准**体裁（玫瑰斑只作可选，见 §7 的对照） */
const SAME = P.CLASSIC.map(i => ({ name: i.name, title: i.title, rgb: i.rgb, angle: 45 }));
const ROSETTE = P.CLASSIC.map(i => ({ name: i.name, title: i.title, rgb: i.rgb, angle: i.angle }));
/* 单版满墨（一颗圆盘）的像素面积 / 一格像素面积 = π·maxFrac² */
const KMASK = Math.PI * MAXFRAC * MAXFRAC;

function press(o) {
  const cv = mkCanvas(Math.round(CW * S), Math.round(CH * S));
  const opts = Object.assign({
    canvas: cv, cssW: CW, cssH: CH, scale: S, cols: COLS, rows: ROWS, cell: CELL,
    maxFrac: MAXFRAC, areaMap: true, floor: 0.02, tacLimit: 2.4,
    inks: SAME, plates: PLATES, drift: null,
  }, o || {});
  const inst = P.create(opts);
  return { cv: cv, inst: inst };
}
const paper = P.DEFAULTS.paper;   /* [242,243,242] = ink.css 的 --paper #F2F3F2 */

/* ════════════════ 1. 调色板 ════════════════ */
T('调色板：2^N 项、palette[1] 精确等于单版色、code 7 与 15 碰撞、实到 15 色', () => {
  const pal = P.paletteOf(P.CLASSIC, paper);
  assert.equal(pal.length, 16 * 3, '四版应有 1<<4 = 16 项 × RGB');
  for (let c = 0; c < 3; c++) assert.equal(pal[c], paper[c], 'code 0（不落墨）必须是纸色');
  /* palette[1] = 只有第 0 版（C）落墨。透过率式 paper·(rgb/paper) 必须**精确**回到 rgb */
  const C = P.CLASSIC[0].rgb;
  for (let c = 0; c < 3; c++) {
    const raw = paper[c] * (C[c] / paper[c]);
    assert.ok(Math.abs(raw - C[c]) < 1e-9, '透过率 1 的乘法不该有可测误差（实测 ' + raw + '）');
    assert.equal(pal[3 + c], Math.round(raw), 'palette[1] 的第 ' + c + ' 通道必须等于 C 的 r/g/b');
  }
  assert.equal(pal[3], 0); assert.equal(pal[4], 174); assert.equal(pal[5], 239);
  /* CMY 叠印(7) 与 CMYK 叠印(15)：减色乘法下都收敛到 (0,0,0) —— "N 版 = 2^N 色"是错的 */
  for (let c = 0; c < 3; c++) assert.equal(pal[7 * 3 + c], pal[15 * 3 + c], 'code 7 与 15 必须同色（第 ' + c + ' 通道）');
  assert.equal(pal[7 * 3], 0); assert.equal(pal[7 * 3 + 1], 0); assert.equal(pal[7 * 3 + 2], 0);
  assert.equal(P.distinctColors(pal), 15, '四版格点集实到 15 色（不是 16）');
  const col = P.collisionsOf(pal);
  assert.equal(col.length, 1, 'CLASSIC 四色只有一组碰撞（实测 ' + JSON.stringify(col) + '）');
  assert.ok(col.some(p => p[0] === 7 && p[1] === 15), 'collisionsOf 应含 [7,15]，实测 ' + JSON.stringify(col));
  /* 版数上限：8 版可以，9 版抛错（2^9 = 512 色不受控） */
  const eight = [];
  for (let i = 0; i < 8; i++) eight.push({ name: 'P' + i, title: 'p' + i, rgb: [220 - i * 20, 20 + i * 20, 100], angle: 0 });
  assert.equal(P.paletteOf(eight, paper).length, (1 << 8) * 3, '八版应是 (1<<8)×3 项');
  assert.throws(() => P.paletteOf(eight.concat([{ name: 'X', title: 'x', rgb: [1, 2, 3], angle: 0 }]), paper),
    { name: 'Error' }, '九版必须抛错');
  /* 单版：2 项，正好纸与墨 */
  const one = P.paletteOf([{ name: 'K', title: '黑', rgb: [12, 13, 14], angle: 0 }], paper);
  assert.equal(one.length, 6);
  assert.equal(Array.from(one).join(','), '242,243,242,12,13,14', '单版格点集 = {纸, 墨}');
  assert.equal(P.distinctColors(one), 2, '单版 2 色 —— "单版 press ≡ render" 的前提');
  assert.equal(P.collisionsOf(one).length, 0, '单版没有碰撞');
});

/* ════════════════ 2. 单版等价性 ════════════════ */
T('单版等价性：同场同 cell/maxFrac、shutter 0、angle 0 时与 render 直画逐字节相同', () => {
  /* 三组不同场 / 不同 scale。角度必须是 0：45° 会把点阵转起来，与 render 的网格通道不等价 */
  const cases = [
    ['干涉场 ×2', D.fields.interference(COLS, ROWS, { k: 0.55 }), 2],
    ['横条渐变 ×1.5', D.fields.ramp(COLS, ROWS), 1.5],
    ['横条渐变 ×1', D.fields.ramp(COLS, ROWS), 1],
  ];
  for (const c of cases) {
    const label = c[0], field = c[1], scale = c[2];
    const cwid = Math.round(CW * scale), chei = Math.round(CH * scale);
    const cvR = mkCanvas(cwid, chei), cvP = mkCanvas(cwid, chei);
    D.render.create({
      canvas: cvR, cssW: CW, cssH: CH, scale: scale, cols: COLS, rows: ROWS, cell: CELL,
      maxFrac: MAXFRAC, areaMap: true, floor: 0.035, shutter: 0, field: field,
    }).draw(1.25);
    const inst = P.create({
      canvas: cvP, cssW: CW, cssH: CH, scale: scale, cols: COLS, rows: ROWS, cell: CELL,
      maxFrac: MAXFRAC, areaMap: true, floor: 0.035,
      /* 墨色取 render.DEFAULTS.ink 那一支（[12,13,14]），否则比的是两种墨 */
      inks: [{ name: 'K', title: '黑', rgb: [12, 13, 14], angle: 0 }],
      plates: { K: field }, drift: null,
    });
    inst.draw(1.25);
    assert.equal(pxDiff(cvR.pixels, cvP.pixels), 0, label + '：单版 press 必须与 render 逐字节相同');
    const m = inst.measure();
    assert.equal(m.badPixels, 0, label + '：像素必须全落在格点集上');
    assert.ok(m.plates.K.cov > 0, label + '：这一版应有墨');
    assert.equal(m.colors, 2, label + '：单版只该有纸与墨两种颜色');
    assert.equal(m.paletteColors, 2, label + '：单版格点集就 2 色');
  }
  /* 对照：45° 版**不**等价（点阵被转开）—— 这是"必须给 angle 0"的证据 */
  const f = D.fields.interference(COLS, ROWS, { k: 0.55 });
  const cvA = mkCanvas(CW, CH), cvR2 = mkCanvas(CW, CH);
  P.create({
    canvas: cvA, cssW: CW, cssH: CH, scale: 1, cols: COLS, rows: ROWS, cell: CELL,
    maxFrac: MAXFRAC, areaMap: true, floor: 0.035,
    inks: [{ name: 'K', title: '黑', rgb: [12, 13, 14], angle: 45 }], plates: { K: f }, drift: null,
  }).draw(1.25);
  D.render.create({
    canvas: cvR2, cssW: CW, cssH: CH, scale: 1, cols: COLS, rows: ROWS, cell: CELL,
    maxFrac: MAXFRAC, areaMap: true, floor: 0.035, shutter: 0, field: f,
  }).draw(1.25);
  assert.ok(pxDiff(cvA.pixels, cvR2.pixels) > 0, '45° 版与 render 网格通道不能等价（点阵被旋转）');
});

/* ════════════════ 3. 确定性 ════════════════ */
T('确定性：同参数同 t 两次逐字节相同、measure 全等；跨实例、跨 realm 也相同', () => {
  const drift = { amp: 3.5, speed: 0.8, seed: 5, rot: 0.3 };
  const A = press({ drift: drift }), B = press({ drift: drift });
  const t = 2.37;
  const sA = A.inst.draw(t);
  const snap = Uint8ClampedArray.from(A.cv.pixels);
  const sA2 = A.inst.draw(t);
  assert.equal(flatPlates(sA2).join('|'), flatPlates(sA).join('|'), '同 t 两次 draw 的每版读数应相同');
  assert.equal(pxDiff(snap, A.cv.pixels), 0, '同 t 两次 draw 应逐字节相同');
  const m1 = A.inst.measure(), m2 = A.inst.measure();
  const nums = ['tac', 'regPx', 'regPxMean', 'regRot', 'inkCov', 'platesPerInk', 'colors', 'codes',
    'paletteSize', 'paletteColors', 'fringe', 'badPixels', 'cell', 'scale', 'devW', 'devH'];
  for (const k of nums) assert.equal(m1[k], m2[k], 'measure().' + k + ' 两次应相等');
  /* 独立实例 */
  B.inst.draw(t);
  assert.equal(pxDiff(A.cv.pixels, B.cv.pixels), 0, '同参数的两个独立实例像素应相同');
  assert.equal(flatReg(B.inst.stats().reg).join('|'), flatReg(sA.reg).join('|'), '两个独立实例的每版位移应完全相同');
  /* 跨 realm（重新加载一遍脚本）：没有藏在模块级的状态 */
  const D2 = load('fields.js', 'render.js', 'press.js').DotInk;
  const cv2 = mkCanvas(CW, CH);
  const i2 = D2.press.create({
    canvas: cv2, cssW: CW, cssH: CH, scale: 1, cols: COLS, rows: ROWS, cell: CELL,
    maxFrac: MAXFRAC, areaMap: true, floor: 0.02, inks: SAME, plates: PLATES, drift: drift,
  });
  i2.draw(t);
  assert.equal(pxDiff(A.cv.pixels, cv2.pixels), 0, '跨 realm 同参数必须逐字节相同（无模块级状态）');
  assert.equal(flatReg(i2.measure().reg).join('|'), flatReg(m1.reg).join('|'), '跨 realm 的位移表也应相同');
  /* 画布不许残留上一帧：乱序画完之后的结果必须只取决于最后一个 t */
  const Cc = press({ drift: drift }), E = press({ drift: drift });
  for (const tt of [0, 3, 1.2, 7.5, 0.4]) Cc.inst.draw(tt);
  E.inst.draw(0.4);
  assert.equal(pxDiff(Cc.cv.pixels, E.cv.pixels), 0, 'draw(t) 只取决于 t，与调用历史无关');
});

T('确定性：seed 换了套印偏差就换，seed 相同必须相同；四版位移两两不等', () => {
  const reg = (seed) => {
    const inst = press({ drift: { amp: 4, speed: 0.8, seed: seed, rot: 0 } });
    inst.inst.draw(2.5);
    return inst.inst.measure();
  };
  const a = reg(3), b = reg(3), c = reg(4);
  assert.equal(flatReg(a.reg).join('|'), flatReg(b.reg).join('|'), '同 seed 的每版位移必须逐位相同');
  assert.equal(a.regPx, b.regPx);
  assert.notEqual(flatReg(a.reg).join('|'), flatReg(c.reg).join('|'), '换 seed 应换一组相位');
  assert.notEqual(a.regPx, c.regPx, '换 seed 后最大偏差应不同（实测 ' + a.regPx.toFixed(3) + ' vs ' + c.regPx.toFixed(3) + '）');
  /* 四版不能整体平移（那样就不叫"版与版对不准"了）—— 每版位移两两不等 */
  const seen = new Set();
  for (const name of ['C', 'M', 'Y', 'K']) {
    const r = a.reg[name];
    assert.ok(r, '缺 ' + name + ' 的位移');
    const key = r[0].toFixed(9) + ',' + r[1].toFixed(9);
    assert.ok(!seen.has(key), name + ' 的位移与前面的版相同（四版整体平移 = 没有套印偏差）');
    seen.add(key);
  }
  assert.equal(seen.size, 4, '四版应有四个不同位移（实测 ' + seen.size + '）');
  /* 每版的相位不随 t 冻结：同一版在 t 不同时位移不同 */
  const one = press({ drift: { amp: 4, speed: 0.8, seed: 3, rot: 0 } });
  one.inst.draw(1.0); const r1 = one.inst.measure().reg.C;
  one.inst.draw(5.0); const r2 = one.inst.measure().reg.C;
  assert.ok(Math.abs(r1[0] - r2[0]) + Math.abs(r1[1] - r2[1]) > 1e-6, 'C 版在 t=1 与 t=5 的位移不该相同');
  /* regOf 本身是纯函数；函数式 drift 原样透传 */
  const g = { amp: 4, speed: 0.8, seed: 3, rot: 0 };
  assert.equal(Array.from(P.regOf(g, 'C', 0, 2.5)).join('|'), Array.from(P.regOf(g, 'C', 0, 2.5)).join('|'), 'regOf 同参数必须同结果');
  assert.equal(Array.from(P.regOf((name, t, i) => [i * 0.9, 0], 'C', 2, 5)).join(','), '1.8,0', '函数式 drift 应原样透传');
  assert.equal(Array.from(P.regOf(null, 'C', 0, 5)).join(','), '0,0', '无 drift 时位移必须是 0');
});

T('漂移真的在动：amp>0 时套印偏差 > 0（守 fields.js 未装载时的静默失效）', () => {
  /* press.regOf 依赖 DotInk._mulberry32（fields.js 挂的）。缺了它，兜底 rnd 恒返回 0.5
     → 四版相位相同 → 整体平移 → regPx 恒 0、fringe 恒定，而**不报错**。
     这条测试用"amp 调起来后 regPx 必须动"把那种退化挡住。 */
  const align = press({ drift: null }); align.inst.draw(1.7);
  assert.equal(align.inst.measure().regPx, 0, 'drift:null 时四版严格对齐');
  assert.equal(align.inst.measure().regRot, 0, 'drift:null 时不该有微转');
  const drifted = press({ drift: { amp: 2, speed: 0.8, seed: 3, rot: 0.4 } });
  drifted.inst.draw(1.7);
  const m = drifted.inst.measure();
  /* 两轴各自 ≤ amp，所以合位移 ≤ amp·√2（不是 amp —— 这是量级，不是误差） */
  assert.ok(m.regPx > 0.5, 'amp 2px 时最大偏差应 > 0.5px（实测 ' + m.regPx.toFixed(3) + '）');
  assert.ok(m.regPx <= 2 * Math.SQRT2 + 1e-9, '最大偏差不该超过 amp·√2（实测 ' + m.regPx.toFixed(3) + '）');
  assert.ok(m.regRot > 0, 'rot 0.4° 时应量到微转（实测 ' + m.regRot.toFixed(3) + '）');
  assert.ok(m.regRot <= 0.4 + 1e-9, '微转不该超过 rot（实测 ' + m.regRot.toFixed(3) + '）');
  assert.ok(m.regPxMean > 0 && m.regPxMean <= m.regPx + 1e-9, '均值不该大于最大值');
  /* 同一帧里 t 不同 → 位移不同（它确实在走，不是冻住的一个偏移） */
  const a = drifted.inst.draw(1.7).reg.C, b = drifted.inst.draw(4.1).reg.C;
  assert.ok(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) > 1e-6, 't 变了位移应跟着变');
  /* opts 是活引用：改 opts.drift 立即生效（页面靠这条路做"一键对齐"） */
  drifted.inst.opts.drift = null; drifted.inst.draw(1.7);
  assert.equal(drifted.inst.measure().regPx, 0, 'opts.drift 置空后应立刻对齐');
  drifted.inst.opts.drift = { amp: 5, speed: 0.8, seed: 3, rot: 0 }; drifted.inst.draw(1.7);
  assert.ok(drifted.inst.measure().regPx > 0.5, 'opts.drift 设回去应立刻又错位');
});

/* 上面那条测试装了 fields.js，所以它只能防"未来的改动把相位搞坏"，
   防不住"使用者只装 render.js + press.js"。下面这条真的把 fields.js 拿掉。 */
T('装载顺序无关：只装 render.js + press.js 时四版相位仍两两不同（自带私有 mulberry32）', () => {
  function mkWith(ctx, W, H) {
    return ctx.DotInk.press.create({
      canvas: mkCanvas(W, H), cssW: W, cssH: H, scale: 1, cell: 8, cols: 45, rows: 25,
      paper: [242, 243, 242], floor: 0.035,
      drift: { amp: 2, speed: 0.8, seed: 3, rot: 0.3 },
    });
  }
  const withF = load('fields.js', 'render.js', 'press.js');
  const withoutF = load('render.js', 'press.js');
  const a = mkWith(withF, 360, 200), b = mkWith(withoutF, 360, 200);
  a.draw(1.7); b.draw(1.7);
  const ma = a.measure(), mb = b.measure();
  const uniq = (m) => {
    const s = new Set();
    for (const k of ['C', 'M', 'Y', 'K']) s.add(m.reg[k][0].toFixed(9) + ',' + m.reg[k][1].toFixed(9));
    return s.size;
  };
  assert.equal(uniq(ma), 4, '装了 fields.js 时四版位移应两两不同（实测 ' + uniq(ma) + '）');
  /* 这一条是回归护栏：修 press.js:122/310 之前，缺 fields.js 时 uniq 会退化成 1，
     四版整体平移、版间零相对错位，而且**一句警告都没有**。 */
  assert.equal(uniq(mb), 4, '只装 render+press 时四版位移也必须两两不同（实测 ' + uniq(mb) + '）—— 否则套印不齐这个核心现象根本没发生');
  assert.ok(mb.regPx > 0.5, '只装 render+press 时套印偏差应 > 0.5px（实测 ' + mb.regPx.toFixed(3) + '）');
  assert.ok(mb.regRot > 0, '只装 render+press 时也应量到微转（实测 ' + mb.regRot.toFixed(3) + '）');
  /* 两条装载路径必须给出**逐位相同**的读数：私有实现与 fields.js 的算法必须一致 */
  assert.equal(JSON.stringify(ma.reg), JSON.stringify(mb.reg), '有无 fields.js 不该改变任何一版的位移');
  assert.equal(ma.regPx, mb.regPx, 'regPx 必须一致');
  assert.equal(ma.colors, mb.colors, '色数必须一致');
  assert.equal(ma.fringe, mb.fringe, 'fringe 必须一致');
  /* regOf 与 fields.js 的 _mulberry32 必须逐位同算法 */
  const ref = withF.DotInk._mulberry32(12345), own = [];
  for (let i = 0; i < 4; i++) own.push(ref());
  const inst = P.regOf;
  assert.equal(typeof inst, 'function', 'regOf 应导出');
  const g = { amp: 10, speed: 1, seed: 7, rot: 0 };
  assert.equal(Array.from(P.regOf(g, 'C', 0, 0)).join(','), Array.from(P.regOf(g, 'C', 0, 0)).join(','), 'regOf 必须确定');
  assert.ok(Math.abs(P.regOf(g, 'C', 0, 0)[1]) >= 0, 'regOf 不该返回 NaN');
  assert.ok(own.length === 4 && own.every(v => v >= 0 && v < 1), 'fields 的 mulberry32 值域应在 [0,1)');
});

T('入口把 t 归正：draw(NaN) / draw(undefined) 不许让 reg 表出现 NaN（否则 regPx 被静默报成 0）', () => {
  const one = press({ drift: { amp: 3, speed: 0.8, seed: 5, rot: 0.4 } });
  const bad = [NaN, undefined, null, Infinity, -Infinity, 'abc', {}];
  for (const v of bad) {
    one.inst.draw(v);
    const m = one.inst.measure();
    const regTxt = JSON.stringify(m.reg);
    assert.ok(!/NaN|Infinity|null/.test(regTxt), 'draw(' + String(v) + ') 后 reg 表里出现了非有限数：' + regTxt);
    assert.ok(Number.isFinite(m.regPx), 'draw(' + String(v) + ') 后 regPx 应是有限数（实测 ' + m.regPx + '）');
    assert.ok(Number.isFinite(m.tac), 'draw(' + String(v) + ') 后 tac 应是有限数');
    assert.ok(Number.isFinite(m.fringe), 'draw(' + String(v) + ') 后 fringe 应是有限数');
  }
  /* 归正之后，draw(NaN) 与 draw(0) 必须是**同一帧** */
  one.inst.draw(NaN); const a = one.inst.measure();
  one.inst.draw(0);   const b = one.inst.measure();
  assert.equal(JSON.stringify(a.reg), JSON.stringify(b.reg), 'draw(NaN) 应等价于 draw(0)');
  assert.equal(a.regPx, b.regPx, 'draw(NaN) 与 draw(0) 的 regPx 应相同');
  /* 正常 t 之后能自愈，不该留下脏状态 */
  one.inst.draw(1.7); const c = one.inst.measure();
  assert.ok(c.regPx > 0.3, '随后给正常 t 应照常错位（实测 ' + c.regPx.toFixed(3) + '）');
  assert.ok(Number.isFinite(c.regPx), '自愈后 regPx 仍应是有限数');
});

T('版名必须唯一且非空：同名两版会被静默合并成一份墨（后版覆盖前版）', () => {
  const cv = () => mkCanvas(64, 64);
  const base = (inks) => ({ canvas: cv(), cssW: 64, cssH: 64, scale: 1, inks: inks });
  assert.throws(() => P.create(base([
    { name: 'C', rgb: [0, 174, 239], angle: 15 },
    { name: 'C', rgb: [236, 0, 140], angle: 75 },
  ])), { name: 'Error' }, '同名两版应抛错');
  let msg = '';
  try { P.create(base([{ name: 'M', rgb: [236, 0, 140] }, { name: 'M', rgb: [0, 174, 239] }])); } catch (e) { msg = String(e.message); }
  assert.match(msg, /版名重复/, '报错应点出「版名重复」');
  assert.match(msg, /M/, '报错应点出重复的是哪一版');
  assert.throws(() => P.create(base([{ rgb: [0, 0, 0] }])), /name/, '缺 name 应抛错');
  /* 正常四色不该被判成重复 */
  const ok = P.create(base(P.CLASSIC.slice()));
  assert.equal(ok.inks.length, 4, 'CLASSIC 四色应能正常创建');
  assert.equal(Array.from(ok.inks, p => p.name).join(','), 'C,M,Y,K', '版序应保持 C,M,Y,K');
  assert.equal(ok.measure, ok.measure, '实例应带 measure');
});

/* ════════════════ 4. TAC ════════════════ */
T('TAC 上限：tacLimit 0.5 时四版画完 tac ≤ 0.5 且像素不越界；收紧会真的压下去', () => {
  /* 纯黑源、ucr 0：C/M/Y/K 每格都是 [1,1,1,0]，TAC 前合计 3，一定会被压 */
  const black = new Uint8ClampedArray(64 * 64 * 4);
  for (let i = 0; i < 64 * 64; i++) { black[i * 4] = 0; black[i * 4 + 1] = 0; black[i * 4 + 2] = 0; black[i * 4 + 3] = 255; }
  const blk = P.separate(black, 64, 64, COLS, ROWS, { ucr: 0 });
  assert.equal(blk.C[0], 1); assert.equal(blk.M[0], 1); assert.equal(blk.Y[0], 1);
  assert.equal(blk.K[0], 0, 'ucr 0 时黑版不落墨（四色硬扛）');
  const run = (lim, plates) => {
    const inst = press({ plates: plates || blk, tacLimit: lim });
    inst.inst.draw(1.2);
    return inst.inst.measure();
  };
  const lo = run(0.5);
  assert.ok(lo.tac <= 0.5 + 1e-6, 'tacLimit .5 → tac 应 ≤ .5（实测 ' + lo.tac.toFixed(6) + '）');
  assert.ok(lo.tac > 0, '压了也得还有墨（实测 ' + lo.tac.toFixed(6) + '）');
  /* 独立几何核对：等比压完之后 sum(w) ≤ limit，而单版覆盖率 ≈ π·maxFrac²·w */
  assert.ok(lo.tac <= KMASK * 0.5 + 1e-6, '压后 tac 还应 ≤ π·maxFrac²·limit（圆盘面积上限，实测 ' + lo.tac.toFixed(6) + ' ≤ ' + (KMASK * 0.5).toFixed(6) + '）');
  /* 压墨之后仍在格点集上：等比缩墨量，色相不动 → badPixels 必须 0 */
  assert.equal(lo.badPixels, 0, '压墨后不许有像素跑出格点集');
  assert.ok(lo.colors <= lo.paletteColors);
  const mid = run(1.0);
  assert.ok(mid.tac <= 1.0 + 1e-6, 'tacLimit 1.0 → tac 应 ≤ 1（实测 ' + mid.tac.toFixed(6) + '）');
  assert.ok(mid.tac <= KMASK * 1.0 + 1e-6, 'tacLimit 1.0 时也应落在圆盘面积上限内');
  assert.equal(mid.badPixels, 0);
  assert.ok(lo.tac < mid.tac - 1e-3, '上限收紧应让实际总墨量下降（' + lo.tac.toFixed(4) + ' vs ' + mid.tac.toFixed(4) + '）');
  /* 上限 ≥ 版数时 limitTac 直接跳过：C/M/Y 各自满墨、K 不落墨，合计 = 3 × 单版满墨 */
  const hi = run(10);
  assert.ok(hi.tac > mid.tac + 1e-3, '上限放到 10 时不该再压（实测 ' + hi.tac.toFixed(4) + '）');
  const hc = ['C', 'M', 'Y', 'K'].map(k => hi.plates[k].cov);
  assert.equal(hc[3], 0, 'ucr 0 时 K 版不落墨');
  assert.ok(Math.abs(hc[0] - hc[1]) < 1e-12 && Math.abs(hc[1] - hc[2]) < 1e-12, '不压时 C/M/Y 覆盖率必须完全相等');
  /* 不压时 tac 必须精确等于三版之和；单版满墨 ≈ 0.567（圆盘 π·maxFrac²=0.503 是下限，
     格内点距对齐会让实到覆盖率略高 —— 所以是 ≈ 0.55~0.58，不是一个精确常数） */
  assert.ok(Math.abs(hi.tac - 3 * hc[0]) < 1e-12, 'tac 应精确等于各版 cov 之和');
  assert.ok(hc[0] > KMASK, '单版满墨覆盖率应高于圆盘面积下限 π·maxFrac²（实测 ' + hc[0].toFixed(4) + ' > ' + KMASK.toFixed(4) + '）');
  assert.ok(hc[0] < 0.62, '单版满墨覆盖率也不该离谱（实测 ' + hc[0].toFixed(4) + '）');
  assert.equal(hi.badPixels, 0);
  /* 等比缩：ucr .55 的纯黑源 C=1、K=.55，压到 2.4 后两版乘同一个系数 */
  const blk2 = P.separate(black, 64, 64, COLS, ROWS, { ucr: 0.55 });
  const m55 = run(2.4, blk2);
  const cov = ['C', 'M', 'Y', 'K'].map(k => m55.plates[k].cov);
  assert.ok(cov[3] < cov[0], 'K 墨量比 C 低（.55 vs 1），覆盖率应更小（实测 ' + cov[3].toFixed(4) + ' < ' + cov[0].toFixed(4) + '）');
  assert.ok(Math.abs(cov[0] - cov[1]) < 1e-12 && Math.abs(cov[1] - cov[2]) < 1e-12, 'C/M/Y 墨量相同 → 覆盖率必须相同');
  /* 压 TAC 是**整幅等比**的：每一版的覆盖率都必须比不压时小（没有哪一版被漏掉） */
  const raw = run(10, blk2);
  const rawCov = ['C', 'M', 'Y', 'K'].map(k => raw.plates[k].cov);
  for (let i = 0; i < 4; i++) {
    assert.ok(cov[i] < rawCov[i], ['C', 'M', 'Y', 'K'][i] + ' 版压 TAC 后覆盖率应变小（' + cov[i].toFixed(4) + ' < ' + rawCov[i].toFixed(4) + '）');
  }
  assert.ok(cov[3] / rawCov[3] < 1 && cov[0] / rawCov[0] < 1, '两版都要真的被压');
  /* opts 是活引用：tacLimit 改了立刻生效 */
  const live = press({ plates: blk, tacLimit: 10 });
  live.inst.draw(1.2);
  assert.ok(live.inst.measure().tac > 1, '先不压（实测 ' + live.inst.measure().tac.toFixed(4) + '）');
  live.inst.opts.tacLimit = 0.5;
  live.inst.draw(1.2);
  assert.ok(live.inst.measure().tac <= 0.5 + 1e-6, 'opts.tacLimit 改小后应立刻压下去');
});

T('读数自洽：tac = Σ各版 cov、platesPerInk = tac / inkCov，且能直接从 CODE 复核', () => {
  const inst = press({ drift: { amp: 3, speed: 0.8, seed: 2, rot: 0 } });
  inst.inst.draw(2.0);
  const m = inst.inst.measure(), st = inst.inst.stats();
  let sum = 0;
  for (const name of ['C', 'M', 'Y', 'K']) sum += m.plates[name].cov;
  assert.ok(Math.abs(m.tac - sum) < 1e-12, 'tac 应等于各版 cov 之和（' + m.tac + ' vs ' + sum + '）');
  assert.ok(Math.abs(m.platesPerInk - m.tac / m.inkCov) < 1e-12, 'platesPerInk 应 = tac / inkCov');
  assert.ok(m.platesPerInk >= 1 - 1e-9, '平均叠版数不该 < 1（每颗着墨像素至少被一版盖到）');
  assert.ok(m.platesPerInk <= 4 + 1e-9, '平均叠版数不该 > 版数（实测 ' + m.platesPerInk.toFixed(4) + '）');
  assert.ok(m.inkCov <= m.tac + 1e-12, 'inkCov 是面积并集，不可能大于墨量之和');
  /* ⚠ measure() 不返回 single（只有 draw()/stats() 的 st 有），要从 st 读 */
  assert.ok(typeof st.single === 'number', 'draw() 应报 single（只盖到一版的面积占比）');
  assert.ok(m.fringe <= st.single + 1e-12, 'fringe 是 single 里排除黑版的那部分，不可能大于 single（' + m.fringe + ' vs ' + st.single + '）');
  /* 直接从 CODE 复核：色数、覆盖率、单版面积都必须与 draw() 报的一致 */
  const code = inst.inst.core.code;
  const hist = new Array(16).fill(0);
  for (let j = 0; j < code.length; j++) hist[code[j]]++;
  assert.equal(st.codes, hist.filter(x => x > 0).length, 'codes 应等于 CODE 里出现过的掩码数');
  let single = 0, inkCov = 0;
  for (let k = 0; k < 16; k++) { if (k) inkCov += hist[k]; if (k && (k & (k - 1)) === 0) single += hist[k]; }
  assert.ok(Math.abs(st.inkCov - inkCov / code.length) < 1e-12, 'inkCov 应等于非零掩码的像素占比');
  assert.ok(Math.abs(st.single - single / code.length) < 1e-12, 'single 应等于单版掩码的像素占比');
  /* 黑版是"正常网点"，不算漏色：fringe = single − 只盖到 K 的那部分 */
  const kBit = 1 << 3;
  assert.ok(Math.abs(st.fringe - (single - hist[kBit]) / code.length) < 1e-12, 'fringe 应 = single − 只贴到 K 版的面积');
  assert.ok(st.tac > 0 && st.tac < 4, 'tac 是"版数"量级，不该是像素数');
});

/* ════════════════ 5. 色数 ≤ 格点集 ════════════════ */
T('色数 ≤ 格点集：对齐与漂移两种情况下 colors ≤ paletteColors、codes ≤ 1<<N', () => {
  const check = (label, drift) => {
    const inst = press({ drift: drift });
    for (const t of [0.4, 1.9, 3.3, 5.8]) {
      const st = inst.inst.draw(t);
      const m = inst.inst.measure();
      assert.ok(m.colors <= m.paletteColors, label + ' t=' + t + '：colors ' + m.colors + ' ≤ paletteColors ' + m.paletteColors);
      assert.ok(st.codes <= m.paletteSize, label + ' t=' + t + '：codes ' + st.codes + ' ≤ 1<<N ' + m.paletteSize);
      assert.ok(st.colors <= st.codes, label + '：按颜色折叠后不可能多于掩码数');
      assert.equal(m.paletteSize, 16);
      assert.equal(m.paletteColors, 15, '四版格点集实到 15 色');
      assert.equal(m.badPixels, 0, label + ' t=' + t + '：不许有像素跑出格点集');
      /* 画布上**真出现**的 RGB 数必须等于 colors（统计的是画布，不是信念） */
      const px = inst.cv.pixels, seen = new Set();
      for (let i = 0; i < px.length; i += 4) seen.add((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
      assert.equal(seen.size, m.colors, label + ' t=' + t + '：画布实际色数应等于 measure().colors');
      /* 每个出现的颜色都必须是格点集里的某一项（逐项比对，不靠信念） */
      const allowed = new Set();
      const pal = inst.inst.palette;
      for (let k = 0; k * 3 < pal.length; k++) allowed.add((pal[k * 3] << 16) | (pal[k * 3 + 1] << 8) | pal[k * 3 + 2]);
      assert.equal(allowed.size, m.paletteColors, '格点集去重后应等于 paletteColors');
      for (const key of seen) assert.ok(allowed.has(key), label + ' t=' + t + '：色 ' + key + ' 不在格点集里');
    }
  };
  check('对齐', null);
  check('漂移', { amp: 3, speed: 0.8, seed: 1, rot: 0 });
});

T('色数增多本身就是套印不齐的指纹：对齐时色数低且恒定，drift 起来后撞到 15', () => {
  const colorsAt = (drift) => {
    const inst = press({ drift: drift });
    const out = [];
    for (let k = 0; k < 8; k++) out.push(inst.inst.draw(0.37 + k * 1.9).colors);
    return out;
  };
  const aligned = colorsAt(null);
  assert.equal(new Set(aligned).size, 1, '严格对齐时色数应恒定（实测 ' + JSON.stringify(aligned) + '）');
  assert.ok(aligned[0] < 15, '对齐时不该用满 15 色（实测 ' + aligned[0] + '）');
  assert.ok(aligned[0] >= 4, '对齐时也该有多版叠色（实测 ' + aligned[0] + '）');
  const drifted = [];
  for (const seed of [1, 3, 7]) {
    const cs = colorsAt({ amp: 2, speed: 0.8, seed: seed, rot: 0 });
    drifted.push(Math.max.apply(null, cs));
    assert.ok(Math.max.apply(null, cs) > aligned[0], 'seed ' + seed + '：drift 起来后色数应上升（' + aligned[0] + ' → ' + JSON.stringify(cs) + '）');
  }
  assert.ok(drifted.every(c => c === 15), 'drift 足够大时应撞到格点集上限 15（实测 ' + JSON.stringify(drifted) + '）');
});

/* ════════════════ 6. 每版都有墨 ════════════════ */
T('每版都有墨：四版 cov 全 > 0；纯黑源 + 全 UCR 时只剩 K 版', () => {
  const inst = press({ drift: null });
  inst.inst.draw(2.1);
  const m = inst.inst.measure();
  for (const name of ['C', 'M', 'Y', 'K']) {
    assert.ok(m.plates[name] && m.plates[name].cov > 0, name + ' 版应有着墨（实测 ' + (m.plates[name] || {}).cov + '）');
    assert.ok(m.plates[name].dots > 0, name + ' 版应有网点');
    assert.equal(m.plates[name].angle, 45, name + ' 版的网角应报 45（同角度体裁）');
  }
  /* 纯黑源的三档口径（这就是"给纯黑源时 K 覆盖率最大"的正确读法）：
     · ucr 0   → C/M/Y 满墨、K 不落墨（四色硬扛）
     · ucr .55 → C/M/Y 多于 K
     · ucr 1   → 只剩 K 版（100% GCR，暗部全交黑）→ K 独占，覆盖率最大 */
  const black = new Uint8ClampedArray(64 * 64 * 4);
  for (let i = 0; i < 64 * 64; i++) { black[i * 4] = 0; black[i * 4 + 1] = 0; black[i * 4 + 2] = 0; black[i * 4 + 3] = 255; }
  const covOf = (ucr) => {
    const pl = P.separate(black, 64, 64, COLS, ROWS, { ucr: ucr });
    const i2 = press({ plates: pl, tacLimit: 10 });   /* 不压 TAC，读原始墨量分布 */
    i2.inst.draw(1.2);
    const mm = i2.inst.measure();
    return ['C', 'M', 'Y', 'K'].map(k => mm.plates[k].cov);
  };
  const c0 = covOf(0), c1 = covOf(1), c55 = covOf(0.55);
  assert.equal(c0[3], 0, 'ucr 0 时 K 版不落墨（实测 ' + c0[3] + '）');
  assert.ok(c0[0] > 0, 'ucr 0 时 C 版满墨');
  assert.ok(Math.abs(c0[0] - c0[1]) < 1e-12 && Math.abs(c0[1] - c0[2]) < 1e-12, 'ucr 0 时 C/M/Y 等量');
  assert.equal(c1[0], 0, 'ucr 1 时 C 不落墨');
  assert.equal(c1[1], 0); assert.equal(c1[2], 0);
  assert.ok(c1[3] > 0.5, 'ucr 1 时 K 独扛（实测 ' + c1[3].toFixed(4) + '）');
  assert.ok(c1[3] > Math.max(c1[0], c1[1], c1[2]), 'ucr 1 时 K 版覆盖率最大');
  assert.ok(c55[3] > 0 && c55[3] < c55[0], 'ucr .55 时 K 有墨但少于 C（实测 ' + c55[3].toFixed(4) + ' < ' + c55[0].toFixed(4) + '）');
  /* ucr 越大黑版越多：0 → .55 → 1 的 K 覆盖率单调升 */
  assert.ok(c0[3] < c55[3] && c55[3] < c1[3], 'K 覆盖率应随 ucr 单调升（' + c0[3] + ' → ' + c55[3].toFixed(4) + ' → ' + c1[3].toFixed(4) + '）');
});

T('空源不崩：全零场时 tac=0、只剩纸色、不越界；除零不成 NaN', () => {
  const zeros = {};
  for (const i of SAME) zeros[i.name] = new Float32Array(COLS * ROWS);
  const inst = press({ plates: zeros });
  inst.inst.draw(1);
  const m = inst.inst.measure();
  assert.equal(m.tac, 0);
  assert.equal(m.inkCov, 0);
  assert.equal(m.colors, 1, '只有纸一种颜色');
  assert.equal(m.codes, 1, '只用到掩码 0');
  assert.equal(m.platesPerInk, 0, '没墨时平均叠版数应为 0（不能除零出 NaN）');
  assert.ok(Number.isFinite(m.platesPerInk), '不该是 NaN/Infinity');
  assert.equal(m.badPixels, 0);
  for (const name of ['C', 'M', 'Y', 'K']) assert.equal(m.plates[name].cov, 0, name + ' 版应全空');
  /* plates:null（一版都不给）同样不许崩 */
  const none = press({ plates: null });
  none.inst.draw(1);
  const m2 = none.inst.measure();
  assert.equal(m2.tac, 0);
  assert.equal(m2.colors, 1);
  assert.equal(m2.badPixels, 0);
  /* 空场画出来的像素必须全是纸色 */
  const px = none.cv.pixels;
  assert.equal(px[0], paper[0]); assert.equal(px[1], paper[1]); assert.equal(px[2], paper[2]);
});

/* ════════════════ 7. 漂移单调性（同角度基准） ════════════════ */
T('漂移单调性（同角度基准）：amp 0→2→5 时 platesPerInk 单调降、fringe 单调升（3 个 seed）', (t) => {
  /* ⚠ 这两个指标**只对同角度基准有意义**：
     · platesPerInk（= tac/inkCov）：各版点位重合时最高，一错位就掉。玫瑰斑各版点位本来就
       不同，它天然低且**不随 drift 变** —— 所以它不能拿来跨角度比较。
     · fringe（只被一版盖到的非黑面积占比）：同理（玫瑰斑即使完全对齐也有 ~0.4）。
     所以这里四版**同一角度 45°**，只让 drift 变化；玫瑰斑只作"基准约束"的对照。 */
  const measure3 = (amp, seed) => {
    const inst = press({ inks: SAME, drift: amp > 0 ? { amp: amp, speed: 0.8, seed: seed, rot: 0 } : null });
    let ppi = 0, fr = 0, n = 0;
    for (let k = 0; k < 6; k++) {          /* 沿一条时间线取平均，避免单点偶然 */
      const st = inst.inst.draw(0.37 + k * 1.9);
      ppi += st.platesPerInk; fr += st.fringe; n++;
    }
    return { ppi: ppi / n, fringe: fr / n };
  };
  const rows = [];
  for (const seed of [1, 3, 7]) {
    const A = measure3(0, seed), B = measure3(2, seed), Cc = measure3(5, seed);
    rows.push([seed, A, B, Cc]);
    assert.ok(A.ppi > B.ppi, 'seed ' + seed + '：amp 0 的平均叠版应高于 amp 2（' + A.ppi.toFixed(4) + ' vs ' + B.ppi.toFixed(4) + '）');
    assert.ok(B.ppi > Cc.ppi, 'seed ' + seed + '：amp 2 的平均叠版应高于 amp 5（' + B.ppi.toFixed(4) + ' vs ' + Cc.ppi.toFixed(4) + '）');
    assert.ok(A.fringe < B.fringe, 'seed ' + seed + '：amp 0 的漏色应少于 amp 2（' + A.fringe.toFixed(4) + ' vs ' + B.fringe.toFixed(4) + '）');
    assert.ok(B.fringe < Cc.fringe, 'seed ' + seed + '：amp 2 的漏色应少于 amp 5（' + B.fringe.toFixed(4) + ' vs ' + Cc.fringe.toFixed(4) + '）');
    assert.ok(A.ppi > 1.8, 'seed ' + seed + '：严格对齐时平均叠版应 > 1.8（实测 ' + A.ppi.toFixed(4) + '）');
    assert.ok(Cc.ppi > 1.0, 'seed ' + seed + '：错位到 5px 也仍 > 1（各版不会完全散开）');
    assert.ok(A.fringe < 0.25, 'seed ' + seed + '：对齐时漏色应很小（实测 ' + A.fringe.toFixed(4) + '）');
    assert.ok(Cc.fringe > 0.3, 'seed ' + seed + '：amp 5 时漏色应明显（实测 ' + Cc.fringe.toFixed(4) + '）');
  }
  /* 三个 seed 的单调方向必须一致（不是某一次碰巧） */
  assert.ok(rows.every(r => r[1].ppi > r[2].ppi && r[2].ppi > r[3].ppi), '三个 seed 的 platesPerInk 应同向单调');
  assert.ok(rows.every(r => r[1].fringe < r[2].fringe && r[2].fringe < r[3].fringe), '三个 seed 的 fringe 应同向单调');
  t.diagnostic('单调性实测 ' + rows.map(r =>
    'seed' + r[0] + ' ppi ' + [r[1].ppi, r[2].ppi, r[3].ppi].map(x => x.toFixed(3)).join('→') +
    ' fringe ' + [r[1].fringe, r[2].fringe, r[3].fringe].map(x => x.toFixed(3)).join('→')).join(' | '));

  /* 对照：玫瑰斑（15/75/0/45）下这两个指标**不**随 drift 单调 —— 这正是"基准约束"的证据 */
  const ros = [];
  for (const amp of [0, 2, 5]) {
    const inst = press({ inks: ROSETTE, drift: amp > 0 ? { amp: amp, speed: 0.8, seed: 3, rot: 0 } : null });
    let ppi = 0, fr = 0;
    for (let k = 0; k < 6; k++) { const st = inst.inst.draw(0.37 + k * 1.9); ppi += st.platesPerInk; fr += st.fringe; }
    ros.push({ ppi: ppi / 6, fringe: fr / 6 });
  }
  assert.ok(ros[0].ppi < rows[0][1].ppi - 0.2,
    '玫瑰斑即使完全对齐，平均叠版也远低于同角度基准（' + ros[0].ppi.toFixed(4) + ' vs ' + rows[0][1].ppi.toFixed(4) + '）');
  assert.ok(Math.abs(ros[2].ppi - ros[0].ppi) < 0.05,
    '玫瑰斑的 platesPerInk 几乎不随 drift 变（' + ros[0].ppi.toFixed(4) + ' → ' + ros[2].ppi.toFixed(4) + '）');
  assert.ok(ros[0].fringe > rows[0][1].fringe,
    '玫瑰斑完全对齐时的漏色也高于同角度对齐（' + ros[0].fringe.toFixed(4) + ' vs ' + rows[0][1].fringe.toFixed(4) + '）');
  t.diagnostic('玫瑰斑对照 ppi ' + ros.map(r => r.ppi.toFixed(3)).join('/') + ' · fringe ' + ros.map(r => r.fringe.toFixed(3)).join('/'));
});

/* ════════════════ 8. 换 inks 必须重建 ════════════════ */
T('setInks 必须抛错（换 inks 会改调色板与缓冲名，只能重建实例）', () => {
  const inst = press({});
  assert.throws(() => inst.inst.setInks([]), { name: 'Error' }, 'setInks 必须抛错');
  assert.throws(() => inst.inst.setInks(P.CLASSIC), { name: 'Error' }, '同参数也必须抛错（不做"猜你要什么"的静默处理）');
  let msg = '';
  try { inst.inst.setInks([]); } catch (e) { msg = String(e.message); }
  assert.match(msg, /重建/, '报错里要教怎么改（提到"重建"）');
  /* 其它运行时旋钮**不**该抛：setPlates / opts.drift / opts.tacLimit 都是合法改法 */
  assert.equal(typeof inst.inst.setPlates, 'function');
  inst.inst.setPlates(PLATES);
  inst.inst.draw(1);
  assert.ok(inst.inst.measure().tac > 0, 'setPlates 之后应能继续画');
  inst.inst.setPlates(null);
  inst.inst.draw(1);
  assert.equal(inst.inst.measure().tac, 0, 'setPlates(null) 应清空四版');
});

T('分色 separate：纯函数、端点（白全 0 / 黑 ucr0 三色满 / ucr1 只剩 K）、格内取平均', () => {
  const a = P.separate(SRC, SW, SH, COLS, ROWS, { ucr: 0.55 });
  const b = P.separate(SRC, SW, SH, COLS, ROWS, { ucr: 0.55 });
  for (const k of ['C', 'M', 'Y', 'K']) {
    assert.equal(a[k].length, COLS * ROWS, k + ' 版长度应等于格数');
    assert.equal(Array.from(a[k]).join(','), Array.from(b[k]).join(','), 'separate 必须是纯函数（' + k + '）');
    let mn = 1, mx = 0;
    for (const v of a[k]) { if (v < mn) mn = v; if (v > mx) mx = v; }
    assert.ok(mn >= 0 && mx <= 1, k + ' 版墨量应落在 [0,1]（实测 ' + mn + '..' + mx + '）');
    assert.ok(mx > 0.1, k + ' 版应有墨（实测 max ' + mx.toFixed(3) + '）');
  }
  /* 白 → 四版全 0 */
  const white = new Uint8ClampedArray(16 * 16 * 4).fill(255);
  const w = P.separate(white, 16, 16, 4, 4, { ucr: 0.55 });
  for (const k of ['C', 'M', 'Y', 'K']) assert.equal(w[k][0], 0, '白源 ' + k + ' 应为 0');
  /* 黑 ucr 0 → C/M/Y 满、K 0 */
  const black = new Uint8ClampedArray(16 * 16 * 4);
  for (let i = 0; i < 16 * 16; i++) { black[i * 4] = 0; black[i * 4 + 1] = 0; black[i * 4 + 2] = 0; black[i * 4 + 3] = 255; }
  const b0 = P.separate(black, 16, 16, 4, 4, { ucr: 0 });
  assert.equal(b0.C[0], 1); assert.equal(b0.M[0], 1); assert.equal(b0.Y[0], 1);
  assert.equal(b0.K[0], 0, 'ucr 0 时黑版为 0');
  /* 黑 ucr 1 → 只剩 K */
  const b1 = P.separate(black, 16, 16, 4, 4, { ucr: 1 });
  assert.equal(b1.C[0], 0); assert.equal(b1.M[0], 0); assert.equal(b1.Y[0], 0);
  assert.equal(b1.K[0], 1, 'ucr 1 时暗部全交黑版');
  /* 一格里墨量取**平均**（不是抽样、不是取最大） */
  const half = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
  const h = P.separate(half, 2, 1, 1, 1, { ucr: 0.55 });
  assert.ok(Math.abs(h.K[0] - 0.275) < 1e-6, '半黑半白的一格 K 应是 0.5·ucr（实测 ' + h.K[0] + '）');
  /* 默认 ucr = .55（DEFAULTS 是标准的一部分） */
  assert.equal(P.DEFAULTS.ucr, 0.55);
  assert.equal(P.DEFAULTS.tacLimit, 2.4);
  const hd = P.separate(half, 2, 1, 1, 1);
  assert.ok(Math.abs(hd.K[0] - h.K[0]) < 1e-12, '不传 ucr 时应等于 ucr=.55');
});

/* ════════════════ 10. N 版分色（separateN）与还原误差 ════════════════ */
/* 六版 Hexachrome：CMYK + 橙 + 绿。这是"增强色彩表现"的现实路径，也是 separateN 存在的理由。
   角度 15/75/0/45 仍是经典玫瑰斑组，橙绿插在 30/60（彼此与四色都错开 15°）。 */
const HEX = [
  { name: 'C', title: '青', rgb: [0, 174, 239], angle: 15 },
  { name: 'M', title: '品红', rgb: [236, 0, 140], angle: 75 },
  { name: 'Y', title: '黄', rgb: [255, 241, 0], angle: 0 },
  { name: 'K', title: '黑', rgb: [12, 13, 14], angle: 45 },
  { name: 'O', title: '橙', rgb: [255, 108, 0], angle: 30 },
  { name: 'G', title: '绿', rgb: [0, 166, 81], angle: 60 },
];
const inkSum = (pl, inks) => {
  let s = 0;
  for (const k of inks) { const a = pl[k.name]; let t = 0; for (let j = 0; j < a.length; j++) t += a[j]; s += t / a.length; }
  return s;
};

T('separateN：纯函数、值域 [0,1]、版名齐全、六版能解、白源全 0', () => {
  const a = P.separateN(P.CLASSIC, SRC, SW, SH, COLS, ROWS, {});
  const b = P.separateN(P.CLASSIC, SRC, SW, SH, COLS, ROWS, {});
  for (const k of P.CLASSIC) {
    const x = a[k.name];
    assert.ok(x, '缺 ' + k.name + ' 版');
    assert.equal(x.length, COLS * ROWS, k.name + ' 版长度应等于格数');
    let mn = 1, mx = 0;
    for (let j = 0; j < x.length; j++) { if (x[j] < mn) mn = x[j]; if (x[j] > mx) mx = x[j]; }
    assert.ok(mn >= 0 && mn <= 1, k.name + ' 版下界必须 ≥ 0（实测 ' + mn + '）');
    assert.ok(mx <= 1 && mx > 0.05, k.name + ' 版上界必须 ≤ 1 且该版有墨（实测 ' + mx.toFixed(3) + '）');
    assert.equal(Array.from(x).join(','), Array.from(b[k.name]).join(','), 'separateN 必须是纯函数（' + k.name + '）');
  }
  /* 六版：能解、版名一个不少、两版"额外色"确实拿到了墨 */
  const six = P.separateN(HEX, SRC, SW, SH, COLS, ROWS, {});
  assert.equal(Object.keys(six).length, 6, '六版应返回 6 个数组（实测 ' + Object.keys(six).join(',') + '）');
  assert.ok(inkSum(six, HEX) > inkSum(a, P.CLASSIC) * 0.8, '六版的墨量不该比四版少太多（多出的两版是加项）');
  /* 白源：任何墨组都不该落墨 */
  const white = new Uint8ClampedArray(16 * 16 * 4).fill(255);
  const pw = P.separateN(HEX, white, 16, 16, 4, 4, {});
  for (const k of HEX) assert.ok(Math.max(...pw[k.name]) < 1e-6, '白源时 ' + k.name + ' 必须为 0');
  /* 黑源：四版全满（黑是所有墨叠出来的极限） */
  const blk = new Uint8ClampedArray(16 * 16 * 4);
  for (let i = 0; i < 256; i++) blk[i * 4 + 3] = 255;
  const pb = P.separateN(P.CLASSIC, blk, 16, 16, 4, 4, {});
  for (const k of P.CLASSIC) assert.ok(pb[k.name][0] > 0.9, '黑源时 ' + k.name + ' 应接近满墨（实测 ' + pb[k.name][0].toFixed(3) + '）');
});

T('separateN 的反射率下限：sRGB 满版色的 0 通道必须被抬到物理值，否则解会退化成"不上墨"', () => {
  /* 青 #00AEEF 的红通道是 0、橙 #FF6C00 的蓝通道是 0。直接取 log 得到 −∞ 级负数，
     于是"任何一点青都会杀掉整个红通道"，NNLS 的最优解就是几乎不上墨。*/
  const lo = P.separateN(P.CLASSIC, SRC, SW, SH, COLS, ROWS, { inkFloor: 1e-4 });
  const ok = P.separateN(P.CLASSIC, SRC, SW, SH, COLS, ROWS, {});
  const loInk = inkSum(lo, P.CLASSIC), okInk = inkSum(ok, P.CLASSIC);
  assert.ok(okInk > loInk * 1.5, '下限 .03 的墨量应显著多于 1e-4（实测 ' + okInk.toFixed(3) + ' vs ' + loInk.toFixed(3) + '）');
  const avg = P.cellAverages(SRC, SW, SH, COLS, ROWS);
  const eLo = P.reconstructError(P.CLASSIC, lo, avg, COLS, ROWS, paper);
  const eOk = P.reconstructError(P.CLASSIC, ok, avg, COLS, ROWS, paper);
  assert.ok(eOk.mean < eLo.mean * 0.6, '下限 .03 的还原误差应显著更小（实测 ' + eOk.mean.toFixed(2) + ' vs ' + eLo.mean.toFixed(2) + '）');
  /* 默认值就是 .03，且两边口径必须一致 */
  assert.ok(Math.abs(P.reconstructError(P.CLASSIC, ok, avg, COLS, ROWS, paper, { inkFloor: 0.03 }).mean - eOk.mean) < 1e-9,
     'reconstructError 的默认下限必须与 separateN 一致（两边口径不同会把误差报成 190+）');
  /* 下限抬得过高会反过来伤误差：墨量被系统性地抬亮，暗部还原不出来。实测 .15 明显变差。
     这条守的是"下限是物理量，不是随便调的旋钮" —— 它有个两头都疼的区间。 */
  const hi = P.separateN(P.CLASSIC, SRC, SW, SH, COLS, ROWS, { inkFloor: 0.15 });
  const eHi = P.reconstructError(P.CLASSIC, hi, avg, COLS, ROWS, paper, { inkFloor: 0.15 });
  assert.ok(eHi.mean > eOk.mean, '下限 .15 时误差应比 .03 大（实测 ' + eHi.mean.toFixed(2) + ' vs ' + eOk.mean.toFixed(2) + '）');
  /* 三档单调：1e-4 太松(不上墨) → .03 合适 → .15 太紧(墨偏亮)，误差是个 U 形 */
  assert.ok(eOk.mean < eLo.mean, '下限 .03 的误差应小于 1e-4');
  assert.ok(eOk.mean < eHi.mean, '下限 .03 的误差应小于 .15');
  /* inkFloor 只改分色矩阵，不该让解跑出 [0,1] */
  for (const k of P.CLASSIC) {
    let mn = 1, mx = 0;
    for (const v of hi[k.name]) { if (v < mn) mn = v; if (v > mx) mx = v; }
    assert.ok(mn >= 0 && mx <= 1, '下限 .15 时 ' + k.name + ' 仍须落在 [0,1]（实测 ' + mn + '..' + mx + '）');
  }
});

T('还原误差：NNLS 显著优于四色公式；六版的 free 模式必须优于四版；把版解错必须当场涨上去', () => {
  const avg = P.cellAverages(SRC, SW, SH, COLS, ROWS);
  assert.equal(avg.length, COLS * ROWS * 3, 'cellAverages 应给 3 通道 × 格数');
  const p4f = P.separate(SRC, SW, SH, COLS, ROWS, { ucr: 0.55 });
  const p4n = P.separateN(P.CLASSIC, SRC, SW, SH, COLS, ROWS, {});
  /* ⚠ 只跑默认的 base 会把这条测试写成假绿：base 是**受约束**的两层解，误差本来就比四版大
     （实测 24.123 vs 21.280），拿它去证"六版更准"是错的。判据必须跑 free ——
     "六版的解空间包含四版"这句话只对 free 成立（base 把 O/G 摁在残差上，那个解不在四版的
     解空间里，也不在 free 的最优解上）。 */
  const p6f = P.separateN(HEX, SRC, SW, SH, COLS, ROWS, { mode: "free" });
  const p6b = P.separateN(HEX, SRC, SW, SH, COLS, ROWS, {});
  const e4f = P.reconstructError(P.CLASSIC, p4f, avg, COLS, ROWS, paper);
  const e4n = P.reconstructError(P.CLASSIC, p4n, avg, COLS, ROWS, paper);
  const e6f = P.reconstructError(HEX, p6f, avg, COLS, ROWS, paper);
  const e6b = P.reconstructError(HEX, p6b, avg, COLS, ROWS, paper);
  for (const [tag, e] of [["4f", e4f], ["4n", e4n], ["6f", e6f], ["6b", e6b]]) {
    assert.ok(e.mean >= 0 && e.mean < 255, tag + ' 的 mean 应在 0..255（实测 ' + e.mean + '）');
    assert.ok(e.p95 >= e.mean, tag + ' 的 p95 不该小于 mean');
    assert.ok(e.max >= e.p95, tag + ' 的 max 不该小于 p95');
    assert.equal(e.nan, 0, tag + ' 不该出 NaN');
  }
  /* 四色公式带 UCR，是"印厂能理解的解"；NNLS 是"数学上的最优解"。NNLS 必须更准。 */
  assert.ok(e4n.mean < e4f.mean * 0.5, 'NNLS 四版误差应远小于公式分色（实测 ' + e4n.mean.toFixed(2) + ' vs ' + e4f.mean.toFixed(2) + '）');
  /* 六版的解空间包含四版（O/G 取 0 就是四版解），所以不会更差 —— 这条是求解器正确性的硬判据 */
  assert.ok(e6f.mean <= e4n.mean + 1e-6, 'free 模式下六版的解空间包含四版，误差不该更差（实测 ' + e6f.mean.toFixed(3) + ' vs ' + e4n.mean.toFixed(3) + '）');
  /* base 是**故意**的次优解：用误差换"看起来像印出来的"。判据不是"它更准"，而是
     ① 它不可能比 free 准（受约束的解空间更小）；② 它真的把 O/G 摁住了。
     两条都要测 —— 否则哪天 base 悄悄退化成 free，画面会变回彩色纸屑而没人发觉。 */
  assert.ok(e6b.mean >= e6f.mean - 1e-9, 'base 是受约束解，误差不该比 free 小（实测 ' + e6b.mean.toFixed(3) + ' vs ' + e6f.mean.toFixed(3) + '）');
  const ogInk = pl => (pl.O.reduce((a, v) => a + v, 0) + pl.G.reduce((a, v) => a + v, 0)) / pl.O.length;
  const ogF = ogInk(p6f), ogB = ogInk(p6b);
  assert.ok(ogB < ogF * 0.5, 'base 应把橙绿摁在残差上（实测平均墨量 ' + ogB.toFixed(3) + ' vs free ' + ogF.toFixed(3) + '）');
  /* 把 C 和 M 两版对调：误差必须暴涨，否则这个判据根本测不出"版错了" */
  const swapped = { C: p4n.M, M: p4n.C, Y: p4n.Y, K: p4n.K };
  const eSwap = P.reconstructError(P.CLASSIC, swapped, avg, COLS, ROWS, paper);
  assert.ok(eSwap.mean > e4n.mean * 3, 'C/M 对调后误差必须显著变大（实测 ' + eSwap.mean.toFixed(2) + ' vs ' + e4n.mean.toFixed(2) + '）');
  /* 缺版不许崩：plates 里没有该版时按 0 算 */
  const partial = { C: p4n.C, M: p4n.M, Y: p4n.Y };
  const eP = P.reconstructError(P.CLASSIC, partial, avg, COLS, ROWS, paper);
  assert.ok(Number.isFinite(eP.mean) && eP.nan === 0, '缺 K 版时应按 0 算，不该出 NaN（实测 ' + eP.mean + '）');
});

T('六版真的带来更多颜色：格点集从 15 色涨到 35+，且实到色数跟着涨', () => {
  const pal4 = P.paletteOf(P.CLASSIC, paper);
  const pal6 = P.paletteOf(HEX, paper);
  assert.equal(pal4.length, 16 * 3, '四版 2^4 项');
  assert.equal(pal6.length, 64 * 3, '六版 2^6 项');
  assert.equal(P.distinctColors(pal4), 15, '四版实到 15 色');
  const d6 = P.distinctColors(pal6);
  assert.ok(d6 >= 30, '六版实到色数应 ≥ 30（实测 ' + d6 + '）');
  /* 画出来比一比：同一个源，四版 vs 六版 */
  /* 画布必须是 DW×DH（scale × CSS）：假画布的像素缓冲不会跟着 width 属性长，
     给小了 putImageData 会当场 RangeError —— 这条与 press() 夹具同口径 */
  const a = P.create({ canvas: mkCanvas(CW * S, CH * S), cssW: CW, cssH: CH, scale: S, cols: COLS, rows: ROWS,
    cell: CELL, maxFrac: MAXFRAC, areaMap: true, floor: 0.02, tacLimit: 6, inks: P.CLASSIC,
    plates: P.separateN(P.CLASSIC, SRC, SW, SH, COLS, ROWS, {}), drift: null });
  const b = P.create({ canvas: mkCanvas(CW * S, CH * S), cssW: CW, cssH: CH, scale: S, cols: COLS, rows: ROWS,
    cell: CELL, maxFrac: MAXFRAC, areaMap: true, floor: 0.02, tacLimit: 6, inks: HEX,
    plates: P.separateN(HEX, SRC, SW, SH, COLS, ROWS, {}), drift: null });
  a.draw(0.5); b.draw(0.5);
  const ma = a.measure(), mb = b.measure();
  assert.ok(mb.colors >= ma.colors, '六版画面上的色数应 ≥ 四版（实测 ' + mb.colors + ' vs ' + ma.colors + '）');
  assert.ok(mb.paletteColors >= 30, '六版 paletteColors 应 ≥ 30（实测 ' + mb.paletteColors + '）');
  assert.ok(mb.colors > ma.colors || mb.paletteColors > ma.paletteColors + 15, '六版必须在色数或格点集上明显占优');
});
/* ════════════════ 8.5 覆盖域分色（coverageCurve / separateCov） ════════════════ */
/* 为什么要有这一套：press 的合成是**覆盖率**相乘（每版盖住一格的多大面积），而 separate/separateN
   都是密度域的。密度域解出来的墨量代回覆盖率引擎，暗部会整体发白（实测均色 60 的灰印成 164）。
   separateCov 把正模型写在覆盖率域，再用实测的「墨量 ↔ 覆盖率」曲线换算回去。
   曲线本身是**量出来的**，不是解析式 —— 引擎是逐像素栅格化 + 抗锯齿，解析式差 10%~14%。 */
const MF_FULL = 1 / Math.SQRT2;
/* 曲线在 w 超过这个值后平顶：从饱和点往下取一整档 */
function covSteps(cv, satW) { return Math.max(2, Math.floor(satW * cv.steps) - 1); }
const curveCanvas = () => mkCanvas(Math.round(24 * 8 * S), Math.round(24 * 8 * S));
function fullCurve(o) {
  return P.coverageCurve(Object.assign({
    canvas: curveCanvas(), paper: paper, maxFrac: MF_FULL, areaMap: true,
    cell: 8, scale: S, steps: 24, grid: 24,
  }, o || {}));
}

T('coverageCurve：单调、端点严格、w(cov(w)) 可逆、满墨覆盖率随 maxFrac 增大', () => {
  const cv = fullCurve();
  assert.equal(cv.table.length, cv.steps + 1, 'table 应有 steps+1 个采样点');
  assert.ok(Math.abs(cv.cov(0)) < 1e-9, 'w=0 必须精确是 0 覆盖率（实测 ' + cv.cov(0) + '）');
  assert.ok(Math.abs(cv.cov(1) - cv.maxCov) < 1e-9, 'w=1 必须精确是 maxCov');
  let prev = -1;
  for (let i = 0; i <= cv.steps; i++) {
    const c = cv.cov(i / cv.steps);
    assert.ok(c >= prev - 1e-12, '覆盖率必须随墨量单调不减（第 ' + i + ' 档 ' + c + ' < ' + prev + '）');
    prev = c;
  }
  /* 可逆性分两个方向，两个方向**不一样**，这是几何决定的：
     ① cov → w → cov 必须精确（反查再正查回来）—— 这是 separateCov 的硬要求：
        它解出覆盖率 c，要换回墨量 w 去印，印出来的覆盖率必须还是 c。
     ② w → cov → w 只在**未饱和区**成立。曲线在 w 超过某个点后平顶（π/4 的四个角永远露纸，
        或 1/√2 时圆盘并集已盖满方格），那一段多解：很多个 w 印出来都是同一个 97.5%。
        所以只在线性段里验，并用**未饱和上限**把它划出来。 */
  let worstC = 0;
  for (let i = 0; i <= cv.steps; i++) {
    const c = cv.cov(i / cv.steps), back = cv.cov(cv.w(c));
    worstC = Math.max(worstC, Math.abs(back - c));
  }
  assert.ok(worstC < 1e-9, 'cov → w → cov 必须精确（实测 ' + worstC.toExponential(2) + '）');
  /* 可逆区间 = 曲线严格上升的那一段。判据是**相邻采样点的覆盖率增量**够大（> 1e-3），
     不是"没到 maxCov"：抗锯齿会让曲线在接近平顶时每档只涨 1e-4，那已经是多解区了。 */
  let lastStrict = cv.steps;
  for (let i = 1; i <= cv.steps; i++) {
    if (cv.cov(i / cv.steps) - cv.cov((i - 1) / cv.steps) < 1e-3) { lastStrict = i - 1; break; }
  }
  assert.ok(lastStrict >= 2, '曲线至少前两档必须严格上升（实测最后一档 ' + lastStrict + '/' + cv.steps + '）');
  assert.ok(lastStrict < cv.steps, '曲线必须在某个 w < 1 处开始饱和（实测 ' + (lastStrict / cv.steps).toFixed(3) + '）');
  let worstW = 0;
  for (let i = 1; i <= lastStrict; i++) {
    const w = i / cv.steps, back = cv.w(cv.cov(w));
    worstW = Math.max(worstW, Math.abs(back - w));
  }
  assert.ok(worstW < 1e-9, '可逆区间里 w → cov → w 必须精确（实测 ' + worstW.toExponential(2) + '）');
  /* 几何：maxFrac 1/√2 时圆盘并集刚好盖满方格 → 接近 1；maxFrac 0.5 时点与点相切 → π/4=0.785 */
  assert.ok(cv.maxCov > 0.9, 'maxFrac 1/√2 时满墨覆盖率应 > 90%（实测 ' + (cv.maxCov * 100).toFixed(1) + '%）');
  const half = fullCurve({ maxFrac: 0.5 });
  assert.ok(half.maxCov > 0.7 && half.maxCov < 0.85,
    'maxFrac 0.5（相切）时满墨覆盖率应在 0.7~0.85，即 π/4 附近（实测 ' + (half.maxCov * 100).toFixed(1) + '%）');
  assert.ok(half.maxCov < cv.maxCov, '相切的覆盖率必须小于盖满方格那一档');
});

T('separateCov：纯函数、值域、白源全 0、六版都真出墨（base 不许把橙绿摁成 0）', () => {
  const cv = fullCurve();
  const opt = { paper: paper, curve: cv, sweeps: 12 };
  const a = P.separateCov(HEX, SRC, SW, SH, COLS, ROWS, opt);
  const b = P.separateCov(HEX, SRC, SW, SH, COLS, ROWS, opt);
  for (const k of HEX) {
    const x = a[k.name];
    assert.ok(x, '缺 ' + k.name + ' 版');
    assert.equal(x.length, COLS * ROWS, k.name + ' 长度应等于格数');
    let mn = 1, mx = 0;
    for (let j = 0; j < x.length; j++) { if (x[j] < mn) mn = x[j]; if (x[j] > mx) mx = x[j]; }
    assert.ok(mn >= 0 && mn <= 1e-9, k.name + ' 下界必须 ≥ 0（实测 ' + mn + '）');
    assert.ok(mx <= 1 && mx > 0.05, k.name + ' 上界必须 ≤ 1 且该版有墨（实测 ' + mx.toFixed(3) + '）');
    assert.equal(Array.from(x).join(','), Array.from(b[k.name]).join(','), 'separateCov 必须是纯函数（' + k.name + '）');
  }
  const white = new Uint8ClampedArray(16 * 16 * 4).fill(255);
  const pw = P.separateCov(HEX, white, 16, 16, 4, 4, { paper: paper, curve: cv, sweeps: 8 });
  for (const k of HEX) assert.ok(Math.max(...pw[k.name]) < 1e-6, '白源时 ' + k.name + ' 必须为 0');
  /* ⚠ 这条守的是 base 模式的一个真 bug：残差目标是 tgt/prod，当某通道已被 CMYK 压到 0 时
     tgt=0、prod≈0，除出来是 0 —— 「这个通道不许再暗」→ 橙绿一版都上不去，六版退化成四色
     （实测 rose+base 时 O/G 覆盖率恒为 0.0%）。判据必须是「CMYK 压过头了没有」。 */
  const pb = P.separateCov(HEX, SRC, SW, SH, COLS, ROWS, Object.assign({ mode: 'base' }, opt));
  for (const k of ['O', 'G']) {
    const m = Math.max(...pb[k]);
    assert.ok(m > 0.05, 'base 模式下 ' + k + ' 也必须真出墨（实测 max ' + m.toFixed(3) + '）');
  }
});

T('separateCov 的调子保真：逐格平均色代进正模型比源图，覆盖域分色必须显著优于密度域', () => {
  /* 为什么不用假画布直接量像素：假画布只实现了 press 用到的 createImageData / putImageData /
     getImageData 三条，press 不会把像素**读回来**，所以这里拿不到渲染结果。
     替代口径：把解出来的 plates 代进同一条正模型（R = Π(1 − c·d)，与 separateCov 内部一致），
     与「源格平均 / 纸」逐格比。与真渲染的差别只有抗锯齿那一点点，
     足以分辨"密度域公式分色"和"覆盖域分色"的差距 —— 实测 52 对 24。 */
  const cv = fullCurve();
  const P4 = P.CLASSIC.map(i => ({ name: i.name, title: i.title, rgb: i.rgb, angle: i.angle }));
  const pf = P.separate(SRC, SW, SH, COLS, ROWS, { ucr: 0.55 });
  const pc = P.separateCov(P4, SRC, SW, SH, COLS, ROWS, { paper: paper, curve: cv, sweeps: 16 });
  const avgS = P.cellAverages(SRC, SW, SH, COLS, ROWS);
  /* ⚠ 换算要过曲线：separateCov 返回的是**墨量** w，正模型要的是**覆盖率** c = curve.cov(w)。
     直接把 w 当 c 代进去，误差从 2.6 变成 72.8 —— 这条测试第一次写就是这样，红的不是因为
     分色差，是因为测试自己少乘了一步。 */
  function modelErr(pl, inks) {
    const d = inks.map(k => [0, 1, 2].map(c => 1 - Math.min(1, Math.max(0, k.rgb[c] / paper[c]))));
    let sum = 0, worst = 0;
    for (let j = 0; j < COLS * ROWS; j++) {
      let e = 0;
      for (let c = 0; c < 3; c++) {
        let m = 1;
        for (let i = 0; i < inks.length; i++) m *= 1 - cv.cov(pl[inks[i].name][j]) * d[i][c];
        const got = m * paper[c], want = avgS[j * 3 + c] * 255;
        e += (got - want) * (got - want);
      }
      e = Math.sqrt(e); sum += e; if (e > worst) worst = e;
    }
    return { mean: sum / (COLS * ROWS), worst: worst };
  }
  const ef = modelErr(pf, P4), ec = modelErr(pc, P4);
  assert.ok(ec.mean < 6, '覆盖域分色的逐格平均调子误差应在个位数（实测 ' + ec.mean.toFixed(1) + '）');
  /* 反向对照：把 w 直接当覆盖率代进模型（少乘一步曲线），误差必须掉回密度域那一档。
     这条盯的是"曲线到底有没有在起作用" —— 没有它，上面那条只要分色解出个大致均匀的
     plates 也可能过。 */
  function modelErrNoCurve(pl, inks) {
    const d = inks.map(k => [0, 1, 2].map(c => 1 - Math.min(1, Math.max(0, k.rgb[c] / paper[c]))));
    let sum = 0;
    for (let j = 0; j < COLS * ROWS; j++) {
      let e = 0;
      for (let c = 0; c < 3; c++) {
        let m = 1;
        for (let i = 0; i < inks.length; i++) m *= 1 - pl[inks[i].name][j] * d[i][c];
        const got = m * paper[c], want = avgS[j * 3 + c] * 255;
        e += (got - want) * (got - want);
      }
      sum += Math.sqrt(e);
    }
    return sum / (COLS * ROWS);
  }
  const eNoCurve = modelErrNoCurve(pc, P4);
  assert.ok(eNoCurve > ec.mean * 4,
    '把墨量当覆盖率代进模型（少乘一步曲线）误差必须显著变差（实测 ' + eNoCurve.toFixed(1) + ' vs ' + ec.mean.toFixed(1) + '）');
  assert.ok(ec.mean < ef.mean, '覆盖域必须优于密度域公式分色');
  assert.ok(ec.mean < ef.mean * 0.75,
    '覆盖域分色的逐格调子误差应显著小于公式分色（实测 ' + ec.mean.toFixed(1) + ' vs ' + ef.mean.toFixed(1) + '）');
  assert.ok(ec.worst < ef.worst, '最差格也要更好（实测 ' + ec.worst.toFixed(0) + ' vs ' + ef.worst.toFixed(0) + '）');
});

/* ════════════════ 9. 文件与装载顺序 ════════════════ */
T('文件在：press.js / press.html（docs/05 存在才查）；引用 press.js 的页面必须排在 dotink.js 之后', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'press.js')), '缺 press.js');
  assert.ok(fs.existsSync(path.join(ROOT, 'press.html')), '缺 press.html');
  /* docs/05-misregistration.md 由另一位队友同时写：**存在就查，不存在不算红**
     （它没落地时 press.html 的 href 会由 tools/check-links.mjs 报出来，那条门禁更合适） */
  const doc05 = path.join(ROOT, 'docs', '05-misregistration.md');
  if (fs.existsSync(doc05)) assert.ok(fs.statSync(doc05).size > 200, 'docs/05-misregistration.md 存在但内容过短');
  /* 页面装载顺序：press.js 是**可选件**，必须在 dotink.js 之后（它挂 DotInk.press） */
  const pages = [];
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '_release' || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.html')) pages.push(p);
    }
  };
  walk(ROOT);
  let withPress = 0;
  const names = [];
  for (const p of pages) {
    const srcs = Array.from(fs.readFileSync(p, 'utf8').matchAll(/<script[^>]*src="([^"]+)"/g)).map(m => m[1]);
    const pi = srcs.findIndex(s => /(^|\/)press\.js$/.test(s));
    if (pi < 0) continue;
    withPress++;
    names.push(path.relative(ROOT, p));
    const di = srcs.findIndex(s => /(^|\/)dotink\.js$/.test(s));
    assert.ok(di >= 0, path.relative(ROOT, p) + ' 装了 press.js 却没装 dotink.js');
    assert.ok(pi > di, path.relative(ROOT, p) + ' 里 press.js 必须在 dotink.js 之后（它是可选件，挂 DotInk.press）');
    /* press 依赖 render（几何与圆盘栅格化都在那儿） */
    const ri = srcs.findIndex(s => /(^|\/)render\.js$/.test(s));
    assert.ok(ri >= 0 && ri < pi, path.relative(ROOT, p) + ' 里 render.js 必须在 press.js 之前');
  }
  assert.ok(withPress >= 2, '应至少扫到 2 个装了 press.js 的页面（实测 ' + withPress + '：' + names.join(', ') + '）');
  assert.ok(names.indexOf('press.html') >= 0, 'press.html 必须被扫到');
  /* 渲染路径不许有随机 / 时钟：那会毁掉"逐帧复现" */
  const src = fs.readFileSync(path.join(ROOT, 'press.js'), 'utf8');
  assert.ok(!/Math\s*\.\s*random\s*\(/.test(src), 'press.js 不许调 Math.random');
  assert.ok(!/Date\s*\.\s*now\s*\(/.test(src), 'press.js 不许调 Date.now');
  assert.ok(!/new\s+Date\s*\(/.test(src), 'press.js 不许读系统时间');
  /* 关键 API 都在（页面靠这些名字） */
  for (const k of ['create', 'paletteOf', 'separate', 'regOf', 'distinctColors', 'collisionsOf', 'DEFAULTS', 'CLASSIC']) {
    assert.ok(k in P, 'press 应导出 ' + k);
  }
  assert.equal(P.CLASSIC.length, 4, 'CLASSIC 应是四色');
  assert.equal(Array.from(P.CLASSIC, p => p.name).join(','), 'C,M,Y,K');
  assert.equal(Array.from(P.CLASSIC, p => p.rgb[0]).join(','), '0,236,255,12', 'CLASSIC 的 sRGB 红通道应与文档一致');
  assert.equal(Array.from(P.CLASSIC, p => p.angle).join(','), '15,75,0,45', 'CLASSIC 的网角应是标准玫瑰斑组');
  /* 缺 render 时必须给人话，而不是 TypeError */
  const noRender = vm.createContext({ console: console });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'press.js'), 'utf8'), noRender, { filename: 'press.js' });
  assert.throws(() => noRender.DotInk.press.create({ canvas: mkCanvas(8, 8) }), { name: 'Error' }, '缺 render.js 时应抛错');
  let m2 = '';
  try { noRender.DotInk.press.create({ canvas: mkCanvas(8, 8) }); } catch (e) { m2 = String(e.message); }
  assert.match(m2, /render.js/, '报错里应点出缺 render.js');
  assert.match(m2, /装载顺序|顺序/, '报错里应提示装载顺序');
});

/* ════════════════ 收尾：汇总断言数 ════════════════ */
test('汇总：每条测试的断言数（防"只跑不断"的空测试）', (t) => {
  let total = 0;
  for (const s of STATS) {
    total += s.n;
    t.diagnostic(s.name + ' → ' + s.n + ' 条');
    assert.ok(s.n >= 5, '测试「' + s.name + '」只有 ' + s.n + ' 条断言（少于 5 条基本等于没测）');
  }
  t.diagnostic('合计 ' + total + ' 条断言 / ' + STATS.length + ' 条测试');
  assert.ok(STATS.length >= 10, '至少 10 条测试（实测 ' + STATS.length + '）');
  assert.ok(total >= 120, '全场至少 120 条断言（实测 ' + total + '）');
});
