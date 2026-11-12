// RKG ghost files, alone or inside the rksys.dat save (https://mkwiiki.org/wiki/RKG_(File_Format)).
// A ghost holds the buttons pressed on each frame, not the kart's path. Layouts checked against the
// game's Race/TimeAttack files and a real save: both CRC-32s are the standard one.

import { yaz0Compress, yaz0Decompress } from './yaz0.js';

export const RKG_HEADER_SIZE = 0x88;
export const RKG_INPUT_LIMIT = 0x2774;
export const RKG_SAVE_SLOT = 0x2800;

export const COURSE_NAMES = [
  'Mario Circuit', 'Moo Moo Meadows', 'Mushroom Gorge', 'Grumble Volcano', "Toad's Factory", 'Coconut Mall', 'DK Summit', "Wario's Gold Mine",
  'Luigi Circuit', 'Daisy Circuit', 'Moonview Highway', 'Maple Treeway', "Bowser's Castle", 'Rainbow Road', 'Dry Dry Ruins', 'Koopa Cape',
  'GCN Peach Beach', 'GCN Mario Circuit', 'GCN Waluigi Stadium', 'GCN DK Mountain', 'DS Yoshi Falls', 'DS Desert Hills', 'DS Peach Gardens', 'DS Delfino Square',
  'SNES Mario Circuit 3', 'SNES Ghost Valley 2', 'N64 Mario Raceway', 'N64 Sherbet Land', "N64 Bowser's Castle", "N64 DK's Jungle Parkway", 'GBA Bowser Castle 3', 'GBA Shy Guy Beach',
];
export const CONTROLLERS = ['Wii Wheel', 'Wii Remote + Nunchuck', 'Classic Controller', 'GameCube Controller'];
export const FRAMES_PER_SECOND = 59.94;

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(data) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function getBits(data, bit, count) {
  let value = 0;
  for (let i = 0; i < count; i++) value = value * 2 + ((data[(bit + i) >> 3] >> (7 - ((bit + i) & 7))) & 1);
  return value;
}
function setBits(data, bit, count, value) {
  for (let i = 0; i < count; i++) {
    const at = bit + i, on = Math.floor(value / 2 ** (count - 1 - i)) & 1, mask = 1 << (7 - (at & 7));
    data[at >> 3] = on ? data[at >> 3] | mask : data[at >> 3] & ~mask;
  }
}
const u16 = (d, o) => (d[o] << 8) | d[o + 1];
const u32 = (d, o) => ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0;

const readTime = (data, offset) => ({ minutes: getBits(data, offset * 8, 7), seconds: getBits(data, offset * 8 + 7, 7), milliseconds: getBits(data, offset * 8 + 14, 10) });
function writeTime(data, offset, time) {
  setBits(data, offset * 8, 7, time.minutes);
  setBits(data, offset * 8 + 7, 7, time.seconds);
  setBits(data, offset * 8 + 14, 10, time.milliseconds);
}
export const timeText = (t) => `${t.minutes}:${String(t.seconds).padStart(2, '0')}.${String(t.milliseconds).padStart(3, '0')}`;

// Sections of the input data: [state, frames]; tricks keep extra duration bits in their state byte.
export function parseInputs(bytes) {
  if (bytes.length < 8) return { face: [], direction: [], tricks: [] };
  const counts = [u16(bytes, 0), u16(bytes, 2), u16(bytes, 4)];
  let at = 8;
  const section = (count, read) => {
    const list = [];
    for (let i = 0; i < count && at + 2 <= bytes.length; i++, at += 2) list.push(read(bytes[at], bytes[at + 1]));
    return list;
  };
  const face = section(counts[0], (state, frames) => ({ state, frames }));
  const direction = section(counts[1], (state, frames) => ({ state, frames }));
  const tricks = section(counts[2], (state, frames) => ({ state: state & 0xF0, frames: ((state & 15) << 8) | frames }));
  return { face, direction, tricks };
}

export function encodeInputs({ face, direction, tricks }) {
  const size = 8 + (face.length + direction.length + tricks.length) * 2;
  if (size > RKG_INPUT_LIMIT) throw new Error(`These inputs need ${size} bytes; a ghost holds at most ${RKG_INPUT_LIMIT}`);
  const out = new Uint8Array(size);
  [face.length, direction.length, tricks.length].forEach((count, i) => { out[i * 2] = count >> 8; out[i * 2 + 1] = count & 255; });
  let at = 8;
  for (const list of [face, direction]) for (const { state, frames } of list) {
    if (frames < 0 || frames > 255) throw new Error('A button or direction entry lasts 0 to 255 frames');
    out[at++] = state; out[at++] = frames;
  }
  for (const { state, frames } of tricks) {
    if (frames < 0 || frames > 4095) throw new Error('A trick entry lasts 0 to 4095 frames');
    out[at++] = (state & 0xF0) | (frames >> 8); out[at++] = frames & 255;
  }
  return out;
}

export const inputFrames = (list) => list.reduce((sum, entry) => sum + entry.frames, 0);

// Inputs start at the countdown: in all of the game's staff ghosts and those of a real save, they
// last exactly this many frames more than the finish time.
export const COUNTDOWN_FRAMES = 240;
const TRICKS = { 0x10: 'up', 0x20: 'down', 0x30: 'left', 0x40: 'right' };

const entryAt = (list, frame) => {
  let at = 0;
  for (const entry of list) {
    at += entry.frames;
    if (frame < at) return entry;
  }
  return list[list.length - 1] || null;
};

// What is held on one frame. Stick from -1 to 1: right and forward are positive.
export function inputsAtFrame(inputs, frame) {
  const face = entryAt(inputs.face, frame)?.state ?? 0;
  const direction = entryAt(inputs.direction, frame)?.state ?? 0x77;
  const trick = entryAt(inputs.tricks, frame)?.state ?? 0;
  return {
    accelerate: !!(face & 1), brake: !!(face & 2), item: !!(face & 4),
    stickX: ((direction >> 4) - 7) / 7, stickY: ((direction & 15) - 7) / 7,
    trick: TRICKS[trick & 0x70] || null,
  };
}

const seconds = (time) => time.minutes * 60 + time.seconds + time.milliseconds / 1000;

// The race clock on one frame, negative during the countdown, and the lap from the ghost's lap times.
export function ghostClock(ghost, frame) {
  const clock = (frame - COUNTDOWN_FRAMES) / FRAMES_PER_SECOND;
  let lap = 1, end = 0;
  for (let i = 0; i < Math.min(5, ghost.laps); i++) {
    end += seconds(ghost.splits[i]);
    if (clock < end) break;
    lap = Math.min(ghost.laps, i + 2);
  }
  return { clock, lap, finished: clock >= seconds(ghost.time) };
}

export function isRKG(data) {
  return data.length > RKG_HEADER_SIZE && data[0] === 0x52 && data[1] === 0x4B && data[2] === 0x47 && data[3] === 0x44;
}

export function parseRKG(data) {
  if (!isRKG(data)) throw new Error('This is not a ghost file (no RKGD header)');
  const compressed = getBits(data, 0x0C * 8 + 4, 1) === 1;
  const inputLength = u16(data, 0x0E);
  let input, end;
  if (compressed) {
    const length = u32(data, 0x88);
    end = 0x8C + length;
    if (end > data.length) throw new Error('The ghost file is cut short');
    // Yaz1 is Yaz0 under another name.
    const packed = data.slice(0x8C, end);
    if (packed[0] !== 0x59 || packed[1] !== 0x61 || packed[2] !== 0x7A) throw new Error('The ghost inputs are not Yaz1 compressed');
    packed[3] = 0x30;
    input = yaz0Decompress(packed).subarray(0, inputLength);
  } else {
    end = RKG_HEADER_SIZE + RKG_INPUT_LIMIT;
    if (data.length < RKG_HEADER_SIZE + inputLength) throw new Error('The ghost file is cut short');
    input = data.subarray(RKG_HEADER_SIZE, RKG_HEADER_SIZE + inputLength);
  }
  const crcValid = end + 4 <= data.length && u32(data, end) === crc32(data.subarray(0, end));
  const name = [];
  for (let i = 0; i < 10; i++) {
    const code = u16(data, 0x3C + 2 + i * 2);
    if (!code) break;
    name.push(String.fromCharCode(code));
  }
  return {
    header: data.slice(0, RKG_HEADER_SIZE),
    time: readTime(data, 0x04),
    track: getBits(data, 0x07 * 8, 6),
    vehicle: getBits(data, 0x08 * 8, 6),
    character: getBits(data, 0x08 * 8 + 6, 6),
    year: 2000 + getBits(data, 0x09 * 8 + 4, 7),
    month: getBits(data, 0x0A * 8 + 3, 4),
    day: getBits(data, 0x0A * 8 + 7, 5),
    controller: getBits(data, 0x0B * 8 + 4, 4),
    compressed,
    ghostType: getBits(data, 0x0C * 8 + 7, 7),
    automatic: getBits(data, 0x0D * 8 + 6, 1) === 1,
    laps: data[0x10],
    splits: Array.from({ length: 5 }, (_, i) => readTime(data, 0x11 + i * 3)),
    country: data[0x34],
    miiName: name.join(''),
    crcValid,
    inputs: parseInputs(input),
  };
}

export function buildRKG(ghost, { compressed = ghost.compressed } = {}) {
  const header = ghost.header.slice();
  writeTime(header, 0x04, ghost.time);
  setBits(header, 0x07 * 8, 6, ghost.track);
  setBits(header, 0x08 * 8, 6, ghost.vehicle);
  setBits(header, 0x08 * 8 + 6, 6, ghost.character);
  setBits(header, 0x09 * 8 + 4, 7, ghost.year - 2000);
  setBits(header, 0x0A * 8 + 3, 4, ghost.month);
  setBits(header, 0x0A * 8 + 7, 5, ghost.day);
  setBits(header, 0x0B * 8 + 4, 4, ghost.controller);
  setBits(header, 0x0C * 8 + 4, 1, compressed ? 1 : 0);
  setBits(header, 0x0C * 8 + 7, 7, ghost.ghostType);
  setBits(header, 0x0D * 8 + 6, 1, ghost.automatic ? 1 : 0);
  header[0x10] = ghost.laps;
  ghost.splits.forEach((split, i) => writeTime(header, 0x11 + i * 3, split));
  header[0x34] = ghost.country;
  const input = encodeInputs(ghost.inputs);
  header[0x0E] = input.length >> 8; header[0x0F] = input.length & 255;
  let body;
  if (compressed) {
    const packed = yaz0Compress(input);
    packed[3] = 0x31;
    const padded = (packed.length + 3) & ~3;
    if (padded > RKG_INPUT_LIMIT) throw new Error('These inputs do not fit in a ghost once compressed');
    body = new Uint8Array(4 + padded);
    body[0] = padded >>> 24; body[1] = (padded >>> 16) & 255; body[2] = (padded >>> 8) & 255; body[3] = padded & 255;
    body.set(packed, 4);
  } else {
    body = new Uint8Array(RKG_INPUT_LIMIT);
    body.set(input);
  }
  const out = new Uint8Array(RKG_HEADER_SIZE + body.length + 4);
  out.set(header);
  out.set(body, RKG_HEADER_SIZE);
  const crc = crc32(out.subarray(0, RKG_HEADER_SIZE + body.length));
  out[out.length - 4] = crc >>> 24; out[out.length - 3] = (crc >>> 16) & 255; out[out.length - 2] = (crc >>> 8) & 255; out[out.length - 1] = crc & 255;
  return out;
}

// A ghost ready for a position of the game: its track and type are those of the position, and it is
// compressed, as all the game's own are.
export function ghostForSlot(data, track, ghostType) {
  return buildRKG({ ...parseRKG(data), track, ghostType }, { compressed: true });
}

// ---- rksys.dat -------------------------------------------------------------------------------
const SAVE_SIZE = 0x2BC000, LICENSE_OFFSET = 8, LICENSE_SIZE = 0x8CC0, SAVE_CRC_AT = 0x27FFC;
const GHOST_BLOCKS = [0x28000, 0xCD000, 0x172000, 0x217000];
const DOWNLOADED_AT = 0x50000;

export function isSaveFile(data) {
  return data.length === SAVE_SIZE && data[0] === 0x52 && data[1] === 0x4B && data[2] === 0x53 && data[3] === 0x44;
}

// A save being written reads as damaged until the game has finished.
export const saveComplete = (data) => isSaveFile(data) && u32(data, SAVE_CRC_AT) === crc32(data.subarray(0, SAVE_CRC_AT));

// The ghosts a save's licenses mark as present. Slots of deleted ones can still hold old data.
export function saveGhosts(data) {
  if (!isSaveFile(data)) throw new Error('This is not a Mario Kart Wii save (rksys.dat)');
  const ghosts = [];
  GHOST_BLOCKS.forEach((block, license) => {
    const at = LICENSE_OFFSET + license * LICENSE_SIZE;
    if (data[at] !== 0x52 || data[at + 1] !== 0x4B) return;
    [['personal', u32(data, at + 4), 0], ['downloaded', u32(data, at + 8), DOWNLOADED_AT]].forEach(([kind, flags, base]) => {
      for (let slot = 0; slot < 32; slot++) {
        if (!(Math.floor(flags / 2 ** slot) & 1)) continue;
        const offset = block + base + slot * RKG_SAVE_SLOT, bytes = data.subarray(offset, offset + RKG_SAVE_SLOT);
        if (!isRKG(bytes)) continue;
        ghosts.push({ key: `${license}/${kind}/${slot}`, license, kind, slot, offset, crc: crc32(bytes) });
      }
    });
  });
  return ghosts;
}

export const saveGhostBytes = (data, entry) => data.slice(entry.offset, entry.offset + RKG_SAVE_SLOT);
