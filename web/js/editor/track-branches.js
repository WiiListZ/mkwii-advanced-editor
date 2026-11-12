// Shortcuts of the track generator, and the scenery it can place beside the road.
//
// A shortcut leaves the road at one point and rejoins it further on. Routes and checkpoints split
// there into groups, the way the game's own branching tracks do it:
//   A0 -> (main stretch | shortcut) -> A1 -> ... -> A0
// Lap and key checkpoints stay in the A groups, which every driver goes through.

const SHORTCUT_WIDTH = .8; // of the road's width
const MIN_GAP = .02; // of the lap, between the start line, shortcuts and their ends

// Stretch of road between two points, leaving and arriving along the road's own direction.
function hermite(a, ta, b, tb, t) {
  const t2 = t * t, t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
  return [0, 1].map((k) => h00 * a[k] + h10 * ta[k] + h01 * b[k] + h11 * tb[k]);
}

// The frames of one shortcut: centre, direction, left normal and edges, with heights blended
// between the two ends. Raised a little so its road never shares a plane with the main road.
function shortcutFrames(start, end, via, step, half) {
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
  return {
    length: total,
    frames: points.map((p, i) => {
      const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, t = [(b[0] - a[0]) / length, (b[1] - a[1]) / length], left = [t[1], -t[0]];
      const blend = i / (points.length - 1), y = start.c[1] + (end.c[1] - start.c[1]) * blend + 2;
      const at = (d) => [p[0] + left[0] * d, y, p[1] + left[1] * d];
      return { c: [p[0], y, p[1]], t, left, half, hl: half, hr: half, ol: 0, or: 0, L: at(half), R: at(-half), LO: at(half), RO: at(-half) };
    }),
  };
}

// Shortcuts from their settings: { from, to, via } with from and to as fractions of the lap. Those
// that cannot work are left out, and said why.
export function buildShortcuts(frames, params) {
  const n = frames.length, problems = [], chosen = [];
  const list = [...(params.shortcuts || [])].filter((s) => Number.isFinite(s?.from) && Number.isFinite(s?.to)).sort((a, b) => Math.min(a.from, a.to) - Math.min(b.from, b.to));
  let lastEnd = MIN_GAP;
  for (const shortcut of list) {
    const from = Math.min(shortcut.from, shortcut.to), to = Math.max(shortcut.from, shortcut.to);
    const reversed = shortcut.from > shortcut.to;
    if (from < lastEnd || to > 1 - MIN_GAP || to - from < MIN_GAP * 2) { problems.push('A shortcut is too close to the start line or to another one, and was left out.'); continue; }
    const i = Math.round(from * n) % n, j = Math.round(to * n) % n;
    const via = (shortcut.via || []).filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.z));
    const half = params.roadWidth * SHORTCUT_WIDTH / 2;
    const built = shortcutFrames(frames[i], frames[j], reversed ? [...via].reverse() : via, params.step, half);
    // As steep as the road may be; heights are blended, so the two ends alone decide this.
    if (Math.abs(frames[j].c[1] - frames[i].c[1]) > built.length * .4) { problems.push('A shortcut is too steep for its length, and was left out.'); continue; }
    chosen.push({ i, j, ...built });
    lastEnd = to + MIN_GAP;
  }
  return { shortcuts: chosen, problems };
}

// Wall stretches of the main road a shortcut must pass through, as `${segment}:${side}`.
export function shortcutWallGaps(frames, shortcuts, params) {
  const gaps = new Set();
  for (const { frames: branch } of shortcuts) {
    const reach = Math.max(4, Math.ceil(params.roadWidth * 3 / params.step));
    const ends = [...branch.slice(0, reach), ...branch.slice(-reach)];
    frames.forEach((f, k) => {
      for (const [side, edge] of [[1, f.LO], [-1, f.RO]]) {
        if (ends.some((p) => Math.hypot(p.c[0] - edge[0], p.c[2] - edge[2]) < p.half + 500)) gaps.add(`${k}:${side}`);
      }
    });
  }
  return gaps;
}

// Which section each sample belongs to: section 0 is A0, then main 1, shortcut 1, A1, and so on.
export function linkSections(makeGroup, items, indexOf, shortcuts, branchItems) {
  const groups = [];
  const take = (low, high) => items.filter((item) => indexOf(item) >= low && indexOf(item) < high);
  const push = (points) => { const group = makeGroup(points); groups.push(group); return groups.length - 1; };
  const first = push(take(0, shortcuts[0].i));
  let previous = first;
  shortcuts.forEach((shortcut, s) => {
    const main = push(take(shortcut.i, shortcut.j)), branch = push(branchItems(s));
    const next = shortcuts[s + 1];
    const after = push(take(shortcut.j, next ? next.i : Infinity));
    groups[previous].next = [main, branch];
    groups[main].prev = [previous]; groups[branch].prev = [previous];
    groups[main].next = [after]; groups[branch].next = [after];
    groups[after].prev = [main, branch];
    previous = after;
  });
  groups[previous].next = [first];
  groups[first].prev = [previous];
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
