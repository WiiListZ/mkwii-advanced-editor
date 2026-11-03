import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { decompressWiimm } from "./native-wiimm.ts";
import { parseU8, findFile } from "../web/js/formats/u8.js";
import { decodeTexture, parseBRRES } from "../web/js/formats/brres.js";

export type GameTextureOptions = { workspace?: string; commonPath?: string; partsFolder?: string };

// Use only the person's own game files. Nintendo textures are never bundled
// with the editor; original generated tiles remain the offline fallback.
export async function generatedGameTextures(options: GameTextureOptions) {
  const candidates: string[] = [];
  if (options.workspace) for (const folder of [options.workspace, join(options.workspace, "files"), join(options.workspace, "DATA", "files")])
    candidates.push(join(folder, "Race", "Course", "beginner_course.szs"));
  if (options.commonPath) candidates.push(join(dirname(options.commonPath), "Course", "beginner_course.szs"));
  if (options.partsFolder) candidates.push(join(options.partsFolder, "beginner_course.szs"));
  const surfaces = new Map<string, any>(); let firstSource: Uint8Array | null = null;
  const paths = [...new Set(candidates)];
  for (const path of [...paths, ...paths.map((p) => join(dirname(p), "shopping_course.szs"))]) {
    try {
      const tree = parseU8(decompressWiimm(new Uint8Array(await readFile(path))));
      const source = findFile(tree, "course_model.brres")?.data;
      if (!source) continue;
      const brres = parseBRRES(source); firstSource ||= source;
      for (const [surface, names] of [["asphalt", ["mainROAD_all_mip"]], ["grass", ["t_kusa_070712c", "t_waki_070712a_mip"]]] as const) {
        if (surfaces.has(surface)) continue;
        for (const name of names) {
          const texture = brres.textures.get(name);
          if (!texture) continue;
          const layer = brres.models.flatMap((model: any) => model.materials).flatMap((material: any) => material.layers).find((layer: any) => layer.texture === name);
          const palette = brres.palettes.get(layer?.palette) || brres.palettes.get(name);
          // Luigi Circuit's road atlas contains two side-by-side copies. One
          // half is the full road width; its tile length is a quarter of it.
          const uvScale = surface !== "asphalt" ? [1, 1] : texture.width === 1024 && texture.height === 128 ? [.5, 4] : [1, texture.width / texture.height];
          surfaces.set(surface, { name, texture, rgba: decodeTexture(texture, palette), uvScale, source }); break;
        }
      }
      if (!surfaces.has("boost")) {
        const material = brres.models.flatMap((m: any) => m.materials).find((m: any) => m.name === "ef_dushBoard");
        const animations = [...brres.srt.values()].filter((s: any) => s.materials.has(material?.name));
        if (material && animations.length && material.layers.every((l: any) => brres.textures.has(l.texture))) {
          const name = material.layers.find((l: any) => /arrowGrad/.test(l.texture))?.texture || material.layers[0].texture, texture = brres.textures.get(name);
          const native = { material, animations: animations.map((s: any) => ({ ...s, materials: [[material.name, s.materials.get(material.name)]] })),
            textures: Object.fromEntries(material.layers.map((l: any) => {
              const t = brres.textures.get(l.texture);
              return [l.texture, { width: t.width, height: t.height, format: t.format, mipmaps: t.mipmaps,
                data: Buffer.from(t.reader.d.subarray(t.dataOffset, t.offset + t.size)).toString("base64") }];
            })) };
          surfaces.set("boost", { name, texture, rgba: decodeTexture(texture), uvScale: [1, 1], source,
            native: JSON.parse(JSON.stringify(native, (_key, value) => ArrayBuffer.isView(value) ? Array.from(value as any) : value)) });
        }
      }
      if (surfaces.has("asphalt") && surfaces.has("grass") && surfaces.has("boost")) break;
    } catch { /* Missing or custom game resources use the editor's own tiles. */ }
  }
  return surfaces.size ? { source: firstSource!, surfaces } : null;
}
