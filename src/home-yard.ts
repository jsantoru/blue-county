import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { buildHomeProps, homePropsReady } from "./home-props";
import { createHomeSurface, homeSurfaceUV, homeWoodUV } from "./home-surface";
import {
  HOME_DETAIL,
  homeDeckOutline,
  homePatioOutline,
  homeFrontWalk,
  type HomeFrame,
} from "./home-reference";

type P = [number, number, number];
type UV = [number, number];
type Surface =
  "wood" | "concrete" | "mulch" | "metal" | "screen" | "roof" | "plant";

/** The owners' photographs and description replace the generic Home yard.
 * The hidden rear construction has representative dimensions, not a survey. */
export function buildHomeYard(
  frame: HomeFrame,
  heightAt: (x: number, z: number) => number,
  groundGeometry?: (ring: UV[], offset: number) => T.BufferGeometry,
): T.Group {
  const group = new T.Group();
  group.name = "Home · photo referenced yard and wraparound deck";
  const origin = frame.point(0, 0, 0);
  group.matrix.set(
    frame.right[0],
    0,
    frame.back[0],
    origin.x,
    0,
    1,
    0,
    0,
    frame.right[1],
    0,
    frame.back[1],
    origin.z,
    0,
    0,
    0,
    1,
  );
  group.matrixAutoUpdate = false;
  const batches = new Map<Surface, T.BufferGeometry[]>();
  const woodFinish = createHomeSurface("wood");
  const concreteFinish = createHomeSurface("concrete");
  const mulchFinish = createHomeSurface("mulch");
  const materials: Record<Surface, T.MeshStandardMaterial> = {
    wood: new T.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.91,
      ...woodFinish,
      normalScale: new T.Vector2(0.65, 0.65),
    }),
    concrete: new T.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.94,
      ...concreteFinish,
      normalScale: new T.Vector2(0.55, 0.55),
    }),
    mulch: new T.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 1,
      ...mulchFinish,
      normalScale: new T.Vector2(0.85, 0.85),
    }),
    metal: new T.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.6,
      metalness: 0.2,
    }),
    screen: new T.MeshStandardMaterial({
      color: 0x313832,
      roughness: 1,
      transparent: true,
      opacity: 0.29,
      side: T.DoubleSide,
      depthWrite: false,
      vertexColors: true,
    }),
    roof: new T.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.97,
    }),
    plant: new T.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 1,
    }),
  };
  let seed = 2917;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  function add(
    geometry: T.BufferGeometry,
    surface: Surface,
    color: number,
    variation = 0,
  ) {
    const normalized = geometry.index ? geometry.toNonIndexed() : geometry;
    if (normalized !== geometry) geometry.dispose();
    for (const attribute of Object.keys(normalized.attributes))
      if (
        attribute !== "position" &&
        attribute !== "normal" &&
        attribute !== "uv"
      )
        normalized.deleteAttribute(attribute);
    if (!normalized.hasAttribute("normal")) normalized.computeVertexNormals();
    if (surface !== "wood" || !normalized.hasAttribute("uv"))
      homeSurfaceUV(normalized, surface === "mulch" ? 0.7 : 1);
    const shade = new T.Color(color).multiplyScalar(
      1 + (random() - 0.5) * variation,
    );
    const colors = new Float32Array(
      normalized.getAttribute("position").count * 3,
    );
    for (let i = 0; i < colors.length; i += 3) shade.toArray(colors, i);
    normalized.setAttribute("color", new T.BufferAttribute(colors, 3));
    if (!batches.has(surface)) batches.set(surface, []);
    batches.get(surface)!.push(normalized);
  }
  function box(
    p: P,
    dimensions: P,
    surface: Surface,
    color: number,
    variation = 0,
  ) {
    const geometry = new T.BoxGeometry(...dimensions);
    if (surface === "wood") homeWoodUV(geometry);
    geometry.translate(...p);
    add(geometry, surface, color, variation);
  }
  function beam(
    a: P,
    b: P,
    width: number,
    depth: number,
    surface: Surface,
    color: number,
    variation = 0,
  ) {
    const start = new T.Vector3(...a),
      end = new T.Vector3(...b);
    const geometry = new T.BoxGeometry(width, start.distanceTo(end), depth);
    if (surface === "wood") homeWoodUV(geometry);
    geometry.applyQuaternion(
      new T.Quaternion().setFromUnitVectors(
        new T.Vector3(0, 1, 0),
        end.sub(start).normalize(),
      ),
    );
    geometry.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    add(geometry, surface, color, variation);
  }
  function cylinder(
    p: P,
    bottom: number,
    top: number,
    height: number,
    surface: Surface,
    color: number,
    segments = 8,
  ) {
    const geometry = new T.CylinderGeometry(top, bottom, height, segments);
    geometry.translate(...p);
    add(geometry, surface, color);
  }
  function twig(a: P, b: P, radius: number, color = 0x766952) {
    const start = new T.Vector3(...a),
      end = new T.Vector3(...b);
    const geometry = new T.CylinderGeometry(
      radius * 0.48,
      radius,
      start.distanceTo(end),
      5,
    );
    geometry.applyQuaternion(
      new T.Quaternion().setFromUnitVectors(
        new T.Vector3(0, 1, 0),
        end.sub(start).normalize(),
      ),
    );
    geometry.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    add(geometry, "plant", color, 0.18);
  }
  const ground = (u: number, v: number) => {
    const p = frame.point(u, 0, v);
    return heightAt(p.x, p.z);
  };
  const local = (x: number, z: number): UV => [
    (x - frame.center[0]) * frame.right[0] +
      (z - frame.center[1]) * frame.right[1],
    (x - frame.center[0]) * frame.back[0] +
      (z - frame.center[1]) * frame.back[1],
  ];
  const worldRing = (ring: UV[]) =>
    ring.map(([u, v]) => {
      const p = frame.point(u, 0, v);
      return [p.x, p.z];
    });
  function groundPatch(
    ring: UV[],
    surface: Surface,
    color: number,
    offset: number,
  ) {
    // The environment supplies exact terrain-facet clipping in local coordinates.
    // The lightweight corner-sampled fallback keeps isolated geometry tests usable.
    if (groundGeometry) {
      add(groundGeometry(ring, offset), surface, color, 0.07);
      return;
    }
    const shape = ring.map(([u, v]) => new T.Vector2(u, v));
    const indices = T.ShapeUtils.triangulateShape(shape, []);
    const vertices: number[] = [];
    for (const face of indices) {
      const [a, b, c] = face.map((i) => ring[i]);
      const cross =
        (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      for (const p of cross > 0 ? [a, c, b] : [a, b, c])
        vertices.push(p[0], ground(...p) + offset, p[1]);
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute(
      "position",
      new T.Float32BufferAttribute(vertices, 3),
    );
    add(geometry, surface, color, 0.07);
  }
  const front = -frame.depth / 2,
    right = frame.width / 2,
    back = frame.depth / 2;
  const deckY = frame.upperFloorY;
  const outer = right + HOME_DETAIL.sideDeckWidth,
    rear = back + HOME_DETAIL.rearDeckDepth;
  const deckOutline = homeDeckOutline(frame);
  const patioOutline = homePatioOutline(frame);
  const screenOutline: UV[] = [
    [-1.8, back],
    [3.4, back],
    [3.4, rear],
    [-1.8, rear],
  ];

  // Patio sits below the same right-side deck; its slab meets the owner's red door.
  box(
    [right + 1.35, frame.lowerFloorY - 0.065, (-0.65 + back) / 2],
    [2.7, 0.13, back + 0.65],
    "concrete",
    0xb6b3a8,
  );
  // The coarse terrain slopes below this level threshold. A closed perimeter
  // skirt grounds the slab instead of leaving its outside edge floating.
  for (let i = 0; i < patioOutline.length; i++) {
    const a = patioOutline[i],
      b = patioOutline[(i + 1) % patioOutline.length];
    const top = frame.lowerFloorY - 0.075;
    const bottomA = Math.min(top, ground(...a) - 0.05);
    const bottomB = Math.min(top, ground(...b) - 0.05);
    const vertices = [
      a[0],
      bottomA,
      a[1],
      b[0],
      bottomB,
      b[1],
      a[0],
      top,
      a[1],
      b[0],
      bottomB,
      b[1],
      b[0],
      top,
      b[1],
      a[0],
      top,
      a[1],
      a[0],
      top,
      a[1],
      b[0],
      bottomB,
      b[1],
      a[0],
      bottomA,
      a[1],
      a[0],
      top,
      a[1],
      b[0],
      top,
      b[1],
      b[0],
      bottomB,
      b[1],
    ];
    const skirt = new T.BufferGeometry();
    skirt.setAttribute("position", new T.Float32BufferAttribute(vertices, 3));
    add(skirt, "concrete", 0x97988a, 0.06);
  }
  for (let v = 0.5; v < back; v += 1.5)
    box(
      [right + 1.35, frame.lowerFloorY + 0.001, v],
      [2.7, 0.004, 0.012],
      "concrete",
      0x797b73,
    );

  // True individual boards, open underside, joists, rim beams, and weathered posts.
  const wood = 0x92745a,
    woodLight = 0xa78b6c,
    woodDark = 0x594b39;
  const boardWidth = 0.137,
    boardGap = 0.007;
  function boardedRect(u0: number, u1: number, v0: number, v1: number) {
    for (let v = v0; v < v1 - 0.01; v += boardWidth + boardGap) {
      const depth = Math.min(boardWidth, v1 - v);
      box(
        [(u0 + u1) / 2, deckY - 0.028, v + depth / 2],
        [u1 - u0, 0.056, depth],
        "wood",
        woodLight,
        0.22,
      );
      // Two small screw heads at each exposed support line.
      if (Math.round((v - v0) / (boardWidth + boardGap)) % 3 === 0)
        for (const u of [u0 + 0.075, u1 - 0.075])
          cylinder(
            [u, deckY + 0.002, v + depth / 2],
            0.009,
            0.009,
            0.003,
            "metal",
            0x625b4d,
            5,
          );
    }
    for (let u = u0 + 0.2; u < u1; u += 0.5)
      box(
        [u, deckY - 0.15, (v0 + v1) / 2],
        [0.048, 0.24, v1 - v0],
        "wood",
        woodDark,
        0.13,
      );
  }
  boardedRect(right, outer, -0.8, rear);
  boardedRect(-1.8, right - 0.008, back, rear);
  const supportLocations: UV[] = [
    [outer - 0.1, -0.7],
    [outer - 0.1, 2.1],
    [outer - 0.1, back],
    [outer - 0.1, rear - 0.1],
    [3.4, rear - 0.1],
    [-1.7, rear - 0.1],
  ];
  for (const [u, v] of supportLocations) {
    const y = Math.min(frame.lowerFloorY - 0.02, ground(u, v));
    box(
      [u, (y + deckY - 0.12) / 2, v],
      [0.145, deckY - 0.12 - y, 0.145],
      "wood",
      wood,
      0.17,
    );
    box([u, y + 0.025, v], [0.26, 0.05, 0.26], "concrete", 0x92958a);
    // Compact diagonal knees remain above the patio headspace.
    beam(
      [u, deckY - 0.73, v],
      [u - 0.45, deckY - 0.18, v],
      0.076,
      0.076,
      "wood",
      woodDark,
    );
    box([u, deckY - 0.22, v + 0.076], [0.065, 0.13, 0.012], "metal", 0x555348);
  }
  for (const [a, b] of [
    [
      [outer - 0.08, -0.8],
      [outer - 0.08, rear],
    ],
    [
      [-1.8, rear - 0.08],
      [outer, rear - 0.08],
    ],
    [
      [right, -0.8],
      [outer, -0.8],
    ],
  ] as [UV, UV][])
    beam(
      [a[0], deckY - 0.14, a[1]],
      [b[0], deckY - 0.14, b[1]],
      0.22,
      0.095,
      "wood",
      wood,
    );

  function railing(a: UV, b: UV) {
    const distance = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const count = Math.max(1, Math.ceil(distance / 1.5));
    for (let i = 0; i <= count; i++) {
      const u = a[0] + ((b[0] - a[0]) * i) / count,
        v = a[1] + ((b[1] - a[1]) * i) / count;
      box([u, deckY + 0.52, v], [0.092, 1.1, 0.092], "wood", wood, 0.1);
      box([u, deckY + 1.085, v], [0.123, 0.04, 0.123], "wood", woodLight);
    }
    for (const y of [deckY + 0.13, deckY + 0.98])
      beam([a[0], y, a[1]], [b[0], y, b[1]], 0.065, 0.065, "wood", wood);
    beam(
      [a[0], deckY + 1.05, a[1]],
      [b[0], deckY + 1.05, b[1]],
      0.045,
      0.13,
      "wood",
      woodLight,
    );
    const pickets = Math.ceil(distance / 0.125);
    for (let i = 1; i < pickets; i++)
      box(
        [
          a[0] + ((b[0] - a[0]) * i) / pickets,
          deckY + 0.56,
          a[1] + ((b[1] - a[1]) * i) / pickets,
        ],
        [0.034, 0.87, 0.034],
        "wood",
        wood,
        0.17,
      );
  }
  railing([right + 0.05, -0.75], [outer - 0.05, -0.75]);
  railing([outer - 0.05, -0.75], [outer - 0.05, rear - 0.05]);
  railing([3.5, rear - 0.05], [outer - 0.05, rear - 0.05]);

  // Rear roofed screen room, connected to the open deck by an actual doorway.
  const screenLow = deckY + 0.12,
    screenTop = deckY + 2.05;
  function screenWall(a: UV, b: UV, door = false) {
    const distance = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const panels = Math.ceil(distance / 1.3);
    for (let i = 0; i <= panels; i++) {
      const u = a[0] + ((b[0] - a[0]) * i) / panels,
        v = a[1] + ((b[1] - a[1]) * i) / panels;
      box(
        [u, (deckY + screenTop) / 2, v],
        [0.095, screenTop - deckY, 0.095],
        "wood",
        wood,
        0.12,
      );
    }
    beam(
      [a[0], screenTop, a[1]],
      [b[0], screenTop, b[1]],
      0.12,
      0.12,
      "wood",
      wood,
    );
    for (let i = 0; i < panels; i++) {
      const aa: UV = [
        a[0] + ((b[0] - a[0]) * i) / panels,
        a[1] + ((b[1] - a[1]) * i) / panels,
      ];
      const bb: UV = [
        a[0] + ((b[0] - a[0]) * (i + 1)) / panels,
        a[1] + ((b[1] - a[1]) * (i + 1)) / panels,
      ];
      if (door && i === 0) continue;
      beam(
        [aa[0], deckY + 0.87, aa[1]],
        [bb[0], deckY + 0.87, bb[1]],
        0.07,
        0.07,
        "wood",
        woodDark,
      );
      beam(
        [aa[0], screenLow, aa[1]],
        [bb[0], screenLow, bb[1]],
        0.09,
        0.07,
        "wood",
        wood,
      );
      const geometry = new T.BufferGeometry();
      geometry.setAttribute(
        "position",
        new T.Float32BufferAttribute(
          [
            aa[0],
            screenLow,
            aa[1],
            bb[0],
            screenLow,
            bb[1],
            aa[0],
            screenTop - 0.06,
            aa[1],
            bb[0],
            screenLow,
            bb[1],
            bb[0],
            screenTop - 0.06,
            bb[1],
            aa[0],
            screenTop - 0.06,
            aa[1],
          ],
          3,
        ),
      );
      add(geometry, "screen", 0xffffff);
      // Fine vertical screen seam detail survives without a moiré-prone dense mesh.
      for (let k = 1; k <= 6; k++) {
        const u = aa[0] + ((bb[0] - aa[0]) * k) / 7,
          v = aa[1] + ((bb[1] - aa[1]) * k) / 7;
        box(
          [u, (screenLow + screenTop) / 2, v],
          [0.007, screenTop - screenLow, 0.007],
          "metal",
          0x495045,
        );
      }
    }
  }
  screenWall([-1.8, back + 0.02], [-1.8, rear]);
  screenWall([-1.8, rear], [3.4, rear]);
  screenWall([3.4, back + 0.02], [3.4, rear], true);
  const roofHigh = frame.eaveY - 0.045,
    roofLow = screenTop + 0.045;
  const roofU0 = -2.02,
    roofU1 = 3.62,
    roofV0 = back - 0.07,
    roofV1 = rear + 0.22;
  const roofY = (v: number) =>
    roofHigh + ((roofLow - roofHigh) * (v - roofV0)) / (roofV1 - roofV0);
  const roofDeck = new T.BoxGeometry(
    roofU1 - roofU0,
    0.085,
    Math.hypot(roofV1 - roofV0, roofHigh - roofLow),
  );
  roofDeck.rotateX(Math.atan2(roofHigh - roofLow, roofV1 - roofV0));
  roofDeck.translate(
    (roofU0 + roofU1) / 2,
    (roofHigh + roofLow) / 2 - 0.048,
    (roofV0 + roofV1) / 2,
  );
  add(roofDeck, "wood", 0x70604b);
  for (let v = roofV0; v < roofV1; v += 0.17) {
    const v1 = Math.min(roofV1, v + 0.176);
    const geometry = new T.BufferGeometry();
    geometry.setAttribute(
      "position",
      new T.Float32BufferAttribute(
        [
          roofU0,
          roofY(v),
          v,
          roofU0,
          roofY(v1),
          v1,
          roofU1,
          roofY(v),
          v,
          roofU1,
          roofY(v),
          v,
          roofU0,
          roofY(v1),
          v1,
          roofU1,
          roofY(v1),
          v1,
        ],
        3,
      ),
    );
    add(geometry, "roof", 0x6d5b4e, 0.18);
  }
  for (const u of [roofU0, roofU1])
    beam(
      [u, roofHigh - 0.065, roofV0],
      [u, roofLow - 0.065, roofV1],
      0.13,
      0.09,
      "wood",
      0xc7c7b7,
    );
  beam(
    [roofU0, roofLow - 0.065, roofV1],
    [roofU1, roofLow - 0.065, roofV1],
    0.14,
    0.09,
    "wood",
    0xc7c7b7,
  );
  for (let u = roofU0 + 0.3; u < roofU1; u += 0.6)
    beam(
      [u, roofHigh - 0.1, roofV0],
      [u, roofLow - 0.1, roofV1],
      0.075,
      0.07,
      "wood",
      woodDark,
    );

  // Wide grass remains open. The photographs show low, discontinuous foundation
  // beds and leafless shrubs, not the generic continuous evergreen hedge.
  const doorU = frame.width * (HOME_DETAIL.entryRatio - 0.5);
  const leftBed: UV[] = [
    [-right - 0.2, front - 0.04],
    [doorU - 0.65, front - 0.04],
    [doorU - 0.8, front - 1.25],
    [-right + 0.6, front - 1.15],
    [-right - 0.4, front - 0.7],
  ];
  const rightBed: UV[] = [
    [doorU + 0.7, front - 0.04],
    [right + 0.25, front - 0.04],
    [right + 0.42, front - 1.15],
    [doorU + 0.9, front - 1.16],
  ];
  groundPatch(leftBed, "mulch", 0x665344, 0.043);
  groundPatch(rightBed, "mulch", 0x665344, 0.043);
  // A thin irregular stone edging, small enough to preserve the lawn silhouette.
  for (const bed of [leftBed, rightBed]) {
    const centroid: UV = [
      bed.reduce((sum, p) => sum + p[0], 0) / bed.length,
      bed.reduce((sum, p) => sum + p[1], 0) / bed.length,
    ];
    for (let i = 1; i < bed.length; i++) {
      const a = bed[i],
        b = bed[(i + 1) % bed.length];
      const count = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.3);
      for (let j = 0; j < count; j++) {
        const u = a[0] + ((b[0] - a[0]) * j) / count,
          v = a[1] + ((b[1] - a[1]) * j) / count;
        const rock = new T.IcosahedronGeometry(0.12 + random() * 0.035, 0);
        rock.scale(1.1, 0.48, 0.78);
        rock.rotateY(random() * Math.PI);
        rock.translate(u, ground(u, v) + 0.035, v);
        add(rock, "concrete", 0x918b7c, 0.2);
        // A few short grass blades soften the edge rather than filling the open lawn.
        const away = new T.Vector2(
          u - centroid[0],
          v - centroid[1],
        ).normalize();
        const gu = u + away.x * (0.15 + random() * 0.09);
        const gv = v + away.y * (0.15 + random() * 0.09);
        const gy = ground(gu, gv) + 0.01;
        for (let blade = 0; blade < 3; blade++) {
          const angle = random() * Math.PI * 2;
          const dx = Math.cos(angle) * 0.008,
            dz = Math.sin(angle) * 0.008;
          const h = 0.035 + random() * 0.045;
          const g = new T.BufferGeometry();
          g.setAttribute(
            "position",
            new T.Float32BufferAttribute(
              [
                gu - dx,
                gy,
                gv - dz,
                gu + dx,
                gy,
                gv + dz,
                gu + dz * 1.2,
                gy + h,
                gv - dx * 1.2,
                gu + dx,
                gy,
                gv + dz,
                gu - dx,
                gy,
                gv - dz,
                gu + dz * 1.2,
                gy + h,
                gv - dx * 1.2,
              ],
              3,
            ),
          );
          add(g, "plant", 0x657346, 0.22);
        }
      }
    }
    const minU = Math.min(...bed.map((p) => p[0])),
      maxU = Math.max(...bed.map((p) => p[0]));
    const minV = Math.min(...bed.map((p) => p[1])),
      maxV = Math.max(...bed.map((p) => p[1]));
    const contains = (u: number, v: number) => {
      let inside = false;
      for (let i = 0, j = bed.length - 1; i < bed.length; j = i++) {
        const a = bed[i],
          b = bed[j];
        if (
          a[1] > v !== b[1] > v &&
          u < ((b[0] - a[0]) * (v - a[1])) / (b[1] - a[1]) + a[0]
        )
          inside = !inside;
      }
      return inside;
    };
    // Sparse real bark chips sit on the fine textured bed, bringing its surface
    // off the terrain plane. They share the existing mulch draw call.
    for (let i = 0; i < (maxU - minU) * (maxV - minV) * 27; i++) {
      const u = minU + random() * (maxU - minU),
        v = minV + random() * (maxV - minV);
      if (!contains(u, v)) continue;
      const chip = new T.BoxGeometry(
        0.028 + random() * 0.052,
        0.007 + random() * 0.009,
        0.012 + random() * 0.021,
      );
      chip.rotateY(random() * Math.PI);
      chip.rotateZ((random() - 0.5) * 0.25);
      chip.translate(u, ground(u, v) + 0.05, v);
      add(chip, "mulch", random() > 0.5 ? 0x79624a : 0x4c4033, 0.22);
    }
  }
  function shrub(
    u: number,
    v: number,
    height: number,
    spread: number,
    green = false,
  ) {
    const y = ground(u, v) + 0.05;
    for (let j = 0; j < 9; j++) {
      const angle = random() * Math.PI * 2;
      const h = height * (0.6 + random() * 0.4),
        radius = spread * (0.35 + random() * 0.65);
      const branch: P = [
        u + Math.sin(angle) * radius * 0.62,
        y + h * 0.72,
        v + Math.cos(angle) * radius * 0.62,
      ];
      twig(
        [u + (random() - 0.5) * 0.14, y, v + (random() - 0.5) * 0.14],
        branch,
        0.019,
      );
      for (let k = 0; k < 3; k++) {
        const end: P = [
          u + Math.sin(angle + (k - 1) * 0.53) * radius,
          y + h * (0.8 + random() * 0.2),
          v + Math.cos(angle + (k - 1) * 0.53) * radius,
        ];
        twig(branch, end, 0.006);
        if (green) {
          const leaves = new T.IcosahedronGeometry(0.12 + random() * 0.08, 0);
          leaves.scale(1.05, 0.85, 1.1);
          leaves.translate(...end);
          add(leaves, "plant", 0x52613b, 0.35);
        } else if (random() < 0.32) {
          const bud = new T.IcosahedronGeometry(0.023 + random() * 0.015, 0);
          bud.scale(0.55, 1.45, 0.7);
          bud.translate(...end);
          add(bud, "plant", 0x81754e, 0.2);
        }
      }
    }
  }
  shrub(-right + 0.28, front - 0.6, 1.15, 0.48);
  shrub(-right * 0.28, front - 0.64, 1.5, 0.65);
  shrub(doorU - 1.25, front - 0.59, 1.77, 0.56);
  shrub(doorU + 1.35, front - 0.61, 1.13, 0.43);
  shrub(right + 0.28, front - 0.55, 0.85, 0.36);
  shrub(-right - 0.7, back * 0.28, 0.8, 0.52, true);

  // Concrete entry apron turns toward the driveway on the viewer's right.
  const pathV = front - 2.4,
    pathRight = right + 2.4;
  const pathOutline = homeFrontWalk(frame);
  groundPatch(pathOutline, "concrete", 0xc4c3b6, 0.083);
  for (let u = doorU + 1.5; u < pathRight - 0.2; u += 1.25)
    beam(
      [u, ground(u, pathV - 0.49) + 0.088, pathV - 0.49],
      [u, ground(u, pathV + 0.49) + 0.088, pathV + 0.49],
      0.012,
      0.012,
      "concrete",
      0x95988d,
    );

  const useHeroProps = homePropsReady();
  // Procedural fallback stays available for direct construction without preload.
  // Loaded Blender props use these same reference anchors, without duplicates.
  // Small green slatted bench below the front-right window.
  const benchU = right * 0.61,
    benchV = front - 0.56,
    benchY = ground(benchU, benchV);
  if (!useHeroProps) {
    for (const u of [benchU - 0.48, benchU + 0.48]) {
      for (const v of [benchV - 0.18, benchV + 0.18])
        beam(
          [u, benchY + 0.025, v],
          [u, benchY + 0.42, v],
          0.045,
          0.045,
          "metal",
          0x363d32,
        );
      beam(
        [u, benchY + 0.35, benchV + 0.17],
        [u, benchY + 0.89, benchV + 0.22],
        0.04,
        0.04,
        "metal",
        0x363d32,
      );
    }
    for (let i = 0; i < 4; i++) {
      box(
        [benchU, benchY + 0.43, benchV - 0.16 + i * 0.106],
        [1.29, 0.035, 0.078],
        "wood",
        0x596249,
        0.12,
      );
      box(
        [benchU, benchY + 0.58 + i * 0.092, benchV + 0.22],
        [1.29, 0.063, 0.03],
        "wood",
        0x596249,
        0.12,
      );
    }
  }
  // Wagon wheel resting against the lower front, slightly left of the entrance.
  const wheelU = -right * 0.34,
    wheelV = front - 0.18,
    wheelY = ground(wheelU, wheelV) + 0.45;
  if (!useHeroProps) {
    const wheel = new T.TorusGeometry(0.44, 0.032, 6, 28);
    wheel.translate(wheelU, wheelY, wheelV);
    add(wheel, "wood", 0x71674f);
    const rim = new T.TorusGeometry(0.46, 0.014, 5, 28);
    rim.translate(wheelU, wheelY, wheelV);
    add(rim, "metal", 0x595a50);
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      beam(
        [wheelU, wheelY, wheelV],
        [
          wheelU + Math.sin(angle) * 0.425,
          wheelY + Math.cos(angle) * 0.425,
          wheelV,
        ],
        0.024,
        0.024,
        "wood",
        0x71674f,
      );
    }
    const hub = new T.SphereGeometry(0.061, 8, 5);
    hub.scale(1, 1, 0.65);
    hub.translate(wheelU, wheelY, wheelV - 0.017);
    add(hub, "wood", 0x665d46);
  }
  // White tapered ornament/birdbath visible at the left foundation bed.
  const bathU = -right * 0.77,
    bathV = front - 1.15,
    bathY = ground(bathU, bathV);
  if (!useHeroProps) {
    cylinder(
      [bathU, bathY + 0.065, bathV],
      0.2,
      0.15,
      0.13,
      "concrete",
      0xd3d1be,
      10,
    );
    cylinder(
      [bathU, bathY + 0.32, bathV],
      0.105,
      0.075,
      0.45,
      "concrete",
      0xd7d7c7,
      10,
    );
    cylinder(
      [bathU, bathY + 0.585, bathV],
      0.09,
      0.22,
      0.12,
      "concrete",
      0xd3d3c1,
      12,
    );
    cylinder(
      [bathU, bathY + 0.649, bathV],
      0.215,
      0.215,
      0.018,
      "concrete",
      0x9c9e8f,
      12,
    );
  }
  // Match the mailbox and timber edge seen at the real driveway mouth.
  const route = [
    [-27.086, 33.351],
    [-20.937, 32.315],
    [-14.372, 30.864],
    [-8.223, 29.136],
    [-3.939, 26.787],
  ] as UV[];
  const mouth = route[0],
    direction = new T.Vector2(
      route[1][0] - mouth[0],
      route[1][1] - mouth[1],
    ).normalize();
  let normal: UV = [-direction.y, direction.x];
  if (
    (frame.center[0] - mouth[0]) * normal[0] +
      (frame.center[1] - mouth[1]) * normal[1] <
    0
  )
    normal = [-normal[0], -normal[1]];
  const mailboxWorld: UV = [
    mouth[0] + direction.x * 0.9 + normal[0] * 3.0,
    mouth[1] + direction.y * 0.9 + normal[1] * 3.0,
  ];
  const [mailU, mailV] = local(...mailboxWorld),
    mailY = heightAt(...mailboxWorld);
  if (!useHeroProps) {
    box(
      [mailU, mailY + 0.65, mailV],
      [0.105, 1.3, 0.105],
      "wood",
      0x91816a,
      0.16,
    );
    box(
      [mailU, mailY + 1.19, mailV - 0.11],
      [0.1, 0.11, 0.56],
      "wood",
      0x85745c,
    );
    box(
      [mailU, mailY + 0.15, mailV - 0.057],
      [0.12, 0.15, 0.021],
      "metal",
      0x8b4f39,
    );
    box(
      [mailU, mailY + 1.34, mailV - 0.1],
      [0.3, 0.235, 0.57],
      "metal",
      0x4f5548,
    );
    // Half cylinder roof gives the familiar rural U.S. mailbox silhouette.
    const rounded = new T.CylinderGeometry(
      0.15,
      0.15,
      0.57,
      14,
      1,
      false,
      -Math.PI / 2,
      Math.PI,
    );
    rounded.rotateX(-Math.PI / 2);
    rounded.translate(mailU, mailY + 1.458, mailV - 0.1);
    add(rounded, "metal", 0x53594d);
    box(
      [mailU, mailY + 1.365, mailV - 0.391],
      [0.26, 0.19, 0.012],
      "metal",
      0x5c6254,
    );
    box(
      [mailU, mailY + 1.45, mailV - 0.401],
      [0.052, 0.018, 0.02],
      "metal",
      0xabae9c,
    );
    box(
      [mailU + 0.161, mailY + 1.4, mailV - 0.05],
      [0.018, 0.028, 0.23],
      "metal",
      0xaf4436,
    );
    box(
      [mailU + 0.164, mailY + 1.447, mailV + 0.037],
      [0.02, 0.085, 0.071],
      "metal",
      0xb64e3e,
    );
    // White numeral 2 on both long sides, geometry rather than a blurred label.
    for (const side of [-1, 1]) {
      const x = mailU + side * 0.157,
        y = mailY + 1.365,
        z = mailV - 0.04;
      for (const [a, b] of [
        [
          [x, y + 0.052, z - 0.035],
          [x, y + 0.052, z + 0.03],
        ],
        [
          [x, y + 0.052, z + 0.03],
          [x, y + 0.01, z + 0.033],
        ],
        [
          [x, y + 0.01, z + 0.033],
          [x, y - 0.057, z - 0.034],
        ],
        [
          [x, y - 0.057, z - 0.034],
          [x, y - 0.057, z + 0.039],
        ],
      ] as [P, P][])
        beam(a, b, 0.012, 0.012, "metal", 0xd5d8cd);
    }
  }
  const heroProps = buildHomeProps({
    bench: [benchU, benchY, benchV],
    wagonWheel: [wheelU, wheelY, wheelV],
    birdbath: [bathU, bathY, bathV],
    mailbox: [mailU, mailY, mailV],
  });
  if (heroProps) group.add(heroProps);
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i],
      b = route[i + 1];
    const start = local(a[0] + normal[0] * 2.7, a[1] + normal[1] * 2.7);
    const end = local(b[0] + normal[0] * 2.7, b[1] + normal[1] * 2.7);
    beam(
      [start[0], ground(...start) + 0.05, start[1]],
      [end[0], ground(...end) + 0.05, end[1]],
      0.105,
      0.115,
      "wood",
      0x80725b,
      0.15,
    );
    const outsideA = local(a[0] + normal[0] * 4.1, a[1] + normal[1] * 4.1);
    const outsideB = local(b[0] + normal[0] * 4.1, b[1] + normal[1] * 4.1);
    groundPatch([start, end, outsideB, outsideA], "mulch", 0x65513c, 0.035);
  }
  shrub(mailU + 0.55, mailV + 0.85, 1.45, 0.61);

  let triangles = 0;
  for (const [surface, geometries] of batches) {
    const merged = mergeGeometries(geometries, false);
    for (const geometry of geometries) geometry.dispose();
    if (!merged) continue;
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    triangles += merged.getAttribute("position").count / 3;
    const mesh = new T.Mesh(merged, materials[surface]);
    mesh.name = `Home yard · ${surface}`;
    mesh.castShadow = surface !== "screen";
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  group.userData.homeYard = {
    source:
      "Owner supplied street photographs and explicit deck/patio/rear screen room description",
    rearDimensions: "Inferred; rear is hidden in the supplied photographs",
    deck: {
      points: worldRing(deckOutline),
      y: deckY,
      side: "right from road",
      wraparound: true,
    },
    patio: {
      points: worldRing(patioOutline),
      y: frame.lowerFloorY,
      belowDeck: true,
    },
    screenRoom: {
      points: worldRing(screenOutline),
      roofed: true,
      doorTowardSideDeck: true,
    },
    path: { points: worldRing(pathOutline), turnsTowardDriveway: true },
    frontBeds: [worldRing(leftBed), worldRing(rightBed)],
    mailbox: {
      position: [mailboxWorld[0], mailY, mailboxWorld[1]],
      number: "2",
      redFlag: true,
    },
    heroProps: heroProps?.userData.homeProps ?? null,
    ornaments: {
      bench: frame.point(benchU, benchY, benchV).toArray(),
      wagonWheel: frame.point(wheelU, wheelY, wheelV).toArray(),
      birdbath: frame.point(bathU, bathY, bathV).toArray(),
    },
    details: [
      "open lawn",
      "sparse dormant foundation shrubs",
      "front right bench",
      "wagon wheel",
      "white birdbath",
      "right turning concrete entry path",
      "driveway timber edging",
      "metre-scaled deck grain and porous concrete",
      "bark-chip mulch and short grass bed transition",
    ],
    triangles,
    drawCalls: group.children.length,
  };
  return group;
}
