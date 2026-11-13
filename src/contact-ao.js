// Half-resolution contact AO. Uses the existing world depth, never another
// geometry pass. Depth accompanies AO for edge-aware upsampling in the composite.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

export class ContactAOPass extends Pass {
  constructor(camera, quality = 'high') {
    super();this.needsSwap = false;this.camera = camera;this.disposed = false;
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
    this.uniforms = { tDepth: { value: null }, uInvProjection: { value: new THREE.Matrix4() }, uTexel: { value: new THREE.Vector2(1, 1) }, uProjectionY: { value: 1 }, uAspect: { value: 1 }, uRadius: { value: .65 } };
    this.material = new THREE.ShaderMaterial({ uniforms: this.uniforms, defines: { AO_TAPS: quality === 'high' ? 10 : 6 }, depthTest: false, depthWrite: false,
      vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}',
      fragmentShader: `
        uniform sampler2D tDepth;uniform mat4 uInvProjection;uniform vec2 uTexel;
        uniform float uProjectionY,uAspect,uRadius;varying vec2 vUv;
        vec3 positionAt(vec2 uv){float d=texture2D(tDepth,uv).r;vec4 p=uInvProjection*vec4(uv*2.0-1.0,d*2.0-1.0,1.0);return p.xyz/max(p.w,.000001);}
        void main(){
          vec3 p=positionAt(vUv);float z=-p.z;
          if(z<.08||z>100.0){gl_FragColor=vec4(1.0,min(z,1000.0),0.0,1.0);return;}
          vec3 l=positionAt(vUv-vec2(uTexel.x,0)),r=positionAt(vUv+vec2(uTexel.x,0));
          vec3 b=positionAt(vUv-vec2(0,uTexel.y)),t=positionAt(vUv+vec2(0,uTexel.y));
          vec3 dx=abs(l.z-p.z)<abs(r.z-p.z)?p-l:r-p;
          vec3 dy=abs(b.z-p.z)<abs(t.z-p.z)?p-b:t-p;
          vec3 n=cross(dx,dy);n/=max(length(n),.00001);
          float radiusUv=clamp(uRadius*uProjectionY/(2.0*z),uTexel.y*2.0,.1);
          float rotation=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))))*6.283185;
          float sum=0.0;
          for(int i=0;i<AO_TAPS;i++){
            float f=(float(i)+.5)/float(AO_TAPS),angle=float(i)*2.399963+rotation;
            vec2 uv=vUv+vec2(cos(angle)/uAspect,sin(angle))*sqrt(f)*radiusUv;
            if(uv.x<=0.0||uv.x>=1.0||uv.y<=0.0||uv.y>=1.0)continue;
            vec3 v=positionAt(uv)-p;float d2=dot(v,v),distanceToSample=sqrt(max(d2,.00001));
            float rangeWeight=max(0.0,1.0-d2/(uRadius*uRadius));
            float horizon=max(0.0,dot(v,n)/distanceToSample-(.06+.002*z)/distanceToSample);
            sum+=horizon*rangeWeight*rangeWeight;
          }
          float occlusion=clamp(sum*3.4/float(AO_TAPS),0.0,.65)*(1.0-smoothstep(55.0,100.0,z));
          gl_FragColor=vec4(1.0-occlusion,z,0.0,1.0);
        }` });
    this.quad = new FullScreenQuad(this.material);
  }
  setSize(width, height) {
    const w = Math.max(1, Math.ceil(width / 2)), h = Math.max(1, Math.ceil(height / 2));
    this.target.setSize(w, h);this.uniforms.uTexel.value.set(1 / w, 1 / h);
  }
  render(renderer, write, read) {
    const u = this.uniforms;
    u.tDepth.value = read.depthTexture;u.uInvProjection.value.copy(this.camera.projectionMatrixInverse);
    u.uProjectionY.value = this.camera.projectionMatrix.elements[5];u.uAspect.value = this.camera.aspect;
    renderer.setRenderTarget(this.target);this.quad.render(renderer);
  }
  dispose() { if(this.disposed)return;this.disposed=true;this.target.dispose();this.material.dispose();this.quad.dispose(); }
}
