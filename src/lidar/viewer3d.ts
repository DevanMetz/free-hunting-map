import {
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  LinearSRGBColorSpace,
  NoToneMapping,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { PointCloud } from './cloud';
import { h } from '../ui/dom';

const STOPS: readonly (readonly [number, number, number])[] = [
  [0.22, 0.55, 0.95],
  [0.12, 0.78, 0.72],
  [0.42, 0.80, 0.28],
  [0.98, 0.76, 0.18],
  [0.98, 0.96, 0.90],
];

function pointTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  if (g) {
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(32, 32, 28, 0, Math.PI * 2);
    g.fill();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = LinearSRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function paint(cloud: PointCloud, colors: Float32Array, mode: 'height' | 'intensity'): void {
  const [lo, hi] = mode === 'height' ? cloud.heightRange : cloud.intensityRange;
  const src = mode === 'height' ? cloud.height : cloud.intensity;
  const span = hi - lo || 1;
  for (let i = 0; i < cloud.count; i++) {
    const t = Math.min(1, Math.max(0, (src[i]! - lo) / span));
    const offset = i * 3;
    if (mode === 'intensity') {
      const v = 0.55 + 0.45 * t;
      colors[offset] = v;
      colors[offset + 1] = v;
      colors[offset + 2] = v;
    } else {
      const x = t * (STOPS.length - 1);
      const j = Math.min(STOPS.length - 2, Math.floor(x));
      const f = x - j;
      const a = STOPS[j]!, b = STOPS[j + 1]!;
      colors[offset] = a[0] + (b[0] - a[0]) * f;
      colors[offset + 1] = a[1] + (b[1] - a[1]) * f;
      colors[offset + 2] = a[2] + (b[2] - a[2]) * f;
    }
  }
}

/** Full-screen orbit viewer. The returned function removes the canvas, listeners, and WebGL context. */
export function mountPointCloud(cloud: PointCloud, onClose: () => void): () => void {
  const canvas = h('canvas');
  const closeBtn = h('button', { type: 'button', class: 'btn' }, 'Close');
  const heightBtn = h('button', { type: 'button', class: 'btn primary', 'aria-pressed': 'true' }, 'Height');
  const intensityBtn = h('button', { type: 'button', class: 'btn', 'aria-pressed': 'false' }, 'Intensity');
  const root = h('div', { class: 'lidar-3d', role: 'dialog', 'aria-modal': 'true', 'aria-label': '3D lidar', 'data-points': String(cloud.count) },
    canvas,
    h('div', { class: 'lidar-3d-bar' }, closeBtn, heightBtn, intensityBtn),
  );
  document.body.append(root);
  closeBtn.onclick = onClose;

  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  } catch (err) {
    root.remove();
    throw err;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = LinearSRGBColorSpace;
  renderer.toneMapping = NoToneMapping;
  renderer.setClearColor(0x141a16, 1);

  const scene = new Scene();
  const camera = new PerspectiveCamera(55, 1, 0.05, 100_000);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(cloud.positions, 3));
  const colorAttr = new Float32BufferAttribute(cloud.count * 3, 3);
  paint(cloud, colorAttr.array as Float32Array, 'height');
  colorAttr.needsUpdate = true;
  geometry.setAttribute('color', colorAttr);
  const texture = pointTexture();
  const material = new PointsMaterial({
    size: 3.2 * Math.min(window.devicePixelRatio || 1, 2),
    vertexColors: true,
    sizeAttenuation: false,
    map: texture,
    alphaTest: 0.5,
    transparent: false,
    depthWrite: true,
  });
  scene.add(new Points(geometry, material));

  const distance = Math.max(cloud.span * 1.15, 30);
  camera.position.set(distance * 0.42, distance * 0.9, distance * 0.42);
  camera.near = Math.max(cloud.span / 8000, 0.05);
  camera.far = Math.max(cloud.span * 30, 100);
  camera.updateProjectionMatrix();
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.zoomToCursor = true;
  controls.minDistance = Math.max(cloud.span / 200, 0.5);
  controls.maxDistance = cloud.span * 8;
  controls.update();

  const resize = (): void => {
    const width = root.clientWidth, height = root.clientHeight;
    if (!width || !height) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(root);

  const setMode = (mode: 'height' | 'intensity'): void => {
    paint(cloud, colorAttr.array as Float32Array, mode);
    colorAttr.needsUpdate = true;
    const heightOn = mode === 'height';
    heightBtn.classList.toggle('primary', heightOn);
    intensityBtn.classList.toggle('primary', !heightOn);
    heightBtn.setAttribute('aria-pressed', String(heightOn));
    intensityBtn.setAttribute('aria-pressed', String(!heightOn));
  };
  heightBtn.onclick = () => setMode('height');
  intensityBtn.onclick = () => setMode('intensity');

  let disposed = false;
  let frame = 0;
  const loop = (): void => {
    if (disposed) return;
    frame = requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
  };
  frame = requestAnimationFrame(loop);
  closeBtn.focus();

  return () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    controls.dispose();
    geometry.dispose();
    material.dispose();
    texture.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    root.remove();
  };
}
