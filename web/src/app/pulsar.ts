// Files of a Pulsar pack for the Cups window: the pack's Config.pul, its Tracks folder, its cup
// icons (Assets/UIAssets.szs) and its expert ghosts (Ghosts/Experts, one per track and mode, which
// follow their track). Only the cups and tracks are edited; every other setting of the pack is kept.

import { api } from "../../js/api.js";
import { buildBMG, parseBMG } from "../../js/formats/bmg.js";
import { PULSAR_IDS, buildPulsarConfig, crc32, parsePulsarConfig } from "../../js/formats/pulsar.js";
import { EXPERT_MODES, expertFile, plannedAlphabetical, plannedFileSection, plannedTracks, pulsarNameChanges, pulsarNames, trackFile, trackName } from "../../js/data/pulsar-cups.js";
import { SLOTS } from "../../js/data/cups.js";
import type { ModCups } from "./dialogs/PulsarCupsView";
import { parseTPL } from "../../js/formats/brlyt.js";
import { decodeTexture, encodeTextureLevels } from "../../js/formats/brres.js";
import { buildU8, findFile, isU8, listFiles, parseU8, setFilePath } from "../../js/formats/u8.js";
import { isYaz0, yaz0Compress } from "../../js/formats/yaz0.js";
import { editor } from "./editor";
import { dialogs } from "./dialogs-store";
import { bmgFromText } from "../../js/formats/bmg-text.js";
import type { Write } from "./cups";
import { buildPulsarLaunch, pulsarInstructions, pulsarLaunchPaths } from "../../js/editor/pulsar-launch.js";

export type PulsarPack = {
  configPath: string; root: string; config: any; text: (id: number) => string | null;
  uiAssets: string; tracks: string; experts: string;
  // A pack being created: its menu archive is the engine's default one, not yet on disk.
  uiAssetsData?: Uint8Array;
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
  return {
    configPath, root, config, text: (id) => messages.get(id) ?? null, play,
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
  const base = findFile(tree, template).data as Uint8Array;
  const [{ image }] = parseTPL(base);
  const bitmap = await createImageBitmap(new Blob([picture as BlobPart]));
  const canvas = new OffscreenCanvas(image.width, image.height), ctx = canvas.getContext("2d")!;
  const scale = Math.min(image.width / bitmap.width, image.height / bitmap.height);
  ctx.drawImage(bitmap, (image.width - bitmap.width * scale) / 2, (image.height - bitmap.height * scale) / 2, bitmap.width * scale, bitmap.height * scale);
  const rgba = new Uint8Array(ctx.getImageData(0, 0, image.width, image.height).data.buffer);
  const out = base.slice();
  const view = new DataView(out.buffer);
  const dataOffset = view.getUint32(view.getUint32(view.getUint32(8)) + 8); // table -> image header -> data
  encodeTextureLevels(out, dataOffset, out.length, rgba, image.width, image.height, image.format, 1);
  return out;
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
    for (const [c, cup] of a.cups.entries()) {
      if (cup.from === c && !cup.icon) continue;
      if (cup.from === null && !cup.icon && iconName(original, c)) continue;
      const target = iconName(original, c) || `icon_${String(c).padStart(iconName(original, 0)?.match(/\d+/)?.[0].length || 3, "0")}.tpl`;
      const dir = listFiles(original).find((f: any) => f.path.endsWith(iconName(original, 0) || ""))?.path.replace(/[^/]+$/, "") || "button/timg/";
      let data: Uint8Array | null = null;
      if (cup.icon) data = await encodeIcon(original, (await api.readPath(cup.icon.path)).data);
      else if (cup.from !== null && iconName(original, cup.from)) data = findFile(original, iconName(original, cup.from)!).data;
      else if (iconName(original, 0)) data = findFile(original, iconName(original, 0)!).data;
      if (!data) continue;
      setFilePath(tree, dir + target, data);
      // The control layouts (control/timg) use the same icons when the pack has them there too.
      const control = `control/timg/${target}`;
      if (listFiles(original).some((f: any) => f.path === control)) setFilePath(tree, control, data);
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
  const bmg = buildBMG(parseBMG(config.bmg), pulsarNameChanges(config, a, text), { add: true });
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
  forgetIcons();
  return packCups(pack, false);
}

function packCups(pack: PulsarPack, creating: boolean): ModCups {
  const raceSlots = SLOTS.filter((s: any) => !s.battle);
  return {
    kind: "pulsar", title: `${pack.config.folder.replace(/^\//, "")} (Pulsar)`, cupCount: pack.config.cupCount, capacity: 16383, play: pack.play, regsMode: pack.config.regsMode,
    names: pulsarNames(pack.text), hasAuthors: true,
    slotOf: (from) => pack.config.tracks[from].slot, musicOf: (from) => pack.config.tracks[from].music,
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
