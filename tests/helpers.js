// ตั้งค่าสภาพแวดล้อมเทส (ต้องทำก่อน import โค้ดเซิร์ฟเวอร์) แล้วสร้างเซิร์ฟเวอร์ชั่วคราว + client ที่จำคุกกี้ได้
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-0000';
process.env.AUTH_RATE_LIMIT = '1000';
process.env.API_RATE_LIMIT = '1000000';
process.env.SMTP_HOST = '';
process.env.STRIPE_SECRET_KEY = '';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret_for_unit_tests';
process.env.KEY_ENCRYPTION_SECRET = 'test-key-encryption-secret-0123456789abcdef';
process.env.EMAIL_RESEND_LIMIT = '5';
process.env.DEV_PAY = '1';

const { createApp } = await import('../server/app.js');
const { seedGames, seedKeys } = await import('../server/db/seed.js');
const { outbox } = await import('../server/services/mail.js');
export { outbox };

seedGames();
seedKeys(20);

export async function startServer() {
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

export class Client {
  constructor(url) { this.url = url; this.cookies = {}; }

  async req(method, path, body, headers = {}) {
    const cookie = Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    const h = { cookie, ...headers };
    if (body !== undefined) h['content-type'] = 'application/json';
    if (method !== 'GET' && this.cookies.csrf && !('x-csrf-token' in h)) h['x-csrf-token'] = this.cookies.csrf;
    const res = await fetch(this.url + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const sc of res.headers.getSetCookie()) {
      const [pair] = sc.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i);
      const val = pair.slice(i + 1);
      if (val === '' || /expires=thu, 01 jan 1970/i.test(sc)) delete this.cookies[name];
      else this.cookies[name] = val;
    }
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  }
  // อัปโหลดไฟล์แบบ multipart (ใส่คุกกี้ + CSRF header ให้)
  async upload(path, form) {
    const cookie = Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(this.url + path, { method: 'POST', headers: { cookie, 'x-csrf-token': this.cookies.csrf ?? '' }, body: form });
    return { status: res.status, data: await res.json().catch(() => null) };
  }
  // ดาวน์โหลดไฟล์ (คืน status, headers, body เป็นข้อความ)
  async raw(path) {
    const cookie = Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(this.url + path, { headers: { cookie }, redirect: 'manual' });
    return { status: res.status, headers: res.headers, buf: Buffer.from(await res.arrayBuffer()) };
  }
  get(p) { return this.req('GET', p); }
  post(p, b = {}) { return this.req('POST', p, b); }
  put(p, b = {}) { return this.req('PUT', p, b); }
  del(p) { return this.req('DELETE', p); }
  async init() { await this.get('/api/health'); return this; } // ขอคุกกี้ CSRF
}

export const tokenFrom = (mail) => mail.text.match(/token=([a-f0-9]+)/)[1];

// สร้างผู้ใช้ที่ล็อกอินแล้ว (และยืนยันอีเมลแล้วโดยค่าเริ่มต้น) — คืน Client ที่มี .email
let userCounter = 0;
export async function makeUser(url, { verify = true, prefix = 'user' } = {}) {
  const c = await new Client(url).init();
  c.email = `${prefix}${++userCounter}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const password = `pw-${Math.random().toString(36).slice(2)}-Aa1`;
  c.password = password;
  const r = await c.post('/api/auth/register', { email: c.email, password, name: `User ${userCounter}` });
  if (r.status !== 201) throw new Error('register failed: ' + JSON.stringify(r.data));
  if (verify) {
    const mail = [...outbox].reverse().find((m) => m.to === c.email);
    await c.get('/api/auth/verify?token=' + tokenFrom(mail));
  }
  return c;
}

// สร้างผู้ใช้ที่มี role (staff | admin) แล้วล็อกอินผ่านหน้าแอดมิน (คุกกี้ admin_token แยกจากคุกกี้ลูกค้า)
export async function makeAdminClient(url, role = 'admin') {
  const { db } = await import('../server/db/index.js');
  const c = await makeUser(url, { prefix: role });
  db.prepare('UPDATE users SET role = ? WHERE email = ?').run(role, c.email);
  const r = await c.post('/api/admin/auth/login', { email: c.email, password: c.password });
  if (r.status !== 200) throw new Error('admin login failed: ' + JSON.stringify(r.data));
  c.userId = r.data.user.id;
  return c;
}
