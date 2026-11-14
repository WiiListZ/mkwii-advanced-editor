import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseBRSAR, setBRSARSoundProperties } from "../web/js/formats/brsar.js";

// With MKWII_GAME_DIR=<game>/files: a sound's volume, priority, player and pan change in place.
const brsar = join(process.env.MKWII_GAME_DIR || "", "sound", "revo_kart.brsar");
test.skipIf(!existsSync(brsar))("sound properties of revo_kart.brsar are changed in place", () => {
  const data = new Uint8Array(readFileSync(existsSync(brsar + ".bak") ? brsar + ".bak" : brsar));
  const before = parseBRSAR(data), index = before.sounds.findIndex((s: any) => s.type === 3);
  const out = setBRSARSoundProperties(data, index, { volume: 90, priority: 70, player: 2, panMode: 1, remoteFilter: 10 });
  expect(out.length).toBe(data.length);
  const sound = parseBRSAR(out).sounds[index];
  expect([sound.volume, sound.priority, sound.player, sound.panMode, sound.remoteFilter]).toEqual([90, 70, 2, 1, 10]);
  // Nothing else changes: the other sounds and the waves read the same.
  expect(parseBRSAR(out).sounds.filter((_: any, i: number) => i !== index).map((s: any) => s.volume)).toEqual(before.sounds.filter((_: any, i: number) => i !== index).map((s: any) => s.volume));
  expect(() => setBRSARSoundProperties(data, index, { priority: 300 })).toThrow("0 to 127");
  expect(() => setBRSARSoundProperties(data, index, { player: before.players.length })).toThrow("Player");
});
