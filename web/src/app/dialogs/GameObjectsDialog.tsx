// Objects for the open track, as for model parts: take an object as another track (or Common.szs)
// places it, with its model files and settings, or make an object that shows your own 3D model.

import * as React from "react";
import { toast } from "sonner";
import { Box, FileUp, FolderOpen, Loader2, MapPin, Search } from "lucide-react";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { api, FILTERS } from "../../../js/api.js";
import { findFile, isU8, parseU8 } from "../../../js/formats/u8.js";
import { parseKMP } from "../../../js/formats/kmp.js";
import { parseBRRES } from "../../../js/formats/brres.js";
import { BrresModelBuilder, mainModel } from "../../../js/editor/brresmodel.js";
import { objectFiles, placedObjects } from "../../../js/editor/object-sources.js";
import { trackLabel } from "../../../js/data/defs.js";
import { editor, hex } from "../editor";
import { useEditor } from "../hooks";
import { dialogs } from "../dialogs-store";
import { ObjectPreview } from "../panels/ObjectPreview";
import { cn } from "@/lib/utils";

interface SourceEntry { id: string; label: string; detail: string; path?: string }
interface Sample { settings: number[]; scale: number[]; presence: number }
interface SourceObject { objectId: number; count: number; sample: Sample | null }
interface LoadedSource { id: string; label: string; tree: any; objects: SourceObject[]; own: boolean; error?: string }

const MULTI = /_d\.(szs|wlz|wbz|wu8)$/i;
const names = (id: number): string[] => editor.assets?.resourceNames(id) || [];
const hasModel = (tree: any, id: number) => objectFiles(tree, names(id)).some((f) => /\.brres$/i.test(f.path));

// The object's model as stored in `tree` (another track's version can differ from this track's).
function buildModel(tree: any, id: number) {
  for (const name of names(id)) {
    const node = findFile(tree, `${name}.brres`);
    if (!node) continue;
    try {
      const b = parseBRRES(node.data), model = mainModel(b, name);
      if (!model) continue;
      const chr = b.chr.get(model.name) || b.chr.get(name) || [...b.chr.values()][0] || null;
      return { template: new BrresModelBuilder(b).build(model, { skinned: !!chr, lit: null }), chr };
    } catch (e) { console.warn(`Preview of ${name} failed`, e); }
  }
  return null;
}

export function GameObjectsDialog({ close }: { close: (v: any) => void }) {
  const [mode, setMode] = React.useState<"take" | "create">("take");
  return (
    <>
      <DialogHeader>
        <DialogTitle>Objects from the game</DialogTitle>
        <DialogDescription>Take an object as a track of the game places it (its model files are copied into this track), or make an object that shows your own 3D model.</DialogDescription>
      </DialogHeader>
      <div className="flex w-fit rounded-md border p-0.5 text-xs">
        {([["take", "Take from a track"], ["create", "Create from a 3D model"]] as const).map(([value, text]) => (
          <button key={value} type="button" onClick={() => setMode(value)}
            className={cn("cursor-pointer rounded px-3 py-1", mode === value ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}>{text}</button>
        ))}
      </div>
      {mode === "take" ? <TakeObject close={close} /> : <CreateObject close={close} />}
    </>
  );
}

function TakeObject({ close }: { close: (v: any) => void }) {
  const ed = useEditor("doc", "settings");
  const [folder, setFolder] = React.useState(editor.partsFolder());
  const [folderFiles, setFolderFiles] = React.useState<string[] | null>(null);
  const [showMulti, setShowMulti] = React.useState(false);
  const [extra, setExtra] = React.useState<SourceEntry[]>([]);
  const [sourceFilter, setSourceFilter] = React.useState("");
  const [filter, setFilter] = React.useState("");
  const [source, setSource] = React.useState<LoadedSource | null>(null);
  const [sourceId, setSourceId] = React.useState("track");
  const [loading, setLoading] = React.useState(false);
  const [picked, setPicked] = React.useState<number | null>(null);
  const [copySettings, setCopySettings] = React.useState(true);
  const cache = React.useRef(new Map<string, LoadedSource>());
  const requested = React.useRef("");

  React.useEffect(() => {
    let cancelled = false;
    setFolderFiles(null);
    if (!folder) { setFolderFiles([]); return; }
    api.listDir(folder, ["szs", "wlz", "wbz", "wu8"]).then((files: string[]) => { if (!cancelled) setFolderFiles(files); })
      .catch(() => { if (!cancelled) setFolderFiles([]); });
    return () => { cancelled = true; };
  }, [folder]);

  const current = editor.doc.filePath?.toLowerCase();
  const sources: SourceEntry[] = [
    { id: "track", label: "This track", detail: editor.doc.fileName || "Open track" },
    ...(editor.assets?.common ? [{ id: "common", label: "Race/Common.szs", detail: "Shared objects (item boxes, shells, enemies…)" }] : []),
    ...extra,
    ...(folderFiles || []).filter((f) => (showMulti || !MULTI.test(f)) && `${folder}\\${f}`.toLowerCase() !== current)
      .map((f) => ({ id: `file:${f}`, label: trackLabel(f), detail: f, path: `${folder}\\${f}` })),
  ];
  const sf = sourceFilter.trim().toLowerCase();
  const shownSources = sources.filter((s) => !sf || `${s.label} ${s.detail}`.toLowerCase().includes(sf));

  const open = async (entry: SourceEntry) => {
    requested.current = entry.id;
    setSourceId(entry.id);
    setPicked(null);
    const cached = cache.current.get(entry.id);
    if (cached) { setSource(cached); return; }
    setSource(null);
    setLoading(true);
    let loaded: LoadedSource;
    try {
      if (entry.id === "track") {
        loaded = { id: entry.id, label: entry.label, tree: editor.doc.szs, objects: placedObjects(editor.doc.kmp.GOBJ), own: true };
      } else if (entry.id === "common") {
        const common = editor.assets.common;
        const ids = Object.keys(editor.objectNames).map(Number).filter((id) => hasModel(common, id));
        loaded = { id: entry.id, label: entry.label, tree: common, objects: ids.map((objectId) => ({ objectId, count: 0, sample: null })), own: false };
      } else {
        const file = await api.readPath(entry.path);
        const bytes = await api.decodeArchiveBytes(file.data, file.path, editor.commonPath || editor.partsFolder());
        if (!isU8(bytes)) throw new Error("This is not a track archive");
        const tree = parseU8(bytes), kmp = findFile(tree, "course.kmp");
        if (!kmp) throw new Error("This archive has no course.kmp");
        loaded = { id: entry.id, label: entry.label, tree, objects: placedObjects(parseKMP(kmp.data).GOBJ), own: false };
      }
    } catch (e: any) {
      loaded = { id: entry.id, label: entry.label, tree: null, objects: [], own: false, error: e.message };
    }
    if (!loaded.error) cache.current.set(entry.id, loaded);
    if (requested.current !== entry.id) return;
    setSource(loaded);
    setLoading(false);
  };
  React.useEffect(() => { void open(sources[0]); }, []);

  const f = filter.trim().toLowerCase();
  const list = (source?.objects || []).filter((o) => !f || `${ed.objectLabel(o.objectId)} ${ed.objectNames[o.objectId] || ""} ${hex(o.objectId)}`.toLowerCase().includes(f));
  const chosen = source?.objects.find((o) => o.objectId === picked) || null;
  const built = React.useMemo(() => (chosen && source && !source.own ? buildModel(source.tree, chosen.objectId) : undefined), [chosen, source]);
  // Files the object needs that this track does not have yet.
  const incoming = chosen && source && !source.own && source.id !== "common" ? objectFiles(source.tree, names(chosen.objectId)) : [];
  const toCopy = incoming.filter((file) => !findFile(editor.doc.szs, file.path));
  const kept = incoming.filter((file) => findFile(editor.doc.szs, file.path));
  const documentation = chosen ? ed.getObjectDocumentation(chosen.objectId) : null;

  const place = () => {
    if (!chosen) return;
    close(true);
    editor.placeGameObject({ objectId: chosen.objectId, ...(copySettings && chosen.sample ? chosen.sample : {}), files: toCopy });
  };

  return (
    <>
      <div className="grid h-[60vh] min-h-0 grid-cols-[240px_300px_1fr] gap-3">
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
              <Switch id="objects-multi" checked={showMulti} onCheckedChange={setShowMulti} />
              <Label htmlFor="objects-multi" className="text-xs text-muted-foreground">Show multiplayer (_d) files</Label>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {shownSources.map((s) => (
              <div key={s.id} onClick={() => open(s)} title={s.detail}
                className={cn("mx-1 cursor-pointer rounded px-2 py-1 hover:bg-accent/70", sourceId === s.id && "bg-primary/12 ring-1 ring-inset ring-primary/20")}>
                <div className="truncate text-[12.5px]">{s.label}</div>
                <div className="truncate text-[10.5px] text-muted-foreground">{s.detail}</div>
              </div>
            ))}
            {folderFiles === null && <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Reading folder…</div>}
            {folderFiles?.length === 0 && <div className="px-3 py-2 text-xs leading-relaxed text-muted-foreground">Choose the folder with the game's tracks (files\Race\Course) to take objects from every track.</div>}
          </div>
          <div className="border-t p-2">
            <Button size="sm" variant="outline" className="w-full" onClick={async () => {
              const file = await api.openFile([{ name: "Track archive", extensions: ["szs", "wlz", "wbz", "wu8"] }], "Open a track archive");
              if (!file?.path) return;
              const entry = { id: `extra:${file.path}`, label: trackLabel(file.name), detail: file.path, path: file.path };
              setExtra((list) => [entry, ...list.filter((x) => x.id !== entry.id)]);
              void open(entry);
            }}><FolderOpen /> Open other file…</Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-col rounded-lg border">
          <div className="relative border-b p-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find an object" className="h-7 pl-7 text-xs" onKeyDown={(e) => e.stopPropagation()} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {loading && <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Loading…</div>}
            {source?.error && <div className="px-3 py-2 text-xs text-destructive">{source.error}</div>}
            {source && !source.error && !source.objects.length && <div className="px-3 py-2 text-xs text-muted-foreground">No objects.</div>}
            {list.map((o) => (
              <div key={o.objectId} onClick={() => setPicked(o.objectId)}
                className={cn("mx-1 flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-accent/70", picked === o.objectId && "bg-primary/12 ring-1 ring-inset ring-primary/20")}>
                <Box className={cn("size-3.5 shrink-0", source && hasModel(source.tree, o.objectId) ? "text-success" : "text-muted-foreground/50")} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px]">{ed.objectLabel(o.objectId)}</div>
                  <div className="truncate font-mono text-[10px] text-muted-foreground">{hex(o.objectId)} · {ed.objectNames[o.objectId] || "unknown"}</div>
                </div>
                {o.count > 0 && <span className="text-[10.5px] tabular-nums text-muted-foreground">×{o.count}</span>}
              </div>
            ))}
          </div>
        </div>

        <div className="flex min-h-0 flex-col gap-2">
          <ObjectPreview objectId={picked} built={built} className="min-h-0 flex-1" />
          <div className="flex flex-col gap-1.5 rounded-lg border bg-muted/20 px-3 py-2 text-xs">
            {!chosen ? <span className="text-muted-foreground">Choose an object to see it and place it in this track.</span> : <>
              <div className="text-[13px] font-medium">{ed.objectLabel(chosen.objectId)} <span className="font-mono text-[11px] font-normal text-muted-foreground">{hex(chosen.objectId)} · {ed.objectNames[chosen.objectId]}</span></div>
              {documentation?.description && <p className="m-0 leading-relaxed text-muted-foreground">{documentation.description}</p>}
              <p className="m-0 leading-relaxed text-muted-foreground">
                {source?.own ? "Already in this track." : source?.id === "common" ? "Its model is in Race/Common.szs: nothing is copied." :
                  toCopy.length ? `Copied into this track when placed: ${toCopy.map((file) => file.path).join(", ")}.` : "Nothing to copy: this track has its files already."}
                {kept.length > 0 && toCopy.length > 0 && ` Kept from this track: ${kept.map((file) => file.path).join(", ")}.`}
              </p>
              {!source?.own && source?.id !== "common" && !hasModel(source?.tree, chosen.objectId) && <p className="m-0 leading-relaxed text-warning">This track has no model for it: the game may use one from Common.szs, or none.</p>}
              {chosen.sample && (
                <div className="flex items-center gap-2" title="Settings 1–8, scale and presence of most of these objects in the source track">
                  <Switch id="objects-settings" checked={copySettings} onCheckedChange={setCopySettings} />
                  <Label htmlFor="objects-settings" className="text-xs text-muted-foreground">Same settings as in {source?.label} <span className="font-mono">({chosen.sample.settings.join(" ")})</span></Label>
                </div>
              )}
            </>}
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => close(null)}>Cancel</Button>
        <Button onClick={place} disabled={!chosen}><MapPin /> Place on the track</Button>
      </DialogFooter>
    </>
  );
}

function CreateObject({ close }: { close: (v: any) => void }) {
  const ed = useEditor("doc", "settings");
  const [file, setFile] = React.useState<{ path: string; name: string } | null>(null);
  const [animation, setAnimation] = React.useState("-");
  const [filter, setFilter] = React.useState("");
  const [picked, setPicked] = React.useState<number | null>(null);
  const [busy, setBusy] = React.useState(false);
  const used = new Map<number, number>();
  for (const o of ed.doc.kmp.GOBJ) used.set(o.objectId, (used.get(o.objectId) || 0) + 1);
  const f = filter.trim().toLowerCase();
  // Every object type with a model resource; types this track does not use come first.
  const types = Object.keys(ed.objectNames).map(Number).filter((id) => !["", "-"].includes(editor.assets?.objectInfo?.[id]?.resources || ""))
    .filter((id) => !f || `${ed.objectLabel(id)} ${ed.objectNames[id]} ${hex(id)}`.toLowerCase().includes(f))
    .sort((a, b) => Number(used.has(a)) - Number(used.has(b)) || a - b);
  const resource = picked != null ? names(picked)[0] : "";
  const documentation = picked != null ? ed.getObjectDocumentation(picked) : null;
  const ownFile = picked != null && !!findFile(ed.doc.szs, `${resource}.brres`);

  const chooseFile = async () => {
    const chosen = await api.openFile(FILTERS.importModel, "Choose a 3D model for the object");
    if (!chosen) return;
    if (!chosen.path) return void toast.error("Choose a model file in the desktop app so its materials can be loaded");
    let choice = "-";
    if (/\.(fbx|gltf|glb|dae|blend)$/i.test(chosen.path)) {
      try {
        const list = await editor.withBusy("Reading animations…", () => api.modelAnimations(chosen.path));
        if (list.length) {
          const answer = await dialogs.open<string>("animationChoice", { file: chosen.name, animations: list });
          if (answer === null) return;
          choice = answer;
        }
      } catch (e) { console.warn("Could not list the animations", e); }
    }
    setAnimation(choice);
    setFile({ path: chosen.path, name: chosen.name });
  };
  const create = async () => {
    if (!file || picked == null) return;
    if ((used.get(picked) || ownFile) && !(await dialogs.confirm({
      title: `Replace the model of ${ed.objectLabel(picked)}?`,
      description: `${used.get(picked) ? `This track has ${used.get(picked)} of these objects: they will all show your model. ` : ""}${ownFile ? `${resource}.brres of this track is replaced. ` : ""}It can be undone.`,
      confirmLabel: "Replace",
    }))) return;
    setBusy(true);
    const ok = await editor.createObjectFromModel(picked, file.path, animation);
    setBusy(false);
    if (ok) close(true);
  };

  return (
    <>
      <div className="grid h-[60vh] min-h-0 grid-cols-[260px_1fr] gap-3">
        <div className="flex min-h-0 flex-col gap-3 rounded-lg border p-3 text-xs">
          <div className="font-medium">1. Your 3D model</div>
          <Button size="sm" variant="secondary" onClick={chooseFile}><FileUp /> {file ? "Choose another…" : "Choose a 3D model…"}</Button>
          {file && <div className="min-w-0">
            <div className="truncate text-[12.5px]" title={file.path}>{file.name}</div>
            <div className="text-muted-foreground">{animation === "-" ? "No animation" : `Animation: ${animation}`}</div>
          </div>}
          <p className="m-0 leading-relaxed text-muted-foreground">.fbx .glb .gltf .dae .obj .blend .stl .ply. Its origin becomes the point the object stands on; tiny models are scaled up like track model imports. Needs Blender and ABMatt.</p>
          <div className="mt-auto flex flex-col gap-1.5 border-t pt-3">
            <div className="font-medium">How it works</div>
            <p className="m-0 leading-relaxed text-muted-foreground">Mario Kart Wii cannot have new kinds of objects: your model replaces the model of an existing object type in this track only. The object keeps that type's behaviour (collision, movement, sounds), so choose a decoration that does nothing else.</p>
          </div>
        </div>

        <div className="grid min-h-0 grid-cols-[300px_1fr] gap-3">
          <div className="flex min-h-0 flex-col rounded-lg border">
            <div className="border-b p-2 text-xs font-medium">2. Object type it replaces</div>
            <div className="relative border-b p-2">
              <Search className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find an object type" className="h-7 pl-7 text-xs" onKeyDown={(e) => e.stopPropagation()} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto py-1">
              {!types.length && <div className="px-3 py-2 text-xs text-muted-foreground">{Object.keys(ed.objectNames).length > 5 ? "No object types match." : "Load Race/Common.szs (Objects tab) to get the object list."}</div>}
              {types.map((id) => (
                <div key={id} onClick={() => setPicked(id)}
                  className={cn("mx-1 flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-accent/70", picked === id && "bg-primary/12 ring-1 ring-inset ring-primary/20")}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px]">{ed.objectLabel(id)}</div>
                    <div className="truncate font-mono text-[10px] text-muted-foreground">{hex(id)} · {names(id)[0]}.brres</div>
                  </div>
                  {used.has(id) && <span className="text-[10.5px] text-muted-foreground">used ×{used.get(id)}</span>}
                </div>
              ))}
            </div>
          </div>
          <div className="flex min-h-0 flex-col gap-2 rounded-lg border p-3 text-xs">
            <div className="font-medium">3. Create and place</div>
            {picked == null ? <p className="m-0 text-muted-foreground">Choose the object type on the left.</p> : <>
              <div className="text-[13px] font-medium">{ed.objectLabel(picked)} <span className="font-mono text-[11px] font-normal text-muted-foreground">{hex(picked)}</span></div>
              <p className="m-0 leading-relaxed text-muted-foreground">{documentation?.description || "Its behaviour in the game is not documented here."}</p>
              <p className="m-0 leading-relaxed text-muted-foreground">Your model is saved in this track as <span className="font-mono text-foreground">{resource}.brres</span> (model name {resource}){used.get(picked) ? `; the ${used.get(picked)} ${ed.objectLabel(picked)} already in this track show it too` : ""}.</p>
              <ObjectPreview objectId={picked} className="h-40" />
              <p className="m-0 text-[11px] text-muted-foreground">Above: the model this type uses now.</p>
            </>}
            <Button className="mt-auto self-end" disabled={!file || picked == null || busy} onClick={create}>
              {busy ? <Loader2 className="animate-spin" /> : <MapPin />} Create and place
            </Button>
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => close(null)}>Cancel</Button>
      </DialogFooter>
    </>
  );
}
