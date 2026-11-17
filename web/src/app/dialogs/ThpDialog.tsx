// Preview videos (THP): the movies of the menus, including the track previews of the cup selection.
// Play a movie, pick one of its parts (each track of a cup, each cup of the cup selection…) or the
// whole picture, and replace it with a picture, a video file or a part of another THP. Save encodes
// every frame again; the file is backed up first, like the cups.

import * as React from "react";
import { CircleHelp, Clapperboard, Download, Film, FolderOpen, History, ImageIcon, LoaderCircle, Pause, Play, RotateCcw, Save, SkipBack, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api } from "../../../js/api.js";
import { CUPS, slotById, slotPlace } from "../../../js/data/cups.js";
import { THP_LAYOUTS, THP_TITLES, parseTHP, thpLayout } from "../../../js/formats/thp.js";
import { COURSE_VIDEO, CUSTOM_VIDEO_SECONDS } from "../thp-render";
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

// partLabels: names of the parts of a video outside the game's (a custom cup's tracks); packTitles:
// titles of the videos in the same folder as it (a mod's custom cups: file name -> title).
export function ThpDialog({ initialPath, initialPart, partLabels, packTitles, close }: { initialPath?: string; initialPart?: string; partLabels?: string[]; packTitles?: Record<string, string>; close: (v: any) => void }) {
  const [files, setFiles] = React.useState<{ folder: string; name: string; path: string }[] | null>(null);
  const [path, setPath] = React.useState(initialPath || "");
  const [thp, setThp] = React.useState<THP | null>(null);
  const [error, setError] = React.useState("");
  const [frame, setFrame] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  // A custom cup's video: the length chosen for it (seconds), or null for the usual 6 s.
  const [chosenLength, setChosenLength] = React.useState<number | null>(null);
  const [selected, setSelected] = React.useState("whole");
  const [edits, setEdits] = React.useState<Record<string, MovieEdit>>({});
  const [names, setNames] = React.useState<((id: number) => string | null) | null>(null);
  const [showHelp, setShowHelp] = React.useState(false);
  const [view, setView] = React.useState<"movie" | "backups">("movie");
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const drawing = React.useRef(false);
  const root = editor.workspacePath("thp");
  const editCount = Object.keys(edits).length;

  // A video opened from outside the game folder (a mod's custom cup): the videos of its folder,
  // listed above the game's.
  const [packFiles, setPackFiles] = React.useState<{ name: string; path: string }[]>([]);
  React.useEffect(() => {
    if (!initialPath || (root && initialPath.toLowerCase().startsWith(root.toLowerCase()))) { setPackFiles([]); return; }
    const folder = initialPath.replace(/[\\/][^\\/]+$/, "");
    api.listDir(folder, ["thp"]).catch(() => [])
      .then((names: string[]) => setPackFiles((names.length ? names : [initialPath.split(/[\\/]/).pop()!]).map((name) => ({ name, path: winPath(folder, name) }))));
  }, [initialPath, root]); // eslint-disable-line react-hooks/exhaustive-deps
  // The open video is always in view in the list.
  const list = React.useRef<HTMLElement>(null);
  React.useEffect(() => {
    list.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({ block: "nearest" });
  }, [path, files, packFiles]);

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
    setThp(null); setError(""); setFrame(0); setPlaying(false); setSelected(path === initialPath ? initialPart ?? "whole" : "whole"); setEdits({}); setChosenLength(null);
    api.readPath(path).then((f: any) => setThp(parseTHP(f.data))).catch((e: any) => setError(e.message));
  }, [path]);

  const layout = path ? thpLayout(path) : null;
  // A custom cup's video of a mod (made by this editor): its length follows its parts, within the
  // game's limits for the videos of a cup's tracks.
  const custom = !!layout?.key?.startsWith("course/pulsar_");
  const trackName = (slot: number) => names?.(slot >= 0x20 ? 0x24b8 + slot - 0x20 : 0x2454 + slot) || slotById(slot).label;
  const cupName = (cup: number) => names?.(CUPS[cup].nameId) || CUPS[cup].name;
  const parts: Part[] = thp ? [
    { key: "whole", label: "Whole video", x: 0, y: 0, width: thp.video.width, height: thp.video.height },
    ...(layout?.regions || []).map((r: any, i: number) => ({
      key: String(i), x: r.x, y: r.y, width: r.width, height: r.height,
      label: r.slot !== undefined ? `${slotPlace(r.slot).position + 1} · ${trackName(r.slot)}` : r.label ? (path === initialPath && partLabels?.[i] ? `${i + 1} · ${partLabels[i]}` : r.label) : cupName(r.cup),
    })),
  ] : [];
  const part = parts.find((p) => p.key === selected) || parts[0];
  const ordered = Object.entries(edits).sort(([a], [b]) => (a === "whole" ? -1 : b === "whole" ? 1 : Number(a) - Number(b))).map(([, e]) => e);
  const customLength = (() => {
    if (!custom || !thp) return thp?.frames.length || 0;
    const fps = thp.header.fps;
    return Math.max(60, Math.min(COURSE_VIDEO.frames, Math.round((chosenLength ?? CUSTOM_VIDEO_SECONDS) * fps)));
  })();
  // The length played here: the one the video will be saved with.
  const movieLength = custom ? customLength : thp?.frames.length || 0;
  const lengthChanged = !!thp && custom && movieLength !== thp.frames.length;
  // The longest part a video file may play: the movie's length (a custom cup's: the game's 8 s).
  const clipMost = thp ? Math.floor(((custom ? COURSE_VIDEO.frames : thp.frames.length) / thp.header.fps) * 10) / 10 : 0;

  // Draws the current frame with the changes; skips a frame while the previous one is still drawing.
  // The frame is put together off screen and shown whole: drawn straight on the canvas, the saved
  // video (with the part's earlier picture) showed while the new video was still seeking. A frame
  // asked for while one is being drawn is drawn after it, with the changes as they are then.
  const pending = React.useRef<number | null>(null);
  const draw = React.useCallback(async (index: number) => {
    if (!thp || !canvas.current) return;
    if (drawing.current) { pending.current = index; return; }
    drawing.current = true;
    try {
      const off = new OffscreenCanvas(thp.video.width, thp.video.height);
      await composeFrame(off.getContext("2d")!, thp, index, ordered);
      canvas.current?.getContext("2d")!.drawImage(off, 0, 0);
    } catch (e: any) { setError(e.message); setPlaying(false); }
    finally {
      drawing.current = false;
      if (pending.current !== null) { const next = pending.current; pending.current = null; void drawRef.current(next); }
    }
  }, [thp, edits]); // eslint-disable-line react-hooks/exhaustive-deps
  // The redraw after a busy one uses the newest draw (the changes may have changed meanwhile).
  const drawRef = React.useRef(draw);
  drawRef.current = draw;
  React.useEffect(() => { void draw(frame); }, [frame, draw]);

  // Playback at the movie's frame rate, looping like the menus do.
  React.useEffect(() => {
    if (!playing || !thp) return;
    let raf = 0;
    const start = performance.now(), first = frame;
    const tick = () => {
      const index = (first + Math.floor(((performance.now() - start) / 1000) * thp.header.fps)) % Math.max(1, movieLength);
      setFrame(index);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, thp, movieLength]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { if (frame >= movieLength && movieLength) setFrame(0); }, [movieLength]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (!f || !thp) return;
    let source: any;
    try { source = await loadVideo(new Blob([f.data]), f.name); }
    catch (e: any) { toast.error("This video cannot be read", { description: e.message }); return; }
    // The part of the video to play: at most as long as the movie (a custom cup's: the game's 8 s).
    const fps = thp.header.fps, duration = source.video.duration || 0;
    const most = clipMost;
    const s = (n: number) => Math.round(n * 100) / 100;
    const options: any = await dialogs.form({
      title: `Video for ${part.label}`,
      description: `${f.name} lasts ${s(duration)} s. Choose the part that plays in ${part.label}: at most ${s(most)} s${custom ? " (the game's videos of a cup's tracks last 8 s; the cup's video takes the length of its longest clip)" : ` (the length of this video)`}. It plays again from its start when it ends.`,
      fields: [
        { key: "start", label: "Start (seconds)", type: "number", value: 0, min: 0, max: Math.max(0, s(duration - 0.1)), step: 0.1 },
        { key: "end", label: "End (seconds)", type: "number", value: s(Math.min(duration, most)), min: 0.1, max: s(duration), step: 0.1, hint: `At most ${s(most)} s after the start.` },
      ],
      confirmLabel: "Use this part",
    });
    if (!options) return;
    const start = Math.max(0, Math.min(Number(options.start) || 0, duration - 0.1));
    let end = Math.max(start + 0.1, Math.min(Number(options.end) || duration, duration));
    if (end - start > most + 1e-6) { end = start + most; toast.info(`The part is ${s(most)} s long at most: it ends at ${s(end)} s.`); }
    setEdit({ ...source, start, end, name: `${f.name} (${s(start)}–${s(end)} s)` });
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
    const regions = (l?.regions || []).map((r: any) => ({ x: r.x, y: r.y, width: r.width, height: r.height, label: r.slot !== undefined ? `${CUPS[slotPlace(r.slot).cup].name} ${slotPlace(r.slot).position + 1} · ${trackName(r.slot)}` : r.label || cupName(r.cup) }));
    return regions.length ? regions : null;
  };

  const exportFrame = async () => {
    if (!canvas.current) return;
    const blob: Blob = await new Promise((r) => canvas.current!.toBlob((b) => r(b!), "image/png"));
    await editor.exportBytes(`${path.split(/[\\/]/).pop()!.replace(/\.thp$/i, "")}_frame_${frame}.png`, [{ name: "PNG image", extensions: ["png"] }], new Uint8Array(await blob.arrayBuffer()), "Export frame");
  };

  const save = async () => {
    if (!thp || (!editCount && !lengthChanged)) return;
    setPlaying(false);
    const lines = parts.filter((p) => edits[p.key]).map((p) => `${p.label}: ${edits[p.key].source.name}${edits[p.key].fit === "stretch" ? " (stretched)" : ""}`);
    if (lengthChanged) lines.push(`Length: ${(movieLength / thp.header.fps).toFixed(2)} s (${movieLength} frames; it was ${(thp.frames.length / thp.header.fps).toFixed(2)} s)`);
    const choice: any = await dialogs.open("cupsApply", {
      lines, title: "Save the preview video?", confirmLabel: "save",
      description: `${path.split(/[\\/]/).pop()} is encoded again, all ${custom ? customLength : thp.frames.length} frames${custom && customLength !== thp.frames.length ? ` (${Math.round((customLength / thp.header.fps) * 100) / 100} s)` : ""}, with these changes. This takes a few seconds for a cup's previews and longer for long movies.`,
      written: "Every frame is saved as JPEG again (the parts you did not change too, at a quality close to the original). A frame is never larger than the largest frame of the original, because the game reserves memory for that size.",
    });
    if (!choice) return;
    await editor.withBusy("Encoding the video…", async () => {
      try {
        const bytes = await renderMovie(thp, ordered, (done, total) => { editor.busy = `Encoding frame ${done} of ${total}…`; editor.bump("ui"); }, custom ? { frames: customLength, frameBytes: COURSE_VIDEO.frameBytes } : {});
        if (choice.backup) await api.createSnapshot(`Preview video ${path.split(/[\\/]/).pop()}: ${lines.join(" · ")}`, [path], { lines });
        await api.writeFile(path, bytes, { backup: choice.backup && editor.settings.keepBackups, edited: true });
        setThp(parseTHP(bytes)); setEdits({}); setChosenLength(null);
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
            <p className="m-0"><b>Save</b> encodes every frame again and writes the THP. Its confirmation always lets you choose whether to make a backup first. <b>Backups</b> puts the old video back when a backup was made. The movie keeps its size, frame count and sound.</p>
            <p className="m-0"><b>Cups and tracks</b> moves the previews by itself when tracks change places (its option <i>Preview videos follow the tracks</i>). Use this window for a custom track's preview: record a lap in Dolphin, cut a few seconds and use it as a video file.</p>
          </div>
        </section>
      )}

      {!root ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-[13px] text-muted-foreground">
          <p className="m-0 max-w-md">Choose the extracted game's <b>files</b> folder first: the videos are in its <code>thp</code> folder.</p>
          <Button onClick={() => void editor.chooseWorkspace()}>Choose the game folder…</Button>
        </div>
      ) : view === "backups" ? <BackupsView onClose={() => setView("movie")} onRestored={() => { const p = path; setPath(""); setTimeout(() => setPath(p), 0); }} /> : (
        <div className="grid min-h-0 flex-1 grid-cols-[210px_minmax(0,1fr)_290px] gap-4">
          <nav ref={list} className="flex min-h-0 flex-col gap-0.5 overflow-y-auto border-r pr-3" aria-label="Videos">
            {packFiles.length > 0 && <>
              <div className="px-2 pb-1 text-[11px] font-medium text-muted-foreground">This mod's custom cups</div>
              {packFiles.map((f) => (
                <button key={f.path} type="button" aria-pressed={path.toLowerCase() === f.path.toLowerCase()} title={f.path}
                  onClick={async () => { if (f.path === path) return; if (editCount && !(await dialogs.confirm({ title: "Open another video?", description: "The changes to this video have not been saved.", confirmLabel: "Discard changes", destructive: true }))) return; setPath(f.path); }}
                  className={cn("cursor-pointer rounded-md px-2 py-1.5 text-left text-xs", path.toLowerCase() === f.path.toLowerCase() ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground")}>
                  <span className="block truncate">{packTitles?.[f.name] || "Custom cup tracks"}</span>
                  <span className="block truncate text-[10.5px] opacity-70">{f.name}</span>
                </button>
              ))}
              <div className="pt-2" />
            </>}
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
                  <input type="range" min={0} max={Math.max(0, movieLength - 1)} value={frame} onChange={(e) => { setPlaying(false); setFrame(Number(e.target.value)); }} className="min-w-0 flex-1 accent-primary" aria-label="Frame" />
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{frame + 1} / {movieLength} · {(frame / thp.header.fps).toFixed(2)} s</span>
                </div>
                {custom && (
                  <div className="flex shrink-0 flex-col gap-1 text-[11px] text-muted-foreground" data-length>
                    <div className="flex items-center gap-2">
                      <span>Length of the preview</span>
                      <Input type="number" step={0.5} min={1} max={8} value={chosenLength ?? CUSTOM_VIDEO_SECONDS} aria-label="Length of the preview (seconds)"
                        onKeyDown={(e) => e.stopPropagation()} onChange={(e) => { const v = Number(e.target.value); if (v > 0) setChosenLength(Math.max(1, Math.min(8, v))); }} className="h-7 w-16 text-xs" />
                      <span>seconds</span>
                      {chosenLength !== null && chosenLength !== CUSTOM_VIDEO_SECONDS && <Button size="sm" variant="ghost" className="h-7" onClick={() => setChosenLength(null)}><RotateCcw /> {CUSTOM_VIDEO_SECONDS} s</Button>}
                    </div>
                    <span>From 1 to 8 s ({CUSTOM_VIDEO_SECONDS} s unless you choose; the game's videos of a cup's tracks last 8 s). Parts shorter than this start again; longer ones are cut.</span>
                  </div>
                )}
                <div className="shrink-0 text-[11px] text-muted-foreground">{thp.video.width}×{thp.video.height} · {thp.header.fps.toFixed(2)} frames per second · {(movieLength / thp.header.fps).toFixed(1)} s{movieLength !== thp.frames.length ? ` (${(thp.frames.length / thp.header.fps).toFixed(1)} s now)` : ""}{thp.audio ? ` · sound ${thp.audio.channels === 2 ? "stereo" : "mono"} ${thp.audio.frequency} Hz (kept as it is)` : " · no sound"}{layout ? ` · ${layout.regions.length} previews in one video` : ""}</div>
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
                    {edit.source.kind === "video" && (() => {
                      const src: any = edit.source, duration = src.video.duration || 0, round = (n: number) => Math.round(n * 100) / 100;
                      const start = src.start ?? 0, end = src.end ?? duration;
                      const change = (key: "start" | "end", value: number) => {
                        let a = key === "start" ? value : start, b = key === "end" ? value : end;
                        a = Math.max(0, Math.min(a, duration - 0.1));
                        b = Math.max(a + 0.1, Math.min(b, duration));
                        if (b - a > clipMost) { if (key === "start") b = a + clipMost; else a = b - clipMost; }
                        const name = `${src.name.replace(/ \([\d.]+–[\d.]+ s\)$/, "")} (${round(a)}–${round(b)} s)`;
                        setEdits((e) => ({ ...e, [part.key]: { ...e[part.key], source: { ...src, start: round(a), end: round(b), name } } }));
                      };
                      return (
                        <div className="flex flex-col gap-1.5" data-clip>
                          <div className="text-[11px] text-muted-foreground">Part of the video file that plays ({round(duration)} s long; at most {round(clipMost)} s{custom ? ", as the game's videos of a cup's tracks" : ""}):</div>
                          <div className="grid grid-cols-2 gap-2">
                            <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">Start (s)
                              <Input type="number" step={0.1} min={0} max={round(duration)} value={round(start)} aria-label="Start of the part" onKeyDown={(e) => e.stopPropagation()} onChange={(e) => change("start", Number(e.target.value) || 0)} className="h-7 text-xs" />
                            </label>
                            <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">End (s)
                              <Input type="number" step={0.1} min={0.1} max={round(duration)} value={round(end)} aria-label="End of the part" onKeyDown={(e) => e.stopPropagation()} onChange={(e) => change("end", Number(e.target.value) || 0)} className="h-7 text-xs" />
                            </label>
                          </div>
                          <div className="text-[11px] text-muted-foreground">{round(end - start)} s, then again from its start.</div>
                        </div>
                      );
                    })()}
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
          <Button disabled={(!editCount && !lengthChanged) || !thp} onClick={() => void save()}><Save /> Save video…</Button>
        </div>
      )}
    </div>
  );
}
