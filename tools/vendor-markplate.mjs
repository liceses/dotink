#!/usr/bin/env node
/* 点墨 · 字版厂标移植（**代码逐字节照搬**主库的 markplate.js，只在最上面加一段出处头）
 * ============================================================================
 * 用法：node tools/vendor-markplate.mjs [<主库>/modules/markplate/markplate.js]
 * 产出：../markplate.js（window.MarkPlate）
 *
 * 为什么直接搬而不是重写：这是主库已冻结的件（`MarkPlate 1.0`，19 KB，**零依赖、经典脚本**），
 * 重写只会引入差异。上游改了重新跑这个脚本即可。
 * 依赖注入：`MarkPlate.create({ icons })` —— 本包用 marks.js 的 `DotInkMarks.icons`，
 * 不引主库的 icons.js（数据同源：都是 simple-icons 的 CC0 路径）。
 * ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = process.argv[2] || 'D:/developing/make-videos-kit/modules/markplate/markplate.js';
if (!fs.existsSync(src)) {
  console.error('找不到源文件：' + src);
  console.error('用法：node tools/vendor-markplate.mjs <主库>/modules/markplate/markplate.js');
  process.exit(1);
}
const body = fs.readFileSync(src, 'utf8');
const head = `/* dotink/markplate.js · 字版厂标（MarkPlate）—— **代码逐字节移植**自主库
 * \`modules/markplate/markplate.js\`，未改一行；只在文件最上面加了这段出处头。
 * 生成：node tools/vendor-markplate.mjs <主库>/modules/markplate/markplate.js
 * 用途：把厂标用**字**拼出来（每格一个字，字的大小按厂标的距离场走），
 *       「阅读波」(\`reveal\`) 让字逐格浮现 —— 见 marks-type.html。
 * 许可：厂标路径来自 simple-icons（**CC0 1.0**），**商标归各家**；详见 NOTICE.md。
 */
`;
const dst = path.join(here, '..', 'markplate.js');
fs.writeFileSync(dst, head + body);
console.log('✓ 写出 ' + dst + '（' + ((head.length + body.length) / 1024).toFixed(1) + ' KB · 正文 ' + (body.length / 1024).toFixed(1) + ' KB 未改）');
