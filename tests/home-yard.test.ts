import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as T from "three";
import {
  getHomeFrame,
  homeFrontWalk,
  type HomeFrame,
  type HomePoint,
} from "../src/home-reference";
import { createDrivewayQuery } from "../src/property-footprints";
import type { MapData } from "../src/types";

function fixture(width: number, depth: number): HomeFrame {
  return {
    center: [0, 0],
    right: [0, 1],
    back: [1, 0],
    width,
    depth,
    groundY: 0,
    lowerFloorY: -0.12,
    upperFloorY: 2.13,
    entryFloorY: 0.46,
    eaveY: 4.38,
    ridgeY: 5.88,
    point: (u, y, v) => new T.Vector3(v, y, u),
  };
}
const cross = (a: HomePoint, b: HomePoint, p: HomePoint) =>
  (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
function intersects(a: HomePoint, b: HomePoint, c: HomePoint, d: HomePoint) {
  const on = (p: HomePoint, q: HomePoint, r: HomePoint) =>
    Math.abs(cross(p, q, r)) < 1e-8 &&
    r[0] >= Math.min(p[0], q[0]) - 1e-8 &&
    r[0] <= Math.max(p[0], q[0]) + 1e-8 &&
    r[1] >= Math.min(p[1], q[1]) - 1e-8 &&
    r[1] <= Math.max(p[1], q[1]) + 1e-8;
  return (
    (cross(a, b, c) * cross(a, b, d) < 0 &&
      cross(c, d, a) * cross(c, d, b) < 0) ||
    on(a, b, c) ||
    on(a, b, d) ||
    on(c, d, a) ||
    on(c, d, b)
  );
}
const area = (points: HomePoint[]) =>
  Math.abs(
    points.reduce((sum, p, i) => {
      const next = points[(i + 1) % points.length];
      return sum + p[0] * next[1] - next[0] * p[1];
    }, 0),
  ) / 2;

describe("Home front walk", () => {
  it.each([
    [14, 9],
    [14.946, 9.975],
    [16, 11],
  ])(
    "keeps the %dm by %dm house walkway simple through its driveway turn",
    (width, depth) => {
      const outline = homeFrontWalk(fixture(width, depth));
      for (let i = 0; i < outline.length; i++) {
        const nextI = (i + 1) % outline.length;
        for (let j = i + 1; j < outline.length; j++) {
          const nextJ = (j + 1) % outline.length;
          if (i === nextJ || nextI === j) continue;
          expect(
            intersects(outline[i], outline[nextI], outline[j], outline[nextJ]),
            `non-adjacent walk edges ${i} and ${j} must not cross`,
          ).toBe(false);
        }
      }
      // The approach is a pedestrian strip, not a broad diagonal paving wedge.
      expect(area(outline)).toBeGreaterThan(18);
      expect(area(outline)).toBeLessThan(32);
      // Earcut must preserve the whole simple outline, including its concave elbow.
      const triangles = T.ShapeUtils.triangulateShape(
        outline.map((p) => new T.Vector2(...p)),
        [],
      );
      const filledArea = triangles.reduce(
        (sum, triangle) => sum + area(triangle.map((index) => outline[index])),
        0,
      );
      expect(filledArea).toBeCloseTo(area(outline), 6);
    },
  );

  it("connects its full pedestrian-width end to Home's surveyed driveway apron", () => {
    const map: MapData = JSON.parse(
      readFileSync(
        new URL("../public/map/warwick.json", import.meta.url),
        "utf8",
      ),
    );
    const frame = getHomeFrame(map, () => 0)!;
    const paved = createDrivewayQuery(map);
    const outline = homeFrontWalk(frame);
    // The terminal edge is beyond the right-side wall and farthest from the front.
    const terminal = outline
      .map((p, i) => [p, outline[(i + 1) % outline.length]] as const)
      .filter(([a, b]) => a[0] > frame.width / 2 && b[0] > frame.width / 2)
      .sort(([a, b], [c, d]) => c[1] + d[1] - (a[1] + b[1]))[0];
    expect(terminal).toBeDefined();
    const [a, b] = terminal;
    expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeCloseTo(1.2, 5);
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const point = frame.point(
        a[0] + (b[0] - a[0]) * t,
        0,
        a[1] + (b[1] - a[1]) * t,
      );
      expect(
        paved(point.x, point.z),
        `walk/apron seam at ${point.x},${point.z}`,
      ).toBe(true);
    }
  });
});
