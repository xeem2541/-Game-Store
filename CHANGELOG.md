# Changelog

รูปแบบอิง [Keep a Changelog](https://keepachangelog.com/) · เวอร์ชันตาม [SemVer](https://semver.org/lang/th/)

## [Unreleased]

### Security
- ไม่มีค่าเริ่มต้นของ `JWT_SECRET` / `KEY_ENCRYPTION_SECRET` อีกต่อไป — ไม่ตั้ง = ไม่ยอมเริ่ม ทุกโหมดยกเว้น `NODE_ENV=test`
- การจำลองชำระเงินต้องเปิดเองด้วย `DEV_PAY=1` (เดิมเปิดอัตโนมัติเมื่อไม่ใช่ production)
- เพิกถอนเซสชันได้: `users.token_version` ฝังใน JWT — เปลี่ยน/รีเซ็ตรหัสผ่าน หรือ `POST /api/auth/logout-all` ทำให้ token เก่าทั้งหมด (ลูกค้า + แอดมิน) ใช้ไม่ได้ทันที

### Fixed
- ราคาหลังส่วนลดคำนวณจากที่เดียว (`services/pricing.js` → `finalPrice` / `FINAL_PRICE_SQL`) — เดิมหน้าร้านใช้สูตร float ทำให้ราคาที่แสดงต่างจากยอดที่เรียกเก็บได้ 1 สตางค์ และตัวกรองราคาปัดเศษคนละแบบ
- เกมที่ถูกซ่อนหลังจากอยู่ในตะกร้าแล้ว: หน้าตะกร้า/ชำระเงินแจ้งชื่อเกมพร้อมปุ่มนำออก (`/api/cart/summary` → `unavailable`) และการสั่งซื้อจะนำเกมนั้นออกจากตะกร้าให้ก่อนตอบ 409 จึงสั่งใหม่ได้ทันที (เดิมติดอยู่โดยมองไม่เห็นเกมนั้น)

### Fixed (ชำระเงิน / บัญชี)
- เริ่มชำระเงินช่วงท้ายของออเดอร์: ต่ออายุออเดอร์ให้ครอบคลุม Checkout Session + 5 นาที (เดิม session อยู่ได้นานกว่าออเดอร์ → ลูกค้าจ่าย PromptPay แล้วโดนคืนเงินเพราะออเดอร์ถูกยกเลิกไปก่อน) จำกัดอายุออเดอร์รวมไม่เกิน 2 ชม. (`ORDER_TOO_OLD`)
- คืนเงินอัตโนมัติผ่านคิว `auto_refunds` ที่บันทึกใน transaction เดียวกับ webhook แล้ว retry แบบ backoff (เดิมถ้าโปรเซสล่มหลัง commit เงินค้างโดยไม่มีใครรู้ และล้มเหลวครั้งเดียวก็เลิก)
- เปลี่ยนอีเมลต้องใส่รหัสผ่านปัจจุบัน, แจ้งเตือนอีเมลเดิม และเพิกถอนเซสชันอื่น

- รีวิวได้เฉพาะผู้ที่ซื้อเกมแล้ว (ออเดอร์สถานะ paid) และแสดงป้าย "ซื้อแล้ว" — รีวิวเดิมของผู้ที่ไม่ได้ซื้อยังอยู่แต่ไม่มีป้าย

- กันกักสต็อกด้วยออเดอร์รอชำระ: ค้างได้ไม่เกิน `MAX_PENDING_ORDERS` (3) ต่อผู้ใช้ และสร้างคำสั่งซื้อได้ `ORDER_RATE_LIMIT` (10) ครั้ง/10 นาที/ผู้ใช้

- **2FA (TOTP) สำหรับหลังบ้าน** บังคับทุกบัญชี staff/admin (ปิดได้ด้วย `ADMIN_MFA_REQUIRED=0`): ตั้งค่าด้วย QR ตอนเข้าครั้งแรก, รหัสกู้คืน 8 รหัส, กันใช้รหัสเดิมซ้ำ, secret เข้ารหัสในฐานข้อมูล, admin ล้าง 2FA ของคนอื่นได้ + `npm run reset-mfa` (migration 009)

### Performance
- คะแนนเฉลี่ย/จำนวนรีวิวเก็บในตาราง `games` (`rating_avg`, `review_count`, migration 008) อัปเดตด้วย trigger บนตาราง `reviews` — `games_v` ไม่ต้องรัน subquery 2 ตัวต่อแถวอีก (เกม 2,000 / รีวิว 100,000: เรียงตามคะแนน 50.6 ms → 0.24 ms)

### Tests / CI
- เทส webhook ที่ขาด: PromptPay ยืนยันทีหลัง (async succeeded/failed), session หมดอายุ, ได้เงินแต่ไม่พบออเดอร์, จ่ายซ้ำ, event ที่ไม่ใช้ — `payments.js` branch coverage 64% → 80%
- GitHub Actions: เทส + build บน Node 22/24, e2e Chromium (ยังไม่บล็อก)

### Deploy
- `render.yaml`: เปลี่ยนจาก plan ฟรี (ไม่มีดิสก์ถาวร → ฐานข้อมูลหายทุกครั้งที่ deploy) เป็น `starter` + persistent disk ที่ `/app/data`, instance เดียว และประกาศตัวแปรที่ production ต้องใช้ครบ (`sync: false` สำหรับความลับที่ต้องกรอก)
- `APP_URL` ไม่ตั้งได้บน Render — การตรวจ production ใช้ `RENDER_EXTERNAL_URL` เหมือนที่แอปใช้จริง
- กันข้อมูลหายตอนสตาร์ท: โฟลเดอร์ข้อมูลเขียนไม่ได้ → หยุดพร้อมบอกสาเหตุ, `REQUIRE_EXISTING_DB=1` → ไม่สร้างฐานข้อมูลว่างใหม่ถ้าไม่พบไฟล์เดิม, production สร้างฐานข้อมูลใหม่ → เตือนใน log

## [1.0.0] — 2026-10-08

รุ่นแรกที่ครบทั้ง 6 เฟส (ยังไม่เคยใช้กับ Stripe/SMTP/Docker จริง — ดู `docs/CHECKLIST.md`)

### เฟส 1 — หน้าร้าน
- Express + SQLite (better-sqlite3), หน้าแรก/รายการเกม/รายละเอียด, ค้นหา-กรอง-เรียง, ธีมมืด/สว่าง, ตัวอย่างข้อมูลเกม 30 รายการ

### เฟส 2 — สมาชิก
- สมัคร/ล็อกอิน (JWT ใน httpOnly cookie), ยืนยันอีเมล, ลืม/รีเซ็ตรหัสผ่าน, โปรไฟล์, รายการโปรด, รีวิวและคะแนน, ไทย/อังกฤษ, CSRF, rate limit, ชุดเทสต์แรก

### เฟส 3 — ตะกร้าและสั่งซื้อ
- ตะกร้า, คูปอง (เปอร์เซ็นต์/จำนวนเงิน, จำกัดการใช้), ออเดอร์ + state machine, idempotency key, ออเดอร์หมดอายุอัตโนมัติ, ราคาเป็นสตางค์ (migration 003)

### เฟส 4 — ชำระเงิน
- Stripe Checkout (บัตร + PromptPay), webhook ยืนยันลายเซ็น + กันซ้ำ, ตรวจยอด/สกุลเงิน, คืนเงินอัตโนมัติในกรณีผิดปกติ, โค้ดเกมเข้ารหัส AES-256-GCM + จองแบบ atomic, คิวอีเมล + retry, ใบเสร็จ PDF ภาษาไทย (ฟอนต์ Sarabun), คืนเงินเต็มจำนวน

### เฟส 5 — หลังบ้าน `/admin`
- แดชบอร์ด/กราฟ, จัดการเกมและรูป (WebP), สต็อก + นำเข้า CSV, ออเดอร์ + คืนเงินยืนยันสองชั้น, ผู้ใช้/บทบาท, คูปอง, รีวิว, รายงาน CSV, audit log, บทบาท staff/admin

### เฟส 6 — ทดสอบรวม / ความปลอดภัย / SEO / Performance / Docker / เอกสาร
**ความปลอดภัย**
- CSP เข้ม (ไม่มี inline script/style), HSTS (production), Referrer-Policy, Permissions-Policy, `X-Frame-Options`; CORS จาก `.env`; `trust proxy` ตั้งได้
- production ปฏิเสธการเริ่มระบบเมื่อ `JWT_SECRET`/`KEY_ENCRYPTION_SECRET`/`STRIPE_WEBHOOK_SECRET` เป็นค่าเริ่มต้น/ว่าง/อ่อน (`server/envcheck.js`, `npm run check:env`)
- production ไม่ seed ข้อมูลตัวอย่าง/บัญชีทดสอบ/โค้ดปลอม/คูปอง; ไม่มี route จำลองชำระเงิน
- สิทธิ์เสริมของ staff ตั้งได้ผ่าน `STAFF_PERMISSIONS` (ค่าเริ่มต้นอ่านอย่างเดียว)
- access log ไม่เก็บ query string/cookie/body
- สคริปต์สำรอง/กู้คืนฐานข้อมูล (`npm run backup` / `restore`) พร้อม checksum และสำเนาก่อนกู้คืน
**SEO:** sitemap.xml + robots.txt แบบไดนามิก, meta/OG/Twitter/canonical, JSON-LD (Product + Offer + AggregateRating เมื่อมีรีวิวจริง), รูป OG แบบ PNG, หน้า 404/500 สวยพร้อม noindex, `<html lang>` ตามภาษา
**Performance:** build ด้วย esbuild (minify, code splitting, ชื่อไฟล์มี hash, brotli/gzip ล่วงหน้า), แคชไฟล์ hash 1 ปี / HTML ไม่แคชนาน, lazy-load + ภาพย่อ + width/height, ลด CLS ด้วย skeleton, ดัชนีฐานข้อมูลเพิ่ม + WAL; Lighthouse (มือถือ/เดสก์ท็อป) หน้าแรกและหน้าเกม performance 98–100 หลัง build
**ทดสอบ:** เทสต์ฝั่งเซิร์ฟเวอร์ 85 ข้อ; Playwright (Chromium): เส้นทางซื้อครบวงจร, responsive 375/768/1280 (ลูกค้า + แอดมิน), a11y ด้วย axe (ไทย/อังกฤษ × มืด/สว่าง, 11 หน้า), คีย์บอร์ด/focus; load test ด้วย autocannon; ทดสอบซื้อพร้อมกันได้โค้ดไม่ซ้ำ
**Docker/deploy:** `Dockerfile` แบบ multi-stage (user ไม่ใช่ root, เฉพาะ production deps, healthcheck), `docker-compose.yml` (volume ข้อมูล, env_file, Caddy HTTPS แบบ optional), `/healthz`, graceful shutdown, ตัวอย่าง nginx
**เอกสาร:** README ภาษาไทยฉบับเต็ม, `docs/API.md`, `docs/CHECKLIST.md`
**แก้ไข:** หน้าตะกร้าของผู้ใช้ที่ยังไม่ล็อกอินพัง (JS error), ค่าคอนทราสต์สีไม่ผ่าน WCAG AA, หน้าแอดมิน "เกม" ล้นแนวนอนบนจอ 375px, CLS สูงบนหน้าเกม
