import bcrypt from 'bcryptjs';

// แฮชรหัสผ่าน + เทียบรหัสผ่านแบบเวลาคงที่ (ใช้ร่วมกันระหว่างล็อกอินลูกค้า/แอดมิน และหน้าเปลี่ยนรหัส)
const ROUNDS = 10;
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', ROUNDS);

export const hashPassword = (password) => bcrypt.hash(password, ROUNDS);

// เทียบแฮชเสมอแม้ไม่พบผู้ใช้ เพื่อไม่ให้เวลาตอบสนองบอกใบ้ว่ามีอีเมลนี้ในระบบ
export const checkPassword = async (user, password) =>
  (await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH)) && !!user;

export const isUniqueViolation = (e) => e?.code === 'SQLITE_CONSTRAINT_UNIQUE';
