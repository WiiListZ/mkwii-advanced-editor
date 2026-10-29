import * as React from "react";
import {
  ArrowDownToLine, ArrowRight, BrickWall, ChevronRight, ClipboardPaste, Compass, Copy, Crosshair, ImagePlus, Lightbulb, MoveHorizontal, Paintbrush, Plus, Settings2, StretchHorizontal, Trash2, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { AREA_TYPES, AREA_SHAPES, CAMERA_TYPES, CHECKPOINT_TYPE_LABEL } from "../../../js/data/defs.js";
import { AREA_TYPE_HELP, KIND_HELP, fieldHelp } from "../../../js/data/help.js";
import { settingDisplayValue, settingGuidance, settingStoredValue } from "../../../js/data/object-documentation.js";
import { findFile } from "../../../js/formats/u8.js";
import { useEditor } from "../hooks";
import { editor, hex, KIND_LABEL, SECTION_LABEL } from "../editor";
import { Hint, InfoTip, KIND_COLOR, KIND_ICON } from "../common";
import { TexturePainter } from "./TexturePainter";
import { CameraTools } from "./CamerasPanel";
import { ObjectAppearance } from "./ObjectAppearance";
import { decodeTexture } from "../../../js/formats/brres.js";
import { dialogs } from "../dialogs-store";
import { replaceBRRESTexture } from "../../../js/formats/brres.js";
import { cn } from "@/lib/utils";

type Field = { key: string; label: string; type: string; step?: number; min?: number; max?: number; options?: string[]; list?: string; none?: number | null; noneLabel?: string; hint?: string };

const pos: Field = { key: "pos", label: "Position", type: "vec3" };
const rot: Field = { key: "rot", label: "Rotation (°)", type: "vec3", step: 1 };
const scale: Field = { key: "scale", label: "Scale", type: "vec3", step: 0.1 };
const int = (key: string, label: string, min?: number, max?: number): Field => ({ key, label, type: "int", min, max });
const ref = (key: string, label: string, list: string, none: number | null, noneLabel = "None"): Field => ({ key, label, type: "ref", list, none, noneLabel });

const SCHEMA: Record<string, Field[]> = {
  KTPT: [pos, rot, int("playerIndex", "Player index", -1, 11)],
  ENPT: [pos, { key: "width", label: "Width", type: "float" }, int("setting1", "Setting 1", 0, 65535), int("setting2", "Setting 2", 0, 255), int("setting3", "Setting 3", 0, 255)],
  ITPT: [pos, { key: "width", label: "Width", type: "float" }, int("setting1", "Setting 1", 0, 65535), int("setting2", "Setting 2", 0, 65535)],
  CKPT: [{ key: "left", label: "Left (X, Z)", type: "vec2" }, { key: "right", label: "Right (X, Z)", type: "vec2" }, { key: "type", label: "Type", type: "cktype" }, ref("respawn", "Respawn", "JGPT", null)],
  GOBJ: [{ key: "objectId", label: "Object", type: "object" }, pos, rot, scale, ref("route", "Route", "POTI", 0xffff), { key: "settings", label: "Settings 1-8", type: "array8" }, { key: "presence", label: "Present in", type: "presence" }],
  POTI: [pos, int("setting1", "Speed / setting 1", 0, 65535), int("setting2", "Setting 2", 0, 65535)],
  AREA: [{ key: "shape", label: "Shape", type: "select", options: AREA_SHAPES }, { key: "type", label: "Type", type: "select", options: AREA_TYPES }, pos, rot, scale,
    ref("camera", "Camera", "CAME", 0xff), int("priority", "Priority", 0, 255), int("setting1", "Setting 1", 0, 65535), int("setting2", "Setting 2", 0, 65535),
    ref("route", "Route", "POTI", 0xff), int("enemyPoint", "Enemy point", 0, 255)],
  CAME: [{ key: "type", label: "Type", type: "select", options: CAMERA_TYPES }, ref("next", "Next camera", "CAME", 0xff), ref("route", "Route", "POTI", 0xff), pos, rot,
    { key: "viewStart", label: "Look-at start", type: "vec3" }, { key: "viewEnd", label: "Look-at end", type: "vec3" },
    { key: "zoomStart", label: "Zoom start (FOV)", type: "float" }, { key: "zoomEnd", label: "Zoom end (FOV)", type: "float" },
    { key: "time", label: "Duration (frames)", type: "float" }, int("shake", "Shake", 0, 255), int("pointSpeed", "Route speed", 0, 65535),
    int("zoomSpeed", "Zoom speed", 0, 65535), int("viewSpeed", "Look-at speed", 0, 65535), int("start", "Start flag", 0, 255), int("movie", "Movie flag", 0, 255)],
  JGPT: [pos, rot, int("id", "ID", 0, 65535), int("range", "Range", -32768, 32767)],
  CNPT: [pos, rot, int("id", "ID", 0, 65535), { key: "effect", label: "Shot type", type: "select", options: ["Straight", "Curved", "Curved (slow)"] }],
  MSPT: [pos, rot, int("id", "ID", 0, 65535), int("unknown", "Unknown", 0, 65535)],
  STGI: [int("laps", "Laps", 1, 9), { key: "pole", label: "Pole position", type: "select", options: ["Left", "Right"] },
    { key: "distance", label: "Start grid", type: "select", options: ["Normal", "Close together"] },
    { key: "flareFlash", label: "Lens flare flash", type: "bool" }, { key: "flareColor", label: "Lens flare color", type: "color" },
    { key: "speedMod", label: "Speed multiplier", type: "speed" }],
};

const f32FromHigh16 = (v: number) => { if (!v) return 1; const b = new DataView(new ArrayBuffer(4)); b.setUint16(0, v); return b.getFloat32(0); };
const high16FromF32 = (f: number) => { if (f === 1) return 0; const b = new DataView(new ArrayBuffer(4)); b.setFloat32(0, f); return b.getUint16(0); };
const fmt = (n: number, int: boolean) => (int ? String(n) : String(Number(n.toFixed(3))));

// ---- Building blocks -------------------------------------------------------------------------

// Number input that commits on Enter/blur and stays in sync with live edits.
function NumberInput({ value, onCommit, int, min, max, className }: { value: number; onCommit: (v: number) => void; int?: boolean; min?: number; max?: number; className?: string }) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    let v = Number(draft.replace(",", "."));
    setDraft(null);
    if (!Number.isFinite(v)) return;
    if (int) v = Math.round(v);
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    if (v !== value) onCommit(v);
  };
  return (
    <input
      className={cn("h-7 w-full min-w-0 bg-transparent px-1.5 text-[12.5px] tabular-nums outline-none", className)}
      value={draft ?? fmt(value ?? 0, !!int)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setDraft(null); (e.target as HTMLInputElement).blur(); } }}
    />
  );
}

// A number box with a draggable label on the left (drag left/right to change the value).
function ScrubNumber({ label, color, value, onLive, onCommit, step = 1, int, min, max }: {
  label: React.ReactNode; color?: string; value: number; onLive: (v: number) => void; onCommit: (v: number) => void; step?: number; int?: boolean; min?: number; max?: number;
}) {
  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const start = value ?? 0, x0 = e.clientX;
    editor.doc.beginEdit();
    const move = (ev: PointerEvent) => {
      const mult = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
      const base = Math.abs(step) >= 1 && Math.abs(start) > 1000 ? 10 : 1;
      let v = start + (ev.clientX - x0) * step * mult * base;
      v = int ? Math.round(v) : Math.round(v * 1000) / 1000;
      if (min !== undefined) v = Math.max(min, v);
      if (max !== undefined) v = Math.min(max, v);
      onLive(v);
      editor.doc.live();
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      editor.doc.endEdit("Edit value");
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };
  return (
    <div className="flex h-7 min-w-0 flex-1 items-center overflow-hidden rounded-md border border-input bg-black/20 focus-within:ring-2 focus-within:ring-ring">
      <Hint title="Drag to change" text="Drag left or right to change the value. Hold Shift for big steps, Alt for small steps.">
        <span onPointerDown={onPointerDown} className={cn("flex h-full cursor-ew-resize select-none items-center border-r bg-muted px-1.5 text-[10px] font-bold hover:bg-accent", color)}>
          {label}
        </span>
      </Hint>
      <NumberInput value={value} onCommit={onCommit} int={int} min={min} max={max} />
    </div>
  );
}

// One object setting (1–8): a value box with the documented limits, or the documented choices in a
// list ("Other value…" types any number inside the limits when the documentation allows it).
function SettingValue({ index, raw, setting, onLive, onCommit }: {
  index: number; raw: number; setting: any; onLive: (v: number) => void; onCommit: (v: number) => void;
}) {
  const g = settingGuidance(setting);
  const value = settingDisplayValue(raw, setting);
  const listed = g.options.some(([v]: any) => v === value);
  const [other, setOther] = React.useState(false);
  const live = (v: number) => onLive(settingStoredValue(v));
  const commit = (v: number) => onCommit(settingStoredValue(v));
  const box = <ScrubNumber label={index} value={value} int min={g.min} max={g.max} onLive={live} onCommit={commit} />;
  if (!g.options.length) return <div className="w-28 shrink-0">{box}</div>;
  const typing = other || !listed;
  return (
    <div className="flex w-full flex-col gap-1">
      <Select value={typing ? "other" : String(value)} onValueChange={(v) => {
        if (v === "other") { setOther(true); return; }
        setOther(false);
        commit(Number(v));
      }}>
        <SelectTrigger className="h-7 text-xs" aria-label={`Setting ${index}`}><SelectValue /></SelectTrigger>
        <SelectContent>
          {g.options.map(([v, label]: any) => <SelectItem key={v} value={String(v)}>{label} <span className="text-muted-foreground">({v})</span></SelectItem>)}
          {(g.otherValues || !listed) && <SelectItem value="other">{listed || other ? "Other value…" : `${value} (not in the list)`}</SelectItem>}
        </SelectContent>
      </Select>
      {typing && (g.otherValues || !listed) && box}
    </div>
  );
}

function FieldRow({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  const ed = useEditor("settings");
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
        {help && <InfoTip title={label} text={help} />}
      </div>
      {children}
      {help && ed.settings.showDescriptions && <p className="text-[11px] leading-relaxed text-muted-foreground/80">{help}</p>}
    </div>
  );
}

const AXIS_COLOR = ["text-red-400", "text-green-400", "text-blue-400"];

// ---- Inspector ------------------------------------------------------------------------------

export function Inspector() {
  const ed = useEditor("selection", "doc", "live", "settings", "ui");
  const d = ed.doc;
  const infos = d.selectedInfos();

  if (ed.geometrySelection?.type === "model") {
    const parts = ed.geometrySelection.pieces || [ed.geometrySelection];
    if (parts.length + infos.length > 1) return <div className="flex flex-col gap-3 p-4">
      <div className="text-sm font-semibold">{parts.length} track model part{parts.length === 1 ? "" : "s"}{infos.length ? ` and ${infos.length} track item${infos.length === 1 ? "" : "s"}` : ""} selected</div>
      <p className="text-xs text-muted-foreground">Move, rotate or scale the selection together. Shift adds parts and Ctrl toggles them. Drag a box in the 3D view to select several items.</p>
      <Button size="sm" variant="secondary" onClick={() => ed.generateCollisionForSelection()}><BrickWall /> Generate collision…</Button>
      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => ed.cmd("delete")}><Trash2 /> Delete selected parts</Button>
    </div>;
    return <ModelInspector key={`${ed.geometrySelection.partIndex}:${ed.geometrySelection.pieceIndex}`} />;
  }
  const animation = ed.selectedAnimation && !infos.length ? ed.courseAnimations().find((a: any) => a.name === ed.selectedAnimation) : null;
  if (animation) return <AnimationInspector animation={animation} />;

  if (!infos.length) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <div>
          <div className="text-sm font-semibold">Nothing selected</div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Select something in the 2D map, 3D view or Track list to edit it here.</p>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
          <dt className="text-foreground">Click</dt><dd>select</dd>
          <dt className="text-foreground">Shift / Ctrl</dt><dd>add / toggle</dd>
          {ed.map2D ? <>
            <dt className="text-foreground">Drag a point</dt><dd>move it in the map</dd>
            <dt className="text-foreground">Drag empty space</dt><dd>pan the map</dd>
            <dt className="text-foreground">Wheel</dt><dd>zoom the map</dd>
            <dt className="text-foreground">White handle</dt><dd>drag to rotate (Q / E: 15°)</dd>
            <dt className="text-foreground">Ctrl+C / Ctrl+V</dt><dd>copy, paste at the mouse</dd>
            <dt className="text-foreground">Ctrl+D</dt><dd>duplicate</dd>
          </> : <>
            <dt className="text-foreground">Drag on empty space</dt><dd>box select</dd>
            <dt className="text-foreground">Double-click</dt><dd>focus</dd>
          </>}
        </dl>
        <Button size="sm" variant="secondary" className="self-start" onClick={() => ed.cmd("stageSettings")}>
          <Settings2 /> Track settings (laps, start…)
        </Button>
      </div>
    );
  }

  const primary = d.primary || infos[0];
  const sameKind = infos.every((i: any) => i.kind === primary.kind && i.section === primary.section);
  const kh = (KIND_HELP as any)[primary.kind];
  const Icon = KIND_ICON[primary.kind === "GROUP" ? primary.section : primary.kind] || Settings2;
  const color = KIND_COLOR[primary.kind === "GROUP" ? primary.section : primary.kind];

  const title = infos.length > 1 ? `${infos.length} selected` : titleFor(primary);
  const hasPos = infos.some((i: any) => i.item.pos || i.kind === "GROUP" || i.kind === "ROUTE" || i.kind === "CKPT");
  const hasRot = infos.some((i: any) => i.item.rot);

  return (
    <div className="flex flex-col gap-4 p-4" key={primary.key}>
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <Icon className="size-3.5 shrink-0 translate-y-0.5" style={{ color }} />
          <div className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</div>
          <span className="shrink-0 text-[11px] text-muted-foreground">{kh?.title || primary.kind}</span>
        </div>
        {infos.length > 1 && (
          <p className="border-l-2 pl-2 text-[11px] leading-relaxed text-muted-foreground">
            {sameKind ? "Edits apply to all of them. Position applies to the last one." : "Mixed selection: showing the last one."}
          </p>
        )}
        {kh && ed.settings.showDescriptions && <p className="text-xs leading-relaxed text-muted-foreground">{kh.what}</p>}
        {primary.kind === "AREA" && <AreaTypeInfo type={primary.item.type} />}
        {primary.kind === "CAME" && infos.length === 1 && <CameraTools index={primary.index} />}
        {kh?.tips?.length > 0 && (
          <Collapsible className="rounded-md border bg-muted/40">
            <CollapsibleTrigger className="group flex w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-xs font-medium">
              <Lightbulb className="size-3.5 text-warning" /> Tips
              <ChevronRight className="ml-auto size-3.5 transition-transform group-data-[state=open]:rotate-90" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="list-disc space-y-1 px-2.5 pb-2.5 pl-6 text-xs leading-relaxed text-muted-foreground">
                {kh.tips.map((t: string, i: number) => <li key={i}>{t}</li>)}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {hasPos && <Hint title="Snap to ground" text="Place the selection on the surface below it." shortcut="G"><Button size="sm" variant="secondary" onClick={() => ed.cmd("snapGround")}><ArrowDownToLine /> Ground</Button></Hint>}
        {hasRot && <Hint title="Align to route" text="Turn to face along the nearest enemy route."><Button size="sm" variant="secondary" onClick={() => ed.cmd("alignRoute")}><Compass /> Align</Button></Hint>}
        {infos.length >= 3 && <Hint title="Distribute" text="Space the selected points evenly between the first and the last."><Button size="sm" variant="secondary" onClick={() => ed.cmd("distribute")}><StretchHorizontal /> Distribute</Button></Hint>}
        <Hint title="Duplicate" text="Copy the selection next to the original." shortcut="Ctrl+D"><Button size="sm" variant="secondary" onClick={() => ed.cmd("duplicate")}><Copy /> Duplicate</Button></Hint>
        <Hint title="Focus" text="Move the camera to the selection." shortcut="F"><Button size="sm" variant="secondary" onClick={() => ed.viewport.focusSelection()}><Crosshair /> Focus</Button></Hint>
        {infos.some((info: any) => info.kind === "GOBJ") && <Hint title="Generate collision" text={infos.length > 1 ? "Add static collision for the models of the selected objects to the course KCL. It will not move with them." : "Add a static copy of this object's model to the course KCL. It will not move with the object."}><Button size="sm" variant="secondary" disabled={!d.szs} onClick={() => ed.generateCollisionForSelection()}><BrickWall /> Generate collision…</Button></Hint>}
        <Hint title="Delete" text="Remove the selection. Indices that pointed to it are updated." shortcut="Ctrl+X"><Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => ed.cmd("delete")}><Trash2 /> Delete</Button></Hint>
      </div>
      <Separator />

      {primary.kind === "GROUP" ? <GroupEditor info={primary} />
        : primary.kind === "ROUTE" ? <RouteEditor info={primary} />
        : (
          <div className="flex flex-col gap-4">
            {(SCHEMA[primary.kind] || [])
              .filter((f) => !(primary.kind === "CKPT" && primary.side) || f.key === (primary.side === "L" ? "left" : "right"))
              .map((f) => <FieldEditor key={f.key} info={primary} f={f} bulk={sameKind} />)}
            {primary.kind === "GOBJ" && infos.length === 1 && <ObjectAppearance objectId={primary.item.objectId} />}
            {/* A route's own settings, also reachable from one of its points (clicking in the 3D view selects a point). */}
            {primary.kind === "POTI" && primary.route && <>
              <Separator />
              <div className="flex items-center justify-between gap-2">
                <div className="text-[13px] font-semibold">Route {primary.routeIndex}</div>
                <Button size="sm" variant="secondary" onClick={() => d.select([String(primary.route.uid)])}>Select whole route</Button>
              </div>
              <RouteSettings route={primary.route} />
            </>}
          </div>
        )}
    </div>
  );
}

// Track settings (STGI) fields on their own, for the Track settings dialog.
export function TrackSettingsEditor() {
  const ed = useEditor("doc", "live", "settings");
  const stage = ed.doc.kmp.STGI[0];
  const info = stage && ed.doc.resolve(String(stage.uid));
  if (!info) return <p className="text-xs text-muted-foreground">This track has no track settings (STGI).</p>;
  return (
    <div className="flex flex-col gap-4">
      {SCHEMA.STGI.map((f) => <FieldEditor key={f.key} info={info} f={f} bulk={false} />)}
      <div className="flex items-center justify-between gap-2 border-t pt-3 text-[11px] text-muted-foreground">
        The track's name in menus is game text (Scene/UI, Common.bmg).
        <Button size="sm" variant="secondary" className="shrink-0" onClick={() => ed.cmd("trackNameText")}>Track name…</Button>
      </div>
    </div>
  );
}

// CHR0 animation of the track model: playback, frame, loop and delete.
function AnimationInspector({ animation }: { animation: any }) {
  const ed = useEditor("doc", "ui", "settings");
  const [frame, setFrame] = React.useState(0);
  const playing = ed.settings.animations;
  React.useEffect(() => {
    if (!playing) return;
    let id = 0;
    const tick = () => { const t = ed.viewport?.animTime ?? 0; setFrame(Math.floor((t * 60) % Math.max(1, animation.frames))); id = requestAnimationFrame(tick); };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing, animation.frames]);
  const bones = [...animation.bones.keys()];
  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <div className="flex items-baseline gap-2">
          <div className="min-w-0 flex-1 truncate text-sm font-semibold">{animation.name}</div>
          <span className="shrink-0 text-[11px] text-muted-foreground">Animation</span>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Bone animation (CHR0) inside course_model.brres. Mario Kart Wii plays every animation of the track model on its own, looping from about 7 seconds before the start.</p>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant={playing ? "secondary" : "default"} onClick={() => ed.setSetting("animations", !playing)}>{playing ? "Pause" : "Play"}</Button>
        <span className="text-xs tabular-nums text-muted-foreground">Frame {frame} / {animation.frames} · {(animation.frames / 60).toFixed(2)} s</span>
      </div>
      <input aria-label="Animation frame" type="range" min={0} max={animation.frames} value={frame} className="w-full accent-primary"
        onChange={(e) => { const f = Number(e.target.value); setFrame(f); ed.showAnimationFrame(f); }} />
      <FieldRow label="Loop" help="Looping animations start again when they end; otherwise the animation plays once and stops on its last frame.">
        <Switch checked={animation.loop} onCheckedChange={(v) => ed.setAnimationLoop(animation.name, v)} />
      </FieldRow>
      <FieldRow label={`Bones (${bones.length})`}>
        <div className="max-h-40 overflow-y-auto rounded-md border bg-muted/20 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">{bones.map((b) => <div key={b} className="truncate">{b}</div>)}</div>
      </FieldRow>
      <Button size="sm" variant="ghost" className="self-start text-destructive hover:text-destructive" onClick={() => ed.deleteAnimation(animation.name)}><Trash2 /> Delete animation</Button>
    </div>
  );
}

function AreaTypeInfo({ type }: { type: number }) {
  const help = AREA_TYPE_HELP[type];
  return (
    <div data-area-type-info className="space-y-1.5 rounded-md border border-sky-500/30 bg-sky-500/10 p-2.5 text-xs leading-relaxed">
      <div className="font-semibold text-sky-300">Type {type}: {AREA_TYPES[type] || "Unknown area"}</div>
      {help ? <>
        <p><span className="font-semibold text-foreground">What it does: </span><span className="text-muted-foreground">{help.what}</span></p>
        <p><span className="font-semibold text-foreground">When to use it: </span><span className="text-muted-foreground">{help.use}</span></p>
        {help.settings && <p><span className="font-semibold text-foreground">Relevant fields: </span><span className="text-muted-foreground">{help.settings}</span></p>}
      </> : <p className="text-muted-foreground">This AREA type has no documented behaviour.</p>}
    </div>
  );
}

// Small preview of a TEX0 image.
function TextureThumbnail({ texture }: { texture: any }) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    try {
      el.width = texture.width; el.height = texture.height;
      el.getContext("2d")!.putImageData(new ImageData(Uint8ClampedArray.from(decodeTexture(texture)), texture.width, texture.height), 0, 0);
    } catch { /* unsupported format: no preview */ }
  }, [texture]);
  return (
    <div className="flex max-h-40 justify-center overflow-hidden rounded border" style={{ background: "repeating-conic-gradient(#505057 0% 25%, #414148 0% 50%) 0 0 / 16px 16px" }}>
      <canvas ref={ref} className="max-h-40 max-w-full object-contain" style={{ imageRendering: "pixelated" }} />
    </div>
  );
}

// Texture painter in a large dialog (the Inspector only shows a preview).
export function TextureEditorDialog({ name, close }: { name: string; close: (v: any) => void }) {
  const ed = useEditor("doc");
  const bytes = ed.doc.szs && findFile(ed.doc.szs, "course_model.brres")?.data;
  const [dirty, setDirty] = React.useState(false);
  const staged = React.useMemo(() => ({
    encode: (data: Uint8Array, pixels: Uint8ClampedArray) => replaceBRRESTexture(data, name, pixels),
    save: (data: Uint8Array) => editor.saveCourseModelBytes(name, data),
  }), [name]);
  const requestClose = async () => {
    if (dirty && !(await dialogs.confirm({ title: "Unsaved texture", description: "The painted strokes have not been saved. Close and discard them?", confirmLabel: "Discard strokes", destructive: true }))) return;
    close(true);
  };
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Texture · {name}</div>
          <p className="m-0 text-xs text-muted-foreground">Every model part using this texture changes too. Save texture applies the strokes to the track.</p>
        </div>
        <Button size="sm" onClick={requestClose}>Done</Button>
      </div>
      {bytes ? <TexturePainter key={name} name={name} bytes={bytes} tall staged={staged} onDirtyChange={setDirty} /> : <p className="text-xs text-muted-foreground">The track model is not available.</p>}
    </div>
  );
}

function ModelInspector() {
  const ed = useEditor("ui", "doc", "settings");
  const selected = ed.geometrySelection;
  const textures = ed.selectedModelTextures();
  const [texture, setTexture] = React.useState(textures[0]?.name || "");
  const chosen = textures.find((t: any) => t.name === texture);
  const supported = chosen && [0, 1, 2, 3, 4, 5, 6, 14].includes(chosen.format);
  const modelBytes = ed.doc.szs && findFile(ed.doc.szs, "course_model.brres")?.data;
  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <div className="flex items-baseline gap-2">
          <div className="min-w-0 flex-1 truncate text-sm font-semibold">{selected.name}</div>
          <span className="shrink-0 text-[11px] text-muted-foreground">Track model</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Use Move, Rotate or Scale in the toolbar. Save the SZS to keep the change.</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="secondary" onClick={() => ed.cmd("copy")}><Copy /> Copy</Button>
        <Button size="sm" variant="secondary" onClick={() => ed.cmd("paste")} disabled={!ed.modelClipboard}><ClipboardPaste /> Paste</Button>
        <Button size="sm" variant="secondary" onClick={() => ed.cmd("duplicate")}><Plus /> Duplicate</Button>
        <Button size="sm" variant="secondary" disabled={!ed.doc.szs} onClick={() => ed.generateCollisionForSelection()} title="Generate course KCL from this selected model part"><BrickWall /> Generate collision…</Button>
        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => ed.cmd("delete")}><Trash2 /> Delete</Button>
      </div>
      <Separator />
      <div className="space-y-2">
        <div className="text-xs font-semibold">Texture</div>
        {textures.length ? <>
          <p className="text-[11px] text-muted-foreground">Choose a texture used by this model part, then paint directly on it.</p>
          <Select value={texture} onValueChange={setTexture}>
            <SelectTrigger className="w-full text-xs" aria-label="Texture to edit"><SelectValue placeholder="Choose texture" /></SelectTrigger>
            <SelectContent>{textures.map((t: any) => <SelectItem key={t.name} value={t.name}>{t.name} · {t.width}×{t.height}</SelectItem>)}</SelectContent>
          </Select>
          {!supported && <p className="text-[11px] text-amber-400">This indexed texture format cannot be replaced with PNG yet.</p>}
          {chosen && <TextureThumbnail texture={chosen} />}
          <Button size="sm" disabled={!supported || !modelBytes} onClick={() => dialogs.open("textureEditor", { name: texture })}><Paintbrush /> Edit texture…</Button>
          <Button size="sm" variant="secondary" disabled={!supported} onClick={() => ed.replaceSelectedTexture(texture)}><ImagePlus /> Replace entire texture with PNG…</Button>
          <p className="text-[11px] leading-relaxed text-muted-foreground">Replacing fits the PNG to this texture. All model parts sharing it will change.</p>
        </> : <p className="text-xs text-muted-foreground">This model part has no texture layer.</p>}
      </div>
    </div>
  );
}

function titleFor(info: any) {
  const ed = editor;
  if (info.kind === "GROUP") return `${SECTION_LABEL[info.section]} › group ${info.index}`;
  if (info.kind === "ROUTE") return `Route ${info.index}`;
  if (info.kind === "STGI") return "Track settings";
  if (info.kind === "GOBJ") return `${ed.objectLabel(info.item.objectId)} #${info.index}`;
  if (info.group) return `${KIND_LABEL[info.kind]} ${info.groupIndex}.${info.index}${info.side ? (info.side === "L" ? " (left)" : " (right)") : ""}`;
  if (info.route) return `Route ${info.routeIndex} › point ${info.index}`;
  return `${KIND_LABEL[info.kind]} #${info.index}`;
}

function commit(info: any, key: string, value: any, bulk: boolean, label?: string) {
  const d = editor.doc;
  d.change(label || `Edit ${key}`, () => {
    const targets = bulk && !Array.isArray(value) ? d.selectedInfos().filter((i: any) => i.kind === info.kind) : [info];
    for (const t of targets) t.item[key] = Array.isArray(value) ? [...value] : value;
  }, { structural: ["type", "objectId", "shape"].includes(key) });
}

function FieldEditor({ info, f, bulk }: { info: any; f: Field; bulk: boolean }) {
  const ed = editor, d = ed.doc, it = info.item, k = d.kmp;
  const help = fieldHelp(info.kind, f.key) || f.hint;
  const setIndex = (idx: number) => (v: number) => { const arr = [...it[f.key]]; arr[idx] = v; commit(info, f.key, arr, false); };
  const liveIndex = (idx: number) => (v: number) => { it[f.key] = [...it[f.key]]; it[f.key][idx] = v; };

  let control: React.ReactNode = null;
  switch (f.type) {
    case "vec3":
    case "vec2": {
      const names = f.type === "vec3" ? ["X", "Y", "Z"] : ["X", "Z"];
      control = (
        <div className="flex gap-1">
          {names.map((n, i) => (
            <ScrubNumber key={n} label={n} color={AXIS_COLOR[f.type === "vec3" ? i : i * 2]} value={it[f.key][i]} step={f.step ?? 10} onLive={liveIndex(i)} onCommit={setIndex(i)} />
          ))}
        </div>
      );
      break;
    }
    case "int":
    case "float":
      control = <ScrubNumber label={<MoveHorizontal className="size-3" />} value={it[f.key]} int={f.type === "int"} min={f.min} max={f.max} step={f.type === "int" ? 1 : 0.1}
        onLive={(v) => (it[f.key] = v)} onCommit={(v) => commit(info, f.key, v, bulk)} />;
      break;
    case "bool":
      control = <Switch checked={!!it[f.key]} onCheckedChange={(v) => commit(info, f.key, v ? 1 : 0, bulk)} />;
      break;
    case "select":
      control = (
        <Select value={String(it[f.key])} onValueChange={(v) => commit(info, f.key, Number(v), bulk)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {f.options!.map((o, i) => <SelectItem key={i} value={String(i)}>{o}</SelectItem>)}
            {it[f.key] >= f.options!.length && <SelectItem value={String(it[f.key])}>{`${it[f.key]} (unknown)`}</SelectItem>}
          </SelectContent>
        </Select>
      );
      break;
    case "ref": {
      const list = k[f.list!];
      const val = it[f.key];
      const name = f.list === "POTI" ? "Route" : KIND_LABEL[f.list!];
      control = (
        <div className="flex gap-1">
          <Select value={String(val)} onValueChange={(v) => commit(info, f.key, Number(v), bulk)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {f.none !== null && <SelectItem value={String(f.none)}>{f.noneLabel}</SelectItem>}
              {list.map((_: any, i: number) => <SelectItem key={i} value={String(i)}>{`${name} ${i}`}</SelectItem>)}
              {val !== f.none && val >= list.length && <SelectItem value={String(val)}>{`${val} (missing!)`}</SelectItem>}
            </SelectContent>
          </Select>
          <Hint title="Go to" text={`Select the linked ${name.toLowerCase()}.`}>
            <Button variant="outline" size="icon" disabled={!list[val]} onClick={() => list[val] && d.select(list[val].uid)}><ArrowRight /></Button>
          </Hint>
        </div>
      );
      break;
    }
    case "cktype":
      control = (
        <Select value={String(it.type)} onValueChange={(v) => commit(info, "type", Number(v), bulk)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="255">Normal</SelectItem>
            <SelectItem value="0">Lap checkpoint (finish line)</SelectItem>
            {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => <SelectItem key={n} value={String(n)}>{`Key checkpoint ${n}`}</SelectItem>)}
            {it.type > 20 && it.type !== 255 && <SelectItem value={String(it.type)}>{CHECKPOINT_TYPE_LABEL(it.type)}</SelectItem>}
          </SelectContent>
        </Select>
      );
      break;
    case "object":
      const objectDoc = ed.getObjectDocumentation(it.objectId);
      control = (
        <div className="space-y-2 rounded-md border bg-muted/30 p-2" data-object-documentation>
          <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-primary">{ed.objectLabel(it.objectId)}</div>
            <div className="font-mono text-[11px] text-muted-foreground">{hex(it.objectId)} · {ed.objectNames[it.objectId] || "unknown"}</div>
          </div>
          <Button size="sm" variant="secondary" onClick={async () => { const id = await ed.pickObject(it.objectId); if (id != null) commit(info, "objectId", id, bulk, "Change object"); }}>Change…</Button>
          </div>
          {objectDoc.description && <p className="text-xs leading-relaxed text-muted-foreground">{objectDoc.description}</p>}
          {objectDoc.notes && <p className="border-l-2 border-amber-400/70 pl-2 text-[11px] leading-relaxed text-muted-foreground">{objectDoc.notes}</p>}
        </div>
      );
      break;
    case "array8": {
      const settingsDoc = ed.getObjectDocumentation(it.objectId).settings || {};
      control = (
        <div className="flex flex-col gap-1.5" data-object-settings>
          {Array.from({ length: 8 }, (_, i) => {
            const documented = settingsDoc[i + 1];
            const guidance = settingGuidance(documented);
            const value = <SettingValue index={i + 1} raw={it.settings[i]} setting={documented} onLive={liveIndex(i)} onCommit={setIndex(i)} />;
            return <div key={i} className="rounded-md border bg-muted/20 px-2 py-1.5">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 text-xs font-medium">{i + 1}. {documented?.label || `Setting ${i + 1}`}</span>
                {!guidance.options.length && value}
              </div>
              {guidance.options.length > 0 && <div className="mt-1">{value}</div>}
              {documented?.description && <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{documented.description}</p>}
              {guidance.values && <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground"><span className="text-foreground">Values:</span> {guidance.values}</p>}
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground"><span className="text-foreground">Limits:</span> {guidance.limits}</p>
            </div>;
          })}
        </div>
      );
      break;
    }
    case "presence":
      control = (
        <div className="flex flex-wrap gap-4">
          {[[1, "1 player"], [2, "2 players"], [4, "3-4 players"]].map(([b, l]) => (
            <label key={b} className="flex cursor-pointer items-center gap-2 text-[13px]">
              <Checkbox checked={!!(it.presence & (b as number))} onCheckedChange={(v) => commit(info, "presence", v ? it.presence | (b as number) : it.presence & ~(b as number), bulk)} /> {l}
            </label>
          ))}
        </div>
      );
      break;
    case "color": {
      const rgb = it.flareColor & 0xffffff, alpha = (it.flareColor >>> 24) & 0xff;
      control = (
        <div className="flex items-center gap-2">
          <input type="color" className="h-8 w-12 cursor-pointer rounded border bg-transparent" value={"#" + rgb.toString(16).padStart(6, "0")}
            onChange={(e) => commit(info, "flareColor", ((alpha << 24) | parseInt(e.target.value.slice(1), 16)) >>> 0, false)} />
          <ScrubNumber label="A" value={alpha} int min={0} max={255} onLive={(v) => (it.flareColor = (((v & 0xff) << 24) | rgb) >>> 0)} onCommit={(v) => commit(info, "flareColor", (((v & 0xff) << 24) | rgb) >>> 0, false)} />
        </div>
      );
      break;
    }
    case "speed":
      control = <ScrubNumber label="×" value={f32FromHigh16(it.speedMod)} step={0.01} min={0.1} max={5}
        onLive={(v) => (it.speedMod = high16FromF32(v))} onCommit={(v) => commit(info, "speedMod", high16FromF32(v), false)} />;
      break;
  }
  return <FieldRow label={f.label} help={help}>{control}</FieldRow>;
}

function GroupEditor({ info }: { info: any }) {
  const d = editor.doc, g = info.item, groups = d.kmp[info.section];
  const links = (key: "prev" | "next", label: string) => (
    <FieldRow label={label} help={fieldHelp("GROUP", key)}>
      <div className="flex flex-wrap items-center gap-1.5">
        {g[key].map((v: number, idx: number) => (
          <Badge key={idx} variant="secondary" className="gap-1 pr-0.5">
            Group {v}
            <button className="cursor-pointer rounded p-0.5 hover:bg-white/10" onClick={() => d.change("Edit links", () => { g[key].splice(idx, 1); })}><X /></button>
          </Badge>
        ))}
        {g[key].length < 6 && (
          <Select value="" onValueChange={(v) => d.change("Edit links", () => { const n = Number(v); if (!g[key].includes(n)) g[key].push(n); })}>
            <SelectTrigger className="h-6 w-auto gap-1 px-2 text-xs"><Plus className="size-3" /><SelectValue placeholder="Add link" /></SelectTrigger>
            <SelectContent>{groups.map((_: any, i: number) => <SelectItem key={i} value={String(i)}>{`Group ${i}`}</SelectItem>)}</SelectContent>
          </Select>
        )}
      </div>
    </FieldRow>
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="text-[13px]"><span className="text-muted-foreground">Points:</span> {g.points.length}</div>
      {links("prev", "Previous groups")}
      {links("next", "Next groups")}
      <FieldEditor info={info} f={int("setting1", "Setting 1", 0, 255)} bulk={false} />
      <FieldEditor info={info} f={int("setting2", "Setting 2", 0, 255)} bulk={false} />
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="secondary" onClick={() => editor.startPlacing(info.section)}><Plus /> Add points</Button>
        <Button size="sm" variant="secondary" onClick={() => editor.selectChildren(info)}>Select all points</Button>
      </div>
    </div>
  );
}

function RouteSettings({ route: r }: { route: any }) {
  const d = editor.doc;
  return <>
    <FieldRow label="Smooth curves" help="Interpolate smoothly between points; otherwise objects move in straight lines.">
      <Switch checked={!!r.smooth} onCheckedChange={(v) => d.change("Edit route", () => { r.smooth = v ? 1 : 0; })} />
    </FieldRow>
    <FieldRow label="Motion" help="Cyclic loops back to the first point; back and forth goes to the end and returns.">
      <Select value={String(r.loop)} onValueChange={(v) => d.change("Edit route", () => { r.loop = Number(v); })}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="0">Cyclic (loop)</SelectItem>
          <SelectItem value="1">Back and forth</SelectItem>
          {r.loop > 1 && <SelectItem value={String(r.loop)}>{String(r.loop)}</SelectItem>}
        </SelectContent>
      </Select>
    </FieldRow>
  </>;
}

function RouteEditor({ info }: { info: any }) {
  const ed = editor, d = ed.doc, r = info.item;
  const users = [
    ...d.kmp.GOBJ.filter((o: any) => o.route === info.index).map((o: any) => ed.objectLabel(o.objectId)),
    ...d.kmp.CAME.filter((c: any) => c.route === info.index).map((_: any, i: number) => `Camera ${i}`),
    ...d.kmp.AREA.filter((a: any) => a.route === info.index).map((_: any, i: number) => `Area ${i}`),
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="text-[13px]"><span className="text-muted-foreground">Points:</span> {r.points.length}</div>
      <RouteSettings route={r} />
      <FieldRow label="Used by">
        <div className="text-[13px] text-muted-foreground">{users.length ? users.join(", ") : "Nothing uses this route yet."}</div>
      </FieldRow>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="secondary" onClick={() => ed.startPlacing("POTI")}><Plus /> Add points</Button>
        <Button size="sm" variant="secondary" onClick={() => ed.selectChildren(info)}>Select all points</Button>
      </div>
    </div>
  );
}
