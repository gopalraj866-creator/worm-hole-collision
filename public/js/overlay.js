// 2D documentary graphics layer: title, chapter cards, lower-third info cards, subtitles,
// and illustrative data plots. Drawn to a canvas, composited in the final shader pass.
import { clamp, lerp, smooth, easeOut } from './util.js';

const FONT_HEAD = '"Barlow Condensed", "Arial Narrow", sans-serif';
const FONT_BODY = '"Inter", "Helvetica Neue", Arial, sans-serif';
const GOLD = '#ffc46b', CYAN = '#6fd6ff', VIOLET = '#c79bff', WHITE = '#f4f7fb';

export class Overlay {
  constructor(W, H, script, timings) {
    this.W = W; this.H = H; this.script = script;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.g = this.canvas.getContext('2d');
    this.u = H / 1080; // design in 1080p units
    // subtitle windows: prefer real TTS durations when available
    this.subs = script.narration.map((n, i) => {
      const next = script.narration[i + 1];
      const real = timings && timings[n.id];
      const words = n.text.split(/\s+/).length;
      const est = real || Math.max(1.8, words / 2.55);
      const end = Math.min(n.t + est + 0.25, next ? next.t - 0.1 : 480);
      return { t0: n.t, t1: end, text: n.text };
    });
  }

  wrap(g, text, maxW) {
    const words = text.split(' '); const lines = []; let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (g.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }

  spaced(g, text, x, y, spacing, align = 'left') {
    // letter-spaced text using the native canvas letterSpacing (kerning-aware)
    g.letterSpacing = spacing + 'px';
    const w = g.measureText(text).width - spacing;
    const prev = g.textAlign; g.textAlign = 'left';
    const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    g.fillText(text, x0, y);
    g.textAlign = prev; g.letterSpacing = '0px';
    return w;
  }

  draw(t, ctxInfo = {}) {
    const { g, W, H, u } = this;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    g.scale(u, u);
    const w = 1920, h = 1080;
    g.textBaseline = 'alphabetic';

    // ---------- film title ----------
    const tt = t - 0.0;
    if (tt < 6.5) {
      const a = smooth(0.4, 1.4, tt) * (1 - smooth(4.4, 6.2, tt));
      if (a > 0.001) {
        g.save(); g.globalAlpha = a; g.fillStyle = WHITE; g.textAlign = 'center';
        g.font = `600 128px ${FONT_HEAD}`;
        this.spaced(g, this.script.title, w / 2, h / 2 + 12, 16, 'center');
        g.font = `500 30px ${FONT_BODY}`; g.fillStyle = GOLD;
        this.spaced(g, 'A  TECHNICAL TALK INDIA  DOCUMENTARY', w / 2, h / 2 + 78, 9, 'center');
        g.restore();
      }
    }

    // ---------- chapter cards (bottom-left) ----------
    for (const c of this.script.chapters) {
      const dt = t - c.t0;
      if (dt > 0.4 && dt < 5.2) {
        const a = smooth(0.4, 1.0, dt) * (1 - smooth(4.4, 5.2, dt));
        const slide = (1 - easeOut((dt - 0.4) / 1.2)) * 30;
        g.save(); g.globalAlpha = a; g.textAlign = 'left';
        g.fillStyle = GOLD; g.font = `600 30px ${FONT_BODY}`;
        this.spaced(g, 'CHAPTER ' + c.num, 110 - slide, h - 235, 8);
        g.fillStyle = WHITE; g.font = `600 78px ${FONT_HEAD}`;
        this.spaced(g, c.title, 110 - slide, h - 160, 6);
        g.fillStyle = GOLD; g.fillRect(110 - slide, h - 135, 110 * easeOut((dt - 0.5) / 1.0), 3);
        g.restore();
      }
    }

    // ---------- info cards ----------
    for (const c of this.script.cards) {
      if (t < c.t0 || t > c.t1) continue;
      const dt = t - c.t0, rem = c.t1 - t;
      const a = smooth(0, 0.7, dt) * smooth(0, 0.7, rem);
      const slide = (1 - easeOut(dt / 0.9)) * 24;
      g.save(); g.globalAlpha = a;
      if (c.pos === 'c') {
        g.textAlign = 'center'; g.fillStyle = WHITE; g.font = `700 150px ${FONT_HEAD}`;
        g.shadowColor = 'rgba(255,196,107,0.55)'; g.shadowBlur = 40;
        this.spaced(g, c.big, w / 2, h / 2 + 40, 14, 'center');
        g.restore(); continue;
      }
      const right = c.pos === 'tr';
      const x0 = right ? w - 110 + slide : 110 - slide;
      const y0 = 130;
      g.textAlign = right ? 'right' : 'left';
      // accent bar
      const barW = 4, boxH = this.cardHeight(g, c);
      g.fillStyle = GOLD;
      g.fillRect(right ? x0 + 22 - barW : x0 - 22, y0 - 38, barW, boxH);
      g.fillStyle = GOLD; g.font = `600 24px ${FONT_BODY}`;
      this.spaced(g, c.kicker || '', x0, y0 - 14, 5, right ? 'right' : 'left');
      let y = y0 + 52;
      if (c.big) {
        g.fillStyle = WHITE; g.font = `700 150px ${FONT_HEAD}`;
        g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 12;
        this.spaced(g, c.big, x0, y + 66, 4, right ? 'right' : 'left');
        y += 150; g.shadowBlur = 0;
      }
      if (c.text) {
        g.fillStyle = WHITE; g.font = `500 46px ${FONT_HEAD}`;
        g.shadowColor = 'rgba(0,0,0,0.7)'; g.shadowBlur = 10;
        for (const ln of this.wrap(g, c.text, 760)) { this.spaced(g, ln.toUpperCase(), x0, y, 2.5, right ? 'right' : 'left'); y += 54; }
      }
      if (c.list) {
        g.fillStyle = WHITE; g.font = `500 44px ${FONT_HEAD}`;
        g.shadowColor = 'rgba(0,0,0,0.7)'; g.shadowBlur = 10;
        for (const it of c.list) { this.spaced(g, '•  ' + it.toUpperCase(), x0, y, 2.5, right ? 'right' : 'left'); y += 56; }
      }
      g.restore();
    }

    // ---------- widgets (plots) ----------
    if (ctxInfo.widgets) for (const wdg of ctxInfo.widgets) this.drawWidget(g, wdg, t);

    // ---------- subtitles ----------
    const sub = this.subs.find((s) => t >= s.t0 && t <= s.t1);
    if (sub) {
      const a = smooth(sub.t0, sub.t0 + 0.35, t) * (1 - smooth(sub.t1 - 0.3, sub.t1, t));
      g.save(); g.globalAlpha = a; g.textAlign = 'center';
      g.font = `500 40px ${FONT_BODY}`;
      const lines = this.wrap(g, sub.text, 1500);
      const lh = 54, boxH = lines.length * lh + 26;
      const y0 = h - 64 - lines.length * lh;
      g.fillStyle = 'rgba(0,0,0,0.38)';
      const maxw = Math.max(...lines.map((l) => g.measureText(l).width)) + 56;
      g.fillRect(w / 2 - maxw / 2, y0 - 38, maxw, boxH);
      g.fillStyle = WHITE; g.shadowColor = 'rgba(0,0,0,0.9)'; g.shadowBlur = 8;
      lines.forEach((l, i) => g.fillText(l, w / 2, y0 + i * lh));
      g.restore();
    }

    // ---------- persistent labels ----------
    if (t > 7 && t < 472) {
      g.save(); g.globalAlpha = 0.62; g.textAlign = 'right'; g.fillStyle = WHITE;
      g.font = `500 22px ${FONT_HEAD}`;
      this.spaced(g, 'ARTIST’S VISUALIZATION  ·  NOT SIMULATION OUTPUT', w - 60, 52, 3, 'right');
      g.restore();
      g.save(); g.globalAlpha = 0.5; g.textAlign = 'left'; g.fillStyle = GOLD;
      g.font = `600 22px ${FONT_HEAD}`;
      this.spaced(g, 'TECHNICAL TALK INDIA', 60, 52, 6);
      g.restore();
    }

    // ---------- outro ----------
    for (const o of this.script.outro) {
      if (t < o.t0) continue;
      const dt = t - o.t0;
      const a = smooth(0, 1.2, dt) * (1 - smooth(this.script.duration - 0.9, this.script.duration - 0.1, t));
      g.save(); g.globalAlpha = a; g.textAlign = 'center'; g.fillStyle = WHITE;
      if (o.line.startsWith('TECHNICAL')) {
        g.fillStyle = GOLD; g.font = `600 64px ${FONT_HEAD}`;
        this.spaced(g, o.line, w / 2, h / 2 + 150, 18, 'center');
      } else {
        g.font = `600 110px ${FONT_HEAD}`;
        g.shadowColor = 'rgba(0,0,0,0.8)'; g.shadowBlur = 24;
        this.spaced(g, o.line, w / 2, h / 2 - 10, 14, 'center');
      }
      g.restore();
    }
  }

  cardHeight(g, c) {
    let n = 52 + 14;
    if (c.big) n += 150;
    if (c.text) { g.font = `500 46px ${FONT_HEAD}`; n += this.wrap(g, c.text, 760).length * 54; }
    if (c.list) n += c.list.length * 56;
    return n - 20;
  }

  // ---------- widgets ----------
  // wdg: {kind:'chirp'|'burst'|'both'|'area'|'stretch', rect:[x,y,w,h] (1080p units), p: progress 0..1, alpha}
  drawWidget(g, wdg, t) {
    const [x, y, w, h] = wdg.rect;
    g.save();
    g.globalAlpha = wdg.alpha ?? 1;
    g.fillStyle = 'rgba(4,8,16,0.55)'; g.fillRect(x, y, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 1.5; g.strokeRect(x, y, w, h);
    g.font = `600 20px ${FONT_BODY}`; g.fillStyle = 'rgba(255,255,255,0.75)'; g.textAlign = 'left';
    this.spaced(g, wdg.title || '', x + 18, y + 30, 4);
    const px = x + 18, py = y + 48, pw = w - 36, ph = h - 70;
    // baseline
    g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(px, py + ph / 2); g.lineTo(px + pw, py + ph / 2); g.stroke();
    if (wdg.kind === 'chirp') this.plotSignal(g, px, py, pw, ph, wdg.p, chirp, CYAN, wdg.label);
    else if (wdg.kind === 'burst') this.plotSignal(g, px, py, pw, ph, wdg.p, (s) => burst(s, wdg.variant || 0), VIOLET, wdg.label);
    else if (wdg.kind === 'area') this.plotArea(g, px, py, pw, ph, wdg.p);
    else if (wdg.kind === 'stretch') this.plotStretch(g, px, py, pw, ph, wdg.p);
    g.restore();
  }

  plotSignal(g, px, py, pw, ph, p, fn, color, label) {
    g.lineWidth = 3; g.strokeStyle = color; g.shadowColor = color; g.shadowBlur = 12;
    g.beginPath();
    const n = Math.floor(pw * clamp(p));
    for (let i = 0; i <= n; i++) {
      const s = i / pw; const v = fn(s);
      const X = px + i, Y = py + ph / 2 - v * (ph / 2 - 6);
      if (i === 0) g.moveTo(X, Y); else g.lineTo(X, Y);
    }
    g.stroke(); g.shadowBlur = 0;
    if (label) { g.font = `500 18px ${FONT_BODY}`; g.fillStyle = 'rgba(255,255,255,0.7)'; g.textAlign = 'right'; g.fillText(label, px + pw, py + ph + 18); }
    g.textAlign = 'left'; g.fillStyle = 'rgba(255,255,255,0.45)'; g.font = `500 16px ${FONT_BODY}`;
    g.fillText('TIME →', px, py + ph + 18);
  }

  plotArea(g, px, py, pw, ph, p) {
    // illustrative horizon-area history: ordinary black hole (never decreases) vs shrinking apparent horizon (-28%)
    const Y = (a) => py + ph - ((a - 0.6) / (1.12 - 0.6)) * ph;
    g.setLineDash([8, 7]); g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 2.5;
    g.beginPath();
    for (let i = 0; i <= pw; i++) { const s = i / pw; const a = 1.0 + 0.1 * smooth(0.2, 0.9, s); if (i === 0) g.moveTo(px + i, Y(a)); else g.lineTo(px + i, Y(a)); }
    g.stroke(); g.setLineDash([]);
    g.strokeStyle = GOLD; g.lineWidth = 4; g.shadowColor = GOLD; g.shadowBlur = 14;
    g.beginPath();
    const n = Math.floor(pw * clamp(p));
    for (let i = 0; i <= n; i++) { const s = i / pw; const a = 1.0 - 0.28 * smooth(0.25, 0.85, s) + 0.012 * Math.sin(s * 30) * (1 - s); if (i === 0) g.moveTo(px + i, Y(a)); else g.lineTo(px + i, Y(a)); }
    g.stroke(); g.shadowBlur = 0;
    g.font = `500 17px ${FONT_BODY}`; g.textAlign = 'left';
    g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillText('ORDINARY HORIZON: AREA NEVER DECREASES', px + 6, Y(1.12) + 24);
    g.fillStyle = GOLD; g.fillText('PHANTOM-FIELD CASE: −28%', px + 6, py + ph - 8);
  }

  plotStretch(g, px, py, pw, ph, p) {
    // frequency axis (log) with LIGO and LISA bands; a signal marker slides to lower frequency as the universe expands
    const bands = [{ n: 'LISA', f0: 0.12, f1: 0.45, c: CYAN }, { n: 'LIGO', f0: 0.62, f1: 0.9, c: GOLD }];
    g.font = `600 18px ${FONT_BODY}`;
    for (const b of bands) {
      g.fillStyle = b.c + '33'; g.fillRect(px + b.f0 * pw, py + 10, (b.f1 - b.f0) * pw, ph - 40);
      g.fillStyle = b.c; g.textAlign = 'center'; g.fillText(b.n, px + (b.f0 + b.f1) / 2 * pw, py + 34);
    }
    const xs = lerp(0.74, 0.035, easeOut(p));
    g.strokeStyle = VIOLET; g.fillStyle = VIOLET; g.lineWidth = 3; g.shadowColor = VIOLET; g.shadowBlur = 14;
    g.beginPath(); g.moveTo(px + xs * pw, py + 50); g.lineTo(px + xs * pw, py + ph - 30); g.stroke();
    g.beginPath(); g.arc(px + xs * pw, py + ph / 2, 8, 0, 7); g.fill(); g.shadowBlur = 0;
    g.fillStyle = 'rgba(255,255,255,0.7)'; g.font = `500 16px ${FONT_BODY}`; g.textAlign = 'left';
    g.fillText('← LOWER FREQUENCY', px, py + ph + 18);
    g.textAlign = 'right'; g.fillText('SIGNAL STRETCHED BY COSMIC EXPANSION', px + pw, py + ph + 18);
  }
}

// illustrative waveforms (unitless)
export function chirp(s) { // s in 0..1 across the widget; merge at s=0.86
  const sm = 0.86; if (s > sm + 0.12) return 0;
  if (s > sm) { const d = s - sm; return 0.9 * Math.exp(-d * 55) * Math.sin(200 * d + 6.0 + 20 * 0.0); }
  const tau = 1 - s / sm;
  const ph = 150 * (1 - Math.pow(Math.max(tau, 1e-4), 0.625));
  const amp = 0.14 + 0.78 * Math.pow(1 - tau, 2.2);
  return amp * Math.sin(ph);
}
export function burst(s, variant = 0) { // short sharp bursts, no chirp
  const c1 = variant === 0 ? 0.40 : 0.55, c2 = variant === 0 ? 0.50 : 0.0;
  let v = 0.95 * Math.exp(-Math.pow((s - c1) / 0.018, 2)) * Math.sin(260 * (s - c1));
  if (c2) v += 0.5 * Math.exp(-Math.pow((s - c2) / 0.02, 2)) * Math.sin(210 * (s - c2) + 1.2);
  v += 0.04 * Math.sin(s * 900) * Math.exp(-Math.pow((s - c1) / 0.2, 2));
  return v;
}
