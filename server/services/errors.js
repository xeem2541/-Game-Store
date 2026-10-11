import { z } from 'zod';

// ข้อความ error เริ่มต้นของ zod (ภาษาอังกฤษ) ไม่แสดงให้ผู้ใช้ — schema ที่ระบุข้อความเองยังใช้ข้อความนั้นตามเดิม
z.config({ customError: () => 'ข้อมูลไม่ถูกต้อง' });

// error ที่มี HTTP status และ code (ให้หน้าเว็บแปลข้อความตามภาษาได้) — จัดการใน error handler ของ app.js
export class HttpError extends Error {
  constructor(status, message, code, params) {
    super(message);
    this.status = status;
    this.code = code;
    this.params = params;
  }
}
