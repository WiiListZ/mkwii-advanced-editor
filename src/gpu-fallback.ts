// Graphics fallback for the WebView2 window. Some WebView2 runtime / GPU driver combinations
// crash the page as soon as WebGL draws with the default Direct3D 11 backend
// (STATUS_ACCESS_VIOLATION, then a white window). When the window dies without the user closing
// it, the editor starts again with the next backend: Vulkan, then software rendering. The working
// choice is remembered until the WebView2 runtime is updated, then Direct3D 11 is tried again.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BACKENDS = [
  { name: "Direct3D 11", flags: "" },
  { name: "Vulkan", flags: "--use-angle=vulkan" },
  { name: "software", flags: "--use-angle=swiftshader --enable-unsafe-swiftshader" },
];

const settingsDir = process.env.MKWII_SETTINGS_DIR || join(process.env.APPDATA || process.env.HOME || ".", "MKWiiAdvancedEditor");
const stateFile = join(settingsDir, "gpu.json");

// Version of the installed WebView2 runtime (machine-wide or per-user install).
function runtimeVersion() {
  const key = "Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
  for (const root of [`HKLM\\SOFTWARE\\WOW6432Node\\${key}`, `HKLM\\SOFTWARE\\${key}`, `HKCU\\Software\\${key}`]) {
    try {
      const out = Bun.spawnSync(["reg", "query", root, "/v", "pv"], { stdout: "pipe", stderr: "ignore", windowsHide: true }).stdout.toString();
      const version = out.match(/pv\s+REG_SZ\s+(\S+)/)?.[1];
      if (version) return version;
    } catch { /* not installed there */ }
  }
  return "unknown";
}

const runtime = process.platform === "win32" ? runtimeVersion() : "";
const userFlags = process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS;

function savedLevel() {
  try {
    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    return state.runtime === runtime ? Math.min(BACKENDS.length - 1, Math.max(0, state.level | 0)) : 0;
  } catch { return 0; }
}

function saveLevel(level: number) {
  try {
    if (!existsSync(settingsDir)) mkdirSync(settingsDir, { recursive: true });
    writeFileSync(stateFile, JSON.stringify({ level, backend: BACKENDS[level].name, runtime }, null, 2));
  } catch { /* the fallback still works for this launch */ }
}

// Chooses the backend for this launch and passes it to WebView2 (read when the window is created).
export function applyGpuBackend() {
  const forced = process.env.MKWII_GPU_LEVEL;
  const level = forced !== undefined ? Math.min(BACKENDS.length - 1, Math.max(0, Number(forced) | 0)) : savedLevel();
  const flags = BACKENDS[level].flags;
  if (flags) {
    process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = userFlags ? `${userFlags} ${flags}` : flags;
  }
  return level;
}

// Called when the window ended without the user closing it: starts the editor again with the
// next backend. Returns false when there is nothing left to try.
export function relaunchWithNextBackend(level: number, args: string[], compiled: boolean) {
  const next = level + 1;
  if (next >= BACKENDS.length) return false;
  saveLevel(next);
  console.error(`The window stopped with ${BACKENDS[level].name} graphics; starting again with ${BACKENDS[next].name}.`);
  const command = compiled ? [process.execPath, ...args] : [process.execPath, process.argv[1], ...args];
  const env: Record<string, string | undefined> = { ...process.env, MKWII_GPU_LEVEL: String(next), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: userFlags };
  if (userFlags === undefined) delete env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS;
  Bun.spawn(command, { env, stdio: ["ignore", "ignore", "ignore"] }).unref();
  return true;
}
