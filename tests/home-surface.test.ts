import { describe, expect, it } from "vitest";
import * as T from "three";
import {
  createHomeSurface,
  homeSurfaceUV,
  homeWoodUV,
} from "../src/home-surface";
import { buildHomeHouse } from "../src/home-house";
import { buildHomeYard } from "../src/home-yard";
import { buildHomeTrees } from "../src/home-trees";
import type { HomeFrame } from "../src/home-reference";

describe("Home close-up surface assets", () => {
  it("keeps photographic colour encoding separate from linear normal and roughness data", () => {
    for (const finish of ["paint", "wood", "mulch", "concrete"] as const) {
      const maps = createHomeSurface(finish);
      expect(maps.map.colorSpace).toBe(T.SRGBColorSpace);
      expect(maps.normalMap.colorSpace).toBe(T.NoColorSpace);
      expect(maps.roughnessMap.colorSpace).toBe(T.NoColorSpace);
      const pixels = maps.normalMap.image.data;
      for (let i = 0; i < pixels.length; i += 1024) {
        const normal = new T.Vector3(pixels[i], pixels[i + 1], pixels[i + 2])
          .divideScalar(255)
          .multiplyScalar(2)
          .subScalar(1);
        expect(normal.length()).toBeCloseTo(1, 1);
        expect(normal.z).toBeGreaterThan(0.5);
      }
      for (const map of Object.values(maps)) map.dispose();
    }
  });

  it("uses physical scale on the broad facade and runs deck grain along a board", () => {
    const wall = homeSurfaceUV(new T.BoxGeometry(15, 2.25, 0.18));
    const p = wall.getAttribute("position"),
      uv = wall.getAttribute("uv"),
      n = wall.getAttribute("normal");
    for (let i = 0; i < p.count; i++) {
      if (Math.abs(n.getZ(i)) < 0.9) continue;
      expect(uv.getX(i)).toBeCloseTo(p.getX(i), 5);
      expect(uv.getY(i)).toBeCloseTo(p.getY(i), 5);
    }
    const board = homeWoodUV(new T.BoxGeometry(3, 0.05, 0.137));
    const b = board.getAttribute("position"),
      buv = board.getAttribute("uv");
    for (let i = 0; i < b.count; i++)
      expect(buv.getY(i)).toBeCloseTo(b.getX(i) / 2.6, 5);
    wall.dispose();
    board.dispose();
  });

  it("batches the detailed house, garden and trees without a draw call per trim or bark chip", () => {
    const frame: HomeFrame = {
      center: [0, 0],
      right: [1, 0],
      back: [0, 1],
      width: 15,
      depth: 10,
      groundY: 0.12,
      lowerFloorY: 0,
      upperFloorY: 2.25,
      entryFloorY: 0.58,
      eaveY: 4.5,
      ridgeY: 6,
      point: (u, y, v) => new T.Vector3(u, y, v),
    };
    const house = buildHomeHouse(frame),
      yard = buildHomeYard(frame, () => 0),
      trees = buildHomeTrees(frame, () => 0);
    expect(house.children.length).toBeLessThanOrEqual(20);
    expect(yard.children.length).toBeLessThanOrEqual(7);
    expect(trees.children.length).toBe(2);
    const stats = [
      house.userData.homeHouse,
      yard.userData.homeYard,
      trees.userData.homeTrees,
    ];
    expect(stats.reduce((sum, item) => sum + item.triangles, 0)).toBeLessThan(
      80_000,
    );
    const materials = new Set<T.Material>(),
      textures = new Set<T.Texture>();
    for (const group of [house, yard, trees])
      group.traverse((object) => {
        if (!(object instanceof T.Mesh)) return;
        const position = object.geometry.getAttribute("position"),
          uv = object.geometry.getAttribute("uv");
        expect(Array.from(position.array).every(Number.isFinite)).toBe(true);
        expect(uv).toBeDefined();
        expect(Array.from(uv.array).every(Number.isFinite)).toBe(true);
        object.geometry.dispose();
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material])
          materials.add(material);
      });
    for (const material of materials) {
      for (const value of Object.values(material))
        if (value instanceof T.Texture) textures.add(value);
      material.dispose();
    }
    for (const texture of textures) texture.dispose();
  });
});
