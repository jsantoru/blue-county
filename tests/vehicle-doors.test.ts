import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VehicleDoors, VEHICLE_DOOR_ANGLE } from "../src/vehicle-doors";

let asset: T.Group;
const manifest = JSON.parse(
  readFileSync(
    new URL("../public/assets/vehicle-manifest.json", import.meta.url),
    "utf8",
  ),
);

beforeAll(async () => {
  const bytes = readFileSync(
    new URL("../public/assets/oldsmobile-442.glb", import.meta.url),
  );
  const gltf = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "",
  );
  asset = gltf.scene;
});

function fixture() {
  const root = asset.clone(true);
  root.updateMatrixWorld(true);
  return { root, doors: new VehicleDoors(root) };
}

describe("actual Blender door export", () => {
  it("keeps the existing closed silhouette, real hinge pivots, US driver layout and wheel wrappers", () => {
    const { root } = fixture();
    const bounds = new T.Box3().setFromObject(root);
    bounds.min
      .toArray()
      .forEach((value, axis) =>
        expect(value).toBeCloseTo(manifest.bounds.min[axis], 4),
      );
    bounds.max
      .toArray()
      .forEach((value, axis) =>
        expect(value).toBeCloseTo(manifest.bounds.max[axis], 4),
      );
    expect(manifest.driveLayout.steeringWheelCenter[0]).toBeGreaterThan(0.39);
    for (const door of manifest.doors) {
      const hinge = root.getObjectByName(door.hingeNode)!;
      hinge
        .getWorldPosition(new T.Vector3())
        .toArray()
        .forEach((value, axis) =>
          expect(value).toBeCloseTo(door.hinge[axis], 5),
        );
      expect(hinge.children[0].name).toBe(door.meshNode);
      expect(door.axis).toEqual([0, 1, 0]);
    }
    for (const wheel of manifest.wheels) {
      expect(root.getObjectByName(wheel.steerNode)).toBeDefined();
      expect(root.getObjectByName(wheel.spinNode)?.parent?.name).toBe(
        wheel.steerNode,
      );
    }
  });

  it("swings the real door surface outward on both sides and leaves the fixed car unchanged", () => {
    const { root, doors } = fixture();
    const body = root.getObjectByName("Body")!;
    const bodyBounds = new T.Box3().setFromObject(body);
    const chassis = root.getObjectByName("Oldsmobile442")!.matrixWorld.clone();
    for (const side of [1, -1] as const) {
      const code = side === 1 ? "L" : "R";
      const mesh = root.getObjectByName(`DoorMesh_${code}`)!;
      const closed = new T.Box3().setFromObject(mesh);
      doors.setOpen(side, 1);
      root.updateMatrixWorld(true);
      const open = new T.Box3().setFromObject(mesh);
      expect(
        side === 1 ? open.max.x - closed.max.x : closed.min.x - open.min.x,
      ).toBeGreaterThan(0.7);
      expect(new T.Box3().setFromObject(body).equals(bodyBounds)).toBe(true);
      expect(
        root.getObjectByName("Oldsmobile442")!.matrixWorld.equals(chassis),
      ).toBe(true);
      const hinge = root.getObjectByName(`DoorHinge_${code}`)!;
      expect(hinge.userData.open_progress).toBe(1);
      expect(hinge.rotation.y).toBeCloseTo(-side * VEHICLE_DOOR_ANGLE);
      doors.closeAll();
      root.updateMatrixWorld(true);
      expect(new T.Box3().setFromObject(mesh).equals(closed)).toBe(true);
    }
  });

  it("opens a genuine doorway through the original body skin instead of moving a duplicate shell", () => {
    const { root, doors } = fixture();
    for (const side of [1, -1] as const) {
      for (const z of [-0.38, -0.12, 0.12]) {
        const ray = new T.Raycaster(
          new T.Vector3(side * 1.45, 0.7, z),
          new T.Vector3(-side, 0, 0),
          0,
          0.7,
        );
        // The outer skin blocks this short ray while latched.
        expect(ray.intersectObject(root, true).length).toBeGreaterThan(0);
        doors.setOpen(side, 1);
        root.updateMatrixWorld(true);
        // Open door + fixed sill/jamb must leave the same passage clear up to
        // the interior card's original line, without changing seat geometry.
        expect(ray.intersectObject(root, true)).toHaveLength(0);
        doors.closeAll();
        root.updateMatrixWorld(true);
      }
    }
    expect(Object.keys(manifest.doorPartitionFaces)).toHaveLength(6);
  });

  it("clamps bad progress, isolates both sides and returns immutable inspection snapshots", () => {
    const { doors } = fixture();
    doors.setOpen(1, 2);
    doors.setOpen(-1, 0.4);
    const saved = doors.getState();
    expect(saved.left.progress).toBe(1);
    expect(saved.right.progress).toBe(0.4);
    saved.left.progress = 999;
    expect(doors.getState().left.progress).toBe(1);
    doors.setOpen(1, NaN);
    expect(doors.getState().left.progress).toBe(0);
    expect(doors.getState().right.progress).toBe(0.4);
    doors.setOpen(-1, -3);
    expect(doors.getState().right.progress).toBe(0);
    expect(() => new VehicleDoors(new T.Group())).toThrow(/hinges/);
  });
});
