/* ============================================================================
 * build-scale.mjs · 从 theme/scale.json 生成 scale.css 与 scale.js
 * ----------------------------------------------------------------------------
 * 跑法：
 *   node tools/build-scale.mjs            写盘（默认）
 *   node tools/build-scale.mjs --check    只比对，有漂移 exit 1（给 check 用）
 *
 * 与 build-theme.mjs 同一套理由：生成件进仓，构建只在作者机上跑，`--check` 锁死。
 * ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, gates, renderCss, renderJs } from './scale-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'theme', 'scale.json'), 'utf8').replace(/^\uFEFF/, ''));

const errs = validate(json);
if (errs.length) {
  console.error('✗ scale.json 不合法：');
  for (const e of errs) console.error('  ' + e);
  process.exit(1);
}

/* 门禁：不过就不许生成 —— 免得"生成了但尺子是坏的" */
let bad = 0;
for (const g of gates(json)) {
  if (!g.ok) {
    bad++;
    console.error('✗ ' + g.key + '：' + (g.value === '' ? '' : '(' + g.value + ') ') + g.why);
  }
}
if (bad) process.exit(1);

const targets = [
  { file: 'scale.css', body: renderCss(json) },
  { file: 'scale.js', body: renderJs(json) }
];

if (CHECK) {
  let drift = 0;
  for (const t of targets) {
    const abs = path.join(ROOT, t.file);
    if (!fs.existsSync(abs)) { console.error('✗ 缺生成件：' + t.file); drift++; continue; }
    /* ⚠ 归一 CRLF 再比：Windows 上 core.autocrlf=true 时 checkout 出来是 CRLF */
    const cur = fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');
    if (cur !== t.body) {
      drift++;
      const i = firstDiff(cur, t.body);
      console.error('✗ 漂移：' + t.file + '（首处差异在偏移 ' + i + '）');
      console.error('   现在的：' + JSON.stringify(cur.slice(i, i + 60)));
      console.error('   应生成：' + JSON.stringify(t.body.slice(i, i + 60)));
    }
  }
  if (drift) {
    console.error('\n请跑 `node tools/build-scale.mjs` 重新生成（尺度只改 scale.json，不要手改生成件）。');
    process.exit(1);
  }
  console.log('✓ scale.css / scale.js 与 scale.json 一致（' + json.type.length + ' 档字阶，' +
    Object.keys(json.space).length + ' 级间距，基准 ' + json.unit + 'px）');
} else {
  for (const t of targets) {
    fs.writeFileSync(path.join(ROOT, t.file), t.body, 'utf8');
    console.log('· ' + t.file + '  ' + t.body.length + ' 字节');
  }
  console.log('✓ 生成完成（' + json.type.length + ' 档字阶，' + Object.keys(json.space).length +
    ' 级间距，基准 ' + json.unit + 'px）');
}

function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return n;
}
