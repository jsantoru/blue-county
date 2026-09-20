import * as T from "three";
import type { MapData } from "./types";
import { createPropertyClearance } from "./property-footprints";

type XZ = [number, number];
type Quality = "low" | "medium" | "high";
type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };
type Ring = Bounds & { points: XZ[] };
type Segment = { a: XZ; b: XZ; radius: number; shoulder: number };
type Survey = {
  bounds: Bounds;
  driveways?: { points: XZ[]; widthMeters: number }[];
  landcover?: { kind: string; points: XZ[] }[];
  woodlands?: { points: XZ[] }[];
};
export interface MicrodetailTree {
  center: XZ;
  radiusMeters: number;
  type: string;
  omitted?: string | null;
}
export interface BeverlyMicrodetailOptions {
  /** Only the renderer's retained observed trees; never infer a new trunk from a crown. */
  referenceCanopies?: MicrodetailTree[];
  quality?: Quality;
}
type Batch = {
  positions: number[];
  colors: number[];
  bases: number[];
  kind: "grass" | "ground";
  x: number;
  z: number;
  primitives: { start: number; count: number; order: number }[];
};
type Chunk = {
  mesh: T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>;
  kind: "grass" | "ground";
  x: number;
  z: number;
  vertices: number;
};

const CELL = 64;
const INDEX = 24;
const TAU = Math.PI * 2;
const GRASS_BUDGET = 93000;
const GROUND_BUDGET = 50000;
const range = { low: 32, medium: 57, high: 88 };
const density = { low: 0.22, medium: 0.58, high: 1 };
const hash = (x: number, z: number, seed: number) => {
  const n = Math.sin(x * 12.9898 + z * 78.233 + seed * 31.713) * 43758.5453;
  return n - Math.floor(n);
};
const key = (x: number, z: number, size = INDEX) =>
  `${Math.floor(x / size)}:${Math.floor(z / size)}`;
function distance(x: number, z: number, a: XZ, b: XZ) {
  const dx = b[0] - a[0],
    dz = b[1] - a[1];
  const t = Math.max(
    0,
    Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)),
  );
  return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
}
function inside(x: number, z: number, points: XZ[]) {
  let result = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i],
      b = points[j];
    if (
      a[1] > z !== b[1] > z &&
      x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]
    )
      result = !result;
  }
  return result;
}
function ring(points: XZ[]): Ring {
  return {
    points,
    minX: Math.min(...points.map((p) => p[0])),
    maxX: Math.max(...points.map((p) => p[0])),
    minZ: Math.min(...points.map((p) => p[1])),
    maxZ: Math.max(...points.map((p) => p[1])),
  };
}
function ringDistance(x: number, z: number, r: Ring) {
  if (inside(x, z, r.points)) return 0;
  let d = Infinity;
  for (let i = 0; i < r.points.length; i++)
    d = Math.min(
      d,
      distance(x, z, r.points[i], r.points[(i + 1) % r.points.length]),
    );
  return d;
}

/** Exact source polygon / polyline clearance, buffered by each primitive's full horizontal extent. */
export function createBeverlyMicrodetailClearance(map: MapData) {
  const propertyClear = createPropertyClearance(map);
  const survey = map.beverlySurvey as Survey | undefined;
  const segments: Segment[] = [];
  const index = new Map<string, Segment[]>();
  const buildings: Ring[] = [];
  const ponds: Ring[] = [];
  const add = (a: XZ, b: XZ, radius: number, shoulder: number) => {
    const s = { a, b, radius, shoulder };
    segments.push(s);
    // The extra distance also supports the lawn's near-road query, not only exclusion.
    const padding = radius + 32;
    for (
      let x = Math.floor((Math.min(a[0], b[0]) - padding) / INDEX);
      x <= Math.floor((Math.max(a[0], b[0]) + padding) / INDEX);
      x++
    )
      for (
        let z = Math.floor((Math.min(a[1], b[1]) - padding) / INDEX);
        z <= Math.floor((Math.max(a[1], b[1]) + padding) / INDEX);
        z++
      ) {
        const id = `${x}:${z}`;
        if (!index.has(id)) index.set(id, []);
        index.get(id)!.push(s);
      }
  };
  for (const road of map.roads) {
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1],
        b = road.points[i];
      const bounds = survey?.bounds;
      if (
        bounds &&
        (Math.max(a[0], b[0]) < bounds.minX - 32 ||
          Math.min(a[0], b[0]) > bounds.maxX + 32 ||
          Math.max(a[2], b[2]) < bounds.minZ - 32 ||
          Math.min(a[2], b[2]) > bounds.maxZ + 32)
      )
        continue;
      add(
        [a[0], a[2]],
        [b[0], b[2]],
        road.width / 2,
        road.shoulderWidth ?? 0.8,
      );
    }
  }
  for (const drive of survey?.driveways ?? [])
    for (let i = 1; i < drive.points.length; i++)
      add(drive.points[i - 1], drive.points[i], drive.widthMeters / 2, 0.12);
  for (const b of map.buildings ?? []) {
    const source = b.points ?? b.footprint;
    if (source?.length >= 3)
      buildings.push(ring(source.map((p: number[]): XZ => [p[0], p[2]])));
  }
  for (const cover of survey?.landcover ?? [])
    if (cover.kind === "pond") ponds.push(ring(cover.points));
  const edgeDistance = (x: number, z: number) => {
    let best = Infinity;
    for (const s of index.get(key(x, z)) ?? [])
      best = Math.min(best, distance(x, z, s.a, s.b) - s.radius);
    return best;
  };
  const clear = (x: number, z: number, radius = 0) => {
    if (!propertyClear(x, z, radius)) return false;
    const b = survey?.bounds;
    if (
      !b ||
      !Number.isFinite(x + z + radius) ||
      radius < 0 ||
      x - radius < b.minX ||
      x + radius > b.maxX ||
      z - radius < b.minZ ||
      z + radius > b.maxZ
    )
      return false;
    // Asphalt is excluded by capsules, including the rounded road joins and all drive mouths.
    if (edgeDistance(x, z) < radius + 0.035) return false;
    for (const building of buildings) {
      const pad = radius + 0.85;
      if (
        x < building.minX - pad ||
        x > building.maxX + pad ||
        z < building.minZ - pad ||
        z > building.maxZ + pad
      )
        continue;
      if (ringDistance(x, z, building) < pad) return false;
    }
    // Keep the existing approximate pond bank as well as the exact source water polygon clear.
    for (const pond of ponds) {
      const pad = radius + 1.1;
      if (
        x < pond.minX - pad ||
        x > pond.maxX + pad ||
        z < pond.minZ - pad ||
        z > pond.maxZ + pad
      )
        continue;
      if (ringDistance(x, z, pond) < pad) return false;
    }
    return true;
  };
  return { clear, edgeDistance, segments };
}

/** Small procedural verge detail. No source-layout changes, colliders, new trees, or flat giant decals. */
export class BeverlyMicrodetail {
  readonly root = new T.Group();
  readonly stats = {
    grassBlades: 0,
    pebbles: 0,
    soilFragments: 0,
    leaves: 0,
    rootRibs: 0,
    grassTriangles: 0,
    groundTriangles: 0,
    totalTriangles: 0,
    batches: 0,
    visibleDrawCalls: 0,
    visibleTriangles: 0,
    treeContacts: 0,
    rejected: 0,
    maxPrimitiveRadiusMeters: 0,
  };
  private chunks: Chunk[] = [];
  private materials: T.MeshStandardMaterial[] = [];
  private quality: Quality;
  private cameraPosition = new T.Vector3();
  private time = { value: 0 };
  private distanceUniform = { value: range.high };
  private disposed = false;

  constructor(
    map: MapData,
    heightAt: (x: number, z: number) => number,
    options: BeverlyMicrodetailOptions = {},
  ) {
    this.quality = options.quality ?? "high";
    this.root.name = "Beverly grounded verge microdetail";
    this.root.userData.statistics = this.stats;
    this.root.userData.skipStaticBatch = true;
    this.root.userData.approximation =
      "Procedural centimeter-scale grass, soil, aggregates and litter. Existing road/driveway/building/water geometry is excluded; contact detail uses only retained observed tree centers. Not a surveyed surface or new tree placement.";
    const survey = map.beverlySurvey as Survey | undefined;
    if (!survey) return;
    const clearance = createBeverlyMicrodetailClearance(map);
    const batches = new Map<string, Batch>();
    const color = new T.Color();
    const covers = (survey.landcover ?? [])
      .filter((c) => c.kind !== "pond")
      .map((c) => ring(c.points));
    const woods = [
      ...(survey.woodlands ?? []),
      ...(survey.landcover ?? []).filter((c) => c.kind === "woodland-floor"),
    ].map((c) => ring(c.points));
    const under = (x: number, z: number, r: Ring) =>
      x >= r.minX &&
      x <= r.maxX &&
      z >= r.minZ &&
      z <= r.maxZ &&
      inside(x, z, r.points);
    const ground = (x: number, z: number) =>
      heightAt(x, z) + (covers.some((r) => under(x, z, r)) ? 0.041 : 0.009);
    const accept = (x: number, z: number, r: number) => {
      if (!clearance.clear(x, z, r)) {
        this.stats.rejected++;
        return false;
      }
      this.stats.maxPrimitiveRadiusMeters = Math.max(
        this.stats.maxPrimitiveRadiusMeters,
        r,
      );
      return true;
    };
    const target = (kind: Batch["kind"], x: number, z: number) => {
      const id = `${kind}:${key(x, z, CELL)}`;
      if (!batches.has(id))
        batches.set(id, {
          positions: [],
          colors: [],
          bases: [],
          primitives: [],
          kind,
          x: (Math.floor(x / CELL) + 0.5) * CELL,
          z: (Math.floor(z / CELL) + 0.5) * CELL,
        });
      return batches.get(id)!;
    };
    const emit = (
      kind: Batch["kind"],
      x: number,
      z: number,
      vertices: number[][],
      tint: number,
      base: number,
    ) => {
      const triangles = vertices.length / 3;
      const count =
        kind === "grass"
          ? this.stats.grassTriangles
          : this.stats.groundTriangles;
      if (count + triangles > (kind === "grass" ? GRASS_BUDGET : GROUND_BUDGET))
        return false;
      const b = target(kind, x, z);
      b.primitives.push({
        start: b.bases.length,
        count: vertices.length,
        order: hash(x, z, b.primitives.length + 417),
      });
      color.set(tint).multiplyScalar(0.83 + hash(x, z, 73) * 0.28);
      for (const p of vertices) {
        b.positions.push(...p);
        b.bases.push(base);
        const shade =
          kind === "grass"
            ? 0.74 + 0.26 * Math.min(1, Math.max(0, (p[1] - base) / 0.1))
            : 1;
        b.colors.push(color.r * shade, color.g * shade, color.b * shade);
      }
      if (kind === "grass") this.stats.grassTriangles += triangles;
      else this.stats.groundTriangles += triangles;
      return true;
    };
    const grass = (x: number, z: number, seed: number, short = false) => {
      const count = short ? 3 : 4;
      // Entire clump (including blade bend / shader wind) must fit the free ground disk.
      if (!accept(x, z, 0.28)) return;
      const dry = hash(x, z, seed + 90) > 0.92;
      for (let i = 0; i < count; i++) {
        const angle = hash(x + i, z, seed) * TAU;
        const ox = Math.sin(angle) * (0.05 + hash(x, z + i, seed + 2) * 0.1),
          oz = Math.cos(angle) * 0.13;
        const bx = x + ox,
          bz = z + oz,
          base = ground(bx, bz);
        const h =
          (short ? 0.055 : 0.08) +
          hash(x + i, z, seed + 3) * (short ? 0.095 : 0.14);
        const width = 0.009 + hash(x, z + i, seed + 4) * 0.017;
        const sx = Math.cos(angle) * width,
          sz = -Math.sin(angle) * width;
        const bend = 0.02 + hash(x + i, z, seed + 5) * 0.045;
        const mx = bx + Math.sin(angle) * bend * 0.4,
          mz = bz + Math.cos(angle) * bend * 0.4;
        const a = [bx - sx, ground(bx - sx, bz - sz), bz - sz],
          b = [bx + sx, ground(bx + sx, bz + sz), bz + sz];
        const c = [mx - sx * 0.52, base + h * 0.6, mz - sz * 0.52],
          d = [mx + sx * 0.52, base + h * 0.6, mz + sz * 0.52];
        const tip = [
          bx + Math.sin(angle) * bend,
          base + h,
          bz + Math.cos(angle) * bend,
        ];
        if (
          emit(
            "grass",
            x,
            z,
            [a, b, c, b, d, c, c, d, tip],
            dry ? 0x898957 : short ? 0x64773c : 0x59733b,
            base,
          )
        )
          this.stats.grassBlades++;
      }
    };
    const fragment = (
      x: number,
      z: number,
      radius: number,
      tint: number,
      lift: number,
    ) => {
      if (!accept(x, z, radius)) return;
      const vertices: number[][] = [];
      const base = ground(x, z) + lift;
      // Six uneven perimeter points avoid the old flat, four-sided paving-chip silhouette.
      const outline: XZ[] = [];
      const rotation = hash(x, z, 34) * TAU;
      for (let i = 0; i < 6; i++) {
        const angle =
          rotation + ((i + (hash(x + i, z, 35) - 0.5) * 0.5) * TAU) / 6;
        const reach = radius * (0.45 + hash(x + i, z, 40) * 0.49);
        outline.push([
          x + Math.cos(angle) * reach,
          z + Math.sin(angle) * reach,
        ]);
      }
      for (let i = 0; i < outline.length; i++) {
        const a = outline[i],
          b = outline[(i + 1) % outline.length];
        vertices.push(
          [x, base, z],
          [b[0], ground(...b) + lift, b[1]],
          [a[0], ground(...a) + lift, a[1]],
        );
      }
      if (emit("ground", x, z, vertices, tint, base))
        this.stats.soilFragments++;
    };
    const pebble = (x: number, z: number, seed: number) => {
      const size = 0.01 + hash(x, z, seed) * 0.026;
      if (!accept(x, z, size * 1.3)) return;
      // Road shoulder meshes sit 25mm above the DEM. Embed these tiny aggregates in that surface.
      const support = (px: number, pz: number) =>
        Math.max(ground(px, pz), heightAt(px, pz) + 0.026);
      const y = support(x, z);
      const yaw = hash(x, z, seed + 1) * TAU,
        c = Math.cos(yaw),
        s = Math.sin(yaw);
      const p = (px: number, pz: number): number[] => [
        x + (px * c - pz * s) * size,
        support(x + (px * c - pz * s) * size, z + (px * s + pz * c) * size),
        z + (px * s + pz * c) * size,
      ];
      const a = p(-1, -0.55),
        b = p(0.65, -0.75),
        d = p(0.85, 0.55),
        e = p(-0.6, 0.75),
        tip = [x, y + size * 0.42, z];
      if (
        emit(
          "ground",
          x,
          z,
          [a, b, tip, b, d, tip, d, e, tip, e, a, tip],
          hash(x, z, seed + 2) > 0.5 ? 0x77796e : 0x636b60,
          y,
        )
      )
        this.stats.pebbles++;
    };
    // Follow the existing edge without touching the asphalt, and vary the transition every few decimeters.
    for (const segment of clearance.segments) {
      const dx = segment.b[0] - segment.a[0],
        dz = segment.b[1] - segment.a[1],
        length = Math.hypot(dx, dz);
      if (length < 0.01) continue;
      const tx = dx / length,
        tz = dz / length,
        nx = -tz,
        nz = tx;
      for (let along = 0.25; along < length; along += 0.85)
        for (const side of [-1, 1]) {
          const cx = segment.a[0] + tx * along,
            cz = segment.a[1] + tz * along;
          const waviness =
            0.14 +
            0.12 * Math.sin(cx * 0.42 + cz * 0.24) +
            hash(cx, cz, 17) * 0.24;
          const off = segment.radius + segment.shoulder + waviness + 0.23;
          grass(cx + nx * off * side, cz + nz * off * side, 21, true);
          if (hash(cx, cz, side + 51) > 0.27) {
            const g =
              segment.radius +
              0.14 +
              hash(cx, cz, 36) * Math.max(0.04, segment.shoulder - 0.08);
            pebble(cx + nx * g * side, cz + nz * g * side, 39);
          }
          if (hash(cx, cz, side + 14) > 0.67) {
            const r = 0.025 + hash(cx, cz, 46) * 0.035,
              o = segment.radius + segment.shoulder + 0.12 + r;
            fragment(
              cx + nx * o * side,
              cz + nz * o * side,
              r,
              hash(cx, cz, 91) > 0.45 ? 0x60674e : 0x546044,
              0.001,
            );
          }
        }
    }
    // Seeded, spatially shuffled lawn samples prevent a budget cutoff favoring one side of the neighborhood.
    const candidates: { x: number; z: number; order: number }[] = [];
    for (let x = survey.bounds.minX + 1; x < survey.bounds.maxX; x += 1.7)
      for (let z = survey.bounds.minZ + 1; z < survey.bounds.maxZ; z += 1.7) {
        const px = x + (hash(x, z, 57) - 0.5) * 1.5,
          pz = z + (hash(x, z, 58) - 0.5) * 1.5;
        const edge = clearance.edgeDistance(px, pz);
        if (
          edge < 0.7 ||
          edge > 22 ||
          hash(x, z, 59) > 0.55 ||
          woods.some((r) => under(px, pz, r))
        )
          continue;
        candidates.push({ x: px, z: pz, order: hash(px, pz, 60) });
      }
    candidates.sort((a, b) => a.order - b.order);
    for (const p of candidates) {
      if (this.stats.grassTriangles >= GRASS_BUDGET - 12) break;
      grass(p.x, p.z, 65, clearance.edgeDistance(p.x, p.z) < 2.3);
    }
    // Contact debris is centered only on trees the vegetation renderer really retained.
    for (const tree of options.referenceCanopies ?? []) {
      if (
        tree.omitted ||
        !Number.isFinite(tree.radiusMeters) ||
        tree.radiusMeters <= 0
      )
        continue;
      const [cx, cz] = tree.center;
      if (!clearance.clear(cx, cz, 0.3)) continue;
      this.stats.treeContacts++;
      const area = Math.min(2.6, tree.radiusMeters * 0.5);
      for (let i = 0; i < 65; i++) {
        const a = hash(cx + i, cz, 71) * TAU,
          r = 0.25 + Math.sqrt(hash(cx, cz + i, 72)) * area;
        const x = cx + Math.sin(a) * r,
          z = cz + Math.cos(a) * r;
        if (i % 7 === 0)
          fragment(
            x,
            z,
            0.04 + hash(x, z, 73) * 0.065,
            tree.type === "conifer" ? 0x62533b : 0x5e6040,
            0.004,
          );
        const size = 0.035 + hash(x, z, 74) * 0.045;
        if (!accept(x, z, size * 1.2)) continue;
        const yaw = hash(x, z, 75) * TAU,
          sx = Math.cos(yaw) * size,
          sz = Math.sin(yaw) * size;
        const width = tree.type === "conifer" ? 0.003 : size * 0.44,
          wx = -Math.sin(yaw) * width,
          wz = Math.cos(yaw) * width;
        const a0 = [x - sx, ground(x - sx, z - sz) + 0.014, z - sz],
          tip = [x + sx, ground(x + sx, z + sz) + 0.017, z + sz];
        const left = [x + wx, ground(x + wx, z + wz) + 0.024, z + wz],
          right = [x - wx, ground(x - wx, z - wz) + 0.02, z - wz];
        if (
          emit(
            "ground",
            x,
            z,
            [a0, left, tip, a0, tip, right],
            tree.type === "conifer" ? 0x796347 : 0x7b7043,
            ground(x, z),
          )
        )
          this.stats.leaves++;
      }
      // Low, tapered buttress accents: small enough to merge with the existing trunk base.
      for (let i = 0; i < 4; i++) {
        const a = hash(cx, cz, i + 92) * TAU,
          r0 = 0.2,
          r1 = Math.min(1.25, 0.5 + tree.radiusMeters * 0.06);
        const ax = cx + Math.sin(a) * r0,
          az = cz + Math.cos(a) * r0,
          bx = cx + Math.sin(a) * r1,
          bz = cz + Math.cos(a) * r1;
        const x = (ax + bx) / 2,
          z = (az + bz) / 2,
          r = (r1 - r0) / 2 + 0.12;
        if (!accept(x, z, r)) continue;
        const nx = Math.cos(a) * 0.075,
          nz = -Math.sin(a) * 0.075;
        const left = [ax + nx, ground(ax + nx, az + nz) + 0.008, az + nz],
          right = [ax - nx, ground(ax - nx, az - nz) + 0.008, az - nz];
        const top = [ax, ground(ax, az) + 0.105, az],
          end = [bx, ground(bx, bz) + 0.008, bz];
        if (
          emit(
            "ground",
            x,
            z,
            [left, top, end, top, right, end],
            0x62533d,
            ground(x, z),
          )
        )
          this.stats.rootRibs++;
      }
    }

    const grassMaterial = new T.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.97,
      side: T.DoubleSide,
      envMapIntensity: 0.18,
    });
    grassMaterial.name = "Beverly fine living grass";
    grassMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.microTime = this.time;
      shader.uniforms.microCamera = { value: this.cameraPosition };
      shader.uniforms.microDistance = this.distanceUniform;
      shader.vertexShader =
        "attribute float microBase; uniform float microTime; uniform vec3 microCamera; uniform float microDistance;\n" +
        shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        float microFade=1.0-smoothstep(microDistance*.72,microDistance,distance(position.xz,microCamera.xz));
        float microHeight=max(0.0,position.y-microBase);
        transformed.y=microBase+microHeight*microFade;
        transformed.x+=sin(microTime*1.3+position.x*.53+position.z*.44)*microHeight*.06*microFade;
      `,
      );
    };
    grassMaterial.customProgramCacheKey = () =>
      "beverly-grounded-micrograss-v1";
    const groundMaterial = new T.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      side: T.DoubleSide,
      envMapIntensity: 0.12,
    });
    groundMaterial.name = "Beverly fine mineral and tree litter";
    this.materials.push(grassMaterial, groundMaterial);
    for (const b of batches.values()) {
      if (!b.positions.length) continue;
      // Keep each blade/stone intact while distributing reduced-quality samples across the chunk.
      const positions: number[] = [],
        colors: number[] = [],
        bases: number[] = [];
      b.primitives.sort((a, c) => a.order - c.order);
      for (const p of b.primitives)
        for (let i = p.start; i < p.start + p.count; i++) {
          positions.push(
            b.positions[i * 3],
            b.positions[i * 3 + 1],
            b.positions[i * 3 + 2],
          );
          colors.push(
            b.colors[i * 3],
            b.colors[i * 3 + 1],
            b.colors[i * 3 + 2],
          );
          bases.push(b.bases[i]);
        }
      const geo = new T.BufferGeometry();
      geo.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
      geo.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
      if (b.kind === "grass")
        geo.setAttribute("microBase", new T.Float32BufferAttribute(bases, 1));
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      const mesh = new T.Mesh(
        geo,
        b.kind === "grass" ? grassMaterial : groundMaterial,
      );
      mesh.name = `Beverly ${b.kind} detail ${b.x},${b.z}`;
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.userData.skipStaticBatch = true;
      this.root.add(mesh);
      this.chunks.push({
        mesh,
        kind: b.kind,
        x: b.x,
        z: b.z,
        vertices: b.positions.length / 3,
      });
    }
    this.stats.totalTriangles =
      this.stats.grassTriangles + this.stats.groundTriangles;
    this.stats.batches = this.chunks.length;
    this.setQuality(this.quality);
  }

  setQuality(quality: Quality) {
    this.quality = quality;
    this.distanceUniform.value = range[quality];
    for (const c of this.chunks) {
      // Triangles remain complete at every quality; no new geometry or material allocations.
      c.mesh.geometry.setDrawRange(
        0,
        Math.floor((c.vertices * density[quality]) / 3) * 3,
      );
    }
  }
  update(time: number, camera: T.Camera) {
    if (this.disposed) return;
    this.time.value = time;
    camera.getWorldPosition(this.cameraPosition);
    this.stats.visibleDrawCalls = 0;
    this.stats.visibleTriangles = 0;
    for (const c of this.chunks) {
      const dx = Math.max(0, Math.abs(this.cameraPosition.x - c.x) - CELL / 2);
      const dz = Math.max(0, Math.abs(this.cameraPosition.z - c.z) - CELL / 2);
      c.mesh.visible = Math.hypot(dx, dz) < range[this.quality];
      if (c.mesh.visible) {
        this.stats.visibleDrawCalls++;
        this.stats.visibleTriangles += c.mesh.geometry.drawRange.count / 3;
      }
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const c of this.chunks) c.mesh.geometry.dispose();
    for (const m of this.materials) m.dispose();
    this.chunks = [];
    this.materials = [];
    this.root.clear();
  }
}
