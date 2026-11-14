// The vertices of one model part, value by value: its texture coordinates on a 2D view of the
// texture (drag points, or select some and type) and its positions in a table. Changes are made in
// place (setBRRESVertexValues); Apply resolves with the new BRRES, or null.

import * as React from "react";
import { FlipHorizontal2, FlipVertical2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { NumberField } from "../number-field";
import { parseBRRES, partsSharingVertices, setBRRESVertexValues, textureRGBA } from "../../../js/formats/brres.js";

const VIEW = 420;

export function VertexEditorDialog({ brres, modelName, partName, close }: { brres: Uint8Array; modelName: string; partName: string; close: (v: Uint8Array | null) => void }) {
  const [data, setData] = React.useState(brres);
  const parsed = React.useMemo(() => parseBRRES(data), [data]);
  const model = parsed.models.find((m: any) => m.name === modelName);
  const partIndex = model?.objects.findIndex((o: any) => o.name === partName) ?? -1, part = model?.objects[partIndex];
  const sets = part ? Object.keys(part.uvIds || {}).map(Number) : [];
  const [tab, setTab] = React.useState<"uv" | "pos">(sets.length ? "uv" : "pos");
  const [set, setSet] = React.useState(sets[0] ?? 0);
  const [selected, setSelected] = React.useState<Set<number>>(new Set());
  const [view, setView] = React.useState({ cx: 0.5, cy: 0.5, scale: 1 });
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const drag = React.useRef<{ kind: "move" | "box" | "pan"; x: number; y: number; start?: Map<number, number[]>; box?: number[]; cx?: number; cy?: number } | null>(null);
  const [box, setBox] = React.useState<number[] | null>(null);
  // The texture under the UVs: the first layer of the part's material.
  const material = model?.materials[model.draws.find((d: any) => d.object === partIndex)?.material ?? -1];
  const texture = parsed.textures.get(material?.layers?.[0]?.texture);
  const image = React.useMemo(() => {
    if (!texture) return null;
    try { const rgba = textureRGBA(parsed, texture); const c = new OffscreenCanvas(texture.width, texture.height); c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(rgba), texture.width, texture.height), 0, 0); return c; } catch { return null; }
  }, [texture?.name, data]);
  const arrayId = part?.uvArrayIds?.[set], uvArray = model?.arrays.uv.get(arrayId);
  const ids: Int32Array = part?.uvIds?.[set] ?? new Int32Array();
  const entries = [...new Set([...ids].filter((i) => i >= 0))];
  const uv = (i: number) => [uvArray.data[i * 2], uvArray.data[i * 2 + 1]];
  const toScreen = (u: number, v: number) => [VIEW / 2 + (u - view.cx) * VIEW * view.scale, VIEW / 2 + (v - view.cy) * VIEW * view.scale];
  const toUV = (x: number, y: number) => [view.cx + (x - VIEW / 2) / (VIEW * view.scale), view.cy + (y - VIEW / 2) / (VIEW * view.scale)];
  const write = (kind: "uv" | "pos", array: number, changes: Map<number, number[]>) => {
    try { setData((d) => setBRRESVertexValues(d, modelName, kind, array, changes)); }
    catch (e: any) { toast.error("Could not change the vertices", { description: e.message }); }
  };
  const shared = !model || !part ? [] : tab === "uv" ? (uvArray ? partsSharingVertices(model, "uv", arrayId, entries, partIndex) : []) : partsSharingVertices(model, "pos", part.positionArrayId, part.positionIndices, partIndex);

  React.useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx || tab !== "uv" || !uvArray) return;
    ctx.fillStyle = "#14181c"; ctx.fillRect(0, 0, VIEW, VIEW);
    // The texture repeats: draw the tiles around 0–1 that are in view.
    if (image) for (let ty = -2; ty <= 2; ty++) for (let tx = -2; tx <= 2; tx++) {
      const [x0, y0] = toScreen(tx, ty), [x1, y1] = toScreen(tx + 1, ty + 1);
      ctx.globalAlpha = tx === 0 && ty === 0 ? 1 : 0.35; ctx.drawImage(image, x0, y0, x1 - x0, y1 - y0);
    }
    ctx.globalAlpha = 1;
    const [ox, oy] = toScreen(0, 0), [ex, ey] = toScreen(1, 1);
    ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.setLineDash([4, 4]); ctx.strokeRect(ox, oy, ex - ox, ey - oy); ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(125,211,252,.9)"; ctx.lineWidth = 1;
    for (let k = 0; k + 2 < ids.length; k += 3) {
      if (ids[k] < 0 || ids[k + 1] < 0 || ids[k + 2] < 0) continue;
      const p = [0, 1, 2].map((j) => toScreen(...(uv(ids[k + j]) as [number, number])));
      ctx.beginPath(); ctx.moveTo(p[0][0], p[0][1]); ctx.lineTo(p[1][0], p[1][1]); ctx.lineTo(p[2][0], p[2][1]); ctx.closePath(); ctx.stroke();
    }
    for (const i of entries) {
      const [x, y] = toScreen(...(uv(i) as [number, number]));
      ctx.fillStyle = selected.has(i) ? "#fbbf24" : "#e5e7eb"; ctx.fillRect(x - 2.5, y - 2.5, 5, 5);
    }
    if (box) { ctx.strokeStyle = "#fbbf24"; ctx.strokeRect(box[0], box[1], box[2] - box[0], box[3] - box[1]); }
  });

  const local = (e: React.PointerEvent) => { const r = canvas.current!.getBoundingClientRect(); return [(e.clientX - r.left) * VIEW / r.width, (e.clientY - r.top) * VIEW / r.height]; };
  const nearest = (x: number, y: number) => {
    let best = -1, distance = 8;
    for (const i of entries) { const [px, py] = toScreen(...(uv(i) as [number, number])); const d = Math.hypot(px - x, py - y); if (d < distance) { distance = d; best = i; } }
    return best;
  };
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const [x, y] = local(e);
    if (e.button !== 0) { drag.current = { kind: "pan", x, y, cx: view.cx, cy: view.cy }; return; }
    const hit = nearest(x, y);
    if (hit >= 0) {
      const next = selected.has(hit) ? selected : e.shiftKey ? new Set([...selected, hit]) : new Set([hit]);
      setSelected(next);
      drag.current = { kind: "move", x, y, start: new Map([...next].map((i) => [i, uv(i)])) };
    } else drag.current = { kind: "box", x, y };
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current; if (!d) return;
    const [x, y] = local(e);
    if (d.kind === "pan") setView((v) => ({ ...v, cx: d.cx! - (x - d.x) / (VIEW * v.scale), cy: d.cy! - (y - d.y) / (VIEW * v.scale) }));
    else if (d.kind === "box") setBox([Math.min(d.x, x), Math.min(d.y, y), Math.max(d.x, x), Math.max(d.y, y)]);
  };
  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current; drag.current = null;
    if (!d) return;
    const [x, y] = local(e);
    if (d.kind === "move" && (x !== d.x || y !== d.y)) {
      const du = (x - d.x) / (VIEW * view.scale), dv = (y - d.y) / (VIEW * view.scale);
      write("uv", arrayId, new Map([...d.start!].map(([i, [u, v]]) => [i, [u + du, v + dv]])));
    }
    if (d.kind === "box") {
      const b = [Math.min(d.x, x), Math.min(d.y, y), Math.max(d.x, x), Math.max(d.y, y)];
      setSelected(new Set(entries.filter((i) => { const [px, py] = toScreen(...(uv(i) as [number, number])); return px >= b[0] && px <= b[2] && py >= b[1] && py <= b[3]; })));
      setBox(null);
    }
  };
  const transformSelected = (fn: (u: number, v: number, center: number[]) => number[]) => {
    const list = [...selected].filter((i) => entries.includes(i)); if (!list.length) return;
    const center = [list.reduce((s, i) => s + uv(i)[0], 0) / list.length, list.reduce((s, i) => s + uv(i)[1], 0) / list.length];
    write("uv", arrayId, new Map(list.map((i) => [i, fn(uv(i)[0], uv(i)[1], center)])));
  };
  const one = selected.size === 1 ? [...selected][0] : -1;

  if (!model || !part) return <p className="text-xs">Model part {partName} not found.</p>;
  const positions = model.arrays.pos.get(part.positionArrayId);
  return <div className="flex min-h-0 flex-1 flex-col gap-3" data-vertex-editor onKeyDown={(e) => e.stopPropagation()}>
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <DialogTitle className="text-base">Vertices and UVs · {partName}</DialogTitle>
        <DialogDescription className="text-xs">Values of this part&apos;s vertices, changed in place in their arrays. Values keep the array&apos;s storage format, so very large or very precise numbers may be refused or rounded.</DialogDescription>
      </div>
      <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={() => close(null)}><X /></Button>
    </div>
    <div className="flex gap-1 border-b" role="tablist">
      {sets.length > 0 && <button type="button" role="tab" aria-selected={tab === "uv"} className={cn("-mb-px border-b-2 px-3 py-1 text-xs", tab === "uv" ? "border-foreground" : "border-transparent text-muted-foreground")} onClick={() => setTab("uv")}>Texture coordinates</button>}
      <button type="button" role="tab" aria-selected={tab === "pos"} className={cn("-mb-px border-b-2 px-3 py-1 text-xs", tab === "pos" ? "border-foreground" : "border-transparent text-muted-foreground")} onClick={() => setTab("pos")}>Positions</button>
    </div>
    {shared.length > 0 && <p className="m-0 text-[11px] text-muted-foreground">These values are shared with {shared.join(", ")}: they change too.</p>}
    {tab === "uv" && uvArray && <div className="grid min-h-0 flex-1 grid-cols-[auto_minmax(0,1fr)] gap-3">
      <div className="flex flex-col gap-1.5">
        <canvas ref={canvas} width={VIEW} height={VIEW} className="size-[420px] cursor-crosshair rounded border" aria-label="Texture coordinates"
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onContextMenu={(e) => e.preventDefault()}
          onWheel={(e) => setView((v) => ({ ...v, scale: Math.max(0.1, Math.min(40, v.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15))) }))} />
        <p className="m-0 text-[11px] text-muted-foreground">Drag points to move them; drag on empty space to select several (Shift adds). Right-drag moves the view, wheel zooms. The dashed square is the texture once (0 to 1).</p>
      </div>
      <div className="flex min-h-0 flex-col gap-2 overflow-y-auto text-xs">
        {sets.length > 1 && <label className="flex items-center gap-2">Set <select aria-label="Texture coordinate set" value={set} onChange={(e) => { setSet(Number(e.target.value)); setSelected(new Set()); }} className="h-7 rounded border bg-background px-1">{sets.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>}
        <div>{selected.size} of {entries.length} selected · texture {texture?.name ?? "none"}</div>
        {one >= 0 && <div className="flex items-center gap-1.5">U <NumberField commit aria-label="U" value={uv(one)[0]} onValue={(u) => write("uv", arrayId, new Map([[one, [u, uv(one)[1]]]]))} className="h-7 w-24 text-xs" />
          V <NumberField commit aria-label="V" value={uv(one)[1]} onValue={(v) => write("uv", arrayId, new Map([[one, [uv(one)[0], v]]]))} className="h-7 w-24 text-xs" /></div>}
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="secondary" disabled={!selected.size} onClick={() => transformSelected((u, v, c) => [2 * c[0] - u, v])}><FlipHorizontal2 /> Flip U</Button>
          <Button size="sm" variant="secondary" disabled={!selected.size} onClick={() => transformSelected((u, v, c) => [u, 2 * c[1] - v])}><FlipVertical2 /> Flip V</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(entries))}>Select all</Button>
          <Button size="sm" variant="ghost" onClick={() => setView({ cx: 0.5, cy: 0.5, scale: 1 })}>Fit 0–1</Button>
        </div>
      </div>
    </div>}
    {tab === "pos" && positions && <div className="min-h-0 flex-1 overflow-y-auto rounded border">
      <table className="w-full text-xs"><thead className="sticky top-0 bg-background"><tr className="text-left text-muted-foreground"><th className="px-2 py-1">Vertex</th><th>X</th><th>Y</th><th>Z</th></tr></thead>
        <tbody>{part.positionIndices.slice(0, 2000).map((i: number) => <tr key={i} className="border-t">
          <td className="px-2 py-0.5 tabular-nums">{i}</td>
          {[0, 1, 2].map((c) => <td key={c} className="py-0.5 pr-1"><NumberField commit aria-label={`Vertex ${i} ${"XYZ"[c]}`} value={positions.data[i * 3 + c]} onValue={(x) => write("pos", part.positionArrayId, new Map([[i, [0, 1, 2].map((k) => k === c ? x : positions.data[i * 3 + k])]]))} className="h-6 text-[11px]" /></td>)}
        </tr>)}</tbody>
      </table>
      {part.positionIndices.length > 2000 && <p className="m-2 text-[11px] text-muted-foreground">The first 2000 of {part.positionIndices.length} vertices are listed.</p>}
    </div>}
    <div className="flex justify-end gap-2 border-t pt-2">
      <Button size="sm" variant="outline" onClick={() => close(null)}>Cancel</Button>
      <Button size="sm" disabled={data === brres} onClick={() => close(data)}>Apply</Button>
    </div>
  </div>;
}
