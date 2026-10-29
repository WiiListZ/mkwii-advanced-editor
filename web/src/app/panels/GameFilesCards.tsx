// Cards shared by Settings › Game files and the Home screen: the imported object documentation and
// Race/Common.szs (shared objects and their models). brief: the Home screen drops the descriptions
// on short windows so its right column fits.
import { CircleHelp, FolderOpen } from "lucide-react";
import { dialogs } from "../dialogs-store";
import { Button } from "@/components/ui/button";
import { useEditor } from "../hooks";
import { cn } from "@/lib/utils";

export function ObjectDocumentationCard({ className, brief }: { className?: string; brief?: boolean }) {
  const ed = useEditor("settings", "doc");
  const count = Object.keys(ed.importedObjectDocumentation).length;
  return (
    <div className={cn("space-y-2 rounded-md border bg-muted/20 p-2.5", className)}>
      <div className="text-xs font-medium">Object documentation</div>
      <p className={cn("m-0 text-[11px] leading-relaxed text-muted-foreground", brief && "short:hidden")}>Descriptions and setting names for game objects. {count} custom {count === 1 ? "entry is" : "entries are"} saved in the editor settings.</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => void ed.importObjectDocumentation()}><FolderOpen /> Import JSON…</Button>
        <Button size="sm" variant="ghost" onClick={() => void dialogs.open("help", { tab: "objectDocs" })}><CircleHelp /> JSON format</Button>
        {count > 0 && <Button size="sm" variant="ghost" onClick={() => void ed.clearImportedObjectDocumentation()}>Remove imported</Button>}
      </div>
    </div>
  );
}

export function CommonSzsCard({ className, brief }: { className?: string; brief?: boolean }) {
  const ed = useEditor("settings", "doc", "ui");
  const loaded = !!ed.assets?.common;
  return (
    <div className={cn("space-y-2 rounded-md border bg-muted/20 p-2.5", className)}>
      <div className="text-xs font-medium">Race/Common.szs · {loaded ? "Loaded" : "Not loaded"}</div>
      {loaded && ed.commonPath && <div className="break-all text-[11px] leading-snug text-muted-foreground">{ed.commonPath}</div>}
      <p className={cn("m-0 text-[11px] leading-relaxed text-muted-foreground", brief && "short:hidden")}>Provides shared game objects and their original 3D models.</p>
      <Button size="sm" variant="secondary" onClick={() => ed.loadObjFlow()}><FolderOpen /> Load Common.szs…</Button>
    </div>
  );
}
