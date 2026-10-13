// KMP cameras (CAME): intro chain and frame-by-frame poses for previews.
//
// The CAME section header holds two indices: the first camera of the intro fly-over (high byte)
// and the camera of the course selection screen (low byte). Intro cameras are chained with "next".
//
// How the game moves an opening camera (values checked against the original tracks):
// - with a route, the camera follows it; each route point's Setting 1 is the speed in units per
//   frame from that point on (blended toward the next point). Without a route it stays at its position;
// - the look-at point goes from "look-at start" to "look-at end" at viewSpeed / 100 units per frame;
// - the field of view goes from zoom start to zoom end at zoomSpeed / 100 degrees per frame;
// - the camera is used for `time` frames (60 per second).
// Replay and goal cameras follow the kart, so their preview uses the first start position.

export const OPENING_TYPES = new Set([5, 6]);
const KART_RELATIVE = new Set([0, 3, 4]); // goal, kart follow, kart path follow
const NONE = 0xff;

export function introIndex(kmp) { return ((kmp.extras?.CAME ?? 0) >> 8) & 0xff; }
export function selectionIndex(kmp) { return (kmp.extras?.CAME ?? 0) & 0xff; }
export function setCameraHeader(kmp, intro, selection) {
  kmp.extras = { ...(kmp.extras || {}), CAME: ((intro & 0xff) << 8) | (selection & 0xff) };
}

// Indices of the intro cameras in playing order (stops at "none", a bad index or a loop).
export function introChain(kmp) {
  const out = [], seen = new Set();
  for (let i = introIndex(kmp); i !== NONE && i < kmp.CAME.length && !seen.has(i); i = kmp.CAME[i].next) {
    seen.add(i);
    out.push(i);
  }
  return out;
}

export const cameraFrames = (cam) => Math.max(1, Math.round(cam.time || 0));

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (v) => Math.hypot(v[0], v[1], v[2]);
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Polyline of a route with the speed at every vertex; smooth routes become a Catmull-Rom curve.
// `from[i]` is the route point each vertex comes after.
function routePath(route) {
  const pts = route.points.map((p) => p.pos), speeds = route.points.map((p) => p.setting1 || 0);
  if (!route.smooth || pts.length < 3) return { pts, speeds, from: pts.map((_, i) => i) };
  const out = [], outSpeeds = [], from = [], steps = 8;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      out.push([0, 1, 2].map((a) => 0.5 * (2 * p1[a] + (-p0[a] + p2[a]) * t + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t2 + (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * t3)));
      outSpeeds.push(speeds[i] + (speeds[i + 1] - speeds[i]) * t);
      from.push(i);
    }
  }
  out.push(pts[pts.length - 1]);
  outSpeeds.push(speeds[speeds.length - 1]);
  from.push(pts.length - 1);
  return { pts: out, speeds: outSpeeds, from };
}

function kartFrame(kmp) {
  const k = kmp.KTPT?.[0];
  const pos = k?.pos || [0, 0, 0], yaw = ((k?.rot?.[1] || 0) * Math.PI) / 180;
  const forward = [Math.sin(yaw), 0, Math.cos(yaw)], right = [Math.cos(yaw), 0, -Math.sin(yaw)];
  return (v) => [0, 1, 2].map((a) => pos[a] + right[a] * v[0] + (a === 1 ? v[1] : 0) + forward[a] * v[2]);
}

function nearestRoadPoint(kmp, from) {
  let best = null, bestD = Infinity;
  for (const g of kmp.ENPT || []) for (const p of g.points) {
    const d = len(sub(p.pos, from));
    if (d < bestD) { bestD = d; best = p.pos; }
  }
  return best || kmp.KTPT?.[0]?.pos || [from[0], from[1] - 1000, from[2] + 1000];
}

// Every frame of one camera: { position, target, fov, segment } (segment: the route point the
// camera has passed, for cameras on a route).
export function simulateCamera(kmp, index) {
  const cam = kmp.CAME[index];
  if (!cam) return [];
  const frames = cameraFrames(cam);
  if (KART_RELATIVE.has(cam.type)) {
    const toWorld = kartFrame(kmp);
    return [{ position: toWorld(cam.viewStart), target: toWorld(cam.viewEnd), fov: cam.zoomStart || 45 }];
  }
  const route = cam.route !== NONE ? kmp.POTI?.[cam.route] : null;
  const path = route && route.points.length >= 2 ? routePath(route) : null;
  const useRouteSpeeds = path && path.speeds.some((s) => s > 0);
  const opening = OPENING_TYPES.has(cam.type);
  let seg = 0, along = 0;
  let view = [...cam.viewStart], fov = cam.zoomStart || 45;
  const out = [];
  for (let f = 0; f < frames; f++) {
    let position = cam.pos;
    const segment = path ? path.from[seg] : -1;
    if (path) {
      const a = path.pts[seg], b = path.pts[Math.min(seg + 1, path.pts.length - 1)];
      const segLen = len(sub(b, a)) || 1;
      position = lerp3(a, b, Math.min(1, along / segLen));
      // Advance along the route at this frame's speed.
      const t = Math.min(1, along / segLen);
      let speed = useRouteSpeeds ? path.speeds[seg] + (path.speeds[Math.min(seg + 1, path.speeds.length - 1)] - path.speeds[seg]) * t : cam.pointSpeed / 100;
      speed = Math.max(speed, useRouteSpeeds ? 0.5 : 0);
      along += speed;
      while (seg < path.pts.length - 1 && along >= len(sub(path.pts[seg + 1], path.pts[seg]))) {
        along -= len(sub(path.pts[seg + 1], path.pts[seg]));
        seg++;
      }
      if (seg >= path.pts.length - 1) { seg = path.pts.length - 1; along = 0; }
    }
    const target = opening ? view : nearestRoadPoint(kmp, position);
    out.push({ position: [...position], target: [...target], fov, segment });
    if (opening) {
      const toEnd = sub(cam.viewEnd, view), d = len(toEnd), step = cam.viewSpeed / 100;
      view = d <= step || d === 0 ? [...cam.viewEnd] : view.map((v, a) => v + (toEnd[a] / d) * step);
    }
    const dz = cam.zoomEnd - fov, zs = cam.zoomSpeed / 100;
    fov = Math.abs(dz) <= zs ? cam.zoomEnd : fov + Math.sign(dz) * zs;
  }
  return out;
}

// Rewrites the "next" links and the header so the intro plays `chain` (camera indices) in order.
export function setIntroChain(kmp, chain) {
  for (const i of introChain(kmp)) kmp.CAME[i].next = NONE;
  chain.forEach((i, n) => { kmp.CAME[i].next = n + 1 < chain.length ? chain[n + 1] : NONE; });
  setCameraHeader(kmp, chain.length ? chain[0] : NONE, selectionIndex(kmp));
}

// The whole intro: shots in order with their first frame, and the pose at any frame.
export function introTimeline(kmp) {
  const shots = [];
  let start = 0;
  for (const index of introChain(kmp)) {
    const frames = cameraFrames(kmp.CAME[index]);
    shots.push({ index, start, frames });
    start += frames;
  }
  return { shots, total: start };
}

export function introPose(kmp, timeline, frame, cache = new Map()) {
  const shot = timeline.shots.find((s) => frame < s.start + s.frames) || timeline.shots[timeline.shots.length - 1];
  if (!shot) return null;
  let poses = cache.get(shot.index);
  if (!poses) { poses = simulateCamera(kmp, shot.index); cache.set(shot.index, poses); }
  return { shot, pose: poses[Math.max(0, Math.min(poses.length - 1, frame - shot.start))] };
}
