// ตัวช่วยเรื่องแอนิเมชันที่ทุกหน้าใช้ร่วมกัน — ทุกเอฟเฟกต์ต้องผ่านที่นี่เพื่อเคารพ prefers-reduced-motion และไม่ทำงานเกินจำเป็น

const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

// ผู้ใช้ขอลดการเคลื่อนไหว (ตั้งในระบบปฏิบัติการ) — อ่านค่าล่าสุดทุกครั้ง ผู้ใช้เปลี่ยนระหว่างเปิดหน้าได้
export const prefersReducedMotion = () => reduceQuery.matches;
export const onReducedMotionChange = (cb) => reduceQuery.addEventListener('change', () => cb(reduceQuery.matches));

// เรียก cb เมื่อเบราว์เซอร์ว่าง (หลังวาดหน้าแรกเสร็จ) — ใช้เลื่อนงานหนักที่ไม่จำเป็นต่อการแสดงผลแรก เช่น โหลดฉาก 3D
export function whenIdle(cb, timeout = 2000) {
  if ('requestIdleCallback' in window) requestIdleCallback(cb, { timeout });
  else setTimeout(cb, 200);
}

// เรียก cb(isVisible) ทุกครั้งที่ element เข้า/ออกจากจอ — คืนฟังก์ชันยกเลิก
export function watchVisibility(el, cb, { rootMargin = '0px', threshold = 0 } = {}) {
  const io = new IntersectionObserver(([entry]) => cb(entry.isIntersecting), { rootMargin, threshold });
  io.observe(el);
  return () => io.disconnect();
}

// เครื่องนี้ควรแสดงฉาก 3D หรือไม่: ต้องมี WebGL, ไม่ขอลดการเคลื่อนไหว, ไม่เปิดโหมดประหยัดเน็ต และหน่วยความจำไม่ต่ำมาก
// ไม่ผ่าน → ใช้ภาพนิ่ง (fallback) ที่แสดงอยู่แล้วต่อไป
export function canRender3D() {
  if (prefersReducedMotion()) return false;
  const conn = navigator.connection;
  if (conn?.saveData || /(^|-)2g$/.test(conn?.effectiveType ?? '')) return false;
  if (navigator.deviceMemory !== undefined && navigator.deviceMemory < 2) return false;
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}
