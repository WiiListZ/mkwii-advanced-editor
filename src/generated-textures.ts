import { deflateSync } from "node:zlib";
import { crc32 } from "../web/js/formats/pulsar.js";

export type Surface = "asphalt" | "grass" | "curb" | "barrier" | "stone" | "checker" | "boost" | "sky" | "dirt" | "sand" | "snow";
const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
const hash = (x: number, y: number) => {
  let n = Math.imul(x + 91, 374761393) ^ Math.imul(y + 157, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
};
const noise = (x: number, y: number, cells: number) => {
  const X = x * cells / 256, Y = y * cells / 256, ix = Math.floor(X), iy = Math.floor(Y);
  const fx = X - ix, fy = Y - iy, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(ix % cells, iy % cells), b = hash((ix + 1) % cells, iy % cells);
  const c = hash(ix % cells, (iy + 1) % cells), d = hash((ix + 1) % cells, (iy + 1) % cells);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
};

// Original, deterministic tiles keep new-track creation fully offline even
// when the person's original game textures are unavailable.
export function generatedSurface(surface: Surface) {
  const width = surface === "sky" ? 512 : 256, height = 256;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const grain = hash(x, y), coarse = noise(x % 256, y, 16), broad = noise(x % 256, y, 4);
    let color: number[];
    if (surface === "asphalt") {
      const grit = (grain - .5) * 22 + (coarse - .5) * 12 + (broad - .5) * 8;
      const fleck = grain > .985 ? 25 : grain < .025 ? -17 : 0;
      color = [66 + grit + fleck, 68 + grit + fleck, 70 + grit + fleck];
      if (x < 3 || x > 252 || (Math.abs(x - 128) < 2 && y < 136)) color = [217 + grit * .3, 216 + grit * .3, 204 + grit * .3];
    } else if (surface === "grass") {
      const blade = (hash(Math.floor(x / 2), Math.floor(y / 7)) - .5) * 28;
      const variation = (coarse - .5) * 38 + (broad - .5) * 24 + (grain - .5) * 18 + blade;
      color = [65 + variation * .7, 113 + variation, 35 + variation * .5];
    } else if (surface === "dirt") {
      const shade = (grain - .5) * 27 + (coarse - .5) * 32 + (broad - .5) * 24;
      const pebble = grain > .97 ? 29 : 0;
      color = [127 + shade + pebble, 84 + shade * .8 + pebble, 45 + shade * .5 + pebble];
    } else if (surface === "sand") {
      const ripple = Math.sin(y * .18 + noise(x, y, 4) * 7) * 7;
      const shade = ripple + (grain - .5) * 19 + (coarse - .5) * 17;
      color = [207 + shade, 177 + shade * .9, 121 + shade * .7];
    } else if (surface === "snow") {
      const shade = (grain - .5) * 12 + (coarse - .5) * 16 + (broad - .5) * 10;
      color = [222 + shade, 233 + shade, 243 + shade];
    } else if (surface === "stone") {
      const row = Math.floor(y / 48), jointY = y % 48 < 3;
      const jointX = (x + (row % 2) * 48) % 96 < 3;
      const shade = (grain - .5) * 20 + (coarse - .5) * 22 + (broad - .5) * 12;
      color = jointY || jointX ? [67 + shade, 62 + shade, 54 + shade] : [125 + shade, 115 + shade, 95 + shade];
    } else if (surface === "barrier") {
      const seam = x % 128 < 3 || y % 128 < 3, shade = (grain - .5) * 16 + (coarse - .5) * 14;
      const bolt = Math.hypot(x % 128 - 12, y % 128 - 12) < 3;
      color = seam || bolt ? [72, 76, 78] : [179 + shade, 180 + shade, 174 + shade];
    } else if (surface === "sky") {
      const t = y / (height - 1), cloud = Math.max(0, noise(x / 2, y, 8) - .53) * 100 * Math.sin(Math.PI * t);
      color = [71 + t * 103 + cloud, 146 + t * 62 + cloud, 217 + t * 16 + cloud * .5];
    } else {
      const wear = (grain - .5) * 14 + (coarse - .5) * 9;
      if (surface === "curb") color = y < 128 ? [191 + wear, 40 + wear, 34 + wear] : [231 + wear, 227 + wear, 210 + wear];
      else if (surface === "checker") {
        const value = ((x >> 5) + (y >> 5)) % 2 ? 34 : 235;
        color = [value + wear, value + wear, value + wear];
      } else {
        const chevron = ((y + Math.abs(x - 128) * .8) % 110) < 35;
        color = chevron ? [255, 232, 98] : [231 + wear, 113 + wear, 17 + wear];
      }
    }
    const at = (y * width + x) * 4;
    rgba[at] = clamp(color[0]); rgba[at + 1] = clamp(color[1]); rgba[at + 2] = clamp(color[2]); rgba[at + 3] = 255;
  }
  return { width, height, rgba };
}

export function rgbaPNG(width: number, height: number, rgba: Uint8Array) {
  if (rgba.length !== width * height * 4) throw new Error("Invalid generated texture pixels");
  const chunk = (name: string, data: Uint8Array) => {
    const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length); out.write(name, 4); out.set(data, 8);
    out.writeUInt32BE(crc32(out.subarray(4, out.length - 4)), out.length - 4); return out;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) scanlines.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(scanlines)), chunk("IEND", new Uint8Array())]);
}
