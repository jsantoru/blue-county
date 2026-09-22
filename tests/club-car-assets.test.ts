import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { ClubVehicleManifest } from "../src/club-assets";
import { createClubCharacter } from "../src/club-character";
import { createVehicleGeometry } from "../src/vehicle";
import { SteeringWheelVisual, steeringWheelGrip } from "../src/steering-wheel";
import { VehicleDoors } from "../src/vehicle-doors";

const ids = ["lou", "chris", "craig", "ed"] as const;
type Member = (typeof ids)[number];
type Manifest = ClubVehicleManifest & {
  rootNode: string;
  bodyNode: string;
  characterSeatAnchor: [number, number, number];
  wheels: (ClubVehicleManifest["wheels"][number] & {
    id: string;
    meshNode: string;
  })[];
  doors: {
    side: 1 | -1;
    hingeNode: string;
    meshNode: string;
    hinge: [number, number, number];
  }[];
};
const delivered = new Map<Member, { scene: T.Group; manifest: Manifest }>();

/** Keep delivered vertices, transforms and material partitions. Strip image
 * decoding (browser-only), retaining names so geometry tests can locate finishes. */
async function parseGeometry(path: string) {
  const bytes = await readFile(path);
  const jsonLength = bytes.readUInt32LE(12);
  const document = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  document.materials = document.materials.map((material: { name: string }) => ({
    name: material.name,
    doubleSided: true,
  }));
  delete document.textures;
  delete document.images;
  delete document.samplers;
  const json = Buffer.from(JSON.stringify(document));
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32);
  json.copy(padded);
  const binary = bytes.subarray(20 + jsonLength);
  const output = Buffer.alloc(20 + padded.length + binary.length);
  output.writeUInt32LE(0x46546c67, 0);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(padded.length, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(output, 20);
  binary.copy(output, 20 + padded.length);
  const gltf = await new GLTFLoader().parseAsync(
    output.buffer.slice(
      output.byteOffset,
      output.byteOffset + output.byteLength,
    ),
    "",
  );
  gltf.scene.traverse((object) => {
    if (!(object instanceof T.Mesh)) return;
    // Geometry clearance must detect either triangle winding, including the
    // inner face of the thin exported roof and door cards.
    for (const material of Array.isArray(object.material)
      ? object.material
      : [object.material])
      material.side = T.DoubleSide;
  });
  gltf.scene.updateMatrixWorld(true);
  return gltf.scene;
}

beforeAll(async () => {
  await Promise.all(
    ids.map(async (id) => {
      const [scene, manifest] = await Promise.all([
        parseGeometry(`public/assets/club-cars/${id}.glb`),
        readFile(`public/assets/club-cars/${id}-manifest.json`, "utf8").then(
          (text) => JSON.parse(text) as Manifest,
        ),
      ]);
      delivered.set(id, { scene, manifest });
    }),
  );
});

function fixture(id: Member) {
  const asset = delivered.get(id)!;
  const root = asset.scene.clone(true);
  root.updateMatrixWorld(true);
  return { root, manifest: asset.manifest };
}

function worldVertices(root: T.Object3D) {
  const vertices: T.Vector3[] = [];
  root.traverse((object) => {
    if (!(object instanceof T.Mesh)) return;
    const positions = object.geometry.getAttribute("position");
    for (let i = 0; i < positions.count; i++)
      vertices.push(
        new T.Vector3()
          .fromBufferAttribute(positions, i)
          .applyMatrix4(object.matrixWorld),
      );
  });
  return vertices;
}

function isDescendant(object: T.Object3D, ancestor: T.Object3D): boolean {
  for (
    let current: T.Object3D | null = object;
    current;
    current = current.parent
  )
    if (current === ancestor) return true;
  return false;
}

describe.each(ids)("delivered %s club car", (id) => {
  it("places actual tires at independent physics mounts with vertical steering and horizontal spin axes", () => {
    const { root, manifest } = fixture(id);
    const geometry = createVehicleGeometry(manifest);
    const body = root.getObjectByName(manifest.bodyNode)!;
    expect(body).toBeDefined();
    const bodyBounds = new T.Box3().setFromObject(body);
    expect(bodyBounds.max.z - bodyBounds.min.z).toBeGreaterThan(4.5);
    expect(bodyBounds.max.z - bodyBounds.min.z).toBeLessThan(6);
    expect(manifest.wheels.map((wheel) => wheel.id)).toEqual([
      "FL",
      "FR",
      "RL",
      "RR",
    ]);
    for (const [i, wheel] of manifest.wheels.entries()) {
      const steer = root.getObjectByName(wheel.steerNode)!;
      const spin = root.getObjectByName(wheel.spinNode)!;
      const tire = root.getObjectByName(wheel.meshNode)!;
      expect(steer).toBeDefined();
      expect(spin.parent).toBe(steer);
      expect(isDescendant(tire, spin)).toBe(true);
      const center = spin.getWorldPosition(new T.Vector3());
      expect(center.distanceTo(new T.Vector3(...wheel.center))).toBeLessThan(
        1e-5,
      );
      const bounds = new T.Box3().setFromObject(tire);
      const measured = bounds.getCenter(new T.Vector3());
      // Tire geometry, not just two matching manifest fields, defines the
      // contact circle. Decorative sidewall/hub geometry may protrude in X.
      expect(measured.y).toBeCloseTo(center.y, 4);
      expect(measured.z).toBeCloseTo(center.z, 4);
      expect(
        Math.abs((bounds.max.y - bounds.min.y) / 2 - wheel.radius),
      ).toBeLessThan(0.012);
      expect(
        Math.abs((bounds.max.z - bounds.min.z) / 2 - wheel.radius),
      ).toBeLessThan(0.012);
      expect(Math.abs(bounds.min.y)).toBeLessThan(0.012);
      expect(bounds.max.x - bounds.min.x).toBeLessThan(wheel.radius * 1.3);
      expect(
        new T.Vector3(0, 1, 0).transformDirection(steer.matrixWorld).y,
      ).toBeGreaterThan(0.9999);
      expect(
        new T.Vector3(1, 0, 0).transformDirection(spin.matrixWorld).x,
      ).toBeGreaterThan(0.9999);
      expect(geometry.wheels[i][0]).toBeCloseTo(center.x, 5);
      expect(geometry.wheels[i][2]).toBeCloseTo(center.z, 5);
      expect(Math.sign(center.x)).toBe(i % 2 ? -1 : 1);
      expect(Math.sign(center.z)).toBe(i < 2 ? 1 : -1);
      expect(Math.abs(center.x - geometry.chassisCenter[0])).toBeLessThan(
        geometry.chassisHalfExtents[0],
      );
      expect(Math.abs(center.z - geometry.chassisCenter[2])).toBeLessThan(
        geometry.chassisHalfExtents[2],
      );
      const side = Math.sign(center.x);
      const axleRay = new T.Raycaster(
        new T.Vector3(side * 1.5, center.y, center.z),
        new T.Vector3(-side, 0, 0),
        0,
        1.5 - Math.abs(center.x) + 0.2,
      );
      expect(
        axleRay.intersectObject(body, true),
        "fixed body must not contain a duplicate tire",
      ).toHaveLength(0);
      // Moving the suspension/steering wrapper must move the full wheel and
      // leave the fixed body alone; no orphan tire should be left in Body.
      steer.position.y += 0.1;
      root.updateMatrixWorld(true);
      expect(new T.Box3().setFromObject(tire).min.y - bounds.min.y).toBeCloseTo(
        0.1,
        5,
      );
      expect(new T.Box3().setFromObject(body).equals(bodyBounds)).toBe(true);
    }
  });

  it("opens the real door skin and inner card on both sides without a fixed duplicate wall", () => {
    const { root, manifest } = fixture(id);
    const doors = new VehicleDoors(root);
    const body = root.getObjectByName(manifest.bodyNode)!;
    const fixedBounds = new T.Box3().setFromObject(body);
    for (const side of [1, -1] as const) {
      const spec = manifest.doors.find((door) => door.side === side)!;
      const hinge = root.getObjectByName(spec.hingeNode)!;
      const surface = root.getObjectByName(spec.meshNode)!;
      expect(isDescendant(surface, hinge)).toBe(true);
      const center = hinge.getWorldPosition(new T.Vector3());
      expect(center.distanceTo(new T.Vector3(...spec.hinge))).toBeLessThan(
        1e-5,
      );
      const closed = new T.Box3().setFromObject(surface);
      expect(center.z).toBeGreaterThan(closed.min.z + 1.2);
      expect(
        new T.Vector3(0, 1, 0).transformDirection(hinge.matrixWorld).y,
      ).toBeGreaterThan(0.9999);
      for (const z of [-0.38, -0.12, 0.12]) {
        // The test crosses the exterior and inner door card, stopping before
        // the seat. It catches a moving shell over an uncut stationary body.
        const ray = new T.Raycaster(
          new T.Vector3(side * 1.5, 0.7, z),
          new T.Vector3(-side, 0, 0),
          0,
          0.81,
        );
        const closedHits = ray.intersectObject(root, true);
        expect(closedHits.length).toBeGreaterThan(0);
        expect(isDescendant(closedHits[0].object, hinge)).toBe(true);
        doors.setOpen(side, 1);
        root.updateMatrixWorld(true);
        expect(
          ray.intersectObject(root, true),
          `blocked open ${spec.hingeNode} at z=${z}`,
        ).toHaveLength(0);
        doors.closeAll();
        root.updateMatrixWorld(true);
      }
      doors.setOpen(side, 1);
      root.updateMatrixWorld(true);
      const opened = new T.Box3().setFromObject(surface);
      expect(
        side === 1 ? opened.max.x - closed.max.x : closed.min.x - opened.min.x,
      ).toBeGreaterThan(0.7);
      expect(
        hinge.getWorldPosition(new T.Vector3()).distanceTo(center),
      ).toBeLessThan(1e-6);
      expect(new T.Box3().setFromObject(body).equals(fixedBounds)).toBe(true);
      doors.closeAll();
      root.updateMatrixWorld(true);
      expect(new T.Box3().setFromObject(surface).equals(closed)).toBe(true);
    }
  });

  it("keeps the tilted steering rim on the US-left side and turns its real geometry with both wrists", () => {
    const { root, manifest } = fixture(id);
    const spec = manifest.steeringWheel;
    const pivot = root.getObjectByName(spec.node)!;
    const center = pivot.getWorldPosition(new T.Vector3());
    expect(center.x).toBeGreaterThan(0.3);
    expect(manifest.characterSeatAnchor[0]).toBeGreaterThan(0.3);
    expect(center.distanceTo(new T.Vector3(...spec.center))).toBeLessThan(1e-5);
    const axis = new T.Vector3(...spec.axis).normalize();
    expect(axis.y).toBeGreaterThan(0.4);
    expect(axis.z).toBeLessThan(-0.5);
    const vertices = worldVertices(pivot);
    expect(vertices.length).toBeGreaterThan(100);
    const left = vertices.reduce((best, point) =>
      point.x > best.x ? point : best,
    );
    expect(left.x - center.x).toBeGreaterThan(spec.radius - 0.01);
    expect(left.x - center.x).toBeLessThan(spec.radius + 0.03);
    const rim = vertices.filter(
      (point) => point.distanceTo(center) > spec.radius - 0.02,
    );
    expect(
      Math.max(
        ...rim.map((point) => Math.abs(point.clone().sub(center).dot(axis))),
      ),
    ).toBeLessThan(0.025);
    const localLeft = pivot.worldToLocal(left.clone());
    const wheel = new SteeringWheelVisual(root, spec);
    const character = createClubCharacter(
      id,
      { scene: new T.Group(), animations: [] },
      spec,
      manifest.characterSeatAnchor,
    );
    character.root.position.set(...manifest.characterSeatAnchor);
    try {
      for (const steering of [-0.4, 0.4]) {
        wheel.update(steering);
        root.updateMatrixWorld(true);
        const turned = pivot.localToWorld(localLeft.clone());
        expect(Math.sign(turned.y - left.y)).toBe(-Math.sign(steering));
        expect(turned.distanceTo(center)).toBeCloseTo(
          left.distanceTo(center),
          5,
        );
        character.update({
          pose: "seated",
          speed: 0,
          time: 0,
          dt: 0,
          steering,
        });
        for (const [name, side] of [
          ["left", 1],
          ["right", -1],
        ] as const) {
          const wrist = character.root
            .getObjectByName(`${name}_hand`)!
            .getWorldPosition(new T.Vector3());
          expect(
            wrist.distanceTo(steeringWheelGrip(spec, side, steering)),
          ).toBeLessThan(0.015);
        }
      }
    } finally {
      character.dispose();
    }
  });

  it("seats the provisional driver above the actual cushion and below the actual roof", () => {
    const { root, manifest } = fixture(id);
    const character = createClubCharacter(
      id,
      { scene: new T.Group(), animations: [] },
      manifest.steeringWheel,
      manifest.characterSeatAnchor,
    );
    character.root.position.set(...manifest.characterSeatAnchor);
    character.update({ pose: "seated", speed: 0, time: 0, dt: 0 });
    const body = root.getObjectByName(manifest.bodyNode)!;
    try {
      const hips = character.root
        .getObjectByName("hips")!
        .getWorldPosition(new T.Vector3());
      const cushion = new T.Raycaster(
        new T.Vector3(hips.x, 1.1, -0.29),
        new T.Vector3(0, -1, 0),
        0,
        1,
      ).intersectObject(body, true)[0];
      expect(cushion).toBeDefined();
      expect(hips.y - cushion.point.y).toBeGreaterThan(0.05);
      expect(hips.y - cushion.point.y).toBeLessThan(0.2);
      const head = new T.Box3().setFromObject(
        character.root.getObjectByName("head")!,
      );
      const center = head.getCenter(new T.Vector3());
      for (const [dx, dz] of [
        [0, 0],
        [-0.065, -0.045],
        [0.065, 0.045],
      ]) {
        const ray = new T.Raycaster(
          new T.Vector3(center.x + dx, 2.3, center.z + dz),
          new T.Vector3(0, -1, 0),
          0,
          2.3 - head.min.y,
        );
        const above = ray.intersectObject(body, true);
        if (id === "craig") {
          expect(
            above,
            "convertible cabin must remain open above the driver",
          ).toHaveLength(0);
        } else {
          expect(
            above.length,
            "a real roof must span the seated driver",
          ).toBeGreaterThan(0);
          const underside = Math.min(...above.map((hit) => hit.point.y));
          expect(
            underside - head.max.y,
            "hair must clear the roof underside",
          ).toBeGreaterThan(0.01);
        }
      }
    } finally {
      character.dispose();
    }
  });
});

it("delivers four different wheelbases instead of four recolored copies of one chassis", () => {
  const wheelbases = ids.map((id) => {
    const { root, manifest } = fixture(id);
    const front = root
      .getObjectByName(manifest.wheels[0].spinNode)!
      .getWorldPosition(new T.Vector3());
    const rear = root
      .getObjectByName(manifest.wheels[2].spinNode)!
      .getWorldPosition(new T.Vector3());
    const wheelbase = front.z - rear.z;
    expect(wheelbase).toBeGreaterThan(2.6);
    expect(wheelbase).toBeLessThan(3.3);
    return wheelbase.toFixed(3);
  });
  expect(new Set(wheelbases).size).toBe(4);
});

describe("Ed's reference wagon woodwork", () => {
  const isWood = (material: T.Material) =>
    /^(Walnut wagon panel|Honey ash framing)/i.test(material.name);
  function woodMeshes(root: T.Object3D) {
    const meshes: T.Mesh[] = [];
    root.traverse((object) => {
      if (!(object instanceof T.Mesh)) return;
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      if (materials.some(isWood)) meshes.push(object);
    });
    return meshes;
  }
  function hitMaterial(root: T.Object3D, side: number, y: number, z: number) {
    const hit = new T.Raycaster(
      new T.Vector3(side * 1.5, y, z),
      new T.Vector3(-side, 0, 0),
      0,
      0.83,
    ).intersectObject(root, true)[0];
    expect(hit, `exterior must exist at ${side},${y},${z}`).toBeDefined();
    const mesh = hit.object as T.Mesh;
    return Array.isArray(mesh.material)
      ? mesh.material[hit.face!.materialIndex]
      : mesh.material;
  }

  it("keeps side wood at the window belt with painted lower doors and rear fenders", () => {
    const { root } = fixture("ed");
    const sideWood = woodMeshes(root)
      .flatMap(worldVertices)
      .filter(
        (point) => Math.abs(point.x) > 0.7 && point.z > -2.3 && point.z < 0.62,
      );
    expect(sideWood.length).toBeGreaterThan(100);
    // The reference's wood cabin sits above the broad painted metal body.
    // This rejects the old panels extending down to the rocker/wheel opening.
    expect(Math.min(...sideWood.map((point) => point.y))).toBeGreaterThan(0.95);
    expect(Math.max(...sideWood.map((point) => point.y))).toBeGreaterThan(1.7);
    for (const side of [1, -1]) {
      for (const z of [-0.35, 0.12])
        expect(hitMaterial(root, side, 0.7, z).name).toMatch(
          /^Ed \| Deep blue/,
        );
      expect(isWood(hitMaterial(root, side, 1.08, -0.1))).toBe(true);
      // Close the daylight slit found in the in-game review above the front
      // and middle window frames; the wooden header must meet the roof.
      for (const z of [-0.35, -1.12])
        expect(isWood(hitMaterial(root, side, 1.802, z))).toBe(true);
      // Raised rear haunch remains painted beneath the cargo-window wood.
      expect(hitMaterial(root, side, 0.94, -1.65).name).toMatch(
        /^Ed \| Deep blue/,
      );
    }
  });

  it("carries the front window wood and narrow infill with both opening doors", () => {
    const { root } = fixture("ed");
    const doors = new VehicleDoors(root);
    for (const side of [1, -1] as const) {
      const hinge = root.getObjectByName(
        `DoorHinge_${side === 1 ? "L" : "R"}`,
      )!;
      const wood = woodMeshes(hinge);
      expect(wood.length).toBeGreaterThan(0);
      const closed = new T.Box3();
      for (const mesh of wood) closed.union(new T.Box3().setFromObject(mesh));
      expect(closed.min.y).toBeGreaterThan(0.95);
      expect(closed.max.y).toBeGreaterThan(1.7);
      doors.setOpen(side, 1);
      root.updateMatrixWorld(true);
      const open = new T.Box3();
      for (const mesh of wood) open.union(new T.Box3().setFromObject(mesh));
      expect(
        side === 1 ? open.max.x - closed.max.x : closed.min.x - open.min.x,
      ).toBeGreaterThan(0.7);
      for (const y of [1.08, 1.38]) {
        const ray = new T.Raycaster(
          new T.Vector3(side * 1.5, y, -0.1),
          new T.Vector3(-side, 0, 0),
          0,
          0.7,
        );
        expect(
          ray.intersectObject(root, true),
          "no fixed veneer or glazing may remain across the opened doorway",
        ).toHaveLength(0);
      }
      doors.closeAll();
      root.updateMatrixWorld(true);
    }
  });
});
