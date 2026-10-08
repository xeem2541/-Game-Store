import { pathToFileURL } from 'node:url';
import { createApp } from './app.js';
import { config } from './config.js';
import { db } from './db/index.js';
import { seedIfEmpty } from './db/seed.js';
import { isEmailQueueBusy, processEmailQueue } from './services/emailQueue.js';
import { expirePending } from './services/orders.js';

// เริ่มเซิร์ฟเวอร์ + งานเบื้องหลัง คืน { server, stop } — stop() ปิดทุกอย่างอย่างเรียบร้อย (ใช้กับสัญญาณ SIGTERM/SIGINT และเทส)
export function start({ port = config.port } = {}) {
  seedIfEmpty(); // production: ไม่ seed อะไรเลย (ดู db/seed.js)
  const server = createApp().listen(port);
  server.once('listening', () => console.log(`Geme Store running at ${config.appUrl} (port ${server.address().port})`));

  const timers = [
    // ยกเลิกออเดอร์ pending ที่หมดเวลา ทุก 1 นาที
    setInterval(() => { try { const n = expirePending(); if (n) console.log(`หมดอายุ ${n} ออเดอร์`); } catch (e) { console.error(e.stack ?? e); } }, 60_000),
    // คิวอีเมล: ส่งงานที่ค้าง/ถึงเวลา retry ทุก 15 วินาที
    setInterval(() => { processEmailQueue().catch((e) => console.error('email queue:', e.message)); }, 15_000),
  ];
  timers.forEach((t) => t.unref());

  let stopping = null;
  const stop = () => {
    stopping ??= (async () => {
      timers.forEach(clearInterval); // หยุดงานตั้งเวลาก่อน ไม่รับงานใหม่
      // หยุดรับ connection ใหม่ แล้วรอคำขอที่กำลังทำอยู่ให้จบ (connection ที่ว่างอยู่ปิดทันที)
      await new Promise((resolve) => { server.close(() => resolve()); server.closeIdleConnections(); setTimeout(() => { server.closeAllConnections(); resolve(); }, 8000).unref(); });
      for (let i = 0; i < 50 && isEmailQueueBusy(); i += 1) await new Promise((r) => setTimeout(r, 100)); // รอการส่งอีเมลที่ค้างอยู่
      try { db.pragma('wal_checkpoint(TRUNCATE)'); db.close(); } catch (e) { console.error('ปิดฐานข้อมูลไม่สำเร็จ:', e.message); }
    })();
    return stopping;
  };
  return { server, stop };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = start();
  const shutdown = (signal) => {
    console.log(`ได้รับสัญญาณ ${signal} — กำลังปิดระบบอย่างเรียบร้อย...`);
    setTimeout(() => { console.error('ปิดระบบไม่ทันเวลา บังคับออก'); process.exit(1); }, 10_000).unref();
    app.stop().then(() => { console.log('ปิดระบบเรียบร้อย'); process.exit(0); }, (e) => { console.error(e); process.exit(1); });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e?.stack ?? e));
}
