// The collision as a list, for the Collision tab: its triangles by surface type, then by variant,
// then in pieces (triangles joined by their corners), as the Track tab lists points by section and group.

// { [type]: { count, variants: { [variant]: number[] (triangles) } } }, types and variants in order.
export function collisionGroups(kcl) {
  const out = new Map();
  if (!kcl) return out;
  for (let t = 0; t < kcl.count; t++) {
    if (kcl.valid && !kcl.valid[t]) continue;
    const flag = kcl.flags[t], type = flag & 0x1f, variant = (flag >> 5) & 7;
    let group = out.get(type);
    if (!group) out.set(type, group = { count: 0, variants: new Map() });
    group.count++;
    let tris = group.variants.get(variant);
    if (!tris) group.variants.set(variant, tris = []);
    tris.push(t);
  }
  const sorted = new Map([...out].sort((a, b) => a[0] - b[0]));
  for (const group of sorted.values()) group.variants = new Map([...group.variants].sort((a, b) => a[0] - b[0]));
  return sorted;
}

// The pieces of a set of triangles: those joined by a corner (within `snap` units) are one piece.
// Each piece: { tris, centre: [x, y, z], normal: [x, y, z] (the sum of its faces' normals, by area) },
// the largest first.
export function collisionPieces(kcl, tris, snap = 1) {
  const parent = new Map(), owner = new Map();
  const find = (a) => { while (parent.get(a) !== a) { parent.set(a, parent.get(parent.get(a))); a = parent.get(a); } return a; };
  const v = kcl.verts;
  for (const t of tris) {
    parent.set(t, t);
    for (let k = 0; k < 3; k++) {
      const key = `${Math.round(v[t * 9 + k * 3] / snap)},${Math.round(v[t * 9 + k * 3 + 1] / snap)},${Math.round(v[t * 9 + k * 3 + 2] / snap)}`;
      const other = owner.get(key);
      if (other === undefined) owner.set(key, t);
      else { const a = find(t), b = find(other); if (a !== b) parent.set(a, b); }
    }
  }
  const pieces = new Map();
  for (const t of tris) {
    const root = find(t);
    let piece = pieces.get(root);
    if (!piece) pieces.set(root, piece = { tris: [], centre: [0, 0, 0], normal: [0, 0, 0] });
    piece.tris.push(t);
    const a = [v[t * 9], v[t * 9 + 1], v[t * 9 + 2]];
    const u = [v[t * 9 + 3] - a[0], v[t * 9 + 4] - a[1], v[t * 9 + 5] - a[2]], w = [v[t * 9 + 6] - a[0], v[t * 9 + 7] - a[1], v[t * 9 + 8] - a[2]];
    piece.normal[0] += u[1] * w[2] - u[2] * w[1];
    piece.normal[1] += u[2] * w[0] - u[0] * w[2];
    piece.normal[2] += u[0] * w[1] - u[1] * w[0];
    for (let c = 0; c < 3; c++) piece.centre[c] += (v[t * 9 + c] + v[t * 9 + 3 + c] + v[t * 9 + 6 + c]) / 3;
  }
  const out = [...pieces.values()];
  for (const piece of out) piece.centre = piece.centre.map((x) => x / piece.tris.length);
  return out.sort((a, b) => b.tris.length - a.tris.length);
}
