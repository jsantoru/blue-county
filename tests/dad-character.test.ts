import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";
import * as T from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { DadCharacterVisual } from "../src/dad-character";
import { CHARACTER_SEAT_ANCHOR } from "../src/character-visual";

let source: GLTF;
beforeAll(async () => {
  const data = await readFile("public/assets/dad-driver.glb");
  const jsonLength = data.readUInt32LE(12);
  const document = JSON.parse(data.subarray(20, 20 + jsonLength).toString());
  // Exercise the delivered skin and clips in Node without needing a browser
  // image decoder. The browser review separately verifies the real materials.
  for (const mesh of document.meshes)
    for (const primitive of mesh.primitives) delete primitive.material;
  delete document.materials;
  delete document.textures;
  delete document.images;
  delete document.samplers;
  const json = Buffer.from(JSON.stringify(document));
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32);
  json.copy(padded);
  const binary = data.subarray(20 + jsonLength);
  const output = Buffer.alloc(20 + padded.length + binary.length);
  output.writeUInt32LE(0x46546c67, 0);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(padded.length, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(output, 20);
  binary.copy(output, 20 + padded.length);
  source = await new GLTFLoader().parseAsync(
    output.buffer.slice(
      output.byteOffset,
      output.byteOffset + output.byteLength,
    ),
    "",
  );
});

function bounds(character: DadCharacterVisual) {
  character.root.updateMatrixWorld(true);
  character.root.traverse((object) => {
    if (object instanceof T.SkinnedMesh) object.computeBoundingBox();
  });
  return new T.Box3().setFromObject(character.root);
}

describe("delivered Blender dad character", () => {
  it("does not export fabric color images as tangent-space normal maps", async () => {
    const data = await readFile("public/assets/dad-driver.glb");
    const document = JSON.parse(
      data.subarray(20, 20 + data.readUInt32LE(12)).toString(),
    );
    const fabrics = document.materials.filter(
      (material: any) => material.pbrMetallicRoughness?.baseColorTexture,
    );
    expect(fabrics.length).toBeGreaterThanOrEqual(3);
    for (const material of fabrics) {
      if (!material.normalTexture) continue;
      const color = material.pbrMetallicRoughness.baseColorTexture.index;
      const normal = material.normalTexture.index;
      expect(document.textures[normal].source).not.toBe(
        document.textures[color].source,
      );
    }
  });

  it("includes a real articulated skin and the required in-place animation clips", () => {
    expect(source.animations.map((clip) => clip.name.toLowerCase())).toEqual(
      expect.arrayContaining(["idle", "walk", "run", "airborne", "seated"]),
    );
    let skins = 0;
    source.scene.traverse((object) => {
      if (object instanceof T.SkinnedMesh) {
        skins++;
        expect(object.geometry.getAttribute("skinWeight")).toBeDefined();
        expect(object.skeleton.bones.length).toBeGreaterThanOrEqual(15);
      }
    });
    expect(skins).toBeGreaterThan(0);
    for (const name of [
      "hips",
      "head",
      "left_hand",
      "right_hand",
      "left_foot",
      "right_foot",
    ])
      expect(source.scene.getObjectByName(name)).toBeDefined();
    const character = new DadCharacterVisual(source);
    const box = bounds(character);
    expect(box.min.y).toBeGreaterThan(-0.06);
    expect(box.min.y).toBeLessThan(0.08);
    expect(box.max.y).toBeGreaterThan(1.7);
    expect(box.max.y).toBeLessThan(1.95);
    character.dispose();
  });

  it("fits the actual US-left seat and puts both wrists at the steering rim", () => {
    const character = new DadCharacterVisual(source);
    character.root.position.set(...CHARACTER_SEAT_ANCHOR);
    character.update({ pose: "seated", speed: 0, time: 0, dt: 0 });
    const box = bounds(character);
    expect(box.min.x).toBeGreaterThan(-0.04);
    expect(box.max.x).toBeLessThan(0.88);
    expect(box.max.y).toBeGreaterThan(1.4);
    expect(box.max.y).toBeLessThan(1.72);
    const wheel = new T.Vector3(0.398, 1.038, 0.064);
    for (const side of ["left", "right"]) {
      const wrist = character.root
        .getObjectByName(`${side}_hand`)!
        .getWorldPosition(new T.Vector3());
      expect(wrist.distanceTo(wheel)).toBeLessThan(0.18);
      expect(Math.abs(wrist.y - wheel.y)).toBeLessThan(0.04);
    }
    character.dispose();
  });

  it("keeps instances independent, respects pause, and preserves gameplay root transforms", () => {
    const walking = new DadCharacterVisual(source),
      seated = new DadCharacterVisual(source);
    walking.root.position.set(12, 4, -19);
    walking.root.rotation.y = 0.8;
    seated.update({ pose: "seated", speed: 0, time: 0, dt: 0 });
    const seatedBone = seated.root.getObjectByName("left_thigh")!;
    const seatedRotation = seatedBone.quaternion.clone();
    for (let n = 0; n < 90; n++)
      walking.update({ pose: "run", speed: 5.7, time: n / 60, dt: 1 / 60 });
    expect(bounds(walking).min.y).toBeCloseTo(4, 2);
    expect(seatedBone.quaternion.equals(seatedRotation)).toBe(true);
    const bone = walking.root.getObjectByName("left_thigh")!;
    const pose = bone.quaternion.clone();
    for (let n = 0; n < 15; n++)
      walking.update({ pose: "run", speed: 5.7, time: 2, dt: 0 });
    expect(bone.quaternion.angleTo(pose)).toBeLessThan(0.000001);
    expect(walking.root.position.toArray()).toEqual([12, 4, -19]);
    expect(walking.root.rotation.y).toBe(0.8);
    walking.dispose();
    seated.update({ pose: "walk", speed: 2.5, time: 1, dt: 1 / 60 });
    expect(bounds(seated).isEmpty()).toBe(false);
    seated.dispose();
  });
});
