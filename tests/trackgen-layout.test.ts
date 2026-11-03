import { expect, test } from "bun:test";
import { DEFAULT_PARAMS, PRESETS, generateTrack, layoutIssues, pointsFromStroke, reverseLayout, scaleLayout, trackSamples } from "../web/js/editor/trackgen.js";
import { buildKMP } from "../web/js/formats/kmp.js";

const preset = (name: string) => (PRESETS as any)[name]().map((p: any) => ({ ...p, w: p.w ?? 1 }));

test("the ready-made shapes have no layout problems", () => {
  for (const name of ["Oval", "Figure eight", "Kidney", "Hilly"]) expect(layoutIssues(preset(name)).filter((i: any) => i.level === "error")).toEqual([]);
});

test("a figure eight without its bridge gets one by itself", () => {
  const flat = preset("Figure eight").map((p: any) => ({ ...p, y: 0 }));
  const issues = layoutIssues(flat);
  expect(issues.filter((i: any) => i.level === "error")).toEqual([]);
  expect(issues[0]).toMatchObject({ level: "info" });
  expect(issues[0].message).toContain("bridge");
  expect(issues[0].at.length).toBe(1); // one crossing, in the middle of the eight
  // The built centreline: wherever two parts of the road are close, they are far apart in height.
  const { samples } = trackSamples(flat);
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
  const track = generateTrack(flat);
  expect(track.kmp.CKPT[0].points.length).toBeGreaterThan(5);
});

test("tight turns are narrowed on the inside instead of folding over", () => {
  // A hairpin: two long straights joined by a very tight turn.
  const hairpin = [{ x: 0, y: 0, z: 0 }, { x: 30000, y: 0, z: 0 }, { x: 31500, y: 0, z: 1200 }, { x: 30000, y: 0, z: 2400 }, { x: 0, y: 0, z: 2400 }, { x: -1500, y: 0, z: 1200 }].map((p) => ({ ...p, w: 1 }));
  const issues = layoutIssues(hairpin);
  expect(issues.filter((i: any) => i.level === "error" || i.level === "warning").filter((i: any) => !/short/.test(i.message))).toEqual([]);
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

test("a hand-drawn line becomes evenly spaced control points", () => {
  const stroke = Array.from({ length: 300 }, (_, i) => ({ x: Math.cos((i / 300) * Math.PI * 2) * 20000, z: Math.sin((i / 300) * Math.PI * 2) * 12000 }));
  const points = pointsFromStroke(stroke)!;
  expect(points.length).toBeGreaterThanOrEqual(8);
  expect(points.length).toBeLessThanOrEqual(24);
  expect(points[0]).toMatchObject({ x: 20000, z: 0, y: 0, w: 1 });
  expect(pointsFromStroke([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 20, z: 0 }])).toBeNull();
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
