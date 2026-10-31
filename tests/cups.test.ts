import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  CUPS, SLOTS, checkTrackArchive, initialArrangement, isChanged, moveSlot, musicFiles, nameChanges, nameIds, neighbourSlot,
  planArrangement, plannedMusic, replaceSlot, resetSlot, setSlotMusic, slotById, swapSlots,
} from "../web/js/data/cups.js";
import { createSnapshot, deleteSnapshot, listSnapshots, restoreSnapshot } from "../src/snapshots.ts";

const LUIGI = 0x08, MOO = 0x01, MARIO = 0x00, MALL = 0x05, BLOCK = 0x21;

describe("cup slots", () => {
  test("every slot is in exactly one cup, race and battle apart", () => {
    const all = CUPS.flatMap((c) => c.slots);
    expect(all.length).toBe(42);
    expect(new Set(all).size).toBe(42);
    for (const cup of CUPS) for (const id of cup.slots) expect(slotById(id).battle).toBe(!!cup.battle);
    expect(SLOTS.every((s) => s.label)).toBe(true);
  });

  test("name messages match the game's Common.bmg layout", () => {
    expect(nameIds(LUIGI)).toEqual([0x245c, 0x2498]);
    expect(nameIds(MARIO)).toEqual([0x2454, 0x2490]);
    expect(nameIds(BLOCK)).toEqual([0x24b9, 0x24cd, 0x24e1]);
  });

  test("arrows move through the cups in menu order", () => {
    expect(neighbourSlot(LUIGI, 1)).toBe(MOO);
    expect(neighbourSlot(LUIGI, -1)).toBeNull();
    expect(neighbourSlot(0x04, 1)).toBe(MARIO); // Toad's Factory -> first track of the Flower Cup
    expect(neighbourSlot(MOO, "cup+1")).toBe(MALL);
    expect(neighbourSlot(LUIGI, "cup-1")).toBeNull();
    expect(neighbourSlot(0x1c, 1)).toBeNull(); // last race track does not continue into the arenas
  });
});

describe("arrangement", () => {
  test("Coconut Mall and Luigi Circuit swap places", () => {
    const a = swapSlots(initialArrangement(), LUIGI, MALL);
    expect(a.content[LUIGI]).toEqual({ type: "slot", id: MALL });
    expect(a.content[MALL]).toEqual({ type: "slot", id: LUIGI });
    const plan = planArrangement(a);
    expect(plan.tracks.map((t) => t.slot).sort()).toEqual([MALL, LUIGI].sort());
    // Luigi Circuit shares n_Circuit32 with Mario Circuit, which stays: that music cannot move.
    expect(plan.musicKept.map((m) => m.stream)).toEqual(["n_Circuit32"]);
    expect(plan.music).toEqual([{ target: "n_Shopping32", source: "n_Circuit32" }]);
  });

  test("music moves both ways between slots with their own stream", () => {
    const plan = planArrangement(swapSlots(initialArrangement(), MOO, MALL));
    expect(plan.music).toContainEqual({ target: "n_Farm", source: "n_Shopping32" });
    expect(plan.music).toContainEqual({ target: "n_Shopping32", source: "n_Farm" });
    expect(planArrangement(swapSlots(initialArrangement(), MOO, MALL), { moveMusic: false }).music).toEqual([]);
  });

  test("a slot can take the music of another track or an audio file", () => {
    let a = setSlotMusic(initialArrangement(), MOO, { type: "slot", id: MALL });
    expect(isChanged(a, MOO)).toBe(true);
    let plan = planArrangement(a);
    expect(plan.music).toEqual([{ target: "n_Farm", source: "n_Shopping32" }]);
    expect(plannedMusic(plan, MOO)).toEqual({ stream: "n_Farm", from: "n_Shopping32", file: null });
    expect(plannedMusic(plan, MALL)).toEqual({ stream: "n_Shopping32", from: "n_Shopping32", file: null });
    // Also with music not following the tracks.
    expect(planArrangement(a, { moveMusic: false }).music).toEqual([{ target: "n_Farm", source: "n_Shopping32" }]);
    const file = { type: "file", path: "C:\\music\\song.mp3", label: "song", loop: true, loopStart: 0, volume: 100, finalFaster: true };
    a = setSlotMusic(a, MOO, file);
    plan = planArrangement(a);
    expect(plan.music).toEqual([{ target: "n_Farm", file }]);
    expect(plannedMusic(plan, MOO).file).toEqual(file);
    // The chosen music moves with the track, and Reset takes it away.
    a = swapSlots(a, MOO, MALL);
    expect(a.music[MALL]).toEqual(file);
    expect(a.music[MOO]).toBeUndefined();
    expect(planArrangement(a).music).toContainEqual({ target: "n_Shopping32", file });
    a = resetSlot(a, MALL);
    expect(a.music).toEqual({});
    expect(setSlotMusic(setSlotMusic(initialArrangement(), MOO, file), MOO, null).music).toEqual({});
  });

  test("chosen music beats the music that follows a track, and shared streams are reported", () => {
    // Luigi Circuit moves away, but its new music is chosen: no conflict on n_Circuit32 any more.
    let a = swapSlots(initialArrangement(), LUIGI, MALL);
    a = setSlotMusic(a, LUIGI, { type: "slot", id: MOO });
    const plan = planArrangement(a);
    expect(plan.musicKept).toEqual([]);
    expect(plan.music).toContainEqual({ target: "n_Circuit32", source: "n_Farm" });
    // Mario Circuit plays n_Circuit32 too.
    expect(plan.musicShared).toEqual([{ stream: "n_Circuit32", slots: SLOTS.filter((s) => s.music === "n_Circuit32").map((s) => s.id) }]);
    // Two different choices for one shared stream: it stays.
    a = setSlotMusic(a, MARIO, { type: "slot", id: MALL });
    expect(planArrangement(a).musicKept.map((m) => m.stream)).toEqual(["n_Circuit32"]);
  });

  test("races and arenas never mix", () => {
    expect(() => swapSlots(initialArrangement(), LUIGI, BLOCK)).toThrow();
  });

  test("moving twice and resetting returns to the original", () => {
    let a = moveSlot(initialArrangement(), MALL, "cup-1"); // Mall <-> Moo Moo Meadows
    a = moveSlot(a, MOO, 0); // no-op direction
    a = moveSlot(a, LUIGI, 1); // Luigi <-> Mall (now in Moo Moo's place)
    expect(a.content[LUIGI]).toEqual({ type: "slot", id: MALL });
    for (const id of [LUIGI, MOO, MALL]) a = resetSlot(a, id);
    expect(SLOTS.some((s) => isChanged(a, s.id))).toBe(false);
  });

  test("names follow the track per language; typed names replace them", () => {
    const texts = new Map<number, string>([[0x245c, "Circuito di Luigi"], [0x2498, "Circuito di Luigi"], [0x2459, "Centro Commerciale Cocco"], [0x2495, "Centro Commerciale Cocco"], [0x23f0, "Trofeo Fungo"]]);
    const read = (id: number) => texts.get(id) ?? null;
    let a = swapSlots(initialArrangement(), LUIGI, MALL);
    expect(nameChanges(a, read)).toEqual({ 0x245c: "Centro Commerciale Cocco", 0x2498: "Centro Commerciale Cocco", 0x2459: "Circuito di Luigi", 0x2495: "Circuito di Luigi" });
    a = replaceSlot(a, LUIGI, "C:\\tracks\\My Track.szs", "My Track");
    a = { ...a, cupNames: { 0: "Coppa Mia" } };
    const changes = nameChanges(a, read);
    expect(changes[0x245c]).toBe("My Track");
    expect(changes[0x23f0]).toBe("Coppa Mia");
    // A typed name follows its track when it moves.
    const moved = swapSlots(a, LUIGI, MOO);
    expect(moved.names[MOO]).toBe("My Track");
    expect(moved.names[LUIGI]).toBeUndefined();
  });

  test("music file names are found whatever their case", () => {
    expect(musicFiles("n_Farm", ["n_Farm_F.brstm", "n_Farm_n.brstm"])).toEqual({ normal: "n_Farm_n.brstm", final: "n_Farm_F.brstm" });
    expect(musicFiles("STRM_N_WATER", ["strm_n_water_n.brstm"])).toEqual({ normal: "strm_n_water_n.brstm", final: null });
  });

  test("replacement archives are checked", () => {
    const full = ["course.kmp", "course.kcl", "course_model.brres", "vrcorn_model.brres", "map_model.brres"];
    expect(checkTrackArchive({ files: full, checkpoints: 20, starts: 1 }, false)).toEqual({ errors: [], warnings: [] });
    expect(checkTrackArchive({ files: ["course.kmp", "course.kcl"], checkpoints: 20, starts: 1 }, false).errors.length).toBe(2);
    expect(checkTrackArchive({ files: full, checkpoints: 0, starts: 1 }, false).errors.length).toBe(1);
    expect(checkTrackArchive({ files: full, checkpoints: 0, starts: 1 }, true).errors.length).toBe(0);
  });
});

describe("backups", () => {
  test("a backup puts files back and removes files that did not exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "mkwii-snap-"));
    try {
      const a = join(root, "game", "a.szs"), b = join(root, "game", "b.szs");
      await Bun.write(a, "original A");
      const snap = await createSnapshot(join(root, "settings"), "Swap", [a, b]);
      expect(snap.files.map((f) => f.existed)).toEqual([true, false]);
      await writeFile(a, "changed A");
      await writeFile(b, "new B");
      expect((await listSnapshots(join(root, "settings"))).map((s) => s.id)).toEqual([snap.id]);
      const result = await restoreSnapshot(join(root, "settings"), snap.id);
      expect(result).toMatchObject({ restored: 1, removed: 1 });
      expect(await readFile(a, "utf8")).toBe("original A");
      expect(existsSync(b)).toBe(false);
      await deleteSnapshot(join(root, "settings"), snap.id);
      expect(await listSnapshots(join(root, "settings"))).toEqual([]);
      await expect(restoreSnapshot(join(root, "settings"), "../x")).rejects.toThrow();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
