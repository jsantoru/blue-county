import * as T from "three";
import { clamp, type MapData } from "./types";

type TerrainGrid = NonNullable<MapData["terrain"]>;
type Bounds = Pick<TerrainGrid, "minX" | "maxX" | "minZ" | "maxZ">;

/** The cell diagonal connects (x1, z0) to (x0, z1), matching the original road terrain. */
function gridHeightAt(grid: TerrainGrid, x: number, z: number) {
  const u = clamp(
      ((x - grid.minX) / (grid.maxX - grid.minX)) * (grid.cols - 1),
      0,
      grid.cols - 1,
    ),
    v = clamp(
      ((z - grid.minZ) / (grid.maxZ - grid.minZ)) * (grid.rows - 1),
      0,
      grid.rows - 1,
    ),
    a = Math.min(grid.cols - 2, Math.floor(u)),
    b = Math.min(grid.rows - 2, Math.floor(v)),
    fx = u - a,
    fz = v - b,
    h00 = grid.heights[b * grid.cols + a],
    h10 = grid.heights[b * grid.cols + a + 1],
    h01 = grid.heights[(b + 1) * grid.cols + a],
    h11 = grid.heights[(b + 1) * grid.cols + a + 1];
  return fx + fz <= 1
    ? h00 + (h10 - h00) * fx + (h01 - h00) * fz
    : h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
}

function inside(bounds: Bounds, x: number, z: number) {
  return (
    x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ
  );
}

/** Matches the chosen terrain mesh triangle, including boundary vertices and saddle cells. */
export function terrainHeightAt(map: MapData, x: number, z: number): number {
  const patch = map.backyard?.terrain as TerrainGrid | undefined;
  const grid = patch && inside(patch, x, z) ? patch : map.terrain;
  return grid ? gridHeightAt(grid, x, z) : 0;
}

/**
 * The regional grid replaces complete coarse cells, rather than layering over them.
 * Its bounds must align to coarse-cell edges and its perimeter heights must equal
 * base-grid interpolation. The offline compiler supplies those two guarantees.
 */
export function terrainGeometry(map: MapData): T.BufferGeometry {
  const positions: number[] = [],
    indices: number[] = [];
  const patch = map.backyard?.terrain as TerrainGrid | undefined;
  const base: TerrainGrid = map.terrain ?? {
    ...map.bounds,
    cols: 30,
    rows: 30,
    heights: Array(30 * 30).fill(0),
  };
  const append = (grid: TerrainGrid, replacement?: TerrainGrid) => {
    const start = positions.length / 3;
    const xAt = (i: number) =>
      grid.minX + ((grid.maxX - grid.minX) * i) / (grid.cols - 1);
    const zAt = (j: number) =>
      grid.minZ + ((grid.maxZ - grid.minZ) * j) / (grid.rows - 1);
    for (let j = 0; j < grid.rows; j++)
      for (let i = 0; i < grid.cols; i++) {
        positions.push(xAt(i), grid.heights[j * grid.cols + i] - 0.03, zAt(j));
        if (i === grid.cols - 1 || j === grid.rows - 1) continue;
        // Tolerance only resolves floating-point coordinates of aligned cell edges.
        // Partial cells are never removed, so every point outside the patch retains its floor.
        if (
          replacement &&
          xAt(i) >= replacement.minX - 1e-7 &&
          xAt(i + 1) <= replacement.maxX + 1e-7 &&
          zAt(j) >= replacement.minZ - 1e-7 &&
          zAt(j + 1) <= replacement.maxZ + 1e-7
        )
          continue;
        const a = start + j * grid.cols + i;
        indices.push(
          a,
          a + grid.cols,
          a + 1,
          a + 1,
          a + grid.cols,
          a + grid.cols + 1,
        );
      }
  };
  append(base, patch);
  if (patch) append(patch);
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
