// Builds the standalone Windows executable: release/MKWiiAdvancedEditor.exe

import { dirname, join, resolve } from "node:path";
import { closeSync, existsSync, openSync } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { prepareCompressedRuntime } from "./prepare-runtime.ts";

const root = join(import.meta.dir, "..");
const outIndex = process.argv.indexOf("--outfile");
if (outIndex >= 0 && !process.argv[outIndex + 1]) throw new Error("--outfile requires a path");
const exePath = outIndex < 0 ? join(root, "release/MKWiiAdvancedEditor.exe") : resolve(process.argv[outIndex + 1]);
const compressRuntime = !process.argv.includes("--uncompressed-runtime");
if (existsSync(exePath)) {
  try {
    closeSync(openSync(exePath, "r+"));
  } catch (err: any) {
    console.error(
      `Cannot overwrite ${exePath} (${err?.code || "locked"}): MKWiiAdvancedEditor.exe is still running.\n` +
      `Close all open editor windows first, or run: taskkill /F /IM MKWiiAdvancedEditor.exe`,
    );
    process.exit(1);
  }
}

const run = async (cmd: string[]) => {
  const p = Bun.spawn(cmd, { cwd: root, stdout: "inherit", stderr: "inherit" });
  if ((await p.exited) !== 0) process.exit(1);
};

// The executable is built on the baseline runtime (runs on every x64 CPU; the default one needs AVX2).
// It is downloaded here, checked against the release checksums and passed to `bun build`, instead of
// letting `bun build --target` download it: on GitHub runners moving that download into Bun's cache
// fails ("Failed to move cross-compiled bun binary into cache directory", ENOENT).
async function baselineRuntime() {
  const name = "bun-windows-x64-baseline";
  const dir = join(root, ".cache", `${name}-v${Bun.version}`);
  const exe = join(dir, name, "bun.exe");
  if (await Bun.file(exe).exists()) return exe;
  const base = `https://github.com/oven-sh/bun/releases/download/bun-v${Bun.version}`;
  const fetchOk = async (url: string) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
    return res;
  };
  const sums = await (await fetchOk(`${base}/SHASUMS256.txt`)).text();
  const expected = sums.match(new RegExp(`^([0-9a-f]{64})\\s+${name}\\.zip$`, "m"))?.[1];
  if (!expected) throw new Error(`${name}.zip is not listed in SHASUMS256.txt of Bun ${Bun.version}`);
  const zip = new Uint8Array(await (await fetchOk(`${base}/${name}.zip`)).arrayBuffer());
  const actual = new Bun.CryptoHasher("sha256").update(zip).digest("hex");
  if (actual !== expected) throw new Error(`${name}.zip checksum mismatch (expected ${expected}, got ${actual})`);
  await mkdir(dir, { recursive: true });
  const zipPath = join(dir, `${name}.zip`);
  await Bun.write(zipPath, zip);
  await run(["powershell", "-NoProfile", "-NonInteractive", "-Command",
    `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${dir}' -Force`]);
  if (!(await Bun.file(exe).exists())) throw new Error(`bun.exe not found in ${name}.zip`);
  return exe;
}

await run(["bun", "run", "scripts/build-frontend.ts", "--release"]);
await mkdir(dirname(exePath), { recursive: true });
const baseline = await baselineRuntime();
const runtime = compressRuntime ? await prepareCompressedRuntime(root, baseline, run) : baseline;
await run([
  "bun", "build", "--compile", "--minify",
  "--target=bun-windows-x64-baseline",
  `--compile-executable-path=${runtime}`,
  "--windows-hide-console",
  "src/main.ts", "src/server.ts",
  "--outfile", exePath,
]);
// App icon (the default kart). Bun's --windows-icon fails on some versions, so the icon resource
// is written with the Win32 API; the script keeps the app data Bun appends to the executable.
if (!compressRuntime) await run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/set-exe-icon.ps1",
  "-Exe", exePath, "-Icon", "web/icon.ico"]);
// Mark the executable as a GUI application (PE subsystem 2) so no console window appears.
// Bun's --windows-hide-console alone still leaves a terminal window open with Windows Terminal.
// Patch the two header bytes in place. Reading the entire executable through
// Bun.file can leave a mapped file view that locks a subsequent rewrite on Windows.
const handle = await open(exePath, "r+");
let exeSize: number;
try {
  const header = Buffer.alloc(64);
  await handle.read(header, 0, header.length, 0);
  const peOffset = header.readUInt32LE(0x3c), signature = Buffer.alloc(4);
  await handle.read(signature, 0, signature.length, peOffset);
  if (header.readUInt16LE(0) !== 0x5a4d || signature.readUInt32LE(0) !== 0x00004550) throw new Error("Not a PE file");
  await handle.write(Buffer.from([2, 0]), 0, 2, peOffset + 24 + 68);
  exeSize = (await handle.stat()).size;
} finally {
  await handle.close();
}

console.log(`Executable created: ${exePath} (${(exeSize / 1_000_000).toFixed(1)} MB)`);
