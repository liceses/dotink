/* 点墨 · 字版 logo 组件（即插即用）
 * ============================================================================
 * 把「字拼成的标 + 阅读波浮现 + 字不断浮动」做成**一个可以挂到任意视频/网页上的组件**。
 *
 * 依赖（经典脚本，按顺序引）：
 *   <script src="markplate.js"></script>   <!-- 字版厂标引擎（从主库逐字节移植） -->
 *   <script src="marks.js"></script>       <!-- 47 家厂标路径（simple-icons CC0） -->
 *   <script src="logo.js"></script>        <!-- 本组件 -->
 *
 * 两种用法：
 *   ① 命令式：
 *      const logo = DotInkLogo.mount(document.querySelector('.video-wrap'), {
 *        slug: 'openai', size: 0.14, corner: 'br', reveal: 1.2,
 *      });
 *      logo.set({ slug: 'python' }); logo.pause(); logo.resume(); logo.destroy();
 *
 *   ② 声明式（自定义元素）：
 *      <dot-ink-logo slug="openai" size="14%" corner="br" reveal="1.2"></dot-ink-logo>
 *      DotInkLogo.defineElement();     // 注册一次
 *
 * 任意自备 logo：传 `d`（SVG path 字符串）或 `svg`（SVG 源码/URL），组件会把它当"第 48 家"塞给引擎。
 *
 * 为什么这么实现（三条都踩过）：
 *   1. 引擎 `markplate.js` **要求 marks ≥ 2**（它靠"两个标互融"做过渡）→ 单标就传同一个标两次；
 *   2. 透明底**不逐帧抠**：把纸设成纯白 + CSS `mix-blend-mode: multiply`，白纸在视频上等于不存在，
 *      零逐帧成本（逐帧遍历 2M 像素设 alpha 会白吃十几毫秒）；
 *   3. rAF 循环**必须夹 dt + try/catch**：首帧时间戳可能早于 performance.now()（负 dt），
 *      切页面回来又是大跳；一帧抛错若在 requestAnimationFrame 之前，播放会**静默死掉**。
 * ========================================================================== */
(function (global) {
  'use strict';

  /* 引擎的字版版式（与 markplate 的 DEFAULTS 对齐；裁剪框要用它算） */
  const CW = 1280, CH = 720, COLS = 52, ROWS = 25, Y0 = 76, CS = CW / COLS;
  const DEFAULTS = {
    slug: 'openai',
    d: null,                 /* 自备 logo：SVG path 字符串（与 slug 二选一） */
    name: null,              /* 自备 logo 的显示名（caption 用） */
    text: '点墨：画面只有墨与纸两种像素，中间调由点的面积表达。字版承载形状，正文承载可读的字。',
    size: 0.14,              /* 占容器**宽度**的比例（0.14 = 14%） */
    corner: 'br',            /* tl / tr / bl / br / center */
    margin: 0.03,            /* 边距 = 容器宽 × 这个值 */
    dpr: 2,                  /* 覆盖层画布的像素密度上限 */
    fps: 24,                 /* 覆盖层的刷新上限（省电；引擎本身够快时也不会更慢） */
    reveal: 1.2,             /* 阅读波扫完的秒数（浮现） */
    rippleSpeed: 4.4,        /* 字不断浮动的快慢（引擎默认 4.4） */
    rippleAmp: 13,
    textPx: [26, 44],
    markSize: 700,           /* 标在设计空间里的显示尺寸（px） */
    markPx: 700,             /* 距离场分辨率 —— 与 markSize **必须分开**（主库记过这个坑） */
    caption: false,          /* 是否带名字（实墨点阵） */
    hud: false,              /* 是否带尺/进度/时间码 */
    blend: 'multiply',       /* 覆盖层的混合模式：白纸乘上去 = 看不见 */
    paused: false,
    onError: null,
  };

  let customIdSeq = 0;

  /* SVG 源码 → path d（多段合并）。只认 <path>，其余图元如实报错。 */
  function svgToPath(svgText) {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    if (doc.querySelector('parsererror')) throw new Error('SVG 解析失败');
    const ps = doc.querySelectorAll('path');
    if (!ps.length) throw new Error('这个 SVG 里没有 <path>（本组件只认 path；圆/矩形请先转成路径）');
    let d = '';
    ps.forEach(p => { const v = p.getAttribute('d'); if (v) d += (d ? ' ' : '') + v; });
    if (!d) throw new Error('SVG 里的 <path> 没有 d');
    return d;
  }

  function merge(base, o) {
    const r = {};
    for (const k in base) r[k] = base[k];
    for (const k in o) if (o[k] !== undefined) r[k] = o[k];
    return r;
  }

  function mount(target, opts) {
    if (!target) throw new Error('DotInkLogo.mount 需要目标元素');
    if (!global.MarkPlate || !global.MarkPlate.create) throw new Error('先引 markplate.js');
    const o = merge(DEFAULTS, opts || {});
    const icons = (global.DotInkMarks && global.DotInkMarks.icons) || (global.MarkPlate.ICONS || null);

    /* 自备 logo → 当"第 48 家"塞进 icons */
    let slug = o.slug, name = o.name;
    let iconMap = icons;
    if (o.d) {
      slug = '__custom' + (++customIdSeq);
      name = o.name || 'custom';
      iconMap = Object.assign({}, icons || {});
      iconMap[slug] = { title: name, d: o.d };
    }
    if (!iconMap) throw new Error('没有厂标数据：引 marks.js，或传 d（自备 SVG path）');

    /* 覆盖层：定位在容器里，不接鼠标事件，白纸用 multiply 乘掉 */
    const cv = document.createElement('canvas');
    cv.style.cssText = 'position:absolute;pointer-events:none;image-rendering:pixelated;' +
      'mix-blend-mode:' + o.blend + ';z-index:9';
    if (getComputedStyle(target).position === 'static') target.style.position = 'relative';
    target.appendChild(cv);

    /* 引擎画在一块离屏画布上（1280×720 的原始版式），我们再裁出标那一块 */
    const src = document.createElement('canvas');
    src.width = CW; src.height = CH;
    const mp = global.MarkPlate.create({
      canvas: src, icons: iconMap,
      marks: [[slug, name || slug], [slug, name || slug]],   /* ⚠ 引擎要求 ≥2，单标就传两次 */
      text: o.text,
      actSeconds: 9999,                                       /* 单标：不换幕 */
      zoom: [1, 1],                                           /* 标不推镜，只留引擎自带的微呼吸 */
      markSize: o.markSize, markPx: o.markPx,
      reveal: o.reveal,
      ripple: { amp: o.rippleAmp, len: 0.34, speed: o.rippleSpeed },
      paper: [255, 255, 255],                                 /* 纯白纸 → multiply 后等于透明 */
      paperTint: 0,                                           /* 角标不要底纹 */
      caption: o.caption ? undefined : false,
      hud: o.hud ? undefined : false,
    });

    const state = { t: 0, playing: !o.paused, raf: 0, last: 0, lastDraw: 0, err: null, frames: 0, ms: 0 };

    function layout() {
      const box = target.getBoundingClientRect();
      const w = box.width || 1;
      const px = Math.max(24, Math.round(w * o.size));
      const dpr = Math.min(o.dpr, global.devicePixelRatio || 1);
      cv.style.width = px + 'px'; cv.style.height = px + 'px';
      cv.width = Math.round(px * dpr); cv.height = Math.round(px * dpr);
      const m = Math.round(w * o.margin);
      cv.style.left = cv.style.top = cv.style.right = cv.style.bottom = 'auto';
      if (o.corner === 'tl') { cv.style.left = m + 'px'; cv.style.top = m + 'px'; }
      else if (o.corner === 'tr') { cv.style.right = m + 'px'; cv.style.top = m + 'px'; }
      else if (o.corner === 'bl') { cv.style.left = m + 'px'; cv.style.bottom = m + 'px'; }
      else if (o.corner === 'center') { cv.style.left = '50%'; cv.style.top = '50%'; cv.style.transform = 'translate(-50%,-50%)'; }
      else { cv.style.right = m + 'px'; cv.style.bottom = m + 'px'; }
      return px;
    }

    /* 裁剪框：与引擎 markSet() 同一套公式（标心 + 微呼吸 + 显示尺寸） */
    function cropBox() {
      const z = 1 + 0.025 * Math.sin(0.9 * state.t);            /* zoom [1,1] 时的 z */
      const side = o.markSize * z * 1.08;                       /* 8% 余量，别把笔画切掉 */
      const cx = CW / 2 + 12 * Math.sin(0.33 * state.t);
      const cy = (Y0 + ROWS * CS) / 2 + 9 * Math.sin(0.27 * state.t + 1.1);
      let x = cx - side / 2, y = cy - side / 2, w = side, h = side;
      if (x < 0) { w += x; x = 0; }
      if (y < 0) { h += y; y = 0; }
      if (x + w > CW) w = CW - x;
      if (y + h > CH) h = CH - y;
      return { x: x, y: y, w: w, h: h };
    }

    function frame() {
      const t0 = performance.now();
      try {
        mp.draw(state.t);
        const b = cropBox();
        const ctx = cv.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.drawImage(src, b.x, b.y, b.w, b.h, 0, 0, cv.width, cv.height);
        state.err = null;
      } catch (e) {
        state.err = 'draw 抛错: ' + (e.message || e);
        if (o.onError) try { o.onError(e); } catch (e2) {}
      }
      state.ms = performance.now() - t0;
      state.frames++;
    }

    function loop(now) {
      /* dt 夹到 [0, 0.1]：首帧时间戳可能早于 performance.now()（负），切页回来是大跳 */
      const dt = Math.max(0, Math.min(0.1, (now - state.last) / 1000));
      state.last = now;
      if (state.playing) {
        state.t += dt;                                     /* 时间**总是**按真实速度走 */
        if (now - state.lastDraw >= 1000 / Math.max(1, o.fps) - 1) {
          state.lastDraw = now; frame();                   /* 只是把重绘限到 fps */
        }
      }
      state.raf = requestAnimationFrame(loop);
    }

    const api = {
      el: cv, canvas: cv, opts: o, state: state,
      set: function (patch) {
        Object.assign(o, patch || {});
        if (patch && (patch.slug !== undefined || patch.d !== undefined)) {
          /* 换标要重建实例（引擎把 marks 固化在 create 里） */
          const next = merge(o, {});
          destroy(true);
          const again = mount(target, next);
          Object.assign(api, again);
        }
        layout();
        frame();
        return api;
      },
      layout: function () { layout(); frame(); return api; },
      pause: function () { state.playing = false; return api; },
      resume: function () { state.playing = true; return api; },
      toggle: function () { state.playing = !state.playing; return api; },
      seek: function (t) { state.t = t; frame(); return api; },
      destroy: destroy,
      info: function () { return { t: state.t, frames: state.frames, ms: +state.ms.toFixed(1), err: state.err, opts: o }; },
    };

    function destroy(silent) {
      if (state.raf) cancelAnimationFrame(state.raf);
      state.raf = 0;
      if (ro) ro.disconnect();
      if (cv.parentNode) cv.parentNode.removeChild(cv);
      if (!silent) { /* 让调用方知道实例已废 */ }
    }

    let ro = null;
    if (global.ResizeObserver) { ro = new ResizeObserver(function () { layout(); frame(); }); ro.observe(target); }
    layout();
    state.last = performance.now();
    frame();
    state.raf = requestAnimationFrame(loop);
    return api;
  }

  /* 声明式：<dot-ink-logo slug="openai" size="14%" corner="br" reveal="1.2" svg-src="x.svg"> */
  function defineElement(tag) {
    tag = tag || 'dot-ink-logo';
    if (global.customElements && !global.customElements.get(tag)) {
      global.customElements.define(tag, class extends HTMLElement {
        connectedCallback() {
          if (this.__api) return;
          const a = this.attributes;
          const num = (n, d) => (a[n] ? parseFloat(a[n]) : d);
          const sizeAttr = a.size ? (/%$/.test(a.size.value) ? parseFloat(a.size.value) / 100 : parseFloat(a.size.value)) : undefined;
          const o = {
            slug: a.slug ? a.slug.value : undefined,
            size: sizeAttr, corner: a.corner ? a.corner.value : undefined,
            reveal: a.reveal ? parseFloat(a.reveal.value) : undefined,
            text: a.text ? a.text.value : undefined,
            caption: a.caption ? a.caption.value !== 'false' : undefined,
          };
          const boot = (extra) => {
            try { this.__api = mount(this, Object.assign(o, extra || {})); }
            catch (e) { this.textContent = 'DotInkLogo: ' + e.message; }
          };
          if (a['svg-src']) {
            fetch(a['svg-src'].value).then(r => r.text()).then(txt => boot({ d: svgToPath(txt) }))
              .catch(e => { this.textContent = 'DotInkLogo: ' + e.message; });
          } else boot();
        }
        disconnectedCallback() { if (this.__api) { this.__api.destroy(); this.__api = null; } }
      });
    }
    return tag;
  }

  global.DotInkLogo = { mount: mount, defineElement: defineElement, svgToPath: svgToPath, DEFAULTS: DEFAULTS, version: '1.0.0' };
})(typeof window !== 'undefined' ? window : globalThis);
