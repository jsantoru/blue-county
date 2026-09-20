import { afterEach, describe, expect, it, vi } from "vitest";
import * as T from "three";
import {
  buildPropertyDetails,
  type PropertyDetailSurvey,
  type PropertyPoint,
} from "../src/property-details";
import type { MapData } from "../src/types";

const mapWith = (survey: PropertyDetailSurvey, buildings: unknown[] = []) =>
  ({
    roads: [],
    buildings,
    bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 },
    home: { position: [0, 0, 0], heading: 0 },
    route: {
      type: "circuit",
      name: "Fixture",
      points: [],
      streets: [],
      laps: 1,
    },
    beverlySurvey: survey,
  }) as MapData;
const flat = () => 0;
const rectangle: PropertyPoint[] = [
  [0, 0],
  [4, 0],
  [4, 3],
  [0, 3],
];
const groups: T.Group[] = [];
function build(
  survey: PropertyDetailSurvey,
  heightAt = flat,
  buildings: unknown[] = [],
) {
  const group = buildPropertyDetails(mapWith(survey, buildings), heightAt);
  groups.push(group);
  return group;
}
function meshes(group: T.Group) {
  return group.children as T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>[];
}
function dispose(group: T.Group) {
  // Matches the Environment traversal: every GPU resource must be reachable here.
  const materials = new Set<T.MeshStandardMaterial>();
  for (const mesh of meshes(group)) {
    mesh.geometry.dispose();
    materials.add(mesh.material);
  }
  for (const material of materials) {
    material.map?.dispose();
    material.dispose();
  }
}
afterEach(() => {
  for (const group of groups.splice(0)) dispose(group);
  vi.unstubAllGlobals();
});

describe("observed property details", () => {
  it("does not create speculative features and rejects non-finite footprints", () => {
    const empty = build({});
    expect(empty.children).toHaveLength(0);
    const invalid = build({
      propertyFeatures: [
        {
          id: "invalid",
          kind: "pool",
          points: [
            [0, 0],
            [NaN, 2],
            [2, 2],
          ],
        },
        {
          id: "line",
          kind: "deck",
          points: [
            [0, 0],
            [1, 1],
            [2, 2],
          ],
        },
      ],
    });
    expect(invalid.children).toHaveLength(0);
    expect(
      invalid.userData.propertyDetails.omitted.map((o: { id: string }) => o.id),
    ).toEqual(["invalid", "line"]);
  });

  it("clips deck boards to a concave observed outline and grounds its supports on sloping terrain", () => {
    const terrain = (x: number, z: number) => x * 0.05 + z * 0.02;
    const outline: PropertyPoint[] = [
      [0, 0],
      [6, 0],
      [6, 2],
      [2, 2],
      [2, 5],
      [0, 5],
    ];
    const group = build(
      {
        propertyFeatures: [
          { id: "L deck", kind: "deck", points: outline, heightMeters: 0.6 },
        ],
      },
      terrain,
    );
    const elevation = group.userData.propertyDetails.features[0].elevation;
    expect(elevation).toBeCloseTo(0.94, 5);
    let boardArea = 0,
      supportBottom = Infinity;
    for (const mesh of meshes(group)) {
      const p = mesh.geometry.getAttribute("position"),
        n = mesh.geometry.getAttribute("normal");
      expect(Array.from(p.array).every(Number.isFinite)).toBe(true);
      for (let i = 0; i < p.count; i++)
        supportBottom = Math.min(supportBottom, p.getY(i));
      for (let i = 0; i < p.count; i += 3) {
        if (
          ![i, i + 1, i + 2].every(
            (j) => Math.abs(p.getY(j) - elevation) < 1e-5 && n.getY(j) > 0.99,
          )
        )
          continue;
        const x = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3;
        const z = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
        expect(
          x > 2.001 && z > 2.001,
          "Boards may not bridge the L-shaped void",
        ).toBe(false);
        boardArea +=
          Math.abs(
            (p.getX(i + 1) - p.getX(i)) * (p.getZ(i + 2) - p.getZ(i)) -
              (p.getZ(i + 1) - p.getZ(i)) * (p.getX(i + 2) - p.getX(i)),
          ) / 2;
      }
    }
    expect(boardArea).toBeGreaterThan(16.7);
    expect(boardArea).toBeLessThan(18);
    expect(supportBottom).toBeCloseTo(-0.04, 5);
    expect(group.userData.statistics.stairs).toBe(0);
    expect(group.children.length).toBeLessThanOrEqual(4);
  });

  it("creates only explicit deck stairs and omits stairs that intersect a house", () => {
    const feature = {
      id: "access",
      kind: "deck" as const,
      points: rectangle,
      heightMeters: 0.8,
      stairs: { edgeIndex: 0, runMeters: 1.6 },
    };
    const open = build({ propertyFeatures: [feature] });
    expect(open.userData.statistics.stairs).toBe(1);
    const blocked = build({ propertyFeatures: [feature] }, flat, [
      {
        points: [
          [1, 0, -3],
          [3, 0, -3],
          [3, 0, -0.1],
          [1, 0, -0.1],
        ],
      },
    ]);
    expect(blocked.userData.statistics.stairs).toBe(0);
    expect(blocked.userData.propertyDetails.omitted).toContainEqual({
      id: "access",
      reason: "Explicit stair edge intersects a building; stairs omitted",
    });
    const reversed = build(
      {
        propertyFeatures: [
          {
            ...feature,
            points: [...rectangle].reverse(),
            stairs: { edgeIndex: 2, runMeters: 1.6 },
          },
        ],
      },
      flat,
      [
        {
          points: [
            [1, 0, -3],
            [3, 0, -3],
            [3, 0, -0.1],
            [1, 0, -0.1],
          ],
        },
      ],
    );
    expect(reversed.userData.statistics.stairs).toBe(0);
  });

  it("keeps covered pools covered and places an open pool above its surrounding patio", () => {
    const terrain = (x: number, z: number) => 0.04 * x + 0.03 * z;
    const covered = build(
      {
        propertyFeatures: [
          {
            id: "covered",
            kind: "pool",
            points: rectangle,
            form: "above-ground",
            surface: "covered",
            heightMeters: 1.1,
          },
        ],
      },
      terrain,
    );
    expect(
      meshes(covered).some((m) => m.material.name === "Property cover"),
    ).toBe(true);
    expect(
      meshes(covered).some((m) => m.material.name === "Property water"),
    ).toBe(false);
    const open = build(
      {
        propertyFeatures: [
          {
            id: "paving",
            kind: "patio",
            points: [
              [-2, -2],
              [7, -2],
              [7, 7],
              [-2, 7],
            ],
          },
          {
            id: "water",
            kind: "pool",
            points: rectangle,
            form: "in-ground",
            surface: "water",
          },
        ],
      },
      terrain,
    );
    const water = meshes(open).find(
      (m) => m.material.name === "Property water",
    )!;
    const p = water.geometry.getAttribute("position"),
      n = water.geometry.getAttribute("normal");
    for (let i = 0; i < p.count; i++) {
      expect(p.getY(i)).toBeGreaterThan(terrain(p.getX(i), p.getZ(i)) + 0.075);
      expect(n.getY(i)).toBeGreaterThan(0.99);
    }
    expect(open.userData.statistics).toMatchObject({ pools: 1, patios: 1 });
  });

  it("orients stop lettering toward the approach, letters both street faces, and exposes atlas disposal", () => {
    const drawText = vi.fn();
    vi.stubGlobal("document", {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ fillRect() {}, fillText: drawText }),
      }),
    });
    const group = build(
      {
        roadSigns: [
          {
            id: "stop",
            kind: "stop",
            position: [1, 3],
            facingHeading: Math.PI / 2,
          },
          {
            id: "street",
            kind: "street",
            position: [12, 3],
            blades: [
              { text: "Beverly Dr", heading: 0 },
              { text: "West Ridge Rd", heading: Math.PI / 2 },
            ],
          },
        ],
      },
      () => 7,
    );
    expect(drawText.mock.calls.map((c) => c[0])).toEqual([
      "STOP",
      "Beverly Dr",
      "West Ridge Rd",
    ]);
    const labelMeshes = meshes(group).filter(
      (m) => m.material.name === "Property lettering",
    );
    expect(new Set(labelMeshes.map((m) => m.material.map)).size).toBe(1);
    const label = labelMeshes[0],
      p = label.geometry.getAttribute("position"),
      n = label.geometry.getAttribute("normal");
    // First panel is STOP. Its normal faces +X; metal back is never mirrored STOP.
    for (let i = 0; i < 6; i++) {
      expect(n.getX(i)).toBeCloseTo(1, 5);
      expect(p.getX(i)).toBeGreaterThan(1);
    }
    expect(p.count).toBe(30); // One STOP face and both sides of two street blades.
    const normals = Array.from({ length: p.count - 6 }, (_, i) => [
      n.getX(i + 6),
      n.getZ(i + 6),
    ]);
    expect(normals.some(([x]) => x < -0.99)).toBe(true);
    expect(normals.some(([, z]) => z < -0.99)).toBe(true);
    const metal = meshes(group).find(
      (m) => m.material.name === "Property metal",
    )!;
    metal.geometry.computeBoundingBox();
    expect(metal.geometry.boundingBox!.min.y).toBeCloseTo(7, 5);
    expect(group.userData.statistics).toMatchObject({
      stopSigns: 1,
      streetSigns: 1,
    });
    group.updateMatrixWorld(true);
    const front = new T.Raycaster(
      new T.Vector3(12, 9.8, 5),
      new T.Vector3(0, 0, -1),
    ).intersectObjects(group.children)[0];
    expect(
      (front.object as T.Mesh<T.BufferGeometry, T.Material>).material.name,
    ).toBe("Property lettering");
    expect(group.children.length).toBeLessThanOrEqual(4);
    const disposed = vi.fn();
    label.material.map!.addEventListener("dispose", disposed);
    dispose(group);
    groups.splice(groups.indexOf(group), 1);
    expect(disposed).toHaveBeenCalledTimes(1);
  });
});
