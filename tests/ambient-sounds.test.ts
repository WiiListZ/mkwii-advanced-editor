import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AMBIENT_SOUNDS, ambientSoundOf, ambientSoundSamples } from "../web/js/data/ambient-sounds.js";
import { ROUTE_REQUIRED_OBJECTS } from "../web/js/data/route-objects.js";
import { parseBRSAR, readWave } from "../web/js/formats/brsar.js";

test("ambient sound emitters are route-following objects", () => {
  for (const a of AMBIENT_SOUNDS) expect(ROUTE_REQUIRED_OBJECTS.has(a.objectId)).toBe(true);
  expect(ambientSoundOf(0x005)?.label).toBe("River");
  expect(ambientSoundOf(0x065)).toBeNull();
});

// With MKWII_GAME_DIR=<game>/files: each ambient sound finds its bank and samples, which decode.
const brsar = join(process.env.MKWII_GAME_DIR || "", "sound", "revo_kart.brsar");
test.skipIf(!existsSync(brsar))("each ambient sound has its samples in revo_kart.brsar", () => {
  const archive = parseBRSAR(new Uint8Array(readFileSync(existsSync(brsar + ".bak") ? brsar + ".bak" : brsar)));
  for (const a of AMBIENT_SOUNDS) {
    const found = ambientSoundSamples(archive, a)!;
    expect(found.samples.length).toBeGreaterThan(0);
    expect(readWave(archive, found.samples[0]).channels[0].length).toBeGreaterThan(1000);
  }
  // The river and the big river play the same samples, as do the lake and the fountain.
  expect(ambientSoundSamples(archive, ambientSoundOf(0x005))!.sharing.map((s: any) => s.object)).toEqual(["sound_big_river"]);
  expect(ambientSoundSamples(archive, ambientSoundOf(0x008))!.sharing.map((s: any) => s.object)).toEqual(["sound_fountain"]);
});
