import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { computeGhostPath, courseFile, KINOKO_ROW } from "../src/ghost-path.ts";
// @ts-ignore Shared Wii format reader used by the frontend.
import { COURSE_NAMES, COUNTDOWN_FRAMES, inputFrames, parseRKG } from "../web/js/formats/rkg.js";

// The extracted game's files (holding Race/), e.g. MKWII_GAME_DIR=C:/games/mkwii/files.
const game = process.env.MKWII_GAME_DIR;
const staff = (folder: string, file: string) => new Uint8Array(readFileSync(join(game!, "Race", "TimeAttack", folder, file)));

test("each of the game's tracks has the file Kinoko reads for it", () => {
  for (let track = 0; track < COURSE_NAMES.length; track++) expect(courseFile(track)).toMatch(/^[a-z0-9_]+\.szs$/);
  expect(courseFile(8)).toBe("beginner_course.szs");
  expect(courseFile(99)).toBeNull();
});

test("without the game's files there is nothing to work out", async () => {
  const settings = mkdtempSync(join(tmpdir(), "mkwii-ghost-path-"));
  try {
    const ghost = new Uint8Array(0x100);
    ghost.set([0x52, 0x4B, 0x47, 0x44]);
    expect(await computeGhostPath(settings, ghost, "")).toBeNull();
    expect(await computeGhostPath(settings, ghost, join(settings, "no-game"))).toBeNull();
  } finally {
    if (!resolve(settings).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe test folder");
    rmSync(settings, { recursive: true, force: true });
  }
});

test.skipIf(!game || process.platform !== "win32" || !existsSync(join(game || "", "Race", "Common.szs")))("a staff ghost driven by Kinoko reaches its own time, on its track and not on another", async () => {
  const settings = mkdtempSync(join(tmpdir(), "mkwii-ghost-path-"));
  try {
    const bytes = staff("ghost1", "ghost1_comp_00.rkg"), ghost = parseRKG(bytes);
    // Its own track, as the game folder has it: unless that file was edited, the game's path.
    const own = join(game!, "Race", "Course", `${courseFile(ghost.track)}.bak`);
    const result = (await computeGhostPath(settings, bytes, game!, existsSync(own) ? own : undefined))!;
    expect(result.synced).toBe(true);
    expect(result.from).toBeNull();
    const rows = result.path.length / 4 / KINOKO_ROW, view = new DataView(result.path.buffer, result.path.byteOffset);
    const row = (i: number) => Array.from({ length: KINOKO_ROW }, (_, k) => view.getFloat32((i * KINOKO_ROW + k) * 4, true));
    // A row for each frame from the countdown to the finish, as the ghost's buttons.
    expect(rows).toBe(inputFrames(ghost.inputs.face));
    expect(row(0)[0]).toBe(0);
    expect(row(rows - 1)[0]).toBe(rows - 1);
    // On the start line until the race starts (only settling on its wheels), moving after; a rotation each frame.
    expect([row(COUNTDOWN_FRAMES - 1)[1], row(COUNTDOWN_FRAMES - 1)[3]]).toEqual([row(0)[1], row(0)[3]]);
    expect(Math.hypot(row(COUNTDOWN_FRAMES + 30)[1] - row(0)[1], row(COUNTDOWN_FRAMES + 30)[3] - row(0)[3])).toBeGreaterThan(300);
    for (let i = 0; i < rows; i += 97) expect(Math.hypot(...row(i).slice(4, 8))).toBeCloseTo(1, 4);
    // This one drifts by itself (automatic): it never charges a mini-turbo.
    const column = (path: Uint8Array, k: number) => { const v = new DataView(path.buffer, path.byteOffset); return Array.from({ length: path.length / 4 / KINOKO_ROW }, (_, i) => v.getFloat32((i * KINOKO_ROW + k) * 4, true)); };
    expect(ghost.automatic).toBe(true);
    expect(column(result.path, 8).every((v) => v < 2)).toBe(true);
    // With manual drift: a bike charges mini-turbos (blue), a kart super mini-turbos too (orange), and
    // boosts after them; both leave the ground now and then; none of it before the race starts.
    for (const [folder, file, kart] of [["ghost2", "ghost2_comp_00.rkg", false], ["ghost2", "ghost2_comp_04.rkg", true]] as const) {
      const manual = staff(folder, file), driven = parseRKG(manual);
      const track = join(game!, "Race", "Course", `${courseFile(driven.track)}.bak`);
      const path = (await computeGhostPath(settings, manual, game!, existsSync(track) ? track : undefined))!;
      expect(`${file} ${path.synced}`).toBe(`${file} true`);
      const [drift, boost, air] = [column(path.path, 8), column(path.path, 9), column(path.path, 10)];
      expect(drift.filter((v) => v === 2).length).toBeGreaterThan(100);
      expect(drift.some((v) => v === 3)).toBe(kart);
      expect(boost.filter((v) => v === 1).length).toBeGreaterThan(50);
      expect(air.some((v) => v === 1)).toBe(true);
      expect(drift.slice(0, COUNTDOWN_FRAMES).every((v) => v === 0)).toBe(true);
    }
    // On another track it does not reach its time, and says from which lap.
    const elsewhere = (await computeGhostPath(settings, bytes, game!, join(game!, "Race", "Course", "castle_course.szs")))!;
    expect(elsewhere.synced).toBe(false);
    expect(elsewhere.from).toBeGreaterThanOrEqual(1);
  } finally {
    if (!resolve(settings).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe test folder");
    rmSync(settings, { recursive: true, force: true });
  }
}, 60000);
