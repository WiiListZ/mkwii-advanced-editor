import { expect, test } from "bun:test";
import { DEFAULT_PARAMS, PRESETS, generateTrack, layoutIssues, pointsFromStroke, reverseLayout, scaleLayout, trackSamples } from "../web/js/editor/trackgen.js";

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
