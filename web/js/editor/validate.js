// Track validator: finds problems that crash the game or break races, with quick fixes where possible.

import { parseBRRES } from '../formats/brres.js';
import { findFile } from '../formats/u8.js';

const segCross = (a, b, c, d) => {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
};

// Track model animations: a CHR0 that moves bones missing from the model can crash the game,
// and Mario Kart Wii plays at most 8 SRT0 animations. Cached per course_model.brres buffer.
const animationIssueCache = new WeakMap();
function trackModelAnimationIssues(szs) {
  const node = szs && findFile(szs, 'course_model.brres');
  if (!node?.data) return [];
  if (animationIssueCache.has(node.data)) return animationIssueCache.get(node.data);
  const out = [];
  try {
    const brres = parseBRRES(node.data);
    const model = brres.models.find((m) => m.name === 'course') || brres.models[0];
    const bones = new Set(model?.bones.map((b) => b.name));
    for (const chr of brres.chr.values()) {
      const missing = [...chr.bones.keys()].filter((name) => !bones.has(name));
      if (missing.length) out.push(['error', `Track model animation ${chr.name} moves bones the model does not have (${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}): the game may crash. Delete it from the Track model list.`]);
    }
    if (brres.srt.size > 8) out.push(['warning', `course_model.brres has ${brres.srt.size} texture animations (SRT0); Mario Kart Wii plays at most 8.`]);
  } catch { /* unreadable models are reported elsewhere */ }
  animationIssueCache.set(node.data, out);
  return out;
}

export function validate(doc, ops, objectNames) {
  const k = doc.kmp;
  const issues = [];
  const add = (level, msg, key = null, fix = null) => issues.push({ level, msg, key: key !== null ? String(key) : null, fix });
  for (const [level, msg] of trackModelAnimationIssues(doc.szs)) add(level, msg);

  // Stage info
  const st = k.STGI[0];
  if (!st) add('error', 'Missing stage info (STGI).');
  else if (st.laps < 1 || st.laps > 9) add('warning', `Lap count ${st.laps} is unusual (1-9 expected).`, st.uid);

  // Start positions
  if (!k.KTPT.length) add('error', 'No start position (KTPT): the game cannot place the karts.', null, { label: 'Add at view center', run: () => ops.add('KTPT', ops.settings.viewCenter()) });

  // Grouped routes
  const groupChecks = (kind, label, required, emptyFix = null) => {
    const groups = k[kind];
    if (!groups.length) {
      if (required) add('error', `${label}: no groups. ${kind === 'CKPT' ? 'Lap counting will not work.' : 'CPUs/items will not know where to go.'}`, null, emptyFix);
      return;
    }
    const total = groups.reduce((s, g) => s + g.points.length, 0);
    if (total > 255) add('error', `${label}: ${total} points (maximum 255).`);
    if (groups.length > 255) add('error', `${label}: too many groups (${groups.length}).`);
    groups.forEach((g, gi) => {
      if (!g.points.length) add('error', `${label}: group ${gi} is empty.`, g.uid);
      if (g.prev.length > 6 || g.next.length > 6) add('error', `${label}: group ${gi} has more than 6 links.`, g.uid);
      for (const v of [...g.prev, ...g.next]) if (v >= groups.length) add('error', `${label}: group ${gi} links to missing group ${v}.`, g.uid);
      if (!g.next.length) add('warning', `${label}: group ${gi} has no "next" group (dead end).`, g.uid, { label: 'Link groups in sequence', run: () => ops.autoLinkGroups(kind) });
      if (!g.prev.length) add('warning', `${label}: group ${gi} has no "previous" group.`, g.uid, { label: 'Link groups in sequence', run: () => ops.autoLinkGroups(kind) });
      // Symmetric links
      for (const n of g.next) if (groups[n] && !groups[n].prev.includes(gi)) add('warning', `${label}: group ${gi} → ${n} but group ${n} does not list ${gi} as previous.`, g.uid);
    });
  };
  groupChecks('ENPT', 'Enemy routes', true);
  groupChecks('ITPT', 'Item routes', true, k.ENPT.length ? { label: 'Copy from enemy routes', run: () => ops.itemRouteFromEnemy() } : null);
  groupChecks('CKPT', 'Checkpoints', true, k.ENPT.length ? { label: 'Generate from enemy routes', run: () => ops.checkpointsFromEnemy({ every: 2 }) } : null);

  // Checkpoints
  const allCk = k.CKPT.flatMap((g) => g.points);
  if (allCk.length) {
    const laps = allCk.filter((c) => c.type === 0);
    if (!laps.length) add('error', 'No lap checkpoint (type 0): laps will never be counted.', allCk[0].uid, {
      label: 'Make the first checkpoint the lap checkpoint', run: () => doc.change('Lap checkpoint', () => { allCk[0].type = 0; }),
    });
    else if (k.CKPT[0].points[0]?.type !== 0) add('warning', 'The first checkpoint of the first group is not the lap checkpoint.', k.CKPT[0].points[0]?.uid);
    if (laps.length > 1) add('info', `${laps.length} lap checkpoints (normally only one).`, laps[1].uid);
    const keys = [...new Set(allCk.filter((c) => c.type !== 0 && c.type !== 0xFF).map((c) => c.type))].sort((a, b) => a - b);
    keys.forEach((t, i) => { if (t !== i + 1) add('warning', `Key checkpoints are not sequential (found ${t}, expected ${i + 1}).`); });
    if (!keys.length && allCk.length > 4) add('info', 'No key checkpoints: players may take shortcuts without penalty.');
    if (!k.JGPT.length) add('error', 'No respawn points (JGPT): falling off the track will crash or soft-lock.', null, {
      label: 'Create respawns from checkpoints', run: () => ops.respawnsFromCheckpoints(4),
    });
    for (const cp of allCk) {
      if (k.JGPT.length && cp.respawn >= k.JGPT.length) add('error', `Checkpoint uses missing respawn ${cp.respawn}.`, cp.uid, { label: 'Reassign respawns', run: () => ops.assignRespawns() });
      const w = Math.hypot(cp.right[0] - cp.left[0], cp.right[1] - cp.left[1]);
      if (w < 100) add('warning', 'Checkpoint is extremely narrow.', cp.uid);
    }
    // Quads between consecutive checkpoints must not be crossed (bow-tie) and must face the same way.
    k.CKPT.forEach((g, gi) => {
      g.points.forEach((cp, i) => {
        const nx = g.points[i + 1];
        if (!nx) return;
        if (segCross(cp.left, nx.left, cp.right, nx.right) || segCross(cp.left, cp.right, nx.left, nx.right)) {
          add('error', `Crossed checkpoints in group ${gi} (${i} → ${i + 1}): the quad between them is twisted.`, nx.uid);
        }
        const d1 = [cp.right[0] - cp.left[0], cp.right[1] - cp.left[1]], d2 = [nx.right[0] - nx.left[0], nx.right[1] - nx.left[1]];
        if (d1[0] * d2[0] + d1[1] * d2[1] < 0) add('error', `Checkpoint ${i + 1} of group ${gi} faces the opposite way from the previous one.`, nx.uid, {
          label: 'Swap left/right of this checkpoint', run: () => { doc.select(nx.uid); ops.swapCheckpointSides(true); },
        });
      });
    });
    // Orientation vs enemy route: checkpoints must face the driving direction.
    if (k.ENPT.length) {
      let against = 0, total = 0;
      for (const cp of allCk) {
        const mx = (cp.left[0] + cp.right[0]) / 2, mz = (cp.left[1] + cp.right[1]) / 2;
        const dir = ops.nearestEnemyDir(mx, mz);
        if (!dir) continue;
        const fx = cp.right[1] - cp.left[1], fz = -(cp.right[0] - cp.left[0]);
        total++;
        if (fx * dir[0] + fz * dir[1] < 0) against++;
      }
      if (total && against > total / 2) add('error', `${against}/${total} checkpoints face against the enemy route: left and right are probably swapped.`, null, {
        label: 'Swap left/right of all checkpoints', run: () => ops.swapCheckpointSides(false),
      });
    }
  }

  // Objects
  const routeCount = k.POTI.length;
  k.GOBJ.forEach((o) => {
    if (o.route !== 0xFFFF && o.route >= routeCount) add('error', `Object uses missing route ${o.route}.`, o.uid);
    if (objectNames && Object.keys(objectNames).length > 5 && !objectNames[o.objectId]) add('warning', `Unknown object ID 0x${o.objectId.toString(16)}.`, o.uid);
  });
  if (k.GOBJ.length > 1000) add('warning', `${k.GOBJ.length} objects: may cause lag or memory problems.`);
  if (!k.GOBJ.some((o) => o.objectId === 0x65)) add('info', 'No item boxes on the track.');

  k.POTI.forEach((r, i) => { if (r.points.length < 2) add('error', `Route ${i} has fewer than 2 points.`, r.uid); });

  k.AREA.forEach((a) => {
    if (a.camera !== 0xFF && a.camera >= k.CAME.length) add('error', `Area links missing camera ${a.camera}.`, a.uid);
    if (a.route !== 0xFF && a.route >= routeCount) add('error', `Area links missing route ${a.route}.`, a.uid);
  });
  k.CAME.forEach((c) => {
    if (c.next !== 0xFF && c.next >= k.CAME.length) add('error', `Camera links missing next camera ${c.next}.`, c.uid);
    if (c.route !== 0xFF && c.route >= routeCount) add('error', `Camera uses missing route ${c.route}.`, c.uid);
  });
  if (!k.CAME.length) add('warning', 'No cameras: the intro and the replay/goal camera will not work properly.');

  k.JGPT.forEach((j, i) => { if (j.id !== i) add('info', `Respawn ${i} has ID ${j.id} (usually equal to the index).`, j.uid, { label: 'Renumber IDs', run: () => ops.renumberIds() }); });

  // Collision
  if (!doc.kcl) add('warning', 'No collision (course.kcl) loaded.');
  else {
    if (doc.kcl.count > 65534) add('error', 'Too many collision triangles for a KCL.');
    if (doc.heights) {
      for (const s of k.KTPT) {
        const y = doc.heights.groundBelow(s.pos[0], s.pos[2], s.pos[1] + 200, 0);
        if (y === null) add('warning', 'Start position has no road below it.', s.uid);
      }
      for (const j of k.JGPT) {
        const y = doc.heights.groundBelow(j.pos[0], j.pos[2], j.pos[1] + 500, 0);
        if (y === null) add('warning', 'Respawn point has no ground below it.', j.uid);
      }
    }
  }
  return issues;
}
