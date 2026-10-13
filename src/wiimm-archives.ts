// Native WLZ/WBZ/WU8/YBZ reconstruction is preferred. Wiimm's SZS Tool remains
// an optional fallback; no original game assets ship with the editor.
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { decodeWiimmNative } from "./native-wiimm.ts";

const U8_MAGIC = [0x55, 0xaa, 0x38, 0x2d];
let building: Promise<void> | null = null;

function toolPath() {
  const candidates = [process.env.MKWII_WSZST, "wszst.exe",
    join(process.env.ProgramFiles || "C:\\Program Files", "Wiimm", "SZS", "wszst.exe")].filter(Boolean) as string[];
  return candidates;
}

async function run(args: string[]) {
  let missing = true;
  for (const exe of toolPath()) {
    try {
      const proc = Bun.spawn([exe, ...args], { stdout: "pipe", stderr: "pipe", windowsHide: true });
      missing = false;
      const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
      if (code !== 0) throw new Error((err || out).trim() || `wszst exited with code ${code}`);
      return;
    } catch (error: any) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
  }
  if (missing) throw new Error("WLZ/WBZ/WU8 needs Wiimm's SZS Tool (wszst.exe). Install it from szs.wiimm.de or set MKWII_WSZST to its path.");
}

function originalCourseDir(paths: string[]) {
  for (const path of paths) {
    if (!path) continue;
    const p = resolve(path);
    const options = /common\.szs$/i.test(p) ? [join(dirname(p), "Course")] :
      /[\\/]Race[\\/]Course$/i.test(p) ? [p] : [join(p, "Race", "Course"), join(p, "Course")];
    for (const dir of options) if (existsSync(join(dir, "beginner_course.szs")) && existsSync(join(dir, "rainbow_course.szs"))) return dir;
  }
  return null;
}

async function prepareAutoAdd(settingsDir: string, sourcePaths: string[]) {
  const courses = originalCourseDir(sourcePaths);
  if (!courses) return null;
  const autoAdd = join(settingsDir, "auto-add");
  const marker = join(settingsDir, "auto-add-source.txt");
  if ((await Bun.file(marker).text().catch(() => "")) === courses && existsSync(join(autoAdd, "itembox.brres"))) return autoAdd;
  if (!building) building = (async () => {
    await mkdir(autoAdd, { recursive: true });
    await run(["AUTOADD", "-q", "-D", autoAdd, courses]);
    if (!existsSync(join(autoAdd, "itembox.brres"))) throw new Error("Could not build the auto-add library from the selected original game tracks.");
    await writeFile(marker, courses);
  })().finally(() => { building = null; });
  await building;
  return autoAdd;
}

export async function decodeWiimmArchive(path: string | null, bytes: Uint8Array | null, settingsDir: string, sourcePaths: string[]) {
  const inputBytes = bytes || (path ? new Uint8Array(await readFile(path)) : new Uint8Array());
  let nativeError: Error;
  try { return await decodeWiimmNative(inputBytes, settingsDir, sourcePaths); }
  catch (error: any) { nativeError = error instanceof Error ? error : new Error(String(error)); }
  if (!toolPath().some((candidate) => existsSync(candidate) || !!Bun.which(candidate))) throw nativeError;
  const autoAdd = await prepareAutoAdd(settingsDir, sourcePaths);
  const temp = await mkdtemp(join(tmpdir(), "mkwii-wu8-"));
  try {
    const input = path || join(temp, "track.szs");
    if (!path) await writeFile(input, bytes || new Uint8Array());
    const output = join(temp, "track.u8");
    const args = [...(autoAdd ? ["--autoadd-path", autoAdd] : []), "DECOMPRESS", "--u8", "--overwrite", "--no-wildcards", "--dest", output, input];
    try { await run(args); }
    catch (error: any) {
      if (/needs Wiimm's SZS Tool/.test(error.message)) throw nativeError;
      if (!autoAdd && !/needs Wiimm's SZS Tool/.test(error.message))
        throw new Error(`${error.message}\nLoad an original Mario Kart Wii Common.szs or select its Race/Course folder to build the auto-add library.`);
      throw error;
    }
    const result = new Uint8Array(await readFile(output));
    if (!U8_MAGIC.every((v, i) => result[i] === v)) throw new Error("Wiimm's SZS Tool did not produce a U8 archive.");
    return result;
  } finally {
    if (!resolve(temp).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid temporary archive path");
    await rm(temp, { recursive: true, force: true });
  }
}
