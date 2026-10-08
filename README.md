# Game Store — ร้านขายเกม (โค้ดเกมดิจิทัล)

เว็บร้านค้าขายโค้ดเกมครบวงจร: หน้าร้าน, ระบบสมาชิก, ตะกร้า/คูปอง, ชำระเงินผ่าน Stripe (บัตร + PromptPay QR), ส่งโค้ดเกมอัตโนมัติ, ใบเสร็จ PDF, หลังบ้านสำหรับแอดมิน/พนักงาน

> **สถานะ:** พร้อมทดสอบและ deploy แต่ **ยังไม่เคยทดสอบกับ Stripe จริง / SMTP จริง / Docker build จริง** — อ่าน [`docs/CHECKLIST.md`](docs/CHECKLIST.md) ก่อนเปิดขายจริงเสมอ

## สารบัญ
1. [ฟีเจอร์](#ฟีเจอร์) · 2. [โครงสร้างโปรเจกต์](#โครงสร้างโปรเจกต์) · 3. [ติดตั้งเพื่อพัฒนา](#ติดตั้งเพื่อพัฒนา) · 4. [ติดตั้งด้วย Docker](#ติดตั้งด้วย-docker) · 5. [ตัวแปร .env ทั้งหมด](#ตัวแปร-env-ทั้งหมด) · 6. [ตั้งค่า Stripe / PromptPay](#ตั้งค่า-stripe--promptpay) · 7. [ตั้งค่า SMTP](#ตั้งค่า-smtp-อีเมล) · 8. [สร้างแอดมิน/พนักงาน](#สร้างแอดมินพนักงาน) · 9. [รันเทสต์](#รันเทสต์) · 10. [สำรอง/กู้คืนข้อมูล](#สำรองและกู้คืนข้อมูล) · 11. [Deploy](#deploy-ขึ้นเซิร์ฟเวอร์จริง) · 12. [ความปลอดภัย](#ความปลอดภัยที่ทำไว้) · 13. [แก้ปัญหา](#แก้ปัญหาที่พบบ่อย)

## ฟีเจอร์

**ลูกค้า:** ค้นหา/กรองเกม (หมวด, แพลตฟอร์ม, ราคา, ลดราคา) · หน้ารายละเอียด + แกลเลอรี + วิดีโอตัวอย่าง + รีวิว/คะแนน · รายการโปรด · ตะกร้า + คูปอง · สมัคร/ล็อกอิน/ยืนยันอีเมล/ลืมรหัสผ่าน · คลังเกมของฉัน (โค้ดซ่อนไว้จนกดแสดง) · ประวัติสั่งซื้อ + ใบเสร็จ PDF ภาษาไทย · ไทย/อังกฤษ · ธีมมืด/สว่าง · ใช้ได้ทั้งมือถือและเดสก์ท็อป

**ชำระเงิน:** Stripe Checkout (บัตร + PromptPay, THB) · **ยืนยันการจ่ายด้วย webhook ที่เซ็นลายเซ็นเท่านั้น** (หน้า "กลับจากชำระเงิน" ไม่ใช่หลักฐาน) · ราคาคำนวณฝั่งเซิร์ฟเวอร์เป็นสตางค์ · จองโค้ดเกมตอนสร้างออเดอร์ (ซื้อพร้อมกันไม่ได้โค้ดซ้ำ) · จ่ายซ้ำ/จ่ายช้า/ยอดไม่ตรง/โค้ดหมด → คืนเงินอัตโนมัติ + แจ้งแอดมิน · อีเมลหลังซื้อผ่านคิว (retry อัตโนมัติ)

**หลังบ้าน `/admin`:** แดชบอร์ด + กราฟยอดขาย · จัดการเกม/รูป · สต็อกโค้ดเกม (นำเข้า CSV, เข้ารหัส AES-256-GCM) · ออเดอร์ + คืนเงิน (ยืนยันสองชั้น) · ผู้ใช้/บทบาท · คูปอง · รีวิว · รายงาน CSV · audit log

**ระบบ:** SEO (sitemap, robots, meta/OG/Twitter, JSON-LD) · CSP แบบเข้ม (ไม่มี inline script/style) · build ด้วย esbuild (minify + hash + brotli/gzip) · `/healthz` · graceful shutdown · สำรอง/กู้คืนฐานข้อมูล · Docker

## โครงสร้างโปรเจกต์

```
server/
  index.js            เริ่ม/หยุดเซิร์ฟเวอร์ (graceful shutdown), งานเบื้องหลัง (หมดอายุออเดอร์, คิวอีเมล)
  app.js              Express: helmet/CSP, CORS, rate limit, CSRF, routes
  web.js, seo.js      เสิร์ฟหน้าเว็บ, sitemap/robots, meta+JSON-LD, รูป OG
  config.js, envcheck.js   อ่าน .env + ตรวจความพร้อมของ production (ปฏิเสธค่าเริ่มต้น/ความลับอ่อน)
  db/                 schema.sql, views.sql, migrations, seed (ข้อมูลตัวอย่างเฉพาะ dev)
  middleware/         auth, adminAuth (บทบาท/สิทธิ์), csrf, requestLog
  routes/             API ฝั่งลูกค้า   routes/admin/   API หลังบ้าน
  services/           ธุรกิจหลัก: orders, payments, refunds, keys, crypto, coupons, receipt, emailQueue, images ...
  scripts/            check-env, backup, restore, make-role
public/               หน้าร้าน (HTML/CSS/JS ธรรมดา ไม่มี framework) + i18n/th.json, en.json
admin/                หลังบ้าน (SPA แบบ ES modules)
scripts/              build.js (esbuild), bench.js (load test)
tests/                เทสต์ฝั่งเซิร์ฟเวอร์ (node:test)    e2e/   เทสต์เบราว์เซอร์ (Playwright)
deploy/               Caddyfile, nginx.conf.example
docs/                 API.md, CHECKLIST.md
Dockerfile, docker-compose.yml, .env.example
```

## ติดตั้งเพื่อพัฒนา

ต้องมี Node.js **22 ขึ้นไป** (ทดสอบกับ 24)

```bash
npm install
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env
npm run seed                # เกม/คูปอง/โค้ดปลอม (FAKE-...) สำหรับทดสอบ — เฉพาะ dev
npm run dev                 # http://localhost:3000   (แอดมิน: http://localhost:3000/admin/)
```

- ไม่มี SMTP → ลิงก์ยืนยันอีเมล/รีเซ็ตรหัสผ่านถูกพิมพ์ใน console (บล็อก `[DEV MAIL]`)
- ไม่มี Stripe → หน้าออเดอร์มีปุ่ม "จำลองชำระสำเร็จ" (**ไม่มีใน production**)
- ใช้ไฟล์ที่ build แล้ว: `npm run build && npm run start:dist` (production ใช้ `dist/` อัตโนมัติ)

## ติดตั้งด้วย Docker

> ⚠️ `Dockerfile` / `docker-compose.yml` ผ่านการตรวจ syntax (`docker compose config`) และจำลองโครงไฟล์ของ image แล้ว แต่ **ยังไม่เคย build image จริง** (เครื่องผู้พัฒนาไม่มี Docker daemon) — build ครั้งแรกบนเซิร์ฟเวอร์ของคุณและตรวจ log ให้ละเอียด

```bash
cp .env.example .env     # แก้ค่าทั้งหมดตามหัวข้อ "ตัวแปร .env" (production ต้องมี secret จริง)
docker compose up -d --build
docker compose logs -f app
docker compose ps                      # คอลัมน์ STATUS ควรขึ้น (healthy)
```

- ข้อมูล (ฐานข้อมูล, รูปอัปโหลด, ไฟล์สำรอง) อยู่ใน volume `gamestore-data` → `/app/data`
- container รันด้วย user `node` (ไม่ใช่ root), ติดตั้งเฉพาะ production dependencies, ตรวจสุขภาพที่ `/healthz`
- `app` เปิดพอร์ต 3000 เฉพาะภายในเครือข่าย compose; เปิดสู่ภายนอกด้วย HTTPS ผ่าน Caddy: ตั้ง `DOMAIN=โดเมนของคุณ` แล้ว `docker compose --profile proxy up -d` (หรือใช้ [`deploy/nginx.conf.example`](deploy/nginx.conf.example))
- ทดลองบนเครื่องตัวเองโดยยังไม่มีโดเมน: ตั้ง `APP_URL=http://localhost:3000` และ `ALLOW_HTTP_APP_URL=1` (ห้ามใช้ตอนขายจริง) และเพิ่ม `ports: ["3000:3000"]` ให้บริการ `app` ชั่วคราว
- รันคำสั่งดูแลใน container: `docker compose exec app node server/scripts/make-role.js admin you@example.com`, `docker compose exec app node server/scripts/backup.js`

## ตัวแปร `.env` ทั้งหมด

ตัวอย่างพร้อมคำอธิบายอยู่ใน [`.env.example`](.env.example) · ตรวจความพร้อม: `NODE_ENV=production npm run check:env`

| ตัวแปร | ค่าเริ่มต้น | ความหมาย |
|---|---|---|
| `NODE_ENV` | `development` | `production` = เปิดการตรวจเข้ม, HSTS, ปิดโหมดจำลอง, ไม่ seed ข้อมูลตัวอย่าง |
| `PORT` | `3000` | พอร์ต |
| `APP_URL` | `http://localhost:3000` | URL สาธารณะ (ลิงก์อีเมล, canonical, sitemap, OG) — production ต้องเป็น `https://` |
| `DATABASE_PATH` | `./data/store.db` | ไฟล์ SQLite (รูปอัปโหลดอยู่โฟลเดอร์ `uploads/` ข้างไฟล์นี้) |
| `TRUST_PROXY` | ว่าง | จำนวน reverse proxy ที่เชื่อถือ (ปกติ `1` เมื่ออยู่หลัง Caddy/nginx/Cloudflare) |
| `CORS_ORIGINS` | = `APP_URL` | โดเมนที่เรียก API ข้ามเว็บได้ (คั่น `,`) |
| `LOG_REQUESTS` | `1` | `0` = ปิด access log (log เก็บแค่ method/path/status) |
| `USE_DIST` | ว่าง | `1` = ใช้ `dist/` แม้ไม่ใช่ production |
| `JWT_SECRET` | – | **บังคับใน production** ≥32 ตัว สุ่ม |
| `KEY_ENCRYPTION_SECRET` | – | **บังคับใน production** ≥32 ตัว สุ่ม ต่างจาก JWT_SECRET — **ห้ามเปลี่ยน/ห้ามทำหาย** (โค้ดเกมที่เข้ารหัสไว้จะถอดไม่ได้) |
| `AUTH_RATE_LIMIT` / `API_RATE_LIMIT` | `20` / `300` | จำกัดคำขอต่อ IP (login ต่อ 15 นาที / API ต่อนาที) |
| `STRIPE_SECRET_KEY` | – | `sk_test_…` / `sk_live_…` |
| `STRIPE_PUBLISHABLE_KEY` | – | `pk_…` |
| `STRIPE_WEBHOOK_SECRET` | – | `whsec_…` **บังคับใน production** |
| `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASS` `SMTP_FROM` | – / `587` | อีเมลออก (production ควรตั้ง ไม่งั้นลูกค้าไม่ได้รับอีเมล) |
| `SHOP_NAME` `SHOP_ADDRESS` `SHOP_TAX_ID` | ตัวอย่าง | ข้อมูลร้านบนใบเสร็จ (ต้องแก้เป็นของจริง) |
| `ORDER_EXPIRY_MINUTES` | `30` | ออเดอร์รอจ่ายหมดอายุกี่นาที |
| `EMAIL_RESEND_LIMIT` | `5` | ส่งอีเมลซ้ำได้กี่ครั้งต่อ 10 นาที |
| `STAFF_PERMISSIONS` | ว่าง | สิทธิ์เสริมของ staff — ดูด้านล่าง |
| `BACKUP_DIR` / `BACKUP_KEEP` | `./backups` / `14` | ที่เก็บ/จำนวนชุดสำรอง |
| `ALLOW_HTTP_APP_URL` | – | `1` = ยอมให้ `APP_URL` เป็น http ใน production (เฉพาะทดลอง) |
| `ALLOW_DEMO_SEED` | – | `1` = ยอมให้ seed ข้อมูลตัวอย่างใน production (**ห้ามใช้กับร้านจริง**) |

**สิทธิ์ของ staff (`STAFF_PERMISSIONS`):** ค่าเริ่มต้นว่าง = staff **อ่านอย่างเดียว** (ดูแดชบอร์ด ออเดอร์ สต็อก รีวิว รายงาน) และยกเลิก/ส่งอีเมลซ้ำของออเดอร์ที่ยังไม่จ่ายได้ ต้องการให้ทำมากกว่านี้ ให้ระบุ (คั่น `,`):
`games.write` (เพิ่ม/แก้/ลบเกมและรูป) · `stock.write` (นำเข้า/เพิกถอนโค้ด, ตั้งเกณฑ์สต็อก) · `coupons.manage` (คูปอง) · `reports.users` (รายงานผู้ใช้ใหม่)
ส่วน **คืนเงิน, เปิดดูโค้ดเต็ม, จัดการผู้ใช้/บทบาท, audit log เป็นของ admin เท่านั้นเสมอ** ไม่ว่าจะตั้งค่าใด ชื่อสิทธิ์ที่ไม่รู้จักถูกเมิน (เปลี่ยนค่าแล้วรีสตาร์ตเซิร์ฟเวอร์)

**production จะ "ไม่ยอมเริ่ม"** ถ้า `JWT_SECRET`/`KEY_ENCRYPTION_SECRET` เป็นค่าตัวอย่าง/สั้นเกินไป/ซ้ำกัน, `STRIPE_WEBHOOK_SECRET` ว่างหรือไม่ใช่ `whsec_…`, ไม่มี `STRIPE_SECRET_KEY`, `APP_URL` ไม่ใช่ https หรือเปิด `DEV_PAY` (ข้อความ error บอกชื่อตัวแปรที่ผิด) ส่วนที่ไม่ถึงขั้นห้าม (เช่น ยังไม่ตั้ง SMTP) จะขึ้นเป็นคำเตือน

## ตั้งค่า Stripe / PromptPay

1. สมัครที่ [dashboard.stripe.com](https://dashboard.stripe.com) (บัญชีประเทศไทย) แล้วเปิด **Test mode**
2. Developers → API keys → ใส่ `sk_test_…` ที่ `STRIPE_SECRET_KEY` และ `pk_test_…` ที่ `STRIPE_PUBLISHABLE_KEY`
3. **PromptPay:** Settings → Payment methods → เปิด *PromptPay* (ต้องเป็น THB) ระบบส่ง `card` + `promptpay` ไปที่ Stripe — ถ้าไม่เปิด Stripe จะปฏิเสธการสร้างหน้าชำระเงิน
4. **Webhook ตอนพัฒนา:** ติดตั้ง [Stripe CLI](https://stripe.com/docs/stripe-cli) แล้ว
   ```bash
   stripe login
   stripe listen --forward-to localhost:3000/api/webhooks/stripe
   ```
   นำ `whsec_…` ที่แสดงไปใส่ `STRIPE_WEBHOOK_SECRET` แล้วรีสตาร์ต
5. ทดสอบ: บัตร `4242 4242 4242 4242` (วันหมดอายุอนาคต, CVC ใดก็ได้) → หน้า `/order/:id` แสดงโค้ดเมื่อ webhook มาถึง
6. **เปิดขายจริง:** Dashboard (Live mode) → Developers → Webhooks → Add endpoint `https://โดเมนคุณ/api/webhooks/stripe` เลือก event: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded` → ใช้ Signing secret ของ endpoint นั้น + คีย์ `sk_live_…`

กรณีผิดปกติที่ระบบจัดการให้ (คืนเงินอัตโนมัติ + แจ้งเตือนแอดมินในแดชบอร์ด): จ่ายหลังออเดอร์หมดอายุ, ยอด/สกุลเงินไม่ตรง, จ่ายซ้ำ, โค้ดหมดระหว่างจ่าย · คืนเงินบางส่วนจาก Stripe Dashboard → แจ้งเตือนเท่านั้น (ระบบรองรับคืนเต็มจำนวน)

## ตั้งค่า SMTP (อีเมล)

ใส่ `SMTP_HOST`, `SMTP_PORT` (587 = STARTTLS, 465 = TLS), `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` ตัวอย่างผู้ให้บริการ: Gmail (ต้องใช้ App Password), SendGrid, Mailgun, Amazon SES — ใช้โดเมนผู้ส่งที่ตั้ง SPF/DKIM ให้ถูกต้อง ไม่งั้นอีเมลเข้าสแปม
อีเมลหลังซื้อ (มีโค้ดเกม) เข้าคิวในฐานข้อมูล ล้มเหลวจะลองใหม่ที่ 1 นาที → 5 นาที → 30 นาที → 2 ชม. → 6 ชม. แล้วแจ้งแอดมิน โดยไม่กระทบสถานะออเดอร์; ลูกค้ากด "ส่งอีเมลอีกครั้ง" ได้

## สร้างแอดมิน/พนักงาน

ระบบ **ไม่สร้างบัญชีแอดมินให้เองใน production** ให้สมัครสมาชิกที่หน้าเว็บก่อน แล้วเลื่อนสิทธิ์:

```bash
npm run make-admin -- you@example.com     # ผู้ดูแลเต็มสิทธิ์
npm run make-staff -- helper@example.com  # พนักงาน (สิทธิ์ตาม STAFF_PERMISSIONS)
# ใน Docker: docker compose exec app node server/scripts/make-role.js admin you@example.com
```

เข้าหลังบ้านที่ `/admin/` (คุกกี้แยกจากฝั่งลูกค้า หมดอายุ 2 ชั่วโมง) — ใช้รหัสผ่านยาวและไม่ซ้ำกับที่อื่น

## รันเทสต์

```bash
npm test                     # เทสต์ฝั่งเซิร์ฟเวอร์ 85 ข้อ (auth, ตะกร้า/ออเดอร์, ชำระเงิน/webhook, แอดมิน, ความปลอดภัย, SEO, สำรอง/กู้คืน)
npm run test:coverage        # + รายงาน coverage
npm run e2e                  # Playwright (ต้อง `npx playwright install chromium` ก่อนครั้งแรก): เส้นทางซื้อครบวงจร,
                             #   responsive 375/768/1280, a11y (axe), คีย์บอร์ด, ไทย/อังกฤษ × มืด/สว่าง
npm run build && npm run bench   # load test เบา ๆ ด้วย autocannon
```

เทสต์ไม่เรียก Stripe/SMTP จริง (ใช้ Stripe ปลอม + webhook ที่เซ็นลายเซ็นเอง) ภาพหน้าจอ responsive อยู่ที่ `e2e/screenshots/`

## สำรองและกู้คืนข้อมูล

```bash
npm run backup                                   # → backups/backup-YYYY-MM-DD-HH-MM-SS/ (store.db + uploads + manifest.json)
# กู้คืน (หยุดเซิร์ฟเวอร์ก่อน!):
npm run restore -- backups/backup-2026-10-08-12-00-00 --yes
```

- ใช้ SQLite Online Backup API → สำรองได้ขณะเซิร์ฟเวอร์ทำงาน, ตรวจ `integrity_check` และ checksum SHA-256
- กู้คืนจะสำรองข้อมูลปัจจุบันไว้ที่ `backups/pre-restore-*` ก่อนเสมอ และปฏิเสธไฟล์ที่ checksum ไม่ตรง
- **ไฟล์สำรองไม่รวม `.env`** — เก็บ `.env` (โดยเฉพาะ `KEY_ENCRYPTION_SECRET`) ไว้ที่ปลอดภัยแยกต่างหาก ถ้าทำหายโค้ดเกมที่เข้ารหัสไว้ใช้ไม่ได้อีก
- ตั้งเวลาอัตโนมัติ เช่น cron: `0 3 * * * cd /path/to/app && npm run backup` (Docker: `docker compose exec -T app node server/scripts/backup.js`) และคัดลอกชุดสำรองออกนอกเครื่อง (ทดสอบกู้คืนเป็นระยะ)

## Deploy ขึ้นเซิร์ฟเวอร์จริง

1. เตรียมเครื่อง (VPS) + โดเมน ชี้ DNS มาที่เครื่อง เปิดพอร์ต 80/443
2. สร้าง `.env` จริง (สุ่ม secret ใหม่ทั้งหมด — **ห้ามใช้ค่าที่เคยใช้ตอนพัฒนา**) แล้วรัน `NODE_ENV=production npm run check:env` ให้ผ่านโดยไม่มี error
3. `docker compose --profile proxy up -d --build` (หรือรันด้วย Node + nginx/Caddy ตาม `deploy/`) ตั้ง `TRUST_PROXY=1`
4. สร้างแอดมิน, เพิ่มเกม, นำเข้าโค้ดเกมจริง (CSV) ผ่านหลังบ้าน
5. ตั้ง Stripe webhook ที่โดเมนจริง แล้ว **ทดสอบซื้อจริงด้วยยอดต่ำสุดและคืนเงิน** ก่อนเปิดให้ลูกค้า
6. ทำตาม [`docs/CHECKLIST.md`](docs/CHECKLIST.md) ให้ครบ (รวมการตรวจทางกฎหมาย/บัญชี)

## ความปลอดภัยที่ทำไว้

CSP เข้ม (สคริปต์/สไตล์จากโดเมนตัวเองเท่านั้น ไม่มี inline) · HSTS, `nosniff`, Referrer-Policy, Permissions-Policy, `frame-ancestors 'none'` · คุกกี้ httpOnly + SameSite (+Secure ใน production) · CSRF แบบ double-submit · rate limit · รหัสผ่าน bcrypt · โค้ดเกมเข้ารหัส AES-256-GCM, เปิดดูต้องเป็น admin และบันทึก audit · อัปโหลดรูปตรวจ magic bytes + แปลงใหม่เป็น WebP · CSV กัน formula injection · log ไม่เก็บ query/cookie/body · `npm audit --omit=dev` ไม่พบช่องโหว่ (devDependencies มี moderate 3 รายการจากเครื่องมือ load test `autocannon` ซึ่งไม่ถูกติดตั้งใน production/Docker)

## แก้ปัญหาที่พบบ่อย

| อาการ | สาเหตุ/วิธีแก้ |
|---|---|
| production ไม่ยอมเริ่ม | อ่านข้อความ error — ระบุชื่อตัวแปรที่ผิด; รัน `npm run check:env` |
| ลูกค้าจ่ายแล้วแต่ออเดอร์ยัง pending | webhook ไม่ถึง: ตรวจ endpoint/`STRIPE_WEBHOOK_SECRET`/event ที่เลือก ใน Stripe Dashboard → Webhooks → ดู delivery log |
| ลิงก์ในอีเมลเป็น localhost | `APP_URL` ผิด |
| ทุกคนมี IP เดียวกัน / ติด rate limit รวม | ลืมตั้ง `TRUST_PROXY=1` เมื่ออยู่หลัง proxy |
| รูป OG เป็นตัวอักษรเป็นกล่อง ☐ | เซิร์ฟเวอร์ไม่มีฟอนต์ไทย (Docker image ติดตั้ง `fonts-thai-tlwg` ให้แล้ว) |
| หน้าเว็บเก่าค้างหลังอัปเดต | ไฟล์ JS/CSS มี hash ในชื่อ; HTML ไม่ถูกแคชนาน — ลอง hard refresh / ตรวจ CDN |

เอกสารเพิ่มเติม: [`docs/API.md`](docs/API.md) · [`docs/CHECKLIST.md`](docs/CHECKLIST.md) · [`CHANGELOG.md`](CHANGELOG.md)
