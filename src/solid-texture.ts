import { deflateSync } from "node:zlib";
import { crc32 } from "../web/js/formats/pulsar.js";

// An 8 × 8 diffuse image lets ABMatt retain OBJ Kd colours, which its material
// importer otherwise discards. It also works without a source UV map.
export function solidTexturePNG(color: number[]) {
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(data.length + 12), view = new DataView(out.buffer);
    view.setUint32(0, data.length); out.set(new TextEncoder().encode(type), 4); out.set(data, 8);
    view.setUint32(out.length - 4, crc32(out.subarray(4, out.length - 4)));
    return out;
  };
  const header = new Uint8Array(13), view = new DataView(header.buffer);
  view.setUint32(0, 8); view.setUint32(4, 8); header[8] = 8; header[9] = 6;
  const pixels = new Uint8Array(8 * (1 + 8 * 4));
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) for (let c = 0; c < 4; c++) {
    pixels[y * 33 + 1 + x * 4 + c] = Math.round(Math.max(0, Math.min(1, color[c] ?? 1)) * 255);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", new Uint8Array())]);
}
