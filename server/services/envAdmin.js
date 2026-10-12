// บัญชีแอดมินจากตัวแปรแวดล้อม ADMIN_EMAIL + ADMIN_PASSWORD — สำหรับเซิร์ฟเวอร์ที่ไม่มี Shell ให้รัน make-role.js
// (เช่น Render plan ฟรี ที่ข้อมูลถูกล้างทุกครั้งที่หลับ/deploy) ทำงานทุกครั้งที่สตาร์ท:
// - ยังไม่มีบัญชีนี้ → สร้างเป็น admin (ยืนยันอีเมลแล้ว)
// - มีแล้ว → ตั้งเป็น admin + active; รหัสผ่านไม่ตรงกับ ADMIN_PASSWORD → ใช้ค่าใน env และออกจากระบบทุกเซสชันเดิม
// ไม่ได้ตั้งทั้งคู่ = ไม่ทำอะไร (ความแข็งแรงของรหัสผ่านตรวจใน envcheck.js / ตอนสตาร์ท production)
import { db } from '../db/index.js';
import { checkPassword, hashPassword } from './passwords.js';

export const ADMIN_PASSWORD_MIN = 12;

export async function ensureEnvAdmin(env = process.env, { log = console.log } = {}) {
  const email = (env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  const password = env.ADMIN_PASSWORD ?? '';
  if (!email && !password) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < ADMIN_PASSWORD_MIN) {
    log(`⚠️  ไม่ได้สร้างแอดมินจาก ADMIN_EMAIL: ต้องตั้งอีเมลที่ถูกต้อง และ ADMIN_PASSWORD ยาวอย่างน้อย ${ADMIN_PASSWORD_MIN} ตัวอักษร`);
    return null;
  }
  const audit = (action, userId) => db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, meta) VALUES (NULL, ?, ?, ?, ?)')
    .run(action, 'user', String(userId), JSON.stringify({ email, source: 'env' }));

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) {
    const { lastInsertRowid } = db.prepare("INSERT INTO users (email, name, password_hash, role, email_verified) VALUES (?, ?, ?, 'admin', 1)")
      .run(email, env.ADMIN_NAME?.trim() || 'Admin', await hashPassword(password));
    audit('user.admin_env_created', lastInsertRowid);
    log(`✓ สร้างบัญชีแอดมินจาก ADMIN_EMAIL: ${email}`);
    return { id: Number(lastInsertRowid), created: true };
  }
  const passwordChanged = !(await checkPassword(user, password));
  db.prepare("UPDATE users SET role = 'admin', status = 'active', email_verified = 1 WHERE id = ?").run(user.id);
  if (passwordChanged) {
    db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?').run(await hashPassword(password), user.id);
  }
  if (user.role !== 'admin' || passwordChanged) {
    audit('user.admin_env_updated', user.id);
    log(`✓ ${email} เป็นแอดมินจาก ADMIN_EMAIL${passwordChanged ? ' (ตั้งรหัสผ่านตาม ADMIN_PASSWORD แล้ว)' : ''}`);
  }
  return { id: user.id, created: false, passwordChanged };
}
