// ส่วนควบคุมช่องรหัสผ่านที่ใช้ร่วมกัน (หน้าสมัคร/ตั้งรหัสใหม่/เปลี่ยนรหัสในบัญชี): ปุ่มแสดง-ซ่อน + ตัววัดความแข็งแรง
import { t } from './common.js';
import { passwordStrength } from './password-strength.js';

export function bindPasswordToggles(root) {
  root.querySelectorAll('.pw-toggle').forEach((btn) => {
    const input = btn.closest('.pw-wrap').querySelector('input');
    btn.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-pressed', String(show));
      btn.setAttribute('aria-label', t(show ? 'auth.hidePassword' : 'auth.showPassword'));
      btn.querySelector('use').setAttribute('href', `/icons.svg#icon-${show ? 'eye-off' : 'eye'}`);
      input.focus();
    });
  });
}

// ช่องรหัสผ่านใหม่ชื่อ "password" หรือ "next"; อีเมล/ชื่อ (ถ้ามีในฟอร์ม) ใช้ตรวจว่ารหัสเดาง่ายไหม
export function bindStrengthMeter(form, meter, hint, { field = 'password', baseHint = 'auth.passwordHint', email = '', name = '' } = {}) {
  const pw = form.elements[field];
  const LEVELS = ['', 'pw.level1', 'pw.level2', 'pw.level3', 'pw.level4']; // เขียนเต็มให้ตัวตรวจคำแปล (tests/security.test.js) เห็น
  let last = '';
  const update = () => {
    const { level, tip } = passwordStrength(pw.value, { email: form.elements.email?.value ?? email, name: form.elements.name?.value ?? name });
    meter.dataset.level = String(level);
    // ข้อความ: ระดับ + คำแนะนำ (screen reader อ่านเมื่อเปลี่ยนเท่านั้น ไม่อ่านทุกตัวอักษร)
    const text = level ? `${t(LEVELS[level])} — ${t(tip)}` : t(baseHint);
    if (text !== last) { hint.textContent = text; last = text; }
  };
  pw.addEventListener('input', update);
  form.elements.email?.addEventListener('input', () => pw.value && update()); // form.name คือชื่อของฟอร์มเอง จึงใช้ form.elements
}
