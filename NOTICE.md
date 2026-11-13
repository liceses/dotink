# NOTICE · 第三方数据与出处

本包的**代码与文档**是 MIT（见 [`LICENSE`](LICENSE)）。以下第三方内容另有其许可与口径，逐条写清楚。

---

## 1 · 厂标路径数据（[`marks.js`](marks.js) · [`marks.html`](marks.html)）

- **来源**：[simple-icons](https://github.com/simple-icons/simple-icons)，**CC0 1.0 Universal**（公有领域奉献）。
- **商标归各公司所有**。本包把厂标用于**指称**那家公司（识别 / 演示 / 教学）—— 属于规范使用；
  路径数据**除缩放形变外没有改绘**，**不是**各家官方素材包。
- 与主库 `modules/markplate/README.md` 的版权口径一致，原文照抄：
  > 厂标是各家的商标，资讯里用它来**指称**那家公司属于规范使用；路径数据来自 simple-icons（**CC0**），
  > 不是官方素材包，除形变外没有改绘。**商用发布前按自家法务口径过一遍。**
- **生成方式**：`node tools/make-marks.mjs <主库>/modules/markplate/icons.js`（只抽 `key` / `title` / `d`）。
  47 家清单与顺序见 [`marks.js`](marks.js) 的 `order`。

---

## 2 · 自然现象的公式与来源（[`pheno.js`](pheno.js) · [`gallery.html`](gallery.html)）

公式本身是数学 / 物理事实，**逐条出处（作者与年份）写在 `pheno.js` 每个函数的注释里**，
并汇总在主库 `lab/PHENOMENA.md` §01–08：克拉德尼 1787 · Vogel 1979 · de Jong / Bourke ·
Pearson 1993 · Witten & Sander 1981 · Kuramoto 1975 · Feigenbaum 1978 · 双源干涉（解析式）。

---

## 3 · 参考配方成片（[`media/phenomena-8/`](media/phenomena-8)）

《公式就是画面》自然八拍由本仓库实验区（`lab/`）渲染，**逐字节取自里程碑**
`lab/milestones/2026-10-05-phenomena-8-sand/`（标签 `v0.3.1-phenomena-8-sand`）。
原 `MANIFEST.sha256` 随件带上，已逐文件核对 **10/10 一致**。出处与重建命令见
[`media/phenomena-8/SOURCE.md`](media/phenomena-8/SOURCE.md)。

---

## 4 · 示例 B 自检片（[`1010-dotink-demo-1080p.mp4`](https://github.com/liceses/dotink/releases)（**Release 附件**，仓内只留 GIF 与静帧））

本包自己渲染（主库 `work/1010-dotink-demo/`）：**无音轨**、无第三方素材、无外部字体（只用系统字体栈）。

---

## 5 · 品牌图标（[`icon.svg`](icon.svg) · [`icon-*.png`](icon-512.png)）

原创，几何即本标准 §3/§4 的一次应用（生成器 [`tools/make-icon.mjs`](tools/make-icon.mjs)）。MIT。

---

## 6 · 字版厂标引擎（[`markplate.js`](markplate.js)）

**代码逐字节移植**自主库 `modules/markplate/markplate.js`（主库路径）
（`MarkPlate 1.0`，19 KB，零依赖、经典脚本）：**未改一行**，只在文件最上面加了出处头；
正文 sha256 与上游一致，可用 [`tools/vendor-markplate.mjs`](tools/vendor-markplate.mjs) 复验/重取。

它用到的厂标路径数据许可与商标口径**同 §1**（simple-icons **CC0 1.0**；商标归各家；指称使用；商用前过法务）。

---

## 7 · 套印片源照片（[`media/press-src-*.jpg`](media) · [`tools/press-reel.html`](tools/press-reel.html)）

《套印不齐》片源的三张样张用**真实照片**而不是手绘 —— 这一层的立论是「颜色只落在 2^N 个格点上」，
必须有真实连续调的内容才能暴露「四色压不出饱和橙绿」。手绘示意图反而证明相反的事（画什么都是一块色）。

三张全部 **CC0 1.0 Universal**（公有领域奉献，无署名义务；此处仍列出作者与出处）：

| 用途 | 文件 | 原图 / 作者 | 出处 | 许可 |
| --- | --- | --- | --- | --- |
| 01 果物 | [`press-src-fruit.jpg`](media/press-src-fruit.jpg) 1200×800 | *Basket of blood oranges* · Linh Pham (`lhpham12`) · 2016-11-13 · 原件 5184×3456 | [Commons](https://commons.wikimedia.org/wiki/File:Basket_of_blood_oranges_(Unsplash).jpg) · [Unsplash](https://unsplash.com/photos/sZnRKLItmwo) | [CC0 1.0](http://creativecommons.org/publicdomain/zero/1.0/deed.en) |
| 02 肌肤 | [`press-src-skin.jpg`](media/press-src-skin.jpg) 1200×800 | *Face portrait* · William Stitt (`willpower`) · 2016-10-19 · 原件 5184×3456 | [Commons](https://commons.wikimedia.org/wiki/File:Face_portrait_(Unsplash).jpg) · [Unsplash](https://unsplash.com/photos/PgSu429ID5o) | [CC0 1.0](http://creativecommons.org/publicdomain/zero/1.0/deed.en) |
| 03 风景 | [`press-src-land.jpg`](media/press-src-land.jpg) 1200×676 | *Snow and sunset at Isolation Lake* · Sergei Akulich (`sakulich`) · 2016-09-24 · 原件 4001×2251 | [Commons](https://commons.wikimedia.org/wiki/File:Snow_and_sunset_at_Isolation_Lake_(Unsplash).jpg) · [Unsplash](https://unsplash.com/photos/AoGduv67dss) | [CC0 1.0](http://creativecommons.org/publicdomain/zero/1.0/deed.en) |

**改动**：仅裁切与缩放（`ffmpeg -vf scale=…:flags=lanczos`），**未改色、未修图、未重绘**。
片源在运行时另做一层按格尺度的高斯低通（`PHOTO_BLUR = 4` 源像素）—— 见
[`docs/05-misregistration.md`](docs/05-misregistration.md)「照片源与低通」一节：
一格 ≈ 4 源像素、印在 10.5 设备像素上，比一格更细的东西（毛孔、发丝、叶脉）落进格子只会变成
「这格该是哪个墨」的抖动，糊到格尺度之后才是连续的肤色网纹。

曾经用过又换掉的：*Sunset over Peyto Lake*（Mark Basarab，CC0）—— 整体背光偏暗，
1-bit 下 K 版吃掉 50.1% 面积、六色只剩三版出活，一张「暗」的样张证明不了色域宽。

### 7.1 · 管线示例片段（[`media/press-pipe-clip.mp4`](media/press-pipe-clip.mp4)）

`press.html`「管线：任意素材进，套印片出」那一节的示例片，素材是**从上表的三张 CC0 照片各做的一段缓推镜头**
（`ffmpeg` 的 z/x/y 裁剪随帧线性推进，3 秒 90 帧，无重绘、无合成新素材）。因此它的许可与署名**同上表**，
不再引入第四个来源。

这一点值得写清楚：片子看起来像「随手拍的视频」，但它不是 —— 是拿仓库里已有的静帧做的推镜。
如果换成真正实拍的外部片段，必须在这里补一行来源与许可，否则进不了开源包。
