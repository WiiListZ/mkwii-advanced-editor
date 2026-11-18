// Chooses a particle effect to place on the track: the game's objects that are only an effect, each
// with where its files come from (this track, or the track of the game folder that has them).
// Resolves with the object ID.

import * as React from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { EFFECT_OBJECTS } from "../../../js/data/effect-objects.js";
import { editor } from "../editor";

export function AddEffectDialog({ close }: { close: (objectId: number | null) => void }) {
  const sources = React.useMemo(() => new Map(EFFECT_OBJECTS.map((e) => [e.objectId, editor.effectSource(e.objectId)])), []);
  const noFolder = !editor.trackArchives.length;
  return <div className="flex flex-col gap-3" data-add-effect>
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <DialogTitle className="text-base">Add an effect here</DialogTitle>
        <DialogDescription className="text-xs">The game's objects that are only a particle effect: placed on the track, each plays its effect where it stands. Move it like any object, and change how it looks with Edit this effect… in the Inspector.</DialogDescription>
      </div>
      <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={() => close(null)}><X /></Button>
    </div>
    {noFolder && <p className="m-0 text-xs text-muted-foreground">Choose the game folder (Settings › Game files) for the effects that this track does not have yet.</p>}
    <div className="flex max-h-[60vh] flex-col divide-y overflow-y-auto rounded-md border">
      {EFFECT_OBJECTS.map((e) => {
        const source = sources.get(e.objectId);
        return <div key={e.objectId} className="flex items-center gap-2 px-2.5 py-1.5" data-effect={e.object}>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium">{e.label}</div>
            <div className="text-[10.5px] text-muted-foreground"><span className="font-mono">{e.object}</span> · {!source ? "not in the game folder" : source.inTrack ? "already in this track" : `copied from ${source.label}`}</div>
          </div>
          <Button size="sm" variant="secondary" disabled={!source} onClick={() => close(e.objectId)}>Add</Button>
        </div>;
      })}
    </div>
    <p className="m-0 text-[11px] text-muted-foreground">An effect's files serve every object of its kind in the track: editing one changes them all. Some play only at moments of the race (fireworks, confetti), as in the game.</p>
  </div>;
}
