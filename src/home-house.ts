import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { HOME_DETAIL, type HomeFrame } from "./home-reference";

type V = [number, number, number];
type Face = "front" | "right" | "back" | "left";
type Opening = {
  id: string;
  face: Face;
  center: number;
  width: number;
  bottom: number;
  top: number;
  kind: "paired" | "picture" | "single" | "door" | "slider";
  shutters?: boolean;
};
type Key =
  | "siding"
  | "foundation"
  | "trim"
  | "shutters"
  | "shutterShadow"
  | "roof"
  | "roofEdge"
  | "glass"
  | "interior"
  | "curtain"
  | "door"
  | "metal"
  | "brass"
  | "concrete";

/** Small repeatable material assets made here, rather than projecting reference photography. */
function surfaceTexture(kind: "shingle" | "concrete") {
  const size = 256;
  const pixels = new Uint8Array(size * size * 4);
  let state = 829741;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let y = 0; y < size; y++) {
    const course = Math.floor(y / 32);
    for (let x = 0; x < size; x++) {
      const at = (y * size + x) * 4;
      let intensity = 0.86 + random() * 0.22;
      if (kind === "shingle") {
        const seam = (x + (course % 2) * 32) % 64;
        if (y % 32 < 2 || (seam < 1 && y % 32 > 8)) intensity *= 0.57;
        intensity *=
          0.93 +
          ((course * 7 + Math.floor((x + (course % 2) * 32) / 64) * 3) % 9) *
            0.014;
      } else if (random() > 0.98) intensity *= 0.7;
      pixels[at] =
        pixels[at + 1] =
        pixels[at + 2] =
          Math.min(255, intensity * 255);
      pixels[at + 3] = 255;
    }
  }
  const texture = new T.DataTexture(pixels, size, size, T.RGBAFormat);
  texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.colorSpace = T.SRGBColorSpace;
  texture.magFilter = T.LinearFilter;
  texture.minFilter = T.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

/**
 * A single observed raised-ranch, with an intentionally asymmetric front elevation.
 * u is viewer-right from Beverly Drive, v runs toward the rear of the lot, y is world height.
 * Openings are cut out of both the structural wall and its individual siding courses.
 */
export function buildHomeHouse(frame: HomeFrame): T.Group {
  const group = new T.Group();
  group.name = "Home — observed raised ranch";
  const R = frame.width / 2;
  const F = -frame.depth / 2;
  const B = frame.depth / 2;
  const lower = frame.lowerFloorY;
  const upper = frame.upperFloorY;
  const eave = frame.eaveY;
  const ridge = frame.ridgeY;
  const wallBottom = Math.min(
    frame.foundationY ?? Infinity,
    frame.groundY - 0.32,
    lower - 0.25,
  );
  const frontDoorBottom = frame.entryFloorY;
  const frontDoorCenter = frame.width * (HOME_DETAIL.entryRatio - 0.5);
  const upperWindowBottom = upper + 0.81;
  const upperWindowTop = Math.min(eave - 0.25, upperWindowBottom + 1.42);
  const lowerWindowBottom = lower + 0.47;
  const lowerWindowTop = Math.min(upper - 0.25, lowerWindowBottom + 1.03);
  const openings: Opening[] = [
    {
      id: "front-upper-left",
      face: "front",
      center: -frame.width * 0.367,
      width: frame.width * 0.139,
      bottom: upperWindowBottom,
      top: upperWindowTop,
      kind: "paired",
      shutters: true,
    },
    {
      id: "front-upper-middle",
      face: "front",
      center: -frame.width * 0.056,
      width: frame.width * 0.13,
      bottom: upperWindowBottom,
      top: upperWindowTop,
      kind: "paired",
      shutters: true,
    },
    {
      id: "front-upper-picture",
      face: "front",
      center: frame.width * 0.338,
      width: frame.width * 0.181,
      bottom: upperWindowBottom,
      top: upperWindowTop,
      kind: "picture",
      shutters: true,
    },
    {
      id: "front-lower-left",
      face: "front",
      center: -frame.width * 0.368,
      width: frame.width * 0.142,
      bottom: lowerWindowBottom,
      top: lowerWindowTop,
      kind: "paired",
      shutters: true,
    },
    {
      id: "front-lower-middle",
      face: "front",
      center: -frame.width * 0.075,
      width: frame.width * 0.115,
      bottom: lowerWindowBottom,
      top: lowerWindowTop,
      kind: "paired",
      shutters: true,
    },
    {
      id: "front-lower-right",
      face: "front",
      center: frame.width * 0.337,
      width: frame.width * 0.124,
      bottom: lowerWindowBottom,
      top: lowerWindowTop,
      kind: "paired",
      shutters: true,
    },
    {
      id: "front-entry",
      face: "front",
      center: frontDoorCenter,
      width: 1.03,
      bottom: frontDoorBottom,
      top: frontDoorBottom + 2.08,
      kind: "door",
    },
    {
      id: "right-patio-red-door",
      face: "right",
      center: 1.2,
      width: 0.99,
      bottom: lower + 0.05,
      top: lower + 2.11,
      kind: "door",
    },
    {
      id: "right-deck-sliders",
      face: "right",
      center: 1.2,
      width: 2.26,
      bottom: upper + 0.04,
      top: Math.min(eave - 0.12, upper + 2.13),
      kind: "slider",
    },
    // Side/back window spacing is necessarily an approximation where the user's views are occluded.
    {
      id: "left-upper-window",
      face: "left",
      center: -frame.depth * 0.13,
      width: 1.05,
      bottom: upperWindowBottom,
      top: upperWindowTop,
      kind: "single",
    },
    {
      id: "rear-upper-left",
      face: "back",
      center: -frame.width * 0.28,
      width: 1.4,
      bottom: upperWindowBottom,
      top: upperWindowTop,
      kind: "paired",
    },
    {
      id: "rear-upper-middle",
      face: "back",
      center: frame.width * 0.02,
      width: 1.45,
      bottom: upperWindowBottom,
      top: upperWindowTop,
      kind: "paired",
    },
  ];

  const roofMap = surfaceTexture("shingle");
  const concreteMap = surfaceTexture("concrete");
  const materials: Record<Key, T.MeshStandardMaterial> = {
    siding: new T.MeshStandardMaterial({ color: 0xdcded6, roughness: 0.8 }),
    foundation: new T.MeshStandardMaterial({
      color: 0xb2b0a2,
      roughness: 1,
      map: concreteMap,
    }),
    trim: new T.MeshStandardMaterial({ color: 0xf2f1df, roughness: 0.64 }),
    shutters: new T.MeshStandardMaterial({ color: 0x69372d, roughness: 0.83 }),
    shutterShadow: new T.MeshStandardMaterial({
      color: 0x452c25,
      roughness: 0.93,
    }),
    roof: new T.MeshStandardMaterial({
      color: 0x695044,
      roughness: 0.94,
      map: roofMap,
      bumpMap: roofMap,
      bumpScale: 0.026,
    }),
    roofEdge: new T.MeshStandardMaterial({ color: 0x483e34, roughness: 0.96 }),
    glass: new T.MeshStandardMaterial({
      color: 0x728989,
      roughness: 0.2,
      metalness: 0.28,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
    }),
    interior: new T.MeshStandardMaterial({ color: 0x182523, roughness: 1 }),
    curtain: new T.MeshStandardMaterial({ color: 0xd7d4b7, roughness: 1 }),
    door: new T.MeshStandardMaterial({ color: 0x743c39, roughness: 0.69 }),
    metal: new T.MeshStandardMaterial({
      color: 0x212923,
      roughness: 0.58,
      metalness: 0.55,
    }),
    brass: new T.MeshStandardMaterial({
      color: 0x9e875d,
      roughness: 0.42,
      metalness: 0.64,
    }),
    concrete: new T.MeshStandardMaterial({
      color: 0xafa99c,
      roughness: 0.98,
      map: concreteMap,
    }),
  };
  const batches = new Map<
    string,
    { key: Key; cast: boolean; geometries: T.BufferGeometry[] }
  >();
  function add(geometry: T.BufferGeometry, key: Key, cast = true) {
    const signature = `${key}:${cast}`;
    let batch = batches.get(signature);
    if (!batch) batches.set(signature, (batch = { key, cast, geometries: [] }));
    const source = geometry.index ? geometry.toNonIndexed() : geometry;
    if (source !== geometry) geometry.dispose();
    if (!source.getAttribute("normal")) source.computeVertexNormals();
    if (!source.getAttribute("uv"))
      source.setAttribute(
        "uv",
        new T.BufferAttribute(
          new Float32Array(source.getAttribute("position").count * 2),
          2,
        ),
      );
    batch.geometries.push(source);
  }
  function box(
    key: Key,
    u: number,
    y: number,
    v: number,
    width: number,
    height: number,
    depth: number,
    rotation = 0,
    cast = true,
  ) {
    if (width <= 0 || height <= 0 || depth <= 0) return;
    const geometry = new T.BoxGeometry(width, height, depth);
    if (rotation) geometry.rotateY(rotation);
    geometry.translate(u, y, v);
    add(geometry, key, cast);
  }
  function triangles(
    key: Key,
    points: V[],
    indices: number[],
    cast = true,
    uvScale = 1,
  ) {
    const position: number[] = [],
      uv: number[] = [];
    for (const i of indices) {
      position.push(...points[i]);
      uv.push(points[i][0] / uvScale, points[i][2] / uvScale);
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute(
      "position",
      new T.Float32BufferAttribute(position, 3),
    );
    geometry.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
    geometry.computeVertexNormals();
    add(geometry, key, cast);
  }
  function facePoint(face: Face, s: number, y: number, offset: number): V {
    if (face === "front") return [s, y, F - offset];
    if (face === "back") return [s, y, B + offset];
    if (face === "right") return [R + offset, y, s];
    return [-R - offset, y, s];
  }
  function faceBox(
    face: Face,
    key: Key,
    center: number,
    y: number,
    width: number,
    height: number,
    depth: number,
    offset: number,
    cast = true,
  ) {
    const p = facePoint(face, center, y, offset);
    box(
      key,
      p[0],
      p[1],
      p[2],
      face === "front" || face === "back" ? width : depth,
      height,
      face === "front" || face === "back" ? depth : width,
      0,
      cast,
    );
  }
  const faceSpan = (face: Face) =>
    face === "front" || face === "back" ? frame.width : frame.depth;
  function wallPiece(
    face: Face,
    left: number,
    right: number,
    bottom: number,
    top: number,
    key: Key,
    depth: number,
    offset: number,
  ) {
    if (right - left > 0.001 && top - bottom > 0.001)
      faceBox(
        face,
        key,
        (left + right) / 2,
        (bottom + top) / 2,
        right - left,
        top - bottom,
        depth,
        offset,
      );
  }
  function clearSpans(face: Face, bottom: number, top: number) {
    let spans: [number, number][] = [[-faceSpan(face) / 2, faceSpan(face) / 2]];
    for (const opening of openings.filter(
      (o) =>
        o.face === face && o.bottom < top - 0.001 && o.top > bottom + 0.001,
    )) {
      const left = opening.center - opening.width / 2,
        right = opening.center + opening.width / 2;
      spans = spans.flatMap(([a, b]): [number, number][] =>
        b <= left || a >= right
          ? [[a, b]]
          : ([
              [a, Math.max(a, left)],
              [Math.min(b, right), b],
            ].filter(([s, e]) => e > s + 0.001) as [number, number][]),
      );
    }
    return spans;
  }

  for (const face of ["front", "right", "back", "left"] as Face[]) {
    // Break at every opening elevation so the structural shell leaves genuine holes.
    const elevations = [
      ...new Set([
        wallBottom,
        lower + 0.05,
        eave,
        ...openings
          .filter((o) => o.face === face)
          .flatMap((o) => [o.bottom, o.top]),
      ]),
    ].sort((a, b) => a - b);
    for (let i = 1; i < elevations.length; i++) {
      const bottom = elevations[i - 1],
        top = elevations[i];
      for (const [left, right] of clearSpans(face, bottom, top))
        wallPiece(
          face,
          left,
          right,
          bottom,
          top,
          bottom < lower + 0.05 ? "foundation" : "siding",
          0.17,
          -0.085,
        );
    }
    // Vinyl clapboards have an actual projecting lower lip and a narrow shadow joint.
    for (let bottom = lower + 0.06; bottom < eave; bottom += 0.175) {
      const top = Math.min(eave, bottom + 0.173);
      const cuts = [
        ...new Set([
          bottom,
          top,
          ...openings
            .filter((o) => o.face === face)
            .flatMap((o) => [o.bottom, o.top])
            .filter((y) => y > bottom && y < top),
        ]),
      ].sort((a, b) => a - b);
      for (let i = 1; i < cuts.length; i++) {
        for (const [left, right] of clearSpans(face, cuts[i - 1], cuts[i]))
          wallPiece(
            face,
            left,
            right,
            cuts[i - 1],
            cuts[i],
            "siding",
            0.018,
            0.018,
          );
      }
      for (const [left, right] of clearSpans(
        face,
        bottom,
        Math.min(top, bottom + 0.012),
      ))
        wallPiece(
          face,
          left,
          right,
          bottom,
          Math.min(top, bottom + 0.009),
          "trim",
          0.022,
          0.026,
        );
    }
    faceBox(
      face,
      "trim",
      0,
      eave - 0.028,
      faceSpan(face) + 0.07,
      0.1,
      0.05,
      0.055,
    );
    // Raised-ranch floor band: its interruption at the recessed entry is visible in the photos.
    for (const [left, right] of clearSpans(face, upper - 0.12, upper + 0.025))
      wallPiece(
        face,
        left,
        right,
        upper - 0.12,
        upper + 0.025,
        "trim",
        0.064,
        0.041,
      );
  }
  // White outside-corner channels hide the siding ends without broad featureless wall strips.
  for (const u of [-R, R])
    for (const v of [F, B])
      box("trim", u, (lower + eave) / 2, v, 0.09, eave - lower, 0.09);

  const renderedOpenings: Record<string, unknown>[] = [];
  function trimOpening(o: Opening) {
    const height = o.top - o.bottom;
    const surround = 0.078;
    for (const sign of [-1, 1])
      faceBox(
        o.face,
        "trim",
        o.center + sign * (o.width / 2 + surround / 2),
        (o.bottom + o.top) / 2,
        surround,
        height + surround * 2,
        0.088,
        0.052,
      );
    faceBox(
      o.face,
      "trim",
      o.center,
      o.top + surround / 2,
      o.width + surround * 2,
      surround,
      0.088,
      0.052,
    );
    faceBox(
      o.face,
      "trim",
      o.center,
      o.bottom - 0.035,
      o.width + surround * 2 + 0.07,
      0.074,
      0.17,
      0.061,
    );
    // A dark recess and narrow interior jambs make glass read as an opening, not a sticker.
    faceBox(
      o.face,
      "interior",
      o.center,
      (o.top + o.bottom) / 2,
      o.width,
      height,
      0.016,
      -0.31,
      false,
    );
    for (const sign of [-1, 1])
      faceBox(
        o.face,
        "trim",
        o.center + sign * (o.width / 2 - 0.018),
        (o.top + o.bottom) / 2,
        0.036,
        height,
        0.28,
        -0.12,
      );
    renderedOpenings.push({
      ...o,
      centerWorld: frame
        .point(...facePoint(o.face, o.center, (o.bottom + o.top) / 2, 0))
        .toArray(),
      glassRecessMeters: 0.073,
      structuralOpening: true,
    });
  }
  function glassPane(
    o: Opening,
    center: number,
    width: number,
    bottom: number,
    top: number,
  ) {
    faceBox(
      o.face,
      "glass",
      center,
      (bottom + top) / 2,
      Math.max(0.01, width - 0.02),
      Math.max(0.01, top - bottom - 0.02),
      0.006,
      -0.073,
      false,
    );
  }
  function shutters(o: Opening) {
    const width = Math.min(0.36, o.width * 0.22);
    const height = o.top - o.bottom + 0.065;
    for (const sign of [-1, 1]) {
      const center = o.center + sign * (o.width / 2 + 0.1 + width / 2);
      faceBox(
        o.face,
        "shutterShadow",
        center,
        (o.top + o.bottom) / 2,
        width,
        height,
        0.039,
        0.045,
      );
      for (const edge of [-1, 1])
        faceBox(
          o.face,
          "shutters",
          center + edge * (width / 2 - 0.025),
          (o.top + o.bottom) / 2,
          0.05,
          height,
          0.037,
          0.07,
        );
      for (const y of [o.bottom, (o.bottom + o.top) / 2, o.top])
        faceBox(o.face, "shutters", center, y, width, 0.063, 0.039, 0.072);
      for (let y = o.bottom + 0.09; y < o.top - 0.055; y += 0.068)
        faceBox(
          o.face,
          "shutters",
          center,
          y,
          width - 0.09,
          0.042,
          0.039,
          0.076,
        );
    }
  }
  function window(o: Opening) {
    trimOpening(o);
    const sash = 0.046;
    const h = o.top - o.bottom;
    const cy = (o.top + o.bottom) / 2;
    if (o.kind === "picture") {
      // Wide fixed central pane with narrow casements, and the visible cream vertical blind.
      const centerWidth = o.width * 0.61;
      const sideWidth = (o.width - centerWidth) / 2;
      glassPane(o, o.center, centerWidth, o.bottom, o.top);
      for (const sign of [-1, 1]) {
        const division = o.center + (sign * centerWidth) / 2;
        faceBox(o.face, "trim", division, cy, sash, h, 0.058, -0.032);
        glassPane(
          o,
          o.center + sign * (centerWidth / 2 + sideWidth / 2),
          sideWidth,
          o.bottom,
          o.top,
        );
        faceBox(
          o.face,
          "trim",
          o.center + sign * (centerWidth / 2 + sideWidth / 2),
          o.bottom + h * 0.48,
          sideWidth,
          sash * 0.7,
          0.049,
          -0.033,
        );
      }
      for (
        let s = o.center - centerWidth / 2 + 0.035;
        s < o.center + centerWidth / 2;
        s += 0.095
      )
        faceBox(
          o.face,
          "curtain",
          s,
          cy + 0.012,
          0.074,
          h - 0.11,
          0.018,
          -0.15,
          false,
        );
    } else if (o.kind === "slider") {
      for (const sign of [-1, 1])
        glassPane(
          o,
          o.center + (sign * o.width) / 4,
          o.width / 2,
          o.bottom,
          o.top,
        );
      faceBox(o.face, "trim", o.center, cy, 0.054, h, 0.064, -0.027);
      faceBox(
        o.face,
        "metal",
        o.center - 0.1,
        o.bottom + 1.03,
        0.028,
        0.17,
        0.035,
        0.018,
      );
      faceBox(
        o.face,
        "trim",
        o.center,
        o.bottom + 0.025,
        o.width,
        0.044,
        0.12,
        -0.014,
      );
      for (const sign of [-1, 1])
        faceBox(
          o.face,
          "curtain",
          o.center + sign * o.width * 0.41,
          cy,
          o.width * 0.14,
          h - 0.12,
          0.022,
          -0.17,
          false,
        );
    } else {
      const n = o.kind === "paired" ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const w = o.width / n;
        const s = o.center - o.width / 2 + w * (i + 0.5);
        glassPane(o, s, w, o.bottom, o.bottom + h * 0.5);
        glassPane(o, s, w, o.bottom + h * 0.5, o.top);
        faceBox(o.face, "trim", s, o.bottom + h * 0.5, w, sash, 0.052, -0.027);
        // Subdued half-drawn upper shades were visible through several front windows.
        faceBox(
          o.face,
          "curtain",
          s,
          o.top - h * 0.09,
          w - 0.065,
          h * 0.14,
          0.01,
          -0.19,
          false,
        );
      }
      if (n === 2) faceBox(o.face, "trim", o.center, cy, 0.07, h, 0.06, -0.024);
    }
    if (o.shutters) shutters(o);
  }
  function door(o: Opening) {
    trimOpening(o);
    const h = o.top - o.bottom;
    // Opaque lower panel and a real glazed upper opening, framed by the muted red storm door.
    faceBox(
      o.face,
      "door",
      o.center,
      o.bottom + h * 0.23,
      o.width - 0.055,
      h * 0.46,
      0.045,
      -0.024,
    );
    for (const sign of [-1, 1])
      faceBox(
        o.face,
        "door",
        o.center + sign * (o.width / 2 - 0.055),
        (o.top + o.bottom) / 2,
        0.065,
        h,
        0.05,
        -0.024,
      );
    faceBox(
      o.face,
      "door",
      o.center,
      o.top - 0.055,
      o.width,
      0.11,
      0.05,
      -0.024,
    );
    faceBox(
      o.face,
      "door",
      o.center,
      o.bottom + h * 0.47,
      o.width,
      0.075,
      0.05,
      -0.024,
    );
    glassPane(o, o.center, o.width - 0.13, o.bottom + h * 0.5, o.top - 0.11);
    faceBox(
      o.face,
      "door",
      o.center,
      o.bottom + 0.23,
      o.width - 0.18,
      0.055,
      0.06,
      0.002,
    );
    faceBox(
      o.face,
      "door",
      o.center,
      o.bottom + 0.77,
      o.width - 0.18,
      0.045,
      0.06,
      0.002,
    );
    for (const sign of [-1, 1])
      faceBox(
        o.face,
        "door",
        o.center + sign * (o.width / 2 - 0.095),
        o.bottom + 0.49,
        0.034,
        0.53,
        0.06,
        0.002,
      );
    faceBox(
      o.face,
      "brass",
      o.center + o.width * 0.34,
      o.bottom + 0.97,
      0.035,
      0.14,
      0.072,
      0.035,
    );
    faceBox(
      o.face,
      "metal",
      o.center,
      o.bottom + 0.024,
      o.width + 0.07,
      0.028,
      0.23,
      0.026,
    );
  }
  for (const opening of openings)
    opening.kind === "door" ? door(opening) : window(opening);

  // A modest recessed entry: no invented porch, front gable, or garage door.
  for (const sign of [-1, 1])
    faceBox(
      "front",
      "trim",
      frontDoorCenter + sign * 0.72,
      (upper + eave) / 2,
      0.075,
      eave - upper,
      0.056,
      0.075,
    );
  // Three shallow steps and broad top landing match the short approach in the reference.
  for (let step = 0; step < 3; step++) {
    const height = ((frontDoorBottom - lower) * (3 - step)) / 3;
    const depth = 0.63 + step * 0.31;
    box(
      "concrete",
      frontDoorCenter,
      lower + height / 2,
      F - depth / 2 - 0.02,
      1.57 + step * 0.09,
      height,
      depth,
    );
  }
  // Black wall lantern above the door: actual bracket, cap, glass and stem.
  const lanternBottom = frontDoorBottom + 2.83;
  faceBox(
    "front",
    "metal",
    frontDoorCenter,
    lanternBottom + 0.1,
    0.09,
    0.2,
    0.052,
    0.088,
  );
  faceBox(
    "front",
    "metal",
    frontDoorCenter,
    lanternBottom + 0.09,
    0.024,
    0.035,
    0.21,
    0.2,
  );
  faceBox(
    "front",
    "glass",
    frontDoorCenter,
    lanternBottom + 0.005,
    0.14,
    0.18,
    0.13,
    0.29,
    false,
  );
  for (const side of [-1, 1])
    faceBox(
      "front",
      "metal",
      frontDoorCenter + side * 0.078,
      lanternBottom + 0.005,
      0.014,
      0.22,
      0.15,
      0.29,
    );
  faceBox(
    "front",
    "metal",
    frontDoorCenter,
    lanternBottom - 0.11,
    0.18,
    0.023,
    0.17,
    0.29,
  );
  faceBox(
    "front",
    "metal",
    frontDoorCenter,
    lanternBottom + 0.13,
    0.21,
    0.041,
    0.2,
    0.29,
  );
  faceBox(
    "front",
    "metal",
    frontDoorCenter,
    lanternBottom + 0.19,
    0.045,
    0.075,
    0.05,
    0.29,
  );
  // The small spread-wing eagle above the red front door is a distinctive silhouette.
  const eagleY = frontDoorBottom + 2.49;
  const eagleOutline: [number, number][] = [
    [-0.31, 0.105],
    [-0.22, 0.075],
    [-0.13, 0.052],
    [-0.055, 0.007],
    [-0.027, 0.07],
    [0.014, 0.1],
    [0.07, 0.075],
    [0.025, 0.054],
    [0.054, 0.012],
    [0.13, 0.052],
    [0.22, 0.075],
    [0.31, 0.105],
    [0.21, -0.045],
    [0.095, -0.08],
    [0.018, -0.075],
    [0.032, -0.16],
    [-0.036, -0.16],
    [-0.019, -0.075],
    [-0.095, -0.08],
    [-0.21, -0.045],
  ];
  const eaglePoints = eagleOutline.map(([u, y]): V => [
    frontDoorCenter + u,
    eagleY + y,
    F - 0.092,
  ]);
  const eagleIndices = T.ShapeUtils.triangulateShape(
    eagleOutline.map((p) => new T.Vector2(...p)),
    [],
  ).flat();
  // Both sides retained because the local front winding points toward the street.
  triangles(
    "metal",
    eaglePoints,
    [...eagleIndices, ...[...eagleIndices].reverse()],
    true,
  );

  // Broad, low brown gable with the ridge parallel to the front facade.
  const overhang = 0.39;
  const roofU = R + overhang;
  const roofFront = F - overhang;
  const roofBack = B + overhang;
  triangles(
    "roof",
    [
      [-roofU, eave, roofFront],
      [roofU, eave, roofFront],
      [roofU, ridge, 0],
      [-roofU, ridge, 0],
    ],
    [0, 2, 1, 0, 3, 2],
    true,
    1.65,
  );
  triangles(
    "roof",
    [
      [-roofU, ridge, 0],
      [roofU, ridge, 0],
      [roofU, eave, roofBack],
      [-roofU, eave, roofBack],
    ],
    [0, 2, 1, 0, 3, 2],
    true,
    1.65,
  );
  // Actual triangular gable-end infill and clipped siding courses under the roof.
  for (const sign of [-1, 1]) {
    const face: Face = sign < 0 ? "left" : "right";
    const u = sign * R;
    const points: V[] = [
      [u, eave, F],
      [u, eave, B],
      [u, ridge, 0],
    ];
    triangles("siding", points, sign > 0 ? [0, 2, 1] : [0, 1, 2]);
    for (let y = eave + 0.065; y < ridge - 0.045; y += 0.175) {
      const half = B * (1 - (y - eave) / Math.max(0.1, ridge - eave));
      faceBox(
        face,
        "trim",
        0,
        y,
        Math.max(0.01, half * 2),
        0.009,
        0.025,
        0.027,
      );
    }
  }
  // Soffits, gutter trough, fascia, and downspouts keep the roof from floating above the wall.
  for (const v of [roofFront, roofBack]) {
    box(
      "trim",
      0,
      eave - 0.053,
      v + (v < 0 ? 0.13 : -0.13),
      roofU * 2,
      0.075,
      0.29,
    );
    box("trim", 0, eave - 0.024, v, roofU * 2 + 0.07, 0.18, 0.073);
    box(
      "trim",
      0,
      eave - 0.095,
      v + (v < 0 ? -0.075 : 0.075),
      roofU * 2 + 0.1,
      0.056,
      0.13,
    );
    box(
      "roofEdge",
      0,
      eave - 0.055,
      v + (v < 0 ? -0.081 : 0.081),
      roofU * 2,
      0.019,
      0.081,
    );
  }
  function beam(key: Key, a: V, b: V, thickness: number, width = thickness) {
    const start = new T.Vector3(...a),
      end = new T.Vector3(...b);
    const geometry = new T.BoxGeometry(width, start.distanceTo(end), thickness);
    geometry.applyQuaternion(
      new T.Quaternion().setFromUnitVectors(
        new T.Vector3(0, 1, 0),
        end.clone().sub(start).normalize(),
      ),
    );
    geometry.translate(...start.add(end).multiplyScalar(0.5).toArray());
    add(geometry, key);
  }
  for (const sign of [-1, 1]) {
    const u = sign * roofU;
    beam("trim", [u, eave - 0.04, roofFront], [u, ridge - 0.04, 0], 0.11, 0.14);
    beam("trim", [u, ridge - 0.04, 0], [u, eave - 0.04, roofBack], 0.11, 0.14);
    const downU = sign * (R - 0.04);
    box(
      "trim",
      downU,
      (lower + eave) / 2 - 0.06,
      F - 0.105,
      0.065,
      eave - lower - 0.08,
      0.065,
    );
    beam(
      "trim",
      [downU, eave - 0.09, roofFront - 0.055],
      [downU, eave - 0.38, F - 0.105],
      0.065,
    );
    beam(
      "trim",
      [downU, lower + 0.08, F - 0.105],
      [downU, lower + 0.025, F - 0.42],
      0.065,
    );
  }
  // Narrow capped flue behind the left roof slope, visible in both user-supplied front views.
  const flueU = -frame.width * 0.41;
  const flueV = frame.depth * 0.21;
  const roofAtFlue = ridge - (ridge - eave) * (flueV / roofBack);
  const flue = new T.CylinderGeometry(0.066, 0.066, 0.95, 10);
  flue.translate(flueU, roofAtFlue + 0.36, flueV);
  add(flue, "metal");
  const cap = new T.CylinderGeometry(0.112, 0.112, 0.055, 10);
  cap.translate(flueU, roofAtFlue + 0.86, flueV);
  add(cap, "metal");
  box("roofEdge", flueU, roofAtFlue + 0.022, flueV, 0.37, 0.055, 0.37);

  const transform = new T.Matrix4().makeBasis(
    new T.Vector3(frame.right[0], 0, frame.right[1]),
    new T.Vector3(0, 1, 0),
    new T.Vector3(frame.back[0], 0, frame.back[1]),
  );
  transform.setPosition(frame.center[0], 0, frame.center[1]);
  let trianglesCount = 0;
  for (const batch of batches.values()) {
    const geometry = mergeGeometries(batch.geometries, false);
    for (const source of batch.geometries) source.dispose();
    if (!geometry) throw new Error(`Unable to batch Home ${batch.key}`);
    geometry.applyMatrix4(transform);
    // Photo-facing u/v is left-handed in the map. Baking a reflection requires
    // swapping triangle vertices; normals were already inverse-transformed above.
    if (transform.determinant() < 0) {
      for (const attribute of Object.values(geometry.attributes)) {
        for (let vertex = 0; vertex < attribute.count; vertex += 3) {
          for (let component = 0; component < attribute.itemSize; component++) {
            const at = (vertex + 1) * attribute.itemSize + component;
            const other = (vertex + 2) * attribute.itemSize + component;
            const value = attribute.array[at];
            attribute.array[at] = attribute.array[other];
            attribute.array[other] = value;
          }
        }
        attribute.needsUpdate = true;
      }
    }
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    const mesh = new T.Mesh(geometry, materials[batch.key]);
    mesh.name = `Home ${batch.key}${batch.cast ? "" : " glazing/interior"}`;
    mesh.castShadow = batch.cast;
    mesh.receiveShadow = true;
    mesh.userData.homeMaterial = batch.key;
    mesh.userData.homeHouse = true;
    group.add(mesh);
    trianglesCount += geometry.getAttribute("position").count / 3;
  }
  // Keep metadata inspectable without per-frame work or preserving thousands of individual meshes.
  group.userData.homeHouse = {
    reference: "User-supplied three street-level views and direct description",
    frontFacing: "Beverly Drive",
    frontDoorOffsetFraction: HOME_DETAIL.entryRatio,
    frontDoorCenter: frame.point(frontDoorCenter, frontDoorBottom, F).toArray(),
    sideDoorCenterV: 1.2,
    sideDoorAlignedWithSliders: true,
    roof: {
      type: "low gable",
      ridgeParallelToFront: true,
      eaveY: eave,
      ridgeY: ridge,
    },
    observedFront: true,
    hiddenSideRearWindowSpacing: "approximate",
    openings: renderedOpenings,
    sidingCourseMeters: 0.175,
    lampAndEagle: true,
    shutters: "burgundy louvered",
    windowStyle:
      "paired double-hung and right picture window with vertical blinds",
    batches: group.children.length,
    triangles: trianglesCount,
  };
  return group;
}
