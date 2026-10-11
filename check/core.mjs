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

/** 把经典脚本放进一个干净的 vm 上下文里加载（dotink.js / pheno.js 加载期不碰 DOM） */
function load(...files) {
  const ctx = vm.createContext({ console });
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  return ctx;
}
const D = load('dotink.js', 'pheno.js').DotInk;

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
  const need = ['dotink.js', 'pheno.js', 'markplate.js', 'marks.js', 'logo.js', 'STANDARD.md',
    'preview.html', 'gallery.html', 'marks.html', 'marks-type.html', 'logo-demo.html', 'icon.html',
    'NOTICE.md', 'SKILL.md', 'LICENSE', 'CHANGELOG.md', 'OPENSOURCE.md',
    'docs/01-standard.md', 'docs/02-phenomena.md', 'docs/03-marks-logo.md'];
  for (const f of need) assert.ok(fs.existsSync(path.join(ROOT, f)), '缺文件：' + f);
});
