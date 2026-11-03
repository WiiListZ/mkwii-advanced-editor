// Only intersections of the actual centreline qualify for automatic bridges.
// Nearby hairpins and overlapping grass verges are not crossings.
export function centrelineCrossings(samples, params) {
  const n = samples.length, skip = Math.ceil(params.roadWidth * 2.5 / params.step) + 2, out = [];
  for (let i = 0; i < n; i++) for (let j = i + skip; j < n; j++) {
    if (n - j + i < skip) continue;
    const a = samples[i], b = samples[(i + 1) % n], c = samples[j], d = samples[(j + 1) % n];
    const ax = b[0] - a[0], az = b[2] - a[2], bx = d[0] - c[0], bz = d[2] - c[2];
    const denominator = ax * bz - az * bx;
    if (Math.abs(denominator) < 1e-6) continue;
    const dx = c[0] - a[0], dz = c[2] - a[2], t = (dx * bz - dz * bx) / denominator, u = (dx * az - dz * ax) / denominator;
    if (t < -1e-7 || t > 1 + 1e-7 || u < -1e-7 || u > 1 + 1e-7) continue;
    const sine = Math.abs(denominator) / (Math.hypot(ax, az) * Math.hypot(bx, bz));
    const radius = Math.min(Math.floor(n / 4), Math.ceil((params.roadWidth + params.offroadWidth * 2) / Math.max(.15, sine) / params.step) + 3);
    out.push({ i, j, t, u, radius, pos: [a[0] + ax * t, a[2] + az * t] });
  }
  return out;
}

export function crossingPairs(samples, params, lift, crossings, checkHeight = true) {
  if (!crossings.length) return [];
  const n = samples.length, pairs = [], skip = Math.ceil(params.roadWidth * 2.5 / params.step) + 2;
  const gap = (a, b) => Math.min(Math.abs(a - b), n - Math.abs(a - b));
  const halfAt = (s) => params.roadWidth * s[3] / 2 + params.offroadWidth;
  for (let i = 0; i < n; i++) for (let j = i + skip; j < n; j++) {
    if (n - j + i < skip) continue;
    if (!crossings.some((c) => (gap(i, c.i) <= c.radius && gap(j, c.j) <= c.radius) || (gap(j, c.i) <= c.radius && gap(i, c.j) <= c.radius))) continue;
    const a = samples[i], b = samples[j];
    if (checkHeight && Math.abs(a[1] + lift[i] - b[1] - lift[j]) >= params.wallHeight + 800) continue;
    if (Math.hypot(a[0] - b[0], a[2] - b[2]) < halfAt(a) + halfAt(b)) pairs.push([i, j]);
  }
  return pairs;
}

export function lowCrossings(samples, params, crossings) {
  return crossings.filter((c) => {
    const a = samples[c.i], b = samples[(c.i + 1) % samples.length], d = samples[c.j], e = samples[(c.j + 1) % samples.length];
    return Math.abs(a[1] + (b[1] - a[1]) * c.t - d[1] - (e[1] - d[1]) * c.u) < params.wallHeight + 800 - 1;
  }).map((c) => c.pos);
}
