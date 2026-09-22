import RAPIER from "@dimforge/rapier3d-compat";
import { PerspectiveCamera, Vector3 } from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { FootCameraOrbit } from "../src/foot-camera";
import { footCameraPosition, Pedestrian } from "../src/pedestrian";
import { angleDiff } from "../src/types";

const idle = { lookX: 0, lookY: 0, mouseX: 0, mouseY: 0 };
const target = new Vector3(8, 1.2, -12);

function view(position: Vector3, at = target) {
  const camera = new PerspectiveCamera();
  camera.position.copy(position);
  camera.lookAt(at);
  camera.updateMatrixWorld(true);
  const forward = camera.getWorldDirection(new Vector3());
  const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  return { camera, forward, right };
}

beforeAll(async () => {
  await RAPIER.init();
});

describe("walking camera orbit", () => {
  it("recenters through a half turn around the actor without collapsing the boom", () => {
    const orbit = new FootCameraOrbit();
    const distance = orbit.position(target, 0).distanceTo(target);
    orbit.recenter(Math.PI);
    let previousError = Math.PI;
    for (let i = 0; i < 60; i++) {
      orbit.updateLook(idle, 1 / 60);
      const position = orbit.position(target, 1 / 60);
      expect(position.distanceTo(target)).toBeCloseTo(distance, 10);
      const { forward } = view(position);
      const visibleYaw = Math.atan2(forward.x, forward.z);
      // Physics receives this same effective yaw, including during the turn.
      expect(Math.abs(angleDiff(visibleYaw, orbit.yaw))).toBeLessThan(1e-10);
      const error = Math.abs(angleDiff(Math.PI, orbit.yaw));
      expect(error).toBeLessThanOrEqual(previousError);
      previousError = error;
      if (i === 0) {
        expect(orbit.yaw).toBeGreaterThan(0);
        expect(orbit.yaw).toBeLessThan(Math.PI / 4);
      }
    }
    expect(previousError).toBeLessThan(0.001);
  });

  it("recenters across the angle seam by the short arc at any frame rate", () => {
    function simulate(dt: number) {
      const orbit = new FootCameraOrbit();
      orbit.reset((179 * Math.PI) / 180);
      orbit.recenter((-179 * Math.PI) / 180);
      for (let t = 0; t < 0.5 - 1e-8; t += dt) {
        const before = orbit.yaw;
        orbit.updateLook(idle, dt);
        expect(Math.abs(angleDiff(orbit.yaw, before))).toBeLessThan(0.035);
      }
      return orbit.yaw;
    }
    expect(simulate(1 / 30)).toBeCloseTo(simulate(1 / 120), 10);
  });

  it.each([
    { lookX: 1, mouseX: 0 },
    { lookX: 0, mouseX: 160 },
  ])("turns the displayed view right for rightward look input %j", (input) => {
    const orbit = new FootCameraOrbit();
    const before = view(orbit.position(target, 0));
    orbit.updateLook({ ...idle, ...input }, 0.1);
    const after = view(orbit.position(target, 0.1));
    expect(after.forward.dot(before.right)).toBeGreaterThan(0.2);
    expect(
      Math.abs(
        angleDiff(Math.atan2(after.forward.x, after.forward.z), orbit.yaw),
      ),
    ).toBeLessThan(1e-10);
  });

  it("tilts down for stick-down/mouse-down and accepts direct look over recentering", () => {
    const orbit = new FootCameraOrbit();
    const before = view(orbit.position(target, 0));
    orbit.recenter(Math.PI);
    orbit.updateLook({ ...idle, lookY: 1, mouseY: 80, mouseX: 40 }, 0.1);
    const after = view(orbit.position(target, 0.1));
    expect(after.forward.y).toBeLessThan(before.forward.y);
    expect(orbit.yaw).toBeCloseTo(-0.1);
    const yaw = orbit.yaw,
      pitch = orbit.pitch;
    orbit.updateLook(idle, 0.1);
    expect(orbit.yaw).toBe(yaw);
    expect(orbit.pitch).toBe(pitch);
  });

  it("handles a large mouse turn immediately without taking a chord through the actor", () => {
    const orbit = new FootCameraOrbit();
    const before = view(orbit.position(target, 0));
    const distance = before.camera.position.distanceTo(target);
    orbit.updateLook({ ...idle, mouseX: Math.PI / 0.0025 }, 1 / 60);
    const after = view(orbit.position(target, 1 / 60));
    expect(after.camera.position.distanceTo(target)).toBeCloseTo(distance, 10);
    expect(
      after.forward
        .clone()
        .setY(0)
        .normalize()
        .dot(before.forward.clone().setY(0).normalize()),
    ).toBeCloseTo(-1, 10);
  });

  it("retracts before an obstruction immediately and extends without changing the view basis", () => {
    const orbit = new FootCameraOrbit();
    const normalDistance = orbit.position(target, 0).distanceTo(target);
    let clearance = 1;
    const clear = (desired: Vector3) =>
      target.clone().add(desired.clone().sub(target).clampLength(0, clearance));
    expect(
      orbit.position(target, 1 / 60, clear).distanceTo(target),
    ).toBeCloseTo(1, 10);
    orbit.updateLook({ ...idle, lookX: 1 }, 0.1);
    clearance = 0.45;
    const tight = orbit.position(target, 1 / 60, clear);
    expect(tight.distanceTo(target)).toBeCloseTo(0.45, 10);
    clearance = Infinity;
    let last = 0.45;
    for (let i = 0; i < 90; i++) {
      const position = orbit.position(target, 1 / 60, clear);
      const distance = position.distanceTo(target);
      expect(distance).toBeGreaterThan(last);
      expect(distance).toBeLessThanOrEqual(normalDistance + 1e-10);
      const { forward } = view(position);
      expect(
        Math.abs(angleDiff(Math.atan2(forward.x, forward.z), orbit.yaw)),
      ).toBeLessThan(1e-10);
      if (i === 0) expect(distance).toBeLessThan(1.1);
      last = distance;
    }
    expect(last).toBeCloseTo(normalDistance, 3);
  });

  it("begins from the existing car camera and settles into walking distance without a position cut", () => {
    const orbit = new FootCameraOrbit();
    const start = target.clone().add(new Vector3(3.2, 2.4, -7.1));
    orbit.begin(start, target, 0);
    expect(orbit.position(target, 0).distanceTo(start)).toBeLessThan(1e-10);
    const first = orbit.position(target, 1 / 60);
    expect(first.distanceTo(start)).toBeLessThan(0.4);
    expect(first.distanceTo(start)).toBeGreaterThan(0);
    const { forward } = view(first);
    expect(
      Math.abs(angleDiff(Math.atan2(forward.x, forward.z), orbit.yaw)),
    ).toBeLessThan(1e-10);
    for (let i = 0; i < 180; i++) orbit.position(target, 1 / 60);
    const settled = orbit.position(target, 0).distanceTo(target);
    expect(settled).toBeGreaterThan(4.5);
    expect(settled).toBeLessThan(4.9);
  });

  it("checks the current orbit ray against real wall geometry on each turn", () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(5, 3, 0.2).setTranslation(0, 2, -2),
    );
    const pedestrian = new Pedestrian(world);
    const orbit = new FootCameraOrbit();
    const at = new Vector3(0, 1.2, 0);
    const clear = (desired: Vector3) =>
      footCameraPosition(world, pedestrian, at, desired);
    try {
      world.step();
      const blocked = orbit.position(at, 1 / 60, clear);
      expect(blocked.z).toBeGreaterThan(-1.61);
      expect(blocked.distanceTo(at)).toBeLessThan(2);
      orbit.updateLook({ ...idle, mouseX: Math.PI / 2 / 0.0025 }, 1 / 60);
      const firstClear = orbit.position(at, 1 / 60, clear);
      expect(firstClear.x).toBeGreaterThan(0);
      expect(Math.abs(firstClear.z)).toBeLessThan(1e-10);
      expect(firstClear.distanceTo(at)).toBeGreaterThan(blocked.distanceTo(at));
      expect(firstClear.distanceTo(at)).toBeLessThan(2.3);
      for (let i = 0; i < 90; i++) orbit.position(at, 1 / 60, clear);
      orbit.updateLook({ ...idle, mouseX: -Math.PI / 2 / 0.0025 }, 1 / 60);
      const blockedAgain = orbit.position(at, 1 / 60, clear);
      expect(blockedAgain.distanceTo(blocked)).toBeLessThan(0.001);
    } finally {
      pedestrian.dispose();
      world.free();
    }
  });

  it("freezes recentering and outward boom recovery while paused", () => {
    const orbit = new FootCameraOrbit();
    const tight = orbit.position(target, 1 / 60, (desired) =>
      target.clone().add(desired.clone().sub(target).setLength(0.5)),
    );
    orbit.recenter(Math.PI);
    for (let i = 0; i < 60; i++) {
      orbit.updateLook(idle, 0);
      expect(orbit.yaw).toBe(0);
      expect(orbit.position(target, 0).distanceTo(tight)).toBeLessThan(1e-10);
    }
    orbit.updateLook(idle, 1 / 60);
    expect(orbit.yaw).toBeGreaterThan(0);
    expect(orbit.position(target, 1 / 60).distanceTo(target)).toBeGreaterThan(
      0.5,
    );
  });

  it.each([0, Math.PI / 2, Math.PI, -Math.PI / 2])(
    "moves the actual pedestrian forward/right in the rendered view at yaw %f",
    (yaw) => {
      const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
      world.timestep = 1 / 60;
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(20, 0.5, 20).setTranslation(0, -0.5, 0),
      );
      const pedestrian = new Pedestrian(world);
      const orbit = new FootCameraOrbit();
      orbit.reset(yaw);
      try {
        pedestrian.setEnabled(true);
        for (const [moveX, moveY, basis] of [
          [0, 1, "forward"],
          [1, 0, "right"],
        ] as const) {
          pedestrian.place(new Vector3(0, 0.04, 0));
          world.step();
          for (let i = 0; i < 90; i++) {
            pedestrian.step(
              { moveX, moveY, sprint: false, jump: false },
              orbit.yaw,
              1 / 60,
            );
            world.step();
          }
          const at = pedestrian.position.clone().add(new Vector3(0, 1.2, 0));
          const displayed = view(orbit.position(at, 1 / 60), at);
          const direction = displayed[basis].clone().setY(0).normalize();
          const travel = pedestrian.position.clone().setY(0);
          expect(travel.length()).toBeGreaterThan(3.4);
          expect(travel.normalize().dot(direction)).toBeGreaterThan(0.999);
        }
      } finally {
        pedestrian.dispose();
        world.free();
      }
    },
  );
});
