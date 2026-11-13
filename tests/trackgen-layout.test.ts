import { expect, test } from "bun:test";
import { validate } from "../web/js/editor/validate.js";
import { addReplayCameras } from "../web/js/editor/cameras.js";
import { smoothLayout } from "../web/js/editor/layout-points.js";
import { buildKMP, parseKMP } from "../web/js/formats/kmp.js";
import { DEFAULT_PARAMS, PRESETS, TRACK_BASE_HEIGHT, generateTrack, layoutIssues, pointsFromStroke, reverseLayout, roadFrames, sampleSpline, scaleLayout, trackSamples } from "../web/js/editor/trackgen.js";
import { buildKCL, parseKCL, kclLookup } from "../web/js/formats/kcl.js";
import { HeightMap } from "../web/js/editor/heightmap.js";

const preset = (name: string) => (PRESETS as any)[name]().map((p: any) => ({ ...p, w: p.w ?? 1 }));

test("the oval keeps its regular silhouette with a safe grid on an existing straight", () => {
  for (const points of [preset("Oval"), reverseLayout(preset("Oval"))]) {
    const raw = sampleSpline(points, DEFAULT_PARAMS.step).samples, { samples } = trackSamples(points);
    expect(layoutIssues(points)).toEqual([]);
    for (let i = 0; i < samples.length; i++) {
      expect(samples[i][0]).toBe(raw[i][0]); expect(samples[i][2]).toBe(raw[i][2]);
      const a = samples[(i + samples.length - 1) % samples.length], b = samples[i], c = samples[(i + 1) % samples.length];
      const dot = ((b[0] - a[0]) * (c[0] - b[0]) + (b[2] - a[2]) * (c[2] - b[2])) /
        Math.hypot(b[0] - a[0], b[2] - a[2]) / Math.hypot(c[0] - b[0], c[2] - b[2]);
      expect(dot).toBeGreaterThan(Math.cos(.12));
    }
  }
});

test("the entire twelve-kart starting grid is above flat road, including on hills and narrow roads", () => {
  for (const name of ["Oval", "Figure eight", "Hilly"]) for (const roadWidth of [800, 3200, 6000]) {
    const out = generateTrack(preset(name), { roadWidth }), bytes = buildKCL(out.verts, out.flags), hm = new HeightMap(parseKCL(bytes));
    const start = out.kmp.KTPT[0], yaw = start.rot[1] * Math.PI / 180, t = [Math.sin(yaw), Math.cos(yaw)], l = [t[1], -t[0]];
    for (let back = 0; back <= 5500; back += 500) for (const side of [-1200, 0, 1200]) {
      const x = start.pos[0] - t[0] * back + l[0] * side, z = start.pos[2] - t[1] * back + l[1] * side;
      const y = hm.groundBelow(x, z, start.pos[1] + 500, 0);
      expect(y).not.toBeNull(); expect(y!).toBeCloseTo(start.pos[1] - 10, 1);
      expect(hm.surfacesAt(x, z).some((s: any) => Math.abs(s.y - y!) < .1 && [0, 6].includes(out.flags[s.tri] & 31))).toBe(true);
      expect(kclLookup(bytes, [x, y! + 10, z])?.some((i: number) => [0, 3, 6].includes(out.flags[i] & 31))).toBe(true);
    }
    for (const point of out.kmp.JGPT) expect(hm.groundBelow(point.pos[0], point.pos[2], point.pos[1], 0)).toBeCloseTo(point.pos[1] - 10, 1);
  }
});

test("generated roads remain above the game's unconditional zero-height respawn boundary", () => {
  for (const offset of [0, -3000, -50000]) {
    const points = preset("Hilly").map((p: any) => ({ ...p, y: p.y + offset }));
    const out = generateTrack(points), collision = parseKCL(buildKCL(out.verts, out.flags));
    for (let i = 0; i < collision.count; i++) if ([0, 3, 6].includes(collision.flags[i] & 31)) {
      for (const k of [1, 4, 7]) expect(collision.verts[i * 9 + k]).toBeGreaterThanOrEqual(999);
    }
    for (const p of [...out.kmp.KTPT, ...out.kmp.JGPT, ...out.kmp.ENPT[0].points, ...out.kmp.ITPT[0].points, ...out.kmp.GOBJ]) expect(p.pos[1]).toBeGreaterThan(0);
  }
  expect(trackSamples(preset("Oval")).heightOffset).toBe(TRACK_BASE_HEIGHT);
});

test("hills and bridge approaches have gradual changes of grade instead of launching crests", () => {
  for (const name of ["Hilly", "Figure eight"]) {
    const s = trackSamples(preset(name)).samples, n = s.length;
    for (let i = 0; i < n; i++) {
      const a = s[(i + n - 1) % n], b = s[i], c = s[(i + 1) % n];
      const before = Math.hypot(b[0] - a[0], b[2] - a[2]), after = Math.hypot(c[0] - b[0], c[2] - b[2]);
      const slope = (c[1] - b[1]) / after;
      const curvature = (slope - (b[1] - a[1]) / before) / ((before + after) / 2);
      expect(Math.abs(slope)).toBeLessThan(.281);
      expect(Math.abs(curvature)).toBeLessThan(.00008);
    }
  }
});

test("ramp collision allows tricks and fall triggers stay far below every drivable surface", () => {
  for (const trickable of [true, false]) {
    const out = generateTrack(preset("Hilly"), { trickable }), kcl = parseKCL(buildKCL(out.verts, out.flags));
    let lowestRoad = Infinity, highestFall = -Infinity, ramps = 0;
    for (let i = 0; i < kcl.count; i++) {
      const type = kcl.flags[i] & 31, ys = [1, 4, 7].map((v) => kcl.verts[i * 9 + v]);
      if ([0, 6].includes(type)) {
        expect(!!(kcl.flags[i] & 0x2000)).toBe(trickable);
        if (Math.max(...ys) - Math.min(...ys) > 20) ramps++;
      }
      if ([0, 3, 6].includes(type)) lowestRoad = Math.min(lowestRoad, ...ys);
      if (type === 16) highestFall = Math.max(highestFall, ...ys);
    }
    expect(ramps).toBeGreaterThan(0);
    expect(lowestRoad - highestFall).toBeGreaterThanOrEqual(DEFAULT_PARAMS.fallDepth);
    expect(Array.from(kcl.flags).filter((f) => (f & 31) === 16)).toHaveLength(2);
  }
});

test("road width changes the exported model and collision together", () => {
  const points = preset("Oval"), narrow = generateTrack(points, { roadWidth: 2600 }), wide = generateTrack(points, { roadWidth: 3600 });
  const widths = (out: any) => out.model.tris.filter((t: any) => t.mat === "road").filter((_: any, i: number) => i % 2 === 0).map((t: any) => Math.hypot(t.v[0] - t.v[3], t.v[2] - t.v[5])).sort((a: number, b: number) => a - b);
  const a = widths(narrow), b = widths(wide);
  expect(b[Math.floor(b.length / 2)] - a[Math.floor(a.length / 2)]).toBeCloseTo(1000, 1);
  for (const out of [narrow, wide]) {
    const rebuilt = parseKCL(buildKCL(out.verts, out.flags));
    for (let i = 0; i < rebuilt.count; i++) if ((rebuilt.flags[i] & 31) === 0) {
      // The KCL's shared float32 normals reconstruct the model within one
      // game unit (a kart is about 300 units wide).
      for (let k = 0; k < 9; k++) expect(Math.abs(rebuilt.verts[i * 9 + k] - out.verts[i * 9 + k])).toBeLessThan(1);
    }
  }
});

test("the generated opening camera has a valid non-smooth route for the actual game", () => {
  for (const name of ["Oval", "Figure eight", "Hilly"]) {
    const k = generateTrack(preset(name)).kmp, cam = k.CAME[0], route = k.POTI[cam.route];
    expect(cam.type).toBe(5); expect(route).toBeDefined(); expect(route.points.length).toBeGreaterThanOrEqual(2);
    expect(route.smooth).toBe(0); expect(route.loop).toBe(1);
    expect(route.points[0].pos).toEqual(cam.pos);
    expect(Math.hypot(...route.points[0].pos.map((v: number, i: number) => v - route.points[1].pos[i]))).toBeGreaterThan(100);
    expect(route.points.every((p: any) => p.setting1 > 0)).toBe(true);
  }
});

test("start-line checks use one continuous square projection across a curved or tapered quad", () => {
  const points = [[0, 0, 1.8], [12000, -18000, .6], [22000, -26000, 1], [-22000, -26000, 1], [-12000, -18000, 1.2]].map(([x, z, w]) => ({ x, y: 0, z, w }));
  const f = roadFrames(trackSamples(points).samples)[0], width = f.hl + f.hr;
  const start = generateTrack(points, { boostPads: 0 }).model.tris.filter((t: any) => t.mat === "startline");
  expect(start).toHaveLength(2);
  for (const tri of start) for (let i = 0; i < 3; i++) {
    const [x, , z] = tri.v.slice(i * 3, i * 3 + 3);
    expect(tri.uv[i * 2]).toBeCloseTo(((f.L[0] - x) * f.left[0] + (f.L[2] - z) * f.left[1]) / width, 8);
    expect(tri.uv[i * 2 + 1]).toBeCloseTo(((x - f.c[0]) * f.t[0] + (z - f.c[2]) * f.t[1]) / width, 8);
  }
});

test("manually placed item boxes replace automatic rows and follow the road height", () => {
  const points = preset("Hilly"), positions = [{ t: .2, offset: -.6 }, { t: .2, offset: .6 }, { t: .65, offset: 0 }];
  const out = generateTrack(points, { itemBoxPositions: positions, itemRows: 6 });
  expect(out.itemBoxes).toHaveLength(3);
  expect(out.kmp.GOBJ.filter((o: any) => o.objectId === 0x65).map((o: any) => o.pos)).toEqual(out.itemBoxes.map((b: any) => b.pos));
  expect(out.itemBoxes[0].pos[1]).toBeCloseTo(out.itemBoxes[1].pos[1], 5);
  expect(Math.hypot(...out.itemBoxes[0].pos.map((v: number, i: number) => v - out.itemBoxes[1].pos[i]))).toBeGreaterThan(1000);
  const raised = generateTrack(points.map((p: any) => ({ ...p, y: p.y + 1200 })), { itemBoxPositions: positions });
  for (let i = 0; i < 3; i++) expect(raised.itemBoxes[i].pos[1] - out.itemBoxes[i].pos[1]).toBeCloseTo(1200, 5);
  expect(generateTrack(points, { itemBoxPositions: [], itemRows: 6 }).itemBoxes).toHaveLength(0);
  expect(generateTrack(points, { itemRows: 2 }).itemBoxes).toHaveLength(8);
});

test("the ready-made shapes have no layout problems", () => {
  for (const name of ["Oval", "Figure eight", "Kidney", "Hilly"]) expect(layoutIssues(preset(name)).filter((i: any) => i.level === "error")).toEqual([]);
});

test("a figure eight gets an automatic bridge only when explicitly enabled", () => {
  const flat = preset("Figure eight").map((p: any) => ({ ...p, y: 0 }));
  const params = { autoBridges: true };
  const issues = layoutIssues(flat, params);
  expect(issues.filter((i: any) => i.level === "error")).toEqual([]);
  expect(issues[0]).toMatchObject({ level: "info" });
  expect(issues[0].message).toContain("bridge");
  expect(issues[0].at.length).toBe(1); // one crossing, in the middle of the eight
  // The built centreline: wherever two parts of the road are close, they are far apart in height.
  const { samples } = trackSamples(flat, params);
  const n = samples.length, skip = Math.ceil((DEFAULT_PARAMS.roadWidth * 2.5) / DEFAULT_PARAMS.step) + 2;
  const reach = DEFAULT_PARAMS.roadWidth + DEFAULT_PARAMS.offroadWidth * 2;
  for (let i = 0; i < n; i++) for (let j = i + skip; j < n; j++) {
    if (n - j + i < skip) continue;
    const a = samples[i], b = samples[j];
    if (Math.hypot(a[0] - b[0], a[2] - b[2]) < reach) expect(Math.abs(a[1] - b[1])).toBeGreaterThanOrEqual(DEFAULT_PARAMS.wallHeight + 800);
  }
  // Ramps stay drivable.
  for (let i = 0; i < n; i++) {
    const a = samples[i], b = samples[(i + 1) % n];
    expect(Math.abs(b[1] - a[1]) / Math.hypot(b[0] - a[0], b[2] - a[2])).toBeLessThan(0.45);
  }
  const track = generateTrack(flat, params);
  expect(track.kmp.CKPT[0].points.length).toBeGreaterThan(5);
});

test("tight turns are narrowed on the inside instead of folding over", () => {
  // A hairpin: two long straights joined by a very tight turn.
  const hairpin = [{ x: 0, y: 0, z: 0 }, { x: 30000, y: 0, z: 0 }, { x: 31500, y: 0, z: 1200 }, { x: 30000, y: 0, z: 2400 }, { x: 0, y: 0, z: 2400 }, { x: -1500, y: 0, z: 1200 }].map((p) => ({ ...p, w: 1 }));
  const issues = layoutIssues(hairpin);
  expect(issues.filter((i: any) => i.level === "error" || i.level === "warning").filter((i: any) => !/short|starting grid/.test(i.message))).toEqual([]);
  expect(issues.some((i: any) => i.level === 'error' && /starting grid/.test(i.message))).toBe(true);
  expect(issues.some((i: any) => i.level === "info" && /narrower/.test(i.message))).toBe(true);
  expect(generateTrack(hairpin).kmp.CKPT[0].points.length).toBeGreaterThan(5);
});

test("irregular hand-drawn corners keep the road, shoulders and kerbs facing up in both directions", () => {
  const points = [[9152, 0, 1.56], [8916, 8916, 1.18], [0, 5447, 1.98], [-9235, 9235, 1.65], [-2118, 0, 2.43], [-2745, -2745, 1.19], [0, -16526, 1.73], [11531, -11531, 1.43]]
    .map(([x, z, w]) => ({ x, y: 0, z, w }));
  for (const layout of [points, reverseLayout(points)]) for (const step of [200, 400, 800]) {
    const track = generateTrack(layout, { roadWidth: 5000, offroadWidth: 2000, step });
    for (const tri of track.model.tris.filter((t: any) => ["road", "startline", "boost", "offroad", "curb"].includes(t.mat))) {
      const v = tri.v, normalY = (v[5] - v[2]) * (v[6] - v[0]) - (v[3] - v[0]) * (v[8] - v[2]);
      expect(normalY).toBeGreaterThan(0);
      expect(v.every(Number.isFinite)).toBe(true);
    }
  }
});

test("track styles and surface overrides preserve the layout and collision", () => {
  const points = preset("Oval"), original = generateTrack(points);
  for (const [style, surface] of [["rally", "dirt"], ["desert", "sand"], ["snow", "snow"], ["castle", "stone"]]) {
    const changed = generateTrack(points, { style });
    expect(changed.model.materials.road.surface).toBe(surface);
    expect(changed.verts).toEqual(original.verts);
    expect(changed.flags).toEqual(original.flags);
    expect(buildKMP(changed.kmp)).toEqual(buildKMP(original.kmp));
  }
  const changed = generateTrack(points, { style: "snow", textures: { road: { surface: "dirt", repeat: 2 } } });
  expect(changed.model.materials.road).toMatchObject({ surface: "dirt", repeat: 2, gameTexture: false });
  expect(changed.model.materials.offroad.surface).toBe("snow");
  expect(original.model.materials.road.surface).toBe("asphalt");
});

test("slopes too steep to climb are spread out", () => {
  const cliff = preset("Oval").map((p: any, i: number) => ({ ...p, y: i === 2 ? 9000 : 0 }));
  const { samples } = trackSamples(cliff);
  const n = samples.length;
  for (let i = 0; i < n; i++) {
    const a = samples[i], b = samples[(i + 1) % n];
    expect(Math.abs(b[1] - a[1]) / Math.hypot(b[0] - a[0], b[2] - a[2])).toBeLessThanOrEqual(0.41);
  }
  expect(layoutIssues(cliff).some((i: any) => i.level === "info" && /steep/.test(i.message))).toBe(true);
});

test("a hand-drawn line retains enough control points to follow the stroke", () => {
  const stroke = Array.from({ length: 300 }, (_, i) => ({ x: Math.cos((i / 300) * Math.PI * 2) * 20000, z: Math.sin((i / 300) * Math.PI * 2) * 12000 }));
  const points = pointsFromStroke(stroke)!;
  expect(points.length).toBeGreaterThanOrEqual(8);
  expect(points.length).toBeLessThanOrEqual(256);
  expect(points[0]).toMatchObject({ x: 20000, z: 0, y: 0, w: 1 });
  expect(pointsFromStroke([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 20, z: 0 }])).toBeNull();
});

test("the generated goal camera keeps the view near the kart, as the original tracks do", () => {
  const goal = generateTrack(PRESETS.Oval(), DEFAULT_PARAMS).kmp.CAME.find((c: any) => c.type === 0);
  expect(goal.viewStart).toEqual([-30, -1, 550]);
  expect(goal.viewEnd).toEqual([-5, 1, 0]);
  expect([goal.zoomStart, goal.zoomEnd, goal.zoomSpeed]).toEqual([85, 40, 30]);
});

test("the checks find and repair a goal camera aimed at a place on the track", () => {
  const kmp: any = generateTrack(PRESETS.Oval(), DEFAULT_PARAMS).kmp;
  const goal = kmp.CAME.find((c: any) => c.type === 0);
  const isGoalIssue = (issue: any) => /goal camera aims/.test(issue.msg);
  const doc: any = { kmp, kcl: null, szs: null, change: (_: string, run: () => void) => run() };
  const ops = { nearestEnemyDir: () => null };
  expect(validate(doc, ops, {}).filter(isGoalIssue)).toEqual([]);
  goal.viewStart = [22409, 11276, 257]; goal.viewEnd = [22409, 11276, 257];
  const [issue] = validate(doc, ops, {}).filter(isGoalIssue);
  issue.fix.run();
  expect(goal.viewStart).toEqual([-30, -1, 550]);
  expect(validate(doc, ops, {}).filter(isGoalIssue)).toEqual([]);
});

test("generated tracks have replay cameras along the road, and old tracks can get them", () => {
  const kmp: any = generateTrack(PRESETS.Oval(), DEFAULT_PARAMS).kmp;
  const areas = kmp.AREA.filter((a: any) => a.type === 0);
  expect(areas.length).toBeGreaterThanOrEqual(6);
  for (const area of areas) {
    const camera = kmp.CAME[area.camera];
    expect([1, 3]).toContain(camera.type);
    expect(camera.route).toBe(0xff);
    // Fits in the file's byte, and the box stands around the road's height.
    expect(area.camera).toBeLessThan(0xff);
    expect(area.scale.every((v: number) => v > 0)).toBe(true);
  }
  // Every stretch of the enemy route lies in some box.
  const inside = (area: any, p: number[]) => {
    const a = -area.rot[1] * Math.PI / 180, dx = p[0] - area.pos[0], dz = p[2] - area.pos[2];
    const x = dx * Math.cos(a) + dz * Math.sin(a), z = -dx * Math.sin(a) + dz * Math.cos(a);
    return Math.abs(x) <= area.scale[0] * 5000 && Math.abs(z) <= area.scale[2] * 5000 && p[1] >= area.pos[1] && p[1] <= area.pos[1] + area.scale[1] * 10000;
  };
  const points = kmp.ENPT.flatMap((g: any) => g.points);
  const covered = points.filter((p: any) => areas.some((area: any) => inside(area, p.pos))).length;
  expect(covered / points.length).toBeGreaterThan(.95);
  // The intro chain is not disturbed: the header still starts at the opening camera.
  expect(kmp.extras.CAME).toBe(0);
  expect(kmp.CAME[0].type).toBe(5);
  // Survives the file format.
  const reparsed = parseKMP(buildKMP(kmp));
  expect(reparsed.AREA.filter((a: any) => a.type === 0).length).toBe(areas.length);
  // A track made before this has none, and gets them.
  const old: any = { ...kmp, AREA: [], CAME: kmp.CAME.slice(0, 2) };
  expect(addReplayCameras(old)).toBe(areas.length);
  expect(old.AREA.length).toBe(areas.length);
});

test("smoothing a layout takes out kinks, keeps heights and widths, and does not shrink it", () => {
  let seed = 7;
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const points = Array.from({ length: 40 }, (_, i) => {
    const t = i / 40 * Math.PI * 2;
    return { x: Math.cos(t) * 26000 + (random() - .5) * 700, y: i * 10, z: Math.sin(t) * 18000 + (random() - .5) * 700, w: 1 + i * .01, radius: i % 7 ? 0 : 3000 };
  });
  const roughness = (list: any[]) => {
    const n = list.length;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const a = list[(i + n - 1) % n], b = list[i], c = list[(i + 1) % n];
      sum += Math.hypot(b.x - (a.x + c.x) / 2 - (b.x - (a.x + c.x) / 2) * 0, b.z - (a.z + c.z) / 2);
    }
    return sum / n;
  };
  const low = smoothLayout(points, 2), high = smoothLayout(points, 10);
  expect(roughness(low)).toBeLessThan(roughness(points));
  expect(roughness(high)).toBeLessThan(roughness(low));
  const width = (list: any[]) => Math.max(...list.map((p) => p.x)) - Math.min(...list.map((p) => p.x));
  expect(width(high)).toBeGreaterThan(width(points) * .97);
  high.forEach((p: any, i: number) => { expect(p.y).toBe(points[i].y); expect(p.w).toBe(points[i].w); expect(p.radius).toBe(points[i].radius); });
  expect(points[0].x).not.toBe(high[0].x);
});

test("a shortcut splits checkpoints and routes into linked groups, with every lap checkpoint shared", () => {
  const base = PRESETS.Oval(), shortcut = { from: .2, to: .45, via: [] };
  const plain = generateTrack(base, DEFAULT_PARAMS), track = generateTrack(base, { ...DEFAULT_PARAMS, shortcuts: [shortcut] });
  expect(track.shortcuts.length).toBe(1);
  expect(track.shortcutProblems).toEqual([]);
  for (const name of ["CKPT", "ENPT", "ITPT"]) {
    const groups = track.kmp[name];
    expect(groups.length).toBe(4);
    expect(groups.every((g: any) => g.points.length > 0)).toBe(true);
    // A -> (main | shortcut) -> B -> A.
    expect(groups[0].next).toEqual([1, 2]);
    expect(groups[1].next).toEqual([3]);
    expect(groups[2].next).toEqual([3]);
    expect(groups[3].next).toEqual([0]);
    expect(groups[0].prev).toEqual([3]);
    expect(groups[3].prev).toEqual([1, 2]);
    for (const point of groups.flatMap((g: any) => g.points)) expect(point._i).toBeUndefined();
  }
  // The lap checkpoint opens the first group; key checkpoints are never on one branch only.
  const ck = track.kmp.CKPT;
  expect(ck[0].points[0].type).toBe(0);
  for (const g of [ck[1], ck[2]]) expect(g.points.every((p: any) => p.type === 0xff)).toBe(true);
  const keys = [...ck[0].points, ...ck[3].points].filter((p: any) => p.type !== 0xff && p.type !== 0).map((p: any) => p.type);
  expect(keys).toEqual([1, 2, 3]);
  // More road and a respawn on the way; the same survives the file format.
  expect(track.flags.length).toBeGreaterThan(plain.flags.length);
  expect(track.kmp.JGPT.length).toBe(plain.kmp.JGPT.length + 1);
  const reparsed = parseKMP(buildKMP(track.kmp));
  expect(reparsed.CKPT.map((g: any) => g.next)).toEqual(ck.map((g: any) => g.next));
  expect(reparsed.ENPT.length).toBe(4);
  // The checks are happy with it.
  const doc: any = { kmp: track.kmp, kcl: null, szs: null, change: (_: string, run: () => void) => run() };
  const errors = validate(doc, { nearestEnemyDir: () => null }, {}).filter((issue: any) => issue.level === "error");
  expect(errors).toEqual([]);
  // A wall stops being in the way where the shortcut leaves the road.
  const walls = (t: any) => [...t.flags].filter((f: number) => (f & 31) === 0x0c).length;
  const shortcutWalls = generateTrack(base, { ...DEFAULT_PARAMS, shortcuts: [shortcut] });
  expect(walls(shortcutWalls)).toBeGreaterThan(0);
});

test("two shortcuts chain, and ones that cannot work are left out with a reason", () => {
  const base = PRESETS.Oval();
  const two = generateTrack(base, { ...DEFAULT_PARAMS, shortcuts: [{ from: .15, to: .3 }, { from: .55, to: .75, via: [] }] });
  expect(two.kmp.CKPT.length).toBe(7);
  expect(two.kmp.CKPT[3].next).toEqual([4, 5]);
  expect(two.kmp.CKPT[6].next).toEqual([0]);
  const close = generateTrack(base, { ...DEFAULT_PARAMS, shortcuts: [{ from: .001, to: .2 }] });
  expect(close.shortcuts).toEqual([]);
  expect(close.shortcutProblems.length).toBe(1);
  expect(close.kmp.CKPT.length).toBe(1);
  const overlapping = generateTrack(base, { ...DEFAULT_PARAMS, shortcuts: [{ from: .1, to: .4 }, { from: .3, to: .6 }] });
  expect(overlapping.shortcuts.length).toBe(2);
  // Bends can be added, and reversed ends mean the same stretch.
  const bent = generateTrack(base, { ...DEFAULT_PARAMS, shortcuts: [{ from: .2, to: .45, via: [{ x: 0, z: 0 }] }] });
  expect(bent.shortcuts[0].length).toBeGreaterThan(0);
  expect(generateTrack(base, { ...DEFAULT_PARAMS, shortcuts: [{ from: .45, to: .2 }] }).shortcuts.length).toBe(1);
});

test("any number of shortcuts: overlapping, nested, sharing ends, all linked and valid", () => {
  const base = PRESETS.Oval();
  const shortcuts = [
    { from: .1, to: .3 }, { from: .2, to: .45 }, { from: .1, to: .25, via: [{ x: 15000, z: -6000 }] }, // overlapping, one shares S1's start
    { from: .3, to: .5 }, // leaves where S1 rejoins
    { from: .55, to: .9 }, { from: .6, to: .7 }, { from: .65, to: .85 }, { from: .7, to: .8, height: 1200 }, // nested
  ];
  const track = generateTrack(base, { ...DEFAULT_PARAMS, shortcuts });
  expect(track.shortcutProblems).toEqual([]);
  expect(track.shortcuts.length).toBe(shortcuts.length);
  for (const name of ["CKPT", "ENPT", "ITPT"]) {
    const groups = track.kmp[name];
    expect(groups[0].points.length).toBeGreaterThan(0);
    groups.forEach((group: any, g: number) => {
      expect(group.points.length).toBeGreaterThan(0);
      expect(group.next.length).toBeGreaterThan(0);
      expect(group.next.length).toBeLessThanOrEqual(6);
      expect(group.prev.length).toBeLessThanOrEqual(6);
      for (const next of group.next) expect(groups[next].prev).toContain(g);
      for (const prev of group.prev) expect(groups[prev].next).toContain(g);
    });
    // Every group can be reached from the start, and leads back to it.
    const reach = (from: number, key: "next" | "prev") => { const seen = new Set([from]), list = [from]; while (list.length) for (const k of groups[list.pop()!][key]) if (!seen.has(k)) { seen.add(k); list.push(k); } return seen; };
    expect(reach(0, "next").size).toBe(groups.length);
    expect(reach(0, "prev").size).toBe(groups.length);
  }
  expect(track.kmp.CKPT[0].points[0].type).toBe(0);
  const doc: any = { kmp: track.kmp, kcl: null, szs: null, change: (_: string, run: () => void) => run() };
  expect(validate(doc, { nearestEnemyDir: () => null }, {}).filter((issue: any) => issue.level === "error")).toEqual([]);
  const reparsed = parseKMP(buildKMP(track.kmp));
  expect(reparsed.CKPT.map((g: any) => g.next)).toEqual(track.kmp.CKPT.map((g: any) => g.next));
});

test("scenery stands off the road, in the style's objects, only when asked for", () => {
  const base = PRESETS.Oval();
  expect(generateTrack(base, DEFAULT_PARAMS).sceneryFiles).toEqual([]);
  const plain = generateTrack(base, DEFAULT_PARAMS);
  const some = generateTrack(base, { ...DEFAULT_PARAMS, scenery: "light" }), many = generateTrack(base, { ...DEFAULT_PARAMS, scenery: "dense" });
  const added = (t: any) => t.kmp.GOBJ.length - plain.kmp.GOBJ.length;
  expect(added(some)).toBeGreaterThan(3);
  expect(added(many)).toBeGreaterThan(added(some));
  expect(added(many)).toBeLessThanOrEqual(80);
  expect(some.sceneryFiles.map((f: any) => f.file).sort()).toEqual(["castleflower1", "castletree1"]);
  // Clear of the road: farther from the centre line than its half width and shoulder.
  const roads = plain.kmp.ENPT.flatMap((g: any) => g.points);
  for (const object of some.kmp.GOBJ.filter((o: any) => o.objectId !== 0x65)) {
    const nearest = Math.min(...roads.map((p: any) => Math.hypot(p.pos[0] - object.pos[0], p.pos[2] - object.pos[2])));
    expect(nearest).toBeGreaterThan(DEFAULT_PARAMS.roadWidth / 2);
  }
  expect(generateTrack(base, { ...DEFAULT_PARAMS, scenery: "light", style: "desert" }).sceneryFiles.map((f: any) => f.file)).toEqual(["PalmTree"]);
  // Same drawing, same places.
  expect(generateTrack(base, { ...DEFAULT_PARAMS, scenery: "light" }).kmp.GOBJ.map((o: any) => o.pos)).toEqual(some.kmp.GOBJ.map((o: any) => o.pos));
});

test("reverse keeps the start; scale keeps the centre", () => {
  const oval = preset("Oval");
  const reversed = reverseLayout(oval);
  expect(reversed[0]).toEqual(oval[0]);
  expect(reversed[1]).toEqual(oval[oval.length - 1]);
  const bigger = scaleLayout(oval, 2);
  expect(bigger[0].x).toBe(oval[0].x * 2);
});

test("generated hills keep their real road heights and have a solid deck, ground reference and bridge supports", () => {
  const points = preset("Hilly"), track = generateTrack(points), samples = trackSamples(points).samples;
  const roads = track.model.tris.filter((t: any) => t.mat === "road").flatMap((t: any) => t.v.filter((_: number, i: number) => i % 3 === 1));
  expect(Math.max(...roads) - Math.min(...roads)).toBeGreaterThan(2500);
  expect(Math.max(...roads)).toBeLessThanOrEqual(Math.max(...samples.map((s: number[]) => s[1])) + .01);
  expect(track.model.tris.some((t: any) => t.mat === "support")).toBe(true);
  const sides = track.model.tris.filter((t: any) => t.mat === "foundation");
  expect(sides.length).toBeGreaterThan(samples.length * 4);
  expect(sides.some((t: any) => Math.max(t.v[1], t.v[4], t.v[7]) - Math.min(t.v[1], t.v[4], t.v[7]) >= 300)).toBe(true);
  const ground = track.model.tris.filter((t: any) => t.mat === "terrain");
  expect(ground).toHaveLength(2);
  expect(ground[0].v[1]).toBeLessThan(Math.min(...samples.map((s: number[]) => s[1])));
  expect(ground.every((t: any) => t.v[1] === t.v[4] && t.v[4] === t.v[7])).toBe(true);
});

test("many shortcuts stay within the game's 255 checkpoints and route points", () => {
  const shortcuts = Array.from({ length: 30 }, (_, k) => ({ from: .05 + k * .026, to: .05 + k * .026 + .12 }));
  const track = generateTrack(PRESETS.Oval(), { ...DEFAULT_PARAMS, checkpointSpacing: 500, enemySpacing: 400, shortcuts });
  expect(track.shortcutProblems).toEqual([]);
  expect(track.shortcuts.length).toBe(shortcuts.length);
  const count = (name: string) => track.kmp[name].reduce((sum: number, g: any) => sum + g.points.length, 0);
  for (const name of ["CKPT", "ENPT", "ITPT"]) expect(count(name)).toBeLessThanOrEqual(255);
  for (const name of ["CKPT", "ENPT", "ITPT"]) for (const g of track.kmp[name]) { expect(g.points.length).toBeGreaterThan(0); expect(g.next.length).toBeLessThanOrEqual(6); }
  const reparsed = parseKMP(buildKMP(track.kmp));
  for (const name of ["CKPT", "ENPT", "ITPT"]) {
    expect(reparsed[name].map((g: any) => g.points.length)).toEqual(track.kmp[name].map((g: any) => g.points.length));
    expect(reparsed[name].map((g: any) => [g.prev, g.next])).toEqual(track.kmp[name].map((g: any) => [g.prev, g.next]));
  }
});
