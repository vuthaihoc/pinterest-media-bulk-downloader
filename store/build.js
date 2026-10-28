// Tạo ảnh cho trang Chrome Web Store vào store/images/: 4 ảnh chụp 1280x800, promo 440x280, marquee 1400x560.
// Ảnh chụp là extension thật chạy trong Chrome headless trên dữ liệu mẫu: trang Pinterest, playlist video,
// ảnh và file tải xuống đều do script này trả về qua CDP Fetch. Vì vậy không gọi mạng, và ảnh không lộ pin
// hay tên người dùng thật. Tên extension lấy từ manifest, đổi tên thì chạy lại: npm run store:images
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchChrome, sleep } from '../scripts/chrome.js';

const EXT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(EXT, 'store/images');
const WORK = resolve(EXT, '.work/store');
const { name } = JSON.parse(readFileSync(`${EXT}/manifest.json`, 'utf8'));

// ---------- dữ liệu mẫu ----------

let seed = 20261028;
const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const hex = (n) => Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join('');
const digits = (n) => String(1 + Math.floor(rand() * 9)) + Array.from({ length: n - 1 }, () => Math.floor(rand() * 10)).join('');
const dir = (h) => `${h.slice(0, 2)}/${h.slice(2, 4)}/${h.slice(4, 6)}`;

// Người đăng giả, đặt tên kiểu "Nguyễn Văn A" để không trùng ai thật
const PEOPLE = [
  { username: 'nguyenvana', full_name: 'Nguyễn Văn A' },
  { username: 'tranthib', full_name: 'Trần Thị B' },
  { username: 'lehoangc', full_name: 'Lê Hoàng C' },
  { username: 'phamminhd', full_name: 'Phạm Minh D' },
  { username: 'demo.studio', full_name: 'Demo Studio' },
  { username: 'sample_corner', full_name: 'Sample Corner' },
];
// [nền trên, nền dưới, ánh đèn]
const PALETTES = [
  ['#f4d9c6', '#c98b6b', '#fff3d6'],
  ['#dfe7d8', '#7d9a78', '#fffbe8'],
  ['#d9e4f2', '#6f86a8', '#fdf2d0'],
  ['#f2e1e9', '#b77d95', '#fff0e0'],
  ['#efe6d2', '#a68c5b', '#fff8e7'],
  ['#3a4154', '#171b26', '#f6c26b'],
  ['#e6dccf', '#8d7766', '#ffffff'],
  ['#d7ece9', '#5d9690', '#fff6dc'],
];
const VIDEOS = [
  ['Góc học tập tối giản', 1080, 1920],
  ['Setup bàn làm việc buổi sáng', 720, 1280],
  ['Pha cà phê pour-over', 720, 1280],
  ['Đèn bàn ấm cho đêm học', 1080, 1920],
  ['Sắp xếp kệ sách gỗ', 480, 852],
  ['Vẽ màu nước thư giãn', 1920, 1080],
  ['Chăm cây trong phòng', 720, 1280],
  ['Bullet journal tháng 11', 1080, 1080],
  ['Mưa bên cửa sổ', 720, 1280],
  ['Dọn bàn cuối tuần', 540, 960],
  ['Bữa sáng nhanh 5 phút', 1280, 720],
  ['Góc đọc sách ban công', 720, 1280],
];
const IMAGES = [
  ['Bảng màu be ấm', 1000, 1500],
  ['Kệ gỗ treo tường', 736, 1104],
  ['Bàn học cạnh cửa sổ', 1200, 1800],
  ['Bộ bút highlight pastel', 800, 800],
  ['Phòng ngủ tông xanh rêu', 1080, 1350],
  ['Ly gốm thủ công', 1600, 1200],
  ['Đèn ngủ hình nấm', 736, 1308],
  ['Lịch để bàn tối giản', 900, 1200],
  ['Góc cây xanh ban công', 1080, 1920],
  ['Thảm len kẻ sọc', 1200, 900],
  ['Hộp bút bằng gỗ', 736, 1104],
  ['Tranh treo khung mảnh', 1000, 1500],
];
const pins = [
  ...VIDEOS.map(([title, w, h], i) => ({ title, w, h, user: PEOPLE[i % 6], palette: PALETTES[i % 8], video: hex(32) })),
  ...IMAGES.map(([title, w, h], i) => ({ title, w, h, user: PEOPLE[(i + 2) % 6], palette: PALETTES[(i + 3) % 8], ext: i % 4 === 2 ? 'png' : 'jpg' })),
].map((p) => ({ ...p, id: digits(18), image: hex(32), ext: p.ext ?? 'jpg', seed: Math.floor(rand() * 2 ** 32) }));

const PAGE = 'https://www.pinterest.com/search/pins/?q=g%C3%B3c%20h%E1%BB%8Dc%20t%E1%BA%ADp';
const CDN = 'https://v1.pinimg.com/videos';
const imageUrl = (p, size) => `https://i.pinimg.com/${size}/${dir(p.image)}/${p.image}.${size === 'originals' ? p.ext : 'jpg'}`;
const posterUrl = (p) => `https://i.pinimg.com/videos/thumbnails/originals/${dir(p.video)}/${p.video}.0000000.jpg`;

// Pin dạng API REST như khi đã đăng nhập (__PWS_INITIAL_PROPS__)
const restPin = (p) => ({
  type: 'pin',
  id: p.id,
  title: p.title,
  grid_title: p.title,
  pinner: p.user,
  native_creator: p.user,
  images: {
    '236x': { url: imageUrl(p, '236x'), width: 236, height: Math.round((236 * p.h) / p.w) },
    orig: { url: imageUrl(p, 'originals'), width: p.w, height: p.h },
  },
  ...(p.video && {
    videos: { video_list: { V_HLSV3_MOBILE: { url: `${CDN}/iht/hls/${dir(p.video)}/${p.video}.m3u8`, width: p.w, height: p.h, thumbnail: posterUrl(p) } } },
  }),
});
const props = { initialReduxState: { pins: Object.fromEntries(pins.map((p) => [p.id, restPin(p)])) } };
const PAGE_HTML = `<!doctype html><meta charset="utf-8"><title>Trang mẫu</title>
<body style="font:16px sans-serif;padding:24px">Trang mẫu để chụp ảnh extension.
<script id="__PWS_INITIAL_PROPS__" type="application/json">${JSON.stringify(props).replace(/</g, '\\u003c')}</script>`;

// HLS kiểu CMAF một file: mỗi độ phân giải một playlist trỏ vào cùng một file .cmfv
function master(p) {
  const short = Math.min(p.w, p.h);
  const steps = [short, ...[720, 540, 360].filter((s) => s < short)];
  return [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="audio",DEFAULT=YES,URI="${p.video}_audio.m3u8"`,
    ...steps.flatMap((s) => [
      `#EXT-X-STREAM-INF:BANDWIDTH=${s * 3000},RESOLUTION=${Math.round((p.w * s) / short)}x${Math.round((p.h * s) / short)},AUDIO="a"`,
      `${p.video}_${s}w.m3u8`,
    ]),
  ].join('\n');
}
const singleFile = (file) =>
  ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-TARGETDURATION:10', `#EXT-X-MAP:URI="${file}"`, '#EXTINF:10.0,', file, '#EXT-X-ENDLIST'].join('\n');

// Ảnh mẫu: góc bàn vẽ bằng canvas (nền chuyển màu, ánh đèn, mặt bàn, đồ vật, cây), trả về JPEG base64
async function drawArt(specs) {
  return Promise.all(
    specs.map(async ({ w, h, palette: [a, b, c], seed }) => {
      let s = seed;
      const r = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
      const W = 360;
      const H = Math.round((W * h) / w);
      const cv = new OffscreenCanvas(W, H);
      const g = cv.getContext('2d');
      const bg = g.createLinearGradient(0, 0, W * 0.4, H);
      bg.addColorStop(0, a);
      bg.addColorStop(1, b);
      g.fillStyle = bg;
      g.fillRect(0, 0, W, H);
      const x = W * (0.2 + 0.6 * r());
      const y = H * (0.12 + 0.25 * r());
      const glow = g.createRadialGradient(x, y, 0, x, y, Math.max(W, H) * 0.45);
      glow.addColorStop(0, c);
      glow.addColorStop(1, 'rgba(255,255,255,0)');
      g.globalAlpha = 0.75;
      g.fillStyle = glow;
      g.fillRect(0, 0, W, H);
      g.globalAlpha = 1;
      const top = H * (0.62 + 0.1 * r());
      g.fillStyle = 'rgba(60,40,30,0.28)';
      g.fillRect(0, top, W, H - top);
      for (let i = 0; i < 3; i++) {
        const ow = W * (0.12 + 0.22 * r());
        const oh = H * (0.06 + 0.16 * r());
        g.fillStyle = `rgba(255,255,255,${0.25 + 0.35 * r()})`;
        g.beginPath();
        g.roundRect(W * (0.05 + 0.75 * r()), top - oh, ow, oh, Math.min(ow, oh) * 0.15);
        g.fill();
      }
      const px = W * (0.1 + 0.8 * r());
      g.fillStyle = 'rgba(70,110,70,0.6)';
      for (let i = 0; i < 6; i++) {
        g.beginPath();
        g.ellipse(px + (r() - 0.5) * W * 0.14, top - H * (0.05 + 0.1 * r()), W * 0.045, H * 0.05, r() * Math.PI, 0, Math.PI * 2);
        g.fill();
      }
      const bytes = new Uint8Array(await (await cv.convertToBlob({ type: 'image/jpeg', quality: 0.86 })).arrayBuffer());
      let bin = '';
      for (const byte of bytes) bin += String.fromCharCode(byte);
      return btoa(bin);
    }),
  );
}

// ---------- trả lời request thay cho Pinterest ----------

const art = new Map();
const FAKE_FILE = Buffer.alloc(4096).toString('base64');
const b64 = (text) => Buffer.from(text).toString('base64');

function route(url) {
  const u = new URL(url);
  if (u.hostname === 'www.pinterest.com' && u.pathname.startsWith('/search/')) return [200, 'text/html; charset=utf-8', b64(PAGE_HTML)];
  const hash = u.pathname.match(/[0-9a-f]{32}/)?.[0];
  const pin = hash && pins.find((p) => p.video === hash || p.image === hash);
  if (!pin) return [404, 'text/plain', ''];
  if (u.hostname === 'i.pinimg.com') return [200, 'image/jpeg', art.get(pin.id)];
  const file = u.pathname.split('/').pop();
  if (file === `${hash}.m3u8`) return [200, 'application/vnd.apple.mpegurl', b64(master(pin))];
  if (file.endsWith('.m3u8')) return [200, 'application/vnd.apple.mpegurl', b64(singleFile(file.replace('.m3u8', file.includes('audio') ? '.cmfa' : '.cmfv')))];
  return [200, 'video/mp4', FAKE_FILE]; // .cmfv / .mp4: đủ để tải xuống thành công
}

// ---------- khung ảnh chụp ----------

const ICON = pathToFileURL(`${EXT}/icons/icon128.png`).href;
const FONT = `font-family: 'Noto Sans', 'Segoe UI', sans-serif;`;
const BG = 'background: linear-gradient(135deg, #fff7f5, #ffe4e0 60%, #ffd3cd);';

const frameHtml = ({ headline, bullets, shot }) => `<!doctype html><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { margin: 0; width: 1280px; height: 800px; overflow: hidden; display: flex; align-items: center; gap: 64px;
    padding: 0 72px 0 88px; ${FONT} color: #1f1f1f; ${BG} }
  .text { flex: 1; }
  .brand { display: flex; align-items: center; gap: 12px; font-size: 22px; font-weight: 700; }
  .brand img { width: 72px; height: 72px; margin: -9px; }
  h1 { font-size: 50px; line-height: 1.15; margin: 36px 0 30px; letter-spacing: -0.5px; }
  ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 18px; font-size: 23px; line-height: 1.4; color: #3a3a3a; }
  li { padding-left: 34px; position: relative; }
  li::before { content: ''; position: absolute; left: 0; top: 10px; width: 14px; height: 14px; border-radius: 4px; background: #d0021b; }
  .shot { width: 420px; height: 760px; border-radius: 16px; box-shadow: 0 24px 64px rgba(140, 0, 20, 0.22), 0 0 0 1px rgba(0, 0, 0, 0.06); }
</style>
<div class="text"><div class="brand"><img src="${ICON}" alt="">${name}</div><h1>${headline}</h1>
<ul>${bullets.map((b) => `<li>${b}</li>`).join('')}</ul></div>
<img class="shot" src="${shot}" alt="">`;

const promoHtml = (w, h, tagline, shot) => `<!doctype html><meta charset="utf-8"><style>
  body { margin: 0; width: ${w}px; height: ${h}px; overflow: hidden; display: flex; align-items: center; ${FONT} color: #1f1f1f; ${BG}
    padding: 0 ${h * 0.13}px; box-sizing: border-box; gap: ${h * 0.1}px; }
  .text { flex: 1; }
  img.icon { width: ${Math.min(h * 0.36, 150)}px; height: ${Math.min(h * 0.36, 150)}px; margin: -${Math.min(h * 0.045, 19)}px; }
  b { display: block; font-size: ${h * 0.1}px; line-height: 1.15; margin: ${h * 0.07}px 0 ${h * 0.035}px; }
  p { margin: 0; font-size: ${h * 0.058}px; color: #4a4a4a; }
  .shot { height: ${h * 0.86}px; border-radius: 12px; box-shadow: 0 16px 48px rgba(140, 0, 20, 0.22); }
</style>
<div class="text"><img class="icon" src="${ICON}" alt=""><b>${name}</b><p>${tagline}</p></div>
${shot ? `<img class="shot" src="${shot}" alt="">` : ''}`;

// ---------- chạy ----------

mkdirSync(OUT, { recursive: true });
const chrome = launchChrome(WORK);
const { send, evaluate, attach, on } = chrome;
const unhandled = new Set();

try {
  // Trang trống để vẽ ảnh mẫu và dựng khung ảnh chụp
  const { targetId: canvasId } = await send('Target.createTarget', { url: 'about:blank' });
  const canvas = await attach(canvasId);
  const drawn = await evaluate(canvas, `(${drawArt})(${JSON.stringify(pins)})`);
  pins.forEach((p, i) => art.set(p.id, drawn[i]));

  // Mọi request tới Pinterest (của trang, side panel, và chrome.downloads) đều do route() trả lời
  on('Fetch.requestPaused', ({ requestId, request }, sessionId) => {
    const [status, type, body] = route(request.url);
    if (status !== 200) unhandled.add(request.url);
    const headers = [{ name: 'Content-Type', value: type }, { name: 'Access-Control-Allow-Origin', value: '*' }];
    send('Fetch.fulfillRequest', { requestId, responseCode: status, responseHeaders: headers, body }, sessionId).catch(() => {});
  });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*://*.pinterest.com/*' }, { urlPattern: '*://*.pinimg.com/*' }] });

  const { id: extId } = await send('Extensions.loadUnpacked', { path: EXT });
  await sleep(1000);
  const { targetInfos } = await send('Target.getTargets');
  const sw = await attach(targetInfos.find((t) => t.type === 'service_worker' && t.url.includes(extId)).targetId);
  // Đã tải 2 video ở lượt trước để thấy nhãn "đã tải trước đó"; delay dài để kịp chụp lúc đang đếm ngược
  const history = Object.fromEntries([pins[3], pins[8]].map((p) => [p.video, { at: Date.now(), files: [] }]));
  await evaluate(
    sw,
    `chrome.storage.local.set(${JSON.stringify({
      settings: { delaySec: 20, jitterSec: 0, maxPerRun: 4 },
      settingsVersion: 3,
      history,
    })})`,
  );

  await send('Target.createTarget', { url: PAGE });
  await sleep(2500);
  const tabs = await evaluate(sw, 'chrome.tabs.query({}).then((ts) => ts.map((t) => ({ id: t.id, url: t.url })))');
  const tabId = tabs.find((t) => t.url?.startsWith('https://www.pinterest.com/')).id;

  const { targetId: panelId } = await send('Target.createTarget', { url: 'about:blank' });
  const panel = await attach(panelId);
  const view = async (width, height, scale) => {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false }, panel);
    await sleep(700);
  };
  // Chrome headless không vẽ tab nền, chụp tab nền sẽ treo: đưa tab lên trước rồi mới chụp
  const shoot = async (session) => {
    await send('Page.bringToFront', {}, session);
    return (await send('Page.captureScreenshot', { format: 'png' }, session)).data;
  };
  const saveShot = (file, data) => {
    writeFileSync(`${OUT}/${file}`, Buffer.from(data, 'base64'));
    console.log('→', `store/images/${file}`);
  };
  const stat = (id) => evaluate(panel, `Number(document.getElementById('${id}').textContent)`);
  const waitFor = async (expr, what, tries = 60) => {
    for (let i = 0; i < tries; i++) {
      if (await evaluate(panel, expr)) return;
      await sleep(250);
    }
    throw new Error(`hết giờ chờ: ${what}`);
  };
  // các thumbnail đang hiện trên màn hình đã tải xong (thumbnail ngoài màn hình nạp lười)
  const imagesReady = `[...document.querySelectorAll('#list img')].every((i) => i.complete && (i.naturalWidth > 0 || i.getBoundingClientRect().top > innerHeight))`;

  await view(420, 760, 2);
  await send('Page.navigate', { url: `chrome-extension://${extId}/sidepanel.html?tabId=${tabId}` }, panel);
  await waitFor(`Number(document.getElementById('statReady').textContent) >= ${VIDEOS.length - 2}`, 'phân tích xong video');
  await waitFor(imagesReady, 'thumbnail video');

  // Ảnh 1 + 2: đang tải, đã xong 2 file, đang đếm ngược tới file thứ 3
  await evaluate(panel, `document.getElementById('btnDownload').click()`);
  await waitFor(`Number(document.getElementById('statDone').textContent) >= 2`, 'tải 2 video', 120);
  await sleep(1200);
  const narrowRun = await shoot(panel);
  await view(1280, 800, 1);
  await waitFor(imagesReady, 'thumbnail lưới video');
  saveShot('screenshot-2-video-grid.png', await shoot(panel));
  await evaluate(panel, `document.getElementById('btnStop').click()`);

  // Ảnh 4: tab Ảnh dạng lưới
  await evaluate(panel, `document.getElementById('tabImage').click()`);
  await waitFor(`Number(document.getElementById('statReady').textContent) >= ${IMAGES.length}`, 'phân tích xong ảnh');
  await waitFor(imagesReady, 'thumbnail ảnh');
  saveShot('screenshot-4-image-grid.png', await shoot(panel));

  // Ảnh 3: phần cài đặt, trả delay về mặc định
  await evaluate(
    panel,
    `(() => {
      const f = document.getElementById('settingsForm');
      f.elements.delaySec.value = 3;
      f.elements.jitterSec.value = 2;
      f.elements.maxPerRun.value = 0;
      f.dispatchEvent(new Event('change'));
      document.getElementById('tabVideo').click();
      document.getElementById('settings').open = true;
      scrollTo(0, 0);
    })()`,
  );
  await view(420, 760, 2);
  const narrowSettings = await shoot(panel);

  // Ghép ảnh panel hẹp vào khung có chữ giới thiệu
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, canvas);
  const frames = [
    {
      file: 'screenshot-1-download.png',
      shot: narrowRun,
      headline: 'Tải hàng loạt video và ảnh trên Pinterest',
      bullets: [
        'Thấy video ngay khi mở trang, không cần rê chuột từng pin',
        'Delay giữa mỗi file, cộng thêm ngẫu nhiên, có đếm ngược',
        'Tên file gồm nick, tên người đăng và mã pin',
      ],
    },
    {
      file: 'screenshot-3-settings.png',
      shot: narrowSettings,
      headline: 'Tuỳ chỉnh cách tải',
      bullets: [
        'Video nét nhất, hoặc MP4 có sẵn tiếng',
        'Lọc theo trang, người đăng, kích thước, hướng',
        'Bỏ qua file đã tải, lưu manifest JSON để tra nguồn',
      ],
    },
  ];
  for (const f of frames) {
    writeFileSync(`${WORK}/${f.file}`, Buffer.from(f.shot, 'base64'));
    const html = `${WORK}/${f.file}.html`;
    writeFileSync(html, frameHtml({ ...f, shot: pathToFileURL(`${WORK}/${f.file}`).href }));
    await send('Page.navigate', { url: pathToFileURL(html).href }, canvas);
    await sleep(800);
    saveShot(f.file, await shoot(canvas));
  }

  // Promo nhỏ (không bắt buộc, nhưng giúp hiện nổi bật hơn) và marquee (chỉ dùng khi được chọn giới thiệu)
  for (const [file, w, h, tagline, shot] of [
    ['promo-small-440x280.png', 440, 280, 'Tải hàng loạt video và ảnh, có delay', null],
    ['promo-marquee-1400x560.png', 1400, 560, 'Tải video và ảnh hàng loạt, có delay giữa mỗi file', `${WORK}/screenshot-1-download.png`],
  ]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }, canvas);
    const html = `${WORK}/${file}.html`;
    writeFileSync(html, promoHtml(w, h, tagline, shot && pathToFileURL(shot).href));
    await send('Page.navigate', { url: pathToFileURL(html).href }, canvas);
    await sleep(800);
    saveShot(file, await shoot(canvas));
  }

  const log = await evaluate(panel, `[...document.querySelectorAll('#log li')].map((l) => l.innerText).slice(0, 8)`);
  console.log('\nnhật ký panel:', log);
  if (unhandled.size) console.log('request không có dữ liệu mẫu (trả 404):', [...unhandled]);
} catch (e) {
  console.error('LỖI:', e.message);
  process.exitCode = 1;
} finally {
  chrome.close();
}
