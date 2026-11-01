// ABMatt cannot read MDL0 palette links. Expand indexed textures losslessly before
// handing it a model, including each original mip level (never regenerate them).
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { wszstPath } from "./chr0-import.ts";
import { parseBRRES } from "../web/js/formats/brres.js";

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

export function hasBRRESPaletteLinks(data: Uint8Array) {
  const v = view(data);
  const models = group(data, v.getUint16(12) + 8).find((f) => f.name === "3DModels(NW4R)");
  return !!models && group(data, models.offset).some((m) => v.getInt32(m.offset + 16 + sections(v.getUint32(m.offset + 8)).palettes * 4) !== 0);
}

export function needsBRRESPaletteConversion(data: Uint8Array) {
  if (hasBRRESPaletteLinks(data)) return true;
  const v = view(data), folder = group(data, v.getUint16(12) + 8).find((f) => f.name === "Textures(NW4R)");
  return !!folder && group(data, folder.offset).some((t) => indexed(v.getUint32(t.offset + 32)));
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
  const exe = wszstPath();
  if (!exe) throw new Error("Palette texture import requires the included Wiimm SZS tools");
  const bindings = new Map<string, Set<string>>();
  for (const model of parsed.models) for (const material of model.materials) for (const layer of material.layers) {
    if (!layer.palette) continue;
    if (!bindings.has(layer.texture)) bindings.set(layer.texture, new Set());
    bindings.get(layer.texture)!.add(layer.palette);
  }
  // Do not silently flatten a palette animation into its first frame.
  const originalView = view(data);
  for (const folder of group(data, originalView.getUint16(12) + 8)) if (folder.name === "AnmTexPat(NW4R)") {
    for (const resource of group(data, folder.offset)) {
      const header = resource.offset + 0x24 + (originalView.getUint32(resource.offset + 8) >= 4 ? 4 : 0);
      if (originalView.getUint16(header + 14)) throw new Error("This model animates its texture palettes; importing it through ABMatt would lose those colours.");
    }
  }
  const textures = new Map<string, Uint8Array>(), variants = new Map<string, string>();
  const taken = new Set<string>(parsed.textures.keys());
  for (const [name, tex] of parsed.textures) if (indexed(tex.format)) {
    const names = [...(bindings.get(name) || [name])];
    for (const [index, paletteName] of names.entries()) {
      const palette = parsed.palettes.get(paletteName);
      if (!palette) throw new Error(`Texture ${name} is missing its palette ${paletteName}`);
      let variant = name;
      if (index) {
        const stem = `${name}_${paletteName}`.replace(/[^A-Za-z0-9_-]/g, "_");
        variant = stem;
        for (let n = 2; taken.has(variant); n++) variant = `${stem}_${n}`;
        taken.add(variant);
      }
      textures.set(variant, directTexture(tex, palette, variant));
      variants.set(`${name}\0${paletteName}`, variant);
    }
  }
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
        const variant = binding && variants.get(`${binding.texture}\0${binding.palette}`);
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
