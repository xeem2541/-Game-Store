import PDFDocument from 'pdfkit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { db } from '../db/index.js';

const FONT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'fonts');
const money = (satang) => (satang / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateTh = (s) => new Date(s.replace(' ', 'T') + 'Z').toLocaleString('th-TH', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Bangkok' });

// ราคาที่ขายเป็นราคารวม VAT 7% แล้ว → แยกราคาก่อน VAT และ VAT ออกมา (ปัดเศษที่ฝั่ง VAT ให้ผลรวมตรงกับยอดสุทธิ)
export function splitVat(totalSatang) {
  const net = Math.round((totalSatang * 100) / 107);
  return { net, vat: totalSatang - net };
}

// สร้าง PDF ใบเสร็จ/ใบกำกับภาษีอย่างย่อของออเดอร์ที่ชำระแล้ว คืนเป็น Buffer
// สร้างเสร็จในหน่วยความจำก่อนส่ง (ไฟล์เล็ก) — ถ้า error ระหว่างสร้าง route ยังตอบ 500 ปกติได้ ไม่ใช่ PDF ครึ่งไฟล์หลังส่ง header ไปแล้ว
export function renderReceipt(orderId) {
  return new Promise((resolve, reject) => {
    try {
      const doc = buildReceipt(orderId);
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

function buildReceipt(orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  const user = db.prepare('SELECT name, email FROM users WHERE id = ?').get(order.user_id);
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(orderId);
  const inv = db.prepare('SELECT number, issued_at FROM invoices WHERE order_id = ?').get(orderId);
  const pay = db.prepare("SELECT provider FROM payments WHERE order_id = ? AND status IN ('succeeded', 'refunded') ORDER BY id DESC").get(orderId);
  const { net, vat } = splitVat(order.total);

  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: { Title: `Receipt ${inv?.number ?? orderId}`, Author: config.shop.name } });
  doc.registerFont('th', path.join(FONT_DIR, 'Sarabun-Regular.ttf'));
  doc.registerFont('th-bold', path.join(FONT_DIR, 'Sarabun-Bold.ttf'));

  const L = 48;
  const R = doc.page.width - 48;
  const W = R - L;
  const BOTTOM = doc.page.height - 64; // เว้นที่ให้เลขหน้า

  doc.font('th-bold').fontSize(20).text(config.shop.name, L, 48);
  doc.font('th').fontSize(10).fillColor('#444')
    .text(config.shop.address, L, doc.y, { width: W * 0.6 })
    .text(`เลขประจำตัวผู้เสียภาษี / Tax ID: ${config.shop.taxId}`);

  doc.fillColor('#000').font('th-bold').fontSize(16).text('ใบเสร็จรับเงิน / ใบกำกับภาษีอย่างย่อ', L, 120, { width: W, align: 'center' });
  doc.font('th').fontSize(11).fillColor('#444').text('Receipt / Abbreviated Tax Invoice', { width: W, align: 'center' });

  doc.fillColor('#000').fontSize(11);
  const metaTop = 165;
  doc.font('th-bold').text('เลขที่เอกสาร / No.', L, metaTop).font('th').text(inv?.number ?? '-', L + 140, metaTop);
  doc.font('th-bold').text('วันที่ / Date', L, metaTop + 18).font('th').text(dateTh(order.paid_at ?? inv?.issued_at ?? order.created_at), L + 140, metaTop + 18);
  doc.font('th-bold').text('คำสั่งซื้อ / Order', L, metaTop + 36).font('th').text(`#${order.id}`, L + 140, metaTop + 36);
  doc.font('th-bold').text('ผู้ซื้อ / Buyer', L, metaTop + 54).font('th').text(`${user.name} (${user.email})`, L + 140, metaTop + 54);
  doc.font('th-bold').text('ช่องทางชำระ / Payment', L, metaTop + 72).font('th').text(pay?.provider === 'stripe' ? 'Stripe (บัตร / PromptPay)' : pay?.provider ?? '-', L + 140, metaTop + 72);

  // ตารางรายการ (รายการยาวขึ้นหน้าใหม่พร้อมหัวตารางซ้ำ)
  const col = { no: L, name: L + 28, list: L + 270, disc: L + 350, net: L + 430 };
  const NAME_W = 235;
  let y = metaTop + 108;
  const tableHeader = () => {
    doc.rect(L, y - 6, W, 24).fill('#eef0fb');
    doc.fillColor('#000').font('th-bold').fontSize(10.5);
    doc.text('#', col.no + 4, y);
    doc.text('รายการ / Item', col.name, y);
    doc.text('ราคาเต็ม', col.list, y, { width: 70, align: 'right' });
    doc.text('ส่วนลด', col.disc, y, { width: 70, align: 'right' });
    doc.text('ราคาสุทธิ', col.net, y, { width: R - col.net, align: 'right' });
    y += 24;
    doc.font('th').fontSize(10.5);
  };
  const newPage = () => { doc.addPage(); y = 56; };
  tableHeader();
  items.forEach((i, idx) => {
    const name = `${i.title} (${i.platform})`;
    const rowH = Math.max(22, doc.heightOfString(name, { width: NAME_W }) + 8); // ชื่อยาวขึ้นบรรทัดใหม่ได้
    if (y + rowH > BOTTOM) { newPage(); tableHeader(); }
    doc.text(String(idx + 1), col.no + 4, y);
    doc.text(name, col.name, y, { width: NAME_W });
    doc.text(money(i.list_price), col.list, y, { width: 70, align: 'right' });
    doc.text(i.list_price > i.unit_price ? '-' + money(i.list_price - i.unit_price) : '-', col.disc, y, { width: 70, align: 'right' });
    doc.text(money(i.unit_price), col.net, y, { width: R - col.net, align: 'right' });
    y += rowH;
    doc.moveTo(L, y - 4).lineTo(R, y - 4).strokeColor('#e3e5f1').lineWidth(0.5).stroke();
  });

  // สรุปยอด (ไม่แยกครึ่งหน้า: ที่ไม่พอทั้งก้อนให้ขึ้นหน้าใหม่)
  const SUMMARY_H = 8 + 18 * 3 + 6 + 18 * 2 + 24 + 60;
  if (y + SUMMARY_H > BOTTOM) newPage();
  y += 8;
  const row = (label, value, bold = false) => {
    doc.font(bold ? 'th-bold' : 'th').fontSize(bold ? 12.5 : 10.5).fillColor('#000');
    doc.text(label, L + 180, y, { width: 220, align: 'right' });
    doc.text(value, col.net, y, { width: R - col.net, align: 'right' });
    y += bold ? 24 : 18;
  };
  row('ราคาเต็มรวม', money(order.subtotal));
  if (order.game_discount) row('ส่วนลดโปรโมชันเกม', '-' + money(order.game_discount));
  if (order.coupon_discount) row(`ส่วนลดคูปอง (${order.coupon_code})`, '-' + money(order.coupon_discount));
  doc.moveTo(L + 180, y - 2).lineTo(R, y - 2).strokeColor('#999').lineWidth(0.7).stroke();
  y += 4;
  row('ราคาก่อนภาษีมูลค่าเพิ่ม', money(net));
  row('ภาษีมูลค่าเพิ่ม 7% (VAT)', money(vat));
  row('ยอดรวมสุทธิ (รวม VAT) บาท', money(order.total), true);

  doc.font('th').fontSize(9.5).fillColor('#555')
    .text('ราคาสินค้าข้างต้นรวมภาษีมูลค่าเพิ่ม 7% แล้ว • สินค้าเป็นโค้ดเกมดิจิทัล ไม่มีการจัดส่ง', L, y + 24, { width: W })
    .text('เอกสารนี้ออกโดยระบบอัตโนมัติ / Generated automatically.', { width: W });

  const { start, count } = doc.bufferedPageRange();
  if (count > 1) {
    for (let p = start; p < start + count; p += 1) {
      doc.switchToPage(p);
      doc.page.margins.bottom = 0; // เลขหน้าอยู่ในขอบล่าง — ไม่งั้น pdfkit จะขึ้นหน้าใหม่ให้เอง
      doc.font('th').fontSize(9).fillColor('#777')
        .text(`${inv?.number ?? `#${order.id}`} • หน้า ${p - start + 1}/${count}`, L, doc.page.height - 44, { width: W, align: 'right', lineBreak: false });
    }
  }
  return doc;
}
