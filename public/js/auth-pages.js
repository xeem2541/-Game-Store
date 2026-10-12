import { api, mergeLocalCart, $, t, user } from './common.js';
import { bindPasswordToggles, bindStrengthMeter } from './password-ui.js';

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

// ---- ฝั่งภาพ (แบ่งครึ่งจอ): ปกเกมขายดี 3 เกมซ้อนกัน — ตกแต่งเท่านั้น โหลดไม่ได้ก็เห็นพื้นหลังไล่สีตามเดิม ----
api('/games?sort=bestseller&limit=3').then(({ items }) => {
  document.querySelectorAll('.aa-card').forEach((el, i) => {
    if (!items[i]) return;
    el.style.backgroundImage = `url("${items[i].cover}")`;
    el.classList.add('is-in');
  });
}).catch(() => {});

// แท็บ เข้าสู่ระบบ/สมัคร: พา ?next= ไปด้วย (สมัครเสร็จแล้วกลับไปหน้าที่ตั้งใจไว้)
if (params.get('next')) {
  document.querySelectorAll('.auth-tabs a').forEach((a) => a.setAttribute('href', `${a.getAttribute('href').split('?')[0]}?next=${encodeURIComponent(params.get('next'))}`));
}

// ---- แสดง/ซ่อนรหัสผ่าน + ตัววัดความแข็งแรง (สมัคร / ตั้งรหัสใหม่) ----
bindPasswordToggles(document);
const meter = $('.pw-meter');
if (meter) bindStrengthMeter(form, meter, $('#pwHint'));

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
