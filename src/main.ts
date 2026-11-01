// MKWii Advanced Editor - desktop entry point.
// Starts the local server in a worker and opens the native window (WebView2).
// Usage:  MKWiiAdvancedEditor.exe [track.szs] [--browser | --server-only]

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyGpuBackend, relaunchWithNextBackend } from "./gpu-fallback.ts";

const args = process.argv.slice(2);
const browserMode = args.includes("--browser");
const serverOnly = args.includes("--server-only");
const fileArg = args.find((a) => !a.startsWith("--") && /\.(szs|wlz|wbz|wu8|arc|carc|kmp|kcl|brres|bmg|breff|breft|brstm|brsar|bin|xml)$/i.test(a));
const token = crypto.randomUUID();

// Inside a compiled executable the worker is an embedded entry point addressed by its relative name;
// when running from source it is resolved next to this file.
const compiled = /~BUN|%7EBUN/.test(import.meta.url);
const windowUrlIndex = args.indexOf("--window-url");
const sharedUrl = windowUrlIndex < 0 ? null : args[windowUrlIndex + 1];
let worker: Worker | null = null;
let url: string;
if (sharedUrl) {
  const address = new URL(sharedUrl);
  if (address.protocol !== "http:" || address.hostname !== "127.0.0.1" || !address.searchParams.get("t")) throw new Error("Invalid editor window address");
  url = address.href;
} else {
  worker = new Worker(compiled ? "./server.ts" : new URL("./server.ts", import.meta.url).href);

  const port: number = await new Promise((res, rej) => {
    // First launch may need to unpack the included command-line tools on a slow disk.
    const timer = setTimeout(() => rej(new Error("The local server did not start")), 60000);
    worker!.onmessage = (e) => {
      if (e.data?.type === "ready") { clearTimeout(timer); res(e.data.port); }
      if (e.data?.type === "error") rej(new Error(e.data.message));
    };
    worker!.onerror = (e) => rej(new Error("Server worker failed: " + e.message));
    worker!.postMessage({ type: "start", token, settingsDir: process.env.MKWII_SETTINGS_DIR,
      updateExecutable: compiled ? process.execPath : null,
      windowCommand: !browserMode && !serverOnly ? (compiled ? [process.execPath] : [process.execPath, fileURLToPath(import.meta.url)]) : null });
  });

  const params = new URLSearchParams({ t: token });
  if (fileArg) params.set("open", resolve(fileArg));
  url = `http://127.0.0.1:${port}/?${params}`;
}

async function finishServer() {
  if (!worker) return;
  await new Promise<void>((done) => {
    worker!.onmessage = (e) => { if (e.data?.type === "windows-closed") done(); };
    worker!.postMessage({ type: "owner-closed" });
  });
  worker.terminate();
}

function openInBrowser() {
  // Edge in "app" mode (window without tabs); falls back to the default browser.
  try {
    Bun.spawn(["cmd", "/c", "start", "", "msedge", `--app=${url}`], { stdout: "ignore", stderr: "ignore" });
  } catch {
    Bun.spawn(["cmd", "/c", "start", "", url]);
  }
  console.log(`MKWii Advanced Editor running at: ${url}`);
  console.log("Press Ctrl+C to quit.");
}

if (serverOnly) {
  console.log(url);
} else if (browserMode) {
  openInBrowser();
} else {
  try {
    const gpuLevel = applyGpuBackend();
    const { Webview, SizeHint } = await import("webview-bun");
    const webview = new Webview(false, { width: 1600, height: 950, hint: SizeHint.NONE });
    webview.title = "MKWii Advanced Editor";
    webview.bind("__nativeEditorWindow", () => true);
    // Integrated title bar: the UI draws minimize / maximize / close and calls back here.
    let userClosed: (() => boolean) | null = null;
    try {
      const { makeFrameless, userClosedWindow } = await import("./window.ts");
      const control = makeFrameless(webview.unsafeWindowHandle);
      if (control) {
        webview.bind("__winctl", (action: string, arg?: string) => {
          if (action === "title") { webview.title = arg || "MKWii Advanced Editor"; return; }
          return control(action, arg);
        });
        userClosed = userClosedWindow;
      }
    } catch (err) {
      console.error("Frameless window not available:", err);
    }
    webview.navigate(url);
    webview.run(); // blocks until the window is closed
    // The window ended by itself: the page crashed (graphics driver). Try another backend.
    if (userClosed && !userClosed()) {
      const replacement = relaunchWithNextBackend(gpuLevel, args, compiled);
      // A child owns a lease on the shared server. Keep it until its graphics retry closes too.
      if (!worker && replacement) await replacement.exited;
    }
    await finishServer();
    process.exit(0);
  } catch (err) {
    console.error("Could not open the native window (WebView2):", err);
    explainBrowserFallback(err);
    openInBrowser();
  }
}

// The native window uses libwebview.dll, which needs the Microsoft Visual C++ runtime (x64) and the
// WebView2 runtime. When it cannot start, the editor still works in Microsoft Edge; say why.
function explainBrowserFallback(err: unknown) {
  if (process.platform !== "win32") return;
  try {
    const { dlopen, FFIType, ptr } = require("bun:ffi");
    const user32 = dlopen("user32.dll", { MessageBoxW: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.i32 } });
    const wide = (s: string) => ptr(Buffer.from(s + "\0", "utf16le"));
    const text = [
      "The editor window could not start, so MKWii Advanced Editor opens in Microsoft Edge instead.",
      "",
      "To use the normal window, install the Microsoft Visual C++ Redistributable (x64):",
      "https://aka.ms/vs/17/release/vc_redist.x64.exe",
      "and make sure the Microsoft Edge WebView2 Runtime is installed (it is part of Windows 11).",
      "",
      `Details: ${err instanceof Error ? err.message : String(err)}`,
    ].join("\n");
    user32.symbols.MessageBoxW(null, wide(text), wide("MKWii Advanced Editor"), 0x40 /* MB_ICONINFORMATION */);
    user32.close();
  } catch { /* the console message is enough */ }
}

