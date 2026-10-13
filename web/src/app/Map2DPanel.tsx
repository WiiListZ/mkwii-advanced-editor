// Flat X/Z editor for KMP elements. This is a separate canvas, not a camera
// preset of the 3D viewport; all edits still go through the shared document.
import * as React from "react";
import { Maximize2, MousePointer2, Plus, Trash2 } from "lucide-react";
import * as THREE from "three";
import { Button } from "@/components/ui/button";
import { isDriveableType } from "../../js/data/defs.js";
import { headingOf, turnYaw } from "../../js/editor/heading.js";
import { useEditor } from "./hooks";

type Layer = "ALL" | "CKPT" | "ENPT" | "ITPT" | "POTI" | "KTPT" | "GOBJ" | "JGPT";
// A marker whose `rotate` is set is the rotation handle of that element, not the element itself.
type Marker = { key: string; x: number; y: number; kind: Layer; label: string; rotate?: { x: number; y: number } };
type View = { cx: number; cz: number; scale: number };
type Drag =
  | { type: "pan"; sx: number; sy: number; cx: number; cz: number }
  | { type: "move"; sx: number; sy: number; moved: boolean; items: { info: any; start: any }[] }
  | { type: "rotate"; px: number; py: number; from: number; angle: number; moved: boolean; items: { info: any; start: number[] }[] };

const LAYERS: { id: Layer; label: string; color: string }[] = [
  { id: "ALL", label: "All", color: "#e5e7eb" },
  { id: "CKPT", label: "Checkpoints", color: "#fb7185" },
  { id: "ENPT", label: "Enemy routes", color: "#fbbf24" },
  { id: "ITPT", label: "Item routes", color: "#38bdf8" },
  { id: "POTI", label: "Object routes", color: "#c084fc" },
  { id: "KTPT", label: "Starts", color: "#f87171" },
  { id: "GOBJ", label: "Objects", color: "#4ade80" },
  { id: "JGPT", label: "Respawns", color: "#e5e7eb" },
];
const HANDLE = 44; // distance of the rotation handle from its element, in pixels
// Map heading of a screen direction (the map draws +X right and +Z down).
const screenHeading = (dx: number, dy: number) => Math.atan2(dx, dy) * 180 / Math.PI;
const colorOf = (id: Layer) => LAYERS.find((l) => l.id === id)?.color || "#fff";
const POINT_LAYERS: Layer[] = ["CKPT", "ENPT", "ITPT", "POTI", "KTPT", "GOBJ", "JGPT"];
const ADDABLE = new Set<Layer>(POINT_LAYERS);
const GROUPED = new Set<Layer>(["CKPT", "ENPT", "ITPT", "POTI"]);
const ADD_LABEL: Partial<Record<Layer, string>> = {
  CKPT: "Add checkpoint", ENPT: "Add enemy point", ITPT: "Add item point", POTI: "Add route point",
  KTPT: "Add start", GOBJ: "Add object…", JGPT: "Add respawn",
};

export function Map2DPanel() {
  const ed = useEditor("doc", "selection", "live", "kcl", "ui", "settings");
  const doc = ed.doc;
  const base = React.useRef<HTMLCanvasElement>(null);
  const overlay = React.useRef<HTMLCanvasElement>(null);
  const host = React.useRef<HTMLDivElement>(null);
  const view = React.useRef<View>({ cx: 0, cz: 0, scale: 0.01 });
  const size = React.useRef({ w: 1, h: 1, dpr: 1 });
  const markers = React.useRef<Marker[]>([]);
  const drag = React.useRef<Drag | null>(null);
  const baseCache = React.useRef<{ kcl: any; model: any; key: string } | null>(null);
  const fitted = React.useRef(false);
  const fittedModel = React.useRef<any>(null);
  const [layer, setLayer] = React.useState<Layer>("CKPT");
  const [pointer, setPointer] = React.useState<[number, number] | null>(null);
  const [hovered, setHovered] = React.useState<Marker | null>(null);
  const [, redraw] = React.useReducer((n) => n + 1, 0);

  const toScreen = (x: number, z: number): [number, number] => {
    const v = view.current, s = size.current;
    return [s.w / 2 + (x - v.cx) * v.scale, s.h / 2 + (z - v.cz) * v.scale];
  };
  const toWorld = (sx: number, sy: number): [number, number] => {
    const v = view.current, s = size.current;
    return [v.cx + (sx - s.w / 2) / v.scale, v.cz + (sy - s.h / 2) / v.scale];
  };
  const local = (e: React.PointerEvent | React.WheelEvent): [number, number] => {
    const rect = overlay.current!.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };
  const courseModel = () => ed.assets?.track === doc.szs && ed.assets?.built?.course
    ? ed.viewport?.courseGroup : null;

  const fit = () => {
    const k = doc.kmp;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, count = 0;
    const include = (x: number, z: number) => {
      if (!Number.isFinite(x) || !Number.isFinite(z)) return;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      count++;
    };
    if (doc.kcl) {
      const c = doc.kcl, v = c.verts;
      for (let pass = 0; pass < 2 && !count; pass++) {
        for (let t = 0; t < c.count; t++) {
          if (c.valid && !c.valid[t]) continue;
          if (!pass && !isDriveableType(c.flags[t] & 0x1f)) continue;
          const o = t * 9;
          for (let j = 0; j < 3; j++) include(v[o + j * 3], v[o + j * 3 + 2]);
        }
      }
    }
    if (count) {
      // Keep checkpoint gates and starts on screen unless a mod stores distant
      // outliers that would shrink the actual course to a speck.
      const keyX: number[] = [], keyZ: number[] = [];
      const addKey = (x: number, z: number) => { if (Number.isFinite(x) && Number.isFinite(z)) { keyX.push(x); keyZ.push(z); } };
      for (const group of k.CKPT) for (const p of group.points) {
        addKey(p.left[0], p.left[1]); addKey(p.right[0], p.right[1]);
      }
      for (const p of k.KTPT) addKey(p.pos[0], p.pos[2]);
      if (!keyX.length) for (const group of k.ENPT) for (const p of group.points) addKey(p.pos[0], p.pos[2]);
      if (keyX.length) {
        let ux0 = minX, ux1 = maxX, uz0 = minZ, uz1 = maxZ;
        for (const x of keyX) { ux0 = Math.min(ux0, x); ux1 = Math.max(ux1, x); }
        for (const z of keyZ) { uz0 = Math.min(uz0, z); uz1 = Math.max(uz1, z); }
        const unionX = ux1 - ux0, unionZ = uz1 - uz0;
        if (unionX <= Math.max(2000, maxX - minX) * 5 && unionZ <= Math.max(2000, maxZ - minZ) * 5) {
          for (let i = 0; i < keyX.length; i++) include(keyX[i], keyZ[i]);
        }
      }
    }
    if (!count) {
      for (const kind of ["ENPT", "ITPT", "CKPT"] as const) for (const group of k[kind]) for (const p of group.points) {
        if (kind === "CKPT") { include(p.left[0], p.left[1]); include(p.right[0], p.right[1]); }
        else include(p.pos[0], p.pos[2]);
      }
      for (const p of k.KTPT) include(p.pos[0], p.pos[2]);
      if (!count) for (const kind of ["GOBJ", "JGPT"] as const) for (const p of k[kind]) include(p.pos[0], p.pos[2]);
    }
    if (!count) {
      const model = courseModel();
      if (model?.children.length) {
        model.updateWorldMatrix(true, true);
        const box = new THREE.Box3().setFromObject(model);
        if (!box.isEmpty()) {
          include(box.min.x, box.min.z); include(box.max.x, box.max.z);
          fittedModel.current = model.children[0];
        }
      }
    }
    if (!count) { minX = minZ = -5000; maxX = maxZ = 5000; }
    const { w, h } = size.current;
    view.current = {
      cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2,
      scale: Math.min((w - 100) / Math.max(2000, maxX - minX), (h - 190) / Math.max(2000, maxZ - minZ)),
    };
    view.current.scale = Math.max(0.00002, Math.min(1, view.current.scale));
    fitted.current = true;
    baseCache.current = null;
    redraw();
  };

  React.useEffect(() => {
    const observer = new ResizeObserver(() => {
      const r = host.current?.getBoundingClientRect();
      if (!r || r.width < 2 || r.height < 2) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      size.current = { w: r.width, h: r.height, dpr };
      for (const canvas of [base.current, overlay.current]) if (canvas) {
        canvas.width = Math.round(r.width * dpr);
        canvas.height = Math.round(r.height * dpr);
      }
      baseCache.current = null;
      if (!fitted.current) fit(); else redraw();
    });
    if (host.current) observer.observe(host.current);
    const onLoad = () => { fitted.current = false; fittedModel.current = null; baseCache.current = null; fit(); };
    doc.addEventListener("load", onLoad);
    return () => { observer.disconnect(); doc.removeEventListener("load", onLoad); };
  }, []);

  const modelForFit = courseModel()?.children[0] || null;
  React.useEffect(() => {
    if (!doc.kcl && modelForFit && !fittedModel.current && size.current.w > 2) {
      fittedModel.current = modelForFit;
      fit();
    }
  }, [modelForFit, doc.kcl]);

  const drawBase = () => {
    const canvas = base.current, ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { w, h, dpr } = size.current, v = view.current, kcl = doc.kcl;
    const model = kcl ? null : courseModel();
    const modelPart = model?.children?.[0] || null;
    const key = `${w}/${h}/${dpr}/${v.cx}/${v.cz}/${v.scale}/${ed.version(kcl ? ["kcl"] : ["doc"])}`;
    if (baseCache.current?.kcl === kcl && baseCache.current.model === modelPart && baseCache.current.key === key) return;
    baseCache.current = { kcl, model: modelPart, key };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#14181c";
    ctx.fillRect(0, 0, w, h);
    let step = 1000;
    while (step * v.scale < 55) step *= 2;
    while (step * v.scale > 160) step /= 2;
    const [ox, oy] = toScreen(0, 0), gap = step * v.scale;
    ctx.strokeStyle = "#273038"; ctx.lineWidth = 1;
    for (let x = ((ox % gap) + gap) % gap; x < w; x += gap) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = ((oy % gap) + gap) % gap; y < h; y += gap) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    const drawRouteLayout = () => {
      const groups = doc.kmp.ENPT.some((g: any) => g.points.length) ? doc.kmp.ENPT : doc.kmp.ITPT;
      const lengths: number[] = [];
      for (const group of groups) for (let i = 1; i < group.points.length; i++) {
        const a = group.points[i - 1].pos, b = group.points[i].pos;
        lengths.push(Math.hypot(a[0] - b[0], a[2] - b[2]));
      }
      lengths.sort((a, b) => a - b);
      const linkLimit = lengths.length ? Math.max(5000, lengths[Math.floor(lengths.length / 2)] * 4) : 15000;
      ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(14, Math.min(90, 1600 * v.scale));
      ctx.strokeStyle = "#344f41"; ctx.globalAlpha = 0.7;
      for (const group of groups) {
        if (group.points.length < 2) continue;
        ctx.beginPath();
        group.points.forEach((p: any, i: number) => {
          const [x, y] = toScreen(p.pos[0], p.pos[2]);
          if (!i) ctx.moveTo(x, y);
          else {
            const prev = group.points[i - 1].pos;
            if (Math.hypot(p.pos[0] - prev[0], p.pos[2] - prev[2]) > linkLimit) { ctx.stroke(); ctx.beginPath(); ctx.moveTo(x, y); }
            else ctx.lineTo(x, y);
          }
        });
        ctx.stroke();
      }
      ctx.globalAlpha = 0.4;
      groups.forEach((group: any) => {
        if (!group.points.length) return;
        const a = group.points.at(-1);
        for (const next of group.next || []) {
          const b = groups[next]?.points[0];
          if (!b || Math.hypot(a.pos[0] - b.pos[0], a.pos[2] - b.pos[2]) > linkLimit) continue;
          const [ax, ay] = toScreen(a.pos[0], a.pos[2]), [bx, by] = toScreen(b.pos[0], b.pos[2]);
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        }
      });
      ctx.restore();
    };
    if (!kcl) {
      const hasRouteMap = doc.kmp.ENPT.some((g: any) => g.points.length) || doc.kmp.ITPT.some((g: any) => g.points.length)
        || doc.kmp.CKPT.some((g: any) => g.points.length);
      if (modelPart && !hasRouteMap) {
        // If no collision or routes exist, project the remaining course geometry.
        model!.updateWorldMatrix(true, true);
        const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
        model!.traverse((object: any) => {
          if (!object.isMesh || !object.geometry?.attributes?.position) return;
          const pos = object.geometry.attributes.position, index = object.geometry.index;
          const triangles = Math.floor((index?.count ?? pos.count) / 3);
          const stride = Math.max(1, Math.ceil(triangles / 100000));
          ctx.fillStyle = "#495b50";
          for (let i = 0; i < triangles; i += stride) {
            const n = i * 3;
            a.fromBufferAttribute(pos, index ? index.getX(n) : n).applyMatrix4(object.matrixWorld);
            b.fromBufferAttribute(pos, index ? index.getX(n + 1) : n + 1).applyMatrix4(object.matrixWorld);
            c.fromBufferAttribute(pos, index ? index.getX(n + 2) : n + 2).applyMatrix4(object.matrixWorld);
            const [ax, ay] = toScreen(a.x, a.z), [bx, by] = toScreen(b.x, b.z), [cx, cy] = toScreen(c.x, c.z);
            if (Math.max(ax, bx, cx) < 0 || Math.min(ax, bx, cx) > w || Math.max(ay, by, cy) < 0 || Math.min(ay, by, cy) > h) continue;
            const area = Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
            if (area < 0.15) continue;
            ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx, cy); ctx.closePath(); ctx.fill();
          }
        });
      }
      // A loose KMP has no surface. Its routes form a schematic road, also useful
      // when a custom course model contains a large featureless ground plane.
      drawRouteLayout();
      return;
    }
    drawRouteLayout();
    const p = kcl.verts;
    let roadCount = 0;
    for (let t = 0; t < kcl.count; t++) if ((!kcl.valid || kcl.valid[t]) && isDriveableType(kcl.flags[t] & 0x1f)) roadCount++;
    for (let t = 0; t < kcl.count; t++) {
      if (kcl.valid && !kcl.valid[t]) continue;
      const type = kcl.flags[t] & 0x1f;
      if (type === 0x10 || (roadCount && !isDriveableType(type))) continue;
      const o = t * 9;
      const [ax, ay] = toScreen(p[o], p[o + 2]), [bx, by] = toScreen(p[o + 3], p[o + 5]), [cx, cy] = toScreen(p[o + 6], p[o + 8]);
      if (Math.max(ax, bx, cx) < 0 || Math.min(ax, bx, cx) > w || Math.max(ay, by, cy) < 0 || Math.min(ay, by, cy) > h) continue;
      const area = Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
      if (area < 0.15) continue;
      ctx.fillStyle = type >= 2 && type <= 4 ? "#586349" : type >= 6 && type <= 8 ? "#77734c" : "#4c6957";
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx, cy); ctx.closePath(); ctx.fill();
    }
  };

  const drawOverlay = () => {
    const ctx = overlay.current?.getContext("2d");
    if (!ctx) return;
    const { w, h, dpr } = size.current, k = doc.kmp, sel = doc.selection;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    markers.current = [];
    const visible = (id: Layer) => layer === "ALL" || layer === id;
    const line = (a: number[], b: number[], color: string, width = 2, dashed = false) => {
      const [x1, y1] = toScreen(a[0], a[1]), [x2, y2] = toScreen(b[0], b[1]);
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dashed ? [5, 5] : []);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
    };
    const dot = (key: string, kind: Layer, x: number, z: number, label: string, radius = 6) => {
      const [sx, sy] = toScreen(x, z);
      markers.current.push({ key, kind, x: sx, y: sy, label });
      if (sx < -30 || sy < -30 || sx > w + 30 || sy > h + 30) return;
      const active = sel.has(key) || (!key.includes(":") && (sel.has(key + ":L") || sel.has(key + ":R")));
      const hot = hovered?.key === key;
      ctx.fillStyle = active ? "#ffffff" : colorOf(kind);
      ctx.strokeStyle = active || hot ? "#ffffff" : "#101417";
      ctx.lineWidth = active || hot ? 3 : 2;
      ctx.beginPath(); ctx.arc(sx, sy, active || hot ? radius + 2 : radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if ((layer !== "ALL" || active || hot) && (!key.includes(":") || active || hot)) {
        ctx.font = "600 11px system-ui";
        ctx.fillStyle = active ? "#ffffff" : "#dce2e7";
        ctx.fillText(label, sx + radius + 5, sy - 6);
      }
    };
    const xy = (p: any): number[] => [p.pos[0], p.pos[2]];
    for (const kind of ["ENPT", "ITPT", "POTI"] as const) {
      if (!visible(kind)) continue;
      const groups = kind === "POTI" ? k.POTI : k[kind];
      groups.forEach((g: any, gi: number) => {
        for (let i = 1; i < g.points.length; i++) line(xy(g.points[i - 1]), xy(g.points[i]), colorOf(kind) + "bb", 2.5);
        if (kind !== "POTI") for (const next of g.next || []) {
          const other = groups[next];
          if (g.points.length && other?.points.length) line(xy(g.points.at(-1)), xy(other.points[0]), colorOf(kind) + "88", 1.5, true);
        }
        g.points.forEach((p: any, i: number) => dot(String(p.uid), kind, p.pos[0], p.pos[2], `${gi}.${i}`));
      });
    }
    if (visible("CKPT")) k.CKPT.forEach((g: any, gi: number) => {
      for (let i = 1; i < g.points.length; i++) {
        const a = g.points[i - 1], b = g.points[i];
        line(a.left, b.left, "#fb718555", 1.5); line(a.right, b.right, "#fb718555", 1.5);
      }
      g.points.forEach((p: any, i: number) => {
        const color = p.type === 0 ? "#fb3f61" : p.type !== 0xff ? "#facc15" : colorOf("CKPT");
        line(p.left, p.right, color + "dd", p.type === 0 ? 4 : 2.5);
        const x = (p.left[0] + p.right[0]) / 2, z = (p.left[1] + p.right[1]) / 2;
        dot(String(p.uid), "CKPT", x, z, `${gi}.${i}`, 6);
        dot(`${p.uid}:L`, "CKPT", p.left[0], p.left[1], "L", 4);
        dot(`${p.uid}:R`, "CKPT", p.right[0], p.right[1], "R", 4);
      });
    });
    // Facing arrow of every element with a rotation; selected ones get a handle to drag.
    const handles: Marker[] = [];
    const facing = (p: any, kind: Layer) => {
      const [x, y] = toScreen(p.pos[0], p.pos[2]);
      if (x < -60 || y < -60 || x > w + 60 || y > h + 60) return;
      const a = headingOf(p.rot) * Math.PI / 180, dx = Math.sin(a), dy = Math.cos(a);
      const key = String(p.uid), active = sel.has(key);
      ctx.strokeStyle = active ? "#ffffff" : colorOf(kind); ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 2;
      const len = active ? HANDLE : 20;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dx * len, y + dy * len); ctx.stroke();
      if (!active) {
        const tx = x + dx * len, ty = y + dy * len;
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx - dx * 6 - dy * 4, ty - dy * 6 + dx * 4); ctx.lineTo(tx - dx * 6 + dy * 4, ty - dy * 6 - dx * 4); ctx.closePath(); ctx.fill();
        return;
      }
      handles.push({ key, kind, x: x + dx * HANDLE, y: y + dy * HANDLE, label: "", rotate: { x, y } });
    };
    if (visible("GOBJ")) k.GOBJ.forEach((p: any, i: number) => { facing(p, "GOBJ"); dot(String(p.uid), "GOBJ", p.pos[0], p.pos[2], `${i} ${ed.objectLabel(p.objectId)}`); });
    if (visible("JGPT")) k.JGPT.forEach((p: any, i: number) => { facing(p, "JGPT"); dot(String(p.uid), "JGPT", p.pos[0], p.pos[2], String(i)); });
    if (visible("KTPT")) k.KTPT.forEach((p: any, i: number) => { facing(p, "KTPT"); dot(String(p.uid), "KTPT", p.pos[0], p.pos[2], String(i), 7); });
    const turning = drag.current?.type === "rotate" ? drag.current : null;
    for (const m of handles) {
      const hot = turning || (hovered?.rotate && hovered.key === m.key);
      // Dashed circle around the element: the handle turns around that point.
      ctx.strokeStyle = "#ffffff55"; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.arc(m.rotate!.x, m.rotate!.y, HANDLE, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = hot ? "#facc15" : "#ffffff"; ctx.strokeStyle = "#101417"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(m.x, m.y, hot ? 8 : 6.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      markers.current.push(m);
    }
    if (turning?.moved) {
      ctx.font = "600 12px system-ui"; ctx.fillStyle = "#facc15";
      ctx.fillText(`${Math.round(turning.angle)}°`, turning.px + 12, turning.py - HANDLE - 8);
    }
  };

  React.useLayoutEffect(() => { ed.map2DView = view.current; drawBase(); drawOverlay(); });
  React.useEffect(() => () => { ed.map2DPointer = null; }, []);

  const hit = (sx: number, sy: number) => {
    let best: Marker | null = null, dist = 14 * 14;
    for (const m of markers.current) if (m.rotate && (m.x - sx) ** 2 + (m.y - sy) ** 2 < 11 * 11) return m;
    for (const m of markers.current) {
      const d = (m.x - sx) ** 2 + (m.y - sy) ** 2;
      if (d < dist) { best = m; dist = d; }
    }
    return best;
  };
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const [sx, sy] = local(e), m = hit(sx, sy);
    e.currentTarget.setPointerCapture(e.pointerId);
    if (e.button === 1 || e.button === 2 || e.altKey) {
      setHovered(null);
      drag.current = { type: "pan", sx, sy, cx: view.current.cx, cz: view.current.cz };
      return;
    }
    if (e.button !== 0) return;
    if (ed.tool?.type === "place") {
      const [x, z] = toWorld(sx, sy);
      const ref = doc.nearestEnemyY(x, z);
      const y = doc.heights?.heightAt(x, z, ref ?? Infinity) ?? ref ?? 0;
      ed.placeAt([x, y, z], e.shiftKey, !ed.settings.map2DAddSeveral);
      return;
    }
    if (!m) {
      doc.clearSelection();
      setHovered(null);
      drag.current = { type: "pan", sx, sy, cx: view.current.cx, cz: view.current.cz };
      return;
    }
    if (m.rotate) {
      // Every selected element turns by the same angle as the one whose handle is dragged.
      const items = doc.selectedInfos({ expandGroups: true }).filter((info: any) => info.item.rot)
        .map((info: any) => ({ info, start: [...info.item.rot] }));
      const from = headingOf(doc.resolve(m.key)?.item.rot);
      doc.beginEdit();
      drag.current = { type: "rotate", px: m.rotate.x, py: m.rotate.y, from, angle: from, moved: false, items };
      return;
    }
    const mode = e.ctrlKey || e.metaKey ? "toggle" : e.shiftKey ? "add" : "replace";
    if (mode !== "replace" || !doc.selection.has(m.key)) ed.viewport?.selectEntity(m.key, mode);
    if (mode !== "replace") return;
    const picked = doc.selectedInfos({ expandGroups: true }).filter((info: any) => POINT_LAYERS.includes(info.kind));
    doc.beginEdit();
    drag.current = { type: "move", sx, sy, moved: false,
      items: picked.map((info: any) => ({ info, start: structuredClone(info.item) })) };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const [sx, sy] = local(e);
    if (drag.current?.type === "pan") {
      const d = drag.current;
      view.current.cx = d.cx - (sx - d.sx) / view.current.scale;
      view.current.cz = d.cz - (sy - d.sy) / view.current.scale;
      redraw();
    } else if (drag.current?.type === "rotate") {
      const d = drag.current;
      if (Math.hypot(sx - d.px, sy - d.py) < 6) return;
      let angle = screenHeading(sx - d.px, sy - d.py);
      if (e.shiftKey) angle = Math.round(angle / 15) * 15;
      d.angle = angle;
      d.moved = true;
      for (const { info, start } of d.items) info.item.rot = turnYaw(start, angle - d.from);
      doc.live();
    } else if (drag.current?.type === "move") {
      const d = drag.current;
      if (!d.moved && Math.hypot(sx - d.sx, sy - d.sy) < 3) return;
      d.moved = true;
      const delta: [number, number, number] = [(sx - d.sx) / view.current.scale, 0, (sy - d.sy) / view.current.scale];
      for (const { info, start } of d.items) doc.translate(info, start, delta);
      doc.live();
    } else {
      ed.map2DPointer = toWorld(sx, sy);
      setPointer(ed.map2DPointer);
      setHovered(hit(sx, sy));
    }
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (drag.current?.type === "move" || drag.current?.type === "rotate") {
      if (drag.current.moved) doc.endEdit(drag.current.type === "move" ? "Move in 2D" : "Rotate in 2D");
      else doc.pending = null;
    }
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const onPointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (drag.current?.type === "move" || drag.current?.type === "rotate") {
      if (drag.current.moved) doc.cancelEdit();
      else doc.pending = null;
    }
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const [sx, sy] = local(e), [x, z] = toWorld(sx, sy);
    view.current.scale = Math.max(0.00002, Math.min(2, view.current.scale * Math.exp(-e.deltaY * 0.001)));
    const [nx, nz] = toWorld(sx, sy);
    view.current.cx += x - nx; view.current.cz += z - nz;
    redraw();
  };
  const active = ed.tool?.type === "place" ? ed.tool.kind : null;
  const hoverHint = hovered?.rotate ? "Drag around the point to rotate · Shift snaps to 15° · Q / E turn by 15°"
    : hovered?.kind === "CKPT" && hovered.key.endsWith(":L") ? "Drag the left checkpoint edge to change its width"
    : hovered?.kind === "CKPT" && hovered.key.endsWith(":R") ? "Drag the right checkpoint edge to change its width"
    : hovered?.kind === "CKPT" ? `Checkpoint ${hovered.label} · drag the centre to move both edges`
    : hovered ? `${LAYERS.find((l) => l.id === hovered.kind)?.label} ${hovered.label} · drag to move · click to inspect` : null;

  return <div ref={host} className="absolute inset-0 select-none bg-[#14181c] text-white" data-map2d
    data-center-x={view.current.cx} data-center-z={view.current.cz} data-scale={view.current.scale} data-fitted={fitted.current}>
    <canvas ref={base} className="pointer-events-none absolute inset-0 size-full" aria-hidden="true" />
    <canvas ref={overlay} className={`absolute inset-0 size-full touch-none outline-none ${active ? "cursor-crosshair" : hovered ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"}`}
      tabIndex={0} aria-label="2D track map" onContextMenu={(e) => e.preventDefault()}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}
      onPointerLeave={() => { ed.map2DPointer = null; setPointer(null); setHovered(null); }} onWheel={onWheel} />
    <div className="absolute inset-x-2 top-2 flex flex-col gap-1 rounded-lg border border-white/15 bg-[#10151a]/95 p-1.5 shadow-lg">
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex items-center gap-1.5 px-1 text-xs font-semibold">Edit map</div>
        <span className="text-[11px] text-white/50">{doc.selection.size ? `${doc.selection.size} selected` : "Choose a layer, then select or add"}</span>
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs text-white hover:bg-white/15 hover:text-white" onClick={fit} aria-label="Fit 2D map"><Maximize2 className="size-3.5" /> Fit map</Button>
          {GROUPED.has(layer) && <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-white hover:bg-white/15 hover:text-white" onClick={() => {
            const { cx, cz } = view.current;
            const y = doc.heights?.heightAt(cx, cz, Infinity) ?? doc.nearestEnemyY(cx, cz) ?? 0;
            ed.ops.addGroup(layer, [cx, y, cz]);
            if (layer !== "POTI") ed.startPlacing(layer);
          }} aria-label="New route or group">{layer === "POTI" ? "New route" : "New group"}</Button>}
          {ADDABLE.has(layer) && <Button size="sm" variant={active === layer ? "secondary" : "default"} className="h-7 gap-1 px-2 text-xs" aria-label="Add 2D item"
            onClick={() => layer === "GOBJ" ? void ed.pickObject(doc.primary?.kind === "GOBJ" ? doc.primary.item.objectId : 0x65, "add") : ed.startPlacing(layer)}>
            <Plus className="size-3.5" /> {ADD_LABEL[layer]}
          </Button>}
          {ADDABLE.has(layer) && <label className="flex cursor-pointer items-center gap-1 px-1 text-[11px] text-white/70" title="Keep adding with each click until Select or Esc; otherwise each Add places one element">
            <input type="checkbox" className="accent-white" checked={ed.settings.map2DAddSeveral} onChange={(e) => ed.setSetting("map2DAddSeveral", e.target.checked)} aria-label="Add several" /> Add several
          </label>}
          {active && <Button size="sm" variant="secondary" className="h-7 gap-1 px-2 text-xs" onClick={() => ed.stopTool()} aria-label="Select mode"><MousePointer2 className="size-3.5" /> Select</Button>}
          {doc.selection.size > 0 && <Button size="sm" variant="ghost" className="h-7 px-2 text-white/70 hover:bg-rose-500/20 hover:text-rose-200" onClick={() => ed.ops.deleteSelection()} aria-label="Delete selected"><Trash2 className="size-3.5" /></Button>}
        </div>
      </div>
      <div className="flex items-center gap-1 border-t border-white/10 pt-1.5">
        <span className="shrink-0 px-1 text-[10px] font-semibold uppercase tracking-wide text-white/50">Layer</span>
        <div className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto">
          {LAYERS.map((l) => <button key={l.id} type="button" onClick={() => { setLayer(l.id); ed.stopTool(); setHovered(null); }}
            aria-pressed={layer === l.id}
            className={`shrink-0 rounded px-2 py-1 text-[11px] font-medium transition-colors ${layer === l.id ? "bg-white/20 text-white" : "text-white/65 hover:bg-white/10 hover:text-white"}`}>
            <span className="mr-1" style={{ color: l.color }}>●</span>{l.label}
          </button>)}
        </div>
      </div>
    </div>
    <div className="pointer-events-none absolute bottom-2 left-3 rounded bg-[#10151a]/85 px-2 py-1 text-[11px] text-white/75">
      {active ? `Click the map to place ${ADD_LABEL[active as Layer]?.replace(/^Add /, "").replace("…", "") || "a point"}${ed.settings.map2DAddSeveral ? " · keep clicking to add more · Select or Esc to finish" : " · Esc to cancel"}`
        : drag.current?.type === "rotate" ? "Release to apply the rotation · Shift snaps to 15°"
        : hoverHint || (doc.selection.size ? "Drag the white handle to rotate · Q / E turn 15° · Ctrl+C / Ctrl+V paste at the mouse · Ctrl+D duplicate"
          : "Drag empty space to pan · wheel to zoom · click a point to inspect · Shift/Ctrl for multiple")}
    </div>
    {pointer && <div className="pointer-events-none absolute bottom-2 right-3 rounded bg-[#10151a]/85 px-2 py-1 font-mono text-[11px] text-white/65">
      X {Math.round(pointer[0])} · Z {Math.round(pointer[1])}
    </div>}
  </div>;
}
