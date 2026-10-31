// Reading and writing the game files of the Cups and tracks window. The arrangement logic (which
// slot gets which track, music and names) is in js/data/cups.js; this module turns it into files.

import { api } from "../../js/api.js";
import { CUPS, SLOTS, checkTrackArchive, musicFiles, nameChanges, planArrangement, slotById, slotPlace } from "../../js/data/cups.js";
import { THP_LAYOUTS, parseTHP } from "../../js/formats/thp.js";
import { renderMovie, type MovieEdit } from "./thp-render";
import { buildBMG, parseBMG } from "../../js/formats/bmg.js";
import { parseKMP } from "../../js/formats/kmp.js";
import { buildU8, findFile, isU8, listFiles, parseU8, setFilePath } from "../../js/formats/u8.js";
import { isYaz0 } from "../../js/formats/yaz0.js";
import { editor } from "./editor";
import { decodeFile, musicLike } from "./audio-convert";

export type Source = { type: "slot"; id: number } | { type: "file"; path: string; label: string };
// Music chosen for a slot: the music of another track, or an audio file converted when applied.
export type MusicChoice = { type: "slot"; id: number }
  | { type: "file"; path: string; label: string; loop: boolean; loopStart: number; volume: number; finalFaster: boolean };
export type Arrangement = { content: Record<number, Source>; names: Record<number, string>; cupNames: Record<number, string>; music: Record<number, MusicChoice> };
// remove: the file is deleted instead (it is in the backup like the others).
export type Write = { path: string; data: Uint8Array; compress?: "yaz0"; what: string; remove?: boolean };

const LANGUAGE_ORDER = ["E", "U", "I", "F", "G", "S", "M", "Q", "J", "K"];
const languageArchive = (name: string) => /_([A-Z])\.szs$/i.exec(name)?.[1]?.toUpperCase() || "";

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
      writes.push({ path: to, ...bytes, what: `${target.file}${multiplayer ? "_d" : ""}.szs` });
    }
  }

  if (plan.music.length) {
    const strm = editor.workspacePath("sound", "strm");
    const listing: string[] = strm ? await api.listDir(strm, ["brstm"]).catch(() => []) : [];
    for (const { target, source, file: audioFile } of plan.music) {
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
        continue;
      }
      const from = musicFiles(source, listing);
      for (const key of ["normal", "final"] as const) {
        if (!to[key] || !from[key]) { notes.push(`Music ${source}_${key === "normal" ? "n" : "f"} or ${target} not found: that music stays as it is.`); continue; }
        say(`Reading ${from[key]}…`);
        const file = await api.readPath(`${strm}\\${from[key]}`);
        writes.push({ path: `${strm}\\${to[key]}`, data: file.data, what: to[key]! });
      }
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
  return { writes, plan, notes };
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
    await api.writeFile(w.path, w.data, { backup: editor.settings.keepBackups, edited: true, compress: w.compress || null });
  }
  return snapshot;
}
