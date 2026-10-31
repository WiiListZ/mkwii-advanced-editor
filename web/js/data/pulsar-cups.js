// Cups of a Pulsar pack (see formats/pulsar.js): what the Cups window edits before writing.
// Unlike the original game, a pack defines its own cups, so tracks can trade places freely, cups can
// be moved, and new cups can be added at the end.
//
// arrangement = {
//   cups:   [{ from: original cup index | null (new cup), name?: typed name, icon?: { path } }],
//   tracks: [{ from: original track index | null, file?: { path, label }, name?, author?, slot?, music? }],
// }  — track i belongs to cup floor(i / 4).

import { PULSAR_IDS } from '../formats/pulsar.js';

export function initialPulsar(config) {
  return {
    cups: Array.from({ length: config.cupCount }, (_, i) => ({ from: i })),
    tracks: Array.from({ length: config.cupCount * 4 }, (_, i) => ({ from: i })),
  };
}

const copy = (a) => ({ cups: a.cups.slice(), tracks: a.tracks.slice() });

export function swapTracks(a, i, j) {
  if (i === j || j < 0 || j >= a.tracks.length) return a;
  const next = copy(a);
  [next.tracks[i], next.tracks[j]] = [next.tracks[j], next.tracks[i]];
  return next;
}

// dir -1 / +1: one place up or down (into the next cup at the ends); -4 / +4: same place of the
// previous or next cup.
export const moveTrack = (a, i, dir) => swapTracks(a, i, i + dir);

export function swapCups(a, c, d) {
  if (c === d || d < 0 || d >= a.cups.length) return a;
  const next = copy(a);
  [next.cups[c], next.cups[d]] = [next.cups[d], next.cups[c]];
  for (let k = 0; k < 4; k++) [next.tracks[c * 4 + k], next.tracks[d * 4 + k]] = [next.tracks[d * 4 + k], next.tracks[c * 4 + k]];
  return next;
}

export function addCup(a, name) {
  const next = copy(a);
  next.cups.push({ from: null, name });
  for (let k = 0; k < 4; k++) next.tracks.push({ from: null });
  return next;
}

// Only the last cup can be removed: removing one in the middle would renumber every track after it.
export function removeLastCup(a) {
  if (a.cups.length <= 1) throw new Error('A pack needs at least one cup');
  const next = copy(a);
  next.cups.pop();
  next.tracks.splice(-4, 4);
  return next;
}

export function patchTrack(a, i, patch) {
  const next = copy(a);
  next.tracks[i] = { ...next.tracks[i], ...patch };
  return next;
}

export function patchCup(a, c, patch) {
  const next = copy(a);
  next.cups[c] = { ...next.cups[c], ...patch };
  return next;
}

export function replaceTrack(a, i, path, label) {
  const { from, slot, music } = a.tracks[i];
  return patchTrack(a, i, { from: null, file: { path, label }, name: label, author: '', slot, music, origin: from ?? a.tracks[i].origin ?? null });
}

export function trackChanged(a, i) {
  const t = a.tracks[i];
  return t.from !== i || t.file || t.name !== undefined || t.author !== undefined || t.slot !== undefined || t.music !== undefined;
}
export function cupChanged(a, c) {
  const cup = a.cups[c];
  return cup.from !== c || cup.name !== undefined || !!cup.icon || [0, 1, 2, 3].some((k) => trackChanged(a, c * 4 + k));
}

// Names as they will be. `names` reads the mod's current names by original index:
// { track(from), author(from), cup(from) }, each a string or null.
export function trackName(a, i, names) {
  const t = a.tracks[i];
  if (t.name !== undefined) return t.name;
  return t.from !== null ? names.track(t.from) ?? `Track ${t.from + 1}` : '';
}
export function trackAuthor(a, i, names) {
  const t = a.tracks[i];
  if (t.author !== undefined) return t.author;
  return t.from !== null ? names.author(t.from) ?? '' : '';
}
export function cupName(a, c, names) {
  const cup = a.cups[c];
  if (cup.name !== undefined) return cup.name;
  return cup.from !== null ? names.cup(cup.from) ?? `Cup ${cup.from + 1}` : `Cup ${c + 1}`;
}

// Names of a Pulsar pack: messages of its BMG (text(id)).
export const pulsarNames = (text) => ({
  track: (from) => text(PULSAR_IDS.track + from), author: (from) => text(PULSAR_IDS.author + from), cup: (from) => text(PULSAR_IDS.cup + from),
});

// The track settings (slot, music, variants, CRC) as they will be. `crcOf(path, index)` gives the
// CRC of a track file chosen from disk, placed at `index`.
export function plannedTracks(config, a, crcOf) {
  return a.tracks.map((t, i) => {
    const base = t.from !== null ? config.tracks[t.from] : { slot: 0x08, music: 0x08, crc: 0, variants: [] };
    return {
      slot: t.slot ?? base.slot, music: t.music ?? base.music,
      crc: t.file ? crcOf(t.file.path, i) : base.crc,
      variants: t.file ? [] : base.variants,
    };
  });
}

// Messages of the pack's BMG that change: { id: text }. New cups and tracks get new messages.
export function pulsarNameChanges(config, a, text) {
  const out = {};
  const names = pulsarNames(text);
  const set = (id, value) => { if ((text(id) ?? null) !== value) out[id] = value; };
  a.cups.forEach((_, c) => set(PULSAR_IDS.cup + c, cupName(a, c, names)));
  a.tracks.forEach((t, i) => {
    set(PULSAR_IDS.track + i, trackName(a, i, names));
    set(PULSAR_IDS.author + i, trackAuthor(a, i, names));
    // Names of variants (and the common name, 8 << 12) travel with the track.
    const source = t.from !== null ? config.tracks[t.from] : null;
    for (const v of [...(source?.variants || []).map((_, k) => k + 1), ...(source?.variants?.length ? [8] : [])]) {
      const from = text(PULSAR_IDS.track + (v << 12) + t.from);
      if (from !== null && from !== undefined) set(PULSAR_IDS.track + (v << 12) + i, from);
    }
  });
  return out;
}

// Alphabetical order of the tracks (index list), as the pack stores it. Tracks keep their place in
// the old order (it was made by the Pack Creator); renamed and new tracks are put where their
// name sorts. Names are compared without BMG colour codes.
const clean = (s) => s.replace(/\\[mMxzuc]\{.*?\}/g, '').replace(/\{1A:[0-9a-f]+\}/gi, '').trim();
export function plannedAlphabetical(config, a, text) {
  const collator = new Intl.Collator('en', { sensitivity: 'variant', numeric: false });
  const names = a.tracks.map((_, i) => clean(trackName(a, i, pulsarNames(text))));
  const newIndex = new Map();
  a.tracks.forEach((t, i) => { if (t.from !== null && t.name === undefined && !t.file) newIndex.set(t.from, i); });
  const order = config.alphabetical.filter((old) => newIndex.has(old)).map((old) => newIndex.get(old));
  const placed = new Set(order);
  for (let i = 0; i < a.tracks.length; i++) {
    if (placed.has(i)) continue;
    let lo = 0, hi = order.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (collator.compare(names[order[mid]], names[i]) <= 0) lo = mid + 1; else hi = mid; }
    order.splice(lo, 0, i);
  }
  return order;
}

// FILE section with each track's line moved with it ("<id hex>=<file>|<expert ghosts>"); new
// tracks get their file name. Other lines (cups, regular tracks) are kept.
export function plannedFileSection(file, a) {
  const source = new TextDecoder('latin1').decode(file);
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/);
  const count = Math.max(...a.tracks.map((t) => (t.from ?? -1) + 1), a.tracks.length);
  const trackLine = new Map(), others = [];
  for (const line of lines.slice(1)) {
    const m = /^([0-9A-Fa-f]+)=(.*)$/.exec(line);
    if (m && m[2].includes('|') && parseInt(m[1], 16) < count) trackLine.set(parseInt(m[1], 16), m[2]);
    else others.push(line);
  }
  const body = a.tracks.map((t, i) => {
    const value = t.file ? `${t.file.label}||||` : t.from !== null ? trackLine.get(t.from) : undefined;
    return value === undefined ? null : `${i.toString(16).toUpperCase()}=${value}`;
  }).filter((l) => l !== null);
  const trailing = others.length && others[others.length - 1] === '' ? others.pop() : null;
  const out = [lines[0], ...body, ...others, ...(trailing !== null ? [''] : [])].join(eol);
  return Uint8Array.from(out, (c) => c.charCodeAt(0) & 255);
}

// Original file names of a pack folder: tracks (variants _1…_7), and expert ghosts by mode.
export const trackFile = (index, variant = 0) => `${index}${variant ? `_${variant}` : ''}.szs`;
export const EXPERT_MODES = ['150', '200', '150F', '200F'];
export const expertFile = (index, mode) => `${index}_${mode}.rkg`;
