/* ============================================================================
 * build-theme.mjs · 从 theme/palettes.json 生成 theme.css 与 theme.js
 * ----------------------------------------------------------------------------
 * 跑法：
 *   node tools/build-theme.mjs            写盘（默认）
 *   node tools/build-theme.mjs --check    只比对，有漂移 exit 1（给 check 用）
 *
 * 为什么生成件要进仓：本包承诺"双击打开、零依赖、无构建"。构建只在作者机上跑，
 * 产物进仓并由 `--check` 锁死 —— 与 markplate.js（vendored + sha256 校验）同一套做法。
 * ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPalettes, validate, gates, renderCss, renderJs } from './theme-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

const json = loadPalettes(ROOT);
const errs = validate(json);
if (errs.length) {
  console.error('✗ palettes.json 不合法：');
  for (const e of errs) console.error('  ' + e);
  process.exit(1);
}

/* 门禁：不过就不许生成 —— 免得"生成了但没人看对比度" */
let bad = 0;
for (const p of json.palettes) {
  for (const g of gates(p)) {
    if (!g.ok) {
      bad++;
      console.error(`✗ ${p.slug}：${g.key}/${g.against} 只有 ${g.value.toFixed(2)}，要求 ≥ ${g.min}（${g.why}）`);
    }
  }
}
if (bad) process.exit(1);

const targets = [
  { file: 'theme.css', body: renderCss(json) },
  { file: 'theme.js', body: renderJs(json) }
];

if (CHECK) {
  let drift = 0;
  for (const t of targets) {
    const abs = path.join(ROOT, t.file);
    if (!fs.existsSync(abs)) { console.error('✗ 缺生成件：' + t.file); drift++; continue; }
    /* ⚠ 归一 CRLF 再比：Windows 上 core.autocrlf=true 时 checkout 出来是 CRLF，
       不归一的话「零漂移」在全新 clone 里必红（实测）。 */
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
    console.error('\n请跑 `node tools/build-theme.mjs` 重新生成（配色只改 palettes.json，不要手改生成件）。');
    process.exit(1);
  }
  console.log('✓ theme.css / theme.js 与 palettes.json 一致（' + json.palettes.length + ' 套配色）');
} else {
  for (const t of targets) {
    fs.writeFileSync(path.join(ROOT, t.file), t.body, 'utf8');
    console.log('· ' + t.file + '  ' + t.body.length + ' 字节');
  }
  console.log('✓ 生成完成（' + json.palettes.length + ' 套配色，默认 ' + json.default + '，暗色 ' + (json.darkDefault || json.default) + '）');
}

function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return n;
}
