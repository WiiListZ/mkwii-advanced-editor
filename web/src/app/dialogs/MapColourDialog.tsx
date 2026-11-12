// The colour the game multiplies every minimap by, in its race screen layout. This is a change to
// the game folder, for all tracks, unlike the track's own map_model.brres.

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { api } from "../../../js/api.js";
import { MAP_LAYOUT, readMapColours, setMapColours } from "../../../js/formats/map-layout.js";
import { buildU8, findFile, parseU8 } from "../../../js/formats/u8.js";
import { editor } from "../editor";

const toHex = (c: number[]) => "#" + c.slice(0, 3).map((v) => v.toString(16).padStart(2, "0")).join("");
const fromHex = (hex: string) => [...[1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)), 255];

export function MapColourDialog({ close }: { close: (value: any) => void }) {
  const [state, setState] = React.useState<any>(null);
  const [top, setTop] = React.useState("#ffffff");
  const [bottom, setBottom] = React.useState("#ffffff");
  const [saving, setSaving] = React.useState(false);
  const path = editor.workspacePath("Scene", "UI", "Race.szs");
  React.useEffect(() => {
    void (async () => {
      try {
        if (!path || !await api.exists(path)) return setState({ error: "Race.szs was not found. Choose the game folder in the settings first." });
        const tree = parseU8(await api.decodeArchiveBytes((await api.readPath(path)).data, path));
        const node = findFile(tree, MAP_LAYOUT);
        if (!node) return setState({ error: `${MAP_LAYOUT} is not in Race.szs.` });
        const colours = readMapColours(node.data);
        setTop(toHex(colours[0])); setBottom(toHex(colours[2]));
        setState({ tree, node });
      } catch (e: any) { setState({ error: e.message }); }
    })();
  }, []);
  const save = async () => {
    setSaving(true);
    try {
      state.node.data = setMapColours(state.node.data, [fromHex(top), fromHex(top), fromHex(bottom), fromHex(bottom)]);
      await api.writeFile(path, buildU8(state.tree), { backup: editor.settings.keepBackups, edited: true, compress: "yaz0" });
      toast.success("Minimap colour saved", { description: "It applies to every track of the game in this folder." });
      close(true);
    } catch (e: any) { toast.error("Could not save the colour", { description: e.message }); }
    finally { setSaving(false); }
  };
  return <div className="flex flex-col gap-3">
    <div>
      <DialogTitle className="text-sm">Minimap colour of the game</DialogTitle>
      <DialogDescription className="text-xs">The game multiplies every minimap by this colour, in races too. White leaves the maps as they are. It changes Scene/UI/Race.szs, so it applies to all tracks.</DialogDescription>
    </div>
    {!state ? <p className="text-xs text-muted-foreground">Reading Race.szs…</p> : state.error ? <p className="text-xs text-destructive">{state.error}</p> : <>
      <label className="flex items-center gap-2 text-xs"><span className="w-20 text-muted-foreground">Top</span><input type="color" aria-label="Top colour" value={top} onChange={(e) => setTop(e.target.value)} className="h-7 w-12 cursor-pointer rounded border bg-transparent p-0.5" /></label>
      <label className="flex items-center gap-2 text-xs"><span className="w-20 text-muted-foreground">Bottom</span><input type="color" aria-label="Bottom colour" value={bottom} onChange={(e) => setBottom(e.target.value)} className="h-7 w-12 cursor-pointer rounded border bg-transparent p-0.5" /></label>
      <div className="h-16 rounded border" style={{ background: `linear-gradient(${top}, ${bottom})` }} aria-hidden="true" />
    </>}
    <div className="flex justify-end gap-2">
      <Button variant="ghost" onClick={() => close(null)}>Cancel</Button>
      <Button disabled={!state?.node || saving} onClick={save}>{saving ? "Saving…" : "Save to the game folder"}</Button>
    </div>
  </div>;
}
