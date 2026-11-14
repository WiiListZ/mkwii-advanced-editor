// The SCN0 scenes of a BRRES: lights, ambient lights, fog and cameras, with their values. Changes
// are made in place (web/js/formats/scn0.js); Apply resolves with the new BRRES, or null.

import * as React from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { NumberField } from "../number-field";
import { readSCN0s, SCN0_FIELDS, setSCN0Values } from "../../../js/formats/scn0.js";

const SECTION_LABEL: Record<string, string> = { "LightSet(NW4R)": "Light sets", "AmbLights(NW4R)": "Ambient lights", "Lights(NW4R)": "Lights", "Fog(NW4R)": "Fog", "Cameras(NW4R)": "Cameras" };
const FIELD_LABEL: Record<string, string> = {
  start: "Position (start)", end: "Aim (end)", color: "Colour", distanceFunction: "Distance falloff (0 none, 1 gentle, 2 medium, 3 steep)", referenceDistance: "Reference distance",
  referenceBrightness: "Reference brightness", spotFunction: "Spot shape (0 off, 1 flat … 6 cosine²)", cutoff: "Spot angle (degrees)", specularColor: "Specular colour", shininess: "Shininess",
  type: "Fog type (0 none, 2 linear, 4 exponential…)", position: "Position", aspect: "Aspect ratio", near: "Near plane", far: "Far plane", rotation: "Rotation", aim: "Aim at", twist: "Twist",
  fovY: "Field of view (degrees)", orthoHeight: "Orthographic height",
};
const hex = (c: number[]) => "#" + c.slice(0, 3).map((x) => x.toString(16).padStart(2, "0")).join("");

export function SceneDialog({ brres, title, close }: { brres: Uint8Array; title?: string; close: (v: Uint8Array | null) => void }) {
  const [data, setData] = React.useState(brres);
  const scenes = React.useMemo(() => readSCN0s(data), [data]);
  const [pick, setPick] = React.useState<{ scene: string; section: string; entry: string } | null>(null);
  const entries = scenes.flatMap((s: any) => Object.entries(s.sections).flatMap(([section, list]: any) => list.map((e: any) => ({ scene: s.name, section, entry: e }))));
  const current = entries.find((e: any) => pick && e.scene === pick.scene && e.section === pick.section && e.entry.name === pick.entry) || entries.find((e: any) => SCN0_FIELDS[e.section]) || null;
  const set = (field: string, value: any) => {
    try { setData(setSCN0Values(data, current!.scene, current!.section, current!.entry.name, { [field]: value })); }
    catch (e: any) { toast.error("Could not change the scene", { description: e.message }); }
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" data-scene-dialog onKeyDown={(e) => e.stopPropagation()}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <DialogTitle className="text-base">Scene lights and cameras (SCN0){title ? ` · ${title}` : ""}</DialogTitle>
          <DialogDescription className="text-xs">The scenes stored in this model file. Mario Kart Wii lights tracks with posteffect (Tools › Lighting); these scenes are kept for completeness and for models that use them.</DialogDescription>
        </div>
        <Button size="icon-sm" variant="ghost" aria-label="Close scenes" onClick={() => close(null)}><X /></Button>
      </div>
      {!scenes.length ? <p className="m-0 text-xs text-muted-foreground">This model file has no SCN0 scene.</p> :
      <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)] gap-3 overflow-hidden">
        <div className="min-h-0 overflow-y-auto rounded-md border p-1">
          {scenes.map((s: any) => <div key={s.name} className="mb-1">
            <div className="px-1.5 py-1 text-xs font-medium">{s.name}{s.frames != null ? ` · ${s.frames} frame${s.frames === 1 ? "" : "s"}` : ""}</div>
            {Object.entries(s.sections).map(([section, list]: any) => <div key={section}>
              <div className="px-2 py-0.5 text-[11px] text-muted-foreground">{SECTION_LABEL[section] || section}</div>
              {list.map((e: any) => <button key={e.name} type="button" onClick={() => setPick({ scene: s.name, section, entry: e.name })}
                className={cn("block w-full cursor-pointer truncate rounded px-3 py-1 text-left text-xs hover:bg-accent/60", current?.entry === e && "bg-accent")}>{e.name}</button>)}
            </div>)}
          </div>)}
        </div>
        <div className="min-h-0 space-y-2 overflow-y-auto pr-1">
          {current && <>
            <div className="text-xs font-semibold">{current.entry.name}</div>
            {current.entry.ambient !== undefined && <p className="m-0 text-xs text-muted-foreground">Ambient light {current.entry.ambient}; lights: {current.entry.lights.join(", ") || "none"}.</p>}
            {!current.entry.editable && SCN0_FIELDS[current.section] && <p className="m-0 text-xs text-muted-foreground">Its values are animated over the frames: they are shown, not changed here.</p>}
            {(SCN0_FIELDS[current.section] || []).map(([name, , kind]: any) => {
              const value = current.entry.values[name], disabled = !current.entry.editable;
              return <div key={name} className="flex items-center gap-2 rounded-md border px-2 py-1.5" data-scene-field={name}>
                <span className="min-w-0 flex-1 text-xs">{FIELD_LABEL[name] || name}</span>
                {kind === "v" && [0, 1, 2].map((i) => <NumberField key={i} commit disabled={disabled} aria-label={`${name} ${"XYZ"[i]}`} value={value[i]} onValue={(x) => set(name, value.map((y: number, j: number) => j === i ? x : y))} className="h-7 w-24 text-xs" />)}
                {kind === "c" && <>
                  <input type="color" disabled={disabled} aria-label={name} value={hex(value)} onChange={(e) => set(name, [1, 3, 5].map((i) => parseInt(e.target.value.slice(i, i + 2), 16)).concat(value[3]))} />
                  <NumberField commit integer min={0} max={255} disabled={disabled} aria-label={`${name} alpha`} value={value[3]} onValue={(a) => set(name, [...value.slice(0, 3), a])} className="h-7 w-16 text-xs" />
                </>}
                {(kind === "f" || kind === "u") && <NumberField commit integer={kind === "u"} min={kind === "u" ? 0 : undefined} disabled={disabled} aria-label={name} value={value} onValue={(x) => set(name, x)} className="h-7 w-28 text-xs" />}
              </div>;
            })}
          </>}
        </div>
      </div>}
      <div className="flex shrink-0 justify-end gap-2 border-t pt-2">
        <Button size="sm" variant="outline" onClick={() => close(null)}>Cancel</Button>
        <Button size="sm" disabled={data === brres} onClick={() => close(data)}>Apply</Button>
      </div>
    </div>
  );
}
