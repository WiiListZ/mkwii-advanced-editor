import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { buildGeneratedTrackModels } from "../src/generated-track-models.ts";
import { prepareBundledTools } from "../src/bundled-tools.ts";
import { generateTrack, PRESETS, DEFAULT_PARAMS } from "../web/js/editor/trackgen.js";
import { parseBRRES } from "../web/js/formats/brres.js";
import { findFile, parseU8 } from "../web/js/formats/u8.js";

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
    expect(course.models[0].name).toBe("course"); expect(course.textures.size).toBe(5);
    const points = course.models[0].objects.flatMap((o: any) => Array.from(o.positions));
    const source = out.model.tris[0].v;
    expect(points.some((_, i) => i % 3 === 0 && Math.hypot(points[i] - source[0], points[i + 1] - source[1], points[i + 2] - source[2]) < 2)).toBe(true);
    expect(sky.models[0].name).toBe("vrcorn");
    const p = sky.models[0].objects[0].positions, a = Array.from(p.slice(0, 3)), b = Array.from(p.slice(3, 6)), c = Array.from(p.slice(6, 9));
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
