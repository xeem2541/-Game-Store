// โหลดแบบ sync ใน <head> ก่อนหน้าเว็บแสดงผล (กันจอกะพริบ) — ดีไซน์มีธีมมืดอย่างเดียว
document.documentElement.dataset.theme = 'dark';
// ตั้ง lang ของ <html> ให้ตรงกับภาษาที่เลือกตั้งแต่ก่อนแสดงผล (i18n.js ตั้งซ้ำอีกครั้งหลังโหลดไฟล์แปล)
try { var l = localStorage.getItem('lang'); if (l === 'th' || l === 'en') document.documentElement.lang = l; } catch (e) { /* ignore */ }
// เปลี่ยนหน้าแบบ view transition (css/transitions.css): จำ transition ของการเปิดหน้านี้ไว้ ให้สคริปต์ของหน้ารอจบก่อนแทนที่ skeleton
// (pagereveal เกิดก่อนแสดงผลครั้งแรก จึงต้องฟังในสคริปต์ sync ของ <head>)
window.addEventListener('pagereveal', function (e) { window.__revealTransition = e.viewTransition || null; });
