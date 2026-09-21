import * as T from "three";
import type { MapData } from "./types";

export const HOME_BUILDING_ID = "nys-7159466";
export type HomePoint = [number, number];

/** Photo-facing frame: u increases to the viewer's right, v into the lot. */
export interface HomeFrame {
  center: HomePoint;
  right: HomePoint;
  back: HomePoint;
  width: number;
  depth: number;
  groundY: number;
  foundationY?: number;
  lowerFloorY: number;
  upperFloorY: number;
  entryFloorY: number;
  eaveY: number;
  ridgeY: number;
  /** y is absolute world elevation. */
  point(u: number, y: number, v: number): T.Vector3;
}

export const HOME_DETAIL = {
  entryRatio: 0.62,
  sideDoorV: 1.2,
  sideDeckFront: -0.8,
  sideDeckWidth: 2.8,
  rearDeckDepth: 2.5,
  rearDeckLeft: -1.8,
  screenRoomRight: 3.4,
} as const;

/** The source footprint stays unchanged; only its appearance is photo-specific. */
export function getHomeFrame(
  map: MapData,
  heightAt: (x: number, z: number) => number,
): HomeFrame | undefined {
  const building = map.buildings?.find((b) => b.id === HOME_BUILDING_ID);
  if (!building) return;
  const points = building.points.map(
    (p: number[]) => [p[0], p[2]] as HomePoint,
  );
  let widthAxis: HomePoint = [0, 1],
    longest = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0],
      dz = points[i][1] - points[i - 1][1];
    const length = Math.hypot(dx, dz);
    if (length > longest) {
      longest = length;
      widthAxis = [dx / length, dz / length];
    }
  }
  // The verified street is west of this house; its driveway/right end is south.
  if (widthAxis[1] < 0) widthAxis = [-widthAxis[0], -widthAxis[1]];
  const right = widthAxis,
    back: HomePoint = [right[1], -right[0]];
  const u = points.map((p: HomePoint) => p[0] * right[0] + p[1] * right[1]);
  const v = points.map((p: HomePoint) => p[0] * back[0] + p[1] * back[1]);
  const midU = (Math.min(...u) + Math.max(...u)) / 2,
    midV = (Math.min(...v) + Math.max(...v)) / 2;
  const center: HomePoint = [
    midU * right[0] + midV * back[0],
    midU * right[1] + midV * back[1],
  ];
  const width = Math.max(...u) - Math.min(...u),
    depth = Math.max(...v) - Math.min(...v);
  const point = (u: number, y: number, v: number) =>
    new T.Vector3(
      center[0] + right[0] * u + back[0] * v,
      y,
      center[1] + right[1] * u + back[1] * v,
    );
  const entry = point(
    width * (HOME_DETAIL.entryRatio - 0.5),
    0,
    -depth / 2 - 1.1,
  );
  const groundY = heightAt(entry.x, entry.z),
    lowerFloorY = groundY - 0.12;
  const upperFloorY = lowerFloorY + 2.25,
    eaveY = upperFloorY + 2.25;
  return {
    center,
    right,
    back,
    width,
    depth,
    groundY,
    foundationY:
      Math.min(...points.map((p: HomePoint) => heightAt(p[0], p[1]))) - 0.12,
    lowerFloorY,
    upperFloorY,
    entryFloorY: groundY + 0.46,
    eaveY,
    ridgeY: eaveY + 1.5,
    point,
  };
}

export function homeDeckOutline(frame: HomeFrame): HomePoint[] {
  const right = frame.width / 2,
    back = frame.depth / 2;
  return [
    [right, HOME_DETAIL.sideDeckFront],
    [right + HOME_DETAIL.sideDeckWidth, HOME_DETAIL.sideDeckFront],
    [right + HOME_DETAIL.sideDeckWidth, back + HOME_DETAIL.rearDeckDepth],
    [HOME_DETAIL.rearDeckLeft, back + HOME_DETAIL.rearDeckDepth],
    [HOME_DETAIL.rearDeckLeft, back],
    [right, back],
  ];
}

export function homePatioOutline(frame: HomeFrame): HomePoint[] {
  const right = frame.width / 2;
  return [
    [right, -0.65],
    [right + 2.7, -0.65],
    [right + 2.7, frame.depth / 2],
    [right, frame.depth / 2],
  ];
}

export function homeFrontWalk(frame: HomeFrame): HomePoint[] {
  const door = frame.width * (HOME_DETAIL.entryRatio - 0.5),
    front = -frame.depth / 2,
    cornerU = frame.width / 2 + 2.2,
    cornerV = front - 2.4,
    endU = frame.width / 2 + 6.0,
    endV = 0.6,
    length = Math.hypot(endU - cornerU, endV - cornerV),
    normalU = ((endV - cornerV) / length) * 0.6,
    normalV = (-(endU - cornerU) / length) * 0.6,
    // Intersect the horizontal strip edges with the diagonal strip edges.
    miter = normalU + ((endU - cornerU) / (endV - cornerV)) * (-0.6 - normalV);
  return [
    [door - 0.9, front],
    [door + 0.9, front],
    [door + 0.9, front - 1.8],
    [cornerU - miter, front - 1.8],
    [endU - normalU, endV - normalV],
    [endU + normalU, endV + normalV],
    [cornerU + miter, front - 3.0],
    [door - 0.9, front - 3.0],
  ];
}

export const homeWorldOutline = (
  frame: HomeFrame,
  outline: HomePoint[],
): HomePoint[] =>
  outline.map(([u, v]) => {
    const p = frame.point(u, 0, v);
    return [p.x, p.z];
  });
