// Compress the pinned Bun runtime before embedding the app. Packing the final
// executable would hide its .bun section and prevent Bun from finding the app.
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { unzipSync } from "fflate";
import { reservePESectionHeader } from "./pe-section-space.ts";

const UPX_VERSION = "5.3.0";
const UPX_ZIP_SHA256 = "d127996c76615e431be810e9c8d2910dbe3dd400600c5c0c50276fc5a17a9705";
const UPX_EXE_SHA256 = "ff30a651c9e41a2bbb363825fac9e7e23d92871c1ac82813a264e3b8d1cd302b";
const sha = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

async function upx(root: string) {
  const folder = join(root, ".cache", `upx-${UPX_VERSION}`);
  const executable = join(folder, `upx-${UPX_VERSION}-win64`, "upx.exe");
  if (await Bun.file(executable).exists() && sha(await readFile(executable)) === UPX_EXE_SHA256) return executable;
  const response = await fetch(`https://github.com/upx/upx/releases/download/v${UPX_VERSION}/upx-${UPX_VERSION}-win64.zip`);
  if (!response.ok) throw new Error(`Could not download UPX ${UPX_VERSION}: HTTP ${response.status}`);
  const zip = new Uint8Array(await response.arrayBuffer());
  if (sha(zip) !== UPX_ZIP_SHA256) throw new Error("UPX download checksum mismatch");
  for (const [name, data] of Object.entries(unzipSync(zip))) {
    const path = resolve(folder, name);
    if (!path.startsWith(resolve(folder) + sep) || name.includes("\\") || name.split("/").includes("..")) throw new Error("Invalid UPX archive path");
    if (name.endsWith("/")) await mkdir(path, { recursive: true });
    else { await mkdir(dirname(path), { recursive: true }); await writeFile(path, data); }
  }
  if (sha(await readFile(executable)) !== UPX_EXE_SHA256) throw new Error("UPX executable checksum mismatch");
  return executable;
}

export async function prepareCompressedRuntime(root: string, baseline: string, run: (args: string[]) => Promise<void>) {
  const icon = join(root, "web", "icon.ico");
  const inputs = JSON.stringify({ baseline: sha(await readFile(baseline)), icon: sha(await readFile(icon)),
    upx: UPX_VERSION, options: ["-1", "--lzma", "--compress-icons=0"], headerFormat: 1 });
  const key = sha(inputs).slice(0, 24), cache = join(root, ".cache", "packed-runtimes");
  const output = join(cache, `${key}.exe`), manifestPath = join(cache, `${key}.json`);
  const manifest = await Bun.file(manifestPath).json().catch(() => null);
  if (manifest?.inputs === inputs && await Bun.file(output).exists() && sha(await readFile(output)) === manifest.sha256) return output;
  await mkdir(cache, { recursive: true });
  const stage = await mkdtemp(join(cache, "prepare-"));
  try {
    const prepared = join(stage, "runtime.exe"), packed = join(stage, "packed.exe");
    await copyFile(baseline, prepared);
    // Win32 UpdateResource must run before UPX: changing packed resources can
    // invalidate the compressed loader even when the .bun payload is intact.
    await run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(root, "scripts", "set-exe-icon.ps1"), "-Exe", prepared, "-Icon", icon]);
    const packer = await upx(root);
    await run([packer, "-1", "--lzma", "--compress-icons=0", "-o", packed, prepared]);
    await run([packer, "--test", packed]);
    const padded = reservePESectionHeader(new Uint8Array(await readFile(packed)));
    const temporary = join(stage, "padded.exe");
    await writeFile(temporary, padded);
    await rename(temporary, output);
    await writeFile(manifestPath, JSON.stringify({ inputs, sha256: sha(padded) }));
    return output;
  } finally {
    if (!resolve(stage).startsWith(resolve(cache) + sep)) throw new Error("Unsafe runtime staging directory");
    await rm(stage, { recursive: true, force: true });
  }
}
