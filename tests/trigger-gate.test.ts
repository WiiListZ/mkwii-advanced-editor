import { expect, test } from "bun:test";
import { BACK_GATE_GAP, GATE_TYPES, gateAcross, gatePair, gateTriangles } from "../web/js/editor/trigger-gate.js";

// A flat road 2000 wide (x from -1000 to 1000) between walls, karts going along z.
const road = (x: number, _y: number, _z: number) => Math.abs(x) <= 1000 ? { y: 100, type: 0x00, normalY: 1 } : Math.abs(x) <= 1100 ? { y: 100, type: 0x0c, normalY: 1 } : null;

test("a gate spans the road from wall to wall, upright, from below the road to above a kart", () => {
  const gate = gateAcross([200, 100, 5000], [0, 1], road);
  const xs = gate.corners.map((c: number[]) => c[0]);
  expect(Math.min(...xs)).toBe(-1000 - 150);
  expect(Math.max(...xs)).toBe(1000 + 150);
  expect(gate.corners.every((c: number[]) => c[2] === 5000)).toBe(true);
  expect(gate.corners[0][1]).toBe(100 - 300);
  expect(gate.corners[2][1]).toBe(100 + 1500);
  expect(gate.width).toBe(2300);
  // One face: two triangles of three corners each.
  const tris = gateTriangles(gate.corners);
  expect(tris.length).toBe(2);
  expect(tris.every((t: number[]) => t.length === 9)).toBe(true);
  expect(GATE_TYPES.has(0x18) && GATE_TYPES.has(0x1a) && !GATE_TYPES.has(0x00)).toBe(true);
});

// The way a triangle faces (its normal), as the game reads it: (b - a) x (c - a).
const facing = (t: number[]) => {
  const u = [t[3] - t[0], t[4] - t[1], t[5] - t[2]], w = [t[6] - t[0], t[7] - t[1], t[8] - t[2]];
  const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], l = Math.hypot(...n);
  return n.map((x) => x / l);
};

test("the gate faces the karts; the one for going back stands 200 before it, facing ahead", () => {
  // Karts going along +z.
  const gate = gateAcross([0, 100, 5000], [0, 1], road);
  for (const t of gateTriangles(gate.corners)) expect(facing(t)[2]).toBeCloseTo(-1);
  for (const t of gateTriangles(gate.corners, "ahead")) expect(facing(t)[2]).toBeCloseTo(1);
  const pair = gatePair(gate, 3, 0);
  expect(pair.length).toBe(4);
  // First the back gate (variant 0, facing ahead, at z 4800), then the gate (variant 3, facing the karts, at z 5000).
  expect(pair.slice(0, 2).every((p: any) => p.variant === 0 && facing(p.tri)[2] > 0.99 && p.tri[2] === 5000 - BACK_GATE_GAP)).toBe(true);
  expect(pair.slice(2).every((p: any) => p.variant === 3 && facing(p.tri)[2] < -0.99 && p.tri[2] === 5000)).toBe(true);
  // Without one for going back, just the gate.
  expect(gatePair(gate, 3, null).map((p: any) => p.variant)).toEqual([3, 3]);
});

test("it stops at a drop, and is never narrower than its least half-width", () => {
  const ledge = (x: number) => x < 300 ? { y: 0, type: 0x00, normalY: 1 } : { y: -2000, type: 0x00, normalY: 1 };
  const gate = gateAcross([0, 0, 0], [1, 0], (x, y, z) => ledge(z));
  // Going along x, the sides are along z: the drop at z = 300 ends one side; the other goes on to 8000.
  const zs = gate.corners.map((c: number[]) => c[2]);
  expect(Math.max(...zs)).toBe(500);
  expect(Math.min(...zs)).toBe(-(8000 + 150));
});
