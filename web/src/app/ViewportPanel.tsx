import * as React from "react";
import { ArrowRight, AudioLines, Box, ChevronLeft, ChevronRight, CircleHelp, FilePlus2, Flame, FolderOpen, History, Languages, Mouse, PackagePlus, Pause, Play, Search, Settings, SlidersHorizontal, Sparkles, Video, X } from "lucide-react";
import { WorkspaceCard } from "./panels/WorkspaceCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { KIND_HELP } from "../../js/data/help.js";
import { CAMERA_TYPES, trackLabel } from "../../js/data/defs.js";
import { Input } from "@/components/ui/input";
import { useEditor } from "./hooks";
import { editor, hasBackend, PATH_KINDS } from "./editor";
import { contextActions } from "./context-actions";
import { Map2DPanel } from "./Map2DPanel";

export function ViewportPanel() {
  const host = React.useRef<HTMLDivElement>(null);
  const ed = useEditor("doc", "ui", "selection", "settings");
  const view2D = ed.map2D;

  React.useEffect(() => {
    if (host.current) editor.attachViewport(host.current);
  }, []);

  // Drop overlay. WebView2 does not always send dragleave (drag cancelled with Esc, released
  // outside the window), so it also hides when dragover events stop coming.
  const [dropping, setDropping] = React.useState(false);
  const dropTimer = React.useRef<number>(0);
  const keepDropping = () => {
    setDropping(true);
    clearTimeout(dropTimer.current);
    dropTimer.current = window.setTimeout(() => setDropping(false), 700);
  };
  React.useEffect(() => {
    const stop = () => { clearTimeout(dropTimer.current); setDropping(false); };
    window.addEventListener("drop", stop);
    window.addEventListener("dragend", stop);
    window.addEventListener("blur", stop);
    return () => { stop(); window.removeEventListener("drop", stop); window.removeEventListener("dragend", stop); window.removeEventListener("blur", stop); };
  }, []);

  return (
    <div
      className="relative size-full overflow-hidden bg-[#1c1c1e]"
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); keepDropping(); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) { clearTimeout(dropTimer.current); setDropping(false); } }}
      onDrop={async (e) => {
        clearTimeout(dropTimer.current);
        setDropping(false);
        const list = [...(e.dataTransfer.files || [])];
        if (!list.length) return;
        e.preventDefault();
        const point = editor.viewport?.pickGround(e)?.point ?? null;
        const files = await Promise.all(list.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
        await editor.loadFiles(files, point);
      }}
    >
      <div ref={host} className={`absolute inset-0 [&>canvas]:block [&>canvas]:size-full [&>canvas]:outline-none ${view2D ? "invisible" : ""}`} />
      {!ed.homeVisible && !view2D && <CameraInsetFrame />}
      {!ed.homeVisible && !view2D && <IntroPlayer />}
      {(ed.homeVisible || ed.isEmpty) && <Welcome />}
      {!ed.homeVisible && !ed.isEmpty && view2D && <Map2DPanel />}
      {!ed.homeVisible && !view2D && <div className="pointer-events-none absolute bottom-2 left-3 flex items-center gap-1.5 text-[11px] text-white/50 [text-shadow:0_1px_3px_#000]">
        <Mouse className="size-3.5" /> Right-drag: free look · Middle-drag: pan · Wheel: zoom · Click view + WASD/QE: fly
      </div>}
      {dropping && (
        <div className="pointer-events-none absolute inset-3 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-white/50 bg-black/45 px-8">
          <div className="max-w-md text-center">
            <div className="text-base font-semibold text-white">Drop files to open or add them</div>
            <p className="mt-1.5 text-xs leading-relaxed text-white/70">A track (.szs), loose track files (course_model.brres, course.kcl, course.kmp…) or 3D models to add to the track (.fbx .glb .gltf .dae .obj .stl .ply).</p>
          </div>
        </div>
      )}
      <ViewportContextMenu />
    </div>
  );
}

export function viewHintText(ed: typeof editor) {
  if (ed.intro) return "";
  if (ed.map2D) return ed.tool?.type === "place"
    ? (ed.settings.map2DAddSeveral ? "Click the 2D map to place · keep clicking to add more · Select or Esc to finish" : "Click the 2D map to place one · Esc to cancel")
    : "2D map: click a point to select · drag to move · white handle or Q / E to rotate · Ctrl+C / V / D · wheel to zoom";
  const t = ed.tool;
  let text = "";
  if (t?.type === "place") {
    text = PATH_KINDS.includes(t.kind)
      ? `Click on the track to add ${(KIND_HELP as any)[t.kind]?.title.toLowerCase() || "points"} one after another · Esc when finished`
      : "Click on the track to place it · Shift+click to place several · Esc to cancel";
  } else if (t?.type === "paint") text = "Click or drag on the surface to paint the chosen collision type · Esc to stop";
  else if (t?.type === "collision-create") text = `${ed.collisionDraft.length} of 3 collision points placed · click the track to add the next point · Esc to cancel`;
  else if (t?.type === "geometry") text = t.target === "collision"
    ? "Click collision triangles · Shift+click or Shift+drag to select several · drag an arrow to move · Esc to stop"
    : "Click a model part, then drag an arrow to move it · Esc to stop";
  else if (ed.geometrySelection?.type === "model") text = `${ed.geometrySelection.name} selected · drag an arrow to move · Ctrl+S to save`;
  else if (ed.doc.selection.size) {
    const kh = ed.doc.primary && (KIND_HELP as any)[ed.doc.primary.kind];
    text = `${kh ? kh.title + " selected" : "Selected"} · drag the arrows to move · W / E / R = move / rotate / scale · G = ground · Del = delete`;
  } else if (!ed.isEmpty) text = "Click something to select it · right-drag to look around · wheel to zoom · Add places new elements";
  if (ed.hint) text = ed.hint;
  return text;
}

function Welcome() {
  const ed = useEditor("settings", "doc", "ui");
  const recent = ed.settings.recent || [];
  return (
    // m-auto (not items-center) keeps the top reachable when the content is taller than the view.
    <div className="absolute inset-0 z-10 flex overflow-y-auto bg-background p-6">
      <div className="m-auto flex w-full max-w-[680px] flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <img src="icon.png" className="size-16 drop-shadow-[0_8px_24px_rgba(255,255,255,0.12)]" alt="" />
          <h1 className="m-0 text-2xl font-semibold tracking-tight">MKWii Advanced Editor</h1>
          <p className="m-0 max-w-md text-[13px] text-muted-foreground">Edit Mario Kart Wii tracks visually: objects, routes, checkpoints, cameras, areas and collision — with the game's real models.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" aria-label="Settings" onClick={() => ed.cmd("settingsDialog")}><Settings /> Settings</Button>
          <Button variant="ghost" size="sm" onClick={() => ed.cmd("help")}><CircleHelp /> Help</Button>
        </div>
        <WorkspaceCard />
        {!ed.isEmpty && (
          <div className="flex w-full flex-wrap items-center gap-2 border-y py-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium">{ed.doc.fileName}</div>
              <div className="text-[11px] text-muted-foreground">{ed.doc.dirty ? "Unsaved changes" : "Current track"}</div>
            </div>
            <Button size="sm" onClick={() => ed.cmd("editor")}><ArrowRight /> Continue editing</Button>
            <Button size="icon" variant="ghost" title="Close track" aria-label="Close track" onClick={() => ed.cmd("closeTrack")}><X /></Button>
          </div>
        )}
        {ed.trackFiles?.files.length ? <WelcomeTracks /> : null}
        <div className="grid w-full gap-2">
          <WelcomeAction icon={FolderOpen} title="Open a track" text="A .szs from Race/Course, or a single .kmp / .kcl" primary onClick={() => ed.cmd("open")} />
          <WelcomeAction icon={Sparkles} title="Create a new track" text="Draw the layout from above — road, walls, routes and checkpoints are built for you" onClick={() => ed.cmd("newTrack")} />
          <WelcomeAction icon={FilePlus2} title="Empty project" text="Start from scratch and import your own collision" onClick={() => ed.cmd("newEmpty")} />
          <WelcomeAction icon={Languages} title="Edit game text" text="Edit menu and race messages with a preview of where they appear in the game" onClick={() => ed.cmd("gameText")} />
          <WelcomeAction icon={AudioLines} title="Sounds and music" text="Listen to the game's music and sound effects and replace them with your own" onClick={() => ed.cmd("audio")} />
          <WelcomeAction icon={Box} title="Characters and models" text="Edit game characters, object models, textures and animations" onClick={() => ed.cmd("assets")} />
          {ed.workspace() && <WelcomeAction icon={Flame} title="Effects" text="Edit the particle effects (smoke, fire, sparks…) of every track and archive in the game folder" onClick={() => ed.cmd("workspaceEffects")} />}
          {ed.workspaceInfo?.common && <WelcomeAction icon={SlidersHorizontal} title="Vehicle stats and item chances" text="Edit kartParam.bin, driverParam.bin and ItemSlot.bin from Race/Common.szs, with an explanation of every value" onClick={() => ed.cmd("gameParams")} />}
          <WelcomeAction icon={PackagePlus} title="Riivolution mod" text="Turn your edited files into a mod folder for Riivolution or Dolphin, or edit a Riivolution XML" onClick={() => ed.cmd("riivolution")} />
        </div>
        {recent.length > 0 && (
          <Card className="w-full">
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><History className="size-3.5" /> Recent files</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-0.5 px-2 pb-2">
              {recent.map((p) => (
                <button key={p} onClick={() => ed.openPath(p)} className="flex cursor-pointer flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-accent">
                  <span className="text-[13px] font-medium">{p.split(/[\\/]/).pop()}</span>
                  <span className="w-full truncate text-[11px] text-muted-foreground">{p}</span>
                </button>
              ))}
            </CardContent>
          </Card>
        )}
        {!hasBackend && (
          <CardDescription className="text-center">Running in a plain browser: files are opened from disk and saved as downloads. Start the desktop app for direct saving.</CardDescription>
        )}
        <p className="m-0 text-xs text-muted-foreground">Tip: you can also drop a file onto this window.</p>
      </div>
    </div>
  );
}

// Frame and caption around the selected camera's preview, drawn by the viewport in this corner
// (same size as Viewport.insetRect: 30% of the width, at most 420 px, 16:9, 12 px from the edges).
function CameraInsetFrame() {
  const ed = useEditor("selection", "intro", "settings", "doc");
  const index = ed.selectedCamera();
  if (ed.intro || index < 0 || !ed.settings.cameraPreview) return null;
  const cam = ed.doc.kmp.CAME[index];
  return (
    <div className="pointer-events-none absolute bottom-3 right-3 z-10 w-[min(30%,420px)]">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] text-white/80 [text-shadow:0_1px_2px_#000]">
        <Video className="size-3.5" /> Camera {index} · {CAMERA_TYPES[cam?.type] ?? cam?.type} · zoom {Math.round(cam?.zoomStart ?? 0)}°
        <button className="pointer-events-auto ml-auto cursor-pointer rounded px-1 hover:bg-white/15" onClick={() => { ed.setSetting("cameraPreview", false); ed.refreshCameraViews(); }}>Hide</button>
      </div>
      <div className="aspect-video rounded-sm outline outline-1 outline-white/60 shadow-[0_2px_12px_rgba(0,0,0,0.6)]" />
    </div>
  );
}

// Intro playback: the 3D view shows the game camera; this bar plays, pauses and seeks.
function IntroPlayer() {
  const ed = useEditor("intro", "doc");
  if (!ed.intro) return null;
  const timeline = ed.introTimeline();
  const frame = ed.intro.frame;
  const shot = timeline.shots.find((s: any) => frame < s.start + s.frames) || timeline.shots[timeline.shots.length - 1];
  const n = shot ? timeline.shots.indexOf(shot) + 1 : 0;
  return (
    <div className="absolute inset-0 z-30 flex flex-col justify-end" onContextMenu={(e) => e.preventDefault()}>
      <div className="pointer-events-none absolute left-3 top-3 rounded bg-black/55 px-2 py-1 text-[11px] text-white/85">Intro preview · shot {n} of {timeline.shots.length} · camera {shot?.index}</div>
      <div className="m-3 flex items-center gap-3 rounded-lg bg-black/70 px-3 py-2 text-white backdrop-blur-sm">
        <button aria-label={ed.intro.playing ? "Pause" : "Play"} className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-white text-black hover:bg-white/85" onClick={() => ed.toggleIntroPlay()}>
          {ed.intro.playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </button>
        <div className="relative h-6 min-w-0 flex-1">
          <div className="absolute inset-x-0 top-1/2 flex h-1.5 -translate-y-1/2 overflow-hidden rounded-full">
            {timeline.shots.map((s: any, i: number) => (
              <div key={s.index} className="h-full border-r border-black/50 last:border-r-0" style={{ width: `${(s.frames / timeline.total) * 100}%`, background: i % 2 ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.22)" }} />
            ))}
          </div>
          <div className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-white" style={{ width: `${(frame / Math.max(1, timeline.total - 1)) * 100}%` }} />
          <input aria-label="Intro position" type="range" min={0} max={Math.max(0, timeline.total - 1)} value={frame} onChange={(e) => ed.seekIntro(Number(e.target.value))}
            className="absolute inset-0 w-full cursor-pointer opacity-0" />
        </div>
        <span className="w-24 shrink-0 text-right text-xs tabular-nums text-white/80">{(frame / 60).toFixed(1)} / {(timeline.total / 60).toFixed(1)} s</span>
        <button className="shrink-0 cursor-pointer rounded px-2 py-1 text-xs text-white/85 hover:bg-white/15" onClick={() => ed.stopIntro()}>Back to editing (Esc)</button>
      </div>
    </div>
  );
}

// The folder list is independent of the model index, so even very large mods appear immediately.
function WelcomeTracks() {
  const ed = useEditor("settings", "doc");
  const t = ed.trackFiles!;
  const [query, setQuery] = React.useState("");
  const [mode, setMode] = React.useState<"solo" | "multi" | "all">("solo");
  const [page, setPage] = React.useState(0);
  const q = query.trim().toLowerCase();
  const files = t.files.filter((f) =>
    (mode === "all" || (mode === "multi" ? /_d\.(szs|wlz|wbz|wu8)$/i.test(f) : !/_d\.(szs|wlz|wbz|wu8)$/i.test(f))) &&
    (!q || `${trackLabel(f)} ${f}`.toLowerCase().includes(q)));
  const pageSize = 48, pages = Math.max(1, Math.ceil(files.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const shown = files.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const current = ed.currentTrackFile();
  const changeMode = (next: typeof mode) => { setMode(next); setPage(0); };
  return (
    <Card className="w-full overflow-hidden">
      <CardHeader className="border-b bg-muted/20 p-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <FolderOpen className="size-4 text-primary" /> Track library
          <span className="ml-auto rounded-full border bg-background px-2 py-0.5 text-[11px] font-normal tabular-nums text-muted-foreground">{t.files.length.toLocaleString()} {t.files.length === 1 ? "file" : "files"}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" />
          <Input value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} onKeyDown={(e) => e.stopPropagation()} placeholder="Search by name or file number…" aria-label="Search tracks" className="h-8 pl-8 text-xs" />
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Track type">
          {([ ["solo", "Single player"], ["multi", "Multiplayer"], ["all", "All files"] ] as const).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={mode === value} onClick={() => changeMode(value)}
              className={`cursor-pointer rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${mode === value ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}>{label}</button>
          ))}
          <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">{files.length.toLocaleString()} shown</span>
        </div>
        <div className="grid max-h-80 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
          {shown.map((f) => {
            const label = trackLabel(f), number = f.replace(/\.(szs|wlz|wbz|wu8)$/i, "");
            return <button key={f} onClick={() => ed.openPath(`${t.folder}\\${f}`)} title={`${t.folder}\\${f}`}
              className={`group flex min-w-0 cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors ${f === current ? "border-primary/50 bg-primary/10" : "border-transparent bg-muted/30 hover:border-primary/30 hover:bg-accent"}`}>
              <span className="flex size-8 shrink-0 items-center justify-center rounded bg-background font-mono text-[10px] text-muted-foreground">{/^\d+$/.test(number) ? number : f.split(".").pop()!.toUpperCase()}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{/^\d+$/.test(label) ? `Track ${label}` : label}</span><span className="block truncate font-mono text-[10px] text-muted-foreground">{f}</span></span>
              <ArrowRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          })}
          {!files.length && <p className="col-span-2 m-0 py-8 text-center text-xs text-muted-foreground">No tracks match this search.</p>}
        </div>
        <div className="flex items-center justify-between border-t pt-2 text-[11px] text-muted-foreground">
          <span className="tabular-nums">{files.length ? `${currentPage * pageSize + 1}–${Math.min(files.length, (currentPage + 1) * pageSize)} of ${files.length.toLocaleString()}` : "0 tracks"}</span>
          <div className="flex items-center gap-1">
            <Button size="icon-sm" variant="ghost" aria-label="Previous track page" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft /></Button>
            <span className="min-w-12 text-center tabular-nums">{currentPage + 1} / {pages}</span>
            <Button size="icon-sm" variant="ghost" aria-label="Next track page" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}><ChevronRight /></Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function WelcomeAction({ icon: Icon, title, text, primary, onClick }: { icon: any; title: string; text: string; primary?: boolean; onClick: () => void }) {
  return (
    <Button variant={primary ? "default" : "secondary"} className="h-auto justify-start gap-4 px-4 py-3 text-left" onClick={onClick}>
      <Icon className="!size-5" />
      <span className="flex flex-col items-start gap-0.5">
        <span className="text-[14px] font-semibold">{title}</span>
        <span className={primary ? "text-xs font-normal opacity-80" : "text-xs font-normal text-muted-foreground"}>{text}</span>
      </span>
    </Button>
  );
}

// Right-click menu of the 3D view (opened by the viewport at the mouse position).
function ViewportContextMenu() {
  const ed = useEditor("ui");
  const at = ed.contextMenuAt;
  const items = at ? contextActions() : [];
  return (
    <DropdownMenu open={!!at} onOpenChange={(o) => { if (!o) { ed.contextMenuAt = null; ed.bump("ui"); } }}>
      <DropdownMenuTrigger asChild>
        <span className="pointer-events-none fixed size-0" style={{ left: at?.x ?? 0, top: at?.y ?? 0 }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        {items.map((a, i) => a.separator ? <DropdownMenuSeparator key={i} /> : (
          <DropdownMenuItem key={i} disabled={a.disabled} onSelect={a.onSelect}>
            {a.icon && <a.icon />} {a.label}
            {a.shortcut && <DropdownMenuShortcut>{a.shortcut}</DropdownMenuShortcut>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
