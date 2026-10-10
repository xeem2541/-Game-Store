import { THREE } from './vendor.bundle.js';

export function initThreeHero(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
  camera.position.z = 15;

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  // Holographic/Abstract Portal
  const geometry = new THREE.TorusKnotGeometry(3, 0.8, 128, 32);
  
  // Custom Material for Futuristic Glass/Chrome look
  const material = new THREE.MeshPhysicalMaterial({
    color: 0x8B5CF6,
    metalness: 0.9,
    roughness: 0.1,
    transmission: 0.8, // glass-like
    ior: 1.5,
    thickness: 1.0,
    wireframe: false,
    emissive: 0x100030,
    emissiveIntensity: 0.2
  });
  
  const torus = new THREE.Mesh(geometry, material);
  scene.add(torus);

  // Inner abstract core
  const coreGeom = new THREE.IcosahedronGeometry(1.5, 1);
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xFF5A1F, wireframe: true, transparent: true, opacity: 0.5 });
  const core = new THREE.Mesh(coreGeom, coreMat);
  scene.add(core);

  // Lights
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xA3FF5F, 2);
  dirLight.position.set(5, 5, 5);
  scene.add(dirLight);

  const dirLight2 = new THREE.DirectionalLight(0xFF5A1F, 2);
  dirLight2.position.set(-5, -5, 5);
  scene.add(dirLight2);

  let targetX = 0;
  let targetY = 0;
  
  const mql = window.matchMedia('(prefers-reduced-motion: reduce)');

  if (!mql.matches) {
    document.addEventListener('mousemove', (e) => {
      targetX = (e.clientX / window.innerWidth - 0.5) * 2;
      targetY = (e.clientY / window.innerHeight - 0.5) * 2;
    });
  }

  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);

    const time = clock.getElapsedTime();

    if (!mql.matches) {
      torus.rotation.x += 0.005;
      torus.rotation.y += 0.01;
      
      core.rotation.x -= 0.01;
      core.rotation.y -= 0.015;

      // Pointer interaction
      torus.rotation.x += (targetY * 0.5 - torus.rotation.x) * 0.05;
      torus.rotation.y += (targetX * 0.5 - torus.rotation.y) * 0.05;
      
      // Floating
      torus.position.y = Math.sin(time) * 0.5;
      core.position.y = Math.sin(time) * 0.5;
    }

    renderer.render(scene, camera);
  }

  animate();

  window.addEventListener('resize', () => {
    if(!container) return;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });
}
