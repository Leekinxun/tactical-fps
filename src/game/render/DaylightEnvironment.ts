import { Constants } from "@babylonjs/core/Engines/constants";
import { RawCubeTexture } from "@babylonjs/core/Materials/Textures/rawCubeTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";

/** Low-frequency daylight reflection, using filterable RGBA8 on both renderers. */
export function createDaylightEnvironment(scene: Scene): RawCubeTexture {
  const size = 32;
  const faces = Array.from({ length: 6 }, (_, face) => {
    const pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size * 2 - 1;
      const v = (y + 0.5) / size * 2 - 1;
      const vertical = (face === 2 ? 1 : face === 3 ? -1 : -v) / Math.sqrt(1 + u * u + v * v);
      const amount = Math.min(1, Math.max(0, (vertical + 0.12) / 0.5));
      const sky = [173, 189, 196];
      const ground = [65, 67, 62];
      const offset = (y * size + x) * 4;
      for (let channel = 0; channel < 3; channel++) pixels[offset + channel] = ground[channel] + (sky[channel] - ground[channel]) * amount;
      pixels[offset + 3] = 255;
    }
    return pixels;
  });
  // Float cube textures can lose mip allocation on WebGPU devices lacking
  // float32 filtering; RGBA8 keeps the roughness mip chain valid everywhere.
  const texture = new RawCubeTexture(scene, faces, size, Constants.TEXTUREFORMAT_RGBA, Constants.TEXTURETYPE_UNSIGNED_BYTE, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  texture.name = "industrial-daylight-reflection";
  texture.gammaSpace = true;
  return texture;
}
