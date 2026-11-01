// Cups of an LE-CODE distribution (Wiimm's engine, rel/lecode-*.bin) for the Cups window. In
// LE-CODE a cup lists four track slots, so moving tracks between cups only changes those lists;
// the track files (Race/Course/<slot>.szs) stay where they are. A track from a file gets a new
// slot. Names are in Common.bmg of every language archive (track 0x7000 + slot, cup 0x6800 + cup)
// and the cup icons are one tall picture, ct_icons.tpl, in the menu archives.

import { api } from "../../js/api.js";
import { SLOTS } from "../../js/data/cups.js";
import { cupName, trackName } from "../../js/data/pulsar-cups.js";
import { buildBMG, parseBMG } from "../../js/formats/bmg.js";
import { LE_FIRST_CUSTOM_SLOT, LE_IDS, buildLECode, leTrackFile, parseLECode } from "../../js/formats/lecode.js";
import { parseTPL } from "../../js/formats/brlyt.js";
import { decodeTexture, encodeTextureLevels } from "../../js/formats/brres.js";
import { buildU8, findFile, isU8, listFiles, parseU8, setFilePath } from "../../js/formats/u8.js";
import { isYaz0, yaz0Compress } from "../../js/formats/yaz0.js";
import { editor } from "./editor";
import { dialogs } from "./dialogs-store";
import { readGameNames, type Write } from "./cups";
import type { ModCups } from "./dialogs/PulsarCupsView";

const REGIONS = ["PAL", "USA", "JAP", "KOR"];
const ICON_ARCHIVES = ["MenuSingle.szs", "MenuMulti.szs", "Channel.szs"];
const languageArchive = (name: string) => /_[A-Z]\.szs$/i.test(name);

// The LE-CODE binaries of the workspace, one per region present.
export async function findLECode(): Promise<string[]> {
  const out: string[] = [];
  for (const r of REGIONS) {
    const path = editor.workspacePath("rel", `lecode-${r}.bin`);
    if (path && (await api.exists(path))) out.push(path);
  }
  return out;
}

// Bytes per texture of a GX format (block width, height, bits per pixel).
const BLOCKS: Record<number, [number, number, number]> = { 0: [8, 8, 4], 1: [8, 4, 8], 2: [8, 4, 8], 3: [4, 4, 16], 4: [4, 4, 16], 5: [4, 4, 16], 6: [4, 4, 32], 14: [8, 8, 4] };
const textureBytes = (format: number, w: number, h: number) => { const [bw, bh, bits] = BLOCKS[format]; return Math.ceil(w / bw) * Math.ceil(h / bh) * bw * bh * bits / 8; };

// A TPL like `template` (same format and settings) holding `rgba` at a new height.
function rebuildTPL(template: Uint8Array, width: number, height: number, rgba: Uint8Array) {
  const view = new DataView(template.buffer, template.byteOffset, template.byteLength);
  const header = view.getUint32(view.getUint32(8)), format = view.getUint32(header + 4), dataOffset = view.getUint32(header + 8);
  const out = new Uint8Array(dataOffset + textureBytes(format, width, height));
  out.set(template.subarray(0, dataOffset));
  const v = new DataView(out.buffer);
  v.setUint16(header, height); v.setUint16(header + 2, width);
  encodeTextureLevels(out, dataOffset, out.length, rgba, width, height, format, 1);
  return out;
}

export async function leCodeCups(paths: string[]): Promise<ModCups> {
  const bins = await Promise.all(paths.map(async (path) => ({ path, le: parseLECode((await api.readPath(path)).data) })));
  const main = bins[0].le;
  const names = await readGameNames();
  const text = (id: number) => names?.text(id) ?? null;
  const slotAt = (from: number) => main.cups[Math.floor(from / 4)][from % 4];
  const course = editor.workspacePath("Race", "Course");
  const listing: string[] = course ? await api.listDir(course, ["szs"]).catch(() => []) : [];
  const wide = listing.some((f) => /^[0-9a-f]{4}\.szs$/i.test(f)) && !listing.some((f) => /^[0-9a-f]{3}\.szs$/i.test(f));
  const file = (slot: number) => leTrackFile(slot, wide || slot >= 0x1000);

  // Music choices: the music each original track and arena has in this distribution.
  const musicOptions: { value: number; label: string }[] = [];
  for (const s of SLOTS) { const m = main.slots[s.id]?.music; if (m !== undefined && !musicOptions.some((o) => o.value === m)) musicOptions.push({ value: m, label: s.label }); }

  // Cup icons: one 128-pixel square per cup, one under the other.
  let strip: Promise<{ tpl: Uint8Array; width: number; height: number; rgba: Uint8Array } | null> | null = null;
  const readStrip = () => strip ||= (async () => {
    const ui = editor.workspacePath("Scene", "UI");
    for (const archive of ICON_ARCHIVES) {
      try {
        const f = await api.readPath(`${ui}\\${archive}`);
        const node = findFile(parseU8(await api.decodeArchiveBytes(f.data, f.path)), "ct_icons.tpl");
        if (!node) continue;
        const [{ image, palette }] = parseTPL(node.data);
        return { tpl: node.data as Uint8Array, width: image.width, height: image.height, rgba: decodeTexture(image, palette) as Uint8Array };
      } catch { /* next archive */ }
    }
    return null;
  })();
  const iconCache = new Map<number, string>();
  const icon = async (cup: number) => {
    if (iconCache.has(cup)) return iconCache.get(cup)!;
    const s = await readStrip();
    if (!s || (cup + 1) * s.width > s.height) return "";
    const canvas = document.createElement("canvas");
    canvas.width = s.width; canvas.height = s.width;
    canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(s.rgba.subarray(cup * s.width * s.width * 4, (cup + 1) * s.width * s.width * 4)), s.width, s.width), 0, 0);
    const url = canvas.toDataURL("image/png");
    iconCache.set(cup, url);
    return url;
  };

  // Original tracks and arenas without an LE-CODE name keep the game's own name.
  const original = (slot: number) => (slot < 0x20 ? text(0x2454 + slot) : slot < 0x2a ? text(0x24b8 + slot - 0x20) : null) ?? SLOTS.find((s: any) => s.id === slot)?.label ?? null;
  const modNames = { track: (from: number) => text(LE_IDS.track + slotAt(from)) ?? original(slotAt(from)), author: () => null, cup: (from: number) => text(LE_IDS.cup + from) };

  const build = async (a: any, progress: (t: string) => void) => {
    const writes: Write[] = [], notes: string[] = [];
    const slots = main.slots.map((s: any) => ({ ...s }));
    const cups: number[][] = [];
    const trackNames: Record<number, string> = {};
    for (const [i, t] of a.tracks.entries()) {
      let slot: number;
      if (t.file) {
        // Custom tracks use slots from 0x44 (below are the original tracks, arenas and random slots).
        while (slots.length < LE_FIRST_CUSTOM_SLOT) slots.push({ property: slots.length < 0x2a ? slots.length : 0, music: main.slots[slots.length]?.music ?? 0, flags: 0 });
        slot = slots.length;
        slots.push({ property: t.slot ?? 0x08, music: t.music ?? main.slots[0x08].music, flags: 0 });
        progress(`Reading ${t.file.path.split(/[\\/]/).pop()}…`);
        const f = await api.readPath(t.file.path);
        const plain = isYaz0(f.data) ? null : isU8(f.data) ? f.data : await api.decodeArchiveBytes(f.data, f.path, editor.commonPath || editor.partsFolder());
        if (plain && !isU8(plain)) throw new Error(`${f.name} is not a track archive`);
        writes.push({ path: editor.workspacePath("Race", "Course", file(slot)), data: plain ? yaz0Compress(plain) : f.data, what: file(slot), source: t.file.path });
      } else if (t.from !== null) {
        slot = slotAt(t.from);
        if (t.slot !== undefined) slots[slot].property = t.slot;
        if (t.music !== undefined) slots[slot].music = t.music;
      } else throw new Error(`Cup ${Math.floor(i / 4) + 1}, position ${i % 4 + 1} has no track yet`);
      if (t.name !== undefined || t.file) trackNames[LE_IDS.track + slot] = trackName(a, i, modNames);
      (cups[Math.floor(i / 4)] ||= []).push(slot);
    }

    // The binaries of every region get the same cups and tracks.
    for (const { path, le } of bins) {
      progress(`Writing ${path.split(/[\\/]/).pop()}…`);
      const regionSlots = slots.map((s: any, i: number) => (i < le.slots.length && i < main.slots.length && le.slots[i].property === main.slots[i].property ? { ...le.slots[i], property: s.property, music: s.music } : s));
      writes.push({ path, data: buildLECode(le, cups, regionSlots), what: path.split(/[\\/]/).pop()! });
    }

    // Names in every language archive.
    const changes: Record<number, string> = { ...trackNames };
    a.cups.forEach((cup: any, c: number) => { const name = cupName(a, c, modNames); if (cup.from !== c || cup.name !== undefined || text(LE_IDS.cup + c) !== name) changes[LE_IDS.cup + c] = name; });
    const ui = editor.workspacePath("Scene", "UI");
    const archives: string[] = ui ? (await api.listDir(ui, ["szs"]).catch(() => [])).filter(languageArchive) : [];
    for (const name of archives) {
      progress(`Writing names in ${name}…`);
      const f = await api.readPath(`${ui}\\${name}`);
      const tree = parseU8(await api.decodeArchiveBytes(f.data, f.path));
      let changed = false;
      for (const entry of listFiles(tree)) {
        if (!/(^|\/)Common\.bmg$/i.test(entry.path)) continue;
        const bmg = parseBMG(entry.node.data);
        const own = new Map(bmg.messages.map((m: any) => [m.id, m.text]));
        const local = Object.fromEntries(Object.entries(changes).filter(([id, value]) => own.get(Number(id)) !== value));
        if (!Object.keys(local).length) continue;
        setFilePath(tree, entry.path, buildBMG(bmg, local, { add: true }));
        changed = true;
      }
      if (changed) writes.push({ path: `${ui}\\${name}`, data: buildU8(tree), compress: "yaz0", what: name });
    }
    if (!archives.length) notes.push("No game text (Scene/UI) found: the names in the menus stay as they are.");

    // Cup icons: the squares follow their cup; new cups get their picture (or the first cup's).
    if (a.cups.some((c: any, i: number) => c.from !== i || c.icon) || a.cups.length !== main.cups.length) {
      const s = await readStrip();
      if (!s) notes.push("No ct_icons.tpl in the menu archives: the cup icons stay as they are.");
      else {
        const size = s.width * s.width * 4, height = Math.max(s.height, a.cups.length * s.width);
        const rgba = new Uint8Array(s.width * height * 4);
        rgba.set(s.rgba.subarray(0, Math.min(s.rgba.length, rgba.length)));
        for (const [c, cup] of a.cups.entries()) {
          let square: Uint8Array | null = null;
          if (cup.icon) {
            const bitmap = await createImageBitmap(new Blob([(await api.readPath(cup.icon.path)).data]));
            const canvas = new OffscreenCanvas(s.width, s.width), ctx = canvas.getContext("2d")!;
            const k = Math.min(s.width / bitmap.width, s.width / bitmap.height);
            ctx.drawImage(bitmap, (s.width - bitmap.width * k) / 2, (s.width - bitmap.height * k) / 2, bitmap.width * k, bitmap.height * k);
            square = new Uint8Array(ctx.getImageData(0, 0, s.width, s.width).data.buffer);
          } else if (cup.from !== c) {
            const from = cup.from ?? 0;
            if ((from + 1) * size <= s.rgba.length) square = s.rgba.subarray(from * size, (from + 1) * size);
          }
          if (square) rgba.set(square, c * size);
        }
        const tpl = rebuildTPL(s.tpl, s.width, height, rgba);
        for (const archive of ICON_ARCHIVES) {
          const path = `${ui}\\${archive}`;
          if (!(await api.exists(path))) continue;
          progress(`Writing the cup icons in ${archive}…`);
          const f = await api.readPath(path);
          const tree = parseU8(await api.decodeArchiveBytes(f.data, f.path));
          const targets = listFiles(tree).filter((e: any) => /(^|\/)ct_icons\.tpl$/i.test(e.path));
          if (!targets.length) continue;
          for (const e of targets) setFilePath(tree, e.path, tpl);
          writes.push({ path, data: buildU8(tree), compress: "yaz0", what: archive });
        }
      }
    }
    if (a.cups.length < main.cups.length) notes.push("The tracks of the removed cups stay in Race/Course and keep their slots.");
    return { writes, notes };
  };

  return {
    kind: "lecode", title: `LE-CODE ${main.version || ""}`.trim(), cupCount: main.cups.length,
    capacity: Math.min(...bins.map((b) => b.le.capacity.cups)),
    names: modNames, hasAuthors: false,
    slotOf: (from) => main.slots[slotAt(from)]?.property ?? 0x08, musicOf: (from) => main.slots[slotAt(from)]?.music ?? 0,
    musicOptions,
    fileOf: (_position, from) => (from === null ? "new slot" : `Race/Course/${file(slotAt(from))}`),
    trackPath: (from) => course ? `${course}\\${file(slotAt(from))}` : "",
    icon, build,
    // Names that are in the game text open in the game text editor (every language archive).
    rename: async (what) => {
      const id = "cup" in what ? LE_IDS.cup + what.cup : LE_IDS.track + slotAt(what.track);
      if (text(id) === null) return false;
      await dialogs.open("gameText", { search: "0x" + id.toString(16).toUpperCase().padStart(4, "0") });
      return true;
    },
    written: `Written: ${paths.map((p) => p.split(/[\\/]/).pop()).join(", ")} (cups and track slots, every region alike), new track archives in Race/Course, the names in every language archive of Scene/UI, and ct_icons.tpl in the menu archives when icons change. In LE-CODE a cup only lists its tracks: moving a track does not move its file.`,
  };
}
