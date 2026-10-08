import { db } from '../db/index.js';

export function audit(req, action, entity = null, entityId = null, meta = null) {
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, meta, ip) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req?.user?.id ?? null, action, entity, entityId === null ? null : String(entityId), meta ? JSON.stringify(meta) : null, req?.ip ?? null);
}

// แจ้งแอดมิน: บันทึกลงตาราง (หน้า Admin เฟส 5 จะแสดงรายการนี้) และพิมพ์ลง log
export function adminAlert(kind, orderId, detail) {
  db.prepare('INSERT INTO admin_alerts (kind, order_id, detail) VALUES (?, ?, ?)').run(kind, orderId ?? null, detail ?? '');
  console.warn(`⚠️  [ADMIN ALERT] ${kind} order=${orderId ?? '-'} ${detail ?? ''}`);
}
