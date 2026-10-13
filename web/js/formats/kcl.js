// KCL format (course.kcl): track collision.
// parseKCL rebuilds triangles from "prisms"; buildKCL writes a complete file (including the octree).

import { BinaryReader, BinaryWriter } from './binary.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a); return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; };

export function parseKCL(data) {
  const r = new BinaryReader(data);
  const posOff = r.u32();
  const nrmOff = r.u32();
  const prismOff = r.u32();
  const octOff = r.u32();
  const thickness = r.f32();
  const areaMin = r.vec3();
  if (posOff < 0x38 || posOff > data.length || nrmOff > data.length || octOff > data.length) {
    throw new Error('Invalid KCL file');
  }
  const readVecs = (off, count) => {
    const out = new Float32Array(count * 3);
    r.seek(off);
    for (let i = 0; i < count * 3; i++) out[i] = r.f32();
    return out;
  };
  const posCount = Math.floor((nrmOff - posOff) / 12);
  const firstPrism = prismOff + 0x10;
  const nrmCount = Math.floor((firstPrism - nrmOff) / 12);
  const prismCount = Math.max(0, Math.floor((octOff - firstPrism) / 0x10));
  const P = readVecs(posOff, posCount);
  const N = readVecs(nrmOff, nrmCount);
  const vecAt = (arr, i) => [arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]];

  const verts = new Float32Array(prismCount * 9);
  const flags = new Uint16Array(prismCount);
  const valid = new Uint8Array(prismCount);
  r.seek(firstPrism);
  for (let i = 0; i < prismCount; i++) {
    const h = r.f32();
    const pi = r.u16(), fi = r.u16(), ai = r.u16(), bi = r.u16(), ci = r.u16();
    flags[i] = r.u16();
    if (pi >= posCount || fi >= nrmCount || ai >= nrmCount || bi >= nrmCount || ci >= nrmCount) continue;
    const p = vecAt(P, pi), fn = vecAt(N, fi), ea = vecAt(N, ai), eb = vecAt(N, bi), ec = vecAt(N, ci);
    const crossA = cross(ea, fn), crossB = cross(eb, fn);
    const dB = dot(crossB, ec), dA = dot(crossA, ec);
    if (Math.abs(dA) < 1e-9 || Math.abs(dB) < 1e-9) continue;
    const v2 = add(p, mul(crossB, h / dB));
    const v3 = add(p, mul(crossA, h / dA));
    if (![...v2, ...v3].every(Number.isFinite)) continue;
    verts.set([...p, ...v2, ...v3], i * 9);
    valid[i] = 1;
  }
  return { verts, flags, valid, count: prismCount, prismDataOffset: firstPrism, thickness, areaMin, raw: data };
}

// Change only the collision flags inside the original file (no octree rebuild).
export function patchKCLFlags(kcl) {
  const out = kcl.raw.slice();
  const view = new DataView(out.buffer);
  for (let i = 0; i < kcl.count; i++) view.setUint16(kcl.prismDataOffset + i * 0x10 + 0x0E, kcl.flags[i]);
  return out;
}

// ---------------------------------------------------------------------------
// Triangle / AABB overlap test (separating axis theorem, Akenine-Möller).
function triBoxOverlap(center, half, a, b, c) {
  const v0 = sub(a, center), v1 = sub(b, center), v2 = sub(c, center);
  const e0 = sub(v1, v0), e1 = sub(v2, v1), e2 = sub(v0, v2);
  const axisTest = (axis) => {
    const p0 = dot(v0, axis), p1 = dot(v1, axis), p2 = dot(v2, axis);
    const r = half[0] * Math.abs(axis[0]) + half[1] * Math.abs(axis[1]) + half[2] * Math.abs(axis[2]);
    return !(Math.min(p0, p1, p2) > r || Math.max(p0, p1, p2) < -r);
  };
  for (const e of [e0, e1, e2]) {
    if (!axisTest([0, -e[2], e[1]])) return false;
    if (!axisTest([e[2], 0, -e[0]])) return false;
    if (!axisTest([-e[1], e[0], 0])) return false;
  }
  for (let k = 0; k < 3; k++) {
    if (Math.min(v0[k], v1[k], v2[k]) > half[k] || Math.max(v0[k], v1[k], v2[k]) < -half[k]) return false;
  }
  const n = cross(e0, e1);
  return axisTest(n);
}

// Prisms store their four normals as u16 indices, so a KCL holds at most 65535 different normals.
// Detailed, curved models have about four unique normals per triangle and would run out at ~16k
// triangles. When that happens, directions that fall in the same small grid cell are merged into
// their average; the cell grows in small steps only as far as needed, so the shape barely changes.
const NORMAL_STEPS = [1e-5];
for (let step = 1e-4; step < 0.1; step *= 1.25) NORMAL_STEPS.push(step);
function shareNormals(prisms) {
  const raw = prisms.flatMap((p) => p.raw);
  const ids = new Int32Array(raw.length);
  for (const step of NORMAL_STEPS) {
    // Components are within ±1, so the three cell coordinates pack into one exact number.
    const m = Math.ceil(1 / step) + 1, w = 2 * m + 1;
    const map = new Map();
    let fits = true;
    for (let i = 0; i < raw.length; i++) {
      const n = raw[i];
      const key = ((Math.round(n[0] / step) + m) * w + Math.round(n[1] / step) + m) * w + Math.round(n[2] / step) + m;
      let id = map.get(key);
      if (id === undefined) {
        if (map.size === 0x10000) { fits = false; break; }
        id = map.size;
        map.set(key, id);
      }
      ids[i] = id;
    }
    if (!fits) continue;
    const sums = new Float64Array(map.size * 3);
    for (let i = 0; i < raw.length; i++) for (let k = 0; k < 3; k++) sums[ids[i] * 3 + k] += raw[i][k];
    const normals = Array.from({ length: map.size }, (_, i) => norm([sums[i * 3], sums[i * 3 + 1], sums[i * 3 + 2]]));
    prisms.forEach((p, i) => { [p.fn, p.ea, p.eb, p.ec] = ids.subarray(i * 4, i * 4 + 4); delete p.raw; });
    return normals;
  }
  throw new Error('This collision has too many different surface directions for a KCL');
}

/**
 * Builds a KCL file.
 * @param {Float32Array|number[]} verts 9 values per triangle
 * @param {Uint16Array|number[]} flags one flag per triangle
 */
export function buildKCL(verts, flags, opts = {}) {
  const maxTris = opts.maxTris ?? 32;
  const minCube = opts.minCube ?? 256;
  const margin = opts.margin ?? 250;
  const thickness = opts.thickness ?? 300;
  const radius = opts.radius ?? 250;

  const positions = [], posMap = new Map();
  const addPosition = (v) => {
    const key = v.join(',');
    let i = posMap.get(key);
    if (i === undefined) { i = positions.length; positions.push(v); posMap.set(key, i); }
    return i;
  };

  const prisms = [];
  const tris = [];
  const triCount = Math.floor(verts.length / 9);
  for (let t = 0; t < triCount; t++) {
    const A = [verts[t * 9], verts[t * 9 + 1], verts[t * 9 + 2]];
    const B = [verts[t * 9 + 3], verts[t * 9 + 4], verts[t * 9 + 5]];
    const C = [verts[t * 9 + 6], verts[t * 9 + 7], verts[t * 9 + 8]];
    const fnRaw = cross(sub(B, A), sub(C, A));
    if (len(fnRaw) < 1e-4) continue; // degenerate triangle
    const fn = norm(fnRaw);
    const enA = norm(cross(fn, sub(C, A)));
    const enB = norm(cross(sub(B, A), fn));
    const enC = norm(cross(sub(C, B), fn));
    const height = dot(sub(C, A), enC);
    if (!(height > 0)) continue;
    prisms.push({ height, pos: addPosition(A), raw: [fn, enA, enB, enC], flag: flags[t] & 0xFFFF });
    tris.push([A, B, C]);
  }
  if (prisms.length > 0xFFFE) throw new Error(`Too many triangles for a KCL (${prisms.length.toLocaleString()}, the format allows 65,534)`);
  if (!prisms.length) throw new Error('No valid triangles for the KCL');
  const normals = shareNormals(prisms);

  // Bounding box.
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const tri of tris) for (const v of tri) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], v[k]); max[k] = Math.max(max[k], v[k]); }
  for (let k = 0; k < 3; k++) { min[k] = Math.floor(min[k] - margin - 1); max[k] = Math.ceil(max[k] + margin + 1); }
  const ext = sub(max, min);
  const nextPow2 = (v) => { let p = 1; while (p < v) p *= 2; return p; };
  const shift = Math.max(Math.log2(minCube), Math.log2(nextPow2(Math.max(...ext) / 16)));
  const cube = 2 ** shift;
  const counts = ext.map((e) => nextPow2(Math.max(1, Math.ceil(e / cube))));
  const xBits = Math.log2(counts[0]), yBits = Math.log2(counts[1]);

  const boxes = tris.map(([a, b, c]) => [
    Math.min(a[0], b[0], c[0]), Math.min(a[1], b[1], c[1]), Math.min(a[2], b[2], c[2]),
    Math.max(a[0], b[0], c[0]), Math.max(a[1], b[1], c[1]), Math.max(a[2], b[2], c[2]),
  ]);

  // Recursive octree build.
  const buildNode = (origin, size, candidates) => {
    const h = size / 2 + margin;
    const center = [origin[0] + size / 2, origin[1] + size / 2, origin[2] + size / 2];
    const lo = [center[0] - h, center[1] - h, center[2] - h], hi = [center[0] + h, center[1] + h, center[2] + h];
    const list = candidates.filter((i) => {
      const bb = boxes[i];
      if (bb[0] > hi[0] || bb[3] < lo[0] || bb[1] > hi[1] || bb[4] < lo[1] || bb[2] > hi[2] || bb[5] < lo[2]) return false;
      return triBoxOverlap(center, [h, h, h], ...tris[i]);
    });
    if (list.length <= maxTris || size <= minCube) return { leaf: true, list };
    const half = size / 2;
    const children = [];
    for (let i = 0; i < 8; i++) {
      const o = [origin[0] + (i & 1 ? half : 0), origin[1] + (i & 2 ? half : 0), origin[2] + (i & 4 ? half : 0)];
      children.push(buildNode(o, half, list));
    }
    return { leaf: false, children };
  };
  const all = tris.map((_, i) => i);
  const roots = [];
  for (let z = 0; z < counts[2]; z++)
    for (let y = 0; y < counts[1]; y++)
      for (let x = 0; x < counts[0]; x++)
        roots.push(buildNode([min[0] + x * cube, min[1] + y * cube, min[2] + z * cube], cube, all));

  // Layout: root block, child blocks (8 x u32), triangle lists (u16, 0-terminated).
  const blocks = []; // { node, offset }
  let cursor = roots.length * 4;
  const queue = [];
  const enqueue = (node) => { if (!node.leaf) { node.offset = cursor; cursor += 32; queue.push(node); } };
  roots.forEach(enqueue);
  for (let qi = 0; qi < queue.length; qi++) { blocks.push(queue[qi]); queue[qi].children.forEach(enqueue); }
  const listsStart = cursor;
  const listData = [0];
  const listMap = new Map();
  const listPtr = (list) => {
    const key = list.join(',');
    let p = listMap.get(key);
    if (p === undefined) {
      p = listsStart + (listData.length - 1) * 2; // points at the 0 preceding the list (the game pre-increments)
      for (const i of list) listData.push(i + 1);
      listData.push(0);
      listMap.set(key, p);
    }
    return p;
  };
  const entryValue = (node, blockStart) =>
    node.leaf ? (0x80000000 | (listPtr(node.list) - blockStart)) >>> 0 : node.offset - blockStart;

  const octree = new BinaryWriter(cursor + 1024);
  for (const n of roots) octree.u32(entryValue(n, 0));
  for (const b of blocks) for (const c of b.children) octree.u32(entryValue(c, b.offset));
  for (const v of listData) octree.u16(v);

  // Write the file.
  const w = new BinaryWriter(0x40 + positions.length * 12 + normals.length * 12 + prisms.length * 16 + octree.size);
  w.seek(0x3C);
  const posOff = w.pos;
  for (const p of positions) w.vec3(p);
  const nrmOff = w.pos;
  for (const n of normals) w.vec3(n);
  w.align(4);
  const prismStart = w.pos;
  for (const p of prisms) {
    w.f32(p.height); w.u16(p.pos); w.u16(p.fn); w.u16(p.ea); w.u16(p.eb); w.u16(p.ec); w.u16(p.flag);
  }
  w.align(4);
  const octOff = w.pos;
  w.bytes(octree.toUint8Array());
  const end = w.size;
  w.seek(0);
  w.u32(posOff); w.u32(nrmOff); w.u32(prismStart - 0x10); w.u32(octOff);
  w.f32(thickness); w.vec3(min);
  const mask = (c) => (~(c * cube - 1)) >>> 0;
  w.u32(mask(counts[0])); w.u32(mask(counts[1])); w.u32(mask(counts[2]));
  w.u32(shift); w.u32(xBits); w.u32(xBits + yBits);
  w.f32(radius);
  w.seek(end);
  return w.toUint8Array();
}

// Emulates the game's octree lookup (used by tests and the validator).
export function kclLookup(data, point) {
  const r = new BinaryReader(data);
  const octOff = r.seek(0x0C).u32();
  const min = r.seek(0x14).vec3();
  const mx = r.u32(), my = r.u32(), mz = r.u32();
  const shift0 = r.u32(), yShift = r.u32(), zShift = r.u32();
  const x = Math.floor(point[0] - min[0]), y = Math.floor(point[1] - min[1]), z = Math.floor(point[2] - min[2]);
  if (x < 0 || y < 0 || z < 0 || (x & mx) || (y & my) || (z & mz)) return null;
  let shift = shift0;
  let block = octOff;
  let offset = 4 * (((z >>> shift) << zShift) | ((y >>> shift) << yShift) | (x >>> shift));
  let value;
  for (;;) {
    value = r.seek(block + offset).u32();
    if (value & 0x80000000) break;
    shift--;
    block += value;
    offset = 4 * ((((z >>> shift) & 1) << 2) | (((y >>> shift) & 1) << 1) | ((x >>> shift) & 1));
  }
  let p = block + (value & 0x7FFFFFFF);
  const out = [];
  for (;;) { p += 2; const v = r.seek(p).u16(); if (!v) break; out.push(v - 1); }
  return out;
}
