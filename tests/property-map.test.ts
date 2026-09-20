import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import * as T from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  Environment,
  groundPolygonMesh,
  heightAt,
  nearestRoad,
} from "../src/roads";
import { buildNeighborhood } from "../src/neighborhood";
import {
  createDrivewayQuery,
  createPropertyClearance,
  polygonDistance,
} from "../src/property-footprints";
import type { MapData } from "../src/types";

const map: MapData = JSON.parse(
  readFileSync(new URL("../public/map/warwick.json", import.meta.url), "utf8"),
);

it("keeps number 28's observed terrace outside the real house colliders and shares one wing entrance", async () => {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  // Exercise the real envelope/collider builder without loading the full town.
  const environment = Object.assign(Object.create(Environment.prototype), {
    map,
    world,
    houses: [],
    colliders: [],
  });
  const building = map.buildings!.find((b) => b.id === "nys-7159159");
  environment.house(building, 0);
  expect(environment.houses).toHaveLength(2);
  const [crossbar, stem] = environment.houses;
  expect(crossbar.base).toBe(stem.base);
  // This measured point lies in the exposed terrace, previously inside the
  // single oversized house box. It must stay accessible at wall height.
  const terracePoint = { x: -198.953, y: stem.base + 1, z: -265.851 };
  expect(
    environment.colliders.every(
      (c: RAPIER.Collider) => !c.containsPoint(terracePoint),
    ),
  ).toBe(true);
  for (const house of environment.houses)
    expect(
      environment.colliders.some((c: RAPIER.Collider) =>
        c.containsPoint({ x: house.x, y: house.base + 1, z: house.z }),
      ),
    ).toBe(true);
  const group = buildNeighborhood(environment.houses, {
    heightAt: (x, z) => heightAt(map, x, z),
    roadClearance: () => 100,
  });
  const facades = group.userData.referenceFacades;
  expect(facades).toHaveLength(2);
  expect(facades[0].entryAccess).toBeNull();
  expect(facades[0].porch).toBe(false);
  expect(facades[1].entryAccess).not.toBeNull();
  expect(facades[0].colors).toEqual(facades[1].colors);
  const materials = new Set<T.Material>();
  group.traverse((object) => {
    if (!(object instanceof T.Mesh)) return;
    object.geometry.dispose();
    for (const material of Array.isArray(object.material)
      ? object.material
      : [object.material])
      materials.add(material);
  });
  materials.forEach((material) => material.dispose());
  world.free();
});

it("drapes a concave parking apron onto the exact terrain without filling its missing corner", () => {
  const fixture = {
    ...map,
    terrain: {
      cols: 3,
      rows: 3,
      minX: 0,
      maxX: 12,
      minZ: 0,
      maxZ: 12,
      heights: [0, 2, 1, 1, 0, 3, 2, 4, 0],
    },
  };
  const outline: [number, number][] = [
    [1, 1],
    [11, 1],
    [11, 4],
    [5, 4],
    [5, 11],
    [1, 11],
  ];
  const sample = Object.assign(
    (x: number, z: number) => heightAt(fixture, x, z),
    { terrain: fixture.terrain },
  );
  const mesh = groundPolygonMesh(outline, 0x777777, 0.082, sample);
  const positions = mesh.geometry.getAttribute("position"),
    normals = mesh.geometry.getAttribute("normal");
  let area = 0;
  for (let i = 0; i < positions.count; i++) {
    expect(positions.getY(i)).toBeCloseTo(
      sample(positions.getX(i), positions.getZ(i)) + 0.082,
      5,
    );
    expect(normals.getY(i)).toBeGreaterThan(0);
  }
  for (let i = 0; i < positions.count; i += 3) {
    const a = new T.Vector3().fromBufferAttribute(positions, i),
      b = new T.Vector3().fromBufferAttribute(positions, i + 1),
      c = new T.Vector3().fromBufferAttribute(positions, i + 2);
    area += Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) / 2;
    expect(
      polygonDistance((a.x + b.x + c.x) / 3, (a.z + b.z + c.z) / 3, outline),
    ).toBeLessThan(0.00001);
  }
  expect(area).toBeCloseTo(58, 5);
  mesh.geometry.dispose();
  (mesh.material as T.Material).dispose();
});

it("keeps the Home chassis and departure centerline on connected pavement", () => {
  const paved = createDrivewayQuery(map),
    p = map.home.position,
    heading = map.home.heading;
  // Full 442 footprint, not only its center: 5.2m long and 2.1m wide.
  for (const longitudinal of [-2.6, 0, 2.6])
    for (const lateral of [-1.05, 0, 1.05]) {
      const x =
        p[0] + Math.sin(heading) * longitudinal + Math.cos(heading) * lateral;
      const z =
        p[2] + Math.cos(heading) * longitudinal - Math.sin(heading) * lateral;
      expect(paved(x, z), `Home chassis corner ${x},${z}`).toBe(true);
    }
  const departure = map.home.departurePath!;
  expect(departure.length).toBeGreaterThan(5);
  for (let i = 1; i < departure.length; i++) {
    const a = departure[i - 1],
      b = departure[i],
      length = Math.hypot(b[0] - a[0], b[2] - a[2]);
    for (let d = 0; d <= length; d += 0.4) {
      const t = d / length,
        x = a[0] + (b[0] - a[0]) * t,
        z = a[2] + (b[2] - a[2]) * t,
        road = nearestRoad(map, x, z);
      expect(
        paved(x, z) || road.distance < road.road.width / 2,
        `Home path ${x},${z}`,
      ).toBe(true);
    }
  }
});

it("clears property outlines including wide aprons while pools do not get driveway grip", () => {
  const fixture = {
    ...map,
    beverlySurvey: {
      drivewaySurfaces: [
        {
          points: [
            [0, 0],
            [4, 0],
            [4, 12],
            [12, 12],
            [12, 16],
            [0, 16],
          ],
        },
      ],
      propertyFeatures: [
        {
          kind: "pool",
          points: [
            [20, 0],
            [26, 0],
            [26, 5],
            [20, 5],
          ],
        },
      ],
    },
  };
  const clear = createPropertyClearance(fixture),
    paved = createDrivewayQuery(fixture);
  expect(clear(10, 14)).toBe(false);
  expect(paved(10, 14)).toBe(true);
  expect(clear(10, 8)).toBe(true);
  expect(paved(10, 8)).toBe(false);
  expect(clear(23, 2)).toBe(false);
  expect(paved(23, 2)).toBe(false);
  expect(clear(26.5, 2, 0.2)).toBe(false);
});

it("connects every reviewed driveway mouth and preserves observation provenance", () => {
  const survey = map.beverlySurvey;
  expect(survey.driveways).toHaveLength(37);
  for (const drive of survey.driveways) {
    expect(drive.surfaceIds?.length, drive.address).toBeGreaterThan(0);
    const surfaces = drive.surfaceIds.map((id: string) =>
      survey.drivewaySurfaces.find((s: any) => s.id === id),
    );
    expect(surfaces.every((s: any) => s?.address === drive.address)).toBe(true);
    const start = drive.points[0],
      near = nearestRoad(map, ...(start as [number, number]));
    expect(near.distance, drive.address).toBeLessThan(
      near.road.width / 2 + 0.05,
    );
    expect(
      surfaces.some((s: any) => s.sourceId && s.sourcePixels?.length >= 3),
      drive.address,
    ).toBe(true);
  }
  for (const feature of survey.propertyFeatures) {
    expect(feature.sourceId).toBeTruthy();
    expect(feature.sourcePixels.length).toBeGreaterThanOrEqual(3);
    expect(feature.points.flat().every(Number.isFinite)).toBe(true);
  }
});
