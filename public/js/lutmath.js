// Light-bending tables, derived from the actual null-geodesic integrals (no fudge factors).
//
// Ellis-Bronnikov wormhole (throat radius b = 1):  ds^2 = -dt^2 + dl^2 + (l^2 + 1) dOmega^2
//   A light ray with impact parameter B sweeps an angle  dphi = 2 B * Int dv / sqrt(1 + k^2 cosh^2 v)  (B > 1, k^2 = B^2 - 1)
//   or                                                    dphi = 2 B * Int dv / sqrt(1 + c^2 sinh^2 v)  (B < 1, c^2 = 1 - B^2)
//   Rays with B < 1 pass through the throat and emerge in the *other* universe.
//   Deflection angle  alpha = dphi - pi.
//
// Schwarzschild (M = 1, critical impact parameter bc = 3*sqrt(3)):
//   dphi = 2 Int_0^{u0} du / sqrt(1/B^2 - u^2 + 2u^3), u0 = turning point.  alpha = dphi - pi.

export const LUT_W = 1024;
export const LMIN = Math.log(1e-6);
export const LMAX = Math.log(80);
export const BC = 3 * Math.sqrt(3);

export function ellisInside(B) { // B in [0,1)
  const c = Math.sqrt(Math.max(1 - B * B, 0));
  const vmax = Math.log(2 / Math.max(c, 1e-9)) + 30;
  const N = 6000, h = vmax / N;
  let s = 0;
  for (let i = 0; i <= N; i++) {
    const v = i * h;
    const sh = Math.sinh(v);
    const f = 1 / Math.sqrt(1 + c * c * sh * sh);
    s += (i === 0 || i === N ? 0.5 : 1) * f;
  }
  return 2 * B * s * h - Math.PI; // alpha
}

export function ellisOutside(B) { // B > 1
  const k = Math.sqrt(B * B - 1);
  const vmax = Math.log(2 / Math.max(k, 1e-9)) + 30;
  const N = 6000, h = Math.min(vmax, 60) / N;
  let s = 0;
  for (let i = 0; i <= N; i++) {
    const v = i * h;
    const ch = Math.cosh(v);
    const f = 1 / Math.sqrt(1 + k * k * ch * ch);
    s += (i === 0 || i === N ? 0.5 : 1) * f;
  }
  return 2 * B * s * h - Math.PI;
}

export function schwarzschild(B) { // B > BC
  const F = (u) => 1 / (B * B) - u * u + 2 * u * u * u;
  let lo = 0, hi = 1 / 3;
  for (let i = 0; i < 80; i++) { const m = 0.5 * (lo + hi); if (F(m) > 0) lo = m; else hi = m; }
  const u0 = 0.5 * (lo + hi);
  const N = 6000;
  // direct, regular form: integrand = 2 sqrt(u0) / sqrt(-Q(u)),  u = u0 (1 - t^2), t in [0,1]
  let acc = 0;
  for (let i = 0; i < N; i++) {
    const x = (i + 0.5) / N;
    const t = x * x, dt = 2 * x / N;
    const u = u0 * (1 - t * t);
    const negQ = (u + u0) - 2 * (u * u + u * u0 + u0 * u0);
    acc += 2 * Math.sqrt(u0) / Math.sqrt(Math.max(negQ, 1e-30)) * dt;
  }
  return 2 * acc - Math.PI;
}

// Pack tables: row0 Ellis inside (x = B), row1 Ellis outside, row2 Schwarzschild outside.
export function buildTables() {
  const W = LUT_W, H = 4;
  const data = new Float32Array(W * H * 4);
  for (let i = 0; i < W; i++) {
    const s = i / (W - 1);
    data[(0 * W + i) * 4] = ellisInside(Math.min(s, 0.99999999));
    const d = Math.exp(LMIN + s * (LMAX - LMIN));
    data[(1 * W + i) * 4] = ellisOutside(1 + d);
    data[(2 * W + i) * 4] = schwarzschild(BC * (1 + d));
  }
  return { data, W, H };
}
