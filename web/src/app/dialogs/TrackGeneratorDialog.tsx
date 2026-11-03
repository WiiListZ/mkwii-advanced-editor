import { NumberField } from "../number-field";
import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Box, CircleAlert, CircleCheck, Flag, Info, FlipHorizontal2, Map as MapIcon, Maximize, Minus, MousePointer2, Package, PenLine, Plus, Redo2, Sparkles, TriangleAlert, Undo2, ZoomIn, ZoomOut, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PRESETS, DEFAULT_PARAMS, generateTrack, generatedTrackIssues, trackSamples, layoutIssues, pointsFromStroke, reverseLayout, roadFrames, scaleLayout } from "../../../js/editor/trackgen.js";
import { layoutBounds, resizeLayout, nearestLayoutSegment, startLayoutAt } from "../../../js/editor/layout-points.js";
import { curveCorner, cornerArc } from "../../../js/editor/curve-radius.js";
import { useTrackTextures, textureTriangle } from "../track-texture-preview";
import { TrackLayoutPreview } from "../track-layout-preview";
import { TrackStylePicker, TrackTextures } from "./TrackTextures";
import { TrackGeneratorPreview3D } from "./TrackGeneratorPreview3D";
import { Hint, InfoTip } from "../common";
import { cn } from "@/lib/utils";

const W = 640, H = 430, PH = 84; // drawing and height profile (canvas pixels)
const KART = 300; // a kart is about 300 units wide
const MIN_HEIGHT = -3000, MAX_HEIGHT = 8000;
const MIN_VIEW_WIDTH = 2000, MAX_VIEW_WIDTH = 500000;
const clampHeight = (y: number) => Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, y));
type P = { x: number; y: number; z: number; w: number; radius?: number };
type Mode = "edit" | "draw" | "boost" | "height" | "items";
type LayoutSnapshot = { points: P[]; roadWidth: number; autoBridges: boolean; boostPositions?: number[]; boostPads: number; boostLength: number; itemBoxPositions?: { t: number; offset: number }[]; itemRows: number };

const PRESET_HELP: Record<string, string> = {
  Oval: "Two straights and two wide turns. A good start.",
  "Figure eight": "The road crosses itself over a bridge.",
  Kidney: "An oval pushed in on one side: one tighter turn.",
  Hilly: "A wide loop going up and down three times.",
  Random: "A different wobbly loop every time.",
};

export function TrackGeneratorDialog({ hasSzs, close }: { hasSzs: boolean; close: (v: any) => void }) {
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const profile = React.useRef<HTMLCanvasElement>(null);
  const layoutPreview = React.useRef<TrackLayoutPreview | null>(null);
  const pts = React.useRef<P[]>(PRESETS.Oval().map((p: any) => ({ ...p, w: 1 })));
  const view = React.useRef({ cx: 0, cz: 0, scale: 0.008 });
  const drag = React.useRef<any>(null);
  const stroke = React.useRef<{ x: number; z: number }[] | null>(null);
  const history = React.useRef<{ undo: LayoutSnapshot[]; redo: LayoutSnapshot[] }>({ undo: [], redo: [] });
  const [params, setParams] = React.useState<any>({ ...DEFAULT_PARAMS });
  const [selected, setSelected] = React.useState(0);
  const [hover, setHover] = React.useState<{ point: number } | { segment: number; x: number; z: number } | null>(null);
  const [mode, setMode] = React.useState<Mode>("edit");
  const [preview3D, setPreview3D] = React.useState(false);
  const [keepProportions, setKeepProportions] = React.useState(true);
  const [drawError, setDrawError] = React.useState("");
  const [showAdjustments, setShowAdjustments] = React.useState(false);
  const fit3D = React.useRef<(() => void) | null>(null);
  const chooseTool = (next: Mode) => { setMode(next); setPreview3D(false); };
  const [keepSzs, setKeepSzs] = React.useState(false);
  const [tab, setTab] = React.useState("layout");
  const [textureBusy, setTextureBusy] = React.useState(false);
  const texturePreview = useTrackTextures(params);
  const [revision, redraw] = React.useReducer((x) => x + 1, 0);
  const [, repaint] = React.useReducer((x) => x + 1, 0);

  // Layout changes can be undone (Ctrl+Z / Ctrl+Y); the copy is taken before the change.
  const snapshot = (): LayoutSnapshot => ({ points: pts.current.map((p) => ({ ...p })), roadWidth: params.roadWidth, autoBridges: params.autoBridges, boostPositions: params.boostPositions?.slice(), boostPads: params.boostPads, boostLength: params.boostLength, itemBoxPositions: params.itemBoxPositions?.map((p: any) => ({ ...p })), itemRows: params.itemRows });
  const remember = () => {
    history.current.undo.push(snapshot());
    if (history.current.undo.length > 100) history.current.undo.shift();
    history.current.redo = [];
  };
  const step = (from: "undo" | "redo") => {
    const h = history.current, to = from === "undo" ? "redo" : "undo";
    const prev = h[from].pop();
    if (!prev) return;
    h[to].push(snapshot());
    pts.current = prev.points;
    setParams((p: any) => ({ ...p, roadWidth: prev.roadWidth, autoBridges: prev.autoBridges, boostPositions: prev.boostPositions, boostPads: prev.boostPads, boostLength: prev.boostLength, itemBoxPositions: prev.itemBoxPositions, itemRows: prev.itemRows }));
    setSelected((s) => Math.min(s, prev.points.length - 1));
    redraw();
  };

  const toScreen = (x: number, z: number) => { const v = view.current; return [W / 2 + (x - v.cx) * v.scale, H / 2 + (z - v.cz) * v.scale]; };
  const toWorld = (sx: number, sy: number) => { const v = view.current; return [(sx - W / 2) / v.scale + v.cx, (sy - H / 2) / v.scale + v.cz]; };
  const fit = () => {
    const p = pts.current;
    const xs = p.map((q) => q.x), zs = p.map((q) => q.z);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    view.current = { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, scale: Math.min((W - 140) / Math.max(1, maxX - minX), (H - 140) / Math.max(1, maxZ - minZ)) };
  };
  const setDrawingArea = (axis: "x" | "z", value: number) => {
    const width = axis === "x" ? value : value * W / H;
    view.current.scale = W / Math.max(MIN_VIEW_WIDTH, Math.min(MAX_VIEW_WIDTH, width));
    repaint();
  };
  const zoom = (factor: number) => { setDrawingArea("x", W / (view.current.scale * factor)); };

  // The centreline as it is built (bridges and spread-out slopes included), for the drawing and the height profile.
  const preview = React.useMemo(() => {
    try {
      const spline = pts.current.length >= 3 ? trackSamples(pts.current, params) : null;
      const track = pts.current.length >= 3 ? generateTrack(pts.current, params) : null;
      return { spline, track, frames: spline ? roadFrames(spline.samples, params) : [], issues: [...layoutIssues(pts.current, params), ...generatedTrackIssues(track)] };
    } catch (error) {
      // A failed preview must leave the layout, Undo and the dialog usable.
      return { spline: null, track: null, frames: [], issues: [{ level: "error", message: `Could not update the track preview: ${error instanceof Error ? error.message : String(error)}. Undo the last change or adjust the layout.`, at: [] }] };
    }
  }, [revision, params]); // eslint-disable-line react-hooks/exhaustive-deps
  const { spline, track: previewTrack, frames, issues } = preview;
  const previewModel = previewTrack?.model;

  const draw = React.useCallback(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    const v = view.current, points = pts.current;
    ctx.fillStyle = "#14161b";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#20242d";
    ctx.lineWidth = 1;
    const grid = 5000 * v.scale;
    const [ox, oy] = toScreen(0, 0);
    for (let x = ((ox % grid) + grid) % grid; x < W; x += grid) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = ((oy % grid) + grid) % grid; y < H; y += grid) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    if (spline && mode !== "draw") {
      const { samples } = spline;
      const n = samples.length;
      if (layoutPreview.current && previewModel) layoutPreview.current.draw(ctx, previewModel, texturePreview.textures, v);
      else {
      const patterns = new Map(Object.entries(texturePreview.textures).map(([role, texture]) => [role, ctx.createPattern(texture.bitmap, "repeat")!]));
      const triangles = (previewModel?.tris || []).filter((t: any) => ["road", "offroad", "startline", "boost", "curb"].includes(t.mat)).sort((a: any, b: any) => (a.v[1] + a.v[4] + a.v[7]) - (b.v[1] + b.v[4] + b.v[7]));
      for (const tri of triangles) {
        const polygon = [0, 1, 2].map((k) => toScreen(tri.v[k * 3], tri.v[k * 3 + 2])), texture = texturePreview.textures[tri.mat];
        if (texture) textureTriangle(ctx, polygon, tri.uv, texture, patterns.get(tri.mat)!);
        else { ctx.fillStyle = "#555"; ctx.beginPath(); polygon.forEach((p, k) => k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); ctx.fill(); }
      }
      }
      ctx.strokeStyle = "#ffffff55";
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      samples.forEach((s: number[], i: number) => { const [x, y] = toScreen(s[0], s[2]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 14))) {
        const a = samples[i], b = samples[(i + 1) % n];
        const [x, y] = toScreen(a[0], a[2]);
        ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2(b[2] - a[2], b[0] - a[0]));
        ctx.fillStyle = "#ffffffaa";
        ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-5, -5); ctx.lineTo(-5, 5); ctx.fill();
        ctx.restore();
      }
      const s0 = samples[0];
      const [sx, sy] = toScreen(s0[0], s0[2]);
      ctx.fillStyle = "#fff";
      ctx.font = "600 11px Inter, system-ui";
      ctx.fillText("START", sx + 8, sy - 8);
      if (mode === "boost") for (const [index, panel] of (previewTrack?.boosts || []).entries()) {
        const [x, y] = toScreen(panel.pos[0], panel.pos[2]);
        ctx.strokeStyle = "#ffcf40"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = "#ffcf40"; ctx.fillText(`⚡ ${index + 1}`, x + 12, y - 10);
      }
      // Problems found in the layout, where they are.
      for (const [index, box] of (previewTrack?.itemBoxes || []).entries()) {
        const [x, y] = toScreen(box.pos[0], box.pos[2]), size = mode === "items" ? 14 : 8;
        ctx.fillStyle = "#2563eb"; ctx.strokeStyle = "#bfdbfe"; ctx.lineWidth = 1;
        ctx.fillRect(x - size / 2, y - size / 2, size, size); ctx.strokeRect(x - size / 2, y - size / 2, size, size);
        if (mode === "items") { ctx.fillStyle = "white"; ctx.font = "bold 12px system-ui"; ctx.textAlign = "center"; ctx.fillText("?", x, y + 4); ctx.textAlign = "start"; ctx.font = "10px system-ui"; ctx.fillText(String(index + 1), x + 10, y + 3); }
      }
      for (const issue of issues) if (issue.level !== "info" || showAdjustments) for (const [x, z] of issue.at) {
        const [px, py] = toScreen(x, z);
        ctx.strokeStyle = issue.level === "error" ? "#ef4444" : issue.level === "warning" ? "#f59e0b" : "#60a5fa";
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(px, py, Math.max(12, params.roadWidth * v.scale * 0.8), 0, Math.PI * 2); ctx.stroke();
      }
    }
    if (mode === "edit" || mode === "height") {
      const corner = curveCorner(points, selected);
      if (corner) {
        const middle = cornerArc(corner, .5), [cx, cy] = toScreen(corner.center[0], corner.center[1]), [mx, my] = toScreen(middle[0], middle[1]);
        ctx.strokeStyle = "#facc1599"; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(mx, my); ctx.stroke(); ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(cx - 3, cy); ctx.lineTo(cx + 3, cy); ctx.moveTo(cx, cy - 3); ctx.lineTo(cx, cy + 3); ctx.stroke();
        ctx.font = "11px Inter, system-ui"; ctx.fillStyle = "#facc15"; ctx.fillText(`R ${Math.round(corner.radius)}`, (cx + mx) / 2 + 5, (cy + my) / 2 - 5);
      }
      // Where a click adds a point: on the segment under the cursor.
      if (mode === "edit" && hover && "segment" in hover) {
        const [x, y] = toScreen(hover.x, hover.z);
        ctx.strokeStyle = "#facc15"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y); ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4); ctx.stroke();
      }
      points.forEach((p, i) => {
        const [x, y] = toScreen(p.x, p.z);
        const hot = hover && "point" in hover && hover.point === i;
        ctx.fillStyle = i === selected ? "#facc15" : i === 0 ? "#ff4d6d" : "#60a5fa";
        ctx.beginPath(); ctx.arc(x, y, i === selected || hot ? 8 : 6, 0, Math.PI * 2); ctx.fill();
        if (hot) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.stroke(); }
        ctx.font = "11px Inter, system-ui";
        if (mode === "height") {
          const label = `${i} · ${Math.round(p.y)}`;
          ctx.fillStyle = "#14161be8"; ctx.fillRect(x + 9, y - 25, ctx.measureText(label).width + 10, 18);
          ctx.fillStyle = i === selected ? "#facc15" : "#e5e7eb"; ctx.fillText(label, x + 14, y - 12);
        } else {
          ctx.fillStyle = "#e5e7eb"; ctx.fillText(String(i), x + 9, y + 4);
        }
      });
    }
    // A line being drawn by hand.
    const s = stroke.current;
    if (s && s.length > 1) {
      ctx.strokeStyle = "#facc15"; ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath();
      s.forEach((p, i) => { const [x, y] = toScreen(p.x, p.z); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
      const [lx, ly] = toScreen(s[s.length - 1].x, s[s.length - 1].z);
      const [fx, fy] = toScreen(s[0].x, s[0].z);
      ctx.save(); ctx.setLineDash([5, 5]); ctx.strokeStyle = "#9ca3af"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(fx, fy); ctx.stroke(); ctx.restore();
      ctx.fillStyle = "#ff4d6d"; ctx.beginPath(); ctx.arc(fx, fy, 6, 0, Math.PI * 2); ctx.fill();
    } else if (mode === "draw") {
      ctx.fillStyle = "#9ca3af"; ctx.font = "13px Inter, system-ui"; ctx.textAlign = "center";
      ctx.fillText("Hold the left button and draw the track in one stroke.", W / 2, H / 2 - 8);
      ctx.fillText("Where you start is the finish line; the end joins the start by itself.", W / 2, H / 2 + 12);
      ctx.textAlign = "start";
    }
  }, [params, selected, hover, mode, spline, issues, previewTrack, texturePreview.textures, showAdjustments]); // eslint-disable-line react-hooks/exhaustive-deps

  // Height along the track: the road from the start line round to it again, with the control points.
  const drawProfile = React.useCallback(() => {
    const ctx = profile.current?.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#14161b"; ctx.fillRect(0, 0, W, PH);
    if (!spline) return;
    const { samples } = spline;
    const baseline = spline.heightOffset || 0;
    const ys = samples.map((s: number[]) => s[1] - baseline);
    const lo = Math.min(-500, ...ys), hi = Math.max(1500, ...ys);
    const yOf = (y: number) => PH - 12 - ((y - baseline - lo) / (hi - lo)) * (PH - 26);
    ctx.strokeStyle = "#20242d"; ctx.beginPath(); ctx.moveTo(0, yOf(baseline)); ctx.lineTo(W, yOf(baseline)); ctx.stroke();
    ctx.fillStyle = "#3b4252";
    ctx.beginPath(); ctx.moveTo(0, PH);
    samples.forEach((s: number[], i: number) => ctx.lineTo((i / samples.length) * W, yOf(s[1])));
    ctx.lineTo(W, yOf(samples[0][1])); ctx.lineTo(W, PH); ctx.fill();
    ctx.fillStyle = "#9ca3af"; ctx.font = "10px Inter, system-ui";
    ctx.fillText(`height ${Math.round(Math.min(...ys))} – ${Math.round(Math.max(...ys))}`, 6, 12);
    // Control points along the profile: the nearest sample to each.
    pts.current.forEach((p, i) => {
      let best = 0, bd = Infinity;
      samples.forEach((s: number[], k: number) => { const d = (s[0] - p.x) ** 2 + (s[2] - p.z) ** 2; if (d < bd) { bd = d; best = k; } });
      const x = (best / samples.length) * W;
      ctx.fillStyle = i === selected ? "#facc15" : i === 0 ? "#ff4d6d" : "#60a5fa";
      ctx.beginPath(); ctx.arc(x, yOf(samples[best][1]), i === selected ? 5 : 3.5, 0, Math.PI * 2); ctx.fill();
    });
  }, [spline, selected]);

  React.useEffect(() => {
    try { layoutPreview.current = new TrackLayoutPreview(W, H); } catch { /* Canvas fallback when WebGL is unavailable. */ }
    fit(); redraw();
    return () => { layoutPreview.current?.dispose(); layoutPreview.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { draw(); drawProfile(); });
  React.useEffect(() => {
    if (!Object.values(texturePreview.textures).some((t) => t.native) || mode === "draw") return;
    let frame = 0, last = 0;
    const tick = (now: number) => { if (now - last >= 1000 / 30) { draw(); last = now; } frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
  }, [draw, texturePreview.textures, mode]);

  // Keys inside the dialog: Delete removes the selected point, arrows nudge it, Ctrl+Z / Ctrl+Y undo.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, [role=slider]")) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === "z") { e.preventDefault(); e.stopPropagation(); step(e.shiftKey ? "redo" : "undo"); return; }
      if (ctrl && e.key.toLowerCase() === "y") { e.preventDefault(); e.stopPropagation(); step("redo"); return; }
      const p = pts.current[selected];
      if (p && (mode === "height" || preview3D) && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault(); e.stopPropagation();
        const y = clampHeight(p.y + (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 1000 : 100));
        if (y !== p.y) { remember(); p.y = y; redraw(); }
        return;
      }
      if (!p || mode !== "edit" || preview3D) return;
      if ((e.key === "Delete" || e.key === "Backspace") && pts.current.length > 3) {
        e.preventDefault(); e.stopPropagation(); remember();
        pts.current.splice(selected, 1); setSelected((s) => Math.min(s, pts.current.length - 1)); redraw();
      }
      const d = e.shiftKey ? 1000 : 200;
      const move = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[e.key];
      if (move) { e.preventDefault(); e.stopPropagation(); remember(); p.x += move[0]; p.z += move[1]; redraw(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [selected, mode, params, preview3D]); // eslint-disable-line react-hooks/exhaustive-deps

  const nearestPoint = (sx: number, sy: number) => {
    let best = -1, bd = 14 * 14;
    pts.current.forEach((p, i) => { const [x, y] = toScreen(p.x, p.z); const d = (x - sx) ** 2 + (y - sy) ** 2; if (d < bd) { bd = d; best = i; } });
    return best;
  };
  const nearestSegment = (wx: number, wz: number) => {
    return nearestLayoutSegment(pts.current, wx, wz)!;
  };
  const local = (e: React.PointerEvent | React.WheelEvent) => { const r = canvas.current!.getBoundingClientRect(); return [(e.clientX - r.left) * (W / r.width), (e.clientY - r.top) * (H / r.height)]; };
  const boostAt = (sx: number, sy: number) => {
    if (!spline) return null;
    const [x, z] = toWorld(sx, sy); let best = 0, distance = Infinity;
    spline.samples.forEach((s: number[], i: number) => { const d = Math.hypot(s[0] - x, s[2] - z); if (d < distance) { best = i; distance = d; } });
    return distance * view.current.scale <= Math.max(20, (params.roadWidth / 2 + params.offroadWidth) * view.current.scale) ? Math.max(1, best) / spline.samples.length : null;
  };

  const itemAt = (sx: number, sy: number) => {
    if (!frames.length) return null;
    const [x, z] = toWorld(sx, sy); let best: { t: number; offset: number } | null = null, distance = Infinity;
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i], g = frames[(i + 1) % frames.length], dx = g.c[0] - f.c[0], dz = g.c[2] - f.c[2];
      const a = Math.max(0, Math.min(1, ((x - f.c[0]) * dx + (z - f.c[2]) * dz) / (dx * dx + dz * dz || 1)));
      const cx = f.c[0] + dx * a, cz = f.c[2] + dz * a, d = Math.hypot(x - cx, z - cz);
      if (d >= distance || d * view.current.scale > Math.max(20, (f.half + params.offroadWidth) * view.current.scale)) continue;
      distance = d;
      const lx = f.left[0] * (1 - a) + g.left[0] * a, lz = f.left[1] * (1 - a) + g.left[1] * a;
      const across = ((x - cx) * lx + (z - cz) * lz) / (Math.hypot(lx, lz) || 1);
      const width = across < 0 ? f.hr * (1 - a) + g.hr * a : f.hl * (1 - a) + g.hl * a;
      best = { t: (i + a) / frames.length, offset: Math.max(-.9, Math.min(.9, across / Math.max(1, width))) };
    }
    return best;
  };
  const onPointerDown = (e: React.PointerEvent) => {
    const [sx, sy] = local(e);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (e.button === 1 || (e.button === 0 && e.altKey)) { drag.current = { pan: true, sx, sy, cx: view.current.cx, cz: view.current.cz }; return; }
    if (mode === "items") {
      const boxes = previewTrack?.itemBoxes || [], existing = boxes.findIndex((box: any) => { const [x, y] = toScreen(box.pos[0], box.pos[2]); return Math.hypot(x - sx, y - sy) < 12; });
      const positions = boxes.map((box: any) => ({ t: box.t, offset: box.offset }));
      if (e.button === 2) { if (existing >= 0) { remember(); positions.splice(existing, 1); setParams((p: any) => ({ ...p, itemBoxPositions: positions })); } return; }
      if (e.button !== 0) return;
      const position = itemAt(sx, sy); if (!position) return;
      remember(); const index = existing >= 0 ? existing : positions.length;
      positions[index] = position; setParams((p: any) => ({ ...p, itemBoxPositions: positions }));
      drag.current = { item: index, positions }; return;
    }
    if (mode === "boost") {
      const panels = previewTrack?.boosts || [], existing = panels.findIndex((panel: any) => { const [x, y] = toScreen(panel.pos[0], panel.pos[2]); return Math.hypot(x - sx, y - sy) < 14; });
      const positions = panels.map((panel: any) => panel.t);
      if (e.button === 2) { if (existing >= 0) { remember(); positions.splice(existing, 1); setParams((p: any) => ({ ...p, boostPositions: positions })); } return; }
      if (e.button !== 0) return;
      const t = boostAt(sx, sy); if (t === null) return;
      remember();
      const index = existing >= 0 ? existing : positions.length;
      if (index >= 32) return;
      positions[index] = t; setParams((p: any) => ({ ...p, boostPositions: positions }));
      drag.current = { boost: index, positions }; return;
    }
    if (mode === "draw") {
      if (e.button !== 0) return;
      const [wx, wz] = toWorld(sx, sy);
      setDrawError("");
      stroke.current = [{ x: wx, z: wz }];
      return;
    }
    const i = nearestPoint(sx, sy);
    const p = pts.current;
    if (mode === "height") {
      if (e.button === 0 && i >= 0) {
        setSelected(i);
        drag.current = { height: i, sy, y: p[i].y, unitsPerPixel: e.shiftKey ? 10 : 50, changed: false };
      }
      return;
    }
    if (e.button === 2) {
      if (i >= 0 && p.length > 3) { remember(); p.splice(i, 1); setSelected((s) => Math.min(s, p.length - 1)); setHover(null); redraw(); }
      return;
    }
    if (e.button !== 0) return;
    remember();
    const pointDrag = (i: number) => ({ i, sx, sy, x: p[i].x, z: p[i].z, moved: false });
    if (i >= 0) { setSelected(i); drag.current = pointDrag(i); }
    else {
      const [wx, wz] = toWorld(sx, sy);
      const hit = nearestSegment(wx, wz), { segment } = hit;
      p.splice(segment + 1, 0, { x: Math.round(hit.at[0] / 50) * 50, z: Math.round(hit.at[1] / 50) * 50, y: clampHeight(Math.round(hit.height)), w: Math.max(.5, Math.min(2.5, hit.width)) });
      setSelected(segment + 1);
      drag.current = pointDrag(segment + 1);
    }
    redraw();
  };
  const collectStroke = (e: React.PointerEvent) => {
    if (!stroke.current) return;
    const r = canvas.current!.getBoundingClientRect();
    const events = [...(e.nativeEvent.getCoalescedEvents?.() || []), e.nativeEvent];
    for (const event of events) {
      const [wx, wz] = toWorld((event.clientX - r.left) * W / r.width, (event.clientY - r.top) * H / r.height);
      const last = stroke.current[stroke.current.length - 1];
      if (Math.hypot(wx - last.x, wz - last.z) * view.current.scale >= .5) stroke.current.push({ x: wx, z: wz });
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const [sx, sy] = local(e);
    const dg = drag.current;
    if (dg?.item !== undefined) {
      const position = itemAt(sx, sy); if (position) { const positions = [...dg.positions]; positions[dg.item] = position; setParams((p: any) => ({ ...p, itemBoxPositions: positions })); }
      return;
    }
    if (dg?.height !== undefined) {
      const p = pts.current[dg.height], y = clampHeight(Math.round((dg.y + (dg.sy - sy) * dg.unitsPerPixel) / 10) * 10);
      if (p.y !== y) { if (!dg.changed) { remember(); dg.changed = true; } p.y = y; redraw(); }
      return;
    }
    if (dg?.boost !== undefined) {
      const t = boostAt(sx, sy); if (t !== null) { const positions = [...dg.positions]; positions[dg.boost] = t; setParams((p: any) => ({ ...p, boostPositions: positions })); }
      return;
    }
    if (stroke.current) {
      collectStroke(e); draw();
      return;
    }
    if (!dg) {
      if (mode !== "edit" && mode !== "height") return;
      const i = nearestPoint(sx, sy);
      if (i >= 0) { if (!(hover && "point" in hover && hover.point === i)) setHover({ point: i }); return; }
      if (mode === "height") { setHover(null); return; }
      const [wx, wz] = toWorld(sx, sy);
      const near = nearestSegment(wx, wz);
      setHover(near.distance * view.current.scale < 40 ? { segment: near.segment, x: near.at[0], z: near.at[1] } : null);
      return;
    }
    if (dg.pan) { view.current.cx = dg.cx - (sx - dg.sx) / view.current.scale; view.current.cz = dg.cz - (sy - dg.sy) / view.current.scale; }
    else {
      if (!dg.moved && Math.hypot(sx - dg.sx, sy - dg.sy) < 3) return;
      dg.moved = true;
      pts.current[dg.i].x = Math.round((dg.x + (sx - dg.sx) / view.current.scale) / 50) * 50;
      pts.current[dg.i].z = Math.round((dg.z + (sy - dg.sy) / view.current.scale) / 50) * 50;
      redraw();
    }
    draw();
  };
  const onPointerUp = (e: React.PointerEvent) => {
    // WebView can coalesce the final pointermove while rebuilding the mesh.
    // Commit the release position so a dragged box/panel is saved where dropped.
    if (e.type !== "pointercancel" && (drag.current?.item !== undefined || drag.current?.boost !== undefined || drag.current?.moved)) onPointerMove(e);
    drag.current = null;
    if (stroke.current) {
      if (e.type === "pointercancel") { stroke.current = null; setMode("edit"); repaint(); return; }
      collectStroke(e);
      let made;
      try { made = pointsFromStroke(stroke.current, { tolerance: 2 / view.current.scale }); }
      catch { made = null; }
      stroke.current = null;
      if (made) { remember(); pts.current = made; setSelected(0); setMode("edit"); setDrawError(""); redraw(); }
      else { setDrawError("Draw a longer loop with fewer tiny zigzags. The previous layout is kept; lift the mouse near the red start point to close the loop."); repaint(); }
    }
  };
  const onWheel = (e: React.WheelEvent) => {
    if (stroke.current) return;
    const [sx, sy] = local(e);
    const [wx, wz] = toWorld(sx, sy);
    const width = W / (view.current.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
    view.current.scale = W / Math.max(MIN_VIEW_WIDTH, Math.min(MAX_VIEW_WIDTH, width));
    const [nx, nz] = toWorld(sx, sy);
    view.current.cx += wx - nx;
    view.current.cz += wz - nz;
    draw();
    repaint();
  };

  const sp = pts.current[selected];
  const selectedCorner = curveCorner(pts.current, selected);
  const radiusRange = curveCorner(pts.current.map((p, i) => i === selected ? { ...p, radius: 200000 } : p), selected);
  const radiusSliderMax = Math.max(100, Math.min(200000, Math.ceil((radiusRange?.maximum ?? 20000) / 100) * 100));
  const bounds = layoutBounds(pts.current);
  const changeMapSize = (axis: "x" | "z", value: number) => {
    if (!(bounds.width > 0 && bounds.depth > 0)) return;
    let width = axis === "x" ? value : bounds.width, depth = axis === "z" ? value : bounds.depth;
    if (keepProportions) {
      const factor = Math.max(Math.max(1000 / bounds.width, 1000 / bounds.depth), Math.min(Math.min(200000 / bounds.width, 200000 / bounds.depth), value / (axis === "x" ? bounds.width : bounds.depth)));
      width = bounds.width * factor; depth = bounds.depth * factor;
    }
    remember(); pts.current = resizeLayout(pts.current, width, depth); fit(); redraw();
  };
  const changeHeight = (value: number) => {
    const y = clampHeight(value);
    if (sp && sp.y !== y) { remember(); sp.y = y; redraw(); }
  };
  const changeWidth = (value: number) => {
    if (sp && sp.w !== value) { remember(); sp.w = value; redraw(); }
  };
  const changeRadius = (value: number) => {
    if (sp && (sp.radius || 0) !== value) { remember(); sp.radius = value; redraw(); }
  };
  const changeRoadWidth = (value: number) => {
    const width = Math.max(800, Math.min(8000, value));
    if (width !== params.roadWidth) { remember(); setParams((p: any) => ({ ...p, roadWidth: width })); }
  };
  const setParam = (key: string, value: any) => setParams((p: any) => ({ ...p, [key]: value }));
  const num = (key: string, label: string, min: number, max: number, stepSize: number, help: string, unit?: (v: number) => string) => (
    <div key={key} className="grid grid-cols-[1fr_110px] items-center gap-x-3 gap-y-0.5">
      <Label className="flex items-center gap-1.5">{label}</Label>
      <NumberField aria-label={label} value={params[key]} min={min} max={max} step={stepSize} onValue={(n) => setParam(key, n)} />
      <p className="col-span-2 m-0 text-[11px] leading-snug text-muted-foreground">{help}{unit ? ` ${unit(params[key])}` : ""}</p>
    </div>
  );
  const karts = (v: number) => `Now about ${(v / KART).toFixed(1)} karts.`;
  const errors = issues.filter((i: any) => i.level === "error");
  const length = spline?.length || 0;

  const modeHelp = mode === "items" ? "Item boxes: click the road to place a box · drag a blue box to move it along or across the road · right-click to remove it · Ctrl+Z / Ctrl+Y undo and redo."
    : mode === "height" ? "Drag a point up to raise the road or down to lower it. Hold Shift before dragging for finer control. ↑ / ↓ adjust the selected point; Ctrl+Z / Ctrl+Y undo and redo."
    : mode === "boost" ? "Boost panels: click the road to add one · drag a yellow marker to move it · right-click its marker to remove it · Ctrl+Z undoes the placement."
    : mode === "draw"
    ? "Draw the whole loop in one stroke. The curve follows your line; the dashed segment shows how it closes back to the red start point."
    : "Drag a point to move it · click the road (yellow +) to add a point there · right-click or Delete removes the selected point · arrows nudge it · wheel zooms · middle-drag or Alt+drag pans";

  return (
    <>
      <DialogHeader>
        <DialogTitle>Create a new track</DialogTitle>
        <DialogDescription>Choose a track style and draw the layout, then customise the road, textures and race settings. The editor builds the models, collision, checkpoints, routes, respawns, item boxes and cameras.</DialogDescription>
      </DialogHeader>
      <div className="grid min-h-0 grid-cols-[minmax(0,1.35fr)_minmax(290px,1fr)] gap-5 overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-col gap-2 overflow-y-auto pr-1">
          <div className="flex shrink-0 flex-wrap items-center gap-1" role="toolbar" aria-label="Drawing tools">
            <Hint title="Edit points" text="Move, add and remove the control points of the layout."><Button size="sm" variant={mode === "edit" && !preview3D ? "secondary" : "ghost"} aria-pressed={mode === "edit" && !preview3D} onClick={() => chooseTool("edit")}><MousePointer2 /> Edit points</Button></Hint>
            <Hint title="Road height" text="Raise or lower the road by dragging its points vertically. The layout stays in place."><Button size="sm" variant={mode === "height" && !preview3D ? "secondary" : "ghost"} aria-pressed={mode === "height" && !preview3D} aria-label="Edit road height" onClick={() => { chooseTool("height"); setHover(null); }}><ArrowUpDown /> Height</Button></Hint>
            <Hint title="Draw by hand" text="Trace the whole track with the mouse in one stroke; it replaces the current layout (Undo brings it back)."><Button size="sm" variant={mode === "draw" && !preview3D ? "secondary" : "ghost"} aria-pressed={mode === "draw" && !preview3D} onClick={() => chooseTool("draw")}><PenLine /> Draw by hand</Button></Hint>
            <Hint title="Place boost panels" text="Click the road to add an animated boost panel. Drag its marker to move it; right-click to remove it."><Button size="sm" variant={mode === "boost" && !preview3D ? "secondary" : "ghost"} aria-pressed={mode === "boost" && !preview3D} aria-label="Place boost panels" onClick={() => chooseTool("boost")}><Zap /> Boost panels</Button></Hint>
            <Hint title="Place item boxes" text="Click the road to add an item box. Drag a box along or across the road; right-click removes it."><Button size="sm" variant={mode === "items" && !preview3D ? "secondary" : "ghost"} aria-pressed={mode === "items" && !preview3D} aria-label="Place item boxes" onClick={() => chooseTool("items")}><Package /> Item boxes</Button></Hint>
            <div className="flex w-full flex-wrap items-center gap-1">
            <div role="group" aria-label="Generator view" className="mr-1 flex shrink-0 items-center rounded-md border bg-muted/30 p-0.5">
              <Button size="sm" variant={!preview3D ? "secondary" : "ghost"} aria-label="Show 2D layout" aria-pressed={!preview3D} onClick={() => setPreview3D(false)}><MapIcon /> 2D</Button>
              <Button size="sm" variant={preview3D ? "secondary" : "ghost"} aria-label="Show 3D preview" aria-pressed={preview3D} onClick={() => { setPreview3D(true); if (mode === "draw") setMode("edit"); }}><Box /> 3D</Button>
            </div>
            <Hint title="Undo" shortcut="Ctrl+Z" text="Undo the last change to the layout."><span className="inline-flex"><Button size="icon-sm" variant="ghost" aria-label="Undo" disabled={!history.current.undo.length} onClick={() => step("undo")}><Undo2 /></Button></span></Hint>
            <Hint title="Redo" shortcut="Ctrl+Y" text="Redo the change you undid."><span className="inline-flex"><Button size="icon-sm" variant="ghost" aria-label="Redo" disabled={!history.current.redo.length} onClick={() => step("redo")}><Redo2 /></Button></span></Hint>
            <span className="mx-1 h-5 w-px bg-border" />
            <Hint title="Reverse direction" text="Drive the same layout the other way round."><Button size="icon-sm" variant="ghost" aria-label="Reverse direction" onClick={() => { remember(); pts.current = reverseLayout(pts.current); redraw(); }}><FlipHorizontal2 /></Button></Hint>
            <Hint title="Make smaller" text="Shrink the whole layout by 10% (heights stay)."><Button size="icon-sm" variant="ghost" aria-label="Make the layout smaller" onClick={() => { remember(); pts.current = scaleLayout(pts.current, 0.9); redraw(); }}><ZoomOut /></Button></Hint>
            <Hint title="Make larger" text="Grow the whole layout by 10% (heights stay)."><Button size="icon-sm" variant="ghost" aria-label="Make the layout larger" onClick={() => { remember(); pts.current = scaleLayout(pts.current, 1.1); redraw(); }}><ZoomIn /></Button></Hint>
            <Hint title="Fit view" text="Show the whole layout."><Button size="icon-sm" variant="ghost" aria-label="Fit view" onClick={() => { if (preview3D) fit3D.current?.(); else { fit(); redraw(); } }}><Maximize /></Button></Hint>
            <span className="ml-auto text-[11px] text-muted-foreground">grid square = 5000 units ≈ {Math.round(5000 / KART)} karts</span>
            </div>
          </div>
          {!preview3D && <div className="flex shrink-0 items-center gap-2 rounded-md border bg-muted/20 px-2.5 py-2" data-map-zoom>
            <Label className="shrink-0 text-xs">Map zoom</Label>
            <Button size="icon-sm" variant="ghost" aria-label="Zoom 2D map out" disabled={W / view.current.scale >= MAX_VIEW_WIDTH - 1} onClick={() => zoom(1 / 1.15)}><Minus /></Button>
            <Slider min={0} max={100} step={1} value={[Math.max(0, Math.min(100, 100 * Math.log(MAX_VIEW_WIDTH * view.current.scale / W) / Math.log(MAX_VIEW_WIDTH / MIN_VIEW_WIDTH)))]} aria-label="2D map zoom" onValueChange={([value]) => setDrawingArea("x", MAX_VIEW_WIDTH * (MIN_VIEW_WIDTH / MAX_VIEW_WIDTH) ** (value / 100))} />
            <Button size="icon-sm" variant="ghost" aria-label="Zoom 2D map in" disabled={W / view.current.scale <= MIN_VIEW_WIDTH + 1} onClick={() => zoom(1.15)}><Plus /></Button>
            <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">{Math.round(view.current.scale * 50000 / W * 100)}%</span>
          </div>}
          <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-md border bg-muted/20 px-2.5 py-2" data-map-size>
            <span className="text-xs font-medium">Track dimensions</span>
            <InfoTip text="Game units between the outer control points. Resizes the real layout; road width and heights keep their own settings." />
            <div className="flex items-center gap-1.5"><Label htmlFor="generator-map-width" className="text-xs">X</Label><NumberField id="generator-map-width" aria-label="Track map width" className="h-7 w-24 text-xs" min={1000} max={200000} step={1000} integer commit value={Math.round(bounds.width)} onValue={(v) => changeMapSize("x", v)} /></div>
            <div className="flex items-center gap-1.5"><Label htmlFor="generator-map-depth" className="text-xs">Z</Label><NumberField id="generator-map-depth" aria-label="Track map depth" className="h-7 w-24 text-xs" min={1000} max={200000} step={1000} integer commit value={Math.round(bounds.depth)} onValue={(v) => changeMapSize("z", v)} /></div>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs"><Checkbox aria-label="Keep map proportions" checked={keepProportions} onCheckedChange={(v) => setKeepProportions(v === true)} />Keep proportions</label>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-md border bg-muted/20 px-2.5 py-2">
            <Label htmlFor="generator-road-width" className="text-xs">Road width</Label>
            <div className="flex items-center gap-1">
              <Button size="icon-sm" variant="outline" className="size-7" aria-label="Decrease road width" disabled={params.roadWidth <= 800} onClick={() => changeRoadWidth(params.roadWidth - 100)}><Minus /></Button>
              <NumberField id="generator-road-width" aria-label="Overall road width" className="h-7 w-24 text-xs" min={800} max={8000} step={100} integer commit value={params.roadWidth} onValue={changeRoadWidth} />
              <Button size="icon-sm" variant="outline" className="size-7" aria-label="Increase road width" disabled={params.roadWidth >= 8000} onClick={() => changeRoadWidth(params.roadWidth + 100)}><Plus /></Button>
            </div>
            <span className="text-[11px] text-muted-foreground">{karts(params.roadWidth)}</span>
            <InfoTip text="Changes the whole road in both previews and in the exported model and collision. The starting grid stays at least 3200 units wide to fit all twelve karts." />
          </div>
          {mode === "draw" && <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-md border bg-muted/20 px-2.5 py-2" data-drawing-area>
            <span className="text-xs font-medium">Drawing area</span>
            <InfoTip text="World units visible on the canvas. This sets the view zoom; it does not resize the track. X and Z follow the canvas proportions." />
            <div className="flex items-center gap-1.5"><Label htmlFor="generator-view-width" className="text-xs">X</Label><NumberField id="generator-view-width" aria-label="Drawing area width" className="h-7 w-24 text-xs" min={MIN_VIEW_WIDTH} max={MAX_VIEW_WIDTH} step={1000} integer commit value={Math.round(W / view.current.scale)} onValue={(v) => setDrawingArea("x", v)} /></div>
            <div className="flex items-center gap-1.5"><Label htmlFor="generator-view-depth" className="text-xs">Z</Label><NumberField id="generator-view-depth" aria-label="Drawing area depth" className="h-7 w-24 text-xs" min={Math.ceil(MIN_VIEW_WIDTH * H / W)} max={Math.floor(MAX_VIEW_WIDTH * H / W)} step={1000} integer commit value={Math.round(H / view.current.scale)} onValue={(v) => setDrawingArea("z", v)} /></div>
          </div>}
          {sp && mode !== "draw" && <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-md border bg-muted/20 px-2.5 py-2" data-height-controls>
            <Select value={String(selected)} onValueChange={(v) => setSelected(Number(v))}>
              <SelectTrigger aria-label="Road control point" className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{pts.current.map((_, i) => <SelectItem key={i} value={String(i)}>Point {i}{i === 0 ? " (start)" : ""}</SelectItem>)}</SelectContent>
            </Select>
            <Hint title="Set start here" text="Use the selected road point as the start and finish line. Choose a straighter section with room behind it for all twelve karts."><Button size="sm" variant="ghost" disabled={selected === 0} aria-label="Set start here" onClick={() => { remember(); const next = startLayoutAt(pts.current, params, selected); pts.current = next.points; setParams(next.params); setSelected(0); redraw(); }}><Flag /> Set start here</Button></Hint>
            <div className="ml-auto flex items-center gap-1.5">
            <Label htmlFor="generator-point-height" className="text-xs">Height</Label>
            <Button size="icon-sm" variant="ghost" aria-label="Lower selected road point" onClick={() => changeHeight(sp.y - 100)}><ArrowDown /></Button>
            <NumberField key={selected} id="generator-point-height" aria-label="Selected road point height" className="h-7 w-24 text-xs" min={MIN_HEIGHT} max={MAX_HEIGHT} step={100} integer commit value={sp.y} onValue={changeHeight} />
            <Button size="icon-sm" variant="ghost" aria-label="Raise selected road point" onClick={() => changeHeight(sp.y + 100)}><ArrowUp /></Button>
            <span className="text-[11px] text-muted-foreground">units</span>
            </div>
          </div>}
          {preview3D ? <TrackGeneratorPreview3D model={previewModel} textures={texturePreview.textures} points={pts.current.map((p) => ({ ...p, y: p.y + (spline?.heightOffset || 0) }))} samples={spline?.samples || []} itemBoxes={previewTrack?.itemBoxes || []} selected={selected} onSelect={setSelected} fitRef={fit3D} />
            : <canvas ref={canvas} width={W} height={H} className={cn("h-auto w-full shrink-0 touch-none rounded-lg border", mode === "draw" ? "cursor-crosshair" : mode === "height" && hover && "point" in hover ? "cursor-ns-resize" : hover && "point" in hover ? "cursor-grab" : hover ? "cursor-copy" : "cursor-default")} onContextMenu={(e) => e.preventDefault()}
              onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onPointerLeave={() => setHover(null)} onWheel={onWheel} data-testid="generator-canvas" />}
          <p className="m-0 min-h-8 shrink-0 text-[11px] leading-relaxed text-muted-foreground">{preview3D ? "Live 3D preview: select a blue point and change its Height above. Return to 2D to draw, drag road points or place boost panels." : modeHelp}</p>
          {mode === "draw" && drawError && <p role="alert" className="m-0 text-xs text-destructive">{drawError}</p>}
          <div className="shrink-0">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">Height along the track, from the start line <InfoTip text="Height is relative to the track's safe baseline. Moving points on the map keeps a flat track flat. Automatic bridges can be enabled in Road to add ramps at actual crossings." /></div>
            <canvas ref={profile} width={W} height={PH} className="w-full rounded-md border" aria-label="Height profile" />
          </div>
        </div>
        <div className="flex min-h-0 flex-col overflow-hidden">
          <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
            <TabsList className="grid w-full shrink-0 grid-cols-4">
              <TabsTrigger value="layout">1 · Shape</TabsTrigger>
              <TabsTrigger value="road">2 · Road</TabsTrigger>
              <TabsTrigger value="textures">3 · Textures</TabsTrigger>
              <TabsTrigger value="race">4 · Race</TabsTrigger>
            </TabsList>
            <div className="min-h-0 flex-1 overflow-y-auto pr-1 pt-3">
              <TabsContent value="layout" className="mt-0 flex flex-col gap-3">
                <TrackStylePicker params={params} change={setParam} textures={texturePreview.textures} />
                <p className="m-0 text-xs leading-relaxed text-muted-foreground">Start from a ready shape or draw your own, then drag the points. The red point is the finish line; the arrows show the driving direction. The layout stays as drawn. Select a point and use Set start here to move the starting grid to a straighter section.</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {Object.keys(PRESETS).map((name) => (
                    <button key={name} type="button" className="cursor-pointer rounded-md border px-2.5 py-2 text-left hover:bg-accent"
                      onClick={() => { remember(); pts.current = PRESETS[name]().map((p: any) => ({ ...p, w: p.w ?? 1 })); setSelected(0); setMode("edit"); fit(); redraw(); }}>
                      <span className="block text-xs font-medium">{name}</span>
                      <span className="block text-[11px] leading-snug text-muted-foreground">{PRESET_HELP[name]}</span>
                    </button>
                  ))}
                  <button type="button" className="cursor-pointer rounded-md border px-2.5 py-2 text-left hover:bg-accent" onClick={() => chooseTool("draw")}>
                    <span className="block text-xs font-medium">Draw by hand</span>
                    <span className="block text-[11px] leading-snug text-muted-foreground">Trace the track with the mouse.</span>
                  </button>
                </div>
                {sp && (
                  <div className="rounded-md border p-3" data-selected-point>
                    <div className="mb-2 text-xs font-medium">Selected point {selected}{selected === 0 ? " (start)" : ""} <span className="font-normal text-muted-foreground">of {pts.current.length}</span></div>
                    <div className="grid grid-cols-[88px_minmax(0,1fr)_80px] items-center gap-x-3 gap-y-2">
                      <Label>Height</Label>
                      <Slider min={-3000} max={8000} step={100} value={[sp.y]} onPointerDownCapture={remember} onValueChange={([v]) => { sp.y = v; redraw(); }} aria-label="Height" />
                      <span className="text-right text-xs tabular-nums">{sp.y}</span>
                      <Label htmlFor="generator-point-width">Width ×</Label>
                      <Slider min={0.5} max={2.5} step={0.05} value={[sp.w]} onPointerDownCapture={remember} onValueChange={([v]) => { sp.w = v; redraw(); }} aria-label="Width" />
                      <NumberField key={`width-${selected}`} id="generator-point-width" aria-label="Selected road point width" className="h-7 w-20 text-xs" min={.5} max={2.5} step={.05} commit value={sp.w} onValue={changeWidth} />
                      <Label htmlFor="generator-curve-radius">Curve radius</Label>
                      <Slider min={0} max={radiusSliderMax} step={100} value={[Math.min(sp.radius || 0, radiusSliderMax)]} onPointerDownCapture={remember} onKeyDownCapture={(e) => { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(e.key)) remember(); }} onValueChange={([v]) => { sp.radius = v; redraw(); }} aria-label="Curve radius" />
                      <NumberField key={`radius-${selected}`} id="generator-curve-radius" aria-label="Selected curve radius" className="h-7 w-20 text-xs" min={0} max={200000} step={100} integer commit value={sp.radius || 0} onValue={changeRadius} />
                    </div>
                    <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <InfoTip text="Radius of the bend at this point, in game units. Larger values make a wider circular turn. The road rounds inside the control point. 0 keeps the automatic curve. Limited by the space to the neighbouring points; height stays unchanged." />
                      <span data-curve-radius-status>{!sp.radius ? "0 = automatic curve" : selectedCorner ? `Applied: ${Math.round(selectedCorner.radius)} units${selectedCorner.radius < sp.radius - .5 ? " (limited by neighbouring points)" : ""}` : "Move this point to form a bend."}</span>
                    </div>
                    <p className="m-0 mt-2 text-[11px] leading-snug text-muted-foreground">Height raises the road at this point (hills, bridges); the road between points follows smoothly. Width × makes the road wider or narrower here.</p>
                  </div>
                )}
              </TabsContent>
              <TabsContent value="road" className="mt-0 flex flex-col gap-3">
                <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5">
                  <Label>Automatic bridges</Label>
                  <Switch aria-label="Automatic bridges" checked={params.autoBridges} onCheckedChange={(v) => { remember(); setParam("autoBridges", v); }} />
                  <p className="col-span-2 m-0 text-[11px] leading-snug text-muted-foreground">Add a bridge where the road actually crosses itself. Off by default: use Height to choose your own elevations.</p>
                </div>
                {num("roadWidth", "Road width", 800, 8000, 100, "Width of the drivable road.", karts)}
                {num("offroadWidth", "Off-road width", 0, 6000, 100, "Grass on both sides of the road: karts slow down on it. 0 = none.")}
                <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5">
                  <Label>Walls</Label>
                  <Switch checked={params.walls} onCheckedChange={(v) => setParam("walls", v)} aria-label="Walls" />
                  <p className="col-span-2 m-0 text-[11px] leading-snug text-muted-foreground">Walls along both edges keep karts on the track. Without them, falling off the edge brings Lakitu.</p>
                </div>
                {params.walls && num("wallHeight", "Wall height", 100, 5000, 50, "How high the walls are. Bridges must be higher than this above the road below.")}
                <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5">
                  <Label>Allow tricks on ramps</Label>
                  <Switch checked={params.trickable} onCheckedChange={(v) => setParam("trickable", v)} aria-label="Allow tricks on ramps" />
                  <p className="col-span-2 m-0 text-[11px] leading-snug text-muted-foreground">Enables the game's trickable collision flag on the road and boost panels. Perform a trick when a crest or ramp takes the kart into the air.</p>
                </div>
                {Array.isArray(params.boostPositions) ? <div className="text-xs">{previewTrack?.boosts.length || 0} manually placed boost panels</div> : num("boostPads", "Boost panels", 0, 6, 1, "Automatically placed on the straightest parts. Use the drawing tool to choose their positions.")}
                <div className="flex flex-wrap gap-1.5"><Button size="sm" variant="outline" onClick={() => chooseTool("boost")}><Zap /> Place on drawing</Button><Button size="sm" variant="ghost" onClick={() => { remember(); setParam("boostPositions", undefined); }}>Auto place</Button><Button size="sm" variant="ghost" onClick={() => { remember(); setParam("boostPositions", []); }}>Remove all</Button></div>
                {num("boostLength", "Boost panel length", 400, 4000, 100, "Length along the road. Panels follow its curve, height and driving direction.")}
              </TabsContent>
              <TabsContent value="textures" className="mt-0 flex flex-col gap-3"><TrackTextures params={params} change={setParam} busy={setTextureBusy} textures={texturePreview.textures} /></TabsContent>
              <TabsContent value="race" className="mt-0 flex flex-col gap-3">
                {num("laps", "Laps", 1, 9, 1, "Laps of a race (the game normally uses 3).")}
                {Array.isArray(params.itemBoxPositions) ? <p className="m-0 text-xs" aria-live="polite">{previewTrack?.itemBoxes.length || 0} manually placed item boxes</p> : num("itemRows", "Item box rows", 0, 8, 1, "Rows of four item boxes across the road, spread around the track.")}
                <div className="flex flex-wrap gap-1.5"><Button size="sm" variant="outline" onClick={() => chooseTool("items")}><Package /> Place on drawing</Button><Button size="sm" variant="ghost" aria-label="Auto place item boxes" onClick={() => { remember(); setParam("itemBoxPositions", undefined); }}>Auto place</Button><Button size="sm" variant="ghost" aria-label="Remove all item boxes" onClick={() => { remember(); setParam("itemBoxPositions", []); }}>Remove all</Button></div>
                {num("keyCheckpoints", "Key checkpoints", 0, 10, 1, "Checkpoints that must be crossed in order: they stop drivers from cutting across to finish a lap.")}
                {num("checkpointSpacing", "Checkpoint spacing", 500, 6000, 100, "Distance between checkpoints. Closer checkpoints count positions more precisely.")}
                {num("respawnEvery", "Respawn every N checkpoints", 1, 10, 1, "Where Lakitu puts a driver who fell off: a respawn point every N checkpoints.")}
                {hasSzs && (
                  <label className="flex cursor-pointer items-start gap-2 text-[13px]">
                    <Switch checked={keepSzs} onCheckedChange={setKeepSzs} className="mt-0.5" />
                    <span>Keep the other files of the open SZS <span className="block text-xs text-muted-foreground">Reuse the existing models, sky, textures and effects. Missing model, sky and minimap resources are generated automatically.</span></span>
                  </label>
                )}
              </TabsContent>
            </div>
          </Tabs>
          <div className="mt-3 shrink-0 rounded-md border p-2.5" aria-live="polite">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs font-medium"><span>Check</span><label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-normal text-muted-foreground"><Checkbox aria-label="Show adjustment markers" checked={showAdjustments} onCheckedChange={(v) => setShowAdjustments(v === true)} />Show adjustment markers</label></div>
            {issues.length ? (
              <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[11px] leading-snug">
                {issues.map((i: any) => <li key={i.message} className={cn("flex items-start gap-1.5", i.level === "error" ? "text-destructive" : i.level === "warning" ? "text-warning" : "text-muted-foreground")}>{i.level === "error" ? <CircleAlert className="mt-px size-3 shrink-0" /> : i.level === "warning" ? <TriangleAlert className="mt-px size-3 shrink-0" /> : <Info className="mt-px size-3 shrink-0 text-sky-400" />} {i.message}</li>)}
              </ul>
            ) : <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><CircleCheck className="size-3 text-success" /> No problems found in the layout.</div>}
          </div>
        </div>
      </div>
      <DialogFooter className="items-center sm:justify-between">
        <span className="text-xs text-muted-foreground">{texturePreview.loading ? "Loading texture previews… · " : texturePreview.error ? "Texture preview unavailable · " : ""}Length ≈ {(length / 1000).toFixed(1)}k units · {pts.current.length} points</span>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => close(null)}>Cancel</Button>
          {tab !== "race" && <Button variant="secondary" onClick={() => setTab(tab === "layout" ? "road" : tab === "road" ? "textures" : "race")}>Next step</Button>}
          <Hint title="Generate track" text={errors.length ? "Fix the problems in red first." : "Build the track with these settings. Everything can still be edited afterwards."}>
            <span className="inline-flex"><Button disabled={textureBusy || errors.length > 0 || pts.current.length < 3} onClick={() => close({ points: pts.current.map((p) => ({ ...p })), params: { ...params }, keepSzs })}><Sparkles /> Generate track</Button></span>
          </Hint>
        </div>
      </DialogFooter>
    </>
  );
}
