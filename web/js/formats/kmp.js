// KMP format (course.kmp): objects, routes, checkpoints, areas, cameras...
// In memory, points (ENPT/ITPT/CKPT) are nested inside their groups (ENPH/ITPH/CKPH)
// to make editing intuitive; per-point prev/next links are recomputed on save.

import { BinaryReader, BinaryWriter } from './binary.js';

export const SECTION_ORDER = ['KTPT', 'ENPT', 'ENPH', 'ITPT', 'ITPH', 'CKPT', 'CKPH', 'GOBJ', 'POTI', 'AREA', 'CAME', 'JGPT', 'CNPT', 'MSPT', 'STGI'];

// Field layout: [name, type, (array length)]
export const ENTRY_FIELDS = {
  KTPT: [['pos', 'vec3'], ['rot', 'vec3'], ['playerIndex', 's16'], ['pad', 'u16']],
  ENPT: [['pos', 'vec3'], ['width', 'f32'], ['setting1', 'u16'], ['setting2', 'u8'], ['setting3', 'u8']],
  ITPT: [['pos', 'vec3'], ['width', 'f32'], ['setting1', 'u16'], ['setting2', 'u16']],
  CKPT: [['left', 'vec2'], ['right', 'vec2'], ['respawn', 'u8'], ['type', 'u8'], ['prev', 'u8'], ['next', 'u8']],
  PH:   [['start', 'u8'], ['length', 'u8'], ['prev', 'u8', 6], ['next', 'u8', 6], ['setting1', 'u8'], ['setting2', 'u8']],
  GOBJ: [['objectId', 'u16'], ['pad', 'u16'], ['pos', 'vec3'], ['rot', 'vec3'], ['scale', 'vec3'], ['route', 'u16'], ['settings', 'u16', 8], ['presence', 'u16']],
  AREA: [['shape', 'u8'], ['type', 'u8'], ['camera', 'u8'], ['priority', 'u8'], ['pos', 'vec3'], ['rot', 'vec3'], ['scale', 'vec3'], ['setting1', 'u16'], ['setting2', 'u16'], ['route', 'u8'], ['enemyPoint', 'u8'], ['pad', 'u16']],
  CAME: [['type', 'u8'], ['next', 'u8'], ['shake', 'u8'], ['route', 'u8'], ['pointSpeed', 'u16'], ['zoomSpeed', 'u16'], ['viewSpeed', 'u16'], ['start', 'u8'], ['movie', 'u8'], ['pos', 'vec3'], ['rot', 'vec3'], ['zoomStart', 'f32'], ['zoomEnd', 'f32'], ['viewStart', 'vec3'], ['viewEnd', 'vec3'], ['time', 'f32']],
  JGPT: [['pos', 'vec3'], ['rot', 'vec3'], ['id', 'u16'], ['range', 's16']],
  CNPT: [['pos', 'vec3'], ['rot', 'vec3'], ['id', 'u16'], ['effect', 's16']],
  MSPT: [['pos', 'vec3'], ['rot', 'vec3'], ['id', 'u16'], ['unknown', 'u16']],
  STGI: [['laps', 'u8'], ['pole', 'u8'], ['distance', 'u8'], ['flareFlash', 'u8'], ['flareColor', 'u32'], ['unknown8', 'u8'], ['pad', 'u8'], ['speedMod', 'u16']],
};

const POINT_SECTIONS = { ENPT: 'ENPH', ITPT: 'ITPH', CKPT: 'CKPH' };
const GROUP_SECTIONS = { ENPH: 'ENPT', ITPH: 'ITPT', CKPH: 'CKPT' };

let uidCounter = 1;
export const newUid = () => uidCounter++;

function readField(r, type) {
  switch (type) {
    case 'vec3': return r.vec3();
    case 'vec2': return r.vec2();
    case 'u8': return r.u8();
    case 's8': return r.s8();
    case 'u16': return r.u16();
    case 's16': return r.s16();
    case 'u32': return r.u32();
    case 'f32': return r.f32();
  }
  throw new Error('Unknown field type ' + type);
}

function writeField(w, type, v) {
  switch (type) {
    case 'vec3': return w.vec3(v);
    case 'vec2': return w.vec2(v);
    case 'u8': return w.u8(v);
    case 's8': return w.s8(v);
    case 'u16': return w.u16(v);
    case 's16': return w.s16(v);
    case 'u32': return w.u32(v);
    case 'f32': return w.f32(v);
  }
}

export function readEntry(r, fields) {
  const e = {};
  for (const [name, type, count] of fields) {
    if (count) { e[name] = []; for (let i = 0; i < count; i++) e[name].push(readField(r, type)); }
    else e[name] = readField(r, type);
  }
  return e;
}

export function writeEntry(w, fields, e) {
  for (const [name, type, count] of fields) {
    if (count) for (let i = 0; i < count; i++) writeField(w, type, e[name][i] ?? 0);
    else writeField(w, type, e[name] ?? 0);
  }
}

const TYPE_SIZE = { vec3: 12, vec2: 8, u8: 1, s8: 1, u16: 2, s16: 2, u32: 4, f32: 4 };
const entrySize = (fields) => fields.reduce((s, [, t, c]) => s + TYPE_SIZE[t] * (c || 1), 0);

const fieldsFor = (magic) => GROUP_SECTIONS[magic] ? ENTRY_FIELDS.PH : ENTRY_FIELDS[magic];

export function parseKMP(data) {
  const r = new BinaryReader(data);
  if (r.str(4) !== 'RKMD') throw new Error('Invalid KMP file (missing RKMD magic)');
  r.u32();
  const count = r.u16();
  const headerLen = r.u16();
  const version = r.u32();
  if (version < 0x900) throw new Error(`KMP version 0x${version.toString(16)} is an early development format that the game does not use`);
  const offsets = [];
  for (let i = 0; i < count; i++) offsets.push(r.u32());

  const doc = { version, order: [], extras: {}, raw: {} };
  const rawSections = {};
  const sorted = offsets.map((o, i) => ({ o, i })).sort((a, b) => a.o - b.o);

  for (let i = 0; i < count; i++) {
    const start = headerLen + offsets[i];
    const nextIdx = sorted.findIndex((s) => s.i === i) + 1;
    const end = nextIdx < sorted.length ? headerLen + sorted[nextIdx].o : data.length;
    r.seek(start);
    const magic = r.str(4);
    const n = r.u16();
    const extra = r.u16();
    doc.order.push(magic);
    doc.extras[magic] = extra;

    if (magic === 'POTI') {
      const routes = [];
      for (let k = 0; k < n; k++) {
        const pc = r.u16();
        const route = { uid: newUid(), smooth: r.u8(), loop: r.u8(), points: [] };
        for (let p = 0; p < pc; p++) {
          route.points.push({ uid: newUid(), pos: r.vec3(), setting1: r.u16(), setting2: r.u16() });
        }
        routes.push(route);
      }
      rawSections.POTI = routes;
    } else if (fieldsFor(magic)) {
      const fields = fieldsFor(magic);
      const entries = [];
      // Older files can use shorter entries (e.g. 8-byte STGI): read what exists, default the rest to 0.
      const size = entrySize(fields);
      const stride = n ? Math.floor((end - start - 8) / n) : size;
      for (let k = 0; k < n; k++) {
        const at = start + 8 + k * stride;
        if (stride >= size) entries.push({ uid: newUid(), ...readEntry(r.seek(at), fields) });
        else {
          const padded = new Uint8Array(size);
          padded.set(data.slice(at, at + stride));
          entries.push({ uid: newUid(), ...readEntry(new BinaryReader(padded), fields) });
        }
      }
      rawSections[magic] = entries;
    } else {
      // Unknown section: preserved byte for byte.
      doc.raw[magic] = data.slice(start, end);
    }
  }

  // Nest points inside their groups.
  for (const [pt, ph] of Object.entries(POINT_SECTIONS)) {
    const points = rawSections[pt] || [];
    const groups = rawSections[ph] || [];
    const list = groups.map((g) => ({
      uid: newUid(),
      points: points.slice(g.start, g.start + g.length),
      prev: g.prev.filter((v) => v !== 0xFF),
      next: g.next.filter((v) => v !== 0xFF),
      setting1: g.setting1,
      setting2: g.setting2,
    }));
    if (!groups.length && points.length) list.push({ uid: newUid(), points: points.slice(), prev: [0], next: [0], setting1: 0, setting2: 0 });
    doc[pt] = list;
  }
  for (const m of ['KTPT', 'GOBJ', 'POTI', 'AREA', 'CAME', 'JGPT', 'CNPT', 'MSPT', 'STGI']) doc[m] = rawSections[m] || [];
  if (!doc.STGI.length) doc.STGI.push(defaultStageInfo());
  return doc;
}

export function defaultStageInfo() {
  return { uid: newUid(), laps: 3, pole: 0, distance: 0, flareFlash: 1, flareColor: 0xE6E6E6, unknown8: 0, pad: 0, speedMod: 0 };
}

// Flatten groups back into point and group lists.
function flattenGroups(groups) {
  const points = [], phs = [];
  let start = 0;
  for (const g of groups) {
    const pad6 = (arr) => { const a = arr.slice(0, 6); while (a.length < 6) a.push(0xFF); return a; };
    phs.push({ start, length: g.points.length, prev: pad6(g.prev), next: pad6(g.next), setting1: g.setting1 | 0, setting2: g.setting2 | 0 });
    points.push(...g.points);
    start += g.points.length;
  }
  return { points, phs };
}

export function buildKMP(doc) {
  const order = doc.order && doc.order.length ? doc.order : SECTION_ORDER;
  const sections = {};
  for (const [pt, ph] of Object.entries(POINT_SECTIONS)) {
    const { points, phs } = flattenGroups(doc[pt] || []);
    if (pt === 'CKPT') {
      let idx = 0;
      for (const g of doc[pt]) {
        g.points.forEach((p, i) => {
          p.prev = i === 0 ? 0xFF : idx + i - 1;
          p.next = i === g.points.length - 1 ? 0xFF : idx + i + 1;
        });
        idx += g.points.length;
      }
    }
    sections[pt] = points;
    sections[ph] = phs;
  }
  for (const m of ['KTPT', 'GOBJ', 'POTI', 'AREA', 'CAME', 'JGPT', 'CNPT', 'MSPT', 'STGI']) sections[m] = doc[m] || [];

  const allMagics = [...order];
  for (const m of SECTION_ORDER) if (!allMagics.includes(m)) allMagics.push(m);

  const headerLen = 0x10 + allMagics.length * 4;
  const w = new BinaryWriter(0x10000);
  w.str('RKMD');
  w.u32(0);
  w.u16(allMagics.length);
  w.u16(headerLen);
  w.u32(doc.version || 0x9D8);
  for (let i = 0; i < allMagics.length; i++) w.u32(0);

  allMagics.forEach((magic, i) => {
    w.patchU32(0x10 + i * 4, w.pos - headerLen);
    if (doc.raw && doc.raw[magic]) { w.bytes(doc.raw[magic]); return; }
    const entries = sections[magic] || [];
    w.str(magic);
    w.u16(entries.length);
    let extra = doc.extras?.[magic] ?? 0;
    if (magic === 'POTI') extra = entries.reduce((s, rt) => s + rt.points.length, 0);
    w.u16(extra);
    if (magic === 'POTI') {
      for (const rt of entries) {
        w.u16(rt.points.length); w.u8(rt.smooth | 0); w.u8(rt.loop | 0);
        for (const p of rt.points) { w.vec3(p.pos); w.u16(p.setting1 | 0); w.u16(p.setting2 | 0); }
      }
    } else {
      const fields = fieldsFor(magic);
      for (const e of entries) writeEntry(w, fields, e);
    }
  });
  w.patchU32(4, w.size);
  return w.toUint8Array();
}

export function emptyKMP() {
  const doc = { version: 0x9D8, order: [...SECTION_ORDER], extras: {}, raw: {} };
  for (const m of ['ENPT', 'ITPT', 'CKPT']) doc[m] = [];
  for (const m of ['KTPT', 'GOBJ', 'POTI', 'AREA', 'CAME', 'JGPT', 'CNPT', 'MSPT']) doc[m] = [];
  doc.STGI = [defaultStageInfo()];
  return doc;
}

// Factories for new entities (used when the editor adds something).
export const make = {
  KTPT: (pos = [0, 0, 0], rot = [0, 0, 0]) => ({ uid: newUid(), pos, rot, playerIndex: -1, pad: 0 }),
  ENPT: (pos = [0, 0, 0]) => ({ uid: newUid(), pos, width: 10, setting1: 0, setting2: 0, setting3: 0 }),
  ITPT: (pos = [0, 0, 0]) => ({ uid: newUid(), pos, width: 10, setting1: 0, setting2: 0 }),
  CKPT: (left = [-1000, 0], right = [1000, 0]) => ({ uid: newUid(), left, right, respawn: 0, type: 0xFF, prev: 0xFF, next: 0xFF }),
  group: (points = []) => ({ uid: newUid(), points, prev: [], next: [], setting1: 0, setting2: 0 }),
  GOBJ: (objectId = 0x65, pos = [0, 0, 0]) => ({ uid: newUid(), objectId, pad: 0, pos, rot: [0, 0, 0], scale: [1, 1, 1], route: 0xFFFF, settings: [0, 0, 0, 0, 0, 0, 0, 0], presence: 0x3F }),
  route: (points = []) => ({ uid: newUid(), smooth: 0, loop: 0, points }),
  routePoint: (pos = [0, 0, 0]) => ({ uid: newUid(), pos, setting1: 0, setting2: 0 }),
  AREA: (pos = [0, 0, 0]) => ({ uid: newUid(), shape: 0, type: 0, camera: 0xFF, priority: 0, pos, rot: [0, 0, 0], scale: [1, 1, 1], setting1: 0, setting2: 0, route: 0xFF, enemyPoint: 0xFF, pad: 0 }),
  CAME: (pos = [0, 0, 0]) => ({ uid: newUid(), type: 0, next: 0xFF, shake: 0, route: 0xFF, pointSpeed: 0, zoomSpeed: 0, viewSpeed: 0, start: 0, movie: 0, pos, rot: [0, 0, 0], zoomStart: 30, zoomEnd: 30, viewStart: [0, 0, 0], viewEnd: [0, 0, 0], time: 0 }),
  JGPT: (pos = [0, 0, 0], rot = [0, 0, 0]) => ({ uid: newUid(), pos, rot, id: 0, range: -1 }),
  CNPT: (pos = [0, 0, 0]) => ({ uid: newUid(), pos, rot: [0, 0, 0], id: 0, effect: 0 }),
  MSPT: (pos = [0, 0, 0]) => ({ uid: newUid(), pos, rot: [0, 0, 0], id: 0, unknown: 0 }),
};
