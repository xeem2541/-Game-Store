// สำรองข้อมูล: npm run backup
// - ฐานข้อมูล SQLite ด้วย Online Backup API (ปลอดภัยแม้เซิร์ฟเวอร์กำลังทำงาน/WAL เปิดอยู่ ไม่ใช่การ copy ไฟล์ตรงๆ)
// - โฟลเดอร์รูปที่อัปโหลด (data/uploads) และ manifest (ขนาด + sha256 + ผลตรวจความสมบูรณ์)
// ⚠️  ไม่รวม KEY_ENCRYPTION_SECRET / JWT_SECRET / Stripe keys — ต้องสำรอง .env แยกไว้ในที่ปลอดภัย (ไม่งั้นโค้ดเกมที่เข้ารหัสไว้ถอดรหัสไม่ได้)
import 'dotenv/config';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const dbPath = path.resolve(process.env.DATABASE_PATH || './data/store.db');
const root = path.resolve(process.env.BACKUP_DIR || './backups');
const keep = Math.max(1, Number(process.env.BACKUP_KEEP) || 14);
const uploads = path.join(path.dirname(dbPath), 'uploads');

if (!fs.existsSync(dbPath)) { console.error(`ไม่พบฐานข้อมูลที่ ${dbPath}`); process.exit(1); }

const stamp = new Date().toISOString().replace(/\..*$/, '').replace(/[:T]/g, '-');
const dir = path.join(root, `backup-${stamp}`);
fs.mkdirSync(dir, { recursive: true });
const target = path.join(dir, 'store.db');

const src = new Database(dbPath, { fileMustExist: true });
await src.backup(target);
src.close();

// ตรวจความสมบูรณ์ของไฟล์สำรอง
const check = new Database(target, { readonly: true });
const integrity = check.pragma('integrity_check', { simple: true });
const tables = check.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get().n;
check.close();
if (integrity !== 'ok') { console.error(`ไฟล์สำรองเสียหาย: ${integrity}`); process.exit(1); }

let uploadFiles = 0;
if (fs.existsSync(uploads)) {
  fs.cpSync(uploads, path.join(dir, 'uploads'), { recursive: true });
  uploadFiles = fs.readdirSync(path.join(dir, 'uploads'), { recursive: true }).length;
}
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
  createdAt: new Date().toISOString(), dbBytes: fs.statSync(target).size, sha256, tables, uploadFiles,
  note: 'ไม่รวม .env / KEY_ENCRYPTION_SECRET — ต้องสำรองแยก',
}, null, 2));

// เก็บล่าสุด N ชุด (ค่าเริ่มต้น 14) ลบชุดเก่า (ไม่แตะโฟลเดอร์ pre-restore-*)
const old = fs.readdirSync(root).filter((n) => /^backup-/.test(n)).sort().reverse().slice(keep);
for (const n of old) fs.rmSync(path.join(root, n), { recursive: true, force: true });

console.log(`✓ สำรองข้อมูลแล้ว: ${dir}`);
console.log(`  ฐานข้อมูล ${(fs.statSync(target).size / 1024).toFixed(0)} KB (${tables} ตาราง, integrity: ok), รูปอัปโหลด ${uploadFiles} ไฟล์${old.length ? `, ลบชุดเก่า ${old.length} ชุด` : ''}`);
console.log('  ⚠️  อย่าลืมสำรองไฟล์ .env (โดยเฉพาะ KEY_ENCRYPTION_SECRET) แยกไว้ในที่ปลอดภัย');
