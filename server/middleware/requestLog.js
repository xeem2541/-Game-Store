import { config } from '../config.js';

// log การเข้าถึงแบบปลอดภัย: บันทึกเฉพาะ method + path (ตัด query string ทิ้ง เพราะมีโทเคนอย่าง /verify?token=...) + status + เวลา
// ไม่ log header (คุกกี้/Authorization), body (รหัสผ่าน/โค้ดเกม/ข้อมูลบัตร) หรือ IP
const SKIP = /^\/(healthz|api\/health|js\/|css\/|i18n\/|favicon)/;

export function requestLog(req, res, next) {
  if (!config.logRequests) return next();
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const path = req.originalUrl.split('?')[0];
    if (res.statusCode < 400 && SKIP.test(path)) return;
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    console.log(`${req.method} ${path} ${res.statusCode} ${ms.toFixed(0)}ms`);
  });
  next();
}
