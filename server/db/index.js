import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { migrate } from './migrations.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
if (config.dbPath !== ':memory:') fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL'); // ปลอดภัยพอเมื่อใช้ WAL และเร็วกว่า FULL มาก
db.pragma('busy_timeout = 5000');  // รอสูงสุด 5 วินาทีเมื่อฐานข้อมูลถูกล็อก แทนที่จะ error ทันที
db.pragma('temp_store = MEMORY');
db.exec(fs.readFileSync(path.join(dir, 'schema.sql'), 'utf8')); // ตาราง (CREATE IF NOT EXISTS)
migrate(db);                                                      // แก้ตารางเดิม/ย้ายข้อมูล (ครั้งเดียวต่อรายการ)
db.exec(fs.readFileSync(path.join(dir, 'views.sql'), 'utf8'));   // view สร้างใหม่ทุกครั้ง หลัง migration
