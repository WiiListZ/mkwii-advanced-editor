import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { lookSummary } from "../web/js/editor/track-looks.js";
import { buildBFG, emptyFogEntry } from "../web/js/formats/bfg.js";
import { parseKMP } from "../web/js/formats/kmp.js";
import { parseU8 } from "../web/js/formats/u8.js";
import { yaz0Decompress } from "../web/js/formats/yaz0.js";

const game = process.env.MKWII_GAME_DIR;
const archive = (files: Record<string, Uint8Array>) => ({ name: "", children: Object.entries(files).map(([name, data]) => ({ name, data })) });
const noKmp = { AREA: [] as any[] };

test("a track without these files says so, instead of an empty list", () => {
  const doc = { szs: archive({}), kmp: noKmp };
  for (const id of ["lighting", "fog", "effects"]) {
    const { rows, note } = lookSummary(doc, id);
    expect(rows).toEqual([]);
    expect(note).toBeTruthy();
  }
  expect(lookSummary({ szs: null, kmp: noKmp }, "fog").rows).toEqual([]);
});

test("the fog's settings are listed with their colours and the areas that use them", () => {
  const entries = [0, 1, 2, 3].map(emptyFogEntry);
  entries[0] = { ...emptyFogEntry(), type: 1, start: 0, end: 5000, color: [255, 0, 16] };
  entries[2] = { ...emptyFogEntry(), type: 4, start: -100, end: 170000, color: [1, 2, 3], fade: 1 / 120 };
  const kmp = { AREA: [{ type: 2, setting1: 2 }, { type: 2, setting1: 2 }, { type: 0, setting1: 2 }, { type: 2, setting1: 3 }] };
  const { rows, note } = lookSummary({ szs: { name: "", children: [{ name: "posteffect", children: [{ name: "posteffect.bfg", data: buildBFG(entries) }] }] }, kmp }, "fog");
  expect(note).toBeNull();
  expect(rows.length).toBe(4);
  expect(rows[0]).toEqual({ label: "Fog 0", value: "Linear · 0 to 5,000", colour: "#ff0010" });
  expect(rows[1]).toEqual({ label: "Fog 1", value: "No fog" });
  expect(rows[2].value).toBe("Inverse exponent · -100 to 170,000 · 2 areas · fades over 120 frames");
  expect(rows[2].colour).toBe("#010203");
  expect(rows[3]).toEqual({ label: "Fog 3", value: "No fog · 1 area" });
  // Too short to read: said, not thrown.
  const broken = lookSummary({ szs: archive({ "posteffect.bfg": new Uint8Array(10) }), kmp: noKmp }, "fog");
  expect(broken.rows).toEqual([]);
  expect(broken.note).toContain("could not be read");
});

test("lighting lists its files and sizes", () => {
  const { rows, note } = lookSummary({ szs: archive({ "posteffect.blight": new Uint8Array(2048), "posteffect.blmap": new Uint8Array(100), "other.bin": new Uint8Array(4) }), kmp: noKmp }, "lighting");
  expect(rows).toEqual([{ label: "posteffect.blight", value: "2.0 KB" }, { label: "posteffect.blmap", value: "100 bytes" }]);
  expect(note).toBeNull();
});

test("on a real track, all three read what is in its archive", () => {
  const path = game && join(game, "Race", "Course", "boardcross_course.szs");
  if (!path || !existsSync(path)) return;
  const szs = parseU8(yaz0Decompress(new Uint8Array(readFileSync(path))));
  const { findFile } = require("../web/js/formats/u8.js");
  const doc = { szs, kmp: parseKMP(findFile(szs, "course.kmp").data) };
  const lit = lookSummary(doc, "lighting"), fogged = lookSummary(doc, "fog"), effects = lookSummary(doc, "effects");
  expect(lit.rows.some((row: any) => row.label.endsWith(".blight"))).toBe(true);
  // This track swaps to its second fog with an area.
  expect(fogged.rows.length).toBe(4);
  expect(fogged.rows[0].colour).toBe("#ecffff");
  expect(fogged.rows[1].value).toContain("area");
  expect(effects.rows.length).toBeGreaterThan(0);
  expect(effects.rows.every((row: any) => !row.value.includes("could not"))).toBe(true);
  expect(effects.note).toMatch(/[1-9]\d* emitter/);
  expect(effects.note).toMatch(/[1-9]\d* texture/);
});
