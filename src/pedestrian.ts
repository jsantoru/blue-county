import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import { angleDiff, clamp } from "./types";

export const WALKING = {
  radius: 0.3,
  halfSegment: 0.59,
  center: 0.89,
  walk: 2.5,
  run: 5.7,
};
export interface FootCommand {
  moveX: number;
  moveY: number;
  sprint: boolean;
  jump: boolean;
}
const identity = { x: 0, y: 0, z: 0, w: 1 };

/** Feet-based, fixed-step motor. Rendering and input are deliberately separate. */
export class Pedestrian {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly controller: RAPIER.KinematicCharacterController;
  readonly position = new Vector3();
  readonly previous = new Vector3();
  readonly velocity = new Vector3();
  readonly lastSafe = new Vector3();
  yaw = 0;
  grounded = false;
  enabled = false;
  private coyote = 0;
  private jumpBuffer = 0;
  private jumpHeld = false;
  constructor(readonly world: RAPIER.World) {
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased(),
    );
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(WALKING.halfSegment, WALKING.radius)
        .setCollisionGroups(0x0008ffff)
        .setFriction(0),
      this.body,
    );
    this.controller = world.createCharacterController(0.035);
    // Two millimeters avoids repeated near-penetration contacts freezing a
    // diagonal walker on broad surfaces without a perceptible visual bump.
    this.controller.setNormalNudgeFactor(0.002);
    this.controller.enableAutostep(0.32, 0.2, false);
    this.controller.enableSnapToGround(0.4);
    this.controller.setMaxSlopeClimbAngle(Math.PI * 0.26);
    this.controller.setMinSlopeSlideAngle(Math.PI * 0.29);
    this.controller.setApplyImpulsesToDynamicBodies(false);
    this.setEnabled(false);
  }
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.body.setEnabled(enabled);
    this.velocity.set(0, 0, 0);
    this.jumpBuffer = this.coyote = 0;
    this.jumpHeld = false;
  }
  place(feet: Vector3, yaw = this.yaw) {
    this.position.copy(feet);
    this.previous.copy(feet);
    this.lastSafe.copy(feet);
    this.yaw = yaw;
    this.velocity.set(0, 0, 0);
    const center = { x: feet.x, y: feet.y + WALKING.center, z: feet.z };
    this.body.setTranslation(center, true);
    this.body.setNextKinematicTranslation(center);
    this.grounded = false;
    this.coyote = this.jumpBuffer = 0;
    this.jumpHeld = false;
  }
  queueJump() {
    this.jumpBuffer = 0.14;
  }
  step(command: FootCommand, cameraYaw: number, dt: number) {
    if (!this.enabled) return;
    this.previous.copy(this.position);
    if (command.jump && !this.jumpHeld) this.queueJump();
    this.jumpHeld = command.jump;
    this.coyote = this.grounded ? 0.11 : Math.max(0, this.coyote - dt);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    const magnitude = Math.min(1, Math.hypot(command.moveX, command.moveY));
    const length = Math.hypot(command.moveX, command.moveY) || 1;
    const x = (command.moveX / length) * magnitude,
      z = (command.moveY / length) * magnitude;
    const speed = command.sprint ? WALKING.run : WALKING.walk;
    // Camera forward is +Z at yaw zero; its physical right is -X.
    const vx = (Math.sin(cameraYaw) * z - Math.cos(cameraYaw) * x) * speed;
    const vz = (Math.cos(cameraYaw) * z + Math.sin(cameraYaw) * x) * speed;
    const response = 1 - Math.exp(-dt * (this.grounded ? 17 : 6));
    this.velocity.x += (vx - this.velocity.x) * response;
    this.velocity.z += (vz - this.velocity.z) * response;
    if (magnitude > 0.08)
      this.yaw +=
        angleDiff(Math.atan2(vx, vz), this.yaw) * (1 - Math.exp(-dt * 14));
    if (this.jumpBuffer > 0 && this.coyote > 0) {
      this.velocity.y = 6.4;
      this.grounded = false;
      this.coyote = this.jumpBuffer = 0;
      // A large downward bias cancels the controller's stair lift at curb edges.
    } else if (this.grounded && this.velocity.y <= 0) this.velocity.y = -0.15;
    this.velocity.y = Math.max(-24, this.velocity.y - 20 * dt);
    this.controller.computeColliderMovement(
      this.collider,
      {
        x: this.velocity.x * dt,
        y: this.velocity.y * dt,
        z: this.velocity.z * dt,
      },
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      0xffffffff,
      (c) => c.handle !== this.collider.handle,
    );
    const movement = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();
    if (this.grounded && this.velocity.y < 0) this.velocity.y = 0;
    if (this.velocity.y > 0 && movement.y < this.velocity.y * dt * 0.3)
      this.velocity.y = 0;
    this.position.add(new Vector3(movement.x, movement.y, movement.z));
    if (this.grounded && this.velocity.y <= 0) {
      // Rapier's capsule/large-cuboid contacts can accumulate tiny downward
      // errors while sliding diagonally. Correct only an already grounded foot
      // within 6cm of its support; this cannot pull an airborne player down or
      // lift one onto a curb/wall that the character sweep did not clear.
      const support = this.world.castRayAndGetNormal(
        new RAPIER.Ray(
          { x: this.position.x, y: this.position.y + 0.12, z: this.position.z },
          { x: 0, y: -1, z: 0 },
        ),
        0.25,
        true,
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
        0xffffffff,
        this.collider,
        this.body,
      );
      if (
        support &&
        support.normal.y > Math.cos(this.controller.maxSlopeClimbAngle())
      ) {
        const surface = this.position.y + 0.12 - support.timeOfImpact;
        const feet =
          surface +
          this.controller.offset() +
          WALKING.radius * (1 / support.normal.y - 1);
        const correction = feet - this.position.y;
        if (correction > 0 && correction < 0.06) this.position.y = feet;
      }
    }
    this.body.setNextKinematicTranslation({
      x: this.position.x,
      y: this.position.y + WALKING.center,
      z: this.position.z,
    });
    if (this.grounded) this.lastSafe.copy(this.position);
  }
  speed() {
    return (
      Math.hypot(
        this.position.x - this.previous.x,
        this.position.z - this.previous.z,
      ) * 60
    );
  }
  /** Capsule clearance excludes self but includes cars, scenery and pedestrian-only solids. */
  clearAt(feet: Vector3, exclude?: RAPIER.RigidBody) {
    return !this.world.intersectionWithShape(
      { x: feet.x, y: feet.y + WALKING.center + 0.07, z: feet.z },
      identity,
      new RAPIER.Capsule(WALKING.halfSegment, WALKING.radius),
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      0xffffffff,
      this.collider,
      exclude,
    );
  }
  dispose() {
    this.world.removeCharacterController(this.controller);
    this.world.removeRigidBody(this.body);
  }
}

/** Grounded door-side exits: prefer US driver side, then the passenger side. */
export function findVehicleExit(
  world: RAPIER.World,
  pedestrian: Pedestrian,
  car: { position: Vector3; body: RAPIER.RigidBody; collider: RAPIER.Collider },
  heading: number,
) {
  for (const side of [1, -1])
    for (const distance of [1.65, 2.05])
      for (const fore of [0, -0.3, 0.2]) {
        const x =
          car.position.x +
          Math.cos(heading) * side * distance +
          Math.sin(heading) * fore;
        const z =
          car.position.z -
          Math.sin(heading) * side * distance +
          Math.cos(heading) * fore;
        const origin = { x, y: car.position.y + 0.8, z };
        const ground = world.castRayAndGetNormal(
          new RAPIER.Ray(origin, { x: 0, y: -1, z: 0 }),
          3,
          true,
          RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
          0xffffffff,
          pedestrian.collider,
          car.body,
        );
        if (!ground || ground.normal.y < 0.68) continue;
        const feet = new Vector3(x, origin.y - ground.timeOfImpact + 0.04, z);
        if (
          Math.abs(feet.y - (car.position.y - 0.8)) > 1.25 ||
          !pedestrian.clearAt(feet, car.body)
        )
          continue;
        const start = new Vector3(
          car.position.x + Math.cos(heading) * side * 1.02,
          feet.y + WALKING.center,
          car.position.z - Math.sin(heading) * side * 1.02,
        );
        const delta = feet
          .clone()
          .add(new Vector3(0, WALKING.center, 0))
          .sub(start);
        const hit = world.castShape(
          start,
          identity,
          delta,
          new RAPIER.Capsule(WALKING.halfSegment, WALKING.radius),
          0,
          1,
          true,
          RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
          0xffffffff,
          pedestrian.collider,
          car.body,
        );
        if (!hit) return { feet, side };
      }
  return null;
}

export function footCameraPosition(
  world: RAPIER.World,
  pedestrian: Pedestrian,
  target: Vector3,
  desired: Vector3,
  sceneryDistance?: (
    origin: Vector3,
    direction: Vector3,
    length: number,
  ) => number | undefined,
) {
  const direction = desired.clone().sub(target),
    length = direction.length();
  if (length < 0.001) return desired.clone();
  direction.divideScalar(length);
  const hit = world.castShape(
    target,
    identity,
    direction,
    new RAPIER.Ball(0.2),
    0.02,
    length,
    false,
    RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
    0xffffffff,
    pedestrian.collider,
    pedestrian.body,
  );
  const visualHit = sceneryDistance?.(target, direction, length);
  const distance = clamp(
    Math.min(
      hit?.time_of_impact ?? length,
      visualHit === undefined ? length : visualHit - 0.25,
    ),
    0.15,
    length,
  );
  return target.clone().addScaledVector(direction, distance);
}
