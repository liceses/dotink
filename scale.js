/* ============================================================================
 * scale.js · 尺度数据（零依赖，`file://` 双击可用）
 * ----------------------------------------------------------------------------
 * ⚠ 这是**生成件**：由 `node tools/build-scale.mjs` 从 theme/scale.json 生成。
 *
 * 谁用它：system.html（设计系统页）拿它把样张现画出来 —— 于是"文档写的"与
 * "CSS 里生效的"永远是同一份数据，不会像手写文档那样慢慢漂走。
 *
 * 对外：DotInkScale.unit / .space / .fluid / .type / .line / .motion / .lang
 *       DotInkScale.onLadder(px)   → 这个值在不在阶上
 *       DotInkScale.pxRange(size)  → 数值原样返回；clamp 返回 {min,max}
 * ========================================================================== */
(function (global) {
  'use strict';

  var unit = 4;
  var space = {"s1":4,"s2":8,"s3":12,"s4":16,"s5":20,"s6":24,"s7":32,"s8":40,"s9":56,"s10":72};
  var fluid = {"gutter":"clamp(16px,3vw,32px)","section":"clamp(20px,3vw,32px)"};
  var line = {"hair":1,"frame":2};
  var motion = {"fast":140,"base":160};
  var lang = {"minCjk":12};
  var lineHeight = [1,1.15,1.3,1.45,1.6,1.75];
  var type = [
    { key: "readout", size: 10, lh: 12, family: "mono", weight: 500, tracking: ".14em", note: "读数标签、页脚注、tag。只给拉丁与数字 —— 中文最小 12px（lang.minCjk）。" },
    { key: "mono", size: 12, lh: 16, family: "mono", weight: 500, tracking: ".06em", note: "导航、判据读数、表格、按钮。等宽 + tabular-nums，数字才能上下对齐。" },
    { key: "body", size: 14, lh: 20, family: "sans", weight: 400, tracking: "0", note: "正文。原来是 15px —— 降到 14px 是为了让 20px 行高落进 4px 格律。" },
    { key: "lead", size: 16, lh: 24, family: "sans", weight: 400, tracking: "0", note: "页头导语、小节前的说明句。" },
    { key: "h3", size: 20, lh: 24, family: "sans", weight: 800, tracking: "-.01em", note: "小节标题（h3、面板标题）。" },
    { key: "h2", size: 26, lh: 32, family: "sans", weight: 800, tracking: "-.02em", note: "二级标题（h2、分区标题）。" },
    { key: "display", size: "clamp(32px,5.2vw,64px)", lh: 1, family: "sans", weight: 800, tracking: "-.032em", note: "页头大标题（.display / h1）。两端是 4 的倍数，中间插值 —— 这是唯一允许的插值例外。", fluid: true },
    { key: "hero", size: "clamp(44px,8vw,112px)", lh: 1, family: "sans", weight: 900, tracking: "-.03em", note: "首页唯一主视觉。整站只有一处。", fluid: true }
  ];

  function onLadder(px) {
    if (typeof px !== "number" || !isFinite(px)) return false;
    var q = px / unit;
    return Math.abs(q - Math.round(q)) < 1e-9;
  }

  function pxRange(size) {
    if (typeof size === "number") return size;
    var m = /^clamp\(\s*(\d+(?:\.\d+)?)px\s*,\s*([\d.]+vw)\s*,\s*(\d+(?:\.\d+)?)px\s*\)$/.exec(String(size));
    return m ? { min: Number(m[1]), max: Number(m[3]), mid: m[2] } : null;
  }

  var API = {
    unit: unit, space: space, fluid: fluid, type: type, line: line,
    motion: motion, lang: lang, lineHeight: lineHeight,
    onLadder: onLadder, pxRange: pxRange
  };

  global.DotInkScale = API;
  if (typeof module === 'object' && module.exports) module.exports = API;
}(typeof window !== 'undefined' ? window : this));
