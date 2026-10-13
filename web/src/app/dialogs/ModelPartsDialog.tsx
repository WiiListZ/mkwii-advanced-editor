// Browser for parts of the game's models (other tracks, Common.szs, any SZS/BRRES) with a 3D preview.
// The chosen polygon, or one connected piece of it, is copied into the open track's course_model.brres.

import * as React from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { toast } from "sonner";
import { Box, ChevronRight, FileBox, FolderOpen, Layers, Loader2, Plus, Search, Star } from "lucide-react";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "../../../js/api.js";
import { isU8, parseU8, listFiles, findFile } from "../../../js/formats/u8.js";
import { parseKCL } from "../../../js/formats/kcl.js";
import { isBRRES, parseBRRES, polygonPieces } from "../../../js/formats/brres.js";
import { BrresModelBuilder } from "../../../js/editor/brresmodel.js";
import { trackLabel } from "../../../js/data/defs.js";
import { editor } from "../editor";
import { useEditor } from "../hooks";
import { cn } from "@/lib/utils";

interface SourceEntry { id: string; label: string; detail: string; path?: string }
interface BrresFile { path: string; data: Uint8Array; parsed?: any; error?: string }
interface LoadedSource { id: string; label: string; stem: string; files: BrresFile[]; kcl?: Uint8Array | null; collision?: any }
interface Pick { file: string; model: string; part: number; piece: number | null }

const stemOf = (name: string) => name.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "");
const archiveKey = (path: string) => `archive:${path.replace(/\//g, "\\").toLowerCase()}`;
const partKey = (archive: string, file: string, model: string, part: number, piece: number | null) =>
  [archive, file.toLowerCase(), model, String(part), piece == null ? "" : String(piece)].map(encodeURIComponent).join("|");
const partArchive = (key: string) => { try { return decodeURIComponent(key.split("|", 1)[0]); } catch { return ""; } };

async function readArchive(name: string, data: Uint8Array, path: string | null = null): Promise<{ files: BrresFile[]; kcl: Uint8Array | null }> {
  let bytes = await api.decodeArchiveBytes(data, path, editor.commonPath || editor.partsFolder());
  if (isBRRES(bytes)) return { files: [{ path: name.split(/[\\/]/).pop()!, data: bytes }], kcl: null };
  if (!isU8(bytes)) throw new Error("This is not an SZS archive or a BRRES file");
  const tree = parseU8(bytes);
  const files = listFiles(tree).filter((f: any) => /\.brres$/i.test(f.path)).map((f: any) => ({ path: f.path, data: f.node.data }))
    .sort((a: BrresFile, b: BrresFile) => (a.path === "course_model.brres" ? -1 : b.path === "course_model.brres" ? 1 : a.path.localeCompare(b.path)));
  return { files, kcl: findFile(tree, "course.kcl")?.data || null };
}

// Collision triangles of the source track lying inside a model part's boxes (one per object of
// the part, so a polygon of scattered lamp posts does not take the road between them).
function collisionInside(source: LoadedSource | null, boxes: { min: number[]; max: number[] }[]) {
  if (!source?.kcl || !boxes.length) return null;
  if (!source.collision) { try { source.collision = parseKCL(source.kcl); } catch { source.collision = false; } }
  const kcl = source.collision;
  if (!kcl) return null;
  const pad = 40, v = kcl.verts;
  const inBox = (b: { min: number[]; max: number[] }, x: number, y: number, z: number) =>
    x >= b.min[0] - pad && x <= b.max[0] + pad && y >= b.min[1] - pad && y <= b.max[1] + pad && z >= b.min[2] - pad && z <= b.max[2] + pad;
  // Collision is often coarser than the model: a triangle also counts when its centre is inside
  // and it is not much bigger than the object itself.
  const fits = (b: { min: number[]; max: number[] }, o: number) => {
    if (inBox(b, v[o], v[o + 1], v[o + 2]) && inBox(b, v[o + 3], v[o + 4], v[o + 5]) && inBox(b, v[o + 6], v[o + 7], v[o + 8])) return true;
    if (!inBox(b, (v[o] + v[o + 3] + v[o + 6]) / 3, (v[o + 1] + v[o + 4] + v[o + 7]) / 3, (v[o + 2] + v[o + 5] + v[o + 8]) / 3)) return false;
    const diagonal = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
    const edge = Math.max(Math.hypot(v[o] - v[o + 3], v[o + 1] - v[o + 4], v[o + 2] - v[o + 5]), Math.hypot(v[o + 3] - v[o + 6], v[o + 4] - v[o + 7], v[o + 5] - v[o + 8]), Math.hypot(v[o + 6] - v[o], v[o + 7] - v[o + 1], v[o + 8] - v[o + 2]));
    return edge <= diagonal * 1.5;
  };
  const tris: number[] = [];
  for (let t = 0; t < kcl.count; t++) if (boxes.some((b) => fits(b, t * 9))) tris.push(t);
  return { tris, verts: kcl.verts, flags: kcl.flags };
}

const parsed = (f: BrresFile) => {
  if (!f.parsed && !f.error) {
    try { f.parsed = parseBRRES(f.data); } catch (e: any) { f.error = e.message; }
  }
  return f.parsed;
};

const partLabel = (model: any, index: number) => {
  const draw = model.draws.find((d: any) => d.object === index);
  return model.materials[draw?.material]?.name || model.objects[index].name;
};

export function ModelPartsDialog({ close }: { close: (v: any) => void }) {
  const ed = useEditor("settings");
  const [folder, setFolder] = React.useState(editor.partsFolder());
  const [folderFiles, setFolderFiles] = React.useState<string[] | null>(null);
  const [folderError, setFolderError] = React.useState("");
  const [showMulti, setShowMulti] = React.useState(false);
  const [extra, setExtra] = React.useState<SourceEntry[]>([]);
  const [sourceId, setSourceId] = React.useState<string | null>(null);
  const [source, setSource] = React.useState<LoadedSource | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [sourceFilter, setSourceFilter] = React.useState("");
  const [filter, setFilter] = React.useState("");
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [pick, setPick] = React.useState<Pick | null>(null);
  const [placement, setPlacement] = React.useState<"view" | "original" | "click">("click");
  const [context, setContext] = React.useState(false);
  const [withCollision, setWithCollision] = React.useState(true);
  const [adding, setAdding] = React.useState(false);
  const cache = React.useRef(new Map<string, LoadedSource>());
  const requested = React.useRef<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setFolderFiles(null); setFolderError("");
    if (!folder) { setFolderFiles([]); return; }
    api.listDir(folder, ["szs", "wlz", "wbz", "wu8"]).then((files: string[]) => { if (!cancelled) setFolderFiles(files); })
      .catch((e: any) => { if (!cancelled) { setFolderFiles([]); setFolderError(e.message); } });
    return () => { cancelled = true; };
  }, [folder]);

  const sourceKey = (entry: SourceEntry) => entry.id === "track" && !editor.doc.filePath ? "current-track"
    : entry.id === "common" && !editor.commonPath ? "common-source"
    : archiveKey(entry.id === "track" ? editor.doc.filePath! : entry.id === "common" ? editor.commonPath! : entry.path || entry.id);
  const availableSources: SourceEntry[] = [
    { id: "track", label: "This track", detail: editor.doc.fileName || "Open track" },
    ...(editor.assets?.common ? [{ id: "common", label: "Race/Common.szs", detail: "Shared objects (item boxes, shells, enemies…)" }] : []),
    ...extra,
    ...(folderFiles || []).filter((f) => showMulti || !/_d\.(szs|wlz|wbz|wu8)$/i.test(f)).map((f) => ({ id: `file:${f}`, label: trackLabel(f), detail: f, path: `${folder}\\${f}` })),
  ];
  const pinnedArchives = new Set([...ed.settings.favoriteModelSources, ...ed.settings.favoriteModelParts.map(partArchive)]);
  const currentSaved = sourceId?.startsWith("saved:") ? archiveKey(sourceId.slice("saved:".length)) : null;
  const savedSources: SourceEntry[] = [...new Set([...pinnedArchives, ...(currentSaved ? [currentSaved] : [])])].filter((key) => key.startsWith("archive:") && !availableSources.some((s) => sourceKey(s) === key))
    .map((key) => { const path = key.slice("archive:".length); const name = path.split("\\").pop()!; return { id: `saved:${path}`, label: trackLabel(name), detail: path, path }; });
  const sources = [...availableSources, ...savedSources];
  const sf = sourceFilter.trim().toLowerCase();
  const shownSources = sources.filter((s) => !sf || `${s.label} ${s.detail}`.toLowerCase().includes(sf))
    .sort((a, b) => Number(pinnedArchives.has(sourceKey(b))) - Number(pinnedArchives.has(sourceKey(a))));
  const initialExpanded = (entry: SourceEntry, files: BrresFile[]) => {
    const open = new Set(files.slice(0, 1).map((file) => file.path));
    for (const key of ed.settings.favoriteModelParts) {
      try {
        const [archive, file, model, part] = key.split("|").map(decodeURIComponent);
        if (archive !== sourceKey(entry) || !file) continue;
        const originalFile = files.find((candidate) => candidate.path.toLowerCase() === file)?.path;
        if (!originalFile) continue;
        open.add(originalFile);
        if (model) open.add(`${originalFile}|${model}`);
        if (part) open.add(`${originalFile}|${model}|${part}`);
      } catch { /* Ignore a malformed saved favorite. */ }
    }
    return open;
  };

  const open = async (entry: SourceEntry) => {
    requested.current = entry.id;
    setSourceId(entry.id);
    setPick(null);
    const cached = cache.current.get(entry.id);
    if (cached) { setSource(cached); setExpanded(initialExpanded(entry, cached.files)); return; }
    setSource(null);
    setLoading(true);
    try {
      let files: BrresFile[], stem: string, kcl: Uint8Array | null = null;
      if (entry.id === "track") {
        files = listFiles(editor.doc.szs).filter((f: any) => /\.brres$/i.test(f.path)).map((f: any) => ({ path: f.path, data: f.node.data }));
        stem = stemOf(editor.doc.fileName || "track");
        kcl = findFile(editor.doc.szs, "course.kcl")?.data || null;
      } else if (entry.id === "common") {
        files = listFiles(editor.assets.common).filter((f: any) => /\.brres$/i.test(f.path)).map((f: any) => ({ path: f.path, data: f.node.data }))
          .sort((a: BrresFile, b: BrresFile) => a.path.localeCompare(b.path));
        stem = "Common";
      } else {
        const file = await api.readPath(entry.path);
        ({ files, kcl } = await readArchive(file.name, file.data, file.path));
        stem = stemOf(file.name);
      }
      const loaded: LoadedSource = { id: entry.id, label: entry.label, stem, files, kcl };
      cache.current.set(entry.id, loaded);
      if (requested.current !== entry.id) return;
      setSource(loaded);
      setExpanded(initialExpanded(entry, files));
    } catch (e: any) {
      if (requested.current === entry.id) setSource({ id: entry.id, label: entry.label, stem: "", files: [{ path: entry.detail, data: new Uint8Array(), error: e.message }] });
    } finally { if (requested.current === entry.id) setLoading(false); }
  };

  React.useEffect(() => { open(sources[0]); }, []);

  const toggle = (key: string) => setExpanded((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const activeArchive = sourceKey(sources.find((entry) => entry.id === sourceId) || sources[0]);
  const favoriteParts = new Set(ed.settings.favoriteModelParts);
  const favoritePrefix = (...parts: string[]) => parts.map(encodeURIComponent).join("|") + "|";
  const hasFavoriteUnder = (...parts: string[]) => [...favoriteParts].some((key) => key.startsWith(favoritePrefix(activeArchive, ...parts)));
  const partHasFavorite = (file: string, model: string, part: number) => hasFavoriteUnder(file.toLowerCase(), model, String(part));
  const isPartFavorite = (file: string, model: string, part: number, piece: number | null = null) =>
    favoriteParts.has(partKey(activeArchive, file, model, part, piece));
  const togglePartFavorite = (file: string, model: string, part: number, piece: number | null = null) =>
    ed.toggleFavoriteModelPart(partKey(activeArchive, file, model, part, piece));

  const file = source?.files.find((f) => f.path === pick?.file);
  const brres = file && parsed(file);
  const model = brres?.models.find((m: any) => m.name === pick?.model);
  const part = model?.objects[pick?.part ?? -1];
  const pieces = React.useMemo(() => (part ? polygonPieces(part).pieces : []), [part]);
  const piece = pick?.piece != null ? pieces[pick.piece] : null;
  const triangles = piece ? piece.triangles.length : part?.triangles ?? 0;
  const material = model && pick ? model.materials[model.draws.find((d: any) => d.object === pick.part)?.material] : null;
  const label = model && pick ? `${partLabel(model, pick.part)}${piece ? ` · object ${piece.index + 1}` : ""}` : "";
  // Box of the chosen part (or object) in the source track, and the collision inside it.
  const bounds = React.useMemo(() => {
    if (!part) return null;
    if (piece) return { min: piece.min, max: piece.max };
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < part.positions.length; i++) { const a = i % 3; min[a] = Math.min(min[a], part.positions[i]); max[a] = Math.max(max[a], part.positions[i]); }
    return { min, max };
  }, [part, piece]);
  const collision = React.useMemo(() => {
    if (!bounds || file?.path !== "course_model.brres") return null;
    return collisionInside(source, piece || pieces.length <= 1 ? [bounds] : pieces.map((q: any) => ({ min: q.min, max: q.max })));
  }, [bounds, source, file, piece, pieces]);

  const add = async () => {
    if (!file || !model || !part || !pick) return;
    const tag = file.path === "course_model.brres" ? source!.stem : stemOf(file.path);
    const request = {
      model: model.name, part: part.name, placement, tag, label,
      piece: piece && pieces.length > 1 ? piece.min.map((v: number, i: number) => (v + piece.max[i]) / 2) : null,
      collision: withCollision && collision?.tris.length ? { ...collision, box: bounds! } : null,
    };
    // Clicking a point needs the 3D view: the dialog closes first.
    if (placement === "click") { close(true); editor.addGamePart(file.data, request); return; }
    setAdding(true);
    const ok = await editor.addGamePart(file.data, request);
    setAdding(false);
    if (ok) close(true);
  };

  const f = filter.trim().toLowerCase();
  const match = (t: string) => !f || t.toLowerCase().includes(f);
  const Row = ({ depth, text, badge, open: isOpen, selected, onClick, icon, favorite, onFavorite }: { depth: number; text: string; badge?: string; open?: boolean | null; selected?: boolean; onClick: () => void; icon?: React.ReactNode; favorite?: boolean; onFavorite?: () => void }) => (
    <div onClick={onClick} data-selected={!!selected}
      className={cn("mx-1 flex h-6 cursor-pointer items-center gap-1.5 rounded px-1.5 text-[12.5px] hover:bg-accent/70",
        selected && "bg-primary/12 ring-1 ring-inset ring-primary/20 hover:bg-primary/15")}
      style={{ paddingLeft: 6 + depth * 14 }}>
      {isOpen != null ? <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")} /> : <span className="w-3.5 shrink-0" />}
      {icon}
      <span className="min-w-0 flex-1 truncate">{text}</span>
      {badge && <span className="font-mono text-[10px] text-muted-foreground">{badge}</span>}
      {onFavorite && <button type="button" aria-label={`${favorite ? "Remove" : "Add"} ${text} ${favorite ? "from" : "to"} favorites`} aria-pressed={!!favorite}
        title={favorite ? "Remove from favorites" : "Add to favorites"}
        onClick={(event) => { event.stopPropagation(); onFavorite(); }}
        className={cn("flex size-5 shrink-0 cursor-pointer items-center justify-center rounded hover:bg-accent", favorite ? "text-amber-400" : "text-muted-foreground/50 hover:text-amber-400")}>
        <Star className="size-3.5" fill={favorite ? "currentColor" : "none"} />
      </button>}
    </div>
  );

  const tree = source?.files.slice().sort((a, b) => Number(hasFavoriteUnder(b.path.toLowerCase())) - Number(hasFavoriteUnder(a.path.toLowerCase()))).map((bf) => {
    const fileOpen = expanded.has(bf.path) || !!f;
    const b = fileOpen ? parsed(bf) : null;
    if (f && !b) return null;
    const models = (b?.models || []).filter((m: any) => m.objects.some((o: any) => o.triangles))
      .sort((a: any, b: any) => Number(hasFavoriteUnder(bf.path.toLowerCase(), b.name)) - Number(hasFavoriteUnder(bf.path.toLowerCase(), a.name)));
    const rows: React.ReactNode[] = [];
    for (const m of models) {
      const modelKey = `${bf.path}|${m.name}`;
      const modelOpen = models.length === 1 || expanded.has(modelKey) || !!f;
      const depth = models.length === 1 ? 1 : 2;
      const partRows: React.ReactNode[] = [];
      if (modelOpen) m.objects.map((o: any, index: number) => ({ o, index })).sort((a: any, b: any) =>
        Number(partHasFavorite(bf.path, m.name, b.index)) - Number(partHasFavorite(bf.path, m.name, a.index))).forEach(({ o, index }: any) => {
        if (!o.triangles) return;
        const text = `${partLabel(m, index)} · ${o.name}`;
        if (!match(`${text} ${bf.path} ${m.name}`)) return;
        const partKey = `${modelKey}|${index}`;
        const count = polygonPieces(o).pieces.length;
        const partOpen = count > 1 && expanded.has(partKey);
        partRows.push(<Row key={partKey} depth={depth} text={text} badge={`${o.triangles} △${count > 1 ? ` · ${count}` : ""}`}
          open={count > 1 ? partOpen : null} icon={<Box className="size-3.5 shrink-0 text-amber-400" />}
          favorite={isPartFavorite(bf.path, m.name, index)} onFavorite={() => togglePartFavorite(bf.path, m.name, index)}
          selected={pick?.file === bf.path && pick.model === m.name && pick.part === index && pick.piece == null}
          onClick={() => { setPick({ file: bf.path, model: m.name, part: index, piece: null }); if (count > 1) toggle(partKey); }} />);
        if (partOpen) for (const p of polygonPieces(o).pieces.sort((a: any, b: any) => Number(isPartFavorite(bf.path, m.name, index, b.index)) - Number(isPartFavorite(bf.path, m.name, index, a.index)))) {
          partRows.push(<Row key={`${partKey}|${p.index}`} depth={depth + 1} text={`Object ${p.index + 1}`} badge={`${p.triangles.length} △`} open={null}
            favorite={isPartFavorite(bf.path, m.name, index, p.index)} onFavorite={() => togglePartFavorite(bf.path, m.name, index, p.index)}
            selected={pick?.file === bf.path && pick.model === m.name && pick.part === index && pick.piece === p.index}
            onClick={() => setPick({ file: bf.path, model: m.name, part: index, piece: p.index })} />);
        }
      });
      if (f && !partRows.length) continue;
      if (models.length > 1) rows.push(<Row key={modelKey} depth={1} text={m.name} badge={`${m.objects.length}`} open={modelOpen} icon={<Layers className="size-3.5 shrink-0 text-sky-400" />} onClick={() => toggle(modelKey)} />);
      rows.push(...partRows);
    }
    if (f && !rows.length) return null;
    return (
      <React.Fragment key={bf.path}>
        <Row depth={0} text={bf.path} badge={bf.error ? "error" : `${(bf.data.length / 1024).toFixed(0)} KB`} open={fileOpen} icon={<FileBox className="size-3.5 shrink-0 text-muted-foreground" />} onClick={() => toggle(bf.path)} />
        {fileOpen && bf.error && <div className="px-8 py-1 text-xs text-destructive">{bf.error}</div>}
        {fileOpen && b && !models.length && <div className="px-8 py-1 text-xs text-muted-foreground">No model geometry</div>}
        {rows}
      </React.Fragment>
    );
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add a part from the game's models</DialogTitle>
        <DialogDescription>Choose a track or archive, pick a model part and check it in the preview. It is copied into this track's course_model.brres with its materials and textures.</DialogDescription>
      </DialogHeader>
      <div className="grid h-[64vh] min-h-0 grid-cols-[250px_330px_1fr] gap-3">
        <div className="flex min-h-0 flex-col rounded-lg border">
          <div className="flex flex-col gap-1.5 border-b p-2">
            <div className="flex items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate text-left text-xs text-muted-foreground [direction:rtl]" title={folder}>{folder || "No tracks folder chosen"}</span>
              <Button size="sm" variant="secondary" className="h-6 px-2 text-[11px]" onClick={async () => { const p = await editor.choosePartsFolder(); if (p) setFolder(p); }}><FolderOpen /> Folder…</Button>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} placeholder="Find a track" className="h-7 pl-7 text-xs" onKeyDown={(e) => e.stopPropagation()} />
            </div>
            <div className="flex items-center gap-2">
              <Switch id="parts-multi" checked={showMulti} onCheckedChange={setShowMulti} />
              <Label htmlFor="parts-multi" className="text-xs text-muted-foreground">Show multiplayer (_d) files</Label>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {shownSources.map((s) => (
              <div key={s.id} onClick={() => open(s)} title={s.detail}
                className={cn("mx-1 cursor-pointer rounded px-2 py-1 hover:bg-accent/70", sourceId === s.id && "bg-primary/12 ring-1 ring-inset ring-primary/20")}>
                <div className="flex items-center gap-1">
                  <span className="min-w-0 flex-1 truncate text-[12.5px]">{s.label}</span>
                  {!ed.settings.favoriteModelSources.includes(sourceKey(s)) && ed.settings.favoriteModelParts.some((key) => partArchive(key) === sourceKey(s)) &&
                    <Star className="size-3 shrink-0 text-amber-400" fill="currentColor" aria-label="Contains favorite parts" />}
                  <button type="button" aria-label={`${ed.settings.favoriteModelSources.includes(sourceKey(s)) ? "Remove" : "Add"} ${s.label} ${ed.settings.favoriteModelSources.includes(sourceKey(s)) ? "from" : "to"} favorites`}
                    aria-pressed={ed.settings.favoriteModelSources.includes(sourceKey(s))}
                    title={ed.settings.favoriteModelSources.includes(sourceKey(s)) ? "Remove from favorites" : "Add to favorites"}
                    onClick={(event) => { event.stopPropagation(); ed.toggleFavoriteModelSource(sourceKey(s)); }}
                    className={cn("flex size-5 shrink-0 cursor-pointer items-center justify-center rounded hover:bg-accent", ed.settings.favoriteModelSources.includes(sourceKey(s)) ? "text-amber-400" : "text-muted-foreground/50 hover:text-amber-400")}>
                    <Star className="size-3.5" fill={ed.settings.favoriteModelSources.includes(sourceKey(s)) ? "currentColor" : "none"} />
                  </button>
                </div>
                <div className="truncate text-[10.5px] text-muted-foreground">{s.detail}</div>
              </div>
            ))}
            {folderFiles === null && <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Reading folder…</div>}
            {folderError && <div className="px-3 py-2 text-xs text-destructive">{folderError}</div>}
            {folderFiles?.length === 0 && !folderError && <div className="px-3 py-2 text-xs leading-relaxed text-muted-foreground">Choose the folder with the game's tracks (files\Race\Course) to take parts from every track.</div>}
          </div>
          <div className="border-t p-2">
            <Button size="sm" variant="outline" className="w-full" onClick={async () => {
              const picked = await api.openFile([{ name: "Track archive or BRRES model", extensions: ["szs", "wlz", "wbz", "wu8", "brres"] }], "Open an archive or BRRES with models");
              if (!picked) return;
              const entry = { id: `extra:${picked.path || picked.name}`, label: trackLabel(picked.name), detail: picked.path || picked.name, path: picked.path || picked.name };
              try { cache.current.set(entry.id, { id: entry.id, label: entry.label, stem: stemOf(picked.name), ...await readArchive(picked.name, picked.data, picked.path) }); }
              catch (e: any) { return void toast.error("Could not open this file", { description: e.message }); }
              setExtra((list) => [entry, ...list.filter((x) => x.id !== entry.id)]);
              open(entry);
            }}><FolderOpen /> Open other file…</Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-col rounded-lg border">
          <div className="relative border-b p-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a part (material, polygon)" className="h-7 pl-7 text-xs" onKeyDown={(e) => e.stopPropagation()} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {loading && <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Loading…</div>}
            {tree}
          </div>
        </div>

        <div className="flex min-h-0 flex-col gap-2">
          <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border bg-[#11151c]">
            <PartPreview brres={brres} model={model} part={pick?.part ?? -1} piece={pick?.piece ?? null} context={context} />
            {!part && <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-muted-foreground">Select a part to preview it</div>}
            {part && <div className="pointer-events-none absolute bottom-2 left-3 text-[11px] text-white/60">Drag to rotate · right drag to pan · wheel to zoom</div>}
          </div>
          <div className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 rounded-lg border bg-muted/20 px-3 py-2 text-xs">
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium">{part ? label : "No part selected"}</div>
              <div className="truncate text-muted-foreground">
                {part ? `${source?.label} › ${pick?.file} › ${model.name} › ${part.name} · ${triangles} triangles${material?.layers?.length ? ` · ${material.layers.map((l: any) => l.texture).join(", ")}` : ""}` : "Polygons with several separate objects can be expanded to take only one of them."}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <div className="flex items-center gap-2">
                <Switch id="parts-context" checked={context} onCheckedChange={setContext} disabled={!part} />
                <Label htmlFor="parts-context" className="text-xs text-muted-foreground">Show rest of model</Label>
              </div>
              <div className="flex items-center gap-2" title={collision ? "Collision triangles of the source track inside this part's box are copied with it, moved to the same place." : "Only track models (course_model.brres of a track) have collision to copy."}>
                <Switch id="parts-collision" checked={withCollision && !!collision?.tris.length} onCheckedChange={setWithCollision} disabled={!collision?.tris.length} />
                <Label htmlFor="parts-collision" className="text-xs text-muted-foreground">Include collision{collision ? ` (${collision.tris.length} triangles)` : ""}</Label>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Place</span>
              <Select value={placement} onValueChange={(v: any) => setPlacement(v)}>
                <SelectTrigger className="h-7 w-[230px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="click">Click on the track</SelectItem>
                  <SelectItem value="view">At the centre of the 3D view</SelectItem>
                  <SelectItem value="original">At its original coordinates</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {part && <Badge variant="outline" className="justify-self-end">{piece ? "One object" : pieces.length > 1 ? `${pieces.length} objects` : "Whole part"}</Badge>}
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => close(null)}>Cancel</Button>
        <Button onClick={add} disabled={!part || adding}>{adding ? <Loader2 className="animate-spin" /> : <Plus />} Add to track</Button>
      </DialogFooter>
    </>
  );
}

// ---- 3D preview ---------------------------------------------------------------------------------
const ghost = new THREE.MeshBasicMaterial({ color: 0x8090a8, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide });

function PartPreview({ brres, model, part, piece, context }: { brres: any; model: any; part: number; piece: number | null; context: boolean }) {
  const host = React.useRef<HTMLDivElement>(null);
  const view = React.useRef<any>(null);

  React.useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x11151c);
    el.append(renderer.domElement);
    renderer.domElement.style.display = "block";
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(1, 2, 1.5);
    scene.add(sun);
    const camera = new THREE.PerspectiveCamera(45, 1, 1, 1e6);
    camera.position.set(500, 400, 500);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    const grid = new THREE.GridHelper(1, 20, 0x3a4252, 0x252b36);
    scene.add(grid);
    const resize = () => {
      const w = el.clientWidth || 1, h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    let frame = 0;
    const loop = () => { frame = requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); };
    loop();
    view.current = { renderer, scene, camera, controls, grid, groups: new Map<any, THREE.Group>(), current: null };
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      for (const group of view.current.groups.values()) disposeGroup(group);
      renderer.dispose();
      renderer.domElement.remove();
      view.current = null;
    };
  }, []);

  React.useEffect(() => {
    const v = view.current;
    if (!v) return;
    if (v.current) v.scene.remove(v.current);
    v.current = null;
    if (!brres || !model || part < 0) return;
    let group = v.groups.get(model);
    if (!group) {
      try { group = new BrresModelBuilder(brres).build(model, { skinned: false, lit: null }); }
      catch (e) { console.warn("Preview failed", e); return; }
      group.traverse((o: any) => { if (o.isMesh) o.userData.previewMaterial = o.material; });
      v.groups.set(model, group);
    }
    const obj = model.objects[part];
    const chosen = piece != null ? polygonPieces(obj).pieces[piece] : null;
    const box = new THREE.Box3(), p = new THREE.Vector3();
    group.traverse((o: any) => {
      if (!o.isMesh) return;
      const mine = o.userData.partIndex === part;
      o.visible = mine || context;
      o.material = mine ? o.userData.previewMaterial : ghost;
      o.renderOrder = mine ? 0 : 5;
      if (!mine) return;
      const base = o.userData.previewGeometry || o.geometry;
      o.userData.previewGeometry = base;
      if (o.geometry !== base) o.geometry.dispose();
      o.geometry = base;
      if (chosen) {
        const geometry = base.clone();
        geometry.setIndex(chosen.triangles.flatMap((t: number) => [t * 3, t * 3 + 1, t * 3 + 2]));
        o.geometry = geometry;
      }
      const pos = o.geometry.attributes.position, index = o.geometry.index;
      const count = index ? index.count : pos.count;
      for (let i = 0; i < count; i++) box.expandByPoint(p.fromBufferAttribute(pos, index ? index.getX(i) : i));
    });
    v.scene.add(group);
    v.current = group;
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 10);
    v.controls.target.copy(center);
    v.camera.position.copy(center).add(new THREE.Vector3(0.9, 0.6, 1).normalize().multiplyScalar(radius * 2.6));
    v.camera.near = radius / 200;
    v.camera.far = radius * 400;
    v.camera.updateProjectionMatrix();
    v.grid.position.set(center.x, box.min.y, center.z);
    v.grid.scale.setScalar(Math.max(size.x, size.z, 1) * 2);
  }, [brres, model, part, piece, context]);

  return <div ref={host} className="absolute inset-0" />;
}

function disposeGroup(group: THREE.Group) {
  const textures = new Set<THREE.Texture>();
  group.traverse((o: any) => {
    if (!o.isMesh) return;
    o.geometry?.dispose();
    o.userData.previewGeometry?.dispose();
    const m = o.userData.previewMaterial;
    if (m?.map) textures.add(m.map);
    m?.dispose();
  });
  textures.forEach((t) => t.dispose());
}
