import { $, api, badge, confirmBox, dialog, dt, errorState, esc, formValues, hashParams, isAdmin, loading, money, pager, qs, setHashQuery, table, toast } from './core.js';

export async function render(el, rest, alive) {
  return rest[0] ? renderDetail(el, Number(rest[0]), alive) : renderList(el, alive);
}

async function renderList(el, alive) {
  const p = hashParams();
  const opt = (v, l, cur) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${l}</option>`;
  el.innerHTML = `<h1>ออเดอร์</h1>
    <form id="f" class="filters">
      <label class="f">เลขออเดอร์ / อีเมล<input name="q" value="${esc(p.q ?? '')}"></label>
      <label class="f">สถานะ<select name="status">${opt('', 'ทั้งหมด', p.status)}${['pending', 'paid', 'cancelled', 'refunded'].map((s) => opt(s, { pending: 'รอชำระ', paid: 'ชำระแล้ว', cancelled: 'ยกเลิก', refunded: 'คืนเงินแล้ว' }[s], p.status)).join('')}</select></label>
      <label class="f">ช่องทางชำระ<select name="provider">${opt('', 'ทั้งหมด', p.provider)}${opt('stripe', 'Stripe', p.provider)}${opt('dev', 'จำลอง (dev)', p.provider)}${opt('free', 'ฟรี', p.provider)}</select></label>
      <label class="f">ตั้งแต่<input type="date" name="from" value="${esc(p.from ?? '')}"></label>
      <label class="f">ถึง<input type="date" name="to" value="${esc(p.to ?? '')}"></label>
      <label class="f">เรียง<select name="sort">${opt('newest', 'ใหม่สุด', p.sort)}${opt('oldest', 'เก่าสุด', p.sort)}${opt('totalDesc', 'ยอดสูง→ต่ำ', p.sort)}${opt('totalAsc', 'ยอดต่ำ→สูง', p.sort)}</select></label>
      <button class="btn primary" type="submit">ค้นหา</button>
      <a class="btn" id="csv" href="#" >⬇ CSV</a>
    </form><div id="list"></div>`;
  const list = $('#list');
  let page = Number(p.page) || 1;
  const load = async () => {
    const q = { ...formValues($('#f')), page };
    setHashQuery(q);
    $('#csv').href = '/api/admin/reports/orders.csv' + qs({ q: q.q, status: q.status, provider: q.provider, from: q.from, to: q.to });
    loading(list);
    try {
      const d = await api('/orders' + qs({ ...q, limit: 20 }));
      if (!alive()) return;
      list.innerHTML = table([
        { h: 'เลขที่', f: (o) => `<a href="#/orders/${o.id}"><strong>#${o.id}</strong></a>` },
        { h: 'ลูกค้า', f: (o) => `${esc(o.name)}<div class="muted">${esc(o.email)}</div>` },
        { h: 'สถานะ', f: (o) => badge(o.status) }, { h: 'ช่องทาง', f: (o) => esc(o.provider ?? '-') },
        { h: 'รายการ', cls: 'num', f: (o) => o.itemCount }, { h: 'ยอดรวม', cls: 'num', f: (o) => money(o.total) },
        { h: 'สร้างเมื่อ', f: (o) => dt(o.createdAt) },
      ], d.items, { rowAttr: (o) => `class="click" data-go="${o.id}"` }) + pager(d);
      list.onclick = (e) => {
        if (e.target.dataset.page) { page = Number(e.target.dataset.page); load(); return; }
        const tr = e.target.closest('tr[data-go]');
        if (tr && !e.target.closest('a')) location.hash = `#/orders/${tr.dataset.go}`;
      };
    } catch (e) { errorState(list, e); }
  };
  $('#f').onsubmit = (e) => { e.preventDefault(); page = 1; load(); };
  load();
}

async function renderDetail(el, id, alive) {
  const d = await api(`/orders/${id}`);
  if (!alive()) return;
  const o = d.order;
  const reload = () => renderDetail(el, id, alive);
  el.innerHTML = `
    <div class="toolbar"><h1>ออเดอร์ #${o.id} ${badge(o.status)}</h1><a class="btn" href="#/orders">← กลับรายการ</a></div>
    <div class="toolbar" id="actions">
      ${o.status === 'pending' ? '<button class="btn danger" data-act="cancel" type="button">ยกเลิกออเดอร์</button>' : ''}
      ${o.status === 'paid' ? '<button class="btn" data-act="resend" type="button">ส่งอีเมลโค้ดอีกครั้ง</button>' : ''}
      ${o.status === 'paid' && isAdmin() ? '<button class="btn danger" data-act="refund" type="button">คืนเงิน</button>' : ''}
    </div>
    <div class="grid2">
      <div class="card"><h3>ข้อมูลออเดอร์</h3><dl class="kv">
        <dt>ลูกค้า</dt><dd>${esc(d.user.name)} (${esc(d.user.email)}) ${d.user.status === 'suspended' ? badge('suspended') : ''}</dd>
        <dt>สร้างเมื่อ</dt><dd>${dt(o.createdAt)}</dd><dt>ชำระเมื่อ</dt><dd>${dt(o.paidAt)}</dd>
        <dt>หมดอายุ</dt><dd>${o.status === 'pending' ? dt(o.expiresAt) : '-'}</dd>
        <dt>เลขที่ใบเสร็จ</dt><dd>${esc(o.invoiceNumber ?? '-')}</dd>
        ${o.cancelReason ? `<dt>เหตุผลยกเลิก</dt><dd>${esc(o.cancelReason)}</dd>` : ''}
      </dl></div>
      <div class="card"><h3>ยอดเงิน</h3><dl class="kv">
        <dt>ราคาเต็มรวม</dt><dd>${money(o.subtotal)}</dd><dt>ส่วนลดโปรโมชันเกม</dt><dd>−${money(o.gameDiscount)}</dd>
        <dt>คูปอง ${o.couponCode ? `<code>${esc(o.couponCode)}</code>` : ''}</dt><dd>−${money(o.couponDiscount)}</dd>
        <dt><strong>ยอดสุทธิ</strong></dt><dd><strong>${money(o.total)}</strong></dd></dl></div>
    </div>
    <h2>รายการสินค้า</h2>
    ${table([
      { h: 'เกม', f: (i) => `<a href="#/games/${i.gameId}">${esc(i.title)}</a> <span class="muted">${esc(i.platform)}</span>` },
      { h: 'ราคาเต็ม', cls: 'num', f: (i) => money(i.listPrice) }, { h: 'ส่วนลด', cls: 'num', f: (i) => `${i.discountPercent}%` }, { h: 'ราคาสุทธิ', cls: 'num', f: (i) => money(i.unitPrice) },
    ], o.items)}
    <h2>โค้ดเกม <small class="muted">(ปิดบังบางส่วน — ดูโค้ดเต็มได้ที่หน้า สต็อกโค้ด สำหรับ admin)</small></h2>
    ${table([{ h: 'เกม', f: (k) => esc(k.title) }, { h: 'โค้ด', f: (k) => `<code>${esc(k.masked)}</code>` }, { h: 'สถานะ', f: (k) => badge(k.status) }], d.keys)}
    <h2>การชำระเงิน</h2>
    ${table([
      { h: 'ช่องทาง', f: (p) => esc(p.provider) }, { h: 'สถานะ', f: (p) => badge(p.status) }, { h: 'ยอด', cls: 'num', f: (p) => `${money(p.amount)} ${esc(p.currency.toUpperCase())}` },
      { h: 'อ้างอิง', f: (p) => `<small>${esc(p.providerRef ?? '-')}<br>${esc(p.paymentIntent ?? '')}</small>` }, { h: 'หมายเหตุ', f: (p) => esc(p.lastError ?? '') }, { h: 'เมื่อ', f: (p) => dt(p.updatedAt) },
    ], d.payments)}
    ${d.refund ? `<h2>การคืนเงิน</h2><div class="card"><dl class="kv"><dt>จำนวน</dt><dd>${money(d.refund.amount)}</dd><dt>เหตุผล</dt><dd>${esc(d.refund.reason)}</dd>
      <dt>ผู้ดำเนินการ</dt><dd>${esc(d.refund.admin ?? (d.refund.source === 'stripe_dashboard' ? 'Stripe Dashboard' : '-'))}</dd><dt>เมื่อ</dt><dd>${dt(d.refund.createdAt)}</dd></dl></div>` : ''}
    <h2>ประวัติการเปลี่ยนสถานะ</h2>
    ${table([
      { h: 'เมื่อ', f: (e) => dt(e.createdAt) }, { h: 'จาก', f: (e) => (e.fromStatus ? badge(e.fromStatus) : '—') }, { h: 'เป็น', f: (e) => badge(e.toStatus) },
      { h: 'โดย', f: (e) => esc(e.actor ?? 'ระบบ/ลูกค้า') }, { h: 'เหตุผล', f: (e) => esc(e.reason ?? '') },
    ], d.events)}
    <h2>อีเมล</h2>
    ${table([{ h: 'ชนิด', f: (m) => esc(m.kind) }, { h: 'สถานะ', f: (m) => badge(m.status === 'sent' ? 'paid' : m.status === 'failed' ? 'failed' : 'pending', m.status) },
      { h: 'พยายาม', cls: 'num', f: (m) => m.attempts }, { h: 'ส่งเมื่อ', f: (m) => dt(m.sentAt) }, { h: 'ข้อผิดพลาด', f: (m) => esc(m.lastError ?? '') }], d.emails)}`;

  $('#actions').onclick = async (e) => {
    const act = e.target.dataset.act;
    if (!act) return;
    try {
      if (act === 'cancel') {
        const v = await dialog({ title: `ยกเลิกออเดอร์ #${id}`, message: 'ออเดอร์ที่ยังไม่ชำระจะถูกยกเลิก โค้ดที่จองไว้และสิทธิ์คูปองจะถูกคืน', fields: [{ name: 'reason', label: 'หมายเหตุ (ไม่บังคับ)' }], confirmText: 'ยกเลิกออเดอร์', danger: true });
        if (!v) return;
        await api(`/orders/${id}/cancel`, { method: 'POST', body: v });
        toast('ยกเลิกออเดอร์แล้ว');
      } else if (act === 'resend') {
        if (!(await confirmBox('ส่งอีเมลโค้ดอีกครั้ง?', `ส่งไปที่ ${esc(d.user.email)}`, 'ส่งอีเมล'))) return;
        await api(`/orders/${id}/resend-email`, { method: 'POST', body: {} });
        toast('ใส่คิวส่งอีเมลแล้ว');
      } else if (act === 'refund') {
        // ยืนยันสองชั้น: (1) ระบุเหตุผล  (2) พิมพ์เลขออเดอร์ซ้ำ — เซิร์ฟเวอร์ตรวจ confirmOrderId ซ้ำอีกครั้ง
        const v1 = await dialog({ title: `คืนเงินออเดอร์ #${id} (ขั้นที่ 1/2)`, message: `คืนเงินเต็มจำนวน <strong>${money(o.total)}</strong> — โค้ดเกมจะถูกเพิกถอนและเกมออกจากคลังของลูกค้า`, fields: [{ name: 'reason', label: 'เหตุผลการคืนเงิน', type: 'textarea', required: true }], confirmText: 'ถัดไป', danger: true });
        if (!v1) return;
        const v2 = await dialog({ title: `ยืนยันการคืนเงิน (ขั้นที่ 2/2)`, message: 'การกระทำนี้ย้อนกลับไม่ได้ และถูกบันทึกใน audit log', fields: [{ name: 'confirm', label: `พิมพ์เลขออเดอร์ ${id} เพื่อยืนยัน`, required: true, mustEqual: String(id) }], confirmText: 'คืนเงินเดี๋ยวนี้', danger: true });
        if (!v2) return;
        await api(`/orders/${id}/refund`, { method: 'POST', body: { reason: v1.reason, confirmOrderId: id } });
        toast('คืนเงินแล้ว');
      }
      reload();
    } catch (err) { toast(err.message, true); }
  };
}
