import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { migrate } from './migrations.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const isNewDb = config.dbPath !== ':memory:' && prepareDataDir(config.dbPath);

// ตรวจโฟลเดอร์ข้อมูลก่อนเปิดฐานข้อมูล คืน true ถ้ายังไม่มีไฟล์ฐานข้อมูล (จะถูกสร้างใหม่)
// กันข้อมูลหายแบบเงียบ ๆ: disk ไม่ถูก mount → SQLite สร้างไฟล์ว่างในระบบไฟล์ชั่วคราว แล้วถูกล้างตอน deploy ถัดไป
function prepareDataDir(dbPath) {
  const dataDir = path.dirname(path.resolve(dbPath));
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.accessSync(dataDir, fs.constants.W_OK);
  } catch (e) {
    throw new Error(`เขียนโฟลเดอร์ข้อมูล ${dataDir} ไม่ได้ (${e.code}) — ตรวจว่า disk/volume ถูก mount ที่ตำแหน่งนี้ และผู้ใช้ที่รันแอปมีสิทธิ์เขียน (Docker image รันด้วย user "node")`);
  }
  const missing = !fs.existsSync(dbPath);
  if (missing && config.requireExistingDb) {
    throw new Error(`ไม่พบฐานข้อมูลที่ ${path.resolve(dbPath)} แต่ตั้ง REQUIRE_EXISTING_DB=1 ไว้ — ไม่สร้างฐานข้อมูลว่างใหม่ให้ (disk ไม่ได้ถูก mount หรือ DATABASE_PATH ผิด?) ถ้าตั้งใจเริ่มใหม่จริงให้ลบ REQUIRE_EXISTING_DB ชั่วคราว`);
  }
  return missing;
}

export const db = new Database(config.dbPath);
if (isNewDb && config.isProd) {
  console.warn(`⚠️  สร้างฐานข้อมูลใหม่ (ว่าง) ที่ ${path.resolve(config.dbPath)} — ถ้านี่ไม่ใช่การ deploy ครั้งแรก แปลว่าข้อมูลเดิมหาย/disk ไม่ถูก mount (ตั้ง REQUIRE_EXISTING_DB=1 หลังติดตั้งครั้งแรกเพื่อกันกรณีนี้)`);
}
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL'); // ปลอดภัยพอเมื่อใช้ WAL และเร็วกว่า FULL มาก
db.pragma('busy_timeout = 5000');  // รอสูงสุด 5 วินาทีเมื่อฐานข้อมูลถูกล็อก แทนที่จะ error ทันที
db.pragma('temp_store = MEMORY');
db.exec(fs.readFileSync(path.join(dir, 'schema.sql'), 'utf8')); // ตาราง (CREATE IF NOT EXISTS)
migrate(db);                                                      // แก้ตารางเดิม/ย้ายข้อมูล (ครั้งเดียวต่อรายการ)
db.exec(fs.readFileSync(path.join(dir, 'views.sql'), 'utf8'));   // view สร้างใหม่ทุกครั้ง หลัง migration
