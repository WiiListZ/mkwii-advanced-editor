import * as React from "react";
import { Box, ImagePlus, Paintbrush } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { editor } from "../editor";
import { useEditor } from "../hooks";
import { ObjectPreview } from "./ObjectPreview";
import { TexturePainter } from "./TexturePainter";
import { dialogs } from "../dialogs-store";
import { replaceBRRESTexture } from "../../../js/formats/brres.js";

const SOURCE: Record<string, string> = {
  track: "This track", common: "Common.szs", library: "Tracks library",
  "library-pending": "Loading from tracks library…", missing: "No model loaded",
};

// Inspector entry point. The appearance window (ObjectAppearanceDialog) has no button here;
// it stays available through editor.openObjectAppearance.
export function ObjectAppearance({ objectId }: { objectId: number }) {
  useEditor("doc");
  if (!editor.doc.szs || !editor.objectAppearanceResources(objectId).length) return null;
  return (
    <div className="flex">
      <Button size="sm" variant="secondary" className="flex-1" title="Every BRRES of this track in Characters and models" onClick={() => editor.openTrackObjects(objectId)}>
        <Box /> Track objects…
      </Button>
    </div>
  );
}

export function ObjectAppearanceDialog({ objectId, close }: { objectId: number; close: (value: any) => void }) {
  useEditor("doc");
  const resources = editor.objectAppearanceResources(objectId);
  const [chosen, setChosen] = React.useState<Record<string, string>>({});

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <DialogHeader>
        <DialogTitle>Appearance in this track</DialogTitle>
        <DialogDescription>
          The models and textures here apply to every instance of this object in the open course. Changes are saved in this course SZS. Open the separate _d course to edit its multiplayer version.
        </DialogDescription>
      </DialogHeader>
      <div className="grid min-h-0 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <ObjectPreview objectId={objectId} className="h-56 sm:h-full sm:min-h-64" />
        <div className="min-h-0 space-y-2 overflow-y-auto sm:max-h-[60vh]">
          {!resources.length && <p className="text-xs text-muted-foreground">This object has no model resource in the open track.</p>}
          {resources.map((resource: any) => {
            const texture = resource.textures.some((t: any) => t.name === chosen[resource.name])
              ? chosen[resource.name] : resource.textures[0]?.name || "";
            const selected = resource.textures.find((t: any) => t.name === texture);
            const supported = selected && [0, 1, 2, 3, 4, 5, 6, 14].includes(selected.format);
            return (
              <div key={resource.name} className="space-y-2 rounded-md border p-2">
                <div className="flex flex-wrap items-baseline justify-between gap-1">
                  <span className="break-all font-mono text-[11px]">{resource.name}.brres</span>
                  <span className="text-[10px] text-muted-foreground">{SOURCE[resource.source]}</span>
                </div>
                <Button size="sm" variant="secondary" className="w-full" onClick={() => editor.replaceObjectModel(objectId, resource.name)}>
                  <ImagePlus /> Replace BRRES model…
                </Button>
                {resource.textures.length > 0 && (
                  <div className="flex gap-1">
                    <select aria-label={`Texture in ${resource.name}`} className="min-w-0 flex-1 rounded-md border bg-background px-2 text-[11px]"
                      value={texture} onChange={(e) => setChosen((old) => ({ ...old, [resource.name]: e.target.value }))}>
                      {resource.textures.map((t: any) => <option key={t.name} value={t.name}>{t.name} · {t.width}×{t.height}{/^lm_/i.test(t.name) ? " · light map" : ""}</option>)}
                    </select>
                    <Button size="sm" variant="outline" disabled={!supported} onClick={() => editor.replaceObjectTexture(objectId, resource.name, texture)}>PNG…</Button>
                  </div>
                )}
                {selected && <Button size="sm" variant="outline" className="w-full" disabled={!supported}
                  onClick={() => dialogs.open("objectTextureEditor", { objectId, resourceName: resource.name, name: texture })}>
                  <Paintbrush /> Paint texture in editor…
                </Button>}
              </div>
            );
          })}
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => editor.openTrackObjects(objectId)}><Box /> Open in Track objects…</Button>
        <Button onClick={() => close(true)}>Done</Button>
      </DialogFooter>
    </div>
  );
}

export function ObjectTextureEditorDialog({ objectId, resourceName, name, close }: {
  objectId: number; resourceName: string; name: string; close: (value: any) => void;
}) {
  useEditor("doc");
  const resource = editor.objectAppearanceResources(objectId).find((r: any) => r.name === resourceName);
  const noPreview = React.useCallback(() => {}, []);
  const [dirty, setDirty] = React.useState(false);
  const staged = React.useMemo(() => ({
    encode: (data: Uint8Array, pixels: Uint8ClampedArray) => replaceBRRESTexture(data, name, pixels),
    save: (data: Uint8Array) => editor.saveObjectResourceBytes(objectId, resourceName, name, data),
  }), [objectId, resourceName, name]);
  const requestClose = async () => {
    if (dirty && !(await dialogs.confirm({ title: "Unsaved texture", description: "The painted strokes have not been saved. Close and discard them?", confirmLabel: "Discard strokes", destructive: true }))) return;
    close(true);
  };
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{resourceName}.brres · {name}</div>
          <p className="m-0 text-xs text-muted-foreground">Every instance of this object in this course uses this texture. Save texture applies the strokes to the track.</p>
        </div>
        <Button size="sm" onClick={requestClose}>Done</Button>
      </div>
      {resource?.data ? <TexturePainter name={name} bytes={resource.data} tall originalKey={`${editor.doc.filePath || editor.doc.fileName}:${resourceName}:${name}`}
        onPreview={noPreview} staged={staged} onDirtyChange={setDirty} /> : <p className="text-xs text-muted-foreground">The object resource is unavailable.</p>}
    </div>
  );
}
