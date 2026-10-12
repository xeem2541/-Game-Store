import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passwordStrength } from '../public/js/password-strength.js';

const lv = (pw, who) => passwordStrength(pw, who).level;

test('ตัววัดความแข็งแรงรหัสผ่าน: ว่าง/สั้น/เดาง่าย/เบอร์โทร/ข้อมูลส่วนตัว = อ่อน, ยาว+ผสม = แข็งแรง', () => {
  assert.equal(lv(''), 0);
  assert.equal(lv('Ab1!'), 1);
  assert.equal(passwordStrength('Ab1!').tip, 'pw.tipShort');
  assert.equal(lv('aaaaaaaaaa'), 1);
  assert.equal(lv('12345678'), 1);
  assert.equal(lv('0812345678'), 1, 'เบอร์มือถือ');
  assert.equal(lv('081-234-5678'), 1, 'เบอร์มือถือมีขีด');
  assert.equal(lv('MyPassword99'), 1, 'มีคำว่า password');
  assert.equal(lv('somchai2026x', { email: 'somchai@example.com' }), 1, 'มีชื่อในอีเมล');
  assert.equal(passwordStrength('somchai2026x', { email: 'somchai@example.com' }).tip, 'pw.tipGuessable');
  assert.equal(lv('trombone'), 2);
  assert.equal(lv('trombone7'), 2);
  assert.equal(lv('trombone-Kite7'), 4);
  assert.equal(lv('correct horse battery staple'), 4);
  assert.ok(lv('purple-otter-lamp') >= 3);
  assert.equal(passwordStrength('trombone-Kite7').tip, 'pw.tipGood');
});
