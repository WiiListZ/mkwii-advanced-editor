// The object documentation as JSON, edited in the editor: the documentation in use (the default one
// or the person's), checked as it is typed with the same rules as Replace with JSON…, and used when
// saved. Saving the default unchanged is the same as Restore default. It opens as a form (Visual),
// and the same text can be edited as it is (Raw JSON).

import * as React from "react";
import { CircleAlert, CircleCheck, CircleHelp, RotateCcw, Save, WrapText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { defaultDocumentation, parseObjectDocumentation } from "../../../js/data/object-documentation.js";
import { jsonErrorAt, jsonTokens } from "../../../js/editor/json-highlight.js";
import { ObjectDocumentationVisual } from "./ObjectDocumentationVisual";
import { editor } from "../editor";
import { dialogs } from "../dialogs-store";
import { cn } from "@/lib/utils";

const same = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);

// The colour of each kind of JSON piece (see json-highlight.js).
const TOKEN_CLASS: Record<string, string> = {
  key: "text-sky-300", string: "text-emerald-300", number: "text-amber-300", literal: "text-violet-300", punctuation: "text-muted-foreground",
};
const LINE = 18, PAD = 12; // px: the line height and padding the text box and its colours share

// The line and column of a JSON.parse error ("… at position 120" or "line 4 column 7").
function where(text: string, message: string) {
  const position = /position (\d+)/.exec(message);
  if (position) {
    const before = text.slice(0, Number(position[1])).split("\n");
    return { line: before.length, column: before[before.length - 1].length + 1 };
  }
  const lc = /line (\d+) column (\d+)/.exec(message);
  if (lc) return { line: Number(lc[1]), column: Number(lc[2]) };
  // Chromium's messages do not say where: found by reading the text.
  const at = jsonErrorAt(text);
  if (at < 0) return null;
  const lines = text.slice(0, at).split("\n");
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

export function ObjectDocumentationEditor({ close }: { close: (v: any) => void }) {
  // The default documentation in use (shipped, or downloaded from the object-info repository).
  const DEFAULT_TEXT = React.useMemo(() => JSON.stringify(defaultDocumentation().json, null, 2), []);
  const initial = React.useMemo(() => editor.usesCustomObjectDocumentation
    ? JSON.stringify({ version: 1, objects: editor.customObjectDocumentation }, null, 2) : DEFAULT_TEXT, [DEFAULT_TEXT]);
  const [text, setText] = React.useState(initial);
  const [view, setView] = React.useState<"visual" | "raw">("visual");
  const area = React.useRef<HTMLTextAreaElement>(null);
  // A place to show in the raw JSON once it is on screen (Go there from the form).
  const pending = React.useRef<{ line: number; column: number } | null>(null);
  // The colours are drawn under the text box, whose own text is transparent: it scrolls them along.
  const colours = React.useRef<HTMLDivElement>(null);
  const tokens = React.useMemo(() => jsonTokens(text), [text]);
  const follow = () => {
    const el = area.current, layer = colours.current;
    if (el && layer) layer.style.transform = `translate(${-el.scrollLeft}px, ${-el.scrollTop}px)`;
  };
  React.useLayoutEffect(follow, [text, view]);
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
    if (!el || view !== "raw") { pending.current = { line, column }; setView("raw"); return; }
    const lines = text.split("\n");
    const offset = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0) + column - 1;
    el.focus();
    el.setSelectionRange(offset, offset);
    el.scrollTop = Math.max(0, (line - 5) * LINE);
    follow();
  };

  React.useEffect(() => {
    if (view !== "raw" || !pending.current) return;
    const { line, column } = pending.current;
    pending.current = null;
    goTo(line, column);
  }, [view]);

  const tab = (id: "visual" | "raw", label: string) => <button type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)}
    className={cn("-mb-px cursor-pointer border-b-2 px-3 py-1.5 text-xs", view === id ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>{label}</button>;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" onKeyDownCapture={(e) => { if (e.key === "s" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); void save(); } }}>
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
      <div className="-mb-1 flex shrink-0 border-b" role="tablist" aria-label="How to edit">{tab("visual", "Visual")}{tab("raw", "Raw JSON")}</div>
      {view === "visual" ? <ObjectDocumentationVisual text={text} onChange={setText} onRaw={() => setView("raw")} /> : <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border bg-muted/20 focus-within:ring-1 focus-within:ring-ring">
      <div ref={colours} aria-hidden="true" className="pointer-events-none absolute left-0 top-0 min-w-full" data-json-colours>
        {!check.ok && check.at && <div className="absolute inset-x-0 bg-destructive/20" style={{ top: PAD + (check.at.line - 1) * LINE, height: LINE }} data-json-error-line />}
        <pre className="relative m-0 whitespace-pre font-mono text-[12px] leading-[18px] text-foreground" style={{ padding: PAD }}>
          {tokens.map((token: any, i: number) => token.type === "plain" ? token.text : <span key={i} className={TOKEN_CLASS[token.type]}>{token.text}</span>)}
          {/* A last line as the text box has, so both scroll as far. */}
          {"\n"}
        </pre>
      </div>
      <textarea ref={area} value={text} spellCheck={false} wrap="off" aria-label="Object documentation JSON"
        onChange={(e) => setText(e.target.value)}
        onScroll={follow}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Tab" && !e.shiftKey) {
            // Tab indents instead of leaving the box.
            e.preventDefault();
            const el = e.currentTarget, start = el.selectionStart, end = el.selectionEnd;
            setText(text.slice(0, start) + "  " + text.slice(end));
            requestAnimationFrame(() => el.setSelectionRange(start + 2, start + 2));
          }
        }}
        className="absolute inset-0 h-full w-full resize-none whitespace-pre bg-transparent font-mono text-[12px] leading-[18px] text-transparent caret-foreground outline-none selection:bg-sky-400/30"
        style={{ padding: PAD }} />
      </div>}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className={cn("flex min-w-0 flex-1 items-start gap-1.5 text-xs", check.ok ? "text-muted-foreground" : "text-destructive")} role="status" data-json-check>
          {check.ok ? <CircleCheck className="mt-px size-3.5 shrink-0" /> : <CircleAlert className="mt-px size-3.5 shrink-0" />}
          <span className="min-w-0">
            {check.ok ? `Valid: ${Object.keys(check.objects).length} objects${isDefault ? " (the default documentation)" : ""}.` : check.message}
            {!check.ok && check.at && <button type="button" className="ml-1.5 cursor-pointer underline underline-offset-2" onClick={() => goTo(check.at!.line, check.at!.column)}>Go there</button>}
          </span>
        </div>
        {view === "raw" && <Button size="sm" variant="ghost" disabled={!check.ok && !!check.at} title="Indent the JSON neatly" onClick={() => { try { setText(JSON.stringify(JSON.parse(text), null, 2)); } catch { /* not valid JSON */ } }}><WrapText /> Format</Button>}
        <Button size="sm" variant="ghost" disabled={text === DEFAULT_TEXT} title="Put the editor's default documentation back in the box; Save then uses it again" onClick={() => setText(DEFAULT_TEXT)}><RotateCcw /> Restore default</Button>
        <Button size="sm" variant="outline" onClick={() => void leave()}>Cancel</Button>
        <Button size="sm" disabled={!check.ok || !dirty} onClick={() => void save()}><Save /> Save</Button>
      </div>
    </div>
  );
}
