import nodemailer from 'nodemailer';
import { config } from '../config.js';

// เก็บอีเมลที่ "ส่ง" ไว้ในหน่วยความจำเมื่อรันเทส
export const outbox = [];

const transporter = config.smtp.host
  ? nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    })
  : null;

// เทส: สั่งให้การส่ง n ครั้งถัดไปล้มเหลว (ไว้ทดสอบ retry)
let testFailures = 0;
export const failNextMails = (n) => { testFailures = n; };

// devLog = เนื้อหาเวอร์ชันปิดบังข้อมูลลับ ใช้พิมพ์ลง console แทน text (เช่น โค้ดเกม)
// strict = true → โยน error เมื่อส่งไม่สำเร็จ (ให้คิวอีเมลนำไป retry) ปกติจะกลืน error เพื่อไม่ให้คำขอหลักพัง
export async function sendMail({ to, subject, text, html, devLog }, { strict = false } = {}) {
  if (config.env === 'test') {
    if (testFailures > 0) {
      testFailures -= 1;
      if (strict) throw new Error('simulated SMTP failure');
      return;
    }
    outbox.push({ to, subject, text });
    return;
  }
  if (!transporter && config.isProd) {
    // production ที่ยังไม่ตั้ง SMTP: ห้ามพิมพ์เนื้อหาอีเมล (มีลิงก์โทเคน/โค้ดเกม) ลง log — บันทึกแค่ว่าไม่ได้ส่ง
    console.warn(`ไม่ได้ส่งอีเมล "${subject}" ถึง ${to}: ยังไม่ได้ตั้งค่า SMTP`);
    if (strict) throw new Error('SMTP not configured');
    return;
  }
  if (!transporter) {
    // โหมด dev: ไม่มี SMTP → พิมพ์ลง console
    console.log(`\n📧 [DEV MAIL] to=${to}\n   subject: ${subject}\n   ${(devLog ?? text).replace(/\n/g, '\n   ')}\n`);
    return;
  }
  try {
    await transporter.sendMail({ from: config.smtp.from, to, subject, text, html });
  } catch (err) {
    console.error('ส่งอีเมลไม่สำเร็จ:', err.message);
    if (strict) throw err;
  }
}
