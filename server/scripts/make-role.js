// ใช้: npm run make-admin -- someone@example.com   |   npm run make-staff -- someone@example.com
// เลื่อนสิทธิ์ผู้ใช้ที่สมัครไว้แล้ว (ต้องสมัครสมาชิกที่หน้าเว็บก่อน)
import { db } from '../db/index.js';

const role = process.argv[2];
const email = (process.argv[3] ?? '').trim().toLowerCase();
if (!['admin', 'staff'].includes(role) || !email) {
  console.error('ใช้: npm run make-admin -- <email>   หรือ   npm run make-staff -- <email>');
  process.exit(1);
}
const r = db.prepare('UPDATE users SET role = ?, status = ? WHERE email = ?').run(role, 'active', email);
if (!r.changes) {
  console.error(`ไม่พบผู้ใช้อีเมล ${email} (ต้องสมัครสมาชิกก่อน)`);
  process.exit(1);
}
db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, meta) VALUES (NULL, ?, ?, ?, ?)')
  .run('user.role_set_cli', 'user', email, JSON.stringify({ role }));
console.log(`✓ ${email} เป็น ${role} แล้ว`);
