import { expect, test } from "bun:test";
import { generateTrack, PRESETS, trickSegments } from "../web/js/editor/trackgen.js";

const TRICKABLE = 0x2000;
const trickFaces = (out: any) => [...out.flags].filter((flag: number) => flag & TRICKABLE);

test("a flat generated track has no trickable road: tricks do not work at every point", () => {
  expect(trickFaces(generateTrack(PRESETS.Oval(), { trickable: true }))).toHaveLength(0);
});

test("a gentle hill is not trickable: the kart does not leave the road there", () => {
  const points = PRESETS.Oval().map((p: any) => ({ ...p, y: p.x > 8000 ? 1500 : 0 }));
  expect(trickFaces(generateTrack(points, { trickable: true }))).toHaveLength(0);
});

test("the end of a steep ramp is trickable, the rest of the road is not", () => {
  // A straight road every 400 units: flat, a 3000-unit ramp (slope 0.3), then flat again.
  const frames = Array.from({ length: 40 }, (_, i) => {
    const x = i * 400, y = x < 4000 ? 0 : x < 7000 ? (x - 4000) * 0.3 : 900;
    return { c: [x, y, 0] };
  });
  const tricks = [...trickSegments(frames, 400, false)].sort((a, b) => a - b);
  // The run-up to the ramp's top (x = 7000, in segment 17) and a little after it, where the kart flies.
  expect(tricks.length).toBeGreaterThan(0);
  expect(Math.max(...tricks)).toBeLessThanOrEqual(19);
  expect(Math.min(...tricks)).toBeGreaterThanOrEqual(12);
  expect(tricks).toContain(17);
  // The foot of the ramp (where the slope rises) is not a jump.
  expect(tricks).not.toContain(9);
});
