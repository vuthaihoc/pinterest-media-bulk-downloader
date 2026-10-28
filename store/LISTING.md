# Đăng lên Chrome Web Store

Mọi thứ cần điền khi đăng extension, theo đúng thứ tự các tab trong [Developer Dashboard](https://chrome.google.com/webstore/devconsole). Khối nào nằm trong ô code thì copy nguyên văn.

## 0. Chuẩn bị

1. **Tài khoản nhà phát triển:** đăng ký tại Developer Dashboard bằng tài khoản Google. Phí đăng ký 5 USD, trả một lần. Bật xác minh 2 bước cho tài khoản Google (bắt buộc).
2. **Đóng gói:**
   ```bash
   npm run package
   ```
   Lệnh này chạy unit test offline, rồi tạo `dist/pinterest-media-bulk-downloader-<phiên bản>.zip`. Zip chỉ gồm 13 file extension thật sự dùng (khoảng 40 KB), không có test, README hay ảnh store. Script cũng kiểm tra giới hạn của store: tên tối đa 75 ký tự, mô tả tối đa 132 ký tự, không nạp mã từ xa.
3. **Ảnh** (đã có trong `store/images/`; đổi tên extension thì tạo lại bằng `npm run store:images`):

   | File | Dùng cho | Bắt buộc |
   |---|---|---|
   | `icons/icon128.png` (nằm trong zip) | Icon store, 96×96 + viền trong suốt 16 px | Có |
   | `screenshot-1-download.png` … `screenshot-4-image-grid.png` | Ảnh chụp 1280×800, nên tải cả 4 theo thứ tự | Ít nhất 1 |
   | `promo-small-440x280.png` | Small promo tile | Không, nhưng giúp hiện nổi bật hơn |
   | `promo-marquee-1400x560.png` | Marquee promo tile | Không, chỉ dùng khi được chọn giới thiệu |

   Ảnh chụp dùng dữ liệu mẫu (người đăng "Nguyễn Văn A"…, ảnh vẽ bằng canvas), nên không có pin hay tên người dùng thật nào.

Mỗi lần cập nhật: tăng `version` trong `manifest.json`, chạy lại `npm run package`, rồi tải zip mới lên tab **Package**.

## 1. Tab Store listing

**Ngôn ngữ:** Tiếng Việt (giao diện extension chỉ có tiếng Việt).

**Tên** và **mô tả ngắn** lấy tự động từ `manifest.json`:
- Tên: `Pinterest Media Bulk Downloader`
- Mô tả ngắn: `Quét video và ảnh trên trang Pinterest, tải hàng loạt có delay cấu hình được. Số lượng, bộ lọc và thao tác hiện trong side panel.`

**Danh mục:** Productivity → Tools (Công cụ)

**Mô tả chi tiết:**

```text
Tải hàng loạt video và ảnh từ trang Pinterest bạn đang mở, ngay trong side panel bên cạnh trang.

TÌM FILE NGAY KHI MỞ TRANG
• Đọc thẳng dữ liệu pin của trang, không cần rê chuột vào từng pin.
• Chạy trên trang tìm kiếm, board, profile và trang chi tiết pin.
• "Tự cuộn + quét" cuộn trang để Pinterest nạp thêm pin. Khi bạn tự cuộn, file mới cũng tự vào danh sách.
• Rê chuột vào một video trong danh sách để xem trước (tắt tiếng, bản nhỏ).

TẢI HÀNG LOẠT CÓ KIỂM SOÁT
• Delay giữa mỗi file, cộng thêm thời gian ngẫu nhiên, có đếm ngược.
• Giới hạn số file mỗi lượt, dừng giữa chừng bất cứ lúc nào.
• Bỏ qua file đã tải ở các lượt trước.
• Video: bản nét nhất (file hình, không tiếng, có thể tải kèm âm thanh riêng), hoặc MP4 có sẵn tiếng.
• Ảnh: bản gốc với đúng định dạng (JPG, PNG, GIF, WebP).

LỌC VÀ ĐẶT TÊN
• Lọc theo trang tìm thấy, người đăng, kích thước (từ 1080p, 720p…), hướng (dọc, ngang, vuông) và trạng thái.
• Tên file dạng "nick - tên hiển thị - mã pin", tên hiển thị được làm sạch ký tự không an toàn.
• Lưu manifest JSON sau mỗi lượt tải (người đăng, link profile, trang nguồn, kích thước) để tra lại nguồn.
• Xuất danh sách ra JSON, hoặc copy link tải.
• Kéo rộng side panel thì danh sách chuyển sang dạng lưới.

QUYỀN RIÊNG TƯ
Extension không thu thập, không gửi và không bán dữ liệu của bạn; không có máy chủ riêng, không có analytics. Mọi xử lý diễn ra trên máy bạn. Extension chỉ kết nối tới Pinterest và CDN của Pinterest để tải file bạn chọn.

LƯU Ý
Video và ảnh trên Pinterest thuộc về người đăng. Chỉ tải nội dung bạn có quyền sử dụng, và xin phép chủ sở hữu trước khi dùng cho mục đích thương mại.

Extension này không thuộc và không được Pinterest, Inc. bảo trợ. Pinterest là thương hiệu của Pinterest, Inc.

Mã nguồn: https://github.com/vuthaihoc/pinterest-media-bulk-downloader
```

**Bản tiếng Anh**, nếu sau này thêm giao diện tiếng Anh và listing tiếng Anh:

```text
Bulk-download the videos and images on the Pinterest page you have open, from a side panel next to the page.

FINDS FILES AS SOON AS THE PAGE LOADS
• Reads the page's pin data directly; no need to hover over each pin.
• Works on search results, boards, profiles and pin pages.
• "Auto-scroll + scan" scrolls the page so Pinterest loads more pins. New files also appear while you scroll yourself.
• Hover a video in the list to preview it (muted, low resolution).

CONTROLLED BULK DOWNLOADS
• Delay between files plus optional random jitter, with a countdown.
• Limit files per run; stop at any time.
• Skips files you already downloaded.
• Videos: best quality (video-only file, optional separate audio) or MP4 with sound.
• Images: original file in its own format (JPG, PNG, GIF, WebP).

FILTERS AND FILE NAMES
• Filter by page, creator, size (1080p+, 720p+…), orientation and status.
• File names like "username - display name - pin ID", with unsafe characters removed.
• Saves a JSON manifest after each run (creator, profile link, source page, dimensions).
• Export the list as JSON or copy download links.
• Widen the side panel to get a grid view.

PRIVACY
The extension does not collect, transmit or sell your data. No backend, no analytics. Everything runs on your device; it only connects to Pinterest and Pinterest's CDN to download the files you choose.

NOTE
Videos and images on Pinterest belong to their creators. Only download content you have the right to use, and get permission before any commercial use.

Not affiliated with, endorsed by, or sponsored by Pinterest, Inc. Pinterest is a trademark of Pinterest, Inc.

Source code: https://github.com/vuthaihoc/pinterest-media-bulk-downloader
```

**Trang chủ (Homepage URL):** `https://github.com/vuthaihoc/pinterest-media-bulk-downloader`
**Hỗ trợ (Support URL):** `https://github.com/vuthaihoc/pinterest-media-bulk-downloader/issues`

## 2. Tab Privacy

Người duyệt đọc tiếng Anh, nên điền tab này bằng tiếng Anh.

**Single purpose:**

```text
Find the videos and images on the Pinterest page the user has open and download them in bulk, with a configurable delay between files, managed from a side panel.
```

**Permission justification:**

| Quyền | Nội dung điền |
|---|---|
| `sidePanel` | `The whole user interface (file list, filters, download queue, log) is a side panel shown next to the Pinterest tab; clicking the toolbar icon opens it.` |
| `downloads` | `Saves the videos and images the user selected, plus an optional JSON manifest, to the user's Downloads folder with chrome.downloads, one file at a time, waiting for each file to finish before the configured delay.` |
| `storage` | `Stores the user's settings and the IDs (hashes) of files already downloaded in chrome.storage.local, so later runs can skip them; and a per-tab list of video IDs seen on the network in chrome.storage.session, cleared when the tab navigates or closes. Nothing is synced or sent anywhere.` |
| `scripting` | `Injects the extension's own bundled content scripts (page-hook.js, lib/extract.js, content.js) into a Pinterest tab that was already open before the extension was installed or updated, so the side panel works without a reload. No remote code is injected.` |
| `webRequest` | `Observes (never blocks or modifies) requests from Pinterest tabs to https://*.pinimg.com/videos/* to note IDs of videos the page loaded that are no longer present in the page data, and listens for main-frame navigations on Pinterest domains to reset that per-tab list.` |
| Host permissions | `Content scripts read pin data (titles, creators, media URLs) on Pinterest pages. The side panel reads HLS playlists and image URLs on Pinterest's CDN (*.pinimg.com) to find the best-quality file and downloads it from there. The extension does not access any other site.` |

**Remote code:** chọn `No, I am not using remote code`. Mọi JS đều nằm trong zip, không có `eval`, không nạp script từ mạng.

**Data usage**, phần "What user data do you plan to collect":
- Chỉ đánh dấu **Website content**. Theo [FAQ của Chrome Web Store](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), dữ liệu chỉ xử lý trên máy người dùng vẫn phải khai. Extension đọc tiêu đề pin, người đăng và link file trên trang Pinterest.
- Không đánh dấu mục nào khác. Extension không đọc thông tin cá nhân, đăng nhập, vị trí, hay lịch sử duyệt web ngoài trang Pinterest đang mở.

Đánh dấu cả 3 cam kết:
- không bán hoặc chuyển dữ liệu cho bên thứ ba, ngoài các trường hợp được phép;
- không dùng hoặc chuyển dữ liệu cho mục đích không liên quan tới mục đích duy nhất;
- không dùng hoặc chuyển dữ liệu để xét khả năng tín dụng hay cho vay.

**Privacy policy URL:** `https://github.com/vuthaihoc/pinterest-media-bulk-downloader/blob/main/PRIVACY.md`

Link này chỉ chạy được sau khi `PRIVACY.md` đã được push lên nhánh `main`.

## 3. Tab Distribution

- **Payments:** Free.
- **Visibility:** chọn **Unlisted** cho lần đầu, để tự cài thử từ link store. Ổn rồi mới đổi sang **Public**.
- **Regions:** All regions.

Bấm **Submit for review**. Thời gian duyệt thường vài ngày. Extension có host permissions và `webRequest` có thể bị duyệt kỹ hơn, nên lâu hơn.

## Rủi ro khi duyệt và sau khi đăng

- **Tên extension bắt đầu bằng "Pinterest".** Chính sách của Chrome Web Store cấm khiến người dùng hiểu sản phẩm do công ty khác làm hoặc bảo trợ, và cấm vi phạm nhãn hiệu. Tên dạng "… for Pinterest" thể hiện rõ là công cụ dùng *cho* Pinterest, ít rủi ro hơn. Mô tả đã có dòng "không thuộc Pinterest, Inc." Nếu đổi tên: sửa `name` và `action.default_title` trong `manifest.json`, `<title>`/`<h1>` trong `sidepanel.html`, rồi chạy `npm run store:images` và `npm run package`.
- **Điều khoản của Pinterest** cấm thu thập dữ liệu tự động khi chưa được phép. Pinterest có thể gửi khiếu nại, và Google có thể gỡ extension. Delay mặc định và việc chỉ chạy khi người dùng bấm giúp giảm rủi ro, nhưng không loại bỏ được.
- **Bản quyền nội dung:** mô tả đã nhắc người dùng chỉ tải nội dung họ có quyền dùng.
