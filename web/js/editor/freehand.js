const distance2 = (p, a, b) => {
  const x = b.x - a.x, z = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * x + (p.z - a.z) * z) / (x * x + z * z || 1)));
  return (p.x - a.x - t * x) ** 2 + (p.z - a.z - t * z) ** 2;
};

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
  const raw = [], spacing = Math.max(tolerance * 2, length / 4096);
  for (let i = 0; i < clean.length; i++) {
    const a = clean[i], b = clean[(i + 1) % clean.length], count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / spacing));
    for (let k = 0; k < count; k++) raw.push({ x: a.x + (b.x - a.x) * k / count, z: a.z + (b.z - a.z) * k / count });
  }
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
