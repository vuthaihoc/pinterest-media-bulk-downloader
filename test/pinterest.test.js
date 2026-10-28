// Test lib/pinterest.js. Phần online gọi CDN thật của Pinterest; đặt OFFLINE=1 để bỏ qua.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  fileBase,
  hashFromUrl,
  matchSize,
  parseMaster,
  planFiles,
  posterFor,
  resolveImage,
  resolveVideo,
  safeName,
  singleFileOf,
} from '../lib/pinterest.js';

const CMAF_HASH = '5f2d33c4fc95d59a6705a097d8b45523'; // video mới: CMAF, có bản 720x1280
const TS_HASH = 'a5d7ab97ff87b9aa34d44a34fc0f51f0'; // video cũ (2021): segment .ts, cao nhất 480x852

test('hashFromUrl chỉ nhận link video', () => {
  assert.equal(hashFromUrl(posterFor(CMAF_HASH)), CMAF_HASH);
  assert.equal(hashFromUrl(`https://v1.pinimg.com/videos/iht/hls/5f/2d/33/${CMAF_HASH}_720w.m3u8`), CMAF_HASH);
  assert.equal(hashFromUrl(`https://i.pinimg.com/236x/5f/2d/33/${CMAF_HASH}.jpg`), null); // ảnh pin
  assert.equal(hashFromUrl(`https://v1.pinimg.com/videos/mc/hls/aa/bb/cc/${CMAF_HASH}.m3u8`), null); // thư mục không khớp hash
  assert.equal(hashFromUrl('blob:https://www.pinterest.com/81268b86'), null);
});

test('parseMaster sắp độ phân giải cao nhất lên đầu và lấy playlist audio', () => {
  const master = [
    '#EXTM3U',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="x_audio.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=618530,AVERAGE-BANDWIDTH=557049,RESOLUTION=360x640',
    'x_360w.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=2183582,AVERAGE-BANDWIDTH=2018604,RESOLUTION=720x1280',
    'x_720w.m3u8',
  ].join('\n');
  const { variants, audio } = parseMaster(master);
  assert.equal(audio, 'x_audio.m3u8');
  assert.deepEqual(variants.map((v) => [v.uri, v.height, v.bandwidth]), [
    ['x_720w.m3u8', 1280, 2183582],
    ['x_360w.m3u8', 640, 618530],
  ]);
});

test('singleFileOf phân biệt CMAF một file với segment .ts', () => {
  const cmaf = '#EXT-X-MAP:URI="x_720w.cmfv",BYTERANGE="879@0"\n#EXTINF:4.0,\n#EXT-X-BYTERANGE:862803@879\nx_720w.cmfv\n#EXTINF:4.0,\nx_720w.cmfv';
  const ts = '#EXTINF:4.000,\nx_480w_00001.ts\n#EXTINF:4.000,\nx_480w_00002.ts';
  assert.equal(singleFileOf(cmaf), 'x_720w.cmfv');
  assert.equal(singleFileOf(ts), null);
});

test('planFiles theo chất lượng', () => {
  const info = { video: { url: 'v.cmfv', width: 720, height: 1280 }, audio: { url: 'a.cmfa' }, mp4: { url: 'm.mp4' } };
  assert.deepEqual(planFiles(info, { quality: 'best', withAudio: false }).map((f) => [f.kind, f.suffix]), [['video', '.mp4']]);
  assert.deepEqual(planFiles(info, { quality: 'best', withAudio: true }).map((f) => f.suffix), ['.mp4', '_audio.m4a']);
  assert.deepEqual(planFiles(info, { quality: 'mp4', withAudio: false }).map((f) => f.suffix), ['.mp4']);
  assert.deepEqual(planFiles({ mp4: { url: 'm.mp4' } }, { quality: 'best' }).map((f) => f.suffix), ['.mp4']);
  assert.deepEqual(planFiles({}, { quality: 'best' }), []);
});

await import('../lib/extract.js'); // script thường, gán globalThis.__pvbd
const { extractPins, extractVideos, parseRelayScript } = globalThis.__pvbd;

test('extractVideos gán video và người đăng cho pin gần nhất chứa nó', () => {
  const hls = `https://v1.pinimg.com/videos/iht/hls/a5/d7/ab/${TS_HASH}.m3u8`;
  const data = {
    data: {
      v3GetPinQuery: {
        __typename: 'Pin',
        entityId: '741264419921123675',
        title: 'Pin đang mở',
        pinner: { __typename: 'User', username: 'nguoi_luu', fullName: 'Người lưu' },
        videos: null,
        originPin: {
          __typename: 'Pin',
          entityId: '741264557326088435',
          gridTitle: 'Pin gốc',
          pinner: { username: 'nguyenvana' }, // không có tên hiển thị
          nativeCreator: { username: 'nguyenvana', fullName: 'Nguyễn Văn A' },
          videos: { videoList: { vHLSV4: { thumbnail: posterFor(TS_HASH), url: hls } } },
        },
        // pin gợi ý khi chưa đăng nhập: entityId là token, không phải số
        related: [
          {
            __typename: 'Pin',
            entityId: 'e1_AfqPShwLUQNMKQ3e3e',
            videos: { videoList: { v720P: { url: `https://v1.pinimg.com/videos/iht/expMp4/v2/5f/2d/33/${CMAF_HASH}_540w.mp4` } } },
            videoUrls: [`https://v1.pinimg.com/videos/iht/hevcMp4V2/5f/2d/33/${CMAF_HASH}_t2.mp4`], // HEVC: bỏ
          },
        ],
        images: { orig: { url: `https://i.pinimg.com/originals/5f/2d/33/${CMAF_HASH}.jpg` } }, // ảnh, không phải video
      },
    },
  };
  assert.deepEqual(extractVideos(data), [
    {
      hash: TS_HASH,
      pinId: '741264557326088435',
      title: 'Pin gốc',
      creator: { username: 'nguyenvana', fullName: 'Nguyễn Văn A' },
      poster: posterFor(TS_HASH),
      width: 0,
      height: 0,
      hls: [hls],
      mp4: [],
    },
    {
      hash: CMAF_HASH,
      pinId: null, // không rơi vào pin đang mở
      title: null,
      creator: null,
      poster: null,
      width: 0,
      height: 0,
      hls: [],
      mp4: [`https://v1.pinimg.com/videos/iht/expMp4/v2/5f/2d/33/${CMAF_HASH}_540w.mp4`],
    },
  ]);
  // API REST cũ: type "pin" + id, full_name
  const [rest] = extractVideos({
    resource_response: {
      data: [{ type: 'pin', id: '123456789', pinner: { username: 'abc', full_name: 'A B C' }, videos: { video_list: { V_720P: { url: `https://v1.pinimg.com/videos/mc/720p/5f/2d/33/${CMAF_HASH}.mp4` } } } }],
    },
  });
  assert.equal(rest.pinId, '123456789');
  assert.deepEqual(rest.creator, { username: 'abc', fullName: 'A B C' });
});

test('extractPins: ảnh gốc của pin, kích thước video có sẵn, đánh dấu ảnh bìa pin video', () => {
  const IMG = '32dc066082a57e6116258a2bbe35a854';
  const COVER = '44e83311bba014dd9d09d904b688be3c';
  const { videos, images } = extractPins({
    resource_response: {
      data: [
        {
          type: 'pin',
          id: '111111',
          pinner: { username: 'a', full_name: 'A' },
          images: {
            '236x': { url: `https://i.pinimg.com/236x/44/e8/33/${COVER}.jpg`, width: 236, height: 420 },
            orig: { url: `https://i.pinimg.com/originals/44/e8/33/${COVER}.jpg`, width: 480, height: 852 },
          },
          videos: { video_list: { V_HLSV4: { url: `https://v1.pinimg.com/videos/iht/hls/a5/d7/ab/${TS_HASH}.m3u8`, width: 480, height: 852 } } },
        },
        {
          __typename: 'Pin',
          entityId: '222222',
          nativeCreator: { username: 'b', fullName: 'B' },
          images_736x: { url: `https://i.pinimg.com/736x/32/dc/06/${IMG}.jpg`, width: 736, height: 1308 },
          images_orig: { url: `https://i.pinimg.com/originals/32/dc/06/${IMG}.png`, width: 1080, height: 1920 },
          videos: null,
        },
      ],
    },
  });
  assert.deepEqual(videos.map((v) => [v.hash, v.pinId, v.width, v.height]), [[TS_HASH, '111111', 480, 852]]);
  assert.deepEqual(
    images.map((i) => [i.hash, i.pinId, i.size, i.ext, i.width, i.height, i.isVideo, i.creator?.username]),
    [
      [COVER, '111111', 'originals', 'jpg', 480, 852, true, 'a'],
      [IMG, '222222', 'originals', 'png', 1080, 1920, false, 'b'],
    ],
  );
});

test('matchSize lọc theo cạnh ngắn và hướng', () => {
  assert.ok(matchSize(720, 1280, '720', 'portrait'));
  assert.ok(!matchSize(540, 960, '720', '*'));
  assert.ok(matchSize(540, 960, 'lt480', '*') === false);
  assert.ok(matchSize(234, 416, 'lt480', '*'));
  assert.ok(matchSize(736, 414, '*', 'landscape'));
  assert.ok(!matchSize(736, 414, '*', 'portrait'));
  assert.ok(matchSize(1000, 1000, '*', 'square'));
  assert.ok(matchSize(0, 0, '*', '*'), 'chưa biết kích thước thì chỉ khớp khi không lọc');
  assert.ok(!matchSize(0, 0, '720', '*'));
});

test('safeName bỏ ký tự không an toàn trong tên hiển thị', () => {
  assert.equal(safeName('nguyenvana'), 'nguyenvana');
  assert.equal(safeName('Nguyễn Văn Á'), 'Nguyễn Văn Á');
  assert.equal(safeName('Nguyễn'), 'Nguyễn'); // tổ hợp dấu rời → NFC
  assert.equal(safeName('اجتهد'), 'اجتهد');
  assert.equal(safeName('a/b\\c:d*e?f"g<h>i|j'), 'a b c d e f g h i j');
  assert.equal(safeName('✨ Study 📚 Girl ✨'), 'Study Girl');
  assert.equal(safeName('evil‮gnp.exe'), 'evilgnp.exe'); // ký tự đảo chiều chữ
  assert.equal(safeName('zero​width\ttab\nline'), 'zerowidth tab line');
  assert.equal(safeName('...hidden. '), 'hidden');
  assert.equal(safeName('../../etc'), 'etc');
  assert.equal(safeName('a'.repeat(80), 50).length, 50);
  assert.equal(safeName(null), '');
});

test('fileBase: nick - tên hiển thị - mã', () => {
  const it = { hash: TS_HASH, pinId: '741264557326088435', creator: { username: 'nguyenvana', fullName: 'Nguyễn Văn A ✨' } };
  assert.equal(fileBase(it), 'nguyenvana - Nguyễn Văn A - 741264557326088435');
  assert.equal(fileBase({ ...it, creator: { username: 'abc', fullName: 'ABC' } }), 'abc - 741264557326088435'); // trùng nick
  assert.equal(fileBase({ ...it, creator: { username: null, fullName: 'Chỉ có tên' } }), 'Chỉ có tên - 741264557326088435');
  assert.equal(fileBase({ hash: TS_HASH, pinId: null, creator: null }), TS_HASH);
  assert.equal(fileBase(it, 'pin'), 'pin_741264557326088435');
  assert.equal(fileBase(it, 'hash'), TS_HASH);
});

test('parseRelayScript đọc script Relay nhúng trong HTML', () => {
  const text = `window.__PWS_RELAY_REGISTER_COMPLETED_REQUEST__("%7B%22queryID%22%3A%22d8%22%7D", {"data":{"a":1},"extensions":{"is_final":true}});`;
  assert.deepEqual(parseRelayScript(text), { data: { a: 1 }, extensions: { is_final: true } });
  assert.equal(parseRelayScript('console.log(1)'), null);
});

// Pinterest lúc nhúng script Relay (có pin ID), lúc chỉ có ld+json (khoảng 1/8 lần thử), nên đọc cả hai
// như content.js làm.
test('trang pin thật: video có sẵn trong HTML, không cần hover', { skip: process.env.OFFLINE === '1' }, async () => {
  const html = await (await fetch('https://www.pinterest.com/pin/741264419921123675/', { headers: { 'user-agent': 'Mozilla/5.0 Chrome/153 Safari/537.36' } })).text();
  const scriptsOf = (re) => [...html.matchAll(re)].map((m) => m[1]);
  const relay = scriptsOf(/<script[^>]*data-relay-completed-request[^>]*>([\s\S]*?)<\/script>/g)
    .map(parseRelayScript)
    .filter(Boolean)
    .flatMap(extractVideos);
  const ld = scriptsOf(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g).flatMap((t) => extractVideos(JSON.parse(t)));
  assert.ok([...relay, ...ld].some((v) => v.hash === TS_HASH), 'không thấy video trong Relay lẫn ld+json');
  const fromRelay = relay.find((v) => v.hash === TS_HASH);
  if (fromRelay) assert.equal(fromRelay.pinId, '741264419921123675');
});

test('resolveImage: có originals thì dùng luôn, chỉ có bản thu nhỏ thì tìm originals', { skip: process.env.OFFLINE === '1' }, async () => {
  const orig = 'https://i.pinimg.com/originals/32/dc/06/32dc066082a57e6116258a2bbe35a854.jpg';
  assert.equal((await resolveImage({ hash: '32dc066082a57e6116258a2bbe35a854', url: orig })).url, orig);
  const fromThumb = await resolveImage({ hash: '32dc066082a57e6116258a2bbe35a854', url: orig.replace('originals', '736x') });
  assert.match(fromThumb.url, /\/originals\/32\/dc\/06\/32dc066082a57e6116258a2bbe35a854\.(jpg|png|gif|webp)$/);
});

test('resolveVideo trên CDN thật', { skip: process.env.OFFLINE === '1' }, async () => {
  const cmaf = await resolveVideo(CMAF_HASH);
  assert.equal(cmaf.height, 1280);
  assert.match(cmaf.video.url, /_720w\.cmfv$/);
  assert.match(cmaf.audio.url, /_audio\.cmfa$/);
  assert.ok(cmaf.mp4, 'có MP4 dự phòng');

  const old = await resolveVideo(TS_HASH);
  assert.equal(old.height, 852);
  assert.equal(old.video, null, 'video .ts không tải nguyên file được');
  assert.match(old.mp4.url, /\/mc\/720p\/a5\/d7\/ab\//);
  assert.deepEqual(planFiles(old, { quality: 'best' }).map((f) => f.kind), ['mp4']);
});
