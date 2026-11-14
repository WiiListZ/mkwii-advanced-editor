import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { prepareBundledTools } from "../src/bundled-tools.ts";
import { changeBRRESResources } from "../src/brres-resources.ts";
import { buildGeneratedTrackModels } from "../src/generated-track-models.ts";
import { evalTrack, parseBRRES } from "../web/js/formats/brres.js";
import { readVIS0, writeCHR0, writeCLR0, writeSRT0, writeVIS0 } from "../web/js/formats/anim-write.js";
import { writePAT0 } from "../web/js/formats/pat0.js";
import { findFile, listFiles, parseU8 } from "../web/js/formats/u8.js";
import { isYaz0, yaz0Decompress } from "../web/js/formats/yaz0.js";

const near = (a: number, b: number) => Math.abs(a - b) <= 1e-3 * Math.max(1, Math.abs(a));
const sameTrack = (a: any, b: any, frames: number) => { for (let f = 0; f <= frames; f++) if (!near(evalTrack(a, f), evalTrack(b, f))) return false; return true; };

test("VIS0 visibility survives writing and reading, constant and per frame", () => {
  const anim = { name: "Blink", frames: 40, loop: true, bones: new Map([["lamp", Array.from({ length: 41 }, (_, f) => f % 3 === 0)], ["always", Array(41).fill(true)], ["never", Array(41).fill(false)]]) };
  const back = readVIS0(writeVIS0(anim));
  expect([back.name, back.frames, back.loop]).toEqual(["Blink", 40, true]);
  for (const [name, shown] of anim.bones) expect(back.bones.get(name)).toEqual(shown);
});

async function withTools(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "mkwii-anim-test-"));
  const old = { a: process.env.MKWII_ABMATT, w: process.env.MKWII_WSZST, p: process.env.PATH };
  try { await prepareBundledTools(dir); await run(dir); }
  finally {
    for (const [key, value] of [["MKWII_ABMATT", old.a], ["MKWII_WSZST", old.w], ["PATH", old.p]] as const) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    if (resolve(dir).startsWith(resolve(tmpdir()) + sep)) await rm(dir, { recursive: true, force: true });
  }
}

test.skipIf(process.platform !== "win32")("edited CHR0, SRT0, CLR0 and VIS0 go into a BRRES and read back the same", async () => {
  await withTools(async () => {
    const base = findFile(parseU8(await buildGeneratedTrackModels({ materials: { road: { color: [1, 0, 0] } }, tris: [
      { mat: "road", v: [0, 0, 0, 1000, 0, 0, 0, 0, 1000], uv: [0, 0, 1, 0, 0, 1] }] })), "course_model.brres")!.data;
    const keys = [{ f: 0, v: 0, t: 0 }, { f: 10, v: 5, t: 0.5 }, { f: 10, v: 8, t: 0 }, { f: 30, v: -2, t: 0 }];
    const chr = { name: "Spin", frames: 30, loop: true, scalingRule: 0, bones: new Map([["course", { code: 1, scale: null, rot: [{ const: 0 }, { keys }, { const: 0 }], trans: [{ keys }, { keys }, { keys }] }]]) };
    const srt = { name: "Flow", frames: 30, loop: true, texMtxMode: 0, materials: new Map([["road", [{ index: 0, scale: null, rot: null, trans: [{ keys }, { const: 0.25 }] }]]]) };
    const colors = Array.from({ length: 31 }, (_, f) => [f / 30, 0, 1 - f / 30, 1]);
    const clr = { name: "Glow", frames: 30, loop: false, materials: new Map([["road", [{ target: 4, mask: 0, colors }]]]) };
    const vis = { name: "Hide", frames: 30, loop: true, bones: new Map([["course", Array.from({ length: 31 }, (_, f) => f < 15)]]) };
    const after = parseBRRES(await changeBRRESResources(base, [
      { folder: "AnmChr(NW4R)", name: "Spin", data: writeCHR0(chr) }, { folder: "AnmTexSrt(NW4R)", name: "Flow", data: writeSRT0(srt) },
      { folder: "AnmClr(NW4R)", name: "Glow", data: writeCLR0(clr) }, { folder: "AnmVis(NW4R)", name: "Hide", data: writeVIS0(vis) },
    ]));
    const spin = after.chr.get("Spin")!.bones.get("course");
    expect(sameTrack(spin.rot[1], { keys }, 30) && sameTrack(spin.trans[0], { keys }, 30)).toBe(true);
    expect(spin.scale).toBeNull();
    const flow = after.srt.get("Flow")!.materials.get("road")[0];
    expect(sameTrack(flow.trans[0], { keys }, 30) && flow.trans[1].const === 0.25).toBe(true);
    expect(after.clr.get("Glow")!.materials.get("road")[0].colors[15].map((c: number) => Math.round(c * 255))).toEqual([128, 0, 128, 255]);
    expect(after.vis.get("Hide")!.bones.get("course")).toEqual(vis.bones.get("course"));
    // Removing a resource takes it out, and the last one of a folder takes the folder.
    const removed = parseBRRES(await changeBRRESResources(await changeBRRESResources(base, [{ folder: "AnmVis(NW4R)", name: "Hide", data: writeVIS0(vis) }]), [{ folder: "AnmVis(NW4R)", name: "Hide", data: null }]));
    expect(removed.vis.size).toBe(0);
  });
}, 120000);

// With MKWII_GAME_DIR=<game>/files: every animation of the game's tracks and Common.szs is written
// again and put back, and plays the same at every frame.
const game = process.env.MKWII_GAME_DIR || "";
test.skipIf(!existsSync(join(game, "Race", "Common.szs")))("every animation of the game is written back unchanged", async () => {
  await withTools(async () => {
    const read = (p: string) => { const d = new Uint8Array(readFileSync(p)); return parseU8(isYaz0(d) ? yaz0Decompress(d) : d); };
    const folders: any = { chr: "AnmChr(NW4R)", srt: "AnmTexSrt(NW4R)", clr: "AnmClr(NW4R)", pat: "AnmTexPat(NW4R)", vis: "AnmVis(NW4R)" };
    const writers: any = { chr: writeCHR0, srt: writeSRT0, clr: writeCLR0, pat: writePAT0, vis: writeVIS0 };
    const archives = readdirSync(join(game, "Race", "Course")).filter((f) => /\.szs$/.test(f)).map((f) => join(game, "Race", "Course", f));
    let checked = 0;
    for (const archive of [...archives, join(game, "Race", "Common.szs")]) for (const file of listFiles(read(archive))) {
      if (!file.path.endsWith(".brres")) continue;
      const before = parseBRRES(file.node.data), changes: any[] = [];
      for (const kind of Object.keys(folders)) for (const [name, anim] of before[kind]) changes.push({ folder: folders[kind], name, data: writers[kind](anim), kind, anim });
      if (!changes.length) continue;
      const after = parseBRRES(await changeBRRESResources(file.node.data, changes));
      for (const { kind, name, anim } of changes) {
        const back = after[kind].get(name);
        expect([back.frames, back.loop]).toEqual([anim.frames, anim.loop]);
        if (kind === "chr") for (const [bone, b] of anim.bones) for (const c of ["scale", "rot", "trans"]) for (let i = 0; i < 3; i++) if (b[c]) expect(sameTrack(b[c][i], back.bones.get(bone)[c][i], anim.frames)).toBe(true);
        if (kind === "pat") expect(JSON.stringify([...back.materials])).toBe(JSON.stringify([...anim.materials]));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(600);
  });
}, 600000);
