import { afterEach, describe, expect, it } from "vitest";
import * as T from "three";
import {
  buildRiparianPlants,
  type RiparianPlant,
} from "../src/riparian-plants";

const groups: T.Group[] = [];
function build(plants: RiparianPlant[]) {
  const group = buildRiparianPlants(plants);
  groups.push(group);
  return group;
}
afterEach(() => {
  const materials = new Set<T.Material>();
  for (const group of groups.splice(0))
    for (const object of group.children) {
      const mesh = object as T.InstancedMesh;
      mesh.geometry.dispose();
      mesh.dispose();
      (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(
        (m) => materials.add(m),
      );
    }
  materials.forEach((m) => m.dispose());
});

describe("riparian understory meshes", () => {
  it("uses six stable batches for a woodland of finite three-dimensional plants", () => {
    const plants = (["fern", "sedge", "shrub", "sapling"] as const).flatMap(
      (kind, row) =>
        Array.from({ length: 30 }, (_, i) => ({
          x: i * 2.1,
          y: row * 0.1,
          z: row * 3,
          kind,
          scale: 0.8 + i * 0.01,
          yaw: i * 0.39,
        })),
    );
    const group = build(plants);
    expect(group.children).toHaveLength(6);
    expect(group.userData.riparianPlants.counts).toEqual({
      fern: 30,
      sedge: 30,
      shrub: 30,
      sapling: 30,
    });
    for (const prototype of Object.values(
      group.userData.riparianPlants.prototypes,
    ) as { triangles: number; height: number; radius: number }[]) {
      expect(prototype.triangles).toBeLessThan(2000);
      expect(prototype.height).toBeGreaterThan(0.4);
      expect(prototype.radius).toBeGreaterThan(0.25);
    }
    for (const mesh of group.children as T.InstancedMesh[]) {
      expect(mesh.count).toBe(30);
      expect(
        Array.from(mesh.geometry.getAttribute("position").array).every(
          Number.isFinite,
        ),
      ).toBe(true);
      expect(
        Array.from(mesh.geometry.getAttribute("normal").array).every(
          Number.isFinite,
        ),
      ).toBe(true);
      expect(Array.from(mesh.instanceMatrix.array).every(Number.isFinite)).toBe(
        true,
      );
      expect(mesh.geometry.boundingBox!.max.y).toBeGreaterThan(
        mesh.geometry.boundingBox!.min.y + 0.4,
      );
      if (
        mesh.userData.riparianKind === "fern" ||
        mesh.userData.riparianKind === "sedge"
      )
        expect(mesh.castShadow).toBe(false);
      if (mesh.userData.riparianPart === "leaf")
        expect((mesh.material as T.MeshStandardMaterial).side).toBe(
          T.DoubleSide,
        );
      const matrix = new T.Matrix4();
      mesh.getMatrixAt(17, matrix);
      const origin = new T.Vector3().applyMatrix4(matrix);
      const source = plants.filter(
        (p) => p.kind === mesh.userData.riparianKind,
      )[17];
      expect(origin.x).toBeCloseTo(source.x, 5);
      expect(origin.y).toBeCloseTo(source.y, 5);
      expect(origin.z).toBeCloseTo(source.z, 5);
    }
    const repeated = build(plants);
    expect(
      (repeated.children[0] as T.Mesh).geometry.getAttribute("position").array,
    ).toEqual(
      (group.children[0] as T.Mesh).geometry.getAttribute("position").array,
    );
  });

  it("does not emit empty batches or propagate invalid placement coordinates", () => {
    const group = build([
      { x: NaN, y: 0, z: 0, kind: "fern", scale: 1, yaw: 0 },
      { x: 0, y: 0, z: 0, kind: "shrub", scale: 0, yaw: 0 },
      { x: 0, y: 0, z: 0, kind: "sedge", scale: 1, yaw: 0 },
    ]);
    expect(group.children).toHaveLength(1);
    expect(group.userData.riparianPlants.omitted).toBe(2);
    expect(build([]).children).toHaveLength(0);
  });
});
