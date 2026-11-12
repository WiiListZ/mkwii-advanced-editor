import { expect, test } from "bun:test";
import { replaceIndexedTexture } from "../web/js/formats/brres.js";

// The game's own files hold no indexed textures, so these are built by hand: a C8 or C4 texture
// and an RGB5A3 palette in one buffer, described as the parser describes them.
function indexed(format: 8 | 9, width: number, height: number, paletteCount: number, sharedWith = "") {
  const data = new Uint8Array(0x8000);
  const palette = { name: "pal", count: paletteCount, format: 2, dataOffset: 0x20, colors: new Uint8Array(paletteCount * 4) };
  for (let i = 0; i < paletteCount; i++) palette.colors.set([i * 3, 255 - i * 3, 0, 255], i * 4);
  const tex = { name: "tex", width, height, format, dataOffset: 0x1000, offset: 0x1000, size: 0x4000, mipmaps: 1 };
  const layers = [{ texture: "tex", palette: "pal" }, ...(sharedWith ? [{ texture: sharedWith, palette: "pal" }] : [])];
  const brres = { models: [{ materials: [{ layers }] }], palettes: new Map([["pal", palette]]), textures: new Map([["tex", tex]]) };
  return { data, tex, palette, brres };
}

// Four solid quadrants, with a transparent one.
function quadrants(w: number, h: number) {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = y < h / 2 ? (x < w / 2 ? [255, 0, 0, 255] : [0, 255, 0, 255]) : (x < w / 2 ? [0, 0, 255, 255] : [0, 0, 0, 0]);
    rgba.set(c, (y * w + x) * 4);
  }
  return rgba;
}

const paletteEntry = (out: Uint8Array, palette: any, index: number) => {
  const v = (out[palette.dataOffset + index * 2] << 8) | out[palette.dataOffset + index * 2 + 1];
  if (v & 0x8000) return [((v >> 10) & 31) * 255 / 31 | 0, ((v >> 5) & 31) * 255 / 31 | 0, (v & 31) * 255 / 31 | 0, 255];
  return [((v >> 8) & 15) * 17, ((v >> 4) & 15) * 17, (v & 15) * 17, ((v >> 12) & 7) * 255 / 7 | 0];
};

test("C8: a PNG becomes indices into a recalculated palette, in the tile order of the format", () => {
  const { data, tex, palette, brres } = indexed(9, 16, 8, 256);
  const rgba = quadrants(16, 8), out = replaceIndexedTexture(data, brres, tex, rgba);
  expect(out.length).toBe(data.length);
  expect(data[0x1000]).toBe(0); // the input stays as it was
  // C8 is stored in 8x4 tiles, left to right, then down.
  const pixel = (x: number, y: number) => {
    const column = Math.floor(x / 8), row = Math.floor(y / 4);
    return out[tex.dataOffset + (row * 2 + column) * 32 + (y % 4) * 8 + (x % 8)];
  };
  for (const [x, y, want] of [[1, 1, [255, 0, 0, 255]], [12, 2, [0, 255, 0, 255]], [2, 6, [0, 0, 255, 255]]] as const) {
    expect(paletteEntry(out, palette, pixel(x, y))).toEqual([...want]);
  }
  expect(paletteEntry(out, palette, pixel(12, 6))[3]).toBe(0);
});

test("C4: two indices to a byte, and never more colours than the format holds", () => {
  const { data, tex, palette, brres } = indexed(8, 8, 8, 16);
  const rgba = new Uint8Array(8 * 8 * 4);
  for (let i = 0; i < 64; i++) rgba.set([i * 4, 255 - i * 4, i, 255], i * 4);
  const out = replaceIndexedTexture(data, brres, tex, rgba);
  // The first byte holds the first two pixels, high nibble first.
  const first = out[tex.dataOffset];
  const a = paletteEntry(out, palette, first >> 4), b = paletteEntry(out, palette, first & 15);
  expect(Math.abs(a[0] - 0)).toBeLessThan(48);
  expect(Math.abs(b[1] - 251)).toBeLessThan(48);
  // Nothing was written past the 8x8 block, whose 32 bytes hold everything.
  expect(out.slice(tex.dataOffset + 32, tex.dataOffset + 64).every((v) => v === 0)).toBe(true);
});

test("a palette other textures share keeps its colours", () => {
  const { data, tex, palette, brres } = indexed(9, 8, 4, 8, "other");
  for (let i = 0; i < 8; i++) { data[palette.dataOffset + i * 2] = 0x80 + i; data[palette.dataOffset + i * 2 + 1] = 0x10 + i; }
  const rgba = new Uint8Array(8 * 4 * 4);
  for (let i = 0; i < 32; i++) rgba.set([24, 231, 0, 255], i * 4); // nearest to entry 8 of [i*3, 255-i*3]: clamped to entry 7
  const out = replaceIndexedTexture(data, brres, tex, rgba);
  expect(out.slice(palette.dataOffset, palette.dataOffset + 16)).toEqual(data.slice(palette.dataOffset, palette.dataOffset + 16));
  expect(out[tex.dataOffset]).toBe(7);
});
