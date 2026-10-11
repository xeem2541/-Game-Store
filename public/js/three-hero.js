// ฉาก 3D ของ hero หน้าแรก — โหลดด้วย import() เฉพาะเมื่อ canRender3D() ผ่าน (ดู home.js)
// หลักประสิทธิภาพ: render เฉพาะตอนอยู่ในจอและแท็บเปิดอยู่, จำกัด pixel ratio, คืนหน่วยความจำ GPU เมื่อเลิกใช้
import {
  AmbientLight, Clock, DirectionalLight, IcosahedronGeometry, Mesh, MeshBasicMaterial, MeshPhysicalMaterial,
  PerspectiveCamera, Scene, TorusKnotGeometry, WebGLRenderer,
} from './vendor/three.js';
import { onReducedMotionChange, watchVisibility } from './motion.js';

const MAX_PIXEL_RATIO = 1.5;

export function mountHeroScene(container) {
  if (!container) return null;
  const renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
  renderer.domElement.className = 'hero-canvas';
  container.append(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.z = 15;

  const torus = new Mesh(
    new TorusKnotGeometry(3, 0.8, 128, 32),
    // ไม่ใช้ transmission (กระจกหักเหแสง) เพราะต้อง render ฉากซ้ำอีกรอบทุกเฟรม — หนักเกินไปบนมือถือ
    new MeshPhysicalMaterial({ color: 0x8b5cf6, metalness: 0.9, roughness: 0.15, clearcoat: 1, emissive: 0x100030, emissiveIntensity: 0.2 }),
  );
  const core = new Mesh(new IcosahedronGeometry(1.5, 1), new MeshBasicMaterial({ color: 0xff5a1f, wireframe: true, transparent: true, opacity: 0.5 }));
  scene.add(torus, core, new AmbientLight(0xffffff, 0.5));
  const key = new DirectionalLight(0xa3ff5f, 2); key.position.set(5, 5, 5);
  const rim = new DirectionalLight(0xff5a1f, 2); rim.position.set(-5, -5, 5);
  scene.add(key, rim);

  const resize = () => {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  let pointerX = 0;
  let pointerY = 0;
  const onPointer = (e) => { pointerX = (e.clientX / innerWidth - 0.5) * 2; pointerY = (e.clientY / innerHeight - 0.5) * 2; };

  const clock = new Clock();
  let frame = 0;
  let inView = true;
  const loop = () => {
    frame = requestAnimationFrame(loop);
    const t = clock.getElapsedTime();
    torus.rotation.x += 0.004 + (pointerY * 0.5 - torus.rotation.x) * 0.04;
    torus.rotation.y += 0.008 + (pointerX * 0.5 - torus.rotation.y) * 0.04;
    core.rotation.x -= 0.01;
    core.rotation.y -= 0.015;
    torus.position.y = core.position.y = Math.sin(t) * 0.5;
    renderer.render(scene, camera);
  };
  const start = () => {
    if (frame || !inView || document.hidden) return;
    clock.start();
    window.addEventListener('pointermove', onPointer, { passive: true });
    renderer.domElement.dataset.running = 'true'; // ให้เทสตรวจได้ว่าหยุด render จริงเมื่อออกนอกจอ
    loop();
  };
  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    clock.stop();
    window.removeEventListener('pointermove', onPointer);
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
    scene.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
    renderer.dispose();
    renderer.domElement.remove();
  };
  onReducedMotionChange((reduce) => { if (reduce) destroy(); }); // ผู้ใช้เปิดลดการเคลื่อนไหวระหว่างดูหน้า → กลับไปใช้พื้นหลังนิ่ง

  requestAnimationFrame(() => renderer.domElement.classList.add('ready')); // ค่อย ๆ ปรากฏทับพื้นหลังนิ่ง
  start();
  return { destroy };
}
