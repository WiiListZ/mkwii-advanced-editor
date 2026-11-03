// ABMatt defaults to CMPR (one-bit alpha). Keep PNG soft alpha in RGBA32
// before exporting/merging imported materials, so opacity never disappears.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { wszstPath } from "./chr0-import.ts";
import { decodeTexture, encodeTextureLevels, parseBRRES } from "../web/js/formats/brres.js";

export async function preserveImportedImageAlpha(data: Uint8Array, imageFolder: string, dir: string, abmatt: string) {
  const parsed = parseBRRES(data), textures = parsed.textures;
  const wszst = wszstPath();
  const wimgt = wszst && join(dirname(wszst), process.platform === "win32" ? "wimgt.exe" : "wimgt");
  const replacements = new Map<string, Uint8Array>();
  let index = 0;
  const run = async (exe: string, ...args: string[]) => {
    const child = Bun.spawn([exe, ...args], { cwd: dir, env: process.env, stdout: "pipe", stderr: "pipe", windowsHide: true });
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code) throw new Error(`Could not preserve imported image transparency: ${(out + "\n" + err).trim().slice(-600)}`);
  };
  for (const [name, texture] of textures) {
    const path = resolve(imageFolder, `${name}.png`);
    if (!path.startsWith(resolve(imageFolder) + sep) || !existsSync(path)) continue;
    const png = await readFile(path);
    // RGB/grayscale PNGs without a tRNS chunk cannot contain transparency.
    if (png.length < 33 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) continue;
    let hasAlpha = png[25] === 4 || png[25] === 6;
    for (let at = 8; !hasAlpha && at + 12 <= png.length; ) {
      hasAlpha = png.toString("ascii", at + 4, at + 8) === "tRNS";
      at += 12 + png.readUInt32BE(at);
    }
    if (!hasAlpha) continue;
    if (!wszst || !wimgt || !existsSync(wimgt)) throw new Error("Keeping image transparency requires the included Wiimm image tools");
    await mkdir(dir, { recursive: true });
    const output = join(dir, `image-${index++}.tex`);
    await run(wimgt, "ENCODE", path, "--dest", output, "--transform", "TEX.RGBA32", "--n-mipmaps", "0");
    const encoded = new Uint8Array(await readFile(output));
    const v = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);
    const width = v.getUint16(28), height = v.getUint16(30), start = v.getUint32(16);
    const rgba = decodeTexture({ width, height, format: 6, dataOffset: start, reader: { d: encoded } });
    if (!rgba.some((value: number, i: number) => i % 4 === 3 && value > 0 && value < 255)) continue;
    // Match ABMatt's selected dimensions. This also keeps oversized source
    // images from exceeding the Wii texture limits after its resize step.
    let pixels = rgba;
    if (width !== texture.width || height !== texture.height) {
      pixels = new Uint8Array(texture.width * texture.height * 4);
      for (let y = 0; y < texture.height; y++) for (let x = 0; x < texture.width; x++) {
        const source = (Math.min(height - 1, Math.floor((y + 0.5) * height / texture.height)) * width
          + Math.min(width - 1, Math.floor((x + 0.5) * width / texture.width))) * 4;
        pixels.set(rgba.subarray(source, source + 4), (y * texture.width + x) * 4);
      }
    }
    let size = 64, w = texture.width, h = texture.height;
    const levels = Math.max(1, texture.mipmaps);
    for (let level = 0; level < levels; level++) {
      size += Math.ceil(w / 4) * Math.ceil(h / 4) * 64;
      w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
    }
    const text = Buffer.from(name), resource = Buffer.alloc(size + 4 + text.length + 1);
    resource.write("TEX0"); resource.writeUInt32BE(size, 4); resource.writeUInt32BE(3, 8);
    resource.writeUInt32BE(64, 16); resource.writeUInt32BE(size + 4, 20);
    resource.writeUInt16BE(texture.width, 28); resource.writeUInt16BE(texture.height, 30);
    resource.writeUInt32BE(6, 32); resource.writeUInt32BE(levels, 36); resource.writeFloatBE(levels - 1, 44);
    resource.writeUInt32BE(text.length, size); resource.set(text, size + 4);
    encodeTextureLevels(resource, 64, size, pixels, texture.width, texture.height, 6, levels);
    replacements.set(name, resource);
  }
  if (!replacements.size) return data;
  const source = join(dir, "source.brres"), extracted = join(dir, "resources"), output = join(dir, "output.brres");
  await writeFile(source, data);
  await run(wszst!, "EXTRACT", source, "--dest", extracted);
  for (const [name, bytes] of replacements) await writeFile(join(extracted, "Textures(NW4R)", name), bytes);
  await run(wszst!, "CREATE", "--brres", extracted, "--dest", output);
  // An OBJ can supply alpha in its PNG without an MTL 'd' directive. ABMatt
  // otherwise leaves blending off even though the new texture has soft alpha.
  const blendMaterials = [...new Set(parsed.models.flatMap((model: any) => model.materials
    .filter((material: any) => !material.gx?.blend?.enabled && material.layers.some((layer: any) => replacements.has(layer.texture)))
    .map((material: any) => material.name)))];
  if (blendMaterials.length) {
    const commands = join(dir, "blend.txt");
    // Match Material.enable_blend(), rather than only flipping its blend bit.
    const settings = { blend: "true", xlu: "true", blendsrc: "sourcealpha", blenddest: "inversesourcealpha",
      ref0: "0", ref1: "0", comp0: "always", comp1: "always", comparebeforetexture: "true", enabledepthupdate: "false", drawpriority: "1" };
    await writeFile(commands, blendMaterials.flatMap((name) => Object.entries(settings)
      .map(([key, value]) => `set material ${key}:${value} for ${name}`)).join("\n") + "\n");
    await run(abmatt, "-b", output, "-o", "-f", commands);
  }
  const result = new Uint8Array(await readFile(output));
  for (const model of parseBRRES(result).models) for (const material of model.materials) {
    if (blendMaterials.includes(material.name) && (!material.xlu || !material.gx?.blend?.enabled))
      throw new Error(`Could not enable transparency for imported material ${material.name}`);
  }
  return result;
}
