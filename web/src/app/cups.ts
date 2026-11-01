// Reading and writing the game files of the Cups and tracks window. The arrangement logic (which
// slot gets which track, music and names) is in js/data/cups.js; this module turns it into files.

import { api } from "../../js/api.js";
import { CUPS, SLOTS, checkTrackArchive, musicFiles, nameChanges, planArrangement, slotById, slotPlace } from "../../js/data/cups.js";
import { THP_LAYOUTS, parseTHP } from "../../js/formats/thp.js";
import { renderMovie, type MovieEdit } from "./thp-render";
import { buildBMG, parseBMG } from "../../js/formats/bmg.js";
import { parseKMP } from "../../js/formats/kmp.js";
import { buildU8, findFile, isU8, listFiles, parseU8, setFilePath } from "../../js/formats/u8.js";
import { isYaz0, yaz0Decompress } from "../../js/formats/yaz0.js";
import { editor } from "./editor";
import { dialogs } from "./dialogs-store";
import { toast } from "sonner";
import { decodeFile, musicLike } from "./audio-convert";
import { generateTrackArchive } from "./generated-track";

export type Source = { type: "slot"; id: number } | { type: "file"; path: string; label: string; generated?: boolean };
// Music chosen for a slot: the music of another track, or an audio file converted when applied.
export type MusicChoice = { type: "slot"; id: number }
  | { type: "file"; path: string; label: string; loop: boolean; loopStart: number; volume: number; finalFaster: boolean };
export type Arrangement = { content: Record<number, Source>; names: Record<number, string>; cupNames: Record<number, string>; music: Record<number, MusicChoice> };
type SavedMusic = { from: string | null; file: Extract<MusicChoice, { type: "file" }> | null };
type MusicSnapshot = Record<string, Record<string, SavedMusic | null>>;
// remove: the file is deleted instead (it is in the backup like the others).
export type Write = { path: string; data: Uint8Array; compress?: "yaz0"; what: string; remove?: boolean; source?: string };

const LANGUAGE_ORDER = ["E", "U", "I", "F", "G", "S", "M", "Q", "J", "K"];
const languageArchive = (name: string) => /_([A-Z])\.szs$/i.exec(name)?.[1]?.toUpperCase() || "";
export const musicFolderKey = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

export function saveCupMusic(folder: string, music: Record<string, SavedMusic>) {
  editor.cupMusicByFolder = { ...editor.cupMusicByFolder, [folder]: music };
  editor.saveSettings({ cupMusicByFolder: editor.cupMusicByFolder });
  editor.bump("settings");
}

// Only the streams included in this backup change when it is restored. Keep their displayed
// sources with the backup, leaving the music of every other stream and workspace alone.
export function snapshotCupMusic(files: string[]): MusicSnapshot {
  const snapshot: MusicSnapshot = {};
  for (const file of files) {
    const normalized = file.replace(/\\/g, "/");
    const match = /\/([^/]+)_[nf]\.brstm$/i.exec(normalized);
    const stream = match && SLOTS.find((s) => s.music.toLowerCase() === match[1].toLowerCase())?.music;
    if (!stream) continue;
    const folder = musicFolderKey(normalized.slice(0, normalized.lastIndexOf("/")));
    (snapshot[folder] ||= {})[stream] = editor.cupMusicByFolder[folder]?.[stream] || null;
  }
  return snapshot;
}

export function restoreCupMusic(files: string[], snapshot: MusicSnapshot = {}) {
  for (const [folder, streams] of Object.entries(snapshotCupMusic(files))) {
    const music = { ...editor.cupMusicByFolder[folder] };
    for (const stream of Object.keys(streams)) {
      const before = snapshot?.[folder]?.[stream];
      if (before) music[stream] = before;
      else delete music[stream];
    }
    saveCupMusic(folder, music);
  }
}

export const trackPath = (file: string, multiplayer = false) => editor.workspacePath("Race", "Course", `${file}${multiplayer ? "_d" : ""}.szs`);

// Names as the game shows them now (one language), to label the slots: { language, text(id) }.
export async function readGameNames(): Promise<{ language: string; text: (id: number) => string | null } | null> {
  const ui = editor.workspacePath("Scene", "UI");
  if (!ui) return null;
  const list: string[] = await api.listDir(ui, ["szs"]).catch(() => []);
  const languages = [...new Set(list.map(languageArchive).filter(Boolean))].sort((a, b) => (LANGUAGE_ORDER.indexOf(a) + 1 || 99) - (LANGUAGE_ORDER.indexOf(b) + 1 || 99));
  for (const language of languages) {
    // MenuSingle has the cup and course selection; any archive with Common.bmg has the same names.
    const names = list.filter((f) => languageArchive(f) === language).sort((a) => (/^MenuSingle_/i.test(a) ? -1 : 1));
    for (const name of names) {
      try {
        const file = await api.readPath(`${ui}\\${name}`);
        const tree = parseU8(await api.decodeArchiveBytes(file.data, file.path));
        const node = findFile(tree, "Common.bmg");
        if (!node) continue;
        const texts = new Map<number, string>(parseBMG(node.data).messages.map((m: any) => [m.id, m.text]));
        return { language, text: (id) => texts.get(id) ?? null };
      } catch { /* try the next archive */ }
    }
  }
  return null;
}

// What a track archive holds, for the checks shown before it replaces a slot.
export async function inspectTrack(path: string, battle: boolean) {
  const file = await api.readPath(path);
  const tree = parseU8(await api.decodeArchiveBytes(file.data, file.path, editor.commonPath || editor.partsFolder()));
  const files = listFiles(tree).map((f: any) => f.path);
  let checkpoints = 0, starts = 0;
  const kmp = findFile(tree, "course.kmp");
  if (kmp) {
    try {
      const parsed = parseKMP(kmp.data);
      checkpoints = parsed.CKPT.reduce((n: number, g: any) => n + g.points.length, 0);
      starts = parsed.KTPT.length;
    } catch { /* reported as missing data below */ }
  }
  return { ...checkTrackArchive({ files, checkpoints, starts }, battle), files: files.length, checkpoints };
}

// The position is already chosen. Keep its working archive automatically until Apply installs it;
// there is no separate source-file destination for the user to choose.
export async function createCupTrack(label: string, destination?: string): Promise<string | null> {
  const res: any = await dialogs.open("generator", { hasSzs: false });
  if (!res) return null;
  const generated = await editor.withBusy("Building the cup's track…", async () => {
    try { return await generateTrackArchive(res.points, res.params, null, (text) => { editor.busy = text; editor.bump("ui"); }); }
    catch (e: any) { void dialogs.alert({ title: "Track generation failed", description: e.message }); return null; }
  });
  if (!generated) return null;
  try {
    const bytes = buildU8(generated.tree);
    const { path } = await api.createCupTrack(bytes, label, destination);
    const disk = (await api.readPath(path)).data;
    const actual = isYaz0(disk) ? yaz0Decompress(disk) : disk;
    if (actual.length !== bytes.length || !actual.every((v: number, i: number) => v === bytes[i])) throw new Error("The saved track could not be verified");
    toast.success(`New track for ${label}`, { description: "Assigned to this cup position. Save edits in its 3D window, then Apply the cup changes." });
    await editor.openEditorWindow({ path });
    return path;
  } catch (e: any) { void dialogs.alert({ title: "Could not save the cup's track", description: e.message }); return null; }
}

// Archive bytes as the game reads them (Yaz0): Yaz0 files are copied as they are, plain U8 and
// Wiimm's formats (WLZ, WBZ, WU8, YBZ) are rebuilt and compressed when written.
async function trackBytes(path: string): Promise<{ data: Uint8Array; compress?: "yaz0" }> {
  const file = await api.readPath(path);
  if (isYaz0(file.data)) return { data: file.data };
  if (isU8(file.data)) return { data: file.data, compress: "yaz0" };
  const decoded = await api.decodeArchiveBytes(file.data, file.path, editor.commonPath || editor.partsFolder());
  if (!isU8(decoded)) throw new Error(`${file.name} is not a track archive`);
  return { data: decoded, compress: "yaz0" };
}

// The multiplayer copy that goes with a chosen file: <name>_d beside it, otherwise the file itself
// (custom tracks are usually published without a separate _d archive).
async function multiplayerSibling(path: string) {
  const sibling = path.replace(/(\.[^.\\/]+)$/, "_d$1");
  return sibling !== path && !/_d\.[^.\\/]+$/i.test(path) && (await api.exists(sibling)) ? sibling : path;
}

// Every file the arrangement rewrites, with its new bytes. All sources are read before anything is
// written, so tracks can trade places. `progress` reports what is being read.
export async function buildWrites(arrangement: Arrangement, { moveMusic, moveVideos = true, progress }: { moveMusic: boolean; moveVideos?: boolean; progress?: (text: string) => void }) {
  const plan = planArrangement(arrangement, { moveMusic });
  const writes: Write[] = [];
  const notes: string[] = [];
  const musicApplied: string[] = [];
  const say = (text: string) => progress?.(text);

  for (const { slot, source } of plan.tracks) {
    const target = slotById(slot);
    for (const multiplayer of [false, true]) {
      const to = trackPath(target.file, multiplayer);
      if (!to) throw new Error("Choose the game folder first (Settings › Game files)");
      let from: string;
      if (source.type === "slot") {
        const sourceSlot = slotById(source.id);
        from = trackPath(sourceSlot.file, multiplayer);
        if (multiplayer && !(await api.exists(from))) from = trackPath(sourceSlot.file);
      } else from = multiplayer ? await multiplayerSibling(source.path) : source.path;
      if (!(await api.exists(from))) {
        if (multiplayer) { notes.push(`${from.split(/[\\/]/).pop()} not found: the multiplayer copy of ${target.label} is unchanged.`); continue; }
        throw new Error(`Not found: ${from}`);
      }
      if (multiplayer && !(await api.exists(to)) && source.type === "slot") continue;
      say(`Reading ${from.split(/[\\/]/).pop()}…`);
      const bytes = await trackBytes(from);
      writes.push({ path: to, ...bytes, what: `${target.file}${multiplayer ? "_d" : ""}.szs`, ...(source.type === "file" ? { source: source.path } : {}) });
    }
  }

  if (plan.music.length) {
    const strm = editor.workspacePath("sound", "strm");
    const listing: string[] = strm ? await api.listDir(strm, ["brstm"]).catch(() => []) : [];
    for (const { target, source, file: audioFile } of plan.music) {
      const before = writes.length;
      const to = musicFiles(target, listing);
      if (audioFile) {
        // An audio file: converted like the stream it replaces, normal and final lap.
        say(`Converting ${audioFile.label}…`);
        const audio = await decodeFile(audioFile.path, (await api.readPath(audioFile.path)).data);
        for (const key of ["normal", "final"] as const) {
          if (!to[key]) { notes.push(`Music ${target}_${key === "normal" ? "n" : "f"} not found: that music stays as it is.`); continue; }
          say(`Converting ${audioFile.label} for ${to[key]}…`);
          const template = (await api.readPath(`${strm}\\${to[key]}`)).data;
          const speed = key === "final" && audioFile.finalFaster ? 1.1 : 1;
          const data = await musicLike(template, audio, { loop: audioFile.loop ?? true, loopStart: audioFile.loopStart ?? 0, volume: audioFile.volume ?? 100, speed });
          writes.push({ path: `${strm}\\${to[key]}`, data, what: to[key]! });
        }
        if (writes.length > before) musicApplied.push(target);
        continue;
      }
      const from = musicFiles(source, listing);
      for (const key of ["normal", "final"] as const) {
        if (!to[key] || !from[key]) { notes.push(`Music ${source}_${key === "normal" ? "n" : "f"} or ${target} not found: that music stays as it is.`); continue; }
        say(`Reading ${from[key]}…`);
        const file = await api.readPath(`${strm}\\${from[key]}`);
        writes.push({ path: `${strm}\\${to[key]}`, data: file.data, what: to[key]! });
      }
      if (writes.length > before) musicApplied.push(target);
    }
  }

  // The track previews of the cup selection: each moved track takes its part of the cup's movie
  // with it (tracks from a file keep the preview of the position; change it in Preview videos).
  if (moveVideos) {
    const movieOf = (slot: number) => {
      const { cup, position } = slotPlace(slot);
      const entry = Object.entries(THP_LAYOUTS).find(([, l]: any) => l.cup === cup);
      return entry ? { path: editor.workspacePath("thp", ...entry[0].split("/")), name: entry[0], region: (entry[1] as any).regions[position] } : null;
    };
    const movies = new Map<string, any>();
    const load = async (path: string) => {
      if (!movies.has(path)) { say(`Reading ${path.split(/[\\/]/).pop()}…`); movies.set(path, (await api.exists(path)) ? parseTHP((await api.readPath(path)).data) : null); }
      return movies.get(path);
    };
    const byTarget = new Map<string, MovieEdit[]>();
    for (const { slot, source } of plan.tracks) {
      if (source.type !== "slot") continue;
      const to = movieOf(slot), from = movieOf(source.id);
      if (!to || !from) continue;
      const [target, origin] = [await load(to.path), await load(from.path)];
      if (!target || !origin) { notes.push(`${(target ? from : to).name} not found: that preview video is unchanged.`); continue; }
      const list = byTarget.get(to.path) || [];
      list.push({ rect: to.region, source: { kind: "thp", name: from.name, thp: origin, rect: from.region }, fit: "stretch" });
      byTarget.set(to.path, list);
    }
    for (const [path, edits] of byTarget) {
      const name = path.split(/[\\/]/).pop()!;
      const data = await renderMovie(movies.get(path), edits, (done, total) => say(`Encoding the previews of ${name}: frame ${done} of ${total}…`));
      writes.push({ path, data, what: name });
    }
  }

  if (plan.names) {
    const ui = editor.workspacePath("Scene", "UI");
    const list: string[] = ui ? await api.listDir(ui, ["szs"]).catch(() => []) : [];
    const archives = list.filter((name) => languageArchive(name));
    if (!archives.length) notes.push("No game text (Scene/UI) in the game folder: the names in the menus stay as they are.");
    for (const [i, name] of archives.entries()) {
      say(`Reading names in ${name} (${i + 1}/${archives.length})…`);
      const path = `${ui}\\${name}`;
      const file = await api.readPath(path);
      const tree = parseU8(await api.decodeArchiveBytes(file.data, file.path));
      let changed = false;
      for (const entry of listFiles(tree)) {
        if (!/(^|\/)Common\.bmg$/i.test(entry.path)) continue;
        const bmg = parseBMG(entry.node.data);
        const texts = new Map<number, string>(bmg.messages.map((m: any) => [m.id, m.text]));
        const changes = nameChanges(arrangement, (id: number) => texts.get(id) ?? null);
        if (!Object.keys(changes).length) continue;
        setFilePath(tree, entry.path, buildBMG(bmg, changes));
        changed = true;
      }
      if (changed) writes.push({ path, data: buildU8(tree), compress: "yaz0", what: name });
    }
  }
  return { writes, plan, notes, musicApplied };
}

// One line per change, for the confirmation window and the backup's label.
export function describeArrangement(arrangement: Arrangement, label: (id: number) => string) {
  const lines: string[] = [];
  for (const slot of SLOTS) {
    const source = arrangement.content[slot.id];
    const where = `${CUPS.find((c) => c.slots.includes(slot.id))!.name} ${CUPS.find((c) => c.slots.includes(slot.id))!.slots.indexOf(slot.id) + 1}`;
    if (source.type === "file") lines.push(`${where}: ${label(slot.id)} → ${source.path.split(/[\\/]/).pop()}`);
    else if (source.id !== slot.id) lines.push(`${where}: ${label(slot.id)} → ${label(source.id)}`);
    const typed = arrangement.names[slot.id];
    if (typed !== undefined && source.type === "slot") lines.push(`${where}: name "${typed}"`);
    const music = arrangement.music?.[slot.id];
    if (music) lines.push(`${where}: music ${music.type === "file" ? `from ${music.path.split(/[\\/]/).pop()}` : `of ${label(music.id)} (${slotById(music.id).music})`} in ${slot.music}`);
  }
  CUPS.forEach((cup, i) => { if (arrangement.cupNames[i] !== undefined) lines.push(`${cup.name}: name "${arrangement.cupNames[i]}"`); });
  return lines;
}

// Writes the files, after a backup when asked. Returns the backup (or null).
export async function writeAll(writes: Write[], { backup, label, details, progress }: { backup: boolean; label: string; details: unknown; progress?: (text: string) => void }) {
  let snapshot: any = null;
  if (backup) {
    progress?.(`Backing up ${writes.length} file${writes.length === 1 ? "" : "s"}…`);
    snapshot = await api.createSnapshot(label, writes.map((w) => w.path), details);
  }
  for (const [i, w] of writes.entries()) {
    progress?.(`Writing ${w.what} (${i + 1}/${writes.length})…`);
    if (w.remove) { await api.deleteFile(w.path); continue; }
    await api.writeFile(w.path, w.data, { backup: backup && editor.settings.keepBackups, edited: true, compress: w.compress || null });
  }
  const cupFiles = writes.filter((w) => w.source && !w.remove).map((w) => ({ source: w.source!, path: w.path }));
  if (cupFiles.length) await api.cupTracksApplied(cupFiles);
  return snapshot;
}
