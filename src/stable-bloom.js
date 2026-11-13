// Reuse UnrealBloomPass's existing bright extraction and mip chain. A small
// Karis-style first downsample makes isolated HDR highlights contribute less
// than broad lights, reducing rain/specular fireflies without clipping the sun.
import { Vector2 } from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

export class StableBloomPass extends UnrealBloomPass {
  constructor(size, strength=.2, radius=.5, threshold=1.5) {
    super(size,strength,radius,threshold);
    this.highPassUniforms.uStable = { value: 1 };
    this.highPassUniforms.uSourceTexel = { value: new Vector2(1,1) };
    this.materialHighPassFilter.fragmentShader = /* glsl */`
      uniform sampler2D tDiffuse;uniform vec2 uSourceTexel;
      uniform float luminosityThreshold,smoothWidth,uStable;varying vec2 vUv;
      float bloomLuma(vec3 c){return dot(c,vec3(.299,.587,.114));}
      vec3 bloomSample(vec2 p){return clamp(texture2D(tDiffuse,clamp(p,uSourceTexel*.5,1.0-uSourceTexel*.5)).rgb,0.0,128.0);}
      void main(){
        vec3 color;
        if(uStable<.5){color=bloomSample(vUv);float a=smoothstep(luminosityThreshold,luminosityThreshold+smoothWidth,bloomLuma(color));gl_FragColor=vec4(color*a,a);return;}
        vec3 acc=vec3(0.0);float weights=0.0;
        for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
          vec3 tap=bloomSample(vUv+vec2(float(x),float(y))*uSourceTexel);
          float spatial=(x==0?2.0:1.0)*(y==0?2.0:1.0);
          float weight=spatial/(1.0+bloomLuma(tap)*.08);
          acc+=tap*weight;weights+=weight;
        }
        color=acc/max(weights,.00001);
        float luminance=bloomLuma(color),knee=max(.001,luminosityThreshold*.45);
        float soft=clamp(luminance-luminosityThreshold+knee,0.0,2.0*knee);
        soft=soft*soft/(4.0*knee);
        float contribution=max(luminance-luminosityThreshold,soft)/max(luminance,.00001);
        gl_FragColor=vec4(color*contribution,1.0);
      }`;
    this.disposed = false;
    this.setSize(size.x,size.y);
  }
  setSize(width,height) {
    let w=Math.max(1,Math.round(width/2)),h=Math.max(1,Math.round(height/2));
    this.resolution.set(Math.max(1,width),Math.max(1,height));
    this.renderTargetBright.setSize(w,h);
    for(let i=0;i<this.nMips;i++){
      this.renderTargetsHorizontal[i].setSize(w,h);this.renderTargetsVertical[i].setSize(w,h);
      this.separableBlurMaterials[i].uniforms.invSize.value.set(1/w,1/h);
      w=Math.max(1,Math.round(w/2));h=Math.max(1,Math.round(h/2));
    }
  }
  render(renderer,write,read,dt,mask) {
    this.highPassUniforms.uSourceTexel.value.set(1/Math.max(1,read.width),1/Math.max(1,read.height));
    super.render(renderer,write,read,dt,mask);
  }
  dispose() { if(this.disposed)return;this.disposed=true;this.materialHighPassFilter.dispose();super.dispose(); }
}
