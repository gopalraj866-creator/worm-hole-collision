// Full-screen gravitational-lensing background.
//
// For every pixel a camera ray is bent by up to two lenses (wormholes or black holes) using the
// exact deflection tables from lutmath.js (thin-lens approximation: the ray is deflected once, at
// its point of closest approach to each lens). Rays that pass through a wormhole throat emerge in the
// *other* universe and sample a different sky. Rays captured by a black hole are black.
//
// NOTE: two interacting wormholes have no closed-form metric. The multi-lens composition used here is an
// artistic visualization informed by the single-wormhole optics, not output of the preprint's simulation.
import * as THREE from 'three';
import { buildTables, LUT_W, LMIN, LMAX } from './lutmath.js';

export const MAXL = 2;

const SKY_GLSL = /* glsl */`
float hash31(vec3 p){ p=fract(p*0.1031); p+=dot(p,p.yzx+33.33); return fract((p.x+p.y)*p.z); }
vec3 hash33(vec3 p){ p=fract(p*vec3(0.1031,0.1030,0.0973)); p+=dot(p,p.yxz+33.33); return fract((p.xxy+p.yxx)*p.zyx); }
float vnoise(vec3 p){
  vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash31(i),hash31(i+vec3(1,0,0)),f.x), mix(hash31(i+vec3(0,1,0)),hash31(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash31(i+vec3(0,0,1)),hash31(i+vec3(1,0,1)),f.x), mix(hash31(i+vec3(0,1,1)),hash31(i+vec3(1,1,1)),f.x),f.y), f.z);
}
float fbm(vec3 p){ float a=0.5, s=0.0; for(int i=0;i<5;i++){ s+=a*vnoise(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=0.5; } return s; }

vec3 starColor(float h){
  vec3 red=vec3(1.0,0.62,0.42), wht=vec3(1.0,0.95,0.9), blu=vec3(0.62,0.74,1.0);
  return h<0.5 ? mix(red,wht,h*2.0) : mix(wht,blu,(h-0.5)*2.0);
}
// One layer of procedurally placed stars on the celestial sphere; footprint never smaller than a pixel.
vec3 starLayer(vec3 rd, float scale, float prob, float rad, float seed, float gain, vec3 tint){
  vec3 p=rd*scale; vec3 c=floor(p); vec3 f=p-c;
  float h=hash31(c+seed);
  if(h>prob) return vec3(0.0);
  vec3 sp=0.22+0.56*hash33(c+seed*1.7);
  float d=length(f-sp)/scale;
  float mag=pow(hash31(c*1.31+seed*3.1),3.0);
  float r0=rad*(0.6+0.8*mag);
  float r=max(r0, uPixAng*0.85);
  float flux=gain*(0.15+mag*2.2)*(r0*r0)/(r*r);
  float cs=hash31(c*2.7+seed);
  return starColor(cs)*tint*flux*exp(-d*d/(r*r));
}

vec3 skyA(vec3 rd){
  vec3 gn=normalize(vec3(0.28,0.88,0.38));
  float lat=dot(rd,gn);
  float band=exp(-lat*lat/0.03);
  float core=exp(-pow(dot(rd,normalize(vec3(-0.55,0.1,0.83)))*0.5+0.5-1.0,2.0)*18.0);
  float n1=fbm(rd*3.2+vec3(3.1,1.2,7.7));
  float n2=fbm(rd*11.0+vec3(5.3));
  float dust=smoothstep(0.38,0.72,fbm(rd*5.5+vec3(7.0,2.0,1.0)));
  vec3 mw=mix(vec3(0.95,0.62,0.38),vec3(0.55,0.68,1.0),n1);
  float glow=band*(0.22+0.95*n2)*(1.0-0.8*dust*band)*(1.0+2.2*core);
  vec3 col=mw*glow*0.16;
  // soft violet/teal nebulae away from the band
  float neb=smoothstep(0.55,0.85,fbm(rd*2.1+vec3(11.0,4.0,2.0)));
  col+=vec3(0.18,0.06,0.28)*neb*0.35 + vec3(0.02,0.12,0.16)*smoothstep(0.5,0.9,fbm(rd*2.7+vec3(1.0,8.0,3.0)))*0.3;
  vec3 st=vec3(0.0);
  st+=starLayer(rd,38.0,0.18,0.0016,1.0,2.6,vec3(1.0));
  st+=starLayer(rd,85.0,0.20,0.0012,2.0,1.7,vec3(1.0));
  st+=starLayer(rd,190.0,0.20,0.0009,3.0,1.1,vec3(1.0));
  st+=starLayer(rd,420.0,0.14+0.22*band,0.0007,4.0,0.8,vec3(1.0))*(0.7+band);
  st*=(1.0-0.65*dust*band);
  return col+st;
}

vec3 skyB(vec3 rd){
  vec3 q=rd*2.3;
  q+=1.4*vec3(fbm(q+vec3(3.0)),fbm(q+vec3(9.0)),fbm(q+vec3(15.0)));
  float n=fbm(q*1.5);
  vec3 c1=vec3(0.04,0.38,0.62), c2=vec3(0.78,0.12,0.52), c3=vec3(1.0,0.62,0.18);
  vec3 neb=mix(c1,c2,smoothstep(0.28,0.72,n));
  neb=mix(neb,c3,smoothstep(0.62,0.9,fbm(q*2.6+vec3(4.0))));
  float dens=smoothstep(0.30,0.80,n);
  vec3 col=neb*dens*0.5;
  float core=exp(-pow(1.0-(dot(rd,normalize(vec3(0.2,-0.3,-0.93)))*0.5+0.5),2.0)*60.0);
  col+=vec3(1.0,0.82,0.6)*core*0.55;
  vec3 st=vec3(0.0);
  st+=starLayer(rd,34.0,0.2,0.0018,11.0,5.0,vec3(0.7,0.85,1.1));
  st+=starLayer(rd,80.0,0.3,0.0012,12.0,3.2,vec3(0.8,0.9,1.1));
  st+=starLayer(rd,210.0,0.32,0.0009,13.0,2.2,vec3(0.9,0.95,1.1));
  return col+st*(1.0-0.5*dens);
}
`;

const FRAG = /* glsl */`
precision highp float;
uniform vec3 uCamPos, uCamR, uCamU, uCamF;
uniform float uTanHalf, uAspect, uPixAng;
uniform sampler2D uLUT;
uniform vec3 uLensPos[2];
uniform vec4 uLensP[2];   // x: radius b, y: type (0 BH, 1 wormhole), z: strength 0..1, w: glow amount
uniform vec3 uLensGlow[2];
uniform float uSkyGain;
uniform float uSkyBGain;
uniform vec4 uWave;       // x amplitude, y wavenumber, z phase, w decay
uniform vec3 uWaveDir;
varying vec2 vNdc;
${SKY_GLSL}

const float LMIN=${LMIN.toFixed(6)};
const float LMAX=${LMAX.toFixed(6)};
const float BCR=5.196152;

float lut(int row,float s){
  float x=clamp(s,0.0,1.0)*${(LUT_W - 1).toFixed(1)};
  int i0=int(floor(x)); int i1=min(i0+1,${LUT_W - 1});
  float f=x-float(i0);
  return mix(texelFetch(uLUT,ivec2(i0,row),0).r, texelFetch(uLUT,ivec2(i1,row),0).r, f);
}
// returns deflection (radians); sets cap=1 when swallowed by a black hole
float deflection(float type,float x,out float cap){
  cap=0.0;
  if(type<0.5){
    if(x<=1.0){ cap=1.0; return 0.0; }
    float d=x-1.0;
    if(d>80.0) return 0.7698/x + 0.2619/(x*x);
    return lut(2,(log(d)-LMIN)/(LMAX-LMIN));
  }
  if(x<1.0) return lut(0,x);
  float d=x-1.0;
  if(d>80.0) return 0.7854/(x*x);
  return lut(1,(log(d)-LMIN)/(LMAX-LMIN));
}

void main(){
  vec3 rd=normalize(uCamF + vNdc.x*uTanHalf*uAspect*uCamR + vNdc.y*uTanHalf*uCamU);
  vec3 ro=uCamPos;
  float uni=0.0, captured=0.0;
  vec3 glow=vec3(0.0);
  for(int k=0;k<2;k++){
    float amt=uLensP[k].z;
    if(amt<=0.0001) continue;
    if(uni>0.5) break;
    vec3 R=ro-uLensPos[k];
    float tca=-dot(R,rd);
    if(tca<=0.0) continue;
    vec3 Bv=R+rd*tca;
    float Bl=max(length(Bv),1e-5);
    vec3 n=Bv/Bl;
    float b=uLensP[k].x;
    float x=Bl/b;
    float cap;
    float a=deflection(uLensP[k].y,x,cap)*amt;
    // glow around the throat / photon ring
    float gl=exp(-pow((x-1.0)*9.0,2.0))*1.4 + exp(-max(x-1.0,0.0)*1.6)*0.10*step(1.0,x);
    glow+=uLensGlow[k]*gl*uLensP[k].w*amt;
    if(cap>0.5){ captured=1.0; break; }
    rd=normalize(rd*cos(a)-n*sin(a));
    ro=uLensPos[k]+Bv;
    if(uLensP[k].y>0.5 && x<1.0 && amt>0.5) uni=1.0;
  }
  // gravitational-wave ripple: tiny angular shear travelling over the sky
  if(uWave.x>0.0){
    float ang=acos(clamp(dot(rd,uWaveDir),-1.0,1.0));
    vec3 e=normalize(rd-dot(rd,uWaveDir)*uWaveDir+1e-5);
    float w=sin(ang*uWave.y-uWave.z)*exp(-ang*uWave.w)*uWave.x;
    rd=normalize(rd+e*w);
  }
  vec3 col = captured>0.5 ? vec3(0.0) : (uni<0.5 ? skyA(rd)*uSkyGain : skyB(rd)*uSkyBGain);
  col+=glow;
  gl_FragColor=vec4(col,1.0);
}
`;

const VERT = /* glsl */`
varying vec2 vNdc;
void main(){ vNdc=position.xy; gl_Position=vec4(position.xy,0.0,1.0); }
`;

export class LensQuad {
  constructor() {
    const { data, W, H } = buildTables();
    const lut = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType);
    lut.minFilter = THREE.NearestFilter; lut.magFilter = THREE.NearestFilter;
    lut.needsUpdate = true;
    this.uniforms = {
      uCamPos: { value: new THREE.Vector3() }, uCamR: { value: new THREE.Vector3() },
      uCamU: { value: new THREE.Vector3() }, uCamF: { value: new THREE.Vector3() },
      uTanHalf: { value: 0.5 }, uAspect: { value: 16 / 9 }, uPixAng: { value: 0.0005 },
      uLUT: { value: lut },
      uLensPos: { value: [new THREE.Vector3(), new THREE.Vector3()] },
      uLensP: { value: [new THREE.Vector4(1, 1, 0, 0), new THREE.Vector4(1, 1, 0, 0)] },
      uLensGlow: { value: [new THREE.Vector3(1, 1, 1), new THREE.Vector3(1, 1, 1)] },
      uSkyGain: { value: 1.0 }, uSkyBGain: { value: 1.0 },
      uWave: { value: new THREE.Vector4(0, 20, 0, 2) }, uWaveDir: { value: new THREE.Vector3(0, 0, -1) },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      depthTest: false, depthWrite: false,
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
  }

  // lenses: [{pos:[x,y,z], b, type:0|1, amt, glow:[r,g,b], glowAmt}]
  update(camera, size, lenses = [], opts = {}) {
    const u = this.uniforms;
    const e = camera.matrixWorld.elements;
    u.uCamR.value.set(e[0], e[1], e[2]);
    u.uCamU.value.set(e[4], e[5], e[6]);
    u.uCamF.value.set(-e[8], -e[9], -e[10]);
    u.uCamPos.value.set(e[12], e[13], e[14]);
    const th = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    u.uTanHalf.value = th; u.uAspect.value = camera.aspect;
    u.uPixAng.value = (2 * th) / size.h;
    const sorted = lenses.slice().sort((a, b) =>
      new THREE.Vector3(...a.pos).distanceToSquared(u.uCamPos.value) - new THREE.Vector3(...b.pos).distanceToSquared(u.uCamPos.value));
    for (let k = 0; k < MAXL; k++) {
      const L = sorted[k];
      if (!L) { u.uLensP.value[k].set(1, 1, 0, 0); continue; }
      u.uLensPos.value[k].set(L.pos[0], L.pos[1], L.pos[2]);
      u.uLensP.value[k].set(L.b, L.type, L.amt ?? 1, L.glowAmt ?? 0);
      const g = L.glow || [1, 1, 1];
      u.uLensGlow.value[k].set(g[0], g[1], g[2]);
    }
    u.uSkyGain.value = opts.skyGain ?? 1; u.uSkyBGain.value = opts.skyBGain ?? 1;
    const w = opts.wave;
    if (w) { u.uWave.value.set(w.amp, w.k ?? 24, w.phase ?? 0, w.decay ?? 1.2); u.uWaveDir.value.set(...w.dir).normalize(); }
    else u.uWave.value.set(0, 20, 0, 2);
  }
}
