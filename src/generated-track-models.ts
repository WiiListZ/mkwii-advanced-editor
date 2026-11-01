// Persist the generator's visual geometry as real game resources, using the bundled
// OBJ converter directly. Blender and a source game's course/sky are not required.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { deflateSync } from "node:zlib";
import { abmattPath } from "./model-operations.ts";
import { modelToOBJ } from "../web/js/formats/obj.js";
import { parseBRRES } from "../web/js/formats/brres.js";
import { crc32 } from "../web/js/formats/pulsar.js";
import { buildU8, newSzsTree, setFilePath } from "../web/js/formats/u8.js";
import { buildCollisionShape } from "../web/js/editor/collision.js";

type Model = { tris: { mat: string; v: number[]; uv?: number[] }[]; materials: Record<string, { color: number[] }> };

function solidPNG(color: number[]) {
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(data.length + 12), view = new DataView(out.buffer);
    view.setUint32(0, data.length); out.set(new TextEncoder().encode(type), 4); out.set(data, 8);
    view.setUint32(out.length - 4, crc32(out.subarray(4, out.length - 4)));
    return out;
  };
  const header = new Uint8Array(13), view = new DataView(header.buffer);
  view.setUint32(0, 8); view.setUint32(4, 8); header[8] = 8; header[9] = 6;
  const pixels = new Uint8Array(8 * (1 + 8 * 4));
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const at = y * 33 + 1 + x * 4;
    for (let c = 0; c < 3; c++) pixels[at + c] = Math.round(Math.max(0, Math.min(1, color[c])) * 255);
    pixels[at + 3] = 255;
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", new Uint8Array())]);
}

export async function buildGeneratedTrackModels(model: Model) {
  if (!model?.tris?.length || model.tris.length > 65534) throw new Error("Invalid generated track geometry");
  for (const tri of model.tris) {
    if (!/^[A-Za-z0-9_]{1,32}$/.test(tri.mat) || tri.v?.length !== 9 || !tri.v.every(Number.isFinite)) throw new Error("Invalid generated model triangle");
  }
  const exe = abmattPath();
  if (!exe) throw new Error("The included model converter is unavailable. The new track was not saved.");
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const tri of model.tris) for (let k = 0; k < 9; k++) { const a = k % 3; lo[a] = Math.min(lo[a], tri.v[k]); hi[a] = Math.max(hi[a], tri.v[k]); }
  const center = lo.map((v, i) => (v + hi[i]) / 2), radius = Math.max(60000, ...hi.map((v, i) => (v - lo[i]) * 1.5));
  const skyTris = buildCollisionShape("box", [[center[0] - radius, center[1] - radius, center[2] - radius], [center[0] + radius, center[1] - radius, center[2] + radius]], { height: radius * 2 });
  const sky: Model = { materials: { sky: { color: [.43, .68, .92] } }, tris: skyTris.map((t: number[][]) => ({ mat: "sky", v: [...t[0], ...t[2], ...t[1]], uv: [0, 0, 1, 1, 1, 0] })) };
  const map: Model = { materials: { map_white: { color: [1, 1, 1] } }, tris: model.tris.filter((t) => ["road", "startline", "boost"].includes(t.mat)).map((t) => ({ mat: "map_white", v: t.v.map((v, i) => i % 3 === 1 ? 0 : v), uv: t.uv })) };
  if (!map.tris.length) throw new Error("The generated track has no road for its minimap");
  const resources: [string, string, Model][] = [["course", "course_model.brres", model], ["vrcorn", "vrcorn_model.brres", sky], ["map", "map_model.brres", map]];
  const dir = await mkdtemp(join(tmpdir(), "mkwii-generated-models-"));
  try {
    for (const [name, , source] of resources) {
      const { obj, mtl } = modelToOBJ(source, `${name}.mtl`);
      await writeFile(join(dir, `${name}.obj`), obj);
      await writeFile(join(dir, `${name}.mtl`), mtl.replace(/# map_Kd ([A-Za-z0-9_]+\.png)/g, "map_Kd $1"));
      for (const mat of new Set(source.tris.map((t) => t.mat))) {
        const color = source.materials?.[mat]?.color || [.7, .7, .7];
        if (color.length !== 3 || !color.every(Number.isFinite)) throw new Error("Invalid generated model colour");
        await writeFile(join(dir, `${mat}.png`), solidPNG(color));
      }
    }
    const tree = newSzsTree();
    for (const [name, target, source] of resources) {
      await writeFile(join(dir, "commands.txt"), `convert ${name}.obj to ${target}\n`);
      const child = Bun.spawn([exe, "-f", "commands.txt", "-o"], { cwd: dir, env: process.env, stdout: "pipe", stderr: "pipe", windowsHide: true });
      const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      if (code) throw new Error(`Could not build ${target}: ${(out + "\n" + err).trim().slice(-800)}`);
      const bytes = new Uint8Array(await readFile(join(dir, target)).catch(() => { throw new Error(`Could not create ${target}: ${(out + "\n" + err).trim().slice(-1800)}`); })), parsed = parseBRRES(bytes);
      const built = parsed.models.find((m: any) => m.name === name);
      if (!built || built.objects.reduce((n: number, o: any) => n + o.triangles, 0) !== source.tris.length || !parsed.textures.size) throw new Error(`The generated ${target} is missing geometry or textures`);
      if (name === "map" && !["posLD", "posRU"].every((n) => built.bones.some((b: any) => b.name === n))) throw new Error("The generated minimap has no position bounds");
      setFilePath(tree, target, bytes);
    }
    return buildU8(tree);
  } finally {
    if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe generated model temporary path");
    await rm(dir, { recursive: true, force: true });
  }
}
