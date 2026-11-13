// Display-space edge AA belongs after tone mapping and after the viewmodel.
// Use Three's edge-search FXAA: the reference's cheaper diagonal average broke
// small Chinese strokes in our sprite labels. Grain stays after edge detection.
import { Vector2 } from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

function edgeSearchFunctions(quality) {
  const source=FXAAShader.fragmentShader;
  let code=source.slice(source.indexOf('#define EDGE_STEP_COUNT'),source.lastIndexOf('void main()'));
  const count=quality==='high'?6:quality==='medium'?4:3;
  const steps=count===6?'1.0, 1.5, 2.0, 2.0, 2.0, 4.0':count===4?'1.0, 1.5, 2.0, 4.0':'1.0, 2.0, 4.0';
  code=code.replace('#define EDGE_STEP_COUNT 6',`#define EDGE_STEP_COUNT ${count}`)
    .replace('#define EDGE_STEPS 1.0, 1.5, 2.0, 2.0, 2.0, 4.0',`#define EDGE_STEPS ${steps}`)
    .replace('float _SubpixelBlending = 1.0;','float _SubpixelBlending = 0.6;');
  // Flat sky and paint need only the centre/cardinal cross. Postpone the four
  // diagonals until after that cheap contrast test; all tiers share this path.
  const diagonals=code.match(/\s+l\.ne = SampleLuminance[\s\S]*?l\.sw = SampleLuminance[^\n]+/);
  if(!diagonals)throw new Error('Unexpected FXAA neighbourhood layout');
  code=code.replace(diagonals[0],'').replace('return l;',`
    if(l.contrast>=max(_ContrastThreshold,_RelativeThreshold*l.highest)){${diagonals[0]}}
    else{l.ne=l.m;l.nw=l.m;l.se=l.m;l.sw=l.m;}
    return l;`);
  return code;
}

export class FinalFinishPass extends ShaderPass {
  constructor(quality='high') {
    super({
      uniforms: { tDiffuse: { value: null }, uTexel: { value: new Vector2(1, 1) }, uAA: { value: 1 }, uSharpness: { value: .12 }, uGrain: { value: 1 }, uTime: { value: 0 } },
      vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}',
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;uniform vec2 uTexel;
        uniform float uAA,uSharpness,uGrain,uTime;varying vec2 vUv;
        ${edgeSearchFunctions(quality)}
        float finishLuma(vec3 c){return dot(c,vec3(.299,.587,.114));}
        float finishNoise(vec2 p){return fract(52.9829189*fract(dot(p,vec2(.06711056,.00583715))));}
        vec3 sampleFinish(vec2 uv){return texture2D(tDiffuse,clamp(uv,uTexel*.5,1.0-uTexel*.5)).rgb;}
        void main(){
          vec3 center=sampleFinish(vUv);
          vec3 color=uAA>.5?ApplyFXAA(tDiffuse,uTexel,vUv).rgb:center;
          if(uSharpness>0.0){
            vec3 nw=sampleFinish(vUv+vec2(-1,-1)*uTexel),ne=sampleFinish(vUv+vec2(1,-1)*uTexel);
            vec3 sw=sampleFinish(vUv+vec2(-1,1)*uTexel),se=sampleFinish(vUv+vec2(1,1)*uTexel);
            float lm=finishLuma(center),lnw=finishLuma(nw),lne=finishLuma(ne),lsw=finishLuma(sw),lse=finishLuma(se);
            float lmin=min(lm,min(min(lnw,lne),min(lsw,lse))),lmax=max(lm,max(max(lnw,lne),max(lsw,lse)));
            float contrast=lmax-lmin;
            // Restore only low-contrast detail. Limit both overshoot and the
            // local colour envelope so bright wet edges cannot grow halos.
            vec3 detail=(center-(nw+ne+sw+se)*.25)*uSharpness*(1.0-smoothstep(.04,.20,contrast));
            vec3 lo=min(center,min(min(nw,ne),min(sw,se))),hi=max(center,max(max(nw,ne),max(sw,se)));
            // Bound the sharpening increment around its unfiltered source, not
            // the AA result: AA may validly sample beyond these four diagonals.
            color+=clamp(center+clamp(detail,vec3(-.012),vec3(.012)),lo,hi)-center;
          }
          float lum=finishLuma(color);
          float noise=finishNoise(gl_FragCoord.xy+fract(uTime*.31)*vec2(173.3,311.7))-.5;
          color+=noise*.004*uGrain*mix(.35,1.0,smoothstep(.0,.10,lum))*(1.0-.6*smoothstep(.3,.9,lum));
          gl_FragColor=vec4(clamp(color,0.0,1.0),1.0);
        }`
    });
    this.material.depthTest = this.material.depthWrite = false;
    this.material.toneMapped = false;
    this.disposed = false;
  }
  setSize(width, height) { this.uniforms.uTexel.value.set(1 / Math.max(1,width), 1 / Math.max(1,height)); }
  dispose() { if(this.disposed)return;this.disposed=true;super.dispose(); }
}
