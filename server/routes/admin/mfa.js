import QRCode from 'qrcode';
import { z } from 'zod';
import { config } from '../../config.js';
import { db } from '../../db/index.js';
import { mfaPendingUser, mfaSatisfied, clearMfaPendingCookie, setAdminCookie } from '../../middleware/adminAuth.js';
import { revokeSessions } from '../../middleware/auth.js';
import { audit } from '../../services/audit.js';
import { decrypt, encrypt } from '../../services/crypto.js';
import { HttpError } from '../../services/errors.js';
import { hashRecoveryCode, newRecoveryCodes, newTotpSecret, otpauthUrl, verifyTotp } from '../../services/totp.js';

// 2FA (TOTP) ของบัญชีหลังบ้าน — ขั้นตอน: ล็อกอินด้วยรหัสผ่าน → (ยังไม่เคยตั้ง) setup → enable ได้รหัสกู้คืน
//                                                    → (ตั้งแล้ว) verify ด้วยรหัสจากแอปหรือรหัสกู้คืน
const codeBody = z.object({ code: z.string().trim().min(6).max(20) });
const ISSUER = 'Game Store Admin';

export const recoveryCodesLeft = (userId) =>
  db.prepare('SELECT COUNT(*) AS n FROM admin_recovery_codes WHERE user_id = ? AND used_at IS NULL').get(userId).n;

export function mfaStatus(user, sessionMfa) {
  const enabled = !!user.totp_enabled;
  return {
    enabled, required: config.adminMfaRequired, verified: sessionMfa,
    setupRequired: !enabled && !mfaSatisfied(user, sessionMfa),
    recoveryCodesLeft: enabled ? recoveryCodesLeft(user.id) : 0,
  };
}

// ยืนยันรหัส 6 หลักจากแอป: ใช้ได้ครั้งเดียวต่อช่วงเวลา (UPDATE มีเงื่อนไข last_step กันส่งรหัสเดิมซ้ำพร้อมกัน)
function consumeTotp(user, code) {
  if (!user.totp_secret_enc) return false;
  const step = verifyTotp(decrypt(user.totp_secret_enc), code, { lastStep: user.totp_last_step });
  if (step === null) return false;
  return db.prepare('UPDATE users SET totp_last_step = ? WHERE id = ? AND totp_last_step < ?').run(step, user.id, step).changes === 1;
}

const consumeRecoveryCode = (user, code) =>
  db.prepare('UPDATE admin_recovery_codes SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND code_hash = ? AND used_at IS NULL')
    .run(user.id, hashRecoveryCode(code)).changes === 1;

// ---- ขั้นที่ 2 ของการล็อกอิน (ยังไม่มีเซสชันแอดมิน — ใช้คุกกี้รอยืนยันที่ได้จากการใส่รหัสผ่านถูก) ----
export async function verifyLogin(req, res) {
  const user = mfaPendingUser(req.cookies);
  if (!user) throw new HttpError(401, 'หมดเวลายืนยันรหัส กรุณาเข้าสู่ระบบใหม่', 'MFA_SESSION_EXPIRED');
  const { code } = codeBody.parse(req.body);
  let method = null;
  if (/^\s*\d{6}\s*$/.test(code) && consumeTotp(user, code)) method = 'totp';
  else if (consumeRecoveryCode(user, code)) method = 'recovery';
  if (!method) {
    audit({ user, ip: req.ip }, 'admin.mfa_failed', 'user', user.id);
    throw new HttpError(401, 'รหัสยืนยันไม่ถูกต้อง หรือถูกใช้ไปแล้ว', 'MFA_INVALID');
  }
  clearMfaPendingCookie(res);
  setAdminCookie(res, user, { mfa: true });
  const left = recoveryCodesLeft(user.id);
  audit({ user, ip: req.ip }, 'admin.login', 'user', user.id, { mfa: method, ...(method === 'recovery' ? { recoveryCodesLeft: left } : {}) });
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role }, recoveryCodesLeft: left });
}

// ---- ตั้งค่า 2FA ครั้งแรก (มีเซสชันที่ยืนยันแค่รหัสผ่าน) ----
export async function setup(req, res) {
  if (req.user.totp_enabled) throw new HttpError(409, 'เปิดใช้ 2FA อยู่แล้ว', 'MFA_ALREADY_ENABLED');
  const secret = newTotpSecret();
  db.prepare('UPDATE users SET totp_secret_enc = ?, totp_last_step = 0 WHERE id = ?').run(encrypt(secret), req.user.id);
  const url = otpauthUrl({ issuer: ISSUER, account: req.user.email, secret });
  const qrSvg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  res.set('Cache-Control', 'no-store').json({ secret, otpauthUrl: url, qrSvg });
}

export function enable(req, res) {
  if (req.user.totp_enabled) throw new HttpError(409, 'เปิดใช้ 2FA อยู่แล้ว', 'MFA_ALREADY_ENABLED');
  if (!req.user.totp_secret_enc) throw new HttpError(409, 'กรุณาเริ่มตั้งค่า 2FA ก่อน', 'MFA_SETUP_FIRST');
  const { code } = codeBody.parse(req.body);
  if (!consumeTotp(req.user, code)) throw new HttpError(400, 'รหัสจากแอปไม่ถูกต้อง — ตรวจว่าเวลาในโทรศัพท์ตรง แล้วลองรหัสใหม่', 'MFA_INVALID');
  const codes = newRecoveryCodes();
  db.transaction(() => {
    db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(req.user.id);
    db.prepare('DELETE FROM admin_recovery_codes WHERE user_id = ?').run(req.user.id);
    const ins = db.prepare('INSERT INTO admin_recovery_codes (user_id, code_hash) VALUES (?, ?)');
    for (const c of codes) ins.run(req.user.id, hashRecoveryCode(c));
  })();
  setAdminCookie(res, req.user, { mfa: true });
  audit(req, 'admin.mfa_enabled', 'user', req.user.id);
  res.set('Cache-Control', 'no-store').json({ recoveryCodes: codes }); // แสดงครั้งเดียว — เก็บไว้เฉพาะแฮช
}

// ---- ล้าง 2FA ของผู้ใช้ (แอดมินทำให้คนอื่นเมื่อทำโทรศัพท์หาย / สคริปต์ CLI) — เพิกถอนทุกเซสชันของคนนั้นด้วย ----
export function resetMfa(userId) {
  db.transaction(() => {
    db.prepare('UPDATE users SET totp_secret_enc = NULL, totp_enabled = 0, totp_last_step = 0 WHERE id = ?').run(userId);
    db.prepare('DELETE FROM admin_recovery_codes WHERE user_id = ?').run(userId);
  })();
  revokeSessions(userId);
}
