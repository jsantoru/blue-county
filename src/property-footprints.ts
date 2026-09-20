import type { MapData } from "./types";

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
  const polygons = [
    ...(survey?.drivewaySurfaces ?? []),
    ...(survey?.propertyFeatures ?? []),
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
