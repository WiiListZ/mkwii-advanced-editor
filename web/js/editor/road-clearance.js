// Limit each side to its share of the space between nearby road sections.
// Curvature alone cannot catch an S-bend's inner wall meeting its approach.
// The bisector between centreline samples bounds the offset; a small margin
// leaves room for the wall instead of putting both edges on the same seam.
export function limitRoadClearance(frames, widths, params) {
  if (!frames.length) return;
  const reach = Math.max(...widths.flat()) * 2.1, cell = Math.max(1, reach), buckets = new Map();
  for (let i = 0; i < frames.length; i++) {
    const p = frames[i].c, key = `${Math.floor(p[0] / cell)},${Math.floor(p[2] / cell)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(i);
  }
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i], x = Math.floor(f.c[0] / cell), z = Math.floor(f.c[2] / cell);
    for (let bx = x - 1; bx <= x + 1; bx++) for (let bz = z - 1; bz <= z + 1; bz++) {
      for (const j of buckets.get(`${bx},${bz}`) || []) {
        if (j <= i) continue;
        const g = frames[j];
        // A separated bridge is a different road level, not a nearby wall.
        if (Math.abs(g.c[1] - f.c[1]) >= params.wallHeight + 800) continue;
        const dx = g.c[0] - f.c[0], dz = g.c[2] - f.c[2], d2 = dx * dx + dz * dz;
        if (d2 < 1 || d2 > reach * reach) continue;
        const acrossF = dx * f.left[0] + dz * f.left[1], acrossG = -dx * g.left[0] - dz * g.left[1];
        for (const [index, across] of [[i, acrossF], [j, acrossG]]) if (Math.abs(across) > 1e-6) {
          const side = across > 0 ? 0 : 1;
          widths[index][side] = Math.min(widths[index][side], .46 * d2 / Math.abs(across));
        }
      }
    }
  }
}
