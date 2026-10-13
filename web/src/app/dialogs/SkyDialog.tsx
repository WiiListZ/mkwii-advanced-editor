// Sky of the open track: vrcorn_model.brres, the dome drawn around the course.
// Textures are painted here like the track model; the 3D view updates while painting.

import * as React from "react";
import { Box, Download, FileUp, Paintbrush, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { FILTERS } from "../../../js/api.js";
import { TEXTURE_FORMATS, replaceBRRESTexture } from "../../../js/formats/brres.js";
import { dialogs } from "../dialogs-store";
import { mainModel } from "../../../js/editor/brresmodel.js";
import { editor } from "../editor";
import { useEditor } from "../hooks";
import { TexturePainter } from "../panels/TexturePainter";
import { AssetPreview } from "./AssetEditorDialog";
import { cn } from "@/lib/utils";

export function SkyDialog({ close }: { close: (value: any) => void }) {
  useEditor("doc");
  const sky = editor.skyResource();
  const textures: any[] = sky?.parsed ? [...sky.parsed.textures.values()] : [];
  const [chosen, setChosen] = React.useState("");
  const texture = textures.find((t) => t.name === chosen) || textures[0] || null;
  const name = texture?.name || "";
  const model = sky?.parsed ? mainModel(sky.parsed, "vrcorn") : null;
  const preview = React.useCallback((pixels: Uint8ClampedArray) => { editor.previewSkyTexture(name, pixels); }, [name]);
  const [dirty, setDirty] = React.useState(false);
  const staged = React.useMemo(() => ({
    encode: (data: Uint8Array, pixels: Uint8ClampedArray) => replaceBRRESTexture(data, name, pixels),
    save: (data: Uint8Array) => editor.saveSkyBytes(name, data),
  }), [name]);
  // Leaving a texture (another one, or the window) with unsaved strokes asks first.
  const leave = async () => !dirty || dialogs.confirm({ title: "Unsaved texture", description: `The strokes on ${name} have not been saved. Discard them?`, confirmLabel: "Discard strokes", destructive: true });

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <Button size="icon-sm" variant="ghost" className="absolute right-3 top-3" title="Close" aria-label="Close sky editor" onClick={async () => { if (await leave()) close(true); }}><X /></Button>
      <div className="flex shrink-0 flex-col gap-2 pr-8">
        <div className="min-w-0">
          <DialogTitle className="text-sm">Sky</DialogTitle>
          <DialogDescription className="text-xs">
            The sky of this track ({sky?.path || "vrcorn_model.brres"}). Paint its textures or replace it with the sky of another track. Ctrl+Z undoes each stroke; save the SZS to keep the changes.
          </DialogDescription>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => editor.replaceSkyModel()}><FileUp /> {sky ? "Replace sky BRRES…" : "Import sky BRRES…"}</Button>
          {sky && <Button size="sm" variant="secondary" onClick={() => editor.exportBytes("vrcorn_model.brres", FILTERS.brres, sky.data, "Export sky BRRES")}><Download /> BRRES</Button>}
          {sky && <Button size="sm" variant="secondary" onClick={() => editor.openAssetEditor({ category: "courses", archive: "$open-track", resource: sky.path })}><Box /> Open in Track objects…</Button>}
        </div>
      </div>
      {!sky ? <p className="text-xs text-muted-foreground">This track has no vrcorn_model.brres. Import the sky BRRES of another track (its model must be named "vrcorn").</p>
        : !sky.parsed ? <p className="text-xs text-destructive">vrcorn_model.brres could not be read. Replace it with a working sky BRRES.</p>
        : <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
          <div className="flex min-h-0 flex-col gap-2">
            <div className="relative h-48 shrink-0 bg-[#11151c]" title="Drag to look around">
              <AssetPreview brres={sky.parsed} model={model} partIndex={-1} animationName="" showSkeleton={false} inside />
            </div>
            <div className="shrink-0 text-[11px] text-muted-foreground">{textures.length} texture{textures.length === 1 ? "" : "s"}</div>
            <div className="min-h-0 flex-1 overflow-y-auto border">
              {textures.map((t) => (
                <button key={t.name} onClick={async () => { if (t.name !== name && await leave()) { setDirty(false); setChosen(t.name); } }} title={`Edit ${t.name}`}
                  className={cn("flex w-full cursor-pointer items-center gap-2 border-b px-2 py-1.5 text-left text-xs last:border-b-0 hover:bg-accent", t.name === name && "bg-accent")}>
                  <Paintbrush className="size-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                  <span className="shrink-0 text-[10.5px] text-muted-foreground">{t.width}×{t.height} · {TEXTURE_FORMATS[t.format] || t.format}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="flex min-h-0 flex-col">
            {texture ? <TexturePainter key={name} name={name} bytes={sky.data} tall originalKey={`${editor.doc.filePath || editor.doc.fileName}:sky:${name}`}
              onPreview={preview} staged={staged} onDirtyChange={setDirty} /> : <p className="text-xs text-muted-foreground">This sky has no textures.</p>}
          </div>
        </div>}
      <div className="flex shrink-0 justify-end">
        <Button onClick={async () => { if (await leave()) close(true); }}>Done</Button>
      </div>
    </div>
  );
}
