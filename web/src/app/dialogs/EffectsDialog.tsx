// Particle effects editor: the BREFF (emitters and particles) and BREFT (their textures) files of the
// open track, or of an archive opened in the archive window. Values are edited in place.

import * as React from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Image as ImageIcon, Paintbrush, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { buildU8, isU8, listFiles, parseU8 } from "../../../js/formats/u8.js";
import { api } from "../../../js/api.js";
import { TEXTURE_FORMATS } from "../../../js/formats/brres.js";
import {
  EMITTER_FIELDS, PARTICLE_FIELDS, breftTextureSupported, decodeBREFTTexture, parseBREFF, parseBREFT, replaceBREFTTexture, setBREFFValue,
} from "../../../js/formats/effects.js";
import { editor, winPath } from "../editor";
import { dialogs } from "../dialogs-store";
import { useEditor } from "../hooks";
import { TexturePainter } from "../panels/TexturePainter";
import { ColumnHandle, useColumnWidths } from "../resizable";
import { HistoryBar, useEditHistory, useHistoryKeys } from "../edit-history";
import { EffectPreview, dataId } from "../../../js/editor/effect-preview.js";
import { NumberField } from "../number-field";
import { cn } from "@/lib/utils";

type FileRef = { path: string; data: Uint8Array };
type Group = { key: string; label: string; breff?: FileRef; breft?: FileRef };
type Selection = { kind: "emitter" | "texture"; name: string } | null;

function groupsOf(tree: any): Group[] {
  const map = new Map<string, Group>();
  for (const f of listFiles(tree)) {
    const m = f.path.match(/^(.*)\.(breff|breft)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const group = map.get(key) || { key, label: m[1] };
    group[m[2].toLowerCase() as "breff" | "breft"] = { path: f.path, data: f.node.data };
    map.set(key, group);
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}

const safe = <T,>(fn: () => T): T | null => { try { return fn(); } catch { return null; } };
const hex = (rgb: number[]) => "#" + rgb.slice(0, 3).map((n) => n.toString(16).padStart(2, "0")).join("");
const round = (n: number) => Math.round(n * 1000) / 1000;

// A number that is written when the field loses focus or Enter is pressed (one undo step per edit),
// kept inside the limits of the value it edits.
export function NumberInput({ value, onCommit, label, integer, min, max }: { value: number; onCommit: (n: number) => void; label: string; integer?: boolean; min?: number; max?: number }) {
  return <NumberField aria-label={label} value={value} integer={integer} min={min} max={max} commit onValue={onCommit} className="h-7 min-w-0 px-2 text-xs" />;
}

// Limits of the stored number types.
export const TYPE_LIMITS: Record<string, [number, number]> = { u8: [0, 255], s8: [-128, 127], u16: [0, 65535], u32: [0, 4294967295], rgba: [0, 255] };

// The native "change" event fires once the colour is chosen, not on every move of the picker.
export function ColorInput({ value, label, onCommit }: { value: string; label: string; onCommit: (hex: string) => void }) {
  const ref = React.useRef<HTMLInputElement>(null);
  const latest = React.useRef(onCommit);
  latest.current = onCommit;
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const listener = () => latest.current(el.value);
    el.addEventListener("change", listener);
    return () => el.removeEventListener("change", listener);
  }, []);
  React.useEffect(() => { if (ref.current) ref.current.value = value; }, [value]);
  return <input ref={ref} type="color" aria-label={label} defaultValue={value} className="h-7 w-9 cursor-pointer rounded border bg-transparent p-0.5" />;
}

function Thumb({ data, tex, className }: { data: Uint8Array; tex: any; className?: string }) {
  const canvas = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    const el = canvas.current, pixels = safe(() => decodeBREFTTexture(data, tex));
    if (!el || !pixels) return;
    el.width = tex.width; el.height = tex.height;
    el.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(pixels), tex.width, tex.height), 0, 0);
  }, [data, tex]);
  return <canvas ref={canvas} className={cn("bg-[repeating-conic-gradient(#8884_0_25%,transparent_0_50%)] bg-[length:12px_12px] object-contain [image-rendering:pixelated]", className)} />;
}

// The effect playing on its own: every emitter, or only the selected one. Drag to turn, wheel to zoom.
function EffectViewer({ effect, textureFile, breff, breft, only }: { effect: any; textureFile: any; breff?: Uint8Array; breft?: Uint8Array; only?: string }) {
  const host = React.useRef<HTMLDivElement>(null);
  const state = React.useRef<any>(null);
  React.useEffect(() => {
    const el = host.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch { return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.setClearColor(0x11151c);
    el.append(renderer.domElement);
    const scene = new THREE.Scene();
    const grid = new THREE.GridHelper(2000, 20, 0x3a4250, 0x262c36);
    scene.add(grid);
    const camera = new THREE.PerspectiveCamera(45, 1, 1, 1e6);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    const fx = new EffectPreview(scene);
    const resize = () => { const w = el.clientWidth || 1, h = el.clientHeight || 1; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
    const observer = new ResizeObserver(resize); observer.observe(el); resize();
    let frame = 0, last = performance.now();
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      controls.update();
      fx.step(dt, renderer.domElement.height);
      renderer.render(scene, camera);
    };
    frame = requestAnimationFrame(tick);
    state.current = { fx, camera, controls, grid, framed: "" };
    return () => { cancelAnimationFrame(frame); observer.disconnect(); controls.dispose(); fx.clear(); renderer.dispose(); renderer.domElement.remove(); state.current = null; };
  }, []);
  React.useEffect(() => {
    const st = state.current;
    if (!st || !effect) return;
    const emitters = only ? effect.emitters.filter((e: any) => e.name === only) : effect.emitters;
    const textures = new Map<string, any>((textureFile?.textures || []).map((t: any) => [t.name, { data: breft, tex: t }]));
    st.fx.showEffect(`${breff ? dataId(breff) : 0}:${breft ? dataId(breft) : 0}:${only || "*"}`, emitters, textures);
    // Frame the camera when another effect or emitter is shown (not after every value change).
    const target = `${effect.name}:${only || "*"}`;
    if (st.framed !== target) {
      st.framed = target;
      const radius = EffectPreview.extent(emitters);
      st.camera.near = Math.max(0.5, radius / 500); st.camera.far = radius * 100; st.camera.updateProjectionMatrix();
      st.camera.position.set(radius * 0.6, radius * 0.45, radius * 0.8);
      st.controls.target.set(0, radius * 0.15, 0);
      st.grid.scale.setScalar(Math.max(0.1, radius / 600));
    }
  }, [effect, textureFile, breff, breft, only]);
  return <div ref={host} className="relative h-72 w-full shrink-0 overflow-hidden rounded border [&>canvas]:size-full" title="Drag to turn, wheel to zoom" />;
}

export function EffectsDialog({ tree: archiveTree, archiveName, initialPath, onChange, onSave, workspace, close }: {
  // Without a tree the effects of the open track are edited (also in the track's undo history, saved with the track).
  // workspace: every archive of the game folder that holds effects, one at a time.
  tree?: any; archiveName?: string; initialPath?: string; workspace?: boolean;
  onChange?: (path: string, data: Uint8Array) => void;
  onSave?: () => Promise<boolean> | boolean | void;
  close: (value: any) => void;
}) {
  useEditor("doc");
  const [, refresh] = React.useReducer((n: number) => n + 1, 0);
  const [archives, setArchives] = React.useState<{ path: string; name: string; folder: string; count: number }[] | null>(null);
  const [archivePath, setArchivePath] = React.useState("");
  const [loaded, setLoaded] = React.useState<{ path: string; tree: any; compressed: boolean } | null>(null);
  const [loading, setLoading] = React.useState("");
  const isOpenTrack = (path: string) => !!editor.doc.szs && !!editor.doc.filePath && path.toLowerCase() === editor.doc.filePath.toLowerCase();
  // Workspace archive edited here (not the track open in the editor, whose effects go through its history).
  const loadedTree = workspace && loaded && !isOpenTrack(loaded.path) ? loaded.tree : null;
  const tree = workspace ? (archivePath && isOpenTrack(archivePath) ? editor.doc.szs : loadedTree) : (archiveTree || editor.doc.szs);
  const fileName = (path: string) => path.split(/[\\/]/).pop() || "";
  const sourceName = workspace ? fileName(archivePath) : archiveName || editor.doc.fileName || "";
  const groups = tree ? groupsOf(tree) : [];
  const [groupKey, setGroupKey] = React.useState(() => {
    const wanted = initialPath?.replace(/\.(breff|breft)$/i, "").toLowerCase();
    return groups.find((g) => g.key === wanted)?.key || groups[0]?.key || "";
  });
  const group = groups.find((g) => g.key === groupKey) || groups[0];
  const effect = group?.breff ? safe(() => parseBREFF(group.breff!.data)) : null;
  const textureFile = group?.breft ? safe(() => parseBREFT(group.breft!.data)) : null;
  const [selection, setSelection] = React.useState<Selection>(null);
  const [onlySelected, setOnlySelected] = React.useState(false);
  const [textureDirty, setTextureDirty] = React.useState(false);
  const emitter = selection?.kind === "emitter" ? effect?.emitters.find((e: any) => e.name === selection.name) : null;
  const texture = selection?.kind === "texture" ? textureFile?.textures.find((t: any) => t.name === selection.name) : null;
  const columns = useColumnWidths(workspace ? "effects-workspace" : "effects", workspace ? [200, 230, 220] : [230, 220]);
  const shift = workspace ? 1 : 0;

  React.useEffect(() => {
    if (selection) return;
    if (effect?.emitters[0]) setSelection({ kind: "emitter", name: effect.emitters[0].name });
    else if (textureFile?.textures[0]) setSelection({ kind: "texture", name: textureFile.textures[0].name });
  }, [groupKey, !!effect, !!textureFile, archivePath]);

  const apply = (path: string, next: Uint8Array) => {
    if (archiveTree) { onChange?.(path, next); refresh(); }
    else if (loadedTree) { const target = listFiles(loadedTree).find((f: any) => f.path === path); if (target) target.node.data = next; refresh(); }
    else editor.doc.changeArchiveFile(`Edit effect file ${path.split("/").pop()}`, path, next);
  };
  const history = useEditHistory(apply);
  const [saving, setSaving] = React.useState(false);
  const saveLoaded = async () => {
    if (!loaded) return false;
    try {
      await api.writeFile(loaded.path, buildU8(loaded.tree), { backup: editor.settings.keepBackups, edited: true, compress: loaded.compressed ? "yaz0" : null });
      toast.success(`${sourceName} saved`, { description: editor.settings.keepBackups ? "The original is kept as a .bak file." : undefined });
      return true;
    } catch (e: any) { toast.error("Could not save the archive", { description: e.message }); return false; }
  };
  const save = async () => {
    if (textureDirty) { toast.error("Save or discard the texture strokes first"); return; }
    if (saving) return;
    setSaving(true);
    try { if ((await (archiveTree ? onSave?.() : loadedTree ? saveLoaded() : editor.save())) !== false) history.saved(); } finally { setSaving(false); }
  };

  // Workspace: the archives holding effects, from the backend's archive index (cached between runs).
  const selectArchive = async (path: string) => {
    if (path === archivePath) return;
    if (history.unsaved && !(await dialogs.confirm({ title: "Unsaved effects", description: `Discard the changes in ${sourceName}?`, confirmLabel: "Discard changes", destructive: true }))) return;
    if (!(await confirmTexture())) return;
    setTextureDirty(false);
    history.reset();
    setGroupKey(""); setSelection(null);
    if (isOpenTrack(path)) { setLoaded(null); setArchivePath(path); return; }
    setLoading(`Opening ${fileName(path)}…`);
    try {
      const file = await api.readPath(path);
      const bytes = await api.decodeArchiveBytes(file.data, path, editor.commonPath || editor.partsFolder());
      setLoaded({ path, tree: parseU8(bytes), compressed: !isU8(file.data) });
      setArchivePath(path);
    } catch (e: any) { toast.error(`Could not open ${path}`, { description: e.message }); }
    finally { setLoading(""); }
  };
  React.useEffect(() => {
    if (!workspace) return;
    let cancelled = false;
    (async () => {
      const folders = [["Race", "Course"], ["Race"], ["Race", "Competition", "CommonObj"], ["Demo"]];
      const found: { path: string; name: string; folder: string; count: number }[] = [];
      for (const parts of folders) {
        const folder = editor.workspacePath(...parts);
        if (!folder || cancelled) continue;
        setLoading(`Looking for effects in ${parts.join("/")}… (slow only the first time)`);
        try {
          const index = await api.archiveIndex(folder);
          for (const a of index.archives) {
            const count = a.files.filter((f: string) => /[.]breff$/i.test(f)).length;
            if (count) found.push({ path: winPath(folder, a.name), name: a.name, folder: parts.join("/"), count });
          }
        } catch { /* folder missing */ }
      }
      if (cancelled) return;
      setArchives(found);
      setLoading("");
      const first = found.find((a) => isOpenTrack(a.path)) || found[0];
      if (first) await selectArchive(first.path);
    })();
    return () => { cancelled = true; };
  }, []);
  // While a texture is painted, its painter has the shortcuts (its own strokes and Save texture).
  useHistoryKeys(history, () => void save(), selection?.kind !== "texture");
  const archiveMode = !!archiveTree || !!loadedTree;
  const confirmTexture = async () => !textureDirty || dialogs.confirm({ title: "Unsaved texture", description: "The painted strokes have not been saved. Discard them?", confirmLabel: "Discard strokes", destructive: true });
  const choose = async (next: Selection, nextGroup?: string) => {
    if ((nextGroup === undefined || nextGroup === groupKey) && next?.kind === selection?.kind && next?.name === selection?.name) return;
    if (!(await confirmTexture())) return;
    setTextureDirty(false);
    if (nextGroup !== undefined) setGroupKey(nextGroup);
    setSelection(next);
  };
  const requestClose = async () => {
    if (!(await confirmTexture())) return;
    if (archiveMode && history.unsaved && !(await dialogs.confirm({ title: "Unsaved effects", description: `The changes in ${sourceName} have not been saved. Close and discard them?`, confirmLabel: "Discard changes", destructive: true }))) return;
    close(true);
  };
  const write = (file: FileRef, next: Uint8Array, label: string) => history.record(file.path, file.data, next, label);
  const setValue = (groupName: "emitter" | "particle", key: string, value: any) => {
    if (!group?.breff || !emitter) return;
    try { write(group.breff, setBREFFValue(group.breff.data, emitter.name, groupName, key, value), `Edit effect ${emitter.name}`); }
    catch (e: any) { toast.error("Could not change the effect", { description: e.message }); }
  };
  const decode = React.useCallback((bytes: Uint8Array, name: string) => {
    const tex = parseBREFT(bytes).textures.find((t: any) => t.name === name);
    const pixels = tex && decodeBREFTTexture(bytes, tex);
    return tex && pixels ? { width: tex.width, height: tex.height, format: tex.format, pixels: Uint8ClampedArray.from(pixels) } : null;
  }, []);
  const stagedTexture = React.useMemo(() => ({
    encode: (data: Uint8Array, pixels: Uint8ClampedArray) => replaceBREFTTexture(data, texture?.name || "", pixels),
    save: (data: Uint8Array) => { if (group?.breft && texture) write(group.breft, data, `Paint effect texture ${texture.name}`); },
  }), [group?.breft?.path, texture?.name, history]);
  const noPreview = React.useCallback(() => {}, []);

  const field = (groupName: "emitter" | "particle", f: any, value: any) => (
    <div key={f.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] items-center gap-2">
      <label className="truncate text-[11px] text-muted-foreground" title={f.hint || f.label}>{f.label}</label>
      {f.type === "rgba" ? (
        <div className="flex items-center gap-1.5">
          <ColorInput label={f.label} value={hex(value)}
            onCommit={(v) => setValue(groupName, f.key, [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16), value[3]])} />
          <span className="text-[10px] text-muted-foreground">Alpha</span>
          <NumberInput label={`${f.label} alpha`} integer min={0} max={255} value={value[3]} onCommit={(a) => setValue(groupName, f.key, [...value.slice(0, 3), a])} />
        </div>
      ) : Array.isArray(value) ? (
        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${value.length}, minmax(0, 1fr))` }}>
          {value.map((v: number, i: number) => <NumberInput key={i} label={`${f.label} ${"XYZ"[i]}`} value={v}
            onCommit={(n) => setValue(groupName, f.key, value.map((x: number, j: number) => j === i ? n : x))} />)}
        </div>
      ) : <NumberInput label={f.label} value={value} integer={f.type !== "f32"} min={TYPE_LIMITS[f.type]?.[0]} max={TYPE_LIMITS[f.type]?.[1]} onCommit={(n) => setValue(groupName, f.key, n)} />}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <Button size="icon-sm" variant="ghost" className="absolute right-3 top-3" title="Close" aria-label="Close effects editor" onClick={requestClose}><X /></Button>
      <div className="shrink-0 pr-8">
        <DialogTitle className="flex items-center gap-2 text-sm"><Sparkles className="size-4" /> Effects{sourceName ? ` · ${sourceName}` : ""}</DialogTitle>
        <DialogDescription className="text-xs">
          Particle effects (BREFF) and their textures (BREFT){workspace ? " of every archive in the game folder" : ""}. A value changes when its field loses focus or Enter is pressed; Undo and Redo step through the changes, Save writes {sourceName || "the archive"}.
        </DialogDescription>
      </div>
      {loading && <div className="shrink-0 text-[11px] text-muted-foreground">{loading}</div>}
      {workspace && archives && !archives.length ? <p className="text-xs text-muted-foreground">No archive of the game folder holds effect files. Choose the game folder on the Home screen.</p>
      : !workspace && !groups.length ? <p className="text-xs text-muted-foreground">This archive has no effect files (.breff / .breft).</p> : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 sm:gap-0 sm:[grid-template-columns:var(--columns)]" style={{ "--columns": columns.template } as React.CSSProperties}>
          {workspace && <>
            <div className="flex min-h-0 max-h-40 flex-col border sm:max-h-none">
              <div className="shrink-0 border-b px-2 py-2 text-[11px] text-muted-foreground">{archives ? `${archives.length} archives with effects` : "Archives"}</div>
              <div className="min-h-0 flex-1 overflow-y-auto p-1">{(archives || []).map((a) => (
                <button key={a.path} onClick={() => void selectArchive(a.path)} title={a.path} disabled={!!loading}
                  className={cn("block w-full cursor-pointer rounded border border-transparent px-2 py-1.5 text-left text-xs hover:bg-accent disabled:cursor-wait", a.path === archivePath && "border-primary/60 bg-accent")}>
                  <span className="block truncate font-medium">{a.name}</span>
                  <span className="block truncate text-[10.5px] text-muted-foreground">{a.folder} · {a.count} effect{a.count === 1 ? "" : "s"}{isOpenTrack(a.path) ? " · open in the editor" : ""}</span>
                </button>))}</div>
            </div>
            <ColumnHandle label="Resize the archive list" onResize={(d) => columns.resize(0, d)} onReset={columns.reset} />
          </>}
          <div className="flex min-h-0 max-h-40 flex-col border sm:max-h-none">
            <div className="shrink-0 border-b px-2 py-2 text-[11px] text-muted-foreground">{groups.length} effect{groups.length === 1 ? "" : "s"}</div>
            <div className="min-h-0 flex-1 overflow-y-auto p-1">{groups.map((g) => (
              <button key={g.key} onClick={() => void choose(null, g.key)} title={g.label}
                className={cn("block w-full cursor-pointer rounded border border-transparent px-2 py-1.5 text-left text-xs hover:bg-accent", g.key === group?.key && "border-primary/60 bg-accent")}>
                <span className="block truncate font-medium">{g.label.split("/").pop()}</span>
                <span className="block truncate text-[10.5px] text-muted-foreground">{g.label}{g.breff ? " · BREFF" : ""}{g.breft ? " · BREFT" : ""}</span>
              </button>))}</div>
          </div>
          <ColumnHandle label="Resize the effect list" onResize={(d) => columns.resize(shift, d)} onReset={columns.reset} />
          <div className="flex min-h-0 max-h-48 flex-col border sm:max-h-none">
            <div className="min-h-0 flex-1 overflow-y-auto p-1">
              <div className="px-1 py-1 text-[11px] text-muted-foreground">{effect ? `${effect.emitters.length} emitters` : "No BREFF"}</div>
              {effect?.emitters.map((e: any) => (
                <button key={e.name} onClick={() => void choose({ kind: "emitter", name: e.name })} title={e.name}
                  className={cn("flex w-full cursor-pointer items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs hover:bg-accent", selection?.kind === "emitter" && selection.name === e.name && "bg-accent")}>
                  <Sparkles className="size-3.5 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{e.name}</span>
                </button>))}
              <div className="mt-2 px-1 py-1 text-[11px] text-muted-foreground">{textureFile ? `${textureFile.textures.length} textures` : "No BREFT"}</div>
              {textureFile?.textures.map((t: any) => (
                <button key={t.name} onClick={() => void choose({ kind: "texture", name: t.name })} title={`${t.name} · ${t.width}×${t.height} · ${TEXTURE_FORMATS[t.format] || t.format}`}
                  className={cn("flex w-full cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-left text-xs hover:bg-accent", selection?.kind === "texture" && selection.name === t.name && "bg-accent")}>
                  <Thumb data={group!.breft!.data} tex={t} className="size-6 shrink-0 rounded-sm" />
                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{t.width}×{t.height}</span>
                </button>))}
            </div>
          </div>
          <ColumnHandle label="Resize the emitter list" onResize={(d) => columns.resize(1 + shift, d)} onReset={columns.reset} />
          <div className="min-h-0 overflow-y-auto sm:pl-1">
            {emitter ? (
              <div className="space-y-4 text-xs">
                <div className="space-y-1.5">
                  <EffectViewer effect={effect} textureFile={textureFile} breff={group?.breff?.data} breft={group?.breft?.data} only={onlySelected ? emitter.name : undefined} />
                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                    <label className="flex cursor-pointer items-center gap-1.5"><input type="checkbox" className="accent-primary" checked={onlySelected} onChange={(e) => setOnlySelected(e.target.checked)} /> Only {emitter.name}</label>
                    <span>Approximate preview: curves and game events are not simulated; one-shot effects repeat.</span>
                  </div>
                </div>
                <div className="font-medium">{emitter.name}</div>
                <section className="space-y-1.5">
                  <h3 className="text-[11px] font-semibold text-muted-foreground">Emitter</h3>
                  {EMITTER_FIELDS.map((f: any) => field("emitter", f, emitter.values.emitter[f.key]))}
                </section>
                <section className="space-y-1.5">
                  <h3 className="text-[11px] font-semibold text-muted-foreground">Particles</h3>
                  {PARTICLE_FIELDS.map((f: any) => field("particle", f, emitter.values.particle[f.key]))}
                </section>
                <section className="space-y-1.5">
                  <h3 className="text-[11px] font-semibold text-muted-foreground">Textures</h3>
                  {!emitter.textures.length && <p className="text-muted-foreground">This emitter draws no texture.</p>}
                  <div className="flex flex-wrap gap-2">{emitter.textures.map((name: string) => {
                    const t = textureFile?.textures.find((x: any) => x.name === name);
                    return <button key={name} onClick={() => t && void choose({ kind: "texture", name })} disabled={!t} title={t ? `Edit ${name}` : `${name} is not in this effect's BREFT`}
                      className="flex cursor-pointer flex-col items-center gap-1 rounded border p-1.5 hover:bg-accent disabled:cursor-default disabled:opacity-60">
                      {t ? <Thumb data={group!.breft!.data} tex={t} className="size-16" /> : <ImageIcon className="size-16 p-4 text-muted-foreground" />}
                      <span className="max-w-24 truncate text-[10.5px]">{name}</span>
                    </button>;
                  })}</div>
                </section>
              </div>
            ) : texture && group?.breft ? (
              breftTextureSupported(texture)
                ? <div className="flex h-full min-h-[420px] flex-col"><TexturePainter key={`${group.key}:${texture.name}`} name={texture.name} bytes={group.breft.data} tall decode={decode}
                    originalKey={`${(workspace && archivePath) || archiveName || editor.doc.filePath || editor.doc.fileName}:${group.breft.path}:${texture.name}`} onPreview={noPreview} staged={stagedTexture} onDirtyChange={setTextureDirty} /></div>
                : <p className="text-xs text-muted-foreground">{texture.name} uses a palette format ({TEXTURE_FORMATS[texture.format] || texture.format}) that cannot be painted yet.</p>
            ) : <div className="grid h-full place-items-center text-xs text-muted-foreground"><span className="flex items-center gap-1.5"><Paintbrush className="size-3.5" /> Choose an emitter or a texture.</span></div>}
          </div>
        </div>
      )}
      {!!groups.length && <HistoryBar history={history} onSave={() => void save()} saving={saving} saveLabel={archiveTree || loadedTree ? `Save ${sourceName}` : "Save track"} />}
    </div>
  );
}
