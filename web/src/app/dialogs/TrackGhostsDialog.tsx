// The staff ghosts of a track's position in the game: replace them with a recorded ghost or a .rkg
// file. They live in Race/TimeAttack, outside the track's SZS, and go with the position.

import * as React from "react";
import { Box, FileUp, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { api } from "../../../js/api.js";
import { TRACK_NAMES } from "../../../js/data/defs.js";
import { COURSE_NAMES, ghostForSlot, parseRKG, timeText } from "../../../js/formats/rkg.js";
import { dialogs } from "../dialogs-store";
import { editor } from "../editor";
import { ghostSummary, RKG_FILTER } from "./GhostRecordDialog";

const STAFF_TYPE_NAMES: Record<number, string> = { 0x25: "Staff ghost", 0x26: "Expert staff ghost" };

// The position of the open file, when it is named after one of the game's.
function positionOfOpenTrack() {
  const stem = (editor.doc.fileName || "").replace(/\.[^.]+$/, "").replace(/_d$/, "");
  const index = COURSE_NAMES.indexOf((TRACK_NAMES as any)[stem]);
  return index;
}

export function TrackGhostsDialog({ close }: { close: (value: any) => void }) {
  const detected = React.useMemo(positionOfOpenTrack, []);
  const [track, setTrack] = React.useState(detected >= 0 ? detected : 0);
  const [slots, setSlots] = React.useState<any[] | null>(null);
  const [library, setLibrary] = React.useState<any[]>([]);
  const [choosing, setChoosing] = React.useState<string | null>(null);

  const load = async () => {
    try {
      setSlots(await api.ghostSlots(track));
      setLibrary(await api.ghostLibrary());
    } catch (e: any) { toast.error("Could not read the ghosts", { description: e.message }); }
  };
  React.useEffect(() => { void load(); }, [track]);

  const install = async (slot: any, data: Uint8Array, from: string) => {
    try {
      const bytes = ghostForSlot(data, track, slot.ghostType);
      await api.writeFile(slot.path, bytes, { backup: editor.settings.keepBackups !== false });
      setChoosing(null);
      await load();
      toast.success(`${STAFF_TYPE_NAMES[slot.ghostType] || "Ghost"} replaced`, { description: from });
    } catch (e: any) { toast.error("Could not replace the ghost", { description: e.message }); }
  };
  const fromFile = async (slot: any) => {
    const file = await api.openFile(RKG_FILTER, "Choose a ghost file");
    if (!file) return;
    try { parseRKG(file.data); } catch (e: any) { return toast.error("Could not read the ghost", { description: e.message }); }
    await install(slot, file.data, file.name);
  };
  const fromLibrary = async (slot: any, item: any) => {
    // The inputs were driven somewhere else: on this track they can only go wrong.
    if (item.track !== track && !await dialogs.confirm({ title: "This ghost was recorded on another track", description: `It was driven on ${COURSE_NAMES[item.track] ?? "another track"}. A ghost holds the buttons pressed, so on ${COURSE_NAMES[track]} it will drive off the road.`, confirmLabel: "Use it anyway" })) return;
    try { await install(slot, (await api.readPath(item.path)).data, item.name); }
    catch (e: any) { toast.error("Could not read the ghost", { description: e.message }); }
  };
  const restore = async (slot: any) => {
    if (!await dialogs.confirm({ title: "Put the previous ghost back?", description: "The backup made when it was first replaced goes back in its place.", confirmLabel: "Restore" })) return;
    try {
      await api.writeFile(slot.path, (await api.readPath(slot.backup)).data);
      await load();
      toast.success("Ghost restored");
    } catch (e: any) { toast.error("Could not restore the ghost", { description: e.message }); }
  };
  // On the track being edited when this is its position; it reads the file, so as last saved.
  const preview = async (slot: any) => {
    try {
      const ghost = parseRKG((await api.readPath(slot.path)).data);
      await editor.openGhostPreview(ghost, editor.doc.filePath && (detected < 0 || detected === track) ? editor.doc.filePath : undefined);
    } catch (e: any) { toast.error("Could not read the ghost", { description: e.message }); }
  };
  const sorted = [...library].sort((a, b) => Number(b.track === track) - Number(a.track === track));

  return <div className="flex h-full min-h-0 flex-col gap-3">
    <div className="flex shrink-0 items-start gap-2">
      <div className="min-w-0 flex-1">
        <DialogTitle className="text-sm">Ghosts of this track</DialogTitle>
        <DialogDescription className="text-xs">The ghosts the game races you against in Time Trial. They are saved straight to the game folder (Race/TimeAttack), not in the track's SZS, and belong to its position in the game.</DialogDescription>
      </div>
      <Button size="icon-sm" variant="ghost" title="Close" aria-label="Close track ghosts" onClick={() => close(true)}><X /></Button>
    </div>
    <label className="flex shrink-0 items-center gap-2 text-xs">
      <span className="w-24 shrink-0 text-muted-foreground">Position</span>
      <select aria-label="Position" value={track} onChange={(e) => { setChoosing(null); setTrack(Number(e.target.value)); }} className="h-8 min-w-0 flex-1 rounded-md border bg-background px-1.5 text-xs">
        {COURSE_NAMES.map((name: string, id: number) => <option key={id} value={id}>{name}</option>)}
      </select>
    </label>
    {detected < 0 && <p className="shrink-0 text-[11px] text-muted-foreground">{editor.doc.fileName} is not named after a position of the game: choose the one where you play it.</p>}
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
      {!slots ? <p className="text-xs text-muted-foreground">Reading the ghosts…</p>
        : !slots.length ? <p className="text-xs text-destructive">No ghosts for this position in Race/TimeAttack. Choose the game folder in the settings.</p>
        : slots.map((slot) => <section key={slot.path} className="flex flex-col gap-1.5 border p-2" data-ghost-slot={slot.ghostType}>
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold">{STAFF_TYPE_NAMES[slot.ghostType] || `Ghost type ${slot.ghostType}`}</div>
              <div className="truncate text-[11px] text-muted-foreground">{ghostSummary(slot)}{slot.miiName ? ` · ${slot.miiName}` : ""}</div>
            </div>
            <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" title="Opens the track in its own window, showing only this ghost" onClick={() => preview(slot)}><Box className="size-3.5" /> Preview (beta)</Button>
            {slot.backup && <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={() => restore(slot)}><RotateCcw className="size-3.5" /> Restore</Button>}
            <Button size="sm" variant={choosing === slot.path ? "secondary" : "ghost"} className="h-7 px-2 text-xs" aria-pressed={choosing === slot.path} onClick={() => setChoosing(choosing === slot.path ? null : slot.path)}>Use a recorded ghost</Button>
            <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={() => fromFile(slot)}><FileUp className="size-3.5" /> .rkg file…</Button>
          </div>
          {choosing === slot.path && <div className="max-h-56 overflow-y-auto border" data-ghost-choices>
            {sorted.map((item) => <button key={item.path} type="button" onClick={() => fromLibrary(slot, item)} className="flex w-full cursor-pointer items-center gap-2 border-b px-2 py-1.5 text-left text-xs last:border-b-0 hover:bg-accent">
              <span className="min-w-0 flex-1 truncate">{ghostSummary(item)}</span>
              {item.track !== track && <span className="shrink-0 text-[10.5px] text-amber-400">another track</span>}
            </button>)}
            {!sorted.length && <p className="p-2 text-xs text-muted-foreground">Nothing recorded yet. Use Tools › Record a ghost.</p>}
          </div>}
        </section>)}
      <p className="text-[11px] text-muted-foreground">A ghost holds the buttons pressed, not the path: it only drives well on the track it was recorded on, with the same collision. The game also shows the time written in the file, which the ghost editor can change.</p>
    </div>
    <div className="flex shrink-0 justify-end"><Button onClick={() => close(true)}>Done</Button></div>
  </div>;
}
