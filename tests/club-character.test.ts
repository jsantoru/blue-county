import { afterEach, describe, expect, it, vi } from "vitest";
import * as T from "three";
import {
  createClubCharacter,
  type CharacterVisualLike,
} from "../src/club-character";
import { DadCharacterVisual } from "../src/dad-character";
import { CHARACTER_SEAT_ANCHOR } from "../src/character-visual";
import {
  steeringWheelGrip,
  type SteeringWheelSpec,
} from "../src/steering-wheel";
import type { ClubMemberId } from "../src/club-roster";

const source = {
  scene: new T.Group(),
  animations: ["idle", "walk", "run", "seated", "airborne"].map(
    (name) => new T.AnimationClip(name, 1, []),
  ),
};
const wheel: SteeringWheelSpec = {
  node: "SteeringWheel",
  center: [0.398, 1.038, 0.064],
  axis: [0, 0.638, -0.77],
  radius: 0.176,
};
const characters: CharacterVisualLike[] = [];
const create = (
  id: ClubMemberId,
  customWheel = wheel,
  anchor: readonly [number, number, number] = CHARACTER_SEAT_ANCHOR,
) => {
  const character = createClubCharacter(id, source, customWheel, anchor);
  characters.push(character);
  return character;
};
const meshes = (character: CharacterVisualLike) => {
  const result: T.Mesh[] = [];
  character.root.traverse((object) => {
    if (object instanceof T.Mesh) result.push(object);
  });
  return result;
};
afterEach(() =>
  characters.splice(0).forEach((character) => character.dispose()),
);

describe("Lug Nuts character casting", () => {
  it("retains Joe's Blender adapter and labels the other members as provisional", () => {
    const joe = create("joe");
    expect(joe).toBeInstanceOf(DadCharacterVisual);
    expect(joe.root.userData.character.source).toBe("/assets/dad-driver.glb");
    expect(joe.root.userData.character.provisional).toBe(false);
    for (const id of ["lou", "chris", "craig", "ed"] as const) {
      const character = create(id);
      expect(character).not.toBeInstanceOf(DadCharacterVisual);
      expect(character.root.userData.character).toMatchObject({
        memberId: id,
        provisional: true,
        source: "procedural club stand-in",
      });
      expect(character.root.userData.character.likeness).toContain(
        "not based on a supplied photo",
      );
      for (const name of [
        "head",
        "hips",
        "left_hand",
        "right_hand",
        "left_foot",
        "right_foot",
      ])
        expect(
          character.root.getObjectByName(name),
          `${id}: ${name}`,
        ).toBeDefined();
      const bounds = new T.Box3().setFromObject(character.root);
      expect(bounds.min.y).toBeGreaterThan(-0.001);
      expect(bounds.max.y).toBeGreaterThan(1.7);
      expect(bounds.max.y).toBeLessThan(1.85);
    }
  });

  it("renders distinct jacket colors and hair geometry instead of recoloring the Dad asset", () => {
    const jackets: number[][] = [],
      hairCounts: number[] = [];
    for (const id of ["lou", "chris", "craig", "ed"] as const) {
      const character = create(id);
      const jacket = character.root.getObjectByName(
        "jacket and shirt",
      ) as T.Mesh;
      jackets.push(
        Array.from(jacket.geometry.getAttribute("color").array).slice(0, 3),
      );
      const hair = character.root.getObjectByName(
        "face and short hair",
      ) as T.Mesh;
      hairCounts.push(hair.geometry.getAttribute("position").count);
      expect(
        meshes(character).every((mesh) => !(mesh instanceof T.SkinnedMesh)),
      ).toBe(true);
    }
    expect(new Set(jackets.map((color) => color.join(","))).size).toBe(4);
    expect(new Set(hairCounts).size).toBeGreaterThanOrEqual(3);
  });

  it.each([-0.5, 0, 0.5])(
    "fits a different car's seat and tilted steering rim at steering %f",
    (steering) => {
      const anchor = [0.51, 0.16, -0.41] as const;
      const customWheel: SteeringWheelSpec = {
        ...wheel,
        center: wheel.center.map(
          (value, i) => value + anchor[i] - CHARACTER_SEAT_ANCHOR[i],
        ) as [number, number, number],
        axis: [0, 0.5, -Math.sqrt(0.75)],
      };
      const car = new T.Group();
      car.position.set(12, 3, -8);
      car.rotation.y = 0.73;
      const character = create("lou", customWheel, anchor);
      character.root.position.set(...anchor);
      car.add(character.root);
      character.update({ pose: "seated", speed: 0, time: 0, steering, dt: 0 });
      for (const [label, side] of [
        ["left", 1],
        ["right", -1],
      ] as const) {
        const wrist = character.root
          .getObjectByName(`${label}_hand`)!
          .getWorldPosition(new T.Vector3());
        const grip = car.localToWorld(
          steeringWheelGrip(customWheel, side, steering),
        );
        expect(wrist.distanceTo(grip)).toBeLessThan(0.002);
      }
      expect(character.root.position.toArray()).toEqual([...anchor]);
    },
  );

  it("blends seated transfers continuously and restores ordinary walking", () => {
    const character = create("craig");
    character.root.position.set(8, 2, -4);
    character.root.rotation.y = 0.6;
    const hips = character.root.getObjectByName("hips")!;
    const wrist = character.root.getObjectByName("left_hand")!;
    const heights: number[] = [];
    let previous: T.Vector3 | undefined;
    for (let step = 0; step <= 20; step++) {
      character.update({
        pose: "idle",
        speed: 0,
        time: 0,
        seatedBlend: step / 20,
        steering: 0.2,
      });
      heights.push(hips.position.y);
      const point = wrist.getWorldPosition(new T.Vector3());
      if (previous) expect(point.distanceTo(previous)).toBeLessThan(0.09);
      previous = point;
    }
    expect(heights[0]).toBeCloseTo(0.94);
    expect(heights.at(-1)).toBeCloseTo(0.65);
    expect(
      heights.every((height, i) => i === 0 || height <= heights[i - 1]),
    ).toBe(true);
    character.update({ pose: "idle", speed: 0, time: 0, seatedBlend: 0 });
    expect(hips.position.y).toBeCloseTo(0.94);
    for (let i = 0; i < 60; i++)
      character.update({ pose: "walk", speed: 2.5, time: i / 60, dt: 1 / 60 });
    expect(new T.Box3().setFromObject(character.root).min.y).toBeCloseTo(
      2.005,
      2,
    );
    expect(character.root.position.toArray()).toEqual([8, 2, -4]);
    expect(character.root.rotation.y).toBe(0.6);
  });

  it("owns resources per instance and disposes without damaging another member", () => {
    const first = create("chris"),
      second = create("ed");
    const owned = meshes(first),
      survivor = meshes(second);
    const geometryDisposal = owned.map((mesh) =>
      vi.spyOn(mesh.geometry, "dispose"),
    );
    const material = owned[0].material as T.Material;
    const materialDisposal = vi.spyOn(material, "dispose");
    expect(survivor[0].geometry).not.toBe(owned[0].geometry);
    expect(survivor[0].material).not.toBe(material);
    first.dispose();
    first.dispose();
    geometryDisposal.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1));
    expect(materialDisposal).toHaveBeenCalledTimes(1);
    second.update({ pose: "run", speed: 5.7, time: 1, dt: 1 / 60 });
    expect(new T.Box3().setFromObject(second.root).isEmpty()).toBe(false);
  });
});
