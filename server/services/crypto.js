import crypto from 'node:crypto';
import { config } from '../config.js';

// คีย์ 32 ไบต์ derive จาก KEY_ENCRYPTION_SECRET (ห้ามเปลี่ยนค่านี้ภายหลัง ไม่งั้นถอดรหัสโค้ดเดิมไม่ได้)
const KEY = crypto.scryptSync(config.keySecret, 'geme-store-game-keys-v1', 32);
const HMAC_KEY = crypto.scryptSync(config.keySecret, 'geme-store-game-keys-hmac-v1', 32);

// AES-256-GCM  รูปแบบ: v1:<iv>:<authTag>:<ciphertext>  (base64url)
export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join(':');
}

export function decrypt(blob) {
  const [v, iv, tag, ct] = String(blob).split(':');
  if (v !== 'v1') throw new Error('unsupported ciphertext version');
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}

// แฮชแบบมีกุญแจ ใช้กันโค้ดซ้ำ (UNIQUE) โดยไม่ต้องเก็บ plaintext
export const keyHash = (code) => crypto.createHmac('sha256', HMAC_KEY).update(String(code).trim()).digest('hex');

// ปิดบังโค้ดบางส่วนสำหรับ log: ABCD-EFGH-IJKL → ****-****-IJKL (เหลือแค่ 4 ตัวท้าย)
export const maskKey = (code) => String(code).replace(/[A-Za-z0-9](?=.{4})/g, '*');
