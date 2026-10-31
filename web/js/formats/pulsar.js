// Pulsar packs (Binaries/Config.pul): mods made with the Pulsar engine and its Pack Creator, such as
// Insane Kart Wii, which add hundreds of custom cups. Layout from the Pulsar sources
// (PulsarEngine/Config.hpp, PulsarPackCreator/IO/Builder.cs and Importer.cs), version 3:
//
// 'PULS', version, offsets of INFO, CUPS and BMG (from the start of the file), mod folder name (16 bytes).
// INFO: section header ('INFO', 1, size) and the pack settings (room key, engine class chances,
//   Wiimmfi region, track blocking, five switches, cup icon count, vote timer, reserved bytes).
// CUPS: section header ('CUPS', 3, size), custom cup count (u16), regulars mode, padding,
//   time trial trophy counts (4 × u16), variant count (u32), then for every track of every cup
//   (cup × 4 + position): slot (the original track whose behaviour it uses), music slot, variant
//   count (u16) and CRC-32 of its SZS (u32); then every variant (slot, music slot), then one u16 per
//   track: its position in alphabetical order.
// BMG: the names, MESGbmg1 with 32-bit message IDs: cups 0x10000 + cup, tracks 0x20000 + track
//   (+ variant << 12; 8 << 12 is the common name of a track with variants), authors 0x30000 + track.
// FILE: text after the BMG, one line per track: "<id hex>=<source file name>|<expert ghosts…>", and
//   "<cup hex>?<icon file>" per cup; kept as it is except for edited names.
//
// The track of custom cup c, position p is Tracks/<c×4+p>.szs in the mod folder (variants
// <n>_<v>.szs); Riivolution maps that folder to Race/Course. Cup icons are button/timg/icon_NNN.tpl in
// Assets/UIAssets.szs.

const text = (b, from, to) => String.fromCharCode(...b.subarray(from, to)).replace(/\0.*$/s, '');

export function isPulsarConfig(data) {
  return data?.length >= 0x24 && text(data, 0, 4) === 'PULS';
}

export function parsePulsarConfig(data) {
  if (!isPulsarConfig(data)) throw new Error('Not a Pulsar Config.pul');
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const version = v.getInt32(4);
  if (Math.abs(version) !== 3) throw new Error(`Pulsar config version ${version} is not supported (version 3 is)`);
  const [infoAt, cupsAt, bmgAt] = [v.getInt32(8), v.getInt32(12), v.getInt32(16)];
  const folder = text(data, 0x14, infoAt);
  if (text(data, infoAt, infoAt + 4) !== 'INFO') throw new Error('Pulsar config without INFO');
  const info = { iconCountOffset: infoAt + 12 + 25, iconCount: v.getUint16(infoAt + 12 + 25) };
  if (text(data, cupsAt, cupsAt + 4) !== 'CUPS' || v.getUint32(cupsAt + 4) !== 3) throw new Error('Pulsar config: unsupported CUPS section');
  const cupCount = v.getUint16(cupsAt + 12);
  const regsMode = data[cupsAt + 14];
  const trophies = [0, 1, 2, 3].map((i) => v.getUint16(cupsAt + 16 + i * 2));
  const variantTotal = v.getInt32(cupsAt + 24);
  let at = cupsAt + 28;
  // An odd number of cups is stored with one more cup, a copy of the first (the engine shows cups in pairs).
  const stored = (cupCount + (cupCount & 1)) * 4;
  const all = [];
  for (let i = 0; i < stored; i++, at += 8) all.push({ slot: data[at], music: data[at + 1], variantCount: v.getUint16(at + 2), crc: v.getUint32(at + 4), variants: [] });
  for (const t of all) for (let k = 0; k < t.variantCount; k++, at += 2) t.variants.push({ slot: data[at], music: data[at + 1] });
  if (all.reduce((n, t) => n + t.variantCount, 0) !== variantTotal) throw new Error('Pulsar config: variant count does not match');
  const alphabetical = [];
  for (let i = 0; i < stored; i++, at += 2) alphabetical.push(v.getUint16(at));
  const tracks = all.slice(0, cupCount * 4);
  alphabetical.length = cupCount * 4;
  if (text(data, bmgAt, bmgAt + 8) !== 'MESGbmg1') throw new Error('Pulsar config without names (BMG)');
  const bmgSize = v.getUint32(bmgAt + 8);
  return {
    data, version, folder, info, cupCount, regsMode, trophies, tracks, alphabetical,
    head: data.slice(0, cupsAt), bmg: data.slice(bmgAt, bmgAt + bmgSize), file: data.slice(bmgAt + bmgSize),
  };
}

export const PULSAR_IDS = { cup: 0x10000, track: 0x20000, author: 0x30000 };

// Writes the config again: the CUPS section from `config.tracks` (order = cup × 4 + position), the
// given BMG, the FILE text, and the cup icon count.
export function buildPulsarConfig(config, bmg = config.bmg, file = config.file) {
  const cupCount = config.tracks.length / 4;
  if (!Number.isInteger(cupCount) || cupCount < 1) throw new Error('Every cup needs four tracks');
  // Odd cup counts get a copy of the first cup after the real ones, as the Pack Creator writes it
  // and the engine reads it (it rounds the cup count up to even).
  const odd = cupCount & 1;
  const tracks = odd ? [...config.tracks, ...config.tracks.slice(0, 4)] : config.tracks;
  const alphabetical = odd ? [...config.alphabetical, ...config.alphabetical.slice(0, 4)] : config.alphabetical;
  const variants = tracks.flatMap((t) => t.variants);
  const cupsSize = 28 + tracks.length * 8 + variants.length * 2 + tracks.length * 2;
  const head = config.head.slice();
  const cupsAt = head.length, bmgAt = cupsAt + cupsSize;
  const out = new Uint8Array(bmgAt + bmg.length + file.length), v = new DataView(out.buffer);
  out.set(head);
  v.setInt32(12, cupsAt); v.setInt32(16, bmgAt);
  v.setUint16(config.info.iconCountOffset, config.info.iconCount);
  out.set([0x43, 0x55, 0x50, 0x53], cupsAt);
  v.setUint32(cupsAt + 4, 3); v.setUint32(cupsAt + 8, cupsSize);
  v.setUint16(cupsAt + 12, cupCount); out[cupsAt + 14] = config.regsMode;
  config.trophies.forEach((n, i) => v.setUint16(cupsAt + 16 + i * 2, n));
  v.setInt32(cupsAt + 24, variants.length);
  let at = cupsAt + 28;
  for (const t of tracks) { out[at] = t.slot; out[at + 1] = t.music; v.setUint16(at + 2, t.variants.length); v.setUint32(at + 4, t.crc >>> 0); at += 8; }
  for (const x of variants) { out[at] = x.slot; out[at + 1] = x.music; at += 2; }
  for (const index of alphabetical) { v.setUint16(at, index); at += 2; }
  out.set(bmg, bmgAt);
  out.set(file, bmgAt + bmg.length);
  return out;
}

// Alphabetical order of the tracks by name: entry i is the track index of the i-th name.
export function alphabeticalOrder(names) {
  return names.map((name, i) => ({ name: (name || '').toLowerCase(), i })).sort((a, b) => a.name.localeCompare(b.name) || a.i - b.i).map((x) => x.i);
}

// CRC-32 (IEEE) of a file, as the Pack Creator stores it for each track (ghost folders use it).
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; } return t; })();
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

