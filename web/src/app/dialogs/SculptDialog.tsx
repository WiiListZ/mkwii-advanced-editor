// Beta: shape the track model's terrain with a brush. The model is drawn plain, so that the shape is
// what shows. Nothing reaches the track until Apply; collision can follow the same strokes.

import * as React from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Redo2, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { readSculptModel, sculptCollision, sculptPositions, writeSculptModel } from "../../../js/editor/model-sculpt.js";
import { buildKCL, parseKCL } from "../../../js/formats/kcl.js";
import { findFile } from "../../../js/formats/u8.js";
import { dialogs } from "../dialogs-store";
import { useHistoryKeys } from "../edit-history";
import { editor } from "../editor";

type Mode = "raise" | "lower" | "flatten" | "smooth";
const MODES: [Mode, string, string][] = [["raise", "Raise", "Lift the ground under the brush"], ["lower", "Lower", "Push the ground down"], ["flatten", "Flatten", "Bring it to the height where the stroke began"], ["smooth", "Smooth", "Even out bumps"]];
const MAX_HISTORY = 30;

export function SculptDialog({ close }: { close: (value: any) => void }) {
  const node = editor.doc.szs ? findFile(editor.doc.szs, "course_model.brres") : null;
  const [mode, setMode] = React.useState<Mode>("raise");
  const [radius, setRadius] = React.useState(3000);
  const [strength, setStrength] = React.useState(40);
  const [withCollision, setWithCollision] = React.useState(true);
  const [dirty, setDirty] = React.useState(false);
  const [, repaint] = React.useReducer((n) => n + 1, 0);
  const host = React.useRef<HTMLDivElement>(null);
  const state = React.useRef<any>(null);
  const settings = React.useRef({ mode, radius, strength, withCollision });
  settings.current = { mode, radius, strength, withCollision };
  const past = React.useRef<any[]>([]), future = React.useRef<any[]>([]);

  const sculpt = React.useMemo(() => { try { return node ? readSculptModel(node.data) : null; } catch { return null; } }, []);
  const collision = React.useMemo(() => editor.doc.kcl ? editor.doc.kcl.verts.slice() : null, []);
  const snapshot = () => ({ arrays: [...sculpt.arrays].map(([id, a]: any) => [id, a.positions.slice()]), collision: collision?.slice() || null });
  const restore = (step: any) => {
    for (const [id, positions] of step.arrays) sculpt.arrays.get(id).positions.set(positions);
    if (collision && step.collision) collision.set(step.collision);
    state.current?.refresh(true);
  };
  const undo = () => { const step = past.current.pop(); if (!step) return; future.current.push(snapshot()); restore(step); setDirty(past.current.length > 0); repaint(); };
  const redo = () => { const step = future.current.pop(); if (!step) return; past.current.push(snapshot()); restore(step); setDirty(true); repaint(); };
  useHistoryKeys({ undo, redo } as any, () => { void apply(); });

  React.useEffect(() => {
    const el = host.current!;
    if (!sculpt) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch { return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.setClearColor(0x11151c);
    el.append(renderer.domElement);
    renderer.domElement.style.display = "block";
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, .9));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(.6, 1, .4);
    scene.add(sun);
    const corners: Int32Array = sculpt.corners, count = corners.length / 2;
    const flat = new Float32Array(count * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(flat, 3));
    const refresh = (normals: boolean) => {
      for (let i = 0; i < count; i++) {
        const positions = sculpt.arrays.get(corners[i * 2]).positions, id = corners[i * 2 + 1];
        flat[i * 3] = positions[id * 3]; flat[i * 3 + 1] = positions[id * 3 + 1]; flat[i * 3 + 2] = positions[id * 3 + 2];
      }
      geometry.attributes.position.needsUpdate = true;
      if (normals) { geometry.computeVertexNormals(); geometry.computeBoundingSphere(); geometry.computeBoundingBox(); }
    };
    refresh(true);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color: 0x9aa6ad, side: THREE.DoubleSide }));
    scene.add(mesh);
    const camera = new THREE.PerspectiveCamera(50, 1, 10, 2e6);
    const { center, radius: size } = geometry.boundingSphere!;
    camera.position.set(center.x + size * .3, center.y + size * .9, center.z + size * .9);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(center);
    controls.enableDamping = true;
    // Left paints, as in the other brushes; right turns the view and middle moves it.
    controls.mouseButtons = { LEFT: null as any, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 48 }, (_, i) => new THREE.Vector3(Math.cos(i / 48 * Math.PI * 2), 0, Math.sin(i / 48 * Math.PI * 2)))), new THREE.LineBasicMaterial({ color: 0xfacc15, depthTest: false, transparent: true }));
    ring.visible = false;
    ring.renderOrder = 10;
    scene.add(ring);
    let width = 0, height = 0;
    const resize = () => {
      const w = el.clientWidth || 1, h = el.clientHeight || 1;
      if (w === width && h === height) return;
      width = w; height = h;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%"; renderer.domElement.style.height = "100%";
      camera.aspect = w / h; camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    let frame = 0;
    const loop = () => { frame = requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); };
    loop();

    const ray = new THREE.Raycaster(), pointer = new THREE.Vector2();
    const hit = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(pointer, camera);
      return ray.intersectObject(mesh, false)[0]?.point || null;
    };
    let stroke: { height: number; pending: any } | null = null;
    const dab = (point: THREE.Vector3) => {
      const { mode: brush, radius: size, strength: force, withCollision: follow } = settings.current;
      const target = [point.x, brush === "flatten" ? stroke!.height : point.y, point.z];
      const options = { mode: brush, radius: size, strength: force };
      let moved = 0;
      for (const array of sculpt.arrays.values()) moved += sculptPositions(array.positions, target, options);
      if (follow && collision) sculptCollision(collision, target, options);
      if (moved) { if (stroke?.pending) { past.current = [...past.current.slice(-(MAX_HISTORY - 1)), stroke.pending]; future.current = []; stroke.pending = null; setDirty(true); repaint(); } refresh(false); }
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const point = hit(e);
      if (!point) return;
      renderer.domElement.setPointerCapture(e.pointerId);
      stroke = { height: point.y, pending: snapshot() };
      dab(point);
    };
    const move = (e: PointerEvent) => {
      const point = hit(e);
      ring.visible = !!point;
      if (point) { ring.position.copy(point); ring.position.y += 5; ring.scale.setScalar(settings.current.radius); }
      if (stroke && point) dab(point);
    };
    const up = () => { if (!stroke) return; stroke = null; refresh(true); };
    const canvas = renderer.domElement;
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    state.current = { refresh, camera, canvas, mesh };
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); controls.dispose();
      canvas.removeEventListener("pointerdown", down); canvas.removeEventListener("pointermove", move); canvas.removeEventListener("pointerup", up); canvas.removeEventListener("pointercancel", up);
      geometry.dispose(); renderer.dispose(); canvas.remove(); state.current = null;
    };
  }, []);

  const apply = async () => {
    if (!dirty || !node) return;
    try {
      const next = writeSculptModel(node.data, sculpt);
      // Validate before anything changes: a collision that cannot be built leaves the track as it was.
      const kcl = withCollision && collision ? parseKCL(buildKCL(collision, editor.doc.kcl.flags)) : null;
      editor.doc.changeArchiveFile("Sculpt the track model", "course_model.brres", next);
      if (kcl) editor.doc.change("Sculpt the collision", () => { editor.doc.setKCL(kcl, true); }, { structural: false });
      toast.success("Track model sculpted", { description: "Save the SZS to keep it." });
      close(true);
    } catch (e: any) { toast.error("Could not apply the sculpting", { description: e.message }); }
  };
  const leave = async () => {
    if (dirty && !await dialogs.confirm({ title: "Discard the sculpting?", description: "These changes have not been applied to the track.", confirmLabel: "Discard", destructive: true })) return;
    close(null);
  };

  return <div className="flex h-full min-h-0 flex-col gap-3">
    <div className="flex shrink-0 items-start gap-2">
      <div className="min-w-0 flex-1">
        <DialogTitle className="text-sm">Sculpt the track model (beta)</DialogTitle>
        <DialogDescription className="text-xs">Left-drag shapes the model · right-drag turns the view · middle-drag moves it · wheel zooms.</DialogDescription>
      </div>
      <Button size="icon-sm" variant="ghost" title="Close" aria-label="Close sculpting" onClick={leave}><X /></Button>
    </div>
    <div className="flex shrink-0 flex-wrap items-center gap-1">
      {MODES.map(([id, text, title]) => <Button key={id} size="sm" variant={mode === id ? "secondary" : "ghost"} className="h-8 px-2.5 text-xs" title={title} aria-pressed={mode === id} onClick={() => setMode(id)}>{text}</Button>)}
      <label className="flex items-center gap-1.5 px-2 text-[11px] text-muted-foreground">Size<input type="range" aria-label="Brush size" min={200} max={20000} step={100} value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="w-24" /></label>
      <label className="flex items-center gap-1.5 px-2 text-[11px] text-muted-foreground">Strength<input type="range" aria-label="Brush strength" min={5} max={200} step={5} value={strength} onChange={(e) => setStrength(Number(e.target.value))} className="w-24" /></label>
      <Button size="icon-sm" variant="ghost" disabled={!past.current.length} onClick={undo} title="Undo (Ctrl+Z)" aria-label="Undo"><Undo2 /></Button>
      <Button size="icon-sm" variant="ghost" disabled={!future.current.length} onClick={redo} title="Redo (Ctrl+Y)" aria-label="Redo"><Redo2 /></Button>
      <label className="ml-auto flex cursor-pointer items-center gap-1.5 px-1 text-[11px] text-muted-foreground" title="Karts drive on the collision, not on the model: without this they would drive on the old ground">
        <input type="checkbox" checked={withCollision} disabled={!collision} onChange={(e) => setWithCollision(e.target.checked)} aria-label="Also move the collision" /> Also move the collision
      </label>
    </div>
    <div ref={host} className="relative min-h-0 flex-1 bg-[#11151c]" data-sculpt>
      {!sculpt && <p className="p-3 text-xs text-muted-foreground">This track has no course_model.brres to sculpt.</p>}
    </div>
    <div className="flex shrink-0 items-center justify-end gap-2">
      <span className="mr-auto text-[11px] text-muted-foreground">{sculpt?.skipped ? `${sculpt.skipped} part${sculpt.skipped === 1 ? " moves" : "s move"} with a bone and cannot be sculpted. ` : ""}Heights only: this cannot make overhangs.</span>
      <Button variant="ghost" onClick={leave}>Cancel</Button>
      <Button disabled={!dirty} onClick={apply}>Apply</Button>
    </div>
  </div>;
}
