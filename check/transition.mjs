/* 零依赖测试：场转场（transition.js）
 * 跑法：node --test check/transition.mjs      （与 core.mjs 一起：node --test check/core.mjs check/transition.mjs）
 * 覆盖：端点严格 · 值域 · 确定性/种子 · 随机 seek 与倒放 · 单调 · 不改源场 · 参数校验 · 编码配对 · 整条管线（假画布）
 *       + 第二批：tone（墨量次序 / 编码换算 / 墨量处处相同）· mask（距离次序 / EDT / 空遮罩 / 全遮罩）· 节奏（不集中突变、不长停）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function load(...files) {
  const ctx = vm.createContext({ console });
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  return ctx;
}
const D = load('fields.js', 'render.js', 'judge.js', 'host.js', 'dotink.js', 'transition.js').DotInk;
const T = D.transition;

const COLS = 23, ROWS = 13, N = COLS * ROWS;
/* 两张值域不同、处处不等的场：A ∈ [0.1, 0.4]、B ∈ [0.6, 0.95] —— 哪格取了谁一眼可辨 */
const A = new Float32Array(N), B = new Float32Array(N);
for (let i = 0; i < N; i++) { A[i] = 0.1 + 0.3 * ((i * 7919) % 101) / 100; B[i] = 0.6 + 0.35 * ((i * 104729) % 97) / 96; }
const sha = a => crypto.createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex');
const SHA_A = sha(A), SHA_B = sha(B);
/* 遮罩夹具：数组 = 一个"工"字形（两横一竖，覆盖率 0/1）；函数 = fields.sdf 口径的圆（内负外正，格为单位） */
const MASK_ARR = new Float32Array(N);
for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
  const bar = (y === 3 || y === 9) && x >= 6 && x <= 16, stem = x >= 10 && x <= 12 && y >= 3 && y <= 9;
  MASK_ARR[y * COLS + x] = bar || stem ? 1 : 0;
}
const MASK_FN = (x, y) => Math.hypot(x - COLS * 0.45, y - ROWS * 0.5) - 3.2;

const VARIANTS = [];
for (const blend of ['select', 'mix']) for (const edge of [0, 0.12, 0.5]) {
  VARIANTS.push({ mode: 'wipe', angle: 0, blend, edge });
  VARIANTS.push({ mode: 'wipe', angle: 135, blend, edge });
  VARIANTS.push({ mode: 'radial', cx: 0.3, cy: 0.6, blend, edge });
  VARIANTS.push({ mode: 'radial', invert: true, blend, edge });
  VARIANTS.push({ mode: 'dissolve', seed: 7, blend, edge });
  VARIANTS.push({ mode: 'dissolve', seed: 7, grain: 3, blend, edge });
  VARIANTS.push({ mode: 'tone', blend, edge });
  VARIANTS.push({ mode: 'tone', by: 'from', invert: true, blend, edge });
  VARIANTS.push({ mode: 'mask', mask: MASK_ARR, blend, edge });
  VARIANTS.push({ mode: 'mask', mask: MASK_FN, invert: true, blend, edge });
}
const mk = (v, extra) => T.create(Object.assign({ cols: COLS, rows: ROWS, from: A, to: B }, v, extra));
const name = v => JSON.stringify(v, (k, x) => (ArrayBuffer.isView(x) ? '[mask array]' : typeof x === 'function' ? '[mask fn]' : x));
const PS = [];
for (let k = 0; k <= 200; k++) PS.push(k / 200);

test('端点严格：p≤0 逐格就是 A，p≥1 逐格就是 B（含越界与 NaN）', () => {
  for (const v of VARIANTS) {
    const tr = mk(v);
    assert.equal(sha(tr.at(0)), SHA_A, name(v) + ' at(0) 必须逐字节等于 A');
    assert.equal(sha(tr.at(1)), SHA_B, name(v) + ' at(1) 必须逐字节等于 B');
    assert.equal(sha(tr.at(-0.5)), SHA_A, name(v) + ' p<0 夹到 A');
    assert.equal(sha(tr.at(7)), SHA_B, name(v) + ' p>1 夹到 B');
    assert.equal(sha(tr.at(NaN)), SHA_A, name(v) + ' NaN 当 A');
    assert.equal(tr.countB(0), 0); assert.equal(tr.countB(1), N);
  }
});

test('值域：每格永远落在 [min(A,B), max(A,B)]；select 下每格恰好等于 A[i] 或 B[i]', () => {
  for (const v of VARIANTS) {
    const tr = mk(v);
    for (const p of PS) {
      const f = tr.at(p);
      for (let i = 0; i < N; i++) {
        const lo = Math.min(A[i], B[i]), hi = Math.max(A[i], B[i]);
        assert.ok(f[i] >= lo - 1e-7 && f[i] <= hi + 1e-7, name(v) + ' p=' + p + ' i=' + i + ' 越出 A/B 区间');
        if (v.blend === 'select' || v.edge === 0) assert.ok(f[i] === A[i] || f[i] === B[i], name(v) + ' p=' + p + ' select 不应引入新调子');
      }
    }
  }
});

test('确定性：同参数两个独立实例同 p 逐格相同；种子换了溶解次序就换', () => {
  for (const v of VARIANTS) {
    const a = mk(v), b = mk(v);
    for (const p of [0.13, 0.5, 0.77, 0.999]) assert.equal(sha(a.at(p)), sha(b.at(p)), name(v) + ' 两实例必须相同');
  }
  const s1 = mk({ mode: 'dissolve', seed: 1 }), s2 = mk({ mode: 'dissolve', seed: 2 }), s1b = mk({ mode: 'dissolve', seed: 1 });
  assert.notEqual(sha(s1.at(0.5)), sha(s2.at(0.5)), '不同种子应给出不同的溶解次序');
  assert.equal(sha(s1.at(0.5)), sha(s1b.at(0.5)), '同种子必须同序');
  /* 重新加载一遍脚本（新 realm）仍同序：没有藏在模块级的状态 */
  const D2 = load('transition.js').DotInk;
  const s1c = D2.transition.create({ cols: COLS, rows: ROWS, from: A, to: B, mode: 'dissolve', seed: 1 });
  assert.equal(sha(s1c.at(0.5)), sha(s1.at(0.5)), '跨 realm 同参数必须同序');
});

test('随机 seek / 倒放：输出只取决于 p，与调用历史无关', () => {
  for (const v of VARIANTS) {
    const ref = mk(v), tr = mk(v);
    const want = new Map(PS.map(p => [p, sha(ref.at(p))]));
    /* 乱序 seek（固定伪随机序列，可复现） */
    let s = 12345;
    for (let k = 0; k < 120; k++) {
      s = (Math.imul(s, 1103515245) + 12345) >>> 0;
      const p = PS[s % PS.length];
      assert.equal(sha(tr.at(p)), want.get(p), name(v) + ' 乱序 seek p=' + p);
    }
    /* 正放到底再倒放回 0：回到 A 逐字节相同 */
    for (const p of PS) tr.at(p);
    for (let k = PS.length - 1; k >= 0; k--) assert.equal(sha(tr.at(PS[k])), want.get(PS[k]), name(v) + ' 倒放 p=' + PS[k]);
    assert.equal(sha(tr.at(0)), SHA_A, name(v) + ' 倒放回 0 必须是 A');
  }
});

test('单调与方向：换成 B 的格数随 p 不减；wipe 先近边、radial 先中心、invert 先外圈', () => {
  for (const v of VARIANTS) {
    const tr = mk(v);
    let prev = -1;
    for (const p of PS) { const c = tr.countB(p); assert.ok(c >= prev, name(v) + ' countB 应单调'); prev = c; }
  }
  const first = (tr, p) => { const f = tr.at(p); const out = []; for (let i = 0; i < N; i++) if (f[i] === B[i]) out.push(i); return out; };
  const w = first(mk({ mode: 'wipe', angle: 0, edge: 0 }), 0.2);
  assert.ok(w.length > 0 && w.every(i => (i % COLS) < COLS * 0.3), 'angle 0 应从左边开始');
  const w90 = first(mk({ mode: 'wipe', angle: 90, edge: 0 }), 0.2);
  assert.ok(w90.length > 0 && w90.every(i => ((i / COLS) | 0) < ROWS * 0.3), 'angle 90 应从上边开始（屏幕 y 向下）');
  const r = first(mk({ mode: 'radial', cx: 0.5, cy: 0.5, edge: 0 }), 0.15);
  const ctr = Math.floor(ROWS / 2) * COLS + Math.floor(COLS / 2);
  assert.ok(r.includes(ctr), 'radial 应先换中心格');
  assert.ok(!r.includes(0), 'radial 早期不应碰到角');
  const ri = first(mk({ mode: 'radial', invert: true, edge: 0 }), 0.15);
  assert.ok(ri.includes(0) && !ri.includes(ctr), 'invert 应先换外圈');
});

test('溶解：edge 0 时 B 的占比精确跟着 p 走（块数均分进度）', () => {
  const tr = mk({ mode: 'dissolve', seed: 3, edge: 0 });
  for (const p of PS) assert.ok(Math.abs(tr.countB(p) - p * N) <= 1, 'p=' + p + ' countB=' + tr.countB(p));
  const g = mk({ mode: 'dissolve', seed: 3, edge: 0, grain: 4 });
  const f = g.at(0.5);
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {      /* 同一块里的格同时换 */
    const i = y * COLS + x, j = (y - y % 4) * COLS + (x - x % 4);
    assert.equal(f[i] === B[i], f[j] === B[j], 'grain 4：块内必须一起换（' + x + ',' + y + '）');
  }
});

test('不改源场：反复 at / value / field 之后 A、B 逐字节不变；at() 不返回源数组本身', () => {
  for (const v of VARIANTS) {
    const tr = mk(v), out = new Float32Array(N);
    for (const p of PS) { tr.at(p); tr.at(p, out); }
    const fn = tr.field();
    for (let i = 0; i < N; i++) fn(i, i % COLS, (i / COLS) | 0, 0.5);
    const z = tr.at(0), o = tr.at(1);
    assert.notEqual(z, A, 'at(0) 必须是拷贝'); assert.notEqual(o, B, 'at(1) 必须是拷贝');
    z[0] = 99; o[0] = 99;                                                 /* 改结果不许影响源 */
    assert.equal(sha(A), SHA_A, name(v) + ' A 被改了'); assert.equal(sha(B), SHA_B, name(v) + ' B 被改了');
  }
  const tr = mk({ mode: 'wipe' });
  assert.throws(() => tr.at(0.5, A), { name: 'TypeError' }, 'out 指向源场必须拒绝');
  assert.throws(() => tr.at(0.5, new Float32Array(N - 1)), { name: 'RangeError' });
});

test('out 缓冲区：拒绝与源重叠的视图，允许同 buffer 的不重叠区间', () => {
  const views = [
    ['源对象', src => src],
    ['subarray 同区间', src => src.subarray()],
    ['新视图同区间', src => new Float32Array(src.buffer, src.byteOffset, src.length)],
    ['前部重叠', src => new Float32Array(src.buffer, src.byteOffset - 4, src.length)],
    ['后部重叠', src => new Float32Array(src.buffer, src.byteOffset + 4, src.length)],
    ['不同元素类型重叠', src => new Uint8Array(src.buffer, src.byteOffset + 2, src.length)],
  ];
  const fixture = which => {
    const src = new Float32Array(new ArrayBuffer(64), 16, 4);
    src.set([0.1, 0.2, 0.3, 0.4]);
    const other = new Float32Array([0.6, 0.7, 0.8, 0.9]);
    const tr = T.create({ cols: 2, rows: 2, from: which === 'from' ? src : other, to: which === 'to' ? src : other });
    return { src, other, tr, p: which === 'from' ? 1 : 0 };
  };
  for (const which of ['from', 'to']) {
    for (const [label, view] of views) {
      const { src, other, tr, p } = fixture(which), before = sha(src), otherBefore = sha(other);
      assert.throws(() => tr.at(p, view(src)), { name: 'TypeError' }, which + '：' + label + ' 必须拒绝');
      assert.equal(sha(src), before, which + '：拒绝输出前不许改源');
      assert.equal(sha(other), otherBefore, which + '：另一源也不许改');
    }
    for (const offset of [0, 32]) {                 /* 同 buffer、恰好接在源区间之前 / 之后，不重叠 */
      const { src, other, tr, p } = fixture(which), before = sha(src), otherBefore = sha(other);
      const out = new Float32Array(src.buffer, offset, src.length);
      assert.equal(tr.at(p, out), out, '不重叠输出应复用调用方的视图');
      assert.deepEqual(Array.from(out), Array.from(other), '不重叠输出内容应正确');
      assert.equal(sha(src), before, '同 buffer 的源区间必须保持不变');
      assert.equal(sha(other), otherBefore, '另一源必须保持不变');
    }
  }
});

test('参数校验：同网格、已知模式/编码/blend；参数规整可读回', () => {
  assert.throws(() => T.create({ cols: COLS, rows: ROWS, from: A, to: new Float32Array(N + 1) }), { name: 'RangeError' }, '长度不同必须拒绝（不同网格）');
  assert.throws(() => T.create({ cols: COLS, rows: ROWS, from: A, to: [1, 2, 3] }), { name: 'TypeError' }, '普通数组不收');
  assert.throws(() => T.create({ cols: 2.5, rows: ROWS, from: A, to: B }), { name: 'RangeError' });
  assert.throws(() => mk({ mode: 'morph' }), { name: 'RangeError' }, '不做 morph（那是 markplate 的事）');
  assert.throws(() => mk({ encoding: 'srgb' }), { name: 'RangeError' });
  assert.throws(() => mk({ blend: 'add' }), { name: 'RangeError' });
  const tr = mk({ mode: 'wipe', angle: -90, edge: 3, seed: -1, grain: 999 });
  assert.equal(tr.params.angle, 270); assert.equal(tr.params.edge, 1);
  assert.equal(tr.params.seed, 4294967295); assert.equal(tr.params.grain, 64);
  assert.ok(Object.isFrozen(tr.params) && Object.isFrozen(tr));
  assert.equal(Array.from(T.MODES).join(','), 'wipe,radial,dissolve,tone,mask');   /* 跨 realm：比内容不比原型 */
});

test('编码白名单：拒绝 Object 原型继承键，合法编码仍返回正确映射', () => {
  for (const encoding of ['toString', '__proto__', 'constructor', 'valueOf', 'hasOwnProperty']) {
    assert.throws(() => mk({ encoding }), { name: 'RangeError' }, encoding + ' 不是支持的编码');
  }
  for (const [encoding, areaMap] of [['coverage', true], ['calibrated', false]]) {
    const tr = mk({ encoding });
    assert.equal(tr.encoding, encoding);
    assert.deepEqual({ ...tr.renderHints }, { areaMap, gamma: 1, gain: 1, shutter: 0 });
  }
});

test('编码配对：renderHints 跟编码走，gamma 恒 1、shutter 恒 0（不重复校正）', () => {
  const c = mk({ encoding: 'coverage' }).renderHints, k = mk({ encoding: 'calibrated' }).renderHints;
  assert.deepEqual({ ...c }, { areaMap: true, gamma: 1, gain: 1, shutter: 0 });
  assert.deepEqual({ ...k }, { areaMap: false, gamma: 1, gain: 1, shutter: 0 });
  /* fromImageData 的默认（gamma .45 / gain 1.6）是"已标定"：再配 √ 等于把 gamma 记两次。
     同一张覆盖率，两种合法写法的半径应一致：raw→√ 与 v^0.5→线性。 */
  for (const v of [0.04, 0.25, 0.5, 0.81]) {
    const rRaw = D.radius(v, 12, 0.48, true), rCal = D.radius(Math.pow(v, 0.5), 12, 0.48, false);
    assert.ok(Math.abs(rRaw - rCal) < 1e-9, 'raw+√ 与 标定(γ=.5)+线性 应同半径');
    const rDouble = D.radius(Math.pow(v, 0.5), 12, 0.48, true);
    if (v < 1) assert.ok(rDouble > rRaw + 1e-6, '标定场再开方会偏重（双重校正）');
  }
});

test('缓动端点精确，且只做进度映射', () => {
  for (const k of ['linear', 'inOut']) {
    assert.equal(T.ease[k](0), 0); assert.equal(T.ease[k](1), 1);
    assert.equal(T.ease[k](-3), 0); assert.equal(T.ease[k](4), 1);
    let prev = -1; for (const p of PS) { const e = T.ease[k](p); assert.ok(e >= prev); prev = e; }
  }
});

test('整条管线（假画布）：draw(0)/draw(1) 与直接画 A/B 逐像素相同；活场的 t 原样透传', () => {
  const mkCanvas = (W, H) => {
    const px = new Uint8ClampedArray(W * H * 4);
    const ctx = {
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      putImageData: img => { px.set(img.data); },
      getImageData: () => ({ data: px.slice() }),
    };
    return { width: W, height: H, getContext: () => ctx, pixels: px };
  };
  const base = { cssW: COLS * 8, cssH: ROWS * 8, scale: 1.5, cols: COLS, rows: ROWS, cell: 8 };
  for (const v of VARIANTS.filter(x => x.edge === 0.12)) {
    for (const enc of ['coverage', 'calibrated']) {
      const tr = mk(v, { encoding: enc });
      const shot = (field, t) => {
        const c = mkCanvas(Math.round(base.cssW * 1.5), Math.round(base.cssH * 1.5));
        const inst = D.create(Object.assign({ canvas: c, field }, base, tr.renderHints));
        inst.draw(t);
        return { px: Uint8ClampedArray.from(c.pixels), inst };
      };
      const a = shot(A, 0).px, b = shot(B, 0).px;
      assert.deepEqual(shot(tr.field(), 0).px, a, name(v) + ' ' + enc + ' draw(0) ≠ A');
      assert.deepEqual(shot(tr.field(), 1).px, b, name(v) + ' ' + enc + ' draw(1) ≠ B');
      const mid = shot(tr.field(), 0.5);
      const j = mid.inst.judge(null, { mode: 'M2' });
      assert.equal(j.checks.find(x => x.name === '1-bit 无灰阶').ok, true, '转场中途也必须 1-bit');
      assert.deepEqual(shot(tr.field(), 0.5).px, mid.px, '同 p 两次逐像素一致');
    }
  }
  /* 活场：from 是函数，t 原样透传给源；进度由 pOf(t) 给 */
  const seen = [];
  const fnA = (i, x, y, t) => { if (i === 0) seen.push(t); return 0.3; };
  const tr = T.create({ cols: COLS, rows: ROWS, from: fnA, to: B, mode: 'wipe' });
  const f = tr.field(t => (t - 10) / 2);
  assert.equal(f(0, 0, 0, 10), 0.3, 't=10 → p=0 → A');
  assert.equal(f(0, 0, 0, 12), B[0], 't=12 → p=1 → B');
  assert.deepEqual(seen, [10], '源拿到的是墙钟 t，不是进度');
});

test('文件在：transition.js / transition.html / docs/04-transitions.md；页面装载顺序正确', () => {
  for (const f of ['transition.js', 'transition.html', 'docs/04-transitions.md']) assert.ok(fs.existsSync(path.join(ROOT, f)), '缺 ' + f);
  const html = fs.readFileSync(path.join(ROOT, 'transition.html'), 'utf8');
  const srcs = Array.from(html.matchAll(/<script[^>]*src="([^"]+)"/g)).map(m => m[1]);
  const order = ['fields.js', 'render.js', 'judge.js', 'host.js', 'dotink.js', 'transition.js'];
  let last = -1;
  for (const s of order) { const i = srcs.indexOf(s); assert.ok(i > last, 'transition.html 装载顺序应为 ' + order.join(' → ')); last = i; }
  assert.ok(!/Math\.random\s*\(/.test(fs.readFileSync(path.join(ROOT, 'transition.js'), 'utf8')), 'transition.js 不许用 Math.random');
});

/* ════════════════ 第二批：tone（按墨量显影）· mask（遮罩揭示） ════════════════ */

/* 一张连续调的"真图"（覆盖率，量化到 1/100）；同一张图的 calibrated 版本 = √（γ 0.5 记在场上） */
const PIC = new Float32Array(N), PIC_CAL = new Float32Array(N);
for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
  const v = Math.round(100 * (0.5 + 0.5 * Math.sin(x * 0.45) * Math.cos(y * 0.6)) * (x / (COLS - 1))) / 100;
  PIC[y * COLS + x] = v; PIC_CAL[y * COLS + x] = Math.sqrt(v);
}
/* 二值图（字形一类：墨量只有 0 / 1） */
const BIN = Float32Array.from(MASK_ARR);
const orderOf = tr => tr.orderMap();

test('tone：先暗后亮 = 墨量多的先换（严格按墨量单调）；invert 反过来；by 选依据场', () => {
  const chk = (tr, ink, darkFirst, label) => {
    const m = orderOf(tr);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      if (ink[i] > ink[j] + 1e-9) assert.ok(darkFirst ? m[i] < m[j] : m[i] > m[j], label + ' i=' + i + ' j=' + j);
    }
  };
  chk(mk({ mode: 'tone', edge: 0 }, { to: PIC }), PIC, true, 'by to · 先暗后亮');
  chk(mk({ mode: 'tone', edge: 0, invert: true }, { to: PIC }), PIC, false, 'by to · 先亮后暗');
  chk(mk({ mode: 'tone', edge: 0, by: 'from' }, { from: PIC }), PIC, true, 'by from 依据 A');
  /* 依据 B 时与 A 无关；依据 A 时与 B 无关 */
  assert.deepEqual(Array.from(orderOf(mk({ mode: 'tone' }, { to: PIC }))), Array.from(orderOf(mk({ mode: 'tone' }, { to: PIC, from: B }))));
  assert.deepEqual(Array.from(orderOf(mk({ mode: 'tone', by: 'from' }, { from: PIC }))), Array.from(orderOf(mk({ mode: 'tone', by: 'from' }, { from: PIC, to: A }))));
  assert.throws(() => mk({ mode: 'tone', by: 'both' }), { name: 'RangeError' });
});

test('tone 编码：同一张画的 coverage 版与 calibrated 版次序逐格相同；把 calibrated 当覆盖率（二次 γ）就不同', () => {
  const cov = mk({ mode: 'tone', encoding: 'coverage' }, { to: PIC });
  const cal = mk({ mode: 'tone', encoding: 'calibrated' }, { to: PIC_CAL });
  assert.deepEqual(Array.from(cal.switchMap()), Array.from(cov.switchMap()), '墨量 = 覆盖率，换编码不该改次序与节奏');
  const wrong = mk({ mode: 'tone', encoding: 'coverage' }, { to: PIC_CAL });        /* 二次 γ 的错法 */
  let diff = 0; const a = cov.orderMap(), b = wrong.orderMap();
  for (let i = 0; i < N; i++) diff = Math.max(diff, Math.abs(a[i] - b[i]));
  assert.ok(diff > 0.02, '错配编码应改变节奏（实测最大差 ' + diff.toFixed(4) + '）—— 证明墨量确实按编码换算');
  /* 端点仍然逐字节是源 */
  assert.equal(sha(cal.at(0)), SHA_A); assert.equal(sha(cal.at(1)), sha(PIC_CAL));
});

test('tone 边界：墨量处处相同 → fallback "flat"，按种子次序（= 溶解），确定、端点严格', () => {
  const flat = new Float32Array(N).fill(0.4);
  const t1 = mk({ mode: 'tone', seed: 3 }, { to: flat }), t2 = mk({ mode: 'tone', seed: 3 }, { to: flat }), t3 = mk({ mode: 'tone', seed: 4 }, { to: flat });
  assert.equal(t1.info.fallback, 'flat');
  assert.equal(mk({ mode: 'tone' }, { to: PIC }).info.fallback, null);
  assert.equal(sha(t1.at(0.4)), sha(t2.at(0.4)));
  assert.notEqual(sha(t1.at(0.4)), sha(t3.at(0.4)), '换种子换次序');
  assert.equal(sha(t1.at(0)), SHA_A); assert.equal(sha(t1.at(1)), sha(flat));
  const m = t1.orderMap(), s = Array.from(m).sort((a, b) => a - b);
  for (let k = 0; k < N; k++) assert.ok(Math.abs(s[k] - k / (N - 1)) < 1e-9, '平键时次序等间距');
  /* 活场（函数源）按 t=0 取一次墨量 */
  const fnB = (i, x, y, t) => (t === 0 ? PIC[i] : 1 - PIC[i]);
  assert.deepEqual(Array.from(mk({ mode: 'tone' }, { to: fnB }).orderMap()), Array.from(mk({ mode: 'tone' }, { to: PIC }).orderMap()));
});

/* 暴力带符号距离（格心到最近对侧格心，减半格）—— 与 EDT 对账 */
function bruteSigned(maskArr) {
  const d = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const ins = maskArr[i] >= 0.5; let best = Infinity;
    for (let j = 0; j < N; j++) if ((maskArr[j] >= 0.5) !== ins) {
      const dx = (i % COLS) - (j % COLS), dy = ((i / COLS) | 0) - ((j / COLS) | 0);
      best = Math.min(best, dx * dx + dy * dy);
    }
    d[i] = ins ? -(Math.sqrt(best) - 0.5) : Math.sqrt(best) - 0.5;
  }
  return d;
}

test('mask（数组）：次序严格按到轮廓的带符号距离（EDT 与暴力一致）；字形先于形外，invert 收拢', () => {
  const d = bruteSigned(MASK_ARR);
  for (const inv of [false, true]) {
    const m = mk({ mode: 'mask', mask: MASK_ARR, edge: 0, invert: inv }).orderMap();
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      if (d[i] < d[j] - 1e-9) assert.ok(inv ? m[i] > m[j] : m[i] < m[j], 'invert=' + inv + ' i=' + i + ' j=' + j);
    }
    let maxIn = -1, minOut = 2, minIn = 2, maxOut = -1;
    for (let i = 0; i < N; i++) {
      if (MASK_ARR[i] >= 0.5) { maxIn = Math.max(maxIn, m[i]); minIn = Math.min(minIn, m[i]); }
      else { minOut = Math.min(minOut, m[i]); maxOut = Math.max(maxOut, m[i]); }
    }
    if (!inv) assert.ok(maxIn < minOut, '向外长：字形整个先于形外');
    else assert.ok(minIn > maxOut, '收拢：字形最后合上');
  }
});

test('mask（函数 = fields.sdf 的 shape）：圆心最先、离圆越远越晚；与 fields.sdf 覆盖率数组同向', () => {
  const m = mk({ mode: 'mask', mask: MASK_FN, edge: 0 }).orderMap();
  const dist = i => Math.hypot((i % COLS) + 0.5 - COLS * 0.45, ((i / COLS) | 0) + 0.5 - ROWS * 0.5);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if (dist(i) < dist(j) - 1e-9) assert.ok(m[i] < m[j]);
  /* 同一个 shape 走 fields.sdf → 覆盖率数组 → EDT：形内整体仍先于形外 */
  const cov = D.fields.sdf(COLS, ROWS, MASK_FN, { width: 0.5 });
  const ma = mk({ mode: 'mask', mask: cov, edge: 0 });
  let maxIn = -1, minOut = 2; const mo = ma.orderMap();
  for (let i = 0; i < N; i++) { if (cov[i] >= 0.5) maxIn = Math.max(maxIn, mo[i]); else minOut = Math.min(minOut, mo[i]); }
  assert.ok(maxIn < minOut);
  assert.equal(ma.params.mask, 'array'); assert.equal(mk({ mode: 'mask', mask: MASK_FN }).params.mask, 'function');
});

test('mask 边界：空遮罩 / 全遮罩 → 明确 fallback（种子次序），端点严格；缺遮罩 / 长度错 / NaN 抛错；遮罩不被改', () => {
  const empty = new Float32Array(N), full = new Float32Array(N).fill(1);
  const te = mk({ mode: 'mask', mask: empty, seed: 9 }), tf = mk({ mode: 'mask', mask: full, seed: 9 });
  assert.equal(te.info.fallback, 'empty-mask'); assert.equal(tf.info.fallback, 'full-mask');
  assert.deepEqual(Array.from(te.orderMap()), Array.from(tf.orderMap()), '两种退化都落到同一个种子次序');
  assert.deepEqual(Array.from(te.orderMap()), Array.from(mk({ mode: 'tone', seed: 9 }, { to: new Float32Array(N) }).orderMap()), '与 tone 的平键退化同一口径');
  for (const tr of [te, tf]) { assert.equal(sha(tr.at(0)), SHA_A); assert.equal(sha(tr.at(1)), SHA_B); }
  assert.equal(mk({ mode: 'mask', mask: () => 2 }).info.fallback, 'flat', '常数距离函数 = 平键');
  assert.equal(mk({ mode: 'mask', mask: MASK_ARR }).info.fallback, null);
  assert.throws(() => mk({ mode: 'mask' }), { name: 'TypeError' });
  assert.throws(() => mk({ mode: 'mask', mask: new Float32Array(N - 1) }), { name: 'RangeError' });
  assert.throws(() => mk({ mode: 'mask', mask: () => NaN }), { name: 'RangeError' });
  const before = sha(MASK_ARR);
  for (const p of PS) mk({ mode: 'mask', mask: MASK_ARR }).at(p);
  assert.equal(sha(MASK_ARR), before, '遮罩数组只读');
  assert.equal(mk({ mode: 'wipe', mask: 'ignored' }).params.mask, null, '非 mask 模式忽略 mask');
});

test('节奏：tone / mask 不集中突变、不长时间停（二值图也一样）', () => {
  const cases = [
    ['tone 连续调', mk({ mode: 'tone', edge: 0 }, { to: PIC })],
    ['tone 二值图', mk({ mode: 'tone', edge: 0 }, { to: BIN })],
    ['tone 二值图 先亮后暗', mk({ mode: 'tone', edge: 0, invert: true }, { to: BIN })],
    ['mask 数组', mk({ mode: 'mask', mask: MASK_ARR, edge: 0 })],
    ['mask 函数 收拢', mk({ mode: 'mask', mask: MASK_FN, edge: 0, invert: true })],
  ];
  for (const [label, tr] of cases) {
    const c = []; for (let k = 0; k <= 1000; k++) c.push(tr.countB(k / 1000));
    let burst = 0, stall = 0, run = 0;
    for (let k = 10; k <= 1000; k++) burst = Math.max(burst, c[k] - c[k - 10]);
    for (let k = 1; k <= 1000; k++) { run = c[k] === c[k - 1] ? run + 1 : 0; stall = Math.max(stall, run); }
    assert.ok(burst <= 0.025 * N, label + '：任意 1% 进度内最多换 2.5% 的格（实测 ' + burst + '/' + N + '）');
    assert.ok(stall <= 30, label + '：最长停顿 ≤ 3% 进度（实测 ' + stall / 10 + '%）');
  }
});
