// The game's kart grid is straight; the road does not have to be. Keep the
// drawn centreline and provide room for the grid by widening its approaches.
export function startGridPoints(frames, halfWidth = 1400) {
  if (!frames.length) return [];
  const f = frames[0], out = [];
  for (let back = 200; back <= 5700; back += 500) for (const side of [-halfWidth, 0, halfWidth])
    out.push([f.c[0] - f.t[0] * back + f.left[0] * side, f.c[1], f.c[2] - f.t[1] * back + f.left[1] * side]);
  return out;
}

export function startGridWidths(frames, samples) {
  const n = frames.length, widths = frames.map(() => [0, 0]);
  for (const p of startGridPoints(frames)) {
    let best = null;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (!(samples[i][4] > 0 && samples[j][4] > 0)) continue;
      const f = frames[i], g = frames[j], dx = g.c[0] - f.c[0], dz = g.c[2] - f.c[2];
      const a = Math.max(0, Math.min(1, ((p[0] - f.c[0]) * dx + (p[2] - f.c[2]) * dz) / (dx * dx + dz * dz || 1)));
      const x = p[0] - f.c[0] - dx * a, z = p[2] - f.c[2] - dz * a, distance = x * x + z * z;
      if (best && distance >= best.distance) continue;
      const lx = f.left[0] * (1 - a) + g.left[0] * a, lz = f.left[1] * (1 - a) + g.left[1] * a;
      const across = (x * lx + z * lz) / (Math.hypot(lx, lz) || 1);
      best = { i, j, distance, side: across >= 0 ? 0 : 1, need: Math.abs(across) + 200 };
    }
    if (best) for (const i of [best.i, best.j]) widths[i][best.side] = Math.max(widths[i][best.side], best.need);
  }
  // Ease the apron into the ordinary road, without moving any road point.
  for (let k = 0; k < 2 * n; k++) {
    const i = k < n ? k : 2 * n - k - 1, j = (i + (k < n ? 1 : n - 1)) % n;
    const taper = .25 * Math.hypot(frames[i].c[0] - frames[j].c[0], frames[i].c[2] - frames[j].c[2]);
    for (let side = 0; side < 2; side++) widths[j][side] = Math.max(widths[j][side], widths[i][side] - taper);
  }
  return widths;
}

export function uncoveredStartGrid(frames) {
  const inTriangle = (p, a, b, c) => {
    const cross = (u, v, w) => (v[2] - u[2]) * (w[0] - u[0]) - (v[0] - u[0]) * (w[2] - u[2]);
    const area = cross(a, b, c);
    if (area <= 1e-5) return false;
    const wa = cross(p, b, c) / area, wb = cross(p, c, a) / area, wc = 1 - wa - wb;
    return Math.min(wa, wb, wc) >= -1e-5 && Math.abs(wa * a[1] + wb * b[1] + wc * c[1] - p[1]) < .1;
  };
  return startGridPoints(frames, 1200).filter((p) => !frames.some((f, i) => {
    const g = frames[(i + 1) % frames.length];
    return inTriangle(p, f.L, f.R, g.R) || inTriangle(p, f.L, g.R, g.L);
  }));
}
