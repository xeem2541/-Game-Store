import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers.js'; // ฐานข้อมูลในหน่วยความจำ แยกจากไฟล์เทสอื่น

const { db } = await import('../server/db/index.js');
const { seedDemo, DEMO_DOMAIN } = await import('../server/db/demo.js');
const { coverSvg } = await import('../server/services/coverArt.js');

test('ข้อมูลตัวอย่าง (npm run seed:demo): ข้อมูลสอดคล้องกันทุกตาราง, ไม่ส่งอีเมล, รันซ้ำไม่สร้างซ้ำ', async () => {
  const r = await seedDemo({ log: () => {} });
  assert.ok(r.users > 0 && r.paid > 50 && r.cancelled > 0 && r.reviews > 0);
  const n = (sql, ...a) => db.prepare(sql).get(...a).n;
  assert.equal(n("SELECT COUNT(*) AS n FROM game_keys WHERE status = 'sold'"),
    n("SELECT COUNT(*) AS n FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.status = 'paid'"), 'ทุกเกมที่จ่ายแล้วได้โค้ด');
  assert.equal(n("SELECT COUNT(*) AS n FROM game_keys WHERE status = 'reserved'"), 0);
  assert.equal(n('SELECT COUNT(*) AS n FROM invoices'), n("SELECT COUNT(*) AS n FROM orders WHERE status IN ('paid', 'refunded')"));
  assert.equal(n('SELECT COUNT(*) AS n FROM email_queue'), 0, 'ลูกค้าสมมติไม่ได้อีเมล');
  assert.equal(n("SELECT COUNT(*) AS n FROM orders WHERE created_at > datetime('now', '+1 minute')"), 0, 'ไม่มีออเดอร์ในอนาคต');
  assert.equal(n(`SELECT COUNT(*) AS n FROM reviews r WHERE NOT EXISTS (SELECT 1 FROM orders o JOIN order_items oi ON oi.order_id = o.id
    WHERE o.user_id = r.user_id AND oi.game_id = r.game_id AND o.status = 'paid')`), 0, 'รีวิวจากผู้ซื้อเท่านั้น');
  assert.ok(n("SELECT COUNT(DISTINCT substr(paid_at, 1, 7)) AS n FROM orders WHERE status = 'paid'") >= 4, 'กระจายหลายเดือน');
  assert.ok(n('SELECT COUNT(*) AS n FROM users WHERE email LIKE ?', `%@${DEMO_DOMAIN}`) === r.users);
  assert.equal(await seedDemo({ log: () => {} }), null, 'รันซ้ำไม่สร้างซ้ำ');
});

test('ภาพปกอัตโนมัติ: ฉากตามแนวเกม, ผลเหมือนเดิมทุกครั้ง, escape ชื่อเกม', () => {
  const g = { slug: 'x-game', title: 'Fish & <Chips> "Deluxe"', genre: 'แข่งรถ', color1: '#000', color2: '#fff' };
  const svg = coverSvg(g);
  assert.equal(svg, coverSvg(g), 'slug เดิม → ภาพเดิม (แคชได้)');
  assert.ok(svg.includes('Fish &amp; &lt;Chips&gt;') && !svg.includes('<Chips>'));
  assert.notEqual(coverSvg({ ...g, genre: 'RPG' }), svg, 'แนวเกมต่างกัน → ฉากต่างกัน');
  assert.ok(coverSvg({ ...g, genre: 'ไม่รู้จัก' }).startsWith('<svg'), 'แนวเกมที่ไม่มีฉากเฉพาะใช้ฉากตั้งต้น');
  assert.ok(!coverSvg({ ...g, color1: '"><script>' }).includes('"><script>'), 'สีถูก escape');
});

test('ภาพตัวอย่างและภาพปกอัตโนมัติ: แปลงเป็นรูปได้ทุกแนวเกม (SVG ถูกต้อง) ขนาด 16:9 / 4:3', async () => {
  const sharp = (await import('sharp')).default;
  const { screenshotSvg } = await import('../server/services/screenshotArt.js');
  const genres = db.prepare('SELECT DISTINCT genre FROM games').all().map((r) => r.genre);
  assert.ok(genres.length >= 8);
  for (const genre of [...genres, 'แนวที่ไม่รู้จัก']) {
    const g = { slug: `t-${genre}`, title: 'Test Game', genre, color1: '#123456', color2: '#abcdef' };
    for (const n of [0, 1, 2]) {
      const meta = await sharp(Buffer.from(screenshotSvg(g, n))).metadata();
      assert.deepEqual([meta.width, meta.height], [1280, 720], `${genre} #${n}`);
    }
    const cover = await sharp(Buffer.from(coverSvg(g))).metadata();
    assert.deepEqual([cover.width, cover.height], [800, 600], genre);
  }
});
