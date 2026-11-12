// What the open track holds of each part of its look: lighting, fog and effects. Shown when one of them
// is selected in the track list. Each is a list of { label, value, colour }, and a note when there is
// something to say about it as a whole.

import { fadeFrames, FOG_TYPES, parseBFG } from '../formats/bfg.js';
import { entryList, isBREFF, isBREFT, parseBREFT } from '../formats/effects.js';
import { listFiles } from '../formats/u8.js';

const nameOf = (path) => path.split(/[\\/]/).pop();
const sizeOf = (bytes) => bytes < 1024 ? `${bytes} bytes` : `${(bytes / 1024).toFixed(1)} KB`;
const toHex = (colour) => '#' + colour.map((value) => value.toString(16).padStart(2, '0')).join('');
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

export const LOOKS = {
  lighting: {
    title: 'Lighting', kind: 'posteffect',
    what: 'The lights and light maps that light characters, karts, objects and shiny surfaces on this track.',
    search: 'lighting light blight blmap posteffect',
  },
  fog: {
    title: 'Fog', kind: 'posteffect.bfg',
    what: 'How the track fades into the distance. An area of type Fog Swap changes to another setting while a kart is inside it.',
    search: 'fog bfg posteffect',
  },
  effects: {
    title: 'Effects', kind: 'effect folder',
    what: 'The particle effects of this track and its objects: smoke, fire, sparks and the like.',
    search: 'effects smoke fire sparks particles breff breft',
  },
};

function lighting(files) {
  const rows = files.filter((file) => /\.(blight|blmap)$/i.test(file.path)).map((file) => ({ label: nameOf(file.path), value: sizeOf(file.node.data.length) }));
  return { rows, note: rows.length ? null : 'This track has no lighting files of its own, so the game uses its default lights.' };
}

function fog(files, kmp) {
  const file = files.find((item) => /(^|[\\/])posteffect\.bfg$/i.test(item.path));
  if (!file) return { rows: [], note: 'This track has no fog file: it has no fog.' };
  let entries;
  try { entries = parseBFG(file.node.data); } catch { return { rows: [], note: 'This fog file could not be read.' }; }
  const kinds = new Map(FOG_TYPES);
  const rows = entries.map((entry, index) => {
    const areas = kmp.AREA.filter((area) => area.type === 2 && area.setting1 === index).length;
    if (!entry.type) return { label: `Fog ${index}`, value: areas ? `No fog · ${plural(areas, 'area')}` : 'No fog' };
    const parts = [kinds.get(entry.type) ?? `Kind ${entry.type}`, `${Math.round(entry.start).toLocaleString('en-US')} to ${Math.round(entry.end).toLocaleString('en-US')}`];
    if (areas) parts.push(plural(areas, 'area'));
    const frames = fadeFrames(entry.fade);
    if (index > 0 && frames > 1) parts.push(`fades over ${frames} frames`);
    return { label: `Fog ${index}`, value: parts.join(' · '), colour: toHex(entry.color) };
  });
  return { rows, note: null };
}

function effects(files) {
  const rows = [];
  let emitters = 0, textures = 0;
  for (const file of files) {
    const { data } = file.node;
    if (!data) continue;
    try {
      if (isBREFF(data)) { const count = entryList(data).length; emitters += count; rows.push({ label: nameOf(file.path), value: plural(count, 'emitter') }); }
      else if (isBREFT(data)) { const count = parseBREFT(data).textures?.length || 0; textures += count; rows.push({ label: nameOf(file.path), value: plural(count, 'texture') }); }
    } catch { rows.push({ label: nameOf(file.path), value: 'could not be read' }); }
  }
  return { rows, note: rows.length ? `${plural(emitters, 'emitter')} and ${plural(textures, 'texture')} in all.` : 'This track has no effect files of its own.' };
}

export function lookSummary(doc, id) {
  const files = doc.szs ? listFiles(doc.szs) : [];
  if (id === 'lighting') return lighting(files);
  if (id === 'fog') return fog(files, doc.kmp);
  return effects(files);
}
