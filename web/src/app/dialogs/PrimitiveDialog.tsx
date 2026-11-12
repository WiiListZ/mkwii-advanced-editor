// Beta: adds a primitive shape to the track model, deformed within limits, optionally with collision.

import * as React from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { buildPrimitive, PRIMITIVE_DEFAULTS, PRIMITIVE_MAX_TRIANGLES, PRIMITIVE_SHAPES } from "../../../js/editor/primitives.js";
import { editor } from "../editor";

type Field = { key: string; label: string; min: number; max: number; step: number; shapes?: string[] };
const SIZE: Field[] = [
  { key: "width", label: "Width", min: 100, max: 40000, step: 100 },
  { key: "height", label: "Height", min: 100, max: 40000, step: 100 },
  { key: "depth", label: "Depth", min: 100, max: 40000, step: 100 },
];
const ROUND = ["cylinder", "cone", "sphere", "torus"];
const SHAPE: Field[] = [
  { key: "sides", label: "Sides", min: 3, max: 64, step: 1, shapes: ROUND },
  { key: "slices", label: "Detail", min: 1, max: 48, step: 1 },
  { key: "steps", label: "Steps", min: 2, max: 32, step: 1, shapes: ["stairs"] },
  { key: "arc", label: "Part of the turn (°)", min: 10, max: 360, step: 5, shapes: ["cylinder", "cone"] },
  { key: "hollow", label: "Hollow", min: 0, max: .95, step: .01, shapes: ["cylinder"] },
  { key: "ring", label: "Ring thickness", min: .02, max: .49, step: .01, shapes: ["torus"] },
];
const DEFORM: Field[] = [
  { key: "taperX", label: "Top width ×", min: 0, max: 4, step: .05 },
  { key: "taperZ", label: "Top depth ×", min: 0, max: 4, step: .05 },
  { key: "twist", label: "Twist (°)", min: -720, max: 720, step: 5 },
  { key: "bend", label: "Bend (°)", min: -270, max: 270, step: 5 },
  { key: "shearX", label: "Lean sideways", min: -3, max: 3, step: .05 },
  { key: "shearZ", label: "Lean forward", min: -3, max: 3, step: .05 },
  { key: "bulge", label: "Bulge", min: -2, max: 2, step: .05 },
  { key: "roughness", label: "Roughness", min: 0, max: .5, step: .01 },
];
const COLLISIONS: [string, string][] = [["none", "None"], ["0", "Road"], ["3", "Off-road"], ["12", "Wall"], ["6", "Boost panel"], ["7", "Boost ramp"]];

function Slider({ field, value, onChange }: { field: Field; value: number; onChange: (value: number) => void }) {
  return <label className="flex items-center gap-2 text-xs">
    <span className="w-32 shrink-0 text-muted-foreground">{field.label}</span>
    <input type="range" aria-label={field.label} min={field.min} max={field.max} step={field.step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="min-w-0 flex-1" />
    <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">{Math.round(value * 100) / 100}</span>
  </label>;
}

export function PrimitiveDialog({ close }: { close: (value: any) => void }) {
  const [spec, setSpec] = React.useState<any>({ ...PRIMITIVE_DEFAULTS });
  const [color, setColor] = React.useState("#c8c8c8");
  const [collision, setCollision] = React.useState("none");
  const host = React.useRef<HTMLDivElement>(null), scene = React.useRef<any>(null);
  const [tris, error] = React.useMemo<[number[][], string]>(() => {
    try { return [buildPrimitive(spec), ""]; } catch (e: any) { return [[], e.message]; }
  }, [spec]);

  React.useEffect(() => {
    const el = host.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch { return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.setClearColor(0x11151c);
    el.append(renderer.domElement);
    renderer.domElement.style.display = "block";
    const world = new THREE.Scene();
    world.add(new THREE.AmbientLight(0xffffff, 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(1, 2, 1.5);
    world.add(sun);
    const grid = new THREE.GridHelper(20000, 20, 0x3a4252, 0x252b36);
    world.add(grid);
    const camera = new THREE.PerspectiveCamera(45, 1, 10, 1e6);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    let width = 0, height = 0;
    const resize = () => {
      const w = el.clientWidth || 1, h = el.clientHeight || 1;
      if (w === width && h === height) return;
      width = w; height = h;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%"; renderer.domElement.style.height = "100%";
      camera.aspect = w / h; camera.updateProjectionMatrix();
      renderer.render(world, camera);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    let frame = 0;
    const loop = () => { frame = requestAnimationFrame(loop); controls.update(); renderer.render(world, camera); };
    loop();
    scene.current = { world, camera, controls, mesh: null, framed: "" };
    return () => { cancelAnimationFrame(frame); observer.disconnect(); controls.dispose(); renderer.dispose(); renderer.domElement.remove(); scene.current = null; };
  }, []);

  React.useEffect(() => {
    const state = scene.current;
    if (!state) return;
    if (state.mesh) { state.world.remove(state.mesh); state.mesh.geometry.dispose(); state.mesh.material.dispose(); state.mesh = null; }
    if (!tris.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(Float32Array.from(tris.flat()), 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    state.mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color, flatShading: true }));
    state.world.add(state.mesh);
    const key = `${spec.shape}`;
    if (state.framed !== key) {
      state.framed = key;
      const { center, radius } = geometry.boundingSphere!;
      state.controls.target.copy(center);
      state.camera.position.set(center.x + radius * 1.8, center.y + radius * 1.3, center.z + radius * 2.2);
    }
  }, [tris, color]);

  const set = (key: string, value: any) => setSpec((current: any) => ({ ...current, [key]: value }));
  const visible = (field: Field) => !field.shapes || field.shapes.includes(spec.shape);
  const place = () => {
    close(true);
    void editor.addPrimitive(tris, color, collision === "none" ? null : Number(collision));
  };

  return <div className="flex h-full min-h-0 flex-col gap-3">
    <div className="flex shrink-0 items-start gap-2">
      <div className="min-w-0 flex-1">
        <DialogTitle className="text-sm">Add a primitive model (beta)</DialogTitle>
        <DialogDescription className="text-xs">Build a shape and place it on the track as part of its model. Ctrl+Z in the main window takes it away.</DialogDescription>
      </div>
      <Button size="icon-sm" variant="ghost" title="Close" aria-label="Close primitive editor" onClick={() => close(null)}><X /></Button>
    </div>
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_340px]">
      <div ref={host} className="relative min-h-[260px] bg-[#11151c]" data-primitive-preview />
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
        <div className="flex flex-wrap gap-1">
          {Object.entries(PRIMITIVE_SHAPES).map(([id, text]) => <Button key={id} size="sm" variant={spec.shape === id ? "secondary" : "ghost"} className="h-7 px-2 text-xs" aria-pressed={spec.shape === id} onClick={() => set("shape", id)}>{text as string}</Button>)}
        </div>
        <section className="flex flex-col gap-1.5">
          <div className="text-xs font-semibold">Size and shape</div>
          {[...SIZE, ...SHAPE].filter(visible).map((field) => <Slider key={field.key} field={field} value={spec[field.key]} onChange={(value) => set(field.key, value)} />)}
        </section>
        <section className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2"><span className="flex-1 text-xs font-semibold">Deform</span>
            <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" onClick={() => setSpec((current: any) => ({ ...current, ...Object.fromEntries(DEFORM.map((f) => [f.key, (PRIMITIVE_DEFAULTS as any)[f.key]])) }))}>Reset</Button></div>
          {DEFORM.map((field) => <Slider key={field.key} field={field} value={spec[field.key]} onChange={(value) => set(field.key, value)} />)}
        </section>
        <section className="flex flex-col gap-1.5">
          <div className="text-xs font-semibold">On the track</div>
          <label className="flex items-center gap-2 text-xs"><span className="w-32 shrink-0 text-muted-foreground">Colour</span><input type="color" aria-label="Colour" value={color} onChange={(e) => setColor(e.target.value)} className="h-7 w-12 cursor-pointer rounded border bg-transparent p-0.5" /></label>
          <label className="flex items-center gap-2 text-xs"><span className="w-32 shrink-0 text-muted-foreground">Collision</span>
            <select aria-label="Collision" value={collision} onChange={(e) => setCollision(e.target.value)} className="h-7 min-w-0 flex-1 rounded-md border bg-background px-1.5 text-xs">
              {COLLISIONS.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
            </select></label>
          {collision === "none" && <p className="text-[11px] text-muted-foreground">Without collision karts drive through it.</p>}
        </section>
      </div>
    </div>
    <div className="flex shrink-0 items-center justify-end gap-2">
      <span className={error ? "mr-auto text-[11px] text-destructive" : "mr-auto text-[11px] text-muted-foreground"}>{error || `${tris.length} triangles (limit ${PRIMITIVE_MAX_TRIANGLES})`}</span>
      <Button variant="ghost" onClick={() => close(null)}>Cancel</Button>
      <Button disabled={!tris.length} onClick={place}>Place on the track…</Button>
    </div>
  </div>;
}
