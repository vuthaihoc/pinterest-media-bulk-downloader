// Tìm link tải của một video Pinterest từ mã hash (32 ký tự hex).
// Pinterest phát video qua HLS nên thẻ <video> chỉ có src dạng blob:. Mọi link trên CDN đều chứa
// <aa>/<bb>/<cc>/<hash> với aa, bb, cc là 6 ký tự đầu của hash, nên chỉ cần hash là dựng lại được:
//   v1.pinimg.com/videos/mc/hls/aa/bb/cc/<hash>.m3u8   playlist gốc, liệt kê các độ phân giải
//   v1.pinimg.com/videos/mc/720p/aa/bb/cc/<hash>.mp4   MP4 có tiếng, nhưng có khi chỉ 234x416
// Video mới dùng CMAF một file: mỗi độ phân giải là một file <hash>_720w.cmfv (chỉ hình) và âm
// thanh riêng ở <hash>_audio.cmfa; tải nguyên file là được video nét nhất. Video cũ dùng segment
// .ts nên không tải nguyên được, khi đó lấy file MP4.

export const CDN = 'https://v1.pinimg.com/videos';
const ROOTS = ['mc', 'iht'];
const HASH_RE = /([0-9a-f]{2})\/([0-9a-f]{2})\/([0-9a-f]{2})\/(\1\2\3[0-9a-f]{26})/;

export const hashDir = (hash) => `${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash.slice(4, 6)}`;

// Chỉ nhận link có /videos/: ảnh pin thường cũng có dạng aa/bb/cc/<hash> nhưng là hash ảnh.
export function hashFromUrl(url) {
  if (!url || !url.includes('/videos/')) return null;
  return url.match(HASH_RE)?.[4] ?? null;
}

export const posterFor = (hash) =>
  `https://i.pinimg.com/videos/thumbnails/originals/${hashDir(hash)}/${hash}.0000000.jpg`;

export function parseMaster(text) {
  const lines = text.split(/\r?\n/);
  const variants = [];
  let audio = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const res = line.match(/RESOLUTION=(\d+)x(\d+)/);
      const bw = line.match(/[:,]BANDWIDTH=(\d+)/);
      let j = i + 1;
      while (j < lines.length && (!lines[j].trim() || lines[j].startsWith('#'))) j++;
      if (j < lines.length) {
        variants.push({
          uri: lines[j].trim(),
          width: res ? Number(res[1]) : 0,
          height: res ? Number(res[2]) : 0,
          bandwidth: bw ? Number(bw[1]) : 0,
        });
      }
    } else if (line.startsWith('#EXT-X-MEDIA:') && line.includes('TYPE=AUDIO')) {
      audio = line.match(/URI="([^"]+)"/)?.[1] ?? audio;
    }
  }
  variants.sort((a, b) => b.height - a.height || b.bandwidth - a.bandwidth);
  return { variants, audio };
}

// Playlist CMAF một file: mọi segment trỏ vào cùng file với EXT-X-MAP, tải nguyên file là đủ.
export function singleFileOf(playlist) {
  const map = playlist.match(/#EXT-X-MAP:URI="([^"]+)"/)?.[1];
  if (!map) return null;
  const segments = playlist.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
  return segments.length > 0 && segments.every((s) => s.trim() === map) ? map : null;
}

async function getText(url, fetchImpl) {
  try {
    const res = await fetchImpl(url);
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

// Kích thước file (byte) nếu link tồn tại, null nếu không.
async function probeSize(url, fetchImpl) {
  try {
    const res = await fetchImpl(url, { method: 'HEAD' });
    if (res.ok) return Number(res.headers.get('content-length')) || 0;
    if (res.status !== 405) return null;
  } catch {
    // một số proxy chặn HEAD, thử GET 1 byte bên dưới
  }
  try {
    const res = await fetchImpl(url, { headers: { Range: 'bytes=0-0' } });
    if (!res.ok) return null;
    return Number(res.headers.get('content-range')?.split('/')[1]) || 0;
  } catch {
    return null;
  }
}

// Chỉ tải từ CDN của Pinterest: link gợi ý đến từ trang, mà trang có thể gửi thông điệp giả cho extension.
const onCdn = (url) => /^https:\/\/[a-z0-9-]+\.pinimg\.com\//.test(url) && hashFromUrl(url) !== null;

// hints: link lấy từ dữ liệu của trang ({ hls: [...], mp4: [...] }). Thử trước link dựng từ hash vì có
// video nằm ở đường dẫn khác (ví dụ iht/hls/v2/…), và MP4 trong dữ liệu thường nét hơn mc/720p.
export async function resolveVideo(hash, { fetchImpl = globalThis.fetch.bind(globalThis), hints = {} } = {}) {
  const dir = hashDir(hash);
  const out = { hash, width: 0, height: 0, variants: [], hls: null, video: null, audio: null, mp4: null, preview: null };
  const mine = (urls) => (urls ?? []).filter((u) => onCdn(u) && hashFromUrl(u) === hash);
  const hlsCandidates = [...new Set([...mine(hints.hls), ...ROOTS.map((r) => `${CDN}/${r}/hls/${dir}/${hash}.m3u8`)])];
  const mp4Candidates = [...new Set([...mine(hints.mp4), ...ROOTS.map((r) => `${CDN}/${r}/720p/${dir}/${hash}.mp4`)])];

  for (const masterUrl of hlsCandidates) {
    const base = masterUrl.slice(0, masterUrl.lastIndexOf('/') + 1);
    const master = await getText(masterUrl, fetchImpl);
    if (!master) continue;
    const { variants, audio } = parseMaster(master);
    out.hls = masterUrl;
    out.variants = variants.map((v) => `${v.width}x${v.height}`);
    const best = variants[0];
    if (best) {
      out.width = best.width;
      out.height = best.height;
      const playlist = await getText(new URL(best.uri, base).href, fetchImpl);
      const file = playlist && singleFileOf(playlist);
      const url = file && new URL(file, base).href;
      if (url && onCdn(url)) {
        out.video = { url, width: best.width, height: best.height };
        // Xem trước khi hover: bản nhỏ nhất từ 360p. Tên file CMAF theo playlist (<hash>_360w.m3u8 →
        // <hash>_360w.cmfv), chỉ dùng khi bản nét nhất cũng đặt tên đúng kiểu đó.
        const small = [...variants].reverse().find((v) => Math.min(v.width, v.height) >= 360) ?? best;
        const sameNaming = file === best.uri.replace(/\.m3u8$/, '.cmfv');
        out.preview = sameNaming ? new URL(small.uri.replace(/\.m3u8$/, '.cmfv'), base).href : url;
      }
    }
    if (audio) {
      const playlist = await getText(new URL(audio, base).href, fetchImpl);
      const file = playlist && singleFileOf(playlist);
      const url = file && new URL(file, base).href;
      if (url && onCdn(url)) out.audio = { url };
    }
    break;
  }

  for (const url of mp4Candidates) {
    const size = await probeSize(url, fetchImpl);
    if (size !== null) {
      out.mp4 = { url, size };
      break;
    }
  }
  out.preview ??= out.mp4?.url ?? null; // video .ts cũ: xem trước bằng MP4 (tắt tiếng)
  return out;
}

// Danh sách file cần tải cho một video theo cài đặt. suffix nối sau tên gốc của file; độ phân giải
// không đưa vào tên mà ghi trong manifest.
export function planFiles(info, { quality, withAudio }) {
  const video = info.video && { url: info.video.url, suffix: '.mp4', kind: 'video' };
  const audio = info.audio && { url: info.audio.url, suffix: '_audio.m4a', kind: 'audio' };
  const mp4 = info.mp4 && { url: info.mp4.url, suffix: '.mp4', kind: 'mp4' };

  if (quality === 'best' && video) return withAudio && audio ? [video, audio] : [video];
  if (mp4) return [mp4];
  if (video) return audio ? [video, audio] : [video]; // muốn có tiếng nhưng không có MP4
  return [];
}

// Link ảnh gốc. Dữ liệu trang thường có sẵn bản originals; nếu chỉ có bản thu nhỏ (736x…) thì thử
// originals với các đuôi thường gặp, không được thì tải bản lớn nhất đang có.
export async function resolveImage(item, { fetchImpl = globalThis.fetch.bind(globalThis) } = {}) {
  const known = item.url && /^https:\/\/i\.pinimg\.com\//.test(item.url) ? item.url : null;
  if (known?.includes('/originals/')) return { url: known, width: item.width || 0, height: item.height || 0 };
  for (const ext of ['jpg', 'png', 'gif', 'webp']) {
    const url = `https://i.pinimg.com/originals/${hashDir(item.hash)}/${item.hash}.${ext}`;
    if ((await probeSize(url, fetchImpl)) !== null) return { url, width: 0, height: 0 }; // kích thước gốc chưa biết
  }
  return known ? { url: known, width: item.width || 0, height: item.height || 0 } : null;
}

export const extOf = (url) => url?.match(/\.(jpe?g|png|gif|webp)(\?|$)/i)?.[1].toLowerCase().replace('jpeg', 'jpg') ?? 'jpg';

// Lọc theo kích thước: size là "*", "lt480" hoặc số px tối thiểu của cạnh ngắn ("720" = từ 720p);
// orient là "*", "portrait", "landscape", "square". Chưa biết kích thước thì không khớp bộ lọc nào.
export function matchSize(width, height, size = '*', orient = '*') {
  if (size === '*' && orient === '*') return true;
  if (!width || !height) return false;
  const short = Math.min(width, height);
  if (size === 'lt480' ? short >= 480 : size !== '*' && short < Number(size)) return false;
  const ratio = width / height;
  if (orient === 'portrait') return ratio < 0.9;
  if (orient === 'landscape') return ratio > 1.1;
  if (orient === 'square') return ratio >= 0.9 && ratio <= 1.1;
  return true;
}

// Phần tên file an toàn từ chuỗi người dùng tự đặt (tên hiển thị có thể chứa emoji, / : * ? " < > |,
// ký tự điều khiển, ký tự đảo chiều chữ, khoảng trắng vô hình…). Giữ chữ mọi ngôn ngữ (kể cả có dấu),
// số và vài dấu câu thường gặp; ký tự cấm trên Windows/macOS/Linux thành khoảng trắng; tối đa `max` ký tự.
export function safeName(text, max = 50) {
  if (typeof text !== 'string') return '';
  const cleaned = text
    .normalize('NFC')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/[^\p{L}\p{M}\p{N}\s._()[\]&'+,!#@-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return [...cleaned]
    .slice(0, max)
    .join('')
    .replace(/^[\s.\-]+|[\s.\-]+$/g, '');
}

// Tên file (chưa có đuôi). naming = "creator": "nick - tên hiển thị - mã", mã là pin ID, không có thì hash;
// phần nào không có thì bỏ. "pin": pin_<id>. "hash": mã video.
export function fileBase(item, naming = 'creator') {
  const code = item.pinId ?? item.hash;
  if (naming === 'hash') return item.hash;
  if (naming === 'pin') return item.pinId ? `pin_${item.pinId}` : item.hash;
  const nick = safeName(item.creator?.username ?? '', 40);
  let name = safeName(item.creator?.fullName ?? '', 50);
  if (name.toLowerCase() === nick.toLowerCase()) name = '';
  return [nick, name, code].filter(Boolean).join(' - ');
}
