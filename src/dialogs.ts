// Native Windows Open/Save dialogs through PowerShell + WinForms.

import { existsSync } from "node:fs";
import { join } from "node:path";

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

async function runPowerShell(script: string): Promise<string | null> {
  const sourceIcon = join(process.cwd(), "web", "icon.ico");
  const iconPath = existsSync(sourceIcon) ? sourceIcon : process.execPath;
  const full = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon(${psQuote(iconPath)})
${script}
$owner.Dispose()
`;
  const proc = Bun.spawn(["powershell.exe", "-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-Command", full], {
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
  ]);
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
  Bun.spawn(["explorer.exe", `/select,${path}`], { stdout: "ignore", stderr: "ignore", windowsHide: true });
}
