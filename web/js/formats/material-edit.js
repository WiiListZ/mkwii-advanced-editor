// Changes MDL0 material settings in place. Every value lives in a fixed-size field or a register
// write of the material's display lists, so nothing in the file moves. Values come back through
// parseBRRES, which reads the same registers to draw the material.

import { parseBRRES } from './brres.js';

const BLEND = 0x41, ZMODE = 0x40, ALPHA = 0xF3, MASK = 0xFE;

// Every BP write of a material's display lists, with where its 24-bit value is stored.
function bpWrites(data, material, version) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength), o = material.offset;
  const lists = [];
  const dl = view.getInt32(o + 0x3C), shader = view.getInt32(o + 0x28);
  if (dl) lists.push([o + dl, o + dl + 0x180]);
  if (shader) {
    const size = view.getUint32(o + shader);
    if (size >= 0x20 && size <= 0x1000) lists.push([o + shader + 0x20, o + shader + size]);
  }
  const writes = [];
  for (const [start, end] of lists) {
    let p = start, mask = 0xFFFFFF;
    while (p < end) {
      const op = data[p];
      if (op === 0) { p++; continue; }
      if (op === 0x61) {
        if (p + 5 > end) break;
        const reg = data[p + 1], value = (data[p + 2] << 16) | (data[p + 3] << 8) | data[p + 4];
        if (reg === MASK) mask = value;
        else { writes.push({ reg, at: p + 2, value, mask }); mask = 0xFFFFFF; }
        p += 5;
      } else if (op === 0x10) {
        if (p + 5 > end) break;
        p += 5 + (view.getUint16(p + 1) + 1) * 4;
      } else if (op === 0x08) p += 6;
      else break;
    }
  }
  void version;
  return writes;
}

function setBits(data, writes, reg, shift, count, value, filter = () => true) {
  const list = writes.filter((w) => w.reg === reg && filter(w));
  if (!list.length) throw new Error(`This material does not store register 0x${reg.toString(16)}`);
  const field = ((1 << count) - 1) << shift;
  for (const write of list) {
    if ((write.mask & field) !== field) continue;
    write.value = (write.value & ~field) | ((value << shift) & field);
    data[write.at] = (write.value >> 16) & 255; data[write.at + 1] = (write.value >> 8) & 255; data[write.at + 2] = write.value & 255;
  }
}

const isKonst = (w) => !!(w.value & 0x800000);

function setColorRegister(data, writes, index, rgba, konst) {
  const filter = (w) => isKonst(w) === konst;
  const clampByte = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const [r, g, b, a] = rgba.map(clampByte);
  if (!writes.some((w) => w.reg === 0xE0 + index * 2 && filter(w))) throw new Error(`This material does not store colour ${index}`);
  setBits(data, writes, 0xE0 + index * 2, 0, 11, r, filter);
  setBits(data, writes, 0xE0 + index * 2, 12, 11, a, filter);
  setBits(data, writes, 0xE1 + index * 2, 0, 11, b, filter);
  setBits(data, writes, 0xE1 + index * 2, 12, 11, g, filter);
}

export const CULL_MODES = [[0, 'Both sides'], [2, 'Front only'], [1, 'Back only'], [3, 'Hidden']];
export const BLEND_FACTORS = [[0, 'Zero'], [1, 'One'], [2, 'Source colour'], [3, 'Inverse source colour'], [4, 'Source alpha'], [5, 'Inverse source alpha'], [6, 'Target alpha'], [7, 'Inverse target alpha']];

const chanBase = (o, version) => o + (version >= 10 ? 0x1A8 : 0x1A0) + 8 + 8 * 20 + 8 * 52;

// patch: cull, translucent, blend { enabled, src, dst }, alpha { ref, comp }, depthWrite, depthTest,
// color: [{ index, rgba, konst }], channel: [{ index, rgba }].
export function setBRRESMaterial(data, modelName, materialName, patch) {
  const out = data.slice(), view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const model = parseBRRES(data).models.find((m) => m.name === modelName);
  const material = model?.materials.find((m) => m.name === materialName);
  if (!material) throw new Error(`Material ${materialName} not found`);
  const writes = bpWrites(out, material, model.version);
  if (patch.cull !== undefined) {
    if (![0, 1, 2, 3].includes(patch.cull)) throw new Error('Invalid culling');
    view.setUint32(material.offset + 0x18, patch.cull);
  }
  if (patch.translucent !== undefined) {
    const flags = view.getUint32(material.offset + 0x10);
    view.setUint32(material.offset + 0x10, patch.translucent ? (flags | 0x80000000) >>> 0 : (flags & 0x7FFFFFFF) >>> 0);
  }
  if (patch.blend) {
    if (patch.blend.enabled !== undefined) setBits(out, writes, BLEND, 0, 1, patch.blend.enabled ? 1 : 0);
    if (patch.blend.dst !== undefined) setBits(out, writes, BLEND, 5, 3, patch.blend.dst);
    if (patch.blend.src !== undefined) setBits(out, writes, BLEND, 8, 3, patch.blend.src);
  }
  if (patch.alpha) {
    if (patch.alpha.ref !== undefined) setBits(out, writes, ALPHA, 0, 8, Math.max(0, Math.min(255, Math.round(patch.alpha.ref))));
    if (patch.alpha.comp !== undefined) setBits(out, writes, ALPHA, 16, 3, patch.alpha.comp);
  }
  if (patch.depthWrite !== undefined) setBits(out, writes, ZMODE, 4, 1, patch.depthWrite ? 1 : 0);
  if (patch.depthTest !== undefined) setBits(out, writes, ZMODE, 0, 1, patch.depthTest ? 1 : 0);
  for (const { index, rgba, konst = false } of patch.color || []) setColorRegister(out, writes, index, rgba, konst);
  for (const { index, rgba } of patch.channel || []) {
    const at = chanBase(material.offset, model.version) + index * 0x14 + 4;
    rgba.forEach((value, c) => { out[at + c] = Math.max(0, Math.min(255, Math.round(value))); });
  }
  return out;
}
