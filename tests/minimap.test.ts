import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { prepareBundledTools } from "../src/bundled-tools.ts";
import { buildMinimapModel } from "../src/generated-track-models.ts";
import { forEachMinimapTriangle, minimapAlong, MINIMAP_HIDDEN, minimapRoute, minimapRoutePlace, minimapStretchTriangles } from "../web/js/editor/minimap.js";
import { TRACK_NAMES } from "../web/js/data/defs.js";
import { buildMinimapSource, generateMinimapDesign, MINIMAP_ELEMENT, minimapElements, minimapSourceCounts, minimapTrack, minimapTriangleCount, readMinimap, roadOnlySources, seedMinimapDesign, setMinimapBounds, setMinimapColors, setMinimapSwatchColor, smoothMinimapEdges, trackLocator } from "../web/js/editor/minimap.js";
import { generateTrack, DEFAULT_PARAMS, PRESETS } from "../web/js/editor/trackgen.js";
import { parseKCL } from "../web/js/formats/kcl.js";
import { parseKMP } from "../web/js/formats/kmp.js";
import { findFile, parseU8 } from "../web/js/formats/u8.js";
import { yaz0Decompress } from "../web/js/formats/yaz0.js";

// Each collision triangle as one piece, where a test is about the triangles themselves.
const WHOLE = { cell: Infinity };

// Two connected road triangles, one boost joined to them, a separate off-road triangle and a wall.
function fakeKCL() {
  const tris = [
    [0, 0, 0, 1000, 0, 0, 0, 0, 1000, 0],
    [1000, 0, 0, 1000, 0, 1000, 0, 0, 1000, 0],
    [1000, 0, 0, 2000, 0, 0, 1000, 0, 1000, 6],
    [5000, 500, 0, 6000, 500, 0, 5000, 500, 1000, 3],
    [0, 0, 0, 1000, 0, 0, 0, 900, 0, 0x0c],
  ];
  return { count: tris.length, flags: Uint16Array.from(tris.map((t) => t[9])), verts: Float32Array.from(tris.flatMap((t) => t.slice(0, 9))), valid: null };
}

async function withTools(run: () => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "mkwii-minimap-test-"));
  const oldAbmatt = process.env.MKWII_ABMATT, oldWiimm = process.env.MKWII_WSZST, oldPath = process.env.PATH;
  try {
    await prepareBundledTools(dir);
    await run();
  } finally {
    if (oldAbmatt === undefined) delete process.env.MKWII_ABMATT; else process.env.MKWII_ABMATT = oldAbmatt;
    if (oldWiimm === undefined) delete process.env.MKWII_WSZST; else process.env.MKWII_WSZST = oldWiimm;
    process.env.PATH = oldPath;
    if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe minimap test directory");
    await rm(dir, { recursive: true, force: true });
  }
}

test("the track for painting keeps driveable faces and separates its parts by surface", () => {
  const track = minimapTrack(fakeKCL(), [], WHOLE)!;
  expect(track.count).toBe(4); // the wall has no driveable surface
  expect(track.piece[0]).toBe(track.piece[1]);
  expect(track.piece[2]).not.toBe(track.piece[0]); // the boost is another surface
  expect(track.parts.size).toBe(3);
  const locate = trackLocator(track);
  expect(locate(100, 100)).toBe(0);
  expect(locate(5100, 100)).toBe(3);
  expect(locate(3000, 100)).toBe(-1);
});

test("a small stroke on one huge floor triangle paints only that place", () => {
  // Half of a battle arena's floor, as one collision triangle.
  const kcl = { count: 1, flags: Uint16Array.from([0]), verts: Float32Array.from([0, 0, 0, 30000, 0, 0, 0, 0, 30000]), valid: null };
  const track = minimapTrack(kcl)!;
  expect(track.sources).toBe(1);
  expect(track.count).toBeGreaterThan(1000);
  const area = (v: ArrayLike<number>, o: number) => Math.abs((v[o + 3] - v[o]) * (v[o + 8] - v[o + 2]) - (v[o + 5] - v[o + 2]) * (v[o + 6] - v[o])) / 2;
  let total = 0;
  for (let i = 0; i < track.count; i++) total += area(track.verts, i * 9);
  expect(total).toBeCloseTo(30000 * 30000 / 2, -4);
  // Pieces keep the source's height and facing.
  const locate = trackLocator(track), hit = locate(5000, 5000);
  expect(hit).toBeGreaterThanOrEqual(0);
  const assign = new Int16Array(track.count).fill(-1);
  assign[hit] = 0;
  const tones = [{ hex: "#ffffff", source: null, editable: true }];
  const stroke = buildMinimapSource(track, assign, tones);
  expect(stroke.tris).toHaveLength(1);
  expect(area(stroke.tris[0].v, 0)).toBeLessThan(total / 1000);
  // Whole again when all of it has one colour: painting does not inflate the map.
  assign.fill(0);
  const whole = buildMinimapSource(track, assign, tones);
  expect(whole.tris).toHaveLength(1);
  expect(area(whole.tris[0].v, 0)).toBeCloseTo(total, -4);
});

test("smooth edges rounds a painted stroke's stair-steps and leaves real outlines", () => {
  const kcl = { count: 2, flags: Uint16Array.from([0, 0]), verts: Float32Array.from([0, 0, 0, 30000, 0, 0, 0, 0, 30000, 30000, 0, 0, 30000, 0, 30000, 0, 0, 30000]), valid: null };
  const track = minimapTrack(kcl)!, locate = trackLocator(track);
  const baseline = new Int16Array(track.count).fill(0), assign = baseline.slice();
  // A round hole, as an eraser stroke leaves it.
  const [cx, cz, radius] = [15000, 15000, 4000];
  for (const i of locate.within(cx, cz, radius)) assign[i] = -1;
  const tones = [{ hex: "#ffffff", source: null, editable: true }];
  const outline = (offsets: Map<string, number[]> | null) => {
    const tris = buildMinimapSource(track, assign, tones, offsets).tris;
    let area = 0;
    for (const { v } of tris) area += Math.abs((v[3] - v[0]) * (v[8] - v[2]) - (v[5] - v[2]) * (v[6] - v[0])) / 2;
    // Measured on the pieces, where corners are shared: what is sent to the game has joined them.
    // An edge used by one piece only is an outline; those near the middle belong to the hole.
    const edges = new Map<string, { length: number; uses: number }>();
    for (let i = 0; i < track.count; i++) {
      if (assign[i] < 0) continue;
      const v = Array.from({ length: 9 }, (_, c) => track.verts[i * 9 + c]);
      for (let c = 0; c < 9; c += 3) {
        const shift = offsets?.get(`0/${Math.round(v[c])}/${Math.round(v[c + 2])}`);
        if (shift) { v[c] += shift[0]; v[c + 2] += shift[1]; }
      }
      const point = (c: number) => `${Math.round(v[c * 3])}/${Math.round(v[c * 3 + 2])}`;
      for (let c = 0; c < 3; c++) {
        const d = (c + 1) % 3, key = [point(c), point(d)].sort().join("|");
        if (Math.hypot(v[c * 3] - cx, v[c * 3 + 2] - cz) > radius * 1.5 || Math.hypot(v[d * 3] - cx, v[d * 3 + 2] - cz) > radius * 1.5) continue;
        const edge = edges.get(key) || { length: Math.hypot(v[c * 3] - v[d * 3], v[c * 3 + 2] - v[d * 3 + 2]), uses: 0 };
        edge.uses++;
        edges.set(key, edge);
      }
    }
    let perimeter = 0;
    for (const edge of edges.values()) if (edge.uses === 1) perimeter += edge.length;
    return { area, perimeter, tris: tris.length };
  };
  const before = outline(null);
  const { offsets, moved } = smoothMinimapEdges(track, assign, baseline);
  expect(moved).toBeGreaterThan(20);
  const after = outline(offsets);
  // The stair-steps go: a shorter way round, closer to the circle's own length.
  expect(before.perimeter).toBeGreaterThan(2 * Math.PI * radius * 1.03);
  expect(after.perimeter).toBeLessThan(before.perimeter * .97);
  // Close to the same area: the hole does not close up or grow. It takes more triangles to draw,
  // since a rounded edge can't be joined up as a straight one can, but not all the pieces.
  expect(after.tris).toBeGreaterThanOrEqual(before.tris);
  expect(after.tris).toBeLessThan(track.count);
  expect(Math.abs(after.area - before.area) / before.area).toBeLessThan(.01);
  // Only the hole's own vertices move: the floor's outline stays where it is.
  expect(offsets.size).toBeGreaterThan(20);
  for (const key of offsets.keys()) {
    const [, x, z] = key.split("/").map(Number);
    expect(Math.hypot(x - cx, z - cz)).toBeLessThan(radius + track.cell * 8);
  }
  // A stroke across the border of two collision triangles stays closed there: no gap opens.
  const borderKcl = { count: 2, flags: Uint16Array.from([0, 0]), verts: Float32Array.from([0, 0, 0, 30000, 0, 0, 0, 0, 30000, 30000, 0, 0, 30000, 0, 30000, 0, 0, 30000]), valid: null };
  const border = minimapTrack(borderKcl, [], { cell: 1000 })!, borderLocate = trackLocator(border);
  const before2 = new Int16Array(border.count).fill(0), after2 = before2.slice();
  // The two triangles meet on the diagonal from (30000, 0) to (0, 30000): this stroke crosses it.
  for (let t = 0; t <= 1; t += .02) for (const i of borderLocate.within(11000 + 8000 * t, 11000 + 8000 * t, 900)) after2[i] = -1;
  const crossing = smoothMinimapEdges(border, after2, before2);
  for (const [key, shift] of crossing.offsets) {
    const [, x, z] = key.split("/").map(Number);
    // A vertex on the diagonal may only slide along it.
    if (Math.abs(x + z - 30000) < 2) expect(Math.abs(shift[0] + shift[1])).toBeLessThan(.01);
  }
  expect([...crossing.offsets.keys()].some((key) => { const [, x, z] = key.split("/").map(Number); return Math.abs(x + z - 30000) < 2; })).toBe(true);

  // Slow waves go too, as a hand leaves them along a long stroke, without moving the stroke away.
  const wave = { count: 2, flags: Uint16Array.from([0, 0]), verts: Float32Array.from([0, 0, 0, 60000, 0, 0, 0, 0, 60000, 60000, 0, 0, 60000, 0, 60000, 0, 0, 60000]), valid: null };
  const waved = minimapTrack(wave, [], { cell: 400 })!, waveLocate = trackLocator(waved);
  const clean = new Int16Array(waved.count).fill(-1), stroke = clean.slice();
  const line = (x: number) => 20000 + Math.sin(x / 700) * 500;
  for (let x = 6000; x <= 22000; x += 100) for (const i of waveLocate.within(x, line(x), 900)) stroke[i] = 0;
  const waveOffsets = smoothMinimapEdges(waved, stroke, clean);
  const wiggle = (offsets: Map<string, number[]> | null) => {
    // Height of the stroke's upper edge along its middle: how much it still goes up and down.
    const top = new Map<number, number>();
    for (const { v } of buildMinimapSource(waved, stroke, [{ hex: "#ffffff" }], offsets).tris) for (let c = 0; c < 9; c += 3) {
      if (v[c] < 9000 || v[c] > 19000) continue;
      const column = Math.round(v[c] / 400);
      top.set(column, Math.min(top.get(column) ?? Infinity, v[c + 2]));
    }
    const heights = [...top.entries()].sort((a, b) => a[0] - b[0]).map((entry) => entry[1]);
    let travel = 0;
    for (let i = 1; i < heights.length; i++) travel += Math.abs(heights[i] - heights[i - 1]);
    return { travel, mean: heights.reduce((sum, value) => sum + value, 0) / heights.length };
  };
  const rough = wiggle(null), smooth = wiggle(waveOffsets.offsets);
  expect(smooth.travel).toBeLessThan(rough.travel);
  expect(Math.abs(smooth.mean - rough.mean)).toBeLessThan(200);
  // The level is how much: more takes out more, and going back down returns exactly.
  const levels = [1, 5, 10].map((level) => smoothMinimapEdges(waved, stroke, clean, new Map(), level).offsets);
  const [low, middle, high] = levels.map((level) => wiggle(level).travel);
  expect(low).toBeGreaterThan(middle);
  expect(middle).toBeGreaterThan(high);
  expect(high).toBeLessThan(rough.travel * .4);
  expect([...smoothMinimapEdges(waved, stroke, clean, levels[2], 1).offsets]).toEqual([...levels[0]]);

  // Even at the strongest level a dot stays a dot, and a stroke stays as wide as it was painted.
  const areaOf = (offsets: Map<string, number[]> | null, tones2: Int16Array) => {
    let total = 0;
    for (const { v } of buildMinimapSource(waved, tones2, [{ hex: "#ffffff" }], offsets).tris) total += Math.abs((v[3] - v[0]) * (v[8] - v[2]) - (v[5] - v[2]) * (v[6] - v[0])) / 2;
    return total;
  };
  const dot = clean.slice();
  for (const i of waveLocate.within(30000, 12000, 800)) dot[i] = 0;
  const dotArea = areaOf(null, dot), smoothedDot = areaOf(smoothMinimapEdges(waved, dot, clean, new Map(), 10).offsets, dot);
  expect(smoothedDot).toBeGreaterThan(dotArea * .75);
  const strokeArea = areaOf(null, stroke), smoothedStroke = areaOf(levels[2], stroke);
  expect(Math.abs(smoothedStroke - strokeArea) / strokeArea).toBeLessThan(.1);

  // Edges that were not painted stay: nothing to do on an untouched map, however its colours lie.
  const twoTones = baseline.slice();
  for (let i = 0; i < track.count / 2; i++) twoTones[i] = 1;
  expect(smoothMinimapEdges(track, twoTones, twoTones).moved).toBe(0);
  // Pressing again changes nothing: the level alone decides. The first result stays as it was, for undo.
  const copy = new Map(offsets);
  expect(smoothMinimapEdges(track, assign, baseline, offsets).moved).toBe(0);
  expect([...offsets]).toEqual([...copy]);
});

// A square lap of road 1000 wide, 8000 a side, with a road crossing over one side on a higher level.
function squareLap() {
  const quad = (x0: number, z0: number, x1: number, z1: number, y = 0) => [[x0, y, z0, x1, y, z0, x0, y, z1, 0], [x1, y, z0, x1, y, z1, x0, y, z1, 0]];
  const tris = [...quad(-500, -500, 8500, 500), ...quad(7500, 500, 8500, 8500), ...quad(-500, 7500, 7500, 8500), ...quad(-500, 500, 500, 7500), ...quad(3500, 3000, 4500, 12000, 3000)];
  const kcl = { count: tris.length, flags: Uint16Array.from(tris.map((t) => t[9])), verts: Float32Array.from(tris.flatMap((t) => t.slice(0, 9))), valid: null };
  const point = (x: number, z: number) => ({ pos: [x, 0, z], width: 10 });
  const kmp = { ENPT: [{ points: [point(0, 0), point(8000, 0), point(8000, 8000), point(0, 8000)], next: [0] }], AREA: [], GOBJ: [], CKPT: [], ITPT: [], POTI: [], KTPT: [] };
  return { kcl, kmp };
}

test("the route's distance runs round the lap, closing back at its start", () => {
  const { kmp } = squareLap();
  const route = minimapRoute(kmp)!;
  expect(route.length).toBe(32000);
  expect(route.segments.map((s: any) => [s.from, s.to])).toEqual([[0, 8000], [8000, 16000], [16000, 24000], [24000, 32000]]);
  // Clicks land on the nearest place of the route, and off the road give nothing.
  const place = minimapRoutePlace(route, 2000, 200)!;
  expect(place.distance).toBe(2000);
  expect(place.left[0]).toBeCloseTo(2000);
  expect(Math.abs(place.left[1] - place.right[1])).toBe(2000);
  expect(minimapRoutePlace(route, 4000, 4000)).toBeNull();
  expect(minimapRoute({ ENPT: [] })).toBeNull();
});

test("branches take the part of the lap between where they leave it and where they join it", () => {
  const point = (x: number, z: number) => ({ pos: [x, 0, z], width: 10 });
  const kmp = { ENPT: [
    { points: [point(0, 0), point(1000, 0)], next: [1, 3] },
    { points: [point(2000, 0), point(3000, 0)], next: [2] },
    { points: [point(3000, 2000), point(0, 2000)], next: [0] },
    { points: [point(2000, 1000), point(3000, 1000)], next: [2] },
  ] };
  const route = minimapRoute(kmp)!;
  const branch = route.segments.filter((s: any) => s.a[2] === 1000);
  const before = route.segments.find((s: any) => s.b[0] === 2000 && s.b[2] === 0);
  const rejoin = route.segments.find((s: any) => s.a[0] === 3000 && s.a[2] === 2000);
  expect(branch.length).toBeGreaterThan(0);
  expect(route.segments.find((s: any) => s.b[2] === 1000 && s.a[2] === 0)!.from).toBe(before.from);
  expect(route.segments.filter((s: any) => s.b[0] === 3000 && s.b[2] === 2000).every((s: any) => Math.abs(s.to - rejoin.from) < .01)).toBe(true);
});

test("a stretch runs from start to end in the direction of driving, over the line if need be", () => {
  const { kcl, kmp } = squareLap();
  const track: any = minimapTrack(kcl, [], {}), route = minimapRoute(kmp)!, along = minimapAlong(track, route);
  const all = new Int16Array(track.count).fill(0);
  const places = (start: number, end: number) => minimapStretchTriangles(all, along, start, end);
  const centre = (i: number) => [(track.verts[i * 9] + track.verts[i * 9 + 3] + track.verts[i * 9 + 6]) / 3, (track.verts[i * 9 + 1] + track.verts[i * 9 + 4] + track.verts[i * 9 + 7]) / 3, (track.verts[i * 9 + 2] + track.verts[i * 9 + 5] + track.verts[i * 9 + 8]) / 3];
  // The first side only.
  const first = places(1000, 7000);
  expect(first.length).toBeGreaterThan(0);
  for (const i of first) { const [x, , z] = centre(i); expect(z).toBeLessThanOrEqual(600); expect(x).toBeGreaterThanOrEqual(900); expect(x).toBeLessThanOrEqual(7100); }
  // Starting past the end goes over the line: the rest of the lap, with nothing of the first stretch.
  const rest = places(7000, 1000), both = new Set(first);
  expect(rest.length).toBeGreaterThan(first.length);
  for (const i of rest) if (centre(i)[1] < 100) expect(both.has(i) && along[i] !== 1000 && along[i] !== 7000).toBe(false);
  expect(rest.some((i) => centre(i)[2] > 7000)).toBe(true);
  expect(rest.some((i) => centre(i)[0] < 500 && centre(i)[2] < 400)).toBe(true);
  // The road passing over the first side, high up and off the route, is not part of the first side.
  const bridge = (i: number) => centre(i)[1] > 2000;
  expect(first.some(bridge)).toBe(false);
  // Only what is on the map: nothing is added.
  const someHidden = new Int16Array(track.count).fill(0);
  for (const i of first.slice(0, 5)) someHidden[i] = MINIMAP_HIDDEN;
  const shown = minimapStretchTriangles(someHidden, along, 1000, 7000);
  expect(shown.length).toBe(first.length - 5);
});

test("marks on the map belong to no stretch, and a file's own triangles go by where they are", () => {
  const { kcl, kmp } = squareLap();
  const elements = [{ kind: MINIMAP_ELEMENT.OBJECT, tris: [[100, 100, 200, 100, 100, 200]] }];
  const track: any = minimapTrack(kcl, elements, {}), route = minimapRoute(kmp)!, along = minimapAlong(track, route);
  for (let i = 0; i < track.count; i++) if (track.element[i]) expect(along[i]).toBe(-1);
  // From a file, with a height that means nothing: it is placed by the map alone.
  const map = { tris: [{ p: [3000, 0, 3100, 0, 3000, 100], y: 90000, swatch: 0 }], swatches: [] };
  const fromFile: any = minimapTrack(null, [], { map });
  const placed = minimapAlong(fromFile, route);
  expect(placed[0]).toBeGreaterThan(2900);
  expect(placed[0]).toBeLessThan(3200);
});

test("colours meeting at a stretch's end are smoothed like painted edges", () => {
  const { kcl, kmp } = squareLap();
  const track: any = minimapTrack(kcl, [], {}), route = minimapRoute(kmp)!, along = minimapAlong(track, route);
  const assign = new Int16Array(track.count).fill(0), baseline = assign.slice();
  for (const i of minimapStretchTriangles(assign, along, 1000, 7000)) assign[i] = 1;
  const { offsets } = smoothMinimapEdges(track, assign, baseline, new Map());
  expect(offsets.size).toBeGreaterThan(0);
});

// One big triangle, cut into many pieces for painting.
function bigSource() {
  const kcl = { count: 1, flags: Uint16Array.from([0]), verts: Float32Array.from([0, 10, 0, 8000, 90, 0, 0, 170, 8000]), valid: null };
  return minimapTrack(kcl, [], { cell: 400 }) as any;
}
const inside = (p: ArrayLike<number>, at: number, x: number, z: number) => {
  const area = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number) => (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
  const a = area(p[at], p[at + 2], p[at + 3], p[at + 5], x, z), b = area(p[at + 3], p[at + 5], p[at + 6], p[at + 8], x, z), c = area(p[at + 6], p[at + 8], p[at], p[at + 2], x, z);
  return (a >= -1e-3 && b >= -1e-3 && c >= -1e-3) || (a <= 1e-3 && b <= 1e-3 && c <= 1e-3);
};
// What is drawn: each piece's middle is covered in its own colour and height, and the areas add up.
function expectSameMap(track: any, assign: Int16Array) {
  const drawn: { tone: number; p: number[] }[] = [];
  forEachMinimapTriangle(track, assign, (tone: number, v: ArrayLike<number>, o: number) => { drawn.push({ tone, p: Array.from({ length: 9 }, (_, c) => v[o + c]) }); });
  const areaOf = (p: ArrayLike<number>, at = 0) => Math.abs((p[at + 3] - p[at]) * (p[at + 8] - p[at + 2]) - (p[at + 6] - p[at]) * (p[at + 5] - p[at + 2])) / 2;
  const wanted = new Map<number, number>(), got = new Map<number, number>();
  for (let i = 0; i < track.count; i++) if (assign[i] >= 0) {
    wanted.set(assign[i], (wanted.get(assign[i]) || 0) + areaOf(track.verts, i * 9));
    const o = i * 9, v = track.verts, x = (v[o] + v[o + 3] + v[o + 6]) / 3, y = (v[o + 1] + v[o + 4] + v[o + 7]) / 3, z = (v[o + 2] + v[o + 5] + v[o + 8]) / 3;
    // More than one only on the shared side of two triangles, which the areas below would show otherwise.
    const over = drawn.filter((tri) => inside(tri.p, 0, x, z));
    expect(over.length).toBeGreaterThan(0);
    expect(over.every((tri) => tri.tone === assign[i])).toBe(true);
    // On the same plane as before.
    const q = over[0].p, d = (q[3] - q[0]) * (q[8] - q[2]) - (q[6] - q[0]) * (q[5] - q[2]);
    const u = ((x - q[0]) * (q[8] - q[2]) - (q[6] - q[0]) * (z - q[2])) / d, w = ((q[3] - q[0]) * (z - q[2]) - (x - q[0]) * (q[5] - q[2])) / d;
    expect(Math.abs(q[1] + (q[4] - q[1]) * u + (q[7] - q[1]) * w - y)).toBeLessThan(.5);
  }
  for (const { tone, p } of drawn) got.set(tone, (got.get(tone) || 0) + areaOf(p));
  for (const [tone, area] of wanted) expect(Math.abs((got.get(tone) || 0) - area) / area).toBeLessThan(.001);
  expect([...got.keys()].every((tone) => wanted.has(tone))).toBe(true);
  return drawn.length;
}

test("a stroke's pieces are joined by colour: the same map from far fewer triangles", () => {
  const track = bigSource();
  expect(track.count).toBeGreaterThan(300);
  const assign = new Int16Array(track.count).fill(0);
  // One tone, or none: the source itself.
  expect(expectSameMap(track, assign)).toBe(1);
  // A small dab: costs what its edge needs, not all the pieces of the source.
  const locate = trackLocator(track);
  for (const hit of locate.within(2500, 2500, 300, () => true)) assign[hit] = 1;
  const dab = expectSameMap(track, assign);
  expect(dab).toBeLessThan(track.count / 4);
  expect(dab).toBeLessThan(60);
  // A stroke across all of it costs about its edge too.
  for (let x = 200; x < 5500; x += 100) for (const hit of locate.within(x, 2000, 300, () => true)) assign[hit] = 1;
  const stroke = expectSameMap(track, assign);
  expect(stroke).toBeLessThan(track.count / 2);
  // Off the map is off it, in the middle too.
  for (const hit of locate.within(1500, 1500, 500, () => true)) assign[hit] = MINIMAP_HIDDEN;
  expectSameMap(track, assign);
  // Half of it, along a straight line of the grid: only a few triangles.
  const half = new Int16Array(track.count).fill(0);
  for (let i = 0; i < track.count; i++) if ((track.verts[i * 9] + track.verts[i * 9 + 3] + track.verts[i * 9 + 6]) / 3 < 2000) half[i] = 1;
  expect(expectSameMap(track, half)).toBeLessThanOrEqual(6);
});

test("any pattern of colours comes out the same, however scattered", () => {
  const track = bigSource();
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const tones of [2, 3, 5]) {
    const assign = Int16Array.from({ length: track.count }, () => { const pick = Math.floor(random() * (tones + 1)); return pick === tones ? MINIMAP_HIDDEN : pick; });
    const count = expectSameMap(track, assign);
    // Scattered as it can be, it is never more than the pieces themselves.
    expect(count).toBeLessThanOrEqual(track.count);
  }
});

test("pieces with a corner moved by smoothing keep it, and only those stay small", () => {
  const track = bigSource(), locate = trackLocator(track);
  const assign = new Int16Array(track.count).fill(0), baseline = assign.slice();
  for (const hit of locate.within(2500, 2500, 800, () => true)) assign[hit] = 1;
  const plain = minimapTriangleCount(track, assign);
  const { offsets } = smoothMinimapEdges(track, assign, baseline, new Map());
  expect(offsets.size).toBeGreaterThan(0);
  // Every moved corner is drawn where it went, so the rounded edge is really there.
  const corners = new Set<string>();
  let count = 0;
  forEachMinimapTriangle(track, assign, (_tone: number, v: ArrayLike<number>, o: number) => { count++; for (let c = 0; c < 9; c += 3) corners.add(`${Math.round(v[o + c])}/${Math.round(v[o + c + 2])}`); }, offsets);
  let moved = 0;
  for (let i = 0; i < track.count * 9; i += 3) {
    const shift = offsets.get(`0/${Math.round(track.verts[i])}/${Math.round(track.verts[i + 2])}`);
    // Moves under a pixel of a map count as none.
    if (!shift || Math.hypot(shift[0], shift[1]) < 60) continue;
    moved++;
    expect(corners.has(`${Math.round(track.verts[i] + shift[0])}/${Math.round(track.verts[i + 2] + shift[1])}`)).toBe(true);
  }
  expect(moved).toBeGreaterThan(0);
  expect(count).toBeGreaterThanOrEqual(plain);
  expect(count).toBeLessThan(track.count);
  // And no crack opens: the area of the map is still the area of its pieces, moved.
  const areaOf = (v: ArrayLike<number>, o: number) => Math.abs((v[o + 3] - v[o]) * (v[o + 8] - v[o + 2]) - (v[o + 6] - v[o]) * (v[o + 5] - v[o + 2])) / 2;
  let shown = 0, bare = 0;
  forEachMinimapTriangle(track, assign, (_tone: number, v: ArrayLike<number>, o: number) => { shown += areaOf(v, o); }, offsets);
  forEachMinimapTriangle(track, assign, (_tone: number, v: ArrayLike<number>, o: number) => { bare += areaOf(v, o); });
  expect(Math.abs(shown - bare) / bare).toBeLessThan(.01);
});

const gameDir = process.env.MKWII_GAME_DIR;
test("on the game's maps a long stroke stays near what they already have", async () => {
  if (!gameDir) return;
  const stems = Object.keys(TRACK_NAMES).filter((stem) => existsSync(join(gameDir, "Race", "Course", `${stem}.szs`)));
  let before = 0, after = 0, tracks = 0;
  for (const stem of stems) {
    const tree = parseU8(yaz0Decompress(new Uint8Array(await readFile(join(gameDir, "Race", "Course", `${stem}.szs`)))));
    const kmp = parseKMP(findFile(tree, "course.kmp").data), kcl = parseKCL(findFile(tree, "course.kcl").data);
    const file = findFile(tree, "map_model.brres");
    if (!file) continue;
    const map = readMinimap(file.data), track: any = minimapTrack(kcl, minimapElements(kmp), { map });
    const design = seedMinimapDesign(track, map), assign = design.assign.slice(), locate = trackLocator(track);
    const points = kmp.ENPT.flatMap((group: any) => group.points).map((point: any) => point.pos);
    if (points.length < 10) continue;
    const tone = design.tones.length;
    for (let i = Math.floor(points.length * .4); i < Math.floor(points.length * .6); i++) for (let t = 0; t < 1; t += .1) {
      const x = points[i][0] + (points[i + 1][0] - points[i][0]) * t, z = points[i][2] + (points[i + 1][2] - points[i][2]) * t;
      for (const hit of locate.within(x, z, 450, (piece: number) => assign[piece] >= 0)) assign[hit] = tone;
    }
    before += minimapTriangleCount(track, design.assign);
    after += minimapTriangleCount(track, assign);
    tracks++;
  }
  expect(tracks).toBeGreaterThan(20);
  // A stroke along a fifth of the lap, on average. It cost 6.6 times the map when pieces were kept whole.
  expect(after / before).toBeLessThan(3);
}, 120000);

test("the painted grain stays within what the editor can redraw", () => {
  const kcl = { count: 2, flags: Uint16Array.from([0, 0]), verts: Float32Array.from([0, 0, 0, 900000, 0, 0, 0, 0, 900000, 900000, 0, 0, 900000, 0, 900000, 0, 0, 900000]), valid: null };
  expect(minimapTrack(kcl)!.count).toBeLessThanOrEqual(120000);
});

test("without a map the road and boosts start on it and off-road does not", () => {
  const track = minimapTrack(fakeKCL(), [], WHOLE)!, { tones, assign } = seedMinimapDesign(track, null);
  expect(tones).toHaveLength(1);
  expect([...assign]).toEqual([0, 0, 0, -1]);
});

function fakeKMP() {
  const point = (x: number, z: number) => ({ pos: [x, 0, z] });
  return {
    ENPT: [{ points: [point(0, 0), point(0, 800)], next: [1] }, { points: [point(800, 800)], next: [0] }],
    CKPT: [{ points: [{ left: [100, 200], right: [900, 200], type: 0 }] }],
    KTPT: [point(500, 500)],
    GOBJ: [{ ...point(300, 300), objectId: 0x65 }, { ...point(600, 300), objectId: 0x12 }],
  };
}

test("placed elements become parts above the road, generated from the sources chosen", () => {
  const track = minimapTrack(fakeKCL(), minimapElements(fakeKMP()), WHOLE)!;
  const counts = minimapSourceCounts(track);
  expect(counts).toEqual({ road: 2, boost: 1, offroad: 1, line: 2, objects: 2, itemBoxes: 2, route: 6 });
  const box = [...track.element].indexOf(MINIMAP_ELEMENT.ITEM_BOX);
  expect(track.parts.get(track.piece[box])).toHaveLength(2);
  // Above the highest road, so the object wins where they overlap.
  expect(track.meanY(box)).toBeGreaterThan(500);
  const { tones, assign } = generateMinimapDesign(track, [{ id: "road", hex: "#ffffff" }, { id: "itemBoxes", hex: "#ff0000" }, { id: "boost", hex: "#ffffff" }]);
  expect(tones.map((tone: any) => tone.hex)).toEqual(["#ffffff", "#ff0000"]);
  expect(assign[0]).toBe(0);
  expect(assign[2]).toBe(0);
  expect(assign[3]).toBe(-1);
  expect(assign[box]).toBe(1);
  expect(assign[[...track.element].indexOf(MINIMAP_ELEMENT.OBJECT)]).toBe(-1);
  const source = buildMinimapSource(track, assign, tones);
  expect(source.tris).toHaveLength(5);
  for (const { v } of source.tris) expect((v[5] - v[2]) * (v[6] - v[0]) - (v[3] - v[0]) * (v[8] - v[2])).toBeGreaterThan(0);
});

test("road only leaves out stray pieces, off-road and elements, and keeps patches cut into the road", () => {
  const road = [0, 0, 0, 20000, 0, 0, 0, 0, 20000, 20000, 0, 0, 20000, 0, 20000, 0, 0, 20000];
  // A boost set into the road's edge with no shared corner, a small piece far off, and off-road.
  const patch = [5000, 0, 20000, 6000, 0, 20000, 5000, 0, 21000];
  const stray = [40000, 0, 40000, 40500, 0, 40000, 40000, 0, 40500];
  const grass = [0, 0, 30000, 9000, 0, 30000, 0, 0, 39000];
  const verts = Float32Array.from([...road, ...patch, ...stray, ...grass]);
  const kcl = { count: 5, flags: Uint16Array.from([0, 0, 6, 0, 3]), verts, valid: null };
  const track = minimapTrack(kcl, minimapElements(fakeKMP()), WHOLE)!;
  const sources = roadOnlySources(track);
  expect(sources.map((s: any) => s.id)).toEqual(["road", "boost"]);
  const { tones, assign } = generateMinimapDesign(track, sources);
  expect(tones.map((tone: any) => tone.hex)).toEqual(["#ffffff"]);
  expect([...assign].slice(0, 5)).toEqual([0, 0, 0, -1, -1]);
  expect([...track.element].filter((kind, i) => kind && assign[i] >= 0)).toEqual([]);
  expect(minimapSourceCounts(track)).toMatchObject({ road: 2, boost: 1, offroad: 1 });
  // A track without collision has only its route to show.
  expect(roadOnlySources(minimapTrack(null, minimapElements(fakeKMP()), WHOLE)!).map((s: any) => s.id)).toEqual(["route"]);
});

test("a track without collision can still generate from its routes", () => {
  const track = minimapTrack(null, minimapElements(fakeKMP()), WHOLE)!;
  expect(minimapSourceCounts(track).road).toBe(0);
  expect(minimapSourceCounts(track).route).toBe(6);
  expect(minimapTrack(null, [])).toBeNull();
});

test("the rebuild input faces up, keeps overlaps ordered by height and groups by colour", () => {
  const kcl = fakeKCL();
  // Written clockwise from above, as collision may be.
  kcl.verts.set([0, 3000, 0, 0, 3000, 1000, 1000, 3000, 0], 0);
  const track = minimapTrack(kcl, [], WHOLE)!;
  const source = buildMinimapSource(track, Int16Array.from([0, 0, 1, -1]), [{ hex: "#ffffff" }, { hex: "#808080" }] as any);
  expect(source.tris).toHaveLength(3);
  expect(Object.keys(source.materials).sort()).toEqual(["map_t0", "map_t1"]);
  expect(source.materials.map_t1.color[0]).toBeCloseTo(128 / 255);
  for (const { v } of source.tris) expect((v[5] - v[2]) * (v[6] - v[0]) - (v[3] - v[0]) * (v[8] - v[2])).toBeGreaterThan(0);
  const heights = source.tris.flatMap((t: any) => [t.v[1], t.v[4], t.v[7]]);
  expect(Math.max(...heights)).toBe(1000);
  expect(Math.min(...heights)).toBe(0);
  expect(source.tris[0].v[1]).toBeGreaterThan(source.tris[2].v[1]);
});

test.skipIf(process.platform !== "win32")("a rebuilt minimap holds the painted colours, can be recoloured and keeps a moved frame", async () => {
  await withTools(async () => {
    const track = minimapTrack(fakeKCL(), [], WHOLE)!;
    const assign = Int16Array.from([0, 0, 1, -1]);
    const tones = [{ hex: "#ffffff", source: null, editable: true }, { hex: "#000000", source: null, editable: true }];
    const bytes = await buildMinimapModel(buildMinimapSource(track, assign, tones));
    const map = readMinimap(bytes)!;
    expect(map.model).toBe("map");
    expect(map.triangles).toBe(3);
    expect(map.swatches.map((s: any) => s.hex).sort()).toEqual(["#000000", "#ffffff"]);
    expect(map.swatches.every((s: any) => s.kind === "texture" && s.editable)).toBe(true);
    // Reopening starts from the file itself: collision stays off, and the file's triangles come out unchanged.
    const reopened = minimapTrack(fakeKCL(), [{ kind: MINIMAP_ELEMENT.ITEM_BOX, tris: [[300, 200, 500, 200, 400, 500]] }], { ...WHOLE, map })!;
    const seeded = seedMinimapDesign(reopened, map);
    for (let i = 0; i < reopened.count; i++) expect(seeded.assign[i] >= 0).toBe(!!reopened.fromMap[i]);
    expect(seeded.tones.map((tone: any) => tone.hex).sort()).toEqual(["#000000", "#ffffff"]);
    const again = buildMinimapSource(reopened, seeded.assign, seeded.tones);
    expect(again.tris).toHaveLength(3);
    expect(Object.keys(again.materials)).toHaveLength(2);

    const white = map.swatches.find((s: any) => s.hex === "#ffffff");
    const recoloured = readMinimap(setMinimapSwatchColor(bytes, white, "#ff0000"))!;
    expect(recoloured.swatches.map((s: any) => s.hex).sort()).toEqual(["#000000", "#ff0000"]);

    const frame = { minX: -100, maxX: 2500, minZ: -300, maxZ: 1400 };
    const moved = readMinimap(setMinimapBounds(bytes, frame))!;
    expect(moved.bounds).toEqual(frame);
    expect(moved.triangles).toBe(3);
    expect(() => setMinimapBounds(bytes, { ...frame, minX: 9000 })).toThrow();
  });
});

test("the rebuild's faces point the same way as the generator's minimap road", () => {
  const road = generateTrack(PRESETS.Oval(), DEFAULT_PARAMS).model.tris.find((t: any) => t.mat === "road")!;
  const v = road.v;
  expect((v[5] - v[2]) * (v[6] - v[0]) - (v[3] - v[0]) * (v[8] - v[2])).toBeGreaterThan(0);
});

const game = process.env.MKWII_GAME_DIR;
test.skipIf(!game || !existsSync(join(game || "", "Race", "Course", "block_battle.szs")))("the game's vertex-coloured minimaps read in track units and recolour in place", async () => {
  const open = async (name: string) => parseU8(yaz0Decompress(new Uint8Array(await readFile(join(game!, "Race", "Course", `${name}.szs`)))));
  // This arena's root bone scales the map by 0.75: read as stored it would not line up with the track.
  const arena = await open("block_battle");
  const arenaMap = readMinimap(findFile(arena, "map_model.brres")!.data)!;
  expect(Math.abs(arenaMap.extents.maxX - 15900)).toBeLessThan(100);
  expect(arenaMap.bounds).toEqual({ minX: -18750, maxX: 18750, minZ: -18750, maxZ: 18750 });

  const tree = await open("castle_course");
  const data = findFile(tree, "map_model.brres")!.data;
  const map = readMinimap(data)!;
  expect(map.swatches.every((s: any) => s.kind === "vertex")).toBe(true);
  expect(map.swatches.map((s: any) => s.hex)).toContain("#ffffff");
  // Two colours can trade places in one change.
  const [first, second] = map.swatches;
  const traded = readMinimap(setMinimapColors(data, [{ swatch: first, hex: second.hex }, { swatch: second, hex: first.hex }]))!;
  expect(traded.swatches.find((s: any) => s.hex === second.hex).count).toBe(first.count);
  expect(traded.swatches.find((s: any) => s.hex === first.hex).count).toBe(second.count);
  const white = map.swatches.find((s: any) => s.hex === "#ffffff");
  const next = setMinimapSwatchColor(data, white, "#336699");
  expect(next.length).toBe(data.length);
  const after = readMinimap(next)!;
  expect(after.swatches.find((s: any) => s.hex === "#336699").count).toBe(white.count);
  expect(after.swatches.some((s: any) => s.hex === "#ffffff")).toBe(false);
  expect(after.triangles).toBe(map.triangles);
  expect(after.bounds).toEqual(map.bounds);

  // Item boxes and objects are never on the game's own maps, whatever tone lies beneath them.
  for (const [name, archive] of [["castle_course", tree], ["block_battle", arena], ["sand_battle", await open("sand_battle")], ["shopping_course", await open("shopping_course")]] as const) {
    const file = readMinimap(findFile(archive, "map_model.brres")!.data)!;
    const placed = minimapTrack(parseKCL(findFile(archive, "course.kcl")!.data), minimapElements(parseKMP(findFile(archive, "course.kmp")!.data)), { map: file })!;
    const design = seedMinimapDesign(placed, file);
    const on = [...placed.element].filter((kind, i) => kind && design.assign[i] >= 0).length;
    expect(`${name}: ${on}`).toBe(`${name}: 0`);
    // Nothing painted, nothing changed: the map comes out triangle for triangle.
    expect(minimapTriangleCount(placed, design.assign)).toBe(file.triangles);
  }

  // A small stroke changes only that place, on the arena whose floor is one collision part.
  const floor = await open("old_battle4_sfc");
  const file = readMinimap(findFile(floor, "map_model.brres")!.data)!;
  const placed = minimapTrack(parseKCL(findFile(floor, "course.kcl")!.data), [], { map: file })!;
  const design = seedMinimapDesign(placed, file), locate = trackLocator(placed);
  let [x, z] = [(file.extents.minX + file.extents.maxX) / 2, (file.extents.minZ + file.extents.maxZ) / 2];
  x += 3000; z += 3000;
  const brush = 700, layers = locate.within(x, z, brush);
  expect(layers.length).toBeGreaterThan(0);
  for (const i of layers) design.assign[i] = -1;
  // Nothing is left under the brush, on any layer, and it reached no further than one piece away.
  const onMap = (i: number) => design.assign[i] >= 0;
  for (let dx = -brush; dx <= brush; dx += 40) for (let dz = -brush; dz <= brush; dz += 40) {
    if (dx * dx + dz * dz <= brush * brush) expect(locate.all(x + dx, z + dz, onMap)).toEqual([]);
  }
  const reach = brush + placed.cell * 2;
  expect(locate.all(x + reach, z, onMap).length + locate.all(x - reach, z, onMap).length).toBeGreaterThan(0);
  const remaining = minimapTriangleCount(placed, design.assign);
  expect(remaining).toBeGreaterThan(file.triangles - 5);
  expect(remaining).toBeLessThan(file.triangles + 3000);
  let painted = 0;
  for (let i = 0; i < placed.count; i++) if (placed.fromMap[i] && design.assign[i] !== placed.swatch[i]) painted++;
  expect(painted).toBeLessThan(placed.count / 100);
});
