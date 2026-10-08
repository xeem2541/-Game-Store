// กู้คืนข้อมูล: npm run restore -- backups/backup-2026-10-08-12-00-00 --yes
// ⚠️  หยุดเซิร์ฟเวอร์ก่อนเสมอ! ข้อมูลปัจจุบันจะถูกสำรองไว้ใน backups/pre-restore-* ก่อนเขียนทับ
import 'dotenv/config';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const [, , srcArg, flag] = process.argv;
const dbPath = path.resolve(process.env.DATABASE_PATH || './data/store.db');
const dataDir = path.dirname(dbPath);
const uploads = path.join(dataDir, 'uploads');
const root = path.resolve(process.env.BACKUP_DIR || './backups');

if (!srcArg) { console.error('ใช้: npm run restore -- <โฟลเดอร์สำรอง> --yes'); process.exit(1); }
const src = path.resolve(srcArg);
const srcDb = path.join(src, 'store.db');
if (!fs.existsSync(srcDb)) { console.error(`ไม่พบ ${srcDb} — ตรวจว่าเป็นโฟลเดอร์ backup-* ที่ถูกต้อง`); process.exit(1); }

// ตรวจไฟล์สำรองก่อนแตะข้อมูลปัจจุบัน
const manifestPath = path.join(src, 'manifest.json');
if (fs.existsSync(manifestPath)) {
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const sha = crypto.createHash('sha256').update(fs.readFileSync(srcDb)).digest('hex');
  if (m.sha256 && m.sha256 !== sha) { console.error('checksum ของไฟล์สำรองไม่ตรงกับ manifest — ไฟล์อาจเสียหาย ยกเลิกการกู้คืน'); process.exit(1); }
}
const probe = new Database(srcDb, { readonly: true });
const integrity = probe.pragma('integrity_check', { simple: true });
probe.close();
if (integrity !== 'ok') { console.error(`ไฟล์สำรองเสียหาย (${integrity}) — ยกเลิก`); process.exit(1); }

if (flag !== '--yes') {
  console.log(`จะกู้คืนจาก ${src}\n  → ${dbPath}\nข้อมูลปัจจุบันจะถูกสำรองไว้ก่อน  ยืนยันโดยเพิ่ม --yes (และหยุดเซิร์ฟเวอร์ก่อน)`);
  process.exit(2);
}

const stamp = new Date().toISOString().replace(/\..*$/, '').replace(/[:T]/g, '-');
const safety = path.join(root, `pre-restore-${stamp}`);
fs.mkdirSync(safety, { recursive: true });
if (fs.existsSync(dbPath)) {
  const cur = new Database(dbPath);
  await cur.backup(path.join(safety, 'store.db')); // รวมข้อมูลที่ยังค้างใน WAL
  cur.close();
}
if (fs.existsSync(uploads)) fs.cpSync(uploads, path.join(safety, 'uploads'), { recursive: true });

for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) fs.rmSync(f, { force: true });
fs.mkdirSync(dataDir, { recursive: true });
fs.copyFileSync(srcDb, dbPath);
fs.rmSync(uploads, { recursive: true, force: true });
if (fs.existsSync(path.join(src, 'uploads'))) fs.cpSync(path.join(src, 'uploads'), uploads, { recursive: true });

console.log(`✓ กู้คืนข้อมูลเรียบร้อย  (ข้อมูลก่อนกู้คืนสำรองไว้ที่ ${safety})`);
console.log('  เริ่มเซิร์ฟเวอร์ใหม่ได้เลย — ต้องใช้ KEY_ENCRYPTION_SECRET ตัวเดิมเพื่อให้ถอดรหัสโค้ดเกมได้');
