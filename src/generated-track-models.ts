// Persist the generator's visual geometry as real game resources, using the bundled
// OBJ converter directly. Blender and a source game's course/sky are not required.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { abmattPath } from "./model-operations.ts";
import { resolveGeneratedMaterials, type GeneratedMaterial } from "./generated-materials.ts";
import { type GameTextureOptions } from "./generated-game-textures.ts";
import { transplantBRRESTextures } from "./brres-palettes.ts";
import { preserveImportedImageAlpha } from "./imported-textures.ts";
import { applyGeneratedBoost } from "./generated-boost.ts";
import { modelToOBJ } from "../web/js/formats/obj.js";
import { parseBRRES } from "../web/js/formats/brres.js";
import { buildU8, newSzsTree, setFilePath } from "../web/js/formats/u8.js";

type Model = { tris: { mat: string; v: number[]; uv?: number[] }[]; materials: Record<string, GeneratedMaterial> };

// A minimap on its own (map_model.brres), with one solid texture for each of its colours.
export async function buildMinimapModel(map: Model) {
  if (!map?.tris?.length || map.tris.length > 65534) throw new Error("A minimap needs between 1 and 65534 triangles");
  for (const tri of map.tris) {
    if (!/^[A-Za-z0-9_]{1,32}$/.test(tri.mat) || !map.materials?.[tri.mat] || tri.v?.length !== 9 || !tri.v.every(Number.isFinite)) throw new Error("Invalid minimap triangle");
  }
  const exe = abmattPath();
  if (!exe) throw new Error("The included model converter is unavailable.");
  const dir = await mkdtemp(join(tmpdir(), "mkwii-minimap-"));
  try {
    const { textures } = await resolveGeneratedMaterials(map.materials);
    const { obj, mtl } = modelToOBJ(map, "map.mtl", { maxTrianglesPerMaterial: 256 });
    await writeFile(join(dir, "map.obj"), obj);
    await writeFile(join(dir, "map.mtl"), mtl.replace(/# map_Kd ([A-Za-z0-9_]+\.png)/g, "map_Kd $1"));
    for (const [name, texture] of textures) await writeFile(join(dir, `${name}.png`), texture.png);
    await writeFile(join(dir, "commands.txt"), "convert map.obj to map_model.brres\n");
    const child = Bun.spawn([exe, "-f", "commands.txt", "-o"], { cwd: dir, env: process.env, stdout: "pipe", stderr: "pipe", windowsHide: true });
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code) throw new Error(`Could not build map_model.brres: ${(out + "\n" + err).trim().slice(-800)}`);
    const bytes = new Uint8Array(await readFile(join(dir, "map_model.brres")).catch(() => { throw new Error(`Could not create map_model.brres: ${(out + "\n" + err).trim().slice(-1800)}`); }));
    const built = parseBRRES(bytes).models.find((m: any) => m.name === "map");
    if (!built || built.objects.reduce((n: number, o: any) => n + o.triangles, 0) !== map.tris.length) throw new Error("The rebuilt minimap is missing geometry");
    if (!["posLD", "posRU"].every((n) => built.bones.some((b: any) => b.name === n))) throw new Error("The rebuilt minimap has no position bounds");
    return bytes;
  } finally {
    if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe minimap temporary path");
    await rm(dir, { recursive: true, force: true });
  }
}

export async function buildGeneratedTrackModels(model: Model, options: GameTextureOptions = {}) {
  if (!model?.tris?.length || model.tris.length > 65534) throw new Error("Invalid generated track geometry");
  for (const tri of model.tris) {
    if (!/^[A-Za-z0-9_]{1,32}$/.test(tri.mat) || tri.v?.length !== 9 || !tri.v.every(Number.isFinite)) throw new Error("Invalid generated model triangle");
  }
  const exe = abmattPath();
  if (!exe) throw new Error("The included model converter is unavailable. The new track was not saved.");
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const tri of model.tris) for (let k = 0; k < 9; k++) { const a = k % 3; lo[a] = Math.min(lo[a], tri.v[k]); hi[a] = Math.max(hi[a], tri.v[k]); }
  const center = lo.map((v, i) => (v + hi[i]) / 2), radius = Math.max(60000, ...hi.map((v, i) => (v - lo[i]) * 1.5));
  // An inward sphere keeps the sky gradient continuous at every camera angle;
  // a box would show its bottom-face edges against the elevated track.
  const sky: Model = { materials: { sky: { color: [.43, .68, .92], surface: "sky" } }, tris: [] };
  const skyVertex = (row: number, column: number) => {
    const theta = row * Math.PI / 16, phi = column * Math.PI * 2 / 32;
    return { p: [center[0] + radius * Math.sin(theta) * Math.cos(phi), center[1] + radius * Math.cos(theta), center[2] + radius * Math.sin(theta) * Math.sin(phi)],
      // Inset V because repeat wrapping would join the horizon to the zenith.
      uv: [column / 32, .01 + .98 * row / 16] };
  };
  const skyFace = (...vertices: ReturnType<typeof skyVertex>[]) => sky.tris.push({ mat: "sky", v: vertices.flatMap((p) => p.p), uv: vertices.flatMap((p) => p.uv) });
  for (let row = 0; row < 16; row++) for (let col = 0; col < 32; col++) {
    const a = skyVertex(row, col), b = skyVertex(row + 1, col), c = skyVertex(row + 1, col + 1), d = skyVertex(row, col + 1);
    if (row < 15) skyFace(a, b, c);
    if (row > 0) skyFace(a, c, d);
  }
  const map: Model = { materials: { map_white: { color: [1, 1, 1] } }, tris: model.tris.filter((t) => ["road", "startline", "boost"].includes(t.mat)).map((t) => ({ mat: "map_white", v: t.v.map((v, i) => i % 3 === 1 ? 0 : v), uv: t.uv })) };
  if (!map.tris.length) throw new Error("The generated track has no road for its minimap");
  const resources: [string, string, Model][] = [["course", "course_model.brres", model], ["vrcorn", "vrcorn_model.brres", sky], ["map", "map_model.brres", map]];
  const dir = await mkdtemp(join(tmpdir(), "mkwii-generated-models-"));
  try {
    const customImages = join(dir, "custom-images");
    await mkdir(customImages);
    const courseTextures = await resolveGeneratedMaterials(model.materials, options);
    for (const [name, , source] of resources) {
      const { textures } = name === "course" ? courseTextures : await resolveGeneratedMaterials(source.materials);
      const geometry = name === "course" ? { ...source, tris: source.tris.map((tri) => {
        const scale = textures.get(tri.mat)?.uvScale || [1, 1];
        return tri.uv ? { ...tri, uv: tri.uv.map((value, i) => value * scale[i % 2]) } : tri;
      }) } : source;
      // Keep each converter geometry well below Python's recursion limit.
      // This applies to the course, sky and minimap, including dense splines.
      const { obj, mtl } = modelToOBJ(geometry, `${name}.mtl`, { maxTrianglesPerMaterial: 256, normals: name === "course" });
      await writeFile(join(dir, `${name}.obj`), obj);
      await writeFile(join(dir, `${name}.mtl`), mtl.replace(/# map_Kd ([A-Za-z0-9_]+\.png)/g, "map_Kd $1"));
      for (const mat of new Set(source.tris.map((t) => t.mat))) {
        const texture = textures.get(mat);
        if (!texture) throw new Error(`Missing generated material ${mat}`);
        await writeFile(join(dir, `${mat}.png`), texture.png);
        if (name === "course" && source.materials[mat]?.image) await writeFile(join(customImages, `${mat}.png`), texture.png);
      }
    }
    const tree = newSzsTree();
    for (const [name, target, source] of resources) {
      await writeFile(join(dir, "commands.txt"), `convert ${name}.obj to ${target}\n`);
      const child = Bun.spawn([exe, "-f", "commands.txt", "-o"], { cwd: dir, env: process.env, stdout: "pipe", stderr: "pipe", windowsHide: true });
      const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      if (code) throw new Error(`Could not build ${target}: ${(out + "\n" + err).trim().slice(-800)}`);
      let bytes: Uint8Array = new Uint8Array(await readFile(join(dir, target)).catch(() => { throw new Error(`Could not create ${target}: ${(out + "\n" + err).trim().slice(-1800)}`); }));
      if (name === "course" && courseTextures.game) for (const mat of new Set(source.tris.map((t) => t.mat))) {
        const original = courseTextures.textures.get(mat)?.original;
        if (original && ![8, 9, 10].includes(original.texture.format))
          bytes = await transplantBRRESTextures(original.source || courseTextures.game.source, bytes, { [original.name]: mat }, join(dir, `original-${mat}`));
      }
      if (name === "course") for (const [role, texture] of courseTextures.textures) if (texture.original?.native) {
        const names = parseBRRES(bytes).models.flatMap((m: any) => m.materials).map((m: any) => m.name).filter((n: string) => n === role || n.startsWith(`${role}_part`));
        if (names.length) bytes = await applyGeneratedBoost(bytes, texture.original, names, exe, join(dir, `animated-${role}`));
      }
      if (name === "course" && Object.values(source.materials).some((m) => m.image)) bytes = await preserveImportedImageAlpha(bytes, customImages, dir, exe);
      const parsed = parseBRRES(bytes);
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
