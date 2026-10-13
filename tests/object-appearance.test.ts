import { expect, test } from "bun:test";
import { TrackDocument } from "../web/js/editor/document.js";
import { buildU8, findFile, newSzsTree, parseU8, setFilePath } from "../web/js/formats/u8.js";

test("course-local object resources survive export and undo/redo", () => {
  const doc = new TrackDocument();
  doc.szs = newSzsTree();
  const original = new Uint8Array([1, 2, 3]);
  const edited = new Uint8Array([4, 5, 6]);
  setFilePath(doc.szs, "itembox.brres", original);
  doc.changeArchiveFile("Paint item box", "itembox.brres", edited);
  expect([...findFile(doc.szs, "itembox.brres").data]).toEqual([4, 5, 6]);
  expect(doc.undo()).toBe("Paint item box");
  expect([...findFile(doc.szs, "itembox.brres").data]).toEqual([1, 2, 3]);
  expect(doc.redo()).toBe("Paint item box");
  expect([...findFile(parseU8(buildU8(doc.szs)), "itembox.brres").data]).toEqual([4, 5, 6]);

  doc.changeArchiveFile("Add other resource", "tree.brres", new Uint8Array([7]));
  expect(doc.undo()).toBe("Add other resource");
  expect(findFile(doc.szs, "tree.brres")).toBeNull();
  expect(doc.redo()).toBe("Add other resource");
  expect([...findFile(doc.szs, "tree.brres").data]).toEqual([7]);
});
