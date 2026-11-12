import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BFG_ENTRIES, buildBFG, emptyFogEntry, fadeFrames, fadeValue, fogAmount, FOG_KIND_HELP, FOG_TYPES, parseBFG } from "../web/js/formats/bfg.js";
import { findFile, parseU8 } from "../web/js/formats/u8.js";
import { yaz0Decompress } from "../web/js/formats/yaz0.js";

const game = process.env.MKWII_GAME_DIR;

test("fog entries are read and written with every field", () => {
  const entries = Array.from({ length: BFG_ENTRIES }, emptyFogEntry);
  entries[1] = { type: 4, start: -500, end: 170000, color: [236, 255, 16], colorExtra: 7, rangeCorrection: 1, center: 9, fade: 0.5, extra: [5544, 12] };
  const bytes = buildBFG(entries);
  expect(bytes.length).toBe(112);
  const back = parseBFG(bytes);
  expect(back[1]).toEqual(entries[1]);
  expect(back[0].type).toBe(0);
  // The layout, as the game's files have it.
  const view = new DataView(bytes.buffer);
  expect(view.getInt32(0x1C)).toBe(4);
  expect(view.getFloat32(0x1C + 8)).toBe(170000);
  expect(bytes[0x1C + 0x0C]).toBe(236);
  expect(view.getUint16(0x1C + 0x18)).toBe(5544);
  expect(() => parseBFG(new Uint8Array(40))).toThrow();
});

test("the kinds grow the way their explanations say", () => {
  const at = (type: number, share: number) => fogAmount(type, 0, 100, share * 100);
  // Linear: even.
  expect(at(1, .5)).toBeCloseTo(.5, 5);
  // Exponential: fast at first, so thick early.
  expect(at(2, .25)).toBeGreaterThan(.7);
  // Exponent squared: a thin moment, then fast, then levelling off.
  expect(at(3, .1)).toBeLessThan(at(2, .1));
  expect(at(3, .5)).toBeGreaterThan(.7);
  // Inverse exponent: thin for most of the way, fast just before the end.
  expect(at(4, .5)).toBeLessThan(.1);
  expect(at(4, .9)).toBeGreaterThan(.5);
  // Inverse exponent squared: rises earlier, and eases in at the end.
  expect(at(5, .5)).toBeGreaterThan(at(4, .5));
  expect(at(5, .9) - at(5, .75)).toBeLessThan(at(4, .9) - at(4, .75));
});

test("every kind of fog has its explanation", () => {
  for (const [id] of FOG_TYPES) expect((FOG_KIND_HELP as any)[id]?.length).toBeGreaterThan(10);
  expect(Object.keys(FOG_KIND_HELP).length).toBe(FOG_TYPES.length);
});

// What the explanations say about the original tracks.
test("what the help says of the original tracks is so", () => {
  if (!game || !existsSync(join(game, "Race", "Course"))) return;
  const kinds: Record<number, number> = {};
  let used = 0, corrected = 0, twenty = 0;
  const starts: number[] = [], ends: number[] = [];
  for (const name of readdirSync(join(game, "Race", "Course")).filter((file) => file.endsWith(".szs") && !file.endsWith("_d.szs"))) {
    const node = findFile(parseU8(yaz0Decompress(new Uint8Array(readFileSync(join(game, "Race", "Course", name))))), "posteffect.bfg");
    if (!node) continue;
    for (const entry of parseBFG(node.data)) {
      if (!entry.type) continue;
      used++;
      kinds[entry.type] = (kinds[entry.type] || 0) + 1;
      if (entry.rangeCorrection) corrected++;
      if (fadeFrames(entry.fade) === 20) twenty++;
      starts.push(entry.start); ends.push(entry.end);
    }
  }
  const middle = (list: number[]) => [...list].sort((a, b) => a - b)[Math.floor((list.length - 1) / 2)];
  expect(used).toBe(53);
  expect(kinds).toEqual({ 2: 10, 4: 32, 5: 10, 6: 1 });
  expect(corrected).toBe(41);
  expect(twenty).toBeGreaterThan(used / 2);
  expect(middle(starts)).toBe(20000);
  expect(middle(ends)).toBe(500000);
  // So the help can say to keep it above, but not that it must be: two of them are not.
  expect(starts.filter((start, i) => ends[i] <= start).length).toBe(2);
}, 60000);

test("whatever follows the entries is kept", () => {
  const original = new Uint8Array(120);
  original[116] = 42;
  const bytes = buildBFG(parseBFG(original), original);
  expect(bytes.length).toBe(120);
  expect(bytes[116]).toBe(42);
});

test("the fade is one over its frames, and 0 is the game's default", () => {
  expect(fadeFrames(fadeValue(120))).toBe(120);
  expect(fadeValue(0)).toBe(0);
  expect(fadeFrames(0)).toBe(0);
  expect(fadeFrames(1)).toBe(1);
});

test("fog thickens by each kind's formula between its start and its end", () => {
  expect(fogAmount(0, 0, 100, 50)).toBe(0);
  for (const type of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    const near = fogAmount(type, 100, 200, 50), middle = fogAmount(type, 100, 200, 150), far = fogAmount(type, 100, 200, 500);
    expect(near).toBeLessThan(.01);
    expect(middle).toBeGreaterThan(near);
    expect(far).toBeGreaterThan(middle);
    expect(far).toBeGreaterThan(.99);
  }
  expect(fogAmount(1, 0, 100, 25)).toBeCloseTo(.25, 5);
  expect(fogAmount(2, 0, 100, 25)).toBeCloseTo(1 - 2 ** -2, 5);
  expect(fogAmount(3, 0, 100, 50)).toBeCloseTo(1 - 2 ** -2, 5);
  expect(fogAmount(4, 0, 100, 75)).toBeCloseTo(2 ** -2, 5);
  expect(fogAmount(5, 0, 100, 50)).toBeCloseTo(2 ** -2, 5);
  // The orthographic kinds have the same shapes.
  expect(fogAmount(7, 0, 100, 25)).toBe(fogAmount(2, 0, 100, 25));
});

test("the game's fog files read as valid and come back byte for byte", () => {
  if (!game || !existsSync(join(game, "Race", "Course"))) return;
  let checked = 0;
  for (const name of readdirSync(join(game, "Race", "Course")).filter((file) => file.endsWith(".szs") && !file.endsWith("_d.szs"))) {
    const node = findFile(parseU8(yaz0Decompress(new Uint8Array(readFileSync(join(game, "Race", "Course", name))))), "posteffect.bfg");
    if (!node) continue;
    checked++;
    const entries = parseBFG(node.data);
    for (const entry of entries) { expect(entry.type).toBeGreaterThanOrEqual(0); expect(entry.type).toBeLessThanOrEqual(10); }
    expect([...buildBFG(entries, node.data)]).toEqual([...node.data]);
  }
  expect(checked).toBeGreaterThan(10);
}, 60000); // every track of the game
