#!/usr/bin/env node
/* 点墨 · 套印片导出（tools/press-reel.html → mp4）
 * ============================================================================
 * 用法：
 *   node tools/press-reel.mjs                        # 默认 17s / 1920×1080 / 六色，出 media/_release/press-reel.mp4
 *   node tools/press-reel.mjs --inks cmyk --angles same --crf 20   # 四色对照版
 *   node tools/press-reel.mjs --still 3.8 --out x.png      # 只出一张静帧
 *   node tools/press-reel.mjs --report                    # 顺带打印抽检读数
 *
 * 为什么要有这个驱动，而不是"在浏览器里录屏"：
 *   套印片是**逐帧确定性**的（press.js 的 regOf 是纯函数，无 Math.random），
 *   所以它可以按 t 精确重放。录屏会被掉帧、被窗口尺寸、被 GPU 缩放污染；
 *   逐帧取 toDataURL 再喂 ffmpeg，出来的每一帧都等于 __reel.frame(t) 的返回值。
 *
 * 依赖：node ≥ 22（全局 fetch / WebSocket）、ffmpeg 在 PATH 或 --ffmpeg 指定、
 *       本机装了 Edge（或 --chrome 指定任意 Chromium）。
 * 不依赖任何 npm 包：静态服务、CDP 客户端都在本文件里。
 * ========================================================================== */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

/* ── 参数 ───────────────────────────────────────────────────────────────── */
function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const n = argv[i + 1];
    if (n === undefined || n.startsWith('--')) { o[k] = true; continue; }
    o[k] = n; i++;
  }
  return o;
}
const A = args(process.argv.slice(2));
/* 默认 17s = 四段 × 4.25s。⚠ 片源的套印曲线（driftAt / PLATE_IN / PLATE_OUT）是**按秒**写死的，
   写的就是这条 17s 的分镜；改 --dur 会同时改 SPAN（每段长度）但**不改曲线**，于是曲线会压在错误的位置。
   要另一条时长就同时改 press-reel.html 的 driftAt 注释与这三个表，别只改命令行。 */
const DUR = +(A.dur || 17);
const FPS = +(A.fps || 30);
/* ★ 母版 1920×1080 / cell 7 / scale 1 = 274 × 154 格。
   只有这一档，字版的版面设计格（274 × 101.6）与真实格严丝合缝；
   1280 CSS × 1.5 scale 的 backing 同样是 1920×1080，但只有 183×103 格，
   字版被缩到 0.67 倍，序号与副题碎成网点。 */
const W = +(A.w || 1920), H = +(A.h || 1080);
const CELL = +(A.cell || 7), SCALE = +(A.scale || 1);
const CAP = A.cap || '';
/* 素材：多段用 | 分隔，`--clips "01 街景~../media/a.png~4.25|02 湖山~../media/b.png~3"`；
   单条可以只给路径 `--clips a.png`（标签由文件名推出来）。
   ⚠ 逗号串（a.png,b.png）不行 —— parseClips 只按 | 切，逗号串会被当成一个路径，载入直接失败。
   每个条目是「label~图集~秒数」；图集由 tools/press-clip.mjs 生成（视频 → 274×102 一格一像素的图集）。
   给了 clips 之后，片长由素材自己决定（DUR 默认值失效），末尾自动补一张字版收尾（长度 --type，默认 3s）。 */
const CLIPS = A.clips === undefined ? '' : String(A.clips);
/* 偏差峰值。默认 8px 是按 17s 分镜量的（略超一个 7px 点距，重影才成立）；
   换素材、换时长时它也该跟着内容走 —— 长片可以到 10–12，短片 5–6 就够。 */
const AMP = A.amp === undefined ? '' : String(A.amp);
const TYPE = A.type === undefined ? '' : String(A.type);
const INKSET = String(A.inks || 'cmyk');   /* cmyk | hex（Hexachrome 六色） */
const SMODE = String(A.mode || 'free');   /* free（默认）| base：base 在 maxfrac 1/√2 下会退化成四色，见页面注释 */
const SEP = String(A.sep || 'cov');       /* cov（覆盖域，默认）| formula（UCR 公式）| nnls（密度域 NNLS） */
const ANGLES = String(A.angles || 'rose');/* rose（15/75/0/45，默认，分色准）| same（四版同 45°：圆盘同心，独立模型会偏亮） */
/* 总墨量上限（各版墨量之和）。⚠ 注意它和 press 报告的 tac 不是同一个量：
   limitTac 压的是**墨量 w**，而 measure 报的 tac 是**覆盖率之和**。六版时默认 2.4 极紧
   （平均每版只许 0.4），会把覆盖域分色解出来的墨再等比砍掉一大截 —— 画面整体发白。 */
const TAC = A.tac === undefined ? null : Number(A.tac);
/* 满墨半径 / 点距：0.5 = 点与点相切（π/4 ≈ 78.5% 覆盖），1/√2 = 圆盘并集盖满方格（≈98.8%）。
   成片默认取 1/√2：套印样张的「实地」必须是实地，否则满墨的暗部印出来还是筛子。 */
const MAXFRAC = Number(A.maxfrac || 0.70710678);
const FFMPEG = A.ffmpeg || 'ffmpeg';
/* 默认 qp/crf 18：libx264rgb 下是**接近无损**的一档（qp0 才是真无损）。
   实测同一帧：qp0 解码回 15 色格点集分毫不差；qp12 已有 13.9% 像素偏离格点集 >6；
   crf18 yuv420 有 58% 偏离。所以这一档是「肉眼无损、文件还收得住」的折中。 */
const CRF = String(A.crf || 18);
/* 像素格式：套印片的核心现象是**网点边缘一两像素宽的漏色**，而 yuv420 会把色度
   按 2×2 下采样 —— 那一两像素的彩边正好被抹掉。所以 libx264 这一路默认 yuv444p（libx264rgb 路直接 RGB 直编，连色度变换都没有）；
   yuv420p 只是「最兼容」的那个选择，不是「最保真」的那个。--pixfmt yuv420p 可退回。 */
const PIXFMT = String(A.pixfmt || "yuv444p");
const STILL = A.still === undefined ? null : +A.still;
const OUT = path.resolve(String(A.out || (STILL === null
  ? 'media/_release/press-reel.mp4' : 'media/_release/press-reel.png')));

const CHROME_CANDIDATES = [
  A.chrome,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.md': 'text/markdown; charset=utf-8',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

function die(msg) { console.error('✗ ' + msg); process.exit(1); }

/* ── ① 内建静态服务（临时端口，导出结束即关） ───────────────────────────── */
function serve() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const f = path.join(root, p);
      if (!f.startsWith(root) || !fs.existsSync(f) || !fs.statSync(f).isFile()) {
        res.writeHead(404); res.end('not found'); return;
      }
      const st = fs.statSync(f);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream',
        'Content-Length': st.size,
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(f).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

/* ── ② 起一个 headless Chromium ──────────────────────────────────────────
 * ⚠ 两个实测坑（Windows + Edge 157）：
 *   ① --remote-debugging-port=0 不可用 —— 它把真实端口印在 stderr，
 *      但 Edge 这个版本 stderr 是**空的**（Start-Process 重定向到文件也是 0 字节），
 *      拿不到端口就等于连不上。所以要自己选一个空闲端口传进去。
 *   ② 启动进程会**立刻退出**（真正的浏览器进程是它 hand-off 出去的那个），
 *      所以不能把"子进程 exit"当成失败 —— 只以"端口能不能应答"为准。 */
function freePort() {
  return new Promise(resolve => {
    const s = http.createServer();
    s.listen(0, '127.0.0.1', () => { const q = s.address().port; s.close(() => resolve(q)); });
  });
}

async function launch() {
  const exe = CHROME_CANDIDATES.find(p => fs.existsSync(p));
  if (!exe) die('找不到 Edge/Chrome，用 --chrome <path> 指定');
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'dotink-reel-'));
  const port = await freePort();
  const ps = spawn(exe, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--user-data-dir=' + prof, '--remote-debugging-port=' + port, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 150; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + port + '/json/version');
      if (r.ok) return { ps, port, prof, version: (await r.json()).Browser };
    } catch (e) { /* 还没起来 */ }
    await sleep(200);
  }
  die('Chromium 30s 内没有在端口 ' + port + ' 上应答（被安全软件拦了？试试 --chrome 指向别的 Chromium）');
}

/* ── ③ 一个够用的 CDP 客户端 ────────────────────────────────────────────── */
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pend = new Map(); this.ev = new Map();
    ws.addEventListener('message', e => {
      const m = JSON.parse(e.data);
      if (m.id && this.pend.has(m.id)) {
        const { res, rej } = this.pend.get(m.id); this.pend.delete(m.id);
        m.error ? rej(new Error(m.error.message)) : res(m.result);
      } else if (m.method && this.ev.has(m.method)) this.ev.get(m.method)(m.params);
    });
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pend.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  on(method, fn) { this.ev.set(method, fn); }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr, awaitPromise: true, returnByValue: true, userGesture: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
}

async function connect(port) {
  let tabs = [];
  for (let i = 0; i < 60; i++) {
    try { tabs = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json(); } catch { tabs = []; }
    if (tabs.length) break;
    await sleep(200);
  }
  const page = tabs.find(t => t.type === 'page');
  if (!page) die('Chromium 没有可用的 page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', () => rej(new Error('ws 连不上'))); });
  return new CDP(ws);
}

/* ── ④ 主流程 ───────────────────────────────────────────────────────────── */
const t0 = Date.now();
const srv = await serve();
const port = srv.address().port;
const url = 'http://127.0.0.1:' + port + '/tools/press-reel.html'
  + '?w=' + W + '&h=' + H + '&cell=' + CELL + '&scale=' + SCALE
  /* dur 只在**显式给了**的时候才传：传了就等于钉死片长，素材段会被拉伸/压缩；
     不给则页面按素材自己算（每段 4.25s + 字版 3s）。 */
  + (A.dur === undefined ? '' : '&dur=' + DUR)
  + (CAP ? '&cap=' + CAP : '')
  + (AMP ? '&amp=' + AMP : '')
  + (TYPE ? '&type=' + TYPE : '')
  + (CLIPS ? '&clips=' + encodeURIComponent(CLIPS) : '')
  + '&inks=' + INKSET + '&mode=' + SMODE + '&sep=' + SEP + '&angles=' + ANGLES
  + '&maxfrac=' + MAXFRAC
  + (TAC === null ? '' : '&tac=' + TAC);
console.log('· 页面 ' + url);

const browser = await launch();
let cdp;
try {
  cdp = await connect(browser.port);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  const loaded = new Promise(r => cdp.on('Page.loadEventFired', r));
  await cdp.send('Page.navigate', { url });
  await Promise.race([loaded, sleep(20000)]);
  for (let i = 0; i < 100; i++) {
    const ok = await cdp.eval('!!(window.__reel && window.__reel.ready)').catch(() => false);
    if (ok) break;
    await sleep(150);
  }
  /* 素材载入状态：少一段不是「黑一帧」，是整段时间轴错位 —— 直接拒跑。 */
  if (CLIPS) {
    const cl = JSON.parse(await cdp.eval('__reel.clips()'));
    if (cl.fail.length) die('素材载入失败：' + cl.fail.join('、') + '（检查 .json sidecar 与路径是否在仓库内）');
    const bad = cl.list.filter(c => !c.ready);
    if (bad.length) die('素材没准备好：' + bad.map(c => c.name).join('、'));
    console.log('· 素材 ' + cl.n + ' 段：' + cl.list.map(c => c.idx + ' ' + c.name + '（' + c.n + ' 帧 ' + c.tile + '）').join(' · '));
  }
  const meta = JSON.parse(await cdp.eval('JSON.stringify({w:__reel.w,h:__reel.h,cols:__reel.cols,rows:__reel.rows,dur:__reel.dur,fps:__reel.fps,inks:__reel.inks,sep:__reel.sep,angles:__reel.angles,curve:__reel.curve})'));
  console.log('· 出图 ' + meta.w + '×' + meta.h + ' · ' + meta.cols + '×' + meta.rows + ' 格 · ' + meta.dur + 's @' + meta.fps
    + ' · ' + (meta.inks || '?') + ' 版 · 分色 ' + meta.sep + ' · 网角 ' + meta.angles
    + (meta.curve ? ' · 满墨覆盖率 ' + (meta.curve.maxCov * 100).toFixed(1) + '%' : ''));

  fs.mkdirSync(path.dirname(OUT), { recursive: true });

  if (STILL !== null) {
    const d = await cdp.eval('__reel.frame(' + STILL + ')');
    fs.writeFileSync(OUT, Buffer.from(d.slice(d.indexOf(',') + 1), 'base64'));
    console.log('✓ 静帧 ' + OUT + '（t=' + STILL + 's）');
  } else {
    /* ★ 帧数用**页面报的** dur，不是命令行那个：给了 --clips 又没给 --dur 时，
       片长是页面按素材算出来的（每段 4.25s + 字版 3s），命令行那个 17 只是兜底默认值。
       用本地 DUR 截片会把 11.5 秒的片子导出到 17 秒，后半段全是重复的末帧。 */
    const n = Math.round(Number(meta.dur) * FPS);
    /* 编码器三选一，差别是**色度能不能守住**：
         libx264   + yuv420p  最小最兼容，但色度 2×2 下采样 → 网点边缘的漏色彩边被抹掉
         libx264   + yuv444p  色度全采样，但 yuv 仍然是有损色度变换
         libx264rgb+ rgb24    **RGB 直编，无色度变换**：实测 qp0 解码回来仍是精确的 15 色格点集
       套印层是「颜色只在 2^N 个格点上」的体裁，所以默认走第三条：色数本身就是判据，
       编码把 15 色糊成 30 万色，等于把这一层的立论吃掉。--x264rgb 0 可退回。 */
    const RGB = A.x264rgb === undefined ? true : !!+(A.x264rgb);
    const codec = RGB ? 'libx264rgb' : 'libx264';
    const pf = RGB ? 'rgb24' : PIXFMT;
    const q = RGB ? ['-qp', CRF] : ['-crf', CRF];
    const ff = spawn(FFMPEG, [
      '-y', '-v', 'error',
      '-f', 'image2pipe', '-framerate', String(FPS), '-i', 'pipe:0',
      '-c:v', codec, '-preset', 'slow'].concat(q, [
      '-pix_fmt', pf, '-movflags', '+faststart', OUT,
    ]), { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise((res, rej) => ff.on('exit', c => c === 0 ? res() : rej(new Error('ffmpeg 退出码 ' + c))));
    let bytes = 0;
    for (let i = 0; i < n; i++) {
      const t = i / FPS;
      const data = await cdp.eval('__reel.frame(' + t.toFixed(5) + ')');
      const buf = Buffer.from(data.slice(data.indexOf(',') + 1), 'base64');
      bytes += buf.length;
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      if (i % 30 === 29 || i === n - 1) {
        const el = (Date.now() - t0) / 1000;
        process.stdout.write('\r  帧 ' + (i + 1) + '/' + n + '  ' + (el / (i + 1) * 1000).toFixed(0) + ' ms/帧  ' + (bytes / 1048576).toFixed(1) + ' MB 已送');
      }
    }
    ff.stdin.end();
    await done;
    process.stdout.write('\n');
    console.log('✓ 成片 ' + OUT + '（' + (fs.statSync(OUT).size / 1048576).toFixed(2) + ' MB · ' + n + ' 帧 · ' + codec + '/' + pf + ' · qp ' + CRF + ' · ' + ((Date.now() - t0) / 1000).toFixed(1) + 's）');
  }

  if (A.report || STILL !== null) {
    const durEff = Number(meta.dur);
    const marks = [0.8, durEff * 0.32, durEff * 0.58, durEff * 0.83, durEff * 0.995];
    console.log('· 抽检（t → 色数 / 漏色 / 套印偏差 / 每墨叠印）：');
    for (const t of marks) {
      await cdp.eval('__reel.frame(' + t.toFixed(3) + ')');
      const m = JSON.parse(await cdp.eval('__reel.measure()'));
      console.log('  t=' + t.toFixed(2) + 's  ' + m.colors + '色  fringe ' + (m.fringe * 100).toFixed(1) + '%'
        + '  reg ' + m.regPx.toFixed(2) + 'px/' + m.regRot.toFixed(2) + '°  perInk ' + m.perInk
        + '  ' + m.plates.join(' '));
    }
  }
} finally {
  try { cdp && cdp.ws.close(); } catch {}
  try { browser.ps.kill(); } catch {}
  srv.close();
  await sleep(120);
  try { fs.rmSync(browser.prof, { recursive: true, force: true }); } catch {}
}
