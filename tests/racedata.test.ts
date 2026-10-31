import { expect, test } from "bun:test";
import { buildKRM, isKmg, isKrm, isKrt, kmgTable, krmPattern, krmTable, krtTable, parseKRM, setKrmPattern, setKrmValue } from "../web/js/formats/racedata.js";
import { binDescription, binTable, readBinValue, writeBinValue } from "../web/js/formats/gamebin.js";

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

test("minigame.kmg: Battle settings per arena and player count", () => {
  const data = new Uint8Array(0x718);
  data.set(ascii("RKMG"));
  const v = new DataView(data.buffer);
  v.setUint32(4, 0x718);
  v.setUint16(0x010 + 9 * 0x16 + 0x14, 240); // Balloon Battle time limit, N64 Skyscraper, 12 players
  v.setInt16(0x1cc, -1); // points for losing all balloons
  v.setUint16(0x394, 12); // coins at the start, Delfino Pier, 2 players
  expect(isKmg("Race/Common/minigame.kmg", data)).toBe(true);
  const table = kmgTable(data);
  expect(binDescription("minigame.kmg", data)).toBe("Battle settings");
  const skyscraper = table.rows.find((r: any) => r.label === "Balloon Battle · Time limit · N64 Skyscraper")!;
  expect(readBinValue(data, skyscraper.fields[10].at, "u16")).toBe(240);
  expect(skyscraper.fields[10].label).toBe("12 players");
  const points = table.rows[0].fields.find((f: any) => f.label === "Points for losing all balloons")!;
  expect(readBinValue(data, points.at, points.type)).toBe(-1);
  const start = table.rows.find((r: any) => r.label === "Coin Runners · Coins at the start · Delfino Pier")!;
  expect(readBinValue(data, start.fields[0].at, "u16")).toBe(12);
  expect(table.rows.length).toBe(2 + 8 * 10);
  expect(writeBinValue(data, start.fields[0].at, "u16", 20).length).toBe(0x718);
});

test("ranktimeGP.krt: Grand Prix time limits per track and class", () => {
  const data = new Uint8Array(0x0c + 32 * 8);
  data.set(ascii("RKGT"));
  const v = new DataView(data.buffer);
  v.setUint32(4, 1000); v.setUint16(8, 32); v.setUint16(10, 0x0c);
  v.setUint16(0x0c + 8 * 8 + 4, 6670); // Luigi Circuit, 150cc
  expect(isKrt("ranktimeGP.krt", data)).toBe(true);
  const table = binTable("ranktimeGP.krt", data);
  expect(table.rows.length).toBe(33);
  expect(table.rows[9].label).toBe("Luigi Circuit");
  expect(table.rows[9].fields[2].help).toContain("1:51.17");
  expect(readBinValue(data, table.rows[9].fields[2].at, "u16")).toBe(6670);
});

test("vibration.krm: entries are read, rebuilt byte for byte and patterns can change length", () => {
  // Two value entries and two patterns, as in the game's file.
  const entry = (a: number, b: number, bytes: number[]) => [a >> 8, a & 255, b >> 8, b & 255, bytes.length >> 8, bytes.length & 255, ...bytes, 0];
  const entries = [entry(5, 12, [1]), entry(1, 8, [1]), entry(0, 0, [0, ...ascii("****---**")]), entry(0, 0, [0, ...ascii("**--*"), 0, 0])];
  const offsets: number[] = [];
  let at = 0;
  for (const e of entries) { offsets.push(at); at += e.length; }
  const header = 0x0c + entries.length * 4;
  const data = new Uint8Array(header + at), v = new DataView(data.buffer);
  data.set(ascii("RKRM")); v.setUint32(4, 1100); v.setUint16(8, entries.length); v.setUint16(10, header);
  offsets.forEach((o, i) => v.setUint32(0x0c + i * 4, o));
  entries.forEach((e, i) => data.set(e, header + offsets[i]));

  expect(isKrm("vibration.krm", data)).toBe(true);
  const krm = parseKRM(data);
  expect(buildKRM(krm)).toEqual(data);
  expect(krm.entries.map(krmPattern)).toEqual([null, null, "****---**", "**--*"]);
  expect(krmTable(data).rows.map((r: any) => r.label)).toEqual(["File settings", "Entry 1", "Entry 2", "Pattern 3", "Pattern 4"]);

  const longer = parseKRM(buildKRM(setKrmPattern(krm, 2, "*-*-*-*-*-*-*-")));
  expect(krmPattern(longer.entries[2])).toBe("*-*-*-*-*-*-*-");
  expect(krmPattern(longer.entries[3])).toBe("**--*");
  expect(longer.entries[0]).toEqual(krm.entries[0]);
  expect(parseKRM(buildKRM(setKrmValue(krm, 0, "b", 30))).entries[0].b).toBe(30);
  expect(() => setKrmPattern(krm, 2, "")).toThrow();
  expect(() => setKrmValue(krm, 0, "a", 70000)).toThrow();
});
