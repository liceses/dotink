/* 零依赖测试：规范里"能算的"部分（不需要浏览器）
 * 跑法：node --test test/
 * 覆盖：半径映射公式 · 场构造器 · 现象场库（确定性/值域/演化）· vendored 移植一致性 · 数据完整性 · 版本号
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 把经典脚本放进一个干净的 vm 上下文里加载（各件加载期不碰 DOM） */
function load(...files) {
  const ctx = vm.createContext({ console });
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  return ctx;
}
const D = load('fields.js', 'render.js', 'judge.js', 'host.js', 'dotink.js', 'hud.js', 'pheno.js').DotInk;

test('半径映射：√ 是面积映射，线性不是（§3 的配对规则）', () => {
  const cell = 12, maxFrac = 0.48, rMax = maxFrac * cell;
  // r = rMax·√w
  assert.equal(D.radius(0.25, cell, maxFrac, true).toFixed(6), (rMax * 0.5).toFixed(6));
  // 面积 ∝ w
  const a = Math.PI * Math.pow(D.radius(0.25, cell, maxFrac, true), 2);
  const b = Math.PI * Math.pow(D.radius(1, cell, maxFrac, true), 2);
  assert.ok(Math.abs(a / b - 0.25) < 1e-9, '√ 映射下 面积比 应等于 w 比');
  // 线性：面积 ∝ w²
  const la = Math.PI * Math.pow(D.radius(0.25, cell, maxFrac, false), 2);
  const lb = Math.PI * Math.pow(D.radius(1, cell, maxFrac, false), 2);
  assert.ok(Math.abs(la / lb - 0.0625) < 1e-9, '线性映射下 面积比 应是 w² 比');
  // 边界
  assert.equal(D.radius(0, cell, maxFrac, true), 0);
  assert.ok(D.radius(0.5, cell, maxFrac, true) <= rMax + 1e-9);
});

test('场构造器：形状、值域、行主序', () => {
  const cols = 16, rows = 9;
  for (const name of ['ramp', 'noise']) {
    const v = D.fields[name](cols, rows);
    assert.ok(ArrayBuffer.isView(v) && v.BYTES_PER_ELEMENT === 4, name + ' 应返回 32 位浮点视图');
    assert.equal(v.length, cols * rows);
    let mn = 1, mx = 0;
    for (const x of v) { if (x < mn) mn = x; if (x > mx) mx = x; }
    assert.ok(mn >= 0 && mx <= 1, name + ' 值域应在 [0,1]');
  }
  const f = D.fields.interferenceFn(cols, rows, { k: 0.55, w: 0.25, speed: 1.4 });
  assert.equal(typeof f, 'function');
  const t1 = f(5, 2, 3, 1.0), t2 = f(5, 2, 3, 4.0);
  assert.ok(t1 >= 0 && t1 <= 1 && t2 >= 0 && t2 <= 1);
  assert.notEqual(t1, t2, '干涉场应随 t 变化');
});

test('fromImageData：先二值化再算每格深色占比（白底细线不被平均掉）', () => {
  const W = 32, H = 32, cols = 8, rows = 8;
  const data = new Uint8ClampedArray(W * H * 4).fill(255);       // 全白
  for (let x = 0; x < W; x++) {                                   // 一条 1px 的深色细线
    const i = (16 * W + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 0;
  }
  const v = D.fields.fromImageData(data, W, H, cols, rows, { thr: 0.62, gamma: 0.45, gain: 1.6 });
  assert.equal(v.length, cols * rows);
  const row = Array.from(v.slice(32, 40));                        // 细线在 y=16 → 格行 4 → 索引 32..39
  assert.ok(Math.max(...row) > 0.2, '细线所在格必须有墨（面积平均会把它抹成 ~0）');
  const other = Array.from(v.slice(0, 8));
  assert.equal(Math.max(...other), 0, '没有线的格应无墨');
});

test('现象场库：八个 + 沙粒版都在，且都能构造', () => {
  const names = ['chladni', 'sunflower', 'deJong', 'grayScott', 'dla', 'kuramoto', 'bifurcation', 'interference'];
  for (const n of names) assert.equal(typeof D.pheno[n], 'function', '缺 ' + n);
  assert.equal(typeof D.pheno.sandChladniPoints, 'function', '缺沙粒版');
assert.equal(typeof D.pheno.kuramotoRing, 'function', '缺相位环版（06 的点列体裁）');
  const opts = {
    chladni: { period: 16 }, sunflower: { seeds: 400, span: 26 },
    deJong: { sets: [[1.641, 1.902, 0.316, 1.525], [1.4, -2.3, 2.4, -2.1]], span: 30, iter: 8000 },
    grayScott: { steps: 300, every: 10, warm: 40, span: 36 },
    dla: { particles: 300, seed: 11, span: 44 },
    kuramoto: { steps: 200, every: 5, seed: 7, span: 46 },
    bifurcation: { bins: 128, period: 24 }, interference: { period: 24 },
  };
  for (const n of names) {
    const f = D.pheno[n](32, 18, opts[n]);
    assert.equal(typeof f, 'function');
    let mn = 1, mx = 0;
    for (let y = 0; y < 18; y++) for (let x = 0; x < 32; x++) { const v = f(y * 32 + x, x, y, 5); if (v < mn) mn = v; if (v > mx) mx = v; }
    assert.ok(mn >= 0 && mx <= 1, n + ' 值域应在 [0,1]');
    assert.ok(mx > 0.5, n + ' 最大值应 >0.5（不然整屏没墨）');
  }
});

test('现象场库：确定性（同参数两个独立实例逐格相同）+ 会动', () => {
  const mk = () => D.pheno.grayScott(24, 14, { steps: 300, every: 10, warm: 40, span: 36 });
  const a = mk(), b = mk();
  let same = true, diff = 0;
  for (let i = 0; i < 24 * 14; i++) {
    const va = a(i, i % 24, (i / 24) | 0, 3), vb = b(i, i % 24, (i / 24) | 0, 3);
    if (va !== vb) same = false;
    diff += Math.abs(a(i, i % 24, (i / 24) | 0, 8) - va);
  }
  assert.ok(same, '两个独立实例必须逐格相同（确定性）');
  assert.ok(diff / (24 * 14) > 0.01, 't=1 与 t=8 应有可见变化（Δ>0.01）');
});

test('沙粒版：点列通道返回 [x,y,r] 三元组，且随时间走', () => {
  const pts = D.pheno.sandChladniPoints(40, 23, { cssW: 160, cssH: 90, grains: 200, snaps: 40, substeps: 8, span: 12 });
  /* ⚠ 这个函数**复用同一个 Float32Array**（省分配）—— 对比两帧必须先拷一份，
     否则 a 与 b 是同一个数组，永远读作「没动」（我第一版就这么写的）。 */
  const a = Float32Array.from(pts(0.2)), b = pts(11.5);
  assert.equal(a.length % 3, 0, '点列应是 [x,y,r,…]');
  assert.equal(a.length / 3, 200, '颗数应等于 grains');
  let moved = 0;
  for (let i = 0; i < a.length; i += 3) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) > 0.5) moved++;
  assert.ok(moved > 10, '沙粒应随时间移动（实测动了 ' + moved + ' 颗）');
  for (let i = 0; i < a.length; i += 3) assert.ok(a[i] >= 0 && a[i] <= 160 && a[i + 1] >= 0 && a[i + 1] <= 90, '点应落在画幅内');
});

test('相位环：点列三元组、都在圆周上、锁相收拢、指针长度跟着序参量', () => {
  const CW = 1280, CH = 720, N = 200, SPAN = 26;
  const f = D.pheno.kuramotoRing(160, 90, { cssW: CW, cssH: CH, N: N, frames: 120, span: SPAN });
  const a = Float32Array.from(f(0.5)), b = Float32Array.from(f(SPAN * 0.98));
  assert.equal(a.length, (N + 6) * 3, '点列应是 (N + 指针点数) × 3');
  /* 振子必须落在同一个圆上：半径恒定、圆心在画幅中心 */
  const cx = CW / 2, cy = CH / 2;
  let rMin = 1e9, rMax = 0;
  for (let i = 0; i < N * 3; i += 3) { const r = Math.hypot(a[i] - cx, a[i + 1] - cy); rMin = Math.min(rMin, r); rMax = Math.max(rMax, r); }
  assert.ok(rMax - rMin < 1e-3, '所有振子应在同一半径上（实测 ' + rMin.toFixed(3) + '..' + rMax.toFixed(3) + '）');
  /* 锁相 = 相位分布变窄：用序参量（相位点的圆周散布）量，散相时 r≈0，锁相时 r→1 */
  const order = (P, from) => {
    let sx = 0, sy = 0;
    for (let i = from; i < from + N * 3; i += 3) { sx += P[i] - cx; sy += P[i + 1] - cy; }
    return Math.hypot(sx, sy) / N / (rMax || 1);
  };
  const r0 = order(a, 0), r1 = order(b, 0);
  assert.ok(r1 > r0 + 0.15, 'K 爬升后应明显更同步（实测 ' + r0.toFixed(3) + ' → ' + r1.toFixed(3) + '）');
  /* 指针：从圆心出发，长度 = 序参量 × R；锁相后应显著更长 */
  const pinLen = (P) => {
    const i0 = N * 3;
    return Math.hypot(P[i0] - cx, P[i0 + 1] - cy);
  };
  assert.ok(pinLen(b) > pinLen(a), '锁相后指针应变长（' + pinLen(a).toFixed(1) + ' → ' + pinLen(b).toFixed(1) + '）');
  /* 复用同一个数组：不拷就永远"没动"（本库踩过一次） */
  const again = f(0.5);
  assert.ok(again === f(0.5), '应复用同一个 Float32Array');
});

test('厂标数据：47 家、顺序一致、路径非空、名字不重', () => {
  const ctx = vm.createContext({ window: {} });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'marks.js'), 'utf8'), ctx);
  const M = ctx.window.DotInkMarks;
  assert.equal(M.order.length, 47);
  assert.equal(Object.keys(M.icons).length, 47);
  const titles = new Set();
  for (const k of M.order) {
    const it = M.icons[k];
    assert.ok(it && typeof it.d === 'string' && it.d.length > 20, k + ' 的路径缺失或过短');
    assert.ok(!titles.has(it.title), '显示名重复：' + it.title);
    titles.add(it.title);
  }
  assert.equal(M.viewBox, 24);
  assert.match(M.source, /CC0/);
});

test('移植一致性：包内 markplate.js 的正文与主库逐字节相同（在主库里跑时）', () => {
  const up = path.resolve(ROOT, '..', 'modules', 'markplate', 'markplate.js');
  if (!fs.existsSync(up)) { console.log('  （不在主库里，跳过）'); return; }
  const vend = fs.readFileSync(path.join(ROOT, 'markplate.js'), 'utf8');
  const body = vend.slice(vend.indexOf('*/') + 2).replace(/^\r?\n/, '');
  const h = s => crypto.createHash('sha256').update(s).digest('hex');
  assert.equal(h(body), h(fs.readFileSync(up, 'utf8')), '正文必须与上游逐字节一致（只允许加出处头）');
});

test('版本号：package.json 与 dotink.js 一致', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  const m = fs.readFileSync(path.join(ROOT, 'dotink.js'), 'utf8').match(/version:\s*'([\d.]+)'/);
  assert.ok(m, 'dotink.js 里应有一行 version');
  assert.equal(m[1], pkg.version, 'dotink.js 的 version 应与 package.json 一致');
});

test('文件表：README 里点名的入口文件都真的存在', () => {
  const need = ['dotink.js', 'fields.js', 'render.js', 'judge.js', 'host.js', 'hud.js',
    'pheno.js', 'markplate.js', 'marks.js', 'logo.js', 'STANDARD.md',
    'preview.html', 'gallery.html', 'hero.html', 'marks.html', 'marks-type.html', 'logo-demo.html', 'icon.html',
    'NOTICE.md', 'SKILL.md', 'LICENSE', 'CHANGELOG.md', 'OPENSOURCE.md',
    'docs/01-standard.md', 'docs/02-phenomena.md', 'docs/03-marks-logo.md'];
  for (const f of need) assert.ok(fs.existsSync(path.join(ROOT, f)), '缺文件：' + f);
});

test('拆件：核心不认识 HUD，叠加层走 overlays（显式钩子）', () => {
  assert.equal(typeof D.create, 'function', '汇总入口应装配出 create');
  assert.equal(typeof D.render.create, 'function', 'render.js 应有 create');
  assert.equal(typeof D.judge.measure, 'function', 'judge.js 应有 measure');
  assert.ok(!('hud' in D.DEFAULTS), 'DEFAULTS 里不应再有 hud');
  assert.ok(!('hudC' in D.DEFAULTS), 'DEFAULTS 里不应再有 hudC');
  assert.ok(!('caption' in D.DEFAULTS), 'DEFAULTS 里不应再有 caption');
  assert.equal(typeof D.hud, 'function', 'hud.js 应提供 DotInk.hud');
  assert.equal(typeof D.caption, 'function', 'hud.js 应提供 DotInk.caption');
});

test('整条管线（假画布）：1-bit · 确定性 · overlays 只加墨不改场', () => {
  const mkCanvas = (W, H) => {
    const px = new Uint8ClampedArray(W * H * 4);
    const ctx = {
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      putImageData: img => { px.set(img.data); },
      getImageData: () => ({ data: px.slice() }),
    };
    return { width: W, height: H, getContext: () => ctx, pixels: px };
  };
  const cols = 24, rows = 12;
  const field = D.fields.ramp(cols, rows);
  const base = { cssW: cols * 8, cssH: rows * 8, scale: 1, cols: cols, rows: rows, cell: 8, shutter: 0, field: field };

  const c1 = mkCanvas(cols * 8, rows * 8);
  const i1 = D.create(Object.assign({ canvas: c1 }, base));
  i1.draw(2);
  const a = i1.judge();
  assert.equal(a.mode, 'M2', '渐变应读成面场');
  assert.ok(a.measures.coverage > 0, '应有墨');
  assert.equal(a.checks.find(x => x.name === '1-bit 无灰阶').ok, true, 'compose() 之后必须无灰阶');

  /* 确定性：同 t 两次逐像素一致 */
  const snap = Uint8ClampedArray.from(c1.pixels);
  i1.draw(2);
  assert.deepEqual(Array.from(c1.pixels), Array.from(snap), 'draw(t) 应是纯函数');

  /* overlays：在场上再叠墨 —— 只在纸面落笔才叫"加墨"，且同样确定 */
  const c2 = mkCanvas(cols * 8, rows * 8);
  const i2 = D.create(Object.assign({ canvas: c2 }, base, { overlays: [api => { api.dot(189.5, 2.5, 1.2); }] }));
  i2.draw(2);
  const b = i2.measure();
  assert.ok(b.coverage > a.measures.coverage, '叠加层应在纸面加墨（' + (a.measures.coverage * 100).toFixed(2) + '% → ' + (b.coverage * 100).toFixed(2) + '%）');
  const snap2 = Uint8ClampedArray.from(c2.pixels);
  i2.draw(2);
  assert.deepEqual(Array.from(c2.pixels), Array.from(snap2), '带 overlays 的 draw(t) 也应确定');
});

test('叠加层是两个纯函数：hud 只用 api.dot，caption 只用 api.glyph', () => {
  const pts = [];
  const api = { dot: (x, y, r) => pts.push([x, y, r]), glyph: () => { throw new Error('hud 不该用 glyph'); }, opts: { duration: 12 } };
  const layer = D.hud();
  layer(api, 3);
  const once = pts.slice();
  pts.length = 0; layer(api, 3);
  assert.deepEqual(pts, once, '同一 t 的 HUD 点位应一致');
  assert.ok(once.length > 100, 'HUD 应落足够多的点');
  assert.ok(once.every(p => p[2] > 0 && isFinite(p[0]) && isFinite(p[1])), '点位与点径应有效');

  const glyphs = [];
  const advOf = (ch, px) => ({ w: px, h: px, adv: px * 0.5 });   /* 假字形：半角 */
  D.caption({ x: 96, y: 596, px: 40, texts: [{ t0: 0, t1: 6, lines: ['AB'] }] })(
    { glyph: (...a) => glyphs.push(a), measureGlyph: advOf }, 0.5);
  assert.equal(glyphs.length, 2, '字幕应按字符数调用 glyph（空格不落墨）');
  /* 步进宽来自 measureGlyph().adv，**不是**写死的 px*0.5 —— 中文字宽是 1em，
     按 0.5em 排会重叠一倍（demo 的三段字幕原先全糊成黑块）。
     这里第二个字的 x = 起点 + 第一个字的 adv（假字形给 20），再 +adv/2 居中。 */
  assert.deepEqual(glyphs[1].slice(0, 4), ['B', 96 + 20 + 10, 596, 40], '字距 = 实测步进宽，字是实墨');

  /* 全角字（adv = px）不得重叠：两个字心间距必须 ≥ px */
  const wides = [];
  D.caption({ x: 0, y: 100, px: 40, texts: [{ t0: 0, t1: 1, lines: ['只有'] }] })(
    { glyph: (...a) => wides.push(a), measureGlyph: (ch, px) => ({ w: px, h: px, adv: px }) }, 0.5);
  assert.equal(wides.length, 2);
  assert.ok(wides[1][1] - wides[0][1] >= 40 - 1e-9,
    '全角字心间距应 ≥ 1em（实测 ' + (wides[1][1] - wides[0][1]) + 'px，px=40）');
});

test('画布内版式 plate：只用 dot/glyph/measureGlyph，标题墨框底对齐 bottom，超宽自动缩字号', () => {
  /* 假字形：中文 1em 步进、墨框从 em 顶下 0.12em 到 0.86em（黑体的典型字面率） */
  const mkApi = (cssW) => {
    const glyphs = [], clears = [];
    return {
      glyphs: glyphs, clears: clears,
      api: {
        cssW: cssW, cssH: 720, scale: 1.5,
        dot: () => { throw new Error('plate 不该用 dot'); },
        measureGlyph: (ch, px) => ({ w: px * 0.86, h: px * 0.74, adv: px, top: px * 0.12, bot: px * 0.86 }),
        glyph: (ch, cx, cy, px) => glyphs.push({ ch: ch, cx: cx, cy: cy, px: px }),
        clear: (x, y, w, h) => { clears.push([x, y, w, h]); },
      },
    };
  };
  /* ① 标题底对齐：em 框底 = cy + px/2；墨框底 = em 顶 + bot = (cy − px/2) + bot
     → 要让墨框底 = cssH − bottom，必须是 cy = cssH − bottom − bot + px/2 */
  const A = mkApi(1280);
  const layer = D.plate({ title: '墨', x: 40, bottom: 30, px: 80, kicker: '', formula: '', source: '' });
  layer(A.api, 0);
  assert.equal(A.glyphs.length, 1, '标题只有 1 个字 → 只该贴 1 次');
  const g = A.glyphs[0];
  const inkBottom = (g.cy - g.px / 2) + 80 * 0.86;
  assert.ok(Math.abs(inkBottom - (720 - 30)) < 1e-6,
    '标题墨框底应落在 cssH − bottom（实测 ' + inkBottom.toFixed(2) + '，期望 690）');

  /* ② 确定性：同一 t 调两次，点位逐个相同 */
  const B = mkApi(1280);
  layer(B.api, 0);
  assert.deepEqual(B.glyphs, A.glyphs, '同一 t 的 plate 点位应一致（纯函数）');

  /* ③ 超宽自动缩字号：24 个全角字 × 60px = 1440 > maxW 1168，字号必须变小
     （假字形的 adv 恰好 = px，所以整行宽 = 字数 × px，能直接算） */
  const C = mkApi(1280);
  /* 21 个全角字 × 60 = 1260 > maxW 1168，必须缩 */
  D.plate({ title: '只有墨与纸两种像素，别的一律不许出现在画面里', x: 56 })(C.api, 0);
  assert.ok(C.glyphs.length > 0);
  const usedPx = C.glyphs[0].px;
  assert.ok(usedPx < 60, '超出可用宽时字号应自动缩小（默认 60 → 实测 ' + usedPx + '）');
  const totalW = C.glyphs.length * usedPx;
  assert.ok(totalW <= 1280 - 2 * 56 + usedPx, '缩小后整行宽应落进 maxW（实测 ' + totalW + '）');

  /* ③b 净空（knock）：开的时候先擦纸，关的时候一次都不擦；擦的范围必须盖住标题墨框 */
  const K = mkApi(1280);
  D.plate({ title: '只有墨', knock: true, x: 40, bottom: 30, px: 80, kicker: 'K', formula: 'F', source: 'S' })(K.api, 0);
  assert.ok(K.clears.length >= 2, 'knock 应擦两块（小字区 + 标题区），实测 ' + K.clears.length);
  const titleClear = K.clears[K.clears.length - 1];
  const tg = K.glyphs.filter(g => g.px >= 20)[0];
  const inkTopK = (tg.cy - tg.px / 2) + 80 * 0.12, inkBotK = (tg.cy - tg.px / 2) + 80 * 0.86;
  assert.ok(titleClear[1] <= inkTopK && titleClear[1] + titleClear[3] >= inkBotK,
    '标题净空必须上下都盖住墨框（擦 ' + titleClear[1].toFixed(1) + '..' + (titleClear[1] + titleClear[3]).toFixed(1) +
    '，墨框 ' + inkTopK.toFixed(1) + '..' + inkBotK.toFixed(1) + '）');
  const N2 = mkApi(1280);
  D.plate({ title: '只有墨', x: 40, bottom: 30, px: 80 })(N2.api, 0);
  assert.equal(N2.clears.length, 0, '默认不该擦（老行为不变）');

  /* ④ 小字三行都贴、且都在标题带上方 */
  const E = mkApi(1280);
  D.plate({ kicker: 'K', formula: 'F', source: 'S', title: '标题' })(E.api, 0);
  const small = E.glyphs.filter(x => x.px < 20);
  assert.equal(small.length, 3, 'kicker/formula/source 三行都应落墨（实测 ' + small.length + '）');
  assert.ok(small.every(x => x.cy < 200), '小字应在上边距里');
  assert.ok(E.glyphs.filter(x => x.px >= 20).every(x => x.cy > 500), '标题应在下带');
});

test('字幕净空 knock：默认不擦，开了要按**实测墨框**擦、且框随 align 走', () => {
  /* 假字形：全角 1em 步进，墨框从 em 顶下 0.12em 到 0.86em（黑体的典型字面率） */
  const mk = () => {
    const glyphs = [], clears = [];
    return {
      glyphs: glyphs, clears: clears,
      api: {
        glyph: (ch, cx, cy, px) => glyphs.push({ ch: ch, cx: cx, cy: cy, px: px }),
        measureGlyph: (ch, px) => ({ w: px * 0.86, h: px * 0.74, adv: px, top: px * 0.12, bot: px * 0.86 }),
        clear: (x, y, w, h) => { clears.push([x, y, w, h]); },
      },
    };
  };
  const T = { x: 100, y: 500, px: 40, texts: [{ t0: 0, t1: 9, lines: ['只有墨'] }] };

  /* ① 默认不擦：老行为一字不改 */
  const A = mk();
  D.caption(Object.assign({}, T))(A.api, 1);
  assert.equal(A.clears.length, 0, '默认不该擦（老行为不变）');
  assert.equal(A.glyphs.length, 3, '三个字都要落墨');

  /* ② knock：擦**一次**，而且必须上下盖住实测墨框（墨框 = 行心 ± em/2 + top..bot） */
  const B = mk();
  D.caption(Object.assign({}, T, { knock: true }))(B.api, 1);
  assert.equal(B.clears.length, 1, 'knock 应擦一块（实测 ' + B.clears.length + '）');
  const c = B.clears[0];
  const emTop = T.y - T.px / 2, inkTop = emTop + T.px * 0.12, inkBot = emTop + T.px * 0.86;
  assert.ok(c[1] <= inkTop && c[1] + c[3] >= inkBot,
    '净空必须上下盖住墨框（擦 ' + c[1].toFixed(1) + '..' + (c[1] + c[3]).toFixed(1) +
    '，墨框 ' + inkTop.toFixed(1) + '..' + inkBot.toFixed(1) + '）');
  /* 也不能擦成一大片：上下各只多留 0.30em 的边 */
  assert.ok(inkTop - c[1] <= T.px * 0.30 + 1e-6 && (c[1] + c[3]) - inkBot <= T.px * 0.30 + 1e-6,
    '净空的余量应按 px 给（实测上余 ' + (inkTop - c[1]).toFixed(1) + ' / 下余 ' + ((c[1] + c[3]) - inkBot).toFixed(1) + '）');
  /* 横向：左边界 = x − padX，宽 = 整行宽 + 2·padX（整行宽 = 3 字 × 40） */
  assert.ok(Math.abs(c[0] - (T.x - T.px * 0.34)) < 1e-6, '左边界应是 x − 0.34em');
  assert.ok(Math.abs(c[2] - (3 * T.px + T.px * 0.68)) < 1e-6, '宽度应是整行宽 + 两侧 0.34em');

  /* ③ align:center → 净空框跟着整行居中走，不是从 x 往右铺 */
  const C = mk();
  D.caption(Object.assign({}, T, { knock: true, align: 'center' }))(C.api, 1);
  const cc = C.clears[0];
  const lineW = 3 * T.px, left = T.x - lineW / 2;
  assert.ok(Math.abs(cc[0] - (left - T.px * 0.34)) < 1e-6, '居中的净空应从整行左边 − 0.34em 起');
});

test('页面装载顺序：四个核件必须在 dotink.js 之前', () => {
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
  const core = ['fields.js', 'render.js', 'judge.js', 'host.js'];
  let checked = 0;
  for (const p of pages) {
    const html = fs.readFileSync(p, 'utf8');
    const srcs = Array.from(html.matchAll(/<script[^>]*src="([^"]+)"/g)).map(m => m[1]);
    const at = srcs.findIndex(s => /(^|\/)dotink\.js$/.test(s));
    if (at < 0) continue;                       /* 不用点墨核心的页面（markplate 那条线） */
    checked++;
    for (const f of core) {
      const i = srcs.findIndex(s => s.endsWith('/' + f) || s === f || s === '../' + f);
      assert.ok(i >= 0, path.relative(ROOT, p) + ' 缺 ' + f);
      assert.ok(i < at, path.relative(ROOT, p) + ' 里 ' + f + ' 必须在 dotink.js 之前');
    }
  }
  assert.ok(checked >= 6, '应检查到所有用核心的页面（实测 ' + checked + ' 个）');
});
