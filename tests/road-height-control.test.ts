import { expect, test } from 'bun:test';
import { DEFAULT_PARAMS, PRESETS, TRACK_BASE_HEIGHT, trackSamples, layoutIssues, generateTrack } from '../web/js/editor/trackgen.js';

const fixture = [[0, -13500], [10000, -13000], [9500, 2000], [23500, 500], [19500, 10500], [-3500, 5000], [500, 14500], [-4000, 14700], [-9500, 14300], [-18000, 10300], [-22000, 500], [-18000, -9700], [-9000, -13400]]
  .map(([x, z]) => ({ x, z, y: 0, w: 1 }));

test('moving and adding horizontal points on a flat layout never invents elevation by default', () => {
  expect(DEFAULT_PARAMS.autoBridges).toBe(false);
  const moved = fixture.map((p, i) => i === 5 ? { ...p, x: p.x + 3000, z: p.z - 2000 } : { ...p });
  const inserted = [...moved.slice(0, 2), { x: 14500, z: -7000, y: 0, w: 1 }, ...moved.slice(2)];
  for (const points of [fixture, moved, inserted]) {
    const { samples, bridges } = trackSamples(points);
    expect(bridges).toEqual([]);
    for (const sample of samples) expect(sample[1]).toBe(TRACK_BASE_HEIGHT);
    const track = generateTrack(points);
    for (const tri of track.model.tris.filter((t: any) => ['road', 'offroad', 'boost', 'startline'].includes(t.mat)))
      for (const i of [1, 4, 7]) expect(tri.v[i]).toBe(TRACK_BASE_HEIGHT);
  }
});

test('automatic bridges ignore close parallel hairpins even when enabled', () => {
  const hairpin = [[0, 0], [30000, 0], [31500, 1200], [30000, 2400], [0, 2400], [-1500, 1200]].map(([x, z]) => ({ x, z, y: 0, w: 1 }));
  const track = trackSamples(hairpin, { autoBridges: true });
  expect(track.bridges).toEqual([]); expect(track.crossings).toEqual([]);
  for (const sample of track.samples) expect(sample[1]).toBe(TRACK_BASE_HEIGHT);
});

test('a real flat crossing is reported and only gets a bridge when the option is enabled', () => {
  const flat = PRESETS['Figure eight']().map((p: any) => ({ ...p, y: 0 }));
  const manual = trackSamples(flat);
  expect(manual.bridges).toEqual([]); expect(manual.crossings.length).toBeGreaterThan(0);
  expect(layoutIssues(flat).some((i: any) => i.level === 'warning' && /Automatic bridges/.test(i.message))).toBe(true);
  for (const sample of manual.samples) expect(sample[1]).toBe(TRACK_BASE_HEIGHT);
  const automatic = trackSamples(flat, { autoBridges: true });
  expect(automatic.bridges.length).toBeGreaterThan(0);
  expect(Math.max(...automatic.samples.map((s: number[]) => s[1])) - Math.min(...automatic.samples.map((s: number[]) => s[1]))).toBeGreaterThan(1000);
  for (const sample of trackSamples(flat).samples) expect(sample[1]).toBe(TRACK_BASE_HEIGHT);
});

test('manual height controls still produce hills with automatic bridges disabled', () => {
  const points = PRESETS.Oval().map((p: any, i: number) => ({ ...p, y: i === 3 ? 1800 : 0 }));
  const { samples } = trackSamples(points);
  expect(Math.max(...samples.map((s: number[]) => s[1])) - Math.min(...samples.map((s: number[]) => s[1]))).toBeGreaterThan(1000);
});
