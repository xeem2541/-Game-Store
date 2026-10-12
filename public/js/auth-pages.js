import { api, mergeLocalCart, $, t, user } from './common.js';
import { passwordStrength } from './password-strength.js';

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

// ---- แสดง/ซ่อนรหัสผ่าน ----
document.querySelectorAll('.pw-toggle').forEach((btn) => {
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

// ---- ตัววัดความแข็งแรงของรหัสผ่าน (สมัคร / ตั้งรหัสใหม่) ----
const meter = $('.pw-meter');
if (meter) {
  const pw = form.querySelector('input[name=password]');
  const hint = $('#pwHint');
  const LEVELS = ['', 'pw.level1', 'pw.level2', 'pw.level3', 'pw.level4']; // เขียนเต็มให้ตัวตรวจคำแปล (tests/security.test.js) เห็น
  let last = '';
  const update = () => {
    const { level, tip } = passwordStrength(pw.value, { email: form.elements.email?.value ?? '', name: form.elements.name?.value ?? '' });
    meter.dataset.level = String(level);
    // ข้อความ: ระดับ + คำแนะนำ (screen reader อ่านเมื่อเปลี่ยนเท่านั้น ไม่อ่านทุกตัวอักษร)
    const text = level ? `${t(LEVELS[level])} — ${t(tip)}` : t('auth.passwordHint');
    if (text !== last) { hint.textContent = text; last = text; }
  };
  pw.addEventListener('input', update);
  form.elements.email?.addEventListener('input', () => pw.value && update()); // form.name คือชื่อของฟอร์มเอง จึงใช้ form.elements
}

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
