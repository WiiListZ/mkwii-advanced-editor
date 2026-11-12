// Reading the path a ghost really drives: the game races it in place of its track's staff ghost, and
// its kart is read on every frame. Closing this window puts the staff ghost back.

import * as React from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { api } from "../../../js/api.js";
import { replaySteps } from "../../../js/editor/replay-steps.js";
import { buildRKG, COURSE_NAMES, timeText } from "../../../js/formats/rkg.js";
import { editor } from "../editor";
import { Step } from "./GhostRecordDialog";

export function GhostReplayDialog({ close, ghost }: { close: (value: any) => void; ghost: any }) {
  const [replay, setReplay] = React.useState<any>(null);
  const [game, setGame] = React.useState<any>(null);
  const [failed, setFailed] = React.useState("");
  const trackName = COURSE_NAMES[ghost.track] ?? "its track";

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try { if (alive) setReplay(await api.ghostReplay("start", buildRKG(ghost, { compressed: true }))); }
      catch (e: any) { if (alive) setFailed(e.message); }
    })();
    const timer = setInterval(async () => {
      try {
        const [now, state] = await Promise.all([api.ghostReplay(), api.ghostCapture()]);
        if (alive) { setReplay(now); setGame(state); }
      } catch { /* looked at again on the next tick */ }
    }, 500);
    // Closed before the end: the staff ghost goes back.
    return () => { alive = false; clearInterval(timer); void api.ghostReplay("stop").catch(() => {}); };
  }, []);

  // Read: the preview behind shows the path at once.
  const done = replay?.phase === "done";
  React.useEffect(() => { if (done) void editor.reloadGhostPath().catch((e: any) => toast.error("Could not show the path", { description: e.message })); }, [done]);

  const { steps, reading, share } = replaySteps(replay, game, trackName);
  return <div className="flex flex-col gap-3">
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <DialogTitle className="text-sm">Read the path from the game (beta)</DialogTitle>
        <DialogDescription className="text-xs">The game races this ghost ({trackName} · {timeText(ghost.time)}) to show where it drives. Until then it takes the place of {trackName}'s staff ghosts in the game folder; they go back when the path is read or this window closes.</DialogDescription>
      </div>
      <Button size="icon-sm" variant="ghost" title="Close" aria-label="Close path reading" onClick={() => close(done)}><X /></Button>
    </div>
    {failed ? <p className="m-0 text-xs text-amber-400" data-replay-error>{failed}</p> : !replay ? <p className="m-0 text-xs text-muted-foreground">Preparing the ghost…</p> : <ol className="m-0 list-none p-0" data-replay-phase={replay.phase}>
      {steps.map((step: any, index: number) => <Step key={step.id} number={index + 1} step={step} recording={reading && step.id === "finish"}>
        {step.id === "game" && step.state === "current" && !game?.dolphin && <Button size="sm" onClick={() => editor.cmd("dolphin")}>Open the game in Dolphin</Button>}
        {step.id === "finish" && reading && <div className="h-1.5 w-full overflow-hidden rounded bg-muted" role="progressbar" aria-valuenow={share} aria-valuemin={0} aria-valuemax={100}><div className="h-full bg-foreground" style={{ width: `${share}%` }} /></div>}
      </Step>)}
    </ol>}
    {replay?.error && replay.phase !== "failed" && <p className="m-0 text-xs text-amber-400">{replay.error}</p>}
    <p className="m-0 border-t pt-2 text-[11px] text-muted-foreground">Dolphin must run the game from the editor's game folder (its sys/main.dol), as Open the game in Dolphin does: an ISO keeps its own staff ghosts.</p>
    <div className="flex justify-end"><Button variant={done ? "default" : "secondary"} onClick={() => close(done)}>{done ? "Done" : "Cancel"}</Button></div>
  </div>;
}
