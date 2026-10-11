# ③ 点墨的字符 logo 系统

> 三样东西：**字版厂标**（字拼成标）· **点墨版厂标墙**（用点画）· **即插即用的 logo 组件**（挂到任意视频）。
> 最小可跑示例：[`logo-demo.html`](../logo-demo.html) · [`marks-type.html`](../marks-type.html) · [`marks.html`](../marks.html)。

---

## 厂标墙 · 47 家（**第二件产品**）

<img src="../media/marks.png" width="620" alt="厂标墙：47 家厂标用点墨画">

> 双击 [`marks.html`](../marks.html) 就开：47 家厂标（OpenAI · Anthropic · GitHub · Python · React …）
> **全部用点墨画**，两种落墨随时切。

| 落墨 | 做法 | 什么时候用 |
|---|---|---|
| **网点（调幅）** | 厂标 → 覆盖率场（`fields.fromImageData`：先二值化再算每格深色占比）→ 每格一份墨；场自带 gamma(0.45)，所以半径走**线性**（§3 配对规则） | 要"印刷感" |
| **实墨（1-bit 剪影）** | 路径按 **50% 阈值**切硬像素、零反锯齿 | 要"识别"；小尺寸反而更清楚 |

- 大图 8px 点距（70×70 格）+ **47 格墙** + `← →` 换家 + 空格播放（**0.8s/家 → 一遍 47 家 = 37.6s**，与实验区 `lab-field22` 同节奏）+ 1:1 放大镜
- **实测**：47 家**全部 0 灰阶**；覆盖率 20–38%（厂标是细笔画，落在 M2 面场）
- **版权口径**：路径数据来自 [simple-icons](https://github.com/simple-icons/simple-icons)（**CC0 1.0**），商标归各家、本包用于**指称** —— 详见 [`NOTICE.md`](../NOTICE.md)
- 数据生成：[`tools/make-marks.mjs`](../tools/make-marks.mjs)（从主库 `modules/markplate/icons.js` 只抽 key/title/d）

> 这一页还**逼出了包内核的一个静默 bug** 并修掉：`field` 直接传 `Float32Array` 时，
> 旧的检测写法把数组判成布尔 `true` → 场被吞、一帧 0 个点、**不报错**（厂标墙 47 格全空才暴露）。
> 详见 [`STANDARD.md`](../STANDARD.md) §15。

## 字版厂标 · 47 家（**移植自主库 markplate**）

<img src="../media/marks-type.png" width="620" alt="字版厂标：字拼成标 + 阅读波浮现">

> 双击 [`marks-type.html`](../marks-type.html) 就开：**厂标是用「字」拼出来的** —— 每格一个字，
> 字的大小按厂标的距离场走；**「阅读波」(`reveal`) 扫过时，字逐格浮现**。

- 引擎 [`markplate.js`](../markplate.js) 是**从主库 `modules/markplate/markplate.js` 逐字节移植**的
  （正文 sha256 与上游一致，只在最上面加了出处头；重跑 [`tools/vendor-markplate.mjs`](../tools/vendor-markplate.mjs) 可再取）
- 配置**照抄实验区 `lab-field22`《四十七家厂标》**：47 家 · `actSeconds 0.8`（一家 0.8s → 一遍 **37.6s**）· `zoom [0.98, 1.12]`
- 页面能调：**阅读波 `reveal`**（热改 `mp.opts.reveal`，0.15–3.0s）· 时间轴 · 47 格跳转 · `← →` · 空格
- **实测**：47 家全部 **0 灰阶**；墨 5.7–22%；单帧 10–45 ms（首帧含距离场烘焙 82 ms）
- 同一批厂标的**点墨版**（网点 / 1-bit 剪影）在 [`marks.html`](../marks.html) —— 两条路做同一件事：**用点** 还是 **用字**

**这个效果怎么做出来的（五步）**：

| 步 | 做什么 | 参数 |
|---|---|---|
| ① **字版** | 每格放一个字 | `cell 24 · cols 52 · rows 25`；**字要比格距大**（`textPx 26–44`）才咬得住、成墨块 |
| ② **形** | 厂标路径烘成**距离场** | `markPx 700`（分辨率）· `markSize`（标在设计空间多大，**两者必须能分开**） |
| ③ **收束** | 一幕里把字的大小/高度混到标上 → **字自己拼成标** | `morph [0.34, 0.90]`（幕内进度） |
| ④ **浮现** | `reveal` = **阅读波扫完的秒数**：波扫到哪一格，哪一格的**格子值才翻一次**（所以自带"慢"，不闪） | `reveal 1.0s`（本页可热调） |
| ⑤ **动** | 只有 `ripple`（格子值翻转）+ `zoom`（推镜）—— **不能把一张静态图挪一挪** | `ripple {amp 13, len .34, speed 4.4}` · `zoom [0.98, 1.12]` |

> 下层还叠了「名字（实墨点阵）+ 尺与读数」两层，`caption: false` / `hud: false` 可整层关掉（做目录小样时用）。

## 字版 logo 组件 · 即插即用（**挂到任意视频上**）

<img src="../media/logo-demo.png" width="620" alt="字版 logo 组件挂在视频上">

> **三行引脚本 + 一次 `mount`**，就能把「**字拼成的标 + 阅读波浮现 + 字不断浮动**」挂到**任意视频 / 网页**上。
> [`logo-demo.html`](../logo-demo.html) 是证明页 —— 它挂的就是一个普通 mp4（换成你自己的就行）。

```html
<script src="../markplate.js"></script><script src="../marks.js"></script><script src="../logo.js"></script>
<script>
DotInkLogo.mount(document.querySelector('.host'), {
  slug: 'openai',   // 内置 47 家；或 d:'M12 2 …'（自备 SVG path）/ svg-src="../my.svg"（自备文件）
  size: 0.14,       // 占容器宽 14%
  corner: 'br',     // tl / tr / bl / br / center
  reveal: 1.2,      // 阅读波浮现的秒数
});
</script>
```

或声明式：`<dot-ink-logo slug="openai" size="14%" corner="br" reveal="1.2">` + `DotInkLogo.defineElement()`。

| 能调 | 说明 |
|---|---|
| `slug` · `d` · `svg-src` | 内置 47 家 · 自备 SVG path · 自备 `.svg`（多段 `<path>` 自动合并） |
| `size` · `corner` · `margin` | 占容器宽的比例 · 九宫位置 · 边距（也按容器宽算） |
| `reveal` · `rippleSpeed` · `rippleAmp` | 浮现快慢 · **浮动快慢** · 浮动幅度 |
| `caption` · `hud` | 名字（实墨点阵）· 尺 / 进度 / 时间码 |
| `fps` · `dpr` · `smooth` · `blend` · `paused` | 重绘上限 · 像素密度 · 平滑缩放 · 混合模式 · 起手暂停 |
| API | `set` · `pause` · `resume` · `toggle` · `seek` · `layout` · `info` · `destroy` |

**实测**（挂在 1920×1080 视频上）：覆盖层单帧 **1.9–3.7 ms**（24 fps 上限下 5 秒 118 帧）·
重挂后画布数**始终 1**（旧实例会销毁）· 暂停后帧数冻结 ✓ · 无错误。

**四个实现要点**（都踩过）：

1. **白纸 + `multiply`**：纸设成纯白、覆盖层 `mix-blend-mode: multiply` —— 白纸在视频上等于不存在，
   **零逐帧成本**（逐帧抠 2M 像素的 alpha 会白吃十几毫秒）；
2. 引擎 `markplate` **要求 `marks ≥ 2`**（它靠"两个标互融"做过渡）→ 单标就**传同一个标两次**；
3. 覆盖层自带 rAF 循环：**dt 夹到 `[0, 0.1]` + try/catch** —— 首帧时间戳可能早于 `performance.now()`（负）、
   切页回来是大跳；一帧抛错若发生在 `requestAnimationFrame` 之前，播放会**静默死掉**；
4. **裁剪框是"量"出来的，不是"算"出来的**：标外的格子**也会落墨**（引擎给它们画 1–2px 小点），
   所以"有墨范围"是**整个字版**（实测 **1227×604**）；而标本身又比 `markSize·z` 大一圈
   （**字形比格距大、会溢出格子**）→ 按公式算的框会把标**切掉一圈**（第一版就是这样）。
   现在的做法：渲染一帧（等阅读波扫完）→ **按格算墨密度**（字格 8–40% vs 背景点格 0.3–1.5%，
   差一个数量级，能干净分开）→ 得到"字"的真实范围（实测 640×591）→ 加余量 + 漂移余量 →
   **装不下就自动调小 `markSize` 重建**（最多 4 次，实测从 640 收到 576）；
   覆盖层画布**按裁剪框的长宽比**（不是正方形）→ 既不拉伸也不切边。
   > 中途试过 3×3 腐蚀：**分不开** —— 汉字的笔画也只有 2–3px 粗，和背景点一样粗；
   > 那次 `markSize` 被一路缩到 275、最后退回整幅，徽标里塞进了整个字版。

> **下一步（已验证、未实现）**：同一套素材还能走 **ffmpeg 后处理**把标烧进**任意 mp4**
> （实测 61 s / 1080p 只花 **6.8 s**；纸底可用 `colorkey=0xF2F3F2` 一键抠掉，**6.6 s**）。

---
