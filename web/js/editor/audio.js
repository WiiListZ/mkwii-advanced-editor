// Audio helpers for the sound editor: friendly names of the music streams, and writers for the
// export formats (WAV and FLAC are written here; compressed formats come from the browser's encoder).

const COURSES = {
  n_circuit32: 'Luigi Circuit / Mario Circuit', n_farm: 'Moo Moo Meadows', n_kinoko: 'Mushroom Gorge', strm_n_factory: "Toad's Factory",
  n_shopping32: 'Coconut Mall', n_snowboard32: 'DK Summit', strm_n_truck: "Wario's Gold Mine", n_daisy32: 'Daisy Circuit',
  strm_n_water: 'Koopa Cape', n_maple: 'Maple Treeway', n_volcano32: 'Grumble Volcano', strm_n_desert: 'Dry Dry Ruins',
  strm_n_ridgehighway: 'Moonview Highway', strm_n_koopa: "Bowser's Castle", n_rainbow32: 'Rainbow Road',
  r_gc_beach32: 'GCN Peach Beach', r_ds_jungle32: 'DS Yoshi Falls', r_sfc_obake32: 'SNES Ghost Valley 2', r_64_circuit32: 'N64 Mario Raceway',
  r_64_sherbet32: 'N64 Sherbet Land', r_agb_beach32: 'GBA Shy Guy Beach', r_ds_town32: 'DS Delfino Square', r_gc_stadium32: 'GCN Waluigi Stadium',
  r_ds_desert32: 'DS Desert Hills', r_agb_kuppa32: 'GBA Bowser Castle 3', r_64_jungle32: "N64 DK's Jungle Parkway", r_gc_circuit32: 'GCN Mario Circuit',
  r_sfc_circuit32: 'SNES Mario Circuit 3', r_ds_garden32: 'DS Peach Gardens', r_gc_mountain32: 'GCN DK Mountain', r_64_kuppa32: "N64 Bowser's Castle",
  n_block: 'Block Plaza', n_venice: 'Delfino Pier', n_casino: 'Chain Chomp Wheel', n_skate: 'Funky Stadium', n_ryuusa: 'Thwomp Desert',
  r_gc_battle32: 'GCN Cookie Land', r_ds_battle: 'DS Twilight House', r_sfc_battle: 'SNES Battle Course 4', r_agb_battle: 'GBA Battle Course 3',
  r_64_battle: 'N64 Skyscraper',
};
const OTHER = {
  o_option_32: 'Menus', o_start32_fan: 'Race start fanfare', o_start2_32_fan: 'Race start fanfare (2)', o_crs_in_fan: 'Course introduction',
  o_crs_in_fan_wifi: 'Course introduction (online)', o_crs_in_fan_battle: 'Battle introduction', o_crs_in_fan_mission: 'Mission introduction',
  o_ending_parta_32: 'Ending', 'o_wi-fi_waiting32': 'Online waiting room', o_hyousyou_normal: 'Award ceremony', o_hyousyou_winningrun: 'Award ceremony (winning run)',
  o_hyousyou_lose: 'Award ceremony (lost)', o_hyousyou_cut: 'Award ceremony (short)', n_bossmi_32: 'Mission boss',
};

// "Moo Moo Meadows · final lap" from "n_Farm_F".
export function musicLabel(file) {
  const stem = file.replace(/\.brstm$/i, '');
  const lower = stem.toLowerCase();
  if (OTHER[lower]) return OTHER[lower];
  const m = lower.match(/^(.*?)_(n|f)$/);
  if (m && COURSES[m[1]]) return `${COURSES[m[1]]} · ${m[2] === 'f' ? 'final lap' : 'normal'}`;
  if (lower.startsWith('o_fanfare')) return `Fanfare (${stem.slice(9).replace(/_32|_only32/i, (x) => (/only/i.test(x) ? ', no loop' : ''))})`;
  return stem;
}

// Keep only one native BRSTM track, remapping its channel IDs for a standalone export.
export function isolateTrack(clip, index) {
  const track = clip.tracks?.[index];
  if (!track || !track.channels.length) throw new RangeError('Music track not found');
  return {
    ...clip,
    channels: track.channels.map((channel) => clip.channels[channel]),
    tracks: [{ ...track, channels: track.channels.map((_, channel) => channel) }],
  };
}

// ---- WAV ------------------------------------------------------------------------------------------
export function encodeWAV(channels, sampleRate) {
  const count = channels.length, frames = channels[0].length, bytes = frames * count * 2;
  const out = new Uint8Array(44 + bytes), v = new DataView(out.buffer);
  const str = (o, s) => [...s].forEach((c, i) => { out[o + i] = c.charCodeAt(0); });
  str(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, count, true); v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * count * 2, true); v.setUint16(32, count * 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, bytes, true);
  for (let i = 0, o = 44; i < frames; i++) for (let c = 0; c < count; c++, o += 2) v.setInt16(o, channels[c][i], true);
  return out;
}

// ---- FLAC (lossless) ------------------------------------------------------------------------------
// Each channel of each block is coded with the best fixed predictor (order 0 to 4) and Rice codes.
class BitWriter {
  constructor(size) { this.buf = new Uint8Array(size); this.pos = 0; this.acc = 0; this.n = 0; }
  write(value, bits) {
    for (let i = bits - 1; i >= 0; i--) {
      this.acc = (this.acc << 1) | ((value >>> i) & 1);
      if (++this.n === 8) this.byte(this.acc);
    }
  }
  byte(b) {
    if (this.pos >= this.buf.length) { const bigger = new Uint8Array(this.buf.length * 2); bigger.set(this.buf); this.buf = bigger; }
    this.buf[this.pos++] = b & 255; this.acc = 0; this.n = 0;
  }
  unary(q) { for (let i = 0; i < q; i++) this.write(0, 1); this.write(1, 1); }
  align() { while (this.n) this.write(0, 1); }
  bytes() { return this.buf.subarray(0, this.pos); }
}

const CRC8 = new Uint8Array(256), CRC16 = new Uint16Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = (c & 0x80 ? (c << 1) ^ 0x07 : c << 1) & 0xff;
  CRC8[i] = c;
  let d = i << 8;
  for (let k = 0; k < 8; k++) d = (d & 0x8000 ? (d << 1) ^ 0x8005 : d << 1) & 0xffff;
  CRC16[i] = d;
}
const crc8 = (b, from, to) => { let c = 0; for (let i = from; i < to; i++) c = CRC8[c ^ b[i]]; return c; };
const crc16 = (b, from, to) => { let c = 0; for (let i = from; i < to; i++) c = ((c << 8) ^ CRC16[(c >> 8) ^ b[i]]) & 0xffff; return c; };

function residuals(x, order) {
  const n = x.length, r = new Int32Array(n - order);
  for (let i = order; i < n; i++) {
    let p = 0;
    if (order === 1) p = x[i - 1];
    else if (order === 2) p = 2 * x[i - 1] - x[i - 2];
    else if (order === 3) p = 3 * x[i - 1] - 3 * x[i - 2] + x[i - 3];
    else if (order === 4) p = 4 * x[i - 1] - 6 * x[i - 2] + 4 * x[i - 3] - x[i - 4];
    r[i - order] = x[i] - p;
  }
  return r;
}
const zigzag = (v) => (v >= 0 ? v * 2 : -v * 2 - 1);
function riceCost(r, k) { let bits = 0; for (let i = 0; i < r.length; i++) bits += (zigzag(r[i]) >>> k) + 1 + k; return bits; }

export function encodeFLAC(channels, sampleRate) {
  const count = channels.length, frames = channels[0].length, block = 4096;
  const w = new BitWriter(frames * count * 2 + 4096);
  [0x66, 0x4c, 0x61, 0x43].forEach((b) => w.byte(b)); // fLaC
  // STREAMINFO (last metadata block)
  w.write(1, 1); w.write(0, 7); w.write(34, 24);
  w.write(block, 16); w.write(block, 16); w.write(0, 24); w.write(0, 24);
  w.write(sampleRate, 20); w.write(count - 1, 3); w.write(15, 5);
  w.write(Math.floor(frames / 2 ** 32), 4); w.write(frames >>> 0, 32);
  for (let i = 0; i < 16; i++) w.write(0, 8); // MD5 unknown
  for (let f = 0, index = 0; f < frames; f += block, index++) {
    const size = Math.min(block, frames - f);
    const start = w.pos;
    w.write(0x3ffe, 14); w.write(0, 1); w.write(0, 1);
    w.write(size === block ? 0b1100 : 0b0111, 4); w.write(0, 4); // block size code, sample rate from STREAMINFO
    w.write(count - 1, 4); w.write(0b100, 3); w.write(0, 1);
    // Frame number, UTF-8 style.
    if (index < 0x80) w.write(index, 8);
    else if (index < 0x800) { w.write(0xc0 | (index >> 6), 8); w.write(0x80 | (index & 63), 8); }
    else if (index < 0x10000) { w.write(0xe0 | (index >> 12), 8); w.write(0x80 | ((index >> 6) & 63), 8); w.write(0x80 | (index & 63), 8); }
    else { w.write(0xf0 | (index >> 18), 8); w.write(0x80 | ((index >> 12) & 63), 8); w.write(0x80 | ((index >> 6) & 63), 8); w.write(0x80 | (index & 63), 8); }
    if (size !== block) w.write(size - 1, 16);
    w.write(crc8(w.buf, start, w.pos), 8);
    for (let c = 0; c < count; c++) {
      const x = channels[c].subarray(f, f + size);
      let best = null;
      for (let order = 0; order <= Math.min(4, size - 1); order++) {
        const r = residuals(x, order);
        for (let k = 0; k < 15; k++) {
          const cost = riceCost(r, k) + order * 16;
          if (!best || cost < best.cost) best = { cost, order, k, r };
        }
      }
      if (best.cost >= size * 16) {
        w.write(0, 1); w.write(1, 6); w.write(0, 1); // verbatim
        for (let i = 0; i < size; i++) w.write(x[i] & 0xffff, 16);
        continue;
      }
      w.write(0, 1); w.write(8 + best.order, 6); w.write(0, 1);
      for (let i = 0; i < best.order; i++) w.write(x[i] & 0xffff, 16);
      w.write(0, 2); w.write(0, 4); w.write(best.k, 4); // Rice, partition order 0
      for (let i = 0; i < best.r.length; i++) {
        const u = zigzag(best.r[i]);
        w.unary(u >>> best.k);
        if (best.k) w.write(u & ((1 << best.k) - 1), best.k);
      }
    }
    w.align();
    const crc = crc16(w.buf, start, w.pos);
    w.write(crc, 16);
  }
  return w.bytes().slice();
}

// Float32 channels (Web Audio) to Int16.
export const toInt16 = (f32) => Int16Array.from(f32, (s) => Math.max(-32768, Math.min(32767, Math.round(s * 32767))));
export const toFloat32 = (i16) => Float32Array.from(i16, (s) => s / 32768);
