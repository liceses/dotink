/* ============================================================================
 * site-core.mjs · 站点信息架构的纯函数层（零依赖）
 * ----------------------------------------------------------------------------
 * 单一真源：site/nav.json（分区 / 页面 / 一句话 / 页脚笔记 / 面包屑）
 * 生成：tools/build-site.mjs 把内容写进每页的 `<!-- site:* -->` 标记区
 * 验收：check/site.mjs 比对零漂移 + 无孤儿页 + aria-current 唯一
 *
 * 这里只做字符串：不读盘、不写盘。
 * ========================================================================== */

/* ── 工具 ───────────────────────────────────────────────────────────────── */

export const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

export const MARK = {
  meta: ['<!-- site:meta:begin -->', '<!-- site:meta:end -->'],
  boot: ['<!-- site:boot:begin -->', '<!-- site:boot:end -->'],
  head: ['<!-- site:head:begin -->', '<!-- site:head:end -->'],
  guide: ['<!-- site:guide:begin -->', '<!-- site:guide:end -->'],
  foot: ['<!-- site:foot:begin -->', '<!-- site:foot:end -->']
};

/* ── 校验 ───────────────────────────────────────────────────────────────── */

export function validateNav(nav) {
  const errs = [];
  if (!nav.brand || !nav.brand.name) errs.push('缺 brand.name');
  if (!Array.isArray(nav.sections) || !nav.sections.length) errs.push('sections 必须非空');
  const seenSlug = new Set(), seenFile = new Set();
  for (const s of nav.sections || []) {
    if (!/^[a-z][a-z0-9-]*$/.test(s.slug || '')) errs.push('分区 slug 不合法：' + s.slug);
    if (seenSlug.has(s.slug)) errs.push('分区 slug 重复：' + s.slug);
    seenSlug.add(s.slug);
    if (!s.name || !s.en) errs.push('分区缺 name/en：' + s.slug);
    if (!Array.isArray(s.pages) || !s.pages.length) errs.push('分区没有页面：' + s.slug);
    for (const p of s.pages || []) {
      if (!p.file || !/\.html?$/.test(p.file)) errs.push('页面 file 不合法：' + JSON.stringify(p.file));
      if (seenFile.has(p.file)) errs.push('页面重复登记：' + p.file);
      seenFile.add(p.file);
      if (!p.title) errs.push('页面缺 title：' + p.file);
      if (!p.desc) errs.push('页面缺 desc：' + p.file);
    }
  }
  for (const r of nav.resources || []) {
    if (!r.file || !r.title) errs.push('资源缺 file/title：' + JSON.stringify(r));
  }
  return errs;
}

/* 页面在分区里的位置。资源页（resources）也算「有归属」——否则它的面包屑会退成「首页」，
 * 而顶栏明明把它点亮成当前页（实测 theme.html 的面包屑写「点墨 / 首页」，与标题对不上）。 */
export function locate(nav, file) {
  for (const s of nav.sections) {
    const idx = s.pages.findIndex(p => p.file === file);
    if (idx >= 0) return { section: s, page: s.pages[idx], index: idx };
  }
  for (const r of nav.resources || []) {
    if (r.file === file) return { section: { slug: '__resource', name: r.title, pages: [r] }, page: r, index: 0, resource: true };
  }
  return null;
}

export const allPages = nav => nav.sections.flatMap(s => s.pages.map(p => Object.assign({ section: s }, p)));

/* ── meta 块 ────────────────────────────────────────────────────────────── */

export function renderMeta(nav, file, page) {
  const url = (nav.site || '') + file;
  const L = [
    '<meta name="description" content="' + esc(page.desc) + '">',
    '<meta property="og:type" content="website">',
    '<meta property="og:title" content="' + esc(page.title + ' · ' + nav.brand.name) + '">',
    '<meta property="og:description" content="' + esc(page.desc) + '">',
    '<meta property="og:site_name" content="' + esc(nav.brand.name + ' ' + nav.brand.en) + '">',
    '<meta name="theme-color" content="' + esc(nav.themeColor || '#F2F3F2') + '">'
  ];
  if (url) L.push('<meta property="og:url" content="' + esc(url) + '">');
  L.push('<link rel="canonical" href="' + esc(file) + '">');
  return L.join('\n');
}

/* ── 头 + 副条 ──────────────────────────────────────────────────────────── */

export function renderHead(nav, file) {
  const hit = locate(nav, file);
  const L = [];
  L.push('<header class="site-head"><div class="in">');
  L.push('  <a class="brand" href="' + esc(nav.brand.href || 'index.html') + '">' +
    '<img src="' + esc(nav.brand.icon || 'icon.svg') + '" alt="">' +
    esc(nav.brand.name) + '<small>' + esc(nav.brand.en) + '</small></a>');
  L.push('  <nav class="site-nav" aria-label="站点">');
  for (const s of nav.sections) {
    let cur = '';
    if (hit && hit.section.slug === s.slug) cur = s.pages.length > 1 ? ' aria-current="true"' : ' aria-current="page"';
    L.push('    <a href="' + esc(s.pages[0].file) + '"' + cur + '>' + esc(s.name) + '</a>');
  }
  for (const r of nav.resources || []) {
    const cur = r.file === file ? ' aria-current="page"' : '';
    L.push('    <a href="' + esc(r.file) + '"' + cur + '>' + esc(r.title) + '</a>');
  }
  L.push('  </nav>');
  L.push('  <div class="theme-switch" data-theme-switch></div>');
  L.push('</div></header>');

  /* minimal：首页是满屏舞台，只留一条顶栏，不要副条（不然压在画面上很吵） */
  if (nav.__minimal) return L.join('\n');

  /* 副条：面包屑恒有；子导航只在分区多于 1 页时出现 */
  L.push('<div class="site-sub"><div class="in">');
  const crumbs = ['<a href="' + esc(nav.brand.href || 'index.html') + '">' + esc(nav.brand.name) + '</a>'];
  if (hit) {
    crumbs.push('<span class="sep">/</span>');
    if (hit.section.pages.length > 1) {
      crumbs.push('<a href="' + esc(hit.section.pages[0].file) + '">' + esc(hit.section.name) + '</a>');
      crumbs.push('<span class="sep">/</span>');
    }
    crumbs.push('<span>' + esc(hit.page.title) + '</span>');
  } else {
    crumbs.push('<span class="sep">/</span><span>首页</span>');
  }
  L.push('  <nav class="crumbs" aria-label="面包屑">' + crumbs.join('') + '</nav>');
  if (hit && hit.section.pages.length > 1) {
    L.push('  <nav class="subnav" aria-label="' + esc(hit.section.name) + '">');
    for (const p of hit.section.pages) {
      const cur = p.file === file ? ' aria-current="page"' : '';
      L.push('    <a href="' + esc(p.file) + '"' + cur + '>' + esc(p.title) + '</a>');
    }
    L.push('  </nav>');
  }
  L.push('</div>');
  /* 页内目录：h2 有 id 时给一条横向跳转条（零 JS） */
  const toc = (nav.__toc || []).filter(t => t.id && t.text);
  if (toc.length >= 2) {
    L.push('<nav class="toc-jump" aria-label="本页目录">');
    for (const t of toc) L.push('  <a href="#' + esc(t.id) + '">' + esc(t.text) + '</a>');
    L.push('</nav>');
  }
  L.push('</div>');
  return L.join('\n');
}

/* ── 分区导览（首页 / spec 页）────────────────────────────────────────── */

export function renderGuide(nav) {
  const L = ['<div class="guide">'];
  for (const s of nav.sections) {
    L.push('  <a class="gcard" href="' + esc(s.pages[0].file) + '">');
    L.push('    <b>' + esc(s.name) + '</b><small>' + esc(s.en) + '</small>');
    L.push('    <p>' + esc(s.blurb || s.pages[0].desc) + '</p>');
    L.push('  </a>');
  }
  for (const r of nav.resources || []) {
    L.push('  <a class="gcard" href="' + esc(r.file) + '">');
    L.push('    <b>' + esc(r.title) + '</b><small>THEME</small>');
    L.push('    <p>' + esc(r.blurb || r.desc) + '</p>');
    L.push('  </a>');
  }
  L.push('</div>');
  return L.join('\n');
}

/* ── 页脚 ───────────────────────────────────────────────────────────────── */
export function renderFoot(nav, file, page) {
  const L = [];
  L.push('<footer class="site-foot"><div class="in">');
  const bits = [];
  if (page && page.footNote) bits.push('<span>' + esc(page.footNote) + '</span>');
  else bits.push('<span>' + esc(nav.brand.name + ' ' + nav.brand.en + ' · ' +
    (nav.brand.tagline || '画面只有墨与纸两色像素')) + '</span>');
  L.push('  ' + bits.join(''));
  const links = [];
  for (const l of (page && page.footLinks) || []) links.push('<a href="' + esc(l.href) + '">' + esc(l.label) + '</a>');
  for (const l of nav.foot.links || []) links.push('<a href="' + esc(l.href) + '">' + esc(l.label) + '</a>');
  L.push('  <span class="links">' + links.join('\n    ') + '</span>');
  L.push('</div></footer>');
  return L.join('\n');
}

/* ── h2 的 id（只加属性，不改文本）───────────────────────────────────────── */

/* 跳转条的标签：h2 正文里的括注是**给正文读者**的补充说明，放进横向跳转条会把整条撑宽
 * （实测 transition.html 的「键盘（焦点在画布或页面上时）」）—— 这里只取主干。 */
export function tocText(s) {
  const t = s.replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  const core = t || s.trim();
  return core.length > 20 ? core.slice(0, 19) + '…' : core;
}

export function tagHeadings(html) {
  let n = 0;
  const out = html.replace(/<h2(?![^>]*\sid=)([^>]*)>/g, (m, attrs) => {
    n++;
    return '<h2 id="sec-' + n + '"' + attrs + '>';
  });
  const toc = [];
  for (const m of out.matchAll(/<h2[^>]*\sid="([^"]+)"[^>]*>([\s\S]*?)<\/h2>/g)) {
    toc.push({ id: m[1], text: tocText(m[2].replace(/<[^>]+>/g, '')) });
  }
  return { html: out, changed: n > 0, toc };
}

/* ── 把块写进标记区（幂等）──────────────────────────────────────────────── */

export function fillBlock(html, marker, body) {
  const [B, E] = MARK[marker];
  const i = html.indexOf(B), j = html.indexOf(E);
  if (i < 0 || j < 0) return { html, ok: false, why: '缺标记 ' + B };
  if (j < i) return { html, ok: false, why: '标记顺序错 ' + B };
  const head = html.slice(0, i + B.length);
  const tail = html.slice(j);
  return { html: head + '\n' + body + '\n' + tail, ok: true };
}
