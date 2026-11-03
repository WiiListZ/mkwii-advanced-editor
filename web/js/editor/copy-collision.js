import { appendCollisionTriangles } from './collision.js';

// Clipboard collision is detached from the source KCL, including every surface flag.
export function snapshotCollision(kcl, indices) {
  if (!kcl) return { tris: [], flags: [] };
  const selected = [...new Set(indices)].filter((i) => i >= 0 && i < kcl.count && (!kcl.valid || kcl.valid[i]));
  return { tris: selected.map((i) => [0, 1, 2].map((v) => Array.from(kcl.verts.slice(i * 9 + v * 3, i * 9 + v * 3 + 3)))), flags: selected.map((i) => kcl.flags[i]) };
}

export function appendCopiedCollision(kcl, copies, delta) {
  const tris = [], flags = [], seen = new Set();
  for (const copy of copies.filter(Boolean)) copy.tris.forEach((tri, i) => {
    // A multi-selection can match the same course triangle more than once.
    const key = `${copy.flags[i]}:${tri.flat().join(',')}`;
    if (seen.has(key)) return; seen.add(key);
    tris.push(tri.map((p) => p.map((v, axis) => v + delta[axis]))); flags.push(copy.flags[i]);
  });
  return tris.length ? appendCollisionTriangles(kcl, tris, flags) : kcl;
}
