import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listVersions, readVersion, restoreVersion, saveVersion } from "../src/track-versions.ts";
import { generatedTrackIssues, generateTrack, layoutIssues, TEMPLATES } from "../web/js/editor/trackgen.js";
import { compareTrack, differencePlaces } from "../web/js/editor/track-diff.js";
import { HeightMap } from "../web/js/editor/heightmap.js";
import { geometryFinds } from "../web/js/editor/geometry-check.js";

const temp = mkdtempSync(join(tmpdir(), "mkwii-versions-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));
let folder = 0;
const fresh = () => { const dir = join(temp, String(folder++)); const settings = join(dir, "settings"); const file = join(dir, "track.szs"); require("node:fs").mkdirSync(dir, { recursive: true }); return { settings, file }; };
const text = (data: Uint8Array) => new TextDecoder().decode(data);

test("each save keeps what it replaces, newest first, and only when it differs", () => {
  const { settings, file } = fresh();
  expect(saveVersion(settings, file)).toBeNull(); // nothing on disk yet
  writeFileSync(file, "one");
  const first = saveVersion(settings, file)!;
  expect(first).toBeTruthy();
  expect(saveVersion(settings, file)).toBeNull(); // the same as the latest
  writeFileSync(file, "two");
  const second = saveVersion(settings, file)!;
  const list = listVersions(settings, file);
  expect(list.map((v) => v.id)).toEqual([second, first]);
  expect(list[0].size).toBe(3);
  expect(text(readVersion(settings, file, first))).toBe("one");
  // Another file has its own.
  const other = join(temp, "other.szs");
  writeFileSync(other, "x");
  expect(listVersions(settings, other)).toEqual([]);
});

test("only the most recent are kept", () => {
  const { settings, file } = fresh();
  for (let i = 0; i < 7; i++) { writeFileSync(file, `version ${i}`); saveVersion(settings, file, 3); }
  const list = listVersions(settings, file);
  expect(list.length).toBe(3);
  expect(text(readVersion(settings, file, list[0].id))).toBe("version 6");
  expect(text(readVersion(settings, file, list[2].id))).toBe("version 4");
  expect(saveVersion(settings, file, 0)).toBeNull();
});

test("going back restores the file and keeps what it held, so it can be undone", () => {
  const { settings, file } = fresh();
  writeFileSync(file, "old");
  const old = saveVersion(settings, file)!;
  writeFileSync(file, "new");
  restoreVersion(settings, file, old);
  expect(readFileSync(file, "utf8")).toBe("old");
  const list = listVersions(settings, file);
  expect(text(readVersion(settings, file, list[0].id))).toBe("new");
  restoreVersion(settings, file, list[0].id);
  expect(readFileSync(file, "utf8")).toBe("new");
});

test("a version id cannot reach another file", () => {
  const { settings, file } = fresh();
  writeFileSync(file, "a");
  saveVersion(settings, file);
  for (const id of ["../../secret", "..", "path", "12345", ""]) expect(() => readVersion(settings, file, id)).toThrow();
  expect(existsSync(settings)).toBe(true);
  expect(readdirSync(join(settings, "versions")).length).toBe(1);
});

const kmpOf = (extra: any = {}) => ({ GOBJ: [], KTPT: [], JGPT: [], CNPT: [], MSPT: [], AREA: [], CAME: [], ENPT: [], ITPT: [], CKPT: [], POTI: [], STGI: [{ uid: 1, laps: 3 }], ...extra }) as any;
const object = (uid: number, objectId: number, x: number, extra: any = {}) => ({ uid, objectId, pos: [x, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1], route: 0xFFFF, ...extra });
const kclOf = (triangles: number[][], flags: number[]) => ({ verts: new Float32Array(triangles.flat()), flags: new Uint16Array(flags), count: triangles.length, valid: null }) as any;
const version = (kmp: any, kcl: any = null, files: Record<string, number[]> = {}) => ({ kmp, kcl, szs: { name: "", children: Object.entries(files).map(([name, data]) => ({ name, data: new Uint8Array(data) })) } });

test("objects are found added, removed, moved and changed, with what can be gone to", () => {
  const mine = version(kmpOf({ GOBJ: [object(1, 5, 0), object(2, 5, 1000), object(3, 6, 2000, { route: 3 }), object(4, 7, 40000)] }));
  const theirs = version(kmpOf({ GOBJ: [object(11, 5, 0), object(12, 5, 1200), object(13, 6, 2000), object(14, 8, 50000)] }));
  const result = compareTrack(mine, theirs, (id: number) => `Object ${id}`);
  const by = (state: string) => result.items.filter((item: any) => item.state === state);
  expect(by("moved").map((item: any) => item.key)).toEqual([2]);
  expect(by("moved")[0].from).toEqual([1200, 0, 0]);
  expect(by("moved")[0].detail).toContain("200 units");
  expect(by("changed").map((item: any) => item.key)).toEqual([3]);
  expect(by("changed")[0].detail).toContain("route");
  expect(by("added").map((item: any) => item.label)).toEqual(["Object 7"]);
  expect(by("removed").map((item: any) => item.label)).toEqual(["Object 8"]);
  // Removed is not in this version, so it has nothing to select.
  expect(by("removed")[0].key).toBeNull();
  expect(result.counts).toEqual({ added: 1, removed: 1, moved: 1, changed: 1 });
  expect(result.identical).toBe(false);
  // Far away is not a move: a different one, removed and added.
  const far = compareTrack(version(kmpOf({ GOBJ: [object(1, 5, 0)] })), version(kmpOf({ GOBJ: [object(2, 5, 90000)] })));
  expect(far.counts).toEqual({ added: 1, removed: 1, moved: 0, changed: 0 });
  // The same thing with another uid and order is the same.
  const same = compareTrack(version(kmpOf({ GOBJ: [object(1, 5, 0), object(2, 6, 5)] })), version(kmpOf({ GOBJ: [object(9, 6, 5), object(8, 5, 0)] })));
  expect(same.identical).toBe(true);
});

test("routes, settings, collision and files are compared too", () => {
  const group = (points: any[]) => ({ uid: 1, points, prev: [], next: [] });
  const point = (uid: number, x: number) => ({ uid, pos: [x, 0, 0], width: 10 });
  const checkpoint = (uid: number, x: number) => ({ uid, left: [x, -100], right: [x, 100], respawn: 0, type: 1 });
  const triangle = (x: number, y = 0) => [x, y, 0, x + 10, y, 0, x, y, 10];
  const mine = version(kmpOf({ ENPT: [group([point(1, 0), point(2, 500)])], CKPT: [group([checkpoint(3, 100)])], STGI: [{ uid: 1, laps: 5 }] }),
    kclOf([triangle(0), triangle(100), triangle(9000)], [0, 3, 0]), { "course_model.brres": [1, 2], "new.brres": [5], "course.kmp": [9] });
  const theirs = version(kmpOf({ ENPT: [group([point(4, 0)])], CKPT: [group([checkpoint(5, 180)])], STGI: [{ uid: 1, laps: 3 }] }),
    kclOf([triangle(0), triangle(100), triangle(20000)], [0, 2, 0]), { "course_model.brres": [1, 3], "old.brres": [7], "course.kmp": [8] });
  const result = compareTrack(mine, theirs);
  expect(result.items.find((item: any) => item.section === "ENPT").state).toBe("added");
  // A checkpoint has left and right rather than a position.
  const moved = result.items.find((item: any) => item.section === "CKPT");
  expect(moved.state).toBe("moved");
  expect(moved.pos).toEqual([100, 0, 0]);
  expect(result.settings).toEqual([{ field: "laps", mine: 5, theirs: 3 }]);
  expect([result.collision.added, result.collision.removed, result.collision.retyped]).toEqual([1, 1, 1]);
  expect(result.collision.regionCount).toBe(3);
  // The track's data has its own comparison, so it is not a file here.
  expect(result.files.map((file: any) => [file.path, file.state]).sort()).toEqual([["course_model.brres", "changed"], ["new.brres", "added"], ["old.brres", "removed"]]);
  const places = differencePlaces(result);
  expect(places.filter((place: any) => place.kind === "collision").length).toBe(3);
  expect(places.every((place: any) => place.pos.every(Number.isFinite))).toBe(true);
  // Without collision on one side it is all added.
  expect(compareTrack(version(kmpOf(), kclOf([triangle(0)], [0])), version(kmpOf())).collision.added).toBe(1);
  expect(compareTrack(version(kmpOf()), version(kmpOf())).identical).toBe(true);
});

test("every template builds a track with nothing wrong, and with what it promises", () => {
  expect(Object.keys(TEMPLATES).length).toBeGreaterThanOrEqual(5);
  const seen = new Set();
  for (const [name, template] of Object.entries(TEMPLATES) as [string, any][]) {
    const points = template.points();
    expect(points.length).toBeGreaterThan(3);
    const track = generateTrack(points, template.params);
    expect(generatedTrackIssues(track)).toEqual([]);
    // It starts clean: nothing for the generator to point out either.
    expect(layoutIssues(points, template.params)).toEqual([]);
    seen.add(template.params.style);
    expect(track.kmp.STGI[0].laps).toBe(template.params.laps);
    expect(track.kmp.CKPT.length).toBeGreaterThan(0);
    expect(track.kmp.GOBJ.some((object: any) => object.objectId === 0x65)).toBe(true);
    // Scenery as asked for.
    if (template.params.scenery !== "none") expect(track.kmp.GOBJ.some((object: any) => object.objectId !== 0x65)).toBe(true);
    // Its routes stay clear of its own walls.
    const kcl: any = { verts: track.verts, flags: track.flags, count: track.flags.length, valid: null };
    expect(kcl.count).toBeGreaterThan(100);
    const finds = geometryFinds(track.kmp, kcl, new HeightMap(kcl));
    expect(`${name}: ${finds.enemyWall.length} ${finds.itemWall.length} ${finds.respawnWall.length} ${finds.respawnFall.length}`).toBe(`${name}: 0 0 0 0`);
  }
  // Each has a look of its own.
  expect(seen.size).toBe(Object.keys(TEMPLATES).length);
});
