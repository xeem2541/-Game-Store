// ตัวช่วยกลางของหน้าแอดมิน: API, escape, รูปแบบข้อมูล, toast, modal, ตาราง, แบ่งหน้า
// ข้อมูลที่ผู้ใช้กรอก (ชื่อ ข้อความรีวิว ฯลฯ) ต้องผ่าน esc() ทุกครั้งก่อนใส่ลง HTML
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// เงินจากเซิร์ฟเวอร์เป็นสตางค์ (จำนวนเต็ม) → แสดงเป็นบาท
export const money = (s) => '฿' + (Number(s || 0) / 100).toLocaleString('th-TH', { minimumFractionDigits: Number(s) % 100 ? 2 : 0, maximumFractionDigits: 2 });
export const toSatang = (bahtText) => Math.round(parseFloat(String(bahtText).replace(/,/g, '')) * 100);
export const bahtInput = (satang) => (satang / 100).toFixed(2);
export const dt = (v) => (v ? new Date(typeof v === 'number' ? v : String(v).replace(' ', 'T') + 'Z').toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '-');
export const qs = (obj) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(obj)) if (v !== '' && v !== null && v !== undefined) p.set(k, v); const s = p.toString(); return s ? '?' + s : ''; };

export const STATUS_TH = { pending: 'รอชำระ', paid: 'ชำระแล้ว', cancelled: 'ยกเลิก', refunded: 'คืนเงินแล้ว', active: 'ใช้งาน', suspended: 'ถูกระงับ', hidden: 'ซ่อน', available: 'ว่าง', reserved: 'ถูกจอง', sold: 'ขายแล้ว', revoked: 'เพิกถอน', failed: 'ล้มเหลว', created: 'สร้างแล้ว', succeeded: 'สำเร็จ', expired: 'หมดอายุ', needs_review: 'ต้องตรวจสอบ' };
export const badge = (v, label) => `<span class="badge ${esc(v)}">${esc(label ?? STATUS_TH[v] ?? v)}</span>`;

export const state = { me: null, perms: [] };
const csrf = () => (document.cookie.split('; ').find((c) => c.startsWith('csrf=')) || '').slice(5);

// body = object (JSON) หรือ FormData (อัปโหลดไฟล์)
export async function api(path, { method = 'GET', body } = {}) {
  if (method !== 'GET' && !csrf()) await fetch('/api/health');
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (method !== 'GET') opts.headers['x-csrf-token'] = csrf();
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch('/api/admin' + path, opts);
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) { location.href = '/admin/login'; throw new Error('หมดเวลาเข้าสู่ระบบ'); }
  if (!r.ok) { const e = new Error(data.error || r.statusText); e.status = r.status; e.code = data.code; throw e; }
  return data;
}

export const can = (...roles) => roles.includes(state.me?.role);
export const isAdmin = () => state.me?.role === 'admin';
// สิทธิ์เสริมของ staff (ตั้งที่ STAFF_PERMISSIONS ใน .env) — admin มี '*' เสมอ; เซิร์ฟเวอร์ตรวจซ้ำทุก endpoint
export const hasPerm = (p) => !!state.perms && (state.perms.includes('*') || state.perms.includes(p));

// toast อยู่ในกล่อง aria-live ที่มีอยู่แล้วในหน้า (#toasts) — screen reader อ่านข้อความที่เพิ่มเข้าไปทุกครั้ง
// (เดิมสร้าง element role=status ใหม่ทุกครั้ง ซึ่ง screen reader หลายตัวไม่อ่าน และถูก CSS ของหน้าร้านซ่อนไว้)
export function toast(msg, isError = false) {
  let box = document.getElementById('toasts');
  if (!box) {
    box = Object.assign(document.createElement('div'), { id: 'toasts', className: 'toasts' });
    box.setAttribute('aria-live', 'polite');
    document.body.append(box);
  }
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' error' : '');
  el.textContent = msg;
  box.append(el);
  setTimeout(() => el.remove(), isError ? 6000 : 3000);
}

// ปุ่มแสดงสถานะกำลังทำงาน (วงหมุน + กดซ้ำไม่ได้) ระหว่างรอ fn เสร็จ
export async function busy(btn, fn) {
  if (!btn) return fn();
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  try { return await fn(); } finally { btn.disabled = false; btn.removeAttribute('aria-busy'); }
}

export const loading = (el) => { el.innerHTML = '<div class="state"><div class="spinner"></div>กำลังโหลด...</div>'; };
export const errorState = (el, e) => { el.innerHTML = `<div class="state error">เกิดข้อผิดพลาด: ${esc(e.message)}</div>`; };
export const empty = (text = 'ไม่พบข้อมูล') => `<div class="state">${esc(text)}</div>`;

// กล่องโต้ตอบ: fields = [{ name, label, type, required, value, mustEqual, options, help }] → คืนค่า object หรือ null ถ้ายกเลิก
export function dialog({ title, message = '', fields = [], confirmText = 'ยืนยัน', danger = false }) {
  return new Promise((resolve) => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    const fieldHtml = fields.map((f) => {
      const id = 'f_' + f.name;
      const input = f.type === 'textarea' ? `<textarea id="${id}" name="${esc(f.name)}" rows="3" ${f.required ? 'required' : ''}>${esc(f.value ?? '')}</textarea>`
        : f.type === 'select' ? `<select id="${id}" name="${esc(f.name)}">${f.options.map((o) => `<option value="${esc(o.value)}" ${o.value === f.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`
        : `<input id="${id}" name="${esc(f.name)}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}" ${f.required ? 'required' : ''} ${f.step ? `step="${f.step}"` : ''} autocomplete="off">`;
      return `<label class="f" for="${id}">${esc(f.label)}${input}${f.help ? `<small>${esc(f.help)}</small>` : ''}</label>`;
    }).join('');
    bg.innerHTML = `<form class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <h3>${esc(title)}</h3>${message ? `<p>${message}</p>` : ''}<div class="form-grid">${fieldHtml}</div>
      <p class="msg" role="alert"></p>
      <div class="actions"><button type="button" class="btn" data-cancel>ยกเลิก</button><button type="submit" class="btn ${danger ? 'danger' : 'primary'}">${esc(confirmText)}</button></div></form>`;
    const opener = document.activeElement;
    const close = (v) => { bg.remove(); opener?.focus?.(); resolve(v); }; // คืนโฟกัสให้ปุ่มที่เปิดกล่อง
    bg.addEventListener('click', (e) => { if (e.target === bg || e.target.dataset.cancel !== undefined) close(null); });
    // Esc ปิด, Tab วนอยู่ในกล่อง (ไม่หลุดไปเนื้อหาด้านหลัง)
    bg.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(null); return; }
      if (e.key !== 'Tab') return;
      const items = [...bg.querySelectorAll('input, select, textarea, button:not(:disabled)')];
      const [first, last] = [items[0], items[items.length - 1]];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    bg.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const vals = {};
      for (const f of fields) {
        const v = e.target.elements[f.name].value.trim();
        if (f.required && !v) { bg.querySelector('.msg').textContent = `กรุณากรอก "${f.label}"`; return; }
        if (f.mustEqual !== undefined && v !== String(f.mustEqual)) { bg.querySelector('.msg').textContent = `ข้อมูลไม่ตรง — ต้องพิมพ์ "${f.mustEqual}" เพื่อยืนยัน`; return; }
        vals[f.name] = v;
      }
      close(vals);
    });
    document.body.append(bg);
    (bg.querySelector('input, textarea, select') || bg.querySelector('button[type=submit]')).focus();
  });
}
export const confirmBox = async (title, message, confirmText = 'ยืนยัน', danger = false) => (await dialog({ title, message, confirmText, danger })) !== null;

// ตารางพร้อมสถานะ empty — cols = [{ h, f: (row) => html, cls }]
// กรอบตารางเลื่อนแนวนอนได้บนจอเล็ก → ต้องโฟกัสด้วยคีย์บอร์ดได้ (tabindex) เพื่อใช้ลูกศรเลื่อน แม้ในตารางไม่มีลิงก์
export function table(cols, rows, { rowAttr, label = 'ตารางข้อมูล' } = {}) {
  if (!rows.length) return empty();
  return `<div class="table-wrap" tabindex="0" role="region" aria-label="${esc(label)}"><table><thead><tr>${cols.map((c) => `<th class="${c.cls || ''}">${esc(c.h)}</th>`).join('')}</tr></thead><tbody>
    ${rows.map((r) => `<tr ${rowAttr ? rowAttr(r) : ''}>${cols.map((c) => `<td class="${c.cls || ''}">${c.f(r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

export function pager(info) {
  if (!info || info.pages <= 1) return '';
  return `<div class="pager"><button class="btn sm" data-page="${info.page - 1}" ${info.page <= 1 ? 'disabled' : ''}>← ก่อนหน้า</button>
    <span class="muted">หน้า ${info.page} / ${info.pages} (${info.total.toLocaleString('th-TH')} รายการ)</span>
    <button class="btn sm" data-page="${info.page + 1}" ${info.page >= info.pages ? 'disabled' : ''}>ถัดไป →</button></div>`;
}

// อ่านค่าฟอร์มกรอง → object  /  ใส่ค่าจาก object กลับเข้าฟอร์ม
export const formValues = (form) => Object.fromEntries([...new FormData(form)].map(([k, v]) => [k, String(v).trim()]));

export function setHashQuery(params) {
  const base = location.hash.split('?')[0];
  history.replaceState(null, '', base + qs(params));
}
export const hashParams = () => Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''));
