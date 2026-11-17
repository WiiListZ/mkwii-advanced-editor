// Cups of a mod with its own cups (Pulsar packs such as Insane Kart Wii, LE-CODE distributions): browse and search
// hundreds of cups, move and swap tracks and cups, replace a track with a file or a new track, add
// new cups with their own icon, and rename cups and tracks. Only the cups and tracks of the pack are
// edited: its other settings are kept as they are.

import * as React from "react";
import {
  VolumeX, VideoOff, FileAudio, Clapperboard, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, FileUp, Gauge, ImagePlus, LoaderCircle, Music, Pencil, Plus, Replace, RotateCcw, Search, Sparkles,
  FolderOpen, Trash2, TriangleAlert, Trophy, Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api, FILTERS } from "../../../js/api.js";
import { decodeFile } from "../audio-convert";
import { customAudioBytes } from "../pulsar";
import { CUPS, SLOTS, slotById } from "../../../js/data/cups.js";
import {
  addCup, cupChanged, cupName, pairCup, fillEmptyTracks, initialPulsar, moveTrack, patchCup, patchTrack, removeLastCup, replaceTrack, swapCups, swapTracks, trackAuthor, trackChanged, trackName,
} from "../../../js/data/pulsar-cups.js";
import { editor } from "../editor";
import { dialogs } from "../dialogs-store";
import { createCupTrack, inspectTrack, readGameNames, writeAll } from "../cups";
import { CupIcon, useCupIcons } from "../cup-icons";
import { ThpPart, forgetPreviews } from "../thp-preview";
import { useEditor } from "../hooks";
import { Hint } from "../common";
import { cn } from "@/lib/utils";

type Check = { errors: string[]; warnings: string[]; files: number; checkpoints: number } | { loading: true } | { failed: string };
const PAGE = 120;
const RACE_SLOTS = SLOTS.filter((s: any) => !s.battle);

function PackIcon({ mod, cup, className }: { mod: ModCups; cup: number | null; className?: string }) {
  const [url, setUrl] = React.useState("");
  React.useEffect(() => {
    let live = true;
    setUrl("");
    if (cup !== null) mod.icon(cup).then((u) => live && setUrl(u)).catch(() => {});
    return () => { live = false; };
  }, [mod, cup]);
  return url ? <img src={url} alt="" draggable={false} className={cn("size-6 shrink-0 select-none object-contain", className)} />
    : <Trophy className={cn("size-4 shrink-0 text-muted-foreground", className)} aria-hidden="true" />;
}

// What the view needs from a mod (see pulsar.ts and lecode-cups.ts).
export type ModCups = {
  kind: string; title: string; cupCount: number; capacity: number;
  names: { track: (from: number) => string | null; author: (from: number) => string | null; cup: (from: number) => string | null };
  hasAuthors: boolean;
  slotOf: (from: number) => number; musicOf: (from: number) => number;
  // Pulsar packs: whether a track plays no music (a silent stream of its own).
  mutedOf?: (from: number) => boolean;
  // Pulsar packs: music of its own of a track (bytes, 0 for none) and the most it may take in all.
  customAudioOf?: (from: number) => number;
  // The size of the music of its own a track had before an apply replaced or removed it (.bak), or 0.
  musicBackupOf?: (from: number) => number;
  audioLimit?: number;
  // Pulsar packs: whether a custom cup (its index before the changes) has a preview video of its own,
  // and how many custom cups can have one (0: not with this pack or engine).
  videoOfCup?: (cupFrom: number) => boolean;
  customVideos?: number;
  // A custom cup's video on disk (its path and name), and making one now (black) to edit it.
  videoFileOf?: (cupFrom: number) => string | null;
  videoName?: (cupFrom: number) => string | null;
  createCupVideo?: (cupFrom: number, say: (t: string) => void) => Promise<string>;
  // Whether the engine on disk plays the menu videos (a video made now plays without applying).
  videoReady?: boolean;
  musicOptions: { value: number; label: string }[];
  fileOf: (position: number, from: number | null) => string;
  trackPath: (from: number) => string;
  icon: (cupFrom: number) => Promise<string>;
  build: (a: any, progress: (text: string) => void) => Promise<{ writes: any[]; notes: string[] }>;
  // Opens the game text editor on the name of a cup or track already in the mod; false when the
  // name is not in the mod yet (it is then typed here and written when the changes are applied).
  rename?: (what: { cup: number } | { track: number }) => Promise<boolean>;
  written: string;
  play?: { sdRoot: string; xmlPath: string; instructionsPath: string; pending?: boolean };
  // A fix the pack needs that Apply makes (such as names written without their font).
  repair?: string;
  // Pulsar packs: whether the engine plays the cup and course selection videos (null: this
  // engine version cannot be changed); startVideos is the choice made when creating the pack.
  videos?: "on" | "off" | "legacy" | null;
  startVideos?: boolean;
  regsMode?: number;
};

// A mod's cups as they are; a mod without cups (a new one) starts with an empty first cup.
const startOf = (p: ModCups) => {
  const a = p.cupCount ? initialPulsar(p) : addCup(initialPulsar({ cupCount: 0, regsMode: p.regsMode }), "My Cup 1");
  return p.videos == null ? a : { ...a, menuVideos: p.startVideos ?? p.videos !== "off" };
};

// originalCupPanel: the game's own view of an original cup (its tracks, music, videos and Apply), shown
// when one of the original cups kept by the pack is chosen.
export function ModCupsView({ load: loadMod, onChanges, onApplied, originalCupPanel }: { load: () => Promise<ModCups>; onChanges: (n: number) => void; onApplied?: () => void; originalCupPanel?: (cup: number, go: (cup: number) => void, videosOff?: string) => React.ReactNode }) {
  const [pack, setPack] = React.useState<ModCups | null>(null);
  const [error, setError] = React.useState("");
  const [a, setA] = React.useState<any>(null);
  const [cup, setCup] = React.useState(0);
  const [originalCup, setOriginalCup] = React.useState<number | null>(null);
  const [originalText, setOriginalText] = React.useState<((id: number) => string | null) | null>(null);
  const originalIcons = useCupIcons();
  React.useEffect(() => {
    let alive = true;
    readGameNames().then((n) => { if (alive) setOriginalText(() => n?.text || null); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const [query, setQuery] = React.useState("");
  const [page, setPage] = React.useState(0);
  const [checks, setChecks] = React.useState<Record<string, Check>>({});
  const [renaming, setRenaming] = React.useState<number | "cup" | null>(null);
  const [iconPreview, setIconPreview] = React.useState<Record<number, string>>({});
  const ed = useEditor("settings");
  const [previewVersion, setPreviewVersion] = React.useState(0);

  const load = React.useCallback(() => {
    setPack(null); setError("");
    loadMod().then((p) => { setPack(p); setA(startOf(p)); }).catch((e) => setError(e.message));
  }, [loadMod]);
  React.useEffect(load, [load]);
  // After a rename in the game text editor the names are read again; the unapplied changes stay.
  const refresh = () => loadMod().then(setPack).catch((e) => toast.error("Could not read the names again", { description: e.message }));

  const names = pack?.names || { track: () => null, author: () => null, cup: () => null };
  const changed = a ? a.cups.filter((_: any, c: number) => cupChanged(a, c)).length + Math.max(0, (pack?.cupCount || 0) - a.cups.length) + (pack?.regsMode !== undefined && a.regsMode !== pack.regsMode ? 1 : 0) + (pack?.repair ? 1 : 0) + (pack?.videos != null && pack.videos !== "legacy" && a.menuVideos !== (pack.videos === "on") ? 1 : 0) + (pack?.kind === "pulsar" && a.cups.length % 2 === 1 ? 1 : 0) : 0;
  React.useEffect(() => onChanges(changed), [changed]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <p className="m-0 text-xs text-destructive">Could not read the mod's cups: {error}</p>;
  if (!pack || !a) return <div className="flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="size-4 animate-spin" /> Reading the mod's cups…</div>;

  // A custom cup has no preview video in the game: the game's videos are those of its 8 cups, and
  // the engine (with Menu videos on) shows none for the others, whatever the tracks behave like.
  const noVideoHint = pack.kind.startsWith("pulsar")
    ? "This pack's custom cups cannot have a preview video: that needs Pulsar's engine for PAL games and the pack's Assets folder on the disc's root (as in the packs this editor makes). The cup selection shows black behind a custom cup's track names."
    : "Custom cups have no preview video in the game: the game has videos only for its 8 cups. Edit those in the original cups.";

  // Music of its own (CTBRSTM): kept from before the changes, chosen now, or none.
  const ownAudioBytes = (t: any) => t.audio ? t.audio.bytes : t.audio === null || t.mute === true || t.from === null ? 0 : pack.customAudioOf?.(t.from) || 0;
  const audioTotal = (except: number) => a.tracks.reduce((n: number, t: any, i: number) => i === except ? n : n + ownAudioBytes(t), 0);
  const chooseAudio = async (i: number) => {
    const path = await api.choosePath(FILTERS.audio, `Music for ${trackName(a, i, names) || `track ${i + 1}`}`);
    if (!path) return;
    const file = path.split(/[\\/]/).pop()!;
    let seconds = 0;
    try {
      const audio = await editor.withBusy(`Reading ${file}…`, async () => decodeFile(path, (await api.readPath(path)).data));
      seconds = audio.channels[0].length / audio.rate;
      if (!seconds) throw new Error("The audio file is empty");
    } catch (e: any) { toast.error("Could not use this audio file", { description: e.message }); return; }
    const limit = pack.audioLimit || Infinity, bytes = customAudioBytes(seconds), others = audioTotal(i);
    const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;
    if (others + bytes > limit) {
      toast.error("Not enough room for this music", { description: `It takes about ${mb(bytes)} (normal and final lap); the pack's own music already takes ${mb(others)} of the ${mb(limit)} allowed. Use a shorter music, or the music of an original track for some tracks.` });
      return;
    }
    const options: any = await dialogs.form({
      title: `Music for ${trackName(a, i, names) || `track ${i + 1}`}`,
      description: `${file} (${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}) becomes this track's own music when you apply: converted to the game's format into CTBRSTM/${i}_n.brstm and _f.brstm (final lap), which Pulsar plays for this track. About ${mb(bytes)}; the pack's own music then takes about ${mb(others + bytes)} of the ${mb(limit)} allowed.`,
      fields: [
        { key: "loop", label: "Loop", type: "switch", value: true, hint: "When the music ends it starts again from the loop start." },
        { key: "loopStart", label: "Loop start (seconds)", type: "number", value: 0, min: 0, max: Math.floor(seconds), hint: "Where the music starts again after its end. 0 loops the whole music." },
        { key: "volume", label: "Volume (%)", type: "number", value: 100, min: 10, max: 400, step: 5 },
        { key: "finalFaster", label: "Final lap 10% faster", type: "switch", value: true, hint: "Like the game's own music, the final lap plays it a little faster. Off: the same music." },
      ],
      confirmLabel: "Use this music",
    });
    if (!options) return;
    const t = a.tracks[i];
    update((x) => patchTrack(x, i, { audio: { path, label: file, seconds, bytes, loop: !!options.loop, loopStart: Number(options.loopStart) || 0, volume: Number(options.volume) || 100, finalFaster: !!options.finalFaster }, mute: t.from !== null && pack.mutedOf?.(t.from) ? false : undefined }));
  };

  // Preview videos of custom cups: a cup has one when one of its tracks does.
  const trackVideo = (t: any): "new" | "kept" | null => t.video ? "new" : t.video === null || t.from === null ? null : pack.videoOfCup?.(Math.floor(t.from / 4)) ? "kept" : null;
  const cupHasVideo = (c: number) => [0, 1, 2, 3].some((p) => a.tracks[c * 4 + p] && trackVideo(a.tracks[c * 4 + p]));
  const videoCups = a.cups.filter((_: any, c: number) => cupHasVideo(c)).length;
  // The preview video editor on a track's part of its cup's video: the video of the cup it comes from
  // (made now, black, when that cup has none yet).
  const editPreview = async (i: number) => {
    const t = a.tracks[i], cupFrom = t.from === null ? null : Math.floor(t.from / 4);
    if (cupFrom === null || !pack.createCupVideo) return;
    let path = pack.videoFileOf?.(cupFrom) || null;
    if (!path) {
      const ok = await dialogs.confirm({ title: "Make this cup's video?", description: `${cupName(a, Math.floor(i / 4), names)} has no preview video yet: a black one with a strip for each of its four tracks is made in the pack now (${videoCups + 1} of at most ${pack.customVideos} custom cups), and the preview video editor opens on this track's strip. Put a picture or a video in each strip there and save.`, confirmLabel: "Make the video" });
      if (!ok) return;
      try { path = await editor.withBusy("Making the cup's video…", () => pack.createCupVideo!(cupFrom, () => {})); }
      catch (e: any) { toast.error("Could not make the cup's video", { description: e.message }); return; }
      setPreviewVersion((v) => v + 1);
    }
    const labels = [0, 1, 2, 3].map((p) => { const j = a.tracks.findIndex((x: any) => x.from === cupFrom * 4 + p); return trackName(a, j >= 0 ? j : cupFrom * 4 + p, names) || `Track ${p + 1}`; });
    // Titles of the pack's videos in the editor's list: their cups' names.
    const packTitles: Record<string, string> = {};
    a.cups.forEach((cup: any, c: number) => { const name = cup.from !== null ? pack.videoName?.(cup.from) : null; if (name) packTitles[name.split("/").pop()!] = `${cupName(a, c, names)} tracks`; });
    const own = path!.split(/[\\/]/).pop()!;
    packTitles[own] ||= `${cupName(a, Math.floor(i / 4), names)} tracks`;
    await dialogs.open("thp", { initialPath: path, initialPart: String(t.from % 4), partLabels: labels, packTitles });
    forgetPreviews();
    setPreviewVersion((v) => v + 1);
  };
  const choosePreview = async (i: number) => {
    const path = await api.choosePath([{ name: "Pictures and videos", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif", "mp4", "webm", "mov", "m4v", "mkv", "ogv"] }], `Preview video for ${trackName(a, i, names) || `track ${i + 1}`}`);
    if (!path) return;
    const label = path.split(/[\\/]/).pop()!;
    update((x) => patchTrack(x, i, { video: { path, label, video: /\.(mp4|webm|mov|m4v|mkv|ogv)$/i.test(label) } }));
  };

  const openRiivolution = async () => {
    if (!pack.play) return;
    try {
      await dialogs.open("riivolution", { initialFile: await api.readPath(pack.play.xmlPath) });
    } catch (e: any) { toast.error("Could not open the Riivolution XML", { description: e.message }); }
  };

  // Renaming opens the game text editor when the name is already in the mod.
  const renameCup = async (c: number) => {
    const entry = a.cups[c];
    if (pack.rename && entry.from !== null && (await pack.rename({ cup: entry.from }))) {
      update((x) => patchCup(x, c, { name: undefined }));
      await refresh();
    } else setRenaming("cup");
  };
  const renameTrack = async (i: number) => {
    const entry = a.tracks[i];
    if (pack.rename && entry.from !== null && !entry.file && (await pack.rename({ track: entry.from }))) {
      update((x) => patchTrack(x, i, { name: undefined }));
      await refresh();
    } else setRenaming(i);
  };
  const update = (fn: (x: any) => any) => { try { setA((x: any) => fn(x)); } catch (e: any) { toast.warning(e.message); } };
  const q = query.trim().toLowerCase();
  const includeOriginals = pack.regsMode !== undefined && a.regsMode > 0;
  // A Pulsar pack without menu videos: the preview videos are neither shown nor edited.
  const videosOff = pack.videos != null && !a.menuVideos ? "Menu videos are off in this pack: Pulsar plays no videos in the cup and course selection. Turn on Menu videos (on the left) to see and change them." : undefined;
  const originalName = (id: number) => originalText?.(id >= 0x20 ? 0x24b8 + id - 0x20 : 0x2454 + id) || slotById(id).label;
  const originalCupName = (c: number) => originalText?.(CUPS[c].nameId) || CUPS[c].name;
  const originalMatches = includeOriginals ? CUPS.slice(0, 8).map((_: any, c: number) => c).filter((c: number) => !q || [originalCupName(c), ...CUPS[c].slots.map(originalName)].some((s: string) => s.toLowerCase().includes(q))) : [];
  const matches = a.cups.map((_: any, c: number) => c).filter((c: number) => !q || [cupName(a, c, names), ...[0, 1, 2, 3].flatMap((k) => [trackName(a, c * 4 + k, names), trackAuthor(a, c * 4 + k, names)])].some((s) => s.toLowerCase().includes(q)));
  const pages = Math.max(1, Math.ceil(matches.length / PAGE)), currentPage = Math.min(page, pages - 1);
  const shown = matches.slice(currentPage * PAGE, (currentPage + 1) * PAGE);
  const current = Math.min(cup, a.cups.length - 1);
  const checkOf = (i: number) => { const t = a.tracks[i]; return t.file ? checks[t.file.path] : undefined; };
  const emptyCount = a.tracks.filter((t: any) => t.from === null && !t.file).length;
  const checking = a.tracks.some((t: any, i: number) => t.file && (!checkOf(i) || "loading" in checkOf(i)!));
  const invalid = a.tracks.some((t: any, i: number) => { const c = checkOf(i); return c && ("failed" in c || ("errors" in c && c.errors.length > 0)); });
  const blockedReason = emptyCount === a.tracks.length ? "Add at least one track before applying." : checking ? "Checking replacement tracks…" : invalid ? "Fix the red track errors before applying." : "";
  const applyHelp = blockedReason || (emptyCount ? `${emptyCount} empty position${emptyCount === 1 ? "" : "s"}: Apply lets you fill them by repeating a track you choose.` : "Review the changes and backup choice before writing them into the mod.");

  const useFile = async (i: number, path: string, generated = false) => {
    const label = path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "").replace(/_/g, " ");
    update((x) => replaceTrack(x, i, path, label, generated));
    setChecks((c) => ({ ...c, [path]: { loading: true } }));
    try { const r = await inspectTrack(path, false); setChecks((c) => ({ ...c, [path]: r })); }
    catch (e: any) { setChecks((c) => ({ ...c, [path]: { failed: e.message } })); }
  };
  const chooseFile = async (i: number) => {
    const path = await api.choosePath([{ name: "Track archive", extensions: ["szs", "wlz", "wbz", "wu8"] }], `Track for ${cupName(a, Math.floor(i / 4), names)} ${i % 4 + 1}`);
    if (path) await useFile(i, path);
  };
  const useOpenTrack = async (i: number) => {
    const d = editor.doc;
    if (!d.filePath || d.dirty || d.fileKind === "new") {
      const ok = await dialogs.confirm({ title: "Save the open track first?", description: `"${d.fileName}" ${d.filePath ? "has unsaved changes" : "is not saved as a file yet"}. The cup takes the track from its .szs file, so it is saved first. Save it outside the pack's Tracks folder, for example in a folder of your own tracks.`, confirmLabel: "Save track" });
      if (!ok || !(await editor.save(!d.filePath))) return;
    }
    if (editor.doc.filePath) await useFile(i, editor.doc.filePath);
  };
  // A brand-new track for this position: the track generator, then the track is saved and placed.
  const newTrack = async (i: number) => {
    const path = await createCupTrack(`${cupName(a, Math.floor(i / 4), names)} - Track ${i % 4 + 1}`, pack.kind.startsWith("pulsar") ? pack.trackPath(i) : undefined);
    if (path) await useFile(i, path, true);
  };
  const chooseIcon = async (c: number) => {
    const f = await api.openFile([{ name: "Picture", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif"] }], `Icon for ${cupName(a, c, names)}`);
    if (!f?.path) return;
    update((x) => patchCup(x, c, { icon: { path: f.path } }));
    setIconPreview((p) => ({ ...p, [c]: URL.createObjectURL(new Blob([f.data])) }));
  };

  const apply = async () => {
    if (blockedReason) return;
    let plan = a;
    if (emptyCount) {
      const candidates = a.tracks.map((t: any, i: number) => t.from !== null || t.file ? i : -1).filter((i: number) => i >= 0);
      const source = candidates.find((i: number) => Math.floor(i / 4) === current) ?? candidates[0];
      const fill = await dialogs.form({
        title: "Fill the empty cup positions?",
        description: `Each cup needs four races. ${emptyCount} position${emptyCount === 1 ? " is" : "s are"} still empty. Choose a track to repeat in those positions; you can replace the copies later. Nothing is saved until you confirm Apply.`,
        fields: [{ key: "source", label: "Repeat this track in the empty positions", type: "select", value: String(source), options: candidates.map((i: number) => [String(i), `${cupName(a, Math.floor(i / 4), names)} ${i % 4 + 1}: ${trackName(a, i, names)}`]) }],
        confirmLabel: "Fill and review…",
      });
      if (!fill) return;
      plan = fillEmptyTracks(a, Number(fill.source));
    }
    // Pulsar needs an even number of cups (see pairCup): the first cup fills the pair.
    const paired = pack.kind.startsWith("pulsar") && plan.cups.length % 2 === 1;
    if (paired) plan = pairCup(plan);
    const lines: string[] = [];
    if (pack.videos != null && (plan.menuVideos !== (pack.videos === "on") || pack.videos === "legacy")) lines.push(plan.menuVideos ? "Menu videos on: the cup and course selection play each cup's own video (PAL games)" : "Menu videos off: Pulsar's engine as it was");
    if (pack.repair) lines.push(pack.repair);
    if (paired) lines.push(`Cup ${plan.cups.length}: a copy of ${cupName(plan, 0, names)}, because Pulsar shows cups in pairs (a pack with an odd number of cups crashes when a custom track is chosen)`);
    if (emptyCount) lines.push(`${emptyCount} empty position${emptyCount === 1 ? "" : "s"} filled with the selected track`);
    if (pack.regsMode !== undefined && (pack.kind === "pulsar-new" || plan.regsMode !== pack.regsMode)) lines.push(plan.regsMode > 0 ? `Keep the original 8 cups alongside ${plan.cups.length} custom cup${plan.cups.length === 1 ? "" : "s"}` : "Show custom cups only; hide the original game cups");
    plan.cups.forEach((cupEntry: any, c: number) => {
      if (!cupChanged(plan, c) || cupEntry.pairCopy) return;
      if (cupEntry.from === null) lines.push(`New cup ${c + 1}: ${cupName(plan, c, names)}`);
      else if (cupEntry.from !== c) lines.push(`Cup ${c + 1}: ${cupName(plan, c, names)} (was cup ${cupEntry.from + 1})`);
      for (let k = 0; k < 4; k++) {
        const i = c * 4 + k, t = plan.tracks[i];
        const where = `${cupName(plan, c, names)} ${k + 1}`;
        if (t.audio?.backup) lines.push(`${where}: its music from before back (from the .bak copy, CTBRSTM/${i}_n.brstm and _f)`);
        else if (t.audio) lines.push(`${where}: its own music from ${t.audio.label} (CTBRSTM/${i}_n.brstm and _f)`);
        else if (t.audio === null) lines.push(`${where}: its own music removed (it plays an original track's)`);
        if (t.video) lines.push(`${where}: preview video from ${t.video.label} (its part of the cup's video)`);
        else if (t.video === null) lines.push(`${where}: no preview video (its part of the cup's video becomes black)`);
        if (!trackChanged(plan, i) || (cupEntry.from !== null && t.from === cupEntry.from * 4 + k && !t.file && !t.duplicate && t.name === undefined)) continue;
        lines.push(`${cupName(plan, c, names)} ${k + 1}: ${trackName(plan, i, names)}${t.file ? ` (from ${t.file.path.split(/[\\/]/).pop()})` : t.duplicate ? " (copy)" : t.from !== null && t.from !== i ? ` (was in cup ${Math.floor(t.from / 4) + 1})` : ""}`);
      }
    });
    if (plan.cups.length < pack.cupCount) lines.push(`${pack.cupCount - plan.cups.length} cup(s) removed from the end`);
    const choice: any = await dialogs.open("cupsApply", {
      lines, title: "Apply the new cups to the mod?",
      description: `These changes are written into the mod ${pack.title}. Launch Mario Kart Wii with the mod enabled to see them.`,
      written: pack.written,
    });
    if (!choice) return;
    setA(plan);
    const done = await editor.withBusy("Preparing the changes…", async () => {
      const progress = (t: string) => { editor.busy = t; editor.bump("ui"); };
      try {
        const { writes, notes } = await pack.build(plan, progress);
        const snapshot = await writeAll(writes, { backup: choice.backup, label: `${pack.title}: ${lines.slice(0, 3).join(" · ")}${lines.length > 3 ? ` · ${lines.length - 3} more` : ""}`, details: { lines }, progress });
        toast.success(`Mod cups changed: ${writes.length} file${writes.length === 1 ? "" : "s"} written`, { description: [snapshot ? "A backup was made first: Backups puts the files back." : "No backup was made.", ...notes].join(" "), duration: 10000 });
        return true;
      } catch (e: any) { dialogs.alert({ title: "Could not change the cups", description: `${e.message}. Files written before the error can be put back from Backups.` }); return false; }
    });
    if (done) { setChecks({}); setIconPreview({}); if (onApplied) onApplied(); else load(); }
  };

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)] gap-4">
      <div className="flex min-h-0 flex-col gap-2 border-r pr-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-2 size-4 text-muted-foreground" />
          <Input value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} onKeyDown={(e) => e.stopPropagation()} placeholder="Find a cup, track or author…" aria-label="Find cups" className="h-8 pl-7 text-xs" />
        </div>
        {(pack.regsMode !== undefined || pack.videos != null) && <div className="flex shrink-0 flex-col gap-2 rounded-md border p-2.5 text-xs">
          {pack.regsMode !== undefined && <label className="flex cursor-pointer items-start gap-2">
            <Checkbox className="mt-0.5" aria-label="Keep original game cups" checked={includeOriginals} onCheckedChange={(checked) => { update((x) => ({ ...x, regsMode: checked === true ? (pack.regsMode === 2 ? 2 : 1) : 0 })); if (checked !== true) setOriginalCup(null); }} />
            <span><b className="font-medium">Keep original game cups</b><span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">{includeOriginals ? `8 original cups + ${a.cups.length} custom cup${a.cups.length === 1 ? "" : "s"}, together in the game.` : "Only the custom cups are available in this pack."}</span></span>
          </label>}
          {pack.videos != null && <Hint title="Menu videos (experimental)" text="Pulsar turns off the videos of the cup and course selection. On: the engine plays them again, and its table of cup videos is put in the order of Pulsar's cups so each original cup shows its own (Binaries/Code.pul changes; the original is kept as Code.pul.original; no video file is copied). PAL games only: in the other regions the videos stay off. Custom cups have no video (black in the cup selection). The single-player menu's buttons play their videos too. Test the pack in Dolphin.">
            <label className="flex cursor-pointer items-start gap-2">
              <Checkbox className="mt-0.5" aria-label="Menu videos" checked={!!a.menuVideos} onCheckedChange={(checked) => update((x) => ({ ...x, menuVideos: checked === true }))} />
              <span><b className="font-medium">Menu videos</b> <span className="text-[10.5px] text-muted-foreground">(experimental)</span><span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">Videos in the cup and course selection, which Pulsar turns off.</span></span>
            </label>
          </Hint>}
        </div>}
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">{matches.length.toLocaleString()} of {a.cups.length.toLocaleString()} {pack.regsMode !== undefined ? "custom cups" : "cups"} <Hint title="Beta" text="Editing and creating the cups of mods is new: keep the backup, and test the mod in Dolphin before sharing it."><Badge variant="outline">Beta</Badge></Hint></span>
          <Button size="sm" variant="secondary" disabled={a.cups.length >= pack.capacity} title={a.cups.length >= pack.capacity ? "The mod has no room for more cups" : undefined} onClick={() => { update((x) => addCup(x, `New cup ${x.cups.length + 1}`)); setOriginalCup(null); setCup(a.cups.length); setQuery(""); setPage(Math.floor(a.cups.length / PAGE)); }}><Plus /> New cup</Button>
        </div>
        <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto" aria-label="Pack cups">
          {includeOriginals && <>
            <div className="px-2 pb-1 pt-2 text-[11px] font-medium text-muted-foreground">Original game cups</div>
            {originalMatches.map((c: number) => <button key={`original-${c}`} type="button" data-original-cup={c} aria-pressed={originalCup === c} onClick={() => { setOriginalCup(c); setRenaming(null); }} className={cn("flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs", originalCup === c ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground")}>
              <CupIcon cup={c} icons={originalIcons} className="size-6" /><span className="truncate">{originalCupName(c)}</span>
            </button>)}
          </>}
          <div className="px-2 pb-1 pt-2 text-[11px] font-medium text-muted-foreground">{pack.regsMode !== undefined ? "Custom cups" : "Cups"}</div>
          {shown.map((c: number) => (
            <button key={c} type="button" data-custom-cup={c} aria-pressed={originalCup === null && current === c} onClick={() => { setOriginalCup(null); setCup(c); setRenaming(null); }}
              className={cn("flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left text-xs", originalCup === null && current === c ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground")}>
              {iconPreview[c] ? <img src={iconPreview[c]} alt="" className="size-6 object-contain" /> : <PackIcon mod={pack} cup={a.cups[c].from ?? c} />}
              <span className="w-9 shrink-0 tabular-nums text-[10.5px] opacity-70">{c + 1}</span>
              <span className="min-w-0 flex-1 truncate">{cupName(a, c, names)}</span>
              {cupChanged(a, c) && <span className="shrink-0 text-[10px] text-foreground">{a.cups[c].from === null ? "new" : "changed"}</span>}
            </button>
          ))}
          {pack.kind.startsWith("pulsar") && a.cups.length % 2 === 1 && !q && currentPage === pages - 1 && (
            <Hint title="Shown again in the game" text="Pulsar's cup page has no empty places: it shows the cups in pairs, one above the other, and scrolls two at a time. With an odd number of cups, Apply adds a copy of the first cup (its tracks, name and icon) to fill the pair; the engine cannot show a single cup there, and without the copy it crashes when a custom track is chosen. Add another cup to put your own in that place.">
              <div className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground/70" data-pair-filler>
                <span className="size-6 shrink-0" /><span className="w-9 shrink-0 tabular-nums text-[10.5px] opacity-70">{a.cups.length + 1}</span>
                <span className="min-w-0 flex-1 truncate italic">Copy of {cupName(a, 0, names)}</span>
              </div>
            </Hint>
          )}
          {!matches.length && !originalMatches.length && <p className="m-0 p-2 text-xs text-muted-foreground">No cup has this name, track or author.</p>}
        </nav>
        {pages > 1 && (
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <Button size="icon-sm" variant="ghost" aria-label="Previous cups" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft /></Button>
            <span className="tabular-nums">{currentPage + 1} / {pages}</span>
            <Button size="icon-sm" variant="ghost" aria-label="Next cups" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}><ChevronRight /></Button>
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-col gap-2">
        {pack.play && <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border bg-muted/20 px-2.5 py-2 text-[11px] leading-relaxed" data-cup-play>
          <div className="min-w-0 flex-1 basis-80">
            <div className="font-medium">{pack.play.pending ? "After Apply changes: Riivolution cup pack" : "Riivolution cup pack"}</div>
            <p className="m-0 text-muted-foreground">Load <b>{pack.play.xmlPath.split(/[\\/]/).pop()}</b> with Riivolution, set <b>Pack: Enabled</b> and launch Mario Kart Wii. Keep the pack and <b>riivolution</b> folders together.</p>
          </div>
          {!pack.play.pending && <div className="flex shrink-0 flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => { void api.reveal(pack.play!.xmlPath).catch((e: Error) => toast.error("Could not show the Riivolution XML", { description: e.message })); }}><FolderOpen /> Show Riivolution XML</Button>
            <Button size="sm" variant="ghost" onClick={() => void openRiivolution()}>Open Riivolution editor…</Button>
          </div>}
        </div>}
        {originalCup !== null && includeOriginals && originalCupPanel ? originalCupPanel(originalCup, setOriginalCup, videosOff) : originalCup !== null && includeOriginals ? <OriginalCupView cup={originalCup} icons={originalIcons} name={originalCupName(originalCup)} trackName={originalName} onCup={setOriginalCup} onCustom={() => setOriginalCup(null)} /> : <>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="icon" variant="outline" aria-label="Previous cup" disabled={current === 0} onClick={() => { setCup(current - 1); setRenaming(null); }}><ChevronLeft /></Button>
          <div className="flex min-w-0 flex-1 flex-col items-center">
            <div className="flex items-center gap-2">
              {iconPreview[current] ? <img src={iconPreview[current]} alt="" className="size-8 object-contain" /> : <PackIcon mod={pack} cup={a.cups[current].from ?? current} className="size-8" />}
              {renaming === "cup" ? <NameInput value={cupName(a, current, names)} onDone={(v) => { setRenaming(null); if (v !== null) update((x) => patchCup(x, current, { name: v })); }} />
                : <button type="button" className="group inline-flex cursor-pointer items-center gap-1.5 rounded px-2 py-0.5 text-[15px] font-semibold hover:bg-accent" onClick={() => void renameCup(current)} title="Rename this cup (in the game text editor when the name is already in the mod)">{cupName(a, current, names)} <Pencil className="size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" /></button>}
            </div>
            <div className="text-[11px] text-muted-foreground">Cup {current + 1} of {a.cups.length} · {pack.title}{a.cups[current].from === null ? " · new cup" : ""}</div>
          </div>
          <Button size="icon" variant="outline" aria-label="Next cup" disabled={current >= a.cups.length - 1} onClick={() => { setCup(current + 1); setRenaming(null); }}><ChevronRight /></Button>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => void chooseIcon(current)}><ImagePlus /> Change cup icon</Button>
          <Hint title="Move cup up" text="Exchange this cup (name, icon and its four tracks) with the cup before it."><span className="inline-flex"><Button size="sm" variant="ghost" disabled={current === 0} onClick={() => { update((x) => swapCups(x, current, current - 1)); setCup(current - 1); }}><ArrowUp /> Cup up</Button></span></Hint>
          <Hint title="Move cup down" text="Exchange this cup with the cup after it."><span className="inline-flex"><Button size="sm" variant="ghost" disabled={current >= a.cups.length - 1} onClick={() => { update((x) => swapCups(x, current, current + 1)); setCup(current + 1); }}><ArrowDown /> Cup down</Button></span></Hint>
          <Hint title="Remove this cup" text="Only the last cup can be removed: removing one in the middle would renumber every track after it. Move a cup to the end first."><span className="inline-flex">
            <Button size="sm" variant="ghost" disabled={current !== a.cups.length - 1 || a.cups.length <= 1} onClick={async () => {
              if (a.cups[current].from !== null && !(await dialogs.confirm({ title: "Remove this cup?", description: `${cupName(a, current, names)} and its four tracks leave the pack when you apply. Its track files stay where they are and a backup is made.`, confirmLabel: "Remove cup", destructive: true }))) return;
              update((x) => removeLastCup(x)); setCup(Math.max(0, current - 1));
            }}><Trash2 /> Remove</Button>
          </span></Hint>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
          {[0, 1, 2, 3].map((k) => {
            const i = current * 4 + k, t = a.tracks[i];
            const slot = t.slot ?? (t.from !== null ? pack.slotOf(t.from) : 0x08);
            const music = t.music ?? (t.from !== null ? pack.musicOf(t.from) : pack.musicOptions.find((m) => m.label === slotById(slot)?.label)?.value ?? pack.musicOptions[0]?.value ?? 0);
            const check = checkOf(i);
            const muted = t.mute ?? (t.from !== null && !t.audio && !!pack.mutedOf?.(t.from));
            const hadOwn = t.from !== null && !!pack.customAudioOf?.(t.from);
            const own = !muted && ownAudioBytes(t) > 0;
            const musicLabel = muted ? "No music" : t.audio ? `${t.audio.label} (its own music)` : own ? "Its own music (CTBRSTM)" : pack.musicOptions.find((m) => m.value === music)?.label || `Music ${music}`;
            const video = trackVideo(t), cupVideo = cupHasVideo(current);
            const videoName = t.from !== null ? pack.videoName?.(Math.floor(t.from / 4)) ?? null : null;
            const videoFile = t.from !== null && t.video === undefined ? pack.videoFileOf?.(Math.floor(t.from / 4)) ?? null : null;
            const videoFull = !cupVideo && videoCups >= (pack.customVideos || 0);
            return (
              <div key={i} className={cn("relative flex min-h-24 shrink-0 flex-col overflow-hidden rounded-md border px-3 py-3", trackChanged(a, i) && "border-foreground/40")} data-pack-track={i}>
                {videoFile && !videosOff && ed.settings.trackVideoPreviews && <div className="pointer-events-none absolute inset-0 bg-card">
                  <div className="absolute inset-0" style={{ maskImage: "linear-gradient(to right, transparent, rgb(0 0 0 / 20%) 50%, rgb(0 0 0 / 70%))" }}>
                    <ThpPart key={`${previewVersion}:${videoFile}:${t.from}`} path={videoFile} rect={{ x: 0, y: (t.from! % 4) * 144, width: 400, height: 144 }} className="absolute inset-0 size-full" />
                  </div>
                </div>}
                <div className="relative flex items-start gap-3">
                  <span className="mt-0.5 w-5 shrink-0 text-center text-[13px] font-semibold tabular-nums text-muted-foreground">{k + 1}</span>
                  <div className="min-w-0 flex-1">
                    {renaming === i ? <NameInput value={trackName(a, i, names)} onDone={(v) => { setRenaming(null); if (v !== null) update((x) => patchTrack(x, i, { name: v })); }} /> : (
                      <div className="flex flex-wrap items-center gap-2">
                        {t.from === null && !t.file ? (
                          <DropdownMenu>
                            <Hint wrap title="Add a track" text="Choose a track file or create one in its own editor window. Apply can fill the remaining positions by repeating a track you choose."><DropdownMenuTrigger asChild><Button size="sm" variant="outline" className="border-dashed" aria-label={`Add a track to position ${k + 1}`}><Plus /> Add a track</Button></DropdownMenuTrigger></Hint>
                            <DropdownMenuContent align="start">
                              <DropdownMenuItem onSelect={() => void newTrack(i)}><Sparkles /> New custom track (draw it)…</DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => void chooseFile(i)}><FileUp /> Track file (.szs, .wbz…)…</DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => void useOpenTrack(i)} disabled={editor.isEmpty}><Trophy /> Track open in the editor ({editor.doc.fileName})</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : <Hint title="Open in a separate 3D editor" text="Edit this track in its own window. The cup's pending changes stay here. Save the track before applying the cup changes."><button type="button" className="min-w-0 cursor-pointer truncate text-left text-[13.5px] font-medium hover:underline" aria-label={`Edit track ${i + 1} in a new window`} onClick={() => void editor.openPath(t.file?.path || pack.trackPath(t.from), { newWindow: true })}>{trackName(a, i, names)}</button></Hint>}
                        {t.file && <Badge variant="outline">{t.file.generated ? "new track" : "from file"}</Badge>}
                        {t.from !== null && t.from !== i && <Badge variant="outline">was cup {Math.floor(t.from / 4) + 1}, {t.from % 4 + 1}</Badge>}
                      </div>
                    )}
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11px] text-muted-foreground">
                      {trackAuthor(a, i, names) && <span>by {trackAuthor(a, i, names)}</span>}
                      <Hint title="Track archive" text="The archive the mod loads for this cup position. Replacements are written here when you apply."><span>{pack.fileOf(i, t.from)}{t.file ? ` ← ${t.file.path.split(/[\\/]/).pop()}` : ""}</span></Hint>
                      <SlotMenu value={slot} onChange={(v) => update((x) => patchTrack(x, i, { slot: v }))} />
                    </div>
                    {check && <CheckLines check={check} />}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-0.5">
                    {([[-1, ArrowUp, "Move up"], [1, ArrowDown, "Move down"], [-4, ArrowLeft, "Move to the previous cup"], [4, ArrowRight, "Move to the next cup"]] as const).map(([dir, Icon, title]) => (
                      <Hint key={title} title={title} text={i + dir < 0 || i + dir >= a.tracks.length ? `There is no ${dir < 0 ? "previous" : "next"} ${Math.abs(dir) === 4 ? "cup" : "track position"} in this pack.` : `Exchange this track with ${cupName(a, Math.floor((i + dir) / 4), names)}, position ${(i + dir) % 4 + 1}: ${trackName(a, i + dir, names) || "empty position"}. The other track takes its place.`}><span className="inline-flex"><Button size="icon-sm" variant="ghost" aria-label={title} disabled={i + dir < 0 || i + dir >= a.tracks.length} onClick={() => update((x) => moveTrack(x, i, dir))}><Icon /></Button></span></Hint>
                    ))}
                    <SwapPicker a={a} names={names} self={i} onPick={(j) => update((x) => swapTracks(x, i, j))} />
                    <DropdownMenu>
                      <Hint wrap title="Replace track" text="Use a track file, the track open in the editor, or create a new track for this mod position. The replacement is checked before you apply."><DropdownMenuTrigger asChild><Button size="sm" variant="ghost"><Replace /> Replace</Button></DropdownMenuTrigger></Hint>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => void chooseFile(i)}><FileUp /> Track file (.szs, .wbz…)…</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => void useOpenTrack(i)} disabled={editor.isEmpty}><Trophy /> Track open in the editor ({editor.doc.fileName})</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => void newTrack(i)}><Sparkles /> Create a new track…</DropdownMenuItem>
                        {pack.hasAuthors && <DropdownMenuSeparator />}
                        {pack.hasAuthors && <DropdownMenuItem onSelect={async () => { const v = await dialogs.form({ title: "Author", fields: [{ key: "author", label: "Made by", type: "text", value: trackAuthor(a, i, names) }] }); if (v) update((x) => patchTrack(x, i, { author: String(v.author) })); }}><Pencil /> Author…</DropdownMenuItem>}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Hint title="Rename track" text={pack.rename && t.from !== null && !t.file ? "Open this track's name in the game text editor to change how it appears in the mod." : "Change this track's name in the mod. The new name is written when you apply."}><Button size="sm" variant="ghost" onClick={() => void renameTrack(i)}><Pencil /> Rename…</Button></Hint>
                    <Hint title="Reset this position" text={a.cups[current].from === null ? "A new cup has no saved track to restore. Use Replace to choose another track." : !trackChanged(a, i) ? "This position has no unapplied changes to reset." : "Discard this position's unapplied track, name, author, behaviour and music changes."}><span className="inline-flex"><Button size="icon-sm" variant="ghost" aria-label="Reset this position" disabled={!trackChanged(a, i) || a.cups[current].from === null} onClick={() => update((x) => patchTrack(x, i, { from: i, file: undefined, duplicate: undefined, name: undefined, author: undefined, slot: undefined, music: undefined, mute: undefined, audio: undefined, video: undefined }))}><RotateCcw /></Button></span></Hint>
                  </div>
                </div>
                <div className="relative mt-auto space-y-1 pt-2 text-[11px] text-muted-foreground">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <MusicMenu value={music} label={musicLabel} options={pack.musicOptions} muted={muted} own={own}
                      file={pack.customAudioOf ? `CTBRSTM/${i}_n.brstm` : undefined}
                      onChange={(v) => update((x) => patchTrack(x, i, { music: v, mute: t.from !== null && pack.mutedOf?.(t.from) ? false : undefined, audio: hadOwn ? null : undefined }))}
                      onMute={pack.mutedOf ? () => update((x) => patchTrack(x, i, { mute: true, audio: hadOwn ? null : undefined })) : undefined}
                      onAudioFile={pack.customAudioOf ? () => void chooseAudio(i) : undefined}
                      onReset={t.music !== undefined || t.mute !== undefined || t.audio !== undefined ? () => update((x) => patchTrack(x, i, { music: undefined, mute: undefined, audio: undefined })) : undefined}
                      onBackup={t.from !== null && !t.audio?.backup && (pack.musicBackupOf?.(t.from) || 0) > 0 && (muted || pack.customAudioOf?.(t.from) !== pack.musicBackupOf?.(t.from) || t.audio !== undefined)
                        ? () => update((x) => patchTrack(x, i, { audio: { backup: true, label: "Music from before", bytes: pack.musicBackupOf!(t.from!) }, mute: t.from !== null && pack.mutedOf?.(t.from) ? false : undefined })) : undefined} />
                  </div>
                  <div className="flex min-w-0">
                    {pack.customVideos && !videosOff ? (
                      <DropdownMenu>
                        <Hint side="bottom" hoverable={false} title="Track preview video" text={t.video === null ? "This track's part of its cup's preview video becomes black when you apply." : videoName ? `thp/${videoName}, ${trackName(a, i, names) || "this track"}'s part: a video of this pack (Assets/thp/course) with a strip for each track of the cup. Edit just this track's preview in the preview video editor, or remove it. ${videoCups} of at most ${pack.customVideos} custom cups have a preview video; the cup selection stays black for custom cups (its one video holds the 8 original cups).` : `This cup has no preview video yet. Edit in the preview video editor makes one in the pack (${videoCups} of at most ${pack.customVideos} custom cups have one).`}>
                          <span className="inline-flex min-w-0">
                            <DropdownMenuTrigger asChild>
                              <button type="button" aria-label="Track preview video" className={linkClass}>
                                {video && t.video !== null ? <Clapperboard className="size-3 shrink-0" /> : <VideoOff className="size-3 shrink-0" />}
                                <span className="min-w-0 truncate">{t.video === null ? "No preview video" : video === "new" ? `${t.video.label} (preview video)` : videoName ? `${videoName} (${trackName(a, i, names) || `Track ${i % 4 + 1}`})` : "No preview video"}</span><ChevronDown className="size-3 shrink-0" />
                              </button>
                            </DropdownMenuTrigger>
                          </span>
                        </Hint>
                        <DropdownMenuContent align="start" className="w-72">
                          <DropdownMenuItem disabled={t.video === null || t.from === null || (!videoName && (videoFull || !pack.videoReady))} onSelect={() => void editPreview(i)}><Pencil /> Edit in the preview video editor…</DropdownMenuItem>
                          {t.from === null && <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">A new track gets its preview video once the cup is applied.</DropdownMenuLabel>}
                          {t.from !== null && !videoName && videoFull && <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">{pack.customVideos} custom cups already have a preview video, the most a pack can have. Remove one to give this cup one.</DropdownMenuLabel>}
                          {t.from !== null && !videoName && !videoFull && !pack.videoReady && <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">Apply first: the pack's engine plays the menu videos once Menu videos is applied.</DropdownMenuLabel>}
                          {t.video === null
                            ? <DropdownMenuItem onSelect={() => update((x) => patchTrack(x, i, { video: undefined }))}><RotateCcw /> Keep the preview video</DropdownMenuItem>
                            : video && <DropdownMenuItem onSelect={() => update((x) => patchTrack(x, i, { video: video === "kept" ? null : undefined }))}><VideoOff /> No preview video</DropdownMenuItem>}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      <Hint side="bottom" hoverable={false} title="Track preview video" text={videosOff || noVideoHint}>
                        <span aria-label="Track preview video" className="inline-flex min-w-0 max-w-full cursor-default items-center gap-1 rounded px-1">
                          <VideoOff className="size-3 shrink-0" /><span className="min-w-0 truncate">No preview video in the game</span>
                        </span>
                      </Hint>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        </>}
        {!(originalCup !== null && includeOriginals && originalCupPanel) && <div className="flex shrink-0 items-center justify-end gap-2 border-t pt-3">
          <span className="mr-auto min-w-0 flex-1 text-[11px] text-muted-foreground" role="status">{changed && (blockedReason || emptyCount) ? applyHelp : pack.repair ? pack.repair : pack.kind.startsWith("pulsar") && a.cups.length % 2 === 1 ? `Pulsar shows cups in pairs: with ${a.cups.length} cup${a.cups.length === 1 ? "" : "s"}, Apply adds a copy of ${cupName(a, 0, names)} to fill the pair. Add a cup to put your own there.` : "Cup creator for mods (beta): changes are saved to this pack. Original and custom cups use separate track archives."}</span>
          <span className="text-xs text-muted-foreground">{changed ? `${changed} cup${changed === 1 ? "" : "s"} changed, not applied yet` : "No changes"}</span>
          <Button variant="outline" disabled={!changed} onClick={() => { const initial = startOf(pack); setA(initial); setOriginalCup(null); setChecks({}); setIconPreview({}); setCup(Math.max(0, Math.min(current, initial.cups.length - 1))); setRenaming(null); setQuery(""); setPage(0); }}><RotateCcw /> Discard</Button>
          <Hint title="Apply changes" text={applyHelp}>
            <span className="inline-flex"><Button disabled={!changed || !!blockedReason} onClick={() => void apply()}>Apply changes…</Button></span>
          </Hint>
        </div>}
      </div>
    </div>
  );
}

function OriginalCupView({ cup, icons, name, trackName, onCup, onCustom }: { cup: number; icons: Record<number, string>; name: string; trackName: (id: number) => string; onCup: (cup: number) => void; onCustom: () => void }) {
  return <div className="flex min-h-0 flex-1 flex-col gap-3" data-original-cup-view={cup}>
    <div className="flex shrink-0 items-center gap-2">
      <Button size="icon" variant="outline" aria-label="Previous original cup" disabled={cup === 0} onClick={() => onCup(cup - 1)}><ChevronLeft /></Button>
      <div className="flex min-w-0 flex-1 flex-col items-center gap-1">
        <h3 className="m-0 flex items-center gap-2 text-sm font-semibold"><CupIcon cup={cup} icons={icons} className="size-7" /> {name}</h3>
        <span className="text-[11px] text-muted-foreground">Original game cup {cup + 1} of 8</span>
      </div>
      <Button size="icon" variant="outline" aria-label="Next original cup" disabled={cup === 7} onClick={() => onCup(cup + 1)}><ChevronRight /></Button>
    </div>
    <p className="m-0 shrink-0 text-xs leading-relaxed text-muted-foreground">Loaded from the original game, alongside the custom cups in this pack. These four tracks stay available when you launch the Riivolution pack.</p>
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
      {CUPS[cup].slots.map((id: number, i: number) => <div key={id} className="flex shrink-0 items-start gap-3 rounded-md border px-3 py-3" data-original-track={slotById(id).file}>
        <span className="w-5 text-center text-xs text-muted-foreground">{i + 1}</span>
        <div className="min-w-0 flex-1"><div className="text-[13px] font-medium">{trackName(id)}</div><div className="mt-1 text-[11px] text-muted-foreground">Race/Course/{slotById(id).file}.szs · {slotById(id).music}</div></div>
        <Badge variant="outline">Original</Badge>
      </div>)}
    </div>
    <Button className="shrink-0 self-start" size="sm" variant="secondary" onClick={onCustom}><Trophy /> Back to custom cups</Button>
  </div>;
}

// The bottom links of a track, as in the game's own cups: a compact button that opens a menu.
const linkClass = "inline-flex w-max max-w-full min-w-0 cursor-pointer items-center gap-1 rounded px-1 text-left hover:bg-accent hover:text-foreground";

// The same menu as the game's cups (Cups and tracks): the file this track plays, an audio file, no
// music, then the music of an original track, by cup, in a submenu.
function MusicMenu({ value, label, options, muted, own, file, onChange, onMute, onAudioFile, onReset, onBackup }: { value: number; label: string; options: { value: number; label: string }[]; muted?: boolean; own?: boolean; file?: string; onChange: (v: number) => void; onMute?: () => void; onAudioFile?: () => void; onReset?: () => void; onBackup?: () => void }) {
  // The options by cup, as in the game's menus: an option is an original track's music (its name).
  const byCup = CUPS.filter((c) => !c.battle).map((c) => ({ name: c.name, items: c.slots.map((id) => ({ id, option: options.find((o) => o.label === slotById(id).label) })).filter((x) => x.option) }));
  const others = options.filter((o) => !byCup.some((c) => c.items.some((x) => x.option === o)));
  const item = (o: { value: number; label: string }, stream?: string) => (
    <DropdownMenuItem key={o.value} onSelect={() => onChange(o.value)} className={cn("justify-between gap-3", !muted && !own && o.value === value && "font-medium")}>
      <span className="truncate">{o.label}</span>{stream && <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{stream}</span>}
    </DropdownMenuItem>
  );
  return (
    <DropdownMenu>
      <Hint title="Music of this track" text={`Choose an audio file, No music or the music of an original track for this track. The change is saved when you apply.${file ? ` An audio file and No music go in ${file} (and _f for the final lap), which Pulsar plays for this track.` : ""}`}>
        <span className="inline-flex min-w-0 flex-1">
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Music" className={linkClass}>{muted ? <VolumeX className="size-3 shrink-0" /> : <Music className="size-3 shrink-0" />}<span className="min-w-0 truncate">{label}</span><ChevronDown className="size-3 shrink-0" /></button>
          </DropdownMenuTrigger>
        </span>
      </Hint>
      <DropdownMenuContent align="start" className="w-72">
        {file && <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">Music file of this track: {file}</DropdownMenuLabel>}
        {onAudioFile && <DropdownMenuItem onSelect={onAudioFile} className={cn(own && "font-medium")}><FileAudio /> Audio file (WAV, MP3, Ogg, FLAC, BRSTM…)…</DropdownMenuItem>}
        {onMute && <DropdownMenuItem onSelect={onMute} className={cn(muted && "font-medium")}><VolumeX /> No music</DropdownMenuItem>}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger><Music /> Music of another track</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-[60vh] w-72 overflow-y-auto">
            {byCup.filter((c) => c.items.length).map((c) => (
              <React.Fragment key={c.name}>
                <DropdownMenuLabel className="text-[11px] text-muted-foreground">{c.name}</DropdownMenuLabel>
                {c.items.map((x) => item(x.option!, slotById(x.id).music))}
              </React.Fragment>
            ))}
            {others.length > 0 && <><DropdownMenuLabel className="text-[11px] text-muted-foreground">Other music</DropdownMenuLabel>{others.map((o) => item(o))}</>}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {(onReset || onBackup) && <DropdownMenuSeparator />}
        {onReset && <DropdownMenuItem onSelect={onReset}><RotateCcw /> Music that goes with the track</DropdownMenuItem>}
        {onBackup && <DropdownMenuItem onSelect={onBackup}><Undo2 /> Its music from before (the .bak copy of {file})</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SlotMenu({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const label = slotById(value)?.label || `Slot ${value}`;
  return (
    <DropdownMenu>
      <Hint title="Behaves like" text="Original track slot whose game behaviour this track uses: some objects, lighting and the track's ID for the game.">
        <span className="inline-flex min-w-0">
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Behaves like" className={linkClass}><Gauge className="size-3 shrink-0" /><span className="min-w-0 truncate">Behaves like {label}</span><ChevronDown className="size-3 shrink-0" /></button>
          </DropdownMenuTrigger>
        </span>
      </Hint>
      <DropdownMenuContent align="start" className="max-h-[60vh] w-72 overflow-y-auto">
        {CUPS.filter((c: any) => !c.battle).map((c: any) => (
          <React.Fragment key={c.name}>
            <DropdownMenuLabel className="text-[11px] text-muted-foreground">{c.name}</DropdownMenuLabel>
            {c.slots.map((s: number) => <DropdownMenuItem key={s} onSelect={() => onChange(s)} className={cn(s === value && "font-medium")}>{slotById(s).label}</DropdownMenuItem>)}
          </React.Fragment>
        ))}
        {!RACE_SLOTS.some((s: any) => s.id === value) && <DropdownMenuItem disabled>{label}</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// "Swap with": a search over every track of the pack (thousands), showing the first matches.
function SwapPicker({ a, names, self, onPick }: { a: any; names: ModCups["names"]; self: number; onPick: (j: number) => void }) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const needle = q.trim().toLowerCase();
  const hits: number[] = [];
  if (open) for (let j = 0; j < a.tracks.length && hits.length < 60; j++) {
    if (j === self) continue;
    const label = `${cupName(a, Math.floor(j / 4), names)} ${trackName(a, j, names)} ${trackAuthor(a, j, names)}`.toLowerCase();
    if (!needle || label.includes(needle)) hits.push(j);
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Hint wrap title="Swap with another track" text="Search the mod's tracks by name, cup or author, then choose one to exchange with this position. Both tracks trade places."><PopoverTrigger asChild><Button size="sm" variant="ghost">Swap with…</Button></PopoverTrigger></Hint>
      <PopoverContent align="end" className="w-80 p-2">
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Find a track, cup or author…" className="mb-2 h-8 text-xs" aria-label="Find a track to swap with" />
        <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
          {hits.map((j) => (
            <button key={j} type="button" className="cursor-pointer rounded px-2 py-1 text-left text-xs hover:bg-accent" onClick={() => { onPick(j); setOpen(false); setQ(""); }}>
              <span className="block truncate">{trackName(a, j, names) || "Empty position"}</span>
              <span className="block truncate text-[10.5px] text-muted-foreground">{cupName(a, Math.floor(j / 4), names)} · {j % 4 + 1}</span>
            </button>
          ))}
          {!hits.length && <p className="m-0 p-2 text-xs text-muted-foreground">No track matches.</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function NameInput({ value, onDone }: { value: string; onDone: (v: string | null) => void }) {
  const [t, setT] = React.useState(value);
  return (
    <form className="inline-flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); onDone(t.trim() || value); }}>
      <Input autoFocus value={t} onChange={(e) => setT(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") { e.preventDefault(); onDone(null); } }} className="h-7 w-64 text-xs" aria-label="New name" />
      <Button type="submit" size="sm">OK</Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => onDone(null)}>Cancel</Button>
    </form>
  );
}

function CheckLines({ check }: { check: Check }) {
  if ("loading" in check) return <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground"><LoaderCircle className="size-3 animate-spin" /> Checking the archive…</div>;
  if ("failed" in check) return <div className="mt-1.5 flex items-start gap-1.5 text-[11px] text-destructive"><CircleAlert className="mt-px size-3 shrink-0" /> Could not read it: {check.failed}</div>;
  return (
    <ul className="m-0 mt-1.5 flex list-none flex-col gap-0.5 p-0 text-[11px]">
      {check.errors.map((e) => <li key={e} className="flex items-start gap-1.5 text-destructive"><CircleAlert className="mt-px size-3 shrink-0" /> {e}</li>)}
      {check.warnings.map((w) => <li key={w} className="flex items-start gap-1.5 text-warning"><TriangleAlert className="mt-px size-3 shrink-0" /> {w}</li>)}
      {!check.errors.length && <li className="text-muted-foreground">{check.files} files · {check.checkpoints} checkpoints · ready to use.</li>}
    </ul>
  );
}
