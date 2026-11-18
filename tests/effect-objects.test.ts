import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EFFECT_OBJECTS, effectObjectOf, objectEffectFiles } from "../web/js/data/effect-objects.js";
import { parseU8, listFiles } from "../web/js/formats/u8.js";
import { isYaz0, yaz0Decompress } from "../web/js/formats/yaz0.js";

test("each effect object has its effect files and no model", () => {
  for (const e of EFFECT_OBJECTS) {
    expect(e.files.length).toBe(2);
    expect(e.files.every((p: string) => /^effect\/[^/]+\/[^/]+\.(breff|breft)$/i.test(p))).toBe(true);
    expect(objectEffectFiles(e.objectId)).toEqual(e.files);
  }
  expect(new Set(EFFECT_OBJECTS.map((e) => e.objectId)).size).toBe(EFFECT_OBJECTS.length);
  expect(effectObjectOf(0x2ee)?.label).toBe("Floating embers");
  expect(effectObjectOf(0x65)).toBeNull();
  // Objects with a model can still have effect files (a Chain Chomp's).
  expect(objectEffectFiles(0x0e9)).toEqual(["effect/wanwan/rk_wanwan.breff", "effect/wanwan/rk_wanwan.breft"]);
});

// With MKWII_GAME_DIR=<game>/files: every effect is in at least one of the game's tracks.
const course = join(process.env.MKWII_GAME_DIR || "", "Race", "Course");
test.skipIf(!existsSync(course))("every effect object's files are in one of the game's tracks", () => {
  const left = new Set(EFFECT_OBJECTS.map((e) => e.object));
  for (const f of readdirSync(course).filter((f) => /\.szs$/i.test(f) && !/_d\.szs$/i.test(f))) {
    const d = new Uint8Array(readFileSync(join(course, f)));
    const paths = new Set(listFiles(parseU8(isYaz0(d) ? yaz0Decompress(d) : d)).map((x: any) => x.path.toLowerCase()));
    for (const e of EFFECT_OBJECTS) if (e.files.every((p: string) => paths.has(p.toLowerCase()))) left.delete(e.object);
  }
  expect([...left]).toEqual([]);
});
