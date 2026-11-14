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

// ---- TEV stages ------------------------------------------------------------------------------
// An MDL0 shader is 0x200 bytes: a 0x20 header (stage count at 0x0C), the swap tables and the
// indirect order, then eight blocks of 0x30 bytes from 0x80, one per pair of stages, with a slot
// for every register write (unused slots are zero, which the GPU skips). So stages can be changed,
// added (up to 16) or removed in place. Checked on every material of the game's tracks.
const SLOT = { mask: 0x00, ksel: 0x05, order: 0x0A, colorEven: 0x0F, colorOdd: 0x14, alphaEven: 0x19, alphaOdd: 0x1E, indEven: 0x23, indOdd: 0x28 };
const put = (out, at, reg, value) => { out[at] = 0x61; out[at + 1] = reg; out[at + 2] = (value >> 16) & 255; out[at + 3] = (value >> 8) & 255; out[at + 4] = value & 255; };
const clear = (out, at) => out.fill(0, at, at + 5);
const field = (value, max) => { if (!Number.isInteger(value) || value < 0 || value > max) throw new Error('Invalid TEV stage value'); return value; };
export const encodeTevColor = (c) => (field(c.d, 15) | field(c.c, 15) << 4 | field(c.b, 15) << 8 | field(c.a, 15) << 12 | field(c.bias, 3) << 16 | field(c.sub, 1) << 18 | field(c.clamp, 1) << 19 | field(c.scale, 3) << 20 | field(c.dest, 3) << 22) >>> 0;
export const encodeTevAlpha = (a) => (field(a.rswap, 3) | field(a.tswap, 3) << 2 | field(a.d, 7) << 4 | field(a.c, 7) << 7 | field(a.b, 7) << 10 | field(a.a, 7) << 13 | field(a.bias, 3) << 16 | field(a.sub, 1) << 18 | field(a.clamp, 1) << 19 | field(a.scale, 3) << 20 | field(a.dest, 3) << 22) >>> 0;
const encodeOrder = (s) => field(s.texMap, 7) | field(s.texCoord, 7) << 3 | (s.texEnabled ? 1 : 0) << 6 | field(s.channel, 7) << 7;

// The materials that use a material's shader: they all change with it.
export function materialsSharingShader(data, modelName, materialName) {
  const model = parseBRRES(data).models.find((m) => m.name === modelName);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const shaderOf = (m) => m.offset + view.getInt32(m.offset + 0x28);
  const material = model?.materials.find((m) => m.name === materialName);
  if (!material) return [];
  return model.materials.filter((m) => shaderOf(m) === shaderOf(material)).map((m) => m.name);
}

// stages: what parseGXMaterial gives (texMap, texCoord, texEnabled, channel, color, alpha, kcsel,
// kasel, indirect), 1 to 16 of them.
export function setBRRESTevStages(data, modelName, materialName, stages) {
  if (!Array.isArray(stages) || stages.length < 1 || stages.length > 16) throw new Error('A material needs 1 to 16 TEV stages');
  const out = data.slice(), view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const model = parseBRRES(data).models.find((m) => m.name === modelName);
  const material = model?.materials.find((m) => m.name === materialName);
  if (!material) throw new Error(`Material ${materialName} not found`);
  const o = material.offset, shader = o + view.getInt32(o + 0x28);
  if (shader === o || view.getUint32(shader) !== 0x200) throw new Error('This material has no standard shader block to edit');
  for (let pair = 0; pair < 8; pair++) {
    const base = shader + 0x80 + pair * 0x30, even = stages[pair * 2], odd = stages[pair * 2 + 1];
    if (!even) { out.fill(0, base, base + 0x30); continue; }
    // The konst selections share their register with the swap tables (the mask keeps those bits).
    const old = (out[base + SLOT.ksel] === 0x61) ? (out[base + SLOT.ksel + 2] << 16) | (out[base + SLOT.ksel + 3] << 8) | out[base + SLOT.ksel + 4] : 0;
    const ksel = (old & 0xF) | field(even.kcsel, 31) << 4 | field(even.kasel, 31) << 9 | (odd ? field(odd.kcsel, 31) << 14 | field(odd.kasel, 31) << 19 : 0);
    put(out, base + SLOT.mask, 0xFE, 0xFFFFF0);
    put(out, base + SLOT.ksel, 0xF6 + pair, ksel >>> 0);
    // A pair without its second stage has it as 'none' (texture map and coordinate 7, channel 7), as Nintendo's files do.
    put(out, base + SLOT.order, 0x28 + pair, (encodeOrder(even) | (odd ? encodeOrder(odd) : 0x3BF) << 12) >>> 0);
    put(out, base + SLOT.colorEven, 0xC0 + pair * 4, encodeTevColor(even.color));
    put(out, base + SLOT.alphaEven, 0xC1 + pair * 4, encodeTevAlpha(even.alpha));
    put(out, base + SLOT.indEven, 0x10 + pair * 2, (even.indirect ?? 0) >>> 0);
    if (odd) {
      put(out, base + SLOT.colorOdd, 0xC2 + pair * 4, encodeTevColor(odd.color));
      put(out, base + SLOT.alphaOdd, 0xC3 + pair * 4, encodeTevAlpha(odd.alpha));
      put(out, base + SLOT.indOdd, 0x11 + pair * 2, (odd.indirect ?? 0) >>> 0);
    } else for (const slot of [SLOT.colorOdd, SLOT.alphaOdd, SLOT.indOdd]) clear(out, base + slot);
  }
  out[shader + 0x0C] = stages.length;
  // Every material using this shader draws with its stage count.
  for (const m of model.materials) if (m.offset + view.getInt32(m.offset + 0x28) === shader) out[m.offset + 0x16] = stages.length;
  return out;
}
