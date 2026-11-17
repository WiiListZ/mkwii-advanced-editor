// Files of a Pulsar pack for the Cups window: the pack's Config.pul, its Tracks folder, its cup
// icons (Assets/UIAssets.szs) and its expert ghosts (Ghosts/Experts, one per track and mode, which
// follow their track). Only the cups and tracks are edited; every other setting of the pack is kept.

import { api } from "../../js/api.js";
import { buildBMG, parseBMG, zeroAttributeIds } from "../../js/formats/bmg.js";
import { CUSTOM_VIDEOS, customVideoName, earlierPulsarMenuVideos, enablePulsarMenuVideos, pulsarCustomVideos, pulsarMenuVideos, setPulsarCustomVideos, withoutCustomVideos } from "../../js/formats/pulsar-code.js";
import { THP_LAYOUTS, parseTHP } from "../../js/formats/thp.js";
import { CUSTOM_VIDEO_SECONDS, loadVideo, renderMovie, type MovieEdit } from "./thp-render";
import { PULSAR_IDS, buildPulsarConfig, crc32, parsePulsarConfig } from "../../js/formats/pulsar.js";
import { EXPERT_MODES, expertFile, plannedAlphabetical, plannedFileSection, plannedTracks, pulsarNameChanges, pulsarNames, trackFile, trackName } from "../../js/data/pulsar-cups.js";
import { SLOTS, musicFiles, slotById } from "../../js/data/cups.js";
import { decodeBRSTM, parseBRSTM } from "../../js/formats/brstm.js";
import { decodeFile, musicLike } from "./audio-convert";
import type { ModCups } from "./dialogs/PulsarCupsView";
import { parseTPL } from "../../js/formats/brlyt.js";
import { decodeTexture } from "../../js/formats/brres.js";
import { buildU8, findFile, isU8, listFiles, parseU8, setFilePath } from "../../js/formats/u8.js";
import { isYaz0, yaz0Compress } from "../../js/formats/yaz0.js";
import { editor } from "./editor";
import { dialogs } from "./dialogs-store";
import { bmgFromText } from "../../js/formats/bmg-text.js";
import { pictureAsTPL, silence, type Write } from "./cups";
import { buildPulsarLaunch, pulsarInstructions, pulsarLaunchPaths } from "../../js/editor/pulsar-launch.js";

export type PulsarPack = {
  configPath: string; root: string; config: any; text: (id: number) => string | null;
  uiAssets: string; tracks: string; experts: string;
  // Tracks without music: a silent stream CTBRSTM/<track>_n.brstm (and _f) written by this editor.
  muted?: Set<number>;
  // Tracks with music of their own (CTBRSTM/<track>_n.brstm and _f): their size in bytes.
  customAudio?: Map<number, number>;
  // Music of their own that tracks had before an apply replaced or removed it: the .bak copies
  // (CTBRSTM/<track>_n.brstm.bak and _f), their size in bytes.
  musicBackups?: Map<number, number>;
  // Custom cups with a preview video of their own (engine table): Map<custom cup, slot>.
  customVideos?: Map<number, number> | null;
  // Whether the pack maps its Assets folder onto the disc's root (where the videos go).
  videoAssets?: boolean;
  // A pack being created: its menu archive is the engine's default one, not yet on disk.
  uiAssetsData?: Uint8Array;
  // The engine (Binaries/Code.pul): whether the cup and course selection play their videos
  // ("off" is Pulsar's own setting), or null when this engine version cannot be changed.
  videos?: "on" | "off" | "legacy" | null;
  // Where the cup selection's box of track names is (see trackListWrites): the game's place, over
  // the menu video, or Pulsar's; null when the pack's layout is neither.
  trackList?: "game" | "pulsar" | null;
  play?: NonNullable<ModCups["play"]>;
};

const parent = (p: string) => p.replace(/[\\/][^\\/]+$/, "");
const join = (...parts: string[]) => parts.join("\\");

// The pack of the workspace: a Riivolution XML that maps the pack's Binaries folder, or a folder
// that holds Binaries/Config.pul (the mod folder itself or the SD card with it).
export async function findPulsarPack(): Promise<string | null> {
  const root = editor.workspace();
  const candidates = [editor.workspacePath("Binaries", "Config.pul"), root && join(root, "Binaries", "Config.pul")];
  for (const c of candidates) if (c && (await api.exists(c))) return c;
  return null;
}

export async function loadPulsarPack(configPath: string, data?: Uint8Array): Promise<PulsarPack> {
  const config = parsePulsarConfig(data || (await api.readPath(configPath)).data);
  const messages = new Map<number, string>(parseBMG(config.bmg).messages.map((m: any) => [m.id, m.text]));
  const root = parent(parent(configPath));
  const launchPaths = pulsarLaunchPaths(config.folder.replace(/^\//, ""), parent(root));
  const play = await api.exists(launchPaths.xmlPath) ? launchPaths : undefined;
  const code = join(root, "Binaries", "Code.pul");
  const videos = data ? undefined : await api.exists(code) ? pulsarMenuVideos((await api.readPath(code)).data) : null;
  return {
    videos, configPath, root, config, text: (id) => messages.get(id) ?? null, play,
    uiAssets: join(root, "Assets", "UIAssets.szs"), tracks: join(root, "Tracks"), experts: join(root, "Ghosts", "Experts"),
  };
}

// ---- Cup icons ---------------------------------------------------------------------------------
let iconArchive: { path: string; tree: Promise<any> } | null = null;
async function uiTree(pack: PulsarPack) {
  if (iconArchive?.path !== pack.uiAssets) {
    iconArchive = { path: pack.uiAssets, tree: (async () => {
      if (pack.uiAssetsData) return parseU8(await api.decodeArchiveBytes(pack.uiAssetsData));
      const f = await api.readPath(pack.uiAssets);
      return parseU8(await api.decodeArchiveBytes(f.data, f.path));
    })() };
  }
  return iconArchive.tree;
}
export const forgetIcons = () => { iconArchive = null; iconURLs.clear(); };

// The cup selection's box of track names: Pulsar's control/ctrl/PULSelectNULL.brctr (in place of the
// game's CupSelectNULL) puts it 18 units further left in 16:9 and 38 in 4:3 (x 62 for both, the
// game has 80 and 100), where it does not sit over the cup's video any more: with the menu videos
// on, the video looked cut and moved right under the names. The x of CupSelectCourseNULL for 16:9
// and 4:3 is at 0x34 and 0x48 of the file; it is Pulsar's own file, not the game's.
const TRACK_LIST = "control/ctrl/PULSelectNULL.brctr";
const TRACK_LIST_X = { game: [80, 100], pulsar: [62, 62] } as const;
function trackListOf(tree: any): "game" | "pulsar" | null {
  const file = findFile(tree, TRACK_LIST);
  if (!file || file.data.length < 0x50) return null;
  const v = new DataView(file.data.buffer, file.data.byteOffset, file.data.byteLength), x = [v.getFloat32(0x34), v.getFloat32(0x48)];
  for (const [name, values] of Object.entries(TRACK_LIST_X)) if (values.every((value, i) => x[i] === value)) return name as "game" | "pulsar";
  return null;
}
async function trackListWrites(pack: PulsarPack, a: any, writes: Write[], say: (t: string) => void) {
  if (pack.videos == null) return;
  const want = (a.menuVideos ?? pack.videos !== "off") ? "game" : "pulsar";
  const earlier = writes.find((w) => w.path === pack.uiAssets);
  const tree = earlier ? parseU8(earlier.data) : parseU8(buildU8(await uiTree(pack)));
  const now = trackListOf(tree);
  if (!now || now === want) return;
  say(want === "game" ? "Lining the track names up with the menu videos…" : "Putting Pulsar's place of the track names back…");
  const data = findFile(tree, TRACK_LIST)!.data.slice(), v = new DataView(data.buffer);
  v.setFloat32(0x34, TRACK_LIST_X[want][0]);
  v.setFloat32(0x48, TRACK_LIST_X[want][1]);
  setFilePath(tree, TRACK_LIST, data);
  const write: Write = { path: pack.uiAssets, data: buildU8(tree), compress: "yaz0", what: "UIAssets.szs" };
  if (earlier) writes.splice(writes.indexOf(earlier), 1, write); else writes.push(write);
}

// icon_000.tpl or icon_0000.tpl: packs use either width.
function iconName(tree: any, cup: number) {
  for (const digits of [3, 4]) {
    const name = `icon_${String(cup).padStart(digits, "0")}.tpl`;
    if (findFile(tree, name)) return name;
  }
  return null;
}
const iconURLs = new Map<string, string>();
export async function packIconURL(pack: PulsarPack, cup: number) {
  const key = `${pack.uiAssets}|${cup}`;
  if (iconURLs.has(key)) return iconURLs.get(key)!;
  const tree = await uiTree(pack);
  const name = iconName(tree, cup);
  if (!name) return "";
  const [{ image, palette }] = parseTPL(findFile(tree, name).data);
  const url = rgbaURL(decodeTexture(image, palette), image.width, image.height);
  iconURLs.set(key, url);
  return url;
}
function rgbaURL(rgba: Uint8Array, width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  return canvas.toDataURL("image/png");
}

// A picture as a cup icon: same size and texture format as the pack's first icon.
async function encodeIcon(tree: any, picture: Uint8Array) {
  const template = iconName(tree, 0) || iconName(tree, 1);
  if (!template) throw new Error("This pack has no cup icons to copy the format from");
  return pictureAsTPL(findFile(tree, template).data as Uint8Array, picture);
}

// ---- Writing -------------------------------------------------------------------------------------
// The archive as it is written (Yaz0), so its CRC-32 is the one of the file in the pack.
async function trackBytes(path: string): Promise<Uint8Array> {
  const file = await api.readPath(path);
  if (isYaz0(file.data)) return file.data;
  const plain = isU8(file.data) ? file.data : await api.decodeArchiveBytes(file.data, file.path, editor.commonPath || editor.partsFolder());
  if (!isU8(plain)) throw new Error(`${file.name} is not a track archive`);
  return yaz0Compress(plain);
}

export async function buildPackWrites(pack: PulsarPack, a: any, progress?: (text: string) => void) {
  const say = (t: string) => progress?.(t);
  const { config, text } = pack;
  const writes: Write[] = [];
  const notes: string[] = [];

  // Pulsar identifies a track by the CRC stored for it: its Time Trial ghosts (Ghosts/<CRC>), trophies
  // and leaderboards. Moved tracks keep theirs. A new track gets the CRC-32 of its archive, as the
  // Pack Creator computes it; packs are often built from other copies of the files, so this cannot
  // match a value computed elsewhere, but it only has to be unique: when another track of the pack
  // already has it (the same file in two places, for example), it is varied until it is unique.
  const crcs = new Map<number, number>();
  const used = new Set<number>(a.tracks.filter((t: any) => t.from !== null && !t.file).map((t: any) => config.tracks[t.from].crc));
  const uniqueCRC = (data: Uint8Array, index: number) => {
    let crc = crc32(data);
    for (let k = 0; !crc || used.has(crc); k++) crc = crc32(Uint8Array.from([...new TextEncoder().encode(`${index}:${k}:`), ...data.subarray(0, 4096)]));
    used.add(crc);
    return crc;
  };
  const newTracks: string[] = [];
  for (const [i, t] of a.tracks.entries()) {
    if (t.from === i && !t.file && !t.duplicate) continue;
    if (t.from === null && !t.file) throw new Error(`Cup ${Math.floor(i / 4) + 1}, position ${i % 4 + 1} has no track yet`);
    if (t.file) {
      say(`Reading ${t.file.path.split(/[\\/]/).pop()}…`);
      const data = await trackBytes(t.file.path);
      crcs.set(i, uniqueCRC(data, i));
      newTracks.push(`${t.name ?? t.file.label} = ${crcs.get(i)!.toString(16).toUpperCase().padStart(8, "0")}`);
      writes.push({ path: join(pack.tracks, trackFile(i)), data, what: trackFile(i), source: t.file.path });
    } else {
      const variants = config.tracks[t.from].variants.length;
      for (let v = 0; v <= variants; v++) {
        say(`Reading ${trackFile(t.from, v)}…`);
        const file = await api.readPath(join(pack.tracks, trackFile(t.from, v)));
        if (v === 0 && t.duplicate) {
          crcs.set(i, uniqueCRC(file.data, i));
          newTracks.push(`${trackName(a, i, pulsarNames(text))} = ${crcs.get(i)!.toString(16).toUpperCase().padStart(8, "0")}`);
        }
        writes.push({ path: join(pack.tracks, trackFile(i, v)), data: file.data, what: trackFile(i, v) });
      }
    }
    // Expert ghosts belong to the track: they move with it, or go when the track is new.
    for (const mode of EXPERT_MODES) {
      const to = join(pack.experts, expertFile(i, mode));
      if (t.from !== null) {
        const from = join(pack.experts, expertFile(t.from, mode));
        if (await api.exists(from)) { const data = (await api.readPath(from)).data; writes.push({ path: to, data, what: expertFile(i, mode) }); continue; }
      }
      if (await api.exists(to)) writes.push({ path: to, data: new Uint8Array(), remove: true, what: expertFile(i, mode) });
    }
  }

  // Cup icons move with their cup; new cups get the icon chosen for them (or the first cup's).
  const iconsChanged = a.cups.some((c: any, i: number) => c.from !== i || c.icon);
  let iconCount = config.info.iconCount;
  if (iconsChanged || a.cups.length !== config.cupCount) {
    say("Reading the cup icons…");
    const original = await uiTree(pack);
    const tree = parseU8(buildU8(original));
    let changed = false;
    // Every folder that holds the pack's icons (button/timg for the cup buttons, control/timg for
    // the other layouts): the first icon found is not always the buttons' one.
    const first = iconName(original, 0);
    const dirs = [...new Set(listFiles(original).filter((f: any) => first && f.path.split("/").pop() === first).map((f: any) => f.path.replace(/[^/]+$/, "")))];
    if (!dirs.length) dirs.push("button/timg/");
    for (const [c, cup] of a.cups.entries()) {
      if (cup.from === c && !cup.icon) continue;
      if (cup.from === null && !cup.icon && iconName(original, c)) continue;
      const target = iconName(original, c) || `icon_${String(c).padStart(first?.match(/\d+/)?.[0].length || 3, "0")}.tpl`;
      let data: Uint8Array | null = null;
      if (cup.icon) data = await encodeIcon(original, (await api.readPath(cup.icon.path)).data);
      else if (cup.from !== null && iconName(original, cup.from)) data = findFile(original, iconName(original, cup.from)!).data;
      else if (iconName(original, 0)) data = findFile(original, iconName(original, 0)!).data;
      if (!data) continue;
      for (const dir of dirs) setFilePath(tree, dir + target, data);
      changed = true;
    }
    if (iconCount >= config.cupCount) iconCount = a.cups.length;
    if (changed) writes.push({ path: pack.uiAssets, data: buildU8(tree), compress: "yaz0", what: "UIAssets.szs" });
  }

  // Config.pul: tracks, alphabetical order, names and file list.
  say("Writing the cups into Config.pul…");
  const tracks = plannedTracks(config, a, (_path: string, i: number) => crcs.get(i) ?? 0);
  // The pack's list of ghost folders (for the people who maintain it) gets the new tracks.
  const folders = join(parent(pack.experts), "FolderToTrackName.txt");
  const hasList = await api.exists(folders);
  if (newTracks.length && (hasList || pack.uiAssetsData)) {
    const before = hasList ? new TextDecoder().decode((await api.readPath(folders)).data) : "";
    const eol = before.includes("\n") && !before.includes("\r\n") ? "\n" : "\r\n";
    writes.push({ path: folders, data: new TextEncoder().encode((before.trim() ? before.replace(/\s*$/, "") + eol : "") + newTracks.join(eol) + eol), what: "FolderToTrackName.txt" });
  }
  await engineVideoWrites(pack, a, writes, say);
  await trackListWrites(pack, a, writes, say);
  await videoWrites(pack, a, writes, say);
  await musicWrites(pack, a, writes, say);
  const parsedBMG = parseBMG(config.bmg);
  const bmg = buildBMG(parsedBMG, pulsarNameChanges(config, a, text), { add: true, repair: zeroAttributeIds(parsedBMG, isPulsarName) });
  const regsMode = a.regsMode ?? config.regsMode;
  if (regsMode !== config.regsMode && ![0, 1, 2].includes(regsMode)) throw new Error("Invalid original-cup setting");
  const next = { ...config, regsMode, tracks, alphabetical: plannedAlphabetical(config, a, text), info: { ...config.info, iconCount } };
  writes.push({ path: pack.configPath, data: buildPulsarConfig(next, bmg, plannedFileSection(config.file, a)), what: "Config.pul" });
  if (pack.play && !pack.play.pending && regsMode !== config.regsMode && await api.exists(pack.play.instructionsPath)) {
    const name = config.folder.replace(/^\//, "");
    const instructions = new TextDecoder().decode((await api.readPath(pack.play.instructionsPath)).data);
    if (instructions.startsWith(`${name} - Riivolution cup pack`)) writes.push({ path: pack.play.instructionsPath, data: new TextEncoder().encode(pulsarInstructions(name, regsMode)), what: "HOW TO PLAY.txt" });
  }
  if (a.cups.length < config.cupCount) notes.push(`The track files of the removed cups stay in the Tracks folder; the game no longer uses them.`);
  return { writes, notes };
}

// Renames a cup or track of the pack in the game text editor: the pack's names are a BMG inside
// Config.pul, edited there and written back into Config.pul. False when the name is not in the
// pack yet (a cup or track added in this window gets its name when the changes are applied).
const hexId = (id: number) => "0x" + id.toString(16).toUpperCase().padStart(4, "0");
async function renameInTextEditor(pack: PulsarPack, id: number) {
  if (pack.text(id) === null) return false;
  const current = parsePulsarConfig((await api.readPath(pack.configPath)).data);
  await dialogs.open("gameText", {
    search: hexId(id),
    loose: { path: null, name: `${pack.config.folder.replace(/^\//, "")} names.bmg`, data: current.bmg },
    saveLoose: async (bmg: Uint8Array) => {
      const now = parsePulsarConfig((await api.readPath(pack.configPath)).data);
      await api.writeFile(pack.configPath, buildPulsarConfig(now, bmg), { backup: editor.settings.keepBackups, edited: true });
      return true;
    },
  });
  return true;
}

// The pack as the Cups window shows it.
export async function pulsarCups(configPath: string): Promise<ModCups> {
  const pack = await loadPulsarPack(configPath);
  const music = await ownMusic(pack);
  pack.muted = music.muted;
  pack.customAudio = music.custom;
  pack.musicBackups = music.backups;
  // (An engine of an earlier version keeps them too: they go into the engine made again.)
  pack.customVideos = pack.videos === "on" || pack.videos === "legacy" ? pulsarCustomVideos((await api.readPath(codePath(pack))).data) : null;
  pack.videoAssets = await assetsAtRoot(pack);
  forgetIcons();
  pack.trackList = await uiTree(pack).then(trackListOf, () => null);
  return packCups(pack, false);
}

// Cup, track and author names (the IDs this editor writes into a pack).
const isPulsarName = (id: number) => id >= PULSAR_IDS.cup && id < PULSAR_IDS.author + 0x10000;

// Menu videos (see pulsar-code.js). Turning them on keeps the engine as it was beside it
// (Code.pul.original), so they can be turned off again whatever the pack's Pulsar version.
const codePath = (pack: PulsarPack) => join(pack.root, "Binaries", "Code.pul");
const originalCodePath = (pack: PulsarPack) => join(pack.root, "Binaries", "Code.pul.original");
// Pulsar plays strm/<track number>_n.brstm (and _f, final lap) for a custom track when the file
// exists (BRSTMExpansion.cpp); the pack maps CTBRSTM there. "No music" is a silent stream.
const ctbrstm = (pack: PulsarPack, i: number, lap: "n" | "f") => join(pack.root, "CTBRSTM", `${i}_${lap}.brstm`);
// The pack's own music, CTBRSTM/<track>_n.brstm (and _f): silent streams (No music, small, all
// zeros) and music of its own (its size, normal and final lap together).
async function ownMusic(pack: PulsarPack) {
  const muted = new Set<number>(), custom = new Map<number, number>();
  const dir = join(pack.root, "CTBRSTM");
  const { files, sizes } = await api.listDirSizes(dir, ["brstm"]).catch(() => ({ files: [], sizes: {} }));
  for (const f of files as string[]) {
    const m = /^(\d+)_([nf])\.brstm$/i.exec(f);
    if (!m) continue;
    const i = Number(m[1]), size = sizes[f] || 0;
    if (m[2].toLowerCase() === "n" && size < 300_000) {
      try {
        const channels = decodeBRSTM(parseBRSTM((await api.readPath(join(dir, f))).data));
        if (channels.every((c: Int16Array) => c.every((x) => x === 0))) { muted.add(i); continue; }
      } catch { /* not a stream this editor wrote */ }
    }
    if (!muted.has(i)) custom.set(i, (custom.get(i) || 0) + size);
  }
  for (const i of muted) custom.delete(i);
  // The .bak copies of music of their own (a silent stream is not music to bring back).
  const backups = new Map<number, number>();
  const bak = await api.listDirSizes(dir, ["bak"]).catch(() => ({ files: [], sizes: {} }));
  for (const f of bak.files as string[]) {
    const b = /^(\d+)_([nf])\.brstm\.bak$/i.exec(f);
    if (b) backups.set(Number(b[1]), (backups.get(Number(b[1])) || 0) + (bak.sizes[f] || 0));
  }
  for (const [i, size] of backups) if (size < 600_000) backups.delete(i);
  return { muted, custom, backups };
}

// Music of its own for the pack's tracks: at most this much in all (normal and final lap), so the
// pack stays a size people can copy to an SD card and download.
export const CUSTOM_AUDIO_LIMIT = 500 * 1024 * 1024;
// About how big a converted music is: 32000 Hz stereo DSP-ADPCM (8 bytes per 14 samples and
// channel), normal and final lap.
export const customAudioBytes = (seconds: number) => Math.ceil((seconds * 32000) / 14) * 8 * 2 * 2;
const MB = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;
// What each track plays: no music (silent), music of its own from an audio file, the music of its
// own it had (moved with it), or the music of an original track (no file of its own).
async function musicWrites(pack: PulsarPack, a: any, writes: Write[], say: (t: string) => void) {
  const muted = pack.muted || new Set<number>(), custom = pack.customAudio || new Map<number, number>();
  let template: Uint8Array | null = null, silent: Uint8Array | null = null;
  const gameTemplate = async () => {
    if (template) return template;
    const strm = editor.workspacePath("sound", "strm");
    const listing: string[] = strm ? await api.listDir(strm, ["brstm"]).catch(() => []) : [];
    const name = musicFiles(slotById(8).music, listing).normal;
    if (!strm || !name) throw new Error("The game's music (sound/strm) was not found: choose the game folder to write the pack's music");
    return (template = (await api.readPath(`${strm}\\${name}`)).data);
  };
  let total = 0;
  const own = new Set<number>([...muted, ...custom.keys()]);
  for (const [i, t] of a.tracks.entries()) {
    const from: number | null = t.from;
    const kind = t.audio ? "file" : t.mute === true ? "silent" : t.audio === null || t.mute === false ? "none"
      : from !== null && muted.has(from) ? "silent" : from !== null && custom.has(from) ? "copy" : "none";
    if (kind === "silent") {
      if (from === i && muted.has(i)) continue;
      if (!silent) { say("Writing the silent music…"); silent = await musicLike(await gameTemplate(), silence(), { loop: true, loopStart: 0, volume: 100 }); }
      for (const lap of ["n", "f"] as const) writes.push({ path: ctbrstm(pack, i, lap), data: silent, what: `CTBRSTM/${i}_${lap}.brstm (no music)` });
    } else if (kind === "file" && t.audio.backup) {
      // The music of its own it had before (from track `from`'s .bak copies).
      for (const lap of ["n", "f"] as const) {
        const source = `${ctbrstm(pack, from!, lap)}.bak`;
        if (!(await api.exists(source))) continue;
        const data = (await api.readPath(source)).data;
        total += data.length;
        writes.push({ path: ctbrstm(pack, i, lap), data, what: `CTBRSTM/${i}_${lap}.brstm (its music from before)` });
      }
    } else if (kind === "file") {
      const f = t.audio;
      say(`Converting ${f.label}…`);
      const audio = await decodeFile(f.path, (await api.readPath(f.path)).data);
      for (const lap of ["n", "f"] as const) {
        const data = await musicLike(await gameTemplate(), audio, { loop: f.loop ?? true, loopStart: f.loopStart ?? 0, volume: f.volume ?? 100, speed: lap === "f" && f.finalFaster ? 1.1 : 1 });
        total += data.length;
        writes.push({ path: ctbrstm(pack, i, lap), data, what: `CTBRSTM/${i}_${lap}.brstm (${f.label})` });
      }
    } else if (kind === "copy") {
      total += custom.get(from!) || 0;
      if (from === i) continue;
      for (const lap of ["n", "f"] as const) {
        const source = ctbrstm(pack, from!, lap);
        if (await api.exists(source)) writes.push({ path: ctbrstm(pack, i, lap), data: (await api.readPath(source)).data, what: `CTBRSTM/${i}_${lap}.brstm (from track ${from! + 1})` });
      }
    } else if (own.has(i)) {
      for (const lap of ["n", "f"] as const) writes.push({ path: ctbrstm(pack, i, lap), data: new Uint8Array(), remove: true, keep: true, what: `CTBRSTM/${i}_${lap}.brstm` });
    }
  }
  if (total > CUSTOM_AUDIO_LIMIT) throw new Error(`The pack's own music would take ${MB(total)}, more than the ${MB(CUSTOM_AUDIO_LIMIT)} allowed: use shorter music, or music of the original tracks for some of them`);
}

// Preview videos of custom cups (see pulsar-code.js): a video per custom cup, at most CUSTOM_VIDEOS,
// Assets/thp/course/pulsar_<slot>.thp, made like the game's (four strips of 400 x 144, one per
// track) from the pictures and videos chosen for its tracks; the engine's table says which cup
// plays which file. Made on a game video as the frame (every part covered: none of its picture stays).
const STRIP = (p: number) => ({ x: 0, y: p * 144, width: 400, height: 144 });
// Whether the pack's Riivolution XML maps its Assets folder onto the disc's root, as Pulsar's packs
// do (<folder external="/<pack>/Assets" disc="/" …>): the videos go in Assets/thp/course.
async function assetsAtRoot(pack: PulsarPack) {
  if (pack.uiAssetsData) return true;
  if (!pack.play?.xmlPath || !(await api.exists(pack.play.xmlPath))) return false;
  const xml = new TextDecoder().decode((await api.readPath(pack.play.xmlPath)).data);
  const name = pack.config.folder.replace(/^\//, "");
  const tag = (attribute: string) => new RegExp(`${attribute}="([^"]*)"`, "i");
  return [...xml.matchAll(/<folder\b[^>]*>/gi)].some(([folder]) => tag("external").exec(folder)?.[1]?.toLowerCase() === `/${name}/assets`.toLowerCase() && tag("disc").exec(folder)?.[1] === "/");
}
const videoPath = (pack: PulsarPack, slot: number) => join(pack.root, "Assets", ...customVideoName(slot).split("/"));
// A black video (four strips) for a custom cup of the pack that has none, written now with its place
// in the engine's table, so the preview video editor can open it. Returns its path.
async function createCupVideo(pack: PulsarPack, cup: number, say: (t: string) => void) {
  const map = pack.customVideos;
  if (pack.videos !== "on" || !map) throw new Error("The pack's engine plays no menu videos yet: turn Menu videos on and apply first");
  if (map.has(cup)) return videoPath(pack, map.get(cup)!);
  if (map.size >= CUSTOM_VIDEOS) throw new Error(`${CUSTOM_VIDEOS} custom cups already have a preview video, the most a pack can have`);
  let slot = 0;
  while ([...map.values()].includes(slot)) slot++;
  const game = editor.workspacePath("thp", "course", "kinoko.thp");
  if (!game || !(await api.exists(game))) throw new Error("The game's videos (thp/course) were not found: choose the game folder first");
  say("Making the cup's video…");
  const frame = parseTHP((await api.readPath(game)).data);
  const black = await createImageBitmap(new ImageData(new Uint8ClampedArray([0, 0, 0, 255]), 1, 1));
  const edits: MovieEdit[] = [0, 1, 2, 3].map((p) => ({ rect: STRIP(p), source: { kind: "image", name: "black", bitmap: black }, fit: "stretch" }));
  const data = await renderMovie({ ...frame, frames: frame.frames.slice(0, Math.round(CUSTOM_VIDEO_SECONDS * frame.header.fps)) }, edits);
  const path = videoPath(pack, slot);
  const next = new Map(map).set(cup, slot);
  await api.writeFile(path, data, {});
  await api.writeFile(codePath(pack), setPulsarCustomVideos((await api.readPath(codePath(pack))).data, next), { backup: editor.settings.keepBackups, edited: true });
  pack.customVideos = next;
  return path;
}

async function videoWrites(pack: PulsarPack, a: any, writes: Write[], say: (t: string) => void) {
  const on = pack.videos != null && (a.menuVideos ?? pack.videos !== "off");
  if (!on || !pack.videoAssets) return;
  const before = pack.customVideos || new Map<number, number>();
  type Part = { kind: "black" } | { kind: "file"; path: string; label: string; video: boolean } | { kind: "old"; slot: number; part: number };
  const plan = a.cups.map((cup: any, c: number) => {
    const parts: Part[] = [0, 1, 2, 3].map((p) => {
      const t = a.tracks[c * 4 + p];
      if (!t) return { kind: "black" };
      if (t.video) return { kind: "file", path: t.video.path, label: t.video.label, video: !!t.video.video };
      if (t.video === null || t.from === null) return { kind: "black" };
      const slot = before.get(Math.floor(t.from / 4));
      return slot === undefined ? { kind: "black" } : { kind: "old", slot, part: t.from % 4 };
    });
    const old = cup.from !== null ? before.get(cup.from) : undefined;
    const same = old !== undefined && parts.every((x, p) => x.kind === "old" && x.slot === old && x.part === p);
    return { c, parts, has: parts.some((x) => x.kind !== "black"), same, old };
  });
  const wanted = plan.filter((x: any) => x.has);
  if (wanted.length > CUSTOM_VIDEOS) throw new Error(`${wanted.length} custom cups have a preview video: at most ${CUSTOM_VIDEOS} can (the game has memory for one video at a time, and the engine's table holds ${CUSTOM_VIDEOS})`);
  // Slots: a cup keeps its own; the others take the free ones.
  const taken = new Set<number>(), slots = new Map<number, number>();
  for (const x of wanted) if (x.old !== undefined && !taken.has(x.old)) { slots.set(x.c, x.old); taken.add(x.old); }
  for (const x of wanted) if (!slots.has(x.c)) { let s = 0; while (taken.has(s)) s++; slots.set(x.c, s); taken.add(s); }
  // Files: unchanged, moved to another slot, or made again.
  const oldData = new Map<number, Uint8Array>();
  const read = async (slot: number) => { if (!oldData.has(slot)) oldData.set(slot, (await api.readPath(videoPath(pack, slot))).data); return oldData.get(slot)!; };
  let frame: any = null;
  for (const x of wanted) {
    const slot = slots.get(x.c)!;
    if (x.same && slot === x.old) continue;
    if (x.same) { writes.push({ path: videoPath(pack, slot), data: await read(x.old), what: customVideoName(slot) }); continue; }
    if (!frame) {
      const game = editor.workspacePath("thp", "course", "kinoko.thp");
      if (!game || !(await api.exists(game))) throw new Error("The game's videos (thp/course) were not found: choose the game folder to make the custom cups' videos");
      say("Reading the game's video format…");
      frame = parseTHP((await api.readPath(game)).data);
    }
    const black = await createImageBitmap(new ImageData(new Uint8ClampedArray([0, 0, 0, 255]), 1, 1));
    const edits: MovieEdit[] = [];
    const frames = Math.round(CUSTOM_VIDEO_SECONDS * frame.header.fps);
    for (const [p, part] of x.parts.entries()) {
      if (part.kind === "black") { edits.push({ rect: STRIP(p), source: { kind: "image", name: "black", bitmap: black }, fit: "stretch" }); continue; }
      if (part.kind === "old") {
        const thp = parseTHP(await read(part.slot));
        edits.push({ rect: STRIP(p), source: { kind: "thp", name: customVideoName(part.slot), thp, rect: STRIP(part.part) }, fit: "stretch" });
        continue;
      }
      const blob = new Blob([(await api.readPath(part.path)).data as BlobPart]);
      if (part.video) {
        const source: any = await loadVideo(blob, part.label);
        edits.push({ rect: STRIP(p), source, fit: "fill" });
      } else edits.push({ rect: STRIP(p), source: { kind: "image", name: part.label, bitmap: await createImageBitmap(blob) }, fit: "fill" });
    }
    const movie = { ...frame, frames: frame.frames.slice(0, Math.min(frame.frames.length, frames)) };
    const name = customVideoName(slot);
    const data = await renderMovie(movie, edits, (done, total) => say(`Making the video of ${a.cups[x.c].name ?? `cup ${x.c + 1}`}: frame ${done} of ${total}…`));
    writes.push({ path: videoPath(pack, slot), data, what: name });
  }
  for (const [, slot] of before) if (!taken.has(slot) && await api.exists(videoPath(pack, slot))) writes.push({ path: videoPath(pack, slot), data: new Uint8Array(), remove: true, what: customVideoName(slot) });
  // The engine's table.
  const engineWrite = writes.find((w) => w.path === codePath(pack));
  const engine = engineWrite ? engineWrite.data : (await api.readPath(codePath(pack))).data;
  if (pulsarMenuVideos(engine) !== "on") return;
  const table = new Map([...slots].map(([c, slot]) => [c, slot]));
  const next = setPulsarCustomVideos(engine, table);
  const now = pulsarCustomVideos(engine);
  if (now && now.size === table.size && [...table].every(([c, s]) => now.get(c) === s)) return;
  if (engineWrite) engineWrite.data = next;
  else writes.push({ path: codePath(pack), data: next, what: "Code.pul (custom cups' videos)" });
}

async function engineVideoWrites(pack: PulsarPack, a: any, writes: Write[], say: (t: string) => void) {
  if (pack.videos == null || a.menuVideos === undefined || (a.menuVideos === (pack.videos === "on") && pack.videos !== "legacy")) return;
  say(a.menuVideos ? "Turning on the menu videos in the engine…" : "Turning off the menu videos in the engine…");
  let current = pack.uiAssetsData ? await engineFile("Code.pul") : (await api.readPath(codePath(pack))).data;
  let original = !pack.uiAssetsData && await api.exists(originalCodePath(pack)) ? (await api.readPath(originalCodePath(pack))).data : null;
  const bundled = await engineFile("Code.pul");
  const same = (x: Uint8Array, y: Uint8Array) => x.length === y.length && x.every((b, i) => b === y[i]);
  // An engine changed by an earlier version (videos of other cups) is redone from the original:
  // Code.pul.original, or the engine this editor brings when the pack was made with it.
  const legacy = pack.videos === "legacy";
  if (legacy && !(original && pulsarMenuVideos(original) === "off") && earlierPulsarMenuVideos(bundled).some((earlier) => same(earlier, withoutCustomVideos(current)))) original = bundled;
  if (legacy && !(original && pulsarMenuVideos(original) === "off")) throw new Error("The engine's original Code.pul (Code.pul.original) was not found: restore Binaries/Code.pul from Backups, then turn the menu videos on again");
  if (a.menuVideos) {
    const base = legacy ? original! : current;
    writes.push({ path: codePath(pack), data: enablePulsarMenuVideos(base), what: "Code.pul (menu videos on)" });
    if (!pack.uiAssetsData && !legacy) writes.push({ path: originalCodePath(pack), data: current, what: "Code.pul.original" });
    return;
  }
  // The custom cups' table does not count: an engine with videos for some custom cups is the same.
  current = withoutCustomVideos(current);
  const restored = legacy ? original
    : original && pulsarMenuVideos(original) === "off" && same(enablePulsarMenuVideos(original), current) ? original
    : same(enablePulsarMenuVideos(bundled), current) ? bundled : null;
  if (!restored) throw new Error("The engine's original Code.pul was not found: restore Binaries/Code.pul from Backups to turn the menu videos off");
  writes.push({ path: codePath(pack), data: restored, what: "Code.pul (menu videos off)" });
  if (original) writes.push({ path: originalCodePath(pack), data: new Uint8Array(), remove: true, what: "Code.pul.original" });
}

function packCups(pack: PulsarPack, creating: boolean): ModCups {
  const raceSlots = SLOTS.filter((s: any) => !s.battle);
  // Names written by earlier versions with all-zero BMG attributes show in the game's capital-only
  // button font ("N?? M? C??"): applying the pack writes them with the full font.
  const repair = creating ? 0 : zeroAttributeIds(parseBMG(pack.config.bmg), isPulsarName).length;
  return {
    videos: pack.videos ?? null,
    repair: [
      repair ? `${repair} name${repair === 1 ? "" : "s"} of this pack show question marks in the game (they were written without their font): Apply changes writes them with the game's full font.` : "",
      pack.videos === "legacy" ? "The menu videos were turned on by an earlier version of this editor, with some videos in the wrong place (another cup's video, or the wrong parts when a page first opens). Apply changes puts each original cup's video in place and gives custom cups none (PAL games), or turns them off if you untick Menu videos." : "",
      pack.videos === "on" && pack.trackList === "pulsar" ? "The track names of the cup selection are not over the menu video (Pulsar moves them left, so the video looks cut): Apply changes puts them back where the game has them." : "",
    ].filter(Boolean).join(" ") || undefined,
    kind: "pulsar", title: `${pack.config.folder.replace(/^\//, "")} (Pulsar)`, cupCount: pack.config.cupCount, capacity: 16383, play: pack.play, regsMode: pack.config.regsMode,
    names: pulsarNames(pack.text), hasAuthors: true,
    slotOf: (from) => pack.config.tracks[from].slot, musicOf: (from) => pack.config.tracks[from].music,
    mutedOf: (from) => !!pack.muted?.has(from),
    customAudioOf: (from) => pack.customAudio?.get(from) || 0,
    musicBackupOf: (from) => pack.musicBackups?.get(from) || 0,
    audioLimit: CUSTOM_AUDIO_LIMIT,
    videoOfCup: (cupFrom) => !!pack.customVideos?.has(cupFrom),
    videoFileOf: (cupFrom) => pack.customVideos?.has(cupFrom) ? videoPath(pack, pack.customVideos.get(cupFrom)!) : null,
    videoName: (cupFrom) => pack.customVideos?.has(cupFrom) ? customVideoName(pack.customVideos.get(cupFrom)!).replace(/^thp\//, "") : null,
    createCupVideo: (cupFrom, say) => createCupVideo(pack, cupFrom, say),
    videoReady: pack.videos === "on",
    customVideos: pack.videos != null && pack.videoAssets ? CUSTOM_VIDEOS : 0,
    musicOptions: raceSlots.map((s: any) => ({ value: s.id, label: s.label })),
    fileOf: (position) => `Tracks/${trackFile(position)}`,
    trackPath: (from) => join(pack.tracks, trackFile(from)),
    icon: (cup) => packIconURL(pack, cup),
    build: (a, progress) => (creating ? buildNewPack(pack, a, progress) : buildPackWrites(pack, a, progress)),
    rename: creating ? undefined : (what) => renameInTextEditor(pack, "cup" in what ? PULSAR_IDS.cup + what.cup : PULSAR_IDS.track + what.track),
    written: creating
      ? `Written: a new Riivolution cup pack in ${pack.root}, its patch XML and instructions. Load the XML with Pack set to Enabled to use the extra cups. Keep original game cups makes your cups coexist with the game's eight.`
      : "Written: the track archives in the pack's Tracks folder, Binaries/Config.pul (cups, names, alphabetical order), the cup icons in Assets/UIAssets.szs when they change, and the expert ghosts that belong to moved tracks. The pack's other settings are kept as they are.",
  };
}

// ---- A new pack -----------------------------------------------------------------------------------
// The engine files are served with the editor (vendor/pulsar, MIT, see its NOTICE.md).
const engineFile = async (name: string) => {
  const response = await fetch(`pulsar/${name}`);
  if (!response.ok) throw new Error(`Could not load the cup pack's ${name} (HTTP ${response.status})`);
  const data = new Uint8Array(await response.arrayBuffer());
  if (!data.length) throw new Error(`The cup pack's ${name} is empty`);
  return data;
};
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const be32 = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

// Config.pul of a pack without custom cups yet, like the Pack Creator writes it with its default
// settings: the game's 8 cups first (regulars mode 1), engine classes 10% 100cc / 65% 150cc / 25%
// mirror, vote timer 10 s, and the engine's own texts.
async function emptyConfig(name: string) {
  const date = new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  const header = [...ascii("PULS"), ...be32(3), ...be32(0x24), ...be32(0x74), ...be32(0), ...ascii(`/${name}`.padEnd(16, "\0"))];
  const info = [
    ...ascii("INFO"), ...be32(1), ...be32(0x50),
    ...be32((Math.random() * 0xffffffff) >>> 0), ...be32(10), ...be32(65), ...be32(0), ...be32(0),
    0, 0, 0, 0, 0, 0, 0, 10, ...new Array(40).fill(0),
  ];
  const cups = [...ascii("CUPS"), ...be32(3), ...be32(28), 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...be32(0)];
  const bmg = bmgFromText(new TextDecoder().decode(await engineFile("BMG.txt")), { CC: "100", date }, [[0x2847, `Version created ${date}`]]);
  const all = [...header, ...info, ...cups];
  const out = Uint8Array.from([...all, ...bmg, ...ascii("FILE\r\n")]);
  new DataView(out.buffer).setInt32(16, all.length);
  return out;
}

// A new pack named \`name\` in \`folder\` (usually the root of an SD card): \`folder\\<name>\` and
// \`folder\\riivolution\\<name>.xml\`. Nothing is written until the cups are applied.
export async function newPulsarCups(name: string, folder: string): Promise<ModCups> {
  const root = join(folder, name);
  const configPath = join(root, "Binaries", "Config.pul");
  const pack = await loadPulsarPack(configPath, await emptyConfig(name));
  pack.uiAssetsData = await engineFile("UIAssets.szs");
  pack.videos = pulsarMenuVideos(await engineFile("Code.pul"));
  pack.play = { ...pulsarLaunchPaths(name, folder), pending: true };
  forgetIcons();
  const cups = packCups(pack, true);
  return { ...cups, kind: "pulsar-new", title: `${name} (new Pulsar mod)` };
}

async function buildNewPack(pack: PulsarPack, a: any, progress: (text: string) => void) {
  const { writes, notes } = await buildPackWrites(pack, a, progress);
  const name = pack.config.folder.replace(/^\//, "");
  progress("Adding the Pulsar engine…");
  for (const [file, to] of [["Code.pul", "Binaries"], ["Loader.pul", "Binaries"], ["CommonAssets.szs", "Assets"], ["RaceAssets.szs", "Assets"]]) {
    // The engine is written once: with the menu videos turned on when they were chosen.
    if (file === "Code.pul" && writes.some((w) => w.path === codePath(pack))) continue;
    writes.push({ path: join(pack.root, to, file), data: await engineFile(file), what: file });
  }
  if (!writes.some((w) => w.path === pack.uiAssets)) writes.push({ path: pack.uiAssets, data: pack.uiAssetsData!, what: "UIAssets.szs" });
  const launch = buildPulsarLaunch(new TextDecoder().decode(await engineFile("Base.xml")), name, parent(pack.root), a.regsMode ?? pack.config.regsMode);
  writes.push({ path: launch.paths.xmlPath, data: new TextEncoder().encode(launch.xml), what: `${name}.xml` });
  writes.push({ path: launch.paths.instructionsPath, data: new TextEncoder().encode(launch.instructions), what: "HOW TO PLAY.txt" });
  // The folders the XML maps: they hold the expert ghosts and custom music later.
  for (const dir of ["Ghosts\\Experts", "CTBRSTM", "My Stuff"]) writes.push({ path: join(pack.root, dir, "README.txt"), data: new TextEncoder().encode("Folder of the Pulsar pack, mapped by its Riivolution XML.\r\n"), what: `${dir}\\README.txt` });
  notes.push(`Load riivolution/${name}.xml with Riivolution and enable ${name} → Pack to use these cups.`);
  return { writes, notes };
}

export { PULSAR_IDS };
