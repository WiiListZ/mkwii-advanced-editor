import { expect, test } from "bun:test";
import { Matrix4 } from "three";
import { appendCollisionTriangles, buildCollisionShape, collisionBoxFromTriangles, collisionOfModel, simplifyCollisionTriangles, transformCollisionTriangles } from "../web/js/editor/collision.js";

// An object model: a closed box 200 wide, 300 high, standing on y = 0 in its own space.
const model = buildCollisionShape("box", [[-100, 0, -100], [100, 0, 100]], { height: 300 });
const place = new Matrix4().makeRotationY(0.6).setPosition(5000, 120, -3000);
const placed = transformCollisionTriangles(model, place);
// The road: two big triangles under everything, and a small road piece right under the object.
// (wound so that they face up, like a road)
const road = [[[-20000, 120, -20000], [0, 120, 20000], [20000, 120, -20000]], [[4950, 120, -3050], [5000, 120, -2950], [5050, 120, -3050]]];

function course(extra: number[][][]) {
  return appendCollisionTriangles(appendCollisionTriangles(null, road, 0x00), extra, 0x0c);
}

test("collision generated from the model's surfaces is found, the road under it is not", () => {
  const kcl = course(placed);
  const found = collisionOfModel(kcl, placed, collisionBoxFromTriangles(model, place), 10);
  expect(found.sort((a, b) => a - b)).toEqual(placed.map((_, i) => road.length + i));
});

test("the simplified and the box versions are found too", () => {
  const detailed = buildCollisionShape("cylinder", [[0, 0, 0], [150, 0, 0]], { height: 400, segments: 48 });
  const at = new Matrix4().setPosition(-800, 0, 900);
  const surfaces = transformCollisionTriangles(detailed, at);
  const simple = simplifyCollisionTriangles(surfaces, 40);
  const box = collisionBoxFromTriangles(detailed, at);
  for (const generated of [simple, box]) {
    const kcl = course(generated);
    const found = collisionOfModel(kcl, surfaces, box, 400 * 0.03);
    expect(found.length).toBe(generated.length);
    expect(found.every((t: number) => t >= road.length)).toBe(true);
  }
});

test("collision of another object elsewhere stays", () => {
  const other = transformCollisionTriangles(model, new Matrix4().setPosition(-5000, 0, 0));
  const kcl = course([...placed, ...other]);
  expect(collisionOfModel(kcl, placed, collisionBoxFromTriangles(model, place), 10).length).toBe(placed.length);
});
