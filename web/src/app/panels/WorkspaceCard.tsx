import * as React from "react";
import { Check, FileCode2, FolderOpen, FolderSearch, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { api } from "../../../js/api.js";
import { useEditor } from "../hooks";

// The extracted game's "files" folder and what the editor found in it.
export function WorkspaceCard({ compact = false }: { compact?: boolean }) {
  const ed = useEditor("settings");
  const root = ed.workspace();
  const xml = ed.settings.riivolutionXml;
  const info = ed.workspaceInfo;
  const [choosing, setChoosing] = React.useState(false);
  const choose = async () => {
    setChoosing(true);
    try { await ed.chooseWorkspace(); }
    catch (error: any) { toast.error("Could not choose the workspace", { description: error.message }); }
    finally { setChoosing(false); }
  };
  React.useEffect(() => { if (root && !info) ed.refreshWorkspaceInfo(); }, [root]);
  const item = (ok: boolean, label: string) => (
    <span className={`flex items-center gap-1 ${ok ? "text-foreground" : "text-muted-foreground"}`}>
      {ok ? <Check className="size-3" /> : <Minus className="size-3" />} {label}
    </span>
  );
  return (
    <div className="w-full space-y-2 rounded-md border bg-muted/20 p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium">Workspace (game files)</div>
          <div className="truncate text-[11px] text-muted-foreground [direction:rtl] text-left" title={xml || root}>{xml || root || "Not chosen"}</div>
        </div>
        {root && <Button size="sm" variant="ghost" title="Show in Explorer" onClick={() => api.reveal(xml || root)}><FolderSearch /></Button>}
        <Button size="sm" variant="secondary" disabled={choosing} onClick={choose}><FolderOpen /> {root ? "Change…" : "Choose…"}</Button>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
        <span>{xml ? "Files resolved from this Riivolution XML." : "No extracted game folder? Open a Riivolution XML to find its mod files."}</span>
        <Button size="sm" variant="link" className="h-auto gap-1 px-0 py-0 text-[11px]" disabled={choosing} onClick={() => ed.chooseRiivolutionWorkspace()}><FileCode2 className="!size-3.5" /> {xml ? "Change XML…" : "Open Riivolution XML…"}</Button>
      </div>
      {root && info ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
          {item(info.common, "Race/Common.szs")}
          {item(info.tracks > 0, `${info.tracks} tracks`)}
          {item(info.ui, "Menus and game text")}
          {item(info.music > 0, `${info.music} music streams`)}
          {item(info.soundArchive, "Sound effects")}
        </div>
      ) : !compact && (
        <p className="m-0 text-[11px] leading-relaxed text-muted-foreground">
          The extracted game's files folder (with Race, Scene and sound). The editor takes from it the object list, the tracks and their model parts, the menus and game text, the music and the sound effects.
        </p>
      )}
    </div>
  );
}
