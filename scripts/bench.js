// load test แบบเบา ๆ ด้วย autocannon: เปิดเซิร์ฟเวอร์ชั่วคราว (DB ใหม่, ไฟล์จาก dist) แล้วยิงหน้า/API หลัก
// ใช้: npm run build && npm run bench   (ปรับด้วย BENCH_SECONDS, BENCH_CONNECTIONS)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import autocannon from 'autocannon';

const PORT = 3198;
const base = `http://localhost:${PORT}`;
const seconds = Number(process.env.BENCH_SECONDS || 8);
const connections = Number(process.env.BENCH_CONNECTIONS || 50);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-bench-'));

const child = spawn(process.execPath, ['server/index.js'], {
  env: {
    ...process.env, NODE_ENV: 'development', PORT: String(PORT), APP_URL: base, USE_DIST: '1', LOG_REQUESTS: '0',
    DATABASE_PATH: path.join(tmp, 'bench.db'), API_RATE_LIMIT: '10000000', AUTH_RATE_LIMIT: '1000000',
    JWT_SECRET: 'bench-jwt-secret-0123456789abcdef0123456789', KEY_ENCRYPTION_SECRET: 'bench-key-secret-0123456789abcdef0123456789',
    STRIPE_WEBHOOK_SECRET: 'whsec_bench_local', STRIPE_SECRET_KEY: '', SMTP_HOST: '',
  },
  stdio: ['ignore', 'ignore', 'inherit'],
});

async function waitReady() {
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(`${base}/healthz`)).ok) return; } catch { /* ยังไม่พร้อม */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('เซิร์ฟเวอร์ทดสอบไม่พร้อมใน 30 วินาที');
}

const targets = [
  ['หน้าแรก (HTML)', '/'],
  ['หน้าเกม (SSR + JSON-LD)', '/game/dragon-realm'],
  ['API รายการเกม', '/api/games?limit=12'],
  ['API รายละเอียดเกม', '/api/games/dragon-realm'],
  ['sitemap.xml', '/sitemap.xml'],
  ['healthz', '/healthz'],
];

try {
  await waitReady();
  console.log(`ยิง ${seconds}s × ${connections} connections ต่อเป้าหมาย (เครื่อง: ${os.cpus().length} cores)\n`);
  const rows = [];
  for (const [name, url] of targets) {
    const r = await autocannon({ url: base + url, connections, duration: seconds, headers: { 'accept-encoding': 'gzip' } });
    rows.push({
      เป้าหมาย: name, 'req/s': Math.round(r.requests.average), 'p50 ms': r.latency.p50, 'p99 ms': r.latency.p99,
      'non-2xx': r.non2xx, errors: r.errors + r.timeouts,
    });
  }
  console.table(rows);
  const bad = rows.filter((x) => x['non-2xx'] || x.errors);
  if (bad.length) { console.error('พบ error/non-2xx ในบางเป้าหมาย'); process.exitCode = 1; }
} finally {
  const closed = new Promise((r) => child.once('exit', r));
  child.kill();
  await closed;
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows อาจล็อกไฟล์ชั่วคราว ลบไม่ได้ก็ไม่เป็นไร */ }
}
