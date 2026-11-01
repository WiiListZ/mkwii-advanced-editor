import * as React from "react";
import { BrickWall, Clapperboard, ListTree, LoaderCircle, ShieldCheck } from "lucide-react";
import { CamerasPanel } from "./panels/CamerasPanel";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { kclTypeOf } from "../../js/data/defs.js";
import { TOUR } from "../../js/data/help.js";
import { useEditor } from "./hooks";
import { editor, hex } from "./editor";
import { Hint } from "./common";
import { TitleBar } from "./TitleBar";
import { Toolbar } from "./Toolbar";
import { ViewportPanel, viewHintText } from "./ViewportPanel";
import { Outliner } from "./panels/Outliner";
import { ObjectsPanel } from "./panels/ObjectsPanel";
import { CollisionPanel } from "./panels/CollisionPanel";
import { CheckPanel } from "./panels/CheckPanel";
import { Inspector } from "./panels/Inspector";
import { DialogHost } from "./dialogs/DialogHost";
import { UpdateNotice, UpdatesProvider } from "./updates";
import { DiscordActivityProvider } from "./discord-activity";

export function App() {
  return <UpdatesProvider><DiscordActivityProvider><AppContent /></DiscordActivityProvider></UpdatesProvider>;
}

function AppContent() {
  const ed = useEditor("doc", "ui");
  React.useEffect(() => {
    const title = `${ed.isEmpty ? "Home" : `${ed.doc.dirty ? "* " : ""}${ed.doc.fileName}`} — MKWii Advanced Editor`;
    document.title = title;
    if (ed.hasWindowControls) void (window as any).__winctl("title", title);
  }, [ed.doc.fileName, ed.doc.dirty, ed.isEmpty]);
  React.useEffect(() => {
    // The native caption is replaced before this page loads. Once the page is mounted, align
    // WebView2's child bounds and input focus with the final client area as well.
    if (editor.hasWindowControls) void editor.windowAction("ready");
  }, []);
  React.useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => { if (editor.doc.dirty && !(window as any).__closingApproved) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", onBeforeUnload);
    const onKey = (e: KeyboardEvent) => editor.handleKey(e);
    window.addEventListener("keydown", onKey);
    const onContextMenu = (e: MouseEvent) => { if (editor.hasWindowControls) e.preventDefault(); };
    document.addEventListener("contextmenu", onContextMenu, true);
    // No browser page zoom: Ctrl+wheel and Ctrl +/-/0 belong to the editor.
    const noZoomWheel = (e: WheelEvent) => { if (e.ctrlKey) e.preventDefault(); };
    const noZoomKeys = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && ["+", "-", "=", "0", "_"].includes(e.key)) e.preventDefault(); };
    window.addEventListener("wheel", noZoomWheel, { passive: false });
    window.addEventListener("keydown", noZoomKeys, true);
    return () => {
      window.removeEventListener("keydown", onKey); document.removeEventListener("contextmenu", onContextMenu, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("wheel", noZoomWheel); window.removeEventListener("keydown", noZoomKeys, true);
    };
  }, []);
  // Home remains available while a track stays loaded in the mounted 3D editor.
  const empty = ed.homeVisible || ed.isEmpty;

  return (
    <TooltipProvider delayDuration={350} skipDelayDuration={150}>
      <div className="flex h-full flex-col">
        <TitleBar />
        <UpdateNotice />
        {!empty && ed.cupTrackLink && <div className="shrink-0 border-b bg-muted/30 px-4 py-2 text-xs" data-cup-track-link>
          <b>{ed.cupTrackLink.label}</b><span className="ml-2 text-muted-foreground">{ed.cupTrackLink.pending ? "Assigned to this cup position. Save edits here, then Apply in Cups and tracks." : "Applied to this cup position. Save updates its track directly."}</span>
        </div>}
        {!empty && <Toolbar />}
        <ResizablePanelGroup direction="horizontal" className="min-h-0 flex-1" autoSaveId={empty ? "mkwii-layout-start" : "mkwii-layout"}>
          {!empty && <ResizablePanel key="left" defaultSize={20} minSize={14} maxSize={34} className="bg-sidebar" id="left" order={1}>
            <Sidebar />
          </ResizablePanel>}
          {!empty && <ResizableHandle key="left-handle" />}
          <ResizablePanel key="viewport" defaultSize={empty ? 100 : 57} minSize={30} id="viewport" order={2}>
            <ViewportPanel />
          </ResizablePanel>
          {!empty && <ResizableHandle key="right-handle" />}
          {!empty && <ResizablePanel key="right" defaultSize={23} minSize={16} maxSize={40} className="bg-sidebar" id="right" order={3}>
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex h-9 shrink-0 items-center border-b px-4 text-xs font-medium text-muted-foreground">Inspector</div>
              <div className="min-h-0 flex-1 overflow-y-auto"><Inspector /></div>
            </div>
          </ResizablePanel>}
        </ResizablePanelGroup>
        {!empty && <StatusBar />}
      </div>
      <DialogHost />
      <BusyOverlay />
      <Tour />
      <Toaster />
      <WindowResizeEdges />
    </TooltipProvider>
  );
}

// Thin edges that hand resizing over to Windows (native sizing loop, like a normal window frame).
function WindowResizeEdges() {
  const ed = useEditor("ui");
  const pressed = React.useRef<{ edge: string; x: number; y: number } | null>(null);
  if (!ed.hasWindowControls || ed.maximized) return null;
  // The native sizing loop starts once the pointer actually moves, so a plain click does nothing.
  const start = (edge: string) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    pressed.current = { edge, x: e.clientX, y: e.clientY };
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = pressed.current;
    if (!p || !(e.buttons & 1) || Math.hypot(e.clientX - p.x, e.clientY - p.y) < 2) return;
    pressed.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    ed.windowAction("resize", p.edge);
  };
  const stop = () => { pressed.current = null; };
  const edges = [
    ["top", "top-0 left-2 right-2 h-1 cursor-ns-resize"],
    ["left", "left-0 top-2 bottom-2 w-1 cursor-ew-resize"],
    ["right", "right-0 top-2 bottom-2 w-1 cursor-ew-resize"],
    ["bottom", "bottom-0 left-2 right-2 h-1 cursor-ns-resize"],
    ["topleft", "top-0 left-0 size-2 cursor-nwse-resize"],
    ["topright", "top-0 right-0 size-2 cursor-nesw-resize"],
    ["bottomleft", "bottom-0 left-0 size-2 cursor-nesw-resize"],
    ["bottomright", "bottom-0 right-0 size-2 cursor-nwse-resize"],
  ];
  return <div className="pointer-events-none fixed inset-0 z-[90]" aria-hidden="true">
    {edges.map(([edge, position]) => <div key={edge} data-resize-edge={edge} className={`pointer-events-auto absolute ${position}`} onPointerDown={start(edge)} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} />)}
  </div>;
}

function Sidebar() {
  const ed = useEditor("ui");
  const errors = ed.issues.filter((i) => i.level === "error").length;
  const warnings = ed.issues.filter((i) => i.level === "warning").length;
  const tabs = [
    { id: "outline", icon: ListTree, label: "Track", text: "Every element of the track, grouped by kind. Click to select, double-click to focus." },
    { id: "collision", icon: BrickWall, label: "Collision", text: "Surface types of the track (road, off-road, walls…): show, hide and paint them." },
    { id: "cameras", icon: Clapperboard, label: "Cameras", text: "The intro fly-over as keyframes on a timeline under the 3D view: frame the view and press K, the camera flies between keyframes. Also replay cameras." },
    { id: "validate", icon: ShieldCheck, label: "Check", text: "Finds mistakes that crash the game or break races, with one-click fixes." },
  ];
  return (
    <Tabs value={ed.tab} onValueChange={(v) => ed.setTab(v)} className="flex h-full min-h-0 flex-col" id="sidebar-tabs">
      <div className="border-b p-2">
        <TabsList className="grid h-auto w-full grid-cols-4">
          {tabs.map((t) => (
            <TabsTrigger key={t.id} value={t.id}
              className="relative h-auto px-0 py-1 data-[state=active]:bg-background data-[state=active]:shadow-sm">
              <Hint title={t.label} text={t.text}>
                <span className="flex size-full flex-col items-center justify-center gap-0.5 px-0.5 text-[10.5px] leading-none"><t.icon className="!size-3.5" /> {t.label}</span>
              </Hint>
              {t.id === "validate" && !ed.isEmpty && (errors || warnings) > 0 && (
                <span className={`absolute -right-0.5 -top-1 min-w-4 rounded-full px-1 text-[9px] font-bold leading-4 ${errors ? "bg-destructive text-white" : "bg-warning text-black"}`}>{errors || warnings}</span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <TabsContent value="outline" className="mt-0 min-h-0 flex-1"><Outliner /></TabsContent>
      <TabsContent value="objects" className="mt-0 min-h-0 flex-1"><ObjectsPanel /></TabsContent>
      <TabsContent value="collision" className="mt-0 min-h-0 flex-1"><CollisionPanel /></TabsContent>
      <TabsContent value="cameras" className="mt-0 min-h-0 flex-1"><CamerasPanel /></TabsContent>
      <TabsContent value="validate" className="mt-0 min-h-0 flex-1"><CheckPanel /></TabsContent>
    </Tabs>
  );
}

function StatusBar() {
  const ed = useEditor("hover", "selection", "ui", "doc");
  const n = ed.doc.selection.size;
  const geom = ed.geometrySelection;
  const hv = ed.hover;
  let hover = "";
  if (hv && !ed.map2D) {
    hover = `X ${Math.round(hv.point[0])}   Y ${Math.round(hv.point[1])}   Z ${Math.round(hv.point[2])}`;
    if (hv.tri >= 0 && ed.doc.kcl) {
      const flag = ed.doc.kcl.flags[hv.tri];
      hover += `   ·   ${kclTypeOf(flag).name} (${hex(flag)})`;
    }
  }
  const statusHint = viewHintText(ed);
  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t bg-sidebar px-3 text-[11.5px] text-muted-foreground" id="statusbar">
      <span className="shrink-0">{geom ? geom.type === "model" ? `Model part: ${geom.name}` : `Collision triangle #${geom.tri + 1}` : n ? `${n} selected` : "Nothing selected"}</span>
      {hover && <span className={`${statusHint ? "" : "ml-auto"} shrink-0 font-mono tabular-nums`}>{hover}</span>}
      {statusHint && <span role="status" data-status-hint className="ml-auto min-w-0 max-w-[70%] truncate text-right text-foreground/85" title={statusHint}>{statusHint}</span>}
    </footer>
  );
}

function BusyOverlay() {
  const ed = useEditor("ui");
  if (!ed.busy) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-[1px]">
      <Card className="flex items-center gap-3 px-5 py-4 text-[13px]"><LoaderCircle className="size-5 animate-spin text-primary" /> {ed.busy}</Card>
    </div>
  );
}

// Guided tour: highlights each part of the window with an explanation.
function Tour() {
  const ed = useEditor("ui", "doc");
  const [step, setStep] = React.useState(0);
  const [rect, setRect] = React.useState<DOMRect | null>(null);
  React.useEffect(() => { if (ed.tourActive) setStep(0); }, [ed.tourActive]);
  React.useLayoutEffect(() => {
    if (!ed.tourActive || ed.isEmpty) return;
    const el = document.querySelector(TOUR_TARGETS[step] || TOUR[step]?.el);
    setRect(el ? el.getBoundingClientRect() : null);
  }, [ed.tourActive, step, ed.isEmpty]);
  // The tour points at the editor panels, which only exist once something is open.
  if (!ed.tourActive || ed.isEmpty) return null;
  const s = TOUR[step];
  const last = step === TOUR.length - 1;
  const below = rect ? rect.bottom + 230 < window.innerHeight : true;
  return (
    <div className="fixed inset-0 z-[70]">
      {rect && (
        <div className="pointer-events-none fixed rounded-lg ring-2 ring-primary transition-all duration-200"
          style={{ left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8, boxShadow: "0 0 0 4000px rgba(0,0,0,0.7)" }} />
      )}
      <Card className="fixed w-[380px] p-4 shadow-2xl" style={rect ? { left: Math.max(12, Math.min(window.innerWidth - 392, rect.left)), top: below ? rect.bottom + 14 : Math.max(12, rect.top - 210) } : { left: "50%", top: "40%" }}>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-primary">Step {step + 1} of {TOUR.length}</div>
        <div className="mt-1 text-[15px] font-semibold">{s.title}</div>
        <p className="mb-4 mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{s.text}</p>
        <div className="flex justify-between">
          <Button variant="ghost" size="sm" onClick={() => ed.finishTour()}>Skip tour</Button>
          <div className="flex gap-2">
            {step > 0 && <Button variant="outline" size="sm" onClick={() => setStep(step - 1)}>Back</Button>}
            <Button size="sm" onClick={() => (last ? ed.finishTour() : setStep(step + 1))}>{last ? "Finish" : "Next"}</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

// Selectors of the React layout for each tour step (same order as TOUR in help.js).
const TOUR_TARGETS = ["[role=menubar]", "[data-group=transform]", "[data-group=create]", "[data-group=view]", "#sidebar-tabs [role=tablist]", "[data-panel-id=viewport]", "[data-panel-id=right]", "#statusbar"];
