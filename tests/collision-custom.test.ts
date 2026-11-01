import { expect, test } from "bun:test";
import * as THREE from "three";
import { appendCollisionTriangle, appendCollisionTriangles, buildCollisionShape, collisionBoxFromTriangles, collisionCoverage, deleteCollisionTriangles, duplicateCollisionTriangles, flipCollisionTriangles, isFloorTriangle, modelCollisionTriangles, simplifyCollisionTriangles, transformCollisionTriangles } from "../web/js/editor/collision.js";
import { buildKCL, parseKCL } from "../web/js/formats/kcl.js";

test("drawn collision triangles append with their flag and survive KCL export", () => {
  const first = appendCollisionTriangle(null, [[0, 0, 0], [100, 0, 0], [0, 0, 100]], 0x106);
  const next = appendCollisionTriangle(first, [[200, 0, 0], [300, 0, 0], [200, 0, 100]], 0x00c);
  expect(next.count).toBe(2);
  expect([...next.flags]).toEqual([0x106, 0x00c]);
  expect([...next.verts.subarray(0, 9)]).toEqual([0, 0, 0, 0, 0, 100, 100, 0, 0]); // upward normal
  const parsed = parseKCL(buildKCL(next.verts, next.flags));
  expect(parsed.count).toBe(2);
  expect([...parsed.flags]).toEqual([0x106, 0x00c]);
  expect([...parsed.valid]).toEqual([1, 1]);
});

test("a line cannot become collision", () => {
  expect(() => appendCollisionTriangle(null, [[0, 0, 0], [1, 0, 0], [2, 0, 0]], 0)).toThrow();
});

test("explicit removal of the last model's collision saves an empty KCL without dummy surfaces", () => {
  const first = appendCollisionTriangle(null, [[0, 0, 0], [100, 0, 0], [0, 0, 100]], 6);
  expect(() => deleteCollisionTriangles(first, [0])).toThrow();
  const empty = deleteCollisionTriangles(first, [0], { allowEmpty: true });
  const parsed = parseKCL(buildKCL(empty.verts, empty.flags, { allowEmpty: true }));
  expect(parsed.count).toBe(0);
  expect(parsed.verts.length).toBe(0);
  expect(parsed.areaMin.every(Number.isFinite)).toBe(true);
  expect(() => buildKCL(new Float32Array(9), [0], { allowEmpty: true })).toThrow();
});

test("selected triangles duplicate, flip and delete as a group", () => {
  const a = appendCollisionTriangle(null, [[0, 0, 0], [100, 0, 0], [0, 0, 100]], 6);
  const b = appendCollisionTriangle(a, [[200, 0, 0], [300, 0, 0], [200, 0, 100]], 3);
  const c = appendCollisionTriangle(b, [[400, 0, 0], [500, 0, 0], [400, 0, 100]], 12);
  const copies = duplicateCollisionTriangles(c, [0, 2]);
  expect(copies.count).toBe(5);
  expect([...copies.flags]).toEqual([6, 3, 12, 6, 12]);
  expect(copies.verts[3 * 9 + 1]).toBe(100);
  const flipped = flipCollisionTriangles(c, [0, 2]);
  expect([...flipped.verts.subarray(3, 6)]).toEqual([...c.verts.subarray(6, 9)]);
  const remaining = deleteCollisionTriangles(c, [0, 2]);
  expect(remaining.count).toBe(1);
  expect([...remaining.flags]).toEqual([3]);
  expect(() => deleteCollisionTriangles(c, [0, 1, 2])).toThrow();
});

test("drawn shapes become triangles facing outwards (solids) or towards the camera (surfaces)", () => {
  const center = (t: number[][]) => t[0].map((_, i) => (t[0][i] + t[1][i] + t[2][i]) / 3);
  const normal = ([a, b, c]: number[][]) => {
    const u = b.map((n, i) => n - a[i]), v = c.map((n, i) => n - a[i]);
    return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  };
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const outward = (tris: number[][][], c: number[]) => tris.every((t) => dot(normal(t), center(t).map((n, i) => n - c[i])) > 0);

  const box = buildCollisionShape("box", [[0, 0, 0], [100, 0, 200]], { height: 50 });
  expect(box.length).toBe(12);
  expect(outward(box, [50, 25, 100])).toBe(true);

  const cylinder = buildCollisionShape("cylinder", [[0, 0, 0], [100, 0, 0]], { height: 300, segments: 8 });
  expect(cylinder.length).toBe(8 * 4);
  expect(outward(cylinder, [0, 150, 0])).toBe(true);

  const sphere = buildCollisionShape("sphere", [[0, 0, 0], [0, 100, 0]], { segments: 8 });
  expect(sphere.length).toBe(8 * 4 * 2 - 16);
  expect(outward(sphere, [0, 0, 0])).toBe(true);

  const eye = [0, 1000, 0];
  const ramp = buildCollisionShape("rectangle", [[0, 0, 0], [100, 0, 0], [30, 50, 200]], { eye });
  expect(ramp.length).toBe(2);
  expect(ramp.every((t) => normal(t)[1] > 0)).toBe(true);

  const wall = buildCollisionShape("wall", [[0, 0, 0], [100, 0, 0]], { height: 100, eye: [50, 50, -500] });
  expect(wall.every((t) => normal(t)[2] < 0)).toBe(true);

  // An L-shaped (concave) outline is split without covering the notch.
  const polygon = buildCollisionShape("polygon", [[0, 0, 0], [200, 0, 0], [200, 0, 100], [100, 0, 100], [100, 0, 200], [0, 0, 200]], { eye });
  expect(polygon.length).toBe(4);
  const area = polygon.reduce((sum, t) => sum + Math.hypot(...normal(t)) / 2, 0);
  expect(area).toBeCloseTo(30000);

  const kcl = appendCollisionTriangles(null, box, 0x00c);
  expect(kcl.count).toBe(12);
  expect(parseKCL(buildKCL(kcl.verts, kcl.flags)).count).toBe(12);
});

test("model collision uses world transforms, indexed faces, and selected triangles", () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 100, 0, 0, 0, 0, 100, 100, 0, 100, 0, 0, 0], 3));
  geometry.setIndex([0, 2, 1, 1, 2, 3, 0, 0, 4]);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.position.set(500, 20, -30);
  const placement = new THREE.Matrix4().makeTranslation(10, 5, 40);
  const tris = modelCollisionTriangles(mesh, { transform: placement });
  expect(tris).toHaveLength(2);
  expect(tris[0][0]).toEqual([510, 25, 10]);
  expect(tris[0][1]).toEqual([510, 25, 110]);
  expect(modelCollisionTriangles(mesh, { vertexIndices: [1, 2, 3] })).toHaveLength(1);
  const box = collisionBoxFromTriangles(tris);
  expect(box).toHaveLength(12);
  const kcl = appendCollisionTriangles(null, box, 0x0C);
  expect(parseKCL(buildKCL(kcl.verts, kcl.flags)).count).toBe(12);
});

const triNormal = ([a, b, c]: number[][]) => {
  const u = b.map((n, i) => n - a[i]), v = c.map((n, i) => n - a[i]);
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
};

test("mirrored placements keep collision normals facing out", () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 100, 100, 0, 0], 3)); // faces up
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  const mirror = new THREE.Matrix4().makeScale(-1, 1, 1);
  expect(triNormal(modelCollisionTriangles(mesh, { transform: mirror })[0])[1]).toBeGreaterThan(0);
  expect(triNormal(transformCollisionTriangles(modelCollisionTriangles(mesh), mirror)[0])[1]).toBeGreaterThan(0);
});

test("a rotated object's box turns with it", () => {
  const box = buildCollisionShape("box", [[-100, 0, -10], [100, 0, 10]], { height: 50 });
  const turn = new THREE.Matrix4().makeRotationY(Math.PI / 4);
  const placed = collisionBoxFromTriangles(box, turn);
  expect(placed).toHaveLength(12);
  // A world-aligned box around the turned model would reach about ±78 on Z; the turned box keeps its shape.
  const corners = placed.flat();
  const extentZ = Math.max(...corners.map((p) => p[2])) - Math.min(...corners.map((p) => p[2]));
  expect(extentZ).toBeCloseTo(110 * Math.SQRT2, 0);
  const center = [0, 25, 0];
  expect(placed.every((t) => { const c = [0, 1, 2].map((i) => (t[0][i] + t[1][i] + t[2][i]) / 3 - center[i]); const n = triNormal(t); return n[0] * c[0] + n[1] * c[1] + n[2] * c[2] > 0; })).toBe(true);
});

test("dense surfaces simplify under the requested triangle count", () => {
  const grid: number[][][] = [];
  for (let x = 0; x < 40; x++) for (let z = 0; z < 40; z++) {
    const p = (i: number, k: number) => [i * 10, Math.sin(i / 5) * 20, k * 10];
    grid.push([p(x, z), p(x, z + 1), p(x + 1, z)], [p(x + 1, z), p(x, z + 1), p(x + 1, z + 1)]);
  }
  expect(simplifyCollisionTriangles(grid, 5000)).toBe(grid);
  const simple = simplifyCollisionTriangles(grid, 300);
  expect(simple.length).toBeGreaterThan(20);
  expect(simple.length).toBeLessThanOrEqual(300);
  expect(simple.every((t) => triNormal(t)[1] > 0)).toBe(true); // still a floor facing up
});

test("coverage finds model triangles already on course collision", () => {
  const floor = appendCollisionTriangles(null, buildCollisionShape("rectangle", [[0, 0, 0], [1000, 0, 0], [0, 0, 1000]]), 0);
  const onFloor = [[100, 10, 100], [100, 10, 200], [200, 10, 100]];
  const above = [[100, 500, 100], [100, 500, 200], [200, 500, 100]];
  const halfOff = [[900, 0, 900], [900, 0, 1500], [1500, 0, 900]];
  expect(collisionCoverage([onFloor, above, halfOff], floor, 50)).toEqual([true, false, false]);
  expect(collisionCoverage([onFloor], null)).toEqual([false]);
});

test("auto surface splits floors from walls and flags append per triangle", () => {
  const floor = [[0, 0, 0], [0, 0, 100], [100, 0, 0]];
  const wall = [[0, 0, 0], [100, 0, 0], [0, 100, 0]];
  expect(isFloorTriangle(floor)).toBe(true);
  expect(isFloorTriangle(wall)).toBe(false);
  const kcl = appendCollisionTriangles(null, [floor, wall], [0x00, 0x0C]);
  expect([...kcl.flags]).toEqual([0x00, 0x0C]);
  expect(() => appendCollisionTriangles(null, [floor, wall], [0x00])).toThrow();
});
