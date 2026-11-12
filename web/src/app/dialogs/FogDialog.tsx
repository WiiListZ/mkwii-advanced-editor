// The fog of the open track (posteffect/posteffect.bfg), with a picture of it on the track. Changes go
// into the track on Apply, as a step that can be undone.

import * as React from "react";
import { toast } from "sonner";
import * as THREE from "three";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { FogPreview } from "../../../js/editor/fog-preview.js";
import { BFG_ENTRIES, buildBFG, emptyFogEntry, fadeFrames, fadeValue, FOG_HELP, FOG_KIND_HELP, FOG_TYPES, parseBFG } from "../../../js/formats/bfg.js";
import { listFiles } from "../../../js/formats/u8.js";
import { InfoTip } from "../common";
import { editor } from "../editor";
import { NumberField } from "../number-field";

const FOG_PATH = "posteffect/posteffect.bfg";
const WIDTH = 640, HEIGHT = 360;
const toHex = (c: number[]) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
const fromHex = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));

// A name with its explanation beside it.
function Named({ label, help, className }: { label: string; help: string; className?: string }) {
  return <span className={`flex shrink-0 items-center gap-1 ${className || ""}`} data-fog-help={label}>{label} <InfoTip title={label} text={help} /></span>;
}

function Row({ label, help, children }: { label: string; help: string; children: React.ReactNode }) {
  return <div className="flex items-center gap-2 text-xs"><Named label={label} help={help} className="w-28 text-muted-foreground" />{children}</div>;
}

export function FogDialog({ close }: { close: (value: any) => void }) {
  const doc = editor.doc, viewport = editor.viewport;
  const file = React.useMemo(() => listFiles(doc.szs).find((item: any) => /(^|[\\/])posteffect\.bfg$/i.test(item.path)), []);
  const [entries, setEntries] = React.useState<any[]>(() => {
    try { return file ? parseBFG(file.node.data) : Array.from({ length: BFG_ENTRIES }, emptyFogEntry); }
    catch (e: any) { toast.error("Could not read the fog file", { description: e.message }); return Array.from({ length: BFG_ENTRIES }, emptyFogEntry); }
  });
  const [current, setCurrent] = React.useState(0);
  const [view, setView] = React.useState<"view" | "start">("view");
  const [changed, setChanged] = React.useState(false);
  const [, showAreas] = React.useState(0);
  const entry = entries[current];
  const edit = (patch: any) => { setEntries((list) => list.map((item, i) => i === current ? { ...item, ...patch } : item)); setChanged(true); };
  const areas = doc.kmp.AREA.map((area: any, index: number) => ({ area, index })).filter(({ area }: any) => area.type === 2 && area.setting1 === current);

  // The picture: the track's distances are drawn when the view changes, and the fog over them on each edit.
  const canvas = React.useRef<HTMLCanvasElement>(null), preview = React.useRef<any>(null);
  React.useEffect(() => {
    preview.current = new FogPreview(viewport, WIDTH, HEIGHT);
    return () => { preview.current.dispose(); viewport.needsRender = true; };
  }, []);
  React.useEffect(() => {
    const camera = new THREE.PerspectiveCamera(viewport.camera.fov, WIDTH / HEIGHT, viewport.camera.near, viewport.camera.far);
    const start = doc.kmp.KTPT[0];
    if (view === "start" && start) {
      const heading = (start.rot?.[1] || 0) * Math.PI / 180, [x, y, z] = start.pos;
      camera.position.set(x - Math.sin(heading) * 900, y + 400, z - Math.cos(heading) * 900);
      camera.lookAt(x + Math.sin(heading) * 1000, y + 150, z + Math.cos(heading) * 1000);
    } else {
      camera.position.copy(viewport.camera.position);
      camera.quaternion.copy(viewport.camera.quaternion);
    }
    camera.updateMatrixWorld();
    preview.current.draw(camera);
    if (canvas.current) preview.current.show(canvas.current, entries[current]);
  }, [view]);
  React.useEffect(() => { if (canvas.current) preview.current.show(canvas.current, entry); }, [entry]);

  const apply = () => {
    try {
      doc.changeArchiveFile("Fog", file?.path || FOG_PATH, buildBFG(entries, file?.node.data));
      close(true);
    } catch (e: any) { toast.error("Could not change the fog", { description: e.message }); }
  };
  const addArea = () => {
    try {
      editor.ops.add("AREA", editor.settings.viewCenter(), { fields: { type: 2, setting1: current } });
      showAreas((n) => n + 1);
      toast.success(`Area added for fog entry ${current}`, { description: "Move and size it in the 3D view: inside it the game swaps to this fog." });
    } catch (e: any) { toast.error("Could not add the area", { description: e.message }); }
  };

  return <div className="flex h-full min-h-0 flex-col gap-3">
    <div className="shrink-0">
      <DialogTitle className="text-sm">Fog of this track</DialogTitle>
      <DialogDescription className="text-xs">Four fog settings. Original tracks use the first as the track's fog; an area of type "Fog Swap" changes to another while a kart is inside it.</DialogDescription>
    </div>
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto md:grid-cols-[300px_minmax(0,1fr)]">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1">
          <span data-fog-help="Settings"><InfoTip title="Fog settings" text={FOG_HELP.settings} /></span>
          {entries.map((_, i) => <Button key={i} size="sm" variant={current === i ? "secondary" : "ghost"} className="h-7 flex-1 px-2 text-xs" aria-pressed={current === i} onClick={() => setCurrent(i)}>Fog {i}</Button>)}
        </div>
        <Row label="Kind" help={FOG_HELP.kind}><select aria-label="Fog kind" value={entry.type} onChange={(e) => edit({ type: Number(e.target.value) })} className="h-7 min-w-0 flex-1 rounded-md border bg-background px-1.5 text-xs">
          {FOG_TYPES.map(([id, name]: any) => <option key={id} value={id}>{name}</option>)}
        </select></Row>
        <p className="m-0 text-[11px] leading-snug text-muted-foreground" data-fog-kind-help>{(FOG_KIND_HELP as any)[entry.type] ?? ""}</p>
        <Row label="Colour" help={FOG_HELP.colour}><input type="color" aria-label="Fog colour" value={toHex(entry.color)} disabled={!entry.type} onChange={(e) => edit({ color: fromHex(e.target.value) })} className="h-7 w-14 cursor-pointer rounded border bg-background" /></Row>
        <Row label="Starts at" help={FOG_HELP.start}><NumberField commit aria-label="Fog start" value={entry.start} disabled={!entry.type} onValue={(start: number) => edit({ start })} className="h-7 min-w-0 flex-1 px-1.5 text-xs" /></Row>
        <Row label="Thickest at" help={FOG_HELP.end}><NumberField commit aria-label="Fog end" value={entry.end} disabled={!entry.type} onValue={(end: number) => edit({ end })} className="h-7 min-w-0 flex-1 px-1.5 text-xs" /></Row>
        <Row label="Fade, in frames" help={FOG_HELP.fade}><NumberField commit integer aria-label="Fog fade frames" value={fadeFrames(entry.fade)} min={0} max={100000} disabled={!entry.type} onValue={(frames: number) => edit({ fade: fadeValue(frames) })} className="h-7 w-20 px-1.5 text-xs" /></Row>
        <div className="flex items-center gap-2 text-xs"><input type="checkbox" aria-label="Fog range correction" checked={!!entry.rangeCorrection} disabled={!entry.type} onChange={(e) => edit({ rangeCorrection: e.target.checked ? 1 : 0 })} /><Named label="Range correction" help={FOG_HELP.range} /></div>
        <div className="mt-1 border-t pt-2 text-xs" data-fog-areas={areas.length}>
          {current === 0 ? <p className="m-0 text-[11px] text-muted-foreground">Used as the track's fog on the original tracks, with no area needed.</p>
            : areas.length ? <p className="m-0 text-[11px] text-muted-foreground">Used by {areas.length === 1 ? "area" : "areas"} {areas.map(({ index }: any) => index).join(", ")}.</p>
            : <p className="m-0 text-[11px] text-muted-foreground">No area uses this one yet, so it never shows.</p>}
          {current > 0 && <div className="mt-1.5 flex items-center gap-1.5"><Button size="sm" variant="secondary" className="h-7 text-xs" onClick={addArea}>Add an area for Fog {current}</Button><span data-fog-help="Areas"><InfoTip title="Areas" text={FOG_HELP.areas} /></span></div>}
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <canvas ref={canvas} width={WIDTH} height={HEIGHT} aria-label="The track with this fog" className="block aspect-video w-full rounded border bg-black" />
        <div className="flex items-center gap-1">
          <Named label="Seen from" help={FOG_HELP.view} className="text-[11px] text-muted-foreground" />
          <Button size="sm" variant={view === "view" ? "secondary" : "ghost"} className="h-7 px-2 text-xs" aria-pressed={view === "view"} onClick={() => setView("view")}>The current view</Button>
          <Button size="sm" variant={view === "start" ? "secondary" : "ghost"} className="h-7 px-2 text-xs" aria-pressed={view === "start"} disabled={!doc.kmp.KTPT.length} onClick={() => setView("start")}>The start line</Button>
        </div>
        <p className="m-0 text-[11px] leading-snug text-muted-foreground">An approximation: here the fog covers all of the track model, and the sky stays clear. In the game each material chooses whether it receives fog, so test it there.</p>
      </div>
    </div>
    <div className="flex shrink-0 justify-end gap-2">
      <Button variant="ghost" onClick={() => close(false)}>Cancel</Button>
      <Button disabled={!changed} onClick={apply}>Apply</Button>
    </div>
  </div>;
}
