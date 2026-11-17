// The game's ambient sound emitters: invisible objects that play a looping sound heard near them
// (and near their route). Each plays a sequenced sound of revo_kart.brsar whose notes come from an
// instrument bank of one or two samples; replacing those samples changes the sound in every track.
// Objects (IDs and names) from Wiimm's object database; sounds matched by name in revo_kart.brsar
// (SE_CC_ENV_*), and banks read from the archive.
import { listWaves, soundBank } from '../formats/brsar.js';

export const AMBIENT_SOUNDS = [
  { objectId: 0x005, object: 'sound_river', label: 'River', sound: 'SE_CC_ENV_RIVER' },
  { objectId: 0x00e, object: 'sound_big_river', label: 'Big river', sound: 'SE_CC_ENV_RIVER_L' },
  { objectId: 0x006, object: 'sound_water_fall', label: 'Waterfall', sound: 'SE_CC_ENV_WATER_FALL' },
  { objectId: 0x009, object: 'sound_big_fall', label: 'Big waterfall', sound: 'SE_CC_ENV_WATER_FALL_L' },
  { objectId: 0x008, object: 'sound_lake', label: 'Lake', sound: 'SE_CC_ENV_LAKE' },
  { objectId: 0x00a, object: 'sound_sea', label: 'Sea waves', sound: 'SE_CC_ENV_SEA' },
  { objectId: 0x00b, object: 'sound_fountain', label: 'Fountain', sound: 'SE_CC_ENV_FOUNTAIN' },
  { objectId: 0x00c, object: 'sound_volcano', label: 'Volcano', sound: 'SE_CC_ENV_VOLCANO' },
  { objectId: 0x00d, object: 'sound_audience', label: 'Audience', sound: 'SE_CC_ENV_AUDIENCE' },
  { objectId: 0x015, object: 'sound_Mii', label: 'Mii audience', sound: 'SE_CC_ENV_AUDIENCE_MII' },
];

export const ambientSoundOf = (objectId) => AMBIENT_SOUNDS.find((s) => s.objectId === objectId) || null;

// The bank of an ambient sound and its samples (as listWaves gives them), with the other ambient
// sounds that use the same bank (they change too when its samples are replaced).
export function ambientSoundSamples(archive, ambient, waves = listWaves(archive)) {
  const index = archive.sounds.findIndex((s) => s.name === ambient.sound);
  const bank = index >= 0 ? soundBank(archive, index) : null;
  if (!bank) return null;
  const sharing = AMBIENT_SOUNDS.filter((other) => other !== ambient && (() => {
    const i = archive.sounds.findIndex((s) => s.name === other.sound);
    return i >= 0 && soundBank(archive, i)?.fileId === bank.fileId;
  })());
  return { bank, samples: waves.filter((w) => w.kind === 'Bank sample' && w.fileId === bank.fileId), sharing };
}
