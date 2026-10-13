// Track generator: turns a closed spline of control points into a drivable track
// (collision triangles, visual model, and a complete KMP with routes, checkpoints and respawns).

import { emptyKMP, make } from '../formats/kmp.js';

export const DEFAULT_PARAMS = {
  roadWidth: 2600,
  offroadWidth: 1400,
  wallHeight: 700,
  step: 400,            // distance between samples along the centerline
  checkpointSpacing: 1600,
  enemySpacing: 1200,
  respawnEvery: 3,      // one respawn every N checkpoints
  keyCheckpoints: 3,
  itemRows: 2,
  boostPads: 1,
  laps: 3,
  walls: true,
  fallDepth: 4000,
};

// Ready-made shapes (control points in world units; y = height).
export const PRESETS = {
  Oval: () => ring(8, 22000, 13000, () => 0),
  'Figure eight': () => {
    const pts = [];
    for (let i = 0; i < 16; i++) {
      const t = (i / 16) * Math.PI * 2;
      pts.push({ x: Math.sin(t) * 24000, y: 0, z: Math.sin(t) * Math.cos(t) * 26000 });
    }
    // The branch crossing at t = 0 goes over a bridge; the one at t = PI stays on the ground.
    pts[0].y = 2400; pts[1].y = 2000; pts[15].y = 2000; pts[2].y = 1000; pts[14].y = 1000;
    return pts;
  },
  Kidney: () => ring(10, 20000, 14000, () => 0, (t) => 1 - 0.35 * Math.max(0, Math.cos(t)) ** 2),
  Hilly: () => ring(12, 24000, 18000, (t) => 1500 + Math.sin(t * 3) * 1500),
  Random: () => ring(10, 22000, 18000, () => Math.round(Math.random() * 6) * 300, () => 0.7 + Math.random() * 0.45),
};

function ring(n, rx, rz, height, radius = () => 1) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const r = radius(t);
    pts.push({ x: Math.cos(t) * rx * r, y: height(t), z: Math.sin(t) * rz * r });
  }
  return pts;
}

// Closed Catmull-Rom spline, resampled at a constant distance.
export function sampleSpline(points, step) {
  const n = points.length;
  if (n < 3) return [];
  const P = (i) => points[(i + n) % n];
  const dense = [];
  for (let i = 0; i < n; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    for (let s = 0; s < 40; s++) {
      const t = s / 40, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      dense.push([f(p0.x, p1.x, p2.x, p3.x), f(p0.y, p1.y, p2.y, p3.y), f(p0.z, p1.z, p2.z, p3.z),
        f(p0.w ?? 1, p1.w ?? 1, p2.w ?? 1, p3.w ?? 1)]);
    }
  }
  dense.push(dense[0]);
  let total = 0;
  const cum = [0];
  for (let i = 1; i < dense.length; i++) {
    total += Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1], dense[i][2] - dense[i - 1][2]);
    cum.push(total);
  }
  const count = Math.max(8, Math.round(total / step));
  const out = [];
  let j = 1;
  for (let i = 0; i < count; i++) {
    const d = (i / count) * total;
    while (cum[j] < d) j++;
    const t = (d - cum[j - 1]) / (cum[j] - cum[j - 1] || 1);
    const a = dense[j - 1], b = dense[j];
    out.push([0, 1, 2, 3].map((k) => a[k] + (b[k] - a[k]) * t));
  }
  return { samples: out, length: total };
}

export function generateTrack(points, params = {}) {
  const P = { ...DEFAULT_PARAMS, ...params };
  const { samples, length } = sampleSpline(points, P.step);
  const n = samples.length;
  const yaw = (dx, dz) => Math.round((Math.atan2(dx, dz) * 180) / Math.PI * 100) / 100;

  // Frames along the track.
  const frames = samples.map((s, i) => {
    const a = samples[(i - 1 + n) % n], b = samples[(i + 1) % n];
    let tx = b[0] - a[0], tz = b[2] - a[2];
    const l = Math.hypot(tx, tz) || 1;
    tx /= l; tz /= l;
    const half = (P.roadWidth * s[3]) / 2;
    const left = [tz, -tx];
    const at = (d) => [s[0] + left[0] * d, s[1], s[2] + left[1] * d];
    return {
      c: [s[0], s[1], s[2]], t: [tx, tz], left, half,
      L: at(half), R: at(-half), LO: at(half + P.offroadWidth), RO: at(-half - P.offroadWidth),
    };
  });

  // Boost pads: samples on the straightest parts of the track.
  const boost = new Set();
  if (P.boostPads > 0) {
    const straight = frames.map((f, i) => {
      let s = 0;
      for (let k = -3; k <= 3; k++) { const g = frames[(i + k + n) % n]; s += g.t[0] * f.t[0] + g.t[1] * f.t[1]; }
      return { i, s };
    }).sort((a, b) => b.s - a.s);
    const used = [];
    for (const { i } of straight) {
      if (used.length >= P.boostPads) break;
      if (i < n * 0.1 || used.some((u) => Math.min(Math.abs(u - i), n - Math.abs(u - i)) < n / (P.boostPads + 1) / 2)) continue;
      used.push(i);
      boost.add(i);
    }
  }

  const verts = [], flags = [];
  const model = []; // { mat, v: [9], uv: [6] }
  const tri = (a, b, c, flag, mat, uv) => {
    verts.push(...a, ...b, ...c);
    flags.push(flag);
    if (mat) model.push({ mat, v: [...a, ...b, ...c], uv });
  };
  let dist = 0;
  for (let i = 0; i < n; i++) {
    const f = frames[i], g = frames[(i + 1) % n];
    const v0 = dist / P.roadWidth;
    dist += Math.hypot(g.c[0] - f.c[0], g.c[2] - f.c[2]);
    const v1 = dist / P.roadWidth;
    const isBoost = boost.has(i);
    const roadFlag = isBoost ? 0x0006 : 0x0000;
    const roadMat = isBoost ? 'boost' : i === 0 ? 'startline' : 'road';
    tri(f.L, f.R, g.R, roadFlag, roadMat, [0, v0, 1, v0, 1, v1]);
    tri(f.L, g.R, g.L, roadFlag, roadMat, [0, v0, 1, v1, 0, v1]);
    if (P.offroadWidth > 0) {
      tri(f.LO, f.L, g.L, 0x0003, 'offroad', [0, v0, 1, v0, 1, v1]);
      tri(f.LO, g.L, g.LO, 0x0003, 'offroad', [0, v0, 1, v1, 0, v1]);
      tri(f.R, f.RO, g.RO, 0x0003, 'offroad', [0, v0, 1, v0, 1, v1]);
      tri(f.R, g.RO, g.R, 0x0003, 'offroad', [0, v0, 1, v1, 0, v1]);
    }
    if (P.walls && P.wallHeight > 0) {
      const up = (p) => [p[0], p[1] + P.wallHeight, p[2]];
      const lb0 = P.offroadWidth > 0 ? f.LO : f.L, lb1 = P.offroadWidth > 0 ? g.LO : g.L;
      const rb0 = P.offroadWidth > 0 ? f.RO : f.R, rb1 = P.offroadWidth > 0 ? g.RO : g.R;
      tri(lb0, lb1, up(lb1), 0x000C, 'wall', [v0, 0, v1, 0, v1, 1]);
      tri(lb0, up(lb1), up(lb0), 0x000C, 'wall', [v0, 0, v1, 1, v0, 1]);
      tri(rb0, up(rb1), rb1, 0x000C, 'wall', [v0, 0, v1, 1, v1, 0]);
      tri(rb0, up(rb0), up(rb1), 0x000C, 'wall', [v0, 0, v0, 1, v1, 1]);
    }
  }

  // Fall boundary below everything.
  const xs = verts.filter((_, i) => i % 3 === 0), ys = verts.filter((_, i) => i % 3 === 1), zs = verts.filter((_, i) => i % 3 === 2);
  const m = 20000;
  const x0 = Math.min(...xs) - m, x1 = Math.max(...xs) + m, z0 = Math.min(...zs) - m, z1 = Math.max(...zs) + m;
  const fy = Math.min(...ys) - P.fallDepth;
  tri([x0, fy, z0], [x0, fy, z1], [x1, fy, z1], 0x0010, null);
  tri([x0, fy, z0], [x1, fy, z1], [x1, fy, z0], 0x0010, null);

  // ---- KMP --------------------------------------------------------------------
  const kmp = emptyKMP();
  kmp.STGI[0].laps = P.laps;
  const sampleAt = (i) => frames[((i % n) + n) % n];

  // Start: a little behind the finish line, facing forward.
  const back = Math.max(1, Math.round(900 / P.step));
  const s0 = sampleAt(-back);
  kmp.KTPT.push(make.KTPT([...s0.c], [0, yaw(s0.t[0], s0.t[1]), 0]));

  // Checkpoints (first one is the finish line).
  const cpStep = Math.max(1, Math.round(P.checkpointSpacing / P.step));
  const cps = [];
  for (let i = 0; i < n; i += cpStep) {
    const f = frames[i];
    const w = f.half + P.offroadWidth + 100;
    const cp = make.CKPT([f.c[0] + f.left[0] * w, f.c[2] + f.left[1] * w], [f.c[0] - f.left[0] * w, f.c[2] - f.left[1] * w]);
    cp._i = i;
    cps.push(cp);
  }
  cps[0].type = 0;
  for (let k = 1; k <= P.keyCheckpoints && cps.length > P.keyCheckpoints + 1; k++) cps[Math.round((k * cps.length) / (P.keyCheckpoints + 1))].type = k;

  // Respawns every N checkpoints (placed slightly after the checkpoint so they are "behind" the next ones).
  cps.forEach((cp, ci) => {
    if (ci % P.respawnEvery !== 0) return;
    const f = frames[cp._i];
    const j = make.JGPT([...f.c], [0, yaw(f.t[0], f.t[1]), 0]);
    j.id = kmp.JGPT.length;
    kmp.JGPT.push(j);
  });
  cps.forEach((cp, ci) => { cp.respawn = Math.floor(ci / P.respawnEvery); delete cp._i; });
  const ckGroup = make.group(cps);
  ckGroup.prev = [0]; ckGroup.next = [0];
  kmp.CKPT.push(ckGroup);

  // Enemy and item routes along the centerline.
  const enStep = Math.max(1, Math.round(P.enemySpacing / P.step));
  const en = [], it = [];
  for (let i = 0; i < n; i += enStep) {
    const f = frames[i];
    en.push({ ...make.ENPT([...f.c]), width: Math.max(8, Math.round(f.half / 100)) });
    it.push({ ...make.ITPT([...f.c]), width: Math.max(8, Math.round(f.half / 100)) });
  }
  const eg = make.group(en); eg.prev = [0]; eg.next = [0];
  const ig = make.group(it); ig.prev = [0]; ig.next = [0];
  kmp.ENPT.push(eg);
  kmp.ITPT.push(ig);

  // Rows of item boxes across the road.
  for (let r = 1; r <= P.itemRows; r++) {
    const f = sampleAt(Math.round((r / (P.itemRows + 1)) * n));
    for (let k = 0; k < 4; k++) {
      const d = f.half * (-0.75 + k * 0.5);
      kmp.GOBJ.push(make.GOBJ(0x65, [f.c[0] + f.left[0] * d, f.c[1] + 60, f.c[2] + f.left[1] * d]));
    }
  }

  // Cameras: an opening shot of the start and a goal camera.
  const start = frames[0];
  const opPos = [start.c[0] - start.t[0] * 6000 + start.left[0] * 3000, start.c[1] + 2500, start.c[2] - start.t[1] * 6000 + start.left[1] * 3000];
  const op = make.CAME(opPos);
  op.type = 5; op.time = 400; op.zoomStart = 45; op.zoomEnd = 35; op.viewStart = [...start.c]; op.viewEnd = [...start.c]; op.start = 1;
  const goalPos = [start.c[0] + start.t[0] * 3000, start.c[1] + 800, start.c[2] + start.t[1] * 3000];
  const goal = make.CAME(goalPos);
  goal.type = 0; goal.zoomStart = goal.zoomEnd = 40; goal.viewStart = [...start.c]; goal.viewEnd = [...start.c];
  kmp.CAME.push(op, goal);
  kmp.extras.CAME = 0;

  return {
    verts: Float32Array.from(verts),
    flags: Uint16Array.from(flags),
    kmp,
    model: { tris: model, materials: MODEL_MATERIALS },
    length,
  };
}

export const MODEL_MATERIALS = {
  road: { color: [0.36, 0.37, 0.4] },
  startline: { color: [0.95, 0.95, 0.95] },
  boost: { color: [1.0, 0.6, 0.0] },
  offroad: { color: [0.3, 0.6, 0.22] },
  wall: { color: [0.75, 0.3, 0.3] },
};
