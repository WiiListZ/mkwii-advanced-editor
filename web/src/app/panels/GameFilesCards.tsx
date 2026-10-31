// Cards shared by Settings › Game files and the Home screen: the object documentation in use and
// Race/Common.szs (shared objects and their models). brief: the Home screen drops the descriptions
// on short windows so its right column fits.
import { CircleHelp, Download, FileJson, FolderOpen, FolderSearch, GitPullRequest, PackageOpen, RotateCcw } from "lucide-react";
import { api } from "../../../js/api.js";
import { OBJECT_INFO_REPO } from "../../../js/data/object-documentation.js";
import { dialogs } from "../dialogs-store";
import { Button } from "@/components/ui/button";
import { useEditor } from "../hooks";
import { cn } from "@/lib/utils";

// What documentation is in use, in a few words.
export function documentationSource(ed: ReturnType<typeof useEditor>) {
  const count = Object.keys(ed.customObjectDocumentation).length;
  return ed.usesCustomObjectDocumentation
    ? `${ed.customObjectDocumentationName || "Your JSON"} (${count} ${count === 1 ? "entry" : "entries"}), in place of the default documentation`
    : ed.objectDocumentationUpdated
      ? `The default documentation, updated from GitHub on ${new Date(ed.objectDocumentationUpdated).toLocaleDateString()}`
      : "The default documentation shipped with the editor";
}

// Replace with JSON… (the chosen JSON replaces the default one), Edit JSON… (in the editor), Restore
// default (when a JSON is in use), Export JSON… and JSON format.
export function ObjectDocumentationButtons() {
  const ed = useEditor("settings", "doc");
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" onClick={() => void ed.replaceObjectDocumentation()} title="Use a documentation JSON in place of the one in use now"><FolderOpen /> Replace with JSON…</Button>
      <Button size="sm" variant="secondary" onClick={() => void dialogs.open("objectDocsEditor", {})} title="Edit the documentation JSON in use here, with a check as you type"><FileJson /> Edit JSON…</Button>
      <Button size="sm" variant="ghost" disabled={!ed.usesCustomObjectDocumentation} onClick={() => void ed.restoreDefaultObjectDocumentation()} title={ed.usesCustomObjectDocumentation ? "Use the editor's own documentation again" : "The default documentation is already in use"}><RotateCcw /> Restore default</Button>
      <Button size="sm" variant="ghost" onClick={() => void ed.exportObjectDocumentation()} title="Save the documentation in use as a JSON file, to edit it and choose it with Replace with JSON…"><Download /> Export JSON…</Button>
      <Button size="sm" variant="ghost" onClick={() => void dialogs.open("help", { tab: "objectDocs" })}><CircleHelp /> JSON format</Button>
      <Button size="sm" variant="ghost" onClick={() => void api.openUrl(OBJECT_INFO_REPO)} title="Help complete the default documentation: propose changes on GitHub (issues and pull requests to data/objects.json)"><GitPullRequest /> Contribute on GitHub</Button>
    </div>
  );
}

export function ObjectDocumentationCard({ className, brief }: { className?: string; brief?: boolean }) {
  const ed = useEditor("settings", "doc");
  return (
    <div className={cn("space-y-2 rounded-md border bg-muted/20 p-2.5", className)}>
      <div className="text-xs font-medium">Object documentation</div>
      <p className="m-0 text-[11px] leading-relaxed text-muted-foreground" data-documentation-source>In use: {documentationSource(ed)}.</p>
      <p className={cn("m-0 text-[11px] leading-relaxed text-muted-foreground", brief && "short:hidden")}>Descriptions and setting names of the game objects. The default documentation is kept up to date from the <button type="button" className="cursor-pointer underline underline-offset-2 hover:text-foreground" onClick={() => api.openUrl(OBJECT_INFO_REPO)}>object-info repository</button>, where anyone can help complete it. A JSON you choose replaces it entirely; Restore default brings it back.</p>
      <ObjectDocumentationButtons />
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
      <div className="flex flex-wrap items-center gap-2">
        {/* Opens the loaded Common.szs in the archive window: its files, models and game data. */}
        {loaded && ed.commonPath && <Button size="sm" variant="secondary" title="Open the loaded Common.szs: its files, object models and game data" onClick={() => void ed.openArchiveWindow(ed.commonPath!)}><PackageOpen /> Open Common.szs</Button>}
        <Button size="sm" variant={loaded ? "ghost" : "secondary"} onClick={() => ed.loadObjFlow()}><FolderOpen /> Load Common.szs…</Button>
        {loaded && ed.commonPath && <Button size="icon-sm" variant="ghost" title="Show in Explorer" aria-label="Show Common.szs in Explorer" onClick={() => api.reveal(ed.commonPath!)}><FolderSearch /></Button>}
      </div>
    </div>
  );
}
