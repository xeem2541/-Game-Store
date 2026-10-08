import { $, api, dt, errorState, esc, formValues, hashParams, loading, pager, qs, setHashQuery, table } from './core.js';

const ACTION_GROUPS = [['', 'ทั้งหมด'], ['admin.', 'เข้าสู่ระบบแอดมิน'], ['game.', 'เกม'], ['stock.', 'สต็อกโค้ด'], ['key.', 'โค้ดเกม (ดู/เพิกถอน)'], ['order.', 'ออเดอร์/คืนเงิน'], ['user.', 'ผู้ใช้'], ['coupon.', 'คูปอง'], ['review.', 'รีวิว'], ['report.', 'ส่งออกรายงาน'], ['alert.', 'แจ้งเตือน']];

export async function render(el, _rest, alive) {
  const p = hashParams();
  el.innerHTML = `<h1>Audit log</h1><p class="muted">บันทึกการกระทำสำคัญของแอดมิน/พนักงาน (ใคร ทำอะไร กับอะไร เมื่อไหร่ ค่าก่อน/หลัง)</p>
    <form id="f" class="filters">
      <label class="f">การกระทำ<select name="action">${ACTION_GROUPS.map(([v, l]) => `<option value="${v}" ${p.action === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="f">รหัสผู้ใช้<input name="userId" type="number" min="1" value="${esc(p.userId ?? '')}" class="w100"></label>
      <label class="f">ค้นหา (รหัสรายการ / รายละเอียด)<input name="q" value="${esc(p.q ?? '')}"></label>
      <label class="f">ตั้งแต่<input type="date" name="from" value="${esc(p.from ?? '')}"></label>
      <label class="f">ถึง<input type="date" name="to" value="${esc(p.to ?? '')}"></label>
      <button class="btn primary" type="submit">กรอง</button></form><div id="list"></div>`;
  const list = $('#list');
  let page = Number(p.page) || 1;
  const load = async () => {
    const q = { ...formValues($('#f')), page };
    setHashQuery(q);
    loading(list);
    try {
      const d = await api('/audit' + qs({ ...q, limit: 30 }));
      if (!alive()) return;
      list.innerHTML = table([
        { h: 'เมื่อ', f: (a) => dt(a.createdAt) },
        { h: 'ผู้ทำ', f: (a) => (a.userId ? `${esc(a.userName ?? '')}<div class="muted">${esc(a.userEmail ?? '')}</div>` : '<span class="muted">ระบบ / ไม่ล็อกอิน</span>') },
        { h: 'การกระทำ', f: (a) => `<code>${esc(a.action)}</code>` },
        { h: 'กับ', f: (a) => `${esc(a.entity ?? '')} ${a.entityId ? `#${esc(a.entityId)}` : ''}` },
        { h: 'รายละเอียด (ก่อน/หลัง)', f: (a) => (a.meta ? `<pre class="json">${esc(JSON.stringify(a.meta, null, 1))}</pre>` : '') },
        { h: 'IP', f: (a) => `<small>${esc(a.ip ?? '')}</small>` },
      ], d.items) + pager(d);
      list.onclick = (e) => { if (e.target.dataset.page) { page = Number(e.target.dataset.page); load(); } };
    } catch (e) { errorState(list, e); }
  };
  $('#f').onsubmit = (e) => { e.preventDefault(); page = 1; load(); };
  load();
}
