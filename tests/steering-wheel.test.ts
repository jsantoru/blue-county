import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { SteeringWheelVisual } from "../src/steering-wheel";

const manifest = JSON.parse(
  readFileSync("public/assets/vehicle-manifest.json", "utf8"),
);
let asset: T.Group;
beforeAll(async () => {
  const bytes = readFileSync("public/assets/oldsmobile-442.glb");
  asset = (
    await new GLTFLoader().parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      "",
    )
  ).scene;
});

describe("exported steering wheel", () => {
  it.each([-0.4, 0.4])(
    "rotates real rim geometry in the correct direction for steer %f",
    (steering) => {
      const root = asset.clone(true);
      const wheel = new SteeringWheelVisual(root, manifest.steeringWheel);
      root.updateMatrixWorld(true);
      const pivot = root.getObjectByName(manifest.steeringWheel.node)!;
      const center = pivot.getWorldPosition(new T.Vector3());
      center
        .toArray()
        .forEach((v, i) =>
          expect(v).toBeCloseTo(manifest.steeringWheel.center[i], 5),
        );
      const body = root.getObjectByName("Body")!;
      const bodyBounds = new T.Box3().setFromObject(body);
      const point = new T.Vector3();
      let left = new T.Vector3(-Infinity, 0, 0);
      pivot.traverse((object) => {
        if (!(object instanceof T.Mesh)) return;
        const positions = object.geometry.getAttribute("position");
        for (let i = 0; i < positions.count; i++) {
          point
            .fromBufferAttribute(positions, i)
            .applyMatrix4(object.matrixWorld);
          if (point.x > left.x) left.copy(point);
        }
      });
      expect(left.x - center.x).toBeGreaterThan(0.17);
      const local = pivot.worldToLocal(left.clone());
      wheel.update(steering);
      root.updateMatrixWorld(true);
      const rotated = pivot.localToWorld(local.clone());
      expect(Math.sign(rotated.y - left.y)).toBe(-Math.sign(steering));
      expect(rotated.distanceTo(center)).toBeCloseTo(
        left.distanceTo(center),
        6,
      );
      expect(
        pivot.getWorldPosition(new T.Vector3()).distanceTo(center),
      ).toBeLessThan(1e-7);
      expect(new T.Box3().setFromObject(body).equals(bodyBounds)).toBe(true);
      wheel.update(0);
      root.updateMatrixWorld(true);
      expect(pivot.localToWorld(local).distanceTo(left)).toBeLessThan(1e-6);
    },
  );
});
