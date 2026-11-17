import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CUSTOM_VIDEOS, customVideoName, earlierPulsarMenuVideos, enablePulsarMenuVideos, pulsarCustomVideos, pulsarMenuVideos, setPulsarCustomVideos } from "../web/js/formats/pulsar-code.js";

const engine = new Uint8Array(readFileSync(join(import.meta.dir, "../vendor/pulsar/Code.pul")));
const u32 = (b: Uint8Array, at: number) => new DataView(b.buffer, b.byteOffset).getUint32(at);
// The PAL binary: at 0x10, its code from 0x30, codeSize at +0x0c.
const PAL = 0x10, CODE = PAL + 0x20, codeSize = u32(engine, PAL + 0x0c);
// The argument of the command with this header (type << 24 | relative address) in the PAL binary.
const commandValue = (b: Uint8Array, header: number) => {
  const end = PAL + u32(b, 0);
  for (let p = CODE + u32(b, PAL + 0x0c); p < end; p += 4) if (u32(b, p) === header) return u32(b, p + 4);
  return null;
};

test("Pulsar's engine turns the menu videos off; the PAL engine can play them, each cup with its own video", () => {
  expect(pulsarMenuVideos(engine)).toBe("off");
  const on = enablePulsarMenuVideos(engine);
  expect(pulsarMenuVideos(on)).toBe("on");
  expect(enablePulsarMenuVideos(on)).toEqual(on);
  // PAL grows by 1440 bytes of code (four added functions, the custom cups' table of 32 videos and
  // their names) and 616 of commands (25 writes: 6 table entries, 14 instructions, 5 nops; 38
  // relocations: 4 calls, the table's address, 32 names; the branch-link); the others are untouched.
  const added = 1440, grow = added + 25 * 12 + 38 * 8 + 12;
  expect(on.length).toBe(engine.length + grow);
  expect(u32(on, 0)).toBe(u32(engine, 0) + grow);
  expect(u32(on, PAL + 0x18)).toBe(u32(engine, PAL + 0x18) + grow);
  expect(u32(on, PAL + 0x0c)).toBe(codeSize + added);
  expect([...on.subarray(0x22de0 + grow)]).toEqual([...engine.subarray(0x22de0)]);
  // The code before the added functions is unchanged but for the track buttons' call (0x13b08 + 0xc4)
  // and the single-player menu's count of videos (0x10208 + 0xe0, now a nop).
  const call = 0x13b08 + 0xc4, count = 0x10208 + 0xe0;
  expect([...on.subarray(CODE, CODE + count)]).toEqual([...engine.subarray(CODE, CODE + count)]);
  expect([...on.subarray(CODE + count + 4, CODE + call)]).toEqual([...engine.subarray(CODE + count + 4, CODE + call)]);
  expect([...on.subarray(CODE + call + 4, CODE + codeSize)]).toEqual([...engine.subarray(CODE + call + 4, CODE + codeSize)]);
  expect(u32(engine, CODE + count)).toBe(0x901f0310);
  expect(u32(on, CODE + count)).toBe(0x60000000);
  // Pulsar's branch-link to LoadCorrectBRCTR (0x8084f084) goes to the fourth added function, which calls it.
  const single = 0x78 + 26 * 4 + CUSTOM_VIDEOS * 8 + 4 + CUSTOM_VIDEOS * 28;
  expect(u32(on, CODE + codeSize + single + 0x10)).toBe(0x2c1c0003); // cmpwi r28,3
  expect(commandValue(on, (10 << 24) | (codeSize + single + 0xc))).toBe(0x10208);
  // Pulsar's InitSelf of the track buttons calls the second added function (at +0x3c) instead of
  // SelectButton (bctrl); it makes that call and then the game's handler of a selected track button.
  expect(u32(engine, CODE + call)).toBe(0x4e800421);
  expect(u32(on, CODE + call)).toBe((0x48000001 | ((codeSize + 0x3c - call) & 0x03fffffc)) >>> 0);
  expect(u32(on, CODE + codeSize + 0x3c + 0x14)).toBe(0x4e800421);
  expect(commandValue(on, (10 << 24) | (codeSize + 0x3c + 0x24))).toBe(0x807e548c);
  // ExpCupSelect's slot 0x94 gets Menu::OnMoviesActivate, the nop over LoadMovies is moved away.
  expect(u32(on, 0x1ffa8 + added)).toBe(0x808387f8);
  expect(u32(on, 0x22a28 + added)).toBe(0x807e4580);
  // The course selection's video table (0x808d9430) in Pulsar's order of cups: Shell second, etc.
  const end = PAL + u32(engine, 0) + added;
  const write = (i: number) => u32(on, end + i * 12 + 4).toString(16) + "=" + u32(on, end + i * 12 + 8).toString(16);
  expect([0, 1, 2].map(write)).toEqual(["808d9434=808ad284", "808d9438=808ad240", "808d943c=808ad29c"]);
  // The cup selection's picture per cup (row = cup / 2 % 4, column = cup % 2; 7 for custom cups),
  // and the course selection's instructions before LoadMovies given to the third added function.
  expect(write(6)).toBe("807e5b9c=20060007");
  expect(write(24)).toBe("808404f4=60000000");
  // The branch-link of 0x808404e0 to the third added function (after the first two, at +0x78).
  const link = end + 25 * 12 + 38 * 8;
  expect([u32(on, link), u32(on, link + 4), u32(on, link + 8)]).toEqual([0x41fffffe, 0x808404e0, codeSize + 0x78]);
  expect(u32(on, CODE + codeSize + 0x78)).toBe(0x28000008); // cmplwi r0,8
  // Its table's address (lis/addi) and the 32 names.
  expect(commandValue(on, (6 << 24) | (codeSize + 0x78 + 7 * 4 + 2))).toBe(codeSize + 0x78 + 26 * 4);
  const name0 = codeSize + 0x78 + 26 * 4 + CUSTOM_VIDEOS * 8 + 4;
  expect(commandValue(on, (1 << 24) | (codeSize + 0x78 + 26 * 4 + 4))).toBe(name0);
  expect(new TextDecoder().decode(on.subarray(CODE + name0, CODE + name0 + 24))).toBe(customVideoName(0));
  // Pulsar's InitSelf (0x13840) calls the added function instead of SelectInitial; the added
  // function calls SelectInitial, then the game's handler of a selected cup button.
  expect(commandValue(engine, 0x0a0138fc)).toBe(0x805bdaf0);
  expect(commandValue(on, 0x0a0138fc)).toBe(codeSize);
  expect(u32(on, CODE + codeSize)).toBe(0x9421fff0);
  expect(commandValue(on, (10 << 24) | (codeSize + 0x14))).toBe(0x805bdaf0);
  expect(commandValue(on, (10 << 24) | (codeSize + 0x24))).toBe(0x807e5c58);
  // The bss after the code moves along: InitSelf's CupsConfig::sInstance (lis/lwz) is reached further.
  expect(commandValue(engine, 0x0601384a)).toBe(0x1d888);
  expect(commandValue(on, 0x0601384a)).toBe(0x1d888 + added);
  expect(commandValue(on, 0x04013862)).toBe(0x1d888 + added);
});

test("custom cups' videos: a table of at most 32 [cup, file], changed in place", () => {
  const on = enablePulsarMenuVideos(engine);
  expect(pulsarCustomVideos(on)!.size).toBe(0);
  const some = setPulsarCustomVideos(on, new Map([[0, 0], [7, 5]]));
  expect([...pulsarCustomVideos(some)!]).toEqual([[0, 0], [7, 5]]);
  expect(pulsarMenuVideos(some)).toBe("on");
  expect(some.length).toBe(on.length);
  expect([...setPulsarCustomVideos(some, new Map())]).toEqual([...on]);
  // Over the limit, or two cups on one file: refused.
  expect(() => setPulsarCustomVideos(on, new Map(Array.from({ length: 33 }, (_, i) => [i, i % 32])))).toThrow();
  expect(() => setPulsarCustomVideos(on, new Map([[1, 2], [3, 2]]))).toThrow();
  expect(pulsarCustomVideos(engine)).toBeNull();
});

test("engines turned on by earlier versions of the editor are recognised and redone", () => {
  for (const earlier of earlierPulsarMenuVideos(engine)) {
    expect(pulsarMenuVideos(earlier)).toBe("legacy");
    expect(earlier.length).toBeLessThan(enablePulsarMenuVideos(engine).length);
  }
});

test("an engine that is not the expected one is left alone", () => {
  const broken = engine.slice();
  new DataView(broken.buffer).setUint32(0x1ffa8, 0x00014000); // the relocation no longer targets the empty function
  expect(pulsarMenuVideos(broken)).toBeNull();
  expect(() => enablePulsarMenuVideos(broken)).toThrow();
  expect(pulsarMenuVideos(new Uint8Array(64))).toBeNull();
});
