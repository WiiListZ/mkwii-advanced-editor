// Material settings of the open track's models. Changes go straight into the model, with undo in
// the main window, and the 3D view redraws them with its own TEV preview.

import * as React from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { BLEND_FACTORS, CULL_MODES, setBRRESMaterial } from "../../../js/formats/material-edit.js";
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
