#!/usr/bin/env node
/* 点墨 · 视频 → 格子图集（tools/press-clip.mjs）
 * ============================================================================
 * 用法：
 *   node tools/press-clip.mjs --in a.mp4 --out media/a.atlas.png
 *   node tools/press-clip.mjs --in a.mp4 --out a.png --cells 274x102 --fps 30 --dur 4.25
 *   node tools/press-clip.mjs --in a.mp4 --out a.png --start 2.5 --cx 0.44 --cy 0.46
 *   node tools/press-clip.mjs --in a.mp4 --out a.png --fit contain    # 补纸色边，不裁
 *   node tools/press-clip.mjs --in a.mp4 --out a.png --pad            # 源不够长就克隆末帧
 *   node tools/press-clip.mjs --in a.mp4 --out a.png --ffmpeg D:/tools/ffmpeg/bin/ffmpeg.exe
 *
 * 参数：
 *   --in <video>        源视频（必需）
 *   --out <png>         图集 PNG（必需）；同名 .json 是 sidecar
 *   --cells WxH         每格（每帧）像素宽高，默认 274x102 —— 母版一格 = 6 px，274×102 正好一格一像素
 *   --fps <n>           目标帧率，默认 30
 *   --dur <s>           取多少秒，默认 4.25
 *   --start <s>         从第几秒开始，默认 0
 *   --cx/--cy <0..1>    裁切（cover）或补边（contain）的中心，默认 0.5 / 0.5
 *   --fit cover|contain cover 裁满（默认），contain 补纸色 rgb(242,243,242)
 *   --pad               源实际帧数不足 N 时，克隆末帧补齐（sidecar 会写 padded）
 *   --ffmpeg <path>     ffmpeg 路径（ffprobe 从同目录推导）
 *   --json <path>       sidecar 路径，默认把 --out 的扩展名换成 .json
 *   --verbose           把 ffmpeg 的 stderr 尾巴打出来
 *
 * 为什么是「格子图集」而不是「逐帧图片」：
 *   套印片引擎（press-reel.html）不是按像素分色的，是**按格**分色的 —— 每一格只吃
 *   这一格里所有像素的平均色，然后拿这个平均色去解四个版的墨量。也就是说，比一格
 *   更细的信息在分色那一步就被平均掉了，**根本到不了成片**。
 *   所以视频进片源的最优形态不是「每帧一张 1080p」，而是「每帧 274×102、正好一格
 *   一像素」：掉到格分辨率是零损失（分色只吃格均值），内存却小两个数量级
 *   （128 帧 × 274×102×4B ≈ 14 MB，换成 1080p 是 1.06 GB）。
 *   再把 N 帧拼成**一张** PNG（cols×rows，行优先），浏览器一次 load 就拿到整段画面，
 *   免掉 N 次网络请求与 N 次 decode —— 图集在 canvas 上就是一次 drawImage 的裁切。
 *
 * 为什么缩放必须是 flags=area（盒平均）：
 *   area 是把源图一块区域的像素**做算术平均**，而「一格 = 一格子的平均色」正是分色的
 *   定义域。换成 bicubic/lanczos 会在格边界引入振铃（ringing）—— 一个白点旁边的一格
 *   会被压暗、再旁边一格被提亮，格均值整体偏移，解出来的墨量跟着漂。
 *   注意 format=rgb24 必须放在 scale **之前**：这样平均是在 sRGB 8bit 上做的，
 *   与引擎「把图贴到大画布上再取格均值」的口径一致（实测两种顺序像素差 44%）。
 *
 * 依赖：node ≥ 22（只用内建模块）、ffmpeg + ffprobe（PATH 或 --ffmpeg）。
 * 不依赖任何 npm 包。
 * ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

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

/* 纸色：contain 的补边色，也是图集里没被帧占满的空格色。必须等于 press-reel.html 的
   PAPER (242,243,242)，否则 contain 出来的图集在版心上会出现一圈比纸更亮的框。 */
const PAPER = '0xF2F3F2';
const PAPER_RGB = [242, 243, 242];
/* Edge 的 canvas / Image 上限是 16384，留一半余量：一张 8000×8000 的图集在
   移动端与低端 GPU 上还吃得下，再大就会出现纹理采样静默降级。 */
const MAXPX = 8000;

const CELLS = String(A.cells || '274x102');
const FPS = Number(A.fps === undefined ? 30 : A.fps);
const DUR = Number(A.dur === undefined ? 4.25 : A.dur);
const START = Number(A.start === undefined ? 0 : A.start);
const CX = Number(A.cx === undefined ? 0.5 : A.cx);
const CY = Number(A.cy === undefined ? 0.5 : A.cy);
const FIT = String(A.fit || 'cover');
const PAD = !!A.pad;
const FFMPEG = String(A.ffmpeg || 'ffmpeg');
const IN = A.in === undefined ? null : path.resolve(String(A.in));
const OUT = A.out === undefined ? null : path.resolve(String(A.out));
const JSON_OUT = A.json === undefined ? null : path.resolve(String(A.json));
const VERBOSE = !!A.verbose;

function die(msg) {
  console.error('✗ ' + msg);
  process.exit(1);
}

/* ── ① 参数校验（全部在起 ffmpeg 之前做，错得早才好读） ─────────────────── */
const cm = /^(\d+)x(\d+)$/.exec(CELLS);
if (!cm) die('--cells 要写成 宽x高（像素），例如 274x102；给的是 "' + CELLS + '"');
const TW = Number(cm[1]), TH = Number(cm[2]);
if (TW < 1 || TH < 1) die('--cells 的宽高必须是正整数：' + CELLS);
if (!Number.isFinite(FPS) || FPS <= 0 || FPS > 240) die('--fps 要在 (0, 240] 之间：' + A.fps);
if (!Number.isFinite(DUR) || DUR <= 0) die('--dur 必须是正数（秒）：' + A.dur);
if (!Number.isFinite(START) || START < 0) die('--start 不能是负数：' + A.start);
if (!(CX >= 0 && CX <= 1)) die('--cx 要在 0..1 之间：' + A.cx);
if (!(CY >= 0 && CY <= 1)) die('--cy 要在 0..1 之间：' + A.cy);
if (FIT !== 'cover' && FIT !== 'contain') die('--fit 只能是 cover 或 contain：' + FIT);
if (!IN) die('缺 --in <视频>');
if (!OUT) die('缺 --out <图集.png>');
if (!fs.existsSync(IN)) die('源文件不存在：' + IN);
if (fs.statSync(IN).isDirectory()) die('--in 是个目录，要一个视频文件：' + IN);

/* 帧数：契约要求**恰好** N 帧，少一帧就报错。round 而不是 floor：
   4.25s × 30fps = 127.5 → 128，与 4.25s 这个「四段 × 4.25s」的片长口径一致。 */
const N = Math.round(DUR * FPS);
if (N < 1) die('算出来是 0 帧（--dur ' + DUR + ' × --fps ' + FPS + '），没有东西可出');

/* ── ② 找 ffmpeg / ffprobe ──────────────────────────────────────────────── */
/* ffprobe 从 ffmpeg 的**同一目录**推导（--ffmpeg 指到别处也照样推）。
   裸名字（没有路径分隔符）就当它在 PATH 上，拼成 ffprobe / ffprobe.exe。 */
function deriveProbe(ff) {
  const ext = path.extname(ff);
  const dir = path.dirname(ff);
  if (dir === '.' || dir === '') return 'ffprobe' + ext;
  return path.join(dir, 'ffprobe' + ext);
}
const FFPROBE = deriveProbe(FFMPEG);
if (/[\\/]/.test(FFMPEG) && !fs.existsSync(FFMPEG)) {
  die('找不到 ffmpeg：' + FFMPEG + '（用 --ffmpeg <路径> 指定，或让它出现在 PATH 上）');
}
if (/[\\/]/.test(FFPROBE) && !fs.existsSync(FFPROBE)) {
  die('找不到 ffprobe：' + FFPROBE + '（它要和 ffmpeg 放在同一目录；用 --ffmpeg 指向那个目录里的 ffmpeg）');
}

function run(bin, list) {
  return new Promise(resolve => {
    const p = spawn(bin, list, { windowsHide: true });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('error', e => resolve({ code: -1, out, err: err + '\n' + e.message, spawnError: e }));
    p.on('close', code => resolve({ code, out, err }));
  });
}

/* ── ③ ffprobe：源分辨率、时长、有没有视频流 ─────────────────────────────── */
const PROBE_ARGS = [
  '-v', 'error',
  '-show_entries', 'stream=codec_type,width,height,duration,nb_frames,avg_frame_rate,r_frame_rate:format=duration',
  '-of', 'json', IN,
];
async function probe() {
  const r = await run(FFPROBE, PROBE_ARGS);
  if (r.spawnError) {
    die('跑不起来 ffprobe（' + FFPROBE + '）：' + r.spawnError.message
      + '（用 --ffmpeg 指向装了 ffprobe 的目录）');
  }
  if (r.code !== 0) {
    const tail = r.err.trim().split(/\r?\n/).filter(Boolean).slice(-2).join(' / ');
    die('ffprobe 读不了这个文件：' + IN + (tail ? ' —— ' + tail : ''));
  }
  let j;
  try { j = JSON.parse(r.out); } catch { die('ffprobe 没吐出 JSON，文件可能坏了：' + IN); }
  const streams = Array.isArray(j.streams) ? j.streams : [];
  const v = streams.find(s => s.codec_type === 'video');
  if (!v) {
    const kinds = streams.map(s => s.codec_type).filter(Boolean);
    die('没有视频流：' + path.basename(IN)
      + (kinds.length ? '（ffprobe 只看到 ' + kinds.join(' / ') + '）' : '（ffprobe 一个流都没看到，像是纯音频或纯字幕文件）'));
  }
  if (!v.width || !v.height) die('视频流没有分辨率（损坏的文件？）：' + path.basename(IN));

  /* 时长三档兜底：容器 > 流 > nb_frames/fps。容器时长偶尔缺（某些 webm），
     流时长偶尔缺（某些 ts），最后用帧数反推。 */
  const pickNum = x => {
    const n = Number(x);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const fpsStr = String(v.avg_frame_rate || v.r_frame_rate || '0/1');
  const [fn, fd] = fpsStr.split('/').map(Number);
  const srcFps = fn > 0 && fd > 0 ? fn / fd : null;
  const dur = pickNum(j.format && j.format.duration) || pickNum(v.duration)
    || (srcFps && pickNum(v.nb_frames) ? Number(v.nb_frames) / srcFps : null);
  if (!dur) die('读不出时长：' + path.basename(IN) + '（ffprobe 在容器和流里都找不到 duration）');
  return { w: Number(v.width), h: Number(v.height), dur, fps: srcFps };
}

/* ── ④ 图集网格 ───────────────────────────────────────────────────────────
 * cols = ceil(sqrt(N))，按**格数**取方，而不是按像素取方：
 *   N=128 → 12×11 = 3288×1122（契约里给的示例就是这一档）
 *   若按像素方（cols = ceil(sqrt(N × tileH / tileW))），128 帧会排成 7×19 = 1918×1938。
 * 两种都放得进 8000px，浏览器侧也只是 tx=(k%cols)*tw / ty=floor(k/cols)*th 的一次裁切，
 * 所以这里按契约的示例走「格数方」，让 (k % cols, k / cols) 心算更短。
 * 8000px 上限优先于这条：列数被上限夹住时自动减列增行（帧放不下就报错，不缩格）。 */
function layout(n) {
  const maxCols = Math.floor(MAXPX / TW);
  const maxRows = Math.floor(MAXPX / TH);
  if (maxCols < 1) die('--cells 宽 ' + TW + 'px 超过单张图集上限 ' + MAXPX + 'px');
  if (maxRows < 1) die('--cells 高 ' + TH + 'px 超过单张图集上限 ' + MAXPX + 'px');
  const cap = maxCols * maxRows;
  if (n > cap) {
    die('帧太多：' + n + ' 帧 × ' + TW + '×' + TH + 'px 一张图集放不下（上限 ' + cap
      + ' 帧 = ' + maxCols + '×' + maxRows + ' 格，' + MAXPX + 'px 见方）。'
      + '把 --dur 或 --fps 调小，或把 --cells 调小');
  }
  /* 先按格数取方，再让 8000px 上限夹一道；夹完仍放不下就是上面那个 die。 */
  const cols = Math.min(maxCols, Math.max(Math.ceil(Math.sqrt(n)), Math.ceil(n / maxRows)));
  const rows = Math.ceil(n / cols);
  return { cols, rows };
}

/* ── ⑤ 滤镜链 ─────────────────────────────────────────────────────────────
 * 顺序是有讲究的，每一段都踩过：
 *   fps=N        恒定帧率用 fps 滤镜，**不是** -vsync（ffmpeg 7 已移除，会报
 *                Unrecognized option）。
 *   trim=N       把「多取的那一点」切掉，保证恰好 N 帧进 tile。headroom 见下面 -t。
 *   showinfo     数帧用：tile 在帧数不足时会**用 :color 静默补满空格**（实测
 *                10 帧进 4×4 会出 16 格、后 6 格是纸色、退出码还是 0），
 *                所以「够不够 N 帧」只能自己数，不能让 ffmpeg 替你判。
 *                用**命名实例**（showinfo@real / showinfo@total）分成两路数：
 *                真实帧在 tpad 之前数，补完后的总帧在 tpad 之后数 —— 一个名字数一次，
 *                否则两个 showinfo 的输出混在一起，分不清是源短还是链子坏了。
 *   format=rgb24 必须在 scale 之前 —— area 平均要在 sRGB 8bit 上做，与引擎取格均值的口径一致。
 *   scale=…:flags=area  盒平均，一格正好一格子的平均色（换 bicubic 会振铃、格均值偏移）。
 *   setsar=1     不加的话 crop/tile 会带着源 SAR 走（testsrc 是 1232/1233），
 *                出来的 PNG 像素是方的但元数据说不是。
 *   crop / pad   cover 裁满；contain 用纸色补边。
 *   tpad         只有 --pad 才加：末帧克隆（stop_mode=clone），再用 trim 卡死 N。
 *   tile         行优先把 N 帧排进 cols×rows；:color 让没占满的格子是纸色而不是黑。
 *                 ★ -frames:v 1 必须放在 tile **之后**：tile 收满一屏才吐一帧。
 *                先 -frames:v N 再 tile 会吐 N 张单帧（文件名冲突、或只落第一帧）。
 */
function chain({ cols, rows, pad }) {
  const cx = String(CX), cy = String(CY);
  const fit = FIT === 'cover'
    ? 'scale=' + TW + ':' + TH + ':force_original_aspect_ratio=increase:flags=area,setsar=1,'
      + 'crop=' + TW + ':' + TH + ':(iw-ow)*' + cx + ':(ih-oh)*' + cy
    : 'scale=' + TW + ':' + TH + ':force_original_aspect_ratio=decrease:flags=area,setsar=1,'
      + 'pad=' + TW + ':' + TH + ':(ow-iw)*' + cx + ':(oh-ih)*' + cy + ':color=' + PAPER;
  const parts = [
    'fps=' + FPS,
    'trim=end_frame=' + N,
    'showinfo@real=checksum=0',
    'format=rgb24',
    fit,
  ];
  if (pad) {
    parts.push('tpad=stop=-1:stop_mode=clone', 'trim=end_frame=' + N, 'showinfo@total=checksum=0');
  }
  parts.push('tile=' + cols + 'x' + rows + ':color=' + PAPER);
  return parts.join(',');
}

/* 按 showinfo 的**实例名**数帧。ffmpeg 打的是
   "[showinfo@real @ 000001a4…] n:   7 pts:      7 pts_time:0.233 …"，
   名字在日志里原样出现，所以两路 showinfo 互不干扰。 */
function countFrames(err, name) {
  const re = new RegExp('\\[showinfo@' + name + ' @[^\\]]*\\]\\s*n:\\s*\\d+', 'g');
  return (err.match(re) || []).length;
}

/* ── ⑥ 主流程 ───────────────────────────────────────────────────────────── */
const t0 = Date.now();
const src = await probe();

/* 时长够不够：这里只做**宽进**的预判（省得为一个 100s 的请求白跑一遍编码），
   真正的判据是下面的帧数点。slack 取 1.5 帧：容器时长与帧 pts 差半帧是常态
   （实测 128 帧的 mp4 报 4.266016s，而 128/30 = 4.2667s，硬比会误杀）。 */
const avail = src.dur - START;
if (avail <= 0) {
  die('--start ' + START + 's 已经超过源时长 ' + src.dur.toFixed(2) + 's，取不到任何帧');
}
/* --pad 时这条路故意放行：缺的帧由 tpad 克隆末帧补，真正的判据还是下面的帧数点。
   （但 --start 越过源这一条仍然要拦 —— tpad 连一帧真帧都没有，克隆不出东西。） */
if (!PAD && avail + 1.5 / FPS < N / FPS) {
  die('时长不够：要 ' + DUR + 's × ' + FPS + 'fps = ' + N + ' 帧（从 ' + START + 's 起要 '
    + (N / FPS).toFixed(2) + 's），源只剩 ' + avail.toFixed(2) + 's'
    + '。换短一点的 --dur、往前挪 --start，或加 --pad 用克隆末帧补');
}

const { cols, rows } = layout(N);
const AW = cols * TW, AH = rows * TH;

/* -t 要多给 1.5 帧：fps 滤镜按「落在窗口内」取帧，边界那一帧给不给是浮点说了算。
   多取的由 trim=end_frame=N 切掉；少取就只能报错 —— 这比 -t 正好卡在 N/fps 稳。 */
const wantT = (DUR + 1.5 / FPS).toFixed(6);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
/* 先写 .part.png 再 rename：中途失败不会留下一个「看着像成品」的半截图集。 */
const tmp = OUT + '.part.png';

const ffArgs = [
  '-y', '-hide_banner', '-nostdin', '-nostats', '-v', 'info',
  '-ss', String(START), '-t', wantT,
  '-i', IN,
  '-an', '-sn', '-dn',
  '-vf', chain({ cols, rows, pad: PAD }),
  '-frames:v', '1', '-update', '1',
  '-pix_fmt', 'rgb24',
  '-map_metadata', '-1',
  tmp,
];

const fr = await run(FFMPEG, ffArgs);
if (fr.spawnError) {
  die('跑不起来 ffmpeg（' + FFMPEG + '）：' + fr.spawnError.message
    + '（用 --ffmpeg <路径> 指定，或让它出现在 PATH 上）');
}

/* 数帧：这是「恰好 N 帧」的唯一判据 —— tile 补空格是静默的（退出码 0），
   不看这里就会把一堆纸色格子当成正常图集交出去。
   real  = 源里真取到的帧数（tpad 之前）
   total = 补完之后进 tile 的帧数（tpad 之后；没开 --pad 时与 real 相同） */
const real = countFrames(fr.err, 'real');
const total = PAD ? countFrames(fr.err, 'total') : real;

if (VERBOSE) {
  const tail = fr.err.trim().split(/\r?\n/).slice(-25).join('\n');
  if (tail) console.error('· ffmpeg stderr 尾巴：\n' + tail);
}
if (fr.code !== 0) {
  try { fs.rmSync(tmp, { force: true }); } catch {}
  const tail = fr.err.trim().split(/\r?\n/)
    .filter(l => /error|Invalid|failed|unable|No such/i.test(l) && !/^\[Parsed_/.test(l))
    .slice(-3).join(' / ');
  die('ffmpeg 退出码 ' + fr.code + (tail ? '：' + tail : '（加 --verbose 看完整 stderr）'));
}
if (total !== N) {
  try { fs.rmSync(tmp, { force: true }); } catch {}
  die('帧数不符：要 ' + N + ' 帧（' + DUR + 's × ' + FPS + 'fps），实际进 tile 的只有 ' + total
    + ' 帧' + (PAD ? '（补帧后仍不够）' : '') + '。源从 ' + START + 's 起只有 ' + real
    + ' 帧可用（ffprobe 说总共 ' + src.dur.toFixed(3) + 's）。'
    + '把 --dur 调小、把 --start 提前，或加 --pad 用克隆末帧补齐');
}

/* ffmpeg 退出码 0 + 帧数对，也可能因为 muxer 没吐图而缺文件（极少见，但不能让
   renameSync 抛一个 ENOENT 裸栈出去）。 */
if (!fs.existsSync(tmp)) {
  die('ffmpeg 说成功了，但没有产出图片文件（' + path.basename(tmp)
    + '）。加 --verbose 看完整 stderr；若是输出路径不可写，换一个 --out');
}
fs.renameSync(tmp, OUT);

/* ── ⑦ sidecar ────────────────────────────────────────────────────────────
 * 消费端 tools/press-reel.html 只认 tileW / tileH / n / cols（其余是溯源信息）。
 * file 原样记「命令行给的 --out」（可相对可绝对），src 记解析后的绝对路径
 * —— 源视频通常不在仓库里，绝对路径是唯一能再找到它的写法。 */
const bytes = fs.statSync(OUT).size;
const sideName = JSON_OUT || (() => {
  const ext = path.extname(OUT);
  return ext ? OUT.slice(0, OUT.length - ext.length) + '.json' : OUT + '.json';
})();
const side = {
  file: A.out === undefined ? OUT : String(A.out),
  tileW: TW,
  tileH: TH,
  n: N,
  cols,
  rows,
  fps: FPS,
  dur: DUR,
  start: START,
  src: IN,
  srcW: src.w,
  srcH: src.h,
  bytes,
};
/* 只有真补过帧才写 padded：没补的时候这个键不存在，读的人不会误判。
   值 = 克隆出来的帧数（= N - real），不是总帧数 —— 总帧数就是 n，重复记没意义。 */
if (PAD && real < N) side.padded = N - real;
/* 取景参数也记下来：没有它，换个 --cx 重出图集就没法复现（消费端不读，纯溯源）。 */
side.fit = FIT;
side.cx = CX;
side.cy = CY;
side.paper = PAPER_RGB;

fs.mkdirSync(path.dirname(sideName), { recursive: true });
fs.writeFileSync(sideName, JSON.stringify(side, null, 2) + '\n', 'utf8');

/* 契约里的那一行摘要走 stderr（stdout 保持空，方便调用方直接吃 JSON/路径）。 */
const kb = Math.round(bytes / 1024);
console.error('✓ atlas ' + TW + '×' + TH + ' ×' + N + ' → ' + AW + '×' + AH
  + '（' + kb + ' KB，' + cols + '×' + rows + '）'
  + (side.padded ? ' · 补帧 ' + side.padded : ''));
if (VERBOSE) console.error('· sidecar ' + sideName + ' · 耗时 ' + ((Date.now() - t0) / 1000).toFixed(2) + 's');
