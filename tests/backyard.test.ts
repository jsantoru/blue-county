import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as T from "three";
import { Backyard, creekDistance, type BackyardData } from "../src/backyard";
import { terrainHeightAt } from "../src/terrain";
import { nearestRoad } from "../src/roads";
import {
  createDrivewayQuery,
  createPropertyClearance,
  polygonDistance,
} from "../src/property-footprints";
import type { MapData, Point } from "../src/types";

type XZ = [number, number];
const json = (path: string) =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const map: MapData = json("../public/map/warwick.json");
const base: MapData = { ...map, backyard: undefined };
const data = map.backyard as BackyardData;
const hydro = json("../docs/research-backyard/hydro-observations.json");
const woods = json("../docs/research-backyard/woodland-observations.json");
const stations = data.stream.stations;
const full = stations.filter((s) => s.fade === 1);
const unchanged = (x: number, z: number, label: string) =>
  expect(
    Math.abs(terrainHeightAt(map, x, z) - terrainHeightAt(base, x, z)),
    `${label} at ${x},${z}`,
  ).toBeLessThan(1e-5);

describe("source-positioned Home backyard", () => {
  it("retains the exact cached hydro coordinates and observed woodland edge", () => {
    expect(
      Buffer.from(JSON.stringify(data.stream.pointsXZ)).equals(
        Buffer.from(JSON.stringify(hydro.stream.pointsXZ)),
      ),
    ).toBe(true);
    expect(data.stream.id).toBe(hydro.stream.id);
    expect(data.stream.name).toBe(hydro.stream.name);
    expect(data.woodlands).toEqual(woods.woodlands);
    expect(
      data.woodlands.some((w) => polygonDistance(25, 0, w.points) === 0),
    ).toBe(false);
    expect(
      data.woodlands.some((w) => polygonDistance(50, 0, w.points) === 0),
    ).toBe(true);
    expect(data.stream.renderedLengthMeters).toBeGreaterThan(100);
    // Densification may add points, but must not straighten or move source bends.
    for (const station of stations) {
      const distances = data.stream.pointsXZ.slice(1).map((b, i) => {
        const a = data.stream.pointsXZ[i],
          dx = b[0] - a[0],
          dz = b[1] - a[1];
        const t = Math.max(
          0,
          Math.min(
            1,
            ((station.point[0] - a[0]) * dx + (station.point[1] - a[1]) * dz) /
              (dx * dx + dz * dz),
          ),
        );
        return Math.hypot(
          station.point[0] - a[0] - dx * t,
          station.point[1] - a[1] - dz * t,
        );
      });
      expect(Math.min(...distances)).toBeLessThan(0.00002);
    }
  });

  it("keeps the water descending over a shallow bed and leaves ground ten meters away unchanged", () => {
    expect(full.length).toBeGreaterThan(50);
    for (let i = 1; i < stations.length; i++)
      expect(stations[i].waterY).toBeLessThanOrEqual(stations[i - 1].waterY);
    for (const station of full) {
      const [x, z] = station.point;
      expect(
        terrainHeightAt(map, x, z),
        `bed below water at ${x},${z}`,
      ).toBeLessThan(station.waterY - 0.08);
      // Water depth remains shallow even where the inferred ravine cuts through
      // an uphill hump in the coarse DEM to keep the mapped flow descending.
      expect(terrainHeightAt(map, x, z)).toBeGreaterThan(station.waterY - 0.3);
      expect(terrainHeightAt(map, x, z)).toBeGreaterThan(
        terrainHeightAt(base, x, z) - 3,
      );
    }
    let outsideChecks = 0;
    for (let i = 10; i < stations.length - 10; i += 9) {
      const a = stations[i - 1].point,
        b = stations[i + 1].point;
      const dx = b[0] - a[0],
        dz = b[1] - a[1],
        length = Math.hypot(dx, dz);
      for (const sign of [-1, 1]) {
        const x = stations[i].point[0] + (dz / length) * 10.2 * sign;
        const z = stations[i].point[1] - (dx / length) * 10.2 * sign;
        if (creekDistance(stations, x, z).distance < 10) continue;
        unchanged(x, z, "outside channel bank");
        outsideChecks++;
      }
    }
    expect(outsideChecks).toBeGreaterThan(20);
  });

  it("preserves house, road and driveway grades and never carves paved terrain samples", () => {
    for (const building of map.buildings ?? []) {
      const points = building.points as Point[];
      for (const p of points) unchanged(p[0], p[2], `building ${building.id}`);
      const center = points.reduce(
        (sum, p) => [
          sum[0] + p[0] / points.length,
          sum[1] + p[2] / points.length,
        ],
        [0, 0],
      );
      unchanged(center[0], center[1], `building ${building.id} center`);
    }
    for (const road of map.roads)
      for (let i = 1; i < road.points.length; i++) {
        const a = road.points[i - 1],
          b = road.points[i];
        const length = Math.hypot(b[0] - a[0], b[2] - a[2]);
        const nx = (b[2] - a[2]) / (length || 1),
          nz = -(b[0] - a[0]) / (length || 1);
        for (const t of [0, 0.5, 1])
          for (const sign of [-1, 0, 1])
            unchanged(
              a[0] + (b[0] - a[0]) * t + ((nx * road.width) / 2) * sign,
              a[2] + (b[2] - a[2]) * t + ((nz * road.width) / 2) * sign,
              `road ${road.id}`,
            );
      }
    for (const driveway of map.beverlySurvey.drivewaySurfaces) {
      const points = driveway.points as XZ[];
      for (let i = 0; i < points.length; i++) {
        const a = points[i],
          b = points[(i + 1) % points.length];
        for (const t of [0, 0.5])
          unchanged(
            a[0] + (b[0] - a[0]) * t,
            a[1] + (b[1] - a[1]) * t,
            `driveway ${driveway.id}`,
          );
      }
    }
    const grid = map.backyard.terrain,
      paved = createDrivewayQuery(map);
    let carved = 0;
    for (let row = 0; row < grid.rows; row++)
      for (let col = 0; col < grid.cols; col++) {
        const x = grid.minX + ((grid.maxX - grid.minX) * col) / (grid.cols - 1);
        const z = grid.minZ + ((grid.maxZ - grid.minZ) * row) / (grid.rows - 1);
        if (
          grid.heights[row * grid.cols + col] >=
          terrainHeightAt(base, x, z) - 1e-5
        )
          continue;
        carved++;
        expect(paved(x, z), `driveway carved at ${x},${z}`).toBe(false);
        const road = nearestRoad(map, x, z);
        expect(road.distance, `road carved at ${x},${z}`).toBeGreaterThan(
          road.road.width / 2 + 1,
        );
      }
    expect(carved).toBeGreaterThan(500);
  });

  it("excludes terrestrial planting from the channel without granting water paved grip", () => {
    const clear = createPropertyClearance(map),
      paved = createDrivewayQuery(map);
    for (const station of full) {
      expect(clear(...station.point)).toBe(false);
      expect(paved(...station.point)).toBe(false);
    }
    expect(clear(25, 0)).toBe(true);
  });

  it("renders the actual water ribbon facing upward above the carved bed", () => {
    const gravel = new T.MeshStandardMaterial(),
      bark = new T.MeshStandardMaterial();
    const ground = (ring: XZ[], offset: number) => {
      const indices = T.ShapeUtils.triangulateShape(
        ring.map((p) => new T.Vector2(...p)),
        [],
      ).flat();
      const positions = indices.flatMap((index) => {
        const p = ring[index];
        return [p[0], terrainHeightAt(map, ...p) + offset, p[1]];
      });
      const geometry = new T.BufferGeometry();
      geometry.setAttribute(
        "position",
        new T.Float32BufferAttribute(positions, 3),
      );
      geometry.computeVertexNormals();
      return geometry;
    };
    const backyard = new Backyard(
      map,
      (x, z) => terrainHeightAt(map, x, z),
      ground,
      { gravel, bark },
    );
    try {
      backyard.root.updateMatrixWorld(true);
      const water = backyard.root.getObjectByName(
        "Stony Creek · mapped water ribbon",
      ) as T.Mesh;
      expect(water).toBeDefined();
      const normals = water.geometry.getAttribute("normal");
      for (let i = 0; i < normals.count; i++)
        expect(normals.getY(i)).toBeGreaterThan(0.8);
      const station = full[Math.floor(full.length / 2)];
      const ray = new T.Raycaster(
        new T.Vector3(station.point[0], station.waterY + 3, station.point[1]),
        new T.Vector3(0, -1, 0),
      );
      const hit = ray.intersectObject(water, false)[0];
      expect(hit).toBeDefined();
      expect(hit.point.y).toBeCloseTo(station.waterY, 4);
      expect(hit.point.y).toBeGreaterThan(
        terrainHeightAt(map, ...station.point),
      );
    } finally {
      backyard.dispose();
      const materials = new Set<T.Material>();
      backyard.root.traverse((object) => {
        if (!(object instanceof T.Mesh)) return;
        object.geometry.dispose();
        (Array.isArray(object.material)
          ? object.material
          : [object.material]
        ).forEach((m) => materials.add(m));
      });
      materials.forEach((m) => m.dispose());
      gravel.dispose();
      bark.dispose();
    }
  });
});
