import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { prepareBundledTools } from "../src/bundled-tools.ts";
import { changeBRRESResources } from "../src/brres-resources.ts";
import { buildGeneratedTrackModels } from "../src/generated-track-models.ts";
import { decodeTextureAt, DIRECT_FORMATS, parseBRRES, TEXTURE_FORMATS, textureRGBA, writeTEX0 } from "../web/js/formats/brres.js";
import { findFile, parseU8 } from "../web/js/formats/u8.js";

// A colour gradient with soft alpha, 32 × 16.
const W = 32, H = 16;
const image = new Uint8Array(W * H * 4).map((_, i) => { const p = i >> 2, x = p % W, y = Math.floor(p / W), c = i & 3; return c === 0 ? x * 8 : c === 1 ? y * 16 : c === 2 ? 255 - x * 8 : 128 + y * 8; });
// How close each format can come: grey formats keep luminance, CMPR is lossy, RGB565 has no alpha.
const tolerance: Record<number, number> = { 0: 255, 1: 255, 2: 255, 3: 255, 4: 12, 5: 40, 6: 0, 14: 80 };

test("TEX0 is written in every direct format, with mipmaps, and decodes to the picture", () => {
  for (const format of DIRECT_FORMATS) {
    const tex = writeTEX0("Test", image, W, H, format, 3);
    const v = new DataView(tex.buffer);
    expect([v.getUint16(0x1C), v.getUint16(0x1E), v.getUint32(0x20), v.getUint32(0x24)]).toEqual([W, H, format, 3]);
    const back = decodeTextureAt(tex, 0x40, W, H, format);
    let worst = 0;
    for (let i = 0; i < image.length; i++) {
      if ((format === 4 || format === 14) && (i & 3) === 3) continue; // no alpha, or 1-bit alpha
      worst = Math.max(worst, Math.abs(back[i] - image[i]));
    }
    expect({ format: TEXTURE_FORMATS[format], ok: worst <= tolerance[format] }).toEqual({ format: TEXTURE_FORMATS[format], ok: true });
  }
  expect(() => writeTEX0("Bad", image, W, H, 9)).toThrow();
});

test.skipIf(process.platform !== "win32")("a texture of another format and size replaces the old one in a BRRES", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mkwii-tex-test-"));
  const old = { a: process.env.MKWII_ABMATT, w: process.env.MKWII_WSZST, p: process.env.PATH };
  try {
    await prepareBundledTools(dir);
    const base = findFile(parseU8(await buildGeneratedTrackModels({ materials: { road: { color: [1, 0, 0] } }, tris: [
      { mat: "road", v: [0, 0, 0, 1000, 0, 0, 0, 0, 1000], uv: [0, 0, 1, 0, 0, 1] }] })), "course_model.brres")!.data;
    const name = [...parseBRRES(base).textures.keys()][0];
    const after = parseBRRES(await changeBRRESResources(base, [{ folder: "Textures(NW4R)", name, data: writeTEX0(name, image, W, H, 6, 1) }]));
    const tex = after.textures.get(name)!;
    expect([tex.width, tex.height, tex.format]).toEqual([W, H, 6]);
    expect([...textureRGBA(after, tex).slice(0, 8)]).toEqual([...image.slice(0, 8)]);
    expect(after.models[0].materials[0].layers[0].texture).toBe(name);
  } finally {
    for (const [key, value] of [["MKWII_ABMATT", old.a], ["MKWII_WSZST", old.w], ["PATH", old.p]] as const) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    if (resolve(dir).startsWith(resolve(tmpdir()) + sep)) await rm(dir, { recursive: true, force: true });
  }
}, 120000);
