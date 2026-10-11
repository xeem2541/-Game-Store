import crypto from 'node:crypto';

// TOTP (RFC 6238 / RFC 4226): HMAC-SHA1, รหัส 6 หลัก, ช่วงละ 30 วินาที — ใช้ได้กับ Google Authenticator / 1Password / Authy ฯลฯ
const STEP_SECONDS = 30;
const DIGITS = 6;
const WINDOW = 1; // ยอมรับช่วงก่อน/หลัง 1 ช่วง (นาฬิกาโทรศัพท์คลาดเล็กน้อย)
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error('invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const newTotpSecret = () => base32Encode(crypto.randomBytes(20)); // 160 bit ตามที่ RFC แนะนำ
export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

export function totpCode(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = h[h.length - 1] & 0xf;
  const bin = h.readUInt32BE(offset) & 0x7fffffff;
  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}

// คืนหมายเลขช่วงเวลาที่รหัสตรง หรือ null — ต้องมากกว่า lastStep (รหัสที่เคยใช้แล้วใช้ซ้ำไม่ได้ กันดักจับรหัสไปใช้ต่อ)
export function verifyTotp(secret, code, { lastStep = 0, now = Date.now() } = {}) {
  const c = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const cur = currentStep(now);
  for (let step = cur - WINDOW; step <= cur + WINDOW; step += 1) {
    if (step <= lastStep) continue;
    const expected = totpCode(secret, step);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(c))) return step;
  }
  return null;
}

export const otpauthUrl = ({ issuer, account, secret }) =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;

// รหัสกู้คืน: ใช้ได้ครั้งละหนึ่งรหัส เก็บเฉพาะแฮช (สุ่ม 50 บิต จึงใช้ SHA-256 ได้ ไม่ต้องใช้ bcrypt)
export const normalizeRecoveryCode = (code) => String(code ?? '').toUpperCase().replace(/[^A-Z2-7]/g, '');
export const hashRecoveryCode = (code) => crypto.createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
export function newRecoveryCodes(n = 8) {
  return Array.from({ length: n }, () => {
    const s = base32Encode(crypto.randomBytes(7)).slice(0, 10);
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}
