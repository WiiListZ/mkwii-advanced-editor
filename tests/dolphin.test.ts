import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { dolphinCommand, findDolphin, findGame } from "../src/dolphin.ts";

function folder(run: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "mkwii-dolphin-"));
  try { run(dir); }
  finally {
    if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe test folder");
    rmSync(dir, { recursive: true, force: true });
  }
}

test("Dolphin is found from a chosen path, then from its own settings, then in the usual folders", () => {
  folder((dir) => {
    const env = { APPDATA: join(dir, "roaming"), USERPROFILE: join(dir, "home"), ProgramFiles: join(dir, "programs") } as any;
    expect(findDolphin("", env)).toBe("");
    const installed = join(dir, "programs", "Dolphin-x64", "Dolphin.exe");
    mkdirSync(join(dir, "programs", "Dolphin-x64"), { recursive: true });
    writeFileSync(installed, "");
    expect(findDolphin("", env)).toBe(resolve(installed));
    // Dolphin's settings name the folder it was unpacked into, which can be anywhere.
    const unpacked = join(dir, "games", "Dolphin.exe");
    mkdirSync(join(dir, "games"));
    writeFileSync(unpacked, "");
    mkdirSync(join(dir, "roaming", "Dolphin Emulator", "Config"), { recursive: true });
    writeFileSync(join(dir, "roaming", "Dolphin Emulator", "Config", "Dolphin.ini"), `[General]\r\nISOPath0 = ${join(dir, "games")}\r\nISOPaths = 1\r\n`);
    expect(findDolphin("", env)).toBe(resolve(unpacked));
    const chosen = join(dir, "mine.exe");
    writeFileSync(chosen, "");
    expect(findDolphin(chosen, env)).toBe(resolve(chosen));
    // A chosen path that is gone does not stop it from finding one.
    expect(findDolphin(join(dir, "gone.exe"), env)).toBe(resolve(unpacked));
  });
});

test("the extracted game opens through sys/main.dol unless a game was chosen", () => {
  folder((dir) => {
    const files = join(dir, "game", "files");
    mkdirSync(files, { recursive: true });
    expect(findGame(files)).toBe("");
    mkdirSync(join(dir, "game", "sys"));
    writeFileSync(join(dir, "game", "sys", "main.dol"), "");
    expect(findGame(files)).toBe(resolve(dir, "game", "sys", "main.dol"));
    const image = join(dir, "game.iso");
    writeFileSync(image, "");
    expect(findGame(files, image)).toBe(resolve(image));
    expect(dolphinCommand("D.exe", "g.iso")).toEqual(["D.exe", "-b", "-e", "g.iso"]);
  });
});
