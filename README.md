# Pinterest Media Bulk Downloader

Chrome extension (Manifest V3) quét **video và ảnh** trên trang Pinterest rồi tải hàng loạt, có delay giữa các lần tải. Số lượng, bộ lọc, tiến độ và nhật ký thao tác hiện trong side panel.

## Cài đặt

1. Mở `chrome://extensions`, bật **Developer mode**.
2. Bấm **Load unpacked**, chọn thư mục này.
3. Ghim icon extension lên thanh công cụ. Bấm icon để mở side panel.

Cần Chrome 116 trở lên.

**Sau khi cập nhật code:** bấm nút tải lại của extension trong `chrome://extensions`, rồi **tải lại tab Pinterest (F5)**. Tab mở từ trước sẽ bỏ lỡ dữ liệu pin đã nạp; panel sẽ nạp bù script và ghi cảnh báo trong nhật ký.

## Cách dùng

1. Mở một trang Pinterest (tìm kiếm, board, profile, trang pin) rồi mở side panel. Panel tự quét một lần khi mở.
2. Chọn tab **Video** hoặc **Ảnh**. Hai tab có danh sách riêng nhưng dùng chung cài đặt, hàng đợi và nhật ký.
3. **Quét trang**: lấy video/ảnh đang có. **Tự cuộn + quét**: cuộn trang để Pinterest nạp thêm pin; bấm lại để dừng, tự dừng khi hết trang. Khi bạn tự cuộn, file mới cũng tự vào danh sách.
4. Lọc danh sách nếu cần:
   - **trang tìm thấy**;
   - **người đăng**;
   - **kích thước** (theo cạnh ngắn: từ 1080p / 720p / 540p / 480p, hoặc dưới 480p);
   - **hướng** (dọc / ngang / vuông);
   - **trạng thái**.

   Bộ lọc áp dụng cho "Chọn tất cả", nút tải, Xuất JSON và Copy link. Nút tải ghi rõ số file sẽ tải, ví dụ "Tải 17 video (theo bộ lọc)".
5. Bỏ chọn file không cần, rồi bấm nút tải. **Dừng**: file đang tải sẽ tải nốt, các file sau sẽ không tải.

**Giữ side panel mở trong lúc tải**, vì hàng đợi chạy ngay trong panel.

Trong danh sách:
- **Rê chuột vào một video để xem trước**: tắt tiếng, lặp lại, dùng bản nhỏ khoảng 360p, chỉ tải khi rê chuột vào.
- Mỗi mục có tiêu đề, người đăng (link tới profile), độ phân giải, định dạng, nguồn tìm thấy, và hai link **Mở pin ↗** (trang chi tiết pin) và **trang tìm thấy ↗**.
- Kéo rộng side panel từ 560 px trở lên thì danh sách chuyển sang dạng lưới.

Các ô đếm: Phát hiện · Đã chọn · Sẵn sàng (đã có link tải) · Đã tải · Lỗi · Bỏ qua (đã tải ở lượt trước).

## Cài đặt trong panel

| Mục | Mặc định | Ghi chú |
|---|---|---|
| Delay giữa mỗi file | 3 giây | Chờ sau mỗi file, có đếm ngược |
| Cộng thêm ngẫu nhiên | 2 giây | Delay thật = delay + ngẫu nhiên 0…N giây |
| Số file tối đa mỗi lượt | 0 (không giới hạn) | |
| Đặt tên file | `nick - tên hiển thị - mã` | Xem mục "Tên file". Có thêm kiểu `pin_<id>` và `<mã>` |
| Video: chất lượng | Nét nhất | Xem mục "Định dạng file" |
| Video: tải kèm âm thanh riêng | tắt | Chỉ dùng cho video CMAF |
| Video: thư mục | `pinterest-videos` | Thư mục con trong Downloads (Chrome chỉ cho lưu ở đó) |
| Ảnh: gồm cả ảnh bìa của pin video | tắt | Mặc định tab Ảnh chỉ có pin ảnh |
| Ảnh: thư mục | `pinterest-images` | |
| Tự cuộn | 20 lần, chờ 2 giây mỗi lần | |
| Tự thêm khi trang cuộn | bật | |
| Bỏ qua file đã tải | bật | Nhớ lịch sử theo hash, giữ qua các lần mở Chrome |
| Lưu manifest JSON | bật | Sau mỗi lượt tải, lưu `manifest_<thời gian>.json` vào thư mục của tab đó |

## Cách tìm video và ảnh

Pinterest không để lộ link file trong DOM:
- thẻ `<video>` phát qua HLS nên `src` chỉ là `blob:`;
- pin trong lưới chỉ tạo `<video>` khi hover;
- ảnh trong lưới chỉ là bản thu nhỏ.

Vì vậy extension đọc thẳng **dữ liệu pin** của Pinterest, **không cần hover**. Cột nguồn trong danh sách cho biết nguồn:

- **`json` / `relay`**: dữ liệu nhúng trong HTML khi tải trang. Đăng nhập thì là `__PWS_INITIAL_PROPS__` (REST: `type: "pin"`, `pinner`, `video_list`, `images.orig`). Chưa đăng nhập thì là script Relay `__PWS_RELAY_REGISTER_COMPLETED_REQUEST__` và ld+json.
- **`api`**: response mà trang gọi khi cuộn hoặc nạp pin gợi ý. Đăng nhập thì chủ yếu là XHR `/resource/BaseSearchResource/get/`…; chưa đăng nhập thì là GraphQL. `page-hook.js` chạy trong MAIN world từ `document_start`, đọc các response này rồi chuyển sang `content.js`.
- **`video`**: ảnh poster của thẻ `<video>`, khi poster là ảnh video (`/videos/thumbnails/…`).
- **`network`**: các request tới `*.pinimg.com/videos/*` mà tab gửi kể từ lần tải trang gần nhất.

Mỗi video được gán cho **pin gần nhất chứa nó** trong dữ liệu. Mỗi pin cho ra một ảnh, là ảnh lớn nhất của pin (thường là bản `originals`). Với pin đăng lại (repin), pin ID có thể là pin gốc.

Mỗi lần quét, nhật ký ghi số file theo từng nguồn, ví dụ `25 video (json 25; network 4), 40 ảnh (json 40)`. Nếu một mục chỉ có nguồn `network` thì không có dữ liệu pin đi kèm, nên không có người đăng và link pin.

## Tên file

Mặc định là `nick - tên hiển thị - mã.<đuôi>`, ví dụ `nguyenvana - Nguyễn Văn A - 123456789012345678.mp4`:

- **nick**: `username` của người đăng, chính là phần trong URL profile (`pinterest.com/nguyenvana/`). Chỉ gồm chữ, số, `_ . -` nên luôn an toàn.
- **tên hiển thị**: `fullName`, người dùng tự đặt, nên **có thể chứa ký tự không an toàn**:
  - `/ \ : * ? " < > |` (cấm trên Windows/macOS) được đổi thành khoảng trắng;
  - bị bỏ đi: emoji, ký hiệu, ký tự điều khiển, ký tự đảo chiều chữ (ví dụ U+202E, có thể dùng để giả đuôi file), khoảng trắng vô hình;
  - giữ lại: chữ mọi ngôn ngữ (kể cả có dấu tiếng Việt, chữ Ả Rập…), số và vài dấu câu thường gặp;
  - gộp khoảng trắng liền nhau, bỏ dấu chấm hoặc gạch ở đầu và cuối, tối đa 50 ký tự;
  - trùng nick thì bỏ đi.
- **mã**: pin ID; không có thì dùng hash của video/ảnh.

**Người đăng** lấy theo thứ tự `nativeCreator` (người tạo) → `closeupUnifiedAttribution` → `closeupAttribution` → `originPinner` → `pinner` (người lưu pin). Phần nào không có thì bỏ khỏi tên. Trùng tên thì Chrome tự thêm số `(1)`. Độ phân giải không đưa vào tên mà ghi trong manifest.

## Định dạng file

**Video:**
- **Video mới (CMAF):**
  - Mỗi độ phân giải là một file `<hash>_720w.cmfv` chứa **chỉ hình**; âm thanh nằm riêng ở `<hash>_audio.cmfa`.
  - Chế độ **Nét nhất** tải bản cao nhất thành `.mp4` (fragmented MP4, không tiếng). Bật "Tải kèm âm thanh riêng" thì có thêm `<tên>_audio.m4a`.
  - Ghép hình với tiếng:
    ```bash
    ffmpeg -i X.mp4 -i X_audio.m4a -c copy X_merged.mp4
    ```
- **Video cũ (segment `.ts`):** không tải nguyên file được, nên lấy file MP4 có tiếng.
- **Chế độ "MP4 có tiếng"** ưu tiên file MP4, ưu tiên link có trong dữ liệu trang rồi mới đến `mc/720p/…`. File này **có khi rất kém nét**: thử thực tế có video HLS 720×1280 nhưng MP4 chỉ 234×416.
- Link HLS/MP4 có trong dữ liệu trang (ví dụ `iht/hls/v2/…`) được thử trước link dựng từ hash. Bản AV1/HEVC bị bỏ qua. Chỉ tải từ `*.pinimg.com`.

**Ảnh:**
- Tải bản gốc `i.pinimg.com/originals/…` với đúng đuôi trong dữ liệu (jpg/png/gif/webp).
- Nếu dữ liệu chỉ có bản thu nhỏ, extension thử các đuôi của bản gốc, không được thì tải bản lớn nhất đang có.

## Xuất dữ liệu

- **Xuất JSON**: lưu danh sách đang hiển thị của tab: hash, pin, tiêu đề, người đăng, `profileUrl`, trang nguồn, kích thước, link file, file đã tải.
- **Copy link**: copy link tải của các file đang chọn.

Video và ảnh trên Pinterest thuộc về người đăng, nên muốn dùng thương mại (ví dụ cho quảng cáo) thì phải xin phép hoặc có license. Giữ manifest để còn tra lại nguồn.

## Cấu trúc

| File | Vai trò |
|---|---|
| `manifest.json` | Khai báo extension, quyền, content script |
| `background.js` | Service worker: mở side panel; ghi hash video từ request mạng của tab |
| `page-hook.js` | MAIN world: đọc response XHR/fetch của Pinterest, chuyển cho `content.js` |
| `lib/extract.js` | Tách video/ảnh, pin ID, người đăng, kích thước từ JSON của Pinterest |
| `content.js` | ISOLATED world: quét dữ liệu trong trang, tự cuộn, báo về side panel |
| `lib/pinterest.js` | Tìm link tải (HLS/CMAF/MP4, ảnh gốc), bộ lọc kích thước, đặt tên file |
| `sidepanel.*` | Giao diện, bộ lọc, hàng đợi tải, nhật ký |

## Test

```bash
npm test
```
Chạy unit test cho `lib/extract.js` và `lib/pinterest.js`, gồm cả gọi CDN và HTML thật của Pinterest. Mất khoảng 2 giây. Đặt `OFFLINE=1` để bỏ phần gọi mạng.

```bash
node test/e2e.js
```
Test đầu-cuối, mất khoảng 1–1,5 phút; tuỳ chọn truyền URL trang Pinterest:
- Mở Chrome headless với profile tạm ở `.work/e2e/` (đã có trong `.gitignore`; đặt `PVBD_WORK` để đổi chỗ) và nạp extension qua CDP. Chrome 137+ đã bỏ cờ `--load-extension`.
- Điều khiển side panel: quét, tự cuộn, thử các bộ lọc, hover xem trước, tải 2 video, tải 2 ảnh.
- Lưu ảnh chụp side panel ở khổ hẹp và khổ rộng.

Phần lớn thời gian là chờ trang và CDN Pinterest. Profile này chưa đăng nhập.

## Giới hạn

- **Pin ID và người đăng chỉ có khi dữ liệu Pinterest gửi về có chúng.** Khi đã đăng nhập thì gần như pin nào cũng có. Khi chưa đăng nhập, pin gợi ý và kết quả tìm kiếm chỉ có token `e1_…` và không có người đăng, nên tên file là hash.
- **Tên miền:** chỉ chạy trên các tên miền Pinterest khai báo trong `manifest.json`. Cần thêm quốc gia nào thì thêm vào `host_permissions` và `content_scripts.matches`.
- **Tải tuần tự:** mỗi lúc chỉ tải 1 file.
