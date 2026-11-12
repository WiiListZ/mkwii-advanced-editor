// Builds vendor/ghost-path.exe: native/ghost-path/main.cc on Kinoko, a reimplementation of Mario Kart
// Wii's physics (https://github.com/vabold/Kinoko, MIT), at the commit pinned here.
//
// Needs git, CMake, and g++ 13 or newer with ninja (on Windows, MSYS2's UCRT64: pacman -S
// mingw-w64-ucrt-x86_64-gcc mingw-w64-ucrt-x86_64-ninja). The result is one static executable,
// committed like the other bundled tools, so the editor's own build does not need any of this.
//
//   bun run scripts/build-ghost-path.ts
import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export const KINOKO_COMMIT = "e16728c77e29ffb6e300e7060f8aa48610fe9c52";
const root = join(import.meta.dir, "..");
const source = join(root, ".cache", `kinoko-${KINOKO_COMMIT.slice(0, 12)}`);
const build = join(root, ".cache", "ghost-path-build");

const run = async (cmd: string[], cwd = root, env: Record<string, string | undefined> = process.env) => {
  const p = Bun.spawn(cmd, { cwd, env, stdout: "inherit", stderr: "inherit" });
  if ((await p.exited) !== 0) throw new Error(`Failed: ${cmd.join(" ")}`);
};

const tool = (name: string) => [Bun.which(name), `C:/msys64/ucrt64/bin/${name}.exe`].find((path) => !!path && existsSync(path));
const gxx = tool("g++"), ninja = tool("ninja");
const cmake = [Bun.which("cmake"), "C:/Program Files/CMake/bin/cmake.exe"].find((path) => !!path && existsSync(path));
if (!gxx || !ninja || !cmake) throw new Error("Needs g++ 13 or newer, ninja and CMake (see the top of this script)");

if (!existsSync(join(source, "source"))) {
  await mkdir(source, { recursive: true });
  await run(["git", "init", "-q"], source);
  await run(["git", "remote", "add", "origin", "https://github.com/vabold/Kinoko.git"], source);
  await run(["git", "fetch", "-q", "--depth", "1", "origin", KINOKO_COMMIT], source);
  await run(["git", "checkout", "-q", "FETCH_HEAD"], source);
}

// The compiler's own folder first: g++ runs its helpers from there.
const env = { ...process.env, PATH: `${join(gxx, "..")};${process.env.PATH || ""}` };
await run([cmake, "-S", join(root, "native", "ghost-path"), "-B", build, "-G", "Ninja", "-DCMAKE_BUILD_TYPE=Release",
  `-DCMAKE_CXX_COMPILER=${gxx}`, `-DCMAKE_MAKE_PROGRAM=${ninja}`, `-DKINOKO_DIR=${source.replace(/\\/g, "/")}`], root, env);
await run([cmake, "--build", build], root, env);
await copyFile(join(build, "ghost-path.exe"), join(root, "vendor", "ghost-path.exe"));
await copyFile(join(source, "LICENSE"), join(root, "vendor", "kinoko-LICENSE.txt"));
const hash = new Bun.CryptoHasher("sha256").update(await Bun.file(join(root, "vendor", "ghost-path.exe")).bytes()).digest("hex");
console.log(`vendor/ghost-path.exe built from Kinoko ${KINOKO_COMMIT}\nSHA-256 ${hash}: set GHOST_PATH_SHA256 in src/ghost-path.ts to it.`);
