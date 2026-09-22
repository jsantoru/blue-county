import RAPIER from "@dimforge/rapier3d-compat";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  configureVehicleGeometry,
  createVehicleGeometry,
  Vehicle,
  vehicleGeometry,
  WHEELS,
} from "../src/vehicle";
import { idleInput } from "../src/types";

function manifest(scale = 1) {
  return {
    wheels: [
      {
        center: [0.75 * scale, 0.345 * scale, 1.43 * scale],
        radius: 0.345 * scale,
      },
      {
        center: [-0.75 * scale, 0.345 * scale, 1.43 * scale],
        radius: 0.345 * scale,
      },
      {
        center: [0.75 * scale, 0.345 * scale, -1.415 * scale],
        radius: 0.345 * scale,
      },
      {
        center: [-0.75 * scale, 0.345 * scale, -1.415 * scale],
        radius: 0.345 * scale,
      },
    ],
    runtimeIntegration: {
      visualOffsetFromChassis: [0, -0.78, 0],
      chassisColliderHalfExtents: [0.9 * scale, 0.31, 2.3 * scale],
      chassisColliderCenterOffset: [0, 0.04, 0],
      wheelRayMountY: 0.1,
      wheelRayLength: 1.05,
      springRestRayLength: 1,
    },
  };
}

const initial = {
  wheels: WHEELS.map((center, index) => ({
    center: [...center],
    radius: vehicleGeometry.wheelRadii[index],
  })),
  runtimeIntegration: {
    visualOffsetFromChassis: [0, vehicleGeometry.visualOffsetY, 0],
    chassisColliderHalfExtents: [...vehicleGeometry.chassisHalfExtents],
    chassisColliderCenterOffset: [...vehicleGeometry.chassisCenter],
    wheelRayMountY: WHEELS[0][1],
    wheelRayLength: vehicleGeometry.wheelRayLength,
    springRestRayLength: vehicleGeometry.springRestRayLength,
  },
};
const worlds: RAPIER.World[] = [];
beforeAll(async () => {
  await RAPIER.init();
});
afterEach(() => {
  worlds.splice(0).forEach((world) => world.free());
  configureVehicleGeometry(initial);
});
function worldWithGround() {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(100, 0.5, 300).setTranslation(0, -0.5, 200),
  );
  worlds.push(world);
  return world;
}

describe("per-vehicle authored geometry", () => {
  it("validates and freezes independent copies of wheel and collider coordinates", () => {
    const source = manifest(1.15);
    source.wheels[2].radius = source.wheels[3].radius = 0.43;
    const geometry = createVehicleGeometry(source);
    expect(geometry.wheels[0][0]).toBeCloseTo(0.8625);
    expect(geometry.wheels[0][1]).toBe(0.1);
    expect(geometry.wheels[0][2]).toBeCloseTo(1.6445);
    expect(geometry.wheelRadii[0]).toBeCloseTo(0.39675);
    expect(geometry.wheelRadii[1]).toBeCloseTo(0.39675);
    expect(geometry.wheelRadii.slice(2)).toEqual([0.43, 0.43]);
    expect(geometry.resetHeight).toBeCloseTo(0.83);
    source.wheels[0].center[0] = 50;
    source.wheels[2].radius = 10;
    source.runtimeIntegration.chassisColliderHalfExtents[0] = 50;
    expect(geometry.wheels[0][0]).toBeCloseTo(0.8625);
    expect(geometry.wheelRadii[2]).toBe(0.43);
    expect(geometry.chassisHalfExtents[0]).toBeCloseTo(1.035);
    expect(Object.isFrozen(geometry)).toBe(true);
    expect(Object.isFrozen(geometry.wheels)).toBe(true);
    expect(Object.isFrozen(geometry.wheels[0])).toBe(true);
    expect(Object.isFrozen(geometry.wheelRadii)).toBe(true);
    expect(Object.isFrozen(geometry.chassisHalfExtents)).toBe(true);
  });

  it.each([
    (source: ReturnType<typeof manifest>) => source.wheels.pop(),
    (source: ReturnType<typeof manifest>) => {
      source.wheels[0].center[2] = NaN;
    },
    (source: ReturnType<typeof manifest>) => {
      source.wheels[0].radius = 0;
    },
    (source: ReturnType<typeof manifest>) => {
      source.runtimeIntegration.visualOffsetFromChassis[1] = Infinity;
    },
    (source: ReturnType<typeof manifest>) => {
      source.runtimeIntegration.chassisColliderHalfExtents[0] = -1;
    },
    (source: ReturnType<typeof manifest>) => {
      source.runtimeIntegration.wheelRayLength = 0;
    },
  ])(
    "rejects malformed geometry without partially changing legacy defaults (%#)",
    (invalidate) => {
      configureVehicleGeometry(manifest());
      const before = JSON.stringify(vehicleGeometry);
      const source = manifest(1.15);
      invalidate(source);
      expect(() => createVehicleGeometry(source)).toThrow();
      expect(() => configureVehicleGeometry(source)).toThrow();
      expect(JSON.stringify(vehicleGeometry)).toBe(before);
    },
  );

  it("does not change existing or future default traffic when a selected car has different geometry", () => {
    const world = worldWithGround();
    configureVehicleGeometry(manifest());
    const traffic = new Vehicle(world, 1, [-15, 0.83, 0]);
    const source = manifest(1.2);
    const selected = new Vehicle(
      world,
      0,
      [0, 0.83, 0],
      0,
      createVehicleGeometry(source),
    );
    const laterTraffic = new Vehicle(world, 2, [15, 0.83, 0]);
    expect(selected.geometry.wheels[0][0]).toBeCloseTo(0.9);
    expect(traffic.geometry.wheels[0][0]).toBe(0.75);
    expect(laterTraffic.geometry).toEqual(traffic.geometry);
    expect(selected.collider.halfExtents().z).toBeCloseTo(2.76);
    expect(traffic.collider.halfExtents().z).toBeCloseTo(2.3);
    configureVehicleGeometry(manifest(1.4));
    expect(traffic.geometry.wheels[0][0]).toBe(0.75);
    expect(selected.geometry.wheels[0][0]).toBeCloseTo(0.9);
    const futureDefault = new Vehicle(world, 3, [30, 0.83, 0]);
    expect(futureDefault.geometry.wheels[0][0]).toBeCloseTo(1.05);
  });

  it("keeps an existing AI vehicle's driving identical after global defaults change", () => {
    function run(changeDefaults: boolean) {
      configureVehicleGeometry(manifest());
      const world = worldWithGround();
      const car = new Vehicle(world, 1, [0, 0.83, 0]);
      for (let tick = 0; tick < 240; tick++) {
        if (changeDefaults && tick === 60)
          configureVehicleGeometry(manifest(1.25));
        car.step(
          { ...idleInput, throttle: 0.7, steer: tick > 120 ? 0.2 : 0 },
          1 / 60,
          tick / 60,
        );
        world.step();
        car.sync();
      }
      expect(car.grounded).toBe(4);
      return [
        ...car.position.toArray(),
        car.speed,
        car.wheelSpin,
        ...car.wheelHeights,
      ];
    }
    const expected = run(false);
    const actual = run(true);
    actual.forEach((value, index) =>
      expect(value).toBeCloseTo(expected[index], 8),
    );
  });

  it("casts suspension rays at each car's own track width and wheelbase", () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    worlds.push(world);
    const cars = [1, 1.25].map((scale, index) => {
      const geometry = createVehicleGeometry(manifest(scale));
      const x = index * 20 - 10;
      // Narrow individual contact pads reveal any accidental use of another
      // car's axle locations; there is deliberately no continuous ground plane.
      geometry.wheels.forEach((wheel) =>
        world.createCollider(
          RAPIER.ColliderDesc.cuboid(0.08, 0.2, 0.08).setTranslation(
            x + wheel[0],
            -0.2,
            wheel[2],
          ),
        ),
      );
      return new Vehicle(world, index, [x, 0.83, 0], 0, geometry);
    });
    world.step();
    cars.forEach((car) => {
      car.step(idleInput, 1 / 60, 0);
      expect(car.grounded).toBe(4);
    });
  });

  it("grounds, resets and drives two distinct chassis and per-wheel tire radii together", () => {
    const world = worldWithGround();
    const small = manifest();
    const large = manifest(1.2);
    large.wheels[2].radius = large.wheels[3].radius = 0.43;
    large.runtimeIntegration.chassisColliderCenterOffset = [0.03, 0.07, -0.08];
    const cars = [small, large].map(
      (source, index) =>
        new Vehicle(
          world,
          index,
          [index * 12 - 6, 0.83, 0],
          0,
          createVehicleGeometry(source),
        ),
    );
    cars.forEach((car, index) => car.reset([index * 12 - 6, 0, 0], 0));
    for (let tick = 0; tick < 120; tick++) {
      cars.forEach((car) => car.step(idleInput, 1 / 60, tick / 60));
      world.step();
      cars.forEach((car) => car.sync());
    }
    for (const car of cars) {
      expect(car.grounded).toBe(4);
      expect(car.position.y).toBeGreaterThan(0.7);
      expect(car.position.y).toBeLessThan(0.9);
      car.wheelHeights.forEach((height, index) =>
        expect(
          car.position.y + car.geometry.visualOffsetY + height,
        ).toBeCloseTo(car.geometry.wheelRadii[index], 2),
      );
      const center = car.collider.translationWrtParent()!;
      [center.x, center.y, center.z].forEach((n, i) =>
        expect(n).toBeCloseTo(car.geometry.chassisCenter[i], 6),
      );
    }
    for (let tick = 120; tick < 360; tick++) {
      cars.forEach((car) =>
        car.step({ ...idleInput, throttle: 0.6 }, 1 / 60, tick / 60),
      );
      world.step();
      cars.forEach((car) => car.sync());
    }
    cars.forEach((car) => {
      expect(car.grounded).toBe(4);
      expect(car.position.z).toBeGreaterThan(20);
      expect(car.speed).toBeGreaterThan(10);
      expect(car.position.toArray().every(Number.isFinite)).toBe(true);
    });
  });
});
