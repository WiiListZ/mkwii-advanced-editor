// Shortcuts of the track generator, and the scenery it can place beside the road.
//
// A shortcut leaves the road at one point and rejoins it further on. Routes and checkpoints split
// there into groups, the way the game's own branching tracks do it. The places where shortcuts
// leave or rejoin cut the main road into stretches; each stretch and each shortcut is a group,
// linked to every group that starts where it ends. So shortcuts can overlap, share an end, or
// follow one another:
//   A0 -> (main stretch | shortcut) -> A1 -> ... -> A0
// Lap and key checkpoints stay where every driver goes through.

const SHORTCUT_WIDTH = .8; // of the road's width

// Stretch of road between two points, leaving and arriving along the road's own direction.
function hermite(a, ta, b, tb, t) {
  const t2 = t * t, t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
  return [0, 1].map((k) => h00 * a[k] + h10 * ta[k] + h01 * b[k] + h11 * tb[k]);
}

// How steep a shortcut's ramps are: their steepest part, in the middle, is 1.5 times this, under
// the 0.4 karts can still climb.
const SHORTCUT_RAMP = .25;

// Ramp lengths up to (or down to) a chosen height from the two ends, or null when the shortcut is
// too short to reach it.
function shortcutRamps(startY, endY, top, length) {
  const rise = Math.abs(top - startY) / SHORTCUT_RAMP, fall = Math.abs(top - endY) / SHORTCUT_RAMP;
  return rise + fall <= length ? { rise, fall } : null;
}

// Height along a shortcut: from one end to the other, or up or down to `top` in between.
function shortcutHeight(startY, endY, top, ramps, distance, length) {
  const base = startY + (endY - startY) * (distance / (length || 1));
  if (top === null || !ramps) return base;
  const smooth = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
  if (distance < ramps.rise) return startY + (top - startY) * smooth(distance / (ramps.rise || 1));
  if (distance > length - ramps.fall) return endY + (top - endY) * smooth((length - distance) / (ramps.fall || 1));
  return top;
}

// The frames of one shortcut: centre, direction, left normal and edges, with heights blended
// between the two ends, or raised or lowered to `top` in between. Raised a little so its road never
// shares a plane with the main road.
function shortcutFrames(start, end, via, step, half, top = null) {
  const nodes = [[start.c[0], start.c[2]], ...via.map((p) => [p.x, p.z]), [end.c[0], end.c[2]]];
  const dense = [];
  for (let s = 0; s < nodes.length - 1; s++) {
    const a = nodes[s], b = nodes[s + 1], span = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const before = s ? [(b[0] - nodes[s - 1][0]) / 2, (b[1] - nodes[s - 1][1]) / 2] : [start.t[0] * span, start.t[1] * span];
    const after = s + 2 < nodes.length ? [(nodes[s + 2][0] - a[0]) / 2, (nodes[s + 2][1] - a[1]) / 2] : [end.t[0] * span, end.t[1] * span];
    const count = Math.max(8, Math.ceil(span / 100));
    for (let i = 0; i < count; i++) dense.push(hermite(a, before, b, after, i / count));
  }
  dense.push(nodes.at(-1));
  let total = 0;
  const along = [0];
  for (let i = 1; i < dense.length; i++) { total += Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]); along.push(total); }
  const count = Math.max(4, Math.round(total / step)), points = [];
  let j = 1;
  for (let i = 0; i <= count; i++) {
    const d = total * i / count;
    while (j < dense.length - 1 && along[j] < d) j++;
    const f = (d - along[j - 1]) / (along[j] - along[j - 1] || 1);
    points.push([dense[j - 1][0] + (dense[j][0] - dense[j - 1][0]) * f, dense[j - 1][1] + (dense[j][1] - dense[j - 1][1]) * f]);
  }
  const ramps = top === null ? null : shortcutRamps(start.c[1], end.c[1], top, total);
  return {
    length: total,
    reaches: top === null || !!ramps,
    frames: points.map((p, i) => {
      const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, t = [(b[0] - a[0]) / length, (b[1] - a[1]) / length], left = [t[1], -t[0]];
      const y = shortcutHeight(start.c[1], end.c[1], top, ramps, total * i / (points.length - 1), total) + 2;
      const at = (d) => [p[0] + left[0] * d, y, p[1] + left[1] * d];
      return { c: [p[0], y, p[1]], t, left, half, hl: half, hr: half, ol: 0, or: 0, L: at(half), R: at(-half), LO: at(half), RO: at(-half) };
    }),
  };
}

// The stretch of the main road a shortcut skips: the shorter way round between its two ends, in
// whichever order they were clicked. `crossesStart` when that stretch holds the start line.
export function shortcutSpan(shortcut) {
  const low = Math.min(shortcut.from, shortcut.to), high = Math.max(shortcut.from, shortcut.to);
  return high - low <= .5 ? { from: low, to: high, crossesStart: false } : { from: high, to: low, crossesStart: true };
}

// Shortcuts from their settings: { from, to, via, height } with from and to as fractions of the lap
// and height, if set, as the road points' Height (above the track's baseline, `params.heightOffset`
// in the world). Those that cannot work are left out, and said why, by their number (S1 is the
// first in `params.shortcuts`). `crossesStart` tells that one skips the start line.
export function buildShortcuts(frames, params) {
  const n = frames.length, problems = [], chosen = [];
  let crossesStart = false;
  const list = (params.shortcuts || []).map((shortcut, index) => ({ shortcut, name: `S${index + 1}` }))
    .filter(({ shortcut }) => Number.isFinite(shortcut?.from) && Number.isFinite(shortcut?.to));
  const valid = [];
  for (const entry of list) {
    const span = shortcutSpan(entry.shortcut);
    // A lap counts only across the start line, so every driver must cross it.
    if (span.crossesStart) { crossesStart = true; problems.push(`${entry.name} skips the start line, and was left out: a lap only counts when it is crossed. Move the start out of the shortcut, or the shortcut away from the start.`); continue; }
    valid.push({ ...entry, span });
  }
  // Ends this close (in samples) are one place where several ways meet: the road between them
  // would hold nothing, and the game needs at least a checkpoint on every stretch.
  const near = Math.max(2, Math.round(params.roadWidth / params.step));
  const places = [];
  const placeOf = (index) => {
    const found = places.find((p) => Math.abs(p - index) <= near);
    if (found !== undefined) return found;
    places.push(index);
    return index;
  };
  // The game links at most 6 groups after or before one.
  const leaving = new Map(), joining = new Map();
  const ways = (map, place) => map.get(place) || 0;
  valid.sort((a, b) => a.span.from - b.span.from);
  for (const { shortcut, name, span } of valid) {
    const reversed = shortcut.from > shortcut.to;
    const rawI = Math.round(span.from * n), rawJ = Math.round(span.to * n);
    // Every driver crosses the start line on the main road, with a stretch of it on each side.
    if (rawI < near || rawJ > n - near) { problems.push(`${name} leaves or rejoins the road too close to the start line, and was left out. Keep its ends a little further from the start.`); continue; }
    const i = placeOf(rawI), j = placeOf(rawJ);
    if (j - i < near) { problems.push(`${name} leaves and rejoins the road at almost the same place, and was left out. Make its ends further apart.`); continue; }
    if (ways(leaving, i) >= 5 || ways(joining, j) >= 5) { problems.push(`${name} was left out: the game allows at most 6 ways out of or into one place, and other shortcuts already use them there.`); continue; }
    const via = (shortcut.via || []).filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.z));
    const half = params.roadWidth * SHORTCUT_WIDTH / 2;
    const top = Number.isFinite(shortcut.height) ? shortcut.height + (params.heightOffset || 0) : null;
    const built = shortcutFrames(frames[i], frames[j], reversed ? [...via].reverse() : via, params.step, half, top);
    if (!built.reaches) { problems.push(`${name} is too short to reach height ${Math.round(shortcut.height)} with ramps karts can climb, and was left out. Lower its height or make it longer.`); continue; }
    // Without a height of its own, the two ends alone decide how steep it is.
    if (top === null && Math.abs(frames[j].c[1] - frames[i].c[1]) > built.length * .4) { problems.push(`${name} is too steep for its length, and was left out.`); continue; }
    chosen.push({ i, j, ...built });
    leaving.set(i, ways(leaving, i) + 1); joining.set(j, ways(joining, j) + 1);
  }
  return { shortcuts: chosen, problems, crossesStart };
}

// Where a shortcut meets the main road its walls and the main road's must close on each other,
// with no slit a kart could leave through. A wall stretch of the main road opens only where the
// shortcut's road runs through it, and a shortcut's wall starts with the first stretch that is
// outside the main road. The stretches that cross the line overlap, so the corner is closed.

// Within `reach` of a polyline of frames, across it and at its height.
function onStrip(list, p, widthOf, height) {
  for (let k = 0; k + 1 < list.length; k++) {
    const f = list[k], g = list[k + 1], dx = g.c[0] - f.c[0], dz = g.c[2] - f.c[2];
    const t = Math.max(0, Math.min(1, ((p[0] - f.c[0]) * dx + (p[2] - f.c[2]) * dz) / (dx * dx + dz * dz || 1)));
    const x = f.c[0] + dx * t, y = f.c[1] + (g.c[1] - f.c[1]) * t, z = f.c[2] + dz * t;
    if (Math.abs(p[1] - y) > height) continue;
    const lx = f.left[0] * (1 - t) + g.left[0] * t, lz = f.left[1] * (1 - t) + g.left[1] * t;
    const across = ((p[0] - x) * lx + (p[2] - z) * lz) / (Math.hypot(lx, lz) || 1);
    // Past the end of the stretch: only a little between two stretches, on the outside of a bend,
    // and not at all past the strip's own ends.
    const beyond = Math.abs((p[0] - x) * dx + (p[2] - z) * dz) / (Math.hypot(dx, dz) || 1);
    const end = (k === 0 && t === 0) || (k + 2 === list.length && t === 1);
    const [left, right] = widthOf(f, g, t);
    if (across <= left && across >= -right && beyond <= (end ? 1 : Math.hypot(dx, dz))) return true;
  }
  return false;
}

// Wall stretches of the main road a shortcut must pass through, as `${segment}:${side}`.
export function shortcutWallGaps(frames, shortcuts, params) {
  const gaps = new Set(), height = Math.max(400, params.wallHeight || 0);
  const n = frames.length;
  const road = (f, g, t) => { const half = f.half * (1 - t) + g.half * t; return [half, half]; };
  // On the road of any shortcut, anywhere along it (one can cross the main road): where two leave
  // together, a stretch can lie half on each.
  const strips = shortcuts.map(({ frames: branch }) => branch);
  const onShortcut = (p) => strips.some((strip) => onStrip(strip, p, road, height));
  for (let k = 0; k < n; k++) {
    const f = frames[k], g = frames[(k + 1) % n];
    for (const [side, a, b] of [[1, f.LO, g.LO], [-1, f.RO, g.RO]]) {
      // Open only where both ends of the stretch are on shortcut road: the stretch that crosses
      // its edge stays, and meets the shortcut's own wall.
      if (onShortcut(a) && onShortcut(b)) gaps.add(`${k}:${side}`);
    }
  }
  return gaps;
}

// Which wall stretches of a shortcut stand, as [left, right] for each of its segments: those with
// an end outside the main road (its road and verges, at its height), and not across the road of
// one of the `others` shortcuts, where two shortcuts meet or cross.
export function shortcutWalls(frames, branch, params, others = []) {
  const height = Math.max(400, params.wallHeight || 0);
  const ring = [...frames, frames[0]];
  const verges = (f, g, t) => [(f.hl + f.ol) * (1 - t) + (g.hl + g.ol) * t, (f.hr + f.or) * (1 - t) + (g.hr + g.or) * t];
  const road = (f, g, t) => { const half = f.half * (1 - t) + g.half * t; return [half, half]; };
  // Anywhere along it, not only at its ends: a shortcut can run beside the main road, or across it.
  // A bridge over it is above it, and keeps its walls.
  const outside = (p) => !onStrip(ring, p, verges, height);
  const onOther = (a, b) => others.some((other) => onStrip(other, a, road, height) && onStrip(other, b, road, height));
  return branch.slice(0, -1).map((f, i) => {
    const g = branch[i + 1];
    return [(outside(f.L) || outside(g.L)) && !onOther(f.L, g.L), (outside(f.R) || outside(g.R)) && !onOther(f.R, g.R)];
  });
}

// The groups of one kind of point (checkpoints, enemy or item route): a stretch of the main road
// between two places where shortcuts leave or rejoin, then the shortcuts leaving where it begins,
// and so on round the lap. Group 0 is the stretch from the start line. Each group goes on to every
// group starting where it ends, the main road first. `fill(index)` makes a point at a sample of the
// main road, for a stretch too short to hold one of its own: a group cannot be empty.
export function linkSections(makeGroup, items, indexOf, shortcuts, branchItems, fill = null) {
  const n = Infinity;
  const places = [...new Set([0, ...shortcuts.flatMap((s) => [s.i, s.j])])].sort((a, b) => a - b);
  const groups = [], startsAt = new Map(), endsAt = new Map();
  const add = (map, place, group) => { if (!map.has(place)) map.set(place, []); map.get(place).push(group); };
  const push = (points, from, to) => {
    const group = makeGroup(points);
    groups.push(group);
    add(startsAt, from, groups.length - 1); add(endsAt, to, groups.length - 1);
    return group;
  };
  places.forEach((low, k) => {
    const high = k + 1 < places.length ? places[k + 1] : n;
    let points = items.filter((item) => indexOf(item) >= low && indexOf(item) < high);
    if (!points.length && fill) points = [fill(low)];
    // The last stretch ends at the start line, where group 0 begins.
    push(points, low, high === n ? 0 : high);
    shortcuts.forEach((shortcut, s) => { if (shortcut.i === low) push(branchItems(s), shortcut.i, shortcut.j); });
  });
  groups.forEach((group, g) => {
    const end = [...endsAt].find(([, list]) => list.includes(g))[0];
    const start = [...startsAt].find(([, list]) => list.includes(g))[0];
    group.next = [...(startsAt.get(end) || [])];
    group.prev = [...(endsAt.get(start) || [])];
  });
  return groups;
}

// ---- Scenery -----------------------------------------------------------------------------------
// Objects of the game that stand still and have no collision, by track style, with a track that
// holds their model. Checked against the game's ObjFlow.bin and those tracks' files.
export const SCENERY = {
  circuit: [{ id: 0x12F, file: 'castletree1', track: 'castle_course.szs' }, { id: 0x132, file: 'castleflower1', track: 'castle_course.szs' }],
  rally: [{ id: 0x135, file: 'donkytree1GC', track: 'old_donkey_gc.szs' }, { id: 0x136, file: 'donkytree2GC', track: 'old_donkey_gc.szs' }],
  desert: [{ id: 0x145, file: 'PalmTree', track: 'shopping_course.szs' }],
  snow: [{ id: 0x163, file: 'TownTreeDS', track: 'old_town_ds.szs' }],
  castle: [{ id: 0x150, file: 'gardentreeDS', track: 'old_garden_ds.szs' }, { id: 0x154, file: 'FlagB1', track: 'truck_course.szs' }],
};
const SCENERY_SPACING = { light: 5000, dense: 2500 };
const SCENERY_LIMIT = 80; // objects cost the game memory and time

// Positions beside the road, clear of every part of it, on the ground the generator lays out.
export function placeScenery(frames, params, groundY) {
  const spacing = SCENERY_SPACING[params.scenery];
  const kinds = SCENERY[params.style] || SCENERY.circuit;
  if (!spacing || !kinds.length) return [];
  const placed = [];
  let seed = 1234567;
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  let distance = 0;
  for (let i = 0; i < frames.length && placed.length < SCENERY_LIMIT; i++) {
    const f = frames[i], g = frames[(i + 1) % frames.length];
    distance += Math.hypot(g.c[0] - f.c[0], g.c[2] - f.c[2]);
    if (distance < spacing) continue;
    distance = 0;
    const side = placed.length % 2 ? 1 : -1, reach = (side > 0 ? f.hl + f.ol : f.hr + f.or) + 1500 + random() * 4000;
    const x = f.c[0] + f.left[0] * side * reach, z = f.c[2] + f.left[1] * side * reach;
    // Not on a stretch of road the other side of a bend brings close.
    if (frames.some((other) => Math.hypot(other.c[0] - x, other.c[2] - z) < other.half + Math.max(other.ol, other.or) + 900)) continue;
    const kind = kinds[placed.length % kinds.length];
    placed.push({ kind, pos: [x, groundY, z], yaw: Math.round(random() * 360) });
  }
  return placed;
}
