// Undo / redo / save for editors that change files inside an archive (effects, game data).
// Each step remembers a file's bytes before and after; undo and redo write them back.

import * as React from "react";
import { Redo2, Save, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Step = { path: string; before: Uint8Array; after: Uint8Array; label: string };

export function useEditHistory(apply: (path: string, data: Uint8Array) => void) {
  const [undoStack, setUndo] = React.useState<Step[]>([]);
  const [redoStack, setRedo] = React.useState<Step[]>([]);
  const [unsaved, setUnsaved] = React.useState(false);
  const record = (path: string, before: Uint8Array, after: Uint8Array, label: string) => {
    apply(path, after);
    setUndo((s) => [...s.slice(-199), { path, before, after, label }]);
    setRedo([]);
    setUnsaved(true);
  };
  const undo = () => {
    const step = undoStack[undoStack.length - 1];
    if (!step) return;
    apply(step.path, step.before);
    setUndo((s) => s.slice(0, -1));
    setRedo((s) => [...s, step]);
    setUnsaved(true);
  };
  const redo = () => {
    const step = redoStack[redoStack.length - 1];
    if (!step) return;
    apply(step.path, step.after);
    setRedo((s) => s.slice(0, -1));
    setUndo((s) => [...s, step]);
    setUnsaved(true);
  };
  const reset = () => { setUndo([]); setRedo([]); setUnsaved(false); };
  return { record, undo, redo, reset, canUndo: undoStack.length > 0, canRedo: redoStack.length > 0, undoLabel: undoStack[undoStack.length - 1]?.label, redoLabel: redoStack[redoStack.length - 1]?.label, unsaved, saved: () => setUnsaved(false) };
}

// Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) / Ctrl+S inside the window, except while typing in a field.
export function useHistoryKeys(history: ReturnType<typeof useEditHistory>, save: () => void, enabled = true) {
  React.useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const typing = (e.target as HTMLElement)?.closest?.("input, textarea, select, [contenteditable=true]");
      const key = e.key.toLowerCase();
      if (key === "s") { e.preventDefault(); e.stopPropagation(); save(); return; }
      if (typing) return;
      if (key === "z" && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); history.undo(); }
      else if (key === "y" || (key === "z" && e.shiftKey)) { e.preventDefault(); e.stopPropagation(); history.redo(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });
}

export function HistoryBar({ history, onSave, saveLabel = "Save", saving }: {
  history: ReturnType<typeof useEditHistory>; onSave: () => void; saveLabel?: string; saving?: boolean;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
      <Button size="sm" variant="ghost" disabled={!history.canUndo} onClick={history.undo} title={history.undoLabel ? `Undo: ${history.undoLabel} (Ctrl+Z)` : "Nothing to undo"}><Undo2 /> Undo</Button>
      <Button size="sm" variant="ghost" disabled={!history.canRedo} onClick={history.redo} title={history.redoLabel ? `Redo: ${history.redoLabel} (Ctrl+Y)` : "Nothing to redo"}><Redo2 /> Redo</Button>
      <span className="ml-auto text-[11px] text-muted-foreground">{history.unsaved ? "Unsaved changes" : ""}</span>
      <Button size="sm" disabled={saving} onClick={onSave} title="Ctrl+S"><Save /> {saveLabel}</Button>
    </div>
  );
}
