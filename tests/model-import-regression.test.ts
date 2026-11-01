import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { prepareBundledTools } from "../src/bundled-tools.ts";
import { buildGeneratedTrackModels } from "../src/generated-track-models.ts";
import { hasBRRESPaletteLinks, normalizeBRRESPalettes } from "../src/brres-palettes.ts";
import { importBRRESPart, importOBJModel } from "../src/model-operations.ts";
import { wszstPath } from "../src/chr0-import.ts";
import { solidTexturePNG } from "../src/solid-texture.ts";
import { parseBRRES, decodeTexture, restBRRESPartsOnPoint } from "../web/js/formats/brres.js";
import { findFile, parseU8 } from "../web/js/formats/u8.js";

const group = (data: Buffer, at: number) => Array.from({ length: data.readUInt32BE(at + 4) }, (_, i) => at + data.readInt32BE(at + 24 + i * 16 + 12));
const materialLayers = (data: Buffer, base = 0) => {
  const version = data.readUInt32BE(base + 8), index = version >= 10 ? 8 : 6;
  return group(data, base + data.readInt32BE(base + 16 + index * 4)).flatMap((m) =>
    Array.from({ length: data.readUInt32BE(m + 44) }, (_, i) => m + data.readInt32BE(m + 48) + i * 52));
};
async function run(...args: string[]) {
  const child = Bun.spawn([wszstPath()!, ...args], { env: process.env, stdout: "pipe", stderr: "pipe", windowsHide: true });
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (code) throw new Error(out + "\n" + err);
}

async function fixture(base: Uint8Array, dir: string, format: number, paletteFormat: number) {
  await mkdir(dir, { recursive: true });
  const input = join(dir, "base.brres"), extracted = join(dir, "resources"), output = join(dir, "indexed.brres");
  await writeFile(input, base); await run("EXTRACT", input, "--dest", extracted);
  const modelPath = join(extracted, "3DModels(NW4R)", "course"), model = await readFile(modelPath);
  // The palette dictionary has the same names/references as the texture dictionary.
  model.writeInt32BE(model.readInt32BE(0x3c), 0x40);
  await writeFile(modelPath, model);
  const bw = format === 10 ? 4 : 8, bh = format === 8 ? 8 : 4;
  const sizes = [8, 4].map((size) => Math.ceil(size / bw) * Math.ceil(size / bh) * 32);
  const size = 64 + sizes[0] + sizes[1], texture = Buffer.alloc(size + 12);
  texture.write("TEX0"); texture.writeUInt32BE(size, 4); texture.writeUInt32BE(3, 8);
  texture.writeUInt32BE(64, 16); texture.writeUInt32BE(size + 4, 20); texture.writeUInt32BE(1, 24);
  texture.writeUInt16BE(8, 28); texture.writeUInt16BE(8, 30); texture.writeUInt32BE(format, 32);
  texture.writeUInt32BE(2, 36); texture.writeFloatBE(1, 44);
  for (let level = 0, start = 64; level < 2; start += sizes[level++]) {
    for (let i = 0; i < sizes[level]; i += format === 10 ? 2 : 1) {
      const a = level ? 3 : 1, b = level ? 0 : 2;
      if (format === 8) texture[start + i] = (a << 4) | b;
      else if (format === 9) texture[start + i] = i % 2 ? b : a;
      else texture.writeUInt16BE(i % 4 ? b : a, start + i);
    }
  }
  texture.writeUInt32BE(4, size); texture.write("road", size + 4);
  await writeFile(join(extracted, "Textures(NW4R)", "road"), texture);
  const palette = Buffer.alloc(0x80 + 12);
  palette.write("PLT0"); palette.writeUInt32BE(0x80, 4); palette.writeUInt32BE(3, 8);
  palette.writeUInt32BE(64, 16); palette.writeUInt32BE(0x84, 20);
  palette.writeUInt32BE(paletteFormat, 24); palette.writeUInt16BE(16, 28);
  const words = paletteFormat === 0 ? [0, 0xff11, 0x8055, 0x22ee] : paletteFormat === 1 ? [0, 0xf800, 0x07e0, 0x001f] : [0, 0xfc00, 0x83e0, 0x3f00];
  words.forEach((word, i) => palette.writeUInt16BE(word, 64 + i * 2));
  palette.writeUInt32BE(4, 0x80); palette.write("road", 0x84);
  await mkdir(join(extracted, "Palettes(NW4R)"));
  await writeFile(join(extracted, "Palettes(NW4R)", "road"), palette);
  if (parseBRRES(base).textures.has("wall")) {
    const other = Buffer.from(palette); other.writeUInt16BE(0x83e0, 66);
    other.write("wall", 0x84);
    await writeFile(join(extracted, "Palettes(NW4R)", "wall"), other);
  }
  await run("CREATE", "--brres", extracted, "--dest", output);
  const result = await readFile(output), root = result.readUInt16BE(12) + 8;
  const modelFolder = group(result, root)[0], mdl = group(result, modelFolder)[0];
  // Wiimm does not relocate the layer's palette-name string; link it in the final fixture.
  for (const layer of materialLayers(result, mdl)) result.writeInt32BE(result.readInt32BE(layer), layer + 4);
  return new Uint8Array(result);
}

const texturePixels = (texture: any, palette?: any, level = 0) => {
  let at = texture.dataOffset, width = texture.width, height = texture.height;
  for (let i = 0; i < level; i++) {
    const bw = [8, 9].includes(texture.format) ? 8 : 4, bh = texture.format === 8 ? 8 : 4;
    at += Math.ceil(width / bw) * Math.ceil(height / bh) * (texture.format === 6 ? 64 : 32);
    width = Math.max(1, width >> 1); height = Math.max(1, height >> 1);
  }
  return decodeTexture({ ...texture, width, height, dataOffset: at, _rgba: null }, palette);
};

test.skipIf(process.platform !== "win32")("model imports retain palette colours, alpha, mipmaps and distinct OBJ materials", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mkwii-model-regression-"));
  const oldEnv = { path: process.env.PATH, abmatt: process.env.MKWII_ABMATT, wiimm: process.env.MKWII_WSZST };
  try {
    await prepareBundledTools(dir);
    const tree = parseU8(await buildGeneratedTrackModels({ materials: { road: { color: [1, 0, 0] } }, tris: [
      { mat: "road", v: [0, 0, 0, 1000, 0, 0, 0, 0, 1000], uv: [0, 0, 1, 0, 0, 1] },
    ] }));
    const base = findFile(tree, "course_model.brres")!.data;
    let indexed: Uint8Array = base, normalized: Uint8Array = base;
    for (const format of [8, 9, 10]) for (const paletteFormat of [0, 1, 2]) {
      const sub = join(dir, `${format}-${paletteFormat}`);
      indexed = await fixture(base, sub, format, paletteFormat);
      const saved = indexed.slice(), before = parseBRRES(indexed);
      normalized = await normalizeBRRESPalettes(indexed, join(sub, "converted"));
      const after = parseBRRES(normalized), old = before.textures.get("road")!, next = after.textures.get("road")!;
      expect(hasBRRESPaletteLinks(indexed)).toBe(true); expect(hasBRRESPaletteLinks(normalized)).toBe(false);
      expect(after.models[0].objects[0].positions).toEqual(before.models[0].objects[0].positions);
      expect(next.format).toBe([3, 4, 5][paletteFormat]); expect(next.mipmaps).toBe(2);
      for (let level = 0; level < 2; level++) expect(texturePixels(next, undefined, level)).toEqual(texturePixels(old, before.palettes.get("road"), level));
      expect([...texturePixels(next).slice(0, 4)]).toEqual(paletteFormat === 0 ? [17, 17, 17, 255] : [255, 0, 0, 255]);
      expect(indexed).toEqual(saved);
    }
    // Both the destination and donor use indexed textures. Different texels force a new texture.
    const changed = indexed.slice(), sourceTexture = parseBRRES(changed).textures.get("road")!;
    new DataView(changed.buffer).setUint16(sourceTexture.dataOffset, 3);
    const source = parseBRRES(await normalizeBRRESPalettes(changed, join(dir, "donor")));
    const imported = await importBRRESPart(indexed, changed, { model: "course", part: "road", tag: "new" });
    const afterPart = parseBRRES(imported.data), added = afterPart.models[0].objects.find((o: any) => o.name === imported.name);
    expect(afterPart.models[0].objects.length).toBe(2); expect(added.uvs[0]).toEqual(parseBRRES(indexed).models[0].objects[0].uvs[0]);
    const importedTexture = afterPart.textures.get("new_road")!;
    expect(importedTexture.format).toBe(5); expect(importedTexture.mipmaps).toBe(2);
    for (let level = 0; level < 2; level++) expect(texturePixels(importedTexture, undefined, level)).toEqual(texturePixels(source.textures.get("road"), undefined, level));
    expect([...texturePixels(importedTexture).slice(0, 4)]).toEqual([255, 0, 0, 109]);

    const multiTree = parseU8(await buildGeneratedTrackModels({ materials: { road: { color: [1, 0, 0] }, wall: { color: [0, 1, 0] } }, tris: [
      { mat: "road", v: [0, 0, 0, 1000, 0, 0, 0, 0, 1000], uv: [0, 0, 1, 0, 0, 1] },
      { mat: "wall", v: [0, 500, 0, 1000, 500, 0, 0, 500, 1000], uv: [0, 0, 1, 0, 0, 1] },
    ] }));
    const multi = Buffer.from(await fixture(findFile(multiTree, "course_model.brres")!.data, join(dir, "variants"), 9, 2));
    const root = multi.readUInt16BE(12) + 8, mdl = group(multi, group(multi, root)[0])[0], layers = materialLayers(multi, mdl);
    multi.writeInt32BE(layers[0] + multi.readInt32BE(layers[0]) - layers[1], layers[1]);
    const variants = parseBRRES(await normalizeBRRESPalettes(multi, join(dir, "variant-output")));
    expect(variants.models[0].materials[1].layers[0].texture).toBe("road_wall");
    expect([...texturePixels(variants.textures.get("road_wall")).slice(0, 4)]).toEqual([0, 255, 0, 255]);
    const variantImport = parseBRRES((await importBRRESPart(base, multi, { model: "course", part: "wall", tag: "variant" })).data);
    expect([...texturePixels(variantImport.textures.get("variant_road_wall")).slice(0, 4)]).toEqual([0, 255, 0, 255]);

    // Multiple usemtl statements in the same OBJ group; no UVs; similar material
    // names; a texture named like an existing course texture; an MTL-relative path.
    await mkdir(join(dir, "materials", "images"), { recursive: true });
    await writeFile(join(dir, "materials", "images", "road.png"), solidTexturePNG([0, 0, 1, 1]));
    await writeFile(join(dir, "materials", "colors.mtl"), "newmtl red\nKd 1 0 0\nnewmtl green\nKd 0 1 0\nnewmtl blue\nmap_Kd images/road.png\n");
    const obj = join(dir, "colors.obj");
    await writeFile(obj, "mtllib materials/colors.mtl\nv 0 0 0\nv 1000 0 0\nv 0 0 1000\nv 1000 0 1000\nvn 0 1 0\nusemtl red\nf -4//1 -3//1 -1//1 -2//1\nusemtl green\nf 2 4 3\nusemtl blue\nf 1 3 4\n");
    const warnings: string[] = [], objBytes = await importOBJModel(indexed, obj, [50, 100, 150], warnings), afterOBJ = parseBRRES(objBytes);
    expect(warnings).toEqual([]); expect(afterOBJ.models[0].objects.length).toBe(4);
    for (const [name, rgba] of [["red", [255, 0, 0, 255]], ["green", [0, 255, 0, 255]], ["blue", [0, 0, 255, 255]]] as const) {
      const material = afterOBJ.models[0].materials.find((m: any) => m.name === `colors_${name}`)!;
      expect([...decodeTexture(afterOBJ.textures.get(material.layers[0].texture)).slice(0, 4)]).toEqual(rgba);
    }
    expect(texturePixels(afterOBJ.textures.get("road"))).toEqual(texturePixels(parseBRRES(normalized).textures.get("road")));
    const rested = parseBRRES(restBRRESPartsOnPoint(objBytes, "course", [1, 2, 3], [50, 250, 150]));
    for (const index of [1, 2, 3]) {
      const before = afterOBJ.models[0].objects[index].positions, after = rested.models[0].objects[index].positions;
      expect(Array.from(after).every((value, i) => Math.abs(value - before[i] - (i % 3 === 1 ? 150 : 0)) < 0.01)).toBe(true);
    }
    expect(rested.models[0].objects[0].positions).toEqual(afterOBJ.models[0].objects[0].positions);

    const coloredOBJ = join(dir, "vertex-colours.obj");
    await writeFile(coloredOBJ, "v 0 0 0 1 0 0\nv 1000 0 0 0 1 0\nv 0 0 1000 0 0 1\nf 1 2 3\n");
    const colored = parseBRRES(await importOBJModel(base, coloredOBJ, [0, 0, 0]));
    const coloredPart = colored.models[0].objects.find((o: any) => o.name !== "road");
    expect(coloredPart.colors).not.toBeNull();
    const vertexColors = Array.from({ length: 3 }, (_, i) => [...coloredPart.colors.slice(i * 4, i * 4 + 4)]);
    expect(vertexColors).toContainEqual([1, 0, 0, 1]);
    expect(vertexColors).toContainEqual([0, 1, 0, 1]);
    expect(vertexColors).toContainEqual([0, 0, 1, 1]);
  } finally {
    for (const [key, value] of [["PATH", oldEnv.path], ["MKWII_ABMATT", oldEnv.abmatt], ["MKWII_WSZST", oldEnv.wiimm]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
    if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe regression test directory");
    await rm(dir, { recursive: true, force: true });
  }
}, 120000);
