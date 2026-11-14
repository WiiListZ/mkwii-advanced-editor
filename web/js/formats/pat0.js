// NW4R texture/palette pattern animations, including all eight texture slots.
import { dictionary } from './nw4r.js';
const bytes = (s) => new TextEncoder().encode(s);
const aligned = (n) => Math.ceil(n / 4) * 4;

export function readPAT0(data, offset = 0, name = '') {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const string = (at) => {
    if (at < 0 || at >= data.length) throw new Error('Invalid PAT0 string');
    let end = at; while (end < data.length && data[end]) end++;
    return new TextDecoder().decode(data.subarray(at, end));
  };
  const base = offset + (v.getUint32(offset + 8) >= 4 ? 0x28 : 0x24);
  const names = (pointer, count) => {
    const table = offset + v.getInt32(offset + pointer);
    return Array.from({ length: count }, (_, i) => string(table + v.getInt32(table + i * 4)));
  };
  const textures = names(0x14, v.getUint16(base + 12)), palettes = names(0x18, v.getUint16(base + 14));
  const materials = new Map(), group = offset + v.getInt32(offset + 16);
  for (let i = 0; i < v.getUint32(group + 4); i++) {
    const entry = group + 24 + i * 16, at = group + v.getInt32(entry + 12);
    const flags = v.getUint32(at + 4), slots = [];
    let pointer = at + 8;
    for (let slot = 0; slot < 8; slot++) {
      const f = (flags >>> (slot * 4)) & 15;
      if (!(f & 1)) continue;
      const key = (p, frame) => ({ frame,
        ...(f & 4 ? { texture: textures[v.getUint16(p)] } : {}),
        ...(f & 8 ? { palette: palettes[v.getUint16(p + 2)] } : {}) });
      let keys;
      if (f & 2) keys = [key(pointer, 0)];
      else {
        const track = at + v.getInt32(pointer);
        keys = Array.from({ length: v.getUint16(track) }, (_, k) => key(track + 12 + k * 8, v.getFloat32(track + 8 + k * 8)));
      }
      pointer += 4;
      if (f & 12) slots.push({ index: slot, keys });
    }
    materials.set(string(group + v.getInt32(entry + 8)), slots);
  }
  return { name: name || string(offset + v.getInt32(base)), frames: v.getUint16(base + 8), loop: !!v.getUint32(base + 16), materials };
}

export function writePAT0(animation) {
  const materials = [...animation.materials].map(([name, slots]) => [name, [...slots].sort((a, b) => a.index - b.index)]), textures = [], palettes = [];
  const add = (list, name) => { if (name !== undefined && !list.includes(name)) list.push(name); };
  for (const [, slots] of materials) for (const [i, slot] of slots.entries()) {
    if (slot.index < 0 || slot.index > 7 || !slot.keys.length || slot.keys.length > 65535) throw new Error('Invalid PAT0 slot');
    if (i && slots[i - 1].index === slot.index) throw new Error('Duplicate PAT0 slot');
    for (const [k, key] of slot.keys.entries()) {
      // The game's own patterns repeat frames and start before frame 0 (old_koopa_gba).
      if (!Number.isFinite(key.frame) || (k && key.frame < slot.keys[k - 1].frame)) throw new Error('Invalid PAT0 frame time');
      add(textures, key.texture); add(palettes, key.palette);
    }
  }
  if (!Number.isInteger(animation.frames) || animation.frames < 0 || animation.frames > 65535
    || materials.length > 65535 || textures.length > 65535 || palettes.length > 65535) throw new Error('PAT0 exceeds format limits');
  const group = 0x3c, groupSize = 8 + (materials.length + 1) * 16, headers = [];
  let cursor = group + groupSize;
  for (const [, slots] of materials) { headers.push(cursor); cursor += 8 + slots.length * 4; }
  const tracks = materials.map(([, slots]) => slots.map((slot) => {
    if (slot.keys.length === 1 && slot.keys[0].frame === 0) return 0;
    const at = cursor; cursor += 8 + slot.keys.length * 8; return at;
  }));
  const texTable = cursor; cursor += textures.length * 4;
  const palTable = cursor; cursor += palettes.length * 4;
  const texPointers = cursor; cursor += textures.length * 4;
  const palPointers = cursor; cursor += palettes.length * 4;
  const strings = new Map();
  for (const text of [animation.name, ...materials.map(([name]) => name), ...textures, ...palettes]) {
    if (!text || text.includes('\0')) throw new Error('Invalid PAT0 resource name');
    if (!strings.has(text)) { strings.set(text, cursor + 4); cursor = aligned(cursor + 4 + bytes(text).length + 1); }
  }
  const out = new Uint8Array(Math.ceil(cursor / 32) * 32), v = new DataView(out.buffer);
  out.set(bytes('PAT0')); v.setUint32(4, out.length); v.setUint32(8, 4);
  [group, texTable, palTable, texPointers, palPointers, 0].forEach((at, i) => v.setInt32(16 + i * 4, at));
  v.setInt32(0x28, strings.get(animation.name)); v.setUint16(0x30, animation.frames);
  v.setUint16(0x32, materials.length); v.setUint16(0x34, textures.length); v.setUint16(0x36, palettes.length); v.setUint32(0x38, Number(animation.loop));
  v.setUint32(group, groupSize); v.setUint32(group + 4, materials.length);
  dictionary(materials.map(([name]) => name)).forEach((node, i) => {
    const at = group + 8 + i * 16;
    v.setUint16(at, node.bit); v.setUint16(at + 4, node.left); v.setUint16(at + 6, node.right);
    if (i) { v.setInt32(at + 8, strings.get(materials[i - 1][0]) - group); v.setInt32(at + 12, headers[i - 1] - group); }
  });
  const pair = (at, key) => {
    v.setUint16(at, key.texture === undefined ? 65535 : textures.indexOf(key.texture));
    v.setUint16(at + 2, key.palette === undefined ? 65535 : palettes.indexOf(key.palette));
  };
  materials.forEach(([name, slots], materialIndex) => {
    const at = headers[materialIndex]; v.setInt32(at, strings.get(name) - at);
    let flags = 0;
    slots.forEach((slot, i) => {
      const pointer = at + 8 + i * 4, track = tracks[materialIndex][i];
      const f = 1 | (track ? 0 : 2) | (slot.keys.some((k) => k.texture !== undefined) ? 4 : 0) | (slot.keys.some((k) => k.palette !== undefined) ? 8 : 0);
      flags = (flags | (f << (slot.index * 4))) >>> 0;
      if (!track) pair(pointer, slot.keys[0]);
      else {
        v.setInt32(pointer, track - at); v.setUint16(track, slot.keys.length);
        const span = slot.keys.at(-1).frame - slot.keys[0].frame; v.setFloat32(track + 4, span > 0 ? 1 / span : 0);
        slot.keys.forEach((key, k) => { v.setFloat32(track + 8 + k * 8, key.frame); pair(track + 12 + k * 8, key); });
      }
    });
    v.setUint32(at + 4, flags);
  });
  textures.forEach((text, i) => v.setInt32(texTable + i * 4, strings.get(text) - texTable));
  palettes.forEach((text, i) => v.setInt32(palTable + i * 4, strings.get(text) - palTable));
  for (const [text, at] of strings) { const encoded = bytes(text); v.setUint32(at - 4, encoded.length); out.set(encoded, at); }
  return out;
}
