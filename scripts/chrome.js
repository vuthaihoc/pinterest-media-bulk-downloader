// Chrome headless điều khiển qua CDP (--remote-debugging-pipe), dùng cho test e2e và chụp ảnh cho store.
// Chrome 137+ bỏ cờ --load-extension, nên extension được nạp bằng Extensions.loadUnpacked (cần cờ
// --enable-unsafe-extension-debugging). Profile tạm và thư mục tải nằm trong `work`, bị xoá khi khởi động.
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function launchChrome(work) {
  rmSync(work, { recursive: true, force: true });
  mkdirSync(`${work}/profile/Default`, { recursive: true });
  mkdirSync(`${work}/downloads`);
  writeFileSync(
    `${work}/profile/Default/Preferences`,
    JSON.stringify({ download: { default_directory: `${work}/downloads`, prompt_for_download: false } }),
  );

  const proc = spawn(
    'google-chrome',
    [
      '--headless=new',
      '--remote-debugging-pipe',
      '--enable-unsafe-extension-debugging',
      `--user-data-dir=${work}/profile`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1280,900',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] },
  );

  let seq = 0;
  let buf = '';
  const waiters = new Map();
  const listeners = new Map();
  proc.stdio[4].setEncoding('utf8'); // không cắt đôi ký tự nhiều byte giữa hai chunk
  proc.stdio[4].on('data', (chunk) => {
    buf += chunk;
    for (let i; (i = buf.indexOf('\0')) >= 0; ) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      if (!msg.id) {
        for (const fn of listeners.get(msg.method) ?? []) fn(msg.params, msg.sessionId);
        continue;
      }
      const w = waiters.get(msg.id);
      if (!w) continue;
      waiters.delete(msg.id);
      msg.error ? w.reject(new Error(JSON.stringify(msg.error))) : w.resolve(msg.result);
    }
  });

  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      waiters.set(id, { resolve, reject });
      proc.stdio[3].write(`${JSON.stringify({ id, method, params, sessionId })}\0`);
    });
  async function evaluate(sessionId, expression) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
  const attach = async (targetId) => (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  const on = (method, fn) => listeners.set(method, [...(listeners.get(method) ?? []), fn]);

  return { send, evaluate, attach, on, close: () => proc.kill() };
}
