// ABMatt cannot read MDL0 palette links. Expand indexed textures losslessly before
// handing it a model, including each original mip level (never regenerate them).
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { wszstPath } from "./chr0-import.ts";
import { parseBRRES } from "../web/js/formats/brres.js";
import { writePAT0 } from "../web/js/formats/pat0.js";

const indexed = (format: number) => [8, 9, 10].includes(format);
const align = (value: number) => Math.ceil(value / 32) * 32;
const view = (data: Uint8Array) => new DataView(data.buffer, data.byteOffset, data.byteLength);
const str = (data: Uint8Array, at: number) => {
  const end = data.indexOf(0, at);
  return new TextDecoder().decode(data.subarray(at, end < 0 ? data.length : end));
};
function group(data: Uint8Array, at: number) {
  const v = view(data), count = v.getUint32(at + 4);
  return Array.from({ length: count }, (_, i) => {
    const entry = at + 24 + i * 16;
    return { name: str(data, at + v.getInt32(entry + 8)), offset: at + v.getInt32(entry + 12) };
  });
}
const sections = (version: number) => ({ materials: version >= 10 ? 8 : 6, palettes: version >= 10 ? 12 : 10 });

export function hasBRRESModelAnimations(data: Uint8Array) {
  return group(data, view(data).getUint16(12) + 8).some((folder) =>
    ["AnmChr(NW4R)", "AnmShp(NW4R)", "AnmVis(NW4R)"].includes(folder.name));
}

// ABMatt parses (and re-encodes) every BRRES folder, but cannot read every
// CHR0/CLR0/SCN0/SHP0/VIS0/PAT0 encoding: custom tracks often carry SCN0 lights
// or fog it rejects with "Incorrect name offset". Geometry work only needs the
// models, textures and texture-matrix animations, so everything else is kept
// out of ABMatt; preserveBRRESPatterns puts it back byte for byte.
const ABMATT_FOLDERS = ["3DModels(NW4R)", "Textures(NW4R)", "Palettes(NW4R)", "AnmTexSrt(NW4R)"];
const passthrough = (name: string) => !ABMATT_FOLDERS.includes(name) && name !== "AnmTexPat(NW4R)";
export async function staticBRRESModelSource(data: Uint8Array, dir: string) {
  const folders = group(data, view(data).getUint16(12) + 8).filter((folder) => !ABMATT_FOLDERS.includes(folder.name));
  if (!folders.length) return data;
  const exe = wszstPath();
  if (!exe) throw new Error("Editing a model with animations requires the included Wiimm tools");
  await mkdir(dir, { recursive: true });
  const source = join(dir, "source.brres"), extracted = join(dir, "resources"), output = join(dir, "static.brres");
  const run = async (...args: string[]) => {
    const child = Bun.spawn([exe, ...args], { cwd: dir, env: process.env, stdout: "pipe", stderr: "pipe", windowsHide: true });
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code) throw new Error(`Could not prepare the animated model part: ${(out + "\n" + err).trim().slice(-600)}`);
  };
  await writeFile(source, data);
  await run("EXTRACT", source, "--dest", extracted);
  for (const folder of folders) {
    const path = resolve(extracted, folder.name);
    if (!path.startsWith(resolve(extracted) + sep)) throw new Error("Invalid animation resource path");
    await rm(path, { recursive: true, force: true });
  }
  await run("CREATE", "--brres", extracted, "--dest", output);
  return new Uint8Array(await readFile(output));
}

export function hasBRRESPaletteLinks(data: Uint8Array) {
  const v = view(data);
  const models = group(data, v.getUint16(12) + 8).find((f) => f.name === "3DModels(NW4R)");
  return !!models && group(data, models.offset).some((m) => v.getInt32(m.offset + 16 + sections(v.getUint32(m.offset + 8)).palettes * 4) !== 0);
}

export function needsBRRESPaletteConversion(data: Uint8Array) {
  if (hasBRRESPaletteLinks(data)) return true;
  const v = view(data), folders = group(data, v.getUint16(12) + 8);
  for (const folder of folders) if (folder.name === "AnmTexPat(NW4R)") for (const resource of group(data, folder.offset)) {
    const header = resource.offset + (v.getUint32(resource.offset + 8) >= 4 ? 0x28 : 0x24);
    if (v.getUint16(header + 14)) return true;
  }
  const folder = folders.find((f) => f.name === "Textures(NW4R)");
  // TEX0 version 2 has one more section offset before the format.
  return !!folder && group(data, folder.offset).some((t) => indexed(v.getUint32(t.offset + ([1, 2].includes(v.getUint32(t.offset + 8)) ? 36 : 32))));
}

function directTexture(tex: any, palette: any, resourceName = tex.name) {
  const format = [3, 4, 5][palette.format];
  if (format === undefined) throw new Error(`Texture ${tex.name} uses an unsupported palette format`);
  const levels: { width: number; height: number; dataOffset: number; size: number }[] = [];
  let width = tex.width, height = tex.height, at = tex.dataOffset;
  for (let level = 0; level < Math.max(1, tex.mipmaps); level++) {
    const bw = tex.format === 10 ? 4 : 8, bh = tex.format === 8 ? 8 : 4;
    const bytes = Math.ceil(width / bw) * Math.ceil(height / bh) * 32;
    if (at + bytes > tex.offset + tex.size) throw new Error(`Texture ${tex.name} has a truncated mipmap`);
    levels.push({ width, height, dataOffset: at, size: Math.ceil(width / 4) * Math.ceil(height / 4) * 32 });
    at += bytes; width = Math.max(1, width >> 1); height = Math.max(1, height >> 1);
  }
  const size = 64 + levels.reduce((sum, level) => sum + level.size, 0), name = new TextEncoder().encode(resourceName);
  const out = new Uint8Array(align(size + 4 + name.length + 1)), v = view(out);
  out.set(new TextEncoder().encode("TEX0")); v.setUint32(4, size); v.setUint32(8, 3);
  v.setUint32(16, 64); v.setUint32(20, size + 4);
  v.setUint16(28, tex.width); v.setUint16(30, tex.height); v.setUint32(32, format);
  v.setUint32(36, levels.length); v.setFloat32(44, levels.length - 1);
  v.setUint32(size, name.length); out.set(name, size + 4);
  at = 64;
  const source = tex.reader.d, sourceView = view(source);
  for (const level of levels) {
    const bw = tex.format === 10 ? 4 : 8, bh = tex.format === 8 ? 8 : 4;
    for (let by = 0; by < level.height; by += 4) for (let bx = 0; bx < level.width; bx += 4) {
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        const px = Math.min(level.width - 1, bx + x), py = Math.min(level.height - 1, by + y);
        const block = (Math.floor(py / bh) * Math.ceil(level.width / bw) + Math.floor(px / bw)) * 32 + level.dataOffset;
        const pixel = (py % bh) * bw + px % bw;
        const index = tex.format === 8 ? (source[block + (pixel >> 1)] >> (pixel % 2 ? 0 : 4)) & 15
          : tex.format === 9 ? source[block + pixel] : sourceView.getUint16(block + pixel * 2) & 0x3fff;
        if (index >= palette.count) throw new Error(`Texture ${tex.name} refers to a missing palette colour`);
        // IA8, RGB565 and RGB5A3 store exactly the same 16-bit colour words in
        // palettes and direct textures. Copy them without quantization or RGBA
        // expansion, retaining alpha while using half as much memory as RGBA32.
        v.setUint16(at, sourceView.getUint16(palette.dataOffset + index * 2)); at += 2;
      }
    }
  }
  return out;
}

export async function normalizeBRRESPalettes(data: Uint8Array, dir: string): Promise<Uint8Array> {
  if (!needsBRRESPaletteConversion(data)) return data;
  const parsed = parseBRRES(data);
  for (const folder of group(data, view(data).getUint16(12) + 8)) if (folder.name === "AnmTexPat(NW4R)") {
    for (const resource of group(data, folder.offset)) if (!parsed.pat.has(resource.name)) throw new Error(`Pattern animation ${resource.name} could not be read; its palette cannot be converted safely`);
  }
  const exe = wszstPath();
  if (!exe) throw new Error("Palette texture import requires the included Wiimm SZS tools");
  const textures = new Map<string, Uint8Array>(), variants = new Map<string, string>();
  const taken = new Set<string>([...parsed.textures.keys()].map((name: string) => name.toLowerCase()));
  const getVariant = (name: string, paletteName: string) => {
    const tex = parsed.textures.get(name);
    if (!tex) throw new Error(`Pattern animation needs missing texture "${name}"`);
    if (!indexed(tex.format)) return name;
    paletteName ||= name;
    const key = `${name}\0${paletteName}`;
    if (variants.has(key)) return variants.get(key)!;
    const palette = parsed.palettes.get(paletteName);
    if (!palette) {
      const available = [...parsed.palettes.keys()].slice(0, 8).join(", ") || "none";
      throw new Error(`Texture "${name}" needs palette "${paletteName}", but it is not present or could not be read in this BRRES. Available palettes: ${available}. Import the complete original model with its palette resources; a texture alone does not contain its colours.`);
    }
    let variant = name;
    if (textures.has(name)) {
      const stem = `${name}_${paletteName}`.replace(/[^A-Za-z0-9_-]/g, "_");
      variant = stem;
      for (let n = 2; taken.has(variant.toLowerCase()); n++) variant = `${stem}_${n}`;
      taken.add(variant.toLowerCase());
    }
    textures.set(variant, directTexture(tex, palette, variant));
    variants.set(key, variant);
    return variant;
  };
  const staticLayers = new Map<string, string>();
  const defaultPalette = (material: any, index: number) => {
    const layer = material.layers[index];
    if (layer?.palette) return layer.palette;
    if (parsed.palettes.has(layer?.texture)) return layer.texture;
    for (const animation of parsed.pat.values()) {
      const key = animation.materials.get(material.name)?.find((s: any) => s.index === index)?.keys.find((k: any) => k.palette);
      if (key) return key.palette;
    }
    return "";
  };
  for (const model of parsed.models) for (const material of model.materials) material.layers.forEach((layer: any, index: number) => {
    if (parsed.textures.has(layer.texture)) staticLayers.set(`${model.name}\0${material.name}\0${index}`, getVariant(layer.texture, defaultPalette(material, index)));
  });
  // Bake each texture/palette pair once; retain the original fractional key
  // times, loop flag, material and texture slot in the replacement PAT0.
  const animations = new Map<string, any>();
  for (const animation of parsed.pat.values()) {
    const materials = new Map<string, any>();
    for (const [materialName, slots] of animation.materials) {
      const contexts = parsed.models.flatMap((model: any) => model.materials.filter((m: any) => m.name === materialName));
      let converted: any = null;
      for (const material of contexts.length ? contexts : [{ name: materialName, layers: [] }]) {
        const next = slots.map((slot: any) => ({ index: slot.index, keys: slot.keys.map((key: any) => ({
          frame: key.frame,
          texture: getVariant(key.texture ?? material.layers[slot.index]?.texture, key.palette ?? defaultPalette(material, slot.index)),
        })) }));
        if (converted && JSON.stringify(converted) !== JSON.stringify(next)) throw new Error(`Animated material ${materialName} has conflicting palette bindings in different models`);
        converted = next;
      }
      materials.set(materialName, converted);
    }
    animations.set(animation.name, { ...animation, materials });
  }
  for (const [name, tex] of parsed.textures) if (indexed(tex.format) && !textures.has(name)) getVariant(name, name);
  const input = join(dir, "palette-source.brres"), extracted = join(dir, "palette-resources"), output = join(dir, "palette-direct.brres");
  await mkdir(dir, { recursive: true });
  await writeFile(input, data);
  const run = async (...args: string[]) => {
    const child = Bun.spawn([exe, ...args], { cwd: dir, env: process.env, stdout: "pipe", stderr: "pipe", windowsHide: true });
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code) throw new Error(`Could not prepare palette textures: ${(out + "\n" + err).trim().slice(-600)}`);
  };
  await run("EXTRACT", input, "--dest", extracted);
  const modelsDir = join(extracted, "3DModels(NW4R)");
  for (const file of await readdir(modelsDir)) {
    const path = join(modelsDir, file);
    let model = new Uint8Array(await readFile(path)), v = view(model);
    const layout = sections(v.getUint32(8));
    v.setInt32(16 + layout.palettes * 4, 0);
    const materials = v.getInt32(16 + layout.materials * 4);
    for (const material of materials ? group(model, materials) : []) {
      const layers = material.offset + v.getInt32(material.offset + 48);
      const original = parsed.models.find((m: any) => m.name === file)?.materials.find((m: any) => m.name === material.name);
      for (let i = 0; i < v.getUint32(material.offset + 44); i++) {
        const layer = layers + i * 52, binding = original?.layers[i];
        v.setInt32(layer + 4, 0); v.setInt32(layer + 12, 0); v.setUint32(layer + 20, 0);
        const variant = staticLayers.get(`${file}\0${material.name}\0${i}`);
        if (variant && variant !== binding.texture) {
          const name = new TextEncoder().encode(variant), start = Math.ceil(model.length / 4) * 4;
          const grown = new Uint8Array(align(start + 4 + name.length + 1));
          grown.set(model); grown.set(name, start + 4); model = grown; v = view(model);
          v.setUint32(start, name.length); v.setInt32(layer, start + 4 - layer);
          v.setUint32(4, model.length);
        }
      }
    }
    await writeFile(path, model);
  }
  for (const [name, bytes] of textures) {
    const path = resolve(extracted, "Textures(NW4R)", name);
    if (!path.startsWith(resolve(extracted, "Textures(NW4R)") + sep)) throw new Error("Invalid texture name");
    await writeFile(path, bytes);
  }
  for (const [name, animation] of animations) {
    const folder = resolve(extracted, "AnmTexPat(NW4R)"), path = resolve(folder, name);
    if (!path.startsWith(folder + sep)) throw new Error("Invalid pattern animation name");
    await writeFile(path, writePAT0(animation));
  }
  const palettesDir = resolve(extracted, "Palettes(NW4R)");
  if (!palettesDir.startsWith(resolve(dir) + sep)) throw new Error("Unsafe palette working directory");
  await rm(palettesDir, { recursive: true, force: true });
  await run("CREATE", "--brres", extracted, "--dest", output);
  return new Uint8Array(await readFile(output));
}

// Collada/PNG conversion otherwise re-encodes imported textures as CMPR, losing
// soft alpha and custom mipmaps. Transplant the source TEX0 data after geometry
// conversion, changing only the resource name and BRRES-relative header pointer.
export async function transplantBRRESTextures(source: Uint8Array, result: Uint8Array, names: Record<string, string>, dir: string) {
  if (!Object.keys(names).length) return result;
  const exe = wszstPath();
  if (!exe) throw new Error("Preserving imported model textures requires the included Wiimm SZS tools");
  await mkdir(dir, { recursive: true });
  const sourcePath = join(dir, "source.brres"), resultPath = join(dir, "result.brres"), outputPath = join(dir, "output.brres");
  const sourceDir = join(dir, "source"), resultDir = join(dir, "result");
  await writeFile(sourcePath, source); await writeFile(resultPath, result);
  const run = async (...args: string[]) => {
    const child = Bun.spawn([exe, ...args], { cwd: dir, env: process.env, stdout: "pipe", stderr: "pipe", windowsHide: true });
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code) throw new Error(`Could not preserve imported textures: ${(out + "\n" + err).trim().slice(-600)}`);
  };
  await run("EXTRACT", sourcePath, "--dest", sourceDir);
  await run("EXTRACT", resultPath, "--dest", resultDir);
  const texturePath = (root: string, name: string) => {
    const folder = resolve(root, "Textures(NW4R)"), path = resolve(folder, name);
    if (!path.startsWith(folder + sep)) throw new Error("Invalid imported texture name");
    return path;
  };
  for (const [from, to] of Object.entries(names)) {
    const original = await readFile(texturePath(sourceDir, from)), text = new TextEncoder().encode(to);
    const renamed = Buffer.alloc(align(original.length) + 4 + text.length + 1);
    renamed.set(original); renamed.writeInt32BE(0, 12);
    renamed.writeUInt32BE(align(original.length) + 4, 20);
    renamed.writeUInt32BE(text.length, align(original.length)); renamed.set(text, align(original.length) + 4);
    await writeFile(texturePath(resultDir, to), renamed);
  }
  await run("CREATE", "--brres", resultDir, "--dest", outputPath);
  return new Uint8Array(await readFile(outputPath));
}

function sameTextureResource(a: any, b: any) {
  if (!a || !b || a.size !== b.size) return false;
  const x = a.reader.d.subarray(a.offset, a.offset + a.size);
  const y = b.reader.d.subarray(b.offset, b.offset + b.size);
  if (x.length !== a.size || y.length !== b.size) return false;
  for (let i = 0; i < x.length; i++) {
    // Container relocation changes the BRRES-relative and name pointers.
    if ((i >= 12 && i < 16) || (i >= 20 && i < 24)) continue;
    if (x[i] !== y[i]) return false;
  }
  return true;
}

// ABMatt's patch cleanup can drop unreferenced textures or re-encode existing
// ones. Neither is an intended side effect of adding geometry. Restore only
// changed/missing original TEX0 resources and verify their complete contents,
// including LOD settings, dimensions, alpha and every compressed mip level.
export async function preserveExistingBRRESTextures(original: Uint8Array, result: Uint8Array, dir: string) {
  const before = parseBRRES(original).textures, after = parseBRRES(result).textures;
  const names: Record<string, string> = Object.create(null);
  for (const [name, texture] of before) if (!sameTextureResource(texture, after.get(name))) names[name] = name;
  if (!Object.keys(names).length) return result;
  const restored = await transplantBRRESTextures(original, result, names, dir);
  const textures = parseBRRES(restored).textures;
  for (const [name, texture] of before) {
    if (!sameTextureResource(texture, textures.get(name))) throw new Error(`Could not preserve existing texture ${name}`);
  }
  return restored;
}

// ABMatt only handles the first PAT0 slot. Keep complete original animations
// and attach imported patterns natively after it has finished the geometry.
// Resources removed by staticBRRESModelSource (CHR0, CLR0, SCN0, SHP0, VIS0…)
// are restored unchanged.
export async function preserveBRRESPatterns(original: Uint8Array, result: Uint8Array, dir: string, additions: any[] = []) {
  const patterned = await preservePatternResources(original, result, join(dir, "pat0"), additions);
  return restorePassthroughResources(original, patterned, join(dir, "passthrough"));
}

async function restorePassthroughResources(original: Uint8Array, result: Uint8Array, dir: string) {
  const resourceNames = (data: Uint8Array) => new Map(group(data, view(data).getUint16(12) + 8)
    .map((folder) => [folder.name, new Set(group(data, folder.offset).map((resource) => resource.name))]));
  const before = resourceNames(original), after = resourceNames(result);
  const missing = [...before].filter(([folder, names]) => passthrough(folder) && [...names].some((name) => !after.get(folder)?.has(name)));
  if (!missing.length) return result;
  const exe = wszstPath();
  if (!exe) throw new Error("Preserving model animations requires the included Wiimm tools");
  await mkdir(dir, { recursive: true });
  const sourcePath = join(dir, "original.brres"), resultPath = join(dir, "result.brres"), output = join(dir, "output.brres");
  const sourceDir = join(dir, "original"), resultDir = join(dir, "result");
  const run = async (...args: string[]) => {
    const child = Bun.spawn([exe, ...args], { cwd: dir, env: process.env, stdout: "pipe", stderr: "pipe", windowsHide: true });
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code) throw new Error(`Could not preserve model animations: ${(out + "\n" + err).trim().slice(-600)}`);
  };
  await writeFile(sourcePath, original); await writeFile(resultPath, result);
  await run("EXTRACT", sourcePath, "--dest", sourceDir);
  await run("EXTRACT", resultPath, "--dest", resultDir);
  for (const [folder] of missing) {
    const from = resolve(sourceDir, folder), to = resolve(resultDir, folder);
    if (!from.startsWith(resolve(sourceDir) + sep) || !to.startsWith(resolve(resultDir) + sep)) throw new Error("Invalid animation resource path");
    await mkdir(to, { recursive: true });
    // Resources the operation itself added (e.g. an imported CHR0) are kept.
    const existing = new Set((await readdir(to)).map((file) => file.toLowerCase()));
    for (const file of await readdir(from)) if (!existing.has(file.toLowerCase())) await cp(join(from, file), join(to, file), { recursive: true });
  }
  await run("CREATE", "--brres", resultDir, "--dest", output);
  const restored = new Uint8Array(await readFile(output)), final = resourceNames(restored);
  for (const [folder, names] of missing) for (const name of names) {
    if (!final.get(folder)?.has(name)) throw new Error(`Model resource ${folder}/${name} was not preserved`);
  }
  return restored;
}

async function preservePatternResources(original: Uint8Array, result: Uint8Array, dir: string, additions: any[]) {
  const before = parseBRRES(original).pat, after = parseBRRES(result).pat;
  const signature = (animation: any) => JSON.stringify([animation.name, animation.frames, animation.loop, [...animation.materials]]);
  if (!additions.length && before.size === after.size && [...before].every(([name, animation]) => after.has(name) && signature(animation) === signature(after.get(name)))) return result;
  if (!before.size && !additions.length) return result;
  const exe = wszstPath();
  if (!exe) throw new Error("Preserving pattern animations requires the included Wiimm tools");
  await mkdir(dir, { recursive: true });
  const sourcePath = join(dir, "original.brres"), resultPath = join(dir, "result.brres"), output = join(dir, "output.brres");
  const sourceDir = join(dir, "original"), resultDir = join(dir, "result"), patternDir = join(resultDir, "AnmTexPat(NW4R)");
  const run = async (...args: string[]) => {
    const child = Bun.spawn([exe, ...args], { cwd: dir, env: process.env, stdout: "pipe", stderr: "pipe", windowsHide: true });
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code) throw new Error(`Could not preserve pattern animations: ${(out + "\n" + err).trim().slice(-600)}`);
  };
  await writeFile(resultPath, result);
  await run("EXTRACT", resultPath, "--dest", resultDir);
  if (!resolve(patternDir).startsWith(resolve(dir) + sep)) throw new Error("Invalid pattern working directory");
  await rm(patternDir, { recursive: true, force: true });
  await mkdir(patternDir, { recursive: true });
  if (before.size) {
    await writeFile(sourcePath, original);
    await run("EXTRACT", sourcePath, "--dest", sourceDir);
    await cp(join(sourceDir, "AnmTexPat(NW4R)"), patternDir, { recursive: true });
  }
  for (const animation of additions) {
    const path = resolve(patternDir, animation.name);
    if (!path.startsWith(resolve(patternDir) + sep) || before.has(animation.name)) throw new Error("Invalid or conflicting imported animation name");
    await writeFile(path, writePAT0(animation));
  }
  await run("CREATE", "--brres", resultDir, "--dest", output);
  const restored = new Uint8Array(await readFile(output)), patterns = parseBRRES(restored).pat;
  for (const [name, animation] of [...before, ...additions.map((a) => [a.name, a])]) {
    if (!patterns.has(name) || signature(patterns.get(name)) !== signature(animation)) throw new Error(`Pattern animation ${name} was not preserved`);
  }
  return restored;
}
