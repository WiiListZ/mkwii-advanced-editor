// Frameless window on Windows: the native title bar is hidden and the UI draws its own
// (minimize / maximize / close, drag to move). The window keeps its normal style for Windows
// (sizing frame, maximize box), so Aero Snap, Win+arrow keys, snap layouts and drag-to-restore
// behave like any other window: WM_NCCALCSIZE simply makes the whole window client area.
// All calls run on the UI thread (inside webview.bind callbacks and the window procedure).

import { dlopen, FFIType, JSCallback, ptr, toArrayBuffer, type Pointer } from "bun:ffi";

const GWL_STYLE = -16, GWLP_WNDPROC = -4;
const WS_CAPTION = 0x00c00000, WS_SYSMENU = 0x00080000, WS_THICKFRAME = 0x00040000;
const WS_MINIMIZEBOX = 0x00020000, WS_MAXIMIZEBOX = 0x00010000;
const SWP_NOSIZE = 0x1, SWP_NOMOVE = 0x2, SWP_NOZORDER = 0x4, SWP_FRAMECHANGED = 0x20;
const SW_MAXIMIZE = 3, SW_MINIMIZE = 6, SW_RESTORE = 9;
const WM_NCCALCSIZE = 0x0083, WM_NCLBUTTONDOWN = 0x00a1, WM_CLOSE = 0x0010;
const HTCAPTION = 2;
// Hit-test codes for the resize edges drawn by the UI.
const HT: Record<string, number> = { left: 10, right: 11, top: 12, topleft: 13, topright: 14, bottom: 15, bottomleft: 16, bottomright: 17 };
const SM_CXFRAME = 32, SM_CYFRAME = 33, SM_CXPADDEDBORDER = 92, SM_CXICON = 11, SM_CXSMICON = 49;
const WM_SETICON = 0x0080, ICON_SMALL = 0, ICON_BIG = 1, IMAGE_ICON = 1, APP_ICON_ID = 1;
const DWMWA_WINDOW_CORNER_PREFERENCE = 33, DWMWCP_ROUND = 2;
const DWMWA_BORDER_COLOR = 34, DWMWA_COLOR_NONE = 0xfffffffe;

export interface WindowControl {
  (action: string, arg?: string): unknown;
}

// Kept alive for the lifetime of the window: Windows calls it for every message. The libraries
// are kept too: a collected dlopen() result frees its call stubs while they are still in use.
let windowProc: JSCallback | null = null;
// Set when the user (or Windows shutting down) asks the window to close. When the window ends
// without it, WebView2 crashed and main.ts starts again with another graphics backend.
let closeRequested = false;
export const userClosedWindow = () => closeRequested;
const WM_QUERYENDSESSION = 0x0011;
const libraries: unknown[] = [];
const keep = <T extends { symbols: unknown }>(lib: T) => { libraries.push(lib); return lib.symbols as T["symbols"]; };

export function makeFrameless(hwnd: Pointer): WindowControl | null {
  if (process.platform !== "win32" || !hwnd) return null;
  const user32 = keep(dlopen("user32.dll", {
    GetWindowLongPtrW: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i64 },
    SetWindowLongPtrW: { args: [FFIType.ptr, FFIType.i32, FFIType.i64], returns: FFIType.i64 },
    CallWindowProcW: { args: [FFIType.i64, FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.i64], returns: FFIType.i64 },
    SetWindowPos: { args: [FFIType.ptr, FFIType.ptr, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.u32], returns: FFIType.i32 },
    ShowWindow: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
    IsZoomed: { args: [FFIType.ptr], returns: FFIType.i32 },
    ReleaseCapture: { args: [], returns: FFIType.i32 },
    SendMessageW: { args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.i64], returns: FFIType.i64 },
    PostMessageW: { args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.i64], returns: FFIType.i32 },
    GetSystemMetrics: { args: [FFIType.i32], returns: FFIType.i32 },
    GetCursorPos: { args: [FFIType.ptr], returns: FFIType.i32 },
    SetCursorPos: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
    // The resource name is MAKEINTRESOURCE(id): an integer, so it is not passed as a pointer.
    LoadImageW: { args: [FFIType.ptr, FFIType.u64, FFIType.u32, FFIType.i32, FFIType.i32, FFIType.u32], returns: FFIType.u64 },
  }));
  const kernel32 = keep(dlopen("kernel32.dll", { GetModuleHandleW: { args: [FFIType.ptr], returns: FFIType.ptr } }));
  // Per-monitor DPI frame sizes (Windows 10 1607+), falling back to the system DPI ones.
  let dpi: { GetDpiForWindow: (h: Pointer) => number; GetSystemMetricsForDpi: (i: number, d: number) => number } | null = null;
  try {
    dpi = keep(dlopen("user32.dll", {
      GetDpiForWindow: { args: [FFIType.ptr], returns: FFIType.u32 },
      GetSystemMetricsForDpi: { args: [FFIType.i32, FFIType.u32], returns: FFIType.i32 },
    })) as any;
  } catch { /* older Windows */ }
  let dwm: { DwmSetWindowAttribute: (...a: any[]) => number } | null = null;
  try {
    dwm = keep(dlopen("dwmapi.dll", {
      DwmSetWindowAttribute: { args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
    })) as any;
  } catch { /* older Windows */ }

  const metric = (index: number) => (dpi ? dpi.GetSystemMetricsForDpi(index, dpi.GetDpiForWindow(hwnd)) : user32.GetSystemMetrics(index));

  // Hide the native caption: the whole window becomes client area. A maximized window is
  // placed with its frame outside the monitor, so that part is trimmed off.
  const previous = BigInt(user32.GetWindowLongPtrW(hwnd, GWLP_WNDPROC));
  windowProc = new JSCallback((h: Pointer, msg: number, wParam: bigint, lParam: bigint) => {
    if (msg === WM_CLOSE || msg === WM_QUERYENDSESSION) closeRequested = true;
    if (msg === WM_NCCALCSIZE && wParam) {
      if (user32.IsZoomed(h)) {
        const rect = new Int32Array(toArrayBuffer(Number(lParam) as Pointer, 0, 16));
        const fx = metric(SM_CXFRAME) + metric(SM_CXPADDEDBORDER), fy = metric(SM_CYFRAME) + metric(SM_CXPADDEDBORDER);
        rect[0] += fx; rect[1] += fy; rect[2] -= fx; rect[3] -= fy;
      }
      return 0n;
    }
    return user32.CallWindowProcW(previous, h, msg, wParam, lParam);
  }, { args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.i64], returns: FFIType.i64 });
  user32.SetWindowLongPtrW(hwnd, GWLP_WNDPROC, BigInt(windowProc.ptr as unknown as number));

  // Normal window style, so Windows offers snapping and maximizing as for any other window.
  const style = BigInt(user32.GetWindowLongPtrW(hwnd, GWL_STYLE));
  user32.SetWindowLongPtrW(hwnd, GWL_STYLE, style | BigInt(WS_CAPTION | WS_SYSMENU | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX));
  user32.SetWindowPos(hwnd, null, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED);
  if (dwm) {
    const pref = new Int32Array([DWMWCP_ROUND]);
    dwm.DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, ptr(pref), 4);
    const borderColor = new Uint32Array([DWMWA_COLOR_NONE]);
    dwm.DwmSetWindowAttribute(hwnd, DWMWA_BORDER_COLOR, ptr(borderColor), 4);
  }

  // Window / taskbar / Alt+Tab icon: the icon group stored in the executable (scripts/set-exe-icon.ps1).
  // The window class uses the generic application icon, so it is set explicitly.
  const exe = kernel32.GetModuleHandleW(null);
  for (const [which, size] of [[ICON_BIG, SM_CXICON], [ICON_SMALL, SM_CXSMICON]] as const) {
    const icon = exe ? BigInt(user32.LoadImageW(exe, BigInt(APP_ICON_ID), IMAGE_ICON, metric(size), metric(size), 0)) : 0n;
    if (icon) user32.SendMessageW(hwnd, WM_SETICON, BigInt(which), icon);
  }

  const maximized = () => !!user32.IsZoomed(hwnd);
  // The native move/size loop: Windows handles snapping, drag-to-restore and edge resizing.
  const nativeDrag = (hitTest: number) => {
    user32.ReleaseCapture();
    user32.SendMessageW(hwnd, WM_NCLBUTTONDOWN, BigInt(hitTest), 0n);
  };

  // Mouse look in the 3D view: the cursor is hidden while the right button is held, then put back
  // where it vanished. Done natively because the browser's pointer lock shows a "press Esc" banner.
  const point = new Int32Array(2);
  let savedCursor: [number, number] | null = null;

  return (action: string, arg?: string) => {
    switch (action) {
      case "cursor-save": savedCursor = user32.GetCursorPos(ptr(point)) ? [point[0], point[1]] : null; return { ok: !!savedCursor };
      // arg: "dx,dy", the offset in screen pixels from the saved position (the 3D view's centre).
      case "cursor-recenter": {
        if (!savedCursor) return { ok: false };
        const [dx, dy] = (arg || "0,0").split(",").map((v) => Math.round(Number(v)) || 0);
        user32.SetCursorPos(savedCursor[0] + dx, savedCursor[1] + dy);
        return { ok: true };
      }
      case "cursor-restore": if (savedCursor) user32.SetCursorPos(savedCursor[0], savedCursor[1]); savedCursor = null; return { ok: true };
      case "minimize": user32.ShowWindow(hwnd, SW_MINIMIZE); break;
      case "maximize": user32.ShowWindow(hwnd, SW_MAXIMIZE); break;
      case "restore": user32.ShowWindow(hwnd, SW_RESTORE); break;
      case "toggle": user32.ShowWindow(hwnd, maximized() ? SW_RESTORE : SW_MAXIMIZE); break;
      case "close": user32.PostMessageW(hwnd, WM_CLOSE, 0n, 0n); break;
      case "drag": nativeDrag(HTCAPTION); break;
      case "resize": if (!maximized() && HT[arg ?? ""]) nativeDrag(HT[arg!]); break;
      case "state": break;
    }
    return { maximized: maximized() };
  };
}
