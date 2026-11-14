// Material settings of the open track's models. Changes go straight into the model, with undo in
// the main window, and the 3D view redraws them with its own TEV preview.

import * as React from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { BLEND_FACTORS, CULL_MODES, materialsSharingShader, setBRRESMaterial, setBRRESTevStages } from "../../../js/formats/material-edit.js";

// What each TEV stage field means, as the GX documentation names it.
const COLOR_IN = ["Previous colour", "Previous alpha", "Register 0 colour", "Register 0 alpha", "Register 1 colour", "Register 1 alpha", "Register 2 colour", "Register 2 alpha", "Texture colour", "Texture alpha", "Raster (light) colour", "Raster (light) alpha", "One", "Half", "Konst", "Zero"].map((t, i) => [i, t]);
const ALPHA_IN = ["Previous alpha", "Register 0 alpha", "Register 1 alpha", "Register 2 alpha", "Texture alpha", "Raster (light) alpha", "Konst", "Zero"].map((t, i) => [i, t]);
const BIAS = [[0, "None"], [1, "+0.5"], [2, "−0.5"], [3, "Compare mode"]];
const OP = [[0, "Add: D + ((1−C)·A + C·B)"], [1, "Subtract: D − ((1−C)·A + C·B)"]];
const SCALE = [[0, "×1"], [1, "×2"], [2, "×4"], [3, "×0.5"]];
const DEST = [[0, "Previous"], [1, "Register 0"], [2, "Register 1"], [3, "Register 2"]];
const CHANNEL = [[0, "Light channel 0"], [1, "Light channel 1"], [5, "Bump alpha"], [6, "Bump alpha (normalised)"], [7, "None"]];
const KONST_FRACTIONS = [[0, "1"], [1, "7/8"], [2, "3/4"], [3, "5/8"], [4, "1/2"], [5, "3/8"], [6, "1/4"], [7, "1/8"]];
const KONST_PARTS = [16, 20, 24, 28].flatMap((base, c) => [0, 1, 2, 3].map((k) => [base + k, `Konst ${k} ${"RGBA"[c]}`]));
const KCSEL = [...KONST_FRACTIONS, ...[0, 1, 2, 3].map((k) => [12 + k, `Konst ${k} RGB`]), ...KONST_PARTS];
const KASEL = [...KONST_FRACTIONS, ...KONST_PARTS];
const EIGHT = (name: string) => Array.from({ length: 8 }, (_, i) => [i, `${name} ${i}`]);
const SWAP = [0, 1, 2, 3].map((i) => [i, `Swap table ${i}`]);
import { parseBRRES } from "../../../js/formats/brres.js";
import { listFiles } from "../../../js/formats/u8.js";
import { editor } from "../editor";
import { useEditor } from "../hooks";

const toHex = (rgba: number[]) => "#" + rgba.slice(0, 3).map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
const fromHex = (hex: string, alpha = 1) => [...[1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)), Math.round(alpha * 255)];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex items-center gap-2 text-xs"><span className="w-36 shrink-0 text-muted-foreground">{label}</span>{children}</label>;
}

function Colour({ label, value, onCommit }: { label: string; value: number[]; onCommit: (hex: string) => void }) {
  const ref = React.useRef<HTMLInputElement>(null), latest = React.useRef(onCommit);
  latest.current = onCommit;
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const listener = () => latest.current(el.value);
    el.addEventListener("change", listener);
    return () => el.removeEventListener("change", listener);
  }, []);
  React.useEffect(() => { if (ref.current) ref.current.value = toHex(value); }, [value]);
  return <Row label={label}><input ref={ref} type="color" aria-label={label} defaultValue={toHex(value)} className="h-7 w-12 cursor-pointer rounded border bg-transparent p-0.5" /></Row>;
}

export function MaterialsDialog({ close }: { close: (value: any) => void }) {
  useEditor("doc");
  const files = editor.doc.szs ? listFiles(editor.doc.szs).filter((f: any) => /\.brres$/i.test(f.path)) : [];
  const [path, setPath] = React.useState<string>(() => files.find((f: any) => /(^|\/)course_model\.brres$/i.test(f.path))?.path || files[0]?.path || "");
  const [name, setName] = React.useState("");
  const [filter, setFilter] = React.useState("");
  const node = files.find((f: any) => f.path === path)?.node;
  const parsed = React.useMemo(() => { try { return node ? parseBRRES(node.data) : null; } catch { return null; } }, [node?.data]);
  const entries = (parsed?.models || []).flatMap((model: any) => model.materials.map((material: any) => ({ model: model.name, material })));
  const shown = entries.filter((e: any) => e.material.name.toLowerCase().includes(filter.toLowerCase()));
  const current = entries.find((e: any) => e.material.name === name) || shown[0] || null;
  const material = current?.material, gx = material?.gx;
  const apply = (label: string, patch: any) => {
    try { editor.doc.changeArchiveFile(`${label}: ${material.name}`, path, setBRRESMaterial(node.data, current.model, material.name, patch)); }
    catch (e: any) { toast.error("Could not change the material", { description: e.message }); }
  };
  const select = (value: number, options: any[], label: string, onChange: (value: number) => void) =>
    <Row label={label}><select aria-label={label} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-7 min-w-0 flex-1 rounded-md border bg-background px-1.5 text-xs">
      {options.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
    </select></Row>;

  return <div className="flex h-full min-h-0 flex-col gap-3">
    <div className="flex shrink-0 items-start gap-2">
      <div className="min-w-0 flex-1">
        <DialogTitle className="text-sm">Materials</DialogTitle>
        <DialogDescription className="text-xs">How the track's models are drawn. Changes show in the 3D view; Ctrl+Z in the main window undoes them, and saving the SZS keeps them.</DialogDescription>
      </div>
      <Button size="icon-sm" variant="ghost" title="Close" aria-label="Close materials" onClick={() => close(true)}><X /></Button>
    </div>
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-[280px_minmax(0,1fr)]">
      <div className="flex min-h-0 flex-col gap-1.5">
        <select aria-label="Model file" value={path} onChange={(e) => { setPath(e.target.value); setName(""); }} className="h-8 rounded-md border bg-background px-1.5 text-xs">
          {files.map((f: any) => <option key={f.path} value={f.path}>{f.path}</option>)}
        </select>
        <input aria-label="Filter materials" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} className="h-8 rounded-md border bg-background px-2 text-xs" />
        <div className="min-h-0 flex-1 overflow-y-auto border">
          {shown.map((e: any) => <button key={`${e.model}/${e.material.name}`} type="button" onClick={() => setName(e.material.name)}
            className={cn("block w-full cursor-pointer truncate border-b px-2 py-1 text-left text-xs hover:bg-accent", e.material.name === material?.name && "bg-accent")} title={e.material.name}>{e.material.name}</button>)}
        </div>
      </div>
      {!material ? <p className="text-xs text-muted-foreground">No materials in this file.</p> : !gx ? <p className="text-xs text-muted-foreground">The settings of {material.name} could not be read.</p> :
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1">
        <section className="flex flex-col gap-1.5">
          <div className="text-xs font-semibold">{material.name}</div>
          <p className="text-[11px] text-muted-foreground">{material.layers.length ? `Textures: ${material.layers.map((l: any) => l.texture).join(", ")}` : "No textures."} {gx.stages.length} TEV stage{gx.stages.length === 1 ? "" : "s"}.</p>
          {select(material.cull, CULL_MODES, "Faces shown", (cull) => apply("Faces shown", { cull }))}
        </section>
        <section className="flex flex-col gap-1.5">
          <div className="text-xs font-semibold">Transparency</div>
          <Row label="Translucent"><input type="checkbox" aria-label="Translucent" checked={!!material.xlu} onChange={(e) => apply("Translucent", { translucent: e.target.checked, blend: { enabled: e.target.checked, src: 4, dst: 5 }, depthWrite: !e.target.checked })} /></Row>
          <Row label="Blending"><input type="checkbox" aria-label="Blending" checked={!!gx.blend?.enabled} onChange={(e) => apply("Blending", { blend: { enabled: e.target.checked } })} /></Row>
          {gx.blend?.enabled && select(gx.blend.src, BLEND_FACTORS, "Source", (src) => apply("Blend source", { blend: { src } }))}
          {gx.blend?.enabled && select(gx.blend.dst, BLEND_FACTORS, "Target", (dst) => apply("Blend target", { blend: { dst } }))}
          <Row label={`Cut-out below ${gx.alphaTest?.ref0 ?? 0}`}><input type="range" aria-label="Alpha cut-out" min={0} max={255} defaultValue={gx.alphaTest?.ref0 ?? 0} key={`${material.name}/${gx.alphaTest?.ref0}`}
            onPointerUp={(e) => apply("Alpha cut-out", { alpha: { ref: Number(e.currentTarget.value), comp: 6 } })} className="min-w-0 flex-1" /></Row>
          <p className="text-[11px] text-muted-foreground">Translucent materials normally also sit in the model's separate drawing list, which this does not move. Check them in Dolphin: overlapping ones can draw in the wrong order.</p>
        </section>
        <section className="flex flex-col gap-1.5">
          <div className="text-xs font-semibold">Depth</div>
          <Row label="Hidden behind others"><input type="checkbox" aria-label="Depth test" checked={!!gx.zmode?.test} onChange={(e) => apply("Depth test", { depthTest: e.target.checked })} /></Row>
          <Row label="Hides what is behind"><input type="checkbox" aria-label="Depth write" checked={!!gx.zmode?.write} onChange={(e) => apply("Depth write", { depthWrite: e.target.checked })} /></Row>
        </section>
        <TevStages key={material.name} gx={gx} shared={materialsSharingShader(node.data, current.model, material.name)} select={select}
          onChange={(stages: any[]) => { try { editor.doc.changeArchiveFile(`TEV stages: ${material.name}`, path, setBRRESTevStages(node.data, current.model, material.name, stages)); } catch (e: any) { toast.error("Could not change the TEV stages", { description: e.message }); } }} />
        <section className="flex flex-col gap-1.5">
          <div className="text-xs font-semibold">Colours</div>
          {gx.chans.map((chan: any, i: number) => <Colour key={`c${i}`} label={`Material colour ${i + 1}`} value={chan.matColor} onCommit={(hex) => apply("Material colour", { channel: [{ index: i, rgba: fromHex(hex, chan.matColor[3]) }] })} />)}
          {[1, 2, 3].map((i) => <Colour key={`r${i}`} label={`TEV colour ${i}`} value={gx.regs[i]} onCommit={(hex) => apply("TEV colour", { color: [{ index: i, rgba: fromHex(hex, gx.regs[i][3]) }] })} />)}
          {[0, 1, 2, 3].map((i) => <Colour key={`k${i}`} label={`Constant colour ${i}`} value={gx.konst[i]} onCommit={(hex) => apply("Constant colour", { color: [{ index: i, rgba: fromHex(hex, gx.konst[i][3]), konst: true }] })} />)}
          <p className="text-[11px] text-muted-foreground">Which of these change the look depends on how the material's TEV stages use them.</p>
        </section>
      </div>}
    </div>
    <div className="flex shrink-0 justify-end"><Button onClick={() => close(true)}>Done</Button></div>
  </div>;
}

// The material's TEV stages: each one combines four inputs into a colour and an alpha, in order.
function TevStages({ gx, shared, select, onChange }: { gx: any; shared: string[]; select: any; onChange: (stages: any[]) => void }) {
  const [open, setOpen] = React.useState(0);
  const stages = gx.stages;
  const set = (i: number, fn: (s: any) => void) => { const next = structuredClone(stages); fn(next[i]); onChange(next); };
  const others = shared.length - 1;
  return <section className="flex flex-col gap-1.5" data-tev-stages>
    <div className="text-xs font-semibold">TEV stages ({stages.length})</div>
    <p className="text-[11px] text-muted-foreground">Each stage computes D ± ((1 − C)·A + C·B), with bias and scale, into an output register; the last stage's colour and alpha are the pixel's.{others > 0 ? ` This shader is shared with ${others} other material${others === 1 ? "" : "s"} (${shared.join(", ")}): they change too.` : ""}</p>
    {stages.map((stage: any, i: number) => <div key={i} className="rounded-md border">
      <button type="button" className="flex w-full cursor-pointer items-center px-2 py-1 text-left text-xs hover:bg-accent/60" onClick={() => setOpen(open === i ? -1 : i)} aria-expanded={open === i}>
        <span className="flex-1 font-medium">Stage {i}</span><span className="text-muted-foreground">{stage.texEnabled ? `texture map ${stage.texMap}` : "no texture"}</span>
      </button>
      {open === i && <div className="flex flex-col gap-1.5 border-t p-2">
        <div className="text-[11px] font-medium text-muted-foreground">Inputs</div>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!stage.texEnabled} onChange={(e) => set(i, (s) => { s.texEnabled = e.target.checked; })} /> Uses a texture</label>
        {stage.texEnabled && select(stage.texMap, EIGHT("Texture map"), "Texture", (v: number) => set(i, (s) => { s.texMap = v; }))}
        {stage.texEnabled && select(stage.texCoord, EIGHT("Coordinates"), "Coordinates", (v: number) => set(i, (s) => { s.texCoord = v; }))}
        {select(stage.channel, CHANNEL, "Raster", (v: number) => set(i, (s) => { s.channel = v; }))}
        {select(stage.kcsel, KCSEL, "Konst colour", (v: number) => set(i, (s) => { s.kcsel = v; }))}
        {select(stage.kasel, KASEL, "Konst alpha", (v: number) => set(i, (s) => { s.kasel = v; }))}
        <div className="text-[11px] font-medium text-muted-foreground">Colour</div>
        {(["a", "b", "c", "d"] as const).map((k) => <React.Fragment key={k}>{select(stage.color[k], COLOR_IN, k.toUpperCase(), (v: number) => set(i, (s) => { s.color[k] = v; }))}</React.Fragment>)}
        {select(stage.color.sub, OP, "Operation", (v: number) => set(i, (s) => { s.color.sub = v; }))}
        {select(stage.color.bias, BIAS, "Bias", (v: number) => set(i, (s) => { s.color.bias = v; }))}
        {select(stage.color.scale, SCALE, "Scale", (v: number) => set(i, (s) => { s.color.scale = v; }))}
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!stage.color.clamp} onChange={(e) => set(i, (s) => { s.color.clamp = e.target.checked ? 1 : 0; })} /> Clamp colour to 0–1</label>
        {select(stage.color.dest, DEST, "Output", (v: number) => set(i, (s) => { s.color.dest = v; }))}
        <div className="text-[11px] font-medium text-muted-foreground">Alpha</div>
        {(["a", "b", "c", "d"] as const).map((k) => <React.Fragment key={k}>{select(stage.alpha[k], ALPHA_IN, k.toUpperCase(), (v: number) => set(i, (s) => { s.alpha[k] = v; }))}</React.Fragment>)}
        {select(stage.alpha.sub, OP, "Operation", (v: number) => set(i, (s) => { s.alpha.sub = v; }))}
        {select(stage.alpha.bias, BIAS, "Bias", (v: number) => set(i, (s) => { s.alpha.bias = v; }))}
        {select(stage.alpha.scale, SCALE, "Scale", (v: number) => set(i, (s) => { s.alpha.scale = v; }))}
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!stage.alpha.clamp} onChange={(e) => set(i, (s) => { s.alpha.clamp = e.target.checked ? 1 : 0; })} /> Clamp alpha to 0–1</label>
        {select(stage.alpha.dest, DEST, "Output", (v: number) => set(i, (s) => { s.alpha.dest = v; }))}
        {select(stage.alpha.rswap, SWAP, "Raster swap", (v: number) => set(i, (s) => { s.alpha.rswap = v; }))}
        {select(stage.alpha.tswap, SWAP, "Texture swap", (v: number) => set(i, (s) => { s.alpha.tswap = v; }))}
      </div>}
    </div>)}
    <div className="flex gap-2">
      <Button size="sm" variant="secondary" disabled={stages.length >= 16} onClick={() => {
        // A new stage passes the previous result on: D = previous, A = B = C = zero.
        const last = structuredClone(stages.at(-1));
        const next = [...structuredClone(stages), { ...last, texEnabled: false, color: { a: 15, b: 15, c: 15, d: 0, bias: 0, sub: 0, clamp: 1, scale: 0, dest: 0 }, alpha: { ...last.alpha, a: 7, b: 7, c: 7, d: 0, bias: 0, sub: 0, clamp: 1, scale: 0, dest: 0 } }];
        onChange(next); setOpen(next.length - 1);
      }}>Add stage</Button>
      <Button size="sm" variant="ghost" disabled={stages.length <= 1} onClick={() => onChange(structuredClone(stages).slice(0, -1))}>Remove last stage</Button>
    </div>
    <p className="text-[11px] text-muted-foreground">A new stage passes the previous result on unchanged. Check unusual combinations in Dolphin.</p>
  </section>;
}
