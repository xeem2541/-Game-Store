// Migration แบบมีหมายเลข: แต่ละรายการรันครั้งเดียว (บันทึกใน schema_migrations) จึงรันซ้ำได้ไม่พัง
// schema.sql ใช้ CREATE ... IF NOT EXISTS สำหรับตารางใหม่ ส่วนการแก้ตารางเดิม/ย้ายข้อมูลอยู่ที่นี่

const hasColumn = (db, table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some((r) => r.name === col);
const addColumn = (db, table, col, def) => { if (!hasColumn(db, table, col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); };

export const MIGRATIONS = [
  {
    id: '001_role_user',
    // ชื่อ role เดิม 'customer' → 'user' (user | staff | admin)
    up: (db) => { db.exec("UPDATE users SET role = 'user' WHERE role = 'customer'"); },
  },
  {
    id: '002_users_status',
    up: (db) => { addColumn(db, 'users', 'status', "TEXT NOT NULL DEFAULT 'active'"); }, // active | suspended
  },
  {
    id: '003_games_price_to_satang',
    // ราคาเกมเดิมเป็นบาท → เก็บเป็นสตางค์ (integer) เหมือนออเดอร์/คูปอง รันครั้งเดียวเท่านั้น (ห้ามคูณซ้ำ)
    up: (db) => { db.exec('UPDATE games SET price = price * 100'); },
  },
  {
    id: '004_games_admin_columns',
    up: (db) => {
      addColumn(db, 'games', 'cover_image', 'TEXT');
      addColumn(db, 'games', 'low_stock_threshold', 'INTEGER NOT NULL DEFAULT 5');
    },
  },
  {
    id: '005_game_keys_revoke_info',
    up: (db) => {
      addColumn(db, 'game_keys', 'revoke_reason', 'TEXT');
      addColumn(db, 'game_keys', 'revoked_by', 'INTEGER');
    },
  },
  {
    id: '006_backfill_order_events',
    // ออเดอร์ที่สร้างก่อนมีตาราง order_events: สร้างประวัติสถานะย้อนหลังจากวันที่ที่มีอยู่ในออเดอร์
    up: (db) => {
      const exists = (t) => db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
      if (!exists('orders') || !exists('order_events')) return;
      const orders = db.prepare('SELECT id, status, created_at, paid_at, cancelled_at, refunded_at, cancel_reason FROM orders WHERE id NOT IN (SELECT order_id FROM order_events)').all();
      const ins = db.prepare('INSERT INTO order_events (order_id, from_status, to_status, reason, created_at) VALUES (?, ?, ?, ?, ?)');
      for (const o of orders) {
        ins.run(o.id, null, 'pending', null, o.created_at);
        if (o.paid_at) ins.run(o.id, 'pending', 'paid', null, o.paid_at);
        if (o.status === 'cancelled') ins.run(o.id, 'pending', 'cancelled', o.cancel_reason, o.cancelled_at ?? o.created_at);
        if (o.status === 'refunded') ins.run(o.id, 'paid', 'refunded', null, o.refunded_at ?? o.created_at);
      }
    },
  },
  {
    id: '007_users_token_version',
    // ฝังใน JWT ทุกตัว: เพิ่มค่านี้ = เพิกถอนเซสชันทั้งหมดของผู้ใช้ (เปลี่ยน/รีเซ็ตรหัสผ่าน, ออกจากระบบทุกอุปกรณ์)
    up: (db) => { addColumn(db, 'users', 'token_version', 'INTEGER NOT NULL DEFAULT 0'); },
  },
  {
    id: '008_games_review_stats',
    // สรุปรีวิวเก็บในตาราง games (trigger ใน views.sql อัปเดตทุกครั้งที่รีวิวเปลี่ยน) แทน subquery ต่อแถวใน games_v
    // rating_avg = NULL เมื่อยังไม่มีรีวิว (games_v จะใช้คะแนนตั้งต้น games.rating)
    up: (db) => {
      addColumn(db, 'games', 'review_count', 'INTEGER NOT NULL DEFAULT 0');
      addColumn(db, 'games', 'rating_avg', 'REAL');
      const hasReviews = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'reviews'").get();
      if (hasReviews) {
        db.exec(`UPDATE games SET
          review_count = (SELECT COUNT(*) FROM reviews r WHERE r.game_id = games.id),
          rating_avg = (SELECT ROUND(AVG(r.rating), 1) FROM reviews r WHERE r.game_id = games.id)`);
      }
    },
  },
  {
    id: '009_users_totp',
    // 2FA ของหลังบ้าน: secret เข้ารหัสด้วย KEY_ENCRYPTION_SECRET (เหมือนโค้ดเกม), totp_last_step กันใช้รหัสเดิมซ้ำ
    up: (db) => {
      addColumn(db, 'users', 'totp_secret_enc', 'TEXT');
      addColumn(db, 'users', 'totp_enabled', 'INTEGER NOT NULL DEFAULT 0');
      addColumn(db, 'users', 'totp_last_step', 'INTEGER NOT NULL DEFAULT 0');
    },
  },
  {
    id: '010_payments_amount_refunded',
    // ยอดที่ Stripe คืนไปแล้ว (สะสม) — ใช้บันทึกการคืนเงินบางส่วนจาก Stripe Dashboard ที่ไม่เปลี่ยนสถานะออเดอร์
    up: (db) => {
      const hasPayments = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'payments'").get();
      if (hasPayments) addColumn(db, 'payments', 'amount_refunded', 'INTEGER NOT NULL DEFAULT 0');
    },
  },
];

export function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  const done = new Set(db.prepare('SELECT id FROM schema_migrations').all().map((r) => r.id));
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    db.transaction(() => {
      m.up(db);
      db.prepare('INSERT INTO schema_migrations (id) VALUES (?)').run(m.id);
    })();
  }
}
