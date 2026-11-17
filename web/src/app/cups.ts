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
import { parseTPL } from "../../js/formats/brlyt.js";
import { encodeTextureLevels } from "../../js/formats/brres.js";
import { editor } from "./editor";
import { dialogs } from "./dialogs-store";
import { toast } from "sonner";
import { decodeFile, musicLike } from "./audio-convert";
import { generateTrackArchive } from "./generated-track";

export type Source = { type: "slot"; id: number } | { type: "file"; path: string; label: string; generated?: boolean };
// Music chosen for a slot: the music of another track, or an audio file converted when applied.
// A file with `silent`: no music (a silent stream in place of the position's music).
export type MusicChoice = { type: "slot"; id: number }
  | { type: "file"; path: string; label: string; loop: boolean; loopStart: number; volume: number; finalFaster: boolean; silent?: boolean };
export const NO_MUSIC: MusicChoice = { type: "file", path: "", label: "No music", loop: true, loopStart: 0, volume: 100, finalFaster: false, silent: true };
// One second of silence, for a stream that plays nothing.
export const silence = () => ({ rate: 32000, channels: [new Float32Array(32000), new Float32Array(32000)] });
// cupIcons with `original`: the cup's original icon back, from the archives' .bak copies.
export type Arrangement = { content: Record<number, Source>; names: Record<number, string>; cupNames: Record<number, string>; music: Record<number, MusicChoice>; cupIcons?: Record<number, { path: string; url: string; original?: boolean }>; noVideo?: Record<number, boolean | "original"> };
type SavedMusic = { from: string | null; file: Extract<MusicChoice, { type: "file" }> | null };
type MusicSnapshot = Record<string, Record<string, SavedMusic | null>>;
// remove: the file is deleted instead (it is in the backup like the others).
export type Write = { path: string; data: Uint8Array; compress?: "yaz0"; what: string; remove?: boolean; keep?: boolean; source?: string };

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
  let checkpoints = 0, starts = 0, parsedKmp: any = null;
  const kmp = findFile(tree, "course.kmp");
  if (kmp) {
    try {
      const parsed = parseKMP(kmp.data);
      parsedKmp = parsed;
      checkpoints = parsed.CKPT.reduce((n: number, g: any) => n + g.points.length, 0);
      starts = parsed.KTPT.length;
    } catch { /* reported as missing data below */ }
  }
  return { ...checkTrackArchive({ files, checkpoints, starts, kmp: parsedKmp }, battle), files: files.length, checkpoints };
}

// The position is already chosen. Keep its working archive automatically until Apply installs it;
// there is no separate source-file destination for the user to choose.
export async function createCupTrack(label: string, destination?: string): Promise<string | null> {
  const res: any = await dialogs.open("generator", { hasSzs: false });
  if (!res) return null;
  const generated = await editor.withBusy("Building the cup's track…", async () => {
    try { return await generateTrackArchive(res.points, res.params, null, (text) => { editor.busy = text; editor.bump("ui"); }, editor.workspace() ? editor.workspacePath("Race", "Course") : ""); }
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
export async function buildWrites(arrangement: Arrangement, { moveMusic, moveVideos = true, saved = {}, progress }: { moveMusic: boolean; moveVideos?: boolean; saved?: Record<string, unknown>; progress?: (text: string) => void }) {
  const plan = planArrangement(arrangement, { moveMusic, saved });
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
    for (const { target, source, file: audioFile, original } of plan.music) {
      const before = writes.length;
      const to = musicFiles(target, listing);
      if (audioFile) {
        // An audio file: converted like the stream it replaces, normal and final lap.
        say(`Converting ${audioFile.label}…`);
        const audio = audioFile.silent ? silence() : await decodeFile(audioFile.path, (await api.readPath(audioFile.path)).data);
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
      if (original) {
        // A track's original music, whose stream holds other music since an earlier apply: the .bak
        // copy kept by the first apply that changed it.
        for (const key of ["normal", "final"] as const) {
          if (!to[key] || !from[key]) continue;
          const bak = `${strm}\\${from[key]}.bak`;
          if (!(await api.exists(bak))) { notes.push(`No .bak copy of ${from[key]}: the original music of ${source} could not be used (Backups in this window can restore the files of an earlier apply).`); continue; }
          say(`Reading the original ${from[key]}…`);
          writes.push({ path: `${strm}\\${to[key]}`, data: (await api.readPath(bak)).data, what: `${to[key]} (original music of ${source})` });
        }
        if (writes.length > before) musicApplied.push(target);
        continue;
      }
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
  // Positions without a preview video: their part of the cup's movie becomes black.
  // Positions with their original preview back: the part of the track they hold (as a moved track
  // takes its own), from the .bak copy of its cup's video, kept by the first apply that changed it.
  const blanks = SLOTS.filter((s) => arrangement.noVideo?.[s.id] === true).map((s) => s.id);
  const originals = SLOTS.filter((s) => arrangement.noVideo?.[s.id] === "original").map((s) => s.id);
  if (moveVideos || blanks.length || originals.length) {
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
    for (const { slot, source } of moveVideos ? plan.tracks : []) {
      if (source.type !== "slot" || arrangement.noVideo?.[slot]) continue;
      const to = movieOf(slot), from = movieOf(source.id);
      if (!to || !from) continue;
      const [target, origin] = [await load(to.path), await load(from.path)];
      if (!target || !origin) { notes.push(`${(target ? from : to).name} not found: that preview video is unchanged.`); continue; }
      const list = byTarget.get(to.path) || [];
      list.push({ rect: to.region, source: { kind: "thp", name: from.name, thp: origin, rect: from.region }, fit: "stretch" });
      byTarget.set(to.path, list);
    }
    const backups = new Map<string, any>();
    for (const slot of originals) {
      const content = arrangement.content[slot];
      const to = movieOf(slot), from = movieOf(moveVideos && content.type === "slot" ? content.id : slot);
      if (!to || !from || !(await load(to.path))) { notes.push(`${to?.name || "The cup's preview video"} not found: ${slotById(slot).label}'s preview stays.`); continue; }
      if (!backups.has(from.path)) backups.set(from.path, (await api.exists(`${from.path}.bak`)) ? parseTHP((await api.readPath(`${from.path}.bak`)).data) : null);
      const original = backups.get(from.path);
      if (!original) { notes.push(`No .bak copy of ${from.name}: ${slotById(slot).label}'s original preview could not be put back (Backups in this window can restore the files of an earlier apply).`); continue; }
      const list = byTarget.get(to.path) || [];
      list.push({ rect: to.region, source: { kind: "thp", name: `${from.name} (original)`, thp: original, rect: from.region }, fit: "stretch" });
      byTarget.set(to.path, list);
    }
    if (blanks.length) {
      const black = await createImageBitmap(new ImageData(new Uint8ClampedArray([0, 0, 0, 255]), 1, 1));
      for (const slot of blanks) {
        const to = movieOf(slot);
        if (!to || !(await load(to.path))) { notes.push(`${to?.name || "The cup's preview video"} not found: ${slotById(slot).label}'s preview stays.`); continue; }
        const list = byTarget.get(to.path) || [];
        list.push({ rect: to.region, source: { kind: "image", name: "No preview video", bitmap: black }, fit: "stretch" });
        byTarget.set(to.path, list);
      }
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
  const iconCups = Object.keys(arrangement.cupIcons || {}).map(Number).filter((c) => (CUPS[c] as any)?.icon);
  if (iconCups.length) {
    const ui = editor.workspacePath("Scene", "UI");
    if (!ui) notes.push("No Scene/UI folder in the game folder: the cup icons stay as they are.");
    else {
      const pictures = new Map<number, Uint8Array>();
      for (const c of iconCups) if (!arrangement.cupIcons![c].original) pictures.set(c, (await api.readPath(arrangement.cupIcons![c].path)).data);
      const missing = new Set<string>();
      for (const name of CUP_ICON_ARCHIVES) {
        const path = `${ui}\\${name}`;
        if (!(await api.exists(path))) continue;
        say(`Putting the cup icons in ${name}…`);
        const file = await api.readPath(path);
        const tree = parseU8(await api.decodeArchiveBytes(file.data, file.path));
        // The original icons: the archive's .bak copy, kept by the first apply that changed it.
        let backup: any;
        const original = async (entryPath: string) => {
          if (backup === undefined) backup = (await api.exists(`${path}.bak`)) ? parseU8(await api.decodeArchiveBytes((await api.readPath(`${path}.bak`)).data, `${path}.bak`)) : null;
          return backup ? listFiles(backup).find((f: any) => f.path === entryPath)?.node.data ?? null : null;
        };
        let changed = false;
        for (const entry of listFiles(tree)) {
          const base = entry.path.split("/").pop();
          const c = iconCups.find((c) => [`tt_cup_icon_${(CUPS[c] as any).icon}_00.tpl`, `tt_cup_icon_lisense_${(CUPS[c] as any).icon}.tpl`].includes(base));
          if (c === undefined) continue;
          if (arrangement.cupIcons![c].original) {
            const data = await original(entry.path);
            if (!data) { missing.add(name); continue; }
            setFilePath(tree, entry.path, data);
          } else setFilePath(tree, entry.path, await pictureAsTPL(entry.node.data, pictures.get(c)!));
          changed = true;
        }
        if (changed) writes.push({ path, data: buildU8(tree), compress: "yaz0", what: name });
      }
      if (missing.size) notes.push(`No .bak copy of ${[...missing].join(", ")}: the original icon could not be put back there (Backups in this window can restore the files of an earlier apply).`);
    }
  }
  return { writes, plan, notes, musicApplied };
}

// The archives with the icons of the race cups: the 128-pixel icon of the menus, race, awards and
// channel (tt_cup_icon_<cup>_00.tpl), and the 14-pixel one of the licence screen (tt_cup_icon_lisense_<cup>.tpl).
export const CUP_ICON_ARCHIVES = ["MenuSingle.szs", "MenuMulti.szs", "Race.szs", "Award.szs", "Channel.szs", "Present.szs", "MenuOther.szs", "Title.szs"];

// A picture in place of a TPL texture: same size and texture format, fitted in the middle.
export async function pictureAsTPL(base: Uint8Array, picture: Uint8Array) {
  const [{ image }] = parseTPL(base);
  const bitmap = await createImageBitmap(new Blob([picture as BlobPart]));
  const canvas = new OffscreenCanvas(image.width, image.height), ctx = canvas.getContext("2d")!;
  const scale = Math.min(image.width / bitmap.width, image.height / bitmap.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, (image.width - bitmap.width * scale) / 2, (image.height - bitmap.height * scale) / 2, bitmap.width * scale, bitmap.height * scale);
  const rgba = new Uint8Array(ctx.getImageData(0, 0, image.width, image.height).data.buffer);
  const out = base.slice();
  const view = new DataView(out.buffer);
  const dataOffset = view.getUint32(view.getUint32(view.getUint32(8)) + 8); // table -> image header -> data
  encodeTextureLevels(out, dataOffset, out.length, rgba, image.width, image.height, image.format, 1);
  return out;
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
    if (music?.type === "slot" && slotById(music.id).music === slot.music) lines.push(`${where}: its original music in ${slot.music}`);
    else if (music) lines.push(music.type === "file" && music.silent ? `${where}: no music (${slot.music} becomes silent)` : `${where}: music ${music.type === "file" ? `from ${music.path.split(/[\\/]/).pop()}` : `of ${label(music.id)} (${slotById(music.id).music})`} in ${slot.music}`);
    if (arrangement.noVideo?.[slot.id]) lines.push(`${where}: ${arrangement.noVideo[slot.id] === "original" ? "original preview video" : "no preview video"}`);
  }
  CUPS.forEach((cup, i) => { if (arrangement.cupNames[i] !== undefined) lines.push(`${cup.name}: name "${arrangement.cupNames[i]}"`); });
  CUPS.forEach((cup, i) => { const icon = arrangement.cupIcons?.[i]; if (icon) lines.push(icon.original ? `${cup.name}: original icon` : `${cup.name}: icon from ${icon.path.split(/[\\/]/).pop()}`); });
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
    if (w.remove) {
      // A file kept as .bak before it goes (once, like the .bak of a file written over), so it can come back.
      if (w.keep && backup && editor.settings.keepBackups && (await api.exists(w.path)) && !(await api.exists(`${w.path}.bak`))) await api.writeFile(`${w.path}.bak`, (await api.readPath(w.path)).data);
      await api.deleteFile(w.path);
      continue;
    }
    await api.writeFile(w.path, w.data, { backup: backup && editor.settings.keepBackups, edited: true, compress: w.compress || null });
  }
  const cupFiles = writes.filter((w) => w.source && !w.remove).map((w) => ({ source: w.source!, path: w.path }));
  if (cupFiles.length) await api.cupTracksApplied(cupFiles);
  return snapshot;
}
