# 开源现状与拆分方案（2026-10-11）

> 目标：把点墨做成**三件可独立开源的东西** —— ① **规范** ② **自然现象展示 + 整套代码** ③ **字符 logo 系统**。
> 这一页是**盘点 + 缺口 + 拆分方案**，不是宣传稿：每一项都标了「齐 / 缺 / 要决定」。

---

## 一、现状（实测，不是印象）

`dotink/` 现在 **48 个文件 · 58.4 MB**（媒体 57.9 MB + 代码/文档约 0.5 MB，代码 ≈ 4,400 行）：

| 类别 | 文件 | 行数 |
|---|---|---|
| 规范 | [`STANDARD.md`](STANDARD.md) | 287 |
| 核心实现（三块共享） | [`dotink.js`](dotink.js) | 572 |
| 现象场库 | [`pheno.js`](pheno.js) | 553 |
| 现象画廊 | [`gallery.html`](gallery.html) | 303 |
| 字符 logo 引擎（移植） | [`markplate.js`](markplate.js) | 349 |
| 字符 logo 数据（47 家） | [`marks.js`](marks.js) | 14（54.9 KB 路径） |
| 字符 logo 页面 | [`marks-type.html`](marks-type.html) · [`marks.html`](marks.html) | 206 · 255 |
| 即插 logo 组件 | [`logo.js`](logo.js) · [`logo-demo.html`](logo-demo.html) | 296 · 179 |
| 判据工具 | [`preview.html`](preview.html) · [`icon.html`](icon.html) | 186 · 191 |
| 文档 | [`README.md`](README.md) · [`SKILL.md`](SKILL.md) · [`NOTICE.md`](NOTICE.md) | 307 · 89 · 35 |
| 工具（零依赖） | [`tools/`](tools) 三个 `.mjs` | 53 · 52 · 33 |

---

## 二、三块交付物 → 现在各自有什么

### ① 点墨的规范

**齐**：[`STANDARD.md`](STANDARD.md)（15 节，每条判据带实测出处与状态）·
[`dotink.js`](dotink.js)（参考实现：渲染 / 场构造器 / 判据自检 / 独立短片宿主）·
[`preview.html`](preview.html)（8 条判据实时算 + A/B + **1:1 放大镜**）·
[`icon.svg`](icon.svg)（标，几何即 §3/§4 的一次应用）· `LICENSE`(MIT) · [`NOTICE.md`](NOTICE.md)

**缺**：判据**没有可跑的测试**（现在靠 `preview.html` 人眼看）· 无 `CHANGELOG.md` ·
版本号三处不一致（见 §三-1）· 无英文版（可选）

### ② 自然现象展示 + 整套代码

**齐**：[`pheno.js`](pheno.js)（八个现象 + **沙粒版**，统一签名 `(cols,rows,opts) → (i,x,y,t)`；
确定性、值域、演化量都验过）· [`gallery.html`](gallery.html)（九项**现场渲染** + 实时判据 +
**映射 A/B**，自包含、`file://` 双击即开）·
[`media/phenomena-8/`](media/phenomena-8)（参考配方成片 15 MB + **八张 1:1 静帧** + 接触印样 +
[`SOURCE.md`](media/phenomena-8/SOURCE.md) + `MANIFEST.sha256`）

**缺**：**参考配方成片的源码不在包里**（它在主库 `lab/work/lab-field4`，用的是另一套引擎）
→ 要决定：搬进来（大工程）还是写明"成片是参考件、源码在主库" ·
自检片 `media/_release/1010-dotink-demo-1080p.mp4`（**Release 附件，不进仓**）（32.7 MB）需要主库
B 线流水线才能重渲 → 它是**派生物**，要标注清楚 · 沙粒版目前只有点列 API，缺一个独立展示入口

### ③ 点墨的字符 logo 系统

**齐**：[`markplate.js`](markplate.js)（引擎，**逐字节移植**自主库，正文 sha256 可复验）·
[`marks.js`](marks.js)（47 家，simple-icons **CC0**）· [`marks-type.html`](marks-type.html)（字版翻一遍）·
[`logo.js`](logo.js) + [`logo-demo.html`](logo-demo.html)（**即插即用**：三行脚本挂到任意视频）·
[`marks.html`](marks.html)（点墨版对照）· [`tools/make-marks.mjs`](tools/make-marks.mjs)（数据入库）·
[`tools/vendor-markplate.mjs`](tools/vendor-markplate.mjs)（移植可复现）

**缺**：**自备 logo 只认 SVG path**（PNG / 位图不支持）· 没有**导出**路径（把标导成 PNG/SVG 给别的工具用）·
`marks.js` 是"内容"（54.9 KB），可考虑拆成独立数据包，让只想引数据的人不用拿引擎

---

## 三、共同缺口（开源前必须处理）

| # | 问题 | 现状 | 动作 |
|---|---|---|---|
| 1 | **版本号不一致** | `dotink.js` 1.2.0 · `package.json` 1.4.0 · `pheno.js` 1.1.0 | ✅ 已统一到 **1.4.0**（+ [`CHANGELOG.md`](CHANGELOG.md)） |
| 2 | **没有自查** | 全靠人眼看页面 | ✅ 已有 [`check/`](check/README.md)（`npm run check`：10 项 + 链接检查）。**按用户定的口径：自查不进 CI，签字的是人眼** —— 见 [`STANDARD.md`](STANDARD.md) §16 |
| 3 | ~~没有 CI~~ | — | ❌ **刻意不做**（用户 2026-10-11 原话："视觉工作用不太上，最终的验收终究还是人的眼睛"） |
| 4 | **README 307 行塞了 5 个产品** | 一个文件讲完所有事 | ✅ 已拆成**路由 README（167 行）+ [`docs/01-standard.md`](docs/01-standard.md) · [`docs/02-phenomena.md`](docs/02-phenomena.md) · [`docs/03-marks-logo.md`](docs/03-marks-logo.md)** |
| 5 | **媒体 57.9 MB** | 直接进 git | ✅ 已瘦到 **12.4 MB**：两个大 mp4 移出仓（`media/_release/`，已 gitignore，走 Release 附件）+ 新增 646 KB 小样片 `media/demo-clip.mp4` 给 logo demo 挂 |
| 6 | **包外引用 3 处** | 全在 `markplate.js` **正文的用法注释**里（`../../../modules/markplate/...`） | **保留** —— 那是移植文件的正文，改了就不再"逐字节一致"（出处已在文件头与 `NOTICE.md` §6 写明）；`NOTICE.md` 里那处已改成纯文字 |
| 7 | **孤儿媒体** | `media/poster.png`（0 引用）· `media/gallery.png`（0 引用） | ✅ `gallery.png` 已补进 README 画廊一节；`poster.png` 待定（删 / 归档） |
| 8 | **LICENSE 署名** | `Copyright (c) 2026 liceses (make-videos-kit)` | ✅ 按你的决定**保持现状** |
| 9 | **三块是否拆仓** | 现在全在一个包 | ✅ 你选了 **A · 单仓 + 文档路由** |

---

## 四、三种开源结构（要你选）

### A · 单仓 + 文档路由（推荐，改动最小）

```
dotink/
  README.md            ← 路由：三块各一句话 + 指向 docs/
  STANDARD.md          ← ① 规范（判据唯一真相）
  dotink.js            ← ① 参考实现（三块共享的核心）
  docs/01-standard.md · docs/02-phenomena.md · docs/03-marks-logo.md
  pheno.js · gallery.html · media/                     ← ②
  markplate.js · marks.js · marks-type.html · marks.html · logo.js · logo-demo.html  ← ③
  test/ · CHANGELOG.md · NOTICE.md · LICENSE
```

**优点**：链接不用折腾、`file://` 双击照旧、一个版本号、一次发布。
**缺点**：三块共用一个 release 节奏。

### B · 三个 repo（`dotink` / `dotink-phenomena` / `dotink-marks`）

**优点**：各自独立发布与 star；phenomena / marks 只依赖全局 `DotInk`（**耦合极浅，拆得干净**）。
**缺点**：三处版本与链接维护；`logo.js` 依赖 `markplate.js`（两个都放 marks 仓）→ 依赖关系要写清。

### C · monorepo 子包（`packages/core|phenomena|marks`，npm workspaces）

**优点**：可 `npm i @dotink/phenomena` 单独装。
**缺点**：引入构建 / 发布流程 —— 当前是"**经典脚本 + `file://` 零构建**"的路线，会被迫加工具链。

> **建议：A 先开源**（这一版就能发），把 ②③ 的目录边界在文档里写死；等某一块自己要长成独立项目时再按 B 拆
> —— 因为耦合只有"全局 `DotInk`"这一点，拆的动作就是**搬文件 + 改 script 标签**。

---

## 五、发布状态

- ✅ **已开源**：https://github.com/liceses/dotink（public · `main`）· 成片作为 Release 附件：https://github.com/liceses/dotink/releases
- 结构：**A · 单仓 + 文档路由**（你选的）· 署名：`liceses (make-videos-kit)`（保持现状）
- 自查：`npm run check`（**刻意不进 CI** —— 签字的是人眼，见 [`STANDARD.md`](STANDARD.md) §16）

---

## 六、发布前 checklist（已逐条过）

- [ ] 版本统一（+ `CHANGELOG.md`）
- [ ] `test/`（零依赖）+ CI 跑通
- [ ] README 拆成路由 + `docs/01|02|03`
- [ ] 媒体瘦身（视频进 Release / LFS；README 用 GIF + 静帧）
- [ ] 包外引用改纯文字；孤儿媒体处理
- [ ] LICENSE 署名确认；NOTICE 再核一遍（厂标 CC0 + 商标指称 + markplate 移植 + lab-field4 成片出处）
- [ ] 三块各自的"最小可跑示例"在路由页点明（已有：① [`preview.html`](preview.html) ② [`gallery.html`](gallery.html) ③ [`logo-demo.html`](logo-demo.html)）
