// BRSAR sound archive (files/sound/revo_kart.brsar): every sound effect and voice of the game.
// Reads the sound list (names, types, files and groups), the wave sound files (RWSD) and the
// wave archives (RWAR of RWAV waves, DSP-ADPCM) they play, and writes waves back: the FILE area is
// laid out again so a new wave may be longer than the one it replaces.

import { decodeDSP, dspCoefficients, encodeDSP } from './brstm.js';

class Reader {
  constructor(d) { this.d = d; this.v = new DataView(d.buffer, d.byteOffset, d.byteLength); }
  u8(o) { return this.d[o]; }
  u16(o) { return this.v.getUint16(o); }
  s16(o) { return this.v.getInt16(o); }
  u32(o) { return this.v.getUint32(o); }
  str(o) { let s = ''; for (let i = o; i < this.d.length && this.d[i]; i++) s += String.fromCharCode(this.d[i]); return s; }
  magic(o) { return String.fromCharCode(...this.d.subarray(o, o + 4)); }
}

const align = (n, a = 0x20) => Math.ceil(n / a) * a;
export const SOUND_TYPES = { 1: 'Sequence', 2: 'Stream', 3: 'Wave' };

export function parseBRSAR(data) {
  const r = new Reader(data);
  if (r.magic(0) !== 'RSAR') throw new Error('Not a BRSAR sound archive');
  const symb = r.u32(0x10), info = r.u32(0x18);
  const sb = symb + 8, strings = sb + r.u32(sb);
  const nameCount = r.u32(strings);
  const name = (i) => (i >= 0 && i < nameCount ? r.str(sb + r.u32(strings + 4 + i * 4)) : '');
  // INFO references are relative to INFO + 8.
  const ib = info + 8;
  const ref = (o) => ib + r.u32(o + 4);
  const table = (o) => { const t = ref(o), n = r.u32(t); return Array.from({ length: n }, (_, i) => ref(t + 4 + i * 8)); };
  const sounds = table(ib).map((e, index) => {
    const type = r.u8(e + 0x16);
    return { index, name: name(r.u32(e)), fileId: r.u32(e + 4), volume: r.u8(e + 0x14), type, waveEntry: type === 3 ? r.u32(ref(e + 0x18)) : -1 };
  });
  const banks = table(ib + 8).map((e) => ({ name: name(r.u32(e)), fileId: r.u32(e + 4) }));
  const files = table(ib + 0x18).map((e, index) => ({
    index, entry: e, size: r.u32(e), waveSize: r.u32(e + 4),
    positions: table(e + 0x14).map((p) => ({ group: r.u32(p), item: r.u32(p + 4) })),
  }));
  const groups = table(ib + 0x20).map((e, index) => ({
    index, entry: e, name: name(r.u32(e)), offset: r.u32(e + 0x10), size: r.u32(e + 0x14), waveOffset: r.u32(e + 0x18), waveSize: r.u32(e + 0x1c),
    items: table(e + 0x20).map((it) => ({ entry: it, fileId: r.u32(it), offset: r.u32(it + 4), size: r.u32(it + 8), waveOffset: r.u32(it + 12), waveSize: r.u32(it + 16) })),
  }));
  const archive = { data, r, sounds, banks, files, groups };
  return archive;
}

// Where a file's data and its wave archive are (first copy).
function fileData(archive, fileId) {
  const file = archive.files[fileId];
  const pos = file?.positions[0];
  if (!pos) return null;
  const group = archive.groups[pos.group], item = group.items[pos.item];
  return { at: group.offset + item.offset, size: item.size, waveAt: group.waveOffset + item.waveOffset, waveSize: item.waveSize, group };
}

// RWAR: the RWAV waves it holds (absolute offset and size of each).
function waveArchive(archive, at) {
  const r = archive.r;
  if (r.magic(at) !== 'RWAR') return [];
  const tabl = at + r.u32(at + 0x10), dataSection = at + r.u32(at + 0x18);
  const count = r.u32(tabl + 8);
  return Array.from({ length: count }, (_, i) => ({ at: dataSection + r.u32(tabl + 0x0c + i * 12 + 4), size: r.u32(tabl + 0x0c + i * 12 + 8) }));
}

// Wave index played by entry `entry` of an RWSD file (its first note).
function rwsdWaveIndex(archive, at, entry) {
  const r = archive.r;
  if (r.magic(at) !== 'RWSD') return -1;
  const data = at + r.u32(at + 0x10), base = data + 8;
  const count = r.u32(base);
  if (entry >= count) return -1;
  const wsd = base + r.u32(base + 4 + entry * 8 + 4);
  const notes = base + r.u32(wsd + 0x14);
  if (!r.u32(notes)) return -1;
  const note = base + r.u32(notes + 4 + 4);
  return r.u32(note);
}

// Everything that can be listened to: wave sounds by name, and the samples of instrument banks
// (used by the sequenced sounds and music).
export function listWaves(archive) {
  const out = [];
  for (const s of archive.sounds) {
    if (s.type !== 3) continue;
    const f = fileData(archive, s.fileId);
    if (!f) continue;
    const wave = rwsdWaveIndex(archive, f.at, s.waveEntry);
    if (wave < 0) continue;
    out.push({ key: `s${s.index}`, name: s.name, group: f.group.name, kind: 'Sound', fileId: s.fileId, wave });
  }
  for (const b of archive.banks) {
    const f = fileData(archive, b.fileId);
    if (!f || archive.r.magic(f.at) !== 'RBNK') continue;
    waveArchive(archive, f.waveAt).forEach((_, wave) => out.push({ key: `b${b.fileId}:${wave}`, name: `${b.name} · sample ${wave + 1}`, group: f.group.name, kind: 'Bank sample', fileId: b.fileId, wave }));
  }
  return out;
}

// RWAV: format, rate, loop and channels (with DSP-ADPCM coefficients) of a wave.
function rwavInfo(r, at) {
  const info = at + r.u32(at + 0x10), wi = info + 8;
  const format = r.u8(wi), loop = !!r.u8(wi + 1), channels = r.u8(wi + 2), sampleRate = (r.u8(wi + 3) << 16) | r.u16(wi + 4);
  const loopStart = r.u32(wi + 8), loopEnd = r.u32(wi + 12);
  let dataBase = wi + r.u32(wi + 0x14);
  if (r.magic(dataBase) === 'DATA') dataBase += 8;
  const table = wi + r.u32(wi + 0x10);
  const chans = Array.from({ length: channels }, (_, c) => {
    const ci = wi + r.u32(table + c * 4);
    const adpcm = wi + r.u32(ci + 4);
    const coefs = new Int16Array(16);
    for (let i = 0; i < 16; i++) coefs[i] = r.s16(adpcm + i * 2);
    return { info: ci, adpcm, dataAt: dataBase + r.u32(ci), coefs };
  });
  return { info, wi, format, loop, sampleRate, loopStart, loopEnd, dataBase, channels: chans };
}

// ADPCM positions are nibble addresses (2 header nibbles per 16): convert to and from samples.
const nibblesToSamples = (n) => Math.floor(n / 16) * 14 + Math.max(0, (n % 16) - 2);
const samplesToNibbles = (s) => Math.floor(s / 14) * 16 + (s % 14) + 2;

function locate(archive, wave) {
  const f = fileData(archive, wave.fileId);
  const waves = f ? waveArchive(archive, f.waveAt) : [];
  const w = waves[wave.wave];
  if (!w) throw new Error('Wave not found');
  return { file: f, waves, rwav: w };
}

// PCM of a wave: { sampleRate, loop, loopStart (samples), channels: Int16Array[] }.
export function readWave(archive, wave) {
  const { rwav } = locate(archive, wave);
  const r = archive.r, w = rwavInfo(r, rwav.at);
  const adpcm = w.format === 2;
  const samples = adpcm ? nibblesToSamples(w.loopEnd + 1) : w.loopEnd + 1;
  const channels = w.channels.map((c) => {
    if (adpcm) return decodeDSP(archive.data, c.dataAt, samples, c.coefs);
    const out = new Int16Array(samples);
    for (let i = 0; i < samples; i++) out[i] = w.format === 1 ? r.s16(c.dataAt + i * 2) : ((archive.data[c.dataAt + i] << 24) >> 24) * 256;
    return out;
  });
  return { sampleRate: w.sampleRate, loop: w.loop, loopStart: adpcm ? nibblesToSamples(w.loopStart) : w.loopStart, channels };
}

// New RWAV from the original (same channel count): DSP-ADPCM data, loop and sizes rewritten.
function buildRWAV(r, original, pcm, { loop, loopStart }) {
  const w = rwavInfo(r, original.at);
  const count = w.channels.length;
  const samples = pcm[0].length;
  const encoded = pcm.slice(0, count).map((ch) => { const coefs = dspCoefficients(ch); return { coefs, frames: encodeDSP(ch, coefs) }; });
  const perChannel = align(encoded[0].frames.length);
  const headerSize = w.dataBase - original.at; // RWAV header + INFO + DATA section header
  const out = new Uint8Array(headerSize + perChannel * count);
  out.set(r.d.subarray(original.at, original.at + headerSize));
  const v = new DataView(out.buffer), at = (o) => o - original.at;
  v.setUint32(0x08, out.length);
  const dataSection = r.u32(original.at + 0x18);
  v.setUint32(0x1c, out.length - dataSection);
  v.setUint32(dataSection + 4, out.length - dataSection);
  out[at(w.wi)] = 2; out[at(w.wi) + 1] = loop ? 1 : 0;
  v.setUint32(at(w.wi) + 8, samplesToNibbles(loop ? loopStart : 0));
  v.setUint32(at(w.wi) + 12, samplesToNibbles(samples) - 1);
  encoded.forEach(({ coefs, frames }, c) => {
    const ch = w.channels[c];
    v.setUint32(at(ch.info), c * perChannel);
    coefs.forEach((k, i) => v.setInt16(at(ch.adpcm) + i * 2, k));
    v.setUint16(at(ch.adpcm) + 0x22, frames[0]);
    v.setInt16(at(ch.adpcm) + 0x24, 0); v.setInt16(at(ch.adpcm) + 0x26, 0);
    // Loop context: the frame header and the two decoded samples before the loop start.
    const decoded = decodeDSP(frames, 0, samples, coefs);
    const ls = loop ? loopStart : 0;
    v.setUint16(at(ch.adpcm) + 0x28, frames[Math.floor(ls / 14) * 8] ?? 0);
    v.setInt16(at(ch.adpcm) + 0x2a, ls > 0 ? decoded[ls - 1] : 0);
    v.setInt16(at(ch.adpcm) + 0x2c, ls > 1 ? decoded[ls - 2] : 0);
    out.set(frames, headerSize + c * perChannel);
  });
  return out;
}

// New RWAR with wave `index` replaced.
function buildRWAR(r, rwarAt, waves, index, rwav) {
  const tabl = rwarAt + r.u32(rwarAt + 0x10), dataSection = rwarAt + r.u32(rwarAt + 0x18);
  const head = dataSection - rwarAt + 8; // header, TABL and the DATA section header
  const parts = waves.map((w, i) => (i === index ? rwav : r.d.subarray(w.at, w.at + w.size)));
  let size = head;
  const offsets = parts.map((p) => { size = align(size); const o = size; size += p.length; return o; });
  size = align(size);
  const out = new Uint8Array(size), v = new DataView(out.buffer);
  out.set(r.d.subarray(rwarAt, rwarAt + head));
  parts.forEach((p, i) => {
    out.set(p, offsets[i]);
    v.setUint32(tabl - rwarAt + 0x0c + i * 12 + 4, offsets[i] - (dataSection - rwarAt));
    v.setUint32(tabl - rwarAt + 0x0c + i * 12 + 8, p.length);
  });
  v.setUint32(0x08, size);
  v.setUint32(0x1c, size - (dataSection - rwarAt));
  v.setUint32(dataSection - rwarAt + 4, size - (dataSection - rwarAt));
  return out;
}

// Replaces a wave with new PCM (one Int16Array per channel, at the wave's sample rate) and
// returns the whole new BRSAR. Every copy of the wave archive (in every group) is updated.
export function replaceWave(archive, wave, pcm, { loop = null, loopStart = 0 } = {}) {
  const { file, waves, rwav } = locate(archive, wave);
  const r = archive.r;
  const info = rwavInfo(r, rwav.at);
  const channels = Array.from({ length: info.channels.length }, (_, c) => pcm[Math.min(c, pcm.length - 1)]);
  const newRwav = buildRWAV(r, rwav, channels, { loop: loop ?? info.loop, loopStart });
  const newRwar = buildRWAR(r, file.waveAt, waves, wave.wave, newRwav);
  return rebuild(archive, new Map([[wave.fileId, newRwar]]));
}

// Lays the FILE area out again (groups in their original order: files, then wave archives),
// with some wave archives replaced, and patches the offsets and sizes in INFO and the header.
function rebuild(archive, newWaves) {
  const { data, r, groups } = archive;
  const fileSection = r.u32(0x20);
  const start = fileSection + 0x20;
  const chunks = [];
  let pos = start;
  const place = (bytes) => { pos = align(pos); const at = pos; chunks.push([at, bytes]); pos += bytes.length; return at; };
  const patches = [];
  const placed = new Map();
  const blocks = [];
  for (const g of groups) blocks.push(g);
  blocks.sort((a, b) => a.offset - b.offset);
  for (const g of blocks) {
    // Files of the group, as they are.
    const key = `${g.offset}:${g.size}`;
    let filesAt = placed.get(key);
    if (filesAt === undefined) { filesAt = place(data.subarray(g.offset, g.offset + g.size)); placed.set(key, filesAt); }
    // Wave archives of its items.
    pos = align(pos);
    const wavesAt = pos;
    for (const it of g.items) {
      const bytes = newWaves.get(it.fileId) || data.subarray(g.waveOffset + it.waveOffset, g.waveOffset + it.waveOffset + it.waveSize);
      const at = it.waveSize || newWaves.has(it.fileId) ? place(bytes) : wavesAt;
      patches.push([it.entry + 12, at - wavesAt], [it.entry + 16, bytes.length]);
      if (newWaves.has(it.fileId)) patches.push([archive.files[it.fileId].entry + 4, bytes.length]);
    }
    patches.push([g.entry + 0x10, filesAt], [g.entry + 0x18, wavesAt], [g.entry + 0x1c, align(pos) - wavesAt]);
  }
  const total = align(pos);
  const out = new Uint8Array(total);
  out.set(data.subarray(0, start));
  for (const [at, bytes] of chunks) out.set(bytes, at);
  const v = new DataView(out.buffer);
  for (const [at, value] of patches) v.setUint32(at, value);
  v.setUint32(0x08, total);
  v.setUint32(0x24, total - fileSection);
  v.setUint32(fileSection + 4, total - fileSection);
  return out;
}
