# Changelog

รูปแบบอิง [Keep a Changelog](https://keepachangelog.com/) · เวอร์ชันตาม [SemVer](https://semver.org/lang/th/)

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
