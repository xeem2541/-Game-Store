import { t, toast } from './common.js';

// แสดงโค้ดเกม: ซ่อนไว้เป็นค่าเริ่มต้น กด "แสดง" เพื่อเปิดดู และ "คัดลอก" ลงคลิปบอร์ด
// สร้างด้วย DOM API + textContent (ไม่ใส่โค้ดลงใน HTML string / attribute)
export function renderKeys(container, keys) {
  container.replaceChildren();
  for (const k of keys) {
    const row = document.createElement('div');
    row.className = 'key-row';

    const info = document.createElement('div');
    info.className = 'grow';
    if (k.title) {
      const title = document.createElement('strong');
      title.textContent = k.title;
      info.append(title);
    }
    const code = document.createElement('code');
    code.className = 'key';
    code.textContent = '••••-••••-••••-••••';
    info.append(code);

    const show = document.createElement('button');
    show.type = 'button';
    show.className = 'btn';
    show.textContent = t('order.show');
    let visible = false;
    show.onclick = () => {
      visible = !visible;
      code.textContent = visible ? k.code : '••••-••••-••••-••••';
      show.textContent = t(visible ? 'order.hide' : 'order.show');
    };

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'btn';
    copy.textContent = t('order.copy');
    copy.onclick = async () => {
      try { await navigator.clipboard.writeText(k.code); toast(t('order.copied')); } catch { toast(t('common.error')); }
    };

    row.append(info, show, copy);
    container.append(row);
  }
}
