import { expect, test } from 'bun:test';
import { pointsFromStroke, sampleSpline, PRESETS, generateTrack } from '../web/js/editor/trackgen.js';
import { layoutBounds, resizeLayout } from '../web/js/editor/layout-points.js';

function distanceToLine(p: { x: number; z: number }, line: { x: number; z: number }[]) {
  let best = Infinity;
  for (let i = 0; i < line.length; i++) {
    const a = line[i], b = line[(i + 1) % line.length], dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz));
  }
  return best;
}

test('freehand retains small bends instead of reducing a complex loop to 24 evenly spaced points', () => {
  const stroke = Array.from({ length: 600 }, (_, i) => {
    const t = i / 600 * Math.PI * 2, r = 1 + .13 * Math.sin(t * 7);
    return { x: Math.cos(t) * 22000 * r, z: Math.sin(t) * 15000 * r };
  });
  const points = pointsFromStroke(stroke, { tolerance: 180 })!;
  expect(points).not.toBeNull(); expect(points.length).toBeGreaterThan(24); expect(points.length).toBeLessThanOrEqual(256);
  const curve = sampleSpline(points, 50).samples.map((p: number[]) => ({ x: p[0], z: p[2] }));
  for (const p of stroke) expect(distanceToLine(p, curve)).toBeLessThan(205);
  for (const p of curve) expect(distanceToLine(p, stroke)).toBeLessThan(205);
  expect(points[0]).toMatchObject({ ...stroke[0], y: 0, w: 1 });
});

test('freehand preserves corners and closes the loop without a duplicate control point', () => {
  const stroke = [{ x: 0, z: 0 }, { x: 28000, z: 0 }, { x: 28000, z: 18000 }, { x: 0, z: 18000 }, { x: 0, z: 0 }];
  const points = pointsFromStroke(stroke, { tolerance: 150 })!, curve = sampleSpline(points, 50).samples.map((p: number[]) => ({ x: p[0], z: p[2] }));
  expect(points[0]).not.toEqual(points.at(-1));
  for (const p of curve) expect(distanceToLine(p, stroke.slice(0, -1))).toBeLessThan(175);
  expect(pointsFromStroke([{ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 100, z: 100 }])).toBeNull();
  expect(pointsFromStroke(stroke, { tolerance: 1, maxPoints: 4 })).toBeNull();
});

test('hand tremor does not become small opposite bends inside a curve', () => {
  // Whole mouse pixels at 100 units each, plus a slow tremor of about a pixel or two.
  let seed = 12345, driftX = 0, driftZ = 0;
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const stroke = Array.from({ length: 900 }, (_, i) => {
    const t = i / 900 * Math.PI * 2;
    driftX = driftX * .85 + (random() - .5) * 1.2; driftZ = driftZ * .85 + (random() - .5) * 1.2;
    return { x: Math.round(Math.cos(t) * 260 + driftX) * 100, z: Math.round(Math.sin(t) * 180 + driftZ) * 100 };
  });
  const points = pointsFromStroke(stroke, { tolerance: 300 })!;
  const line = sampleSpline(points, 400).samples, n = line.length;
  const heading = (i: number) => Math.atan2(line[(i + 1) % n][2] - line[i][2], line[(i + 1) % n][0] - line[i][0]);
  const turns = line.map((_: any, i: number) => {
    let d = heading((i + 1) % n) - heading(i);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d * 180 / Math.PI;
  });
  expect(Math.max(...turns.map(Math.abs))).toBeLessThan(5);
  // An oval only turns one way.
  const sign = Math.sign(turns.reduce((sum: number, turn: number) => sum + turn, 0));
  expect(turns.filter((turn: number) => turn * sign < -1)).toEqual([]);
  // The drawing keeps its size and start.
  expect(Math.max(...points.map((p: any) => p.x))).toBeGreaterThan(25000);
  expect(points[0]).toMatchObject({ ...stroke[0] });
});

test('map dimensions resize real geometry around its centre and retain road widths and heights', () => {
  const points = PRESETS.Oval().map((p: any, i: number) => ({ ...p, y: i * 100, w: 1 + i * .02 }));
  const before = layoutBounds(points), changed = resizeLayout(points, 88000, 39000), after = layoutBounds(changed);
  expect(after).toEqual({ cx: before.cx, cz: before.cz, width: 88000, depth: 39000 });
  expect(changed.map((p: any) => [p.y, p.w])).toEqual(points.map((p: any) => [p.y, p.w]));
  expect(layoutBounds(points)).toEqual(before);
  const old = generateTrack(points), next = generateTrack(changed);
  const modelWidth = (t: any) => { const xs = t.model.tris.filter((f: any) => ['road', 'startline', 'boost'].includes(f.mat)).flatMap((f: any) => [f.v[0], f.v[3], f.v[6]]); return Math.max(...xs) - Math.min(...xs); };
  expect(modelWidth(next)).toBeGreaterThan(modelWidth(old) * 1.8);
  expect(() => resizeLayout(points, 0, 1000)).toThrow();
  expect(() => resizeLayout(points, NaN, 1000)).toThrow();
});
