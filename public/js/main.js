import * as THREE from 'three';
import { makePost } from './post.js';
import { LensQuad } from './lens.js';
import { Overlay } from './overlay.js';
import { buildScenes, CUTS } from './scenes.js';
import { smooth } from './util.js';

const params = new URLSearchParams(location.search);
const state = { ready: false };
window.__state = state;

async function loadFonts() {
  const faces = [
    ['Barlow Condensed', 500, 'barlow-condensed/files/barlow-condensed-latin-500-normal.woff2'],
    ['Barlow Condensed', 600, 'barlow-condensed/files/barlow-condensed-latin-600-normal.woff2'],
    ['Barlow Condensed', 700, 'barlow-condensed/files/barlow-condensed-latin-700-normal.woff2'],
    ['Inter', 400, 'inter/files/inter-latin-400-normal.woff2'],
    ['Inter', 500, 'inter/files/inter-latin-500-normal.woff2'],
  ];
  for (const [fam, w, p] of faces) {
    try { const f = new FontFace(fam, `url(/node_modules/@fontsource/${p})`, { weight: String(w) }); await f.load(); document.fonts.add(f); } catch (e) { console.warn('font', fam, w, e); }
  }
}

// window.__init({width,height,fps}) -> prepares renderer; window.__frame(i) renders frame i.
window.__init = async ({ width = 1920, height = 1080, fps = 30 } = {}) => {
  await loadFonts();
  const script = await (await fetch('/data/script.json')).json();
  let timings = null;
  try { const r = await fetch('/data/timings.json'); if (r.ok) timings = await r.json(); } catch (e) {}
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  document.body.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1); renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  const size = { w: width, h: height };
  const env = { size, aspect: width / height, lens: new LensQuad() };
  const scenes = buildScenes(env);
  const post = makePost(renderer, width, height);
  const overlay = new Overlay(width, height, script, timings);
  const ovTex = new THREE.CanvasTexture(overlay.canvas);
  ovTex.colorSpace = THREE.NoColorSpace; ovTex.premultiplyAlpha = true; ovTex.generateMipmaps = false; ovTex.minFilter = THREE.LinearFilter;
  post.finalPass.uniforms.tOverlay.value = ovTex;
  const total = script.duration;

  const fadeAt = (t) => {
    let f = smooth(0, 1.6, t) * (1 - smooth(total - 1.0, total - 0.05, t));
    for (const c of CUTS) f *= smooth(0, 0.45, Math.abs(t - c));
    return f;
  };

  window.__frame = (i) => {
    const t = i / fps;
    const sc = scenes.find((s) => t >= s.t0 && t < s.t1) || scenes[scenes.length - 1];
    const info = sc.s.update(t) || {};
    overlay.draw(t, { widgets: info.widgets || [] });
    ovTex.needsUpdate = true;
    post.renderPass.scene = sc.s.scene; post.renderPass.camera = sc.s.camera;
    const u = post.finalPass.uniforms;
    u.uTime.value = t; u.uFade.value = fadeAt(t); u.uFlash.value = info.flash || 0;
    if (info.flashPos) u.uFlashPos.value.set(info.flashPos[0], info.flashPos[1]);
    post.composer.render();
    return true;
  };
  window.__grab = (fmt = 'png', q = 0.95) => canvas.toDataURL(fmt === 'jpeg' ? 'image/jpeg' : 'image/png', q);
  state.ready = true; state.total = total; state.fps = fps;
  return { total, fps };
};

// Preview in a normal browser: /?preview=1&t=120&w=1280
if (params.get('preview')) {
  const w = +(params.get('w') || 1280), h = Math.round(w * 9 / 16);
  window.__init({ width: w, height: h, fps: 30 }).then(() => {
    let t = +(params.get('t') || 0);
    const loop = () => { window.__frame(Math.floor(t * 30)); if (!params.get('hold')) t += 1 / 30; requestAnimationFrame(loop); };
    loop();
  });
}
