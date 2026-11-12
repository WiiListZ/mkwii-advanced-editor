import { expect, test } from "bun:test";
import { findMii, miiCrc, readRaceGhost } from "../src/race-ghost.ts";
// @ts-ignore Shared Wii format reader used by the frontend.
import { encodeInputs, inputFrames, parseRKG, timeText } from "../web/js/formats/rkg.js";

// A game's memory with only what a finished Time Trial leaves there, laid out as on Mario Kart Wii PAL.
type Layout = { stage?: number; mode?: number; laps?: number; finish?: number; lapEnds?: number[]; frames?: number; automatic?: number; controller?: number; mii?: boolean; decoy?: boolean };
const t = (ms: number) => ({ minutes: Math.floor(ms / 60000), seconds: Math.floor(ms / 1000) % 60, milliseconds: ms % 1000 });
const runs = (total: number, state: number) => {
  const list = [];
  for (let left = total; left > 0; left -= 255) list.push({ state, frames: Math.min(255, left) });
  return list;
};
const NAME = "Tester", ID = [0x80, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77];
function fakeMii() {
  const mii = new Uint8Array(0x4A);
  mii[0] = 0x12; mii[1] = 0x34;
  [...NAME].forEach((c, i) => { mii[2 + i * 2 + 1] = c.charCodeAt(0); });
  mii[0x16] = 0x40; mii[0x17] = 0x40;
  mii.set(ID, 0x18);
  for (let i = 0x20; i < 0x4A; i++) mii[i] = (i * 7) & 255;
  return mii;
}
const inputsOf = (frames: number) => ({ face: runs(frames, 1), direction: runs(frames, 0x77), tricks: [{ state: 0, frames }] });

function fakeMemory(layout: Layout = {}) {
  const { stage = 4, mode = 2, laps = 3, finish = 30000, lapEnds = [10000, 20000, 30000], automatic = 1, controller = 1, mii = true, decoy = true } = layout;
  const frames = layout.frames ?? Math.round(240 + finish * 59.94 / 1000);
  const regions = new Map<number, Uint8Array>();
  const at = (address: number, size: number) => {
    const base = address - (address % 0x100000);
    if (!regions.has(base)) regions.set(base, new Uint8Array(0x100000 + 0x100));
    return { bytes: regions.get(base)!, offset: address - base };
  };
  const put = (address: number, data: ArrayLike<number>) => { const { bytes, offset } = at(address, data.length); bytes.set(data, offset); };
  const u32 = (address: number, value: number) => put(address, [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]);
  const timer = (address: number, ms: number) => { const v = t(ms); put(address + 4, [v.minutes >> 8, v.minutes & 255, v.seconds, 0, v.milliseconds >> 8, v.milliseconds & 255, 1]); };

  const INPUT = 0x9026FA50, CONFIG = 0x909A68D0, MANAGER = 0x80E44CBC, BUFFER = 0x90273BBC;
  u32(0x809BD70C, INPUT); u32(0x809BD728, CONFIG); u32(0x809BD730, MANAGER);
  // Race settings: course, mode, laps; the first player.
  u32(CONFIG + 0xB68, 8); u32(CONFIG + 0xB68 + 8, mode); put(CONFIG + 0xB68 + 0x25, [laps]);
  u32(CONFIG + 0x28 + 0x08, 23); u32(CONFIG + 0x28 + 0x0C, 22); u32(CONFIG + 0x28 + 0xD0, controller);
  const name = fakeMii().subarray(2, 22);
  put(CONFIG + 0x28 + 0x7C, name); put(CONFIG + 0x28 + 0xA8, ID);
  // Race manager: stage, its player, lap and finish timers.
  u32(MANAGER + 0x28, stage); u32(MANAGER + 0x0C, 0x80E44D04); u32(0x80E44D04, 0x80E44D44);
  u32(0x80E44D44 + 0x3C, 0x80E44DB8); u32(0x80E44D44 + 0x40, 0x80E44DEC);
  lapEnds.forEach((end, i) => timer(0x80E44DB8 + i * 12, end));
  timer(0x80E44DEC, finish);
  // The recorded buttons.
  const recorded = encodeInputs(inputsOf(frames));
  put(INPUT + 0xC5, [automatic]); u32(INPUT + 0xDC, BUFFER); u32(INPUT + 0xE4, recorded.length);
  put(BUFFER, recorded);
  // The Mii: first another record with the same ID and name but other data, then a whole copy with its CRC.
  if (decoy) { const other = fakeMii(); other[0] = 0; other[0x30] ^= 0xFF; put(0x9020FE26, other); }
  if (mii) { const real = fakeMii(), crc = miiCrc(real); put(0x90210D74, real); put(0x90210D74 + 0x4A, [crc >> 8, crc & 255]); }

  return (address: number, size: number) => {
    const base = address - (address % 0x100000), bytes = regions.get(base);
    if (!bytes) return new Uint8Array(size);
    if (address - base + size > bytes.length) return null;
    return bytes.slice(address - base, address - base + size);
  };
}

const day = new Date(2026, 10, 7);

test("the Mii's CRC is the CRC-16 the ghost files use", () => {
  expect(miiCrc(new TextEncoder().encode("123456789"))).toBe(0x31C3);
});

test("a finished Time Trial in memory becomes the ghost file the game would save", () => {
  const result = readRaceGhost("RMCP01", fakeMemory(), day)!;
  expect(result.automatic).toBe(true);
  const ghost = parseRKG(result.bytes);
  expect(ghost).toMatchObject({ track: 8, vehicle: 23, character: 22, controller: 1, automatic: true, laps: 3, ghostType: 1, compressed: true, crcValid: true, year: 2026, month: 11, day: 7, miiName: NAME, country: 0xFF });
  expect(timeText(ghost.time)).toBe("0:30.000");
  expect(ghost.splits.map(timeText)).toEqual(["0:10.000", "0:10.000", "0:10.000", "0:00.000", "0:00.000"]);
  // The whole Mii, the copy followed by its CRC, and that CRC after it in the header.
  const real = fakeMii(), crc = miiCrc(real);
  expect([...result.bytes.subarray(0x3C, 0x3C + 0x4A)]).toEqual([...real]);
  expect([result.bytes[0x86], result.bytes[0x87]]).toEqual([crc >> 8, crc & 255]);
  expect([...result.bytes.subarray(0x34, 0x38)]).toEqual([0xFF, 0xFF, 0xFF, 0xFF]);
  // The buttons as recorded, starting at the countdown.
  expect(Buffer.from(encodeInputs(ghost.inputs)).equals(Buffer.from(encodeInputs(inputsOf(2038))))).toBe(true);
  expect(inputFrames(ghost.inputs.face)).toBe(2038);
  // Manual drift and another controller are read as they are.
  const manual = parseRKG(readRaceGhost("RMCP01", fakeMemory({ automatic: 0, controller: 3 }), day)!.bytes);
  expect(manual).toMatchObject({ automatic: false, controller: 3 });
  // Each lap's own time, not the time at its end.
  const uneven = parseRKG(readRaceGhost("RMCP01", fakeMemory({ lapEnds: [12345, 20000, 30000] }), day)!.bytes);
  expect(uneven.splits.slice(0, 3).map(timeText)).toEqual(["0:12.345", "0:07.655", "0:10.000"]);
});

test("nothing is read when there is no finished Time Trial to read, or memory does not fit one", () => {
  const none = (layout: Layout, game = "RMCP01") => readRaceGhost(game, fakeMemory(layout), day);
  expect(none({ stage: 2 })).toBeNull(); // still racing
  expect(none({ mode: 1 })).toBeNull(); // a Versus race
  expect(none({ frames: 2200 })).toBeNull(); // buttons of another length than the time
  expect(none({ lapEnds: [10000, 20000, 29000] })).toBeNull(); // laps that do not add up to the time
  expect(none({ laps: 0 })).toBeNull();
  expect(none({ automatic: 7 })).toBeNull();
  expect(none({ controller: 9 })).toBeNull();
  expect(none({ mii: false })).toBeNull(); // only the record without a CRC: not taken as the Mii
  expect(none({}, "RMCX01")).toBeNull();
  expect(none({}, "RSBE01")).toBeNull();
  expect(readRaceGhost("RMCP01", () => null, day)).toBeNull();
  // The Mii search skips the record that only shares the ID and name.
  const read = fakeMemory();
  const mii = findMii(read, new Uint8Array(ID), fakeMii().subarray(2, 22));
  expect([...mii!]).toEqual([...fakeMii()]);
});
