import * as T from "three";

type Finish = "paint" | "concrete" | "wood" | "mulch";

/** Original, tileable close-up finishes. Colour and linear data use separate maps. */
export function createHomeSurface(finish: Finish) {
  const size = 256;
  const height = new Float32Array(size * size);
  const color = new Uint8Array(size * size * 4);
  const roughness = new Uint8Array(size * size * 4);
  const normal = new Uint8Array(size * size * 4);
  const fract = (n: number) => n - Math.floor(n);
  const hash = (x: number, y: number) =>
    fract(Math.sin(x * 127.1 + y * 311.7 + 37.13) * 43758.5453);
  const noise = (x: number, y: number, period: number, periodY = period) => {
    const ix = Math.floor(x),
      iy = Math.floor(y);
    const fx = fract(x),
      fy = fract(y);
    const sx = fx * fx * (3 - 2 * fx),
      sy = fy * fy * (3 - 2 * fy);
    const h = (a: number, b: number) =>
      hash((a + period) % period, (b + periodY) % periodY);
    return T.MathUtils.lerp(
      T.MathUtils.lerp(h(ix, iy), h(ix + 1, iy), sx),
      T.MathUtils.lerp(h(ix, iy + 1), h(ix + 1, iy + 1), sx),
      sy,
    );
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x,
        u = x / size,
        v = y / size;
      const fine = noise(u * 128, v * 128, 128);
      const mid = noise(u * 32, v * 32, 32);
      const broad = noise(u * 8, v * 8, 8);
      let relief = fine * 0.025,
        tone = 0.97 + fine * 0.028,
        rough = 0.81;
      if (finish === "paint") {
        // Tiny embossed paint grain; the clapboard profile is actual geometry.
        relief = fine * 0.023 + mid * 0.006;
        tone = 0.963 + fine * 0.025 + broad * 0.014;
        rough = 0.78 + mid * 0.15;
      } else if (finish === "wood") {
        const drift =
          Math.sin(v * Math.PI * 2) * 1.4 + Math.sin(v * Math.PI * 6) * 0.35;
        const grain = Math.sin(u * Math.PI * 112 + drift);
        const fiber = Math.pow(Math.max(0, grain), 8);
        const weather = noise(u * 16, v * 4, 16, 4);
        relief = fiber * 0.1 + fine * 0.025 + mid * 0.025;
        tone = 0.86 + grain * 0.042 + weather * 0.1 + fine * 0.045;
        rough = 0.8 + weather * 0.17;
      } else if (finish === "concrete") {
        const pore = Math.max(0, 0.3 - fine) * 0.22;
        relief = fine * 0.07 + mid * 0.03 - pore;
        tone = 0.9 + fine * 0.068 + broad * 0.035 - pore * 0.45;
        rough = 0.86 + mid * 0.12;
      } else {
        const strip = noise(u * 48, v * 16, 48, 16);
        relief = strip * 0.23 + mid * 0.07 + fine * 0.04;
        tone = 0.71 + strip * 0.24 + broad * 0.12;
        rough = 0.92 + fine * 0.07;
      }
      height[i] = relief;
      const c = Math.round(T.MathUtils.clamp(tone, 0, 1) * 255);
      color.set([c, c, c, 255], i * 4);
      const r = Math.round(rough * 255);
      roughness.set([r, r, r, 255], i * 4);
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const at = (y * size + x) * 4;
      const sample = (xx: number, yy: number) =>
        height[((yy + size) % size) * size + ((xx + size) % size)];
      const n = new T.Vector3(
        (sample(x - 1, y) - sample(x + 1, y)) * 5,
        (sample(x, y - 1) - sample(x, y + 1)) * 5,
        1,
      ).normalize();
      normal.set(
        [
          Math.round((n.x * 0.5 + 0.5) * 255),
          Math.round((n.y * 0.5 + 0.5) * 255),
          Math.round((n.z * 0.5 + 0.5) * 255),
          255,
        ],
        at,
      );
    }
  }
  const texture = (data: Uint8Array, isColor = false) => {
    const t = new T.DataTexture(data, size, size, T.RGBAFormat);
    t.name = `Home ${finish} ${isColor ? "albedo" : "linear surface data"}`;
    t.colorSpace = isColor ? T.SRGBColorSpace : T.NoColorSpace;
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.magFilter = T.LinearFilter;
    t.minFilter = T.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  };
  return {
    map: texture(color, true),
    normalMap: texture(normal),
    roughnessMap: texture(roughness),
  };
}

/** Local-space metres keep detail the same size on short trims and broad walls. */
export function homeSurfaceUV(geometry: T.BufferGeometry, meters = 1) {
  if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
  const p = geometry.getAttribute("position"),
    n = geometry.getAttribute("normal");
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const nx = Math.abs(n.getX(i)),
      ny = Math.abs(n.getY(i)),
      nz = Math.abs(n.getZ(i));
    // On a wall v follows height; on a horizontal surface it follows depth.
    uv[i * 2] = (nx > ny && nx > nz ? p.getZ(i) : p.getX(i)) / meters;
    uv[i * 2 + 1] = (ny > nx && ny > nz ? p.getZ(i) : p.getY(i)) / meters;
  }
  geometry.setAttribute("uv", new T.BufferAttribute(uv, 2));
  return geometry;
}

/** Board-space grain follows the long dimension, including rotated rails/joists. */
export function homeWoodUV(geometry: T.BufferGeometry) {
  geometry.computeBoundingBox();
  const size = geometry.boundingBox!.getSize(new T.Vector3());
  const axis =
    size.x >= size.y && size.x >= size.z ? 0 : size.y >= size.z ? 1 : 2;
  const p = geometry.getAttribute("position"),
    n = geometry.getAttribute("normal");
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const normal = [
      Math.abs(n.getX(i)),
      Math.abs(n.getY(i)),
      Math.abs(n.getZ(i)),
    ];
    const transverse = [0, 1, 2]
      .filter((a) => a !== axis)
      .sort((a, b) => normal[a] - normal[b])[0];
    uv[i * 2] = p.getComponent(i, transverse) / 0.85;
    uv[i * 2 + 1] = p.getComponent(i, axis) / 2.6;
  }
  geometry.setAttribute("uv", new T.BufferAttribute(uv, 2));
  return geometry;
}
