# ④ 场转场：视觉 / 动效 / API 接入规范

> 实现：[`transition.js`](../transition.js)（零依赖经典脚本，挂 `DotInk.transition`）·
> 演示：[`transition.html`](../transition.html) · 自查：[`check/transition.mjs`](../check/transition.mjs)。
> 判据仍以 [`STANDARD.md`](../STANDARD.md) 为准；本页只规定"两张场之间怎么换"。

---

## 1 · 是什么，不是什么

**是**：同一张网格（`cols×rows` 相同）、同一种调子编码的两张场 A、B 之间的替换。
画面是进度 `p ∈ [0,1]` 的纯函数：

| 模式 | 次序从哪来 | 参数 |
|---|---|---|
| `wipe` 定向擦除 | 格心在方向向量上的投影，归一到 [0,1] | `angle`（度；0 = 左→右，90 = 上→下，屏幕 y 向下） |
| `radial` 径向揭示 | 格心到圆心的距离 ÷ 最远格距离（格是正方形，格坐标里的圆就是真圆） | `cx` `cy`（0..1 归一）、`invert`（由外向内） |
| `dissolve` 种子溶解 | 无状态整数哈希给每**块**一个键，按键排名后**等间距**分配进度 | `seed`（uint32）、`grain`（块边长，格） |
| `tone` 按墨量显影 | 依据场每格的**墨面积**（按编码换算，见 §4.1）排名；默认墨多的先换 = **先暗后亮** | `by`（`'to'` 依据 B，默认 / `'from'` 依据 A）、`invert`（先亮后暗）、`seed`（同墨量打散） |
| `mask` 遮罩揭示 | 每格到遮罩轮廓的**带符号距离**（内负外正）排名：骨架 → 长满字形 → 沿等距线向外 | `mask`（必填，见 §4.2）、`invert`（从四周向轮廓收拢，字形最后合上）、`seed` |

共同参数：`edge`（过渡带宽，进度单位 0..1）、`blend`（`'select'` | `'mix'`）、`encoding`（`'coverage'` | `'calibrated'`）。
五种模式**只差"每格次序 m 从哪来"**；进度、缓动、`edge` 抖动、`select`/`mix`、端点分支、`renderHints` 全部共用同一条路径。

**不是**（不要重复造，也不要混用名字）：

| 已有 | 做什么 | 与转场的区别 |
|---|---|---|
| `markplate` 的 `morph` | 两个厂标**距离场**按 `sstep(morph)` 插值 → 字的大小在融，形状在变 | 转场**从不插形状**；`mode: 'morph'` 会被拒绝 |
| `markplate` 的 `reveal` | 阅读波按**字序**扫过，`v *= sstep(…)` —— 墨从**纸**上浮出来 | 转场**不经过白纸**：A 的墨直接被 B 的墨替换；也没有"字序"这种次序 |
| 把 logo 盖在画面上 | 叠加层，logo 只是多出来的一层墨 | `mask` 里轮廓**决定每格何时从 A 换成 B**；遮罩本身不落墨，B 里有没有 logo 由 B 决定 |
| 整图淡入 | 所有格同时变浓 | `tone` 是**有先后**的：同一时刻有的格已是 B、有的还是 A，暗部先"显"出来 |

---

## 2 · 视觉规范

1. **只动格子值，不动镜头**（§6）：前沿、圆、溶解颗粒全部是"哪一格此刻取 A 还是 B"，画布不平移、不缩放。
2. **默认逐格选取（`blend: 'select'`）**：任意 `p`，每一格的值**恰好等于** `A[i]` 或 `B[i]`。
   不引入新调子 → 不存在"中间调该怎么编码"的问题；带内的柔和感来自**带种子的翻转时刻**
   （带内每格在 `sw = (m + edge·j)/(1+edge)` 处翻，`j` 是该格的种子抖动），读起来像一道网点渐变。
3. **场域混合（`blend: 'mix'`）是可选的**：只在带内对**场值**线性插值 `a + (b−a)·s`，
   在场里插、不在半径里插。前提是 A/B **同编码**（§4）；带外仍是 A 或 B 原值。
4. **过渡带宽**：`wipe` / `radial` 推荐 `0.08–0.20`（窄于 0.05 读成硬边锯齿，宽于 0.35 读成溶解）；
   `dissolve` 的 `edge` 只把排名再摊开，`select` 下看不出区别；`dissolve + mix + edge` 才是"每颗点慢慢长"的溶解。
5. **颗粒**：`grain 1` 是逐格溶解；`grain ≥ 4` 读成"块面翻牌"。8px 点距下 `grain ≤ 3` 仍读作点。
5a. **显影（tone）**：配 `blend: 'mix'` + `edge 0.2–0.35` 最像显影 —— 暗部先浮出、带内每颗点渐长；
   `select` 下读作"按调子分层翻牌"。依据场选 B（默认）= 目标画面的暗部先出现；选 A = 源画面的暗部先褪掉。
5b. **遮罩（mask）**：形内 / 形外**分段**分配进度：形内拿 `clamp(形内面积占比, 0.3, 0.6)`，
   保证字形先完整长出、停留可辨，再沿轮廓的等距线外扩（实拍过不分段的版本：字形只占几个百分点，0.45 时已被外扩圆团吞掉）。
   `edge 0.06–0.12` 前沿最像轮廓；太宽前沿会糊成点雾。
5c. **节奏**：两者都把进度按"65% 格数均分 + 35% 键值差（单个空档封顶 1/32）"分配 ——
   二值图（墨量只有 0/1）不会在中间停一大段，连续调保留"调子决定快慢"。自查钉住：任意 1% 进度内换的格 ≤ 2.5%，最长停顿 ≤ 3%。
6. **1-bit 不变**：转场输出仍走 `render.js` 的 `compose()`，画布只有墨与纸（自查里 `p = 0.5` 也读回画布数灰阶）。
   画布周围的 DOM 控件可以抗锯齿、可以用 `--mute` / `--hair`：**两色只约束艺术画布**。
   但控件**不许压在画布上**（逐帧渲染会把反锯齿拍进帧，§7-1 / §9-8）。

## 3 · 动效规范

| 项 | 规定 | 为什么 |
|---|---|---|
| 进度 | `p ∈ [0,1]`；`p ≤ 0`（含 NaN）→ A，`p ≥ 1` → B，**走分支**，不靠浮点凑 | 端点要逐字节等于源场（自查用 SHA256 比） |
| 时长 | 交互演示 0.4–4 s（默认 1.6 s）；成片里一次转场 ≥ 0.6 s | 短于 0.4 s 读成硬切；格子还没翻完就结束 |
| 缓动 | 缓动只映射进度：`p = ease(u)`；内置 `linear` / `inOut`（三次），端点精确 | 次序表与缓动无关 → 换缓动不改格序 |
| 倒放 / seek | 输出只取决于 `p`，没有内部播放状态；倒放 = 让 `p` 往回走 | 自查：乱序 seek 120 次、正放到底再倒放回 0，逐字节一致 |
| 运动模糊 | `shutter` **必须 0**（`renderHints` 已给） | 快门把 `p±δ` 两个状态取并集：`p=0` 时会漏出 B，端点不再严格 |
| 播放循环 | 全页一个 rAF 句柄；开新的前先停旧的；播放中换模式/参数只换转场对象，不重启循环 | "切换不叠加动画"（演示页 `__tr.dbg.maxInflight` 恒 ≤ 1） |
| 减少动效 | `prefers-reduced-motion: reduce` 时"播放"**直接落到终点**，不演过程；拖动、逐步照常（是用户自己在动） | 系统设置运行中切换也跟上 |
| 键盘 | `Space` 播放/暂停 · `←/→` 1%（Shift 10%）· `Home/End` · `R` 反向 · 数字键切模式 | 焦点在表单控件上时让给控件（滑块自己吃方向键） |

---

## 4 · 调子编码：转场里**不许**再套 gamma

§3 的配对规则落到转场：

| `encoding` | 场是什么 | `renderHints.areaMap` | 典型来源 |
|---|---|---|---|
| `'coverage'`（默认） | 覆盖率 / 密度**原样** | `true`（`r = rMax·√w`） | `fields.ramp / noise / sdf`、`fromImageData(…, {gamma:1, gain:1})` |
| `'calibrated'` | 已做感知标定（场自带 γ） | `false`（`r = rMax·w`） | `pheno.js`（γ 0.5–0.6）、**`fromImageData` 默认参数（γ 0.45 / ×1.6）** |

- `renderHints` 恒为 `{ areaMap, gamma: 1, gain: 1, shutter: 0 }`：γ 只许记在**一头**（场上或半径上）。
- ⚠ **`fromImageData` 的默认值就是"已标定"**：`cov^0.45 × 1.6`。再配 `render` 的默认 `areaMap: true`，
  等于有效指数 0.225 + 增益饱和 —— **双重校正**，画面偏重偏糊。要用 √ 就显式传 `{gamma: 1, gain: 1}`。
- A、B 两张场必须**同编码**。`transition.js` 无法从数组里看出编码，所以由调用方声明一次 `encoding`；
  演示页切换编码时两张图案**一起**按同一编码重建。
- 编码等价性（自查里钉住的）：覆盖率 `v` 走 `√` 与标定后 `v^0.5` 走线性，半径逐值相同；
  标定场再走 `√` 一定更重。

### 4.1 `tone` 的墨量怎么算（只换算一次）

| `encoding` | 场值 `v` 是什么 | 半径 | 落墨面积 ∝ | 次序用的墨量 |
|---|---|---|---|---|
| `coverage` | 覆盖率原样 | `rMax·√v` | `v` | `v` |
| `calibrated` | 带 γ 的值 | `rMax·v` | `v²` | `v²` |

所以**同一张画**的 coverage 版（`v`）与 calibrated 版（`√v`）次序与节奏逐格相同（自查钉住）；
把 calibrated 场当 coverage 用（= γ 记两次）次序就会变 —— 这正是要拦的错。活场（函数源）按 `t = 0` 取一次墨量。

### 4.2 `mask` 收什么

| 形态 | 例子 | 怎么算距离 |
|---|---|---|
| 距离函数 `(x, y) → 带符号格距`（内负外正） | 就是 `fields.sdf(cols, rows, shape)` 的那个 `shape` | 在格心 `(x+.5, y+.5)` 直接取值（解析、平滑） |
| 覆盖率数组（长度 = `cols×rows`，≥ 0.5 为形内） / `{v: 数组}` | `fields.sdf(...)` 的输出、`fromImageData` 栅格的字形或厂标 | 网格上的精确欧氏距离变换（Felzenszwalb–Huttenlocher，O(n)），轮廓两侧各差半格 |

遮罩**与编码无关**：只看形内 / 形外与距离，不读调子。演示页的遮罩全部来自仓库已有素材：
页面同一套字形栅格、[`marks.js`](../marks.js) 的厂标路径、一个 `fields.sdf` 口径的圆环距离函数 —— 没有新字体、新图片或依赖。

### 4.3 边界（明确、不报错）

| 情形 | 行为 | `tr.info.fallback` |
|---|---|---|
| `tone` 依据场墨量处处相同 | 键全平 → 按种子次序（= `dissolve` 逐格） | `'flat'` |
| `mask` 遮罩为空（没有一格 ≥ 0.5） | 同上 | `'empty-mask'` |
| `mask` 遮罩铺满 | 同上 | `'full-mask'` |
| `mask` 距离函数返回常数 | 同上 | `'flat'` |
| 缺 `mask` / 长度不对 / 函数返回 NaN / 未知 `by` | **抛错** | — |

所有退化情形端点仍逐字节是 A / B；演示页把 fallback 文案显示在参数面板里。

---

## 5 · API

```html
<script src="fields.js"></script>
<script src="render.js"></script>
<script src="judge.js"></script>
<script src="host.js"></script>
<script src="dotink.js"></script>
<script src="transition.js"></script>   <!-- 不依赖 dotink.js，放前放后都行；不改汇总入口 -->
<script>
const cols = 160, rows = 90;
const A = DotInk.fields.noise(cols, rows, { seed: 3 });
const B = DotInk.fields.ramp(cols, rows);
const tr = DotInk.transition.create({
  cols, rows, from: A, to: B,
  mode: 'wipe', angle: 30, edge: 0.12,        // 或 'radial' {cx,cy,invert} / 'dissolve' {seed,grain}
  blend: 'select', encoding: 'coverage',
});
// 按墨量显影：B 的暗部先出，带内每颗点渐长
const dev = DotInk.transition.create({ cols, rows, from: A, to: B, mode: 'tone', by: 'to', blend: 'mix', edge: 0.3 });
// 遮罩揭示：从圆环轮廓长出去（mask 就是 fields.sdf 用的 shape；也可传覆盖率数组）
const ring = (x, y) => Math.abs(Math.hypot(x - cols / 2, y - rows / 2) - rows * 0.3) - 6;
const grow = DotInk.transition.create({ cols, rows, from: A, to: B, mode: 'mask', mask: ring, edge: 0.08 });
const inst = DotInk.create({
  canvas, cssW: 1280, cssH: 720, scale: devicePixelRatio, cols, rows,
  field: tr.field(),                           // 默认：draw(t) 的 t 就是进度 p
  ...tr.renderHints,                           // areaMap 跟编码配对 · gamma 1 · shutter 0
});
inst.draw(DotInk.transition.ease.inOut(u));   // u 是你的时间轴进度 0..1
</script>
```

`create(opts)` → 冻结对象：

| 成员 | 说明 |
|---|---|
| `value(i, p, x, y, t)` | 单格值（热路径）。源是函数时 `x, y, t` 原样传给源 |
| `at(p, out?, t?)` | 整张场：写进 `out`（长度必须 = `n`，且不能与任一源数组的字节区间重叠）或新 `Float32Array`；同一 buffer 内不重叠的视图可复用；**永不返回源数组本身** |
| `field(pOf?)` | 给 `DotInk.create` 的 `(i,x,y,t)`。默认 `p = t`；源是活场时传 `pOf(t)`，源仍拿到墙钟 `t` |
| `countB(p)` | 已换成 B 的格数（select 口径；mix 按 `s ≥ 1` 计） |
| `renderHints` | `{ areaMap, gamma: 1, gain: 1, shutter: 0 }` |
| `params` | 规整后的参数（角度取模、`edge` 夹到 0..1、`seed` 转 uint32、`grain` 夹到 1..64、`by`、`mask` 记为 `'function'`/`'array'`/`null`） |
| `info` | `{ fallback }`：`null` 或 `'flat'` / `'empty-mask'` / `'full-mask'`（§4.3） |
| `switchMap()` | select 切换点表的拷贝（可视化 / 调试） |
| `orderMap()` | 基准次序 `m` 的拷贝（`edge` 抖动之前） |
| `cols` `rows` `n` `mode` `blend` `encoding` | 读回 |

校验（抛错，不静默）：`cols/rows` 非正整数、源长度 ≠ `cols×rows`（不同网格）、源是普通数组、
未知 `mode` / `blend` / `encoding` / `by`；`mode: 'mask'` 缺遮罩、遮罩长度不对、距离函数返回 NaN。
非 `mask` 模式传了 `mask` 会被忽略（`params.mask === null`）。

### 5.1 接到已有页面 / 产线的几条

- **静态场**直接传 `Float32Array`；**活场**（`pheno.*`、`interferenceFn`）传函数，并用 `field(pOf)` 把墙钟 `t` 映射成进度。
- **成片**（`host.js` 契约）：`__seek(t)` 里调 `inst.draw(t)`，`field: tr.field(t => (t - t0) / dur)` —— 同 t 两次逐像素一致。
- **typefield 产线**（§13）：`fieldAt: { fn: tr.field(pOf) }` —— 转场对象只产场，不出画。
- **换图案 / 换模式**：重建 `tr`；渲染实例的场函数读"当前 tr"即可，不必重建实例（缓冲随 backing 走，只在尺寸/编码变时重建）。
- **性能**：`create` 是 O(n)（dissolve / tone / mask 多一次 O(n log n) 排序，mask 数组再加一次 O(n) 距离变换）；`value` 是一次比较 + 一次读。
  演示页 117×66 格：tone / mask 的 `create` 都在几毫秒内，换参数只重建 `tr`。
- **npm 子路径**：浏览器按上面的 `<script src>` 顺序引；Node/CJS 用 `require('dotink/transition.js')`，返回值就是 `DotInk.transition`（同进程里 `require('dotink').transition` 也随之可用）。`transition.js` 不进 `dotink.js` 的自动装配，要用就单独引。

---

## 6 · 自查覆盖（`node --test check/transition.mjs`）

端点严格（含越界 / NaN）· 值域（select 下每格恰为 A 或 B）· 确定性（双实例 / 跨 realm / 种子）·
随机 seek 与倒放 · 单调与方向 · 溶解占比精确 · 不改源场（SHA256）· 参数校验 · 编码配对 ·
整条管线（假画布：`draw(0)`/`draw(1)` 与直接画 A/B 逐像素相同，中途 1-bit）· 页面装载顺序。
第二批：上面全部通用测试都已纳入 tone / mask 变体；另加 tone 墨量单调 / `by` / 编码换算等价 / 平键 fallback / 活场取 t=0，
mask 距离单调（EDT 与暴力逐格对账）/ 字形整体先于形外、invert 最后合上 / 距离函数与 `fields.sdf` 同向 / 空与满遮罩 / 抛错 / 遮罩只读，
以及节奏（不集中突变、不长停）。另有共享 buffer 的重叠输出保护与编码原型属性拒绝回归，共 21 项。

**仍然要人看**（§16）：带宽与时长的观感、溶解颗粒读不读作点 —— 开 [`transition.html`](../transition.html) 1:1 看。
