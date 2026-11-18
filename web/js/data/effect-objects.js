// The game's objects that are only a particle effect (no model): placed on a track they play their
// effect where they stand. Each needs its effect files in the track (effect/<object>/*.breff and
// .breft, OBJECT_FILES); the editor copies them from the track of the game folder that has them.
// IDs and file names from Wiimm's object database (object-files.js); what they show from the names
// of their effects, checked against the game's tracks (each is in at least one of them). Effects the
// game starts on an event (the start of a race, a demo) are left out; some of these play only at
// moments of the race (fireworks, confetti).
import { OBJECT_FILES } from './object-files.js';

export const EFFECT_OBJECTS = [
  { objectId: 0x2ee, object: 'EnvFire', label: 'Floating embers' },
  { objectId: 0x2ef, object: 'EnvSnow', label: 'Falling snow' },
  { objectId: 0x2ed, object: 'EnvKareha', label: 'Falling leaves' },
  { objectId: 0x2f1, object: 'EnvKarehaUp', label: 'Leaves blown upwards' },
  { objectId: 0x175, object: 'leaf_effect', label: 'Leaves' },
  { objectId: 0x2bf, object: 'taimatsu', label: 'Torch flame' },
  { objectId: 0x2ce, object: 'volsmk', label: 'Volcano smoke' },
  { objectId: 0x2cb, object: 'FallBsA', label: 'Waterfall basin splash (A)' },
  { objectId: 0x2cc, object: 'FallBsB', label: 'Waterfall basin splash (B)' },
  { objectId: 0x2d9, object: 'Fall_MH', label: 'Waterfall (rk_ridgeFall)' },
  { objectId: 0x2da, object: 'Fall_Y', label: 'Waterfall (rk_yoshiFalls)' },
  { objectId: 0x2f3, object: 'DKfalls', label: 'Waterfall (rk_64DKfalls)' },
  { objectId: 0x2e5, object: 'Kamifubuki', label: 'Confetti' },
  { objectId: 0x16a, object: 'Hanabi', label: 'Fireworks' },
  { objectId: 0x2d0, object: 'Flash_L', label: 'Camera flashes (rk_flashBeginner)' },
  { objectId: 0x2d1, object: 'Flash_B', label: 'Camera flashes (rk_flashBCross)' },
  { objectId: 0x2d2, object: 'Flash_W', label: 'Camera flashes (rk_flashWaluigi)' },
  { objectId: 0x2d3, object: 'Flash_M', label: 'Camera flashes (rk_flash64mario)' },
  { objectId: 0x2d4, object: 'Flash_S', label: 'Camera flashes (rk_flashSkate)' },
].map((e) => ({ ...e, files: OBJECT_FILES[e.objectId] || [] }));

export const effectObjectOf = (objectId) => EFFECT_OBJECTS.find((e) => e.objectId === objectId) || null;

// The effect files an object type uses (any object, not only these): effect/<folder>/*.breff and .breft.
export const objectEffectFiles = (objectId) => (OBJECT_FILES[objectId] || []).filter((path) => /^effect\//i.test(path));
