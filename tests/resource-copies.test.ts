import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findFile, parseU8 } from "../web/js/formats/u8.js";
import { yaz0Decompress } from "../web/js/formats/yaz0.js";
import { decodeTexture, parseBRRES, replaceBRRESTexture } from "../web/js/formats/brres.js";
import { changedTextures, copyCandidates, updateCopy } from "../web/js/editor/resource-copies.js";

test("copies of a character are its other vehicles and split-screen versions; a track's is its _d twin", () => {
  const kart = ["la_bike-bk.szs", "la_bike-bk_2.szs", "la_kart-bk_4.szs", "ldf_bike_blue-bk.szs", "la_bike-mr.szs", "la_bike-bks.szs"];
  expect(copyCandidates("characters", "la_bike-bk.szs", kart)).toEqual({ close: ["la_bike-bk_2.szs", "la_kart-bk_4.szs", "ldf_bike_blue-bk.szs"], other: [] });
  expect(copyCandidates("characters", "la_kart-bk_4.szs", kart).close).toContain("la_bike-bk.szs");
  const courses = ["beginner_course.szs", "beginner_course_d.szs", "castle_course.szs", "castle_course_d.szs"];
  expect(copyCandidates("courses", "beginner_course.szs", courses)).toEqual({ close: ["beginner_course_d.szs"], other: ["castle_course.szs", "castle_course_d.szs"] });
  expect(copyCandidates("courses", "beginner_course_d.szs", courses).close).toEqual(["beginner_course.szs"]);
  expect(copyCandidates("objects", "Common.szs", ["Common.szs"])).toEqual({ close: [], other: [] });
});

const kart = process.env.MKWII_GAME_DIR ? join(process.env.MKWII_GAME_DIR, "Race/Kart") : "";
test.skipIf(!kart || !existsSync(kart))("an edited driver texture reaches identical copies whole and other versions texture by texture", async () => {
  const driver = async (name: string) => findFile(parseU8(yaz0Decompress(new Uint8Array(await Bun.file(join(kart, name)).arrayBuffer()))), "driver_model.brres")!.data as Uint8Array;
  const original = await driver("la_kart-bk.szs");
  const parsed = parseBRRES(original);
  const name = [...parsed.textures.keys()].find((t) => [4, 5, 6, 14].includes(parsed.textures.get(t).format))!;
  const tex = parsed.textures.get(name);
  const red = new Uint8Array(tex.width * tex.height * 4).map((_, i) => (i % 4 === 0 || i % 4 === 3 ? 255 : 0));
  const next = replaceBRRESTexture(original, name, red);
  expect(changedTextures(original, next)).toEqual([name]);

  // Same character on another kart: an identical copy, replaced whole.
  const identical = updateCopy(await driver("lb_kart-bk.szs"), original, next)!;
  expect(identical.kind).toBe("identical");
  expect(identical.data).toBe(next);

  // On a bike the model differs, but the texture is the same one: only it changes.
  const bike = await driver("la_bike-bk.szs");
  const onBike = updateCopy(bike, original, next)!;
  expect(onBike.kind).toBe("textures");
  expect(onBike.textures).toBe(1);
  const bikeTex = parseBRRES(onBike.data).textures.get(name);
  expect([...decodeTexture(bikeTex).subarray(0, 8)]).toEqual([...decodeTexture(parseBRRES(next).textures.get(name)).subarray(0, 8)]);
  // Nothing else of the bike model moved.
  const before = parseBRRES(bike).textures.get(name);
  expect([...onBike.data.subarray(0, before.dataOffset)]).toEqual([...bike.subarray(0, before.dataOffset)]);

  // Another character has nothing to update; an unchanged resource neither.
  expect(updateCopy(await driver("mdf_kart-mr.szs"), original, next)).toBeNull();
  expect(updateCopy(original, original, original)).toBeNull();
});
