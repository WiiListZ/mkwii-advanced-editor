// Finding and starting the Dolphin emulator, and the paths of its data.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export function dolphinDataFolders(env: NodeJS.ProcessEnv = process.env) {
  const home = env.USERPROFILE || env.HOME || "";
  return [env.APPDATA && join(env.APPDATA, "Dolphin Emulator"), home && join(home, "Documents", "Dolphin Emulator")].filter(Boolean) as string[];
}

// The folders in Dolphin's own settings often hold the emulator itself.
function foldersInSettings(data: string) {
  const ini = join(data, "Config", "Dolphin.ini");
  if (!existsSync(ini)) return [];
  const folders: string[] = [];
  for (const line of readFileSync(ini, "utf8").split(/\r?\n/)) {
    const value = /^\s*(?:ISOPath\d+|DefaultISO)\s*=\s*(.+?)\s*$/.exec(line)?.[1];
    if (!value) continue;
    folders.push(/\.[a-z0-9]{2,5}$/i.test(value) ? dirname(value) : value);
  }
  return folders;
}

export function findDolphin(chosen = "", env: NodeJS.ProcessEnv = process.env) {
  if (chosen && existsSync(chosen)) return resolve(chosen);
  const programs = [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA].filter(Boolean) as string[];
  const candidates = [
    ...dolphinDataFolders(env).flatMap(foldersInSettings).map((folder) => join(folder, "Dolphin.exe")),
    ...programs.flatMap((folder) => [join(folder, "Dolphin-x64", "Dolphin.exe"), join(folder, "Dolphin", "Dolphin.exe")]),
  ];
  const found = candidates.find((path) => existsSync(path));
  return found ? resolve(found) : "";
}

// A game chosen by hand first; otherwise the extracted game beside the editor's `files` folder.
// Dolphin reads the files of a folder started through its sys/main.dol, so saved edits show.
export function findGame(workspace = "", chosen = "") {
  if (chosen && existsSync(chosen)) return resolve(chosen);
  if (!workspace) return "";
  const dol = join(workspace, "..", "sys", "main.dol");
  return existsSync(dol) ? resolve(dol) : "";
}

// Batch mode: only the game's window, without Dolphin's own with its game list. Dolphin closes with the game.
export function dolphinCommand(exe: string, game: string) {
  return [exe, "-b", "-e", game];
}

export function launchDolphin(exe: string, game: string) {
  // Started from its own folder, with nothing tying it to the editor: it stays open after it closes.
  const child = Bun.spawn(dolphinCommand(exe, game), { cwd: dirname(exe), stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  child.unref();
}
