import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { MapData, Point } from "./types";

export type VegetationQuality = "low" | "medium" | "high";
export interface VegetationOptions {
  test?: boolean;
  quality?: VegetationQuality;
  barkMaterial?: T.MeshStandardMaterial;
  seed?: number;
}
type HeightQuery = (map: MapData, x: number, z: number) => number;
type RoadQuery = (
  map: MapData,
  x: number,
  z: number,
) => { distance: number; road?: { width: number } };
type Species = 0 | 1 | 2;
interface Plant {
  x: number;
  y: number;
  z: number;
  scale: number;
  yaw: number;
  tone: number;
  species: Species;
}
interface RoadSegment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  width: number;
}
interface Envelope {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
interface Chunk {
  x: number;
  z: number;
  radius: number;
  root: T.Group;
  trees: T.InstancedMesh[];
  distantTrees: T.InstancedMesh[];
  shrubs: T.InstancedMesh | null;
  grass: T.InstancedMesh | null;
}
interface ChunkPlants {
  trees: Plant[][];
  shrubs: Plant[];
  grass: Plant[];
}
interface TreeGeometry {
  trunk: T.BufferGeometry;
  leaves: T.BufferGeometry;
}

const TAU = Math.PI * 2;
const CHUNK_SIZE = 240;
const INDEX_SIZE = 48;
const up = new T.Vector3(0, 1, 0);
function seeded(seed: number) {
  let n = seed >>> 0;
  return () => {
    n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
    return n / 4294967296;
  };
}
function cellKey(x: number, z: number, size: number) {
  return `${Math.floor(x / size)},${Math.floor(z / size)}`;
}
function clamp(value: number, low: number, high: number) {
  return Math.max(low, Math.min(high, value));
}

/** Original, deterministic leaf/needle/grass masks. These are generated assets, not map imagery. */
function plantTexture(kind: "leaf" | "needle" | "grass"): T.DataTexture {
  const size = kind === "grass" ? 256 : 512,
    pixels = new Uint8Array(size * size * 4);
  const random = seeded(
    kind === "leaf" ? 44231 : kind === "needle" ? 44291 : 44381,
  );
  const pixel = (x: number, y: number, color: number[], alpha = 255) => {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const i = (Math.floor(y) * size + Math.floor(x)) * 4;
    if (alpha < pixels[i + 3]) return;
    pixels[i] = color[0];
    pixels[i + 1] = color[1];
    pixels[i + 2] = color[2];
    pixels[i + 3] = alpha;
  };
  const line = (
    ax: number,
    ay: number,
    bx: number,
    by: number,
    width: number,
    color: number[],
  ) => {
    const length = Math.hypot(bx - ax, by - ay),
      steps = Math.ceil(length * 1.25);
    for (let i = 0; i <= steps; i++) {
      const t = i / Math.max(1, steps),
        x = ax + (bx - ax) * t,
        y = ay + (by - ay) * t,
        radius = Math.max(0.55, width * (1 - t * 0.65));
      for (let yy = Math.floor(y - radius - 0.5); yy <= y + radius + 0.5; yy++)
        for (
          let xx = Math.floor(x - radius - 0.5);
          xx <= x + radius + 0.5;
          xx++
        ) {
          const coverage = clamp(
            radius + 0.55 - Math.hypot(xx - x, yy - y),
            0,
            1,
          );
          if (coverage > 0) pixel(xx, yy, color, Math.round(coverage * 255));
        }
    }
  };
  if (kind === "grass") {
    for (let blade = 0; blade < 46; blade++) {
      const rootX = 60 + random() * 135,
        height = 55 + random() * 185,
        bend = (random() - 0.5) * 120;
      const color = [
        86 + random() * 35,
        108 + random() * 44,
        43 + random() * 25,
      ];
      let ax = rootX,
        ay = 250;
      for (let j = 1; j <= 14; j++) {
        const t = j / 14,
          bx = rootX + bend * t * t,
          by = 250 - height * t;
        line(ax, ay, bx, by, 2.2 * (1 - t) + 0.4, color);
        ax = bx;
        ay = by;
      }
    }
  } else if (kind === "needle") {
    line(248, 486, 270, 30, 5, [77, 68, 43]);
    for (let b = 0; b < 19; b++) {
      const t = b / 19,
        originX = 248 + t * 22,
        originY = 462 - t * 395,
        spread = 65 + Math.sin(t * Math.PI) * 150;
      for (const side of [-1, 1]) {
        const endX = originX + side * spread,
          endY = originY - 35 - random() * 30;
        line(originX, originY, endX, endY, 2, [75, 78, 41]);
        for (let n = 0; n < 24; n++) {
          const s = n / 24,
            x = originX + (endX - originX) * s,
            y = originY + (endY - originY) * s;
          const length = 14 + random() * 20,
            color = [
              47 + random() * 23,
              80 + random() * 27,
              67 + random() * 22,
            ];
          line(x, y, x + side * length * 0.45, y - length, 1.35, color);
          line(x, y, x + side * length * 0.7, y + length * 0.6, 1.2, color);
        }
      }
    }
  } else {
    // A leafy twig with irregular overlapping pointed, lightly serrated blades.
    line(256, 477, 250, 70, 4, [86, 76, 43]);
    for (let branch = 0; branch < 14; branch++) {
      const t = branch / 14,
        y = 430 - t * 335,
        side = branch % 2 ? -1 : 1;
      line(
        256,
        y + 35,
        256 + side * (105 + Math.sin(t * Math.PI) * 105),
        y - 30,
        2,
        [89, 83, 44],
      );
    }
    for (let leaf = 0; leaf < 152; leaf++) {
      const angle = random() * TAU,
        radius = Math.sqrt(random());
      const cx = 256 + Math.cos(angle) * radius * 211,
        cy = 251 + Math.sin(angle) * radius * 204;
      const yaw = angle + (random() - 0.5),
        c = Math.cos(yaw),
        s = Math.sin(yaw),
        length = 15 + random() * 17,
        width = 8 + random() * 8;
      const light = 0.8 + random() * 0.45;
      for (
        let y = Math.floor(cy - length - width);
        y <= cy + length + width;
        y++
      )
        for (
          let x = Math.floor(cx - length - width);
          x <= cx + length + width;
          x++
        ) {
          const nx = ((x - cx) * c + (y - cy) * s) / width,
            ny = (-(x - cx) * s + (y - cy) * c) / length;
          if (Math.abs(ny) >= 1) continue;
          const silhouette =
            Math.sin(((ny + 1) * Math.PI) / 2) *
            (0.92 + 0.08 * Math.cos(ny * 29));
          if (Math.abs(nx) > silhouette) continue;
          const shade = light * (0.88 + 0.12 * (1 - nx)),
            vein = Math.abs(nx) < 0.045 ? 1.12 : 1;
          pixel(x, y, [83 * shade * vein, 111 * shade * vein, 43 * shade]);
        }
    }
  }
  const texture = new T.DataTexture(pixels, size, size, T.RGBAFormat);
  texture.colorSpace = T.SRGBColorSpace;
  texture.flipY = true;
  texture.generateMipmaps = true;
  texture.minFilter = T.LinearMipmapLinearFilter;
  texture.magFilter = T.LinearFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function fallbackBark(): T.DataTexture {
  const size = 128,
    data = new Uint8Array(size * size * 4),
    random = seeded(4112);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const crack = Math.pow(
        Math.max(0, Math.sin(x * 0.39 + Math.sin(y * 0.057) * 0.6)),
        10,
      );
      const light = 0.7 + random() * 0.22 - crack * 0.32,
        i = (y * size + x) * 4;
      data[i] = 121 * light;
      data[i + 1] = 106 * light;
      data[i + 2] = 88 * light;
      data[i + 3] = 255;
    }
  const texture = new T.DataTexture(data, size, size, T.RGBAFormat);
  texture.colorSpace = T.SRGBColorSpace;
  texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = T.LinearMipmapLinearFilter;
  texture.needsUpdate = true;
  return texture;
}

class CardBuilder {
  positions: number[] = [];
  normals: number[] = [];
  uvs: number[] = [];
  indices: number[] = [];
  add(
    center: T.Vector3,
    width: number,
    height: number,
    yaw: number,
    pitch: number,
    roll: number,
    crownY: number,
    orientation?: T.Quaternion,
  ) {
    const q =
        orientation ??
        new T.Quaternion().setFromEuler(new T.Euler(pitch, yaw, roll)),
      base = this.positions.length / 3;
    const u = new T.Vector3(width / 2, 0, 0).applyQuaternion(q),
      v = new T.Vector3(0, height / 2, 0).applyQuaternion(q);
    for (const [a, b] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      const p = center.clone().addScaledVector(u, a).addScaledVector(v, b);
      // Broadly outward/upward normals make a cohesive lit canopy rather than dark crossed planes.
      const normal = new T.Vector3(
        p.x,
        (p.y - crownY) * 0.7 + 2,
        p.z,
      ).normalize();
      this.positions.push(p.x, p.y, p.z);
      this.normals.push(normal.x, normal.y, normal.z);
      this.uvs.push((a + 1) / 2, (b + 1) / 2);
    }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  geometry() {
    const geometry = new T.BufferGeometry();
    geometry.setAttribute(
      "position",
      new T.Float32BufferAttribute(this.positions, 3),
    );
    geometry.setAttribute(
      "normal",
      new T.Float32BufferAttribute(this.normals, 3),
    );
    geometry.setAttribute("uv", new T.Float32BufferAttribute(this.uvs, 2));
    geometry.setIndex(this.indices);
    geometry.computeBoundingSphere();
    return geometry;
  }
}

function treeGeometry(species: Species, distant = false): TreeGeometry {
  const random = seeded(4420 + species * 121),
    wood: T.BufferGeometry[] = [],
    cards = new CardBuilder();
  const branch = (
    a: T.Vector3,
    b: T.Vector3,
    baseRadius: number,
    endRadius: number,
    sides = 7,
  ) => {
    const direction = b.clone().sub(a),
      length = direction.length(),
      geometry = new T.CylinderGeometry(
        endRadius,
        baseRadius,
        length,
        distant ? Math.min(5, sides) : sides,
        1,
      );
    const uv = geometry.getAttribute("uv");
    for (let i = 0; i < uv.count; i++)
      uv.setXY(
        i,
        (uv.getX(i) * TAU * (baseRadius + endRadius)) / 2,
        uv.getY(i) * length,
      );
    geometry.applyQuaternion(
      new T.Quaternion().setFromUnitVectors(up, direction.normalize()),
    );
    geometry.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    wood.push(geometry);
  };
  if (species === 2) {
    branch(new T.Vector3(), new T.Vector3(0.1, 14.5, -0.1), 0.29, 0.025, 8);
    for (let layer = 0; layer < 11; layer++) {
      const y = 2.8 + layer * 1.035,
        radius = 3.05 * Math.pow(1 - layer / 11.5, 0.87);
      for (let arm = 0; arm < 7; arm++) {
        const a = (arm / 7) * TAU + layer * 0.47 + (random() - 0.5) * 0.24,
          x = Math.sin(a),
          z = Math.cos(a);
        const reach = radius * (0.8 + random() * 0.24),
          droop = -0.3 + random() * 0.24;
        if (!distant)
          branch(
            new T.Vector3(0, y, 0),
            new T.Vector3(x * reach, y + droop, z * reach),
            0.072 * (1 - layer / 14),
            0.012,
            5,
          );
        // Small angled needle sprays follow individual boughs; no canopy-sized upright sheets.
        for (let tuft = 0; tuft < 3; tuft++) {
          const along = 0.25 + tuft * 0.3,
            spread = 0.68 + random() * 0.31;
          const center = new T.Vector3(
            x * reach * along,
            y + droop * along + 0.15 + (random() - 0.5) * 0.17,
            z * reach * along,
          );
          const orientation = new T.Quaternion().setFromUnitVectors(
            up,
            new T.Vector3(x, 0.2 + random() * 0.45, z).normalize(),
          );
          const size = Math.max(0.52, (1.18 - layer * 0.043) * spread);
          for (let spray = 0; spray < 2; spray++) {
            const twist = new T.Quaternion().setFromAxisAngle(
              up,
              (spray ? 0.8 : -0.65) + (random() - 0.5) * 0.4,
            );
            if (!distant || tuft !== 0)
              cards.add(
                center,
                size * 1.08,
                size * 1.7,
                0,
                0,
                0,
                y,
                orientation.clone().multiply(twist),
              );
          }
        }
      }
    }
    for (let tip = 0; tip < 4; tip++)
      cards.add(
        new T.Vector3(0, 14.15, 0),
        0.55,
        1.1,
        (tip * Math.PI) / 4,
        0.12,
        0,
        13,
      );
  } else {
    const tall = species === 1,
      crownY = tall ? 9 : 7.3,
      radius = tall ? 3.3 : 4.65,
      crownHeight = tall ? 3.5 : 2.6;
    branch(
      new T.Vector3(),
      new T.Vector3(0.15, 5.8, -0.13),
      tall ? 0.34 : 0.47,
      0.17,
      9,
    );
    if (!distant)
      for (let root = 0; root < 5; root++) {
        const a = (root / 5) * TAU;
        branch(
          new T.Vector3(Math.sin(a) * 0.62, 0.04, Math.cos(a) * 0.62),
          new T.Vector3(0, 1, 0),
          0.17,
          0.12,
          5,
        );
      }
    for (let arm = 0; arm < 13; arm++) {
      const angle = arm * 2.399 + random() * 0.4,
        reach = radius * (0.45 + random() * 0.4),
        y = 4.3 + arm * (tall ? 0.34 : 0.24);
      const a = new T.Vector3(0, y - 1.6, 0),
        b = new T.Vector3(
          Math.sin(angle) * reach,
          y + 1.65,
          Math.cos(angle) * reach,
        );
      if (!distant || arm % 3 === 0) branch(a, b, 0.17 - arm * 0.007, 0.035, 6);
      const end = b
        .clone()
        .add(
          new T.Vector3(
            Math.sin(angle + 0.55) * 1.1,
            0.75,
            Math.cos(angle + 0.55) * 1.1,
          ),
        );
      if (!distant) branch(b.clone().lerp(a, 0.28), end, 0.052, 0.014, 5);
    }
    const clusters = tall ? 42 : 48;
    for (let cluster = 0; cluster < clusters; cluster++) {
      const angle = cluster * 2.399,
        h = 1 - (2 * (cluster + 0.5)) / clusters,
        ring = Math.sqrt(Math.max(0, 1 - h * h));
      const r = 0.72 + random() * 0.3,
        center = new T.Vector3(
          Math.sin(angle) * radius * ring * r,
          crownY + h * crownHeight,
          Math.cos(angle) * radius * ring * r,
        );
      const size = 2.05 + random() * 0.65;
      for (let card = 0; card < 3; card++) {
        const pitch = (random() - 0.5) * 1.6,
          roll = (random() - 0.5) * 0.9;
        if (!distant || cluster % 2 === 0)
          cards.add(
            center,
            size,
            size * 0.88,
            angle + (card * Math.PI) / 3,
            pitch,
            roll,
            crownY,
          );
      }
    }
  }
  const trunk = mergeGeometries(wood, false)!;
  for (const part of wood) part.dispose();
  trunk.computeBoundingSphere();
  return { trunk, leaves: cards.geometry() };
}

function shrubGeometry(): T.BufferGeometry {
  const cards = new CardBuilder(),
    random = seeded(716);
  for (let i = 0; i < 19; i++) {
    const a = i * 2.399,
      r = Math.sqrt(random()) * 1.15;
    for (let j = 0; j < 2; j++)
      cards.add(
        new T.Vector3(Math.sin(a) * r, 0.55 + random() * 0.75, Math.cos(a) * r),
        1.25,
        1.2,
        a + (j * Math.PI) / 2,
        (random() - 0.5) * 1.2,
        0,
        0.6,
      );
  }
  return cards.geometry();
}

/** Road/house exclusions are spatially indexed once; no per-frame geographic queries. */
class PlacementIndex {
  roads = new Map<string, RoadSegment[]>();
  buildings = new Map<string, Envelope[]>();
  occupied = new Map<string, { x: number; z: number; radius: number }[]>();
  constructor(map: MapData) {
    for (const road of map.roads)
      for (let i = 1; i < road.points.length; i++) {
        const a = road.points[i - 1],
          b = road.points[i],
          segment = {
            ax: a[0],
            az: a[2],
            bx: b[0],
            bz: b[2],
            width: road.width,
          };
        this.add(
          this.roads,
          segment,
          Math.min(a[0], b[0]) - road.width / 2 - 18,
          Math.max(a[0], b[0]) + road.width / 2 + 18,
          Math.min(a[2], b[2]) - road.width / 2 - 18,
          Math.max(a[2], b[2]) + road.width / 2 + 18,
        );
      }
    for (const building of map.buildings ?? []) {
      const points: Point[] = building.points ?? building.footprint;
      if (!points?.length) continue;
      const xs = points.map((p) => p[0]),
        zs = points.map((p) => p[2]);
      const box = {
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minZ: Math.min(...zs),
        maxZ: Math.max(...zs),
      };
      this.add(
        this.buildings,
        box,
        box.minX - 14,
        box.maxX + 14,
        box.minZ - 14,
        box.maxZ + 14,
      );
    }
  }
  private add<A>(
    index: Map<string, A[]>,
    value: A,
    minX: number,
    maxX: number,
    minZ: number,
    maxZ: number,
  ) {
    for (
      let x = Math.floor(minX / INDEX_SIZE);
      x <= Math.floor(maxX / INDEX_SIZE);
      x++
    )
      for (
        let z = Math.floor(minZ / INDEX_SIZE);
        z <= Math.floor(maxZ / INDEX_SIZE);
        z++
      ) {
        const key = `${x},${z}`;
        let list = index.get(key);
        if (!list) {
          list = [];
          index.set(key, list);
        }
        list.push(value);
      }
  }
  clear(
    x: number,
    z: number,
    crown: number,
    houseMargin: number,
    roadMargin: number,
  ): boolean {
    const key = cellKey(x, z, INDEX_SIZE);
    for (const segment of this.roads.get(key) ?? []) {
      const dx = segment.bx - segment.ax,
        dz = segment.bz - segment.az,
        t = clamp(
          ((x - segment.ax) * dx + (z - segment.az) * dz) /
            (dx * dx + dz * dz || 1),
          0,
          1,
        );
      if (
        (x - segment.ax - dx * t) ** 2 + (z - segment.az - dz * t) ** 2 <
        (segment.width / 2 + crown + roadMargin) ** 2
      )
        return false;
    }
    for (const box of this.buildings.get(key) ?? [])
      if (
        x > box.minX - crown - houseMargin &&
        x < box.maxX + crown + houseMargin &&
        z > box.minZ - crown - houseMargin &&
        z < box.maxZ + crown + houseMargin
      )
        return false;
    return true;
  }
  spaced(x: number, z: number, radius: number): boolean {
    const cx = Math.floor(x / 16),
      cz = Math.floor(z / 16);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++)
        for (const tree of this.occupied.get(`${cx + dx},${cz + dz}`) ?? [])
          if (Math.hypot(x - tree.x, z - tree.z) < radius + tree.radius)
            return false;
    const key = `${cx},${cz}`;
    let list = this.occupied.get(key);
    if (!list) {
      list = [];
      this.occupied.set(key, list);
    }
    list.push({ x, z, radius });
    return true;
  }
  awayFromRoad(x: number, z: number, distance: number): boolean {
    const cx = Math.floor(x / INDEX_SIZE),
      cz = Math.floor(z / INDEX_SIZE),
      cells = Math.ceil(distance / INDEX_SIZE);
    for (let ix = -cells; ix <= cells; ix++)
      for (let iz = -cells; iz <= cells; iz++)
        for (const s of this.roads.get(`${cx + ix},${cz + iz}`) ?? []) {
          const dx = s.bx - s.ax,
            dz = s.bz - s.az,
            t = clamp(
              ((x - s.ax) * dx + (z - s.az) * dz) / (dx * dx + dz * dz || 1),
              0,
              1,
            );
          if (
            (x - s.ax - dx * t) ** 2 + (z - s.az - dz * t) ** 2 <
            distance * distance
          )
            return false;
        }
    return true;
  }
}

export class Vegetation {
  readonly root = new T.Group();
  readonly stats = {
    trees: 0,
    shrubs: 0,
    grassTufts: 0,
    chunks: 0,
    visibleChunks: 0,
    visibleBatches: 0,
    totalBatches: 0,
  };
  private chunks: Chunk[] = [];
  private geometries: T.BufferGeometry[] = [];
  private materials: T.Material[] = [];
  private textures: T.Texture[] = [];
  private quality: VegetationQuality;
  private timeUniform = { value: 0 };
  private lastUpdate = -Infinity;
  private cameraPosition = new T.Vector3();
  private lastCameraPosition = new T.Vector3(Infinity, Infinity, Infinity);

  constructor(
    map: MapData,
    heightAt: HeightQuery,
    _nearestRoad: RoadQuery,
    options: VegetationOptions = {},
  ) {
    this.root.name = "Procedural neighborhood vegetation";
    this.quality = options.quality ?? "high";
    const random = seeded(options.seed ?? 442),
      index = new PlacementIndex(map),
      placements = new Map<string, ChunkPlants>();
    const inBounds = (x: number, z: number) =>
      x > map.bounds.minX + 10 &&
      x < map.bounds.maxX - 10 &&
      z > map.bounds.minZ + 10 &&
      z < map.bounds.maxZ - 10;
    const chunk = (x: number, z: number) => {
      const key = cellKey(x, z, CHUNK_SIZE);
      let result = placements.get(key);
      if (!result) {
        result = { trees: [[], [], []], shrubs: [], grass: [] };
        placements.set(key, result);
      }
      return result;
    };
    const addTree = (x: number, z: number, roadside = false) => {
      const species: Species = random() < 0.2 ? 2 : random() < 0.47 ? 1 : 0,
        scale = 0.78 + random() * 0.45,
        crown = (species === 0 ? 5.7 : species === 1 ? 4.45 : 3.8) * scale;
      if (
        !inBounds(x, z) ||
        !index.clear(x, z, crown, roadside ? 4 : 2, 4.8) ||
        !index.spaced(x, z, crown * 0.64)
      )
        return;
      const y = heightAt(map, x, z);
      chunk(x, z).trees[species].push({
        x,
        y: y - 0.06,
        z,
        scale,
        yaw: random() * TAU,
        tone: random(),
        species,
      });
      this.stats.trees++;
    };
    // Recognizable streets get continuous but irregular vegetation, including the Home approach.
    // Setback and species are scenic approximations; road coordinates are never altered.
    for (const road of map.roads) {
      let distance = 0,
        nextTree = random() * 18,
        nextGrass = random() * 7;
      for (let i = 1; i < road.points.length; i++) {
        const a = road.points[i - 1],
          b = road.points[i],
          dx = b[0] - a[0],
          dz = b[2] - a[2],
          length = Math.hypot(dx, dz);
        if (length < 0.01) continue;
        while (nextTree <= distance + length) {
          const t = (nextTree - distance) / length,
            x = a[0] + dx * t,
            z = a[2] + dz * t,
            closeHome =
              Math.hypot(x - map.home.position[0], z - map.home.position[2]) <
              220;
          for (const side of [-1, 1]) {
            const setback = road.width / 2 + 11 + random() * 12;
            addTree(
              x + (dz / length) * setback * side,
              z - (dx / length) * setback * side,
              true,
            );
          }
          nextTree += options.test
            ? 47 + random() * 15
            : closeHome
              ? 13 + random() * 8
              : 20 + random() * 15;
        }
        while (!options.test && nextGrass <= distance + length) {
          const t = (nextGrass - distance) / length,
            x = a[0] + dx * t,
            z = a[2] + dz * t;
          for (const side of [-1, 1]) {
            const offset = road.width / 2 + 1.8 + random() * 1.4,
              gx = x + (dz / length) * offset * side,
              gz = z - (dx / length) * offset * side;
            if (inBounds(gx, gz) && index.clear(gx, gz, 0.3, 1, 1.1)) {
              chunk(gx, gz).grass.push({
                x: gx,
                y: heightAt(map, gx, gz) - 0.02,
                z: gz,
                scale: 0.35 + random() * 0.4,
                yaw: random() * TAU,
                tone: random(),
                species: 0,
              });
              this.stats.grassTufts++;
            }
          }
          nextGrass += 7 + random() * 6;
        }
        distance += length;
      }
    }
    // Low-frequency woodlots leave open lawns and fields instead of a uniform tree carpet.
    const step = options.test ? 59 : 28;
    for (let z = map.bounds.minZ + step; z < map.bounds.maxZ - step; z += step)
      for (
        let x = map.bounds.minX + step;
        x < map.bounds.maxX - step;
        x += step
      ) {
        const px = x + (random() - 0.5) * step * 0.85,
          pz = z + (random() - 0.5) * step * 0.85;
        const woodland =
          0.53 +
          0.24 * Math.sin(px * 0.0043 + Math.sin(pz * 0.0023)) +
          0.2 * Math.sin(pz * 0.0054 - px * 0.0018);
        if (random() < woodland) addTree(px, pz);
        if (
          !options.test &&
          woodland > 0.67 &&
          index.awayFromRoad(px, pz, 64)
        ) {
          // Mature wooded patches have overlapping crowns; yards and road corridors stay open.
          for (let satellite = 0; satellite < 3; satellite++) {
            const a = random() * TAU,
              r = 6 + random() * 8;
            addTree(px + Math.sin(a) * r, pz + Math.cos(a) * r);
          }
        }
      }
    if (!options.test)
      for (const building of map.buildings ?? []) {
        const points: Point[] = building.points ?? building.footprint;
        if (!points?.length) continue;
        const xs = points.map((p) => p[0]),
          zs = points.map((p) => p[2]),
          x = (Math.min(...xs) + Math.max(...xs)) / 2,
          z = (Math.min(...zs) + Math.max(...zs)) / 2;
        const rx = (Math.max(...xs) - Math.min(...xs)) / 2 + 3.5,
          rz = (Math.max(...zs) - Math.min(...zs)) / 2 + 3.5;
        for (let i = 0; i < 4; i++) {
          const angle = (i * Math.PI) / 2 + 0.3 + random() * 0.5,
            px = x + Math.sin(angle) * rx,
            pz = z + Math.cos(angle) * rz;
          if (inBounds(px, pz) && index.clear(px, pz, 0.8, 0.2, 2)) {
            chunk(px, pz).shrubs.push({
              x: px,
              y: heightAt(map, px, pz),
              z: pz,
              scale: 0.65 + random() * 0.5,
              yaw: random() * TAU,
              tone: random(),
              species: 0,
            });
            this.stats.shrubs++;
          }
        }
      }

    const leaves = plantTexture("leaf"),
      needles = plantTexture("needle"),
      grass = plantTexture("grass");
    this.textures.push(leaves, needles, grass);
    const bark =
      options.barkMaterial?.clone() ??
      new T.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
    if (!options.barkMaterial) {
      const texture = fallbackBark();
      bark.map = texture;
      this.textures.push(texture);
    }
    const leafMaterial = this.foliageMaterial(leaves, 0.42),
      pineMaterial = this.foliageMaterial(needles, 0.3, false, true),
      grassMaterial = this.foliageMaterial(grass, 0.42, true);
    pineMaterial.color.setRGB(0.73, 0.83, 0.92);
    this.materials.push(bark, leafMaterial, pineMaterial, grassMaterial);
    const templates = ([0, 1, 2] as Species[]).map((species) =>
        treeGeometry(species),
      ),
      distantTemplates = ([0, 1, 2] as Species[]).map((species) =>
        treeGeometry(species, true),
      ),
      shrubs = shrubGeometry();
    const grassCards = new CardBuilder();
    for (let i = 0; i < 3; i++)
      grassCards.add(
        new T.Vector3(0, 0.5, 0),
        1,
        1,
        (i * Math.PI) / 3,
        0,
        0,
        0,
      );
    const grassGeometry = grassCards.geometry();
    this.geometries.push(shrubs, grassGeometry);
    for (const template of [...templates, ...distantTemplates])
      this.geometries.push(template.trunk, template.leaves);
    const dummy = new T.Object3D(),
      tint = new T.Color();
    const instances = (
      plants: Plant[],
      geometry: T.BufferGeometry,
      material: T.Material,
      foliage: boolean,
    ) => {
      const mesh = new T.InstancedMesh(geometry, material, plants.length);
      mesh.receiveShadow = true;
      plants.forEach((plant, i) => {
        dummy.position.set(plant.x, plant.y, plant.z);
        dummy.rotation.set(0, plant.yaw, 0);
        dummy.scale.set(
          plant.scale * (1 + plant.tone * 0.09),
          plant.scale,
          plant.scale,
        );
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        if (foliage) {
          tint.setRGB(
            0.8 + plant.tone * 0.24,
            0.86 + plant.tone * 0.17,
            0.72 + plant.tone * 0.18,
          );
          mesh.setColorAt(i, tint);
        }
      });
      mesh.computeBoundingSphere();
      mesh.computeBoundingBox();
      return mesh;
    };
    for (const [key, plants] of placements) {
      const [cx, cz] = key.split(",").map(Number),
        root = new T.Group();
      root.name = `Woodlot ${key}`;
      const trees: T.InstancedMesh[] = [],
        distantTrees: T.InstancedMesh[] = [];
      for (let species = 0; species < 3; species++)
        if (plants.trees[species].length) {
          const wood = instances(
              plants.trees[species],
              templates[species].trunk,
              bark,
              false,
            ),
            foliage = instances(
              plants.trees[species],
              templates[species].leaves,
              species === 2 ? pineMaterial : leafMaterial,
              true,
            );
          trees.push(wood, foliage);
          root.add(wood, foliage);
          const distantWood = instances(
              plants.trees[species],
              distantTemplates[species].trunk,
              bark,
              false,
            ),
            distantFoliage = instances(
              plants.trees[species],
              distantTemplates[species].leaves,
              species === 2 ? pineMaterial : leafMaterial,
              true,
            );
          distantWood.visible = distantFoliage.visible = false;
          distantTrees.push(distantWood, distantFoliage);
          root.add(distantWood, distantFoliage);
        }
      const shrubMesh = plants.shrubs.length
          ? instances(plants.shrubs, shrubs, leafMaterial, true)
          : null,
        grassMesh = plants.grass.length
          ? instances(plants.grass, grassGeometry, grassMaterial, true)
          : null;
      if (shrubMesh) root.add(shrubMesh);
      if (grassMesh) root.add(grassMesh);
      this.root.add(root);
      this.chunks.push({
        x: (cx + 0.5) * CHUNK_SIZE,
        z: (cz + 0.5) * CHUNK_SIZE,
        radius: CHUNK_SIZE * 0.71 + 18,
        root,
        trees,
        distantTrees,
        shrubs: shrubMesh,
        grass: grassMesh,
      });
      this.stats.totalBatches += root.children.length;
    }
    this.stats.chunks = this.chunks.length;
  }

  private foliageMaterial(
    map: T.Texture,
    alphaTest: number,
    grass = false,
    conifer = false,
  ) {
    const material = new T.MeshStandardMaterial({
      map,
      alphaTest,
      side: T.DoubleSide,
      roughness: 1,
      metalness: 0,
      color: 0xffffff,
    });
    material.alphaToCoverage = true;
    material.forceSinglePass = true;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.vegetationTime = this.timeUniform;
      shader.vertexShader = `uniform float vegetationTime;\n${shader.vertexShader}`;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `
        #include <begin_vertex>
        float plantPhase=instanceMatrix[3].x*0.11+instanceMatrix[3].z*0.14;
        float plantBend=${grass ? "clamp(position.y,0.0,1.0)*0.045" : "clamp(position.y-2.0,0.0,8.0)*0.004"};
        transformed.x+=sin(vegetationTime*1.35+plantPhase+position.y*0.45)*plantBend;
        transformed.z+=cos(vegetationTime*1.1+plantPhase)*plantBend*0.6;`,
      );
      // Card normals are already bent to the canopy envelope. Flipping them by triangle facing
      // creates black checkerboards inside a crown, so keep those volume normals on both sides.
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <normal_fragment_begin>",
        T.ShaderChunk.normal_fragment_begin.replace(
          "normal *= faceDirection;",
          "normal *= 1.0;",
        ),
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * ${grass ? ".16" : conifer ? ".05" : ".085"};`,
      );
      if (conifer)
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <alphatest_fragment>",
          "diffuseColor.a *= 1.0 + 0.65*smoothstep(100.0,450.0,length(vViewPosition));\n#include <alphatest_fragment>",
        );
      if (grass)
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <alphatest_fragment>",
          "diffuseColor.a *= 1.0-smoothstep(65.0,100.0,length(vViewPosition));\n#include <alphatest_fragment>",
        );
    };
    material.customProgramCacheKey = () =>
      grass
        ? "neighborhood-grass-v3"
        : conifer
          ? "neighborhood-conifer-v3"
          : "neighborhood-foliage-v3";
    return material;
  }

  setQuality(quality: VegetationQuality) {
    this.quality = quality;
    this.lastUpdate = -Infinity;
  }

  /** Native per-mesh frustum bounds plus coarse distance chunks; no per-tree updates. */
  update(time: number, camera: T.Camera) {
    this.timeUniform.value = time;
    camera.getWorldPosition(this.cameraPosition);
    if (
      time - this.lastUpdate < 0.18 &&
      this.cameraPosition.distanceToSquared(this.lastCameraPosition) < 25
    )
      return;
    this.lastUpdate = time;
    this.lastCameraPosition.copy(this.cameraPosition);
    const distance =
      this.quality === "low" ? 580 : this.quality === "medium" ? 820 : 1120;
    const shadowDistance =
      this.quality === "low" ? 0 : this.quality === "medium" ? 180 : 230;
    let visibleChunks = 0,
      visibleBatches = 0;
    for (const chunk of this.chunks) {
      const d = Math.max(
        0,
        Math.hypot(
          chunk.x - this.cameraPosition.x,
          chunk.z - this.cameraPosition.z,
        ) - chunk.radius,
      );
      chunk.root.visible = d < distance;
      if (!chunk.root.visible) continue;
      visibleChunks++;
      visibleBatches += chunk.trees.length;
      const detailed = d < (this.quality === "low" ? 130 : 300);
      for (const tree of chunk.trees) {
        tree.visible = detailed;
        tree.castShadow = d < shadowDistance;
      }
      for (const tree of chunk.distantTrees) {
        tree.visible = !detailed;
        tree.castShadow = false;
      }
      if (chunk.shrubs) {
        chunk.shrubs.visible = d < (this.quality === "low" ? 85 : 175);
        chunk.shrubs.castShadow = d < 80;
        if (chunk.shrubs.visible) visibleBatches++;
      }
      if (chunk.grass) {
        chunk.grass.visible = this.quality !== "low" && d < 100;
        chunk.grass.castShadow = false;
        if (chunk.grass.visible) visibleBatches++;
      }
    }
    this.stats.visibleChunks = visibleChunks;
    this.stats.visibleBatches = visibleBatches;
  }

  dispose() {
    this.root.traverse((object) => {
      if (object instanceof T.InstancedMesh) object.dispose();
    });
    this.root.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const texture of this.textures) texture.dispose();
    this.root.clear();
    this.chunks = [];
  }
}
