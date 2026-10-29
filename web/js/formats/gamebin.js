// Other game data files (.bin, .bcp, .bsp, .blight, .blmap) of Mario Kart Wii, edited in place (every value keeps its size, so
// the file keeps its layout). Layouts and meanings follow the Custom Mario Kart wiki (mkwiiki.org,
// formerly wiki.tockdom.com): ObjFlow.bin, the four GeoHitTable files, kartCameraParam.bin,
// kartPartsDispParam.bin, bikePartsDispParam.bin, driverDispParam.bin, kartDriverDispParam.bin,
// miiDispParam.bin, kartAIActionParam.bin, kartAISpdParam.bin, DriverIKParam.bin, IconParam_*.bin,
// machine_para.bin, mission_ui_single.bin, DummyDistributionMap.bin, the opening cameras (.bcp) and
// the vehicle physics (.bsp), the lights (.blight) and light maps (.blmap). Values the wiki does not
// explain stay "Unknown". Any other .bin opens as a table of numbers whose layout is read from the
// data (count header, row size, decimal or whole numbers).

import { CHARACTERS, VEHICLES } from './params.js';

export const BIN_TYPES = { f32: 4, s32: 4, u32: 4, s16: 2, u16: 2, u8: 1 };
export const BIN_LIMITS = { s32: [-2147483648, 2147483647], u32: [0, 4294967295], s16: [-32768, 32767], u16: [0, 65535], u8: [0, 255] };

const view = (d) => new DataView(d.buffer, d.byteOffset, d.byteLength);
const hex = (n, pad = 2) => `0x${n.toString(16).toUpperCase().padStart(pad, '0')}`;
const cstr = (data, at, max) => {
  let s = '';
  for (let i = 0; i < max && data[at + i]; i++) s += String.fromCharCode(data[at + i]);
  return s;
};

export function readBinValue(data, at, type) {
  const v = view(data);
  switch (type) {
    case 'f32': return v.getFloat32(at);
    case 's32': return v.getInt32(at);
    case 'u32': return v.getUint32(at);
    case 's16': return v.getInt16(at);
    case 'u16': return v.getUint16(at);
    default: return data[at];
  }
}

export function writeBinValue(data, at, type, value) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error('Not a number');
  if (at < 0 || at + BIN_TYPES[type] > data.length) throw new Error('Value outside the file');
  const out = data.slice(), v = view(out);
  if (type === 'f32') { v.setFloat32(at, n); return out; }
  const [min, max] = BIN_LIMITS[type], i = Math.round(n);
  if (i < min || i > max) throw new Error(`Whole numbers from ${min} to ${max}`);
  if (type === 's32') v.setInt32(at, i);
  else if (type === 'u32') v.setUint32(at, i);
  else if (type === 's16') v.setInt16(at, i);
  else if (type === 'u16') v.setUint16(at, i);
  else out[at] = i;
  return out;
}

// Nintendo LZ77 (type 0x10): the header holds the size once decompressed (little endian).
export function isCompressedBin(data) {
  if (data.length < 8 || data[0] !== 0x10) return false;
  const size = data[1] | (data[2] << 8) | (data[3] << 16);
  return size > data.length && size < data.length * 64;
}

// Character IDs 0x00–0x2F (mkwiiki: List of Identifiers).
const MIIS = ['Small', 'Medium', 'Large'].flatMap((size) => ['A', 'B', 'C'].flatMap((outfit) => ['male', 'female'].map((sex) => `${size} Mii, outfit ${outfit} (${sex})`)));
export const CHARACTER_IDS = [...CHARACTERS, ...MIIS, 'Medium Mii', 'Small Mii', 'Large Mii', 'Peach (menu)', 'Daisy (menu)', 'Rosalina (menu)'];

// ---- Field helpers: offsets are relative to the start of a row ----

const F = (off, label, help = '', type = 'f32', options) => ({ off, label, help, type, options });
const XYZ = (off, label, axes = 'XYZ', help = '') => [...axes].map((axis, i) => F(off + i * 4, `${label} ${axis}`, help));
const UNKNOWN = (from, to, type = 'f32') => Array.from({ length: (to - from) / BIN_TYPES[type] }, (_, i) => F(from + i * BIN_TYPES[type], `Unknown ${hex(from + i * BIN_TYPES[type])}`, 'Not documented.', type));

// A documented layout: `count` rows of `rowSize` bytes from `start`, each with the same fields.
function rowsTable({ kind = 'schema', title, help, rowsLabel = 'entries', start, count, rowSize, rowName, fields, data, extraRows = [] }) {
  const rows = [...extraRows];
  for (let r = 0; r < count; r++) {
    const base = start + r * rowSize;
    if (base + rowSize > data.length) break;
    rows.push({ label: rowName(r), sub: `offset ${hex(base, 4)}`,
      fields: fields.map((f) => ({ ...f, at: base + f.off, offset: f.off })) });
  }
  return { kind, title, help, rowsLabel, rows };
}

// ---- ObjFlow.bin: u16 count, 0x74-byte entries, then a table from object ID to entry index ----

const OBJFLOW_ENTRY = 0x74;
const CLIPPING = [[0x00, 'Always active'], [0x01, 'Active, off beyond the draw distance'], [0x02, 'Off, on within the draw distance'],
  [0x08, 'Off, on within the draw distance or by AREA types 8 and 9'], [0x09, 'Like 0x01, AREA checked every 8 frames'],
  [0x0a, 'Like 0x02'], [0x0b, 'Like 0x08, AREA checked every 8 frames']].map(([v, label]) => [v, `${hex(v)} · ${label}`]);
const SOLIDITY = [[0, 'Not solid'], [1, 'Sphere'], [2, 'Cylinder'], [3, 'Box'], [4, 'May use a KCL'], [5, 'Internal KCL']].map(([v, label]) => [v, `${v} · ${label}`]);
const OBJFLOW_FIELDS = [
  F(0x62, 'Sound setting', 'Sound related; the game uses 1, 2 or 3.', 'u16'),
  F(0x64, 'Clipping', 'When the object is active, compared with the draw distances below.', 's16', CLIPPING),
  F(0x66, 'Backward draw distance', '', 's16'),
  F(0x68, 'Forward draw distance', '', 's16'),
  F(0x6a, 'Solidity', 'Shape of the object\'s own collision; the three sizes below depend on it.', 'u16', SOLIDITY),
  F(0x6c, 'Solidity size 1', 'Sphere: radius. Cylinder: radius. Box: X size (half: double it for the real size).', 's16'),
  F(0x6e, 'Solidity size 2', 'Cylinder: height. Box: Y size (half).', 's16'),
  F(0x70, 'Solidity size 3', 'Box: Z size (half).', 's16'),
  F(0x72, 'Unknown 0x72', 'Not documented; 1 for startline2D and DKrockGC, 0 for the others.', 'u16'),
];

export function isObjFlow(name, data) {
  if (!/ObjFlow\.bin$/i.test(name) || data.length < 2 + OBJFLOW_ENTRY) return false;
  const count = view(data).getUint16(0);
  return count > 0 && 2 + count * OBJFLOW_ENTRY <= data.length;
}

function objFlowTable(data) {
  const v = view(data), count = v.getUint16(0);
  const rows = Array.from({ length: count }, (_, i) => {
    const base = 2 + i * OBJFLOW_ENTRY, id = v.getUint16(base);
    const name = cstr(data, base + 2, 0x20), resources = cstr(data, base + 0x22, 0x40);
    return {
      label: name || `Object ${hex(id, 3)}`, sub: `${hex(id, 3)} · ${resources && resources !== '-' ? resources : 'no resources'}`,
      fields: [
        { label: 'Object ID', text: hex(id, 3), help: 'The number KMP objects use for this type.' },
        { label: 'Name', text: name, help: 'Internal name of the object type.' },
        { label: 'Resources', text: resources || '-', help: 'BRRES, BREFF/BREFT, BRASD and KCL files the object needs, separated by ";". "-" for sound, 2D and competition objects.' },
        ...OBJFLOW_FIELDS.map((f) => ({ ...f, at: base + f.off, offset: f.off })),
      ],
    };
  });
  return { kind: 'objflow', title: 'Object types', rowsLabel: 'objects',
    help: 'Every object type of the game. The name and resources are shown for reference; the numbers can be changed. The table after the entries (object ID → entry) is kept as it is.', rows };
}

// ---- GeoHitTable*.bin: u16 rows, u16 columns, rows of (u16 object ID, columns × u16), ID table ----

const KART_REACTIONS = [[0, 'Nothing'],
  ...[1, 2, 3, 4, 5, 6].map((n) => [n, 'Solid wall, only with collision (unused)']), [7, 'Pass through (unused)'],
  [8, 'Wall; sparks and sound above speed 30'], [9, 'Spin (unused)'], [10, 'Spin at some speeds; silent wall when slow'], [11, 'Fire spin'],
  [12, 'Pass through at some speeds; silent wall when slow (unused)'], [13, 'Small launch upwards'],
  [14, 'Knockback when still at some speed, silent wall when moving; item lost'], [15, 'Launch with one bounce (unused); item lost'],
  [16, 'Knockback with one bounce; item lost'], [17, 'Long crush; item lost'], [18, 'Small push towards the player'], [19, 'Large push towards the player'],
  [20, 'Spin that bumps and shrinks the player'], [21, 'High launch; item lost'], [22, 'Spin at some speed'],
  [23, 'Weak solid wall, only with collision'], [24, 'Solid wall, only with collision'], [25, 'Launch upwards'],
  [26, 'Wall; sparks and sound above speed 30'], [27, 'Rubber wall'], [28, 'Solid wall, only with collision'],
  [29, 'Untrickable jump pad (unused)'], [30, 'Short crush; item lost'], [31, 'Crush, then respawn (unused); item lost'],
  [32, 'Explosion launch; item lost']].map(([v, label]) => [v, `${hex(v)} · ${label}`]);
const OBJECT_REACTIONS = [[0, 'Nothing'], [3, 'Special (object specific)'], [5, 'Object state 1'], [6, 'Object state 2']].map(([v, label]) => [v, `${v} · ${label}`]);
const ITEM_REACTIONS = [[0, 'Item passes through'], [1, 'Item bounces off (a Red Shell like a Green Shell)'], [2, 'Item breaks']].map(([v, label]) => [v, `${v} · ${label}`]);
const POWER_UPS = ['No power-up', 'Star', 'Mega Mushroom', 'Bullet Bill'];
const HIT_ITEMS = ['Green Shell', 'Red Shell', 'Banana', 'Mushroom', 'Star', 'Blue Shell', 'Lightning', 'Fake Item Box', 'Mega Mushroom', 'Bob-omb', 'Blooper', 'POW Block', 'Golden Mushroom', 'Bullet Bill', 'Thunder Cloud'];

export function isGeoHitTable(name, data) {
  if (!/GeoHitTable/i.test(name) || data.length < 4) return false;
  const v = view(data), rows = v.getUint16(0), cols = v.getUint16(2);
  return rows > 0 && cols > 0 && cols <= 64 && 4 + rows * (2 + cols * 2) <= data.length;
}

function geoHitTable(name, data, objectNames) {
  const v = view(data), count = v.getUint16(0), cols = v.getUint16(2), rowSize = 2 + cols * 2;
  const items = /Item/i.test(name), onObject = /Obj\.bin$/i.test(name);
  const columns = items ? HIT_ITEMS : POWER_UPS;
  const options = onObject ? OBJECT_REACTIONS : items ? ITEM_REACTIONS : KART_REACTIONS;
  const what = items
    ? onObject ? 'What each item does to the object (Blue Shell and Bob-omb also when they explode, Lightning and POW Block when used).' : 'What happens to each item when it touches the object.'
    : onObject ? 'What happens to the object when a player touches it, with each power-up.' : 'What happens to the player who touches the object, with each power-up. Star, Mega Mushroom and Bullet Bill ignore damage.';
  const rows = Array.from({ length: count }, (_, r) => {
    const base = 4 + r * rowSize, id = v.getUint16(base);
    return {
      label: objectNames?.[id] || `Object ${hex(id, 3)}`, sub: hex(id, 3),
      fields: Array.from({ length: cols }, (_, c) => ({ label: columns[c] || `Value ${c + 1}`, at: base + 2 + c * 2, offset: 2 + c * 2, type: 'u16', options, help: '' })),
    };
  });
  return { kind: 'geohit', title: items ? 'Object and item reactions' : 'Object and player reactions', rowsLabel: 'objects',
    help: `${what} One row per object type. Values other than those listed are ignored by the game or can freeze it.`, rows };
}

// ---- Documented tables ----

const CAMERAS = ['1, 3 or 4 players · 4:3', '1, 3 or 4 players · 16:9', '2 players · 4:3', '2 players · 16:9'];
const CAMERA_ROWS = ['race', 'battle', 'missions and tournaments with the camera from above'].flatMap((mode) => ['Small', 'Medium', 'Large'].map((size) => `${size} vehicles · ${mode}`));
const KART_PIPES = [[0, 'Two pipes'], [1, 'Left pipe'], [2, 'Right pipe'], [3, 'No pipes']];
const BIKE_PIPES = [[-1, 'No pipes'], [0, 'Two pipes'], [1, 'Left pipe'], [2, 'Right pipe']];
const KART_PARTS = [
  F(0x000, 'Camera target height', 'Vertical distance of the camera target.'), F(0x004, 'Tyre rotation forwards'), F(0x008, 'Tyre rotation backwards'),
  ...UNKNOWN(0x00c, 0x03c), ...XYZ(0x03c, 'Rear tyre scale'), ...XYZ(0x048, 'Front control arm position'), ...XYZ(0x054, 'Front control arm rotation'),
  ...XYZ(0x060, 'Rear control arm position'), F(0x06c, 'Rear control arm rotation X'), ...UNKNOWN(0x070, 0x0a8),
  ...XYZ(0x0a8, 'Front suspension top'), ...XYZ(0x0b4, 'Front suspension bottom (inverse)', 'XY'),
  ...XYZ(0x0bc, 'Rear suspension top'), ...XYZ(0x0c8, 'Rear suspension bottom (inverse)', 'XY'), ...UNKNOWN(0x0d0, 0x0f8),
  F(0x0f8, 'Exhaust set 1 pipes', 'Values other than 0, 1 and 2 hide the pipes.', 's32', KART_PIPES), ...XYZ(0x0fc, 'Exhaust set 1 position'), ...XYZ(0x108, 'Exhaust set 1 rotation', 'XY'),
  F(0x110, 'Exhaust set 2 pipes', 'Values other than 0, 1 and 2 hide the pipes.', 's32', KART_PIPES), ...XYZ(0x114, 'Exhaust set 2 position'), ...XYZ(0x120, 'Exhaust set 2 rotation', 'XY'),
  ...XYZ(0x128, 'Ice size'), ...XYZ(0x134, 'Ice position'), ...XYZ(0x140, 'Balloon position', 'YZ'), ...UNKNOWN(0x148, 0x150),
];
const BIKE_PARTS = [
  F(0x00, 'Camera target height', 'Vertical distance of the camera target.'), F(0x04, 'Tyre rotation forwards'), F(0x08, 'Tyre rotation backwards'),
  ...XYZ(0x0c, 'Handle position'), ...XYZ(0x18, 'Handle rotation'), ...XYZ(0x24, 'Swingarm pivot'), ...UNKNOWN(0x30, 0x3c),
  ...XYZ(0x3c, 'Rear suspension pivot'), ...UNKNOWN(0x48, 0x54), F(0x54, 'Rear suspension rest-length scale'),
  F(0x58, 'Exhaust set 1 pipes', '0 or more than 2: two pipes.', 's32', BIKE_PIPES), ...XYZ(0x5c, 'Exhaust set 1 position'), ...XYZ(0x68, 'Exhaust set 1 rotation', 'XY'),
  F(0x70, 'Exhaust set 2 pipes', '0 or more than 2: two pipes.', 's32', BIKE_PIPES), ...XYZ(0x74, 'Exhaust set 2 position'), ...XYZ(0x80, 'Exhaust set 2 rotation', 'XY'),
  ...XYZ(0x88, 'Ice size'), ...XYZ(0x94, 'Ice position'), ...XYZ(0xa0, 'Balloon position', 'YZ'), ...UNKNOWN(0xa8, 0xb0),
];
const AI_ACTIONS = [['Rocket start', 'Getting the boost at the start.'], ['Engine burn-out', 'Burning out the engine after missing the start boost.'],
  ['Drift', 'Starting a drift in a curve or forced drift section.'], ['Mini-Turbo', 'Releasing a Mini-Turbo after a drift.'],
  ['Trick', 'Doing a trick.'], ['Wheelie', 'Doing a wheelie in a forced wheelie section.'], ['Unknown', 'Probably unused.'],
  ['Block the player', 'Moving in front of the player to block the way.']]
  .map(([label, help], i) => F(i * 4, `${label} chance (%)`, `${help} The action happens when a random number from 0 to 99 is below this value.`));
const IK_PARAMETERS = ['Speed ratio where the driving blend widens', 'Speed ratio where the driving blend narrows', 'Growth of the IK reach per frame',
  'Smoothing of reach changes per frame', 'leg_1 pitch, tilting forwards', 'leg_1 pitch, tilting backwards', 'leg_1 roll, tilting sideways',
  'leg_2 pitch, tilting forwards', 'leg_2 pitch, tilting backwards', 'leg_2 roll, tilting sideways', 'ankle_1 pitch, tilting forwards',
  'ankle_1 pitch, tilting backwards', 'ankle_1 roll, tilting sideways', '', '', 'Leg splay while waiting (bikes)', 'IK weight at the start of the wait animation',
  'IK weight increase per frame', '', '', 'Smoothing while driving', 'Smoothing while drifting', '', '', '', 'face_1 yaw limit', 'face_1 pitch limit',
  'face_1 cone half-angle limit', 'face_1 total deflection limit', '', '', ''].map((label, i) => label ? `Parameter ${i}: ${label}` : `Parameter ${i}`);
const STAT_NAMES = ['Speed', 'Weight', 'Acceleration', 'Handling', 'Drift', 'Off-road', 'Mini-Turbo'];
const SPEED_CLASSES = ['50cc', '100cc', '150cc', 'Mirror'], DIFFICULTIES = ['Easy', 'Normal', 'Hard'];

// Each documented file: when it applies, a short description and its table.
const SCHEMAS = [
  { test: (n, d) => /kartCameraParam\.bin$/i.test(n) && d.length === 9 * 0x40, description: 'Camera behind the vehicle',
    table: (d) => rowsTable({ data: d, title: 'Camera behind the vehicle', start: 0, count: 9, rowSize: 0x40, rowName: (r) => CAMERA_ROWS[r],
      help: 'The camera that follows the player, by vehicle size and mode, with one setting for each screen layout.',
      fields: CAMERAS.flatMap((cam, c) => [F(c * 16, `${cam} · field of view`), F(c * 16 + 4, `${cam} · distance`), F(c * 16 + 8, `${cam} · height (Y)`), F(c * 16 + 12, `${cam} · target height (Y)`)]) }) },
  { test: (n, d) => /kartPartsDispParam\.bin$/i.test(n) && d.length === 4 + 18 * 0x150, description: 'Kart parts (tyres, exhausts…)',
    table: (d) => rowsTable({ data: d, title: 'Kart parts', rowsLabel: 'karts', start: 4, count: 18, rowSize: 0x150, rowName: (r) => VEHICLES[r],
      help: 'Positions and sizes of the moving parts of each kart: tyres, control arms, suspensions, exhaust pipes, the ice block and the balloons.', fields: KART_PARTS }) },
  { test: (n, d) => /bikePartsDispParam\.bin$/i.test(n) && d.length === 4 + 18 * 0xb0, description: 'Bike parts (handle, exhausts…)',
    table: (d) => rowsTable({ data: d, title: 'Bike parts', rowsLabel: 'bikes', start: 4, count: 18, rowSize: 0xb0, rowName: (r) => VEHICLES[18 + r],
      help: 'Positions of the moving parts of each bike: handle, swingarm, suspension, exhaust pipes, the ice block and the balloons.', fields: BIKE_PARTS }) },
  { test: (n, d) => /(^|\/)driverDispParam\.bin$/i.test(n) && d.length === 4 + 48 * 16, description: 'Coin stack position',
    table: (d) => rowsTable({ data: d, title: 'Coin stack', rowsLabel: 'characters', start: 4, count: 48, rowSize: 16, rowName: (r) => CHARACTER_IDS[r],
      help: 'Where the coin stack is shown above each character (Coin Runners), relative to the driver.',
      fields: [F(0x0, 'Unused 0x00', 'Always 0.'), F(0x4, 'Unused 0x04', 'Always 0.'), F(0x8, 'Coin stack Y'), F(0xc, 'Coin stack Z')] }) },
  { test: (n, d) => /kartDriverDispParam\.bin$/i.test(n) && d.length === 8 + 36 * 48 * 56, description: 'Driver position on each vehicle',
    table: (d) => rowsTable({ data: d, title: 'Driver on the vehicle', rowsLabel: 'combinations', start: 8, count: 36 * 48, rowSize: 56,
      rowName: (r) => `${VEHICLES[Math.floor(r / 48)]} · ${CHARACTER_IDS[r % 48]}`,
      help: 'Where each character sits on each vehicle, and the bone values used by the animations with inverse kinematics. Combinations the game does not allow (a large character on a small vehicle) are 0.',
      fields: [...XYZ(0, 'Character position', 'YZ'), ...Array.from({ length: 12 }, (_, i) => F(8 + i * 4, `Bone value ${i + 1}`, 'Moves certain bones in the animations that use inverse kinematics.'))] }) },
  { test: (n, d) => /miiDispParam\.bin$/i.test(n) && d.length >= 4 && d.length === 4 + view(d).getUint32(0) * 12, description: 'Mii head size and position',
    table: (d) => rowsTable({ data: d, title: 'Mii head', start: 4, count: view(d).getUint32(0), rowSize: 12,
      rowName: (r) => r < 18 ? MIIS[r] + (r % 6 >= 4 ? ' (unused)' : '') : r < 22 ? `Unknown entry ${r + 1}` : `Entry ${r + 1} (always 0, maybe unused)`,
      help: 'Size and position of the Mii head on the driver body.', fields: [F(0, 'Head scale'), F(4, 'Head Y'), F(8, 'Head Z')] }) },
  { test: (n, d) => /kartAIActionParam\.bin$/i.test(n) && d.length === 36 * 0x20, description: 'CPU driver actions',
    table: (d) => rowsTable({ data: d, title: 'CPU driver actions', rowsLabel: 'CPU drivers', start: 0, count: 36, rowSize: 0x20,
      rowName: (r) => `${['Easy (50cc GP)', 'Normal (100cc GP)', 'Hard (150cc and Mirror GP)'][Math.floor(r / 12)]} · CPU ${r % 12 + 1}`,
      help: 'How often each CPU driver does each action, by difficulty. A course\'s AIParam.baa replaces the whole file.', fields: AI_ACTIONS }) },
  { test: (n, d) => /kartAISpdParam\.bin$/i.test(n) && d.length === 416 * 12, description: 'CPU driver speed',
    table: (d) => rowsTable({ data: d, title: 'CPU driver speed', start: 0, count: 416, rowSize: 12,
      rowName: (r) => r < 128 ? `Grand Prix · track slot ${Math.floor(r / 4) + 1} · ${SPEED_CLASSES[r % 4]}`
        : `${['50cc', '100cc', '150cc and Mirror'][Math.floor((r - 128) / 96)]} VS · track slot ${Math.floor(((r - 128) % 96) / 3) + 1} · ${DIFFICULTIES[(r - 128) % 3]}`,
      help: 'The soft speed limit of the CPU drivers on each track slot, by mode and class.',
      fields: [F(0, 'Offset speed', 'Added to 70 to get the starting speed limit.'), F(4, 'Gap rate', 'How much the limit depends on the distance to the human player.'), F(8, 'Minimum speed', 'The lowest speed limit a CPU driver can reach.')] }) },
  { test: (n, d) => /DriverIKParam\.bin$/i.test(n) && d.length >= 12 && view(d).getUint32(0) === 33 && d.length === 12 + 256 + view(d).getUint32(4) * view(d).getUint32(8) * 33, description: 'Driver animation (inverse kinematics)',
    table: (d) => {
      const vehicles = view(d).getUint32(4), characters = view(d).getUint32(8);
      const limits = { label: 'Limits', sub: 'offset 0x000C', fields: [
        ...IK_PARAMETERS.map((label, i) => ({ ...F(i * 4, `Maximum · ${label}`, 'Value of the parameter for weight 255.'), at: 12 + i * 4, offset: i * 4 })),
        ...IK_PARAMETERS.map((label, i) => ({ ...F(0x80 + i * 4, `Minimum · ${label}`, 'Value of the parameter for weight 0.'), at: 12 + 0x80 + i * 4, offset: 0x80 + i * 4 })),
      ] };
      return rowsTable({ data: d, title: 'Driver animation', start: 12 + 256, count: vehicles * characters, rowSize: 33, rowName: (r) => `Vehicle and character ${r + 1}`, extraRows: [limits],
        help: `One entry per vehicle and character combination (${vehicles} × ${characters}; their order is not documented). Each weight places its parameter between the minimum and maximum of the Limits row: value = minimum + weight / 255 × (maximum − minimum).`,
        fields: [F(0, 'Use these values', '0: the values come from IKParam.ikp instead.', 'u8', [[0, 'No (IKParam.ikp)'], [1, 'Yes']]),
          ...IK_PARAMETERS.map((label, i) => F(1 + i, `Weight · ${label}`, '0 = minimum, 255 = maximum.', 'u8'))] });
    } },
  { test: (n, d) => /IconParam_.*\.bin$/i.test(n) && d.length === 12 * 0x1c, description: 'Vehicle icons in the menus',
    table: (d) => rowsTable({ data: d, title: 'Vehicle icons', rowsLabel: 'vehicles', start: 0, count: 12, rowSize: 0x1c,
      rowName: (r) => r < 6 ? `Kart ${r + 1}` : `Bike ${r - 5}`,
      help: 'How each vehicle model is shown in its menu button. The file name gives the button width and height in pixels and the vehicle size (S, M, L); rows follow the menu from top to bottom.',
      fields: [F(0, 'Icon scale'), F(4, 'Rotation X (°)'), F(8, 'Rotation Y (°)'), F(12, 'Rotation Z (°)'), F(16, 'Position X'), F(20, 'Position Y'), F(24, 'Position Z')] }) },
  { test: (n, d) => /machine_para\.bin$/i.test(n) && d.length === (27 + 36) * 14, description: 'Stat bars in the menus',
    table: (d) => rowsTable({ data: d, title: 'Menu stat bars', start: 0, count: 63, rowSize: 14,
      rowName: (r) => r < 27 ? `Character ${r + 1}${CHARACTERS[r] ? ` (${CHARACTERS[r]}?)` : ''}` : VEHICLES[r - 27],
      help: 'The stat bars of the character and vehicle menus. They do not change the real stats (kartParam.bin and driverParam.bin). The order of the rows is not documented: the names assume the order of driverParam.bin and kartParam.bin.',
      fields: STAT_NAMES.map((label, i) => F(i * 2, label, '', 's16')) }) },
  { test: (n, d) => /mission_ui_single\.bin$/i.test(n) && d.length === 0x40 * 0xa, description: 'Mission mode levels',
    table: (d) => rowsTable({ data: d, title: 'Mission levels', rowsLabel: 'missions', start: 0, count: 0x40, rowSize: 0xa,
      rowName: (r) => `Mission ${Math.floor(r / 8) + 1}-${r % 8 + 1}`,
      help: 'The levels of the unfinished Mission mode. From mission 3-4 the scenario is 0xFFFF and the game freezes until it is changed.',
      fields: [F(0, 'Scenario', 'Entry of mission_single.kmt.', 'u16'), F(2, 'Level button text (BMG ID)', '', 'u16'), F(4, 'Objective text (BMG ID)', '', 'u16'),
        F(6, 'Tutorial text (BMG ID)', 'Also chooses the tutorial movie (ID − 3900) and its description (ID + 50).', 'u16'),
        F(8, 'Drift setting', '3 or more disables the OK button.', 'u16', [[0, 'Player chooses'], [1, 'Manual'], [2, 'Automatic']])] }) },
  { test: (n, d) => /DummyDistributionMap\.bin$/i.test(n) && d.length === 0x3000, description: 'Time Trial ranking placeholders',
    table: (d) => rowsTable({ data: d, title: 'Ranking placeholders', start: 0, count: 64, rowSize: 0xc0,
      rowName: (r) => `Track ${Math.floor(r / 2) + 1} · ${r % 2 ? 'worldwide' : 'regional'}`,
      help: 'Placeholder data of the Time Trial rankings, shown until the real rankings are downloaded. The champion\'s Mii data and the list after it are kept as they are.',
      fields: [F(0x00, 'Background Mii multiplier', 'Multiplies the number of Miis in the background.', 'u32'),
        F(0x04, 'Rank time limit · minutes', '', 'u16'), F(0x06, 'Rank time limit · seconds', '', 'u16'), F(0x08, 'Rank time limit · milliseconds', '', 'u16'),
        F(0x0a, 'Champion time · minutes', '', 'u16'), F(0x0c, 'Champion time · seconds', '', 'u16'), F(0x0e, 'Champion time · milliseconds', '', 'u16')] }) },
];

// ---- .bcp (Binary Camera Parameter): the camera that circles the player before the countdown ----

const BCP_USES = { race: 'Grand Prix, VS, Time Trial and most Competitions', battle: 'Battle', mission: 'widescreen Competitions and Tournaments', start: 'fallback when the others cannot be loaded' };
export const isBcp = (name, data) => /\.bcp$/i.test(name) && data.length === 0x130;

function bcpTable(name, data) {
  const at = (fields) => fields.map((f) => ({ ...f, at: f.off, offset: f.off }));
  const point = (i) => ({ label: `Point ${i}`, sub: `offset ${hex(0x3c + (i - 1) * 12, 4)}`, fields: at([...XYZ(0x3c + (i - 1) * 12, `Point ${i} position`), F(0xf0 + i * 4, `Speed from point ${i}`, i === 15 ? 'Speed after the last point.' : `Speed towards point ${i + 1}.`)]) });
  const use = BCP_USES[(name.split('/').pop() || '').replace(/_camera\.bcp$/i, '').toLowerCase()];
  return { kind: 'schema', title: 'Camera before the countdown', rowsLabel: 'parts',
    help: `The camera that circles the player before the countdown${use ? `, used for ${use}` : ''}: it goes from the start position through the points, at the speed set for each stretch.`,
    rows: [
      { label: 'Camera settings', sub: 'offset 0x0000', fields: at([
        F(0x00, 'Unknown 0x00', 'Always 0.', 's32'), F(0x04, 'First point to ignore', 'Points from this one (counting from 1) are not used. Nintendo uses 7, so the camera goes through points 1–6.', 'u16'),
        F(0x08, 'Speed bias', 'Added to the speed at each camera position.'), ...XYZ(0x0c, 'Scale of all points'), ...XYZ(0x18, 'Camera rotation'), ...XYZ(0x24, 'Start distance')]) },
      { label: 'Start', sub: 'offset 0x0030', fields: at([...XYZ(0x30, 'Start position'), F(0xf0, 'Speed from the start', 'Speed towards point 1.')]) },
      ...Array.from({ length: 15 }, (_, i) => point(i + 1)),
    ] };
}

// ---- .bsp (Binary Settings and Physics): the collision and suspension of one vehicle ----

const VEHICLE_CODES = ['sdf_kart', 'mdf_kart', 'ldf_kart', 'sa_kart', 'ma_kart', 'la_kart', 'sb_kart', 'mb_kart', 'lb_kart', 'sc_kart', 'mc_kart', 'lc_kart',
  'sd_kart', 'md_kart', 'ld_kart', 'se_kart', 'me_kart', 'le_kart', 'sdf_bike', 'mdf_bike', 'ldf_bike', 'sa_bike', 'ma_bike', 'la_bike', 'sb_bike', 'mb_bike',
  'lb_bike', 'sc_bike', 'mc_bike', 'lc_bike', 'sd_bike', 'md_bike', 'ld_bike', 'se_bike', 'me_bike', 'le_bike'];
const bspVehicle = (name) => VEHICLES[VEHICLE_CODES.indexOf((name.split('/').pop() || '').replace(/\.bsp$/i, '').toLowerCase())];
export const isBsp = (name, data) => /\.bsp$/i.test(name) && data.length === 0x25c;
const ON_OFF = [[0, 'No'], [1, 'Yes']];

function bspTable(name, data) {
  const vehicle = bspVehicle(name), bike = /_bike\.bsp$/i.test(name);
  const at = (base, fields) => fields.map((f) => ({ ...f, at: base + f.off, offset: f.off }));
  const hitbox = (i) => {
    const base = 0x04 + i * 0x18;
    return { label: `Hitbox ${i + 1}`, sub: `offset ${hex(base, 4)}`, fields: at(base, [
      F(0x00, 'Enabled', '', 'u16', ON_OFF), ...XYZ(0x04, 'Sphere centre'), F(0x10, 'Sphere radius'),
      F(0x14, 'Only collides with walls', '', 'u16', ON_OFF), F(0x16, 'Tyre collision index', '', 'u16')]) };
  };
  const wheel = (base, label, help) => ({ label, sub: `offset ${hex(base, 4)}`, fields: at(base, [
    F(0x00, 'Enabled', help, 'u16', ON_OFF), F(0x04, 'Spring stiffness', 'Multiplied by the distance from the lowest position.'),
    F(0x08, 'Damping', 'Multiplied by the vertical speed of the wheel.'), F(0x0c, 'Suspension travel', 'From the highest to the lowest wheel position.'),
    ...XYZ(0x10, 'Suspension top', 'XYZ', bike && label.startsWith('Front') ? 'Highest point of the wheel; for the front wheel of a bike, relative to the handle of bikePartsDispParam.bin.' : 'Highest point of the wheel.'),
    F(0x1c, 'Wheel rotation X', 'Always 0.'), F(0x20, 'Wheel radius'), F(0x24, 'Collision sphere radius', 'Usually 43; the difference with the wheel radius moves the sphere centre.'),
    F(0x28, 'Unknown 0x28', 'Not documented.', 'u32')]) });
  return { kind: 'schema', title: `Vehicle physics${vehicle ? ` · ${vehicle}` : ''}`, rowsLabel: 'parts',
    help: 'The collision spheres and suspension of the vehicle (its stats are in kartParam.bin).',
    rows: [
      { label: 'Body', sub: 'offset 0x0000', fields: at(0, [
        F(0x000, 'Starting height', 'On collision, the floor normal times this value is added to the position.'),
        ...XYZ(0x184, 'Inertia block 1 size', 'XYZ', 'Size of the first block (mass 1) used to compute how the vehicle turns.'),
        ...XYZ(0x190, 'Inertia block 2 size', 'XYZ', 'Size of the second block (mass 12).'),
        F(0x19c, 'Rotation speed multiplier', 'Multiplies the angular speed from the physics.'), F(0x1a0, 'Unknown 0x1A0', 'Not documented.'),
        F(0x254, 'Body rumble height', 'Largest vertical distance of the body vibration.'), F(0x258, 'Body rumble speed', '', 'u16')]) },
      ...Array.from({ length: 16 }, (_, i) => hitbox(i)),
      wheel(0x1a4, bike ? 'Front wheel' : 'Front wheels', bike ? '' : 'The front right wheel; the game mirrors it (X negated) for the front left one.'),
      wheel(0x1d0, bike ? 'Rear wheel' : 'Rear wheels', bike ? '' : 'The back right wheel; the game mirrors it (X negated) for the back left one.'),
      wheel(0x1fc, 'Unused wheel 3', 'Not used by the game.'), wheel(0x228, 'Unused wheel 4', 'Not used by the game.'),
    ] };
}

// ---- Lighting: .blight (lights) and .blmap (light maps) of a track's posteffect folder ----

const magic4 = (data) => String.fromCharCode(data[0], data[1], data[2], data[3]);
export const isBlight = (name, data) => /\.blight$/i.test(name) && data.length >= 0x28 && magic4(data) === 'LGHT';
export const isBlmap = (name, data) => /\.blmap$/i.test(name) && data.length >= 0x20 && magic4(data) === 'LMAP';

// RGBA colours (4 bytes): read as "#rrggbb" and an alpha from 0 to 255.
export function readRgba(data, at) {
  return { hex: `#${[0, 1, 2].map((k) => data[at + k].toString(16).padStart(2, '0')).join('')}`, alpha: data[at + 3] };
}
export function writeRgba(data, at, hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m || !Number.isInteger(alpha) || alpha < 0 || alpha > 255) throw new Error('Invalid colour');
  if (at < 0 || at + 4 > data.length) throw new Error('Value outside the file');
  const out = data.slice();
  for (let k = 0; k < 3; k++) out[at + k] = parseInt(m[1].slice(k * 2, k * 2 + 2), 16);
  out[at + 3] = alpha;
  return out;
}

const ANGLE_FALLOFF = [[0, 'Disabled'], [1, 'Flat (sharp border)'], [2, 'Cosine'], [3, 'Cosine, smoother cut-off'], [4, 'Sharp (softer than flat)'], [5, 'Ring with a dim centre'], [6, 'Ring']];
const DISTANCE_FALLOFF = [[0, 'Disabled'], [1, 'Gentle'], [2, 'Medium'], [3, 'Steep']];
const LIGHT_SPACE = [[1, 'World coordinates'], [2, 'View coordinates (turns with the camera)'], [3, 'From the top of the screen'], [4, 'From the bottom of the screen']];
const LIGHT_TYPES = [[0, 'Omni light'], [1, 'Directional'], [2, 'Spotlight']];
const LIGHT_FLAGS = [[0, 'Direction and colour (bit 0)'], [6, 'Direction and colour (bit 6, set together with bit 0)'], [1, 'Direction shifted from another light'],
  [5, 'Linked to the light map (BLMAP)'], [7, 'Angle curve instead of the spot functions'], [8, 'Distance curve instead of the distance functions'], [11, 'Fixed unknown attenuation curve']];
const GRADIENTS = [[0, 'Linear, 32–64'], [1, 'Linear, 0–64'], [2, 'Linear, 16–64'], [3, 'Quadratic, 32–64'], [4, 'Quartic, 32–64'], [5, 'Sextic, 32–64'],
  [6, 'Octic, 32–64'], [7, 'Linear, 4–45'], [8, 'Negative quadratic, 10–42'], [9, 'Negative quadratic, 13–45']].map(([v, label]) => [v, `${hex(v)} · ${label}`]);
const MAP_TYPES = [[0, 'Sphere lit from four sides'], [1, 'Flat gradient'], [2, 'Sphere lit from one side']];

function blightTable(data) {
  const v = view(data), count = v.getUint16(0x10), ambients = v.getUint16(0x12), ambientBase = 0x28 + count * 0x50;
  const at = (base, fields) => fields.map((f) => ({ ...f, at: base + f.off, offset: f.off }));
  const lights = [];
  for (let i = 0; i < count && 0x28 + (i + 1) * 0x50 <= data.length; i++) {
    const base = 0x28 + i * 0x50, flags = v.getUint16(base + 0x16), on = (flags & 1) && (flags & 0x40);
    lights.push({ label: `Light ${i}${i < 8 ? '' : ' (not usable from the KCL)'}`, sub: `${on ? (LIGHT_TYPES.find(([t]) => t === data[base + 0x13])?.[1] || 'On') : 'Off'} · offset ${hex(base, 4)}`,
      fields: at(base, [
        F(0x16, 'Settings', 'Bits 0 and 6 must both be on for the light to shine. The original tracks use 0x0641 or 0x0621.', 'u16', undefined),
        F(0x13, 'Type', 'The original tracks always use Directional.', 'u8', LIGHT_TYPES),
        F(0x12, 'Coordinates of origin and destination', '', 'u8', LIGHT_SPACE),
        ...XYZ(0x18, 'Origin'), ...XYZ(0x24, 'Destination', 'XYZ', 'The light shines from the origin towards the destination.'),
        F(0x30, 'Colour strength'), F(0x34, 'Light colour', '', 'rgba'), F(0x38, 'Ambient colour for the light map stages', '', 'rgba'),
        F(0x14, 'Ambient colour', `Index of the ambient colour (0–${ambients - 1}); also links the gradient table of the light map.`, 'u16'),
        F(0x10, 'Angle falloff', 'How the light fades away from its centre (spotlights).', 'u8', ANGLE_FALLOFF), F(0x3c, 'Spotlight cut-off angle'),
        F(0x11, 'Distance falloff', 'How the light fades with distance, from the reference values below.', 'u8', DISTANCE_FALLOFF),
        F(0x40, 'Reference distance'), F(0x44, 'Reference brightness'),
        F(0x4c, 'Light used for shifting', 'The light whose coordinates shift this one, when that setting is on.', 'u16'),
      ]).map((f) => f.offset === 0x16 ? { ...f, bits: LIGHT_FLAGS } : f) });
  }
  const ambientRow = { label: 'Ambient colours', sub: `offset ${hex(ambientBase, 4)}`,
    fields: Array.from({ length: ambients }, (_, i) => ({ ...F(0, `Ambient colour ${i}`, `Used by the lights whose ambient colour is ${i}.`, 'rgba'), at: ambientBase + i * 8, offset: i * 8 }))
      .filter((f) => f.at + 4 <= data.length) };
  const general = { label: 'General', sub: 'offset 0x0000', fields: [{ ...F(0x14, 'Ambience black', 'Always black (00 00 00 FF) in the original files.', 'rgba'), at: 0x14, offset: 0x14 }] };
  return { kind: 'lighting', title: 'Lights', rowsLabel: 'parts',
    help: 'How characters, karts, items and objects are lit on this track: 16 lights, each with its colour, direction and ambient colour. The KCL chooses lights 0 to 7 for each area of the track.',
    rows: [general, ...lights, ambientRow] };
}

function blmapTable(data) {
  const v = view(data), count = v.getUint16(0x10), rows = [];
  let base = 0x20;
  for (let m = 0; m < count && base + 0x3c <= data.length; m++) {
    const size = v.getUint32(base + 4) || 0x13c, stages = v.getUint16(base + 0x10), texture = cstr(data, base + 0x14, 32);
    const fields = [
      { label: 'Linked texture', text: texture || '-', help: 'Material texture replaced by this map; its name starts with "lm_".' },
      { ...F(0x34, 'Type', '', 'u8', MAP_TYPES), at: base + 0x34, offset: 0x34 },
      { ...F(0x38, 'Lights used', 'Which lights of the .blight file this map uses.', 'u32'), at: base + 0x38, offset: 0x38, bits: Array.from({ length: 16 }, (_, i) => [i, `Light ${i}`]) },
    ];
    for (let s = 0; s < stages && base + 0x3c + (s + 1) * 8 <= data.length; s++) {
      const at = base + 0x3c + s * 8;
      fields.push({ ...F(0, `Stage ${s + 1} · intensity`, 'From 0 to 1. Each stage applies a linked light.'), at, offset: 0x3c + s * 8 },
        { ...F(4, `Stage ${s + 1} · gradient`, '', 'u8', GRADIENTS), at: at + 4, offset: 0x3c + s * 8 + 4 });
    }
    rows.push({ label: `Light map ${m + 1}${texture ? ` · ${texture}` : ''}`, sub: `offset ${hex(base, 4)}`, fields });
    base += size;
  }
  return { kind: 'lighting', title: 'Light maps', rowsLabel: 'maps',
    help: 'How shiny surfaces look: each map replaces an "lm_" texture of the materials with a grey sphere made from the lights of the .blight file and the gradient of each stage.', rows };
}

// ---- Any other .bin ----

const looksFloat = (bits) => bits === 0 || ((bits >>> 23) & 0xff) >= 0x60 && ((bits >>> 23) & 0xff) <= 0x9f;
const looksSmallInt = (bits) => (bits | 0) > -0x100000 && (bits | 0) < 0x100000;

// Header and row size: two counts (rows = a × b), one count, or no header (rows of up to 16 bytes).
export function guessBinLayout(data) {
  const v = view(data), len = data.length;
  if (len >= 8) {
    const a = v.getUint32(0), b = v.getUint32(4);
    if (a > 1 && b > 1 && a <= 4096 && b <= 4096 && (len - 8) % (a * b) === 0) {
      const rowSize = (len - 8) / (a * b);
      if (rowSize >= 4 && rowSize % 4 === 0 && rowSize <= 2048) return { header: 8, rowSize, counts: [a, b], type: 'auto' };
    }
  }
  if (len >= 8) {
    const a = v.getUint32(0);
    if (a > 0 && a <= 65535 && (len - 4) % a === 0) {
      const rowSize = (len - 4) / a;
      if (rowSize >= 4 && rowSize % 4 === 0 && rowSize <= 4096) return { header: 4, rowSize, counts: [a], type: 'auto' };
    }
  }
  const rowSize = len % 16 === 0 ? 16 : len % 12 === 0 ? 12 : len % 8 === 0 ? 8 : len % 4 === 0 ? 4 : 16;
  return { header: 0, rowSize, counts: [], type: len % 4 === 0 ? 'auto' : 'u8' };
}

function genericTable(name, data, override) {
  const auto = guessBinLayout(data);
  const layout = { ...auto, ...(override || {}) };
  const header = Math.max(0, Math.min(data.length, Math.floor(layout.header))), rowSize = Math.max(1, Math.floor(layout.rowSize));
  const v = view(data), body = data.length - header, count = Math.ceil(body / rowSize);
  // Column types: chosen by the user, or decimal for 4-byte columns that only hold plausible floats.
  const width = layout.type === 'auto' ? 4 : BIN_TYPES[layout.type];
  const columns = Math.max(1, Math.floor(rowSize / width));
  const types = Array.from({ length: columns }, (_, c) => {
    if (layout.type !== 'auto') return layout.type;
    let float = true, small = true;
    for (let r = 0; r < count; r++) {
      const at = header + r * rowSize + c * 4;
      if (at + 4 > data.length) break;
      const bits = v.getUint32(at);
      float &&= looksFloat(bits);
      small &&= looksSmallInt(bits);
    }
    return float ? 'f32' : small ? 's32' : 'u32';
  });
  const rows = Array.from({ length: count }, (_, r) => {
    const base = header + r * rowSize;
    return {
      label: layout.counts?.length === 2 ? `Entry ${Math.floor(r / layout.counts[1]) + 1}.${r % layout.counts[1] + 1}` : `Entry ${r + 1}`, sub: `offset ${hex(base, 4)}`,
      fields: types.map((type, c) => ({ label: `Value ${hex(c * width)}`, at: base + c * width, type, offset: c * width,
        help: type === 'f32' ? 'Decimal number.' : 'Whole number.' })).filter((f) => f.at + BIN_TYPES[f.type] <= data.length),
    };
  });
  const headerValues = Array.from({ length: Math.floor(header / 4) }, (_, i) => v.getUint32(i * 4));
  return { kind: 'table', title: 'Values', rowsLabel: 'entries', layout: { header, rowSize, type: layout.type, counts: layout.counts }, auto,
    help: `This file is not documented, so its layout is read from the data: ${header ? `a header of ${header} bytes (${headerValues.join(' × ')})` : 'no header'}, ${count} ${count === 1 ? 'row' : 'rows'} of ${rowSize} bytes. Change the layout if the numbers look wrong.`,
    rows };
}

// The editable view of any .bin except the vehicle, character and item files (see params.js).
// objectNames: object ID → name, for the GeoHitTable rows. override: a layout chosen by hand
// for undocumented files.
export function binTable(name, data, { objectNames = null, override = null } = {}) {
  if (isCompressedBin(data)) return { kind: 'compressed', title: 'Compressed data', rowsLabel: 'entries', rows: [],
    help: `Nintendo LZ77-compressed data (${(data[1] | (data[2] << 8) | (data[3] << 16)).toLocaleString()} bytes once decompressed): it is not a table of values and is not edited here.` };
  if (isObjFlow(name, data)) return objFlowTable(data);
  if (isGeoHitTable(name, data)) return geoHitTable(name, data, objectNames);
  if (isBcp(name, data)) return bcpTable(name, data);
  if (isBlight(name, data)) return blightTable(data);
  if (isBlmap(name, data)) return blmapTable(data);
  if (isBsp(name, data)) return bspTable(name, data);
  const schema = SCHEMAS.find((s) => s.test(name, data));
  if (schema) return schema.table(data);
  return genericTable(name, data, override);
}

// Object names from an ObjFlow.bin, by object ID.
export function objFlowNames(data) {
  if (!data || data.length < 2) return null;
  const v = view(data), count = v.getUint16(0), out = {};
  for (let i = 0; i < count && 2 + (i + 1) * OBJFLOW_ENTRY <= data.length; i++) {
    const base = 2 + i * OBJFLOW_ENTRY, name = cstr(data, base + 2, 0x20);
    if (name) out[v.getUint16(base)] = name;
  }
  return out;
}

// Short description of a .bin for file lists.
export function binDescription(name, data) {
  if (isCompressedBin(data)) return 'Compressed data';
  if (isObjFlow(name, data)) return 'Object types';
  if (isBcp(name, data)) return 'Camera before the countdown';
  if (isBlight(name, data)) return 'Lights';
  if (isBlmap(name, data)) return 'Light maps';
  if (isBsp(name, data)) return `Vehicle physics${bspVehicle(name) ? ` · ${bspVehicle(name)}` : ''}`;
  if (isGeoHitTable(name, data)) {
    const items = /Item/i.test(name), onObject = /Obj\.bin$/i.test(name);
    return items ? onObject ? 'Items acting on objects' : 'Objects acting on items' : onObject ? 'Players acting on objects' : 'Objects acting on players';
  }
  return SCHEMAS.find((s) => s.test(name, data))?.description || 'Table of values (undocumented)';
}
