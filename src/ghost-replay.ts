// The path any ghost really drives, from the game itself. A ghost file holds only the buttons pressed;
// the game turns them into a path when it races against the ghost. So the ghost is put in place of
// its track's staff ghosts in the extracted game (both files: which one the game offers depends on
// the save), the game is started, and while a Time Trial is
// raced against that staff ghost the ghost's kart is read on every frame (race-path.ts). Once the
// ghost has finished, its path is kept as for a recorded run, and the staff ghost is put back.
//
// The staff ghosts' own files are kept on disk while they are replaced, so that it goes back even when
// the editor was closed in between. Only the race against this very ghost is read: the file the game
// loaded for the race must be the same run.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathFile, runOf, trackGhostSlots } from "./ghost-capture.ts";
import { PathRecorder, type KartSample } from "./race-path.ts";
// @ts-ignore Shared Wii format reader used by the frontend.
import { COURSE_NAMES, ghostForSlot, inputFrames, parseRKG } from "../web/js/formats/rkg.js";

const GHOST_KART = 1; // in a Time Trial against one ghost: the player's kart, then the ghost's
type Slot = { path: string; before: string };
type Job = { slots: Slot[]; run: string; frames: number; track: number; ghost: string };

// The staff ghosts as they were: also from a file left by an older version, with one.
function putBack(job: any) {
  const slots: Slot[] = job.slots || (job.slot ? [{ path: job.slot, before: job.before }] : []);
  for (const slot of slots) if (slot.path && slot.before) writeFileSync(slot.path, Buffer.from(slot.before, "base64"));
}

export type ReplayPhase = "idle" | "waiting" | "other-ghost" | "reading" | "finished-first" | "done" | "failed";

export class GhostReplay {
  private job: Job | null = null;
  private paths = new PathRecorder();
  private sampling: ReturnType<typeof setTimeout> | null = null;
  phase: ReplayPhase = "idle";
  error = "";
  // How far the ghost has got, in frames, in the race being read.
  reached = 0;
  private sameGhost = false;
  private checked = false;
  private lastFrame = -1;

  // every: false leaves the reading to tick(), as tests do.
  constructor(private keep: () => string, private library: () => string | null,
    private kart: (index: number) => KartSample | null = () => null, private raced: () => Uint8Array | null = () => null, private every = true) {}

  // A replacement left by an editor closed while reading: the staff ghost goes back.
  recover() {
    const file = this.keep();
    if (!existsSync(file)) return;
    try {
      putBack(JSON.parse(readFileSync(file, "utf8")));
    } catch { /* nothing that can be put back */ }
    rmSync(file, { force: true });
  }

  start(bytes: Uint8Array, workspace: string) {
    this.stop();
    const ghost = parseRKG(bytes);
    const frames = Math.max(inputFrames(ghost.inputs.face), inputFrames(ghost.inputs.direction));
    const folder = this.library();
    if (!folder) throw new Error("There is no folder for recorded ghosts");
    if (existsSync(pathFile(folder, bytes))) { this.phase = "done"; return this.status(); }
    const slots = trackGhostSlots(workspace, ghost.track);
    if (!slots.length) throw new Error(`The game folder has no staff ghost for ${COURSE_NAMES[ghost.track] ?? "this track"} to race it in its place`);
    this.job = {
      slots: slots.map((slot: any) => ({ path: slot.path, before: Buffer.from(readFileSync(slot.path)).toString("base64") })),
      run: runOf(bytes), frames, track: ghost.track, ghost: Buffer.from(bytes).toString("base64"),
    };
    mkdirSync(dirname(this.keep()), { recursive: true });
    writeFileSync(this.keep(), JSON.stringify(this.job));
    for (const slot of slots) writeFileSync(slot.path, ghostForSlot(bytes, ghost.track, slot.ghostType));
    this.phase = "waiting";
    this.error = "";
    this.reached = 0;
    this.sameGhost = false;
    this.checked = false;
    this.lastFrame = -1;
    this.paths.clear();
    this.sample();
    return this.status();
  }

  // The staff ghosts go back, whatever happened.
  stop() {
    if (this.sampling) clearTimeout(this.sampling);
    this.sampling = null;
    if (this.job) {
      try { putBack(this.job); } catch (e: any) { this.error = `The staff ghosts could not be put back: ${e.message}`; }
      rmSync(this.keep(), { force: true });
    }
    this.job = null;
    if (this.phase !== "done") this.phase = "idle";
    return this.status();
  }

  // Every frame while a race runs (a frame is about 17 ms), seldom otherwise.
  private sample = () => {
    const racing = this.tick();
    if (!this.job || !this.every) return;
    this.sampling = setTimeout(this.sample, racing ? 4 : 250);
    (this.sampling as any).unref?.();
  };

  // One look at the game. Returns whether a race runs.
  tick() {
    const job = this.job;
    if (!job) return false;
    const now = this.kart(GHOST_KART);
    // A new race: its counter starts over. Which ghost it races is looked at again.
    if (now && now.frame < this.lastFrame) { this.checked = false; this.sameGhost = false; }
    if (now) this.lastFrame = now.frame;
    if (now && now.stage >= 1 && now.stage <= 2 && !this.checked) {
      const raced = this.raced();
      if (raced) {
        this.checked = true;
        try { this.sameGhost = runOf(raced) === job.run; } catch { this.sameGhost = false; }
        this.phase = this.sameGhost ? "reading" : "other-ghost";
      }
    }
    if (now && this.sameGhost) {
      this.paths.add(now);
      this.reached = Math.min(now.frame, job.frames);
      if (now.frame >= job.frames + 2) { this.finish(); return false; }
      // The player crossed the line first: the game ended the race before the ghost did.
      if (now.stage >= 3) { this.phase = "finished-first"; this.sameGhost = false; }
    }
    return !!now && now.stage >= 1 && now.stage <= 2;
  }

  private finish() {
    const job = this.job!, folder = this.library();
    const path = this.paths.path(job.frames);
    if (!path || !folder) {
      this.phase = "failed";
      this.error = "Part of the race was not read. Race it again.";
      this.sameGhost = false;
      return;
    }
    const file = pathFile(folder, Buffer.from(job.ghost, "base64"));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, new Uint8Array(path.buffer));
    this.phase = "done";
    this.stop();
  }

  status() {
    return { phase: this.phase, error: this.error, reached: this.reached, frames: this.job?.frames ?? 0, track: this.job?.track ?? null, slots: this.job?.slots.map((slot) => slot.path) ?? [] };
  }
}
