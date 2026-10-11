-- SQL มาตรฐาน (หลีกเลี่ยงฟีเจอร์เฉพาะ SQLite) เพื่อย้ายไป PostgreSQL ได้ง่าย
CREATE TABLE IF NOT EXISTS games (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  slug           TEXT NOT NULL UNIQUE,
  title          TEXT NOT NULL,
  description    TEXT NOT NULL,
  description_en TEXT NOT NULL DEFAULT '',
  genre          TEXT NOT NULL,
  platform       TEXT NOT NULL,
  price          INTEGER NOT NULL,
  discount       INTEGER NOT NULL DEFAULT 0,
  rating         REAL NOT NULL DEFAULT 0,
  release_date   TEXT NOT NULL,
  sales          INTEGER NOT NULL DEFAULT 0,
  featured       INTEGER NOT NULL DEFAULT 0,
  color1         TEXT NOT NULL,
  color2         TEXT NOT NULL,
  trailer_url    TEXT,
  spec_min       TEXT,
  spec_rec       TEXT,
  active         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_games_genre ON games(genre);
CREATE INDEX IF NOT EXISTS idx_games_platform ON games(platform);

-- ===== เฟส 2: สมาชิก =====
CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name           TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'user', -- user | staff | admin
  email_verified INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- เก็บเฉพาะแฮชของโทเคน (sha256) ไม่เก็บโทเคนจริง
CREATE TABLE IF NOT EXISTS email_verifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL, -- epoch ms
  used_at    INTEGER
);

CREATE TABLE IF NOT EXISTS password_resets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);

CREATE TABLE IF NOT EXISTS wishlist (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id    INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, game_id)
);

CREATE TABLE IF NOT EXISTS cart_items (
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id  INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, game_id)
);

CREATE TABLE IF NOT EXISTS reviews (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id    INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, game_id)
);
CREATE INDEX IF NOT EXISTS idx_reviews_game ON reviews(game_id);



-- ===== เฟส 3: คำสั่งซื้อ / คูปอง (เงินเก็บเป็นสตางค์ INTEGER ทั้งหมด) =====
CREATE TABLE IF NOT EXISTS coupons (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description  TEXT NOT NULL DEFAULT '',
  type         TEXT NOT NULL CHECK (type IN ('percent', 'fixed')),
  value        INTEGER NOT NULL CHECK (value > 0), -- percent: 1-100, fixed: สตางค์
  min_subtotal INTEGER NOT NULL DEFAULT 0,         -- ยอดขั้นต่ำ (สตางค์) หลังหักส่วนลดเกม
  expires_at   INTEGER,                            -- epoch ms, NULL = ไม่หมดอายุ
  max_uses     INTEGER,                            -- จำกัดจำนวนครั้งรวม, NULL = ไม่จำกัด
  max_per_user INTEGER,                            -- จำกัดต่อผู้ใช้, NULL = ไม่จำกัด
  active       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS orders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled', 'refunded')),
  currency        TEXT NOT NULL DEFAULT 'THB',
  subtotal        INTEGER NOT NULL, -- ราคาเต็มรวม (สตางค์)
  game_discount   INTEGER NOT NULL, -- ส่วนลดจากโปรโมชันของเกม
  coupon_id       INTEGER REFERENCES coupons(id),
  coupon_code     TEXT,
  coupon_discount INTEGER NOT NULL DEFAULT 0,
  total           INTEGER NOT NULL, -- ยอดสุทธิที่ต้องชำระ
  idempotency_key TEXT NOT NULL,
  cancel_reason   TEXT,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at      INTEGER NOT NULL, -- epoch ms
  paid_at         TEXT,
  cancelled_at    TEXT,
  refunded_at     TEXT,
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, id);
CREATE INDEX IF NOT EXISTS idx_orders_pending ON orders(status, expires_at);

-- snapshot ชื่อ/ราคา/ส่วนลด ณ ตอนซื้อ (ไม่ผูกกับราคาปัจจุบันของเกม)
CREATE TABLE IF NOT EXISTS order_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id         INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  game_id          INTEGER NOT NULL REFERENCES games(id),
  slug             TEXT NOT NULL,
  title            TEXT NOT NULL,
  platform         TEXT NOT NULL,
  list_price       INTEGER NOT NULL,
  discount_percent INTEGER NOT NULL,
  unit_price       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_game ON order_items(game_id);

-- บันทึกการใช้คูปอง: สร้างตอนสร้างออเดอร์ และลบทิ้งเมื่อออเดอร์ถูกยกเลิก/หมดอายุ (คืนสิทธิ์)
CREATE TABLE IF NOT EXISTS coupon_usages (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  coupon_id INTEGER NOT NULL REFERENCES coupons(id),
  user_id   INTEGER NOT NULL REFERENCES users(id),
  order_id  INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  used_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_coupon_usages ON coupon_usages(coupon_id, user_id);

-- ===== เฟส 4: ชำระเงิน / โค้ดเกม / ใบเสร็จ =====
-- เงินเป็นสตางค์ทั้งหมด provider: stripe | dev (จำลอง) | free (ยอด 0)
CREATE TABLE IF NOT EXISTS payments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id       INTEGER NOT NULL REFERENCES orders(id),
  provider       TEXT NOT NULL,
  provider_ref   TEXT,            -- Stripe Checkout Session id
  payment_intent TEXT,
  amount         INTEGER NOT NULL,
  currency       TEXT NOT NULL DEFAULT 'thb',
  status         TEXT NOT NULL DEFAULT 'created'
                 CHECK (status IN ('created', 'succeeded', 'failed', 'expired', 'refunded', 'needs_review')),
  checkout_url   TEXT,
  raw_event_id   TEXT,            -- webhook event ที่ยืนยันรายการนี้
  last_error     TEXT,
  created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_ref ON payments(provider, provider_ref) WHERE provider_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_pi ON payments(payment_intent);

-- กันประมวลผล webhook ซ้ำ (id = Stripe event id)
CREATE TABLE IF NOT EXISTS webhook_events (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- โค้ดเกม: key_enc = AES-256-GCM, key_hash = HMAC ของโค้ด (กันโค้ดซ้ำโดยไม่เก็บ plaintext)
CREATE TABLE IF NOT EXISTS game_keys (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id       INTEGER NOT NULL REFERENCES games(id),
  key_enc       TEXT NOT NULL,
  key_hash      TEXT NOT NULL UNIQUE,
  status        TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'reserved', 'sold', 'revoked')),
  order_item_id INTEGER REFERENCES order_items(id),
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sold_at       TEXT,
  revoked_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_game_keys_stock ON game_keys(game_id, status);
CREATE INDEX IF NOT EXISTS idx_game_keys_item ON game_keys(order_item_id);

-- ใบเสร็จ: เลขที่เอกสารรันต่อเนื่อง (INV-ปี-000001)
CREATE TABLE IF NOT EXISTS invoices (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id  INTEGER NOT NULL UNIQUE REFERENCES orders(id),
  number    TEXT NOT NULL UNIQUE,
  issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS refunds (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id         INTEGER NOT NULL UNIQUE REFERENCES orders(id), -- เฟสนี้คืนเต็มจำนวนเท่านั้น (1 ออเดอร์ = 1 การคืนเงิน)
  amount           INTEGER NOT NULL,
  provider_refund_id TEXT,
  reason           TEXT NOT NULL DEFAULT '',
  admin_id         INTEGER REFERENCES users(id),                  -- NULL = เกิดจาก Stripe Dashboard / ระบบอัตโนมัติ
  source           TEXT NOT NULL DEFAULT 'admin',                 -- admin | stripe_dashboard | auto
  created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- เรื่องที่แอดมินต้องดู (จ่ายเงินหลังออเดอร์หมดอายุ, ยอดไม่ตรง, โค้ดหมดระหว่างจ่าย, คืนเงินล้มเหลว ฯลฯ)
CREATE TABLE IF NOT EXISTS admin_alerts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,
  order_id   INTEGER REFERENCES orders(id),
  detail     TEXT NOT NULL DEFAULT '',
  resolved   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id),
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  TEXT,
  meta       TEXT,
  ip         TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action, created_at);

-- คิวอีเมล: เก็บเฉพาะ "ชนิด+ออเดอร์" ไม่เก็บเนื้อหา (โค้ดเกมจะถูกถอดรหัสตอนส่งเท่านั้น)
CREATE TABLE IF NOT EXISTS email_queue (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  kind            TEXT NOT NULL,
  order_id        INTEGER NOT NULL REFERENCES orders(id),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  last_error      TEXT,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_email_queue_due ON email_queue(status, next_attempt_at);

-- คืนเงินอัตโนมัติ (outbox): บันทึกใน transaction เดียวกับ webhook แล้วค่อยเรียก Stripe หลัง commit + retry จนสำเร็จ
-- โปรเซสล่มระหว่างทางก็ไม่หาย (เดิมเก็บในหน่วยความจำ ถ้าล่มหลัง commit Stripe จะไม่ส่ง event ซ้ำ เงินค้างโดยไม่มีใครรู้)
-- order_id ไม่ผูก FK เพราะกรณี "ได้เงินแต่ไม่พบออเดอร์" ก็ต้องคืนเงิน
CREATE TABLE IF NOT EXISTS auto_refunds (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_intent     TEXT NOT NULL UNIQUE,
  order_id           INTEGER,
  reason             TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
  attempts           INTEGER NOT NULL DEFAULT 0,
  next_attempt_at    INTEGER NOT NULL, -- epoch ms
  last_error         TEXT,
  provider_refund_id TEXT,
  created_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  done_at            TEXT
);
CREATE INDEX IF NOT EXISTS idx_auto_refunds_due ON auto_refunds(status, next_attempt_at);

-- ===== เฟส 5: Admin Panel =====
-- (คอลัมน์ที่เพิ่มให้ตารางเดิมอยู่ใน migrations.js เพราะ SQLite ไม่มี ADD COLUMN IF NOT EXISTS)

-- ประวัติการเปลี่ยนราคา/ส่วนลดของเกม (ราคาเป็นสตางค์)
CREATE TABLE IF NOT EXISTS price_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id      INTEGER NOT NULL REFERENCES games(id),
  old_price    INTEGER NOT NULL,
  new_price    INTEGER NOT NULL,
  old_discount INTEGER NOT NULL,
  new_discount INTEGER NOT NULL,
  changed_by   INTEGER REFERENCES users(id),
  changed_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_price_history_game ON price_history(game_id, id);

-- ภาพตัวอย่างของเกม (filename = ชื่อสุ่ม .webp ในโฟลเดอร์ data/uploads/games)
CREATE TABLE IF NOT EXISTS game_images (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id  INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  filename TEXT NOT NULL UNIQUE,
  kind     TEXT NOT NULL DEFAULT 'screenshot' CHECK (kind IN ('cover', 'screenshot')),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_game_images_game ON game_images(game_id, kind, position);

-- ประวัติการเปลี่ยนสถานะของออเดอร์ (actor_id NULL = ระบบ/webhook/ลูกค้า)
CREATE TABLE IF NOT EXISTS order_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  reason      TEXT,
  actor_id    INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_id, id);

-- ===== เฟส 6: index เพิ่มจากการตรวจแผน query (EXPLAIN QUERY PLAN) =====
CREATE INDEX IF NOT EXISTS idx_games_active_sales ON games(active, sales DESC);
CREATE INDEX IF NOT EXISTS idx_games_release ON games(release_date);
CREATE INDEX IF NOT EXISTS idx_orders_user_status ON orders(user_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_status_paid ON orders(status, paid_at);
CREATE INDEX IF NOT EXISTS idx_reviews_user ON reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, id);
CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at);
