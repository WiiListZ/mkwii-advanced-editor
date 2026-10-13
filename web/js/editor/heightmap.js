// XZ spatial grid over the KCL triangles: fast ground height queries.

import { isDriveableType } from '../data/defs.js';

const CELL = 1000;

export class HeightMap {
  constructor(kcl) {
    this.kcl = kcl;
    this.cells = new Map();
    const v = kcl.verts;
    for (let t = 0; t < kcl.count; t++) {
      if (kcl.valid && !kcl.valid[t]) continue;
      const o = t * 9;
      const minX = Math.min(v[o], v[o + 3], v[o + 6]), maxX = Math.max(v[o], v[o + 3], v[o + 6]);
      const minZ = Math.min(v[o + 2], v[o + 5], v[o + 8]), maxZ = Math.max(v[o + 2], v[o + 5], v[o + 8]);
      const cx0 = Math.floor(minX / CELL), cx1 = Math.floor(maxX / CELL);
      const cz0 = Math.floor(minZ / CELL), cz1 = Math.floor(maxZ / CELL);
      if ((cx1 - cx0 + 1) * (cz1 - cz0 + 1) > 4000) continue; // huge triangles (fall planes)
      for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
        const key = cx * 100003 + cz;
        let arr = this.cells.get(key);
        if (!arr) this.cells.set(key, (arr = []));
        arr.push(t);
      }
    }
  }

  // Heights of every surface above/below point (x, z).
  surfacesAt(x, z, driveableOnly = true) {
    const arr = this.cells.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL));
    if (!arr) return [];
    const v = this.kcl.verts, out = [];
    for (const t of arr) {
      if (driveableOnly && !isDriveableType(this.kcl.flags[t] & 0x1F)) continue;
      const o = t * 9;
      const ax = v[o], az = v[o + 2], bx = v[o + 3], bz = v[o + 5], cx = v[o + 6], cz = v[o + 8];
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-9) continue;
      const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
      const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
      out.push({ y: l1 * v[o + 1] + l2 * v[o + 4] + l3 * v[o + 7], tri: t });
    }
    return out;
  }

  // Height of the surface closest to the reference height (Infinity = highest).
  heightAt(x, z, refY = Infinity, driveableOnly = true) {
    let s = this.surfacesAt(x, z, driveableOnly);
    if (!s.length && driveableOnly) s = this.surfacesAt(x, z, false);
    if (!s.length) return null;
    if (refY === Infinity) return Math.max(...s.map((e) => e.y));
    let best = s[0].y;
    for (const e of s) if (Math.abs(e.y - refY) < Math.abs(best - refY)) best = e.y;
    return best;
  }

  // Height of the surface right below (or slightly above) y.
  groundBelow(x, z, y, tolerance = 300) {
    const s = this.surfacesAt(x, z, true).filter((e) => e.y <= y + tolerance);
    if (!s.length) return null;
    return Math.max(...s.map((e) => e.y));
  }
}
