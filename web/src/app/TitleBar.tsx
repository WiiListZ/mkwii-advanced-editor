import * as React from "react";
import {
  Archive, ArrowDownToDot, ArrowDownToLine, ArrowLeftRight, AudioLines, BookOpen, Box, Boxes, BrickWall, Bug, ChevronDown, ChevronLeft, ChevronRight,
  CircleHelp, Clapperboard, Cloud, Flame, ClipboardPaste, Compass, Copy, CopyPlus, Crosshair, Eye, FileOutput, FilePlus2, FileText, FileX, Flag, FlipHorizontal2,
  FolderCog, FolderOpen, Github, GraduationCap, History, House, Image as ImageIcon, ImageOff, ImagePlus, Import, Info, Keyboard, Languages, Layers,
  Lightbulb, Link, ListChecks, ListOrdered, MapPin, Maximize, Minus, Mountain, PackageOpen, PackagePlus, Paintbrush, Pencil, Play, Plus, Puzzle, Redo2, Route, Save, SaveAll,
  Settings as SettingsIcon, Shapes, SlidersHorizontal, ShieldCheck, Sparkles, Square, SquareX, StretchHorizontal, Trash2, Undo2, Video, X,
  ScrollText, Download, Trophy, MessagesSquare,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { trackLabel } from "../../js/data/defs.js";
import {
  Menubar, MenubarCheckboxItem, MenubarContent, MenubarItem, MenubarMenu, MenubarSeparator, MenubarShortcut,
  MenubarSub, MenubarSubContent, MenubarSubTrigger, MenubarTrigger,
} from "@/components/ui/menubar";
import { useEditor } from "./hooks";
import { LAYER_LABEL, LAYERS, KIND_LABEL } from "./editor";
import { KIND_ICON } from "./common";
import { cn } from "@/lib/utils";
import { APP_VERSION, DISCORD_URL, REPO_URL, newIssueUrl, useUpdates } from "./updates";
import { api } from "../../js/api.js";
import { toast } from "sonner";

const ADD_KINDS = ["KTPT", "ENPT", "ITPT", "CKPT", "POTI", "AREA", "CAME", "JGPT", "CNPT", "MSPT"];

export function AddMenuItems({ Item, Separator }: { Item: any; Separator: any }) {
  const ed = useEditor("settings", "doc");
  return (
    <>
      {ADD_KINDS.filter((k) => k !== "MSPT" || ed.usesBattleEnds()).map((k) => {
        const Icon = KIND_ICON[k];
        return (
          <Item key={k} onSelect={() => ed.startPlacing(k)}>
            <Icon /> {KIND_LABEL[k]}
          </Item>
        );
      })}
      <Separator />
      <Item onSelect={() => ed.startPlacing("GOBJ", { objectId: 0x65 })}>
        <KIND_ICON.GOBJ /> Item Box
      </Item>
      <Item onSelect={() => { void ed.pickObject(0x65, "add"); }}>
        <KIND_ICON.GOBJ /> Other object…
      </Item>
      <Item onSelect={() => ed.cmd("gameObjects")}>
        <KIND_ICON.GOBJ /> Object from a track or my 3D model…
      </Item>
      <Separator />
      <Item onSelect={() => ed.cmd("modelParts")}>
        <Box className="text-amber-400" /> Model part from the game…
      </Item>
      <Separator />
      <Item onSelect={() => ed.ops.addGroup("ENPT")}><KIND_ICON.ENPT /> New enemy route group</Item>
      <Item onSelect={() => ed.ops.addGroup("ITPT")}><KIND_ICON.ITPT /> New item route group</Item>
      <Item onSelect={() => ed.ops.addGroup("CKPT")}><KIND_ICON.CKPT /> New checkpoint group</Item>
      <Item onSelect={() => ed.ops.addGroup("POTI")}><KIND_ICON.POTI /> New route</Item>
    </>
  );
}

// File name in the title bar; with a tracks folder it lists every track of it to switch directly.
function TrackSwitcher() {
  const ed = useEditor("doc", "settings");
  const d = ed.doc;
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const files = ed.trackFiles?.files || [];
  const current = ed.currentTrackFile();
  const q = query.trim().toLowerCase();
  const matches = React.useMemo(() => files.filter((f) => !q || `${trackLabel(f)} ${f}`.toLowerCase().includes(q)), [files, q]);
  const visible = matches.slice(0, 80);
  const single = visible.filter((f) => !/_d\.szs$/i.test(f)), multi = visible.filter((f) => /_d\.szs$/i.test(f));
  const item = (f: string) => (
    <CommandItem key={f} value={`${trackLabel(f)} ${f}`} onSelect={() => { setOpen(false); ed.switchTrack(f); }} className={cn(f === current && "text-primary")}>
      <span className="flex-1 truncate">{trackLabel(f)}</span>
      <span className="font-mono text-[10px] text-muted-foreground">{f}</span>
    </CommandItem>
  );
  const arrow = (direction: number, Icon: any, label: string) => (
    <button type="button" aria-label={label} title={`${label} (Ctrl+${direction < 0 ? "PageUp" : "PageDown"})`} onClick={() => ed.adjacentTrack(direction)}
      className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"><Icon className="size-3.5" /></button>
  );
  return (
    <div className="pointer-events-auto flex min-w-0 items-center justify-center gap-0.5">
      {arrow(-1, ChevronLeft, "Previous track")}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" title={d.filePath || "Not saved yet"} className="flex h-6 min-w-0 max-w-[420px] cursor-pointer items-center gap-1.5 rounded px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
            {d.dirty && <span className="inline-block size-1.5 shrink-0 rounded-full bg-primary" />}
            {current && <span className="shrink-0 font-medium text-foreground">{trackLabel(current)}</span>}
            <span className="truncate">{ed.isEmpty ? "Choose a track" : d.fileName}</span>
            <ChevronDown className="size-3 shrink-0 opacity-60" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-96 p-0" align="center">
          <Command shouldFilter={false}>
            <CommandInput value={query} onValueChange={setQuery} placeholder="Search track name or number…" />
            <CommandList className="max-h-[60vh]">
              <CommandEmpty>No tracks found.</CommandEmpty>
              <CommandGroup heading="Tracks">{single.map(item)}</CommandGroup>
              {multi.length > 0 && <CommandGroup heading="Multiplayer (_d)">{multi.map(item)}</CommandGroup>}
              {matches.length > visible.length && <div className="px-3 py-2 text-[11px] text-muted-foreground">Showing 80 of {matches.length.toLocaleString()} matches. Type to narrow the list.</div>}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {arrow(1, ChevronRight, "Next track")}
    </div>
  );
}

// Whether a modal window is open anywhere: the dialogs of the dialog store, and also those rendered
// directly (the update offer, the release notes). Their dark overlays are marked data-modal-overlay.
function useModalOverlay() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    const check = () => setOpen(!!document.querySelector('[data-modal-overlay][data-state="open"]'));
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-state"] });
    check();
    return () => observer.disconnect();
  }, []);
  return open;
}

export function TitleBar() {
  const ed = useEditor("doc", "ui", "settings", "selection");
  const d = ed.doc;
  const s = ed.settings;
  const vp = ed.viewport;
  const home = ed.homeVisible;
  const winctl = ed.hasWindowControls;
  const cmd = (name: string) => () => ed.cmd(name);
  // With a window (dialog) open the title bar stays above its dark overlay, so the window can still be
  // moved, maximized, minimized and closed; the menus stay inactive until the dialog closes.
  const stackOpen = useDialogStack().some((entry) => !entry.closing);
  const overlayOpen = useModalOverlay();
  const modal = stackOpen || overlayOpen;
  const updates = useUpdates();
  // Help › Release notes: the notes of the running version, from GitHub (or kept by the updater).
  const versionNotes = async () => {
    const releases = () => api.openUrl(`${REPO_URL}/releases`);
    try {
      const notes = await api.versionReleaseNotes();
      if (notes.available) updates.showNotes(notes);
      else toast.info(`No release notes for version ${APP_VERSION}`, { description: "This version has no release on GitHub (for example a build from source).", action: { label: "All releases", onClick: releases } });
    } catch (e: any) {
      toast.error("Could not load the release notes", { description: e.message, action: { label: "Open on GitHub", onClick: releases } });
    }
  };

  const dragStart = React.useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (!winctl || e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button, [role=menubar], [role=menuitem]")) return;
    dragStart.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const start = dragStart.current;
    if (!start || !(e.buttons & 1)) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < 5) return;
    dragStart.current = null;
    ed.windowAction("drag");
  };
  // Double-click on empty title bar space maximizes / restores, like a native title bar.
  const onDoubleClick = (e: React.MouseEvent) => {
    if (!winctl || (e.target as HTMLElement).closest("button, [role=menubar], [role=menuitem]")) return;
    ed.windowAction("toggle");
  };

  return (
    <header data-window-chrome style={modal ? { pointerEvents: "auto" } : undefined}
      className={cn("relative flex h-10 shrink-0 items-center gap-1 border-b bg-sidebar pl-3", modal && "z-[60] [&>*:not([data-window-controls])]:pointer-events-none [&>*:not([data-window-controls])]:opacity-40")} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onDoubleClick={onDoubleClick} onPointerUp={() => { dragStart.current = null; }} onPointerLeave={() => { dragStart.current = null; }}>
      <img src="icon.png" className="size-5 select-none" alt="" draggable={false} />
      <span className="mr-2 ml-1 whitespace-nowrap text-[13px] font-semibold tracking-tight">MKWii Advanced Editor</span>
      <span className="-ml-2 mr-2 text-[10px] text-muted-foreground">v{APP_VERSION}</span>
      {!ed.homeVisible && <button type="button" aria-label="Home" title="Home" onClick={cmd("home")}
        className="flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
        <House className="size-3.5" /><span className="hidden lg:inline">Home</span>
      </button>}
      <Menubar className="h-full">
        {/* On Home only what works without a track is listed; the rest belongs to the 3D editor. */}
        <MenubarMenu>
          <MenubarTrigger>File</MenubarTrigger>
          <MenubarContent>
            {!home && <MenubarItem onSelect={cmd("home")}><House /> Home</MenubarItem>}
            {home && !ed.isEmpty && <MenubarItem onSelect={cmd("editor")}><Pencil /> Continue editing</MenubarItem>}
            {!ed.isEmpty && <MenubarItem onSelect={cmd("closeTrack")}><FileX /> Close track…</MenubarItem>}
            {(!home || !ed.isEmpty) && <MenubarSeparator />}
            <MenubarItem onSelect={cmd("open")}><FolderOpen /> Open… <MenubarShortcut>Ctrl+O</MenubarShortcut></MenubarItem>
            <MenubarSub>
              <MenubarSubTrigger><History /> Open recent</MenubarSubTrigger>
              <MenubarSubContent className="max-w-[28rem]">
                {s.recent.length ? s.recent.map((p) => <MenubarItem key={p} onSelect={() => ed.openPath(p)} className="truncate"><FileText /> {p}</MenubarItem>) : <MenubarItem disabled>No recent files</MenubarItem>}
              </MenubarSubContent>
            </MenubarSub>
            <MenubarSeparator />
            <MenubarItem onSelect={cmd("newTrack")}><Sparkles /> Create new track… <MenubarShortcut>Ctrl+N</MenubarShortcut></MenubarItem>
            <MenubarItem onSelect={cmd("newEmpty")}><FilePlus2 /> New empty project</MenubarItem>
            {!home && <>
              <MenubarSeparator />
              <MenubarItem onSelect={cmd("save")}><Save /> Save <MenubarShortcut>Ctrl+S</MenubarShortcut></MenubarItem>
              <MenubarItem onSelect={cmd("saveAs")}><SaveAll /> Save as… <MenubarShortcut>Ctrl+Shift+S</MenubarShortcut></MenubarItem>
              <MenubarSeparator />
              <MenubarItem onSelect={cmd("szsContents")}><Archive /> SZS contents…</MenubarItem>
            </>}
            {home && <MenubarSeparator />}
            <MenubarItem onSelect={cmd("workspace")}><FolderCog /> Workspace (game files)…</MenubarItem>
            {!home && <>
              <MenubarSub>
                <MenubarSubTrigger><Import /> Import</MenubarSubTrigger>
                <MenubarSubContent>
                  <MenubarItem onSelect={cmd("importTrackModel")}><Box /> 3D model into track…</MenubarItem>
                  <MenubarItem onSelect={cmd("modelParts")}><Boxes /> Part from game models…</MenubarItem>
                  <MenubarItem onSelect={cmd("gameObjects")}><Boxes /> Object from a track or 3D model…</MenubarItem>
                  <MenubarItem onSelect={cmd("importKMP")}><Route /> KMP (replace course data)…</MenubarItem>
                  <MenubarItem onSelect={cmd("importKCL")}><BrickWall /> KCL (replace collision)…</MenubarItem>
                  <MenubarItem onSelect={cmd("importOBJCollision")}><Shapes /> OBJ as collision…</MenubarItem>
                </MenubarSubContent>
              </MenubarSub>
              <MenubarSub>
                <MenubarSubTrigger><FileOutput /> Export</MenubarSubTrigger>
                <MenubarSubContent>
                  <MenubarItem onSelect={cmd("exportKMP")}><Route /> course.kmp…</MenubarItem>
                  <MenubarItem onSelect={cmd("exportKCL")}><BrickWall /> course.kcl…</MenubarItem>
                  <MenubarItem onSelect={cmd("exportKCLObj")}><Shapes /> Collision as OBJ…</MenubarItem>
                  <MenubarItem onSelect={cmd("exportModelBrres")} disabled={!d.szs}><Box /> Track model (course_model.brres)…</MenubarItem>
                  <MenubarItem onSelect={cmd("exportModel3D")} disabled={!d.szs}><ImageIcon /> Track model with textures (DAE / OBJ)…</MenubarItem>
                  {d.extraModel && <MenubarItem onSelect={cmd("exportModelObj")}><Mountain /> Generated track model (OBJ)…</MenubarItem>}
                </MenubarSubContent>
              </MenubarSub>
            </>}
            <MenubarSeparator />
            <MenubarItem onSelect={cmd("objflow")}><PackageOpen /> Load Race/Common.szs…</MenubarItem>
            <MenubarItem onSelect={cmd("preferences")}><SettingsIcon /> Settings… <MenubarShortcut>Ctrl+,</MenubarShortcut></MenubarItem>
          </MenubarContent>
        </MenubarMenu>
        {!home && <MenubarMenu>
          <MenubarTrigger>Edit</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onSelect={cmd("undo")} disabled={!d.undoStack.length}>
              <Undo2 /> Undo{d.undoStack.length ? `: ${d.undoStack[d.undoStack.length - 1].label}` : ""} <MenubarShortcut>Ctrl+Z</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onSelect={cmd("redo")} disabled={!d.redoStack.length}><Redo2 /> Redo <MenubarShortcut>Ctrl+Y</MenubarShortcut></MenubarItem>
            <MenubarSeparator />
            <MenubarItem onSelect={cmd("copy")}><Copy /> Copy <MenubarShortcut>Ctrl+C</MenubarShortcut></MenubarItem>
            <MenubarItem onSelect={cmd("paste")} disabled={!ed.modelClipboard && !ed.kmpClipboard}><ClipboardPaste /> Paste <MenubarShortcut>Ctrl+V</MenubarShortcut></MenubarItem>
            <MenubarItem onSelect={cmd("duplicate")}><CopyPlus /> Duplicate <MenubarShortcut>Ctrl+D</MenubarShortcut></MenubarItem>
            <MenubarItem onSelect={cmd("delete")}><Trash2 /> Delete <MenubarShortcut>Ctrl+X</MenubarShortcut></MenubarItem>
            <MenubarItem onSelect={cmd("selectAll")}><ListChecks /> Select all of the same kind <MenubarShortcut>Ctrl+A</MenubarShortcut></MenubarItem>
            <MenubarItem onSelect={() => d.clearSelection()}><SquareX /> Clear selection <MenubarShortcut>Esc</MenubarShortcut></MenubarItem>
            <MenubarSeparator />
            <MenubarItem onSelect={cmd("snapGround")}><ArrowDownToLine /> Snap to ground <MenubarShortcut>G</MenubarShortcut></MenubarItem>
            <MenubarItem onSelect={cmd("alignRoute")}><Compass /> Align rotation to route</MenubarItem>
            <MenubarItem onSelect={cmd("distribute")}><StretchHorizontal /> Distribute evenly</MenubarItem>
            <MenubarSeparator />
            <MenubarItem onSelect={cmd("stageSettings")}><Flag /> Track settings…</MenubarItem>
          </MenubarContent>
        </MenubarMenu>}
        {!home && <MenubarMenu>
          <MenubarTrigger>View</MenubarTrigger>
          <MenubarContent>
            <MenubarSub>
              <MenubarSubTrigger><Eye /> Show</MenubarSubTrigger>
              <MenubarSubContent>
                {([["visual", "Track model"], ["collision", "Collision"], ["both", "Model + collision"]] as const).map(([v, l]) => (
                  <MenubarCheckboxItem key={v} checked={s.displayMode === v} onCheckedChange={() => ed.setSetting("displayMode", v)}>{l}</MenubarCheckboxItem>
                ))}
              </MenubarSubContent>
            </MenubarSub>
            <MenubarSub>
              <MenubarSubTrigger><Box /> 3D models</MenubarSubTrigger>
              <MenubarSubContent>
                {([["real", "Real game models"], ["simple", "Simple models"], ["markers", "Markers only"]] as const).map(([v, l]) => (
                  <MenubarCheckboxItem key={v} checked={s.modelMode === v} onCheckedChange={() => ed.setSetting("modelMode", v)}>{l}</MenubarCheckboxItem>
                ))}
              </MenubarSubContent>
            </MenubarSub>
            <MenubarCheckboxItem checked={s.animations} onCheckedChange={(v) => ed.setSetting("animations", !!v)}><Play /> Play animations</MenubarCheckboxItem>
            <MenubarCheckboxItem checked={s.showDescriptions} onCheckedChange={(v) => ed.setSetting("showDescriptions", !!v)}><Info /> Field explanations</MenubarCheckboxItem>
            <MenubarSeparator />
            <MenubarItem onSelect={() => vp?.frameAll()}><Maximize /> Frame whole track <MenubarShortcut>Home</MenubarShortcut></MenubarItem>
            <MenubarItem onSelect={() => vp?.focusSelection()}><Crosshair /> Focus selection <MenubarShortcut>F</MenubarShortcut></MenubarItem>
            <MenubarItem onSelect={() => vp?.topView()}><ArrowDownToDot /> Top view <MenubarShortcut>T</MenubarShortcut></MenubarItem>
            <MenubarSeparator />
            <MenubarSub>
              <MenubarSubTrigger><Layers /> Layers</MenubarSubTrigger>
              <MenubarSubContent>
                {LAYERS.map((l: string) => (
                  <MenubarCheckboxItem key={l} checked={!!vp?.layers[l]} onCheckedChange={() => ed.toggleLayer(l)}>{LAYER_LABEL[l]}</MenubarCheckboxItem>
                ))}
              </MenubarSubContent>
            </MenubarSub>
            <MenubarItem onSelect={cmd("referenceModel")}><ImagePlus /> Load reference model (BRRES / SZS / OBJ)…</MenubarItem>
            <MenubarItem onSelect={() => vp?.setReferenceModel(null)}><ImageOff /> Remove reference model</MenubarItem>
          </MenubarContent>
        </MenubarMenu>}
        {!home && <MenubarMenu>
          <MenubarTrigger>Add</MenubarTrigger>
          <MenubarContent>
            <AddMenuItems Item={MenubarItem} Separator={MenubarSeparator} />
          </MenubarContent>
        </MenubarMenu>}
        <MenubarMenu>
          <MenubarTrigger>Tools</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onSelect={cmd("cups")}><Trophy /> Cups and tracks…</MenubarItem>
            <MenubarItem onSelect={cmd("thp")}><Clapperboard /> Preview videos (THP)…</MenubarItem>
            <MenubarItem onSelect={cmd("gameText")}><Languages /> Game text (menus, names)…</MenubarItem>
            <MenubarItem onSelect={cmd("audio")}><AudioLines /> Sounds and music…</MenubarItem>
            <MenubarItem onSelect={cmd("assets")}><Box /> Characters and models…</MenubarItem>
            {!home && <MenubarItem onSelect={cmd("trackObjects")} disabled={!d.szs}><Boxes /> Track objects of this track…</MenubarItem>}
            {!home && <MenubarItem onSelect={cmd("sky")} disabled={!d.szs}><Cloud /> Sky…</MenubarItem>}
            {!home && <MenubarItem onSelect={cmd("effects")} disabled={!d.szs}><Sparkles /> Effects of this track…</MenubarItem>}
            {!home && <MenubarItem onSelect={cmd("lighting")} disabled={!d.szs}><Lightbulb /> Lighting of this track…</MenubarItem>}
            <MenubarItem onSelect={cmd("workspaceEffects")} disabled={!ed.workspace()}><Flame /> Effects in the game folder…</MenubarItem>
            <MenubarItem onSelect={cmd("gameParams")}><SlidersHorizontal /> Game data…</MenubarItem>
            <MenubarItem onSelect={cmd("riivolution")}><PackagePlus /> Riivolution mod…</MenubarItem>
            {!home && <>
              <MenubarItem onSelect={() => ed.watchIntro(0)} disabled={!d.kmp.CAME.length}><Clapperboard /> Watch intro</MenubarItem>
              <MenubarSeparator />
              <MenubarSub>
                <MenubarSubTrigger><KIND_ICON.ENPT /> Enemy routes</MenubarSubTrigger>
                <MenubarSubContent>
                  <MenubarItem onSelect={() => ed.ops.autoLinkGroups("ENPT")}><Link /> Link groups in sequence (loop)</MenubarItem>
                  <MenubarItem onSelect={() => ed.ops.enemyRouteFromItem()}><Copy /> Copy from item routes</MenubarItem>
                  <MenubarItem onSelect={() => ed.ops.reverseRoute("ENPT")}><ArrowLeftRight /> Reverse direction</MenubarItem>
                </MenubarSubContent>
              </MenubarSub>
              <MenubarSub>
                <MenubarSubTrigger><KIND_ICON.ITPT /> Item routes</MenubarSubTrigger>
                <MenubarSubContent>
                  <MenubarItem onSelect={() => ed.ops.itemRouteFromEnemy()}><Copy /> Copy from enemy routes</MenubarItem>
                  <MenubarItem onSelect={() => ed.ops.autoLinkGroups("ITPT")}><Link /> Link groups in sequence (loop)</MenubarItem>
                  <MenubarItem onSelect={() => ed.ops.reverseRoute("ITPT")}><ArrowLeftRight /> Reverse direction</MenubarItem>
                </MenubarSubContent>
              </MenubarSub>
              <MenubarSub>
                <MenubarSubTrigger><KIND_ICON.CKPT /> Checkpoints</MenubarSubTrigger>
                <MenubarSubContent>
                  <MenubarItem onSelect={() => generateCheckpoints()}><Sparkles /> Generate from enemy routes…</MenubarItem>
                  <MenubarItem onSelect={() => ed.ops.autoLinkGroups("CKPT")}><Link /> Link groups in sequence (loop)</MenubarItem>
                  <MenubarItem onSelect={() => ed.ops.assignRespawns()}><MapPin /> Assign nearest respawns</MenubarItem>
                  <MenubarItem onSelect={() => ed.ops.swapCheckpointSides(true)}><FlipHorizontal2 /> Swap left/right (selected)</MenubarItem>
                  <MenubarItem onSelect={() => ed.ops.swapCheckpointSides(false)}><FlipHorizontal2 /> Swap left/right (all)</MenubarItem>
                  <MenubarItem onSelect={() => ed.ops.reverseRoute("CKPT")}><ArrowLeftRight /> Reverse direction</MenubarItem>
                </MenubarSubContent>
              </MenubarSub>
              <MenubarSub>
                <MenubarSubTrigger><KIND_ICON.JGPT /> Respawns</MenubarSubTrigger>
                <MenubarSubContent>
                  <MenubarItem onSelect={() => createRespawns()}><Plus /> Create from checkpoints…</MenubarItem>
                  <MenubarItem onSelect={() => ed.ops.renumberIds()}><ListOrdered /> Renumber IDs</MenubarItem>
                </MenubarSubContent>
              </MenubarSub>
              <MenubarSeparator />
              <MenubarItem onSelect={() => ed.startPainting()} disabled={!d.kcl}><Paintbrush /> Paint collision</MenubarItem>
              <MenubarItem onSelect={() => ed.setTab("validate")}><ShieldCheck /> Check track</MenubarItem>
            </>}
          </MenubarContent>
        </MenubarMenu>
        <MenubarMenu>
          <MenubarTrigger>Help</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onSelect={cmd("help")}><CircleHelp /> Help center <MenubarShortcut>F1</MenubarShortcut></MenubarItem>
            <MenubarItem onSelect={() => dialogs.open("help", { tab: "tutorials" })}><GraduationCap /> Tutorials</MenubarItem>
            <MenubarItem onSelect={() => dialogs.open("help", { tab: "tutorials", tutorial: "intro" })}><Video /> Tutorial: intro camera</MenubarItem>
            <MenubarItem onSelect={() => dialogs.open("help", { tab: "elements" })}><Puzzle /> Track elements explained</MenubarItem>
            <MenubarItem onSelect={() => dialogs.open("help", { tab: "collision" })}><BrickWall /> Collision types explained</MenubarItem>
            <MenubarItem onSelect={() => dialogs.open("help", { tab: "keys" })}><Keyboard /> Mouse &amp; keyboard</MenubarItem>
            {!home && <MenubarItem onSelect={cmd("tour")}><BookOpen /> Guided tour</MenubarItem>}
            <MenubarSeparator />
            <MenubarItem onSelect={() => void versionNotes()}><ScrollText /> Release notes (version {APP_VERSION})</MenubarItem>
            {updates.status?.available && <MenubarItem onSelect={() => updates.showNotes({ version: updates.status?.version || "", title: updates.status?.title, notes: updates.status?.notes || "", url: updates.status?.url })}><Download /> Release notes of the update ({updates.status.version})</MenubarItem>}
            <MenubarSeparator />
            <MenubarItem onSelect={() => api.openUrl(DISCORD_URL)}><MessagesSquare /> Discord server (help and questions)</MenubarItem>
            <MenubarItem onSelect={() => api.openUrl(REPO_URL)}><Github /> GitHub page</MenubarItem>
            <MenubarItem onSelect={() => api.openUrl(newIssueUrl())}><Bug /> Report an issue on GitHub…</MenubarItem>
            <MenubarSeparator />
            <MenubarItem onSelect={cmd("about")}><Info /> About</MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>
      <div className="flex-1" />
      {/* Centred on the whole window, not on the space between the menus and the window buttons. */}
      <div className="pointer-events-none absolute inset-y-0 left-1/2 flex max-w-[34vw] -translate-x-1/2 items-center">
        {ed.homeVisible || ed.isEmpty && !ed.trackFiles?.files.length ? null : ed.trackFiles?.files.length ? <TrackSwitcher /> : (
          <div className="truncate text-xs text-muted-foreground" title={d.filePath || "Not saved yet"}>
            {d.dirty && <span className="mr-1.5 inline-block size-1.5 rounded-full bg-primary align-middle" />}
            {d.fileName}
          </div>
        )}
      </div>
      {winctl && (
        <div data-window-controls className="flex h-full self-stretch">
          <WinButton label="Minimize" onClick={() => ed.windowAction("minimize")}><Minus /></WinButton>
          <WinButton label={ed.maximized ? "Restore" : "Maximize"} onClick={() => ed.windowAction("toggle")}>
            {ed.maximized ? <Copy className="!size-3.5 -scale-x-100" /> : <Square className="!size-3.5" />}
          </WinButton>
          <WinButton label="Close" onClick={() => ed.windowAction("close")} close><X /></WinButton>
        </div>
      )}
    </header>
  );
}

function WinButton({ children, onClick, label, close }: { children: React.ReactNode; onClick: () => void; label: string; close?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn("flex h-full w-12 cursor-pointer items-center justify-center text-foreground/80 transition-colors [&_svg]:size-4 [&_svg]:stroke-[1.5]", close ? "hover:bg-[#e81123] hover:text-white" : "hover:bg-accent")}
    >
      {children}
    </button>
  );
}

import { editor } from "./editor";
import { dialogs, useDialogStack } from "./dialogs-store";

export async function generateCheckpoints() {
  const ed = editor;
  if (!ed.doc.kmp.ENPT.length) return dialogs.alert({ title: "No enemy route", description: "Create the enemy (CPU) route first: checkpoints are generated along it." });
  const r = await dialogs.form({
    title: "Generate checkpoints",
    description: "Creates a checkpoint across the road at the enemy route points. Existing checkpoints are replaced.",
    confirmLabel: "Generate",
    fields: [
      { key: "every", label: "One checkpoint every N enemy points", type: "number", value: 1, min: 1, max: 10 },
      { key: "auto", label: "Fit width to the road", type: "switch", value: !!ed.doc.kcl, hint: "Measures the road on the collision." },
      { key: "width", label: "Width when not fitted", type: "number", value: ed.settings.checkpointWidth, min: 200, max: 30000 },
      { key: "keyCount", label: "Key checkpoints", type: "number", value: 3, min: 0, max: 10, hint: "Checkpoints that must be crossed in order (stop shortcuts)." },
    ],
  });
  if (r) ed.ops.checkpointsFromEnemy({ every: Math.max(1, r.every | 0), width: r.width, auto: r.auto, keyCount: r.keyCount | 0 });
}

export async function createRespawns() {
  const r = await dialogs.form({
    title: "Create respawns",
    description: "Places respawn points along the checkpoints, facing the driving direction. Existing respawns are replaced.",
    confirmLabel: "Create",
    fields: [{ key: "every", label: "One respawn every N checkpoints", type: "number", value: 4, min: 1, max: 20 }],
  });
  if (r) editor.ops.respawnsFromCheckpoints(Math.max(1, r.every | 0));
}
