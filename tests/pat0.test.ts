import { expect, test } from "bun:test";
import { readPAT0, writePAT0 } from "../web/js/formats/pat0.js";
import { decodeTexture } from "../web/js/formats/brres.js";
import { bindPAT, BrresModelBuilder } from "../web/js/editor/brresmodel.js";

test("PAT0 retains fractional times, palette-only tracks, combined tracks and all eight slots", () => {
  const animation = { name: "Colours", frames: 12, loop: false, materials: new Map([
    ["Road", [{ index: 7, keys: [{ frame: 0, texture: "road", palette: "day" }, { frame: 3.5, texture: "road2", palette: "night" }] },
      { index: 0, keys: [{ frame: 0, palette: "day" }, { frame: 1.25, palette: "night" }] }]],
    ["Road2", [{ index: 3, keys: [{ frame: 0, texture: "sign" }] }]],
  ]) };
  const read = readPAT0(writePAT0(animation));
  expect(read.name).toBe(animation.name); expect(read.frames).toBe(12); expect(read.loop).toBe(false);
  expect(read.materials.get("Road")).toEqual([...animation.materials.get("Road")!].reverse());
  expect(read.materials.get("Road2")).toEqual(animation.materials.get("Road2"));
  expect(readPAT0(writePAT0(read))).toEqual(read);
});

test("PAT0 resource dictionary supports native name lookup for prefix and case-sensitive names", () => {
  const names = ["Road", "Road_alt", "Road_2", "a", "aa", "aaa", "Z", "road", "prefix_Material", "Material"];
  const data = writePAT0({ name: "Lookup", frames: 1, loop: true, materials: new Map(names.map((n) => [n, [{ index: 0, keys: [{ frame: 0, texture: "image" }] }]])) });
  const v = new DataView(data.buffer), g = v.getInt32(16);
  for (const name of names) {
    const text = new TextEncoder().encode(name);
    let previous = 65535, node = v.getUint16(g + 12), steps = 0;
    while (v.getUint16(g + 8 + node * 16) < previous) {
      const at = g + 8 + node * 16, bit = v.getUint16(at); previous = bit;
      node = v.getUint16(at + (((text[bit >> 3] || 0) >> (bit & 7)) & 1 ? 6 : 4));
      if (++steps > names.length + 1) throw new Error("Dictionary cycle");
    }
    const string = g + v.getInt32(g + 8 + node * 16 + 8);
    const end = data.indexOf(0, string);
    expect(new TextDecoder().decode(data.subarray(string, end))).toBe(name);
  }
});

test("PAT0 rejects duplicate slots and invalid frame times", () => {
  const base = { name: "Invalid", frames: 2, loop: true };
  expect(() => writePAT0({ ...base, materials: new Map([["Road", [{ index: 0, keys: [{ frame: 0, texture: "image" }] }, { index: 0, keys: [{ frame: 1, texture: "image" }] }]]]) })).toThrow("Duplicate PAT0 slot");
  expect(() => writePAT0({ ...base, materials: new Map([["Road", [{ index: 0, keys: [{ frame: 3, texture: "image" }] }]]]) })).toThrow("Invalid PAT0 frame time");
});

test("decoding and previewing the same indexed texture with different palettes preserves every frame's colours", () => {
  const texture: any = { width: 8, height: 4, format: 9, dataOffset: 0, reader: { d: new Uint8Array(32) } };
  const red = { colors: new Uint8Array([255, 0, 0, 255]) }, blue = { colors: new Uint8Array([0, 0, 255, 100]) };
  expect([...decodeTexture(texture, red).slice(0, 4)]).toEqual([255, 0, 0, 255]);
  expect([...decodeTexture(texture, blue).slice(0, 4)]).toEqual([0, 0, 255, 100]);
  expect([...decodeTexture(texture, red).slice(0, 4)]).toEqual([255, 0, 0, 255]);
  const builder = new BrresModelBuilder({ textures: new Map([["image", texture]]), palettes: new Map([["red", red], ["blue", blue]]) });
  const layer = { texture: "image", palette: "red", wrapS: 0, wrapT: 0, texId: 0 };
  const uniform = { value: null }, mat = { name: "Road", userData: { tev: true, brresMaterial: { layers: [layer] } }, uniforms: { uTex0: uniform } };
  const binding = bindPAT({ frames: 2, loop: true, materials: new Map([["Road", [{ index: 0, keys: [{ frame: 0, palette: "red" }, { frame: 1, palette: "blue" }] }]]]) }, { userData: { materials: [mat] } }, builder)!;
  binding.apply(0); expect([...(uniform.value as any).image.data.slice(0, 4)]).toEqual([255, 0, 0, 255]);
  binding.apply(1); expect([...(uniform.value as any).image.data.slice(0, 4)]).toEqual([0, 0, 255, 100]);
  binding.apply(0); expect([...(uniform.value as any).image.data.slice(0, 4)]).toEqual([255, 0, 0, 255]);
});
