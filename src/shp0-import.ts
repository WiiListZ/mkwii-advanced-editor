import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { wszstPath } from "./chr0-import.ts";
import type { ImportedShape, ShapeController } from "./weighted-model.ts";
// @ts-ignore Shared JavaScript BRRES reader.
import { parseBRRES } from "../web/js/formats/brres.js";

const align = (value: number, boundary = 4) => Math.ceil(value / boundary) * boundary;
const safeName = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 28) || "Imported";

function shapeBinary(name: string, frames: number, base: string, targets: ShapeController[]) {
  if (!targets.length || targets.length > 32 || frames < 1 || frames > 65534) throw new Error("Invalid SHP0 shape animation");
  const n = targets.length, group = 0x2c, controller = group + 0x28;
  const pointerStart = controller + 0x14, indexStart = pointerStart + n * 4;
  let position = align(indexStart + n * 2);
  const curves: number[] = [];
  for (const target of targets) {
    if (target.values.length !== frames + 1) throw new Error("Invalid SHP0 frame count");
    curves.push(position);
    position = align(position + 8 + (frames + 1) * 12);
  }
  const namesStart = position, names = [name, base, ...targets.map((target) => target.target)];
  const namePositions: number[] = [];
  for (const text of names) { namePositions.push(position); position += Buffer.byteLength(text, "utf8") + 1; }
  const namesSection = align(position), size = align(namesSection + (n + 1) * 4, 32);
  const out = Buffer.alloc(size);
  out.write("SHP0", 0, "ascii");
  out.writeUInt32BE(size, 4);
  out.writeUInt32BE(4, 8);
  out.writeUInt32BE(group, 0x10);
  out.writeUInt32BE(namesSection, 0x14);
  out.writeInt32BE(namePositions[0] - 0x1c, 0x1c);
  out.writeUInt16BE(frames, 0x24);
  out.writeUInt16BE(n + 1, 0x26);
  out.writeUInt32BE(1, 0x28);
  out.writeUInt32BE(0x28, group);
  out.writeUInt32BE(1, group + 4);
  out.writeUInt16BE(0xffff, group + 8);
  out.writeUInt16BE(1, group + 12);
  const entry = group + 0x18;
  const last = name.charCodeAt(name.length - 1);
  out.writeUInt16BE(((name.length - 1) << 3) | (31 - Math.clz32(last)), entry);
  out.writeUInt16BE(1, entry + 4);
  out.writeUInt16BE(1, entry + 6);
  out.writeInt32BE(namePositions[1] - group, entry + 8);
  out.writeInt32BE(controller - group, entry + 12);
  out.writeUInt32BE(3, controller); // base + position morph
  out.writeInt32BE(namePositions[1] - controller, controller + 4);
  out.writeUInt16BE(0, controller + 8); // base position name, section 1 index
  out.writeUInt16BE(n, controller + 10);
  out.writeUInt32BE(0, controller + 12); // animated tracks, no constant masks
  out.writeUInt32BE(indexStart - controller, controller + 16);
  for (let i = 0; i < n; i++) {
    out.writeInt32BE(curves[i] - (pointerStart + i * 4), pointerStart + i * 4);
    out.writeUInt16BE(i + 1, indexStart + i * 2);
    const at = curves[i], values = targets[i].values;
    out.writeUInt16BE(values.length, at);
    out.writeFloatBE(1 / frames, at + 4);
    for (let frame = 0; frame < values.length; frame++) {
      const value = Math.max(0, Math.min(1, values[frame]));
      const previous = Math.max(0, Math.min(1, values[Math.max(0, frame - 1)]));
      const next = Math.max(0, Math.min(1, values[Math.min(frames, frame + 1)]));
      out.writeFloatBE(frame, at + 8 + frame * 12);
      out.writeFloatBE(value, at + 12 + frame * 12);
      out.writeFloatBE((next - previous) / (frame === 0 || frame === frames ? 1 : 2), at + 16 + frame * 12);
    }
  }
  names.forEach((text, i) => out.write(text + "\0", namePositions[i], "utf8"));
  for (let i = 0; i < n + 1; i++) out.writeInt32BE(namePositions[i + 1] - (namesSection + i * 4), namesSection + i * 4);
  return out;
}

async function run(exe: string, cwd: string, ...args: string[]) {
  const process = Bun.spawn([exe, ...args], { cwd, env: process.env, stdout: "pipe", stderr: "pipe", windowsHide: true });
  const [code, stdout, stderr] = await Promise.all([process.exited, new Response(process.stdout).text(), new Response(process.stderr).text()]);
  if (code) throw new Error(`SHP0 import failed: ${(stdout + "\n" + stderr).trim().slice(-900)}`);
}

export async function attachSHP0(brres: Uint8Array, animation: ImportedShape, controllers: ShapeController[], dir: string) {
  if (!controllers.length) return brres;
  const wszst = wszstPath();
  if (!wszst) throw new Error("Shape key import requires Wiimm's wszst tool");
  const source = join(dir, "shapes-source.brres"), extracted = join(dir, "shapes-extracted"), output = join(dir, "shapes-result.brres");
  await writeFile(source, brres);
  await run(wszst, dir, "EXTRACT", source, "--dest", extracted);
  const folder = join(extracted, "AnmShp(NW4R)");
  await mkdir(folder, { recursive: true });
  const existing = new Set(await readdir(folder));
  const grouped = Map.groupBy(controllers, (controller) => controller.base);
  let index = 0;
  for (const [base, targets] of grouped) {
    let name = `${safeName(animation.name)}_${index++}_SHP`;
    for (let suffix = 1; existing.has(name); suffix++) name = `${safeName(animation.name)}_${index}_${suffix}_SHP`;
    existing.add(name);
    await writeFile(join(folder, name), shapeBinary(name, animation.frames, base, targets));
  }
  await run(wszst, dir, "CREATE", "--brres", extracted, "--dest", output);
  const result = new Uint8Array(await readFile(output));
  const before = parseBRRES(brres), after = parseBRRES(result);
  if (before.models.length !== after.models.length || before.models[0].objects.length !== after.models[0].objects.length
    || before.textures.size !== after.textures.size || before.chr.size !== after.chr.size || before.srt.size !== after.srt.size)
    throw new Error("SHP0 import changed other resources");
  const verify = join(dir, "shapes-verify");
  await run(wszst, dir, "EXTRACT", output, "--dest", verify);
  const files = new Set(await readdir(join(verify, "AnmShp(NW4R)")));
  for (const name of existing) if (!files.has(name)) throw new Error(`SHP0 animation ${name} was not retained`);
  return result;
}
