import { expect, test } from "bun:test";
import { buildBMG, createBMG, parseBMG, usualAttributes, zeroAttributeIds } from "../web/js/formats/bmg.js";
import { pairCup } from "../web/js/data/pulsar-cups.js";

const hex = (a: Uint8Array) => [...a].map((x) => x.toString(16).padStart(2, "0")).join("");

// The first attribute byte chooses the font: 0 leaves the text box's own font, which on the course
// and cup buttons only has capital letters and digits (names showed "N?? M? C??" in the game).
test("new messages take the file's usual attributes, so names use the game's full font", () => {
  const file = parseBMG(createBMG([[0x2704, "Random Track"], [0x2705, "Choose"]]));
  expect(hex(usualAttributes(file))).toBe("01000000");
  const out = parseBMG(buildBMG(file, { 0x10000: "My Cup 1", 0x20000: "New track - 2" }, { add: true }));
  for (const id of [0x10000, 0x20000]) expect(hex(out.messages.find((m: any) => m.id === id)!.attributes)).toBe("01000000");
});

test("names written before with zero attributes are repaired, other messages are kept", () => {
  const file = parseBMG(createBMG([[0x2704, "Random Track"], [0x10000, "My Cup 1"], [0x20000, "Track"]]));
  // As the earlier versions wrote them: the names with all-zero attributes.
  for (const m of file.messages) if (m.id >= 0x10000) m.attributes = new Uint8Array(4);
  const broken = parseBMG(buildBMG({ ...file, data: null }, {}));
  const isName = (id: number) => id >= 0x10000 && id < 0x40000;
  expect(zeroAttributeIds(broken, isName)).toEqual([0x10000, 0x20000]);
  const fixed = parseBMG(buildBMG(broken, {}, { repair: zeroAttributeIds(broken, isName) }));
  expect(fixed.messages.map((m: any) => hex(m.attributes))).toEqual(["01000000", "01000000", "01000000"]);
  expect(fixed.messages.map((m: any) => m.text)).toEqual(["Random Track", "My Cup 1", "Track"]);
  expect(zeroAttributeIds(fixed, isName)).toEqual([]);
});

test("Pulsar packs get an even number of cups: the first cup fills the pair", () => {
  const a: any = { regsMode: 1, cups: [{ from: null, name: "My Cup 1", icon: { path: "icon.png" } }], tracks: [0, 1, 2, 3].map((k) => ({ from: null, file: { path: `t${k}.szs`, label: `T${k}` }, name: `T${k}` })) };
  const paired = pairCup(a);
  expect(paired.cups.length).toBe(2);
  expect(paired.cups[1]).toMatchObject({ from: null, name: "My Cup 1", icon: { path: "icon.png" } });
  expect(paired.tracks.slice(4).map((t: any) => t.file.path)).toEqual(["t0.szs", "t1.szs", "t2.szs", "t3.szs"]);
  expect(pairCup(paired)).toBe(paired);
  // Tracks already in the pack are copied from their archive.
  const existing: any = { regsMode: 1, cups: [{ from: 0 }, { from: 1 }, { from: 2 }], tracks: Array.from({ length: 12 }, (_, i) => ({ from: i })) };
  expect(pairCup(existing).tracks.slice(12)).toEqual([0, 1, 2, 3].map((k) => ({ from: k, duplicate: true })));
});

test("files are replaced in archives without a '.' folder (Pulsar's UIAssets.szs), not added twice", async () => {
  const { buildU8, findFile, listFiles, parseU8, setFilePath, deleteFilePath } = await import("../web/js/formats/u8.js");
  const tree = parseU8(buildU8({ name: "", children: [{ name: "button", children: [{ name: "timg", children: [{ name: "icon_000.tpl", data: new Uint8Array([1]) }, { name: "icon_001.tpl", data: new Uint8Array([2]) }] }] }] }));
  setFilePath(tree, "button/timg/icon_001.tpl", new Uint8Array([1]));
  setFilePath(tree, "button/timg/icon_002.tpl", new Uint8Array([3]));
  expect(listFiles(tree).map((f: any) => f.path)).toEqual(["button/timg/icon_000.tpl", "button/timg/icon_001.tpl", "button/timg/icon_002.tpl"]);
  expect([...findFile(tree, "icon_001.tpl")!.data]).toEqual([1]);
  expect(deleteFilePath(tree, "button/timg/icon_002.tpl")).toBe(true);
  expect(listFiles(tree).length).toBe(2);
});
