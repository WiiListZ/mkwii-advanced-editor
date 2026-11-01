import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
// @ts-ignore Shared reader used by the editor.
import { parseBRRES, evalTrack } from "../web/js/formats/brres.js";

export type ImportedAnimation = {
  name: string;
  frames: number;
  bones: Record<string, { frames: number[][] }>;
};

export const rszstPath = () => [
  process.env.MKWII_RSZST,
  join(homedir(), "Documents", "RiiStudio", "rszst.exe"),
  Bun.which("rszst"),
].filter(Boolean).find((path) => existsSync(path!));

// Wiimm's SZS tools: MKWII_WSZST, PATH, or the installer's default folder.
export const wszstPath = () => [
  process.env.MKWII_WSZST,
  Bun.which("wszst"),
  join(process.env.ProgramW6432 || "C:\\Program Files", "Wiimm", "SZS", "wszst.exe"),
  join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Wiimm", "SZS", "wszst.exe"),
].filter(Boolean).find((path) => existsSync(path!)) || null;

async function run(exe: string, cwd: string, ...args: string[]) {
  const child = Bun.spawn([exe, ...args], { cwd, env: process.env, stdout: "pipe", stderr: "pipe", windowsHide: true });
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (code) throw new Error(`RiiStudio failed: ${(out + "\n" + err).trim().slice(-900)}`);
}

const align = (n: number) => (n + 63) & ~63;
function unpackBuffers(bytes: Uint8Array) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (String.fromCharCode(...bytes.slice(0, 4)) !== "RBUF" || v.getUint32(4) !== 100) throw new Error("Invalid RiiStudio buffer");
  return Array.from({ length: v.getUint32(8) }, (_, i) => {
    const start = v.getUint32(16 + i * 8), length = v.getUint32(20 + i * 8);
    if (start + length > bytes.length) throw new Error("Invalid RiiStudio buffer offset");
    return bytes.slice(start, start + length);
  });
}
function packBuffers(buffers: Uint8Array[]) {
  const size = align(16 + buffers.length * 8) + buffers.reduce((sum, b) => sum + align(b.length), 0);
  const out = new Uint8Array(size), v = new DataView(out.buffer);
  out.set([82, 66, 85, 70]);
  v.setUint32(4, 100); v.setUint32(8, buffers.length); v.setUint32(12, size);
  let at = align(16 + buffers.length * 8);
  buffers.forEach((buffer, i) => {
    v.setUint32(16 + i * 8, at); v.setUint32(20 + i * 8, buffer.length);
    out.set(buffer, at); at = align(at + buffer.length);
  });
  return out;
}

const flags = ((1 << 0) | (1 << 22) | (1 << 23) | (1 << 24) | (3 << 25) | (3 << 27) | (3 << 30)) >>> 0;

/** Removes one CHR0 animation from a BRRES, rebuilding only the archive container (wszst). */
export async function removeCHR0(brres: Uint8Array, name: string, dir: string) {
  const wszst = wszstPath();
  if (!wszst) throw new Error("Removing an animation requires Wiimm's SZS tools (wszst).");
  const before = parseBRRES(brres);
  if (!before.chr.has(name)) throw new Error(`Animation ${name} not found`);
  const source = join(dir, "source.brres"), extracted = join(dir, "extracted"), output = join(dir, "result.brres");
  await writeFile(source, brres);
  await run(wszst, dir, "EXTRACT", source, "--dest", extracted);
  const folder = join(extracted, "AnmChr(NW4R)");
  const files = existsSync(folder) ? await readdir(folder) : [];
  const file = files.find((f) => f.replace(/\.chr0$/i, "") === name);
  if (!file) throw new Error(`wszst did not extract ${name}`);
  await rm(join(folder, file));
  if (files.length === 1) await rm(folder, { recursive: true });
  await run(wszst, dir, "CREATE", "--brres", extracted, "--dest", output);
  const result = new Uint8Array(await readFile(output));
  const after = parseBRRES(result);
  if (after.chr.has(name) || after.chr.size !== before.chr.size - 1 || after.models.length !== before.models.length || after.textures.size !== before.textures.size
    || after.srt.size !== before.srt.size || after.pat.size !== before.pat.size || after.clr.size !== before.clr.size)
    throw new Error("Removing the animation changed other parts of the BRRES");
  return result;
}

/** Adds sampled Blender bone transforms as CHR0 animations (one per entry) inside a course BRRES. */
export async function attachCHR0(brres: Uint8Array, animations: ImportedAnimation | ImportedAnimation[], dir: string) {
  const exe = rszstPath();
  if (!exe) throw new Error("Animated model import requires RiiStudio rszst.exe in Documents\\RiiStudio, or MKWII_RSZST.");
  const list = Array.isArray(animations) ? animations : [animations];
  const before = parseBRRES(brres), model = before.models.find((m: any) => m.name === "course") || before.models[0];
  if (!model || !list.length || list.some((animation) => !Number.isInteger(animation.frames) || animation.frames < 1 || animation.frames > 65534)) throw new Error("Invalid imported animation");
  const source = join(dir, "animated-source.brres"), jsonPath = join(dir, "animated.json"), output = join(dir, "animated-result.brres");
  await writeFile(source, brres);
  let convertible = source;
  let existingCHRDirectory: string | null = null;
  const wszst = before.chr.size ? wszstPath() : null;
  if (before.chr.size) {
    if (!wszst) throw new Error("Adding an animation to a course with existing CHR0 requires Wiimm's wszst tool.");
    const extracted = join(dir, "original-brres"), stripped = join(dir, "without-original-chr");
    await run(wszst, dir, "EXTRACT", source, "--dest", extracted);
    existingCHRDirectory = join(extracted, "AnmChr(NW4R)");
    await mkdir(stripped);
    for (const name of await readdir(extracted)) {
      if (name !== "AnmChr(NW4R)") await cp(join(extracted, name), join(stripped, name), { recursive: true });
    }
    convertible = join(dir, "without-original-chr.brres");
    await run(wszst, dir, "CREATE", "--brres", stripped, "--dest", convertible);
  }
  await run(exe, dir, "brres-to-json", convertible, jsonPath);
  const data = JSON.parse(await readFile(jsonPath, "utf8"));
  const bufferPath = join(dir, "animated.bin"), buffers = unpackBuffers(new Uint8Array(await readFile(bufferPath)));
  const added: { name: string; frames: number; nodes: any[] }[] = [];
  for (const animation of list) {
    const tracks: any[] = [], nodes: any[] = [];
    for (const [sourceName, boneData] of Object.entries(animation.bones)) {
      const normalized = sourceName.replace(/\.(\d+)/g, "_$1");
      const candidates = model.bones.filter((b: any) => b.name === normalized);
      if (candidates.length !== 1) throw new Error(`Imported animation bone ${sourceName} cannot be matched to one model bone`);
      const bone = candidates[0];
      if (boneData.frames.length !== animation.frames + 1) throw new Error(`Invalid frame count for bone ${sourceName}`);
      const indices = Array.from({ length: 9 }, (_, axis) => {
        const bytes = new Uint8Array(boneData.frames.length * 24), view = new DataView(bytes.buffer);
        boneData.frames.forEach((values, frame) => {
          if (values.length !== 9 || !values.every(Number.isFinite)) throw new Error(`Invalid transform for ${sourceName}, frame ${frame}`);
          const value = values[axis];
          const previous = boneData.frames[Math.max(0, frame - 1)][axis];
          const next = boneData.frames[Math.min(animation.frames, frame + 1)][axis];
          view.setFloat64(frame * 24, frame, true);
          view.setFloat64(frame * 24 + 8, value, true);
          view.setFloat64(frame * 24 + 16, (next - previous) / (frame ? frame === animation.frames ? 1 : 2 : 1), true);
        });
        const framesDataBufferId = buffers.push(bytes) - 1;
        tracks.push({ quant: "Track96", scale: 1, offset: 0, framesDataBufferId, numKeyFrames: boneData.frames.length });
        return tracks.length - 1;
      });
      nodes.push({ name: bone.name, flags, tracks: indices });
    }
    if (!nodes.length) throw new Error("Animated model has no bones");
    let chrName = `${animation.name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 24) || "Imported"}_CHR`;
    for (let i = 1; before.chr.has(chrName) || data.chrs.some((c: any) => c.name === chrName); i++) chrName = `${animation.name.slice(0, 20)}_${i}_CHR`;
    data.chrs.push({ name: chrName, sourcePath: "", frameDuration: animation.frames, wrapMode: 1, scaleRule: 0, nodes, tracks });
    added.push({ name: chrName, frames: animation.frames, nodes });
  }
  await writeFile(jsonPath, JSON.stringify(data));
  await writeFile(bufferPath, packBuffers(buffers));
  await run(exe, dir, "json-to-brres", jsonPath, output);
  let resultPath = output;
  if (existingCHRDirectory && wszst) {
    const extracted = join(dir, "with-new-chr");
    await run(wszst, dir, "EXTRACT", output, "--dest", extracted);
    await cp(existingCHRDirectory, join(extracted, "AnmChr(NW4R)"), { recursive: true });
    resultPath = join(dir, "animated-preserved.brres");
    await run(wszst, dir, "CREATE", "--brres", extracted, "--dest", resultPath);
  }
  const result = new Uint8Array(await readFile(resultPath));
  const after = parseBRRES(result), next = after.models.find((m: any) => m.name === model.name);
  if (!next || next.objects.length !== model.objects.length || after.textures.size !== before.textures.size || [...before.chr.keys()].some((name) => !after.chr.has(name)))
    throw new Error("The saved BRRES did not preserve the model and CHR0 animations");
  for (const { name, frames, nodes } of added) {
    const chr = after.chr.get(name);
    if (!chr || chr.frames !== frames) throw new Error(`The saved BRRES lost the CHR0 animation ${name}`);
    for (const node of nodes) {
      const parsed = chr.bones.get(node.name);
      if (!parsed || !Number.isFinite(evalTrack(parsed.trans[0], 0))) throw new Error(`Saved CHR0 bone ${node.name} is invalid (${[...chr.bones.keys()].join(", ")})`);
    }
  }
  return result;
}
