import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { MapData, Point } from "./types";
import { createPropertyClearance } from "./property-footprints";

export type VegetationQuality = "low" | "medium" | "high";
export interface VegetationOptions {
  test?: boolean;
  quality?: VegetationQuality;
  barkMaterial?: T.MeshStandardMaterial;
  seed?: number;
}
/** Image-measured plan geometry. Heights and detailed leaf shapes remain approximate. */
export interface BeverlyVegetationSurvey {
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  canopies: {
    center: [number, number];
    radiusMeters: number;
    type: "broadleaf" | "conifer" | "mixed";
    confidence?: string | number;
  }[];
  woodlands?: { points: [number, number][]; spacing?: number }[];
  driveways?: { points: [number, number][]; widthMeters: number }[];
  landcover?: { kind: string; points: [number, number][] }[];
}
interface BackyardVegetationSurvey {
  bounds: BeverlyVegetationSurvey["bounds"];
  woodlands?: {
    points: [number, number][];
    spacing?: number;
    type?: "broadleaf" | "conifer" | "mixed";
    confidence?: string | number;
  }[];
  canopies?: BeverlyVegetationSurvey["canopies"];
  stream?: {
    stations?: { point: [number, number]; width: number }[];
  };
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
  /** An observed horizontal canopy radius, unaffected by generic shape variation. */
  radiusMeters?: number;
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
  footprint?: [number, number][];
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
function segmentDistanceSquared(
  x: number,
  z: number,
  a: [number, number],
  b: [number, number],
) {
  const dx = b[0] - a[0],
    dz = b[1] - a[1];
  const t = clamp(
    ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1),
    0,
    1,
  );
  return (x - a[0] - dx * t) ** 2 + (z - a[1] - dz * t) ** 2;
}
function insidePolygon(x: number, z: number, points: [number, number][]) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i],
      b = points[j];
    if (
      a[1] > z !== b[1] > z &&
      x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}
function horizontalRadius(geometry: T.BufferGeometry, aspect = 1) {
  const positions = geometry.getAttribute("position");
  let radius = 0;
  for (let i = 0; i < positions.count; i++)
    radius = Math.max(
      radius,
      Math.hypot(positions.getX(i) * aspect, positions.getZ(i)),
    );
  return radius || 1;
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
  colors: number[] = [];
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
    shape?: { fold?: number; shade?: number; normalOrigin?: T.Vector3 },
  ) {
    const q =
        orientation ??
        new T.Quaternion().setFromEuler(new T.Euler(pitch, yaw, roll)),
      base = this.positions.length / 3;
    const u = new T.Vector3(width / 2, 0, 0).applyQuaternion(q),
      v = new T.Vector3(0, height / 2, 0).applyQuaternion(q);
    const fold = shape?.fold ?? 0,
      sheetNormal = new T.Vector3().crossVectors(u, v).normalize();
    const corners = fold
      ? [
          [-1, -1],
          [0, -1],
          [1, -1],
          [-1, 1],
          [0, 1],
          [1, 1],
        ]
      : [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ];
    for (const [a, b] of corners) {
      const p = center.clone().addScaledVector(u, a).addScaledVector(v, b);
      if (fold)
        p.addScaledVector(
          sheetNormal,
          (1 - Math.abs(a)) * width * fold * (1 + b * 0.18),
        );
      // Broadly outward/upward normals make a cohesive lit canopy rather than dark crossed planes.
      const normal = shape?.normalOrigin
        ? p
            .clone()
            .sub(shape.normalOrigin)
            .multiplyScalar(0.65)
            .add(new T.Vector3(p.x * 0.25, 1.3, p.z * 0.25))
            .normalize()
        : new T.Vector3(p.x, (p.y - crownY) * 0.7 + 2, p.z).normalize();
      this.positions.push(p.x, p.y, p.z);
      this.normals.push(normal.x, normal.y, normal.z);
      this.uvs.push((a + 1) / 2, (b + 1) / 2);
      const shade = shape?.shade ?? 1;
      this.colors.push(shade, shade, shade);
    }
    if (fold)
      this.indices.push(
        base,
        base + 1,
        base + 4,
        base,
        base + 4,
        base + 3,
        base + 1,
        base + 2,
        base + 5,
        base + 1,
        base + 5,
        base + 4,
      );
    else this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
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
    geometry.setAttribute(
      "color",
      new T.Float32BufferAttribute(this.colors, 3),
    );
    geometry.setIndex(this.indices);
    geometry.computeBoundingSphere();
    return geometry;
  }
}

function treeGeometry(species: Species, distant = false): TreeGeometry {
  const random = seeded(4420 + species * 121),
    wood: T.BufferGeometry[] = [],
    cards = new CardBuilder();
  // Connected rings form bent, tapered limbs without the caps and seams of
  // intersecting cylinders. The same centerline is used by both LODs.
  const stem = (points: T.Vector3[], radii: number[], sides = 6) => {
    const positions: number[] = [],
      normals: number[] = [],
      uvs: number[] = [],
      indices: number[] = [];
    const count = distant ? Math.min(5, sides) : sides;
    let length = 0;
    for (let ring = 0; ring < points.length; ring++) {
      const p = points[ring];
      if (ring) length += p.distanceTo(points[ring - 1]);
      const tangent = points[Math.min(points.length - 1, ring + 1)]
        .clone()
        .sub(points[Math.max(0, ring - 1)])
        .normalize();
      const rotation = new T.Quaternion().setFromUnitVectors(up, tangent);
      for (let side = 0; side <= count; side++) {
        const angle = (side / count) * TAU;
        const normal = new T.Vector3(
          Math.sin(angle),
          0,
          Math.cos(angle),
        ).applyQuaternion(rotation);
        const uneven =
          1 +
          0.065 * Math.sin(angle * 3 + p.y * 2.7) +
          0.035 * Math.cos(angle * 5 - p.y);
        const vertex = p.clone().addScaledVector(normal, radii[ring] * uneven);
        positions.push(vertex.x, vertex.y, vertex.z);
        normals.push(normal.x, normal.y, normal.z);
        uvs.push((side / count) * TAU * radii[0], length);
        if (ring && side < count) {
          const a = (ring - 1) * (count + 1) + side,
            b = ring * (count + 1) + side;
          indices.push(a, a + 1, b, a + 1, b + 1, b);
        }
      }
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute(
      "position",
      new T.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute("normal", new T.Float32BufferAttribute(normals, 3));
    geometry.setAttribute("uv", new T.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    wood.push(geometry);
  };
  const vec = (x: number, y: number, z: number) => new T.Vector3(x, y, z);
  if (species === 2) {
    stem(
      [
        vec(0, 0, 0),
        vec(0.04, 0.65, -0.04),
        vec(-0.1, 3.5, 0.08),
        vec(0.16, 7.2, -0.06),
        vec(0.02, 11.1, -0.17),
        vec(0.17, 14.6, -0.1),
      ],
      [0.38, 0.29, 0.25, 0.18, 0.09, 0.018],
      9,
    );
    // Spiral/irregular attachment heights remove the conspicuous horizontal
    // whorls. Lower boughs droop, then curl upward; upper shoots are more erect.
    const boughs = 48;
    for (let bough = 0; bough < boughs; bough++) {
      const t = bough / boughs,
        y = 2.9 + t * 10.85 + (random() - 0.5) * 0.56;
      const angle = bough * 2.39996 + (random() - 0.5) * 0.8;
      const envelope = 3.24 * Math.pow(1 - t * 0.96, 0.83);
      const reach = envelope * (0.73 + random() * 0.3),
        droop = (0.3 + random() * 0.48) * (1 - t);
      const root = vec(0.04 * Math.sin(y), y, (-0.045 * y) / 14);
      const middle = vec(
        Math.sin(angle) * reach * 0.52,
        y - droop,
        Math.cos(angle) * reach * 0.52,
      );
      const tip = vec(
        Math.sin(angle + 0.13) * reach,
        y - droop * 0.45 + 0.14 + random() * 0.34,
        Math.cos(angle + 0.13) * reach,
      );
      if (!distant || bough % 8 === 0)
        stem(
          [root, middle, tip],
          [0.078 * (1 - t * 0.77), 0.041 * (1 - t * 0.75), 0.006],
          distant ? 3 : 5,
        );
      for (let tuft = 0; tuft < 4; tuft++) {
        const along = 0.23 + tuft * 0.225;
        const center = root
          .clone()
          .multiplyScalar((1 - along) ** 2)
          .addScaledVector(middle, 2 * along * (1 - along))
          .addScaledVector(tip, along * along);
        const lateral = (random() - 0.5) * (0.4 + reach * 0.2);
        center.x += Math.cos(angle) * lateral;
        center.z -= Math.sin(angle) * lateral;
        center.y += (random() - 0.5) * 0.36;
        const size = (0.88 + random() * 0.38) * (1 - t * 0.54);
        for (let spray = 0; spray < 2; spray++) {
          const bearing =
            angle + (spray ? -0.65 : 0.65) + (random() - 0.5) * 0.7;
          const lift = spray
            ? -0.5 + t * 0.8 + random() * 0.85
            : 0.38 + random() * 0.9;
          const orientation = new T.Quaternion().setFromUnitVectors(
            up,
            vec(
              Math.sin(bearing) * 0.8,
              lift,
              Math.cos(bearing) * 0.8,
            ).normalize(),
          );
          orientation.multiply(
            new T.Quaternion().setFromAxisAngle(up, (random() - 0.5) * 1.8),
          );
          const shade = 0.82 + random() * 0.24,
            fold = 0.14 + random() * 0.07;
          if (!distant || spray === (bough + tuft) % 2)
            cards.add(
              center,
              size * (distant ? 1.26 : 1.08),
              size * (distant ? 1.92 : 1.68),
              0,
              0,
              0,
              y,
              orientation,
              {
                fold: distant ? 0 : fold,
                shade,
                normalOrigin: vec(root.x, center.y - 0.25, root.z),
              },
            );
        }
      }
    }
    for (let tip = 0; tip < 5; tip++)
      cards.add(
        vec(0.12, 14.15 + tip * 0.055, -0.1),
        0.5,
        1.15,
        tip * 2.399,
        0.15,
        -0.12,
        13.7,
        undefined,
        { fold: distant ? 0 : 0.13, shade: 0.94 },
      );
  } else {
    const tall = species === 1,
      crownY = tall ? 9.4 : 7.85,
      crownHeight = tall ? 3.55 : 2.65,
      radius = tall ? 3.15 : 4.35;
    stem(
      [
        vec(0, 0, 0),
        vec(0.06, 0.55, -0.05),
        vec(-0.11, 2.3, 0.12),
        vec(0.19, 4.2, 0.09),
        vec(0.34, 6.6, -0.18),
      ],
      [tall ? 0.47 : 0.59, tall ? 0.35 : 0.45, 0.32, 0.23, 0.09],
      9,
    );
    if (!distant)
      for (let root = 0; root < 3; root++) {
        const a = root * 2.3 + 0.42;
        stem(
          [
            vec(Math.sin(a) * 0.67, 0.015, Math.cos(a) * 0.67),
            vec(Math.sin(a) * 0.35, 0.22, Math.cos(a) * 0.35),
            vec(0.02, 0.92, 0),
          ],
          [0.12, 0.16, 0.08],
          4,
        );
      }
    const lobes = tall ? 11 : 13;
    for (let lobe = 0; lobe < lobes; lobe++) {
      const h = 1 - (2 * (lobe + 0.7)) / (lobes + 0.5),
        ring = Math.sqrt(Math.max(0.05, 1 - h * h));
      const angle = lobe * 2.399 + (random() - 0.5) * 0.48;
      const reach = radius * ring * (0.66 + random() * 0.3);
      const center = vec(
        Math.sin(angle) * reach,
        crownY + h * crownHeight * 0.83 + (random() - 0.5) * 0.6,
        Math.cos(angle) * reach,
      );
      const lobeRadius = 1.12 + random() * 0.4;
      const junction = vec(0.05, 2.8 + random() * 1.5, 0.08),
        elbow = vec(center.x * 0.28, 4.7 + random() * 0.7, center.z * 0.24);
      const fork = vec(center.x * 0.7, center.y - 0.68, center.z * 0.67);
      if (lobe < 10 && (!distant || lobe % 3 === 0)) {
        stem(
          distant ? [junction, center] : [junction, elbow, fork, center],
          distant ? [0.17, 0.025] : [0.19 - lobe * 0.009, 0.12, 0.057, 0.014],
          distant ? 3 : 5,
        );
        if (!distant)
          stem(
            [
              fork,
              vec(
                center.x + Math.cos(angle) * 0.68,
                center.y + 0.55,
                center.z - Math.sin(angle) * 0.68,
              ),
            ],
            [0.04, 0.009],
            4,
          );
      }
      // Overlapping lobes plus a modest interior layer make a full crown. The
      // folded, rotated sprays have no shared billboard plane or fan direction.
      const sprays = tall ? 13 : 14;
      for (let spray = 0; spray < sprays; spray++) {
        const v = 1 - (2 * (spray + 0.5)) / sprays,
          ringRadius = Math.sqrt(Math.max(0, 1 - v * v));
        const a = spray * 2.399 + lobe * 0.67 + (random() - 0.5) * 0.45;
        const offset = lobeRadius * (0.58 + random() * 0.5);
        const p = center
          .clone()
          .add(
            vec(
              Math.sin(a) * ringRadius * offset,
              v * offset * 0.88,
              Math.cos(a) * ringRadius * offset,
            ),
          );
        const width = 1.66 + random() * 0.55,
          yaw = a + (random() - 0.5) * 1.7,
          pitch = (random() - 0.5) * 2.2,
          roll = (random() - 0.5) * 1.6;
        const shade = 0.85 + random() * 0.24,
          fold = 0.1 + random() * 0.12;
        if (!distant || spray % 3 === 0)
          cards.add(
            p,
            width * (distant ? 1.2 : 1),
            width * 0.82 * (distant ? 1.2 : 1),
            yaw,
            pitch,
            roll,
            crownY,
            undefined,
            { fold: distant ? 0 : fold, shade, normalOrigin: center },
          );
      }
    }
    const inner = tall ? 20 : 28;
    for (let i = 0; i < inner; i++) {
      const a = i * 2.399,
        r = radius * Math.sqrt(random()) * 0.64;
      const center = vec(
        Math.sin(a) * r,
        crownY + (random() - 0.5) * crownHeight * 1.75,
        Math.cos(a) * r,
      );
      const width = 1.8 + random() * 0.5,
        pitch = (random() - 0.5) * 1.9;
      if (!distant || i % 3 === 0)
        cards.add(
          center,
          width * (distant ? 1.2 : 1),
          width * 0.84,
          a,
          pitch,
          0.28,
          crownY,
          undefined,
          {
            fold: distant ? 0 : 0.16,
            shade: 0.78 + random() * 0.12,
            normalOrigin: vec(0, crownY - 0.7, 0),
          },
        );
      else random();
    }
  }
  const trunk = mergeGeometries(wood, false)!;
  for (const part of wood) part.dispose();
  const leaves = cards.geometry();
  // Keep the original placement clearance envelope despite the richer geometry.
  const nominalRadius = species === 0 ? 5.7 : species === 1 ? 4.45 : 3.8;
  const correction = nominalRadius / horizontalRadius(leaves);
  trunk.scale(correction, 1, correction);
  leaves.scale(correction, 1, correction);
  trunk.computeBoundingSphere();
  leaves.computeBoundingSphere();
  return { trunk, leaves };
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
        footprint: points.map((p): [number, number] => [p[0], p[2]]),
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
  /** A surveyed crown may overhang pavement/roofs; only its unmoved trunk is excluded. */
  trunkClear(x: number, z: number, radius: number): boolean {
    const key = cellKey(x, z, INDEX_SIZE);
    for (const segment of this.roads.get(key) ?? [])
      if (
        segmentDistanceSquared(
          x,
          z,
          [segment.ax, segment.az],
          [segment.bx, segment.bz],
        ) <
        (segment.width / 2 + radius + 0.55) ** 2
      )
        return false;
    for (const box of this.buildings.get(key) ?? []) {
      const points = box.footprint!;
      if (insidePolygon(x, z, points)) return false;
      for (let i = 0; i < points.length; i++)
        if (
          segmentDistanceSquared(
            x,
            z,
            points[i],
            points[(i + 1) % points.length],
          ) <
          (radius + 0.25) ** 2
        )
          return false;
    }
    return true;
  }
  spaced(x: number, z: number, radius: number, observed = false): boolean {
    const cx = Math.floor(x / 16),
      cz = Math.floor(z / 16);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++)
        for (const tree of this.occupied.get(`${cx + dx},${cz + dz}`) ?? [])
          if (
            !observed &&
            Math.hypot(x - tree.x, z - tree.z) < radius + tree.radius
          )
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
    referenceTreeCount: 0,
    referenceWoodlandTreeCount: 0,
    referenceOmittedTreeCount: 0,
    backyardTreeCount: 0,
  };
  private chunks: Chunk[] = [];
  private geometries: T.BufferGeometry[] = [];
  private materials: T.Material[] = [];
  private textures: T.Texture[] = [];
  private quality: VegetationQuality;
  private timeUniform = { value: 0 };
  private lastUpdate = -Infinity;
  private exploring = false;
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
    const candidate = map.beverlySurvey as BeverlyVegetationSurvey | undefined;
    const survey =
      candidate?.bounds &&
      [
        candidate.bounds.minX,
        candidate.bounds.maxX,
        candidate.bounds.minZ,
        candidate.bounds.maxZ,
      ].every(Number.isFinite) &&
      candidate.bounds.minX < candidate.bounds.maxX &&
      candidate.bounds.minZ < candidate.bounds.maxZ
        ? candidate
        : undefined;
    const backyardCandidate = map.backyard as
      BackyardVegetationSurvey | undefined;
    const backyard =
      backyardCandidate?.bounds &&
      [
        backyardCandidate.bounds.minX,
        backyardCandidate.bounds.maxX,
        backyardCandidate.bounds.minZ,
        backyardCandidate.bounds.maxZ,
      ].every(Number.isFinite) &&
      backyardCandidate.bounds.minX < backyardCandidate.bounds.maxX &&
      backyardCandidate.bounds.minZ < backyardCandidate.bounds.maxZ
        ? backyardCandidate
        : undefined;
    const inBeverlySurvey = (x: number, z: number) =>
      !!survey &&
      x >= survey.bounds.minX &&
      x <= survey.bounds.maxX &&
      z >= survey.bounds.minZ &&
      z <= survey.bounds.maxZ;
    const inBackyard = (x: number, z: number) =>
      !!backyard &&
      x >= backyard.bounds.minX &&
      x <= backyard.bounds.maxX &&
      z >= backyard.bounds.minZ &&
      z <= backyard.bounds.maxZ;
    const inSurvey = (x: number, z: number) =>
      inBeverlySurvey(x, z) || inBackyard(x, z);
    const inBackyardWoodland = (x: number, z: number) =>
      inBackyard(x, z) &&
      (backyard?.woodlands ?? []).some(
        (woodland) =>
          woodland.points.length >= 3 && insidePolygon(x, z, woodland.points),
      );
    const referenceCanopies: Record<string, unknown>[] = [];
    const backyardTrees: [number, number, number][] = [];
    const backyardCanopies: Record<string, unknown>[] = [];
    const ponds = (survey?.landcover ?? []).filter(
      (cover) => cover.kind === "pond" && cover.points.length >= 3,
    );
    const pondClear = (x: number, z: number, radius: number) => {
      for (const pond of ponds) {
        if (insidePolygon(x, z, pond.points)) return false;
        for (let i = 0; i < pond.points.length; i++)
          if (
            segmentDistanceSquared(
              x,
              z,
              pond.points[i],
              pond.points[(i + 1) % pond.points.length],
            ) <
            (radius + 0.2) ** 2
          )
            return false;
      }
      return true;
    };
    const surveyRandom = seeded((options.seed ?? 442) ^ 0x5e7e9);
    const backyardRandom = seeded((options.seed ?? 442) ^ 0x57c0a9);
    const propertyClear = createPropertyClearance(map);
    // Stream banks are reserved before every tree/grass/shrub placement. The
    // varying channel width is conservatively bounded per station segment.
    const streamSegments: {
      a: [number, number];
      b: [number, number];
      halfWidth: number;
      minX: number;
      maxX: number;
      minZ: number;
      maxZ: number;
    }[] = [];
    const stations = backyard?.stream?.stations ?? [];
    for (let i = 1; i < stations.length; i++) {
      const a = stations[i - 1],
        b = stations[i];
      if (
        !a.point?.every(Number.isFinite) ||
        !b.point?.every(Number.isFinite) ||
        !Number.isFinite(a.width) ||
        !Number.isFinite(b.width)
      )
        continue;
      const halfWidth = Math.max(0, a.width, b.width) / 2 + 0.9;
      streamSegments.push({
        a: a.point,
        b: b.point,
        halfWidth,
        minX: Math.min(a.point[0], b.point[0]) - halfWidth,
        maxX: Math.max(a.point[0], b.point[0]) + halfWidth,
        minZ: Math.min(a.point[1], b.point[1]) - halfWidth,
        maxZ: Math.max(a.point[1], b.point[1]) + halfWidth,
      });
    }
    const streamClear = (x: number, z: number, radius: number) =>
      streamSegments.every(
        (segment) =>
          x < segment.minX - radius ||
          x > segment.maxX + radius ||
          z < segment.minZ - radius ||
          z > segment.maxZ + radius ||
          segmentDistanceSquared(x, z, segment.a, segment.b) >=
            (segment.halfWidth + radius) ** 2,
      );
    const drivewayClear = (x: number, z: number, radius: number) => {
      if (!streamClear(x, z, radius) || !propertyClear(x, z, radius))
        return false;
      for (const driveway of survey?.driveways ?? []) {
        const clearance =
          Math.max(0, driveway.widthMeters || 0) / 2 + radius + 0.25;
        for (let i = 1; i < driveway.points.length; i++)
          if (
            segmentDistanceSquared(
              x,
              z,
              driveway.points[i - 1],
              driveway.points[i],
            ) <
            clearance ** 2
          )
            return false;
      }
      return true;
    };
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
        crown = (species === 0 ? 5.7 : species === 1 ? 4.45 : 3.8) * scale,
        trunkRadius = Math.max(0.15, scale * (species === 2 ? 0.29 : 0.47));
      if (
        !inBounds(x, z) ||
        inSurvey(x, z) ||
        !index.clear(x, z, crown, roadside ? 4 : 2, 4.8) ||
        !drivewayClear(x, z, trunkRadius) ||
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
    const addReferenceTree = (
      x: number,
      z: number,
      radiusMeters: number,
      type: "broadleaf" | "conifer" | "mixed",
      woodland = false,
      confidence?: string | number,
      backyardTree = false,
    ) => {
      const species: Species =
        type === "conifer"
          ? 2
          : type === "mixed" && surveyRandom() < 0.2
            ? 2
            : surveyRandom() < 0.46
              ? 1
              : 0;
      const scale = clamp(
        radiusMeters / (species === 0 ? 5.7 : species === 1 ? 4.45 : 3.8),
        0.25,
        2.6,
      );
      const trunkRadius = Math.max(0.15, scale * (species === 2 ? 0.29 : 0.47));
      const valid =
        Number.isFinite(x) &&
        Number.isFinite(z) &&
        Number.isFinite(radiusMeters) &&
        radiusMeters > 0;
      const blocked = !valid
        ? "invalid geometry"
        : !streamClear(x, z, trunkRadius)
          ? "stream channel or bank obstruction"
          : !pondClear(x, z, trunkRadius)
            ? "pond trunk obstruction"
            : !index.trunkClear(x, z, trunkRadius)
              ? "road or building trunk obstruction"
              : !drivewayClear(x, z, trunkRadius)
                ? "driveway trunk obstruction"
                : null;
      if (blocked) {
        if (!woodland && !backyardTree) {
          this.stats.referenceOmittedTreeCount++;
          referenceCanopies.push({
            center: [x, z],
            radiusMeters,
            type,
            confidence,
            omitted: blocked,
          });
        }
        return;
      }
      // Measured crowns may overlap. Never relocate or thin individually observed centers.
      if (woodland && !index.spaced(x, z, radiusMeters * 0.36)) return;
      if (!woodland) index.spaced(x, z, Math.min(4, radiusMeters * 0.36), true);
      chunk(x, z).trees[species].push({
        x,
        y: heightAt(map, x, z) - 0.06,
        z,
        scale,
        radiusMeters,
        yaw: surveyRandom() * TAU,
        tone: surveyRandom(),
        species,
      });
      this.stats.trees++;
      if (backyardTree) {
        this.stats.backyardTreeCount++;
        backyardTrees.push([x, z, trunkRadius]);
        backyardCanopies.push({
          center: [x, z],
          radiusMeters,
          trunkRadiusMeters: trunkRadius,
          type,
          confidence,
          observedCenter: !woodland,
        });
      } else if (woodland) this.stats.referenceWoodlandTreeCount++;
      else {
        this.stats.referenceTreeCount++;
        referenceCanopies.push({
          center: [x, z],
          radiusMeters,
          type,
          confidence,
          omitted: null,
        });
      }
    };
    if (survey) {
      this.root.name =
        "Surveyed Beverly vegetation and surrounding procedural woodland";
      for (const canopy of survey.canopies ?? []) {
        if (inBackyardWoodland(...canopy.center)) {
          this.stats.referenceOmittedTreeCount++;
          referenceCanopies.push({
            ...canopy,
            omitted: "superseded by backyard woodland reference",
          });
          continue;
        }
        addReferenceTree(
          canopy.center[0],
          canopy.center[1],
          canopy.radiusMeters,
          canopy.type,
          false,
          canopy.confidence,
        );
      }
      for (const woodland of survey.woodlands ?? []) {
        if (
          woodland.points.length < 3 ||
          !woodland.points.every((p) => p.every(Number.isFinite))
        )
          continue;
        const minX = Math.max(
            survey.bounds.minX,
            Math.min(...woodland.points.map((p) => p[0])),
          ),
          maxX = Math.min(
            survey.bounds.maxX,
            Math.max(...woodland.points.map((p) => p[0])),
          ),
          minZ = Math.max(
            survey.bounds.minZ,
            Math.min(...woodland.points.map((p) => p[1])),
          ),
          maxZ = Math.min(
            survey.bounds.maxZ,
            Math.max(...woodland.points.map((p) => p[1])),
          ),
          spacing = Math.max(
            4,
            Number.isFinite(woodland.spacing) && woodland.spacing! > 0
              ? woodland.spacing!
              : 9,
          );
        for (let z = minZ + spacing / 2; z < maxZ; z += spacing)
          for (let x = minX + spacing / 2; x < maxX; x += spacing) {
            const px = x + (surveyRandom() - 0.5) * spacing * 0.65,
              pz = z + (surveyRandom() - 0.5) * spacing * 0.65;
            if (
              inBeverlySurvey(px, pz) &&
              !inBackyard(px, pz) &&
              insidePolygon(px, pz, woodland.points)
            )
              addReferenceTree(
                px,
                pz,
                3.8 + surveyRandom() * 2.3,
                "mixed",
                true,
              );
          }
      }
      this.root.userData.surveyBounds = { ...survey.bounds };
      this.root.userData.referenceCanopies = referenceCanopies;
      this.root.userData.surveyProvenance =
        "Observed canopy centers/radii and explicit woodland extent; broad vegetation type only. Height, branch shape and woodland interior stems are approximations. Blocked observed trunks are omitted, never relocated.";
    }
    if (backyard) {
      for (const canopy of backyard.canopies ?? [])
        if (inBackyard(...canopy.center))
          addReferenceTree(
            canopy.center[0],
            canopy.center[1],
            canopy.radiusMeters,
            canopy.type,
            false,
            canopy.confidence,
            true,
          );
      // This independent extent extends beyond the old Beverly survey's eastern
      // limit. Its rectangle suppresses generic planting; only the observed
      // ground-cover polygon receives representative mature woodland stems.
      for (const woodland of backyard.woodlands ?? []) {
        if (
          woodland.points.length < 3 ||
          !woodland.points.every((p) => p.every(Number.isFinite))
        )
          continue;
        const minX = Math.max(
            backyard.bounds.minX,
            Math.min(...woodland.points.map((p) => p[0])),
          ),
          maxX = Math.min(
            backyard.bounds.maxX,
            Math.max(...woodland.points.map((p) => p[0])),
          ),
          minZ = Math.max(
            backyard.bounds.minZ,
            Math.min(...woodland.points.map((p) => p[1])),
          ),
          maxZ = Math.min(
            backyard.bounds.maxZ,
            Math.max(...woodland.points.map((p) => p[1])),
          ),
          spacing = Math.max(
            6,
            Number.isFinite(woodland.spacing) && woodland.spacing! > 0
              ? woodland.spacing!
              : 8.5,
          );
        for (let z = minZ + spacing / 2; z < maxZ; z += spacing)
          for (let x = minX + spacing / 2; x < maxX; x += spacing) {
            const px = x + (backyardRandom() - 0.5) * spacing * 0.6,
              pz = z + (backyardRandom() - 0.5) * spacing * 0.6;
            if (
              inBounds(px, pz) &&
              inBackyard(px, pz) &&
              insidePolygon(px, pz, woodland.points)
            )
              addReferenceTree(
                px,
                pz,
                4.5 + backyardRandom() * 1.5,
                woodland.type ?? "broadleaf",
                true,
                woodland.confidence,
                true,
              );
          }
      }
      this.root.userData.backyardBounds = { ...backyard.bounds };
      this.root.userData.backyardTrees = backyardTrees;
      this.root.userData.backyardCanopies = backyardCanopies;
      this.root.userData.backyardProvenance =
        "Aerial-observed woodland ground boundary with representative interior stems and crown sizes; source canopy observations are not relocated. Channel and bank clearances follow the compiled stream stations.";
    }
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
            if (
              inBounds(gx, gz) &&
              !inSurvey(gx, gz) &&
              drivewayClear(gx, gz, 0.3) &&
              index.clear(gx, gz, 0.3, 1, 1.1)
            ) {
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
          if (
            inBounds(px, pz) &&
            !inSurvey(px, pz) &&
            drivewayClear(px, pz, 0.8) &&
            index.clear(px, pz, 0.8, 0.2, 2)
          ) {
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
    pineMaterial.color.setRGB(0.73, 0.83, 0.78);
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
    // Eight aspect variants share each mesh/draw call. Normalizing against the
    // transformed crown keeps every observed radius exact, rather than changing
    // survey data to gain tree-to-tree variation. Heights remain approximations.
    const aspects = Array.from({ length: 8 }, (_, i) => 0.84 + (i * 0.29) / 7);
    const templateRadii = templates.map((template) =>
        aspects.map((aspect) => horizontalRadius(template.leaves, aspect)),
      ),
      distantRadii = distantTemplates.map((template) =>
        aspects.map((aspect) => horizontalRadius(template.leaves, aspect)),
      );
    const dummy = new T.Object3D(),
      tint = new T.Color();
    const instances = (
      plants: Plant[],
      geometry: T.BufferGeometry,
      material: T.Material,
      foliage: boolean,
      canopyRadii?: number[],
    ) => {
      const mesh = new T.InstancedMesh(geometry, material, plants.length);
      mesh.receiveShadow = true;
      plants.forEach((plant, i) => {
        dummy.position.set(plant.x, plant.y, plant.z);
        dummy.rotation.set(0, plant.yaw, 0);
        const variant = Math.min(7, Math.floor(plant.tone * 8));
        const targetRadius =
          plant.radiusMeters ??
          plant.scale *
            (plant.species === 0 ? 5.7 : plant.species === 1 ? 4.45 : 3.8);
        const crownScale = canopyRadii
          ? targetRadius / canopyRadii[variant]
          : undefined;
        dummy.scale.set(
          crownScale === undefined
            ? plant.scale * (1 + plant.tone * 0.09)
            : crownScale * aspects[variant],
          plant.scale * (canopyRadii ? 0.9 + plant.tone * 0.2 : 1),
          crownScale ?? plant.scale,
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
              templateRadii[species],
            ),
            foliage = instances(
              plants.trees[species],
              templates[species].leaves,
              species === 2 ? pineMaterial : leafMaterial,
              true,
              templateRadii[species],
            );
          trees.push(wood, foliage);
          root.add(wood, foliage);
          const distantWood = instances(
              plants.trees[species],
              distantTemplates[species].trunk,
              bark,
              false,
              distantRadii[species],
            ),
            distantFoliage = instances(
              plants.trees[species],
              distantTemplates[species].leaves,
              species === 2 ? pineMaterial : leafMaterial,
              true,
              distantRadii[species],
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
      vertexColors: true,
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
        `#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * ${grass ? ".16" : conifer ? ".035" : ".075"};`,
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
          ? "neighborhood-conifer-v4"
          : "neighborhood-foliage-v4";
    return material;
  }

  setQuality(quality: VegetationQuality) {
    this.quality = quality;
    this.lastUpdate = -Infinity;
  }
  setExploring(active: boolean) {
    if (this.exploring === active) return;
    this.exploring = active;
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
      this.quality === "low"
        ? 0
        : this.exploring
          ? 110
          : this.quality === "medium"
            ? 180
            : 230;
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
      const detailed =
        d < (this.quality === "low" ? 130 : this.exploring ? 150 : 300);
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
