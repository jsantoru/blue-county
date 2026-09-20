import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { MapData, Point, Road } from "./types";

export interface RoadsideMaterials {
  wood?: T.Material;
  bark?: T.Material;
  metal?: T.Material;
}

type HeightQuery = (x: number, z: number) => number;
type Pole = {
  x: number;
  y: number;
  z: number;
  height: number;
  heading: number;
  roadId: string;
  distance: number;
};
type Segment = {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  width: number;
};
type Envelope = { minX: number; minZ: number; maxX: number; maxZ: number };
type Batch = {
  material: T.Material;
  geometries: T.BufferGeometry[];
  name: string;
};

const UP = new T.Vector3(0, 1, 0);
const POLE_LIMIT = 100;
const TWO_PI = Math.PI * 2;

function hash(value: string) {
  let state = 2166136261;
  for (let i = 0; i < value.length; i++)
    state = Math.imul(state ^ value.charCodeAt(i), 16777619);
  return (state >>> 0) / 4294967296;
}

function sampleRoad(road: Road, cumulative: number[], distance: number) {
  let index = 1;
  while (index < cumulative.length - 1 && cumulative[index] < distance) index++;
  const a = road.points[index - 1],
    b = road.points[index];
  const length = cumulative[index] - cumulative[index - 1];
  const t = Math.max(
    0,
    Math.min(1, (distance - cumulative[index - 1]) / (length || 1)),
  );
  return {
    x: a[0] + (b[0] - a[0]) * t,
    z: a[2] + (b[2] - a[2]) * t,
    heading: Math.atan2(b[0] - a[0], b[2] - a[2]),
  };
}

/** Generic visual set dressing; placements are not surveyed utility infrastructure. */
export function buildRoadside(
  map: MapData,
  heightAt: HeightQuery,
  materials: RoadsideMaterials = {},
): T.Group {
  const root = new T.Group();
  root.name = "Approximate roadside utilities and rural details";
  root.userData.approximation =
    "Original generic US roadside props; placement is procedural, not surveyed. Visual only, no colliders.";
  root.userData.references = [
    "https://www.firstenergycorp.com/help/safety/facilities.html",
    "https://distribution.epri.com/overhead/public/deliverables/",
  ];

  const poleMaterial =
    materials.bark ??
    materials.wood ??
    new T.MeshStandardMaterial({ color: 0x75664e, roughness: 0.96 });
  const woodMaterial = materials.wood ?? poleMaterial;
  const metalMaterial =
    materials.metal ??
    new T.MeshStandardMaterial({
      color: 0x777c77,
      roughness: 0.73,
      metalness: 0.45,
    });
  const ceramicMaterial = new T.MeshStandardMaterial({
    color: 0x8b9181,
    roughness: 0.42,
    metalness: 0.05,
  });
  const wireMaterial = new T.MeshStandardMaterial({
    color: 0x252926,
    roughness: 0.94,
  });
  const stoneMaterial = new T.MeshStandardMaterial({
    color: 0x77766d,
    roughness: 0.98,
  });
  const ownedMaterials = [ceramicMaterial, wireMaterial, stoneMaterial];
  if (!materials.bark && !materials.wood)
    ownedMaterials.push(poleMaterial as T.MeshStandardMaterial);
  if (!materials.metal)
    ownedMaterials.push(metalMaterial as T.MeshStandardMaterial);

  // Four broad geographic chunks × at most six materials = at most 24 draws.
  const midpointX = (map.bounds.minX + map.bounds.maxX) / 2;
  const midpointZ = (map.bounds.minZ + map.bounds.maxZ) / 2;
  const batches = new Map<string, Batch>();
  const materialIds = new Map<T.Material, number>();
  const add = (
    geometry: T.BufferGeometry,
    material: T.Material,
    x: number,
    z: number,
    name: string,
  ) => {
    const materialId = materialIds.get(material) ?? materialIds.size;
    materialIds.set(material, materialId);
    const key = `${x >= midpointX ? 1 : 0}:${z >= midpointZ ? 1 : 0}:${materialId}`;
    if (!batches.has(key)) batches.set(key, { material, geometries: [], name });
    batches.get(key)!.geometries.push(geometry);
  };
  const cylinderBetween = (
    a: T.Vector3,
    b: T.Vector3,
    radius: number,
    material: T.Material,
    radial = 6,
  ) => {
    const direction = b.clone().sub(a),
      length = direction.length();
    if (length < 0.001) return;
    const geometry = new T.CylinderGeometry(radius, radius, length, radial);
    geometry.applyQuaternion(
      new T.Quaternion().setFromUnitVectors(UP, direction.normalize()),
    );
    geometry.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    add(geometry, material, a.x, a.z, "Roadside hardware");
  };
  const box = (
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    heading: number,
    material: T.Material,
  ) => {
    const geometry = new T.BoxGeometry(width, height, depth);
    // Physical-size UVs prevent every small rail from showing a whole texture tile.
    const position = geometry.getAttribute("position"),
      normal = geometry.getAttribute("normal"),
      uv = geometry.getAttribute("uv");
    for (let i = 0; i < position.count; i++) {
      if (Math.abs(normal.getY(i)) > 0.5)
        uv.setXY(i, position.getX(i), position.getZ(i));
      else if (Math.abs(normal.getX(i)) > 0.5)
        uv.setXY(i, position.getZ(i), position.getY(i));
      else uv.setXY(i, position.getX(i), position.getY(i));
    }
    geometry.rotateY(heading);
    geometry.translate(x, y, z);
    add(geometry, material, x, z, "Roadside wood and hardware");
  };

  const segments: Segment[] = [];
  for (const road of map.roads)
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1],
        b = road.points[i];
      segments.push({
        ax: a[0],
        az: a[2],
        bx: b[0],
        bz: b[2],
        width: road.width,
      });
    }
  const envelopes: Envelope[] = [];
  const surveyBounds = map.beverlySurvey?.bounds as Envelope | undefined;
  let surveyPlacementsSuppressed = 0;
  const intersectsSurvey = (ax: number, az: number, bx = ax, bz = az) => {
    if (!surveyBounds) return false;
    // Include crossarms, rocks, and rails; a wire span may cross the bounds even when both poles are outside.
    let enter = 0,
      exit = 1;
    for (const [a, b, low, high] of [
      [ax, bx, surveyBounds.minX - 1.5, surveyBounds.maxX + 1.5],
      [az, bz, surveyBounds.minZ - 1.5, surveyBounds.maxZ + 1.5],
    ]) {
      if (Math.abs(b - a) < 1e-9) {
        if (a < low || a > high) return false;
      } else {
        const t0 = (low - a) / (b - a),
          t1 = (high - a) / (b - a);
        enter = Math.max(enter, Math.min(t0, t1));
        exit = Math.min(exit, Math.max(t0, t1));
        if (enter > exit) return false;
      }
    }
    return true;
  };
  for (const building of map.buildings ?? []) {
    const points: Point[] = building.points ?? building.footprint;
    if (!points?.length) continue;
    envelopes.push({
      minX: Math.min(...points.map((p) => p[0])),
      maxX: Math.max(...points.map((p) => p[0])),
      minZ: Math.min(...points.map((p) => p[2])),
      maxZ: Math.max(...points.map((p) => p[2])),
    });
  }
  const clear = (
    x: number,
    z: number,
    roadMargin: number,
    buildingMargin = 2.5,
  ) => {
    if (intersectsSurvey(x, z)) {
      surveyPlacementsSuppressed++;
      return false;
    }
    if (
      x < map.bounds.minX + 12 ||
      x > map.bounds.maxX - 12 ||
      z < map.bounds.minZ + 12 ||
      z > map.bounds.maxZ - 12
    )
      return false;
    for (const e of envelopes)
      if (
        x > e.minX - buildingMargin &&
        x < e.maxX + buildingMargin &&
        z > e.minZ - buildingMargin &&
        z < e.maxZ + buildingMargin
      )
        return false;
    for (const s of segments) {
      const dx = s.bx - s.ax,
        dz = s.bz - s.az;
      const t = Math.max(
        0,
        Math.min(
          1,
          ((x - s.ax) * dx + (z - s.az) * dz) / (dx * dx + dz * dz || 1),
        ),
      );
      if (
        Math.hypot(x - s.ax - dx * t, z - s.az - dz * t) <
        s.width / 2 + roadMargin
      )
        return false;
    }
    return true;
  };

  const routeNames = new Set(map.route.streets);
  const roads = map.roads.filter(
    (road) =>
      road.name &&
      !road.bridge &&
      road.points.length > 2 &&
      (routeNames.has(road.name) || road.name === "Beverly Drive"),
  );
  const priority = (road: Road) =>
    road.name === "Beverly Drive"
      ? 0
      : road.name === "High Hill Avenue"
        ? 1
        : road.name === "Claire Ann Drive"
          ? 2
          : road.name === "Old Ridge Road"
            ? 3
            : 4;
  roads.sort(
    (a, b) =>
      priority(a) - priority(b) || String(a.id).localeCompare(String(b.id)),
  );
  const poles: Pole[] = [];
  let spanCount = 0,
    fenceCount = 0,
    stoneClusters = 0;

  for (const road of roads) {
    const cumulative = [0];
    for (let i = 1; i < road.points.length; i++)
      cumulative.push(
        cumulative[i - 1] +
          Math.hypot(
            road.points[i][0] - road.points[i - 1][0],
            road.points[i][2] - road.points[i - 1][2],
          ),
      );
    const total = cumulative[cumulative.length - 1];
    if (total < 180) continue;
    const seed = hash(String(road.id)),
      spacing = 58 + seed * 8,
      side = seed > 0.5 ? 1 : -1;
    let previous: Pole | null = null;
    for (
      let distance = 30 + seed * 8;
      distance < total - 24 && poles.length < POLE_LIMIT;
      distance += spacing
    ) {
      const sample = sampleRoad(road, cumulative, distance),
        rightX = Math.cos(sample.heading),
        rightZ = -Math.sin(sample.heading);
      const x = sample.x + rightX * side * (road.width / 2 + 3.5),
        z = sample.z + rightZ * side * (road.width / 2 + 3.5);
      if (
        !clear(x, z, 2.8) ||
        poles.some((p) => Math.hypot(p.x - x, p.z - z) < 30)
      ) {
        previous = null;
        continue;
      }
      const y = heightAt(x, z),
        height = 8.6 + hash(`${road.id}:${Math.round(distance)}`) * 0.9;
      const pole: Pole = {
        x,
        y,
        z,
        height,
        heading: sample.heading,
        roadId: String(road.id),
        distance,
      };
      poles.push(pole);

      const shaft = new T.CylinderGeometry(0.105, 0.18, height, 9, 2);
      const uv = shaft.getAttribute("uv");
      for (let i = 0; i < uv.count; i++)
        uv.setXY(i, uv.getX(i) * 0.9, uv.getY(i) * height);
      shaft.translate(x, y + height / 2, z);
      add(shaft, poleMaterial, x, z, "Utility poles");
      box(
        x,
        y + height - 0.42,
        z,
        2.15,
        0.13,
        0.17,
        sample.heading,
        woodMaterial,
      );
      for (const offset of [-0.88, 0, 0.88]) {
        const pinX = x + rightX * offset,
          pinZ = z + rightZ * offset;
        cylinderBetween(
          new T.Vector3(pinX, y + height - 0.36, pinZ),
          new T.Vector3(pinX, y + height - 0.07, pinZ),
          0.035,
          metalMaterial,
        );
        for (let tier = 0; tier < 3; tier++) {
          const insulator = new T.CylinderGeometry(
            0.078 - tier * 0.009,
            0.093 - tier * 0.009,
            0.055,
            7,
          );
          insulator.translate(pinX, y + height - 0.23 + tier * 0.061, pinZ);
          add(insulator, ceramicMaterial, x, z, "Utility insulators");
        }
      }
      for (const offset of [-0.73, 0.73])
        cylinderBetween(
          new T.Vector3(x, y + height - 1.03, z),
          new T.Vector3(
            x + rightX * offset,
            y + height - 0.46,
            z + rightZ * offset,
          ),
          0.026,
          metalMaterial,
          5,
        );
      if (poles.length % 11 === 4) {
        // A small generic pole transformer; no service drops into unverified houses.
        const tank = new T.CylinderGeometry(0.22, 0.22, 0.72, 10);
        tank.translate(
          x + rightX * side * 0.29,
          y + 6.2,
          z + rightZ * side * 0.29,
        );
        add(tank, metalMaterial, x, z, "Utility transformer cans");
      }

      if (previous) {
        const length = Math.hypot(x - previous.x, z - previous.z);
        const headingChange = Math.abs(
          Math.atan2(
            Math.sin(sample.heading - previous.heading),
            Math.cos(sample.heading - previous.heading),
          ),
        );
        const sag = 0.55 + length * 0.008;
        let adequateClearance =
          length < 85 &&
          headingChange < 0.7 &&
          !intersectsSurvey(previous.x, previous.z, x, z);
        for (let i = 1; i < 10 && adequateClearance; i++) {
          const t = i / 10,
            tx = previous.x + (x - previous.x) * t,
            tz = previous.z + (z - previous.z) * t;
          const wireY =
            previous.y +
            previous.height +
            (y + height - previous.y - previous.height) * t -
            sag * 4 * t * (1 - t);
          if (wireY < heightAt(tx, tz) + 5.8) adequateClearance = false;
        }
        if (adequateClearance) {
          for (const offset of [-0.88, 0, 0.88]) {
            const a = new T.Vector3(
              previous.x + Math.cos(previous.heading) * offset,
              previous.y + previous.height - 0.05,
              previous.z - Math.sin(previous.heading) * offset,
            );
            const b = new T.Vector3(
              x + rightX * offset,
              y + height - 0.05,
              z + rightZ * offset,
            );
            const mid = a.clone().lerp(b, 0.5);
            mid.y -= sag * 2;
            const geometry = new T.TubeGeometry(
              new T.QuadraticBezierCurve3(a, mid, b),
              12,
              0.018,
              4,
              false,
            );
            add(
              geometry,
              wireMaterial,
              (a.x + b.x) / 2,
              (a.z + b.z) / 2,
              "Sagging overhead conductors",
            );
          }
          spanCount++;
        }
      }
      previous = pole;

      if (poles.length % 7 === 3 && fenceCount < 14) {
        const setback = road.width / 2 + 6.3;
        const fenceX = sample.x - rightX * side * setback,
          fenceZ = sample.z - rightZ * side * setback;
        const forwardX = Math.sin(sample.heading),
          forwardZ = Math.cos(sample.heading),
          posts: T.Vector3[] = [];
        for (let i = 0; i < 5; i++) {
          const px = fenceX + (i - 2) * 2.7 * forwardX,
            pz = fenceZ + (i - 2) * 2.7 * forwardZ;
          if (!clear(px, pz, 4.8, 3.5)) {
            posts.length = 0;
            break;
          }
          posts.push(new T.Vector3(px, heightAt(px, pz), pz));
        }
        if (posts.length === 5) {
          for (const post of posts)
            box(
              post.x,
              post.y + 0.63,
              post.z,
              0.14,
              1.3,
              0.14,
              sample.heading,
              woodMaterial,
            );
          for (let i = 1; i < posts.length; i++)
            for (const h of [0.43, 0.91]) {
              const a = posts[i - 1].clone().add(new T.Vector3(0, h, 0)),
                b = posts[i].clone().add(new T.Vector3(0, h, 0));
              cylinderBetween(a, b, 0.06, woodMaterial, 4);
            }
          fenceCount++;
        }
      }
      if (poles.length % 17 === 6 && stoneClusters < 6) {
        const centerX = sample.x + rightX * side * (road.width / 2 + 5.4),
          centerZ = sample.z + rightZ * side * (road.width / 2 + 5.4);
        if (clear(centerX, centerZ, 4, 3.5)) {
          for (let i = 0; i < 7; i++) {
            const angle = (i / 7) * TWO_PI,
              rockX = centerX + Math.cos(angle) * 0.72,
              rockZ = centerZ + Math.sin(angle) * 0.54;
            const stone = new T.IcosahedronGeometry(0.25, 0);
            stone.scale(1.25, 0.65, 0.92);
            stone.rotateY(hash(`${road.id}:${i}`) * TWO_PI);
            stone.translate(rockX, heightAt(rockX, rockZ) + 0.1, rockZ);
            add(
              stone,
              stoneMaterial,
              rockX,
              rockZ,
              "Generic culvert-side stones",
            );
          }
          stoneClusters++;
        }
      }
    }
    if (poles.length >= POLE_LIMIT) break;
  }

  for (const [key, batch] of batches) {
    const geometry = mergeGeometries(batch.geometries, false);
    for (const original of batch.geometries) original.dispose();
    if (!geometry) continue;
    geometry.computeBoundingSphere();
    const mesh = new T.Mesh(geometry, batch.material);
    mesh.name = `${batch.name} ${key}`;
    mesh.castShadow = batch.material !== wireMaterial;
    mesh.receiveShadow = true;
    root.add(mesh);
  }
  root.userData.utilityPoles = poles;
  root.userData.statistics = {
    poles: poles.length,
    wireSpans: spanCount,
    fenceSections: fenceCount,
    stoneClusters,
    surveyPlacementsSuppressed,
    drawCalls: root.children.length,
  };
  root.userData.dispose = () => {
    root.traverse((object) => {
      if (object instanceof T.Mesh) object.geometry.dispose();
    });
    for (const material of ownedMaterials) material.dispose();
  };
  return root;
}
