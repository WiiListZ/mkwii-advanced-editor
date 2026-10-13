// The open track: KMP, KCL, SZS archive, selection and undo/redo history.

import { emptyKMP, newUid } from '../formats/kmp.js';
import { HeightMap } from './heightmap.js';
import { findFile, setFilePath, deleteFilePath } from '../formats/u8.js';

export const KIND_LABEL = {
  KTPT: 'Start Position', ENPT: 'Enemy Point', ITPT: 'Item Point', CKPT: 'Checkpoint', GOBJ: 'Object',
  POTI: 'Route Point', AREA: 'Area', CAME: 'Camera', JGPT: 'Respawn', CNPT: 'Cannon', MSPT: 'Battle End',
  GROUP: 'Group', ROUTE: 'Route', STGI: 'Track Settings',
};

export const SECTION_LABEL = {
  KTPT: 'Start Positions', ENPT: 'Enemy Routes (CPU)', ITPT: 'Item Routes', CKPT: 'Checkpoints', GOBJ: 'Objects',
  POTI: 'Routes', AREA: 'Areas', CAME: 'Cameras', JGPT: 'Respawns', CNPT: 'Cannons', MSPT: 'Battle End Points',
};

export const GROUPED = ['ENPT', 'ITPT', 'CKPT'];
export const FLAT = ['KTPT', 'GOBJ', 'AREA', 'CAME', 'JGPT', 'CNPT', 'MSPT'];

const MAX_HISTORY = 150;

export class TrackDocument extends EventTarget {
  constructor() {
    super();
    this.reset();
  }

  reset() {
    this.kmp = emptyKMP();
    this.kcl = null;          // { verts, flags, valid, count, raw?, prismDataOffset? }
    this.kclGeometryChanged = false;
    this.kclFlagsChanged = false;
    this.szs = null;          // albero U8
    this.filePath = null;
    this.fileName = 'New Track';
    this.fileKind = 'new';    // szs | kmp | kcl | new
    this.dirty = false;
    this.selection = new Set();
    this.undoStack = [];
    this.redoStack = [];
    this.pending = null;
    this.heights = null;
    this._index = null;
    this._ckY = new Map();
    this.extraModel = null;   // generated visual model (for OBJ export)
  }

  // ---- Events ---------------------------------------------------------------
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  on(type, fn) { this.addEventListener(type, (e) => fn(e.detail)); }

  loaded() {
    this.heights = this.kcl ? new HeightMap(this.kcl) : null;
    this.invalidate();
    this.undoStack = [];
    this.redoStack = [];
    this.selection.clear();
    this.dirty = false;
    this.emit('load');
    this.emit('change', { structural: true });
    this.emit('selection');
  }

  setKCL(kcl, geometryChanged = true) {
    this.kcl = kcl;
    if (geometryChanged) this.kclGeometryChanged = true;
    this.heights = kcl ? new HeightMap(kcl) : null;
    this._ckY.clear();
    this.emit('kcl');
  }

  // ---- uid -> entity index ---------------------------------------------------
  index() {
    if (this._index) return this._index;
    const map = new Map();
    const k = this.kmp;
    for (const kind of GROUPED) {
      k[kind].forEach((g, gi) => {
        map.set(g.uid, { kind: 'GROUP', section: kind, item: g, list: k[kind], index: gi });
        g.points.forEach((p, pi) => map.set(p.uid, { kind, item: p, list: g.points, index: pi, group: g, groupIndex: gi }));
      });
    }
    for (const kind of FLAT) k[kind].forEach((e, i) => map.set(e.uid, { kind, item: e, list: k[kind], index: i }));
    k.POTI.forEach((r, ri) => {
      map.set(r.uid, { kind: 'ROUTE', item: r, list: k.POTI, index: ri });
      r.points.forEach((p, pi) => map.set(p.uid, { kind: 'POTI', item: p, list: r.points, index: pi, route: r, routeIndex: ri }));
    });
    k.STGI.forEach((s) => map.set(s.uid, { kind: 'STGI', item: s, list: k.STGI, index: 0 }));
    this._index = map;
    return map;
  }
  invalidate() { this._index = null; this._ckY.clear(); }

  // Selection key: "uid" or "uid:L" / "uid:R" (checkpoint ends).
  resolve(key) {
    const [uidStr, side] = String(key).split(':');
    const info = this.index().get(Number(uidStr));
    return info ? { ...info, side: side || null, key: String(key) } : null;
  }

  // File-order index of a point in a grouped section.
  globalIndex(info) {
    if (!info.group) return info.index;
    let n = 0;
    const groups = this.kmp[info.kind];
    for (let i = 0; i < info.groupIndex; i++) n += groups[i].points.length;
    return n + info.index;
  }

  // ---- Positions ------------------------------------------------------------
  // Checkpoints are 2D: their height comes from the collision (cached until the next change).
  checkpointY(cp, x, z) {
    const key = x + '|' + z;
    const cached = this._ckY.get(key);
    if (cached !== undefined) return cached;
    const ref = this.nearestEnemyY(x, z);
    let y = ref ?? 0;
    if (this.heights) {
      const h = this.heights.heightAt(x, z, ref ?? Infinity);
      if (h !== null) y = h;
    }
    if (this._ckY.size > 20000) this._ckY.clear();
    this._ckY.set(key, y);
    return y;
  }

  nearestEnemyY(x, z) {
    let best = null, bd = Infinity;
    for (const g of this.kmp.ENPT) for (const p of g.points) {
      const d = (p.pos[0] - x) ** 2 + (p.pos[2] - z) ** 2;
      if (d < bd) { bd = d; best = p.pos[1]; }
    }
    return best;
  }

  getPos(info) {
    const it = info.item;
    if (info.kind === 'CKPT') {
      if (info.side === 'L') return [it.left[0], this.checkpointY(it, it.left[0], it.left[1]), it.left[1]];
      if (info.side === 'R') return [it.right[0], this.checkpointY(it, it.right[0], it.right[1]), it.right[1]];
      const x = (it.left[0] + it.right[0]) / 2, z = (it.left[1] + it.right[1]) / 2;
      return [x, this.checkpointY(it, x, z), z];
    }
    if (info.kind === 'GROUP' || info.kind === 'ROUTE') {
      const pts = info.item.points;
      if (!pts.length) return null;
      const c = [0, 0, 0];
      for (const p of pts) {
        const pp = info.section === 'CKPT' ? [(p.left[0] + p.right[0]) / 2, 0, (p.left[1] + p.right[1]) / 2] : p.pos;
        c[0] += pp[0]; c[1] += pp[1]; c[2] += pp[2];
      }
      return c.map((v) => v / pts.length);
    }
    return it.pos ? [...it.pos] : null;
  }

  // Moves an entity by a delta (used by the gizmo and tools).
  translate(info, start, delta) {
    const it = info.item;
    if (info.kind === 'CKPT') {
      if (info.side !== 'R') it.left = [start.left[0] + delta[0], start.left[1] + delta[2]];
      if (info.side !== 'L') it.right = [start.right[0] + delta[0], start.right[1] + delta[2]];
      return;
    }
    if (it.pos) it.pos = [start.pos[0] + delta[0], start.pos[1] + delta[1], start.pos[2] + delta[2]];
  }

  // Editable entities in the selection (groups optionally expand into their points).
  selectedInfos({ expandGroups = false } = {}) {
    const out = [];
    const seen = new Set();
    for (const key of this.selection) {
      const info = this.resolve(key);
      if (!info) continue;
      if (expandGroups && (info.kind === 'GROUP' || info.kind === 'ROUTE')) {
        for (const p of info.item.points) {
          if (seen.has(p.uid)) continue;
          seen.add(p.uid);
          out.push(this.resolve(p.uid));
        }
        continue;
      }
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(info);
    }
    return out;
  }

  // ---- Selection ------------------------------------------------------------
  select(keys, mode = 'replace') {
    keys = (Array.isArray(keys) ? keys : [keys]).map(String);
    if (mode === 'replace') this.selection = new Set(keys);
    else if (mode === 'add') keys.forEach((k) => this.selection.add(k));
    else if (mode === 'toggle') keys.forEach((k) => (this.selection.has(k) ? this.selection.delete(k) : this.selection.add(k)));
    this.emit('selection');
  }
  clearSelection() { if (this.selection.size) { this.selection.clear(); this.emit('selection'); } }
  get primary() {
    const last = [...this.selection].pop();
    return last ? this.resolve(last) : null;
  }

  // ---- History -----------------------------------------------------------
  snapshot(archivePaths = []) {
    return {
      kmp: structuredClone(this.kmp),
      kcl: this.kcl ? { ...this.kcl, flags: this.kcl.flags.slice() } : null,
      kclGeometryChanged: this.kclGeometryChanged,
      kclFlagsChanged: this.kclFlagsChanged,
      modelBytes: this.szs ? findFile(this.szs, 'course_model.brres')?.data : null,
      archiveFiles: this.szs ? archivePaths.map((path) => ({ path, data: findFile(this.szs, path)?.data ?? null })) : [],
      selection: [...this.selection],
    };
  }

  restore(s) {
    this.kmp = structuredClone(s.kmp);
    const kclChanged = s.kcl?.verts !== this.kcl?.verts || s.kcl?.flags?.length !== this.kcl?.flags?.length;
    const modelNode = this.szs && findFile(this.szs, 'course_model.brres');
    const modelChanged = !!modelNode && !!s.modelBytes && modelNode.data !== s.modelBytes;
    if (modelChanged) modelNode.data = s.modelBytes;
    const archiveChanged = !!s.archiveFiles?.length;
    if (this.szs) for (const { path, data } of s.archiveFiles || []) {
      if (data === null) deleteFilePath(this.szs, path);
      else setFilePath(this.szs, path, data);
    }
    if (s.kcl) {
      this.kcl = { ...s.kcl, flags: s.kcl.flags.slice() };
      if (kclChanged) this.heights = new HeightMap(this.kcl);
    } else {
      this.kcl = null;
      this.heights = null;
    }
    this.selection = new Set(s.selection);
    this.kclGeometryChanged = !!s.kclGeometryChanged;
    this.kclFlagsChanged = !!s.kclFlagsChanged;
    this.invalidate();
    this.dirty = true;
    this.emit('kcl');
    if (modelChanged || archiveChanged) this.emit('model');
    this.emit('change', { structural: true });
    this.emit('selection');
  }

  // Runs a modification and records it in the history.
  change(label, fn, { structural = true, kclFlags = false } = {}) {
    const before = this.snapshot();
    const result = fn();
    this.pushHistory(label, before);
    this.invalidate();
    if (kclFlags) { this.kclFlagsChanged = true; this.emit('kcl'); }
    this.emit('change', { structural });
    return result;
  }

  // A single archive resource is tracked in history without copying the whole SZS on every edit.
  changeArchiveFile(label, path, data) {
    if (!this.szs) throw new Error('Open a track archive first');
    const before = this.snapshot([path]);
    if (data === null) deleteFilePath(this.szs, path);
    else setFilePath(this.szs, path, data);
    this.pushHistory(label, before);
    this.invalidate();
    this.emit('model');
    this.emit('change', { structural: false });
  }

  // Continuous edits (gizmo drag): beginEdit -> live() ... -> endEdit
  beginEdit() { this.pending = this.snapshot(); }
  live() { this.emit('live'); }
  endEdit(label) {
    if (!this.pending) return;
    this.pushHistory(label, this.pending);
    this.pending = null;
    this.invalidate();
    this.emit('change', { structural: false });
  }
  cancelEdit() {
    if (!this.pending) return;
    this.restore(this.pending);
    this.pending = null;
  }

  pushHistory(label, before) {
    this.undoStack.push({ label, state: before });
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
    this.dirty = true;
  }

  undo() {
    const step = this.undoStack.pop();
    if (!step) return null;
    this.redoStack.push({ label: step.label, state: this.snapshot(step.state.archiveFiles?.map((f) => f.path)) });
    this.restore(step.state);
    return step.label;
  }

  redo() {
    const step = this.redoStack.pop();
    if (!step) return null;
    this.undoStack.push({ label: step.label, state: this.snapshot(step.state.archiveFiles?.map((f) => f.path)) });
    this.restore(step.state);
    return step.label;
  }

  // Deep copy of an entity with fresh uids.
  cloneEntity(item) {
    const c = structuredClone(item);
    const renew = (o) => {
      if (o && typeof o === 'object') {
        if ('uid' in o) o.uid = newUid();
        for (const v of Object.values(o)) if (Array.isArray(v)) v.forEach(renew);
      }
    };
    renew(c);
    return c;
  }
}
