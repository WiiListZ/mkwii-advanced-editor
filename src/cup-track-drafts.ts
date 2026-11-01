import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { yaz0Compress } from "../web/js/formats/yaz0.js";

type Draft = { label: string; destination: string | null; appliedPath: string | null };
const key = (path: string) => resolve(path).toLowerCase();

// A generated cup track belongs to its chosen position, not to a user-selected source file.
// Keep a working copy until Apply succeeds, then let its editor save directly to that position.
export class CupTrackDrafts {
  readonly root: string;
  constructor(settingsDir: string) { this.root = join(settingsDir, "cup-tracks"); }
  private owns(path: string) {
    const rel = relative(this.root, resolve(path));
    return /^[0-9a-f-]{36}[\\/][^\\/]+\.szs$/i.test(rel);
  }
  private async read(path: string): Promise<Draft | null> {
    if (!path || !this.owns(path)) return null;
    try { return JSON.parse(await readFile(path + ".json", "utf8")); } catch { return null; }
  }
  async create(data: Uint8Array, label: string, destination?: string) {
    const name = (label.replace(/[<>:"/\\|?*\x00-\x1f]/g, " ").trim().replace(/[. ]+$/, "").slice(0, 100) || "New cup track") + ".szs";
    const path = join(this.root, crypto.randomUUID(), `New ${name}`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, yaz0Compress(data));
    await writeFile(path + ".json", JSON.stringify({ label, destination: destination ? resolve(destination) : null, appliedPath: null } satisfies Draft));
    return { path };
  }
  async info(path: string) {
    const draft = await this.read(path);
    return draft ? { label: draft.label, path: draft.appliedPath || path, pending: !draft.appliedPath } : null;
  }
  async applied(files: { source: string; path: string }[]) {
    for (const source of new Set(files.map((f) => f.source))) {
      const draft = await this.read(source);
      if (!draft) continue;
      const candidates = files.filter((f) => f.source === source);
      const target = candidates.find((f) => draft.destination && key(f.path) === key(draft.destination)) || candidates[0];
      if (!target || !existsSync(target.path)) throw new Error(`The cup track was not written: ${basename(target?.path || source)}`);
      await writeFile(source + ".json", JSON.stringify({ ...draft, appliedPath: resolve(target.path) }));
    }
  }
}
