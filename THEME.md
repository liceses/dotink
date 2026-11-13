# 色彩模板（THEME）

> 点墨的**画面**只有墨与纸两色像素 —— 这条不商量（[STANDARD §1](STANDARD.md)）。
> 但**站点界面**是 DOM，它可以有强调色、辅助灰、面板底。
> 这一册管的就是后者：把"哪些颜色"从"写死在十个页面里"变成**一份数据 + 两个生成件**。

- 唯一真源：[`theme/palettes.json`](theme/palettes.json)
- 生成件：[`theme.css`](theme.css)（令牌）· [`theme.js`](theme.js)（切换器 + API）
- 生成器：`node tools/build-theme.mjs`（`--check` 只比对，有漂移 exit 1）
- 验收：`node --test check/theme.mjs`（15 条）· `node --test check/site.mjs`（10 条）

---

## 0 · 三句话

1. **颜色只有一处写**：`palettes.json`。`theme.css` / `theme.js` 是生成件，手改必被 `--check` 打回。
2. **两层令牌各管各的**：`ui.*` 管 DOM（可以抗锯齿、可以有灰）；`canvas.ink` / `canvas.paper` 管画布（必须 1-bit、必须两色）。
3. **换配色 = 换两个三元组 + 重建实例**。核心渲染器一行都不用改 —— `ink` / `paper` 本来就是 `DotInk.create()` 的选项。

---

## 1 · 三层令牌

| 层 | 例子 | 谁能用 | 谁能改 |
|---|---|---|---|
| ① 画布令牌 | `--c-ink` `--c-paper`（`[r,g,b]` 三元组） | 只有 `<canvas>` 里的墨与纸 | **不能**（`original` 逐位等于 STANDARD §1） |
| ② 语义令牌 | `--page` `--panel` `--fg` `--fg-deep` `--fg-mute` `--rule` `--accent` `--accent-fg` `--alert` `--focus` | 站点界面（DOM） | 可以（但必须过 §4 的门禁） |
| ③ 兼容别名 | `--ink` `--paper` `--mute` `--hair` | 老页面的遗留写法 | 指向 ②，别在新代码里用 |

`--ink` / `--paper` 保留成别名，是因为 ink.css 与几个页面早就这么写了；
新写的东西**一律用 ②**，因为 `--ink` 在暗色套里其实是"字色"，不是"墨"。

> **为什么拆 `--accent` 和 `--alert`**：原件那套的橙 `#FF4B1F` 压纸只有 **3.01:1** ——
> 当 10px 小字用是不合规的（正文 AA 要 4.5）。所以：
> `--accent` 只做**装饰与边界**（色块、下划线、focus ring，按 3.0 判），
> `--alert` 才做**文字级强调**（按 4.5 判）。原件里 `--alert` 就是加深过的 `#B23A0D`（5.39:1）。

---

## 2 · 六套配色

| slug | 名称 | 模式 | 性质 | 画布 ink | 画布 paper | 一句话 |
|---|---|---|---|---|---|---|
| `original` | 原件 | light | **standard** | `[12,13,14]` | `[242,243,242]` | 标准即默认 |
| `night` | 夜墨 | dark | edition | `[242,243,242]` | `[12,13,14]` | 纸墨翻转 |
| `newsprint` | 新闻纸 | light | edition | `[23,19,14]` | `[244,239,226]` | 暖纸深褐墨，印刷感最强 |
| `cyanotype` | 蓝晒 | light | edition | `[16,50,63]` | `[233,239,242]` | 冷蓝墨配电锈红 |
| `xerox` | 静电 | light | edition | `[17,17,18]` | `[236,236,234]` | 中性灰配电光蓝，唯一不走暖色的强调 |
| `vermilion` | 朱墨 | light | edition | `[42,36,32]` | `[246,241,231]` | 米纸朱砂 |

**只有 `original` 是 standard。** 其余五套叫 edition：它们改的是墨/纸三元组本身，
所以**不能**拿来验证 STANDARD 的判据（判据全是按 `original` 标的）。这条在
[STANDARD §11](STANDARD.md) 有登记表，在 `palettes.json` 里由 `conformance` 字段表达，
由 `check/theme.mjs` 强制（恰好一套 `standard`，且它必须是 `default`）。

**打印时回落**：`theme.css` 末尾有 `@media print{html[data-theme]{…original 的值…}}`，
选择器权重 `0,1,1` 高于主题块 `0,1,0` —— 打印永远出原件，不跟着屏幕走。

---

## 3 · 怎么用

### 3.1 页面里

```html
<link rel="stylesheet" href="theme.css">   <!-- 必须在 ink.css 之前 -->
<link rel="stylesheet" href="ink.css">
<script src="theme.js"></script>           <!-- 经典脚本，file:// 也能跑 -->
```

`theme.js` 会在 `DOMContentLoaded` 时把切换器挂到 `<div class="theme-switch" data-theme-switch></div>`
（没有这个容器就跳过）；用户的选择存 `localStorage['dotink.theme']`，
没选过则跟随 `prefers-color-scheme`（暗 → `night`）。

### 3.2 画布里（唯一正确的写法）

```js
const c = DotInkTheme.canvas();                 // { ink:[r,g,b], paper:[r,g,b] }
const inst = DotInk.create({ canvas, /* … */, ink: c.ink, paper: c.paper });
DotInkTheme.onChange(() => rebuild());          // ⚠ 必须重建，不能只改 opts
```

> **为什么必须重建**：`render.js` 在 `create()` 时就把 `ink` / `paper` 收进闭包了
> （`const INK = o.ink, PAPER = o.paper`）。改 `inst.opts.ink` 不会生效 —— 它只影响下一次 `create()`。
> `check/theme.mjs` 会检查每个用 `render.js` 的页面都调了 `DotInkTheme.canvas()`。

### 3.3 自己加一套

```bash
# 1) 往 theme/palettes.json 的 palettes[] 里加一条（conformance 写 edition）
# 2) 重新生成
node tools/build-theme.mjs
# 3) 验收（会先跑八条对比度门禁，不过就 exit 1）
node --test check/theme.mjs
```

必填字段：`slug`（kebab-case）· `name` · `en` · `mode`（light/dark）· `conformance`
（standard/edition）· `note` · `ui`（10 个令牌，全是 `#RRGGBB`）· `canvas`（`ink` / `paper` 各一个 3 元组）。

---

## 4 · 对比度门禁（八条）

| 令牌 | 对谁 | 下限 | 为什么 |
|---|---|---|---|
| `fg` | `page` | 4.5 | 正文 |
| `fgDeep` | `page` | 4.5 | 正文（深一档） |
| `fgMute` | `page` | 4.5 | 辅助文字 |
| `alert` | `page` | 4.5 | 文字级强调 |
| `accentFg` | `accent` | 4.5 | 强调底上的字 |
| `accent` | `page` | 3.0 | 装饰 / UI 边界 |
| `rule` | `page` | 1.2 | 描边（只需可见） |
| `panel` | `page` | 1.02 | 面板底（只需与纸区分） |

六套的实测值（`node -e` 现算，不是手抄）：

| slug | fg | fgDeep | fgMute | alert | accent | accentFg | rule | panel |
|---|---|---|---|---|---|---|---|---|
| original | 17.49 | 13.69 | 5.82 | 5.39 | 3.01 | 5.82 | 1.32 | 1.12 |
| night | 17.49 | 14.08 | 7.34 | 8.41 | 6.84 | 6.84 | 1.42 | 1.10 |
| newsprint | 16.10 | 12.83 | 6.27 | 5.69 | 5.69 | 5.69 | 1.35 | 1.11 |
| cyanotype | 11.67 | 8.96 | 5.29 | 5.16 | 5.16 | 5.16 | 1.27 | 1.09 |
| xerox | 15.95 | 13.05 | 5.91 | 5.00 | 5.00 | 5.00 | 1.32 | 1.12 |
| vermilion | 13.60 | 11.16 | 5.44 | 5.80 | 5.80 | 5.80 | 1.32 | 1.10 |

> `original` 的 `accent` 3.01 是**故意压线**的：它是标准件里的橙，改深就不是那个橙了。
> 所以它只准当装饰用 —— 文字级强调走 `--alert`（5.39）。

---

## 5 · 禁令（由测试强制）

| 禁令 | 谁在管 | 违反会长什么样 |
|---|---|---|
| 页面 `<style>` / `style=""` 里不许写 hex 或 `rgba(数字` | `check/theme.mjs` | 换套后某处还是白的/还是原来的橙 |
| `theme.css` 必须在 `ink.css` 之前 | 同上 | 令牌被 ink.css 里的老值盖掉 |
| 用 `render.js` 的页面必须调 `DotInkTheme.canvas()` | 同上 | 画布不跟主题（DOM 换了、画面没换） |
| 生成件不许手改 | 同上（零漂移） | 下次 `build-theme` 把改动冲掉 |
| `theme.js` 不许 import / export / fetch | 同上 | `file://` 打开直接白屏 |

豁免清单（每条都有理由，写在测试注释里）：
`icon.html`（品牌图标是标准自身的应用，色值必须锁死）·
`press.html`（多版套印的 inks 是作品美术，另有一套 P1–P4 判据）·
`demo/index.html`（"最小接入"示例，装了主题就不最小了）·
`tools/press-reel.html`（离线出片工具，不出网）。

---

## 6 · 边界（诚实写清）

- **edition 不是标准。** 六套都仍是两色零灰阶，但只有 `original` 的判据经过标定。
- **画布跟随主题是 D1 的决定，代价是"1:1 判据"要在对应套下重看。** 例：`night` 套里
  墨是 `[242,243,242]`，于是任何"用亮度阈值判墨/纸"的代码都会整体反过来。这个坑在**三处**都踩过：
  `render.js` 的 `toMask()`（`PX[i] < 128` → 整帧翻转）、`fields.js` 的 `fromImageData()`
  （`lum < thr` → 覆盖率场反相，marks 的 23.20% 变成 54.04%）、`marks-type.html` 的判据读数
  （`r < 128` → 墨纸都数成灰阶，报 bad）。现在统一的规则是**按调色板判，不按亮度判**：
  画布掩膜比对 INK/PAPER 的精确值，栅格图按"离哪个颜色更近"归边，读数逐通道比（容差 2）。
  `check/core.mjs` 有两条回归测试盯着这件事（深色画布的覆盖率必须与浅色逐格相等）。
- **主题色不是无障碍的全部。** 八条门禁管的是对比度；焦点可见性只保证了 `:focus-visible` 有描边。
- **切换器依赖 `localStorage`。** 被禁用时 `theme.js` 会退化成"每次打开都跟随系统"，不报错也不记忆。
