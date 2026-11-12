// Earlier versions of a saved track, kept beside the editor's settings: before a save overwrites a
// file, what was on disk is put here. Unlike the single .bak, which keeps the very first original,
// these are the latest saves, and the oldest go when there are too many.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";

export const VERSIONS_KEPT = 20;

const folderOf = (settingsDir: string, path: string) =>
  join(settingsDir, "versions", createHash("sha1").update(resolve(path).toLowerCase()).digest("hex").slice(0, 16));

const ID = /^\d+(-\d+)?$/;
const idOf = (name: string) => name.replace(/\.[^.]*$/, "");
const timeOf = (id: string) => Number(id.split("-")[0]);

function files(folder: string) {
  if (!existsSync(folder)) return [];
  return readdirSync(folder).filter((name) => ID.test(idOf(name)) && name !== "path.txt")
    .sort((a, b) => timeOf(idOf(b)) - timeOf(idOf(a)) || Number(idOf(b).split("-")[1] || 0) - Number(idOf(a).split("-")[1] || 0));
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && Buffer.compare(a, b) === 0;

// What is on disk now becomes a version, unless it is the same as the latest one. Returns its id.
export function saveVersion(settingsDir: string, path: string, kept = VERSIONS_KEPT): string | null {
  if (!existsSync(path) || kept <= 0) return null;
  const folder = folderOf(settingsDir, path), present = new Uint8Array(readFileSync(path));
  const latest = files(folder)[0];
  if (latest && sameBytes(new Uint8Array(readFileSync(join(folder, latest))), present)) return null;
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "path.txt"), resolve(path));
  const extension = extname(path), now = Date.now();
  let id = String(now);
  for (let n = 1; existsSync(join(folder, id + extension)); n++) id = `${now}-${n}`;
  writeFileSync(join(folder, id + extension), present);
  for (const old of files(folder).slice(kept)) rmSync(join(folder, old), { force: true });
  return id;
}

// Newest first.
export function listVersions(settingsDir: string, path: string) {
  const folder = folderOf(settingsDir, path);
  return files(folder).map((name) => ({ id: idOf(name), at: timeOf(idOf(name)), size: statSync(join(folder, name)).size }));
}

function fileOf(settingsDir: string, path: string, id: string) {
  if (!ID.test(id)) throw new Error("Invalid version");
  const folder = folderOf(settingsDir, path), name = files(folder).find((item) => idOf(item) === id);
  if (!name) throw new Error("This version is no longer kept");
  return join(folder, name);
}

export const readVersion = (settingsDir: string, path: string, id: string) => new Uint8Array(readFileSync(fileOf(settingsDir, path, id)));

// Puts a version back on disk. What was there is kept as a version first, so this can be undone too.
export function restoreVersion(settingsDir: string, path: string, id: string, kept = VERSIONS_KEPT) {
  const data = readVersion(settingsDir, path, id);
  saveVersion(settingsDir, path, Math.max(kept, 1));
  writeFileSync(path, data);
  return { size: data.length };
}
