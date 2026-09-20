import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import {
  Environment,
  heightAt,
  roadMesh,
  type HeightSampler,
} from "../src/roads";
import type { MapData } from "../src/types";

afterEach(() => vi.unstubAllGlobals());

describe("terrain/road alignment and static rendering budget", () => {
  it("matches the rendered triangle diagonal rather than a bilinear saddle", () => {
    const map = {
      terrain: {
        cols: 2,
        rows: 2,
        minX: 0,
        maxX: 10,
        minZ: 0,
        maxZ: 10,
        heights: [0, 0, 0, 10],
      },
    } as MapData;
    expect(heightAt(map, 5, 5)).toBe(0);
    expect(heightAt(map, 7.5, 7.5)).toBe(5);
    expect(heightAt(map, 10, 10)).toBe(10);
    const sample: HeightSampler = Object.assign(
      (x: number, z: number) => heightAt(map, x, z),
      { terrain: map.terrain },
    );
    const road = roadMesh(
      [
        [1, 0, 5],
        [9, 0, 5],
      ],
      6,
      0x394143,
      0.065,
      sample,
    );
    const positions = road.geometry.getAttribute("position");
    for (let i = 0; i < positions.count; i += 3) {
      const x =
        (positions.getX(i) + positions.getX(i + 1) + positions.getX(i + 2)) / 3;
      const z =
        (positions.getZ(i) + positions.getZ(i + 1) + positions.getZ(i + 2)) / 3;
      const y =
        (positions.getY(i) + positions.getY(i + 1) + positions.getY(i + 2)) / 3;
      expect(Math.abs(y - heightAt(map, x, z) - 0.065)).toBeLessThan(1e-5);
    }
    road.geometry.dispose();
    (road.material as THREE.Material).dispose();
  });

  it("keeps the complete Warwick environment below 100 base draw batches and aligns the southern connector collider", async () => {
    await RAPIER.init();
    vi.stubGlobal("document", {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ fillRect() {}, strokeRect() {}, fillText() {} }),
      }),
    });
    const map = JSON.parse(
      fs.readFileSync(
        new URL("../public/map/warwick.json", import.meta.url),
        "utf8",
      ),
    ) as MapData;
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const environment = new Environment(map, world);
    const batches = environment.root.children.filter(
      (child) => child instanceof THREE.Mesh || child instanceof THREE.Sprite,
    ).length;
    expect(batches).toBeLessThan(100);
    world.step();
    const points = [
      [1118, 327],
      [1113, 326],
      [1110, 326],
      [1107, 328],
    ];
    for (const [x, z] of points) {
      const ground = heightAt(map, x, z);
      const hit = world.castRay(
        new RAPIER.Ray({ x, y: ground + 20, z }, { x: 0, y: -1, z: 0 }),
        30,
        true,
      );
      expect(hit).not.toBeNull();
      const surfaceHeight = ground + 20 - hit!.timeOfImpact;
      // Source road width covers these positions through the old visible sawtooth seam.
      expect(Math.abs(surfaceHeight - ground - 0.065)).toBeLessThan(0.002);
    }
    console.log(
      `Warwick environment: ${batches} base rendering batches; ${environment.colliders.length} static colliders.`,
    );
    environment.dispose();
    world.free();
  }, 20_000);
});
