// Wet surfaces and precipitation: continuous dry/damp/soaked/puddle states,
// directional water coverage, sparse expanding impact rings and a roof atlas.
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { RoofAtlas, Precipitation, ROOF_GLSL } from './weather.js';

const NOISE = `
uniform float uWetness,uRainAmount;
float wetHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float wetNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(wetHash(i),wetHash(i+vec2(1,0)),f.x),mix(wetHash(i+vec2(0,1)),wetHash(i+vec2(1,1)),f.x),f.y);}
float wetField(vec2 p){return wetNoise(p*.24)*.60+wetNoise(p*.68+7.0)*.27+wetNoise(p*2.7)*.13;}
float wetMask(vec2 p){return smoothstep(.52,.65,wetField(p));}
vec2 wetRipple(vec2 p,float time,float cell,float seed){
 vec2 q=p/cell+seed;vec2 id=floor(q);vec2 f=fract(q);
 float h=wetHash(id+seed);float clock=time*(1.15+.8*h)+h*9.0;float cycle=floor(clock);float life=fract(clock);
 vec2 center=vec2(wetHash(id+cycle*3.17),wetHash(id.yx+cycle*5.7+seed))*.48+.26;
 vec2 delta=(f-center)*cell;float distanceToDrop=length(delta);
 float radius=life*(.16+.16*h)*cell;float width=.006+.015*life;
 float wave=(distanceToDrop-radius)/width;
 float crest=wave*exp(-wave*wave)*2.2;
 float amplitude=pow(1.0-life,1.5)*smoothstep(0.0,.06,life)*(.4+.6*h);
 return delta/max(distanceToDrop,.0001)*crest*amplitude*uRainAmount;
}
`;

function attachWeatherUniforms(shader, uniforms) { Object.assign(shader.uniforms, uniforms); }

function wetDeck(deck, uniforms, quality) {
  if (!deck || !deck.material?.isMeshStandardMaterial) return;
  const mat = deck.material;
  // Authored ORM values already describe paint, exposed steel and oil. A scalar
  // metalness multiplier must not turn every exposed patch into a dielectric.
  mat.roughness = mat.roughnessMap ? 1 : .9; mat.metalness = mat.metalnessMap ? 1 : .18; mat.envMapIntensity = 1.15;
  mat.normalScale.set(.6, .6);
  const before = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    before.call(mat, shader, renderer); attachWeatherUniforms(shader, uniforms);
    shader.vertexShader = 'varying vec3 vWetWorld;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWetWorld=(modelMatrix*vec4(transformed,1.0)).xyz;');
    shader.fragmentShader = 'uniform float uWeatherTime; varying vec3 vWetWorld;\n' + NOISE + ROOF_GLSL + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float wetExpose=weatherExposed(vWetWorld+vec3(0,.2,0))*uWetness;
      float wetValue=wetField(vWetWorld.xz);
      float wetPuddle=smoothstep(.52,.65,wetValue)*wetExpose;
      float wetSoak=smoothstep(.40,.57,wetValue)*wetExpose;
      float wetDamp=smoothstep(.27,.52,wetValue)*wetExpose;
      diffuseColor.rgb*=mix(1.0,.76,wetDamp)*mix(1.0,.73,wetSoak);
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor=mix(max(.08,roughnessFactor),min(roughnessFactor,.43),wetDamp);
      roughnessFactor=mix(roughnessFactor,min(roughnessFactor,.19),wetSoak);
      roughnessFactor=mix(roughnessFactor,min(roughnessFactor,.12),wetPuddle);
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      float rainDetailFade=1.0-smoothstep(9.0,30.0,length(cameraPosition-vWetWorld));
      vec2 rainSlope=wetRipple(vWetWorld.xz,uWeatherTime,1.25,3.7);
      ${quality === 'high' ? 'rainSlope+=wetRipple(vWetWorld.xz,uWeatherTime*1.13,.82,17.1)*.65;' : ''}
      rainSlope*=.21*rainDetailFade*mix(.35,1.0,wetPuddle);
      vec3 waterNormal=normalize(mat3(viewMatrix)*vec3(-rainSlope.x,1.0,-rainSlope.y));
      normal=normalize(mix(normal,waterNormal,wetSoak*.28+wetPuddle*.65));
      float wetVariance=max(dot(dFdx(normal),dFdx(normal)),dot(dFdy(normal),dFdy(normal)));
      roughnessFactor=min(1.0,sqrt(roughnessFactor*roughnessFactor+min(.12,wetVariance*.35)));
    `);
  };
  mat.customProgramCacheKey = () => 'harbor-wet-deck-v6-' + quality;
  mat.needsUpdate = true;
}

function wetCargo(object, uniforms) {
  const material = object.material;
  const orm = material.map?.userData?.weatherORM;
  const explicitRust = orm?.userData?.pbrSource?.schema === 2;
  if (orm) { material.roughnessMap = material.metalnessMap = orm; material.roughness = material.metalness = 1; }
  const before = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer); attachWeatherUniforms(shader, uniforms);
    shader.vertexShader = 'varying vec3 vCargoWorld; varying vec3 vCargoNormal;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvCargoWorld=(modelMatrix*vec4(transformed,1.0)).xyz;vCargoNormal=normalize(mat3(modelMatrix)*objectNormal);');
    shader.fragmentShader = 'varying vec3 vCargoWorld; varying vec3 vCargoNormal;\n' + NOISE + ROOF_GLSL + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float cargoLuma=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));diffuseColor.rgb=mix(vec3(cargoLuma),diffuseColor.rgb,.82)*.94;
      float cargoUp=smoothstep(.1,.85,vCargoNormal.y);
      float cargoSide=smoothstep(-.35,-.03,vCargoNormal.y);
      float cargoRun=wetNoise(vec2((vCargoWorld.x+vCargoWorld.z)*8.0,vCargoWorld.y*.35))*wetNoise(vec2((vCargoWorld.x+vCargoWorld.z)*27.0,vCargoWorld.y*.75));
      float cargoOpen=weatherExposed(vCargoWorld+vCargoNormal*.3+vec3(0,.24,0));
      float cargoWet=cargoOpen*cargoSide*mix(.14+.75*smoothstep(.12,.38,cargoRun),.94,cargoUp);
      cargoWet=clamp(cargoWet,0.0,1.0)*uWetness;
      diffuseColor.rgb*=1.0-.17*cargoWet;
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      float cargoRust=${explicitRust ? 'texture2D(roughnessMap,vRoughnessMapUv).a' : 'smoothstep(.7,.86,roughnessFactor)'};
      roughnessFactor=mix(roughnessFactor,.19+cargoRust*.38,cargoWet*.9);
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      float cargoMicro=1.0-smoothstep(3.0,12.0,length(cameraPosition-vCargoWorld));
      float cargoGrain=wetNoise((vCargoWorld.xy+vCargoWorld.zy)*140.0)-.5;
      normal=normalize(normal+vec3(cargoGrain*.055,cargoGrain*.035,0)*cargoMicro*(1.0-cargoWet*.6));
      float cargoVariance=max(dot(dFdx(normal),dFdx(normal)),dot(dFdy(normal),dFdy(normal)));
      roughnessFactor=min(1.0,sqrt(roughnessFactor*roughnessFactor+min(.12,cargoVariance*.4)));
    `);
  };
  material.customProgramCacheKey = () => 'harbor-rain-cargo-v5-' + Number(explicitRust); material.needsUpdate = true;
}

function createPuddles(quality, roof, weatherUniforms) {
  const shader = {
    name: 'HarborPuddles',
    uniforms: { color: { value: new THREE.Color(0x253b46) }, tDiffuse: { value: null }, textureMatrix: { value: new THREE.Matrix4() }, uTime: { value: 0 }, uDeckRect: { value: new THREE.Vector4(0, 0, 36, 12) }, ...roof.uniforms, ...weatherUniforms },
    vertexShader: `uniform mat4 textureMatrix;varying vec4 vReflect;varying vec3 vWetWorld;void main(){vReflect=textureMatrix*vec4(position,1);vec4 world=modelMatrix*vec4(position,1);vWetWorld=world.xyz;gl_Position=projectionMatrix*viewMatrix*world;}`,
    fragmentShader: `uniform sampler2D tDiffuse;uniform vec3 color;uniform float uTime;uniform vec4 uDeckRect;varying vec4 vReflect;varying vec3 vWetWorld;${NOISE}${ROOF_GLSL}
    void main(){
      vec2 edgeDistance=uDeckRect.zw-abs(vWetWorld.xz-uDeckRect.xy);
      float area=smoothstep(.1,1.2,min(edgeDistance.x,edgeDistance.y));
      // A horizontal mirror only belongs to the actual uncovered deck, never
      // the ocean outside its polygon or the floor beneath a new cabin roof.
      float deckHeightMatch=1.0-smoothstep(.05,.2,abs(weatherRoof(vWetWorld.xz)-vWetWorld.y));
      float m=wetMask(vWetWorld.xz)*area*deckHeightMatch*uWetness*uWetness;
      if(m<.025)discard;
      vec2 uv=vReflect.xy/max(vReflect.w,.0001);
      float detailFade=1.0-smoothstep(10.0,34.0,length(cameraPosition-vWetWorld));
      vec2 slope=wetRipple(vWetWorld.xz,uTime,1.25,3.7);
      ${quality === 'high' ? 'slope+=wetRipple(vWetWorld.xz,uTime*1.13,.82,17.1)*.65;' : ''}
      vec2 wave=vec2(sin(vWetWorld.x*7.0+uTime*.7),cos(vWetWorld.z*8.0-uTime*.6))*.00018*uRainAmount+slope*.0022*detailFade;
      vec3 reflection=clamp(texture2D(tDiffuse,clamp(uv+wave,vec2(.001),vec2(.999))).rgb,0.0,20.0);
      vec3 V=normalize(cameraPosition-vWetWorld);
      float fresnel=.12+.68*pow(1.0-clamp(V.y,0.0,1.0),4.0);
      float ringGlint=length(slope)*detailFade*.07;
      gl_FragColor=vec4(mix(color,reflection,.96)+vec3(.8,.88,.9)*ringGlint,m*fresnel);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  };
  const mirror = new Reflector(new THREE.PlaneGeometry(72, 24), { clipBias: .006, textureWidth: quality === 'high' ? 768 : 384, textureHeight: quality === 'high' ? 384 : 192, shader, multisample: 0 });
  // Reflector clones uniforms, but the atlas must remain the one live texture.
  mirror.material.uniforms.uRoof = roof.uniforms.uRoof;
  mirror.material.uniforms.uRoofRect = roof.uniforms.uRoofRect;
  mirror.material.uniforms.uWetness = weatherUniforms.uWetness;
  mirror.material.uniforms.uRainAmount = weatherUniforms.uRainAmount;
  mirror.name = 'rain-puddles';mirror.rotation.x = -Math.PI / 2;mirror.position.y = .012;
  mirror.material.transparent = true;mirror.material.depthWrite = false;mirror.renderOrder = 2;
  const draw = mirror.onBeforeRender; let frame = 0;
  mirror.onBeforeRender = function (renderer, scene, camera) {
    if (camera.userData.harborReflection || camera.position.y < .05) return;
    if (quality === 'medium' && frame++ % 2) return;
    const auto = renderer.shadowMap.autoUpdate;renderer.shadowMap.autoUpdate = false;
    // Rain has no useful mirror detail and would double weather fill-rate.
    const atmosphere = scene.userData.harborEnvironment?.atmosphere;
    const weather = atmosphere?.precipitation?.group;
    const weatherVisible = weather?.visible;
    if (weather) weather.visible = false;
    try { draw.call(this, renderer, scene, camera); }
    finally { renderer.shadowMap.autoUpdate = auto;if (weather) weather.visible = weatherVisible; }
  };
  return mirror;
}

export class HarborAtmosphere {
  constructor(renderer, scene, quality) {
    this.renderer = renderer;this.scene = scene;this.roof = new RoofAtlas();this.quality=quality;
    this._weatherMaterials = new WeakSet();this._tonedWood = new WeakSet();
    this.wetness = 1;this.reflections = quality !== 'low';this.performanceReflections = true;
    this.timeUniform = { value: 0 };this.wetnessUniform={value:1};this.rainUniform={value:.96};
    this.uniforms = { ...this.roof.uniforms, uWeatherTime: this.timeUniform, uWetness:this.wetnessUniform,uRainAmount:this.rainUniform };
    this.exposure = 1;this.lensWetness = 0;this.frame = 0;
    this.registerScene(scene);
    this.puddles = quality !== 'low' ? createPuddles(quality, this.roof, this.uniforms) : null;
    if (this.puddles) scene.add(this.puddles);
    this.precipitation = new Precipitation(scene, quality, this.roof);this.rain = this.precipitation.rain;
  }
  registerScene(root) {
    let added=0;
    root?.traverse(object=>{
      const materials=Array.isArray(object.material)?object.material:[object.material];
      for(const material of materials){
        if(!material?.isMeshStandardMaterial)continue;
        const kind=object.userData?.weatherSurface||material.userData?.weatherSurface;
        if(!this._weatherMaterials.has(material)&&(kind==='deck'||object.name==='deck')){
          wetDeck({material},this.uniforms,this.quality);this._weatherMaterials.add(material);added++;
        }else if(!this._weatherMaterials.has(material)&&(kind==='metal'||/^c[0-9]+/.test(object.name))){
          wetCargo({material},this.uniforms);this._weatherMaterials.add(material);added++;
        }
        if(material.userData.pbrSource?.schema!==2&&/^(crate[0-9]+|wood)$/.test(object.name)&&!this._tonedWood.has(material)){
          material.color.multiply(new THREE.Color().setRGB(.72,.77,.79));material.roughness=Math.min(material.roughness,.72);
          this._tonedWood.add(material);
        }
      }
    });return added;
  }
  setWorld(world) {
    this.roof.build(world);
    const deck = world.colliders.find(c => c.tag === 'deck');
    if (deck && this.puddles) {
      this.puddles.scale.set(deck.hx * 2 / 72, deck.hz * 2 / 24, 1);
      this.puddles.position.set(deck.x, deck.top + .012, deck.z);
      this.puddles.material.uniforms.uDeckRect.value.set(deck.x, deck.z, deck.hx, deck.hz);
    }
  }
  setRain(level, immediate=false) {
    this.precipitation.setRain(level,immediate);this.rainUniform.value=this.rainLevel;
    if(immediate)this.lensWetness=this.exposure*this.rainLevel*.72;
  }
  setWetness(level) {
    if(Number.isFinite(level))this.wetnessUniform.value=this.wetness=Math.max(0,Math.min(1,level));
    this.updateReflectionVisibility();return this.wetness;
  }
  setWeather(patch={}) {
    if(!patch||typeof patch!=='object')return this.getWeather();
    if(Number.isFinite(patch.rain))this.setRain(patch.rain,patch.immediate===true);
    if(Number.isFinite(patch.wetness))this.setWetness(patch.wetness);
    if(typeof patch.reflections==='boolean')this.reflections=patch.reflections&&!!this.puddles;
    this.updateReflectionVisibility();return this.getWeather();
  }
  getWeather() { return {rain:this.rainLevel,wetness:this.wetness,reflections:this.reflections}; }
  setPerformanceReflections(value) {this.performanceReflections=!!value;this.updateReflectionVisibility();}
  updateReflectionVisibility() {if(this.puddles)this.puddles.visible=this.reflections&&this.performanceReflections&&this.wetness>.001;}
  get rainLevel() { return this.precipitation.level; }
  exposureAt(pos) { return this.roof.exposureAt(pos); }
  wetnessAt(pos) { return (this.exposureAt(pos) ? .92 : .16)*this.wetness; }
  update(dt, time, camera) {
    this.frame++;this.timeUniform.value = time;
    this.exposure = this.exposureAt(camera);
    const target = this.exposure * this.rainLevel * .72;
    this.lensWetness += (target - this.lensWetness) * (1 - Math.exp(-dt * (target > this.lensWetness ? .15 : .08)));
    if (this.puddles) this.puddles.material.uniforms.uTime.value = time;
    this.precipitation.update(dt, time, camera, this.scene.userData.harborEnvironment, this.renderer);
    this.rainUniform.value=this.rainLevel;
  }
}
