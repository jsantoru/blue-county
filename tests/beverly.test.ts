import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { heightAt, nearestRoad } from "../src/roads";
import { buildNeighborhood, type NeighborhoodHouse } from "../src/neighborhood";
import { Vegetation, type BeverlyVegetationSurvey } from "../src/vegetation";
import type { MapData, Point, Road } from "../src/types";

type XZ = [number, number];
type Observation = {
  id: string;
  address: string;
  center: Point;
  photographedFacade: boolean;
  appearanceConfidence: string;
};
interface Survey extends BeverlyVegetationSurvey {
  loop: { points: Point[]; lengthMeters: number; sourceWays: number[] };
  buildingObservations: Observation[];
  driveways: (NonNullable<BeverlyVegetationSurvey["driveways"]>[number] & {
    address: string;
    confidence: string;
    surveyPoints: XZ[];
    traceStatus?: string;
    completion?: string;
  })[];
}
const readJson = (path: string) =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const map = readJson("../public/map/warwick.json") as MapData;
const survey = map.beverlySurvey as Survey;
const verifiedLoop = readJson(
  "../docs/research-beverly/verified-loop-extent.json",
) as {
  osmNodeIds: number[];
  sourceWays: number[];
  lengthMeters: number;
};
const sourceFootprints = readJson(
  "../docs/research-beverly/footprints-local.geojson",
).features as {
  id: number;
  geometry: { type: string; coordinates: unknown };
  properties: { SOURCEDATE?: string };
}[];
const inSurvey = (x: number, z: number) =>
  x >= survey.bounds.minX &&
  x <= survey.bounds.maxX &&
  z >= survey.bounds.minZ &&
  z <= survey.bounds.maxZ;
const xz = (p: Point): XZ => [p[0], p[2]];
const distance = (a: XZ, b: XZ) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function length(points: XZ[]) {
  return points.slice(1).reduce((sum, p, i) => sum + distance(points[i], p), 0);
}
function project(p: XZ, a: XZ, b: XZ) {
  const dx = b[0] - a[0],
    dz = b[1] - a[1];
  const t = Math.max(
    0,
    Math.min(
      1,
      ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1),
    ),
  );
  return { t, distance: distance(p, [a[0] + t * dx, a[1] + t * dz]) };
}
function disposeGroup(group: THREE.Group) {
  const materials = new Set<THREE.Material>();
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    for (const material of Array.isArray(object.material)
      ? object.material
      : [object.material])
      materials.add(material);
  });
  for (const material of materials) material.dispose();
}

describe("Beverly reference data", () => {
  it("closes through the shared OSM junctions and follows source road nodes in order", () => {
    const ids = verifiedLoop.osmNodeIds;
    expect(ids.length).toBeGreaterThan(3);
    expect(ids.at(-1)).toBe(ids[0]);
    expect(survey.loop.sourceWays).toEqual(verifiedLoop.sourceWays);
    const allowedWays = new Set(verifiedLoop.sourceWays.map(String));
    const graph = map.graph as {
      nodes: Record<string, Point>;
      edges: { from: number; to: number; wayId: number }[];
    };
    for (let i = 1; i < ids.length; i++) {
      expect(
        graph.edges.some(
          (edge) =>
            allowedWays.has(String(edge.wayId)) &&
            ((edge.from === ids[i - 1] && edge.to === ids[i]) ||
              (edge.to === ids[i - 1] && edge.from === ids[i])),
        ),
        `source edge ${ids[i - 1]}–${ids[i]}`,
      ).toBe(true);
    }
    const beverly = map.roads.find(
      (road) => road.name === "Beverly Drive",
    ) as Road & { nodeIds: number[] };
    const otherRoads = map.roads.filter((road) => road !== beverly) as (Road & {
      nodeIds?: number[];
      osmWayId?: number;
    })[];
    for (const junction of [beverly.nodeIds[0], beverly.nodeIds.at(-1)!]) {
      expect(ids).toContain(junction);
      expect(
        otherRoads.some(
          (road) =>
            allowedWays.has(String(road.osmWayId ?? road.id)) &&
            road.nodeIds?.includes(junction),
        ),
      ).toBe(true);
    }

    const source = ids.map((id) => xz(graph.nodes[String(id)]));
    const cumulative = [0];
    for (let i = 1; i < source.length; i++)
      cumulative.push(cumulative[i - 1] + distance(source[i - 1], source[i]));
    const path = survey.loop.points.map(xz);
    expect(distance(path[0], path.at(-1)!)).toBeLessThan(0.002);
    let previousProgress = -1;
    for (const p of path.slice(0, -1)) {
      const matches = source
        .slice(1)
        .map((b, i) => {
          const projection = project(p, source[i], b);
          return {
            distance: projection.distance,
            progress: cumulative[i] + projection.t * distance(source[i], b),
          };
        })
        .sort((a, b) => a.distance - b.distance || a.progress - b.progress);
      expect(matches[0].distance).toBeLessThan(0.003);
      expect(matches[0].progress).toBeGreaterThanOrEqual(
        previousProgress - 0.003,
      );
      previousProgress = matches[0].progress;
      expect(nearestRoad(map, ...p).distance).toBeLessThan(0.003);
    }
    // Retain every bend, even when the renderable path has extra elevation samples.
    for (const node of source)
      expect(Math.min(...path.map((p) => distance(p, node)))).toBeLessThan(
        0.003,
      );
    expect(Math.abs(length(path) - verifiedLoop.lengthMeters)).toBeLessThan(
      0.1,
    );
    expect(Math.abs(length(path) - survey.loop.lengthMeters)).toBeLessThan(0.1);
  });

  it("replaces address boxes with each source footprint inside the survey boundary", () => {
    const mx = 111320 * Math.cos((map.origin.lat * Math.PI) / 180);
    const local = (p: number[]): XZ => [
      (p[0] - map.origin.lon) * mx,
      (map.origin.lat - p[1]) * 111320,
    ];
    const expectedIds = new Set<string>();
    for (const feature of sourceFootprints) {
      const ring =
        feature.geometry.type === "Polygon"
          ? (feature.geometry.coordinates as number[][][])[0]
          : (feature.geometry.coordinates as number[][][][])[0][0];
      const points = ring.map(local),
        vertices = points.slice(0, -1);
      const center = vertices.reduce(
        (sum, p) =>
          [
            sum[0] + p[0] / vertices.length,
            sum[1] + p[1] / vertices.length,
          ] as XZ,
        [0, 0] as XZ,
      );
      if (!inSurvey(...center)) continue;
      const id = `nys-${feature.id}`;
      expectedIds.add(id);
      const matches = map.buildings!.filter((building) => building.id === id);
      expect(matches, id).toHaveLength(1);
      const building = matches[0];
      expect(building.points).toHaveLength(points.length);
      for (let i = 0; i < points.length; i++)
        expect(
          distance(xz(building.points[i]), points[i]),
          `${id} vertex ${i}`,
        ).toBeLessThan(0.002);
      expect(building.approximate).toBe(false);
      expect(building.footprintApproximate).toBe(false);
      expect(building.source).toMatch(/NYS Building Footprints/);
      expect(building.sourceDate).toBe(
        feature.properties.SOURCEDATE ?? "unspecified",
      );
    }
    expect(expectedIds.size).toBeGreaterThan(0);
    expect(
      new Set(survey.buildingObservations.map((observation) => observation.id)),
    ).toEqual(expectedIds);
    for (const building of map.buildings!) {
      const points = (building.points ?? building.footprint) as Point[];
      const center: Point = building.center ?? [
        points.reduce((n, p) => n + p[0], 0) / points.length,
        0,
        points.reduce((n, p) => n + p[2], 0) / points.length,
      ];
      if (inSurvey(center[0], center[2]))
        expect(
          expectedIds.has(String(building.id)),
          `generic envelope ${building.id} remains`,
        ).toBe(true);
    }
  });

  it("keeps photo observations separate from unverified facade placeholders", () => {
    expect(
      [
        ...new Set(
          survey.buildingObservations
            .filter((item) => item.photographedFacade)
            .map((item) => item.address),
        ),
      ].sort(),
    ).toEqual([
      "12 Beverly Dr",
      "2 Beverly Dr",
      "20 Beverly Dr",
      "22 Beverly Dr",
      "26 Beverly Dr",
      "29 Beverly Dr",
      "34 Beverly Dr",
      "35 Beverly Dr",
      "41 Beverly Dr",
    ]);
    expect(
      survey.buildingObservations.some((item) => item.photographedFacade),
    ).toBe(true);
    expect(
      survey.buildingObservations.some((item) => !item.photographedFacade),
    ).toBe(true);
    for (const observation of survey.buildingObservations) {
      const building = map.buildings!.find(
        (item) => item.id === observation.id,
      )!;
      expect(building.address).toBe(observation.address);
      expect(building.appearanceConfidence).toBe(
        observation.appearanceConfidence,
      );
      expect(building.reference.suppressGenericYard).toBe(true);
      expect(typeof observation.photographedFacade).toBe("boolean");
      if (observation.photographedFacade)
        expect(observation.appearanceConfidence).toMatch(/photo-observed/i);
      else {
        expect(observation.appearanceConfidence).toMatch(/unverified/i);
        expect(building.reference).toMatchObject({
          porch: false,
          dormers: false,
          chimney: false,
        });
        for (const detail of [
          "frontGable",
          "stoneLower",
          "bayWindow",
          "shutterColor",
          "doorColor",
        ])
          expect(
            building.reference[detail],
            `${building.address}: unverified ${detail}`,
          ).toBeUndefined();
      }
    }
    const house = (address: string) =>
      map.buildings!.find(
        (item) => item.address === address && item.kind === "house",
      )!;
    expect(house("29 Beverly Dr").reference).toMatchObject({
      stoneLower: true,
      bayWindow: "right",
    });
    expect(house("22 Beverly Dr").reference).toMatchObject({
      frontGable: "small",
      bayWindow: "left",
    });
    expect(house("26 Beverly Dr").reference.frontGable).toBe("small");
    expect(house("41 Beverly Dr").reference).toMatchObject({
      frontGable: "large",
      garageDoors: 0,
    });
    expect(house("34 Beverly Dr").reference).toMatchObject({
      stories: 2,
      porch: true,
    });
    const followup = readJson(
      "../docs/research-streetview/facade-followup-overrides.json",
    );
    expect(followup.facades.map((item: any) => item.address)).toEqual([
      "12 Beverly Dr",
      "20 Beverly Dr",
    ]);
    for (const source of followup.facades) {
      expect(source.sourcePage).toMatch(
        /^https:\/\/www\.zillow\.com\/homedetails\//,
      );
      expect(source.imageUrl).toMatch(/^https:\/\/photos\.zillowstatic\.com\//);
      expect(source.captureDate).toBeNull();
      expect(source.listingContext).toMatch(/MLS/);
      expect(source.unsupportedObservedDetails.length).toBeGreaterThan(0);
      expect(house(source.address).reference).toMatchObject(source.reference);
      // Existing gable/stone presets would invent features absent from these photos.
      expect(house(source.address).reference.frontGable).toBeUndefined();
      expect(house(source.address).reference.stoneLower).toBeUndefined();
    }
    expect(house("12 Beverly Dr").reference.bayWindow).toBe("right");
    expect(house("20 Beverly Dr").reference.bayWindow).toBeUndefined();
  });

  it("retains Home's detached garage and a connected historically supported driveway", () => {
    const homeBuildings = map.buildings!.filter(
      (building) => building.address === "2 Beverly Dr",
    );
    const house = homeBuildings.find((building) => building.kind === "house")!;
    const garage = homeBuildings.find(
      (building) => building.kind === "garage",
    )!;
    expect(house).toBeDefined();
    expect(garage).toBeDefined();
    expect(house.id).not.toBe(garage.id);
    expect(house.reference.garageDoors).toBe(0);
    expect(garage.reference.garageDoors).toBeGreaterThan(0);
    const separation = Math.min(
      ...(house.points as Point[]).flatMap((a) =>
        (garage.points as Point[]).map((b) => distance(xz(a), xz(b))),
      ),
    );
    expect(separation).toBeGreaterThan(2);
    const driveway = survey.driveways.find(
      (item) => item.address === "2 Beverly Dr",
    )!;
    expect(driveway).toMatchObject({
      traceStatus: "reviewed-pavement-outline",
      confidence: "medium",
    });
    expect(driveway.completion).toMatch(/canopy-obscured/);
    expect(driveway.points.slice(-driveway.surveyPoints.length)).toEqual(
      driveway.surveyPoints,
    );
    expect(length(driveway.points)).toBeGreaterThan(30);
    const homeSurfaces = map.beverlySurvey.drivewaySurfaces.filter(
      (s: any) => s.address === "2 Beverly Dr",
    );
    expect(homeSurfaces.some((s: any) => s.evidence === "observed")).toBe(true);
    expect(
      homeSurfaces.some(
        (s: any) =>
          s.evidence === "inferred-occluded" && s.sourceId === "home-2010",
      ),
    ).toBe(true);
  });
});

describe("reference rendering boundaries", () => {
  it("leaves real openings behind recessed glazing instead of an opaque facade box", () => {
    const house: NeighborhoodHouse = {
      id: "window-aperture",
      x: 0,
      z: 0,
      width: 12,
      depth: 12,
      heading: 0,
      base: 0.5,
      low: -0.1,
      wallHeight: 4,
      roadPosition: [0, 0, 30],
      roadWidth: 6,
      reference: {
        style: "raised-ranch",
        frontFace: 0,
        stories: 1,
        garageDoors: 0,
        porch: false,
        dormers: false,
        chimney: false,
        suppressGenericYard: true,
      },
    };
    const group = buildNeighborhood([house], {
      heightAt: () => 0,
      roadClearance: () => 100,
    });
    try {
      group.updateMatrixWorld(true);
      const opaque: THREE.Object3D[] = [];
      const samplePoints: THREE.Vector3[] = [];
      group.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        if (!object.name.includes(":referenceGlass:")) {
          opaque.push(object);
          return;
        }
        const p = object.geometry.getAttribute("position"),
          normal = object.geometry.getAttribute("normal");
        for (let i = 0; i < p.count; i += 3) {
          if (normal.getZ(i) < 0.9) continue;
          const point = new THREE.Vector3();
          for (let j = 0; j < 3; j++)
            point.add(new THREE.Vector3().fromBufferAttribute(p, i + j));
          point.divideScalar(3);
          if (point.z > 5.8 && Math.abs(point.x) < 5.7 && point.y > 2)
            samplePoints.push(point);
        }
      });
      expect(samplePoints.length).toBeGreaterThan(2);
      for (const point of samplePoints) {
        const ray = new THREE.Raycaster(
          point.clone().add(new THREE.Vector3(0, 0, 1)),
          new THREE.Vector3(0, 0, -1),
          0,
          2,
        );
        const hit = ray.intersectObjects(opaque, false)[0];
        expect(
          hit,
          "window should have a visible room backplane",
        ).toBeDefined();
        expect(
          hit.point.z,
          "wall must not fill the window aperture",
        ).toBeLessThan(5.84);
        expect(hit.point.z).toBeGreaterThan(5.65);
      }
    } finally {
      disposeGroup(group);
    }
  });

  it("connects porch-free reference doors to sloped terrain without adding a yard path", () => {
    const terrain = (x: number, z: number) => 0.04 * x - 0.04 * (z - 6);
    for (const style of ["ranch", "raised-ranch"] as const) {
      const house: NeighborhoodHouse = {
        id: `entry-${style}`,
        x: 0,
        z: 0,
        width: 12,
        depth: 12,
        heading: 0,
        base: 0.75,
        low: -0.4,
        wallHeight: style === "ranch" ? 2.9 : 4.4,
        roadPosition: [0, 0, 30],
        roadWidth: 6,
        reference: {
          style,
          frontFace: 0,
          garageDoors: 0,
          porch: false,
          dormers: false,
          chimney: false,
          suppressGenericYard: true,
        },
      };
      const group = buildNeighborhood([house], {
        heightAt: terrain,
        roadClearance: () => 100,
      });
      try {
        group.updateMatrixWorld(true);
        const audit = group.userData.referenceFacades[0];
        expect(audit.entryAccess.steps).toBeGreaterThan(0);
        expect(audit.entryAccess.reachMeters).toBeLessThan(4.6);
        const concrete = group.children.filter((object) =>
          object.name.includes(":referenceConcrete:"),
        );
        const hitHeight = (out: number, fromBelow = false) => {
          const z = house.depth / 2 + out,
            ground = terrain(0, z);
          const ray = new THREE.Raycaster(
            new THREE.Vector3(0, fromBelow ? ground - 5 : 20, z),
            new THREE.Vector3(0, fromBelow ? 1 : -1, 0),
          );
          return ray.intersectObjects(concrete, false)[0]?.point.y;
        };
        const landing = hitHeight(0.54)!;
        expect(Math.abs(landing - (audit.entryBase + 0.06))).toBeLessThan(0.04);
        const steps = audit.entryAccess.steps,
          reach = audit.entryAccess.reachMeters;
        const tread = (reach - 1.08) / steps;
        let previous = landing;
        for (let n = 0; n < steps; n++) {
          const out = 1.08 + (n + 0.5) * tread;
          const top = hitHeight(out)!;
          expect(previous - top).toBeGreaterThan(0);
          expect(previous - top).toBeLessThan(0.21);
          expect(hitHeight(out, true)).toBeLessThanOrEqual(terrain(0, 6 + out));
          previous = top;
        }
        expect(previous - terrain(0, 6 + reach)).toBeLessThan(0.23);
        expect(hitHeight(reach + 0.3)).toBeUndefined();
        expect(
          group.children.some((object) =>
            /:(grass|gravel|leaf):/.test(object.name),
          ),
        ).toBe(false);
      } finally {
        disposeGroup(group);
      }
    }
  });

  it("keeps reference concrete gray without changing shared scans or generic materials", () => {
    const albedo = new THREE.Texture(),
      normal = new THREE.Texture(),
      roughness = new THREE.Texture();
    const supplied = new THREE.MeshStandardMaterial({
      color: 0xcec9ba,
      map: albedo,
      normalMap: normal,
      roughnessMap: roughness,
    });
    const house: NeighborhoodHouse = {
      id: "gray-reference",
      x: 0,
      z: 0,
      width: 12,
      depth: 12,
      heading: 0,
      base: 0.6,
      low: -0.15,
      wallHeight: 4,
      roadPosition: [0, 0, 30],
      roadWidth: 6,
      reference: {
        style: "raised-ranch",
        frontFace: 0,
        garageDoors: 0,
        porch: false,
        dormers: false,
        chimney: false,
        suppressGenericYard: true,
      },
    };
    const group = buildNeighborhood(
      [
        house,
        { ...house, id: "generic-neighbor", x: 45, reference: undefined },
      ],
      {
        heightAt: () => 0,
        roadClearance: () => 100,
        materials: { concrete: supplied },
      },
    );
    try {
      const reference = group.children.filter((object) =>
        object.name.includes(":referenceConcrete:"),
      ) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[];
      const generic = group.children.find((object) =>
        object.name.includes(":concrete:"),
      ) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
      expect(reference.length).toBeGreaterThan(0);
      for (const mesh of reference) {
        expect(mesh.material).not.toBe(supplied);
        expect(mesh.material.map).toBeNull();
        // The floor scan's grooves must not become vertical foundation stripes.
        expect(mesh.material.normalMap).toBeNull();
        expect(mesh.material.roughnessMap).toBeNull();
        expect(mesh.material.color.getHex()).toBe(0xffffff);
        const color = mesh.geometry.getAttribute("color");
        for (let i = 0; i < color.count; i++) {
          expect(color.getX(i)).toBeCloseTo(color.getY(i), 6);
          expect(color.getY(i)).toBeCloseTo(color.getZ(i), 6);
        }
      }
      expect(generic.material.map).toBe(albedo);
      expect(generic.material.color.getHex()).toBe(0xcec9ba);
      expect(supplied.map).toBe(albedo);
      expect(supplied.normalMap).toBe(normal);
      expect(supplied.roughnessMap).toBe(roughness);
      expect(supplied.color.getHex()).toBe(0xcec9ba);
    } finally {
      disposeGroup(group);
      supplied.dispose();
      albedo.dispose();
      normal.dispose();
      roughness.dispose();
    }
  });

  it("fills the survey only from observed crowns/woodlands and keeps unsurveyed interior empty", () => {
    const cropped = { ...map, bounds: survey.bounds };
    const vegetation = new Vegetation(cropped, heightAt, nearestRoad);
    try {
      const audit = vegetation.root.userData.referenceCanopies as {
        center: XZ;
        radiusMeters: number;
        omitted: string | null;
      }[];
      expect(audit).toHaveLength(survey.canopies.length);
      expect(vegetation.stats.referenceTreeCount).toBeGreaterThan(0);
      expect(vegetation.stats.trees).toBe(
        vegetation.stats.referenceTreeCount +
          vegetation.stats.referenceWoodlandTreeCount,
      );
      expect(vegetation.stats.shrubs).toBe(0);
      expect(vegetation.stats.grassTufts).toBe(0);
      expect(audit.filter((item) => !item.omitted)).toHaveLength(
        vegetation.stats.referenceTreeCount,
      );
      expect(audit.filter((item) => item.omitted)).toHaveLength(
        vegetation.stats.referenceOmittedTreeCount,
      );
      for (const canopy of survey.canopies)
        expect(
          audit.some(
            (item) =>
              distance(item.center, canopy.center) < 0.0001 &&
              item.radiusMeters === canopy.radiusMeters,
          ),
        ).toBe(true);
    } finally {
      vegetation.dispose();
    }
    const empty = new Vegetation(
      { ...cropped, beverlySurvey: { ...survey, canopies: [], woodlands: [] } },
      heightAt,
      nearestRoad,
    );
    try {
      expect(empty.stats).toMatchObject({ trees: 0, shrubs: 0, grassTufts: 0 });
    } finally {
      empty.dispose();
    }
  });

  it("projects observed bay glazing on the viewer's chosen side after facade rotation", () => {
    for (const frontFace of [0, 1, 2, 3] as const)
      for (const side of ["left", "right"] as const) {
        const house: NeighborhoodHouse = {
          id: "reference-fixture",
          x: 40,
          z: 70,
          width: 13,
          depth: 15,
          heading: 0.67,
          base: 0.3,
          low: -0.1,
          wallHeight: 4.4,
          roadPosition: [40, 0, 100],
          roadWidth: 6,
          reference: {
            style: "raised-ranch",
            stories: 1,
            frontFace,
            bayWindow: side,
            stoneLower: true,
            frontGable: "small",
            garageDoors: 0,
            porch: false,
            dormers: false,
            chimney: false,
            suppressGenericYard: true,
          },
        };
        const group = buildNeighborhood([house], {
          heightAt: () => 0,
          roadClearance: () => 100,
        });
        try {
          let projectedGlassVertices = 0;
          group.traverse((object) => {
            if (
              !(object instanceof THREE.Mesh) ||
              !/:(glass|referenceGlass):/.test(object.name)
            )
              return;
            const p = object.geometry.getAttribute("position");
            for (let i = 0; i < p.count; i++) {
              const dx = p.getX(i) - house.x,
                dz = p.getZ(i) - house.z;
              const x =
                  dx * Math.cos(house.heading) - dz * Math.sin(house.heading),
                z = dx * Math.sin(house.heading) + dz * Math.cos(house.heading);
              const u = [x, -z, -x, z][frontFace],
                out = [
                  z - house.depth / 2,
                  x - house.width / 2,
                  -z - house.depth / 2,
                  -x - house.width / 2,
                ][frontFace];
              if (out < 0.5) continue;
              projectedGlassVertices++;
              expect(side === "left" ? u < 0 : u > 0).toBe(true);
            }
          });
          expect(projectedGlassVertices).toBeGreaterThan(0);
        } finally {
          disposeGroup(group);
        }
      }
  });
});
