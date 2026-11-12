// What differs between the open track and another version of it, as a list. From here they can be seen
// on the track itself.

import * as React from "react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { differencePlaces } from "../../../js/editor/track-diff.js";
import { editor } from "../editor";

export const DIFFERENCE_COLOURS: Record<string, string> = { added: "#4ade80", removed: "#f87171", moved: "#fbbf24", changed: "#60a5fa", collision: "#c084fc" };
const STATE_TEXT: Record<string, string> = { added: "Added", removed: "Removed", moved: "Moved", changed: "Changed", collision: "Collision" };

export function TrackCompareDialog({ result, label, close }: { result: any; label: string; close: (value: any) => void }) {
  const places = React.useMemo(() => differencePlaces(result), [result]);
  const unplaced = result.items.filter((item: any) => !item.pos);
  const show = (index: number) => { close(true); editor.showComparison(result, label, index); };
  const summary = [
    result.counts.added && `${result.counts.added} added`, result.counts.removed && `${result.counts.removed} removed`,
    result.counts.moved && `${result.counts.moved} moved`, result.counts.changed && `${result.counts.changed} changed`,
  ].filter(Boolean).join(", ");
  const { collision } = result;
  const collisionText = [collision.added && `${collision.added} added`, collision.removed && `${collision.removed} removed`, collision.retyped && `${collision.retyped} with another type`].filter(Boolean).join(", ");

  return <div className="flex h-full min-h-0 flex-col gap-3" data-track-compare data-identical={result.identical}>
    <div className="shrink-0">
      <DialogTitle className="text-sm">Compare with {label}</DialogTitle>
      <DialogDescription className="text-xs">{result.identical ? "The two are the same." : "What the open track has that the other does not is added; what only the other has is removed."}</DialogDescription>
    </div>
    {!result.identical && <div className="min-h-0 flex-1 overflow-y-auto border">
      <div className="border-b px-2 py-1 text-[11px] text-muted-foreground">Elements: {summary || "the same"} · Collision triangles: {collisionText || "the same"} · Files: {result.files.length || "the same"}</div>
      {places.map((place: any, index: number) => <button key={index} type="button" onClick={() => show(index)} data-difference={place.state}
        className="flex w-full cursor-pointer items-center gap-2 border-b px-2 py-1 text-left text-xs last:border-b-0 hover:bg-accent">
        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: DIFFERENCE_COLOURS[place.state] }} aria-hidden="true" />
        <span className="w-16 shrink-0 text-muted-foreground">{STATE_TEXT[place.state]}</span>
        <span className="min-w-0 flex-1 truncate">{place.label}</span>
        <span className="min-w-0 shrink truncate text-[11px] text-muted-foreground">{place.detail}</span>
      </button>)}
      {collision.regionCount > collision.regions.length && <div className="border-b px-2 py-1 text-[11px] text-muted-foreground">And {collision.regionCount - collision.regions.length} smaller places with collision changes.</div>}
      {unplaced.map((item: any, i: number) => <div key={i} className="flex items-center gap-2 border-b px-2 py-1 text-xs last:border-b-0">
        <span className="w-16 shrink-0 text-muted-foreground">{STATE_TEXT[item.state]}</span><span className="min-w-0 flex-1 truncate">{item.label}</span><span className="truncate text-[11px] text-muted-foreground">{item.detail}</span>
      </div>)}
      {result.settings.map((setting: any) => <div key={setting.field} className="flex items-center gap-2 border-b px-2 py-1 text-xs last:border-b-0" data-difference="setting">
        <span className="w-16 shrink-0 text-muted-foreground">Setting</span><span className="min-w-0 flex-1 truncate">{setting.field}</span><span className="truncate text-[11px] text-muted-foreground">{String(setting.theirs)} → {String(setting.mine)}</span>
      </div>)}
      {result.files.map((file: any) => <div key={file.path} className="flex items-center gap-2 border-b px-2 py-1 text-xs last:border-b-0" data-difference="file">
        <span className="w-16 shrink-0 text-muted-foreground">{STATE_TEXT[file.state]}</span><span className="min-w-0 flex-1 truncate">{file.path}</span><span className="min-w-0 truncate text-[11px] text-muted-foreground">{file.detail}</span>
      </div>)}
    </div>}
    <div className="flex shrink-0 justify-end gap-2">
      <Button variant="ghost" onClick={() => close(false)}>Close</Button>
      <Button disabled={!places.length} onClick={() => show(0)}>Show on the track</Button>
    </div>
  </div>;
}

// In the 3D view while comparing: go through the differences, and stop.
export function ComparisonBar() {
  const state = editor.comparison!;
  const place = state.places[state.index];
  return <div className="absolute left-1/2 top-3 z-10 flex w-max max-w-[80%] -translate-x-1/2 items-center gap-2 rounded border bg-background/95 px-2 py-1 text-xs" data-comparison-bar={state.index}>
    <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: DIFFERENCE_COLOURS[place?.state] }} aria-hidden="true" />
    <span className="min-w-0 truncate">{place ? `${STATE_TEXT[place.state]}: ${place.label}${place.detail ? ` · ${place.detail}` : ""}` : "No differences to show"}</span>
    <span className="shrink-0 tabular-nums text-muted-foreground">{state.index + 1} of {state.places.length}</span>
    <Button size="icon-sm" variant="ghost" aria-label="Previous difference" title="Previous difference" onClick={() => editor.goToDifference(state.index - 1)}>‹</Button>
    <Button size="icon-sm" variant="ghost" aria-label="Next difference" title="Next difference" onClick={() => editor.goToDifference(state.index + 1)}>›</Button>
    <Button size="sm" variant="secondary" className="h-7 px-2 text-xs" onClick={() => editor.clearComparison()}>Stop comparing</Button>
  </div>;
}
