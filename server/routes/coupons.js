import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { HttpError } from '../services/errors.js';
import { buildSummary } from '../services/orders.js';

export const couponsRouter = Router();

// ตรวจโค้ดกับตะกร้าของผู้ใช้ที่ล็อกอิน (เงื่อนไขต่อผู้ใช้/ยอดขั้นต่ำต้องรู้ตัวผู้ใช้และตะกร้า)
couponsRouter.post('/validate', requireAuth, (req, res) => {
  const { code } = z.object({ code: z.string().trim().min(1).max(40) }).parse(req.body);
  const summary = buildSummary(req.user.id, code);
  if (summary.couponError) {
    const e = summary.couponError;
    throw new HttpError(422, e.message, e.code, e.params);
  }
  res.json({ valid: true, summary });
});
