// The path the kart really drove, read from the game's memory while the race runs. A ghost file holds
// only the buttons pressed, and only the game's physics turns them into places on the track: when a
// run is recorded in Dolphin, its kart's place and rotation on each frame are kept beside it, and the
// 3D preview shows that instead of an approximation.
//
// Found on Mario Kart Wii PAL (RMCP01): the first kart's place and rotation, and the race's frame
// counter. That counter starts at 0 with the countdown, as a ghost's buttons do, reaches 240 as the
// race starts and the ghost's last frame at the finish: it is the ghost's own frame. The other regions'
// addresses are the PAL ones carried over with MKW-SP's tables (port.py); what is read is checked, so
// a wrong address records nothing.
import type { Read } from "./race-ghost.ts";
// @ts-ignore Shared Wii format reader used by the frontend.
import { COUNTDOWN_FRAMES } from "../web/js/formats/rkg.js";

// The karts of the race, the race manager and the race settings, per region.
const POINTERS: Record<string, { karts: number; manager: number; config: number }> = {
  P: { karts: 0x809C18F8, manager: 0x809BD730, config: 0x809BD728 },
  E: { karts: 0x809BD110, manager: 0x809B8F70, config: 0x809B8F68 },
  J: { karts: 0x809C0958, manager: 0x809BC790, config: 0x809BC788 },
  K: { karts: 0x809AFF38, manager: 0x809ABD70, config: 0x809ABD68 },
};
// In the race settings, the file of the ghost raced against, as the game loaded it.
const RACED_GHOST = 0x23F0, GHOST_FILE_SIZE = 0x2800;
// A kart of the list (the player's first, then the ghosts'): its parts, the body, what holds its
// physics, and the physics itself.
const KART_LIST = 0x20, KART_COUNT = 0x24, PARTS = 0x00, BODY = 0x08, PHYSICS_HOLDER = 0x90, PHYSICS = 0x04;
// Three floats; and the full rotation, with the tricks' turns, as a quaternion x, y, z, w (forward is
// +Z). As in Kinoko's KartDynamics: the rotation from the physics alone comes just before it.
const POSITION = 0x68, ROTATION = 0x100;
const STAGE = 0x28, FRAME = 0x20;

export type KartSample = { stage: number; frame: number; pose: number[] };

const inMemory = (address: number) => address >= 0x80000000 && address < 0x81800000;

// A kart now, the player's by default, or null when there is no race or memory does not fit one.
export function readKartSample(game: string, read: Read, kart = 0): KartSample | null {
  const where = game.startsWith("RMC") ? POINTERS[game[3]] : null;
  if (!where) return null;
  const view = (address: number, size: number) => {
    if (!inMemory(address) && !(address >= 0x90000000 && address < 0x94000000)) return null;
    const bytes = read(address, size);
    return bytes ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength) : null;
  };
  const u32 = (address: number) => view(address, 4)?.getUint32(0) ?? 0;
  const manager = u32(where.manager);
  if (!inMemory(manager)) return null;
  const race = view(manager, 0x2C);
  if (!race) return null;
  const stage = race.getUint32(STAGE), frame = race.getUint32(FRAME);
  if (stage > 4) return null;
  let at = u32(where.karts);
  if (!inMemory(at) || kart >= (view(at + KART_COUNT, 1)?.getUint8(0) ?? 0)) return null;
  for (const offset of [KART_LIST, kart * 4, PARTS, BODY, PHYSICS_HOLDER, PHYSICS]) {
    if (!inMemory(at)) return null;
    at = u32(at + offset);
  }
  if (!inMemory(at)) return null;
  const physics = view(at + POSITION, ROTATION + 16 - POSITION);
  if (!physics) return null;
  const pose = [0, 4, 8].map((k) => physics.getFloat32(k)).concat([0, 4, 8, 12].map((k) => physics.getFloat32(ROTATION - POSITION + k)));
  if (!pose.every(Number.isFinite) || pose.slice(0, 3).some((v) => Math.abs(v) > 1e6)) return null;
  if (Math.abs(Math.hypot(...pose.slice(3)) - 1) > 0.01) return null;
  // The game went on to its next frame while this was read: what was read may be of two frames.
  if (view(manager + FRAME, 4)?.getUint32(0) !== frame) return null;
  return { stage, frame, pose };
}

// The ghost file the game races against now, as it loaded it, or null when there is none.
export function readRacedGhost(game: string, read: Read): Uint8Array | null {
  const where = game.startsWith("RMC") ? POINTERS[game[3]] : null;
  if (!where) return null;
  const pointer = read(where.config, 4);
  if (!pointer) return null;
  const config = new DataView(pointer.buffer, pointer.byteOffset, 4).getUint32(0);
  if (!((config >= 0x80000000 && config < 0x81800000) || (config >= 0x90000000 && config < 0x94000000))) return null;
  const file = read(config + RACED_GHOST, GHOST_FILE_SIZE);
  return file && file[0] === 0x52 && file[1] === 0x4B && file[2] === 0x47 && file[3] === 0x44 ? file : null;
}

// A path as stored: a row per frame of the ghost, frame then x, y, z, and the rotation x, y, z, w.
export const PATH_ROW = 8;

// Keeps the samples of the race on screen, and turns them into the ghost's frames once it ends.
export class PathRecorder {
  private samples = new Map<number, number[]>();
  private lastFrame = -1;
  private finishedAt = -1;

  add(sample: KartSample | null) {
    if (!sample) return;
    // A new race: the counter starts over.
    if (sample.frame < this.lastFrame) this.clear();
    this.lastFrame = sample.frame;
    if (sample.stage < 1) return;
    // After the finish only a little is kept: the ghost ends there.
    if (sample.stage >= 3 && this.finishedAt < 0) this.finishedAt = sample.frame;
    if (this.finishedAt >= 0 && sample.frame > this.finishedAt + 60) return;
    // Read just as the game began a frame: its counter is on, its kart not yet moved. Such a read is
    // the frame before's place again; a later read of the frame holds the right one.
    const before = this.samples.get(sample.frame - 1);
    if (before && before.every((value, i) => value === sample.pose[i]) && sample.stage === 2) return;
    this.samples.set(sample.frame, sample.pose);
  }

  clear() {
    this.samples.clear();
    this.lastFrame = -1;
    this.finishedAt = -1;
  }

  // The path of a ghost with these many frames, or null when too little of it was seen.
  path(frames: number) {
    const rows: number[][] = [];
    for (const [frame, pose] of this.samples) if (frame <= frames + 2) rows.push([frame, ...pose]);
    rows.sort((a, b) => a[0] - b[0]);
    // The whole race seen, from its start to the finish, with no gap longer than a second.
    if (rows.length < 2 || rows[0][0] > COUNTDOWN_FRAMES || rows[rows.length - 1][0] < frames - 10) return null;
    for (let i = 1; i < rows.length; i++) if (rows[i][0] - rows[i - 1][0] > 60) return null;
    const out = new Float32Array(rows.length * PATH_ROW);
    rows.forEach((row, i) => out.set(row, i * PATH_ROW));
    return out;
  }
}
