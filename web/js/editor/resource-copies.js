// The game keeps separate copies of the same model in many archives: a character's driver_model in
// every vehicle archive (and again in the 2- and 4-player versions), an object such as itembox in
// every track and in the track's split-screen "_d" version. These helpers find those copies and
// carry an edit over to them.

import { parseBRRES } from '../formats/brres.js';

const sameBytes = (a, b) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};
// Stored pixels of a texture, all mipmap levels.
const pixels = (data, tex) => data.subarray(tex.dataOffset, tex.offset + tex.size);

// Textures whose stored pixels differ between two versions of a BRRES.
export function changedTextures(original, next) {
  const a = parseBRRES(original), b = parseBRRES(next);
  return [...b.textures.keys()].filter((name) => {
    const ta = a.textures.get(name), tb = b.textures.get(name);
    return ta && !sameBytes(pixels(original, ta), pixels(next, tb));
  });
}

// What changing `original` into `next` means for another copy of the resource. An identical copy
// becomes `next`. Another version of it (a lighter split-screen model, the driver on a bike instead
// of a kart) only gets the edited textures, where its texture was the same as the edited one.
export function updateCopy(copy, original, next, textures = null) {
  if (sameBytes(copy, original)) return sameBytes(copy, next) ? null : { data: next, kind: 'identical', textures: 0 };
  textures ??= changedTextures(original, next);
  if (!textures.length) return null;
  let parsed;
  try { parsed = parseBRRES(copy); } catch { return null; }
  const a = parseBRRES(original), b = parseBRRES(next);
  let out = null, count = 0;
  for (const name of textures) {
    const tc = parsed.textures.get(name), ta = a.textures.get(name), tb = b.textures.get(name);
    if (!tc || !ta || !tb) continue;
    const old = pixels(copy, tc), edited = pixels(next, tb);
    if (tc.format !== tb.format || tc.width !== tb.width || tc.height !== tb.height || edited.length !== old.length) continue;
    if (!sameBytes(old, pixels(original, ta))) continue;
    out ??= copy.slice();
    out.set(edited, tc.dataOffset);
    count++;
  }
  return out ? { data: out, kind: 'textures', textures: count } : null;
}

// Archives (file names in the same folder) that can hold copies of the resources of `archive`.
// `close`: the copies the game uses for the same thing (the character with other vehicles and in
// split screen; a track's split-screen version). `other`: archives that may share the object.
export function copyCandidates(category, archive, names) {
  const lower = archive.toLowerCase();
  const rest = names.filter((n) => n.toLowerCase() !== lower && /\.szs$/i.test(n));
  if (category === 'characters') {
    const driver = lower.match(/-([a-z0-9]+?)(?:_[24])?\.szs$/)?.[1];
    if (!driver) return { close: [], other: [] };
    const re = new RegExp(`-${driver}(?:_[24])?\\.szs$`, 'i');
    return { close: rest.filter((n) => re.test(n)), other: [] };
  }
  if (category === 'courses') {
    const twin = /_d\.szs$/i.test(lower) ? lower.replace(/_d\.szs$/, '.szs') : lower.replace(/\.szs$/, '_d.szs');
    return { close: rest.filter((n) => n.toLowerCase() === twin), other: rest.filter((n) => n.toLowerCase() !== twin) };
  }
  return { close: [], other: [] };
}
