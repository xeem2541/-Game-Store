// ใช้: npm run reset-mfa -- someone@example.com
// ล้าง 2FA ของบัญชีหลังบ้านเมื่อทำโทรศัพท์หายและไม่มีรหัสกู้คืน (เช่น admin คนสุดท้าย) — ทุกเซสชันของบัญชีนั้นถูกเพิกถอน
import { db } from '../db/index.js';
import { resetMfa } from '../routes/admin/mfa.js';
import { audit } from '../services/audit.js';

const email = (process.argv[2] ?? '').trim().toLowerCase();
if (!email) {
  console.error('ใช้: npm run reset-mfa -- <email>');
  process.exit(1);
}
const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
if (!user) {
  console.error(`ไม่พบผู้ใช้อีเมล ${email}`);
  process.exit(1);
}
resetMfa(user.id);
audit(null, 'user.mfa_reset_cli', 'user', user.id, { email }); // ไม่มีผู้ใช้/IP — ทำจากเครื่องเซิร์ฟเวอร์
console.log(`✓ ล้าง 2FA ของ ${email} แล้ว — ล็อกอินหลังบ้านครั้งถัดไปต้องตั้ง 2FA ใหม่`);
