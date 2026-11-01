// Frameless window on Windows: the native title bar is hidden and the UI draws its own
// (minimize / maximize / close, drag to move). The window keeps its normal style for Windows
// (sizing frame, maximize box), so Aero Snap, Win+arrow keys, snap layouts and drag-to-restore
// behave like any other window: WM_NCCALCSIZE simply makes the whole window client area.
// All calls run on the UI thread (inside webview.bind callbacks and the window procedure).

import { CFunction, dlopen, FFIType, JSCallback, ptr, toArrayBuffer, type Pointer } from "bun:ffi";

const GWL_STYLE = -16, GWLP_WNDPROC = -4;
const WS_CAPTION = 0x00c00000, WS_SYSMENU = 0x00080000, WS_THICKFRAME = 0x00040000;
const WS_MINIMIZEBOX = 0x00020000, WS_MAXIMIZEBOX = 0x00010000;
const SWP_NOSIZE = 0x1, SWP_NOMOVE = 0x2, SWP_NOZORDER = 0x4, SWP_FRAMECHANGED = 0x20;
const SW_SHOW = 5, SW_MAXIMIZE = 3, SW_MINIMIZE = 6, SW_RESTORE = 9;
const WM_MOVE = 0x0003, WM_SIZE = 0x0005, WM_ACTIVATE = 0x0006, WM_SETFOCUS = 0x0007;
const WM_CLOSE = 0x0010, WM_QUERYENDSESSION = 0x0011, WM_WINDOWPOSCHANGED = 0x0047;
const WM_NCCALCSIZE = 0x0083, WM_NCLBUTTONDOWN = 0x00a1, WM_MOVING = 0x0216, WM_APP_TITLE = 0x8001;
const HTCAPTION = 2;
// Hit-test codes for the resize edges drawn by the UI.
const HT: Record<string, number> = { left: 10, right: 11, top: 12, topleft: 13, topright: 14, bottom: 15, bottomleft: 16, bottomright: 17 };
const VK_LBUTTON = 0x01, VK_RBUTTON = 0x02, SM_SWAPBUTTON = 23;
const SM_CXFRAME = 32, SM_CYFRAME = 33, SM_CXPADDEDBORDER = 92, SM_CXICON = 11, SM_CXSMICON = 49;
const WM_SETICON = 0x0080, ICON_SMALL = 0, ICON_BIG = 1, IMAGE_ICON = 1, APP_ICON_ID = 1;
const DWMWA_WINDOW_CORNER_PREFERENCE = 33, DWMWCP_ROUND = 2;
const DWMWA_BORDER_COLOR = 34, DWMWA_COLOR_NONE = 0xfffffffe;
// ICoreWebView2ControllerVtbl slot 23 (offset 0xb8): NotifyParentWindowPositionChanged(This).
const CONTROLLER_NOTIFY_PARENT_POS_SLOT = 23;

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
const libraries: unknown[] = [];
const keep = <T extends { symbols: unknown }>(lib: T) => { libraries.push(lib); return lib.symbols as T["symbols"]; };

export function makeFrameless(hwnd: Pointer, webviewHandle?: Pointer | null, moduleAnchor?: Pointer | null): WindowControl | null {
  if (process.platform !== "win32" || !hwnd) return null;
  closeRequested = false;
  const user32 = keep(dlopen("user32.dll", {
    GetWindowLongPtrW: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i64 },
    SetWindowLongPtrW: { args: [FFIType.ptr, FFIType.i32, FFIType.i64], returns: FFIType.i64 },
    CallWindowProcW: { args: [FFIType.i64, FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.i64], returns: FFIType.i64 },
    SetWindowPos: { args: [FFIType.ptr, FFIType.ptr, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.u32], returns: FFIType.i32 },
    ShowWindow: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
    SetForegroundWindow: { args: [FFIType.ptr], returns: FFIType.i32 },
    GetForegroundWindow: { args: [], returns: FFIType.ptr },
    GetActiveWindow: { args: [], returns: FFIType.ptr },
    GetFocus: { args: [], returns: FFIType.ptr },
    IsChild: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    IsZoomed: { args: [FFIType.ptr], returns: FFIType.i32 },
    ReleaseCapture: { args: [], returns: FFIType.i32 },
    GetAsyncKeyState: { args: [FFIType.i32], returns: FFIType.i16 },
    SendMessageW: { args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.i64], returns: FFIType.i64 },
    PostMessageW: { args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.i64], returns: FFIType.i32 },
    SetWindowTextW: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    GetSystemMetrics: { args: [FFIType.i32], returns: FFIType.i32 },
    GetCursorPos: { args: [FFIType.ptr], returns: FFIType.i32 },
    SetCursorPos: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
    GetClientRect: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    ClientToScreen: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    // The resource name is MAKEINTRESOURCE(id): an integer, so it is not passed as a pointer.
    LoadImageW: { args: [FFIType.ptr, FFIType.u64, FFIType.u32, FFIType.i32, FFIType.i32, FFIType.u32], returns: FFIType.u64 },
  }));
  const kernel32 = keep(dlopen("kernel32.dll", {
    GetModuleHandleW: { args: [FFIType.ptr], returns: FFIType.ptr },
    GetModuleHandleExW: { args: [FFIType.u32, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    GetProcAddress: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.ptr },
  }));
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

  // Access libwebview's inner widget HWND and ICoreWebView2Controller* so moving or stripping
  // the window frame keeps WebView2's out-of-process hit-testing and popups aligned on screen.
  let getNativeHandle: ((w: Pointer, kind: number) => Pointer | null) | null = null;
  if (webviewHandle && moduleAnchor) {
    const outMod = new BigUint64Array(1);
    if (kernel32.GetModuleHandleExW(0x6, moduleAnchor, ptr(outMod)) && outMod[0]) {
      const symbolName = Buffer.from("webview_get_native_handle\0", "utf8");
      const fnAddr = kernel32.GetProcAddress(outMod[0], ptr(symbolName));
      if (fnAddr) {
        const fn = new CFunction({ ptr: fnAddr, args: [FFIType.ptr, FFIType.i32], returns: FFIType.ptr });
        libraries.push(fn);
        getNativeHandle = (w, kind) => fn(w, kind) as Pointer | null;
      }
    }
  }
  let widget: Pointer | null = null;
  let controller: Pointer | null = null;
  let notifyPositionChanged: ((ctrl: Pointer) => number) | null = null;
  const resolveHandles = () => {
    if (!getNativeHandle || !webviewHandle) return;
    if (!widget) widget = getNativeHandle(webviewHandle, 1);
    if (!controller) {
      controller = getNativeHandle(webviewHandle, 2);
      if (controller) {
        const vtblPtr = Number(new BigUint64Array(toArrayBuffer(controller, 0, 8))[0]) as Pointer;
        if (vtblPtr) {
          const notifyPtr = Number(new BigUint64Array(toArrayBuffer(vtblPtr, CONTROLLER_NOTIFY_PARENT_POS_SLOT * 8, 8))[0]) as Pointer;
          if (notifyPtr) {
            const fn = new CFunction({ ptr: notifyPtr, args: [FFIType.ptr], returns: FFIType.i32 });
            libraries.push(fn);
            notifyPositionChanged = (ctrl) => fn(ctrl) as number;
          }
        }
      }
    }
  };
  const notifyParentMoved = () => {
    resolveHandles();
    if (controller && notifyPositionChanged) notifyPositionChanged(controller);
  };

  const metric = (index: number) => (dpi ? dpi.GetSystemMetricsForDpi(index, dpi.GetDpiForWindow(hwnd)) : user32.GetSystemMetrics(index));
  const rect = new Int32Array(4);
  const point = new Int32Array(2);
  let titleBuf: Buffer | null = null;

  // Hide the native caption: the whole window becomes client area. A maximized window is
  // placed with its frame outside the monitor, so that part is trimmed off.
  const previous = BigInt(user32.GetWindowLongPtrW(hwnd, GWLP_WNDPROC));
  windowProc = new JSCallback((h: Pointer, msg: number, wParam: bigint, lParam: bigint) => {
    if (msg === WM_CLOSE || msg === WM_QUERYENDSESSION) closeRequested = true;
    if (msg === WM_APP_TITLE) {
      if (titleBuf) user32.SetWindowTextW(h, ptr(titleBuf));
      return 0n;
    }
    if (msg === WM_NCCALCSIZE && wParam) {
      if (user32.IsZoomed(h)) {
        const ncc = new Int32Array(toArrayBuffer(Number(lParam) as Pointer, 0, 16));
        const fx = metric(SM_CXFRAME) + metric(SM_CXPADDEDBORDER), fy = metric(SM_CYFRAME) + metric(SM_CXPADDEDBORDER);
        ncc[0] += fx; ncc[1] += fy; ncc[2] -= fx; ncc[3] -= fy;
      }
      return 0n;
    }
    // libwebview's webview_set_size calls SetFocus(m_window), sending WM_SETFOCUS, whereas its
    // window procedure only forwards WM_ACTIVATE to WebView2's MoveFocus. Hand focus back down.
    if (msg === WM_SETFOCUS) {
      if (user32.GetActiveWindow() === h || user32.GetForegroundWindow() === h) {
        user32.PostMessageW(h, WM_ACTIVATE, 1n, 0n);
      }
      return 0n;
    }
    if (msg === WM_MOVE || msg === WM_MOVING) {
      notifyParentMoved();
    }
    if (msg === WM_WINDOWPOSCHANGED) {
      const res = user32.CallWindowProcW(previous, h, msg, wParam, lParam);
      notifyParentMoved();
      return res;
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
  const syncWebview = () => {
    resolveHandles();
    // Removing the native caption changes the client area without changing the outer size.
    // Post WM_SIZE to both m_window and m_widget (so put_Bounds runs even when MoveWindow is a
    // same-size no-op), and notify WebView2 of the frame-shifted screen origin.
    if (user32.GetClientRect(hwnd, ptr(rect))) {
      const size = (BigInt((rect[3] - rect[1]) & 0xffff) << 16n) | BigInt((rect[2] - rect[0]) & 0xffff);
      user32.PostMessageW(hwnd, WM_SIZE, maximized() ? 2n : 0n, size);
      if (widget) user32.PostMessageW(widget, WM_SIZE, 0n, size);
    }
    notifyParentMoved();
    // libwebview forwards activation to WebView2's MoveFocus. Only repair focus when our own
    // window is in the foreground and focus is not already inside WebView2's child HWND.
    if (user32.GetForegroundWindow() === hwnd) {
      const focus = user32.GetFocus();
      if (!focus || focus === hwnd || !user32.IsChild(hwnd, focus)) {
        user32.PostMessageW(hwnd, WM_ACTIVATE, 1n, 0n);
      }
    }
  };
  // The native move/size loop: Windows handles snapping, drag-to-restore and edge resizing.
  // Because __winctl arrives over async IPC, verify the primary button is still held down so a
  // quick click+flick never enters Windows' modal xxxMoveSize loop after WM_LBUTTONUP passed.
  const nativeDrag = (hitTest: number) => {
    const primaryButton = user32.GetSystemMetrics(SM_SWAPBUTTON) ? VK_RBUTTON : VK_LBUTTON;
    if (!(user32.GetAsyncKeyState(primaryButton) & 0x8000)) return;
    const coords = user32.GetCursorPos(ptr(point)) ? ((BigInt(point[1] & 0xffff) << 16n) | BigInt(point[0] & 0xffff)) : 0n;
    user32.ReleaseCapture();
    user32.PostMessageW(hwnd, WM_NCLBUTTONDOWN, BigInt(hitTest), coords);
  };

  // Mouse look in the 3D view: the cursor is hidden while the right button is held, then put back
  // where it vanished. Done natively because the browser's pointer lock shows a "press Esc" banner.
  let savedCursor: [number, number] | null = null;

  return (action: string, arg?: string) => {
    switch (action) {
      case "title":
        titleBuf = Buffer.from((arg || "MKWii Advanced Editor") + "\0", "utf16le");
        user32.PostMessageW(hwnd, WM_APP_TITLE, 0n, 0n);
        return { ok: true };
      case "cursor-save": savedCursor = user32.GetCursorPos(ptr(point)) ? [point[0], point[1]] : null; return { ok: !!savedCursor };
      // arg: "fx,fy", the point as a fraction of the window's client area (the 3D view's centre).
      // Fractions do not depend on the display scaling or on where the cursor was saved.
      case "cursor-recenter": {
        const [fx, fy] = (arg || "0.5,0.5").split(",").map((v) => Math.min(1, Math.max(0, Number(v) || 0)));
        point[0] = 0; point[1] = 0;
        if (!user32.GetClientRect(hwnd, ptr(rect)) || !user32.ClientToScreen(hwnd, ptr(point))) return { ok: false };
        user32.SetCursorPos(point[0] + Math.round((rect[2] - rect[0]) * fx), point[1] + Math.round((rect[3] - rect[1]) * fy));
        return { ok: true };
      }
      case "cursor-restore": if (savedCursor) user32.SetCursorPos(savedCursor[0], savedCursor[1]); savedCursor = null; return { ok: true };
      case "minimize": user32.ShowWindow(hwnd, SW_MINIMIZE); break;
      // The launcher hides its console via STARTUPINFO. Explicitly show the editor window too:
      // an empty editor/generator never calls maximize and otherwise inherits SW_HIDE.
      case "show": user32.ShowWindow(hwnd, SW_SHOW); user32.SetForegroundWindow(hwnd); syncWebview(); break;
      case "ready": syncWebview(); break;
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
