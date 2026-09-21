import { afterEach, describe, expect, it, vi } from "vitest";
import * as T from "three";
import {
  CHARACTER_SEAT_ANCHOR,
  CharacterVisual,
} from "../src/character-visual";

const characters: CharacterVisual[] = [];
const create = () => {
  const character = new CharacterVisual();
  characters.push(character);
  return character;
};
afterEach(() => characters.splice(0).forEach((c) => c.dispose()));

function meshes(character: CharacterVisual) {
  const result: T.Mesh[] = [];
  character.root.traverse((object) => {
    if (object instanceof T.Mesh) result.push(object);
  });
  return result;
}

describe("replaceable driver visual", () => {
  it("fits a human capsule with feet at zero, a visible face forward, and bounded rendering cost", () => {
    const character = create();
    const bounds = new T.Box3().setFromObject(character.root);
    expect(bounds.min.y).toBeGreaterThanOrEqual(-0.001);
    expect(bounds.min.y).toBeLessThan(0.015);
    expect(bounds.max.y).toBeGreaterThan(1.75);
    expect(bounds.max.y).toBeLessThan(1.81);
    expect(bounds.max.x - bounds.min.x).toBeLessThan(0.7);
    const pieces = meshes(character);
    expect(pieces.length).toBeLessThanOrEqual(16);
    const materials = new Set(pieces.map((m) => m.material));
    expect(materials.size).toBe(1);
    let triangles = 0;
    for (const mesh of pieces) {
      triangles += mesh.geometry.getAttribute("position").count / 3;
      for (const name of ["position", "normal", "color"])
        expect(
          Array.from(mesh.geometry.getAttribute(name).array).every(
            Number.isFinite,
          ),
        ).toBe(true);
      expect(mesh.castShadow && mesh.receiveShadow).toBe(true);
    }
    expect(triangles).toBeLessThan(11000);
    const face = character.root.getObjectByName(
      "face and short hair",
    ) as T.Mesh;
    expect(face.geometry.boundingBox!.max.z).toBeGreaterThan(
      Math.abs(face.geometry.boundingBox!.min.z),
    );
  });

  it("sits in the US driver bucket with both hands near the actual steering wheel", () => {
    const character = create();
    character.root.position.set(...CHARACTER_SEAT_ANCHOR);
    character.update({ pose: "seated", speed: 0, time: 0 });
    const bounds = new T.Box3().setFromObject(character.root);
    expect(bounds.min.x).toBeGreaterThan(0.03);
    expect(bounds.max.x).toBeLessThan(0.78);
    expect(bounds.max.y).toBeGreaterThan(1.43);
    expect(bounds.max.y).toBeLessThan(1.6);
    expect(bounds.min.y).toBeGreaterThan(0.32);
    const wheel = new T.Vector3(0.398, 1.038, 0.064);
    for (const side of ["left", "right"]) {
      const wrist = character.root
        .getObjectByName(`${side} arm end`)!
        .getWorldPosition(new T.Vector3());
      expect(wrist.distanceTo(wheel)).toBeLessThan(0.17);
      expect(Math.abs(wrist.y - wheel.y)).toBeLessThan(0.035);
      expect(Math.abs(wrist.z - wheel.z)).toBeLessThan(0.045);
    }
  });

  it("animates locomotion with supporting feet, retains external transforms, and resets the seated pose", () => {
    const character = create();
    character.root.position.set(17, 38, -24);
    character.root.rotation.y = 1.2;
    const position = character.root.position.clone(),
      rotation = character.root.quaternion.clone();
    let minSwing = Infinity,
      maxSwing = -Infinity;
    for (const pose of ["walk", "run"] as const) {
      for (let i = 0; i < 120; i++) {
        character.update({
          pose,
          speed: pose === "walk" ? 2 : 5,
          time: i / 60,
          dt: 1 / 60,
        });
        const bounds = new T.Box3().setFromObject(character.root);
        expect(bounds.min.y - 38).toBeGreaterThan(-0.004);
        expect(bounds.min.y - 38).toBeLessThan(0.03);
        const swing = character.root.getObjectByName("left leg")!.rotation.x;
        minSwing = Math.min(minSwing, swing);
        maxSwing = Math.max(maxSwing, swing);
      }
    }
    expect(maxSwing - minSwing).toBeGreaterThan(1.3);
    for (const verticalSpeed of [5, -6]) {
      character.update({ pose: "airborne", speed: 3, verticalSpeed, time: 3 });
      meshes(character).forEach((m) =>
        expect(m.matrixWorld.elements.every(Number.isFinite)).toBe(true),
      );
    }
    character.update({ pose: "seated", speed: 0, time: 4, steering: 0.3 });
    character.update({ pose: "idle", speed: 0, time: 0 });
    expect(new T.Box3().setFromObject(character.root).max.y - 38).toBeCloseTo(
      1.773,
      2,
    );
    expect(character.root.position.equals(position)).toBe(true);
    expect(character.root.quaternion.equals(rotation)).toBe(true);
  });

  it("releases each owned GPU resource once and allows another independent character", () => {
    const character = create(),
      other = create();
    const pieces = meshes(character);
    const geometries = new Set(pieces.map((m) => m.geometry));
    const dispose = [...geometries].map((g) => vi.spyOn(g, "dispose"));
    const material = pieces[0].material as T.Material;
    const materialDispose = vi.spyOn(material, "dispose");
    expect(meshes(other)[0].material).not.toBe(material);
    const scene = new T.Scene();
    scene.add(character.root);
    character.dispose();
    character.dispose();
    expect(scene.children).toHaveLength(0);
    dispose.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1));
    expect(materialDispose).toHaveBeenCalledTimes(1);
    other.update({ pose: "walk", speed: 2, time: 0 });
    expect(other.root.children.length).toBeGreaterThan(0);
  });
});
