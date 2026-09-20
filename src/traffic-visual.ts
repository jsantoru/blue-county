import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

type P = [number, number, number];
type Finish =
  "paint" | "chrome" | "glass" | "rubber" | "dark" | "lamp" | "plate";
const UP = new T.Vector3(0, 1, 0);

/**
 * Original, unbranded neighborhood traffic. +Z forward, +Y up; four 0.35m
 * tires touch y=0. Sedan, wagon and compact pickup share the physics envelope.
 * Everything is static and material-batched: at most seven draws per car.
 */
export function createTrafficVisual(color: number, variant = 0): T.Group {
  const type = ((Math.floor(variant) % 3) + 3) % 3;
  const wagon = type === 1,
    pickup = type === 2;
  const group = new T.Group();
  group.name = [
    "Neighborhood sedan",
    "Neighborhood wagon",
    "Neighborhood pickup",
  ][type];
  const materials: Record<Finish, T.Material> = {
    paint: new T.MeshPhysicalMaterial({
      color,
      metalness: 0.48,
      roughness: 0.29,
      clearcoat: 1,
      clearcoatRoughness: 0.13,
      envMapIntensity: 1,
      vertexColors: true,
    }),
    chrome: new T.MeshStandardMaterial({
      color: 0xc8cdd0,
      metalness: 0.95,
      roughness: 0.22,
      envMapIntensity: 1.1,
      vertexColors: true,
    }),
    glass: new T.MeshPhysicalMaterial({
      color: 0x53666d,
      metalness: 0.32,
      roughness: 0.11,
      clearcoat: 1,
      clearcoatRoughness: 0.045,
      envMapIntensity: 1.25,
      vertexColors: true,
    }),
    rubber: new T.MeshStandardMaterial({
      color: 0x202321,
      metalness: 0,
      roughness: 0.89,
      vertexColors: true,
    }),
    dark: new T.MeshStandardMaterial({
      color: 0x292e2c,
      metalness: 0.2,
      roughness: 0.6,
      vertexColors: true,
    }),
    lamp: new T.MeshPhysicalMaterial({
      color: 0xffffff,
      emissive: 0x080705,
      roughness: 0.19,
      metalness: 0.1,
      clearcoat: 1,
      vertexColors: true,
    }),
    plate: new T.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.55,
      metalness: 0.08,
      vertexColors: true,
    }),
  };
  const pieces = new Map<Finish, T.BufferGeometry[]>();
  const add = (
    geometry: T.BufferGeometry,
    finish: Finish,
    position: P = [0, 0, 0],
    rotation: P = [0, 0, 0],
    tint = 0xffffff,
  ) => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (g !== geometry) geometry.dispose();
    for (const name of Object.keys(g.attributes))
      if (name !== "position" && name !== "normal") g.deleteAttribute(name);
    if (!g.getAttribute("normal")) g.computeVertexNormals();
    const c = new T.Color(tint),
      colors = new Float32Array(g.getAttribute("position").count * 3);
    for (let i = 0; i < colors.length; i += 3) {
      colors[i] = c.r;
      colors[i + 1] = c.g;
      colors[i + 2] = c.b;
    }
    g.setAttribute("color", new T.BufferAttribute(colors, 3));
    g.applyMatrix4(
      new T.Matrix4().compose(
        new T.Vector3(...position),
        new T.Quaternion().setFromEuler(new T.Euler(...rotation)),
        new T.Vector3(1, 1, 1),
      ),
    );
    g.clearGroups();
    const list = pieces.get(finish) || [];
    list.push(g);
    pieces.set(finish, list);
  };
  const box = (
    p: P,
    size: P,
    finish: Finish,
    tint = 0xffffff,
    rotation: P = [0, 0, 0],
    radius = 0,
  ) =>
    add(
      radius
        ? new RoundedBoxGeometry(...size, 1, radius)
        : new T.BoxGeometry(...size),
      finish,
      p,
      rotation,
      tint,
    );
  const surface = (
    points: P[],
    finish: Finish,
    outward: P,
    tint = 0xffffff,
  ) => {
    const a = new T.Vector3(...points[0]),
      b = new T.Vector3(...points[1]),
      c = new T.Vector3(...points[2]);
    const normal = b.sub(a).cross(c.sub(a));
    const ordered =
      normal.dot(new T.Vector3(...outward)) < 0
        ? [...points].reverse()
        : points;
    const values: number[] = [];
    for (let i = 1; i < ordered.length - 1; i++)
      for (const p of [ordered[0], ordered[i], ordered[i + 1]])
        values.push(...p);
    const geometry = new T.BufferGeometry();
    geometry.setAttribute("position", new T.Float32BufferAttribute(values, 3));
    geometry.computeVertexNormals();
    add(geometry, finish, [0, 0, 0], [0, 0, 0], tint);
  };
  const rod = (
    a: P,
    b: P,
    radius: number,
    finish: Finish,
    tint = 0xffffff,
    segments = 6,
  ) => {
    const start = new T.Vector3(...a),
      end = new T.Vector3(...b),
      delta = end.clone().sub(start);
    const geometry = new T.CylinderGeometry(
      radius,
      radius,
      delta.length(),
      segments,
      1,
      false,
    );
    geometry.applyQuaternion(
      new T.Quaternion().setFromUnitVectors(UP, delta.normalize()),
    );
    add(
      geometry,
      finish,
      start.add(end).multiplyScalar(0.5).toArray() as P,
      [0, 0, 0],
      tint,
    );
  };
  const cylinder = (
    p: P,
    radius: number,
    width: number,
    finish: Finish,
    segments = 24,
    tint = 0xffffff,
  ) =>
    add(
      new T.CylinderGeometry(radius, radius, width, segments, 1, false),
      finish,
      p,
      [0, 0, Math.PI / 2],
      tint,
    );

  const sections = [
    { z: -2.25, w: 0.865, h: 0.84 },
    { z: -2.05, w: 0.94, h: 0.92 },
    { z: -1.7, w: 0.965, h: 0.965 },
    { z: -0.8, w: 0.95, h: 1.005 },
    { z: 0.65, w: 0.953, h: 1.0 },
    { z: 1.75, w: 0.96, h: 0.97 },
    { z: 2.1, w: 0.925, h: 0.92 },
    { z: 2.3, w: 0.865, h: 0.83 },
  ];
  const profile = (z: number) => {
    let i = 1;
    while (i < sections.length - 1 && sections[i].z < z) i++;
    const a = sections[i - 1],
      b = sections[i],
      t = Math.max(0, Math.min(1, (z - a.z) / (b.z - a.z)));
    return { w: a.w + (b.w - a.w) * t, h: a.h + (b.h - a.h) * t };
  };
  const wheelZ = [-1.4, 1.4],
    radius = 0.405;
  const arch = (z: number) => {
    let y = 0.33;
    for (const center of wheelZ) {
      const dz = z - center;
      if (Math.abs(dz) < radius)
        y = Math.max(y, 0.35 + Math.sqrt(radius * radius - dz * dz));
    }
    return y;
  };
  const zSet = new Set(sections.map((s) => s.z));
  for (const center of wheelZ)
    for (let i = 0; i <= 14; i++)
      zSet.add(center + Math.cos((i / 14) * Math.PI) * radius);
  for (const z of [-0.75, -0.65, 0.7, 0.84]) zSet.add(z);
  const zs = [...zSet].sort((a, b) => a - b);

  // Continuous chamfered shoulder and rocker strips surround real wheel-arch
  // openings; the tire silhouette is not buried in an uncut rectangular body.
  for (const side of [-1, 1])
    for (let i = 1; i < zs.length; i++) {
      const za = zs[i - 1],
        zb = zs[i],
        a = profile(za),
        b = profile(zb),
        ya = arch(za),
        yb = arch(zb);
      const rowsA: P[] = [
        [side * (a.w - 0.045), ya, za],
        [side * (a.w + 0.003), Math.max(ya + 0.025, a.h - 0.2), za],
        [side * a.w, a.h - 0.065, za],
      ];
      const rowsB: P[] = [
        [side * (b.w - 0.045), yb, zb],
        [side * (b.w + 0.003), Math.max(yb + 0.025, b.h - 0.2), zb],
        [side * b.w, b.h - 0.065, zb],
      ];
      for (let row = 0; row < 2; row++)
        surface(
          [rowsA[row], rowsB[row], rowsB[row + 1], rowsA[row + 1]],
          "paint",
          [side, 0, 0],
        );
    }
  for (let i = 1; i < zs.length; i++) {
    const za = zs[i - 1],
      zb = zs[i];
    if (pickup && zb <= -0.65) continue;
    const a = profile(za),
      b = profile(zb),
      across = [-1, -0.84, 0, 0.84, 1],
      ys = [-0.065, 0.004, 0.022, 0.004, -0.065];
    for (let x = 1; x < across.length; x++)
      surface(
        [
          [a.w * across[x - 1], a.h + ys[x - 1], za],
          [b.w * across[x - 1], b.h + ys[x - 1], zb],
          [b.w * across[x], b.h + ys[x], zb],
          [a.w * across[x], a.h + ys[x], za],
        ],
        "paint",
        [0, 1, 0],
      );
  }
  for (const z of [-2.25, 2.3]) {
    const p = profile(z);
    surface(
      [
        [-p.w + 0.045, 0.33, z],
        [p.w - 0.045, 0.33, z],
        [p.w, p.h - 0.065, z],
        [p.w * 0.84, p.h + 0.004, z],
        [0, p.h + 0.022, z],
        [-p.w * 0.84, p.h + 0.004, z],
        [-p.w, p.h - 0.065, z],
      ],
      "paint",
      [0, 0, Math.sign(z)],
    );
  }
  box([0, 0.31, 0], [1.5, 0.11, 3.88], "dark");
  for (const side of [-1, 1]) {
    box([side * 0.915, 0.355, 0], [0.055, 0.065, 1.77], "chrome");
    for (const center of wheelZ) {
      const well: P[] = Array.from({ length: 19 }, (_, i): P => {
        const angle = (i / 18) * Math.PI;
        return [
          side * 0.775,
          0.35 + Math.sin(angle) * 0.414,
          center + Math.cos(angle) * 0.414,
        ];
      });
      well.push(
        [side * 0.775, 0.12, center - 0.414],
        [side * 0.775, 0.12, center + 0.414],
      );
      surface(well, "dark", [side, 0, 0]);
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI,
          b = ((i + 1) / 18) * Math.PI;
        const p = (angle: number, r: number): P => {
          const z = center + Math.cos(angle) * r;
          return [side * (profile(z).w + 0.014), 0.35 + Math.sin(angle) * r, z];
        };
        surface([p(a, 0.405), p(b, 0.405), p(b, 0.441), p(a, 0.441)], "paint", [
          side,
          0,
          0,
        ]);
      }
      // Torus rubber shoulders + a dark sidewall, silver rim lip and five-spoke
      // wheel centers provide readable depth without per-wheel draw calls.
      add(
        new T.TorusGeometry(0.267, 0.083, 8, 28),
        "rubber",
        [side * 0.846, 0.35, center],
        [0, Math.PI / 2, 0],
      );
      cylinder([side * 0.846, 0.35, center], 0.284, 0.184, "rubber", 28);
      cylinder([side * 0.951, 0.35, center], 0.224, 0.021, "dark", 24);
      add(
        new T.TorusGeometry(0.224, 0.017, 6, 24),
        "chrome",
        [side * 0.968, 0.35, center],
        [0, Math.PI / 2, 0],
      );
      for (let spoke = 0; spoke < 5; spoke++) {
        const angle = (spoke / 5) * Math.PI * 2;
        rod(
          [
            side * 0.969,
            0.35 + Math.sin(angle) * 0.075,
            center + Math.cos(angle) * 0.075,
          ],
          [
            side * 0.969,
            0.35 + Math.sin(angle) * 0.205,
            center + Math.cos(angle) * 0.205,
          ],
          0.028,
          "chrome",
          0xd6dadd,
          5,
        );
        cylinder(
          [
            side * 0.986,
            0.35 + Math.sin(angle) * 0.071,
            center + Math.cos(angle) * 0.071,
          ],
          0.014,
          0.011,
          "chrome",
          6,
        );
      }
      cylinder([side * 0.978, 0.35, center], 0.062, 0.024, "chrome", 16);
      // Sparse tread grooves on the exposed rubber perimeter, completely static.
      for (let tread = 0; tread < 16; tread++) {
        const angle = (tread / 16) * Math.PI * 2,
          y = 0.35 + Math.sin(angle) * 0.34,
          z = center + Math.cos(angle) * 0.34;
        rod(
          [side * 0.81, y, z],
          [side * 0.88, y, z],
          0.008,
          "dark",
          0x7c817b,
          4,
        );
      }
    }
  }

  const roofY = pickup ? 1.6 : 1.53;
  const rearRoof = wagon ? -1.53 : pickup ? -0.4 : -0.63;
  const frontRoof = pickup ? 0.2 : 0.24;
  const lowerRear = wagon ? -1.99 : pickup ? -0.65 : -1.37;
  const lowerFront = pickup ? 0.8 : 0.86;
  const upperWidth = pickup ? 0.715 : 0.685,
    lowerWidth = 0.858;
  // Roof has a softly crowned top, short chamfered edges and a painted surround.
  const roofLength = frontRoof - rearRoof;
  box(
    [0, roofY + 0.022, (rearRoof + frontRoof) / 2],
    [upperWidth * 2 + 0.075, 0.082, roofLength + 0.11],
    "paint",
    0xffffff,
    [0, 0, 0],
    0.065,
  );
  const frontGlass: P[] = [
    [-lowerWidth + 0.08, 1.03, lowerFront],
    [lowerWidth - 0.08, 1.03, lowerFront],
    [upperWidth - 0.055, roofY - 0.045, frontRoof],
    [-upperWidth + 0.055, roofY - 0.045, frontRoof],
  ];
  const rearGlass: P[] = [
    [-lowerWidth + 0.08, 1.035, lowerRear],
    [lowerWidth - 0.08, 1.035, lowerRear],
    [upperWidth - 0.055, roofY - 0.045, rearRoof],
    [-upperWidth + 0.055, roofY - 0.045, rearRoof],
  ];
  surface(frontGlass, "glass", [0, 0.3, 1]);
  surface(rearGlass, "glass", [0, 0.2, -1]);
  for (const [quad, forward] of [
    [frontGlass, true],
    [rearGlass, false],
  ] as [P[], boolean][]) {
    for (let edge = 0; edge < 4; edge++)
      rod(quad[edge], quad[(edge + 1) % 4], 0.034, "dark");
    const lowerZ = forward ? lowerFront : lowerRear,
      upperZ = forward ? frontRoof : rearRoof;
    rod(
      [-lowerWidth, 1.015, lowerZ],
      [lowerWidth, 1.015, lowerZ],
      0.025,
      "chrome",
    );
    for (const side of [-1, 1])
      rod(
        [side * lowerWidth, 1.005, lowerZ],
        [side * upperWidth, roofY, upperZ],
        pickup ? 0.051 : 0.045,
        "paint",
      );
  }
  for (const side of [-1, 1]) {
    const sideGlass: P[] = [
      [side * (lowerWidth + 0.005), 1.035, lowerRear + 0.095],
      [side * (lowerWidth + 0.005), 1.035, lowerFront - 0.1],
      [side * (upperWidth + 0.01), roofY - 0.055, frontRoof - 0.025],
      [side * (upperWidth + 0.01), roofY - 0.055, rearRoof + 0.035],
    ];
    surface(sideGlass, "glass", [side, 0.1, 0], 0xc9d4d4);
    for (let edge = 0; edge < 4; edge++)
      rod(sideGlass[edge], sideGlass[(edge + 1) % 4], 0.023, "chrome");
    const pillarZ = pickup ? -0.32 : -0.27;
    rod(
      [side * (lowerWidth + 0.012), 1.032, pillarZ],
      [side * (upperWidth + 0.018), roofY - 0.045, pillarZ],
      pickup ? 0.035 : 0.048,
      "dark",
    );
    if (wagon)
      rod(
        [side * (lowerWidth + 0.012), 1.032, -1.2],
        [side * (upperWidth + 0.018), roofY - 0.045, -1.2],
        0.041,
        "paint",
      );
    for (const z of pickup ? [-0.65, 0.81] : [-1.3, -0.29, 0.84]) {
      const p = profile(z);
      rod(
        [side * (p.w + 0.004), Math.max(0.385, arch(z) + 0.02), z],
        [side * (p.w + 0.006), p.h - 0.095, z],
        0.009,
        "dark",
      );
    }
    for (const z of pickup ? [0.1] : [0.33, -0.85])
      box(
        [side * 0.958, 0.87, z],
        [0.026, 0.043, 0.175],
        "chrome",
        0xffffff,
        [0, 0, 0],
        0.017,
      );
    box([side * 0.961, 0.64, 0], [0.021, 0.064, 1.68], "dark");
    box([side * 0.974, 0.682, 0], [0.012, 0.013, 1.7], "chrome");
    // Mirror housing and a rear-facing reflective inset.
    rod([side * 0.884, 1.075, 0.61], [side * 1.01, 1.12, 0.57], 0.025, "dark");
    box(
      [side * 1.017, 1.132, 0.572],
      [0.16, 0.105, 0.235],
      "paint",
      0xffffff,
      [0, 0, 0],
      0.035,
    );
    box([side * 1.017, 1.13, 0.451], [0.128, 0.068, 0.008], "chrome");
    box([side * 0.962, 0.842, 1.02], [0.014, 0.046, 0.11], "lamp", 0xe39436);
  }
  for (const x of [-0.38, 0.31])
    rod(
      [x, 1.052, lowerFront - 0.04],
      [x + 0.13, 1.155, lowerFront - 0.18],
      0.009,
      "dark",
      0xffffff,
      5,
    );

  if (wagon) {
    for (const x of [-0.51, 0.51]) {
      rod(
        [x, roofY + 0.16, rearRoof + 0.14],
        [x, roofY + 0.16, frontRoof - 0.09],
        0.026,
        "chrome",
      );
      for (const z of [rearRoof + 0.2, frontRoof - 0.14])
        box([x, roofY + 0.1, z], [0.063, 0.12, 0.075], "dark");
    }
    for (const z of [rearRoof + 0.31, frontRoof - 0.2])
      rod([-0.51, roofY + 0.17, z], [0.51, roofY + 0.17, z], 0.023, "dark");
    rod(
      [-0.43, 1.09, lowerRear - 0.013],
      [0.12, 1.29, lowerRear + 0.19],
      0.009,
      "dark",
    );
  }
  if (pickup) {
    // An open ribbed bed, inset inside the unchanged outer shell.
    box([0, 0.657, -1.46], [1.6, 0.065, 1.42], "dark", 0xc5c9c4);
    for (const x of [-0.795, 0.795])
      box([x, 0.835, -1.44], [0.1, 0.37, 1.48], "paint");
    for (const z of [-2.14, -0.73])
      box([0, 0.84, z], [1.63, 0.34, 0.1], "paint");
    for (const x of [-0.805, 0.805])
      box([x, 1.017, -1.44], [0.14, 0.065, 1.5], "dark");
    for (let n = 0; n < 9; n++)
      box(
        [-0.65 + n * 0.163, 0.697, -1.46],
        [0.043, 0.023, 1.34],
        "dark",
        0x9da69f,
      );
    rod([-0.72, 0.77, -2.257], [0.72, 0.77, -2.257], 0.007, "dark");
    box([0, 0.87, -2.266], [0.22, 0.06, 0.028], "dark");
  }

  // Moulded wraparound bumpers, recessed grille and clean generic lighting.
  for (const [z, y] of [
    [2.282, 0.48],
    [-2.245, 0.465],
  ]) {
    box([0, y, z], [1.86, 0.174, 0.155], "chrome", 0xffffff, [0, 0, 0], 0.062);
    box(
      [0, y - 0.002, z + Math.sign(z) * 0.083],
      [1.71, 0.067, 0.027],
      "dark",
      0xffffff,
      [0, 0, 0],
      0.012,
    );
  }
  box(
    [0, 0.727, 2.31],
    [0.89, 0.218, 0.033],
    "dark",
    0xffffff,
    [0, 0, 0],
    0.018,
  );
  for (let row = 0; row < 4; row++)
    box([0, 0.65 + row * 0.052, 2.335], [0.865, 0.015, 0.022], "chrome");
  for (const side of [-1, 1]) {
    box(
      [side * 0.638, 0.73, 2.277],
      [0.428, 0.213, 0.075],
      "chrome",
      0xffffff,
      [0, 0, 0],
      0.024,
    );
    box(
      [side * 0.638, 0.733, 2.322],
      [0.371, 0.166, 0.025],
      "lamp",
      0xe1e4d7,
      [0, 0, 0],
      0.012,
    );
    for (let flute = 0; flute < 7; flute++)
      box(
        [side * 0.638 - 0.145 + flute * 0.048, 0.733, 2.337],
        [0.006, 0.14, 0.004],
        "lamp",
        0xb9c8c8,
      );
    box(
      [side * 0.833, 0.597, 2.281],
      [0.13, 0.08, 0.033],
      "lamp",
      0xd99536,
      [0, 0, 0],
      0.012,
    );
    const tailWidth = pickup ? 0.18 : 0.36,
      tailHeight = pickup ? 0.34 : 0.15;
    box(
      [side * (pickup ? 0.772 : 0.643), pickup ? 0.764 : 0.767, -2.243],
      [tailWidth + 0.045, tailHeight + 0.045, 0.045],
      "chrome",
      0xffffff,
      [0, 0, 0],
      0.018,
    );
    box(
      [side * (pickup ? 0.772 : 0.643), pickup ? 0.764 : 0.767, -2.271],
      [tailWidth, tailHeight, 0.023],
      "lamp",
      0xa62c25,
      [0, 0, 0],
      0.012,
    );
    box([side * 0.474, 0.768, -2.286], [0.064, 0.086, 0.014], "lamp", 0xc2c8bd);
  }
  for (const z of [-2.302, 2.374]) {
    box([0, 0.625, z], [0.382, 0.175, 0.026], "dark");
    box(
      [0, 0.625, z + Math.sign(z) * 0.015],
      [0.331, 0.134, 0.014],
      "plate",
      0xc6c6b4,
    );
    for (let n = 0; n < 5; n++)
      box(
        [-0.104 + n * 0.052, 0.624, z + Math.sign(z) * 0.024],
        [0.022, 0.049, 0.005],
        "dark",
        0x848c88,
      );
  }
  // Fine panel creases, a trunk handle and exhaust make the rear view readable.
  if (!pickup) rod([-0.75, 0.985, -1.42], [0.75, 0.985, -1.42], 0.007, "dark");
  rod([-0.765, 0.996, 0.9], [0.765, 0.996, 0.9], 0.007, "dark");
  box([0, 0.86, -2.258], [0.16, 0.036, 0.023], "chrome");
  rod([0.59, 0.28, -1.92], [0.59, 0.28, -2.28], 0.039, "chrome", 0xb2b8b5, 10);
  cylinder([0, 0.32, -1.4], 0.07, 1.59, "dark", 8);

  let triangles = 0;
  for (const [finish, sources] of pieces) {
    const geometry = mergeGeometries(sources, false);
    for (const source of sources) source.dispose();
    if (!geometry)
      throw new Error(`Could not merge traffic ${finish} geometry`);
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    const mesh = new T.Mesh(geometry, materials[finish]);
    mesh.name = `${group.name} — ${finish}`;
    mesh.castShadow = finish !== "glass" && finish !== "lamp";
    mesh.receiveShadow = true;
    group.add(mesh);
    triangles += geometry.getAttribute("position").count / 3;
  }
  group.userData.trafficVisual = {
    variant: ["sedan", "wagon", "pickup"][type],
    triangles,
    draws: group.children.length,
    wheelRadius: 0.35,
    wheelCenters: [
      [-0.846, 0.35, -1.4],
      [0.846, 0.35, -1.4],
      [-0.846, 0.35, 1.4],
      [0.846, 0.35, 1.4],
    ],
    provenance:
      "Original procedural generic vehicle; no real marque, logo, or externally sourced model.",
  };
  let disposed = false;
  group.userData.dispose = () => {
    if (disposed) return;
    disposed = true;
    group.traverse((object) => {
      if (object instanceof T.Mesh) object.geometry.dispose();
    });
    for (const material of Object.values(materials)) material.dispose();
    group.clear();
  };
  return group;
}
