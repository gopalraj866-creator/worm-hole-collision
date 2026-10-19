// All scenes of the film. Each scene is a pure function of time t (seconds): no accumulated state,
// so any frame can be rendered on any machine, in any order.
import * as THREE from 'three';
import { clamp, lerp, smooth, easeIn, easeOut, easeInOut, track, drift, pose, glowTexture, noise1, hash11 } from './util.js';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------- shared shader snippets
const GRID_FN = /* glsl */`
float gridLine(float v, float w){ float d=abs(fract(v-0.5)-0.5)/max(fwidth(v),1e-5); return 1.0-min(d/w,1.0); }
`;

// ---------------------------------------------------------------- helpers
function makeOrbs(glowTex) {
  return {
    glow(color, scale, opacity = 1) {
      const m = new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity });
      const s = new THREE.Sprite(m); s.scale.setScalar(scale); return s;
    },
    blackHole(r) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.SphereGeometry(r, 48, 32), new THREE.MeshBasicMaterial({ color: 0x000000 })));
      const halo = this.glow(0xffa550, r * 5.5, 0.85); g.add(halo);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.55, r * 0.07, 12, 96), new THREE.MeshBasicMaterial({ color: 0xffd9a0 }));
      ring.rotation.x = Math.PI / 2 + 0.35; g.add(ring);
      return g;
    },
    wormhole(r, color = 0xb48cff) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.SphereGeometry(r * 0.9, 40, 28), new THREE.MeshBasicMaterial({ color: 0x14062c })));
      g.add(this.glow(color, r * 6, 0.9));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.09, 12, 96), new THREE.MeshBasicMaterial({ color }));
      ring.rotation.x = Math.PI / 2 + 0.5; g.add(ring);
      return g;
    },
  };
}

class Base {
  constructor(env) {
    this.env = env;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, env.aspect, 0.1, 4000);
  }
  addLens() {
    const m = new THREE.Mesh(this.env.lens.mesh.geometry, this.env.lens.mesh.material);
    m.frustumCulled = false; m.renderOrder = -1000;
    this.scene.add(m);
  }
  cam(pos, target, fov, t, shake = 0.08, roll = 0) {
    const d = drift(t, shake);
    pose(this.camera, [pos[0] + d.x, pos[1] + d.y, pos[2] + d.z], [target[0] + d.y * 0.6, target[1] + d.z * 0.6, target[2] + d.x * 0.6], fov, roll);
  }
  px() { return this.env.size.h / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)); }
}

// ---------------------------------------------------------------- phantom-field / infall particles
class Phantom {
  constructor(count, colA, colB) {
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) for (let k = 0; k < 4; k++) seeds[i * 4 + k] = hash11(i * 4.17 + k * 91.3 + 0.5);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    this.u = {
      uTime: { value: 0 }, uR0: { value: 1 }, uR1: { value: 4 }, uInfall: { value: 0.05 }, uSpin: { value: 0.6 },
      uSize: { value: 0.08 }, uPx: { value: 1000 }, uAlpha: { value: 1 }, uCenter: { value: new THREE.Vector3() },
      uColA: { value: new THREE.Color(...colA) }, uColB: { value: new THREE.Color(...colB) },
    };
    const m = new THREE.ShaderMaterial({
      uniforms: this.u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`
        attribute vec4 aSeed; uniform float uTime,uR0,uR1,uInfall,uSpin,uSize,uPx,uAlpha; uniform vec3 uCenter,uColA,uColB;
        varying vec3 vCol; varying float vA;
        void main(){
          float ph=fract(aSeed.z+uTime*uInfall);
          float r=mix(uR1,uR0,ph);
          float cz=1.0-2.0*aSeed.y; float sz=sqrt(max(1.0-cz*cz,0.0));
          float th=aSeed.x*6.2831853+uTime*uSpin/(0.6+r*0.12)+ph*2.5;
          vec3 p=uCenter+vec3(sz*cos(th),cz,sz*sin(th))*r;
          vec4 mv=modelViewMatrix*vec4(p,1.0);
          gl_Position=projectionMatrix*mv;
          gl_PointSize=clamp((0.4+aSeed.w)*uSize*uPx/max(-mv.z,0.01),1.0,40.0);
          vA=smoothstep(0.0,0.12,ph)*smoothstep(1.0,0.72,ph)*uAlpha;
          vCol=mix(uColA,uColB,aSeed.w);
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vCol; varying float vA;
        void main(){ float d=length(gl_PointCoord-0.5)*2.0; float a=exp(-d*d*3.5)*vA; gl_FragColor=vec4(vCol*1.6,a); }`,
    });
    this.points = new THREE.Points(g, m); this.points.frustumCulled = false;
  }
  set(t, px, o) {
    const u = this.u; u.uTime.value = t; u.uPx.value = px;
    if (o.r0 !== undefined) u.uR0.value = o.r0; if (o.r1 !== undefined) u.uR1.value = o.r1;
    if (o.infall !== undefined) u.uInfall.value = o.infall; if (o.spin !== undefined) u.uSpin.value = o.spin;
    if (o.size !== undefined) u.uSize.value = o.size; if (o.alpha !== undefined) u.uAlpha.value = o.alpha;
    if (o.center) u.uCenter.value.set(...o.center);
    this.points.visible = (o.alpha ?? 1) > 0.002;
  }
}

// ---------------------------------------------------------------- horizon shell
class Horizon {
  constructor() {
    this.u = { uTime: { value: 0 }, uOpacity: { value: 1 }, uCol: { value: new THREE.Color(1.0, 0.62, 0.25) } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: /* glsl */`varying vec3 vW; varying vec3 vN; varying vec3 vO;
        void main(){ vO=normalize(position); vN=normalize(mat3(modelMatrix)*normal); vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
      fragmentShader: /* glsl */`
        precision highp float; uniform float uTime,uOpacity; uniform vec3 uCol; varying vec3 vW; varying vec3 vN; varying vec3 vO;
        ${GRID_FN}
        void main(){
          vec3 V=normalize(cameraPosition-vW);
          float fr=pow(1.0-abs(dot(normalize(vN),V)),2.4);
          float lon=atan(vO.z,vO.x)*(16.0/3.14159), lat=asin(clamp(vO.y,-1.0,1.0))*(10.0/1.5708);
          float lines=max(gridLine(lon,1.2),gridLine(lat,1.2));
          float sh=0.5+0.5*sin(vO.x*9.0+uTime*1.7)*sin(vO.y*8.0-uTime*1.3)*sin(vO.z*7.0+uTime*0.9);
          float a=(0.05+fr*1.15+lines*0.32*(0.4+fr))*(0.65+0.7*sh);
          gl_FragColor=vec4(uCol*a*uOpacity*0.55,1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 6), m);
  }
  set(t, radius, scale, opacity) {
    this.u.uTime.value = t; this.u.uOpacity.value = opacity;
    this.mesh.scale.set(radius * scale[0], radius * scale[1], radius * scale[2]); this.mesh.visible = opacity > 0.002;
  }
}

// ---------------------------------------------------------------- spacetime sheet
class Sheet {
  constructor() {
    const g = new THREE.PlaneGeometry(170, 170, 340, 340); g.rotateX(-Math.PI / 2);
    this.u = {
      uTime: { value: 0 }, uWell: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 0, 1)) },
      uRip: { value: [0, 1].map(() => new THREE.Vector4(0, 0, 0, -1)) },
      uChirp: { value: new THREE.Vector4(0, 0, 0, 1) }, uChirpAmp: { value: 0 }, uChirpPh0: { value: 150 },
      uBurst: { value: [0, 1, 2].map(() => new THREE.Vector4(0, 0, -1000, 0)) },
      uK: { value: 1.1 }, uCol: { value: new THREE.Color(0.1, 0.5, 1.0) }, uBright: { value: 1 },
    };
    const m = new THREE.ShaderMaterial({
      uniforms: this.u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: /* glsl */`
        uniform float uTime,uK,uChirpAmp,uChirpPh0; uniform vec4 uWell[4]; uniform vec4 uRip[2]; uniform vec4 uChirp; uniform vec4 uBurst[3];
        varying vec3 vW; varying float vD;
        const float C=14.0;
        float disp(vec2 p){
          float y=0.0;
          for(int i=0;i<4;i++){ vec2 d=p-uWell[i].xy; y-=uWell[i].z/sqrt(dot(d,d)+uWell[i].w*uWell[i].w); }
          for(int i=0;i<2;i++){ if(uRip[i].w>0.0){ float r=length(p-uRip[i].xy); float fr=uRip[i].w;
            float env=smoothstep(fr,fr-5.0,r)*smoothstep(fr-38.0,fr-26.0,r); y+=uRip[i].z*env*sin((r-fr)*uK)/(1.0+0.06*r); } }
          if(uChirpAmp>0.0){ float r=length(p-uChirp.xy); float T=uChirp.w; float tau=(uTime-r/C-uChirp.z)/T;
            if(tau>0.0){ float tt=min(tau,0.9995); float ph=uChirpPh0*(1.0-pow(1.0-tt,0.625));
              if(tau<1.0){ y+=uChirpAmp*(0.10+0.9*pow(tt,2.2))*sin(ph)/(1.0+0.10*r); }
              else { float s=(tau-1.0)*T; y+=uChirpAmp*0.9*exp(-s/0.7)*sin(uChirpPh0*0.999+s*13.0)/(1.0+0.10*r); } } }
          for(int i=0;i<3;i++){ float r=length(p-uBurst[i].xy); float s=uTime-r/C-uBurst[i].z; y+=uBurst[i].w*exp(-s*s/0.22)*sin(s*12.0)/(1.0+0.09*r); }
          return y;
        }
        void main(){
          vec3 p=position; float y=disp(p.xz); p.y+=y; vD=y;
          vec4 w=modelMatrix*vec4(p,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w;
        }`,
      fragmentShader: /* glsl */`
        precision highp float; uniform vec3 uCol; uniform float uBright; varying vec3 vW; varying float vD;
        ${GRID_FN}
        void main(){
          vec2 g=vW.xz/2.0;
          float minor=max(gridLine(g.x,1.0),gridLine(g.y,1.0));
          float major=max(gridLine(g.x/5.0,1.6),gridLine(g.y/5.0,1.6));
          float line=0.55*minor+0.75*major;
          float dist=length(vW-cameraPosition);
          float fog=exp(-dist*0.0105)*smoothstep(82.0,55.0,length(vW.xz));
          vec3 col=uCol*(line+0.012)+vec3(1.0,0.78,0.5)*clamp(abs(vD)*0.12,0.0,1.4)*line;
          gl_FragColor=vec4(col*fog*uBright*1.35,1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(g, m); this.mesh.frustumCulled = false;
  }
  wellY(x, z) {
    let y = 0;
    for (const w of this.u.uWell.value) { const dx = x - w.x, dz = z - w.y; y -= w.z / Math.sqrt(dx * dx + dz * dz + w.w * w.w); }
    return y;
  }
}

// ---------------------------------------------------------------- lens scenes
// A scene made of the lensing background plus optional 3D extras.
class LensScene extends Base {
  constructor(env) { super(env); this.addLens(); this.phantom = new Phantom(2600, [0.65, 0.4, 1.0], [1.0, 0.72, 0.35]); this.scene.add(this.phantom.points); this.horizon = new Horizon(); this.scene.add(this.horizon.mesh); this.horizon.mesh.visible = false; }
  render(t, o) {
    this.cam(o.pos, o.target, o.fov ?? 45, t, o.shake ?? 0.06);
    this.env.lens.update(this.camera, this.env.size, o.lenses || [], { skyGain: o.skyGain ?? 1, skyBGain: o.skyBGain ?? 1, wave: o.wave });
    this.phantom.set(t, this.px(), o.phantom || { alpha: 0 });
    if (o.horizon) this.horizon.set(t, o.horizon.r, o.horizon.s || [1, 1, 1], o.horizon.o); else this.horizon.mesh.visible = false;
  }
}

const VIOLET = [0.7, 0.5, 1.0], GOLDG = [1.0, 0.72, 0.4], ORANGE = [1.0, 0.6, 0.25];
const orbitPos = (R, az, el, c = [0, 0, 0]) => [c[0] + R * Math.cos(el) * Math.sin(az), c[1] + R * Math.sin(el), c[2] + R * Math.cos(el) * Math.cos(az)];

// ------------------------------------------------------------- Scene: intro sheet (0-18)
class IntroScene extends Base {
  constructor(env) {
    super(env); this.addLens(); this.sheet = new Sheet(); this.scene.add(this.sheet.mesh);
  }
  update(t) {
    const u = this.sheet.u; u.uTime.value = t;
    u.uWell.value.forEach((w) => w.set(0, 0, 0, 1));
    u.uRip.value[0].set(-30, -40, 0.85, Math.max(-1, (t - 1.0) * 14)); if (t < 1) u.uRip.value[0].w = -1;
    u.uRip.value[1].set(40, -20, 0.6, t > 5 ? (t - 5) * 14 : -1);
    u.uK.value = 1.05;
    const p = track([[0, [-34, 3.5, 34]], [9, [-4, 5.2, 28]], [18, [26, 7.5, 18]]], t);
    const tg = track([[0, [0, 1.5, -22]], [18, [-6, 0, -26]]], t);
    this.cam(p, tg, 58, t, 0.05);
    this.env.lens.update(this.camera, this.env.size, [], { skyGain: 0.9 });
    return {};
  }
}

// ------------------------------------------------------------- Scene: binary black holes (18-78)
class BinaryScene extends LensScene {
  update(t) {
    const t0 = 18, tm = 51, T = tm - t0;
    const pre = t < tm;
    const tau = clamp((t - t0) / T, 0, 0.9996);
    const d = 2.4 + (16 - 2.4) * Math.pow(1 - tau, 0.25);
    const phi = TAU * 16 * (1 - Math.pow(1 - tau, 0.625));
    const lenses = []; let flash = 0;
    const el = 0.32;
    // camera: orbit, closer toward merger, then pull right back
    const R = track([[18, 34], [40, 26], [51, 20], [58, 26], [78, 70]], t);
    const az = 0.55 + 0.07 * (t - 18) + 0.012 * (t - 18) * (t - 18) * 0.02;
    const pos = orbitPos(R, az, track([[18, 0.32], [51, 0.22], [78, 0.45]], t));
    if (pre) {
      const c = Math.cos(phi) * d / 2, s = Math.sin(phi) * d / 2;
      lenses.push({ pos: [c, 0, s], b: 1.15, type: 0, amt: 1, glow: ORANGE, glowAmt: 0.9 });
      lenses.push({ pos: [-c, 0, -s], b: 1.15, type: 0, amt: 1, glow: ORANGE, glowAmt: 0.9 });
    } else {
      const ring = Math.exp(-(t - tm) / 1.6) * Math.sin((t - tm) * 14.0);
      lenses.push({ pos: [0, 0, 0], b: 1.95 * (1 + 0.05 * ring) * smooth(tm - 0.05, tm + 0.6, t) + 0.001, type: 0, amt: 1, glow: ORANGE, glowAmt: 0.9 });
      flash = 0.75 * Math.exp(-Math.pow((t - tm) / 0.55, 2)) * (t >= tm - 0.1 ? 1 : 0);
    }
    const dir = [-pos[0], -pos[1], -pos[2]];
    const amp = pre ? 0.0015 + 0.011 * Math.pow(tau, 3) : 0.012 * Math.exp(-(t - tm) / 4.0);
    const wave = { amp: t > 28 ? amp : amp * smooth(18, 28, t), dir, k: 28, phase: pre ? phi * 0.5 + t * 2 : (t - tm) * 9 + 30, decay: 1.5 };
    this.render(t, { pos, target: [0, 0, 0], fov: 45, lenses, wave, skyGain: 1.0 });
    const widgets = [];
    if (t > 32 && t < 62) {
      const p = clamp(((t - 33) / (tm - 33)) * 0.86, 0, 1);
      const al = smooth(32, 33.2, t) * (1 - smooth(60.8, 62, t));
      widgets.push({ kind: 'chirp', rect: [1240, 590, 580, 230], p: t < tm ? p : clamp(0.86 + (t - tm) / 4 * 0.14, 0, 1), alpha: al, title: 'GRAVITATIONAL-WAVE STRAIN · ILLUSTRATIVE', label: 'BLACK-HOLE CHIRP' });
    }
    return { flash, flashPos: [0.5, 0.5], widgets };
  }
}

// ------------------------------------------------------------- Scene: wormhole reveal (78-93) and open question (128-140) share code
class WormholeFieldScene extends LensScene {
  update(t) {
    // 78-93: reveal;  (this scene instance only used for 78-93)
    const amt = smooth(82.0, 90.0, t);
    const pos = track([[78, [0, 1.5, 62]], [93, [9, 2.2, 18]]], t);
    this.render(t, { pos, target: [0, 0, 0], fov: 45, shake: 0.08,
      lenses: [{ pos: [0, 0, 0], b: 1.7, type: 1, amt, glow: VIOLET, glowAmt: 0.55 }], skyGain: 1, skyBGain: 1,
      wave: { amp: 0.004 * (1 - amt), dir: [-pos[0], -pos[1], -pos[2]], k: 18, phase: t * 3 } });
    return {};
  }
}

// ------------------------------------------------------------- Scene: general relativity sheet (93-107)
class GRScene extends Base {
  constructor(env) {
    super(env); this.addLens(); this.sheet = new Sheet(); this.scene.add(this.sheet.mesh);
    this.star = env.orbs.glow(0xffe2b0, 5.5); this.starCore = new THREE.Mesh(new THREE.SphereGeometry(1.1, 40, 28), new THREE.MeshBasicMaterial({ color: 0xfff1d6 }));
    this.planet = new THREE.Mesh(new THREE.SphereGeometry(0.42, 28, 20), new THREE.MeshBasicMaterial({ color: 0x6fd6ff }));
    this.planetGlow = env.orbs.glow(0x6fd6ff, 2.6, 0.8);
    this.scene.add(this.star, this.starCore, this.planet, this.planetGlow);
  }
  update(t) {
    const s = this.sheet, u = s.u; u.uTime.value = t;
    const depth = 16 * smooth(93.5, 99, t);
    u.uWell.value[0].set(0, 0, depth, 3.2); u.uWell.value[1].set(0, 0, 0, 1); u.uWell.value[2].set(0, 0, 0, 1); u.uWell.value[3].set(0, 0, 0, 1);
    u.uRip.value.forEach((r) => r.set(0, 0, 0, -1)); u.uChirpAmp.value = 0; u.uBurst.value.forEach((b) => b.set(0, 0, -1000, 0));
    const y0 = s.wellY(0, 0);
    this.star.position.set(0, y0 + 1.1, 0); this.starCore.position.set(0, y0 + 1.1, 0);
    const a = 0.9 * (t - 93), rad = 10;
    const px = rad * Math.cos(a), pz = rad * Math.sin(a);
    this.planet.position.set(px, s.wellY(px, pz) + 0.5, pz); this.planetGlow.position.copy(this.planet.position);
    const pos = orbitPos(30, 0.4 + 0.045 * (t - 93), 0.34 - 0.02 * (t - 93) * 0.2, [0, -4, 0]);
    this.cam(pos, [0, -5, 0], 50, t, 0.05);
    this.env.lens.update(this.camera, this.env.size, [], { skyGain: 0.6 });
    return {};
  }
}

// ------------------------------------------------------------- Scene: wormhole embedding diagram (107-128)
class FunnelScene extends Base {
  constructor(env) {
    super(env); this.addLens();
    const NL = 200, NP = 120, L = 7.5;
    const pos = new Float32Array(NL * NP * 3), ll = new Float32Array(NL * NP), pp = new Float32Array(NL * NP);
    const idx = [];
    for (let i = 0; i < NL; i++) for (let j = 0; j < NP; j++) {
      const k = i * NP + j; ll[k] = -L + (2 * L * i) / (NL - 1); pp[k] = (j / (NP - 1)) * TAU;
      if (i < NL - 1 && j < NP - 1) { idx.push(k, k + NP, k + 1, k + 1, k + NP, k + NP + 1); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aL', new THREE.BufferAttribute(ll, 1)); g.setAttribute('aP', new THREE.BufferAttribute(pp, 1));
    g.setIndex(idx);
    this.u = { uB: { value: 1 }, uZs: { value: 3.0 }, uBright: { value: 1 } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: /* glsl */`attribute float aL; attribute float aP; uniform float uB,uZs; varying float vL; varying float vP; varying vec3 vW;
        void main(){ float r=sqrt(uB*uB+aL*aL); float y=uZs*asinh(aL/1.0); vec3 p=vec3(r*cos(aP),y,r*sin(aP)); vL=aL; vP=aP; vec4 w=modelMatrix*vec4(p,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
      fragmentShader: /* glsl */`precision highp float; uniform float uBright; varying float vL; varying float vP; varying vec3 vW; ${GRID_FN}
        void main(){
          float lines=max(gridLine(vL/0.5,1.1),gridLine(vP*(40.0/6.2831853),1.1));
          vec3 cA=vec3(0.15,0.65,1.0), cB=vec3(1.0,0.35,0.75);
          vec3 c=mix(cB,cA,smoothstep(-0.6,0.6,vL));
          float thr=exp(-vL*vL*40.0);
          float fog=exp(-length(vW-cameraPosition)*0.012);
          vec3 col=c*(lines*0.9+0.03)*(1.0-0.35*thr)+vec3(1.0,0.8,0.4)*thr*(0.25+0.6*lines);
          gl_FragColor=vec4(col*fog*uBright*1.3,1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(g, m); this.mesh.frustumCulled = false; this.scene.add(this.mesh);
    this.probe = env.orbs.glow(0xffffff, 1.6); this.probeCore = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.scene.add(this.probe, this.probeCore);
  }
  surf(l, b, phi = 0.4) { const r = Math.sqrt(b * b + l * l); return [r * Math.cos(phi) * 1.0, 3.0 * Math.asinh(l), r * Math.sin(phi)]; }
  update(t) {
    const tt = t - 107;
    // 107-116: traversable throat; 116-127: Einstein-Rosen bridge pinches shut
    const b = 1 - 0.98 * smooth(118.0, 122.0, t);
    this.u.uB.value = Math.max(b, 0.02); this.u.uBright.value = smooth(107, 109, t);
    let l;
    if (t < 116.5) l = 6 - 12 * smooth(109, 116, t);
    else l = track([[116.5, 6], [119.5, 3.0], [123, 0.45], [124, 0.45], [127, 5.5]], t) * 1;
    const [x, y, z] = this.surf(l, Math.max(b, 0.02));
    const out = 0.12; const rr = Math.hypot(x, z) + out;
    this.probe.position.set(rr * Math.cos(0.4), y, rr * Math.sin(0.4)); this.probeCore.position.copy(this.probe.position);
    const pos = orbitPos(24, 0.2 + 0.06 * tt, 0.16 + 0.012 * tt, [0, 0, 0]);
    this.cam(pos, [0, 0, 0], 46, t, 0.04);
    this.env.lens.update(this.camera, this.env.size, [], { skyGain: 0.3 });
    return {};
  }
}

// ------------------------------------------------------------- Scene: Ellis-Bronnikov wormhole, 128-198
class EllisScene extends LensScene {
  update(t) {
    let o;
    if (t < 178) {
      // continuous approach 128 -> 178
      const dist = track([[128, 28], [140, 22], [163, 10], [178, 15]], t);
      const az = 0.5 + 0.035 * (t - 128), el = 0.12 + 0.04 * Math.sin((t - 128) * 0.12);
      const pos = orbitPos(dist, az, el);
      let b = 2.0, type = 1, amt = 1, glowAmt = 0.55, glow = VIOLET, flash = 0;
      const phantomOn = smooth(142, 148, t);
      let ph = { alpha: 0.85 * phantomOn, r0: 1.25 * 2, r1: 3.2 * 2, infall: 0.0, spin: 0.9, size: 0.06, center: [0, 0, 0] };
      if (t >= 128 && t < 140) { glowAmt = 0.35 + 0.2 * smooth(134, 140, t); }
      if (t >= 163 && t < 167.2) { b = 2.0 * (1 + 0.14 * Math.sin(t * 29.0) * smooth(163, 166.5, t)); glowAmt = 0.9; }
      if (t >= 167.2 && t < 171.6) { b = 2.0 * (1 - 0.92 * easeIn((t - 167.2) / 4.4)) + 0.001; glowAmt = 0.9; ph.infall = 0.18; ph.alpha = 0.95; ph.r1 = 3 * b + 1; }
      let lens;
      if (t >= 171.6) {
        const g = smooth(171.6, 175.0, t);
        lens = { pos: [0, 0, 0], b: 0.02 + 1.55 * easeOut((t - 171.6) / 3.0), type: 0, amt: 1, glow: ORANGE, glowAmt: 0.85 };
        flash = 0.8 * Math.exp(-Math.pow((t - 171.7) / 0.5, 2));
        ph = { alpha: 0.85 * (1 - g), r0: 1.2, r1: 7, infall: 0.2, spin: 0.9, size: 0.06 };
      } else lens = { pos: [0, 0, 0], b, type, amt, glow, glowAmt: glowAmt * (0.85 + 0.15 * Math.sin(t * 2.2)) };
      this.render(t, { pos, target: [0, 0, 0], fov: 45, lenses: [lens], phantom: ph, shake: t > 163 && t < 168 ? 0.35 : 0.06,
        wave: t > 171.6 ? { amp: 0.012 * Math.exp(-(t - 171.6) / 2.5), dir: [-pos[0], -pos[1], -pos[2]], k: 26, phase: (t - 171.6) * 9 } : undefined });
      return { flash, flashPos: [0.5, 0.5] };
    }
    if (t < 186) {
      // runaway inflation
      const b = 2.0 * Math.exp(0.235 * (t - 178));
      const pos = orbitPos(19, 0.9 + 0.02 * (t - 178), 0.1);
      this.render(t, { pos, target: [0, 0, 0], fov: 45, lenses: [{ pos: [0, 0, 0], b, type: 1, amt: 1, glow: GOLDG, glowAmt: 0.6 }],
        phantom: { alpha: 0.6, r0: b * 1.1, r1: b * 2.2, infall: -0.05, spin: 0.9, size: 0.1 }, skyBGain: 1.2 });
      return {};
    }
    // 186-198: two wormholes, camera pulls back
    const s = (t - 186) / 12;
    const pos = orbitPos(track([[186, 16], [198, 40]], t), 0.3 + 0.1 * (t - 186), 0.12);
    const sep = 7.5 - 0.6 * s;
    this.render(t, { pos, target: [0, 0, 0], fov: 45, lenses: [
      { pos: [-sep, 0, 0], b: 1.5, type: 1, amt: 1, glow: VIOLET, glowAmt: 0.6 },
      { pos: [sep, 0, 0], b: 1.5, type: 1, amt: 1, glow: GOLDG, glowAmt: 0.6 }] });
    return {};
  }
}

// ------------------------------------------------------------- Scene: the simulation (198-250)
class SimScene extends Base {
  constructor(env) {
    super(env); this.addLens();
    const g = new THREE.PlaneGeometry(64, 64, 320, 320); g.rotateX(-Math.PI / 2);
    this.u = { uTime: { value: 0 }, uP: { value: [new THREE.Vector3(), new THREE.Vector3()] }, uAmp: { value: [1, 1] }, uBright: { value: 1 } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.u, side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`uniform vec3 uP[2]; uniform float uAmp[2]; varying vec3 vW; varying float vF; varying float vH;
        void main(){ vec3 p=position; float f=0.0; float y=0.0;
          for(int i=0;i<2;i++){ vec2 d=p.xz-uP[i].xz; float r2=dot(d,d); f+=uAmp[i]*2.0/(r2+2.0); y-=uAmp[i]*2.4/sqrt(r2+2.2); }
          p.y+=y; vF=f; vH=y; vec4 w=modelMatrix*vec4(p,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
      fragmentShader: /* glsl */`precision highp float; uniform float uBright; varying vec3 vW; varying float vF; varying float vH; ${GRID_FN}
        vec3 cmap(float x){ x=clamp(x,0.0,1.0); vec3 a=vec3(0.02,0.04,0.18), b=vec3(0.35,0.08,0.55), c=vec3(0.95,0.35,0.25), d=vec3(1.0,0.9,0.6);
          return x<0.33?mix(a,b,x/0.33):x<0.66?mix(b,c,(x-0.33)/0.33):mix(c,d,(x-0.66)/0.34); }
        void main(){
          vec3 base=cmap(vF*0.9);
          float contour=gridLine(vF*14.0,1.1);
          float grid=max(gridLine(vW.x/2.0,0.9),gridLine(vW.z/2.0,0.9));
          float fog=exp(-length(vW-cameraPosition)*0.007)*smoothstep(33.0,22.0,length(vW.xz));
          vec3 col=base*0.75+vec3(0.5,0.8,1.0)*contour*0.45+vec3(0.15,0.4,0.8)*grid*0.35;
          gl_FragColor=vec4(col*fog*uBright,1.0);
        }`,
    });
    this.plane = new THREE.Mesh(g, m); this.plane.frustumCulled = false; this.scene.add(this.plane);
    // adaptive-mesh-refinement style nested boxes following each wormhole
    this.boxes = [];
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    for (let b = 0; b < 2; b++) for (let lv = 0; lv < 4; lv++) {
      const l = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: lv % 2 ? 0x6fd6ff : 0xffc46b, transparent: true, opacity: 0.55 - lv * 0.08, blending: THREE.AdditiveBlending, depthWrite: false }));
      l.userData = { body: b, size: 11 / Math.pow(2, lv) }; this.scene.add(l); this.boxes.push(l);
    }
    this.orbA = [env.orbs.wormhole(0.7, 0xb48cff), env.orbs.wormhole(0.7, 0xffc46b)];
    this.orbA.forEach((o) => this.scene.add(o));
    const NT = 70;
    this.trails = [0, 1].map((i) => {
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NT * 3), 3));
      const ln = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: i ? 0xffc46b : 0xb48cff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
      ln.frustumCulled = false; this.scene.add(ln); return ln;
    });
    this.NT = NT;
  }
  paths(t) {
    let x1, z1, amp = 1;
    // body 2 mirrors body 1 through the origin
    if (t < 218) { x1 = -10 + 0.12 * (t - 198); z1 = 1.5 * Math.sin((t - 198) * 0.25); amp = 1; }
    else if (t < 224) { x1 = -(5 + 4 * Math.sin((t - 218) * 1.05)); z1 = 0; }
    else if (t < 229) { const s = smooth(224, 229, t); x1 = -9 + 7 * s; z1 = 4 * (1 - s) + 0.0; amp = 1; }
    else if (t < 236) { const s = easeIn((t - 229) / 7); x1 = -9 + 7.5 * s; z1 = 0; amp = 1 + 0.5 * s; }
    else if (t < 243) { const s = (t - 236) / 7; x1 = -16 + 32 * s; z1 = 3.6; amp = 1.3; return [[x1, 0, z1], [0 + 0.0, 0, -0.5 * Math.sin(s * Math.PI)], amp, 1.3]; }
    else { const s = easeOut((t - 243) / 7); x1 = -(2 + 11 * s); z1 = 0; amp = 1 - 0.3 * s; }
    return [[x1, 0, z1], [-x1, 0, -z1], amp, amp];
  }
  update(t) {
    const u = this.u; u.uTime.value = t; u.uBright.value = smooth(198, 201, t);
    const [p1, p2, a1, a2] = this.paths(t);
    u.uP.value[0].set(...p1); u.uP.value[1].set(...p2); u.uAmp.value = [a1, a2];
    const hy = (p, a) => -a * 2.4 / Math.sqrt(2.2);
    const pts = [p1, p2], amps = [a1, a2];
    for (let b = 0; b < 2; b++) {
      const y = hy(pts[b], amps[b]);
      this.orbA[b].position.set(pts[b][0], y + 0.8, pts[b][2]);
    }
    for (const bx of this.boxes) {
      const p = pts[bx.userData.body]; const y = hy(p, amps[bx.userData.body]);
      bx.position.set(p[0], y + 0.3, p[2]); const s = bx.userData.size; bx.scale.set(s, s * 0.5, s);
    }
    for (let i = 0; i < 2; i++) {
      const arr = this.trails[i].geometry.attributes.position.array;
      for (let k = 0; k < this.NT; k++) { const q = this.paths(Math.max(198, t - k * 0.12))[i]; arr[k * 3] = q[0]; arr[k * 3 + 1] = hy(q, 1) + 0.8; arr[k * 3 + 2] = q[2]; }
      this.trails[i].geometry.attributes.position.needsUpdate = true;
    }
    const pos = orbitPos(36 - 0.1 * (t - 198), 0.35 + 0.03 * (t - 198), track([[198, 0.7], [229, 0.95], [250, 0.62]], t), [0, -2, 0]);
    this.cam(pos, [0, -2, 0], 46, t, 0.06);
    this.env.lens.update(this.camera, this.env.size, [], { skyGain: 0.18 });
    return {};
  }
}

// ------------------------------------------------------------- Scene: collision (250-328)
class CollisionScene extends LensScene {
  update(t) {
    const L = (x, y, z, b, glow, glowAmt = 0.65, amt = 1) => ({ pos: [x, y, z], b, type: 1, amt, glow, glowAmt });
    let a, bpos, ba = 1.5, bb = 1.5, wave, flash = 0, hz = null, ph = { alpha: 0 };
    let amtL = 1;
    if (t < 259) { const x = 11 - 6 * Math.pow((t - 250) / 9, 2); a = [-x, 0, 0]; bpos = [x, 0, 0]; }
    else if (t < 267) { const x = 5 + 9 * easeOut((t - 259) / 8); a = [-x, 0, 0]; bpos = [x, 0, 0]; }
    else if (t < 285) {
      const s = (t - 267) / 18; a = [-18 + 36 * s, 0, 5.5 - 2.0 * Math.exp(-Math.pow((s - 0.5) / 0.22, 2))]; bpos = [0, 0, -1.5];
      const sw = Math.exp(-Math.pow((t - 276.5) / 2.6, 2)); ba = 1.5 + 1.15 * sw; bb = 1.5 + 1.0 * sw;
      if (t > 276.5) wave = { amp: 0.02 * Math.exp(-(t - 276.5) / 1.6), k: 26, phase: (t - 276.5) * 9 };
    } else if (t < 300) {
      const s = (t - 285) / 14.7; const x = 14 - 13.2 * Math.pow(clamp(s), 1.5); a = [-x, 0, 0]; bpos = [x, 0, 0];
      if (t > 299.3) flash = 0.7 * Math.exp(-Math.pow((t - 299.7) / 0.5, 2));
    } else {
      const s = smooth(300, 328, t); const x = 1.0 - 0.45 * s; a = [-x, 0, 0]; bpos = [x, 0, 0];
      ba = bb = 1.5 - 0.7 * s; amtL = 1 - smooth(310, 328, t);
      hz = { r: 4.6 - 0.35 * smooth(310, 328, t), s: [lerp(1.35, 1.0, smooth(300, 316, t)), lerp(0.85, 1.0, smooth(300, 316, t)), lerp(0.9, 1.0, smooth(300, 316, t))], o: smooth(299.8, 302.5, t) * 0.9 };
      ph = { alpha: 0.9 * smooth(301, 306, t), r0: 0.8, r1: 9, infall: 0.12, spin: 0.9, size: 0.07, center: [0, 0, 0] };
      if (t < 301) flash = 0.35 * Math.exp(-Math.pow((t - 300.3) / 0.6, 2));
    }
    const R = track([[250, 26], [299, 24], [328, 15]], t);
    const pos = orbitPos(R, 0.15 * Math.sin((t - 250) * 0.045) + (t > 300 ? 0.045 * (t - 300) : 0), track([[250, 0.12], [285, 0.2], [300, 0.28], [328, 0.4]], t));
    if (!wave && t >= 299.7 && t < 304) wave = { amp: 0.02 * Math.exp(-(t - 299.7) / 1.5), k: 26, phase: (t - 299.7) * 9 };
    if (wave) wave.dir = [-pos[0], -pos[1], -pos[2]];
    const gA = t < 300 ? VIOLET : [0.8, 0.55, 1.0];
    this.render(t, { pos, target: [0, 0, 0], fov: 46, lenses: [L(a[0], a[1], a[2], ba, gA, 0.65, amtL), L(bpos[0], bpos[1], bpos[2], bb, GOLDG, 0.65, amtL)], wave, phantom: ph, horizon: hz });
    return { flash, flashPos: [0.5, 0.5] };
  }
}

// ------------------------------------------------------------- Scene: shrinking horizon (328-382)
class HorizonScene extends LensScene {
  update(t) {
    const shrink = smooth(331, 350, t);
    const r = 5.0 * Math.sqrt(1 - 0.28 * shrink);
    const pos = orbitPos(track([[328, 17], [345, 14], [360, 19], [382, 30]], t), 0.6 + 0.05 * (t - 328), track([[328, 0.35], [360, 0.2], [382, 0.3]], t));
    const infall = 0.16 * (1 - 0.6 * smooth(352, 372, t));
    this.render(t, { pos, target: [0, 0, 0], fov: 46,
      lenses: [{ pos: [0, 0, 0], b: 2.5, type: 0, amt: 1, glow: ORANGE, glowAmt: 0.35 }],
      horizon: { r, s: [1 + 0.05 * Math.sin(t * 1.3), 1, 1 - 0.05 * Math.sin(t * 1.3)], o: 0.95 * (1 - smooth(374, 381, t) * 0.4) },
      phantom: { alpha: 0.9 * (1 - 0.5 * smooth(360, 375, t)), r0: r * 0.95, r1: 11, infall, spin: 0.8, size: 0.06, center: [0, 0, 0] },
      skyGain: 0.8 });
    const widgets = [];
    if (t > 331) {
      const al = smooth(331, 332.5, t) * (1 - smooth(380.5, 382, t));
      widgets.push({ kind: 'area', rect: [1240, 520, 580, 300], p: clamp((t - 331) / (372 - 331)), alpha: al, title: 'APPARENT-HORIZON AREA · ILLUSTRATIVE' });
    }
    return { widgets };
  }
}

// ------------------------------------------------------------- Scene: gravitational-wave signals (382-436)
class SignalScene extends Base {
  constructor(env) {
    super(env); this.addLens(); this.sheet = new Sheet(); this.scene.add(this.sheet.mesh);
    this.bh = [env.orbs.blackHole(0.8), env.orbs.blackHole(0.8)]; this.wh = [env.orbs.wormhole(0.8, 0xb48cff), env.orbs.wormhole(0.8, 0xffc46b)];
    [...this.bh, ...this.wh].forEach((o) => this.scene.add(o));
  }
  update(t) {
    const s = this.sheet, u = s.u; u.uTime.value = t;
    u.uRip.value.forEach((r) => r.set(0, 0, 0, -1)); u.uChirpAmp.value = 0; u.uBurst.value.forEach((b) => b.set(0, 0, -1000, 0));
    let bhPos = null, whPos = null;
    // 383-397 wormholes approach and fire a burst; 397-408 black-hole chirp; 408-436 wormhole bursts
    if (t < 397) {
      const x = 9 - 6.5 * smooth(383, 392, t) + 3.0 * smooth(392, 397, t);
      whPos = [[-x, 0, 0], [x, 0, 0]];
      u.uBurst.value[0].set(0, 0, 392.0, 1.4); u.uBurst.value[1].set(0, 0, 395.0, 0.8);
    } else if (t < 408) {
      const t0 = 397, tm = 407.5, tau = clamp((t - t0) / (tm - t0), 0, 0.9996);
      const d = 1.8 + 11 * Math.pow(1 - tau, 0.25), phi = TAU * 12 * (1 - Math.pow(1 - tau, 0.625));
      bhPos = t < tm ? [[Math.cos(phi) * d / 2, 0, Math.sin(phi) * d / 2], [-Math.cos(phi) * d / 2, 0, -Math.sin(phi) * d / 2]] : [[0, 0, 0]];
      u.uChirp.value.set(0, 0, t0, tm - t0); u.uChirpAmp.value = 1.9; u.uChirpPh0.value = TAU * 12 * 0.5 * 1.0 + 60;
    } else {
      const s2 = (t - 408) / 28;
      const x = 7 - 5 * smooth(408, 412, t) + 8 * smooth(412, 426, t);
      whPos = [[-x, 0, 2.5 * Math.sin((t - 408) * 0.4)], [x, 0, -2.5 * Math.sin((t - 408) * 0.4)]];
      u.uBurst.value[0].set(0, 0, 412.0, 1.5); u.uBurst.value[1].set(0, 0, 416.0, 1.1); u.uBurst.value[2].set(0, 0, 421.0, 1.7);
    }
    // wells under the objects
    const wells = u.uWell.value; wells.forEach((w) => w.set(0, 0, 0, 1));
    const place = (list, pos, vis) => list.forEach((o, i) => { o.visible = !!pos && !!pos[i]; if (o.visible) { wells[(list === this.bh ? 0 : 2) + i].set(pos[i][0], pos[i][2], 2.6, 1.1); o.position.set(pos[i][0], s.wellY(pos[i][0], pos[i][2]) + 0.8, pos[i][2]); } });
    place(this.bh, bhPos); place(this.wh, whPos);
    if (t >= 408) { this.wh[0].visible = this.wh[1].visible = true; }
    const pos = orbitPos(30 - 0.12 * (t - 382), 0.5 + 0.035 * (t - 382), track([[382, 0.3], [400, 0.4], [436, 0.3]], t), [0, -2, 0]);
    this.cam(pos, [0, -3, 0], 52, t, 0.05);
    this.env.lens.update(this.camera, this.env.size, [], { skyGain: 0.6 });
    const widgets = [];
    if (t >= 397 && t < 409) {
      const p = t < 407.5 ? ((t - 398) / 9.5) * 0.86 : 0.86 + 0.14 * clamp((t - 407.5) / 1.5);
      widgets.push({ kind: 'chirp', rect: [1240, 590, 580, 230], p: clamp(p), alpha: smooth(397, 398.2, t) * (1 - smooth(408.2, 409, t)), title: 'BLACK HOLES · ILLUSTRATIVE', label: 'CHIRP' });
    }
    if (t >= 408 && t < 414) widgets.push({ kind: 'burst', variant: 0, rect: [1240, 590, 580, 230], p: clamp((t - 408.5) / 4.5), alpha: smooth(408, 409.2, t) * (1 - smooth(413.2, 414, t)), title: 'WORMHOLE ENCOUNTER · ILLUSTRATIVE', label: 'SHORT, SHARP BURST' });
    if (t >= 414 && t < 428) {
      const al = smooth(414, 415.2, t) * (1 - smooth(427.2, 428, t)), p = clamp((t - 414.5) / 8);
      widgets.push({ kind: 'burst', variant: 0, rect: [980, 590, 420, 230], p, alpha: al, title: 'PLUNGE', label: '' });
      widgets.push({ kind: 'burst', variant: 1, rect: [1420, 590, 420, 230], p, alpha: al, title: 'GRAZE', label: '' });
    }
    if (t >= 428) {
      const al = smooth(428, 429.2, t) * (1 - smooth(435, 436, t));
      widgets.push({ kind: 'chirp', rect: [980, 590, 420, 230], p: 1, alpha: al, title: 'BLACK HOLES', label: 'CHIRP' });
      widgets.push({ kind: 'burst', variant: 0, rect: [1420, 590, 420, 230], p: 1, alpha: al, title: 'WORMHOLES', label: 'BURST' });
    }
    return { widgets };
  }
}

// ------------------------------------------------------------- Scene: the catch + finale (436-480)
class FinaleScene extends LensScene {
  update(t) {
    let lenses, pos, wave, skyBGain = 1;
    if (t < 466) {
      const k = lerp(40, 7, smooth(452, 466, t));
      pos = orbitPos(42, 0.7 + 0.012 * (t - 436), 0.1 + 0.04 * Math.sin((t - 436) * 0.1));
      lenses = [{ pos: [-5, 0, 0], b: 0.9, type: 1, amt: 1, glow: VIOLET, glowAmt: 0.5 }, { pos: [5, 0, 0], b: 0.9, type: 1, amt: 1, glow: GOLDG, glowAmt: 0.5 }];
      const pulse = t < 452 ? 0.014 * (0.5 + 0.5 * Math.sin((t - 436) * 0.9)) : 0.012;
      wave = { amp: pulse, dir: [-pos[0], -pos[1], -pos[2]], k: t < 452 ? 40 : k, phase: (t - 436) * 10, decay: 0.9 };
    } else {
      const s = (t - 466) / 14;
      pos = orbitPos(track([[466, 40], [480, 95]], t), 0.9 + 0.03 * (t - 466), 0.12);
      lenses = [{ pos: [-6 + 0.3 * s * 6, 0, 0], b: 1.4, type: 1, amt: 1, glow: VIOLET, glowAmt: 0.6 }, { pos: [6 - 0.3 * s * 6, 0, 0], b: 1.4, type: 1, amt: 1, glow: GOLDG, glowAmt: 0.6 }];
    }
    this.render(t, { pos, target: [0, 0, 0], fov: 45, lenses, wave, skyBGain });
    const widgets = [];
    if (t >= 453 && t < 466) widgets.push({ kind: 'stretch', rect: [1240, 590, 580, 230], p: clamp((t - 453) / 12), alpha: smooth(453, 454.2, t) * (1 - smooth(465, 466, t)), title: 'DETECTABLE FREQUENCY BANDS · ILLUSTRATIVE' });
    return { widgets };
  }
}

// ---------------------------------------------------------------- registry
export function buildScenes(env) {
  env.glowTex = glowTexture(); env.orbs = makeOrbs(env.glowTex);
  return [
    { t0: 0, t1: 18, s: new IntroScene(env) },
    { t0: 18, t1: 78, s: new BinaryScene(env) },
    { t0: 78, t1: 93, s: new WormholeFieldScene(env) },
    { t0: 93, t1: 107, s: new GRScene(env) },
    { t0: 107, t1: 128, s: new FunnelScene(env) },
    { t0: 128, t1: 198, s: new EllisScene(env) },
    { t0: 198, t1: 250, s: new SimScene(env) },
    { t0: 250, t1: 328, s: new CollisionScene(env) },
    { t0: 328, t1: 382, s: new HorizonScene(env) },
    { t0: 382, t1: 436, s: new SignalScene(env) },
    { t0: 436, t1: 481, s: new FinaleScene(env) },
  ];
}

// moments where the picture dips through black for a clean cut
export const CUTS = [18, 78, 93, 107, 128, 178, 186, 198, 250, 328, 382, 436];
