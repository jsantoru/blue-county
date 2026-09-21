import RAPIER from "@dimforge/rapier3d-compat";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import * as T from "three";
import { buildExplorationObstacles } from "../src/exploration-obstacles";
import type { MapData } from "../src/types";
import { Vehicle } from "../src/vehicle";
import { footCameraPosition, Pedestrian } from "../src/pedestrian";

beforeAll(async () => {
  await RAPIER.init();
});
const resources: (() => void)[] = [];
afterEach(() =>
  resources
    .splice(0)
    .reverse()
    .forEach((dispose) => dispose()),
);
const map = {
  home: { position: [0, 0, 0], heading: 0 },
  roads: [],
} as unknown as MapData;
function fixture() {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  resources.push(() => world.free());
  const root = new T.Group();
  resources.push(() =>
    root.traverse((object) => {
      if (object instanceof T.Mesh) {
        object.geometry.dispose();
        (Array.isArray(object.material)
          ? object.material
          : [object.material]
        ).forEach((m) => m.dispose());
        if (object instanceof T.InstancedMesh) object.dispose();
      }
    }),
  );
  return { world, root };
}
function cast(world: RAPIER.World, x: number, z: number, groups = 0x0008ffff) {
  return world.castRayAndGetNormal(
    new RAPIER.Ray({ x, y: 15, z }, { x: 0, y: -1, z: 0 }),
    30,
    true,
    undefined,
    groups,
  );
}

describe("pedestrian scenery collisions", () => {
  it("protects a high orbit camera from upper stems without blocking the surrounding crown", () => {
    const { world, root } = fixture();
    const trees = new T.Group();
    trees.userData.homeTrees = {
      trees: [{ position: [0, 0, -1.7], radiusMeters: 0.35 }],
    };
    root.add(trees);
    const obstacles = buildExplorationObstacles(world, root, map, () => 0);
    resources.push(() => obstacles.dispose());
    const pedestrian = new Pedestrian(world);
    world.step();
    const target = new T.Vector3(0, 1.2, 0);
    const desired = new T.Vector3(0, 5.6, -2.2);
    const camera = footCameraPosition(world, pedestrian, target, desired);
    expect(camera.z).toBeGreaterThan(-1.2);
    expect(camera.y).toBeGreaterThan(3.0);
    expect(camera.distanceTo(desired)).toBeGreaterThan(1.0);
    const beside = footCameraPosition(
      world,
      pedestrian,
      target.clone().setX(1.0),
      desired.clone().setX(1.0),
    );
    expect(beside.distanceTo(desired.clone().setX(1.0))).toBeLessThan(0.001);
    const aboveTarget = new T.Vector3(0, 7, 0),
      aboveDesired = new T.Vector3(0, 7, -3);
    expect(
      footCameraPosition(
        world,
        pedestrian,
        aboveTarget,
        aboveDesired,
      ).distanceTo(aboveDesired),
    ).toBeLessThan(0.001);
  });
  it("cannot become an invisible suspension platform for the car", () => {
    const { world, root } = fixture();
    const deck = new T.Mesh(
      new T.BoxGeometry(8, 0.1, 10),
      new T.MeshStandardMaterial(),
    );
    deck.name = "Home yard · wood";
    root.add(deck);
    const obstacles = buildExplorationObstacles(world, root, map, () => -8);
    resources.push(() => obstacles.dispose());
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(30, 0.5, 30)
        .setTranslation(0, -8.5, 0)
        .setCollisionGroups(0x00010007),
    );
    const car = new Vehicle(world, 0, [0, 0.83, 0]);
    world.step();
    expect(cast(world, 0.75, 1.43)).not.toBe(null);
    car.step(
      { steer: 0, throttle: 0, brake: 0, boost: false, handbrake: false },
      1 / 60,
      0,
    );
    expect(car.grounded).toBe(0);
    obstacles.dispose();
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(8, 0.05, 10).setCollisionGroups(0x00010007),
    );
    world.step();
    car.step(
      { steer: 0, throttle: 0, brake: 0, boost: false, handbrake: false },
      1 / 60,
      0,
    );
    expect(car.grounded).toBe(4);
  });
  it("matches transformed and reflected deck geometry without changing car collision masks", () => {
    const { world, root } = fixture();
    const reflected = new T.Group();
    reflected.scale.x = -1;
    reflected.position.set(7, 2, 3);
    reflected.rotation.y = Math.PI / 2;
    root.add(reflected);
    const deck = new T.Mesh(
      new T.BoxGeometry(4, 0.2, 3),
      new T.MeshStandardMaterial(),
    );
    deck.name = "Home yard · wood";
    deck.position.y = 1;
    reflected.add(deck);
    const obstacles = buildExplorationObstacles(world, root, map, () => 0);
    resources.push(() => obstacles.dispose());
    world.step();
    const hit = cast(world, 7, 3)!;
    expect(15 - hit.timeOfImpact).toBeCloseTo(3.1, 4);
    expect(hit.normal.y).toBeGreaterThan(0.99);
    expect(cast(world, 7, 3, 0x00020003)).toBe(null);
    expect(cast(world, 15, 3)).toBe(null);
    expect(obstacles.stats).toMatchObject({
      trees: 0,
      solidMeshes: 1,
      triangles: 12,
      colliders: 1,
    });
    obstacles.dispose();
    obstacles.dispose();
    world.step();
    expect(world.colliders.len()).toBe(0);
  });

  it("uses each actual trunk placement once across quality/distance LODs, leaving foliage permeable", () => {
    const { world, root } = fixture();
    const woodlot = new T.Group();
    woodlot.name = "Woodlot 0,0";
    root.add(woodlot);
    for (let lod = 0; lod < 2; lod++) {
      const trees = new T.InstancedMesh(
        new T.CylinderGeometry(0.32, 0.4, 4, 8).translate(0, 2, 0),
        new T.MeshStandardMaterial(),
        2,
      );
      trees.setMatrixAt(0, new T.Matrix4().makeTranslation(3, 0, 2));
      trees.setMatrixAt(1, new T.Matrix4().makeTranslation(9, 0, 2));
      trees.count = 1;
      if (lod) trees.visible = false;
      woodlot.add(trees);
    }
    const foliage = new T.InstancedMesh(
      new T.CylinderGeometry(3, 3, 4, 8).translate(0, 2, 0),
      new T.MeshStandardMaterial({ alphaTest: 0.42 }),
      1,
    );
    foliage.setMatrixAt(0, new T.Matrix4().makeTranslation(18, 0, 2));
    woodlot.add(foliage);
    const home = new T.Group();
    home.position.x = 100;
    home.userData.homeTrees = {
      trees: [{ position: [23, 0, 2], radiusMeters: 0.45 }],
    };
    root.add(home);
    const obstacles = buildExplorationObstacles(world, root, map, () => 0);
    resources.push(() => obstacles.dispose());
    world.step();
    expect(obstacles.stats).toMatchObject({
      trees: 3,
      homeTrees: 1,
      solidMeshes: 0,
    });
    expect(cast(world, 3, 2)).not.toBe(null);
    expect(cast(world, 9, 2)).not.toBe(null);
    expect(cast(world, 23, 2)).not.toBe(null);
    expect(cast(world, 123, 2)).toBe(null);
    expect(cast(world, 18, 2)).toBe(null);
    expect(cast(world, 3.75, 2)).toBe(null);
  });

  it("includes property deck/pool solids while excluding water and lawn decoration", () => {
    const { world, root } = fixture();
    const property = new T.Group();
    property.userData.propertyDetails = {};
    root.add(property);
    for (const [index, surface] of ["wood", "pool", "water"].entries()) {
      const material = new T.MeshStandardMaterial();
      material.name = `Property ${surface}`;
      const mesh = new T.Mesh(new T.BoxGeometry(2, 1, 2), material);
      mesh.position.set(index * 4, 1, 0);
      property.add(mesh);
    }
    const mulch = new T.Mesh(
      new T.BoxGeometry(2, 0.1, 2),
      new T.MeshStandardMaterial(),
    );
    mulch.name = "Home yard · mulch";
    mulch.position.x = 15;
    root.add(mulch);
    const obstacles = buildExplorationObstacles(world, root, map, () => 0);
    resources.push(() => obstacles.dispose());
    world.step();
    expect(obstacles.stats.solidMeshes).toBe(2);
    expect(cast(world, 0, 0)).not.toBe(null);
    expect(cast(world, 4, 0)).not.toBe(null);
    expect(cast(world, 8, 0)).toBe(null);
    expect(cast(world, 15, 0)).toBe(null);
  });
});
