// Primitives, materials, emitters and the game's minimap colour, on real files where they exist.
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { prepareBundledTools } from "../src/bundled-tools.ts";
import { importOBJModel } from "../src/model-operations.ts";
import { buildPrimitive, PRIMITIVE_MAX_TRIANGLES, PRIMITIVE_SHAPES, primitiveOBJ, primitiveSpec } from "../web/js/editor/primitives.js";
import { parseBRLYT, findPane } from "../web/js/formats/brlyt.js";
import { parseBRRES } from "../web/js/formats/brres.js";
import { duplicateBREFFEmitter, entryList, parseBREFF, rebuildBREFF, removeBREFFEmitter, setBREFFValue } from "../web/js/formats/effects.js";
import { MAP_LAYOUT, readMapColours, setMapColours } from "../web/js/formats/map-layout.js";
import { readSculptModel, sculptCollision, sculptPositions, writeSculptModel } from "../web/js/editor/model-sculpt.js";
import { setBRRESMaterial } from "../web/js/formats/material-edit.js";
import { findFile, listFiles, parseU8 } from "../web/js/formats/u8.js";
import { yaz0Decompress } from "../web/js/formats/yaz0.js";

const game = process.env.MKWII_GAME_DIR;
const hasGame = !!game && existsSync(join(game, "Race", "Course", "castle_course.szs"));
const openSzs = async (...parts: string[]) => parseU8(yaz0Decompress(new Uint8Array(await readFile(join(game!, ...parts)))));

// Every edge used twice, in opposite directions: a closed surface facing one way.
function closedSurface(tris: number[][]) {
  const edges = new Map<string, number>();
  const key = (tri: number[], c: number) => `${Math.round(tri[c * 3] * 10)}/${Math.round(tri[c * 3 + 1] * 10)}/${Math.round(tri[c * 3 + 2] * 10)}`;
  for (const tri of tris) for (let c = 0; c < 3; c++) {
    const a = key(tri, c), b = key(tri, (c + 1) % 3);
    edges.set(`${a}|${b}`, (edges.get(`${a}|${b}`) || 0) + 1);
  }
  let open = 0;
  for (const [edge, count] of edges) {
    const [a, b] = edge.split("|");
    if ((edges.get(`${b}|${a}`) || 0) !== count) open++;
  }
  return open;
}
const volume = (tris: number[][]) => tris.reduce((sum, t) =>
  sum + (t[0] * (t[4] * t[8] - t[5] * t[7]) - t[1] * (t[3] * t[8] - t[5] * t[6]) + t[2] * (t[3] * t[7] - t[4] * t[6])) / 6, 0);

test("every solid shape is closed and faces outward, in about its expected volume", () => {
  const expected: Record<string, number> = {
    box: 2000 * 1000 * 2000, wedge: 2000 * 1000 * 2000 / 2, prism: 2000 * 1000 * 2000 / 2,
    cylinder: Math.PI * 1000 * 1000 * 1000, cone: Math.PI * 1000 * 1000 * 1000 / 3, sphere: 4 / 3 * Math.PI * 1000 * 500 * 1000,
  };
  for (const [shape, want] of Object.entries(expected)) {
    const tris = buildPrimitive({ shape, sides: 48, slices: 8 });
    expect(`${shape}: ${closedSurface(tris)}`).toBe(`${shape}: 0`);
    expect(Math.abs(volume(tris) - want) / want).toBeLessThan(.05);
  }
  for (const shape of ["torus", "stairs"]) expect(volume(buildPrimitive({ shape, sides: 24 }))).toBeGreaterThan(0);
  expect(closedSurface(buildPrimitive({ shape: "torus", sides: 24 }))).toBe(0);
  // Part of a turn and a hollow tube still close up.
  expect(closedSurface(buildPrimitive({ shape: "cylinder", arc: 180, sides: 24 }))).toBe(0);
  expect(closedSurface(buildPrimitive({ shape: "cylinder", hollow: .5, sides: 24 }))).toBe(0);
  expect(closedSurface(buildPrimitive({ shape: "cylinder", hollow: .5, arc: 120, sides: 24 }))).toBe(0);
  expect(buildPrimitive({ shape: "plane", slices: 3 }).length).toBe(18);
});

test("deformations do what they say, rest on the ground and stay closed", () => {
  const extent = (tris: number[][], axis: number, from = 0, to = 1) => {
    const all = tris.flatMap((t) => [0, 3, 6].map((c) => t.slice(c, c + 3)));
    const high = Math.max(...all.map((p) => p[1]));
    const chosen = all.filter((p) => p[1] / high >= from && p[1] / high <= to).map((p) => p[axis]);
    return Math.max(...chosen) - Math.min(...chosen);
  };
  const box = { shape: "box", slices: 8 };
  expect(extent(buildPrimitive({ ...box, taperX: 2 }), 0, .99, 1)).toBeCloseTo(4000, -1);
  expect(extent(buildPrimitive({ ...box, taperX: 2 }), 0, 0, .01)).toBeCloseTo(2000, -1);
  for (const change of [{ taperX: 2 }, { twist: 180 }, { bend: 90 }, { shearX: 1 }, { bulge: .5 }, { roughness: .2 }]) {
    const tris = buildPrimitive({ ...box, ...change });
    expect(Math.min(...tris.flatMap((t) => [t[1], t[4], t[7]]))).toBeCloseTo(0, 3);
    expect(tris.flat().every(Number.isFinite)).toBe(true);
    expect(`${JSON.stringify(change)}: ${closedSurface(tris)}`).toBe(`${JSON.stringify(change)}: 0`);
  }
  // Twisting a quarter turn keeps a square square at the top, turned.
  const twisted = buildPrimitive({ ...box, twist: 90 });
  expect(extent(twisted, 0, .99, 1)).toBeCloseTo(2000, -1);
  // Bending a tall box leans its top over.
  const tall = buildPrimitive({ ...box, width: 500, depth: 500, height: 4000, bend: 90 });
  expect(Math.max(...tall.flatMap((t) => [t[0], t[3], t[6]]))).toBeGreaterThan(1500);
  // The same roughness twice gives the same shape; another seed does not.
  expect(buildPrimitive({ ...box, roughness: .3, seed: 3 })).toEqual(buildPrimitive({ ...box, roughness: .3, seed: 3 }));
  expect(buildPrimitive({ ...box, roughness: .3, seed: 4 })).not.toEqual(buildPrimitive({ ...box, roughness: .3, seed: 3 }));
});

test("values stay inside their limits and too much detail is refused", () => {
  expect(primitiveSpec({ width: -5, sides: 900, twist: 9999 })).toMatchObject({ width: 10, sides: 64, twist: 720 });
  expect(() => primitiveSpec({ width: NaN })).toThrow();
  expect(() => primitiveSpec({ shape: "teapot" })).toThrow();
  expect(() => buildPrimitive({ shape: "sphere", sides: 64, slices: 48 })).toThrow(`limit is ${PRIMITIVE_MAX_TRIANGLES}`);
  for (const shape of Object.keys(PRIMITIVE_SHAPES)) expect(buildPrimitive({ shape }).length).toBeGreaterThan(0);
});

test.skipIf(process.platform !== "win32" || !hasGame)("a primitive goes into a real track model through the model importer", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mkwii-primitive-"));
  const old = { a: process.env.MKWII_ABMATT, w: process.env.MKWII_WSZST, p: process.env.PATH };
  try {
    await prepareBundledTools(dir);
    const course = findFile(await openSzs("Race", "Course", "castle_course.szs"), "course_model.brres")!.data;
    const tris = buildPrimitive({ shape: "wedge", slices: 2 });
    const path = join(dir, "primitive.obj");
    await writeFile(path, primitiveOBJ(tris, "#ff0000"));
    const next = await importOBJModel(course, path, [1000, 2000, 3000]);
    const before = parseBRRES(course).models[0], after = parseBRRES(next).models[0];
    const added = after.objects.filter((o: any) => !before.objects.some((b: any) => b.name === o.name));
    expect(added.reduce((sum: number, o: any) => sum + o.triangles, 0)).toBe(tris.length);
    // Its colour arrives, and the track's own parts are all still there.
    expect(added.some((o: any) => o.colors && o.colors[0] > .9 && o.colors[1] < .1)).toBe(true);
    expect(after.objects.length).toBeGreaterThan(before.objects.length);
  } finally {
    for (const [key, value] of [["MKWII_ABMATT", old.a], ["MKWII_WSZST", old.w], ["PATH", old.p]] as const) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe test folder");
    await rm(dir, { recursive: true, force: true });
  }
}, 60000);

test.skipIf(!hasGame)("material settings are written where the parser reads them, and nothing else moves", async () => {
  const data = findFile(await openSzs("Race", "Course", "castle_course.szs"), "course_model.brres")!.data;
  const model = parseBRRES(data).models[0];
  const material = model.materials.find((m: any) => m.gx?.blend && m.gx?.zmode)!;
  const after = (patch: any) => {
    const out = setBRRESMaterial(data, model.name, material.name, patch);
    expect(out.length).toBe(data.length);
    return parseBRRES(out).models[0].materials.find((m: any) => m.name === material.name);
  };
  expect(after({ cull: 0 }).cull).toBe(0);
  expect(after({ cull: 2 }).cull).toBe(2);
  expect(after({ translucent: !material.xlu }).xlu).toBe(!material.xlu);
  const blended = after({ blend: { enabled: true, src: 4, dst: 5 } }).gx.blend;
  expect(blended).toMatchObject({ enabled: true, src: 4, dst: 5 });
  expect(after({ blend: { enabled: false } }).gx.blend.enabled).toBe(false);
  const z = after({ depthWrite: false, depthTest: true }).gx.zmode;
  expect(z).toMatchObject({ write: false, test: true });
  const alpha = after({ alpha: { ref: 128, comp: 6 } }).gx.alphaTest;
  expect(alpha.comp0).toBe(6);
  expect(Math.round(alpha.ref0 * 255)).toBe(128);
  const chan = after({ channel: [{ index: 0, rgba: [10, 20, 30, 255] }] }).gx.chans[0].matColor;
  expect(chan.map((v: number) => Math.round(v * 255))).toEqual([10, 20, 30, 255]);
  const reg = after({ color: [{ index: 1, rgba: [40, 50, 60, 70] }] });
  expect(reg.gx.regs[1].map((v: number) => Math.round(v * 255))).toEqual([40, 50, 60, 70]);
  const konst = after({ color: [{ index: 2, rgba: [1, 2, 3, 4], konst: true }] });
  if (konst) expect(konst.gx.konst[2].map((v: number) => Math.round(v * 255))).toEqual([1, 2, 3, 4]);
  // Other materials and the model's geometry stay as they were.
  const out = setBRRESMaterial(data, model.name, material.name, { cull: 0, blend: { enabled: true } });
  const parsed = parseBRRES(out).models[0], other = model.materials.find((m: any) => m.name !== material.name);
  expect(parsed.materials.find((m: any) => m.name === other.name).cull).toBe(other.cull);
  expect(parsed.objects.map((o: any) => o.triangles)).toEqual(model.objects.map((o: any) => o.triangles));
  expect(() => setBRRESMaterial(data, model.name, "no such material", { cull: 0 })).toThrow();
  expect(() => setBRRESMaterial(data, model.name, material.name, { cull: 9 })).toThrow();
});

test.skipIf(!hasGame)("emitters: the file rebuilds exactly, and copies and removals keep every other value", async () => {
  const tree = await openSzs("Race", "Course", "beginner_course.szs");
  const files = listFiles(tree).filter((f: any) => /\.breff$/i.test(f.path));
  expect(files.length).toBeGreaterThan(0);
  for (const { path, node } of files) {
    const data = node.data;
    // Rebuilt from its own list, the file comes out byte for byte: the layout is the real one.
    expect(`${path}: ${Buffer.compare(rebuildBREFF(data, entryList(data)), data)}`).toBe(`${path}: 0`);
    const first = parseBREFF(data).emitters[0];
    const copied = duplicateBREFFEmitter(data, first.name, "added_copy");
    const parsed = parseBREFF(copied);
    expect(parsed.emitters.map((e: any) => e.name)).toContain("added_copy");
    const copy = parsed.emitters.find((e: any) => e.name === "added_copy");
    expect(copy.values).toEqual(first.values);
    expect(copy.textures).toEqual(first.textures);
    // Each keeps its own values afterwards.
    const edited = parseBREFF(setBREFFValue(copied, "added_copy", "emitter", Object.keys(first.values.emitter)[0], first.values.emitter[Object.keys(first.values.emitter)[0]]));
    expect(edited.emitters.length).toBe(parsed.emitters.length);
    if (parseBREFF(data).emitters.length > 1) {
      const removed = parseBREFF(removeBREFFEmitter(data, first.name));
      expect(removed.emitters.map((e: any) => e.name)).toEqual(parseBREFF(data).emitters.slice(1).map((e: any) => e.name));
      expect(removed.emitters[0].values).toEqual(parseBREFF(data).emitters[1].values);
    }
    expect(parseBREFF(removeBREFFEmitter(copied, "added_copy")).emitters.length).toBe(parseBREFF(data).emitters.length);
  }
});

test("the sculpting brush moves heights near it, fading out, and flattens and smooths", () => {
  // A row of vertices 100 apart along x, at height 0, and one higher.
  const grid = (height = (_: number) => 0) => Float32Array.from(Array.from({ length: 21 }, (_, i) => [i * 100, height(i), 0]).flat());
  const raised = grid();
  const moved = sculptPositions(raised, [1000, 0, 0], { mode: "raise", radius: 500, strength: 100 });
  expect(moved).toBe(9);
  expect(raised[10 * 3 + 1]).toBeCloseTo(100);
  expect(raised[8 * 3 + 1]).toBeGreaterThan(0);
  expect(raised[8 * 3 + 1]).toBeLessThan(100);
  expect(raised[0 * 3 + 1]).toBe(0);
  // Only heights change.
  for (let i = 0; i < 21; i++) { expect(raised[i * 3]).toBe(i * 100); expect(raised[i * 3 + 2]).toBe(0); }
  const lowered = grid();
  sculptPositions(lowered, [1000, 0, 0], { mode: "lower", radius: 500, strength: 100 });
  expect(lowered[10 * 3 + 1]).toBeCloseTo(-100);
  const bumpy = grid((i) => i % 2 ? 100 : -100);
  const spread = (values: Float32Array) => Math.max(...[...values].filter((_, i) => i % 3 === 1).slice(8, 13)) - Math.min(...[...values].filter((_, i) => i % 3 === 1).slice(8, 13));
  const before = spread(bumpy);
  for (let i = 0; i < 20; i++) sculptPositions(bumpy, [1000, 0, 0], { mode: "smooth", radius: 800, strength: 100 });
  expect(spread(bumpy)).toBeLessThan(before / 2);
  const hill = grid((i) => i * 10);
  for (let i = 0; i < 30; i++) sculptPositions(hill, [1000, 40, 0], { mode: "flatten", radius: 400, strength: 200 });
  expect(hill[10 * 3 + 1]).toBeCloseTo(40, 0);
  expect(sculptPositions(grid(), [99999, 0, 0], { radius: 100 })).toBe(0);
});

test("collision follows a stroke only on the surface at the brush's height", () => {
  // Same place twice: a road at 0 and a bridge far above.
  const verts = Float32Array.from([0, 0, 0, 100, 5000, 0]);
  const moved = sculptCollision(verts, [0, 0, 0], { mode: "raise", radius: 500, strength: 50 });
  expect(moved).toBe(2 - 1);
  expect(verts[1]).toBeCloseTo(50);
  expect(verts[4]).toBe(5000);
});

test.skipIf(!hasGame)("sculpted heights reach the file of a real track, with nothing else changed", async () => {
  const data = findFile(await openSzs("Race", "Course", "castle_course.szs"), "course_model.brres")!.data;
  const sculpt = readSculptModel(data);
  expect(sculpt.arrays.size).toBeGreaterThan(0);
  const first: any = [...sculpt.arrays.values()].sort((a: any, b: any) => b.count - a.count)[0];
  const center = [first.positions[0], first.positions[1], first.positions[2]];
  const original = first.positions.slice();
  const moved = sculptPositions(first.positions, center, { mode: "raise", radius: 2000, strength: 128 });
  expect(moved).toBeGreaterThan(0);
  const out = writeSculptModel(data, sculpt);
  expect(out.length).toBe(data.length);
  const model = parseBRRES(out).models.find((m: any) => m.name === sculpt.model), array = model.arrays.pos.get(first.id);
  // At the centre, the whole strength; away from the brush, exactly as before.
  expect(Math.abs(array.data[1] - original[1] - 128)).toBeLessThan(1);
  let far = 0;
  for (let i = 0; i < array.count; i++) {
    const distance = Math.hypot(original[i * 3] - center[0], original[i * 3 + 2] - center[2]);
    if (distance > 2100) { expect(Math.abs(array.data[i * 3 + 1] - original[i * 3 + 1])).toBeLessThan(.5); far++; }
    expect(array.data[i * 3]).toBeCloseTo(original[i * 3], 0);
  }
  expect(far).toBeGreaterThan(0);
  // Triangles, materials and every other part still read the same.
  const before = parseBRRES(data).models.find((m: any) => m.name === sculpt.model);
  expect(model.objects.map((o: any) => o.triangles)).toEqual(before.objects.map((o: any) => o.triangles));
  expect(model.materials.map((m: any) => m.name)).toEqual(before.materials.map((m: any) => m.name));
  // The bounds grew with it.
  expect(model.max[1]).toBeGreaterThanOrEqual(before.max[1]);
  // Beyond what its format holds is refused, not wrapped around.
  const tooFar = readSculptModel(data), big: any = [...tooFar.arrays.values()].find((a: any) => parseBRRES(data).models[0].arrays.pos.get(a.id).fmt !== 4);
  if (big) { big.positions[1] = 1e9; expect(() => writeSculptModel(data, tooFar)).toThrow(); }
});

test.skipIf(!hasGame)("the game's minimap colour is read and written in the race layout's picture", async () => {
  const node = findFile(await openSzs("Scene", "UI", "Race.szs"), MAP_LAYOUT)!;
  expect(readMapColours(node.data)).toEqual(Array(4).fill([255, 255, 255, 255]));
  const colours = [[255, 0, 0, 255], [255, 0, 0, 255], [0, 0, 255, 255], [0, 0, 255, 255]];
  const out = setMapColours(node.data, colours);
  expect(out.length).toBe(node.data.length);
  expect(readMapColours(out)).toEqual(colours);
  const pane = findPane(parseBRLYT(out), "race_null");
  expect(pane.colors).toEqual(colours);
  // Its neighbour on the screen keeps its own.
  expect(findPane(parseBRLYT(out), "coin").colors).toEqual(findPane(parseBRLYT(node.data), "coin").colors);
  expect(() => setMapColours(node.data, [[1, 2, 3, 4]])).toThrow();
});
