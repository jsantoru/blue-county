import * as T from "three";
import type { Vehicle } from "./vehicle";
import { vehicleGeometry, WHEELS } from "./vehicle";

interface Particle {
  p: T.Vector3;
  v: T.Vector3;
  life: number;
  duration: number;
  size: number;
}
const SMOKE_COUNT = 40;

/** Fixed pools: 600 skid segments, 80 impact sparks and 40 soft tire-smoke billboards. */
export class Effects {
  root = new T.Group();
  marks: T.InstancedMesh;
  sparks: T.InstancedMesh;
  smoke: T.InstancedMesh;
  cursor = 0;
  particles: Particle[] = [];
  private smokeParticles: Particle[] = [];
  private smokeCursor = 0;
  dummy = new T.Object3D();
  lastMark = 0;
  private lastSmoke = 0;
  private smokeAlpha = new T.InstancedBufferAttribute(
    new Float32Array(SMOKE_COUNT),
    1,
  );
  private lastVehicle: Vehicle | null = null;

  constructor() {
    this.marks = new T.InstancedMesh(
      new T.PlaneGeometry(0.28, 1),
      new T.MeshBasicMaterial({
        color: 0x20262b,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      }),
      600,
    );
    this.marks.instanceMatrix.setUsage(T.DynamicDrawUsage);
    this.sparks = new T.InstancedMesh(
      new T.IcosahedronGeometry(0.13, 0),
      new T.MeshBasicMaterial({ color: 0xffc784 }),
      80,
    );
    this.sparks.instanceMatrix.setUsage(T.DynamicDrawUsage);
    const smokeGeometry = new T.PlaneGeometry(1, 1);
    smokeGeometry.setAttribute("smokeAlpha", this.smokeAlpha);
    this.smokeAlpha.setUsage(T.DynamicDrawUsage);
    // Original procedural radial alpha: no downloaded texture or per-puff material.
    const smokeMaterial = new T.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: T.DoubleSide,
      vertexShader: `
        attribute float smokeAlpha;
        varying vec2 puffUv;
        varying float puffAlpha;
        void main(){
          puffUv=uv; puffAlpha=smokeAlpha;
          vec4 center=modelViewMatrix*instanceMatrix*vec4(0.0,0.0,0.0,1.0);
          vec2 scale=vec2(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz));
          center.xy+=position.xy*scale;
          gl_Position=projectionMatrix*center;
        }`,
      fragmentShader: `
        varying vec2 puffUv;
        varying float puffAlpha;
        void main(){
          float radius=length((puffUv-0.5)*2.0);
          float edge=1.0-smoothstep(0.15,1.0,radius);
          float alpha=edge*edge*puffAlpha;
          if(alpha<0.002)discard;
          gl_FragColor=vec4(0.62,0.65,0.66,alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.smoke = new T.InstancedMesh(smokeGeometry, smokeMaterial, SMOKE_COUNT);
    this.smoke.instanceMatrix.setUsage(T.DynamicDrawUsage);
    const particle = (): Particle => ({
      p: new T.Vector3(),
      v: new T.Vector3(),
      life: 0,
      duration: 1,
      size: 1,
    });
    for (let i = 0; i < 80; i++) this.particles.push(particle());
    for (let i = 0; i < SMOKE_COUNT; i++) this.smokeParticles.push(particle());
    this.root.add(this.marks, this.sparks, this.smoke);
    this.marks.frustumCulled = false;
    this.sparks.frustumCulled = false;
    this.smoke.frustumCulled = false;
    this.clear();
  }

  clear() {
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    for (let i = 0; i < 600; i++) this.marks.setMatrixAt(i, this.dummy.matrix);
    for (let i = 0; i < 80; i++) {
      this.particles[i].life = 0;
      this.sparks.setMatrixAt(i, this.dummy.matrix);
    }
    for (let i = 0; i < SMOKE_COUNT; i++) {
      this.smokeParticles[i].life = 0;
      this.smoke.setMatrixAt(i, this.dummy.matrix);
      this.smokeAlpha.setX(i, 0);
    }
    this.marks.instanceMatrix.needsUpdate = true;
    this.sparks.instanceMatrix.needsUpdate = true;
    this.smoke.instanceMatrix.needsUpdate = true;
    this.smokeAlpha.needsUpdate = true;
    this.lastMark = 0;
    this.lastSmoke = 0;
    this.cursor = 0;
  }

  impact(p: T.Vector3, strength: number) {
    for (let i = 0, n = 0; i < 80 && n < 20; i++) {
      const s = this.particles[i];
      if (s.life > 0) continue;
      s.p.copy(p);
      s.v.set(
        Math.sin(i * 5.7) * strength * 0.5,
        2 + (i % 4),
        Math.cos(i * 5.7) * strength * 0.5,
      );
      s.life = 0.5;
      n++;
    }
  }

  /** The wheel-height convention encodes the actual ray contact, not the moving chassis floor. */
  private tireContact(vehicle: Vehicle, index: number, out: T.Vector3) {
    out
      .set(...WHEELS[index])
      .applyQuaternion(vehicle.rotation)
      .add(vehicle.position);
    out.y =
      vehicle.position.y +
      vehicle.wheelHeights[index] -
      vehicleGeometry.wheelRadius +
      vehicleGeometry.visualOffsetY +
      0.025;
    return out;
  }

  update(v: Vehicle, dt: number, time: number) {
    if (this.lastVehicle !== v) {
      this.clear();
      this.lastVehicle = v;
    }
    const slipping = v.grounded > 1 && Math.abs(v.slip) > 0.13 && v.speed > 8;
    if (slipping && time - this.lastMark > 0.045) {
      this.lastMark = time;
      for (let wheel = 2; wheel < 4; wheel++) {
        if (v.wheelHeights[wheel] <= 0.13) continue;
        this.tireContact(v, wheel, this.dummy.position);
        const heading = Math.atan2(
          2 * (v.rotation.w * v.rotation.y + v.rotation.x * v.rotation.z),
          1 - 2 * (v.rotation.y * v.rotation.y + v.rotation.x * v.rotation.x),
        );
        this.dummy.rotation.set(-Math.PI / 2, 0, -heading);
        this.dummy.scale.set(1, Math.max(0.5, v.speed * 0.045), 1);
        this.dummy.updateMatrix();
        this.marks.setMatrixAt(this.cursor++ % 600, this.dummy.matrix);
      }
      this.marks.instanceMatrix.needsUpdate = true;
    }
    if (slipping && v.speed > 11 && time - this.lastSmoke > 0.095) {
      this.lastSmoke = time;
      for (let wheel = 2; wheel < 4; wheel++) {
        if (v.wheelHeights[wheel] <= 0.13) continue;
        const p = this.smokeParticles[this.smokeCursor++ % SMOKE_COUNT];
        this.tireContact(v, wheel, p.p);
        p.p.y += 0.15;
        p.v.set(
          Math.sin(time * 5 + wheel) * 0.22,
          0.55,
          Math.cos(time * 4 + wheel) * 0.22,
        );
        p.duration = 0.72 + Math.min(0.25, Math.abs(v.slip) * 0.4);
        p.life = p.duration;
        p.size = 0.35 + Math.min(0.35, Math.abs(v.slip));
      }
    }
    this.dummy.rotation.set(0, 0, 0);
    for (let i = 0; i < 80; i++) {
      const s = this.particles[i];
      s.life -= dt;
      if (s.life > 0) {
        s.v.y -= 9.81 * dt;
        s.p.addScaledVector(s.v, dt);
        this.dummy.position.copy(s.p);
        this.dummy.scale.setScalar(s.life * 2);
      } else this.dummy.scale.setScalar(0);
      this.dummy.updateMatrix();
      this.sparks.setMatrixAt(i, this.dummy.matrix);
    }
    for (let i = 0; i < SMOKE_COUNT; i++) {
      const s = this.smokeParticles[i];
      s.life = Math.max(0, s.life - dt);
      if (s.life > 0) {
        const age = 1 - s.life / s.duration;
        s.p.addScaledVector(s.v, dt);
        this.dummy.position.copy(s.p);
        this.dummy.scale.setScalar(s.size + age * 1.25);
        this.smokeAlpha.setX(
          i,
          0.2 * Math.min(1, age * 8) * (1 - age) * (1 - age),
        );
      } else {
        this.dummy.scale.setScalar(0);
        this.smokeAlpha.setX(i, 0);
      }
      this.dummy.updateMatrix();
      this.smoke.setMatrixAt(i, this.dummy.matrix);
    }
    this.sparks.instanceMatrix.needsUpdate = true;
    this.smoke.instanceMatrix.needsUpdate = true;
    this.smokeAlpha.needsUpdate = true;
  }
}
