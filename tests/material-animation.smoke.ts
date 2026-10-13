// Requires extracted MKW game files and installed rszst/wzst. Probes actual BRRES output.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { parseU8, findFile } from "../web/js/formats/u8.js";
import { yaz0Decompress } from "../web/js/formats/yaz0.js";
import { parseBRRES } from "../web/js/formats/brres.js";
import { attachMaterialAnimations } from "../src/material-animations.ts";

const game = process.env.MKWII_GAME_DIR;
if (!game) { console.log("MKWII_GAME_DIR not set: skipped"); process.exit(0); }
const dir = mkdtempSync(join(tmpdir(), "mkwii-material-animation-"));
try {
  const tree = parseU8(yaz0Decompress(readFileSync(join(game, "Race/Course/castle_course.szs"))));
  const source = findFile(tree, "course_model.brres")!.data;
  const before = parseBRRES(source);
  const next = await attachMaterialAnimations(source, {
    name: "Probe", frames: 2, materials: [{ name: "ef_sea",
      uv: [{ scaleX: 1, scaleY: 1, rotation: 0, transX: 0, transY: 0 }, { scaleX: 1, scaleY: 1, rotation: 0, transX: 0.5, transY: 0 }, { scaleX: 1, scaleY: 1, rotation: 0, transX: 1, transY: 0 }],
      color: [[1, 0, 0, 1], [0, 1, 0, 1], [0, 0, 1, 1]] }],
  }, dir);
  const after = parseBRRES(next);
  if (!after.srt.has("Probe_SRT") || !after.clr.has("Probe_CLR") || after.models[0].objects.length !== before.models[0].objects.length)
    throw new Error("SRT0/CLR0 output or model preservation failed");
  console.log("ok generated SRT0 and CLR0 in a real course model, preserving geometry");
} finally {
  if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe temporary cleanup path");
  rmSync(dir, { recursive: true, force: true });
}
