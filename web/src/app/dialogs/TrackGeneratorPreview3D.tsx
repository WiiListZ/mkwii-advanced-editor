import * as React from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TrackLayoutPreview } from "../track-layout-preview";
import { type PreviewTextures } from "../track-texture-preview";

// The generated mesh itself, including walls, bridge decks and supports. Rebuilding the
// geometry for an edit leaves the orbit camera alone, so heights can be compared in place.
export function TrackGeneratorPreview3D({ model, textures, points, samples, itemBoxes, selected, onSelect, fitRef }: {
  model: any; textures: PreviewTextures; points: { x: number; y: number; z: number }[]; samples: number[][];
  itemBoxes: { pos: number[] }[]; selected: number; onSelect: (index: number) => void; fitRef: React.MutableRefObject<(() => void) | null>;
}) {
  const host = React.useRef<HTMLDivElement>(null), state = React.useRef<any>(null);
  const select = React.useRef(onSelect); select.current = onSelect;
  const [error, setError] = React.useState(false);
  React.useEffect(() => {
    const el = host.current!;
    let preview: TrackLayoutPreview;
    try { preview = new TrackLayoutPreview(640, 430, true); }
    catch { setError(true); return; }
    const { renderer, scene } = preview;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.setClearColor(0x14161b, 1);
    renderer.domElement.setAttribute("aria-label", "3D track preview");
    renderer.domElement.style.cssText = "display:block;width:100%;height:100%;touch-action:none";
    el.append(renderer.domElement);
    scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8); sun.position.set(1, 2, 1.5); scene.add(sun);
    const camera = new THREE.PerspectiveCamera(45, 1, 1, 1e7);
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.dampingFactor = .15;
    const markers = new THREE.Group(); scene.add(markers);
    const boxes = new THREE.Group(); scene.add(boxes);
    const tile = document.createElement("canvas"); tile.width = tile.height = 64;
    const g = tile.getContext("2d")!; g.fillStyle = "#2563eb"; g.fillRect(0, 0, 64, 64); g.strokeStyle = "#bfdbfe"; g.lineWidth = 4; g.strokeRect(2, 2, 60, 60); g.fillStyle = "white"; g.font = "bold 50px system-ui"; g.textAlign = "center"; g.fillText("?", 32, 51);
    const boxTexture = new THREE.CanvasTexture(tile); boxTexture.colorSpace = THREE.SRGBColorSpace;
    const boxGeometry = new THREE.BoxGeometry(300, 300, 300), boxMaterial = new THREE.MeshBasicMaterial({ map: boxTexture });
    const geometry = new THREE.SphereGeometry(1, 12, 8);
    const normal = new THREE.MeshBasicMaterial({ color: 0x60a5fa, depthTest: false });
    const active = new THREE.MeshBasicMaterial({ color: 0xfacc15, depthTest: false });
    const fit = () => {
      // Frame the road, walls and supports rather than the much larger ground backdrop.
      const box = new THREE.Box3();
      for (const mesh of preview.meshes.children) if (mesh.userData.role !== "terrain") box.union(new THREE.Box3().setFromObject(mesh));
      if (box.isEmpty()) return;
      const center = box.getCenter(new THREE.Vector3()), radius = Math.max(100, box.getSize(new THREE.Vector3()).length() / 2);
      const direction = new THREE.Vector3(.8, .65, 1).normalize(), right = new THREE.Vector3().crossVectors(camera.up, direction).normalize(), up = new THREE.Vector3().crossVectors(direction, right);
      const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), tanH = tanV * camera.aspect;
      let distance = 0;
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
        const offset = new THREE.Vector3(x, y, z).sub(center);
        distance = Math.max(distance, offset.dot(direction) + Math.max(Math.abs(offset.dot(right)) / tanH, Math.abs(offset.dot(up)) / tanV));
      }
      controls.target.copy(center);
      camera.position.copy(center).add(direction.multiplyScalar(Math.max(radius, distance) * 1.08));
      camera.near = Math.max(1, radius / 1000); camera.far = radius * 100;
      controls.minDistance = radius * .05; controls.maxDistance = radius * 20;
      camera.updateProjectionMatrix(); controls.update(); renderer.render(scene, camera);
    };
    fitRef.current = fit;
    let width = 0, height = 0;
    const resize = () => {
      const w = el.clientWidth || 1, h = el.clientHeight || 1; if (w === width && h === height) return;
      width = w; height = h; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    };
    const observer = new ResizeObserver(resize); observer.observe(el); resize();
    let down = [0, 0];
    const pointerDown = (e: PointerEvent) => { down = [e.clientX, e.clientY]; };
    const pointerUp = (e: PointerEvent) => {
      if (e.button !== 0 || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
      const rect = renderer.domElement.getBoundingClientRect(), ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, 1 - (e.clientY - rect.top) / rect.height * 2), camera);
      const hit = ray.intersectObjects(markers.children)[0]; if (hit) select.current(hit.object.userData.point);
    };
    renderer.domElement.addEventListener("pointerdown", pointerDown); renderer.domElement.addEventListener("pointerup", pointerUp);
    let frame = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick); controls.update(); preview.animate(now);
      // Keep the selectable points usable at every zoom level.
      for (const dot of markers.children as THREE.Mesh[]) dot.scale.setScalar(camera.position.distanceTo(dot.position) * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.max(1, height) * (dot.material === active ? 7 : 5));
      renderer.render(scene, camera);
    };
    state.current = { preview, markers, boxes, boxGeometry, boxMaterial, geometry, normal, active, fit, fitted: false };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", pointerDown); renderer.domElement.removeEventListener("pointerup", pointerUp);
      geometry.dispose(); normal.dispose(); active.dispose(); preview.dispose(); renderer.domElement.remove();
      boxGeometry.dispose(); boxMaterial.dispose(); boxTexture.dispose();
      fitRef.current = null; state.current = null;
    };
  }, []);
  React.useEffect(() => {
    const s = state.current; if (!s || !model) return;
    s.preview.updateModel(model, textures);
    if (!s.fitted) { s.fit(); s.fitted = true; }
    s.markers.clear();
    points.forEach((p, index) => {
      // Automatic bridges can lift a crossing above its input points; show the dot on the built road.
      const nearest = samples.reduce((best, v) => !best || Math.hypot(v[0] - p.x, v[2] - p.z) < Math.hypot(best[0] - p.x, best[2] - p.z) ? v : best, null as number[] | null);
      const dot = new THREE.Mesh(s.geometry, index === selected ? s.active : s.normal);
      dot.scale.setScalar(index === selected ? 260 : 180); dot.position.set(p.x, (nearest?.[1] ?? p.y) + 120, p.z);
      dot.renderOrder = 10; dot.userData.point = index; s.markers.add(dot);
    });
  }, [model, textures, points, samples, selected]);
  React.useEffect(() => {
    const s = state.current; if (!s) return;
    s.boxes.clear();
    for (const box of itemBoxes) { const mesh = new THREE.Mesh(s.boxGeometry, s.boxMaterial); mesh.position.set(box.pos[0], box.pos[1] + 150, box.pos[2]); s.boxes.add(mesh); }
  }, [itemBoxes]);
  return <div className="relative aspect-[640/430] w-full shrink-0 overflow-hidden rounded-lg border bg-[#14161b]" data-testid="generator-3d">
    <div ref={host} className="absolute inset-0" />
    {error ? <div role="status" className="absolute inset-0 grid place-items-center p-8 text-center text-xs text-muted-foreground">3D preview is unavailable. Switch to 2D to continue drawing.</div>
      : <p className="pointer-events-none absolute bottom-2 left-3 right-3 m-0 text-[11px] text-white/75 [text-shadow:0_1px_2px_#000]">Drag to orbit · right-drag to pan · wheel to zoom · click a point to select it</p>}
  </div>;
}
