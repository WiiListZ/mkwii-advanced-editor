// Picks up the ghosts of Time Trials driven while watching, in two ways. The game writes a run's ghost
// to its save only when it keeps it (a track's personal slot holds its best time): comparing the save
// with how it was at the start finds exactly that ghost, on any region. Every run, kept or not, is
// also read from the game's memory as the race ends (race-ghost.ts); the same run found both ways is
// one ghost. While a race runs, the kart's place on each frame is read too (race-path.ts) and kept
// beside its ghost, for the 3D preview to show where it really drove.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { dolphinDataFolders } from "./dolphin.ts";
import { readCurrentRaceGhost, readGameState, type GameState } from "./dolphin-memory.ts";
import type { RaceGhost } from "./race-ghost.ts";
import { PathRecorder, type KartSample } from "./race-path.ts";
// @ts-ignore Shared Wii format reader used by the frontend.
import { buildRKG, COURSE_NAMES, encodeInputs, inputFrames, isRKG, parseRKG, saveComplete, saveGhostBytes, saveGhosts, timeText } from "../web/js/formats/rkg.js";

const REGIONS: Record<string, string> = { "524d4350": "PAL", "524d4345": "NTSC-U", "524d434a": "NTSC-J", "524d434b": "NTSC-K" };

function nandRoots(env: NodeJS.ProcessEnv = process.env) {
  const roots: string[] = [];
  for (const data of dolphinDataFolders(env)) {
    const ini = join(data, "Config", "Dolphin.ini");
    if (existsSync(ini)) {
      const custom = /^\s*NANDRootPath\s*=\s*(.+?)\s*$/m.exec(readFileSync(ini, "utf8"))?.[1];
      if (custom) roots.push(custom);
    }
    roots.push(join(data, "Wii"));
  }
  return roots;
}

export function findSaves(env: NodeJS.ProcessEnv = process.env) {
  const saves: { path: string; region: string }[] = [];
  for (const root of nandRoots(env)) for (const [title, region] of Object.entries(REGIONS)) {
    const path = join(root, "title", "00010004", title, "data", "rksys.dat");
    if (existsSync(path) && !saves.some((save) => save.path === path)) saves.push({ path, region });
  }
  return saves;
}

const describe = (bytes: Uint8Array) => {
  const ghost = parseRKG(bytes);
  return { time: timeText(ghost.time), track: ghost.track, character: ghost.character, vehicle: ghost.vehicle, miiName: ghost.miiName, compressed: ghost.compressed };
};

export function listSaveGhosts(path: string) {
  const data = new Uint8Array(readFileSync(path));
  return saveGhosts(data).flatMap((entry: any) => {
    try { return [{ ...entry, ...describe(saveGhostBytes(data, entry)) }]; } catch { return []; }
  });
}

export function saveGhostFile(path: string, key: string) {
  const data = new Uint8Array(readFileSync(path));
  const entry = saveGhosts(data).find((ghost: any) => ghost.key === key);
  if (!entry) throw new Error("This ghost is no longer in the save");
  return buildRKG(parseRKG(saveGhostBytes(data, entry)), { compressed: true });
}

// The .rkg files of the game's own folder, staff ghosts in Race/TimeAttack.
export function listGameGhosts(workspace: string) {
  const out: { path: string; folder: string; name: string; time: string; track: number }[] = [];
  const root = join(workspace, "Race", "TimeAttack");
  if (!workspace || !existsSync(root)) return out;
  for (const folder of readdirSync(root)) {
    const dir = join(root, folder);
    if (!statSync(dir).isDirectory()) continue;
    for (const name of readdirSync(dir)) {
      if (!/\.rkg$/i.test(name)) continue;
      try {
        const data = new Uint8Array(readFileSync(join(dir, name)));
        if (isRKG(data)) out.push({ path: join(dir, name), folder, name, ...describe(data) });
      } catch { /* left out: not a ghost that can be read */ }
    }
  }
  return out;
}

// The two ghosts of a position, wherever they are: each file's own header says which track it is for.
export function trackGhostSlots(workspace: string, track: number) {
  return listGameGhosts(workspace).filter((ghost) => ghost.track === track).map((ghost) => {
    const backup = `${ghost.path}.bak`;
    return { ...ghost, ghostType: parseRKG(new Uint8Array(readFileSync(ghost.path))).ghostType, backup: existsSync(backup) ? backup : null };
  }).sort((a, b) => a.ghostType - b.ghostType);
}

// ---- Recorded ghosts: files of their own, whatever happens to the game's save later ------------
export function listRecordedGhosts(folder: string) {
  if (!existsSync(folder)) return [];
  const out: any[] = [];
  for (const name of readdirSync(folder)) {
    if (!/\.rkg$/i.test(name)) continue;
    const path = join(folder, name);
    try {
      const data = new Uint8Array(readFileSync(path));
      if (isRKG(data)) out.push({ path, name, ...describe(data), at: statSync(path).mtimeMs });
    } catch { /* left out: not a ghost that can be read */ }
  }
  return out.sort((a, b) => b.at - a.at);
}

export function saveRecordedGhost(folder: string, saveBytes: Uint8Array) {
  const ghost = parseRKG(saveBytes);
  const safe = (text: string) => text.replace(/[^A-Za-z0-9 '._-]/g, "").trim();
  const stem = `${safe(COURSE_NAMES[ghost.track] ?? `Track ${ghost.track}`)} ${timeText(ghost.time).replace(/[:.]/g, "-")}`;
  mkdirSync(folder, { recursive: true });
  let path = join(folder, `${stem}.rkg`);
  for (let n = 2; existsSync(path); n++) path = join(folder, `${stem} (${n}).rkg`);
  writeFileSync(path, buildRKG(ghost, { compressed: true }));
  return path;
}

export function deleteRecordedGhost(folder: string, path: string) {
  // Only files of that folder: a path from outside must not delete anything.
  if (dirname(resolve(path)) !== resolve(folder)) throw new Error("Not a recorded ghost");
  if (!/\.rkg$/i.test(path)) throw new Error("Not a recorded ghost");
  let bytes: Uint8Array | null = null;
  try { bytes = new Uint8Array(readFileSync(resolve(path))); } catch { /* already gone */ }
  rmSync(resolve(path), { force: true });
  // Its path too, unless another file of the folder is the same run.
  if (bytes && isRKG(bytes) && !listRecordedGhosts(folder).some((other) => { try { return runOf(new Uint8Array(readFileSync(other.path))) === runOf(bytes!); } catch { return false; } })) deleteRecordedPath(folder, bytes);
}

// ---- The paths karts really drove: one file per run, found by its track, time and buttons -----
export const pathFile = (folder: string, bytes: Uint8Array) => join(folder, "paths", `${createHash("sha256").update(runOf(bytes)).digest("hex")}.path`);

export function readRecordedPath(folder: string, ghost: Uint8Array) {
  const path = pathFile(folder, ghost);
  return existsSync(path) ? new Uint8Array(readFileSync(path)) : null;
}

export function deleteRecordedPath(folder: string, ghost: Uint8Array) {
  rmSync(pathFile(folder, ghost), { force: true });
}

// ---- Watching ----------------------------------------------------------------------------------
type Baseline = { stamp: number; ghosts: Map<string, number> };
// source: where it was first found. kept: whether the game has it in its save (key, license, kind
// and slot then say where).
type Captured = { id: string; path: string; region: string; key: string; license: number; kind: string; slot: number; time: string; track: number; character: number; vehicle: number; miiName: string; at: number; file: string | null; source: "save" | "memory"; kept: boolean; run: string };

// The same run, whichever way it was found: its track, time and buttons.
export function runOf(bytes: Uint8Array) {
  const ghost = parseRKG(bytes);
  return `${ghost.track}|${timeText(ghost.time)}|${Buffer.from(encodeInputs(ghost.inputs)).toString("base64")}`;
}

export class GhostCapture {
  watching = false;
  baselines = new Map<string, Baseline>();
  captured: Captured[] = [];
  // When the game last wrote its save while watching without a new ghost in it, in ms.
  savedWithoutGhost = 0;
  startedAt = 0;
  // The stage last seen in a race, so "just finished" can be told from "never raced".
  raced = false;
  // Whether the race on screen has been read from memory; a new race starts over.
  raceRead = false;

  // The kart's place on each frame of the race on screen.
  paths = new PathRecorder();
  private sampling: ReturnType<typeof setTimeout> | null = null;

  constructor(private saves: () => { path: string; region: string }[] = findSaves, private game: () => GameState = readGameState, private library: () => string | null = () => null, private raceGhost: () => RaceGhost | null = readCurrentRaceGhost, private kart: () => KartSample | null = () => null) {}

  // Every frame while a race runs (a frame is about 17 ms), seldom otherwise.
  private sample = () => {
    const now = this.kart();
    this.paths.add(now);
    const racing = !!now && now.stage >= 1 && now.stage <= 3;
    this.sampling = setTimeout(this.sample, racing ? 4 : 250);
    (this.sampling as any).unref?.();
  };

  private snapshot(path: string): Baseline | null {
    const stamp = statSync(path).mtimeMs, data = new Uint8Array(readFileSync(path));
    if (!saveComplete(data)) return null;
    return { stamp, ghosts: new Map(saveGhosts(data).map((ghost: any) => [ghost.key, ghost.crc])) };
  }

  start() {
    this.baselines.clear();
    this.captured = [];
    this.savedWithoutGhost = 0;
    this.raced = false;
    this.raceRead = false;
    this.startedAt = Date.now();
    this.watching = true;
    this.paths.clear();
    if (this.sampling) clearTimeout(this.sampling);
    this.sample();
    for (const { path } of this.saves()) {
      const baseline = this.snapshot(path);
      if (baseline) this.baselines.set(path, baseline);
    }
    return this.status();
  }

  stop() {
    this.watching = false;
    if (this.sampling) clearTimeout(this.sampling);
    this.sampling = null;
    return this.status();
  }

  // A file seen for the first time while watching has nothing to compare with: everything is new.
  private check() {
    for (const { path, region } of this.saves()) {
      const known = this.baselines.get(path);
      if (known && statSync(path).mtimeMs === known.stamp) continue;
      const stamp = statSync(path).mtimeMs, data = new Uint8Array(readFileSync(path));
      if (!saveComplete(data)) continue; // being written: the next look reads it whole
      const before = known?.ghosts || new Map<string, number>(), now = new Map<string, number>();
      const capturedBefore = this.captured.length;
      for (const entry of saveGhosts(data)) {
        now.set(entry.key, entry.crc);
        if (before.get(entry.key) === entry.crc) continue;
        try {
          const bytes = saveGhostBytes(data, entry), run = runOf(bytes);
          const where = { path, region, key: entry.key, license: entry.license, kind: entry.kind, slot: entry.slot };
          // Already read from memory as the race ended: the same ghost, now kept by the game too.
          const read = this.captured.find((ghost) => ghost.run === run && !ghost.kept);
          if (read) { Object.assign(read, where, { kept: true }); continue; }
          const folder = this.library();
          const file = folder ? saveRecordedGhost(folder, bytes) : null;
          this.captured.push({ id: `${path}|${entry.key}|${entry.crc}`, ...where, ...describe(bytes), at: Date.now(), file, source: "save", kept: true, run });
        } catch { /* not a ghost that can be read */ }
      }
      this.baselines.set(path, { stamp, ghosts: now });
      if (known && this.captured.length === capturedBefore) this.savedWithoutGhost = Date.now();
    }
  }

  // The race on screen, once finished: its ghost from memory, once, unless the save already gave it.
  private readRace(state: GameState) {
    if (state.stage === null || state.stage < 0) return;
    if (state.stage < 3) { this.raceRead = false; return; }
    if (this.raceRead) return;
    const ghost = this.raceGhost();
    if (!ghost) return; // tried again on the next look
    this.raceRead = true;
    this.keepPath(ghost.bytes);
    const run = runOf(ghost.bytes);
    if (this.captured.some((captured) => captured.run === run)) return;
    const folder = this.library();
    const file = folder ? saveRecordedGhost(folder, ghost.bytes) : null;
    const at = Date.now();
    this.captured.push({ id: `memory|${at}|${run.length}`, path: "", region: state.game || "", key: "", license: -1, kind: "memory", slot: -1, ...describe(ghost.bytes), at, file, source: "memory", kept: false, run });
  }

  // The kart's path of this run, beside the recorded ghosts, whichever way the ghost itself is found.
  private keepPath(bytes: Uint8Array) {
    const folder = this.library();
    if (!folder) return;
    try {
      const ghost = parseRKG(bytes);
      const path = this.paths.path(Math.max(inputFrames(ghost.inputs.face), inputFrames(ghost.inputs.direction)));
      if (!path) return;
      const file = pathFile(folder, bytes);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, new Uint8Array(path.buffer));
    } catch { /* the ghost is kept all the same */ }
  }

  status() {
    const state = this.game();
    if (this.watching) {
      if (state.stage !== null && state.stage >= 0) this.raced = true;
      this.readRace(state);
      this.check();
    }
    // The runs' buttons stay here: the window only needs what describes each ghost.
    const captured = this.captured.map(({ run, ...ghost }) => ghost);
    return { watching: this.watching, ...state, raced: this.raced, saves: this.saves(), captured, savedWithoutGhost: this.savedWithoutGhost };
  }
}
