// Small deterministic helpers. Everything in the film is a pure function of time,
// so any frame can be rendered independently (this is what makes chunked rendering work).
import * as THREE from 'three';

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const smoother = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * t * (t * (t * 6 - 15) + 10); };
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t) => 1 - Math.pow(1 - clamp(t), 3);
export const easeIn = (t) => Math.pow(clamp(t), 3);

export function hash11(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
export function noise1(x) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return (hash11(i) * (1 - u) + hash11(i + 1) * u) * 2 - 1;
}

// Cubic-Hermite (Catmull-Rom style) track through keyframes [[t, v], ...]; v is number or array.
export function track(keys, t) {
  const n = keys.length;
  if (t <= keys[0][0]) return keys[0][1];
  if (t >= keys[n - 1][0]) return keys[n - 1][1];
  let i = 0;
  while (i < n - 2 && t > keys[i + 1][0]) i++;
  const [t0, v0] = keys[i], [t1, v1] = keys[i + 1];
  const h = t1 - t0, s = (t - t0) / h;
  const p0 = i > 0 ? keys[i - 1] : null, p1 = i + 2 < n ? keys[i + 2] : null;
  const one = (k) => {
    const a = v0 instanceof Array ? v0[k] : v0, b = v1 instanceof Array ? v1[k] : v1;
    const pa = p0 ? (p0[1] instanceof Array ? p0[1][k] : p0[1]) : null;
    const pb = p1 ? (p1[1] instanceof Array ? p1[1][k] : p1[1]) : null;
    const m0 = pa === null ? (b - a) / h : (b - pa) / (t1 - p0[0]);
    const m1 = pb === null ? (b - a) / h : (pb - a) / (p1[0] - t0);
    const s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * a + (s3 - 2 * s2 + s) * h * m0 + (-2 * s3 + 3 * s2) * b + (s3 - s2) * h * m1;
  };
  if (v0 instanceof Array) return v0.map((_, k) => one(k));
  return one(0);
}

export const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

// Documentary hand-held drift (very small, slow).
export function drift(t, amp = 1, seed = 0) {
  return new THREE.Vector3(
    noise1(t * 0.37 + seed) + 0.5 * noise1(t * 0.91 + seed + 10),
    noise1(t * 0.31 + seed + 20) + 0.5 * noise1(t * 0.83 + seed + 30),
    noise1(t * 0.29 + seed + 40),
  ).multiplyScalar(amp);
}

// Pose a PerspectiveCamera.
export function pose(camera, pos, target, fov, roll = 0) {
  camera.position.set(pos[0], pos[1], pos[2]);
  camera.up.set(0, 1, 0);
  camera.lookAt(target[0], target[1], target[2]);
  if (roll) camera.rotateZ(roll);
  camera.fov = fov;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}

// Soft round sprite texture for glows.
export function glowTexture(size = 128) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.15, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.14)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
