import type { MapData } from "./types";
import {
  getHomeFrame,
  homeDeckOutline,
  homePatioOutline,
  homeFrontWalk,
  homeWorldOutline,
} from "./home-reference";

export type GroundPoint = [number, number];

/** Polygon distance, including the interior, for observed pavement and yard structures. */
export function polygonDistance(x: number, z: number, points: GroundPoint[]) {
  let inside = false,
    distance = Infinity;
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    if (
      a[1] > z !== b[1] > z &&
      x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
    const dx = b[0] - a[0],
      dz = b[1] - a[1];
    const t = Math.max(
      0,
      Math.min(
        1,
        ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1),
      ),
    );
    distance = Math.min(
      distance,
      Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t),
    );
  }
  return inside ? 0 : distance;
}

/** Shared clearance prevents grass, roots and tree trunks growing through traced hardscape. */
export function createPropertyClearance(map: MapData) {
  const survey = map.beverlySurvey;
  const home = getHomeFrame(map, () => 0);
  const homePolygons = home
    ? [
        homeDeckOutline(home),
        homePatioOutline(home),
        homeFrontWalk(home),
        [
          [-home.width / 2 - 0.3, -home.depth / 2],
          [home.width / 2 + 0.3, -home.depth / 2],
          [home.width / 2 + 0.3, -home.depth / 2 - 1.8],
          [-home.width / 2 - 0.3, -home.depth / 2 - 1.8],
        ] as [number, number][],
      ].map((outline) => ({ points: homeWorldOutline(home, outline) }))
    : [];
  const polygons = [
    ...(survey?.drivewaySurfaces ?? []),
    ...(survey?.propertyFeatures ?? []),
    ...homePolygons,
    // The stream remains unpaved. This exclusion only keeps terrestrial roots,
    // shrubs and grass out of its water and immediate bank.
    ...(map.backyard?.stream?.stations ?? [])
      .slice(1)
      .map((b: { point: GroundPoint; width: number }, i: number) => {
        const a = map.backyard.stream.stations[i],
          dx = b.point[0] - a.point[0],
          dz = b.point[1] - a.point[1],
          length = Math.hypot(dx, dz) || 1;
        const n = [dz / length, -dx / length],
          ra = a.width / 2 + 0.3,
          rb = b.width / 2 + 0.3;
        return {
          points: [
            [a.point[0] - n[0] * ra, a.point[1] - n[1] * ra],
            [a.point[0] + n[0] * ra, a.point[1] + n[1] * ra],
            [b.point[0] + n[0] * rb, b.point[1] + n[1] * rb],
            [b.point[0] - n[0] * rb, b.point[1] - n[1] * rb],
          ] as GroundPoint[],
        };
      }),
  ]
    .filter(
      (feature: { points?: GroundPoint[] }) =>
        feature.points && feature.points.length >= 3,
    )
    .map(
      (feature: {
        points: GroundPoint[];
        kind?: string;
        copingWidthMeters?: number;
      }) => ({
        points: feature.points,
        padding:
          feature.kind === "pool" ? (feature.copingWidthMeters ?? 0.35) : 0.12,
        minX: Math.min(...feature.points.map((p) => p[0])),
        maxX: Math.max(...feature.points.map((p) => p[0])),
        minZ: Math.min(...feature.points.map((p) => p[1])),
        maxZ: Math.max(...feature.points.map((p) => p[1])),
      }),
    );
  return (x: number, z: number, radius = 0) =>
    polygons.every((p) => {
      const pad = radius + p.padding;
      return (
        x < p.minX - pad ||
        x > p.maxX + pad ||
        z < p.minZ - pad ||
        z > p.maxZ + pad ||
        polygonDistance(x, z, p.points) > pad
      );
    });
}

/** Asphalt driveways share paved grip with roads, without treating lawns/pools as pavement. */
export function createDrivewayQuery(map: MapData) {
  const surfaces = (map.beverlySurvey?.drivewaySurfaces ?? []).map(
    (f: { points: GroundPoint[] }) => ({
      points: f.points,
      minX: Math.min(...f.points.map((p) => p[0])),
      maxX: Math.max(...f.points.map((p) => p[0])),
      minZ: Math.min(...f.points.map((p) => p[1])),
      maxZ: Math.max(...f.points.map((p) => p[1])),
    }),
  );
  return (x: number, z: number) =>
    surfaces.some(
      (p: {
        points: GroundPoint[];
        minX: number;
        maxX: number;
        minZ: number;
        maxZ: number;
      }) =>
        x >= p.minX &&
        x <= p.maxX &&
        z >= p.minZ &&
        z <= p.maxZ &&
        polygonDistance(x, z, p.points) < 0.02,
    );
}
