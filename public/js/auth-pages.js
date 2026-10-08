import { api, mergeLocalCart, $, t, user } from './common.js';

const page = document.body.dataset.page;
const params = new URLSearchParams(location.search);
const msg = $('#msg');
const form = $('#form');

// เฉพาะ path ภายในเว็บเท่านั้น กัน open redirect
const safeNext = () => {
  const n = params.get('next') || '/profile';
  return n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') ? n : '/profile';
};

// ล็อกอินแล้วไม่ต้องเข้าหน้าเหล่านี้อีก (ยกเว้น verify/reset ที่เปิดจากลิงก์อีเมล)
if (user && (page === 'login' || page === 'register' || page === 'forgot')) location.replace(safeNext());

function setMsg(text, ok = false) {
  msg.textContent = text;
  msg.classList.toggle('ok', ok);
}

async function afterAuth() {
  await mergeLocalCart().catch(() => {});
  location.href = safeNext();
}

const handlers = {
  async login(d) {
    await api('/auth/login', { method: 'POST', body: d });
    await afterAuth();
  },
  async register(d) {
    if (d.password.length < 8) throw new Error(t('auth.shortPassword'));
    await api('/auth/register', { method: 'POST', body: d });
    await afterAuth();
  },
  async forgot(d) {
    await api('/auth/forgot', { method: 'POST', body: d });
    form.reset();
    setMsg(t('auth.forgotDone'), true);
  },
  async reset(d) {
    if (d.password.length < 8) throw new Error(t('auth.shortPassword'));
    await api('/auth/reset', { method: 'POST', body: { token: params.get('token') ?? '', password: d.password } });
    setMsg(t('auth.resetDone'), true);
    setTimeout(() => (location.href = '/login'), 1500);
  },
};

if (page === 'verify') {
  const token = params.get('token');
  try {
    if (!token) throw new Error(t('auth.verifyFail'));
    await api('/auth/verify?token=' + encodeURIComponent(token));
    setMsg(t('auth.verifyOk'), true);
  } catch (e) {
    setMsg(e.message || t('auth.verifyFail'));
  }
} else {
  if (page === 'reset' && !params.get('token')) { setMsg(t('auth.resetNoToken')); form.querySelector('button').disabled = true; }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    setMsg(t('auth.working'), true);
    try {
      await handlers[page](Object.fromEntries(new FormData(form)));
    } catch (err) {
      setMsg(err.message || t('common.error'));
    } finally {
      btn.disabled = false;
    }
  });
}
