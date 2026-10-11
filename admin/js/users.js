import { $, api, badge, dialog, dt, errorState, esc, formValues, hashParams, loading, money, pager, qs, setHashQuery, state, table, toast } from './core.js';

export async function render(el, rest, alive) {
  return rest[0] ? renderDetail(el, Number(rest[0]), alive) : renderList(el, alive);
}

async function renderList(el, alive) {
  const p = hashParams();
  const opt = (v, l, cur) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${l}</option>`;
  el.innerHTML = `<h1>ผู้ใช้</h1>
    <form id="f" class="filters">
      <label class="f">ชื่อ / อีเมล<input name="q" value="${esc(p.q ?? '')}"></label>
      <label class="f">บทบาท<select name="role">${opt('', 'ทั้งหมด', p.role)}${opt('user', 'ลูกค้า', p.role)}${opt('staff', 'staff', p.role)}${opt('admin', 'admin', p.role)}</select></label>
      <label class="f">สถานะ<select name="status">${opt('', 'ทั้งหมด', p.status)}${opt('active', 'ใช้งาน', p.status)}${opt('suspended', 'ถูกระงับ', p.status)}</select></label>
      <button class="btn primary" type="submit">ค้นหา</button></form><div id="list"></div>`;
  const list = $('#list');
  let page = Number(p.page) || 1;
  const load = async () => {
    const q = { ...formValues($('#f')), page };
    setHashQuery(q);
    loading(list);
    try {
      const d = await api('/users' + qs({ ...q, limit: 20 }));
      if (!alive()) return;
      list.innerHTML = table([
        { h: 'ผู้ใช้', f: (u) => `<a href="#/users/${u.id}"><strong>${esc(u.name)}</strong></a><div class="muted">${esc(u.email)}</div>` },
        { h: 'บทบาท', f: (u) => badge(u.role, u.role === 'user' ? 'ลูกค้า' : u.role) }, { h: 'สถานะ', f: (u) => badge(u.status) },
        { h: 'ยืนยันอีเมล', f: (u) => (u.emailVerified ? '✓' : '—') },
        { h: 'ออเดอร์', cls: 'num', f: (u) => u.orderCount }, { h: 'ยอดซื้อ', cls: 'num', f: (u) => money(u.paidTotal) }, { h: 'สมัครเมื่อ', f: (u) => dt(u.createdAt) },
      ], d.items) + pager(d);
      list.onclick = (e) => { if (e.target.dataset.page) { page = Number(e.target.dataset.page); load(); } };
    } catch (e) { errorState(list, e); }
  };
  $('#f').onsubmit = (e) => { e.preventDefault(); page = 1; load(); };
  load();
}

async function renderDetail(el, id, alive) {
  const { user: u, orders, reviewCount } = await api(`/users/${id}`);
  if (!alive()) return;
  const self = u.id === state.me.id;
  el.innerHTML = `
    <div class="toolbar"><h1>${esc(u.name)}</h1><a class="btn" href="#/users">← กลับรายการ</a></div>
    <div class="card"><dl class="kv">
      <dt>อีเมล</dt><dd>${esc(u.email)} ${u.emailVerified ? '✓ ยืนยันแล้ว' : '(ยังไม่ยืนยัน)'}</dd>
      <dt>บทบาท</dt><dd>${badge(u.role, u.role === 'user' ? 'ลูกค้า' : u.role)}</dd><dt>สถานะ</dt><dd>${badge(u.status)}</dd>
      <dt>สมัครเมื่อ</dt><dd>${dt(u.createdAt)}</dd><dt>รีวิว</dt><dd>${reviewCount}</dd>
      ${u.role !== 'user' ? `<dt>2FA</dt><dd>${u.mfaEnabled ? '✓ เปิดใช้' : 'ยังไม่ได้ตั้ง'}</dd>` : ''}</dl>
      ${self ? '<p class="muted">นี่คือบัญชีของคุณ — เปลี่ยนสิทธิ์/ระงับบัญชีตัวเองไม่ได้</p>' : `<div class="toolbar">
        <button class="btn" data-act="role" type="button">เปลี่ยนบทบาท</button>
        <button class="btn ${u.status === 'active' ? 'danger' : 'primary'}" data-act="status" type="button">${u.status === 'active' ? 'ระงับบัญชี' : 'เปิดใช้งานบัญชี'}</button>
        ${u.mfaEnabled ? '<button class="btn danger" data-act="mfa" type="button">ล้าง 2FA</button>' : ''}</div>`}
    </div>
    <h2>ประวัติสั่งซื้อ</h2>
    ${table([
      { h: 'เลขที่', f: (o) => `<a href="#/orders/${o.id}">#${o.id}</a>` }, { h: 'สถานะ', f: (o) => badge(o.status) },
      { h: 'ยอด', cls: 'num', f: (o) => money(o.total) }, { h: 'สร้างเมื่อ', f: (o) => dt(o.createdAt) },
    ], orders)}`;
  el.querySelector('.toolbar [data-act]')?.parentElement.addEventListener('click', async (e) => {
    const act = e.target.dataset.act;
    try {
      if (act === 'role') {
        const v = await dialog({ title: 'เปลี่ยนบทบาท', message: `ผู้ใช้: ${esc(u.email)}`, fields: [{ name: 'role', label: 'บทบาทใหม่', type: 'select', value: u.role, options: [{ value: 'user', label: 'ลูกค้า (user)' }, { value: 'staff', label: 'staff' }, { value: 'admin', label: 'admin' }] }], confirmText: 'บันทึก' });
        if (!v) return;
        await api(`/users/${id}/role`, { method: 'PUT', body: v });
        toast('เปลี่ยนบทบาทแล้ว');
      } else if (act === 'status') {
        const suspend = u.status === 'active';
        const v = await dialog({ title: suspend ? 'ระงับบัญชี' : 'เปิดใช้งานบัญชี', message: suspend ? 'ผู้ใช้จะถูกออกจากระบบและเข้าสู่ระบบไม่ได้ทันที' : '', fields: [{ name: 'reason', label: 'เหตุผล (ไม่บังคับ)' }], confirmText: suspend ? 'ระงับบัญชี' : 'เปิดใช้งาน', danger: suspend });
        if (!v) return;
        await api(`/users/${id}/status`, { method: 'PUT', body: { status: suspend ? 'suspended' : 'active', reason: v.reason || undefined } });
        toast('อัปเดตสถานะแล้ว');
      } else if (act === 'mfa') {
        const v = await dialog({ title: 'ล้าง 2FA', message: `ใช้เมื่อ ${esc(u.email)} ทำโทรศัพท์หายและไม่มีรหัสกู้คืน — ทุกเซสชันของบัญชีนี้จะถูกออกจากระบบ และต้องตั้ง 2FA ใหม่ตอนเข้าสู่ระบบครั้งถัดไป`, confirmText: 'ล้าง 2FA', danger: true });
        if (!v) return;
        await api(`/users/${id}/mfa/reset`, { method: 'POST', body: {} });
        toast('ล้าง 2FA แล้ว');
      } else return;
      renderDetail(el, id, alive);
    } catch (err) { toast(err.message, true); }
  });
}
