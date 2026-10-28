# Chính sách quyền riêng tư · Privacy Policy

**Pinterest Media Bulk Downloader** · cập nhật / last updated: 2026-10-28

## Tiếng Việt

Extension này **không thu thập, không gửi và không bán** dữ liệu của bạn. Không có máy chủ riêng, không có phân tích (analytics), không có quảng cáo.

**Dữ liệu extension đọc, chỉ xử lý trên máy bạn:**
- Dữ liệu pin trên trang Pinterest bạn đang mở: tiêu đề, pin ID, nick và tên hiển thị của người đăng, link video và ảnh. Dùng để hiện danh sách trong side panel và đặt tên file.
- Địa chỉ trang Pinterest nơi tìm thấy mỗi file. Dùng cho bộ lọc "trang tìm thấy" và ghi vào manifest.
- Các request của tab Pinterest tới `*.pinimg.com/videos/*`. Chỉ quan sát để lấy mã video, không chặn và không sửa.

**Dữ liệu được lưu, chỉ trên máy bạn:**
- Cài đặt của extension và danh sách mã (hash) các file đã tải, trong `chrome.storage.local`. Xoá được bằng nút "Xoá lịch sử đã tải" hoặc bằng cách gỡ extension.
- Danh sách mã video đã thấy trên mạng của từng tab, trong `chrome.storage.session`. Bị xoá khi tab chuyển trang hoặc đóng.
- File bạn tải, kèm file manifest JSON (nếu bật), trong thư mục Downloads của bạn.

**Kết nối mạng:** extension chỉ gửi request tới Pinterest và CDN của Pinterest (`*.pinimg.com`) để đọc playlist video và tải file bạn chọn. Không gửi dữ liệu nào tới bên thứ ba hay tới nhà phát triển.

**Liên hệ:** mở issue tại https://github.com/vuthaihoc/pinterest-media-bulk-downloader/issues

## English

This extension **does not collect, transmit or sell** your data. There is no backend server, no analytics and no advertising.

**Data the extension reads, processed only on your device:**
- Pin data on the Pinterest page you have open: title, pin ID, the creator's username and display name, video and image URLs. Used to list files in the side panel and to name downloaded files.
- The URL of the Pinterest page where each file was found. Used for the "found on page" filter and written to the manifest.
- Requests from the Pinterest tab to `*.pinimg.com/videos/*`. Only observed to read video IDs, never blocked or modified.

**Data stored, only on your device:**
- Extension settings and the IDs (hashes) of files already downloaded, in `chrome.storage.local`. Clear them with the "Xoá lịch sử đã tải" (clear download history) button or by uninstalling the extension.
- A per-tab list of video IDs seen on the network, in `chrome.storage.session`. Cleared when the tab navigates or closes.
- The files you download, plus an optional JSON manifest, in your Downloads folder.

**Network access:** the extension only sends requests to Pinterest and Pinterest's CDN (`*.pinimg.com`) to read video playlists and download the files you select. No data is sent to third parties or to the developer.

**Contact:** open an issue at https://github.com/vuthaihoc/pinterest-media-bulk-downloader/issues

---

This extension is not affiliated with, endorsed by, or sponsored by Pinterest, Inc. Extension này không thuộc và không được Pinterest, Inc. bảo trợ.
