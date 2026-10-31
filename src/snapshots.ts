// Backups of game files taken before a change that rewrites many of them at once (Cups and tracks),
// so the change can be undone later even when .bak backups are turned off. Each backup is a folder
// <settings>/snapshots/<id>/ with a copy of every file and manifest.json:
// { id, created, label, details, files: [{ path, copy, existed, size }] }.
// A file that did not exist when the backup was taken is removed again on restore.

import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type SnapshotFile = { path: string; copy: string; existed: boolean; size: number };
export type Snapshot = { id: string; created: string; label: string; details: unknown; files: SnapshotFile[]; size: number };

const validId = (id: string) => /^[0-9A-Za-z_-]+$/.test(id);
const folderOf = (root: string, id: string) => {
  if (!validId(id)) throw new Error("Invalid backup ID");
  return join(root, "snapshots", id);
};

export async function createSnapshot(root: string, label: string, files: string[], details: unknown = {}): Promise<Snapshot> {
  if (!files.length) throw new Error("No files to back up");
  const id = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 17) + "-" + Math.random().toString(36).slice(2, 6);
  const folder = folderOf(root, id);
  await mkdir(folder, { recursive: true });
  const unique = [...new Map(files.map((f) => [resolve(f).toLowerCase(), resolve(f)])).values()];
  const entries: SnapshotFile[] = [];
  try {
    for (const [i, path] of unique.entries()) {
      const copy = `${String(i).padStart(4, "0")}_${path.split(/[\\/]/).pop()}`;
      if (existsSync(path)) {
        await copyFile(path, join(folder, copy));
        entries.push({ path, copy, existed: true, size: (await stat(path)).size });
      } else entries.push({ path, copy: "", existed: false, size: 0 });
    }
  } catch (error) {
    // A half-written backup is worse than none: it would restore only part of the files.
    await rm(folder, { recursive: true, force: true });
    throw error;
  }
  const snapshot: Snapshot = { id, created: new Date().toISOString(), label, details, files: entries, size: entries.reduce((n, f) => n + f.size, 0) };
  await writeFile(join(folder, "manifest.json"), JSON.stringify(snapshot, null, 2));
  return snapshot;
}

export async function listSnapshots(root: string): Promise<Snapshot[]> {
  const base = join(root, "snapshots");
  const ids = await readdir(base).catch(() => [] as string[]);
  const out: Snapshot[] = [];
  for (const id of ids) {
    if (!validId(id)) continue;
    try { out.push(JSON.parse(await readFile(join(base, id, "manifest.json"), "utf8"))); } catch { /* unfinished or foreign folder */ }
  }
  return out.sort((a, b) => b.created.localeCompare(a.created));
}

export async function restoreSnapshot(root: string, id: string) {
  const folder = folderOf(root, id);
  const snapshot: Snapshot = JSON.parse(await readFile(join(folder, "manifest.json"), "utf8"));
  // Every copy must be there before anything is overwritten.
  for (const f of snapshot.files) if (f.existed && !existsSync(join(folder, f.copy))) throw new Error(`The backup is incomplete: ${f.copy} is missing`);
  let restored = 0, removed = 0;
  for (const f of snapshot.files) {
    if (f.existed) {
      await mkdir(dirname(f.path), { recursive: true });
      await copyFile(join(folder, f.copy), f.path);
      restored++;
    } else if (existsSync(f.path)) {
      await rm(f.path, { force: true });
      removed++;
    }
  }
  return { restored, removed, files: snapshot.files.map((f) => f.path) };
}

export async function deleteSnapshot(root: string, id: string) {
  await rm(folderOf(root, id), { recursive: true, force: true });
  return { ok: true };
}
