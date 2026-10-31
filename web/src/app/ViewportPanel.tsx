import * as React from "react";
import { ArrowRight, AudioLines, Box, ChevronLeft, ChevronRight, CircleHelp, FilePlus2, Flame, FolderOpen, History, Languages, Mouse, PackagePlus, Pause, Play, Search, Settings, SlidersHorizontal, Sparkles, Trophy, Video, X, Clapperboard } from "lucide-react";
import { WorkspaceCard } from "./panels/WorkspaceCard";
import { CommonSzsCard, ObjectDocumentationCard } from "./panels/GameFilesCards";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { KIND_HELP } from "../../js/data/help.js";
import { CAMERA_TYPES, trackKind, trackLabel } from "../../js/data/defs.js";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { useEditor } from "./hooks";
import { editor, hasBackend, PATH_KINDS } from "./editor";
import { contextActions } from "./context-actions";
import { Map2DPanel } from "./Map2DPanel";
import { IntroTimeline } from "./IntroTimeline";
import { DISCORD_URL, DiscordIcon } from "./updates";
import { api } from "../../js/api.js";

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

  const timeline = ed.tab === "cameras" && !ed.homeVisible && !ed.isEmpty && !view2D;
  return (
    <div className="flex size-full flex-col">
      <div
        className="relative min-h-0 flex-1 overflow-hidden bg-[#1c1c1e]"
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
      {timeline && <IntroTimeline />}
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
    const move = ed.settings.hideMoveArrows ? "drag it to move" : ed.settings.dragToMove ? "drag it or the arrows to move" : "drag the arrows to move";
    text = `${kh ? kh.title + " selected" : "Selected"} · ${move} · W / E / R = move / rotate / scale · G = ground · Del = delete`;
  } else if (!ed.isEmpty) text = "Click something to select it · right-drag to look around · wheel to zoom · Add places new elements";
  if (ed.hint) text = ed.hint;
  return text;
}

function Welcome() {
  const ed = useEditor("settings", "doc", "ui");
  const recent = ed.settings.recent || [];
  // Tools for the rest of the game; the ones that need the game folder appear once it is chosen.
  // The track library moved into Cups and tracks: said once on Home, to new and updated users alike.
  const [movedSeen, setMovedSeen] = React.useState(() => localStorage.getItem("mkwii-tracks-moved-seen") === "1");
  const dismissMoved = () => { localStorage.setItem("mkwii-tracks-moved-seen", "1"); setMovedSeen(true); };
  const gameTools = [
    { icon: Clapperboard, title: "Preview videos", text: "Track previews and menu videos (THP)", cmd: "thp", detail: "Play the game's THP videos and replace a track's preview, a cup's picture or a whole menu video with a picture, a video file or another preview" },
    { icon: Languages, title: "Game text", text: "Menu and race messages, with a preview", cmd: "gameText", detail: "Edit menu and race messages with a preview of where they appear in the game" },
    { icon: AudioLines, title: "Sounds and music", text: "Listen to and replace music and effects", cmd: "audio", detail: "Listen to the game's music and sound effects and replace them with your own" },
    { icon: Box, title: "Characters and models", text: "Models, textures and animations", cmd: "assets", detail: "Edit game characters, object models, textures and animations" },
    ...(ed.workspace() ? [{ icon: Flame, title: "Effects", text: "Smoke, fire, sparks of every archive", cmd: "workspaceEffects", detail: "Edit the particle effects (smoke, fire, sparks…) of every track and archive in the game folder" }] : []),
    ...(ed.workspaceInfo?.common ? [{ icon: SlidersHorizontal, title: "Game data", text: "Stats, items, objects, cameras, Battle and GP settings", cmd: "gameParams", detail: "The data files of Race/Common.szs, every value explained: vehicle and character stats, item chances, object types and reactions, CPU drivers, vehicle parts and cameras (.bin), the camera before the countdown (.bcp), the physics of each vehicle (.bsp), the Battle settings (.kmg), the Grand Prix time limits (.krt) and the rumble patterns (.krm)" }] : []),
    { icon: PackagePlus, title: "Riivolution mod", text: "Mod folder for Riivolution or Dolphin", cmd: "riivolution", detail: "Turn your edited files into a mod folder for Riivolution or Dolphin, or edit a Riivolution XML" },
  ];
  return (
    // The content is centred; m-auto (not items-center) keeps the top reachable on very small windows.
    <div className="absolute inset-0 z-10 flex overflow-y-auto bg-background p-6 short:py-4">
      <div className="mx-auto my-auto flex w-full max-w-[1040px] flex-col gap-5 short:gap-3">
        <header className="flex items-center gap-3">
          <img src="icon.png" className="size-14 shrink-0 select-none short:size-11" alt="" draggable={false} />
          <div className="min-w-0 flex-1">
            <h1 className="m-0 text-lg font-semibold tracking-tight">MKWii Advanced Editor</h1>
            <p className="m-0 truncate text-xs text-muted-foreground">Edit Mario Kart Wii tracks visually, with the game's real models.</p>
          </div>
          <Button variant="ghost" size="sm" aria-label="Settings" onClick={() => ed.cmd("settingsDialog")}><Settings /> Settings</Button>
          <Button variant="ghost" size="sm" onClick={() => ed.cmd("help")}><CircleHelp /> Help</Button>
          <Button variant="ghost" size="sm" title="Join the editor's Discord server: help, questions and news" onClick={() => api.openUrl(DISCORD_URL)}><DiscordIcon /> Discord</Button>
        </header>
        {!ed.isEmpty && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium">{ed.doc.fileName}</div>
              <div className="text-[11px] text-muted-foreground">{ed.doc.dirty ? "Unsaved changes" : "Open in the editor"}</div>
            </div>
            <Button size="sm" onClick={() => ed.cmd("editor")}><ArrowRight /> Continue editing</Button>
            <Button size="icon" variant="ghost" title="Close track" aria-label="Close track" onClick={() => ed.cmd("closeTrack")}><X /></Button>
          </div>
        )}
        {!movedSeen && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-3 py-2.5" role="status" data-tracks-moved>
            <Trophy className="size-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium">The track list is now in Cups and tracks</div>
              <div className="text-[11.5px] text-muted-foreground">Every track of your game folder, by cup, with the search, version and type filters, the tracks that are in no cup and their preview videos. Click a track there to open it in the editor.</div>
            </div>
            <Button size="sm" onClick={() => { dismissMoved(); ed.cmd("cups"); }}><Trophy /> Open Cups and tracks</Button>
            <Button size="sm" variant="ghost" onClick={dismissMoved}>Got it</Button>
          </div>
        )}
        <div className="grid min-h-0 flex-1 items-start gap-5 short:gap-3 lg:grid-cols-[minmax(0,1fr)_300px] lg:grid-rows-[minmax(0,1fr)] lg:items-stretch">
          <div className="flex min-h-0 min-w-0 flex-col gap-5 short:gap-3">
            <HomeSection title="Tracks">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <HomeTile icon={Trophy} title="Cups and tracks" text="All your tracks, by cup" primary detail="Every track of the game folder by cup (and those in no cup), with search and filters: click one to edit it. Move tracks between cups, put in your own, make new cups" onClick={() => { dismissMoved(); ed.cmd("cups"); }} />
                <HomeTile icon={FolderOpen} title="Open a track" text=".szs, .kmp or .kcl file" shortcut="Ctrl+O" detail="A .szs from Race/Course, or a single .kmp / .kcl" onClick={() => ed.cmd("open")} />
                <HomeTile icon={Sparkles} title="New track" text="Draw it from above; the rest is built" shortcut="Ctrl+N" detail="Draw the layout from above — road, walls, routes and checkpoints are built for you" onClick={() => ed.cmd("newTrack")} />
                <HomeTile icon={FilePlus2} title="Empty project" text="Start from your own collision" detail="Start from scratch and import your own collision" onClick={() => ed.cmd("newEmpty")} />
              </div>
            </HomeSection>
            <HomeSection title="Game files and mods">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {gameTools.map((tool) => <HomeTile key={tool.cmd} icon={tool.icon} title={tool.title} text={tool.text} detail={tool.detail} onClick={() => ed.cmd(tool.cmd)} />)}
              </div>
            </HomeSection>
            {/* Where the track list was: the files opened last, two per row. */}
            <HomeSection title="Recent files">
              {recent.length ? (
                <div className="grid grid-cols-1 gap-0.5 rounded-lg border bg-card p-1 sm:grid-cols-2" data-recent-files>
                  {recent.map((p) => (
                    <button key={p} onClick={() => ed.openPath(p)} title={p} className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent">
                      <History className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-medium">{p.split(/[\\/]/).pop()}</span>
                        <span className="block truncate text-[10.5px] text-muted-foreground [direction:rtl] text-left">{p.split(/[\\/]/).slice(0, -1).join("\\")}</span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : <p className="m-0 rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">Files you open appear here.</p>}
            </HomeSection>
          </div>
          <aside className="flex min-h-0 min-w-0 flex-col gap-5 short:gap-3 lg:overflow-y-auto">
            <WorkspaceCard brief />
            <CommonSzsCard className="p-3" brief />
            <ObjectDocumentationCard className="p-3" brief />
            {!hasBackend && (
              <CardDescription>Running in a plain browser: files are opened from disk and saved as downloads. Start the desktop app for direct saving.</CardDescription>
            )}
            <p className="m-0 text-xs text-muted-foreground">Tip: you can also drop a file onto this window.</p>
          </aside>
        </div>
      </div>
    </div>
  );
}

function HomeSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 short:gap-1.5">
      <h2 className="m-0 text-xs font-medium text-muted-foreground">{title}</h2>
      {children}
    </section>
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
  const ed = useEditor("intro", "doc", "ui");
  if (!ed.intro) return null;
  const timeline = ed.introTimeline();
  const frame = ed.intro.frame;
  const shot = timeline.shots.find((s: any) => frame < s.start + s.frames) || timeline.shots[timeline.shots.length - 1];
  const n = shot ? timeline.shots.indexOf(shot) + 1 : 0;
  // In the Cameras tab the keyframe timeline under the view is the player.
  if (ed.tab === "cameras") return (
    <div className="absolute inset-0 z-30 cursor-pointer" onClick={() => ed.finishIntro()} onContextMenu={(e) => e.preventDefault()}>
      <div className="pointer-events-none absolute left-3 top-3 rounded bg-black/55 px-2 py-1 text-[11px] text-white/85">Intro · shot {n} of {timeline.shots.length} · click or Space to stop here</div>
    </div>
  );
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

// One square of the Home grid: icon and shortcut on top, a short title and one line under it
// (the longer description is the tooltip). Short windows show one row: icon, title, shortcut.
function HomeTile({ icon: Icon, title, text, detail, shortcut, primary, onClick }: { icon: any; title: string; text: string; detail?: string; shortcut?: string; primary?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} title={detail}
      className={`flex min-h-[92px] min-w-0 cursor-pointer flex-col justify-between gap-3 rounded-lg p-3 text-left shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring short:min-h-0 short:flex-row short:items-center short:justify-start short:gap-2.5 short:py-2.5 ${primary ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-secondary text-secondary-foreground hover:bg-secondary/70"}`}>
      <span className="flex items-center justify-between gap-2 short:contents">
        <Icon className="size-5 shrink-0 short:size-4" />
        {shortcut && <Kbd className={`short:order-last short:ml-auto ${primary ? "border-primary-foreground/20 bg-primary-foreground/10 text-primary-foreground/80" : ""}`}>{shortcut}</Kbd>}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-[13px] font-semibold">{title}</span>
        <span className={`line-clamp-2 text-[11.5px] leading-snug short:hidden ${primary ? "text-primary-foreground/75" : "text-muted-foreground"}`}>{text}</span>
      </span>
    </button>
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
