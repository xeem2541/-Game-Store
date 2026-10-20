// แสงพื้นหลังทั้งหน้าเปลี่ยนสีตามเกม (UI เฟส 26) — ชั้น fixed หลังเนื้อหาทั้งหมด (css/cursor.css)
// - สีที่ใช้คือ currentColor ของชั้นนี้ → เปลี่ยนสีด้วย transition ของ color ปกติ (ไม่ต้องใช้ @property และไม่ทำให้ทั้งหน้าคำนวณ style ใหม่)
// - base = สีประจำหน้า (หน้าเกมใช้สีของเกมนั้น), setAmbient(color) = สีชั่วคราวตอนชี้/โฟกัสเกม, setAmbient(null) = กลับไปสี base
const HEX = /^#[0-9a-f]{3,8}$/i;
let el = null;
let base = '';

function layer() {
  if (!el) {
    el = document.createElement('div');
    el.className = 'ambient';
    el.setAttribute('aria-hidden', 'true');
    document.body.prepend(el);
  }
  return el;
}

const apply = (color) => {
  const l = layer();
  if (color) l.style.color = color;
  l.classList.toggle('on', Boolean(color));
};

export const isGameColor = (c) => typeof c === 'string' && HEX.test(c);

export function setAmbientBase(color) {
  base = isGameColor(color) ? color : '';
  apply(base);
}

export function setAmbient(color) {
  apply(isGameColor(color) ? color : base);
}
