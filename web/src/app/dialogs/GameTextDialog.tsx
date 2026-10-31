// Game text editor: the messages of Scene/UI/*_<language>.szs (message/*.bmg), with a preview in
// the game's own font. The same BMG file is copied in many archives (Common.bmg and Menu.bmg are in
// almost every scene), so a change is written into every copy of the chosen language.

import * as React from "react";
import { FolderOpen, LoaderCircle, RotateCcw, Save, Search, Smile, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api } from "../../../js/api.js";
import { buildU8, findFile, listFiles, newSzsTree, parseU8, setFilePath } from "../../../js/formats/u8.js";
import { buildBMG, escapes, fontSizePercent, messagePlace, parseBMG, plainText, setFontSizePercent, stripFontSizePrefix } from "../../../js/formats/bmg.js";
import { drawText, parseBRFNT } from "../../../js/formats/brfnt.js";
import { editor, type LooseFile } from "../editor";
import { dialogs } from "../dialogs-store";
import { GameTextPreview } from "./GameTextPreview";
import { cn } from "@/lib/utils";

const LANGUAGES: Record<string, string> = { E: "English", I: "Italian", F: "French", G: "German", S: "Spanish", J: "Japanese", K: "Korean", U: "English (US)", M: "Spanish (Americas)", Q: "French (Canada)" };
const LIST_LIMIT = 400;

// `loose`: a .bmg opened on its own; its tree holds just that file, saved back as the .bmg.
interface Archive { path: string; name: string; tree: any; bmgs: Map<string, { path: string; bmg: any }>; loose?: LooseFile }
interface Message { key: string; file: string; id: number; text: string; place: string; copies: number }

const hex = (n: number) => "0x" + n.toString(16).toUpperCase().padStart(4, "0");
const join = (dir: string, name: string) => `${dir.replace(/[\\/]+$/, "")}\\${name}`;

function defaultFolder() {
  return editor.workspacePath("Scene", "UI") || localStorage.getItem("mkwii-ui-folder") || "";
}

// folder / language / file: open on one archive folder, language and BMG (from the archive window).
export function GameTextDialog({ search: initialSearch = "", folder: initialFolder, language: initialLanguage, file: initialFile, loose, saveLoose, close }: {
  search?: string; folder?: string; language?: string; file?: string; loose?: LooseFile; saveLoose?: (data: Uint8Array) => Promise<boolean>; close: (v: any) => void;
}) {
  const [folder, setFolder] = React.useState(() => initialFolder || defaultFolder());
  const [files, setFiles] = React.useState<string[] | null>(null);
  const [language, setLanguage] = React.useState("");
  const [archives, setArchives] = React.useState<Archive[] | null>(null);
  const [loading, setLoading] = React.useState("");
  const [error, setError] = React.useState("");
  const [font, setFont] = React.useState<any>(null);
  const [iconFont, setIconFont] = React.useState<any>(null);
  const [query, setQuery] = React.useState(initialSearch);
  const [fileFilter, setFileFilter] = React.useState(initialFile || "all");
  const [onlyChanged, setOnlyChanged] = React.useState(false);
  const [inGamePreview, setInGamePreview] = React.useState(() => localStorage.getItem("mkwii-in-game-text-preview") !== "false");
  const [selected, setSelected] = React.useState<string | null>(null);
  const [edits, setEdits] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);

  // Archives of the folder and the languages they come in.
  React.useEffect(() => {
    if (!folder) { setFiles([]); return; }
    setError("");
    api.listDir(folder, ["szs"]).then((list: string[]) => {
      setFiles(list);
      const langs = languagesOf(list);
      setLanguage((current) => (current && langs.includes(current) ? current : initialLanguage && langs.includes(initialLanguage) ? initialLanguage : langs.includes("E") ? "E" : langs[0] || ""));
      if (!langs.length && !loose) setError("No language archives (like Race_E.szs) in this folder. Choose the game's files\\Scene\\UI folder.");
    }).catch((e: any) => { setFiles([]); setError(e.message); });
    // The game's font, for the preview.
    api.readPath(join(folder, "Font.szs")).then(async (f: any) => {
      const tree = parseU8(await api.decodeArchiveBytes(f.data, f.path));
      const node = findFile(tree, "kart_kanji_font.brfnt") || findFile(tree, "tt_kart_font_rodan_ntlg_pro_b.brfnt");
      if (node) setFont(parseBRFNT(node.data));
      // Controller buttons and other icons the messages insert as characters.
      const icons = findFile(tree, "tt_kart_extension_font.brfnt");
      setIconFont(icons ? parseBRFNT(icons.data) : null);
    }).catch(() => { setFont(null); setIconFont(null); });
  }, [folder]);

  // Every archive of the language, with its BMG files.
  React.useEffect(() => {
    if (loose) {
      const tree = newSzsTree();
      setFilePath(tree, loose.name, loose.data);
      const key = loose.name.replace(/\.bmg$/i, "");
      try {
        setArchives([{ path: loose.path || loose.name, name: loose.name, tree, bmgs: new Map([[key, { path: loose.name, bmg: parseBMG(loose.data) }]]), loose: { ...loose } }]);
      } catch (e: any) { setError(`${loose.name} is not a text BMG: ${e.message}`); setArchives([]); }
      return;
    }
    if (!files || !language) return;
    let cancelled = false;
    setArchives(null); setSelected(null); setEdits({});
    (async () => {
      const names = files.filter((f) => new RegExp(`_${language}\\.szs$`, "i").test(f));
      const out: Archive[] = [];
      for (const [n, name] of names.entries()) {
        if (cancelled) return;
        setLoading(`Reading ${name} (${n + 1}/${names.length})…`);
        try {
          const f = await api.readPath(join(folder, name));
          const tree = parseU8(await api.decodeArchiveBytes(f.data, f.path));
          const bmgs = new Map<string, { path: string; bmg: any }>();
          for (const entry of listFiles(tree)) {
            const m = entry.path.match(/([^/]+)\.bmg$/i);
            if (m) try { bmgs.set(m[1], { path: entry.path, bmg: parseBMG(entry.node.data) }); } catch { /* not a text BMG */ }
          }
          if (bmgs.size) out.push({ path: join(folder, name), name, tree, bmgs });
        } catch (e: any) { console.warn("Could not read", name, e); }
      }
      if (!cancelled) { setArchives(out); setLoading(""); }
    })();
    return () => { cancelled = true; };
  }, [files, language, folder]);

  // One list per BMG name (the first copy is shown; edits go to every copy).
  const messages = React.useMemo<Message[]>(() => {
    if (!archives) return [];
    const byFile = new Map<string, { bmg: any; copies: number }>();
    for (const a of archives) for (const [file, { bmg }] of a.bmgs) {
      const e = byFile.get(file);
      if (e) e.copies++; else byFile.set(file, { bmg, copies: 1 });
    }
    const order = ["Common", "Menu", "Race", "Number"];
    const files = [...byFile.keys()].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) || a.localeCompare(b));
    return files.flatMap((file) => byFile.get(file)!.bmg.messages.map((m: any) => ({
      key: `${file}:${m.id}`, file, id: m.id, text: m.text, place: messagePlace(file, m.id), copies: byFile.get(file)!.copies,
    })));
  }, [archives]);
  const bmgFiles = [...new Set(messages.map((m) => m.file))];

  const q = query.trim().toLowerCase();
  const filtered = messages.filter((m) => {
    if (fileFilter !== "all" && m.file !== fileFilter) return false;
    if (onlyChanged && edits[m.key] === undefined) return false;
    if (!q) return m.text !== "" || edits[m.key] !== undefined;
    const text = (edits[m.key] ?? m.text).toLowerCase();
    return text.includes(q) || hex(m.id).toLowerCase().includes(q) || m.id.toString(16) === q.replace(/^0x/, "") || m.place.toLowerCase().includes(q);
  });
  const current = messages.find((m) => m.key === selected) || null;
  // Text of any message as it is now (edits included), for the other names shown on a game screen.
  const lookup = React.useMemo(() => {
    const texts = new Map<string, string>();
    for (const m of messages) if (!texts.has(m.key)) texts.set(m.key, edits[m.key] ?? m.text);
    return (file: string, id: number) => texts.get(`${file}:${id}`) ?? null;
  }, [messages, edits]);
  React.useEffect(() => {
    if (!filtered.some((m) => m.key === selected)) setSelected(filtered[0]?.key ?? null);
  }, [filtered, selected]);
  const changedKeys = Object.keys(edits);

  const save = async () => {
    if (!archives || !changedKeys.length) return;
    setSaving(true);
    try {
      const byFile: Record<string, Record<number, string>> = {};
      for (const key of changedKeys) {
        const [file, id] = key.split(":");
        (byFile[file] ||= {})[Number(id)] = edits[key];
      }
      let written = 0;
      for (const a of archives) {
        let changed = false;
        for (const [file, entry] of a.bmgs) {
          if (!byFile[file]) continue;
          const data = buildBMG(entry.bmg, byFile[file]);
          if (data === entry.bmg.data) continue;
          setFilePath(a.tree, entry.path, data);
          entry.bmg = parseBMG(data);
          changed = true;
        }
        if (!changed) continue;
        setLoading(`Saving ${a.name}…`);
        if (a.loose) {
          const data = findFile(a.tree, a.loose.name)!.data;
          // A BMG kept inside another file (a Pulsar pack's names) is written back by its owner.
          const target = saveLoose ? ((await saveLoose(data)) ? a.loose.path || a.loose.name : null) : await editor.writeLoose(a.loose.path, a.loose.name, data);
          if (!target) throw new Error("Not saved");
          a.loose = { ...a.loose, path: target, data };
          a.path = target;
        } else await api.writeFile(a.path, buildU8(a.tree), { backup: editor.settings.keepBackups, edited: true, compress: "yaz0" });
        written++;
      }
      setArchives([...archives]);
      setEdits({});
      if (!archives.some((a) => a.loose)) toast.success(`Game text saved in ${written} archive${written === 1 ? "" : "s"}`, { description: `${changedKeys.length} message${changedKeys.length === 1 ? "" : "s"} changed. ${editor.settings.keepBackups ? "The first save keeps a .bak copy of each original archive." : "Backups are off in Settings."}` });
    } catch (e: any) {
      toast.error("Could not save the game text", { description: e.message });
    }
    setLoading("");
    setSaving(false);
  };

  const chooseFolder = async () => {
    const path = await api.chooseFolder("Choose the game's files\\Scene\\UI folder", folder);
    if (path) { localStorage.setItem("mkwii-ui-folder", path); setFolder(path); }
  };

  const requestClose = async () => {
    if (changedKeys.length && !(await dialogs.confirm({ title: "Unsaved text changes", description: `${changedKeys.length} changed message${changedKeys.length === 1 ? "" : "s"} will be lost.`, confirmLabel: "Close without saving", destructive: true }))) return;
    close(null);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <DialogTitle className="text-sm">Game text{loose ? ` · ${loose.name}` : ""}</DialogTitle>
          {loose ? <DialogDescription className="m-0 truncate text-xs" title={loose.path || loose.name}>Messages of {loose.path || loose.name}. Save writes this file.{folder ? "" : " Choose the game's Scene\\UI folder to preview them in the game's font."}</DialogDescription>
            : <DialogDescription className="m-0 truncate text-xs" title={folder}>Messages of the menus and races, from {folder ? "…\\" + folder.split(/[\\/]/).filter(Boolean).slice(-3).join("\\") : "the game's Scene\\UI folder"}.</DialogDescription>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={chooseFolder}><FolderOpen /> Folder…</Button>
          <Button size="icon-sm" variant="ghost" title="Close" aria-label="Close game text editor" onClick={requestClose}><X /></Button>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {!loose && <Select value={language} onValueChange={async (v) => {
          if (changedKeys.length && !(await dialogs.confirm({ title: "Unsaved text changes", description: "Switching language discards the changes not saved yet.", confirmLabel: "Discard changes", destructive: true }))) return;
          setLanguage(v);
        }}>
          <SelectTrigger className="h-8 w-44 text-xs" aria-label="Language"><SelectValue placeholder="Language" /></SelectTrigger>
          <SelectContent>{languagesOf(files || []).map((l) => <SelectItem key={l} value={l}>{LANGUAGES[l] || l} (_{l})</SelectItem>)}</SelectContent>
        </Select>}
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Find text, ID (0x2454) or place (track name, menu…)" className="h-8 pl-7 text-xs" />
        </div>
        <Select value={fileFilter} onValueChange={setFileFilter}>
          <SelectTrigger className="h-8 w-36 text-xs" aria-label="File"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All files</SelectItem>
            {bmgFiles.map((f) => <SelectItem key={f} value={f}>{f}.bmg</SelectItem>)}
          </SelectContent>
        </Select>
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
          <input type="checkbox" className="accent-primary" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} /> Only changed
        </label>
      </div>

      {error && <p className="m-0 text-xs text-destructive">{error}</p>}
      {!folder && !loose && <p className="m-0 text-xs text-muted-foreground">Load Race/Common.szs from the game folder first, or choose the game's files\Scene\UI folder.</p>}

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,380px)_minmax(0,1fr)] gap-3">
        <div className="flex min-h-0 flex-col rounded-md border">
          <div className="shrink-0 border-b px-2.5 py-1.5 text-[11px] text-muted-foreground">
            {loading || (archives ? `${filtered.length.toLocaleString()} messages${filtered.length > LIST_LIMIT ? ` · first ${LIST_LIMIT} shown, refine the search` : ""}` : "…")}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1">
            {filtered.slice(0, LIST_LIMIT).map((m) => {
              const text = edits[m.key] ?? m.text;
              return (
                <button key={m.key} onClick={() => setSelected(m.key)}
                  className={cn("flex w-full cursor-pointer flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left hover:bg-accent/60", m.key === selected && "bg-accent")}>
                  <span className="flex w-full items-center gap-1.5 text-[10.5px] text-muted-foreground">
                    <span className="font-mono">{hex(m.id)}</span> · {m.place}
                    {edits[m.key] !== undefined && <span className="ml-auto size-1.5 rounded-full bg-primary" title="Changed" />}
                  </span>
                  <span className="line-clamp-2 w-full whitespace-pre-line text-[12.5px]">{plainText(text) || <span className="text-muted-foreground">(empty)</span>}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          {current ? (
            <MessageEditor key={current.key} message={current} folder={folder} font={font} iconFont={iconFont} value={edits[current.key] ?? current.text} lookup={lookup}
              inGamePreview={inGamePreview} onInGamePreviewChange={(enabled) => { setInGamePreview(enabled); localStorage.setItem("mkwii-in-game-text-preview", String(enabled)); }}
              twins={current.text ? messages.filter((m) => m.key !== current.key && m.text === current.text) : []}
              onChange={(text, keys = [current.key]) => setEdits((e) => {
                const next = { ...e };
                for (const key of keys) {
                  const original = messages.find((m) => m.key === key)!.text;
                  if (text === original) delete next[key]; else next[key] = text;
                }
                return next;
              })} />
          ) : (
            <div className="grid flex-1 place-items-center text-xs text-muted-foreground">{loading ? <LoaderCircle className="size-5 animate-spin" /> : "Choose a message on the left."}</div>
          )}
        </div>
      </div>
      <div className="flex shrink-0 justify-end border-t pt-2">
        <Button size="sm" disabled={!changedKeys.length || saving} onClick={save}>{saving ? <LoaderCircle className="animate-spin" /> : <Save />} Save {changedKeys.length || ""}</Button>
      </div>
    </div>
  );
}

function languagesOf(files: string[]) {
  return [...new Set(files.map((f) => f.match(/_([A-Z])\.szs$/i)?.[1]?.toUpperCase()).filter(Boolean) as string[])].sort((a, b) => (a === "E" ? -1 : b === "E" ? 1 : a.localeCompare(b)));
}

// One icon of the game's icon font, drawn as the game draws it.
function IconGlyph({ font, code }: { font: any; code: number }) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    const c = ref.current, g = c?.getContext("2d");
    if (!c || !g) return;
    const index = font.chars.get(code), w = font.widths.get(index) || font.defaultWidth;
    const scale = Math.min(c.width / Math.max(1, w.glyph), c.height / font.cellH);
    g.clearRect(0, 0, c.width, c.height);
    drawText(g, font, [{ text: String.fromCodePoint(code), color: "#ffffff" }], (c.width - w.glyph * scale) / 2 - w.left * scale, (c.height - font.cellH * scale) / 2, { scale });
  }, [font, code]);
  return <canvas ref={ref} width={56} height={56} className="size-7" aria-hidden />;
}

// Inserts a game icon where the cursor is, as the code the game's own messages use for it.
function IconPicker({ font, onInsert }: { font: any; onInsert: (code: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const codes = font ? [...font.chars.keys()].filter((c: number) => {
    const w = font.widths.get(font.chars.get(c));
    return w ? w.glyph > 0 : true;
  }).sort((a: number, b: number) => a - b) : [];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="secondary" className="h-6 px-2 text-[11px]" disabled={!codes.length} title={codes.length ? "Insert a game icon (buttons, modes…)" : "Choose the game's Scene\\UI folder to use its icons"}><Smile /> Insert icon</Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[340px] p-2">
        <div className="mb-1.5 px-1 text-[11px] text-muted-foreground">Game icons (tt_kart_extension_font). Click one to insert it at the cursor.</div>
        <div className="grid grid-cols-8 gap-1">
          {codes.map((code: number) => {
            const hex4 = code.toString(16).padStart(4, "0");
            return (
              <button key={code} type="button" title={`U+${hex4.toUpperCase()} · {1A:08010000${hex4}}`}
                onClick={() => { onInsert(`{1A:08010000${hex4}}`); setOpen(false); }}
                className="grid aspect-square cursor-pointer place-items-center rounded border bg-black/60 hover:border-primary hover:bg-black">
                <IconGlyph font={font} code={code} />
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function MessageEditor({ message, folder, value, font, iconFont, twins, lookup, inGamePreview, onInGamePreviewChange, onChange }: { message: Message; folder: string; value: string; font: any; iconFont: any; twins: Message[]; lookup: (file: string, id: number) => string | null; inGamePreview: boolean; onInGamePreviewChange: (enabled: boolean) => void; onChange: (text: string, keys?: string[]) => void }) {
  const body = stripFontSizePrefix(value);
  const percent = fontSizePercent(value);
  const codes = escapes(body);
  const area = React.useRef<HTMLTextAreaElement>(null);
  const caret = React.useRef<number | null>(null);
  // Keeps the cursor after the inserted code once React has put the new text in the box.
  React.useLayoutEffect(() => {
    if (caret.current === null || !area.current) return;
    area.current.focus();
    area.current.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [body]);
  const insert = (code: string) => {
    const el = area.current, start = el?.selectionStart ?? body.length, end = el?.selectionEnd ?? body.length;
    caret.current = start + code.length;
    onChange(setFontSizePercent(body.slice(0, start) + code + body.slice(end), percent));
  };
  return (
    <>
      <div className="flex shrink-0 items-baseline gap-2">
        <span className="text-sm font-semibold">{message.place}</span>
        <span className="font-mono text-[11px] text-muted-foreground">{message.file}.bmg · {hex(message.id)}</span>
        <span className="ml-auto text-[11px] text-muted-foreground">{message.copies} {message.copies === 1 ? "copy" : "copies"} in this language</span>
      </div>
      <GameTextPreview folder={folder} file={message.file} id={message.id} font={font} text={value} originalText={message.text} place={message.place} lookup={lookup} inGamePreview={inGamePreview} onInGamePreviewChange={onInGamePreviewChange} />
      <div className="flex shrink-0 flex-col gap-1.5">
        <textarea ref={area} value={body} onChange={(e) => onChange(setFontSizePercent(e.target.value, percent))} onKeyDown={(e) => e.stopPropagation()} spellCheck={false} rows={5}
          className="min-h-24 w-full resize-y rounded-md border bg-background p-2.5 font-mono text-[13px] leading-relaxed outline-none focus:ring-1 focus:ring-ring" />
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <IconPicker font={iconFont} onInsert={insert} />
          <span>{plainText(body).length} characters · {body.split("\n").length} lines</span>
          {value !== message.text && <Button size="sm" variant="ghost" className="ml-auto h-6 px-2 text-[11px]" onClick={() => onChange(message.text)}><RotateCcw /> Original</Button>}
        </div>
        <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="w-16 shrink-0">Font size</span>
          <input type="range" min={20} max={200} step={1} value={Math.min(200, Math.max(20, percent))}
            onChange={(e) => onChange(setFontSizePercent(value, Number(e.target.value)))} className="min-w-0 flex-1 accent-primary" />
          <span className="w-9 text-right font-mono text-foreground">{percent}%</span>
        </label>
      </div>
      {twins.length > 0 && (
        <div className="flex shrink-0 items-center gap-2 rounded-md border px-2.5 py-1.5 text-[11px] text-muted-foreground">
          <span className="min-w-0 flex-1">The same text is also used by {twins.slice(0, 4).map((t) => `${hex(t.id)} (${t.place})`).join(", ")}{twins.length > 4 ? ` and ${twins.length - 4} more` : ""}: other screens show those.</span>
          <Button size="sm" variant="secondary" className="h-6 shrink-0 px-2 text-[11px]" disabled={value === message.text} onClick={() => onChange(value, [message.key, ...twins.map((t) => t.key)])}>Apply to all {twins.length + 1}</Button>
        </div>
      )}
      {codes.length > 0 && (
        <p className="m-0 shrink-0 text-[11px] leading-relaxed text-muted-foreground">
          {"{1A:…}"} are game codes (colours, button icons, player names, numbers). Keep them as they are; the game screen shows button icons and sample names and numbers in their place.
        </p>
      )}
      <div className="shrink-0 text-[11px] leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">Original:</span> <span className="whitespace-pre-line">{plainText(stripFontSizePrefix(message.text)) || "(empty)"}</span>
      </div>
    </>
  );
}
