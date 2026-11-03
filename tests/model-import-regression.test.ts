import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { prepareBundledTools } from "../src/bundled-tools.ts";
import { buildGeneratedTrackModels } from "../src/generated-track-models.ts";
import { hasBRRESPaletteLinks, normalizeBRRESPalettes, transplantBRRESTextures } from "../src/brres-palettes.ts";
import { importBRRESPart, importOBJModel } from "../src/model-operations.ts";
import { wszstPath } from "../src/chr0-import.ts";
import { solidTexturePNG } from "../src/solid-texture.ts";
import { parseBRRES, decodeTexture, restBRRESPartsOnPoint } from "../web/js/formats/brres.js";
import { findFile, parseU8 } from "../web/js/formats/u8.js";
import { writePAT0 } from "../web/js/formats/pat0.js";

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

// A texture-swap animation whose second texture shares the material's palette.
// Copy a real single-entry dictionary so the fixture also works in native tools.
function textureSwap(model: Buffer) {
  const out = Buffer.alloc(0x140), dict = model.readInt32BE(0x30);
  let cursor = 0xa0;
  const string = (text: string) => {
    out.writeUInt32BE(Buffer.byteLength(text), cursor);
    const at = cursor + 4; out.write(text, at);
    cursor = Math.ceil((at + Buffer.byteLength(text) + 1) / 4) * 4;
    return at;
  };
  const name = string("Swap"), road = string("road"), blink = string("blink");
  out.write("PAT0"); out.writeUInt32BE(out.length, 4); out.writeUInt32BE(4, 8);
  [0x3c, 0x88, 0x90, 0x90, 0x98, 0].forEach((offset, i) => out.writeUInt32BE(offset, 0x10 + i * 4));
  out.writeUInt32BE(name, 0x28); out.writeUInt16BE(4, 0x30);
  out.writeUInt16BE(1, 0x32); out.writeUInt16BE(2, 0x34); out.writeUInt32BE(1, 0x38);
  out.set(model.subarray(dict, dict + 40), 0x3c);
  out.writeInt32BE(road - 0x3c, 0x3c + 32); out.writeInt32BE(0x64 - 0x3c, 0x3c + 36);
  out.writeInt32BE(road - 0x64, 0x64); out.writeUInt32BE(5, 0x68); out.writeUInt32BE(12, 0x6c);
  out.writeUInt16BE(2, 0x70); out.writeFloatBE(0.25, 0x74);
  out.writeFloatBE(2, 0x80); out.writeUInt16BE(1, 0x84);
  out.writeInt32BE(road - 0x88, 0x88); out.writeInt32BE(blink - 0x88, 0x8c);
  return out;
}

async function fixture(base: Uint8Array, dir: string, format: number, paletteFormat: number, options: { animated?: boolean; missingPalette?: boolean; patternMode?: "palette" | "combined" | "constant" } = {}) {
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
  if (options.animated || options.patternMode) {
    const frame = Buffer.from(texture), name = Buffer.from("blink");
    const grown = Buffer.alloc(frame.length + 4); grown.set(frame);
    grown.writeUInt32BE(name.length, size); grown.set(name, size + 4);
    if (options.patternMode) for (let at = 64; at < size; at += format === 10 ? 2 : 1) {
      if (format === 8) grown[at] = 0x23;
      else if (format === 9) grown[at] = at % 2 ? 2 : 3;
      else grown.writeUInt16BE(at % 4 ? 2 : 3, at);
    }
    if (options.animated || options.patternMode === "combined") await writeFile(join(extracted, "Textures(NW4R)", "blink"), grown);
    await mkdir(join(extracted, "AnmTexPat(NW4R)"));
    if (options.patternMode) {
      const keys = options.patternMode === "constant" ? [{ frame: 0, palette: "alt" }]
        : options.patternMode === "palette" ? [{ frame: 0, palette: "road" }, { frame: 1.5, palette: "alt" }, { frame: 5.5, palette: "road" }]
        : [{ frame: 0, texture: "road", palette: "road" }, { frame: 2.25, texture: "blink", palette: "alt" }, { frame: 5.5, texture: "road", palette: "alt" }];
      await writeFile(join(extracted, "AnmTexPat(NW4R)", "Colours"), writePAT0({ name: "Colours", frames: 6, loop: options.patternMode === "palette", materials: new Map([["road", [{ index: 0, keys }]]]) }));
    } else await writeFile(join(extracted, "AnmTexPat(NW4R)", "Swap"), textureSwap(model));
  }
  const palette = Buffer.alloc(0x80 + 12);
  palette.write("PLT0"); palette.writeUInt32BE(0x80, 4); palette.writeUInt32BE(3, 8);
  palette.writeUInt32BE(64, 16); palette.writeUInt32BE(0x84, 20);
  palette.writeUInt32BE(paletteFormat, 24); palette.writeUInt16BE(16, 28);
  const words = paletteFormat === 0 ? [0, 0xff11, 0x8055, 0x22ee] : paletteFormat === 1 ? [0, 0xf800, 0x07e0, 0x001f] : [0, 0xfc00, 0x83e0, 0x3f00];
  words.forEach((word, i) => palette.writeUInt16BE(word, 64 + i * 2));
  palette.writeUInt32BE(4, 0x80); palette.write("road", 0x84);
  await mkdir(join(extracted, "Palettes(NW4R)"));
  if (!options.missingPalette) await writeFile(join(extracted, "Palettes(NW4R)", "road"), palette);
  if (options.patternMode) {
    const other = Buffer.from(palette);
    other.writeUInt16BE(paletteFormat === 0 ? 0x8011 : paletteFormat === 1 ? 0x07e0 : 0x3f00, 66);
    other.writeUInt32BE(3, 0x80); other.fill(0, 0x84); other.write("alt", 0x84);
    await writeFile(join(extracted, "Palettes(NW4R)", "alt"), other);
  }
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
    const missing = await fixture(base, join(dir, "missing"), 9, 2, { missingPalette: true });
    const missingSaved = missing.slice();
    await expect(normalizeBRRESPalettes(missing, join(dir, "missing-output"))).rejects.toThrow('Texture "road" needs palette "road"');
    await expect(normalizeBRRESPalettes(missing, join(dir, "missing-output"))).rejects.toThrow("Available palettes: none");
    expect(missing).toEqual(missingSaved);
    const animated = await fixture(base, join(dir, "animated"), 9, 2, { animated: true });
    const animationBefore = parseBRRES(animated);
    expect(animationBefore.pat.get("Swap")!.materials.get("road")[0].keys.map((k: any) => k.texture)).toEqual(["road", "blink"]);
    expect(animationBefore.palettes.has("blink")).toBe(false);
    const animationAfter = parseBRRES(await normalizeBRRESPalettes(animated, join(dir, "animated-output")));
    expect(animationAfter.pat.get("Swap")).toEqual(animationBefore.pat.get("Swap"));
    expect(animationAfter.palettes.size).toBe(0);
    expect(texturePixels(animationAfter.textures.get("blink"))).toEqual(texturePixels(animationBefore.textures.get("blink"), animationBefore.palettes.get("road")));
    const animationImport = parseBRRES((await importBRRESPart(base, animated, { model: "course", part: "road", tag: "animated" })).data);
    expect(animationImport.pat.size).toBeGreaterThan(0);
    expect([...animationImport.textures.keys()]).toContain("animated_blink");
    for (const format of [8, 9, 10]) for (const paletteFormat of [0, 1, 2]) for (const patternMode of ["palette", "combined", "constant"] as const) {
      const folder = join(dir, `pattern-${format}-${paletteFormat}-${patternMode}`);
      const input = await fixture(base, folder, format, paletteFormat, { patternMode });
      const unchanged = input.slice(), original = parseBRRES(input), sourcePattern = original.pat.get("Colours")!;
      const convertedBytes = await normalizeBRRESPalettes(input, join(folder, "converted"));
      const converted = parseBRRES(convertedBytes), pattern = converted.pat.get("Colours")!;
      expect(converted.palettes.size).toBe(0); expect(hasBRRESPaletteLinks(convertedBytes)).toBe(false);
      expect(pattern.frames).toBe(6); expect(pattern.loop).toBe(sourcePattern.loop);
      const sourceKeys = sourcePattern.materials.get("road")[0].keys, keys = pattern.materials.get("road")[0].keys;
      expect(keys.map((k: any) => k.frame)).toEqual(sourceKeys.map((k: any) => k.frame));
      for (let k = 0; k < keys.length; k++) {
        const old = original.textures.get(sourceKeys[k].texture || "road"), palette = original.palettes.get(sourceKeys[k].palette);
        const texture = converted.textures.get(keys[k].texture);
        expect(texture.mipmaps).toBe(2);
        for (let level = 0; level < 2; level++) expect(texturePixels(texture, undefined, level)).toEqual(texturePixels(old, palette, level));
      }
      expect(input).toEqual(unchanged);
      if (format === 10 && paletteFormat === 2) {
        const imported = parseBRRES((await importBRRESPart(base, input, { model: "course", part: "road", tag: "colours" })).data);
        const importedPattern = imported.pat.get("colours_Colours")!;
        expect(importedPattern.frames).toBe(pattern.frames); expect(importedPattern.loop).toBe(pattern.loop);
        const importedKeys = importedPattern.materials.get("colours_road")[0].keys;
        expect(importedKeys.map((k: any) => k.frame)).toEqual(keys.map((k: any) => k.frame));
        for (let k = 0; k < keys.length; k++) for (let level = 0; level < 2; level++) {
          expect(texturePixels(imported.textures.get(importedKeys[k].texture), undefined, level)).toEqual(texturePixels(converted.textures.get(keys[k].texture), undefined, level));
        }
        const obj = join(folder, "triangle.obj");
        await writeFile(obj, "v 0 0 0\nv 1000 0 0\nv 0 0 1000\nf 1 2 3\n");
        const withOBJ = parseBRRES(await importOBJModel(input, obj, [0, 0, 0]));
        expect(withOBJ.pat.get("Colours")).toEqual(pattern);
      }
    }
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
    // ABMatt's automatic cleanup may remove textures not used by the static
    // model (they can still be needed by animations or other game resources).
    const withBlock = await transplantBRRESTextures(normalized, base, { road: "block" }, join(dir, "unused-texture"));
    const withBlockSaved = withBlock.slice();
    const blockBefore = parseBRRES(withBlock).textures.get("block")!;
    expect(blockBefore.format).toBe(5);
    const withPart = parseBRRES((await importBRRESPart(withBlock, base, { model: "course", part: "road", tag: "extra" })).data);
    const blockAfter = withPart.textures.get("block")!;
    expect(blockAfter.format).toBe(blockBefore.format);
    expect(blockAfter.mipmaps).toBe(blockBefore.mipmaps);
    for (let level = 0; level < 2; level++) expect(texturePixels(blockAfter, undefined, level)).toEqual(texturePixels(blockBefore, undefined, level));
    expect(withBlock).toEqual(withBlockSaved);
    expect(withPart.models[0].objects.map((o: any) => o.name)).toContain("extra_road");

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
    const indexedWithBlock = await transplantBRRESTextures(normalized, indexed, { road: "block" }, join(dir, "obj-existing-texture"));
    const warnings: string[] = [], objBytes = await importOBJModel(indexedWithBlock, obj, [50, 100, 150], warnings), afterOBJ = parseBRRES(objBytes);
    expect(warnings).toEqual([]); expect(afterOBJ.models[0].objects.length).toBe(4);
    for (const [name, rgba] of [["red", [255, 0, 0, 255]], ["green", [0, 255, 0, 255]], ["blue", [0, 0, 255, 255]]] as const) {
      const material = afterOBJ.models[0].materials.find((m: any) => m.name === `colors_${name}`)!;
      expect([...decodeTexture(afterOBJ.textures.get(material.layers[0].texture)).slice(0, 4)]).toEqual(rgba);
    }
    expect(texturePixels(afterOBJ.textures.get("road"))).toEqual(texturePixels(parseBRRES(normalized).textures.get("road")));
    expect(afterOBJ.textures.get("block")!.mipmaps).toBe(2);
    for (let level = 0; level < 2; level++) expect(texturePixels(afterOBJ.textures.get("block"), undefined, level)).toEqual(texturePixels(blockBefore, undefined, level));
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

    // Windows extracts resources into a case-insensitive directory. Imports
    // that differ only in case must still keep separate materials and images.
    const tinyOBJ = "v 0 0 0\nv 1000 0 0\nv 0 0 1000\nusemtl Paint\nf 1 2 3\n";
    for (const [folder, filename, color] of [["case-red", "Case.obj", "1 0 0"], ["case-blue", "case.obj", "0 0 1"]]) {
      await mkdir(join(dir, folder));
      await writeFile(join(dir, folder, filename), "mtllib paint.mtl\n" + tinyOBJ);
      await writeFile(join(dir, folder, "paint.mtl"), `newmtl Paint\nKd ${color}\n`);
    }
    const red = await importOBJModel(base, join(dir, "case-red", "Case.obj"), [0, 0, 0]);
    const blue = parseBRRES(await importOBJModel(red, join(dir, "case-blue", "case.obj"), [1000, 0, 0]));
    const addedPaint = blue.models[0].materials.filter((m: any) => m.name !== "road");
    expect(addedPaint).toHaveLength(2);
    expect(blue.textures.size).toBe(3);
    expect(addedPaint.map((m: any) => [...decodeTexture(blue.textures.get(m.layers[0].texture)).slice(0, 4)])).toEqual([[255, 0, 0, 255], [0, 0, 255, 255]]);

    await writeFile(join(dir, "comment.obj"), "mtllib comment.mtl # resources\n" + tinyOBJ.replace("usemtl Paint", "usemtl Paint # selection"));
    await writeFile(join(dir, "comment.mtl"), 'newmtl Paint # material\nKd 0 1 0\nmap_Kd "blue # image.png" # diffuse image\n');
    await writeFile(join(dir, "blue # image.png"), solidTexturePNG([0, 0, 1, 1]));
    const commentsWarnings: string[] = [];
    const comments = parseBRRES(await importOBJModel(base, join(dir, "comment.obj"), [0, 0, 0], commentsWarnings));
    expect(commentsWarnings).toEqual([]);
    const commentedMaterial = comments.models[0].materials.find((m: any) => m.name !== "road");
    expect([...decodeTexture(comments.textures.get(commentedMaterial.layers[0].texture)).slice(0, 4)]).toEqual([0, 0, 255, 255]);

    await writeFile(join(dir, "alpha.obj"), "mtllib alpha.mtl\n" + tinyOBJ);
    await writeFile(join(dir, "alpha.mtl"), "newmtl Paint\nKd 1 0 0\nd 0.4\n");
    const translucent = parseBRRES(await importOBJModel(base, join(dir, "alpha.obj"), [0, 0, 0]));
    const translucentMaterial = translucent.models[0].materials.find((m: any) => m.name !== "road");
    const translucentTexture = translucent.textures.get(translucentMaterial.layers[0].texture);
    expect([...decodeTexture(translucentTexture).slice(0, 4)]).toEqual([255, 0, 0, 102]);
    expect(translucentMaterial.xlu).toBe(true);
    expect(translucentMaterial.gx.blend.enabled).toBe(true);
    await writeFile(join(dir, "alpha.mtl"), "newmtl Paint\nmap_Kd soft.png\n");
    await writeFile(join(dir, "soft.png"), solidTexturePNG([0, 1, 0, 0.4]));
    const softPNG = parseBRRES(await importOBJModel(base, join(dir, "alpha.obj"), [0, 0, 0]));
    const pngMaterial = softPNG.models[0].materials.find((m: any) => m.name !== "road");
    expect([...decodeTexture(softPNG.textures.get(pngMaterial.layers[0].texture)).slice(0, 4)]).toEqual([0, 255, 0, 102]);
    expect(pngMaterial.xlu).toBe(true);
    expect(pngMaterial.gx.blend.enabled).toBe(true);
  } finally {
    for (const [key, value] of [["PATH", oldEnv.path], ["MKWII_ABMATT", oldEnv.abmatt], ["MKWII_WSZST", oldEnv.wiimm]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
    if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe regression test directory");
    await rm(dir, { recursive: true, force: true });
  }
}, 120000);
