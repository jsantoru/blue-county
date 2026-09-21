import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

export type CharacterPose = "seated" | "idle" | "walk" | "run" | "airborne";
export interface CharacterAnimation {
  pose: CharacterPose;
  /** Horizontal travel speed in meters per second. */
  speed: number;
  time: number;
  dt?: number;
  verticalSpeed?: number;
  steering?: number;
}

export const CHARACTER_DIMENSIONS = {
  height: 1.78,
  shoulderWidth: 0.5,
  standingHipHeight: 0.94,
};

/**
 * Coordinates in the imported Oldsmobile visual, before its chassis Y offset.
 * The asset uses +X for the US driver's side and +Z forward. Its bucket cushion
 * is centered at [.39, .555, -.20], top .647; wheel center [.398, 1.038, .064].
 * This is a feet-origin visual anchor, not the position of the character's hips.
 */
export const CHARACTER_SEAT_ANCHOR = [0.398, 0.1, -0.315] as const;

type Point = [number, number, number];
type Piece = {
  geometry: T.BufferGeometry;
  color: number;
  at?: Point;
  scale?: Point;
};
type Limb = { upper: T.Group; lower: T.Group; end: T.Group };
const DOWN = new T.Vector3(0, -1, 0);
const colors = {
  jacket: 0x384e59,
  seams: 0x2b3942,
  shirt: 0xc7b79a,
  jeans: 0x28364a,
  denimLight: 0x334458,
  leather: 0x372e29,
  sole: 0x1b1c1b,
  skin: 0xb98560,
  hair: 0x312923,
  eyes: 0x262c2d,
};

/**
 * Replaceable presentation only: meters, feet at origin, +Y up, +Z forward.
 * Gameplay owns root position/yaw and never depends on these internal joints.
 * A future Blender visual only needs root, update(animation), and dispose().
 * Each moving body segment is one vertex-colored mesh sharing one material.
 */
export class CharacterVisual {
  readonly root = new T.Group();
  private readonly hips = new T.Group();
  private readonly torso = new T.Group();
  private readonly head = new T.Group();
  private readonly arms: Limb[] = [];
  private readonly legs: Limb[] = [];
  private readonly material = new T.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.87,
    metalness: 0,
  });
  private readonly geometries = new Set<T.BufferGeometry>();
  private phase = 0;
  private disposed = false;
  private lastPose: CharacterPose = "idle";

  constructor() {
    this.root.name = "Replaceable driver character";
    this.root.userData.character = {
      units: "meters",
      origin: "feet",
      forward: "+Z",
      up: "+Y",
      height: CHARACTER_DIMENSIONS.height,
      seatAnchor: [...CHARACTER_SEAT_ANCHOR],
    };
    this.hips.name = "hips";
    this.root.add(this.hips);
    this.hips.add(
      this.mesh("pelvis", [
        this.box([0.31, 0.2, 0.22], colors.jeans, [0, 0.01, 0]),
        this.box([0.323, 0.036, 0.23], colors.leather, [0, 0.1, 0]),
        this.box([0.035, 0.026, 0.012], 0x777970, [0, 0.1, 0.122]),
      ]),
    );
    this.torso.name = "torso";
    this.torso.position.y = 0.12;
    this.hips.add(this.torso);
    this.torso.add(
      this.mesh("jacket and shirt", [
        this.box([0.385, 0.37, 0.25], colors.jacket, [0, 0.185, 0]),
        this.box([0.102, 0.325, 0.025], colors.shirt, [0, 0.195, 0.129]),
        this.box([0.032, 0.32, 0.022], colors.seams, [-0.067, 0.175, 0.139]),
        this.box([0.032, 0.32, 0.022], colors.seams, [0.067, 0.175, 0.139]),
        this.box([0.07, 0.068, 0.022], colors.seams, [-0.126, 0.263, 0.132]),
        this.box([0.07, 0.068, 0.022], colors.seams, [0.126, 0.263, 0.132]),
        this.box([0.4, 0.037, 0.255], colors.seams, [0, 0.019, 0]),
        {
          geometry: new T.CylinderGeometry(0.062, 0.067, 0.095, 8),
          color: colors.skin,
          at: [0, 0.402, 0],
        },
      ]),
    );
    this.head.name = "head";
    this.head.position.set(0, 0.565, 0.006);
    this.torso.add(this.head);
    this.head.add(
      this.mesh("face and short hair", [
        {
          geometry: new T.SphereGeometry(1, 10, 7),
          scale: [0.103, 0.139, 0.104],
          color: colors.skin,
        },
        {
          geometry: new T.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, 1.46),
          scale: [0.108, 0.145, 0.11],
          color: colors.hair,
          at: [0, 0.003, -0.006],
        },
        this.box([0.03, 0.042, 0.036], colors.skin, [0, -0.012, 0.103]),
        this.box([0.02, 0.009, 0.01], colors.eyes, [-0.039, 0.024, 0.098]),
        this.box([0.02, 0.009, 0.01], colors.eyes, [0.039, 0.024, 0.098]),
        this.box([0.051, 0.008, 0.008], 0x805442, [0, -0.064, 0.088]),
        {
          geometry: new T.SphereGeometry(1, 6, 4),
          scale: [0.027, 0.042, 0.025],
          color: colors.skin,
          at: [-0.105, -0.006, 0],
        },
        {
          geometry: new T.SphereGeometry(1, 6, 4),
          scale: [0.027, 0.042, 0.025],
          color: colors.skin,
          at: [0.105, -0.006, 0],
        },
      ]),
    );

    for (const side of [-1, 1]) {
      const sideName = side > 0 ? "left" : "right";
      const arm = this.limb(
        this.torso,
        `${sideName} arm`,
        [side * 0.232, 0.332, 0],
        0.285,
        0.265,
      );
      arm.upper.add(
        this.mesh(`${sideName} jacket sleeve`, [
          this.box([0.132, 0.286, 0.143], colors.jacket, [0, -0.139, 0]),
        ]),
      );
      arm.lower.add(
        this.mesh(`${sideName} forearm`, [
          this.box([0.113, 0.255, 0.125], colors.jacket, [0, -0.122, 0]),
          this.box([0.115, 0.04, 0.127], colors.seams, [0, -0.245, 0]),
        ]),
      );
      arm.end.add(
        this.mesh(`${sideName} hand`, [
          this.box([0.079, 0.099, 0.085], colors.skin, [0, -0.042, 0.005]),
          this.box([0.03, 0.054, 0.05], colors.skin, [
            -side * 0.041,
            -0.026,
            0.024,
          ]),
        ]),
      );
      this.arms.push(arm);
      const leg = this.limb(
        this.hips,
        `${sideName} leg`,
        [side * 0.098, -0.005, 0],
        0.422,
        0.425,
      );
      leg.upper.add(
        this.mesh(`${sideName} jeans thigh`, [
          this.box([0.161, 0.432, 0.192], colors.jeans, [0, -0.211, 0]),
          this.box([0.026, 0.35, 0.008], colors.denimLight, [
            side * 0.06,
            -0.211,
            0.097,
          ]),
        ]),
      );
      leg.lower.add(
        this.mesh(`${sideName} jeans shin`, [
          this.box([0.137, 0.407, 0.163], colors.jeans, [0, -0.205, 0]),
        ]),
      );
      leg.end.add(
        this.mesh(`${sideName} boot`, [
          this.box([0.158, 0.116, 0.277], colors.leather, [0, -0.014, 0.052]),
          this.box([0.165, 0.025, 0.281], colors.sole, [0, -0.07, 0.053]),
        ]),
      );
      this.legs.push(leg);
    }
    this.update({ pose: "idle", speed: 0, time: 0 });
  }

  private box(size: Point, color: number, at: Point): Piece {
    return {
      geometry: new RoundedBoxGeometry(...size, 1, Math.min(...size) * 0.17),
      color,
      at,
    };
  }

  private mesh(name: string, pieces: Piece[]) {
    const geometries = pieces.map((piece) => {
      const source = piece.geometry;
      const geometry = source.index ? source.toNonIndexed() : source;
      if (geometry !== source) source.dispose();
      geometry.deleteAttribute("uv");
      if (piece.scale) geometry.scale(...piece.scale);
      if (piece.at) geometry.translate(...piece.at);
      const color = new T.Color(piece.color);
      const values = new Float32Array(
        geometry.getAttribute("position").count * 3,
      );
      for (let i = 0; i < values.length; i += 3) color.toArray(values, i);
      geometry.setAttribute("color", new T.BufferAttribute(values, 3));
      geometry.clearGroups();
      return geometry;
    });
    const combined = mergeGeometries(geometries)!;
    geometries.forEach((g) => g.dispose());
    combined.computeBoundingBox();
    combined.computeBoundingSphere();
    this.geometries.add(combined);
    const mesh = new T.Mesh(combined, this.material);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private limb(
    parent: T.Group,
    name: string,
    at: Point,
    upperLength: number,
    lowerLength: number,
  ): Limb {
    const upper = new T.Group(),
      lower = new T.Group(),
      end = new T.Group();
    upper.name = name;
    lower.name = `${name} lower`;
    end.name = `${name} end`;
    upper.position.set(...at);
    lower.position.y = -upperLength;
    end.position.y = -lowerLength;
    parent.add(upper);
    upper.add(lower);
    lower.add(end);
    return { upper, lower, end };
  }

  /** Solve the seat's arms to the wheel without involving the game controller. */
  private reach(arm: Limb, target: T.Vector3) {
    const parent = arm.upper.parent!;
    parent.updateWorldMatrix(true, false);
    this.root.localToWorld(target);
    parent.worldToLocal(target);
    const delta = target.sub(arm.upper.position);
    const length = T.MathUtils.clamp(delta.length(), 0.05, 0.545);
    const direction = delta.normalize();
    const along = (0.285 ** 2 - 0.265 ** 2 + length ** 2) / (2 * length);
    const bend = new T.Vector3(0, -1, 0)
      .addScaledVector(direction, direction.y)
      .normalize();
    const elbow = direction
      .clone()
      .multiplyScalar(along)
      .addScaledVector(bend, Math.sqrt(Math.max(0, 0.285 ** 2 - along ** 2)));
    arm.upper.quaternion.setFromUnitVectors(DOWN, elbow.clone().normalize());
    const forearm = direction.multiplyScalar(length).sub(elbow).normalize();
    arm.lower.quaternion
      .copy(arm.upper.quaternion)
      .invert()
      .multiply(new T.Quaternion().setFromUnitVectors(DOWN, forearm));
  }

  update(animation: CharacterAnimation) {
    if (this.disposed) return;
    const speed = Number.isFinite(animation.speed)
      ? Math.max(0, animation.speed)
      : 0;
    const time = Number.isFinite(animation.time) ? animation.time : 0;
    const dt =
      animation.dt === undefined
        ? 1 / 60
        : T.MathUtils.clamp(
            Number.isFinite(animation.dt) ? animation.dt : 0,
            0,
            0.1,
          );
    const pose = animation.pose;
    const moving = pose === "walk" || pose === "run";
    if (moving)
      this.phase += dt * Math.min(18, speed * (pose === "run" ? 2.2 : 3.9));
    if (this.lastPose === "seated" && pose !== "seated") this.phase = 0;
    this.lastPose = pose;
    this.hips.position.set(0, 0.94, 0);
    this.hips.rotation.set(0, 0, 0);
    this.torso.rotation.set(0, 0, 0);
    this.head.rotation.set(0, 0, 0);
    for (const limb of [...this.arms, ...this.legs]) {
      limb.upper.rotation.set(0, 0, 0);
      limb.lower.rotation.set(0, 0, 0);
      limb.end.rotation.set(0, 0, 0);
    }

    if (pose === "seated") {
      this.hips.position.y = 0.65;
      this.torso.rotation.x = -0.1;
      this.head.rotation.x = 0.07;
      this.legs.forEach((leg, i) => {
        leg.upper.rotation.set(-1.53, 0, (i ? 1 : -1) * 0.025);
        leg.lower.rotation.x = 0.6;
        leg.end.rotation.x = 0.92;
      });
      const steering = T.MathUtils.clamp(
        Number.isFinite(animation.steering) ? animation.steering! : 0,
        -0.55,
        0.55,
      );
      this.arms.forEach((arm, i) => {
        const side = i ? 1 : -1;
        const angle = steering * 1.7;
        this.reach(
          arm,
          new T.Vector3(
            side * 0.145 * Math.cos(angle),
            0.938 + side * 0.145 * Math.sin(angle),
            0.357,
          ),
        );
      });
    } else if (moving) {
      const running = pose === "run";
      const strength = Math.min(1, speed / (running ? 4.2 : 1.8));
      const swing = Math.sin(this.phase) * (running ? 0.78 : 0.47) * strength;
      this.hips.position.y -=
        (running ? 0.035 : 0.014) * (1 - Math.cos(this.phase * 2)) * strength;
      this.hips.rotation.y = -swing * 0.09;
      this.torso.rotation.set(
        running ? 0.1 : 0.025,
        swing * 0.16,
        -swing * 0.025,
      );
      this.arms.forEach((arm, i) => {
        arm.upper.rotation.x = (i ? -swing : swing) * (running ? 0.94 : 0.8);
        arm.upper.rotation.z = (i ? 1 : -1) * 0.08;
        arm.lower.rotation.x = running ? -0.94 : -0.16;
      });
      this.legs.forEach((leg, i) => {
        const phase = this.phase + i * Math.PI;
        leg.upper.rotation.x = i ? -swing : swing;
        leg.lower.rotation.x =
          Math.max(0, Math.sin(phase)) * (running ? 1.2 : 0.65) * strength;
        leg.end.rotation.x =
          -leg.upper.rotation.x * 0.35 - leg.lower.rotation.x * 0.2;
      });
    } else if (pose === "airborne") {
      const rising = (animation.verticalSpeed ?? 0) > 0;
      this.hips.position.y = 0.92;
      this.torso.rotation.x = 0.09;
      this.arms.forEach((arm, i) => {
        arm.upper.rotation.set(rising ? -0.65 : -0.28, 0, (i ? 1 : -1) * 0.32);
        arm.lower.rotation.x = -0.55;
      });
      this.legs[0].upper.rotation.x = rising ? -0.43 : -0.12;
      this.legs[0].lower.rotation.x = 0.61;
      this.legs[1].upper.rotation.x = 0.14;
      this.legs[1].lower.rotation.x = 0.28;
    } else {
      // Breathe above the pelvis; planted feet never bob through the ground.
      this.torso.rotation.x = Math.sin(time * 1.8) * 0.006;
      this.head.rotation.y = Math.sin(time * 0.43) * 0.025;
      this.arms.forEach((arm, i) => {
        arm.upper.rotation.set(
          Math.sin(time * 1.8 + i) * 0.012,
          0,
          (i ? 1 : -1) * 0.065,
        );
        arm.lower.rotation.x = -0.075;
      });
    }
    this.root.userData.character.pose = pose;
    this.root.updateMatrixWorld(true);
    if (pose === "walk" || pose === "run") {
      // Maintain a supporting sole at ground height as the leg joints bend.
      // Work in character space so camera-independent world yaw/translation
      // cannot change the gait or pull a walker down on elevated ground.
      const inverseRoot = this.root.matrixWorld.clone().invert();
      let sole = Infinity;
      for (const leg of this.legs) {
        const boot = leg.end.children[0] as T.Mesh;
        const bounds = boot.geometry
          .boundingBox!.clone()
          .applyMatrix4(
            new T.Matrix4().multiplyMatrices(inverseRoot, boot.matrixWorld),
          );
        sole = Math.min(sole, bounds.min.y);
      }
      this.hips.position.y += 0.005 - sole;
      this.root.updateMatrixWorld(true);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.geometries.forEach((g) => g.dispose());
    this.geometries.clear();
    this.material.dispose();
    this.root.removeFromParent();
    this.root.clear();
  }
}
