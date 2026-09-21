import RAPIER from "@dimforge/rapier3d-compat";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Vector3 } from "three";
import {
  findVehicleExit,
  footCameraPosition,
  Pedestrian,
  WALKING,
  type FootCommand,
} from "../src/pedestrian";

beforeAll(async () => {
  await RAPIER.init();
});
const worlds: RAPIER.World[] = [];
afterEach(() => worlds.splice(0).forEach((world) => world.free()));
const idle: FootCommand = { moveX: 0, moveY: 0, sprint: false, jump: false };
function fixture(floor = true) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  worlds.push(world);
  world.timestep = 1 / 60;
  if (floor)
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(100, 0.5, 100)
        .setTranslation(0, -0.5, 0)
        .setCollisionGroups(0x00010007),
    );
  const pedestrian = new Pedestrian(world);
  pedestrian.setEnabled(true);
  pedestrian.place(new Vector3(0, 0.04, 0));
  const tick = (command: Partial<FootCommand> = {}, yaw = 0, count = 1) => {
    for (let i = 0; i < count; i++) {
      pedestrian.step({ ...idle, ...command }, yaw, 1 / 60);
      world.step();
    }
  };
  world.step();
  if (floor) tick({}, 0, 20);
  return { world, pedestrian, tick };
}

describe("on-foot physics", () => {
  it("walks, runs, accelerates and brakes naturally without a diagonal speed boost", () => {
    function distance(moveX: number, moveY: number, sprint: boolean) {
      const { pedestrian, tick } = fixture();
      tick({ moveX, moveY, sprint }, 0, 180);
      const travel = Math.hypot(pedestrian.position.x, pedestrian.position.z);
      expect(pedestrian.grounded).toBe(true);
      expect(pedestrian.position.y).toBeGreaterThanOrEqual(0);
      expect(pedestrian.position.y).toBeLessThan(0.1);
      const end = pedestrian.position.clone();
      tick({}, 0, 60);
      expect(pedestrian.position.distanceTo(end)).toBeLessThan(
        sprint ? 0.4 : 0.2,
      );
      expect(pedestrian.speed()).toBeLessThan(0.005);
      return travel;
    }
    const walk = distance(0, 1, false),
      diagonal = distance(1, 1, false),
      run = distance(0, 1, true);
    expect(walk).toBeGreaterThan(7.1);
    expect(walk).toBeLessThan(7.6);
    // Collision margin nudges introduce tiny direction-dependent differences;
    // diagonal movement must stay within 2%, not the usual sqrt(2) boost.
    expect(diagonal / walk).toBeGreaterThan(0.98);
    expect(diagonal / walk).toBeLessThan(1.02);
    expect(Math.abs(run / walk - WALKING.run / WALKING.walk)).toBeLessThan(
      0.025,
    );
  });

  it.each([
    [0, 0, 1, 0, 1],
    [0, 1, 0, -1, 0],
    [Math.PI / 2, 0, 1, 1, 0],
    [Math.PI, 0, 1, 0, -1],
    [-Math.PI / 2, 0, 1, -1, 0],
  ])(
    "matches the camera-relative cardinal axes (%f, %f, %f)",
    (yaw, x, y, wantedX, wantedZ) => {
      const { pedestrian, tick } = fixture();
      tick({ moveX: x, moveY: y }, yaw, 90);
      const actual = pedestrian.position.clone().setY(0).normalize();
      expect(actual.x).toBeCloseTo(wantedX, 2);
      expect(actual.z).toBeCloseTo(wantedZ, 2);
      expect(
        Math.cos(pedestrian.yaw - Math.atan2(wantedX, wantedZ)),
      ).toBeGreaterThan(0.999);
    },
  );

  it("slides along a wall without penetration and handles obstacles reserved for pedestrians", () => {
    const { world, pedestrian, tick } = fixture();
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.2, 2, 25)
        .setTranslation(-2, 2, 0)
        .setCollisionGroups(0x00080008),
    );
    world.step();
    tick({ moveX: 1, moveY: 1, sprint: true }, 0, 180);
    expect(pedestrian.position.x).toBeGreaterThan(-1.51);
    expect(pedestrian.position.x).toBeLessThan(-1.4);
    expect(pedestrian.position.z).toBeGreaterThan(8);
    expect(pedestrian.grounded).toBe(true);
  });

  it("steps up a normal curb and follows a walkable slope", () => {
    const curb = fixture();
    curb.world.createCollider(
      RAPIER.ColliderDesc.cuboid(2, 0.11, 3).setTranslation(0, 0.11, 5),
    );
    curb.world.step();
    curb.tick({ moveY: 1 }, 0, 140);
    expect(curb.pedestrian.position.z).toBeGreaterThan(5);
    expect(curb.pedestrian.position.y).toBeGreaterThan(0.23);
    expect(curb.pedestrian.position.y).toBeLessThan(0.32);
    expect(curb.pedestrian.grounded).toBe(true);
    const slope = fixture(false);
    slope.world.createCollider(
      RAPIER.ColliderDesc.trimesh(
        new Float32Array([-5, 0, -5, 5, 0, -5, -5, 4, 15, 5, 4, 15]),
        new Uint32Array([0, 2, 1, 1, 2, 3]),
      ),
    );
    slope.pedestrian.place(new Vector3(0, 1.05, 0));
    slope.world.step();
    slope.tick({}, 0, 30);
    slope.tick({ moveY: 1 }, 0, 180);
    expect(slope.pedestrian.position.z).toBeGreaterThan(6.5);
    expect(slope.pedestrian.position.y).toBeGreaterThan(2.3);
    expect(slope.pedestrian.grounded).toBe(true);
  });

  it("jumps once for a held button, lands, then accepts a fresh jump", () => {
    const { pedestrian, tick } = fixture();
    let top = 0,
      launches = 0,
      airborne = false;
    for (let i = 0; i < 160; i++) {
      tick({ jump: true });
      top = Math.max(top, pedestrian.position.y);
      if (!pedestrian.grounded && pedestrian.velocity.y > 0 && !airborne)
        launches++;
      airborne = !pedestrian.grounded;
    }
    expect(top).toBeGreaterThan(0.9);
    expect(top).toBeLessThan(1.2);
    expect(launches).toBe(1);
    expect(pedestrian.grounded).toBe(true);
    tick({ jump: false });
    tick({ jump: true }, 0, 8);
    expect(pedestrian.position.y).toBeGreaterThan(0.5);
    expect(pedestrian.grounded).toBe(false);
  });

  it("does not turn curb assist into climbing over a waist-high obstacle", () => {
    const { world, pedestrian, tick } = fixture();
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(3, 0.55, 2).setTranslation(0, 0.55, 4),
    );
    world.step();
    tick({ moveY: 1, sprint: true }, 0, 180);
    expect(pedestrian.position.z).toBeLessThan(1.72);
    expect(pedestrian.position.y).toBeLessThan(0.12);
    expect(pedestrian.grounded).toBe(true);
  });

  it("allows a short coyote jump after an edge but cannot jump indefinitely in midair", () => {
    const { world, pedestrian, tick } = fixture(false);
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(5, 0.5, 1).setTranslation(0, -0.5, 0),
    );
    world.step();
    tick({}, 0, 20);
    let count = 0;
    while (pedestrian.grounded && count++ < 90) tick({ moveY: 1 });
    expect(count).toBeLessThan(90);
    const fallenY = pedestrian.position.y;
    tick({ moveY: 1, jump: true });
    expect(pedestrian.velocity.y).toBeGreaterThan(5);
    expect(pedestrian.position.y).toBeGreaterThan(fallenY);
    tick({}, 0, 45);
    const fallSpeed = pedestrian.velocity.y;
    tick({ jump: true });
    expect(pedestrian.velocity.y).toBeLessThan(fallSpeed);
  });

  it("stops a jump under a low ceiling without tunneling through it", () => {
    const { world, pedestrian, tick } = fixture();
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(3, 0.1, 3).setTranslation(0, 2.25, 0),
    );
    world.step();
    let top = 0;
    for (let i = 0; i < 80; i++) {
      tick({ jump: i === 0 });
      top = Math.max(top, pedestrian.position.y);
    }
    expect(top + WALKING.center * 2).toBeLessThan(2.17);
    expect(pedestrian.grounded).toBe(true);
  });

  it("buffers a jump pressed just before landing without requiring a perfect frame", () => {
    const { pedestrian, tick } = fixture();
    pedestrian.place(new Vector3(0, 1.0, 0));
    let count = 0;
    while (pedestrian.position.y > 0.18 && count++ < 60) tick();
    expect(pedestrian.grounded).toBe(false);
    tick({ jump: true });
    let rebound = 0;
    for (let i = 0; i < 25; i++) {
      tick();
      rebound = Math.max(rebound, pedestrian.velocity.y);
    }
    expect(rebound).toBeGreaterThan(5.5);
    expect(pedestrian.position.y).toBeGreaterThan(0.7);
  });

  it("disables without drifting and resets a relocated capsule and its interpolation history", () => {
    const { pedestrian, tick } = fixture();
    tick({ moveY: 1, sprint: true }, 0, 30);
    pedestrian.setEnabled(false);
    const before = pedestrian.position.clone();
    tick({ moveY: 1, jump: true }, 0, 20);
    expect(pedestrian.position.equals(before)).toBe(true);
    pedestrian.place(new Vector3(4, 0.05, 9), 1);
    expect(pedestrian.previous.equals(pedestrian.position)).toBe(true);
    expect(pedestrian.velocity.length()).toBe(0);
    pedestrian.setEnabled(true);
    tick({}, 0, 20);
    expect(pedestrian.position.x).toBeCloseTo(4, 3);
    expect(pedestrian.position.z).toBeCloseTo(9, 3);
    expect(pedestrian.grounded).toBe(true);
  });
});

describe("vehicle entry/exit and foot camera clearance", () => {
  function parked() {
    const result = fixture();
    const body = result.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0.8, 0),
    );
    const collider = result.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.9, 0.35, 2.3).setCollisionGroups(0x00020003),
      body,
    );
    result.pedestrian.setEnabled(false);
    result.world.step();
    return {
      ...result,
      car: { body, collider, position: new Vector3(0, 0.8, 0) },
    };
  }

  it("prefers the left-hand driver door and falls back only when that whole side is blocked", () => {
    const { world, pedestrian, car } = parked();
    const left = findVehicleExit(world, pedestrian, car, 0)!;
    expect(left.side).toBe(1);
    expect(left.feet.x).toBeGreaterThan(1.3);
    expect(left.feet.y).toBeCloseTo(0.04, 3);
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.65, 2, 3).setTranslation(1.75, 1.9, 0),
    );
    world.step();
    const right = findVehicleExit(world, pedestrian, car, 0)!;
    expect(right.side).toBe(-1);
    expect(right.feet.x).toBeLessThan(-1.3);
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.65, 2, 3).setTranslation(-1.75, 1.9, 0),
    );
    world.step();
    expect(findVehicleExit(world, pedestrian, car, 0)).toBe(null);
  });

  it("does not offer an exit through a thin fence between the door and clear destination", () => {
    const { world, pedestrian, car } = parked();
    for (const side of [-1, 1])
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.025, 1.5, 2)
          .setTranslation(side * 1.3, 1.3, 0)
          .setCollisionGroups(0x00080008),
      );
    world.step();
    expect(findVehicleExit(world, pedestrian, car, 0)).toBe(null);
  });

  it("checks the whole exit path for low barriers, not only chest-height clearance", () => {
    const { world, pedestrian, car } = parked();
    for (const side of [-1, 1])
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.025, 0.25, 2)
          .setTranslation(side * 1.3, 0.25, 0)
          .setCollisionGroups(0x00080008),
      );
    world.step();
    expect(findVehicleExit(world, pedestrian, car, 0)).toBe(null);
  });

  it("sweeps the camera sphere before walls and honors tighter visual clearance", () => {
    const { world, pedestrian } = fixture();
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(4, 3, 0.15).setTranslation(0, 2, -2),
    );
    world.step();
    const target = new Vector3(0, 1.4, 0),
      desired = new Vector3(0, 1.8, -5);
    const camera = footCameraPosition(world, pedestrian, target, desired);
    expect(camera.z).toBeGreaterThan(-1.66);
    expect(camera.z).toBeLessThan(-1.5);
    const visual = footCameraPosition(
      world,
      pedestrian,
      target,
      desired,
      () => 0.8,
    );
    expect(visual.distanceTo(target)).toBeCloseTo(0.55, 4);
    const noTravel = footCameraPosition(world, pedestrian, target, target);
    expect(noTravel.equals(target)).toBe(true);
  });
});
