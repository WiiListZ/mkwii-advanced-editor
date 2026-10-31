import { ShapeUtils, Triangle, Vector2, Vector3 } from 'three';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const triNormal = ([a, b, c]) => cross(sub(b, a), sub(c, a));

// Read the same posed vertices that the 3D viewport draws, including indexed and skinned meshes.
// `transform` places an object model at one KMP instance without changing its shared template.
export function modelCollisionTriangles(root, { vertexIndices = null, transform = null } = {}) {
  root.updateWorldMatrix(true, true);
  const tris = [], seen = new Set();
  const point = new Vector3();
  root.traverse((mesh) => {
    if (!mesh.isMesh || !mesh.visible || (mesh.material && !Array.isArray(mesh.material) && !mesh.material.visible)) return;
    const geometry = mesh.geometry, position = geometry?.getAttribute('position');
    if (!position) return;
    const indices = mesh === root ? vertexIndices : null;
    const index = geometry.getIndex();
    const length = indices?.length ?? index?.count ?? position.count;
    const key = `${geometry.uuid}|${mesh.matrixWorld.elements.join(',')}`;
    if (!indices && seen.has(key)) return;
    seen.add(key);
    // A mirrored placement (negative scale) turns faces inside out; swap two corners to keep normals.
    const mirrored = mesh.matrixWorld.determinant() * (transform ? transform.determinant() : 1) < 0;
    const read = (i) => {
      if (mesh.isSkinnedMesh) mesh.getVertexPosition(i, point);
      else point.fromBufferAttribute(position, i);
      point.applyMatrix4(mesh.matrixWorld);
      if (transform) point.applyMatrix4(transform);
      return point.toArray();
    };
    for (let i = 0; i + 2 < length; i += 3) {
      const ids = [0, 1, 2].map((k) => indices ? indices[i + k] : index ? index.getX(i + k) : i + k);
      if (ids.some((id) => id < 0 || id >= position.count)) continue;
      const tri = ids.map(read);
      if (mirrored) [tri[1], tri[2]] = [tri[2], tri[1]];
      if (tri.flat().every(Number.isFinite) && len(triNormal(tri)) >= 1e-4) tris.push(tri);
    }
  });
  return tris;
}

// Moves triangles by a Matrix4, keeping their normals pointing the same way when it mirrors.
export function transformCollisionTriangles(tris, transform) {
  if (!transform) return tris;
  const mirrored = transform.determinant() < 0, point = new Vector3();
  return tris.map((tri) => {
    const out = tri.map((p) => point.set(p[0], p[1], p[2]).applyMatrix4(transform).toArray());
    return mirrored ? [out[0], out[2], out[1]] : out;
  });
}

// The box around the triangles. With `transform` the box is measured in the model's own space and
// then placed, so a rotated object gets a box turned with it rather than a wider world-aligned one.
export function collisionBoxFromTriangles(tris, transform = null) {
  if (!tris.length) throw new Error('The model has no valid triangles');
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const tri of tris) for (const point of tri) for (let a = 0; a < 3; a++) {
    min[a] = Math.min(min[a], point[a]); max[a] = Math.max(max[a], point[a]);
  }
  const box = buildCollisionShape('box', [min, [Math.max(min[0] + 1, max[0]), min[1], Math.max(min[2] + 1, max[2])]], { height: Math.max(1, max[1] - min[1]) });
  return transformCollisionTriangles(box, transform);
}

// Fewer, larger triangles with the same outline (vertex clustering): corners closer than one grid
// cell merge into their average, and triangles that collapse or repeat are dropped. The grid grows
// until the result fits in `target` triangles.
export function simplifyCollisionTriangles(tris, target) {
  if (tris.length <= target) return tris;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const tri of tris) for (const p of tri) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], p[a]); max[a] = Math.max(max[a], p[a]); }
  const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 1);
  const cluster = (cell) => {
    // Cells per axis stay under 2^17 (cell >= extent / 4096), so one number identifies a cell.
    const id = (p) => (Math.floor((p[0] - min[0]) / cell) * 131072 + Math.floor((p[1] - min[1]) / cell)) * 131072 + Math.floor((p[2] - min[2]) / cell);
    const sums = new Map();
    for (const tri of tris) for (const p of tri) {
      const k = id(p), s = sums.get(k);
      if (s) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++; } else sums.set(k, [p[0], p[1], p[2], 1]);
    }
    const at = (k) => { const s = sums.get(k); return [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; };
    const out = [], seen = new Set();
    for (const tri of tris) {
      const ks = tri.map(id);
      if (ks[0] === ks[1] || ks[1] === ks[2] || ks[0] === ks[2]) continue;
      // Same corners in the same turning order is the same face; the opposite order is its back.
      const r = ks.indexOf(Math.min(...ks)), key = `${ks[r]}|${ks[(r + 1) % 3]}|${ks[(r + 2) % 3]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const next = ks.map(at);
      if (len(triNormal(next)) >= 1e-3) out.push(next);
    }
    return out;
  };
  // Search the cell size between "nothing merges" and "the whole model is one cell".
  let lo = extent / 4096, hi = extent, best = null;
  for (let i = 0; i < 18; i++) {
    const cell = Math.sqrt(lo * hi), out = cluster(cell);
    if (out.length <= target) { best = out; hi = cell; } else lo = cell;
    if (best && hi / lo < 1.05) break;
  }
  return best && best.length ? best : collisionBoxFromTriangles(tris);
}

// Squared distance from point p to triangle abc (closest point by region, Ericson 5.1.5).
function pointTriangleDistanceSq(p, a, b, c) {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  const dist = (q) => { const d = sub(p, q); return dot(d, d); };
  if (d1 <= 0 && d2 <= 0) return dist(a);
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return dist(b);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return dist(add(a, scale(ab, d1 / (d1 - d3))));
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return dist(c);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return dist(add(a, scale(ac, d2 / (d2 - d6))));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return dist(add(b, scale(sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6)))));
  const denom = 1 / (va + vb + vc);
  return dist(add(a, add(scale(ab, vb * denom), scale(ac, vc * denom))));
}

// Marks which triangles already lie on existing course collision: all three corners and the middle
// are within `tolerance` of some KCL triangle. Lets generation fill only the parts that have none.
export function collisionCoverage(tris, kcl, tolerance = 50) {
  const covered = new Array(tris.length).fill(false);
  if (!kcl?.count || !tris.length) return covered;
  const cell = Math.max(tolerance * 8, 400), cells = new Map();
  const key = (x, y, z) => `${x},${y},${z}`;
  const v = kcl.verts;
  for (let t = 0; t < kcl.count; t++) {
    const o = t * 9;
    if (kcl.valid && !kcl.valid[t]) continue;
    const lo = [0, 1, 2].map((a) => Math.floor((Math.min(v[o + a], v[o + 3 + a], v[o + 6 + a]) - tolerance) / cell));
    const hi = [0, 1, 2].map((a) => Math.floor((Math.max(v[o + a], v[o + 3 + a], v[o + 6 + a]) + tolerance) / cell));
    if ((hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1) > 20000) continue; // broken, huge triangle
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
      const k = key(x, y, z), list = cells.get(k);
      if (list) list.push(t); else cells.set(k, [t]);
    }
  }
  const tol2 = tolerance * tolerance;
  const near = (p) => {
    const list = cells.get(key(Math.floor(p[0] / cell), Math.floor(p[1] / cell), Math.floor(p[2] / cell)));
    if (!list) return false;
    for (const t of list) {
      const o = t * 9;
      if (pointTriangleDistanceSq(p, [v[o], v[o + 1], v[o + 2]], [v[o + 3], v[o + 4], v[o + 5]], [v[o + 6], v[o + 7], v[o + 8]]) <= tol2) return true;
    }
    return false;
  };
  tris.forEach((tri, i) => {
    const middle = scale(add(add(tri[0], tri[1]), tri[2]), 1 / 3);
    covered[i] = near(middle) && tri.every(near);
  });
  return covered;
}

// Steep faces become walls so karts bounce off them instead of driving up them.
export const FLOOR_MIN_NORMAL_Y = 0.5; // about 60° from flat
export function isFloorTriangle(tri) {
  const n = triNormal(tri), l = len(n);
  return l > 0 && n[1] / l >= FLOOR_MIN_NORMAL_Y;
}

// Append a triangle to editable KCL geometry. The game uses triangle winding for its normal.
export function appendCollisionTriangle(kcl, points, flag) {
  if (points.length !== 3 || points.some((p) => p.length !== 3 || p.some((n) => !Number.isFinite(n)))) {
    throw new Error('Choose three valid points for the collision triangle');
  }
  const [a, b, c] = points;
  const normal = triNormal(points);
  if (len(normal) < 1e-4) throw new Error('The three points must form a triangle, not a line');
  // For floor-like surfaces, orient the normal upward regardless of click order.
  const ordered = normal[1] < 0 && Math.abs(normal[1]) > Math.max(Math.abs(normal[0]), Math.abs(normal[2])) ? [a, c, b] : [a, b, c];
  return appendCollisionTriangles(kcl, [ordered], flag);
}

// Triangle lists in the KCL octree are u16 indices (0 ends a list), so the format holds 65,534.
export const KCL_MAX_TRIANGLES = 0xFFFE;
const roomError = (count, adding) => new Error(`The KCL format holds ${KCL_MAX_TRIANGLES.toLocaleString()} triangles; the course has ${count.toLocaleString()} and ${adding.toLocaleString()} more do not fit`);

// Appends many triangles ([[a, b, c], …], already wound) with the same flag, or one flag each.
export function appendCollisionTriangles(kcl, tris, flag) {
  const count = kcl?.count ?? 0;
  if (!tris.length) throw new Error('This shape has no triangles');
  if (count + tris.length > KCL_MAX_TRIANGLES) throw roomError(count, tris.length);
  if (Array.isArray(flag) && flag.length !== tris.length) throw new Error('Each triangle needs a flag');
  const verts = new Float32Array((count + tris.length) * 9);
  if (kcl) verts.set(kcl.verts);
  tris.forEach((tri, i) => verts.set(tri.flat(), (count + i) * 9));
  const flags = new Uint16Array(count + tris.length);
  if (kcl) flags.set(kcl.flags);
  if (Array.isArray(flag)) flag.forEach((f, i) => { flags[count + i] = f & 0xFFFF; });
  else flags.fill(flag & 0xFFFF, count);
  return { ...(kcl || {}), verts, flags, valid: null, count: count + tris.length };
}

// ---- Shapes ---------------------------------------------------------------------------------
// Shapes drawn with clicks on the track, turned into collision triangles. `points` are the clicks.
export const COLLISION_SHAPES = {
  triangle: { label: 'Triangle', points: 3, help: 'Three corners.' },
  rectangle: { label: 'Rectangle', points: 3, help: 'Two corners of one side, then a point for the width (works on slopes: ramps, floors).' },
  wall: { label: 'Wall', points: 2, help: 'Two points on the ground; it rises by the height.' },
  box: { label: 'Box', points: 2, help: 'Two opposite corners on the ground; it rises by the height.' },
  cylinder: { label: 'Cylinder', points: 2, help: 'Centre, then a point on the edge; it rises by the height.' },
  sphere: { label: 'Sphere', points: 2, help: 'Centre, then a point on the surface.' },
  polygon: { label: 'Polygon', points: Infinity, help: 'Any number of corners. Enter, or a click on the first point, closes it.' },
};

// Triangles of a shape. Open surfaces face the camera (`eye`), closed solids face outwards.
export function buildCollisionShape(kind, points, { height = 1000, segments = 16, eye = null } = {}) {
  const up = [0, height, 0];
  let tris = [], closed = false, center = null;
  const quad = (a, b, c, d) => { tris.push([a, b, c], [a, c, d]); };
  if (kind === 'triangle') {
    tris = [points.slice(0, 3)];
  } else if (kind === 'rectangle') {
    const [a, b, c] = points;
    const e = sub(b, a), el = dot(e, e);
    if (el < 1e-6) throw new Error('The first two corners are in the same place');
    const ac = sub(c, a);
    const d = sub(ac, scale(e, dot(ac, e) / el)); // part of the third click across the first side
    quad(a, b, add(b, d), add(a, d));
  } else if (kind === 'wall') {
    const [a, b] = points;
    quad(a, b, add(b, up), add(a, up));
  } else if (kind === 'box') {
    const [a, c] = points;
    const y0 = Math.min(a[1], c[1]), y1 = y0 + height;
    const [x0, x1] = [Math.min(a[0], c[0]), Math.max(a[0], c[0])], [z0, z1] = [Math.min(a[2], c[2]), Math.max(a[2], c[2])];
    if (x1 - x0 < 1e-3 || z1 - z0 < 1e-3) throw new Error('The box needs a width and a depth');
    const p = (x, y, z) => [x, y, z];
    const b = [p(x0, y0, z0), p(x1, y0, z0), p(x1, y0, z1), p(x0, y0, z1)], t = b.map(([x, , z]) => p(x, y1, z));
    quad(b[0], b[1], b[2], b[3]);
    quad(t[0], t[1], t[2], t[3]);
    for (let i = 0; i < 4; i++) quad(b[i], b[(i + 1) % 4], t[(i + 1) % 4], t[i]);
    closed = true;
    center = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
  } else if (kind === 'cylinder') {
    const [c, edge] = points;
    const r = Math.hypot(edge[0] - c[0], edge[2] - c[2]);
    if (r < 1e-3) throw new Error('The cylinder needs a radius');
    const n = Math.max(3, Math.round(segments));
    const ring = (y) => Array.from({ length: n }, (_, i) => [c[0] + Math.cos(i / n * Math.PI * 2) * r, y, c[2] + Math.sin(i / n * Math.PI * 2) * r]);
    const bottom = ring(c[1]), top = ring(c[1] + height), cb = c, ct = add(c, up);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      quad(bottom[i], bottom[j], top[j], top[i]);
      tris.push([cb, bottom[j], bottom[i]], [ct, top[i], top[j]]);
    }
    closed = true;
    center = add(c, scale(up, 0.5));
  } else if (kind === 'sphere') {
    const [c, edge] = points;
    const r = len(sub(edge, c));
    if (r < 1e-3) throw new Error('The sphere needs a radius');
    const lon = Math.max(4, Math.round(segments)), lat = Math.max(2, Math.round(segments / 2));
    const at = (i, j) => {
      const theta = (j / lat) * Math.PI, phi = (i / lon) * Math.PI * 2;
      return [c[0] + r * Math.sin(theta) * Math.cos(phi), c[1] + r * Math.cos(theta), c[2] + r * Math.sin(theta) * Math.sin(phi)];
    };
    for (let j = 0; j < lat; j++) for (let i = 0; i < lon; i++) {
      const a = at(i, j), b = at(i + 1, j), d = at(i, j + 1), e = at(i + 1, j + 1);
      if (j > 0) tris.push([a, b, e]);
      if (j < lat - 1) tris.push([a, e, d]);
    }
    closed = true;
    center = c;
  } else if (kind === 'polygon') {
    if (points.length < 3) throw new Error('A polygon needs at least three corners');
    // Newell normal of the outline, then triangulate it flattened on that plane.
    let normal = [0, 0, 0];
    points.forEach((p, i) => {
      const q = points[(i + 1) % points.length];
      normal = add(normal, [(p[1] - q[1]) * (p[2] + q[2]), (p[2] - q[2]) * (p[0] + q[0]), (p[0] - q[0]) * (p[1] + q[1])]);
    });
    if (len(normal) < 1e-6) throw new Error('The polygon corners are all on one line');
    normal = scale(normal, 1 / len(normal));
    const helper = Math.abs(normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = cross(helper, normal), v = cross(normal, u);
    const flat = points.map((p) => new Vector2(dot(p, u), dot(p, v)));
    const faces = ShapeUtils.triangulateShape(flat, []);
    if (!faces.length) throw new Error('This polygon could not be split into triangles');
    tris = faces.map(([a, b, c]) => [points[a], points[b], points[c]]);
  } else throw new Error(`Unknown shape ${kind}`);

  // Drop degenerate triangles (zero radius rows, repeated clicks), then orient every face.
  tris = tris.filter((t) => len(triNormal(t)) > 1e-4);
  if (!tris.length) throw new Error('The points must not all be in the same place or on one line');
  const centroid = (t) => scale(add(add(t[0], t[1]), t[2]), 1 / 3);
  return tris.map((t) => {
    const n = triNormal(t);
    const toward = closed ? sub(centroid(t), center) : eye ? sub(eye, centroid(t)) : [0, 1, 0];
    return dot(n, toward) < 0 ? [t[0], t[2], t[1]] : t;
  });
}

export function duplicateCollisionTriangles(kcl, selected, offsetY = 100) {
  const tris = [...new Set(selected)].filter((tri) => tri >= 0 && tri < kcl.count);
  if (kcl.count + tris.length > KCL_MAX_TRIANGLES) throw roomError(kcl.count, tris.length);
  const verts = new Float32Array((kcl.count + tris.length) * 9), flags = new Uint16Array(kcl.count + tris.length);
  verts.set(kcl.verts); flags.set(kcl.flags);
  tris.forEach((tri, i) => {
    for (let k = 0; k < 9; k++) verts[(kcl.count + i) * 9 + k] = kcl.verts[tri * 9 + k] + (k % 3 === 1 ? offsetY : 0);
    flags[kcl.count + i] = kcl.flags[tri];
  });
  return { ...kcl, verts, flags, count: kcl.count + tris.length, valid: null };
}

// Course collision made from an object's model by Generate collision, found again from the model
// placed where the object is (\`placed\`: its triangles in course space). A KCL triangle belongs to it
// when all its corners lie inside the model's bounds and on its surface (within \`tolerance\`), facing
// the same way as the model there — model surfaces and their simplified version — or when its
// corners are corners of the model's collision box (\`box\` triangles). Road and walls under or around
// the object have corners outside its bounds, or face another way, and are left alone.
export function collisionOfModel(kcl, placed, box = [], tolerance = 20) {
  if (!kcl?.count || !placed.length) return [];
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const tri of [...placed, ...box]) for (const p of tri) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], p[a]); max[a] = Math.max(max[a], p[a]); }
  const inside = (x, y, z) => x >= min[0] - tolerance && x <= max[0] + tolerance && y >= min[1] - tolerance && y <= max[1] + tolerance && z >= min[2] - tolerance && z <= max[2] + tolerance;
  const model = placed.map((tri) => {
    const [a, b, c] = tri.map((p) => new Vector3(...p));
    const n = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
    return { a, b, c, n: n.lengthSq() > 0 ? n.normalize() : n, lo: [0, 1, 2].map((k) => Math.min(a.getComponent(k), b.getComponent(k), c.getComponent(k)) - tolerance), hi: [0, 1, 2].map((k) => Math.max(a.getComponent(k), b.getComponent(k), c.getComponent(k)) + tolerance) };
  });
  const corners = box.flat().map((p) => new Vector3(...p));
  const closest = new Vector3(), point = new Vector3(), triangle = new Triangle();
  const out = [];
  const v = kcl.verts;
  for (let t = 0; t < kcl.count; t++) {
    const pts = [0, 1, 2].map((k) => [v[t * 9 + k * 3], v[t * 9 + k * 3 + 1], v[t * 9 + k * 3 + 2]]);
    if (!pts.every((p) => inside(p[0], p[1], p[2]))) continue;
    if (corners.length && pts.every((p) => corners.some((c) => c.distanceTo(point.set(p[0], p[1], p[2])) <= tolerance))) { out.push(t); continue; }
    const [a, b, c] = pts.map((p) => new Vector3(...p));
    const normal = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
    if (normal.lengthSq() === 0) continue;
    normal.normalize();
    const onSurface = pts.every((p) => {
      point.set(p[0], p[1], p[2]);
      return model.some((m) => {
        if (p[0] < m.lo[0] || p[0] > m.hi[0] || p[1] < m.lo[1] || p[1] > m.hi[1] || p[2] < m.lo[2] || p[2] > m.hi[2]) return false;
        triangle.set(m.a, m.b, m.c).closestPointToPoint(point, closest);
        return closest.distanceTo(point) <= tolerance && m.n.dot(normal) > -0.3;
      });
    });
    if (onSurface) out.push(t);
  }
  return out;
}

export function deleteCollisionTriangles(kcl, selected) {
  const removed = new Set(selected.filter((tri) => tri >= 0 && tri < kcl.count));
  if (removed.size >= kcl.count) throw new Error('A KCL needs at least one collision triangle');
  const count = kcl.count - removed.size, verts = new Float32Array(count * 9), flags = new Uint16Array(count);
  let next = 0;
  for (let tri = 0; tri < kcl.count; tri++) {
    if (removed.has(tri)) continue;
    verts.set(kcl.verts.subarray(tri * 9, tri * 9 + 9), next * 9);
    flags[next++] = kcl.flags[tri];
  }
  return { ...kcl, verts, flags, count, valid: null };
}

export function flipCollisionTriangles(kcl, selected) {
  const verts = kcl.verts.slice();
  for (const tri of selected) {
    if (tri < 0 || tri >= kcl.count) continue;
    const start = tri * 9;
    for (let axis = 0; axis < 3; axis++) [verts[start + 3 + axis], verts[start + 6 + axis]] = [verts[start + 6 + axis], verts[start + 3 + axis]];
  }
  return { ...kcl, verts, valid: null };
}
