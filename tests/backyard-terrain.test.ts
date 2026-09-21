import { afterEach, describe, expect, it } from "vitest";
import * as T from "three";
import { terrainGeometry, terrainHeightAt } from "../src/terrain";
import type { MapData } from "../src/types";

const empty: MapData = {
  roads: [],
  home: { position: [0, 0, 0], heading: 0 },
  route: { type: "circuit", name: "Fixture", points: [], streets: [], laps: 1 },
  bounds: { minX: 0, maxX: 30, minZ: 0, maxZ: 30 },
};
const original: MapData = {
  ...empty,
  terrain: {
    ...empty.bounds,
    cols: 4,
    rows: 4,
    heights: [0, 2, -1, 4, 3, 7, 1, 6, -2, 5, 2, 3, 4, 2, 6, 0],
  },
};
const fine = {
  minX: 10,
  maxX: 20,
  minZ: 10,
  maxZ: 20,
  cols: 11,
  rows: 11,
  heights: Array.from({ length: 121 }, (_, index) => {
    const x = index % 11,
      z = Math.floor(index / 11);
    // Exact base interpolation around the perimeter; a genuine depression inside.
    return (
      terrainHeightAt(original, 10 + x, 10 + z) -
      3.5 * Math.sin((x / 10) * Math.PI) * Math.sin((z / 10) * Math.PI)
    );
  }),
};
const patched: MapData = { ...original, backyard: { terrain: fine } };
const meshes: T.Mesh<T.BufferGeometry, T.MeshBasicMaterial>[] = [];
function mesh(map: MapData) {
  const result = new T.Mesh(terrainGeometry(map), new T.MeshBasicMaterial());
  result.updateMatrixWorld(true);
  meshes.push(result);
  return result;
}
function heightsAt(mesh: T.Mesh, x: number, z: number) {
  return new T.Raycaster(
    new T.Vector3(x, 50, z),
    new T.Vector3(0, -1, 0),
    0,
    100,
  )
    .intersectObject(mesh, false)
    .map((hit) => hit.point.y);
}
afterEach(() => {
  for (const mesh of meshes.splice(0)) {
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
});

describe("regional backyard terrain", () => {
  it("removes the original coarse floor under the stream depression and agrees with fine triangles", () => {
    const ground = mesh(patched);
    for (const [x, z] of [
      [15.17, 15.41],
      [12.61, 17.14],
      [18.23, 11.54],
    ]) {
      const hits = heightsAt(ground, x, z);
      expect(hits).toHaveLength(1);
      expect(hits[0]).toBeCloseTo(terrainHeightAt(patched, x, z) - 0.03, 5);
      expect(hits[0]).toBeLessThan(terrainHeightAt(original, x, z) - 0.3);
    }
    // Nine original cells, one replaced by one hundred fine cells.
    expect(ground.geometry.index!.count / 3).toBe(216);
  });

  it("has no holes or height jumps at any patch edge and keeps outside terrain unchanged", () => {
    const ground = mesh(patched);
    for (const [x, z] of [
      [10, 12.31],
      [20, 13.83],
      [14.41, 10],
      [18.73, 20],
      [10, 10],
      [20, 20],
    ]) {
      expect(terrainHeightAt(patched, x, z)).toBeCloseTo(
        terrainHeightAt(original, x, z),
        10,
      );
      for (const dx of [-0.0001, 0, 0.0001])
        for (const dz of [-0.0001, 0, 0.0001]) {
          const hits = heightsAt(ground, x + dx, z + dz);
          expect(
            hits.length,
            `terrain seam at ${x + dx},${z + dz}`,
          ).toBeGreaterThan(0);
          for (const y of hits)
            expect(y).toBeCloseTo(
              terrainHeightAt(patched, x + dx, z + dz) - 0.03,
              5,
            );
          expect(
            Math.abs(
              terrainHeightAt(patched, x + dx, z + dz) -
                terrainHeightAt(patched, x, z),
            ),
          ).toBeLessThan(0.001);
        }
    }
    for (const [x, z] of [
      [4.31, 8.62],
      [24.63, 16.18],
      [18.18, 26.74],
    ]) {
      expect(terrainHeightAt(patched, x, z)).toBe(
        terrainHeightAt(original, x, z),
      );
      expect(heightsAt(ground, x, z)[0]).toBeCloseTo(
        terrainHeightAt(original, x, z) - 0.03,
        5,
      );
    }
  });

  it("preserves the original saddle-cell diagonal and clamps outer height queries", () => {
    const saddle: MapData = {
      ...empty,
      terrain: {
        cols: 2,
        rows: 2,
        minX: 0,
        maxX: 10,
        minZ: 0,
        maxZ: 10,
        heights: [0, 4, 2, 9],
      },
    };
    const ground = mesh(saddle);
    expect(terrainHeightAt(saddle, 2, 3)).toBeCloseTo(1.4, 10);
    expect(terrainHeightAt(saddle, 8, 6)).toBeCloseTo(5.6, 10);
    expect(heightsAt(ground, 2, 3)[0]).toBeCloseTo(1.37, 5);
    expect(heightsAt(ground, 8, 6)[0]).toBeCloseTo(5.57, 5);
    expect(terrainHeightAt(saddle, -20, -20)).toBe(0);
    expect(terrainHeightAt(saddle, 20, 20)).toBe(9);
  });

  it("retains the flat thirty-by-thirty fallback for the handling grounds", () => {
    const ground = mesh(empty);
    expect(ground.geometry.getAttribute("position").count).toBe(900);
    expect(terrainHeightAt(empty, 13.45, 21.78)).toBe(0);
    expect(heightsAt(ground, 13.45, 21.78)[0]).toBeCloseTo(-0.03, 6);
    expect(
      Array.from(ground.geometry.getAttribute("normal").array).every(
        Number.isFinite,
      ),
    ).toBe(true);
  });
});
