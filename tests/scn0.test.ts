import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readSCN0s, setSCN0Values } from "../web/js/formats/scn0.js";
import { listFiles, parseU8 } from "../web/js/formats/u8.js";
import { isYaz0, yaz0Decompress } from "../web/js/formats/yaz0.js";

// With MKWII_GAME_DIR=<game>/files: the game's SCN0 scenes are read, written back unchanged, and a
// changed light, ambient colour and camera read back as written.
const game = process.env.MKWII_GAME_DIR || "";
test.skipIf(!existsSync(join(game, "Race", "Course")))("SCN0 scenes of the game are read and changed in place", () => {
  const read = (p: string) => { const d = new Uint8Array(readFileSync(p)); return parseU8(isYaz0(d) ? yaz0Decompress(d) : d); };
  let scenes = 0;
  for (const name of readdirSync(join(game, "Race", "Course")).filter((f) => /\.szs$/.test(f))) for (const file of listFiles(read(join(game, "Race", "Course", name)))) {
    if (!file.path.endsWith(".brres")) continue;
    const data = file.node.data;
    for (const scene of readSCN0s(data)) {
      scenes++;
      for (const [section, entries] of Object.entries(scene.sections) as any) for (const entry of entries) if (entry.editable) expect(setSCN0Values(data, scene.name, section, entry.name, entry.values)).toEqual(data);
      const light = scene.sections["Lights(NW4R)"]?.[0], camera = scene.sections["Cameras(NW4R)"]?.[0];
      if (light) {
        const changed = setSCN0Values(data, scene.name, "Lights(NW4R)", light.name, { color: [10, 20, 30, 40], start: [1, 2, 3] });
        const back = readSCN0s(changed).find((s: any) => s.name === scene.name).sections["Lights(NW4R)"][0].values;
        expect([back.color, back.start]).toEqual([[10, 20, 30, 40], [1, 2, 3]]);
        expect(changed.length).toBe(data.length);
      }
      if (camera) expect(readSCN0s(setSCN0Values(data, scene.name, "Cameras(NW4R)", camera.name, { fovY: 45 })).find((s: any) => s.name === scene.name).sections["Cameras(NW4R)"][0].values.fovY).toBe(45);
    }
  }
  expect(scenes).toBeGreaterThan(0);
});
