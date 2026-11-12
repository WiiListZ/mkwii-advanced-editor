// What differs between two versions of a track. "Added" means it is in this version (the one open) and
// not the other, whose name is given when comparing: the open one is what can be selected and moved to.

import { parseBRRES } from '../formats/brres.js';
import { listFiles } from '../formats/u8.js';

const MOVED = 1; // units: less than this is the same place
const NEAR = 8000; // units: farther than this, one was removed and another added
const REGION_CELL = 3000; // collision changes are grouped on a grid this size
const MAX_REGIONS = 40;

const round = (value) => typeof value === 'number' ? Math.round(value * 1000) / 1000 : value;
function fingerprint(entry) {
  const out = {};
  for (const [key, value] of Object.entries(entry)) {
    if (key === 'uid' || key.startsWith('_')) continue;
    out[key] = Array.isArray(value) ? value.map(round) : round(value);
  }
  return JSON.stringify(out);
}

const midpoint = (cp) => [(cp.left[0] + cp.right[0]) / 2, 0, (cp.left[1] + cp.right[1]) / 2];
const whereIs = (entry) => entry.pos || (entry.left ? midpoint(entry) : null);
const flat = (groups) => groups.flatMap((group) => group.points);
const distance = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

const SECTIONS = [
  { id: 'GOBJ', name: 'Objects', read: (k) => k.GOBJ, kind: (o) => o.objectId, label: (o, names) => names?.(o.objectId) ?? `Object 0x${o.objectId.toString(16)}` },
  { id: 'KTPT', name: 'Start positions', read: (k) => k.KTPT, label: () => 'Start position' },
  { id: 'JGPT', name: 'Respawns', read: (k) => k.JGPT, label: (j) => `Respawn ${j.id ?? ''}`.trim() },
  { id: 'CNPT', name: 'Cannons', read: (k) => k.CNPT || [], label: () => 'Cannon' },
  { id: 'MSPT', name: 'Battle ends', read: (k) => k.MSPT || [], label: () => 'Battle end' },
  { id: 'AREA', name: 'Areas', read: (k) => k.AREA, kind: (a) => a.type, label: (a) => `Area of type ${a.type}` },
  { id: 'CAME', name: 'Cameras', read: (k) => k.CAME, kind: (c) => c.type, label: (c) => `Camera of type ${c.type}` },
  { id: 'ENPT', name: 'Enemy route', read: (k) => flat(k.ENPT), label: () => 'Enemy route point' },
  { id: 'ITPT', name: 'Item route', read: (k) => flat(k.ITPT), label: () => 'Item route point' },
  { id: 'CKPT', name: 'Checkpoints', read: (k) => flat(k.CKPT), label: () => 'Checkpoint' },
  { id: 'POTI', name: 'Routes', read: (k) => flat(k.POTI), label: () => 'Route point' },
];

// The same entries in both are paired off first; of the rest, each pairs with the nearest of its kind.
function compareSection(section, mine, theirs, objectName) {
  const kindOf = section.kind || (() => 0), items = [];
  const left = new Map();
  for (const entry of theirs) {
    const print = fingerprint(entry);
    if (!left.has(print)) left.set(print, []);
    left.get(print).push(entry);
  }
  const remaining = [];
  for (const entry of mine) {
    const match = left.get(fingerprint(entry));
    if (match?.length) match.pop();
    else remaining.push(entry);
  }
  const other = [...left.values()].flat();
  // Nearest pairs first, so that a small move is not taken for a large one.
  const pairs = [];
  for (const a of remaining) {
    const here = whereIs(a);
    other.forEach((b) => {
      if (kindOf(a) !== kindOf(b)) return;
      const there = whereIs(b), gap = here && there ? distance(here, there) : 0;
      if (gap <= NEAR) pairs.push({ a, b, gap });
    });
  }
  pairs.sort((one, two) => one.gap - two.gap);
  const usedA = new Set(), usedB = new Set();
  for (const { a, b, gap } of pairs) {
    if (usedA.has(a) || usedB.has(b)) continue;
    usedA.add(a); usedB.add(b);
    const here = whereIs(a), there = whereIs(b);
    const moved = here && there && (gap > MOVED || Math.abs(here[1] - there[1]) > MOVED);
    const fields = Object.keys(a).filter((key) => key !== 'uid' && !key.startsWith('_') && key !== 'pos' && key !== 'left' && key !== 'right' && JSON.stringify(a[key]) !== JSON.stringify(b[key]));
    if (!moved && !fields.length) continue;
    items.push({ section: section.id, sectionName: section.name, label: section.label(a, objectName), state: moved ? 'moved' : 'changed', pos: here, from: moved ? there : null, key: a.uid, detail: moved ? `${Math.round(Math.hypot(gap, here[1] - there[1]))} units away${fields.length ? `; ${fields.join(', ')} changed` : ''}` : `${fields.join(', ')} changed` });
  }
  for (const a of remaining) if (!usedA.has(a)) items.push({ section: section.id, sectionName: section.name, label: section.label(a, objectName), state: 'added', pos: whereIs(a), key: a.uid, detail: '' });
  for (const b of other) if (!usedB.has(b)) items.push({ section: section.id, sectionName: section.name, label: section.label(b, objectName), state: 'removed', pos: whereIs(b), key: null, detail: '' });
  return items;
}

// Triangles compared by where they are, to a hundredth of a unit, and what they are.
function triangleKeys(kcl) {
  const places = new Map();
  if (!kcl) return places;
  const v = kcl.verts;
  for (let t = 0; t < kcl.count; t++) {
    if (kcl.valid && !kcl.valid[t]) continue;
    const o = t * 9;
    const place = Array.from({ length: 9 }, (_, i) => Math.round(v[o + i] * 100)).join();
    if (!places.has(place)) places.set(place, []);
    places.get(place).push({ flag: kcl.flags[t], at: [v[o], v[o + 1], v[o + 2]] });
  }
  return places;
}

function compareCollision(mine, theirs) {
  const a = triangleKeys(mine), b = triangleKeys(theirs);
  let added = 0, removed = 0, retyped = 0;
  const cells = new Map();
  const note = (at, what) => {
    const cell = `${Math.floor(at[0] / REGION_CELL)},${Math.floor(at[2] / REGION_CELL)}`;
    if (!cells.has(cell)) cells.set(cell, { x: Math.floor(at[0] / REGION_CELL), z: Math.floor(at[2] / REGION_CELL), added: 0, removed: 0, retyped: 0, min: [...at], max: [...at] });
    const region = cells.get(cell);
    region[what]++;
    for (let i = 0; i < 3; i++) { region.min[i] = Math.min(region.min[i], at[i]); region.max[i] = Math.max(region.max[i], at[i]); }
  };
  for (const [place, list] of a) {
    const others = b.get(place) || [];
    list.forEach((tri, i) => {
      if (i >= others.length) { added++; note(tri.at, 'added'); }
      else if (others[i].flag !== tri.flag) { retyped++; note(tri.at, 'retyped'); }
    });
  }
  for (const [place, list] of b) {
    const mineHere = a.get(place)?.length || 0;
    list.slice(mineHere).forEach((tri) => { removed++; note(tri.at, 'removed'); });
  }
  // Neighbouring cells are one region.
  const regions = [], seen = new Set();
  for (const [name, start] of cells) {
    if (seen.has(name)) continue;
    const region = { added: 0, removed: 0, retyped: 0, min: [...start.min], max: [...start.max] }, stack = [start];
    seen.add(name);
    while (stack.length) {
      const cell = stack.pop();
      region.added += cell.added; region.removed += cell.removed; region.retyped += cell.retyped;
      for (let i = 0; i < 3; i++) { region.min[i] = Math.min(region.min[i], cell.min[i]); region.max[i] = Math.max(region.max[i], cell.max[i]); }
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const next = `${cell.x + dx},${cell.z + dz}`;
        if (cells.has(next) && !seen.has(next)) { seen.add(next); stack.push(cells.get(next)); }
      }
    }
    regions.push(region);
  }
  regions.sort((one, two) => (two.added + two.removed + two.retyped) - (one.added + one.removed + one.retyped));
  return { added, removed, retyped, regions: regions.slice(0, MAX_REGIONS), regionCount: regions.length };
}

const sameData = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);

function textureChanges(a, b) {
  try {
    const one = parseBRRES(a).textures, two = parseBRRES(b).textures, out = [];
    for (const [name, texture] of one) {
      const other = two.get(name);
      if (!other) out.push(`${name} added`);
      else if (!sameData(texture.data || [], other.data || [])) out.push(`${name} changed`);
    }
    for (const name of two.keys()) if (!one.has(name)) out.push(`${name} removed`);
    return out;
  } catch { return []; }
}

function compareFiles(mine, theirs) {
  const list = (szs) => new Map((szs ? listFiles(szs) : []).filter((file) => !/(^|[\\/])course\.(kmp|kcl)$/i.test(file.path)).map((file) => [file.path.replace(/^\.\//, ''), file.node]));
  const a = list(mine), b = list(theirs), out = [];
  for (const [path, file] of a) {
    const other = b.get(path);
    if (!other) out.push({ path, state: 'added', size: file.data.length, detail: '' });
    else if (!sameData(file.data, other.data)) {
      const textures = /\.brres$/i.test(path) ? textureChanges(file.data, other.data) : [];
      out.push({ path, state: 'changed', size: file.data.length - other.data.length, detail: textures.length ? `Textures: ${textures.slice(0, 6).join(', ')}${textures.length > 6 ? `, and ${textures.length - 6} more` : ''}` : '' });
    }
  }
  for (const [path, file] of b) if (!a.has(path)) out.push({ path, state: 'removed', size: -file.data.length, detail: '' });
  return out;
}

// Both versions as { kmp, kcl, szs }. objectName gives an object's name from its id.
export function compareTrack(mine, theirs, objectName = null) {
  const items = SECTIONS.flatMap((section) => compareSection(section, section.read(mine.kmp), section.read(theirs.kmp), objectName));
  // Track settings have no place on the map.
  const settings = [];
  const stageA = mine.kmp.STGI?.[0], stageB = theirs.kmp.STGI?.[0];
  if (stageA && stageB) for (const key of Object.keys(stageA)) {
    if (key === 'uid' || key.startsWith('_') || JSON.stringify(stageA[key]) === JSON.stringify(stageB[key])) continue;
    settings.push({ field: key, mine: stageA[key], theirs: stageB[key] });
  }
  const collision = compareCollision(mine.kcl, theirs.kcl), files = compareFiles(mine.szs, theirs.szs);
  const count = (state) => items.filter((item) => item.state === state).length;
  const total = items.length + settings.length + collision.added + collision.removed + collision.retyped + files.length;
  return { identical: total === 0, items, settings, collision, files, counts: { added: count('added'), removed: count('removed'), moved: count('moved'), changed: count('changed') } };
}

// The places to go to, in the order of the list: those on the map, then collision regions.
export function differencePlaces(result) {
  const places = result.items.filter((item) => item.pos).map((item) => ({ kind: 'item', label: item.label, state: item.state, pos: item.pos, from: item.from, key: item.key, detail: item.detail }));
  for (const region of result.collision.regions) {
    const pos = [0, 1, 2].map((i) => (region.min[i] + region.max[i]) / 2);
    const parts = [region.added && `${region.added} added`, region.removed && `${region.removed} removed`, region.retyped && `${region.retyped} with another type`].filter(Boolean).join(', ');
    places.push({ kind: 'collision', label: 'Collision', state: 'collision', pos, min: region.min, max: region.max, key: null, detail: `${parts} triangles` });
  }
  return places;
}
