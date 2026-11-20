import { expect, test } from "bun:test";
import { buildPrimitive } from "../web/js/editor/primitives.js";
import {
  applyMatrix, composeMove, editTriangles, entryCollision, matchTriangles, moveTriangles, matchTrianglePairs, nextPrimitiveId,
  placedTriangles, placementMatrix, primitiveName, primitiveOfPart, readPrimitiveStore, translation, trianglesBox, writePrimitiveStore,
} from "../web/js/editor/primitive-store.js";

const kclOf = (tris: number[][], flag = 0) => ({ count: tris.length, verts: Float32Array.from(tris.flat()), flags: new Uint16Array(tris.length).fill(flag) });

test("the primitives file keeps the shapes and goes away when none is left", () => {
  const store = readPrimitiveStore(null);
  expect(store.primitives).toEqual([]);
  expect(writePrimitiveStore(store)).toBeNull();
  store.primitives.push({ id: nextPrimitiveId(store), model: "course", parts: ["Imported_1_primitive"], spec: { shape: "cylinder" }, color: "#ff0000", collision: 0, matrix: translation([1, 2, 3]) });
  const back = readPrimitiveStore(writePrimitiveStore(store));
  expect(back.primitives[0].id).toBe(1);
  expect(nextPrimitiveId(back)).toBe(2);
  expect(primitiveName(back.primitives[0])).toBe("Cylinder 1");
  expect(primitiveOfPart(back, "course", "Imported_1_primitive")?.id).toBe(1);
  expect(primitiveOfPart(back, "course", "other")).toBeNull();
  // A damaged file is an empty one, not an error.
  expect(readPrimitiveStore(new TextEncoder().encode("{ not json")).primitives).toEqual([]);
});

test("the collision stands where the model stands", () => {
  const tris = buildPrimitive({ shape: "box", width: 1000, height: 500, depth: 1000, slices: 1 });
  const matrix = placementMatrix(tris, { min: [9500, 200, -500], max: [10500, 700, 500] });
  const box = trianglesBox(placedTriangles(tris, matrix));
  expect(box.min.map(Math.round)).toEqual([9500, 200, -500]);
  expect(box.max.map(Math.round)).toEqual([10500, 700, 500]);
});

test("moving, turning and resizing compose like moving model parts", () => {
  const quarter = [0, Math.SQRT1_2, 0, Math.SQRT1_2]; // 90° around y
  const moved = composeMove(translation([100, 0, 0]), { center: [100, 0, 0], translation: [0, 50, 0], rotation: quarter, scale: [2, 2, 2] });
  // A point 10 along x from the shape's origin: at 100 + 10 after the first move, then turned and doubled around 100.
  const p = applyMatrix(moved, [10, 0, 0]);
  expect(p.map((v) => Math.round(v * 1000) / 1000)).toEqual([100, 50, -20]);
});

test("the shape's collision is found again, moved and replaced", () => {
  const tris = buildPrimitive({ shape: "wedge", width: 800, height: 400, depth: 800, slices: 1 });
  const entry = { id: 1, model: "course", parts: ["p"], spec: { shape: "wedge", width: 800, height: 400, depth: 800, slices: 1 }, color: "#fff", collision: 0, matrix: translation([500, 0, 500]) };
  const road = [[0, 0, 0, 0, 0, 100, 100, 0, 0]];
  // As read back from the game's format: a little off.
  const placed = entryCollision(entry).map((tri: number[]) => tri.map((v) => v + 0.3));
  const kcl = kclOf([...road, ...placed]);
  kcl.flags[0] = 0x0c;
  const found = matchTriangles(kcl, entryCollision(entry));
  expect(found.length).toBe(tris.length);
  expect(found).not.toContain(0);
  // Moved: same triangles, same flags, new places.
  const after = { ...entry, matrix: composeMove(entry.matrix, { translation: [0, 0, 1000] }) };
  const next = moveTriangles(kcl, matchTrianglePairs(kcl, entryCollision(entry)), entryCollision(after));
  expect(next.flags).toEqual(kcl.flags);
  expect(matchTriangles({ count: kcl.count, ...next }, entryCollision(after)).length).toBe(tris.length);
  // Replaced: the old ones go, the road stays, the new ones come with their flag.
  const replaced = editTriangles(kcl, found, [[1, 2, 3, 4, 5, 6, 7, 8, 9]], 0x03);
  expect(replaced.flags).toEqual(Uint16Array.from([0x0c, 0x03]));
  expect([...replaced.verts.slice(0, 9)]).toEqual(road[0]);
  // Without collision nothing is looked for.
  expect(entryCollision({ ...entry, collision: null })).toEqual([]);
});
