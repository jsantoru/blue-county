import { describe, expect, it, vi } from "vitest";
import * as T from "three";
import { VehicleFinish } from "../src/vehicle-finish";

describe("player vehicle surface ownership", () => {
  it("gives every car its own layered paint without changing a cached source or geometry", () => {
    const source = new T.MeshStandardMaterial({
      name: "Craig | Samoan Bronze",
      color: 0x98452b,
      roughness: 0.4,
    });
    const geometry = new T.BoxGeometry();
    const original = new T.Mesh(geometry, source);
    const left = new T.Group(),
      right = new T.Group();
    left.add(original.clone());
    right.add(original.clone());
    const a = new VehicleFinish(left),
      b = new VehicleFinish(right);
    const painted = (left.children[0] as T.Mesh)
      .material as T.MeshPhysicalMaterial;
    expect(painted).not.toBe(source);
    expect(painted).not.toBe((right.children[0] as T.Mesh).material);
    expect((left.children[0] as T.Mesh).geometry).toBe(geometry);
    expect(painted.color.equals(source.color)).toBe(true);
    expect(source.roughness).toBe(0.4);
    expect(painted.clearcoat).toBe(1);
    expect(painted.defines).toHaveProperty("PHYSICAL");
    expect(a.statistics.paint).toBe(1);
    a.dispose();
    b.dispose();
    geometry.dispose();
    source.dispose();
  });

  it("keeps authored texture channels and shares one replacement within a car", () => {
    const map = new T.Texture();
    const source = new T.MeshStandardMaterial({ name: "Lou upholstery", map });
    const root = new T.Group();
    root.add(
      new T.Mesh(new T.BoxGeometry(), source),
      new T.Mesh(new T.BoxGeometry(), source),
    );
    const finish = new VehicleFinish(root);
    const material = (root.children[0] as T.Mesh)
      .material as T.MeshPhysicalMaterial;
    expect(material).toBe((root.children[1] as T.Mesh).material);
    expect(material.map).toBe(map);
    const sourceDisposed = vi.fn(),
      textureDisposed = vi.fn(),
      ownedDisposed = vi.fn();
    source.addEventListener("dispose", sourceDisposed);
    map.addEventListener("dispose", textureDisposed);
    material.addEventListener("dispose", ownedDisposed);
    finish.dispose();
    finish.dispose();
    expect(ownedDisposed).toHaveBeenCalledTimes(1);
    expect(sourceDisposed).not.toHaveBeenCalled();
    expect(textureDisposed).not.toHaveBeenCalled();
  });

  it("allows a Home reflection to be released when driving away without changing the source", () => {
    const source = new T.MeshPhysicalMaterial({
      name: "Midnight Sapphire | metallic lacquer",
    });
    const root = new T.Mesh(new T.BoxGeometry(), source);
    const finish = new VehicleFinish(root),
      probe = new T.Texture();
    const own = root.material as T.MeshPhysicalMaterial;
    finish.useEnvironment(probe);
    expect(own.envMap).toBe(probe);
    expect(own.envMapIntensity).toBeCloseTo(1.12 * 0.18);
    expect(source.envMap).toBeNull();
    finish.useEnvironment(null);
    expect(own.envMap).toBeNull();
    expect(own.envMapIntensity).toBe(1.12);
    finish.dispose();
  });

  it("keeps clear glazing from becoming an opaque depth/shadow sheet over the driver", () => {
    const root = new T.Mesh(
      new T.BoxGeometry(),
      new T.MeshStandardMaterial({ name: "Pale smoked automotive glass" }),
    );
    root.castShadow = true;
    const finish = new VehicleFinish(root);
    const glass = root.material as T.MeshPhysicalMaterial;
    expect(glass.transparent).toBe(true);
    expect(glass.depthWrite).toBe(false);
    expect(root.castShadow).toBe(false);
    expect(glass.opacity).toBeGreaterThan(0.1);
    expect(glass.metalness).toBe(0);
    finish.dispose();
  });
});
