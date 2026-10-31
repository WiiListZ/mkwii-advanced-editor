// Preview videos (THP): the movies of the menus, including the track previews of the cup selection.
// Play a movie, pick one of its parts (each track of a cup, each cup of the cup selection…) or the
// whole picture, and replace it with a picture, a video file or a part of another THP. Save encodes
// every frame again; the file is backed up first, like the cups.

import * as React from "react";
import { CircleHelp, Clapperboard, Download, Film, FolderOpen, History, ImageIcon, LoaderCircle, Pause, Play, RotateCcw, Save, SkipBack, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api } from "../../../js/api.js";
import { CUPS, slotById, slotPlace } from "../../../js/data/cups.js";
import { THP_LAYOUTS, THP_TITLES, parseTHP, thpLayout } from "../../../js/formats/thp.js";
import { editor, winPath } from "../editor";
import { dialogs } from "../dialogs-store";
import { readGameNames } from "../cups";
import { composeFrame, loadVideo, renderMovie, type MovieEdit, type MovieSource, type Rect, type THP } from "../thp-render";
import { BackupsView } from "./CupsDialog";
import { Hint } from "../common";
import { cn } from "@/lib/utils";

const FOLDERS = ["course", "battle", "button", "title", "ending"];
const FOLDER_TITLES: Record<string, string> = { course: "Cup and track selection", battle: "Battle", button: "Menu buttons", title: "Title", ending: "Ending" };
type Part = Rect & { label: string; key: string };

export function ThpDialog({ initialPath, close }: { initialPath?: string; close: (v: any) => void }) {
  const [files, setFiles] = React.useState<{ folder: string; name: string; path: string }[] | null>(null);
  const [path, setPath] = React.useState(initialPath || "");
  const [thp, setThp] = React.useState<THP | null>(null);
  const [error, setError] = React.useState("");
  const [frame, setFrame] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [selected, setSelected] = React.useState("whole");
  const [edits, setEdits] = React.useState<Record<string, MovieEdit>>({});
  const [names, setNames] = React.useState<((id: number) => string | null) | null>(null);
  const [showHelp, setShowHelp] = React.useState(false);
  const [view, setView] = React.useState<"movie" | "backups">("movie");
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const drawing = React.useRef(false);
  const root = editor.workspacePath("thp");
  const editCount = Object.keys(edits).length;

  // Movies of the game folder, by folder.
  React.useEffect(() => {
    if (!root) { setFiles([]); return; }
    Promise.all(FOLDERS.map(async (folder) => (await api.listDir(winPath(root, folder), ["thp"]).catch(() => [])).map((name: string) => ({ folder, name, path: winPath(root, folder, name) }))))
      .then((lists) => {
        // Cup previews in the order of the cups, the selection screens first.
        const rank = (f: { folder: string; name: string }) => { const l = (THP_LAYOUTS as any)[`${f.folder}/${f.name}`]; return l ? (l.cup ?? -1) : 99; };
        const all = lists.flat().sort((a, b) => FOLDERS.indexOf(a.folder) - FOLDERS.indexOf(b.folder) || rank(a) - rank(b) || a.name.localeCompare(b.name));
        setFiles(all); if (!initialPath && all.length) setPath(all.find((f) => f.name === "kinoko.thp")?.path || all[0].path); });
    readGameNames().then((n) => setNames(() => n?.text || null)).catch(() => {});
  }, [root]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (!path) return;
    setThp(null); setError(""); setFrame(0); setPlaying(false); setSelected("whole"); setEdits({});
    api.readPath(path).then((f: any) => setThp(parseTHP(f.data))).catch((e: any) => setError(e.message));
  }, [path]);

  const layout = path ? thpLayout(path) : null;
  const trackName = (slot: number) => names?.(slot >= 0x20 ? 0x24b8 + slot - 0x20 : 0x2454 + slot) || slotById(slot).label;
  const cupName = (cup: number) => names?.(CUPS[cup].nameId) || CUPS[cup].name;
  const parts: Part[] = thp ? [
    { key: "whole", label: "Whole video", x: 0, y: 0, width: thp.video.width, height: thp.video.height },
    ...(layout?.regions || []).map((r: any, i: number) => ({
      key: String(i), x: r.x, y: r.y, width: r.width, height: r.height,
      label: r.slot !== undefined ? `${slotPlace(r.slot).position + 1} · ${trackName(r.slot)}` : cupName(r.cup),
    })),
  ] : [];
  const part = parts.find((p) => p.key === selected) || parts[0];
  const ordered = Object.entries(edits).sort(([a], [b]) => (a === "whole" ? -1 : b === "whole" ? 1 : Number(a) - Number(b))).map(([, e]) => e);

  // Draws the current frame with the changes; skips a frame while the previous one is still drawing.
  const draw = React.useCallback(async (index: number) => {
    if (!thp || !canvas.current || drawing.current) return;
    drawing.current = true;
    try { await composeFrame(canvas.current.getContext("2d")!, thp, index, ordered); }
    catch (e: any) { setError(e.message); setPlaying(false); }
    finally { drawing.current = false; }
  }, [thp, edits]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { void draw(frame); }, [frame, draw]);

  // Playback at the movie's frame rate, looping like the menus do.
  React.useEffect(() => {
    if (!playing || !thp) return;
    let raf = 0;
    const start = performance.now(), first = frame;
    const tick = () => {
      const index = (first + Math.floor(((performance.now() - start) / 1000) * thp.header.fps)) % thp.frames.length;
      setFrame(index);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, thp]); // eslint-disable-line react-hooks/exhaustive-deps

  const setEdit = (source: MovieSource) => {
    if (!part) return;
    setEdits((e) => ({ ...e, [part.key]: { rect: { x: part.x, y: part.y, width: part.width, height: part.height }, source, fit: e[part.key]?.fit || "fill" } }));
  };
  const chooseImage = async () => {
    const f = await api.openFile([{ name: "Picture", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif"] }], `Picture for ${part.label}`);
    if (!f) return;
    try { setEdit({ kind: "image", name: f.name, bitmap: await createImageBitmap(new Blob([f.data])) }); }
    catch { toast.error("This picture cannot be read", { description: "Use PNG, JPEG, WebP, BMP or GIF." }); }
  };
  const chooseVideo = async () => {
    const f = await api.openFile([{ name: "Video", extensions: ["mp4", "webm", "mov", "m4v", "mkv", "ogv"] }], `Video for ${part.label}`);
    if (!f) return;
    try { setEdit(await loadVideo(new Blob([f.data]), f.name)); }
    catch (e: any) { toast.error("This video cannot be read", { description: e.message }); }
  };
  const chooseTHPPart = async (file: { path: string; name: string }, region: Rect & { label: string }) => {
    try {
      const other = file.path.toLowerCase() === path.toLowerCase() && thp ? thp : parseTHP((await api.readPath(file.path)).data);
      setEdit({ kind: "thp", name: `${file.name} › ${region.label}`, thp: other, rect: region });
    } catch (e: any) { toast.error("Could not read the video", { description: e.message }); }
  };
  // Parts other movies offer, for "From another preview".
  const sourceParts = (file: { path: string; name: string; folder: string }) => {
    const l = thpLayout(file.path);
    const regions = (l?.regions || []).map((r: any) => ({ x: r.x, y: r.y, width: r.width, height: r.height, label: r.slot !== undefined ? `${CUPS[slotPlace(r.slot).cup].name} ${slotPlace(r.slot).position + 1} · ${trackName(r.slot)}` : cupName(r.cup) }));
    return regions.length ? regions : null;
  };

  const exportFrame = async () => {
    if (!canvas.current) return;
    const blob: Blob = await new Promise((r) => canvas.current!.toBlob((b) => r(b!), "image/png"));
    await editor.exportBytes(`${path.split(/[\\/]/).pop()!.replace(/\.thp$/i, "")}_frame_${frame}.png`, [{ name: "PNG image", extensions: ["png"] }], new Uint8Array(await blob.arrayBuffer()), "Export frame");
  };

  const save = async () => {
    if (!thp || !editCount) return;
    setPlaying(false);
    const lines = parts.filter((p) => edits[p.key]).map((p) => `${p.label}: ${edits[p.key].source.name}${edits[p.key].fit === "stretch" ? " (stretched)" : ""}`);
    const choice: any = await dialogs.open("cupsApply", {
      lines, keepBackups: editor.settings.keepBackups, title: "Save the preview video?", confirmLabel: "save",
      description: `${path.split(/[\\/]/).pop()} is encoded again, all ${thp.frames.length} frames, with these changes. This takes a few seconds for a cup's previews and longer for long movies.`,
      written: "Every frame is saved as JPEG again (the parts you did not change too, at a quality close to the original). A frame is never larger than the largest frame of the original, because the game reserves memory for that size.",
    });
    if (!choice) return;
    await editor.withBusy("Encoding the video…", async () => {
      try {
        const bytes = await renderMovie(thp, ordered, (done, total) => { editor.busy = `Encoding frame ${done} of ${total}…`; editor.bump("ui"); });
        if (choice.backup) await api.createSnapshot(`Preview video ${path.split(/[\\/]/).pop()}: ${lines.join(" · ")}`, [path], { lines });
        await api.writeFile(path, bytes, { backup: editor.settings.keepBackups, edited: true });
        setThp(parseTHP(bytes)); setEdits({});
        toast.success("Preview video saved", { description: choice.backup ? "A backup was made first: Backups in this window puts it back." : "No backup was made." });
      } catch (e: any) { dialogs.alert({ title: "Could not save the video", description: e.message }); }
    });
  };

  const requestClose = async () => {
    if (editCount && !(await dialogs.confirm({ title: "Close without saving?", description: `${editCount} changed part${editCount === 1 ? "" : "s"} of the video will be lost.`, confirmLabel: "Close without saving", destructive: true }))) return;
    close(null);
  };

  const fileTitle = (f: { folder: string; name: string }) => (THP_LAYOUTS as any)[`${f.folder}/${f.name}`]?.title || (THP_TITLES as any)[`${f.folder}/${f.name}`] || f.name;
  const edit = part && edits[part.key];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <DialogTitle className="flex items-center gap-2 text-sm"><Clapperboard className="size-4" /> Preview videos</DialogTitle>
          <DialogDescription className="m-0 text-xs">The videos of the menus (thp): the track previews of each cup, the cup and arena selection, the menu buttons, the title and the ending.</DialogDescription>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button size="sm" variant={showHelp ? "secondary" : "ghost"} aria-pressed={showHelp} onClick={() => setShowHelp(!showHelp)}><CircleHelp /> How it works</Button>
          <Button size="sm" variant={view === "backups" ? "secondary" : "ghost"} onClick={() => setView(view === "backups" ? "movie" : "backups")}><History /> Backups</Button>
          <Button size="icon-sm" variant="ghost" title="Close" aria-label="Close preview video editor" onClick={requestClose}><X /></Button>
        </div>
      </div>

      {showHelp && (
        <section className="shrink-0 rounded-md border p-3 text-xs leading-relaxed">
          <div className="mb-1.5 flex items-center justify-between"><b className="text-[13px]">How preview videos work</b><Button size="sm" variant="ghost" onClick={() => setShowHelp(false)}>Hide</Button></div>
          <div className="grid gap-x-6 gap-y-1.5 md:grid-cols-2">
            <p className="m-0">The game plays THP movies: JPEG pictures, one per frame (60 per second), sometimes with sound. To save memory, one movie holds several previews at once: <code>course/kinoko.thp</code> has the four tracks of the Mushroom Cup one above the other, and the menu shows only the part of the track you point at. <code>cup_select.thp</code> has one picture per cup, the battle movies one per arena.</p>
            <p className="m-0"><b>Change a part:</b> click it on the video (or in the list), then <b>Picture</b> (a still image), <b>Video file</b> (MP4 or WebM, played from the start and repeated to the movie's length) or <b>From another preview</b> (for example Coconut Mall's preview into Luigi Circuit's place). <b>Fill</b> crops the source to the part's shape; <b>Stretch</b> squeezes all of it in. The player shows the result straight away.</p>
            <p className="m-0"><b>Save</b> encodes every frame again and writes the THP, after a backup (asked when .bak backups are off in Settings). <b>Backups</b> puts the old video back. The movie keeps its size, frame count and sound.</p>
            <p className="m-0"><b>Cups and tracks</b> moves the previews by itself when tracks change places (its option <i>Preview videos follow the tracks</i>). Use this window for a custom track's preview: record a lap in Dolphin, cut a few seconds and use it as a video file.</p>
          </div>
        </section>
      )}

      {!root ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-[13px] text-muted-foreground">
          <p className="m-0 max-w-md">Choose the extracted game's <b>files</b> folder first: the videos are in its <code>thp</code> folder.</p>
          <Button onClick={() => void editor.chooseWorkspace()}>Choose the game folder…</Button>
        </div>
      ) : view === "backups" ? <BackupsView onRestored={() => { const p = path; setPath(""); setTimeout(() => setPath(p), 0); }} /> : (
        <div className="grid min-h-0 flex-1 grid-cols-[210px_minmax(0,1fr)_290px] gap-4">
          <nav className="flex min-h-0 flex-col gap-0.5 overflow-y-auto border-r pr-3" aria-label="Videos">
            {files === null ? <div className="flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" /> Reading…</div>
              : !files.length ? <p className="m-0 text-xs text-muted-foreground">No THP videos in this game folder.</p>
              : FOLDERS.filter((folder) => files.some((f) => f.folder === folder)).map((folder) => (
                <React.Fragment key={folder}>
                  <div className="px-2 pb-1 pt-2 text-[11px] font-medium text-muted-foreground first:pt-0">{FOLDER_TITLES[folder]}</div>
                  {files.filter((f) => f.folder === folder).map((f) => (
                    <button key={f.path} type="button" aria-pressed={path === f.path} title={f.name}
                      onClick={async () => { if (f.path === path) return; if (editCount && !(await dialogs.confirm({ title: "Open another video?", description: "The changes to this video have not been saved.", confirmLabel: "Discard changes", destructive: true }))) return; setPath(f.path); }}
                      className={cn("cursor-pointer rounded-md px-2 py-1.5 text-left text-xs", path === f.path ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground")}>
                      <span className="block truncate">{fileTitle(f)}</span>
                      <span className="block truncate text-[10.5px] opacity-70">{f.name}</span>
                    </button>
                  ))}
                </React.Fragment>
              ))}
          </nav>

          <div className="flex min-h-0 min-w-0 flex-col gap-2">
            {error ? <p className="m-0 text-xs text-destructive">{error}</p> : !thp ? <div className="flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="size-4 animate-spin" /> Reading the video…</div> : (
              <>
                <div className="relative flex min-h-0 flex-1 items-center justify-center rounded-md border bg-black/40 p-2">
                  <div className="relative max-h-full max-w-full" style={{ aspectRatio: `${thp.video.width} / ${thp.video.height}`, height: "100%" }}>
                    <canvas ref={canvas} width={thp.video.width} height={thp.video.height} className="block size-full" data-testid="thp-canvas" />
                    {parts.filter((p) => p.key !== "whole").map((p) => (
                      <button key={p.key} type="button" onClick={() => setSelected(p.key)} title={p.label}
                        className={cn("absolute cursor-pointer border text-left", selected === p.key ? "border-2 border-yellow-400" : "border-white/30 hover:border-white/80")}
                        style={{ left: `${(p.x / thp.video.width) * 100}%`, top: `${(p.y / thp.video.height) * 100}%`, width: `${(p.width / thp.video.width) * 100}%`, height: `${(p.height / thp.video.height) * 100}%` }}>
                        <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[10.5px] text-white">{p.label}{edits[p.key] ? " · changed" : ""}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button size="icon-sm" variant="ghost" aria-label="First frame" onClick={() => { setPlaying(false); setFrame(0); }}><SkipBack /></Button>
                  <Button size="sm" onClick={() => setPlaying(!playing)}>{playing ? <Pause /> : <Play />} {playing ? "Pause" : "Play"}</Button>
                  <input type="range" min={0} max={thp.frames.length - 1} value={frame} onChange={(e) => { setPlaying(false); setFrame(Number(e.target.value)); }} className="min-w-0 flex-1 accent-primary" aria-label="Frame" />
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{frame + 1} / {thp.frames.length} · {(frame / thp.header.fps).toFixed(2)} s</span>
                </div>
                <div className="shrink-0 text-[11px] text-muted-foreground">{thp.video.width}×{thp.video.height} · {thp.header.fps.toFixed(2)} frames per second · {(thp.frames.length / thp.header.fps).toFixed(1)} s{thp.audio ? ` · sound ${thp.audio.channels === 2 ? "stereo" : "mono"} ${thp.audio.frequency} Hz (kept as it is)` : " · no sound"}{layout ? ` · ${layout.regions.length} previews in one video` : ""}</div>
              </>
            )}
          </div>

          <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto">
            {thp && part && <>
              <div>
                <div className="mb-1 text-[11px] font-medium text-muted-foreground">Part of the video</div>
                <div className="flex flex-col gap-0.5">
                  {parts.map((p) => (
                    <button key={p.key} type="button" aria-pressed={selected === p.key} onClick={() => setSelected(p.key)}
                      className={cn("flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs", selected === p.key ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground")}>
                      <span className="min-w-0 flex-1 truncate">{p.label}</span>
                      {edits[p.key] && <span className="shrink-0 text-[10px] text-foreground">changed</span>}
                    </button>
                  ))}
                </div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-[13px] font-medium">{part.label}</div>
                <div className="mb-2 text-[11px] text-muted-foreground">{part.width}×{part.height} pixels{edit ? ` · now shows ${edit.source.name}` : " · original"}</div>
                <div className="flex flex-col gap-1.5">
                  <Button size="sm" variant="secondary" onClick={() => void chooseImage()}><ImageIcon /> Picture…</Button>
                  <Button size="sm" variant="secondary" onClick={() => void chooseVideo()}><Film /> Video file…</Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button size="sm" variant="secondary"><Clapperboard /> From another preview…</Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="max-h-[60vh] w-72 overflow-y-auto">
                      {(files || []).filter((f) => sourceParts(f)).map((f) => (
                        <React.Fragment key={f.path}>
                          <DropdownMenuLabel className="text-[11px] text-muted-foreground">{fileTitle(f)}</DropdownMenuLabel>
                          {sourceParts(f)!.map((r: any) => <DropdownMenuItem key={r.label} onSelect={() => void chooseTHPPart(f, r)}>{r.label}</DropdownMenuItem>)}
                        </React.Fragment>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                {edit && (
                  <div className="mt-3 flex flex-col gap-1.5 border-t pt-3">
                    <div className="flex gap-1" role="radiogroup" aria-label="Fit">
                      {(["fill", "stretch"] as const).map((fit) => (
                        <Hint key={fit} title={fit === "fill" ? "Fill" : "Stretch"} text={fit === "fill" ? "Crop the source to the shape of this part, keeping its proportions." : "Squeeze the whole source into this part."}>
                          <Button size="sm" variant={edit.fit === fit ? "secondary" : "ghost"} aria-pressed={edit.fit === fit} onClick={() => setEdits((e) => ({ ...e, [part.key]: { ...e[part.key], fit } }))}>{fit === "fill" ? "Fill" : "Stretch"}</Button>
                        </Hint>
                      ))}
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => setEdits((e) => { const next = { ...e }; delete next[part.key]; return next; })}><RotateCcw /> Back to the original</Button>
                  </div>
                )}
              </div>
              <Button size="sm" variant="ghost" onClick={() => void exportFrame()}><Download /> Save this frame as PNG…</Button>
            </>}
          </aside>
        </div>
      )}

      {root && view === "movie" && (
        <div className="flex shrink-0 items-center justify-end gap-2 border-t pt-3">
          <Button size="sm" variant="ghost" className="mr-auto" onClick={async () => { const f = await api.choosePath([{ name: "THP video", extensions: ["thp"] }], "Open a THP video"); if (f) setPath(f); }}><FolderOpen /> Open another THP…</Button>
          <span className="text-xs text-muted-foreground">{editCount ? `${editCount} changed part${editCount === 1 ? "" : "s"} not saved` : "No changes"}</span>
          <Button variant="outline" disabled={!editCount} onClick={() => setEdits({})}><RotateCcw /> Discard</Button>
          <Button disabled={!editCount || !thp} onClick={() => void save()}><Save /> Save video…</Button>
        </div>
      )}
    </div>
  );
}
