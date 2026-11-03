// Track generator: turns a closed spline of control points into a drivable track
// (collision triangles, visual model, and a complete KMP with routes, checkpoints and respawns).

import { emptyKMP, make } from '../formats/kmp.js';
import { trackMaterials } from './track-styles.js';
import { smoothRoadGrades } from './road-grades.js';
import { startGridWidths, uncoveredStartGrid } from './start-grid.js';
import { fitFreehand } from './freehand.js';
import { centrelineCrossings, crossingPairs, lowCrossings } from './road-crossings.js';
import { curveCorner, roundedSegmentXZ } from './curve-radius.js';
import { limitRoadClearance } from './road-clearance.js';
import { smoothRoadWidths } from './road-widths.js';

// MKW forces a respawn whenever the kart's world Y is below zero, regardless
// of KCL. Generator heights are relative to this safe world-space baseline.
export const TRACK_BASE_HEIGHT = 10000;
// Keep large hand-drawn layouts within a manageable mesh and the KCL triangle
// budget. Control points are retained; only the spacing of generated samples grows.
export const MAX_TRACK_SAMPLES = 4096;

export const DEFAULT_PARAMS = {
  style: 'circuit',
  textureSource: 'game',
  roadWidth: 3200,
  offroadWidth: 1400,
  wallHeight: 700,
  step: 400,            // distance between samples along the centerline
  checkpointSpacing: 1600,
  enemySpacing: 1200,
  respawnEvery: 3,      // one respawn every N checkpoints
  keyCheckpoints: 3,
  itemRows: 2,
  boostPads: 1,
  boostLength: 1200,
  laps: 3,
  walls: true,
  autoBridges: false,
  trickable: true,
  fallDepth: 4000,
};

// Ready-made shapes (control points in world units; y = height).
export const PRESETS = {
  // A racing oval: the grid belongs in the middle of a long straight,
  // rather than on the tight end of an ellipse.
  Oval: () => {
    const r = 13000, cx = 9000, q = r / Math.sqrt(2);
    return [[0, -r], [cx, -r], [cx + q, -q], [cx + r, 0], [cx + q, q], [cx, r],
      [0, r], [-cx, r], [-cx - q, q], [-cx - r, 0], [-cx - q, -q], [-cx, -r]]
      .map(([x, z]) => ({ x, y: 0, z }));
  },
  'Figure eight': () => {
    const pts = [];
    for (let i = 0; i < 16; i++) {
      const t = (i / 16) * Math.PI * 2;
      pts.push({ x: Math.sin(t) * 24000, y: 0, z: Math.sin(t) * Math.cos(t) * 26000 });
    }
    // The branch crossing at t = 0 goes over a bridge; the one at t = PI stays on the ground.
    pts[0].y = 2400; pts[1].y = 2000; pts[15].y = 2000; pts[2].y = 1000; pts[14].y = 1000;
    return pts;
  },
  Kidney: () => ring(10, 20000, 14000, () => 0, (t) => 1 - 0.35 * Math.max(0, Math.cos(t)) ** 2),
  Hilly: () => ring(12, 24000, 18000, (t) => 1500 + Math.sin(t * 3) * 1500),
  Random: () => ring(10, 22000, 18000, () => Math.round(Math.random() * 6) * 300, () => 0.7 + Math.random() * 0.45),
};

function ring(n, rx, rz, height, radius = () => 1) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const r = radius(t);
    pts.push({ x: Math.cos(t) * rx * r, y: height(t), z: Math.sin(t) * rz * r });
  }
  return pts;
}

// Centripetal Catmull-Rom avoids loops and cusps between unevenly spaced
// control points (common when drawing by hand), then resamples by distance.
export function sampleSpline(points, step, maxSamples = 32768) {
  const n = points.length;
  if (n < 3) return { samples: [], length: 0 };
  const P = (i) => points[(i + n) % n];
  const dense = [], denseParameters = [], corners = points.map((_, i) => curveCorner(points, i));
  for (let i = 0; i < n; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const interval = (a, b) => Math.max(.001, Math.sqrt(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)));
    const d0 = interval(p0, p1), d1 = interval(p1, p2), d2 = interval(p2, p3);
    const a = corners[i], b = corners[(i + 1) % n];
    const marks = Array.from({ length: 40 }, (_, s) => s / 40);
    // Keep small requested arcs round as well as long ones. Include both joins
    // explicitly rather than letting uniform subdivisions cut across them.
    if (a) for (let s = 1; s <= 32; s++) marks.push(a.after * s / 32);
    if (b) for (let s = 0; s < 32; s++) marks.push(1 - b.before + b.before * s / 32);
    marks.sort((x, y) => x - y);
    const tangent = (a, b, c, d) => [
      ((b - a) / d0 - (c - a) / (d0 + d1) + (c - b) / d1) * d1,
      ((c - b) / d1 - (d - b) / (d1 + d2) + (d - c) / d2) * d1,
    ];
    const tx = tangent(p0.x, p1.x, p2.x, p3.x), tz = tangent(p0.z, p1.z, p2.z, p3.z);
    for (const t of new Set(marks)) {
      const t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => {
        const m1 = ((b - a) / d0 - (c - a) / (d0 + d1) + (c - b) / d1) * d1;
        const m2 = ((c - b) / d1 - (d - b) / (d1 + d2) + (d - c) / d2) * d1;
        return (2 * t3 - 3 * t2 + 1) * b + (-2 * t3 + 3 * t2) * c + (t3 - 2 * t2 + t) * m1 + (t3 - t2) * m2;
      };
      const s = [f(p0.x, p1.x, p2.x, p3.x), f(p0.y, p1.y, p2.y, p3.y), f(p0.z, p1.z, p2.z, p3.z),
        f(p0.w ?? 1, p1.w ?? 1, p2.w ?? 1, p3.w ?? 1)];
      if (a || b) { const xz = roundedSegmentXZ(p1, p2, [[tx[0], tz[0]], [tx[1], tz[1]]], a, b, t); s[0] = xz[0]; s[2] = xz[1]; }
      dense.push(s); denseParameters.push(i + t);
    }
  }
  dense.push(dense[0]);
  denseParameters.push(n);
  let total = 0;
  const cum = [0];
  for (let i = 1; i < dense.length; i++) {
    total += Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1], dense[i][2] - dense[i - 1][2]);
    cum.push(total);
  }
  const count = Math.min(maxSamples, Math.max(8, Math.round(total / step)));
  const out = [], parameters = [];
  let j = 1;
  for (let i = 0; i < count; i++) {
    const d = (i / count) * total;
    while (cum[j] < d) j++;
    const t = (d - cum[j - 1]) / (cum[j] - cum[j - 1] || 1);
    const a = dense[j - 1], b = dense[j];
    out.push([0, 1, 2, 3].map((k) => a[k] + (b[k] - a[k]) * t));
    parameters.push(denseParameters[j - 1] + (denseParameters[j] - denseParameters[j - 1]) * t);
  }
  return { samples: out, length: total, parameters };
}

// The UI supplies a tolerance in world units corresponding to two screen pixels.
export function pointsFromStroke(stroke, options = {}) {
  return fitFreehand(stroke, options, sampleSpline);
}

// Same layout driven the other way round (the start point stays first).
export function reverseLayout(points) {
  return [points[0], ...points.slice(1).reverse()].map((p) => ({ ...p }));
}

// Layout grown or shrunk around its centre (heights are kept).
export function scaleLayout(points, factor) {
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length, cz = points.reduce((s, p) => s + p.z, 0) / points.length;
  return points.map((p) => ({ ...p, x: Math.round((cx + (p.x - cx) * factor) / 50) * 50, z: Math.round((cz + (p.z - cz) * factor) / 50) * 50 }));
}

// The centreline the track is built on: the spline of the control points, made drivable.
// - Slopes steeper than karts can climb are spread out (MAX_SLOPE).
// - Where the road runs into itself at nearly the same height, one branch is lifted into a bridge
//   high enough to drive under, with gentle ramps (the branch that is already higher, or else the
//   later one in the lap).
// Returns { samples, length, bridges: [[x, z]], flattened: [[x, z]] }.
const MAX_SLOPE = 0.4, RAMP_SLOPE = 0.22;
const sampleCache = new Map();
const copySamples = (result) => ({ ...result, samples: result.samples.map((s) => [...s]), bridges: result.bridges.map((p) => [...p]), crossings: result.crossings.map((p) => [...p]), flattened: result.flattened.map((p) => [...p]) });

// VS races place twelve karts in a straight 2000 × 5300 area behind KTPT,
// all at the same height. Flatten the height and reserve width without
// forcing the person's drawn curve into a different horizontal shape.
function prepareStartGrid(samples, P) {
  const n = samples.length, origin = [...samples[0]];
  const distance = [0];
  for (let i = 1; i <= n; i++) {
    const a = samples[i - 1], b = samples[i % n];
    distance.push(distance[i - 1] + Math.hypot(b[0] - a[0], b[2] - a[2]));
  }
  const length = distance[n];
  const signedDistance = (i) => distance[i] <= length / 2 ? distance[i] : distance[i] - length;
  const blend = Math.min(3500, Math.max(400, (length - 11500) / 2));
  const guard = [];
  for (let i = 0; i < n; i++) {
    const d = signedDistance(i);
    const outside = Math.max(0, -9500 - d, d - 2000);
    const weight = outside >= blend ? 0 : (1 + Math.cos(Math.PI * outside / blend)) / 2;
    const s = samples[i];
    s[1] += (origin[1] - s[1]) * weight;
    s[3] = Math.max(s[3], 1 + (3200 / P.roadWidth - 1) * weight);
    // Mark the flat part used by the actual grid and its width transition.
    // X/Z remain exactly as drawn; roadFrames provides room for the karts.
    const gridOutside = Math.max(0, -6200 - d, d - 200);
    s[4] = gridOutside >= 1700 ? 0 : (1 + Math.cos(Math.PI * gridOutside / 1700)) / 2;
    guard.push(1 - weight);
  }
  return guard;
}

export function trackSamples(points, params = {}) {
  const P = { ...DEFAULT_PARAMS, ...params };
  // Drawing, 3D/model building and layout checks share the same geometry.
  // Item/texture edits must not repeat the vertical constraint solver.
  const cacheKey = JSON.stringify([points, P.roadWidth, P.offroadWidth, P.wallHeight, P.step, P.autoBridges]);
  if (sampleCache.has(cacheKey)) return copySamples(sampleCache.get(cacheKey));
  const { samples: raw, length } = sampleSpline(points, P.step, MAX_TRACK_SAMPLES);
  const n = raw.length;
  const sampleStep = Math.round(length / P.step) > MAX_TRACK_SAMPLES ? length / n : P.step;
  P.step = sampleStep;
  if (!n) return { samples: raw, length, bridges: [], crossings: [], flattened: [] };
  const samples = raw.map((s) => [...s]);
  const startGuard = prepareStartGrid(samples, P);
  const run = (i) => Math.hypot(samples[(i + 1) % n][0] - samples[i][0], samples[(i + 1) % n][2] - samples[i][2]) || P.step;
  const flattened = [];
  // Steep slopes: heights relaxed forwards and backwards until no step is steeper than MAX_SLOPE.
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (let k = 0; k < 2 * n; k++) {
      const forward = k < n, i = forward ? k : 2 * n - 1 - k, j = forward ? (i + 1) % n : (i - 1 + n) % n;
      const limit = MAX_SLOPE * run(forward ? i : j);
      const dy = samples[j][1] - samples[i][1];
      if (Math.abs(dy) > limit + 1e-6) {
        flattened.push([samples[j][0], samples[j][2]]);
        samples[j][1] = samples[i][1] + Math.sign(dy) * limit;
        changed = true;
      }
    }
    if (!changed) break;
  }
  const intersections = centrelineCrossings(samples, P);
  const bridges = P.autoBridges ? liftCrossings(samples, P, startGuard, intersections) : [];
  const clearancePairs = P.autoBridges ? crossingPairs(samples, P, new Float64Array(n), intersections, false) : [];
  smoothRoadGrades(samples, P, clearancePairs);
  const crossings = thin(lowCrossings(samples, P, intersections), P.roadWidth * 2);
  const heightOffset = Math.max(TRACK_BASE_HEIGHT, 1000 - samples.reduce((lowest, s) => Math.min(lowest, s[1]), Infinity));
  for (const s of samples) s[1] += heightOffset;
  const result = { samples, length, sampleStep, bridges, crossings, heightOffset, flattened: thin(flattened, P.roadWidth) };
  if (sampleCache.size >= 4) sampleCache.delete(sampleCache.keys().next().value);
  sampleCache.set(cacheKey, result);
  return copySamples(result);
}

// Lifts one branch of every crossing into a bridge (changes `samples` in place). Returns where.
function liftCrossings(samples, P, startGuard, intersections) {
  const n = samples.length, step = P.step;
  const clearance = P.wallHeight + 800;
  const skip = Math.ceil((P.roadWidth * 2.5) / step) + 2;
  const gap = (a, b) => { const d = Math.abs(a - b); return Math.min(d, n - d); };
  const lift = new Float64Array(n);
  const bridges = [];
  for (let pass = 0; pass < 6; pass++) {
    const pairs = crossingPairs(samples, P, lift, intersections);
    if (!pairs.length) break;
    // Pairs of one place of the layout belong together.
    const groups = [];
    for (const pair of pairs) {
      const group = groups.find((g) => g.some(([i, j]) => gap(i, pair[0]) <= skip && gap(j, pair[1]) <= skip));
      if (group) group.push(pair); else groups.push([pair]);
    }
    for (const group of groups) {
      const is = group.map((q) => q[0]), js = group.map((q) => q[1]);
      const y = (k) => samples[k][1] + lift[k];
      const mean = (list) => list.reduce((s, k) => s + y(k), 0) / list.length;
      const protectedStart = (list) => list.some((i) => startGuard[i] === 0);
      const liftFirst = protectedStart(js) ? !protectedStart(is) : !protectedStart(is) && mean(is) > mean(js);
      const [upper, lower] = liftFirst ? [is, js] : [js, is];
      const top = Math.max(...lower.map(y)) + clearance + 150;
      // The span of the upper branch over the crossing, as a start and a number of steps (it may wrap).
      const sorted = [...new Set(upper)].sort((a, b) => a - b);
      let start = sorted[0], bigGap = -1;
      for (let k = 0; k < sorted.length; k++) {
        const next = sorted[(k + 1) % sorted.length], d = (next - sorted[k] + n) % n || n;
        if (d > bigGap) { bigGap = d; start = next; }
      }
      const span = (sorted.length === 1 ? 0 : n - bigGap);
      const rise = Math.max(0, ...sorted.map((k) => top - y(k)));
      if (rise <= 0) continue;
      const ramp = Math.ceil(rise / RAMP_SLOPE / step);
      for (let d = -ramp; d <= span + ramp; d++) {
        const k = ((start + d) % n + n) % n;
        const out = d < 0 ? -d : d > span ? d - span : 0;
        const w = out === 0 ? 1 : 0.5 * (1 + Math.cos(Math.PI * out / ramp));
        const need = (top - samples[k][1]) * w * startGuard[k];
        if (need > lift[k]) lift[k] = need;
      }
      const mid = samples[((start + Math.round(span / 2)) % n + n) % n];
      if (!bridges.some((b) => Math.hypot(b[0] - mid[0], b[1] - mid[2]) < P.roadWidth * 2)) bridges.push([mid[0], mid[2]]);
    }
  }
  for (let k = 0; k < n; k++) samples[k][1] += lift[k];
  return bridges;
}

// The radius of the turn at each sample and the side it turns to (1 left, -1 right), from the
// samples `k` steps before and after; the smallest radius nearby is used, so edges stay smooth.
function turns(samples, P) {
  const n = samples.length, k = Math.max(1, Math.round(1200 / P.step));
  const raw = samples.map((b, i) => {
    const a = samples[(i - k + n) % n], c = samples[(i + k) % n];
    const ab = Math.hypot(b[0] - a[0], b[2] - a[2]), bc = Math.hypot(c[0] - b[0], c[2] - b[2]), ca = Math.hypot(a[0] - c[0], a[2] - c[2]);
    const cross = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
    return { radius: Math.abs(cross) > 1e-6 ? (ab * bc * ca) / (2 * Math.abs(cross)) : Infinity, side: cross < 0 ? 1 : -1 };
  });
  return raw.map((t, i) => {
    let radius = t.radius;
    for (let d = -3; d <= 3; d++) radius = Math.min(radius, raw[(i + d + n) % n].radius);
    return { radius, side: t.side };
  });
}

// What the generator does by itself with a layout, and what is left to the person. Each issue has
// a level ('info': handled when the track is built, 'warning', 'error'), a message and the
// positions (x, z) to mark on the drawing:
// - the road crossing itself at nearly the same height: built as a bridge (info);
// - turns tighter than the road is wide: the inside of the turn is narrowed so it does not fold (info);
// - slopes steeper than karts can climb: spread out (info);
// - a very short track (warning).
export function layoutIssues(points, params = {}) {
  const P = { ...DEFAULT_PARAMS, ...params };
  if (points.length < 3) return [{ level: 'error', message: 'A track needs at least 3 points.', at: [] }];
  const { samples, length, sampleStep, bridges, crossings, flattened } = trackSamples(points, P);
  P.step = sampleStep;
  const issues = [];
  if (bridges.length) issues.push({ level: 'info', message: `The road crosses itself ${bridges.length === 1 ? 'once' : `${bridges.length} times`} (blue marks): ${bridges.length === 1 ? 'it is' : 'they are'} built as a bridge, high enough to drive under, with gentle ramps. Raise a point there (Height) to choose which way goes over.`, at: bridges });
  if (crossings.length) issues.push({ level: 'warning', message: 'Track sections cross at similar heights. Use Height to separate them, or enable Automatic bridges in Road.', at: crossings });
  const tight = [];
  turns(samples, P).forEach((t, i) => { if (t.radius < (P.roadWidth * samples[i][3]) / 2 * 1.15) tight.push([samples[i][0], samples[i][2]]); });
  if (tight.length) issues.push({ level: 'info', message: 'Some turns are tighter than the road is wide (blue marks): the inside of the turn is made narrower there so the road does not fold over. Spread the points of the turn for a wider road.', at: thin(tight, P.roadWidth) });
  if (flattened.length) issues.push({ level: 'info', message: 'Some slopes are too steep to climb (blue marks): the height change is spread over a longer stretch.', at: flattened });
  const missingGrid = uncoveredStartGrid(roadFrames(samples, P));
  if (missingGrid.length) issues.push({ level: 'error', message: 'The starting grid does not fit this bend. Select a point on a straighter section and choose Set start here.', at: thin(missingGrid.map((p) => [p[0], p[2]]), P.roadWidth) });
  if (length < 20000) issues.push({ level: 'error', message: 'The layout is too short for the twelve-kart starting straight. Make it larger (at least 20000 units long).', at: [] });
  return issues;
}

// CKPT links and each route group's point count use byte-sized fields. Keep
// unsupported extreme layouts editable instead of exporting wrapped indices.
export function generatedTrackIssues(track) {
  const checkpoints = track?.kmp.CKPT.reduce((count, group) => count + group.points.length, 0) || 0;
  return checkpoints > 255 ? [{ level: 'error', message: `This layout needs ${checkpoints} checkpoints, beyond the game's 255-checkpoint limit. Simplify the tight bends before generating the track.`, at: [] }] : [];
}

// One mark per area, so a long overlap is not drawn as dozens of circles.
function thin(list, spacing) {
  const out = [];
  for (const p of list) if (!out.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < spacing)) out.push(p);
  return out;
}

// Shared by the preview and the exported model/collision. Each strip stays
// forward-facing even when the control points or widths change abruptly.
export function roadFrames(samples, params = {}) {
  const P = { ...DEFAULT_PARAMS, ...params };
  const n = samples.length;
  let frames = samples.map((s, i) => {
    const a = samples[(i - 1 + n) % n], b = samples[(i + 1) % n];
    const incoming = Math.hypot(s[0] - a[0], s[2] - a[2]) || 1, outgoing = Math.hypot(b[0] - s[0], b[2] - s[2]) || 1;
    let tx = (s[0] - a[0]) / incoming + (b[0] - s[0]) / outgoing, tz = (s[2] - a[2]) / incoming + (b[2] - s[2]) / outgoing;
    if (Math.hypot(tx, tz) < 1e-6) { tx = b[0] - s[0]; tz = b[2] - s[2]; }
    const l = Math.hypot(tx, tz) || 1;
    tx /= l; tz /= l;
    const half = (P.roadWidth * Math.max(.1, s[3])) / 2;
    const left = [tz, -tx];
    const at = (d) => [s[0] + left[0] * d, s[1], s[2] + left[1] * d];
    // Start with the requested width. Actual offset geometry below determines
    // its limits, rather than a neighbourhood radius with an unstable side.
    const hl = half, hr = half, ol = P.offroadWidth, or = P.offroadWidth;
    return {
      c: [s[0], s[1], s[2]], t: [tx, tz], left, half: (hl + hr) / 2, hl, hr, ol, or,
      L: at(hl), R: at(-hr), LO: at(hl + ol), RO: at(-hr - or),
    };
  });
  const grid = startGridWidths(frames, samples);
  frames = frames.map((f, i) => {
    const hl = Math.max(f.hl, grid[i][0]), hr = Math.max(f.hr, grid[i][1]);
    return { ...f, hl, hr, half: (hl + hr) / 2 };
  });
  const widths = frames.map((f) => [f.hl + f.ol, f.hr + f.or]);
  limitRoadClearance(frames, widths, P);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, f = frames[i], g = frames[j], dx = g.c[0] - f.c[0], dz = g.c[2] - f.c[2];
    const forwardF = Math.max(0, dx * f.t[0] + dz * f.t[1]), forwardG = Math.max(0, dx * g.t[0] + dz * g.t[1]);
    for (let k = 0; k < 2; k++) {
      const side = k === 0 ? 1 : -1;
      const atG = -side * (g.left[0] * f.t[0] + g.left[1] * f.t[1]);
      const atF = side * (f.left[0] * g.t[0] + f.left[1] * g.t[1]);
      if (atG > 1e-8) widths[j][k] = Math.min(widths[j][k], .8 * forwardF / atG);
      if (atF > 1e-8) widths[i][k] = Math.min(widths[i][k], .8 * forwardG / atF);
    }
  }
  const safeWidths = P.offroadWidth > 0 ? null : widths.map((w) => [...w]);
  smoothRoadWidths(frames, widths);
  // Without a shoulder, the asphalt itself must retain the safe grid apron.
  if (safeWidths) for (let i = 0; i < n; i++) for (let side = 0; side < 2; side++)
    widths[i][side] = Math.max(widths[i][side], Math.min(safeWidths[i][side], grid[i][side]));
  // Prefer narrowing the shoulder, then smooth the asphalt independently.
  // Otherwise switching between the two limits makes the road/grass seam kink.
  const asphalt = samples.map((s) => [P.roadWidth * Math.max(.1, s[3]) / 2, P.roadWidth * Math.max(.1, s[3]) / 2]);
  if (P.offroadWidth > 0) smoothRoadWidths(frames, asphalt, { limits: widths.map((w) => [w[0] * .96, w[1] * .96]), floors: grid });
  else for (let i = 0; i < n; i++) asphalt[i] = [...widths[i]];
  return frames.map((f, i) => {
    const at = (d) => [f.c[0] + f.left[0] * d, f.c[1], f.c[2] + f.left[1] * d];
    // Give up shoulder space before narrowing the asphalt. Keep a small
    // shoulder when enabled so its surface/kerb triangles remain nondegenerate.
    const [hl, hr] = asphalt[i];
    const ol = widths[i][0] - hl, or = widths[i][1] - hr;
    return { ...f, hl, hr, ol, or, half: (hl + hr) / 2, L: at(hl), R: at(-hr), LO: at(hl + ol), RO: at(-hr - or) };
  });
}

export function generateTrack(points, params = {}) {
  const P = { ...DEFAULT_PARAMS, ...params };
  const { samples, length, sampleStep } = trackSamples(points, P);
  P.step = sampleStep;
  const n = samples.length, frames = roadFrames(samples, P);
  const yaw = (dx, dz) => Math.round((Math.atan2(dx, dz) * 180) / Math.PI * 100) / 100;

  // Boost pads: samples on the straightest parts of the track.
  const boost = new Set();
  if (Array.isArray(P.boostPositions)) {
    for (const t of P.boostPositions.slice(0, 32).filter(Number.isFinite)) boost.add(Math.max(1, Math.min(n - 1, Math.round((((t % 1) + 1) % 1) * n))));
  } else if (P.boostPads > 0) {
    const straight = frames.map((f, i) => {
      let s = 0;
      for (let k = -3; k <= 3; k++) { const g = frames[(i + k + n) % n]; s += g.t[0] * f.t[0] + g.t[1] * f.t[1]; }
      return { i, s };
    }).sort((a, b) => b.s - a.s);
    const used = [];
    for (const { i } of straight) {
      if (used.length >= P.boostPads) break;
      if (i < n * 0.1 || used.some((u) => Math.min(Math.abs(u - i), n - Math.abs(u - i)) < n / (P.boostPads + 1) / 2)) continue;
      used.push(i);
      boost.add(i);
    }
  }
  const boostSegments = new Map();
  const panelSegments = Math.max(1, Math.min(Math.floor(n / 4), Math.round((P.boostLength || 1200) / P.step)));
  for (const center of boost) {
    const begin = Math.max(1, Math.min(n - panelSegments, center - Math.floor(panelSegments / 2)));
    for (let offset = 0; offset < panelSegments; offset++) if (!boostSegments.has(begin + offset)) boostSegments.set(begin + offset, [offset / panelSegments, (offset + 1) / panelSegments]);
  }

  const verts = [], flags = [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, minZ = Infinity, maxZ = -Infinity;
  const model = []; // { mat, v: [9], uv: [6] }
  const tri = (a, b, c, flag, mat, uv) => {
    for (const p of [a, b, c]) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); minZ = Math.min(minZ, p[2]); maxZ = Math.max(maxZ, p[2]); }
    verts.push(...a, ...b, ...c);
    flags.push(flag);
    if (mat) model.push({ mat, v: [...a, ...b, ...c], uv });
  };
  const face = (a, b, c, mat, uv) => model.push({ mat, v: [...a, ...b, ...c], uv });
  const depth = Math.max(300, Math.min(600, P.roadWidth * .16));
  const groundY = frames.reduce((lowest, f) => Math.min(lowest, f.c[1]), Infinity) - depth - 40;
  const lower = (p) => [p[0], p[1] - depth, p[2]];
  const raised = (p) => [p[0], p[1] + 6, p[2]];
  const support = (center, top) => {
    const width = 240, half = width / 2;
    const corners = [[-half, -half], [half, -half], [half, half], [-half, half]];
    for (let s = 0; s < 4; s++) {
      const a = corners[s], b = corners[(s + 1) % 4];
      const lowA = [center[0] + a[0], groundY, center[2] + a[1]], lowB = [center[0] + b[0], groundY, center[2] + b[1]];
      const highA = [lowA[0], top, lowA[2]], highB = [lowB[0], top, lowB[2]], h = (top - groundY) / 600;
      face(lowA, highB, lowB, 'support', [0, h, 1, 0, 1, h]);
      face(lowA, highA, highB, 'support', [0, h, 0, 0, 1, 0]);
    }
  };
  let dist = 0;
  for (let i = 0; i < n; i++) {
    const f = frames[i], g = frames[(i + 1) % n];
    const v0 = dist / P.roadWidth;
    const previousDist = dist;
    dist += Math.hypot(g.c[0] - f.c[0], g.c[1] - f.c[1], g.c[2] - f.c[2]);
    const v1 = dist / P.roadWidth;
    const isBoost = boostSegments.has(i);
    const roadFlag = (isBoost ? 0x0006 : 0x0000) | (P.trickable ? 0x2000 : 0);
    const roadMat = isBoost ? 'boost' : i === 0 ? 'startline' : 'road';
    const roadV0 = isBoost ? boostSegments.get(i)[0] : roadMat === 'road' ? v0 : 0, roadV1 = isBoost ? boostSegments.get(i)[1] : roadMat === 'road' ? v1 : .125;
    // A start line on a bend can be a trapezoid. Mapping each triangle to a rectangle
    // bends the checker stripes into a chevron along the diagonal; project both from
    // the same road plane instead, keeping the checks square and continuous.
    const startUV = (...points) => points.flatMap((p) => [
      ((f.L[0] - p[0]) * f.left[0] + (f.L[2] - p[2]) * f.left[1]) / (f.hl + f.hr),
      ((p[0] - f.c[0]) * f.t[0] + (p[2] - f.c[2]) * f.t[1]) / (f.hl + f.hr),
    ]);
    tri(f.L, f.R, g.R, roadFlag, roadMat, roadMat === 'startline' ? startUV(f.L, f.R, g.R) : [0, roadV0, 1, roadV0, 1, roadV1]);
    tri(f.L, g.R, g.L, roadFlag, roadMat, roadMat === 'startline' ? startUV(f.L, g.R, g.L) : [0, roadV0, 1, roadV1, 0, roadV1]);
    if (P.offroadWidth > 0) {
      // Planar mapping keeps grass/sand at a constant scale when a shoulder
      // narrows, rather than stretching a full tile across a tiny inner edge.
      const offUV = (...points) => points.flatMap((p) => [p[0] / 1800, p[2] / 1800]);
      tri(f.LO, f.L, g.L, 0x0003, 'offroad', offUV(f.LO, f.L, g.L));
      tri(f.LO, g.L, g.LO, 0x0003, 'offroad', offUV(f.LO, g.L, g.LO));
      tri(f.R, f.RO, g.RO, 0x0003, 'offroad', offUV(f.R, f.RO, g.RO));
      tri(f.R, g.RO, g.R, 0x0003, 'offroad', offUV(f.R, g.RO, g.R));
    }
    if (P.walls && P.wallHeight > 0) {
      const up = (p) => [p[0], p[1] + P.wallHeight, p[2]];
      const lb0 = P.offroadWidth > 0 ? f.LO : f.L, lb1 = P.offroadWidth > 0 ? g.LO : g.L;
      const rb0 = P.offroadWidth > 0 ? f.RO : f.R, rb1 = P.offroadWidth > 0 ? g.RO : g.R;
      tri(lb0, lb1, up(lb1), 0x000C, 'wall', [v0, 0, v1, 0, v1, 1]);
      tri(lb0, up(lb1), up(lb0), 0x000C, 'wall', [v0, 0, v1, 1, v0, 1]);
      tri(rb0, up(rb1), rb1, 0x000C, 'wall', [v0, 0, v1, 1, v1, 0]);
      tri(rb0, up(rb0), up(rb1), 0x000C, 'wall', [v0, 0, v0, 1, v1, 1]);
    }
    // The track is a solid deck rather than a zero-thickness ribbon. Side
    // faces and its underside make the actual spline heights readable.
    const lf = lower(f.LO), lg = lower(g.LO), rf = lower(f.RO), rg = lower(g.RO);
    const u0 = previousDist / 900, u1 = dist / 900;
    face(f.LO, g.LO, lg, 'foundation', [u0, 0, u1, 0, u1, 1]);
    face(f.LO, lg, lf, 'foundation', [u0, 0, u1, 1, u0, 1]);
    face(f.RO, rg, g.RO, 'foundation', [u0, 0, u1, 1, u1, 0]);
    face(f.RO, rf, rg, 'foundation', [u0, 0, u0, 1, u1, 1]);
    face(lf, lg, rg, 'foundation', [0, u0, 0, u1, 1, u1]);
    face(lf, rg, rf, 'foundation', [0, u0, 1, u1, 1, u0]);
    // Painted kerbs sit just above the shoulder, avoiding coincident faces.
    const kerb = (frame, side) => {
      const edge = side > 0 ? frame.L : frame.R;
      const shoulder = side > 0 ? frame.ol : frame.or;
      const offset = shoulder > 0 ? Math.min(120, shoulder) : -Math.min(120, frame.half * .08);
      return [edge[0] + frame.left[0] * side * offset, edge[1], edge[2] + frame.left[1] * side * offset];
    };
    const cl0 = raised(kerb(f, 1)), cl1 = raised(kerb(g, 1)), cr0 = raised(kerb(f, -1)), cr1 = raised(kerb(g, -1));
    const vl0 = previousDist / 600, vl1 = dist / 600;
    const aL = raised(f.L), bL = raised(g.L), aR = raised(f.R), bR = raised(g.R);
    const left = P.offroadWidth > 0 ? [cl0, aL, bL, cl1] : [aL, cl0, cl1, bL];
    const right = P.offroadWidth > 0 ? [aR, cr0, cr1, bR] : [cr0, aR, bR, cr1];
    for (const [a, b, c, d] of [left, right]) {
      face(a, b, c, 'curb', [0, vl0, 1, vl0, 1, vl1]); face(a, c, d, 'curb', [0, vl0, 1, vl1, 0, vl1]);
    }
    if (Math.floor(dist / 6000) !== Math.floor(previousDist / 6000) && f.c[1] - depth - groundY > 700) {
      const skip = Math.ceil((P.roadWidth + P.offroadWidth * 2) * 2 / P.step);
      for (const side of [1, -1]) {
        const edge = side > 0 ? f.LO : f.RO;
        const center = [edge[0] - f.left[0] * side * 230, f.c[1], edge[2] - f.left[1] * side * 230];
        const blocked = frames.some((other, j) => {
          const delta = Math.min(Math.abs(i - j), n - Math.abs(i - j));
          return delta > skip && other.c[1] < f.c[1] - depth + 250
            && Math.hypot(other.c[0] - center[0], other.c[2] - center[2]) < other.half + P.offroadWidth + 350;
        });
        if (!blocked) support(center, f.c[1] - depth);
      }
    }
  }

  // A textured reference level makes ramps and overpasses visible from any
  // camera angle. Landing off the deck still causes a fall/respawn.
  let gx0 = Infinity, gx1 = -Infinity, gz0 = Infinity, gz1 = -Infinity;
  for (const f of frames) for (const p of [f.LO, f.RO]) { gx0 = Math.min(gx0, p[0]); gx1 = Math.max(gx1, p[0]); gz0 = Math.min(gz0, p[2]); gz1 = Math.max(gz1, p[2]); }
  gx0 -= 10000; gx1 += 10000; gz0 -= 10000; gz1 += 10000;
  const ground = [[gx0, groundY, gz0], [gx0, groundY, gz1], [gx1, groundY, gz1], [gx1, groundY, gz0]];
  const groundUV = ground.map((p) => [p[0] / 1800, p[2] / 1800]);
  // This is only scenery. A fall trigger just 400–600 units below the road
  // can be hit through the deck by the game's extended collision checks.
  face(ground[0], ground[1], ground[2], 'terrain', [...groundUV[0], ...groundUV[1], ...groundUV[2]]);
  face(ground[0], ground[2], ground[3], 'terrain', [...groundUV[0], ...groundUV[2], ...groundUV[3]]);

  // Fall boundary below everything.
  const m = 20000;
  const x0 = minX - m, x1 = maxX + m, z0 = minZ - m, z1 = maxZ + m;
  const fy = minY - P.fallDepth;
  tri([x0, fy, z0], [x0, fy, z1], [x1, fy, z1], 0x0010, null);
  tri([x0, fy, z0], [x1, fy, z1], [x1, fy, z0], 0x0010, null);

  // ---- KMP --------------------------------------------------------------------
  const kmp = emptyKMP();
  kmp.STGI[0].laps = P.laps;
  const sampleAt = (i) => frames[((i % n) + n) % n];

  // Start: a little behind the finish line, facing forward.
  const s0 = frames[0];
  // Initial kart placement probes a sphere of radius 100. Staying 10 units
  // above the road lets it find the floor and apply the vehicle's own offset.
  kmp.KTPT.push(make.KTPT([s0.c[0] - s0.t[0] * 200, s0.c[1] + 10, s0.c[2] - s0.t[1] * 200], [0, yaw(s0.t[0], s0.t[1]), 0]));

  // Checkpoints (first one is the finish line).
  const cpStep = Math.max(1, Math.ceil(n / 200), Math.round(P.checkpointSpacing / P.step));
  const cps = [];
  const cpAt = (i) => {
    const f = frames[i];
    const wl = f.hl + f.ol, wr = f.hr + f.or;
    const cp = make.CKPT([f.c[0] + f.left[0] * wl, f.c[2] + f.left[1] * wl], [f.c[0] - f.left[0] * wr, f.c[2] - f.left[1] * wr]);
    cp._i = i;
    return cp;
  };
  const convex = (a, b) => {
    const q = [a.left, a.right, b.right, b.left];
    return q.every((p, i) => {
      const next = q[(i + 1) % 4], after = q[(i + 2) % 4];
      return (next[0] - p[0]) * (after[1] - next[1]) - (next[1] - p[1]) * (after[0] - next[0]) < -1e-4;
    });
  };
  // A wide checkpoint on a tight bend can produce a concave sector even
  // though the road itself is sound. Add intermediate gates there.
  const gates = frames.map((_, i) => cpAt(i));
  const appendGates = (a, b) => {
    if (b - a > 1 && !convex(gates[a % n], gates[b % n])) {
      const middle = Math.floor((a + b) / 2);
      appendGates(a, middle); appendGates(middle, b);
    } else if (b < n) cps.push(gates[b]);
  };
  cps.push(gates[0]);
  for (let i = 0; i < n; i += cpStep) appendGates(i, Math.min(n, i + cpStep));
  cps[0].type = 0;
  for (let k = 1; k <= P.keyCheckpoints && cps.length > P.keyCheckpoints + 1; k++) cps[Math.round((k * cps.length) / (P.keyCheckpoints + 1))].type = k;

  // Respawns every N checkpoints (placed slightly after the checkpoint so they are "behind" the next ones).
  cps.forEach((cp, ci) => {
    if (ci % P.respawnEvery !== 0) return;
    const f = frames[cp._i];
    const j = make.JGPT([f.c[0], f.c[1] + 10, f.c[2]], [0, yaw(f.t[0], f.t[1]), 0]);
    j.id = kmp.JGPT.length;
    kmp.JGPT.push(j);
  });
  cps.forEach((cp, ci) => { cp.respawn = Math.floor(ci / P.respawnEvery); delete cp._i; });
  const ckGroup = make.group(cps);
  ckGroup.prev = [0]; ckGroup.next = [0];
  kmp.CKPT.push(ckGroup);

  // Enemy and item routes along the centerline.
  const enStep = Math.max(1, Math.ceil(n / 255), Math.round(P.enemySpacing / P.step));
  const en = [], it = [];
  for (let i = 0; i < n; i += enStep) {
    const f = frames[i], g = frames[(i + 1) % n];
    // Stay inside the checkpoint sector rather than exactly on its border,
    // where the game's float precision can classify the point as out of bounds.
    const pos = f.c.map((v, k) => v + (g.c[k] - v) * .1);
    en.push({ ...make.ENPT(pos), width: Math.max(8, Math.round(f.half / 100)) });
    it.push({ ...make.ITPT([...pos]), width: Math.max(8, Math.round(f.half / 100)) });
  }
  const eg = make.group(en); eg.prev = [0]; eg.next = [0];
  const ig = make.group(it); ig.prev = [0]; ig.next = [0];
  kmp.ENPT.push(eg);
  kmp.ITPT.push(ig);

  // Store positions along/across the road, so boxes follow height and width edits.
  const itemPositions = Array.isArray(P.itemBoxPositions) ? P.itemBoxPositions :
    Array.from({ length: P.itemRows }, (_, row) => [-.75, -.25, .25, .75].map((offset) => ({ t: Math.round((row + 1) / (P.itemRows + 1) * n) / n, offset }))).flat();
  const itemBoxes = [];
  for (const box of itemPositions) {
    if (!Number.isFinite(box?.t) || !Number.isFinite(box?.offset)) continue;
    const t = ((box.t % 1) + 1) % 1, offset = Math.max(-.9, Math.min(.9, box.offset));
    const at = t * n, i = Math.floor(at), blend = at - i, f = frames[i], g = frames[(i + 1) % n];
    const d = (offset < 0 ? f.hr : f.hl) * offset, e = (offset < 0 ? g.hr : g.hl) * offset;
    const a = [f.c[0] + f.left[0] * d, f.c[1] + 60, f.c[2] + f.left[1] * d];
    const b = [g.c[0] + g.left[0] * e, g.c[1] + 60, g.c[2] + g.left[1] * e];
    const pos = a.map((v, k) => v + (b[k] - v) * blend);
    kmp.GOBJ.push(make.GOBJ(0x65, pos)); itemBoxes.push({ t, offset, pos });
  }

  // Cameras: an opening shot of the start and a goal camera.
  const start = frames[0];
  const opPos = [start.c[0] - start.t[0] * 6000 + start.left[0] * 3000, start.c[1] + 2500, start.c[2] - start.t[1] * 6000 + start.left[1] * 3000];
  const op = make.CAME(opPos);
  op.type = 5; op.time = 400; op.zoomStart = 45; op.zoomEnd = 35; op.viewStart = [...start.c]; op.viewEnd = [...start.c]; op.start = 1;
  // Type 5 is route-controlled in the game. A preview can draw its fixed position
  // without POTI, but the real camera constructor dereferences the missing route.
  const introRoute = make.route([make.routePoint([...opPos]), make.routePoint([opPos[0] + start.t[0] * 2000, opPos[1], opPos[2] + start.t[1] * 2000])]);
  introRoute.loop = 1; introRoute.smooth = 0;
  introRoute.points.forEach((point) => { point.setting1 = 5; });
  op.route = kmp.POTI.length; op.zoomSpeed = 3;
  kmp.POTI.push(introRoute);
  const goalPos = [start.c[0] + start.t[0] * 3000, start.c[1] + 800, start.c[2] + start.t[1] * 3000];
  const goal = make.CAME(goalPos);
  goal.type = 0; goal.zoomStart = goal.zoomEnd = 40; goal.viewStart = [...start.c]; goal.viewEnd = [...start.c];
  kmp.CAME.push(op, goal);
  kmp.extras.CAME = 0;

  return {
    verts: Float32Array.from(verts),
    flags: Uint16Array.from(flags),
    kmp,
    model: { tris: model, materials: trackMaterials(P) },
    boosts: [...boost].map((i) => ({ t: i / n, pos: [...frames[i].c], yaw: yaw(...frames[i].t) })),
    itemBoxes,
    length,
  };
}

export const MODEL_MATERIALS = trackMaterials();
