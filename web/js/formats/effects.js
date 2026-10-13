// Mario Kart Wii particle effects (NW4R, version 9): BREFF (emitters and their particles) and
// BREFT (the textures those particles draw). Both are edited in place: every editable value has a
// fixed size, so offsets inside the files never move.
//
// Both files: 0x10-byte header, then a block ("REFF"/"REFT", size, offset of the entry table from
// 0x18, two reserved words, name). Table: size, entry count, then per entry a length-prefixed name,
// the entry offset (from the table) and its size.

import { decodeTextureAt, encodeTextureLevels, TEXTURE_FORMATS } from './brres.js';

const magic = (d, o = 0) => String.fromCharCode(d[o], d[o + 1], d[o + 2], d[o + 3]);
export const isBREFF = (d) => d?.length > 0x40 && magic(d) === 'REFF';
export const isBREFT = (d) => d?.length > 0x40 && magic(d) === 'REFT';
const view = (d) => new DataView(d.buffer, d.byteOffset, d.byteLength);
const cstr = (d, o, n) => { let s = ''; for (let i = 0; i < n && d[o + i]; i++) s += String.fromCharCode(d[o + i]); return s; };

function entries(d) {
  const v = view(d);
  const table = 0x18 + v.getUint32(0x18);
  const count = v.getUint16(table + 4);
  const list = [];
  let p = table + 8;
  for (let i = 0; i < count && p + 2 < d.length; i++) {
    const n = v.getUint16(p);
    const name = cstr(d, p + 2, n);
    list.push({ name, offset: table + v.getUint32(p + 2 + n), size: v.getUint32(p + 6 + n) });
    p += 10 + n;
  }
  return { name: cstr(d, 0x28, v.getUint16(0x24)), entries: list };
}

// ---- BREFT ---------------------------------------------------------------------------------------
// Entry: 0x20-byte image header (width, height, image size, format, palette, mipmaps), then GX data.

export function parseBREFT(data) {
  const v = view(data);
  const { name, entries: list } = entries(data);
  return {
    name,
    textures: list.map((e) => ({
      name: e.name,
      offset: e.offset,
      width: v.getUint16(e.offset + 4),
      height: v.getUint16(e.offset + 6),
      imageSize: v.getUint32(e.offset + 8),
      format: data[e.offset + 0x0c],
      paletteSize: v.getUint32(e.offset + 0x10),
      mipmaps: data[e.offset + 0x14],
      dataOffset: e.offset + 0x20,
    })),
  };
}

export const breftTextureSupported = (tex) => [0, 1, 2, 3, 4, 5, 6, 14].includes(tex.format);

export function decodeBREFTTexture(data, tex) {
  if (!TEXTURE_FORMATS[tex.format] || [8, 9, 10].includes(tex.format)) return null; // palette textures: not shown
  return decodeTextureAt(data, tex.dataOffset, tex.width, tex.height, tex.format);
}

export function replaceBREFTTexture(data, textureName, rgba) {
  const tex = parseBREFT(data).textures.find((t) => t.name === textureName);
  if (!tex) throw new Error(`Texture ${textureName} not found`);
  if (rgba.length !== tex.width * tex.height * 4) throw new Error(`The image must be ${tex.width} × ${tex.height} pixels`);
  const out = data.slice();
  // The image size covers the base level and its mipmaps.
  encodeTextureLevels(out, tex.dataOffset, Math.min(tex.dataOffset + tex.imageSize, out.length), rgba, tex.width, tex.height, tex.format, Math.max(1, tex.mipmaps));
  return out;
}

// ---- BREFF ---------------------------------------------------------------------------------------
// Entry (one emitter): reserved word, emitter description size, the description (EmitterDesc), the
// particle parameter size and the particle parameters, then animations (not edited here).

// Offsets inside EmitterDesc.
export const EMITTER_FIELDS = [
  { key: 'emitLife', label: 'Emitter life (frames)', at: 8, type: 'u16', hint: '65535 = forever' },
  { key: 'ptclLife', label: 'Particle life (frames)', at: 10, type: 'u16' },
  { key: 'ptclLifeRandom', label: 'Particle life random (%)', at: 12, type: 's8' },
  { key: 'emitEmit', label: 'Particles per emission', at: 16, type: 'f32' },
  { key: 'emitStart', label: 'Start delay (frames)', at: 20, type: 'u16' },
  { key: 'emitInterval', label: 'Emission interval (frames)', at: 24, type: 'u16' },
  { key: 'emitEmitRandom', label: 'Emission count random (%)', at: 15, type: 's8' },
  { key: 'velPowerRadiationDir', label: 'Speed outwards', at: 56, type: 'f32' },
  { key: 'velPowerYAxis', label: 'Speed upwards (Y)', at: 60, type: 'f32' },
  { key: 'velPowerRandomDir', label: 'Speed in random directions', at: 64, type: 'f32' },
  { key: 'velPowerNormalDir', label: 'Speed along the emitter normal', at: 68, type: 'f32' },
  { key: 'velDiffusionEmitterNormal', label: 'Spread around the normal (rad)', at: 72, type: 'f32' },
  { key: 'velPowerSpecDir', label: 'Speed in the set direction', at: 76, type: 'f32' },
  { key: 'velDiffusionSpecDir', label: 'Spread around the set direction (rad)', at: 80, type: 'f32' },
  { key: 'scale', label: 'Emitter scale', at: 96, type: 'vec3' },
  { key: 'rotate', label: 'Emitter rotation (rad)', at: 108, type: 'vec3' },
  { key: 'translate', label: 'Emitter position', at: 120, type: 'vec3' },
];

// Offsets inside the particle parameters.
export const PARTICLE_FIELDS = [
  { key: 'color1Primary', label: 'Colour 1', at: 0, type: 'rgba' },
  { key: 'color1Secondary', label: 'Colour 1 (secondary)', at: 4, type: 'rgba' },
  { key: 'color2Primary', label: 'Colour 2', at: 8, type: 'rgba' },
  { key: 'color2Secondary', label: 'Colour 2 (secondary)', at: 12, type: 'rgba' },
  { key: 'size', label: 'Particle size', at: 16, type: 'vec2' },
  { key: 'scale', label: 'Particle scale', at: 24, type: 'vec2' },
  { key: 'rotate', label: 'Particle rotation (rad)', at: 32, type: 'vec3' },
];

// Texture names follow a fixed block of texture transforms and flags; each is a length-prefixed string.
const PARTICLE_TEXTURE_NAMES = 0x88;

function readField(v, d, base, f) {
  const o = base + f.at;
  switch (f.type) {
    case 'u16': return v.getUint16(o);
    case 's8': return v.getInt8(o);
    case 'f32': return v.getFloat32(o);
    case 'vec2': return [v.getFloat32(o), v.getFloat32(o + 4)];
    case 'vec3': return [v.getFloat32(o), v.getFloat32(o + 4), v.getFloat32(o + 8)];
    case 'rgba': return [d[o], d[o + 1], d[o + 2], d[o + 3]];
  }
}

function writeField(v, d, base, f, value) {
  const o = base + f.at;
  const num = (x) => { const n = Number(x); if (!Number.isFinite(n)) throw new Error(`${f.label}: not a number`); return n; };
  switch (f.type) {
    case 'u16': v.setUint16(o, Math.max(0, Math.min(65535, Math.round(num(value))))); break;
    case 's8': v.setInt8(o, Math.max(-128, Math.min(127, Math.round(num(value))))); break;
    case 'f32': v.setFloat32(o, num(value)); break;
    case 'vec2': value.forEach((x, i) => v.setFloat32(o + i * 4, num(x))); break;
    case 'vec3': value.forEach((x, i) => v.setFloat32(o + i * 4, num(x))); break;
    case 'rgba': value.forEach((x, i) => { d[o + i] = Math.max(0, Math.min(255, Math.round(num(x)))); }); break;
  }
}

export function parseBREFF(data) {
  const v = view(data);
  const { name, entries: list } = entries(data);
  return {
    name,
    emitters: list.map((e) => {
      const emitterSize = v.getUint32(e.offset + 4);
      const emitter = e.offset + 8;
      const particleSize = v.getUint32(emitter + emitterSize);
      const particle = emitter + emitterSize + 4;
      const textures = [];
      for (let p = particle + PARTICLE_TEXTURE_NAMES, i = 0; i < 3 && p + 2 <= particle + particleSize; i++) {
        const n = v.getUint16(p);
        if (n > 64 || p + 2 + n > particle + particleSize) break;
        const texture = n ? cstr(data, p + 2, n) : "";
        if (texture) textures.push(texture);
        p += 2 + n;
      }
      return {
        name: e.name, offset: e.offset, size: e.size, emitter, particle, textures,
        values: {
          emitter: Object.fromEntries(EMITTER_FIELDS.map((f) => [f.key, readField(v, data, emitter, f)])),
          particle: Object.fromEntries(PARTICLE_FIELDS.map((f) => [f.key, readField(v, data, particle, f)])),
        },
      };
    }),
  };
}

// Returns a copy of the BREFF with one emitter or particle value changed.
export function setBREFFValue(data, emitterName, group, key, value) {
  const fields = group === 'emitter' ? EMITTER_FIELDS : PARTICLE_FIELDS;
  const field = fields.find((f) => f.key === key);
  const emitter = parseBREFF(data).emitters.find((e) => e.name === emitterName);
  if (!field || !emitter) throw new Error(`Unknown effect value ${emitterName}.${key}`);
  const out = data.slice();
  writeField(view(out), out, group === 'emitter' ? emitter.emitter : emitter.particle, field, value);
  return out;
}
