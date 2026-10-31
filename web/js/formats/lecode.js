// LE-CODE binaries (rel/lecode-PAL.bin, -USA, -JAP, -KOR): Wiimm's engine for custom track
// distributions with many cups. Layout from Wiimm's SZS Tools (src/lib-lecode.h, lib-lecode.c):
//
// 'LECT' header; the u32 at 0x18 is the offset of the LPAR section. LPAR ('LPAR', version, size,
// offset of end of data, then offsets — relative to LPAR — of: cup parameters, racing cup tracks,
// battle cup arenas, course parameters, properties, music, flags).
// Cup parameters: 'CUP2', racing cup count (u32), battle cup count (u32).
// Racing cup tracks: 4 slot numbers (u32) per cup; battle cups: 5 per cup.
// Course parameters: 'CRS2', slot count (u32). Per slot: property (u8, the original track whose
// behaviour it has), music (u8) and flags (u16 since build 35, u8 before).
// The space between two sections is reserved by the distribution tool: cups and slots can be added
// in place while they fit.
//
// Track files are Race/Course/<slot as 3 hex digits>.szs (4 digits when LPAR slot_04x is set),
// names are in Common.bmg: track 0x7000 + slot, racing cup 0x6800 + cup. Cup icons are one image
// (ct_icons.tpl, 128 pixels wide, one icon under the other) in the menu archives.

export function isLECode(data) {
  return data?.length >= 0x20 && data[0] === 0x4c && data[1] === 0x45 && data[2] === 0x43 && data[3] === 0x54;
}

const SECTIONS = ['eod', 'cupPar', 'cupTrack', 'cupArena', 'coursePar', 'property', 'music', 'flags'];

export function parseLECode(data) {
  if (!isLECode(data)) throw new Error('Not an LE-CODE binary (lecode-*.bin)');
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const param = v.getUint32(0x18);
  if (String.fromCharCode(...data.subarray(param, param + 4)) !== 'LPAR') throw new Error('LE-CODE binary without parameters (LPAR)');
  const off = {};
  SECTIONS.forEach((name, i) => { const o = v.getUint32(param + 0x10 + i * 4); off[name] = o ? param + o : 0; });
  if (!off.cupPar || !off.coursePar || !off.cupTrack || !off.property || !off.music) throw new Error('This LE-CODE binary has no cup or track tables');
  const magic = (at) => String.fromCharCode(...data.subarray(at, at + 4));
  if (magic(off.cupPar) !== 'CUP2' || magic(off.coursePar) !== 'CRS2') throw new Error('Unknown LE-CODE cup or course table');
  const racingCups = v.getUint32(off.cupPar + 4), battleCups = v.getUint32(off.cupPar + 8);
  const slotCount = v.getUint32(off.coursePar + 4);
  // Capacity of a table: up to the next section.
  const starts = Object.values(off).filter(Boolean).sort((a, b) => a - b);
  const room = (at) => (starts.find((s) => s > at) ?? data.length) - at;
  // The version text ("v5 b40R PAL 2024-02-17 …") is in the header; its place depends on the header version.
  const head = /v\d+ b\d+\w* [A-Z]{3}[^\0]*/.exec(String.fromCharCode(...data.subarray(0, Math.min(param, 0x200))))?.[0] || '';
  const buildNumber = Number(/\bb(\d+)/.exec(head)?.[1] || 0);
  // Flags are 16-bit since build 35: then their table is twice as long as the property table.
  const perSlot = Math.min(room(off.property), room(off.music));
  const flagBytes = off.flags ? (Math.round(room(off.flags) / perSlot) >= 2 ? 2 : 1) : 2;
  const cups = [];
  for (let c = 0; c < racingCups; c++) cups.push([0, 1, 2, 3].map((k) => v.getUint32(off.cupTrack + (c * 4 + k) * 4)));
  const slots = [];
  for (let s = 0; s < slotCount; s++) {
    slots.push({
      property: data[off.property + s], music: data[off.music + s],
      flags: off.flags ? (flagBytes === 2 ? v.getUint16(off.flags + s * 2) : data[off.flags + s]) : 0,
    });
  }
  return {
    data, version: head, build: buildNumber, param, off, cups, battleCups, slots, flagBytes,
    capacity: {
      cups: Math.floor(room(off.cupTrack) / 16),
      slots: Math.min(perSlot, off.flags ? Math.floor(room(off.flags) / flagBytes) : Infinity),
    },
  };
}

// The binary with new racing cups (lists of 4 slots) and slots (property, music, flags), written
// in place: everything else, including the reserved space, stays as it was.
export function buildLECode(le, cups, slots) {
  if (cups.length > le.capacity.cups) throw new Error(`This LE-CODE binary has room for ${le.capacity.cups} cups`);
  if (slots.length > le.capacity.slots) throw new Error(`This LE-CODE binary has room for ${le.capacity.slots} tracks`);
  const out = le.data.slice(), v = new DataView(out.buffer);
  v.setUint32(le.off.cupPar + 4, cups.length);
  cups.forEach((list, c) => list.forEach((slot, k) => v.setUint32(le.off.cupTrack + (c * 4 + k) * 4, slot)));
  for (let c = cups.length; c < le.cups.length; c++) for (let k = 0; k < 4; k++) v.setUint32(le.off.cupTrack + (c * 4 + k) * 4, 0);
  v.setUint32(le.off.coursePar + 4, slots.length);
  slots.forEach((s, i) => {
    out[le.off.property + i] = s.property;
    out[le.off.music + i] = s.music;
    if (le.off.flags) { if (le.flagBytes === 2) v.setUint16(le.off.flags + i * 2, s.flags); else out[le.off.flags + i] = s.flags; }
  });
  return out;
}

// Slot numbers: 0x00–0x1f original tracks, 0x20–0x29 arenas, 0x2a–0x43 special and random slots,
// custom tracks from 0x44.
export const LE_FIRST_CUSTOM_SLOT = 0x44;
export const leTrackFile = (slot, wide = false) => `${slot.toString(16).padStart(wide ? 4 : 3, '0')}.szs`;
export const LE_IDS = { cup: 0x6800, track: 0x7000 };
