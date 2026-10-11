---
name: dotink
description: 点墨（Dot Ink）—— 1-bit 成像标准：画面只有墨与纸两种像素，所有中间调由点的面积表达。用户要做「点墨 / 网点 / 半调 / 1-bit 图 / 传真感 / 印刷感 / 点阵画 / 用点把一张图或一段字画出来」，或提到点距、点径、覆盖率、墨量、装饰墨/信息墨、净空、抖动(dither)、Floyd–Steinberg、Bayer，或要求"把某张图/某句话变成点阵"时，落点就是这里。
whenToUse: 需要点墨/网点/半调/1-bit 质感的画面；或要判一套点阵画面是否成立（点读不读得成点、覆盖够不够、墨量分配是否失衡）。**判据唯一真相在 STANDARD.md**；实现是 dotink.js；判据计算器是 preview.html。
---

# 点墨 · AI 入口（先读这一页，再动手）

> **一句话**：画面只有**墨**与**纸**两种像素；所有中间调由**点的面积**表达。
> 调子 = 墨量，墨量 = 点面积之和。这不是"加个纹理"，是一套**成像方式**。

## 0 · 三处只读

| 读什么 | 为什么 |
|---|---|
| [`STANDARD.md`](STANDARD.md) | **判据唯一真相**：令牌 / 三个几何量 / 面积映射 / 两种模式 / 净空 / 动 / 禁令 / 自查表；**§13 = 与 typefield 的分工**（产线里场归 dotink、画面归 typefield） |
| [`README.md`](README.md) | 最小用法、参数表、示例片（8 个自然现象 + 判据幕）与视频 |
| [`pheno.js`](pheno.js) | **自然现象场库**八个：`chladni / sunflower / deJong / grayScott / dla / kuramoto / bifurcation / interference`，统一 `(cols, rows, opts) → (i,x,y,t) → 0..1` |
| [`preview.html`](preview.html) | 判据计算器 + 参数实验台（双击即开），带 **1:1 放大镜** |

## 0.5 · 在产线里怎么落（优先这条）

**不要让 dotink 自己出画**：把场喂给 `modules/typefield`，**用它自己的 HUD/相机**——
`text: '●'` 让它成为点墨渲染器：

```js
TypeField.create({
  canvas, cssW: 1280, cssH: 720, scale: 1.5,
  cell: 8, cols: 160, rows: 90,                               // ★ 8px 点距（参考配方）；不是 16px
  text: '●',                                                 // 逐格字形 = 实心圆
  fieldAt: { fn: DotInk.pheno.chladni(160, 90, { period: 16 }), min: 0.08 },
  hud: true, hudC: { ruleY: 40, progY: 690, tcY: 12 },       // 它自带的尺/进度/时间码
  camAt: t => ({ eye: [0, 0, 1620], tgt: [0, 0, 0], up: [0, 1, 0] }),
});
```

`fieldAt` 是给 typefield 加的**加法式**钩子（不传 = 行为逐字节不变，已用同帧 SHA256 验证）。
`dotink.js` 只在需要**自包含**时用（它的 HUD 与 typefield 同规格同源）。

> ⚠ 加载顺序：`dotink.js` → `pheno.js`。**八个 phenomena 实例不要同时活着**：
> 每个 1920×1080 实例约占 16MB 缓冲，八个会把浏览器拖到 30s/帧 —— 懒建 + 换幕即释放
> （见 `work/1010-dotink-demo/content.html` 的 `phenAt` / `dropPhen`）。

> **要"好看"就照 §14 的参考配方**（对标件：`lab-field4`《公式就是画面》八拍，媒体在
> [`media/phenomena-8/`](media/phenomena-8)）：**点距 8px**（细条纹 6px）· 点径 0..3.2px
> **真圆盘**（`maxFrac 0.40`）· **母题占满画面**（先定母题再定网格）· 每屏**一句大字标题** ·
> 画面区域**不压 DOM** · **逐现象手调**。
> 同一批公式，两版的格数是 **14,400 vs 3,600** —— 差距就在这几个数上。

## 1 · 最小用法

```html
<canvas id="cv" style="width:560px;height:315px"></canvas>
<script src="dotink.js"></script>      <!-- 经典脚本，不是 ESM（file:// 下 import 会被 CORS 拦死） -->
<script>
const inst = DotInk.create({
  canvas: document.getElementById('cv'),
  cssW: 560, cssH: 315, scale: 1.5,     // 实际 backing = 840×473
  cell: 12,                             // 点距（px）
  field: DotInk.fields.interferenceFn(46, 26, { k: .55, w: .22, speed: 1.3 }),
  gain: 1, duration: 21, shutter: 0,
});
inst.draw(3.5);                          // 纯函数：同一个 t 画两次逐像素一致
inst.judge();                            // 判据一次报全（别自己心算）
</script>
```

## 2 · 八条判据（细节与出处见 STANDARD.md）

| # | 判据 | 门限 |
|---|---|---|
| 1 | **面积映射** | `r = rMax·√w`（**不是**线性；线性让中间调偏亮） |
| 2 | 点径上限 | `maxFrac ≤ 0.5` → 点径 ≤ 点距 |
| 3 | M1 网点：点距 : 点径（中位） | **≥ 3 : 1** |
| 4 | M2 面场：区域覆盖率 | **≥ 8%**（地板 2%，天花板 55%） |
| 5 | 净空：装饰墨 : 信息墨 | **≤ 1 : 1**（目标 ≤ 0.33 : 1） |
| 6 | 归一化活动率 | 每帧变化像素 ÷ 该帧墨面积；镜头不动时**格子值必须在翻** |
| 7 | 1-bit | 无灰阶；**字是实墨，不过网屏** |
| 8 | 签字方式 | 数值只用来定位，**必须打开 1:1 看一眼** |

## 3 · 四条最容易踩的（都有人付过代价）

1. **整帧总墨量不算数** —— 它会把"一块看不见的纹理"算成"在渲染"。要量**区域覆盖率**。
2. **装饰墨会悄悄压过信息墨** —— 尺子/读数/纸底纹理都算装饰；实测反例 19.4% vs 11.84% = **1.65:1 ✗**。
3. **镜头挪动不等于动** —— 漂移 ±4px、推镜每帧 1px 都翻不动格子值；动只能来自"格子值在翻"。
4. **"能出墨"不等于"看得见"** —— 曾经用"画布有没有墨"验过两轮全过（47/47），页面肉眼是空的（纸底噪贡献了几万墨点）。

## 4 · 量测（要数字，不要感觉）

```powershell
# 逐帧墨面积 + 相邻帧相对变化 + D(t) 硬切探测（主库工具）
python lab/tools/ink-area.py --frames <帧目录> --fps 30 --step 3
# 可读性：缩到 960/640 的墨存活率、≤2/≤4px 碎片占比
python lab/tools/measure/legibility.py --frames <帧目录>
# 墨预算：尺子 / 墨洗带 / 内容 / 纸底 四分区
python lab/tools/measure/ink-budget.py --frames <帧目录>
```

或直接 `preview.html`：它把 §2 的判据实时算在页面上，并且带 **1:1 放大镜**。

## 5 · 边界

- 本标准只管**纸+墨两色**的 1-bit 成像；彩色/多色网点（`lab/tools/halftone/press.html` 四色各一角度）**未纳入**。
- 抖动（Floyd–Steinberg / Bayer）是合法第三档，但会破坏"点距:点径"的整齐 → 判据改为 1:1 目视 + 覆盖率。
- 判据的数字来源见 STANDARD.md §12 的出处索引；**标了"待标定"的阈值不要当硬门禁用**。
