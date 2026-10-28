// Chạy trong MAIN world từ document_start: lấy response JSON của các request fetch/XHR mà Pinterest gửi
// (GraphQL, /resource/…; khi đã đăng nhập thì chủ yếu là XHR) có chứa link ảnh/video pinimg.com, rồi
// chuyển nguyên văn cho content.js (ISOLATED world) tách.
// Pin trong lưới chỉ tạo thẻ <video> khi hover, nên không đọc dữ liệu này thì phải hover mới thấy.
// File này không dùng lib/extract.js: Chrome chỉ chèn mỗi file một lần cho một trang, khai báo ở cả hai
// world thì content.js sẽ không có nó.
(() => {
  // Có phiên bản để bản mới vẫn cài được khi tab còn hook cũ (gửi dữ liệu theo định dạng khác) từ trước
  // lúc cập nhật extension. Cờ đặt trên <html> để content.js (ISOLATED world) cũng đọc được.
  const VERSION = '2';
  if (document.documentElement.dataset.pvbdHook === VERSION) return;
  document.documentElement.dataset.pvbdHook = VERSION;

  const MAX_KEEP = 60; // giữ lại để gửi lại khi content.js mới sẵn sàng
  const kept = [];

  function forward(text) {
    if (typeof text !== 'string' || !text.includes('pinimg.com')) return;
    const first = text.trimStart()[0];
    if (first !== '{' && first !== '[') return; // chỉ JSON
    kept.push(text);
    if (kept.length > MAX_KEEP) kept.shift();
    window.postMessage({ source: 'pvbd-hook', texts: [text] }, location.origin);
  }

  const origFetch = window.fetch;
  window.fetch = function fetch(...args) {
    const promise = origFetch.apply(this, args);
    promise
      .then((res) => {
        if ((res.headers.get('content-type') ?? '').includes('json')) res.clone().text().then(forward, () => {});
      })
      .catch(() => {});
    return promise;
  };

  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function send(...args) {
    this.addEventListener('load', () => {
      try {
        if (this.responseType === '' || this.responseType === 'text') forward(this.responseText);
        else if (this.responseType === 'json' && this.response) forward(JSON.stringify(this.response));
      } catch {
        // bỏ qua response lạ, không làm hỏng trang
      }
    });
    return origSend.apply(this, args);
  };

  window.addEventListener('message', (e) => {
    if (e.source === window && e.data?.source === 'pvbd-content' && e.data.type === 'hello' && kept.length) {
      window.postMessage({ source: 'pvbd-hook', texts: [...kept] }, location.origin);
    }
  });
})();
