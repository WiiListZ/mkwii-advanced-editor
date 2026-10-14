import * as React from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Bone, Box, ChevronDown, ChevronRight, Download, FileUp, LoaderCircle, Paintbrush, Play, Save, Search, Square, Trash2, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { api, FILTERS, hasBackend } from "../../../js/api.js";
import { parseU8, buildU8, listFiles, findFile, newSzsTree, setFilePath } from "../../../js/formats/u8.js";
import { clearBRRESPolygon, parseBRRES, replaceBRRESTexture, setCHR0Loop, translateBRRESPart } from "../../../js/formats/brres.js";
import { BrresModelBuilder, bindCHR, applyCHRFrame } from "../../../js/editor/brresmodel.js";
import { setBRRESBoneRestTransform } from "../../../js/editor/brres-bones.js";
import { exportBRRESModelGLB } from "../../../js/editor/brres-export.js";
import { kartArchiveLabel } from "../../../js/editor/kart-archives.js";
import { changedTextures, copyCandidates, updateCopy } from "../../../js/editor/resource-copies.js";
import { editor, winPath, type LooseFile } from "../editor";
import { dialogs } from "../dialogs-store";
import { useEditor } from "../hooks";
import { WorkspaceCard } from "../panels/WorkspaceCard";
import { TexturePainter } from "../panels/TexturePainter";
import { cn } from "@/lib/utils";
import { ColumnHandle, useColumnWidths } from "../resizable";

type Category = "characters" | "objects" | "courses";
type View = "models" | "textures" | "animations";
const OPEN_TRACK = "$open-track";
// A .brres opened on its own (File › Open, Explorer): edited as a one-file archive, saved as the .brres.
const LOOSE = "$loose";
const cloneTree = (node: any): any => ({ ...node, children: node.children?.map(cloneTree) });
const filename = (path: string) => path.split(/[\\/]/).pop() || path;
// What a model of a resource is for: objects often add a low-detail copy (drawn from far away or in
// split screen) and a shadow next to the model seen up close.
const modelRole = (name: string) => /(^|[-_])(low|lod\d*)$/i.test(name) ? "low detail, seen from far away" : /shadow/i.test(name) ? "shadow" : "";
// The model seen up close: the one named like the resource, else the first that is not a low-detail copy or a shadow.
function mainModelIndex(models: any[], resourcePath: string) {
  const base = filename(resourcePath).replace(/\.brres$/i, "").toLowerCase();
  const named = models.findIndex((m) => m.name.toLowerCase() === base);
  return Math.max(0, named >= 0 ? named : models.findIndex((m) => !modelRole(m.name)));
}

export function AssetEditorDialog({ close, initialCategory, initialArchive, initialResource, looseFile }: {
  close: (value: any) => void; initialCategory?: Category; initialArchive?: string; initialResource?: string; looseFile?: LooseFile;
}) {
  const loose = React.useRef(looseFile ? { ...looseFile } : null);
  const ed = useEditor("settings", "doc");
  const root = ed.workspace();
  const [category, setCategory] = React.useState<Category>(initialCategory || "characters");
  const [archives, setArchives] = React.useState<string[]>([]);
  const [archivePath, setArchivePath] = React.useState("");
  const [tree, setTree] = React.useState<any>(null);
  const [resourcePath, setResourcePath] = React.useState("");
  const [dirtyPaths, setDirtyPaths] = React.useState<Set<string>>(new Set());
  const [originals, setOriginals] = React.useState<Map<string, Uint8Array>>(new Map());
  const [query, setQuery] = React.useState("");
  const [view, setView] = React.useState<View>("models");
  const [modelIndex, setModelIndex] = React.useState(0);
  const [partIndex, setPartIndex] = React.useState(-1);
  const [boneIndex, setBoneIndex] = React.useState(0);
  const [showSkeleton, setShowSkeleton] = React.useState(false);
  const [expandedModels, setExpandedModels] = React.useState<Set<number>>(new Set([0]));
  const [animationName, setAnimationName] = React.useState("");
  const [expandedAnimations, setExpandedAnimations] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState("");
  const [, setRevision] = React.useState(0);
  const initialUsed = React.useRef(false);

  const columns = useColumnWidths("assets", [250, 180]);
  const archiveList = React.useRef<HTMLDivElement>(null);
  // The open track is listed by its file name; one never saved yet has no path.
  const archiveName = (path: string) => path === OPEN_TRACK ? ed.doc.fileName || "Open track" : path === LOOSE ? loose.current?.name || "BRRES" : filename(path);
  // Keep the archive being edited in view, also when it was opened from the track (deep in a long list).
  React.useEffect(() => { archiveList.current?.querySelector("[data-active]")?.scrollIntoView({ block: "center" }); }, [archivePath, archives]);
  // Without a workspace the Track objects tab still edits the open track.
  const trackOnly = category === "courses" && !!ed.doc.szs;
  const currentTrack = (path: string) => !!ed.doc.szs && (path === OPEN_TRACK || !!ed.doc.filePath && path.toLowerCase() === ed.doc.filePath.toLowerCase());
  // The track open in the editor, reachable with one click in a long list of tracks.
  const openTrackEntry = category === "courses" && ed.doc.szs ? archives.find((p) => currentTrack(p)) : undefined;
  const resources = tree ? listFiles(tree).filter((f: any) => /\.brres$/i.test(f.path)) : [];
  const resource = resources.find((f: any) => f.path === resourcePath);
  const bytes: Uint8Array | null = resource?.node.data || null;
  const parsed = React.useMemo(() => { try { return bytes ? parseBRRES(bytes) : null; } catch { return null; } }, [bytes]);
  const models: any[] = parsed?.models || [];
  const model = models[modelIndex] || models[0] || null;
  const patchableModel = models.length === 1 && model?.bones?.length <= 1 && model?.name === "course";
  const textures: string[] = parsed ? [...parsed.textures.keys()] : [];
  // Models (and texture-swap animations) that draw each texture: editing a texture only shows where it is used.
  const textureUsers = React.useMemo(() => {
    const users = new Map<string, string[]>();
    const add = (texture: string, who: string) => { if (!texture) return; const list = users.get(texture) ?? []; if (!list.includes(who)) list.push(who); users.set(texture, list); };
    for (const m of models) for (const mat of m.materials || []) for (const layer of mat.layers || []) add(layer.texture, m.name);
    const walk = (value: any, who: string, depth = 0) => {
      if (!value || typeof value !== "object" || depth > 6 || ArrayBuffer.isView(value)) return;
      if (typeof value.texture === "string") add(value.texture, who);
      for (const item of Array.isArray(value) ? value : Object.values(value)) walk(item, who, depth + 1);
    };
    for (const pat of parsed?.pat?.values?.() ?? []) walk(pat, `${pat.name} (animation)`);
    return users;
  }, [parsed]);
  const animations: any[] = parsed ? [...parsed.chr.values()] : [];
  const archiveEntries = React.useMemo(() => archives.map((path) => ({ path, label: category === "characters" ? kartArchiveLabel(filename(path)) : null }))
    .sort((a, b) => category === "characters"
      ? (a.label?.character || filename(a.path)).localeCompare(b.label?.character || filename(b.path))
        || (a.label?.detail || "").localeCompare(b.label?.detail || "")
        || filename(a.path).localeCompare(filename(b.path))
      : filename(a.path).localeCompare(filename(b.path))), [archives, category]);

  const loadArchive = async (path: string, preferredResource = "") => {
    if (dirtyPaths.size && !(await dialogs.confirm({ title: "Unsaved resources", description: "Discard the changes in this archive?", confirmLabel: "Discard changes", destructive: true }))) return;
    setBusy("Opening archive…");
    try {
      let data: any;
      if (path === LOOSE && loose.current) { data = newSzsTree(); setFilePath(data, loose.current.name, loose.current.data); }
      else data = currentTrack(path) ? ed.doc.szs : parseU8(await api.decodeArchiveBytes((await api.readPath(path)).data, path, ed.commonPath || ed.partsFolder()));
      const next = cloneTree(data);
      const entries = listFiles(next).filter((f: any) => /\.brres$/i.test(f.path));
      if (!entries.length) throw new Error("This SZS has no BRRES models");
      setTree(next);
      setArchivePath(path);
      setResourcePath(entries.find((f: any) => f.path.toLowerCase() === preferredResource.toLowerCase())?.path || entries[0].path);
      setOriginals(new Map(entries.map((f: any) => [f.path, f.node.data])));
      setDirtyPaths(new Set());
      setModelIndex(0); setPartIndex(-1); setAnimationName(""); setView("models");
    } catch (error: any) { toast.error("Could not open the archive", { description: error.message }); }
    finally { setBusy(""); }
  };

  // An archive opened from File › Open (outside the workspace lists) is added to the list.
  const [externalArchive] = React.useState(() => initialArchive && initialArchive !== OPEN_TRACK ? initialArchive : "");
  React.useEffect(() => {
    if (!root && !trackOnly && !externalArchive && !loose.current) return;
    let cancelled = false;
    (async () => {
      let paths: string[];
      if (category === "objects") paths = [ed.workspacePath("Race", "Common.szs")].filter(Boolean);
      else {
        const folder = root ? ed.workspacePath("Race", category === "characters" ? "Kart" : "Course") : "";
        paths = folder ? (await api.listDir(folder, ["szs", "wlz", "wbz", "wu8"])).map((name: string) => winPath(folder, name)) : [];
      }
      if (category === "courses" && ed.doc.szs && (!ed.doc.filePath || !paths.some((p) => p.toLowerCase() === ed.doc.filePath?.toLowerCase()))) paths.unshift(OPEN_TRACK);
      if (cancelled) return;
      setArchives(paths);
      // OPEN_TRACK asks for the track open in the editor, listed by its path when it is in the workspace.
      if (externalArchive && !initialUsed.current && !paths.some((p) => p.toLowerCase() === externalArchive.toLowerCase())) paths.unshift(externalArchive);
      if (loose.current) paths.unshift(LOOSE);
      const wanted = initialUsed.current ? undefined : loose.current ? LOOSE : !initialArchive ? undefined
        : initialArchive === OPEN_TRACK ? paths.find(currentTrack) : paths.find((p) => p.toLowerCase() === initialArchive.toLowerCase());
      const preferred = wanted || (category === "characters" ? paths.find((p) => filename(p).toLowerCase() === "mdf_kart-mr.szs") || paths[0] : paths[0]);
      initialUsed.current = true;
      if (preferred) await loadArchive(preferred, preferred === wanted ? initialResource || "" : "");
    })().catch((error: any) => toast.error("Could not list game assets", { description: error.message }));
    return () => { cancelled = true; };
  }, [root, category]);

  React.useEffect(() => {
    const main = mainModelIndex(models, resourcePath);
    setModelIndex(main); setPartIndex(-1); setBoneIndex(0);
    setExpandedModels(new Set([main]));
  }, [resourcePath, archivePath]);
  React.useEffect(() => {
    setAnimationName((name) => animations.some((anim) => anim.name === name) ? name : "");
  }, [resourcePath, bytes]);

  const changeCategory = async (next: Category) => {
    if (next === category) return;
    if (dirtyPaths.size && !(await dialogs.confirm({ title: "Unsaved resources", description: "Discard the changes in this archive?", confirmLabel: "Discard changes", destructive: true }))) return;
    setDirtyPaths(new Set()); setTree(null); setArchivePath(""); setCategory(next);
  };
  const changeBytes = (next: Uint8Array) => {
    if (!resource) return;
    parseBRRES(next);
    resource.node.data = next;
    setDirtyPaths((paths) => new Set(paths).add(resource.path));
    setRevision((n) => n + 1);
  };
  const run = async (label: string, action: () => Promise<Uint8Array | null>) => {
    if (!bytes) return;
    setBusy(label);
    try { const next = await action(); if (next) changeBytes(next); }
    catch (error: any) { toast.error(label, { description: error.message }); }
    finally { setBusy(""); }
  };
  const readArchive = async (path: string) => {
    const file = await api.readPath(path);
    return parseU8(await api.decodeArchiveBytes(file.data, path, ed.commonPath || ed.partsFolder()));
  };
  // Puts resources into an archive file. The track open in the editor also gets them in memory; its
  // other unsaved edits (routes, objects, collision) are not written here and still wait for File › Save.
  const writeResources = async (path: string, changes: (readonly [string, Uint8Array])[], disk: any = null) => {
    if (path === LOOSE && loose.current) {
      const data = changes[0]?.[1];
      if (!data) return "disk";
      const written = await ed.writeLoose(loose.current.path, loose.current.name, data);
      if (!written) throw new Error("Not saved");
      loose.current = { ...loose.current, path: written, data };
      return "loose";
    }
    const d = ed.doc;
    const open = !!d.szs && (path === OPEN_TRACK || (!!d.filePath && path.toLowerCase() === d.filePath.toLowerCase()));
    let wasDirty = d.dirty;
    if (open) {
      d.change("Edit game resources", () => {
        for (const [file, data] of changes) { const target = findFile(d.szs, file); if (target) target.data = data; }
      }, { structural: true });
      d.emit("model");
      if (!(hasBackend && d.filePath && d.fileKind === "szs")) return "memory";
      path = d.filePath;
    }
    disk ??= await readArchive(path);
    for (const [file, data] of changes) setFilePath(disk, file, data);
    await api.writeFile(path, buildU8(disk), { backup: ed.settings.keepBackups, edited: true, compress: "yaz0" });
    if (open && !wasDirty) { d.dirty = false; ed.bump("doc"); }
    return open && wasDirty ? "open-dirty" : "disk";
  };
  // Other archives holding copies of the edited resources (see resource-copies.js).
  const findCopies = async (edited: { path: string; original: Uint8Array; next: Uint8Array }[]) => {
    if (!ed.settings.offerCopyUpdates || category === "objects" || archivePath === OPEN_TRACK || archivePath === LOOSE || !hasBackend) return [];
    const folder = archivePath.replace(/[\\/][^\\/]+$/, "");
    const names: string[] = await api.listDir(folder, ["szs", "wlz", "wbz", "wu8"]);
    const { close, other } = copyCandidates(category, filename(archivePath), names);
    const textures = new Map(edited.map((e) => [e.path, changedTextures(e.original, e.next)]));
    const found: { path: string; close: boolean; changes: (readonly [string, Uint8Array])[]; identical: number; textures: number }[] = [];
    const all = [...close.map((n) => [n, true] as const), ...other.map((n) => [n, false] as const)];
    for (const [i, [name, isClose]] of all.entries()) {
      setBusy(`Looking for other copies… ${i + 1}/${all.length}`);
      const path = winPath(folder, name);
      let archive: any;
      try { archive = await readArchive(path); } catch { continue; }
      const changes: (readonly [string, Uint8Array])[] = [];
      let identical = 0, texturesChanged = 0;
      for (const e of edited) {
        const copy = findFile(archive, e.path)?.data;
        const update = copy && updateCopy(copy, e.original, e.next, textures.get(e.path));
        if (!update) continue;
        changes.push([e.path, update.data]);
        if (update.kind === "identical") identical++; else texturesChanged += update.textures;
      }
      if (changes.length) found.push({ path, close: isClose, changes, identical, textures: texturesChanged });
    }
    return found;
  };
  const save = async () => {
    if (!tree || !dirtyPaths.size) return;
    setBusy("Saving resources…");
    try {
      const changes = [...dirtyPaths].map((path) => [path, findFile(tree, path)?.data] as const).filter((c): c is readonly [string, Uint8Array] => !!c[1]);
      const edited = changes.map(([path, next]) => ({ path, original: originals.get(path)!, next })).filter((e) => e.original);
      const copies = await findCopies(edited);
      let chosen: typeof copies = [];
      if (copies.length) {
        const close = copies.filter((c) => c.close), other = copies.filter((c) => !c.close);
        const list = (items: typeof copies) => items.slice(0, 3).map((c) => filename(c.path)).join(", ") + (items.length > 3 ? ` and ${items.length - 3} more` : "");
        const values = await dialogs.form({
          title: "Update the other copies?",
          description: "The game keeps a separate copy of this model in other archives, and uses the one of the archive it loads. Identical copies get the whole change; other versions (lighter split-screen models, a driver on a bike instead of a kart) get only the edited textures.",
          fields: [
            ...(close.length ? [{ key: "close", label: category === "characters" ? `Same character, other vehicles and split screen (${close.length})` : `Split-screen version (${list(close)})`, type: "switch" as const, value: true, hint: category === "characters" ? list(close) : "Used when 2 to 4 players race on one console." }] : []),
            ...(other.length ? [{ key: "other", label: `Other tracks with the same object (${other.length})`, type: "switch" as const, value: false, hint: list(other) }] : []),
            { key: "ask", label: "Ask about other copies next time", type: "switch" as const, value: true, hint: "Turn off to always save only this archive. It can be turned back on in Settings › Editing." },
          ],
          confirmLabel: "Save",
        });
        if (!values) return;
        if (!values.ask) ed.setSetting("offerCopyUpdates", false);
        chosen = copies.filter((c) => (c.close ? values.close : values.other));
      }
      setBusy("Saving resources…");
      const result = await writeResources(archivePath, changes, currentTrack(archivePath) ? null : tree);
      for (const [i, copy] of chosen.entries()) {
        setBusy(`Saving copies… ${i + 1}/${chosen.length}`);
        await writeResources(copy.path, copy.changes);
      }
      if (category === "objects") await ed.loadCommonFrom(archivePath, true);
      if (category === "characters" && filename(archivePath).toLowerCase() === "mdf_kart-mr.szs") await ed.loadKartModel(true);
      const extra = chosen.length ? ` ${chosen.length} other cop${chosen.length === 1 ? "y was" : "ies were"} updated too.` : "";
      if (result === "loose") { /* writeLoose already said where */ }
      else if (result === "memory") toast.success("Resources added to the open track", { description: "Save the track to write its SZS file." + extra });
      else toast.success("Game archive saved", { description: (result === "open-dirty" ? "The resources are in the track file. Its other unsaved changes still need File › Save." : ed.settings.keepBackups ? "The original is kept as a .bak file." : "Backups are off in Settings.") + extra });
      setOriginals(new Map(resources.map((f: any) => [f.path, f.node.data])));
      setDirtyPaths(new Set());
    } catch (error: any) { toast.error("Could not save resources", { description: error.message }); }
    finally { setBusy(""); }
  };
  const closeEditor = async () => {
    if (dirtyPaths.size && !(await dialogs.confirm({ title: "Unsaved resources", description: "Close without saving these changes?", confirmLabel: "Close without saving", destructive: true }))) return;
    close(null);
  };
  const export3D = async () => {
    if (!parsed || !model) return;
    setBusy("Exporting 3D model…");
    try {
      const { data, animations: count } = await exportBRRESModelGLB(parsed, model);
      const saved = await editor.exportBytes(`${model.name}.glb`, FILTERS.glb, data, "Export 3D model");
      if (saved) toast.success("3D model exported", { description: `${model.name}: ${model.bones.length} bone(s), ${count} animation(s). Texture animations are not included.` });
    } catch (error: any) { toast.error("Could not export the 3D model", { description: error.message }); }
    finally { setBusy(""); }
  };
  const replaceResource = () => run("Replacing BRRES…", async () => {
    const file = await api.openFile(FILTERS.brres, "Choose a compatible BRRES");
    if (!file) return null;
    const donor = parseBRRES(file.data);
    if (!donor.models.length || models.some((m: any) => !donor.models.some((other: any) => other.name === m.name)))
      throw new Error("The replacement must contain the same model names as this resource");
    return file.data;
  });
  const convert3D = async () => {
    setBusy("Converting 3D model…");
    try {
      const file = await api.openFile(FILTERS.importModel, "Choose a 3D model to convert");
      if (!file) return;
      if (!file.path) throw new Error("Conversion requires a model file on disk");
      let animation = "";
      if (/\.(fbx|gltf|glb|dae|blend)$/i.test(file.path)) {
        const choices = await api.modelAnimations(file.path);
        if (choices.length) {
          const choice = await dialogs.open<string>("animationChoice", { file: file.name, animations: choices, purpose: "convert" });
          if (choice === null) return;
          animation = choice;
        }
      }
      const converted = await api.convertModelBRRES(file.path, animation);
      const result = parseBRRES(converted);
      const stem = file.name.replace(/\.[^.]+$/, "");
      const saved = await editor.exportBytes(`${stem}.brres`, FILTERS.brres, converted, "Export converted BRRES");
      if (saved) toast.success("BRRES generated", { description: `${result.models.length} model(s), ${result.textures.size} texture(s), ${result.chr.size} bone animation(s).` });
    } catch (error: any) { toast.error("Could not convert the 3D model", { description: error.message }); }
    finally { setBusy(""); }
  };
  const import3D = () => run("Replacing 3D model…", async () => {
    if (!patchableModel) throw new Error("This model cannot be patched by ABMatt; replace it with a compatible BRRES instead");
    const file = await api.openFile(FILTERS.importModel, "Choose a 3D model");
    if (!file) return null;
    if (!file.path) throw new Error("Import requires a model file on disk");
    const names = models[0].objects.map((part: any) => part.name);
    let animation = "";
    if (/\.(fbx|gltf|glb|dae)$/i.test(file.path)) {
      const choices = await api.modelAnimations(file.path);
      if (choices.length) {
        const choice = await dialogs.open<string>("animationChoice", { file: file.name, animations: choices });
        if (choice === null) return null;
        animation = choice;
      }
    }
    let next = await api.import3DModel(bytes, file.path, [0, 0, 0], animation);
    const imported = parseBRRES(next).models[0];
    if (!imported || imported.objects.length <= names.length) throw new Error("The imported file added no model parts");
    for (const name of names) next = clearBRRESPolygon(next, models[0].name, name);
    return next;
  });
  const replacePart = () => run("Replacing model part…", async () => {
    if (!patchableModel || partIndex < 0) throw new Error("Select a part of a patchable course model");
    const file = await api.openFile(FILTERS.brres, "Choose a BRRES part source");
    if (!file) return null;
    const donor = parseBRRES(file.data);
    const choices = donor.models.flatMap((m: any) => m.objects.map((part: any) => [`${m.name}/${part.name}`, `${m.name} / ${part.name}`] as [string, string]));
    if (!choices.length) throw new Error("The source has no model parts");
    const picked = await dialogs.form({ title: "Replace model part", fields: [{ key: "part", label: "Source part", type: "select", value: choices[0][0], options: choices }], confirmLabel: "Replace" });
    if (!picked) return null;
    const [sourceModel, sourcePart] = String(picked.part).split("/");
    const imported = await api.importModelPart(bytes, file.data, { model: sourceModel, part: sourcePart, tag: "Replacement" });
    return clearBRRESPolygon(imported, model.name, model.objects[partIndex].name);
  });
  const importAnimation = () => run("Importing animation…", async () => {
    const file = await api.openFile(FILTERS.brres, "Choose an animation BRRES");
    if (!file) return null;
    const donor = parseBRRES(file.data);
    const choices = [...donor.chr.keys()].map((name) => [name, name] as [string, string]);
    if (!choices.length) throw new Error("The source has no CHR0 animations");
    const picked = await dialogs.form({ title: "Import CHR0 animation", fields: [{ key: "name", label: "Animation", type: "select", value: choices[0][0], options: choices }], confirmLabel: "Import" });
    return picked ? api.importResourceAnimation(bytes, file.data, String(picked.name)) : null;
  });
  const editBone = async (key: "trans" | "rot" | "scale") => {
    const bone = model?.bones[boneIndex];
    if (!bone || !bytes) return;
    const label = { trans: "Position", rot: "Rotation", scale: "Scale" }[key];
    const values = await dialogs.form({ title: `${label} · ${bone.name}`, fields: ["X", "Y", "Z"].map((axis, index) => ({
      key: axis, label: axis, type: "number" as const, value: bone[key][index], step: key === "rot" ? 1 : .01,
    })), confirmLabel: "Apply" });
    if (!values) return;
    setAnimationName("");
    await run("Editing skeleton…", async () => setBRRESBoneRestTransform(bytes, model.name, boneIndex, {
      [key]: [Number(values.X), Number(values.Y), Number(values.Z)],
    }));
  };

  return <div className="flex h-full min-h-0 flex-col gap-3">
    <div className="flex shrink-0 items-start justify-between gap-3">
      <div><DialogTitle className="text-sm">Characters and models</DialogTitle><DialogDescription className="text-xs">Models, textures and animations in the game archives.</DialogDescription></div>
      <Button size="icon" variant="ghost" title="Close" aria-label="Close" disabled={!!busy} onClick={closeEditor}><X /></Button>
    </div>
    {!root && !trackOnly && !externalArchive && !loose.current ? <WorkspaceCard /> : <>
      <div className="flex shrink-0 items-center gap-2">
        <div role="tablist" className="flex rounded-md border bg-muted/30 p-0.5">
          {([ ["characters", "Characters"], ["objects", "Objects"], ["courses", "Track objects"] ] as const).map(([id, label]) =>
            <button key={id} role="tab" aria-selected={category === id} onClick={() => changeCategory(id)} className={cn("cursor-pointer rounded px-2 py-1 text-xs", category === id ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>{label}</button>)}
        </div>
        {busy && <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" /> {busy}</span>}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 sm:gap-0 sm:[grid-template-columns:var(--columns)]" style={{ "--columns": columns.template } as React.CSSProperties}>
        <div className="flex min-h-0 max-h-32 flex-col border sm:max-h-none">
          <div className="relative border-b p-1"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Find archive" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={category === "characters" ? "Find character or vehicle" : "Find archive"} className="h-7 pl-7 text-xs" /></div>
          {openTrackEntry && <div className="border-b p-1">
            <Button size="sm" variant="secondary" className="w-full min-w-0 justify-start" disabled={!!busy || archivePath === openTrackEntry}
              title={`Show the track open in the editor (${ed.doc.fileName})`} onClick={() => { setQuery(""); void loadArchive(openTrackEntry); }}>
              <Box /> <span className="min-w-0 truncate">Open in editor: {archiveName(openTrackEntry)}</span>
            </Button>
          </div>}
          <div ref={archiveList} className="min-h-0 flex-1 overflow-y-auto p-1">{archiveEntries.filter(({ path, label }) => (label?.search || filename(path).toLowerCase()).includes(query.toLowerCase())).map(({ path, label }) =>
            <button key={path} data-active={archivePath === path || undefined} aria-current={archivePath === path || undefined} onClick={() => loadArchive(path)} className={cn("block w-full cursor-pointer rounded border border-transparent px-2 py-1.5 text-left text-xs hover:bg-accent", archivePath === path && "border-primary/60 bg-accent")} title={path === LOOSE ? loose.current?.path || loose.current?.name : path}>
              <span className="block truncate font-medium">{label?.character || archiveName(path)}</span>
              {label && <span className="block truncate text-[10.5px] text-muted-foreground">{label.detail}</span>}
            </button>)}</div>
        </div>
        <ColumnHandle label="Resize the archive list" onResize={(delta) => columns.resize(0, delta)} onReset={columns.reset} />
        <div className="flex min-h-0 max-h-32 flex-col border sm:max-h-none">
          <div className="shrink-0 border-b px-2 py-2 text-[11px] text-muted-foreground">{resources.length} BRRES resources{archivePath && <> in <span className="font-medium text-foreground">{archiveName(archivePath)}</span></>}</div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1">{resources.map((entry: any) =>
            <button key={entry.path} onClick={() => { setResourcePath(entry.path); setModelIndex(0); setPartIndex(-1); }} className={cn("flex w-full cursor-pointer items-center gap-1 rounded px-2 py-1.5 text-left text-xs hover:bg-accent", entry.path === resourcePath && "bg-accent")} title={entry.path}>
              <Box className="size-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate">{entry.path}</span>{dirtyPaths.has(entry.path) && <span className="size-1.5 rounded-full bg-primary" />}
            </button>)}</div>
        </div>
        <ColumnHandle label="Resize the resource list" onResize={(delta) => columns.resize(1, delta)} onReset={columns.reset} />
        <div className="min-h-0 overflow-y-auto">
          {!bytes ? <div className="grid h-full place-items-center text-xs text-muted-foreground">Choose a model resource.</div> : !parsed ? <p className="text-xs text-destructive">This BRRES could not be read.</p> : <div className="flex min-h-full flex-col gap-2">
            <div className="flex flex-wrap items-center gap-1.5 text-xs"><span className="min-w-0 flex-1 truncate font-medium" title={`${archivePath === OPEN_TRACK || archivePath === LOOSE ? archiveName(archivePath) : archivePath} › ${resourcePath}`}><span className="text-muted-foreground">{archiveName(archivePath)} › </span>{resourcePath}</span>
              <Button size="sm" variant="ghost" title="Undo resource changes" disabled={!dirtyPaths.has(resourcePath) || !!busy} onClick={() => { const original = originals.get(resourcePath); if (original) { resource.node.data = original; setDirtyPaths((paths) => { const next = new Set(paths); next.delete(resourcePath); return next; }); setRevision((n) => n + 1); } }}><Undo2 /></Button>
              <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => editor.exportBytes(filename(resourcePath), FILTERS.brres, bytes, "Export BRRES")}><Download /> BRRES</Button>
              <Button size="sm" variant="secondary" disabled={!!busy || !model} title={model ? `Export ${model.name} as a glTF model (.glb) with its skeleton, textures and bone animations` : "No model in this resource"} onClick={export3D}><Download /> 3D model</Button>
              <Button size="sm" variant="secondary" disabled={!!busy} title="Create a standalone BRRES with available bone animation" onClick={convert3D}><FileUp /> Convert 3D to BRRES…</Button>
              <Button size="sm" variant="secondary" disabled={!!busy} onClick={replaceResource}><FileUp /> Replace BRRES…</Button>
            </div>
            <div className="relative h-[min(40vh,560px)] min-h-48 w-full bg-[#11151c]"><AssetPreview brres={parsed} model={model} partIndex={partIndex} animationName={animationName} showSkeleton={showSkeleton} /></div>
            <div role="tablist" className="flex border-b text-xs">{([ ["models", `Models (${models.length})`], ["textures", `Textures (${textures.length})`], ["animations", `Animations (${animations.length})`] ] as const).map(([id, label]) =>
              <button key={id} role="tab" aria-selected={view === id} onClick={() => setView(id)} className={cn("cursor-pointer border-b-2 px-3 py-1.5", view === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>{label}</button>)}</div>
            {view === "models" && <div className="space-y-2 text-xs">
              <div className="max-h-72 overflow-y-auto border">{models.map((m: any, i: number) => <div key={`${m.name}:${i}`}>
                <div className={cn("flex items-center border-b last:border-b-0", i === modelIndex && partIndex < 0 && "bg-accent")}>
                  <button aria-label={`${expandedModels.has(i) ? "Collapse" : "Expand"} ${m.name}`} aria-expanded={expandedModels.has(i)} title={expandedModels.has(i) ? "Collapse model" : "Expand model"} onClick={() => setExpandedModels((open) => { const next = new Set(open); next.has(i) ? next.delete(i) : next.add(i); return next; })} className="grid size-7 shrink-0 cursor-pointer place-items-center hover:bg-accent">{expandedModels.has(i) ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}</button>
                  <button onClick={() => { setModelIndex(i); setPartIndex(-1); setBoneIndex(0); setExpandedModels((open) => new Set(open).add(i)); }} className={cn("min-w-0 flex-1 cursor-pointer truncate px-1 py-1.5 text-left font-medium hover:bg-accent", i === modelIndex && partIndex < 0 && "text-foreground")} title={m.name}>{m.name}{modelRole(m.name) && <span className="ml-1.5 font-normal text-muted-foreground">· {modelRole(m.name)}</span>}</button>
                  <span className="px-2 text-[10px] text-muted-foreground">{m.objects.length}</span>
                </div>
                {expandedModels.has(i) && m.objects.map((part: any, j: number) => <button key={`${part.name}:${j}`} onClick={() => { setModelIndex(i); setPartIndex(j); }} className={cn("flex w-full cursor-pointer items-center gap-2 border-b py-1.5 pl-9 pr-2 text-left hover:bg-accent", i === modelIndex && j === partIndex && "bg-accent")} title={`${m.name} / ${part.name}`}><Box className="size-3 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{part.name}</span></button>)}
              </div>)}</div>
              {model && <>
                {model.bones.length > 1 && <div className="flex flex-wrap items-center gap-2 border-t pt-2">
                  <span className="text-[11px] font-medium">Skeleton ({model.bones.length})</span>
                  <Select value={String(boneIndex)} onValueChange={(value) => { setBoneIndex(Number(value)); setAnimationName(""); }}>
                    <SelectTrigger aria-label="Skeleton bone" className="h-7 min-w-36 max-w-52 flex-1 text-[11px]"><SelectValue /></SelectTrigger>
                    <SelectContent>{model.bones.map((bone: any, index: number) => <SelectItem key={index} value={String(index)}>{bone.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <label className="flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground"><input type="checkbox" className="accent-primary" checked={showSkeleton} onChange={(event) => setShowSkeleton(event.target.checked)} /> Show bones</label>
                  <Button size="sm" disabled={!!busy} title="Bone hierarchy, rest position, rotation and scale with a 3D preview"
                    onClick={() => { setAnimationName(""); void dialogs.open("skeletonEditor", { bytes, modelName: model.name, resourceName: resourcePath, onCommit: changeBytes }); }}><Bone /> Edit skeleton…</Button>
                  {([ ["trans", "Move"], ["rot", "Rotate"], ["scale", "Scale"] ] as const).map(([key, label]) =>
                    <Button key={key} size="sm" variant="secondary" disabled={!!busy} onClick={() => editBone(key)}>{label} bone…</Button>)}
                </div>}
                <div className="flex flex-wrap gap-1.5">
                  <span title={patchableModel ? "Replace this course model's geometry" : "ABMatt cannot patch this game model; use Replace BRRES above"}><Button size="sm" variant="secondary" disabled={!!busy || !patchableModel} onClick={import3D}><FileUp /> Replace with 3D file…</Button></span>
                  <span title={!patchableModel ? "ABMatt cannot patch this game model; use Replace BRRES above" : partIndex < 0 ? "Select a polygon above" : "Replace this polygon from another BRRES"}><Button size="sm" variant="secondary" disabled={!!busy || !patchableModel || partIndex < 0} onClick={replacePart}>Replace selected part…</Button></span>
                  <span title={partIndex < 0 ? "Select a polygon above" : "Move the selected polygon"}><Button size="sm" variant="secondary" disabled={!!busy || partIndex < 0} onClick={async () => {
                    const values = await dialogs.form({ title: "Move model part", fields: ["X", "Y", "Z"].map((axis) => ({ key: axis, label: axis, type: "number" as const, value: 0, step: 1 })) });
                    if (values) run("Moving model part…", async () => translateBRRESPart(bytes, model.name, partIndex, [Number(values.X), Number(values.Y), Number(values.Z)]));
                  }}>Move part…</Button></span>
                </div></>}
            </div>}
            {view === "textures" && <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">{textures.map((name) => {
              const users = textureUsers.get(name) || [];
              return <button key={name} onClick={() => dialogs.open("assetTextureEditor", { name, bytes, originalKey: `${archivePath}:${resourcePath}:${name}`, onCommit: changeBytes })} className="flex min-w-0 cursor-pointer items-center gap-2 border px-2 py-2 text-left text-xs hover:bg-accent" title={`Edit ${name}`}>
                <Paintbrush className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{name}</span>
                  <span className="block truncate text-[10.5px] text-muted-foreground">{users.length ? `Used by ${users.map((u) => modelRole(u) ? `${u} (${modelRole(u)})` : u).join(", ")}` : "Not used by any model of this resource"}</span>
                </span>
                <span className="text-[10px] text-muted-foreground">{parsed.textures.get(name)?.width}×{parsed.textures.get(name)?.height}</span>
              </button>;
            })}</div>}
            {view === "animations" && <div className="space-y-2 text-xs">
              {/* Same list as Models. The arrow (or the name) only opens an animation; the play button
                  plays it in the preview and stops it again, back to the rest pose. */}
              <div className="max-h-72 overflow-y-auto border">
                {animations.map((anim: any) => {
                  const open = expandedAnimations.has(anim.name), bones = [...(anim.bones?.keys?.() ?? [])] as string[];
                  const toggle = () => setExpandedAnimations((current) => { const next = new Set(current); next.has(anim.name) ? next.delete(anim.name) : next.add(anim.name); return next; });
                  const playing = anim.name === animationName;
                  return <div key={anim.name}>
                    <div className={cn("flex items-center border-b last:border-b-0", playing && "bg-accent")}>
                      <button aria-label={`${open ? "Collapse" : "Expand"} ${anim.name}`} aria-expanded={open} title={open ? "Collapse animation" : "Expand animation"} onClick={toggle} className="grid size-7 shrink-0 cursor-pointer place-items-center hover:bg-accent">{open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}</button>
                      <button aria-label={`${playing ? "Stop" : "Play"} ${anim.name}`} title={playing ? "Stop (rest pose)" : "Play in the preview"} onClick={() => setAnimationName(playing ? "" : anim.name)} className={cn("grid size-7 shrink-0 cursor-pointer place-items-center hover:bg-accent", playing ? "text-foreground" : "text-muted-foreground")}>{playing ? <Square className="size-3 fill-current" /> : <Play className="size-3.5 fill-current" />}</button>
                      <button onClick={toggle} className="min-w-0 flex-1 cursor-pointer truncate px-1 py-1.5 text-left font-medium hover:bg-accent" title={anim.name}>{anim.name}</button>
                      <span className="px-2 text-[10px] text-muted-foreground" title="Animated bones">{bones.length}</span>
                    </div>
                    {open && <>
                      <div className="flex flex-wrap items-center gap-3 border-b py-1 pl-16 pr-2">
                        <span className="text-muted-foreground">{anim.frames} frames</span>
                        <label className="flex cursor-pointer items-center gap-1"><input type="checkbox" className="accent-primary" checked={!!anim.loop} onChange={(event) => run("Changing animation loop…", async () => setCHR0Loop(bytes, anim.name, event.target.checked))} /> Loop</label>
                        <Button size="sm" variant="ghost" className="ml-auto h-6 px-2 text-[11px]" disabled={!!busy} onClick={() => run("Removing animation…", async () => (await dialogs.confirm({ title: "Delete animation", description: `Remove ${anim.name} from this BRRES?`, confirmLabel: "Delete", destructive: true })) ? api.deleteAnimation(bytes, anim.name) : null)}><Trash2 /> Delete</Button>
                      </div>
                      {bones.map((bone) => <div key={bone} className="flex items-center gap-2 border-b py-1.5 pl-16 pr-2 text-muted-foreground" title={`${anim.name} / ${bone}`}><Bone className="size-3 shrink-0" /><span className="min-w-0 flex-1 truncate">{bone}</span></div>)}
                    </>}
                  </div>;
                })}
              </div>
              <Button size="sm" variant="secondary" disabled={!!busy} onClick={importAnimation}><FileUp /> Import CHR0 from BRRES…</Button>
            </div>}
          </div>}
        </div>
      </div>
    </>}
    <div className="flex shrink-0 justify-end border-t pt-2"><Button size="sm" disabled={!dirtyPaths.size || !!busy} onClick={save}>{busy === "Saving resources…" ? <LoaderCircle className="animate-spin" /> : <Save />} Save {dirtyPaths.size || ""}</Button></div>
  </div>;
}

export function AssetTextureEditorDialog({ name, bytes, originalKey, onCommit, close }: {
  name: string; bytes: Uint8Array; originalKey: string; onCommit: (next: Uint8Array) => void; close: (value: any) => void;
}) {
  const [currentBytes, setCurrentBytes] = React.useState(bytes);
  const [dirty, setDirty] = React.useState(false);
  const staged = React.useMemo(() => ({
    encode: (data: Uint8Array, pixels: Uint8ClampedArray) => replaceBRRESTexture(data, name, pixels),
    save: (data: Uint8Array) => { setCurrentBytes(data); onCommit(data); },
  }), [name]);
  const requestClose = async () => {
    if (dirty && !(await dialogs.confirm({ title: "Unsaved texture", description: "The painted strokes have not been saved. Close and discard them?", confirmLabel: "Discard strokes", destructive: true }))) return;
    close(true);
  };
  return <div className="flex h-full min-h-0 flex-col gap-3">
    <div className="flex shrink-0 items-start justify-between gap-2"><div><DialogTitle className="text-sm">Texture · {name}</DialogTitle><DialogDescription className="text-xs">{originalKey.split(":").slice(-2, -1)[0]}</DialogDescription></div><Button size="icon" variant="ghost" title="Close" aria-label="Close" onClick={requestClose}><X /></Button></div>
    <TexturePainter key={originalKey} name={name} bytes={currentBytes} originalKey={originalKey} tall onPreview={noopPreview} staged={staged} onDirtyChange={setDirty} />
    <div className="flex shrink-0 justify-end border-t pt-2"><Button size="sm" onClick={requestClose}>Done</Button></div>
  </div>;
}

const noopPreview = () => {};

// inside: the camera stands at the centre and looks around (skies are domes seen from within).
export function AssetPreview({ brres, model, partIndex, animationName, showSkeleton, inside = false }: { brres: any; model: any; partIndex: number; animationName: string; showSkeleton: boolean; inside?: boolean }) {
  const host = React.useRef<HTMLDivElement>(null);
  const scene = React.useRef<any>(null);
  React.useEffect(() => {
    const el = host.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); }
    catch { return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x11151c);
    el.append(renderer.domElement);
    const world = new THREE.Scene();
    world.add(new THREE.AmbientLight(0xffffff, 1.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.7); sun.position.set(1, 2, 1.5); world.add(sun);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1e7);
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
    const resize = () => { const w = el.clientWidth || 1, h = el.clientHeight || 1; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
    const observer = new ResizeObserver(resize); observer.observe(el); resize();
    let frame = 0;
    const tick = () => { frame = requestAnimationFrame(tick); controls.update(); if (scene.current?.binding) applyCHRFrame(scene.current.binding, performance.now() / 1000 * 60 % scene.current.binding.frames); renderer.render(world, camera); };
    tick();
    scene.current = { world, camera, controls, group: null, helper: null, binding: null };
    return () => { cancelAnimationFrame(frame); observer.disconnect(); controls.dispose(); renderer.dispose(); renderer.domElement.remove(); scene.current = null; };
  }, []);
  React.useEffect(() => {
    const state = scene.current;
    if (!state) return;
    if (state.helper) { state.world.remove(state.helper); state.helper.geometry.dispose(); state.helper.material.dispose(); state.helper = null; }
    if (state.group) { state.world.remove(state.group); state.group.traverse((o: any) => { if (o.isMesh) { o.geometry?.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: any) => m?.dispose()); } }); }
    state.group = null; state.binding = null;
    if (!model) return;
    try {
      const chr = brres.chr.get(animationName);
      const group = new BrresModelBuilder(brres).build(model, { skinned: model.bones.length > 1 || !!chr, lit: null });
      group.traverse((o: any) => { if (o.isMesh && partIndex >= 0) o.visible = o.userData.partIndex === partIndex; });
      state.world.add(group); state.group = group;
      if (showSkeleton && model.bones.length > 1) {
        const helper = new THREE.SkeletonHelper(group);
        helper.material.depthTest = false; helper.material.transparent = true; helper.material.opacity = .85;
        state.world.add(helper); state.helper = helper;
      }
      state.binding = chr ? bindCHR(chr, group) : null;
      const box = new THREE.Box3().setFromObject(group);
      if (!box.isEmpty()) {
        const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
        const radius = Math.max(size.length() / 2, 10);
        state.controls.target.copy(center);
        state.controls.enableZoom = state.controls.enablePan = !inside;
        state.camera.position.copy(center).add(inside ? new THREE.Vector3(0, 0, radius / 1000)
          : new THREE.Vector3(0.9, 0.6, 1).normalize().multiplyScalar(radius * (model.bones.length > 1 ? 2.25 : 2.8)));
        state.camera.near = Math.max(0.1, radius / 200); state.camera.far = radius * 400; state.camera.updateProjectionMatrix();
      }
    } catch (error) { console.warn("Asset preview failed", error); }
  }, [brres, model, partIndex, animationName, showSkeleton, inside]);
  return <div ref={host} className="absolute inset-0 [&>canvas]:size-full" />;
}
