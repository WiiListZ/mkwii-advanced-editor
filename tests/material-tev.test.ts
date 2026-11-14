import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildGeneratedTrackModels } from "../src/generated-track-models.ts";
import { parseBRRES } from "../web/js/formats/brres.js";
import { setBRRESTevStages } from "../web/js/formats/material-edit.js";
import { findFile, listFiles, parseU8 } from "../web/js/formats/u8.js";
import { isYaz0, yaz0Decompress } from "../web/js/formats/yaz0.js";

test("TEV stages are changed, added and removed in place", async () => {
  const base = findFile(parseU8(await buildGeneratedTrackModels({ materials: { road: { color: [1, 0, 0] } }, tris: [
    { mat: "road", v: [0, 0, 0, 1000, 0, 0, 0, 0, 1000], uv: [0, 0, 1, 0, 0, 1] }] })), "course_model.brres")!.data;
  const model = parseBRRES(base).models[0], material = model.materials[0], stages = structuredClone(material.gx.stages);
  // Same stages: the same bytes.
  expect(setBRRESTevStages(base, model.name, material.name, stages)).toEqual(base);
  const added = [...stages, { ...structuredClone(stages.at(-1)), texEnabled: false, kcsel: 12, color: { a: 15, b: 14, c: 8, d: 0, bias: 0, sub: 0, clamp: 1, scale: 1, dest: 0 }, alpha: { ...stages.at(-1).alpha, a: 7, b: 6, c: 4, d: 0 } }];
  const two = setBRRESTevStages(base, model.name, material.name, added);
  expect(two.length).toBe(base.length);
  const read = parseBRRES(two).models[0].materials[0].gx;
  expect(read.stages.length).toBe(stages.length + 1);
  const last = read.stages.at(-1);
  expect([last.color.a, last.color.b, last.color.c, last.color.scale, last.kcsel, last.alpha.b, last.texEnabled]).toEqual([15, 14, 8, 1, 12, 6, false]);
  expect(read.stages[0]).toEqual(stages[0]);
  // Removing it gives the original file back.
  expect(setBRRESTevStages(two, model.name, material.name, stages)).toEqual(base);
  expect(() => setBRRESTevStages(base, model.name, material.name, [])).toThrow("1 to 16");
});

// With MKWII_GAME_DIR=<game>/files: every material of the game, written again with its own stages,
// is byte for byte the same.
const game = process.env.MKWII_GAME_DIR || "";
test.skipIf(!existsSync(join(game, "Race", "Common.szs")))("every TEV shader of the game is written back unchanged", () => {
  const read = (p: string) => { const d = new Uint8Array(readFileSync(p)); return parseU8(isYaz0(d) ? yaz0Decompress(d) : d); };
  const archives = readdirSync(join(game, "Race", "Course")).filter((f) => /\.szs$/.test(f)).map((f) => join(game, "Race", "Course", f));
  let checked = 0;
  for (const archive of [...archives, join(game, "Race", "Common.szs")]) for (const file of listFiles(read(archive))) {
    if (!file.path.endsWith(".brres")) continue;
    const data = file.node.data;
    for (const model of parseBRRES(data).models) for (const material of model.materials) {
      if (!material.gx) continue;
      expect(setBRRESTevStages(data, model.name, material.name, material.gx.stages)).toEqual(data);
      checked++;
    }
  }
  expect(checked).toBeGreaterThan(2000);
}, 600000);
