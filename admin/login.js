// หน้าเข้าสู่ระบบแอดมิน (แยกจากการล็อกอินของลูกค้า — ใช้คุกกี้ admin_token อายุ 2 ชั่วโมง)
const form = document.getElementById('form');
const msg = document.getElementById('msg');
const csrf = () => (document.cookie.split('; ').find((c) => c.startsWith('csrf=')) || '').slice(5);

async function ensureCsrf() { if (!csrf()) await fetch('/api/health'); }

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  msg.textContent = '';
  const btn = form.querySelector('button');
  btn.disabled = true;
  try {
    await ensureCsrf();
    const r = await fetch('/api/admin/auth/login', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf() },
      body: JSON.stringify({ email: form.email.value, password: form.password.value }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'เข้าสู่ระบบไม่สำเร็จ');
    location.href = '/admin/';
  } catch (err) {
    msg.textContent = err.message;
    btn.disabled = false;
  }
});
