// ระบบสองภาษา: ไฟล์แปลอยู่ที่ /i18n/th.json และ /i18n/en.json
const SUPPORTED = ['th', 'en'];

function detect() {
  try {
    const saved = localStorage.getItem('lang');
    if (SUPPORTED.includes(saved)) return saved;
  } catch {}
  return 'th';
}

export const lang = detect();
// __I18N_VERSION__ ถูกฝังตอน build (ใช้เป็น cache-buster ของไฟล์แปล) ตอนพัฒนาไม่มีค่า
const V = typeof __I18N_VERSION__ === 'undefined' ? '' : `?v=${__I18N_VERSION__}`;
const dict = await fetch(`/i18n/${lang}.json${V}`).then((r) => r.json()).catch(() => ({}));

export function t(key, vars) {
  let s = dict[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}

// ชื่อหมวดหมู่ในฐานข้อมูลเป็นภาษาไทย → ถ้ามีคำแปลใช้คำแปล
export const genreName = (g) => dict['genre.' + g] ?? g;
// ข้อความ error จากเซิร์ฟเวอร์เป็นภาษาไทย → แปลถ้ามีคำแปล
export const errText = (msg, code, params) => (code && dict['errc.' + code] ? t('errc.' + code, params) : dict['err.' + msg] ?? msg);
export const descOf = (g) => (lang === 'en' && g.description_en ? g.description_en : g.description);

export function applyI18n(root = document) {
  document.documentElement.lang = lang;
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  root.querySelectorAll('[data-i18n-label]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nLabel)); });
}

export function setLang(next) {
  try { localStorage.setItem('lang', next); } catch {}
  location.reload();
}
