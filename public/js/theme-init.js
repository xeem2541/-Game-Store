// โหลดแบบ sync ใน <head> ก่อนหน้าเว็บแสดงผล (กันจอกะพริบ) — ดีไซน์มีธีมมืดอย่างเดียว
document.documentElement.dataset.theme = 'dark';
// ตั้ง lang ของ <html> ให้ตรงกับภาษาที่เลือกตั้งแต่ก่อนแสดงผล (i18n.js ตั้งซ้ำอีกครั้งหลังโหลดไฟล์แปล)
try { var l = localStorage.getItem('lang'); if (l === 'th' || l === 'en') document.documentElement.lang = l; } catch (e) { /* ignore */ }
