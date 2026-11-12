// Recording ghosts, on its own: nothing here depends on a track being open. While this window is open
// each ghost the game saves joins the recorded ghosts, ready to go on a track or into the ghost editor.

import * as React from "react";
import { Box, Check, Download, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { api } from "../../../js/api.js";
import { recordSteps } from "../../../js/editor/record-steps.js";
import { CHARACTERS, VEHICLES } from "../../../js/formats/params.js";
import { COURSE_NAMES, parseRKG } from "../../../js/formats/rkg.js";
import { dialogs } from "../dialogs-store";
import { editor } from "../editor";

export const RKG_FILTER = [{ name: "Ghost file", extensions: ["rkg"] }];
export const ghostSummary = (item: any) => `${COURSE_NAMES[item.track] ?? `Track ${item.track}`} · ${item.time} · ${CHARACTERS[item.character] ?? "Mii"} · ${VEHICLES[item.vehicle] ?? `Vehicle ${item.vehicle}`}`;

export function Step({ number, step, recording, children }: { number: number; step: any; recording: boolean; children?: React.ReactNode }) {
  const current = step.state === "current", done = step.state === "done";
  return <li className="flex gap-3 py-2" data-record-step={step.id} data-step-state={step.state} aria-current={current ? "step" : undefined}>
    <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
      current ? "border-foreground bg-foreground text-background" : done ? "border-muted-foreground/40 text-foreground" : "border-muted-foreground/30 text-muted-foreground")} aria-hidden="true">
      {done ? <Check className="size-3.5" /> : number}
    </span>
    <div className="min-w-0 flex-1">
      <div className={cn("flex items-center gap-2 text-xs", current ? "text-sm font-semibold" : done ? "font-medium" : "text-muted-foreground")}>
        {step.title}
        {recording && <span className="inline-flex items-center gap-1 text-[11px] font-medium text-red-400" data-recording><span className="size-2 animate-pulse rounded-full bg-red-500" aria-hidden="true" /> Recording</span>}
      </div>
      {/* Only what is true now or needed now: steps to come stay short. */}
      {(current || step.id === "done" && done || step.id === "game") && <div className="mt-0.5 text-[11px] text-muted-foreground">{step.text}</div>}
      {children && <div className="mt-2 flex flex-wrap gap-1.5">{children}</div>}
    </div>
  </li>;
}

export function GhostRecordDialog({ close, fromEditor }: { close: (value: any) => void; fromEditor?: boolean }) {
  const [status, setStatus] = React.useState<any>(null);
  const [library, setLibrary] = React.useState<any[]>([]);
  const loadLibrary = async () => {
    try { setLibrary(await api.ghostLibrary()); } catch (e: any) { toast.error("Could not list the recorded ghosts", { description: e.message }); }
  };
  const refresh = async (action?: "start") => {
    try { setStatus(await api.ghostCapture(action)); } catch (e: any) { toast.error("Could not check Dolphin", { description: e.message }); }
  };
  // It watches for as long as this window is open: there is nothing to remember to press.
  React.useEffect(() => {
    void refresh("start");
    void loadLibrary();
    const timer = setInterval(() => void refresh(), 700);
    return () => { clearInterval(timer); void api.ghostCapture("stop").catch(() => {}); };
  }, []);
  // A ghost was picked up: it has just joined the recorded ghosts.
  const captured = status?.captured || [];
  React.useEffect(() => { if (captured.length) void loadLibrary(); }, [captured.length]);

  // How many there were while the latest race was running, to tell this race's ghost from an older one.
  const capturedAtRace = React.useRef(0), finishedAt = React.useRef(0);
  if (status?.stage === 0 || status?.stage === 1 || status?.stage === 2) { capturedAtRace.current = captured.length; finishedAt.current = 0; }
  else if (status?.stage >= 3 && !finishedAt.current) finishedAt.current = Date.now();
  const { steps, recording } = recordSteps(status, capturedAtRace.current, finishedAt.current);

  // The 3D window of the ghost, on its own track, as the ghost editor opens it.
  const watch = async (path: string) => {
    try { await editor.openGhostPreview(parseRKG((await api.readPath(path)).data)); }
    catch (e: any) { toast.error("Could not open the ghost's preview", { description: e.message }); }
  };
  const edit = (path: string, label: string) => fromEditor ? close({ path, label }) : dialogs.open("ghosts", { initial: { path, label } });
  const exportGhost = async (item: any) => {
    try {
      const path = await api.chooseSavePath(item.name, RKG_FILTER, "Export the ghost");
      if (path) await api.writeFile(path, (await api.readPath(item.path)).data);
    } catch (e: any) { toast.error("Could not export the ghost", { description: e.message }); }
  };
  const remove = async (item: any) => {
    if (!await dialogs.confirm({ title: "Delete this recorded ghost?", description: ghostSummary(item), confirmLabel: "Delete", destructive: true })) return;
    try { await api.ghostLibraryDelete(item.path); await loadLibrary(); }
    catch (e: any) { toast.error("Could not delete the ghost", { description: e.message }); }
  };

  const latest = captured[captured.length - 1];
  const isNew = (item: any) => captured.some((ghost: any) => ghost.file === item.path);
  return <div className="flex h-full min-h-0 flex-col gap-3">
    <div className="flex shrink-0 items-start gap-2">
      <div className="min-w-0 flex-1">
        <DialogTitle className="text-sm">Record a ghost</DialogTitle>
        <DialogDescription className="text-xs">Drive a Time Trial in Dolphin. Keep this window open: each run you finish appears here, also one the game does not keep (beta).</DialogDescription>
      </div>
      <Button size="icon-sm" variant="ghost" title="Close" aria-label="Close ghost recording" onClick={() => close(true)}><X /></Button>
    </div>
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex min-h-0 flex-col gap-2 overflow-y-auto pr-1">
        {!status ? <p className="text-xs text-muted-foreground">Checking Dolphin…</p> : <>
          <ol className="m-0 list-none p-0">
            {steps.map((step: any, index: number) => <Step key={step.id} number={index + 1} step={step} recording={recording && step.id === "drive"}>
              {step.id === "game" && !status.dolphin && <Button size="sm" onClick={() => editor.cmd("dolphin")}>Open the game in Dolphin</Button>}
              {step.id === "done" && step.state === "done" && latest?.file && <>
                <div className="w-full text-xs font-medium" data-recorded-latest>{ghostSummary(latest)}</div>
                <Button size="sm" onClick={() => watch(latest.file)}><Box className="size-3.5" /> Watch in 3D (beta)</Button>
                <Button size="sm" variant="secondary" onClick={() => edit(latest.file, latest.file.split(/[\\/]/).pop())}>Open in the ghost editor</Button>
              </>}
            </Step>)}
          </ol>
          {captured.length > 0 && <p className="m-0 text-[11px] text-muted-foreground">To record another, just drive another race.</p>}
          {!status.saves?.length && <p className="m-0 text-xs text-amber-400">No Mario Kart Wii save was found in Dolphin's folders. It is created the first time the game runs.</p>}
          <p className="m-0 border-t pt-2 text-[11px] text-muted-foreground">A ghost holds the buttons pressed, not the path, so record it on the finished track. Mods that keep their own save are not seen.</p>
        </>}
      </div>
      <div className="flex min-h-0 flex-col gap-1.5">
        <div className="text-xs font-semibold">Recorded ghosts</div>
        <div className="min-h-0 flex-1 overflow-y-auto border" data-recorded-ghosts>
          {library.map((item) => <div key={item.path} className="flex items-center gap-1 border-b px-2 py-1.5 text-xs last:border-b-0">
            {isNew(item) && <span className="shrink-0 font-semibold" data-recorded-new>New</span>}
            <span className="min-w-0 flex-1 truncate" title={ghostSummary(item)}>{ghostSummary(item)}</span>
            <Button size="icon-sm" variant="ghost" title="Watch in 3D (beta)" aria-label={`Watch ${item.name}`} onClick={() => watch(item.path)}><Box /></Button>
            <Button size="icon-sm" variant="ghost" title="Open in the ghost editor" aria-label={`Edit ${item.name}`} onClick={() => edit(item.path, item.name)}><Pencil /></Button>
            <Button size="icon-sm" variant="ghost" title="Export as a .rkg file" aria-label={`Export ${item.name}`} onClick={() => exportGhost(item)}><Download /></Button>
            <Button size="icon-sm" variant="ghost" title="Delete" aria-label={`Delete ${item.name}`} onClick={() => remove(item)}><Trash2 /></Button>
          </div>)}
          {!library.length && <p className="p-2 text-xs text-muted-foreground">Nothing recorded yet.</p>}
        </div>
        <p className="m-0 text-[11px] text-muted-foreground">To use one on a track, open the track and choose Tools › Ghosts of this track.</p>
      </div>
    </div>
    <div className="flex shrink-0 justify-end"><Button variant={captured.length ? "default" : "secondary"} onClick={() => close(true)}>Done</Button></div>
  </div>;
}
