import * as T from "three";
import type { Point } from "./types";

/** Root-approved oriented envelope. Placement and road-clearance colliders remain in roads.ts. */
export interface NeighborhoodHouse {
  id: string | number;
  x: number;
  z: number;
  width: number;
  depth: number;
  heading: number;
  base: number;
  low: number;
  wallHeight: number;
  roadPosition: Point;
  roadWidth: number;
  kind?: string;
  approximate?: boolean;
}

export type NeighborhoodMaterialKey =
  | "siding"
  | "brick"
  | "roof"
  | "concrete"
  | "wood"
  | "grass"
  | "gravel"
  | "bark"
  | "trim"
  | "glass"
  | "metal"
  | "leaf";
export type NeighborhoodMaterials = Partial<
  Record<NeighborhoodMaterialKey, T.Material>
>;
export interface NeighborhoodOptions {
  heightAt: (x: number, z: number) => number;
  /** Signed distance outside the nearest widened asphalt edge, in meters. */
  roadClearance: (x: number, z: number) => number;
  materials?: NeighborhoodMaterials;
}

type UV = [number, number];
type V = [number, number, number];
type Face = 0 | 1 | 2 | 3;
const CELL = 512;
const HALF_PI = Math.PI / 2;
const HOUSE_COLORS = [
  0xc7c6b7, 0xaebbc0, 0xb7bfae, 0xc5b9a4, 0xc2bfb9, 0xaeb4a9, 0xb3bdc3,
  0xc8bfae,
];
const DOOR_COLORS = [0x344846, 0x344351, 0x62433b, 0x796f58, 0x514c45];
const SHUTTER_COLORS = [0x334844, 0x454c4c, 0x4e5146, 0x414c5c, 0x684e44];
const clamp = (n: number, low: number, high: number) =>
  Math.max(low, Math.min(high, n));
const colorCache = new Map<number, T.Color>();
function color(hex: number) {
  let value = colorCache.get(hex);
  if (!value) colorCache.set(hex, (value = new T.Color(hex)));
  return value;
}
function seeded(id: string | number) {
  let state = 2166136261;
  for (const character of String(id))
    state = Math.imul(state ^ character.charCodeAt(0), 16777619);
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
function tinted(hex: number, amount: number) {
  return new T.Color(hex).multiplyScalar(amount).getHex();
}

/** One compact static buffer per spatial cell/material, with meter-scaled UVs. */
class SurfaceBatch {
  positions: number[] = [];
  normals: number[] = [];
  uvs: number[] = [];
  colors: number[] = [];
  constructor(
    public material: NeighborhoodMaterialKey,
    public shadows: boolean,
  ) {}
  triangle(a: V, b: V, c: V, ua: UV, ub: UV, uc: UV, tint: number) {
    const abx = b[0] - a[0],
      aby = b[1] - a[1],
      abz = b[2] - a[2];
    const acx = c[0] - a[0],
      acy = c[1] - a[1],
      acz = c[2] - a[2];
    let nx = aby * acz - abz * acy,
      ny = abz * acx - abx * acz,
      nz = abx * acy - aby * acx;
    const length = Math.hypot(nx, ny, nz);
    if (length < 1e-8) return;
    nx /= length;
    ny /= length;
    nz /= length;
    const rgb = color(tint);
    for (const [p, uv] of [
      [a, ua],
      [b, ub],
      [c, uc],
    ] as [V, UV][]) {
      this.positions.push(...p);
      this.normals.push(nx, ny, nz);
      this.uvs.push(...uv);
      this.colors.push(rgb.r, rgb.g, rgb.b);
    }
  }
  quad(
    a: V,
    b: V,
    c: V,
    d: V,
    width: number,
    height: number,
    tint: number,
    swapUV = false,
  ) {
    const uv = (u: number, v: number): UV => (swapUV ? [v, u] : [u, v]);
    this.triangle(a, b, c, uv(0, 0), uv(width, 0), uv(width, height), tint);
    this.triangle(a, c, d, uv(0, 0), uv(width, height), uv(0, height), tint);
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
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }
}

function defaultMaterial(key: NeighborhoodMaterialKey): T.MeshStandardMaterial {
  if (key === "leaf") {
    // Original fine boxwood leaf pattern: close planting reads as foliage,
    // while an inexpensive rounded silhouette remains appropriate for hedges.
    const size = 128,
      pixels = new Uint8Array(size * size * 4),
      random = seeded("boxwood-leaf-detail");
    for (let i = 0; i < size * size; i++) {
      const value = 55 + Math.floor(random() * 28);
      pixels[i * 4] = pixels[i * 4 + 1] = pixels[i * 4 + 2] = value;
      pixels[i * 4 + 3] = 255;
    }
    for (let leaf = 0; leaf < 540; leaf++) {
      const cx = random() * size,
        cy = random() * size,
        angle = random() * Math.PI * 2;
      const rx = 2.3 + random() * 1.8,
        ry = 4.1 + random() * 2.4,
        co = Math.cos(angle),
        si = Math.sin(angle);
      for (let y = -7; y <= 7; y++)
        for (let x = -7; x <= 7; x++) {
          const u = x * co - y * si,
            v = x * si + y * co;
          const edge = (u * u) / (rx * rx) + (v * v) / (ry * ry);
          if (edge > 1) continue;
          const px = (Math.floor(cx + x) + size) % size,
            py = (Math.floor(cy + y) + size) % size;
          const value = Math.floor(
            125 +
              (1 - edge) * 87 +
              (v / ry) * 19 +
              (Math.abs(u) < 0.45 ? 16 : 0),
          );
          const index = (py * size + px) * 4;
          pixels[index] = pixels[index + 1] = pixels[index + 2] = value;
        }
    }
    const texture = new T.DataTexture(pixels, size, size, T.RGBAFormat);
    texture.colorSpace = T.SRGBColorSpace;
    texture.wrapS = texture.wrapT = T.RepeatWrapping;
    texture.generateMipmaps = true;
    texture.minFilter = T.LinearMipmapLinearFilter;
    texture.magFilter = T.LinearFilter;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return new T.MeshStandardMaterial({
      color: 0xffffff,
      map: texture,
      bumpMap: texture,
      bumpScale: 0.055,
      roughness: 0.94,
      vertexColors: true,
    });
  }
  if (key === "glass")
    return new T.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.17,
      metalness: 0.42,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      envMapIntensity: 1.1,
      vertexColors: true,
    });
  return new T.MeshStandardMaterial({
    color: 0xffffff,
    roughness: key === "metal" ? 0.44 : key === "trim" ? 0.69 : 0.94,
    metalness: key === "metal" ? 0.48 : 0,
    vertexColors: true,
    side: T.FrontSide,
  });
}

/**
 * Plausible Hudson Valley architecture, not surveyed facade reconstruction.
 * No driveways are invented between private yards and mapped streets. Every
 * decoration is non-colliding; the existing approved chassis barriers stay owned
 * by Environment. Geometry is returned inside a group to preserve these UV/color
 * batches when the parent batches its untextured road meshes.
 */
export function buildNeighborhood(
  houses: NeighborhoodHouse[],
  options: NeighborhoodOptions,
): T.Group {
  const group = new T.Group();
  group.name = "Warwick architectural detail — generic facades";
  const batches = new Map<string, SurfaceBatch>();
  const materials = new Map<NeighborhoodMaterialKey, T.Material>();
  const shrubTemplate = new T.IcosahedronGeometry(1, 1);
  const shrubPositions = shrubTemplate.getAttribute("position");
  const shrubUVs = shrubTemplate.getAttribute("uv");
  let builtHouses = 0;
  let detailFeatures = 0;

  const getBatch = (
    key: NeighborhoodMaterialKey,
    x: number,
    z: number,
    shadows = true,
  ) => {
    const id = `${Math.floor(x / CELL)}:${Math.floor(z / CELL)}:${key}:${shadows}`;
    let batch = batches.get(id);
    if (!batch) batches.set(id, (batch = new SurfaceBatch(key, shadows)));
    return batch;
  };
  const box = (
    p: V,
    size: V,
    heading: number,
    key: NeighborhoodMaterialKey,
    tint: number,
    shadows = true,
  ) => {
    if (Math.min(...size) <= 0.001) return;
    const [w, h, d] = size.map((v) => v / 2);
    const co = Math.cos(heading),
      si = Math.sin(heading);
    const at = (x: number, y: number, z: number): V => [
      p[0] + x * co + z * si,
      p[1] + y,
      p[2] - x * si + z * co,
    ];
    const p0 = at(-w, -h, -d),
      p1 = at(w, -h, -d),
      p2 = at(w, h, -d),
      p3 = at(-w, h, -d);
    const p4 = at(-w, -h, d),
      p5 = at(w, -h, d),
      p6 = at(w, h, d),
      p7 = at(-w, h, d);
    const out = getBatch(key, p[0], p[2], shadows),
      swap = key === "siding";
    out.quad(p1, p0, p3, p2, w * 2, h * 2, tint, swap);
    out.quad(p4, p5, p6, p7, w * 2, h * 2, tint, swap);
    out.quad(p0, p4, p7, p3, d * 2, h * 2, tint, swap);
    out.quad(p5, p1, p2, p6, d * 2, h * 2, tint, swap);
    out.quad(p3, p7, p6, p2, d * 2, w * 2, tint, swap);
    out.quad(p0, p1, p5, p4, w * 2, d * 2, tint, swap);
  };
  const beam = (
    a: V,
    b: V,
    thickness: number,
    key: NeighborhoodMaterialKey,
    tint: number,
  ) => {
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz),
      horizontal = Math.hypot(dx, dz);
    if (len < 0.001) return;
    const rx = horizontal > 0.001 ? dz / horizontal : 1;
    const rz = horizontal > 0.001 ? -dx / horizontal : 0;
    const ux = (-dy / len) * rz,
      uy = (dz * rx - dx * rz) / len,
      uz = (dy / len) * rx;
    const corner = (p: V, u: number, v: number): V => [
      p[0] + ((rx * u + ux * v) * thickness) / 2,
      p[1] + (uy * v * thickness) / 2,
      p[2] + ((rz * u + uz * v) * thickness) / 2,
    ];
    const aa = [
      corner(a, -1, -1),
      corner(a, 1, -1),
      corner(a, 1, 1),
      corner(a, -1, 1),
    ];
    const bb = [
      corner(b, -1, -1),
      corner(b, 1, -1),
      corner(b, 1, 1),
      corner(b, -1, 1),
    ];
    const out = getBatch(key, a[0], a[2]);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      out.quad(aa[i], bb[i], bb[j], aa[j], len, thickness, tint);
    }
    out.quad(aa[3], aa[2], aa[1], aa[0], thickness, thickness, tint);
    out.quad(bb[0], bb[1], bb[2], bb[3], thickness, thickness, tint);
  };
  const shrub = (
    p: V,
    radius: number,
    stretch: number,
    tint: number,
    seed: number,
  ) => {
    const out = getBatch("leaf", p[0], p[2]);
    for (let i = 0; i < shrubPositions.count; i += 3) {
      const points: V[] = [],
        uvs: UV[] = [];
      for (let j = 0; j < 3; j++) {
        const n = i + j,
          x = shrubPositions.getX(n),
          y = shrubPositions.getY(n),
          z = shrubPositions.getZ(n);
        const wobble = 1 + Math.sin(x * 7.8 + z * 4.9 + seed) * 0.1;
        points.push([
          p[0] + x * radius * wobble,
          p[1] + y * radius * stretch,
          p[2] + z * radius * wobble,
        ]);
        uvs.push([shrubUVs.getX(n), shrubUVs.getY(n)]);
      }
      out.triangle(
        points[0],
        points[1],
        points[2],
        uvs[0],
        uvs[1],
        uvs[2],
        tint,
      );
      // Rounded canopy normals avoid the faceted low-poly lighting of the
      // underlying inexpensive foliage silhouette.
      const normalStart = out.normals.length - 9;
      for (let j = 0; j < 3; j++) {
        const dx = (points[j][0] - p[0]) / (radius * radius);
        const dy =
          (points[j][1] - p[1]) / (radius * radius * stretch * stretch);
        const dz = (points[j][2] - p[2]) / (radius * radius);
        const length = Math.hypot(dx, dy, dz) || 1;
        out.normals[normalStart + j * 3] = dx / length;
        out.normals[normalStart + j * 3 + 1] = dy / length;
        out.normals[normalStart + j * 3 + 2] = dz / length;
      }
    }
  };

  for (const house of houses) {
    if (
      ![
        house.x,
        house.z,
        house.width,
        house.depth,
        house.base,
        house.wallHeight,
      ].every(Number.isFinite) ||
      house.width < 2 ||
      house.depth < 2
    )
      continue;
    builtHouses++;
    const random = seeded(house.id);
    const co = Math.cos(house.heading),
      si = Math.sin(house.heading);
    const point = (x: number, y: number, z: number): V => [
      house.x + x * co + z * si,
      y,
      house.z - x * si + z * co,
    ];
    const localBox = (
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      key: NeighborhoodMaterialKey,
      tint: number,
      shadows = true,
    ) => box(point(x, y, z), [w, h, d], house.heading, key, tint, shadows);
    const halfW = house.width / 2,
      halfD = house.depth / 2;
    const roofBase = house.base + house.wallHeight;
    const utility =
      ["garage", "garages", "shed", "barn", "farm_auxiliary"].includes(
        house.kind || "",
      ) || house.width * house.depth < 34;
    const large = house.width > 26 || house.depth > 32;
    const wallMaterial: NeighborhoodMaterialKey =
      large || random() < 0.18 ? "brick" : "siding";
    const wallTint =
      wallMaterial === "brick"
        ? tinted(0xf0e9dd, 0.91 + random() * 0.09)
        : HOUSE_COLORS[Math.floor(random() * HOUSE_COLORS.length)];
    const trimTint = [0xe3e1d5, 0xd8d5c8, 0xe5e5dc][Math.floor(random() * 3)];
    const shutterTint =
      SHUTTER_COLORS[Math.floor(random() * SHUTTER_COLORS.length)];
    const roofTint = [0xbcbeb9, 0xc6bfaf, 0xa8b0b1, 0xbdb6ab][
      Math.floor(random() * 4)
    ];
    const doorTint = DOOR_COLORS[Math.floor(random() * DOOR_COLORS.length)];
    // The source-approved footprint and wall top do not move. Concrete foundations
    // absorb terrain grade under a level floor rather than leaving floating walls.
    const foundationTop = house.base + 0.3;
    localBox(
      0,
      (house.low + foundationTop) / 2,
      0,
      house.width + 0.05,
      foundationTop - house.low,
      house.depth + 0.05,
      "concrete",
      0xb8b6a9,
    );
    localBox(
      0,
      (foundationTop + roofBase) / 2,
      0,
      house.width,
      roofBase - foundationTop,
      house.depth,
      wallMaterial,
      wallTint,
    );
    for (const x of [-halfW, halfW])
      for (const z of [-halfD, halfD])
        localBox(
          x,
          (foundationTop + roofBase) / 2,
          z,
          0.13,
          roofBase - foundationTop + 0.04,
          0.13,
          "trim",
          trimTint,
          false,
        );
    // Foundation sill, frieze boards and an eave shadow make each wall read as a
    // constructed facade at driving-camera height.
    for (const z of [-halfD, halfD]) {
      localBox(
        0,
        foundationTop + 0.04,
        z,
        house.width + 0.08,
        0.12,
        0.1,
        "trim",
        trimTint,
        false,
      );
      localBox(
        0,
        roofBase - 0.12,
        z,
        house.width + 0.12,
        0.2,
        0.1,
        "trim",
        trimTint,
        false,
      );
    }
    for (const x of [-halfW, halfW])
      localBox(
        x,
        roofBase - 0.12,
        0,
        0.1,
        0.2,
        house.depth + 0.12,
        "trim",
        trimTint,
        false,
      );

    const w = halfW + 0.42,
      d = halfD + 0.42;
    const rise = Math.min(
      large ? 1.8 : utility ? 1.9 : 3.1,
      Math.max(1.05, house.width * (utility ? 0.17 : 0.245)),
    );
    const hip = !utility && (large || random() < 0.29);
    const ridgeEnd = hip ? Math.max(0.2, d - w * 0.8) : d;
    const slope = Math.hypot(w, rise);
    const roofBatch = getBatch("roof", house.x, house.z);
    const rp = (x: number, y: number, z: number) => point(x, roofBase + y, z);
    // u follows eaves/ridge; v climbs the slope, so slate courses face correctly.
    roofBatch.quad(
      rp(-w, 0, -d),
      rp(-w, 0, d),
      rp(0, rise, ridgeEnd),
      rp(0, rise, -ridgeEnd),
      d * 2,
      slope,
      roofTint,
    );
    roofBatch.quad(
      rp(0, rise, -ridgeEnd),
      rp(0, rise, ridgeEnd),
      rp(w, 0, d),
      rp(w, 0, -d),
      d * 2,
      slope,
      roofTint,
    );
    if (hip) {
      roofBatch.triangle(
        rp(-w, 0, d),
        rp(w, 0, d),
        rp(0, rise, ridgeEnd),
        [0, 0],
        [w * 2, 0],
        [w, Math.hypot(d - ridgeEnd, rise)],
        roofTint,
      );
      roofBatch.triangle(
        rp(w, 0, -d),
        rp(-w, 0, -d),
        rp(0, rise, -ridgeEnd),
        [0, 0],
        [w * 2, 0],
        [w, Math.hypot(d - ridgeEnd, rise)],
        roofTint,
      );
      for (const z of [-d, d])
        for (const x of [-w, w])
          beam(
            rp(x, 0.035, z),
            rp(0, rise + 0.035, Math.sign(z) * ridgeEnd),
            0.12,
            "roof",
            roofTint,
          );
    } else {
      const gable = getBatch(wallMaterial, house.x, house.z);
      const uv = (u: number, v: number): UV =>
        wallMaterial === "siding" ? [v, u] : [u, v];
      gable.triangle(
        rp(-halfW, 0, halfD),
        rp(halfW, 0, halfD),
        rp(0, rise - 0.09, halfD),
        uv(0, 0),
        uv(house.width, 0),
        uv(halfW, rise),
        wallTint,
      );
      gable.triangle(
        rp(halfW, 0, -halfD),
        rp(-halfW, 0, -halfD),
        rp(0, rise - 0.09, -halfD),
        uv(0, 0),
        uv(house.width, 0),
        uv(halfW, rise),
        wallTint,
      );
      for (const z of [-d, d])
        for (const x of [-w, w])
          beam(rp(x, -0.04, z), rp(0, rise - 0.04, z), 0.14, "trim", trimTint);
    }
    beam(
      rp(0, rise + 0.04, -ridgeEnd),
      rp(0, rise + 0.04, ridgeEnd),
      0.14,
      "roof",
      roofTint,
    );
    for (const x of [-w, w]) {
      localBox(
        x,
        roofBase - 0.07,
        0,
        0.16,
        0.19,
        d * 2,
        "trim",
        trimTint,
        false,
      );
      localBox(
        x + Math.sign(x) * 0.06,
        roofBase - 0.1,
        0,
        0.13,
        0.1,
        d * 2,
        "metal",
        0xb6b5ab,
        false,
      );
      const z = (random() > 0.5 ? 1 : -1) * (halfD - 0.25);
      localBox(
        x,
        house.base + house.wallHeight / 2 - 0.15,
        z,
        0.085,
        house.wallHeight - 0.2,
        0.085,
        "metal",
        0xb9b9ae,
        false,
      );
      localBox(
        x + Math.sign(x) * 0.2,
        house.base + 0.15,
        z,
        0.48,
        0.08,
        0.08,
        "metal",
        0xb9b9ae,
        false,
      );
    }
    if (!utility && !large && random() < 0.72) {
      const chimneyX = halfW * 0.43,
        chimneyZ = -halfD * 0.24;
      const top = roofBase + rise + 0.55;
      localBox(
        chimneyX,
        top - 1.05,
        chimneyZ,
        0.72,
        2.1,
        0.68,
        "brick",
        0xd9cec2,
      );
      localBox(
        chimneyX,
        top + 0.07,
        chimneyZ,
        0.89,
        0.18,
        0.86,
        "concrete",
        0xb9b6a9,
      );
      localBox(
        chimneyX,
        top + 0.19,
        chimneyZ,
        0.52,
        0.12,
        0.4,
        "metal",
        0x555853,
        false,
      );
    }

    const roadDX = house.roadPosition[0] - house.x,
      roadDZ = house.roadPosition[2] - house.z;
    const roadLX = roadDX * co - roadDZ * si,
      roadLZ = roadDX * si + roadDZ * co;
    const front: Face =
      Math.abs(roadLX) / halfW > Math.abs(roadLZ) / halfD
        ? roadLX >= 0
          ? 1
          : 3
        : roadLZ >= 0
          ? 0
          : 2;
    const faceWidth = (face: Face) =>
      face % 2 === 0 ? house.width : house.depth;
    const facePoint = (face: Face, u: number, y: number, out: number): V => {
      if (face === 0) return point(u, y, halfD + out);
      if (face === 1) return point(halfW + out, y, -u);
      if (face === 2) return point(-u, y, -halfD - out);
      return point(-halfW - out, y, u);
    };
    const faceBox = (
      face: Face,
      u: number,
      y: number,
      out: number,
      width: number,
      height: number,
      depth: number,
      key: NeighborhoodMaterialKey,
      tint: number,
      shadows = false,
    ) => {
      // Glass, sash bars and thin panel insets need only their visible face.
      // Keeping the substantial casings as boxes preserves window depth while
      // avoiding hundreds of thousands of hidden facade triangles.
      if (!shadows && depth <= 0.085) {
        getBatch(key, house.x, house.z, false).quad(
          facePoint(face, u - width / 2, y - height / 2, out + depth / 2),
          facePoint(face, u + width / 2, y - height / 2, out + depth / 2),
          facePoint(face, u + width / 2, y + height / 2, out + depth / 2),
          facePoint(face, u - width / 2, y + height / 2, out + depth / 2),
          width,
          height,
          tint,
          key === "siding",
        );
        return;
      }
      box(
        facePoint(face, u, y, out),
        [width, height, depth],
        house.heading + face * HALF_PI,
        key,
        tint,
        shadows,
      );
    };
    const frontage = faceWidth(front);
    const garage = utility || (!large && frontage > 9.5 && random() < 0.19);
    const garageU = utility ? 0 : -frontage * 0.25;
    const garageWidth = Math.min(
      utility ? frontage * 0.72 : 3.15,
      utility ? 5.3 : 3.4,
    );
    const doorU = garage && !utility ? frontage * 0.22 : 0;
    const hasShutters = !utility && !large && random() < 0.72;
    const window = (
      face: Face,
      u: number,
      y: number,
      ww = 1.08,
      wh = 1.35,
      shutters = false,
    ) => {
      detailFeatures++;
      faceBox(face, u, y, 0.026, ww + 0.25, wh + 0.24, 0.1, "wood", 0x373d38);
      faceBox(
        face,
        u,
        y,
        0.074,
        ww,
        wh,
        0.042,
        "glass",
        random() < 0.1 ? 0xa5aaa0 : 0x7b94a0,
      );
      const border = 0.095;
      for (const sign of [-1, 1]) {
        faceBox(
          face,
          u + sign * (ww / 2 + 0.04),
          y,
          0.105,
          border,
          wh + 0.26,
          0.12,
          "trim",
          trimTint,
        );
        faceBox(
          face,
          u,
          y + sign * (wh / 2 + 0.07),
          0.105,
          ww + 0.26,
          border,
          0.12,
          "trim",
          trimTint,
        );
      }
      faceBox(face, u, y, 0.117, 0.033, wh, 0.06, "trim", trimTint);
      faceBox(face, u, y, 0.119, ww, 0.033, 0.06, "trim", trimTint);
      faceBox(
        face,
        u,
        y - wh / 2 - 0.105,
        0.15,
        ww + 0.34,
        0.1,
        0.26,
        "trim",
        trimTint,
      );
      // Narrow curtain edges add variation without transparent sorting or a
      // costly interior behind every distant window.
      if (random() < 0.65)
        for (const side of [-1, 1])
          faceBox(
            face,
            u + side * (ww / 2 - 0.1),
            y,
            0.101,
            0.1,
            wh - 0.06,
            0.008,
            "trim",
            0xc7c3ae,
          );
      if (shutters && ww < 1.5)
        for (const side of [-1, 1]) {
          const sx = u + side * (ww / 2 + 0.29);
          faceBox(
            face,
            sx,
            y,
            0.07,
            0.28,
            wh + 0.18,
            0.09,
            "wood",
            shutterTint,
          );
          for (const yy of [-0.36, 0, 0.36])
            faceBox(
              face,
              sx,
              y + yy,
              0.122,
              0.24,
              0.025,
              0.022,
              "wood",
              tinted(shutterTint, 1.15),
            );
        }
    };
    const floors =
      !utility &&
      (house.wallHeight >= 4.5 || (house.wallHeight >= 4.05 && random() < 0.27))
        ? 2
        : 1;
    for (let fi = 0; fi < 4; fi++) {
      const face = fi as Face,
        span = faceWidth(face);
      const count = utility
        ? face === front
          ? 0
          : 1
        : Math.max(2, Math.min(large ? 8 : 5, Math.floor(span / 3.15)));
      for (let floor = 0; floor < floors; floor++)
        for (let n = 0; n < count; n++) {
          const u = ((n - (count - 1) / 2) * span) / (count + 0.45);
          if (
            face === front &&
            floor === 0 &&
            (Math.abs(u - doorU) < 1.35 ||
              (garage && Math.abs(u - garageU) < garageWidth / 2 + 0.6))
          )
            continue;
          window(
            face,
            u,
            house.base +
              (floors === 2
                ? 1.23 + floor * (house.wallHeight - 0.95 - 1.23)
                : 1.55),
            large ? 1.45 : 1.07,
            utility
              ? 0.83
              : floors === 2 && house.wallHeight < 4.5
                ? 1.05
                : 1.32,
            hasShutters && (face === front || face === (front + 2) % 4),
          );
        }
    }
    // Cape-style dormers vary the roof silhouette without enlarging the source
    // footprint, changing the accepted wall envelope, or inventing another wing.
    if (
      !hip &&
      !utility &&
      !large &&
      house.width > 7.5 &&
      house.depth > 8.5 &&
      random() < 0.32
    ) {
      const direction = roadLX >= 0 ? 1 : -1;
      const outerX = direction * w * 0.63,
        innerX = direction * w * 0.25;
      const dormerBase = roofBase + rise * 0.37,
        dormerTop = dormerBase + 1.06;
      const centers =
        house.depth > 12 ? [-house.depth * 0.23, house.depth * 0.23] : [0];
      for (const centerZ of centers) {
        const dw = 0.72,
          centerX = (outerX + innerX) / 2;
        localBox(
          centerX,
          dormerBase + 0.52,
          centerZ,
          Math.abs(outerX - innerX),
          1.05,
          dw * 2,
          wallMaterial,
          wallTint,
        );
        const gable = getBatch(wallMaterial, house.x, house.z);
        const ga = point(outerX, dormerTop, centerZ + direction * dw);
        const gb = point(outerX, dormerTop, centerZ - direction * dw);
        const gc = point(outerX, dormerTop + 0.46, centerZ);
        gable.triangle(ga, gb, gc, [0, 0], [dw * 2, 0], [dw, 0.46], wallTint);
        const frontX = outerX + direction * 0.065;
        localBox(
          frontX,
          dormerBase + 0.59,
          centerZ,
          0.08,
          0.92,
          0.9,
          "wood",
          0x37413c,
          false,
        );
        localBox(
          frontX + direction * 0.06,
          dormerBase + 0.59,
          centerZ,
          0.04,
          0.73,
          0.71,
          "glass",
          0x849aa4,
          false,
        );
        for (const s of [-1, 1]) {
          localBox(
            frontX + direction * 0.1,
            dormerBase + 0.59,
            centerZ + s * 0.45,
            0.13,
            1.01,
            0.09,
            "trim",
            trimTint,
            false,
          );
          localBox(
            frontX + direction * 0.1,
            dormerBase + 0.59 + s * 0.46,
            centerZ,
            0.13,
            0.09,
            1.0,
            "trim",
            trimTint,
            false,
          );
        }
        localBox(
          frontX + direction * 0.12,
          dormerBase + 0.59,
          centerZ,
          0.1,
          0.032,
          0.73,
          "trim",
          trimTint,
          false,
        );
        localBox(
          frontX + direction * 0.12,
          dormerBase + 0.59,
          centerZ,
          0.1,
          0.73,
          0.032,
          "trim",
          trimTint,
          false,
        );
        const out = getBatch("roof", house.x, house.z);
        const topQuad = (a: V, b: V, c: V, d: V) => {
          if (
            (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]) >=
            0
          )
            out.quad(
              a,
              b,
              c,
              d,
              Math.abs(outerX - innerX) + 0.3,
              0.87,
              roofTint,
            );
          else
            out.quad(
              d,
              c,
              b,
              a,
              Math.abs(outerX - innerX) + 0.3,
              0.87,
              roofTint,
            );
        };
        for (const sign of [-1, 1])
          topQuad(
            point(
              innerX - direction * 0.12,
              dormerTop,
              centerZ + sign * (dw + 0.12),
            ),
            point(
              outerX + direction * 0.18,
              dormerTop,
              centerZ + sign * (dw + 0.12),
            ),
            point(outerX + direction * 0.18, dormerTop + 0.46, centerZ),
            point(innerX - direction * 0.12, dormerTop + 0.46, centerZ),
          );
        for (const sign of [-1, 1])
          beam(
            point(
              outerX + direction * 0.18,
              dormerTop - 0.03,
              centerZ + sign * (dw + 0.12),
            ),
            point(outerX + direction * 0.18, dormerTop + 0.43, centerZ),
            0.11,
            "trim",
            trimTint,
          );
      }
    }
    if (!hip && !utility)
      for (const face of [0, 2] as Face[]) {
        if (rise > 1.65 && random() < 0.5)
          window(face, 0, roofBase + rise * 0.38, 0.65, 0.69, false);
        else {
          faceBox(
            face,
            0,
            roofBase + rise * 0.37,
            0.028,
            0.48,
            0.5,
            0.06,
            "wood",
            0x565f58,
          );
          for (let n = 0; n < 4; n++)
            faceBox(
              face,
              0,
              roofBase + rise * 0.37 - 0.17 + n * 0.11,
              0.07,
              0.54,
              0.055,
              0.07,
              "trim",
              trimTint,
            );
        }
      }
    if (!utility) {
      faceBox(
        front,
        doorU,
        house.base + 1.13,
        0.055,
        1.16,
        2.21,
        0.14,
        "wood",
        0x3b3c35,
      );
      faceBox(
        front,
        doorU,
        house.base + 1.1,
        0.138,
        0.98,
        2.08,
        0.06,
        "wood",
        doorTint,
      );
      for (const side of [-1, 1])
        faceBox(
          front,
          doorU + side * 0.59,
          house.base + 1.13,
          0.16,
          0.13,
          2.3,
          0.16,
          "trim",
          trimTint,
        );
      faceBox(
        front,
        doorU,
        house.base + 2.29,
        0.16,
        1.31,
        0.16,
        0.16,
        "trim",
        trimTint,
      );
      for (const side of [-1, 1])
        for (const y of [house.base + 0.48, house.base + 1.06])
          faceBox(
            front,
            doorU + side * 0.22,
            y,
            0.18,
            0.32,
            0.42,
            0.035,
            "wood",
            tinted(doorTint, 1.15),
          );
      faceBox(
        front,
        doorU,
        house.base + 1.72,
        0.182,
        0.49,
        0.55,
        0.022,
        "glass",
        0x8c9d9e,
      );
      faceBox(
        front,
        doorU + 0.36,
        house.base + 1.05,
        0.23,
        0.055,
        0.18,
        0.07,
        "metal",
        0xa79a74,
      );
      // Door lamp: an opaque reflective lantern avoids one point light per house.
      faceBox(
        front,
        doorU + 0.91,
        house.base + 1.97,
        0.15,
        0.17,
        0.31,
        0.21,
        "metal",
        0x434841,
      );
      faceBox(
        front,
        doorU + 0.91,
        house.base + 1.96,
        0.265,
        0.12,
        0.2,
        0.013,
        "glass",
        0xd8ca9b,
      );
    }
    if (garage) {
      faceBox(
        front,
        garageU,
        house.base + 1.15,
        0.07,
        garageWidth + 0.24,
        2.4,
        0.12,
        "wood",
        0x3f443e,
      );
      faceBox(
        front,
        garageU,
        house.base + 1.13,
        0.15,
        garageWidth,
        2.24,
        0.09,
        "trim",
        tinted(trimTint, 0.89),
      );
      for (let row = 1; row < 5; row++)
        faceBox(
          front,
          garageU,
          house.base + row * 0.44,
          0.204,
          garageWidth,
          0.025,
          0.013,
          "wood",
          0x979d91,
        );
      for (const side of [-1, 1])
        faceBox(
          front,
          garageU + side * (garageWidth / 2 + 0.08),
          house.base + 1.15,
          0.21,
          0.14,
          2.4,
          0.15,
          "trim",
          trimTint,
        );
      faceBox(
        front,
        garageU,
        house.base + 2.34,
        0.21,
        garageWidth + 0.3,
        0.16,
        0.15,
        "trim",
        trimTint,
      );
      const panes = Math.max(2, Math.floor(garageWidth / 0.8));
      for (let n = 0; n < panes; n++)
        faceBox(
          front,
          garageU + ((n - (panes - 1) / 2) * garageWidth) / (panes + 0.3),
          house.base + 1.92,
          0.218,
          0.48,
          0.28,
          0.014,
          "glass",
          0x748a8e,
        );
    }

    const clear = (p: V, radius = 0) =>
      options.roadClearance(p[0], p[2]) > radius + 1.1;
    const groundPoint = (x: number, z: number, lift = 0.035): V => {
      const p = point(x, 0, z);
      p[1] = options.heightAt(p[0], p[2]) + lift;
      return p;
    };
    const patch = (
      centerX: number,
      centerZ: number,
      width: number,
      depth: number,
      key: NeighborhoodMaterialKey,
      tint: number,
    ) => {
      // One ground color patch is a generic maintained yard, not a parcel claim.
      const corners = [
        [-1, -1],
        [-1, 1],
        [1, -1],
        [1, 1],
      ].map(([a, b]) =>
        point(centerX + (a * width) / 2, 0, centerZ + (b * depth) / 2),
      );
      if (corners.some((p) => !clear(p, 0.3))) return;
      const nx = Math.max(1, Math.ceil(width / 3)),
        nz = Math.max(1, Math.ceil(depth / 3));
      const out = getBatch(key, house.x, house.z, false);
      for (let zi = 0; zi < nz; zi++)
        for (let xi = 0; xi < nx; xi++) {
          const x = centerX - width / 2 + (xi / nx) * width,
            z = centerZ - depth / 2 + (zi / nz) * depth;
          out.quad(
            groundPoint(x, z),
            groundPoint(x, z + depth / nz),
            groundPoint(x + width / nx, z + depth / nz),
            groundPoint(x + width / nx, z),
            depth / nz,
            width / nx,
            xi % 2 === 0 ? tint : tinted(tint, 0.96),
          );
        }
    };
    if (!utility && !large)
      patch(
        0,
        0,
        house.width + 8 + random() * 6,
        house.depth + 8 + random() * 5,
        "grass",
        0xdce3c9,
      );

    // Short porch/yard paths stop on the property side of the road. We do not
    // infer an actual driveway connection from an address point alone.
    const path = (
      start: V,
      end: V,
      width: number,
      key: NeighborhoodMaterialKey,
      tint: number,
    ) => {
      const dx = end[0] - start[0],
        dz = end[2] - start[2],
        length = Math.hypot(dx, dz);
      if (length < 0.1) return;
      const nx = ((dz / length) * width) / 2,
        nz = ((-dx / length) * width) / 2;
      const count = Math.ceil(length / 1.5),
        out = getBatch(key, house.x, house.z, false);
      for (let n = 0; n < count; n++) {
        const t = n / count,
          u = (n + 1) / count;
        const cx = start[0] + (dx * (t + u)) / 2,
          cz = start[2] + (dz * (t + u)) / 2;
        if (options.roadClearance(cx, cz) < width / 2 + 1.8) break;
        const p = (v: number, side: number): V => {
          const x = start[0] + dx * v + nx * side,
            z = start[2] + dz * v + nz * side;
          return [x, options.heightAt(x, z) + 0.05, z];
        };
        out.quad(
          p(t, -1),
          p(u, -1),
          p(u, 1),
          p(t, 1),
          length / count,
          width,
          tint,
        );
      }
    };
    const doorOutside = facePoint(front, doorU, 0, 1.9);
    const porch =
      !utility && !large && random() < 0.61 && clear(doorOutside, 2.4);
    if (porch) {
      const deckWidth = Math.min(3.3, frontage * 0.45),
        deckDepth = 1.7,
        deckY = house.base + 0.18;
      const deckGround = options.heightAt(doorOutside[0], doorOutside[2]);
      const deckBottom = Math.min(deckGround - 0.1, deckY - 0.18);
      faceBox(
        front,
        doorU,
        (deckBottom + deckY) / 2,
        0.9,
        deckWidth,
        deckY - deckBottom,
        deckDepth,
        "concrete",
        0xb8b4a4,
        true,
      );
      faceBox(
        front,
        doorU,
        deckY + 0.035,
        0.9,
        deckWidth + 0.05,
        0.075,
        deckDepth + 0.03,
        "wood",
        0xb0a992,
        true,
      );
      const canopyY = house.base + 2.66;
      for (const side of [-1, 1]) {
        faceBox(
          front,
          doorU + side * (deckWidth / 2 - 0.15),
          (deckY + canopyY) / 2,
          1.5,
          0.13,
          canopyY - deckY,
          0.13,
          "trim",
          trimTint,
          true,
        );
        faceBox(
          front,
          doorU + side * (deckWidth / 2 - 0.15),
          deckY + 0.64,
          0.87,
          0.075,
          0.085,
          1.38,
          "trim",
          trimTint,
        );
        for (let n = 0; n < 4; n++)
          faceBox(
            front,
            doorU + side * (deckWidth / 2 - 0.15),
            deckY + 0.33,
            0.35 + n * 0.34,
            0.035,
            0.58,
            0.035,
            "trim",
            trimTint,
          );
      }
      faceBox(
        front,
        doorU,
        canopyY,
        0.86,
        deckWidth + 0.33,
        0.15,
        2.02,
        "trim",
        trimTint,
        true,
      );
      // Small pitched canopy, within the accepted decorative yard clearance.
      const canopy = getBatch("roof", house.x, house.z);
      canopy.quad(
        facePoint(front, doorU - deckWidth / 2 - 0.22, canopyY + 0.27, -0.15),
        facePoint(front, doorU - deckWidth / 2 - 0.22, canopyY + 0.05, 1.98),
        facePoint(front, doorU + deckWidth / 2 + 0.22, canopyY + 0.05, 1.98),
        facePoint(front, doorU + deckWidth / 2 + 0.22, canopyY + 0.27, -0.15),
        2.14,
        deckWidth + 0.44,
        roofTint,
      );
      const steps = Math.round(clamp((deckY - deckGround) / 0.18, 1, 6));
      for (let n = 0; n < steps; n++) {
        const top = deckY - (n + 1) * 0.16;
        const location = facePoint(front, doorU, 0, 1.93 + n * 0.29);
        if (!clear(location, 1)) break;
        const ground = options.heightAt(location[0], location[2]);
        if (top > ground)
          faceBox(
            front,
            doorU,
            (top + ground) / 2,
            1.93 + n * 0.29,
            1.45,
            top - ground,
            0.34,
            "concrete",
            0xc1bdae,
            true,
          );
      }
      path(
        facePoint(front, doorU, 0, 2 + steps * 0.29),
        facePoint(front, doorU, 0, 5 + steps * 0.29),
        1.05,
        "concrete",
        0xd1cec0,
      );
    } else if (!utility && !large) {
      const pad = facePoint(front, doorU, 0, 0.65);
      if (clear(pad, 1)) {
        faceBox(
          front,
          doorU,
          house.base + 0.08,
          0.58,
          1.44,
          0.15,
          0.96,
          "concrete",
          0xc2beb0,
          true,
        );
        path(
          facePoint(front, doorU, 0, 1.05),
          facePoint(front, doorU, 0, 4.8),
          0.95,
          "concrete",
          0xd1cec0,
        );
      }
    }
    if (garage)
      path(
        facePoint(front, garageU, 0, 0.3),
        facePoint(front, garageU, 0, 4.5),
        garageWidth + 0.35,
        "gravel",
        0xd1cdc0,
      );

    if (!large) {
      const plantCount = utility ? 2 : 4 + Math.floor(random() * 4);
      for (let n = 0; n < plantCount; n++) {
        const face = (n % 4) as Face;
        const u = (random() - 0.5) * Math.max(1, faceWidth(face) - 2);
        if (
          face === front &&
          (Math.abs(u - doorU) < 1.35 ||
            (garage && Math.abs(u - garageU) < garageWidth / 2 + 0.5))
        )
          continue;
        const p = facePoint(face, u, 0, 0.8 + random() * 0.7),
          radius = 0.55 + random() * 0.45;
        if (!clear(p, radius + 0.3)) continue;
        const ground = options.heightAt(p[0], p[2]);
        p[1] = ground + radius * 0.65;
        shrub(
          p,
          radius,
          0.82,
          [0x526c43, 0x61754a, 0x485e3d, 0x687b4d][Math.floor(random() * 4)],
          random() * 10,
        );
        detailFeatures++;
      }
      if (!utility && random() < 0.25) {
        const rear = ((front + 2) % 4) as Face,
          span = Math.min(faceWidth(rear) + 6, 17);
        let previous: V | undefined;
        for (let n = 0; n < 6; n++) {
          const p = facePoint(rear, -span / 2 + (n * span) / 5, 0, 4.2);
          if (!clear(p, 0.8)) {
            previous = undefined;
            continue;
          }
          p[1] = options.heightAt(p[0], p[2]);
          box(
            [p[0], p[1] + 0.55, p[2]],
            [0.13, 1.1, 0.13],
            house.heading,
            "wood",
            0x938a71,
          );
          if (previous)
            for (const y of [0.43, 0.87])
              beam(
                [previous[0], previous[1] + y, previous[2]],
                [p[0], p[1] + y, p[2]],
                0.09,
                "wood",
                0x9f967d,
              );
          previous = p;
        }
      }
    }
    // A single restrained mailbox and utility hardware add human scale without
    // extra physics obstacles or new driveway claims.
    if (!utility && !large && Math.hypot(roadDX, roadDZ) < 110) {
      const len = Math.hypot(roadDX, roadDZ) || 1,
        awayX = -roadDX / len,
        awayZ = -roadDZ / len;
      const mx = house.roadPosition[0] + awayX * (house.roadWidth / 2 + 2.25),
        mz = house.roadPosition[2] + awayZ * (house.roadWidth / 2 + 2.25);
      if (options.roadClearance(mx, mz) > 1.4) {
        const my = options.heightAt(mx, mz),
          angle = Math.atan2(-awayX, -awayZ);
        box([mx, my + 0.56, mz], [0.1, 1.12, 0.1], angle, "wood", 0x827964);
        box(
          [mx, my + 1.12, mz],
          [0.28, 0.25, 0.48],
          angle,
          "metal",
          random() < 0.35 ? 0x818681 : 0x414b49,
        );
        box(
          [mx + Math.cos(angle) * 0.18, my + 1.24, mz - Math.sin(angle) * 0.18],
          [0.025, 0.2, 0.09],
          angle,
          "metal",
          0xa3493c,
          false,
        );
      }
    }
    if (!utility) {
      const side = ((front + 1) % 4) as Face,
        u = -faceWidth(side) * 0.25;
      faceBox(
        side,
        u,
        house.base + 1.12,
        0.045,
        0.3,
        0.46,
        0.14,
        "metal",
        0x8f9790,
      );
      faceBox(
        side,
        u,
        house.base + 0.51,
        0.055,
        0.04,
        0.8,
        0.05,
        "metal",
        0x92988e,
      );
      const ac = facePoint(side, u + 0.8, 0, 0.56);
      if (clear(ac, 0.55)) {
        const ground = options.heightAt(ac[0], ac[2]);
        faceBox(
          side,
          u + 0.8,
          ground + 0.4,
          0.56,
          0.66,
          0.76,
          0.6,
          "metal",
          0x9ba399,
          true,
        );
        for (let n = 0; n < 5; n++)
          faceBox(
            side,
            u + 0.8,
            ground + 0.16 + n * 0.105,
            0.876,
            0.54,
            0.025,
            0.012,
            "wood",
            0x5c685e,
          );
      }
    }
  }

  let triangleCount = 0;
  for (const [id, batch] of batches) {
    if (!batch.positions.length) continue;
    let material = materials.get(batch.material);
    if (!material) {
      const supplied = options.materials?.[batch.material];
      material = supplied?.clone() ?? defaultMaterial(batch.material);
      // Three's Material.copy does not copy shader hooks. Preserve shared
      // ground-scale color variation on the local vertex-colored yard clone.
      if (supplied) {
        material.onBeforeCompile = supplied.onBeforeCompile;
        material.customProgramCacheKey = supplied.customProgramCacheKey;
      }
      if (
        material instanceof T.MeshStandardMaterial ||
        material instanceof T.MeshBasicMaterial
      )
        material.vertexColors = true;
      materials.set(batch.material, material);
    }
    const mesh = new T.Mesh(batch.geometry(), material);
    mesh.name = `Neighborhood ${id}`;
    mesh.castShadow = batch.shadows;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;
    group.add(mesh);
    triangleCount += batch.positions.length / 9;
  }
  shrubTemplate.dispose();
  group.userData.neighborhoodStats = {
    houses: builtHouses,
    batches: group.children.length,
    triangles: triangleCount,
    detailFeatures,
  };
  group.userData.provenance =
    "Real OSM footprint/address positions; facade, roof, garden and utility appearance are plausible generic approximations. Existing envelope colliders are owned by Environment.";
  return group;
}
