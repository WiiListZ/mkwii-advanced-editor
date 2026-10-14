import * as React from "react";
import {
  ArrowDownToLine, Box, BrickWall, ChevronDown, CircleHelp, Flag, Layers, Magnet, Map, Maximize2, Mountain, Move, Pause, Play, Plus,
  Redo2, RotateCw, Save, Scale3d, ScanSearch, Settings, Sparkles, Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TOOL_HELP } from "../../js/data/help.js";
import { useEditor } from "./hooks";
import { Hint } from "./common";
import { AddMenuItems } from "./TitleBar";
import { cn } from "@/lib/utils";

const tip = (key: string) => {
  const [title, text, shortcut] = (TOOL_HELP as any)[key];
  return { title, text, shortcut };
};

const MOVE_STEPS = [0, 10, 50, 100, 500, 1000];
const ROT_STEPS = [0, 5, 15, 45, 90];

// A rounded container that groups related controls, like the toolbars of most editors.
function Cluster({ children, id, className }: { children: React.ReactNode; id?: string; className?: string }) {
  return <div data-group={id} className={cn("flex items-center gap-0.5 rounded-lg border bg-muted/40 p-0.5", className)}>{children}</div>;
}

function IconButton({ tipKey, onClick, disabled, children, text }: { tipKey: string; onClick: () => void; disabled?: boolean; children: React.ReactNode; text?: string }) {
  return (
    <Hint {...tip(tipKey)} {...(text ? { text } : {})}>
      <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-foreground" disabled={disabled} onClick={onClick}>{children}</Button>
    </Hint>
  );
}

export function Toolbar() {
  const ed = useEditor("doc", "ui", "settings", "selection");
  const vp = ed.viewport;
  const d = ed.doc;
  const s = ed.settings;
  const [snap, setSnap] = React.useState(0);
  const [rsnap, setRsnap] = React.useState(0);
  const [ground, setGround] = React.useState(false);
  const snapping = snap > 0 || rsnap > 0 || ground;
  const stage = d.kmp.STGI[0];
  const stageSelected = stage && d.selection.has(String(stage.uid));

  const setMoveSnap = (v: number) => { setSnap(v); vp.translationSnap = v; vp.updateGizmo(); };
  const setRotSnap = (v: number) => { setRsnap(v); vp.rotationSnap = v; vp.updateGizmo(); };
  const setGroundSnap = (v: boolean) => { setGround(v); vp.groundSnap = v; };

  return (
    <div className="flex h-12 shrink-0 items-center gap-2 overflow-x-auto border-b bg-sidebar px-2">
      {/* History */}
      <div className="flex items-center" data-group="history">
        <IconButton tipKey="undo" disabled={!d.undoStack.length} onClick={() => ed.cmd("undo")}
          text={d.undoStack.length ? `Undo "${d.undoStack[d.undoStack.length - 1].label}".` : "Nothing to undo yet."}><Undo2 /></IconButton>
        <IconButton tipKey="redo" disabled={!d.redoStack.length} onClick={() => ed.cmd("redo")}
          text={d.redoStack.length ? `Redo "${d.redoStack[d.redoStack.length - 1].label}".` : "Nothing to redo."}><Redo2 /></IconButton>
      </div>
      <Separator orientation="vertical" className="h-6" />

      {/* Transform tools + snapping */}
      {!ed.map2D && <Cluster id="transform">
        <ToggleGroup type="single" value={ed.mode} onValueChange={(v) => v && vp?.setMode(v)} className="gap-0.5 bg-transparent p-0">
          {([["translate", Move, "Move"], ["rotate", RotateCw, "Rotate"], ["scale", Scale3d, "Scale"]] as const).map(([v, Icon, label]) => (
            <Hint key={v} wrap {...tip(v)}>
              <ToggleGroupItem value={v} aria-label={label} className="h-7 gap-1.5 px-2.5 text-xs">
                <Icon /> {label}
              </ToggleGroupItem>
            </Hint>
          ))}
        </ToggleGroup>
        <Separator orientation="vertical" className="mx-0.5 h-5" />
        <DropdownMenu>
          <Hint wrap title="Snapping" text="Move and rotate in exact steps, and keep things on the ground while moving them.">
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className={cn("h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground", snapping && "bg-background text-foreground shadow-sm")}>
                <Magnet className={cn(snapping && "text-sky-400")} />
                {snapping ? [snap && `${snap}`, rsnap && `${rsnap}°`, ground && "ground"].filter(Boolean).join(" · ") : "Snap"}
                <ChevronDown className="!size-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
          </Hint>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>Move step</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={String(snap)} onValueChange={(v) => setMoveSnap(Number(v))}>
              {MOVE_STEPS.map((v) => <DropdownMenuRadioItem key={v} value={String(v)}>{v ? `${v} units` : "Free"}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Rotation step</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={String(rsnap)} onValueChange={(v) => setRotSnap(Number(v))}>
              {ROT_STEPS.map((v) => <DropdownMenuRadioItem key={v} value={String(v)}>{v ? `${v}°` : "Free"}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={ground} onCheckedChange={(v) => setGroundSnap(!!v)}>
              <ArrowDownToLine /> Stick to ground
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Cluster>}

      {/* Create */}
      <div className="flex items-center gap-1" data-group="create">
        <DropdownMenu>
          <Hint wrap {...tip("add")}>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-8 gap-1.5 border border-border/70 bg-muted/40 pl-2 pr-1.5 text-xs font-medium hover:bg-accent data-[state=open]:bg-accent">
                <Plus className="text-primary" /> Add <ChevronDown className="!size-3 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
          </Hint>
          <DropdownMenuContent align="start" className="w-60">
            <AddMenuItems Item={DropdownMenuItem} Separator={DropdownMenuSeparator} />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex-1" />

      {/* View */}
      <div className="flex shrink-0 items-center rounded-lg border bg-muted/40 p-0.5" role="group" aria-label="Editor view" data-group="editor-view">
        <Button variant={ed.map2D ? "ghost" : "secondary"} size="sm" className="h-7 gap-1.5 px-2.5 text-xs" aria-label="3D view" aria-pressed={!ed.map2D}
          onClick={() => ed.setMap2D(false)}><Box className="size-3.5" /> 3D</Button>
        <Button variant={ed.map2D ? "secondary" : "ghost"} size="sm" className="h-7 gap-1.5 px-2.5 text-xs" aria-label="2D editor" aria-pressed={ed.map2D}
          onClick={() => ed.setMap2D(true)}><Map className="size-3.5" /> 2D</Button>
      </div>
      {!ed.map2D && <Cluster id="view">
        <Hint wrap {...tip("display")}>
          <ToggleGroup type="single" value={s.displayMode} onValueChange={(v: any) => v && ed.setSetting("displayMode", v)} className="gap-0.5 bg-transparent p-0">
            {([["auto", Sparkles, "Auto"], ["visual", Mountain, "Model"], ["collision", BrickWall, "Collision"], ["both", Layers, "Both"]] as const).map(([v, Icon, label]) => (
              <ToggleGroupItem key={v} value={v} aria-label={label} className="h-7 gap-1.5 px-2 text-xs">
                <Icon /> <span className="hidden xl:inline">{label}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Hint>
        <Separator orientation="vertical" className="mx-0.5 h-5" />
        <Hint wrap {...tip("anim")} text={`${s.animations ? "Playing" : "Paused"}. ${(TOOL_HELP as any).anim[1]}`}>
          <Toggle size="sm" pressed={s.animations} onPressedChange={(v) => ed.setSetting("animations", v)} aria-label="Animations"
            className="h-7 px-2 data-[state=on]:bg-background data-[state=on]:text-emerald-400 data-[state=on]:shadow-sm">
            {s.animations ? <Pause /> : <Play />}
          </Toggle>
        </Hint>
        <Hint {...tip("top")}><Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-foreground" onClick={() => vp?.topView()}><ScanSearch /></Button></Hint>
        <Hint {...tip("frame")}><Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-foreground" onClick={() => vp?.frameAll()}><Maximize2 /></Button></Hint>
      </Cluster>}

      <Separator orientation="vertical" className="h-6" />

      {/* Track + file */}
      <div className="flex items-center gap-1" data-group="file">
        {stage && (
          <Hint title="Track settings" text="Laps, starting grid, lens flare and speed of this track. Opens them in the Inspector.">
            <Button variant="ghost" size="sm" onClick={() => ed.cmd("stageSettings")} id="track-settings-button"
              className={cn("h-8 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-foreground", stageSelected && "bg-accent text-foreground")}>
              <Flag /> Track settings
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-foreground">{stage.laps} laps</span>
            </Button>
          </Hint>
        )}
        <IconButton tipKey="help" onClick={() => ed.cmd("help")}><CircleHelp /></IconButton>
        <Hint title="Settings" text="3D view, camera, editing and game file options. Changes are saved automatically." shortcut="Ctrl+,">
          <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-foreground" onClick={() => ed.cmd("settingsDialog")} aria-label="Settings"><Settings /></Button>
        </Hint>
        <Hint {...tip("save")}>
          <Button size="sm" variant="secondary" className="relative h-8 gap-1.5 px-3" onClick={() => ed.cmd("save")}>
            <Save /> Save
            {d.dirty && <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-sky-400 ring-2 ring-sidebar" />}
          </Button>
        </Hint>
      </div>
    </div>
  );
}
