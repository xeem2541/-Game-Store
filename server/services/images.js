import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { config } from '../config.js';
import { HttpError } from './errors.js';

// รูปที่แอดมินอัปโหลดอยู่ที่ data/uploads/games (นอก public/ จึงไม่ถูกเสิร์ฟเป็นไฟล์สถิตทั่วไป และรันสคริปต์ไม่ได้)
// เสิร์ฟผ่าน route เฉพาะที่รับแค่ชื่อไฟล์รูปแบบ <32 hex>.webp เท่านั้น
export const UPLOAD_DIR = path.resolve(path.dirname(config.dbPath === ':memory:' ? './data/store.db' : config.dbPath), 'uploads', 'games');
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // 3 MB
export const FILE_NAME_RE = /^[a-f0-9]{32}(-sm)?\.webp$/; // -sm = ภาพย่อ 400x300 ของรูปปก

// ตรวจชนิดไฟล์จาก "เนื้อไฟล์จริง" (magic bytes) ไม่ดูนามสกุลหรือ Content-Type ที่ผู้ใช้ส่งมา — รับเฉพาะ jpg / png / webp
export function sniffImage(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

// ตรวจ → decode ด้วย sharp (ไฟล์เสียจะ throw) → ย่อขนาด → เข้ารหัสใหม่เป็น WebP (ทิ้ง metadata/ส่วนที่ซ่อนมาในไฟล์ทั้งหมด) → ชื่อสุ่ม
export async function saveGameImage(buffer, kind) {
  if (!sniffImage(buffer)) throw new HttpError(400, 'ไฟล์ต้องเป็นรูป JPG, PNG หรือ WebP เท่านั้น', 'BAD_IMAGE_TYPE');
  const size = kind === 'cover' ? { width: 800, height: 600, fit: 'cover' } : { width: 1280, height: 720, fit: 'inside', withoutEnlargement: true };
  let out;
  try {
    out = await sharp(buffer, { limitInputPixels: 40_000_000 }).rotate().resize(size).webp({ quality: 82 }).toBuffer();
  } catch {
    throw new HttpError(400, 'ไฟล์รูปเสียหรืออ่านไม่ได้', 'BAD_IMAGE_FILE');
  }
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const stem = crypto.randomBytes(16).toString('hex');
  const filename = `${stem}.webp`;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), out, { mode: 0o644 });
  if (kind === 'cover') { // ภาพย่อสำหรับการ์ดในหน้ารายการ (โหลดเร็วกว่า)
    const thumb = await sharp(out).resize(400, 300, { fit: 'cover' }).webp({ quality: 78 }).toBuffer();
    fs.writeFileSync(path.join(UPLOAD_DIR, `${stem}-sm.webp`), thumb, { mode: 0o644 });
  }
  return filename;
}

export function deleteGameImage(filename) {
  if (!FILE_NAME_RE.test(filename ?? '')) return;
  fs.rm(path.join(UPLOAD_DIR, filename), { force: true }, () => {});
  fs.rm(path.join(UPLOAD_DIR, filename.replace('.webp', '-sm.webp')), { force: true }, () => {}); // ภาพย่อ (ถ้ามี)
}
