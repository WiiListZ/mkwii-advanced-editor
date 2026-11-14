// Replaces, adds or removes resources (subfiles) of a BRRES. A resource of another size cannot be
// written in place: Wiimm's wszst unpacks the archive (each subfile with its own names), the files
// change, and it packs it again, with new folders when needed. Used by the animation, scene,
// texture and other editors of the web UI.
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { wszstPath } from "./chr0-import.ts";

export type BRRESChange = { folder: string; name: string; data: Uint8Array | null };

const SAFE = /^[^\0\\/:*?"<>|]+$/;

export async function changeBRRESResources(brres: Uint8Array, changes: BRRESChange[]) {
  if (!changes.length) return brres;
  const exe = wszstPath();
  if (!exe) throw new Error("Changing BRRES resources requires the included Wiimm tools");
  const dir = await mkdtemp(join(tmpdir(), "mkwii-brres-"));
  try {
    const run = async (...args: string[]) => {
      const child = Bun.spawn([exe, ...args], { cwd: dir, env: process.env, stdout: "pipe", stderr: "pipe", windowsHide: true });
      const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      if (code) throw new Error(`Could not rebuild the BRRES: ${(out + "\n" + err).trim().slice(-600)}`);
    };
    const source = join(dir, "source.brres"), extracted = join(dir, "files"), output = join(dir, "output.brres");
    await writeFile(source, brres);
    await run("EXTRACT", source, "--dest", extracted);
    for (const change of changes) {
      if (!SAFE.test(change.folder) || !SAFE.test(change.name) || change.name === "." || change.name === "..") throw new Error(`Invalid resource name ${change.folder}/${change.name}`);
      const folder = resolve(extracted, change.folder), path = resolve(folder, change.name);
      if (!folder.startsWith(resolve(extracted) + sep) || !path.startsWith(folder + sep)) throw new Error("Invalid resource path");
      if (change.data) {
        await mkdir(folder, { recursive: true });
        await writeFile(path, change.data);
      } else {
        await rm(path, { force: true });
        // An emptied folder goes too: an empty group is not valid in a BRRES.
        if (!(await readdir(folder).catch(() => [])).length) await rm(folder, { recursive: true, force: true });
      }
    }
    await run("CREATE", "--brres", extracted, "--dest", output);
    return new Uint8Array(await readFile(output));
  } finally {
    if (resolve(dir).startsWith(resolve(tmpdir()) + sep)) await rm(dir, { recursive: true, force: true });
  }
}
