import { expect, test } from 'bun:test';
import { PRESETS, sampleSpline, trackSamples, layoutIssues, generateTrack } from '../web/js/editor/trackgen.js';
import { nearestLayoutSegment, startLayoutAt } from '../web/js/editor/layout-points.js';

const oval = () => PRESETS.Oval().map((p: any) => ({ ...p, w: 1 }));

test('adding or bending a point near the start never rewrites the horizontal spline', () => {
  const points = oval(), hit = nearestLayoutSegment(points, 4500, -13000)!;
  points.splice(hit.segment + 1, 0, { x: hit.at[0], z: hit.at[1], y: hit.height, w: hit.width });
  for (const layout of [points, points.map((p: any, i: number) => i === 1 ? { ...p, z: p.z + 9000 } : p)]) {
    const raw = sampleSpline(layout, 400).samples, out = trackSamples(layout).samples;
    expect(out.length).toBe(raw.length);
    for (let i = 0; i < raw.length; i++) {
      expect(out[i][0]).toBe(raw[i][0]); expect(out[i][2]).toBe(raw[i][2]);
    }
    const track = generateTrack(layout);
    for (const face of track.model.tris.filter((t: any) => ['road', 'startline', 'boost', 'offroad'].includes(t.mat))) {
      const v = face.v;
      expect((v[5] - v[2]) * (v[6] - v[0]) - (v[3] - v[0]) * (v[8] - v[2])).toBeGreaterThan(0);
    }
  }
});

test('point insertion follows the visible curve and its interpolated height and width', () => {
  const points = oval().map((p: any, i: number) => ({ ...p, y: i === 2 ? 1800 : 0, w: i === 2 ? 2 : 1 }));
  const curve = sampleSpline(points, 100);
  for (const parameter of [.6, 1.8, 3.4, 10.3, 11.7]) {
    const at = curve.parameters.findIndex((t: number) => t > parameter), p = curve.samples[at];
    const hit = nearestLayoutSegment(points, p[0], p[2])!;
    expect(hit.segment).toBe(Math.floor(curve.parameters[at]));
    expect(hit.distance).toBeLessThan(3);
    expect(Math.abs(hit.height - p[1])).toBeLessThan(3);
    expect(Math.abs(hit.width - p[3])).toBeLessThan(.01);
  }
});

test('moving the start rotates the control points and preserves manual placements along the lap', () => {
  const points = oval(), params = { step: 400, boostPositions: [.13, .8], itemBoxPositions: [{ t: .2, offset: -.4 }, { t: .75, offset: .6 }] };
  const moved = startLayoutAt(points, params, 6), oldCurve = sampleSpline(points, 100).samples, newCurve = sampleSpline(moved.points, 100).samples;
  expect(moved.points[0]).toEqual(points[6]);
  expect(points[0]).not.toEqual(points[6]);
  expect(layoutIssues(moved.points).filter((i: any) => i.level === 'error')).toEqual([]);
  const at = (s: number[][], t: number) => { const a = t * s.length, i = Math.floor(a), f = a - i; return [0, 2].map((k) => s[i][k] * (1 - f) + s[(i + 1) % s.length][k] * f); };
  for (let i = 0; i < params.boostPositions.length; i++) {
    const a = at(oldCurve, params.boostPositions[i]), b = at(newCurve, moved.params.boostPositions[i]);
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(20);
  }
  expect(moved.params.itemBoxPositions.map((p: any) => p.offset)).toEqual([-.4, .6]);
  expect(() => startLayoutAt(points, params, -1)).toThrow();
});
