import { test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { yaz0Decompress } from "../web/js/formats/yaz0.js";
import { listFiles, parseU8 } from "../web/js/formats/u8.js";
import { decodeBREFTTexture, parseBREFF, parseBREFT, replaceBREFTTexture, setBREFFValue } from "../web/js/formats/effects.js";
import { STAT_FIELDS, isItemSlot, isStatsFile, parseItemSlot, readStat, statEntries, writeItemSlot, writeStat } from "../web/js/formats/params.js";

// Synthetic files with the real layouts: kartParam.bin (count + 0x18C-byte entries) and ItemSlot.bin.
function kartParam(count: number) {
  const data = new Uint8Array(4 + count * 0x18c), v = new DataView(data.buffer);
  v.setUint32(0, count);
  for (let i = 0; i < count; i++) v.setFloat32(4 + i * 0x18c + 0x18, 70 + i);
  return data;
}

test("vehicle stats are read and written in place", () => {
  const data = kartParam(36);
  expect(isStatsFile("kartParam.bin", data)).toBe(true);
  expect(statEntries("kartParam.bin", data)[35]).toBe("Phantom");
  const speed = STAT_FIELDS.find((f: any) => f.label === "Top speed")!;
  expect(readStat(data, 3, speed)).toBe(73);
  const next = writeStat(data, 3, speed, 90.5);
  expect(next.length).toBe(data.length);
  expect(readStat(next, 3, speed)).toBe(90.5);
  expect(readStat(data, 3, speed)).toBe(73);
  expect(STAT_FIELDS.every((f: any) => f.help && f.label)).toBe(true);
  expect(isStatsFile("kartParam.bin", data.subarray(0, data.length - 1))).toBe(false);
});

test("item chances keep the table layout", () => {
  const data = new Uint8Array(1 + 2 + 12 * 19 + 2 + 3 * 19);
  data[0] = 2; data[1] = 12; data[2] = 19; data[3 + 12 * 19] = 3; data[4 + 12 * 19] = 19;
  expect(isItemSlot("ItemSlot.bin", data)).toBe(true);
  const tables = parseItemSlot(data);
  expect(tables.map((t: any) => t.kind)).toEqual(["race", "battle"]);
  const next = writeItemSlot(data, 1, 7, 2, 40);
  expect(parseItemSlot(next)[1].values[7][2]).toBe(40);
  expect(() => writeItemSlot(data, 0, 0, 0, 300)).toThrow();
});

const game = process.env.MKWII_GAME_DIR;
const course = game && join(game, "Race", "Course", "castle_course.szs");
test.skipIf(!course || !existsSync(course))("effects of a real track are read, edited and repainted in place", () => {
  const files = listFiles(parseU8(yaz0Decompress(new Uint8Array(readFileSync(course!)))));
  const breff = files.find((f: any) => /rk_wanwan\.breff$/.test(f.path))!.node.data;
  const breft = files.find((f: any) => /rk_wanwan\.breft$/.test(f.path))!.node.data;
  const effect = parseBREFF(breff), textures = parseBREFT(breft);
  const emitter = effect.emitters[0];
  expect(emitter.textures.every((t: string) => textures.textures.some((x: any) => x.name === t))).toBe(true);
  const edited = setBREFFValue(breff, emitter.name, "particle", "size", [10, 20]);
  expect(edited.length).toBe(breff.length);
  expect(parseBREFF(edited).emitters[0].values.particle.size).toEqual([10, 20]);
  const tex = textures.textures[0];
  const pixels = decodeBREFTTexture(breft, tex)!;
  const repainted = replaceBREFTTexture(breft, tex.name, new Uint8Array(pixels.length).fill(255));
  expect(repainted.length).toBe(breft.length);
  expect(decodeBREFTTexture(repainted, parseBREFT(repainted).textures[0])![0]).toBe(255);
});
