import { expect, test } from "bun:test";
import { snapshotCollision, appendCopiedCollision } from "../web/js/editor/copy-collision.js";
import { TrackDocument } from "../web/js/editor/document.js";
import { Ops } from "../web/js/editor/ops.js";
import { make } from "../web/js/formats/kmp.js";

const collision = () => ({ count: 1, verts: Float32Array.from([0, 0, 0, 0, 0, 100, 100, 0, 100]), flags: Uint16Array.from([0x48c]), valid: null });
test("copied collision retains its source flags and geometry independently of later edits", () => {
  const original = collision(), copy = snapshotCollision(original, [0, 0]);
  original.verts[0] = 999; original.flags[0] = 6;
  const next = appendCopiedCollision(original, [copy, copy], [200, 50, -100]);
  expect(next.count).toBe(2); expect(next.flags[1]).toBe(0x48c);
  expect([...next.verts.slice(9)]).toEqual([200, 50, -100, 200, 50, 0, 300, 50, 0]);
  expect(original.count).toBe(1); expect(copy.tris[0][0]).toEqual([0, 0, 0]);
});
test("pasting objects and their collision forms one undo step", () => {
  const doc = new TrackDocument(), ops = new Ops(doc, { iconSize: 150 });
  doc.kmp.GOBJ.push(make.GOBJ(0x65, [0, 0, 0])); doc.kcl = collision(); doc.loaded();
  doc.select(String(doc.kmp.GOBJ[0].uid));
  const entries = ops.copySelection(), next = appendCopiedCollision(doc.kcl, [snapshotCollision(doc.kcl, [0])], [500, 0, 500]);
  ops.pasteCopies(entries, [500, 0, 500], "Duplicate", () => doc.setKCL(next, true));
  expect(doc.kmp.GOBJ).toHaveLength(2); expect(doc.kcl.count).toBe(2);
  expect(doc.kmp.GOBJ[1].pos).toEqual([500, 0, 500]);
  doc.undo(); expect(doc.kmp.GOBJ).toHaveLength(1); expect(doc.kcl.count).toBe(1);
  doc.redo(); expect(doc.kmp.GOBJ).toHaveLength(2); expect(doc.kcl.flags[1]).toBe(0x48c);
});
test("collision capacity failures leave the original unchanged", () => {
  const full = { count: 65534, verts: new Float32Array(65534 * 9), flags: new Uint16Array(65534) };
  expect(() => appendCopiedCollision(full, [snapshotCollision(collision(), [0])], [1, 2, 3])).toThrow();
  expect(full.count).toBe(65534); expect(full.verts[0]).toBe(0);
});
