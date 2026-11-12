// KMP cameras (CAME): intro chain and frame-by-frame poses for previews.
//
// The CAME section header holds two indices: the first camera of the intro fly-over (high byte)
// and the camera of the course selection screen (low byte). Intro cameras are chained with "next".
//
// How the game moves an opening camera (values checked against the original tracks and the
// timings wkmpt computes):
// - with a route, the camera follows it; each route point's Setting 1 is the speed in units per
//   frame from that point on (blended toward the next point). Without a route it stays at its position.
//   At the last point a speed of 0 stops it (all of Nintendo's routes that end early do that);
//   otherwise it goes on: back toward the start (route setting 2 = 1) or round to the first point (0);
// - "smooth" routes need at least 3 points (the game freezes on a smooth route of 2);
// - the look-at point goes from "look-at start" to "look-at end" at viewSpeed / 100 units per frame;
// - the field of view goes from zoom start to zoom end at zoomSpeed / 100 degrees per frame;
// - the camera is used for `time` frames (60 per second).
// Replay and goal cameras follow the kart, so their preview uses the first start position.

import { make } from '../formats/kmp.js';

// Type 6 (OP_PathMoveAt) is not an intro camera: in the game it moves with the kart.
export const OPENING_TYPES = new Set([5]);
const KART_RELATIVE = new Set([0, 3, 4]); // goal, kart follow, kart path follow
const NONE = 0xff;

export function introIndex(kmp) { return ((kmp.extras?.CAME ?? 0) >> 8) & 0xff; }
export function selectionIndex(kmp) { return (kmp.extras?.CAME ?? 0) & 0xff; }
export function setCameraHeader(kmp, intro, selection) {
  kmp.extras = { ...(kmp.extras || {}), CAME: ((intro & 0xff) << 8) | (selection & 0xff) };
}

// Replay cameras along the enemy route: one box area and camera per stretch of road, the way the
// original tracks do it (9 to 17 areas). Values are those of Mario Circuit's fixed (type 1) and
// follow (type 3) cameras. Returns how many stretches were added.
export function addReplayCameras(kmp, { spacing = 14000, minimum = 6, maximum = 16 } = {}) {
  const line = [], seen = new Set();
  for (let g = 0; kmp.ENPT[g] && !seen.has(g); g = kmp.ENPT[g].next?.[0]) {
    seen.add(g);
    line.push(...kmp.ENPT[g].points);
  }
  if (line.length < 3) return 0;
  const distance = [0];
  for (let i = 1; i <= line.length; i++) {
    const a = line[i - 1].pos, b = line[i % line.length].pos;
    distance.push(distance[i - 1] + Math.hypot(b[0] - a[0], b[2] - a[2]));
  }
  const total = distance[line.length];
  if (total < 1000) return 0;
  const room = 0xff - kmp.CAME.length - 1;
  const stretches = Math.min(room, Math.max(minimum, Math.min(maximum, Math.round(total / spacing))));
  let index = 0;
  for (let s = 0; s < stretches; s++) {
    const from = total * s / stretches, to = total * (s + 1) / stretches;
    const inside = [];
    for (let i = 0; i < line.length; i++) if (distance[i] >= from && distance[i] < to) inside.push(line[i]);
    if (!inside.length) inside.push(line[Math.min(line.length - 1, index)]);
    index += inside.length;
    const first = inside[0].pos, last = inside[inside.length - 1].pos, middle = inside[inside.length >> 1].pos;
    let dx = last[0] - first[0], dz = last[2] - first[2];
    if (Math.hypot(dx, dz) < 1) { dx = 0; dz = 1; }
    const length = Math.hypot(dx, dz), side = [dz / length, -dx / length];
    const half = Math.max(...inside.map((p) => (p.width || 10) * 100));
    let low = Infinity, high = -Infinity, far = 0;
    for (const p of inside) {
      low = Math.min(low, p.pos[1]); high = Math.max(high, p.pos[1]);
      far = Math.max(far, Math.abs((p.pos[0] - first[0]) * side[0] + (p.pos[2] - first[2]) * side[1]));
    }
    const center = [(first[0] + last[0]) / 2, low - 2000, (first[2] + last[2]) / 2];
    const camera = make.CAME([middle[0] + side[0] * (half + 3500), high + 1800, middle[2] + side[1] * (half + 3500)]);
    if (s % 3 === 2) Object.assign(camera, { type: 3, zoomStart: 60, zoomEnd: 45, zoomSpeed: 8, viewStart: [180, 5, 600], viewEnd: [0, 12, 0] });
    else Object.assign(camera, { type: 1, zoomStart: 20, zoomEnd: 45, zoomSpeed: 20, viewStart: [0, 0, 0], viewEnd: [0, 0, 0] });
    const area = make.AREA(center);
    area.type = 0;
    area.camera = kmp.CAME.length;
    area.rot = [0, Math.round(Math.atan2(dx, dz) * 180 / Math.PI * 100) / 100, 0];
    // Boxes are 10000 units per unit of scale and start at their position's height.
    const round = (value) => Math.round(value * 1000) / 1000;
    area.scale = [round((far + half) * 2.6 / 10000 + .2), round((high - low + 6000) / 10000), round((length * 1.2 + 2000) / 10000)];
    kmp.CAME.push(camera);
    kmp.AREA.push(area);
  }
  return stretches;
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
  const moves = route && route.points.length >= 2 ? routeMotion(route, cam.pointSpeed / 100, frames) : null;
  const opening = OPENING_TYPES.has(cam.type);
  let view = [...cam.viewStart], fov = cam.zoomStart || 45;
  const out = [];
  for (let f = 0; f < frames; f++) {
    const position = moves ? moves[f].position : cam.pos;
    const target = opening ? view : nearestRoadPoint(kmp, position);
    out.push({ position: [...position], target: [...target], fov, segment: moves ? moves[f].segment : -1 });
    if (opening) {
      const toEnd = sub(cam.viewEnd, view), d = len(toEnd), step = cam.viewSpeed / 100;
      view = d <= step || d === 0 ? [...cam.viewEnd] : view.map((v, a) => v + (toEnd[a] / d) * step);
    }
    const dz = cam.zoomEnd - fov, zs = cam.zoomSpeed / 100;
    fov = Math.abs(dz) <= zs ? cam.zoomEnd : fov + Math.sign(dz) * zs;
  }
  return out;
}

// Position on a route at every frame: { position, segment } (segment: the route point passed last).
function routeMotion(route, fallbackSpeed, frames) {
  const path = routePath(route), pts = path.pts, n = pts.length;
  const useRouteSpeeds = path.speeds.some((s) => s > 0);
  const cyclic = !route.loop && route.points.length > 2;
  let k = 0, along = 0, dir = 1, stopped = false;
  // The vertex the camera is heading to (-1: none).
  const next = () => (dir > 0 ? (k + 1 < n ? k + 1 : cyclic ? 0 : -1) : k > 0 ? k - 1 : -1);
  const out = [];
  for (let f = 0; f < frames; f++) {
    let j = next();
    const edge = j >= 0 ? len(sub(pts[j], pts[k])) || 1 : 1;
    const t = j >= 0 ? Math.min(1, along / edge) : 0;
    out.push({ position: j >= 0 ? lerp3(pts[k], pts[j], t) : [...pts[k]], segment: path.from[k] });
    if (stopped || j < 0) continue;
    const speed = useRouteSpeeds ? Math.max(0.5, path.speeds[k] + (path.speeds[j] - path.speeds[k]) * t) : fallbackSpeed;
    if (speed <= 0) continue;
    along += speed;
    for (let guard = 0; guard < 10000; guard++) {
      j = next();
      if (j < 0) { along = 0; break; }
      const length = len(sub(pts[j], pts[k]));
      if (along < length) break;
      along -= length;
      k = j;
      const atEnd = dir > 0 ? k === n - 1 : k === 0;
      if (!atEnd) continue;
      if (useRouteSpeeds && path.speeds[k] <= 0) { stopped = true; along = 0; break; }
      if (!(dir > 0 && cyclic)) dir = -dir;
    }
  }
  return out;
}

// Length of each section of a route (point i to i + 1), along the curve the camera follows.
export function routeSectionLengths(route) {
  const path = routePath(route), out = new Array(Math.max(0, route.points.length - 1)).fill(0);
  for (let v = 0; v < path.pts.length - 1; v++) out[path.from[v]] += len(sub(path.pts[v + 1], path.pts[v]));
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
