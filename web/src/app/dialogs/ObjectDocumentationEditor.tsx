// The object documentation as JSON, edited in the editor: the documentation in use (the default one
// or the person's), checked as it is typed with the same rules as Replace with JSON…, and used when
// saved. Saving the default unchanged is the same as Restore default.

import * as React from "react";
import { CircleAlert, CircleCheck, CircleHelp, RotateCcw, Save, WrapText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { defaultDocumentation, parseObjectDocumentation } from "../../../js/data/object-documentation.js";
import { editor } from "../editor";
import { dialogs } from "../dialogs-store";
import { cn } from "@/lib/utils";

const same = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);

// The line and column of a JSON.parse error ("… at position 120" or "line 4 column 7").
function where(text: string, message: string) {
  const position = /position (\d+)/.exec(message);
  if (position) {
    const before = text.slice(0, Number(position[1])).split("\n");
    return { line: before.length, column: before[before.length - 1].length + 1 };
  }
  const lc = /line (\d+) column (\d+)/.exec(message);
  return lc ? { line: Number(lc[1]), column: Number(lc[2]) } : null;
}

export function ObjectDocumentationEditor({ close }: { close: (v: any) => void }) {
  // The default documentation in use (shipped, or downloaded from the object-info repository).
  const DEFAULT_TEXT = React.useMemo(() => JSON.stringify(defaultDocumentation().json, null, 2), []);
  const initial = React.useMemo(() => editor.usesCustomObjectDocumentation
    ? JSON.stringify({ version: 1, objects: editor.customObjectDocumentation }, null, 2) : DEFAULT_TEXT, [DEFAULT_TEXT]);
  const [text, setText] = React.useState(initial);
  const area = React.useRef<HTMLTextAreaElement>(null);
  const check = React.useMemo(() => {
    let json: any;
    try { json = JSON.parse(text); } catch (e: any) {
      const at = where(text, e.message);
      return { ok: false as const, message: `Not valid JSON${at ? ` (line ${at.line}, column ${at.column})` : ""}: ${e.message}`, at };
    }
    try { return { ok: true as const, objects: parseObjectDocumentation(json) }; } catch (e: any) { return { ok: false as const, message: e.message, at: null }; }
  }, [text]);
  // Restore default with a JSON of the person's in use also counts as a change to save.
  const dirty = text !== initial || (editor.usesCustomObjectDocumentation && text === DEFAULT_TEXT);
  const isDefault = check.ok && same({ ...check.objects }, { ...defaultDocumentation().objects });

  const leave = async () => {
    if (dirty && !(await dialogs.confirm({ title: "Close without saving?", description: "The changes to the documentation JSON will be lost.", confirmLabel: "Close without saving", destructive: true }))) return;
    close(null);
  };
  const save = async () => {
    if (!check.ok) return;
    if (isDefault) editor.useObjectDocumentation(null);
    else editor.useObjectDocumentation(check.objects, "JSON edited in the editor");
    close(true);
  };
  const goTo = (line: number, column: number) => {
    const el = area.current;
    if (!el) return;
    const lines = text.split("\n");
    const offset = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0) + column - 1;
    el.focus();
    el.setSelectionRange(offset, offset);
    el.scrollTop = Math.max(0, (line - 5) * parseFloat(getComputedStyle(el).lineHeight || "18"));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 items-start gap-3">
        <div className="min-w-0 flex-1">
          <DialogTitle className="text-base">Edit the object documentation</DialogTitle>
          <DialogDescription className="text-xs">
            {editor.usesCustomObjectDocumentation ? `In use: ${editor.customObjectDocumentationName || "your JSON"}.` : "In use: the editor's default documentation."} Save uses this JSON for every object, in place of the default documentation; <b>Restore default</b> brings the editor's own back at any time.
          </DialogDescription>
        </div>
        <Button size="sm" variant="ghost" onClick={() => void dialogs.open("help", { tab: "objectDocs" })}><CircleHelp /> JSON format</Button>
        <Button size="icon-sm" variant="ghost" aria-label="Close documentation editor" onClick={() => void leave()}><X /></Button>
      </div>
      <textarea ref={area} value={text} spellCheck={false} aria-label="Object documentation JSON"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "s" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void save(); }
          if (e.key === "Tab" && !e.shiftKey) {
            // Tab indents instead of leaving the box.
            e.preventDefault();
            const el = e.currentTarget, start = el.selectionStart, end = el.selectionEnd;
            setText(text.slice(0, start) + "  " + text.slice(end));
            requestAnimationFrame(() => el.setSelectionRange(start + 2, start + 2));
          }
        }}
        className="min-h-0 flex-1 resize-none rounded-md border bg-muted/20 p-3 font-mono text-[12px] leading-[18px] outline-none focus-visible:ring-1 focus-visible:ring-ring" />
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className={cn("flex min-w-0 flex-1 items-start gap-1.5 text-xs", check.ok ? "text-muted-foreground" : "text-destructive")} role="status" data-json-check>
          {check.ok ? <CircleCheck className="mt-px size-3.5 shrink-0" /> : <CircleAlert className="mt-px size-3.5 shrink-0" />}
          <span className="min-w-0">
            {check.ok ? `Valid: ${Object.keys(check.objects).length} objects${isDefault ? " (the default documentation)" : ""}.` : check.message}
            {!check.ok && check.at && <button type="button" className="ml-1.5 cursor-pointer underline underline-offset-2" onClick={() => goTo(check.at!.line, check.at!.column)}>Go there</button>}
          </span>
        </div>
        <Button size="sm" variant="ghost" disabled={!check.ok && !!check.at} title="Indent the JSON neatly" onClick={() => { try { setText(JSON.stringify(JSON.parse(text), null, 2)); } catch { /* not valid JSON */ } }}><WrapText /> Format</Button>
        <Button size="sm" variant="ghost" disabled={text === DEFAULT_TEXT} title="Put the editor's default documentation back in the box; Save then uses it again" onClick={() => setText(DEFAULT_TEXT)}><RotateCcw /> Restore default</Button>
        <Button size="sm" variant="outline" onClick={() => void leave()}>Cancel</Button>
        <Button size="sm" disabled={!check.ok || !dirty} onClick={() => void save()}><Save /> Save</Button>
      </div>
    </div>
  );
}
