import { sampleSpline } from './trackgen.js';

export function layoutBounds(points) {
  if (!points.length) return { cx: 0, cz: 0, width: 0, depth: 0 };
  const xs = points.map((p) => p.x), zs = points.map((p) => p.z);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  return { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, width: maxX - minX, depth: maxZ - minZ };
}

// Resize the plan in world units. Road widths, point heights and placements
// along the lap remain independent of the overall map dimensions.
export function resizeLayout(points, width, depth) {
  const bounds = layoutBounds(points);
  if (![width, depth].every((n) => Number.isFinite(n) && n > 0) || bounds.width <= 0 || bounds.depth <= 0)
    throw new Error('The layout needs a positive width and depth');
  return points.map((p) => ({ ...p,
    x: bounds.cx + (p.x - bounds.cx) * width / bounds.width,
    z: bounds.cz + (p.z - bounds.cz) * depth / bounds.depth,
  }));
}

// Hit the curve the person actually sees, including the closing segment.
// A chord between control points can be far away or belong to another bend.
export function nearestLayoutSegment(points, x, z) {
  const curve = sampleSpline(points, 200), count = curve.samples.length;
  if (!count) return null;
  let best = null;
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count, a = curve.samples[i], b = curve.samples[j];
    const dx = b[0] - a[0], dz = b[2] - a[2];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / (dx * dx + dz * dz || 1)));
    const px = a[0] + dx * t, pz = a[2] + dz * t, distance = Math.hypot(px - x, pz - z);
    if (best && best.distance <= distance) continue;
    const parameter = curve.parameters[i] * (1 - t) + (j ? curve.parameters[j] : points.length) * t;
    const segment = Math.min(points.length - 1, Math.floor(parameter));
    best = { segment, fraction: parameter - segment, distance, at: [px, pz], height: a[1] + (b[1] - a[1]) * t, width: a[3] + (b[3] - a[3]) * t };
  }
  return best;
}

// Move the lap origin explicitly, retaining manually placed boxes/panels.
export function startLayoutAt(points, params, index) {
  if (!Number.isInteger(index) || index < 0 || index >= points.length) throw new Error('Invalid start point');
  const curve = sampleSpline(points, params.step || 400);
  let fraction = 0;
  if (index) {
    const at = curve.parameters.findIndex((t) => t >= index);
    const i = at < 0 ? curve.parameters.length : at;
    const before = curve.parameters[i - 1], after = i === curve.parameters.length ? points.length : curve.parameters[i];
    fraction = (i - 1 + (index - before) / (after - before)) / curve.samples.length;
  }
  const shift = (t) => ((t - fraction) % 1 + 1) % 1;
  return {
    points: [...points.slice(index), ...points.slice(0, index)].map((p) => ({ ...p })),
    params: { ...params,
      ...(params.boostPositions ? { boostPositions: params.boostPositions.map(shift) } : {}),
      ...(params.itemBoxPositions ? { itemBoxPositions: params.itemBoxPositions.map((p) => ({ ...p, t: shift(p.t) })) } : {}),
    },
  };
}
