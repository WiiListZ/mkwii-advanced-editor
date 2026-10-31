// Cups and track slots of Mario Kart Wii.
//
// The game does not read a cup list from a file: every cup position is a fixed track slot (course
// ID 0x00–0x29) with a fixed archive name in Race/Course, a fixed music stream in sound/strm and
// fixed name messages in Common.bmg. Moving a track to another cup position therefore means moving
// its files into the archive name of that slot, and its name into that slot's messages.

import { TRACK_NAMES } from './defs.js';

// Course ID, archive name (Race/Course/<file>.szs and <file>_d.szs) and music stream
// (sound/strm/<music>_n.brstm and <music>_f.brstm) of every slot.
export const SLOTS = /** @type {Array<[number, string, string]>} */ ([
  [0x00, 'castle_course', 'n_Circuit32'], [0x01, 'farm_course', 'n_Farm'], [0x02, 'kinoko_course', 'n_Kinoko'],
  [0x03, 'volcano_course', 'n_Volcano32'], [0x04, 'factory_course', 'STRM_N_FACTORY'], [0x05, 'shopping_course', 'n_Shopping32'],
  [0x06, 'boardcross_course', 'n_Snowboard32'], [0x07, 'truck_course', 'STRM_N_TRUCK'], [0x08, 'beginner_course', 'n_Circuit32'],
  [0x09, 'senior_course', 'n_Daisy32'], [0x0a, 'ridgehighway_course', 'STRM_N_RIDGEHIGHWAY'], [0x0b, 'treehouse_course', 'n_maple'],
  [0x0c, 'koopa_course', 'STRM_N_KOOPA'], [0x0d, 'rainbow_course', 'n_Rainbow32'], [0x0e, 'desert_course', 'STRM_N_DESERT'],
  [0x0f, 'water_course', 'STRM_N_WATER'], [0x10, 'old_peach_gc', 'r_GC_Beach32'], [0x11, 'old_mario_gc', 'r_GC_Circuit32'],
  [0x12, 'old_waluigi_gc', 'r_GC_Stadium32'], [0x13, 'old_donkey_gc', 'r_GC_Mountain32'], [0x14, 'old_falls_ds', 'r_DS_Jungle32'],
  [0x15, 'old_desert_ds', 'r_DS_Desert32'], [0x16, 'old_garden_ds', 'r_DS_Garden32'], [0x17, 'old_town_ds', 'r_DS_Town32'],
  [0x18, 'old_mario_sfc', 'r_SFC_Circuit32'], [0x19, 'old_obake_sfc', 'r_SFC_Obake32'], [0x1a, 'old_mario_64', 'r_64_Circuit32'],
  [0x1b, 'old_sherbet_64', 'r_64_Sherbet32'], [0x1c, 'old_koopa_64', 'r_64_Kuppa32'], [0x1d, 'old_donkey_64', 'r_64_Jungle32'],
  [0x1e, 'old_koopa_gba', 'r_AGB_Kuppa32'], [0x1f, 'old_heyho_gba', 'r_AGB_Beach32'],
  [0x20, 'venice_battle', 'n_venice'], [0x21, 'block_battle', 'n_block'], [0x22, 'casino_battle', 'n_casino'],
  [0x23, 'skate_battle', 'n_skate'], [0x24, 'sand_battle', 'n_ryuusa'], [0x25, 'old_CookieLand_gc', 'r_GC_Battle32'],
  [0x26, 'old_House_ds', 'r_ds_battle'], [0x27, 'old_battle4_sfc', 'r_sfc_battle'], [0x28, 'old_battle3_gba', 'r_agb_battle'],
  [0x29, 'old_matenro_64', 'r_64_battle'],
]).map(([id, file, music]) => ({ id, file, music, battle: id >= 0x20, label: TRACK_NAMES[file] }));

const BY_ID = new Map(SLOTS.map((s) => [s.id, s]));
export const slotById = (id) => BY_ID.get(id);

// Cups in the order of the game's menus; `nameId` is the cup's name in Common.bmg.
export const CUPS = [
  { name: 'Mushroom Cup', icon: 'kinoko', nameId: 0x23f0, slots: [0x08, 0x01, 0x02, 0x04] },
  { name: 'Flower Cup', icon: 'flower', nameId: 0x23f1, slots: [0x00, 0x05, 0x06, 0x07] },
  { name: 'Star Cup', icon: 'star', nameId: 0x23f2, slots: [0x09, 0x0f, 0x0b, 0x03] },
  { name: 'Special Cup', icon: 'oukan', nameId: 0x23f3, slots: [0x0e, 0x0a, 0x0c, 0x0d] },
  { name: 'Shell Cup', icon: 'koura', nameId: 0x23f4, slots: [0x10, 0x14, 0x19, 0x1a] },
  { name: 'Banana Cup', icon: 'banana', nameId: 0x23f5, slots: [0x1b, 0x1f, 0x17, 0x12] },
  { name: 'Leaf Cup', icon: 'konoha', nameId: 0x23f6, slots: [0x15, 0x1e, 0x1d, 0x11] },
  { name: 'Lightning Cup', icon: 'thunder', nameId: 0x23f7, slots: [0x18, 0x16, 0x13, 0x1c] },
  { name: 'Wii Stages', battle: true, nameId: 0x2489, slots: [0x21, 0x20, 0x23, 0x22, 0x24] },
  { name: 'Retro Stages', battle: true, nameId: 0x248a, slots: [0x27, 0x28, 0x29, 0x25, 0x26] },
];

// Where a slot sits in the cups: { cup, position }.
export function slotPlace(id) {
  for (let cup = 0; cup < CUPS.length; cup++) {
    const position = CUPS[cup].slots.indexOf(id);
    if (position >= 0) return { cup, position };
  }
  return null;
}

// Every message of Common.bmg that names the track of a slot. Race tracks have two copies
// (0x2454 + ID and 0x2490 + ID); arenas up to three, 0x14 apart (the third only for some arenas).
export function nameIds(id) {
  if (id >= 0x20) return [0x24b8, 0x24cc, 0x24e0].map((base) => base + id - 0x20);
  return [0x2454 + id, 0x2490 + id];
}

// The arrangement being edited: what goes into each slot, names typed by the user and music chosen
// for a slot.
// content[slot] = { type: 'slot', id }      the track that is now in slot `id`
//               | { type: 'file', path, label } a track archive from disk
// music[slot]   = { type: 'slot', id }      the music track `id` has now (its stream is copied)
//               | { type: 'file', path, label, loop, loopStart, volume, finalFaster } an audio file,
//                 converted to the game's format (finalFaster: the final lap plays it 10% faster)
/** @returns {{ content: Record<number, any>, names: Record<number, string>, cupNames: Record<number, string>, music: Record<number, any> }} */
export function initialArrangement() {
  return { content: Object.fromEntries(SLOTS.map((s) => [s.id, { type: 'slot', id: s.id }])), names: {}, cupNames: {}, music: {} };
}

const same = (a, b) => a.type === b.type && (a.type === 'slot' ? a.id === b.id : a.path === b.path);
export const isChanged = (arrangement, id) => !same(arrangement.content[id], { type: 'slot', id }) || arrangement.names[id] !== undefined || arrangement.music?.[id] !== undefined;

// Chooses the music of a slot (null: back to the music that goes with its track).
export function setSlotMusic(arrangement, id, choice) {
  const music = { ...arrangement.music };
  if (choice) music[id] = choice;
  else delete music[id];
  return { ...arrangement, music };
}

// Exchanges what two slots hold. A typed name belongs to the track and moves with it.
// Race tracks and battle arenas cannot be mixed: the game needs checkpoints in race slots.
export function swapSlots(arrangement, a, b) {
  if (a === b) return arrangement;
  if (slotById(a).battle !== slotById(b).battle) throw new Error('Race tracks and battle arenas cannot change places.');
  const content = { ...arrangement.content, [a]: arrangement.content[b], [b]: arrangement.content[a] };
  // A typed name and a chosen music belong to the track and move with it.
  const follow = (map = {}) => {
    const out = { ...map };
    delete out[a]; delete out[b];
    if (map[b] !== undefined) out[a] = map[b];
    if (map[a] !== undefined) out[b] = map[a];
    return out;
  };
  return { ...arrangement, content, names: follow(arrangement.names), music: follow(arrangement.music) };
}

// The slot next to `id` in menu order: dir -1 / +1 moves up or down in the cup (continuing in the
// previous or next cup), 'cup-1' / 'cup+1' moves to the same position of the previous or next cup.
// Race cups and battle cups are separate lists.
export function neighbourSlot(id, dir) {
  const place = slotPlace(id);
  const cups = CUPS.map((c, i) => ({ ...c, i })).filter((c) => !!c.battle === slotById(id).battle);
  const at = cups.findIndex((c) => c.i === place.cup);
  if (dir === 'cup-1' || dir === 'cup+1') {
    const cup = cups[at + (dir === 'cup-1' ? -1 : 1)];
    return cup ? cup.slots[Math.min(place.position, cup.slots.length - 1)] : null;
  }
  const order = cups.flatMap((c) => c.slots);
  const next = order[order.indexOf(id) + dir];
  return next === undefined ? null : next;
}

export function moveSlot(arrangement, id, dir) {
  const other = neighbourSlot(id, dir);
  return other === null ? arrangement : swapSlots(arrangement, id, other);
}

export function replaceSlot(arrangement, id, path, label) {
  return { ...arrangement, content: { ...arrangement.content, [id]: { type: 'file', path, label } }, names: { ...arrangement.names, [id]: label } };
}

export function resetSlot(arrangement, id) {
  // A slot that only holds a moved track is reset by swapping the track back where it came from.
  const current = arrangement.content[id];
  if (current.type === 'slot' && current.id !== id) {
    const home = Object.keys(arrangement.content).map(Number).find((s) => same(arrangement.content[s], { type: 'slot', id }));
    if (home !== undefined) return resetSlot(swapSlots(arrangement, id, home), home);
  }
  const content = { ...arrangement.content, [id]: { type: 'slot', id } };
  const names = { ...arrangement.names }, music = { ...arrangement.music };
  delete names[id]; delete music[id];
  return { ...arrangement, content, names, music };
}

// Turns an arrangement into the operations that write it:
// - tracks: [{ slot, source }]: the archives of `slot` receive those of `source`;
// - music: [{ target, source }] music streams to copy, or [{ target, file }] an audio file to convert
//   into the stream; `musicKept`: streams shared by slots that want different music (Luigi Circuit
//   and Mario Circuit both play n_Circuit32), left unchanged; `musicShared`: streams that get the
//   music chosen for one slot and are also played by other slots;
// - names: true when some message of Common.bmg changes (computed per archive with nameChanges).
// Music chosen for a slot comes before the music that follows a moved track.
export function planArrangement(arrangement, { moveMusic = true } = {}) {
  const tracks = [];
  for (const slot of SLOTS) {
    const source = arrangement.content[slot.id];
    if (!same(source, { type: 'slot', id: slot.id })) tracks.push({ slot: slot.id, source });
  }
  const music = [], musicKept = [], musicShared = [];
  const chosen = new Map(), following = new Map(); // target stream -> Map(key -> wanted music)
  const want = (map, target, wanted) => {
    const set = map.get(target) || new Map();
    set.set(wanted.type === 'file' ? `file:${wanted.path}` : `stream:${wanted.stream}`, wanted);
    map.set(target, set);
  };
  for (const slot of SLOTS) {
    const choice = arrangement.music?.[slot.id];
    const source = arrangement.content[slot.id];
    if (choice) want(chosen, slot.music, choice.type === 'file' ? choice : { type: 'stream', stream: slotById(choice.id).music });
    // A track from a file plays the music of its slot.
    else if (moveMusic && source.type === 'slot') want(following, slot.music, { type: 'stream', stream: slotById(source.id).music });
  }
  for (const target of new Set([...chosen.keys(), ...following.keys()])) {
    const wanted = chosen.get(target) || following.get(target);
    const slots = SLOTS.filter((s) => s.music === target).map((s) => s.id);
    if (wanted.size > 1) { musicKept.push({ stream: target, slots }); continue; }
    const [only] = wanted.values();
    if (only.type === 'file') music.push({ target, file: only });
    else if (only.stream !== target) music.push({ target, source: only.stream });
    else continue;
    if (chosen.has(target) && slots.length > 1) musicShared.push({ stream: target, slots });
  }
  const names = Object.keys(arrangement.names).length > 0 || Object.keys(arrangement.cupNames).length > 0
    || tracks.some((t) => t.source.type === 'slot');
  return { tracks, music, musicKept, musicShared, names };
}

// What a slot plays once the plan is written: the audio file converted into its stream (`file`),
// the stream of another slot copied in (`from`), or its own stream unchanged (`from` = `stream`).
export function plannedMusic(plan, id) {
  const stream = slotById(id).music;
  const entry = plan.music.find((m) => m.target === stream);
  if (!entry) return { stream, from: stream, file: null };
  return entry.file ? { stream, from: null, file: entry.file } : { stream, from: entry.source, file: null };
}

// Changed messages of one Common.bmg: { id: text }. `textOf(id)` reads the archive's original text
// (null when the message is not there). Names follow the tracks, so every language keeps its own
// spelling; names typed by the user replace them in every language.
export function nameChanges(arrangement, textOf) {
  const out = {};
  for (const slot of SLOTS) {
    const ids = nameIds(slot.id);
    const typed = arrangement.names[slot.id];
    const source = arrangement.content[slot.id];
    ids.forEach((id, k) => {
      const current = textOf(id);
      if (current === null || current === undefined) return;
      let text = current;
      if (typed !== undefined) text = typed;
      else if (source.type === 'slot' && source.id !== slot.id) {
        const from = nameIds(source.id);
        text = textOf(from[k]) ?? textOf(from[0]) ?? current;
      }
      if (text !== current) out[id] = text;
    });
  }
  CUPS.forEach((cup, i) => {
    const typed = arrangement.cupNames[i];
    const current = textOf(cup.nameId);
    if (typed !== undefined && current !== null && current !== undefined && typed !== current) out[cup.nameId] = typed;
  });
  return out;
}

// Normal and final-lap files of a music stream, as named in the folder listing (names differ in
// case: n_Farm_n / n_Farm_F).
export function musicFiles(stream, listing) {
  const find = (suffix) => listing.find((f) => f.toLowerCase() === `${stream}_${suffix}.brstm`.toLowerCase()) || null;
  return { normal: find('n'), final: find('f') };
}

// What an archive needs to be loaded in a slot, from the file names it holds and its KMP.
// Returns { errors: [], warnings: [] }.
export function checkTrackArchive({ files, checkpoints, starts }, battle) {
  const errors = [], warnings = [];
  const has = (name) => files.some((f) => f.toLowerCase().split('/').pop() === name);
  for (const name of ['course.kmp', 'course.kcl', 'course_model.brres', 'vrcorn_model.brres'])
    if (!has(name)) errors.push(`No ${name}: the game crashes or shows nothing when it loads this track.`);
  if (has('course.kmp')) {
    if (!battle && !checkpoints) errors.push('No checkpoints: this looks like a battle arena, and a race slot needs checkpoints to count laps.');
    if (battle && checkpoints) warnings.push('It has checkpoints: it looks like a race track. Battle arenas normally have none.');
    if (!starts) warnings.push('No start position (KTPT): drivers start at the centre of the map.');
  }
  if (!has('map_model.brres')) warnings.push('No map_model.brres: the minimap in the corner stays empty.');
  return { errors, warnings };
}
