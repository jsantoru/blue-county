import * as T from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";

/** Depth-based contact shading reuses the beauty depth, including alpha-tested leaves. */
export class Presentation {
  private target: T.WebGLRenderTarget;
  private material: T.ShaderMaterial;
  private quad: FullScreenQuad;
  private bloomTargets: [T.WebGLRenderTarget, T.WebGLRenderTarget];
  private bloomExtract: T.ShaderMaterial;
  private bloomBlur: T.ShaderMaterial;
  private bloomQuad: FullScreenQuad;
  private contactTarget: T.WebGLRenderTarget;
  private contactMaterial: T.ShaderMaterial;
  private contactQuad: FullScreenQuad;
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
    const bloomWidth = Math.max(1, Math.ceil(innerWidth / 4)),
      bloomHeight = Math.max(1, Math.ceil(innerHeight / 4));
    this.bloomTargets = [0, 1].map(
      () =>
        new T.WebGLRenderTarget(bloomWidth, bloomHeight, {
          type: T.HalfFloatType,
          depthBuffer: false,
        }),
    ) as [T.WebGLRenderTarget, T.WebGLRenderTarget];
    const fullscreenVertex = `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
    this.contactTarget = new T.WebGLRenderTarget(
      Math.ceil(innerWidth / 2),
      Math.ceil(innerHeight / 2),
      {
        type: T.HalfFloatType,
        depthBuffer: false,
      },
    );
    this.contactMaterial = new T.ShaderMaterial({
      uniforms: {
        depth: { value: this.target.depthTexture },
        inverseProjection: { value: camera.projectionMatrixInverse },
        resolution: { value: new T.Vector2(innerWidth / 2, innerHeight / 2) },
      },
      vertexShader: fullscreenVertex,
      fragmentShader: `varying vec2 vUv; uniform sampler2D depth;
        uniform mat4 inverseProjection; uniform vec2 resolution;
        vec3 positionAt(vec2 uv){float z=textureLod(depth,uv,0.).x;vec4 p=inverseProjection*vec4(uv*2.-1.,z*2.-1.,1.);return p.xyz/p.w;}
        void main(){
          vec3 p=positionAt(vUv);
          vec3 normal=normalize(cross(dFdx(p),dFdy(p)));
          if(textureLod(depth,vUv,0.).x>=.99998){gl_FragColor=vec4(1.,2200.,0.,1.);return;}
          float radius=1.15;
          float pixelRadius=clamp(radius*resolution.y*.5/(inverseProjection[1][1]*max(-p.z,1.)),1.,36.);
          // Scrambled interleaved gradient noise avoids the old directional streaks.
          float angle=fract(52.9829189*fract(dot(floor(vUv*resolution),vec2(.06711056,.00583715))))*6.2831853;
          float occlusion=0.;
          for(int i=0;i<16;i++){
            float phase=angle+float(i)*2.3999632;
            vec2 offset=vec2(cos(phase),sin(phase))*sqrt((float(i)+.5)/16.)*pixelRadius/resolution;
            vec3 delta=positionAt(clamp(vUv+offset,vec2(.001),vec2(.999)))-p;
            float distance=length(delta);
            float facing=max(dot(normal,delta)/max(distance,.001)-.14,0.);
            occlusion+=facing*(1.-smoothstep(0.,radius,distance))*smoothstep(.02,.09,distance);
          }
          gl_FragColor=vec4(1.-clamp(occlusion/16.*2.7,0.,.48),-p.z,0.,1.);
        }`,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.contactQuad = new FullScreenQuad(this.contactMaterial);
    this.bloomExtract = new T.ShaderMaterial({
      uniforms: { source: { value: this.target.texture } },
      vertexShader: fullscreenVertex,
      fragmentShader: `varying vec2 vUv; uniform sampler2D source;
        void main(){vec3 c=texture2D(source,vUv).rgb;
          float peak=max(c.r,max(c.g,c.b));
          float knee=clamp(peak-1.0,0.,.8); knee=knee*knee/(3.2+.0001);
          float amount=max(peak-1.8,knee)/max(peak,.0001);
          gl_FragColor=vec4(min(c*amount,vec3(5.)),1.);}`,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.bloomBlur = new T.ShaderMaterial({
      uniforms: {
        source: { value: this.bloomTargets[0].texture },
        direction: { value: new T.Vector2(1 / bloomWidth, 0) },
      },
      vertexShader: fullscreenVertex,
      fragmentShader: `varying vec2 vUv; uniform sampler2D source; uniform vec2 direction;
        void main(){vec3 c=texture2D(source,vUv).rgb*.227027;
          c+=(texture2D(source,vUv+direction*1.384615).rgb+texture2D(source,vUv-direction*1.384615).rgb)*.316216;
          c+=(texture2D(source,vUv+direction*3.230769).rgb+texture2D(source,vUv-direction*3.230769).rgb)*.070270;
          gl_FragColor=vec4(c,1.);}`,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.bloomQuad = new FullScreenQuad(this.bloomExtract);
    this.material = new T.ShaderMaterial({
      uniforms: {
        beauty: { value: this.target.texture },
        depth: { value: this.target.depthTexture },
        bloom: { value: this.bloomTargets[0].texture },
        contact: { value: this.contactTarget.texture },
        inverseProjection: { value: camera.projectionMatrixInverse },
        resolution: { value: new T.Vector2(innerWidth, innerHeight) },
      },
      vertexShader: fullscreenVertex,
      fragmentShader: `
        varying vec2 vUv; uniform sampler2D beauty; uniform sampler2D depth; uniform sampler2D bloom; uniform sampler2D contact;
        uniform mat4 inverseProjection; uniform vec2 resolution;
        vec3 positionAt(vec2 uv){float z=textureLod(depth,uv,0.).x;vec4 p=inverseProjection*vec4(uv*2.-1.,z*2.-1.,1.);return p.xyz/p.w;}
        void main(){
          vec3 color=texture2D(beauty,vUv).rgb;
          float z=texture2D(depth,vUv).x;
          if(z<.99998){
            vec3 p=positionAt(vUv);
            float total=0.,weightSum=0.;
            for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
              vec2 sampleUV=clamp(vUv+vec2(float(x),float(y))*2./resolution,vec2(.001),vec2(.999));
              vec2 sampleAO=textureLod(contact,sampleUV,0.).rg;
              float weight=exp(-float(x*x+y*y)*.55)*exp(-abs(sampleAO.y+p.z)/max(.045,-p.z*.006));
              total+=sampleAO.x*weight;weightSum+=weight;
            }
            color*=weightSum>.0001?total/weightSum:1.;
          }
          // Only HDR highlights scatter; ordinary white trim and road surfaces
          // retain contrast. Blur runs at quarter resolution, without depth of field.
          color+=texture2D(bloom,vUv).rgb*.085;
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
    this.contactTarget.setSize(Math.ceil(width / 2), Math.ceil(height / 2));
    this.contactMaterial.uniforms.resolution.value.set(
      Math.ceil(width / 2),
      Math.ceil(height / 2),
    );
    for (const target of this.bloomTargets)
      target.setSize(
        Math.max(1, Math.ceil(width / 4)),
        Math.max(1, Math.ceil(height / 4)),
      );
  }
  render(scene: T.Scene) {
    this.renderer.info.reset();
    this.renderer.info.autoReset = false;
    if (this.enabled) {
      this.renderer.setRenderTarget(this.target);
      this.renderer.render(scene, this.camera);
      this.renderer.setRenderTarget(this.contactTarget);
      this.contactQuad.render(this.renderer);
      this.renderer.setRenderTarget(this.bloomTargets[0]);
      this.bloomQuad.material = this.bloomExtract;
      this.bloomQuad.render(this.renderer);
      this.bloomQuad.material = this.bloomBlur;
      this.bloomBlur.uniforms.source.value = this.bloomTargets[0].texture;
      this.bloomBlur.uniforms.direction.value.set(
        1 / this.bloomTargets[0].width,
        0,
      );
      this.renderer.setRenderTarget(this.bloomTargets[1]);
      this.bloomQuad.render(this.renderer);
      this.bloomBlur.uniforms.source.value = this.bloomTargets[1].texture;
      this.bloomBlur.uniforms.direction.value.set(
        0,
        1 / this.bloomTargets[0].height,
      );
      this.renderer.setRenderTarget(this.bloomTargets[0]);
      this.bloomQuad.render(this.renderer);
      this.renderer.setRenderTarget(null);
      this.quad.render(this.renderer);
    } else this.renderer.render(scene, this.camera);
  }
  dispose() {
    this.target.dispose();
    this.contactTarget.dispose();
    this.contactMaterial.dispose();
    this.contactQuad.dispose();
    for (const target of this.bloomTargets) target.dispose();
    for (const material of [this.material, this.bloomExtract, this.bloomBlur])
      material.dispose();
    this.quad.dispose();
    this.bloomQuad.dispose();
  }
}
