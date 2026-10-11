#!/usr/bin/env node
/* 点墨 · 品牌图标生成器（零依赖）
 * ============================================================================
 * 这个图标**就是本标准的一次应用**，不是"另画一张图"：
 *
 *   画幅 512×512 纸底 + 20px 墨框
 *   网点 15×15，点距 32px（= 画幅的 1/16）
 *   底纹：r = 1.8px（细网格，只在放大时看得见）
 *   中心盘：v = clamp01((1 − (d/R)²) · 1.6)，R = 196
 *           r = rMax·√v（**面积映射**，STANDARD §3），rMax = 13 → maxFrac = 13/32 = **0.406 ≤ 0.5** ✓
 *   一颗 accent 点（#FF4B1F）落在正中心 —— 那是"点"的位置，也是主库的 --accent
 *
 * 用法：node tools/make-icon.mjs            # 写 ../icon.svg
 *       node tools/make-icon.mjs --print    # 只打印几何与判据
 * ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const S = 512, BORDER = 20, PITCH = 32, N = 15, R = 196, RMAX = 13, BASE_R = 1.8;
const INK = '#0C0D0E', PAPER = '#F2F3F2', ACCENT = '#FF4B1F';
const FIRST = (S - (N - 1) * PITCH) / 2;          /* 32 */

const dots = [];
for (let j = 0; j < N; j++) {
  for (let i = 0; i < N; i++) {
    const x = FIRST + i * PITCH, y = FIRST + j * PITCH;
    const d = Math.hypot(x - S / 2, y - S / 2);
    const v = Math.max(0, Math.min(1, (1 - Math.pow(d / R, 2)) * 1.6));
    dots.push({ x, y, r: v > 0 ? RMAX * Math.sqrt(v) : BASE_R, v, accent: i === 7 && j === 7 });
  }
}
const disc = dots.filter(d => d.v > 0);
const cov = dots.reduce((a, d) => a + Math.PI * d.r * d.r, 0) / (S * S);

if (process.argv.includes('--print')) {
  console.log('点距 ' + PITCH + 'px · 网格 ' + N + '×' + N + ' = ' + dots.length + ' 颗 · maxFrac ' + (RMAX / PITCH).toFixed(3) + '（≤0.5 ✓）');
  console.log('中心盘 ' + disc.length + ' 颗（半径 ' + Math.min(...disc.map(d => d.r)).toFixed(1) + '..' + Math.max(...disc.map(d => d.r)).toFixed(1) + 'px）· 底纹 ' + BASE_R + 'px · 解析覆盖率 ' + (cov * 100).toFixed(2) + '%');
  process.exit(0);
}

const circles = dots.filter(d => !d.accent).map(d =>
  `    <circle cx="${d.x}" cy="${d.y}" r="${d.r.toFixed(2)}"/>`).join('\n');
const c = dots.find(d => d.accent);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" role="img" aria-label="点墨 Dot Ink">
  <!-- 由 tools/make-icon.mjs 生成（几何即 STANDARD §3/§4 的一次应用）；请勿手改 -->
  <rect width="${S}" height="${S}" fill="${PAPER}"/>
  <rect x="${BORDER / 2}" y="${BORDER / 2}" width="${S - BORDER}" height="${S - BORDER}" fill="none" stroke="${INK}" stroke-width="${BORDER}"/>
  <g fill="${INK}">
${circles}
  </g>
  <circle cx="${c.x}" cy="${c.y}" r="${c.r.toFixed(2)}" fill="${ACCENT}"/>
</svg>
`;
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'icon.svg');
fs.writeFileSync(out, svg);
console.log('✓ 写出 ' + out + '（' + dots.length + ' 颗点 · 覆盖率 ' + (cov * 100).toFixed(2) + '% · maxFrac ' + (RMAX / PITCH).toFixed(3) + '）');
