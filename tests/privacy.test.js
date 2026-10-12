import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// นโยบายความเป็นส่วนตัวต้องตรงกับสิ่งที่โค้ดเก็บไว้จริง: คีย์ localStorage/sessionStorage ของหน้าร้าน และคุกกี้ที่เซิร์ฟเวอร์ตั้ง
// (เพิ่มคีย์ใหม่ในโค้ดโดยไม่แก้นโยบาย = เทสนี้ล้ม; เดิมนโยบายยังเขียนถึงคีย์ theme ที่เลิกใช้แล้ว และไม่มีคีย์ที่เพิ่มทีหลัง)
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const listJs = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'vendor' ? [] : listJs(path.join(dir, e.name))) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []));
const consts = (src) => new Map([...src.matchAll(/\bconst\s+([A-Z][A-Z_]*)\s*=\s*'([^']+)'/g)].map((m) => [m[1], m[2]]));
const privacy = read('public/privacy.html');
const listed = (key) => privacy.includes(`<code>${key}</code>`);

test('นโยบายความเป็นส่วนตัวระบุทุกคีย์ localStorage/sessionStorage ที่หน้าร้านใช้ และไม่มีคีย์ที่เลิกใช้แล้ว', () => {
  const used = new Set();
  for (const f of listJs('public/js')) {
    const src = read(f);
    const names = consts(src);
    for (const m of src.matchAll(/(?:local|session)Storage\.(?:get|set|remove)Item\(\s*([A-Za-z_]+|'[^']+')/g)) {
      const k = m[1].startsWith("'") ? m[1].slice(1, -1) : names.get(m[1]);
      assert.ok(k, `${f}: หาค่าคีย์ของ ${m[1]} ไม่เจอ (ประกาศเป็น const ตัวพิมพ์ใหญ่ในไฟล์เดียวกัน)`);
      used.add(k);
    }
  }
  assert.ok(used.size >= 6, `พบคีย์น้อยผิดปกติ (${[...used]}) — ตัวสแกนอาจพัง`);
  const missing = [...used].filter((k) => !listed(k));
  assert.deepEqual(missing, [], `คีย์ที่โค้ดใช้แต่นโยบายความเป็นส่วนตัว (public/privacy.html) ไม่ได้ระบุ: ${missing}`);
  assert.ok(!listed('theme'), 'นโยบายยังเขียนถึงคีย์ theme ที่ไม่ได้ใช้แล้ว (เว็บมีธีมมืดอย่างเดียว)');
});

test('นโยบายความเป็นส่วนตัวระบุทุกคุกกี้ที่เซิร์ฟเวอร์ตั้ง', () => {
  const used = new Set();
  for (const f of listJs('server')) {
    const src = read(f);
    const names = consts(src);
    for (const m of src.matchAll(/res\.cookie\(\s*([A-Za-z_]+|'[^']+')/g)) {
      const k = m[1].startsWith("'") ? m[1].slice(1, -1) : names.get(m[1]) ?? [...used].find(() => false);
      used.add(k ?? m[1]);
    }
  }
  // ค่าคงที่ที่ประกาศไว้ไฟล์อื่น (adminAuth.js ส่งออก ADMIN_COOKIE / MFA_PENDING_COOKIE)
  const adminConsts = consts(read('server/middleware/adminAuth.js'));
  const resolved = new Set([...used].map((k) => adminConsts.get(k) ?? k));
  assert.ok(resolved.size >= 5, `พบคุกกี้น้อยผิดปกติ (${[...resolved]})`);
  const missing = [...resolved].filter((k) => !listed(k));
  assert.deepEqual(missing, [], `คุกกี้ที่เซิร์ฟเวอร์ตั้งแต่นโยบายไม่ได้ระบุ: ${missing}`);
});
