// Writers of the NW4R animations an editor can change keyframe by keyframe: CHR0 (bones), SRT0
// (texture matrices), CLR0 (material colours) and VIS0 (bone visibility), plus the VIS0 reader.
// Each takes what parseBRRES gives (tracks are { const }, { keys: [{ f, v, t }] } or { linear })
// and writes a complete resource with its own names; keyframes are written as floats (I12).
import { aligned, groupSize, isConst, constValue, keysSize, StringPool, trackKeys, writeGroup, writeKeys, bytes } from './nw4r.js';

const finish = (cursor) => new Uint8Array(aligned(cursor, 32));
const header = (out, magic, version) => {
  const v = new DataView(out.buffer);
  out.set(bytes(magic)); v.setUint32(4, out.length); v.setUint32(8, version);
  return v;
};
const sameTrack = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- CHR0 ------------------------------------------------------------------------------------
// Bone entry code: bit 0 always; 1 identity; 2 rotation and translation zero; 3 scale one; 4-6
// scale/rotation/translation the same on every axis; 7-12 model and compensation options (kept);
// 13-21 fixed X/Y/Z of scale, rotation, translation; 22-24 has scale/rotation/translation;
// 25-26, 27-29, 30-31 keyframe formats (3 = I12).
export function writeCHR0(anim) {
  const frames = anim.frames | 0;
  if (frames < 1 || frames > 65535) throw new Error('A CHR0 needs 1 to 65535 frames');
  const names = new StringPool(), bones = [...anim.bones];
  names.add(anim.name); bones.forEach(([name]) => names.add(name));
  const plan = bones.map(([name, bone]) => {
    let code = ((bone.code ?? 1) & 0x1F81) | 1; // keep bit 0 and the model/compensation options
    const values = [];
    const comp = (tracks, isoBit, fixedBit, hasBit, fmtShift) => {
      if (!tracks) return;
      code |= 1 << hasBit; code |= 3 << fmtShift;
      const iso = tracks.every((t) => sameTrack(t, tracks[0]));
      if (iso) code |= 1 << isoBit;
      (iso ? [tracks[0]] : tracks).forEach((t, i) => {
        const fixed = isConst(t);
        if (fixed) code |= 1 << (fixedBit + i);
        values.push(fixed ? { fixed: constValue(t, 0) } : { keys: trackKeys(t) });
      });
    };
    comp(bone.scale, 4, 13, 22, 25); comp(bone.rot, 5, 16, 23, 27); comp(bone.trans, 6, 19, 24, 30);
    if (!bone.scale) code |= 0x8;
    if (!bone.rot && !bone.trans) code |= 0x4;
    if (!bone.scale && !bone.rot && !bone.trans) code |= 0x2;
    return { name, code: code >>> 0, values };
  });
  const group = 0x2C;
  let cursor = group + groupSize(plan.length);
  for (const p of plan) { p.at = cursor; cursor += 8 + p.values.length * 4; }
  for (const p of plan) for (const value of p.values) if (value.keys) { value.at = cursor; cursor += keysSize(value.keys); }
  cursor = names.layout(cursor);
  const out = finish(cursor), v = header(out, 'CHR0', 5);
  v.setInt32(0x10, group); v.setInt32(0x18, names.at(anim.name));
  v.setUint16(0x20, frames); v.setUint16(0x22, plan.length); v.setUint32(0x24, anim.loop ? 1 : 0); v.setUint32(0x28, anim.scalingRule ?? 0);
  writeGroup(v, group, plan.map((p) => ({ name: p.name, offset: p.at })), (n) => names.at(n));
  for (const p of plan) {
    v.setInt32(p.at, names.at(p.name) - p.at); v.setUint32(p.at + 4, p.code);
    p.values.forEach((value, i) => {
      const field = p.at + 8 + i * 4;
      if (value.keys) { v.setInt32(field, value.at - p.at); writeKeys(v, value.at, value.keys); }
      else v.setFloat32(field, value.fixed);
    });
  }
  names.write(out);
  return out;
}

// ---- SRT0 ------------------------------------------------------------------------------------
// Texture entry code: bit 0 always; 1 scale one; 2 rotation zero; 3 translation zero; 4 scale the
// same on both axes; 5-6 fixed scale X/Y; 7 fixed rotation; 8-9 fixed translation X/Y. Keyframe
// offsets are relative to the offset field itself.
export function writeSRT0(anim) {
  const frames = anim.frames | 0;
  if (frames < 1 || frames > 65535) throw new Error('An SRT0 needs 1 to 65535 frames');
  const names = new StringPool(), materials = [...anim.materials];
  names.add(anim.name); materials.forEach(([name]) => names.add(name));
  const plan = materials.map(([name, textures]) => ({ name, textures: [...textures].sort((a, b) => a.index - b.index).map((tex) => {
    if (tex.index < 0 || tex.index > 10) throw new Error('Invalid texture matrix');
    let code = 1;
    const values = [];
    const add = (t, fixedBit) => { const fixed = isConst(t); if (fixed) code |= 1 << fixedBit; values.push(fixed ? { fixed: constValue(t, 0) } : { keys: trackKeys(t) }); };
    if (!tex.scale) code |= 0x2;
    else if (sameTrack(tex.scale[0], tex.scale[1])) { code |= 0x10; add(tex.scale[0], 5); if (code & 0x20) code |= 0x40; }
    else { add(tex.scale[0], 5); add(tex.scale[1], 6); }
    if (!tex.rot) code |= 0x4; else add(tex.rot, 7);
    if (!tex.trans) code |= 0x8; else { add(tex.trans[0], 8); add(tex.trans[1], 9); }
    return { index: tex.index, code, values };
  }) }));
  const group = 0x2C;
  let cursor = group + groupSize(plan.length);
  for (const p of plan) { p.at = cursor; cursor += 12 + p.textures.length * 4; }
  for (const p of plan) for (const tex of p.textures) { tex.at = cursor; cursor += 4 + tex.values.length * 4; }
  for (const p of plan) for (const tex of p.textures) for (const value of tex.values) if (value.keys) { value.at = cursor; cursor += keysSize(value.keys); }
  cursor = names.layout(cursor);
  const out = finish(cursor), v = header(out, 'SRT0', 5);
  v.setInt32(0x10, group); v.setInt32(0x18, names.at(anim.name));
  v.setUint16(0x20, frames); v.setUint16(0x22, plan.length); v.setUint32(0x24, anim.texMtxMode ?? 0); v.setUint32(0x28, anim.loop ? 1 : 0);
  writeGroup(v, group, plan.map((p) => ({ name: p.name, offset: p.at })), (n) => names.at(n));
  for (const p of plan) {
    let tex = 0, ind = 0;
    for (const t of p.textures) { if (t.index < 8) tex |= 1 << t.index; else ind |= 1 << (t.index - 8); }
    v.setInt32(p.at, names.at(p.name) - p.at); v.setUint32(p.at + 4, tex); v.setUint32(p.at + 8, ind);
    p.textures.forEach((t, i) => {
      v.setInt32(p.at + 12 + i * 4, t.at - p.at);
      v.setUint32(t.at, t.code);
      t.values.forEach((value, k) => {
        const field = t.at + 4 + k * 4;
        if (value.keys) { v.setInt32(field, value.at - field); writeKeys(v, value.at, value.keys); }
        else v.setFloat32(field, value.fixed);
      });
    });
  }
  names.write(out);
  return out;
}

// ---- CLR0 ------------------------------------------------------------------------------------
// Two flag bits per target register (0-1 material colour, 2-3 ambient, 4-6 TEV colour, 7-10
// konst): exists, constant. Each target has a mask (bits left as they are) and one colour or an
// offset, relative to the offset field, to a colour for every frame.
const word = (rgba) => rgba.reduce((w, c) => ((w << 8) | Math.max(0, Math.min(255, Math.round(c * 255)))) >>> 0, 0);
export function writeCLR0(anim) {
  const frames = anim.frames | 0;
  if (frames < 1 || frames > 65535) throw new Error('A CLR0 needs 1 to 65535 frames');
  const names = new StringPool(), materials = [...anim.materials];
  names.add(anim.name); materials.forEach(([name]) => names.add(name));
  const plan = materials.map(([name, targets]) => ({ name, targets: [...targets].sort((a, b) => a.target - b.target).map((t) => {
    if (t.target < 0 || t.target > 10) throw new Error('Invalid CLR0 target');
    const colors = t.colors.map(word), constant = colors.every((c) => c === colors[0]);
    const mask = t.mask ?? (t.keep ? t.keep.reduce((m, keep, i) => keep ? (m | (0xFF << (24 - i * 8))) >>> 0 : m, 0) : 0);
    return { target: t.target, mask, colors: constant ? [colors[0]] : Array.from({ length: frames + 1 }, (_, f) => colors[Math.min(f, colors.length - 1)]), constant };
  }) }));
  const group = 0x28;
  let cursor = group + groupSize(plan.length);
  for (const p of plan) { p.at = cursor; cursor += 8 + p.targets.length * 8; }
  for (const p of plan) for (const t of p.targets) if (!t.constant) { t.table = cursor; cursor += t.colors.length * 4; }
  cursor = names.layout(cursor);
  const out = finish(cursor), v = header(out, 'CLR0', 4);
  v.setInt32(0x10, group); v.setInt32(0x18, names.at(anim.name));
  v.setUint16(0x20, frames); v.setUint16(0x22, plan.length); v.setUint32(0x24, anim.loop ? 1 : 0);
  writeGroup(v, group, plan.map((p) => ({ name: p.name, offset: p.at })), (n) => names.at(n));
  for (const p of plan) {
    let flags = 0;
    for (const t of p.targets) flags = (flags | ((1 | (t.constant ? 2 : 0)) << (t.target * 2))) >>> 0;
    v.setInt32(p.at, names.at(p.name) - p.at); v.setUint32(p.at + 4, flags);
    p.targets.forEach((t, i) => {
      const at = p.at + 8 + i * 8;
      v.setUint32(at, t.mask);
      if (t.constant) v.setUint32(at + 4, t.colors[0]);
      else { v.setInt32(at + 4, t.table - (at + 4)); t.colors.forEach((c, f) => v.setUint32(t.table + f * 4, c)); }
    });
  }
  names.write(out);
  return out;
}

// ---- VIS0 ------------------------------------------------------------------------------------
// Bone visibility: per bone a flag word (bit 0 shown when constant, bit 1 constant) and, when not
// constant, one bit per frame, highest bit first, in 32-bit words.
export function readVIS0(data, offset = 0, name = '') {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const string = (at) => { let end = at; while (data[end]) end++; return new TextDecoder().decode(data.subarray(at, end)); };
  const version = v.getUint32(offset + 8), base = offset + (version >= 4 ? 0x20 : 0x1C);
  const frames = v.getUint16(base), loop = v.getUint32(base + 4) !== 0;
  const group = offset + v.getInt32(offset + 0x10), bones = new Map();
  for (let i = 0; i < v.getUint32(group + 4); i++) {
    const entry = group + 24 + i * 16, at = group + v.getInt32(entry + 12), flags = v.getUint32(at + 4);
    const shown = (flags & 2) ? Array(frames + 1).fill(!!(flags & 1))
      : Array.from({ length: frames + 1 }, (_, f) => !!((v.getUint32(at + 8 + (f >> 5) * 4) >>> (31 - (f & 31))) & 1));
    bones.set(string(group + v.getInt32(entry + 8)), shown);
  }
  return { name: name || string(offset + v.getInt32(offset + (version >= 4 ? 0x18 : 0x14))), frames, loop, bones, version };
}

export function writeVIS0(anim) {
  const frames = anim.frames | 0;
  if (frames < 1 || frames > 65535) throw new Error('A VIS0 needs 1 to 65535 frames');
  const names = new StringPool(), bones = [...anim.bones];
  names.add(anim.name); bones.forEach(([name]) => names.add(name));
  const words = Math.ceil((frames + 1) / 32);
  const plan = bones.map(([name, shown]) => {
    const list = Array.from({ length: frames + 1 }, (_, f) => !!shown[Math.min(f, shown.length - 1)]);
    return { name, list, constant: list.every((s) => s === list[0]) };
  });
  const group = 0x28;
  let cursor = group + groupSize(plan.length);
  for (const p of plan) { p.at = cursor; cursor += 8 + (p.constant ? 0 : words * 4); }
  cursor = names.layout(cursor);
  const out = finish(cursor), v = header(out, 'VIS0', 4);
  v.setInt32(0x10, group); v.setInt32(0x18, names.at(anim.name));
  v.setUint16(0x20, frames); v.setUint16(0x22, plan.length); v.setUint32(0x24, anim.loop ? 1 : 0);
  writeGroup(v, group, plan.map((p) => ({ name: p.name, offset: p.at })), (n) => names.at(n));
  for (const p of plan) {
    v.setInt32(p.at, names.at(p.name) - p.at);
    v.setUint32(p.at + 4, p.constant ? (2 | (p.list[0] ? 1 : 0)) : 0);
    if (!p.constant) for (let w = 0; w < words; w++) {
      let bits = 0;
      for (let b = 0; b < 32; b++) if (p.list[w * 32 + b]) bits |= 1 << (31 - b);
      v.setUint32(p.at + 8 + w * 4, bits >>> 0);
    }
  }
  names.write(out);
  return out;
}
