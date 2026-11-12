import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { deleteRecordedGhost, GhostCapture, listRecordedGhosts, saveRecordedGhost, trackGhostSlots } from "../src/ghost-capture.ts";
import { findProcesses, openForReading, readMemory, readRaceStage } from "../src/dolphin-memory.ts";
import { buildGhostDrive, ghostCamera, ghostPoseAt, ghostTrackCheck } from "../web/js/editor/ghost-drive.js";
import { kartArchiveName } from "../web/js/editor/kart-archives.js";
import { recordSteps } from "../web/js/editor/record-steps.js";
import { compareGhosts, differenceText } from "../web/js/editor/ghost-compare.js";
import { yaz0Decompress } from "../web/js/formats/yaz0.js";
import { findFile, parseU8 } from "../web/js/formats/u8.js";
import { TRACK_NAMES } from "../web/js/data/defs.js";
import { HeightMap } from "../web/js/editor/heightmap.js";
import { parseKCL } from "../web/js/formats/kcl.js";
import { parseKMP } from "../web/js/formats/kmp.js";
import { buildRKG, COURSE_NAMES, COUNTDOWN_FRAMES, FRAMES_PER_SECOND, ghostClock, ghostForSlot, inputsAtFrame, crc32, encodeInputs, inputFrames, parseInputs, parseRKG, saveComplete, saveGhostBytes, saveGhosts, timeText } from "../web/js/formats/rkg.js";

const game = process.env.MKWII_GAME_DIR;
const realSave = `${process.env.APPDATA}/Dolphin Emulator/Wii/title/00010004/524d4350/data/rksys.dat`;

// A small ghost, written byte by byte as the wiki lays it out.
function handmade() {
  const header = new Uint8Array(0x88);
  header.set([0x52, 0x4B, 0x47, 0x44]);
  // 1:29.670, track 8.
  header.set([0x02, 0x76, 0x9E, 0x20], 4);
  // Vehicle 1, character 0x16, 2009-03-07, controller 2.
  let bits = (1 * 2 ** 26) + (0x16 * 2 ** 20) + (9 * 2 ** 13) + (3 * 2 ** 9) + (7 * 2 ** 4) + 2;
  for (let i = 3; i >= 0; i--) { header[8 + i] = bits & 255; bits = Math.floor(bits / 256); }
  header[0x0D] = 0x02; // automatic drift
  header[0x10] = 3;
  header.set([0, 0x48, 0x10], 0x11);
  header.set([0, 0x4A, 0x20], 0x14);
  header.set([0, 0x4C, 0x30], 0x17);
  header[0x34] = 0xFF;
  for (const [i, c] of [..."Ghosty"].entries()) header[0x3C + 2 + i * 2 + 1] = c.charCodeAt(0);
  const inputs = { face: [{ state: 1, frames: 200 }, { state: 3, frames: 100 }], direction: [{ state: 0x77, frames: 255 }, { state: 0xE7, frames: 45 }], tricks: [{ state: 0, frames: 290 }, { state: 0x10, frames: 10 }] };
  return { header, inputs };
}

test("a ghost's fields are read from the bits the format gives them", () => {
  const { header, inputs } = handmade();
  const body = encodeInputs(inputs), raw = new Uint8Array(0x2800);
  raw.set(header); raw.set(body, 0x88);
  raw[0x0E] = body.length >> 8; raw[0x0F] = body.length & 255;
  const crc = crc32(raw.subarray(0, 0x27FC));
  raw.set([crc >>> 24, (crc >>> 16) & 255, (crc >>> 8) & 255, crc & 255], 0x27FC);
  const ghost = parseRKG(raw);
  expect(timeText(ghost.time)).toBe("1:29.670");
  expect(ghost).toMatchObject({ track: 8, vehicle: 1, character: 0x16, year: 2009, month: 3, day: 7, controller: 2, compressed: false, automatic: true, laps: 3, miiName: "Ghosty", crcValid: true });
  expect(timeText(ghost.splits[0])).toBe("0:18.016");
  expect(ghost.inputs).toEqual(inputs);
  expect(inputFrames(ghost.inputs.face)).toBe(300);
});

test("edited fields are written and read back, compressed or raw, with a valid checksum", () => {
  const { header, inputs } = handmade();
  const base = parseRKG((() => { const raw = new Uint8Array(0x2800); raw.set(header); const body = encodeInputs(inputs); raw.set(body, 0x88); raw[0x0E] = body.length >> 8; raw[0x0F] = body.length & 255; return raw; })());
  const edited = { ...base, time: { minutes: 2, seconds: 3, milliseconds: 456 }, track: 13, character: 4, vehicle: 35, controller: 3, automatic: false, laps: 5, year: 2026, month: 11, day: 5, ghostType: 2, country: 49 };
  edited.inputs = { ...inputs, face: [{ state: 1, frames: 250 }] };
  for (const compressed of [true, false]) {
    const bytes = buildRKG(edited, { compressed }), back = parseRKG(bytes);
    expect(back.crcValid).toBe(true);
    expect(back.compressed).toBe(compressed);
    expect(back).toMatchObject({ track: 13, character: 4, vehicle: 35, controller: 3, automatic: false, laps: 5, year: 2026, month: 11, day: 5, ghostType: 2, country: 49, miiName: "Ghosty" });
    expect(timeText(back.time)).toBe("2:03.456");
    expect(back.inputs).toEqual(edited.inputs);
    if (!compressed) expect(bytes.length).toBe(0x2800);
  }
  expect(() => buildRKG({ ...edited, inputs: { ...inputs, face: [{ state: 1, frames: 300 }] } })).toThrow();
  expect(() => encodeInputs({ face: Array(6000).fill({ state: 1, frames: 1 }), direction: [], tricks: [] })).toThrow();
});

test("the inputs held on a frame come from each section's entries", () => {
  const inputs = {
    face: [{ state: 0, frames: 10 }, { state: 1, frames: 10 }, { state: 7, frames: 10 }],
    direction: [{ state: 0x77, frames: 15 }, { state: 0xE7, frames: 5 }, { state: 0x0E, frames: 10 }],
    tricks: [{ state: 0, frames: 25 }, { state: 0x10, frames: 5 }],
  };
  expect(inputsAtFrame(inputs, 0)).toEqual({ accelerate: false, brake: false, item: false, stickX: 0, stickY: 0, trick: null });
  expect(inputsAtFrame(inputs, 9).accelerate).toBe(false);
  expect(inputsAtFrame(inputs, 10).accelerate).toBe(true);
  expect(inputsAtFrame(inputs, 20)).toMatchObject({ accelerate: true, brake: true, item: true });
  // Right and forward are positive; left and backward negative.
  expect(inputsAtFrame(inputs, 15)).toMatchObject({ stickX: 1, stickY: 0 });
  expect(inputsAtFrame(inputs, 20)).toMatchObject({ stickX: -1, stickY: 1 });
  expect(inputsAtFrame(inputs, 26).trick).toBe("up");
  // Past the end it holds the last one, and an empty section reads as nothing held.
  expect(inputsAtFrame(inputs, 999).item).toBe(true);
  expect(inputsAtFrame({ face: [], direction: [], tricks: [] }, 5)).toMatchObject({ accelerate: false, stickX: 0, trick: null });
});

test("the race clock starts after the countdown, and laps change at the lap times", () => {
  const t = (seconds: number) => ({ minutes: 0, seconds, milliseconds: 0 });
  const ghost = { laps: 3, time: { minutes: 1, seconds: 0, milliseconds: 0 }, splits: [t(20), t(20), t(20), t(0), t(0)] };
  const at = (seconds: number) => ghostClock(ghost, COUNTDOWN_FRAMES + seconds * FRAMES_PER_SECOND);
  expect(ghostClock(ghost, 0).clock).toBeCloseTo(-240 / FRAMES_PER_SECOND);
  expect(ghostClock(ghost, COUNTDOWN_FRAMES).clock).toBe(0);
  expect(at(5)).toMatchObject({ lap: 1, finished: false });
  expect(at(19.9).lap).toBe(1);
  expect(at(20.1).lap).toBe(2);
  expect(at(40.1).lap).toBe(3);
  expect(at(59).finished).toBe(false);
  // At the end it stays on the last lap, finished.
  expect(at(60.1)).toMatchObject({ lap: 3, finished: true });
});

test("a ghost's vehicle and character name its archive", () => {
  expect(kartArchiveName(1, 0)).toBe("mdf_kart-mr.szs");
  expect(kartArchiveName(16, 7)).toBe("me_kart-lg.szs");
  expect(kartArchiveName(23, 23)).toBe("la_bike-rs.szs");
  expect(kartArchiveName(35, 22)).toBe("le_bike-fk.szs");
  expect(kartArchiveName(0, 0x18)).toBe("sdf_kart-sa_mii_m.szs");
  expect(kartArchiveName(0, 0x1D)).toBe("sdf_kart-sa_mii_f.szs");
  expect(kartArchiveName(1, 0x20)).toBe("mdf_kart-mb_mii_m.szs");
  expect(kartArchiveName(0, 0x25)).toBe("sdf_kart-la_mii_f.szs");
  expect(kartArchiveName(99, 0)).toBeNull();
  expect(kartArchiveName(0, 0x2A)).toBeNull();
  // Every driver has the 12 vehicles of their size, on the disc.
  if (game) for (let character = 0; character < 0x2A; character++) {
    let found = 0;
    for (let vehicle = 0; vehicle < 36; vehicle++) if (existsSync(join(game, "Race", "Kart", kartArchiveName(vehicle, character)!))) found++;
    expect(found).toBe(12);
  }
});

// A long thin loop round a lap of 50 seconds, with what lies on its first side given by distance along it.
function straightTrack(surfaceAt: (distance: number) => { y: number; flag: number }) {
  const points = [0, 30000, 60000].map((z) => ({ pos: [0, 0, z], width: 20 }));
  const back = [60000, 30000, 0].map((z) => ({ pos: [20000, 0, z], width: 20 }));
  const flags: number[] = [];
  const heights = {
    kcl: { flags },
    surfacesAt(x: number, z: number) {
      if (Math.abs(x) > 1500) return [{ y: 0, tri: 0 }];
      const { y, flag } = surfaceAt(z);
      flags[1] = flag;
      flags[0] = 0;
      return [{ y, tri: 1 }];
    },
  };
  return { kmp: { KTPT: [{ pos: [0, 0, 0] }], ENPT: [{ points: [...points, ...back], next: [0] }] }, heights };
}
function straightGhost(vehicle: number, tricks: any[], face: any[] | null = null) {
  const frames = 240 + 3000;
  const t = (seconds: number) => ({ minutes: 0, seconds, milliseconds: 0 });
  return {
    vehicle, laps: 1, time: t(50), splits: [{ minutes: 0, seconds: 50, milliseconds: 0 }, t(0), t(0), t(0), t(0)],
    inputs: { face: face || [{ state: 1, frames }], direction: [{ state: 0x77, frames }], tricks },
  } as any;
}
const airFrames = (drive: any) => drive.flight.air.reduce((sum: number, on: number) => sum + on, 0);

test("the kart leaves the ground where the road falls away, and comes back down under gravity", () => {
  // A ramp up to 600 that ends in a drop to the road below.
  const { kmp, heights } = straightTrack((z) => ({ y: z > 9000 && z < 12000 ? (z - 9000) / 5 : 0, flag: 0 }));
  const drive = buildGhostDrive(straightGhost(0, []), kmp, heights);
  const air = airFrames(drive);
  // Rising at about a fifth of its speed, at around 50 units a frame, and falling at 1.3 a frame each frame.
  expect(air).toBeGreaterThan(20);
  expect(air).toBeLessThan(120);
  const top = Math.max(...drive.flight.y);
  expect(top).toBeGreaterThan(600);
  // Grounded again at the end, on the road.
  const pose = ghostPoseAt(drive, drive.total - 1);
  expect(pose.airborne).toBe(false);
  expect(pose.position[1]).toBe(0);
  // Nose up on the ramp.
  const onRamp = drive.flight.y.findIndex((y: number) => y > 300);
  expect(ghostPoseAt(drive, onRamp).rotation[0]).toBeLessThan(-.05);
  // A flat road never leaves the ground.
  const flat = straightTrack(() => ({ y: 0, flag: 0 }));
  expect(airFrames(buildGhostDrive(straightGhost(0, []), flat.kmp, flat.heights))).toBe(0);
  // Nor does a road that holds on to the kart, however it falls away.
  const sticky = straightTrack((z) => ({ y: z > 9000 && z < 12000 ? (z - 9000) / 5 : 0, flag: 0x16 }));
  expect(airFrames(buildGhostDrive(straightGhost(0, []), sticky.kmp, sticky.heights))).toBe(0);
});

test("the kart holds on to the road over a crest, and its height never jumps", () => {
  // Up at 5 degrees and down at 5 degrees: no lip to be thrown from.
  const crest = straightTrack((z) => ({ y: z > 9000 && z < 15000 ? 260 - Math.abs(z - 12000) * .0875 : 0, flag: 0 }));
  expect(airFrames(buildGhostDrive(straightGhost(0, []), crest.kmp, crest.heights))).toBe(0);
  // A road that is suddenly far higher is climbed to, not jumped to.
  const step = straightTrack((z) => ({ y: z > 9000 ? 100 : 0, flag: 0 }));
  const { y } = buildGhostDrive(straightGhost(0, []), step.kmp, step.heights).flight;
  for (let f = 1; f < y.length; f++) expect(Math.abs(y[f] - y[f - 1])).toBeLessThan(110);
});

test("a jump pad throws the kart up as fast as its variant says", () => {
  const pad = (variant: number) => straightTrack((z) => ({ y: 0, flag: z > 9000 && z < 9400 ? 0x08 | (variant << 5) : 0 }));
  const slow = pad(2), fast = pad(4); // 30 and 53 units a frame
  const airOf = (track: any) => airFrames(buildGhostDrive(straightGhost(0, []), track.kmp, track.heights));
  expect(airOf(fast)).toBeGreaterThan(airOf(slow));
  expect(airOf(fast)).toBeGreaterThan(2 * 53 / 1.3 - 5);
});

test("a trick is done in the air, on a surface that allows it, and turns the kart over", () => {
  const pressAt = (frame: number, state = 0x10, last = 3240) => [{ state: 0, frames: frame }, { state, frames: 10 }, { state: 0, frames: last - frame - 10 }];
  const pad = straightTrack((z) => ({ y: 0, flag: z > 9000 && z < 9400 ? 0x08 : 0 }));
  const plain = buildGhostDrive(straightGhost(0, []), pad.kmp, pad.heights);
  const takeoff = plain.flight.air.indexOf(1);
  // Up flips it over, whole, in the air.
  const drive = buildGhostDrive(straightGhost(0, pressAt(takeoff + 1)), pad.kmp, pad.heights);
  const started = drive.tricks.axis.indexOf(1);
  expect(started).toBeGreaterThanOrEqual(takeoff - 2);
  expect(drive.flight.air[started]).toBe(1);
  const last = drive.tricks.axis.lastIndexOf(1);
  expect(Math.abs(drive.tricks.angle[last])).toBeCloseTo(Math.PI * 2, 3);
  expect(ghostPoseAt(drive, started + 10).tricking).toBe(true);
  // Left spins a kart around and rolls a bike over.
  expect(buildGhostDrive(straightGhost(0, pressAt(takeoff + 1, 0x30)), pad.kmp, pad.heights).tricks.axis[started]).toBe(2);
  expect(buildGhostDrive(straightGhost(18, pressAt(takeoff + 1, 0x30)), pad.kmp, pad.heights).tricks.axis[started]).toBe(3);
  // On the flat, a kart does nothing with the press.
  const flat = straightTrack(() => ({ y: 0, flag: 0 }));
  const idle = buildGhostDrive(straightGhost(0, pressAt(800)), flat.kmp, flat.heights);
  expect(idle.tricks.axis.some((axis: number) => axis)).toBe(false);
  expect(idle.tricks.wheelie.some((w: number) => w)).toBe(false);
  // A slope that does not allow tricks launches it, without one.
  const plainRamp = straightTrack((z) => ({ y: z > 9000 && z < 12000 ? (z - 9000) / 5 : 0, flag: 0 }));
  const launched = buildGhostDrive(straightGhost(0, []), plainRamp.kmp, plainRamp.heights).flight.air.indexOf(1);
  expect(buildGhostDrive(straightGhost(0, pressAt(launched + 1)), plainRamp.kmp, plainRamp.heights).tricks.axis.some((axis: number) => axis)).toBe(false);
  // A press where tricks are allowed says it was in the air, though this road would not throw it.
  const trickRoad = straightTrack(() => ({ y: 0, flag: 0x2000 }));
  const thrown = buildGhostDrive(straightGhost(0, pressAt(800)), trickRoad.kmp, trickRoad.heights);
  expect(thrown.flight.air[801]).toBe(1);
  expect(thrown.tricks.axis[802]).toBe(1);
  // But up on a bike there is a wheelie.
  const onBike = buildGhostDrive(straightGhost(18, pressAt(800)), trickRoad.kmp, trickRoad.heights);
  expect(onBike.flight.air[801]).toBe(0);
  expect(onBike.tricks.wheelie[850]).toBe(1);
  // A boost ramp of the first variant gives two rotations.
  const boost = straightTrack((z) => ({ y: z > 9000 && z < 12000 ? (z - 9000) / 5 : 0, flag: 0x07 }));
  const leaves = buildGhostDrive(straightGhost(0, []), boost.kmp, boost.heights).flight.air.indexOf(1);
  const double = buildGhostDrive(straightGhost(0, pressAt(leaves + 1)), boost.kmp, boost.heights);
  expect(Math.abs(double.tricks.angle[double.tricks.axis.lastIndexOf(1)])).toBeCloseTo(Math.PI * 4, 3);
});

test("up on a bike on the ground is a wheelie, ended by the brake", () => {
  const flat = straightTrack(() => ({ y: 0, flag: 0 }));
  const tricks = [{ state: 0, frames: 800 }, { state: 0x10, frames: 10 }, { state: 0, frames: 2430 }];
  const drive = buildGhostDrive(straightGhost(18, tricks), flat.kmp, flat.heights);
  expect(drive.tricks.wheelie[799]).toBe(0);
  expect(drive.tricks.wheelie[850]).toBe(1);
  expect(drive.tricks.wheelie[1100]).toBe(0);
  expect(ghostPoseAt(drive, 850).wheelie).toBe(true);
  expect(ghostPoseAt(drive, 850).rotation[0]).toBeLessThan(-.3);
  // Pressing the brake drops it, with a hop if accelerating too.
  const face = [{ state: 1, frames: 850 }, { state: 3, frames: 20 }, { state: 1, frames: 2370 }];
  const ended = buildGhostDrive(straightGhost(18, tricks, face), flat.kmp, flat.heights);
  expect(ended.tricks.wheelie[860]).toBe(0);
  expect(ghostPoseAt(ended, 855).position[1]).toBeGreaterThan(0);
  // A kart has no wheelie.
  expect(buildGhostDrive(straightGhost(17, tricks), flat.kmp, flat.heights).tricks.wheelie.some((w: number) => w)).toBe(false);
});

test("a trick press moves the kart to the nearest place to take off, keeping the lap's time", () => {
  const ramp = straightTrack((z) => ({ y: z > 9000 && z < 12000 ? (z - 9000) / 5 : 0, flag: 0x2000 }));
  const free = buildGhostDrive(straightGhost(0, []), ramp.kmp, ramp.heights);
  const takeoff = free.flight.air.indexOf(1);
  // Pressed 40 frames after where this ghost would have reached the ramp's end.
  const frame = takeoff + 40;
  const tricks = [{ state: 0, frames: frame }, { state: 0x10, frames: 10 }, { state: 0, frames: 3240 - frame - 10 }];
  const drive = buildGhostDrive(straightGhost(0, tricks), ramp.kmp, ramp.heights);
  expect(drive.flight.air[frame + 2]).toBe(1);
  expect(drive.tricks.axis[frame + 5]).toBe(1);
  // The lap still ends on its time.
  const end = 240 + Math.round(50 * FRAMES_PER_SECOND);
  expect(drive.distance[end - 1]).toBeCloseTo(free.distance[end - 1], 0);
  // Far from anywhere, a press moves nothing.
  const far = buildGhostDrive(straightGhost(0, [{ state: 0, frames: 2000 }, { state: 0x10, frames: 10 }, { state: 0, frames: 1230 }]), ramp.kmp, ramp.heights);
  expect(far.distance[2000]).toBeCloseTo(free.distance[2000], 3);
});

test("on the game's tracks, staff ghosts jump and do tricks where they can, and the height never jumps", () => {
  if (!game) return;
  const stem = (name: string) => Object.entries(TRACK_NAMES).find(([, track]) => track === name)![0];
  const results = new Map<string, { air: number; tricks: number }>();
  for (const name of readdirSync(join(game, "Race", "TimeAttack", "ghost1")).filter((file) => file.endsWith(".rkg"))) {
    const ghost = parseRKG(new Uint8Array(readFileSync(join(game, "Race", "TimeAttack", "ghost1", name))));
    const course = COURSE_NAMES[ghost.track];
    const tree = parseU8(yaz0Decompress(new Uint8Array(readFileSync(join(game, "Race", "Course", `${stem(course)}.szs`)))));
    const drive = buildGhostDrive(ghost, parseKMP(findFile(tree, "course.kmp").data), new HeightMap(parseKCL(findFile(tree, "course.kcl").data)));
    let tricks = 0;
    drive.tricks.axis.forEach((axis: number, f: number) => { if (axis && !drive.tricks.axis[f - 1]) tricks++; });
    results.set(course, { air: airFrames(drive) / drive.total, tricks });
    for (let f = 1; f < drive.total; f++) expect(Math.abs(drive.flight.y[f] - drive.flight.y[f - 1])).toBeLessThan(125);
    // Each trick is in the air, for all of its frames.
    drive.tricks.axis.forEach((axis: number, f: number) => { if (axis) expect(drive.flight.air[f]).toBe(1); });
  }
  // Flat roads stay on the ground; none of them is in the air most of the time.
  for (const flat of ["Luigi Circuit", "Moonview Highway", "GCN Peach Beach", "DS Delfino Square"]) expect(results.get(flat)!.air).toBeLessThan(.01);
  for (const { air } of results.values()) expect(air).toBeLessThan(.4);
  // Jump pads and bumps, with real trick presses on them.
  expect(results.get("GBA Shy Guy Beach")!.tricks).toBeGreaterThanOrEqual(4);
  expect(results.get("Moo Moo Meadows")!.tricks).toBeGreaterThanOrEqual(4);
  expect(results.get("Mushroom Gorge")!.air).toBeGreaterThan(.01);
}, 60000); // every track of the game

test("the item button uses up to three mushrooms, each with a boost, and the lap still takes its time", () => {
  const flat = straightTrack(() => ({ y: 0, flag: 0 }));
  const press = (...frames: number[]) => {
    const face: any[] = [];
    let at = 0;
    for (const frame of frames) { face.push({ state: 1, frames: frame - at }, { state: 5, frames: 5 }); at = frame + 5; }
    face.push({ state: 1, frames: 3240 - at });
    return buildGhostDrive(straightGhost(0, [], face), flat.kmp, flat.heights);
  };
  const plain = buildGhostDrive(straightGhost(0, []), flat.kmp, flat.heights);
  expect(ghostPoseAt(plain, 1000).mushrooms).toBe(3);
  expect(plain.boost.every((b: number) => b === 0)).toBe(true);
  const one = press(1000);
  expect(ghostPoseAt(one, 999).boost).toBe(0);
  expect(ghostPoseAt(one, 1040).boost).toBe(1);
  expect(ghostPoseAt(one, 1040).mushrooms).toBe(2);
  expect(ghostPoseAt(one, 1089).boost).toBeGreaterThan(0);
  expect(ghostPoseAt(one, 1090).boost).toBe(0);
  // It goes faster during the boost, and still reaches the line on the lap's time.
  const stretch = (drive: any, from: number, to: number) => drive.distance[to] - drive.distance[from];
  expect(stretch(one, 1020, 1060)).toBeGreaterThan(stretch(plain, 1020, 1060) * 1.2);
  const end = 240 + Math.round(50 * FRAMES_PER_SECOND);
  expect(one.distance[end - 1]).toBeCloseTo(plain.distance[end - 1], 0);
  // A fourth press does nothing, and during the countdown none count.
  const four = press(1000, 1200, 1400, 1600);
  expect(ghostPoseAt(four, 1650).boost).toBe(0);
  expect(ghostPoseAt(four, 1650).mushrooms).toBe(0);
  const early = press(100);
  expect(ghostPoseAt(early, 120).boost).toBe(0);
  expect(ghostPoseAt(early, 300).mushrooms).toBe(3);
  // Used during a boost, it lasts on from the second press.
  const again = press(1000, 1060);
  expect(ghostPoseAt(again, 1140).boost).toBeGreaterThan(0);
  expect(ghostPoseAt(again, 1150).boost).toBe(0);
  // The view behind widens with it.
  expect(ghostCamera(ghostPoseAt(one, 1040), "chase").fov).toBeGreaterThan(ghostCamera(ghostPoseAt(one, 999), "chase").fov);
});

test("two ghosts are compared lap by lap and input by input", () => {
  const t = (minutes: number, seconds: number, milliseconds: number) => ({ minutes, seconds, milliseconds });
  const ghost = (face: any[], direction: any[], splits: any[], time: any, extra = {}): any => ({ track: 0, vehicle: 1, character: 0, laps: 3, time, splits: [...splits, t(0, 0, 0), t(0, 0, 0)], inputs: { face, direction, tricks: [] }, ...extra });
  const frames = 1000;
  const a = ghost([{ state: 1, frames }], [{ state: 0x77, frames }], [t(0, 30, 0), t(0, 29, 500), t(0, 29, 0)], t(1, 28, 500));
  const b = ghost([{ state: 1, frames: 500 }, { state: 3, frames: 100 }, { state: 1, frames: 400 }], [{ state: 0x77, frames: 700 }, { state: 0xE7, frames: 300 }], [t(0, 29, 750), t(0, 29, 750), t(0, 28, 900)], t(1, 28, 400));
  const result = compareGhosts(a, b);
  expect(result.sameTrack).toBe(true);
  expect(result.total.difference).toBe(-100);
  expect(result.laps.map((lap: any) => lap.difference)).toEqual([-250, 250, -100]);
  expect(result.laps.map((lap: any) => lap.running)).toEqual([-250, 0, -100]);
  // First at the brake, then the steering: two stretches.
  expect(result.firstDifference).toBe(500);
  expect(result.firstDifferenceSeconds).toBeCloseTo(260 / FRAMES_PER_SECOND, 5);
  expect(result.spans).toEqual([{ from: 500, to: 599 }, { from: 700, to: 999 }]);
  expect(result.differingShare).toBeCloseTo(400 / 760, 5);
  expect(result.sameInputs).toBe(false);
  expect(result.driving.b.hops).toBe(1);
  expect(result.driving.a.acceleratingShare).toBe(1);
  expect(result.driving.b.steeringShare).toBeCloseTo(300 / 760, 5);
  // Itself: nothing differs.
  const same = compareGhosts(a, a);
  expect(same.sameInputs).toBe(true);
  expect(same.spans).toEqual([]);
  expect(same.total.difference).toBe(0);
  expect(same.firstDifferenceSeconds).toBeNull();
  // Other tracks and fewer laps are said, not hidden.
  const short = ghost([{ state: 1, frames }], [{ state: 0x77, frames }], [t(0, 30, 0)], t(0, 30, 0), { track: 3, laps: 1 });
  const uneven = compareGhosts(a, short);
  expect(uneven.sameTrack).toBe(false);
  expect(uneven.laps[1]).toEqual({ lap: 2, a: 29500, b: null, difference: null, running: null });
  expect(differenceText(-100)).toBe("-0.100");
  expect(differenceText(1250)).toBe("+1.250");
  expect(differenceText(0)).toBe("0.000");
  expect(differenceText(61500)).toBe("+1:01.500");
  expect(differenceText(null)).toBe("–");
});

test("holding the stick through a bend follows it, and the road's edges hold the kart", () => {
  // A wide circle, driven to the right of the way it goes.
  const circle = Array.from({ length: 48 }, (_, i) => {
    const t = i / 48 * Math.PI * 2;
    return { pos: [Math.cos(t) * 6000, 0, -Math.sin(t) * 6000], width: 30 };
  });
  const kmp = { KTPT: [{ pos: circle[0].pos }], ENPT: [{ points: circle, next: [0] }] };
  const frames = 3240;
  const t = (seconds: number) => ({ minutes: 0, seconds, milliseconds: 0 });
  const run = (state: number, heights: any = null) => buildGhostDrive({ vehicle: 0, laps: 1, time: t(50), splits: [t(50), t(0), t(0), t(0), t(0)], inputs: { face: [{ state: 1, frames }], direction: [{ state, frames }], tricks: [] } } as any, kmp, heights);
  const sideAt = (drive: any, f: number) => {
    const pose = ghostPoseAt(drive, f);
    return Math.hypot(pose.position[0], pose.position[2]) - 6000;
  };
  const kcl = { flags: [0], verts: new Float32Array(9), count: 1 };
  const openRoad = { kcl, surfacesAt: () => [{ y: 0, tri: 0 }] };
  // Which way this circle bends, from the stick that stays closest to its line.
  const away = (state: number) => { let sum = 0, n = 0; const drive = run(state, openRoad); for (let f = 400; f < 3000; f += 50) { sum += Math.abs(sideAt(drive, f)); n++; } return sum / n; };
  const states = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map((x) => (x << 4) | 7);
  const distances = states.map(away), best = Math.min(...distances);
  // The stick the bend needs keeps the kart on its line; a stick far from it moves it, but moderately.
  expect(best).toBeLessThan(60);
  expect(distances.indexOf(best)).not.toBe(7); // not the straight stick: this is a bend
  expect(Math.max(...distances)).toBeGreaterThan(best + 100);
  expect(Math.max(...distances)).toBeLessThan(600);
  // Road only 500 wide about the line: the kart stays on it however it steers.
  const narrow = { kcl, surfacesAt: (x: number, z: number) => Math.abs(Math.hypot(x, z) - 6000) <= 250 ? [{ y: 0, tri: 0 }] : [] };
  for (const state of [(14 << 4) | 7, 7]) { const drive = run(state, narrow); for (let f = 300; f < 3000; f += 25) expect(Math.abs(sideAt(drive, f))).toBeLessThan(260); }
  // A road the line runs beside: the kart is moved over onto it.
  const beside = { kcl, surfacesAt: (x: number, z: number) => Math.abs(Math.hypot(x, z) - 6800) <= 300 ? [{ y: 0, tri: 0 }] : [] };
  const moved = run(0x77, beside);
  for (let f = 400; f < 3000; f += 50) expect(Math.abs(sideAt(moved, f) - 800)).toBeLessThan(310);
});

test("the kart stands on the ground under a route that runs high above it", () => {
  const points = [0, 8000, 16000].map((z, i) => ({ uid: i, pos: [0, 1500, z], width: 20 }));
  const back = [16000, 8000, 0].map((z, i) => ({ uid: 10 + i, pos: [9000, 1500, z], width: 20 }));
  const kmp = { KTPT: [{ pos: [0, 1500, 0] }], ENPT: [{ points: [...points, ...back], next: [0] }] };
  const t = (seconds: number) => ({ minutes: 0, seconds, milliseconds: 0 });
  const heights = { kcl: { flags: [0], verts: new Float32Array(9), count: 1 }, surfacesAt: () => [{ y: 0, tri: 0 }] };
  const drive = buildGhostDrive({ vehicle: 0, laps: 1, time: t(30), splits: [t(30), t(0), t(0), t(0), t(0)], inputs: { face: [{ state: 1, frames: 2040 }], direction: [{ state: 0x77, frames: 2040 }], tricks: [] } } as any, kmp, heights);
  for (let f = 0; f < 2000; f += 100) expect(ghostPoseAt(drive, f).position[1]).toBeCloseTo(0, 0);
});

test("on the game's tracks the kart stays on the road almost always", () => {
  if (!game) return;
  const stem = (name: string) => Object.entries(TRACK_NAMES).find(([, track]) => track === name)![0];
  let frames = 0, offRoad = 0, misplaced = 0;
  for (const name of readdirSync(join(game, "Race", "TimeAttack", "ghost1")).filter((file) => file.endsWith(".rkg"))) {
    const ghost = parseRKG(new Uint8Array(readFileSync(join(game, "Race", "TimeAttack", "ghost1", name))));
    const tree = parseU8(yaz0Decompress(new Uint8Array(readFileSync(join(game, "Race", "Course", `${stem(COURSE_NAMES[ghost.track])}.szs`)))));
    const kcl = parseKCL(findFile(tree, "course.kcl").data), heights = new HeightMap(kcl);
    const drive = buildGhostDrive(ghost, parseKMP(findFile(tree, "course.kmp").data), heights);
    for (let f = COUNTDOWN_FRAMES; f < drive.total; f++) {
      const pose = ghostPoseAt(drive, f);
      frames++;
      if (pose.airborne) continue;
      const [x, y, z] = pose.position;
      const under = heights.surfacesAt(x, z, true).filter((s: any) => s.y <= y + 200 && s.y >= y - 400).sort((a: any, b: any) => b.y - a.y)[0];
      if (under) { if ([2, 3, 4, 0x0A, 0x10].includes(kcl.flags[under.tri] & 31)) offRoad++; continue; }
      // Nothing near under it: flying through a cannon's shot is right, floating over a road or under one is not.
      if (heights.surfacesAt(x, z, true).some((s: any) => Math.abs(s.y - y) <= 2500)) misplaced++;
    }
  }
  expect(offRoad / frames).toBeLessThan(.004);
  expect(misplaced / frames).toBeLessThan(.008);
}, 60000); // every track of the game

test("the open track is checked against the ghost's", () => {
  const t = (minutes: number, seconds: number) => ({ minutes, seconds, milliseconds: 0 });
  const ghost: any = { track: 8, laps: 3, time: t(1, 30) };
  const names = { beginner_course: "Luigi Circuit", farm_course: "Moo Moo Meadows" };
  const courses = Array.from({ length: 32 }, (_, i) => i === 8 ? "Luigi Circuit" : i === 1 ? "Moo Moo Meadows" : `Track ${i}`);
  const check = (options: any) => ghostTrackCheck(ghost, { trackNames: names, courseNames: courses, ...options });
  // Its own: fine, and known to be so. Also as the multiplayer file, and from a full path.
  for (const fileName of ["beginner_course.szs", "beginner_course_d.szs", "C:\\game\\Race\\Course\\beginner_course.szs"]) {
    const own = check({ fileName, laps: 3, routeLength: 150000 });
    expect(own.ok).toBe(true);
    expect(own.sure).toBe(true);
  }
  // Another of the game's tracks: said plainly.
  const other = check({ fileName: "farm_course.szs", laps: 3, routeLength: 150000 });
  expect(other.ok).toBe(false);
  expect(other.problems[0]).toEqual({ level: "wrong", text: "This ghost was driven on Luigi Circuit, but this is Moo Moo Meadows." });
  // A custom file: only signs. Fine when they fit, said when they do not.
  expect(check({ fileName: "my_track.szs", laps: 3, routeLength: 150000 }).ok).toBe(true);
  expect(check({ fileName: "my_track.szs", laps: 3, routeLength: 150000 }).sure).toBe(false);
  expect(check({ fileName: "my_track.szs", laps: 5, routeLength: 150000 }).problems.map((p: any) => p.level)).toEqual(["unlikely"]);
  expect(check({ fileName: "my_track.szs", laps: 3, routeLength: 20000 }).problems[0].text).toContain("too long");
  expect(check({ fileName: "my_track.szs", laps: 3, routeLength: 900000 }).problems[0].text).toContain("too short");
});

test("every track of the game opens as its own, and each staff ghost is right on it", () => {
  if (!game) return;
  for (const [id, name] of COURSE_NAMES.entries()) {
    const stem = Object.entries(TRACK_NAMES).find(([, track]) => track === name)?.[0];
    expect(`${id} ${stem}`).not.toBe(`${id} undefined`);
    expect(existsSync(join(game, "Race", "Course", `${stem}.szs`))).toBe(true);
  }
  for (const folder of ["ghost1", "ghost2"]) for (const file of readdirSync(join(game, "Race", "TimeAttack", folder)).filter((name) => name.endsWith(".rkg"))) {
    const ghost = parseRKG(new Uint8Array(readFileSync(join(game, "Race", "TimeAttack", folder, file))));
    const stem = Object.entries(TRACK_NAMES).find(([, track]) => track === COURSE_NAMES[ghost.track])![0];
    const kmp = parseKMP(findFile(parseU8(yaz0Decompress(new Uint8Array(readFileSync(join(game, "Race", "Course", `${stem}.szs`))))), "course.kmp").data);
    const drive = buildGhostDrive(ghost, kmp);
    const result = ghostTrackCheck(ghost, { fileName: `${stem}.szs`, laps: kmp.STGI[0].laps, routeLength: drive.route.length, trackNames: TRACK_NAMES, courseNames: COURSE_NAMES });
    expect(`${folder}/${file}: ${result.problems.map((p: any) => p.text).join(" ")}`).toBe(`${folder}/${file}: `);
  }
}, 60000);

test("recording points at the next thing to do, in the order of playing", () => {
  const status = { dolphin: true, game: "RMCP01", stage: -1, captured: [] as any[] };
  const stateOf = (result: any, id: string) => result.steps.find((step: any) => step.id === id).state;
  const textOf = (result: any, id: string) => result.steps.find((step: any) => step.id === id).text;
  // Before any answer, and with Dolphin closed: open the game.
  expect(recordSteps(null).current).toBe("game");
  expect(textOf(recordSteps({ ...status, dolphin: false, game: null, stage: null }), "game")).toContain("not open");
  expect(textOf(recordSteps({ ...status, game: null, stage: null }), "game")).toContain("Start Mario Kart Wii");
  // Another game is not this one, whatever its race state would read as.
  const other = recordSteps({ ...status, game: "RSBP01", stage: 2 });
  expect(other.current).toBe("game");
  expect(other.recording).toBe(false);
  expect(textOf(other, "game")).toContain("RSBP01");
  // Then through the race, with what is behind done and what is ahead waiting.
  const menu = recordSteps(status);
  expect(menu.current).toBe("race");
  expect(stateOf(menu, "game")).toBe("done");
  expect(stateOf(menu, "save")).toBe("waiting");
  const ready = recordSteps({ ...status, stage: 1 });
  expect(ready.current).toBe("drive");
  expect(ready.recording).toBe(false);
  const racing = recordSteps({ ...status, stage: 2 });
  expect(racing.recording).toBe(true);
  expect(stateOf(racing, "race")).toBe("done");
  expect(recordSteps({ ...status, stage: 3 }).current).toBe("save");
  // Saved: done, in the menu too, and every step behind it is done.
  const saved = recordSteps({ ...status, stage: 3, captured: [{}] });
  expect(saved.current).toBe("done");
  expect(saved.steps.every((step: any) => step.state === "done")).toBe(true);
  expect(recordSteps({ ...status, stage: -1, captured: [{}] }).current).toBe("done");
  // Another race starts the steps again, and the earlier ghost does not count for it.
  expect(recordSteps({ ...status, stage: 2, captured: [{}] }, 1).current).toBe("drive");
  expect(recordSteps({ ...status, stage: 3, captured: [{}] }, 1).current).toBe("save");
  expect(recordSteps({ ...status, stage: 3, captured: [{}, {}] }, 1).current).toBe("done");
  // A run the game did not keep, read from memory: done at once, and said how.
  const fromMemory = recordSteps({ ...status, stage: 4, captured: [{ source: "memory", kept: false }] });
  expect(fromMemory.current).toBe("done");
  expect(textOf(fromMemory, "done")).toContain("did not keep this run");
  expect(textOf(fromMemory, "done")).toContain("(beta)");
  expect(textOf(recordSteps({ ...status, stage: 4, captured: [{ source: "memory", kept: true }] }), "done")).not.toContain("did not keep");
  // A save after the race without a new ghost: said so, at that step, only for this race.
  const finished = Date.now() - 1000;
  const notKept = recordSteps({ ...status, stage: 3, savedWithoutGhost: finished + 500 }, 0, finished);
  expect(notKept.current).toBe("save");
  expect(notKept.notKept).toBe(true);
  expect(textOf(notKept, "save")).toContain("without a new ghost");
  expect(recordSteps({ ...status, stage: 3, savedWithoutGhost: finished - 5000 }, 0, finished).notKept).toBe(false);
  expect(textOf(recordSteps({ ...status, stage: 3 }), "save")).toContain("Nothing to press");
  // A race state that cannot be read does not hold it back: it says what to do, and a save still ends it.
  const unreadable = recordSteps({ ...status, stage: null });
  expect(unreadable.current).toBe("race");
  expect(textOf(unreadable, "race")).toContain("still appears");
  expect(recordSteps({ ...status, stage: null, captured: [{}] }).current).toBe("done");
});

test("the 3D path follows the route, is at each lap line on the ghost's lap times, and stays on the road", () => {
  // A square route of 4000 a side, driven in order, with a wide road.
  const at = (x: number, z: number) => ({ pos: [x, 100, z], width: 20 });
  const kmp = { KTPT: [{ pos: [0, 100, 0] }], ENPT: [{ points: [at(0, 0), at(4000, 0), at(4000, 4000), at(0, 4000)], next: [0] }] };
  const t = (seconds: number) => ({ minutes: 0, seconds, milliseconds: 0 });
  const ghost: any = {
    laps: 2, time: t(40), splits: [t(10), t(30), t(0), t(0), t(0)],
    inputs: { face: [{ state: 1, frames: 240 + Math.round(40 * FRAMES_PER_SECOND) }], direction: [{ state: 0x77, frames: 240 + Math.round(40 * FRAMES_PER_SECOND) }], tricks: [] },
  };
  const drive = buildGhostDrive(ghost, kmp);
  const frame = (seconds: number) => COUNTDOWN_FRAMES + seconds * FRAMES_PER_SECOND;
  const near = (a: number[], b: number[], tolerance: number) => expect(Math.hypot(a[0] - b[0], a[2] - b[2])).toBeLessThan(tolerance);
  // Still during the countdown, at the start.
  near(ghostPoseAt(drive, 0).position, [0, 100, 0], 1);
  near(ghostPoseAt(drive, COUNTDOWN_FRAMES - 1).position, [0, 100, 0], 1);
  // At each lap line on the ghost's own times, though the laps last differently.
  near(ghostPoseAt(drive, frame(10) - 1).position, [0, 100, 0], 200);
  near(ghostPoseAt(drive, frame(40) - 2).position, [0, 100, 0], 200);
  expect(drive.distance[Math.round(frame(10)) - 1]).toBeCloseTo(16000, -3);
  // Halfway round the slow second lap at the halfway time: the far corner.
  near(ghostPoseAt(drive, frame(25)).position, [4000, 100, 4000], 500);
  // Faces the way it goes. Heading 0 is +z, as the game's objects.
  const pose = ghostPoseAt(drive, frame(1));
  expect(pose.forward[0]).toBeCloseTo(1, 1);
  expect(Math.abs(pose.yaw - Math.PI / 2)).toBeLessThan(.2);
  // The stick moves it across, to the right of the way it goes, and never off the road.
  const steering: any = { ...ghost, inputs: { ...ghost.inputs, direction: [{ state: 0xE7, frames: ghost.inputs.face[0].frames }] } };
  const side = ghostPoseAt(buildGhostDrive(steering, kmp), frame(1));
  expect(side.position[2]).toBeGreaterThan(0);
  expect(side.position[2]).toBeLessThanOrEqual(2000 * .75 + 1);
  expect(side.lean).toBe(1);
  // Accelerating covers more of the lap in the same time than coasting does.
  const half = Math.round(frame(20));
  const mixed: any = { ...ghost, inputs: { ...ghost.inputs, face: [{ state: 0, frames: half }, { state: 1, frames: ghost.inputs.face[0].frames - half }] } };
  const paced = buildGhostDrive(mixed, kmp);
  expect(paced.distance[Math.round(frame(25))] - 16000).toBeLessThan(8000);
  // The ground decides the height where it is near the route's.
  const onGround = (y: number) => ({ surfacesAt: () => [{ y, tri: 0 }], kcl: { flags: [0] } });
  expect(ghostPoseAt(buildGhostDrive(ghost, kmp, onGround(150)), frame(1)).position[1]).toBe(150);
  expect(ghostPoseAt(buildGhostDrive(ghost, kmp, onGround(90000)), frame(1)).position[1]).toBe(100);
  // A track without a route cannot show one.
  expect(() => buildGhostDrive(ghost, { KTPT: [], ENPT: [] })).toThrow();
  // Each view looks at the kart.
  for (const view of ["chase", "side", "above"]) expect(Math.hypot(...ghostCamera(pose, view).position.map((v: number, i: number) => v - pose.position[i]))).toBeGreaterThan(300);
});

test("trick entries keep their long durations through the state byte", () => {
  const list = { face: [], direction: [], tricks: [{ state: 0x20, frames: 0x123 }] };
  const bytes = encodeInputs(list);
  expect([...bytes.slice(8)]).toEqual([0x21, 0x23]);
  expect(parseInputs(bytes)).toEqual(list);
});

test.skipIf(!game || !existsSync(join(game || "", "Race", "TimeAttack")))("every staff ghost of the game reads, and rebuilds with the same content", async () => {
  let count = 0;
  for (const folder of ["ghost1", "ghost2"]) for (const name of readdirSync(join(game!, "Race", "TimeAttack", folder)).filter((file) => file.endsWith(".rkg"))) {
    const data = new Uint8Array(await readFile(join(game!, "Race", "TimeAttack", folder, name)));
    const ghost = parseRKG(data);
    expect(`${name}: ${ghost.crcValid}`).toBe(`${name}: true`);
    expect(ghost.compressed).toBe(true);
    expect(ghost.track).toBeLessThan(32);
    expect(ghost.character).toBeLessThan(48);
    // All three sections last as long as the race, give or take the frames before the start.
    const seconds = ghost.time.minutes * 60 + ghost.time.seconds;
    expect(Math.abs(inputFrames(ghost.inputs.face) / 59.94 - seconds)).toBeLessThan(12);
    // The inputs end at the finish: the countdown is all the difference, within a frame or so.
    const finish = ghost.time.minutes * 60 + ghost.time.seconds + ghost.time.milliseconds / 1000;
    expect(Math.abs(inputFrames(ghost.inputs.face) - COUNTDOWN_FRAMES - finish * FRAMES_PER_SECOND)).toBeLessThan(2);
    expect(ghostClock(ghost, inputFrames(ghost.inputs.face)).finished).toBe(true);
    const again = parseRKG(buildRKG(ghost));
    expect(again.crcValid).toBe(true);
    expect(again.inputs).toEqual(ghost.inputs);
    expect(again.header.slice(0x10)).toEqual(ghost.header.slice(0x10));
    count++;
  }
  expect(count).toBe(64);
});

test.skipIf(!existsSync(realSave))("ghosts come out of a real save with the checksums of the format", async () => {
  const data = new Uint8Array(await readFile(realSave));
  expect(saveComplete(data)).toBe(true);
  const ghosts = saveGhosts(data);
  expect(ghosts.length).toBeGreaterThan(0);
  for (const entry of ghosts) {
    const ghost = parseRKG(saveGhostBytes(data, entry));
    expect(`${entry.key}: ${ghost.crcValid}`).toBe(`${entry.key}: true`);
    expect(ghost.compressed).toBe(false);
    const file = parseRKG(buildRKG(ghost, { compressed: true }));
    expect(file.compressed).toBe(true);
    expect(file.crcValid).toBe(true);
    expect(file.inputs).toEqual(ghost.inputs);
  }
});

// A save with a valid checksum, holding the handmade ghost in license 0's slot 2 when asked.
function fakeSave(slotTime: number | null) {
  const data = new Uint8Array(0x2BC000);
  data.set([0x52, 0x4B, 0x53, 0x44], 0);
  data.set([0x52, 0x4B, 0x50, 0x44], 8);
  if (slotTime !== null) {
    const { header, inputs } = handmade();
    header[6] = slotTime;
    const raw = new Uint8Array(0x2800), body = encodeInputs(inputs);
    raw.set(header); raw.set(body, 0x88);
    raw[0x0E] = body.length >> 8; raw[0x0F] = body.length & 255;
    const crc = crc32(raw.subarray(0, 0x27FC));
    raw.set([crc >>> 24, (crc >>> 16) & 255, (crc >>> 8) & 255, crc & 255], 0x27FC);
    data.set(raw, 0x28000 + 2 * 0x2800);
    data[8 + 7] = 1 << 2; // license 0, personal best flags: slot 2
  }
  const crc = crc32(data.subarray(0, 0x27FFC));
  data.set([crc >>> 24, (crc >>> 16) & 255, (crc >>> 8) & 255, crc & 255], 0x27FFC);
  return data;
}

test("watching the save finds a new ghost once, and waits while it is being written", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mkwii-capture-"));
  try {
    mkdirSync(join(dir, "data"));
    const path = join(dir, "data", "rksys.dat");
    writeFileSync(path, fakeSave(null));
    const capture = new GhostCapture(() => [{ path, region: "PAL" }], () => ({ dolphin: true, game: "RMCP01", stage: -1 }));
    expect(capture.status().captured).toEqual([]);
    capture.start();
    expect(capture.status().captured).toEqual([]);
    // Half written: the checksum does not match yet.
    const partial = fakeSave(0x9E);
    partial[0x27FFC] ^= 0xFF;
    writeFileSync(path, partial);
    await Bun.sleep(20);
    expect(capture.status().captured).toEqual([]);
    writeFileSync(path, fakeSave(0x9E));
    await Bun.sleep(20);
    const found = capture.status().captured;
    expect(found.length).toBe(1);
    expect(found[0]).toMatchObject({ key: "0/personal/2", time: "1:29.670", track: 8, miiName: "Ghosty", region: "PAL" });
    // Saved again unchanged: not a new ghost. A better time in the same slot is.
    writeFileSync(path, fakeSave(0x9E));
    await Bun.sleep(20);
    expect(capture.status().captured.length).toBe(1);
    writeFileSync(path, fakeSave(0x10));
    await Bun.sleep(20);
    expect(capture.status().captured.length).toBe(2);
    expect(capture.stop().watching).toBe(false);
  } finally {
    if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe test folder");
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a ghost saved by the game joins the recorded ghosts as a file of its own", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mkwii-library-"));
  try {
    mkdirSync(join(dir, "data"));
    const path = join(dir, "data", "rksys.dat"), library = join(dir, "recorded");
    writeFileSync(path, fakeSave(null));
    const capture = new GhostCapture(() => [{ path, region: "PAL" }], () => ({ dolphin: true, game: "RMCP01", stage: -1 }), () => library);
    expect(listRecordedGhosts(library)).toEqual([]);
    capture.start();
    writeFileSync(path, fakeSave(0x9E));
    await Bun.sleep(20);
    capture.status();
    const listed = listRecordedGhosts(library);
    expect(listed.length).toBe(1);
    expect(listed[0]).toMatchObject({ name: "Luigi Circuit 1-29-670.rkg", time: "1:29.670", track: 8 });
    // A complete file, compressed as the game's own ghosts are, that outlives the save.
    const file = parseRKG(new Uint8Array(readFileSync(listed[0].path)));
    expect(file).toMatchObject({ compressed: true, crcValid: true, miiName: "Ghosty" });
    writeFileSync(path, fakeSave(null));
    await Bun.sleep(20);
    const after = capture.status();
    expect(listRecordedGhosts(library).length).toBe(1);
    // The game wrote its save, and there was no new ghost in it: that is known, with when.
    expect(after.savedWithoutGhost).toBeGreaterThan(Date.now() - 5000);
    expect(after.captured.length).toBe(1);
    // The same time again gets its own name, not an overwrite.
    expect(saveRecordedGhost(library, saveGhostBytes(fakeSave(0x9E), saveGhosts(fakeSave(0x9E))[0]))).toContain("(2).rkg");
    expect(listRecordedGhosts(library).length).toBe(2);
    // Deleting only touches that folder.
    const outside = join(dir, "data", "outside.rkg");
    writeFileSync(outside, "x");
    expect(() => deleteRecordedGhost(library, outside)).toThrow();
    expect(existsSync(outside)).toBe(true);
    expect(() => deleteRecordedGhost(library, join(library, "..", "data", "rksys.dat"))).toThrow();
    deleteRecordedGhost(library, listed[0].path);
    expect(listRecordedGhosts(library).length).toBe(1);
  } finally {
    if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe test folder");
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a run the game does not keep is read from memory as the race ends, and one it keeps is not doubled", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mkwii-memory-"));
  try {
    mkdirSync(join(dir, "data"));
    const path = join(dir, "data", "rksys.dat"), library = join(dir, "recorded");
    writeFileSync(path, fakeSave(null));
    const run = (time: number) => saveGhostBytes(fakeSave(time), saveGhosts(fakeSave(time))[0]);
    let stage = -1, inMemory: Uint8Array | null = null, reads = 0;
    const capture = new GhostCapture(() => [{ path, region: "PAL" }], () => ({ dolphin: true, game: "RMCP01", stage }), () => library,
      () => { reads++; return inMemory ? { bytes: buildRKG(parseRKG(inMemory), { compressed: true }), automatic: false } : null; });
    capture.start();
    // Racing: nothing to read yet.
    stage = 2; inMemory = run(0x9E);
    expect(capture.status().captured).toEqual([]);
    expect(reads).toBe(0);
    // Finished: read once, and it joins the recorded ghosts although the save has nothing new.
    stage = 4;
    const found = capture.status().captured;
    expect(found.length).toBe(1);
    expect(found[0]).toMatchObject({ source: "memory", kept: false, time: "1:29.670", track: 8, miiName: "Ghosty" });
    expect((found[0] as any).run).toBeUndefined();
    expect(listRecordedGhosts(library).length).toBe(1);
    capture.status(); capture.status();
    expect(reads).toBe(1);
    // The game then keeps the same run: the same ghost, now kept, not a second file.
    writeFileSync(path, fakeSave(0x9E));
    await Bun.sleep(20);
    const kept = capture.status().captured;
    expect(kept.length).toBe(1);
    expect(kept[0]).toMatchObject({ source: "memory", kept: true, key: "0/personal/2" });
    expect(listRecordedGhosts(library).length).toBe(1);
    // Another race: read again once it ends. Memory not readable yet is tried on the next look.
    stage = 2; capture.status();
    stage = 4; inMemory = null;
    expect(capture.status().captured.length).toBe(1);
    inMemory = run(0x10);
    expect(capture.status().captured.length).toBe(2);
    expect(listRecordedGhosts(library).length).toBe(2);
    // A run the save gave first is not added again from memory.
    writeFileSync(path, fakeSave(0x20));
    await Bun.sleep(20);
    stage = 2; capture.status();
    expect(capture.status().captured.length).toBe(3);
    stage = 4; inMemory = run(0x20);
    expect(capture.status().captured.length).toBe(3);
    expect(listRecordedGhosts(library).length).toBe(3);
  } finally {
    if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe test folder");
    rmSync(dir, { recursive: true, force: true });
  }
});

test.skipIf(!game || !existsSync(join(game || "", "Race", "TimeAttack")))("each position has its two staff ghosts, and a ghost put there takes the position's track and type", async () => {
  for (const [track, name] of [[8, "ghost1_comp_00"], [0, "ghost1_comp_04"]] as const) {
    const slots = trackGhostSlots(game!, track);
    expect(slots.map((slot: any) => slot.ghostType)).toEqual([0x25, 0x26]);
    expect(slots[0].path).toContain(name);
    expect(slots.every((slot: any) => slot.track === track)).toBe(true);
  }
  expect(trackGhostSlots("", 0)).toEqual([]);
  const other = new Uint8Array(readFileSync(trackGhostSlots(game!, 13)[1].path)), before = parseRKG(other);
  const placed = parseRKG(ghostForSlot(other, 8, 0x25));
  expect(placed).toMatchObject({ track: 8, ghostType: 0x25, compressed: true, crcValid: true, miiName: before.miiName });
  expect(placed.inputs).toEqual(before.inputs);
  expect(placed.time).toEqual(before.time);
});

test("the race stage reads only values that make sense", () => {
  const u32 = (v: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v); return b; };
  const memory = (pointer: number, stage: number) => (address: number) => address === 0x809BD730 ? u32(pointer) : address === 0x80A00028 ? u32(stage) : null;
  expect(readRaceStage("RMCP01", memory(0x80A00000, 2))).toBe(2);
  expect(readRaceStage("RMCP01", memory(0, 0))).toBe(-1);
  expect(readRaceStage("RMCP01", memory(0x12345678, 2))).toBeNull();
  expect(readRaceStage("RMCP01", memory(0x80A00000, 99))).toBeNull();
  expect(readRaceStage("RSBE01", memory(0x80A00000, 2))).toBeNull();
});

test.skipIf(process.platform !== "win32")("this process can be found and read through the same system calls", () => {
  const { ptr } = require("bun:ffi") as typeof import("bun:ffi");
  expect(findProcesses((name) => name.startsWith("bun"))).toContain(process.pid);
  const handle = openForReading(process.pid);
  expect(handle).not.toBe(0n);
  const secret = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
  expect([...readMemory(handle, BigInt(ptr(secret)), 8)!]).toEqual([...secret]);
});
