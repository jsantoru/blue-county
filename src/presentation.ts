import * as T from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";

/** Depth-based contact shading reuses the beauty depth, including alpha-tested leaves. */
export class Presentation {
  private target: T.WebGLRenderTarget;
  private material: T.ShaderMaterial;
  private quad: FullScreenQuad;
  private enabled = true;
  constructor(
    private renderer: T.WebGLRenderer,
    private camera: T.PerspectiveCamera,
  ) {
    this.target = new T.WebGLRenderTarget(innerWidth, innerHeight, {
      type: T.HalfFloatType,
      samples: Math.min(4, renderer.capabilities.maxSamples),
      depthTexture: new T.DepthTexture(
        innerWidth,
        innerHeight,
        T.UnsignedIntType,
      ),
    });
    this.material = new T.ShaderMaterial({
      uniforms: {
        beauty: { value: this.target.texture },
        depth: { value: this.target.depthTexture },
        inverseProjection: { value: camera.projectionMatrixInverse },
        resolution: { value: new T.Vector2(innerWidth, innerHeight) },
      },
      vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `
        varying vec2 vUv; uniform sampler2D beauty; uniform sampler2D depth;
        uniform mat4 inverseProjection; uniform vec2 resolution;
        vec3 positionAt(vec2 uv){float z=texture2D(depth,uv).x;vec4 p=inverseProjection*vec4(uv*2.-1.,z*2.-1.,1.);return p.xyz/p.w;}
        void main(){
          vec3 color=texture2D(beauty,vUv).rgb;
          float z=texture2D(depth,vUv).x;
          if(z<.99998){
            vec3 p=positionAt(vUv);
            vec3 normal=normalize(cross(dFdx(p),dFdy(p)));
            float radius=1.45;
            float pixelRadius=clamp(radius*resolution.y/max(-p.z,1.),2.,65.);
            float angle=fract(dot(floor(vUv*resolution),vec2(.06711056,.00583715)))*6.2831853;
            float occlusion=0.;
            for(int i=0;i<12;i++){
              float phase=angle+float(i)*2.3999632;
              vec2 offset=vec2(cos(phase),sin(phase))*sqrt((float(i)+.5)/12.)*pixelRadius/resolution;
              vec3 delta=positionAt(clamp(vUv+offset,vec2(.001),vec2(.999)))-p;
              float distance=length(delta);
              float facing=max(dot(normal,delta)/max(distance,.001)-.16,0.);
              occlusion+=facing*(1.-smoothstep(0.,radius,distance))*smoothstep(.02,.10,distance);
            }
            color*=1.-clamp(occlusion/12.*1.8,0.,.44);
          }
          // Very restrained peripheral falloff; it leaves signs and the HUD fully legible.
          vec2 edge=vUv*2.-1.; color*=1.-.07*pow(clamp(dot(edge,edge)*.5,0.,1.),1.5);
          gl_FragColor=vec4(color,1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }
  setQuality(quality: "low" | "medium" | "high") {
    this.enabled = quality === "high";
  }
  resize(width: number, height: number) {
    this.target.setSize(width, height);
    this.material.uniforms.resolution.value.set(width, height);
  }
  render(scene: T.Scene) {
    this.renderer.info.reset();
    this.renderer.info.autoReset = false;
    if (this.enabled) {
      this.renderer.setRenderTarget(this.target);
      this.renderer.render(scene, this.camera);
      this.renderer.setRenderTarget(null);
      this.quad.render(this.renderer);
    } else this.renderer.render(scene, this.camera);
  }
}
