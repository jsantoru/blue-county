import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { type ClubMember, type ClubMemberId } from "./club-roster";
import type { SteeringWheelSpec } from "./steering-wheel";

export interface ClubVehicleManifest {
  name: string;
  wheels: {
    center: [number, number, number];
    radius: number;
    steerNode: string;
    spinNode: string;
    steering: boolean;
  }[];
  steeringWheel: SteeringWheelSpec;
  characterSeatAnchor?: [number, number, number];
  bodyStyle?: "coupe" | "convertible" | "wagon";
  runtimeIntegration?: {
    visualOffsetFromChassis?: number[];
    chassisColliderHalfExtents?: number[];
    chassisColliderCenterOffset?: number[];
  };
}

export interface ClubVehicleAsset {
  scene: T.Group;
  manifest: ClubVehicleManifest;
}

/** Cache immutable source scenes; each playable car receives a separate clone. */
export class ClubAssets {
  private readonly cache = new Map<ClubMemberId, Promise<ClubVehicleAsset>>();
  constructor(private readonly loader = new GLTFLoader()) {}

  load(member: ClubMember): Promise<ClubVehicleAsset> {
    const saved = this.cache.get(member.id);
    if (saved) return saved;
    const pending = Promise.all([
      this.loader.loadAsync(member.asset),
      fetch(member.manifest).then((response) => {
        if (!response.ok)
          throw new Error(`Couldn’t load ${member.name}’s car details.`);
        return response.json() as Promise<ClubVehicleManifest>;
      }),
    ])
      .then(([gltf, manifest]) => {
        const needed = [
          "DoorHinge_L",
          "DoorHinge_R",
          manifest.steeringWheel?.node,
          ...manifest.wheels.flatMap((wheel) => [
            wheel.steerNode,
            wheel.spinNode,
          ]),
        ];
        if (
          manifest.wheels.length !== 4 ||
          needed.some((name) => !name || !gltf.scene.getObjectByName(name))
        )
          throw new Error(
            `${member.name}’s car is missing an interactive part.`,
          );
        gltf.scene.traverse((object) => {
          if (object instanceof T.Mesh) {
            object.castShadow = true;
            object.receiveShadow = true;
          }
        });
        return { scene: gltf.scene, manifest };
      })
      .catch((error) => {
        this.cache.delete(member.id);
        throw error;
      });
    this.cache.set(member.id, pending);
    return pending;
  }
}
