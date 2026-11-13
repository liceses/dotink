/* 文档链接检查（零依赖）：所有 .md / .html 里的相对链接、src 与 href 必须存在
 * 跑法：node tools/check-links.mjs
 * 为什么值得单独一条：整包是 `file://` 双击打开的，断链 = 死路（发布前当门禁跑）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/* 跳过 node_modules / _release / .git，以及**任何点开头的目录**（.dsh / .visual-audit 这类
   工具与审查产物不是发布面）。check/core.mjs 的「页面装载顺序」测试也是按这条口径走的
   —— 两个检查器对"什么算包里的一份子"必须同一套，否则一边绿一边红。 */
const SKIP = /(^|[\\/])(node_modules|_release|\.git)([\\/]|$)/;
const isDotDir = (p) => /(^|[\\/])\.[^\\/]+([\\/]|$)/.test(p);
const bad = [];
let n = 0;

/* ⚠ 属性名前面必须**卡词边界**（前面不能是字母 / 数字 / `-` / `.`）：
   否则 `data-src="poster"` 里的 `src="poster"` 会被当成资源路径，press.html 的
   四个按钮因此报了 4 处**假断链**（实测：修之前 272 条里 4 处全假）。
   同一个边界对 `href` 也必要：`data-href` / `aria-href` 不是链接。
   `xlink:href` 前面的 `:` 不在排除集里 —— 那是真的链接（SVG <use>），该查。 */
const ATTR_SRC = /(?<![-.\w])src="([^"]+)"/g;
const ATTR_HREF = /(?<![-.\w])href="([^"]+)"/g;

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (SKIP.test(p) || isDotDir(path.relative(ROOT, p))) continue;
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
  for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) targets.push(m[1]);   // Markdown
  for (const m of text.matchAll(ATTR_SRC)) targets.push(m[1]);              // <script src> / <img src>
  for (const m of text.matchAll(ATTR_HREF)) targets.push(m[1]);             // <a href> / <link href>
  for (let t of targets) {
    t = t.split('#')[0];
    /* 外链 / 锚点 / 协议相对（//cdn…）都不是本包里的相对路径 */
    if (!t || /^(https?:|mailto:|data:|#)/.test(t) || t.startsWith('//')) continue;
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
