import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { requirePerm } from '../../middleware/adminAuth.js';
import { audit } from '../../services/audit.js';
import { baht, sendCsv } from '../../services/csv.js';
import { salesSeries } from './dashboard.js';
import { orderFilter } from './orders.js';
import { BKK_DATE, dateStr } from './util.js';

// ส่งออก CSV (UTF-8 + BOM, ป้องกัน formula injection) — เลือกช่วงวันที่ด้วย ?from=YYYY-MM-DD&to=YYYY-MM-DD
// ตัวเลขเงินเป็น "บาท" ทศนิยม 2 ตำแหน่ง ไม่มีโค้ดเกมจริงในรายงานใดเลย
export const reportsRouter = Router();

const stamp = () => new Date().toISOString().slice(0, 10);
const done = (req, name, rows) => audit(req, 'report.export', 'report', name, { rows });

reportsRouter.get('/orders.csv', (req, res) => {
  const { where, args } = orderFilter(req.query);
  const rows = db.prepare(`SELECT o.id, o.created_at, o.paid_at, o.status, u.email, u.name, o.subtotal, o.game_discount, o.coupon_code, o.coupon_discount, o.total,
      (SELECT p.provider FROM payments p WHERE p.order_id = o.id ORDER BY p.id DESC LIMIT 1) AS provider,
      (SELECT number FROM invoices i WHERE i.order_id = o.id) AS invoice,
      (SELECT group_concat(title, ' | ') FROM order_items oi WHERE oi.order_id = o.id) AS items
    FROM orders o JOIN users u ON u.id = o.user_id WHERE ${where} ORDER BY o.id`).all(...args);
  done(req, 'orders', rows.length);
  sendCsv(res, `orders-${stamp()}.csv`,
    ['order_id', 'created_at_utc', 'paid_at_utc', 'status', 'email', 'name', 'items', 'list_price_thb', 'game_discount_thb', 'coupon', 'coupon_discount_thb', 'total_thb', 'payment_provider', 'invoice_no'],
    rows.map((r) => [r.id, r.created_at, r.paid_at, r.status, r.email, r.name, r.items, baht(r.subtotal), baht(r.game_discount), r.coupon_code, baht(r.coupon_discount), baht(r.total), r.provider, r.invoice]));
});

reportsRouter.get('/sales.csv', (req, res) => {
  const s = salesSeries(req.query);
  done(req, 'sales', s.rows.length);
  sendCsv(res, `sales-${s.group}-${s.from}_${s.to}.csv`, [s.group === 'day' ? 'date' : 'month', 'paid_orders', 'revenue_thb', 'refunded_orders', 'refunded_thb'],
    s.rows.map((r) => [r.period, r.orders, baht(r.revenue), r.refundedOrders, baht(r.refunded)]));
});

reportsRouter.get('/games-sales.csv', (req, res) => {
  const q = z.object({ from: dateStr.optional(), to: dateStr.optional() }).parse(req.query);
  const w = [`o.status = 'paid'`];
  const args = [];
  if (q.from) { w.push(`${BKK_DATE('o.paid_at')} >= ?`); args.push(q.from); }
  if (q.to) { w.push(`${BKK_DATE('o.paid_at')} <= ?`); args.push(q.to); }
  const rows = db.prepare(`SELECT oi.game_id, oi.title, COUNT(*) AS units, SUM(oi.list_price) AS list_total, SUM(oi.unit_price) AS revenue
    FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE ${w.join(' AND ')} GROUP BY oi.game_id ORDER BY revenue DESC`).all(...args);
  done(req, 'games-sales', rows.length);
  sendCsv(res, `games-sales-${stamp()}.csv`, ['game_id', 'game', 'units_sold', 'list_price_total_thb', 'revenue_before_coupon_thb'],
    rows.map((r) => [r.game_id, r.title, r.units, baht(r.list_total), baht(r.revenue)]));
});

// มีข้อมูลส่วนบุคคล (อีเมล) → admin เท่านั้น
reportsRouter.get('/new-users.csv', requirePerm('reports.users'), (req, res) => {
  const q = z.object({ from: dateStr.optional(), to: dateStr.optional() }).parse(req.query);
  const w = ["role = 'user'"];
  const args = [];
  if (q.from) { w.push(`${BKK_DATE('created_at')} >= ?`); args.push(q.from); }
  if (q.to) { w.push(`${BKK_DATE('created_at')} <= ?`); args.push(q.to); }
  const rows = db.prepare(`SELECT id, email, name, email_verified, status, created_at FROM users WHERE ${w.join(' AND ')} ORDER BY id`).all(...args);
  done(req, 'new-users', rows.length);
  sendCsv(res, `new-users-${stamp()}.csv`, ['user_id', 'email', 'name', 'email_verified', 'status', 'created_at_utc'],
    rows.map((r) => [r.id, r.email, r.name, r.email_verified ? 'yes' : 'no', r.status, r.created_at]));
});

// สต็อก: เฉพาะจำนวน ไม่มีตัวโค้ด
reportsRouter.get('/stock.csv', (req, res) => {
  const rows = db.prepare(`SELECT g.id, g.title, g.active, g.low_stock_threshold AS threshold,
      COALESCE(SUM(k.status = 'available'), 0) AS available, COALESCE(SUM(k.status = 'reserved'), 0) AS reserved,
      COALESCE(SUM(k.status = 'sold'), 0) AS sold, COALESCE(SUM(k.status = 'revoked'), 0) AS revoked
    FROM games g LEFT JOIN game_keys k ON k.game_id = g.id GROUP BY g.id ORDER BY g.title`).all();
  done(req, 'stock', rows.length);
  sendCsv(res, `stock-${stamp()}.csv`, ['game_id', 'game', 'active', 'low_stock_threshold', 'available', 'reserved', 'sold', 'revoked'],
    rows.map((r) => [r.id, r.title, r.active ? 'yes' : 'no', r.threshold, r.available, r.reserved, r.sold, r.revoked]));
});
