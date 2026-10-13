// Editing operations: add, delete, duplicate and the automatic helper tools.
// Everything that removes entries also remaps the indices that point at them
// (group links, checkpoint respawns, object/area/camera routes, camera links).

import { make } from '../formats/kmp.js';
import { GROUPED, FLAT } from './document.js';
import { turnYaw } from './heading.js';

const yawFromDir = (dx, dz) => Math.round((Math.atan2(dx, dz) * 180) / Math.PI * 100) / 100;

// Removes indices from a reference list and shifts the remaining ones down.
function remapList(values, removed) {
  return values.filter((v) => !removed.has(v)).map((v) => v - [...removed].filter((r) => r < v).length);
}
function remapValue(v, removed, none) {
  if (v === none) return v;
  if (removed.has(v)) return none;
  return v - [...removed].filter((r) => r < v).length;
}

// Centre of copied entries (used to paste them around a target point).
export function copiesCenter(entries) {
  let x = 0, y = 0, z = 0, n = 0;
  const add = (it) => {
    if (it.points) return it.points.forEach(add);
    if (it.left) { x += (it.left[0] + it.right[0]) / 2; z += (it.left[1] + it.right[1]) / 2; n++; return; }
    if (it.pos) { x += it.pos[0]; y += it.pos[1]; z += it.pos[2]; n++; }
  };
  for (const e of entries) add(e.item);
  return n ? [x / n, y / n, z / n] : null;
}

export class Ops {
  constructor(doc, settings) {
    this.doc = doc;
    this.settings = settings; // { checkpointWidth, iconSize }
  }

  get k() { return this.doc.kmp; }

  // ---- Helpers ----------------------------------------------------------------
  nearestEnemyDir(x, z) {
    let best = null, bd = Infinity;
    for (const g of this.k.ENPT) {
      g.points.forEach((p, i) => {
        const d = (p.pos[0] - x) ** 2 + (p.pos[2] - z) ** 2;
        if (d < bd) {
          bd = d;
          const n = g.points[i + 1] || (g.next.length ? this.k.ENPT[g.next[0]]?.points[0] : null);
          const pv = g.points[i - 1];
          const a = pv ? pv.pos : p.pos, b = n ? n.pos : p.pos;
          best = [b[0] - a[0], b[2] - a[2]];
        }
      });
    }
    if (!best || (best[0] === 0 && best[1] === 0)) return null;
    const l = Math.hypot(best[0], best[1]);
    return [best[0] / l, best[1] / l];
  }

  nearestRespawn(x, z) {
    let best = 0, bd = Infinity;
    this.k.JGPT.forEach((j, i) => {
      const d = (j.pos[0] - x) ** 2 + (j.pos[2] - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  // Measures the drivable road around a point: walks sideways until the ground disappears or jumps.
  roadHalfWidth(x, y, z, dirX, dirZ, max = 6000) {
    const hm = this.doc.heights;
    if (!hm) return null;
    let lastY = y, dist = 0;
    for (let d = 100; d <= max; d += 100) {
      const px = x + dirX * d, pz = z + dirZ * d;
      const g = hm.groundBelow(px, pz, lastY + 400, 0);
      if (g === null || Math.abs(g - lastY) > 400) break;
      lastY = g;
      dist = d;
    }
    return dist || null;
  }

  // ---- Adding -------------------------------------------------------------------
  // Adds an entity of the given kind at a world point. Returns the new selection key.
  add(kind, point, extra = {}) {
    const doc = this.doc, k = this.k;
    const primary = doc.primary;
    const p = [...point];
    let newKey = null;

    doc.change(`Add ${kind}`, () => {
      switch (kind) {
        case 'ENPT':
        case 'ITPT':
        case 'CKPT': {
          let item;
          if (kind === 'CKPT') item = this.makeCheckpointAt(p, primary);
          else item = make[kind](p);
          if (kind !== 'CKPT' && this.settings.pathWidth) item.width = this.settings.pathWidth;
          const groups = k[kind];
          if (primary?.kind === kind) primary.group.points.splice(primary.index + 1, 0, item);
          else if (primary?.kind === 'GROUP' && primary.section === kind) primary.item.points.push(item);
          else if (groups.length) groups[groups.length - 1].points.push(item);
          else {
            const g = make.group([item]);
            g.prev = [0];
            g.next = [0];
            groups.push(g);
          }
          if (kind === 'CKPT' && k.CKPT.length === 1 && k.CKPT[0].points.length === 1) item.type = 0;
          newKey = item.uid;
          break;
        }
        case 'POTI': {
          const pt = make.routePoint(p);
          if (primary?.kind === 'POTI') primary.route.points.splice(primary.index + 1, 0, pt);
          else if (primary?.kind === 'ROUTE') primary.item.points.push(pt);
          else k.POTI.push(make.route([pt]));
          newKey = pt.uid;
          break;
        }
        case 'GOBJ': {
          const o = make.GOBJ(extra.objectId ?? 0x65, p);
          k.GOBJ.push(o);
          newKey = o.uid;
          break;
        }
        case 'JGPT': {
          const dir = this.nearestEnemyDir(p[0], p[2]);
          const j = make.JGPT(p, [0, dir ? yawFromDir(dir[0], dir[1]) : 0, 0]);
          j.id = k.JGPT.length;
          k.JGPT.push(j);
          newKey = j.uid;
          break;
        }
        case 'KTPT': {
          const dir = this.nearestEnemyDir(p[0], p[2]);
          const e = make.KTPT(p, [0, dir ? yawFromDir(dir[0], dir[1]) : 0, 0]);
          k.KTPT.push(e);
          newKey = e.uid;
          break;
        }
        case 'CNPT': case 'MSPT': {
          const e = make[kind](p);
          e.id = k[kind].length;
          k[kind].push(e);
          newKey = e.uid;
          break;
        }
        case 'AREA': case 'CAME': {
          const e = make[kind](p);
          if (kind === 'CAME') { e.pos[1] += 1500; e.viewStart = [...p]; e.viewEnd = [...p]; }
          k[kind].push(e);
          newKey = e.uid;
          break;
        }
      }
      doc.invalidate();
      if (newKey) doc.selection = new Set([String(newKey)]);
    });
    doc.emit('selection');
    return newKey;
  }

  makeCheckpointAt(p, primary) {
    const k = this.k;
    // Direction: from the previous checkpoint, else the nearest enemy route, else +Z.
    let dir = null;
    let prev = primary?.kind === 'CKPT' ? primary.item : null;
    if (!prev && k.CKPT.length) { const g = k.CKPT[k.CKPT.length - 1]; prev = g.points[g.points.length - 1]; }
    if (prev) {
      const mx = (prev.left[0] + prev.right[0]) / 2, mz = (prev.left[1] + prev.right[1]) / 2;
      const dx = p[0] - mx, dz = p[2] - mz, l = Math.hypot(dx, dz);
      if (l > 1) dir = [dx / l, dz / l];
    }
    dir ||= this.nearestEnemyDir(p[0], p[2]) || [0, 1];
    // Left = up x forward in a right-handed, Y-up world.
    const left = [dir[1], -dir[0]];
    let wl = this.settings.checkpointWidth / 2, wr = wl;
    if (this.settings.autoCheckpointWidth) {
      wl = this.roadHalfWidth(p[0], p[1], p[2], left[0], left[1]) ?? wl;
      wr = this.roadHalfWidth(p[0], p[1], p[2], -left[0], -left[1]) ?? wr;
    }
    const cp = make.CKPT([p[0] + left[0] * wl, p[2] + left[1] * wl], [p[0] - left[0] * wr, p[2] - left[1] * wr]);
    cp.respawn = this.nearestRespawn(p[0], p[2]);
    return cp;
  }

  addGroup(kind, at = null) {
    const doc = this.doc;
    let key;
    doc.change(`New ${kind} group`, () => {
      if (kind === 'POTI') {
        const c = at ?? this.settings.viewCenter();
        const r = make.route([make.routePoint(c), make.routePoint([c[0] + 1000, c[1], c[2]])]);
        this.k.POTI.push(r);
        key = r.uid;
      } else {
        const g = make.group([]);
        this.k[kind].push(g);
        key = g.uid;
      }
      doc.invalidate();
      doc.selection = new Set([String(key)]);
    });
    doc.emit('selection');
  }

  // ---- Deleting ------------------------------------------------------------------
  deleteSelection() {
    const doc = this.doc;
    const infos = doc.selectedInfos();
    if (!infos.length) return 0;
    doc.change('Delete', () => {
      const k = this.k;
      const removePoints = new Set(), removeGroups = { ENPT: new Set(), ITPT: new Set(), CKPT: new Set() };
      const removeFlat = Object.fromEntries(FLAT.map((f) => [f, new Set()]));
      const removeRoutes = new Set();
      for (const info of infos) {
        if (info.kind === 'GROUP') removeGroups[info.section].add(info.index);
        else if (info.kind === 'ROUTE') removeRoutes.add(info.index);
        else if (GROUPED.includes(info.kind) || info.kind === 'POTI') removePoints.add(info.item.uid);
        else if (FLAT.includes(info.kind)) removeFlat[info.kind].add(info.index);
      }
      // Points inside groups/routes; groups that become empty are removed as well.
      for (const kind of GROUPED) {
        k[kind].forEach((g, gi) => {
          g.points = g.points.filter((p) => !removePoints.has(p.uid));
          if (!g.points.length && !removeGroups[kind].has(gi) && infos.some((i) => i.group === g)) removeGroups[kind].add(gi);
        });
      }
      k.POTI.forEach((r, ri) => {
        const before = r.points.length;
        r.points = r.points.filter((p) => !removePoints.has(p.uid));
        if (!r.points.length && before) removeRoutes.add(ri);
      });
      for (const kind of GROUPED) this.removeGroups(kind, removeGroups[kind]);
      this.removeRoutes(removeRoutes);
      for (const kind of FLAT) this.removeFlat(kind, removeFlat[kind]);
      doc.selection.clear();
      doc.invalidate();
    });
    doc.emit('selection');
    return infos.length;
  }

  removeGroups(kind, removed) {
    if (!removed.size) return;
    const k = this.k;
    k[kind] = k[kind].filter((_, i) => !removed.has(i));
    for (const g of k[kind]) { g.prev = remapList(g.prev, removed); g.next = remapList(g.next, removed); }
  }

  removeRoutes(removed) {
    if (!removed.size) return;
    const k = this.k;
    k.POTI = k.POTI.filter((_, i) => !removed.has(i));
    for (const o of k.GOBJ) o.route = remapValue(o.route, removed, 0xFFFF);
    for (const a of k.AREA) a.route = remapValue(a.route, removed, 0xFF);
    for (const c of k.CAME) c.route = remapValue(c.route, removed, 0xFF);
  }

  removeFlat(kind, removed) {
    if (!removed.size) return;
    const k = this.k;
    k[kind] = k[kind].filter((_, i) => !removed.has(i));
    if (kind === 'JGPT') for (const g of k.CKPT) for (const cp of g.points) cp.respawn = Math.max(0, remapValue(cp.respawn, removed, 0) ?? 0);
    if (kind === 'CAME') {
      for (const a of k.AREA) a.camera = remapValue(a.camera, removed, 0xFF);
      for (const c of k.CAME) c.next = remapValue(c.next, removed, 0xFF);
      // Section header: first intro camera (high byte) and selection screen camera (low byte).
      const header = k.extras?.CAME ?? 0;
      const intro = remapValue((header >> 8) & 0xFF, removed, 0xFF), selection = remapValue(header & 0xFF, removed, 0xFF);
      k.extras = { ...(k.extras || {}), CAME: ((intro & 0xFF) << 8) | (selection & 0xFF) };
    }
  }

  // ---- Copy, paste and duplicate --------------------------------------------------
  // Detached copies of the selected entities. A checkpoint end ("uid:L") copies the whole
  // checkpoint, and points are skipped when their group or route is copied too.
  copySelection() {
    const doc = this.doc;
    const infos = [], seen = new Set();
    for (const key of doc.selection) {
      const info = doc.resolve(String(key).split(':')[0]);
      if (!info || info.kind === 'STGI' || seen.has(info.item.uid)) continue;
      seen.add(info.item.uid);
      infos.push(info);
    }
    const parents = new Set(infos.filter((i) => i.kind === 'GROUP' || i.kind === 'ROUTE').map((i) => i.item.uid));
    return infos
      .filter((i) => !(i.group && parents.has(i.group.uid)) && !(i.route && parents.has(i.route.uid)))
      .map((i) => ({ kind: i.kind, section: i.section || null, item: structuredClone(i.item), after: i.item.uid }));
  }

  // Inserts fresh copies moved by `delta` ([dx, dy, dz]); route points go after their original
  // when it still exists, otherwise at the end of the last group or route. Returns the number added.
  pasteCopies(entries, delta, label = 'Paste') {
    const doc = this.doc, k = this.k;
    const [dx, dy, dz] = delta;
    const shift = (it) => {
      const move = (v) => [v[0] + dx, v[1] + dy, v[2] + dz];
      if (it.pos) it.pos = move(it.pos);
      // Opening cameras look at world points; the others store offsets from the kart.
      if (it.viewStart && (it.type === 5 || it.type === 6)) { it.viewStart = move(it.viewStart); it.viewEnd = move(it.viewEnd); }
      if (it.left) { it.left = [it.left[0] + dx, it.left[1] + dz]; it.right = [it.right[0] + dx, it.right[1] + dz]; }
      if (it.points) it.points.forEach(shift);
    };
    const newKeys = [];
    doc.change(label, () => {
      for (const entry of entries) {
        const copy = doc.cloneEntity(entry.item);
        shift(copy);
        const original = doc.index().get(entry.after);
        if (entry.kind === 'GROUP') { copy.prev = []; copy.next = []; k[entry.section].push(copy); }
        else if (entry.kind === 'ROUTE') k.POTI.push(copy);
        else if (GROUPED.includes(entry.kind) || entry.kind === 'POTI') {
          if (entry.kind === 'CKPT') copy.type = 0xFF;
          if (original?.kind === entry.kind) original.list.splice(original.list.indexOf(original.item) + 1, 0, copy);
          else {
            const groups = entry.kind === 'POTI' ? k.POTI : k[entry.kind];
            if (!groups.length) groups.push(entry.kind === 'POTI' ? make.route([]) : make.group([]));
            groups[groups.length - 1].points.push(copy);
          }
        } else if (FLAT.includes(entry.kind)) {
          // Appended: other sections refer to cameras, areas and respawns by index.
          if (entry.kind === 'CAME') copy.next = 0xFF;
          k[entry.kind].push(copy);
        } else continue;
        doc.invalidate();
        newKeys.push(String(copy.uid));
      }
      doc.invalidate();
      doc.selection = new Set(newKeys);
    });
    doc.emit('selection');
    return newKeys.length;
  }

  // `offset` is the X/Z distance of the copies from the originals (the 2D map passes one that
  // is visible at its zoom level).
  duplicateSelection(offset = (this.settings.iconSize || 150) * 4) {
    const entries = this.copySelection();
    if (!entries.length) return 0;
    return this.pasteCopies(entries, [offset, 0, offset], 'Duplicate');
  }

  // Turns the selected elements around the vertical axis (each around itself).
  rotateSelectionYaw(delta) {
    const doc = this.doc;
    const infos = doc.selectedInfos({ expandGroups: true }).filter((i) => i.item.rot);
    if (!infos.length) return 0;
    doc.change('Rotate', () => { for (const info of infos) info.item.rot = turnYaw(info.item.rot, delta); }, { structural: false });
    return infos.length;
  }

  // ---- Tools -----------------------------------------------------------------------
  snapSelectionToGround() {
    const doc = this.doc;
    if (!doc.heights) return 0;
    let n = 0;
    doc.change('Snap to ground', () => {
      for (const info of doc.selectedInfos({ expandGroups: true })) {
        const p = info.item.pos;
        if (!p) continue;
        const y = doc.heights.groundBelow(p[0], p[2], p[1] + 1000, 0) ?? doc.heights.heightAt(p[0], p[2]);
        if (y !== null) { p[1] = info.kind === 'JGPT' ? y + 0 : y; n++; }
      }
    }, { structural: false });
    return n;
  }

  // Links groups as one loop: 0 -> 1 -> ... -> n-1 -> 0.
  autoLinkGroups(kind) {
    this.doc.change('Link groups in sequence', () => {
      const groups = this.k[kind];
      const n = groups.length;
      groups.forEach((g, i) => { g.next = [(i + 1) % n]; g.prev = [(i - 1 + n) % n]; });
    });
  }

  itemRouteFromEnemy() {
    this.doc.change('Item route from enemy route', () => {
      this.k.ITPT = this.k.ENPT.map((g) => ({
        ...make.group(g.points.map((p) => ({ ...make.ITPT([...p.pos]), width: p.width }))),
        prev: [...g.prev], next: [...g.next],
      }));
    });
  }

  enemyRouteFromItem() {
    this.doc.change('Enemy route from item route', () => {
      this.k.ENPT = this.k.ITPT.map((g) => ({
        ...make.group(g.points.map((p) => ({ ...make.ENPT([...p.pos]), width: p.width }))),
        prev: [...g.prev], next: [...g.next],
      }));
    });
  }

  // Creates checkpoints across the enemy route. every = use one enemy point out of N.
  checkpointsFromEnemy({ every = 1, width = 3000, auto = true, keyCount = 3 }) {
    const k = this.k;
    this.doc.change('Checkpoints from enemy route', () => {
      k.CKPT = k.ENPT.map((g, gi) => {
        const pts = [];
        g.points.forEach((p, i) => {
          if (i % every !== 0) return;
          const nxt = g.points[i + 1] || k.ENPT[g.next[0]]?.points[0];
          const prv = g.points[i - 1] || (() => { const pg = k.ENPT[g.prev[0]]; return pg?.points[pg.points.length - 1]; })();
          const a = prv ? prv.pos : p.pos, b = nxt ? nxt.pos : p.pos;
          let dx = b[0] - a[0], dz = b[2] - a[2];
          const l = Math.hypot(dx, dz) || 1;
          dx /= l; dz /= l;
          const left = [dz, -dx];
          let wl = width / 2, wr = width / 2;
          if (auto) {
            wl = this.roadHalfWidth(p.pos[0], p.pos[1], p.pos[2], left[0], left[1]) ?? wl;
            wr = this.roadHalfWidth(p.pos[0], p.pos[1], p.pos[2], -left[0], -left[1]) ?? wr;
          }
          const cp = make.CKPT([p.pos[0] + left[0] * wl, p.pos[2] + left[1] * wl], [p.pos[0] - left[0] * wr, p.pos[2] - left[1] * wr]);
          cp.respawn = this.nearestRespawn(p.pos[0], p.pos[2]);
          pts.push(cp);
        });
        return { ...make.group(pts), prev: [...g.prev], next: [...g.next], setting1: 0, setting2: 0, _gi: gi };
      }).map(({ _gi, ...g }) => g);
      const all = k.CKPT.flatMap((g) => g.points);
      if (all.length) {
        all[0].type = 0;
        // Evenly spaced key checkpoints along the main group.
        const main = k.CKPT[0]?.points || [];
        for (let i = 1; i <= keyCount && main.length > keyCount + 1; i++) {
          main[Math.round((i * main.length) / (keyCount + 1))].type = i;
        }
      }
    });
  }

  // One respawn every N checkpoints, facing forward; then reassigns the checkpoints.
  respawnsFromCheckpoints(every = 4) {
    const k = this.k, doc = this.doc;
    doc.change('Respawns from checkpoints', () => {
      k.JGPT = [];
      for (const g of k.CKPT) {
        g.points.forEach((cp, i) => {
          if (i % every !== 0) return;
          const mx = (cp.left[0] + cp.right[0]) / 2, mz = (cp.left[1] + cp.right[1]) / 2;
          const dx = -(cp.right[1] - cp.left[1]), dz = cp.right[0] - cp.left[0];
          const y = doc.checkpointY(cp, mx, mz);
          const j = make.JGPT([mx, y, mz], [0, yawFromDir(-dx, -dz), 0]);
          j.id = k.JGPT.length;
          k.JGPT.push(j);
        });
      }
      this.assignRespawnsNoHistory();
    });
  }

  assignRespawnsNoHistory() {
    const k = this.k;
    if (!k.JGPT.length) return;
    // Prefer the closest respawn that lies behind (or at) the checkpoint, so players never skip ahead.
    for (const g of k.CKPT) for (const cp of g.points) {
      const mx = (cp.left[0] + cp.right[0]) / 2, mz = (cp.left[1] + cp.right[1]) / 2;
      const fx = cp.right[1] - cp.left[1], fz = -(cp.right[0] - cp.left[0]);
      let best = -1, bd = Infinity;
      k.JGPT.forEach((j, i) => {
        const dx = j.pos[0] - mx, dz = j.pos[2] - mz;
        const behind = -(dx * fx + dz * fz) >= -1;
        const d = dx * dx + dz * dz;
        if (behind && d < bd) { bd = d; best = i; }
      });
      cp.respawn = best >= 0 ? best : this.nearestRespawn(mx, mz);
    }
  }

  assignRespawns() { this.doc.change('Assign respawns to checkpoints', () => this.assignRespawnsNoHistory()); }

  renumberIds() {
    this.doc.change('Renumber IDs', () => {
      this.k.JGPT.forEach((e, i) => (e.id = i));
      this.k.CNPT.forEach((e, i) => (e.id = i));
      this.k.MSPT.forEach((e, i) => (e.id = i));
    });
  }

  reverseRoute(kind) {
    this.doc.change('Reverse direction', () => {
      if (kind === 'POTI') { for (const r of this.k.POTI) r.points.reverse(); return; }
      for (const g of this.k[kind]) {
        g.points.reverse();
        [g.prev, g.next] = [g.next, g.prev];
        if (kind === 'CKPT') for (const cp of g.points) [cp.left, cp.right] = [cp.right, cp.left];
      }
    });
  }

  swapCheckpointSides(onlySelected) {
    const doc = this.doc;
    const sel = onlySelected ? new Set(doc.selectedInfos({ expandGroups: true }).filter((i) => i.kind === 'CKPT').map((i) => i.item.uid)) : null;
    doc.change('Swap checkpoint left/right', () => {
      for (const g of this.k.CKPT) for (const cp of g.points) if (!sel || sel.has(cp.uid)) [cp.left, cp.right] = [cp.right, cp.left];
    });
  }

  // Turns the selected items to face along the nearest enemy route.
  alignSelectionToRoute() {
    const doc = this.doc;
    doc.change('Align to route', () => {
      for (const info of doc.selectedInfos({ expandGroups: true })) {
        const it = info.item;
        if (!it.rot || !it.pos) continue;
        const dir = this.nearestEnemyDir(it.pos[0], it.pos[2]);
        if (dir) it.rot = [it.rot[0], yawFromDir(dir[0], dir[1]), it.rot[2]];
      }
    }, { structural: false });
  }

  // Spreads selected points evenly between the first and the last one.
  distributeSelection() {
    const doc = this.doc;
    const infos = doc.selectedInfos({ expandGroups: true }).filter((i) => i.item.pos);
    if (infos.length < 3) return false;
    const a = infos[0].item.pos, b = infos[infos.length - 1].item.pos;
    doc.change('Distribute evenly', () => {
      infos.forEach((info, i) => {
        const t = i / (infos.length - 1);
        info.item.pos = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      });
    }, { structural: false });
    return true;
  }

  // Sets one coordinate/field for all selected entities.
  setField(field, index, value, label = 'Edit') {
    const doc = this.doc;
    doc.change(label, () => {
      for (const info of doc.selectedInfos({ expandGroups: true })) {
        const it = info.item;
        if (!(field in it)) continue;
        if (index === null) it[field] = value;
        else { it[field] = [...it[field]]; it[field][index] = value; }
      }
    }, { structural: false });
  }
}
