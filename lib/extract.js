// Tách video và ảnh (hash, pin ID, tiêu đề, người đăng, kích thước, link) từ dữ liệu JSON của Pinterest.
// Script thường (không phải module) vì được nạp làm content script trước content.js, và bằng thẻ <script>
// trong sidepanel.html.
(() => {
  if (globalThis.__pvbd) return;

  const HASH_RE = /([0-9a-f]{2})\/([0-9a-f]{2})\/([0-9a-f]{2})\/(\1\2\3[0-9a-f]{26})/;
  const IMAGE_RE =
    /^https:\/\/i\.pinimg\.com\/([^/]+)\/([0-9a-f]{2})\/([0-9a-f]{2})\/([0-9a-f]{2})\/(\2\3\4[0-9a-f]{26})\.(jpe?g|png|gif|webp)$/i;

  // Chỉ nhận link có /videos/: ảnh pin cũng có dạng aa/bb/cc/<hash> nhưng là hash ảnh.
  function hashFromUrl(url) {
    if (typeof url !== 'string' || !url.includes('/videos/')) return null;
    return url.match(HASH_RE)?.[4] ?? null;
  }

  // Ảnh pin: i.pinimg.com/<cỡ>/aa/bb/cc/<hash>.<đuôi>, cỡ là "originals", "736x", "236x"…
  function imageFromUrl(url) {
    if (typeof url !== 'string' || url.includes('/videos/')) return null;
    const m = url.match(IMAGE_RE);
    return m ? { hash: m[5], size: m[1], ext: m[6].toLowerCase().replace('jpeg', 'jpg') } : null;
  }

  // Pin trong GraphQL (Relay) có __typename "Pin"; API REST cũ có type "pin". entityId của pin gợi ý khi
  // chưa đăng nhập là token "e1_…" chứ không phải số, nên vẫn tính là pin nhưng không có pin ID.
  const isPin = (o) => o.__typename === 'Pin' || (o.type === 'pin' && o.id != null);
  const numericId = (v) => (/^\d{6,}$/.test(String(v ?? '')) ? String(v) : null);
  const pinIdOf = (o) => (o.__typename === 'Pin' ? numericId(o.entityId) : numericId(o.id));

  const titleOf = (o) =>
    [o.title, o.gridTitle, o.grid_title, o.seoTitle, o.seo_title].find((t) => typeof t === 'string' && t.trim()) ?? null;

  // Người đăng: nick (username, phần trong URL profile) và tên hiển thị, lấy của cùng một người.
  // nativeCreator là người tạo video; pinner chỉ là người lưu pin, nên xếp cuối.
  const USER_FIELDS = [
    'nativeCreator',
    'native_creator',
    'closeupUnifiedAttribution',
    'closeupAttribution',
    'closeup_attribution',
    'originPinner',
    'origin_pinner',
    'pinner',
  ];
  function creatorOf(o) {
    const users = USER_FIELDS.map((k) => o[k]).filter((u) => u && typeof u === 'object');
    const nameOf = (u) => [u.fullName, u.full_name].find((n) => typeof n === 'string' && n.trim())?.trim() ?? null;
    const main = users.find((u) => typeof u.username === 'string' && /^[\w.-]{1,60}$/.test(u.username));
    if (main) {
      const fullName = nameOf(main) ?? users.filter((u) => u.username === main.username).map(nameOf).find(Boolean) ?? null;
      return { username: main.username, fullName };
    }
    const fullName = users.map(nameOf).find(Boolean);
    return fullName ? { username: null, fullName } : null;
  }

  // Ảnh lớn nhất của pin: images.orig (REST), images_orig / imageSpec_orig (GraphQL); không có bản gốc
  // thì lấy ảnh rộng nhất.
  function imageOf(pin) {
    const found = [];
    const consider = (o) => {
      if (!o || typeof o !== 'object' || typeof o.url !== 'string') return;
      const img = imageFromUrl(o.url);
      if (img) found.push({ ...img, url: o.url, width: Number(o.width) || 0, height: Number(o.height) || 0 });
    };
    if (pin.images && typeof pin.images === 'object') Object.values(pin.images).forEach(consider);
    for (const [k, v] of Object.entries(pin)) if (/^(images?|imageSpec)_/.test(k)) consider(v);
    found.sort((a, b) => (b.size === 'originals') - (a.size === 'originals') || b.width - a.width);
    return found[0] ?? null;
  }

  // Gộp thông tin mới vào bản đã có, trả về true nếu có thêm gì. Tiêu đề và người đăng chỉ gộp khi cùng
  // một pin, để không lấy nhầm của pin khác chứa cùng video/ảnh.
  function mergeCommon(prev, next) {
    let changed = false;
    const samePin = !prev.pinId || !next.pinId || prev.pinId === next.pinId;
    for (const k of ['pinId', 'poster', ...(samePin ? ['title', 'creator'] : [])]) {
      if (!prev[k] && next[k]) {
        prev[k] = next[k];
        changed = true;
      }
    }
    if ((next.width || 0) * (next.height || 0) > (prev.width || 0) * (prev.height || 0)) {
      Object.assign(prev, { width: next.width, height: next.height });
      if (next.url) Object.assign(prev, { url: next.url, ext: next.ext, size: next.size });
      changed = true;
    }
    return changed;
  }

  function mergeVideo(prev, next) {
    let changed = mergeCommon(prev, next);
    for (const k of ['hls', 'mp4']) {
      for (const u of next[k] ?? []) {
        prev[k] ??= [];
        if (!prev[k].includes(u)) {
          prev[k].push(u);
          changed = true;
        }
      }
    }
    return changed;
  }

  function mergeImage(prev, next) {
    let changed = mergeCommon(prev, next);
    if (next.isVideo && !prev.isVideo) {
      prev.isVideo = true;
      changed = true;
    }
    return changed;
  }

  // Link gốc mà trang dùng: playlist HLS chính, và MP4 H.264 (bỏ AV1/HEVC vì khó dựng).
  const isMasterHls = (u) => /\.m3u8(\?|$)/.test(u) && !/_(\d+w|audio)\.m3u8/.test(u);
  const isH264Mp4 = (u) => /\.mp4(\?|$)/.test(u) && !/av1|hevc/i.test(u);

  // Mỗi link video được gán cho pin tổ tiên gần nhất chứa nó; mỗi pin cho ra một ảnh (ảnh lớn nhất của pin).
  // Pin đăng lại (repin) có thể lồng dữ liệu của pin gốc, nên pin ID có thể là pin gốc thay vì pin đang mở.
  function extractPins(root) {
    const videos = new Map();
    const images = new Map();
    const pins = [];
    (function walk(node, depth) {
      if (node === null || depth > 80) return;
      if (typeof node === 'string') {
        const hash = hashFromUrl(node);
        if (!hash) return;
        const pin = pins[pins.length - 1];
        if (pin) pin.hasVideo = true;
        const v = {
          hash,
          pinId: pin?.id ?? null,
          title: pin?.title ?? null,
          creator: pin?.creator ?? null,
          poster: node.includes('/videos/thumbnails/') ? node : null,
          width: 0,
          height: 0,
          hls: isMasterHls(node) ? [node] : [],
          mp4: isH264Mp4(node) ? [node] : [],
        };
        const prev = videos.get(hash);
        if (prev) mergeVideo(prev, v);
        else videos.set(hash, v);
        return;
      }
      if (typeof node !== 'object') return;
      const isArray = Array.isArray(node);
      const pin = !isArray && isPin(node) ? { id: pinIdOf(node), title: titleOf(node), creator: creatorOf(node), hasVideo: false } : null;
      if (pin) pins.push(pin);
      for (const v of isArray ? node : Object.values(node)) walk(v, depth + 1);
      // { url: <video>, width, height } trong video_list: kích thước có sẵn, lọc được trước khi phân tích
      const sized = !isArray && node.width > 0 && node.height > 0 && videos.get(hashFromUrl(node.url));
      if (sized && node.width * node.height > sized.width * sized.height) {
        Object.assign(sized, { width: node.width, height: node.height });
      }
      if (pin) {
        pins.pop();
        const img = imageOf(node);
        if (img) {
          const item = { ...img, pinId: pin.id, title: pin.title, creator: pin.creator, isVideo: pin.hasVideo };
          const prev = images.get(img.hash);
          if (prev) mergeImage(prev, item);
          else images.set(img.hash, item);
        }
        if (pin.hasVideo && pins.length) pins[pins.length - 1].hasVideo = true;
      }
    })(root, 0);
    return { videos: [...videos.values()], images: [...images.values()] };
  }

  const extractVideos = (root) => extractPins(root).videos;

  // Script Relay nhúng trong HTML: window.__PWS_RELAY_REGISTER_COMPLETED_REQUEST__("<khoá>", {JSON});
  const RELAY_RE = /^\s*window\.__PWS_RELAY_REGISTER_COMPLETED_REQUEST__\(\s*"(?:[^"\\]|\\.)*"\s*,\s*([\s\S]*?)\)\s*;?\s*$/;
  function parseRelayScript(text) {
    const m = text.match(RELAY_RE);
    if (!m) return null;
    try {
      return JSON.parse(m[1]);
    } catch {
      return null;
    }
  }

  globalThis.__pvbd = { hashFromUrl, imageFromUrl, extractPins, extractVideos, mergeVideo, mergeImage, parseRelayScript };
})();
