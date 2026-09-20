import { expect, it } from "vitest";
import * as THREE from "three";
import { Vegetation, type BeverlyVegetationSurvey } from "../src/vegetation";
import type { MapData } from "../src/types";

it("preserves measured crown centers/radii through varied shapes and both LODs", () => {
  const bounds = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };
  const canopies: BeverlyVegetationSurvey["canopies"] = [
    4, 7, 5.5, 3.8, 9, 6,
  ].map((radiusMeters, i) => ({
    center: [-60 + i * 23, i % 2 ? 24 : -24],
    radiusMeters,
    type: i < 3 ? "broadleaf" : "conifer",
    confidence: "fixture",
  }));
  const map: MapData = {
    bounds,
    roads: [],
    buildings: [],
    home: { position: [0, 0, 0], heading: 0 },
    route: {
      type: "circuit",
      name: "fixture",
      points: [],
      streets: [],
      laps: 1,
    },
    beverlySurvey: { bounds, canopies },
  };
  const vegetation = new Vegetation(
    map,
    () => 0,
    () => ({ distance: Infinity }),
  );
  try {
    expect(vegetation.stats.referenceTreeCount).toBe(canopies.length);
    const visits = new Map(canopies.map((canopy) => [canopy, 0]));
    const checkedWood = new Set<THREE.BufferGeometry>();
    const matrix = new THREE.Matrix4(),
      a = new THREE.Vector3(),
      b = new THREE.Vector3(),
      c = new THREE.Vector3();
    const ab = new THREE.Vector3(),
      ac = new THREE.Vector3(),
      faceNormal = new THREE.Vector3(),
      smoothNormal = new THREE.Vector3();
    vegetation.root.traverse((object) => {
      if (!(object instanceof THREE.InstancedMesh)) return;
      const material = object.material as THREE.MeshStandardMaterial;
      const positions = object.geometry.getAttribute("position");
      for (const attribute of Object.values(object.geometry.attributes)) {
        expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
      }
      if (material.alphaTest > 0) {
        for (let instance = 0; instance < object.count; instance++) {
          object.getMatrixAt(instance, matrix);
          const canopy = canopies.find(
            (candidate) =>
              Math.hypot(
                matrix.elements[12] - candidate.center[0],
                matrix.elements[14] - candidate.center[1],
              ) < 0.0001,
          );
          expect(canopy).toBeDefined();
          let radius = 0;
          for (let vertex = 0; vertex < positions.count; vertex++) {
            a.fromBufferAttribute(positions, vertex).applyMatrix4(matrix);
            radius = Math.max(
              radius,
              Math.hypot(a.x - canopy!.center[0], a.z - canopy!.center[1]),
            );
          }
          expect(radius).toBeCloseTo(canopy!.radiusMeters, 4);
          visits.set(canopy!, visits.get(canopy!)! + 1);
        }
      } else if (!checkedWood.has(object.geometry)) {
        // Reversing curved stem indices makes bark disappear under back-face
        // culling even though numerical geometry and radius checks still pass.
        checkedWood.add(object.geometry);
        const normals = object.geometry.getAttribute("normal"),
          index = object.geometry.index!;
        for (let triangle = 0; triangle < index.count; triangle += 3) {
          const ia = index.getX(triangle),
            ib = index.getX(triangle + 1),
            ic = index.getX(triangle + 2);
          a.fromBufferAttribute(positions, ia);
          b.fromBufferAttribute(positions, ib);
          c.fromBufferAttribute(positions, ic);
          faceNormal.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a));
          smoothNormal.set(
            normals.getX(ia) + normals.getX(ib) + normals.getX(ic),
            normals.getY(ia) + normals.getY(ib) + normals.getY(ic),
            normals.getZ(ia) + normals.getZ(ib) + normals.getZ(ic),
          );
          expect(faceNormal.dot(smoothNormal)).toBeGreaterThan(0);
        }
      }
    });
    expect([...visits.values()]).toEqual(canopies.map(() => 2));
    expect(checkedWood.size).toBeGreaterThan(1);
  } finally {
    vegetation.dispose();
  }
});
