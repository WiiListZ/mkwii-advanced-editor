// Native Windows Open/Save dialogs through PowerShell + WinForms.

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export interface FileFilter {
  name: string;
  extensions: string[]; // e.g. ["szs", "kmp"]
}

const psQuote = (s: string) => "'" + s.replace(/'/g, "''") + "'";

function filterString(filters: FileFilter[]): string {
  const all = [...filters, { name: "All files", extensions: ["*"] }];
  return all
    .map((f) => {
      const pattern = f.extensions.map((e) => (e === "*" ? "*.*" : `*.${e}`)).join(";");
      return `${f.name} (${pattern})|${pattern}`;
    })
    .join("|");
}

const SWP_NOSIZE = 0x0001, SWP_NOMOVE = 0x0002;
const HWND_TOPMOST = -1n;

let win32Lib: ReturnType<typeof loadWin32> | null | undefined;
function loadWin32() {
  const { dlopen, FFIType, ptr } = require("bun:ffi") as typeof import("bun:ffi");
  const lib = dlopen("user32.dll", {
    AllowSetForegroundWindow: { args: [FFIType.u32], returns: FFIType.i32 },
    FindWindowExW: { args: [FFIType.u64, FFIType.u64, FFIType.ptr, FFIType.ptr], returns: FFIType.u64 },
    GetWindowThreadProcessId: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.u32 },
    IsWindowVisible: { args: [FFIType.u64], returns: FFIType.i32 },
    SetWindowPos: { args: [FFIType.u64, FFIType.i64, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.u32], returns: FFIType.i32 },
    BringWindowToTop: { args: [FFIType.u64], returns: FFIType.i32 },
    SetForegroundWindow: { args: [FFIType.u64], returns: FFIType.i32 },
  });
  const dialogClassBuf = Buffer.from("#32770\0", "utf16le");
  const outPid = new Uint32Array(1);
  const bringToFront = (hwnd: bigint) => {
    lib.symbols.SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE);
    lib.symbols.BringWindowToTop(hwnd);
    lib.symbols.SetForegroundWindow(hwnd);
  };
  return {
    lib,
    allowForeground(pid: number) { lib.symbols.AllowSetForegroundWindow(pid); },
    raiseDialogForPid(pid: number): bigint {
      let hwnd = 0n;
      for (let i = 0; i < 250; i++) {
        hwnd = BigInt(lib.symbols.FindWindowExW(0n, hwnd, ptr(dialogClassBuf), null));
        if (!hwnd) break;
        lib.symbols.GetWindowThreadProcessId(hwnd, ptr(outPid));
        if (outPid[0] === pid && lib.symbols.IsWindowVisible(hwnd)) {
          bringToFront(hwnd);
          return hwnd;
        }
      }
      return 0n;
    },
    isVisible(hwnd: bigint) { return !!hwnd && !!lib.symbols.IsWindowVisible(hwnd); },
    bringToFront,
  };
}

function getWin32() {
  if (win32Lib !== undefined) return win32Lib;
  if (process.platform !== "win32") return (win32Lib = null);
  try { win32Lib = loadWin32(); } catch { win32Lib = null; }
  return win32Lib;
}

async function runPowerShell(script: string): Promise<string | null> {
  const sourceIcon = join(process.cwd(), "web", "icon.ico");
  const iconPath = existsSync(sourceIcon) ? sourceIcon : process.execPath;
  // A shown, zero-opacity TopMost owner placed at the cursor ensures the modal dialog inherits
  // WS_EX_TOPMOST on the active monitor instead of opening behind the WebView2 editor window.
  const full = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$pos = [System.Windows.Forms.Cursor]::Position
$owner = New-Object System.Windows.Forms.Form
$owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$owner.ShowInTaskbar = $false
$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$owner.Location = New-Object System.Drawing.Point($pos.X, $pos.Y)
$owner.Size = New-Object System.Drawing.Size(1, 1)
$owner.Opacity = 0
$owner.TopMost = $true
try { $owner.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon(${psQuote(iconPath)}) } catch {}
$owner.Show()
$owner.Activate()
try {
${script}
} finally {
  $owner.Close()
  $owner.Dispose()
}
`;
  const proc = Bun.spawn(["powershell.exe", "-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-Command", full], {
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  });
  let finished = false;
  const w32 = getWin32();
  if (w32 && proc.pid) {
    w32.allowForeground(proc.pid);
    void (async () => {
      for (let i = 0; i < 1200 && !finished; i++) {
        await Bun.sleep(25);
        if (finished) return;
        const dlg = w32.raiseDialogForPid(proc.pid);
        if (dlg) {
          // Common Item Dialogs run their own SetWindowPos pass shortly after becoming visible;
          // re-apply TopMost over the first ~300ms so neither SaveFileDialog nor WebView2 drops it behind.
          for (let k = 0; k < 6 && !finished; k++) {
            await Bun.sleep(50);
            if (!finished && w32.isVisible(dlg)) w32.bringToFront(dlg);
          }
          return;
        }
      }
    })();
  }
  let stdout = "", stderr = "", code = 1;
  try {
    [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
    ]);
  } finally {
    finished = true;
  }
  if (code !== 0) throw new Error(stderr.trim() || "Windows dialog could not be opened");
  const out = stdout.trim();
  return out || null;
}

export function openDialog(filters: FileFilter[], title = "Open file"): Promise<string | null> {
  if (process.platform !== "win32") return Promise.resolve(null);
  return runPowerShell(`
$d = New-Object System.Windows.Forms.OpenFileDialog
$d.Title = ${psQuote(title)}
$d.Filter = ${psQuote(filterString(filters))}
if ($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.FileName) }
`);
}

export function saveDialog(filters: FileFilter[], defaultName = "", title = "Save file"): Promise<string | null> {
  if (process.platform !== "win32") return Promise.resolve(null);
  const dir = defaultName.includes("\\") ? defaultName.slice(0, defaultName.lastIndexOf("\\")) : "";
  const name = defaultName.includes("\\") ? defaultName.slice(defaultName.lastIndexOf("\\") + 1) : defaultName;
  return runPowerShell(`
$d = New-Object System.Windows.Forms.SaveFileDialog
$d.Title = ${psQuote(title)}
$d.Filter = ${psQuote(filterString(filters))}
$d.FileName = ${psQuote(name)}
${dir ? `$d.InitialDirectory = ${psQuote(dir)}` : ""}
$d.OverwritePrompt = $true
if ($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.FileName) }
`);
}

export function folderDialog(title = "Choose folder", initial = ""): Promise<string | null> {
  if (process.platform !== "win32") return Promise.resolve(null);
  return runPowerShell(`
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;

public static class NativeFolderPicker {
    [ComImport, Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
    private class FileOpenDialog { }

    [ComImport, Guid("D57C7288-D4AD-4768-BE02-9D969532D960"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IFileOpenDialog {
        [PreserveSig] int Show(IntPtr owner);
        void SetFileTypes(uint count, IntPtr filters);
        void SetFileTypeIndex(uint index);
        void GetFileTypeIndex(out uint index);
        void Advise(IntPtr events, out uint cookie);
        void Unadvise(uint cookie);
        void SetOptions(uint options);
        void GetOptions(out uint options);
        void SetDefaultFolder(IShellItem folder);
        void SetFolder(IShellItem folder);
        void GetFolder(out IShellItem folder);
        void GetCurrentSelection(out IShellItem item);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
        void GetFileName(out IntPtr name);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
        void GetResult(out IShellItem item);
    }

    [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItem {
        void BindToHandler(IntPtr context, ref Guid handler, ref Guid iid, out IntPtr result);
        void GetParent(out IShellItem parent);
        void GetDisplayName(uint kind, out IntPtr name);
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    private static extern void SHCreateItemFromParsingName(string path, IntPtr context, ref Guid iid,
        [MarshalAs(UnmanagedType.Interface)] out IShellItem item);

    public static string Pick(string title, string initial, IntPtr owner) {
        var dialog = (IFileOpenDialog)new FileOpenDialog();
        string stage = "GetOptions";
        try {
            uint options;
            dialog.GetOptions(out options);
            stage = "SetOptions";
            dialog.SetOptions(options | 0x20 | 0x40); // FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM
            stage = "SetTitle";
            dialog.SetTitle(title);
            if (Directory.Exists(initial)) {
                stage = "SHCreateItemFromParsingName";
                var iid = new Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE");
                IShellItem folder;
                SHCreateItemFromParsingName(initial.Replace('/', (char)92), IntPtr.Zero, ref iid, out folder);
                try { stage = "SetFolder"; dialog.SetFolder(folder); }
                finally { Marshal.ReleaseComObject(folder); }
            }
            stage = "Show";
            int resultCode = dialog.Show(owner);
            if (resultCode == unchecked((int)0x800704C7)) return null;
            if (resultCode != 0) Marshal.ThrowExceptionForHR(resultCode);
            IShellItem result;
            dialog.GetResult(out result);
            try {
                IntPtr name;
                result.GetDisplayName(0x80058000, out name); // SIGDN_FILESYSPATH
                try { return Marshal.PtrToStringUni(name); }
                finally { Marshal.FreeCoTaskMem(name); }
            } finally { Marshal.ReleaseComObject(result); }
        } catch (Exception error) { throw new Exception(stage + ": " + error.Message, error); }
        finally { Marshal.ReleaseComObject(dialog); }
    }
}
'@
$path = [NativeFolderPicker]::Pick(${psQuote(title)}, ${psQuote(initial)}, $owner.Handle)
if ($path) { [Console]::Out.Write($path) }
`);
}

// The only web addresses the UI may open in the browser: the project's GitHub pages (the editor and
// its object-info repository) and its Discord invitation.
export function isAllowedUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    if (url.host === "github.com") return /^\/WiiListZ\/mkwii-advanced-editor(-object-info)?(\/|$)/i.test(url.pathname);
    return url.host === "discord.gg" && url.pathname === "/wrDyU9E7zs";
  } catch { return false; }
}

// Opens a page in the default browser (arguments are passed as an array: no shell parsing).
export function openInBrowser(url: string) {
  if (process.platform !== "win32" || !isAllowedUrl(url)) return false;
  Bun.spawn(["rundll32.exe", "url.dll,FileProtocolHandler", url], { stdout: "ignore", stderr: "ignore", windowsHide: true });
  return true;
}

export function revealInExplorer(path: string) {
  if (process.platform !== "win32" || !path) return;
  // Paths coming from the web UI use forward slashes. Explorer's /select parser needs a native
  // absolute path, including when the file is on another drive or its folder contains spaces.
  const target = resolve(path);
  if (!existsSync(target)) throw new Error("The file or folder no longer exists");
  Bun.spawn(["explorer.exe", `/select,${target}`], { stdout: "ignore", stderr: "ignore", windowsHide: true });
}
