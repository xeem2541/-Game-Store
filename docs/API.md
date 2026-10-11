# API — Game Store

เอกสารนี้สรุป endpoint ทั้งหมดที่มีในโค้ด (ตรวจจาก `server/routes/**`) พร้อมสิทธิ์ที่ต้องใช้

## ข้อตกลงทั่วไป

| เรื่อง | รายละเอียด |
|---|---|
| รูปแบบ | JSON (`Content-Type: application/json`) ยกเว้นอัปโหลดไฟล์ (`multipart/form-data`), ใบเสร็จ (`application/pdf`) และรายงาน (`text/csv`) |
| เงิน | จำนวนเต็ม **สตางค์** เสมอ (฿1,290.00 = `129000`) สกุลเงิน THB — ราคาคำนวณฝั่งเซิร์ฟเวอร์เท่านั้น |
| ลูกค้าล็อกอิน | คุกกี้ `token` (httpOnly, 7 วัน) |
| แอดมิน/staff ล็อกอิน | คุกกี้ `admin_token` แยกต่างหาก (httpOnly, SameSite=Strict, 2 ชั่วโมง) ผ่าน `POST /api/admin/auth/login` |
| CSRF | ทุกคำขอที่ไม่ใช่ GET/HEAD/OPTIONS ต้องส่ง header `X-CSRF-Token` เท่ากับค่าคุกกี้ `csrf` (ได้คุกกี้นี้จากการ `GET /api/health` ครั้งแรก) ยกเว้น webhook ของ Stripe |
| Rate limit | `/api/*` จำกัดต่อ IP (`API_RATE_LIMIT`, ค่าเริ่มต้น 300/นาที); login/register/forgot/reset จำกัดเข้มกว่า (`AUTH_RATE_LIMIT`) → `429` |
| ข้อผิดพลาด | `{ "error": "ข้อความภาษาไทย", "code": "CODE_ที่อ่านด้วยเครื่องได้" }` (บาง endpoint มี `fields` สำหรับ validation) |
| รหัสสถานะ | `400/422` ข้อมูลไม่ถูกต้อง · `401` ยังไม่ล็อกอิน · `403` สิทธิ์ไม่พอ/CSRF ผิด · `404` ไม่พบ · `409` สถานะไม่ถูกต้อง/ซ้ำ · `429` ถี่เกินไป · `503` ระบบชำระเงินยังไม่เปิดใช้ |

**สัญลักษณ์สิทธิ์:** 🌐 ใครก็ได้ · 👤 ลูกค้าที่ล็อกอิน · ✅ ลูกค้าที่ยืนยันอีเมลแล้ว · 🛠 staff หรือ admin · 🔑 staff ที่ได้รับสิทธิ์เสริมใน `STAFF_PERMISSIONS` (หรือ admin) · 👑 admin เท่านั้น

## ระบบ

| Method | Path | สิทธิ์ | หมายเหตุ |
|---|---|---|---|
| GET | `/healthz` | 🌐 | ตรวจสุขภาพ (ทดสอบ DB) → `{status:"ok",uptime}` หรือ `503` — ใช้กับ Docker/load balancer |
| GET | `/api/health` | 🌐 | `{ok:true}` และตั้งคุกกี้ CSRF |
| GET | `/api/config` | 🌐 | ค่าสาธารณะที่หน้าเว็บต้องใช้ (เช่น เปิดโหมดจำลองชำระเงินหรือไม่) |
| POST | `/api/webhooks/stripe` | 🌐 (ยืนยันด้วยลายเซ็น `Stripe-Signature`) | **ช่องทางเดียวที่ยืนยันการชำระเงิน** — body ดิบ, ไม่ผ่าน CSRF; ซ้ำ/ผิดลายเซ็นถูกปฏิเสธ |

## บัญชีผู้ใช้ — `/api/auth`

| Method | Path | สิทธิ์ | หมายเหตุ |
|---|---|---|---|
| POST | `/register` | 🌐 | `{email,password,name}` → `201` + ล็อกอิน + ส่งอีเมลยืนยัน |
| POST | `/login` | 🌐 | `{email,password}` |
| POST | `/logout` | 🌐 | ล้างคุกกี้ (เฉพาะเครื่องนี้) |
| POST | `/logout-all` | 👤 | ออกจากระบบทุกอุปกรณ์ — เพิกถอน token ทุกตัวของผู้ใช้ (รวมเซสชันแอดมิน) |
| GET | `/me` | 🌐 | `{user}` หรือ `{user:null}` |
| GET | `/verify?token=` | 🌐 | ยืนยันอีเมล |
| POST | `/resend` | 👤 | ส่งอีเมลยืนยันอีกครั้ง |
| POST | `/forgot` | 🌐 | `{email}` — ตอบเหมือนกันเสมอ (ไม่เปิดเผยว่ามีบัญชีหรือไม่) |
| POST | `/reset` | 🌐 | `{token,password}` |

## โปรไฟล์ — `/api/me` (👤)

| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/api/me` | ข้อมูลของฉัน |
| PUT | `/api/me` | แก้ `{name, email}` — เปลี่ยนอีเมลแล้วต้องยืนยันใหม่ |
| POST | `/api/me/password` | เปลี่ยนรหัสผ่าน (ต้องส่งรหัสเดิม) |
| GET | `/api/me/orders` | ประวัติสั่งซื้อ |
| GET | `/api/me/library` | คลังเกม (โค้ดที่ซื้อแล้ว, ซ่อนบางส่วนจนกว่าจะกดแสดง) |

## เกม — `/api/games` (🌐)

| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/api/games` | รายการ + ค้นหา/กรอง/เรียง/แบ่งหน้า (`q, genre, platform, minPrice, maxPrice, onSale, featured, sort, page, limit`; sort เช่น `rating, discount, newest, bestseller`) |
| GET | `/api/games/suggest?q=` | คำแนะนำค้นหา |
| GET | `/api/games/facets` | ตัวเลือกตัวกรอง (หมวด/แพลตฟอร์ม) |
| GET | `/api/games/home` | ชุดข้อมูลหน้าแรก (แนะนำ/ขายดี/ใหม่) |
| GET | `/api/games/:slug` | รายละเอียดเกม |
| GET | `/api/games/:slug/cover.svg` | รูปปก (redirect ไปรูปที่อัปโหลดถ้ามี; `?size=sm` = ภาพย่อ) |

### รีวิว — `/api/games/:id/reviews`
| Method | Path | สิทธิ์ | หมายเหตุ |
|---|---|---|---|
| GET | `/` | 🌐 | รายการรีวิว + สรุปคะแนน |
| POST | `/` | 👤 | เขียนรีวิว `{rating 1-5, body}` · 1 คน 1 รีวิวต่อเกม (ซ้ำ → `409`) — *ไม่ได้จำกัดเฉพาะผู้ที่เคยซื้อ* |
| PUT | `/` | 👤 | แก้รีวิวของตัวเอง |
| DELETE | `/` | 👤 | ลบรีวิวของตัวเอง |

## รายการโปรด — `/api/wishlist` (👤)
`GET /` · `POST /` `{gameId}` · `DELETE /:gameId`

## ตะกร้า/คูปอง (👤)
| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/api/cart` | รายการในตะกร้า |
| GET | `/api/cart/summary` | สรุปราคา (คำนวณใหม่ฝั่งเซิร์ฟเวอร์), รับ `?coupon=` · `unavailable` = เกมในตะกร้าที่หยุดขายแล้ว (ไม่นับในยอด) |
| PUT | `/api/cart` | แทนที่ตะกร้าทั้งหมด `{slugs:[...]}` |
| POST | `/api/coupons/validate` | `{code}` → ส่วนลดที่จะได้ (ไม่ใช้สิทธิ์จริงจนกว่าจะสั่งซื้อ) |

## ออเดอร์ — `/api/orders`
| Method | Path | สิทธิ์ | หมายเหตุ |
|---|---|---|---|
| POST | `/` | ✅ | สร้างออเดอร์จากตะกร้า `{idempotencyKey, couponCode?}` — จองโค้ดเกมทันที, กดซ้ำด้วย key เดิมได้ออเดอร์เดิม |
| GET | `/:id` | 👤 เจ้าของ | รายละเอียด (โค้ดแสดงเมื่อ `paid` เท่านั้น) |
| POST | `/:id/cancel` | 👤 เจ้าของ | ยกเลิกเฉพาะ `pending` |
| POST | `/:id/pay` | 👤 เจ้าของ | สร้าง Stripe Checkout Session → `{url}` (ไม่ได้ยืนยันการจ่าย) · `503` ถ้ายังไม่ตั้ง Stripe |
| GET | `/:id/receipt.pdf` | 👤 เจ้าของ | ใบเสร็จ/ใบกำกับภาษีอย่างย่อ (เฉพาะ `paid`) |
| POST | `/:id/resend-email` | 👤 เจ้าของ | ส่งอีเมลยืนยันคำสั่งซื้อซ้ำ (จำกัดความถี่) |
| POST | `/:id/dev-pay` | 👤 เจ้าของ | **จำลอง**การชำระเงิน — มีเฉพาะนอก production (production ตอบ `404`) |

สถานะออเดอร์: `pending → paid | cancelled`, `paid → refunded` (ย้อนกลับไม่ได้)

## หลังบ้าน — `/api/admin` (คุกกี้ `admin_token`)

| Method | Path | สิทธิ์ | หมายเหตุ |
|---|---|---|---|
| POST | `/auth/login` | 🌐 (จำกัดความถี่) | เฉพาะบัญชี role `staff`/`admin` ที่ active |
| POST | `/auth/logout` | 🌐 | |
| GET | `/auth/me` | 🛠 | ข้อมูล + รายการสิทธิ์ (`permissions`) |
| GET | `/dashboard` · `/dashboard/sales` | 🛠 | สถิติ/กราฟ/การแจ้งเตือน |
| POST | `/dashboard/alerts/:id/resolve` | 🛠 | ปิดการแจ้งเตือน |
| GET | `/orders` · `/orders/:id` | 🛠 | ค้นหา/กรอง/แบ่งหน้า (โค้ดเกมถูกซ่อน) |
| POST | `/orders/:id/cancel` | 🛠 | ยกเลิกเฉพาะ `pending` |
| POST | `/orders/:id/resend-email` | 🛠 | |
| POST | `/orders/:id/refund` | 👑 | `{reason, confirmOrderId}` — ต้องพิมพ์เลขออเดอร์ยืนยัน; เรียก Stripe refund จริง → โค้ดถูกเพิกถอน, คืนสิทธิ์คูปอง |
| GET | `/reviews` · DELETE `/reviews/:id` | 🛠 | ลบรีวิวที่ไม่เหมาะสม |
| GET | `/reports/orders.csv` · `sales.csv` · `games-sales.csv` · `stock.csv` | 🛠 | CSV (UTF-8 BOM, กัน CSV injection) |
| GET | `/reports/new-users.csv` | 🔑 `reports.users` | |
| GET | `/games` · `/games/:id` | 🛠 | รวมเกมที่ซ่อน |
| POST/PUT/DELETE | `/games`, `/games/:id` | 🔑 `games.write` | |
| POST | `/games/:id/images?kind=cover\|screenshot` | 🔑 `games.write` | multipart `file` — ตรวจ magic bytes, แปลงเป็น WebP + ภาพย่อ |
| DELETE | `/games/:id/cover` · `/games/:id/images/:imageId` | 🔑 `games.write` | |
| GET | `/stock` · `/stock/:gameId/keys` | 🛠 | จำนวนคงเหลือ/สถานะโค้ด (แสดงแบบ mask) |
| PUT | `/stock/:gameId/threshold` | 🔑 `stock.write` | เกณฑ์เตือนสต็อกต่ำ |
| POST | `/stock/:gameId/import` | 🔑 `stock.write` | CSV (≤1 MB) — เข้ารหัส AES-256-GCM, ข้ามโค้ดซ้ำ |
| POST | `/stock/keys/:keyId/revoke` | 🔑 `stock.write` | เพิกถอนโค้ด (บันทึกเหตุผล) |
| POST | `/stock/keys/:keyId/reveal` | 👑 | เปิดดูโค้ดเต็ม — บันทึก audit ทุกครั้ง |
| GET | `/coupons` · POST `/coupons` · PUT `/coupons/:id` | 🔑 `coupons.manage` | |
| GET | `/users` · `/users/:id` | 👑 | |
| PUT | `/users/:id/status` · `/users/:id/role` | 👑 | ระงับ/เปิดบัญชี, เปลี่ยนบทบาท (กันลดสิทธิ์ admin คนสุดท้าย) |
| GET | `/audit` | 👑 | บันทึกการกระทำของแอดมิน |

> สิทธิ์เริ่มต้นของ staff = อ่านอย่างเดียว + ยกเลิก/ส่งอีเมลซ้ำของออเดอร์ที่ยังไม่จ่าย — เพิ่มได้ด้วย `STAFF_PERMISSIONS` ใน `.env` (ดู README) แต่ **คืนเงิน, เปิดดูโค้ดเต็ม, จัดการผู้ใช้, audit log เป็นของ admin เท่านั้นเสมอ**

## หน้าเว็บ/ไฟล์สาธารณะ (ไม่ใช่ API)

| Path | หมายเหตุ |
|---|---|
| `/`, `/games`, `/game/:slug`, `/cart`, `/checkout`, `/order/:id`, `/profile`, `/login`, `/register`, … | หน้าร้าน (หน้าเกมเรนเดอร์ meta + JSON-LD ฝั่งเซิร์ฟเวอร์) |
| `/sitemap.xml`, `/robots.txt` | สร้างอัตโนมัติจากฐานข้อมูล (ใช้ `APP_URL`) |
| `/og/:slug.png` | รูป Open Graph ของเกม (PNG 1200×630) |
| `/uploads/games/:file` | รูปที่แอดมินอัปโหลด (ชื่อไฟล์สุ่ม, WebP เท่านั้น) |
| `/admin/` | หลังบ้าน (ต้องมีคุกกี้ `admin_token`; ไม่ล็อกอิน → หน้า login) |
