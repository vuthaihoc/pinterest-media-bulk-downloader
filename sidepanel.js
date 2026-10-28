// Side panel: hai tab Video / Ảnh, mỗi tab có danh sách và bộ lọc riêng; hàng đợi tải có delay, cài đặt
// và nhật ký dùng chung. Hàng đợi chạy ngay trong trang side panel (không ở service worker), nên cần giữ
// side panel mở khi tải.
import { extOf, fileBase, matchSize, planFiles, posterFor, resolveImage, resolveVideo } from './lib/pinterest.js';

const { mergeVideo, mergeImage } = globalThis.__pvbd; // lib/extract.js, nạp trước trong sidepanel.html

const DEFAULTS = {
  delaySec: 3,
  jitterSec: 2,
  maxPerRun: 0,
  naming: 'creator',
  quality: 'best',
  withAudio: false,
  folder: 'pinterest-videos',
  imagesFromVideoPins: false,
  imageFolder: 'pinterest-images',
  scrollSteps: 20,
  scrollDelaySec: 2,
  liveAdd: true,
  skipDownloaded: true,
  saveManifest: true,
};
const SETTINGS_VERSION = 3;
const STATUS = {
  new: 'Mới',
  resolving: 'Đang phân tích',
  ready: 'Sẵn sàng',
  unavailable: 'Không có link',
  downloading: 'Đang tải',
  done: 'Đã tải',
  error: 'Lỗi',
  skipped: 'Bỏ qua',
};
const KIND_LABEL = { video: 'video', image: 'ảnh' };
const PIN_HOST = /^https:\/\/([^/]+\.)?pinterest\.[a-z.]+\//;
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;

const state = {
  tab: null,
  isPinterest: false,
  kind: 'video', // tab đang xem
  lists: { video: new Map(), image: new Map() }, // hash → item, giữ thứ tự phát hiện
  settings: { ...DEFAULTS },
  history: {}, // hash → { at, files }, lưu lâu dài để bỏ qua file đã tải
  run: null, // { kind, total, ok, fail, skip }
  stop: false,
  scrolling: false,
  phase: '',
  logs: [],
};

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const label = (it) => (it.pinId ? `pin ${it.pinId}` : it.hash.slice(0, 10));
const creatorText = (c) => [c?.username && `@${c.username}`, c?.fullName].filter(Boolean).join(' · ');
const list = (kind = state.kind) => state.lists[kind];

// Kích thước: sau khi phân tích thì lấy theo file sẽ tải, trước đó lấy theo dữ liệu của trang.
const dims = (it) => (it.info?.width ? [it.info.width, it.info.height] : [it.width || 0, it.height || 0]);

// Khoá lọc theo trang tìm thấy và theo người đăng
const pageKey = (it) => (it.pageUrl ?? '').replace(/#.*$/, '');
const userKey = (it) => it.creator?.username ?? (it.creator?.fullName ? `name:${it.creator.fullName}` : '');
function pageLabel(url) {
  try {
    const u = new URL(url);
    return decodeURIComponent(u.pathname + u.search) || '/';
  } catch {
    return url || '(không rõ trang)';
  }
}

// ---------- nhật ký ----------

function log(msg, level = 'info') {
  state.logs.unshift({ t: new Date(), msg, level });
  state.logs.length = Math.min(state.logs.length, 300);
  $('log').innerHTML = state.logs
    .map((l) => `<li class="${l.level}"><time>${l.t.toLocaleTimeString('vi-VN')}</time>${esc(l.msg)}</li>`)
    .join('');
}

// ---------- tab trình duyệt ----------

// Chỉ dùng khi test (test/e2e.js): mở sidepanel.html?tabId=123 như tab thường để theo dõi tab 123.
const TEST_TAB_ID = Number(new URLSearchParams(location.search).get('tabId')) || null;

async function refreshTab() {
  const [tab] = TEST_TAB_ID
    ? [await chrome.tabs.get(TEST_TAB_ID).catch(() => null)]
    : await chrome.tabs.query({ active: true, currentWindow: true });
  state.tab = tab ?? null;
  // Không xin quyền "tabs": chỉ đọc được url của tab thuộc host đã cấp quyền, tức là Pinterest.
  state.isPinterest = !!tab?.url && PIN_HOST.test(tab.url);
  render();
}

async function ensureContent(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'pvbd:ping' });
  } catch {
    // Tab mở trước khi cài/cập nhật extension nên chưa có content script. Nạp muộn thì bỏ lỡ dữ liệu
    // đã tải; tải lại tab để có đủ.
    await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', files: ['page-hook.js'] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['lib/extract.js', 'content.js'] });
    log('Tab này mở trước khi cài/cập nhật extension: đã nạp bù script. Tải lại tab Pinterest (F5) rồi quét lại để không sót.', 'warn');
  }
}

// ---------- danh sách ----------

function addItems(kind, raws, pageUrl) {
  const map = list(kind);
  const merge = kind === 'video' ? mergeVideo : mergeImage;
  let added = 0;
  let updated = false;
  for (const raw of raws ?? []) {
    if (!raw?.hash) continue;
    const prev = map.get(raw.hash);
    if (prev) {
      const hadPin = prev.pinId;
      if (kind === 'video' && raw.poster && prev.poster === posterFor(prev.hash)) prev.poster = null;
      if (merge(prev, raw)) updated = true;
      if (kind === 'video') prev.poster ||= posterFor(prev.hash);
      if (!hadPin && prev.pinId) prev.pinUrl = raw.pinUrl ?? null;
      if (raw.via && !prev.via.has(raw.via)) {
        prev.via.add(raw.via);
        updated = true;
      }
      continue;
    }
    map.set(raw.hash, {
      kind,
      hash: raw.hash,
      pinId: raw.pinId ?? null,
      pinUrl: raw.pinUrl ?? null,
      title: raw.title ?? null,
      creator: raw.creator ?? null,
      width: raw.width || 0,
      height: raw.height || 0,
      pageUrl: raw.pageUrl ?? pageUrl ?? null,
      via: new Set([raw.via ?? 'unknown']),
      ...(kind === 'video'
        ? { hls: [...(raw.hls ?? [])], mp4: [...(raw.mp4 ?? [])], poster: raw.poster || posterFor(raw.hash) }
        : { url: raw.url ?? null, ext: raw.ext ?? null, size: raw.size ?? null, isVideo: !!raw.isVideo }),
      selected: !(state.settings.skipDownloaded && state.history[raw.hash]),
      status: 'new',
      info: null,
      files: [],
      error: null,
      pending: null,
    });
    added++;
  }
  if (added || updated) render();
  if (added) resolvePending();
  return added;
}

// Ảnh của pin: url bản lớn nhất trong dữ liệu; danh sách hiển thị dùng bản 236x cho nhẹ.
const thumbOf = (it) =>
  it.kind === 'video' ? it.poster : (it.info?.url ?? it.url)?.replace(/\/(originals|\d+x[^/]*)\//, '/236x/').replace(/\.(png|gif|webp)$/, '.jpg');

async function netHashes(tabId) {
  const key = `net:${tabId}`;
  const { [key]: hashes = [] } = await chrome.storage.session.get(key);
  return hashes;
}

// Phân tích link cho các file mới, 2 file một lúc. Video cần đọc playlist HLS; ảnh thường có sẵn link gốc.
let resolving = false;
async function resolvePending() {
  if (resolving) return;
  resolving = true;
  try {
    for (;;) {
      const batch = [...state.lists.video.values(), ...state.lists.image.values()]
        .filter((it) => it.status === 'new')
        .slice(0, 2);
      if (!batch.length) break;
      await Promise.all(batch.map(resolveItem));
      await sleep(batch.some((it) => it.kind === 'video') ? 150 : 0);
    }
  } finally {
    resolving = false;
  }
}

function resolveItem(it) {
  if (it.info) return Promise.resolve(it.info);
  it.pending ??= (async () => {
    it.status = 'resolving';
    render();
    try {
      if (it.kind === 'video') {
        it.info = await resolveVideo(it.hash, { hints: { hls: it.hls, mp4: it.mp4 } });
        it.status = it.info.video || it.info.mp4 ? 'ready' : 'unavailable';
      } else {
        it.info = await resolveImage(it);
        it.status = it.info ? 'ready' : 'unavailable';
      }
      if (it.status === 'unavailable') it.error = 'Không tìm được file trên CDN';
    } catch (e) {
      it.status = 'error';
      it.error = e.message;
    } finally {
      it.pending = null;
      render();
    }
    return it.info;
  })();
  return it.pending;
}

// ---------- quét & tự cuộn ----------

const countText = (counts) =>
  Object.entries(counts ?? {})
    .map(([k, n]) => `${k} ${n}`)
    .join(', ') || 'không có';

async function scan({ quiet = false } = {}) {
  if (!state.isPinterest) return log('Tab hiện tại không phải Pinterest', 'warn');
  const tabId = state.tab.id;
  try {
    await ensureContent(tabId);
    const res = await chrome.tabs.sendMessage(tabId, { type: 'pvbd:scan' });
    const newVideos = addItems('video', res.videos, res.page?.url);
    const newImages = addItems('image', res.images, res.page?.url);
    const net = await netHashes(tabId);
    const newNet = addItems('video', net.map((hash) => ({ hash, via: 'network' })), res.page?.url);
    if (!quiet) {
      log(
        `Quét trang: ${res.videos.length} video (${countText(res.sources?.video)}; network ${net.length}), ` +
          `${res.images.length} ảnh (${countText(res.sources?.image)}); thêm mới ${newVideos + newNet} video, ${newImages} ảnh` +
          (res.hooked ? '' : ' · chưa bắt được API, tải lại tab để có đủ'),
      );
    }
  } catch (e) {
    log(`Không quét được trang: ${e.message}`, 'err');
  }
}

async function toggleScroll() {
  if (!state.isPinterest) return log('Tab hiện tại không phải Pinterest', 'warn');
  const tabId = state.tab.id;
  if (state.scrolling) {
    await chrome.tabs.sendMessage(tabId, { type: 'pvbd:stopScroll' }).catch(() => {});
    log('Yêu cầu dừng tự cuộn');
    return;
  }
  await scan({ quiet: true });
  const { scrollSteps, scrollDelaySec } = state.settings;
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'pvbd:scroll',
      steps: scrollSteps,
      delayMs: Math.max(500, scrollDelaySec * 1000),
    });
    state.scrolling = true;
    state.phase = `Tự cuộn 0/${scrollSteps}`;
    log(`Bắt đầu tự cuộn ${scrollSteps} lần, chờ ${scrollDelaySec}s mỗi lần`);
    render();
  } catch (e) {
    log(`Không tự cuộn được: ${e.message}`, 'err');
  }
}

// ---------- tải ----------

function folderPrefix(kind) {
  const raw = kind === 'video' ? state.settings.folder : state.settings.imageFolder;
  const folder = (raw ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .map((p) => p.trim().replace(/[<>:"|?*\x00-\x1f]/g, '_'))
    .filter((p) => p && p !== '.' && p !== '..')
    .join('/');
  return folder ? `${folder}/` : '';
}

function filesOf(it) {
  if (!it.info) return [];
  if (it.kind === 'video') return planFiles(it.info, state.settings);
  return [{ url: it.info.url, suffix: `.${extOf(it.info.url)}`, kind: 'image' }];
}

function downloadAndWait(options) {
  return new Promise((resolve, reject) => {
    let id = null;
    const finish = (err) => {
      clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(onChanged);
      err ? reject(err) : resolve(id);
    };
    const check = (stateNow, errorNow) => {
      if (stateNow === 'complete') finish();
      else if (stateNow === 'interrupted') finish(new Error(errorNow || 'Tải bị gián đoạn'));
    };
    const onChanged = (d) => {
      if (d.id === id && d.state) check(d.state.current, d.error?.current);
    };
    const timer = setTimeout(() => finish(new Error('Quá 10 phút chưa tải xong')), DOWNLOAD_TIMEOUT_MS);
    chrome.downloads.onChanged.addListener(onChanged);
    chrome.downloads
      .download(options)
      .then(async (newId) => {
        id = newId;
        // file nhỏ có thể xong trước khi kịp gán id ở trên
        const [d] = await chrome.downloads.search({ id });
        if (d) check(d.state, d.error);
      })
      .catch((e) => finish(e));
  });
}

async function waitWithCountdown(ms) {
  const end = Date.now() + ms;
  while (!state.stop && Date.now() < end) {
    state.phase = `Chờ ${((end - Date.now()) / 1000).toFixed(1)}s trước file tiếp theo`;
    render();
    await sleep(200);
  }
}

async function startDownloads() {
  if (state.run) return;
  const s = state.settings;
  const kind = state.kind;
  let targets = downloadTargets();
  if (s.maxPerRun > 0) targets = targets.slice(0, s.maxPerRun);
  if (!targets.length) return log(`Không có ${KIND_LABEL[kind]} nào đang chọn trong bộ lọc hiện tại`, 'warn');

  state.stop = false;
  state.run = { kind, total: targets.length, ok: 0, fail: 0, skip: 0 };
  log(`Bắt đầu tải ${targets.length} ${KIND_LABEL[kind]}, delay ${s.delaySec}s + ngẫu nhiên 0–${s.jitterSec}s`);
  const downloaded = [];

  for (let i = 0; i < targets.length && !state.stop; i++) {
    const it = targets[i];
    if (s.skipDownloaded && state.history[it.hash]) {
      it.status = 'skipped';
      state.run.skip++;
      log(`Bỏ qua ${label(it)}: đã tải trước đó`);
      render();
      continue;
    }
    state.phase = `Đang tải ${i + 1}/${targets.length}: ${label(it)}`;
    try {
      await resolveItem(it);
      const files = filesOf(it);
      if (!files.length) throw new Error(it.error || 'Không tìm được link tải');
      it.status = 'downloading';
      it.error = null;
      render();
      it.files = [];
      for (const f of files) {
        const filename = `${folderPrefix(kind)}${fileBase(it, s.naming)}${f.suffix}`;
        await downloadAndWait({ url: f.url, filename, conflictAction: 'uniquify', saveAs: false });
        it.files.push({ kind: f.kind, url: f.url, filename });
      }
      it.status = 'done';
      state.run.ok++;
      state.history[it.hash] = { at: Date.now(), files: it.files.map((f) => f.filename) };
      await chrome.storage.local.set({ history: state.history });
      downloaded.push(it);
      const [w, h] = dims(it);
      log(`Đã tải ${label(it)} (${w ? `${w}x${h}` : '?'}) → ${it.files.map((f) => f.filename).join(', ')}`, 'ok');
    } catch (e) {
      it.status = 'error';
      it.error = e.message;
      state.run.fail++;
      log(`Lỗi ${label(it)}: ${e.message}`, 'err');
    }
    render();
    if (i < targets.length - 1 && !state.stop) {
      await waitWithCountdown((s.delaySec + Math.random() * s.jitterSec) * 1000);
    }
  }

  const { ok, fail, skip, total } = state.run;
  log(`${state.stop ? 'Đã dừng' : 'Xong'}: ${ok} tải được, ${fail} lỗi, ${skip} bỏ qua / ${total}`, fail ? 'warn' : 'ok');
  state.phase = `Lượt vừa rồi (${KIND_LABEL[kind]}): ${ok}/${total} tải được, ${fail} lỗi, ${skip} bỏ qua`;
  state.run = null;
  state.stop = false;
  render();
  if (s.saveManifest && downloaded.length) await exportJson(downloaded, 'manifest', kind);
}

// ---------- xuất ----------

function itemJson(it) {
  const [width, height] = dims(it);
  return {
    kind: it.kind,
    hash: it.hash,
    pinId: it.pinId,
    pinUrl: it.pinUrl,
    title: it.title,
    creator: it.creator,
    profileUrl: it.creator?.username ? `https://www.pinterest.com/${it.creator.username}/` : null,
    pageUrl: it.pageUrl,
    foundVia: [...it.via],
    status: it.status,
    width: width || null,
    height: height || null,
    ...(it.kind === 'video'
      ? {
          variants: it.info?.variants ?? [],
          video: it.info?.video?.url ?? null,
          audio: it.info?.audio?.url ?? null,
          mp4: it.info?.mp4?.url ?? null,
          hls: it.info?.hls ?? null,
        }
      : { image: it.info?.url ?? it.url, fromVideoPin: it.isVideo }),
    files: it.files,
    error: it.error,
  };
}

async function exportJson(items, prefix, kind = state.kind) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const data = { exportedAt: new Date().toISOString(), kind, page: state.tab?.url ?? null, count: items.length, items: items.map(itemJson) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const filename = `${folderPrefix(kind)}${prefix}_${stamp}.json`;
  try {
    await downloadAndWait({ url, filename, conflictAction: 'uniquify', saveAs: false });
    log(`Đã lưu ${filename} (${items.length} ${KIND_LABEL[kind]})`, 'ok');
  } catch (e) {
    log(`Không lưu được ${filename}: ${e.message}`, 'err');
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

async function copyLinks() {
  const links = visibleItems()
    .filter((it) => it.selected)
    .map((it) => filesOf(it)[0]?.url ?? (it.kind === 'image' ? it.url : null))
    .filter(Boolean);
  if (!links.length) return log('Chưa có link nào để copy (chọn file và chờ phân tích xong)', 'warn');
  await navigator.clipboard.writeText(links.join('\n'));
  log(`Đã copy ${links.length} link vào clipboard`, 'ok');
}

// ---------- bộ lọc ----------

// Trang tìm thấy + người đăng + kích thước + hướng + trạng thái. Áp dụng cho danh sách, "Chọn tất cả",
// tải, xuất, copy. Tab Ảnh mặc định bỏ ảnh bìa của pin video.
function visibleItems(kind = state.kind) {
  const status = $('filter').value;
  const page = $('filterPage').value;
  const user = $('filterUser').value;
  const size = $('filterSize').value;
  const orient = $('filterOrient').value;
  return [...list(kind).values()].filter((it) => {
    if (kind === 'image' && it.isVideo && !state.settings.imagesFromVideoPins) return false;
    if (page !== '*' && pageKey(it) !== page) return false;
    if (user !== '*' && userKey(it) !== user) return false;
    if (!matchSize(...dims(it), size, orient)) return false;
    if (status === 'done') return it.status === 'done';
    if (status === 'error') return it.status === 'error' || it.status === 'unavailable';
    if (status === 'pending') return it.status !== 'done';
    return true;
  });
}

const downloadTargets = () => visibleItems().filter((it) => it.selected && it.status !== 'done');

// Các item của tab hiện tại mà bộ lọc trang/người đăng được tính trên đó (bỏ ảnh bìa pin video nếu đang ẩn).
const tabItems = () =>
  [...list().values()].filter((it) => !(it.kind === 'image' && it.isVideo && !state.settings.imagesFromVideoPins));

// Dựng lại option của một ô lọc từ danh sách hiện có, giữ lựa chọn cũ nếu còn.
function fillFilter(select, entries, allLabel, total) {
  const current = select.value || '*';
  const options = [['*', `${allLabel} (${total})`], ...entries];
  const html = options.map(([v, text]) => `<option value="${esc(v)}">${esc(text)}</option>`).join('');
  if (select.dataset.html !== html) {
    select.innerHTML = html;
    select.dataset.html = html;
  }
  select.value = options.some(([v]) => v === current) ? current : '*';
}

function groupCounts(items, keyOf, labelOf) {
  const groups = new Map();
  for (const it of items) {
    const key = keyOf(it);
    const g = groups.get(key) ?? { label: labelOf(it, key), n: 0 };
    g.n++;
    groups.set(key, g);
  }
  return [...groups.entries()].sort((a, b) => b[1].n - a[1].n).map(([k, g]) => [k, `${g.label} (${g.n})`]);
}

// ---------- giao diện ----------

let frame = 0;
function render() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    draw();
  });
}

function draw() {
  const items = tabItems();
  const count = (fn) => items.filter(fn).length;
  const noun = KIND_LABEL[state.kind];

  const ts = $('tabStatus');
  if (state.isPinterest) {
    ts.textContent = `Pinterest: ${state.tab.url}`;
    ts.className = 'tab-status ok';
  } else {
    ts.textContent = 'Tab hiện tại không phải Pinterest. Mở một trang Pinterest (tìm kiếm, board, pin) để quét.';
    ts.className = 'tab-status warn';
  }

  for (const kind of ['video', 'image']) {
    const btn = $(kind === 'video' ? 'tabVideo' : 'tabImage');
    const n = [...list(kind).values()].filter((it) => !(kind === 'image' && it.isVideo && !state.settings.imagesFromVideoPins)).length;
    btn.textContent = `${kind === 'video' ? 'Video' : 'Ảnh'} (${n})`;
    btn.setAttribute('aria-selected', String(state.kind === kind));
  }

  $('statFound').textContent = items.length;
  $('statSelected').textContent = count((it) => it.selected);
  $('statReady').textContent = count((it) => it.status === 'ready');
  $('statDone').textContent = count((it) => it.status === 'done');
  $('statError').textContent = count((it) => it.status === 'error' || it.status === 'unavailable');
  $('statSkipped').textContent = count((it) => it.status === 'skipped');

  const run = state.run;
  $('bar').style.width = run ? `${Math.round(((run.ok + run.fail + run.skip) / run.total) * 100)}%` : '0';
  $('phase').textContent = state.phase || 'Chưa chạy';

  fillFilter($('filterPage'), groupCounts(items, pageKey, (_it, key) => pageLabel(key)), 'Mọi trang', items.length);
  fillFilter(
    $('filterUser'),
    groupCounts(items, userKey, (it, key) => (key ? creatorText(it.creator) : 'Chưa rõ người đăng')),
    'Mọi người đăng',
    items.length,
  );

  const targets = downloadTargets().length;
  const filtered = ['filterPage', 'filterUser', 'filterSize', 'filterOrient'].some((id) => $(id).value !== '*') || $('filter').value !== 'all';
  $('btnScan').disabled = !state.isPinterest;
  $('btnScroll').disabled = !state.isPinterest;
  $('btnScroll').textContent = state.scrolling ? 'Dừng tự cuộn' : 'Tự cuộn + quét';
  $('btnDownload').disabled = !!run || targets === 0;
  $('btnDownload').textContent = run ? `Đang tải ${KIND_LABEL[run.kind]}…` : `Tải ${targets} ${noun}${filtered ? ' (theo bộ lọc)' : ''}`;
  $('btnStop').disabled = !run;
  $('btnClear').disabled = !!run;

  const visible = visibleItems();
  $('chkAll').checked = visible.length > 0 && visible.every((it) => it.selected);
  const html = visible.length
    ? visible.map(rowHtml).join('')
    : `<li class="empty">${items.length ? `Không có ${noun} nào khớp bộ lọc.` : `Chưa có ${noun}. Bấm "Quét trang" hoặc "Tự cuộn + quét".`}</li>`;
  if (html !== lastListHtml) {
    // vẽ lại danh sách (đếm ngược khi tải không đổi danh sách nên không vẽ lại)
    lastListHtml = html;
    $('list').innerHTML = html;
    attachPreview();
  }
}
let lastListHtml = '';

function rowHtml(it) {
  const [w, h] = dims(it);
  const res = w ? `${w}×${h}` : '';
  const kind = it.kind === 'video' ? (it.info?.video ? 'CMAF' : it.info?.mp4 ? 'MP4' : '') : extOf(it.info?.url ?? it.url).toUpperCase();
  const extra = it.kind === 'image' && it.isVideo ? 'bìa pin video' : '';
  const sub = [it.title && label(it), res, kind, extra, [...it.via].join('+'), it.error].filter(Boolean).join(' · ');
  const text = esc(it.title || label(it));
  const name = it.pinUrl ? `<a href="${esc(it.pinUrl)}" target="_blank" rel="noreferrer">${text}</a>` : text;
  const who = it.creator
    ? it.creator.username
      ? `<a href="https://www.pinterest.com/${esc(it.creator.username)}/" target="_blank" rel="noreferrer">${esc(creatorText(it.creator))}</a>`
      : esc(creatorText(it.creator))
    : `<i title="Không có dữ liệu pin đi kèm (thường là video chỉ bắt được qua mạng)">chưa rõ người đăng</i>`;
  const links = [
    it.pinUrl
      ? `<a href="${esc(it.pinUrl)}" target="_blank" rel="noreferrer">Mở pin ↗</a>`
      : '<span title="Dữ liệu không có pin ID dạng số">chưa có link pin</span>',
    it.pageUrl && `<a href="${esc(it.pageUrl)}" target="_blank" rel="noreferrer" title="${esc(it.pageUrl)}">trang tìm thấy ↗</a>`,
  ].filter(Boolean);
  return `<li data-hash="${it.hash}"${it.kind === 'video' ? ' title="Rê chuột để xem trước"' : ''}>
    <input type="checkbox" ${it.selected ? 'checked' : ''} ${state.run ? 'disabled' : ''} aria-label="Chọn" />
    <div class="thumb"><img src="${esc(thumbOf(it) ?? '')}" alt="" loading="lazy" /></div>
    <div class="meta">
      <span class="name" title="${esc(it.title || it.hash)}">${name}</span>
      <span class="sub who">${who}</span>
      <span class="sub" title="${esc(sub)}">${esc(sub)}</span>
      <span class="sub links">${links.join(' · ')}</span>
      <span class="badge ${it.status}">${STATUS[it.status]}${state.history[it.hash] && it.status !== 'done' ? ' · đã tải trước đó' : ''}</span>
    </div>
  </li>`;
}

// ---------- xem trước video khi hover ----------
// Chỉ tải khi rê chuột vào (sau 250ms để lướt qua không tải), tắt tiếng, lặp lại; rời chuột thì dừng và
// bỏ src để trình duyệt giải phóng. Danh sách vẽ lại thì chuyển <video> sang hàng mới, không phát lại từ đầu.

const preview = { hash: null, el: null, timer: 0 };

function stopPreview() {
  clearTimeout(preview.timer);
  if (preview.el) {
    preview.el.pause();
    preview.el.removeAttribute('src');
    preview.el.load();
    preview.el.remove();
  }
  Object.assign(preview, { hash: null, el: null, timer: 0 });
}

function attachPreview() {
  if (!preview.el) return;
  const box = $('list').querySelector(`li[data-hash="${preview.hash}"] .thumb`);
  if (!box) return stopPreview(); // hàng đó bị lọc mất
  if (preview.el.parentNode !== box) {
    box.appendChild(preview.el);
    preview.el.play().catch(() => {});
  }
}

async function startPreview(hash) {
  const it = state.lists.video.get(hash);
  if (!it || state.kind !== 'video') return;
  const info = await resolveItem(it);
  const src = info?.preview ?? info?.video?.url ?? info?.mp4?.url;
  if (preview.hash !== hash || !src) return; // chuột đã rời trong lúc phân tích
  const v = document.createElement('video');
  Object.assign(v, { muted: true, loop: true, playsInline: true, className: 'preview' });
  v.src = src;
  preview.el = v;
  attachPreview();
}

$('list').addEventListener('pointerover', (e) => {
  const hash = e.target.closest('li[data-hash]')?.dataset.hash ?? null;
  if (hash === preview.hash) return;
  stopPreview();
  if (!hash || state.kind !== 'video') return;
  preview.hash = hash;
  preview.timer = setTimeout(() => startPreview(hash), 250);
});
$('list').addEventListener('pointerleave', stopPreview);

// ---------- cài đặt ----------

function fillSettings() {
  const form = $('settingsForm');
  for (const [key, value] of Object.entries(state.settings)) {
    const el = form.elements[key];
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!value;
    else el.value = value;
  }
  $('btnClearHistory').textContent = `Xoá lịch sử đã tải (${Object.keys(state.history).length})`;
}

function readSettings() {
  const form = $('settingsForm');
  const next = { ...state.settings };
  for (const key of Object.keys(DEFAULTS)) {
    const el = form.elements[key];
    if (!el) continue;
    if (el.type === 'checkbox') next[key] = el.checked;
    else if (el.type === 'number') next[key] = Math.max(Number(el.min) || 0, Number(el.value) || 0);
    else next[key] = el.value;
  }
  return next;
}

// ---------- sự kiện ----------

for (const btn of document.querySelectorAll('.tabs button')) {
  btn.addEventListener('click', () => {
    stopPreview();
    state.kind = btn.dataset.kind;
    render();
  });
}
$('btnScan').addEventListener('click', () => scan());
$('btnScroll').addEventListener('click', toggleScroll);
$('btnDownload').addEventListener('click', startDownloads);
$('btnStop').addEventListener('click', () => {
  state.stop = true;
  log('Yêu cầu dừng: file đang tải sẽ tải nốt, không tải thêm', 'warn');
});
$('btnExport').addEventListener('click', () => {
  const items = visibleItems();
  if (!items.length) return log('Danh sách trống, không có gì để xuất', 'warn');
  exportJson(items, 'links');
});
$('btnCopy').addEventListener('click', () => copyLinks().catch((e) => log(`Không copy được: ${e.message}`, 'err')));
$('btnClear').addEventListener('click', async () => {
  const n = state.lists.video.size + state.lists.image.size;
  state.lists.video.clear();
  state.lists.image.clear();
  if (state.tab?.id != null) {
    await chrome.storage.session.remove(`net:${state.tab.id}`);
    if (state.isPinterest) await chrome.tabs.sendMessage(state.tab.id, { type: 'pvbd:reset' }).catch(() => {});
  }
  log(`Đã xoá ${n} mục khỏi danh sách (cả video và ảnh)`);
  render();
});
$('btnClearHistory').addEventListener('click', async () => {
  const n = Object.keys(state.history).length;
  state.history = {};
  await chrome.storage.local.set({ history: {} });
  fillSettings();
  log(`Đã xoá lịch sử ${n} file đã tải`);
  render();
});
$('settingsForm').addEventListener('change', async () => {
  state.settings = readSettings();
  await chrome.storage.local.set({ settings: state.settings });
  log('Đã lưu cài đặt');
  render();
});
for (const id of ['filter', 'filterPage', 'filterUser', 'filterSize', 'filterOrient']) $(id).addEventListener('change', render);
$('chkAll').addEventListener('change', (e) => {
  for (const it of visibleItems()) it.selected = e.target.checked;
  render();
});
$('list').addEventListener('change', (e) => {
  const li = e.target.closest('li[data-hash]');
  const it = li && list().get(li.dataset.hash);
  if (it && e.target.type === 'checkbox') {
    it.selected = e.target.checked;
    render();
  }
});

chrome.tabs.onActivated.addListener(refreshTab);
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (tabId === state.tab?.id && (change.url || change.status === 'complete')) refreshTab();
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  const tabId = sender.tab?.id ?? msg.tabId;
  if (tabId == null || tabId !== state.tab?.id) return;
  const accept = !msg.live || state.settings.liveAdd || state.scrolling;
  switch (msg.type) {
    case 'pvbd:found':
      if (accept) {
        const v = addItems('video', msg.videos, msg.page?.url);
        const i = addItems('image', msg.images, msg.page?.url);
        if ((v || i) && msg.live) log(`Trang nạp thêm: +${v} video, +${i} ảnh`);
      }
      break;
    case 'pvbd:net':
      if (state.settings.liveAdd || state.scrolling) addItems('video', [{ hash: msg.hash, via: 'network' }], state.tab?.url);
      break;
    case 'pvbd:scrollProgress':
      state.scrolling = true;
      if (!state.run) state.phase = `Tự cuộn ${msg.i}/${msg.steps} · trên trang: ${msg.videos} video, ${msg.images} ảnh`;
      render();
      break;
    case 'pvbd:scrollDone':
      state.scrolling = false;
      if (!state.run) state.phase = '';
      log(`Tự cuộn kết thúc (${msg.reason}): trên trang ${msg.videos} video, ${msg.images} ảnh`, 'ok');
      scan({ quiet: true });
      break;
  }
});

// ---------- khởi động ----------

(async () => {
  const saved = await chrome.storage.local.get(['settings', 'history', 'settingsVersion']);
  state.settings = { ...DEFAULTS, ...(saved.settings ?? {}) };
  if ((saved.settingsVersion ?? 1) < 2) state.settings.naming = DEFAULTS.naming; // bản 1 đặt tên theo pin ID
  if (saved.settingsVersion !== SETTINGS_VERSION) {
    await chrome.storage.local.set({ settings: state.settings, settingsVersion: SETTINGS_VERSION });
  }
  state.history = saved.history ?? {};
  fillSettings();
  await refreshTab();
  log('Side panel sẵn sàng. Giữ panel mở trong lúc tải.');
  if (state.isPinterest) scan();
})();
