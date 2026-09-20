import { beforeAll, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { Vehicle } from "../src/vehicle";
import { idleInput } from "../src/types";
beforeAll(async () => {
  await RAPIER.init();
});
it.each(["barrier", "traffic"])(
  "CCD resolves a 70m/s boost-ceiling impact with %s",
  (kind) => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = 1 / 60;
    world.integrationParameters.maxCcdSubsteps = 4;
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(100, 0.1, 100).setTranslation(0, -0.1, 50),
    );
    const player = new Vehicle(world, 0, [0, 0.83, 0]);
    const traffic =
      kind === "traffic" ? new Vehicle(world, 1, [0, 0.83, 15]) : null;
    if (!traffic)
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(10, 3, 0.15).setTranslation(0, 2, 15),
      );
    world.step();
    player.sync();
    traffic?.sync();
    // Explicit initial condition at the configured boost speed ceiling, not a claimed acceleration measurement.
    player.body.setLinvel({ x: 0, y: 0, z: 70 }, true);
    let maximumZ = 0;
    for (let step = 0; step < 30; step++) {
      player.step(idleInput, 1 / 60, step / 60);
      traffic?.step(idleInput, 1 / 60, step / 60);
      world.step();
      player.sync();
      traffic?.sync();
      maximumZ = Math.max(maximumZ, player.position.z);
      expect(Number.isFinite(player.position.y)).toBe(true);
      if (traffic)
        expect(player.position.z).toBeLessThan(traffic.position.z - 3.8);
    }
    if (!traffic) expect(maximumZ).toBeLessThan(12.9);
    else expect(traffic.position.z).toBeGreaterThan(20);
    expect(player.speed).toBeLessThan(69);
    world.free();
  },
);
