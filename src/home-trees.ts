import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { HomeFrame } from "./home-reference";

type P = [number, number, number];

/** Photo-positioned mature trees: the raised ranch stays visible below the crowns. */
export function buildHomeTrees(
  frame: HomeFrame,
  heightAt: (x: number, z: number) => number,
): T.Group {
  const group = new T.Group();
  group.name = "Home · three mature front lawn deciduous trees";
  group.matrix.set(
    frame.right[0],
    0,
    frame.back[0],
    frame.center[0],
    0,
    1,
    0,
    0,
    frame.right[1],
    0,
    frame.back[1],
    frame.center[1],
    0,
    0,
    0,
    1,
  );
  group.matrixAutoUpdate = false;
  let seed = 442023;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const up = new T.Vector3(0, 1, 0);
  const wood: T.BufferGeometry[] = [],
    foliage: T.BufferGeometry[] = [];
  // Original procedural bark: longitudinal fissures and weathered gray/lichen
  // patches. No street imagery is embedded or used as a runtime texture.
  const texWidth = 128,
    texHeight = 256;
  const pixels = new Uint8Array(texWidth * texHeight * 4);
  for (let y = 0; y < texHeight; y++) {
    for (let x = 0; x < texWidth; x++) {
      const w = x / texWidth,
        h = y / texHeight;
      const phase =
        w * Math.PI * 34 +
        Math.sin(h * 14 + w * 8) * 0.7 +
        Math.sin(h * 37 + w * 31) * 0.23;
      const crack = Math.pow(Math.max(0, Math.sin(phase)), 15);
      const scale = Math.sin(w * 71 + Math.sin(h * 49) * 0.6) * 0.036;
      const lichen =
        Math.max(
          0,
          Math.sin(w * 12 + h * 18) * Math.sin(w * 29 - h * 7) - 0.24,
        ) * 0.34;
      const value =
        0.52 + scale - crack * 0.24 + lichen + (random() - 0.5) * 0.075;
      const i = (y * texWidth + x) * 4;
      pixels[i] = Math.min(255, Math.max(0, Math.round(value * 244)));
      pixels[i + 1] = Math.min(
        255,
        Math.max(0, Math.round((value + lichen * 0.17) * 248)),
      );
      pixels[i + 2] = Math.min(
        255,
        Math.max(0, Math.round((value - lichen * 0.11) * 224)),
      );
      pixels[i + 3] = 255;
    }
  }
  const bark = new T.DataTexture(pixels, texWidth, texHeight, T.RGBAFormat);
  bark.colorSpace = T.SRGBColorSpace;
  bark.wrapS = bark.wrapT = T.RepeatWrapping;
  bark.magFilter = T.LinearFilter;
  bark.minFilter = T.LinearMipmapLinearFilter;
  bark.generateMipmaps = true;
  bark.anisotropy = 4;
  bark.needsUpdate = true;
  // Bump is linear height data. Keeping it separate avoids interpreting the
  // sRGB colour texture as a height field, and retains fine lichen colour.
  const barkHeight = bark.clone();
  barkHeight.name = "Home bark linear fissure height";
  barkHeight.colorSpace = T.NoColorSpace;
  barkHeight.needsUpdate = true;
  const barkMaterial = new T.MeshStandardMaterial({
    map: bark,
    bumpMap: barkHeight,
    bumpScale: 0.045,
    color: 0xe2e4d9,
    vertexColors: true,
    roughness: 0.97,
  });
  const budMaterial = new T.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 1,
    side: T.DoubleSide,
  });
  function normalize(geometry: T.BufferGeometry, color: T.Color) {
    const result = geometry.index ? geometry.toNonIndexed() : geometry;
    if (result !== geometry) geometry.dispose();
    const colors = new Float32Array(result.getAttribute("position").count * 3);
    for (let i = 0; i < colors.length; i += 3) color.toArray(colors, i);
    result.setAttribute("color", new T.BufferAttribute(colors, 3));
    return result;
  }
  function limb(
    a: T.Vector3,
    b: T.Vector3,
    radius: number,
    endRadius: number,
    tone = 1,
  ) {
    const length = a.distanceTo(b);
    if (length < 0.02) return;
    const sides =
      radius > 0.3 ? 16 : radius > 0.09 ? 10 : radius > 0.027 ? 6 : 4;
    const geometry = new T.CylinderGeometry(
      endRadius,
      radius,
      length,
      sides,
      radius > 0.09 ? 3 : 1,
      false,
    );
    if (radius > 0.09) {
      const p = geometry.getAttribute("position");
      for (let i = 0; i < p.count; i++) {
        const angle = Math.atan2(p.getZ(i), p.getX(i));
        const scale =
          1 +
          Math.sin(angle * 5 + p.getY(i) * 0.6) * 0.025 +
          Math.sin(angle * 9 - p.getY(i) * 0.8) * 0.012;
        p.setXYZ(i, p.getX(i) * scale, p.getY(i), p.getZ(i) * scale);
      }
      geometry.computeVertexNormals();
    }
    const uv = geometry.getAttribute("uv");
    for (let i = 0; i < uv.count; i++)
      uv.setXY(
        i,
        uv.getX(i) * Math.max(0.4, radius * 8),
        uv.getY(i) * Math.max(0.15, length * 0.45),
      );
    geometry.applyQuaternion(
      new T.Quaternion().setFromUnitVectors(up, b.clone().sub(a).normalize()),
    );
    geometry.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    wood.push(normalize(geometry, new T.Color(0xffffff).multiplyScalar(tone)));
  }
  const tips: T.Vector3[] = [];
  let treeTop = 0;
  function grow(
    start: T.Vector3,
    direction: T.Vector3,
    length: number,
    radius: number,
    depth: number,
    bearing: number,
  ) {
    const end = start.clone().addScaledVector(direction, length);
    // A slight kink at every fork gives old limbs an irregular, living contour.
    const middle = start
      .clone()
      .lerp(end, 0.56)
      .add(
        new T.Vector3(
          (random() - 0.5) * length * 0.085,
          length * 0.035,
          (random() - 0.5) * length * 0.085,
        ),
      );
    limb(start, middle, radius, radius * 0.77, 0.94 + random() * 0.1);
    limb(middle, end, radius * 0.77, radius * 0.51, 0.93 + random() * 0.12);
    treeTop = Math.max(treeTop, end.y);
    if (depth <= 0) {
      tips.push(end);
      // One shorter spur per terminal branch avoids an evenly repeating fork.
      const spur = middle
        .clone()
        .add(
          new T.Vector3(
            Math.sin(bearing + 0.75) * length * 0.3,
            length * 0.37,
            Math.cos(bearing + 0.75) * length * 0.3,
          ),
        );
      limb(middle, spur, radius * 0.42, radius * 0.13, 0.93);
      treeTop = Math.max(treeTop, spur.y);
      tips.push(spur);
      return;
    }
    const children = depth === 3 ? 3 : 2;
    for (let i = 0; i < children; i++) {
      const yaw =
        bearing +
        (i - (children - 1) / 2) * (0.65 + random() * 0.23) +
        (random() - 0.5) * 0.28;
      const lateral =
        depth > 1 ? 0.46 + random() * 0.18 : 0.62 + random() * 0.19;
      const next = new T.Vector3(
        Math.sin(yaw) * lateral,
        0.67 + random() * 0.22,
        Math.cos(yaw) * lateral,
      ).normalize();
      grow(
        end,
        next,
        length * (0.59 + random() * 0.12),
        radius * (0.47 + random() * 0.1),
        depth - 1,
        yaw,
      );
    }
  }
  const specifications = [
    {
      u: -10.4,
      v: -17,
      radius: 0.48,
      trunkHeight: 5.6,
      crownLength: 4.45,
      turn: 0.45,
    },
    {
      u: 4.5,
      v: -16,
      radius: 0.42,
      trunkHeight: 6.5,
      crownLength: 4.3,
      turn: 2.3,
    },
    {
      u: 9.5,
      v: -15,
      radius: 0.37,
      trunkHeight: 5.9,
      crownLength: 4.55,
      turn: 4.4,
    },
  ];
  const trees: Record<string, unknown>[] = [];
  for (let treeIndex = 0; treeIndex < specifications.length; treeIndex++) {
    const tree = specifications[treeIndex];
    const location = frame.point(tree.u, 0, tree.v);
    const y = heightAt(location.x, location.z);
    const base = new T.Vector3(tree.u, y - 0.06, tree.v);
    const tipStart = tips.length;
    treeTop = y;
    // Subtle lean and a root flare keep the exposed trunk from looking like a pole.
    const trunk = [
      base,
      base.clone().add(new T.Vector3(0.045, tree.trunkHeight * 0.28, -0.015)),
      base.clone().add(new T.Vector3(-0.07, tree.trunkHeight * 0.65, 0.12)),
      base.clone().add(new T.Vector3(0.09, tree.trunkHeight, 0.18)),
    ];
    limb(trunk[0], trunk[1], tree.radius * 1.23, tree.radius * 0.92, 0.97);
    limb(trunk[1], trunk[2], tree.radius * 0.92, tree.radius * 0.78, 1.05);
    limb(trunk[2], trunk[3], tree.radius * 0.78, tree.radius * 0.68, 1.03);
    for (let i = 0; i < 5; i++) {
      const angle = tree.turn + i * Math.PI * 0.4 + random() * 0.18;
      const rootEnd = base
        .clone()
        .add(
          new T.Vector3(
            Math.sin(angle) * (0.72 + random() * 0.35),
            0.13,
            Math.cos(angle) * (0.72 + random() * 0.35),
          ),
        );
      const rootWorld = frame.point(rootEnd.x, 0, rootEnd.z);
      rootEnd.y = heightAt(rootWorld.x, rootWorld.z) + 0.03;
      limb(
        base.clone().add(new T.Vector3(0, 0.45, 0)),
        rootEnd,
        tree.radius * 0.32,
        0.035,
        0.92,
      );
    }
    for (let fork = 0; fork < 3; fork++) {
      const angle = tree.turn + fork * 2.14;
      const direction = new T.Vector3(
        Math.sin(angle) * 0.34,
        0.94,
        Math.cos(angle) * 0.34,
      ).normalize();
      grow(
        trunk[3],
        direction,
        tree.crownLength * (fork === 1 ? 1.04 : 0.96),
        tree.radius * (fork === 1 ? 0.64 : 0.53),
        3,
        angle,
      );
    }
    // A few irregular secondary limbs emerge above the sightline to the house.
    for (let j = 0; j < 2; j++) {
      const angle = tree.turn + j * 2.8 + 1.1;
      const start = trunk[2].clone().lerp(trunk[3], 0.78 + j * 0.11);
      grow(
        start,
        new T.Vector3(
          Math.sin(angle) * 0.78,
          0.59,
          Math.cos(angle) * 0.78,
        ).normalize(),
        2.35,
        tree.radius * 0.24,
        2,
        angle,
      );
    }
    // Early-season buds and a handful of tiny leaves, well above the facade.
    for (let i = tipStart; i < tips.length; i++) {
      if (random() > 0.42) continue;
      const p = tips[i];
      const leaf = new T.IcosahedronGeometry(0.047 + random() * 0.029, 0);
      leaf.scale(0.6, 1.25, 0.8);
      leaf.rotateZ(random() * Math.PI);
      leaf.translate(p.x, p.y, p.z);
      foliage.push(
        normalize(leaf, new T.Color(random() > 0.58 ? 0x667147 : 0x796b47)),
      );
    }
    trees.push({
      id: `home-front-deciduous-${treeIndex + 1}`,
      type: "deciduous",
      seasonalState: "mostly leafless",
      position: [location.x, y, location.z],
      localPosition: [tree.u, tree.v],
      radiusMeters: tree.radius,
      heightMeters: Number((treeTop - y).toFixed(2)),
      bareTrunkHeightMeters: tree.trunkHeight,
      placement:
        "Approximate from owner supplied street photograph perspective; not survey measured",
    });
  }
  let triangles = 0;
  for (const [geometries, material, name] of [
    [wood, barkMaterial, "Gray fissured trunks and bare branching crowns"],
    [foliage, budMaterial, "Sparse early season buds"],
  ] as const) {
    if (!geometries.length) continue;
    const geometry = mergeGeometries([...geometries], false);
    for (const part of geometries) part.dispose();
    if (!geometry) continue;
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    triangles += geometry.getAttribute("position").count / 3;
    const mesh = new T.Mesh(geometry, material);
    mesh.name = `Home trees · ${name}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  group.userData.homeTrees = {
    source: "Owner supplied street photographs",
    coordinateConfidence:
      "Photo perspective estimates, not measured trunk coordinates",
    trees,
    triangles,
    drawCalls: group.children.length,
    drivewayPositionsShifted: false,
  };
  return group;
}
