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

## 4 · 示例 B 自检片（[`media/1010-dotink-demo-1080p.mp4`](media/1010-dotink-demo-1080p.mp4)）

本包自己渲染（主库 `work/1010-dotink-demo/`）：**无音轨**、无第三方素材、无外部字体（只用系统字体栈）。

---

## 5 · 品牌图标（[`icon.svg`](icon.svg) · [`icon-*.png`](icon-512.png)）

原创，几何即本标准 §3/§4 的一次应用（生成器 [`tools/make-icon.mjs`](tools/make-icon.mjs)）。MIT。

---

## 6 · 字版厂标引擎（[`markplate.js`](markplate.js)）

**代码逐字节移植**自主库 [`modules/markplate/markplate.js`](../modules/markplate/markplate.js)
（`MarkPlate 1.0`，19 KB，零依赖、经典脚本）：**未改一行**，只在文件最上面加了出处头；
正文 sha256 与上游一致，可用 [`tools/vendor-markplate.mjs`](tools/vendor-markplate.mjs) 复验/重取。

它用到的厂标路径数据许可与商标口径**同 §1**（simple-icons **CC0 1.0**；商标归各家；指称使用；商用前过法务）。
