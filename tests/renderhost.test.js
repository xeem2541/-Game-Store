import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderHostLearner } from '../server/services/renderHost.js';

const quiet = () => {};
const run = (mw, host) => new Promise((resolve) => mw({ headers: { host } }, {}, resolve));

test('Render ไม่ได้ตั้ง APP_URL: ใช้โดเมนจริงจากคำขอแรกที่มาทาง *.onrender.com (RENDER_EXTERNAL_URL อาจเป็นชื่อ service ที่ไม่ใช่ของเรา)', async () => {
  const cfg = { appUrl: 'https://game-store.onrender.com', corsOrigins: ['https://game-store.onrender.com'] };
  const mw = renderHostLearner(cfg, { RENDER: 'true', RENDER_EXTERNAL_URL: cfg.appUrl }, quiet);
  await run(mw, '10.0.0.5:10000'); // health check ภายใน → ไม่นับ
  assert.equal(cfg.appUrl, 'https://game-store.onrender.com');
  await run(mw, 'Game-Store-4944.onrender.com');
  assert.equal(cfg.appUrl, 'https://game-store-4944.onrender.com');
  assert.deepEqual(cfg.corsOrigins, ['https://game-store-4944.onrender.com']);
  await run(mw, 'other-service.onrender.com'); // เรียนรู้ครั้งเดียว ไม่เปลี่ยนอีก
  assert.equal(cfg.appUrl, 'https://game-store-4944.onrender.com');
});

test('ตั้ง APP_URL/BASE_URL เอง หรือไม่ได้อยู่บน Render: ไม่ใช้ Host ของคำขอเลย', async () => {
  assert.equal(renderHostLearner({}, { RENDER: 'true', APP_URL: 'https://shop.example.com' }, quiet), null);
  assert.equal(renderHostLearner({}, { RENDER: 'true', BASE_URL: 'https://shop.example.com' }, quiet), null);
  assert.equal(renderHostLearner({}, {}, quiet), null);
  const cfg = { appUrl: 'https://a.onrender.com', corsOrigins: ['https://x.example'] };
  const mw = renderHostLearner(cfg, { RENDER: 'true', CORS_ORIGINS: 'https://x.example' }, quiet);
  await run(mw, 'evil.example.com'); // ไม่ใช่ *.onrender.com
  assert.equal(cfg.appUrl, 'https://a.onrender.com');
  await run(mw, 'b.onrender.com');
  assert.equal(cfg.appUrl, 'https://b.onrender.com');
  assert.deepEqual(cfg.corsOrigins, ['https://x.example'], 'ตั้ง CORS_ORIGINS เองไว้ → ไม่แตะ');
});
