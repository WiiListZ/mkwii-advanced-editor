// The animations of a BRRES, keyframe by keyframe: bone (CHR0), texture matrix (SRT0), colour
// (CLR0), texture swap (PAT0) and visibility (VIS0). Every animation can be changed, created or
// deleted; Apply writes the changed ones again (web/js/formats/anim-write.js) and resolves with
// the new BRRES, or null when nothing is applied.

import * as React from "react";
import { Plus, Trash2, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { NumberField } from "../number-field";
import { api } from "../../../js/api.js";
import { evalTrack, parseBRRES } from "../../../js/formats/brres.js";
import { writeCHR0, writeCLR0, writeSRT0, writeVIS0 } from "../../../js/formats/anim-write.js";
import { writePAT0 } from "../../../js/formats/pat0.js";
import { trackKeys } from "../../../js/formats/nw4r.js";
import { dialogs } from "../dialogs-store";

type Kind = "chr" | "srt" | "clr" | "pat" | "vis";
const KINDS: { kind: Kind; label: string; folder: string; write: (a: any) => Uint8Array }[] = [
  { kind: "chr", label: "Bones (CHR0)", folder: "AnmChr(NW4R)", write: writeCHR0 },
  { kind: "srt", label: "Texture movement (SRT0)", folder: "AnmTexSrt(NW4R)", write: writeSRT0 },
  { kind: "clr", label: "Colours (CLR0)", folder: "AnmClr(NW4R)", write: writeCLR0 },
  { kind: "pat", label: "Texture swaps (PAT0)", folder: "AnmTexPat(NW4R)", write: writePAT0 },
  { kind: "vis", label: "Visibility (VIS0)", folder: "AnmVis(NW4R)", write: writeVIS0 },
];
const CLR_TARGETS = ["Material colour 0", "Material colour 1", "Ambient colour 0", "Ambient colour 1", "TEV colour 0", "TEV colour 1", "TEV colour 2", "Konst colour 0", "Konst colour 1", "Konst colour 2", "Konst colour 3"];
const AXES = ["X", "Y", "Z"];
const keyOf = (kind: Kind, name: string) => `${kind}\u0000${name}`;
const clone = <T,>(value: T): T => structuredClone(value);

// Numeric tracks as the editor keeps them: { const } or { keys }.
const asEditable = (track: any) => !track ? null : track.const !== undefined ? { const: track.const } : { keys: trackKeys(track).map((k: any) => ({ ...k })) };
// Tangents that make the curve pass smoothly through its keys (Catmull-Rom).
function autoTangents(keys: any[]) {
  return keys.map((k, i) => {
    const a = keys[Math.max(0, i - 1)], b = keys[Math.min(keys.length - 1, i + 1)];
    return { ...k, t: b.f !== a.f ? (b.v - a.v) / (b.f - a.f) : 0 };
  });
}
const hex = (rgba: number[]) => "#" + rgba.slice(0, 3).map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("");
const fromHex = (text: string, alpha: number) => [1, 3, 5].map((i) => parseInt(text.slice(i, i + 2), 16) / 255).concat(alpha);
// A colour list (one per frame) as its keys: the frames where it stops changing in a straight line.
function colourKeys(colors: number[][]) {
  if (colors.length === 1) return [{ f: 0, c: colors[0] }];
  const keys = [{ f: 0, c: colors[0] }];
  for (let f = 1; f < colors.length - 1; f++) {
    const a = colors[f - 1], b = colors[f], c = colors[f + 1];
    if (b.some((v, i) => Math.abs(v * 2 - a[i] - c[i]) > 1.5 / 255)) keys.push({ f, c: b });
  }
  keys.push({ f: colors.length - 1, c: colors[colors.length - 1] });
  return keys;
}
function colourList(keys: { f: number; c: number[] }[], frames: number) {
  const sorted = [...keys].sort((a, b) => a.f - b.f);
  return Array.from({ length: frames + 1 }, (_, f) => {
    let i = 0;
    while (i + 1 < sorted.length && sorted[i + 1].f <= f) i++;
    const a = sorted[i], b = sorted[i + 1];
    if (!b || f <= a.f) return [...a.c];
    const t = (f - a.f) / Math.max(1, b.f - a.f);
    return a.c.map((v, k) => v + (b.c[k] - v) * t);
  });
}

function Curve({ track, frames }: { track: any; frames: number }) {
  const W = 360, H = 90;
  if (!track?.keys?.length) return null;
  const samples = Array.from({ length: Math.min(200, frames) + 1 }, (_, i) => (i / Math.min(200, frames)) * frames);
  const values = samples.map((f) => evalTrack(track, f));
  let low = Math.min(...values, ...track.keys.map((k: any) => k.v)), high = Math.max(...values, ...track.keys.map((k: any) => k.v));
  if (high - low < 1e-6) { low -= 1; high += 1; }
  const x = (f: number) => 6 + (f / Math.max(1, frames)) * (W - 12), y = (v: number) => H - 6 - ((v - low) / (high - low)) * (H - 12);
  return <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-[90px] w-full rounded border bg-black/20" aria-label="Curve">
    <polyline fill="none" stroke="currentColor" strokeWidth="1.5" className="text-sky-300" points={samples.map((f, i) => `${x(f)},${y(values[i])}`).join(" ")} />
    {track.keys.map((k: any, i: number) => <circle key={i} cx={x(k.f)} cy={y(k.v)} r="3" className="fill-amber-300" />)}
  </svg>;
}

function TrackEditor({ label, track, frames, onChange, removable = true }: { label: string; track: any; frames: number; onChange: (t: any) => void; removable?: boolean }) {
  const mode = !track ? "none" : track.keys ? "keys" : "fixed";
  const [at, setAt] = React.useState(0);
  const setKeys = (keys: any[]) => onChange({ keys: [...keys].sort((a, b) => a.f - b.f) });
  return <div className="space-y-1.5 rounded-md border p-2" data-anim-track={label}>
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-xs font-medium">{label}</span>
      <Select value={mode} onValueChange={(m) => onChange(m === "none" ? null : m === "fixed" ? { const: track ? evalTrack(track, 0) : 0 } : { keys: [{ f: 0, v: track ? evalTrack(track, 0) : 0, t: 0 }, { f: frames, v: track ? evalTrack(track, frames) : 0, t: 0 }] })}>
        <SelectTrigger className="h-7 w-32 text-xs" aria-label={`${label} mode`}><SelectValue /></SelectTrigger>
        <SelectContent>{[...(removable ? [["none", "Not animated"]] : []), ["fixed", "Fixed value"], ["keys", "Keyframes"]].map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
      </Select>
    </div>
    {mode === "fixed" && <NumberField commit aria-label={`${label} value`} value={track.const} onValue={(v) => onChange({ const: v })} className="h-7 w-32 text-xs" />}
    {mode === "keys" && <>
      <Curve track={track} frames={frames} />
      <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1 text-[10.5px] text-muted-foreground"><span>Frame</span><span>Value</span><span>Tangent</span><span /></div>
      <div className="max-h-44 space-y-1 overflow-y-auto">
        {track.keys.map((k: any, i: number) => <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-1">
          <NumberField commit aria-label={`${label} key ${i + 1} frame`} value={k.f} onValue={(v) => setKeys(track.keys.map((x: any, j: number) => j === i ? { ...x, f: v } : x))} className="h-6 text-[11px]" />
          <NumberField commit aria-label={`${label} key ${i + 1} value`} value={k.v} onValue={(v) => setKeys(track.keys.map((x: any, j: number) => j === i ? { ...x, v } : x))} className="h-6 text-[11px]" />
          <NumberField commit aria-label={`${label} key ${i + 1} tangent`} value={k.t} onValue={(v) => setKeys(track.keys.map((x: any, j: number) => j === i ? { ...x, t: v } : x))} className="h-6 text-[11px]" />
          <Button size="icon-sm" variant="ghost" aria-label={`Delete key ${i + 1}`} disabled={track.keys.length <= 1} onClick={() => setKeys(track.keys.filter((_: any, j: number) => j !== i))}><Trash2 /></Button>
        </div>)}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <NumberField commit aria-label={`${label} new key frame`} value={at} onValue={setAt} className="h-6 w-16 text-[11px]" />
        <Button size="sm" variant="secondary" className="h-6 px-2 text-[11px]" onClick={() => setKeys([...track.keys, { f: at, v: evalTrack(track, at), t: 0 }])}><Plus /> Key at frame</Button>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" title="Tangents that make the curve pass smoothly through the keys" onClick={() => setKeys(autoTangents(track.keys))}><Wand2 /> Smooth tangents</Button>
      </div>
    </>}
  </div>;
}

export function AnimationEditorDialog({ brres, title, initial, close }: { brres: Uint8Array; title?: string; initial?: { kind: Kind; name: string }; close: (v: Uint8Array | null) => void }) {
  const parsed = React.useMemo(() => parseBRRES(brres), [brres]);
  const boneNames = React.useMemo(() => [...new Set(parsed.models.flatMap((m: any) => m.bones.map((b: any) => b.name)))] as string[], [parsed]);
  const materialNames = React.useMemo(() => [...new Set(parsed.models.flatMap((m: any) => m.materials.map((b: any) => b.name)))] as string[], [parsed]);
  const textureNames = React.useMemo(() => [...parsed.textures.keys()] as string[], [parsed]);
  // The animations as they are being edited; null marks one deleted.
  const [anims, setAnims] = React.useState(() => {
    const map = new Map<string, any>();
    for (const { kind } of KINDS) for (const [name, anim] of parsed[kind]) map.set(keyOf(kind, name), { kind, name, model: clone(anim) });
    return map;
  });
  const [changed, setChanged] = React.useState<Set<string>>(new Set());
  const [selected, setSelected] = React.useState(() => initial ? keyOf(initial.kind, initial.name) : [...anims.keys()][0] ?? "");
  const [target, setTarget] = React.useState("");
  const [applying, setApplying] = React.useState(false);
  const current = anims.get(selected) || null;
  const update = (fn: (model: any) => void) => {
    if (!current) return;
    const model = clone(current.model);
    fn(model);
    setAnims((m) => new Map(m).set(selected, { ...current, model }));
    setChanged((s) => new Set(s).add(selected));
  };
  const targets: string[] = !current ? [] : [...(current.kind === "chr" || current.kind === "vis" ? current.model.bones.keys() : current.model.materials.keys())];
  const currentTarget = targets.includes(target) ? target : targets[0] ?? "";

  const create = async () => {
    const answer: any = await dialogs.form({ title: "New animation", fields: [
      { key: "kind", label: "Kind", type: "select", value: "chr", options: KINDS.map((k) => [k.kind, k.label] as [string, string]) },
      { key: "name", label: "Name", type: "text", value: "NewAnimation" },
      { key: "frames", label: "Frames (60 per second)", type: "number", value: 60, min: 1, max: 65535, step: 1 },
    ], confirmLabel: "Create" });
    if (!answer) return;
    const kind = answer.kind as Kind, name = String(answer.name || "").trim(), frames = Math.max(1, Math.round(Number(answer.frames) || 60));
    if (!/^[\x21-\x7e]{1,64}$/.test(name) || anims.get(keyOf(kind, name))) return toast.error("Choose a new name of letters, digits and symbols, without spaces");
    const model = kind === "chr" ? { name, frames, loop: true, scalingRule: 0, bones: new Map() } : kind === "srt" ? { name, frames, loop: true, texMtxMode: 0, materials: new Map() }
      : kind === "vis" ? { name, frames, loop: true, bones: new Map() } : { name, frames, loop: true, materials: new Map() };
    const key = keyOf(kind, name);
    setAnims((m) => new Map(m).set(key, { kind, name, model }));
    setChanged((s) => new Set(s).add(key));
    setSelected(key);
  };
  const remove = async () => {
    if (!current || !(await dialogs.confirm({ title: "Delete animation", description: `Remove ${current.name} when you apply?`, confirmLabel: "Delete", destructive: true }))) return;
    setAnims((m) => new Map(m).set(selected, { ...current, deleted: true }));
    setChanged((s) => new Set(s).add(selected));
  };
  const addTarget = (name: string) => update((model) => {
    const frames = model.frames;
    if (current!.kind === "chr") model.bones.set(name, { code: 1, scale: null, rot: [{ const: 0 }, { const: 0 }, { const: 0 }], trans: null });
    else if (current!.kind === "vis") model.bones.set(name, Array(frames + 1).fill(true));
    else if (current!.kind === "srt") model.materials.set(name, [{ index: 0, scale: null, rot: null, trans: [{ keys: [{ f: 0, v: 0, t: 0 }, { f: frames, v: 1, t: 0 }] }, { const: 0 }] }]);
    else if (current!.kind === "clr") model.materials.set(name, [{ target: 0, mask: 0, colors: [[1, 1, 1, 1]] }]);
    else model.materials.set(name, [{ index: 0, keys: [{ frame: 0, texture: textureNames[0] }] }]);
    setTarget(name);
  });
  const setFrames = (frames: number) => update((model) => {
    model.frames = frames;
    if (current!.kind === "vis") for (const [n, list] of model.bones) model.bones.set(n, Array.from({ length: frames + 1 }, (_, f) => list[Math.min(f, list.length - 1)]));
    if (current!.kind === "clr") for (const [, list] of model.materials) for (const t of list) if (t.colors.length > 1) t.colors = colourList(colourKeys(t.colors).map((k) => ({ f: Math.min(k.f, frames), c: k.c })), frames);
  });

  const apply = async () => {
    setApplying(true);
    try {
      const changes: { folder: string; name: string; data: Uint8Array | null }[] = [];
      for (const key of changed) {
        const entry = anims.get(key)!, info = KINDS.find((k) => k.kind === entry.kind)!;
        // A new animation deleted again leaves nothing to write.
        if (entry.deleted) { if (parsed[entry.kind].has(entry.name)) changes.push({ folder: info.folder, name: entry.name, data: null }); }
        else changes.push({ folder: info.folder, name: entry.name, data: info.write(entry.model) });
      }
      close(changes.length ? await api.changeBRRESResources(brres, changes) : null);
    } catch (e: any) { toast.error("Could not write the animations", { description: e.message }); }
    finally { setApplying(false); }
  };
  const leave = async () => { if (!changed.size || await dialogs.confirm({ title: "Close without applying?", description: "The changes to the animations will be lost.", confirmLabel: "Close without applying", destructive: true })) close(null); };

  const model = current?.model, kind = current?.kind as Kind | undefined;
  const addable = !current ? [] : (kind === "chr" || kind === "vis" ? boneNames : materialNames).filter((n) => !targets.includes(n));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" data-animation-editor onKeyDown={(e) => e.stopPropagation()}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <DialogTitle className="text-base">Animations{title ? ` · ${title}` : ""}</DialogTitle>
          <DialogDescription className="text-xs">Keyframes of every animation in this model file. Frames run at 60 per second; rotations are in degrees. Apply writes the changed animations.</DialogDescription>
        </div>
        <Button size="icon-sm" variant="ghost" aria-label="Close animations" onClick={() => void leave()}><X /></Button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[220px_200px_minmax(0,1fr)] gap-3 overflow-hidden">
        <div className="flex min-h-0 flex-col rounded-md border">
          <div className="min-h-0 flex-1 overflow-y-auto p-1">
            {KINDS.map(({ kind: k, label }) => {
              const list = [...anims.values()].filter((a) => a.kind === k && !a.deleted);
              if (!list.length) return null;
              return <div key={k} className="mb-1">
                <div className="px-1.5 py-1 text-[11px] font-medium text-muted-foreground">{label}</div>
                {list.map((a) => <button key={a.name} type="button" onClick={() => setSelected(keyOf(a.kind, a.name))}
                  className={cn("flex w-full cursor-pointer items-center gap-1 rounded px-2 py-1 text-left text-xs hover:bg-accent/60", keyOf(a.kind, a.name) === selected && "bg-accent")}>
                  <span className="min-w-0 flex-1 truncate">{a.name}</span>{changed.has(keyOf(a.kind, a.name)) && <span className="size-1.5 rounded-full bg-primary" title="Changed" />}
                </button>)}
              </div>;
            })}
          </div>
          <div className="flex gap-1 border-t p-1.5">
            <Button size="sm" variant="secondary" className="h-7 flex-1 text-xs" onClick={() => void create()}><Plus /> New</Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={!current || current.deleted} onClick={() => void remove()}><Trash2 /> Delete</Button>
          </div>
        </div>
        <div className="flex min-h-0 flex-col rounded-md border">
          {current && !current.deleted ? <>
            <div className="space-y-1.5 border-b p-2 text-xs">
              <label className="flex items-center justify-between gap-2">Frames <NumberField commit integer min={1} max={65535} value={model.frames} onValue={setFrames} className="h-7 w-20 text-xs" aria-label="Frames" /></label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={!!model.loop} onChange={(e) => update((m) => { m.loop = e.target.checked; })} /> Loop</label>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-1">
              {targets.map((t) => <div key={t} className={cn("flex items-center rounded hover:bg-accent/60", t === currentTarget && "bg-accent")}>
                <button type="button" onClick={() => setTarget(t)} className="min-w-0 flex-1 cursor-pointer truncate px-2 py-1 text-left text-xs">{t}</button>
                <Button size="icon-sm" variant="ghost" aria-label={`Remove ${t}`} onClick={() => update((m) => { (kind === "chr" || kind === "vis" ? m.bones : m.materials).delete(t); })}><Trash2 /></Button>
              </div>)}
              {!targets.length && <p className="m-0 p-2 text-xs text-muted-foreground">Nothing animated yet.</p>}
            </div>
            {addable.length > 0 && <div className="border-t p-1.5">
              <Select value="" onValueChange={addTarget}>
                <SelectTrigger className="h-7 text-xs" aria-label="Add a bone or material"><SelectValue placeholder={kind === "chr" || kind === "vis" ? "Add a bone…" : "Add a material…"} /></SelectTrigger>
                <SelectContent>{addable.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent>
              </Select>
            </div>}
          </> : <p className="m-0 p-3 text-xs text-muted-foreground">{current?.deleted ? "Deleted when you apply." : "No animation chosen."}</p>}
        </div>
        <div className="min-h-0 space-y-2 overflow-y-auto pr-1">
          {current && !current.deleted && currentTarget && kind === "chr" && (() => {
            const bone = model.bones.get(currentTarget);
            const part = (comp: "scale" | "rot" | "trans", name: string, rest: number) => <div key={comp} className="space-y-1.5">
              <label className="flex items-center gap-2 text-xs font-medium"><input type="checkbox" checked={!!bone[comp]} onChange={(e) => update((m) => { m.bones.get(currentTarget)[comp] = e.target.checked ? [0, 1, 2].map(() => ({ const: rest })) : null; })} /> {name}</label>
              {bone[comp] && AXES.map((axis, i) => <TrackEditor key={axis} label={`${name} ${axis}`} track={asEditable(bone[comp][i])} frames={model.frames} removable={false}
                onChange={(t) => update((m) => { const b = m.bones.get(currentTarget); b[comp] = b[comp].map((x: any, j: number) => j === i ? t : x); })} />)}
            </div>;
            return [part("scale", "Scale", 1), part("rot", "Rotation (degrees)", 0), part("trans", "Translation", 0)];
          })()}
          {current && !current.deleted && currentTarget && kind === "srt" && model.materials.get(currentTarget).map((tex: any, n: number) => {
            const set = (fn: (t: any) => void) => update((m) => { fn(m.materials.get(currentTarget)[n]); });
            const comp = (key: "scale" | "rot" | "trans", label: string, count: number, rest: number) => <div key={key} className="space-y-1.5">
              <label className="flex items-center gap-2 text-xs font-medium"><input type="checkbox" checked={!!tex[key]} onChange={(e) => set((t) => { t[key] = e.target.checked ? (count === 1 ? { const: rest } : [{ const: rest }, { const: rest }]) : null; })} /> {label}</label>
              {tex[key] && (count === 1 ? [tex[key]] : tex[key]).map((track: any, i: number) => <TrackEditor key={i} label={`${label}${count > 1 ? ` ${"UV"[i]}` : ""}`} track={asEditable(track)} frames={model.frames} removable={false}
                onChange={(t) => set((x) => { if (count === 1) x[key] = t; else x[key] = x[key].map((y: any, j: number) => j === i ? t : y); })} />)}
            </div>;
            return <div key={n} className="space-y-2 rounded-md border p-2">
              <div className="flex items-center gap-2 text-xs font-medium">{tex.index < 8 ? `Texture matrix ${tex.index}` : `Indirect matrix ${tex.index - 8}`}</div>
              {comp("scale", "Scale", 2, 1)}{comp("rot", "Rotation (degrees)", 1, 0)}{comp("trans", "Translation", 2, 0)}
            </div>;
          })}
          {current && !current.deleted && currentTarget && kind === "clr" && model.materials.get(currentTarget).map((t: any, n: number) => {
            const keys = colourKeys(t.colors);
            const setKeys = (next: { f: number; c: number[] }[]) => update((m) => { m.materials.get(currentTarget)[n].colors = next.length === 1 && next[0].f === 0 ? [next[0].c] : colourList(next, m.frames); });
            return <div key={n} className="space-y-1.5 rounded-md border p-2" data-clr-target={t.target}>
              <div className="text-xs font-medium">{CLR_TARGETS[t.target] || `Register ${t.target}`}</div>
              <div className="flex h-4 overflow-hidden rounded border">{colourList(keys, model.frames).filter((_, f, a) => f % Math.max(1, Math.ceil(a.length / 120)) === 0).map((c, i) => <span key={i} className="flex-1" style={{ background: hex(c) }} />)}</div>
              {keys.map((k, i) => <div key={i} className="flex items-center gap-1.5">
                <NumberField commit integer min={0} max={model.frames} aria-label={`Colour key ${i + 1} frame`} value={k.f} onValue={(f) => setKeys(keys.map((x, j) => j === i ? { ...x, f } : x))} className="h-6 w-16 text-[11px]" />
                <input type="color" aria-label={`Colour key ${i + 1}`} value={hex(k.c)} onChange={(e) => setKeys(keys.map((x, j) => j === i ? { ...x, c: fromHex(e.target.value, x.c[3]) } : x))} />
                <NumberField commit min={0} max={255} integer aria-label={`Colour key ${i + 1} alpha`} value={Math.round(k.c[3] * 255)} onValue={(a) => setKeys(keys.map((x, j) => j === i ? { ...x, c: [...x.c.slice(0, 3), a / 255] } : x))} className="h-6 w-14 text-[11px]" />
                <Button size="icon-sm" variant="ghost" aria-label={`Delete colour key ${i + 1}`} disabled={keys.length <= 1} onClick={() => setKeys(keys.filter((_, j) => j !== i))}><Trash2 /></Button>
              </div>)}
              <Button size="sm" variant="secondary" className="h-6 px-2 text-[11px]" onClick={() => setKeys([...keys, { f: Math.min(model.frames, (keys.at(-1)?.f ?? 0) + 10), c: [...(keys.at(-1)?.c ?? [1, 1, 1, 1])] }])}><Plus /> Colour key</Button>
            </div>;
          })}
          {current && !current.deleted && currentTarget && kind === "pat" && model.materials.get(currentTarget).map((slot: any, n: number) => {
            const setSlot = (keys: any[]) => update((m) => { m.materials.get(currentTarget)[n].keys = [...keys].sort((a, b) => a.frame - b.frame); });
            return <div key={n} className="space-y-1.5 rounded-md border p-2">
              <div className="text-xs font-medium">Texture slot {slot.index}</div>
              {slot.keys.map((k: any, i: number) => <div key={i} className="flex items-center gap-1.5">
                <NumberField commit aria-label={`Swap ${i + 1} frame`} value={k.frame} onValue={(frame) => setSlot(slot.keys.map((x: any, j: number) => j === i ? { ...x, frame } : x))} className="h-6 w-16 text-[11px]" />
                <Select value={k.texture ?? ""} onValueChange={(texture) => setSlot(slot.keys.map((x: any, j: number) => j === i ? { ...x, texture } : x))}>
                  <SelectTrigger className="h-6 flex-1 text-[11px]" aria-label={`Swap ${i + 1} texture`}><SelectValue placeholder="Texture" /></SelectTrigger>
                  <SelectContent>{[...new Set([...(k.texture ? [k.texture] : []), ...textureNames])].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
                <Button size="icon-sm" variant="ghost" aria-label={`Delete swap ${i + 1}`} disabled={slot.keys.length <= 1} onClick={() => setSlot(slot.keys.filter((_: any, j: number) => j !== i))}><Trash2 /></Button>
              </div>)}
              <Button size="sm" variant="secondary" className="h-6 px-2 text-[11px]" disabled={!textureNames.length} onClick={() => setSlot([...slot.keys, { frame: Math.min(model.frames, (slot.keys.at(-1)?.frame ?? 0) + 10), texture: slot.keys.at(-1)?.texture ?? textureNames[0], ...(slot.keys.at(-1)?.palette ? { palette: slot.keys.at(-1).palette } : {}) }])}><Plus /> Texture swap</Button>
            </div>;
          })}
          {current && !current.deleted && currentTarget && kind === "vis" && (() => {
            const list: boolean[] = model.bones.get(currentTarget);
            const changes = list.map((s, f) => ({ f, s })).filter((x, f) => f === 0 || list[f - 1] !== x.s);
            const setChanges = (next: { f: number; s: boolean }[]) => update((m) => {
              const sorted = [...next].sort((a, b) => a.f - b.f);
              m.bones.set(currentTarget, Array.from({ length: m.frames + 1 }, (_, f) => { let s = sorted[0]?.s ?? true; for (const c of sorted) if (c.f <= f) s = c.s; return s; }));
            });
            return <div className="space-y-1.5 rounded-md border p-2">
              <div className="text-xs font-medium">Shown or hidden from a frame on</div>
              <div className="flex h-4 overflow-hidden rounded border">{list.filter((_, f) => f % Math.max(1, Math.ceil(list.length / 120)) === 0).map((s, i) => <span key={i} className={cn("flex-1", s ? "bg-foreground/70" : "bg-transparent")} />)}</div>
              {changes.map((c, i) => <div key={i} className="flex items-center gap-1.5">
                <NumberField commit integer min={0} max={model.frames} aria-label={`Visibility change ${i + 1} frame`} value={c.f} onValue={(f) => setChanges(changes.map((x, j) => j === i ? { ...x, f } : x))} className="h-6 w-16 text-[11px]" />
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={c.s} onChange={(e) => setChanges(changes.map((x, j) => j === i ? { ...x, s: e.target.checked } : x))} /> Shown</label>
                <Button size="icon-sm" variant="ghost" aria-label={`Delete visibility change ${i + 1}`} disabled={changes.length <= 1} onClick={() => setChanges(changes.filter((_, j) => j !== i))}><Trash2 /></Button>
              </div>)}
              <Button size="sm" variant="secondary" className="h-6 px-2 text-[11px]" onClick={() => setChanges([...changes, { f: Math.min(model.frames, (changes.at(-1)?.f ?? 0) + 10), s: !(changes.at(-1)?.s ?? true) }])}><Plus /> Change</Button>
            </div>;
          })()}
          {current && !current.deleted && !currentTarget && <p className="m-0 p-2 text-xs text-muted-foreground">Add a bone or material to animate.</p>}
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2 border-t pt-2">
        <span className="mr-auto text-xs text-muted-foreground">{changed.size ? `${changed.size} animation${changed.size === 1 ? "" : "s"} changed` : "No changes"}</span>
        <Button size="sm" variant="outline" onClick={() => void leave()}>Cancel</Button>
        <Button size="sm" disabled={!changed.size || applying} onClick={() => void apply()}>{applying ? "Writing…" : "Apply"}</Button>
      </div>
    </div>
  );
}
