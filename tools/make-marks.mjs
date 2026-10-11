#!/usr/bin/env node
/* 点墨 · 厂标数据入库（从主库 markplate 的 icons.js 抽出 key/title/d）
 * ============================================================================
 * 用法：node tools/make-marks.mjs [<主库>/modules/markplate/icons.js]
 * 产出：../marks.js（window.DotInkMarks）
 *
 * 版权口径（与主库 modules/markplate/README.md 一致，原文照抄）：
 *   厂标是各家的商标，这里用来**指称**那家公司属于规范使用；
 *   路径数据来自 simple-icons（**CC0 1.0**），不是官方素材包，除形变外没有改绘。
 *   商用发布前按自家法务口径过一遍。详见 NOTICE.md。
 * ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = process.argv[2] || 'D:/developing/make-videos-kit/modules/markplate/icons.js';
if (!fs.existsSync(src)) {
  console.error('找不到源文件：' + src);
  console.error('用法：node tools/make-marks.mjs <主库>/modules/markplate/icons.js');
  process.exit(1);
}
const txt = fs.readFileSync(src, 'utf8');
const m = txt.match(/ICONS\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
if (!m) { console.error('源文件里没找到 ICONS = {...}（格式变了？）'); process.exit(1); }
const ICONS = JSON.parse(m[1]);

const icons = {};
const order = [];
for (const k of Object.keys(ICONS)) {
  const it = ICONS[k];
  if (!it || !it.d) continue;
  icons[k] = { title: it.title || k, d: it.d };
  order.push(k);
}

const out = `/* 点墨 · 厂标路径数据（${order.length} 家）—— **自动生成，勿手改**
 * 生成：node tools/make-marks.mjs <主库>/modules/markplate/icons.js
 *
 * 版权口径：厂标是各家的商标，这里用来**指称**那家公司属于规范使用；
 * 路径数据来自 simple-icons（**CC0 1.0**），不是官方素材包，除形变外没有改绘。
 * 商用发布前按自家法务口径过一遍。详见 NOTICE.md。
 */
window.DotInkMarks = {
  v: 1,
  source: 'simple-icons (CC0 1.0)',
  viewBox: 24,
  order: ${JSON.stringify(order)},
  icons: ${JSON.stringify(icons)},
};
`;
const dst = path.join(here, '..', 'marks.js');
fs.writeFileSync(dst, out);
console.log('✓ 写出 ' + dst + '（' + order.length + ' 家厂标 · ' + (out.length / 1024).toFixed(0) + ' KB）');
console.log('  顺序：' + order.slice(0, 6).join(' · ') + ' …');
