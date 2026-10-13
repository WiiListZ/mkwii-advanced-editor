// Portable Windows command-line helpers. They remain separate GPL programs and
// are unpacked only when a suitable user-installed copy is not available.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve, sep } from "node:path";
import { unzipSync } from "fflate";
import archivePath from "../vendor/tools-win-x64.zip" with { type: "file" };

export const BUNDLED_TOOLS_SHA256 = "a8c27150dbd835f525503631e4be3e89d7b291eb3f7cf534c08d9b0d8c4169ca";

const installedAbmatt = () => [
  process.env.MKWII_ABMATT,
  join(homedir(), "Documents", "abmatt", "bin", "abmatt.exe"),
  Bun.which("abmatt"),
].some((path) => !!path && existsSync(path));

const installedWiimm = () => [
  process.env.MKWII_WSZST,
  Bun.which("wszst"),
  join(process.env.ProgramW6432 || "C:\\Program Files", "Wiimm", "SZS", "wszst.exe"),
  join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Wiimm", "SZS", "wszst.exe"),
].find((path) => !!path && existsSync(path));

function paths(root: string) {
  return {
    root,
    abmatt: join(root, "abmatt", "bin", "abmatt.exe"),
    wszst: join(root, "wiimm", "bin", "wszst.exe"),
    wimgt: join(root, "wiimm", "bin", "wimgt.exe"),
    wiimmBin: join(root, "wiimm", "bin"),
  };
}

async function ready(root: string) {
  const bundled = paths(root);
  return (await Bun.file(join(root, ".ready")).text().catch(() => "")) === BUNDLED_TOOLS_SHA256 &&
    [bundled.abmatt, bundled.wszst, bundled.wimgt].every(existsSync);
}

/** Extracts the pinned upstream tool package and checks every required executable. */
export async function extractBundledTools(cacheRoot: string) {
  const target = join(resolve(cacheRoot), BUNDLED_TOOLS_SHA256.slice(0, 16));
  const bundled = paths(target);
  if (await ready(target)) return bundled;

  const zip = new Uint8Array(await readFile(archivePath));
  const actual = createHash("sha256").update(zip).digest("hex");
  if (actual !== BUNDLED_TOOLS_SHA256) throw new Error("The bundled tools failed their SHA-256 check");
  const files = unzipSync(zip);
  const stage = join(resolve(cacheRoot), `.extract-${process.pid}-${crypto.randomUUID()}`);
  await mkdir(stage, { recursive: true });
  try {
    for (const [name, data] of Object.entries(files)) {
      const destination = resolve(stage, ...name.split("/"));
      if (!destination.startsWith(stage + sep) || name.includes("\\") || name.split("/").includes(".."))
        throw new Error(`Unsafe bundled tool path: ${name}`);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, data);
    }
    const extracted = paths(stage);
    if (![extracted.abmatt, extracted.wszst, extracted.wimgt].every(existsSync))
      throw new Error("Bundled tool package is incomplete");
    await writeFile(join(stage, ".ready"), BUNDLED_TOOLS_SHA256);
    if (await ready(target)) return bundled;
    if (existsSync(target)) {
      if (!target.startsWith(resolve(cacheRoot) + sep)) throw new Error("Unsafe tool cache path");
      await rm(target, { recursive: true, force: true });
    }
    for (let attempt = 0; ; attempt++) {
      try { await rename(stage, target); break; }
      catch (error: any) {
        // Another editor instance may have finished first. Windows may also
        // briefly lock a newly extracted executable while scanning it.
        if (await ready(target)) break;
        if (attempt === 15 || !["EPERM", "EACCES", "EBUSY"].includes(error?.code)) throw error;
        await Bun.sleep(100 + attempt * 50);
      }
    }
  } finally {
    if (!stage.startsWith(resolve(cacheRoot) + sep)) throw new Error("Unsafe temporary tool path");
    await rm(stage, { recursive: true, force: true });
  }
  return bundled;
}

/** Makes the bundled tools available before the HTTP worker accepts requests. */
export async function prepareBundledTools(settingsDir: string) {
  if (process.platform !== "win32") return;
  const hasAbmatt = installedAbmatt(), wiimm = installedWiimm();
  const hasWiimmPair = !!wiimm && existsSync(join(dirname(wiimm), "wimgt.exe"));
  if (hasAbmatt && hasWiimmPair) {
    process.env.PATH = `${dirname(wiimm!)}${delimiter}${process.env.PATH || ""}`;
    return;
  }
  const bundled = await extractBundledTools(join(settingsDir, "bundled-tools"));
  if (!hasAbmatt) process.env.MKWII_ABMATT = bundled.abmatt;
  if (!wiimm) process.env.MKWII_WSZST = bundled.wszst;
  process.env.PATH = `${bundled.wiimmBin}${delimiter}${process.env.PATH || ""}`;
}
