# Writes an .ico into a Windows executable's resources (RT_ICON + RT_GROUP_ICON) with the
# Win32 UpdateResource API. Used by scripts/build.ts because `bun build --windows-icon`
# fails on some Bun versions. The icons the Bun runtime already carries are removed first:
# its named icon group sorts before ours, and Windows (Explorer, browsers' download lists)
# shows the first group, which would point at the wrong images.
param([Parameter(Mandatory = $true)][string]$Exe, [Parameter(Mandatory = $true)][string]$Icon)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;

public static class ExeIcon {
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern IntPtr BeginUpdateResource(string file, bool deleteExisting);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool UpdateResource(IntPtr handle, IntPtr type, IntPtr name, ushort language, byte[] data, uint size);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool EndUpdateResource(IntPtr handle, bool discard);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern IntPtr LoadLibraryEx(string file, IntPtr reserved, uint flags);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern IntPtr FindResource(IntPtr module, IntPtr name, IntPtr type);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool FreeLibrary(IntPtr module);
  delegate bool EnumNameProc(IntPtr module, IntPtr type, IntPtr name, IntPtr param);
  delegate bool EnumLangProc(IntPtr module, IntPtr type, IntPtr name, ushort language, IntPtr param);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
  static extern bool EnumResourceNames(IntPtr module, IntPtr type, EnumNameProc callback, IntPtr param);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
  static extern bool EnumResourceLanguages(IntPtr module, IntPtr type, IntPtr name, EnumLangProc callback, IntPtr param);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool UpdateResource(IntPtr handle, IntPtr type, string name, ushort language, byte[] data, uint size);

  // A resource name is either a number (MAKEINTRESOURCE) or a string.
  class Entry { public int Type; public int Id; public string Name; public ushort Language; }

  static System.Collections.Generic.List<Entry> Existing(string exe, int[] types) {
    var found = new System.Collections.Generic.List<Entry>();
    IntPtr module = LoadLibraryEx(exe, IntPtr.Zero, 2 /* LOAD_LIBRARY_AS_DATAFILE */);
    if (module == IntPtr.Zero) throw new Exception("Cannot read the executable resources: " + Marshal.GetLastWin32Error());
    try {
      foreach (int type in types) {
        EnumResourceNames(module, (IntPtr)type, (m, t, name, p) => {
          bool isId = ((long)name >> 16) == 0;
          int id = isId ? (int)(long)name : 0;
          string text = isId ? null : Marshal.PtrToStringUni(name);
          EnumResourceLanguages(m, t, name, (m2, t2, n2, language, p2) => {
            found.Add(new Entry { Type = type, Id = id, Name = text, Language = language });
            return true;
          }, IntPtr.Zero);
          return true;
        }, IntPtr.Zero);
      }
    } finally { FreeLibrary(module); }
    return found;
  }

  public static int GroupCount(string exe) { return Existing(exe, new[] { 14 }).Count; }

  // Data appended after the last PE section (Bun stores the bundled app there). UpdateResource
  // rewrites the file without it, so it is put back afterwards.
  static byte[] Overlay(string exe) {
    byte[] pe = File.ReadAllBytes(exe);
    int header = BitConverter.ToInt32(pe, 0x3C);
    int sections = BitConverter.ToUInt16(pe, header + 6), optional = BitConverter.ToUInt16(pe, header + 20);
    int table = header + 24 + optional;
    long end = 0;
    for (int i = 0; i < sections; i++) {
      int s = table + i * 40;
      long raw = BitConverter.ToUInt32(pe, s + 20) + (long)BitConverter.ToUInt32(pe, s + 16);
      if (raw > end) end = raw;
    }
    byte[] overlay = new byte[Math.Max(0, pe.Length - end)];
    Array.Copy(pe, end, overlay, 0, overlay.Length);
    return overlay;
  }

  public static void Set(string exe, string ico) {
    byte[] overlay = Overlay(exe);
    SetIcon(exe, ico);
    if (overlay.Length > 0) using (FileStream stream = new FileStream(exe, FileMode.Append)) stream.Write(overlay, 0, overlay.Length);
    // Fail the build if Explorer would still see an executable without an icon group.
    IntPtr module = LoadLibraryEx(exe, IntPtr.Zero, 2 /* LOAD_LIBRARY_AS_DATAFILE */);
    if (module == IntPtr.Zero) throw new Exception("Cannot inspect the icon resource: " + Marshal.GetLastWin32Error());
    try {
      if (FindResource(module, (IntPtr)1, (IntPtr)14) == IntPtr.Zero)
        throw new Exception("The executable has no RT_GROUP_ICON resource");
    } finally { FreeLibrary(module); }
    int groups = GroupCount(exe);
    if (groups != 1) throw new Exception("The executable has " + groups + " icon groups; Windows would show the wrong one");
  }

  static void SetIcon(string exe, string ico) {
    byte[] file = File.ReadAllBytes(ico);
    int count = BitConverter.ToUInt16(file, 4);
    var old = Existing(exe, new[] { 14, 3 });
    IntPtr handle = BeginUpdateResource(exe, false);
    if (handle == IntPtr.Zero) throw new Exception("BeginUpdateResource failed: " + Marshal.GetLastWin32Error());
    foreach (Entry e in old) {
      bool removed = e.Name == null
        ? UpdateResource(handle, (IntPtr)e.Type, (IntPtr)e.Id, e.Language, null, 0)
        : UpdateResource(handle, (IntPtr)e.Type, e.Name, e.Language, null, 0);
      if (!removed) throw new Exception("Could not remove the runtime icon " + (e.Name ?? ("#" + e.Id)) + ": " + Marshal.GetLastWin32Error());
    }
    // GRPICONDIR: 6-byte header + 14 bytes per entry (the .ico entry with a resource id instead of an offset).
    byte[] group = new byte[6 + count * 14];
    Array.Copy(file, 0, group, 0, 6);
    for (int i = 0; i < count; i++) {
      int e = 6 + i * 16;
      int size = BitConverter.ToInt32(file, e + 8), offset = BitConverter.ToInt32(file, e + 12);
      byte[] image = new byte[size];
      Array.Copy(file, offset, image, 0, size);
      if (!UpdateResource(handle, (IntPtr)3, (IntPtr)(i + 1), 0, image, (uint)size)) throw new Exception("RT_ICON failed: " + Marshal.GetLastWin32Error());
      Array.Copy(file, e, group, 6 + i * 14, 12);
      BitConverter.GetBytes((ushort)(i + 1)).CopyTo(group, 6 + i * 14 + 12);
    }
    if (!UpdateResource(handle, (IntPtr)14, (IntPtr)1, 0, group, (uint)group.Length)) throw new Exception("RT_GROUP_ICON failed: " + Marshal.GetLastWin32Error());
    if (!EndUpdateResource(handle, false)) throw new Exception("EndUpdateResource failed: " + Marshal.GetLastWin32Error());
  }
}
'@

[ExeIcon]::Set((Resolve-Path $Exe).Path, (Resolve-Path $Icon).Path)
Write-Output "Icon set on $Exe"
