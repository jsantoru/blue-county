import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { steeringWheelGrip, type SteeringWheelSpec } from "./steering-wheel";

export type CharacterPose = "seated" | "idle" | "walk" | "run" | "airborne";
export interface CharacterAnimation {
  pose: CharacterPose;
  /** Horizontal travel speed in meters per second. */
  speed: number;
  time: number;
  dt?: number;
  verticalSpeed?: number;
  steering?: number;
  /** Transfer animation: zero is standing and one is fully seated. */
  seatedBlend?: number;
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
const DEFAULT_COLORS = {
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
export type CharacterPalette = typeof DEFAULT_COLORS;
export interface CharacterVisualOptions {
  name?: string;
  palette?: Partial<CharacterPalette>;
  hairStyle?: "short" | "swept" | "receding" | "curly";
  wheel?: SteeringWheelSpec;
  seatAnchor?: readonly [number, number, number];
}

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

  constructor(private readonly options: CharacterVisualOptions = {}) {
    const colors = { ...DEFAULT_COLORS, ...options.palette };
    this.root.name = options.name ?? "Replaceable driver character";
    this.root.userData.character = {
      units: "meters",
      origin: "feet",
      forward: "+Z",
      up: "+Y",
      height: CHARACTER_DIMENSIONS.height,
      seatAnchor: [...(options.seatAnchor ?? CHARACTER_SEAT_ANCHOR)],
      palette: { ...colors },
      hairStyle: options.hairStyle ?? "short",
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
        ...this.hair(options.hairStyle ?? "short", colors.hair),
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
      const wrist = new T.Group();
      wrist.name = `${sideName}_hand`;
      arm.end.add(wrist);
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
      const foot = new T.Group();
      foot.name = `${sideName}_foot`;
      leg.end.add(foot);
    }
    this.update({ pose: "idle", speed: 0, time: 0 });
  }

  private hair(
    style: NonNullable<CharacterVisualOptions["hairStyle"]>,
    color: number,
  ): Piece[] {
    if (style === "receding")
      return [
        ...([-1, 1] as const).map((side): Piece => ({
          geometry: new T.SphereGeometry(1, 8, 5),
          scale: [0.023, 0.087, 0.095],
          at: [side * 0.09, 0.004, -0.025],
          color,
        })),
        {
          geometry: new T.SphereGeometry(1, 8, 5),
          scale: [0.091, 0.074, 0.042],
          at: [0, 0.034, -0.078],
          color,
        },
      ];
    if (style === "curly") {
      const pieces: Piece[] = [];
      for (let row = -1; row <= 1; row++)
        for (let col = -1; col <= 1; col++)
          pieces.push({
            geometry: new T.SphereGeometry(1, 7, 5),
            scale: [0.041, 0.039, 0.043],
            at: [
              col * 0.06,
              0.109 - Math.abs(col) * 0.014,
              row * 0.061 - 0.012,
            ],
            color,
          });
      return pieces;
    }
    return [
      {
        geometry: new T.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, 1.46),
        scale: style === "swept" ? [0.109, 0.151, 0.114] : [0.108, 0.145, 0.11],
        color,
        at: style === "swept" ? [0.012, 0.004, -0.012] : [0, 0.003, -0.006],
      },
    ];
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

  private poseSeated(steering: number) {
    this.hips.position.set(0, 0.65, 0);
    this.hips.rotation.set(0, 0, 0);
    this.torso.rotation.set(-0.1, 0, 0);
    this.head.rotation.set(0.07, 0, 0);
    this.legs.forEach((leg, i) => {
      leg.upper.rotation.set(-1.53, 0, (i ? 1 : -1) * 0.025);
      leg.lower.rotation.x = 0.6;
      leg.end.rotation.x = 0.92;
    });
    this.arms.forEach((arm, i) => {
      const side = i ? 1 : -1;
      const angle = -steering * 1.7;
      const target = this.options.wheel
        ? steeringWheelGrip(this.options.wheel, side, steering).sub(
            new T.Vector3(
              ...(this.options.seatAnchor ?? CHARACTER_SEAT_ANCHOR),
            ),
          )
        : new T.Vector3(
            side * 0.145 * Math.cos(angle),
            0.938 + side * 0.145 * Math.sin(angle),
            0.357,
          );
      this.reach(arm, target);
    });
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
    const seated =
      animation.seatedBlend === undefined
        ? animation.pose === "seated"
          ? 1
          : 0
        : T.MathUtils.clamp(
            Number.isFinite(animation.seatedBlend) ? animation.seatedBlend : 0,
            0,
            1,
          );
    const steering = T.MathUtils.clamp(
      Number.isFinite(animation.steering) ? animation.steering! : 0,
      -0.55,
      0.55,
    );
    const pose =
      animation.pose === "seated" && seated < 1 ? "idle" : animation.pose;
    const moving = pose === "walk" || pose === "run";
    const running = pose === "run";
    const strength = Math.min(1, speed / (running ? 4.2 : 1.8));
    const strideAngle = (running ? 0.78 : 0.47) * strength;
    const strideReach = (0.422 + 0.425) * Math.sin(strideAngle);
    if (moving && strideReach > 0.00001) {
      // One stance covers twice this reach in half a cycle. Advance by actual
      // travel so the supporting boot stays put while the body moves over it.
      this.phase =
        (this.phase + (dt * Math.PI * speed) / (2 * strideReach)) %
        (Math.PI * 2);
    }
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
      this.poseSeated(steering);
    } else if (moving) {
      const swing = Math.sin(this.phase) * strideAngle;
      this.torso.rotation.set(
        (running ? 0.1 : 0.025) * strength,
        swing * 0.16,
        -swing * 0.025,
      );
      const supportCycle = (this.phase / (Math.PI * 2)) % 0.5;
      const supportAngle = Math.asin(
        (supportCycle * 4 - 1) * Math.sin(strideAngle),
      );
      // Place the pelvis over the supporting straight leg. The recovering
      // ankle is then solved above that same ground plane, rather than letting
      // whichever boot happens to be lower move the entire body vertically.
      const ankleHeight = 0.0875;
      this.hips.position.y =
        ankleHeight + 0.005 + (0.422 + 0.425) * Math.cos(supportAngle);
      this.legs.forEach((leg, i) => {
        const cycle = (this.phase / (Math.PI * 2) + i * 0.5) % 1;
        if (cycle < 0.5) {
          // A straight supporting leg moves from ahead (+Z) to behind (-Z).
          // arcsin turns a constant foot speed into the required hip angle.
          leg.upper.rotation.x = Math.asin(
            (cycle * 4 - 1) * Math.sin(strideAngle),
          );
        } else {
          const recovery = (cycle - 0.5) * 2;
          const targetZ = (recovery * 2 - 1) * strideReach;
          const targetY =
            ankleHeight +
            Math.sin(recovery * Math.PI) * (running ? 0.25 : 0.11) * strength;
          const down = this.hips.position.y - 0.005 - targetY;
          const distance = Math.min(0.422 + 0.425, Math.hypot(down, targetZ));
          const knee = Math.acos(
            T.MathUtils.clamp(
              (distance ** 2 - 0.422 ** 2 - 0.425 ** 2) / (2 * 0.422 * 0.425),
              -1,
              1,
            ),
          );
          leg.upper.rotation.x =
            Math.atan2(-targetZ, down) -
            Math.atan2(0.425 * Math.sin(knee), 0.422 + 0.425 * Math.cos(knee));
          leg.lower.rotation.x = knee;
        }
        // Positive knee X folds the shin backward for our down-pointing legs.
        // Counter-rotate the ankle so a bent leg cannot tip its toe underground.
        leg.end.rotation.x = -leg.upper.rotation.x - leg.lower.rotation.x;
        const arm = this.arms[i];
        arm.upper.rotation.x = -leg.upper.rotation.x * (running ? 0.94 : 0.8);
        arm.upper.rotation.z = (i ? 1 : -1) * 0.08;
        arm.lower.rotation.x = (running ? -0.94 : -0.16) * strength;
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
    if (pose !== "seated" && seated > 0) {
      const joints = [
        this.hips,
        this.torso,
        this.head,
        ...[...this.arms, ...this.legs].flatMap((limb) => [
          limb.upper,
          limb.lower,
          limb.end,
        ]),
      ];
      const standing = joints.map((joint) => ({
        position: joint.position.clone(),
        quaternion: joint.quaternion.clone(),
      }));
      this.poseSeated(steering);
      joints.forEach((joint, i) => {
        joint.position.lerpVectors(
          standing[i].position,
          joint.position,
          seated,
        );
        joint.quaternion.slerpQuaternions(
          standing[i].quaternion,
          joint.quaternion,
          seated,
        );
      });
    }
    this.root.userData.character.pose = animation.pose;
    this.root.userData.character.seatedBlend = seated;
    this.root.updateMatrixWorld(true);
    if (seated < 0.001 && (pose === "walk" || pose === "run")) {
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
