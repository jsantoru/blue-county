import * as T from "three";

/** Local CC0 PBR photographs. All scenery UVs are expressed in meters. */
export function createSurfaceMaterials() {
  const textures = new Set<T.Texture>();
  const manager = new T.LoadingManager();
  const loader =
    typeof window !== "undefined" ? new T.TextureLoader(manager) : null;
  const ready = loader
    ? new Promise<void>((resolve, reject) => {
        manager.onLoad = resolve;
        manager.onError = (url) =>
          reject(new Error(`Scenery texture missing: ${url}`));
      })
    : Promise.resolve();
  const texture = (name: string, channel: string, meters: number) => {
    if (!loader) return null; // Physics tests don't need a DOM/image loader.
    const t = loader.load(`/textures/${name}-${channel}.jpg`);
    t.colorSpace = channel === "albedo" ? T.SRGBColorSpace : T.NoColorSpace;
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.repeat.setScalar(1 / meters);
    t.anisotropy = 8;
    textures.add(t);
    return t;
  };
  const pbr = (
    name: string,
    meters: number,
    color: number,
    strength = 0.65,
  ) => {
    const material = new T.MeshStandardMaterial({
      name: `PBR ${name}`,
      color,
      map: texture(name, "albedo", meters),
      normalMap: texture(name, "normal", meters),
      roughnessMap: texture(name, "roughness", meters),
      normalScale: new T.Vector2(strength, strength),
      roughness: 1,
      envMapIntensity: 0.5,
    });
    return material;
  };
  const grass = pbr("lawn", 1.4, 0xdce9d8, 0.32);
  grass.envMapIntensity = 0.16;
  const asphalt = pbr("asphalt", 3, 0xaab0b2, 0.34);
  const gravel = pbr("gravel", 2.25, 0xabaea6, 0.65);
  const bark = pbr("bark", 1, 0xb1a593, 0.9);
  const roof = pbr("roof", 3, 0xacb2b6, 0.85);
  const brick = pbr("brick", 1, 0xd3c6b6, 0.7);
  const siding = pbr("siding", 1.8, 0xffffff, 0.38);
  const concrete = pbr("concrete", 2.08, 0xcec9ba, 0.5);
  const wood = siding.clone();
  wood.name = "Painted porch wood";
  wood.color.set(0x918374);
  // Triangular stochastic sampling shares offsets across all PBR channels. It
  // breaks recognizable repeating crack/grass patterns without changing scale,
  // rotating tangent-space normals, or introducing atlas seams.
  const macro = (material: T.MeshStandardMaterial, ground: boolean) => {
    material.onBeforeCompile = (shader) => {
      shader.vertexShader =
        "varying vec3 vSceneryPosition;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <worldpos_vertex>",
        "#include <worldpos_vertex>\nvSceneryPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      );
      shader.fragmentShader =
        `varying vec3 vSceneryPosition;
        float sceneryHash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
        float sceneryNoise(vec2 p) {
          vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(sceneryHash(i),sceneryHash(i+vec2(1.,0.)),f.x),
                     mix(sceneryHash(i+vec2(0.,1.)),sceneryHash(i+vec2(1.,1.)),f.x),f.y);
        }
        vec2 sceneryOffset(vec2 p) {
          return vec2(sceneryHash(p),sceneryHash(p+vec2(17.7,63.1)))*19.;
        }
        vec4 scenerySample(sampler2D source, vec2 uv) {
          vec2 cell=mat2(1.,0.,-.57735027,1.15470054)*(uv*.42);
          vec2 id=floor(cell), f=fract(cell), a=id, b=id+vec2(1.,0.), c=id+vec2(0.,1.);
          vec3 weights=vec3(1.-f.x-f.y,f.x,f.y);
          if(f.x+f.y>1.) {
            a=id+vec2(1.); b=id+vec2(0.,1.); c=id+vec2(1.,0.);
            weights=vec3(f.x+f.y-1.,1.-f.x,1.-f.y);
          }
          weights=weights*weights*weights;
          weights/=max(dot(weights,vec3(1.)),.0001);
          vec2 dx=dFdx(uv), dy=dFdy(uv);
          return textureGrad(source,uv+sceneryOffset(a),dx,dy)*weights.x
               + textureGrad(source,uv+sceneryOffset(b),dx,dy)*weights.y
               + textureGrad(source,uv+sceneryOffset(c),dx,dy)*weights.z;
        }\n` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <map_fragment>",
        `#ifdef USE_MAP
          diffuseColor *= scenerySample(map,vMapUv);
        #endif
        float surfacePatch = sceneryNoise(vSceneryPosition.xz * ${ground ? "0.018" : "0.18"});
        float detail = sceneryNoise(vSceneryPosition.xz * ${ground ? "0.10" : "1.45"});
        diffuseColor.rgb *= ${
          ground
            ? "mix(vec3(0.70,0.88,0.67),vec3(1.05,1.08,0.93),surfacePatch)*mix(0.91,1.06,detail)"
            : "mix(0.87,1.12,surfacePatch)*mix(0.96,1.04,detail)"
        };`,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <normal_fragment_maps>",
        `#ifdef USE_NORMALMAP_TANGENTSPACE
          vec3 mapN=scenerySample(normalMap,vNormalMapUv).xyz*2.-1.;
          mapN.xy*=normalScale;
          normal=normalize(tbn*mapN);
        #endif`,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <roughnessmap_fragment>",
        `float roughnessFactor=roughness;
        #ifdef USE_ROUGHNESSMAP
          roughnessFactor*=scenerySample(roughnessMap,vRoughnessMapUv).g;
        #endif
        roughnessFactor=${ground ? "max(roughnessFactor,.94)" : "clamp(roughnessFactor*mix(.92,1.08,surfacePatch),.66,.97)"};`,
      );
    };
    material.customProgramCacheKey = () =>
      `scenery-stochastic-pbr-v2-${ground}`;
  };
  macro(grass, true);
  macro(asphalt, false);
  gravel.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `#include <map_fragment>
       diffuseColor.rgb=mix(diffuseColor.rgb,vec3(dot(diffuseColor.rgb,vec3(.2126,.7152,.0722))),.55);`,
    );
  };
  gravel.customProgramCacheKey = () => "neutral-verge-aggregate-v1";
  return {
    ready,
    grass,
    asphalt,
    gravel,
    bark,
    roof,
    brick,
    siding,
    concrete,
    wood,
    dispose() {
      for (const t of textures) t.dispose();
      for (const m of [
        grass,
        asphalt,
        gravel,
        bark,
        roof,
        brick,
        siding,
        concrete,
        wood,
      ])
        m.dispose();
    },
  };
}

export function worldUV(geometry: T.BufferGeometry, scale = 1) {
  const positions = geometry.getAttribute("position"),
    uv = new Float32Array(positions.count * 2);
  for (let i = 0; i < positions.count; i++) {
    uv[i * 2] = positions.getX(i) * scale;
    uv[i * 2 + 1] = positions.getZ(i) * scale;
  }
  geometry.setAttribute("uv", new T.BufferAttribute(uv, 2));
  return geometry;
}
