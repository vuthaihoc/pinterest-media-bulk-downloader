// Đóng gói extension thành file .zip để tải lên Chrome Web Store: dist/<tên>-<phiên bản>.zip.
// Chỉ gồm các file extension thật sự dùng, lần theo manifest → HTML (script, css) → import của JS, nên test,
// README, ảnh store và thư mục .work không lọt vào. Kiểm tra luôn các giới hạn của Web Store.
// Chạy: npm run package
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(EXT, 'manifest.json'), 'utf8'));
const problems = [];
const check = (ok, msg) => ok || problems.push(msg);

check(manifest.manifest_version === 3, 'manifest_version phải là 3');
check(manifest.name.length <= 75, `name dài ${manifest.name.length} ký tự (tối đa 75)`);
check(manifest.description.length <= 132, `description dài ${manifest.description.length} ký tự (tối đa 132)`);
check(/^\d+(\.\d+){0,3}$/.test(manifest.version), `version "${manifest.version}" sai định dạng (1–4 số, cách nhau bằng dấu chấm)`);
check(!!manifest.icons?.['128'], 'thiếu icon 128x128');

// Lần theo các file được tham chiếu
const files = new Set(['manifest.json']);
const queue = [
  manifest.background?.service_worker,
  manifest.side_panel?.default_path,
  ...Object.values(manifest.icons ?? {}),
  ...Object.values(manifest.action?.default_icon ?? {}),
  ...(manifest.content_scripts ?? []).flatMap((c) => [...(c.js ?? []), ...(c.css ?? [])]),
].filter(Boolean);

while (queue.length) {
  const file = normalize(queue.shift());
  if (files.has(file)) continue;
  if (!existsSync(join(EXT, file))) {
    problems.push(`thiếu file ${file}`);
    continue;
  }
  files.add(file);
  const dir = dirname(file);
  const text = /\.(html|js|css)$/.test(file) ? readFileSync(join(EXT, file), 'utf8') : '';
  const refs = file.endsWith('.html')
    ? [...text.matchAll(/<(?:script|link|img)\b[^>]*?\b(?:src|href)="([^"]+)"/g)].map((m) => m[1])
    : file.endsWith('.js')
      ? [...text.matchAll(/^\s*import\s[^'"]*?['"]([^'"]+)['"]/gm)].map((m) => m[1])
      : [];
  for (const ref of refs) {
    if (/^[a-z]+:/i.test(ref) || ref.startsWith('//')) {
      problems.push(`${file} nạp tài nguyên ngoài ${ref} (Web Store cấm mã từ xa)`);
      continue;
    }
    queue.push(join(dir, ref.split(/[?#]/)[0]));
  }
}

if (problems.length) {
  console.error(`Không đóng gói được:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}

const slug = manifest.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const out = join(EXT, 'dist', `${slug}-${manifest.version}.zip`);
mkdirSync(dirname(out), { recursive: true });
rmSync(out, { force: true });
const list = [...files].sort();
// -X: bỏ thuộc tính riêng của hệ điều hành (uid/gid…), -D: không ghi mục thư mục
execFileSync('zip', ['-q', '-X', '-D', '-9', out, ...list], { cwd: EXT });

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
for (const f of list) console.log(`  ${f.padEnd(24)} ${kb(statSync(join(EXT, f)).size)}`);
console.log(`\n${list.length} file → ${out} (${kb(statSync(out).size)})`);
