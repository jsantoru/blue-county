import * as T from "three";

export type RiparianPlant = {
  x: number;
  y: number;
  z: number;
  kind: "fern" | "sedge" | "shrub" | "sapling";
  scale: number;
  yaw: number;
};

type Kind = RiparianPlant["kind"];
type Part = "leaf" | "wood";
type Prototype = {
  leaf: T.BufferGeometry;
  wood?: T.BufferGeometry;
};
const UP = new T.Vector3(0, 1, 0);
const TAU = Math.PI * 2;
const COLORS = {
  fern: new T.Color(0x557333),
  sedge: new T.Color(0x647342),
  shrub: new T.Color(0x4b6535),
  sapling: new T.Color(0x648144),
  wood: new T.Color(0x696052),
};

function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Small original 3-D leaf surfaces, with a raised midrib and tapered perimeter. */
class Surface {
  private positions: number[] = [];
  private colors: number[] = [];

  triangle(a: T.Vector3, b: T.Vector3, c: T.Vector3, color: T.Color) {
    this.positions.push(...a.toArray(), ...b.toArray(), ...c.toArray());
    this.colors.push(
      ...color.toArray(),
      ...color.toArray(),
      ...color.toArray(),
    );
  }

  leaf(
    base: T.Vector3,
    direction: T.Vector3,
    length: number,
    width: number,
    color: T.Color,
    roll = 0,
  ) {
    const axis = direction.clone().normalize();
    const side = new T.Vector3().crossVectors(axis, UP);
    if (side.lengthSq() < 0.01) side.set(1, 0, 0);
    side.normalize().applyAxisAngle(axis, roll);
    const normal = new T.Vector3().crossVectors(side, axis).normalize();
    const point = (t: number, s: number, lift: number) =>
      base
        .clone()
        .addScaledVector(axis, length * t)
        .addScaledVector(side, width * s)
        .addScaledVector(normal, length * lift);
    // The two shoulders soften the outline; this is neither a rectangle nor an alpha billboard.
    const rim = [
      point(0, 0, 0),
      point(0.32, 0.83, 0.016),
      point(0.66, 0.68, 0.039),
      point(1, 0, 0.035),
      point(0.66, -0.68, 0.039),
      point(0.32, -0.83, 0.016),
    ];
    const ridge = point(0.48, 0, 0.085);
    for (let i = 0; i < rim.length; i++) {
      const tint = color.clone().multiplyScalar(i < 3 ? 1.04 : 0.91);
      this.triangle(rim[i], rim[(i + 1) % rim.length], ridge, tint);
    }
  }

  stem(points: T.Vector3[], radii: number[], color: T.Color, sides = 5) {
    for (let segment = 1; segment < points.length; segment++) {
      const a = points[segment - 1],
        b = points[segment];
      const direction = b.clone().sub(a).normalize();
      const side = new T.Vector3().crossVectors(direction, UP);
      if (side.lengthSq() < 0.01) side.set(1, 0, 0);
      side.normalize();
      const normal = new T.Vector3().crossVectors(direction, side).normalize();
      const ringPoint = (point: T.Vector3, radius: number, angle: number) =>
        point
          .clone()
          .addScaledVector(side, Math.cos(angle) * radius)
          .addScaledVector(normal, Math.sin(angle) * radius);
      for (let i = 0; i < sides; i++) {
        const theta = (i / sides) * TAU,
          next = ((i + 1) / sides) * TAU;
        const p = ringPoint(a, radii[segment - 1], theta);
        const q = ringPoint(a, radii[segment - 1], next);
        const r = ringPoint(b, radii[segment], next);
        const s = ringPoint(b, radii[segment], theta);
        const tint = color.clone().multiplyScalar(0.85 + (i / sides) * 0.2);
        this.triangle(p, q, r, tint);
        this.triangle(p, r, s, tint);
      }
    }
  }

  geometry() {
    const geometry = new T.BufferGeometry();
    geometry.setAttribute(
      "position",
      new T.Float32BufferAttribute(this.positions, 3),
    );
    geometry.setAttribute(
      "color",
      new T.Float32BufferAttribute(this.colors, 3),
    );
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }
}

function fern(): Prototype {
  const surface = new Surface(),
    random = seeded(51271);
  for (let frond = 0; frond < 8; frond++) {
    const angle = (frond / 8) * TAU + (random() - 0.5) * 0.29;
    const radial = new T.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const side = new T.Vector3(-radial.z, 0, radial.x);
    const length = 0.76 + random() * 0.27;
    const reach = frond === 6 ? 0.45 : 0.86;
    const point = (t: number) =>
      radial
        .clone()
        .multiplyScalar(length * reach * (0.18 * t + 0.82 * t * t))
        .add(new T.Vector3(0, 0.025 + length * (1.25 * t - 0.7 * t * t), 0));
    const stems = Array.from({ length: 7 }, (_, i) => point(i / 6));
    surface.stem(
      stems,
      stems.map((_, i) => 0.009 * (1 - i / 7) + 0.0008),
      COLORS.fern.clone().multiplyScalar(0.77),
      4,
    );
    for (let pair = 0; pair < 10; pair++) {
      const t = 0.17 + pair * 0.076;
      const leafletLength =
        length * 0.27 * Math.pow(Math.sin(t * Math.PI), 0.72);
      for (const sign of [-1, 1]) {
        const at = point(t + (sign > 0 ? 0.012 : 0));
        const direction = side
          .clone()
          .multiplyScalar(sign)
          .addScaledVector(radial, 0.3 + t * 0.2)
          .add(new T.Vector3(0, 0.12 - t * 0.22, 0))
          .normalize();
        const tint = COLORS.fern.clone().multiplyScalar(0.83 + random() * 0.26);
        surface.leaf(
          at,
          direction,
          leafletLength,
          leafletLength * 0.115,
          tint,
          sign * 0.12,
        );
      }
    }
    surface.leaf(
      point(0.92),
      radial.clone().add(new T.Vector3(0, -0.24, 0)),
      length * 0.13,
      0.015,
      COLORS.fern,
    );
  }
  return { leaf: surface.geometry() };
}

function sedge(): Prototype {
  const surface = new Surface(),
    random = seeded(91641);
  for (let blade = 0; blade < 27; blade++) {
    const angle = blade * 2.399963 + random() * 0.19;
    const radial = new T.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const side = new T.Vector3(-radial.z, 0, radial.x);
    const height = 0.45 + random() * 0.5;
    const reach = 0.17 + random() * 0.36;
    const base = radial.clone().multiplyScalar(random() * 0.068);
    const tint = COLORS.sedge.clone().multiplyScalar(0.82 + random() * 0.29);
    const point = (t: number, offset: number, ridge: boolean) =>
      base
        .clone()
        .addScaledVector(radial, reach * Math.pow(t, 1.8))
        .addScaledVector(side, offset * 0.021 * Math.pow(1 - t, 0.64))
        .add(
          new T.Vector3(
            0,
            height * (1.54 * t - 0.65 * t * t) + (ridge ? 0.011 * (1 - t) : 0),
            0,
          ),
        );
    for (let segment = 0; segment < 7; segment++) {
      const t0 = segment / 7,
        t1 = (segment + 1) / 7;
      const a = point(t0, -1, false),
        b = point(t0, 0, true),
        c = point(t0, 1, false);
      const d = point(t1, -1, false),
        e = point(t1, 0, true),
        f = point(t1, 1, false);
      surface.triangle(a, d, e, tint);
      surface.triangle(a, e, b, tint);
      surface.triangle(b, e, f, tint.clone().multiplyScalar(0.87));
      surface.triangle(b, f, c, tint.clone().multiplyScalar(0.87));
    }
  }
  return { leaf: surface.geometry() };
}

function woody(kind: "shrub" | "sapling"): Prototype {
  const leaf = new Surface(),
    wood = new Surface();
  const random = seeded(kind === "shrub" ? 461103 : 124995);
  const tall = kind === "sapling";
  const trunkHeight = tall ? 2.55 : 1.0;
  const trunk = (t: number) =>
    new T.Vector3(
      Math.sin(t * 2.3) * (tall ? 0.075 : 0.025),
      t * trunkHeight,
      Math.sin(t * 3.0) * (tall ? 0.05 : 0.018),
    );
  const trunkPoints = Array.from({ length: tall ? 7 : 4 }, (_, i) =>
    trunk(i / (tall ? 6 : 3)),
  );
  wood.stem(
    trunkPoints,
    trunkPoints.map(
      (_, i) => (tall ? 0.035 : 0.027) * (1 - i / trunkPoints.length) + 0.003,
    ),
    COLORS.wood,
    6,
  );
  const branches = tall ? 8 : 9;
  for (let branch = 0; branch < branches; branch++) {
    const angle = branch * 2.399963 + random() * 0.4;
    const radial = new T.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const side = new T.Vector3(-radial.z, 0, radial.x);
    const startT = tall
      ? 0.28 + (branch / branches) * 0.56
      : 0.1 + random() * 0.32;
    const start = trunk(startT);
    const reach = tall ? 0.74 - startT * 0.32 : 0.39 + random() * 0.24;
    const rise = tall ? 0.28 + random() * 0.25 : 0.42 + random() * 0.44;
    const point = (t: number) =>
      start
        .clone()
        .addScaledVector(radial, reach * t)
        .addScaledVector(side, Math.sin(t * 2.7) * 0.065)
        .add(new T.Vector3(0, rise * (t * 1.3 - t * t * 0.3), 0));
    const stem = Array.from({ length: 4 }, (_, i) => point(i / 3));
    wood.stem(
      stem,
      [tall ? 0.015 : 0.012, 0.009, 0.005, 0.0013],
      COLORS.wood,
      5,
    );
    for (let pair = 0; pair < 5; pair++) {
      const t = 0.26 + pair * 0.17;
      for (const sign of [-1, 1]) {
        const node = point(Math.min(1, t + (sign > 0 ? 0.025 : 0)));
        const direction = side
          .clone()
          .multiplyScalar(sign * 0.75)
          .addScaledVector(radial, 0.44)
          .add(new T.Vector3(0, 0.1 + random() * 0.35, 0))
          .normalize();
        const petiole = node.clone().addScaledVector(direction, 0.032);
        wood.stem(
          [node, petiole],
          [0.0022, 0.0008],
          COLORS.wood.clone().multiplyScalar(1.08),
          3,
        );
        const size = (tall ? 0.21 : 0.18) * (0.72 + random() * 0.43);
        const tint = COLORS[kind]
          .clone()
          .multiplyScalar(0.79 + random() * 0.28);
        leaf.leaf(
          petiole,
          direction,
          size,
          size * (tall ? 0.34 : 0.29),
          tint,
          (random() - 0.5) * 0.72,
        );
      }
    }
    leaf.leaf(
      point(1),
      radial.clone().add(new T.Vector3(0, 0.15, 0)),
      tall ? 0.2 : 0.17,
      tall ? 0.064 : 0.048,
      COLORS[kind],
      0.18,
    );
  }
  return { leaf: leaf.geometry(), wood: wood.geometry() };
}

/**
 * Representative regional woodland forms, not an inventory of species at this property.
 * Prototypes use original mesh leaves; no photographs, DOM, alpha cards, or per-frame work.
 */
export function buildRiparianPlants(plants: RiparianPlant[]): T.Group {
  const group = new T.Group();
  group.name = "Riparian understory";
  const valid = plants.filter(
    (plant) =>
      [plant.x, plant.y, plant.z, plant.scale, plant.yaw].every(
        Number.isFinite,
      ) &&
      plant.scale > 0 &&
      ["fern", "sedge", "shrub", "sapling"].includes(plant.kind),
  );
  const counts: Record<Kind, number> = {
    fern: 0,
    sedge: 0,
    shrub: 0,
    sapling: 0,
  };
  const prototypes: Partial<
    Record<Kind, { triangles: number; height: number; radius: number }>
  > = {};
  const transform = new T.Matrix4(),
    rotation = new T.Quaternion(),
    scale = new T.Vector3();
  const leafMaterial = new T.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    side: T.DoubleSide,
    roughness: 0.9,
    metalness: 0,
  });
  const woodMaterial = new T.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 1,
  });
  const usedMaterials = new Set<T.Material>();
  for (const kind of ["fern", "sedge", "shrub", "sapling"] as Kind[]) {
    const list = valid.filter((plant) => plant.kind === kind);
    counts[kind] = list.length;
    if (!list.length) continue;
    const prototype =
      kind === "fern" ? fern() : kind === "sedge" ? sedge() : woody(kind);
    const bounds = new T.Box3();
    let triangles = 0;
    for (const part of ["leaf", "wood"] as Part[]) {
      const geometry = prototype[part];
      if (!geometry) continue;
      bounds.union(geometry.boundingBox!);
      triangles += geometry.getAttribute("position").count / 3;
      const material = part === "leaf" ? leafMaterial : woodMaterial;
      usedMaterials.add(material);
      const mesh = new T.InstancedMesh(geometry, material, list.length);
      mesh.name = `Riparian ${kind} ${part}`;
      mesh.castShadow =
        kind === "sapling" || (kind === "shrub" && part === "wood");
      mesh.receiveShadow = true;
      mesh.userData.riparianKind = kind;
      mesh.userData.riparianPart = part;
      mesh.instanceMatrix.setUsage(T.StaticDrawUsage);
      for (let i = 0; i < list.length; i++) {
        const plant = list[i];
        rotation.setFromAxisAngle(UP, plant.yaw);
        scale.setScalar(plant.scale);
        transform.compose(
          new T.Vector3(plant.x, plant.y, plant.z),
          rotation,
          scale,
        );
        mesh.setMatrixAt(i, transform);
        // Position-stable, restrained shifts keep adjacent clumps from repeating exactly.
        const phase =
          Math.sin(plant.x * 0.71 + plant.z * 0.43 + plant.yaw * 2.9) * 0.5 +
          0.5;
        mesh.setColorAt(
          i,
          new T.Color().setRGB(
            0.91 + phase * 0.09,
            0.93 + phase * 0.07,
            0.91 + phase * 0.06,
          ),
        );
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
    prototypes[kind] = {
      triangles,
      height: bounds.max.y,
      radius: Math.max(
        Math.abs(bounds.min.x),
        Math.abs(bounds.max.x),
        Math.abs(bounds.min.z),
        Math.abs(bounds.max.z),
      ),
    };
  }
  // Empty inputs must not leave otherwise unreachable GPU resources behind.
  if (!usedMaterials.has(leafMaterial)) leafMaterial.dispose();
  if (!usedMaterials.has(woodMaterial)) woodMaterial.dispose();
  group.userData.riparianPlants = {
    counts,
    total: valid.length,
    omitted: plants.length - valid.length,
    batches: group.children.length,
    prototypes,
    basis:
      "Representative woodland forms; species and exact placements are not surveyed",
    geometry: "Original folded leaves and tapered segmented stems",
  };
  return group;
}
