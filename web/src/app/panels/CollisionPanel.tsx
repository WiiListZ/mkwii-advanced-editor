import { NumberField } from "../number-field";
import * as React from "react";
import {
  Box, BrickWall, ChevronDown, ChevronRight, Circle, Copy, Cylinder, DoorOpen, Download, Eye, EyeOff, FileUp, FlipVertical2, Globe, Hexagon, MousePointer2, Move, PaintBucket, Paintbrush, Plus, RectangleHorizontal, RectangleVertical, RotateCw, Scale3d, Search, Square, Trash2, Triangle, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { KCL_TYPES } from "../../../js/data/defs.js";
import { COLLISION_SHAPES } from "../../../js/editor/collision.js";
import { KCL_HELP, KCL_FIELD_HELP } from "../../../js/data/help.js";
import { documentedCourses } from "../../../js/data/collision-documentation.js";
import { collisionGroups, collisionPieces } from "../../../js/editor/collision-groups.js";
import { useEditor } from "../hooks";
import { hex, type CollisionShapeKind } from "../editor";
import { Hint, InfoTip, SectionTitle } from "../common";
import { cn } from "@/lib/utils";
import { SelectBox } from "@/components/ui/select-box";
import { GATE_TYPES, gateFacing, routeDirection } from "../../../js/editor/trigger-gate.js";

type Mode = "show" | "paint";

const BRUSHES = [
  { id: "single", icon: Triangle, label: "Triangle", text: "Paints the triangle under the cursor." },
  { id: "radius", icon: Circle, label: "Round", text: "Paints every triangle within the radius." },
  { id: "fill", icon: PaintBucket, label: "Fill", text: "Paints the connected surface of the same type." },
  { id: "plane", icon: RectangleHorizontal, label: "Flat area", text: "Paints the connected triangles lying on the same plane." },
] as const;

const SHAPE_ICONS: Record<CollisionShapeKind, React.ComponentType<{ className?: string }>> = {
  triangle: Triangle, rectangle: RectangleHorizontal, wall: RectangleVertical, box: Box, cylinder: Cylinder, sphere: Globe, polygon: Hexagon,
};

// How a trigger piece is crossed, by which way it faces (gateFacing): a short name and what it means.
const FACING: Record<string, { name: string; text: string }> = {
  toward: { name: "Gate facing the karts", text: "Faces the karts coming along the enemy route: they cross it going forward, and the game takes this variant." },
  ahead: { name: "Gate for going back", text: "Faces ahead, the way karts go: karts driving back cross it, and the game takes this variant, usually what there was before the gate after it." },
  flat: { name: "Flat", text: "Lies flat: karts cross it from above or below, falling, jumping or going into water." },
  sideways: { name: "Upright, along the road", text: "Upright but along the road: karts driving along it may not cross it. Turn it across the road, or flip it with Flip normal." },
  upright: { name: "Upright", text: "Upright: no enemy route nearby says which way karts go here." },
};

const typeOf = (id: number) => KCL_TYPES[id] as any;

function CollisionSection({ icon: Icon, title, description, children, ...props }: {
  icon: React.ComponentType<{ className?: string }>; title: string; description?: string; children: React.ReactNode;
  defaultOpen?: boolean; open?: boolean; onOpenChange?: (open: boolean) => void;
}) {
  return <Collapsible {...props} className="mt-3 shrink-0 rounded-lg border bg-muted/10">
    <CollapsibleTrigger className="group flex w-full cursor-pointer items-center gap-2.5 rounded-lg p-3 text-left hover:bg-accent/40">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1"><span className="block text-xs font-semibold">{title}</span>{description && <span className="mt-0.5 block text-[11px] text-muted-foreground">{description}</span>}</span>
      <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
    </CollapsibleTrigger>
    <CollapsibleContent><div className="border-t p-3">{children}</div></CollapsibleContent>
  </Collapsible>;
}

// The variants of a surface type as a list: each with what the documentation says it does (on the open
// track when it says so).
function VariantSelect({ type, value, onValue, label = "Variant", disabled, className }: { type: number; value: number; onValue: (n: number) => void; label?: string; disabled?: boolean; className?: string }) {
  const ed = useEditor("settings", "doc");
  const doc = ed.getCollisionDocumentation(type);
  return <SelectBox aria-label={label} disabled={disabled} className={cn("h-8 w-full rounded-md border bg-background px-2 text-xs text-foreground", className)} value={value} onChange={(e) => onValue(Number(e.target.value))}>
    {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{doc.variants[n] ? `${n} · ${doc.variants[n].label}` : String(n)}</option>)}
  </SelectBox>;
}

// What the documentation says of a surface type and one of its variants.
function CollisionDocs({ type, variant }: { type: number; variant: number | null }) {
  const ed = useEditor("settings", "doc");
  const doc = ed.getCollisionDocumentation(type);
  const v = variant !== null ? doc.variants[variant] : null;
  const elsewhere = variant !== null && !v ? documentedCourses(type, ed.customCollisionDocumentation) : [];
  return <div className="space-y-1.5 text-[11px] leading-relaxed text-muted-foreground" data-collision-docs>
    <p className="m-0">{doc.description || (KCL_HELP as any)[type]}</p>
    {variant !== null && (v
      ? <p className="m-0"><span className="font-medium text-foreground">Variant {variant}{v.onTrack && doc.track ? ` on ${doc.track}` : ""}: {v.label}.</span>{v.description ? ` ${v.description}` : ""}</p>
      : <p className="m-0">Variant {variant}: not documented{doc.track ? ` for ${doc.track}` : " for this track"}.{elsewhere.length ? ` Documented for ${elsewhere.map((c) => c.label).join(", ")}.` : ""}</p>)}
    {doc.trackNotes && <p className="m-0">{doc.trackNotes}</p>}
    {doc.notes && <p className="m-0">{doc.notes}</p>}
  </div>;
}

// The ways to add collision of a surface type: the shapes drawn in the 3D view, and for Sound and
// Effect Triggers a gate across the road.
function AddItems({ type, variant }: { type: number; variant?: number }) {
  const ed = useEditor("ui");
  return <>
    {GATE_TYPES.has(type) && <>
      <DropdownMenuItem onSelect={() => ed.addCollision(type, "gate", variant)}><DoorOpen /> Gate across the road (click on the road)</DropdownMenuItem>
      <DropdownMenuSeparator />
    </>}
    {(Object.keys(COLLISION_SHAPES) as CollisionShapeKind[]).map((kind) => (
      <DropdownMenuItem key={kind} onSelect={() => ed.addCollision(type, kind, variant)}>{React.createElement(SHAPE_ICONS[kind], { className: "size-4" })} {(COLLISION_SHAPES as any)[kind].label}</DropdownMenuItem>
    ))}
  </>;
}

// Shape picker and its size options, while drawing and when no collision is loaded.
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
            <Hint key={kind} title={(COLLISION_SHAPES as any)[kind].label} text={(COLLISION_SHAPES as any)[kind].help} side="right"><button aria-pressed={shape.kind === kind} onClick={() => ed.setCollisionShape({ kind })}
              className={cn("flex cursor-pointer flex-col items-center gap-1 rounded-md border py-2 text-[11px]", shape.kind === kind ? "border-primary bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-accent")}>
              <Icon className="size-4" /> {(COLLISION_SHAPES as any)[kind].label}
            </button></Hint>
          );
        })}
      </div>
      <p className="mb-0 mt-2 text-[11px] leading-relaxed text-muted-foreground">{info.help}</p>
      {["wall", "box", "cylinder", "sphere"].includes(shape.kind) && (
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
  const [, force] = React.useReducer((x) => x + 1, 0);
  const mode: Mode = painting ? "paint" : "show";
  const drawing = ed.tool?.type === "collision-create";

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

  // Show includes selection, vertex editing and drawing; Paint remains separate.
  const setMode = (next: Mode) => {
    if (next === "paint" && !painting) ed.startPainting();
    else if (next === "show" && !editing) ed.startGeometryEditing("collision");
  };

  const counts = new Array(32).fill(0);
  for (let t = 0; t < kcl.count; t++) if (!kcl.valid || kcl.valid[t]) counts[kcl.flags[t] & 0x1f]++;
  const used = KCL_TYPES.filter((t: any) => counts[t.id]);
  const rebuild = () => { vp.rebuildKCL(); force(); };
  const overModel = vp.effectiveDisplay() === "both";
  const current = typeOf(p.type);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-3" data-collision-panel>
      <div className="mb-2.5 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="text-sm font-semibold text-foreground">Collision</span>
        <span className="ml-auto tabular-nums">{kcl.count.toLocaleString()} triangles · {used.length} types</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button size="sm" variant="secondary" className="h-7 px-2 text-xs" aria-label="Add collision" data-collision-add><Plus /> Add</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="flex items-center gap-2 text-xs font-medium normal-case tracking-normal text-foreground"><span className="size-3 shrink-0 rounded-sm border border-black/30" style={{ background: current.color }} /> New {current.name}</DropdownMenuLabel>
            <AddItems type={p.type} />
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Surface: {current.name}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-80 overflow-y-auto">
                <DropdownMenuRadioGroup value={String(p.type)} onValueChange={(v) => ed.setPaint({ type: Number(v), variant: 0 })}>
                  {(KCL_TYPES as any[]).map((t) => <DropdownMenuRadioItem key={t.id} value={String(t.id)} onSelect={(e) => e.preventDefault()}>
                    <span className="size-3 shrink-0 rounded-sm border border-black/30" style={{ background: t.color }} /> {t.name}
                  </DropdownMenuRadioItem>)}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Mode switch */}
      <div role="tablist" aria-label="Collision mode" className="grid grid-cols-2 gap-1 rounded-md border bg-muted/30 p-0.5">
        {([["show", Eye, "Show"], ["paint", Paintbrush, "Paint"]] as const).map(([id, Icon, label]) => (
          <button key={id} role="tab" aria-selected={mode === id} onClick={() => setMode(id)}
            className={cn("flex cursor-pointer items-center justify-center gap-1.5 rounded-md py-1.5 text-[12.5px] font-medium transition-colors",
              mode === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
            <Icon className="size-3.5" /> {label}
          </button>
        ))}
      </div>

      {mode === "show" && <>
        {drawing && <div className="mt-3 shrink-0 space-y-2 rounded-lg border bg-muted/10 p-3" data-collision-drawing>
          <div className="flex items-center gap-2 text-xs font-semibold">
            {React.createElement(SHAPE_ICONS[ed.collisionShape.kind], { className: "size-4 text-primary" })}
            <span className="flex-1">Drawing a {(COLLISION_SHAPES as any)[ed.collisionShape.kind].label.toLowerCase()}</span>
          </div>
          <label className="block space-y-1.5 text-[11px] text-muted-foreground">Surface
            <SelectBox className="h-8 w-full rounded-md border bg-background px-2 text-xs text-foreground" value={p.type} onChange={(e) => ed.setPaint({ type: Number(e.target.value) })}>
              {KCL_TYPES.map((type: any) => <option key={type.id} value={type.id}>{type.name}</option>)}
            </SelectBox>
          </label>
          <label className="block space-y-1.5 text-[11px] text-muted-foreground">Variant
            <VariantSelect type={p.type} value={p.variant} onValue={(n) => ed.setPaint({ variant: n })} />
          </label>
          <ShapeOptions />
        </div>}

        <SelectionCard editing={editing} />

        <CollisionList counts={counts} />

        <CollisionSection icon={Eye} title="View settings" description="Opacity and triangle edges">
          <div className="grid grid-cols-[80px_1fr] items-center gap-x-3 gap-y-3">
            <Label>Opacity</Label>
            <div className="flex items-center gap-2"><Slider aria-label="Collision opacity" min={0.15} max={overModel ? 0.95 : 1} step={0.05} value={[overModel ? vp.paintOpacity : vp.kclOpacity]} onValueChange={([v]) => { if (overModel) { vp.paintOpacity = v; vp.applyDisplayMode(); force(); } else { vp.kclOpacity = v; rebuild(); } }} /><span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">{Math.round((overModel ? vp.paintOpacity : vp.kclOpacity) * 100)}%</span></div>
            <Label htmlFor="collision-edges">Triangle edges</Label>
            <Switch id="collision-edges" aria-label="Show collision triangle edges" checked={overModel ? vp.paintShowTriangles : vp.kclWireframe} onCheckedChange={(v) => { if (overModel) vp.paintShowTriangles = v; else vp.kclWireframe = v; rebuild(); }} />
          </div>
        </CollisionSection>
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
            <div className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">{ed.getCollisionDocumentation(p.type).description || (KCL_HELP as any)[p.type]}</div>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {(KCL_TYPES as any[]).map((t) => (
            <Hint key={t.id} title={`${t.name} (${hex(t.id, 2)})`} text={ed.getCollisionDocumentation(t.id).description || (KCL_HELP as any)[t.id]} side="right">
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
        {!ed.paintsGate && <>
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
        </>}
        <div className="mt-3 grid grid-cols-[80px_1fr] items-center gap-x-3 gap-y-2.5">
          {p.brush === "radius" && !ed.paintsGate && (<>
            <Label>Radius</Label>
            <div className="flex items-center gap-2"><Slider min={50} max={8000} step={50} value={[p.radius]} onValueChange={([v]) => ed.setPaint({ radius: v })} /><span className="w-12 text-right text-xs tabular-nums">{p.radius}</span></div>
          </>)}
          <Label className="flex items-center gap-1">Variant <InfoTip text={KCL_FIELD_HELP.variant} /></Label>
          <VariantSelect type={p.type} value={p.variant} onValue={(n) => ed.setPaint({ variant: n })} />
          <Label className="flex items-center gap-1">Shadow <InfoTip text={KCL_FIELD_HELP.shadow} /></Label>
          <NumberField aria-label="Shadow" value={p.shadow} min={0} max={7} integer onValue={(n) => ed.setPaint({ shadow: n })} />
        </div>
        <div className="mt-2"><CollisionDocs type={p.type} variant={p.variant} /></div>
        {GATE_TYPES.has(p.type) && <div className="mt-3 space-y-1.5 rounded-lg border bg-muted/20 p-2.5 text-[11px] leading-relaxed" data-paint-gate>
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
            <input type="checkbox" className="accent-primary" aria-label="Gate across the road" checked={p.gate} onChange={(e) => ed.setPaint({ gate: e.target.checked })} /> Gate across the road
          </label>
          <p className="m-0 text-muted-foreground">{p.gate
            ? `A click on the road adds an upright gate across it, wall to wall and facing the karts, that they drive through: the game reacts as they cross it, and the road stays road. Select it with Select triangles to move or delete it.`
            : `The brush paints the triangles themselves: they stop being road (or wall), and karts drive through a ${current.name} rather than on it, so they may fall through the road there.`}</p>
          {p.gate && <div className="space-y-1.5 border-t pt-2" data-paint-gate-back>
            <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
              <input type="checkbox" className="accent-primary" aria-label="Going back" checked={p.gateBack} onChange={(e) => ed.setPaint({ gateBack: e.target.checked })} /> Going back: variant
            </label>
            <VariantSelect type={p.type} label="Going back variant" value={p.backVariant} disabled={!p.gateBack} onValue={(n) => ed.setPaint({ backVariant: n })} />
            <p className="m-0 text-muted-foreground">{p.gateBack
              ? `Just before the gate, a second one facing ahead with variant ${p.backVariant}, crossed by karts driving back: it brings back what was there before (usually 0, the track's own). Nintendo's tracks pair their gates the same way.`
              : `Only the gate facing the karts: driving back through it does nothing, so what it set stays.`}</p>
          </div>}
        </div>}
        <div className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          {painting ? <p className="m-0 border-l-2 pl-2"><span className="font-medium text-foreground">{ed.paintsGate ? `Adding ${current.name} gates.` : `Painting ${current.name}.`}</span> {ed.paintsGate ? "Click on the road where karts should cross it." : "Click or drag on the collision."} Esc stops.</p>
            : <Button size="sm" className="w-full" onClick={() => ed.startPainting()}><Paintbrush /> Start painting</Button>}
        </div>
        <p className="mt-2 font-mono text-[10px] text-muted-foreground">Flag {hex(ed.paintFlag)}</p>
      </>}

      <CollisionSection icon={FileUp} title="Import and export" description="Replace collision or export an OBJ">
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => ed.cmd("importOBJCollision")}><FileUp /> Replace with OBJ…</Button>
          <Button size="sm" variant="secondary" onClick={() => ed.cmd("importKCL")}><FileUp /> Replace with KCL…</Button>
          <Button size="sm" variant="secondary" onClick={() => ed.cmd("exportKCLObj")}><Download /> Export as OBJ…</Button>
        </div>
      </CollisionSection>
    </div>
  );
}

// The selected collision and its settings: surface type, variant (with what it does here), shadow,
// Trickable, and for Sound and Effect Triggers which way it is crossed.
function SelectionCard({ editing }: { editing: boolean }) {
  const ed = useEditor("kcl", "ui", "doc", "settings");
  const kcl = ed.doc.kcl, vp = ed.viewport;
  const selectedTris: number[] = ed.geometrySelection?.type === "collision" ? ed.geometrySelection.tris || [ed.geometrySelection.tri] : [];
  const selectedTri = ed.geometrySelection?.type === "collision" ? ed.geometrySelection.tri : -1;
  const flag = selectedTri >= 0 ? kcl.flags[selectedTri] : 0;
  const type = flag & 31, variant = (flag >> 5) & 7, shadow = (flag >> 8) & 7, trickable = !!(flag & 0x2000);
  const all = (f: (x: number) => number) => selectedTris.every((t) => f(kcl.flags[t]) === f(flag));
  const sameType = all((x) => x & 31), sameVariant = all((x) => (x >> 5) & 7), sameShadow = all((x) => (x >> 8) & 7), sameTrick = all((x) => x & 0x2000);
  // Which way a selected trigger faces, from the sum of its faces' normals.
  const facing = React.useMemo(() => {
    if (!sameType || !GATE_TYPES.has(type) || !selectedTris.length) return null;
    const piece = collisionPieces(kcl, selectedTris, Infinity)[0];
    return piece ? gateFacing(piece.normal, routeDirection(ed.doc.kmp.ENPT, piece.centre)) : null;
  }, [selectedTris.join(","), ed.version(["kcl"]), sameType, type]);

  return <div className="mt-3 shrink-0 rounded-lg border bg-muted/10" data-collision-selection>
    <div className="flex items-center gap-2 border-b px-3 py-2.5">
      <MousePointer2 className="size-4 text-primary" />
      <span className="flex-1 text-xs font-semibold">Selection</span>
      {editing && selectedTri >= 0 && <Hint title="Clear selection" text="Deselect the collision triangles without changing them."><Button aria-label="Clear collision selection" size="icon-sm" variant="ghost" onClick={() => vp.selectGeometry(null)}><X /></Button></Hint>}
      {editing && <Hint title="Stop selecting" text="Stop editing collision triangles (Esc)."><Button aria-label="Stop selecting collision" size="icon-sm" variant="ghost" onClick={() => ed.stopTool()}><Square /></Button></Hint>}
    </div>
    <div className="space-y-3 p-3">
      {editing ? <>
        <div role="group" aria-label="Transform collision selection" className="grid grid-cols-3 gap-1 rounded-md bg-muted/40 p-0.5">
          {([["translate", Move, "Move", "W"], ["rotate", RotateCw, "Rotate", "E"], ["scale", Scale3d, "Scale", "R"]] as const).map(([id, Icon, label, key]) => <Hint key={id} title={`${label} (${key})`} text={`${label} the selected triangles using the handles in the 3D view.`}>
            <button aria-pressed={ed.mode === id} onClick={() => vp.setMode(id)} className={cn("flex cursor-pointer items-center justify-center gap-1 rounded py-1.5 text-[11px]", ed.mode === id ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}><Icon className="size-3.5" />{label}</button>
          </Hint>)}
        </div>
        {selectedTri >= 0 ? <>
          <div className="flex items-center gap-2 text-xs font-medium">
            <span className="size-3.5 shrink-0 rounded border border-black/30" style={{ background: typeOf(type).color }} />
            <span className="flex-1">{selectedTris.length === 1 ? `Triangle #${selectedTri + 1}` : `${selectedTris.length} triangles selected`}</span>
            <span className="font-mono text-[10px] font-normal text-muted-foreground" title="The collision flag: surface type, variant, shadow and the other settings in one number">{selectedTris.length === 1 || (sameType && sameVariant && sameShadow && sameTrick) ? `Flag ${hex(flag)}` : "Mixed flags"}</span>
          </div>
          <div className="space-y-2.5" data-collision-settings>
            <div className="text-[11px] font-semibold text-muted-foreground">Settings of this collision</div>
            <div className="grid grid-cols-[72px_1fr] items-center gap-x-3 gap-y-2 text-[11px]">
              <Label className="text-[11px]">Surface</Label>
              <SelectBox aria-label="Surface type" className="h-8 w-full rounded-md border bg-background px-2 text-xs text-foreground" value={type} onChange={(e) => ed.editCollisionType(Number(e.target.value))}>
                {KCL_TYPES.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </SelectBox>
              <Label className="flex items-center gap-1 text-[11px]">Variant <InfoTip text={KCL_FIELD_HELP.variant} /></Label>
              <VariantSelect type={type} value={variant} onValue={(n) => ed.editCollisionFlag({ variant: n })} />
              <Label className="flex items-center gap-1 text-[11px]">Shadow <InfoTip text={KCL_FIELD_HELP.shadow} /></Label>
              <NumberField aria-label="Collision shadow" commit value={shadow} min={0} max={7} integer onValue={(n) => ed.editCollisionFlag({ shadow: n })} />
              <Label className="flex items-center gap-1 text-[11px]">Trickable <InfoTip text="Flag 0x2000: a kart driving off this surface can do a trick, as from a ramp." /></Label>
              <Switch aria-label="Trickable" checked={trickable} onCheckedChange={(v) => ed.editCollisionFlag({ trickable: v })} />
            </div>
            {selectedTris.length > 1 && !(sameType && sameVariant && sameShadow && sameTrick) && <p className="m-0 text-[11px] text-muted-foreground">The selected triangles have different settings: shown are those of #{selectedTri + 1}. A change applies to all of them.</p>}
            {sameType && <CollisionDocs type={type} variant={sameVariant ? variant : null} />}
            {facing && <div className="rounded-md border bg-background/40 p-2 text-[11px] leading-relaxed" data-trigger-facing={facing}>
              <div className="font-medium">{FACING[facing].name}</div>
              <p className="m-0 text-muted-foreground">{FACING[facing].text} Flip normal turns it the other way.</p>
            </div>}
          </div>
          <div className="grid grid-cols-3 gap-1 [&_button]:gap-1 [&_button]:px-1 [&_button]:text-[11px] [&_svg]:size-3.5">
            <Hint title="Duplicate selection" text="Create a copy of the selected collision triangles."><Button size="sm" variant="secondary" onClick={() => ed.duplicateCollisionTriangle()}><Copy /> Duplicate</Button></Hint>
            <Hint title="Flip normal" text="Reverse which side of the selected triangles is solid (for a trigger: from which side it is crossed)."><Button size="sm" variant="secondary" onClick={() => ed.flipCollisionTriangle()}><FlipVertical2 /> Flip normal</Button></Hint>
            <Hint title="Delete selection" text="Remove the selected collision triangles. Ctrl+Z undoes this change."><Button size="sm" variant="ghost" className="text-destructive" onClick={() => ed.deleteCollisionTriangle()}><Trash2 /> Delete</Button></Hint>
          </div>
          {selectedTris.length === 1 && <Collapsible className="border-t pt-2">
            <CollapsibleTrigger className="group flex w-full cursor-pointer items-center justify-between py-1 text-[11px] text-muted-foreground hover:text-foreground">Vertex coordinates<ChevronDown className="size-3.5 transition-transform group-data-[state=open]:rotate-180" /></CollapsibleTrigger>
            <CollapsibleContent><div className="mt-2 grid grid-cols-[25px_repeat(3,minmax(0,1fr))] items-center gap-1 text-[11px]">
              <span />{["X", "Y", "Z"].map((axis, i) => <span key={axis} className={cn("text-center font-semibold", ["text-red-400", "text-green-400", "text-blue-400"][i])}>{axis}</span>)}
              {[0, 1, 2].map((vertex) => <React.Fragment key={vertex}>
                <span className="text-muted-foreground">V{vertex + 1}</span>
                {[0, 1, 2].map((axis) => <CollisionCoordinate key={`${selectedTri}-${vertex}-${axis}`} label={`Vertex ${vertex + 1} ${["X", "Y", "Z"][axis]}`} value={kcl.verts[selectedTri * 9 + vertex * 3 + axis]} onCommit={(value) => ed.editCollisionVertex(vertex, axis, value)} />)}
              </React.Fragment>)}
            </div></CollapsibleContent>
          </Collapsible>}
        </> : <div className="rounded-md border border-dashed px-3 py-4 text-center">
          <Triangle className="mx-auto mb-2 size-5 text-muted-foreground" />
          <p className="m-0 text-xs font-medium">Click a triangle in the 3D view, or a piece in the list</p>
          <p className="mb-0 mt-1 text-[11px] leading-relaxed text-muted-foreground">Shift + click to add more.<br />Shift + drag to select an area.</p>
        </div>}
      </> : <>
        <p className="m-0 text-[11px] leading-relaxed text-muted-foreground">Select triangles to move them, change their settings or edit their vertices, in the 3D view or from the list below.</p>
        <Button size="sm" className="w-full" onClick={() => ed.startGeometryEditing("collision")}><MousePointer2 /> Select triangles</Button>
      </>}
    </div>
  </div>;
}

// The collision as the Track tab lists the track: by surface type, then variant, then pieces of joined
// triangles. A click selects (Ctrl: toggle, Shift: add), a double click also shows them; + adds.
function CollisionList({ counts }: { counts: number[] }) {
  const ed = useEditor("kcl", "ui", "doc", "settings");
  const kcl = ed.doc.kcl, vp = ed.viewport;
  const version = ed.version(["kcl"]);
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());
  const [filter, setFilter] = React.useState("");
  const scroller = React.useRef<HTMLDivElement>(null);
  const groups = React.useMemo(() => collisionGroups(kcl), [kcl, version]);
  const piecesCache = React.useRef(new Map<string, any[]>());
  React.useMemo(() => piecesCache.current.clear(), [kcl, version]);
  const piecesOf = (type: number, variant: number) => {
    const key = `${type}:${variant}`;
    let pieces = piecesCache.current.get(key);
    if (!pieces) {
      pieces = collisionPieces(kcl, groups.get(type)?.variants.get(variant) || []);
      if (GATE_TYPES.has(type)) for (const piece of pieces) piece.facing = gateFacing(piece.normal, routeDirection(ed.doc.kmp.ENPT, piece.centre));
      piecesCache.current.set(key, pieces);
    }
    return pieces;
  };
  const toggle = (key: string) => setExpanded((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const selection: Set<number> = new Set(ed.geometrySelection?.type === "collision" ? ed.geometrySelection.tris || [ed.geometrySelection.tri] : []);
  const isSelected = (tris: number[]) => selection.size > 0 && tris.length > 0 && tris.length <= selection.size && tris.every((t) => selection.has(t));
  const pick = (tris: number[]) => (e: React.MouseEvent) => ed.selectCollisionTriangles(tris, { mode: e.ctrlKey || e.metaKey ? "toggle" : e.shiftKey ? "add" : "replace" });
  const focus = (tris: number[]) => () => ed.selectCollisionTriangles(tris, { focus: true });
  const f = filter.trim().toLowerCase();

  // The rows of the selected triangle open, and it is scrolled to.
  const selectedTri = ed.geometrySelection?.type === "collision" ? ed.geometrySelection.tri : -1;
  React.useEffect(() => {
    if (selectedTri < 0 || selectedTri >= kcl.count) return;
    const flag = kcl.flags[selectedTri], add = [`T${flag & 31}`, `T${flag & 31}V${(flag >> 5) & 7}`];
    if (add.some((a) => !expanded.has(a))) setExpanded((s) => new Set([...s, ...add]));
    // Scrolled inside the list only, so the selection's settings above stay in view.
    requestAnimationFrame(() => {
      const box = scroller.current, row = box?.querySelector<HTMLElement>("[data-selected=true]");
      if (!box || !row) return;
      const top = row.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 40;
      if (top < box.scrollTop || top + row.offsetHeight + 40 > box.scrollTop + box.clientHeight) box.scrollTop = Math.max(0, top - box.clientHeight / 3);
    });
  }, [selectedTri, ed.version(["ui"])]);

  const toggleType = (id: number) => { vp.kclHidden.has(id) ? vp.kclHidden.delete(id) : vp.kclHidden.add(id); vp.rebuildKCL(); ed.bump("ui"); };
  const setAll = (visible: boolean) => { for (const t of KCL_TYPES as any[]) visible ? vp.kclHidden.delete(t.id) : vp.kclHidden.add(t.id); vp.rebuildKCL(); ed.bump("ui"); };

  const Row = ({ depth, twisty, onTwisty, selected, onClick, onDoubleClick, children, badge, count, actions, ...rest }: { depth: number; twisty?: boolean | null; onTwisty?: () => void; selected?: boolean; onClick?: (e: React.MouseEvent) => void; onDoubleClick?: () => void; children: React.ReactNode; badge?: string; count?: number; actions?: React.ReactNode; [key: string]: any }) => (
    <div {...rest} data-selected={!!selected} onClick={onClick} onDoubleClick={onDoubleClick}
      className={cn("group mx-1 flex h-6 cursor-pointer items-center gap-1.5 rounded px-1.5 text-[12px] hover:bg-accent/70", selected && "bg-primary/12 text-foreground ring-1 ring-inset ring-primary/20 hover:bg-primary/15")}
      style={{ paddingLeft: 6 + depth * 14 }}>
      {twisty != null ? <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", twisty && "rotate-90")} data-twisty onClick={(e) => { e.stopPropagation(); onTwisty?.(); }} /> : <span className="w-3.5 shrink-0" />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {badge && <span className="font-mono text-[10px] text-muted-foreground">{badge}</span>}
      {count != null && <span className="text-[11px] tabular-nums text-muted-foreground">{count.toLocaleString()}</span>}
      {actions}
    </div>
  );

  return <div className="mt-3 shrink-0 rounded-lg border bg-muted/10" data-collision-list>
    <div className="flex items-center gap-2 border-b px-3 py-2">
      <BrickWall className="size-4 text-muted-foreground" />
      <span className="flex-1 text-xs font-semibold">Collisions</span>
      <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" onClick={() => setAll(true)}>Show all</Button>
      <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" onClick={() => setAll(false)}>Hide all</Button>
    </div>
    <div className="relative p-2">
      <Search className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find (e.g. sound trigger, wall)" className="h-7 pl-7 text-xs" onKeyDown={(e) => e.stopPropagation()} />
    </div>
    <div ref={scroller} className="max-h-[55vh] min-h-24 overflow-y-auto pb-2" data-collision-rows>
      {[...groups].map(([type, group]) => {
        const t = typeOf(type), doc = ed.getCollisionDocumentation(type);
        const variantText = (v: number) => `Variant ${v}${doc.variants[v] ? ` · ${doc.variants[v].label}` : ""}`;
        const typeMatch = !f || t.name.toLowerCase().includes(f) || hex(type, 2).toLowerCase().includes(f);
        const variants = [...group.variants].filter(([v]) => typeMatch || variantText(v).toLowerCase().includes(f));
        if (!variants.length) return null;
        const open = expanded.has(`T${type}`) || !!f;
        const visible = !vp.kclHidden.has(type);
        const all = [...group.variants.values()].flat();
        return <div key={type} data-collision-type={hex(type, 2)}>
          <div className="sticky top-0 z-10 mt-1 flex h-8 items-center gap-1.5 border-y border-border/60 bg-sidebar/95 px-2 backdrop-blur">
            <ChevronRight className={cn("size-3.5 cursor-pointer text-muted-foreground transition-transform", open && "rotate-90")} onClick={() => toggle(`T${type}`)} />
            <span className={cn("size-3.5 shrink-0 rounded border border-black/30", !visible && "opacity-40")} style={{ background: t.color }} />
            <Hint title={`${t.name} (${hex(type, 2)})`} text={doc.description || (KCL_HELP as any)[type]} side="right">
              <span className={cn("min-w-0 flex-1 cursor-pointer truncate text-[12.5px] font-semibold", !visible && "opacity-50")} onClick={() => toggle(`T${type}`)} onDoubleClick={focus(all)}>{t.name}</span>
            </Hint>
            <Badge variant="outline" className="tabular-nums">{counts[type].toLocaleString()}</Badge>
            <Hint title={visible ? "Hide" : "Show"} text={`Show or hide ${t.name} in the 3D view. It stays in the file.`}>
              <Button variant="ghost" size="icon-sm" className="size-6" aria-label={`${visible ? "Hide" : "Show"} ${t.name} collision`} aria-pressed={visible} onClick={() => toggleType(type)}>{visible ? <Eye /> : <EyeOff className="opacity-50" />}</Button>
            </Hint>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" className="size-6" aria-label={`Add ${t.name}`} title={`Add ${t.name}`}><Plus /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64"><DropdownMenuLabel className="text-xs font-medium normal-case tracking-normal text-foreground">Add {t.name}</DropdownMenuLabel><AddItems type={type} /></DropdownMenuContent>
            </DropdownMenu>
          </div>
          {open && variants.map(([variant, tris]) => {
            const vKey = `T${type}V${variant}`, vOpen = expanded.has(vKey);
            const pieces = vOpen ? piecesOf(type, variant) : [];
            return <React.Fragment key={vKey}>
              <Row depth={1} twisty={vOpen} onTwisty={() => toggle(vKey)} count={tris.length} selected={isSelected(tris)} data-collision-variant={variant}
                onClick={pick(tris)} onDoubleClick={focus(tris)}
                actions={<DropdownMenu>
                  <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" className="size-5 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100" aria-label={`Add ${t.name} variant ${variant}`} onClick={(e) => e.stopPropagation()}><Plus className="size-3" /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64"><DropdownMenuLabel className="text-xs font-medium normal-case tracking-normal text-foreground">Add {t.name}, variant {variant}</DropdownMenuLabel><AddItems type={type} variant={variant} /></DropdownMenuContent>
                </DropdownMenu>}>
                {variantText(variant)}
              </Row>
              {vOpen && pieces.slice(0, 300).map((piece: any, i: number) => (
                <Row key={`${vKey}P${i}`} depth={2} twisty={null} badge={`${piece.tris.length} △`} selected={isSelected(piece.tris)} data-collision-piece={i}
                  onClick={pick(piece.tris)} onDoubleClick={focus(piece.tris)}>
                  {piece.facing ? <Hint title={FACING[piece.facing].name} text={FACING[piece.facing].text} side="right"><span>{FACING[piece.facing].name}</span></Hint> : `Piece ${i + 1}`}
                </Row>
              ))}
              {vOpen && pieces.length > 300 && <div className="px-3 py-1 pl-[40px] text-[11px] text-muted-foreground">{(pieces.length - 300).toLocaleString()} more pieces: select them in the 3D view.</div>}
            </React.Fragment>;
          })}
        </div>;
      })}
    </div>
  </div>;
}

function CollisionCoordinate({ label, value, onCommit }: { label: string; value: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const commit = () => { if (draft === null) return; const n = Number(draft.replace(",", ".")); setDraft(null); if (Number.isFinite(n)) onCommit(n); };
  return <input aria-label={label} className="h-7 min-w-0 rounded-md border bg-background px-1 text-right text-[11px] tabular-nums" value={draft ?? String(Number(value.toFixed(3)))} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") e.currentTarget.blur(); }} />;
}
