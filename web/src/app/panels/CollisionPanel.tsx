import { NumberField } from "../number-field";
import * as React from "react";
import {
  Box, BrickWall, Circle, Copy, Cylinder, Download, Eye, EyeOff, FileUp, FlipVertical2, Globe, Hexagon, Move3D, PaintBucket, Paintbrush, RectangleHorizontal, RectangleVertical, Square, Trash2, Triangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { KCL_TYPES } from "../../../js/data/defs.js";
import { COLLISION_SHAPES } from "../../../js/editor/collision.js";
import { KCL_HELP, KCL_FIELD_HELP } from "../../../js/data/help.js";
import { useEditor } from "../hooks";
import { hex, type CollisionShapeKind } from "../editor";
import { Hint, InfoTip, SectionTitle } from "../common";
import { cn } from "@/lib/utils";

type Mode = "show" | "paint" | "edit";

const BRUSHES = [
  { id: "single", icon: Triangle, label: "Triangle", text: "Paints the triangle under the cursor." },
  { id: "radius", icon: Circle, label: "Round", text: "Paints every triangle within the radius." },
  { id: "fill", icon: PaintBucket, label: "Fill", text: "Paints the connected surface of the same type." },
  { id: "plane", icon: RectangleHorizontal, label: "Flat area", text: "Paints the connected triangles lying on the same plane." },
] as const;

const SHAPE_ICONS: Record<CollisionShapeKind, React.ComponentType<{ className?: string }>> = {
  triangle: Triangle, rectangle: RectangleHorizontal, wall: RectangleVertical, box: Box, cylinder: Cylinder, sphere: Globe, polygon: Hexagon,
};

// Shape picker and its size options, shared by the empty state and Edit mode.
function ShapeOptions() {
  const ed = useEditor("ui");
  const shape = ed.collisionShape;
  const drawing = ed.tool?.type === "collision-create";
  const info = (COLLISION_SHAPES as any)[shape.kind];
  const n = ed.collisionDraft.length;
  return (
    <>
      <div className="grid grid-cols-4 gap-1">
        {(Object.keys(COLLISION_SHAPES) as CollisionShapeKind[]).map((kind) => {
          const Icon = SHAPE_ICONS[kind];
          return (
            <button key={kind} aria-pressed={shape.kind === kind} title={(COLLISION_SHAPES as any)[kind].help} onClick={() => ed.setCollisionShape({ kind })}
              className={cn("flex cursor-pointer flex-col items-center gap-1 rounded-md border py-2 text-[11px]", shape.kind === kind ? "border-primary bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-accent")}>
              <Icon className="size-4" /> {(COLLISION_SHAPES as any)[kind].label}
            </button>
          );
        })}
      </div>
      <p className="mb-0 mt-2 text-[11px] leading-relaxed text-muted-foreground">{info.help}</p>
      {(["wall", "box", "cylinder"].includes(shape.kind) || ["cylinder", "sphere"].includes(shape.kind)) && (
        <div className="mt-2 grid grid-cols-[80px_1fr] items-center gap-x-3 gap-y-2">
          {["wall", "box", "cylinder"].includes(shape.kind) && <>
            <Label>Height</Label>
            <NumberField aria-label="Height" value={shape.height} min={1} step={100} onValue={(n) => ed.setCollisionShape({ height: n })} />
          </>}
          {["cylinder", "sphere"].includes(shape.kind) && <>
            <Label>Segments</Label>
            <NumberField aria-label="Segments" value={shape.segments} min={3} max={64} integer onValue={(n) => ed.setCollisionShape({ segments: n })} />
          </>}
        </div>
      )}
      {drawing ? (
        <div className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
          <span className="flex-1">{Number.isFinite(info.points) ? `${n} of ${info.points} points placed` : `${n} points placed`} on the 3D view</span>
          {shape.kind === "polygon" && <Button size="sm" variant="secondary" disabled={n < 3} onClick={() => ed.finishCollisionShape()}>Close (Enter)</Button>}
          <Button size="sm" variant="ghost" onClick={() => ed.stopTool()}>Cancel</Button>
        </div>
      ) : <Button size="sm" className="mt-2 w-full" onClick={() => ed.startCollisionDrawing()}>{React.createElement(SHAPE_ICONS[shape.kind], { className: "size-4" })} Draw {info.label.toLowerCase()}</Button>}
    </>
  );
}

export function CollisionPanel() {
  const ed = useEditor("kcl", "ui", "doc", "settings");
  const kcl = ed.doc.kcl;
  const vp = ed.viewport;
  const p = ed.paint;
  const painting = ed.tool?.type === "paint";
  const editing = ed.tool?.type === "geometry" && ed.tool.target === "collision";
  const drawing = ed.tool?.type === "collision-create";
  const selectedTris: number[] = ed.geometrySelection?.type === "collision" ? ed.geometrySelection.tris || [ed.geometrySelection.tri] : [];
  const selectedTri = ed.geometrySelection?.type === "collision" ? ed.geometrySelection.tri : -1;
  const [, force] = React.useReducer((x) => x + 1, 0);
  const [mode, setModeState] = React.useState<Mode>(painting ? "paint" : editing || drawing ? "edit" : "show");
  // Tools started elsewhere (3D view, shortcuts, the empty state) show their mode.
  React.useEffect(() => {
    if (painting) setModeState("paint");
    else if (editing || drawing) setModeState("edit");
  }, [painting, editing, drawing]);

  if (!kcl) {
    return (
      <div className="p-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><BrickWall className="size-4" /> No collision loaded</CardTitle>
            <CardDescription>Open a track .szs or a course.kcl, generate a new track, or import a 3D model as collision.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => ed.cmd("importKCL")}><FileUp /> Import KCL…</Button>
            <Button size="sm" variant="secondary" onClick={() => ed.cmd("importOBJCollision")}><FileUp /> Import OBJ…</Button>
            <div className="w-full pt-1"><ShapeOptions /></div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Switching mode switches the 3D tool too: Paint paints, Edit selects triangles, Show does neither.
  const setMode = (next: Mode) => {
    setModeState(next);
    if (next === "paint" && !painting) ed.startPainting();
    else if (next === "edit" && !editing) ed.startGeometryEditing("collision");
    else if (next === "show" && (painting || editing || drawing)) ed.stopTool();
  };

  const counts = new Array(32).fill(0);
  for (let t = 0; t < kcl.count; t++) if (!kcl.valid || kcl.valid[t]) counts[kcl.flags[t] & 0x1f]++;
  const used = KCL_TYPES.filter((t: any) => counts[t.id]);
  const rebuild = () => { vp.rebuildKCL(); force(); };
  const overModel = vp.effectiveDisplay() === "both";
  const toggleType = (id: number) => { vp.kclHidden.has(id) ? vp.kclHidden.delete(id) : vp.kclHidden.add(id); rebuild(); };
  const setAll = (visible: boolean) => { for (const t of KCL_TYPES as any[]) visible ? vp.kclHidden.delete(t.id) : vp.kclHidden.add(t.id); rebuild(); };
  const current = KCL_TYPES[p.type] as any;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-3">
      <div className="mb-2.5 flex items-baseline gap-2 text-[11px] text-muted-foreground">
        <span className="text-sm font-semibold text-foreground">Collision</span>
        <span className="ml-auto tabular-nums">{kcl.count.toLocaleString()} triangles · {used.length} types</span>
      </div>

      {/* Mode switch */}
      <div role="tablist" aria-label="Collision mode" className="grid grid-cols-3 gap-1 rounded-md border bg-muted/30 p-0.5">
        {([["show", Eye, "Show"], ["paint", Paintbrush, "Paint"], ["edit", Move3D, "Edit"]] as const).map(([id, Icon, label]) => (
          <button key={id} role="tab" aria-selected={mode === id} onClick={() => setMode(id)}
            className={cn("flex cursor-pointer items-center justify-center gap-1.5 rounded-md py-1.5 text-[12.5px] font-medium transition-colors",
              mode === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
            <Icon className="size-3.5" /> {label}
          </button>
        ))}
      </div>

      {mode === "show" && <>
        <SectionTitle>Display</SectionTitle>
        <div className="grid grid-cols-[80px_1fr] items-center gap-x-3 gap-y-3 rounded-lg border bg-muted/20 p-3">
          <Label>Opacity</Label>
          {/* Over the track model (Both) the collision uses the same opacity as Paint. */}
          {overModel
            ? <div className="flex items-center gap-2"><Slider aria-label="Collision opacity over the model" min={0.15} max={0.95} step={0.05} value={[vp.paintOpacity]} onValueChange={([v]) => { vp.paintOpacity = v; vp.applyDisplayMode(); force(); }} /><span className="w-10 text-right text-xs tabular-nums">{Math.round(vp.paintOpacity * 100)}%</span></div>
            : <Slider min={0.15} max={1} step={0.05} value={[vp.kclOpacity]} onValueChange={([v]) => { vp.kclOpacity = v; rebuild(); }} />}
          <Label>Triangles</Label>
          {overModel
            ? <Switch aria-label="Show collision triangle edges" checked={vp.paintShowTriangles} onCheckedChange={(v) => { vp.paintShowTriangles = v; rebuild(); }} />
            : <Switch aria-label="Show collision triangle edges" checked={vp.kclWireframe} onCheckedChange={(v) => { vp.kclWireframe = v; rebuild(); }} />}
        </div>
        <SectionTitle action={
          <span className="flex gap-1 normal-case tracking-normal">
            <button className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground" onClick={() => setAll(true)}>Show all</button>
            <span className="text-muted-foreground">·</span>
            <button className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground" onClick={() => setAll(false)}>Hide all</button>
          </span>
        }>Surface types in this track</SectionTitle>
        <div className="flex flex-col gap-0.5">
          {used.map((t: any) => {
            const visible = !vp.kclHidden.has(t.id);
            return (
              <Hint key={t.id} title={t.name} text={`${(KCL_HELP as any)[t.id]} Click to show or hide it.`} side="right">
                <button onClick={() => toggleType(t.id)} className={cn("flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent/60", !visible && "opacity-45")}>
                  <span className="size-4 shrink-0 rounded border border-black/30 shadow-inner" style={{ background: t.color }} />
                  <span className="flex-1 truncate text-[12.5px]">{t.name}</span>
                  <span className="text-[11px] tabular-nums text-muted-foreground">{counts[t.id].toLocaleString()}</span>
                  {visible ? <Eye className="size-3.5 text-muted-foreground" /> : <EyeOff className="size-3.5 text-muted-foreground" />}
                </button>
              </Hint>
            );
          })}
        </div>
      </>}

      {mode === "paint" && <>
        <SectionTitle>Preview</SectionTitle>
        <div className="grid grid-cols-[80px_1fr] items-center gap-x-3 gap-y-3 rounded-lg border bg-muted/20 p-3">
          <Label>Track model</Label>
          <Switch aria-label="Show track model under collision" checked={vp.paintOverModel} onCheckedChange={(v) => { vp.paintOverModel = v; vp.applyDisplayMode(); force(); }} />
          {vp.paintOverModel && <>
            <Label>Opacity</Label>
            <div className="flex items-center gap-2"><Slider aria-label="Collision paint opacity" min={0.15} max={0.95} step={0.05} value={[vp.paintOpacity]} onValueChange={([v]) => { vp.paintOpacity = v; vp.applyDisplayMode(); force(); }} /><span className="w-10 text-right text-xs tabular-nums">{Math.round(vp.paintOpacity * 100)}%</span></div>
          </>}
          <Label>Triangles</Label>
          <Switch aria-label="Show triangle edges in paint" checked={vp.paintShowTriangles} onCheckedChange={(v) => { vp.paintShowTriangles = v; rebuild(); }} />
        </div>
        <SectionTitle>Surface to paint</SectionTitle>
        <div className="flex items-center gap-3 rounded-lg border bg-muted/20 p-2.5">
          <span className="size-9 shrink-0 rounded-md border border-black/30 shadow-inner" style={{ background: current.color }} />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold">{current.name}</div>
            <div className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">{(KCL_HELP as any)[p.type]}</div>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {(KCL_TYPES as any[]).map((t) => (
            <Hint key={t.id} title={`${t.name} (${hex(t.id, 2)})`} text={(KCL_HELP as any)[t.id]} side="right">
              <button aria-label={t.name} onClick={() => ed.setPaint({ type: t.id })}
                className={cn("relative flex h-11 cursor-pointer flex-col items-center justify-end overflow-hidden rounded-md border border-black/30 pb-0.5 shadow-inner transition-transform hover:scale-[1.04]",
                  t.id === p.type && "ring-2 ring-primary ring-offset-1 ring-offset-background")}
                style={{ background: t.color }}>
                <span className="w-full truncate bg-black/45 px-0.5 text-center text-[9px] leading-3 text-white">{t.name.split(/[ (]/)[0]}</span>
                {counts[t.id] > 0 && <span className="absolute right-0.5 top-0.5 rounded bg-black/50 px-0.5 text-[8px] tabular-nums text-white">{counts[t.id]}</span>}
              </button>
            </Hint>
          ))}
        </div>
        <SectionTitle>Brush</SectionTitle>
        <div className="grid grid-cols-4 gap-1">
          {BRUSHES.map((b) => (
            <Hint key={b.id} title={b.label} text={b.text}>
              <button onClick={() => ed.setPaint({ brush: b.id as any })}
                className={cn("flex cursor-pointer flex-col items-center gap-1 rounded-md border py-2 text-[11px]", p.brush === b.id ? "border-primary bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-accent")}>
                <b.icon className="size-4" /> {b.label}
              </button>
            </Hint>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-[80px_1fr] items-center gap-x-3 gap-y-2.5">
          {p.brush === "radius" && (<>
            <Label>Radius</Label>
            <div className="flex items-center gap-2"><Slider min={50} max={8000} step={50} value={[p.radius]} onValueChange={([v]) => ed.setPaint({ radius: v })} /><span className="w-12 text-right text-xs tabular-nums">{p.radius}</span></div>
          </>)}
          <Label className="flex items-center gap-1">Variant <InfoTip text={KCL_FIELD_HELP.variant} /></Label>
          <NumberField aria-label="Variant" value={p.variant} min={0} max={7} integer onValue={(n) => ed.setPaint({ variant: n })} />
          <Label className="flex items-center gap-1">Shadow <InfoTip text={KCL_FIELD_HELP.shadow} /></Label>
          <NumberField aria-label="Shadow" value={p.shadow} min={0} max={7} integer onValue={(n) => ed.setPaint({ shadow: n })} />
        </div>
        <div className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          {painting ? <p className="m-0 border-l-2 pl-2"><span className="font-medium text-foreground">Painting {current.name}.</span> Click or drag on the collision. Esc stops.</p>
            : <Button size="sm" className="w-full" onClick={() => ed.startPainting()}><Paintbrush /> Start painting</Button>}
        </div>
        <p className="mt-2 font-mono text-[10px] text-muted-foreground">Flag {hex(ed.paintFlag)}</p>
      </>}

      {mode === "edit" && <>
        <SectionTitle>Draw collision</SectionTitle>
        <div className="rounded-lg border bg-muted/20 p-2.5">
          <label className="mb-2 block space-y-1 text-[11px] text-muted-foreground">Surface of new shapes
            <select className="h-8 w-full rounded-md border bg-background px-2 text-xs text-foreground" value={p.type} onChange={(e) => ed.setPaint({ type: Number(e.target.value) })}>
              {KCL_TYPES.map((type: any) => <option key={type.id} value={type.id}>{type.name}</option>)}
            </select>
          </label>
          <ShapeOptions />
          <p className="mb-0 mt-2 text-[11px] leading-relaxed text-muted-foreground">Click on the track to place the points; the shape is previewed under the cursor and split into triangles when done. Then move, rotate or scale it with the gizmo, or edit single vertices.</p>
        </div>
        <div className="text-[11px] leading-relaxed text-muted-foreground">
          {editing ? <p className="m-0 mt-3 border-l-2 pl-2">Click a triangle to select it. Shift+click adds more, Ctrl+click toggles one, and Shift+drag selects an area. Move, rotate or scale the selection with W / E / R. Ctrl+Z undoes a change.</p>
            : <Button size="sm" className="w-full" onClick={() => ed.startGeometryEditing("collision")}><Move3D /> Select triangles</Button>}
        </div>
        {editing && selectedTri >= 0 ? (
          <div className="mt-3 space-y-3 rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <span className="size-4 rounded border border-black/30" style={{ background: (KCL_TYPES[kcl.flags[selectedTri] & 31] as any).color }} />
              <span className="text-[13px] font-semibold">{selectedTris.length === 1 ? `Triangle #${selectedTri + 1}` : `${selectedTris.length} triangles selected`}</span>
            </div>
            <label className="block space-y-1 text-[11px] text-muted-foreground">Surface type{selectedTris.length > 1 ? " for selection" : ""}
              <select className="h-8 w-full rounded-md border bg-background px-2 text-xs text-foreground" value={kcl.flags[selectedTri] & 31} onChange={(e) => ed.editCollisionType(Number(e.target.value))}>
                {KCL_TYPES.map((type: any) => <option key={type.id} value={type.id}>{type.name}</option>)}
              </select>
            </label>
            {selectedTris.length > 1 && new Set(selectedTris.map((tri) => kcl.flags[tri] & 31)).size > 1 && <p className="m-0 text-[11px] text-muted-foreground">Mixed surface types. Choosing one applies it to all selected triangles.</p>}
            {selectedTris.length === 1 && <div className="grid grid-cols-[34px_repeat(3,minmax(0,1fr))] items-center gap-1 text-[11px]">
              <span />{["X", "Y", "Z"].map((axis, i) => <span key={axis} className={cn("text-center font-semibold", ["text-red-400", "text-green-400", "text-blue-400"][i])}>{axis}</span>)}
              {[0, 1, 2].map((vertex) => <React.Fragment key={vertex}>
                <span className="text-muted-foreground">V{vertex + 1}</span>
                {[0, 1, 2].map((axis) => <CollisionCoordinate key={axis} value={kcl.verts[selectedTri * 9 + vertex * 3 + axis]} onCommit={(value) => ed.editCollisionVertex(vertex, axis, value)} />)}
              </React.Fragment>)}
            </div>}
            <div className="flex flex-wrap gap-1">
              <Button size="sm" variant="secondary" onClick={() => ed.duplicateCollisionTriangle()}><Copy /> Duplicate</Button>
              <Button size="sm" variant="secondary" onClick={() => ed.flipCollisionTriangle()}><FlipVertical2 /> Flip normal</Button>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => ed.deleteCollisionTriangle()}><Trash2 /> Delete</Button>
            </div>
          </div>
        ) : editing && <p className="mt-3 text-center text-xs text-muted-foreground">No triangle selected.</p>}
        {editing && <Button size="sm" variant="ghost" className="mt-2 self-start" onClick={() => setMode("show")}><Square /> Stop editing (Esc)</Button>}
      </>}

      <SectionTitle>File</SectionTitle>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="secondary" onClick={() => ed.cmd("importOBJCollision")}><FileUp /> Replace with OBJ…</Button>
        <Button size="sm" variant="secondary" onClick={() => ed.cmd("importKCL")}><FileUp /> Replace with KCL…</Button>
        <Button size="sm" variant="secondary" onClick={() => ed.cmd("exportKCLObj")}><Download /> Export as OBJ…</Button>
      </div>
    </div>
  );
}

function CollisionCoordinate({ value, onCommit }: { value: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const commit = () => { if (draft === null) return; const n = Number(draft.replace(",", ".")); setDraft(null); if (Number.isFinite(n)) onCommit(n); };
  return <input className="h-7 min-w-0 rounded-md border bg-background px-1 text-right text-[11px] tabular-nums" value={draft ?? String(Number(value.toFixed(3)))} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") e.currentTarget.blur(); }} />;
}
