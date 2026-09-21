import * as T from "three";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import type { CharacterAnimation } from "./character-visual";

export type DadAnimation = CharacterAnimation & {
  /** Blend the standing body down into the authored driving pose during transfer. */
  seatedBlend?: number;
};

/** The Blender asset owns appearance/animation; gameplay still owns movement. */
export class DadCharacterVisual {
  readonly root = new T.Group();
  private readonly model: T.Object3D;
  private readonly mixer: T.AnimationMixer;
  private readonly actions = new Map<string, T.AnimationAction>();
  private readonly weights = new Map<string, number>();
  private readonly soles: T.SkinnedMesh[] = [];
  private readonly point = new T.Vector3();
  private readonly inverseRoot = new T.Matrix4();
  private disposed = false;
  private firstPose = true;

  constructor(source: Pick<GLTF, "scene" | "animations">) {
    this.root.name = "Dad · Blender character with coppola";
    this.root.userData.character = {
      source: "/assets/dad-driver.glb",
      authoring: "Blender",
      likeness: "Photo-referenced stylized character",
      units: "meters",
      origin: "feet",
      forward: "+Z",
      up: "+Y",
    };
    this.model = clone(source.scene);
    this.root.add(this.model);
    this.model.traverse((object) => {
      if (object instanceof T.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
        // A skinned model's rest-pose bounds do not include every seated limb.
        object.frustumCulled = false;
        if (
          object instanceof T.SkinnedMesh &&
          object.name.includes("Rubber soles")
        )
          this.soles.push(object);
      }
    });
    this.mixer = new T.AnimationMixer(this.model);
    for (const name of ["idle", "walk", "run", "seated", "airborne"]) {
      const alternatives = name === "airborne" ? ["airborne", "jump"] : [name];
      const clip = source.animations.find((clip) =>
        alternatives.some((key) => clip.name.toLowerCase() === key),
      );
      if (!clip) {
        if (name === "airborne") continue;
        throw new Error(`Dad character is missing the ${name} animation`);
      }
      const action = this.mixer.clipAction(clip);
      action.play().setEffectiveWeight(0);
      this.actions.set(name, action);
      this.weights.set(name, 0);
    }
    this.update({ pose: "idle", speed: 0, time: 0, dt: 0 });
    this.firstPose = true;
  }

  update(animation: DadAnimation) {
    if (this.disposed) return;
    const dt = T.MathUtils.clamp(animation.dt ?? 1 / 60, 0, 0.1);
    const pose = this.actions.has(animation.pose) ? animation.pose : "idle";
    const seated =
      animation.seatedBlend === undefined
        ? pose === "seated"
          ? 1
          : 0
        : T.MathUtils.clamp(animation.seatedBlend, 0, 1);
    const blend =
      this.firstPose || animation.seatedBlend !== undefined
        ? 1
        : 1 - Math.exp(-dt * 16);
    for (const [name, action] of this.actions) {
      const target =
        name === "seated"
          ? seated
          : name === (pose === "seated" ? "idle" : pose)
            ? 1 - seated
            : 0;
      const weight = T.MathUtils.lerp(
        this.weights.get(name) ?? 0,
        target,
        blend,
      );
      this.weights.set(name, weight);
      action.setEffectiveWeight(weight);
      if (name === "walk")
        action.setEffectiveTimeScale(Math.max(0.15, animation.speed / 2.5));
      if (name === "run")
        action.setEffectiveTimeScale(Math.max(0.15, animation.speed / 5.7));
    }
    this.mixer.update(dt);
    this.model.position.y = 0;
    this.root.updateMatrixWorld(true);
    if (seated > 0.995) this.gripWheel(animation.steering ?? 0);
    if (pose !== "airborne" && seated < 0.001) this.plantSupportingFoot();
    this.root.userData.character.pose = animation.pose;
    this.root.userData.character.seatedBlend = seated;
    this.firstPose = false;
  }

  private plantSupportingFoot() {
    this.inverseRoot.copy(this.root.matrixWorld).invert();
    let lowest = Infinity;
    for (const mesh of this.soles) {
      const count = mesh.geometry.getAttribute("position").count;
      for (let i = 0; i < count; i++) {
        mesh
          .getVertexPosition(i, this.point)
          .applyMatrix4(mesh.matrixWorld)
          .applyMatrix4(this.inverseRoot);
        lowest = Math.min(lowest, this.point.y);
      }
    }
    if (Number.isFinite(lowest) && Math.abs(lowest) < 0.3) {
      this.model.position.y = -lowest;
      this.root.updateMatrixWorld(true);
    }
  }

  private aim(bone: T.Object3D, child: T.Object3D, target: T.Vector3) {
    this.root.updateMatrixWorld(true);
    const origin = bone.getWorldPosition(new T.Vector3());
    const from = child
      .getWorldPosition(new T.Vector3())
      .sub(origin)
      .normalize();
    const to = target.clone().sub(origin).normalize();
    const rotation = new T.Quaternion()
      .setFromUnitVectors(from, to)
      .multiply(bone.getWorldQuaternion(new T.Quaternion()));
    bone.quaternion
      .copy(bone.parent!.getWorldQuaternion(new T.Quaternion()).invert())
      .multiply(rotation);
    this.root.updateMatrixWorld(true);
  }

  /** Solve the two arms in world space, independent of Blender bone roll. */
  private gripWheel(steering: number) {
    const angle = T.MathUtils.clamp(steering, -0.55, 0.55) * 1.7;
    for (const [label, side] of [
      ["left", 1],
      ["right", -1],
    ] as const) {
      const upper = this.root.getObjectByName(`${label}_arm`);
      const lower = this.root.getObjectByName(`${label}_forearm`);
      const hand = this.root.getObjectByName(`${label}_hand`);
      if (!upper || !lower || !hand) continue;
      const shoulder = upper.getWorldPosition(new T.Vector3());
      const elbow = lower.getWorldPosition(new T.Vector3());
      const wrist = hand.getWorldPosition(new T.Vector3());
      const a = shoulder.distanceTo(elbow),
        b = elbow.distanceTo(wrist);
      const target = this.root.localToWorld(
        new T.Vector3(
          side * 0.145 * Math.cos(angle),
          0.938 + side * 0.145 * Math.sin(angle),
          0.357,
        ),
      );
      const direction = target.clone().sub(shoulder);
      const length = T.MathUtils.clamp(direction.length(), 0.03, a + b - 0.003);
      direction.normalize();
      const along = (a * a - b * b + length * length) / (2 * length);
      const bend = new T.Vector3(side * 0.35, -1, -0.1).transformDirection(
        this.root.matrixWorld,
      );
      bend.addScaledVector(direction, -bend.dot(direction)).normalize();
      const desiredElbow = shoulder
        .clone()
        .addScaledVector(direction, along)
        .addScaledVector(bend, Math.sqrt(Math.max(0, a * a - along * along)));
      this.aim(upper, lower, desiredElbow);
      this.aim(lower, hand, target);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    const skeletons = new Set<T.Skeleton>();
    this.model.traverse((object) => {
      if (object instanceof T.SkinnedMesh) skeletons.add(object.skeleton);
    });
    skeletons.forEach((skeleton) => skeleton.dispose());
    // Geometry, materials and image textures belong to the loaded template.
    this.root.removeFromParent();
    this.root.clear();
  }
}
