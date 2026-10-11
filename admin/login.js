// หน้าเข้าสู่ระบบแอดมิน (แยกจากการล็อกอินของลูกค้า — ใช้คุกกี้ admin_token อายุ 2 ชั่วโมง)
// ขั้นที่ 1 รหัสผ่าน → ถ้าบัญชีเปิด 2FA แล้ว ขั้นที่ 2 รหัสจากแอป Authenticator หรือรหัสกู้คืน
const form = document.getElementById('form');
const msg = document.getElementById('msg');
const mfaForm = document.getElementById('mfaForm');
const mfaMsg = document.getElementById('mfaMsg');
const csrf = () => (document.cookie.split('; ').find((c) => c.startsWith('csrf=')) || '').slice(5);

// ปุ่มแสดงวงหมุนระหว่างรอ (admin.css: .btn[aria-busy])
const setBusy = (btn, on) => { btn.disabled = on; if (on) btn.setAttribute('aria-busy', 'true'); else btn.removeAttribute('aria-busy'); };

async function ensureCsrf() { if (!csrf()) await fetch('/api/health'); }

async function post(path, body) {
  await ensureCsrf();
  const r = await fetch(path, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrf() },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data.error || 'เข้าสู่ระบบไม่สำเร็จ'); e.code = data.code; throw e; }
  return data;
}

function showStep(mfa) {
  form.hidden = mfa;
  mfaForm.hidden = !mfa;
  (mfa ? mfaForm.code : form.email).focus();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  msg.textContent = '';
  const btn = form.querySelector('button');
  setBusy(btn, true);
  try {
    const data = await post('/api/admin/auth/login', { email: form.email.value, password: form.password.value });
    if (data.mfaRequired) { form.password.value = ''; setBusy(btn, false); showStep(true); return; }
    location.href = '/admin/'; // ยังไม่ได้ตั้ง 2FA → หน้าแอดมินจะพาไปตั้งค่า
  } catch (err) {
    msg.textContent = err.message;
    setBusy(btn, false);
  }
});

mfaForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  mfaMsg.textContent = '';
  const btn = mfaForm.querySelector('button[type=submit]');
  setBusy(btn, true);
  try {
    const data = await post('/api/admin/auth/mfa/verify', { code: mfaForm.code.value });
    if (data.recoveryCodesLeft <= 2) {
      try { sessionStorage.setItem('mfaWarn', String(data.recoveryCodesLeft)); } catch { /* ไม่สำคัญ */ }
    }
    location.href = '/admin/';
  } catch (err) {
    mfaMsg.textContent = err.message;
    mfaForm.code.select();
    setBusy(btn, false);
    if (err.code === 'MFA_SESSION_EXPIRED') showStep(false);
  }
});

document.getElementById('mfaBack').addEventListener('click', () => { mfaForm.code.value = ''; mfaMsg.textContent = ''; showStep(false); });
