import { expect, test } from "bun:test";
import { dlopen, FFIType, ptr } from "bun:ffi";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { EditorWindows } from "../src/editor-windows.ts";
import { applyGpuBackend } from "../src/gpu-fallback.ts";
import { makeFrameless } from "../src/window.ts";

test("the shared server waits for every native editor process after Home closes", async () => {
  const temp = mkdtempSync(join(tmpdir(), "mkwii-window-host-"));
  try {
    const script = join(temp, "window.ts");
    await Bun.write(script, 'await Bun.write(process.argv.at(-1), "window started"); await Bun.sleep(250);');
    const host = new EditorWindows([process.execPath, script]);
    const a = join(temp, "a.txt"), b = join(temp, "b.txt");
    expect(host.open(a)).toEqual({ native: true });
    host.open(b);
    expect(host.count).toBe(2);
    let closed = false;
    const stopped = host.whenIdle().then(() => { closed = true; });
    await Bun.sleep(30);
    expect(closed).toBe(false);
    await stopped;
    expect(host.count).toBe(0);
    expect(readFileSync(a, "utf8")).toBe("window started");
    expect(readFileSync(b, "utf8")).toBe("window started");
    expect(new EditorWindows().open("http://127.0.0.1/")).toEqual({ url: "http://127.0.0.1/" });
  } finally {
    if (!resolve(temp).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe test cleanup");
    rmSync(temp, { recursive: true, force: true });
  }
});

test("applyGpuBackend isolates WebView2 user data per settings folder and fallback backend", () => {
  const prevDir = process.env.MKWII_SETTINGS_DIR;
  const prevLevel = process.env.MKWII_GPU_LEVEL;
  const prevFolder = process.env.WEBVIEW2_USER_DATA_FOLDER;
  const prevFlags = process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS;
  const temp = mkdtempSync(join(tmpdir(), "mkwii-gpu-env-"));
  try {
    process.env.MKWII_SETTINGS_DIR = temp;
    process.env.MKWII_GPU_LEVEL = "0";
    expect(applyGpuBackend()).toBe(0);
    expect(process.env.WEBVIEW2_USER_DATA_FOLDER).toBe(join(temp, "webview"));

    process.env.MKWII_GPU_LEVEL = "1";
    expect(applyGpuBackend()).toBe(1);
    expect(process.env.WEBVIEW2_USER_DATA_FOLDER).toBe(join(temp, "webview-1"));
    expect(process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS).toContain("--use-angle=vulkan");
  } finally {
    if (prevDir === undefined) delete process.env.MKWII_SETTINGS_DIR; else process.env.MKWII_SETTINGS_DIR = prevDir;
    if (prevLevel === undefined) delete process.env.MKWII_GPU_LEVEL; else process.env.MKWII_GPU_LEVEL = prevLevel;
    if (prevFolder === undefined) delete process.env.WEBVIEW2_USER_DATA_FOLDER; else process.env.WEBVIEW2_USER_DATA_FOLDER = prevFolder;
    if (prevFlags === undefined) delete process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS; else process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = prevFlags;
    if (resolve(temp).startsWith(resolve(tmpdir()) + sep)) rmSync(temp, { recursive: true, force: true });
  }
});

if (process.platform === "win32") {
  test("frameless window strips native frame before show, updates title safely, and ignores released drag IPC", () => {
    const user32 = dlopen("user32.dll", {
      CreateWindowExW: {
        args: [FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
        returns: FFIType.ptr,
      },
      DestroyWindow: { args: [FFIType.ptr], returns: FFIType.i32 },
      GetClientRect: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
      GetWindowRect: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
      SetWindowPos: { args: [FFIType.ptr, FFIType.ptr, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.u32], returns: FFIType.i32 },
      GetWindowTextW: { args: [FFIType.ptr, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
      PeekMessageW: { args: [FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.u32], returns: FFIType.i32 },
      TranslateMessage: { args: [FFIType.ptr], returns: FFIType.i32 },
      DispatchMessageW: { args: [FFIType.ptr], returns: FFIType.i64 },
      GetAsyncKeyState: { args: [FFIType.i32], returns: FFIType.i16 },
      GetSystemMetrics: { args: [FFIType.i32], returns: FFIType.i32 },
    });
    const cls = Buffer.from("STATIC\0", "utf16le");
    const initialTitle = Buffer.from("Test\0", "utf16le");
    const hwnd = user32.symbols.CreateWindowExW(0, ptr(cls), ptr(initialTitle), 0x00cf0000 /* WS_OVERLAPPEDWINDOW */, 100, 100, 800, 600, null, null, null, null);
    expect(hwnd).toBeTruthy();
    try {
      const control = makeFrameless(hwnd!);
      expect(control).toBeTruthy();
      // Sizing while hidden already gives a full-window frameless client area (sized to fit headless 1024x768 CI displays too).
      user32.symbols.SetWindowPos(hwnd, null, 0, 0, 900, 600, 0x16 /* SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE */);
      const client = new Int32Array(4), outer = new Int32Array(4);
      user32.symbols.GetClientRect(hwnd, ptr(client));
      user32.symbols.GetWindowRect(hwnd, ptr(outer));
      expect(client[2] - client[0]).toBe(outer[2] - outer[0]);
      expect(client[3] - client[1]).toBe(outer[3] - outer[1]);
      expect(client[2] - client[0]).toBe(900);
      expect(client[3] - client[1]).toBe(600);

      // Queued title updates apply cleanly through the message loop without nested JSCallback re-entrancy.
      control!("title", "Updated — MKWii Advanced Editor");
      const msg = new Uint8Array(48);
      while (user32.symbols.PeekMessageW(ptr(msg), hwnd, 0, 0, 1 /* PM_REMOVE */)) {
        user32.symbols.TranslateMessage(ptr(msg));
        user32.symbols.DispatchMessageW(ptr(msg));
      }
      const textBuf = Buffer.alloc(256);
      const len = user32.symbols.GetWindowTextW(hwnd, ptr(textBuf), 128);
      expect(textBuf.subarray(0, len * 2).toString("utf16le")).toBe("Updated — MKWii Advanced Editor");

      // When the primary mouse button is not held down, async drag/resize IPC must not queue WM_NCLBUTTONDOWN.
      const primary = user32.symbols.GetSystemMetrics(23) ? 0x02 : 0x01;
      if (!(user32.symbols.GetAsyncKeyState(primary) & 0x8000)) {
        control!("drag");
        control!("resize", "right");
        expect(user32.symbols.PeekMessageW(ptr(msg), hwnd, 0x00a1, 0x00a1, 1)).toBe(0);
      }
    } finally {
      user32.symbols.DestroyWindow(hwnd);
      user32.close();
    }
  });
}
