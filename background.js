// Service worker: bấm icon thì mở side panel, và ghi lại hash các video Pinterest mà tab tải qua mạng
// (playlist HLS, file .cmfv/.mp4, ảnh poster). Cách này bắt được cả video không còn thẻ <video>
// trong DOM, ví dụ pin đã phát rồi bị cuộn khỏi màn hình.
import { hashFromUrl } from './lib/pinterest.js';

const setBehavior = () => chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
chrome.runtime.onInstalled.addListener(setBehavior);
chrome.runtime.onStartup.addListener(setBehavior);

const MAX_PER_TAB = 3000;
let chain = Promise.resolve(); // ghi tuần tự để các request đến cùng lúc không đè nhau

async function record(tabId, hash) {
  const key = `net:${tabId}`;
  const { [key]: list = [] } = await chrome.storage.session.get(key);
  if (list.includes(hash)) return;
  list.push(hash);
  await chrome.storage.session.set({ [key]: list.slice(-MAX_PER_TAB) });
  chrome.runtime.sendMessage({ type: 'pvbd:net', tabId, hash }).catch(() => {});
}

chrome.webRequest.onBeforeRequest.addListener(
  ({ tabId, url }) => {
    if (tabId < 0) return;
    const hash = hashFromUrl(url);
    if (hash) chain = chain.then(() => record(tabId, hash)).catch(() => {});
  },
  { urls: ['https://*.pinimg.com/videos/*'] },
);

// Tab tải trang mới thì bỏ danh sách cũ: video của các trang trước không có dữ liệu pin (người đăng,
// pin ID) trên trang mới, và sẽ bị ghi nhầm là tìm thấy ở trang mới. Chỉ nghe các tên miền Pinterest
// khai báo trong manifest.
chrome.webRequest.onBeforeRequest.addListener(
  ({ tabId }) => {
    if (tabId >= 0) chain = chain.then(() => chrome.storage.session.remove(`net:${tabId}`)).catch(() => {});
  },
  { urls: chrome.runtime.getManifest().host_permissions.filter((u) => u.includes('.pinterest.')), types: ['main_frame'] },
);

chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(`net:${tabId}`));
