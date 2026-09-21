import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import RAPIER from "@dimforge/rapier3d-compat";
import type { MapData, Point, Road } from "./types";
import { clamp } from "./types";
import { createSurfaceMaterials, worldUV } from "./materials";
import { Vegetation } from "./vegetation";
import { buildNeighborhood, type NeighborhoodHouse } from "./neighborhood";
import { buildRoadside } from "./roadside";
import { buildBeverlyDetails } from "./beverly-details";
import { BeverlyMicrodetail } from "./beverly-microdetail";
import { buildPropertyDetails } from "./property-details";
import { createDrivewayQuery } from "./property-footprints";
import { getHomeFrame, HOME_BUILDING_ID, HOME_DETAIL } from "./home-reference";
import { buildHomeHouse } from "./home-house";
import { buildHomeYard } from "./home-yard";
import { buildHomeTrees } from "./home-trees";
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
/** Trace the actual pavement outline, retaining concave aprons and parking areas. */
export function groundPolygonMesh(
  points: [number, number][],
  color: number,
  offset: number,
  sample: HeightSampler,
) {
  const ring = points.map(([x, z]) => new T.Vector2(x, z));
  const triangles = T.ShapeUtils.triangulateShape(ring, []);
  const polygons = triangles.map((indices) => {
    const polygon = indices.map((i) => [ring[i].x, 0, ring[i].y] as Point);
    const [a, b, c] = polygon;
    if ((b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]) < 0)
      polygon.reverse();
    return polygon;
  });
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
  obj.scale.set(2.8, 0.525, 1);
  return obj;
}
export class Environment {
  root = new T.Group();
  isDriveway: (x: number, z: number) => boolean;
  colliders: RAPIER.Collider[] = [];
  cameraObstacles: T.Object3D[] = [];
  private homeCameraFrame?: T.Matrix4;
  private homeCameraVolumes: T.Box3[] = [];
  materials = createSurfaceMaterials();
  vegetation?: Vegetation;
  microdetail?: BeverlyMicrodetail;
  private houses: NeighborhoodHouse[] = [];
  constructor(
    public map: MapData,
    public world: RAPIER.World,
    public test = false,
  ) {
    this.isDriveway = createDrivewayQuery(map);
    this.build();
  }
  /** Continuous camera envelopes avoid slipping between the deck's balusters. */
  cameraDistance(origin: T.Vector3, direction: T.Vector3, maximum: number) {
    if (!this.homeCameraFrame) return;
    const ray = new T.Ray(origin.clone(), direction.clone()).applyMatrix4(
      this.homeCameraFrame,
    );
    let nearest: number | undefined;
    for (const volume of this.homeCameraVolumes) {
      const hit = ray.intersectBox(volume, new T.Vector3());
      if (!hit) continue;
      const distance = volume.containsPoint(ray.origin)
        ? 0
        : ray.origin.distanceTo(hit);
      if (distance <= maximum && (nearest === undefined || distance < nearest))
        nearest = distance;
    }
    return nearest;
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
    if (building.renderParts?.length) {
      // Keep the surveyed outline authoritative, but fit separate wings rather
      // than filling an observed L-shaped courtyard with one rectangular box.
      const baseHeight = Math.max(
        ...building.points.map((p: Point) => heightAt(this.map, p[0], p[2])),
      );
      for (const [partIndex, part] of building.renderParts.entries())
        this.house(
          {
            ...building,
            id: `${building.id}:${part.id}`,
            appearanceId: building.id,
            points: part.points,
            renderParts: undefined,
            baseHeight,
            reference: {
              ...building.reference,
              entrance:
                part.entrance ?? partIndex === building.renderParts.length - 1,
            },
          },
          index,
        );
      return;
    }
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
    let width = Math.max(building.reference ? 2 : 4, maxX - minX),
      depth = Math.max(building.reference ? 2 : 4, maxZ - minZ);
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
      base = building.baseHeight ?? Math.max(...corners),
      wallHeight =
        building.wallHeight ?? Math.max(2.8, (building.height || 5) * 0.72),
      wallTop =
        building.id === HOME_BUILDING_ID
          ? getHomeFrame(this.map, (x, z) => heightAt(this.map, x, z))!.eaveY
          : base + wallHeight;
    // Detailed facades share the original, road-clear collision envelope.
    this.colliders.push(
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(width / 2, (wallTop - low) / 2, depth / 2)
          .setTranslation(x, (low + wallTop) / 2, z)
          .setRotation({
            x: 0,
            y: Math.sin(heading / 2),
            z: 0,
            w: Math.cos(heading / 2),
          })
          .setFriction(0.28),
      ),
    );
    this.houses.push({
      id: building.id ?? index,
      appearanceId: building.appearanceId,
      x,
      z,
      width,
      depth,
      heading,
      base,
      low,
      wallHeight,
      roadPosition: nearby.position,
      roadWidth: nearby.road?.width ?? 8,
      kind: building.kind,
      approximate: building.approximate,
      reference: building.reference,
    });
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
    worldUV(terrain);
    const ground = new T.Mesh(terrain, this.materials.grass);
    ground.receiveShadow = true;
    this.root.add(ground);
    this.collider(ground);
    const inReference = (x: number, z: number) => {
      const b = map.beverlySurvey?.bounds;
      return b && x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
    };
    const residentialAsphalt = this.materials.asphalt.clone();
    residentialAsphalt.color.set(0xcccbc4);
    residentialAsphalt.onBeforeCompile = this.materials.asphalt.onBeforeCompile;
    residentialAsphalt.customProgramCacheKey =
      this.materials.asphalt.customProgramCacheKey;
    for (const road of map.roads) {
      if (road.points.length < 2) continue;
      const roadSample = road.bridge ? undefined : sample;
      const textured = (mesh: T.Mesh, material: T.MeshStandardMaterial) => {
        (mesh.material as T.Material).dispose();
        mesh.material = material;
        worldUV(mesh.geometry);
        return mesh;
      };
      this.root.add(
        textured(
          roadMesh(
            road.points,
            road.width + (road.shoulderWidth ?? 0.8) * 2,
            0xaba48b,
            0.025,
            roadSample,
          ),
          this.materials.gravel,
        ),
      );
      this.root.add(
        textured(
          roadJoins(
            road.points,
            road.width + (road.shoulderWidth ?? 0.8) * 2,
            0xaba48b,
            0.025,
            roadSample,
          ),
          this.materials.gravel,
        ),
      );
      const asphalt = roadMesh(
          road.points,
          road.width,
          0x394143,
          0.065,
          roadSample,
        ),
        joins = roadJoins(road.points, road.width, 0x394143, 0.065, roadSample);
      this.root.add(
        textured(
          asphalt,
          road.surveyed ? residentialAsphalt : this.materials.asphalt,
        ),
        textured(
          joins,
          road.surveyed ? residentialAsphalt : this.materials.asphalt,
        ),
      );
      this.collider(asphalt);
      this.collider(joins);
      // Both join rims and strips follow terrain facets; the colliders use these exact meshes.
      // Bridges preserve their imported deck grade rather than snapping down to terrain.
      if (road.width >= 7 && road.markings !== "none") {
        for (const side of [-1, 1]) {
          const points = road.points.map((p, i): Point => {
            const previous = road.points[Math.max(0, i - 1)],
              next = road.points[Math.min(road.points.length - 1, i + 1)];
            const heading = Math.atan2(
              next[0] - previous[0],
              next[2] - previous[2],
            );
            return [
              p[0] + Math.cos(heading) * side * 0.15,
              p[1],
              p[2] - Math.sin(heading) * side * 0.15,
            ];
          });
          this.root.add(roadMesh(points, 0.1, 0xbfa351, 0.079, roadSample));
        }
      }
    }
    // Driveways follow observed plan paths and the exact road/terrain facets.
    const driveMaterial = this.materials.asphalt.clone();
    driveMaterial.color.set(0x858887);
    driveMaterial.onBeforeCompile = this.materials.asphalt.onBeforeCompile;
    driveMaterial.customProgramCacheKey =
      this.materials.asphalt.customProgramCacheKey;
    for (const driveway of map.beverlySurvey?.driveways ?? []) {
      if (driveway.surfaceIds?.length) continue;
      const points: Point[] = driveway.points.map(([x, z]: number[]) => [
        x,
        heightAt(map, x, z),
        z,
      ]);
      for (const mesh of [
        roadMesh(points, driveway.widthMeters, 0x777777, 0.082, sample),
        roadJoins(points, driveway.widthMeters, 0x777777, 0.082, sample),
      ]) {
        (mesh.material as T.Material).dispose();
        mesh.material = driveMaterial;
        worldUV(mesh.geometry);
        mesh.userData.referenceDriveway = driveway.address;
        this.root.add(mesh);
        this.collider(mesh);
      }
    }
    for (const surface of map.beverlySurvey?.drivewaySurfaces ?? []) {
      const mesh = groundPolygonMesh(surface.points, 0x777777, 0.082, sample);
      (mesh.material as T.Material).dispose();
      mesh.material = driveMaterial;
      worldUV(mesh.geometry);
      mesh.userData.referenceDriveway = surface.address;
      mesh.userData.sourceFeature = surface.id;
      mesh.receiveShadow = true;
      this.root.add(mesh);
      this.collider(mesh);
    }
    if (!map.beverlySurvey) {
      driveMaterial.dispose();
      residentialAsphalt.dispose();
    }
    // State footprints supersede address envelopes inside the observed area.
    (map.buildings || []).forEach((building, index) =>
      this.house(building, index),
    );
    this.root.add(
      buildNeighborhood(
        this.houses.filter((house) => house.id !== HOME_BUILDING_ID),
        {
          heightAt: (x, z) => heightAt(map, x, z),
          roadClearance: (x, z) => {
            const near = nearestRoad(map, x, z);
            return near.distance - (near.road?.width ?? 8) / 2;
          },
          materials: this.materials,
        },
      ),
    );
    const homeFrame = getHomeFrame(map, (x, z) => heightAt(map, x, z));
    if (homeFrame) {
      const house = buildHomeHouse(homeFrame);
      const right = homeFrame.width / 2,
        back = homeFrame.depth / 2;
      this.homeCameraFrame = new T.Matrix4()
        .set(
          homeFrame.right[0],
          0,
          homeFrame.back[0],
          homeFrame.center[0],
          0,
          1,
          0,
          0,
          homeFrame.right[1],
          0,
          homeFrame.back[1],
          homeFrame.center[1],
          0,
          0,
          0,
          1,
        )
        .invert();
      this.homeCameraVolumes = [
        new T.Box3(
          new T.Vector3(
            right,
            homeFrame.upperFloorY - 0.3,
            HOME_DETAIL.sideDeckFront,
          ),
          new T.Vector3(
            right + HOME_DETAIL.sideDeckWidth,
            homeFrame.upperFloorY + 1.2,
            back + HOME_DETAIL.rearDeckDepth,
          ),
        ),
        new T.Box3(
          new T.Vector3(
            HOME_DETAIL.rearDeckLeft,
            homeFrame.upperFloorY - 0.3,
            back,
          ),
          new T.Vector3(
            HOME_DETAIL.screenRoomRight,
            homeFrame.eaveY + 0.15,
            back + HOME_DETAIL.rearDeckDepth,
          ),
        ),
      ];
      const yard = buildHomeYard(homeFrame, sample, (ring, offset) => {
        const points = ring.map(([u, v]): [number, number] => {
          const p = homeFrame.point(u, 0, v);
          return [p.x, p.z];
        });
        const mesh = groundPolygonMesh(points, 0xffffff, offset, sample);
        mesh.material.dispose();
        const geometry = mesh.geometry;
        // Convert the terrain-clipped world mesh into the yard's reflected
        // photo-facing frame. Reverse winding so its local top still faces up.
        const position = geometry.getAttribute("position");
        for (let i = 0; i < position.count; i++) {
          const x = position.getX(i) - homeFrame.center[0],
            z = position.getZ(i) - homeFrame.center[1];
          position.setXYZ(
            i,
            x * homeFrame.right[0] + z * homeFrame.right[1],
            position.getY(i),
            x * homeFrame.back[0] + z * homeFrame.back[1],
          );
        }
        for (let i = 0; i < position.count; i += 3) {
          const b = new T.Vector3().fromBufferAttribute(position, i + 1);
          position.setXYZ(
            i + 1,
            position.getX(i + 2),
            position.getY(i + 2),
            position.getZ(i + 2),
          );
          position.setXYZ(i + 2, b.x, b.y, b.z);
        }
        geometry.computeVertexNormals();
        return geometry;
      });
      this.root.add(
        house,
        yard,
        buildHomeTrees(homeFrame, (x, z) => heightAt(map, x, z)),
      );
      house.traverse((object) => {
        if (object instanceof T.Mesh) this.cameraObstacles.push(object);
      });
      this.root.userData.homeFrame = homeFrame;
    }
    this.vegetation = new Vegetation(map, heightAt, nearestRoad, {
      test: this.test,
      barkMaterial: this.materials.bark,
    });
    this.root.add(this.vegetation.root);
    if (map.beverlySurvey)
      this.root.add(buildBeverlyDetails(map, (x, z) => heightAt(map, x, z)));
    if (map.beverlySurvey)
      this.root.add(buildPropertyDetails(map, (x, z) => heightAt(map, x, z)));
    if (map.beverlySurvey) {
      this.microdetail = new BeverlyMicrodetail(
        map,
        (x, z) => heightAt(map, x, z),
        {
          referenceCanopies: this.vegetation.root.userData.referenceCanopies,
        },
      );
      this.root.add(this.microdetail.root);
    }
    if (!this.test)
      this.root.add(
        buildRoadside(map, (x, z) => heightAt(map, x, z), this.materials),
      );
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
    if (!map.beverlySurvey) {
      this.root.add(home);
      this.box(
        [home.position.x, home.position.y - 1.5, home.position.z],
        [0.07, 3, 0.07],
        0x7f8581,
        false,
      );
    } else {
      (home.material as T.SpriteMaterial).map?.dispose();
      home.material.dispose();
    }
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
      if (inReference(x, z)) continue;
      const sign = textSign(road.name);
      sign.scale.multiplyScalar(0.75);
      sign.position.set(x, heightAt(map, x, z) + 2.5, z);
      this.root.add(sign);
      this.box(
        [x, heightAt(map, x, z) + 1.25, z],
        [0.06, 2.5, 0.06],
        0x7f8581,
        false,
      );
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
    this.cameraObstacles = this.cameraObstacles.filter(
      (object) => object.parent !== this.root,
    );
    for (const mesh of [...this.root.children]) {
      if (
        !(mesh instanceof T.Mesh) ||
        mesh instanceof T.InstancedMesh ||
        !(mesh.material instanceof T.MeshStandardMaterial)
      )
        continue;
      const material = mesh.material,
        key = [
          material.map?.uuid ?? "",
          material.normalMap?.uuid ?? "",
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
          material,
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
        if (name !== "position" && name !== "normal" && name !== "uv")
          geometry.deleteAttribute(name);
      if (!geometry.getAttribute("uv")) worldUV(geometry);
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
    for (const batch of batches.values())
      disposedMaterials.delete(batch.material);
    for (const material of disposedMaterials) material.dispose();
  }
  update(time: number, camera: T.Camera) {
    this.vegetation?.update(time, camera);
    this.microdetail?.update(time, camera);
  }
  setQuality(quality: "low" | "medium" | "high") {
    this.vegetation?.setQuality(quality);
    this.microdetail?.setQuality(quality);
  }
  dispose() {
    this.vegetation?.dispose();
    this.microdetail?.dispose();
    this.materials.dispose();
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
