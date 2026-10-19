// Deterministic frame renderer: headless Chrome (WebGL via SwiftShader/ANGLE or a real GPU) -> ffmpeg.
//
//   node render/render.mjs --preset 1080p --start 0 --end 480 --out out/film_1080p.mp4
//   node render/render.mjs --preset 4k --start 120 --end 144 --out out/chunk_005.mp4     (one chunk of a parallel render)
//   node render/render.mjs --preset 1080p --frames 0,900,3000 --dump out/stills          (QA stills only)
import puppeteer from 'puppeteer';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from './serve.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]] : a), []));
const PRESETS = { '1080p': { w: 1920, h: 1080, crf: 15 }, '4k': { w: 3840, h: 2160, crf: 16 } };
const preset = PRESETS[args.preset || '1080p'];
if (!preset) throw new Error('--preset must be 1080p or 4k');
const fps = +(args.fps || 30);
const startF = Math.round(+(args.start ?? 0) * fps), endF = Math.round(+(args.end ?? 480) * fps);
const fmt = args.format || 'png';
const out = args.out || `out/film_${args.preset || '1080p'}.mp4`;
const x264preset = args['x264-preset'] || 'slow';

const { server, port } = await startServer(0);
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  headless: 'shell',
  protocolTimeout: 600000,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist', '--enable-webgl', '--disable-dev-shm-usage', '--hide-scrollbars', '--mute-audio',
    ...(process.env.CHROME_EXTRA_ARGS ? process.env.CHROME_EXTRA_ARGS.split(' ') : [])],
});
const page = await browser.newPage();
page.on('console', (m) => { const t = m.text(); if (/error|warn|fail/i.test(t)) console.log('[page]', t.slice(0, 300)); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
await page.evaluate(async (o) => { await window.__init(o); }, { width: preset.w, height: preset.h, fps });
const renderer = await page.evaluate(() => { const c = document.createElement('canvas'); const gl = c.getContext('webgl2'); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
console.log(`renderer: ${renderer}`);

const grab = async (i) => {
  const dataUrl = await page.evaluate((i, fmt) => { window.__frame(i); return window.__grab(fmt, 0.97); }, i, fmt);
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
};

if (args.frames) {
  const dir = args.dump || 'out/stills'; fs.mkdirSync(dir, { recursive: true });
  for (const f of String(args.frames).split(',').map(Number)) {
    const t0 = Date.now(); const buf = await grab(f);
    fs.writeFileSync(path.join(dir, `${args.preset || '1080p'}_f${String(f).padStart(5, '0')}.${fmt === 'jpeg' ? 'jpg' : 'png'}`), buf);
    console.log(`frame ${f} (t=${(f / fps).toFixed(2)}s) ${(Date.now() - t0) / 1000}s`);
  }
  await browser.close(); server.close(); process.exit(0);
}

fs.mkdirSync(path.dirname(out), { recursive: true });
const ff = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', fmt === 'jpeg' ? 'mjpeg' : 'png', '-i', '-',
  '-vf', 'scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p', '-c:v', 'libx264', '-preset', x264preset, '-crf', String(preset.crf),
  '-g', String(fps * 2), '-bf', '2', '-r', String(fps), '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
  '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
ff.on('error', (e) => { console.error('ffmpeg failed to start', e); process.exit(1); });

const t0 = Date.now(); let done = 0; const total = endF - startF;
for (let i = startF; i < endF; i++) {
  const buf = await grab(i);
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  done++;
  if (done % 30 === 0 || done === total) {
    const el = (Date.now() - t0) / 1000, rate = done / el, eta = (total - done) / rate;
    console.log(`frame ${i + 1}/${endF}  ${rate.toFixed(2)} fps  elapsed ${el.toFixed(0)}s  eta ${(eta / 60).toFixed(1)} min`);
  }
}
ff.stdin.end();
await new Promise((r) => ff.on('close', r));
await browser.close(); server.close();
console.log(`done -> ${out}`);
