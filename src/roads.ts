import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import RAPIER from "@dimforge/rapier3d-compat";
import type { MapData, Point, Road } from "./types";
import { clamp } from "./types";
/** Matches the terrain mesh's diagonal exactly, including its outermost vertices. */
export function heightAt(map: MapData, x: number, z: number) {
  const g = map.terrain;
  if (!g) return 0;
  const u = clamp(
      ((x - g.minX) / (g.maxX - g.minX)) * (g.cols - 1),
      0,
      g.cols - 1,
    ),
    v = clamp(((z - g.minZ) / (g.maxZ - g.minZ)) * (g.rows - 1), 0, g.rows - 1),
    a = Math.min(g.cols - 2, Math.floor(u)),
    b = Math.min(g.rows - 2, Math.floor(v)),
    fx = u - a,
    fz = v - b,
    h00 = g.heights[b * g.cols + a],
    h10 = g.heights[b * g.cols + a + 1],
    h01 = g.heights[(b + 1) * g.cols + a],
    h11 = g.heights[(b + 1) * g.cols + a + 1];
  return fx + fz <= 1
    ? h00 + (h10 - h00) * fx + (h01 - h00) * fz
    : h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
}
export function nearestRoad(map: MapData, x: number, z: number) {
  let best = {
    distance: Infinity,
    position: [0, 0, 0] as Point,
    heading: 0,
    road: map.roads[0],
    side: 0,
  };
  for (const road of map.roads)
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1],
        b = road.points[i],
        dx = b[0] - a[0],
        dz = b[2] - a[2],
        len2 = dx * dx + dz * dz,
        t = clamp(((x - a[0]) * dx + (z - a[2]) * dz) / (len2 || 1), 0, 1);
      const px = a[0] + dx * t,
        pz = a[2] + dz * t,
        d = Math.hypot(x - px, z - pz);
      if (d < best.distance)
        best = {
          distance: d,
          position: [px, a[1] + (b[1] - a[1]) * t, pz],
          heading: Math.atan2(dx, dz),
          road,
          side: ((x - px) * dz - (z - pz) * dx) / Math.sqrt(len2 || 1),
        };
    }
  return best;
}
export function makeTestMap(): MapData {
  const points: Point[] = [];
  for (let i = 0; i <= 100; i++) {
    const a = (i / 100) * Math.PI * 2;
    points.push([Math.sin(a) * 90, 0, Math.cos(a) * 90]);
  }
  return {
    name: "Handling grounds",
    roads: [
      { id: "circle", name: "Constant-radius turn", width: 16, points },
      {
        id: "straight",
        name: "Brake & slalom straight",
        width: 24,
        points: [
          [-150, 0, -170],
          [-150, 0, 170],
        ],
      },
    ],
    home: { position: [-150, 0, -140], heading: 0 },
    route: {
      name: "Handling loop",
      type: "circuit",
      points,
      streets: ["Test grounds"],
      laps: 3,
    },
    bounds: { minX: -230, maxX: 230, minZ: -230, maxZ: 230 },
  };
}
export type HeightSampler = ((x: number, z: number) => number) & {
  terrain?: MapData["terrain"];
};
function terrainSampler(map: MapData): HeightSampler {
  return Object.assign((x: number, z: number) => heightAt(map, x, z), {
    terrain: map.terrain,
  });
}

/** Clip a convex ground polygon to a half-plane. Intersections preserve source grade. */
function clipPolygon(
  polygon: Point[],
  distance: (p: Point) => number,
): Point[] {
  const output: Point[] = [];
  if (polygon.length < 3) return output;
  let previous = polygon[polygon.length - 1],
    previousD = distance(previous);
  for (const current of polygon) {
    const currentD = distance(current),
      inside = currentD >= -1e-7,
      previousInside = previousD >= -1e-7;
    if (inside !== previousInside) {
      const t = previousD / (previousD - currentD);
      output.push([
        previous[0] + (current[0] - previous[0]) * t,
        previous[1] + (current[1] - previous[1]) * t,
        previous[2] + (current[2] - previous[2]) * t,
      ]);
    }
    if (inside) output.push(current);
    previous = current;
    previousD = currentD;
  }
  return output;
}

/** Drape polygons onto exactly the same triangles as the terrain, avoiding buried road edges. */
function surfaceGeometry(
  polygons: Point[][],
  offset: number,
  sample?: HeightSampler,
): T.BufferGeometry {
  const vertices: number[] = [];
  const emit = (polygon: Point[]) => {
    if (polygon.length < 3) return;
    for (let i = 1; i < polygon.length - 1; i++) {
      const a = polygon[0],
        b = polygon[i],
        c = polygon[i + 1];
      if (
        Math.abs(
          (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]),
        ) < 1e-8
      )
        continue;
      for (const p of [a, c, b])
        vertices.push(
          p[0],
          (sample ? sample(p[0], p[2]) : p[1]) + offset,
          p[2],
        );
    }
  };
  const grid = sample?.terrain;
  for (const polygon of polygons) {
    if (!grid) {
      emit(polygon);
      continue;
    }
    const dx = (grid.maxX - grid.minX) / (grid.cols - 1),
      dz = (grid.maxZ - grid.minZ) / (grid.rows - 1);
    const minX = Math.min(...polygon.map((p) => p[0])),
      maxX = Math.max(...polygon.map((p) => p[0])),
      minZ = Math.min(...polygon.map((p) => p[2])),
      maxZ = Math.max(...polygon.map((p) => p[2]));
    const firstX = clamp(Math.floor((minX - grid.minX) / dx), 0, grid.cols - 2),
      lastX = clamp(Math.floor((maxX - grid.minX) / dx), 0, grid.cols - 2),
      firstZ = clamp(Math.floor((minZ - grid.minZ) / dz), 0, grid.rows - 2),
      lastZ = clamp(Math.floor((maxZ - grid.minZ) / dz), 0, grid.rows - 2);
    for (let row = firstZ; row <= lastZ; row++)
      for (let col = firstX; col <= lastX; col++) {
        const x = grid.minX + col * dx,
          z = grid.minZ + row * dz;
        let clipped = clipPolygon(polygon, (p) => p[0] - x);
        clipped = clipPolygon(clipped, (p) => x + dx - p[0]);
        clipped = clipPolygon(clipped, (p) => p[2] - z);
        clipped = clipPolygon(clipped, (p) => z + dz - p[2]);
        if (clipped.length < 3) continue;
        const diagonal = (p: Point) => 1 - (p[0] - x) / dx - (p[2] - z) / dz;
        emit(clipPolygon(clipped, diagonal));
        emit(clipPolygon(clipped, (p) => -diagonal(p)));
      }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}
function surfaceMesh(
  polygons: Point[][],
  color: number,
  offset = 0,
  sample?: HeightSampler,
) {
  const m = new T.Mesh(
    surfaceGeometry(polygons, offset, sample),
    new T.MeshStandardMaterial({ color, roughness: 0.97, side: T.DoubleSide }),
  );
  m.receiveShadow = true;
  return m;
}
export function roadMesh(
  points: Point[],
  width: number,
  color: number,
  offset = 0,
  sample?: HeightSampler,
) {
  const polygons: Point[][] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      dx = b[0] - a[0],
      dz = b[2] - a[2],
      length = Math.hypot(dx, dz);
    if (length < 0.001) continue;
    const nx = ((dz / length) * width) / 2,
      nz = ((-dx / length) * width) / 2;
    polygons.push([
      [a[0] - nx, a[1], a[2] - nz],
      [a[0] + nx, a[1], a[2] + nz],
      [b[0] + nx, b[1], b[2] + nz],
      [b[0] - nx, b[1], b[2] - nz],
    ]);
  }
  return surfaceMesh(polygons, color, offset, sample);
}
export function roadJoins(
  points: Point[],
  width: number,
  color: number,
  offset: number,
  sample?: HeightSampler,
) {
  const polygons = points.map((p) =>
    Array.from({ length: 12 }, (_, i): Point => {
      const angle = (i / 12) * Math.PI * 2;
      return [
        p[0] + (Math.cos(angle) * width) / 2,
        p[1],
        p[2] + (Math.sin(angle) * width) / 2,
      ];
    }),
  );
  return surfaceMesh(polygons, color, offset, sample);
}
export function textSign(
  text: string,
  color = "#e7e9db",
  background = "#244342",
) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 96;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, 512, 96);
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.strokeRect(5, 5, 502, 86);
  ctx.fillStyle = color;
  ctx.font = "bold 31px Arial";
  ctx.textAlign = "center";
  ctx.fillText(text.slice(0, 27), 256, 60);
  const tex = new T.CanvasTexture(c);
  tex.colorSpace = T.SRGBColorSpace;
  const obj = new T.Sprite(new T.SpriteMaterial({ map: tex }));
  obj.scale.set(4, 0.75, 1);
  return obj;
}
export class Environment {
  root = new T.Group();
  colliders: RAPIER.Collider[] = [];
  cameraObstacles: T.Object3D[] = [];
  constructor(
    public map: MapData,
    public world: RAPIER.World,
    public test = false,
  ) {
    this.build();
  }
  collider(mesh: T.Mesh) {
    const p = mesh.geometry.getAttribute("position");
    const positions = new Float32Array(p.array);
    const index =
      mesh.geometry.index?.array ||
      Array.from({ length: p.count }, (_, i) => i);
    this.colliders.push(
      this.world.createCollider(
        RAPIER.ColliderDesc.trimesh(
          positions,
          new Uint32Array(index),
        ).setFriction(0.75),
      ),
    );
  }
  box(p: Point, size: Point, color: number, collision = true, heading = 0) {
    const m = new T.Mesh(
      new T.BoxGeometry(...size),
      new T.MeshStandardMaterial({ color, roughness: 0.85 }),
    );
    m.position.set(...p);
    m.rotation.y = heading;
    m.castShadow = true;
    m.receiveShadow = true;
    this.root.add(m);
    if (collision) {
      this.colliders.push(
        this.world.createCollider(
          RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2)
            .setTranslation(...p)
            .setRotation({
              x: 0,
              y: Math.sin(heading / 2),
              z: 0,
              w: Math.cos(heading / 2),
            })
            .setFriction(0.28),
        ),
      );
      this.cameraObstacles.push(m);
    }
    return m;
  }
  private house(building: any, index: number) {
    const points: Point[] = building.points || building.footprint;
    if (!points?.length) return;
    // Use the footprint's longest edge for orientation instead of inflating rotated houses into large axis-aligned boxes.
    let longest = 0,
      heading = 0;
    for (let i = 1; i < points.length; i++) {
      const dx = points[i][0] - points[i - 1][0],
        dz = points[i][2] - points[i - 1][2],
        length = dx * dx + dz * dz;
      if (length > longest) {
        longest = length;
        heading = Math.atan2(dx, dz);
      }
    }
    const origin = points[0],
      cos = Math.cos(heading),
      sin = Math.sin(heading),
      local = points.map((p) => [
        (p[0] - origin[0]) * cos - (p[2] - origin[2]) * sin,
        (p[0] - origin[0]) * sin + (p[2] - origin[2]) * cos,
      ]);
    const xs = local.map((p) => p[0]),
      zs = local.map((p) => p[1]),
      minX = Math.min(...xs),
      maxX = Math.max(...xs),
      minZ = Math.min(...zs),
      maxZ = Math.max(...zs),
      centerX = (minX + maxX) / 2,
      centerZ = (minZ + maxZ) / 2;
    const x = origin[0] + centerX * cos + centerZ * sin,
      z = origin[2] - centerX * sin + centerZ * cos;
    let width = Math.max(4, maxX - minX),
      depth = Math.max(4, maxZ - minZ);
    const nearby = nearestRoad(this.map, x, z),
      normalX = Math.cos(nearby.heading),
      normalZ = -Math.sin(nearby.heading),
      extent =
        (Math.abs(normalX * cos - normalZ * sin) * width) / 2 +
        (Math.abs(normalX * sin + normalZ * cos) * depth) / 2;
    const available = nearby.distance - (nearby.road?.width ?? 8) / 2 - 2;
    const scale = Math.min(1, available / Math.max(1, extent));
    // Generic address envelopes are approximations: trim/omit an envelope rather than obstruct a mapped road.
    if (scale < 0.4) return;
    width *= scale;
    depth *= scale;
    const point = (lx: number, ly: number, lz: number): Point => [
      x + lx * cos + lz * sin,
      ly,
      z - lx * sin + lz * cos,
    ];
    const corners = [
      point(-width / 2, 0, -depth / 2),
      point(width / 2, 0, -depth / 2),
      point(width / 2, 0, depth / 2),
      point(-width / 2, 0, depth / 2),
    ].map((p) => heightAt(this.map, p[0], p[2]));
    const low = Math.min(...corners) - 0.15,
      base = Math.max(...corners),
      wallHeight = Math.max(2.8, (building.height || 5) * 0.72),
      wallTop = base + wallHeight;
    const walls = [0xc9c0ab, 0xc6cbd0, 0xb4b7a7, 0xd1c7b4, 0xb6a89e],
      roofs = [0x555b5b, 0x685c55, 0x555e68];
    this.box(
      [x, (low + wallTop) / 2, z],
      [width, wallTop - low, depth],
      walls[index % walls.length],
      true,
      heading,
    );
    const w = width / 2 + 0.35,
      d = depth / 2 + 0.35,
      rise = Math.min(2.7, Math.max(1, width * 0.22));
    const roofPoints: Point[] = [
        [-w, 0, -d],
        [w, 0, -d],
        [0, rise, -d],
        [-w, 0, d],
        [w, 0, d],
        [0, rise, d],
      ],
      roofVertices: number[] = [];
    for (const tri of [
      [0, 1, 2],
      [5, 4, 3],
      [0, 2, 5],
      [0, 5, 3],
      [2, 1, 4],
      [2, 4, 5],
      [0, 3, 4],
      [0, 4, 1],
    ])
      for (const n of tri) roofVertices.push(...roofPoints[n]);
    const roofGeometry = new T.BufferGeometry();
    roofGeometry.setAttribute(
      "position",
      new T.Float32BufferAttribute(roofVertices, 3),
    );
    roofGeometry.computeVertexNormals();
    const roof = new T.Mesh(
      roofGeometry,
      new T.MeshStandardMaterial({
        color: roofs[index % roofs.length],
        roughness: 0.95,
        side: T.DoubleSide,
      }),
    );
    roof.position.set(x, wallTop, z);
    roof.rotation.y = heading;
    roof.castShadow = true;
    roof.receiveShadow = true;
    this.root.add(roof);
    // Materials, facades and roof pitch are intentionally generic, not assertions about the real houses.
    for (const side of [-1, 1])
      for (const lx of [-width * 0.25, width * 0.25])
        this.box(
          point(lx, base + wallHeight * 0.6, side * (depth / 2 + 0.035)),
          [Math.min(1.45, width * 0.2), 1.25, 0.08],
          0x405761,
          false,
          heading,
        );
    const roadFacing =
      (nearby.position[0] - x) * sin + (nearby.position[2] - z) * cos >= 0
        ? 1
        : -1;
    this.box(
      point(0, base + 1.05, roadFacing * (depth / 2 + 0.04)),
      [1, 2.1, 0.1],
      0x715b48,
      false,
      heading,
    );
  }
  build() {
    const map = this.map,
      b = map.bounds,
      grid = map.terrain ?? b,
      sample = terrainSampler(map);
    const cols = map.terrain?.cols || 30,
      rows = map.terrain?.rows || 30;
    const verts: number[] = [],
      idx: number[] = [];
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) {
        const x = grid.minX + ((grid.maxX - grid.minX) * i) / (cols - 1),
          z = grid.minZ + ((grid.maxZ - grid.minZ) * j) / (rows - 1);
        verts.push(x, heightAt(map, x, z) - 0.03, z);
        if (i < cols - 1 && j < rows - 1) {
          const a = j * cols + i;
          idx.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
        }
      }
    const terrain = new T.BufferGeometry();
    terrain.setAttribute("position", new T.Float32BufferAttribute(verts, 3));
    terrain.setIndex(idx);
    terrain.computeVertexNormals();
    const ground = new T.Mesh(
      terrain,
      new T.MeshStandardMaterial({
        color: this.test ? 0x76846b : 0x76905f,
        roughness: 1,
      }),
    );
    ground.receiveShadow = true;
    this.root.add(ground);
    this.collider(ground);
    for (const road of map.roads) {
      if (road.points.length < 2) continue;
      const roadSample = road.bridge ? undefined : sample;
      this.root.add(
        roadMesh(road.points, road.width + 2.5, 0xaba48b, 0.025, roadSample),
      );
      this.root.add(
        roadJoins(road.points, road.width + 2.5, 0xaba48b, 0.025, roadSample),
      );
      const asphalt = roadMesh(
          road.points,
          road.width,
          0x394143,
          0.065,
          roadSample,
        ),
        joins = roadJoins(road.points, road.width, 0x394143, 0.065, roadSample);
      this.root.add(asphalt, joins);
      this.collider(asphalt);
      this.collider(joins);
      // Both join rims and strips follow terrain facets; the colliders use these exact meshes.
      // Bridges preserve their imported deck grade rather than snapping down to terrain.
      if (road.width >= 7) {
        const line = roadMesh(road.points, 0.12, 0xc9b66c, 0.079, roadSample);
        this.root.add(line);
      }
    }
    // OSM footprints/address points determine placement; facades, roofs and materials are approximations.
    (map.buildings || []).forEach((building, index) =>
      this.house(building, index),
    );
    let seed = 442;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const trees: Point[] = [];
    const count = this.test ? 70 : 2200;
    for (let i = 0; i < count * 2 && trees.length < count; i++) {
      const x = b.minX + random() * (b.maxX - b.minX),
        z = b.minZ + random() * (b.maxZ - b.minZ);
      if (nearestRoad(map, x, z).distance < 13) continue;
      trees.push([x, heightAt(map, x, z), z]);
    }
    const trunks = new T.InstancedMesh(
        new T.CylinderGeometry(0.24, 0.36, 4, 5),
        new T.MeshStandardMaterial({ color: 0x665c46 }),
        trees.length,
      ),
      leaves = new T.InstancedMesh(
        new T.IcosahedronGeometry(3.5, 0),
        new T.MeshStandardMaterial({ color: 0x365b3e, roughness: 1 }),
        trees.length,
      ),
      dummy = new T.Object3D();
    trees.forEach((p, i) => {
      const s = 0.75 + random() * 0.9;
      dummy.position.set(p[0], p[1] + 2, p[2]);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);
      dummy.position.y = p[1] + 5.2 * s;
      dummy.scale.set(s, 1.3 * s, s);
      dummy.updateMatrix();
      leaves.setMatrixAt(i, dummy.matrix);
      leaves.setColorAt(
        i,
        new T.Color().setHSL(
          0.22 + random() * 0.1,
          0.28,
          0.24 + random() * 0.15,
        ),
      );
    });
    trunks.castShadow = true;
    leaves.castShadow = true;
    this.root.add(trunks, leaves);
    const home = textSign(
      this.test ? "HANDLING GROUNDS" : "HOME · BEVERLY DRIVE",
      "#fff4d8",
      "#4c6470",
    );
    home.position.set(
      map.home.position[0] + 7,
      heightAt(map, map.home.position[0] + 7, map.home.position[2]) + 3,
      map.home.position[2],
    );
    this.root.add(home);
    const named = new Set<string>();
    for (const road of map.roads) {
      if (!road.name || named.has(road.name) || !road.points.length) continue;
      named.add(road.name);
      const i = Math.floor(road.points.length / 2),
        p = road.points[i],
        next = road.points[Math.min(i + 1, road.points.length - 1)],
        previous = road.points[Math.max(0, i - 1)],
        heading = Math.atan2(next[0] - previous[0], next[2] - previous[2]),
        x = p[0] + Math.cos(heading) * (road.width / 2 + 2.5),
        z = p[2] - Math.sin(heading) * (road.width / 2 + 2.5);
      const sign = textSign(road.name);
      sign.scale.multiplyScalar(0.75);
      sign.position.set(x, heightAt(map, x, z) + 2.5, z);
      this.root.add(sign);
    }
    // Visible edge fencing plus automatic recovery beyond the cached terrain.
    const fenceMat = 0xb9ae8d;
    for (const x of [b.minX, b.maxX]) {
      const pts: Point[] = [];
      for (let z = b.minZ; z <= b.maxZ; z += 20)
        pts.push([x, heightAt(map, x, z) + 0.7, z]);
      this.root.add(roadMesh(pts, 0.6, fenceMat));
    }
    for (const z of [b.minZ, b.maxZ]) {
      const pts: Point[] = [];
      for (let x = b.minX; x <= b.maxX; x += 20)
        pts.push([x, heightAt(map, x, z) + 0.7, z]);
      this.root.add(roadMesh(pts, 0.6, fenceMat));
    }
    if (this.test) {
      for (let i = 0; i < 9; i++)
        this.box(
          [-150 + (i % 2 ? 5 : -5), 0.7, -100 + i * 22],
          [1.1, 1.4, 1.1],
          0xdd783f,
        );
      for (const x of [-168, -132])
        this.box([x, 0.8, 0], [1.2, 1.6, 340], 0xd4cdb7);
      this.box([0, 1, 150], [100, 2, 1.5], 0xd4cdb7);
      const ramp = new T.Mesh(
        new T.BoxGeometry(12, 0.6, 25),
        new T.MeshStandardMaterial({ color: 0x827b6a }),
      );
      ramp.position.set(-110, 2, 70);
      ramp.rotation.x = -0.16;
      ramp.updateMatrix();
      ramp.geometry.applyMatrix4(ramp.matrix);
      ramp.position.set(0, 0, 0);
      ramp.rotation.set(0, 0, 0);
      this.root.add(ramp);
      this.collider(ramp);
      const s = textSign("RAMP →");
      s.position.set(-118, 3, 45);
      this.root.add(s);
    }
    this.batchStaticMeshes();
  }
  /** A few material batches replace thousands of static road/building draw calls. */
  private batchStaticMeshes() {
    const batches = new Map<
        string,
        {
          geometries: T.BufferGeometry[];
          material: T.MeshStandardMaterial;
          cast: boolean;
          receive: boolean;
          obstacle: boolean;
        }
      >(),
      obstacles = new Set(this.cameraObstacles),
      disposedMaterials = new Set<T.Material>();
    this.cameraObstacles = [];
    for (const mesh of [...this.root.children]) {
      if (
        !(mesh instanceof T.Mesh) ||
        mesh instanceof T.InstancedMesh ||
        !(mesh.material instanceof T.MeshStandardMaterial)
      )
        continue;
      const material = mesh.material,
        key = [
          material.color.getHex(),
          material.roughness,
          material.metalness,
          material.side,
          material.opacity,
          material.transparent,
          mesh.castShadow,
          mesh.receiveShadow,
        ].join(":");
      let batch = batches.get(key);
      if (!batch) {
        batch = {
          geometries: [],
          material: material.clone(),
          cast: mesh.castShadow,
          receive: mesh.receiveShadow,
          obstacle: false,
        };
        batches.set(key, batch);
      }
      const geometry = mesh.geometry.index
        ? mesh.geometry.toNonIndexed()
        : mesh.geometry.clone();
      for (const name of Object.keys(geometry.attributes))
        if (name !== "position" && name !== "normal")
          geometry.deleteAttribute(name);
      geometry.clearGroups();
      mesh.updateMatrix();
      geometry.applyMatrix4(mesh.matrix);
      batch.geometries.push(geometry);
      batch.obstacle ||= obstacles.has(mesh);
      this.root.remove(mesh);
      mesh.geometry.dispose();
      disposedMaterials.add(material);
    }
    for (const batch of batches.values()) {
      const geometry = mergeGeometries(batch.geometries, false);
      for (const source of batch.geometries) source.dispose();
      if (!geometry) {
        batch.material.dispose();
        continue;
      }
      geometry.computeBoundingSphere();
      const mesh = new T.Mesh(geometry, batch.material);
      mesh.castShadow = batch.cast;
      mesh.receiveShadow = batch.receive;
      this.root.add(mesh);
      if (batch.obstacle) this.cameraObstacles.push(mesh);
    }
    for (const material of disposedMaterials) material.dispose();
  }
  dispose() {
    for (const c of this.colliders) this.world.removeCollider(c, true);
    this.colliders = [];
    const materials = new Set<T.Material>();
    this.root.traverse((o) => {
      if (o instanceof T.Mesh) o.geometry.dispose();
      if (o instanceof T.Mesh || o instanceof T.Sprite)
        for (const material of Array.isArray(o.material)
          ? o.material
          : [o.material])
          materials.add(material);
    });
    for (const material of materials) {
      const map = (material as T.MeshStandardMaterial | T.SpriteMaterial).map;
      map?.dispose();
      material.dispose();
    }
    this.root.clear();
  }
}
