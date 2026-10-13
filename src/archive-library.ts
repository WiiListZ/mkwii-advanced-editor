// Index of the track archives (.szs) in a folder: which files each one contains, so object models
// (including custom ones from modded tracks) can be found and copied without reopening every archive.
// The index is cached on disk and refreshed only for archives whose size or date changed.

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
// @ts-ignore - plain JS modules shared with the UI
import { isYaz0, isWLZ, isWU8, isWBZ, isYBZ, yaz0Decompress } from "../web/js/formats/yaz0.js";
// @ts-ignore
import { isU8, parseU8, listFiles, findFile } from "../web/js/formats/u8.js";
import { decodeWiimmArchive } from "./wiimm-archives.ts";

export interface ArchiveEntry { name: string; size: number; mtime: number; files: string[]; error?: string }
type IndexCache = Record<string, ArchiveEntry>;

const tick = () => new Promise((r) => setTimeout(r, 0));
const recent: { path: string; size: number; mtime: number; tree: any }[] = [];

async function openArchive(path: string, settingsDir: string, sourcePaths: string[]) {
  const info = await stat(path);
  const hit = recent.find((r) => r.path === path && r.size === info.size && r.mtime === info.mtimeMs);
  if (hit) return hit.tree;
  let bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  if (isWLZ(bytes) || isWU8(bytes) || isWBZ(bytes) || isYBZ(bytes)) bytes = await decodeWiimmArchive(path, null, settingsDir, sourcePaths);
  if (isYaz0(bytes)) bytes = yaz0Decompress(bytes);
  if (!isU8(bytes)) throw new Error("Not an SZS archive");
  const tree = parseU8(bytes);
  recent.unshift({ path, size: info.size, mtime: info.mtimeMs, tree });
  recent.length = Math.min(recent.length, 4);
  return tree;
}

export async function indexArchives(folder: string, cacheFile: string, settingsDir: string, sourcePaths: string[]) {
  const cache: IndexCache = await Bun.file(cacheFile).json().catch(() => ({}));
  const names = (await readdir(folder, { withFileTypes: true }))
    .filter((e) => e.isFile() && /\.(szs|wlz|wbz|wu8)$/i.test(e.name)).map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const archives: ArchiveEntry[] = [];
  let changed = false;
  for (const name of names) {
    const path = join(folder, name);
    const info = await stat(path);
    const cached = cache[path];
    if (cached && !cached.error && cached.size === info.size && cached.mtime === info.mtimeMs) { archives.push(cached); continue; }
    let entry: ArchiveEntry;
    try {
      const tree = await openArchive(path, settingsDir, sourcePaths);
      entry = { name, size: info.size, mtime: info.mtimeMs, files: listFiles(tree).map((f: any) => f.path) };
    } catch (e: any) {
      entry = { name, size: info.size, mtime: info.mtimeMs, files: [], error: String(e?.message || e) };
    }
    cache[path] = entry;
    archives.push(entry);
    changed = true;
    await tick(); // let other API calls through while a big folder is indexed
  }
  if (changed) await Bun.write(cacheFile, JSON.stringify(cache));
  return { folder, archives };
}

export async function readArchiveFile(path: string, file: string, settingsDir: string, sourcePaths: string[]): Promise<Uint8Array> {
  const node = findFile(await openArchive(path, settingsDir, sourcePaths), file);
  if (!node?.data) throw new Error(`${file} was not found in ${path}`);
  return node.data;
}
