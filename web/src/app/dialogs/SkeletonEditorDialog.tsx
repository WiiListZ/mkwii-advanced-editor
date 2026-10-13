// Skeleton editor for a BRRES model: the bone hierarchy, the rest position, rotation and scale of
// each bone, and a 3D preview with the bones drawn and the selected one marked.
// The edits change the rest pose (inverse bind matrices and animations keep working, see brres-bones.js).

import * as React from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Bone, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { parseBRRES } from "../../../js/formats/brres.js";
import { BrresModelBuilder } from "../../../js/editor/brresmodel.js";
import { setBRRESBoneRestTransform } from "../../../js/editor/brres-bones.js";
import { NumberInput } from "./EffectsDialog";
import { ColumnHandle, useColumnWidths } from "../resizable";
import { useEditHistory, useHistoryKeys } from "../edit-history";
import { Redo2, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";

function SkeletonPreview({ brres, model, selected, showModel }: { brres: any; model: any; selected: number; showModel: boolean }) {
  const host = React.useRef<HTMLDivElement>(null);
  const state = React.useRef<any>(null);
  React.useEffect(() => {
    const el = host.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch { return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x11151c);
    el.append(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.7); sun.position.set(1, 2, 1.5); scene.add(sun);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1e7);
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
    const resize = () => { const w = el.clientWidth || 1, h = el.clientHeight || 1; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
    const observer = new ResizeObserver(resize); observer.observe(el); resize();
    let frame = 0;
    const tick = () => { frame = requestAnimationFrame(tick); controls.update(); state.current?.marker?.update?.(); renderer.render(scene, camera); };
    tick();
    state.current = { scene, camera, controls, group: null, helper: null, marker: null, framed: "" };
    return () => { cancelAnimationFrame(frame); observer.disconnect(); controls.dispose(); renderer.dispose(); renderer.domElement.remove(); state.current = null; };
  }, []);
  React.useEffect(() => {
    const st = state.current;
    if (!st) return;
    for (const key of ["group", "helper", "marker"]) if (st[key]) { st.scene.remove(st[key]); st[key] = null; }
    if (!model) return;
    try {
      const group = new BrresModelBuilder(brres).build(model, { skinned: true, lit: null });
      group.traverse((o: any) => { if (o.isMesh) o.visible = showModel; });
      st.scene.add(group); st.group = group;
      // Bones and the marker are drawn last and over the model (the game shaders ignore transparency).
      const helper = new THREE.SkeletonHelper(group);
      Object.assign(helper.material as any, { depthTest: false, depthWrite: false, transparent: true });
      helper.renderOrder = 60;
      st.scene.add(helper); st.helper = helper;
      group.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(group);
      const radius = box.isEmpty() ? 50 : Math.max(box.getSize(new THREE.Vector3()).length() / 2, 10);
      const bone = model.bones[selected] && group.getObjectByName(model.bones[selected].name);
      if (bone) {
        const marker = new THREE.Group();
        const ball = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.045, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffb020 }));
        marker.add(ball, new THREE.AxesHelper(radius * 0.4));
        marker.traverse((o: any) => { if (o.material) { Object.assign(o.material, { depthTest: false, depthWrite: false, transparent: true }); o.renderOrder = 70; } });
        (marker as any).update = () => { bone.updateMatrixWorld(true); bone.getWorldPosition(marker.position); bone.getWorldQuaternion(marker.quaternion); };
        (marker as any).update();
        st.scene.add(marker); st.marker = marker;
      }
      // Frame once per model, so editing a bone does not move the camera.
      if (st.framed !== model.name && !box.isEmpty()) {
        st.framed = model.name;
        const center = box.getCenter(new THREE.Vector3());
        st.controls.target.copy(center);
        st.camera.position.copy(center).add(new THREE.Vector3(0.9, 0.6, 1).normalize().multiplyScalar(radius * 2.4));
        st.camera.near = Math.max(0.1, radius / 200); st.camera.far = radius * 400; st.camera.updateProjectionMatrix();
      }
    } catch (error) { console.warn("Skeleton preview failed", error); }
  }, [brres, model, selected, showModel]);
  return <div ref={host} className="relative min-h-56 flex-1 overflow-hidden rounded border [&>canvas]:size-full" title="Drag to turn, wheel to zoom" />;
}

export function SkeletonEditorDialog({ bytes: initialBytes, modelName, resourceName, onCommit, close }: {
  bytes: Uint8Array; modelName: string; resourceName: string;
  onCommit: (next: Uint8Array) => void;
  close: (value: any) => void;
}) {
  const [bytes, setBytes] = React.useState(initialBytes);
  const brres = React.useMemo(() => { try { return parseBRRES(bytes); } catch { return null; } }, [bytes]);
  const model = brres?.models.find((m: any) => m.name === modelName) || null;
  const bones: any[] = model?.bones || [];
  const [selected, setSelected] = React.useState(0);
  const [query, setQuery] = React.useState("");
  const [showModel, setShowModel] = React.useState(true);
  const columns = useColumnWidths("skeleton", [240]);
  const history = useEditHistory((_path, next) => { setBytes(next); onCommit(next); });
  useHistoryKeys(history, () => {});
  const bone = bones[selected];
  const depth = (index: number) => { let d = 0; for (let p = bones[index]?.parent; p >= 0 && d < 64; p = bones[p]?.parent) d++; return d; };
  const children = (index: number) => bones.filter((b) => b.parent === index).length;
  const edit = (key: "trans" | "rot" | "scale", axis: number, value: number) => {
    if (!bone) return;
    const values = bone[key].slice(); values[axis] = value;
    try {
      const next = setBRRESBoneRestTransform(bytes, modelName, selected, { [key]: values });
      if (next !== bytes) history.record("bones", bytes, next, `${bone.name}: ${{ trans: "position", rot: "rotation", scale: "scale" }[key]} ${"XYZ"[axis]}`);
    } catch (e: any) { toast.error("Could not change the bone", { description: e.message }); }
  };
  const q = query.trim().toLowerCase();

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 items-start justify-between gap-2">
        <div>
          <DialogTitle className="flex items-center gap-2 text-sm"><Bone className="size-4" /> Skeleton · {modelName}</DialogTitle>
          <DialogDescription className="text-xs">{resourceName}. Change the rest position, rotation and scale of each bone; the parts that follow a bone move with it, and the animations keep working.</DialogDescription>
        </div>
        <Button size="icon" variant="ghost" title="Close" aria-label="Close skeleton editor" onClick={() => close(true)}><X /></Button>
      </div>
      {!model ? <p className="text-xs text-destructive">The model could not be read.</p> : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 sm:gap-0 sm:[grid-template-columns:var(--columns)]" style={{ "--columns": columns.template } as React.CSSProperties}>
          <div className="flex min-h-0 max-h-48 flex-col border sm:max-h-none">
            <div className="relative shrink-0 border-b p-1"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input aria-label="Find a bone" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder={`Find among ${bones.length} bones`} className="h-7 pl-7 text-xs" /></div>
            <div className="min-h-0 flex-1 overflow-y-auto p-1">{bones.map((b, i) => (!q || b.name.toLowerCase().includes(q)) && (
              <button key={i} onClick={() => setSelected(i)} title={b.parent >= 0 ? `${b.name} (child of ${bones[b.parent]?.name})` : b.name}
                className={cn("flex w-full cursor-pointer items-center gap-1.5 rounded py-1 pr-2 text-left text-xs hover:bg-accent", i === selected && "bg-accent")}
                style={{ paddingLeft: `${8 + (q ? 0 : depth(i)) * 12}px` }}>
                <Bone className="size-3 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{b.name}</span>
                {children(i) > 0 && <span className="text-[10px] text-muted-foreground">{children(i)}</span>}
              </button>))}</div>
          </div>
          <ColumnHandle label="Resize the bone list" onResize={(d) => columns.resize(0, d)} onReset={columns.reset} />
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto sm:pl-2">
            <SkeletonPreview brres={brres} model={model} selected={selected} showModel={showModel} />
            <label className="-mt-1 flex shrink-0 cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground"><input type="checkbox" className="accent-primary" checked={showModel} onChange={(e) => setShowModel(e.target.checked)} /> Show the model (bones and the selected bone, in orange with its axes, are always drawn on top)</label>
            {bone && <div className="shrink-0 space-y-2 text-xs">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">{bone.name}</span>
                <span className="text-[11px] text-muted-foreground">{bone.parent >= 0 ? `Child of ${bones[bone.parent]?.name}` : "Root bone"} · {children(selected)} child bone{children(selected) === 1 ? "" : "s"} · index {selected}</span>
              </div>
              {([ ["trans", "Position", "Offset from the parent bone, in model units."], ["rot", "Rotation (degrees)", "Turn around X, Y and Z, applied Z then Y then X like the game."], ["scale", "Scale", "Size multiplier on each axis (1 = unchanged)."] ] as const).map(([key, label, help]) => (
                <div key={key} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] items-center gap-2">
                  <div><div>{label}</div><div className="text-[10.5px] text-muted-foreground">{help}</div></div>
                  <div className="grid grid-cols-3 gap-1">{[0, 1, 2].map((axis) =>
                    <NumberInput key={axis} label={`${bone.name} ${label} ${"XYZ"[axis]}`} value={bone[key][axis]} onCommit={(n) => edit(key, axis, n)} />)}</div>
                </div>
              ))}
            </div>}
          </div>
        </div>
      )}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t pt-2">
        <Button size="sm" variant="ghost" disabled={!history.canUndo} onClick={history.undo} title={history.undoLabel ? `Undo: ${history.undoLabel} (Ctrl+Z)` : "Nothing to undo"}><Undo2 /> Undo</Button>
        <Button size="sm" variant="ghost" disabled={!history.canRedo} onClick={history.redo} title={history.redoLabel ? `Redo: ${history.redoLabel} (Ctrl+Y)` : "Nothing to redo"}><Redo2 /> Redo</Button>
        <span className="ml-auto text-[11px] text-muted-foreground">The bones change in the resource; Save in Characters and models writes the archive.</span>
        <Button size="sm" onClick={() => close(true)}>Done</Button>
      </div>
    </div>
  );
}
