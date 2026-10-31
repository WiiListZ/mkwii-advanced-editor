// Cups of a mod with its own cups (Pulsar packs such as Insane Kart Wii, LE-CODE distributions): browse and search
// hundreds of cups, move and swap tracks and cups, replace a track with a file or a new track, add
// new cups with their own icon, and rename cups and tracks. Only the cups and tracks of the pack are
// edited: its other settings are kept as they are.

import * as React from "react";
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronLeft, ChevronRight, CircleAlert, FileUp, ImagePlus, LoaderCircle, Pencil, Plus, Replace, RotateCcw, Search, Sparkles,
  Trash2, TriangleAlert, Trophy,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "../../../js/api.js";
import { SLOTS, slotById } from "../../../js/data/cups.js";
import {
  addCup, cupChanged, cupName, initialPulsar, moveTrack, patchCup, patchTrack, removeLastCup, replaceTrack, swapCups, swapTracks, trackAuthor, trackChanged, trackName,
} from "../../../js/data/pulsar-cups.js";
import { editor } from "../editor";
import { dialogs } from "../dialogs-store";
import { inspectTrack, writeAll } from "../cups";
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
  musicOptions: { value: number; label: string }[];
  fileOf: (position: number, from: number | null) => string;
  icon: (cupFrom: number) => Promise<string>;
  build: (a: any, progress: (text: string) => void) => Promise<{ writes: any[]; notes: string[] }>;
  // Opens the game text editor on the name of a cup or track already in the mod; false when the
  // name is not in the mod yet (it is then typed here and written when the changes are applied).
  rename?: (what: { cup: number } | { track: number }) => Promise<boolean>;
  written: string;
};

// A mod's cups as they are; a mod without cups (a new one) starts with an empty first cup.
const startOf = (p: ModCups) => (p.cupCount ? initialPulsar({ cupCount: p.cupCount }) : addCup(initialPulsar({ cupCount: 0 }), "My Cup 1"));

export function ModCupsView({ load: loadMod, onChanges, onApplied }: { load: () => Promise<ModCups>; onChanges: (n: number) => void; onApplied?: () => void }) {
  const [pack, setPack] = React.useState<ModCups | null>(null);
  const [error, setError] = React.useState("");
  const [a, setA] = React.useState<any>(null);
  const [cup, setCup] = React.useState(0);
  const [query, setQuery] = React.useState("");
  const [page, setPage] = React.useState(0);
  const [checks, setChecks] = React.useState<Record<string, Check>>({});
  const [renaming, setRenaming] = React.useState<number | "cup" | null>(null);
  const [iconPreview, setIconPreview] = React.useState<Record<number, string>>({});

  const load = React.useCallback(() => {
    setPack(null); setError("");
    loadMod().then((p) => { setPack(p); setA(startOf(p)); }).catch((e) => setError(e.message));
  }, [loadMod]);
  React.useEffect(load, [load]);
  // After a rename in the game text editor the names are read again; the unapplied changes stay.
  const refresh = () => loadMod().then(setPack).catch((e) => toast.error("Could not read the names again", { description: e.message }));

  const names = pack?.names || { track: () => null, author: () => null, cup: () => null };
  const changed = a ? a.cups.filter((_: any, c: number) => cupChanged(a, c)).length + Math.max(0, (pack?.cupCount || 0) - a.cups.length) : 0;
  React.useEffect(() => onChanges(changed), [changed]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <p className="m-0 text-xs text-destructive">Could not read the mod's cups: {error}</p>;
  if (!pack || !a) return <div className="flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="size-4 animate-spin" /> Reading the mod's cups…</div>;

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
  const matches = a.cups.map((_: any, c: number) => c).filter((c: number) => !q || [cupName(a, c, names), ...[0, 1, 2, 3].flatMap((k) => [trackName(a, c * 4 + k, names), trackAuthor(a, c * 4 + k, names)])].some((s) => s.toLowerCase().includes(q)));
  const pages = Math.max(1, Math.ceil(matches.length / PAGE)), currentPage = Math.min(page, pages - 1);
  const shown = matches.slice(currentPage * PAGE, (currentPage + 1) * PAGE);
  const current = Math.min(cup, a.cups.length - 1);
  const checkOf = (i: number) => { const t = a.tracks[i]; return t.file ? checks[t.file.path] : undefined; };
  const blocked = a.tracks.some((t: any, i: number) => (t.from === null && !t.file) || (t.file && (() => { const c = checkOf(i); return !c || "loading" in c || "failed" in c || c.errors.length > 0; })()));

  const useFile = async (i: number, path: string) => {
    const label = path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "").replace(/_/g, " ");
    update((x) => replaceTrack(x, i, path, label));
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
    const before = editor.doc;
    await editor.newTrack();
    if (editor.doc === before && !editor.doc.dirty) return;
    if (!(await dialogs.confirm({ title: "Put the new track in this cup?", description: "Save it as an .szs file now; it is placed in this position and its checks are shown. The generator builds collision, routes and checkpoints: before the game can load it, the track needs course_model.brres and vrcorn_model.brres (File › Export the model and convert it, or Import 3D model, and Tools › Sky). Then use Replace › Track open in the editor again.", confirmLabel: "Save and place" }))) return;
    if (await editor.save(true) && editor.doc.filePath) await useFile(i, editor.doc.filePath);
  };
  const chooseIcon = async (c: number) => {
    const f = await api.openFile([{ name: "Picture", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif"] }], `Icon for ${cupName(a, c, names)}`);
    if (!f?.path) return;
    update((x) => patchCup(x, c, { icon: { path: f.path } }));
    setIconPreview((p) => ({ ...p, [c]: URL.createObjectURL(new Blob([f.data])) }));
  };

  const apply = async () => {
    const lines: string[] = [];
    a.cups.forEach((cupEntry: any, c: number) => {
      if (!cupChanged(a, c)) return;
      if (cupEntry.from === null) lines.push(`New cup ${c + 1}: ${cupName(a, c, names)}`);
      else if (cupEntry.from !== c) lines.push(`Cup ${c + 1}: ${cupName(a, c, names)} (was cup ${cupEntry.from + 1})`);
      for (let k = 0; k < 4; k++) {
        const i = c * 4 + k, t = a.tracks[i];
        if (!trackChanged(a, i) || (cupEntry.from !== null && t.from === cupEntry.from * 4 + k && !t.file && t.name === undefined)) continue;
        lines.push(`${cupName(a, c, names)} ${k + 1}: ${trackName(a, i, names)}${t.file ? ` (from ${t.file.path.split(/[\\/]/).pop()})` : t.from !== null && t.from !== i ? ` (was in cup ${Math.floor(t.from / 4) + 1})` : ""}`);
      }
    });
    if (a.cups.length < pack.cupCount) lines.push(`${pack.cupCount - a.cups.length} cup(s) removed from the end`);
    const choice: any = await dialogs.open("cupsApply", {
      lines, keepBackups: editor.settings.keepBackups, title: "Apply the new cups to the mod?",
      description: `These changes are written into the mod ${pack.title}. Start the game with the mod (its Riivolution option, or the patched game) in Dolphin to see them.`,
      written: pack.written,
    });
    if (!choice) return;
    const done = await editor.withBusy("Preparing the changes…", async () => {
      const progress = (t: string) => { editor.busy = t; editor.bump("ui"); };
      try {
        const { writes, notes } = await pack.build(a, progress);
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
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">{matches.length.toLocaleString()} of {a.cups.length.toLocaleString()} cups <Hint title="Beta" text="Editing and creating the cups of mods is new: keep the backup, and test the mod in Dolphin before sharing it."><Badge variant="outline">Beta</Badge></Hint></span>
          <Button size="sm" variant="secondary" disabled={a.cups.length >= pack.capacity} title={a.cups.length >= pack.capacity ? "The mod has no room for more cups" : undefined} onClick={() => { update((x) => addCup(x, `New cup ${x.cups.length + 1}`)); setCup(a.cups.length); setQuery(""); setPage(Math.floor(a.cups.length / PAGE)); }}><Plus /> New cup</Button>
        </div>
        <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto" aria-label="Pack cups">
          {shown.map((c: number) => (
            <button key={c} type="button" aria-pressed={current === c} onClick={() => { setCup(c); setRenaming(null); }}
              className={cn("flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left text-xs", current === c ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground")}>
              {iconPreview[c] ? <img src={iconPreview[c]} alt="" className="size-6 object-contain" /> : <PackIcon mod={pack} cup={a.cups[c].from ?? c} />}
              <span className="w-9 shrink-0 tabular-nums text-[10.5px] opacity-70">{c + 1}</span>
              <span className="min-w-0 flex-1 truncate">{cupName(a, c, names)}</span>
              {cupChanged(a, c) && <span className="shrink-0 text-[10px] text-foreground">{a.cups[c].from === null ? "new" : "changed"}</span>}
            </button>
          ))}
          {!matches.length && <p className="m-0 p-2 text-xs text-muted-foreground">No cup has this name, track or author.</p>}
        </nav>
        {pages > 1 && (
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <Button size="icon-sm" variant="ghost" aria-label="Previous cups" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft /></Button>
            <span className="tabular-nums">{currentPage + 1} / {pages}</span>
            <Button size="icon-sm" variant="ghost" aria-label="Next cups" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}><ChevronRight /></Button>
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-col gap-3">
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
          <Button size="sm" variant="ghost" onClick={() => void chooseIcon(current)}><ImagePlus /> Change icon…</Button>
          <Hint title="Move cup up" text="Exchange this cup (name, icon and its four tracks) with the cup before it."><span className="inline-flex"><Button size="sm" variant="ghost" disabled={current === 0} onClick={() => { update((x) => swapCups(x, current, current - 1)); setCup(current - 1); }}><ArrowUp /> Cup up</Button></span></Hint>
          <Hint title="Move cup down" text="Exchange this cup with the cup after it."><span className="inline-flex"><Button size="sm" variant="ghost" disabled={current >= a.cups.length - 1} onClick={() => { update((x) => swapCups(x, current, current + 1)); setCup(current + 1); }}><ArrowDown /> Cup down</Button></span></Hint>
          <Hint title="Remove this cup" text="Only the last cup can be removed: removing one in the middle would renumber every track after it. Move a cup to the end first."><span className="inline-flex">
            <Button size="sm" variant="ghost" disabled={current !== a.cups.length - 1 || a.cups.length <= 1} onClick={async () => {
              if (a.cups[current].from !== null && !(await dialogs.confirm({ title: "Remove this cup?", description: `${cupName(a, current, names)} and its four tracks leave the pack when you apply. Its track files stay where they are and a backup is made.`, confirmLabel: "Remove cup", destructive: true }))) return;
              update((x) => removeLastCup(x)); setCup(Math.max(0, current - 1));
            }}><Trash2 /> Remove</Button>
          </span></Hint>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
          {[0, 1, 2, 3].map((k) => {
            const i = current * 4 + k, t = a.tracks[i];
            const slot = t.slot ?? (t.from !== null ? pack.slotOf(t.from) : 0x08);
            const music = t.music ?? (t.from !== null ? pack.musicOf(t.from) : pack.musicOptions.find((m) => m.label === slotById(slot)?.label)?.value ?? pack.musicOptions[0]?.value ?? 0);
            const check = checkOf(i);
            return (
              <div key={i} className={cn("rounded-md border px-3 py-2.5", trackChanged(a, i) && "border-foreground/40")} data-pack-track={i}>
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 w-5 shrink-0 text-center text-[13px] font-semibold tabular-nums text-muted-foreground">{k + 1}</span>
                  <div className="min-w-0 flex-1">
                    {renaming === i ? <NameInput value={trackName(a, i, names)} onDone={(v) => { setRenaming(null); if (v !== null) update((x) => patchTrack(x, i, { name: v })); }} /> : (
                      <div className="flex flex-wrap items-center gap-2">
                        {t.from === null && !t.file ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild><Button size="sm" variant="outline" className="border-dashed" aria-label={`Add a track to position ${k + 1}`}><Plus /> Add a track</Button></DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                              <DropdownMenuItem onSelect={() => void newTrack(i)}><Sparkles /> New custom track (draw it)…</DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => void chooseFile(i)}><FileUp /> Track file (.szs, .wbz…)…</DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => void useOpenTrack(i)} disabled={editor.isEmpty}><Trophy /> Track open in the editor ({editor.doc.fileName})</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : <span className="truncate text-[13.5px] font-medium">{trackName(a, i, names)}</span>}
                        {t.file && <Badge variant="outline">from file</Badge>}
                        {t.from !== null && t.from !== i && <Badge variant="outline">was cup {Math.floor(t.from / 4) + 1}, {t.from % 4 + 1}</Badge>}
                      </div>
                    )}
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                      {trackAuthor(a, i, names) && <span>by {trackAuthor(a, i, names)}</span>}
                      <span title="The archive the game loads for this position">{pack.fileOf(i, t.from)}{t.file ? ` ← ${t.file.path.split(/[\\/]/).pop()}` : ""}</span>
                    </div>
                    <div className="mt-1.5 grid grid-cols-[auto_12rem_auto_12rem] items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground max-xl:grid-cols-[auto_12rem]">
                      <Hint title="Behaves like" text="Original track slot whose game behaviour this track uses (some objects, lighting and the track's ID for the game)."><span className="whitespace-nowrap">Behaves like</span></Hint>
                      <SlotSelect value={slot} onChange={(v) => update((x) => patchTrack(x, i, { slot: v }))} label="Behaves like" />
                      <Hint title="Music" text="Original track whose music plays, unless the pack gives this track its own music."><span className="whitespace-nowrap">Music of</span></Hint>
                      <MusicSelect value={music} options={pack.musicOptions} onChange={(v) => update((x) => patchTrack(x, i, { music: v }))} />
                    </div>
                    {check && <CheckLines check={check} />}
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    {([[-1, ArrowUp, "Move up"], [1, ArrowDown, "Move down"], [-4, ArrowLeft, "Move to the previous cup"], [4, ArrowRight, "Move to the next cup"]] as const).map(([dir, Icon, title]) => (
                      <Hint key={title} title={title} text="The track that is there takes this one's place."><span className="inline-flex"><Button size="icon-sm" variant="ghost" aria-label={title} disabled={i + dir < 0 || i + dir >= a.tracks.length} onClick={() => update((x) => moveTrack(x, i, dir))}><Icon /></Button></span></Hint>
                    ))}
                    <SwapPicker a={a} names={names} self={i} onPick={(j) => update((x) => swapTracks(x, i, j))} />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button size="sm" variant="ghost"><Replace /> Replace</Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => void chooseFile(i)}><FileUp /> Track file (.szs, .wbz…)…</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => void useOpenTrack(i)} disabled={editor.isEmpty}><Trophy /> Track open in the editor ({editor.doc.fileName})</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => void newTrack(i)}><Sparkles /> New track (generator)…</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => void renameTrack(i)}><Pencil /> Rename…</DropdownMenuItem>
                        {pack.hasAuthors && <DropdownMenuItem onSelect={async () => { const v = await dialogs.form({ title: "Author", fields: [{ key: "author", label: "Made by", type: "text", value: trackAuthor(a, i, names) }] }); if (v) update((x) => patchTrack(x, i, { author: String(v.author) })); }}><Pencil /> Author…</DropdownMenuItem>}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Hint title="Undo this position" text="Puts back the track that is there now in the pack."><span className="inline-flex"><Button size="icon-sm" variant="ghost" aria-label="Reset this position" disabled={!trackChanged(a, i) || a.cups[current].from === null} onClick={() => update((x) => patchTrack(x, i, { from: i, file: undefined, name: undefined, author: undefined, slot: undefined, music: undefined }))}><RotateCcw /></Button></span></Hint>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t pt-3">
          <span className="mr-auto text-[11px] text-muted-foreground">Cup creator for mods (beta): only the mod's cups and tracks are changed; its other settings stay as they are. Test the mod in Dolphin before sharing it.</span>
          <span className="text-xs text-muted-foreground">{changed ? `${changed} cup${changed === 1 ? "" : "s"} changed, not applied yet` : "No changes"}</span>
          <Button variant="outline" disabled={!changed} onClick={() => { setA(startOf(pack)); setChecks({}); setIconPreview({}); setCup(Math.min(current, pack.cupCount - 1)); }}><RotateCcw /> Discard</Button>
          <Hint title="Apply changes" text={blocked ? "Every position of a new cup needs a track, and replacement tracks must pass their checks (red messages)." : "Shows a summary, backs up the files and writes the cups into the mod."}>
            <span className="inline-flex"><Button disabled={!changed || blocked} onClick={() => void apply()}>Apply changes…</Button></span>
          </Hint>
        </div>
      </div>
    </div>
  );
}

function MusicSelect({ value, options, onChange }: { value: number; options: { value: number; label: string }[]; onChange: (v: number) => void }) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger aria-label="Music" className="h-6 w-full px-2 text-[11px]"><SelectValue /></SelectTrigger>
      <SelectContent>
        {options.map((m) => <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>)}
        {!options.some((m) => m.value === value) && <SelectItem value={String(value)}>Music {value}</SelectItem>}
      </SelectContent>
    </Select>
  );
}

function SlotSelect({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger aria-label={label} className="h-6 w-full px-2 text-[11px]"><SelectValue /></SelectTrigger>
      <SelectContent>
        {RACE_SLOTS.map((s: any) => <SelectItem key={s.id} value={String(s.id)}>{s.label}</SelectItem>)}
        {!RACE_SLOTS.some((s: any) => s.id === value) && <SelectItem value={String(value)}>{slotById(value)?.label || `Slot ${value}`}</SelectItem>}
      </SelectContent>
    </Select>
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
      <PopoverTrigger asChild><Button size="sm" variant="ghost">Swap with…</Button></PopoverTrigger>
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
