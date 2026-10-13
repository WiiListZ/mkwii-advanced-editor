// BRFNT bitmap fonts (Scene/UI/Font.szs): glyph sheets, widths and character map, to draw text
// the way the game does in previews.

import { decodeTexture } from './brres.js';

class View {
  constructor(d) { this.d = d; this.v = new DataView(d.buffer, d.byteOffset, d.byteLength); }
  u8(o) { return this.d[o]; }
  s8(o) { return this.v.getInt8(o); }
  u16(o) { return this.v.getUint16(o); }
  s16(o) { return this.v.getInt16(o); }
  u32(o) { return this.v.getUint32(o); }
  s32(o) { return this.v.getInt32(o); }
}

export function parseBRFNT(data) {
  const r = new View(data);
  if (String.fromCharCode(...data.subarray(0, 4)) !== 'RFNT') throw new Error('Not a BRFNT font');
  // Sections start after the 0x10 byte header; the pointers in FINF point 8 bytes into a section.
  const finf = 0x10;
  const lineFeed = r.s8(finf + 9), alterChar = r.u16(finf + 10);
  const defaultWidth = { left: r.s8(finf + 12), glyph: r.u8(finf + 13), advance: r.s8(finf + 14) };
  const tglp = r.u32(finf + 16), cwdh = r.u32(finf + 20), cmap = r.u32(finf + 24);
  const height = r.u8(finf + 28), width = r.u8(finf + 29), ascent = r.u8(finf + 30);
  const cellW = r.u8(tglp), cellH = r.u8(tglp + 1), baseline = r.s8(tglp + 2);
  const sheetSize = r.u32(tglp + 4), sheetCount = r.u16(tglp + 8), format = r.u16(tglp + 10);
  const cols = r.u16(tglp + 12), rows = r.u16(tglp + 14), sheetW = r.u16(tglp + 16), sheetH = r.u16(tglp + 18);
  const sheetData = r.u32(tglp + 20);

  const widths = new Map();
  for (let p = cwdh; p; ) {
    const first = r.u16(p), last = r.u16(p + 2), next = r.u32(p + 4);
    for (let i = first; i <= last; i++) {
      const e = p + 8 + (i - first) * 3;
      widths.set(i, { left: r.s8(e), glyph: r.u8(e + 1), advance: r.s8(e + 2) });
    }
    p = next;
  }
  const chars = new Map();
  for (let p = cmap; p; ) {
    const first = r.u16(p), last = r.u16(p + 2), method = r.u16(p + 4), next = r.u32(p + 8);
    if (method === 0) { const base = r.u16(p + 12); for (let c = first; c <= last; c++) chars.set(c, base + c - first); }
    else if (method === 1) { for (let c = first; c <= last; c++) { const i = r.u16(p + 12 + (c - first) * 2); if (i !== 0xffff) chars.set(c, i); } }
    else { const n = r.u16(p + 12); for (let k = 0; k < n; k++) chars.set(r.u16(p + 14 + k * 4), r.u16(p + 16 + k * 4)); }
    p = next;
  }
  const sheets = [];
  for (let s = 0; s < sheetCount; s++) {
    sheets.push({ width: sheetW, height: sheetH, format, dataOffset: sheetData + s * sheetSize, reader: r });
  }
  return { lineFeed, alterChar, defaultWidth, height, width, ascent, cellW, cellH, baseline, cols, rows, sheets, widths, chars, sheetCache: [] };
}

function sheetCanvas(font, index) {
  if (font.sheetCache[index]) return font.sheetCache[index];
  const tex = font.sheets[index];
  const rgba = decodeTexture(tex);
  // IA sheets: intensity is the fill (white) and its dark border, alpha the coverage. I-only
  // sheets are plain coverage.
  const img = new ImageData(tex.width, tex.height);
  const intensityOnly = tex.format === 0 || tex.format === 1;
  for (let i = 0; i < tex.width * tex.height; i++) {
    const v = intensityOnly ? 255 : rgba[i * 4];
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = intensityOnly ? rgba[i * 4] : rgba[i * 4 + 3];
  }
  const c = document.createElement('canvas');
  c.width = tex.width; c.height = tex.height;
  c.getContext('2d').putImageData(img, 0, 0);
  font.sheetCache[index] = c;
  return c;
}

// Draws text lines with the font; `runs` are [{ text, color }] pieces, "\n" breaks lines.
// Returns the size used. Characters the font lacks use its replacement character.
export function drawText(ctx, font, runs, x, y, { scale = 1, maxWidth = Infinity } = {}) {
  const perSheet = font.cols * font.rows;
  const pitchX = font.cellW + 1, pitchY = font.cellH + 1; // cells have a 1 pixel gap
  let penX = x, penY = y, widest = 0;
  const line = (font.lineFeed || font.height) * scale;
  for (const run of runs) {
    for (const ch of run.text) {
      if (ch === '\n') { widest = Math.max(widest, penX - x); penX = x; penY += line; continue; }
      const code = ch.codePointAt(0);
      const index = font.chars.get(code) ?? font.chars.get(font.alterChar) ?? font.alterChar;
      const w = font.widths.get(index) || font.defaultWidth;
      if (penX - x + w.advance * scale > maxWidth) { widest = Math.max(widest, penX - x); penX = x; penY += line; }
      const sheet = Math.floor(index / perSheet), cell = index % perSheet;
      if (sheet < font.sheets.length && w.glyph > 0) {
        const src = sheetCanvas(font, sheet);
        const sx = (cell % font.cols) * pitchX, sy = Math.floor(cell / font.cols) * pitchY;
        if (run.color && run.color !== '#ffffff') {
          // Tint: draw the white glyph on a scratch canvas and colour it.
          const t = tintCanvas(w.glyph, font.cellH);
          const g = t.getContext('2d');
          g.globalCompositeOperation = 'source-over';
          g.clearRect(0, 0, t.width, t.height);
          g.drawImage(src, sx, sy, w.glyph, font.cellH, 0, 0, w.glyph, font.cellH);
          // Colours the fill and keeps the dark border, then restores the glyph's coverage.
          g.globalCompositeOperation = 'multiply';
          g.fillStyle = run.color;
          g.fillRect(0, 0, w.glyph, font.cellH);
          g.globalCompositeOperation = 'destination-in';
          g.drawImage(src, sx, sy, w.glyph, font.cellH, 0, 0, w.glyph, font.cellH);
          g.globalCompositeOperation = 'source-over';
          ctx.drawImage(t, 0, 0, w.glyph, font.cellH, penX + w.left * scale, penY, w.glyph * scale, font.cellH * scale);
        } else {
          ctx.drawImage(src, sx, sy, w.glyph, font.cellH, penX + w.left * scale, penY, w.glyph * scale, font.cellH * scale);
        }
      }
      penX += w.advance * scale;
    }
  }
  widest = Math.max(widest, penX - x);
  return { width: widest, height: penY - y + line };
}

let tint = null;
function tintCanvas(w, h) {
  if (!tint) tint = document.createElement('canvas');
  if (tint.width < w || tint.height < h) { tint.width = Math.max(tint.width, w); tint.height = Math.max(tint.height, h); }
  return tint;
}
