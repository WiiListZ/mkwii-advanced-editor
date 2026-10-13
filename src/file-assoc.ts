// Windows file association: tracks and archives (.szs / .wlz / .wbz / .wu8 / .kmp / .kcl) and the
// game files the editor can change on their own (models, text, effects, music) open in the editor.
// Everything goes under HKCU\Software\Classes, so no administrator rights are needed.
// Windows 10/11 keep the user's own default app choice: when another app is the default,
// the editor still appears in "Open with" and the user can pick it there once.

const APP_KEY = "HKCU\\Software\\Classes\\Applications\\MKWiiAdvancedEditor.exe";
// One ProgID per extension, so Explorer's "Type" column says what the file is: an SZS can hold
// a track, menus, characters or anything else, not only a track.
const TYPES: Record<string, string> = {
  ".szs": "Mario Kart Wii archive (SZS)",
  ".wlz": "Mario Kart Wii archive (WLZ)",
  ".wbz": "Mario Kart Wii archive (WBZ)",
  ".wu8": "Mario Kart Wii archive (WU8)",
  ".kmp": "Mario Kart Wii course data (KMP)",
  ".kcl": "Mario Kart Wii collision (KCL)",
  ".brres": "Wii model resource (BRRES)",
  ".bmg": "Wii game text (BMG)",
  ".breff": "Wii effect (BREFF)",
  ".breft": "Wii effect textures (BREFT)",
  ".brstm": "Wii music stream (BRSTM)",
  ".brsar": "Wii sound archive (BRSAR)",
};
export const ASSOCIATED_EXTENSIONS = Object.keys(TYPES);
const progId = (ext: string) => `MKWiiAdvancedEditor${ext}`;
// Earlier versions registered every extension under one "Mario Kart Wii track file" type.
const LEGACY_PROG_ID = "MKWiiAdvancedEditor.Track";

// The path of the running executable, or null when the editor runs from source (bun.exe).
function editorExe() {
  const compiled = /~BUN|%7EBUN/.test(import.meta.url);
  return compiled && process.platform === "win32" ? process.execPath : null;
}

function reg(...args: string[]) {
  const result = Bun.spawnSync(["reg", ...args], { stdout: "pipe", stderr: "pipe", windowsHide: true });
  return { ok: result.exitCode === 0, out: result.stdout.toString() };
}

const regSet = (key: string, name: string | null, value: string) =>
  reg("add", key, ...(name === null ? ["/ve"] : ["/v", name]), "/t", "REG_SZ", "/d", value, "/f");

const defaultValue = (key: string) => reg("query", key, "/ve").out.match(/REG_SZ\s+(.+)/)?.[1]?.trim();

// Tells Explorer to reload associations and icons.
async function notifyShell() {
  try {
    const { dlopen, FFIType } = await import("bun:ffi");
    const shell = dlopen("shell32.dll", { SHChangeNotify: { args: [FFIType.i32, FFIType.u32, FFIType.ptr, FFIType.ptr], returns: FFIType.void } });
    shell.symbols.SHChangeNotify(0x08000000, 0, null, null); // SHCNE_ASSOCCHANGED, SHCNF_IDLIST
    shell.close();
  } catch { /* Explorer picks the change up later */ }
}

export function associationStatus() {
  const exe = editorExe();
  if (!exe) return { available: false, registered: false, exe: null };
  const command = reg("query", `HKCU\\Software\\Classes\\${progId(".szs")}\\shell\\open\\command`, "/ve");
  return { available: true, registered: command.ok && command.out.toLowerCase().includes(exe.toLowerCase()), exe };
}

export async function registerAssociations() {
  const exe = editorExe();
  if (!exe) throw new Error("File association is available in the built MKWiiAdvancedEditor.exe only");
  const open = `"${exe}" "%1"`;
  const steps = [
    regSet(APP_KEY, "FriendlyAppName", "MKWii Advanced Editor"),
    regSet(`${APP_KEY}\\shell\\open\\command`, null, open),
  ];
  for (const [ext, type] of Object.entries(TYPES)) {
    const prog = `HKCU\\Software\\Classes\\${progId(ext)}`;
    steps.push(regSet(prog, null, type));
    steps.push(regSet(`${prog}\\DefaultIcon`, null, `"${exe}",0`));
    steps.push(regSet(`${prog}\\shell\\open`, "FriendlyAppName", "MKWii Advanced Editor"));
    steps.push(regSet(`${prog}\\shell\\open\\command`, null, open));
    const key = `HKCU\\Software\\Classes\\${ext}`;
    reg("delete", `${key}\\OpenWithProgids`, "/v", LEGACY_PROG_ID, "/f");
    steps.push(regSet(`${key}\\OpenWithProgids`, progId(ext), ""));
    steps.push(regSet(`${APP_KEY}\\SupportedTypes`, ext, ""));
    // Default app for the extension, unless another program already owns it here.
    const current = defaultValue(key);
    if (!current || current === progId(ext) || current === LEGACY_PROG_ID) steps.push(regSet(key, null, progId(ext)));
  }
  reg("delete", `HKCU\\Software\\Classes\\${LEGACY_PROG_ID}`, "/f");
  if (steps.some((s) => !s.ok)) throw new Error("Windows did not accept the file association");
  await notifyShell();
  return associationStatus();
}

export async function unregisterAssociations() {
  reg("delete", `HKCU\\Software\\Classes\\${LEGACY_PROG_ID}`, "/f");
  reg("delete", APP_KEY, "/f");
  for (const ext of ASSOCIATED_EXTENSIONS) {
    reg("delete", `HKCU\\Software\\Classes\\${progId(ext)}`, "/f");
    const key = `HKCU\\Software\\Classes\\${ext}`;
    for (const id of [progId(ext), LEGACY_PROG_ID]) reg("delete", `${key}\\OpenWithProgids`, "/v", id, "/f");
    const current = defaultValue(key);
    if (current === progId(ext) || current === LEGACY_PROG_ID) reg("delete", key, "/ve", "/f");
  }
  await notifyShell();
  return associationStatus();
}

// Editors that registered the single legacy type move to the per-extension types on start.
export async function migrateLegacyAssociation() {
  const exe = editorExe();
  if (!exe) return;
  const legacy = reg("query", `HKCU\\Software\\Classes\\${LEGACY_PROG_ID}\\shell\\open\\command`, "/ve");
  if (legacy.ok && legacy.out.toLowerCase().includes(exe.toLowerCase())) { await registerAssociations().catch(() => {}); return; }
  // Registered by a version that knew fewer file types: add the new ones.
  if (associationStatus().registered && !ASSOCIATED_EXTENSIONS.every((ext) => reg("query", `HKCU\\Software\\Classes\\${progId(ext)}\\shell\\open\\command`, "/ve").ok))
    await registerAssociations().catch(() => {});
}
