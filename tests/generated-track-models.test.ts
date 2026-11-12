import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { buildGeneratedTrackModels } from "../src/generated-track-models.ts";
import { prepareBundledTools } from "../src/bundled-tools.ts";
import { generateTrack, PRESETS, DEFAULT_PARAMS } from "../web/js/editor/trackgen.js";
import { decodeTexture, parseBRRES } from "../web/js/formats/brres.js";
import { findFile, parseU8 } from "../web/js/formats/u8.js";
import { rgbaPNG } from "../src/generated-textures.ts";
import { generatedTexturePreviews } from "../src/generated-materials.ts";

test.skipIf(process.platform !== "win32")("long connected roads convert without overflowing ABMatt's triangle-strip recursion", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mkwii-generated-long-road-"));
  const oldAbmatt = process.env.MKWII_ABMATT, oldWiimm = process.env.MKWII_WSZST, oldPath = process.env.PATH;
  try {
    await prepareBundledTools(dir);
    const tris = [];
    for (let i = 0; i < 700; i++) {
      const x = i * 100, next = x + 100;
      tris.push({ mat: "road", v: [x, 0, -1000, x, 0, 1000, next, 0, 1000], uv: [0, i, 1, i, 1, i + 1] },
        { mat: "road", v: [x, 0, -1000, next, 0, 1000, next, 0, -1000], uv: [0, i, 1, i + 1, 0, i + 1] });
    }
    const source = { materials: { road: { color: [.4, .5, .6] } }, tris };
    const before = JSON.stringify(source);
    const faceKey = (vertices: number[][]) => vertices.map((_, i) => [...vertices.slice(i), ...vertices.slice(0, i)].flat().join(",")).sort()[0];
    const expected = tris.map((tri) => faceKey([0, 1, 2].map((i) => [...tri.v.slice(i * 3, i * 3 + 3), tri.uv[i * 2], 1 - tri.uv[i * 2 + 1]]))).sort();
    const tree = parseU8(await buildGeneratedTrackModels(source));
    for (const resource of ["course_model.brres", "map_model.brres"]) {
      const parsed = parseBRRES(findFile(tree, resource)!.data), model = parsed.models[0];
      expect(model.objects.reduce((n: number, object: any) => n + object.triangles, 0)).toBe(tris.length);
      const positions = model.objects.flatMap((object: any) => Array.from(object.positions) as number[]);
      expect(Math.max(...positions.filter((_: number, i: number) => i % 3 === 0))).toBe(70000);
      expect([...parsed.textures.keys()]).toEqual([resource.startsWith("course") ? "road" : "map_white"]);
      const actual: string[] = [];
      for (const object of model.objects) for (let t = 0; t < object.triangles; t++) {
        actual.push(faceKey([0, 1, 2].map((i) => [...object.positions.slice(t * 9 + i * 3, t * 9 + i * 3 + 3), ...object.uvs[0].slice(t * 6 + i * 2, t * 6 + i * 2 + 2)])));
      }
      expect(actual.sort()).toEqual(expected);
      expect(model.materials.every((m: any) => m.layers[0].texture === [...parsed.textures.keys()][0])).toBe(true);
    }
    expect(JSON.stringify(source)).toBe(before);
  } finally {
    if (oldAbmatt === undefined) delete process.env.MKWII_ABMATT; else process.env.MKWII_ABMATT = oldAbmatt;
    if (oldWiimm === undefined) delete process.env.MKWII_WSZST; else process.env.MKWII_WSZST = oldWiimm;
    process.env.PATH = oldPath;
    if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe long-road test directory");
    await rm(dir, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== "win32")("generated courses have persistent visual geometry, an inward sky and correctly bounded minimap", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mkwii-generated-model-test-"));
  const oldAbmatt = process.env.MKWII_ABMATT, oldWiimm = process.env.MKWII_WSZST, oldPath = process.env.PATH;
  try {
    await prepareBundledTools(dir);
    const out = generateTrack(PRESETS.Oval(), DEFAULT_PARAMS);
    const tree = parseU8(await buildGeneratedTrackModels(out.model));
    const course = parseBRRES(findFile(tree, "course_model.brres")!.data);
    const sky = parseBRRES(findFile(tree, "vrcorn_model.brres")!.data);
    const map = parseBRRES(findFile(tree, "map_model.brres")!.data);
    expect(course.models[0].name).toBe("course"); expect(course.textures.size).toBeGreaterThanOrEqual(8);
    for (const name of ["road", "offroad", "curb", "wall", "foundation", "terrain"]) {
      const texture = course.textures.get(name)!;
      expect(texture.width).toBe(256);
      const pixels = decodeTexture(texture);
      expect(new Set(pixels.filter((_: number, i: number) => i % 4 === 0)).size).toBeGreaterThan(10);
    }
    const points = course.models[0].objects.flatMap((o: any) => Array.from(o.positions));
    const source = out.model.tris[0].v;
    expect(points.some((_, i) => i % 3 === 0 && Math.hypot(points[i] - source[0], points[i + 1] - source[1], points[i + 2] - source[2]) < 2)).toBe(true);
    expect(sky.models[0].name).toBe("vrcorn");
    const p = sky.models[0].objects[0].positions, a: number[] = Array.from(p.slice(0, 3)), b: number[] = Array.from(p.slice(3, 6)), c: number[] = Array.from(p.slice(6, 9));
    const u = b.map((v, i) => v - a[i]), v = c.map((v, i) => v - a[i]);
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    expect(n.reduce((sum, value, i) => sum + value * (a[i] + b[i] + c[i]) / 3, 0)).toBeLessThan(0);
    const model = map.models[0], ld = model.bones.find((b: any) => b.name === "posLD"), ru = model.bones.find((b: any) => b.name === "posRU");
    const roads = out.model.tris.filter((t: any) => ["road", "boost", "startline"].includes(t.mat));
    for (const t of roads) for (let i = 0; i < 9; i += 3) {
      expect(t.v[i]).toBeGreaterThan(ld.trans[0]); expect(t.v[i]).toBeLessThan(ru.trans[0]);
      expect(t.v[i + 2]).toBeGreaterThan(ru.trans[2]); expect(t.v[i + 2]).toBeLessThan(ld.trans[2]);
    }
    expect(model.objects.every((o: any) => Array.from(o.positions).every((v, i) => i % 3 !== 1 || v === 0))).toBe(true);
  } finally {
    if (oldAbmatt === undefined) delete process.env.MKWII_ABMATT; else process.env.MKWII_ABMATT = oldAbmatt;
    if (oldWiimm === undefined) delete process.env.MKWII_WSZST; else process.env.MKWII_WSZST = oldWiimm;
    process.env.PATH = oldPath;
    if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe generated model test path");
    await rm(dir, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== "win32")("generated tracks reuse only the configured game's textures and retain them after saving", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mkwii-generated-game-textures-"));
  const oldAbmatt = process.env.MKWII_ABMATT, oldWiimm = process.env.MKWII_WSZST, oldPath = process.env.PATH;
  try {
    await prepareBundledTools(dir);
    const tri = { v: [0, 0, 0, 1000, 0, 0, 0, 0, 1000], uv: [0, 0, 1, 0, 0, 1] };
    const original = await buildGeneratedTrackModels({ materials: { road: { color: [1, 1, 1] }, mainROAD_all_mip: { color: [1, 0, 0] }, t_kusa_070712c: { color: [0, 1, 0] } },
      tris: ["road", "mainROAD_all_mip", "t_kusa_070712c"].map((mat) => ({ ...tri, mat })) });
    const courses = join(dir, "files", "Race", "Course"); await mkdir(courses, { recursive: true });
    const template = join(courses, "beginner_course.szs"); await writeFile(template, original);
    const out = generateTrack(PRESETS.Hilly(), DEFAULT_PARAMS);
    const generated = parseU8(await buildGeneratedTrackModels(out.model, { workspace: join(dir, "files") }));
    const parsed = parseBRRES(findFile(generated, "course_model.brres")!.data);
    const previews = await generatedTexturePreviews(out.model.materials, { workspace: join(dir, "files") });
    expect(previews.road.source).toBe("game");
    expect(previews.road.image).toBe(`data:image/png;base64,${rgbaPNG(8, 8, decodeTexture(parsed.textures.get("road"))).toString("base64")}`);
    expect([...decodeTexture(parsed.textures.get("road")).slice(0, 4)]).toEqual([255, 0, 0, 255]);
    expect([...decodeTexture(parsed.textures.get("offroad")).slice(0, 4)]).toEqual([0, 255, 0, 255]);
    expect([...decodeTexture(parsed.textures.get("terrain")).slice(0, 4)]).toEqual([0, 255, 0, 255]);
    expect(parsed.models[0].objects.some((o: any) => o.name === "support")).toBe(true);
    expect(new Uint8Array(await readFile(template))).toEqual(original);
    const saved = join(dir, "saved-course.brres"); await writeFile(saved, findFile(generated, "course_model.brres")!.data);
    const reopened = parseBRRES(new Uint8Array(await readFile(saved)));
    expect(decodeTexture(reopened.textures.get("road"))).toEqual(decodeTexture(parsed.textures.get("road")));
    // An explicit texture must win over both the style and a configured game.
    const pixels = new Uint8Array(16 * 16 * 4);
    for (let i = 0; i < pixels.length; i += 4) pixels.set([40, 80, 240, 128], i);
    const image = `data:image/png;base64,${rgbaPNG(16, 16, pixels).toString("base64")}`;
    const custom = generateTrack(PRESETS.Oval(), { style: "desert", textures: { road: { image, repeat: 2 } } });
    const customTree = parseU8(await buildGeneratedTrackModels(custom.model, { workspace: join(dir, "files") }));
    const customModel = parseBRRES(findFile(customTree, "course_model.brres")!.data);
    const customPreviews = await generatedTexturePreviews(custom.model.materials, { workspace: join(dir, "files") });
    expect(customPreviews.road).toMatchObject({ source: "custom", image, uvScale: [2, 2], width: 16, height: 16 });
    expect(customPreviews.offroad.source).toBe("editor");
    expect([...decodeTexture(customModel.textures.get("road")).slice(0, 4)]).toEqual([40, 80, 240, 128]);
    expect(customModel.textures.size).toBeGreaterThanOrEqual(8);
    expect(decodeTexture(customModel.textures.get("offroad"))).not.toEqual(decodeTexture(parsed.textures.get("offroad")));
  } finally {
    if (oldAbmatt === undefined) delete process.env.MKWII_ABMATT; else process.env.MKWII_ABMATT = oldAbmatt;
    if (oldWiimm === undefined) delete process.env.MKWII_WSZST; else process.env.MKWII_WSZST = oldWiimm;
    process.env.PATH = oldPath;
    if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe generated texture test directory");
    await rm(dir, { recursive: true, force: true });
  }
}, 20000);
