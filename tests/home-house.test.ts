import { afterEach, describe, expect, it } from "vitest";
import * as T from "three";
import { buildHomeHouse } from "../src/home-house";
import type { HomeFrame } from "../src/home-reference";

const groups: T.Group[] = [];
const frame: HomeFrame = {
  center: [10, 20],
  right: [0, 1],
  back: [1, 0],
  width: 15,
  depth: 10,
  groundY: 0.12,
  lowerFloorY: 0,
  upperFloorY: 2.25,
  entryFloorY: 0.58,
  eaveY: 4.5,
  ridgeY: 6,
  point: (u, y, v) => new T.Vector3(10 + v, y, 20 + u),
};
function build() {
  const group = buildHomeHouse(frame);
  group.updateMatrixWorld(true);
  groups.push(group);
  return group;
}
function cast(
  group: T.Group,
  origin: T.Vector3,
  direction: T.Vector3,
  far = 2,
) {
  return new T.Raycaster(origin, direction, 0, far).intersectObjects(
    group.children,
    false,
  );
}
afterEach(() => {
  const materials = new Set<T.MeshStandardMaterial>();
  const textures = new Set<T.Texture>();
  for (const group of groups.splice(0))
    for (const child of group.children) {
      const mesh = child as T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>;
      mesh.geometry.dispose();
      materials.add(mesh.material);
    }
  for (const material of materials) {
    for (const value of Object.values(material))
      if (value instanceof T.Texture) textures.add(value);
    material.dispose();
  }
  for (const texture of textures) texture.dispose();
});

describe("photo-specific Home facade", () => {
  it("leaves true front/side wall openings with inset glass under a reflected map frame", () => {
    const group = build();
    // A point in the left pane, avoiding its real center sash/mullion.
    const front = cast(
      group,
      frame.point(-15 * 0.367 - 0.34, 3.44, -6),
      new T.Vector3(1, 0, 0),
    );
    expect(front.length).toBeGreaterThan(0);
    expect(front[0].object.userData.homeMaterial).toBe("glass");
    expect(front[0].distance).toBeCloseTo(1.07, 2);
    expect(
      front.filter((h) => h.object.userData.homeMaterial === "siding"),
    ).toHaveLength(0);
    // The right-side slider glass is also recessed, not hidden by a solid side wall.
    const side = cast(
      group,
      frame.point(8.5, 3.1, 0.75),
      new T.Vector3(0, 0, -1),
    );
    expect(side[0].object.userData.homeMaterial).toBe("glass");
    expect(
      side.filter((h) => h.object.userData.homeMaterial === "siding"),
    ).toHaveLength(0);
    const solid = cast(group, frame.point(0, 2.83, -6), new T.Vector3(1, 0, 0));
    expect(solid.some((h) => h.object.userData.homeMaterial === "siding")).toBe(
      true,
    );
    // A clapboard's broad face slopes out toward its bottom; horizontal lip
    // shelves previously produced bright subpixel dashes along every course.
    expect(solid[0].face!.normal.y).toBeGreaterThan(0.1);
  });

  it("faces the roof upward after baking the photo frame and preserves the observed broad ridge", () => {
    const group = build();
    const ray = cast(
      group,
      frame.point(0, 8, -2.5),
      new T.Vector3(0, -1, 0),
      6,
    );
    const roof = ray.find((h) => h.object.userData.homeMaterial === "roof");
    expect(roof).toBeDefined();
    expect(roof!.face!.normal.y).toBeGreaterThan(0.85);
    const expected =
      frame.ridgeY -
      (2.5 / (frame.depth / 2 + 0.39)) * (frame.ridgeY - frame.eaveY);
    expect(roof!.point.y).toBeCloseTo(expected, 4);
    const other = cast(
      group,
      frame.point(5, 8, -2.5),
      new T.Vector3(0, -1, 0),
      6,
    ).find((h) => h.object.userData.homeMaterial === "roof");
    expect(other!.point.y).toBeCloseTo(roof!.point.y, 5);
  });

  it("keeps the distinctive asymmetric facade and vertically aligned driveway-side openings", () => {
    const group = build();
    const details = group.userData.homeHouse;
    const openings = details.openings;
    const entry = openings.find((o: { id: string }) => o.id === "front-entry");
    const picture = openings.find(
      (o: { id: string }) => o.id === "front-upper-picture",
    );
    const patio = openings.find(
      (o: { id: string }) => o.id === "right-patio-red-door",
    );
    const sliders = openings.find(
      (o: { id: string }) => o.id === "right-deck-sliders",
    );
    expect(entry.center / frame.width + 0.5).toBeCloseTo(0.62);
    expect(picture.kind).toBe("picture");
    expect(picture.center).toBeGreaterThan(entry.center);
    expect(sliders.centerWorld[0]).toBe(patio.centerWorld[0]);
    expect(sliders.centerWorld[2]).toBe(patio.centerWorld[2]);
    expect(sliders.bottom).toBeGreaterThan(patio.top);
    expect(group.children.length).toBeLessThanOrEqual(20);
    for (const mesh of group.children as T.Mesh[]) {
      const position = mesh.geometry.getAttribute("position");
      expect(Array.from(position.array).every(Number.isFinite)).toBe(true);
    }
  });

  it("closes the roof overhang from below beside the deck and front wall", () => {
    const group = build();
    for (const position of [
      frame.point(frame.width / 2 + 0.2, 4.8, 2.5),
      frame.point(0, 4, -frame.depth / 2 - 0.2),
    ]) {
      const underside = cast(group, position, new T.Vector3(0, 1, 0));
      expect(underside.length).toBeGreaterThan(0);
      expect(underside[0].object.userData.homeMaterial).toBe("trim");
      expect(underside[0].distance).toBeLessThan(0.6);
    }
  });
});
