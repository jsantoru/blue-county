import * as T from "three";
import type { Point } from "./types";

/**
 * Observed facade overrides; this module never assigns observations to an address.
 * Faces are local 0=+Z, 1=+X, 2=-Z, 3=-X before `heading` rotates the house.
 * The roof ridge is local Z; gable ends are faces 0/2, eaves are faces 1/3.
 * Heights are meters. `stories` counts full living stories (a cape's roof half-story
 * is represented by `dormers`), and a raised-ranch's exposed lower level is separate.
 * Undefined features retain generic/style defaults; explicit false/zero disables.
 */
export interface NeighborhoodReference {
  wallColor?: number;
  trimColor?: number;
  shutterColor?: number;
  doorColor?: number;
  roofColor?: number;
  roofType?: "gable" | "hip";
  roofRise?: number;
  stories?: number;
  style?: "ranch" | "raised-ranch" | "colonial" | "cape";
  frontFace?: 0 | 1 | 2 | 3;
  garageFace?: 0 | 1 | 2 | 3;
  garageDoors?: number;
  porch?: boolean;
  /** Secondary wings share one entrance with the main house. */
  entrance?: boolean;
  dormers?: boolean;
  chimney?: boolean;
  /** Small entry portico, or a taller projection across the entry/right facade. */
  frontGable?: "small" | "large";
  /** Irregular gray stone on the lower front facade and the central entry bay. */
  stoneLower?: boolean;
  /** Viewer-facing left/right on frontFace, independent of house heading. */
  bayWindow?: "left" | "right";
  /** Omit generated lawn patches, paths, shrubs, fences, mailboxes and yard utilities. */
  suppressGenericYard?: boolean;
}

/** Root-approved oriented envelope. Placement and road-clearance colliders remain in roads.ts. */
export interface NeighborhoodHouse {
  id: string | number;
  appearanceId?: string | number;
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
  reference?: NeighborhoodReference;
}

export type NeighborhoodMaterialKey =
  | "siding"
  | "referenceSiding"
  | "brick"
  | "roof"
  | "referenceRoof"
  | "concrete"
  | "referenceConcrete"
  | "wood"
  | "grass"
  | "gravel"
  | "bark"
  | "trim"
  | "glass"
  | "referenceGlass"
  | "interior"
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
type Opening = { left: number; right: number; bottom: number; top: number };
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

/** Subtract a rectangular opening from a convex facade piece, keeping actual holes in the shell. */
function withoutOpening(polygon: UV[], opening: Opening): UV[][] {
  if (
    Math.max(...polygon.map((p) => p[0])) <= opening.left ||
    Math.min(...polygon.map((p) => p[0])) >= opening.right ||
    Math.max(...polygon.map((p) => p[1])) <= opening.bottom ||
    Math.min(...polygon.map((p) => p[1])) >= opening.top
  )
    return [polygon];
  const clip = (points: UV[], distance: (p: UV) => number) => {
    const result: UV[] = [];
    if (points.length < 3) return result;
    let previous = points[points.length - 1],
      pd = distance(previous);
    for (const point of points) {
      const d = distance(point);
      if (d >= 0 !== pd >= 0) {
        const t = pd / (pd - d);
        result.push([
          previous[0] + (point[0] - previous[0]) * t,
          previous[1] + (point[1] - previous[1]) * t,
        ]);
      }
      if (d >= 0) result.push(point);
      previous = point;
      pd = d;
    }
    return result;
  };
  const edges = [
    (p: UV) => p[0] - opening.left,
    (p: UV) => opening.right - p[0],
    (p: UV) => p[1] - opening.bottom,
    (p: UV) => opening.top - p[1],
  ];
  const result: UV[][] = [];
  let remainder = polygon;
  for (const edge of edges) {
    if (remainder.length < 3) break;
    const outside = clip(remainder, (p) => -edge(p));
    if (outside.length >= 3) result.push(outside);
    remainder = clip(remainder, edge);
  }
  return result;
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
    const neutral =
      this.material === "referenceConcrete"
        ? rgb.r * 0.2126 + rgb.g * 0.7152 + rgb.b * 0.0722
        : undefined;
    for (const [p, uv] of [
      [a, ua],
      [b, ub],
      [c, uc],
    ] as [V, UV][]) {
      this.positions.push(...p);
      this.normals.push(nx, ny, nz);
      this.uvs.push(...uv);
      this.colors.push(neutral ?? rgb.r, neutral ?? rgb.g, neutral ?? rgb.b);
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
  if (key === "referenceGlass")
    return new T.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.13,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.07,
      ior: 1.52,
      envMapIntensity: 0.75,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      vertexColors: true,
    });
  if (key === "interior")
    return new T.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.94,
      envMapIntensity: 0.06,
      vertexColors: true,
    });
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
  const referenceFacades: Record<string, unknown>[] = [];

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
    const random = seeded(house.appearanceId ?? house.id);
    const reference = house.reference;
    const concreteKey: NeighborhoodMaterialKey = reference
      ? "referenceConcrete"
      : "concrete";
    const roofMaterial: NeighborhoodMaterialKey = reference
      ? "referenceRoof"
      : "roof";
    const raisedRanch = reference?.style === "raised-ranch";
    const openings = new Map<Face, Opening[]>();
    const deferredStone: (() => void)[] = [];
    let recessedWindows = 0;
    const genericYard = !reference?.suppressGenericYard;
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
    const genericWallMaterial: NeighborhoodMaterialKey =
      large || random() < 0.18 ? "brick" : "siding";
    // An explicit siding paint color must not inherit a random brick facade.
    const wallMaterial: NeighborhoodMaterialKey =
      reference?.wallColor !== undefined || reference?.style
        ? "referenceSiding"
        : genericWallMaterial;
    const wallTint =
      reference?.wallColor ??
      (wallMaterial === "brick"
        ? tinted(0xf0e9dd, 0.91 + random() * 0.09)
        : HOUSE_COLORS[Math.floor(random() * HOUSE_COLORS.length)]);
    const trimTint =
      reference?.trimColor ??
      [0xe3e1d5, 0xd8d5c8, 0xe5e5dc][Math.floor(random() * 3)];
    const shutterTint =
      reference?.shutterColor ??
      SHUTTER_COLORS[Math.floor(random() * SHUTTER_COLORS.length)];
    const roofTint =
      reference?.roofColor ??
      [0xbcbeb9, 0xc6bfaf, 0xa8b0b1, 0xbdb6ab][Math.floor(random() * 4)];
    const doorTint =
      reference?.doorColor ??
      DOOR_COLORS[Math.floor(random() * DOOR_COLORS.length)];
    // The source-approved footprint and wall top do not move. Concrete foundations
    // absorb terrain grade under a level floor rather than leaving floating walls.
    const foundationTop = raisedRanch
      ? house.base + clamp(house.wallHeight - 2.65, 0.75, 1.85)
      : house.base + 0.3;
    const entryBase = raisedRanch
      ? house.base + Math.min(0.65, (foundationTop - house.base) * 0.4)
      : house.base;
    if (!reference)
      localBox(
        0,
        (house.low + foundationTop) / 2,
        0,
        house.width + 0.05,
        foundationTop - house.low,
        house.depth + 0.05,
        concreteKey,
        0xb8b6a9,
      );
    if (!reference)
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
    const genericRise = Math.min(
      large ? 1.8 : utility ? 1.9 : 3.1,
      Math.max(1.05, house.width * (utility ? 0.17 : 0.245)),
    );
    const rise =
      reference?.roofRise !== undefined && Number.isFinite(reference.roofRise)
        ? Math.max(0.05, reference.roofRise)
        : reference?.style === "ranch" || raisedRanch
          ? Math.min(2.1, Math.max(0.85, house.width * 0.14))
          : reference?.style === "cape"
            ? Math.min(4, Math.max(1.9, house.width * 0.32))
            : genericRise;
    const hip =
      reference?.roofType !== undefined
        ? reference.roofType === "hip"
        : reference?.style
          ? false
          : !utility && (large || random() < 0.29);
    const ridgeEnd = hip ? Math.max(0.2, d - w * 0.8) : d;
    const slope = Math.hypot(w, rise);
    const roofBatch = getBatch(roofMaterial, house.x, house.z);
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
    if (reference) {
      // Shingle laps follow physical slope distance, not per-house UV stretching.
      // Their narrow relief is deliberately independent of any photographed roof dimensions.
      const laps = getBatch(roofMaterial, house.x, house.z, false);
      for (let along = 0.27; along < slope - 0.16; along += 0.27) {
        const t = along / slope,
          t2 = Math.min(1, (along + 0.018) / slope);
        const end = d + (ridgeEnd - d) * t,
          end2 = d + (ridgeEnd - d) * t2;
        for (const side of [-1, 1]) {
          const a = rp(side * w * (1 - t), rise * t + 0.009, -end),
            b = rp(side * w * (1 - t), rise * t + 0.009, end);
          const c = rp(side * w * (1 - t2), rise * t2 + 0.011, end2),
            e = rp(side * w * (1 - t2), rise * t2 + 0.011, -end2);
          if (side < 0)
            laps.quad(a, b, c, e, end * 2, 0.018, tinted(roofTint, 0.81));
          else laps.quad(e, c, b, a, end * 2, 0.018, tinted(roofTint, 0.81));
        }
      }
    }
    roofBatch.triangle(
      rp(0, rise, -ridgeEnd),
      rp(0, rise, ridgeEnd),
      rp(w, 0, d),
      [0, slope],
      [d * 2, slope],
      [d * 2, 0],
      roofTint,
    );
    roofBatch.triangle(
      rp(0, rise, -ridgeEnd),
      rp(w, 0, d),
      rp(w, 0, -d),
      [0, slope],
      [d * 2, 0],
      [0, 0],
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
            roofMaterial,
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
      if (reference) {
        const seams = getBatch(wallMaterial, house.x, house.z, false);
        for (let y = 0.18; y < rise - 0.16; y += 0.18) {
          const x0 = halfW * (1 - y / (rise - 0.09)),
            x1 = halfW * (1 - (y + 0.008) / (rise - 0.09));
          for (const sign of [-1, 1]) {
            const z = sign * (halfD + 0.006);
            if (sign > 0)
              seams.quad(
                rp(-x0, y, z),
                rp(x0, y, z),
                rp(x1, y + 0.008, z),
                rp(-x1, y + 0.008, z),
                x0 * 2,
                0.008,
                tinted(wallTint, 0.92),
              );
            else
              seams.quad(
                rp(x0, y, z),
                rp(-x0, y, z),
                rp(-x1, y + 0.008, z),
                rp(x1, y + 0.008, z),
                x0 * 2,
                0.008,
                tinted(wallTint, 0.92),
              );
          }
        }
      }
    }
    beam(
      rp(0, rise + 0.04, -ridgeEnd),
      rp(0, rise + 0.04, ridgeEnd),
      0.14,
      roofMaterial,
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
      // Small open gutter channel: lower trough, outer lip and a shaded interior.
      localBox(
        x + Math.sign(x) * 0.065,
        roofBase - 0.145,
        0,
        0.15,
        0.035,
        d * 2,
        "metal",
        trimTint,
        false,
      );
      localBox(
        x + Math.sign(x) * 0.13,
        roofBase - 0.09,
        0,
        0.032,
        0.095,
        d * 2,
        "metal",
        trimTint,
        false,
      );
      localBox(
        x + Math.sign(x) * 0.07,
        roofBase - 0.122,
        0,
        0.095,
        0.008,
        d * 2 - 0.04,
        "metal",
        0x53564e,
        false,
      );
      const z = (random() > 0.5 ? 1 : -1) * (halfD - 0.25);
      if (reference) {
        const pipeX = Math.sign(x) * (halfW + 0.075),
          foot = point(pipeX, 0, z);
        const footY = options.heightAt(foot[0], foot[2]) + 0.14;
        beam(
          point(x, roofBase - 0.18, z),
          point(pipeX, roofBase - 0.52, z),
          0.069,
          "metal",
          trimTint,
        );
        beam(
          point(pipeX, roofBase - 0.52, z),
          point(pipeX, footY + 0.19, z),
          0.069,
          "metal",
          trimTint,
        );
        beam(
          point(pipeX, footY + 0.19, z),
          point(pipeX + Math.sign(x) * 0.24, footY, z),
          0.071,
          "metal",
          trimTint,
        );
        for (let yy = footY + 0.55; yy < roofBase - 0.6; yy += 1.6)
          localBox(
            pipeX,
            yy,
            z,
            0.085,
            0.035,
            0.092,
            "metal",
            tinted(trimTint, 0.81),
            false,
          );
        continue;
      }
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
    const hasChimney =
      reference?.chimney ?? (!utility && !large && random() < 0.72);
    if (hasChimney) {
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
        concreteKey,
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
      reference?.frontFace ??
      (Math.abs(roadLX) / halfW > Math.abs(roadLZ) / halfD
        ? roadLX >= 0
          ? 1
          : 3
        : roadLZ >= 0
          ? 0
          : 2);
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
    const faceSurface = (
      face: Face,
      polygon: UV[],
      offset: (y: number) => number,
      key: NeighborhoodMaterialKey,
      tint: number,
      shadows = true,
    ) => {
      let pieces = [polygon];
      for (const opening of openings.get(face) ?? [])
        pieces = pieces.flatMap((piece) => withoutOpening(piece, opening));
      const out = getBatch(key, house.x, house.z, shadows);
      for (const piece of pieces)
        for (let i = 1; i < piece.length - 1; i++) {
          const a = piece[0],
            b = piece[i],
            c = piece[i + 1];
          const uv = (p: UV): UV => (key === "siding" ? [p[1], p[0]] : p);
          out.triangle(
            facePoint(face, a[0], a[1], offset(a[1])),
            facePoint(face, b[0], b[1], offset(b[1])),
            facePoint(face, c[0], c[1], offset(c[1])),
            uv(a),
            uv(b),
            uv(c),
            tint,
          );
        }
    };
    const frontage = faceWidth(front);
    const genericGarage =
      utility || (!large && frontage > 9.5 && random() < 0.19);
    const garageFace = reference?.garageFace ?? front;
    const garageDoors =
      reference?.garageDoors !== undefined &&
      Number.isFinite(reference.garageDoors)
        ? clamp(Math.floor(reference.garageDoors), 0, 3)
        : reference?.garageFace !== undefined
          ? 1
          : Number(genericGarage);
    const garage = garageDoors > 0;
    const genericGarageWidth = Math.min(
      utility ? frontage * 0.72 : 3.15,
      utility ? 5.3 : 3.4,
    );
    const referenceGarage =
      !!reference &&
      (reference.garageFace !== undefined ||
        reference.garageDoors !== undefined);
    const garageSpan = faceWidth(garageFace),
      garageGap = 0.24;
    const garageDoorWidth = referenceGarage
      ? Math.min(
          2.85,
          Math.max(
            1.2,
            ((garageFace === front && !utility
              ? garageSpan * 0.57
              : garageSpan - 0.85) -
              garageGap * Math.max(0, garageDoors - 1)) /
              Math.max(1, garageDoors),
          ),
        )
      : genericGarageWidth;
    const garageWidth =
      garageDoorWidth * garageDoors + garageGap * Math.max(0, garageDoors - 1);
    const genericGarageU =
      utility || garageFace !== front ? 0 : -frontage * 0.25;
    const garageU = referenceGarage
      ? clamp(
          genericGarageU,
          -garageSpan / 2 + garageWidth / 2 + 0.3,
          garageSpan / 2 - garageWidth / 2 - 0.3,
        )
      : genericGarageU;
    const garageCenters = Array.from(
      { length: garageDoors },
      (_, n) =>
        garageU + (n - (garageDoors - 1) / 2) * (garageDoorWidth + garageGap),
    );
    const garageGround = facePoint(garageFace, garageU, 0, 0.35);
    const garageBase = referenceGarage
      ? Math.max(
          house.low + 0.04,
          Math.min(
            house.base,
            options.heightAt(garageGround[0], garageGround[2]),
          ),
        )
      : house.base;
    const doorU =
      garage && !utility && garageFace === front ? frontage * 0.22 : 0;
    const entrance = !utility && reference?.entrance !== false;
    const baySide = !utility ? reference?.bayWindow : undefined;
    const bayWidth = Math.min(2.95, frontage * 0.24);
    const bayU = (baySide === "left" ? -1 : 1) * frontage * 0.265;
    const stoneLower = !!reference?.stoneLower;
    if (stoneLower) {
      // Geometry carries a restrained irregular masonry pattern, without photo
      // textures or claims about measured stone sizes. The relief stays behind
      // the existing door/window casings, so openings remain unobstructed.
      const stoneRandom = seeded(`${house.id}:observed-stone`);
      const stone = getBatch(concreteKey, house.x, house.z, false);
      const stonePanel = (
        centerU: number,
        width: number,
        bottom: number,
        top: number,
      ) => {
        if (top <= bottom) return;
        faceSurface(
          front,
          [
            [centerU - width / 2, bottom],
            [centerU + width / 2, bottom],
            [centerU + width / 2, top],
            [centerU - width / 2, top],
          ],
          () => 0.052,
          concreteKey,
          0x74766e,
          false,
        );
        for (let y = bottom + 0.016; y < top - 0.025;) {
          const height = Math.min(0.23 + stoneRandom() * 0.16, top - y - 0.012);
          for (
            let u = centerU - width / 2 + 0.015;
            u < centerU + width / 2 - 0.025;
          ) {
            const span = Math.min(
              0.31 + stoneRandom() * 0.43,
              centerU + width / 2 - u - 0.012,
            );
            const bevel = Math.min(0.052, span * 0.16, height * 0.2);
            const outline: UV[] = [
              [u + bevel, y],
              [u + span - bevel, y + stoneRandom() * 0.015],
              [u + span, y + height * 0.43],
              [u + span - bevel, y + height],
              [u + bevel, y + height - stoneRandom() * 0.018],
              [u, y + height * 0.53],
            ];
            const out = 0.058 + stoneRandom() * 0.01;
            const tint = [
              0x9a9c94, 0x858b86, 0xa7a99f, 0x92978e, 0x7b827c, 0xaba99f,
            ][Math.floor(stoneRandom() * 6)];
            faceSurface(front, outline, () => out, concreteKey, tint, false);
            u += span + 0.018;
          }
          y += height + 0.018;
        }
      };
      deferredStone.push(() =>
        stonePanel(0, frontage, house.low, foundationTop),
      );
      deferredStone.push(() =>
        stonePanel(
          doorU,
          Math.min(2.65, frontage * 0.26),
          foundationTop,
          roofBase - 0.18,
        ),
      );
      detailFeatures++;
    }
    const hasShutters =
      reference?.shutterColor !== undefined ||
      (!utility && !large && random() < 0.72);
    const window = (
      face: Face,
      u: number,
      y: number,
      ww = 1.08,
      wh = 1.35,
      shutters = false,
    ) => {
      detailFeatures++;
      if (reference && y + wh / 2 < roofBase - 0.025) {
        // Preserve the old random sequence: detailing must not change later facade choices.
        random();
        const curtains = random() < 0.65;
        const detailRandom = seeded(
          `${house.id}:recess:${face}:${u.toFixed(3)}:${y.toFixed(3)}`,
        );
        const opening = {
          left: u - ww / 2,
          right: u + ww / 2,
          bottom: y - wh / 2,
          top: y + wh / 2,
        };
        if (!openings.has(face)) openings.set(face, []);
        openings.get(face)!.push(opening);
        recessedWindows++;
        const interior = getBatch("interior", house.x, house.z, false);
        const corners: UV[] = [
          [opening.left, opening.bottom],
          [opening.right, opening.bottom],
          [opening.right, opening.top],
          [opening.left, opening.top],
        ];
        for (let edge = 0; edge < 4; edge++) {
          const a = corners[edge],
            b = corners[(edge + 1) % 4];
          interior.quad(
            facePoint(face, a[0], a[1], 0.025),
            facePoint(face, b[0], b[1], 0.025),
            facePoint(face, b[0], b[1], -0.3),
            facePoint(face, a[0], a[1], -0.3),
            Math.hypot(b[0] - a[0], b[1] - a[1]),
            0.325,
            edge === 2 ? 0x292d2c : 0x4b514e,
          );
        }
        faceBox(
          face,
          u,
          y,
          -0.307,
          ww,
          wh,
          0.008,
          "interior",
          [0x151b19, 0x202321, 0x272923][Math.floor(detailRandom() * 3)],
        );
        if (curtains) {
          const fabricWidth = ww * (0.17 + detailRandom() * 0.12);
          for (const side of [-1, 1]) {
            const begin =
              side < 0
                ? opening.left + 0.025
                : opening.right - fabricWidth - 0.025;
            const folds = Math.max(3, Math.ceil(fabricWidth / 0.045));
            for (let fold = 0; fold < folds; fold++) {
              const x0 = begin + (fabricWidth * fold) / folds,
                x1 = begin + (fabricWidth * (fold + 1)) / folds;
              const z0 = -0.235 + (fold % 2) * 0.019,
                z1 = -0.235 + ((fold + 1) % 2) * 0.019;
              interior.quad(
                facePoint(face, x0, opening.bottom + 0.025, z0),
                facePoint(face, x1, opening.bottom + 0.025, z1),
                facePoint(face, x1, opening.top - 0.015, z1),
                facePoint(face, x0, opening.top - 0.015, z0),
                x1 - x0,
                wh - 0.04,
                fold % 2 ? 0x909184 : 0x777b70,
              );
            }
          }
        }
        faceBox(
          face,
          u,
          y,
          -0.05,
          ww - 0.014,
          wh - 0.014,
          0.006,
          "referenceGlass",
          0xb7c1bb,
        );
        for (const sign of [-1, 1]) {
          faceBox(
            face,
            u + sign * (ww / 2 + 0.048),
            y,
            0.055,
            0.095,
            wh + 0.22,
            0.16,
            "trim",
            trimTint,
            true,
          );
          faceBox(
            face,
            u,
            y + sign * (wh / 2 + 0.065),
            0.055,
            ww + 0.22,
            0.105,
            0.16,
            "trim",
            trimTint,
            true,
          );
          faceBox(
            face,
            u + sign * (ww / 2 - 0.028),
            y,
            -0.018,
            0.047,
            wh,
            0.025,
            "trim",
            tinted(trimTint, 0.93),
          );
          faceBox(
            face,
            u,
            y + sign * (wh / 2 - 0.024),
            -0.018,
            ww,
            0.046,
            0.025,
            "trim",
            tinted(trimTint, 0.93),
          );
        }
        faceBox(face, u, y, -0.011, ww, 0.045, 0.025, "trim", trimTint);
        faceBox(face, u, y, -0.025, 0.024, wh, 0.02, "trim", trimTint);
        faceBox(
          face,
          u,
          y - wh / 2 - 0.11,
          0.075,
          ww + 0.32,
          0.09,
          0.29,
          "trim",
          trimTint,
          true,
        );
        // Restrained drip cap and sill underside give real highlights/shadows at close range.
        faceBox(
          face,
          u,
          y + wh / 2 + 0.145,
          0.085,
          ww + 0.3,
          0.025,
          0.23,
          "metal",
          tinted(trimTint, 0.91),
        );
        if (shutters && ww < 1.5)
          for (const side of [-1, 1]) {
            const sx = u + side * (ww / 2 + 0.29);
            faceBox(
              face,
              sx,
              y,
              0.055,
              0.28,
              wh + 0.18,
              0.09,
              "trim",
              shutterTint,
            );
            for (let yy = y - wh / 2 + 0.05; yy < y + wh / 2; yy += 0.105)
              getBatch("trim", house.x, house.z, false).quad(
                facePoint(face, sx - 0.105, yy, 0.107),
                facePoint(face, sx + 0.105, yy, 0.107),
                facePoint(face, sx + 0.105, yy + 0.052, 0.117),
                facePoint(face, sx - 0.105, yy + 0.052, 0.117),
                0.21,
                0.053,
                tinted(shutterTint, 1.06),
              );
          }
        return;
      }
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
    const genericFloors =
      !utility &&
      (house.wallHeight >= 4.5 || (house.wallHeight >= 4.05 && random() < 0.27))
        ? 2
        : 1;
    const floors =
      reference?.stories !== undefined && Number.isFinite(reference.stories)
        ? clamp(Math.floor(reference.stories), 1, 3)
        : reference?.style === "colonial"
          ? 2
          : reference?.style
            ? 1
            : genericFloors;
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
          const windowHeight = reference
            ? Math.min(
                1.32,
                Math.max(0.75, (roofBase - foundationTop) / floors - 0.8),
              )
            : utility
              ? 0.83
              : floors === 2 && house.wallHeight < 4.5
                ? 1.05
                : 1.32;
          const windowY = reference
            ? foundationTop +
              ((roofBase - foundationTop) * (floor + 0.54)) / floors
            : house.base +
              (floors === 2
                ? 1.23 + floor * (house.wallHeight - 0.95 - 1.23)
                : 1.55);
          if (
            (entrance &&
              face === front &&
              floor === 0 &&
              Math.abs(u - doorU) < 1.35 &&
              (!reference || windowY - windowHeight / 2 < entryBase + 2.35)) ||
            (garage &&
              face === garageFace &&
              windowY - windowHeight / 2 < garageBase + 2.48 &&
              Math.abs(u - garageU) < garageWidth / 2 + 0.6) ||
            (baySide &&
              face === front &&
              floor === floors - 1 &&
              Math.abs(u - bayU) < bayWidth / 2 + 0.55)
          )
            continue;
          window(
            face,
            u,
            windowY,
            large ? 1.45 : 1.07,
            windowHeight,
            hasShutters && (face === front || face === (front + 2) % 4),
          );
        }
    }
    if (baySide) {
      const bayHeight = Math.min(
        1.55,
        Math.max(0.95, (roofBase - foundationTop) / floors - 0.7),
      );
      const bayY =
        foundationTop + ((roofBase - foundationTop) * (floors - 0.46)) / floors;
      const bottom = bayY - bayHeight / 2,
        top = bayY + bayHeight / 2;
      const outline: UV[] = [
        [bayU - bayWidth / 2, 0.055],
        [bayU - bayWidth * 0.3, 0.72],
        [bayU + bayWidth * 0.3, 0.72],
        [bayU + bayWidth / 2, 0.055],
      ];
      if (reference) {
        if (!openings.has(front)) openings.set(front, []);
        openings.get(front)!.push({
          left: bayU - bayWidth / 2,
          right: bayU + bayWidth / 2,
          bottom,
          top,
        });
        faceBox(
          front,
          bayU,
          bayY,
          -0.32,
          bayWidth,
          bayHeight,
          0.008,
          "interior",
          0x202724,
        );
        for (const side of [-1, 1])
          faceBox(
            front,
            bayU + side * bayWidth * 0.35,
            bayY,
            0.35,
            0.27,
            bayHeight - 0.07,
            0.012,
            "interior",
            0x777c70,
          );
      }
      const glass = getBatch(
          reference ? "referenceGlass" : "glass",
          house.x,
          house.z,
          false,
        ),
        apron = getBatch(wallMaterial, house.x, house.z);
      const cap = getBatch(roofMaterial, house.x, house.z);
      for (let i = 0; i < outline.length - 1; i++) {
        const a = outline[i],
          b = outline[i + 1],
          span = Math.hypot(b[0] - a[0], b[1] - a[1]);
        glass.quad(
          facePoint(front, a[0], bottom, a[1]),
          facePoint(front, b[0], bottom, b[1]),
          facePoint(front, b[0], top, b[1]),
          facePoint(front, a[0], top, a[1]),
          span,
          bayHeight,
          reference ? 0xb7c1bb : 0x7b94a0,
        );
        apron.quad(
          facePoint(front, a[0], bottom - 0.36, a[1]),
          facePoint(front, b[0], bottom - 0.36, b[1]),
          facePoint(front, b[0], bottom, b[1]),
          facePoint(front, a[0], bottom, a[1]),
          span,
          0.36,
          wallTint,
          wallMaterial === "siding",
        );
        for (const y of [bottom - 0.36, bottom, top])
          beam(
            facePoint(front, a[0], y, a[1]),
            facePoint(front, b[0], y, b[1]),
            0.105,
            "trim",
            trimTint,
          );
        beam(
          facePoint(front, a[0], bayY, a[1]),
          facePoint(front, b[0], bayY, b[1]),
          0.036,
          "trim",
          trimTint,
        );
        cap.triangle(
          facePoint(front, a[0], top + 0.06, a[1]),
          facePoint(front, b[0], top + 0.06, b[1]),
          facePoint(front, bayU, top + 0.24, -0.04),
          [0, 0],
          [span, 0],
          [span / 2, 0.8],
          roofTint,
        );
      }
      for (const [u, out] of outline)
        beam(
          facePoint(front, u, bottom - 0.36, out),
          facePoint(front, u, top + 0.05, out),
          0.1,
          "trim",
          trimTint,
        );
      beam(
        facePoint(front, bayU, bottom, 0.723),
        facePoint(front, bayU, top, 0.723),
        0.052,
        "trim",
        trimTint,
      );
      detailFeatures++;
    }
    let lowerWindows = 0;
    if (raisedRanch && foundationTop - house.low > 1.1) {
      for (let fi = 0; fi < 4; fi++) {
        const face = fi as Face,
          span = faceWidth(face);
        for (const u of [-span * 0.29, span * 0.29]) {
          if (
            (face === front && Math.abs(u - doorU) < 1.2) ||
            (garage &&
              face === garageFace &&
              Math.abs(u - garageU) < garageWidth / 2 + 0.6)
          )
            continue;
          const location = facePoint(face, u, 0, 0.1),
            ground = options.heightAt(location[0], location[2]);
          const y = foundationTop - 0.56;
          if (y - 0.29 < ground + 0.2) continue;
          window(face, u, y, 0.96, 0.52, false);
          lowerWindows++;
        }
      }
    }
    // Cape-style dormers vary the roof silhouette without enlarging the source
    // footprint, changing the accepted wall envelope, or inventing another wing.
    const hasDormers =
      !hip &&
      !utility &&
      !large &&
      house.width > 7.5 &&
      house.depth > 8.5 &&
      (reference?.dormers ??
        (reference?.style && reference.style !== "cape"
          ? false
          : random() < 0.32));
    if (hasDormers) {
      const direction =
        reference?.frontFace === 1
          ? 1
          : reference?.frontFace === 3
            ? -1
            : roadLX >= 0
              ? 1
              : -1;
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
        const out = getBatch(roofMaterial, house.x, house.z);
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
    if (entrance) {
      faceBox(
        front,
        doorU,
        entryBase + 1.13,
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
        entryBase + 1.1,
        0.138,
        0.98,
        2.08,
        0.06,
        reference?.doorColor !== undefined ? "trim" : "wood",
        doorTint,
      );
      for (const side of [-1, 1])
        faceBox(
          front,
          doorU + side * 0.59,
          entryBase + 1.13,
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
        entryBase + 2.29,
        0.16,
        1.31,
        0.16,
        0.16,
        "trim",
        trimTint,
      );
      for (const side of [-1, 1])
        for (const y of [entryBase + 0.48, entryBase + 1.06])
          faceBox(
            front,
            doorU + side * 0.22,
            y,
            0.18,
            0.32,
            0.42,
            0.035,
            reference?.doorColor !== undefined ? "trim" : "wood",
            tinted(doorTint, 1.15),
          );
      faceBox(
        front,
        doorU,
        entryBase + 1.72,
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
        entryBase + 1.05,
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
        entryBase + 1.97,
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
        entryBase + 1.96,
        0.265,
        0.12,
        0.2,
        0.013,
        "glass",
        0xd8ca9b,
      );
    }
    for (const garageCenter of garageCenters) {
      faceBox(
        garageFace,
        garageCenter,
        garageBase + 1.15,
        0.07,
        garageDoorWidth + 0.24,
        2.4,
        0.12,
        "wood",
        0x3f443e,
      );
      faceBox(
        garageFace,
        garageCenter,
        garageBase + 1.13,
        0.15,
        garageDoorWidth,
        2.24,
        0.09,
        "trim",
        tinted(trimTint, 0.89),
      );
      for (let row = 1; row < 5; row++)
        faceBox(
          garageFace,
          garageCenter,
          garageBase + row * 0.44,
          0.204,
          garageDoorWidth,
          0.025,
          0.013,
          "wood",
          0x979d91,
        );
      for (const side of [-1, 1])
        faceBox(
          garageFace,
          garageCenter + side * (garageDoorWidth / 2 + 0.08),
          garageBase + 1.15,
          0.21,
          0.14,
          2.4,
          0.15,
          "trim",
          trimTint,
        );
      faceBox(
        garageFace,
        garageCenter,
        garageBase + 2.34,
        0.21,
        garageDoorWidth + 0.3,
        0.16,
        0.15,
        "trim",
        trimTint,
      );
      const panes = Math.max(2, Math.floor(garageDoorWidth / 0.8));
      for (let n = 0; n < panes; n++)
        faceBox(
          garageFace,
          garageCenter +
            ((n - (panes - 1) / 2) * garageDoorWidth) / (panes + 0.3),
          garageBase + 1.92,
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
    if (genericYard && !utility && !large)
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
    const frontGable =
      entrance && reference?.frontGable && clear(doorOutside, 2.4)
        ? reference.frontGable
        : undefined;
    if (frontGable) {
      // Observed projected gables replace the generic porch canopy. The broad
      // version spans the entry and viewer-right living window, with full-height
      // pale supports; the small version is a compact entry portico.
      const broad = frontGable === "large";
      const gableWidth = broad
        ? Math.min(7.8, frontage * 0.61)
        : Math.min(2.85, frontage * 0.36);
      const centerU = broad ? Math.min(frontage * 0.13, 1.9) : doorU;
      const projection = broad ? 1.72 : 1.55;
      const eaveY = broad
        ? roofBase - 0.04
        : Math.min(roofBase - 0.12, entryBase + 2.64);
      const gableRise = broad
        ? Math.min(1.58, Math.max(0.8, rise * 0.86))
        : 0.68;
      const left = centerU - gableWidth / 2,
        right = centerU + gableWidth / 2;
      const canopy = getBatch(roofMaterial, house.x, house.z);
      const gable = getBatch(wallMaterial, house.x, house.z);
      const frontOut = projection + 0.12,
        backOut = -0.16;
      canopy.quad(
        facePoint(front, left - 0.14, eaveY, frontOut),
        facePoint(front, centerU, eaveY + gableRise, frontOut),
        facePoint(front, centerU, eaveY + gableRise, backOut),
        facePoint(front, left - 0.14, eaveY, backOut),
        Math.hypot(gableWidth / 2 + 0.14, gableRise),
        frontOut - backOut,
        roofTint,
      );
      canopy.quad(
        facePoint(front, centerU, eaveY + gableRise, frontOut),
        facePoint(front, right + 0.14, eaveY, frontOut),
        facePoint(front, right + 0.14, eaveY, backOut),
        facePoint(front, centerU, eaveY + gableRise, backOut),
        Math.hypot(gableWidth / 2 + 0.14, gableRise),
        frontOut - backOut,
        roofTint,
      );
      gable.triangle(
        facePoint(front, left, eaveY, projection),
        facePoint(front, right, eaveY, projection),
        facePoint(front, centerU, eaveY + gableRise - 0.055, projection),
        [0, 0],
        [0, gableWidth],
        [gableRise, gableWidth / 2],
        broad ? wallTint : trimTint,
      );
      for (const edge of [left - 0.14, right + 0.14])
        beam(
          facePoint(front, edge, eaveY - 0.025, frontOut),
          facePoint(front, centerU, eaveY + gableRise - 0.025, frontOut),
          0.16,
          "trim",
          trimTint,
        );
      faceBox(
        front,
        centerU,
        eaveY - 0.065,
        projection / 2,
        gableWidth + 0.18,
        0.16,
        projection + 0.16,
        "trim",
        trimTint,
        true,
      );
      const deckY = entryBase + 0.075,
        deckWidth = broad ? 2.2 : gableWidth - 0.16;
      const deckGround = options.heightAt(doorOutside[0], doorOutside[2]);
      const deckBottom = Math.min(deckGround - 0.06, deckY - 0.12);
      faceBox(
        front,
        doorU,
        (deckBottom + deckY) / 2,
        0.77,
        deckWidth,
        deckY - deckBottom,
        1.55,
        concreteKey,
        0xb9b9ad,
        true,
      );
      for (const u of [left + 0.18, right - 0.18]) {
        const foot = facePoint(front, u, 0, projection - 0.1);
        const postBase = broad ? options.heightAt(foot[0], foot[2]) : deckY;
        faceBox(
          front,
          u,
          (postBase + eaveY) / 2,
          projection - 0.1,
          broad ? 0.2 : 0.14,
          eaveY - postBase,
          broad ? 0.2 : 0.14,
          "trim",
          trimTint,
          true,
        );
        for (const y of [postBase + 0.09, eaveY - 0.15])
          faceBox(
            front,
            u,
            y,
            projection - 0.1,
            broad ? 0.3 : 0.22,
            0.18,
            broad ? 0.3 : 0.22,
            "trim",
            trimTint,
            true,
          );
      }
      const steps = Math.round(clamp((deckY - deckGround) / 0.17, 1, 6));
      for (let n = 0; n < steps; n++) {
        const top = deckY - (n + 1) * 0.16;
        const out = 1.72 + n * 0.3,
          location = facePoint(front, doorU, 0, out);
        if (!clear(location, 1.15)) break;
        const ground = options.heightAt(location[0], location[2]);
        if (top > ground)
          faceBox(
            front,
            doorU,
            (top + ground) / 2,
            out,
            broad ? 2.06 : 1.64,
            top - ground,
            0.35,
            concreteKey,
            0xbfc0b5,
            true,
          );
      }
      detailFeatures++;
    }
    const porch =
      entrance &&
      !frontGable &&
      (reference?.porch ?? (!large && random() < 0.61)) &&
      clear(doorOutside, 2.4);
    let entryAccess:
      { landingTop: number; steps: number; reachMeters: number } | undefined;
    if (porch) {
      const deckWidth = Math.min(3.3, frontage * 0.45),
        deckDepth = 1.7,
        deckY = entryBase + 0.18;
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
        concreteKey,
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
      const canopyY = entryBase + 2.66;
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
      const canopy = getBatch(roofMaterial, house.x, house.z);
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
            concreteKey,
            0xc1bdae,
            true,
          );
      }
      if (genericYard)
        path(
          facePoint(front, doorU, 0, 2 + steps * 0.29),
          facePoint(front, doorU, 0, 5 + steps * 0.29),
          1.05,
          concreteKey,
          0xd1cec0,
        );
    } else if (reference && !frontGable && entrance) {
      // A disabled porch does not remove physical access to an elevated door.
      // This compact landing/flight is approximate entrance geometry, without
      // inventing a garden or a path to the street. Solid risers extend below
      // the lowest sampled ground corner so slopes cannot leave them floating.
      const landingTop = entryBase + 0.045,
        landingWidth = 1.62,
        landingDepth = 1.08;
      const treadDepth = 0.29,
        treadWidth = 1.38;
      const corners = (out: number, width: number, depth: number) =>
        [-1, 1].flatMap((side) =>
          [-1, 1].map((end) =>
            facePoint(
              front,
              doorU + (side * width) / 2,
              0,
              out + (end * depth) / 2,
            ),
          ),
        );
      const groundedTread = (
        out: number,
        width: number,
        depth: number,
        top: number,
      ) => {
        const points = corners(out, width, depth);
        if (points.some((p) => !clear(p, 0.05))) return false;
        const bottom =
          Math.min(...points.map((p) => options.heightAt(p[0], p[2]))) - 0.08;
        if (top > bottom + 0.01)
          faceBox(
            front,
            doorU,
            (top + bottom) / 2,
            out,
            width,
            top - bottom,
            depth,
            concreteKey,
            0xbebcaf,
            true,
          );
        return true;
      };
      if (
        groundedTread(landingDepth / 2, landingWidth, landingDepth, landingTop)
      ) {
        let steps = 0,
          riser = 0;
        for (let count = 1; count <= 12; count++) {
          const reach = landingDepth + count * treadDepth;
          const foot = facePoint(front, doorU, 0, reach);
          if (!clear(foot, treadWidth / 2)) break;
          const target = options.heightAt(foot[0], foot[2]) + 0.025;
          if (target >= landingTop) break;
          steps = count;
          riser = (landingTop - target) / (count + 1);
          if (riser <= 0.19) break;
        }
        let builtSteps = 0;
        for (let n = 1; n <= steps; n++) {
          if (
            !groundedTread(
              landingDepth + (n - 0.5) * treadDepth,
              treadWidth,
              treadDepth,
              landingTop - n * riser,
            )
          )
            break;
          builtSteps++;
        }
        entryAccess = {
          landingTop,
          steps: builtSteps,
          reachMeters: landingDepth + builtSteps * treadDepth,
        };
        detailFeatures++;
      }
    } else if (
      genericYard &&
      !frontGable &&
      reference?.porch !== false &&
      entrance &&
      !large
    ) {
      const pad = facePoint(front, doorU, 0, 0.65);
      if (clear(pad, 1)) {
        faceBox(
          front,
          doorU,
          entryBase + 0.08,
          0.58,
          1.44,
          0.15,
          0.96,
          concreteKey,
          0xc2beb0,
          true,
        );
        path(
          facePoint(front, doorU, 0, 1.05),
          facePoint(front, doorU, 0, 4.8),
          0.95,
          concreteKey,
          0xd1cec0,
        );
      }
    }
    if (genericYard && garage)
      path(
        facePoint(garageFace, garageU, 0, 0.3),
        facePoint(garageFace, garageU, 0, 4.5),
        garageWidth + 0.35,
        "gravel",
        0xd1cdc0,
      );

    if (genericYard && !large) {
      const plantCount = utility ? 2 : 4 + Math.floor(random() * 4);
      for (let n = 0; n < plantCount; n++) {
        const face = (n % 4) as Face;
        const u = (random() - 0.5) * Math.max(1, faceWidth(face) - 2);
        if (
          (face === front && Math.abs(u - doorU) < 1.35) ||
          (face === garageFace &&
            garage &&
            Math.abs(u - garageU) < garageWidth / 2 + 0.5)
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
    if (genericYard && !utility && !large && Math.hypot(roadDX, roadDZ) < 110) {
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
    if (genericYard && !utility) {
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
    if (reference) {
      // Emit the reference shell last, around its actual openings. There is no
      // opaque full-size wall or foundation box behind recessed glazing.
      for (let fi = 0; fi < 4; fi++) {
        const face = fi as Face,
          half = faceWidth(face) / 2;
        faceSurface(
          face,
          [
            [-half, house.low],
            [half, house.low],
            [half, foundationTop],
            [-half, foundationTop],
          ],
          () => 0.025,
          concreteKey,
          0xb8b6a9,
        );
        if (wallMaterial === "referenceSiding") {
          const sidingRandom = seeded(`${house.id}:siding-courses`),
            course = 0.18;
          for (
            let bottom = foundationTop;
            bottom < roofBase - 0.001;
            bottom += course
          ) {
            const top = Math.min(roofBase, bottom + course),
              lip = Math.min(0.008, (top - bottom) * 0.2);
            const tint = tinted(wallTint, 0.995 + sidingRandom() * 0.01);
            faceSurface(
              face,
              [
                [-half, bottom],
                [half, bottom],
                [half, bottom + lip],
                [-half, bottom + lip],
              ],
              (y) => (0.018 * (y - bottom)) / lip,
              wallMaterial,
              tinted(tint, 0.95),
            );
            faceSurface(
              face,
              [
                [-half, bottom + lip],
                [half, bottom + lip],
                [half, top],
                [-half, top],
              ],
              (y) => (0.018 * (top - y)) / (top - bottom - lip),
              wallMaterial,
              tint,
            );
          }
        } else
          faceSurface(
            face,
            [
              [-half, foundationTop],
              [half, foundationTop],
              [half, roofBase],
              [-half, roofBase],
            ],
            () => 0,
            wallMaterial,
            wallTint,
          );
      }
      for (const emitStone of deferredStone) emitStone();
      referenceFacades.push({
        id: house.id,
        style: reference.style ?? "generic",
        frontFace: front,
        garageFace: garage ? garageFace : null,
        garageDoors,
        garageDoorWidth,
        garageBase,
        roofType: hip ? "hip" : "gable",
        roofRise: rise,
        roofBase,
        foundationTop,
        entryBase,
        entryAccess: entryAccess ?? null,
        livingStories: floors,
        lowerWindows,
        porch,
        frontGable: frontGable ?? null,
        stoneLower,
        bayWindow: baySide ?? null,
        dormers: hasDormers,
        chimney: hasChimney,
        genericYard,
        recessedWindows,
        windowRecessMeters: 0.3,
        sidingCourseMeters: wallMaterial === "referenceSiding" ? 0.18 : null,
        detailApproximation:
          "Window spacing, cavity depth, curtains, siding/shingle courses and gutter profiles are procedural construction detail, not surveyed observations. Explicit source colors and major facade overrides remain authoritative.",
        colors: {
          wall: wallTint,
          trim: trimTint,
          shutter: shutterTint,
          door: doorTint,
          roof: roofTint,
        },
      });
    }
  }

  let triangleCount = 0;
  for (const [id, batch] of batches) {
    if (!batch.positions.length) continue;
    let material = materials.get(batch.material);
    if (!material) {
      const supplied =
        options.materials?.[batch.material] ??
        (batch.material === "referenceConcrete"
          ? options.materials?.concrete
          : batch.material === "referenceSiding"
            ? options.materials?.siding
            : batch.material === "referenceRoof"
              ? options.materials?.roof
              : undefined);
      material = supplied?.clone() ?? defaultMaterial(batch.material);
      // Three's Material.copy does not copy shader hooks. Preserve shared
      // ground-scale color variation on the local vertex-colored yard clone.
      if (supplied) {
        material.onBeforeCompile = supplied.onBeforeCompile;
        material.customProgramCacheKey = supplied.customProgramCacheKey;
      }
      if (
        batch.material === "referenceConcrete" &&
        material instanceof T.MeshStandardMaterial
      ) {
        // The shared floor scan adds tan color and directional surface detail.
        // Use neutral reference masonry; retain detail only from an explicitly
        // supplied reference material. Shared source resources remain unchanged.
        material.name = "Reference gray concrete";
        material.map = null;
        material.color.set(0xffffff);
        if (!options.materials?.referenceConcrete) {
          material.normalMap = null;
          material.roughnessMap = null;
          material.roughness = 0.94;
        }
      }
      if (
        batch.material === "referenceSiding" &&
        material instanceof T.MeshStandardMaterial
      ) {
        material.name = "Reference painted lap siding";
        material.color.set(0xffffff);
        material.map = null;
        material.normalMap = null;
        material.roughnessMap = null;
        material.roughness = 0.76;
        material.envMapIntensity = 0.2;
      }
      if (
        batch.material === "referenceRoof" &&
        material instanceof T.MeshStandardMaterial
      ) {
        material.name = "Reference roof shingles";
        material.color.set(0xffffff);
        material.normalScale.setScalar(0.28);
        material.roughnessMap = null;
        material.roughness = 0.94;
        material.envMapIntensity = 0.18;
        const originalCompile = material.onBeforeCompile,
          originalKey = material.customProgramCacheKey();
        material.onBeforeCompile = (shader, renderer) => {
          originalCompile.call(material!, shader, renderer);
          shader.fragmentShader = shader.fragmentShader.replace(
            "#include <map_fragment>",
            T.ShaderChunk.map_fragment.replace(
              "diffuseColor *= sampledDiffuseColor;",
              `float shingleGrain = pow(max(dot(sampledDiffuseColor.rgb,vec3(0.2126,0.7152,0.0722)),0.001),0.35);
            diffuseColor *= vec4(vec3(0.70 + shingleGrain * 0.40),sampledDiffuseColor.a);`,
            ),
          );
        };
        material.customProgramCacheKey = () =>
          `${originalKey}|reference-roof-neutral-v1`;
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
    referenceFacades: referenceFacades.length,
  };
  group.userData.referenceFacades = referenceFacades;
  group.userData.provenance =
    "Source-approved footprint/address positions. Explicit facade overrides supplied by Environment take precedence; other facade and yard details remain generic approximations. Existing envelope colliders are owned by Environment.";
  return group;
}
