import { $, api, esc, toast } from './core.js';

// ตั้งค่า 2FA ครั้งแรก (บังคับก่อนใช้หลังบ้าน): สแกน QR → กรอกรหัสยืนยัน → เก็บรหัสกู้คืน
export function renderSetup(el) {
  el.innerHTML = `
    <div class="card mfa-setup">
      <h1>ตั้งค่ายืนยันตัวตนสองขั้นตอน (2FA)</h1>
      <p>บัญชีหลังบ้านคืนเงินและเข้าถึงข้อมูลลูกค้าได้ จึงต้องใช้รหัสจากแอป Authenticator ทุกครั้งที่เข้าสู่ระบบ
        (เช่น Google Authenticator, Microsoft Authenticator, 1Password)</p>
      <button class="btn primary" id="mfaStart" type="button">เริ่มตั้งค่า</button>
    </div>`;
  $('#mfaStart').onclick = () => start(el).catch((e) => toast(e.message, true));
}

async function start(el) {
  const s = await api('/auth/mfa/setup', { method: 'POST', body: {} });
  const qr = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s.qrSvg)}`;
  el.innerHTML = `
    <div class="card mfa-setup">
      <h1>สแกน QR ด้วยแอป Authenticator</h1>
      <ol>
        <li>เปิดแอป Authenticator แล้วเลือกเพิ่มบัญชี / สแกน QR</li>
        <li>สแกนรูปด้านล่าง (สแกนไม่ได้ ให้กรอกรหัสลับด้วยตนเอง)</li>
        <li>กรอกรหัส 6 หลักที่แอปแสดง</li>
      </ol>
      <img class="mfa-qr" src="${qr}" alt="QR code สำหรับแอป Authenticator" width="220" height="220">
      <p class="muted">รหัสลับ (กรอกเอง): <code id="mfaSecret">${esc(s.secret.match(/.{1,4}/g).join(' '))}</code></p>
      <form id="mfaEnable" class="mfa-form">
        <label class="f">รหัส 6 หลักจากแอป<input name="code" required inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}"></label>
        <button class="btn primary" type="submit">ยืนยันและเปิดใช้ 2FA</button>
      </form>
    </div>`;
  $('#mfaEnable').code.focus();
  $('#mfaEnable').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      const { recoveryCodes } = await api('/auth/mfa/enable', { method: 'POST', body: { code: e.target.code.value } });
      showRecoveryCodes(el, recoveryCodes);
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
      e.target.code.select();
    }
  };
}

function showRecoveryCodes(el, codes) {
  el.innerHTML = `
    <div class="card mfa-setup">
      <h1>✓ เปิดใช้ 2FA แล้ว — เก็บรหัสกู้คืน</h1>
      <p>ใช้แทนรหัสจากแอปได้ <strong>รหัสละครั้ง</strong> เมื่อทำโทรศัพท์หาย เก็บไว้ในที่ปลอดภัย (เช่น password manager) — <strong>จะไม่แสดงอีก</strong></p>
      <ul class="codes" id="recoveryCodes">${codes.map((c) => `<li><code>${esc(c)}</code></li>`).join('')}</ul>
      <div class="toolbar">
        <button class="btn" id="copyCodes" type="button">คัดลอกรหัสทั้งหมด</button>
      </div>
      <label class="check"><input type="checkbox" id="savedCodes"> ฉันเก็บรหัสกู้คืนไว้แล้ว</label>
      <button class="btn primary" id="mfaDone" type="button" disabled>เข้าสู่หลังบ้าน</button>
    </div>`;
  $('#copyCodes').onclick = async () => {
    try { await navigator.clipboard.writeText(codes.join('\n')); toast('คัดลอกแล้ว'); } catch { toast('คัดลอกไม่ได้ — กรุณาจดเอง', true); }
  };
  $('#savedCodes').onchange = (e) => { $('#mfaDone').disabled = !e.target.checked; };
  $('#mfaDone').onclick = () => location.reload();
}
