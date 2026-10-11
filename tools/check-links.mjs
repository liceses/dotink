/* 文档链接检查（零依赖）：所有 .md / .html 里的相对链接与 src 必须存在
 * 跑法：node test/links.mjs
 * 为什么值得单独一条：整包是 `file://` 双击打开的，断链 = 死路（CI 里当门禁跑）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = /(^|[\\/])(node_modules|_release|\.git)([\\/]|$)/;
const bad = [];
let n = 0;

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (SKIP.test(p)) continue;
    if (e.isDirectory()) walk(p);
    else if (/\.(md|html)$/.test(e.name)) check(p);
  }
}

function check(file) {
  let text = fs.readFileSync(file, 'utf8');
  /* 代码围栏与行内代码里的路径是**示例**（如 svg-src="my.svg"），不当链接检查 */
  text = text.replace(/`[\s\S]*?`/g, '').replace(/\x60[^\x60]*\x60/g, '');
  const rel = path.relative(ROOT, file);
  const targets = [];
  for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) targets.push(m[1]);
  for (const m of text.matchAll(/src="([^"]+)"/g)) targets.push(m[1]);
  for (let t of targets) {
    t = t.split('#')[0];
    if (!t || /^(https?:|mailto:|data:|#)/.test(t)) continue;
    n++;
    if (!fs.existsSync(path.resolve(path.dirname(file), t))) bad.push(rel + ' -> ' + t);
  }
}

walk(ROOT);
if (bad.length) {
  console.error('✗ 断链 ' + bad.length + ' 处（检查了 ' + n + ' 条）：');
  for (const b of bad) console.error('  ' + b);
  process.exit(1);
}
console.log('✓ 链接 ' + n + ' 条，全部存在');
