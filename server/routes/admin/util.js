import multer from 'multer';
import { z } from 'zod';
import { MAX_IMAGE_BYTES } from '../../services/images.js';

export const idParam = z.coerce.number().int().positive();

// ?page=&limit= (limit สูงสุด 100)
export function paging(query, defaultLimit = 20) {
  const page = z.coerce.number().int().min(1).catch(1).parse(query.page);
  const limit = z.coerce.number().int().min(1).max(100).catch(defaultLimit).parse(query.limit);
  return { page, limit, offset: (page - 1) * limit };
}
export const pageInfo = (total, page, limit) => ({ total, page, pages: Math.max(1, Math.ceil(total / limit)), limit });

export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ต้องเป็นรูปแบบ YYYY-MM-DD');
export const dateRange = z.object({ from: dateStr.optional(), to: dateStr.optional() });

export { likeArg } from '../../services/text.js';

// วันที่ในคอลัมน์ TIMESTAMP (UTC) แปลงเป็นเวลาไทยก่อนเทียบ/จัดกลุ่ม
export const BKK_DATE = (col) => `date(${col}, '+7 hours')`;

const memory = multer.memoryStorage();
export const uploadImage = multer({ storage: memory, limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 5 } }).single('file');
export const uploadCsv = multer({ storage: memory, limits: { fileSize: 1024 * 1024, files: 1, fields: 5 } }).single('file');
