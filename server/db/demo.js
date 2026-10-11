// npm run seed:demo — ข้อมูลตัวอย่างสมจริงสำหรับดูหน้าตา/ทดสอบด้วยตา (Dashboard กราฟยอดขาย, รีวิว, คะแนน, bento, ฉาก 3D)
// ลูกค้าสมมติ ~48 คน + คำสั่งซื้อย้อนหลัง 120 วัน (ชำระแล้ว/ยกเลิก/คืนเงิน บางรายการใช้คูปอง) + รีวิว + รายการโปรด
// - สร้างผ่านโค้ดจริงของร้าน (createOrder → devPay / transition) ข้อมูลจึงสอดคล้องกันทุกตาราง: โค้ดเกมถูกขาย/เพิกถอน, ใบเสร็จ, ประวัติสถานะ
//   แล้วจึงย้อนเวลาของแต่ละออเดอร์ไปยังวันที่สุ่ม
// - ผลลัพธ์เหมือนเดิมทุกครั้ง (สุ่มด้วย seed คงที่) — รันซ้ำไม่ได้ ถ้ามีลูกค้าสมมติอยู่แล้วจะหยุด
// - ปฏิเสธเมื่อ NODE_ENV=production (เหมือน npm run seed) และไม่ส่งอีเมลใด ๆ (ลบคิวอีเมลของออเดอร์สมมติทิ้ง)
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { db } from './index.js';
import { demoAllowed, seedCoupons, seedGames, seedKeys } from './seed.js';
import { createOrder, transition } from '../services/orders.js';
import { devPay } from '../services/payments.js';
import { hashPassword } from '../services/passwords.js';

export const DEMO_DOMAIN = 'demo.gamestore.test'; // โดเมนสงวนสำหรับทดสอบ (.test) — ไม่มีวันเป็นอีเมลจริง
const DAY = 86_400_000;
const DAYS_BACK = 120;

// สุ่มแบบกำหนด seed (mulberry32) — รันกี่ครั้งก็ได้ข้อมูลชุดเดียวกัน
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261011);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;
const sqlTime = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

const FIRST = ['สมชาย', 'สมหญิง', 'ณัฐพล', 'กนกวรรณ', 'ธนกร', 'พิมพ์ชนก', 'วีรภัทร', 'ศิริพร', 'อนุชา', 'ปวีณา', 'กิตติพงษ์', 'สุดารัตน์',
  'ภูมิพัฒน์', 'ชนิดา', 'ธีรเดช', 'อรอุมา', 'Nattapong', 'Pim', 'Tanawat', 'Mint', 'Krit', 'Ploy', 'Arthit', 'Fah'];
const LAST = ['ใจดี', 'รักษ์ไทย', 'ศรีสุข', 'บุญมา', 'วงศ์ทอง', 'แสงจันทร์', 'ทองคำ', 'พรหมมา', 'S.', 'K.', 'T.', 'W.'];

// รีวิวตามคะแนน (ไทยเป็นส่วนใหญ่ ปนอังกฤษบ้างเหมือนร้านจริง)
const REVIEWS = {
  5: ['สนุกมาก เล่นยาวได้หลายชั่วโมง คุ้มทุกบาท', 'ภาพสวย เนื้อเรื่องดี แนะนำเลยครับ', 'ได้โค้ดทันทีหลังจ่าย เปิดใช้ได้เลย ประทับใจ', 'Absolutely loved it. Worth every baht.',
    'เล่นกับเพื่อนสนุกสุด ๆ', 'ซื้อช่วงลดราคา คุ้มมาก', 'เพลงประกอบเพราะ บรรยากาศดีมาก', 'เกมที่ดีที่สุดที่เล่นปีนี้', 'Great story and the controls feel perfect.',
    'ระบบเล่นลื่นไหล ไม่มีกระตุกเลย', 'ลูกชายชอบมาก เล่นทุกวัน', 'ภาษาไทยครบ เล่นเข้าใจง่าย', ''],
  4: ['สนุกดี มีบั๊กเล็กน้อยแต่ไม่กวนใจ', 'ราคาช่วงลดคุ้มมาก', 'Solid game, a bit short but fun.', 'กราฟิกดี ระบบเล่นง่าย', 'อยากให้มีโหมดออนไลน์มากกว่านี้',
    'เนื้อเรื่องดี แต่ตอนจบเร็วไปนิด', 'Fun with friends, solo gets repetitive.', 'โหลดนานนิดหน่อย นอกนั้นดี', ''],
  3: ['เล่นได้เรื่อย ๆ ไม่ได้ว้าวมาก', 'ช่วงแรกสนุก หลัง ๆ เริ่มซ้ำ', 'Decent, wait for a sale.', 'พอใช้ได้ แต่คาดหวังมากกว่านี้', ''],
  2: ['ต้องใช้สเปกเครื่องสูงกว่าที่บอก', 'เนื้อหาน้อยไปหน่อยสำหรับราคานี้', 'Too short for the price.'],
  1: ['เกมไม่ใช่แนวผมเลย', 'เล่นแล้วเวียนหัว ไม่ถนัด'],
};
// คะแนนรีวิวเอียงตามคะแนนตั้งต้นของเกม (เกม 4.8 ส่วนใหญ่ได้ 5 ดาว)
const reviewRating = (base) => {
  const r = base + (rand() - 0.5) * 2.2;
  return Math.max(1, Math.min(5, Math.round(r)));
};

export async function seedDemo({ now = Date.now(), log = console.log } = {}) {
  if (db.prepare('SELECT 1 FROM users WHERE email LIKE ?').get(`%@${DEMO_DOMAIN}`)) {
    log(`มีข้อมูลตัวอย่างอยู่แล้ว (ลูกค้า @${DEMO_DOMAIN}) — ไม่สร้างซ้ำ`);
    return null;
  }
  if (!db.prepare('SELECT 1 FROM games LIMIT 1').get()) seedGames();
  if (!db.prepare('SELECT 1 FROM coupons LIMIT 1').get()) seedCoupons();
  seedKeys(80); // โค้ดปลอมพอสำหรับคำสั่งซื้อย้อนหลังทั้งหมด

  const games = db.prepare('SELECT id, slug, rating, sales, price FROM games WHERE active = 1').all();
  const weightTotal = games.reduce((s, g) => s + g.sales, 0);
  const popularGame = () => { // เกมขายดีถูกซื้อบ่อยกว่า (ตามยอดขายตั้งต้น)
    let r = rand() * weightTotal;
    for (const g of games) { r -= g.sales; if (r <= 0) return g; }
    return games.at(-1);
  };

  // ลูกค้า: รหัสผ่านสุ่ม (ไม่มีใครล็อกอินบัญชีเหล่านี้ได้) ยืนยันอีเมลแล้ว สมัครกระจายย้อนหลัง 180 วัน
  const hash = await hashPassword(crypto.randomBytes(24).toString('hex'));
  const insUser = db.prepare("INSERT INTO users (email, name, password_hash, role, email_verified, created_at) VALUES (?, ?, ?, 'user', 1, ?)");
  const users = Array.from({ length: 48 }, (_, i) => {
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    const joined = now - (DAYS_BACK + 60) * DAY * rand();
    const id = Number(insUser.run(`customer${String(i + 1).padStart(2, '0')}@${DEMO_DOMAIN}`, name, hash, sqlTime(joined)).lastInsertRowid);
    return { id, joined, email_verified: 1 };
  });

  const counts = { paid: 0, cancelled: 0, refunded: 0, reviews: 0 };
  const addCart = db.prepare('INSERT OR IGNORE INTO cart_items (user_id, game_id) VALUES (?, ?)');
  const clearCart = db.prepare('DELETE FROM cart_items WHERE user_id = ?');
  const owned = new Map(users.map((u) => [u.id, new Set()]));
  const paidItems = [];

  // ย้อนเวลาทุกตารางที่เกี่ยวกับออเดอร์ไปที่เวลา t (สถานะถัดไปห่างกันไม่กี่นาที)
  const backdate = (orderId, t, status) => {
    const created = sqlTime(t);
    const later = sqlTime(t + (2 + rand() * 20) * 60_000);
    db.prepare(`UPDATE orders SET created_at = ?, expires_at = ?, paid_at = CASE WHEN paid_at IS NULL THEN NULL ELSE ? END,
      cancelled_at = CASE WHEN cancelled_at IS NULL THEN NULL ELSE ? END,
      refunded_at = CASE WHEN refunded_at IS NULL THEN NULL ELSE ? END WHERE id = ?`)
      .run(created, t + 30 * 60_000, later, later, status === 'refunded' ? sqlTime(t + (1 + rand() * 3) * DAY) : later, orderId);
    db.prepare("UPDATE order_events SET created_at = CASE WHEN from_status IS NULL THEN ? ELSE ? END WHERE order_id = ?").run(created, later, orderId);
    db.prepare("UPDATE order_events SET created_at = (SELECT refunded_at FROM orders WHERE id = ?) WHERE order_id = ? AND to_status = 'refunded'").run(orderId, orderId);
    db.prepare('UPDATE refunds SET created_at = (SELECT refunded_at FROM orders WHERE id = ?) WHERE order_id = ?').run(orderId, orderId);
    db.prepare('UPDATE payments SET created_at = ?, updated_at = ? WHERE order_id = ?').run(later, later, orderId);
    db.prepare('UPDATE invoices SET issued_at = ? WHERE order_id = ?').run(later, orderId);
    db.prepare('UPDATE coupon_usages SET used_at = ? WHERE order_id = ?').run(created, orderId);
    db.prepare('UPDATE game_keys SET sold_at = ? WHERE sold_at IS NOT NULL AND order_item_id IN (SELECT id FROM order_items WHERE order_id = ?)').run(later, orderId);
  };

  db.transaction(() => {
    for (let d = DAYS_BACK; d >= 0; d -= 1) {
      const dayStart = now - d * DAY;
      const weekend = [0, 6].includes(new Date(dayStart + 7 * 3600_000).getUTCDay());
      const trend = 1 + (DAYS_BACK - d) / DAYS_BACK; // ร้านโตขึ้นเรื่อย ๆ
      const n = Math.floor(rand() * 3 * trend + (weekend ? 2 : 0.5));
      for (let k = 0; k < n; k += 1) {
        const t = d === 0 ? now - rand() * 6 * 3600_000 : dayStart - rand() * DAY; // วันนี้: ไม่เกินเวลาปัจจุบัน
        const user = pick(users.filter((u) => u.joined < t)) ?? pick(users);
        const mine = owned.get(user.id);
        const items = new Set();
        const size = chance(0.7) ? 1 : chance(0.7) ? 2 : 3;
        for (let tries = 0; items.size < size && tries < 10; tries += 1) {
          const g = popularGame();
          if (!mine.has(g.id)) items.add(g.id);
        }
        if (!items.size) continue;
        clearCart.run(user.id);
        for (const id of items) addCart.run(user.id, id);
        const coupon = chance(0.18) ? pick(['SAVE100', 'WELCOME10']) : undefined;
        let order;
        try {
          order = createOrder(user, { couponCode: coupon, idempotencyKey: `demo-${crypto.randomUUID()}` }).order;
        } catch {
          order = createOrder(user, { idempotencyKey: `demo-${crypto.randomUUID()}` }).order; // คูปองใช้ไม่ได้ (ยอดไม่ถึง/ใช้แล้ว) → สั่งแบบไม่ใช้
        }
        const roll = rand();
        let status = 'paid';
        if (order.status === 'paid') status = 'paid'; // เกมฟรี จ่ายอัตโนมัติ
        else if (roll < 0.1) { transition(order.id, 'cancelled', { reason: pick(['ลูกค้ายกเลิก', 'หมดเวลาชำระเงิน']) }); status = 'cancelled'; }
        else {
          devPay(order.id);
          if (roll > 0.97) {
            transition(order.id, 'refunded', { reason: 'ลูกค้าขอคืนเงิน (ยังไม่ได้เปิดใช้โค้ด)' });
            db.prepare("INSERT INTO refunds (order_id, amount, reason, source) VALUES (?, ?, 'ลูกค้าขอคืนเงิน (ยังไม่ได้เปิดใช้โค้ด)', 'admin')").run(order.id, order.total);
            status = 'refunded';
          }
        }
        backdate(order.id, t, status);
        counts[status] += 1;
        if (status === 'paid') for (const id of items) { mine.add(id); paidItems.push({ userId: user.id, gameId: id, t }); }
      }
    }
    for (const u of users) clearCart.run(u.id);

    // รีวิวจากผู้ซื้อจริง (~35% ของเกมที่ซื้อ) หลังซื้อ 1–10 วัน
    const insReview = db.prepare('INSERT OR IGNORE INTO reviews (user_id, game_id, rating, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
    const base = new Map(games.map((g) => [g.id, g.rating]));
    for (const p of paidItems) {
      if (!chance(0.35)) continue;
      const rating = reviewRating(base.get(p.gameId));
      const at = sqlTime(Math.min(now, p.t + (1 + rand() * 9) * DAY));
      if (insReview.run(p.userId, p.gameId, rating, pick(REVIEWS[rating]), at, at).changes) counts.reviews += 1;
    }
    // รายการโปรด 0–4 เกมต่อคน
    const insWish = db.prepare('INSERT OR IGNORE INTO wishlist (user_id, game_id) VALUES (?, ?)');
    for (const u of users) for (let i = Math.floor(rand() * 5); i > 0; i -= 1) insWish.run(u.id, pick(games).id);

    // ลูกค้าสมมติไม่ต้องได้อีเมลใด ๆ
    db.prepare(`DELETE FROM email_queue WHERE order_id IN (SELECT o.id FROM orders o JOIN users u ON u.id = o.user_id WHERE u.email LIKE ?)`).run(`%@${DEMO_DOMAIN}`);
  })();

  log(`ข้อมูลตัวอย่าง: ลูกค้า ${users.length} คน, ออเดอร์ชำระแล้ว ${counts.paid}, ยกเลิก ${counts.cancelled}, คืนเงิน ${counts.refunded}, รีวิว ${counts.reviews} (ย้อนหลัง ${DAYS_BACK} วัน)`);
  return { users: users.length, ...counts };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!demoAllowed()) {
    console.error('npm run seed:demo สร้างลูกค้าและคำสั่งซื้อสมมติ — ปฏิเสธการรันเมื่อ NODE_ENV=production (ตั้ง ALLOW_DEMO_SEED=1 ถ้าเป็น staging จริง ๆ)');
    process.exit(1);
  }
  await seedDemo();
}
