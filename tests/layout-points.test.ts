import { expect, test } from 'bun:test';
import { PRESETS, sampleSpline, trackSamples, layoutIssues, generateTrack } from '../web/js/editor/trackgen.js';
import { moveStartToFit, nearestLayoutSegment, startLayoutAt } from '../web/js/editor/layout-points.js';
import { buildShortcuts, shortcutWallGaps, shortcutWalls } from '../web/js/editor/track-branches.js';
import { DEFAULT_PARAMS, roadFrames } from '../web/js/editor/trackgen.js';

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

// An oval whose start point is pulled into the middle: a V-shaped bend at the start line.
const bentStart = () => { const points = oval(); points[0] = { ...points[0], x: -2000, z: -2500 }; return points; };
const gridError = (points: any[], params: any) => layoutIssues(points, params).some((i: any) => i.level === 'error' && i.fix === 'start');

test('a start on a bend is moved to the nearest place the grid fits, keeping the shape', () => {
  const points = bentStart(), params = { ...DEFAULT_PARAMS, boostPositions: [.5], shortcuts: [{ from: .3, to: .4, via: [] }] };
  expect(gridError(points, params)).toBe(true);
  const moved = moveStartToFit(points, params)!;
  expect(moved).not.toBeNull();
  expect(gridError(moved.points, moved.params)).toBe(false);
  // The same points, in a new order (a new one may be added halfway between two).
  for (const p of points) expect(moved.points.some((q: any) => q.x === p.x && q.z === p.z && q.y === p.y)).toBe(true);
  expect(moved.params.boostPositions[0]).not.toBe(.5);
  expect(moved.params.shortcuts).toHaveLength(1);
});

test('Set start here moves shortcuts with the lap, keeping one the start line now cuts across', () => {
  const points = oval(), params = { ...DEFAULT_PARAMS, shortcuts: [{ from: .3, to: .4, via: [] }, { from: .7, to: .8, via: [] }] };
  const moved = startLayoutAt(points, params, 9);
  const fraction = (.3 - moved.params.shortcuts[0].from + 1) % 1;
  expect(moved.params.shortcuts).toHaveLength(2);
  expect((.4 - moved.params.shortcuts[0].to + 1) % 1).toBeCloseTo(fraction, 6);
  // The other one now skips the start line: said by its number, and the start can be moved out.
  const track = generateTrack(moved.points, moved.params);
  expect(track.shortcuts).toHaveLength(1);
  expect(track.shortcutCrossesStart).toBe(true);
  expect(track.shortcutProblems).toEqual([expect.stringMatching(/^S2 skips the start line/)]);
  const out = moveStartToFit(moved.points, moved.params)!;
  expect(generateTrack(out.points, out.params).shortcuts).toHaveLength(2);
});

test('a shortcut across the start line is not read the long way round, and does not push others out', () => {
  // Leaving just before the line and rejoining just after: the short stretch holds the start line.
  const params = { ...DEFAULT_PARAMS, shortcuts: [{ from: .9, to: .1, via: [] }, { from: .3, to: .4, via: [] }, { from: .55, to: .7, via: [] }] };
  const track = generateTrack(oval(), params);
  expect(track.shortcuts.map((s: any) => Math.round(s.from * 100))).toEqual([30, 55]);
  expect(track.shortcutProblems).toEqual([expect.stringMatching(/^S1 skips the start line/)]);
  // Overlapping ones are both kept.
  const overlap = generateTrack(oval(), { ...DEFAULT_PARAMS, shortcuts: [{ from: .2, to: .4 }, { from: .3, to: .5 }] });
  expect(overlap.shortcutProblems).toEqual([]);
  expect(overlap.shortcuts).toHaveLength(2);
});

test('a shortcut with a height rises to it with ramps karts can climb, and is refused if too short', () => {
  const { samples, sampleStep, heightOffset } = trackSamples(oval(), DEFAULT_PARAMS);
  const P = { ...DEFAULT_PARAMS, step: sampleStep, heightOffset }, frames = roadFrames(samples, P);
  const built = (height?: number) => buildShortcuts(frames, { ...P, shortcuts: [{ from: .3, to: .45, via: [{ x: 0, z: 0 }], height }] });
  const { shortcuts } = built(1500), branch = shortcuts[0].frames;
  expect(branch[branch.length >> 1].c[1] - heightOffset).toBeCloseTo(1502, 0);
  for (let i = 1; i < branch.length; i++) {
    const a = branch[i - 1].c, b = branch[i].c;
    expect(Math.abs(b[1] - a[1]) / Math.hypot(b[0] - a[0], b[2] - a[2])).toBeLessThan(.4);
  }
  const refused = built(30000);
  expect(refused.shortcuts).toHaveLength(0);
  expect(refused.problems[0]).toMatch(/too short to reach height/);
});

test('walls close where a shortcut meets the main road', () => {
  const { samples, sampleStep, heightOffset } = trackSamples(oval(), DEFAULT_PARAMS);
  const P = { ...DEFAULT_PARAMS, step: sampleStep, heightOffset }, frames = roadFrames(samples, P);
  const { shortcuts } = buildShortcuts(frames, { ...P, shortcuts: [{ from: .3, to: .45, via: [{ x: 0, z: 0 }] }] });
  const gaps = shortcutWallGaps(frames, shortcuts, P), walls = shortcutWalls(frames, shortcuts[0].frames, P);
  expect(gaps.size).toBeGreaterThan(0);
  // Each side of the shortcut has a wall that starts within the main road's verges, so it meets
  // the main road's wall, which is open only across the shortcut's road.
  for (const side of [0, 1]) {
    const first = walls.findIndex((w: boolean[]) => w[side]), last = walls.length - 1 - [...walls].reverse().findIndex((w: boolean[]) => w[side]);
    expect(first).toBeGreaterThan(0);
    expect(last).toBeLessThan(walls.length - 1);
    for (let i = first; i <= last; i++) expect(walls[i][side]).toBe(true);
  }
  for (const key of gaps) {
    const [k, side] = key.split(':').map(Number), f = frames[k], edge = side > 0 ? f.LO : f.RO;
    const nearest = Math.min(...shortcuts[0].frames.map((s: any) => Math.hypot(s.c[0] - edge[0], s.c[2] - edge[2])));
    expect(nearest).toBeLessThan(shortcuts[0].frames[0].half + P.step);
  }
});
