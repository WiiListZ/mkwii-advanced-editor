// Checks of the route data against the track's collision: things only driving would otherwise show.
// Each was tried on the game's own tracks, which all work: a check that fired on them was tightened
// or dropped, and what still fires now and then there is only a note. So, for instance, there is no
// check for floating item boxes: the original tracks have many, over water and moving parts.

const LIFT = 120; // routes are checked this far above their points, clear of kerbs and bumps
const CELL = 1000; // the size of HeightMap's grid

// The triangles near a line, once each.
function trianglesAlong(heights, a, b) {
  const found = new Set(), length = Math.hypot(b[0] - a[0], b[2] - a[2]);
  const steps = Math.max(1, Math.ceil(length / (CELL / 2)));
  for (let i = 0; i <= steps; i++) {
    const x = a[0] + (b[0] - a[0]) * i / steps, z = a[2] + (b[2] - a[2]) * i / steps;
    const cell = heights.cells.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL));
    if (cell) for (const t of cell) found.add(t);
  }
  return found;
}

// Where a line meets a triangle, as a fraction along the line, or null.
function hitTriangle(verts, t, a, b) {
  const o = t * 9;
  const e1 = [verts[o + 3] - verts[o], verts[o + 4] - verts[o + 1], verts[o + 5] - verts[o + 2]];
  const e2 = [verts[o + 6] - verts[o], verts[o + 7] - verts[o + 1], verts[o + 8] - verts[o + 2]];
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
  const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
  if (Math.abs(det) < 1e-6) return null;
  const s = [a[0] - verts[o], a[1] - verts[o + 1], a[2] - verts[o + 2]];
  const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) / det;
  if (u < 0 || u > 1) return null;
  const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
  const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) / det;
  if (v < 0 || u + v > 1) return null;
  const hit = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det;
  return hit >= 0 && hit <= 1 ? hit : null;
}

const SOLID_WALLS = new Set([0x0C, 0x0F, 0x1E]);
export const walled = (kcl, heights, a, b) => {
  const from = [a[0], a[1] + LIFT, a[2]], to = [b[0], b[1] + LIFT, b[2]];
  for (const t of trianglesAlong(heights, from, to)) {
    if (kcl.valid && !kcl.valid[t]) continue;
    if (!SOLID_WALLS.has(kcl.flags[t] & 0x1F)) continue;
    if (hitTriangle(kcl.verts, t, from, to) !== null) return true;
  }
  return false;
};

// A wall across the way, not one a corner of the line only clips: the line and both sides of it meet it.
const WIDE = 150;
const walledAcross = (kcl, heights, a, b) => {
  const dx = b[0] - a[0], dz = b[2] - a[2], size = Math.hypot(dx, dz);
  if (size < 1) return false;
  const side = [-dz / size * WIDE, dx / size * WIDE];
  // And high enough that the kart could not go over it, for kerbs and low lips are walls too.
  return [0, 250, 500].every((up) => [0, 1, -1].every((k) => walled(kcl, heights, [a[0] + side[0] * k, a[1] + up, a[2] + side[1] * k], [b[0] + side[0] * k, b[1] + up, b[2] + side[1] * k])));
};

// Very large triangles, such as the planes kart fall onto, are left out of HeightMap's grid.
const covered = new WeakMap();
const largeTriangles = (kcl) => {
  if (covered.has(kcl)) return covered.get(kcl);
  const out = [], v = kcl.verts;
  for (let t = 0; t < kcl.count; t++) {
    const o = t * 9;
    const across = Math.max(v[o], v[o + 3], v[o + 6]) - Math.min(v[o], v[o + 3], v[o + 6]), along = Math.max(v[o + 2], v[o + 5], v[o + 8]) - Math.min(v[o + 2], v[o + 5], v[o + 8]);
    if (across * along > 3000 * CELL * CELL) out.push(t);
  }
  covered.set(kcl, out);
  return out;
};
const anyCollisionAt = (kcl, heights, x, z) => {
  if (heights.surfacesAt(x, z, false).length) return true;
  const v = kcl.verts;
  return largeTriangles(kcl).some((t) => {
    const o = t * 9, ax = v[o], az = v[o + 2], bx = v[o + 3], bz = v[o + 5], cx = v[o + 6], cz = v[o + 8];
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-9) return false;
    const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
    return l1 >= 0 && l2 >= 0 && l1 + l2 <= 1;
  });
};

const segmentsOf = (groups) => {
  const out = [];
  groups.forEach((group, g) => {
    group.points.forEach((point, i) => { if (group.points[i + 1]) out.push({ a: point, b: group.points[i + 1], group: g, index: i }); });
    const last = group.points[group.points.length - 1];
    for (const n of group.next || []) if (last && groups[n]?.points[0]) out.push({ a: last, b: groups[n].points[0], group: g, index: group.points.length - 1 });
  });
  return out;
};

// Did the line a-b cross the line c-d, on the map?
const crosses = (a, b, c, d) => {
  const side = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
};

// What each check found, by name, for trying them out. Each find: { key, text }.
export function geometryFinds(kmp, kcl, heights) {
  const finds = { enemyWall: [], itemWall: [], checkpointMissed: [], boxInWall: [], respawnFall: [], respawnWall: [], routeNoGround: [] };
  // Battle arenas have enemy points to roam between, not a way to drive: only race tracks have checkpoints.
  const racing = kmp.CKPT.length > 0, enemy = segmentsOf(kmp.ENPT);
  if (racing) for (const { a, b, group, index } of enemy) {
    if (walledAcross(kcl, heights, a.pos, b.pos)) finds.enemyWall.push({ key: b.uid, text: `Enemy route ${group}, after point ${index}, seems to go through a wall: CPU karts can get stuck there.` });
  }
  if (racing) for (const { a, b, group, index } of segmentsOf(kmp.ITPT)) {
    if (walledAcross(kcl, heights, a.pos, b.pos)) finds.itemWall.push({ key: b.uid, text: `Item route ${group}, after point ${index}, seems to go through a wall: shells may stop there.` });
  }
  // A checkpoint no enemy route passes through, on the map.
  kmp.CKPT.forEach((group, g) => group.points.forEach((cp, i) => {
    const passed = enemy.some(({ a, b }) => crosses([a.pos[0], a.pos[2]], [b.pos[0], b.pos[2]], cp.left, cp.right));
    if (!passed && enemy.length) finds.checkpointMissed.push({ key: cp.uid, text: `Checkpoint ${i} of group ${g} is not on the enemy route: it may not cover the road.` });
  }));
  for (const box of kmp.GOBJ.filter((object) => object.objectId === 0x65)) {
    const [x, y, z] = box.pos;
    // A short cross through the box's middle.
    const reach = 40;
    if ([[reach, 0], [0, reach]].some(([dx, dz]) => walled(kcl, heights, [x - dx, y - LIFT, z - dz], [x + dx, y - LIFT, z + dz]))) finds.boxInWall.push({ key: box.uid, text: 'An item box is inside a wall.' });
  }
  kmp.JGPT.forEach((point, i) => {
    const [x, y, z] = point.pos;
    const under = heights.surfacesAt(x, z, false).filter((surface) => surface.y <= y + 500).sort((one, two) => two.y - one.y)[0];
    if (under && (kcl.flags[under.tri] & 0x1F) === 0x10) finds.respawnFall.push({ key: point.uid, text: `Respawn ${i} is over a fall boundary: the kart drops back off the track.` });
    else if (under && (kcl.flags[under.tri] & 0x1F) === 0x0A) finds.respawnFall.push({ key: point.uid, text: `Respawn ${i} is over lava or sand that takes the kart out.` });
    // Facing a wall straight ahead.
    const heading = (point.rot?.[1] || 0) * Math.PI / 180, ahead = 500;
    if (walled(kcl, heights, [x, y, z], [x + Math.sin(heading) * ahead, y, z + Math.cos(heading) * ahead])) finds.respawnWall.push({ key: point.uid, text: `Respawn ${i} faces a wall close ahead.` });
  });
  // A long stretch of route with no ground of any kind under it.
  for (const { a, b, group, index } of enemy) {
    const length = Math.hypot(b.pos[0] - a.pos[0], b.pos[2] - a.pos[2]);
    if (length < 2000) continue;
    const steps = Math.ceil(length / 300);
    let open = 0, worst = 0;
    for (let i = 0; i <= steps; i++) {
      const x = a.pos[0] + (b.pos[0] - a.pos[0]) * i / steps, z = a.pos[2] + (b.pos[2] - a.pos[2]) * i / steps;
      if (anyCollisionAt(kcl, heights, x, z)) open = 0; else { open += length / steps; worst = Math.max(worst, open); }
    }
    if (worst >= 2000) finds.routeNoGround.push({ key: b.uid, text: `Enemy route ${group}, after point ${index}, has ${Math.round(worst)} units with no collision under it.` });
  }
  return finds;
}

const LEVELS = { enemyWall: 'warning', itemWall: 'info', checkpointMissed: 'info', boxInWall: 'warning', respawnFall: 'warning', respawnWall: 'warning', routeNoGround: 'info' };
const SHOWN = 6; // of each kind: a track with more has one problem many times

// Cached: it runs on every change, and most changes do not touch routes.
const cache = new WeakMap();
export function geometryIssues(doc) {
  const { kmp, kcl, heights } = doc;
  if (!kcl || !heights) return [];
  const where = (list) => list.map((point) => point.pos ? point.pos.join() : `${point.left}|${point.right}`).join(';');
  const signature = [kmp.ENPT, kmp.ITPT, kmp.CKPT].map((groups) => groups.map((group) => `${where(group.points)}>${group.next}`).join('/'))
    .concat(where(kmp.JGPT), kmp.JGPT.map((point) => point.rot).join(';'), where(kmp.GOBJ.filter((object) => object.objectId === 0x65))).join('#');
  const known = cache.get(kcl);
  if (known?.signature === signature) return known.issues;
  const finds = geometryFinds(kmp, kcl, heights), issues = [];
  for (const [kind, list] of Object.entries(finds)) {
    for (const find of list.slice(0, SHOWN)) issues.push({ level: LEVELS[kind], msg: find.text, key: find.key });
    if (list.length > SHOWN) issues.push({ level: LEVELS[kind], msg: `And ${list.length - SHOWN} more like this.`, key: list[SHOWN].key });
  }
  cache.set(kcl, { signature, issues });
  return issues;
}
