import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { generateTrack, PRESETS } from "../web/js/editor/trackgen.js";
import { buildGeneratedTrackModels } from "../src/generated-track-models.ts";
import { generatedGameTextures } from "../src/generated-game-textures.ts";
import { prepareBundledTools } from "../src/bundled-tools.ts";
import { parseU8, findFile } from "../web/js/formats/u8.js";
import { parseBRRES, decodeTexture } from "../web/js/formats/brres.js";
import { GameAssets } from "../web/js/editor/assets.js";
import { applySRTFrame } from "../web/js/editor/brresmodel.js";

test("manual boost locations replace automatic placement and keep their collision aligned", () => {
  const points = PRESETS.Oval(), empty = generateTrack(points, { boostPositions: [], boostPads: 6 });
  expect(empty.boosts).toHaveLength(0); expect([...empty.flags].filter((f) => f === 6)).toHaveLength(0);
  const out = generateTrack(points, { boostPositions: [.13, .67], boostPads: 0, boostLength: 1200 });
  expect(out.boosts).toHaveLength(2);
  expect(out.boosts[0].t).toBeCloseTo(.13, 2); expect(out.boosts[1].t).toBeCloseTo(.67, 2);
  const panels = out.model.tris.filter((t: any) => t.mat === "boost");
  expect(panels).toHaveLength(12);
  const collision = [...out.flags].flatMap((flag, i) => flag === 6 ? [Array.from(out.verts.slice(i * 9, i * 9 + 9))] : []);
  expect(collision).toHaveLength(panels.length);
  for (let i = 0; i < panels.length; i++) expect(collision[i]).toEqual(Array.from(Float32Array.from(panels[i].v)));
  expect(out.model.tris.some((t: any) => t.mat === "startline")).toBe(true);
});

const game = process.env.MKWII_GAME_DIR;
test.skipIf(process.platform !== "win32" || !game)("original boost shader, textures and animation survive generation and animate every material chunk", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mkwii-boost-test-"));
  const env = { ...process.env };
  try {
    await prepareBundledTools(dir);
    const original = (await generatedGameTextures({ workspace: game }))!.surfaces.get("boost");
    expect(original?.native).toBeDefined();
    const out = generateTrack(PRESETS.Oval(), { step: 100, boostPositions: Array.from({ length: 12 }, (_, i) => .05 + i * .075), boostLength: 2000 });
    const tree = parseU8(await buildGeneratedTrackModels(out.model, { workspace: game })), parsed = parseBRRES(findFile(tree, "course_model.brres")!.data);
    const materials = parsed.models[0].materials.filter((m: any) => /^boost(?:_part\d+)?$/.test(m.name));
    expect(materials.length).toBeGreaterThan(1);
    for (const mat of materials) {
      expect(mat.layers.map((l: any) => l.texture)).toEqual(original.native.material.layers.map((l: any) => l.texture));
      expect(mat.gx.stages).toEqual(original.native.material.gx.stages);
      const animation = [...parsed.srt.values()].find((s: any) => s.materials.has(mat.name));
      expect(animation?.loop).toBe(true); expect(animation?.frames).toBe(original.native.animations[0].frames);
    }
    const donor = parseBRRES(original.source);
    for (const name of Object.keys(original.native.textures)) expect(decodeTexture(parsed.textures.get(name))).toEqual(decodeTexture(donor.textures.get(name)));
    const viewport = { setCourseModel() {}, setSkyModel() {}, setSRTBindings() {}, clearCache() {} }, assets = new GameAssets(viewport);
    await assets.setTrack(tree);
    const bindings = assets.built.course.srts;
    expect(bindings.reduce((n: number, b: any) => n + b.targets.length, 0)).toBe(materials.length * 3);
    for (const binding of bindings) {
      const before = binding.targets.map((t: any) => [...t.mtx.elements]); applySRTFrame(binding, 17);
      expect(binding.targets.some((t: any, i: number) => t.mtx.elements.some((v: number, j: number) => Math.abs(v - before[i][j]) > .001))).toBe(true);
    }
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]; Object.assign(process.env, env);
    if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw Error("Unsafe boost test directory");
    await rm(dir, { recursive: true, force: true });
  }
}, 30000);
