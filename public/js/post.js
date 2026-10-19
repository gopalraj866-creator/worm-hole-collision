import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null }, tOverlay: { value: null },
    uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1920, 1080) },
    uFade: { value: 1 }, uFlash: { value: 0 }, uFlashPos: { value: new THREE.Vector2(0.5, 0.5) },
    uExposure: { value: 0.85 }, uChroma: { value: 1.0 }, uGrain: { value: 1.0 },
    uTint: { value: new THREE.Vector3(1, 1, 1) },
  },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }`,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tDiffuse, tOverlay;
    uniform vec2 uRes, uFlashPos;
    uniform float uTime,uFade,uFlash,uExposure,uChroma,uGrain;
    uniform vec3 uTint;
    varying vec2 vUv;
    float h21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
    vec3 aces(vec3 x){ const float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14; return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0); }
    void main(){
      vec2 uv=vUv; vec2 c=uv-0.5;
      float r2=dot(c*vec2(uRes.x/uRes.y,1.0),c*vec2(uRes.x/uRes.y,1.0));
      // gentle radial chromatic aberration (lens-like)
      vec2 off=c*r2*0.0035*uChroma;
      vec3 col=vec3(texture2D(tDiffuse,uv+off).r,texture2D(tDiffuse,uv).g,texture2D(tDiffuse,uv-off).b);
      col*=uTint*uExposure;
      // flash
      float fd=length((uv-uFlashPos)*vec2(uRes.x/uRes.y,1.0));
      col+=uFlash*vec3(1.0,0.86,0.68)*(0.35+2.2*exp(-fd*fd*5.0));
      col=aces(col);
      // subtle cool shadows / warm highlights grade
      float l=dot(col,vec3(0.2126,0.7152,0.0722));
      col=mix(col*vec3(0.94,0.98,1.06),col*vec3(1.05,1.0,0.95),smoothstep(0.25,0.9,l));
      // vignette
      col*=1.0-0.55*smoothstep(0.25,0.95,r2*1.5);
      col=pow(col,vec3(1.0/2.2));
      // film grain + dithering (kills banding in dark gradients)
      float g=h21(uv*uRes+fract(uTime*7.31)*91.7)-0.5;
      float g2=h21(uv*uRes*0.5+fract(uTime*3.17)*41.3)-0.5;
      col+=(g+0.5*g2)*(0.020*uGrain)*(1.0-0.4*l)+ (g/255.0);
      col*=uFade;
      vec4 ov=texture2D(tOverlay,uv);
      col=col*(1.0-ov.a)+ov.rgb*uFade;   // overlay is premultiplied
      gl_FragColor=vec4(clamp(col,0.0,1.0),1.0);
    }`,
};

export function makePost(renderer, W, H) {
  const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 0 });
  const composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(1);
  composer.setSize(W, H);
  const dummyScene = new THREE.Scene(), dummyCam = new THREE.PerspectiveCamera();
  const renderPass = new RenderPass(dummyScene, dummyCam);
  composer.addPass(renderPass);
  // Bloom is evaluated at a fixed 1920x1080 logical resolution so 1080p and 4K look identical.
  const bloom = new UnrealBloomPass(new THREE.Vector2(1920, 1080), 0.38, 0.6, 1.1);
  composer.addPass(bloom);
  bloom.setSize(1920, 1080);
  const finalPass = new ShaderPass(FinalShader);
  composer.addPass(finalPass);
  finalPass.renderToScreen = true;
  finalPass.uniforms.uRes.value.set(W, H);
  return { composer, renderPass, bloom, finalPass };
}
