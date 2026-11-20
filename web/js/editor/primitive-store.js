// Primitive models that stay editable: their settings are kept in a small file of the track archive,
// which the game does not read. Each entry names the course-model polygons the shape became and
// carries the affine transform from the shape's own triangles (buildPrimitive) to its collision in
// the world, so that the collision can be found again, follow the model when it is moved and be
// replaced with the shape.

import { buildPrimitive, PRIMITIVE_SHAPES, primitiveSpec } from './primitives.js';
import { parseBRRES } from '../formats/brres.js';

export const PRIMITIVE_STORE_PATH = 'mkwii_editor_primitives.json';

export function readPrimitiveStore(bytes) {
  if (!bytes?.length) return { version: 1, primitives: [] };
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    const primitives = Array.isArray(parsed?.primitives) ? parsed.primitives.filter((p) =>
      p && typeof p.id === 'number' && Array.isArray(p.parts) && p.parts.every((n) => typeof n === 'string') && p.spec && typeof p.spec === 'object') : [];
    return { version: 1, primitives };
  } catch { return { version: 1, primitives: [] }; }
}

// The file's bytes, or null when no primitive is left (the file is then removed from the archive).
export function writePrimitiveStore(store) {
  if (!store.primitives.length) return null;
  return new TextEncoder().encode(JSON.stringify({ version: 1, primitives: store.primitives }, null, 1));
}

export const nextPrimitiveId = (store) => store.primitives.reduce((high, p) => Math.max(high, p.id), 0) + 1;

export function primitiveName(entry) {
  return `${PRIMITIVE_SHAPES[entry.spec?.shape] || 'Shape'} ${entry.id}`;
}

// The entry whose model is this course-model polygon.
export function primitiveOfPart(store, modelName, partName) {
  return store.primitives.find((p) => p.model === modelName && p.parts.includes(partName)) || null;
}

// ---- Affine transforms: [r00 r01 r02 tx, r10 r11 r12 ty, r20 r21 r22 tz] ----------------------
export const translation = (t) => [1, 0, 0, t[0], 0, 1, 0, t[1], 0, 0, 1, t[2]];
export const applyMatrix = (m, p) => [
  m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
  m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
  m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
];
function multiply(a, b) {
  const out = new Array(12);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) out[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c];
    out[r * 4 + 3] = a[r * 4] * b[3] + a[r * 4 + 1] * b[7] + a[r * 4 + 2] * b[11] + a[r * 4 + 3];
  }
  return out;
}
// What moving model parts does to a point (transformBRRESPart): center + translation + R(S(p - center)).
export function moveMatrix({ center = [0, 0, 0], translation: t = [0, 0, 0], rotation = [0, 0, 0, 1], scale = [1, 1, 1] }) {
  const [x, y, z, w] = rotation;
  const r = [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
  const m = [];
  for (let row = 0; row < 3; row++) {
    const a = r[row * 3] * scale[0], b = r[row * 3 + 1] * scale[1], c = r[row * 3 + 2] * scale[2];
    m.push(a, b, c, center[row] + t[row] - (a * center[0] + b * center[1] + c * center[2]));
  }
  return m;
}
export const composeMove = (entryMatrix, move) => multiply(moveMatrix(move), entryMatrix);

// ---- Placement --------------------------------------------------------------------------------
export function trianglesBox(tris) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const tri of tris) for (let c = 0; c < 9; c++) {
    const axis = c % 3;
    if (tri[c] < min[axis]) min[axis] = tri[c];
    if (tri[c] > max[axis]) max[axis] = tri[c];
  }
  return { min, max };
}

// World box of course-model polygons, through their bones as the game draws them.
export function partsBox(data, modelName, partNames) {
  const model = parseBRRES(data).models.find((m) => m.name === modelName);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let found = false;
  for (const part of model?.objects || []) {
    if (!partNames.includes(part.name) || !part.triangles) continue;
    for (let i = 0; i < part.positions.length / 3; i++) {
      const rigid = model.boneMatrix.get(part.mtx[i]);
      const w = rigid !== undefined && part.mtx[i] >= 0 ? model.bones[rigid]?.world : null;
      const x = part.positions[i * 3], y = part.positions[i * 3 + 1], z = part.positions[i * 3 + 2];
      const p = w ? [w[0] * x + w[1] * y + w[2] * z + w[3], w[4] * x + w[5] * y + w[6] * z + w[7], w[8] * x + w[9] * y + w[10] * z + w[11]] : [x, y, z];
      for (let a = 0; a < 3; a++) { if (p[a] < min[a]) min[a] = p[a]; if (p[a] > max[a]) max[a] = p[a]; }
      found = true;
    }
  }
  return found ? { min, max } : null;
}

// The bottom centre of a box: where a shape stands.
export const standPoint = (box) => [(box.min[0] + box.max[0]) / 2, box.min[1], (box.min[2] + box.max[2]) / 2];

// The transform that puts the shape's triangles where its model ended up.
export function placementMatrix(tris, modelBox) {
  const own = standPoint(trianglesBox(tris)), there = standPoint(modelBox);
  return translation(there.map((v, i) => v - own[i]));
}

export const placedTriangles = (tris, matrix) => tris.map((tri) => [
  ...applyMatrix(matrix, tri.slice(0, 3)), ...applyMatrix(matrix, tri.slice(3, 6)), ...applyMatrix(matrix, tri.slice(6, 9)),
]);

// The collision triangles of an entry, as they should be in the world now.
export function entryCollision(entry) {
  if (entry.collision === null || entry.collision === undefined || !entry.matrix) return [];
  return placedTriangles(buildPrimitive(primitiveSpec(entry.spec)), entry.matrix);
}

// ---- Finding collision triangles again ---------------------------------------------------------
// The game's collision rebuilds a triangle from a vertex, its normal and its edges, so positions read
// back drift a little from those written: a triangle matches by its corners within `tolerance`.
export function matchTriangles(kcl, tris, options = {}) {
  return matchTrianglePairs(kcl, tris, options).map(([, t]) => t);
}

// [index in tris, index in the collision] of each triangle found.
export function matchTrianglePairs(kcl, tris, { tolerance = 4, flagType = null } = {}) {
  if (!kcl?.count || !tris.length) return [];
  const cell = 32, key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  const byCentre = new Map();
  for (let t = 0; t < kcl.count; t++) {
    if (flagType !== null && (kcl.flags[t] & 0x1f) !== flagType) continue;
    const v = kcl.verts, o = t * 9;
    const k = key((v[o] + v[o + 3] + v[o + 6]) / 3, (v[o + 1] + v[o + 4] + v[o + 7]) / 3, (v[o + 2] + v[o + 5] + v[o + 8]) / 3);
    if (!byCentre.has(k)) byCentre.set(k, []);
    byCentre.get(k).push(t);
  }
  const used = new Set(), found = [];
  const close = (t, tri) => {
    const v = kcl.verts, o = t * 9;
    for (let c = 0; c < 9; c += 3) {
      let near = false;
      for (let d = 0; d < 9 && !near; d += 3) near = Math.hypot(v[o + d] - tri[c], v[o + d + 1] - tri[c + 1], v[o + d + 2] - tri[c + 2]) <= tolerance;
      if (!near) return false;
    }
    return true;
  };
  tris.forEach((tri, index) => {
    const cx = (tri[0] + tri[3] + tri[6]) / 3, cy = (tri[1] + tri[4] + tri[7]) / 3, cz = (tri[2] + tri[5] + tri[8]) / 3;
    const bx = Math.floor(cx / cell), by = Math.floor(cy / cell), bz = Math.floor(cz / cell);
    let hit = -1;
    for (let dx = -1; dx <= 1 && hit < 0; dx++) for (let dy = -1; dy <= 1 && hit < 0; dy++) for (let dz = -1; dz <= 1 && hit < 0; dz++) {
      for (const t of byCentre.get(`${bx + dx},${by + dy},${bz + dz}`) || []) if (!used.has(t) && close(t, tri)) { hit = t; break; }
    }
    if (hit >= 0) { used.add(hit); found.push([index, hit]); }
  });
  return found;
}

// Collision arrays with the found triangles ([index in after, index in the collision]) moved to
// their places in `after`; each keeps its flag (its surface may have been changed since).
export function moveTriangles(kcl, pairs, after) {
  const verts = kcl.verts.slice(0, kcl.count * 9), flags = kcl.flags.slice(0, kcl.count);
  for (const [index, t] of pairs) verts.set(after[index], t * 9);
  return { verts, flags };
}

// Collision arrays without some triangles and with others added (all with `flag`).
export function editTriangles(kcl, remove, add, flag) {
  const count = kcl?.count || 0, drop = new Set(remove), keep = count - drop.size;
  const verts = new Float32Array((keep + add.length) * 9), flags = new Uint16Array(keep + add.length);
  let n = 0;
  for (let t = 0; t < count; t++) {
    if (drop.has(t)) continue;
    verts.set(kcl.verts.subarray(t * 9, t * 9 + 9), n * 9);
    flags[n++] = kcl.flags[t];
  }
  for (const tri of add) { verts.set(tri, n * 9); flags[n++] = flag; }
  return { verts, flags };
}
