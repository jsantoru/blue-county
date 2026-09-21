import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { MapData } from "./types";
import {
  createPropertyClearance,
  polygonDistance,
} from "./property-footprints";
import { buildRiparianPlants, type RiparianPlant } from "./riparian-plants";
import { worldUV } from "./materials";

type XZ = [number, number];
interface Station {
  point: XZ;
  width: number;
  waterY: number;
  distance: number;
  fade: number;
}
interface Woodland {
  points: XZ[];
}
export interface BackyardData {
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  woodlands: Woodland[];
  stream: {
    id: string;
    name: string;
    stations: Station[];
    pointsXZ: XZ[];
    renderedLengthMeters: number;
  };
}
function randomGenerator() {
  let state = 61882;
  return () =>
    (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
}
function bankNormal(stations: Station[], i: number) {
  const a = stations[Math.max(0, i - 1)].point,
    b = stations[Math.min(stations.length - 1, i + 1)].point;
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[1] - a[1]) / length, -(b[0] - a[0]) / length] as XZ;
}
export function creekDistance(stations: Station[], x: number, z: number) {
  let result = { distance: Infinity, width: 0, waterY: 0 };
  for (let i = 1; i < stations.length; i++) {
    const a = stations[i - 1],
      b = stations[i],
      dx = b.point[0] - a.point[0],
      dz = b.point[1] - a.point[1];
    const t = Math.max(
      0,
      Math.min(
        1,
        ((x - a.point[0]) * dx + (z - a.point[1]) * dz) /
          (dx * dx + dz * dz || 1),
      ),
    );
    const d = Math.hypot(x - a.point[0] - dx * t, z - a.point[1] - dz * t);
    if (d < result.distance)
      result = {
        distance: d,
        width: a.width + (b.width - a.width) * t,
        waterY: a.waterY + (b.waterY - a.waterY) * t,
      };
  }
  return result;
}
function waterNormalTexture() {
  const size = 128,
    pixels = new Uint8Array(size * size * 4);
  for (let z = 0; z < size; z++)
    for (let x = 0; x < size; x++) {
      const a = (x / size) * Math.PI * 2,
        b = (z / size) * Math.PI * 2;
      const n = new T.Vector3(
        0.18 * Math.cos(a * 5 + b * 2) + 0.08 * Math.cos(a * 11 - b * 3),
        0.2 * Math.sin(b * 9 + a) + 0.06 * Math.sin(a * 7 + b * 13),
        1,
      ).normalize();
      const i = (z * size + x) * 4;
      pixels[i] = (n.x * 0.5 + 0.5) * 255;
      pixels[i + 1] = (n.y * 0.5 + 0.5) * 255;
      pixels[i + 2] = (n.z * 0.5 + 0.5) * 255;
      pixels[i + 3] = 255;
    }
  const texture = new T.DataTexture(pixels, size, size);
  texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.magFilter = T.LinearFilter;
  texture.minFilter = T.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/** Original, seamless litter texture: damp soil beneath irregular curled leaf fragments. */
function woodlandLitterTextures() {
  const size = 512,
    pixels = new Uint8Array(size * size * 4),
    relief = new Float32Array(size * size),
    random = randomGenerator();
  const wrap = (n: number) => ((n % size) + size) % size;
  for (let z = 0; z < size; z++)
    for (let x = 0; x < size; x++) {
      const i = (z * size + x) * 4;
      const mottling =
        Math.sin(
          (x / size) * Math.PI * 6 + Math.sin((z / size) * Math.PI * 4),
        ) *
          5 +
        Math.sin(((x + z) / size) * Math.PI * 12) * 3;
      const grain = (random() - 0.5) * 15;
      pixels[i] = 59 + mottling + grain;
      pixels[i + 1] = 48 + mottling * 0.75 + grain * 0.78;
      pixels[i + 2] = 34 + mottling * 0.45 + grain * 0.58;
      pixels[i + 3] = 255;
      relief[z * size + x] = random() * 0.055;
    }
  for (let leaf = 0; leaf < 650; leaf++) {
    const cx = Math.floor(random() * size),
      cz = Math.floor(random() * size),
      angle = random() * Math.PI * 2,
      cos = Math.cos(angle),
      sin = Math.sin(angle),
      length = 8 + random() * 17,
      width = length * (0.31 + random() * 0.19),
      extent = Math.ceil(length + 2),
      tone = random(),
      cr = 69 + tone * 38,
      cg = 48 + tone * 25,
      cb = 28 + tone * 16;
    for (let dz = -extent; dz <= extent; dz++)
      for (let dx = -extent; dx <= extent; dx++) {
        const u = (dx * cos + dz * sin) / length;
        if (Math.abs(u) >= 1) continue;
        const v = -dx * sin + dz * cos;
        const edge =
          width *
          Math.pow(1 - u * u, 0.66) *
          (1 + 0.12 * Math.sin(u * 15 + tone * 8));
        if (Math.abs(v) >= edge) continue;
        const x = wrap(cx + dx),
          z = wrap(cz + dz),
          index = z * size + x,
          i = index * 4;
        const rib = Math.abs(v) < 0.6 ? 7 : 0;
        const curl = 0.8 + (v / edge) * 0.12 + random() * 0.15;
        pixels[i] = cr * curl + rib;
        pixels[i + 1] = cg * curl + rib * 0.7;
        pixels[i + 2] = cb * curl + rib * 0.4;
        relief[index] = 0.1 + (1 - Math.abs(v) / edge) * 0.13;
      }
  }
  const normalPixels = new Uint8Array(size * size * 4);
  for (let z = 0; z < size; z++)
    for (let x = 0; x < size; x++) {
      const dx =
        relief[z * size + wrap(x + 1)] - relief[z * size + wrap(x - 1)];
      const dz =
        relief[wrap(z + 1) * size + x] - relief[wrap(z - 1) * size + x];
      const normal = new T.Vector3(-dx * 2.2, -dz * 2.2, 1).normalize();
      const i = (z * size + x) * 4;
      normalPixels[i] = (normal.x * 0.5 + 0.5) * 255;
      normalPixels[i + 1] = (normal.y * 0.5 + 0.5) * 255;
      normalPixels[i + 2] = (normal.z * 0.5 + 0.5) * 255;
      normalPixels[i + 3] = 255;
    }
  const albedo = new T.DataTexture(pixels, size, size),
    normal = new T.DataTexture(normalPixels, size, size);
  albedo.colorSpace = T.SRGBColorSpace;
  for (const texture of [albedo, normal]) {
    texture.wrapS = texture.wrapT = T.RepeatWrapping;
    texture.repeat.setScalar(1 / 1.45);
    texture.magFilter = T.LinearFilter;
    texture.minFilter = T.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 8;
    texture.needsUpdate = true;
  }
  return { albedo, normal };
}

function woodlandEdgeDistance(x: number, z: number, ring: XZ[]) {
  let minimum = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      b = ring[(i + 1) % ring.length],
      dx = b[0] - a[0],
      dz = b[1] - a[1];
    const t = Math.max(
      0,
      Math.min(
        1,
        ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1),
      ),
    );
    const px = x - a[0] - dx * t,
      pz = z - a[1] - dz * t;
    minimum = Math.min(minimum, px * px + pz * pz);
  }
  return Math.sqrt(minimum);
}

/** Source-positioned woods/creek with representative, explicitly unmeasured microhabitat. */
export class Backyard {
  readonly root = new T.Group();
  private normals = waterNormalTexture();
  private floorTextures: T.Texture[] = [];
  private plants?: T.Group;
  private nearDetail = new T.Group();
  private quality = "high";
  constructor(
    map: MapData,
    heightAt: (x: number, z: number) => number,
    groundGeometry: (ring: XZ[], offset: number) => T.BufferGeometry,
    materials: { gravel: T.MeshStandardMaterial; bark: T.MeshStandardMaterial },
  ) {
    this.root.name = "Home backyard · mapped Stony Creek and observed woods";
    const data = map.backyard as BackyardData | undefined;
    if (!data) return;
    const stations = data.stream.stations;
    const random = randomGenerator(),
      clear = createPropertyClearance(map);
    const inWoods = (x: number, z: number) =>
      data.woodlands.some((w) => polygonDistance(x, z, w.points) === 0);
    const buildings = (map.buildings ?? []).map((b) =>
      b.points.map((p: number[]) => [p[0], p[2]] as XZ),
    );
    const usable = (x: number, z: number, pad: number) =>
      inWoods(x, z) &&
      clear(x, z, pad) &&
      buildings.every((p: XZ[]) => polygonDistance(x, z, p) > pad + 1);
    const copyMaterial = (source: T.MeshStandardMaterial, color: number) => {
      const m = source.clone();
      m.color.set(color);
      m.onBeforeCompile = source.onBeforeCompile;
      m.customProgramCacheKey = source.customProgramCacheKey;
      return m;
    };
    // The verge material neutralizes its color in a custom shader. Forest soil
    // needs its own matte brown material rather than inheriting that bright gravel response.
    const litterTextures = woodlandLitterTextures();
    this.floorTextures.push(litterTextures.albedo, litterTextures.normal);
    const floorMaterial = new T.MeshStandardMaterial({
      name: "Matte woodland earth and curled leaf litter",
      color: 0xffffff,
      map: litterTextures.albedo,
      normalMap: litterTextures.normal,
      normalScale: new T.Vector2(0.15, 0.15),
      roughness: 1,
      metalness: 0,
      vertexColors: true,
      envMapIntensity: 0.025,
    });
    const floorMeshes: T.Mesh[] = [];
    for (const woodland of data.woodlands) {
      const geometry = groundGeometry(woodland.points, 0.014);
      worldUV(geometry);
      const p = geometry.getAttribute("position"),
        colors: number[] = [];
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i),
          z = p.getZ(i);
        const mottling =
          0.87 +
          0.09 * Math.sin(x * 0.74 + Math.sin(z * 0.4)) +
          0.065 * Math.sin(z * 1.31 - x * 0.3);
        const edge = Math.min(
          1,
          woodlandEdgeDistance(x, z, woodland.points) / 1.5,
        );
        const blend = edge * edge * (3 - 2 * edge);
        // Green earth at the observed lawn margin graduates to brown leaf litter;
        // the geometry and source boundary stay exactly where they were traced.
        new T.Color()
          .setRGB(0.48, 0.92, 0.46)
          .lerp(new T.Color().setRGB(1.0, 0.96, 0.9), blend)
          .multiplyScalar(mottling)
          .toArray(colors, i * 3);
      }
      geometry.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
      const mesh = new T.Mesh(geometry, floorMaterial);
      mesh.name = "Aerial woodland floor";
      mesh.receiveShadow = true;
      this.root.add(mesh);
      floorMeshes.push(mesh);
    }
    const waterVertices: number[] = [],
      waterUV: number[] = [];
    const side = (i: number, sign: number) => {
      const s = stations[i],
        n = bankNormal(stations, i);
      return [
        s.point[0] + n[0] * s.width * 0.5 * sign,
        s.waterY,
        s.point[1] + n[1] * s.width * 0.5 * sign,
      ];
    };
    for (let i = 1; i < stations.length; i++) {
      for (const [j, sign] of [
        [i - 1, -1],
        [i, 1],
        [i - 1, 1],
        [i - 1, -1],
        [i, -1],
        [i, 1],
      ]) {
        waterVertices.push(...side(j, sign));
        waterUV.push((sign + 1) * 0.5, stations[j].distance / 3.2);
      }
    }
    const waterGeometry = new T.BufferGeometry();
    waterGeometry.setAttribute(
      "position",
      new T.Float32BufferAttribute(waterVertices, 3),
    );
    waterGeometry.setAttribute("uv", new T.Float32BufferAttribute(waterUV, 2));
    waterGeometry.computeVertexNormals();
    const waterMaterial = new T.MeshPhysicalMaterial({
      color: 0x4b6860,
      roughness: 0.23,
      metalness: 0.08,
      clearcoat: 0.65,
      clearcoatRoughness: 0.18,
      normalMap: this.normals,
      normalScale: new T.Vector2(0.26, 0.26),
      envMapIntensity: 0.7,
      transparent: true,
      opacity: 0.83,
      depthWrite: false,
      side: T.DoubleSide,
    });
    const water = new T.Mesh(waterGeometry, waterMaterial);
    water.name = "Stony Creek · mapped water ribbon";
    water.receiveShadow = true;
    water.renderOrder = 2;
    this.root.add(water);

    const rocks: {
      x: number;
      y: number;
      z: number;
      scale: T.Vector3;
      tone: number;
    }[] = [];
    for (let i = 2; i < stations.length - 2; i += 2) {
      const s = stations[i],
        normal = bankNormal(stations, i);
      for (const sign of [-1, 1]) {
        const lateral = s.width / 2 + 0.2 + random() * 1.6;
        const x = s.point[0] + normal[0] * lateral * sign,
          z = s.point[1] + normal[1] * lateral * sign;
        if (!usable(x, z, 0.3)) continue;
        const radius = 0.12 + random() * 0.28;
        rocks.push({
          x,
          y: heightAt(x, z) + radius * 0.24,
          z,
          scale: new T.Vector3(radius * 1.45, radius * 0.62, radius),
          tone: random(),
        });
      }
      if (i % 6 === 0 && s.fade > 0.9) {
        const x = s.point[0] + (random() - 0.5) * s.width * 0.75,
          z = s.point[1] + (random() - 0.5) * 0.4;
        const radius = 0.15 + random() * 0.12;
        rocks.push({
          x,
          y: heightAt(x, z) + radius * 0.3,
          z,
          scale: new T.Vector3(radius * 1.2, radius * 0.75, radius),
          tone: random(),
        });
      }
    }
    const stoneGeometry = new T.DodecahedronGeometry(1, 1),
      stoneMaterial = copyMaterial(materials.gravel, 0x8b8b76);
    worldUV(stoneGeometry);
    const stones = new T.InstancedMesh(
        stoneGeometry,
        stoneMaterial,
        rocks.length,
      ),
      matrix = new T.Matrix4();
    rocks.forEach((rock, i) => {
      matrix.compose(
        new T.Vector3(rock.x, rock.y, rock.z),
        new T.Quaternion().setFromEuler(
          new T.Euler(random() * 0.3, random() * 6.28, random() * 0.3),
        ),
        rock.scale,
      );
      stones.setMatrixAt(i, matrix);
      stones.setColorAt(
        i,
        new T.Color().setRGB(
          0.67 + rock.tone * 0.25,
          0.7 + rock.tone * 0.2,
          0.57 + rock.tone * 0.22,
        ),
      );
    });
    stones.name = "Wet cobbles and mossy bank stones";
    stones.receiveShadow = true;
    stones.castShadow = true;
    stones.computeBoundingSphere();
    this.root.add(stones);

    const plants: RiparianPlant[] = [];
    const b = data.bounds;
    for (let z = b.minZ + 2; z < b.maxZ - 2; z += 3.3)
      for (let x = b.minX + 2; x < b.maxX - 2; x += 3.3) {
        const px = x + (random() - 0.5) * 2.8,
          pz = z + (random() - 0.5) * 2.8;
        if (random() > 0.61 || !usable(px, pz, 1.05)) continue;
        const creek = creekDistance(stations, px, pz);
        if (creek.distance < creek.width / 2 + 0.55) continue;
        const selection = random(),
          wet = creek.distance < 6;
        const kind: RiparianPlant["kind"] =
          selection < 0.065
            ? "sapling"
            : selection < 0.21
              ? "shrub"
              : wet && selection < 0.65
                ? "sedge"
                : "fern";
        plants.push({
          x: px,
          y: heightAt(px, pz),
          z: pz,
          kind,
          scale: 0.7 + random() * 0.55,
          yaw: random() * Math.PI * 2,
        });
      }
    this.plants = buildRiparianPlants(plants);
    this.root.add(this.plants);

    const litter: T.BufferGeometry[] = [],
      logs: T.BufferGeometry[] = [];
    for (let i = 0; i < 2400; i++) {
      const x = b.minX + random() * (b.maxX - b.minX),
        z = b.minZ + random() * (b.maxZ - b.minZ);
      if (!usable(x, z, 0.18)) continue;
      const creek = creekDistance(stations, x, z);
      if (creek.distance < creek.width / 2 + 0.25) continue;
      const leaf = new T.CircleGeometry(0.04 + random() * 0.055, 5);
      leaf.rotateX(-Math.PI / 2);
      leaf.rotateY(random() * 6.28);
      leaf.scale(1.6, 1, 0.8);
      leaf.translate(x, heightAt(x, z) + 0.042, z);
      litter.push(leaf);
    }
    for (let i = 0; i < 11; i++) {
      const x = b.minX + random() * (b.maxX - b.minX),
        z = b.minZ + random() * (b.maxZ - b.minZ),
        angle = random() * 6.28,
        length = 2.7 + random() * 3.5;
      const ex = x + Math.cos(angle) * length,
        ez = z + Math.sin(angle) * length;
      if (
        !usable(x, z, 1) ||
        !usable(ex, ez, 1) ||
        creekDistance(stations, x, z).distance < 4
      )
        continue;
      const start = new T.Vector3(x, heightAt(x, z) + 0.2, z),
        end = new T.Vector3(ex, heightAt(ex, ez) + 0.22, ez);
      const log = new T.CylinderGeometry(0.14, 0.21, start.distanceTo(end), 9);
      log.applyQuaternion(
        new T.Quaternion().setFromUnitVectors(
          new T.Vector3(0, 1, 0),
          end.clone().sub(start).normalize(),
        ),
      );
      log.translate(...start.add(end).multiplyScalar(0.5).toArray());
      logs.push(log);
    }
    const addMerged = (
      geometries: T.BufferGeometry[],
      material: T.Material,
      name: string,
    ) => {
      if (!geometries.length) {
        material.dispose();
        return;
      }
      const merged = mergeGeometries(geometries, false)!;
      geometries.forEach((g) => g.dispose());
      const mesh = new T.Mesh(merged, material);
      mesh.name = name;
      mesh.receiveShadow = true;
      this.nearDetail.add(mesh);
    };
    addMerged(
      litter,
      new T.MeshStandardMaterial({
        color: 0x8e734d,
        roughness: 1,
        side: T.DoubleSide,
      }),
      "Scattered oak-like leaf litter",
    );
    addMerged(
      logs,
      copyMaterial(materials.bark, 0x787060),
      "Fallen woodland limbs",
    );
    this.root.add(this.nearDetail);
    this.root.userData.backyard = {
      streamId: data.stream.id,
      streamName: data.stream.name,
      stations: stations.map((s) => ({
        point: s.point,
        width: s.width,
        waterY: s.waterY,
        fade: s.fade,
      })),
      waterTriangles: waterVertices.length / 9,
      woodlandPolygons: data.woodlands.length,
      woodlandFloorTriangles: floorMeshes.reduce(
        (n, m) => n + m.geometry.getAttribute("position").count / 3,
        0,
      ),
      plants: this.plants.userData.riparianPlants,
      plantPositions: plants.map((p) => ({ x: p.x, z: p.z, kind: p.kind })),
      stones: rocks.length,
      fallenLimbs: logs.length,
      leafFragments: litter.length,
      forestFloor:
        "Original 1.45 m tiled brown leaf litter; matte material; 1.5 m green-earth edge blend",
      limits:
        "Mapped flowline and aerial forest edge; channel cross-section, plants, rocks and fallen wood are representative.",
    };
  }
  update(time: number, camera: T.Camera) {
    this.normals.offset.set(Math.sin(time * 0.05) * 0.015, -time * 0.023);
    this.nearDetail.visible =
      this.quality !== "low" &&
      camera.position.x < 240 &&
      camera.position.x > -100 &&
      Math.abs(camera.position.z) < 220;
  }
  setQuality(quality: string) {
    this.quality = quality;
    if (this.plants)
      for (const child of this.plants.children)
        if (child instanceof T.InstancedMesh) {
          const full =
            child.userData.fullCount ??
            (child.userData.fullCount = child.count);
          child.count = Math.ceil(
            full * (quality === "low" ? 0.45 : quality === "medium" ? 0.72 : 1),
          );
        }
  }
  dispose() {
    this.normals.dispose();
    this.floorTextures.forEach((texture) => texture.dispose());
    this.floorTextures.length = 0;
    this.root.traverse((o) => {
      if (o instanceof T.InstancedMesh) o.dispose();
    });
  }
}
