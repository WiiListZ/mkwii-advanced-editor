import { roadFrames, sampleSpline, trackSamples } from './trackgen.js';
import { uncoveredStartGrid } from './start-grid.js';
import { shortcutSpan } from './track-branches.js';

// Rounds the curves of a layout already drawn, in plan only: heights, widths and curve radii stay
// on their points. Taubin's two steps do not shrink the track as it smooths. Level 1 to 10.
export function smoothLayout(points, level = 5) {
  const n = points.length;
  if (n < 4) return points;
  const amount = Math.max(1, Math.min(10, level)) / 10, cycles = Math.round(1 + 40 * amount * amount);
  const grow = .6, shrink = 1 / (.01 - 1 / grow);
  let xs = points.map((p) => p.x), zs = points.map((p) => p.z);
  for (let pass = 0; pass < cycles * 2; pass++) {
    const weight = pass % 2 ? shrink : grow;
    const step = (v) => v.map((value, i) => value + ((v[(i + n - 1) % n] + v[(i + 1) % n]) / 2 - value) * weight);
    xs = step(xs); zs = step(zs);
  }
  return points.map((p, i) => ({ ...p, x: xs[i], z: zs[i] }));
}

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
      // Kept even where the new start line cuts across one: the check says so, and nothing is lost.
      ...(params.shortcuts?.length ? { shortcuts: params.shortcuts.map((s) => ({ ...s, from: shift(s.from), to: shift(s.to) })) } : {}),
    },
  };
}

// The twelve karts line up straight behind the start line, so a start on a bend leaves some of
// them off the road; and a shortcut must not skip the start line. This finds the place nearest the
// current start, along the lap either way, where the grid fits outside every shortcut: a road
// point, or else a new point halfway between two. Null if none does.
export function moveStartToFit(points, params) {
  const n = points.length;
  if (n < 3) return null;
  const fits = (candidate) => {
    const { samples, sampleStep } = trackSamples(candidate.points, candidate.params);
    if ((candidate.params.shortcuts || []).some((s) => shortcutSpan(s).crossesStart)) return false;
    return samples.length > 0 && !uncoveredStartGrid(roadFrames(samples, { ...candidate.params, step: sampleStep })).length;
  };
  const curve = sampleSpline(points, 200);
  const placeAt = (parameter) => {
    let best = 0;
    curve.parameters.forEach((t, i) => { if (Math.abs(t - parameter) < Math.abs(curve.parameters[best] - parameter)) best = i; });
    const [x, y, z, w] = curve.samples[best];
    return { x: Math.round(x / 50) * 50, y: Math.round(y), z: Math.round(z / 50) * 50, w: Math.max(.5, Math.min(2.5, w)) };
  };
  const candidates = [];
  for (let i = 1; i < n; i++) candidates.push({ parameter: i, index: i });
  for (let k = 0; k < n; k++) candidates.push({ parameter: k + .5, insertAfter: k });
  candidates.sort((a, b) => Math.min(a.parameter, n - a.parameter) - Math.min(b.parameter, n - b.parameter) || (a.index ? -1 : 1));
  for (const candidate of candidates) {
    let layout = points, index = candidate.index;
    if (candidate.insertAfter !== undefined) {
      layout = [...points.slice(0, candidate.insertAfter + 1), placeAt(candidate.parameter), ...points.slice(candidate.insertAfter + 1)];
      index = candidate.insertAfter + 1;
    }
    const moved = startLayoutAt(layout, params, index);
    if (fits(moved)) return moved;
  }
  return null;
}
