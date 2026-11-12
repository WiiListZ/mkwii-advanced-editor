import { expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { TRACK_NAMES } from "../web/js/data/defs.js";
import { geometryFinds, geometryIssues } from "../web/js/editor/geometry-check.js";
import { HeightMap } from "../web/js/editor/heightmap.js";
import { trackUsage, usageIssues, usageState } from "../web/js/editor/track-limits.js";
import { parseKCL } from "../web/js/formats/kcl.js";
import { parseKMP } from "../web/js/formats/kmp.js";
import { findFile, parseU8 } from "../web/js/formats/u8.js";
import { yaz0Decompress } from "../web/js/formats/yaz0.js";

const game = process.env.MKWII_GAME_DIR;

// Collision from flat triangles: { type, verts: nine numbers }.
function collision(triangles: { type: number; verts: number[] }[]) {
  const kcl: any = { verts: new Float32Array(triangles.flatMap((t) => t.verts)), flags: new Uint16Array(triangles.map((t) => t.type)), count: triangles.length, valid: null };
  return { kcl, heights: new HeightMap(kcl) };
}
// A floor over x -5000..25000, z -5000..5000, and walls across x = at.
const FLOOR = [
  { type: 0, verts: [-5000, 0, -5000, 25000, 0, -5000, -5000, 0, 5000] },
  { type: 0, verts: [25000, 0, -5000, 25000, 0, 5000, -5000, 0, 5000] },
];
const wallAt = (x: number, type = 0x0C, top = 2000, half = 5000) => [
  { type, verts: [x, 0, -half, x, top, -half, x, 0, half] },
  { type, verts: [x, top, -half, x, top, half, x, 0, half] },
];
const point = (x: number, z = 0, uid = x) => ({ uid, pos: [x, 20, z] });
const emptyKmp = () => ({ ENPT: [] as any[], ITPT: [] as any[], CKPT: [] as any[], GOBJ: [] as any[], JGPT: [] as any[], KTPT: [], AREA: [], CAME: [], POTI: [] }) as any;
const checkpointAt = (x: number, uid = 900) => ({ uid, left: [x, -1000], right: [x, 1000] });

test("a route through a tall wall is found, one that clips a low kerb or a corner is not", () => {
  const route = [{ points: [point(0), point(4000)], next: [] }];
  const kmp = { ...emptyKmp(), ENPT: route, ITPT: route, CKPT: [{ points: [checkpointAt(1000)], next: [] }] };
  const through = collision([...FLOOR, ...wallAt(2000)]);
  const finds = geometryFinds(kmp, through.kcl, through.heights);
  expect(finds.enemyWall.length).toBe(1);
  expect(finds.enemyWall[0].key).toBe(4000);
  expect(finds.itemWall.length).toBe(1);
  // A kerb the kart drives over.
  const kerb = collision([...FLOOR, ...wallAt(2000, 0x0C, 200)]);
  expect(geometryFinds(kmp, kerb.kcl, kerb.heights).enemyWall).toEqual([]);
  // The end of a wall that a corner of the line only touches: not across the whole width.
  const corner = collision([...FLOOR, ...wallAt(2000, 0x0C, 2000, 100)]);
  expect(geometryFinds(kmp, corner.kcl, corner.heights).enemyWall).toEqual([]);
  // A wall that items and karts may pass is not a wall here.
  const invisible = collision([...FLOOR, ...wallAt(2000, 0x0E)]);
  expect(geometryFinds(kmp, invisible.kcl, invisible.heights).enemyWall).toEqual([]);
  // Links between groups count too.
  const linked = { ...kmp, ENPT: [{ points: [point(0)], next: [1] }, { points: [point(4000)], next: [] }] };
  expect(geometryFinds(linked, through.kcl, through.heights).enemyWall.length).toBe(1);
  // In a battle arena, with no checkpoints, enemy points are not a way to drive.
  expect(geometryFinds({ ...kmp, CKPT: [] }, through.kcl, through.heights).enemyWall).toEqual([]);
});

test("a checkpoint off the route is found", () => {
  const { kcl, heights } = collision(FLOOR);
  const kmp = { ...emptyKmp(), ENPT: [{ points: [point(0), point(4000)], next: [] }], CKPT: [{ points: [checkpointAt(1000, 1), { uid: 2, left: [2000, 3000], right: [2000, 4000] }], next: [] }] };
  const finds = geometryFinds(kmp, kcl, heights);
  expect(finds.checkpointMissed.map((find: any) => find.key)).toEqual([2]);
});

test("an item box in a wall, and respawns over a fall or facing a wall, are found", () => {
  const { kcl, heights } = collision([...FLOOR, ...wallAt(2000), { type: 0x10, verts: [8000, -100, -500, 9000, -100, -500, 8000, -100, 500] }]);
  const box = (x: number) => ({ uid: x, objectId: 0x65, pos: [x, 100, 0] });
  const kmp = { ...emptyKmp(), GOBJ: [box(2000), box(1000), { uid: 5, objectId: 0x66, pos: [2000, 100, 0] }] };
  expect(geometryFinds(kmp, kcl, heights).boxInWall.map((find: any) => find.key)).toEqual([2000]);
  // The floor stops at y = 0 there, so the fall boundary at -100 is under it: put the respawn off the floor.
  const off = collision([...wallAt(2000), { type: 0, verts: [0, 0, -1000, 1500, 0, -1000, 0, 0, 1000] }, { type: 0x10, verts: [8000, -100, -500, 9500, -100, -500, 8000, -100, 900] }, { type: 0x0A, verts: [12000, -100, -500, 13500, -100, -500, 12000, -100, 900] }]);
  const respawn = (x: number, z: number, heading: number, uid: number) => ({ uid, pos: [x, 100, z], rot: [0, heading, 0] });
  const respawns = { ...emptyKmp(), JGPT: [respawn(8300, 0, 0, 1), respawn(12300, 0, 0, 2), respawn(300, 0, 0, 3), respawn(1800, 0, 90, 4), respawn(1800, 0, -90, 5)] };
  const finds = geometryFinds(respawns, off.kcl, off.heights);
  expect(finds.respawnFall.map((find: any) => find.key)).toEqual([1, 2]);
  // Heading 90 goes along +x, into the wall at 2000; the other way faces clear road.
  expect(finds.respawnWall.map((find: any) => find.key)).toEqual([4]);
});

test("a long stretch with no collision under the route is noted, but a fall plane counts as collision", () => {
  const road = collision([{ type: 0, verts: [-500, 0, -500, 500, 0, -500, -500, 0, 500] }]);
  const kmp = { ...emptyKmp(), ENPT: [{ points: [point(0), point(9000)], next: [] }], CKPT: [{ points: [checkpointAt(100)], next: [] }] };
  expect(geometryFinds(kmp, road.kcl, road.heights).routeNoGround.length).toBe(1);
  const plane = collision([{ type: 0, verts: [-500, 0, -500, 500, 0, -500, -500, 0, 500] }, { type: 0x10, verts: [-400000, -2000, -400000, 400000, -2000, -400000, 0, -2000, 400000] }]);
  expect(geometryFinds(kmp, plane.kcl, plane.heights).routeNoGround).toEqual([]);
});

test("issues carry levels, are capped by kind, and are not found twice for the same data", () => {
  const { kcl, heights } = collision([...FLOOR, ...wallAt(2000)]);
  const segments = Array.from({ length: 9 }, (_, i) => point(2000 - 200 + i * 40, 0, i));
  const route = { points: [...segments.flatMap((p, i) => i % 2 ? [{ ...p, pos: [2300, 20, i * 300] }] : [{ ...p, pos: [1700, 20, i * 300] }])], next: [] };
  const kmp = { ...emptyKmp(), ENPT: [route], CKPT: [{ points: [checkpointAt(1000)], next: [] }] };
  const doc = { kmp, kcl, heights };
  const issues = geometryIssues(doc);
  const walls = issues.filter((issue: any) => /through a wall/.test(issue.msg));
  expect(walls.length).toBe(6);
  expect(walls.every((issue: any) => issue.level === "warning")).toBe(true);
  expect(issues.some((issue: any) => /^And 2 more/.test(issue.msg))).toBe(true);
  expect(geometryIssues(doc)).toBe(issues);
  // A point moved: found again.
  route.points[0].pos = [1700, 20, 50];
  expect(geometryIssues(doc)).not.toBe(issues);
  // Without collision there is nothing to check against.
  expect(geometryIssues({ kmp, kcl: null, heights: null })).toEqual([]);
});

test("the track's size is set against the originals and the formats' limits", () => {
  const kmp = { ...emptyKmp(), ENPT: [{ points: Array.from({ length: 300 }, (_, i) => point(i)), next: [] }], GOBJ: Array.from({ length: 700 }, (_, i) => ({ uid: i, objectId: i, pos: [0, 0, 0] })) };
  const doc = { kmp, kcl: { count: 70000 }, szs: null };
  const rows = trackUsage(doc), row = (id: string) => rows.find((r: any) => r.id === id);
  expect(usageState(row("enemy"))).toBe("over");
  expect(usageState(row("collision"))).toBe("over");
  expect(usageState(row("objects"))).toBe("high");
  expect(usageState(row("kinds"))).toBe("high");
  expect(usageState(row("item"))).toBe("ok");
  // Limits passed are errors the validator says itself; above the originals is said once, as a warning if it is about memory.
  const issues = usageIssues(doc);
  expect(issues.some((issue: any) => issue.msg.startsWith("Enemy route points"))).toBe(false);
  expect(issues.find((issue: any) => issue.msg.startsWith("Objects"))!.level).toBe("warning");
  expect(usageIssues({ kmp: emptyKmp(), kcl: { count: 10 }, szs: null })).toEqual([]);
});

const raceTracks = game && existsSync(join(game, "Race", "Course")) ? Object.keys(TRACK_NAMES).filter((stem) => existsSync(join(game, "Race", "Course", `${stem}.szs`))) : [];
const open = (stem: string) => {
  const szs = parseU8(yaz0Decompress(new Uint8Array(readFileSync(join(game!, "Race", "Course", `${stem}.szs`)))));
  const kcl = parseKCL(findFile(szs, "course.kcl").data);
  return { szs, kmp: parseKMP(findFile(szs, "course.kmp").data), kcl, heights: new HeightMap(kcl) };
};

test("on the game's own tracks the checks stay quiet, and none is above the originals", () => {
  if (!raceTracks.length) return;
  const totals: Record<string, number> = {};
  for (const stem of raceTracks) {
    const doc = open(stem);
    for (const [kind, list] of Object.entries(geometryFinds(doc.kmp, doc.kcl, doc.heights))) totals[kind] = (totals[kind] || 0) + (list as any[]).length;
    expect(usageIssues(doc)).toEqual([]);
    const rows = trackUsage(doc);
    for (const row of rows) expect(usageState(row)).toBe("ok");
    // Measured, not zero because something was not found.
    for (const id of ["archive", "model", "textures", "triangles", "materials", "collision", "objects"]) expect(rows.find((row: any) => row.id === id)!.value).toBeGreaterThan(0);
  }
  // What they all work with: these never fire, and the others stay rare over 32 tracks.
  expect(totals.boxInWall).toBeLessThanOrEqual(1);
  expect(totals.respawnWall).toBe(0);
  expect(totals.respawnFall).toBeLessThanOrEqual(2);
  expect(totals.enemyWall).toBeLessThanOrEqual(20);
  expect(totals.itemWall).toBeLessThanOrEqual(20);
  expect(totals.checkpointMissed).toBeLessThanOrEqual(8);
  expect(totals.routeNoGround).toBeLessThanOrEqual(5);
}, 60000); // every track of the game
