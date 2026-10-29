import * as React from "react";
import { Box, CircleHelp, FolderOpen, Loader2, Package, Search, Star } from "lucide-react";
import { dialogs } from "../dialogs-store";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { categorizeObject } from "../../../js/data/defs.js";
import { listFiles } from "../../../js/formats/u8.js";
import { useEditor } from "../hooks";
import { hex } from "../editor";
import { Hint, SectionTitle } from "../common";
import { cn } from "@/lib/utils";
import { ObjectPreview } from "./ObjectPreview";
import { ObjectDocumentationView } from "./ObjectDocumentationView";

interface Entry { id: number; name: string; label: string; cat: string }

type Source = "track" | "common" | { label: string; archiveName: string } | null;

const sourceText = (source: Source) => source === "track" ? "Model from this track."
  : source === "common" ? "Model from Race/Common.szs."
  : source ? `Model from ${source.label} (${source.archiveName}) in the tracks folder: its files are copied into this track when you save.`
  : "No game model found: a simple shape is shown.";

function ObjectRow({ e, extra, source, selected, onSelect, onDoubleClick }: { e: Entry; extra?: string; source: Source; selected: boolean; onSelect: () => void; onDoubleClick?: () => void }) {
  const ed = useEditor();
  const documentation = ed.getObjectDocumentation(e.id);
  const fromLibrary = !!source && typeof source === "object";
  const favorite = ed.settings.favoriteObjects.includes(e.id);
  return (
    <Hint title={e.label} text={`${e.name} (${hex(e.id)}). ${documentation.description || sourceText(source)} Click to preview it, then use Add to track or drag the selected object into the 3D view.${onDoubleClick ? " Double-click selects all of them." : ""}`} side="right">
      <div
        draggable
        onDragStart={(ev) => { if (!selected) { ev.preventDefault(); return; } ev.dataTransfer.setData("application/x-mkwii-object", String(e.id)); ev.dataTransfer.effectAllowed = "copy"; }}
        onClick={onSelect}
        onDoubleClick={onDoubleClick}
        aria-selected={selected}
        className={cn("group flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 hover:border-border hover:bg-accent/60", selected ? "border-primary/60 bg-primary/10" : "border-transparent")}
      >
        <div className="flex size-7 shrink-0 items-center justify-center text-muted-foreground group-hover:text-foreground">
          {source ? <Box className={cn("size-4", fromLibrary ? "text-sky-400" : "text-success")} /> : <Package className="size-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px]">{e.label}</div>
          <div className="truncate font-mono text-[10px] text-muted-foreground">{hex(e.id)} · {e.name}{fromLibrary && <span className="font-sans text-sky-400/90"> · {(source as any).label}</span>}</div>
        </div>
        {extra && <Badge variant="secondary">{extra}</Badge>}
        <button type="button" aria-label={`${favorite ? "Remove" : "Add"} ${e.label} ${favorite ? "from" : "to"} favorites`} aria-pressed={favorite}
          title={favorite ? "Remove from favorites" : "Add to favorites"}
          onClick={(event) => { event.stopPropagation(); ed.toggleFavoriteObject(e.id); }}
          onDoubleClick={(event) => event.stopPropagation()}
          className={cn("flex size-7 shrink-0 cursor-pointer items-center justify-center rounded hover:bg-accent", favorite ? "text-amber-400" : "text-muted-foreground/60 hover:text-amber-400")}>
          <Star className="size-4" fill={favorite ? "currentColor" : "none"} />
        </button>
      </div>
    </Hint>
  );
}

export function ObjectsPanel() {
  const ed = useEditor("doc", "settings");
  const [filter, setFilter] = React.useState("");
  const [cat, setCat] = React.useState("All");
  const [withModel, setWithModel] = React.useState(false);
  const [previewId, setPreviewId] = React.useState<number | null>(null);
  const entries: Entry[] = React.useMemo(() => [...new Set([
    ...Object.keys(ed.objectNames),
    ...Object.keys(ed.importedObjectDocumentation).filter((key) => /^\d+$/.test(key)),
  ])].map((key) => {
    const id = Number(key);
    const name = ed.objectNames[id] || `object_${id.toString(16)}`;
    return { id, name, label: ed.objectLabel(id), cat: categorizeObject(name) };
  }).sort((a, b) => a.id - b.id), [ed.objectNames, ed.importedObjectDocumentation]);
  const cats = ["All", ...[...new Set(entries.map((e) => e.cat))].sort()];
  const fileSet = (tree: any) => new Set<string>(tree ? listFiles(tree).map((x: any) => x.path.split("/").pop().toLowerCase()) : []);
  const trackFiles = fileSet(ed.doc.szs), commonFiles = fileSet(ed.assets?.common);
  const sourceOf = (id: number): Source => ed.assets?.modelSource(id, trackFiles, commonFiles) ?? null;
  const f = filter.trim().toLowerCase();
  const favorites = new Set(ed.settings.favoriteObjects);
  const list = entries.filter((e) => (cat === "All" || e.cat === cat) && (!withModel || sourceOf(e.id))
    && (!f || e.name.toLowerCase().includes(f) || e.label.toLowerCase().includes(f) || ed.getObjectDocumentation(e.id).description?.toLowerCase().includes(f) || hex(e.id).toLowerCase().includes(f)
      || (typeof sourceOf(e.id) === "object" && (sourceOf(e.id) as any)?.label.toLowerCase().includes(f))))
    .sort((a, b) => Number(favorites.has(b.id)) - Number(favorites.has(a.id)) || a.id - b.id);
  const lib = ed.library;
  const counts = new Map<number, number>();
  for (const o of ed.doc.kmp.GOBJ) counts.set(o.objectId, (counts.get(o.objectId) || 0) + 1);
  const loaded = Object.keys(ed.objectNames).length > 5;
  const documentation = previewId === null ? null : ed.getObjectDocumentation(previewId);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto p-3">
      {previewId !== null && <div className="sticky -top-3 z-10 -mx-3 -mt-3 space-y-2 bg-sidebar px-3 pb-2 pt-3">
        <ObjectPreview objectId={previewId} />
        <Button size="sm" className="w-full" onClick={() => ed.startPlacing("GOBJ", { objectId: previewId })}>Add to track · {ed.objectLabel(previewId)}</Button>
      </div>}
      {previewId !== null && <ObjectDocumentationView id={previewId} label={ed.objectLabel(previewId)} name={ed.objectNames[previewId] || "unknown"} documentation={documentation} />}
      <Button size="sm" variant="secondary" className="self-start" onClick={() => ed.cmd("gameObjects")}><Package /> From another track or my 3D model…</Button>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Game objects: item boxes, enemies, decorations, sounds and effects. Click one to preview it, then choose Add to track or drag the selected object into the 3D view.
        <Box className="mx-1 inline size-3.5 text-success" /> means the real game model is shown.
      </p>
      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 p-2">
        <span className="min-w-0 flex-1 text-[11px] text-muted-foreground">Object documentation: {Object.keys(ed.importedObjectDocumentation).length} imported entries. JSON entries can add descriptions and explain settings 1–8.</span>
        <Button size="sm" variant="secondary" onClick={() => void ed.importObjectDocumentation()}><FolderOpen /> Import JSON…</Button>
        <Button size="sm" variant="ghost" onClick={() => void dialogs.open("help", { tab: "objectDocs" })}><CircleHelp /> JSON format</Button>
        {Object.keys(ed.importedObjectDocumentation).length > 0 && <Button size="sm" variant="ghost" onClick={() => void ed.clearImportedObjectDocumentation()}>Remove imported</Button>}
      </div>
      {!loaded && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="gap-2">
            <CardTitle>Load the official object list</CardTitle>
            <CardDescription>Open Race/Common.szs from your game to get every object name and the shared 3D models (item boxes, shells…). It is remembered.</CardDescription>
            <Button size="sm" className="mt-1 self-start" onClick={() => ed.loadObjFlow()}><FolderOpen /> Load Common.szs…</Button>
          </CardHeader>
        </Card>
      )}
      <div className="flex items-center gap-2 rounded-md border bg-muted/20 px-2.5 py-2">
        <Box className="size-4 shrink-0 text-sky-400" />
        <div className="min-w-0 flex-1 text-[11px] leading-snug text-muted-foreground">
          {!lib ? "Choose the tracks folder to use object models from every track, custom ones too."
            : lib.loading ? <span className="inline-flex items-center gap-1"><Loader2 className="size-3 animate-spin" /> Reading the tracks folder…</span>
            : lib.error ? <span className="text-destructive">{lib.error}</span>
            : <><span className="text-foreground">{lib.models} object models</span> from {lib.tracks} tracks in the tracks folder.</>}
        </div>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => ed.choosePartsFolder()}><FolderOpen /> Folder…</Button>
      </div>
      {favorites.size > 0 && <>
        <SectionTitle>Favorites</SectionTitle>
        <div className="flex flex-col gap-0.5">
          {entries.filter((e) => favorites.has(e.id)).map((e) => <ObjectRow key={e.id} e={e} source={sourceOf(e.id)} selected={previewId === e.id} onSelect={() => setPreviewId(e.id)} />)}
        </div>
      </>}
      <SectionTitle>Used in this track</SectionTitle>
      <div className="flex flex-col gap-0.5">
        {[...counts].sort((a, b) => Number(favorites.has(b[0])) - Number(favorites.has(a[0])) || b[1] - a[1]).map(([id, n]) => {
          const name = ed.objectNames[id] || `object_${id.toString(16)}`;
          return <ObjectRow key={id} e={{ id, name, label: ed.objectLabel(id), cat: "" }} extra={`×${n}`} source={sourceOf(id)} selected={previewId === id} onSelect={() => setPreviewId(id)} onDoubleClick={() => ed.selectObjectsById(id)} />;
        })}
        {!counts.size && <p className="px-1 text-xs text-muted-foreground">No objects yet.</p>}
      </div>
      <SectionTitle>All objects</SectionTitle>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search name or hex ID" className="pl-7" onKeyDown={(e) => e.stopPropagation()} />
      </div>
      <div className="flex flex-wrap gap-1">
        {cats.map((c) => (
          <button key={c} onClick={() => setCat(c)} className={cn("cursor-pointer rounded-full border px-2.5 py-0.5 text-[11px] transition-colors", c === cat ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent")}>{c}</button>
        ))}
        <button onClick={() => setWithModel(!withModel)} className={cn("cursor-pointer rounded-full border px-2.5 py-0.5 text-[11px] transition-colors", withModel ? "border-sky-500 bg-sky-500/20 text-sky-200" : "hover:bg-accent")}>Has a model</button>
      </div>
      <div className="flex flex-col gap-0.5">
        {list.slice(0, 400).map((e) => <ObjectRow key={e.id} e={e} source={sourceOf(e.id)} selected={previewId === e.id} onSelect={() => setPreviewId(e.id)} />)}
        {!list.length && <p className="px-1 py-4 text-center text-xs text-muted-foreground">No objects match.</p>}
      </div>
      {loaded && <Button variant="ghost" size="sm" className="self-start" onClick={() => ed.loadObjFlow()}><FolderOpen /> Reload object list…</Button>}
    </div>
  );
}
