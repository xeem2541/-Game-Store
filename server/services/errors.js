// error ที่มี HTTP status และ code (ให้หน้าเว็บแปลข้อความตามภาษาได้) — จัดการใน error handler ของ app.js
export class HttpError extends Error {
  constructor(status, message, code, params) {
    super(message);
    this.status = status;
    this.code = code;
    this.params = params;
  }
}
