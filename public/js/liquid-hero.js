// พื้นหลัง hero หน้าแรกแบบ "แสงของเหลว" (UI เฟส 25): shader สีแบรนด์ (ส้ม/ม่วง) ไหลช้า ๆ และเบนตามเมาส์/นิ้ว
// WebGL ล้วน (ไม่ใช้ three.js — ทั้งไฟล์ไม่กี่ KB) โหลดด้วย import() หลังหน้าแสดงผล เฉพาะเครื่องที่ canRenderShader() ผ่าน — มี GPU จริง (ดู home.js)
// หลักประสิทธิภาพ:
// - วาดที่ความละเอียดต่ำแล้วให้ CSS ขยาย (ภาพฟุ้งอยู่แล้ว ไม่เห็นความต่าง) — มือถือ 30 fps
// - หยุดเมื่อออกนอกจอ/สลับแท็บ; เครื่องช้า → ลดความละเอียด → ยังช้าอีกก็เลิกวาดและคืนภาพนิ่งเดิม
// - ข้อความ hero อยู่ฝั่งซ้าย: shader หรี่แสงฝั่งซ้ายลงเอง (คอนทราสต์ข้อความไม่ลดลง)
import { onReducedMotionChange, watchVisibility } from './motion.js';

const VERT = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;
// fbm 4 ชั้น + domain warp 2 รอบ — ราคาถูกพอสำหรับภาพความละเอียดต่ำ
const FRAG = `precision mediump float;
uniform vec2 uRes; uniform float uTime; uniform vec2 uMouse; uniform float uNarrow;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * n(p); p = p * 2.03 + 7.1; a *= 0.5; } return v; }
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float t = uTime * 0.06;
  vec2 m = (uMouse - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  p += (p - m) * 0.18 * exp(-2.5 * length(p - m)); // ของเหลวถูกดันออกรอบเคอร์เซอร์
  vec2 q = vec2(fbm(p * 1.4 + t), fbm(p * 1.4 - t + 3.7));
  vec2 r = vec2(fbm(p * 1.8 + 2.2 * q + vec2(1.7, 9.2) + t * 1.3), fbm(p * 1.8 + 2.2 * q + vec2(8.3, 2.8) - t));
  float f = fbm(p * 1.6 + 2.6 * r);
  vec3 bg = vec3(0.031, 0.039, 0.059);
  vec3 violet = vec3(0.545, 0.361, 0.965);
  vec3 orange = vec3(1.0, 0.353, 0.122);
  vec3 col = mix(bg, violet * 0.55, smoothstep(0.35, 0.85, f));
  col = mix(col, orange * 0.75, smoothstep(0.55, 0.95, r.x * f * 1.6));
  col += orange * 0.22 * exp(-6.0 * length(p - m)); // แสงตามเคอร์เซอร์
  // หรี่ฝั่งข้อความ: จอกว้าง = ฝั่งซ้าย, จอแคบ = ทั้งจอหรี่ลงและสว่างขึ้นทางด้านบนขวา
  float side = mix(smoothstep(0.05, 0.75, uv.x), 0.55 * smoothstep(0.2, 1.0, uv.y + uv.x * 0.4), uNarrow);
  col = mix(bg, col, 0.25 + 0.75 * side);
  col *= 1.0 - 0.35 * length(uv - 0.5); // vignette
  gl_FragColor = vec4(col, 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader compile failed');
  return s;
}

export function mountLiquidHero(container) {
  const canvas = document.createElement('canvas');
  canvas.className = 'hero-liquid';
  canvas.setAttribute('aria-hidden', 'true');
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, powerPreference: 'low-power', preserveDrawingBuffer: false });
  if (!gl) return null;
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('shader link failed');
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); // สามเหลี่ยมเดียวคลุมทั้งจอ
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = Object.fromEntries(['uRes', 'uTime', 'uMouse', 'uNarrow'].map((k) => [k, gl.getUniformLocation(prog, k)]));

  // แทรกไว้หลังภาพนิ่ง (.hero-fallback) แต่ก่อนฉาก 3D — ฉาก 3D ที่โหลดทีหลังจึงอยู่ชั้นบนเสมอ
  const fallback = container.querySelector('.hero-fallback');
  if (fallback) fallback.after(canvas); else container.prepend(canvas);

  const coarse = matchMedia('(pointer: coarse)').matches;
  let scale = coarse ? 0.3 : 0.45; // พิกเซลจริงต่อพิกเซล CSS
  const minFrame = coarse ? 1000 / 30 : 0; // มือถือ 30 fps
  const resize = () => {
    const w = Math.max(1, Math.round(canvas.clientWidth * scale));
    const h = Math.max(1, Math.round(canvas.clientHeight * scale));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
    gl.uniform2f(u.uRes, w, h);
    gl.uniform1f(u.uNarrow, canvas.clientWidth < 901 ? 1 : 0);
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  // เมาส์/นิ้ว (พิกัด 0..1 ภายใน canvas, y ชี้ขึ้นแบบ WebGL) — ค่าที่ใช้วาดไล่ตามช้า ๆ ให้ดูหนืดเหมือนของเหลว
  const target = { x: 0.75, y: 0.55 };
  const mouse = { ...target };
  const onPointer = (e) => {
    const r = canvas.getBoundingClientRect();
    target.x = (e.clientX - r.left) / r.width;
    target.y = 1 - (e.clientY - r.top) / r.height;
  };

  let frame = 0;
  let last = 0;
  let slow = 0;
  let count = 0;
  const t0 = performance.now();
  const loop = (now) => {
    frame = requestAnimationFrame(loop);
    if (now - last < minFrame) return;
    const dt = last ? now - last : 16;
    last = now;
    // เครื่องช้า (เฉลี่ย > 40 ms/เฟรมใน 60 เฟรม): ลดความละเอียด — ต่ำสุดแล้วยังช้าก็เลิกวาด
    slow += dt; count += 1;
    if (count === 60) {
      if (slow / count > 40) {
        if (scale > 0.2) { scale = Math.max(0.2, scale - 0.1); resize(); } else { destroy(); return; }
      }
      slow = 0; count = 0;
    }
    mouse.x += (target.x - mouse.x) * 0.04;
    mouse.y += (target.y - mouse.y) * 0.04;
    gl.uniform1f(u.uTime, (now - t0) / 1000);
    gl.uniform2f(u.uMouse, mouse.x, mouse.y);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    canvas.dataset.frames = String((Number(canvas.dataset.frames) || 0) + 1); // ให้เทสตรวจได้ว่าวาดอยู่/หยุดแล้ว
  };
  let inView = true;
  const start = () => {
    if (frame || !inView || document.hidden) return;
    last = 0;
    window.addEventListener('pointermove', onPointer, { passive: true });
    canvas.dataset.running = 'true';
    frame = requestAnimationFrame(loop);
  };
  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    window.removeEventListener('pointermove', onPointer);
    canvas.dataset.running = 'false';
  };
  const unwatch = watchVisibility(container, (v) => { inView = v; v ? start() : stop(); });
  const onVisibility = () => (document.hidden ? stop() : start());
  document.addEventListener('visibilitychange', onVisibility);
  canvas.addEventListener('webglcontextlost', () => destroy());

  let destroyed = false;
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    stop();
    unwatch();
    ro.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    canvas.remove(); // ภาพนิ่ง .hero-fallback ยังอยู่ข้างใต้
  }
  onReducedMotionChange((reduce) => { if (reduce) destroy(); });

  resize();
  start();
  requestAnimationFrame(() => canvas.classList.add('ready')); // ค่อย ๆ ปรากฏทับภาพนิ่ง
  return { destroy };
}
