import { test, expect } from "bun:test";
import { make } from "../web/js/formats/kmp.js";
import { findFile, newSzsTree, setFilePath } from "../web/js/formats/u8.js";
import { objectFiles, placedObjects } from "../web/js/editor/object-sources.js";
import { TrackDocument } from "../web/js/editor/document.js";
import { Ops } from "../web/js/editor/ops.js";

const bytes = (n: number) => new Uint8Array([n]);

test("object files: root files named like the resource and its folders", () => {
  const tree = newSzsTree();
  for (const path of ["course_model.brres", "PalmTree.brres", "palmtree.kcl", "effect/PalmTree/leaf.breff", "effect/other/x.breff", "PalmTreeBig.brres"])
    setFilePath(tree, path, bytes(1));
  expect(objectFiles(tree, ["PalmTree"]).map((f) => f.path).sort()).toEqual(["PalmTree.brres", "effect/PalmTree/leaf.breff", "palmtree.kcl"]);
  expect(objectFiles(null, ["PalmTree"])).toEqual([]);
});

test("placed objects: grouped by type with the most common settings", () => {
  const a = make.GOBJ(0x65, [0, 0, 0]), b = make.GOBJ(0x65, [1, 0, 0]), c = make.GOBJ(0x65, [2, 0, 0]), d = make.GOBJ(0x145, [3, 0, 0]);
  a.settings[1] = 4; b.settings[1] = 4; c.settings[1] = 9; d.scale = [2, 2, 2];
  const list = placedObjects([d, a, b, c]);
  expect(list.map((e) => [e.objectId, e.count])).toEqual([[0x65, 3], [0x145, 1]]);
  expect(list[0].sample.settings[1]).toBe(4);
  expect(list[1].sample.scale).toEqual([2, 2, 2]);
});

test("adding an object with its model files is one undo step", () => {
  const doc = new TrackDocument();
  doc.szs = newSzsTree();
  setFilePath(doc.szs, "course_model.brres", bytes(1));
  setFilePath(doc.szs, "PalmTree.brres", bytes(7));
  const ops = new Ops(doc, { iconSize: 150, checkpointWidth: 3000 });
  ops.add("GOBJ", [5, 0, 5], { objectId: 0x145, settings: [1, 2, 3, 4, 5, 6, 7, 8], scale: [3, 3, 3],
    files: [{ path: "PalmTree.brres", data: bytes(9) }, { path: "effect/PalmTree/leaf.breff", data: bytes(2) }] });
  expect(doc.kmp.GOBJ[0].settings).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  expect(doc.kmp.GOBJ[0].scale).toEqual([3, 3, 3]);
  // A file the track already has is kept.
  expect(findFile(doc.szs, "PalmTree.brres").data[0]).toBe(7);
  expect(findFile(doc.szs, "effect/PalmTree/leaf.breff").data[0]).toBe(2);
  doc.undo();
  expect(doc.kmp.GOBJ).toHaveLength(0);
  expect(findFile(doc.szs, "effect/PalmTree/leaf.breff")).toBeNull();
  doc.redo();
  expect(doc.kmp.GOBJ).toHaveLength(1);
  expect(findFile(doc.szs, "effect/PalmTree/leaf.breff").data[0]).toBe(2);
});
