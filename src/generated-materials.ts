// One source of texture pixels and UV scales for both the generator preview
// and the models saved in the SZS.
import { generatedSurface, rgbaPNG, type Surface } from "./generated-textures.ts";
import { generatedGameTextures, type GameTextureOptions } from "./generated-game-textures.ts";

export type GeneratedMaterial = { color: number[]; surface?: Surface; gameTexture?: boolean; image?: string; repeat?: number };

function customPNG(image: string) {
  if (typeof image !== "string" || image.length > 12_000_000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) throw new Error("Invalid custom track texture. Choose a PNG, JPEG or WebP image again.");
  const bytes = Buffer.from(image.slice(image.indexOf(",") + 1), "base64");
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("Invalid custom track texture PNG");
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (![width, height].every((v) => v >= 8 && v <= 1024 && (v & (v - 1)) === 0)) throw new Error("Custom track textures must be powers of two between 8 and 1024 pixels");
  return bytes;
}

export async function resolveGeneratedMaterials(materials: Record<string, GeneratedMaterial>, options: GameTextureOptions = {}) {
  if (!materials || Object.keys(materials).length > 64) throw new Error("Invalid generated materials");
  const game = Object.values(materials).some((m) => ["asphalt", "grass", "boost"].includes(m.surface || "") && m.gameTexture !== false && !m.image) ? await generatedGameTextures(options) : null;
  const textures = new Map<string, any>();
  for (const [name, material] of Object.entries(materials)) {
    const color = material.color, repeat = material.repeat ?? 1;
    if (!/^[A-Za-z0-9_]{1,32}$/.test(name) || color?.length !== 3 || !color.every(Number.isFinite)) throw new Error("Invalid generated model colour");
    if (!Number.isFinite(repeat) || repeat < .25 || repeat > 16) throw new Error("Texture repeat must be between 0.25 and 16");
    const original = material.gameTexture !== false && !material.image ? game?.surfaces.get(material.surface) : null;
    let png: Buffer;
    if (material.image) png = customPNG(material.image);
    else if (original) png = rgbaPNG(original.texture.width, original.texture.height, original.rgba);
    else if (material.surface) {
      const tile = generatedSurface(material.surface);
      png = rgbaPNG(tile.width, tile.height, tile.rgba);
    } else {
      const pixels = new Uint8Array(8 * 8 * 4);
      for (let i = 0; i < pixels.length; i += 4) pixels.set([...color.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255)), 255], i);
      png = rgbaPNG(8, 8, pixels);
    }
    textures.set(name, { png, original, width: png.readUInt32BE(16), height: png.readUInt32BE(20),
      uvScale: [0, 1].map((i) => (original?.uvScale[i] ?? 1) * repeat),
      source: material.image ? "custom" : original ? "game" : "editor", label: original?.name || material.surface || name });
  }
  return { textures, game };
}

export async function generatedTexturePreviews(materials: Record<string, GeneratedMaterial>, options: GameTextureOptions = {}) {
  const { textures } = await resolveGeneratedMaterials(materials, options);
  return Object.fromEntries([...textures].map(([name, texture]) => [name, {
    image: `data:image/png;base64,${texture.png.toString("base64")}`, width: texture.width, height: texture.height,
    uvScale: texture.uvScale, source: texture.source, label: texture.label,
    ...(texture.original?.native ? { native: texture.original.native } : {}),
  }]));
}
