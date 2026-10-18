// Mario Kart Wii reference data used by the editor.

// Base KCL collision types (low 5 bits of the flag).
export const KCL_TYPES = [
  { id: 0x00, name: 'Road', color: '#8a8f99' },
  { id: 0x01, name: 'Slippery Road 1', color: '#c9e8ff' },
  { id: 0x02, name: 'Weak Off-road', color: '#b58a52' },
  { id: 0x03, name: 'Off-road', color: '#4f9a3a' },
  { id: 0x04, name: 'Heavy Off-road', color: '#2f5e22' },
  { id: 0x05, name: 'Slippery Road 2', color: '#a5d4f5' },
  { id: 0x06, name: 'Boost Panel', color: '#ff9d00' },
  { id: 0x07, name: 'Boost Ramp', color: '#ffbf40' },
  { id: 0x08, name: 'Jump Pad', color: '#ffe14d' },
  { id: 0x09, name: 'Item Road', color: '#d080ff' },
  { id: 0x0A, name: 'Solid Fall (sand/lava)', color: '#c44a1a' },
  { id: 0x0B, name: 'Moving Water', color: '#2f7bd6' },
  { id: 0x0C, name: 'Wall', color: '#e04848' },
  { id: 0x0D, name: 'Invisible Wall', color: '#ff7a7a' },
  { id: 0x0E, name: 'Item Wall', color: '#b04fb0' },
  { id: 0x0F, name: 'Wall 2', color: '#d06060' },
  { id: 0x10, name: 'Fall Boundary', color: '#5a1010' },
  { id: 0x11, name: 'Cannon Activator', color: '#ff40c0' },
  { id: 0x12, name: 'Force Recalculation', color: '#7070ff' },
  { id: 0x13, name: 'Half-pipe Ramp', color: '#40e0d0' },
  { id: 0x14, name: 'Player-Only Wall', color: '#c08080' },
  { id: 0x15, name: 'Moving Road', color: '#6699aa' },
  { id: 0x16, name: 'Sticky Road (gravity)', color: '#66aa88' },
  { id: 0x17, name: 'Road 2', color: '#9a9fa9' },
  { id: 0x18, name: 'Sound Trigger', color: '#aaaa33' },
  { id: 0x19, name: 'Weak Wall', color: '#e09090' },
  { id: 0x1A, name: 'Effect Trigger', color: '#33aaaa' },
  { id: 0x1B, name: 'Item State Modifier', color: '#aa33aa' },
  { id: 0x1C, name: 'Half-pipe Invisible Wall', color: '#ff9a9a' },
  { id: 0x1D, name: 'Rotating Road', color: '#7799bb' },
  { id: 0x1E, name: 'Special Wall', color: '#ff5050' },
  { id: 0x1F, name: 'Invisible Wall 2', color: '#ffaaaa' },
];

export const kclTypeOf = (flag) => KCL_TYPES[flag & 0x1F];
export const kclVariant = (flag) => (flag >> 5) & 7;
export const kclShadow = (flag) => (flag >> 8) & 7;
export const makeFlag = (type, variant = 0, shadow = 0, extra = 0) =>
  ((type & 0x1F) | ((variant & 7) << 5) | ((shadow & 7) << 8) | (extra & 0xF800)) & 0xFFFF;
export const isWallType = (t) => [0x0C, 0x0D, 0x0E, 0x0F, 0x14, 0x19, 0x1C, 0x1E, 0x1F].includes(t);
export const isDriveableType = (t) => [0, 1, 2, 3, 4, 5, 6, 7, 8, 0x0A, 0x0B, 0x13, 0x15, 0x16, 0x17, 0x1D].includes(t);

export const AREA_TYPES = [
  'Camera (replay)', 'Environment Effect', 'Fog Swap (BFG)', 'Pull (moving road/water)',
  'Enemy Route Recalculation', 'Minimap Control', 'Bloom Swap (BBLM)', 'Enable Boos',
  'Object Group', 'Object Unload', 'Fall Boundary',
];
export const AREA_SHAPES = ['Box', 'Cylinder'];

export const CAMERA_TYPES = [
  'Goal', 'Fixed Search', 'Path Search', 'Kart Follow', 'Kart Path Follow',
  'Opening (OP_FixMoveAt)', 'Replay path, follows the kart (OP_PathMoveAt)', 'Mini Game', 'Mission Success', 'Unknown',
];

export const CHECKPOINT_TYPE_LABEL = (t) => (t === 0 ? 'Lap (finish line)' : t === 0xFF ? 'Normal' : `Key ${t}`);

// Internal object names (from ObjFlow.bin) with a friendly label and category.
// Numeric IDs should be loaded from ObjFlow.bin (Race/Common.szs) to get the complete official list.
export const OBJECT_INFO = {
  itembox: { label: 'Item Box', cat: 'Race' },
  flagBlend: { label: 'Animated Flag', cat: 'Decoration' },
  kuribo: { label: 'Goomba', cat: 'Enemies' },
  wanwan: { label: 'Chain Chomp', cat: 'Enemies' },
  sanbo: { label: 'Pokey', cat: 'Enemies' },
  choropu: { label: 'Monty Mole', cat: 'Enemies' },
  choropu2: { label: 'Monty Mole 2', cat: 'Enemies' },
  cow: { label: 'Cow', cat: 'Enemies' },
  dossunc: { label: 'Thwomp', cat: 'Enemies' },
  pakkun_f: { label: 'Fire Piranha Plant', cat: 'Enemies' },
  pakkun_dokan: { label: 'Piranha Plant (pipe)', cat: 'Enemies' },
  heyho: { label: 'Shy Guy', cat: 'Enemies' },
  hanachan: { label: 'Wiggler', cat: 'Enemies' },
  basabasa: { label: 'Swoopers (bats)', cat: 'Enemies' },
  poihana: { label: 'Cataquack', cat: 'Enemies' },
  FireSnake: { label: 'Fire Snake', cat: 'Enemies' },
  Crab: { label: 'Crab', cat: 'Enemies' },
  TruckWagon: { label: 'Mine Cart', cat: 'Vehicles' },
  car_body: { label: 'Car (traffic)', cat: 'Vehicles' },
  kart_truck: { label: 'Truck (traffic)', cat: 'Vehicles' },
  Epropeller: { label: 'Propeller', cat: 'Mechanisms' },
  begoman_spike: { label: 'Spiked Top', cat: 'Enemies' },
  DKrockGC: { label: 'Rolling Boulder', cat: 'Mechanisms' },
  Press: { label: 'Press', cat: 'Mechanisms' },
  WLfirebarGC: { label: 'Fire Bar', cat: 'Mechanisms' },
  sun: { label: 'Sun', cat: 'Effects' },
  psea: { label: 'Animated Sea / Water', cat: 'Effects' },
  lensFX: { label: 'Lens Flare', cat: 'Effects' },
  MashBalloonGC: { label: 'Mushroom Balloon', cat: 'Decoration' },
  venice_nami: { label: 'Waves (Venice)', cat: 'Effects' },
};

// Race/Course file names of the original tracks and arenas.
export const TRACK_NAMES = {
  beginner_course: 'Luigi Circuit', farm_course: 'Moo Moo Meadows', kinoko_course: 'Mushroom Gorge', factory_course: "Toad's Factory",
  castle_course: 'Mario Circuit', shopping_course: 'Coconut Mall', boardcross_course: 'DK Summit', truck_course: "Wario's Gold Mine",
  senior_course: 'Daisy Circuit', water_course: 'Koopa Cape', treehouse_course: 'Maple Treeway', volcano_course: 'Grumble Volcano',
  desert_course: 'Dry Dry Ruins', ridgehighway_course: 'Moonview Highway', koopa_course: "Bowser's Castle", rainbow_course: 'Rainbow Road',
  old_peach_gc: 'GCN Peach Beach', old_falls_ds: 'DS Yoshi Falls', old_obake_sfc: 'SNES Ghost Valley 2', old_mario_64: 'N64 Mario Raceway',
  old_sherbet_64: 'N64 Sherbet Land', old_heyho_gba: 'GBA Shy Guy Beach', old_town_ds: 'DS Delfino Square', old_waluigi_gc: 'GCN Waluigi Stadium',
  old_desert_ds: 'DS Desert Hills', old_koopa_gba: 'GBA Bowser Castle 3', old_donkey_64: "N64 DK's Jungle Parkway", old_mario_gc: 'GCN Mario Circuit',
  old_mario_sfc: 'SNES Mario Circuit 3', old_garden_ds: 'DS Peach Gardens', old_donkey_gc: 'GCN DK Mountain', old_koopa_64: "N64 Bowser's Castle",
  block_battle: 'Block Plaza', venice_battle: 'Delfino Pier', skate_battle: 'Funky Stadium', casino_battle: 'Chain Chomp Wheel',
  sand_battle: 'Thwomp Desert', old_battle4_sfc: 'SNES Battle Course 4', old_battle3_gba: 'GBA Battle Course 3', old_matenro_64: 'N64 Skyscraper',
  old_CookieLand_gc: 'GCN Cookie Land', old_House_ds: 'DS Twilight House', ring_mission: 'Galaxy Colosseum', winningrun_demo: 'Award ceremony',
  loser_demo: 'Losing ceremony', draw_demo: 'Draw ceremony', ending_demo: 'Ending',
};

// Readable name of a track archive ("castle_course_d.szs" -> "Mario Circuit (multiplayer)").
export function trackLabel(fileName) {
  const stem = fileName.split(/[\\/]/).pop().replace(/\.[^.]+$/, ''), base = stem.replace(/_d$/, '');
  const known = TRACK_NAMES[base];
  return known ? `${known}${base !== stem ? ' (multiplayer)' : ''}` : stem;
}

const BATTLE_TRACK_STEMS = new Set([
  'block_battle', 'venice_battle', 'skate_battle', 'casino_battle', 'sand_battle',
  'old_battle4_sfc', 'old_battle3_gba', 'old_matenro_64', 'old_CookieLand_gc',
  'old_House_ds', 'ring_mission',
]);
const DEMO_TRACK_STEMS = new Set(['winningrun_demo', 'loser_demo', 'draw_demo', 'ending_demo']);

// Unknown/custom archives remain available under Both; a filename alone cannot always reveal
// whether a custom course is a race or a battle arena.
export function trackKind(fileName) {
  const stem = fileName.split(/[\\/]/).pop().replace(/\.[^.]+$/, '').replace(/_d$/i, '');
  if (BATTLE_TRACK_STEMS.has(stem) || /battle|arena/i.test(stem)) return 'battle';
  if (DEMO_TRACK_STEMS.has(stem) || /demo/i.test(stem)) return 'other';
  if (TRACK_NAMES[stem] || /^old_mario_gc_/i.test(stem) || /course|circuit|race|track/i.test(stem)) return 'race';
  return 'other';
}

// Objects the game draws away from their KMP point (game units, same values as noclip.website):
// item boxes and coins float above the road where they are placed. ground: the model's origin is
// its centre (the Chain Chomp's ball), so it is lifted until its lowest point touches the KMP point.
export const OBJECT_DISPLAY = {
  itembox: { y: 200 }, coin: { y: 150 }, poihana: { y: 250 }, Twanwan: { y: 1500 }, Hwanwan: { y: 1250, scale: 4 },
  wanwan: { ground: true },
  // Sand piles under the Dry Dry Ruins sandfalls: the KMP point is the sunk pile, its tip at floor
  // level, and the game raises it by setting 2. Drawn sunk, the hole in the floor it fills shows
  // the empty space under the track (black).
  dc_sandcone: { ySetting: 1 },
};

// Height the editor adds to an object's KMP position to draw it where the game shows it.
export const objectDisplayY = (display, e) => (display?.y || 0) + (display?.ySetting !== undefined ? e.settings?.[display.ySetting] || 0 : 0);

// IDs known for certain (used until ObjFlow.bin is loaded).
export const BUILTIN_OBJECTS = { 0x0065: 'itembox' };

export function categorizeObject(name) {
  if (OBJECT_INFO[name]) return OBJECT_INFO[name].cat;
  const n = name.toLowerCase();
  if (n.includes('sound')) return 'Sounds';
  if (/tree|flower|grass|bush|kusa|leaf|palm/.test(n)) return 'Vegetation';
  if (/fx|effect|light|lens|fog|sun|sea|nami|wave|fire|smoke|spark|dust/.test(n)) return 'Effects';
  if (/car|truck|bus|kart|wagon|ship|boat|train|plane|heli/.test(n)) return 'Vehicles';
  if (/kuribo|pakkun|dossun|wanwan|sanbo|choropu|heyho|hanachan|crab|basabasa|poihana|bird|cow|puku|teresa|bomb/.test(n)) return 'Enemies';
  if (/item|box|coin|kinoko|star|dash|jump|cannon/.test(n)) return 'Race';
  return 'Other';
}

/**
 * Parses ObjFlow.bin: u16 entry count, then 0x74-byte entries (u16 id, char[0x20] name, char[0x40] resources, ...).
 * Returns { id: { name, resources } }.
 */
export function parseObjFlow(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = view.getUint16(0);
  const ENTRY = 0x74;
  if (count === 0 || 2 + count * ENTRY > data.length) throw new Error('Invalid ObjFlow.bin');
  const str = (off, max) => {
    let s = '';
    for (let i = 0; i < max && data[off + i]; i++) s += String.fromCharCode(data[off + i]);
    return s;
  };
  const out = {};
  for (let i = 0; i < count; i++) {
    const base = 2 + i * ENTRY;
    const id = view.getUint16(base);
    const name = str(base + 2, 0x20);
    if (!name || !/^[\x20-\x7E]+$/.test(name)) continue;
    out[id] = { name, resources: str(base + 0x22, 0x40) };
  }
  if (!Object.keys(out).length) throw new Error('ObjFlow.bin: no objects found');
  return out;
}

// Short explanations shown in the inspector.
export const HELP = {
  KTPT: 'Start position. With player index -1 the game lines up every kart in a grid around this point.',
  ENPT: 'Enemy (CPU) route point. CPUs follow these points; the width says how far they may stray.',
  ITPT: 'Item route point: guides Bullet Bill, red and blue shells.',
  CKPT: 'Checkpoint: a left-right line the kart must cross. The first one must be the lap checkpoint (type 0); key checkpoints (1, 2, ...) prevent shortcuts.',
  GOBJ: 'Game object (item box, enemies, decoration...). Settings and route depend on the object type.',
  POTI: 'Route used by moving objects, cameras and areas.',
  AREA: '3D area that triggers cameras, effects, fog, pulls, etc.',
  CAME: 'Camera (intro, replay, goal).',
  JGPT: 'Respawn point after falling off. Checkpoints decide which one is used.',
  CNPT: 'Cannon destination (triggered by the "Cannon Activator" collision).',
  MSPT: 'Battle end position.',
  STGI: 'General track settings.',
};
