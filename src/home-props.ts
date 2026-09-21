import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

type Position = [number, number, number];
export interface HomePropPlacements {
  bench: Position;
  wagonWheel: Position;
  birdbath: Position;
  mailbox: Position;
}

const names = {
  bench: "Home_Bench",
  wagonWheel: "Home_WagonWheel",
  birdbath: "Home_Birdbath",
  mailbox: "Home_Mailbox",
} as const;
let template: T.Group | undefined;
let pending: Promise<void> | undefined;

/** Await once during loading, before constructing the neighborhood environment. */
export function preloadHomeProps(): Promise<void> {
  if (template) return Promise.resolve();
  if (!pending)
    pending = new GLTFLoader()
      .loadAsync("/assets/beverly-home-props.glb")
      .then(({ scene }) => {
        for (const name of Object.values(names))
          if (!scene.getObjectByName(name))
            throw new Error(`Home prop kit is missing ${name}`);
        template = scene;
      })
      .catch((error) => {
        pending = undefined;
        throw error;
      });
  return pending;
}

export const homePropsReady = () => !!template;

/** Each environment owns its cloned GPU resources, including base-color maps.
 * Disposing or rebuilding the scene never disposes the cached authoring template. */
export function buildHomeProps(placements: HomePropPlacements): T.Group | null {
  if (!template) return null;
  const root = new T.Group();
  root.name = "Home · Blender authored reference prop kit";
  const clonedMaterials = new Map<T.Material, T.Material>();
  const clonedTextures = new Map<T.Texture, T.Texture>();
  const ownMaterial = (source: T.Material) => {
    let material = clonedMaterials.get(source);
    if (!material) {
      material = source.clone();
      // The kit intentionally uses embedded color maps only, so the existing
      // Environment material/map disposal traversal owns every cloned texture.
      const map = (source as T.MeshStandardMaterial).map;
      if (map) {
        let texture = clonedTextures.get(map);
        if (!texture) {
          texture = map.clone();
          texture.anisotropy = 4;
          texture.needsUpdate = true;
          clonedTextures.set(map, texture);
        }
        (material as T.MeshStandardMaterial).map = texture;
      }
      clonedMaterials.set(source, material);
    }
    return material;
  };
  let triangles = 0,
    batches = 0;
  for (const key of Object.keys(names) as (keyof HomePropPlacements)[]) {
    const original = template.getObjectByName(names[key])!;
    const prop = original.clone(true);
    prop.position.set(...placements[key]);
    prop.updateMatrix();
    prop.traverse((object) => {
      if (!(object instanceof T.Mesh)) return;
      object.geometry = object.geometry.clone();
      object.material = Array.isArray(object.material)
        ? object.material.map(ownMaterial)
        : ownMaterial(object.material);
      object.castShadow = object.receiveShadow = true;
      object.userData.homeHeroProp = key;
      triangles +=
        (object.geometry.index?.count ??
          object.geometry.getAttribute("position").count) / 3;
      batches += Array.isArray(object.material) ? object.material.length : 1;
    });
    root.add(prop);
  }
  root.userData.homeProps = {
    source: "asset-source/beverly-home-props.blend",
    asset: "/assets/beverly-home-props.glb",
    authoredIn: "Blender",
    props: Object.keys(names),
    placements,
    triangles,
    batches,
    resourcesOwnedByEnvironment: true,
    reference:
      "Existing reference-visible bench, wagon wheel, birdbath and number 2 mailbox; same anchors",
  };
  return root;
}
