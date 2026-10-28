// Test đầu-cuối: mở Chrome headless với profile tạm, nạp extension qua CDP, mở một trang Pinterest,
// rồi điều khiển side panel: quét → đặt delay → tải 2 video → đọc nhật ký và file đã tải.
// Chạy: node test/e2e.js [url Pinterest]. Profile và file tải nằm ở .work/e2e/ (hoặc $PVBD_WORK).
// Chrome 137+ bỏ cờ --load-extension, nên phải dùng Extensions.loadUnpacked qua --remote-debugging-pipe.
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORK = process.env.PVBD_WORK ?? resolve(EXT, '.work/e2e'); // nằm trong .gitignore
const PAGE = process.argv[2] ?? 'https://www.pinterest.com/search/videos/?q=study%20desk%20aesthetic';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

rmSync(WORK, { recursive: true, force: true });
mkdirSync(`${WORK}/profile/Default`, { recursive: true });
mkdirSync(`${WORK}/downloads`);
writeFileSync(
  `${WORK}/profile/Default/Preferences`,
  JSON.stringify({ download: { default_directory: `${WORK}/downloads`, prompt_for_download: false } }),
);

const chrome = spawn(
  'google-chrome',
  [
    '--headless=new',
    '--remote-debugging-pipe',
    '--enable-unsafe-extension-debugging',
    `--user-data-dir=${WORK}/profile`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,900',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] },
);

let seq = 0;
let buf = '';
const waiters = new Map();
chrome.stdio[4].on('data', (chunk) => {
  buf += chunk;
  for (let i; (i = buf.indexOf('\0')) >= 0; ) {
    const msg = JSON.parse(buf.slice(0, i));
    buf = buf.slice(i + 1);
    const w = msg.id && waiters.get(msg.id);
    if (!w) continue;
    waiters.delete(msg.id);
    msg.error ? w.reject(new Error(JSON.stringify(msg.error))) : w.resolve(msg.result);
  }
});
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    waiters.set(id, { resolve, reject });
    chrome.stdio[3].write(`${JSON.stringify({ id, method, params, sessionId })}\0`);
  });
async function evaluate(sessionId, expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}
const attach = async (targetId) => (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId;

try {
  const { id: extId } = await send('Extensions.loadUnpacked', { path: EXT });
  console.log('extension id:', extId);

  await send('Target.createTarget', { url: PAGE });
  await sleep(9000);

  const { targetInfos } = await send('Target.getTargets');
  const sw = targetInfos.find((t) => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${extId}/`));
  if (!sw) throw new Error('service worker không chạy');
  const swSession = await attach(sw.targetId);
  const tabs = await evaluate(swSession, 'chrome.tabs.query({}).then((ts) => ts.map((t) => ({ id: t.id, url: t.url })))');
  const pinTab = tabs.find((t) => /^https:\/\/([^/]+\.)?pinterest\./.test(t.url ?? ''));
  if (!pinTab) throw new Error(`không thấy tab Pinterest: ${JSON.stringify(tabs)}`);
  const net = await evaluate(swSession, `chrome.storage.session.get('net:${pinTab.id}')`);
  console.log('webRequest ghi nhận:', Object.values(net)[0] ?? []);
  const injected = await evaluate(
    swSession,
    `Promise.all(['ISOLATED', 'MAIN'].map((world) => chrome.scripting.executeScript({
      target: { tabId: ${pinTab.id} }, world,
      func: () => ({ content: typeof window.__pvbdAlive === 'function', hook: document.documentElement.dataset.pvbdHook ?? null, extract: typeof globalThis.__pvbd }),
    }).then((r) => [world, r[0].result])))`,
  );
  console.log('content script trên tab:', Object.fromEntries(injected));

  const { targetId: panelId } = await send('Target.createTarget', {
    url: `chrome-extension://${extId}/sidepanel.html?tabId=${pinTab.id}`,
  });
  const panel = await attach(panelId);
  const snap = () =>
    evaluate(
      panel,
      `({
        tab: document.getElementById('tabStatus').textContent,
        stats: ['statFound','statSelected','statReady','statDone','statError','statSkipped'].map((id) => id.slice(4) + '=' + document.getElementById(id).textContent).join(' '),
        phase: document.getElementById('phase').textContent,
        button: document.getElementById('btnDownload').textContent,
        filterPage: [...document.getElementById('filterPage').options].map((o) => o.text),
        filterUser: [...document.getElementById('filterUser').options].map((o) => o.text),
        list: [...document.querySelectorAll('#list li .meta')].map((m) => m.innerText.replace(/\\n/g, ' | ')),
        log: [...document.querySelectorAll('#log li')].map((l) => l.innerText).slice(0, 14),
      })`,
    );

  await sleep(5000); // panel tự quét khi mở + phân tích link
  console.log('\n== sau khi mở panel (chưa hover, chưa cuộn) ==\n', await snap());

  // Tự cuộn 4 lần để Pinterest nạp thêm pin qua API
  await evaluate(
    panel,
    `(() => {
      const f = document.getElementById('settingsForm');
      f.elements.scrollSteps.value = 4;
      f.elements.scrollDelaySec.value = 2;
      f.dispatchEvent(new Event('change'));
      setTimeout(() => document.getElementById('btnScroll').click(), 300);
    })()`,
  );
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    if ((await snap()).log.some((l) => l.includes('Tự cuộn kết thúc'))) break;
  }
  await sleep(4000); // phân tích link các video mới
  const afterScroll = await snap();
  console.log('\n== sau khi tự cuộn ==\n', { ...afterScroll, list: afterScroll.list.slice(0, 12), listTotal: afterScroll.list.length });

  await evaluate(
    panel,
    `(() => {
      const f = document.getElementById('settingsForm');
      f.elements.delaySec.value = 1.5;
      f.elements.jitterSec.value = 0;
      f.elements.maxPerRun.value = 2;
      f.dispatchEvent(new Event('change'));
    })()`,
  );
  // Bộ lọc kích thước
  for (const [size, orient] of [['720', '*'], ['*', 'landscape'], ['*', '*']]) {
    await evaluate(
      panel,
      `(() => {
        document.getElementById('filterSize').value = '${size}';
        document.getElementById('filterOrient').value = '${orient}';
        document.getElementById('filterSize').dispatchEvent(new Event('change'));
      })()`,
    );
    await sleep(300);
    console.log(`lọc kích thước ${size}/${orient} → nút:`, (await snap()).button);
  }

  // Lọc theo người đăng đầu tiên có nick (nếu có) để thử bộ lọc + tên file
  const picked = await evaluate(
    panel,
    `(() => {
      const sel = document.getElementById('filterUser');
      const opt = [...sel.options].find((o) => o.value !== '*' && !o.value.startsWith('name:') && o.value);
      if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change')); }
      return opt ? opt.text : null;
    })()`,
  );
  await sleep(500);
  console.log('lọc theo người đăng:', picked, '→ nút:', (await snap()).button);
  await evaluate(panel, `document.getElementById('btnDownload').click()`);
  const started = Date.now();
  let phases = new Set();
  for (let i = 0; i < 90; i++) {
    await sleep(500);
    const s = await snap();
    phases.add(s.phase.replace(/[\d.]+s/, 'Ns'));
    if (s.log.some((l) => /(Xong|Đã dừng): /.test(l))) break;
  }
  await sleep(3000); // manifest JSON
  console.log(`\n== sau khi tải (${((Date.now() - started) / 1000).toFixed(1)}s) ==\n`, await snap());
  console.log('các trạng thái đã thấy:', [...phases]);

  // Hover để xem trước: giả lập rê chuột vào video đầu tiên trong danh sách
  const hover = await evaluate(
    panel,
    `(async () => {
      const li = document.querySelector('#list li[data-hash]');
      if (!li) return 'không có video để thử';
      li.querySelector('.meta').dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 200));
        const v = document.querySelector('#list .preview');
        if (v && v.readyState >= 2) return { file: v.currentSrc.replace(/^.*\\/videos\\//, ''), w: v.videoWidth, h: v.videoHeight, playing: !v.paused };
      }
      const v = document.querySelector('#list .preview');
      return v ? { src: v.src, readyState: v.readyState, error: v.error?.code } : 'không tạo được <video> xem trước';
    })()`,
  );
  await evaluate(panel, `document.getElementById('list').dispatchEvent(new PointerEvent('pointerleave'))`);
  const leftOver = await evaluate(panel, `document.querySelectorAll('#list .preview').length`);
  console.log('xem trước khi hover:', hover, '| còn <video> sau khi rời chuột:', leftOver);

  // Tab Ảnh: bỏ lọc người đăng, tải 2 ảnh
  await evaluate(
    panel,
    `(() => {
      const u = document.getElementById('filterUser'); u.value = '*'; u.dispatchEvent(new Event('change'));
      document.getElementById('tabImage').click();
    })()`,
  );
  await sleep(1500);
  const img = await snap();
  console.log('\n== tab Ảnh ==\n', { ...img, list: img.list.slice(0, 6), listTotal: img.list.length });
  await evaluate(panel, `document.getElementById('btnDownload').click()`);
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    if ((await snap()).log.filter((l) => /(Xong|Đã dừng): /.test(l)).length >= 2) break;
  }
  await sleep(2500);
  console.log('\n== sau khi tải ảnh ==\n', (await snap()).log.slice(0, 6));

  // Ảnh giao diện ở khổ hẹp và khổ rộng để soát bố cục
  // chụp tab nào đang có nhiều mục hơn (trang tìm pin thì tab Video gần như trống)
  await evaluate(
    panel,
    `(() => {
      const n = (id) => Number(document.getElementById(id).textContent.match(/\\((\\d+)\\)/)?.[1] ?? 0);
      document.getElementById(n('tabImage') > n('tabVideo') ? 'tabImage' : 'tabVideo').click();
    })()`,
  );
  for (const [name, width] of [['panel', 400], ['panel-wide', 900]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 1400, deviceScaleFactor: 1, mobile: false }, panel);
    await sleep(800);
    const { data } = await send('Page.captureScreenshot', { format: 'png' }, panel);
    writeFileSync(`${WORK}/${name}.png`, Buffer.from(data, 'base64'));
    console.log('ảnh side panel:', `${WORK}/${name}.png`);
  }
  console.log('file trong downloads:', readdirSync(`${WORK}/downloads`, { recursive: true }));
} catch (e) {
  console.error('LỖI:', e.message);
  process.exitCode = 1;
} finally {
  chrome.kill();
}
