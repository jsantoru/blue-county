import { readFileSync, writeFileSync } from "node:fs";
import RAPIER from "@dimforge/rapier3d-compat";
import { beforeAll, expect, it } from "vitest";
import { Driver } from "../src/ai";
import { Vehicle } from "../src/vehicle";
import { RaceProgress } from "../src/rules";
import {
  heightAt,
  roadMesh,
  roadJoins,
  type HeightSampler,
} from "../src/roads";
import type { MapData, Point } from "../src/types";

beforeAll(async () => {
  await RAPIER.init();
}, 30000);
const map: MapData = JSON.parse(
  readFileSync(new URL("../public/map/warwick.json", import.meta.url), "utf8"),
);
function mappedWorld() {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  world.integrationParameters.maxCcdSubsteps = 4;
  const g = map.terrain!,
    b = map.bounds,
    verts: number[] = [],
    indices: number[] = [];
  for (let j = 0; j < g.rows; j++)
    for (let i = 0; i < g.cols; i++) {
      const x = b.minX + ((b.maxX - b.minX) * i) / (g.cols - 1),
        z = b.minZ + ((b.maxZ - b.minZ) * j) / (g.rows - 1);
      verts.push(x, heightAt(map, x, z) - 0.03, z);
      if (i < g.cols - 1 && j < g.rows - 1) {
        const a = j * g.cols + i;
        indices.push(a, a + g.cols, a + 1, a + 1, a + g.cols, a + g.cols + 1);
      }
    }
  if (process.env.AI_GEOMETRY !== "roads")
    world.createCollider(
      RAPIER.ColliderDesc.trimesh(
        new Float32Array(verts),
        new Uint32Array(indices),
      ).setFriction(0.75),
    );
  const sampler: HeightSampler = Object.assign(
    (x: number, z: number) => heightAt(map, x, z),
    { terrain: map.terrain },
  );
  for (const road of map.roads) {
    for (const make of [roadMesh, roadJoins]) {
      const mesh = make(
        road.points,
        road.width,
        0,
        0.065,
        road.bridge ? undefined : sampler,
      );
      const positions = mesh.geometry.getAttribute("position").array;
      if (process.env.AI_GEOMETRY !== "terrain")
        world.createCollider(
          RAPIER.ColliderDesc.trimesh(
            new Float32Array(positions),
            new Uint32Array(positions.length / 3).map((_, i) => i),
          ).setFriction(0.75),
        );
      mesh.geometry.dispose();
    }
  }
  for (const building of map.buildings || []) {
    const points: Point[] = building.points || building.footprint;
    if (!points?.length) continue;
    const xs = points.map((p) => p[0]),
      zs = points.map((p) => p[2]),
      x = (Math.min(...xs) + Math.max(...xs)) / 2,
      z = (Math.min(...zs) + Math.max(...zs)) / 2;
    const w = Math.max(4, Math.max(...xs) - Math.min(...xs)),
      d = Math.max(4, Math.max(...zs) - Math.min(...zs)),
      h = building.height || 4.2;
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2)
        .setTranslation(x, heightAt(map, x, z) + h / 2, z)
        .setFriction(0.28),
    );
  }
  return world;
}

it("keeps civilian traffic on the physical right of its travel direction", () => {
  for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = 1 / 60;
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(300, 0.1, 300).setTranslation(0, -0.1, 0),
    );
    const car = new Vehicle(world, 1, [0, 0.83, 0], heading),
      path: Point[] = [
        [0, 0, 0],
        [Math.sin(heading) * 250, 0, Math.cos(heading) * 250],
      ],
      driver = new Driver(car, path, true);
    for (let tick = 0; tick < 12 * 60; tick++) {
      car.step(driver.input(1 / 60), 1 / 60, tick / 60);
      world.step();
      car.sync();
    }
    const forwardDistance =
        car.position.x * Math.sin(heading) + car.position.z * Math.cos(heading),
      distanceRight =
        -car.position.x * Math.cos(heading) +
        car.position.z * Math.sin(heading);
    expect(forwardDistance).toBeGreaterThan(80);
    expect(distanceRight).toBeGreaterThan(2);
    expect(distanceRight).toBeLessThan(2.8);
    world.free();
  }
});

it("drives all ordered checkpoints over three laps on the cached Warwick collision geometry", () => {
  const world = mappedWorld(),
    points = map.route.points,
    p = points[0],
    b = points[1],
    heading = Math.atan2(b[0] - p[0], b[2] - p[2]);
  const v = new Vehicle(world, 1, [p[0], p[1] + 0.85, p[2]], heading),
    driver = new Driver(v, points),
    race = new RaceProgress(points, 3, true);
  let lastProgress = 0,
    recoveries = 0,
    t = 0,
    minGrounded = 4,
    maxSpeed = 0;
  const gates: any[] = [];
  const duration = Number(process.env.AI_DURATION || 2200);
  for (let step = 0; step < duration * 60 && !race.finished; step++) {
    t = step / 60;
    const input = driver.input(1 / 60);
    v.step(input, 1 / 60, t, true);
    world.step();
    v.sync();
    maxSpeed = Math.max(maxSpeed, v.speed);
    minGrounded = Math.min(minGrounded, v.grounded);
    if (race.update([v.position.x, v.position.y, v.position.z], 1 / 60)) {
      lastProgress = t;
      gates.push({
        t,
        lap: race.lap,
        next: race.next,
        target: driver.target,
        speed: v.speed,
        position: v.position.toArray(),
      });
    }
    if (driver.stuck > 4) {
      const idx = Math.max(0, race.next - 1),
        p: Point = [...points[idx]],
        next = points[Math.min(idx + 1, points.length - 1)],
        heading = Math.atan2(next[0] - p[0], next[2] - p[2]);
      p[0] += Math.cos(heading) * 2;
      p[2] -= Math.sin(heading) * 2;
      race.recovered(p);
      v.reset(p, heading);
      driver.target = Math.max(1, race.next);
      driver.stuck = 0;
      recoveries++;
    }
    if (t - lastProgress > 100) break;
  }
  const report = {
    finished: race.finished,
    seconds: t,
    next: race.next,
    lap: race.lap,
    target: driver.target,
    position: v.position.toArray(),
    rotation: v.rotation.toArray(),
    command: driver.input(0),
    grounded: v.grounded,
    speed: v.speed,
    recoveries,
    minGrounded,
    maxSpeed,
    gates,
  };
  if (process.env.AI_REPORT)
    writeFileSync(process.env.AI_REPORT, JSON.stringify(report, null, 2));
  console.log("ROUTE_QA", JSON.stringify({ ...report, gates: undefined }));
  world.free();
  expect(race.finished).toBe(true);
  expect(race.crossings).toBe((points.length - 1) * 3);
  expect(recoveries).toBe(0);
}, 120000);

it("finishes four physical racers with three civilian cars and fair recovery", () => {
  const world = mappedWorld(),
    points = map.route.points,
    p = points[0],
    b = points[1],
    heading = Math.atan2(b[0] - p[0], b[2] - p[2]);
  const cars: Vehicle[] = [],
    drivers: Driver[] = [],
    races: RaceProgress[] = [],
    recoveries: number[] = [],
    finishedAt: number[] = [];
  for (let i = 0; i < 7; i++) {
    let spawn: Point,
      angle: number,
      index = 0;
    if (i < 4) {
      const back = 4 + Math.floor(i / 2) * 7,
        side = i % 2 ? 2 : -2;
      spawn = [
        p[0] - Math.sin(heading) * back + Math.cos(heading) * side,
        0,
        p[2] - Math.cos(heading) * back - Math.sin(heading) * side,
      ];
      angle = heading;
      spawn[1] = heightAt(map, spawn[0], spawn[2]);
    } else {
      index = Math.min(points.length - 2, Math.floor(points.length * 0.13 * i));
      spawn = [...points[index]];
      const next = points[index + 1];
      angle = Math.atan2(next[0] - spawn[0], next[2] - spawn[2]);
    }
    const car = new Vehicle(
        world,
        i,
        [spawn[0], spawn[1] + 0.85, spawn[2]],
        angle,
      ),
      driver = new Driver(car, points, i > 3);
    driver.target = index + 1;
    driver.speed = i === 0 ? 25 : i > 3 ? 12 + (i % 3) : 22 + i * 1.3;
    cars.push(car);
    drivers.push(driver);
    recoveries.push(0);
    finishedAt.push(0);
    if (i < 4) {
      const r = new RaceProgress(points, 3, true);
      r.reset();
      races.push(r);
    }
  }
  let t = 0;
  for (
    let step = 0;
    step < 900 * 60 && !races.every((r) => r.finished);
    step++
  ) {
    t = step / 60;
    for (let i = 0; i < cars.length; i++)
      cars[i].step(
        races[i]?.finished
          ? { steer: 0, throttle: 0, brake: 1, boost: false, handbrake: false }
          : drivers[i].input(1 / 60),
        1 / 60,
        t,
        true,
      );
    world.step();
    cars.forEach((car) => car.sync());
    for (let i = 0; i < 4; i++) {
      const car = cars[i],
        race = races[i],
        driver = drivers[i];
      const wasFinished = race.finished;
      race.update([car.position.x, car.position.y, car.position.z], 1 / 60);
      if (!wasFinished && race.finished) finishedAt[i] = t;
      if (driver.stuck > 4 && !race.finished) {
        const idx = Math.max(0, race.next - 1),
          spawn: Point = [...points[idx]],
          next = points[Math.min(idx + 1, points.length - 1)],
          angle = Math.atan2(next[0] - spawn[0], next[2] - spawn[2]);
        spawn[0] += Math.cos(angle) * (i % 2 ? 2 : -2);
        spawn[2] -= Math.sin(angle) * (i % 2 ? 2 : -2);
        race.recovered(spawn);
        car.reset(spawn, angle);
        driver.target = Math.max(1, race.next);
        driver.stuck = 0;
        recoveries[i]++;
      }
    }
  }
  const report = {
    seconds: t,
    cars: races.map((race, i) => ({
      id: i,
      finished: race.finished,
      next: race.next,
      lap: race.lap,
      crossings: race.crossings,
      finishedAt: finishedAt[i],
      recoveries: recoveries[i],
      position: cars[i].position.toArray(),
      driverTarget: drivers[i].target,
      speed: cars[i].speed,
    })),
  };
  if (process.env.AI_REPORT)
    writeFileSync(
      process.env.AI_REPORT.replace(".json", "-traffic.json"),
      JSON.stringify(report, null, 2),
    );
  console.log("TRAFFIC_ROUTE_QA", JSON.stringify(report));
  world.free();
  for (const race of races) {
    expect(race.finished).toBe(true);
    expect(race.crossings).toBe((points.length - 1) * 3);
  }
  for (const count of recoveries.slice(0, 4)) expect(count).toBeLessThan(5);
}, 120000);
