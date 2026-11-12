// Sculpting a track model's vertices (beta). A vertex array holds positions shared by triangles and
// parts, so moving one moves all of them together and the surface stays closed. Its size and order
// never change, which lets the result go straight back into the file.

import { parseBRRES } from '../formats/brres.js';

const COMP_SIZE = [1, 1, 2, 2, 4];
const LIMITS = [[0, 255], [-128, 127], [0, 65535], [-32768, 32767]];

export function readSculptModel(data) {
  const brres = parseBRRES(data), model = brres.models.find((m) => m.name === 'course') || brres.models[0];
  if (!model) throw new Error('This file has no model');
  const worlds = model.bones.map((bone) => bone.world);
  const identity = (w) => w && [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0].every((v, i) => Math.abs(w[i] - v) < 1e-5);
  const arrays = new Map();
  const corners = [];
  let skipped = 0;
  for (const object of model.objects) {
    const array = model.arrays.pos.get(object.positionArrayId);
    // Parts moved by a bone would need their bone's movement too; only plain ones are sculpted.
    const movable = array && array.comp === 1 && array.fmt <= 4 && [...new Set(object.mtx)].every((id) => {
      const rigid = model.boneMatrix.get(id);
      return id < 0 || rigid === undefined || identity(worlds[rigid]);
    });
    if (!movable) { skipped++; continue; }
    if (!arrays.has(object.positionArrayId)) arrays.set(object.positionArrayId, { id: object.positionArrayId, positions: array.data.slice(), count: array.count });
    for (let c = 0; c < object.positionIds.length; c++) if (object.positionIds[c] >= 0) corners.push(object.positionArrayId, object.positionIds[c]);
  }
  return { model: model.name, arrays, corners: Int32Array.from(corners), skipped };
}

// Vertices of a brush: their weights fall smoothly from the centre to nothing at the radius.
function touched(positions, center, radius, visit, stride = 3) {
  const r2 = radius * radius;
  for (let i = 0; i < positions.length; i += stride) {
    const dx = positions[i] - center[0], dz = positions[i + 2] - center[2], d2 = dx * dx + dz * dz;
    if (d2 >= r2) continue;
    const f = 1 - d2 / r2;
    visit(i, f * f);
  }
}

// One step of a brush on positions: raise, lower, flatten (towards the centre's height) or smooth
// (towards the mean height nearby). Only heights change. Returns how many vertices moved.
export function sculptPositions(positions, center, { mode = 'raise', radius = 1000, strength = 50 } = {}) {
  let moved = 0;
  if (mode === 'smooth') {
    let sum = 0, weight = 0;
    touched(positions, center, radius, (i, w) => { sum += positions[i + 1] * w; weight += w; });
    if (!weight) return 0;
    const mean = sum / weight, amount = Math.min(1, strength / 200);
    touched(positions, center, radius, (i, w) => { positions[i + 1] += (mean - positions[i + 1]) * amount * w; moved++; });
    return moved;
  }
  if (mode === 'flatten') {
    const amount = Math.min(1, strength / 200);
    touched(positions, center, radius, (i, w) => { positions[i + 1] += (center[1] - positions[i + 1]) * amount * w; moved++; });
    return moved;
  }
  const sign = mode === 'lower' ? -1 : 1;
  touched(positions, center, radius, (i, w) => { positions[i + 1] += sign * strength * w; moved++; });
  return moved;
}

// Collision follows only where it is the same surface: a tunnel's floor stays under a raised roof.
export function sculptCollision(verts, center, options, reach = 1500) {
  const near = [];
  const r = options.radius;
  for (let i = 0; i < verts.length; i += 3) {
    if (Math.abs(verts[i + 1] - center[1]) > reach) continue;
    if ((verts[i] - center[0]) ** 2 + (verts[i + 2] - center[2]) ** 2 >= r * r) continue;
    near.push(i);
  }
  if (!near.length) return 0;
  const flat = new Float32Array(near.length * 3);
  near.forEach((at, k) => flat.set([verts[at], verts[at + 1], verts[at + 2]], k * 3));
  const moved = sculptPositions(flat, center, options);
  near.forEach((at, k) => { verts[at + 1] = flat[k * 3 + 1]; });
  return moved;
}

// Writes sculpted positions back into the file, and the bounds the game culls the model with.
export function writeSculptModel(data, sculpt) {
  const parsed = parseBRRES(data), model = parsed.models.find((m) => m.name === sculpt.model);
  const out = data.slice(), view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const low = [...model.min], high = [...model.max];
  for (const [id, { positions }] of sculpt.arrays) {
    const array = model.arrays.pos.get(id), scale = 2 ** array.div, size = COMP_SIZE[array.fmt];
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < array.count; v++) for (let c = 0; c < 3; c++) {
      const value = positions[v * 3 + c], at = array.offset + v * array.stride + c * size;
      if (!Number.isFinite(value)) throw new Error('A sculpted position is not a number');
      let stored = value;
      if (array.fmt === 4) view.setFloat32(at, value);
      else {
        const packed = Math.round(value * scale);
        if (packed < LIMITS[array.fmt][0] || packed > LIMITS[array.fmt][1]) throw new Error('The model moved beyond the range its vertices can hold. Sculpt less far here.');
        if (array.fmt === 0) view.setUint8(at, packed);
        else if (array.fmt === 1) view.setInt8(at, packed);
        else if (array.fmt === 2) view.setUint16(at, packed);
        else view.setInt16(at, packed);
        stored = packed / scale;
      }
      min[c] = Math.min(min[c], stored); max[c] = Math.max(max[c], stored);
    }
    for (let c = 0; c < 3; c++) {
      view.setFloat32(array.headerOffset + 0x20 + c * 4, min[c]);
      view.setFloat32(array.headerOffset + 0x2C + c * 4, max[c]);
      low[c] = Math.min(low[c], min[c]); high[c] = Math.max(high[c], max[c]);
    }
  }
  for (let c = 0; c < 3; c++) {
    view.setFloat32(model.boundsOffset + c * 4, low[c]);
    view.setFloat32(model.boundsOffset + 12 + c * 4, high[c]);
  }
  return out;
}
