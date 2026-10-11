# 点墨 · 变更记录

> 版本号跟 [`package.json`](package.json) 走（`dotink.js` 的 `version` 必须与它一致，测试会查）。
> `pheno.js` / `logo.js` / 移植的 `markplate.js` 各有自己的内部版本号，见各自文件头。

## 1.4.0 — 2026-10-11

**新增**
- `logo.js` + `logo-demo.html`：**字版 logo 组件（即插即用）** —— 三行脚本 + 一次 `mount`，
  把「字拼成的标 + 阅读波浮现 + 字不断浮动」挂到**任意视频/网页**上；支持内置 47 家 / 自备 SVG；
  白纸 + `mix-blend-mode: multiply` 做零成本透明；裁剪框**按格墨密度量出来**（不是算），
  装不下会自动调小 `markSize` 重建。
- `marks-type.html` + 移植的 `markplate.js`：**字版厂标**（字拼成标，逐字节移植自主库，
  正文 sha256 与上游一致，`tools/vendor-markplate.mjs` 可复现）。
- `marks.html`：**点墨版厂标墙**（同一批 47 家，网点 / 1-bit 剪影两种落墨）。
- `marks.js` + `tools/make-marks.mjs`：47 家厂标路径（simple-icons **CC0**）。
- `OPENSOURCE.md`：开源现状与拆分方案（三块交付物 / 缺口 / 三种结构 / 发布 checklist）。
- `docs/01-standard.md` · `docs/02-phenomena.md` · `docs/03-marks-logo.md`：README 拆成**路由 + 三块文档**。

**修复**
- `dotink.js`：**`field` 直接传 `Float32Array` 时场被静默吞掉**（旧检测把数组判成布尔 `true`
  → 一帧 0 个点、不抛错、画布全纸）。改用 `ArrayBuffer.isView` 并取出数组本身；顺带解决跨 realm 假否定。
  另加诊断口 `inst.debug()`。
- `dotink.js`：`measure()` 在没有 `regions` 时不返回 `decoVsInfo`，`judge()` 只判 `!== null`
  → 在 `undefined` 上调 `.toFixed` 抛错（画廊判据面板整块空白）。已修。
- `dotink.js`：导出改为**加法式**（原来整体赋值会冲掉后加载的 `DotInk.pheno`）。
- 三个页面的 rAF 循环：**dt 夹到 `[0,0.1]` + try/catch**（首帧时间戳可能为负、切页回来是大跳；
  一帧抛错在 `requestAnimationFrame` 之前会让播放**静默死掉**）。
- `gallery.html` / `marks-type.html`：判据读数节流到 ~4/s（`getImageData` 是 2M 像素）。

**标准**
- `STANDARD.md` §3 重写：半径映射**与场自带的 gamma 配对**（场是物理量原样 → `√`；场已做感知标定 → 线性），
  不再是"线性 ✗"。
- `STANDARD.md` §14 新增**参考配方**（点距 8px · 真圆盘 0..3.2px · 母题占满 · 每屏一句大字标题 ·
  画面不压 DOM · 逐现象手调）。
- `STANDARD.md` §15 新增**场的三种形态**与那个"静默吞场"的坑 + 两条纪律
  （先判 alpha 再判墨纸；数值只能用来定位，最后一定要打开看一眼）。

## 1.3.0 — 2026-10-11
- `pheno.js` 新增 **`sandChladniPoints`**（01 沙粒版：3200 颗 · 200 快照 · 12 子步，参数与坑照 lab-field4 抄）。
- `gallery.html`：**现象画廊**（九项现场渲染 + 实时判据 M1/M2/M3 分开报 + 映射 A/B + 1:1 放大镜）。

## 1.2.0 — 2026-10-11
- `dotink.js` 新增**逐帧点列通道** `pointsAt`（粒子/沙粒类装置用；网格会丢掉颗粒感）。

## 1.1.0 — 2026-10-11
- `pheno.js`：**自然现象场库**八个（chladni / sunflower / deJong / grayScott / dla / kuramoto /
  bifurcation / interference），统一签名 `(cols, rows, opts) → (i,x,y,t) → 0..1`。
- `icon.svg` + `icon-*.png` + `icon.html` + `tools/make-icon.mjs`：**品牌图标**
  （几何即 §3/§4 的一次应用；四档 PNG 全 0 灰阶）。
- `media/phenomena-8/`：参考配方成片 + 八张 1:1 静帧 + 接触印样 + `SOURCE.md` + `MANIFEST.sha256`
  （逐字节取自主库里程碑）。

## 1.0.0 — 2026-10-10
- 首个版本：`STANDARD.md`（判据唯一真相）+ `dotink.js`（参考实现）+ `preview.html`（判据计算器）
  + `demo/index.html`（自包含独立短片）+ `SKILL.md` + `LICENSE`(MIT) + `NOTICE.md`。
