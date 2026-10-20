// หน้าเกมแบบเต็มจอ (UI เฟส 26): "โลกของเกม" หลายชั้นอยู่ด้านหลังทั้งจอ — ฉากของเกม (ไกล) → ลำแสงสีของเกม → ละอองลอย → หมอกด้านล่าง
// - ชั้น position: fixed (ไม่ทำให้หน้าเลื่อนแนวนอน) จางและเลื่อนช้ากว่าเนื้อหาเมื่อเลื่อนลง แล้วหยุดแอนิเมชันเมื่อพ้นจอ
// - เมาส์: แต่ละชั้นขยับคนละระยะ (ไกล = น้อย) ให้รู้สึกมีความลึก — เฉพาะอุปกรณ์ที่มีเมาส์และไม่ได้ขอลดการเคลื่อนไหว
// - ทั้งหน้าเปลี่ยนโทนเป็นสีของเกม (ambient.js) — ปุ่มซื้อยังเป็นสีแบรนด์ (คอนทราสต์ผ่านเสมอ)
import { setAmbientBase, isGameColor } from './ambient.js';
import { prefersReducedMotion } from './motion.js';

export function mountGameWorld(world, g) {
  if (!world) return;
  world.querySelector('.gw-far').style.backgroundImage = `url('/api/games/${encodeURIComponent(g.slug)}/scene.svg')`;
  if (isGameColor(g.color1)) world.style.setProperty('--gw-c1', g.color1);
  if (isGameColor(g.color2)) world.style.setProperty('--gw-c2', g.color2);
  setAmbientBase(g.color1);
  world.classList.add('ready');

  // เลื่อนลง: โลกจางหายและเลื่อนช้ากว่าเนื้อหา (parallax) — พ้นแล้วหยุดแอนิเมชันของชั้นต่าง ๆ
  let frame = 0;
  const onScroll = () => {
    frame = 0;
    const p = Math.min(1, scrollY / (innerHeight * 0.9));
    world.style.setProperty('--gw-p', p.toFixed(3));
    world.classList.toggle('is-past', p >= 1);
  };
  addEventListener('scroll', () => { frame ||= requestAnimationFrame(onScroll); }, { passive: true });
  onScroll();

  if (prefersReducedMotion() || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  let mframe = 0;
  let mx = 0;
  let my = 0;
  addEventListener('pointermove', (e) => {
    mx = e.clientX / innerWidth - 0.5;
    my = e.clientY / innerHeight - 0.5;
    mframe ||= requestAnimationFrame(() => {
      mframe = 0;
      world.style.setProperty('--gw-mx', mx.toFixed(3));
      world.style.setProperty('--gw-my', my.toFixed(3));
    });
  }, { passive: true });
}
