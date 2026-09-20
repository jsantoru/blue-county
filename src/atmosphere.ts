import * as T from "three";
import { Sky } from "three/addons/objects/Sky.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";

/** Afternoon light and a distant cloud layer, with no online resources at runtime. */
export class Atmosphere {
  readonly sunDirection = new T.Vector3(-0.75, 0.66, -0.55).normalize();
  private sky = new Sky();
  private clouds: T.Mesh;
  private reflectionTarget: T.WebGLRenderTarget;
  private time = { value: 0 };
  constructor(scene: T.Scene, renderer: T.WebGLRenderer) {
    this.sky.scale.setScalar(2400);
    const uniforms = this.sky.material.uniforms;
    uniforms.turbidity.value = 2.3;
    uniforms.rayleigh.value = 2.25;
    uniforms.mieCoefficient.value = 0.004;
    uniforms.mieDirectionalG.value = 0.82;
    uniforms.sunPosition.value.copy(this.sunDirection);
    this.sky.renderOrder = -3;
    scene.add(this.sky);
    const cloudMaterial = new T.ShaderMaterial({
      uniforms: { time: this.time, sunDirection: { value: this.sunDirection } },
      vertexShader: `varying vec3 vDirection;
        void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `varying vec3 vDirection; uniform float time; uniform vec3 sunDirection;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
          return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.)),f.x),f.y);}
        float fbm(vec2 p){float v=0.,a=.52;for(int i=0;i<4;i++){v+=a*noise(p);p=mat2(1.6,-1.2,1.2,1.6)*p;a*=.5;}return v;}
        void main(){vec3 d=normalize(vDirection);if(d.y<.02)discard;
          vec2 p=d.xz/(d.y+.16)*1.9+vec2(time*.0025,time*.0006);
          float n=fbm(p), wisps=fbm(p*3.1+4.);
          float density=n*.84+wisps*.16;
          float alpha=smoothstep(.48,.65,density)*smoothstep(.02,.20,d.y)*.94;
          float towardSun=fbm(p+normalize(sunDirection.xz)*.18);
          float light=clamp(.58+(n-towardSun)*4.5,0.,1.);
          vec3 color=mix(vec3(.58,.68,.78),vec3(1.48,1.44,1.34),light);
          float silver=pow(max(dot(d,sunDirection),0.),14.)*(1.-smoothstep(.53,.66,density));
          color+=vec3(.8,.7,.5)*silver;
          gl_FragColor=vec4(color,alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      side: T.BackSide,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
    this.clouds = new T.Mesh(new T.SphereGeometry(1100, 32, 16), cloudMaterial);
    this.clouds.renderOrder = -2;
    scene.add(this.clouds);
    // The procedural sky is also a valid fallback while the HDR asset loads.
    const pmrem = new T.PMREMGenerator(renderer);
    const skyScene = new T.Scene();
    skyScene.add(this.sky.clone());
    this.reflectionTarget = pmrem.fromScene(skyScene, 0.03);
    scene.environment = this.reflectionTarget.texture;
    pmrem.dispose();
  }
  async loadReflections(
    scene: T.Scene,
    renderer: T.WebGLRenderer,
    path: string,
  ) {
    const hdr = await new HDRLoader().loadAsync(path);
    hdr.mapping = T.EquirectangularReflectionMapping;
    const pmrem = new T.PMREMGenerator(renderer);
    const old = this.reflectionTarget;
    this.reflectionTarget = pmrem.fromEquirectangular(hdr);
    scene.environment = this.reflectionTarget.texture;
    scene.environmentIntensity = 0.48;
    // Rotate the outdoor reflection so its main light roughly agrees with the directional sun.
    scene.environmentRotation.y = 0.6;
    old.dispose();
    hdr.dispose();
    pmrem.dispose();
  }
  update(time: number, camera: T.Camera) {
    this.time.value = time;
    this.sky.position.copy(camera.position);
    this.clouds.position.copy(camera.position);
  }
}
