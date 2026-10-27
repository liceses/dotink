# 点墨 · 变更记录

> 版本号跟 [`package.json`](package.json) 走（`dotink.js` 的 `version` 必须与它一致，测试会查）。
> `pheno.js` / `logo.js` / 移植的 `markplate.js` 各有自己的内部版本号，见各自文件头。

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
