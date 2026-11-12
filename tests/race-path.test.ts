import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { PathRecorder, PATH_ROW, readKartSample, readRacedGhost, type KartSample } from "../src/race-path.ts";
import { deleteRecordedGhost, GhostCapture, listRecordedGhosts, readRecordedPath, runOf } from "../src/ghost-capture.ts";
import { GhostReplay } from "../src/ghost-replay.ts";
import { readRaceStage } from "../src/dolphin-memory.ts";
// @ts-ignore Shared editor code used by the frontend.
import { replaySteps } from "../web/js/editor/replay-steps.js";
// @ts-ignore Shared Wii format reader used by the frontend.
import { buildRKG, ghostForSlot, parseRKG, RKG_HEADER_SIZE } from "../web/js/formats/rkg.js";
// @ts-ignore Shared editor code used by the frontend.
import { attachRecordedPath, buildGhostDrive, ghostCamera, ghostPoseAt } from "../web/js/editor/ghost-drive.js";

// A run of these many frames: the countdown, then the race.
const runs = (total: number, state: number) => {
  const list = [];
  for (let left = total; left > 0; left -= 255) list.push({ state, frames: Math.min(255, left) });
  return list;
};
const inputsOf = (frames: number) => ({ face: runs(frames, 1), direction: runs(frames, 0x77), tricks: [{ state: 0, frames }] });
function ghostOf(frames: number) {
  const header = new Uint8Array(RKG_HEADER_SIZE);
  header.set([0x52, 0x4B, 0x47, 0x44]);
  const time = { minutes: 0, seconds: 10, milliseconds: 0 }, none = { minutes: 0, seconds: 0, milliseconds: 0 };
  return buildRKG({ header, time, track: 8, vehicle: 1, character: 0, year: 2026, month: 11, day: 7, controller: 0, ghostType: 1, automatic: false, laps: 3, splits: [time, none, none, none, none], country: 0xFF, inputs: inputsOf(frames) }, { compressed: true });
}

// A track: a ring of route points.
const loop = { KTPT: [{ pos: [5000, 0, 0] }], ENPT: [{ points: [0, 1, 2, 3, 4, 5].map((i) => ({ pos: [Math.cos(i) * 5000, 0, Math.sin(i) * 5000] })), next: [0] }], STGI: [{ laps: 3 }] };

// The race as the game runs it: before the countdown its counter stays at 0 and the kart is not placed
// yet; then the counter is the ghost's frame, 240 as the race starts, and goes on after the finish.
const at = (frame: number) => [frame * 10, 100 + frame, -frame * 5, 0, Math.sin(frame / 200), 0, Math.cos(frame / 200)];
function race(recorder: PathRecorder, frames: number, every = 1, from = 0) {
  if (!from) for (let i = 0; i < 30; i++) recorder.add({ stage: 0, frame: 0, pose: [0, 0, 0, 0, 0, 0, 1] });
  for (let frame = from; frame <= frames + 90; frame += every) {
    const stage = frame < 240 ? 1 : frame < frames ? 2 : 4;
    recorder.add({ stage, frame, pose: at(frame) });
  }
}
const rows = (path: Float32Array) => Array.from({ length: path.length / PATH_ROW }, (_, i) => [...path.subarray(i * PATH_ROW, (i + 1) * PATH_ROW)]);

test("the kart's place on each frame of a race becomes the ghost's path, frame for frame", () => {
  const recorder = new PathRecorder();
  race(recorder, 1000);
  const path = rows(recorder.path(1000)!);
  // From the countdown to the finish, each row on the ghost's own frame.
  expect(path[0][0]).toBe(0);
  expect(path.at(-1)![0]).toBe(1002);
  for (const row of path) expect(row.slice(1)).toEqual([...new Float32Array(at(row[0]))]);
  // Read every other frame: the frames still line up.
  const sparse = new PathRecorder();
  race(sparse, 1000, 2);
  expect(rows(sparse.path(1000)!).every((row) => row[1] === Math.fround(row[0] * 10))).toBe(true);
  // A read as the game begins a frame, before the kart has moved: dropped, and a later read of the
  // frame is the one kept.
  const late = new PathRecorder();
  for (let frame = 0; frame <= 600; frame++) late.add({ stage: frame < 240 ? 1 : 2, frame, pose: at(frame) });
  late.add({ stage: 2, frame: 601, pose: at(600) });
  expect(rows(late.path(600)!).some((row) => row[0] === 601)).toBe(false);
  late.add({ stage: 2, frame: 601, pose: at(601) });
  expect(rows(late.path(600)!).find((row) => row[0] === 601)![1]).toBe(Math.fround(at(601)[0]));
  // A race seen only from its middle, or with a long gap, is not a path.
  const middle = new PathRecorder();
  race(middle, 1000, 1, 600);
  expect(middle.path(1000)).toBeNull();
  const gaps = new PathRecorder();
  race(gaps, 1000, 90);
  expect(gaps.path(1000)).toBeNull();
  expect(new PathRecorder().path(1000)).toBeNull();
  // The next race starts over.
  race(recorder, 500);
  expect(rows(recorder.path(500)!).at(-1)![0]).toBe(502);
});

test("the kart is read from where the game keeps it, and memory that does not fit gives nothing", () => {
  const memory = new Map<number, number>();
  const u32 = (address: number, value: number) => { for (let k = 0; k < 4; k++) memory.set(address + k, (value >>> (24 - k * 8)) & 255); };
  const f32 = (address: number, value: number) => { const b = new DataView(new ArrayBuffer(4)); b.setFloat32(0, value); u32(address, b.getUint32(0)); };
  const read = (address: number, size: number) => Uint8Array.from({ length: size }, (_, i) => memory.get(address + i) ?? 0);
  // Karts → list → first kart → its parts → body → physics holder → physics.
  u32(0x809C18F8, 0x80E4D8F8); u32(0x80E4D8F8 + 0x20, 0x80E4D940); memory.set(0x80E4D8F8 + 0x24, 1); u32(0x80E4D940, 0x80E4DB08); u32(0x80E4DB08, 0x80E4DB24);
  u32(0x80E4DB24 + 0x08, 0x80E4F5AC); u32(0x80E4F5AC + 0x90, 0x80E4F11C); u32(0x80E4F11C + 0x04, 0x80E4F22C);
  const pose = [-2708.5, 593.25, 26529.75, 0, .6, 0, .8];
  pose.slice(0, 3).forEach((v, i) => f32(0x80E4F22C + 0x68 + i * 4, v));
  pose.slice(3).forEach((v, i) => f32(0x80E4F22C + 0x100 + i * 4, v));
  // Race manager: stage and frame counter.
  u32(0x809BD730, 0x80E44CBC); u32(0x80E44CBC + 0x28, 2); u32(0x80E44CBC + 0x20, 777);
  const sample = readKartSample("RMCP01", read)!;
  expect(sample).toMatchObject({ stage: 2, frame: 777 });
  expect(sample.pose.map((v) => Math.round(v * 1000) / 1000)).toEqual(pose);
  // Another game, or a rotation that is not one.
  expect(readKartSample("RSBE01", read)).toBeNull();
  expect(readKartSample("RMCP01", read, 1)).toBeNull(); // only one kart in this race
  f32(0x80E4F22C + 0x100 + 4, 3);
  expect(readKartSample("RMCP01", read)).toBeNull();
  expect(readKartSample("RMCP01", () => null)).toBeNull();
  // The ghost the game races: the file it loaded, in the race settings (in the second memory).
  expect(readRacedGhost("RMCP01", read)).toBeNull();
  const loaded = ghostOf(400);
  u32(0x809BD728, 0x9023A510);
  loaded.forEach((b: number, i: number) => memory.set(0x9023A510 + 0x23F0 + i, b));
  expect(runOf(readRacedGhost("RMCP01", read)!)).toBe(runOf(loaded));
  expect(readRacedGhost("RSBE01", read)).toBeNull();
});

test("a recorded run keeps its path beside it, the preview shows it, and it goes with the ghost", () => {
  const dir = mkdtempSync(join(tmpdir(), "mkwii-path-"));
  try {
    const library = join(dir, "recorded"), bytes = ghostOf(1000);
    let stage = 2;
    const capture = new GhostCapture(() => [], () => ({ dolphin: true, game: "RMCP01", stage }), () => library,
      () => ({ bytes, automatic: false }), () => null);
    capture.start();
    race(capture.paths, 1000);
    capture.status();
    stage = 4;
    expect(capture.status().captured.length).toBe(1);
    capture.stop();
    const stored = readRecordedPath(library, bytes)!;
    expect(stored.length).toBe(1003 * PATH_ROW * 4);
    // Found by the run, also from a copy of the file.
    expect(readRecordedPath(library, buildRKG(parseRKG(bytes), { compressed: false }))).not.toBeNull();
    expect(readRecordedPath(library, ghostOf(900))).toBeNull();

    // The preview: the kart where the game had it, turned as it was.
    const ghost = parseRKG(bytes), drive = attachRecordedPath(buildGhostDrive(ghost, loop), stored);
    const pose = ghostPoseAt(drive, 500);
    expect(pose.recorded).toBe(true);
    expect(pose.position.map((v: number) => Math.round(v))).toEqual([5000, 545, -2500]);
    const turned = Math.atan2(2 * Math.sin(500 / 200) * Math.cos(500 / 200), 1 - 2 * Math.sin(500 / 200) ** 2);
    expect(pose.rotation[1]).toBeCloseTo(turned, 4);
    expect(pose.forward[0]).toBeCloseTo(Math.sin(turned), 4);
    expect(pose.forward[1]).toBeCloseTo(Math.cos(turned), 4);
    // Without a path it is the approximation, as before.
    expect(ghostPoseAt(buildGhostDrive(ghost, loop), 500).recorded).toBeUndefined();

    // Deleting the ghost deletes its path.
    deleteRecordedGhost(library, listRecordedGhosts(library)[0].path);
    expect(readRecordedPath(library, bytes)).toBeNull();
  } finally {
    if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe test folder");
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a path that says what the kart does gives each frame its drift, boost and air", () => {
  const ghost = parseRKG(ghostOf(400));
  // frame, place, rotation, then drift, boost, air, wheelie.
  const rows = [[0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0], [100, 10, 0, 0, 0, 0, 0, 1, 2, 1, 0, 0], [200, 20, 0, 0, 0, 0, 0, 1, 3, 0, 1, 1], [400, 40, 0, 0, 0, 0, 0, 1, 0, 2, 0, 0]];
  const drive = attachRecordedPath(buildGhostDrive(ghost, loop), new Uint8Array(new Float32Array(rows.flat()).buffer), { source: "kinoko", synced: true, from: 0, row: 12 });
  expect(ghostPoseAt(drive, 50)).toMatchObject({ drift: 0, boost: 0, airborne: false });
  expect(ghostPoseAt(drive, 150)).toMatchObject({ drift: 2, boost: 1, boostKind: 1, airborne: false, wheelie: false });
  expect(ghostPoseAt(drive, 250)).toMatchObject({ drift: 3, boost: 0, airborne: true, wheelie: true });
  // The place is still eased between rows.
  expect(ghostPoseAt(drive, 150).position[0]).toBe(15);
  // A path of place and rotation only says nothing of it: the mushrooms pressed make the boost.
  const plain = attachRecordedPath(buildGhostDrive(ghost, loop), new Uint8Array(new Float32Array(rows.map((r) => r.slice(0, 8)).flat()).buffer));
  expect(ghostPoseAt(plain, 150).drift).toBe(0);
});

test("in a drift the camera follows the way the kart goes, not the way its body points", () => {
  const ghost = parseRKG(ghostOf(400));
  // Going straight along +Z at 60 units a frame, the body turned 45 degrees across, as in a drift.
  const half = Math.PI / 8, turned = [0, Math.sin(half), 0, Math.cos(half)];
  const rows = Array.from({ length: 401 }, (_, f) => [f, 0, 0, f >= 240 ? (f - 240) * 60 : 0, ...turned]);
  const drive = attachRecordedPath(buildGhostDrive(ghost, loop), new Uint8Array(new Float32Array(rows.flat()).buffer));
  const pose = ghostPoseAt(drive, 320);
  expect(pose.forward[0]).toBeCloseTo(Math.SQRT1_2, 3); // the body: across
  expect(pose.view[0]).toBeCloseTo(0, 3); // the camera: along
  expect(pose.view[1]).toBeCloseTo(1, 3);
  const behind = ghostCamera(pose, "chase");
  expect(behind.position[0]).toBeCloseTo(pose.position[0], 1);
  expect(behind.position[2]).toBeLessThan(pose.position[2]);
  // Before the start, standing still, it looks the way the body points.
  expect(ghostPoseAt(drive, 100).view[0]).toBeCloseTo(Math.SQRT1_2, 3);
});

test("frames between two reads are eased from one to the other", () => {
  const ghost = parseRKG(ghostOf(400));
  const path = new Float32Array([0, 0, 0, 0, 0, 0, 0, 1, 100, 1000, 50, 0, 0, Math.SQRT1_2, 0, Math.SQRT1_2, 400, 1000, 50, 0, 0, Math.SQRT1_2, 0, Math.SQRT1_2]);
  const drive = attachRecordedPath(buildGhostDrive(ghost, loop), new Uint8Array(path.buffer));
  expect(ghostPoseAt(drive, 50).position).toEqual([500, -30, 0]);
  expect(ghostPoseAt(drive, 50).rotation[1]).toBeCloseTo(Math.PI / 4, 5);
  expect(ghostPoseAt(drive, 200).rotation[1]).toBeCloseTo(Math.PI / 2, 5);
});

test("any ghost's path is read while the game races it as a staff ghost, and both staff ghosts go back", () => {
  const dir = mkdtempSync(join(tmpdir(), "mkwii-replay-"));
  try {
    const workspace = join(dir, "files"), library = join(dir, "recorded"), keep = join(dir, "ghost-replay.json");
    // The track's two staff ghosts: which one the game offers depends on the save.
    const staffPath = join(workspace, "Race", "TimeAttack", "ghost1", "ghost1_comp_00.rkg"), expertPath = join(workspace, "Race", "TimeAttack", "ghost2", "ghost2_comp_00.rkg");
    mkdirSync(dirname(staffPath), { recursive: true });
    mkdirSync(dirname(expertPath), { recursive: true });
    const staff = ghostForSlot(ghostOf(600), 8, 0x25), expert = ghostForSlot(ghostOf(500), 8, 0x26);
    writeFileSync(staffPath, staff);
    writeFileSync(expertPath, expert);
    const untouched = () => Buffer.from(readFileSync(staffPath)).equals(Buffer.from(staff)) && Buffer.from(readFileSync(expertPath)).equals(Buffer.from(expert));
    const wanted = ghostOf(1000);
    let kart: KartSample | null = null, raced: Uint8Array | null = null;
    const replay = new GhostReplay(() => keep, () => library, (index) => index === 1 ? kart : null, () => raced, false);
    const step = (stage: number, frame: number) => { kart = { stage, frame, pose: at(frame) }; replay.tick(); };

    // In place of both staff ghosts, each keeping its kind, kept to go back.
    expect(replay.start(wanted, workspace).phase).toBe("waiting");
    expect(runOf(new Uint8Array(readFileSync(staffPath)))).toBe(runOf(wanted));
    expect(parseRKG(new Uint8Array(readFileSync(expertPath)))).toMatchObject({ ghostType: 0x26, track: 8 });
    expect(runOf(new Uint8Array(readFileSync(expertPath)))).toBe(runOf(wanted));
    expect(existsSync(keep)).toBe(true);
    // A race against another ghost (the game started before the swap): not read.
    raced = staff;
    step(1, 0);
    expect(replay.status().phase).toBe("other-ghost");
    for (let frame = 1; frame < 700; frame++) step(frame < 240 ? 1 : 2, frame);
    expect(replay.status().reached).toBe(0);
    // Against this ghost, but the player crosses the line first.
    raced = new Uint8Array(readFileSync(expertPath));
    for (let frame = 0; frame < 700; frame++) step(frame < 240 ? 1 : 2, frame);
    expect(replay.status()).toMatchObject({ phase: "reading", reached: 699, frames: 1000 });
    step(4, 700);
    expect(replay.status().phase).toBe("finished-first");
    // Raced again to the ghost's finish: its path, and the staff ghost back.
    for (let frame = 0; frame <= 1002; frame++) step(frame < 240 ? 1 : 2, frame);
    expect(replay.status().phase).toBe("done");
    expect(readRecordedPath(library, wanted)!.length).toBe(1003 * PATH_ROW * 4);
    expect(untouched()).toBe(true);
    expect(existsSync(keep)).toBe(false);
    // Already read: nothing to race.
    expect(replay.start(wanted, workspace).phase).toBe("done");
    expect(untouched()).toBe(true);

    // Closed while reading, or the editor closed: the staff ghost goes back either way.
    const other = ghostOf(900);
    replay.start(other, workspace);
    replay.stop();
    expect(untouched()).toBe(true);
    replay.start(other, workspace);
    new GhostReplay(() => keep, () => library).recover();
    expect(untouched()).toBe(true);
    expect(existsSync(keep)).toBe(false);
    replay.stop();
    // A file left by the version that replaced only one.
    writeFileSync(keep, JSON.stringify({ slot: staffPath, before: Buffer.from(staff).toString("base64") }));
    writeFileSync(staffPath, wanted);
    new GhostReplay(() => keep, () => library).recover();
    expect(untouched()).toBe(true);
    // A track whose staff ghost is not in the game folder.
    expect(() => replay.start(buildRKG({ ...parseRKG(other), track: 3 }, { compressed: true }), workspace)).toThrow("no staff ghost");
  } finally {
    if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe test folder");
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the steps of reading a ghost's path point at the next thing to do", () => {
  const game = { dolphin: true, game: "RMCP01", stage: -1 };
  const current = (replay: any, state: any = game) => replaySteps(replay, state, "Luigi Circuit").current;
  expect(current({ phase: "waiting" }, { dolphin: false, game: null })).toBe("game");
  expect(current({ phase: "waiting" })).toBe("race");
  expect(current({ phase: "other-ghost" })).toBe("race");
  expect(replaySteps({ phase: "other-ghost" }, game, "Luigi Circuit").steps[1].text).toContain("start the game again");
  const reading = replaySteps({ phase: "reading", reached: 500, frames: 1000 }, game, "Luigi Circuit");
  expect(reading).toMatchObject({ current: "finish", reading: true, share: 50 });
  expect(reading.steps[2].text).toContain("50%");
  expect(replaySteps({ phase: "finished-first" }, game).steps[2].text).toContain("crossed the line first");
  expect(current({ phase: "done" })).toBe("done");
});

// MKW-SP runs on all four regions by carrying PAL addresses over with the tables of its port.py: a
// PAL range starts at another address in each region. The addresses read here are those, ported.
test("each region's addresses are the PAL ones carried over as MKW-SP does", () => {
  const chunks: Record<string, [number, number, number][]> = {
    // PAL start, PAL end, the region's start: race settings and managers; the karts.
    E: [[0x809BD6E8, 0x809BD74C, 0x809B8F28], [0x809C18F8, 0x809C18FC, 0x809BD110]],
    J: [[0x809BD6E8, 0x809BD74C, 0x809BC748], [0x809C18F8, 0x809C18FC, 0x809C0958]],
    K: [[0x809BD6E8, 0x809BD74C, 0x809ABD28], [0x809C18F8, 0x809C18FC, 0x809AFF38]],
  };
  const port = (region: string, pal: number) => {
    const chunk = chunks[region].find(([start, end]) => pal >= start && pal < end)!;
    return chunk[2] + pal - chunk[0];
  };
  // The input manager, race settings, race manager and karts, in each region's read: a memory where
  // only the region's own pointers lead anywhere gives a kart to that region and to no other.
  for (const region of ["E", "J", "K"]) {
    const memory = new Map<number, number>();
    const u32 = (address: number, value: number) => { for (let k = 0; k < 4; k++) memory.set(address + k, (value >>> (24 - k * 8)) & 255); };
    const f32 = (address: number, value: number) => { const b = new DataView(new ArrayBuffer(4)); b.setFloat32(0, value); u32(address, b.getUint32(0)); };
    const read = (address: number, size: number) => Uint8Array.from({ length: size }, (_, i) => memory.get(address + i) ?? 0);
    u32(port(region, 0x809C18F8), 0x80E4D8F8); u32(0x80E4D8F8 + 0x20, 0x80E4D940); memory.set(0x80E4D8F8 + 0x24, 1); u32(0x80E4D940, 0x80E4DB08); u32(0x80E4DB08, 0x80E4DB24);
    u32(0x80E4DB24 + 0x08, 0x80E4F5AC); u32(0x80E4F5AC + 0x90, 0x80E4F11C); u32(0x80E4F11C + 0x04, 0x80E4F22C);
    f32(0x80E4F22C + 0x100 + 12, 1);
    u32(port(region, 0x809BD730), 0x80E44CBC); u32(0x80E44CBC + 0x28, 2); u32(0x80E44CBC + 0x20, 300);
    for (const other of ["P", "E", "J", "K"]) expect(!!readKartSample(`RMC${other}01`, read)).toBe(other === region);
    // The race stage that the recording steps follow, from the same race manager.
    expect(readRaceStage(`RMC${region}01`, read)).toBe(2);
  }
});
