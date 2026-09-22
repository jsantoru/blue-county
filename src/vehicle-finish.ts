import * as T from "three";

export type VehicleSurface =
  "paint" | "chrome" | "glass" | "rubber" | "vinyl" | "wood" | "other";

const homeReflectionGain: Partial<Record<VehicleSurface, number>> = {
  paint: 0.18,
  chrome: 0.45,
  glass: 0.25,
  wood: 0.35,
};

function surface(name: string): VehicleSurface {
  const n = name.toLowerCase();
  if (
    /lacquer|carousel red|samoan bronze|graphite \(temporary|deep blue with/.test(
      n,
    )
  )
    return "paint";
  if (/automotive glass|lightly tinted glass/.test(n)) return "glass";
  if (/polished.*chrome|machined alloy|argent silver/.test(n)) return "chrome";
  if (/rubber/.test(n)) return "rubber";
  if (/vinyl|upholstery/.test(n)) return "vinyl";
  if (/walnut|ash framing/.test(n)) return "wood";
  return "other";
}

/** Player-only finish. Authored colors/maps are retained; cached GLB materials
 * remain untouched so changing members cannot leak finish state across cars. */
export class VehicleFinish {
  readonly materials = new Set<T.MeshStandardMaterial>();
  readonly statistics: Record<VehicleSurface, number> = {
    paint: 0,
    chrome: 0,
    glass: 0,
    rubber: 0,
    vinyl: 0,
    wood: 0,
    other: 0,
  };
  private reflective: T.MeshStandardMaterial[] = [];
  private reflectionStrength = new Map<T.MeshStandardMaterial, number>();
  private local = false;
  private disposed = false;

  constructor(root: T.Object3D) {
    const copies = new Map<T.Material, T.Material>();
    const own = (source: T.Material) => {
      const previous = copies.get(source);
      if (previous) return previous;
      if (!(source instanceof T.MeshStandardMaterial)) return source;
      const kind = surface(source.name);
      const m =
        source instanceof T.MeshPhysicalMaterial
          ? source.clone()
          : new T.MeshPhysicalMaterial();
      if (!(source instanceof T.MeshPhysicalMaterial))
        T.MeshStandardMaterial.prototype.copy.call(m, source);
      m.defines = { STANDARD: "", PHYSICAL: "" };
      m.name = source.name;
      m.userData = { ...source.userData, heroSurface: kind };
      this.statistics[kind]++;
      if (kind === "paint") {
        // Solid Carousel Red and Buick blue keep their pigment under a gloss coat;
        // the bronze/sapphire/graphite cars have a restrained metallic base.
        m.metalness = /carousel red|deep blue with/i.test(m.name) ? 0.12 : 0.48;
        m.roughness = 0.29;
        m.clearcoat = 1;
        m.clearcoatRoughness = 0.17;
        m.envMapIntensity = 1.12;
      } else if (kind === "chrome") {
        m.metalness = 1;
        m.roughness = /alloy|argent/i.test(m.name) ? 0.22 : 0.135;
        m.envMapIntensity = 1.0;
      } else if (kind === "glass") {
        m.color.lerp(new T.Color(0xe2eeee), 0.74);
        m.metalness = 0;
        m.roughness = 0.07;
        m.transparent = true;
        m.opacity = 0.24;
        m.depthWrite = false;
        m.side = T.DoubleSide;
        m.forceSinglePass = true;
        m.envMapIntensity = 1.1;
      } else if (kind === "rubber") {
        m.metalness = 0;
        m.roughness = 0.83;
        m.envMapIntensity = 0.18;
      } else if (kind === "vinyl") {
        m.metalness = 0;
        m.roughness = 0.56;
        m.envMapIntensity = 0.42;
        m.clearcoat = 0.1;
        m.clearcoatRoughness = 0.48;
      } else if (kind === "wood") {
        m.roughness = 0.46;
        m.clearcoat = 0.3;
        m.clearcoatRoughness = 0.3;
      }
      if (["paint", "rubber", "vinyl"].includes(kind)) {
        m.onBeforeCompile = (shader) => {
          shader.vertexShader =
            "varying vec3 vFinishPosition;\n" + shader.vertexShader;
          shader.vertexShader = shader.vertexShader.replace(
            "#include <begin_vertex>",
            "#include <begin_vertex>\nvFinishPosition = position;",
          );
          shader.fragmentShader =
            "varying vec3 vFinishPosition;\n" + shader.fragmentShader;
          shader.fragmentShader = shader.fragmentShader.replace(
            "#include <roughnessmap_fragment>",
            `
            #include <roughnessmap_fragment>
            // Submillimeter finish breaks perfectly uniform computer surfaces;
            // derivative filtering removes it before it becomes distant sparkle.
            vec3 grainPoint=vFinishPosition*${kind === "paint" ? "720." : "360."};
            float grain=fract(sin(dot(floor(grainPoint),vec3(12.9898,78.233,37.719)))*43758.5453)-.5;
            float visibleGrain=1.-smoothstep(.5,1.8,length(fwidth(grainPoint)));
            roughnessFactor=clamp(roughnessFactor+grain*visibleGrain*${kind === "paint" ? ".035" : ".11"},.09,1.);
          `,
          );
        };
        m.customProgramCacheKey = () => `hero-car-finish-v1-${kind}`;
      }
      if (["paint", "chrome", "glass", "wood"].includes(kind)) {
        this.reflective.push(m);
        this.reflectionStrength.set(m, m.envMapIntensity);
      }
      copies.set(source, m);
      this.materials.add(m);
      return m;
    };
    root.traverse((object) => {
      if (!(object instanceof T.Mesh)) return;
      object.material = Array.isArray(object.material)
        ? object.material.map(own)
        : own(object.material);
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      if (materials.every((m) => m.userData.heroSurface === "glass"))
        object.castShadow = false;
    });
    root.userData.heroFinish = this.statistics;
  }

  useEnvironment(texture: T.Texture | null) {
    const local = texture !== null;
    if (
      this.local === local &&
      this.reflective.every((m) => m.envMap === texture)
    )
      return;
    this.local = local;
    for (const material of this.reflective) {
      material.envMap = texture;
      material.envMapRotation.set(0, 0, 0);
      // Explicit maps bypass scene.environmentIntensity. Balance the captured
      // daylight here so white sky reflections don't bleach the lacquer colors.
      material.envMapIntensity =
        this.reflectionStrength.get(material)! *
        (local
          ? homeReflectionGain[material.userData.heroSurface as VehicleSurface]!
          : 1);
      material.needsUpdate = true;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const material of this.materials) material.dispose();
    this.materials.clear();
    this.reflective.length = 0;
    this.reflectionStrength.clear();
  }
}

/** One static, HDR Home probe shared by all five cars. Capture during loading,
 * excluding cars/actors. No six-camera reflection renders in the gameplay loop. */
export class HomeReflection {
  private target: T.WebGLRenderTarget | null = null;
  readonly position = new T.Vector3();
  capture(
    renderer: T.WebGLRenderer,
    scene: T.Scene,
    position: T.Vector3,
    omit: T.Object3D[],
  ) {
    const visibility = omit.map((object) => object.visible);
    for (const object of omit) object.visible = false;
    const shadows = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    // Rebuild once with omitted actors hidden, then reuse across the six faces.
    renderer.shadowMap.needsUpdate = true;
    const generator = new T.PMREMGenerator(renderer);
    try {
      const next = generator.fromScene(scene, 0.015, 0.2, 2200, {
        size: 256,
        position,
      });
      this.target?.dispose();
      this.target = next;
      this.position.copy(position);
    } finally {
      generator.dispose();
      renderer.shadowMap.autoUpdate = shadows;
      omit.forEach((object, index) => {
        object.visible = visibility[index];
      });
      renderer.shadowMap.needsUpdate = true;
    }
  }
  forPosition(position: T.Vector3, enabled: boolean) {
    return enabled &&
      this.target &&
      Math.hypot(position.x - this.position.x, position.z - this.position.z) <
        85
      ? this.target.texture
      : null;
  }
  get ready() {
    return this.target !== null;
  }
  dispose() {
    this.target?.dispose();
    this.target = null;
  }
}
