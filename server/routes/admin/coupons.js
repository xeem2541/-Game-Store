import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { audit } from '../../services/audit.js';
import { HttpError } from '../../services/errors.js';
import { idParam } from './util.js';

// admin เท่านั้น (กำหนดที่ index.js)  เงินทั้งหมดเป็นสตางค์
export const couponsAdminRouter = Router();

const base = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,30}$/, 'โค้ดใช้ A-Z 0-9 _ - ยาว 3-30 ตัว'),
  description: z.string().trim().max(200).default(''),
  type: z.enum(['percent', 'fixed']),
  value: z.number().int().positive(),
  min_subtotal: z.number().int().min(0).max(100_000_000).default(0),
  expires_at: z.string().datetime({ offset: true }).nullable().default(null), // ISO 8601
  max_uses: z.number().int().positive().nullable().default(null),
  max_per_user: z.number().int().positive().nullable().default(null),
  active: z.boolean().default(true),
});
const checkValue = (c) => {
  if (c.type === 'percent' && (c.value < 1 || c.value > 100)) throw new HttpError(400, 'ส่วนลดแบบเปอร์เซ็นต์ต้องอยู่ระหว่าง 1-100', 'BAD_COUPON_VALUE');
  if (c.type === 'fixed' && c.value > 100_000_000) throw new HttpError(400, 'ส่วนลดจำนวนเงินสูงเกินไป', 'BAD_COUPON_VALUE');
};
const toRow = (c) => ({ ...c, expires_at: c.expires_at ? new Date(c.expires_at).getTime() : null, active: c.active ? 1 : 0 });
const view = (r) => ({
  id: r.id, code: r.code, description: r.description, type: r.type, value: r.value, minSubtotal: r.min_subtotal,
  expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null, maxUses: r.max_uses, maxPerUser: r.max_per_user, active: !!r.active,
  expired: r.expires_at !== null && r.expires_at < Date.now(), usedCount: r.used_count ?? 0, paidCount: r.paid_count ?? 0,
});

const SELECT = `SELECT c.*, (SELECT COUNT(*) FROM coupon_usages u WHERE u.coupon_id = c.id) AS used_count,
  (SELECT COUNT(*) FROM orders o WHERE o.coupon_id = c.id AND o.status = 'paid') AS paid_count FROM coupons c`;

// usedCount = จำนวนครั้งที่ถูกใช้อยู่ (ออเดอร์ที่ยกเลิก/คืนเงินจะคืนสิทธิ์) ; paidCount = ออเดอร์ที่ชำระแล้วด้วยคูปองนี้
couponsAdminRouter.get('/', (_req, res) => res.json({ items: db.prepare(`${SELECT} ORDER BY c.id DESC`).all().map(view) }));

couponsAdminRouter.post('/', (req, res) => {
  const c = base.parse(req.body);
  checkValue(c);
  if (db.prepare('SELECT 1 FROM coupons WHERE code = ?').get(c.code)) throw new HttpError(409, 'โค้ดนี้ถูกใช้แล้ว', 'COUPON_CODE_TAKEN');
  const row = toRow(c);
  const { lastInsertRowid } = db.prepare(`INSERT INTO coupons (code, description, type, value, min_subtotal, expires_at, max_uses, max_per_user, active)
    VALUES (@code, @description, @type, @value, @min_subtotal, @expires_at, @max_uses, @max_per_user, @active)`).run(row);
  audit(req, 'coupon.create', 'coupon', lastInsertRowid, { after: row });
  res.status(201).json({ id: lastInsertRowid });
});

couponsAdminRouter.put('/:id', (req, res) => {
  const id = idParam.parse(req.params.id);
  const before = db.prepare('SELECT * FROM coupons WHERE id = ?').get(id);
  if (!before) throw new HttpError(404, 'ไม่พบคูปอง', 'COUPON_NOT_FOUND');
  const merged = base.parse({
    ...view(before), code: before.code, min_subtotal: before.min_subtotal, expires_at: before.expires_at ? new Date(before.expires_at).toISOString() : null,
    max_uses: before.max_uses, max_per_user: before.max_per_user, ...Object.fromEntries(Object.entries(req.body).filter(([k]) => k in base.shape)),
  });
  checkValue(merged);
  if (merged.code !== before.code && db.prepare('SELECT 1 FROM coupons WHERE code = ? AND id != ?').get(merged.code, id)) {
    throw new HttpError(409, 'โค้ดนี้ถูกใช้แล้ว', 'COUPON_CODE_TAKEN');
  }
  const row = toRow(merged);
  const changed = Object.keys(row).filter((k) => String(row[k]) !== String(before[k]));
  db.prepare(`UPDATE coupons SET code = @code, description = @description, type = @type, value = @value, min_subtotal = @min_subtotal,
    expires_at = @expires_at, max_uses = @max_uses, max_per_user = @max_per_user, active = @active WHERE id = @id`).run({ ...row, id });
  if (changed.length) {
    audit(req, 'coupon.update', 'coupon', id, {
      before: Object.fromEntries(changed.map((k) => [k, before[k]])), after: Object.fromEntries(changed.map((k) => [k, row[k]])),
    });
  }
  res.json({ ok: true, changed });
});
