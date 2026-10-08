import { $, api, badge, bahtInput, dialog, dt, errorState, esc, loading, money, table, toSatang, toast } from './core.js';

const valueText = (c) => (c.type === 'percent' ? `${c.value}%` : money(c.value));

export async function render(el, _rest, alive) {
  el.innerHTML = '<div class="toolbar"><h1>คูปอง</h1><button class="btn primary" id="add" type="button">+ เพิ่มคูปอง</button></div><div id="list"></div>';
  const list = $('#list');
  const load = async () => {
    loading(list);
    try {
      const d = await api('/coupons');
      if (!alive()) return;
      list.innerHTML = table([
        { h: 'โค้ด', f: (c) => `<code>${esc(c.code)}</code><div class="muted">${esc(c.description)}</div>` },
        { h: 'ส่วนลด', f: (c) => valueText(c) }, { h: 'ขั้นต่ำ', cls: 'num', f: (c) => (c.minSubtotal ? money(c.minSubtotal) : '-') },
        { h: 'หมดอายุ', f: (c) => (c.expiresAt ? `${dt(c.expiresAt)} ${c.expired ? badge('expired', 'หมดอายุแล้ว') : ''}` : 'ไม่หมดอายุ') },
        { h: 'จำกัด รวม / ต่อคน', f: (c) => `${c.maxUses ?? '∞'} / ${c.maxPerUser ?? '∞'}` },
        { h: 'ใช้อยู่ / ชำระแล้ว', cls: 'num', f: (c) => `${c.usedCount} / ${c.paidCount}` },
        { h: 'สถานะ', f: (c) => badge(c.active ? 'active' : 'hidden', c.active ? 'เปิดใช้งาน' : 'ปิด') },
        { h: '', f: (c) => `<button class="btn sm" data-edit="${c.id}" type="button">แก้ไข</button> <button class="btn sm ${c.active ? 'danger' : ''}" data-toggle="${c.id}" type="button">${c.active ? 'ปิด' : 'เปิด'}</button>` },
      ], d.items);
      list.onclick = async (e) => {
        const t = e.target;
        const c = d.items.find((x) => x.id === Number(t.dataset.edit || t.dataset.toggle));
        if (!c) return;
        try {
          if (t.dataset.toggle) { await api(`/coupons/${c.id}`, { method: 'PUT', body: { active: !c.active } }); toast('อัปเดตแล้ว'); load(); } else await form(c);
        } catch (err) { toast(err.message, true); }
      };
    } catch (e) { errorState(list, e); }
  };

  async function form(c) {
    const f = (name, label, extra = {}) => ({ name, label, ...extra });
    const v = await dialog({
      title: c ? `แก้ไขคูปอง ${c.code}` : 'เพิ่มคูปอง',
      fields: [
        f('code', 'โค้ด (A-Z 0-9 _ -)', { required: true, value: c?.code ?? '' }), f('description', 'คำอธิบาย', { value: c?.description ?? '' }),
        f('type', 'ประเภท', { type: 'select', value: c?.type ?? 'percent', options: [{ value: 'percent', label: 'เปอร์เซ็นต์ (%)' }, { value: 'fixed', label: 'จำนวนเงินคงที่ (บาท)' }] }),
        f('value', 'ค่าส่วนลด (% หรือ บาท ตามประเภท)', { required: true, type: 'number', step: '0.01', value: c ? (c.type === 'percent' ? c.value : bahtInput(c.value)) : '' }),
        f('min', 'ยอดขั้นต่ำ (บาท)', { type: 'number', step: '0.01', value: c ? bahtInput(c.minSubtotal) : '0' }),
        f('expires', 'วันหมดอายุ (เว้นว่าง = ไม่หมดอายุ)', { type: 'datetime-local', value: c?.expiresAt ? new Date(new Date(c.expiresAt).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '' }),
        f('maxUses', 'จำกัดจำนวนครั้งรวม (เว้นว่าง = ไม่จำกัด)', { type: 'number', value: c?.maxUses ?? '' }),
        f('maxPerUser', 'จำกัดต่อผู้ใช้ (เว้นว่าง = ไม่จำกัด)', { type: 'number', value: c?.maxPerUser ?? '' }),
      ],
      confirmText: 'บันทึก',
    });
    if (!v) return;
    const body = {
      code: v.code, description: v.description, type: v.type,
      value: v.type === 'percent' ? Math.round(Number(v.value)) : toSatang(v.value), min_subtotal: toSatang(v.min || '0'),
      expires_at: v.expires ? new Date(v.expires).toISOString() : null,
      max_uses: v.maxUses ? Number(v.maxUses) : null, max_per_user: v.maxPerUser ? Number(v.maxPerUser) : null,
    };
    await api(c ? `/coupons/${c.id}` : '/coupons', { method: c ? 'PUT' : 'POST', body });
    toast('บันทึกคูปองแล้ว');
    load();
  }
  $('#add').onclick = () => form(null).catch((e) => toast(e.message, true));
  load();
}
