// โหลดแบบ sync ใน <head> ก่อนหน้าเว็บแสดงผล (กันจอกะพริบ) — ดีไซน์มีธีมมืดอย่างเดียว
document.documentElement.dataset.theme = 'dark';
// ตั้ง lang ของ <html> ให้ตรงกับภาษาที่เลือกตั้งแต่ก่อนแสดงผล (i18n.js ตั้งซ้ำอีกครั้งหลังโหลดไฟล์แปล)
try { var l = localStorage.getItem('lang'); if (l === 'th' || l === 'en') document.documentElement.lang = l; } catch (e) { /* ignore */ }
// เปลี่ยนหน้าแบบ view transition (css/transitions.css): จำ transition ของการเปิดหน้านี้ไว้ ให้สคริปต์ของหน้ารอจบก่อนแทนที่ skeleton
// (pagereveal เกิดก่อนแสดงผลครั้งแรก จึงต้องฟังในสคริปต์ sync ของ <head>)
window.addEventListener('pagereveal', function (e) { window.__revealTransition = e.viewTransition || null; });
// ฉากเปิดตัวหน้าแรก (css/intro.css): เล่นครั้งเดียวต่อการเปิดเว็บ (ต่อแท็บ) — ตัดสินก่อนแสดงผลครั้งแรก ไม่งั้นจะเห็นหน้าเว็บแวบหนึ่งก่อนฉากปิดทับ
// ไม่เล่นเมื่อขอลดการเคลื่อนไหว / หน้าอื่นที่ไม่ใช่หน้าแรก / sessionStorage ใช้ไม่ได้ (โหมดส่วนตัวบางแบบ — ไม่งั้นจะเล่นซ้ำทุกครั้ง)
try {
  if ((location.pathname === '/' || location.pathname === '/index.html') && !matchMedia('(prefers-reduced-motion: reduce)').matches && !sessionStorage.getItem('introSeen')) {
    sessionStorage.setItem('introSeen', '1');
    document.documentElement.dataset.intro = 'play';
  }
} catch (e) { /* ignore */ }
