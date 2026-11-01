// Cups and tracks: which track the game shows in each cup position. Tracks can trade places
// (arrows or "Swap with"), a slot can take a track archive from disk (a custom track or one made
// with Create new track), and track and cup names can be changed. Nothing is written until Apply,
// which offers a backup of every file it rewrites so the change can be undone from Backups.

import * as React from "react";
import {
  ArchiveRestore, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, CircleHelp, FileAudio, FileQuestion, FileUp, FolderOpen, History, LibraryBig, LoaderCircle, Plus,
  Clapperboard, Music, Pencil, Replace, RotateCcw, Sparkles, Trash2, TriangleAlert, Trophy, X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api, FILTERS } from "../../../js/api.js";
import { CUPS, SLOTS, appliedMusic, initialArrangement, isChanged, moveSlot, neighbourSlot, planArrangement, plannedMusic, replaceSlot, resetSlot, setSlotMusic, slotById, slotPlace, swapSlots } from "../../../js/data/cups.js";
import { editor } from "../editor";
import { dialogs } from "../dialogs-store";
import { buildWrites, createCupTrack, describeArrangement, inspectTrack, musicFolderKey, readGameNames, restoreCupMusic, saveCupMusic, snapshotCupMusic, writeAll, type Arrangement, type MusicChoice } from "../cups";
import { decodeFile } from "../audio-convert";
import { Hint } from "../common";
import { Checkbox } from "@/components/ui/checkbox";
import { THP_LAYOUTS } from "../../../js/formats/thp.js";
import { ThpPart, forgetPreviews } from "../thp-preview";
import { CupIcon, useCupIcons } from "../cup-icons";
import { findPulsarPack, newPulsarCups, pulsarCups } from "../pulsar";
import { findLECode, leCodeCups } from "../lecode-cups";
import { ModCupsView } from "./PulsarCupsView";
import { pulsarLaunchPaths } from "../../../js/editor/pulsar-launch.js";
import { TrackList } from "../TrackList";
import { useEditor } from "../hooks";
import { cn } from "@/lib/utils";

type Check = { errors: string[]; warnings: string[]; files: number; checkpoints: number } | { loading: true } | { failed: string };

export function CupsDialog({ initialFile, close }: { initialFile?: string; close: (v: any) => void }) {
  const [arrangement, setArrangement] = React.useState<Arrangement>(() => initialArrangement());
  const [cup, setCup] = React.useState(0);
  const [names, setNames] = React.useState<{ language: string; text: (id: number) => string | null } | null>(null);
  const [loadingNames, setLoadingNames] = React.useState(true);
  const [moveMusic, setMoveMusic] = React.useState(true);
  const [moveVideos, setMoveVideos] = React.useState(true);
  const [checks, setChecks] = React.useState<Record<string, Check>>({});
  const [showHelp, setShowHelp] = React.useState(false);
  const [view, setView] = React.useState<"cups" | "backups">("cups");
  const [renaming, setRenaming] = React.useState<number | "cup" | null>(null);
  const [pendingFile, setPendingFile] = React.useState(initialFile || "");
  // Clicking a track row opens that track in the editor (can be turned off; remembered).
  // "All tracks" or "Not in a cup" in place of a cup: the track files of the tracks folder.
  const [list, setList] = React.useState<null | "all" | "other">(null);
  // Which cups: the game's own, or those of a mod that adds cups: a Pulsar pack (Config.pul) or an
  // LE-CODE distribution (rel/lecode-*.bin), found in the workspace or opened by hand.
  type Source = { kind: "game" } | { kind: "pulsar"; path: string } | { kind: "lecode"; paths: string[] } | { kind: "new"; name: string; folder: string };
  const [source, setSource] = React.useState<Source>({ kind: "game" });
  const [mods, setMods] = React.useState<{ pulsar: string | null; lecode: string[] }>({ pulsar: null, lecode: [] });
  const [modChanges, setModChanges] = React.useState(0);
  const icons = useCupIcons();
  const ed = useEditor("settings");
  const workspace = editor.workspace();
  const musicFolder = musicFolderKey(editor.workspacePath("sound", "strm") || "");
  const savedMusic = ed.cupMusicByFolder[musicFolder] || {};
  React.useEffect(() => {
    void Promise.all([findPulsarPack(), findLECode()]).then(([pulsar, lecode]) => {
      setMods((m) => ({ pulsar: m.pulsar && m.pulsar !== pulsar ? m.pulsar : pulsar, lecode }));
      if (pulsar) setSource({ kind: "pulsar", path: pulsar });
      else if (lecode.length) setSource({ kind: "lecode", paths: lecode });
    });
  }, [workspace]);
  const leaveMod = async () => !modChanges || dialogs.confirm({ title: "Leave these cups?", description: "The changes to the cups of this mod have not been applied.", confirmLabel: "Discard changes", destructive: true });
  const choose = async (next: Source) => { if (JSON.stringify(next) === JSON.stringify(source) || !(await leaveMod())) return; setModChanges(0); setSource(next); };
  const openMod = async () => {
    const path = await api.choosePath([{ name: "Mod with its own cups (Config.pul, lecode-*.bin)", extensions: ["pul", "bin"] }], "Open the cups of a mod: Binaries/Config.pul of a Pulsar pack, or rel/lecode-PAL.bin of an LE-CODE distribution");
    if (!path) return;
    if (/\.pul$/i.test(path)) { setMods((m) => ({ ...m, pulsar: path })); await choose({ kind: "pulsar", path }); return; }
    // An LE-CODE distribution is read through its files folder (tracks, names and icons are there).
    const files = path.replace(/[\\/]rel[\\/][^\\/]+$/i, "");
    if (files === path) { toast.error("Choose the lecode-*.bin inside the distribution's rel folder"); return; }
    if (!(await leaveMod())) return;
    if (files.toLowerCase() !== (editor.workspace() || "").toLowerCase() && !(await editor.setWorkspace(files))) return;
    const lecode = await findLECode();
    setMods((m) => ({ ...m, lecode })); setModChanges(0);
    if (lecode.length) setSource({ kind: "lecode", paths: lecode });
  };
  const loadPulsar = React.useCallback(() => pulsarCups((source as any).path), [(source as any).path]); // eslint-disable-line react-hooks/exhaustive-deps
  const loadNew = React.useCallback(() => newPulsarCups((source as any).name, (source as any).folder), [(source as any).name, (source as any).folder]); // eslint-disable-line react-hooks/exhaustive-deps
  // The game's cups are fixed: a new cup goes into a mod with its own cups, an existing one or a new
  // Pulsar mod made here (the game's 8 cups stay first, the new cups follow).
  const newCup = async () => {
    const existing = [...(mods.pulsar ? [["pulsar", `Pulsar mod ${mods.pulsar.split(/[\\/]/).slice(-3, -2)[0]}`]] : []), ...(mods.lecode.length ? [["lecode", "LE-CODE distribution"]] : [])] as [string, string][];
    const answer = await dialogs.form({
      title: "New cup",
      description: "Add extra cups after Mario Kart Wii's original eight. The editor prepares a Riivolution cup pack with its patch XML. Choose a name and where to save it.",
      fields: [
        { key: "where", label: "Put the new cup in", type: "select", value: existing.length ? existing[0][0] : "new", options: [...existing, ["new", "A new cup pack"]] },
        { key: "name", label: "Name of the new mod (folder)", type: "text", value: "MyCups", visible: (v) => v.where === "new", hint: "Up to 14 letters, digits, - and _. This is also the name shown when you launch the pack." },
      ],
      confirmLabel: "Continue",
    });
    if (!answer) return;
    if (answer.where === "pulsar" && mods.pulsar) { await choose({ kind: "pulsar", path: mods.pulsar }); toast.info("Press New cup on the left to add a cup to this mod."); return; }
    if (answer.where === "lecode") { await choose({ kind: "lecode", paths: mods.lecode }); toast.info("Press New cup on the left to add a cup to this distribution."); return; }
    const name = String(answer.name || "").trim();
    if (!/^[A-Za-z0-9_-]{1,14}$/.test(name)) { toast.error("Use 1 to 14 letters, digits, - or _ for the mod's name"); return; }
    const folder = await api.chooseFolder(`Where to save the ${name} Riivolution pack (the ${name} and riivolution folders are created here)`, editor.workspace());
    if (!folder) return;
    if (await api.exists(`${folder}\\${name}`)) { toast.error(`${name} already exists there`, { description: "Open it with Open a mod…, or choose another name." }); return; }
    const play = pulsarLaunchPaths(name, folder);
    if (await api.exists(play.xmlPath)) { toast.error("A Riivolution patch with this name already exists", { description: "Choose another name or destination." }); return; }
    await choose({ kind: "new", name, folder });
  };
  // A rename opens the game text editor on that message (every language archive), then the names are read again.
  const renameInGame = async (id: number) => {
    await dialogs.open("gameText", { search: "0x" + id.toString(16).toUpperCase().padStart(4, "0") });
    loadNames();
  };
  const loadLECode = React.useCallback(() => leCodeCups((source as any).paths), [JSON.stringify((source as any).paths)]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadNames = React.useCallback(() => {
    setLoadingNames(true);
    readGameNames().then(setNames).catch(() => setNames(null)).finally(() => setLoadingNames(false));
  }, []);
  React.useEffect(loadNames, [loadNames]);

  // Name of the track now in a slot, as the game shows it (falls back to the original track).
  const gameName = (id: number) => names?.text(id >= 0x20 ? 0x24b8 + id - 0x20 : 0x2454 + id) || slotById(id).label;
  const shownName = (id: number) => {
    const typed = arrangement.names[id];
    if (typed !== undefined) return typed;
    const source = arrangement.content[id];
    return source.type === "slot" ? gameName(source.id) : source.label;
  };
  const cupName = (i: number) => arrangement.cupNames[i] ?? names?.text(CUPS[i].nameId) ?? CUPS[i].name;

  const update = (fn: (a: Arrangement) => Arrangement) => {
    try { setArrangement((a) => fn(a)); } catch (e: any) { toast.warning(e.message); }
  };
  const changedSlots = SLOTS.filter((s) => isChanged(arrangement, s.id)).map((s) => s.id);
  const changeCount = changedSlots.length + Object.keys(arrangement.cupNames).length;
  const plan = planArrangement(arrangement, { moveMusic });
  const fileCheck = (id: number) => { const s = arrangement.content[id]; return s.type === "file" ? checks[`${s.path}|${slotById(id).battle}`] : undefined; };
  const blocked = changedSlots.some((id) => { const c = fileCheck(id); return arrangement.content[id].type === "file" && (!c || "loading" in c || "failed" in c || c.errors.length > 0); });

  // A track archive from disk replaces the track of a slot; its contents are checked at once.
  const replaceWithFile = async (id: number, path: string, generated = false) => {
    const label = path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "").replace(/_/g, " ");
    const key = `${path}|${slotById(id).battle}`;
    update((a) => replaceSlot(a, id, path, label, generated));
    setChecks((c) => ({ ...c, [key]: { loading: true } }));
    try {
      const result = await inspectTrack(path, slotById(id).battle);
      setChecks((c) => ({ ...c, [key]: result }));
    } catch (e: any) { setChecks((c) => ({ ...c, [key]: { failed: e.message } })); }
  };
  const chooseFile = async (id: number) => {
    const path = await api.choosePath([{ name: "Track archive", extensions: ["szs", "wlz", "wbz", "wu8"] }], `Track for ${CUPS[slotPlace(id).cup].name} ${slotPlace(id).position + 1}`);
    if (path) await replaceWithFile(id, path);
  };
  const newTrack = async (id: number) => {
    const place = slotPlace(id);
    const path = await createCupTrack(`${CUPS[place.cup].name} - Track ${place.position + 1}`, editor.workspacePath("Race", "Course", `${slotById(id).file}.szs`));
    if (path) await replaceWithFile(id, path, true);
  };
  // The track open in the editor: it must be saved as a file first (a new track has no file yet).
  const useOpenTrack = async (id: number) => {
    const d = editor.doc;
    if (d.fileKind !== "szs" && d.fileKind !== "new") return toast.warning("The open file is not a track archive (.szs)");
    if (!d.filePath || d.dirty || d.fileKind === "new") {
      const ok = await dialogs.confirm({ title: "Save the open track first?", description: `"${d.fileName}" ${d.filePath ? "has unsaved changes" : "is not saved as a file yet"}. The cup takes the track from its .szs file, so it is saved first (Save as asks where). Save it somewhere outside Race\\Course, for example in a folder of your own tracks.`, confirmLabel: "Save track" });
      if (!ok || !(await editor.save(!d.filePath))) return;
    }
    if (editor.doc.filePath) await replaceWithFile(id, editor.doc.filePath);
  };
  // An audio file of the person's as the music of a slot: checked now, converted when applied.
  const chooseMusicFile = async (id: number) => {
    const slot = slotById(id), place = slotPlace(id);
    const path = await api.choosePath(FILTERS.audio, `Music for ${CUPS[place.cup].name} ${place.position + 1} · ${shownName(id)}`);
    if (!path) return;
    const file = path.split(/[\\/]/).pop()!;
    let seconds = 0;
    try {
      const audio = await editor.withBusy(`Reading ${file}…`, async () => decodeFile(path, (await api.readPath(path)).data));
      seconds = audio.channels[0].length / audio.rate;
      if (!seconds) throw new Error("The audio file is empty");
    } catch (e: any) { toast.error("Could not use this audio file", { description: e.message }); return; }
    const shared = SLOTS.filter((s) => s.music === slot.music && s.id !== id).map((s) => s.label);
    const options: any = await dialogs.form({
      title: `Music for ${shownName(id)}`,
      description: `${file} (${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}) replaces ${slot.music}, the music of this position, when you apply: it is converted to the game's format like the original, for the normal laps and the final lap.${shared.length ? ` ${shared.join(" and ")} also play${shared.length === 1 ? "s" : ""} ${slot.music}, so ${shared.length === 1 ? "it gets" : "they get"} this music too.` : ""}`,
      fields: [
        { key: "loop", label: "Loop", type: "switch", value: true, hint: "When the music ends it starts again from the loop start." },
        { key: "loopStart", label: "Loop start (seconds)", type: "number", value: 0, min: 0, max: Math.floor(seconds), hint: "Where the music starts again after its end. 0 loops the whole music." },
        { key: "volume", label: "Volume (%)", type: "number", value: 100, min: 10, max: 400, step: 5 },
        { key: "finalFaster", label: "Final lap 10% faster", type: "switch", value: true, hint: "Like the game's own music, the final lap plays it a little faster. Off: the same music." },
      ],
      confirmLabel: "Use this music",
    });
    if (!options) return;
    update((a) => setSlotMusic(a, id, { type: "file", path, label: file.replace(/\.[^.]+$/, ""), loop: !!options.loop, loopStart: Math.max(0, Number(options.loopStart) || 0), volume: Number(options.volume) || 100, finalFaster: !!options.finalFaster }));
  };
  // Opened from "Put in a cup" after creating a track: the file waits for a slot.
  const placePending = async (id: number) => { const path = pendingFile; setPendingFile(""); await replaceWithFile(id, path); };

  const apply = async () => {
    const lines = describeArrangement(arrangement, gameName);
    const choice: any = await dialogs.open("cupsApply", { lines, musicKept: plan.musicKept.map((m: any) => m.slots.map((s: number) => slotById(s).label).join(" and ")) });
    if (!choice) return;
    const done = await editor.withBusy("Preparing the changes…", async () => {
      const progress = (text: string) => { editor.busy = text; editor.bump("ui"); };
      try {
        const { writes, notes, plan: writtenPlan, musicApplied } = await buildWrites(arrangement, { moveMusic, moveVideos, progress });
        if (!writes.length) { toast.info("Nothing to write: the files already match."); return false; }
        const open = editor.doc.filePath?.toLowerCase();
        const touchesOpen = !!open && writes.some((w) => w.path.toLowerCase() === open);
        const snapshot = await writeAll(writes, { backup: choice.backup, label: lines.slice(0, 3).join(" · ") + (lines.length > 3 ? ` · ${lines.length - 3} more` : ""), details: { lines, cupMusic: snapshotCupMusic(writes.map((w) => w.path)) }, progress });
        if (musicApplied.length) saveCupMusic(musicFolder, appliedMusic(writtenPlan, savedMusic, musicApplied));
        toast.success(`Cups changed: ${writes.length} file${writes.length === 1 ? "" : "s"} written`, {
          description: [snapshot ? "A backup was made first: Backups in this window puts the files back." : "No backup was made.", ...notes].join(" "), duration: 10000,
        });
        if (touchesOpen) toast.info("The track open in the editor was one of the changed files", { description: "Reopen it to see the track now in that slot.", action: { label: "Reopen", onClick: () => void editor.openPath(editor.doc.filePath!) } });
        return true;
      } catch (e: any) {
        dialogs.alert({ title: "Could not change the cups", description: `${e.message}. Files written before the error can be put back from Backups.` });
        return false;
      }
    });
    if (done) {
      setArrangement(initialArrangement());
      setChecks({});
      forgetPreviews();
      loadNames();
      void editor.refreshTrackFiles();
    }
  };

  // The moving preview behind a row: the part of the cup video that shows the track now in it.
  const previewOf = (id: number) => {
    const source = arrangement.content[id];
    const previewSlot = moveVideos && source.type === "slot" ? source.id : id;
    const { cup: c, position } = slotPlace(previewSlot);
    const entry = Object.entries(THP_LAYOUTS).find(([, l]: any) => l.cup === c);
    const path = entry && editor.workspacePath("thp", ...entry[0].split("/"));
    return path ? { path, name: entry![0], part: String(position), label: slotById(previewSlot).label, rect: (entry![1] as any).regions[position] } : null;
  };
  // Each track gets its own editor window; the cups and their pending changes stay open.
  const openTrack = async (id: number) => {
    const source = arrangement.content[id];
    await openFile(source.type === "file" ? source.path : editor.workspacePath("Race", "Course", `${slotById(source.id).file}.szs`));
  };
  const openFile = async (path: string) => {
    if (!path) return;
    await editor.openPath(path, { newWindow: true });
  };

  const requestClose = async () => {
    const pendingChanges = changeCount + modChanges;
    if (pendingChanges && !(await dialogs.confirm({ title: "Close without applying?", description: `${pendingChanges} change${pendingChanges === 1 ? "" : "s"} to the cups have not been applied. Nothing has been written to the game files.`, confirmLabel: "Close without applying", destructive: true }))) return;
    close(null);
  };

  const raceCups = CUPS.map((c, i) => ({ ...c, i })).filter((c) => !c.battle), battleCups = CUPS.map((c, i) => ({ ...c, i })).filter((c) => c.battle);
  const current = CUPS[cup];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <DialogTitle className="flex items-center gap-2 text-sm"><Trophy className="size-4" /> Cups and tracks</DialogTitle>
          <DialogDescription className="m-0 text-xs">Every track of your game, by cup: open tracks in separate 3D editor windows, move them between cups, put in your own, change their music and names, and add new cups to mods.</DialogDescription>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button size="sm" variant={showHelp ? "secondary" : "ghost"} aria-pressed={showHelp} onClick={() => setShowHelp(!showHelp)}><CircleHelp /> How it works</Button>
          <Button size="sm" variant={view === "backups" ? "secondary" : "ghost"} onClick={() => setView(view === "backups" ? "cups" : "backups")}><History /> Backups</Button>
          <Button size="icon-sm" variant="ghost" title="Close" aria-label="Close cups editor" onClick={requestClose}><X /></Button>
        </div>
      </div>

      {showHelp && <HowItWorks onClose={() => setShowHelp(false)} />}

      {view === "cups" && (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <label htmlFor="cups-source" className="mr-1 text-[11px] text-muted-foreground">Cups of</label>
          <Select value={source.kind} onValueChange={(kind) => {
            if (kind === "game") void choose({ kind: "game" });
            else if (kind === "pulsar" && mods.pulsar) void choose({ kind: "pulsar", path: mods.pulsar });
            else if (kind === "lecode" && mods.lecode.length) void choose({ kind: "lecode", paths: mods.lecode });
          }}>
            <SelectTrigger id="cups-source" className="h-7 w-72 max-w-full text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="game">The game (8 cups + 2 battle)</SelectItem>
              {mods.pulsar && <SelectItem value="pulsar" title={mods.pulsar}>Pulsar mod: {mods.pulsar.split(/[\\/]/).slice(-3, -2)[0]}</SelectItem>}
              {source.kind === "new" && <SelectItem value="new">New mod: {source.name}</SelectItem>}
              {mods.lecode.length > 0 && <SelectItem value="lecode" title={mods.lecode.join(", ")}>LE-CODE distribution</SelectItem>}
            </SelectContent>
          </Select>
          <Hint title="Open a mod" text="A mod that adds its own cups: the Config.pul in the Binaries folder of a Pulsar pack (such as Insane Kart Wii), or a lecode-*.bin in the rel folder of an LE-CODE distribution. Mods found through the game folder or its Riivolution XML are listed here by themselves."><Button size="sm" variant="ghost" onClick={() => void openMod()}><FolderOpen /> Open a mod…</Button></Hint>
          <Hint title="Beta" text="The cups of mods (Pulsar packs and LE-CODE distributions) and the creation of new cups are in beta: keep the backup and test the mod in Dolphin before sharing it."><Badge variant="outline">Mod cups: beta</Badge></Hint>
          <Hint title="Background videos" text="Play the tracks’ video previews behind their rows. Turn off to reduce background activity. Your choice is remembered.">
            <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs">
              <Checkbox aria-label="Play background videos" checked={ed.settings.trackVideoPreviews} onCheckedChange={(checked) => ed.setSetting("trackVideoPreviews", checked === true)} />
              Play background videos
            </label>
          </Hint>
        </div>
      )}

      {view === "cups" && source.kind === "pulsar" ? <ModCupsView key={source.path} load={loadPulsar} onChanges={setModChanges} />
        : view === "cups" && source.kind === "lecode" ? <ModCupsView key={source.paths.join("|")} load={loadLECode} onChanges={setModChanges} />
        : view === "cups" && source.kind === "new" ? <ModCupsView key={`new|${source.folder}|${source.name}`} load={loadNew} onChanges={setModChanges}
          onApplied={() => {
            const path = `${source.folder}\\${source.name}\\Binaries\\Config.pul`;
            const play = pulsarLaunchPaths(source.name, source.folder);
            toast.success("Riivolution cup pack created", {
              description: `Load riivolution/${source.name}.xml, set ${source.name} → Pack to Enabled, then launch Mario Kart Wii.`,
              action: { label: "Show Riivolution XML", onClick: () => { void api.reveal(play.xmlPath).catch((e: Error) => toast.error("Could not show the Riivolution XML", { description: e.message })); } }, duration: 15000,
            });
            setMods((m) => ({ ...m, pulsar: path })); setModChanges(0); setSource({ kind: "pulsar", path });
          }} />
        : !workspace ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-[13px] text-muted-foreground">
          <p className="m-0 max-w-md">The cups are made of the game's own files: choose the extracted game's <b>files</b> folder first (with Race, Scene and sound).</p>
          <Button onClick={() => void editor.chooseWorkspace().then(loadNames)}>Choose the game folder…</Button>
        </div>
      ) : view === "backups" ? <BackupsView onClose={() => setView("cups")} onRestored={() => { loadNames(); void editor.refreshTrackFiles(); }} /> : (
        <div className="grid min-h-0 flex-1 grid-cols-[200px_minmax(0,1fr)] gap-4">
          <nav className="flex min-h-0 flex-col gap-0.5 overflow-y-auto border-r pr-3" aria-label="Cups">
            <button type="button" aria-pressed={list === "all"} onClick={() => { setList("all"); setRenaming(null); }}
              className={cn("flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs", list === "all" ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground")}>
              <LibraryBig className="size-4 shrink-0" /><span className="min-w-0 flex-1 truncate">All tracks</span>
              {ed.trackFiles?.files.length ? <span className="shrink-0 text-[10px] tabular-nums">{ed.trackFiles.files.length}</span> : null}
            </button>
            {[["Race cups", raceCups], ["Battle stages", battleCups]].map(([title, cups]: any) => (
              <React.Fragment key={title}>
                <div className="px-2 pb-1 pt-2 text-[11px] font-medium text-muted-foreground first:pt-0">{title}</div>
                {cups.map((c: any) => {
                  const n = c.slots.filter((s: number) => changedSlots.includes(s)).length + (arrangement.cupNames[c.i] !== undefined ? 1 : 0);
                  return (
                    <button key={c.i} type="button" aria-pressed={!list && cup === c.i} onClick={() => { setCup(c.i); setList(null); setRenaming(null); }}
                      className={cn("flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs", !list && cup === c.i ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground")}>
                      <CupIcon cup={c.i} icons={icons} />
                      <span className="min-w-0 flex-1 truncate">{cupName(c.i)}</span>
                      {n > 0 && <span className="shrink-0 text-[10px] tabular-nums text-foreground" title={`${n} change${n === 1 ? "" : "s"}`}>{n} changed</span>}
                    </button>
                  );
                })}
              </React.Fragment>
            ))}
            <div className="px-2 pb-1 pt-2 text-[11px] font-medium text-muted-foreground">Other tracks</div>
            <button type="button" aria-pressed={list === "other"} onClick={() => { setList("other"); setRenaming(null); }}
              className={cn("flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs", list === "other" ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground")}>
              <FileQuestion className="size-4 shrink-0" /><span className="min-w-0 flex-1 truncate">Not in a cup</span>
            </button>
            <Hint title="New cup" text="Create extra cups in a Riivolution pack. The original eight cups stay first."><Button size="sm" variant="secondary" className="mt-2" onClick={() => void newCup()}><Plus /> New cup…</Button></Hint>
            <p className="m-0 px-2 text-[10.5px] leading-relaxed text-muted-foreground">Extra cups use a Riivolution cup pack.</p>
          </nav>

          {list ? (
            <div className="flex min-h-0 flex-col gap-3">
              <div className="shrink-0">
                <div className="text-[15px] font-semibold">{list === "all" ? "All tracks" : "Tracks that are in no cup"}</div>
                <div className="text-[11px] text-muted-foreground">{list === "all" ? "Every track file of the tracks folder. Click one to open it in the editor." : "Custom tracks, demos and other archives that the game does not show in a cup. Click one to open it in the editor; put it in a cup with Replace on a cup's track."}</div>
              </div>
              <TrackList section={list} onOpen={(path) => void openFile(path)} />
            </div>
          ) : (
          <div className="flex min-h-0 flex-col gap-3">
            <div className="flex shrink-0 items-center gap-2">
              <Hint title="Previous cup" text="Show the cup before this one."><Button size="icon" variant="outline" aria-label="Previous cup" disabled={cup === 0} onClick={() => { setCup(cup - 1); setRenaming(null); }}><ChevronLeft /></Button></Hint>
              <div className="min-w-0 flex-1 text-center">
                {renaming === "cup" ? (
                  <NameInput value={cupName(cup)} onDone={(v) => { setRenaming(null); if (v !== null) update((a) => { const cupNames = { ...a.cupNames }; if (v === (names?.text(current.nameId) ?? current.name)) delete cupNames[cup]; else cupNames[cup] = v; return { ...a, cupNames }; }); }} />
                ) : (
                  <button type="button" className="group inline-flex cursor-pointer items-center gap-1.5 rounded px-2 py-0.5 text-[15px] font-semibold hover:bg-accent" onClick={() => void renameInGame(current.nameId).then(() => update((a) => { const cupNames = { ...a.cupNames }; delete cupNames[cup]; return { ...a, cupNames }; }))} title="Rename this cup in the game text editor">
                    <CupIcon cup={cup} icons={icons} className="size-7" /> {cupName(cup)} <Pencil className="size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
                  </button>
                )}
                <div className="text-[11px] text-muted-foreground">{current.battle ? `Battle stages ${cup - 7} of 2` : `Cup ${cup + 1} of 8`} · {current.slots.length} {current.battle ? "arenas" : "tracks"}{loadingNames ? " · reading names…" : names ? ` · names in language ${names.language}` : ""}</div>
              </div>
              <Hint title="Next cup" text="Show the cup after this one."><Button size="icon" variant="outline" aria-label="Next cup" disabled={cup === CUPS.length - 1} onClick={() => { setCup(cup + 1); setRenaming(null); }}><ChevronRight /></Button></Hint>
            </div>

            {pendingFile && (
              <div className="flex shrink-0 items-center gap-2 rounded-md border px-3 py-2 text-xs">
                <FileUp className="size-4 shrink-0" />
                <span className="min-w-0 flex-1">Choose the position for <b>{pendingFile.split(/[\\/]/).pop()}</b>: press <b>Put here</b> on the track it should replace.</span>
                <Button size="sm" variant="ghost" onClick={() => setPendingFile("")}>Cancel</Button>
              </div>
            )}

            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
              {current.slots.map((id: number, position: number) => (
                <SlotRow key={id} id={id} position={position} arrangement={arrangement} check={fileCheck(id)} name={shownName(id)} gameName={gameName}
                  preview={previewOf(id)} playPreview={ed.settings.trackVideoPreviews} onOpen={!pendingFile && renaming !== id ? () => void openTrack(id) : null}
                  music={plannedMusic(plan, id, savedMusic)} musicKept={plan.musicKept.some((m: any) => m.slots.includes(id))}
                  musicShared={(() => { const m = plan.musicShared.find((m: any) => m.slots.includes(id)); return m ? m.slots.filter((s: number) => s !== id).map((s: number) => slotById(s).label).join(" and ") : null; })()}
                  onMusic={(choice) => update((a) => setSlotMusic(a, id, choice))} onMusicFile={() => void chooseMusicFile(id)}
                  renaming={renaming === id} setRenaming={(on) => setRenaming(on ? id : null)} pending={!!pendingFile}
                  onRenameRequest={() => {
                    const source = arrangement.content[id];
                    if (source.type !== "slot") { setRenaming(id); return; }
                    const nameId = source.id >= 0x20 ? 0x24b8 + source.id - 0x20 : 0x2454 + source.id;
                    void renameInGame(nameId).then(() => update((a) => { const n = { ...a.names }; delete n[id]; return { ...a, names: n }; }));
                  }}
                  onMove={(dir) => update((a) => moveSlot(a, id, dir))}
                  onSwap={(other) => update((a) => swapSlots(a, id, other))}
                  onFile={() => void chooseFile(id)} onOpenTrack={() => void useOpenTrack(id)} onNewTrack={() => void newTrack(id)} onPlace={() => void placePending(id)}
                  onRename={(v) => update((a) => { const n = { ...a.names }; const source = a.content[id]; const original = source.type === "slot" ? gameName(source.id) : null; if (v === original) delete n[id]; else n[id] = v; return { ...a, names: n }; })}
                  onReset={() => update((a) => resetSlot(a, id))}
                  slotName={(other) => `${cupName(slotPlace(other).cup)} ${slotPlace(other).position + 1} · ${shownName(other)}`} />
              ))}
            </div>
          </div>
          )}
        </div>
      )}

      {workspace && view === "cups" && source.kind === "game" && (
        <DialogFooter className="shrink-0 items-center gap-3 border-t pt-3 sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <Switch checked={moveMusic} onCheckedChange={setMoveMusic} />
              <span>Music moves with the track <span className="block text-[11px] text-muted-foreground">Off: each position keeps its own music.</span></span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <Switch checked={moveVideos} onCheckedChange={setMoveVideos} />
              <span>Preview videos follow the tracks <span className="block text-[11px] text-muted-foreground">The cup's video is encoded again (a few seconds per cup).</span></span>
            </label>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{changeCount ? `${changeCount} change${changeCount === 1 ? "" : "s"} not applied yet` : "No changes"}</span>
            <Button variant="outline" disabled={!changeCount} onClick={() => { setArrangement(initialArrangement()); setChecks({}); }}><RotateCcw /> Discard</Button>
            <Hint title="Apply changes" text={blocked ? "A replacement track has problems the game cannot handle: see the red messages." : "Shows a summary, backs up the files and writes the new cups into the game folder."}>
              <span className="inline-flex"><Button disabled={!changeCount || blocked} onClick={() => void apply()}>Apply changes…</Button></span>
            </Hint>
          </div>
        </DialogFooter>
      )}
    </div>
  );
}

function HowItWorks({ onClose }: { onClose: () => void }) {
  return (
    <section className="shrink-0 rounded-md border p-3 text-xs leading-relaxed">
      <div className="mb-1.5 flex items-center justify-between"><b className="text-[13px]">How cups work in Mario Kart Wii</b><Button size="sm" variant="ghost" onClick={onClose}>Hide</Button></div>
      <div className="grid gap-x-6 gap-y-1.5 md:grid-cols-2">
        <p className="m-0">Every cup position is a fixed <b>slot</b> of the game: Mushroom Cup 1 always loads <code>Race/Course/beginner_course.szs</code>, Flower Cup 2 always loads <code>shopping_course.szs</code>, and so on. To put Coconut Mall where Luigi Circuit was, the two archives change places, and so do their names in the menus.</p>
        <p className="m-0"><b>Move a track:</b> <ArrowUp className="inline size-3" /> <ArrowDown className="inline size-3" /> move it one place up or down (into the next cup at the ends), <ArrowLeft className="inline size-3" /> <ArrowRight className="inline size-3" /> move it to the same place of the previous or next cup. <b>Swap with</b> exchanges it directly with any other track. The track that was there takes its old place.</p>
        <p className="m-0"><b>Replace a track:</b> <b>Replace</b> puts a track archive from disk (a custom track, or one made with <i>Create new track</i>) into the slot, or the track open in the editor. It is checked first: it needs course.kmp, course.kcl, course_model.brres and vrcorn_model.brres, and checkpoints in a race slot.</p>
        <p className="m-0"><b>Names and music:</b> names follow the track in every language; a name you type is used in every language. Music follows the track too (unless you turn it off below), except where two positions share one music file (Luigi Circuit and Mario Circuit): there the music stays with the position.</p>
        <p className="m-0"><b>Change the music:</b> click the <Music className="inline size-3" /> music of a track to give it the <b>music of another track</b> or an <b>audio file</b> of yours (WAV, MP3, Ogg, FLAC, BRSTM…), converted to the game's format when you apply, with its loop, volume and a faster final lap. The chosen music moves with the track.</p>
        <p className="m-0"><b>Apply</b> writes the archives (and the <code>_d</code> multiplayer copies), the music and the game text. Its confirmation always has a <b>Make a backup first?</b> checkbox. With it checked, every affected file is copied before writing; <b>Backups</b> can put the files back. Unchecked, no backup or .bak files are created for that operation.</p>
        <p className="m-0"><b>Preview videos:</b> when you hover a track, the menu plays its part of the cup's video (<code>thp/course</code>). With <b>Preview videos follow the tracks</b> on, a moved track takes its preview with it. A track from a file keeps the preview of the position: change it in <i>Tools › Preview videos</i>.</p>
        <p className="m-0"><b>Mods with their own cups (beta):</b> Pulsar packs (such as Insane Kart Wii, <code>Binaries/Config.pul</code>) and LE-CODE distributions (<code>rel/lecode-*.bin</code>) define their cups themselves, so there you can also <b>add new cups</b> with their own icon and new tracks (from a file, or <i>New track</i> to draw one), move whole cups, and search hundreds of cups. Choose them under <b>Cups of</b>, or <b>Open a mod…</b>. Only the cups and tracks are changed; the mod's other settings stay as they are.</p>
        <p className="m-0"><b>Not changed:</b> the staff ghosts of Time Trials, the picture of each cup on the cup selection and the few objects the game ties to a slot stay with the position. Test the result in Dolphin before copying it to a Wii.</p>
      </div>
    </section>
  );
}

function NameInput({ value, onDone }: { value: string; onDone: (v: string | null) => void }) {
  const [text, setText] = React.useState(value);
  return (
    <form className="inline-flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); onDone(text.trim() || value); }}>
      <Input autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") { e.preventDefault(); onDone(null); } }} className="h-7 w-64 text-xs" aria-label="New name" />
      <Button type="submit" size="sm">OK</Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => onDone(null)}>Cancel</Button>
    </form>
  );
}

function SlotRow({ id, position, arrangement, check, name, gameName, music, musicKept, musicShared, onMusic, onMusicFile, renaming, setRenaming, pending, onMove, onSwap, onFile, onOpenTrack, onNewTrack, onPlace, onRename, onReset, slotName, preview, playPreview, onOpen, onRenameRequest }: {
  id: number; position: number; arrangement: Arrangement; check?: Check; name: string; gameName: (id: number) => string;
  music: { stream: string; from: string | null; file: any }; musicKept: boolean; musicShared: string | null; onMusic: (choice: MusicChoice | null) => void; onMusicFile: () => void;
  preview: { path: string; name: string; part: string; label: string; rect: { x: number; y: number; width: number; height: number } } | null; onOpen: (() => void) | null; onRenameRequest: () => void;
  playPreview: boolean;
  renaming: boolean; setRenaming: (on: boolean) => void; pending: boolean;
  onMove: (dir: number | string) => void; onSwap: (other: number) => void; onFile: () => void; onOpenTrack: () => void; onNewTrack: () => void; onPlace: () => void;
  onRename: (v: string) => void; onReset: () => void; slotName: (id: number) => string;
}) {
  const slot = slotById(id);
  const source = arrangement.content[id];
  const changed = isChanged(arrangement, id);
  const from = source.type === "slot" && source.id !== id ? slotPlace(source.id) : null;
  const musicChoice = arrangement.music[id];
  const musicTracks = music.file ? "" : SLOTS.filter((s) => s.music === music.from).map((s) => s.label).join(" / ");
  const [previewVersion, setPreviewVersion] = React.useState(0);
  const openPreview = async () => {
    if (!preview) return;
    await dialogs.open("thp", { initialPath: preview.path, initialPart: preview.part });
    forgetPreviews();
    setPreviewVersion((v) => v + 1);
  };
  const arrow = (dir: number | string, Icon: any, title: string) => {
    const target = neighbourSlot(id, dir);
    const text = target === null
      ? `There is no ${dir === -1 || dir === "cup-1" ? "previous" : "next"} ${typeof dir === "string" ? "cup" : "track position"} for this ${slot.battle ? "battle stage" : "race track"}.`
      : `Exchange this track with ${slotName(target)}. The other track takes this position.`;
    return <Hint title={title} text={text}><span className="inline-flex"><Button size="icon-sm" variant="ghost" aria-label={title} disabled={target === null} onClick={() => onMove(dir)}><Icon /></Button></span></Hint>;
  };
  const others = SLOTS.filter((s) => s.battle === slot.battle && s.id !== id);
  return (
    <div className={cn("relative flex min-h-24 shrink-0 flex-col overflow-hidden rounded-md border px-3 py-3", changed && "border-foreground/40", onOpen && "cursor-pointer hover:border-foreground/60")} data-slot={slot.file}
      onClick={(e) => {
        // Not from buttons, fields, or menus opened from the row (they are elsewhere in the page).
        const target = e.target as HTMLElement;
        if (onOpen && e.currentTarget.contains(target) && !target.closest("button, input, a, [role=menuitem], form")) onOpen();
      }}>
      {preview && playPreview && <>
        <ThpPart key={previewVersion} path={preview.path} rect={preview.rect} className="absolute inset-0 size-full" />
        {/* Keeps the names and buttons readable over the moving picture. */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-card via-card/80 to-card/30" />
      </>}
      <div className="relative flex items-start gap-3">
        <span className="mt-0.5 w-5 shrink-0 text-center text-[13px] font-semibold tabular-nums text-muted-foreground">{position + 1}</span>
        <div className="min-w-0 flex-1">
          {renaming ? <NameInput value={name} onDone={(v) => { setRenaming(false); if (v !== null) onRename(v); }} /> : (
            <div className="flex flex-wrap items-center gap-2">
              <Hint title={onOpen ? "Open track" : undefined} text={onOpen ? "Open this track in the editor. You will be asked before discarding any unapplied cup changes." : undefined}><span className="truncate text-[13.5px] font-medium">{name}</span></Hint>
              {source.type === "file" && <Badge variant="outline">{source.generated ? "new track" : "from file"}</Badge>}
              {from && <Badge variant="outline">was {CUPS[from.cup].name} {from.position + 1}</Badge>}
              {arrangement.names[id] !== undefined && source.type === "slot" && <Badge variant="outline">renamed</Badge>}
            </div>
          )}
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
            <Hint title="Track archive" text={`The game loads Race/Course/${slot.file}.szs for this position. Replacing or moving a track changes this archive when you apply.`}><span>{slot.file}.szs{source.type === "file" ? ` ← ${source.path.split(/[\\/]/).pop()}` : from ? ` ← ${slotById(source.id).file}.szs` : ""}</span></Hint>
          </div>
          {check && <CheckLines check={check} />}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-0.5">
          {pending ? <Hint title="Put track here" text="Assign the chosen track file to this position. Its checks will be shown before you apply."><Button size="sm" onClick={onPlace}><FileUp /> Put here</Button></Hint> : <>
            {arrow(-1, ArrowUp, "Move up")}
            {arrow(1, ArrowDown, "Move down")}
            {arrow("cup-1", ArrowLeft, "Move to the previous cup")}
            {arrow("cup+1", ArrowRight, "Move to the next cup")}
            <DropdownMenu>
              <Hint wrap title="Swap with another track" text="Choose a track in any cup to exchange with this one. Both tracks trade positions, and their names and chosen music follow them."><DropdownMenuTrigger asChild><Button size="sm" variant="ghost">Swap with…</Button></DropdownMenuTrigger></Hint>
              <DropdownMenuContent align="end" className="max-h-[60vh] overflow-y-auto">
                {CUPS.filter((c) => !!c.battle === slot.battle).map((c) => (
                  <React.Fragment key={c.name}>
                    <DropdownMenuLabel className="text-[11px] text-muted-foreground">{c.name}</DropdownMenuLabel>
                    {c.slots.filter((s) => s !== id).map((s) => <DropdownMenuItem key={s} onSelect={() => onSwap(s)}>{slotName(s)}</DropdownMenuItem>)}
                  </React.Fragment>
                ))}
                {!others.length && <DropdownMenuItem disabled>No other position</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <Hint wrap title="Replace track" text="Use a track archive from disk, the track open in the editor, or create a new track for this position. The replacement is checked before you apply."><DropdownMenuTrigger asChild><Button size="sm" variant="ghost"><Replace /> Replace</Button></DropdownMenuTrigger></Hint>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onFile}><FileUp /> Track file (.szs, .wbz…)…</DropdownMenuItem>
                <DropdownMenuItem onSelect={onOpenTrack} disabled={editor.isEmpty}><Trophy /> Track open in the editor ({editor.doc.fileName})</DropdownMenuItem>
                <DropdownMenuItem onSelect={onNewTrack}><Sparkles /> Create a new track…</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Hint title="Rename track" text={source.type === "slot" ? "Open this track's name in the game text editor to change how it appears in the game's menus." : "Change the name of this replacement track for this cup position. The name is saved when you apply."}><Button size="sm" variant="ghost" onClick={onRenameRequest}><Pencil /> Rename…</Button></Hint>
            <Hint title="Reset this position" text={changed ? "Discard this position's unapplied track, name and music changes. Changes already saved in the game files are kept." : "This position has no unapplied changes to reset."}><span className="inline-flex"><Button size="icon-sm" variant="ghost" aria-label="Reset this position" disabled={!changed} onClick={onReset}><RotateCcw /></Button></span></Hint>
          </>}
        </div>
      </div>
      <div className="relative mt-auto space-y-1 pt-2 text-[11px] text-muted-foreground">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <DropdownMenu>
            <Hint title="Music of this position" text={musicKept ? "These positions share a music file but have conflicting music choices, so the saved music stays unchanged. Choose one music source for the shared positions to change it." : `Choose another track's music or an audio file for this position. The change is saved when you apply.${musicTracks ? ` This music is originally used by ${musicTracks}.` : ""}`}>
              <span className="inline-flex min-w-0 flex-1">
                <DropdownMenuTrigger asChild>
                  <button type="button" aria-label="Music of this position" className="inline-flex w-max max-w-full min-w-0 cursor-pointer items-center gap-1 rounded px-1 text-left hover:bg-accent hover:text-foreground">
                    <Music className="size-3 shrink-0" /><span className="min-w-0 truncate">{music.file ? `${music.file.label} (audio file)` : `${music.from}${musicTracks ? ` (${musicTracks})` : ""}`}{musicKept && " (stays: shared file)"}</span><ChevronDown className="size-3 shrink-0" />
                  </button>
                </DropdownMenuTrigger>
              </span>
            </Hint>
            <DropdownMenuContent align="start" className="w-72">
              <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">Music file of this position: {slot.music}</DropdownMenuLabel>
              <DropdownMenuItem onSelect={onMusicFile}><FileAudio /> Audio file (WAV, MP3, Ogg, FLAC, BRSTM…)…</DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger><Music /> Music of another track</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-[60vh] w-72 overflow-y-auto">
                  {CUPS.map((c) => (
                    <React.Fragment key={c.name}>
                      <DropdownMenuLabel className="text-[11px] text-muted-foreground">{c.name}</DropdownMenuLabel>
                      {c.slots.map((s) => (
                        <DropdownMenuItem key={s} onSelect={() => onMusic({ type: "slot", id: s })} className="justify-between gap-3">
                          <span className="truncate">{gameName(s)}</span><span className="shrink-0 font-mono text-[10px] text-muted-foreground">{slotById(s).music}</span>
                        </DropdownMenuItem>
                      ))}
                    </React.Fragment>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              {musicChoice && <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onMusic(null)}><RotateCcw /> Music that goes with the track</DropdownMenuItem>
              </>}
            </DropdownMenuContent>
          </DropdownMenu>
          {musicChoice && <Badge variant="outline" className="h-4 px-1 text-[10px]">music changed</Badge>}
        </div>
        {musicShared && <div className="mt-1 flex items-start gap-1.5 text-[11px] text-warning"><TriangleAlert className="mt-px size-3 shrink-0" /> {slot.music} is also the music of {musicShared}: it plays this music too.</div>}
        {preview && <div className="flex min-w-0">
          <Hint side="bottom" hoverable={false} title="Track preview video" text={`Open thp/${preview.name} in the preview video editor, with ${preview.label}'s part selected. Each cup shares one THP file; you can replace just this track's preview with a picture or video.`}>
            <button type="button" aria-label="Track preview video" onClick={() => void openPreview()} className="inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1 rounded px-1 text-left hover:bg-accent hover:text-foreground">
              <Clapperboard className="size-3 shrink-0" /><span className="min-w-0 truncate">{preview.name} ({preview.label})</span><Pencil className="size-3 shrink-0" />
            </button>
          </Hint>
        </div>}
      </div>
    </div>
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

// ---- Confirmation before writing ---------------------------------------------------------------
// Used by Cups and tracks and by the preview video editor: what will be written, and the backup.
export function CupsApplyDialog({ lines, musicKept = [], title, description, written, confirmLabel, close }: {
  lines: string[]; musicKept?: string[]; title?: string; description?: string; written?: string; confirmLabel?: string; close: (v: any) => void;
}) {
  const [backup, setBackup] = React.useState(true);
  const backupId = React.useId();
  return (
    <>
      <DialogHeader>
        <DialogTitle>{title || "Apply the new cups?"}</DialogTitle>
        <DialogDescription>{description || "These changes are written into the game folder. Start the game from that folder in Dolphin (or rebuild the image, or export a Riivolution mod) to see them."}</DialogDescription>
      </DialogHeader>
      <ul className="m-0 flex max-h-48 list-disc flex-col gap-0.5 overflow-y-auto rounded-md border py-2 pl-7 pr-3 text-xs">
        {lines.map((l) => <li key={l}>{l}</li>)}
      </ul>
      <p className="m-0 text-xs text-muted-foreground">{written ?? <>Written: the track archives and their <code>_d</code> multiplayer copies in Race/Course, the music in sound/strm when it moves, the preview videos in thp when they move, and the names in every language archive of Scene/UI.{musicKept.length ? ` Music that stays with its position (shared file): ${musicKept.join("; ")}.` : ""}</>}</p>
      <div className="space-y-2 rounded-md border p-3 text-xs">
        <label htmlFor={backupId} className="flex cursor-pointer items-center gap-2 font-medium"><Checkbox id={backupId} checked={backup} onCheckedChange={(checked) => setBackup(checked === true)} /> Make a backup first?</label>
        <p className="m-0 text-muted-foreground">{backup ? <>A copy of every affected file is saved before writing. <b>Backups</b> can restore it later.</> : "Write the changes without creating a backup or .bak files."}</p>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => close(null)}>Cancel</Button>
        <Button variant={backup ? "default" : "destructive"} onClick={() => close({ backup })}>{backup ? `Back up and ${confirmLabel || "apply"}` : `${(confirmLabel || "apply").replace(/^./, (c) => c.toUpperCase())} without backup`}</Button>
      </DialogFooter>
    </>
  );
}

// ---- Backups -------------------------------------------------------------------------------------
export function BackupsView({ onRestored, onClose }: { onRestored: () => void; onClose: () => void }) {
  const [list, setList] = React.useState<any[] | null>(null);
  const refresh = React.useCallback(() => { api.listSnapshots().then(setList).catch(() => setList([])); }, []);
  React.useEffect(refresh, [refresh]);
  const restore = async (s: any) => {
    const ok = await dialogs.confirm({
      title: "Put these files back?",
      description: `The ${s.files.length} files of this backup go back to how they were on ${new Date(s.created).toLocaleString()}: the cups, music and names from before that change. The files as they are now are backed up first, so this can be undone too.`,
      confirmLabel: "Restore",
    });
    if (!ok) return;
    await editor.withBusy("Restoring the backup…", async () => {
      try {
        await api.createSnapshot(`Before restoring the backup of ${new Date(s.created).toLocaleString()}`, s.files.map((f: any) => f.path), { restoring: s.id, cupMusic: snapshotCupMusic(s.files.map((f: any) => f.path)) });
        const result = await api.restoreSnapshot(s.id);
        restoreCupMusic(result.files, s.details?.cupMusic);
        toast.success(`Backup restored: ${result.restored} file${result.restored === 1 ? "" : "s"} put back`, { description: result.removed ? `${result.removed} file${result.removed === 1 ? "" : "s"} that did not exist then removed.` : undefined });
        onRestored();
      } catch (e: any) { dialogs.alert({ title: "Could not restore the backup", description: e.message }); }
    });
    refresh();
  };
  const remove = async (s: any) => {
    if (!(await dialogs.confirm({ title: "Delete this backup?", description: "Its copies of the files are deleted. The game files are not touched.", confirmLabel: "Delete backup", destructive: true }))) return;
    await api.deleteSnapshot(s.id);
    refresh();
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <h3 className="m-0 flex items-center gap-2 text-xs font-semibold"><History className="size-4" /> Backups</h3>
        <Hint title="Back" text="Return to the main view without closing this window."><Button size="sm" variant="secondary" aria-label="Back" onClick={onClose}><ArrowLeft /> Back</Button></Hint>
      </div>
      <p className="m-0 shrink-0 text-xs leading-relaxed text-muted-foreground">With <b>Make a backup first?</b> checked when applying, the affected files are copied here (in the editor's settings folder, not in the game folder). <b className="text-foreground">Restore</b> puts the files back as they were before that change; the newest backup is at the top. To go back to the original game, restore the oldest one.</p>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
        {list === null ? <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground"><LoaderCircle className="size-4 animate-spin" /> Reading backups…</div>
          : !list.length ? <div className="p-4 text-xs text-muted-foreground">No backups yet. Select Make a backup first? when applying to create one.</div>
          : list.map((s) => (
            <div key={s.id} className="flex items-center gap-3 border-b px-3 py-2.5 last:border-b-0">
              <ArchiveRestore className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium" title={s.label}>{s.label}</div>
                <div className="text-[11px] text-muted-foreground">{new Date(s.created).toLocaleString()} · {s.files.length} files · {(s.size / 1048576).toFixed(1)} MB</div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => void restore(s)}><RotateCcw /> Restore…</Button>
              <Button size="icon-sm" variant="ghost" aria-label="Delete backup" title="Delete backup" onClick={() => void remove(s)}><Trash2 /></Button>
            </div>
          ))}
      </div>
    </div>
  );
}
