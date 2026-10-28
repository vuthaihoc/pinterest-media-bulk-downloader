// Content script: tìm video và ảnh trên trang Pinterest, tự cuộn để nạp thêm pin, báo về side panel.
// Nguồn (trường via):
//   relay / json  dữ liệu pin nhúng trong HTML (script Relay, __PWS_INITIAL_PROPS__, ld+json…)
//   api           response XHR/fetch do page-hook.js đọc trong MAIN world, gồm các pin nạp thêm khi cuộn
//   video         ảnh poster của thẻ <video> (src của Pinterest là blob: nên không dùng được)
// Cần lib/extract.js nạp trước (globalThis.__pvbd).
(() => {
  // Tải lại/cập nhật extension mà không tải lại tab thì script cũ vẫn còn đây nhưng đã mất kết nối với
  // extension. Khi đó bản mới chạy đè lên, thay vì thấy cờ cũ rồi thoát.
  if (window.__pvbdAlive?.() || !globalThis.__pvbd) return;
  window.__pvbdAlive = () => {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  };

  const { hashFromUrl, extractPins, mergeVideo, mergeImage, parseRelayScript } = globalThis.__pvbd;
  const found = { video: new Map(), image: new Map() }; // hash → item
  const MERGE = { video: mergeVideo, image: mergeImage };
  const parsedScripts = new WeakSet();
  let scrollJob = null;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pinUrl = (id) => (id ? `${location.origin}/pin/${id}/` : null);
  const pagePinId = () => location.pathname.match(/\/pin\/(\d+)/)?.[1] ?? null;
  const emptyFresh = () => ({ video: [], image: [] });

  // Pin chứa thẻ <video>: thẻ <a href="/pin/…"> bao quanh, hoặc data-test-pin-id gần nhất.
  // Chỉ tìm link con ở vài cấp gần để không lấy nhầm pin bên cạnh trong lưới.
  function pinIdOf(el) {
    const own = el.closest('a[href*="/pin/"]')?.getAttribute('href')?.match(/\/pin\/(\d+)/)?.[1];
    if (own) return own;
    const tagged = el.closest('[data-test-pin-id]')?.getAttribute('data-test-pin-id');
    if (tagged) return tagged;
    let node = el.parentElement;
    for (let depth = 0; node && depth < 5; depth++, node = node.parentElement) {
      const links = new Set(
        [...node.querySelectorAll('a[href*="/pin/"]')]
          .map((a) => a.getAttribute('href').match(/\/pin\/(\d+)/)?.[1])
          .filter(Boolean),
      );
      if (links.size === 1) return [...links][0];
      if (links.size > 1) return null;
    }
    // chỉ video của pin chính trên trang pin mới lấy pin ID từ URL; video pin gợi ý thì để trống
    return el.closest('[data-test-id="CloseupMainPin"]') ? pagePinId() : null;
  }

  // fresh: các item mới hoặc vừa có thêm thông tin (pin, người đăng…), để báo lại cho side panel.
  function add(kind, info, fresh) {
    const map = found[kind];
    const prev = map.get(info.hash);
    if (prev) {
      if (MERGE[kind](prev, info)) {
        prev.pinUrl = pinUrl(prev.pinId);
        if (!fresh[kind].includes(prev)) fresh[kind].push(prev);
      }
      return;
    }
    const item = {
      title: null,
      creator: null,
      poster: null,
      width: 0,
      height: 0,
      ...(kind === 'video' ? { hls: [], mp4: [] } : { isVideo: false }),
      ...info,
      pinUrl: pinUrl(info.pinId),
      pageUrl: location.href,
    };
    map.set(info.hash, item);
    fresh[kind].push(item);
  }

  function addData(data, via, fresh, fallbackPinId = null) {
    const { videos, images } = extractPins(data);
    for (const v of videos) add('video', { ...v, pinId: v.pinId ?? fallbackPinId, via }, fresh);
    for (const i of images) add('image', { ...i, pinId: i.pinId ?? fallbackPinId, via }, fresh);
  }

  function collect() {
    const fresh = emptyFresh();

    for (const s of document.querySelectorAll('script')) {
      if (parsedScripts.has(s)) continue;
      const text = s.textContent;
      if (!text.includes('pinimg.com')) continue;
      if (s.hasAttribute('data-relay-completed-request')) {
        const data = parseRelayScript(text);
        if (data) {
          addData(data, 'relay', fresh);
          parsedScripts.add(s);
        }
      } else if (/json/.test(s.type) || s.id === '__PWS_DATA__' || s.id === '__PWS_INITIAL_PROPS__') {
        try {
          // ld+json video-snippet chỉ mô tả pin đang mở và không có pin ID trong đó
          addData(JSON.parse(text), 'json', fresh, s.type === 'application/ld+json' ? pagePinId() : null);
          parsedScripts.add(s);
        } catch {
          // JSON chưa nạp xong, lần quét sau thử lại
        }
      }
    }

    for (const v of document.querySelectorAll('video')) {
      const urls = [v.poster, v.currentSrc, v.src, ...[...v.querySelectorAll('source')].map((s) => s.src)];
      const hash = urls.map(hashFromUrl).find(Boolean);
      if (!hash) continue;
      add('video', { hash, pinId: pinIdOf(v), poster: hashFromUrl(v.poster) ? v.poster : null, via: 'video' }, fresh);
    }
    return fresh;
  }

  function send(msg) {
    try {
      chrome.runtime.sendMessage(msg).catch(() => {}); // side panel đang đóng thì bỏ qua
    } catch {
      // extension vừa tải lại, bản content script mới sẽ thay thế bản này
    }
  }

  function report(fresh, live) {
    if (fresh.video.length || fresh.image.length) {
      send({ type: 'pvbd:found', videos: fresh.video, images: fresh.image, page: { url: location.href }, live });
    }
  }

  const sourceCounts = (map) => {
    const counts = {};
    for (const it of map.values()) counts[it.via] = (counts[it.via] ?? 0) + 1;
    return counts;
  };

  // Response JSON do page-hook.js (MAIN world) chuyển sang. Trang có thể tự gửi thông điệp giả, nhưng
  // extractPins chỉ nhận hash đúng dạng và side panel chỉ tải từ CDN pinimg.com.
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.source !== 'pvbd-hook' || !Array.isArray(e.data.texts)) return;
    const fresh = emptyFresh();
    for (const text of e.data.texts) {
      try {
        addData(JSON.parse(text), 'api', fresh);
      } catch {
        // không phải JSON hợp lệ
      }
    }
    report(fresh, true);
  });
  window.postMessage({ source: 'pvbd-content', type: 'hello' }, location.origin);

  async function autoScroll({ steps, delayMs }) {
    const job = { stop: false };
    scrollJob = job;
    let stuck = 0;
    let reason = 'đủ số lần cuộn';
    for (let i = 1; i <= steps; i++) {
      if (job.stop) {
        reason = 'đã dừng';
        break;
      }
      const el = document.scrollingElement;
      const before = el.scrollHeight;
      window.scrollBy({ top: Math.round(window.innerHeight * 0.9), behavior: 'smooth' });
      await sleep(delayMs);
      report(collect(), false);
      send({ type: 'pvbd:scrollProgress', i, steps, videos: found.video.size, images: found.image.size });
      const atBottom = window.innerHeight + window.scrollY >= el.scrollHeight - 4;
      stuck = atBottom && el.scrollHeight === before ? stuck + 1 : 0;
      if (stuck >= 3) {
        reason = 'hết trang';
        break;
      }
    }
    if (scrollJob === job) scrollJob = null;
    send({ type: 'pvbd:scrollDone', reason, videos: found.video.size, images: found.image.size });
  }

  // Người dùng tự cuộn hoặc Pinterest nạp thêm pin: quét lại sau khi DOM yên 800ms.
  let timer = null;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => window.__pvbdAlive() && report(collect(), true), 800);
  }).observe(document.documentElement, { childList: true, subtree: true });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg?.type) {
      case 'pvbd:ping':
        sendResponse({ ok: true, scrolling: !!scrollJob });
        break;
      case 'pvbd:scan':
        collect();
        sendResponse({
          videos: [...found.video.values()],
          images: [...found.image.values()],
          sources: { video: sourceCounts(found.video), image: sourceCounts(found.image) },
          hooked: document.documentElement.dataset.pvbdHook === '2',
          page: { url: location.href, title: document.title },
        });
        break;
      case 'pvbd:scroll':
        if (!scrollJob) autoScroll(msg);
        sendResponse({ ok: true });
        break;
      case 'pvbd:stopScroll':
        if (scrollJob) scrollJob.stop = true;
        sendResponse({ ok: true });
        break;
      case 'pvbd:reset':
        found.video.clear();
        found.image.clear();
        sendResponse({ ok: true });
        break;
    }
  });
})();
