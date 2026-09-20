export type Point = [number, number, number];
export interface Road {
  id: number | string;
  name: string;
  points: Point[];
  width: number;
  oneway?: boolean;
  highway?: string;
  bridge?: boolean;
  markings?: "none" | "double-yellow";
  shoulderWidth?: number;
  surveyed?: boolean;
}
export interface MapData {
  name?: string;
  roads: Road[];
  buildings?: any[];
  home: {
    position: Point;
    heading: number;
    label?: string;
    departurePath?: Point[];
  };
  route: {
    type: "circuit" | "point-to-point";
    name: string;
    points: Point[];
    streets: string[];
    laps: number;
  };
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  terrain?: {
    cols: number;
    rows: number;
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    heights: number[];
  };
  [k: string]: any;
}
export interface DriveInput {
  steer: number;
  throttle: number;
  brake: number;
  boost: boolean;
  handbrake: boolean;
}
export const idleInput: DriveInput = {
  steer: 0,
  throttle: 0,
  brake: 0,
  boost: false,
  handbrake: false,
};
export const clamp = (x: number, a: number, b: number) =>
  Math.max(a, Math.min(b, x));
export const angleDiff = (a: number, b: number) =>
  Math.atan2(Math.sin(a - b), Math.cos(a - b));
