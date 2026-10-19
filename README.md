# When Wormholes Collide — 8-minute Three.js / WebGL documentary

Technical Talk India · 480 s · 30 fps · **1080p and 4K** · rendered on GitHub Actions

Based on: ScienceAlert, *"Physicists Simulated What Might Happen When Two Wormholes Collide, And Things Got Weird"* (M. Starr, 17 Oct 2026),
the Shirokov & Nachevsky preprint on binary Ellis–Bronnikov wormholes (arXiv:2610.13206, not yet peer-reviewed) and Shirokov, arXiv:2604.00071.

## Render it (GitHub Actions)
1. Create a new **public** GitHub repository and push this folder (`git init && git add . && git commit -m init && git push`).
2. Open **Actions → Render documentary → Run workflow**. Choose `both`, `1080p` or `4k`.
3. When it finishes, download `film-1080p` / `film-4k` from the run's **Artifacts** (or tick *create_release* to get a Release).

How it works: the film is a pure function of time, so it is cut into chunks (40 s for 1080p, 20 s for 4K) that render **in parallel**
on separate runners, then are joined and muxed with the audio. Audio is built first: neural narration (edge-tts, voice `en-GB-RyanNeural`,
change it in the workflow form) plus a synthesized score and sound design synced to the picture. Subtitles use the real narration timings.

**Cost / time (measured on a 2-core machine):** ≈2.3 s per 1080p frame and ≈11 s per 4K frame (software WebGL, no GPU).
That is ≈9 runner-hours for 1080p and ≈45 for 4K in total, split across parallel jobs (each job well under the 6 h limit).
Public repositories get this free; private repositories will burn through the free-minute quota, mainly at 4K.

## Render locally
```
npm ci
npm run preview            # http://127.0.0.1:8080/?preview=1&t=120&w=1280  (live scrubbing in a browser)
python3 -m pip install numpy scipy edge-tts && python3 audio/build_audio.py     # audio -> build/audio
node render/render.mjs --preset 1080p --out out/film_1080p.mp4                  # full film, video only
node render/render.mjs --preset 4k --start 120 --end 140 --out out/test.mp4     # any time range
node render/render.mjs --preset 1080p --frames 600,3000 --dump out/stills       # stills for checking
```
Needs Node 22+, ffmpeg, Python 3.10+. A real GPU is used automatically if Chrome can see one; otherwise SwiftShader is used.

## What is real and what is artistic
* **Lensing is computed, not faked**: light-bending tables are integrated from the actual null-geodesic equations of the Ellis–Bronnikov wormhole
  (rays through the throat show a *different* sky) and of a Schwarzschild black hole (checked against the weak-field 4M/b limit and the strong-field log form).
* **Two interacting wormholes have no closed-form metric.** The collision scenes combine single-wormhole optics and are an **artist's visualization**
  of the outcomes described in the preprint (attract/repel, flyby with expanding throats, common apparent horizon, horizon area −28 %, short bursts
  instead of a chirp). They are **not** output of the researchers' numerical-relativity simulation; the film says so on screen throughout.
* Waveforms and plots are illustrative. Facts and figures narrated come from the sources above.

## Layout
`public/data/script.json` narration, timings, cards · `public/js/scenes.js` all scenes · `public/js/lens.js` + `lutmath.js` relativistic lensing ·
`public/js/overlay.js` titles/subtitles/plots · `render/` headless renderer → ffmpeg · `audio/build_audio.py` soundtrack · `.github/workflows/render.yml`.
