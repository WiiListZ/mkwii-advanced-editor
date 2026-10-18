// Keyframe view of the intro fly-over.
//
// An opening camera (one "shot") goes from a start pose to an end pose in `time` frames: position
// (fixed, or along a route), look-at point (viewStart -> viewEnd) and zoom (zoomStart -> zoomEnd).
// The keyframes are the boundaries between shots: keyframe n is the end of shot n - 1 and the start
// of shot n. When both sides hold the same pose the camera moves on smoothly ("linked"); otherwise
// the game cuts from one to the other.
//
// Every edit rewrites the speeds of the shots it touches, so the camera reaches the next keyframe
// exactly at its time. Shots are written the way Nintendo's intros are: type 5 cameras (with or
// without a route), routes that go back and forth, smooth only with 3 points or more.

import { make, newUid } from '../formats/kmp.js';
import { introChain, introTimeline, routeSectionLengths, setIntroChain, simulateCamera } from './cameras.js';

const NONE = 0xff;
const OPENING = 5; // OP_FixMoveAt: the type of every intro camera of the original tracks
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const u16 = (v) => Math.max(0, Math.min(0xffff, Math.ceil(v)));
const round3 = (v) => v.map((n) => Math.round(n * 100) / 100);
export const samePose = (a, b) => !!a && !!b && dist(a.position, b.position) < 2 && dist(a.target, b.target) < 2 && Math.abs(a.fov - b.fov) < 0.05;

const routeOf = (kmp, cam) => (cam.route !== NONE && kmp.POTI[cam.route]?.points.length >= 2 ? kmp.POTI[cam.route] : null);

// Start and end pose of a shot, as stored in the camera.
export function shotPoses(kmp, cam) {
  const pts = routeOf(kmp, cam)?.points;
  return {
    start: { position: [...(pts ? pts[0].pos : cam.pos)], target: [...cam.viewStart], fov: cam.zoomStart },
    end: { position: [...(pts ? pts[pts.length - 1].pos : cam.pos)], target: [...cam.viewEnd], fov: cam.zoomEnd },
  };
}

// Keyframes in time order: { frame, before, after, pose, linked }. `before` / `after` are the
// camera indices of the shots ending / starting there (null at the ends of the intro).
export function introKeyframes(kmp) {
  const { shots, total } = introTimeline(kmp);
  const keys = [];
  shots.forEach((s, n) => {
    const { start, end } = shotPoses(kmp, kmp.CAME[s.index]);
    if (!n) keys.push({ frame: 0, before: null, after: s.index, beforePose: null, afterPose: start });
    else Object.assign(keys[keys.length - 1], { after: s.index, afterPose: start });
    keys.push({ frame: s.start + s.frames, before: s.index, after: null, beforePose: end, afterPose: null });
  });
  for (const k of keys) {
    k.linked = !k.beforePose || !k.afterPose || samePose(k.beforePose, k.afterPose);
    k.pose = k.afterPose || k.beforePose;
  }
  return { keys, shots, total };
}

function routeUsers(kmp, index) {
  let n = 0;
  for (const list of [kmp.CAME, kmp.GOBJ || [], kmp.AREA || []]) for (const e of list) if (e.route === index) n++;
  return n;
}

// The camera's route, copied first when other cameras, objects or areas use it too.
function ownRoute(kmp, cam) {
  const route = kmp.POTI[cam.route];
  if (routeUsers(kmp, cam.route) <= 1) return route;
  const copy = { ...structuredClone(route), uid: newUid() };
  copy.points.forEach((p) => { p.uid = newUid(); });
  kmp.POTI.push(copy);
  cam.route = kmp.POTI.length - 1;
  return copy;
}

const routeLength = (route) => route.points.reduce((sum, p, i) => (i ? sum + dist(route.points[i - 1].pos, p.pos) : 0), 0);

// Route flags the game handles for camera routes (see cameras.js).
function fixRouteFlags(route) {
  route.loop = 1;
  if (route.points.length < 3) route.smooth = 0;
}

// Speeds that bring position, look-at and zoom to the end pose in exactly `time` frames.
function retime(kmp, cam) {
  const t = Math.max(1, Math.round(cam.time));
  cam.time = t;
  cam.type = OPENING;
  cam.viewSpeed = u16((dist(cam.viewStart, cam.viewEnd) / t) * 100);
  cam.zoomSpeed = u16((Math.abs(cam.zoomEnd - cam.zoomStart) / t) * 100);
  cam.pointSpeed = 0;
  const route = routeOf(kmp, cam) && ownRoute(kmp, cam);
  if (!route) return;
  fixRouteFlags(route);
  // The game reads whole units per frame from the route points, and may blend the speed from one
  // point to the next: every point gets the same speed v, so the camera moves the same either way.
  // A whole speed rarely fits the time exactly, so on a straight route two points on the line (the
  // path stays the same) switch it from v to v + 1 where that makes it arrive on time.
  if (!route.smooth) dropStraightPoints(route);
  const sections = routeSectionLengths(route), total = sections.reduce((a, b) => a + b, 0);
  const n = route.points.length;
  if (!(total > 0)) { for (const p of route.points) p.setting1 = 0; return; }
  const exact = total / t;
  if (exact < 1) {
    // Slower than the slowest speed: it arrives early and the 0 on the last point keeps it there.
    route.points.forEach((p, i) => { p.setting1 = i < n - 1 ? 1 : 0; });
    return;
  }
  const slow = clampSpeed(Math.floor(exact)), fast = clampSpeed(slow + 1);
  const atSlow = fast > slow ? (t - total / fast) / (1 / slow - 1 / fast) : total; // distance at the slower speed
  let section = -1, offset = 0;
  if (!route.smooth && atSlow > 0.5 && total - atSlow > 0.5) {
    for (let i = 0, walked = 0; i < sections.length; walked += sections[i++]) {
      if (atSlow < walked + sections[i] && sections[i] >= 4) { section = i; offset = Math.min(Math.max(atSlow - walked, 1), sections[i] - 2); break; }
    }
  }
  if (section < 0) {
    const speed = clampSpeed(Math.round(exact));
    for (const p of route.points) p.setting1 = speed;
    return;
  }
  route.points.forEach((p, i) => { p.setting1 = i <= section ? slow : fast; });
  const start = route.points[section].pos, end = route.points[section + 1].pos, d = sections[section];
  const at = (x) => round3(start.map((v, k) => v + ((end[k] - v) * x) / d));
  route.points.splice(section + 1, 0, { ...make.routePoint(at(offset)), setting1: slow }, { ...make.routePoint(at(offset + 1)), setting1: fast });
}

const clampSpeed = (v) => Math.max(1, Math.min(0xffff, v));

// Points of a straight route that lie on the line between their neighbours (the speed split points
// added above): they do not change the path, and the speeds are worked out again without them.
function dropStraightPoints(route) {
  route.points = route.points.filter((p, i, all) => {
    if (i === 0 || i === all.length - 1) return true;
    const a = all[i - 1].pos, b = all[i + 1].pos, ab = dist(a, b);
    return ab < 1 || Math.abs(dist(a, p.pos) + dist(p.pos, b) - ab) > 0.05;
  });
}

// Sets the start or end pose of a shot. A fixed camera whose two ends no longer match gets a
// straight route between them; a route whose ends meet becomes a fixed camera again.
function setShotSide(kmp, index, side, pose) {
  const cam = kmp.CAME[index];
  const position = round3(pose.position);
  const route = routeOf(kmp, cam) && ownRoute(kmp, cam);
  if (route) {
    route.points[side === 'start' ? 0 : route.points.length - 1].pos = position;
    if (route.points.length === 2 && dist(route.points[0].pos, route.points[1].pos) < 1) cam.route = NONE;
    cam.pos = [...route.points[0].pos];
  } else if (dist(cam.pos, position) >= 1) {
    const ends = side === 'start' ? [position, cam.pos] : [cam.pos, position];
    kmp.POTI.push(make.route(ends.map((p) => make.routePoint([...p]))));
    cam.route = kmp.POTI.length - 1;
    cam.pos = [...ends[0]];
  }
  cam.type = OPENING;
  if (side === 'start') { cam.viewStart = round3(pose.target); cam.zoomStart = Math.round(pose.fov * 100) / 100; }
  else { cam.viewEnd = round3(pose.target); cam.zoomEnd = Math.round(pose.fov * 100) / 100; }
}

// Sets a keyframe's pose: `side` 'both' (the shots before and after), 'before' or 'after'.
export function setKeyPose(kmp, key, pose, side = 'both') {
  if (key.before !== null && side !== 'after') { setShotSide(kmp, key.before, 'end', pose); retime(kmp, kmp.CAME[key.before]); }
  if (key.after !== null && side !== 'before') { setShotSide(kmp, key.after, 'start', pose); retime(kmp, kmp.CAME[key.after]); }
}

// Splits shot `index` at `frame` frames from its start; returns the new camera's index. Both
// halves keep the motion they had, so the intro plays exactly as before.
export function splitShot(kmp, index, frame) {
  const cam = kmp.CAME[index];
  const f = Math.max(1, Math.min(Math.round(cam.time) - 1, Math.round(frame)));
  const at = simulateCamera(kmp, index)[f];
  const next = { ...structuredClone(cam), uid: newUid(), time: Math.round(cam.time) - f };
  cam.time = f;
  cam.viewEnd = [...at.target]; cam.zoomEnd = at.fov;
  next.viewStart = [...at.target]; next.zoomStart = at.fov;
  const route = routeOf(kmp, cam) && ownRoute(kmp, cam);
  if (route) {
    const seg = Math.max(0, at.segment);
    const speedAt = route.points[seg].setting1;
    const head = route.points.slice(0, seg + 1), tail = route.points.slice(seg + 1);
    const split = { ...make.routePoint([...at.position]), setting1: speedAt };
    route.points = [...head, split];
    fixRouteFlags(route);
    const rest = [{ ...make.routePoint([...at.position]), setting1: speedAt }, ...tail.map((p) => ({ ...structuredClone(p), uid: newUid() }))];
    next.pos = [...at.position];
    if (rest.length >= 2) {
      const restRoute = { ...make.route(rest), smooth: route.smooth };
      fixRouteFlags(restRoute);
      kmp.POTI.push(restRoute);
      next.route = kmp.POTI.length - 1;
    } else { next.route = NONE; next.type = OPENING; }
  }
  kmp.CAME.push(next);
  const added = kmp.CAME.length - 1;
  const chain = introChain(kmp);
  chain.splice(chain.indexOf(index) + 1, 0, added);
  setIntroChain(kmp, chain);
  return added;
}

// New shot at the end of the intro, from the last keyframe (or `pose` itself) to `pose`.
export function appendShot(kmp, pose, frames) {
  const chain = introChain(kmp);
  const last = chain.length ? shotPoses(kmp, kmp.CAME[chain[chain.length - 1]]).end : pose;
  const cam = { ...make.CAME(round3(last.position)), type: OPENING, viewStart: round3(last.target), viewEnd: round3(last.target), zoomStart: last.fov, zoomEnd: last.fov, time: Math.max(1, Math.round(frames)) };
  kmp.CAME.push(cam);
  const index = kmp.CAME.length - 1;
  setIntroChain(kmp, [...chain, index]);
  setShotSide(kmp, index, 'end', pose);
  retime(kmp, cam);
  return index;
}

// Moves a keyframe in time: the shot before it gets longer or shorter, the shot after it the
// opposite, so the keyframes after it keep their time. Returns the frame actually used.
export function moveKey(kmp, key, frame) {
  if (key.before === null) return 0;
  const before = kmp.CAME[key.before], after = key.after !== null ? kmp.CAME[key.after] : null;
  const start = key.frame - Math.round(before.time);
  const max = after ? key.frame + Math.round(after.time) - 1 : Infinity;
  const to = Math.max(start + 1, Math.min(max, Math.round(frame)));
  if (after) after.time = Math.round(after.time) - (to - key.frame);
  before.time = to - start;
  retime(kmp, before);
  if (after) retime(kmp, after);
  return to;
}

// Removes a keyframe. Inside the intro the two shots around it become one; at either end the
// shot that touches it leaves the intro. Returns the cameras no longer in the intro.
export function removeKey(kmp, key) {
  const chain = introChain(kmp);
  if (key.before !== null && key.after !== null) {
    const before = kmp.CAME[key.before], after = kmp.CAME[key.after];
    const end = shotPoses(kmp, after).end, time = Math.round(before.time) + Math.round(after.time);
    setShotSide(kmp, key.before, 'end', end);
    before.time = time;
    retime(kmp, before);
    setIntroChain(kmp, chain.filter((i) => i !== key.after));
    return [key.after];
  }
  const gone = key.after ?? key.before;
  setIntroChain(kmp, chain.filter((i) => i !== gone));
  return [gone];
}

// Intro shots the game plays differently from the preview, or that can freeze it (shots made by
// older versions of the editor): [{ index, problems }].
export function introShotIssues(kmp) {
  const out = [];
  for (const index of introChain(kmp)) {
    const cam = kmp.CAME[index], route = routeOf(kmp, cam), problems = [];
    if (cam.type === 6) problems.push('type 6 instead of 5 like every original intro camera');
    if (route?.smooth && route.points.length < 3) problems.push('a smooth route of 2 points, which can freeze the game');
    if (route && passesEnd(kmp, index, route)) problems.push('it reaches the end of its route early and goes on moving');
    if (problems.length) out.push({ index, problems });
  }
  return out;
}

// Whether the camera reaches the last point of its route and then leaves it again.
function passesEnd(kmp, index, route) {
  const end = route.points[route.points.length - 1].pos;
  const poses = simulateCamera(kmp, index);
  const arrived = poses.findIndex((p) => dist(p.position, end) < 1);
  return arrived >= 0 && arrived < poses.length - 2 && poses.slice(arrived).some((p) => dist(p.position, end) > 2);
}

// Rewrites those shots so they play as the preview shows them, keeping their keyframes and times.
export function fixIntroShots(kmp) {
  const issues = introShotIssues(kmp);
  for (const { index } of issues) retime(kmp, kmp.CAME[index]);
  return issues.length;
}

// Speed fields are 16-bit: a look-at point or zoom that has to move too far for the shot's time
// cannot reach its keyframe. Returns what cannot (empty when the shot is fine).
export function shotSpeedLimits(cam) {
  const t = Math.max(1, Math.round(cam.time)), out = [];
  if ((dist(cam.viewStart, cam.viewEnd) / t) * 100 > 0xffff) out.push('look-at point');
  if ((Math.abs(cam.zoomEnd - cam.zoomStart) / t) * 100 > 0xffff) out.push('zoom');
  return out;
}
