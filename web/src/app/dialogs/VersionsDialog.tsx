// The earlier saves of the open track: go back to one, or see what differs from it.

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { api, FILTERS } from "../../../js/api.js";
import { dialogs } from "../dialogs-store";
import { editor } from "../editor";

const sizeText = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(2)} MB`;

export function VersionsDialog({ close }: { close: (value: any) => void }) {
  const path: string = editor.doc.filePath;
  const [versions, setVersions] = React.useState<any[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const load = async () => {
    try { setVersions(await api.versions(path)); }
    catch (e: any) { setVersions([]); toast.error("Could not list the versions", { description: e.message }); }
  };
  React.useEffect(() => { void load(); }, []);
  const when = (at: number) => new Date(at).toLocaleString();

  const compare = async (read: () => Promise<Uint8Array>, label: string) => {
    setBusy(true);
    try {
      if (await editor.compareWith(await read(), label)) close(true);
    } catch (e: any) { toast.error("Could not compare", { description: e.message }); }
    finally { setBusy(false); }
  };
  const compareFile = async () => {
    const file = await api.openFile(FILTERS.track, "Choose the track to compare with");
    if (file) await compare(async () => file.data, file.name);
  };
  const restore = async (version: any) => {
    const unsaved = editor.doc.dirty ? " Your unsaved changes will be lost." : "";
    if (!await dialogs.confirm({ title: "Go back to this version?", description: `The file goes back to how it was on ${when(version.at)}. What it holds now is kept as a version, so you can return to it.${unsaved}`, confirmLabel: "Go back" })) return;
    setBusy(true);
    try {
      await api.versionRestore(path, version.id);
      close(true);
      // What is on disk now is the file: nothing to keep from before.
      editor.doc.dirty = false;
      await editor.openPath(path);
      toast.success("Version restored", { description: when(version.at) });
    } catch (e: any) { toast.error("Could not restore the version", { description: e.message }); }
    finally { setBusy(false); }
  };

  return <div className="flex h-full min-h-0 flex-col gap-3">
    <div className="shrink-0">
      <DialogTitle className="text-sm">Version history</DialogTitle>
      <DialogDescription className="text-xs">Each time you save, what the file held before is kept here, up to the {editor.settings.versionsKept} most recent. They are beside the editor's settings, not next to the track.</DialogDescription>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto border" data-versions>
      {versions === null && <p className="p-2 text-xs text-muted-foreground">Reading…</p>}
      {versions?.length === 0 && <p className="p-2 text-xs text-muted-foreground">No earlier versions yet. They start with your next save.</p>}
      {versions?.map((version) => <div key={version.id} className="flex items-center gap-2 border-b px-2 py-1.5 text-xs last:border-b-0" data-version={version.id}>
        <span className="min-w-0 flex-1 truncate">{when(version.at)}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">{sizeText(version.size)}</span>
        <Button size="sm" variant="secondary" className="h-7 px-2 text-xs" disabled={busy} onClick={() => compare(() => api.versionRead(path, version.id), `the version of ${when(version.at)}`)}>Compare</Button>
        <Button size="sm" variant="secondary" className="h-7 px-2 text-xs" disabled={busy} onClick={() => restore(version)}>Go back…</Button>
      </div>)}
    </div>
    <div className="flex shrink-0 items-center justify-between gap-2">
      <Button variant="secondary" disabled={busy} onClick={compareFile}>Compare with a file…</Button>
      <Button variant="ghost" onClick={() => close(false)}>Close</Button>
    </div>
  </div>;
}
