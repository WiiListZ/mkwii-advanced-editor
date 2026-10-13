// Small rotating 3D preview of a game object's real model (Objects panel).

import * as React from "react";
import * as THREE from "three";
import { cloneModel, bindCHR, applyCHRFrame, collectBillboards, applyBillboards } from "../../../js/editor/brresmodel.js";
import { editor, hex } from "../editor";
import { useEditor } from "../hooks";

export function ObjectPreview({ objectId, className = "h-36" }: { objectId: number | null; className?: string }) {
  useEditor("doc"); // re-render when a model arrives from the tracks folder
  const host = React.useRef<HTMLDivElement>(null);
  const view = React.useRef<any>(null);
  const model = objectId != null ? editor.assets?.objectModel(objectId) : null;

  React.useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.style.display = "block";
    el.append(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(1, 2, 1.5);
    scene.add(sun);
    const camera = new THREE.PerspectiveCamera(35, 1, 1, 1e6);
    const pivot = new THREE.Group();
    scene.add(pivot);
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
    let frame = 0, last = performance.now(), time = 0;
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now; time += dt;
      pivot.rotation.y += dt * 0.6;
      const v = view.current;
      if (v?.chr) applyCHRFrame(v.chr, v.chr.loop ? (time * 60) % v.chr.frames : Math.min(time * 60, v.chr.frames));
      if (v?.billboards?.length) applyBillboards(v.billboards, camera);
      renderer.render(scene, camera);
    };
    frame = requestAnimationFrame(loop);
    view.current = { renderer, scene, camera, pivot, current: null };
    return () => { cancelAnimationFrame(frame); observer.disconnect(); renderer.dispose(); renderer.domElement.remove(); view.current = null; };
  }, []);

  React.useEffect(() => {
    const v = view.current;
    if (!v) return;
    v.pivot.clear();
    v.chr = null; v.billboards = [];
    if (!model?.template) return;
    const object = cloneModel(model.template);
    v.chr = model.chr ? bindCHR(model.chr, object) : null;
    v.billboards = collectBillboards(object);
    // Centre the model on the pivot and frame it.
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    object.position.sub(center);
    v.pivot.add(object);
    const radius = Math.max(size.length() / 2, 1);
    v.camera.position.set(0, radius * 0.9, radius * 3.4);
    v.camera.near = radius / 100; v.camera.far = radius * 100;
    v.camera.lookAt(0, 0, 0);
    v.camera.updateProjectionMatrix();
  }, [model, objectId]);

  return (
    <div className={`relative ${className} shrink-0 overflow-hidden rounded-md border bg-[radial-gradient(ellipse_at_center,_oklch(0.27_0_0)_0%,_oklch(0.17_0_0)_75%)]`}>
      <div ref={host} className="absolute inset-0" />
      <div className="pointer-events-none absolute bottom-1.5 left-2 right-2 truncate text-[11px] text-white/70 [text-shadow:0_1px_2px_#000]">
        {objectId == null ? "Point at an object to preview it" : `${editor.objectLabel(objectId)} · ${hex(objectId)}`}
      </div>
      {objectId != null && !model && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center px-6 text-center text-xs text-muted-foreground">No game model: a simple shape is shown in the 3D view.</div>
      )}
    </div>
  );
}
