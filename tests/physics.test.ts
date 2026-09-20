import RAPIER from "@dimforge/rapier3d-compat";
import { beforeAll, describe, expect, it } from "vitest";
import { Vehicle } from "../src/vehicle";
import { FixedClock } from "../src/rules";
import { idleInput, type DriveInput } from "../src/types";

beforeAll(async () => {
  await RAPIER.init();
}, 30000);
type Sample = {
  speed: number;
  x: number;
  y: number;
  z: number;
  grounded: number;
  reserve: number;
  peak: number;
  maxZ: number;
};
function run(
  fps: number,
  duration: number,
  control: (t: number) => Partial<DriveInput>,
  wall = false,
  heading = 0,
): Sample {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(300, 0.1, 600)
      .setTranslation(0, -0.1, 250)
      .setFriction(0.8),
  );
  if (wall)
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(15, 3, 0.2)
        .setTranslation(0, 2, 95)
        .setFriction(0.3),
    );
  const car = new Vehicle(world, 1, [0, 0.83, 0], heading);
  const clock = new FixedClock();
  let tick = 0,
    peak = 0,
    maxZ = 0;
  for (let frame = 0; frame < Math.round(fps * duration); frame++)
    clock.tick(1 / fps, (dt) => {
      car.step({ ...idleInput, ...control(tick / 60) }, dt, tick / 60);
      world.step();
      car.sync();
      tick++;
      peak = Math.max(peak, car.speed);
      maxZ = Math.max(maxZ, car.position.z);
    });
  const v = car.body.linvel(),
    sample = {
      speed: Math.hypot(v.x, v.z),
      x: car.position.x,
      y: car.position.y,
      z: car.position.z,
      grounded: car.grounded,
      reserve: car.bank.value,
      peak,
      maxZ,
    };
  world.free();
  return sample;
}
const scenarios = {
  acceleration: { seconds: 7, input: () => ({ throttle: 1 }) },
  braking: {
    seconds: 10,
    input: (t: number) => (t < 6 ? { throttle: 1 } : { brake: 1 }),
  },
  turning: {
    seconds: 9,
    input: (t: number) => ({
      throttle: t < 5 ? 1 : 0.65,
      steer: t > 5 ? 0.35 : 0,
    }),
  },
  boostedCollision: {
    seconds: 10,
    input: () => ({ throttle: 1, boost: true }),
    wall: true,
  },
};
describe("actual Rapier scripted driving at a fixed 60Hz", () => {
  it("turns right for positive input and left for negative input at every cardinal heading", () => {
    for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      for (const direction of [-1, 1]) {
        const sample = run(
          60,
          4,
          (t) => ({ throttle: 1, steer: t > 2 ? direction * 0.35 : 0 }),
          false,
          heading,
        );
        // Driver/camera right is forward × up, independent of the world heading.
        const displacementRight =
          -sample.x * Math.cos(heading) + sample.z * Math.sin(heading);
        expect(displacementRight * direction).toBeGreaterThan(2);
        expect(sample.grounded).toBe(4);
      }
    }
  });
  for (const [name, scenario] of Object.entries(scenarios)) {
    it(`${name} stays stable across 30/60/120Hz rendering`, () => {
      const samples = [30, 60, 120].map((fps) =>
        run(fps, scenario.seconds, scenario.input, "wall" in scenario),
      );
      const reference = samples[1];
      for (const sample of samples) {
        // Tolerances are useful physical bounds, not a promise of cross-device determinism.
        expect(Math.abs(sample.x - reference.x)).toBeLessThan(0.15);
        expect(Math.abs(sample.z - reference.z)).toBeLessThan(0.15);
        expect(Math.abs(sample.speed - reference.speed)).toBeLessThan(0.2);
        expect(Math.abs(sample.reserve - reference.reserve)).toBeLessThan(0.1);
        expect(Number.isFinite(sample.y)).toBe(true);
        expect(sample.y).toBeGreaterThan(0.15);
        expect(sample.y).toBeLessThan(3);
      }
      if (name === "acceleration") {
        expect(reference.speed).toBeGreaterThan(25);
        expect(reference.grounded).toBe(4);
        expect(reference.z).toBeGreaterThan(80);
      }
      if (name === "braking") {
        expect(reference.peak).toBeGreaterThan(20);
        expect(reference.speed).toBeLessThan(1);
      }
      if (name === "turning") {
        expect(Math.abs(reference.x)).toBeGreaterThan(10);
        expect(reference.grounded).toBeGreaterThanOrEqual(2);
      }
      if (name === "boostedCollision") {
        expect(reference.peak).toBeGreaterThan(35);
        expect(reference.maxZ).toBeLessThan(95.3);
        expect(reference.reserve).toBeLessThan(65);
      }
    });
  }
  it("gives proportional throttle and real extra boost acceleration", () => {
    const half = run(60, 4, () => ({ throttle: 0.5 }));
    const full = run(60, 4, () => ({ throttle: 1 }));
    const boosted = run(60, 4, () => ({ throttle: 1, boost: true }));
    expect(full.speed).toBeGreaterThan(half.speed * 1.4);
    expect(boosted.speed).toBeGreaterThan(full.speed + 8);
  });
});
