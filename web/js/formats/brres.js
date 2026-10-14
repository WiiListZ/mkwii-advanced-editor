// BRRES reader: MDL0 models (geometry, bones, weights, materials), TEX0/PLT0 textures,
// CHR0 bone animations and SRT0 texture animations. Output is plain data (no Three.js).

import { parseGXMaterial } from './gx.js';

class View {
  constructor(data) {
    this.d = data;
    this.v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }
  u8(o) { return this.d[o]; }
  s8(o) { return this.v.getInt8(o); }
  u16(o) { return this.v.getUint16(o); }
  s16(o) { return this.v.getInt16(o); }
  u32(o) { return this.v.getUint32(o); }
  s32(o) { return this.v.getInt32(o); }
  f32(o) { return this.v.getFloat32(o); }
  str(o) {
    let s = '';
    for (let i = o; i < this.d.length && this.d[i]; i++) s += String.fromCharCode(this.d[i]);
    return s;
  }
  magic(o) { return String.fromCharCode(this.d[o], this.d[o + 1], this.d[o + 2], this.d[o + 3]); }
  // Index group (resource dictionary): returns [{ name, offset }] with absolute offsets.
  group(off) {
    const n = this.u32(off + 4);
    const out = [];
    for (let i = 1; i <= n; i++) {
      const e = off + 8 + i * 16;
      out.push({ name: this.str(off + this.u32(e + 8)), offset: off + this.u32(e + 12) });
    }
    return out;
  }
}

export function isBRRES(data) {
  return data.length > 16 && data[0] === 0x62 && data[1] === 0x72 && data[2] === 0x65 && data[3] === 0x73;
}

export function parseBRRES(data) {
  if (!isBRRES(data)) throw new Error('Not a BRRES file');
  const r = new View(data);
  const root = r.u16(0x0C) + 8;
  const out = { models: [], textures: new Map(), palettes: new Map(), chr: new Map(), srt: new Map(), pat: new Map(), clr: new Map() };
  for (const folder of r.group(root)) {
    const items = r.group(folder.offset);
    for (const it of items) {
      const magic = r.magic(it.offset);
      try {
        if (magic === 'MDL0') out.models.push(parseMDL0(r, it.offset, it.name));
        else if (magic === 'TEX0') out.textures.set(it.name, parseTEX0(r, it.offset, it.name));
        else if (magic === 'PLT0') out.palettes.set(it.name, parsePLT0(r, it.offset, it.name));
        else if (magic === 'CHR0') out.chr.set(it.name, parseCHR0(r, it.offset, it.name));
        else if (magic === 'SRT0') out.srt.set(it.name, parseSRT0(r, it.offset, it.name));
        else if (magic === 'PAT0') out.pat.set(it.name, parsePAT0(r, it.offset, it.name));
        else if (magic === 'CLR0') out.clr.set(it.name, parseCLR0(r, it.offset, it.name));
      } catch (e) {
        console.warn(`BRRES: could not read ${folder.name}/${it.name}: ${e.message}`);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// MDL0

const SECTIONS = {
  8: ['defs', 'bones', 'verts', 'norms', 'colors', 'uvs', 'mats', 'tev', 'objs', 'texlinks', 'pallinks'],
  10: ['defs', 'bones', 'verts', 'norms', 'colors', 'uvs', 'furvec', 'furpos', 'mats', 'tev', 'objs', 'texlinks', 'pallinks'],
  11: ['defs', 'bones', 'verts', 'norms', 'colors', 'uvs', 'furvec', 'furpos', 'mats', 'tev', 'objs', 'texlinks', 'pallinks', 'userdata'],
};

function parseMDL0(r, base, name) {
  const version = r.u32(base + 8);
  const layout = version >= 11 ? SECTIONS[11] : version === 10 ? SECTIONS[10] : SECTIONS[8];
  const sec = {};
  layout.forEach((key, i) => {
    const o = r.s32(base + 0x10 + i * 4);
    sec[key] = o ? r.group(base + o) : [];
  });
  const info = base + 0x10 + layout.length * 4 + 4;
  const model = {
    name,
    version,
    boundsOffset: info + 0x28,
    min: [r.f32(info + 0x28), r.f32(info + 0x2C), r.f32(info + 0x30)],
    max: [r.f32(info + 0x34), r.f32(info + 0x38), r.f32(info + 0x3C)],
    bones: parseBones(r, sec.bones),
    arrays: {
      pos: parseArrays(r, sec.verts, 'pos'),
      nrm: parseArrays(r, sec.norms, 'nrm'),
      clr: parseArrays(r, sec.colors, 'clr'),
      uv: parseArrays(r, sec.uvs, 'uv'),
    },
    materials: sec.mats.map((m) => parseMaterial(r, m.offset, m.name, version)),
    weights: new Map(),     // matrixId -> [{ id, w }]  (envelopes, vertices in model space)
    envBone: new Map(),     // matrixId -> bone index (single-bone envelopes, vertices in model space)
    boneMatrix: new Map(),  // matrixId -> bone index (rigid, vertices in bone space)
    draws: [],              // { material, object, bone, xlu }
  };
  for (const b of model.bones) model.boneMatrix.set(b.matrixId, b.index);
  parseDefinitions(r, sec.defs, model);
  model.objects = sec.objs.map((o) => parsePolygon(r, o.offset, o.name, model));
  return model;
}

function parseBones(r, entries) {
  const byOffset = new Map();
  const bones = entries.map((e) => {
    const o = e.offset;
    const mtx = (at) => Array.from({ length: 12 }, (_, i) => r.f32(at + i * 4));
    const b = {
      name: e.name,
      offset: o,
      index: r.u32(o + 0x0C),
      matrixId: r.u32(o + 0x10),
      flags: r.u32(o + 0x14),
      // 0 none, 1 standard, 2 standard perspective, 3 rotation, 4 rotation perspective, 5 Y axis, 6 Y axis perspective
      billboard: r.u32(o + 0x18),
      scale: [r.f32(o + 0x20), r.f32(o + 0x24), r.f32(o + 0x28)],
      rot: [r.f32(o + 0x2C), r.f32(o + 0x30), r.f32(o + 0x34)],
      trans: [r.f32(o + 0x38), r.f32(o + 0x3C), r.f32(o + 0x40)],
      parentOff: r.s32(o + 0x5C),
      world: mtx(o + 0x70),     // 3x4 row-major bind matrix (model space)
      inverse: mtx(o + 0xA0),
      parent: -1,
    };
    byOffset.set(o, b);
    return b;
  });
  for (const b of bones) if (b.parentOff) b.parent = byOffset.get(b.offset + b.parentOff)?.index ?? -1;
  bones.sort((a, b) => a.index - b.index);
  return bones;
}

function parseDefinitions(r, defs, model) {
  for (const def of defs) {
    let p = def.offset;
    const xlu = def.name === 'DrawXlu';
    for (let guard = 0; guard < 100000; guard++) {
      const op = r.u8(p);
      if (op === 0x02) { p += 5; continue; }                       // NodeTree: bone, parent matrix
      if (op === 0x03) {                                           // envelope: matrix, n x (matrix id, weight)
        const id = r.u16(p + 1), n = r.u8(p + 3);
        const list = [];
        for (let i = 0; i < n; i++) list.push({ id: r.u16(p + 4 + i * 6), w: r.f32(p + 6 + i * 6) });
        model.weights.set(id, list);
        p += 4 + n * 6;
        continue;
      }
      if (op === 0x04) {                                           // draw: material, object, bone, priority
        model.draws.push({ material: r.u16(p + 1), object: r.u16(p + 3), bone: r.u16(p + 5), xlu });
        p += 8;
        continue;
      }
      if (op === 0x05) {                                           // matrix id -> bone (single-bone envelope)
        const id = r.u16(p + 1), bone = r.u16(p + 3);
        if (!model.boneMatrix.has(id)) model.envBone.set(id, bone);
        p += 5;
        continue;
      }
      if (op === 0x06) { p += 5; continue; }
      break; // 0x01 = end, anything else = unknown
    }
  }
}

// ---- Vertex arrays --------------------------------------------------------------------

const COMP_SIZE = [1, 1, 2, 2, 4];

function readComp(r, o, fmt, scale) {
  switch (fmt) {
    case 0: return r.u8(o) * scale;
    case 1: return r.s8(o) * scale;
    case 2: return r.u16(o) * scale;
    case 3: return r.s16(o) * scale;
    default: return r.f32(o);
  }
}

function parseArrays(r, entries, kind) {
  const map = new Map();
  for (const e of entries) {
    const o = e.offset;
    const data = o + r.s32(o + 0x08);
    const index = r.u32(o + 0x10);
    const comp = r.u32(o + 0x14);
    const fmt = r.u32(o + 0x18);
    const count = r.u16(o + 0x1E);
    if (kind === 'clr') {
      const stride = r.u8(o + 0x1C);
      const out = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) out.set(readColor(r, data + i * stride, fmt), i * 4);
      map.set(index, { name: e.name, count, size: 4, data: out });
      continue;
    }
    const div = r.u8(o + 0x1C);
    const stride = r.u8(o + 0x1D);
    const scale = 1 / (1 << div);
    const n = kind === 'pos' ? (comp ? 3 : 2) : kind === 'uv' ? (comp ? 2 : 1) : (comp === 0 ? 3 : 9);
    const csize = COMP_SIZE[fmt] ?? 4;
    const size = kind === 'nrm' ? 3 : kind === 'pos' ? 3 : 2;
    const out = new Float32Array(count * size);
    for (let i = 0; i < count; i++) {
      const at = data + i * (stride || n * csize);
      for (let c = 0; c < Math.min(n, size); c++) out[i * size + c] = readComp(r, at + c * csize, fmt, scale);
    }
    map.set(index, { name: e.name, count, size, data: out, comp, offset: data, headerOffset: o, stride: stride || n * csize, fmt, div });
  }
  return map;
}

function readColor(r, o, fmt) {
  switch (fmt) {
    case 0: { const v = r.u16(o); return [((v >> 11) & 31) / 31, ((v >> 5) & 63) / 63, (v & 31) / 31, 1]; }
    case 1: return [r.u8(o) / 255, r.u8(o + 1) / 255, r.u8(o + 2) / 255, 1];
    case 2: return [r.u8(o) / 255, r.u8(o + 1) / 255, r.u8(o + 2) / 255, 1];
    case 3: { const v = r.u16(o); return [((v >> 12) & 15) / 15, ((v >> 8) & 15) / 15, ((v >> 4) & 15) / 15, (v & 15) / 15]; }
    case 4: { const v = (r.u8(o) << 16) | (r.u8(o + 1) << 8) | r.u8(o + 2); return [((v >> 18) & 63) / 63, ((v >> 12) & 63) / 63, ((v >> 6) & 63) / 63, (v & 63) / 63]; }
    default: return [r.u8(o) / 255, r.u8(o + 1) / 255, r.u8(o + 2) / 255, r.u8(o + 3) / 255];
  }
}

// ---- Materials ----------------------------------------------------------------------------

function parseMaterial(r, o, name, version) {
  const flags = r.u32(o + 0x10);
  const numTex = r.u32(o + 0x2C);
  const layerOff = o + r.s32(o + 0x30);
  const layers = [];
  for (let i = 0; i < numTex; i++) {
    const l = layerOff + i * 0x34;
    const nameOff = r.s32(l);
    const palOff = r.s32(l + 4);
    layers.push({
      texture: nameOff ? r.str(l + nameOff) : '',
      palette: palOff ? r.str(l + palOff) : '',
      texId: r.u32(l + 0x10),
      wrapS: r.u32(l + 0x18),
      wrapT: r.u32(l + 0x1C),
      minFilter: r.u32(l + 0x20),
      magFilter: r.u32(l + 0x24),
    });
  }
  // Texture SRT block (version 10/11 layout): flags, matrix mode, 8 x SRT, 8 x effect matrices.
  const srtBase = o + (version >= 10 ? 0x1A8 : 0x1A0);
  const texMtxMode = r.u32(srtBase + 4);
  const srt = [];
  for (let i = 0; i < 8; i++) {
    const s = srtBase + 8 + i * 20;
    const e = srtBase + 8 + 160 + i * 52;
    srt.push({
      scale: [r.f32(s), r.f32(s + 4)], rot: r.f32(s + 8), trans: [r.f32(s + 12), r.f32(s + 16)],
      mapMode: r.u8(e + 2),
    });
  }
  let gx = null;
  try { gx = parseGXMaterial(r, o, version); } catch { gx = null; }
  return {
    name,
    offset: o,
    gx,
    xlu: (flags & 0x80000000) !== 0,
    cull: r.u32(o + 0x18),
    alphaTest: r.u8(o + 0x1C) !== 0,
    layers,
    srt,
    texMtxMode,
  };
}

// ---- Polygons -----------------------------------------------------------------------------

function parsePolygon(r, o, name, model) {
  const matrixId = r.s32(o + 0x08);
  const vcdLo = r.u32(o + 0x0C), vcdHi = r.u32(o + 0x10);
  const primSize = r.u32(o + 0x24);
  const primStart = o + 0x24 + r.s32(o + 0x2C);
  const ids = {
    pos: r.s16(o + 0x48), nrm: r.s16(o + 0x4A), clr0: r.s16(o + 0x4C), clr1: r.s16(o + 0x4E),
    uv: Array.from({ length: 8 }, (_, i) => r.s16(o + 0x50 + i * 2)),
  };
  const nodeTableOff = model.version >= 10 ? r.s32(o + 0x64) : r.s32(o + 0x60);
  const nodeTable = [];
  if (nodeTableOff > 0) {
    const n = r.u32(o + nodeTableOff);
    if (n < 4096) for (let i = 0; i < n; i++) nodeTable.push(r.u16(o + nodeTableOff + 4 + i * 2));
  }

  // Attribute layout from the vertex descriptor.
  const attrs = [];
  if (vcdLo & 1) attrs.push({ kind: 'pnmtx', type: 1 });
  for (let i = 0; i < 8; i++) if (vcdLo & (1 << (i + 1))) attrs.push({ kind: 'texmtx', type: 1 });
  const t2 = (shift, v = vcdLo) => (v >> shift) & 3;
  if (t2(9)) attrs.push({ kind: 'pos', type: t2(9) });
  if (t2(11)) attrs.push({ kind: 'nrm', type: t2(11) });
  if (t2(13)) attrs.push({ kind: 'clr0', type: t2(13) });
  if (t2(15)) attrs.push({ kind: 'clr1', type: t2(15) });
  for (let i = 0; i < 8; i++) if (t2(i * 2, vcdHi)) attrs.push({ kind: 'uv', set: i, type: t2(i * 2, vcdHi) });

  const posArr = model.arrays.pos.get(ids.pos);
  const nrmArr = model.arrays.nrm.get(ids.nrm);
  const clrArr = model.arrays.clr.get(ids.clr0);
  const uvArrs = ids.uv.map((id) => (id >= 0 ? model.arrays.uv.get(id) : null));
  const nbt3 = nrmArr?.comp === 2;

  const verts = []; // { pos, nrm, clr, uv: [], mtx }
  const tris = [];
  const slots = new Map();
  let p = primStart;
  const end = primStart + primSize;
  let ok = !!posArr && attrs.every((a) => a.kind === 'pnmtx' || a.kind === 'texmtx' || a.type >= 2);

  const readVertex = () => {
    const v = { pos: -1, nrm: -1, clr: -1, uv: [], mtx: matrixId };
    for (const a of attrs) {
      if (a.type === 1) { // direct (matrix indices only)
        const val = r.u8(p); p += 1;
        if (a.kind === 'pnmtx') {
          const slot = val / 3;
          v.mtx = slots.has(slot) ? slots.get(slot) : nodeTable[slot] ?? matrixId;
        }
        continue;
      }
      const readIdx = () => { const x = a.type === 2 ? r.u8(p) : r.u16(p); p += a.type === 2 ? 1 : 2; return x; };
      const idx = readIdx();
      if (a.kind === 'nrm' && nbt3) { readIdx(); readIdx(); }
      if (a.kind === 'pos') v.pos = idx;
      else if (a.kind === 'nrm') v.nrm = idx;
      else if (a.kind === 'clr0') v.clr = idx;
      else if (a.kind === 'uv') v.uv[a.set] = idx;
    }
    return v;
  };

  while (ok && p < end) {
    const op = r.u8(p++);
    if (op === 0x00) continue;
    if (op === 0x08) { p += 5; continue; }
    if (op === 0x10) { const n = r.u16(p) + 1; p += 4 + n * 4; continue; }
    if (op === 0x20 || op === 0x28 || op === 0x30 || op === 0x38) {
      const val = r.u32(p); p += 4;
      if (op === 0x20) slots.set((val & 0xFFF) / 12, val >>> 16);
      continue;
    }
    if (op & 0x80) {
      const prim = op & 0xF8;
      const count = r.u16(p); p += 2;
      const start = verts.length;
      for (let i = 0; i < count; i++) verts.push(readVertex());
      const t = (a, b, c) => tris.push(start + a, start + c, start + b); // GX is clockwise; flip for CCW
      if (prim === 0x80) for (let i = 0; i + 3 < count; i += 4) { t(i, i + 1, i + 2); t(i, i + 2, i + 3); }
      else if (prim === 0x90) for (let i = 0; i + 2 < count; i += 3) t(i, i + 1, i + 2);
      else if (prim === 0x98) for (let i = 0; i + 2 < count; i++) (i & 1 ? t(i + 1, i, i + 2) : t(i, i + 1, i + 2));
      else if (prim === 0xA0) for (let i = 1; i + 1 < count; i++) t(0, i, i + 1);
      continue;
    }
    break; // unknown command: stop
  }

  // Expand into flat (non-indexed) triangle arrays.
  const n = tris.length;
  const positions = new Float32Array(n * 3);
  const positionIds = new Int32Array(n);
  const normals = nrmArr ? new Float32Array(n * 3) : null;
  const colors = clrArr ? new Float32Array(n * 4) : null;
  const usedUV = uvArrs.map((a, i) => (a && attrs.some((x) => x.kind === 'uv' && x.set === i) ? i : -1)).filter((i) => i >= 0);
  const uvs = Object.fromEntries(usedUV.map((i) => [i, new Float32Array(n * 2)]));
  const mtx = new Int32Array(n);
  for (let k = 0; k < n; k++) {
    const v = verts[tris[k]];
    positionIds[k] = v.pos;
    if (v.pos >= 0 && v.pos < posArr.count) positions.set(posArr.data.subarray(v.pos * 3, v.pos * 3 + 3), k * 3);
    if (normals && v.nrm >= 0 && v.nrm < nrmArr.count) normals.set(nrmArr.data.subarray(v.nrm * 3, v.nrm * 3 + 3), k * 3);
    if (colors) {
      if (v.clr >= 0 && v.clr < clrArr.count) colors.set(clrArr.data.subarray(v.clr * 4, v.clr * 4 + 4), k * 4);
      else colors.set([1, 1, 1, 1], k * 4);
    }
    for (const i of usedUV) {
      const a = uvArrs[i], id = v.uv[i];
      if (id >= 0 && id < a.count) uvs[i].set(a.data.subarray(id * 2, id * 2 + 2), k * 2);
    }
    mtx[k] = v.mtx;
  }
  return { name, matrixId, displayList: { offset: primStart, size: primSize }, positions, positionIds, normals, colors, uvs, mtx, triangles: n / 3,
    positionArrayId: ids.pos, positionIndices: [...new Set(verts.map((v) => v.pos).filter((i) => i >= 0 && i < (posArr?.count ?? 0)))] };
}

// A BRRES polygon often contains many separate props (and sometimes separate caps/stems).
// Group triangles by shared positions, then join close components that form one prop.
// How each polygon was split into objects when the track was opened. Moving an object next to
// another one would otherwise make them touch or overlap and merge into a single object.
const pieceMemory = new Map();
export function resetPieceMemory() { pieceMemory.clear(); }

export function polygonPieces(part) {
  if (part._pieces) return part._pieces;
  if (!part._rememberPieces) return part._pieces = splitPolygonPieces(part);
  const memoryKey = `${part.name}|${part.triangles}`;
  const remembered = pieceMemory.get(memoryKey);
  if (remembered && remembered.length === part.triangles) return part._pieces = piecesFromGroups(part, remembered);
  const result = splitPolygonPieces(part);
  pieceMemory.set(memoryKey, Int32Array.from(result.triangleToPiece));
  return part._pieces = result;
}

// Builds the pieces of a polygon from a triangle -> piece table (current positions).
function piecesFromGroups(part, groups) {
  const byGroup = new Map();
  for (let t = 0; t < part.triangles; t++) {
    let piece = byGroup.get(groups[t]);
    if (!piece) { piece = { triangles: [], positionIndices: new Set(), vertexIndices: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }; byGroup.set(groups[t], piece); }
    piece.triangles.push(t);
    for (let k = 0; k < 3; k++) {
      piece.vertexIndices.push(t * 3 + k);
      piece.positionIndices.add(part.positionIds[t * 3 + k]);
      for (let axis = 0; axis < 3; axis++) {
        const value = part.positions[t * 9 + k * 3 + axis];
        piece.min[axis] = Math.min(piece.min[axis], value);
        piece.max[axis] = Math.max(piece.max[axis], value);
      }
    }
  }
  const triangleToPiece = new Int32Array(part.triangles);
  const pieces = [...byGroup.entries()].sort((x, y) => x[0] - y[0]).map(([, p], i) => ({ ...p, index: i, positionIndices: [...p.positionIndices] }));
  pieces.forEach((p) => p.triangles.forEach((t) => { triangleToPiece[t] = p.index; }));
  return { pieces, triangleToPiece };
}

function splitPolygonPieces(part) {
  const count = part.triangles;
  const parent = Int32Array.from({ length: count }, (_, i) => i);
  const root = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const join = (a, b) => { parent[root(a)] = root(b); };
  const byPosition = new Map();
  for (let t = 0; t < count; t++) for (let k = 0; k < 3; k++) {
    const at = t * 9 + k * 3;
    const key = `${Math.round(part.positions[at] * 100)},${Math.round(part.positions[at + 1] * 100)},${Math.round(part.positions[at + 2] * 100)}`;
    const other = byPosition.get(key);
    if (other === undefined) byPosition.set(key, t);
    else join(t, other);
  }
  const connected = new Map();
  for (let t = 0; t < count; t++) {
    const id = root(t);
    let c = connected.get(id);
    if (!c) { c = { triangles: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }; connected.set(id, c); }
    c.triangles.push(t);
    for (let k = 0; k < 3; k++) for (let axis = 0; axis < 3; axis++) {
      const value = part.positions[t * 9 + k * 3 + axis];
      c.min[axis] = Math.min(c.min[axis], value);
      c.max[axis] = Math.max(c.max[axis], value);
    }
  }
  const list = [...connected.values()];
  const group = Int32Array.from({ length: list.length }, (_, i) => i);
  const groupRoot = (i) => { while (group[i] !== i) { group[i] = group[group[i]]; i = group[i]; } return i; };
  if (list.length <= 300) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    const overlap = (axis) => Math.min(a.max[axis], b.max[axis]) - Math.max(a.min[axis], b.min[axis]);
    const width = (c, axis) => c.max[axis] - c.min[axis];
    if (overlap(0) <= Math.max(1, Math.min(width(a, 0), width(b, 0)) * 0.3)) continue;
    if (overlap(2) <= Math.max(1, Math.min(width(a, 2), width(b, 2)) * 0.3)) continue;
    const yGap = Math.max(0, a.min[1] - b.max[1], b.min[1] - a.max[1]);
    if (yGap > Math.max(150, Math.max(width(a, 0), width(a, 2), width(b, 0), width(b, 2)) * 0.2)) continue;
    group[groupRoot(i)] = groupRoot(j);
  }
  const final = new Map(), triangleToPiece = new Int32Array(count);
  list.forEach((c, i) => {
    const id = groupRoot(i);
    let piece = final.get(id);
    if (!piece) { piece = { triangles: [], positionIndices: new Set(), vertexIndices: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }; final.set(id, piece); }
    for (let axis = 0; axis < 3; axis++) { piece.min[axis] = Math.min(piece.min[axis], c.min[axis]); piece.max[axis] = Math.max(piece.max[axis], c.max[axis]); }
    for (const t of c.triangles) {
      piece.triangles.push(t);
      for (let k = 0; k < 3; k++) {
        piece.vertexIndices.push(t * 3 + k);
        piece.positionIndices.add(part.positionIds[t * 3 + k]);
      }
    }
  });
  const pieces = [...final.values()].map((p, i) => ({ ...p, index: i, positionIndices: [...p.positionIndices] }));
  pieces.forEach((p) => p.triangles.forEach((t) => { triangleToPiece[t] = p.index; }));
  return { pieces, triangleToPiece };
}

// Rewrite selected MDL0 positions in place without changing its layout, materials or textures.
// Indexed position arrays can be shared; refuse an edit that would alter another polygon.
function rewriteBRRESPartPositions(data, modelName, partIndex, positionIndices, rewrite, allowedPartIndices = []) {
  const parsed = parseBRRES(data);
  const model = parsed.models.find((m) => m.name === modelName);
  const part = model?.objects[partIndex];
  if (!part?.triangles) throw new Error('Model part not found');
  const array = model.arrays.pos.get(part.positionArrayId);
  if (!array || array.comp !== 1 || array.fmt > 4) throw new Error('This model part has no editable XYZ position array');
  const validIndices = new Set(part.positionIndices);
  const used = new Set(positionIndices ?? part.positionIndices);
  if (!used.size) throw new Error('This model part has no editable vertices');
  if ([...used].some((id) => !validIndices.has(id))) throw new Error('Invalid model piece vertices');
  for (let i = 0; i < model.objects.length; i++) {
    if (i === partIndex || allowedPartIndices.includes(i)) continue;
    const other = model.objects[i];
    if (other.positionArrayId === part.positionArrayId && other.positionIndices?.some((id) => used.has(id)))
      throw new Error('This part shares vertices with another part and cannot be edited independently');
  }
  const out = data.slice();
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const scale = 2 ** array.div;
  const limits = [[0, 255], [-128, 127], [0, 65535], [-32768, 32767]];
  for (const id of used) {
    const value = rewrite(Array.from(array.data.subarray(id * 3, id * 3 + 3)), id, model, part);
    if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) throw new Error('Invalid transformed model position');
    for (let c = 0; c < 3; c++) {
      const at = array.offset + id * array.stride + c * COMP_SIZE[array.fmt];
      if (array.fmt === 4) view.setFloat32(at, value[c]);
      else {
        const packed = Math.round(value[c] * scale);
        if (!Number.isFinite(packed) || packed < limits[array.fmt][0] || packed > limits[array.fmt][1])
          throw new Error('Transform exceeds the position range of this BRRES part');
        if (array.fmt === 0) view.setUint8(at, packed);
        else if (array.fmt === 1) view.setInt8(at, packed);
        else if (array.fmt === 2) view.setUint16(at, packed);
        else view.setInt16(at, packed);
      }
    }
  }
  // Update the vertex-buffer bounds and conservatively expand the model bounds.
  const movedReader = new View(out);
  const actual = (id, c) => readComp(movedReader, array.offset + id * array.stride + c * COMP_SIZE[array.fmt], array.fmt, 1 / scale);
  for (let c = 0; c < 3; c++) {
    let min = Infinity, max = -Infinity;
    for (let id = 0; id < array.count; id++) {
      const value = actual(id, c);
      min = Math.min(min, value); max = Math.max(max, value);
    }
    view.setFloat32(array.headerOffset + 0x20 + c * 4, min);
    view.setFloat32(array.headerOffset + 0x2C + c * 4, max);
    let movedMin = Infinity, movedMax = -Infinity;
    for (const id of used) {
      const value = actual(id, c);
      movedMin = Math.min(movedMin, value); movedMax = Math.max(movedMax, value);
    }
    view.setFloat32(model.boundsOffset + c * 4, Math.min(model.min[c], movedMin));
    view.setFloat32(model.boundsOffset + 12 + c * 4, Math.max(model.max[c], movedMax));
  }
  return out;
}

export function translateBRRESPart(data, modelName, partIndex, delta, positionIndices = null, allowedPartIndices = []) {
  if (!Array.isArray(delta) || delta.length !== 3 || !delta.every(Number.isFinite)) throw new Error('Invalid model offset');
  return rewriteBRRESPartPositions(data, modelName, partIndex, positionIndices,
    (point) => point.map((value, axis) => value + delta[axis]), allowedPartIndices);
}

const matrixPoint = (m, p) => m
  ? [m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
    m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
    m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11]]
  : p;
const rotatePoint = (p, q) => {
  const [x, y, z] = p, [qx, qy, qz, qw] = q;
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  return [x + qw * tx + qy * tz - qz * ty,
    y + qw * ty + qz * tx - qx * tz,
    z + qw * tz + qx * ty - qy * tx];
};

// Rotate or scale an individual polygon piece around its selection pivot in model space.
export function transformBRRESPart(data, modelName, partIndex, positionIndices, { center, translation = [0, 0, 0], rotation = [0, 0, 0, 1], scale = [1, 1, 1] }, allowedPartIndices = []) {
  if (![center, translation, rotation, scale].every((v) => Array.isArray(v) && v.every(Number.isFinite))
    || center.length !== 3 || translation.length !== 3 || rotation.length !== 4 || scale.length !== 3)
    throw new Error('Invalid model transform');
  const matrices = new Map();
  return rewriteBRRESPartPositions(data, modelName, partIndex, positionIndices, (raw, id, model, part) => {
    if (!matrices.has(id)) {
      let matrixId = null;
      for (let i = 0; i < part.positionIds.length; i++) if (part.positionIds[i] === id) {
        if (matrixId !== null && matrixId !== part.mtx[i]) throw new Error('This vertex uses multiple bone matrices');
        matrixId = part.mtx[i];
      }
      if (matrixId !== null && !model.boneMatrix.has(matrixId) && (model.weights.has(matrixId) || model.envBone.has(matrixId)))
        throw new Error('Weighted model vertices cannot be transformed independently');
      matrices.set(id, matrixId === null ? null : model.bones[model.boneMatrix.get(matrixId)] || null);
    }
    const bone = matrices.get(id);
    const world = matrixPoint(bone?.world, raw);
    const offset = world.map((v, i) => (v - center[i]) * scale[i]);
    const rotated = rotatePoint(offset, rotation);
    const changed = rotated.map((v, i) => center[i] + translation[i] + v);
    return matrixPoint(bone?.inverse, changed);
  }, allowedPartIndices);
}

// ---------------------------------------------------------------------------------------
// Textures

function parseTEX0(r, o, name) {
  return {
    name,
    offset: o,
    size: r.u32(o + 4),
    width: r.u16(o + 0x1C),
    height: r.u16(o + 0x1E),
    format: r.u32(o + 0x20),
    mipmaps: r.u32(o + 0x24),
    dataOffset: o + r.s32(o + 0x10),
    reader: r,
    _rgba: null,
  };
}

function parsePLT0(r, o, name) {
  const format = r.u32(o + 0x18);
  const count = r.u16(o + 0x1C);
  const data = o + r.s32(o + 0x10);
  const colors = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) colors.set(decode16(r.u16(data + i * 2), format), i * 4);
  return { name, count, colors };
}

// 16-bit palette/texel formats: 0 IA8, 1 RGB565, 2 RGB5A3.
function decode16(v, fmt) {
  if (fmt === 0) { const i = v & 0xFF; return [i, i, i, v >> 8]; }
  if (fmt === 1) return [((v >> 11) & 31) * 255 / 31 | 0, ((v >> 5) & 63) * 255 / 63 | 0, (v & 31) * 255 / 31 | 0, 255];
  if (v & 0x8000) return [((v >> 10) & 31) * 255 / 31 | 0, ((v >> 5) & 31) * 255 / 31 | 0, (v & 31) * 255 / 31 | 0, 255];
  return [((v >> 8) & 15) * 17, ((v >> 4) & 15) * 17, (v & 15) * 17, ((v >> 12) & 7) * 255 / 7 | 0];
}

const BLOCK = { 0: [8, 8, 4], 1: [8, 4, 8], 2: [8, 4, 8], 3: [4, 4, 16], 4: [4, 4, 16], 5: [4, 4, 16], 6: [4, 4, 32], 8: [8, 8, 4], 9: [8, 4, 8], 10: [4, 4, 16], 14: [8, 8, 4] };

export const TEXTURE_FORMATS = { 0: 'I4', 1: 'I8', 2: 'IA4', 3: 'IA8', 4: 'RGB565', 5: 'RGB5A3', 6: 'RGBA32', 8: 'C4', 9: 'C8', 10: 'C14X2', 14: 'CMPR' };
export const formatHasAlpha = (fmt) => [0, 2, 3, 5, 6, 8, 9, 10, 14].includes(fmt);

const clampByte = (x) => Math.max(0, Math.min(255, Math.round(x)));
const rgb565 = (r, g, b) => ((Math.round(r * 31 / 255) << 11) | (Math.round(g * 63 / 255) << 5) | Math.round(b * 31 / 255));
const luminance = (r, g, b) => clampByte(r * 0.299 + g * 0.587 + b * 0.114);

// Replace the pixels of an existing TEX0 without changing BRRES offsets or material links.
// The PNG is resized by the UI to the existing texture size. Each mip level is regenerated.
export function replaceBRRESTexture(data, textureName, rgba) {
  const tex = parseBRRES(data).textures.get(textureName);
  if (!tex) throw new Error(`Texture ${textureName} not found`);
  if (![0, 1, 2, 3, 4, 5, 6, 14].includes(tex.format))
    throw new Error(`Texture format ${TEXTURE_FORMATS[tex.format] || tex.format} cannot be replaced yet`);
  if (rgba.length !== tex.width * tex.height * 4) throw new Error(`PNG must be ${tex.width} × ${tex.height} pixels`);
  const out = data.slice();
  encodeTextureLevels(out, tex.dataOffset, Math.min(tex.offset + tex.size, out.length), rgba, tex.width, tex.height, tex.format, tex.mipmaps);
  return out;
}

// Writes RGBA pixels as GX texture data at `start` (base level, then `levels - 1` smaller mipmaps).
// Shared by BRRES TEX0 and effect textures (BREFT); `end` bounds the space the texture owns.
export function encodeTextureLevels(out, start, end, rgba, width, height, format, levels = 1) {
  if (![0, 1, 2, 3, 4, 5, 6, 14].includes(format)) throw new Error(`Texture format ${TEXTURE_FORMATS[format] || format} cannot be replaced yet`);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  let pixels = rgba, w = width, h = height, at = start;
  for (let level = 0; level < Math.max(1, levels); level++) {
    const [bw, bh, bits] = BLOCK[format];
    const bytes = Math.ceil(w / bw) * Math.ceil(h / bh) * bw * bh * bits / 8;
    if (at + bytes > end) throw new Error('Texture mipmap data is truncated');
    encodeTextureLevel(out, view, at, pixels, w, h, format);
    at += bytes;
    if (w === 1 && h === 1) break;
    const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1), next = new Uint8Array(nw * nh * 4);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) sum += pixels[((Math.min(h - 1, y * 2 + dy) * w + Math.min(w - 1, x * 2 + dx)) * 4) + c];
      next[(y * nw + x) * 4 + c] = Math.round(sum / 4);
    }
    pixels = next; w = nw; h = nh;
  }
}

// A texture stored outside a BRRES (an effect's BREFT), decoded with the same GX decoder.
export function decodeTextureAt(data, dataOffset, width, height, format) {
  return decodeTexture({ width, height, format, dataOffset, reader: new View(data), _rgba: null });
}

function encodeTextureLevel(out, view, start, pixels, w, h, fmt) {
  const [bw, bh, bits] = BLOCK[fmt];
  const sample = (x, y) => {
    const p = (Math.min(h - 1, y) * w + Math.min(w - 1, x)) * 4;
    return [pixels[p], pixels[p + 1], pixels[p + 2], pixels[p + 3]];
  };
  let at = start;
  for (let yb = 0; yb < Math.ceil(h / bh); yb++) for (let xb = 0; xb < Math.ceil(w / bw); xb++) {
    if (fmt === 14) {
      for (let sb = 0; sb < 4; sb++) {
        const block = Array.from({ length: 16 }, (_, i) => sample(xb * 8 + (sb & 1) * 4 + (i & 3), yb * 8 + (sb >> 1) * 4 + (i >> 2)));
        const opaque = block.filter((c) => c[3] >= 128), alpha = opaque.length < 16;
        let c0 = 0, c1 = 0;
        if (opaque.length) {
          let best = -1, a = opaque[0], b = opaque[0];
          for (const x of opaque) for (const y of opaque) {
            const d = (x[0] - y[0]) ** 2 + (x[1] - y[1]) ** 2 + (x[2] - y[2]) ** 2;
            if (d > best) { best = d; a = x; b = y; }
          }
          c0 = rgb565(...a); c1 = rgb565(...b);
          if (alpha ? c0 > c1 : c0 <= c1) [c0, c1] = [c1, c0];
          if (!alpha && c0 === c1) c0 = Math.min(0xffff, c0 + 1);
        }
        const a = decode16(c0, 1), b = decode16(c1, 1);
        const palette = c0 > c1
          ? [a, b, a.map((v, i) => i === 3 ? 255 : (2 * v + b[i]) / 3), a.map((v, i) => i === 3 ? 255 : (v + 2 * b[i]) / 3)]
          : [a, b, a.map((v, i) => i === 3 ? 255 : (v + b[i]) / 2), [0, 0, 0, 0]];
        let packed = 0;
        for (const color of block) {
          let index = alpha && color[3] < 128 ? 3 : 0, distance = Infinity;
          if (!(alpha && color[3] < 128)) for (let i = 0; i < (alpha ? 3 : 4); i++) {
            const d = (color[0] - palette[i][0]) ** 2 + (color[1] - palette[i][1]) ** 2 + (color[2] - palette[i][2]) ** 2;
            if (d < distance) { distance = d; index = i; }
          }
          packed = (packed << 2) | index;
        }
        view.setUint16(at, c0); view.setUint16(at + 2, c1); view.setUint32(at + 4, packed >>> 0); at += 8;
      }
    } else if (fmt === 6) {
      for (let i = 0; i < 16; i++) {
        const [r, g, b, a] = sample(xb * 4 + (i & 3), yb * 4 + (i >> 2));
        out[at + i * 2] = a; out[at + i * 2 + 1] = r;
        out[at + 32 + i * 2] = g; out[at + 32 + i * 2 + 1] = b;
      }
      at += 64;
    } else {
      const size = bw * bh * bits / 8;
      for (let i = 0; i < bw * bh; i++) {
        const [r, g, b, a] = sample(xb * bw + i % bw, yb * bh + Math.floor(i / bw));
        const v = luminance(r, g, b);
        if (fmt === 0) out[at + (i >> 1)] = (out[at + (i >> 1)] & (i & 1 ? 0xf0 : 0x0f)) | ((Math.round(v / 17) & 15) << (i & 1 ? 0 : 4));
        else if (fmt === 1) out[at + i] = v;
        else if (fmt === 2) out[at + i] = (Math.round(a / 17) << 4) | Math.round(v / 17);
        else if (fmt === 3) { out[at + i * 2] = a; out[at + i * 2 + 1] = v; }
        else if (fmt === 4) view.setUint16(at + i * 2, rgb565(r, g, b));
        else if (fmt === 5) {
          const packed = a >= 224 ? 0x8000 | (Math.round(r * 31 / 255) << 10) | (Math.round(g * 31 / 255) << 5) | Math.round(b * 31 / 255)
            : (Math.round(a * 7 / 255) << 12) | (Math.round(r / 17) << 8) | (Math.round(g / 17) << 4) | Math.round(b / 17);
          view.setUint16(at + i * 2, packed);
        }
      }
      at += size;
    }
  }
}

// Decodes the base level of a texture into RGBA8 (rows top to bottom).
export function decodeTexture(tex, palette = null) {
  if (tex._rgba) return tex._rgba;
  const { width: w, height: h, format: fmt } = tex;
  const r = tex.reader, d = r.d;
  const out = new Uint8Array(w * h * 4);
  const [bw, bh] = BLOCK[fmt] || [4, 4];
  const bx = Math.ceil(w / bw), by = Math.ceil(h / bh);
  let p = tex.dataOffset;
  const put = (x, y, rgba) => { if (x < w && y < h) out.set(rgba, (y * w + x) * 4); };
  const pal = (i) => (palette ? palette.colors.subarray(i * 4, i * 4 + 4) : [i, i, i, 255]);

  if (fmt === 14) { // CMPR: 8x8 blocks of four DXT1 4x4 sub-blocks
    for (let yb = 0; yb < by; yb++) for (let xb = 0; xb < bx; xb++) {
      for (let sb = 0; sb < 4; sb++) {
        const c0 = r.u16(p), c1 = r.u16(p + 2), bits = r.u32(p + 4);
        p += 8;
        const a = decode16(c0, 1), b = decode16(c1, 1);
        const pal4 = c0 > c1
          ? [a, b, a.map((v, i) => (2 * v + b[i]) / 3 | 0), a.map((v, i) => (v + 2 * b[i]) / 3 | 0)]
          : [a, b, a.map((v, i) => (v + b[i]) / 2 | 0), [0, 0, 0, 0]];
        pal4[0][3] = pal4[1][3] = 255;
        if (c0 > c1) pal4[2][3] = pal4[3][3] = 255; else pal4[2][3] = 255;
        const ox = xb * 8 + (sb & 1) * 4, oy = yb * 8 + (sb >> 1) * 4;
        for (let i = 0; i < 16; i++) put(ox + (i & 3), oy + (i >> 2), pal4[(bits >>> (30 - i * 2)) & 3]);
      }
    }
  } else if (fmt === 6) { // RGBA32: AR then GB halves per 4x4 block
    for (let yb = 0; yb < by; yb++) for (let xb = 0; xb < bx; xb++) {
      for (let i = 0; i < 16; i++) {
        put(xb * 4 + (i & 3), yb * 4 + (i >> 2), [d[p + i * 2 + 1], d[p + 32 + i * 2], d[p + 32 + i * 2 + 1], d[p + i * 2]]);
      }
      p += 64;
    }
  } else {
    for (let yb = 0; yb < by; yb++) for (let xb = 0; xb < bx; xb++) {
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        const X = xb * bw + x, Y = yb * bh + y;
        let c;
        switch (fmt) {
          case 0: { const v = (d[p + (y * bw + x >> 1)] >> ((x & 1) ? 0 : 4)) & 15; const i = v * 17; c = [i, i, i, i]; break; }
          case 1: { const i = d[p + y * bw + x]; c = [i, i, i, i]; break; }
          case 2: { const v = d[p + y * bw + x]; const i = (v & 15) * 17; c = [i, i, i, (v >> 4) * 17]; break; }
          case 3: { const o = p + (y * bw + x) * 2; c = [d[o + 1], d[o + 1], d[o + 1], d[o]]; break; }
          case 4: c = decode16(r.u16(p + (y * bw + x) * 2), 1); break;
          case 5: c = decode16(r.u16(p + (y * bw + x) * 2), 2); break;
          case 8: c = pal((d[p + (y * bw + x >> 1)] >> ((x & 1) ? 0 : 4)) & 15); break;
          case 9: c = pal(d[p + y * bw + x]); break;
          case 10: c = pal(r.u16(p + (y * bw + x) * 2) & 0x3FFF); break;
          default: c = [255, 0, 255, 255];
        }
        put(X, Y, c);
      }
      p += BLOCK[fmt] ? (bw * bh * BLOCK[fmt][2]) / 8 : 32;
    }
  }
  tex._rgba = out;
  return out;
}

// ---------------------------------------------------------------------------------------
// Animations: tracks are { const } or { keys: [{ f, v, t }] } or { linear: Float32Array }.

export function evalTrack(track, frame) {
  if (!track) return undefined;
  if (track.const !== undefined) return track.const;
  if (track.linear) {
    const a = track.linear;
    const f = Math.max(0, Math.min(a.length - 1, frame));
    const i = Math.floor(f), t = f - i;
    return i + 1 < a.length ? a[i] + (a[i + 1] - a[i]) * t : a[i];
  }
  const k = track.keys;
  if (frame <= k[0].f) return k[0].v;
  if (frame >= k[k.length - 1].f) return k[k.length - 1].v;
  let i = 0;
  while (i + 1 < k.length && k[i + 1].f < frame) i++;
  const a = k[i], b = k[i + 1];
  const span = b.f - a.f;
  if (span <= 0) return b.v;
  const t = (frame - a.f) / span, t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * a.v + (-2 * t3 + 3 * t2) * b.v + ((t3 - 2 * t2 + t) * a.t + (t3 - t2) * b.t) * span;
}

function readKeys(r, at, format, frames) {
  // format: 1 = I4, 2 = I6, 3 = I12, 4/5/6 = linear 1/2/4 byte
  if (format === 3) {
    const n = r.u16(at);
    return { keys: Array.from({ length: n }, (_, i) => ({ f: r.f32(at + 8 + i * 12), v: r.f32(at + 12 + i * 12), t: r.f32(at + 16 + i * 12) })) };
  }
  if (format === 1 || format === 2) {
    const n = r.u16(at), step = r.f32(at + 8), base = r.f32(at + 12);
    const keys = [];
    for (let i = 0; i < n; i++) {
      if (format === 1) {
        const e = r.u32(at + 16 + i * 4);
        let tan = e & 0xFFF;
        if (tan & 0x800) tan -= 0x1000;
        keys.push({ f: e >>> 24, v: base + step * ((e >>> 12) & 0xFFF), t: tan / 32 });
      } else {
        const o = at + 16 + i * 6;
        keys.push({ f: r.u16(o) / 32, v: base + step * r.u16(o + 2), t: r.s16(o + 4) / 256 });
      }
    }
    return { keys };
  }
  if (format === 4 || format === 5) {
    const step = r.f32(at), base = r.f32(at + 4);
    const a = new Float32Array(frames + 1);
    for (let i = 0; i <= frames; i++) a[i] = base + step * (format === 4 ? r.u8(at + 8 + i) : r.u16(at + 8 + i * 2));
    return { linear: a };
  }
  if (format === 6) {
    const a = new Float32Array(frames + 1);
    for (let i = 0; i <= frames; i++) a[i] = r.f32(at + i * 4);
    return { linear: a };
  }
  return { const: 0 };
}

// Removes every face of one polygon in place: its display list is filled with GX NOPs, so the
// polygon stays in the file (no offsets change) but draws nothing, in the editor and in the game.
export function clearBRRESPolygon(data, modelName, partName) {
  const model = parseBRRES(data).models.find((m) => m.name === modelName);
  const part = model?.objects.find((o) => o.name === partName);
  if (!part?.displayList?.size) throw new Error(`Model polygon ${partName} not found`);
  const out = new Uint8Array(data);
  const { offset, size } = part.displayList;
  if (offset < 0 || offset + size > out.length) throw new Error('Invalid polygon display list');
  out.fill(0, offset, offset + size);
  return out;
}

// Turns looping of a CHR0 on or off in place (the flag sits after the frame count).
export function setCHR0Loop(data, name, loop) {
  const chr = parseBRRES(data).chr.get(name);
  if (!chr) throw new Error(`Animation ${name} not found`);
  const out = new Uint8Array(data);
  new DataView(out.buffer, out.byteOffset, out.byteLength).setUint32(chr.offset + chr.headerSize + 4, loop ? 1 : 0);
  return out;
}

function parseCHR0(r, o, name) {
  const version = r.u32(o + 8);
  const header = version >= 5 ? 0x20 : 0x1C;
  const frames = r.u16(o + header);
  const loop = r.u32(o + header + 4) !== 0;
  const bones = new Map();
  for (const e of r.group(o + r.s32(o + 0x10))) {
    const at = e.offset;
    const code = r.u32(at + 4);
    let p = at + 8;
    const value = (fixed, fmt) => {
      if (fixed) { const v = r.f32(p); p += 4; return { const: v }; }
      const off = r.s32(p); p += 4;
      return readKeys(r, at + off, fmt, frames);
    };
    const comp = (has, iso, fixedBit, fmt, def) => {
      if (!has) return null;
      if (iso) { const t = value(code & (1 << fixedBit), fmt); return [t, t, t]; }
      return [0, 1, 2].map((i) => value(code & (1 << (fixedBit + i)), fmt));
    };
    const identity = code & 0x2;
    const scale = identity ? null : comp(code & (1 << 22), code & (1 << 4), 13, (code >>> 25) & 3);
    const rot = identity ? null : comp(code & (1 << 23), code & (1 << 5), 16, (code >>> 27) & 7);
    const trans = identity ? null : comp(code & (1 << 24), code & (1 << 6), 19, (code >>> 30) & 3);
    bones.set(e.name, { scale, rot, trans });
  }
  return { offset: o, headerSize: header, name, frames, loop, bones };
}

// PAT0: texture swap animation. Per material, per texture slot: step keyframes { frame, texture }.
function parsePAT0(r, o, name) {
  const version = r.u32(o + 0x08);
  const base = o + 0x24 + (version >= 4 ? 4 : 0);
  const frames = r.u16(base + 0x08), numTex = r.u16(base + 0x0C), loop = r.u32(base + 0x10) !== 0;
  const texTable = o + r.s32(o + 0x14);
  const texNames = Array.from({ length: numTex }, (_, i) => r.str(texTable + r.s32(texTable + i * 4)));
  const materials = new Map();
  for (const e of r.group(o + r.s32(o + 0x10))) {
    const at = e.offset, flags = r.u32(at + 4);
    const slots = [];
    let p = at + 8;
    for (let i = 0; i < 8; i++) {
      const f = (flags >>> (i * 4)) & 0xF;
      if (!(f & 1)) continue;
      let keys;
      if (f & 2) keys = [{ frame: 0, texture: texNames[r.u16(p)] }];
      else {
        const track = at + r.s32(p), count = r.u16(track);
        keys = Array.from({ length: count }, (_, k) => ({ frame: r.f32(track + 8 + k * 8), texture: texNames[r.u16(track + 8 + k * 8 + 4)] }));
      }
      p += 4;
      if (f & 4) slots.push({ index: i, keys: keys.filter((k) => k.texture) });
    }
    materials.set(e.name, slots);
  }
  return { name, frames, loop, materials };
}

// CLR0: colour animation of material registers (0-1 material colour, 2-3 ambient, 4-6 TEV colour, 7-10 konst).
function parseCLR0(r, o, name) {
  const version = r.u32(o + 0x08);
  const base = o + 0x14 + (version >= 4 ? 4 : 0);
  const frames = r.u16(base + 0x08), loop = r.u32(base + 0x0C) !== 0;
  const rgba = (v) => [(v >>> 24) / 255, ((v >>> 16) & 255) / 255, ((v >>> 8) & 255) / 255, (v & 255) / 255];
  const materials = new Map();
  for (const e of r.group(o + r.s32(o + 0x10))) {
    const at = e.offset, flags = r.u32(at + 4);
    const targets = [];
    let p = at + 8;
    for (let i = 0; i < 11; i++) {
      const f = (flags >>> (i * 2)) & 3;
      if (!(f & 1)) continue;
      const mask = r.u32(p);
      let colors;
      if (f & 2) colors = [rgba(r.u32(p + 4))];
      else {
        const table = p + 4 + r.s32(p + 4);
        colors = Array.from({ length: frames + 1 }, (_, k) => rgba(r.u32(table + k * 4)));
      }
      targets.push({ target: i, keep: [24, 16, 8, 0].map((s) => ((mask >>> s) & 255) !== 0), colors });
      p += 8;
    }
    materials.set(e.name, targets);
  }
  return { name, frames, loop, materials };
}

function parseSRT0(r, o, name) {
  const version = r.u32(o + 8);
  const header = version >= 5 ? 0x20 : 0x1C;
  const frames = r.u16(o + header);
  const texMtxMode = r.u32(o + header + 4);
  const loop = r.u32(o + header + 8) !== 0;
  const materials = new Map();
  for (const e of r.group(o + r.s32(o + 0x10))) {
    const at = e.offset;
    const texFlags = r.u32(at + 4);
    const textures = [];
    let p = at + 12;
    for (let i = 0; i < 8; i++) {
      if (!(texFlags & (1 << i))) continue;
      const te = at + r.s32(p); p += 4;
      const code = r.u32(te);
      let q = te + 4;
      const value = (fixed) => {
        if (fixed) { const v = r.f32(q); q += 4; return { const: v }; }
        const off = r.s32(q); // SRT0 keyframe offsets are relative to the offset field itself
        const at = q + off;
        q += 4;
        return readKeys(r, at, 3, frames);
      };
      let scale = null, rot = null, trans = null;
      if (!(code & 0x2)) {
        if (code & 0x10) { const s = value(code & 0x20); scale = [s, s]; }
        else scale = [value(code & 0x20), value(code & 0x40)];
      }
      if (!(code & 0x4)) rot = value(code & 0x80);
      if (!(code & 0x8)) trans = [value(code & 0x100), value(code & 0x200)];
      textures.push({ index: i, scale, rot, trans });
    }
    materials.set(e.name, textures);
  }
  return { name, frames, loop, texMtxMode, materials };
}

