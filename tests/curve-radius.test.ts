import { expect, test } from 'bun:test';
import { curveCorner, cornerArc } from '../web/js/editor/curve-radius.js';
import { PRESETS, sampleSpline, trackSamples, reverseLayout, generateTrack, roadFrames } from '../web/js/editor/trackgen.js';
import { nearestLayoutSegment, startLayoutAt } from '../web/js/editor/layout-points.js';

const rectangle = (radius: number) => [[0, -20000], [30000, -20000], [30000, 20000], [-30000, 20000], [-30000, -20000]]
  .map(([x, z], i) => ({ x, z, y: 0, w: 1, radius: i === 1 ? radius : 0 }));

test('a selected bend follows the requested circular radius in either driving direction', () => {
  for (const radius of [800, 3000, 8000]) for (const points of [rectangle(radius), reverseLayout(rectangle(radius))]) {
    const index = points.findIndex((p: any) => p.radius === radius), corner = curveCorner(points, index)!;
    expect(corner.radius).toBeCloseTo(radius, 8);
    const curve = sampleSpline(points, 40);
    let arcSamples = 0;
    for (let i = 0; i < curve.samples.length; i++) {
      const t = curve.parameters[i], relative = t - index;
      if (relative >= -corner.before && relative <= corner.after) {
        const p = curve.samples[i];
        expect(Math.hypot(p[0] - corner.center[0], p[2] - corner.center[1])).toBeCloseTo(radius, -1);
        arcSamples++;
      }
      expect(curve.samples[i][1]).toBe(0); expect(curve.samples[i][3]).toBeCloseTo(1, 8);
      if (i) expect(curve.parameters[i]).toBeGreaterThan(curve.parameters[i - 1]);
    }
    expect(arcSamples).toBeGreaterThan(10);
    const out = trackSamples(points);
    expect(out.samples.every((p: number[]) => p[1] === out.heightOffset)).toBe(true);
    const middle = cornerArc(corner, .5), hit = nearestLayoutSegment(points, ...middle)!;
    expect(hit.distance).toBeLessThan(10);
    expect([index - 1, index]).toContain(hit.segment);
  }
});

test('oversized neighbouring radii fit the available segments without loops or discontinuities', () => {
  const points = rectangle(200000).map(p => ({ ...p, radius: 200000 }));
  for (let i = 0; i < points.length; i++) {
    const corner = curveCorner(points, i);
    if (!corner) continue; // the start is in the middle of a straight
    expect(corner.radius).toBeLessThan(points[i].radius);
    expect(corner.before).toBeLessThanOrEqual(.45000001); expect(corner.after).toBeLessThanOrEqual(.45000001);
  }
  const { samples } = sampleSpline(points, 100);
  for (let i = 0; i < samples.length; i++) {
    const a = samples[(i + samples.length - 1) % samples.length], b = samples[i], c = samples[(i + 1) % samples.length];
    expect(b.every(Number.isFinite)).toBe(true);
    expect(Math.hypot(c[0] - b[0], c[2] - b[2])).toBeLessThan(102);
    const dot = ((b[0] - a[0]) * (c[0] - b[0]) + (b[2] - a[2]) * (c[2] - b[2])) / Math.hypot(b[0] - a[0], b[2] - a[2]) / Math.hypot(c[0] - b[0], c[2] - b[2]);
    expect(dot).toBeGreaterThan(.99);
  }
});

test('zero radius preserves the automatic spline and changing the start preserves rounded bends', () => {
  const original = PRESETS.Oval();
  expect(sampleSpline(original.map((p: any) => ({ ...p, radius: 0 })), 400)).toEqual(sampleSpline(original, 400));
  const points = rectangle(7000), moved = startLayoutAt(points, {}, 1);
  const corner = curveCorner(moved.points, 0)!;
  const middle = cornerArc(corner, .5), curve = sampleSpline(moved.points, 100);
  expect(curve.samples[0][0]).toBeCloseTo(middle[0], 8); expect(curve.samples[0][2]).toBeCloseTo(middle[1], 8);
  const track = generateTrack(moved.points);
  expect(track.model.tris.every((t: any) => t.v.every(Number.isFinite))).toBe(true);
  for (const f of roadFrames(trackSamples(points).samples)) expect(f.c[1]).toBe(10000);
});

test('degenerate corners and invalid radii safely fall back to the automatic spline', () => {
  for (const radius of [-1, NaN, Infinity, 0]) expect(curveCorner(rectangle(radius), 1)).toBeNull();
  const points = rectangle(5000); points[0] = { ...points[1] };
  expect(curveCorner(points, 1)).toBeNull();
  expect(sampleSpline(points, 100).samples.every((p: number[]) => p.every(Number.isFinite))).toBe(true);
});
