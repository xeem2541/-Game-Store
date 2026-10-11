// ฉาก 3D ของ hero หน้าแรก: กล่องเกม 3 กล่องที่ใช้ภาพปกจริง ลอยเรียงกันแบบพัด
// โหลดด้วย import() เฉพาะเมื่อ canRender3D() ผ่าน (ดู home.js) — ไม่ผ่านจะเห็นภาพปกแบบนิ่ง (.hero-stack) แทน
// หลักประสิทธิภาพ:
// - render เฉพาะตอนอยู่ในจอและแท็บเปิดอยู่, คืนหน่วยความจำ GPU เมื่อเลิกใช้
// - วัสดุแบบ MeshBasicMaterial ไม่มีแสง (ภาพปกแสดงสีตรงตามจริง และไม่ต้องคำนวณแสงทุกพิกเซล)
// - ปรับคุณภาพเองตามเครื่อง: เฟรมช้า → ลดความละเอียดลงทีละขั้น → ยังช้าอีกก็วาดครึ่งหนึ่งของเฟรม (เลื่อนหน้ายังลื่น)
import {
  AdditiveBlending, BoxGeometry, CanvasTexture, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry,
  Scene, SRGBColorSpace, Timer, WebGLRenderer,
} from './vendor/three.js';
import { onReducedMotionChange, watchVisibility } from './motion.js';

const MAX_PIXEL_RATIO = 1.5;
const MIN_PIXEL_RATIO = 0.75;
const SLOW_FRAME = 1 / 40; // เฉลี่ยช้ากว่า 40 fps ถือว่าเครื่องไม่ไหว
const BOX = { w: 4, h: 3, d: 0.32 }; // สัดส่วน 4:3 ตามภาพปก
// ตำแหน่งกล่อง [x, y, z, หมุนแกน y] — กล่องกลางอยู่หน้าสุด
const LAYOUT = [
  [0, 0, 0.8, -0.28],
  [-2.9, -0.7, -1.2, 0.42],
  [2.7, 0.8, -1.6, -0.55],
];

// วาดภาพปกลง canvas ความละเอียดคงที่ — ปกที่เป็น SVG (400×300) จะคมขึ้น และได้ texture ขนาดเดียวกันทุกภาพ
function loadCover(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = 800; c.height = 600;
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const tex = new CanvasTexture(c);
      tex.colorSpace = SRGBColorSpace;
      resolve(tex);
    };
    img.onerror = reject;
    img.src = url;
  });
}

// แสงฟุ้งด้านหลังกล่อง (ภาพ gradient ที่สร้างเอง ไม่ต้องโหลดไฟล์)
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, 'rgba(139,92,246,0.55)');
  grd.addColorStop(0.5, 'rgba(255,90,31,0.18)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  return new CanvasTexture(c);
}

export function mountHeroScene(container, { covers = [] } = {}) {
  if (!container) return null;
  const renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
  let pixelRatio = Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO);
  renderer.setPixelRatio(pixelRatio);
  renderer.domElement.className = 'hero-canvas';
  container.append(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.z = 17;

  const stack = new Group();
  scene.add(stack);

  const glow = new Mesh(new PlaneGeometry(16, 16), new MeshBasicMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: AdditiveBlending }));
  glow.position.z = -4;
  stack.add(glow);

  // วัสดุ 6 ด้านของกล่อง (ลำดับของ BoxGeometry: ขวา ซ้าย บน ล่าง หน้า หลัง) — ด้านข้างใช้ร่วมกัน ด้านหน้าคือปก
  const edge = new MeshBasicMaterial({ color: 0x1b2130 });
  const spine = new MeshBasicMaterial({ color: 0xff5a1f });
  const back = new MeshBasicMaterial({ color: 0x10141d });
  const geo = new BoxGeometry(BOX.w, BOX.h, BOX.d);
  const boxes = LAYOUT.map(([x, y, z, ry], i) => {
    const front = new MeshBasicMaterial({ color: 0x232a3a }); // สีพื้นระหว่างรอภาพปก
    const box = new Mesh(geo, [edge, spine, edge, edge, front, back]);
    box.position.set(x, y, z);
    box.rotation.set(0.06, ry, i === 0 ? -0.04 : 0.05 * (i === 1 ? 1 : -1));
    box.userData = { base: [x, y, z], ry, phase: i * 2.1 };
    stack.add(box);
    if (covers[i]) {
      loadCover(covers[i]).then((tex) => {
        front.map = tex;
        front.color.set(0xffffff);
        front.needsUpdate = true;
      }).catch(() => {}); // โหลดภาพไม่ได้ → กล่องสีพื้นต่อไป
    }
    return box;
  });

  // จอแคบ (canvas เต็มความกว้างอยู่หลังข้อความ): ย่อและยกกล่องไปมุมขวาบน ไม่ให้ทับข้อความ
  let narrow = false;
  // วัดขนาดจาก canvas เอง (desktop กว้างแค่ 62% ของ hero) — ใช้ขนาดกล่องแม่จะได้สัดส่วนกล้องผิด ภาพปกถูกบีบ
  const canvas = renderer.domElement;
  const resize = () => {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    narrow = camera.aspect < 1;
    // desktop: canvas เริ่มที่ 38% ของ hero แต่ข้อความกว้างถึงราว 55% → ย่อและเลื่อนกลุ่มไปทางขวาให้พ้นข้อความ
    stack.scale.setScalar(narrow ? 0.62 : 0.8);
    stack.position.set(narrow ? 1.6 : 1.4, narrow ? 3.2 : 0, 0);
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  let pointerX = 0;
  let pointerY = 0;
  const onPointer = (e) => { pointerX = (e.clientX / innerWidth - 0.5) * 2; pointerY = (e.clientY / innerHeight - 0.5) * 2; };
  // ความคืบหน้าการเลื่อนผ่าน hero (0 → 1): กล่องกางออกและหมุนตามการเลื่อน
  let scrollP = 0;
  const onScroll = () => { scrollP = Math.min(1, scrollY / (container.clientHeight || 1)); };
  onScroll();

  const timer = new Timer();
  let frame = 0;
  let inView = true;
  let slowSum = 0;
  let slowCount = 0;
  let halfRate = false;
  let skip = false;

  // วัดเวลาเฉลี่ยทุก 90 เฟรม: ช้า → ลดความละเอียด, ต่ำสุดแล้วยังช้า → วาดเฟรมเว้นเฟรม
  const adapt = (dt) => {
    slowSum += dt;
    if (++slowCount < 90) return;
    const avg = slowSum / slowCount;
    slowSum = slowCount = 0;
    if (avg < SLOW_FRAME) return;
    if (pixelRatio > MIN_PIXEL_RATIO) {
      pixelRatio = Math.max(MIN_PIXEL_RATIO, pixelRatio - 0.25);
      renderer.setPixelRatio(pixelRatio);
      resize();
    } else {
      halfRate = true;
    }
    renderer.domElement.dataset.quality = halfRate ? 'half-rate' : String(pixelRatio);
  };

  const loop = (now) => {
    frame = requestAnimationFrame(loop);
    if (halfRate && (skip = !skip)) return;
    timer.update(now);
    const t = timer.getElapsed();
    const dt = timer.getDelta();
    if (dt > 0 && dt < 0.5) adapt(dt);

    const intro = Math.min(1, t / 1.2);
    const ease = 1 - (1 - intro) ** 3; // ลอยขึ้นมาตอนเริ่ม
    const spread = 1 + scrollP * 0.35;
    boxes.forEach((box, i) => {
      const { base, ry, phase } = box.userData;
      box.position.x = base[0] * spread;
      box.position.y = base[1] + Math.sin(t * 0.9 + phase) * 0.18 - (1 - ease) * (3 + i);
      box.position.z = base[2];
      box.rotation.y = ry + Math.sin(t * 0.5 + phase) * 0.06 + scrollP * (i === 0 ? 0.5 : -0.3);
    });
    // เอียงทั้งกลุ่มตามเมาส์แบบหน่วงเล็กน้อย
    stack.rotation.y += (pointerX * 0.25 - stack.rotation.y) * 0.05;
    stack.rotation.x += (pointerY * 0.15 + scrollP * 0.25 - stack.rotation.x) * 0.05;
    renderer.render(scene, camera);
  };
  const start = () => {
    if (frame || !inView || document.hidden) return;
    timer.reset(); // ไม่นับช่วงที่หยุดไว้ (ไม่งั้นเฟรมแรกหลังกลับมาจะกระโดด)
    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    renderer.domElement.dataset.running = 'true'; // ให้เทสตรวจได้ว่าหยุด render จริงเมื่อออกนอกจอ
    frame = requestAnimationFrame(loop);
  };
  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    window.removeEventListener('pointermove', onPointer);
    window.removeEventListener('scroll', onScroll);
    renderer.domElement.dataset.running = 'false';
  };

  const unwatch = watchVisibility(container, (visible) => { inView = visible; visible ? start() : stop(); });
  const onVisibility = () => (document.hidden ? stop() : start());
  document.addEventListener('visibilitychange', onVisibility);

  const destroy = () => {
    stop();
    unwatch();
    ro.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
    scene.traverse((o) => {
      o.geometry?.dispose();
      for (const m of [].concat(o.material ?? [])) { m.map?.dispose(); m.dispose(); }
    });
    timer.dispose();
    renderer.dispose();
    renderer.domElement.remove();
    container.classList.remove('has-3d');
  };
  onReducedMotionChange((reduce) => { if (reduce) destroy(); }); // ผู้ใช้เปิดลดการเคลื่อนไหวระหว่างดูหน้า → กลับไปใช้ภาพนิ่ง

  requestAnimationFrame(() => {
    renderer.domElement.classList.add('ready'); // ค่อย ๆ ปรากฏทับภาพนิ่ง
    container.classList.add('has-3d'); // ซ่อนภาพปกแบบนิ่ง (ฉาก 3D แสดงภาพเดียวกันแล้ว)
  });
  start();
  return { destroy };
}
