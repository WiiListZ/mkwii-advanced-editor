// The path any ghost drives, worked out from its buttons with Kinoko, a reimplementation of the game's
// physics (vendor/ghost-path.exe, built by scripts/build-ghost-path.ts). It reads the game's own
// Race/Common.szs and the track's file, and drives the ghost as the game does: in a second, with no
// Dolphin. When the race ends on the ghost's own finish time the path is the game's; otherwise it
// went elsewhere from some point (an object or a part of the physics Kinoko does not have yet).
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import exePath from "../vendor/ghost-path.exe" with { type: "file" };
// @ts-ignore Shared Wii format reader used by the frontend.
import { COURSE_NAMES, parseRKG } from "../web/js/formats/rkg.js";
// @ts-ignore Shared track names used by the frontend.
import { TRACK_NAMES } from "../web/js/data/defs.js";

export const GHOST_PATH_SHA256 = "77c406636abf590be2c5d75802609abd4ea318563187a9c3e1a3ed4f6e92b2e5";

// The program, in the settings folder: a file embedded in the editor cannot be run where it is.
async function program(settingsDir: string) {
  const target = join(settingsDir, "bundled-tools", `ghost-path-${GHOST_PATH_SHA256.slice(0, 16)}.exe`);
  if (existsSync(target)) return target;
  const data = new Uint8Array(await readFile(exePath));
  if (createHash("sha256").update(data).digest("hex") !== GHOST_PATH_SHA256) throw new Error("The bundled ghost path program failed its SHA-256 check");
  await mkdir(join(settingsDir, "bundled-tools"), { recursive: true });
  const stage = `${target}.${process.pid}.tmp`;
  await writeFile(stage, data);
  try { await rename(stage, target); } catch { await rm(stage, { force: true }); if (!existsSync(target)) throw new Error("Could not set up the ghost path program"); }
  return target;
}

// The track's file name in Race/Course, as Kinoko looks for it.
export const courseFile = (track: number) => {
  const stem = Object.entries(TRACK_NAMES as Record<string, string>).find(([, name]) => name === COURSE_NAMES[track])?.[0];
  return stem ? `${stem}.szs` : null;
};

// from: when it is not the game's, the first lap that went otherwise (0: only the finish). Each row
// of path holds KINOKO_ROW floats: the frame, place and rotation, then what the kart is doing (drift,
// boost, in the air, wheelie; see native/ghost-path/main.cc).
export const KINOKO_ROW = 12;
export type ComputedPath = { path: Uint8Array; synced: boolean; from: number | null };

// ghost: the .rkg; workspace: the extracted game's files (holding Race/); trackFile: the track to drive
// it on instead of the game folder's own, for a track kept elsewhere. Null when it cannot be worked
// out: no game files, a track that is not one of the game's positions, or a ghost Kinoko cannot read.
export async function computeGhostPath(settingsDir: string, ghost: Uint8Array, workspace: string, trackFile?: string): Promise<ComputedPath | null> {
  if (process.platform !== "win32" || !workspace) return null;
  const common = join(workspace, "Race", "Common.szs");
  const name = courseFile(parseRKG(ghost).track);
  if (!name || !existsSync(common)) return null;
  const own = join(workspace, "Race", "Course", name);
  const track = trackFile && existsSync(trackFile) ? resolve(trackFile) : own;
  if (!existsSync(track)) return null;
  const work = await mkdtemp(join(tmpdir(), "mkwii-ghost-path-"));
  try {
    // Kinoko reads Race/Common.szs and Race/Course/<track>.szs under its root: the game folder, or
    // one made for a track kept elsewhere.
    let root = workspace;
    if (track !== resolve(own)) {
      root = join(work, "game");
      await mkdir(join(root, "Race", "Course"), { recursive: true });
      await copyFile(common, join(root, "Race", "Common.szs"));
      await copyFile(track, join(root, "Race", "Course", name));
    }
    const input = join(work, "ghost.rkg"), output = join(work, "ghost.path");
    await writeFile(input, ghost);
    const child = Bun.spawn([await program(settingsDir), input, output], {
      cwd: work, env: { ...process.env, KINOKO_FILESYSTEM_ROOT: root }, stdin: "ignore", stdout: "pipe", stderr: "ignore",
    });
    const timer = setTimeout(() => child.kill(), 60000);
    const [code, said] = await Promise.all([child.exited, new Response(child.stdout).text()]);
    clearTimeout(timer);
    if ((code !== 0 && code !== 2) || !existsSync(output)) return null;
    const path = new Uint8Array(await readFile(output));
    const lap = /lap (\d+)/.exec(said)?.[1];
    return path.length ? { path, synced: code === 0, from: code === 0 ? null : lap ? Number(lap) : 0 } : null;
  } finally {
    if (work.startsWith(resolve(tmpdir()))) await rm(work, { recursive: true, force: true });
  }
}
