import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { MapData } from "./types";

export type PropertyPoint = [number, number];
interface Evidence {
  id: string;
  address?: string;
  source?: string;
  confidence?: string;
}
interface FootprintFeature extends Evidence {
  /** Ordered perimeter in world X/Z meters; a repeated closing point is optional. */
  points: PropertyPoint[];
  /** Rendered height above the highest sampled ground under the footprint. */
  heightMeters?: number;
}
export interface DeckFeature extends FootprintFeature {
  kind: "deck";
  color?: number;
  /** Perimeter edge indices, in source order. No rails or stairs are inferred. */
  railEdges?: number[];
  railHeightMeters?: number;
  stairs?: { edgeIndex: number; widthMeters?: number; runMeters?: number };
}
export interface PoolFeature extends FootprintFeature {
  kind: "pool";
  form?: "in-ground" | "above-ground";
  surface?: "water" | "covered";
  copingWidthMeters?: number;
  coverColor?: number;
  waterColor?: number;
}
export interface PatioFeature extends FootprintFeature {
  kind: "patio";
  color?: number;
}
export type PropertyFeature = DeckFeature | PoolFeature | PatioFeature;
interface SignBase extends Evidence {
  position: PropertyPoint;
  /** Height of the sign/blade center above local terrain, not post length. */
  heightMeters?: number;
}
export interface StopSignFeature extends SignBase {
  kind: "stop";
  /** Front normal: +Z=0, +X=PI/2. For incoming travel h, use h+PI. */
  facingHeading: number;
  widthMeters?: number;
}
export interface StreetSignFeature extends SignBase {
  kind: "street";
  /** Both faces are lettered; heading is the first face's outward normal. */
  blades: { text: string; heading: number; widthMeters?: number }[];
}
export type RoadSignFeature = StopSignFeature | StreetSignFeature;
export interface PropertyDetailSurvey {
  propertyFeatures?: PropertyFeature[];
  roadSigns?: RoadSignFeature[];
}

type V = [number, number, number];
type HeightAt = (x: number, z: number) => number;
type MaterialKey =
  | "wood"
  | "stone"
  | "pool"
  | "water"
  | "cover"
  | "metal"
  | "sign"
  | "lettering";
const CELL = 256;
const UP = new T.Vector3(0, 1, 0);
const finitePoint = (p: unknown): p is PropertyPoint =>
  Array.isArray(p) &&
  p.length >= 2 &&
  Number.isFinite(p[0]) &&
  Number.isFinite(p[1]);
const bounded = (
  n: number | undefined,
  fallback: number,
  min: number,
  max: number,
) => (Number.isFinite(n) ? Math.min(max, Math.max(min, n!)) : fallback);
const cross = (a: PropertyPoint, b: PropertyPoint, c: PropertyPoint) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function polygon(points: PropertyPoint[]) {
  if (!Array.isArray(points) || points.some((p) => !finitePoint(p))) return [];
  const result = points.filter(
    (p, i) =>
      i === 0 ||
      Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) > 1e-5,
  );
  if (
    result.length > 1 &&
    Math.hypot(
      result[0][0] - result.at(-1)![0],
      result[0][1] - result.at(-1)![1],
    ) < 1e-5
  )
    result.pop();
  if (result.length < 3) return [];
  const area = result.reduce(
    (sum, p, i) =>
      sum +
      p[0] * result[(i + 1) % result.length][1] -
      p[1] * result[(i + 1) % result.length][0],
    0,
  );
  return Math.abs(area) > 0.04 ? result : [];
}
function inside(p: PropertyPoint, points: PropertyPoint[]) {
  let yes = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i],
      b = points[j];
    if (
      Math.abs(cross(a, b, p)) < 1e-7 &&
      p[0] >= Math.min(a[0], b[0]) - 1e-7 &&
      p[0] <= Math.max(a[0], b[0]) + 1e-7 &&
      p[1] >= Math.min(a[1], b[1]) - 1e-7 &&
      p[1] <= Math.max(a[1], b[1]) + 1e-7
    )
      return true;
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      yes = !yes;
  }
  return yes;
}
function overlaps(a: PropertyPoint[], b: PropertyPoint[]) {
  if (a.some((p) => inside(p, b)) || b.some((p) => inside(p, a))) return true;
  return a.some((p, i) =>
    b.some((q, j) => {
      const p2 = a[(i + 1) % a.length],
        q2 = b[(j + 1) % b.length];
      return (
        cross(p, p2, q) * cross(p, p2, q2) < 0 &&
        cross(q, q2, p) * cross(q, q2, p2) < 0
      );
    }),
  );
}
function clipped(
  points: PropertyPoint[],
  distance: (p: PropertyPoint) => number,
) {
  const result: PropertyPoint[] = [];
  let previous = points.at(-1)!,
    d0 = distance(previous);
  for (const p of points) {
    const d1 = distance(p);
    if (d0 >= 0 !== d1 >= 0) {
      const t = d0 / (d0 - d1);
      result.push([
        previous[0] + (p[0] - previous[0]) * t,
        previous[1] + (p[1] - previous[1]) * t,
      ]);
    }
    if (d1 >= 0) result.push(p);
    previous = p;
    d0 = d1;
  }
  return result;
}
function planar(points: PropertyPoint[], y: number | HeightAt) {
  const positions: number[] = [];
  const triangles = T.ShapeUtils.triangulateShape(
    points.map((p) => new T.Vector2(...p)),
    [],
  );
  for (const triangle of triangles) {
    // X/Z has the opposite handedness to a usual X/Y contour: top normals must be +Y.
    const [a, b, c] = triangle.map((i) => points[i]);
    const top = cross(a, b, c) > 0 ? [a, c, b] : [a, b, c];
    for (const p of top)
      positions.push(p[0], typeof y === "number" ? y : y(...p), p[1]);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function detailedSurface(
  points: PropertyPoint[],
  heightAt: HeightAt,
  spacing: number,
) {
  const vertices: number[] = [];
  const triangles = T.ShapeUtils.triangulateShape(
    points.map((p) => new T.Vector2(...p)),
    [],
  );
  const append = (a: PropertyPoint, b: PropertyPoint, c: PropertyPoint) => {
    for (const point of cross(a, b, c) > 0 ? [a, c, b] : [a, b, c])
      vertices.push(point[0], heightAt(...point), point[1]);
  };
  for (const triangle of triangles) {
    const [a, b, c] = triangle.map((i) => points[i]);
    const count = Math.max(
      1,
      Math.ceil(
        Math.max(
          Math.hypot(a[0] - b[0], a[1] - b[1]),
          Math.hypot(a[0] - c[0], a[1] - c[1]),
        ) / spacing,
      ),
    );
    const p = (i: number, j: number): PropertyPoint => [
      a[0] + ((b[0] - a[0]) * i) / count + ((c[0] - a[0]) * j) / count,
      a[1] + ((b[1] - a[1]) * i) / count + ((c[1] - a[1]) * j) / count,
    ];
    for (let i = 0; i < count; i++)
      for (let j = 0; j < count - i; j++) {
        append(p(i, j), p(i + 1, j), p(i, j + 1));
        if (j < count - i - 1)
          append(p(i + 1, j), p(i + 1, j + 1), p(i, j + 1));
      }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** Only supplied evidence is rendered. Vertical defaults are recorded as approximations. */
export function buildPropertyDetails(
  map: MapData,
  heightAt: HeightAt,
): T.Group {
  const root = new T.Group();
  root.name = "Observed property details and mapped road signs";
  const survey = map.beverlySurvey as PropertyDetailSurvey | undefined;
  const records: Record<string, unknown>[] = [],
    signs: Record<string, unknown>[] = [],
    omitted: { id: string; reason: string }[] = [];
  const stats = {
    decks: 0,
    pools: 0,
    patios: 0,
    stopSigns: 0,
    streetSigns: 0,
    stairs: 0,
    drawCalls: 0,
    triangles: 0,
  };
  root.userData.propertyDetails = {
    features: records,
    signs,
    omitted,
    verticals:
      "Footprints and centers follow survey data. Unmeasured heights, member sizes and surface finishes are representative; no terrain excavation or physical colliders.",
  };
  root.userData.statistics = stats;
  const batches = new Map<
    string,
    {
      geometries: T.BufferGeometry[];
      material: T.MeshStandardMaterial;
      name: string;
    }
  >();
  const materials = new Map<MaterialKey, T.MeshStandardMaterial>();
  const getMaterial = (key: MaterialKey) => {
    if (!materials.has(key)) {
      const parameters: T.MeshStandardMaterialParameters = {
        vertexColors: true,
        roughness: 0.82,
      };
      if (key === "metal")
        Object.assign(parameters, { roughness: 0.48, metalness: 0.65 });
      if (key === "pool")
        Object.assign(parameters, { roughness: 0.5, metalness: 0.12 });
      if (key === "water")
        Object.assign(parameters, {
          roughness: 0.17,
          metalness: 0.02,
          envMapIntensity: 0.85,
        });
      if (key === "sign" || key === "lettering")
        Object.assign(parameters, { roughness: 0.6, metalness: 0.08 });
      const material = new T.MeshStandardMaterial(parameters);
      material.name = `Property ${key}`;
      if (key === "water" || key === "stone") {
        // Static world-space shading adds no texture resources, animation or passes.
        material.customProgramCacheKey = () => `property-${key}-surface-v1`;
        material.onBeforeCompile = (shader) => {
          shader.vertexShader = shader.vertexShader
            .replace(
              "#include <common>",
              "#include <common>\nvarying vec3 vPropertySurfacePosition;",
            )
            .replace(
              "#include <worldpos_vertex>",
              "#include <worldpos_vertex>\nvPropertySurfacePosition=(modelMatrix*vec4(transformed,1.0)).xyz;",
            );
          shader.fragmentShader = shader.fragmentShader.replace(
            "#include <common>",
            "#include <common>\nvarying vec3 vPropertySurfacePosition;",
          );
          if (key === "water") {
            shader.fragmentShader = shader.fragmentShader.replace(
              "#include <normal_fragment_maps>",
              `#include <normal_fragment_maps>
              vec2 poolP=vPropertySurfacePosition.xz;
              float poolA=dot(poolP,vec2(4.1,1.7));
              float poolB=dot(poolP,vec2(-2.3,6.2));
              float poolC=dot(poolP,vec2(10.7,3.4));
              vec2 poolSlope=.006*cos(poolA)*vec2(4.1,1.7)+.0035*cos(poolB)*vec2(-2.3,6.2)+.0016*cos(poolC)*vec2(10.7,3.4);
              normal=normalize(normal+mat3(viewMatrix)*vec3(-poolSlope.x,0.0,-poolSlope.y));
            `,
            );
          } else {
            shader.fragmentShader = shader.fragmentShader
              .replace(
                "#include <color_fragment>",
                `#include <color_fragment>
              vec2 stoneCell=floor(vPropertySurfacePosition.xz*160.0);
              float stoneGrain=fract(sin(dot(stoneCell,vec2(127.1,311.7)))*43758.5453);
              float stoneDetail=1.0-smoothstep(.3,1.5,length(fwidth(vPropertySurfacePosition.xz))*160.0);
              float stoneWeather=.5+.5*sin(vPropertySurfacePosition.x*.63+sin(vPropertySurfacePosition.z*.79));
              diffuseColor.rgb*=mix(.966,1.0,stoneWeather)*mix(1.0,mix(.96,1.04,stoneGrain),stoneDetail);
            `,
              )
              .replace(
                "#include <roughnessmap_fragment>",
                `#include <roughnessmap_fragment>
              roughnessFactor=clamp(roughnessFactor+.06+stoneDetail*(stoneGrain-.5)*.07,.82,.98);
            `,
              );
          }
        };
      }
      materials.set(key, material);
    }
    return materials.get(key)!;
  };
  const add = (
    source: T.BufferGeometry,
    key: MaterialKey,
    tint: number,
    center: PropertyPoint,
    name: string,
  ) => {
    const geometry = source.index ? source.toNonIndexed() : source;
    if (source !== geometry) source.dispose();
    const position = geometry.getAttribute("position");
    if (!position.count) {
      geometry.dispose();
      return;
    }
    if (!Array.from(position.array).every(Number.isFinite)) {
      geometry.dispose();
      throw new Error(`Non-finite property geometry: ${name}`);
    }
    if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
    if (!geometry.getAttribute("uv"))
      geometry.setAttribute(
        "uv",
        new T.Float32BufferAttribute(
          Array.from({ length: position.count * 2 }, (_, i) =>
            i % 2
              ? position.getZ(Math.floor(i / 2))
              : position.getX(Math.floor(i / 2)),
          ),
          2,
        ),
      );
    const color = new T.Color(tint),
      colors: number[] = [];
    for (let i = 0; i < position.count; i++)
      colors.push(color.r, color.g, color.b);
    geometry.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
    geometry.clearGroups();
    const id = `${Math.floor(center[0] / CELL)}:${Math.floor(center[1] / CELL)}:${key}`;
    if (!batches.has(id))
      batches.set(id, { geometries: [], material: getMaterial(key), name });
    batches.get(id)!.geometries.push(geometry);
  };
  const box = (
    center: V,
    size: V,
    heading: number,
    key: MaterialKey,
    tint: number,
    name: string,
  ) => {
    if (size.some((n) => n <= 0)) return;
    const g = new T.BoxGeometry(...size);
    g.rotateY(heading);
    g.translate(...center);
    add(g, key, tint, [center[0], center[2]], name);
  };
  const beam = (
    a: V,
    b: V,
    width: number,
    depth: number,
    key: MaterialKey,
    tint: number,
    name: string,
  ) => {
    const direction = new T.Vector3(...b).sub(new T.Vector3(...a)),
      length = direction.length();
    if (length < 1e-4) return;
    const g = new T.BoxGeometry(width, length, depth);
    g.applyQuaternion(
      new T.Quaternion().setFromUnitVectors(UP, direction.normalize()),
    );
    g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    add(g, key, tint, [a[0], a[2]], name);
  };
  const buildings = (map.buildings ?? [])
    .map((building: any) =>
      polygon(
        (building.points ?? building.footprint ?? []).map((p: number[]) => [
          p[0],
          p.length > 2 ? p[2] : p[1],
        ]),
      ),
    )
    .filter((p: PropertyPoint[]) => p.length > 2);

  for (const feature of survey?.propertyFeatures ?? []) {
    const points = polygon(feature.points);
    if (!points.length) {
      omitted.push({
        id: feature.id,
        reason: "Invalid or degenerate footprint",
      });
      continue;
    }
    const triangles = T.ShapeUtils.triangulateShape(
      points.map((p) => new T.Vector2(...p)),
      [],
    );
    const center: PropertyPoint = [
      points.reduce((sum, p) => sum + p[0], 0) / points.length,
      points.reduce((sum, p) => sum + p[1], 0) / points.length,
    ];
    let ground = -Infinity;
    // Edges and triangle interiors keep small graded features above the actual terrain.
    for (const tri of triangles) {
      const [a, b, c] = tri.map((i) => points[i]);
      const steps = Math.max(
        1,
        Math.ceil(
          Math.max(
            Math.hypot(a[0] - b[0], a[1] - b[1]),
            Math.hypot(a[0] - c[0], a[1] - c[1]),
          ) / 1.5,
        ),
      );
      for (let i = 0; i <= steps; i++)
        for (let j = 0; j <= steps - i; j++)
          ground = Math.max(
            ground,
            heightAt(
              a[0] + ((b[0] - a[0]) * i) / steps + ((c[0] - a[0]) * j) / steps,
              a[1] + ((b[1] - a[1]) * i) / steps + ((c[1] - a[1]) * j) / steps,
            ),
          );
    }
    if (!Number.isFinite(ground)) {
      omitted.push({ id: feature.id, reason: "Invalid terrain height" });
      continue;
    }
    const defaults: string[] = [];
    const perimeter = points.map((a, i) => {
      const b = points[(i + 1) % points.length],
        length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      return { a, b, length, heading: Math.atan2(b[0] - a[0], b[1] - a[1]) };
    });
    let elevation: number;
    if (feature.kind === "deck") {
      const height = bounded(feature.heightMeters, 0.6, 0.15, 4);
      if (feature.heightMeters === undefined)
        defaults.push("Platform height 0.6m above highest sampled ground");
      elevation = ground + height;
      const tint = feature.color ?? 0x8c7a60;
      add(
        planar(points, elevation - 0.035),
        "wood",
        0x554b3e,
        center,
        "Deck structure and boards",
      );
      const longest = perimeter.reduce((best, edge) =>
          edge.length > best.length ? edge : best,
        ),
        axis: PropertyPoint = [
          (longest.b[0] - longest.a[0]) / longest.length,
          (longest.b[1] - longest.a[1]) / longest.length,
        ];
      const across = (p: PropertyPoint) => -p[0] * axis[1] + p[1] * axis[0];
      const values = points.map(across),
        min = Math.min(...values),
        max = Math.max(...values);
      // Clip each triangulated contour independently; concave patios/decks never bridge voids.
      for (let band = 0, start = min; start < max; band++, start += 0.15)
        for (const tri of triangles) {
          let piece = clipped(
            tri.map((i) => points[i]),
            (p) => across(p) - start,
          );
          if (piece.length)
            piece = clipped(piece, (p) => start + 0.143 - across(p));
          if (piece.length >= 3)
            add(
              planar(piece, elevation),
              "wood",
              new T.Color(tint)
                .multiplyScalar(0.94 + (band % 5) * 0.024)
                .getHex(),
              center,
              "Deck structure and boards",
            );
        }
      for (const { a, b, length } of perimeter) {
        beam(
          [a[0], elevation - 0.11, a[1]],
          [b[0], elevation - 0.11, b[1]],
          0.15,
          0.18,
          "wood",
          tint,
          "Deck fascia and supports",
        );
        const count = Math.max(1, Math.ceil(length / 2.4));
        for (let i = 0; i < count; i++) {
          const x = a[0] + ((b[0] - a[0]) * i) / count,
            z = a[1] + ((b[1] - a[1]) * i) / count,
            base = heightAt(x, z) - 0.04;
          box(
            [x, (base + elevation - 0.11) / 2, z],
            [0.14, elevation - 0.11 - base, 0.14],
            0,
            "wood",
            0x776650,
            "Deck fascia and supports",
          );
        }
      }
      const railHeight = bounded(feature.railHeightMeters, 1.02, 0.65, 1.3);
      for (const index of new Set(feature.railEdges ?? [])) {
        const edge = perimeter[index];
        if (!edge || !Number.isInteger(index)) continue;
        const { a, b, length } = edge,
          segments = Math.ceil(length / 0.13);
        for (let i = 0; i <= segments; i++) {
          const x = a[0] + ((b[0] - a[0]) * i) / segments,
            z = a[1] + ((b[1] - a[1]) * i) / segments;
          const post = i === 0 || i === segments || i % 12 === 0;
          box(
            [x, elevation + railHeight / 2, z],
            [post ? 0.095 : 0.032, railHeight, post ? 0.095 : 0.032],
            edge.heading,
            "wood",
            tint,
            "Observed deck railing",
          );
        }
        for (const h of [0.14, railHeight])
          beam(
            [a[0], elevation + h, a[1]],
            [b[0], elevation + h, b[1]],
            0.065,
            0.09,
            "wood",
            tint,
            "Observed deck railing",
          );
      }
      if (feature.stairs) {
        const edge = perimeter[feature.stairs.edgeIndex];
        if (edge && Number.isInteger(feature.stairs.edgeIndex)) {
          const { a, b, length } = edge,
            dx = (b[0] - a[0]) / length,
            dz = (b[1] - a[1]) / length;
          const area = points.reduce(
            (sum, p, i) =>
              sum +
              p[0] * points[(i + 1) % points.length][1] -
              p[1] * points[(i + 1) % points.length][0],
            0,
          );
          const nx = area > 0 ? dz : -dz,
            nz = area > 0 ? -dx : dx;
          const start: PropertyPoint = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          const width = bounded(
            feature.stairs.widthMeters,
            1.05,
            0.6,
            Math.max(0.6, length - 0.12),
          );
          let run = bounded(
            feature.stairs.runMeters,
            Math.max(0.6, Math.ceil(height / 0.18) * 0.28),
            0.5,
            6,
          );
          if (feature.stairs.runMeters === undefined) {
            for (let i = 0; i < 3; i++)
              run = bounded(
                Math.ceil(
                  Math.max(
                    0.18,
                    elevation -
                      heightAt(start[0] + nx * run, start[1] + nz * run),
                  ) / 0.18,
                ) * 0.28,
                run,
                0.5,
                6,
              );
            defaults.push(
              "Stair run/riser count inferred from terrain at the explicit stair edge",
            );
          }
          const stairPoint = (t: number, side: number): PropertyPoint => [
            start[0] + nx * t + dx * side,
            start[1] + nz * t + dz * side,
          ];
          const rectangle = [
            stairPoint(0.03, -width / 2),
            stairPoint(run, -width / 2),
            stairPoint(run, width / 2),
            stairPoint(0.03, width / 2),
          ];
          if (buildings.some((p: PropertyPoint[]) => overlaps(rectangle, p)))
            omitted.push({
              id: feature.id,
              reason:
                "Explicit stair edge intersects a building; stairs omitted",
            });
          else {
            const endGround = heightAt(...stairPoint(run, 0)),
              drop = elevation - endGround;
            if (drop > 0.12) {
              const steps = Math.ceil(drop / 0.18),
                tread = run / steps,
                heading = Math.atan2(nx, nz);
              for (let i = 0; i < steps; i++) {
                const t = (i + 0.5) * tread,
                  [x, z] = stairPoint(t, 0),
                  top = elevation - (drop * (i + 1)) / steps;
                const bottom = Math.min(top - 0.055, heightAt(x, z) - 0.02);
                box(
                  [x, (top + bottom) / 2, z],
                  [width, top - bottom, tread + 0.005],
                  heading,
                  "wood",
                  tint,
                  "Observed deck stair access",
                );
              }
              stats.stairs++;
            }
          }
        }
      }
      stats.decks++;
    } else if (feature.kind === "pool") {
      const form = feature.form ?? "in-ground",
        surface = feature.surface ?? "water";
      const height = bounded(
        feature.heightMeters,
        form === "above-ground" ? 1.2 : 0.16,
        0.1,
        2.4,
      );
      if (feature.heightMeters === undefined)
        defaults.push(
          `Pool rim height ${height}m above highest sampled ground`,
        );
      if (feature.form === undefined)
        defaults.push("Pool form unmeasured; low rim used");
      if (feature.surface === undefined)
        defaults.push("Surface unspecified; representative water used");
      elevation = ground + height;
      const coping = bounded(
        feature.copingWidthMeters,
        form === "above-ground" ? 0.12 : 0.25,
        0.06,
        0.6,
      );
      for (const { a, b, length, heading } of perimeter) {
        const x = (a[0] + b[0]) / 2,
          z = (a[1] + b[1]) / 2,
          bottom = Math.min(heightAt(...a), heightAt(...b)) - 0.06;
        box(
          [x, (bottom + elevation) / 2, z],
          [0.085, elevation - bottom, length],
          heading,
          "pool",
          form === "above-ground" ? 0xaab8b5 : 0xb9bdba,
          "Pool walls",
        );
        box(
          [x, elevation, z],
          [coping, 0.075, length + 0.02],
          heading,
          "stone",
          0xd9d6c9,
          "Pool coping",
        );
        if (form === "above-ground") {
          const count = Math.max(1, Math.ceil(length / 1.3));
          for (let i = 0; i < count; i++) {
            const px = a[0] + ((b[0] - a[0]) * i) / count,
              pz = a[1] + ((b[1] - a[1]) * i) / count,
              base = heightAt(px, pz);
            box(
              [px, (base + elevation) / 2, pz],
              [0.085, elevation - base, 0.085],
              heading,
              "pool",
              0xd6dad3,
              "Pool wall uprights",
            );
          }
        }
      }
      // Covers receive shallow folds inside their measured outline; water stays level.
      const coverHeight = (x: number, z: number) => {
        let edgeDistance = Infinity;
        for (const { a, b, length } of perimeter) {
          const t = Math.max(
            0,
            Math.min(
              1,
              ((x - a[0]) * (b[0] - a[0]) + (z - a[1]) * (b[1] - a[1])) /
                (length * length),
            ),
          );
          edgeDistance = Math.min(
            edgeDistance,
            Math.hypot(
              x - a[0] - (b[0] - a[0]) * t,
              z - a[1] - (b[1] - a[1]) * t,
            ),
          );
        }
        const interior = Math.min(1, edgeDistance / 0.4);
        return (
          elevation -
          0.023 -
          interior *
            (0.012 +
              0.008 * Math.sin(x * 6.3 + z * 1.7) * Math.sin(z * 4.4 - x * 0.8))
        );
      };
      add(
        surface === "covered"
          ? detailedSurface(points, coverHeight, 0.55)
          : planar(points, elevation - 0.028),
        surface === "covered" ? "cover" : "water",
        surface === "covered"
          ? (feature.coverColor ?? 0x546457)
          : (feature.waterColor ?? 0x397e87),
        center,
        surface === "covered" ? "Observed pool cover" : "Observed pool water",
      );
      stats.pools++;
    } else if (feature.kind === "patio") {
      const offset = bounded(feature.heightMeters, 0.075, 0.04, 0.3);
      elevation = ground + offset;
      if (feature.heightMeters === undefined)
        defaults.push(
          "Patio surface follows terrain with a 0.075m visual offset",
        );
      // A subdivided terrain-following surface avoids hovering slabs on sloping yards.
      add(
        detailedSurface(points, (x, z) => heightAt(x, z) + offset, 1),
        "stone",
        feature.color ?? 0xb6b5a9,
        center,
        "Observed patio",
      );
      stats.patios++;
    } else continue;
    records.push({
      id: feature.id,
      kind: feature.kind,
      address: feature.address,
      source: feature.source,
      confidence: feature.confidence,
      points: points.map((p) => [...p]),
      elevation,
      approximations: defaults,
    });
  }

  const labels = new Map<
    string,
    { text: string; kind: "stop" | "street"; index: number }
  >();
  for (const sign of survey?.roadSigns ?? []) {
    if (sign.kind === "stop")
      labels.set("stop", { text: "STOP", kind: "stop", index: 0 });
    else
      for (const blade of sign.blades ?? [])
        if (blade.text?.trim())
          labels.set(`street:${blade.text.trim()}`, {
            text: blade.text.trim(),
            kind: "street",
            index: 0,
          });
  }
  let atlas: T.CanvasTexture | null = null;
  const atlasRows = Math.max(1, Math.ceil(labels.size / 2));
  if (labels.size && typeof document !== "undefined") {
    const canvas = document.createElement("canvas"),
      ctx = canvas.getContext("2d");
    if (ctx && typeof ctx.fillText === "function") {
      canvas.width = 2048;
      canvas.height = atlasRows * 256;
      let index = 0;
      for (const label of labels.values()) {
        label.index = index++;
        const x = (label.index % 2) * 1024,
          y = Math.floor(label.index / 2) * 256;
        ctx.fillStyle = label.kind === "stop" ? "#b92c29" : "#175e43";
        ctx.fillRect(x, y, 1024, 256);
        ctx.fillStyle = "#f8f8ee";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `600 ${label.kind === "stop" ? 312 : 174}px Arial, sans-serif`;
        ctx.fillText(label.text, x + 512, y + 133, 945);
      }
      atlas = new T.CanvasTexture(canvas);
      atlas.colorSpace = T.SRGBColorSpace;
      atlas.anisotropy = 4;
      const material = getMaterial("lettering");
      material.map = atlas;
    }
  }
  const face = (
    width: number,
    height: number,
    center: V,
    heading: number,
    key: MaterialKey,
    tint: number,
    name: string,
    label?: string,
  ) => {
    const g = new T.PlaneGeometry(width, height);
    if (label && atlas) {
      const cell = labels.get(label)!.index,
        uv = g.getAttribute("uv");
      // Half-pixel inset prevents neighboring labels bleeding through mip levels.
      for (let i = 0; i < uv.count; i++)
        uv.setXY(
          i,
          ((cell % 2) + 0.001 + uv.getX(i) * 0.998) / 2,
          1 -
            (Math.floor(cell / 2) + 0.002 + (1 - uv.getY(i)) * 0.996) /
              atlasRows,
        );
    }
    g.rotateY(heading);
    g.translate(...center);
    add(g, key, tint, [center[0], center[2]], name);
  };
  for (const sign of survey?.roadSigns ?? []) {
    if (!finitePoint(sign.position)) {
      omitted.push({ id: sign.id, reason: "Invalid sign position" });
      continue;
    }
    const [x, z] = sign.position,
      base = heightAt(x, z);
    if (!Number.isFinite(base)) {
      omitted.push({ id: sign.id, reason: "Invalid sign terrain height" });
      continue;
    }
    const centerHeight = bounded(
      sign.heightMeters,
      sign.kind === "stop" ? 2.15 : 2.8,
      1.1,
      4,
    );
    if (sign.kind === "stop") {
      if (!Number.isFinite(sign.facingHeading)) {
        omitted.push({
          id: sign.id,
          reason: "Stop sign needs an explicit approach-facing heading",
        });
        continue;
      }
      const width = bounded(sign.widthMeters, 0.762, 0.6, 1.2),
        heading = sign.facingHeading,
        normal: PropertyPoint = [Math.sin(heading), Math.cos(heading)];
      const signY = base + centerHeight;
      box(
        [
          x - normal[0] * 0.045,
          base + (centerHeight + width * 0.36) / 2,
          z - normal[1] * 0.045,
        ],
        [0.065, centerHeight + width * 0.36, 0.045],
        heading,
        "metal",
        0x969f9a,
        "Galvanized sign posts",
      );
      const octagon = (
        size: number,
        depth: number,
        key: MaterialKey,
        tint: number,
      ) => {
        const shape = new T.Shape(),
          radius = size / (2 * Math.cos(Math.PI / 8));
        for (let i = 0; i < 8; i++) {
          const angle = Math.PI / 8 + (i * Math.PI) / 4,
            px = Math.cos(angle) * radius,
            py = Math.sin(angle) * radius;
          if (!i) shape.moveTo(px, py);
          else shape.lineTo(px, py);
        }
        shape.closePath();
        const geometry = depth
          ? new T.ExtrudeGeometry(shape, {
              depth,
              bevelEnabled: false,
              steps: 1,
            })
          : new T.ShapeGeometry(shape);
        geometry.rotateY(heading);
        geometry.translate(
          x + normal[0] * (depth ? -depth : 0.004),
          signY,
          z + normal[1] * (depth ? -depth : 0.004),
        );
        add(
          geometry,
          key,
          tint,
          sign.position,
          "STOP octagon faces and metal back",
        );
      };
      octagon(width, 0.018, "metal", 0xaab1ae);
      octagon(width * 0.974, 0, "sign", 0xf1f1e7);
      // Offset the smaller red face just in front of the white border.
      const shape = new T.Shape(),
        radius = (width * 0.91) / (2 * Math.cos(Math.PI / 8));
      for (let i = 0; i < 8; i++) {
        const angle = Math.PI / 8 + (i * Math.PI) / 4;
        if (!i)
          shape.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
        else shape.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
      }
      shape.closePath();
      const red = new T.ShapeGeometry(shape);
      red.rotateY(heading);
      red.translate(x + normal[0] * 0.006, signY, z + normal[1] * 0.006);
      add(
        red,
        "sign",
        0xb92c29,
        sign.position,
        "STOP octagon faces and metal back",
      );
      if (atlas)
        face(
          width * 0.73,
          width * 0.3,
          [x + normal[0] * 0.009, signY, z + normal[1] * 0.009],
          heading,
          "lettering",
          0xffffff,
          "Readable road sign lettering",
          "stop",
        );
      for (const y of [-0.27, 0.27]) {
        const bolt = new T.SphereGeometry(0.009, 6, 4);
        bolt.translate(
          x + normal[0] * 0.012,
          signY + (y * width) / 0.762,
          z + normal[1] * 0.012,
        );
        add(bolt, "metal", 0xc7cac4, sign.position, "Sign fasteners");
      }
      stats.stopSigns++;
      signs.push({
        ...sign,
        position: [...sign.position],
        base,
        centerHeight,
        frontNormal: [normal[0], 0, normal[1]],
        approximation:
          "Sign panel/post dimensions are representative; position and approach orientation follow the supplied record",
      });
    } else if (sign.kind === "street") {
      const blades = (sign.blades ?? []).filter(
        (b) => b.text?.trim() && Number.isFinite(b.heading),
      );
      if (!blades.length) {
        omitted.push({
          id: sign.id,
          reason: "Street sign has no valid labeled blades",
        });
        continue;
      }
      box(
        [x, base + (centerHeight - 0.11) / 2, z],
        [0.065, centerHeight - 0.11, 0.065],
        0,
        "metal",
        0x929c97,
        "Galvanized sign posts",
      );
      // The wide post ends beneath the blades; a narrow bracket sits within their
      // thickness so neither street-name face is covered by its own support.
      if (blades.length > 1)
        box(
          [x, base + centerHeight + (blades.length - 1) * 0.135, z],
          [0.018, (blades.length - 1) * 0.27, 0.018],
          0,
          "metal",
          0x929c97,
          "Street name mounting bracket",
        );
      blades.forEach((blade, i) => {
        const width = bounded(
            blade.widthMeters,
            Math.max(0.85, Math.min(2.3, blade.text.length * 0.084 + 0.22)),
            0.7,
            3,
          ),
          y = base + centerHeight + i * 0.27;
        box(
          [x, y, z],
          [width, 0.235, 0.022],
          blade.heading,
          "metal",
          0xa3aca5,
          "Street name metal blades",
        );
        for (const heading of [blade.heading, blade.heading + Math.PI]) {
          const nx = Math.sin(heading),
            nz = Math.cos(heading);
          face(
            width - 0.012,
            0.222,
            [x + nx * 0.013, y, z + nz * 0.013],
            heading,
            "sign",
            0xf1f1e7,
            "Street name border",
          );
          face(
            width - 0.032,
            0.204,
            [x + nx * 0.015, y, z + nz * 0.015],
            heading,
            atlas ? "lettering" : "sign",
            atlas ? 0xffffff : 0x175e43,
            "Readable road sign lettering",
            `street:${blade.text.trim()}`,
          );
        }
      });
      stats.streetSigns++;
      signs.push({
        ...sign,
        position: [...sign.position],
        base,
        centerHeight,
        approximation:
          "Blade widths inferred from lettering unless specified; verticals are representative",
      });
    }
  }
  for (const [key, batch] of batches) {
    const geometry = mergeGeometries(batch.geometries, false);
    for (const source of batch.geometries) source.dispose();
    if (!geometry) continue;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new T.Mesh(geometry, batch.material);
    mesh.name = `${batch.name} [${key}]`;
    mesh.castShadow = !["water", "lettering"].includes(key.split(":").at(-1)!);
    mesh.receiveShadow = true;
    root.add(mesh);
    stats.triangles += geometry.getAttribute("position").count / 3;
  }
  stats.drawCalls = root.children.length;
  // All GPU resources are ordinary child mesh geometry/material/map objects, owned
  // by Environment.dispose's existing traversal. No hidden cache or per-frame work.
  const used = new Set(root.children.map((mesh) => (mesh as T.Mesh).material));
  for (const material of materials.values())
    if (!used.has(material)) {
      material.map?.dispose();
      material.dispose();
    }
  return root;
}
