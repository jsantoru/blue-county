import RAPIER from "@dimforge/rapier3d-compat";
import * as T from "three";
import type { MapData } from "./types";

/** Pedestrian-only obstacles leave the existing vehicle collision layers alone. */
export const EXPLORATION_COLLISION_GROUPS = 0x00080008;
export interface ExplorationObstacleStats {
  trees: number;
  homeTrees: number;
  solidMeshes: number;
  triangles: number;
  colliders: number;
}
export interface ExplorationObstacles {
  readonly stats: ExplorationObstacleStats;
  dispose(): void;
}

/**
 * Add collision to scenery that cars previously treated as decoration. Decks,
 * rails and pool walls follow rendered triangles, including reflected Home
 * transforms; tree leaves remain permeable and their trunks use small cylinders.
 * Call after Environment has assembled its render groups, before any LOD tick.
 */
export function buildExplorationObstacles(
  world: RAPIER.World,
  environmentRoot: T.Group,
  _map: MapData,
  heightAt: (x: number, z: number) => number,
): ExplorationObstacles {
  const colliders: RAPIER.Collider[] = [];
  const stats: ExplorationObstacleStats = {
    trees: 0,
    homeTrees: 0,
    solidMeshes: 0,
    triangles: 0,
    colliders: 0,
  };
  const trunks = new Set<string>();
  const instance = new T.Matrix4();
  const matrix = new T.Matrix4();
  const p = new T.Vector3();
  environmentRoot.updateWorldMatrix(true, true);

  function add(description: RAPIER.ColliderDesc) {
    colliders.push(
      world.createCollider(
        description
          .setCollisionGroups(EXPLORATION_COLLISION_GROUPS)
          .setFriction(0.8)
          .setRestitution(0),
      ),
    );
    stats.colliders++;
  }
  function trunk(
    x: number,
    y: number,
    z: number,
    radius: number,
    home = false,
  ) {
    if (![x, z, radius].every(Number.isFinite) || radius <= 0) return;
    const key = `${x.toFixed(3)},${z.toFixed(3)}`;
    if (trunks.has(key)) return;
    trunks.add(key);
    if (!Number.isFinite(y)) y = heightAt(x, z);
    if (!Number.isFinite(y)) return;
    // Cover the full orbit-camera height as well as the walker's body. Keep
    // the narrow stem radius: branches and leaves never become a crown wall.
    add(
      RAPIER.ColliderDesc.cylinder(
        3,
        T.MathUtils.clamp(radius, 0.1, 1.2),
      ).setTranslation(x, y + 2.98, z),
    );
    stats.trees++;
    if (home) stats.homeTrees++;
  }
  function solid(mesh: T.Mesh) {
    const positions = mesh.geometry.getAttribute("position");
    if (!positions || positions.count < 3) return;
    const vertices = new Float32Array(positions.count * 3);
    for (let i = 0; i < positions.count; i++) {
      p.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
      if (![p.x, p.y, p.z].every(Number.isFinite)) return;
      p.toArray(vertices, i * 3);
    }
    const source = mesh.geometry.index;
    const count = source?.count ?? positions.count;
    const reflected = mesh.matrixWorld.determinant() < 0;
    const indices: number[] = [];
    const a = new T.Vector3(),
      b = new T.Vector3(),
      c = new T.Vector3();
    for (let i = 0; i + 2 < count; i += 3) {
      const ia = source ? source.getX(i) : i;
      const ib = source ? source.getX(i + 1) : i + 1;
      const ic = source ? source.getX(i + 2) : i + 2;
      a.fromArray(vertices, ia * 3);
      b.fromArray(vertices, ib * 3).sub(a);
      c.fromArray(vertices, ic * 3).sub(a);
      if (b.cross(c).lengthSq() < 1e-12) continue;
      indices.push(ia, reflected ? ic : ib, reflected ? ib : ic);
    }
    if (!indices.length) return;
    add(RAPIER.ColliderDesc.trimesh(vertices, new Uint32Array(indices)));
    stats.solidMeshes++;
    stats.triangles += indices.length / 3;
  }

  environmentRoot.traverse((object) => {
    if (object.userData.homeTrees?.trees) {
      // This renderer publishes world positions, even though its source geometry
      // lives in a reflected house frame. Do not transform the metadata twice.
      for (const tree of object.userData.homeTrees.trees)
        trunk(
          ...(tree.position as [number, number, number]),
          tree.radiusMeters,
          true,
        );
    }
    if (
      object instanceof T.InstancedMesh &&
      object.parent?.name.startsWith("Woodlot ")
    ) {
      const material = object.material;
      // Bark is the only opaque, non-alpha-tested instance batch in a woodlot.
      // Both distance LODs have it; position deduplication retains one cylinder.
      if (
        Array.isArray(material) ||
        material.alphaTest > 0 ||
        material.transparent
      )
        return;
      const positions = object.geometry.getAttribute("position");
      let radius = 0;
      for (let i = 0; i < positions.count; i++) {
        const y = positions.getY(i);
        if (y >= 0.25 && y <= 1.1)
          radius = Math.max(
            radius,
            Math.hypot(positions.getX(i), positions.getZ(i)),
          );
      }
      // Low-detail imported trunks may only contain bottom and top rings.
      if (radius < 0.05)
        for (let i = 0; i < positions.count; i++)
          if (Math.abs(positions.getY(i)) < 0.2)
            radius = Math.max(
              radius,
              Math.hypot(positions.getX(i), positions.getZ(i)),
            );
      if (radius < 0.05) return;
      // instanceMatrix.count survives distance/quality reductions to mesh.count.
      for (let i = 0; i < object.instanceMatrix.count; i++) {
        object.getMatrixAt(i, instance);
        matrix.multiplyMatrices(object.matrixWorld, instance);
        p.set(0, 0, 0).applyMatrix4(matrix);
        const elements = matrix.elements;
        const scaleX = Math.hypot(elements[0], elements[1], elements[2]);
        const scaleZ = Math.hypot(elements[8], elements[9], elements[10]);
        trunk(p.x, p.y, p.z, radius * Math.max(scaleX, scaleZ));
      }
      return;
    }
    if (!(object instanceof T.Mesh) || object instanceof T.InstancedMesh)
      return;
    const homeSurface = object.name.startsWith("Home yard · ")
      ? object.name.slice("Home yard · ".length)
      : "";
    if (["wood", "concrete", "roof", "screen", "metal"].includes(homeSurface)) {
      solid(object);
      return;
    }
    const property = object.parent?.userData.propertyDetails;
    if (property) {
      const material = object.material;
      const name = !Array.isArray(material) ? material.name : "";
      if (
        [
          "Property wood",
          "Property stone",
          "Property pool",
          "Property metal",
          "Property sign",
        ].includes(name)
      )
        solid(object);
    }
  });
  let disposed = false;
  return {
    stats,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const collider of colliders) world.removeCollider(collider, false);
      colliders.length = 0;
    },
  };
}
