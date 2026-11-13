# 点墨 · 变更记录

> 版本号跟 [`package.json`](package.json) 走（`dotink.js` 的 `version` 必须与它一致，测试会查）。
> `pheno.js` / `logo.js` / 移植的 `markplate.js` 各有自己的内部版本号，见各自文件头。

## 2.3.0 — 2026-11-13

**新增：六套配色（`theme/`）+ 站点信息架构（`site/`）**

*配色：数据 → 生成件 → 页面*
- 唯一真源 [`theme/palettes.json`](theme/palettes.json)：六套 × （10 个界面令牌 + 画布 `ink`/`paper` 三元组）。
  `original` 是**唯一** `conformance: "standard"`（画布逐位等于 STANDARD §1 的 `[12,13,14]`/`[242,243,242]`），
  其余五套 `edition`：`night`（纸墨翻转，dark）· `newsprint` · `cyanotype` · `xerox` · `vermilion`。
- 生成件 [`theme.css`](theme.css) / [`theme.js`](theme.js)，生成器 `tools/build-theme.mjs`（`--check` 零漂移）。
  `renderJs` 把 `hexToRgb` / `relLum` / `contrast` 的**函数源码**嵌进生成件 —— 页面现算的数与测试判的数同一份代码。
- 三层令牌：① 画布 `--c-ink` / `--c-paper`（三元组，给 `<canvas>`）② 语义 `--page/--panel/--fg/--fg-deep/--fg-mute/--rule/--accent/--accent-fg/--alert/--focus`
  ③ 兼容别名 `--ink/--paper/--mute/--hair`（老写法）。**拆 `--accent` 与 `--alert`**：原件的橙 `#FF4B1F` 压纸只有 **3.01:1**，
  只能当装饰（按 3.0 判），文字级强调走 `--alert` = `#B23A0D`（**5.39:1**）。
- 八条对比度门禁（`fg`/`fgDeep`/`fgMute`/`alert` 对 `page` ≥4.5；`accentFg` 对 `accent` ≥4.5；`accent` 对 `page` ≥3.0；
  `rule` ≥1.2；`panel` ≥1.02），六套全过。生成前先跑门禁，不过就 exit 1。
- 画布接入：`DotInkTheme.canvas()` 取 `{ink,paper}`，`onChange()` 里**重建实例**（`render.js` 在 `create()` 时就把两色收进闭包了）。
  已接：gallery / hero / marks / preview / transition。豁免：`icon.html`（品牌图标必须逐位等于标准）、
  `press.html`（多版 inks 是作品美术）、`demo/index.html`（最小接入）、`tools/press-reel.html`（离线工具）。
- *深色画布暴露出的三处「按亮度判墨」（都修了，都有回归测试）*
- `render.js` 的 `toMask()`：原来 `PX[i] < 128` 判墨 —— `night` 套纸是 `[12,13,14]`（也 <128），
  于是掩膜全 1、整帧被写成墨色（实测 gallery 夜墨下覆盖率虚报 100%）。改成**精确等于 INK** 判墨；
  注意 `toMask` 的语义是「只置 1、不清零」（overlays 只加墨的契约靠这条）。
- `fields.js` 的 `fromImageData()`：新增 `o.ink` / `o.paper`，给了就按**离哪个颜色更近**判墨，
  没给才回落亮度阈值（向后兼容纯黑白栅格的 preview / transition）。原来 marks 的场在 `night` 下整体反相
  （覆盖率 23.20% → 54.04%）。
- `marks-type.html` 的判据读数：`r < 128` 判墨 + 硬编码 `242,243,242` 判纸 → `night` 下墨纸全落进灰阶。
  改成按 `DotInkTheme.canvas()` 逐通道比（容差 2），并给 `MarkPlate.create()` 注入 `ink`/`paper`
  （引擎支持这两个选项，但它是逐字节移植件，只能用不改编）；换套时重建实例并接回「这一家 / 阶段 / 时刻」。
- `marks.html` 的同类修正：常量 `INK`/`PAPER` 与像素循环里的 `12/13/14`、`242/243/242` 全部改读调色板；
  读数改成 `near(d,i,ink)` / `near(d,i,paper)`。
- 回归测试：`check/core.mjs` 新增两条 —— 「深色画布：覆盖率与掩膜跟配色无关」「`fromImageData` 给了 ink/paper 就按最近色判墨」。

*信息架构：一份 nav.json → 每页标记区*
- 唯一真源 [`site/nav.json`](site/nav.json)：**5 分区**（规范 / 现象 / 字符与厂标 / 场转场 / 套印）+ 1 资源（色彩模板），
  每页带 `title` / `desc` / `footNote` / `footLinks`。
- 生成器 `tools/build-site.mjs`：把顶栏 / 副条 / 面包屑 / 页内目录 / 页脚 / `meta description` + `og:*` + `canonical` + `theme-color`
  写进 `<!-- site:* -->` 标记区；顺带给缺 `id` 的 `<h2>` 补 `id="sec-N"`（页内目录**零 JS**）。
- aria 规则：顶栏分区多页时 `aria-current="true"`、精确页由副条标 `"page"`、面包屑末项是普通 `<span>` ——
  **全页恰好一个 `aria-current="page"`**（`check/site.mjs` 强制）。
- 新页：[`spec.html`](spec.html)（规范入口 + 五册 + 三条主判据 + 怎么自己验收）、
  [`theme.html`](theme.html)（六套配色卡 + 8 档网点梯尺 + 门禁矩阵，全部**现算**）。
- `hero.html` 从"手抄 9 项导航"改成装站点外壳（`.hero > .site-head` 覆盖在舞台上），并补 `<main>`；
  顶栏底色改为纸色 + 38px 淡出带（原来是全透明 —— 夜墨态下浅色文字压在浅色网点上直接糊掉）；
  `preview.html` 补 `<main>`；`index.html` 收成跳转壳（只装 `theme.css`）。
- 删掉 8 个页面各自手抄的 `:root` 颜色声明（颜色只剩 `theme.css` 一处）；`ink.css` 里硬编码的
  `rgba(242,243,242,.90)` / `#2A2D2E` / `rgba(255,75,31,.28)` 全部令牌化；
  `icon.html` 的 `code{background:#E4E7E6}` → `var(--panel)`（夜墨态下浅底浅字，实测看不见）。
- 页内目录的标签去掉括注（`键盘（焦点在画布或页面上时）` → `键盘`）：横向跳转条不该被说明性文字撑宽。
- 修 `preview.html` 页脚「标准原文」重复（页级 footLinks 与全站页脚撞了）。

**文档**
- 新册 [`THEME.md`](THEME.md)：三层令牌、六套配色、八条门禁（附六套实测值）、禁令与豁免、边界。
- `STANDARD.md`：§1 加一句「这一层是标准套（`original`），不是唯一一套」并指向 THEME.md；
  §11 加**五套 edition 登记表**（含"不能拿来验证本标准"的理由与"必须仍是两色零灰阶"的硬约束）。
- `README.md`：新增「站点地图（信息架构）」与「六套配色」两节；文件表补 THEME / palettes / 生成件 / 两个生成器 / 两个 check。

**自查**
- `check/theme.mjs`（15 条）：结构 / 恰好一套 standard / 默认套画布逐位 / 六套门禁 / 对比度自反 / 两个生成件零漂移 /
  主题块与别名 / 打印回落 / 无 ESM / **裸色禁令**（页面 `<style>` 与 ink.css 里不许 hex 或 `rgba(数字`）/ 引入顺序 / 画布取色。
- `check/site.mjs`（10 条）：nav 合法 / 文件存在 / 标记成对 / **零漂移** / aria 唯一 / 面包屑 = title / 目录锚点 / 无孤儿页 / meta / `<main>`+`h1`。
- 现状：`npm run check` = **92 test 全过 · 链接 605 条全在 · 两个 `--check` 零漂移**（`scripts.check` 已把 theme/site 与两个生成器都接进去）。
- **换行符钉成 LF**（新增 `.gitattributes`：`* text=auto eol=lf`）：生成件与每页骨架是**逐字节**比对的，
  Windows 上 `core.autocrlf=true` 会把 checkout 出来变成 CRLF —— 实测在全新 worktree 里三条「零漂移」门禁
  当场全红，跟内容一点关系都没有。两个 check 与两个 `--check` 另加 `\r\n → \n` 归一作兜底。

**新增：套印不齐 `press.js`（可选脚本，不进汇总入口）+ 演示页 `press.html`**
- 一张画面分成 **2–8 张版**，每版每格仍只有「有墨/没墨」；颜色靠**减色叠印**查表（透过率相乘，非加色）。
  `paletteOf(inks, paper)` 第 k 项 = 位掩码 k 的叠印色，**`palette[1]` 精确等于单版 ink 色** ——
  单版 + `angle 0` + `shutter 0` 时与 `render.js` 直画**逐字节相同**（实测 1920×1080 diff **0**），是严格超集。
  注意 `angle 45` 的版与单色那张 45° 网屏**不**等价（点阵被旋转）：同帧 **315 723 / 921 600 = 34.26%** 的像素不同
  （旧稿写的 18.2% 是按通道数算的，按像素是 34–35%）。
- 纯函数：`separate(rgba, w, h, cols, rows, {ucr})`（RGB → C/M/Y/K 每格墨量）、`paletteOf`
  `regOf(drift, name, i, t)`、`distinctColors` / `collisionsOf`。分色、调色板、偏移全部确定，无 `Math.random`。
- 版间偏移 `drift: {amp, speed, seed, rot}`：每版相位取 `mulberry32(seed*7919 + i*131)`（**自带的私有实现**，不借全局，装载顺序无关），
  双频正弦叠加 → **同参数同帧**（能出视频、能复现的前提）。实测 `regRot` 峰值 = `rot`、均值 0.887·rot；
  `regPx` 峰值 **0.705–1.238·amp**（6 seed × 4 版 × 601 点）；建议 2–7 px / 6–12 s / 0.2–0.5°。
- **四版不是 16 色**：CMY 叠印（code 7）与 CMYK 叠印（code 15）减色算出来都是纯黑 → 格点集实到 **15** 色
  （`collisions = [[7,15]]`）。三版 CMY **不**碰撞（8 掩码 = 8 色）；六色 Hexachrome 64 → **35 色**（29 对）；
  八色（Hex + 蓝 + 红）256 → **85 色**（171 对）；四色再挂四个灰阶则 1→8 版 = 2/4/8/15/29/57/109/**173** 色。
  版数上限 8（`paletteOf` 抛错，2^8 = 256 掩码已够多）。
- 总墨量：全部版面**物化之后**再统一按比例压回 `tacLimit`（默认 2.4 = 240%）—— 顺序反了就成了「每版各自压」。
  `ucr`（底色去除）默认 0.55；实测四版满墨（`maxFrac .40`）时 tacLimit **不压 / 4 / 2.4 / 1.2 / 0.5 → tac 2.05 / 2.05 / 1.12 / 0.50 / 0.25**，色相不动。
  ⚠ `tacLimit ≥ N` 是空操作（`lim >= N` 直接 `return`）；且它压的是**每格墨量 w 之和**，`measure().tac` 报的是**覆盖率之和** ——
  两个口径差一条 `coverageCurve`，所以 `maxFrac ≳ .54` 时 `tac ≤ tacLimit` 并不成立（口径差，不是 bug）。
- `measure()` 给四条硬判据的原料：`badPixels`（越界像素，`=== 0`）、`tac`、
  `colors ≤ paletteColors`、每版 `cov > 0`；另给 `fringe`（漏色重影占比）与 `platesPerInk`（平均叠版数）。
  `opts` 是活引用（改 `tacLimit` / `drift` 立即生效）；换 `inks` 必须重建实例（`setInks()` 故意抛错）。
- 默认体裁是**准同角度**（四版同 45°，靠 drift 晃开），不是印刷厂的玫瑰斑：异角度在 cell 8 / maxFrac .28–.45 下
  四色点互相错开成彩虹点阵，读起来像「彩纸屑」，图像内容被吃掉（玫瑰斑对齐态 `fringe` 就已 **0.3069**，同角度 **0.0623**）。
  六色反过来：玫瑰斑才是默认（对齐就 35 色 / 64 掩码），准同角度对齐时六版同心塌回 15 色、一错位炸到 0.4536。
- 性能（本机 headless Edge，1280×720 CSS × scale 1.5 = 1920×1080 背板，cell 8 = 160×90 格，只算 `draw(t)`）：
  0 版 6.2–6.5 ｜ 1 版 6.6–7.6 ｜ 2 版 8.9–10.3 ｜ 3 版 10.8–12.5 ｜ **4 版 12.3–14.4（p90 15–18）** ｜ 6 版 18.3–21.0 ｜ 8 版 22.5–23.0 ms；
  1280×720 背板四版 7.7–7.9 ms。单色层对照 `shutter 1/28` 20.1–20.3 / `shutter 0` 13.4 ms（运动模糊要画两帧，四版反而更便宜）。
  同参数跨轮次可差 1.9 倍（四版见过 12.3 / 14.4 / 15.4 / 20.4 / 35.7），拿它当**数量级**不是常数。
  `measure()`（整帧 `getImageData` 读回）另加 **4.8 ms** → 实时预览只 `draw`，量测留给离线导出（0.02–0.03 s/帧）。
  **多色的瓶颈是分色不是绘制**：六色 `separateCov` sweeps 24 约 42 ms、sweeps 30 约 52 ms；`coverageCurve` 18–24 ms 且必须缓存。
- 演示页 `press.html`：三连对照（对齐 / 2.5 px·0.2° / 6 px·0.45°）+ 1:1 放大镜 + amp/speed/rot/cell/maxFrac/ucr/tacLimit 滑杆 +
  实时四条判据读数。

**新增：套印片 `tools/press-reel.html`（片源，逐帧纯函数）+ `tools/press-reel.mjs`（`__reel.frame(t)` → ffmpeg）**
- 17.00 s / 510 帧 @30fps，四段题材各 4.25 s：果物 / 肌肤 / 风景（三张 **CC0 照片**，出处见 `NOTICE.md`）+ 字版（canvas 现画）。
  片源必须是**真实连续调**：手绘侧脸在 183 格宽的点阵里永远是一块色 —— 脸宽约 110 格、鼻梁转折 2–3 格、眼皮 0.6 格、睫毛 0.4 格，
  低于一格的笔画在 1-bit 里不存在（四轮返工全败的记录留在片源页的分片注释里）。
- **照片必须低通**（采样定理，不是审美）：源画布按格定（`SW = COLS·SPX`，`SPX` 默认 6，母版 274×154 格时 1644×924 = 一格 6 源像素），
  细于一格的东西（毛孔 / 发丝 / 叶脉）落进格子只会变成「这一格该是哪个墨」的抖动 → 远看是噪、1:1 是彩色纸屑。
  `PHOTO_BLUR` 默认 **4** 源像素（`ctx.filter = 'blur(Npx)'`）；母版 274 格实测 `fidelity.mean` blur 0 / 2 / 4 / 6 → 果物 25.05 / 24.93 / **24.98** / 25.19、肌肤 27.58 / 27.54 / **27.46** / 27.50、风景 26.35 / 26.10 / **26.16** / 26.34 —— 格均几乎不动（极差 <0.25），保留 4 的理由是**网点更干净**，不是误差更小。
- 版心 `contentH() = SH·(1 − CAP_BAND)` = 0.66·SH，恒为 **2.69:1**，源图 3:2 所以 `u = 1` 只看得见源高 55.7% —— **不能适配整张图**，只能取一条带
  （果物 u .90→.84 / 肌肤 1.00→.93 / 风景 .94→.88，`cx/cy` 见 `docs/05` §10.3）。
- 媒体：`media/press-reel-clip.mp4`（1280×720 · yuv444p · crf 33 · 510 帧 · **7.53 MB**）、`media/press-reel-poster.png`、`media/press-specimen-01..04.png`、
  `media/press-src-{fruit,skin,land}.jpg`（1200×800 / 1200×800 / 1200×676）。母版与 1080p 附件在 `media/_release/`（gitignore，走 Release）。
- 编码口径：`yuv420p` 按 2×2 下采样色度，会把网点边缘一两像素宽的彩边抹掉 —— 实测 `qp0` 解码回与 PNG **逐字节相同**、`qp12` 已有 **13.9%** 像素偏离格点集、
  `crf 18 + yuv420p` 有 **58%** 偏离，所以导出取 `yuv444p`（或 `libx264rgb`）。
- 调试接口 `window.__reel`：`ready`(getter) / `photos()` / `frame(t)` / **`src(t)`**（分色**前**的源画布，把「取景错」与「分色错」分开看）/ `measure()` /
  `fidelity(t)` / `benchParts(n)` / `dur·fps·w·h·cols·rows·inks·sep·angles·mode·scenes·curve`。
- 顺手修掉两个真 bug：`measure()` 在第一帧之前抛 `TypeError: Cannot read properties of null (reading 'amp')`（`lastMeta` 初值改成 `stateAt(0)`）；
  `ready` 改成 getter 之后 `syncReady()` 还在给它赋值，三张图 `onload` 各抛一次 `TypeError: Cannot set property ready … only a getter`（改成由计数器现算）。
  教训同一条：**把状态做成派生值，别做成要人推的缓存。**

**新增：分册 `docs/05-misregistration.md`（套印不齐）**
- 与 `docs/01` / `docs/04` 同一口气：是什么 / 与单色层的关系 / 色彩上限与碰撞表 / 两个网角体裁 /
  偏移模型 / 判据（四条硬判据 + 两个体裁绑定指标）/ 性能边界 / 最小用法 / 反面清单 / 自查覆盖 / 已知瑕疵 / 边界。
- 写进两条容易写错的口径：① **`colors` / `codes` / `paletteSize` / `paletteColors` 是四个不同的量**
  （源 A 严格对齐时 `paletteSize 16` / `paletteColors 15` / `codes 8` / `colors 7`；drift 起来是 16 / 15 / 16 / 15）；
  ② `fringe` 与 `platesPerInk` **只对同角度基准有意义**，且**强依赖画面内容**（对齐态：中调源 0.0623 / 浅色源 0.0360 / 深色源 0.0097，
  差 6.4 倍；`amp 5` 时 0.2804 / 0.0493 / 0.3217），不能跨画面当硬门禁用。
- 记录一个**已知实现瑕疵**：`separate()`（`press.js:167`）与 `cellAverages()`（`press.js:352`）都用 `Math.floor(y / h * rows)` 映射，
  源尺寸与网格**恰好 1:1** 时浮点误差会吞掉整行/整列（160×90 → 160×90 丢 5.56%；213×120 丢 3.76%；183×103 丢 8.91%；
  1280×720 → 160×90 这种整数倍不踩）。两条分色路径都踩、**症状相反**：`separate` 少墨（白线）、`separateCov` 把空格子读成
  纯黑目标（黑线）—— 换路径并不能解决。四条判据都抓不到它，绕法是让源画布大于网格。

**新增：管线化 `tools/press-clip.mjs` —— 任意视频进，套印片出**
- 两个工具接成一条链：`node tools/press-clip.mjs --in a.mp4 --out a.png`（视频 → **格子图集** PNG + 同名 `.json` sidecar），
  再由 `node tools/press-reel.mjs --clips "01 果物~a.png~3|02 肌肤~b.png~3" --type 3` 出片。多段**必须用 `|` 分隔**；
  单条可以只给路径，标签由文件名推（逗号串**不支持**，会被当成一个路径载入失败）。
- 为什么中间要过一张图集：分色按**格**取平均，直接从视频解码会让同一个 `t` 出不同帧；压成图集之后**一格 = 一个像素**，
  取平均只做一次，往下的每一帧仍然只是 `t` 的纯函数。掉到格分辨率是零损失（分色只吃格均值），内存小两个数量级
  （128 帧 × 274×102×4 B ≈ 14 MB，同样 128 帧的 1080p RGBA 是 1.06 GB）。`cols = ceil(√N)` 按格数取方：90 帧 → 10×9 = 2740×918、128 帧 → 12×11 = 3288×1122。
- **四个 `exit 0` 却画坏的坑**（写进 `docs/05` §11.3，都实测复现）：
  ① `tile` 在帧数不足时**静默补满并退出 0**（10 帧进 4×4 → 后 6 格整格纸色 1536/1536 = 242,243,242；128 帧进 12×11 末尾 4 格亦然）
  →「恰好 N 帧」只能自己数：两路命名实例 `showinfo@real` / `showinfo@total`，对不上就 die；
  ② `format=rgb24` 必须放在 `scale` **之前**，否则面积平均是在解码器原生 yuv420p（色度已半分辨率）上做的 ——
  实测源与目标同尺寸时差 **0.00**，降到一格一像素（274×102）时亮度平均差 **1.19–1.34 / 255**、`max` 9、差 ≥2 的格 **3.9–17.4%**，
  按 1-bit 口径翻面 **0.47–0.68%**（小，但正好落在边缘格上）。字节差随素材在 0%–12% 乱跳，**那个数不是判据**；
  ③ `fps` 滤镜边界帧由浮点决定 → `-t (DUR + 1.5/fps)` 给 headroom 再 `trim=end_frame=N`；
  ④ 导出帧数必须取**页面报的**片长（`Math.round(meta.dur * FPS)`），用手写 DUR 会让长片后半段全是重复末帧。
- 时间轴参数化：所有时间常数乘 `TS = DUR / 17`，`TS === 1` 时 `Object.is` 逐位相等（5 帧 SHA-256 两轮相等，默认那条 17 s 片一个像素没变）；
  `fall` 不能反算（`(14.00 − 12.70) === 1.3000000000000007`）。**素材模式**下回落段锚在**字版起点**：
  `rise = max(0.2, tType − 0.2 − a)`、`fall = min(1.3·TS, TYPE_DUR × 0.55)`，否则长片会先归位、把最该被看见的那一秒半挪到没人注意的地方。
- 示例片：三段各 3 s + 字版 3 s = **12.00 s / 360 帧**，母版 1920×1080 `libx264rgb` qp18 = **182 966 965 B**（渲染三次 **71.8 / 71.9 / 74.5 s** ≈ 199–207 ms/帧（整片摊薄）），
  网页版 `media/press-pipe-clip.mp4`（1280×720 `yuv444p` crf33）= **5 425 225 B**。站内四件：`press-pipe-{clip.mp4,poster.png,pair.png,atlas.png}`。
  素材不引第四个来源 —— 三段都是那三张 CC0 照片各做的一段缓推镜头（`zoompan`，3 s 90 帧），许可与署名见 `NOTICE.md` §7.1。
- 素材门槛（判据，不是建议）：**16:9**、**有明确主体、明暗各半**。反例是仓里那段 `media/demo-clip.mp4`（854×480 抽象彩块），
  链路跑得通，但压到 274×102 格后只剩几道等高线状的弧 —— 不是管线坏了，是素材的细节尺度比格子还细。
- 文档：`docs/05` 新增 **§11 管线化**（原 §11–§14 顺延为 §12–§15，§11 分 11.1–11.8）；`STANDARD.md` §11 边界与 §12 出处索引各加一条管线指针；`README.md` 加「管线：任意素材进，套印片出」。
- 自查边界：`check/press.mjs` **不覆盖**管线（依赖 ffmpeg 与本机 Chromium，进不了 `node --test`）；
  它靠能重跑的物证：图集逐格 = 源第 k 帧（k = 0/50/100/127 抠格比对 **diff 0**）、默认片 5 帧 SHA-256 两轮相等、`__reel.clips().fail` 必须空、**整片逐字节可复现**（原样重跑 §11.5 的命令 → `md5 `6ce966c3e1558d3e3303e2c087a0355c`` 与仓里母版相同）。

**文档（索引接进新分册）**
- `STANDARD.md`：开头加**分册**一行（① 规范 · ② 现象 · ③ 字符 logo · ④ 场转场 · ⑤ 套印不齐）；§0 与 §1 的「只有纸与墨两色」
  限定为**单色层**的令牌表；§11 边界把「彩色未纳入」改成「另有分册，判据不可互套」。
- `README.md`：可选脚本从 `transition.js` 一个变两个；文件表加 `press.js · press.html` 一行；
  新增「套印不齐（可选件 `press.js`）」一节（可跑的最小示例 + 四条硬判据 + 实测性能）。
- `SKILL.md`：§0 只读表加 `press.js` 一行；§5 边界拆成「单色层只管两色 / 彩色已单独立册、判据不互套 /
  默认体裁是准同角度」三条；frontmatter 的 description 补一句多版叠印另有一层。

**自查**
- `check/press.mjs`（**26 条测试 / 633 条断言**（含 1 条汇总自检）：调色板与碰撞 · 单版逐字节等价 · 确定性 · 分色与 TAC · 色数 · 每版有墨 ·
  漂移单调性 · 装载顺序无关 · 覆盖域分色 · 六色真的更多色 · 换 inks 必须重建）。已接进 `npm run check`（`scripts.check` = core + transition + press）。
- 现状：`npm run check` **65 test 全过 · 链接 477 条全在**（`scripts.check` = core + transition + press + `tools/check-links.mjs`）。

## 2.2.0 — 2026-11-12

**修正：字形被双重缩放（有效字号成了 `px²/20`）—— §7-2 与 §14 的共同根因**
- `render.js` 旧版把 `px` 栅格到固定 256×256，再乘 `f = min(cap, px/20)`：`px=20` 恰好对，40 变 2 倍、80 变 3.8 倍；
  而 advance 仍按 `px` 算 → 整行字幕重叠成一块墨。实测（单字「墨」，量墨框 CSS 高）：px 12/20/40/80 → 旧 6.5/18/72/240，
  现在 11/18/36/73，`hCss/px` 恒 0.91。"字大一点"只是表象：§7-2 的实墨字走不通、§14 的每屏一句大字标题也只能退回 DOM 覆盖层。
- 现在：按**设备像素字号**栅格化（缓存键含实际栅格尺寸与字体）→ 贴图 1:1；advance 取 `measureText().width`；
  新增 `measureGlyph(ch, px, wt, font?) → { w, h, adv, top, bot }`（全 CSS px）；横按墨框居中、纵按 em 框定位
  （逐字按各自墨框居中会让基线上下跳）。
- ⚠ 语义变化：`api.glyph(ch, cx, cy, px, …)` 的 `px` 现在**就是** CSS 字号。旧代码里靠 `px=20` 蒙对的调用不变，
  写了 `px≠20` 的地方字号会变 —— 那正是 bug 所在。
- `hud.js` 的 `caption()` 同步：排字改用 `measureGlyph().adv`、删掉 `ci·px·0.5` 的猜法，新增 `wt` / `tracking` / `lineH` / `align`。

**新增：`DotInk.plate()` —— 画布内版式叠加层（§14 的落点）**
- 左上三行小字（kicker / 公式 / 来源）+ 下带**大字标题**；标题按**墨框底对齐** `cssH − bottom`，多行往上叠，
  整行超宽按 6% 步长缩字号（下限 16 px，不压字距）。参数见 [`hud.js`](hud.js)。
- 配套 `render.js` 新增叠加层 `api.clear(x, y, w, h)`：擦出一块纸。三样一起写 —— MASK 归零、
  PX 的 RGB 回落纸色、alpha 255（只清 alpha 会被下一次 `compose()` 重新记成墨）。
- `plate({ knock: true })` 先用 `clear()` 擦出小字区与标题区的净空；标题区上界按**首行墨框**算，不按 `px` 猜。

**修正：站点在显示环节破 1-bit（backing ≠ 显示设备像素）**
- `gallery.html`：backing 1920 装进 1014 的盒（devPerCss 1.893）→ 浏览器重采样，裁画布量到 **0.36%** 非墨非纸。
  现在 `pickScale()` 让 backing = 显示宽 × dpr，且**不取整到两位**（0.79×1280=1011≠盒子 1014 就又破），
  实测 devPerCss 1.00000、九屏 **0.000%**；加 `ResizeObserver` 防抖重建。
- `demo/index.html`：backing 1920 / 显示盒 1440×810 + `#stage` 挂 `matrix(1.125)` → 1.333，**12.93%** 非墨非纸。
  现在 backing 与显示盒同除一个整数 D（`canvas.width/rect.width ≡ D` 精确），1440×810 与 1024×640 下都是 **0.00%**；
  `?t=` 定格与 `__seek` / `__ready` / `__meta` 契约零改动。已知取舍：预算降级时 D < dpr
  （`image-rendering:pixelated` 保住硬边，锐度略降）。

**新增：`pheno.kuramotoRing()` —— 06 换体裁（点列相位环）**
- 旧版走 field 网格，整屏墨 **20.83%**、读成一面迷宫墙（参考件 still-06 是 3.33%）。
- 现在 520 个振子排在圆周上、洛伦兹分布的 ω、平均场耦合、K 在 80% 内爬到 2.2，圆心伸出**序参量指针**（长度 = r·R）。
  实测 r 终点 **0.632**，与解析 r∞ = √(1−Kc/K) = 0.60 及参考件量到的 0.580 同量级；整屏墨 **3.79%**。
- ⚠ 已知取舍：锁相后 520 点挤进一段弧，局部间距 < 点径 → 那一段必然并成一笔实线弧（同步本身如此）；
  「同步了没有」交给指针长度，不靠点是否分开。

**修正：两处现象参数（都是量出来的）**
- `sandChladniPoints`：DRIFT 默认 **30 → 120**。贴节线比例（|φ|<0.10）**71.1% → 85.7%**，mean|φ| 0.0842 → 0.0540，
  构造耗时不变（步数不变）。drift 200 只再多 2.3 个百分点（收益递减）。
  **颗粒数与抖动对这条曲线没有影响** —— 之前把「沙散成虚线」归因到颗粒数是错的。
- `sunflower`：`rx = cols·fill` / `ry = rows·fill` → `rx = ry = min(cols, rows)·fill`。掩膜 aspect **1.771 → 1.000**
  （旧版在 16:9 里是横椭圆）。注意盘是边长出来的：末帧直径/画幅高 0.946，fill 加到 0.50 会切边。

**新增：`render` 的 `minPointDev`（点列通道的点半径设备像素下限）**
- 点列的 r 是 CSS px；画布缩到 1014 CSS 宽时 0.97 CSS px 只剩 0.77 设备像素 → 一串沙读不出颗粒。
- `minPointDev: 1.35` 只把**比下限更小**的点抬到下限，大点一个不动（可见性下限，不是调幅）。

**画廊 `gallery.html`**
- 删掉 `.headline` / `.fml` 两个 **DOM 覆盖层**，标题改由 `DotInk.plate()` 画在画布上（§14「画面区域不压 DOM」+ §7-1）。
  九屏各配 `no` 与 `title`（取自参考件字幕原句），`.stage` 加 `max-width:1280px`（只有显示 1280 CSS px 时点距才真是 8 px）。
- 07 分叉树显式声明 `jm: "M3"`：整屏覆盖率 4.55%，在 M2 下会被判死，而树本身读得清（§14 明说勾线走 M3）。
- 读数的状态列改成**只从 `judge()` 的 gate 行取**。此前页面自己又算了一套，两处都错：M1 屏把「覆盖率 ≥8%」
  （judge 里的参考行 `gate:false`）涂红，M3 屏又把「点距:点径」涂红。判据只有一个真源。
- 缩略图：点列屏的母函数返回的是 1280×720 **设计空间**坐标，直接塞进 56×32 会全落在画外 → 第 1、7 格**空白**；
  向日葵整盘高值 → 第 3 格糊成黑块。现在统一走 `p.mk()` + `thumbPoints()`（按设计空间缩放、半径给下限）+ 逐现象 `tg` 增益。

**文档**
- `README.md`：删掉第 49–71 行整段重复（同一段文字 + 同一张 demo.gif + 同一组「示例 A/B」出现两次），200 → 166 行。
- 死指针：`README.md:25` 与 `STANDARD.md:374` 都写「见本包 README 的『同一批公式，差在哪』」，而该节实际在
  [`docs/02-phenomena.md`](docs/02-phenomena.md) 第 32 行 → 两处都改指过去。
- `logo-demo.html` / `marks-type.html` / `marks.html`：静态正文里字面露出的 `**` 与反引号换真 `<b>` / `<code>`；
  `logo-demo.html` 页头 kicker 折成两行 → 本页覆盖 `ink.css` 的 `max-width`，≥320 px 单行（300 px 以下仍两行）。
- `docs/01-standard.md`：`overlays` 的 api 补 `measureGlyph` / `clear`，写清 `glyph` 的 `px` 语义；新增 `minPointDev`。
- `STANDARD.md` §14：标题字号标成参考件量到的 55–100 CSS px 级（原文写 18–40 px 级，偏低）。

**自查**
- `check/core.mjs` 新增两条：**画布内版式 plate**（标题墨框底落在 `cssH−bottom`、同 t 两次点位一致、超宽自动缩字号、
  knock 的擦除范围必须上下盖住标题墨框）与**相位环**（三元组、同半径、锁相收拢、指针跟着序参量变长、复用同一 Float32Array）。
- `tools/check-links.mjs` 跳过 `.dsh` / `.visual-audit` 这类**点目录**，与 `check/core.mjs` 的「页面装载顺序」测试口径一致
  （否则模板里引用一个尚未生成的 `data.js` 会让 `npm run check` 报断链）。
- 现状：`npm run check` **38 test 全过 · 链接 255 条全在**。
## 2.1.0 — 2026-10-28

**新增：场转场 `transition.js`（可选脚本，不进汇总入口）+ 演示页 `transition.html`**
- 三种转场：`wipe`（任意角度）/ `radial`（圆心可调、可由外向内）/ `dissolve`（种子 + 颗粒）。
  全部是进度 `p` 的纯函数；`p ≤ 0` / `p ≥ 1` 走分支 → 端点逐字节等于源场；无内部播放状态 → 倒放、随机 seek 免费。
- 默认 `blend: 'select'`：每格每刻恰为 A 或 B，不造新调子；`mix` 只在过渡带内对场值插值。
- `encoding: 'coverage' | 'calibrated'` → `renderHints = { areaMap, gamma: 1, gain: 1, shutter: 0 }`。
- 自查 `check/transition.mjs`（12 项）；规范 `docs/04-transitions.md`。
- **第二批（同日）**：加两种模式 `tone`（按墨量显影，`by: 'to'|'from'`、`invert` 先亮后暗；墨量按编码换算一次：coverage 取 v、calibrated 取 v²）与 `mask`（按到字形 / logo 轮廓的带符号距离揭示，`mask` 收 `fields.sdf` 式距离函数或覆盖率数组，数组走精确 EDT；形内 / 形外分段分配进度；`invert` 向轮廓收拢）。
  退化情形明确：墨量处处相同 / 空遮罩 / 满遮罩 → 种子次序，`tr.info.fallback` 报出。新增 `orderMap()`、`params.by` / `params.mask`、`BYS`；`transition.js` 内部版本 1.1.0。
  演示页加「显影」「遮罩」两个页签、两个一键示例（字形「纸」→ 同心环；干涉 → OpenAI 标）、键盘 4 / 5；遮罩形状复用页面字形栅格与 `marks.js` 厂标路径。自查增至 19 项。
- 提交前修正两处边界：`at(p, out)` 拒绝与源场共享且重叠的字节区间（同 buffer 的不重叠视图仍可复用）；编码校验只接受自有键，拒绝 `toString` / `__proto__` 等继承属性。新增两项回归，自查共 21 项。
- `ink.css` 新增可复用交互件（全带 `ink-` 前缀，不影响旧页）：`ink-btn` / `ink-tabs` + `ink-tab` /
  `ink-seg` / `ink-panel` + `ink-param` / `ink-range` / `ink-status`（六种状态）/ `ink-kbd`。

**修正：§3 映射配对与 §9 / §10 / SKILL / docs/01 的冲突**（文档与注释，**代码行为不变**）
- §9-2、§10 自查表、`SKILL.md` §2-1、`docs/01-standard.md` 原写"必须 √、线性只作对照"，与 §3 的配对规则矛盾 → 统一成"按场编码配对"。
- 写明 `fields.fromImageData` 默认 `gamma .45 / gain 1.6` 是**已标定**场：配 `areaMap:false`；
  要配 √ 传 `{gamma:1, gain:1}`。默认值直接相接 = 双重校正。`fromImageData` 的默认值**未改**（`marks.html` / `preview.html` 依赖它）。
- 打包接入：`package.json` 的 `exports` 加 `./transition.js`，`files` 加 `transition.js` / `transition.html` / `ink.css`（`check/`、`docs/` 原已整目录收录）；`check` 脚本并入 `check/transition.mjs`。无新依赖；版本号 **2.1.0**（合入后定稿）。
- 导航：七个页面的站点头（hero 是页内 `.nav`）在「现象画廊」后加「场转场」；`transition.html` 自己的导航末项与其它页对齐为「标准」。

## 2.0.0 — 2026-10-25

**拆件：核心分成四个脚本 + 一个可选叠加层，`dotink.js` 只做汇总**（**破坏性**：页面要多引 `<script>`）
- 起因：`dotink.js` 一个文件里混了四件事 —— 场构造器 / 渲染 / 判据 / HUD+字幕 / 宿主。
  HUD 尤其别扭：它是**画面上的装饰墨**，却长在核心里，还要参与净空判据；
  而 §13 的口径本来就是"场归 dotink，画面仪表归 typefield" —— 第二套 HUD 不该由核心维护。
- 现在：
  | 文件 | 负责 |
  |---|---|
  | `fields.js` | 场构造器（`ramp` / `noise` / `interference(Fn)` / `sdf` / `fromImageData` / `bits`）+ `_mulberry32` |
  | `render.js` | 渲染核心：缓冲 / 解析圆盘 / 字形栅格化 / 面积映射 / `draw(t)` / **`overlays` 钩子** / `inst.core` |
  | `judge.js` | `measure` / `judge` / `countNonBinary` / `autoMode`（只读 `inst.core`） |
  | `host.js` | 独立短片宿主（`__meta` / `__ready` / `__seek`；两套渲染器契约在这里抹平） |
  | `dotink.js` | **汇总**：装配 `DotInk.create`（render + judge 挂回实例）、导出、CJS `require` |
  | `hud.js` | **可选**：`DotInk.hud(opts)` / `DotInk.caption(opts)` —— 尺 / 进度 / 5×7 点阵时间码 / 实墨字幕 |
- **硬切**（按设计选择）：`DEFAULTS` 里删掉 `hud` / `hudC` / `caption`；核心不再认识 HUD。
  要仪表就显式挂：`overlays: [DotInk.hud(), DotInk.caption({...})]`（单个函数或数组）。
  叠加层只拿到 `{ dot, glyph, opts, cols, rows, cell, rMax, scale, cssW, cssH, devW, devH }`，
  在 `compose()` 之后画进同一张 1-bit 帧 —— 不影响场的求值。
- 装载顺序（浏览器）：`fields.js → render.js → judge.js → host.js → dotink.js`（**最后**；可选 `hud.js`）。
  缺件时 `dotink.js` 会抛错并列出缺哪一个，不再静默出空帧。
- Node/CJS：`require('./dotink.js')` 自己按序 `require` 兄弟文件，`require('dotink').DotInk` 仍可用。
- 调用点同步改造：`gallery` / `hero` / `icon` / `marks` 删掉无意义的 `hud:false`；
  `preview.html` 的"加装饰"开关改成 `overlays: hudOn ? [DotInk.hud(hudC)] : null`；
  `demo/index.html` 改成 `overlays: [DotInk.hud(), DotInk.caption(caption)]`（+ 引 `hud.js`）。
- 自查加三条：拆件装配（核心不认识 HUD）/ 整条管线（假画布跑 `draw`→`judge`，验证 1-bit、确定性、
  `overlays` 只加墨）/ 页面装载顺序（四个核件必须排在 `dotink.js` 之前）。
- 行为等价：无 `overlays` 时出帧与 v1.7 逐字节相同（同一套 `dot()` / `compose()` / 面积映射）。
- **站点**：GitHub Pages 上线 —— 根路径 [`index.html`](index.html) 带查询串跳 `hero.html`，
  `.nojekyll` 关掉 Jekyll（否则下划线开头的路径会被吞）。在线：<https://liceses.github.io/dotink/>

## 1.7.0 — 2026-10-13

**新增：一套共用设计系统（`ink.css`）—— 六页合成一组宣传页**
- 起因：每个页面各写一套内联 CSS、导航各指各的，`preview.html` 连 header 都没有（**进去出不来，0 条链接**）。
- `ink.css`（零依赖，`file://` 双击可用）：令牌 / **粘性站点头 + 全站一致的 7 项导航**（当前页带 accent 下划线）/
  页头（kicker + display 标题 + 一句「这是什么」）/ 站脚 / `.btn` `.link` / 统一焦点环 / `prefers-reduced-motion`。
- 六页统一改造：`gallery` · `preview` · `marks-type` · `marks` · `icon` · `logo-demo` ——
  每页都有站点头、一段**页头说明**（这是什么 / 该看哪）、站脚与全站导航；`hero.html` 也挂 `ink.css` 共享令牌。
- 命名避开 `.wrap`：gallery / marks / icon / logo-demo 都用它当主内容列，共用件改叫 `.page-body`。

**修复**
- `gallery.html`：**九个缩略图全是黑块，而且长得一模一样**。`buildThumb()` 只 `DotInk.create()`、
  没 `draw()` —— 而 `dotink.js` 取的是 `getContext('2d', { alpha:false })`，**未绘制的画布是不透明白黑**。
  现在按 `select()` 同一条规则起播（`p.t0 ?? p.span*0.6`）并真画一帧。

**自查**：`npm run check` **10/10 · 链接 187 条全在**。

## 1.6.0 — 2026-10-12

**修内核（两处都是"宣称与实现对不上"，各带一次实测）**
- `dotink.js`：**点径改解析圆盘**（删掉 `DISC[r]` 整数偏移表，改成像素中心判**真半径**）。
  旧实现 `Math.round(r·S)` 会把 `0.06 → 0.165` 这么宽的一段场值压成同一个点径 ——
  实测：cell 8 / maxFrac 0.40 / scale 1（**正是 §14 参考配方**）画一条渐变只有 **4 个层次**，
  而 §14 写的是「0..3.2px **连续调幅**」。改后同参数 **9 个层次**（scale 2 时 **22 个**）。
  副作用（记一笔）：最小落墨从"整数半径 1 = 5 px"变成"真半径 < 0.5 时只有中心 1 px"。
  `DotInk._disc` / `discMax` **不再导出**（补了 `DotInk.discOffsets(r)` 给需要整数圆盘的调用方）。
- `dotink.js`：**`judge()` 加 `mode`**（`'M1' | 'M2' | 'M3' | 'auto'`），`pass` 只算**当前模式的门禁行**。
  旧版把 M1（≥3:1）与 M2（≥8%）同时当硬门禁 —— 而 §4 明说这两种体裁**互斥**，
  于是做网点的画必然卡覆盖率、做面场的画必然卡 3:1：实测 11 种真实用法 **9 种报"不过"**，
  **连 README 自己的示例都不过**。改后同批 10 种用法 **8 种通过**，两个"否"都是正确的否
  （结构型不声明模式 / 全空场）。返回体加了 `mode` / `failed` / `untested`；
  `checks[].gate === false` 的是参考行，不计入 pass。
  ⚠ 结构型画面（节线 / 枝 / 条纹）**必须显式传 `mode:'M3'`** —— auto 不会替你把"太稀"解释成"勾线"。
- `dotink.js`：`judge()` 的「1-bit 无灰阶」**改成真读画布像素**（`getImageData` 数非墨非纸）。
  旧版这一行是写死的 `true`（文案"compose() 保证"）—— 那不是判据，是信念：§7-1 警告的
  "DOM 覆盖层被拍进帧"它抓不到，画布内部的破功也抓不到。代价是一次 2M 像素读回，
  所以留了 `judge(t, { pixels: false })` 的口子（`hero.html` 就用它）。

**修页面**
- `preview.html`：**判据表从来没填过**。`tick()` 里写的是 `B.measures` —— `measure` 是**函数**不是属性，
  一进来就抛 TypeError，表永远停在"有表头没内容"。改成真调一次 `B.measure()`；
  另把 judge 节流到 ~4/s（1-bit 现在要真读像素），并显示「模式 + 未过项」、参考行标「参考」。
- `gallery.html`：模式判定改为**直接取 `judge()` 的结论**（原来页面自己推一套，与 judge 打架过）；
  1-bit 行改成读实测值（原来是写死的 ok）；沙粒 / 节线显式传 `mode:'M3'`。
- `hero.html`：底部给读数牌**预留位置**（实测视口 1110×530 时它压住 CTA 按钮）；judge 走 `pixels:false`。

**修文档 / 打包**
- `media/phenomena-8/`：`MANIFEST.sha256` **重生成**为"本目录原地可验"（11/11 全过）；
  `SOURCE.md` 去掉不实的「已逐文件核对 10/10 一致」—— 上游那 10 条里，`lab-field4-1080p.mp4`
  在 `../_release/`（hash 一致）、`README.md` 已改写为 `SOURCE.md`（hash 不同），**两条都不在原目录**。
- `STANDARD.md` §1 / §11：记下对标件（`lab-field4`）的令牌实测是 `#0C0C0C` / `#F2F2F2`，
  与 §1 的 `#0C0D0E` / `#F2F3F2` **各差 1 位**（冻结件不回改，按 §11 记数）。
- `OPENSOURCE.md` §七：补上"先验 fast-forward"这一步 —— 实测两次推送都是普通 push，
  **不需要 `--force`**；并写明"媒体没动就不要新开 release"（否则 `/releases/latest` 会变成空）。
- `package.json`：`files` 改成**显式列 media 子路径**，并补 `check` / `docs` / `CHANGELOG`；
  加 `exports` 与 `prepublishOnly`；新增 `.npmignore`。
  **实测 `npm pack` 从 61.4 MB 降到 12.6 MB** —— 旧的白名单 `"media"` 把 `media/_release/` 里
  两个 48.9 MB 成片一起打进了包（`.gitignore` 排 git 有效，但排不掉 `files` 白名单里的条目）。

**自查**：`npm run check` **10/10 通过 · 链接 183 条全在**。

## 1.5.0 — 2026-10-11

**新增**
- `hero.html`：**全屏 hero 示例（把点墨当网站视觉重心）** —— 单画布铺满视口 · 自适应 `scale`
  （`min(DPR, √(预算 / 像素))`，再按实测单帧耗时上下调）· `ResizeObserver` 防抖重建（约 3ms）·
  滚出视口 / 切后台停 rAF · `prefers-reduced-motion` 定格一帧 · 右下**实时判据读数**（格数 / 覆盖率 /
  单帧 / 帧率 / scale / dpr / backing / 放大倍数）。
  正文留白是**把场本身压下去**做的（§5 净空），不是盖一层白 —— 那里真的一格墨都不落；
  桌面走斜边留白、窄屏走横带。实测：175×98 格 · 覆盖率 12.55% · 单帧 12.3ms · 28fps（封顶 30）。

**修复（文档 —— 都对应一次实测）**
- `README.md` / `SKILL.md` / `docs/01-standard.md`：「三十秒上手」把写死的 `scale: 1.5` 改成
  `Math.min(2, devicePixelRatio)`，并补上 `image-rendering:pixelated` 与"画布尺寸变了要重建"。
  依据：DPR 1.65 的机器上按 `1.5` 建，屏幕上 **24.46% 的像素既不是墨也不是纸**（252 种灰）；
  加一句 `image-rendering:pixelated` 后为 **0**。
- `README.md` / `SKILL.md`：示例里 `interferenceFn(46, 26)` 与 `create` 推出来的 `cols`（47）不一致 ——
  改成显式传 `cols` / `rows`，让场与网格同源。

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
