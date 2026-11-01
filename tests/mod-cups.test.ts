import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildBMG, parseBMG } from "../web/js/formats/bmg.js";
import { PULSAR_IDS, buildPulsarConfig, crc32, parsePulsarConfig } from "../web/js/formats/pulsar.js";
import { buildLECode, parseLECode } from "../web/js/formats/lecode.js";
import {
  addCup, cupName, fillEmptyTracks, initialPulsar, moveTrack, patchTrack, plannedAlphabetical, plannedFileSection, plannedTracks, pulsarNameChanges, pulsarNames, removeLastCup, replaceTrack, swapCups, swapTracks, trackChanged, trackName,
} from "../web/js/data/pulsar-cups.js";

const be = (n: number, size = 4) => Array.from({ length: size }, (_, i) => (n >>> ((size - 1 - i) * 8)) & 255);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const pad = (bytes: number[], to: number) => [...bytes, ...new Array((to - (bytes.length % to)) % to).fill(0)];

// A BMG with message IDs (INF1 entries of 8 bytes, MID1).
function bmg(messages: [number, string][]) {
  const dat: number[] = [0, 0], offsets: number[] = [];
  for (const [, text] of messages) { offsets.push(dat.length); for (const c of text) dat.push(...be(c.charCodeAt(0), 2)); dat.push(0, 0); }
  const inf = pad([...ascii("INF1"), ...be(0), ...be(messages.length, 2), ...be(8, 2), 0, 0, 0, 0, ...offsets.flatMap((o) => [...be(o), 0, 0, 0, 0])], 32);
  const datSection = pad([...ascii("DAT1"), ...be(0), ...dat], 32);
  const mid = pad([...ascii("MID1"), ...be(0), ...be(messages.length, 2), 0x10, 0, 0, 0, 0, 0, ...messages.flatMap(([id]) => be(id))], 32);
  for (const s of [inf, datSection, mid]) s.splice(4, 4, ...be(s.length));
  const body = [...inf, ...datSection, ...mid];
  return Uint8Array.from([...ascii("MESGbmg1"), ...be(0x20 + body.length), ...be(3), 2, ...new Array(15).fill(0), ...body]);
}

describe("BMG", () => {
  test("new messages are added in ID order", () => {
    const data = bmg([[0x10000, "Cup A"], [0x20000, "Track A"]]);
    const out = parseBMG(buildBMG(parseBMG(data), { 0x10001: "Cup B", 0x20000: "Track A2" }, { add: true }));
    expect(out.messages.map((m: any) => [m.id, m.text])).toEqual([[0x10000, "Cup A"], [0x10001, "Cup B"], [0x20000, "Track A2"]]);
    // Without { add }, unknown IDs are ignored as before.
    expect(parseBMG(buildBMG(parseBMG(data), { 0x99: "x" })).messages.length).toBe(2);
  });
});

// A Pulsar Config.pul (version 3) with `cups` cups, named in its BMG.
function pulsarConfig(cups: number) {
  const tracks = cups * 4 + (cups & 1 ? 4 : 0);
  const header = [...ascii("PULS"), ...be(3), ...be(0x24), ...be(0x74), ...be(0), ...pad(ascii("/Pack"), 16)];
  const info = [...ascii("INFO"), ...be(1), ...be(0x50), ...new Array(0x50 - 12).fill(0)];
  info[12 + 25] = 0; info[12 + 26] = cups;
  const names: [number, string][] = [];
  for (let c = 0; c < cups; c++) names.push([PULSAR_IDS.cup + c, `Cup ${String.fromCharCode(65 + c)}`]);
  for (let i = 0; i < cups * 4; i++) names.push([PULSAR_IDS.track + i, `Track ${String.fromCharCode(90 - i)}`]);
  names.sort((a, b) => a[0] - b[0]);
  const trackBytes = Array.from({ length: tracks }, (_, i) => [8, 8, 0, 0, ...be(1000 + (i % (cups * 4)))]).flat();
  const alpha = Array.from({ length: cups * 4 }, (_, i) => cups * 4 - 1 - i);
  const alphaBytes = [...alpha, ...(cups & 1 ? alpha.slice(0, 4) : [])].flatMap((x) => be(x, 2));
  const cupsSection = [...ascii("CUPS"), ...be(3), ...be(28 + tracks * 8 + tracks * 2), ...be(cups, 2), 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...be(0), ...trackBytes, ...alphaBytes];
  const head = [...header, ...info];
  const text = bmg(names);
  const file = ascii("FILE\n" + Array.from({ length: cups * 4 }, (_, i) => `${i.toString(16).toUpperCase()}=file${i}||||`).join("\n") + "\n");
  const all = [...head, ...cupsSection];
  const out = Uint8Array.from([...all, ...text, ...file]);
  new DataView(out.buffer).setInt32(16, all.length);
  return out;
}

describe("Pulsar packs", () => {
  test("a single replacement fills empty places without changing the source or other tracks", () => {
    let a = addCup(initialPulsar({ cupCount: 0, regsMode: 1 }), "First cup");
    expect(() => fillEmptyTracks(a, 0)).toThrow("Choose a track");
    a = replaceTrack(a, 1, "C:/track.szs", "My track");
    a = patchTrack(a, 1, { author: "Author", slot: 4, music: 6 });
    const next = fillEmptyTracks(a, 1);
    expect(a.tracks.filter((t: any) => !t.file)).toHaveLength(3);
    expect(next.regsMode).toBe(1);
    expect(next.tracks[1]).toBe(a.tracks[1]);
    expect(next.tracks.every((t: any) => t.file?.path === "C:/track.szs" && t.slot === 4 && t.music === 6 && t.author === "Author")).toBe(true);
    expect(next.tracks[0].file).not.toBe(a.tracks[1].file);
  });

  test("repeating a saved track preserves variants and alphabetical order with a fresh identity", () => {
    const config = parsePulsarConfig(pulsarConfig(1));
    config.tracks[0].variants = [{ slot: 4, music: 6 }];
    const text = (id: number) => new Map(parseBMG(config.bmg).messages.map((m: any) => [m.id, m.text])).get(id) ?? null;
    const before = addCup(initialPulsar(config), "Second cup");
    let next = fillEmptyTracks(before, 0);
    expect(next.tracks.slice(4).every((t: any) => t.from === 0 && t.duplicate)).toBe(true);
    const tracks = plannedTracks(config, next, (_path: string, i: number) => 2000 + i);
    expect(tracks[0].crc).toBe(config.tracks[0].crc);
    expect(new Set(tracks.map((t: any) => t.crc)).size).toBe(8);
    expect(tracks[4].variants).toEqual([{ slot: 4, music: 6 }]);
    expect(plannedAlphabetical(config, next, text).slice(0, 4)).toEqual(config.alphabetical);
    expect([...plannedAlphabetical(config, next, text)].sort((a, b) => a - b)).toEqual([...Array(8).keys()]);
    expect(new TextDecoder().decode(plannedFileSection(config.file, next))).toContain("4=file0||||");
    // Moving a copy back to the source's old position still needs a write and a fresh identity.
    next = swapTracks(next, 0, 4);
    expect(trackChanged(next, 0)).toBeTruthy();
    expect(plannedTracks(config, next, (_path: string, i: number) => 2000 + i)[0].crc).toBe(2000);
    expect(replaceTrack(next, 0, "new.szs", "New").tracks[0].duplicate).toBeUndefined();
  });

  test("editing custom cups preserves the original-cup coexistence mode", () => {
    for (const regsMode of [0, 1, 2]) {
      const config = { ...parsePulsarConfig(pulsarConfig(2)), regsMode };
      let a = initialPulsar(config);
      a = addCup(a, "Extra cup");
      a = swapTracks(a, 0, 4);
      a = swapCups(a, 0, 1);
      a = removeLastCup(a);
      expect(a.regsMode).toBe(regsMode);
      expect(parsePulsarConfig(buildPulsarConfig({ ...config, regsMode: a.regsMode })).regsMode).toBe(regsMode);
    }
  });
  test("Config.pul reads and rebuilds byte for byte, with even and odd cup counts", () => {
    for (const cups of [2, 3]) {
      const data = pulsarConfig(cups);
      const config = parsePulsarConfig(data);
      expect(config.cupCount).toBe(cups);
      expect(config.tracks.length).toBe(cups * 4);
      expect(config.info.iconCount).toBe(cups);
      expect(buildPulsarConfig(config)).toEqual(data);
    }
  });

  test("tracks and cups move, a new cup gets its names, files, CRC and alphabetical place", () => {
    const config = parsePulsarConfig(pulsarConfig(2));
    const text = (id: number) => new Map(parseBMG(config.bmg).messages.map((m: any) => [m.id, m.text])).get(id) ?? null;
    const names = pulsarNames(text);
    let a = initialPulsar(config);
    a = swapTracks(a, 0, 5);
    a = moveTrack(a, 1, 1); // positions 1 and 2
    a = swapCups(a, 0, 1);
    expect(a.tracks.map((t: any) => t.from)).toEqual([4, 0, 6, 7, 5, 2, 1, 3]);
    a = addCup(a, "Cup new");
    for (let k = 0; k < 4; k++) a = replaceTrack(a, 8 + k, `C:\\t\\New ${k}.szs`, `New ${k}`);
    expect(cupName(a, 2, names)).toBe("Cup new");
    expect(trackName(a, 0, names)).toBe(text(PULSAR_IDS.track + 4));
    const tracks = plannedTracks(config, a, (path: string) => crc32(new TextEncoder().encode(path)));
    expect(tracks[0].crc).toBe(1004);
    expect(tracks[8].crc).toBe(crc32(new TextEncoder().encode("C:\\t\\New 0.szs")));
    const changes = pulsarNameChanges(config, a, text);
    expect(changes[PULSAR_IDS.cup + 0]).toBe("Cup B");
    expect(changes[PULSAR_IDS.track + 8]).toBe("New 0");
    const order = plannedAlphabetical(config, a, text);
    expect([...order].sort((x, y) => x - y)).toEqual([...Array(12).keys()]);
    expect(order.slice(0, 4).map((i: number) => trackName(a, i, names))).toEqual(["New 0", "New 1", "New 2", "New 3"]);
    const file = new TextDecoder().decode(plannedFileSection(config.file, a));
    expect(file.split("\n").slice(0, 3)).toEqual(["FILE", "0=file4||||", "1=file0||||"]);
    expect(file).toContain("8=New 0||||");
    expect(() => removeLastCup(removeLastCup(removeLastCup(a)))).toThrow();
  });

  const pulsar = process.env.MKWII_PULSAR_DIR;
  test.skipIf(!pulsar || !existsSync(join(pulsar || "", "Binaries", "Config.pul")))("a real pack's Config.pul rebuilds byte for byte", () => {
    const data = new Uint8Array(readFileSync(join(pulsar!, "Binaries", "Config.pul")));
    expect(buildPulsarConfig(parsePulsarConfig(data))).toEqual(data);
  });
});

// An LE-CODE binary with room for 4 cups and 0x50 slots.
function leBinary() {
  const out = new Uint8Array(0x400), v = new DataView(out.buffer);
  out.set(ascii("LECT")); v.setUint32(4, 5); v.setUint32(0x18, 0x40);
  out.set(ascii("v5 b40R PAL 2024-02-17"), 0x20);
  const p = 0x40;
  out.set(ascii("LPAR"), p); v.setUint32(p + 8, 1); v.setUint32(p + 12, 0x40);
  const offsets = { eod: 0x3c0, cupPar: 0x40, cupTrack: 0x50, cupArena: 0x90, coursePar: 0xd0, property: 0xe0, music: 0x130, flags: 0x180 };
  Object.values(offsets).forEach((o, i) => v.setUint32(p + 0x10 + i * 4, o));
  out.set(ascii("CUP2"), p + offsets.cupPar); v.setUint32(p + offsets.cupPar + 4, 2); v.setUint32(p + offsets.cupPar + 8, 2);
  [8, 1, 2, 4, 0, 5, 6, 7].forEach((slot, i) => v.setUint32(p + offsets.cupTrack + i * 4, slot));
  out.set(ascii("CRS2"), p + offsets.coursePar); v.setUint32(p + offsets.coursePar + 4, 0x20);
  for (let s = 0; s < 0x20; s++) { out[p + offsets.property + s] = s; out[p + offsets.music + s] = 0x70 + s; }
  return out;
}

describe("LE-CODE distributions", () => {
  test("cups, slots and their room are read, and written in place", () => {
    const data = leBinary();
    const le = parseLECode(data);
    expect(le.cups).toEqual([[8, 1, 2, 4], [0, 5, 6, 7]]);
    expect(le.slots.length).toBe(0x20);
    expect(le.slots[8]).toEqual({ property: 8, music: 0x78, flags: 0 });
    expect(le.capacity).toEqual({ cups: 4, slots: 0x50 });
    expect(le.flagBytes).toBe(2);
    expect(buildLECode(le, le.cups, le.slots)).toEqual(data);
    const slots = [...le.slots, ...Array.from({ length: 0x28 }, (_, i) => ({ property: 8, music: 0x78, flags: i }))];
    const out = parseLECode(buildLECode(le, [[1, 8, 2, 4], [0, 5, 6, 7], [0x44, 0x45, 0x46, 0x47]], slots));
    expect(out.cups[2]).toEqual([0x44, 0x45, 0x46, 0x47]);
    expect(out.slots[0x45]).toEqual({ property: 8, music: 0x78, flags: 0x25 });
    expect(out.data.length).toBe(data.length);
    expect(() => buildLECode(le, Array(5).fill([0, 1, 2, 3]), le.slots)).toThrow();
  });

  const bin = process.env.MKWII_LECODE_BIN;
  test.skipIf(!bin || !existsSync(bin || ""))("an official lecode binary rebuilds byte for byte", () => {
    const data = new Uint8Array(readFileSync(bin!));
    const le = parseLECode(data);
    expect(le.cups.length).toBeGreaterThan(0);
    expect(buildLECode(le, le.cups, le.slots)).toEqual(data);
  });
});
