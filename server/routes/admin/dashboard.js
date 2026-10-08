import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { staffOrAdmin } from '../../middleware/adminAuth.js';
import { audit } from '../../services/audit.js';
import { HttpError } from '../../services/errors.js';
import { BKK_DATE, dateStr } from './util.js';

export const dashboardRouter = Router();

// ยอดขาย = ผลรวม total ของออเดอร์สถานะ paid (หน่วยสตางค์) ตามวันที่ชำระ (เวลาไทย UTC+7); ออเดอร์ที่คืนเงินแล้วไม่นับเป็นยอดขาย
const TODAY = "date('now', '+7 hours')";

export function lowStockGames() {
  return db.prepare(`SELECT g.id, g.title, g.low_stock_threshold AS threshold,
      (SELECT COUNT(*) FROM game_keys k WHERE k.game_id = g.id AND k.status = 'available') AS available
    FROM games g WHERE g.active = 1
      AND (SELECT COUNT(*) FROM game_keys k WHERE k.game_id = g.id AND k.status = 'available') < g.low_stock_threshold
    ORDER BY available, g.title`).all();
}

dashboardRouter.get('/', (_req, res) => {
  const rev = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN d = ${TODAY} THEN total END), 0) AS todayRevenue,
      COUNT(CASE WHEN d = ${TODAY} THEN 1 END) AS todayOrders,
      COALESCE(SUM(CASE WHEN d >= date('now', '+7 hours', '-6 days') THEN total END), 0) AS weekRevenue,
      COUNT(CASE WHEN d >= date('now', '+7 hours', '-6 days') THEN 1 END) AS weekOrders,
      COALESCE(SUM(CASE WHEN substr(d, 1, 7) = strftime('%Y-%m', 'now', '+7 hours') THEN total END), 0) AS monthRevenue,
      COUNT(CASE WHEN substr(d, 1, 7) = strftime('%Y-%m', 'now', '+7 hours') THEN 1 END) AS monthOrders
    FROM (SELECT total, ${BKK_DATE('paid_at')} AS d FROM orders WHERE status = 'paid')`).get();

  const byStatus = Object.fromEntries(['pending', 'paid', 'cancelled', 'refunded'].map((s) => [s, 0]));
  for (const r of db.prepare('SELECT status, COUNT(*) AS n FROM orders GROUP BY status').all()) byStatus[r.status] = r.n;

  const newUsers = db.prepare(`SELECT
      COUNT(CASE WHEN d = ${TODAY} THEN 1 END) AS today,
      COUNT(CASE WHEN d >= date('now', '+7 hours', '-6 days') THEN 1 END) AS week,
      COUNT(CASE WHEN d >= date('now', '+7 hours', '-29 days') THEN 1 END) AS month
    FROM (SELECT ${BKK_DATE('created_at')} AS d FROM users WHERE role = 'user')`).get();

  const keys = Object.fromEntries(['available', 'reserved', 'sold', 'revoked'].map((s) => [s, 0]));
  for (const r of db.prepare('SELECT status, COUNT(*) AS n FROM game_keys GROUP BY status').all()) keys[r.status] = r.n;

  const topGames = db.prepare(`SELECT oi.game_id AS gameId, oi.title, COUNT(*) AS units, SUM(oi.unit_price) AS revenue
    FROM order_items oi JOIN orders o ON o.id = oi.order_id AND o.status = 'paid'
    GROUP BY oi.game_id ORDER BY revenue DESC, units DESC LIMIT 10`).all();
  const topGenres = db.prepare(`SELECT g.genre, COUNT(*) AS units, SUM(oi.unit_price) AS revenue
    FROM order_items oi JOIN orders o ON o.id = oi.order_id AND o.status = 'paid' JOIN games g ON g.id = oi.game_id
    GROUP BY g.genre ORDER BY revenue DESC LIMIT 10`).all();

  const paid = byStatus.paid;
  const withCoupon = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'paid' AND coupon_code IS NOT NULL").get().n;
  const coupons = {
    paidOrders: paid, ordersWithCoupon: withCoupon, usageRate: paid ? withCoupon / paid : 0,
    top: db.prepare(`SELECT coupon_code AS code, COUNT(*) AS uses, SUM(coupon_discount) AS discount FROM orders
      WHERE status = 'paid' AND coupon_code IS NOT NULL GROUP BY coupon_code ORDER BY uses DESC LIMIT 5`).all(),
  };

  const alerts = {
    open: db.prepare('SELECT id, kind, order_id AS orderId, detail, created_at AS createdAt FROM admin_alerts WHERE resolved = 0 ORDER BY id DESC LIMIT 50').all(),
    lowStock: lowStockGames(),
  };
  res.json({ summary: { ...rev, byStatus, newUsers, keys }, topGames, topGenres, coupons, alerts });
});

// ยอดขายตามช่วงวันที่ (เวลาไทย) แบบรายวัน/รายเดือน — เติมวัน/เดือนที่ไม่มียอดให้เป็น 0 (ใช้ร่วมกับรายงาน CSV)
export function salesSeries(input) {
  const q = z.object({ from: dateStr.optional(), to: dateStr.optional(), group: z.enum(['day', 'month']).default('day') }).parse(input);
  const to = q.to ?? db.prepare(`SELECT ${TODAY} AS d`).get().d;
  const from = q.from ?? db.prepare('SELECT date(?, ?) AS d').get(to, q.group === 'day' ? '-29 days' : '-11 months').d;
  if (from > to) throw new HttpError(400, 'วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด', 'BAD_RANGE');
  if (db.prepare('SELECT julianday(?) - julianday(?) AS n').get(to, from).n > 1100) throw new HttpError(400, 'เลือกช่วงวันที่ได้ไม่เกิน 3 ปี', 'BAD_RANGE');

  const fmt = q.group === 'day' ? (c) => BKK_DATE(c) : (c) => `substr(${BKK_DATE(c)}, 1, 7)`;
  const sales = new Map(db.prepare(`SELECT ${fmt('paid_at')} AS p, COUNT(*) AS orders, SUM(total) AS revenue FROM orders
    WHERE status = 'paid' AND ${BKK_DATE('paid_at')} BETWEEN ? AND ? GROUP BY p`).all(from, to).map((r) => [r.p, r]));
  const refunds = new Map(db.prepare(`SELECT ${fmt('refunded_at')} AS p, COUNT(*) AS orders, SUM(total) AS amount FROM orders
    WHERE status = 'refunded' AND ${BKK_DATE('refunded_at')} BETWEEN ? AND ? GROUP BY p`).all(from, to).map((r) => [r.p, r]));

  const periods = db.prepare(`WITH RECURSIVE d(day) AS (SELECT ? UNION ALL SELECT date(day, '+1 day') FROM d WHERE day < ?)
    SELECT DISTINCT ${q.group === 'day' ? 'day' : 'substr(day, 1, 7)'} AS p FROM d ORDER BY p`).all(from, to).map((r) => r.p);
  return {
    from, to, group: q.group,
    rows: periods.map((p) => ({
      period: p, orders: sales.get(p)?.orders ?? 0, revenue: sales.get(p)?.revenue ?? 0,
      refundedOrders: refunds.get(p)?.orders ?? 0, refunded: refunds.get(p)?.amount ?? 0,
    })),
  };
}

dashboardRouter.get('/sales', (req, res) => res.json(salesSeries(req.query)));

// ปิดแจ้งเตือน (staff ทำได้)
dashboardRouter.post('/alerts/:id/resolve', staffOrAdmin, (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const r = db.prepare('UPDATE admin_alerts SET resolved = 1 WHERE id = ? AND resolved = 0').run(id);
  if (!r.changes) return res.status(404).json({ error: 'ไม่พบแจ้งเตือน หรือถูกปิดไปแล้ว' });
  audit(req, 'alert.resolve', 'alert', id);
  res.json({ ok: true });
});
