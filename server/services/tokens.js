import crypto from 'node:crypto';
import { db } from '../db/index.js';

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const TABLES = new Set(['email_verifications', 'password_resets']);

// สร้างโทเคนสุ่มแบบใช้ครั้งเดียว เก็บเฉพาะแฮชในฐานข้อมูล แล้วคืนค่าโทเคนจริงให้ส่งทางอีเมล
export function createToken(table, userId, ttlMs) {
  if (!TABLES.has(table)) throw new Error('invalid table');
  db.prepare(`DELETE FROM ${table} WHERE user_id = ? AND used_at IS NULL`).run(userId); // ยกเลิกโทเคนเก่า
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare(`INSERT INTO ${table} (user_id, token_hash, expires_at) VALUES (?, ?, ?)`)
    .run(userId, sha256(token), Date.now() + ttlMs);
  return token;
}

// ตรวจและ "ใช้" โทเคน (ครั้งเดียว) คืน user_id หรือ null
export function consumeToken(table, token) {
  if (!TABLES.has(table) || typeof token !== 'string') return null;
  const row = db.prepare(`SELECT id, user_id, expires_at, used_at FROM ${table} WHERE token_hash = ?`).get(sha256(token));
  if (!row || row.used_at || row.expires_at < Date.now()) return null;
  // UPDATE มีเงื่อนไข used_at IS NULL กันการใช้ซ้ำพร้อมกัน
  const r = db.prepare(`UPDATE ${table} SET used_at = ? WHERE id = ? AND used_at IS NULL`).run(Date.now(), row.id);
  return r.changes ? row.user_id : null;
}
