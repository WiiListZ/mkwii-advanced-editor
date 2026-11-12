// World units, against the 3200 of a default road: bends much shorter than its width are noise.
const FREEHAND_SMOOTHING = 800;

const distance2 = (p, a, b) => {
  const x = b.x - a.x, z = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * x + (p.z - a.z) * z) / (x * x + z * z || 1)));
  return (p.x - a.x - t * x) ** 2 + (p.z - a.z - t * z) ** 2;
};

// Three moving averages approximate a Gaussian along the closed line.
function smoothClosedLine(line, spacing, sigma) {
  const n = line.length;
  const half = Math.min(Math.floor((n - 1) / 2), Math.round((Math.sqrt(1 + 4 * (sigma / spacing) ** 2) - 1) / 2));
  if (half < 1) return line;
  let current = line;
  for (let pass = 0; pass < 3; pass++) {
    let x = 0, z = 0;
    for (let k = -half; k <= half; k++) { const p = current[(k + n) % n]; x += p.x; z += p.z; }
    const next = [];
    for (let i = 0; i < n; i++) {
      next.push({ x: x / (2 * half + 1), z: z / (2 * half + 1) });
      const out = current[(i - half + n) % n], enter = current[(i + half + 1) % n];
      x += enter.x - out.x; z += enter.z - out.z;
    }
    current = next;
  }
  return current;
}

// Whole-pixel mouse positions and hand tremor wander by a pixel or two. Kept, they become small
// opposite bends inside a curve, sharper than any real turn of a road this wide. A departure from
// the smoothed line within the tolerance is that noise; a larger one is a corner the person drew.
function removeTremor(line, spacing, sigma, tolerance) {
  const smooth = smoothClosedLine(line, spacing, sigma);
  if (smooth === line) return line;
  const low = tolerance * 1.1, high = tolerance * 2.2, n = line.length;
  const out = line.map((p, i) => {
    const s = smooth[i], x = Math.max(0, Math.min(1, (Math.hypot(p.x - s.x, p.z - s.z) - low) / (high - low))), keep = x * x * (3 - 2 * x);
    return { x: s.x + (p.x - s.x) * keep, z: s.z + (p.z - s.z) * keep };
  });
  // The line starts where the person started it: ease the difference away on both sides.
  const dx = line[0].x - out[0].x, dz = line[0].z - out[0].z, reach = Math.min(Math.floor(n / 2), Math.ceil(sigma * 3 / spacing));
  for (let k = -reach; k <= reach; k++) {
    const weight = (1 - (Math.abs(k) / (reach + 1)) ** 2) ** 2, p = out[(k + n) % n];
    p.x += dx * weight; p.z += dz * weight;
  }
  return out;
}

// Fit to the drawn line within a geometric tolerance, rather than retaining
// one point every 9000 world units and discarding small bends. Refine against
// the resulting spline as well as the stroke, so interpolation overshoot and
// corners cut by smoothing are both measured.
export function fitFreehand(stroke, options, sampleSpline) {
  const tolerance = Math.max(1, options.tolerance ?? 150), limit = options.maxPoints ?? 256;
  const clean = [];
  for (const p of stroke) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
    const last = clean[clean.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.z - last.z) > .01) clean.push({ x: p.x, z: p.z });
  }
  if (clean.length < 3) return null;
  let length = 0;
  for (let i = 1; i < clean.length; i++) length += Math.hypot(clean[i].x - clean[i - 1].x, clean[i].z - clean[i - 1].z);
  if (length < 6000) return null;
  if (Math.hypot(clean[0].x - clean.at(-1).x, clean[0].z - clean.at(-1).z) < .01) clean.pop();
  let raw = [];
  const spacing = Math.max(tolerance * 2, length / 4096);
  for (let i = 0; i < clean.length; i++) {
    const a = clean[i], b = clean[(i + 1) % clean.length], count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / spacing));
    for (let k = 0; k < count; k++) raw.push({ x: a.x + (b.x - a.x) * k / count, z: a.z + (b.z - a.z) * k / count });
  }
  raw = removeTremor(raw, spacing, Math.max(FREEHAND_SMOOTHING, tolerance * 3), tolerance);
  raw.push(raw[0]);
  let farthest = 1, farDistance = 0;
  for (let i = 1; i < raw.length - 1; i++) {
    const d = (raw[i].x - raw[0].x) ** 2 + (raw[i].z - raw[0].z) ** 2;
    if (d > farDistance) { farDistance = d; farthest = i; }
  }
  const anchors = new Set([0, farthest]), stack = [[0, farthest], [farthest, raw.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let index = -1, worst = tolerance * tolerance;
    for (let i = a + 1; i < b; i++) {
      const d = distance2(raw[i], raw[a], raw[b]);
      if (d > worst) { worst = d; index = i; }
    }
    if (index >= 0) { anchors.add(index); stack.push([a, index], [index, b]); }
    if (anchors.size > limit) return null;
  }
  for (let pass = 0; pass < 16; pass++) {
    const ids = [...anchors].sort((a, b) => a - b);
    const points = ids.map((i) => ({ ...raw[i], y: 0, w: 1 }));
    const fit = sampleSpline(points, tolerance), pieces = ids.map((id, i) => [{ ...raw[id] }]);
    fit.samples.forEach((s, k) => pieces[Math.min(ids.length - 1, Math.floor(fit.parameters[k]))].push({ x: s[0], z: s[2] }));
    const additions = [];
    for (let i = 0; i < ids.length; i++) {
      const a = ids[i], b = i + 1 < ids.length ? ids[i + 1] : raw.length - 1, line = pieces[i];
      line.push(raw[b]);
      let worst = 0, index = -1;
      for (let k = a + 1; k < b; k++) {
        let d = Infinity;
        for (let j = 0; j < line.length - 1; j++) d = Math.min(d, distance2(raw[k], line[j], line[j + 1]));
        if (d > worst) { worst = d; index = k; }
      }
      let overshoot = 0;
      for (const p of line) {
        let d = Infinity;
        for (let k = a; k < b; k++) d = Math.min(d, distance2(p, raw[k], raw[k + 1]));
        overshoot = Math.max(overshoot, d);
      }
      if ((Math.max(worst, overshoot) > tolerance * tolerance || ids.length < 8) && b - a > 1)
        additions.push(worst >= overshoot && index > a ? index : Math.floor((a + b) / 2));
    }
    if (!additions.length) return points;
    for (const index of additions) anchors.add(index);
    if (anchors.size > limit) return null;
  }
  return null;
}
