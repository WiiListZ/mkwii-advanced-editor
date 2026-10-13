// Game parameter files of Race/Common.szs, edited in place (every value keeps its size):
// kartParam.bin (vehicle stats), driverParam.bin (character bonuses, same layout) and ItemSlot.bin
// (item probabilities). Layout and meanings follow the Custom Mario Kart wiki (Tockdom) and the
// Mario Kart Wii decompilation; values nobody has documented are shown as unknown.

import { KCL_TYPES } from '../data/defs.js';

export const VEHICLES = [
  'Standard Kart S', 'Standard Kart M', 'Standard Kart L', 'Booster Seat', 'Classic Dragster', 'Offroader', 'Mini Beast', 'Wild Wing',
  'Flame Flyer', 'Cheep Charger', 'Super Blooper', 'Piranha Prowler', 'Tiny Titan', 'Daytripper', 'Jetsetter', 'Blue Falcon',
  'Sprinter', 'Honeycoupe', 'Standard Bike S', 'Standard Bike M', 'Standard Bike L', 'Bullet Bike', 'Mach Bike', 'Flame Runner',
  'Bit Bike', 'Sugarscoot', 'Wario Bike', 'Quacker', 'Zip Zip', 'Shooting Star', 'Magikruiser', 'Sneakster', 'Spear', 'Jet Bubble',
  'Dolphin Dasher', 'Phantom',
];
export const CHARACTERS = [
  'Mario', 'Baby Peach', 'Waluigi', 'Bowser', 'Baby Daisy', 'Dry Bones', 'Baby Mario', 'Luigi', 'Toad', 'Donkey Kong', 'Yoshi', 'Wario',
  'Baby Luigi', 'Toadette', 'Koopa Troopa', 'Daisy', 'Peach', 'Birdo', 'Diddy Kong', 'King Boo', 'Bowser Jr.', 'Dry Bowser', 'Funky Kong',
  'Rosalina',
];
export const ITEMS = [
  'Green Shell', 'Red Shell', 'Banana', 'Fake Item Box', 'Mushroom', 'Triple Mushroom', 'Bob-omb', 'Blue Shell', 'Lightning', 'Star',
  'Golden Mushroom', 'Mega Mushroom', 'Blooper', 'POW Block', 'Thunder Cloud', 'Bullet Bill', 'Triple Green Shells', 'Triple Red Shells',
  'Triple Bananas',
];

const ENTRY = 0x18c;
const kcl = (i) => KCL_TYPES[i]?.name || `Collision type 0x${i.toString(16).padStart(2, '0')}`;

// [offset, type, label, description, options?]
const STATS = [
  [0x00, 'u32', 'Wheels', 'How many wheels the game simulates for physics and tyre effects. 0 = four (karts), 1 = two (bikes), 2 = two (alternative), 3 = three (used by Blue Falcon).', [[0, 'Four (kart)'], [1, 'Two (bike)'], [2, 'Two (alternative)'], [3, 'Three']]],
  [0x04, 'u32', 'Drift type', 'Which drift the vehicle uses: karts and some bikes drift outwards, sport bikes lean inwards and take tighter lines.', [[0, 'Outside drift (kart)'], [1, 'Outside drift (bike)'], [2, 'Inside drift (bike)']]],
  [0x08, 'u32', 'Weight class', 'Size class: decides which characters can use the vehicle in menus and how it compares in collisions.', [[0, 'Small'], [1, 'Medium'], [2, 'Large']]],
  [0x0c, 'f32', 'Unknown 0x0C', 'Not documented. Every vehicle has 50 here (characters 0); changing it is not recommended.'],
  [0x10, 'f32', 'Weight', 'Mass in collisions: a heavier vehicle pushes lighter ones away and is pushed less.'],
  [0x14, 'f32', 'Bump deviation', 'How far the vehicle is knocked sideways when it bumps into other racers.'],
  [0x18, 'f32', 'Top speed', 'Base top speed on normal road (before the character bonus and the engine class multiplier).'],
  [0x1c, 'f32', 'Speed while turning', 'Part of the top speed kept while steering (1 = no speed lost in turns).'],
  [0x20, 'f32', 'Tilt', 'How much the body visually leans when turning.'],
  [0x24, 'f32', 'Acceleration A0', 'Acceleration from standstill up to the T1 speed ratio. Higher = quicker start.'],
  [0x28, 'f32', 'Acceleration A1', 'Acceleration between the T1 and T2 speed ratios.'],
  [0x2c, 'f32', 'Acceleration A2', 'Acceleration between the T2 and T3 speed ratios.'],
  [0x30, 'f32', 'Acceleration A3', 'Acceleration above the T3 speed ratio, up to top speed.'],
  [0x34, 'f32', 'Acceleration T1', 'Speed ratio (part of top speed, 0–1) where acceleration changes from A0 to A1.'],
  [0x38, 'f32', 'Acceleration T2', 'Speed ratio where acceleration changes from A1 to A2.'],
  [0x3c, 'f32', 'Acceleration T3', 'Speed ratio where acceleration changes from A2 to A3.'],
  [0x40, 'f32', 'Drift acceleration A0', 'Acceleration while drifting, below the drift T1 speed ratio.'],
  [0x44, 'f32', 'Drift acceleration A1', 'Acceleration while drifting, above the drift T1 speed ratio.'],
  [0x48, 'f32', 'Drift acceleration T1', 'Speed ratio where the drift acceleration changes from A0 to A1.'],
  [0x4c, 'f32', 'Manual handling', 'Steering strength with manual controls (Classic, GameCube, Nunchuk). Higher = sharper turns.'],
  [0x50, 'f32', 'Automatic handling', 'Steering strength with automatic drift.'],
  [0x54, 'f32', 'Handling reactivity', 'How quickly steering responds to the stick (1 = instantly).'],
  [0x58, 'f32', 'Manual drift', 'Turning strength while drifting with manual controls. Higher = tighter drifts.'],
  [0x5c, 'f32', 'Automatic drift', 'Turning strength of the automatic drift.'],
  [0x60, 'f32', 'Drift reactivity', 'How quickly the drift responds to the stick.'],
  [0x64, 'f32', 'Outside drift angle', 'Target angle (degrees) the vehicle body turns to during an outside drift.'],
  [0x68, 'f32', 'Outside drift decrement', 'How fast the outside drift angle returns when the drift is released.'],
  [0x6c, 'u32', 'Mini-Turbo duration', 'How long the boost of a Mini-Turbo lasts, in frames (60 frames = 1 second). Higher = longer boost after a drift.'],
];
const TAIL = [
  [0x170, 'f32', 'Unknown 0x170', 'Not documented (item and collision related according to the decompilation). Changing it is not recommended.'],
  [0x174, 'f32', 'Unknown 0x174', 'Not documented. Changing it is not recommended.'],
  [0x178, 'f32', 'Unknown 0x178', 'Not documented. Changing it is not recommended.'],
  [0x17c, 'f32', 'Unknown 0x17C', 'Not documented. Changing it is not recommended.'],
  [0x180, 'f32', 'Unknown 0x180', 'Not documented. Changing it is not recommended.'],
  [0x184, 'f32', 'Unknown 0x184 (Mega Mushroom size?)', 'Believed to be the size multiplier while a Mega Mushroom is active (name from the decompilation, not verified). Changing it is not recommended.'],
  [0x188, 'f32', 'Unknown 0x188', 'Not documented. Changing it is not recommended.'],
];

export const STAT_FIELDS = [
  ...STATS.map(([at, type, label, help, options]) => ({ key: `0x${at.toString(16)}`, at, type, label, help, options, group: 'Stats' })),
  ...Array.from({ length: 32 }, (_, i) => ({ key: `speed${i}`, at: 0x70 + i * 4, type: 'f32', group: 'Speed on each surface',
    label: kcl(i), help: `Top speed multiplier on ${kcl(i)} (1 = full speed, 0.5 = half). Off-road surfaces slow down this way.` })),
  ...Array.from({ length: 32 }, (_, i) => ({ key: `turn${i}`, at: 0xf0 + i * 4, type: 'f32', group: 'Turning on each surface',
    label: kcl(i), help: `Steering multiplier on ${kcl(i)}: how well the vehicle turns on this surface.` })),
  ...TAIL.map(([at, type, label, help]) => ({ key: `0x${at.toString(16)}`, at, type, label, help, group: 'Other' })),
];

const view = (d) => new DataView(d.buffer, d.byteOffset, d.byteLength);

export function isStatsFile(name, data) {
  if (!/(kart|driver)Param\.bin$/i.test(name) || data.length < 4) return false;
  const count = view(data).getUint32(0);
  return count > 0 && 4 + count * ENTRY === data.length;
}
export const isItemSlot = (name, data) => /ItemSlot\.bin$/i.test(name) && itemTablesEnd(data) === data.length;

// Vehicle or character names for each entry (Miis: by size class, from the data).
export function statEntries(name, data) {
  const v = view(data), count = v.getUint32(0), vehicles = /kartParam/i.test(name);
  return Array.from({ length: count }, (_, i) => {
    if (vehicles) return VEHICLES[i] || `Vehicle ${i}`;
    if (CHARACTERS[i]) return CHARACTERS[i];
    return `Mii (${['small', 'medium', 'large'][v.getUint32(4 + i * ENTRY + 8)] || `#${i}`})`;
  });
}

export function readStat(data, index, field) {
  const v = view(data), o = 4 + index * ENTRY + field.at;
  return field.type === 'u32' ? v.getUint32(o) : v.getFloat32(o);
}

export function writeStat(data, index, field, value) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${field.label}: not a number`);
  const out = data.slice(), v = view(out), o = 4 + index * ENTRY + field.at;
  if (field.type === 'u32') v.setUint32(o, Math.max(0, Math.round(n))); else v.setFloat32(o, n);
  return out;
}

// ---- ItemSlot.bin: table count, then per table: columns, rows (19 items), one byte per cell ----

function itemTablesEnd(data) {
  if (!data.length) return -1;
  let p = 1;
  for (let i = 0; i < data[0]; i++) {
    if (p + 2 > data.length) return -1;
    p += 2 + data[p] * data[p + 1];
  }
  return p;
}

export function parseItemSlot(data) {
  const tables = [];
  let p = 1;
  const raceCount = (() => { let q = 1, n = 0; for (let i = 0; i < data[0]; i++) { if (data[q] === 12) n++; q += 2 + data[q] * data[q + 1]; } return n; })();
  let race = 0, battle = 0;
  for (let i = 0; i < data[0]; i++) {
    const columns = data[p], rows = data[p + 1];
    const kind = columns === 12 ? 'race' : columns === 3 ? 'battle' : 'special';
    const label = kind === 'race' ? `Race table ${++race} of ${raceCount}` : kind === 'battle' ? `Battle table ${++battle}` : 'Fixed item boxes';
    const help = kind === 'race'
      ? 'Chance of each item (rows) for each race position (columns, 1st to 12th). Values are weights: an item with 40 is twice as likely as one with 20 in the same position.'
      : kind === 'battle'
        ? 'Chance of each item in battle (columns: three groups of standings, leading to trailing). Values are weights.'
        : 'Item boxes set to give a fixed item: each column is one item-box setting and its item gets the weight. Changing it is rarely needed.';
    tables.push({ index: i, offset: p + 2, columns, rows, kind, label, help,
      columnLabels: kind === 'race' ? Array.from({ length: columns }, (_, c) => `${c + 1}${['st', 'nd', 'rd'][c] || 'th'}`) : kind === 'battle' ? ['Ahead', 'Middle', 'Behind'] : Array.from({ length: columns }, (_, c) => `#${c}`),
      values: Array.from({ length: rows }, (_, r) => [...data.subarray(p + 2 + r * columns, p + 2 + (r + 1) * columns)]) });
    p += 2 + columns * rows;
  }
  return tables;
}

export function writeItemSlot(data, table, row, column, value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 0 || n > 255) throw new Error('Item weights go from 0 to 255');
  const t = parseItemSlot(data)[table];
  if (!t || row >= t.rows || column >= t.columns) throw new Error('Unknown item table cell');
  const out = data.slice();
  out[t.offset + row * t.columns + column] = n;
  return out;
}
