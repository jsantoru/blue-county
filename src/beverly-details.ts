import * as T from "three";
import type { MapData } from "./types";
import { createPropertyClearance } from "./property-footprints";

type XZ = [number, number];
type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };
type CoverKind = "meadow" | "woodland-floor" | "pond";
interface Survey {
  bounds: Bounds;
  driveways: { points: XZ[]; widthMeters: number }[];
  landcover: { kind: CoverKind; points: XZ[] }[];
}
type Segment = { a: XZ; b: XZ; radius: number };
type Batch = { positions: number[]; colors: number[] };

const CELL = 3;
const SURFACE_OFFSET = 0.035;
const TAU = Math.PI * 2;

function distanceToSegment(x: number, z: number, a: XZ, b: XZ) {
  const dx = b[0] - a[0],
    dz = b[1] - a[1];
  const t = Math.max(
    0,
    Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)),
  );
  return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
}

function boundaryDistance(x: number, z: number, ring: XZ[]) {
  let distance = Infinity;
  for (let i = 0; i < ring.length; i++)
    distance = Math.min(
      distance,
      distanceToSegment(x, z, ring[i], ring[(i + 1) % ring.length]),
    );
  return distance;
}

function inside(x: number, z: number, ring: XZ[]) {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a[1] > z !== b[1] > z &&
      x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]
    )
      result = !result;
  }
  return result;
}

function clip(polygon: XZ[], distance: (point: XZ) => number): XZ[] {
  const output: XZ[] = [];
  if (polygon.length < 3) return output;
  let previous = polygon[polygon.length - 1],
    previousD = distance(previous);
  for (const current of polygon) {
    const currentD = distance(current);
    if (previousD >= 0 !== currentD >= 0) {
      const t = previousD / (previousD - currentD);
      output.push([
        previous[0] + (current[0] - previous[0]) * t,
        previous[1] + (current[1] - previous[1]) * t,
      ]);
    }
    if (currentD >= 0) output.push(current);
    previous = current;
    previousD = currentD;
  }
  return output;
}

/** Subtract a convex triangle without rasterizing its shoreline into grid-shaped steps. */
function subtractTriangle(polygon: XZ[], triangle: XZ[]): XZ[][] {
  const [a, b, c] = triangle;
  const sign = Math.sign(
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
  );
  if (!sign) return [polygon];
  const outside: XZ[][] = [];
  let remainder = polygon;
  for (let i = 0; i < 3 && remainder.length >= 3; i++) {
    const from = triangle[i],
      to = triangle[(i + 1) % 3];
    const edge = (p: XZ) =>
      sign *
      ((to[0] - from[0]) * (p[1] - from[1]) -
        (to[1] - from[1]) * (p[0] - from[0]));
    const piece = clip(remainder, (p) => -edge(p));
    if (piece.length >= 3) outside.push(piece);
    remainder = clip(remainder, edge);
  }
  return outside;
}

function boundsOf(points: XZ[]): Bounds {
  return {
    minX: Math.min(...points.map((p) => p[0])),
    maxX: Math.max(...points.map((p) => p[0])),
    minZ: Math.min(...points.map((p) => p[1])),
    maxZ: Math.max(...points.map((p) => p[1])),
  };
}

/** Include every DEM boundary as well as the fine grid, so patches cannot bridge its creases. */
function divisions(low: number, high: number, origin?: number, step?: number) {
  const values = [low, high];
  for (let p = Math.ceil(low / CELL) * CELL; p < high; p += CELL)
    if (p > low) values.push(p);
  if (origin !== undefined && step && step > 0)
    for (
      let i = Math.ceil((low - origin) / step);
      origin + i * step < high;
      i++
    )
      if (origin + i * step > low) values.push(origin + i * step);
  return values
    .sort((a, b) => a - b)
    .filter((value, i, all) => i === 0 || value - all[i - 1] > 1e-6);
}

function randomAt(x: number, z: number, seed: number) {
  const value = Math.sin(x * 12.9898 + z * 78.233 + seed * 23.71) * 43758.5453;
  return value - Math.floor(value);
}

/** Measured outlines with restrained procedural surface detail; visual only, no colliders. */
export function buildBeverlyDetails(
  map: MapData,
  heightAt: (x: number, z: number) => number,
): T.Group {
  const propertyClear = createPropertyClearance(map);
  const root = new T.Group();
  root.name = "Beverly reference landcover";
  const statistics = {
    patches: 0,
    ponds: 0,
    surfaceTriangles: 0,
    detailTriangles: 0,
    shoreTriangles: 0,
    meadowTufts: 0,
    reedTufts: 0,
    leafClusters: 0,
    drawCalls: 0,
    maxGridSpacingMeters: CELL,
  };
  root.userData.statistics = statistics;
  root.userData.approximation =
    "Survey polygon outlines; terrain-following meadow/woodland. Pond water is leveled above the highest sampled ground inside each outline, with a short shore bank: the coarse USGS DEM cannot resolve pond depressions. Fine vegetation is procedural. Visual only, no new colliders.";
  const waterLevels: {
    level: number;
    minimumGround: number;
    maximumGround: number;
  }[] = [];
  root.userData.waterLevels = waterLevels;
  const survey = map.beverlySurvey as Survey | undefined;
  if (!survey?.landcover?.length) return root;

  // Conservative spatial index: a whole triangle must clear roads, drives, and house envelopes.
  const indexSize = 32,
    segmentIndex = new Map<string, Segment[]>();
  const key = (x: number, z: number) => `${x}:${z}`;
  const addSegment = (a: XZ, b: XZ, radius: number) => {
    const segment = { a, b, radius };
    for (
      let x = Math.floor((Math.min(a[0], b[0]) - radius - 5) / indexSize);
      x <= Math.floor((Math.max(a[0], b[0]) + radius + 5) / indexSize);
      x++
    )
      for (
        let z = Math.floor((Math.min(a[1], b[1]) - radius - 5) / indexSize);
        z <= Math.floor((Math.max(a[1], b[1]) + radius + 5) / indexSize);
        z++
      ) {
        const id = key(x, z);
        if (!segmentIndex.has(id)) segmentIndex.set(id, []);
        segmentIndex.get(id)!.push(segment);
      }
  };
  for (const road of map.roads)
    for (let i = 1; i < road.points.length; i++)
      addSegment(
        [road.points[i - 1][0], road.points[i - 1][2]],
        [road.points[i][0], road.points[i][2]],
        road.width / 2 + 1.2,
      );
  for (const drive of survey.driveways ?? [])
    for (let i = 1; i < drive.points.length; i++)
      addSegment(
        drive.points[i - 1],
        drive.points[i],
        (drive.widthMeters || 3.4) / 2 + 0.7,
      );
  const houses: (Bounds & { points: XZ[] })[] = [];
  for (const building of map.buildings ?? []) {
    const points = building.points ?? building.footprint;
    if (!points?.length) continue;
    houses.push({
      points: points.map((p: number[]): XZ => [p[0], p[2]]),
      minX: Math.min(...points.map((p: number[]) => p[0])),
      maxX: Math.max(...points.map((p: number[]) => p[0])),
      minZ: Math.min(...points.map((p: number[]) => p[2])),
      maxZ: Math.max(...points.map((p: number[]) => p[2])),
    });
  }
  const clear = (x: number, z: number, radius = 0) => {
    if (!propertyClear(x, z, radius)) return false;
    for (const segment of segmentIndex.get(
      key(Math.floor(x / indexSize), Math.floor(z / indexSize)),
    ) ?? [])
      if (
        distanceToSegment(x, z, segment.a, segment.b) <
        segment.radius + radius
      )
        return false;
    for (const house of houses)
      if (
        x > house.minX - 2 - radius &&
        x < house.maxX + 2 + radius &&
        z > house.minZ - 2 - radius &&
        z < house.maxZ + 2 + radius &&
        (inside(x, z, house.points) ||
          boundaryDistance(x, z, house.points) < 2 + radius)
      )
        return false;
    return true;
  };

  const batches = new Map<string, Batch>();
  const batch = (name: string) => {
    if (!batches.has(name)) batches.set(name, { positions: [], colors: [] });
    return batches.get(name)!;
  };
  const groundColors = {
    meadow: new T.Color(0x60793d),
    "woodland-floor": new T.Color(0x55543a),
    pond: new T.Color(0x355652),
  };
  const grassEdge = new T.Color(0x547332),
    shore = new T.Color(0x716d4c);
  const color = new T.Color();
  const emitSurface = (polygon: XZ[], kind: CoverKind, ring: XZ[]) => {
    const target = batch(kind);
    for (let i = 1; i < polygon.length - 1; i++) {
      let a = polygon[0],
        b = polygon[i],
        c = polygon[i + 1];
      const cross =
        (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (Math.abs(cross) < 1e-8) continue;
      const x = (a[0] + b[0] + c[0]) / 3,
        z = (a[1] + b[1] + c[1]) / 3;
      const radius = Math.max(
        ...[a, b, c].map((p) => Math.hypot(p[0] - x, p[1] - z)),
      );
      if (!clear(x, z, radius)) continue;
      if (cross > 0) [b, c] = [c, b]; // Upward-facing XZ triangle.
      for (const p of [a, b, c]) {
        target.positions.push(
          p[0],
          heightAt(p[0], p[1]) + SURFACE_OFFSET,
          p[1],
        );
        const edge = boundaryDistance(p[0], p[1], ring);
        color.copy(groundColors[kind]);
        if (kind === "pond") color.lerp(shore, 1 - Math.min(1, edge / 1.25));
        else color.lerp(grassEdge, 1 - Math.min(1, edge / 2.5));
        color.multiplyScalar(
          0.95 + 0.035 * Math.sin(p[0] * 0.21) + 0.035 * Math.cos(p[1] * 0.17),
        );
        target.colors.push(color.r, color.g, color.b);
      }
      statistics.surfaceTriangles++;
    }
  };
  const grid = map.terrain;
  const dx = grid ? (grid.maxX - grid.minX) / (grid.cols - 1) : 0;
  const dz = grid ? (grid.maxZ - grid.minZ) / (grid.rows - 1) : 0;

  // Pond outlines win over woodland, which wins over meadow. Source extents can overlap.
  // Subtract exact polygon triangles before fine tessellation, preventing coplanar surfaces.
  const priority = { pond: 2, "woodland-floor": 1, meadow: 0 };
  const occupied: { triangle: XZ[]; bounds: Bounds }[] = [];
  const occupiedRings: XZ[][] = [];
  const covers = [...survey.landcover].sort(
    (a, b) => (priority[b.kind] ?? -1) - (priority[a.kind] ?? -1),
  );
  for (const cover of covers) {
    if (!(cover.kind in groundColors)) continue;
    const ring = cover.points.filter(
      (p) => Number.isFinite(p[0]) && Number.isFinite(p[1]),
    );
    if (
      ring.length > 3 &&
      Math.hypot(
        ring[0][0] - ring[ring.length - 1][0],
        ring[0][1] - ring[ring.length - 1][1],
      ) < 1e-5
    )
      ring.pop();
    if (ring.length < 3) continue;
    const triangles = T.ShapeUtils.triangulateShape(
      ring.map((p) => new T.Vector2(...p)),
      [],
    );
    if (!triangles.length) continue;
    statistics.patches++;
    if (cover.kind === "pond") statistics.ponds++;
    const sourceTriangles = triangles.map((indices) =>
      indices.map((i) => ring[i]),
    );
    const firstSurfaceVertex = batch(cover.kind).positions.length;
    let waterLevel = 0;
    const visiblePolygons: XZ[][] = [];
    for (const triangle of sourceTriangles) {
      const bounds = boundsOf(triangle);
      let pieces = [triangle];
      for (const blocked of occupied) {
        if (
          bounds.maxX <= blocked.bounds.minX ||
          bounds.minX >= blocked.bounds.maxX ||
          bounds.maxZ <= blocked.bounds.minZ ||
          bounds.minZ >= blocked.bounds.maxZ
        )
          continue;
        pieces = pieces.flatMap((piece) =>
          subtractTriangle(piece, blocked.triangle),
        );
        if (!pieces.length) break;
      }
      visiblePolygons.push(...pieces);
    }
    for (const triangle of visiblePolygons) {
      const xs = divisions(
        Math.min(...triangle.map((p) => p[0])),
        Math.max(...triangle.map((p) => p[0])),
        grid?.minX,
        dx,
      );
      const zs = divisions(
        Math.min(...triangle.map((p) => p[1])),
        Math.max(...triangle.map((p) => p[1])),
        grid?.minZ,
        dz,
      );
      for (let xi = 1; xi < xs.length; xi++)
        for (let zi = 1; zi < zs.length; zi++) {
          let polygon = clip(triangle, (p) => p[0] - xs[xi - 1]);
          polygon = clip(polygon, (p) => xs[xi] - p[0]);
          polygon = clip(polygon, (p) => p[1] - zs[zi - 1]);
          polygon = clip(polygon, (p) => zs[zi] - p[1]);
          if (polygon.length < 3) continue;
          if (grid && dx > 0 && dz > 0) {
            const cellX = Math.max(
              0,
              Math.min(
                grid.cols - 2,
                Math.floor(((xs[xi - 1] + xs[xi]) / 2 - grid.minX) / dx),
              ),
            );
            const cellZ = Math.max(
              0,
              Math.min(
                grid.rows - 2,
                Math.floor(((zs[zi - 1] + zs[zi]) / 2 - grid.minZ) / dz),
              ),
            );
            const diagonal = (p: XZ) =>
              (p[0] - grid.minX - cellX * dx) / dx +
              (p[1] - grid.minZ - cellZ * dz) / dz -
              1;
            emitSurface(
              clip(polygon, (p) => -diagonal(p)),
              cover.kind,
              ring,
            );
            emitSurface(clip(polygon, diagonal), cover.kind, ring);
          } else emitSurface(polygon, cover.kind, ring);
        }
    }

    if (cover.kind === "pond") {
      const positions = batch("pond").positions;
      if (positions.length === firstSurfaceVertex) continue;
      let minimumGround = Infinity,
        maximumGround = -Infinity;
      for (let i = firstSurfaceVertex + 1; i < positions.length; i += 3) {
        minimumGround = Math.min(minimumGround, positions[i] - SURFACE_OFFSET);
        maximumGround = Math.max(maximumGround, positions[i] - SURFACE_OFFSET);
      }
      // These vertices include every relevant DEM crease, so terrain cannot poke through the water.
      waterLevel = maximumGround + 0.06;
      for (let i = firstSurfaceVertex + 1; i < positions.length; i += 3)
        positions[i] = waterLevel;
      waterLevels.push({ level: waterLevel, minimumGround, maximumGround });

      // A narrow sloping bank joins the measured water edge to the coarse surrounding terrain.
      // It shares the existing opaque groundcover batch and adds no extra draw or collider.
      const bank = batch("groundcover");
      let signedArea = 0;
      for (let i = 0; i < ring.length; i++)
        signedArea +=
          ring[i][0] * ring[(i + 1) % ring.length][1] -
          ring[i][1] * ring[(i + 1) % ring.length][0];
      const direction = Math.sign(signedArea) || 1;
      const outer = ring.map((p, i): XZ => {
        const previous = ring[(i + ring.length - 1) % ring.length],
          next = ring[(i + 1) % ring.length];
        const inLength = Math.hypot(p[0] - previous[0], p[1] - previous[1]);
        const outLength = Math.hypot(next[0] - p[0], next[1] - p[1]);
        let nx =
          direction *
          ((p[1] - previous[1]) / (inLength || 1) +
            (next[1] - p[1]) / (outLength || 1));
        let nz =
          -direction *
          ((p[0] - previous[0]) / (inLength || 1) +
            (next[0] - p[0]) / (outLength || 1));
        const length = Math.hypot(nx, nz) || 1;
        nx /= length;
        nz /= length;
        return [p[0] + nx * 0.9, p[1] + nz * 0.9];
      });
      for (let i = 0; i < ring.length; i++) {
        const j = (i + 1) % ring.length;
        const steps = Math.ceil(
          Math.hypot(ring[j][0] - ring[i][0], ring[j][1] - ring[i][1]) / 2,
        );
        for (let step = 0; step < steps; step++) {
          const at = (points: XZ[], t: number): XZ => [
            points[i][0] + (points[j][0] - points[i][0]) * t,
            points[i][1] + (points[j][1] - points[i][1]) * t,
          ];
          const a = at(ring, step / steps),
            b = at(ring, (step + 1) / steps);
          const c = at(outer, step / steps),
            d = at(outer, (step + 1) / steps);
          if (!clear((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 2)) continue;
          const vertices = [
            [a[0], waterLevel + 0.002, a[1]],
            [b[0], waterLevel + 0.002, b[1]],
            [c[0], heightAt(...c) + SURFACE_OFFSET, c[1]],
            [b[0], waterLevel + 0.002, b[1]],
            [d[0], heightAt(...d) + SURFACE_OFFSET, d[1]],
            [c[0], heightAt(...c) + SURFACE_OFFSET, c[1]],
          ];
          for (const vertex of vertices) {
            bank.positions.push(...vertex);
            color
              .copy(shore)
              .multiplyScalar(0.9 + randomAt(vertex[0], vertex[2], 83) * 0.1);
            bank.colors.push(color.r, color.g, color.b);
          }
          statistics.shoreTriangles += 2;
          statistics.detailTriangles += 2;
        }
      }
    }

    const minX = Math.min(...ring.map((p) => p[0])),
      maxX = Math.max(...ring.map((p) => p[0]));
    const minZ = Math.min(...ring.map((p) => p[1])),
      maxZ = Math.max(...ring.map((p) => p[1]));
    const spacing =
      cover.kind === "pond" ? 1.45 : cover.kind === "meadow" ? 7 : 5;
    const details = batch(cover.kind === "pond" ? "reeds" : "groundcover");
    for (let x0 = minX; x0 < maxX; x0 += spacing)
      for (let z0 = minZ; z0 < maxZ; z0 += spacing) {
        const x = x0 + spacing * randomAt(x0, z0, 1),
          z = z0 + spacing * randomAt(x0, z0, 2);
        if (
          !inside(x, z, ring) ||
          occupiedRings.some(
            (previous) =>
              inside(x, z, previous) || boundaryDistance(x, z, previous) < 0.75,
          ) ||
          !clear(x, z, 0.75)
        )
          continue;
        const edge = boundaryDistance(x, z, ring);
        const isReed = cover.kind === "pond",
          isLeaf = cover.kind === "woodland-floor";
        if (
          isReed &&
          (edge < 0.18 ||
            edge > 1.8 ||
            statistics.reedTufts >= 180 ||
            randomAt(x, z, 3) > 0.4)
        )
          continue;
        if (
          isLeaf &&
          (statistics.leafClusters >= 1100 || randomAt(x, z, 3) > 0.7)
        )
          continue;
        if (
          cover.kind === "meadow" &&
          (statistics.meadowTufts >= 1700 || edge < 0.75)
        )
          continue;
        const y = isReed
          ? waterLevel + 0.01
          : heightAt(x, z) + SURFACE_OFFSET + 0.01;
        if (isReed) statistics.reedTufts++;
        else if (isLeaf) statistics.leafClusters++;
        else statistics.meadowTufts++;
        for (let blade = 0; blade < (isLeaf ? 3 : 5); blade++) {
          const angle = randomAt(x, z, 7 + blade) * TAU,
            w = isLeaf ? 0.11 : isReed ? 0.025 : 0.035;
          const ox = (randomAt(x, z, 15 + blade) - 0.5) * 0.45,
            oz = (randomAt(x, z, 25 + blade) - 0.5) * 0.45;
          const length =
            (isLeaf ? 0.22 : isReed ? 0.8 : 0.22) *
            (0.65 + randomAt(x, z, 35 + blade));
          const sideX = Math.cos(angle) * w,
            sideZ = Math.sin(angle) * w;
          const tipX = x + ox + Math.sin(angle) * length * (isLeaf ? 1 : 0.3);
          const tipZ = z + oz + Math.cos(angle) * length * (isLeaf ? 1 : 0.3);
          details.positions.push(
            x + ox - sideX,
            heightAt(x + ox - sideX, z + oz - sideZ) + SURFACE_OFFSET + 0.012,
            z + oz - sideZ,
            x + ox + sideX,
            heightAt(x + ox + sideX, z + oz + sideZ) + SURFACE_OFFSET + 0.012,
            z + oz + sideZ,
            tipX,
            isLeaf ? heightAt(tipX, tipZ) + SURFACE_OFFSET + 0.035 : y + length,
            tipZ,
          );
          color
            .set(isLeaf ? 0x66603d : isReed ? 0x697442 : 0x6a803e)
            .multiplyScalar(0.8 + randomAt(x, z, 4 + blade) * 0.35);
          for (let vertex = 0; vertex < 3; vertex++)
            details.colors.push(color.r, color.g, color.b);
          statistics.detailTriangles++;
        }
      }
    occupiedRings.push(ring);
    for (const triangle of sourceTriangles)
      occupied.push({ triangle, bounds: boundsOf(triangle) });
  }

  for (const [name, source] of batches) {
    if (!source.positions.length) continue;
    const geometry = new T.BufferGeometry();
    geometry.setAttribute(
      "position",
      new T.Float32BufferAttribute(source.positions, 3),
    );
    geometry.setAttribute(
      "color",
      new T.Float32BufferAttribute(source.colors, 3),
    );
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const material =
      name === "pond"
        ? new T.MeshPhysicalMaterial({
            vertexColors: true,
            roughness: 0.25,
            metalness: 0,
            clearcoat: 0.65,
            clearcoatRoughness: 0.2,
            envMapIntensity: 0.6,
          })
        : new T.MeshStandardMaterial({
            vertexColors: true,
            roughness: 1,
            envMapIntensity: 0.12,
            side:
              name === "reeds" || name === "groundcover"
                ? T.DoubleSide
                : T.FrontSide,
          });
    material.name = `Beverly ${name}`;
    const mesh = new T.Mesh(geometry, material);
    mesh.name = `Beverly ${name}`;
    mesh.receiveShadow = true;
    mesh.castShadow = name === "reeds";
    mesh.userData.surfaceOffset =
      name === "reeds" || name === "groundcover" || name === "pond"
        ? undefined
        : SURFACE_OFFSET;
    if (name === "pond") mesh.userData.waterLevels = waterLevels;
    root.add(mesh);
  }
  statistics.drawCalls = root.children.length;
  return root;
}
