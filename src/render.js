// World HDR -> depth-aware atmosphere -> first-person weapon -> safe bloom -> film finish.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ROOF_GLSL, ROOF_RECT } from './weather.js';
import { ContactAOPass } from './contact-ao.js';
import { RenderFeatures } from './render-features.js';
import { FinalFinishPass } from './final-finish.js';
import { StableBloomPass } from './stable-bloom.js';

const VERT = 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }';

// Integrate a thin sea-level haze along the camera ray. The light's shadow map
// occludes the warm component, so gaps between containers produce real light shafts.
const HazeShader = {
  uniforms: {
    tDiffuse: { value: null }, tDepth: { value: null }, tShadow: { value: null },
    uInvProjection: { value: new THREE.Matrix4() }, uCameraWorld: { value: new THREE.Matrix4() },
    uShadowMatrix: { value: new THREE.Matrix4() }, uSunDir: { value: new THREE.Vector3(1, .2, .3) },
    uSunColor: { value: new THREE.Color(0xffb572) }, uFogColor: { value: new THREE.Color(0x71858c) },
    uShadowOn: { value: 0 }, uSteps: { value: 8 }, uDensity: { value: .005 }, uTime: { value: 0 },
    uRoof: { value: null }, uRoofRect: { value: ROOF_RECT },
    tAO: { value: null }, uAOTexel: { value: new THREE.Vector2(1, 1) }, uAOOn: { value: 0 },
    uAOStrength: { value: .55 }, uHazeOn: { value: 1 }, uExposure: { value: .84 }, uNearSteps: { value: 1 },
  },
  vertexShader: VERT,
  fragmentShader: /* glsl */`
    #include <packing>
    uniform sampler2D tDiffuse,tDepth,tAO;
    uniform sampler2DShadow tShadow;
    uniform mat4 uInvProjection,uCameraWorld,uShadowMatrix;
    uniform vec3 uSunDir,uSunColor,uFogColor;
    uniform float uShadowOn,uSteps,uDensity,uTime;
    uniform vec2 uAOTexel;uniform float uAOOn,uAOStrength,uHazeOn,uExposure,uNearSteps;
    varying vec2 vUv;
    ${ROOF_GLSL}
    float noise(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
    float hazePhase(float mu,float g){float g2=g*g;return(1.0-g2)/(12.566371*pow(max(1.0+g2-2.0*g*mu,.0001),1.5));}
    void main(){
      vec3 color=texture2D(tDiffuse,vUv).rgb;
      float depth=texture2D(tDepth,vUv).x;
      vec4 view=uInvProjection*vec4(vUv*2.0-1.0,depth*2.0-1.0,1.0);
      view.xyz/=max(view.w,0.000001);
      if(uAOOn>.5&&depth<.99999){
        float z=-view.z;vec2 grid=vUv/uAOTexel-.5,f=fract(grid),base=(floor(grid)+.5)*uAOTexel;
        float ao=0.0,weightSum=0.0;
        for(int j=0;j<4;j++){
          vec2 corner=vec2(mod(float(j),2.0),floor(float(j)/2.0));
          vec2 sampleAO=texture2D(tAO,base+corner*uAOTexel).rg;
          float w=mix(1.0-f.x,f.x,corner.x)*mix(1.0-f.y,f.y,corner.y);
          w/=max(.02,abs(sampleAO.y-z)/max(z,.01)+.02);
          ao+=sampleAO.x*w;weightSum+=w;
        }
        ao=weightSum>.0001?ao/weightSum:1.0;
        float lit=smoothstep(.16,.9,dot(color,vec3(.2126,.7152,.0722))*uExposure);
        float contact=clamp((1.0-ao)*uAOStrength*(1.0-.8*lit),0.0,.65);
        color*=1.0-contact*vec3(1.0,.97,.93);
      }
      if(uHazeOn<.5){gl_FragColor=vec4(color,1.0);return;}
      vec3 origin=uCameraWorld[3].xyz;
      vec3 end=(uCameraWorld*vec4(view.xyz,1.0)).xyz;
      vec3 delta=end-origin;
      float distanceToSurface=length(delta);
      vec3 direction=delta/max(distanceToSurface,.001);
      float travel=min(distanceToSurface,160.0);
      // The sky already includes atmospheric scattering; avoid fogging it twice.
      float skyMask=1.0-smoothstep(800.0,1600.0,distanceToSurface);
      float jitter=noise(gl_FragCoord.xy)*.75+.125;
      float transmittance=1.0;
      vec3 scatter=vec3(0.0);
      float mu=dot(direction,uSunDir);
      // Two lobes keep side-lit shafts visible without broadening the sun glare.
      float forwardScatter=.22+1.55*min(1.15,hazePhase(mu,.78)*.55+hazePhase(mu,.25)*.45);
      float previousDistance=0.0;
      for(int i=0;i<12;i++){
        if(float(i)>=uSteps)break;
        float fraction=(float(i)+1.0)/uSteps;
        float endDistance=travel*fraction*mix(1.0,.35+.65*fraction,uNearSteps);
        float stepSize=endDistance-previousDistance;
        vec3 p=origin+direction*(previousDistance+jitter*stepSize);
        float density=uDensity*exp(-max(p.y,0.0)*.16)*mix(.12,1.0,weatherExposed(p+vec3(0,.2,0)));
        float opacity=1.0-exp(-density*stepSize);
        float sunlight=1.0;
        if(uShadowOn>.5){
          vec4 q=uShadowMatrix*vec4(p,1.0);q.xyz/=max(q.w,.0001);
          if(q.x>0.0&&q.x<1.0&&q.y>0.0&&q.y<1.0&&q.z>0.0&&q.z<1.0){
            sunlight=mix(.12,1.0,texture(tShadow,vec3(q.xy,q.z-.0008)));
          }
        }
        vec3 light=uFogColor*.48+uSunColor*forwardScatter*sunlight*.42;
        scatter+=transmittance*opacity*light;
        transmittance*=1.0-opacity;
        previousDistance=endDistance;
      }
      vec3 result=color*transmittance+scatter;
      gl_FragColor=vec4(clamp(mix(color,result,skyMask),vec3(0.0),vec3(128.0)),1.0);
    }`,
};

const SafeShader = {
  uniforms: { tDiffuse: { value: null } }, vertexShader: VERT,
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv; void main(){vec3 c=texture2D(tDiffuse,vUv).rgb; if(!(c.r>=0.0))c.r=0.0;if(!(c.g>=0.0))c.g=0.0;if(!(c.b>=0.0))c.b=0.0;gl_FragColor=vec4(min(c,vec3(128.0)),1.0);}`,
};

const FXShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uDamage: { value: 0 }, uLowHP: { value: 0 },
    uFlash: { value: 0 }, uVignette: { value: 0.28 }, uDeath: { value: 0 }, uScope: { value: 0 },
    uProtect: { value: 0 }, uUnderRoof: { value: 0 },
    uLensWet: { value: 0 }, uAspect: { value: 1 }, uHeartbeat: { value: 0 }, uHurtDirection: { value: new THREE.Vector2(0, 1) },
    uGrade: { value: 1 }, uGrain: { value: 1 }, uVignetteOn: { value: 1 }, uFeedback: { value: 1 },
  },
  vertexShader: VERT,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime,uDamage,uLowHP,uFlash,uVignette,uDeath,uScope,uProtect,uLensWet,uAspect;
    uniform vec2 uHurtDirection; uniform float uHeartbeat;
    uniform float uGrade,uGrain,uVignetteOn,uFeedback;
    varying vec2 vUv;
    float h(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
    vec3 lensDroplets(vec2 uv){
      vec2 offset=vec2(0.0);float edgeLight=0.0;
      for(int i=0;i<6;i++){
        float id=float(i);float seed=h(vec2(id,7.1));
        float cycle=uTime*(.012+seed*.009)+seed*11.0;float life=fract(cycle);
        vec2 center=vec2(mod(id,2.0)<.5?.045+seed*.15:.955-seed*.15,.93-life*.9);
        vec2 p=(uv-center)*vec2(uAspect,1.0);
        float radius=.006+seed*.006;vec2 q=p/vec2(radius,radius*1.6);float r=length(q);
        float drop=1.0-smoothstep(.65,1.0,r);float dropLifeWeight=smoothstep(0.0,.12,life)*(1.0-smoothstep(.85,1.0,life));
        offset+=q*drop*dropLifeWeight*.0015;
        edgeLight+=exp(-pow((r-.83)/.085,2.0))*dropLifeWeight*(.5+.5*clamp(-q.y,0.0,1.0));
      }
      return vec3(offset,edgeLight)*uLensWet;
    }
    void main(){
      float damage=uDamage*uFeedback,death=uDeath*uFeedback,lowHP=uLowHP*uFeedback;
      vec2 c=vUv-.5; float ca=damage*.002+death*.003;
      vec3 lens=uLensWet>.01?lensDroplets(vUv):vec3(0.0);
      vec2 sampleUv=clamp(vUv+lens.xy,vec2(.001),vec2(.999));
      vec3 col=vec3(texture2D(tDiffuse,sampleUv+c*ca).r,texture2D(tDiffuse,sampleUv).g,texture2D(tDiffuse,sampleUv-c*ca).b);
      col+=lens.z*.018;
      col=max(col,vec3(0.0));
      float lum=dot(col,vec3(.2126,.7152,.0722));
      // restrained split tone: cool deep shadows, warm light. Keep team colours legible.
      float shadows=1.0-smoothstep(.04,.65,lum);
      col=mix(col,col*vec3(.91,1.02,1.08),shadows*.35*uGrade);
      col=mix(vec3(lum),col,1.0+.045*uGrade);
      float r=length(c*vec2(1.0,.8));
      col*=1.0-smoothstep(.3,.87,r)*uVignette*.8*uVignetteOn;
      float edge=smoothstep(.22,.65,r);
      float facing=.58+.42*max(dot(normalize(c+vec2(.0001)),normalize(uHurtDirection+vec2(.0001))),0.0);
      col=mix(col,vec3(.66,.012,.006),edge*clamp(damage,0.0,1.0)*facing*.77);
      float gray=dot(col,vec3(.299,.587,.114));
      // A paired heartbeat and broad red lens glow. The central aiming area is
      // deliberately clear; only the outer field blooms as health falls.
      float beat=fract(uHeartbeat);
      float pulse=exp(-pow((beat-.12)/.095,2.0))+.55*exp(-pow((beat-.43)/.11,2.0));
      vec2 screen=c*2.0;
      float rim=smoothstep(.42,.98,length(screen*vec2(.88,.78)));
      float topGlow=exp(-pow((abs(screen.y)-.92)/.24,2.0))*(.35+.65*pow(abs(screen.x),.7));
      float sideGlow=exp(-pow((abs(screen.x)-.96)/.24,2.0))*(.55+.45*cos(screen.y*3.0));
      float glare=(topGlow*.7+sideGlow)*lowHP*(.16+.16*pulse);
      col=mix(col,vec3(gray)*vec3(1.03,.88,.86),lowHP*.38);
      col*=1.0-rim*lowHP*.23;
      col=mix(col,vec3(.38,.006,.012),rim*lowHP*(.26+.13*pulse));
      col+=vec3(1.35,.025,.012)*glare;
      col=mix(col,vec3(gray)*.6,death*.8);
      col=mix(col,vec3(.35,.6,1.0),uProtect*edge*.18*uFeedback);
      col+=uFlash*uFeedback;
      gl_FragColor=vec4(max(col,vec3(0.0)),1.0);
    }`,
};

export class Renderer {
  constructor(canvas, quality) {
    this.quality = ['low', 'medium', 'high'].includes(quality) ? quality : 'high';
    this.features = new RenderFeatures(this.quality);this.adaptive = true;this.disposed = false;
    this.fixedSize = null;
    this.scale = 1; this.frameTime = 16; this.frameCount = 0; this.lastFrame = 0;
    this.basePixelRatio = Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? 1.5 : this.quality === 'medium' ? 1.15 : 1);
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    r.setPixelRatio(this.basePixelRatio);
    r.toneMapping = THREE.AgXToneMapping; r.toneMappingExposure = .84;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.info.autoReset = false;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(78, 16 / 9, .05, 60000);
    this.scene.userData.harborCamera = this.camera;
    this.eyeAdapt = 1;
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(58, 16 / 9, .01, 50);
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: this.quality === 'high' ? 2 : 0, depthBuffer: true });
    rt.depthTexture = new THREE.DepthTexture(size.x, size.y, THREE.UnsignedIntType);
    this.composer = new EffectComposer(r, rt);
    this.worldPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.worldPass);
    this.ao = new ContactAOPass(this.camera, this.quality);
    this.composer.addPass(this.ao);
    this.haze = new ShaderPass(HazeShader);
    this.haze.enabled = this.quality !== 'low';
    this.haze.uniforms.uSteps.value = this.quality === 'high' ? 10 : 6;
    const hazeRender = this.haze.render.bind(this.haze);
    this.haze.render = (renderer, write, read, dt, mask) => {
      const u = this.haze.uniforms, env = this.scene.userData.harborEnvironment;
      u.tDepth.value = read.depthTexture;
      u.uInvProjection.value.copy(this.camera.projectionMatrixInverse);
      u.uCameraWorld.value.copy(this.camera.matrixWorld);
      u.tAO.value = this.ao.target.texture;u.uAOTexel.value.copy(this.ao.uniforms.uTexel.value);
      u.uExposure.value = renderer.toneMappingExposure;
      if (env) {
        u.uSunDir.value.copy(env.sunDir); u.uSunColor.value.copy(env.sun.color);
        u.uFogColor.value.copy(this.scene.fog.color);
        u.uDensity.value = env.name === 'day' ? .0026 : .0065;
        const shadow = env.sun.shadow;
        u.uShadowOn.value = shadow.map?.depthTexture ? 1 : 0;
        if (shadow.map?.depthTexture) { u.tShadow.value = shadow.map.depthTexture; u.uShadowMatrix.value.copy(shadow.matrix); }
        if (env.atmosphere) { u.uRoof.value = env.atmosphere.roof.texture; u.uRoofRect.value.copy(env.atmosphere.roof.rect); }
      }
      hazeRender(renderer, write, read, dt, mask);
    };
    this.composer.addPass(this.haze);
    this.haze.material.depthTest = this.haze.material.depthWrite = false;
    this.vmPass = new RenderPass(this.vmScene, this.vmCamera);
    this.vmPass.clear = false; this.vmPass.clearDepth = true;
    this.composer.addPass(this.vmPass);
    this.composer.addPass(new ShaderPass(SafeShader));
    this.bloom = new StableBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), .2, .5, 1.5);
    this.composer.addPass(this.bloom);
    this.fx = new ShaderPass(FXShader); this.composer.addPass(this.fx);
    this.output = new OutputPass();
    // The reference defaults to 75% ACES / 25% AgX. Mix the two linear display
    // results before the single sRGB transfer, preserving ACES midtone contrast
    // while keeping some of AgX's highlight hue handling. Pure modes remain A/B-able.
    this.output.uniforms.uAgxMix = { value: .25 };
    this.output.material.fragmentShader = this.output.material.fragmentShader
      .replace('uniform sampler2D tDiffuse;', 'uniform sampler2D tDiffuse; uniform float uAgxMix;')
      .replace('gl_FragColor.rgb = AgXToneMapping( gl_FragColor.rgb );',
        'vec3 hdrSource = gl_FragColor.rgb; gl_FragColor.rgb = mix( ACESFilmicToneMapping( hdrSource ), AgXToneMapping( hdrSource ), uAgxMix );');
    this.composer.addPass(this.output);
    this.finish = new FinalFinishPass(this.quality);this.composer.addPass(this.finish);
    this.setFeatures({});
    this.resize();
    this._onResize = () => this.resize();window.addEventListener('resize', this._onResize);
  }
  setFeatures(patch) {
    const f = this.features.set(patch);
    this.ao.enabled = f.post && f.ao && f.aoStrength > 0;
    this.haze.enabled = (f.post && f.haze) || this.ao.enabled;
    this.haze.uniforms.uAOOn.value = this.ao.enabled ? 1 : 0;
    this.haze.uniforms.uHazeOn.value = f.post && f.haze ? 1 : 0;
    this.haze.uniforms.uAOStrength.value = f.aoStrength;
    this.haze.uniforms.uNearSteps.value = f.hazeDistribution === 'near' ? 1 : 0;
    this.bloom.enabled = f.post && f.bloom && f.bloomStrength > 0;this.bloom.strength = f.bloomStrength;
    this.bloom.highPassUniforms.uStable.value = f.bloomStable ? 1 : 0;
    this.fx.enabled = f.post || f.feedback;
    this.fx.uniforms.uGrade.value = f.post && f.grade ? 1 : 0;
    this.fx.uniforms.uGrain.value = 0;
    this.fx.uniforms.uVignetteOn.value = f.post && f.vignette ? 1 : 0;
    this.fx.uniforms.uFeedback.value = f.feedback ? 1 : 0;
    if (!f.post || !f.lens) this.fx.uniforms.uLensWet.value = 0;
    this.renderer.toneMapping = f.toneMapping === 'aces' ? THREE.ACESFilmicToneMapping : THREE.AgXToneMapping;
    this.output.uniforms.uAgxMix.value = f.toneMapping === 'hybrid' ? .25 : 1;
    this.finish.enabled = f.post && (f.aa || (f.sharpen && f.sharpness > 0) || f.grain);
    this.finish.uniforms.uAA.value = f.post && f.aa ? 1 : 0;
    this.finish.uniforms.uSharpness.value = f.post && f.sharpen ? f.sharpness : 0;
    this.finish.uniforms.uGrain.value = f.post && f.grain ? 1 : 0;
    this.scene.userData.harborEnvironment?.setShadowOptions?.(f);
    this.updateExposure(0);
    return f;
  }
  getFeatures() { return this.features.get(); }
  updateExposure(dt) {
    const f = this.features.state, env = this.scene.userData.harborEnvironment;
    const adapt = f.autoExposure && f.exposure === null;
    if (!adapt) this.eyeAdapt = 1;
    else {
      const target = env?.atmosphere?.exposure === 0 ? 1.14 : 1;
      this.eyeAdapt += (target-this.eyeAdapt)*(1-Math.exp(-Math.max(0,Math.min(dt,100))/1000*(target > this.eyeAdapt ? .65 : 1.6)));
    }
    this.renderer.toneMappingExposure = (f.exposure ?? env?.preset?.exposure ?? .84) * this.eyeAdapt;
  }
  resize(width, height) {
    if (Number.isFinite(width) && Number.isFinite(height)) this.fixedSize = { width: Math.max(1,width), height: Math.max(1,height) };
    const w = this.fixedSize?.width || Math.max(1, window.innerWidth), h = this.fixedSize?.height || Math.max(1, window.innerHeight);
    const maxPixels = this.quality === 'high' ? 2300000 : this.quality === 'medium' ? 1400000 : 950000;
    const ratio = Math.min(this.basePixelRatio * (this.adaptive ? this.scale : 1), Math.sqrt(maxPixels / (w * h)));
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(ratio); this.composer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = w / h; this.vmCamera.updateProjectionMatrix();
    if (this.fx) this.fx.uniforms.uAspect.value = w / h;
  }
  render() {
    const now = performance.now();
    const dt = now - (this.lastFrame || now - 16.67); this.lastFrame = now;
    if (dt > 0 && dt < 150 && !document.hidden) this.frameTime += (dt - this.frameTime) * .025;
    this.frameCount++;
    const environment = this.scene.userData.harborEnvironment;
    const weather = environment?.atmosphere;
    const features = this.features.state;
    environment?.setShadowOptions?.(features);
    this.finish.uniforms.uTime.value = this.fx.uniforms.uTime.value;
    if (weather) {
      this.fx.uniforms.uLensWet.value = features.post && features.lens ? weather.lensWetness : 0;
    }
    this.updateExposure(dt);
    if (this.adaptive && this.frameCount > 180 && this.frameCount % 120 === 0) {
      const old = this.scale;
      if (this.frameTime > 24) this.scale = Math.max(.65, this.scale - .1);
      else if (this.frameTime < 17 && this.frameCount % 480 === 0) this.scale = Math.min(1, this.scale + .05);
      if (old !== this.scale) this.resize();
      const atmosphere = this.scene.userData.harborEnvironment?.atmosphere;
      if (atmosphere?.setPerformanceReflections) atmosphere.setPerformanceReflections(!(this.scale <= .66 && this.frameTime > 30));
    }
    this.renderer.info.reset();
    this.composer.render();
  }
  dispose() {
    if(this.disposed)return;this.disposed=true;
    window.removeEventListener('resize',this._onResize);
    for(const pass of this.composer.passes)pass.dispose?.();
    this.composer.dispose();this.renderer.dispose();
  }
}
