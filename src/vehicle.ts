import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3, Quaternion } from "three";
import { BoostBank, ReverseGate } from "./rules";
import { clamp, type DriveInput, type Point } from "./types";
export const handling = {
  mass: 1650,
  engineForce: 14500,
  boostForce: 15000,
  brakeForce: 26000,
  maxSpeed: 53,
  boostSpeed: 70,
  steerLow: 0.51,
  steerFalloff: 0.045,
  grip: 1.65,
  driftGrip: 0.78,
  spring: 44000,
  damper: 5200,
  stability: 3600,
  drag: 0.44,
};
export const WHEELS = [
  [0.75, 0.1, 1.43],
  [-0.75, 0.1, 1.43],
  [0.75, 0.1, -1.415],
  [-0.75, 0.1, -1.415],
] as Point[];
export const vehicleGeometry = { visualOffsetY: -0.78, wheelRadius: 0.345 };
/** Import inspected axle locations without coupling the visible mesh to chassis physics. */
export function configureVehicleGeometry(manifest: {
  wheels: { center: number[]; radius: number }[];
  runtimeIntegration?: { visualOffsetFromChassis?: number[] };
}) {
  if (manifest.wheels.length !== 4)
    throw new Error("Vehicle manifest must describe four wheels.");
  manifest.wheels.forEach((wheel, i) => {
    WHEELS[i][0] = wheel.center[0];
    WHEELS[i][2] = wheel.center[2];
  });
  vehicleGeometry.wheelRadius = manifest.wheels[0].radius;
  vehicleGeometry.visualOffsetY =
    manifest.runtimeIntegration?.visualOffsetFromChassis?.[1] ?? -0.78;
}
const up = new Vector3(0, 1, 0);
export class Vehicle {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  position = new Vector3();
  previous = new Vector3();
  rotation = new Quaternion();
  previousRotation = new Quaternion();
  speed = 0;
  forwardSpeed = 0;
  steering = 0;
  slip = 0;
  grounded = 0;
  drift = 0;
  boosting = false;
  wheelSpin = 0;
  wheelHeights = [0.345, 0.345, 0.345, 0.345];
  bank = new BoostBank();
  reverse = new ReverseGate();
  lastBrake = 0;
  protection = 0;
  life = 0;
  stuck = 0;
  lastImpact = 0;
  rpm = 850;
  gear = 1;
  constructor(
    public world: RAPIER.World,
    public id: number,
    p: Point,
    heading = 0,
  ) {
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(...p)
        .setRotation({
          x: 0,
          y: Math.sin(heading / 2),
          z: 0,
          w: Math.cos(heading / 2),
        })
        .setCcdEnabled(true)
        .setLinearDamping(0.035)
        .setAngularDamping(0.55)
        .setCanSleep(false),
    );
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.9, 0.31, 2.3)
        .setTranslation(0, 0.04, 0)
        .setMass(handling.mass)
        .setFriction(0.25)
        .setRestitution(0.05)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(1800),
      this.body,
    );
    this.sync();
    this.previous.copy(this.position);
    this.previousRotation.copy(this.rotation);
  }
  sync() {
    this.position.copy(this.body.translation());
    this.rotation.copy(this.body.rotation());
  }
  reset(p: Point, heading: number) {
    this.body.setTranslation({ x: p[0], y: p[1] + 0.83, z: p[2] }, true);
    this.body.setRotation(
      { x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) },
      true,
    );
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.resetForces(true);
    this.body.resetTorques(true);
    this.sync();
    this.previous.copy(this.position);
    this.previousRotation.copy(this.rotation);
    this.reverse.reset();
    this.drift = 0;
    this.protection = 2;
    this.life++;
    this.stuck = 0;
    this.collider.setCollisionGroups(0x00040001);
  }
  step(input: DriveInput, dt: number, time: number, onRoad = true) {
    this.previous.copy(this.position);
    this.previousRotation.copy(this.rotation);
    this.body.resetForces(false);
    this.body.resetTorques(false);
    this.protection = Math.max(0, this.protection - dt);
    this.collider.setCollisionGroups(
      this.protection > 0 ? 0x00040001 : 0x00020003,
    );
    const q = new Quaternion().copy(this.body.rotation()),
      p = new Vector3().copy(this.body.translation()),
      v = new Vector3().copy(this.body.linvel());
    const f = new Vector3(0, 0, 1).applyQuaternion(q),
      r = new Vector3(1, 0, 0).applyQuaternion(q);
    f.y = 0;
    r.y = 0;
    f.normalize();
    r.normalize();
    this.speed = Math.hypot(v.x, v.z);
    this.forwardSpeed = v.dot(f);
    const lateral = v.dot(r);
    this.slip = Math.atan2(lateral, Math.max(3, Math.abs(this.forwardSpeed)));
    const wantsDrift =
      this.speed > 13 &&
      Math.abs(input.steer) > 0.22 &&
      ((input.brake > 0.15 && this.lastBrake < 0.15) || input.handbrake);
    if (wantsDrift) this.drift = 1;
    else
      this.drift = Math.max(
        0,
        this.drift -
          dt *
            (input.throttle > 0.15 && Math.abs(input.steer) > 0.2 ? 0.35 : 1.1),
      );
    this.lastBrake = input.brake;
    // With +Z forward and +Y up, physical right is -X: right input needs negative yaw.
    const steeringTarget =
      (-input.steer * handling.steerLow) /
      (1 + this.speed * handling.steerFalloff);
    this.steering += (steeringTarget - this.steering) * Math.min(1, dt * 22);
    const reverse = this.reverse.update(
      this.forwardSpeed,
      input.brake,
      input.throttle,
    );
    let grounded = 0;
    const boosting = this.bank.spend(
      dt,
      input.boost,
      this.forwardSpeed,
      this.grounded > 1,
    );
    this.boosting = boosting;
    const maxSpeed = boosting ? handling.boostSpeed : handling.maxSpeed;
    const drive = reverse
      ? -input.brake * handling.engineForce * 0.48
      : input.throttle *
        (handling.engineForce + (boosting ? handling.boostForce : 0)) *
        clamp((maxSpeed - Math.max(0, this.forwardSpeed)) / 8, 0, 1);
    for (let i = 0; i < 4; i++) {
      const mount = new Vector3(...WHEELS[i]).applyQuaternion(q).add(p);
      const ray = new RAPIER.Ray(mount, { x: 0, y: -1, z: 0 });
      const hit = this.world.castRayAndGetNormal(
        ray,
        1.05,
        true,
        undefined,
        undefined,
        undefined,
        this.body,
        (c) => !c.parent() || c.parent()!.isFixed(),
      );
      if (!hit) {
        this.wheelHeights[i] = 0.12;
        continue;
      }
      grounded++;
      const contact = new Vector3(mount.x, mount.y - hit.timeOfImpact, mount.z);
      const vel = new Vector3().copy(this.body.velocityAtPoint(contact));
      const normal = new Vector3().copy(hit.normal);
      if (normal.y < 0) normal.negate();
      const compression = 1.0 - hit.timeOfImpact;
      const load = clamp(
        compression * handling.spring - vel.dot(normal) * handling.damper,
        0,
        18000,
      );
      this.body.addForceAtPoint(normal.multiplyScalar(load), mount, true);
      this.wheelHeights[i] =
        contact.y +
        vehicleGeometry.wheelRadius -
        p.y -
        vehicleGeometry.visualOffsetY;
      const wheelForward = f
          .clone()
          .applyAxisAngle(up, i < 2 ? this.steering : 0),
        wheelRight = r.clone().applyAxisAngle(up, i < 2 ? this.steering : 0);
      const lat = vel.dot(wheelRight),
        long = vel.dot(wheelForward);
      const tireGrip =
        (onRoad ? handling.grip : 1.05) *
        (i >= 2
          ? 1 - this.drift * (1 - handling.driftGrip / handling.grip)
          : 1);
      const maxForce = Math.max(0, load) * tireGrip;
      const side = clamp(-lat * (handling.mass / 4) * 7.2, -maxForce, maxForce);
      let longitudinal = drive / 4;
      const braking = reverse ? input.throttle : input.brake;
      longitudinal += clamp(
        (-long * (handling.mass / 4)) / dt,
        (-handling.brakeForce * braking) / 4,
        (handling.brakeForce * braking) / 4,
      );
      if (input.handbrake && i >= 2)
        longitudinal += clamp(-long * 1500, -5000, 5000);
      // No tire propulsion from an uncompressed ray; the friction ellipse also leaves grip for cornering.
      longitudinal = clamp(longitudinal, -maxForce, maxForce);
      const tireTotal = Math.hypot(side, longitudinal),
        tireScale =
          tireTotal > maxForce && tireTotal > 0 ? maxForce / tireTotal : 1;
      const force = wheelRight
        .multiplyScalar(side * tireScale)
        .add(wheelForward.multiplyScalar(longitudinal * tireScale));
      // Lateral load acts below the COM, producing visible but bounded weight transfer.
      const forceAt = new Vector3(contact.x, p.y - 0.18, contact.z);
      this.body.addForceAtPoint(force, forceAt, true);
    }
    this.grounded = grounded;
    this.body.addForce(
      v
        .clone()
        .multiplyScalar(-handling.drag * this.speed - (onRoad ? 18 : 65)),
      true,
    );
    if (grounded >= 2) {
      const carUp = new Vector3(0, 1, 0).applyQuaternion(q),
        ang = this.body.angvel();
      const upright = carUp.cross(up).multiplyScalar(handling.stability);
      upright.x -= ang.x * 2000;
      upright.z -= ang.z * 2000;
      upright.y = 0;
      this.body.addTorque(upright, true);
      if (this.drift > 0.1 && Math.abs(this.slip) > 0.09 && this.speed > 15)
        this.bank.earn("drift", 2.3, time, 0.3);
    }
    this.wheelSpin += (this.forwardSpeed * dt) / vehicleGeometry.wheelRadius;
    this.gear = clamp(Math.floor(this.speed / 12) + 1, 1, 4);
    this.rpm = clamp(
      950 + (this.speed % 12) * 330 + input.throttle * 600,
      850,
      6200,
    );
  }
}
