// Builds the standalone Windows executable: release/MKWiiAdvancedEditor.exe

import { join } from "node:path";
import { mkdir } from "node:fs/promises";

const root = join(import.meta.dir, "..");
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
await mkdir(join(root, "release"), { recursive: true });
await run([
  "bun", "build", "--compile", "--minify",
  "--target=bun-windows-x64-baseline",
  `--compile-executable-path=${await baselineRuntime()}`,
  "--windows-hide-console",
  "src/main.ts", "src/server.ts",
  "--outfile", "release/MKWiiAdvancedEditor.exe",
]);
// App icon (the default kart). Bun's --windows-icon fails on some versions, so the icon resource
// is written with the Win32 API; the script keeps the app data Bun appends to the executable.
await run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/set-exe-icon.ps1",
  "-Exe", "release/MKWiiAdvancedEditor.exe", "-Icon", "web/icon.ico"]);
// Mark the executable as a GUI application (PE subsystem 2) so no console window appears.
// Bun's --windows-hide-console alone still leaves a terminal window open with Windows Terminal.
const exePath = join(root, "release/MKWiiAdvancedEditor.exe");
const exe = new Uint8Array(await Bun.file(exePath).arrayBuffer());
const view = new DataView(exe.buffer);
const peOffset = view.getUint32(0x3c, true);
if (view.getUint32(peOffset, true) !== 0x00004550) throw new Error("Not a PE file");
view.setUint16(peOffset + 24 + 68, 2, true);
await Bun.write(exePath, exe);

console.log("Executable created: release/MKWiiAdvancedEditor.exe");
