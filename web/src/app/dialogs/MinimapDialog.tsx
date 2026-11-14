// Editor of the track's minimap (map_model.brres), used like a drawing program: the track lies in
// grey under the map, tools paint on it, and nothing reaches the track until Apply. Only colour or
// frame changes keep the file as it is; a change of shape rebuilds the map.

import * as React from "react";
import { flushSync } from "react-dom";
import { ArrowLeftRight, Download, Eraser, FileUp, Frame, Maximize2, PaintBucket, Paintbrush, Plus, Redo2, Replace, Route, Spline, Trash2, Undo2, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { cn } from "@/lib/utils";
import { api, FILTERS } from "../../../js/api.js";
import {
  buildMinimapSource, fitMinimapBounds, forEachMinimapTriangle, generateMinimapDesign, hexToRgb, MINIMAP_ELEMENT, MINIMAP_HIDDEN, MINIMAP_ORIGINAL_MAX_TRIANGLES, minimapElements, minimapSourceCounts, minimapTrack, minimapTriangleCount, readMinimap, roadOnlySources,
  MINIMAP_SMOOTH_DEFAULT, MINIMAP_SMOOTH_LEVELS, minimapAlong, minimapRoute, minimapRoutePlace, minimapStretchTriangles, seedMinimapDesign, setMinimapBounds, setMinimapColors, smoothMinimapEdges, trackLocator,
} from "../../../js/editor/minimap.js";
import { dialogs } from "../dialogs-store";
import { useHistoryKeys } from "../edit-history";
import { editor } from "../editor";
import { useEditor } from "../hooks";
import { NumberField } from "../number-field";

type Tool = "paint" | "recolour" | "erase" | "fill" | "stretch" | "frame";
type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };
type Tone = { hex: string; source: string | null; editable: boolean };
// shape: the painted triangles replace the file's. Without it the file itself is shown and kept.
// baseline: the map before painting; offsets: how far Smooth edges has moved painted vertices.
type Design = { tones: Tone[]; assign: Int16Array; bounds: Bounds | null; shape: boolean; baseline: Int16Array; offsets: Map<string, number[]> };
type Drag =
  | { type: "pan"; sx: number; sy: number; cx: number; cz: number }
  | { type: "paint"; x: number; y: number }
  | { type: "stretch"; which: "start" | "end" }
  | { type: "frame"; xKey: "minX" | "maxX"; zKey: "minZ" | "maxZ"; moved: boolean };

const MAX_TONES = 24;
const MAX_HISTORY = 40;
const SOURCES: { id: string; label: string; hex: string; on: boolean }[] = [
  { id: "road", label: "Road", hex: "#ffffff", on: true },
  { id: "boost", label: "Boosts and jumps", hex: "#ffffff", on: true },
  { id: "offroad", label: "Off-road", hex: "#808080", on: false },
  { id: "line", label: "Finish line", hex: "#404040", on: false },
  { id: "objects", label: "Objects", hex: "#c0c0c0", on: false },
  { id: "itemBoxes", label: "Item boxes", hex: "#c0c0c0", on: false },
  { id: "route", label: "Enemy route", hex: "#ffffff", on: false },
];
const TRACK_FILL = "#2c343b";
const CANVAS_FILL = "#14181c";
const PREVIEW_FILL = "#20262c";
// The finish line as the game shows it on a minimap: two rows of black and white squares across
// the road, from one side of the lap checkpoint to the other.
function checkeredLine(ctx: CanvasRenderingContext2D, a: number[], b: number[], dpr: number) {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (length < 1) return;
  const thick = Math.max(4 * dpr, Math.min(length * 0.3, 9 * dpr)), square = thick / 2, count = Math.max(2, Math.round(length / square));
  ctx.save();
  ctx.translate(a[0], a[1]);
  ctx.rotate(Math.atan2(b[1] - a[1], b[0] - a[0]));
  ctx.fillStyle = "#101010";
  ctx.fillRect(-dpr, -thick / 2 - dpr, length + 2 * dpr, thick + 2 * dpr);
  const step = length / count;
  for (let i = 0; i < count; i++) for (let row = 0; row < 2; row++) {
    ctx.fillStyle = (i + row) % 2 ? "#101010" : "#f4f4f4";
    ctx.fillRect(i * step, -thick / 2 + row * square, step + 0.5, square + 0.5);
  }
  ctx.restore();
}

// The In game panel: the frame at one scale on both axes, centred, 6 pixels in from the edges.
const previewView = (frame: Bounds, sw: number, sh: number) => {
  const fw = Math.max(1, frame.maxX - frame.minX), fh = Math.max(1, frame.maxZ - frame.minZ), k = Math.min((sw - 12) / fw, (sh - 12) / fh);
  return { k, ox: (sw - fw * k) / 2 - frame.minX * k, oy: (sh - fh * k) / 2 - frame.minZ * k };
};
// The part of the world the panel shows, edge to edge.
const previewArea = ({ k, ox, oy }: { k: number; ox: number; oy: number }, sw: number, sh: number): Bounds =>
  ({ minX: -ox / k, maxX: (sw - ox) / k, minZ: -oy / k, maxZ: (sh - oy) / k });

const css = (rgb: number[], alpha = 1, grey = false) => {
  const g = Math.round(rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114);
  return grey ? `rgba(${g},${g},${g},${alpha})` : `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
};

const snapshotOf = (design: Design): Design => ({ ...design, tones: design.tones.map((tone) => ({ ...tone })), assign: design.assign.slice() });

function seed(track: any, map: any): Design {
  // Without a file there is something to apply straight away: the map made from the track.
  const start = seedMinimapDesign(track, map);
  return { ...start, bounds: map?.bounds || null, shape: !map?.tris?.length && !!track, baseline: start.assign.slice(), offsets: new Map() };
}

// The picker previews while it moves; closing it makes one change, so one step back.
function ToneColor({ value, label, disabled, onPreview, onCommit }: { value: string; label: string; disabled?: boolean; onPreview: (hex: string) => void; onCommit: (hex: string) => void }) {
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
  return <input ref={ref} type="color" aria-label={label} value={value} disabled={disabled} onChange={(e) => onPreview(e.target.value)}
    className="h-8 w-full cursor-pointer rounded border bg-transparent p-0.5 disabled:cursor-not-allowed disabled:opacity-40" />;
}

export function MinimapDialog({ close }: { close: (value: any) => void }) {
  useEditor("doc", "kcl");
  const doc = editor.doc;
  const resource = editor.minimapResource();
  const data = resource?.data || null;
  const [unreadable, map] = React.useMemo<[boolean, any]>(() => {
    if (!data) return [false, null];
    try { return [false, readMinimap(data)]; } catch { return [true, null]; }
  }, [data]);
  // Follows what is on the track now: objects, routes and the finish line come from the open KMP.
  const docVersion = editor.version(["doc"]);
  const track = React.useMemo(() => minimapTrack(doc.kcl, minimapElements(doc.kmp), { map, canvas: true }), [doc.kcl, docVersion, map]);
  const sourceCounts = React.useMemo(() => minimapSourceCounts(track), [track]);
  const locate = React.useMemo(() => track ? trackLocator(track) : null, [track]);

  const [design, setDesign] = React.useState<Design>(() => seed(track, map));
  const [tool, setTool] = React.useState<Tool>("paint");
  const [brushSize, setBrushSize] = React.useState(16);
  const [smoothOnRelease, setSmoothOnRelease] = React.useState(false);
  const [smoothness, setSmoothness] = React.useState<number>(MINIMAP_SMOOTH_DEFAULT);
  const [sources, setSources] = React.useState(SOURCES);
  const [newOpen, setNewOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const [liveHex, setLiveHex] = React.useState<string | null>(null);
  const [applying, setApplying] = React.useState(false);
  const [, repaint] = React.useReducer((n) => n + 1, 0);
  const [lines, setLines] = React.useState<{ start: any; end: any }>({ start: null, end: null });
  const hoverLine = React.useRef<any>(null);
  const route = React.useMemo(() => minimapRoute(doc.kmp), [docVersion]);
  // Worked out when first needed: it looks at every triangle.
  const along = React.useMemo(() => tool === "stretch" && track && route ? minimapAlong(track, route) : null, [tool === "stretch", track, route]);
  const stretch = React.useMemo(() => along && lines.start && lines.end ? minimapStretchTriangles(design.assign, along, lines.start.distance, lines.end.distance) : [], [along, lines, design.assign]);
  const recolourFrom = React.useRef<number | null>(null);
  const past = React.useRef<Design[]>([]);
  const future = React.useRef<Design[]>([]);
  // Another file (Apply, undo in the main window, an import): without unapplied edits, start from it.
  // Done while rendering, not in an effect: the drawing runs before effects, and the old design's
  // triangles and colours do not fit the new track.
  const [basis, setBasis] = React.useState({ track, map });
  if (basis.track !== track || basis.map !== map) {
    const edited = design.shape && !!map?.tris?.length;
    setBasis({ track, map });
    if (!(edited && design.assign.length === (track?.count || 0))) setDesign(seed(track, map));
    past.current = []; future.current = [];
  }
  const pendingStep = React.useRef<Design | null>(null);
  const host = React.useRef<HTMLDivElement>(null);
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const inGame = React.useRef<HTMLCanvasElement>(null);
  const view = React.useRef({ cx: 0, cz: 0, scale: 0.01 });
  const size = React.useRef({ w: 1, h: 1, dpr: 1 });
  const fitted = React.useRef(false);
  const drag = React.useRef<Drag | null>(null);
  const brushCursor = React.useRef<HTMLDivElement>(null);

  const original = React.useMemo(() => seed(track, map), [track, map]);
  const coloursChanged = design.tones.some((tone, i) => tone.source && tone.hex !== original.tones[i]?.hex);
  const sameBounds = (a: Bounds | null, b: Bounds | null) => a === b || (!!a && !!b && a.minX === b.minX && a.maxX === b.maxX && a.minZ === b.minZ && a.maxZ === b.maxZ);
  const frameChanged = !sameBounds(design.bounds, map?.bounds || null);
  const dirty = design.shape && (!!map?.tris?.length ? true : !!track) || coloursChanged || frameChanged;
  const triangles = design.shape && track ? minimapTriangleCount(track, design.assign) : map?.triangles ?? 0;
  const activeTone = design.tones[active] ? active : 0;
  const isBattle = /battle/i.test(doc.fileName || "");
  const controlAreas = doc.kmp.AREA.filter((area: any) => area.type === 5).length;
  const swatchOf = (tone: Tone) => tone.source ? map?.swatches.find((s: any) => s.key === tone.source) : null;

  // ---- History: every stroke, colour and frame change is one step ------------------------------
  const pushStep = (step: Design) => {
    past.current = [...past.current.slice(-(MAX_HISTORY - 1)), step];
    future.current = [];
  };
  const undo = () => {
    const step = past.current.at(-1);
    if (!step) return;
    past.current = past.current.slice(0, -1);
    future.current = [...future.current, snapshotOf(design)];
    setDesign(step);
  };
  const redo = () => {
    const step = future.current.at(-1);
    if (!step) return;
    future.current = future.current.slice(0, -1);
    past.current = [...past.current, snapshotOf(design)];
    setDesign(step);
  };
  const change = (next: (current: Design) => Design) => {
    pushStep(snapshotOf(design));
    setDesign(next(design));
  };

  const toScreen = (x: number, z: number): [number, number] => {
    const v = view.current, s = size.current;
    return [s.w / 2 + (x - v.cx) * v.scale, s.h / 2 + (z - v.cz) * v.scale];
  };
  const toWorld = (sx: number, sy: number): [number, number] => {
    const v = view.current, s = size.current;
    return [v.cx + (sx - s.w / 2) / v.scale, v.cz + (sy - s.h / 2) / v.scale];
  };

  const fit = () => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const include = (x: number, z: number) => {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    };
    // The canvas reaches past the track: fitting it would make the track small.
    if (track) for (let i = 0; i < track.count; i++) if (!track.canvas[i]) for (let c = 0; c < 9; c += 3) include(track.verts[i * 9 + c], track.verts[i * 9 + c + 2]);
    // All that the In game panel shows, so the dashed line is in view.
    const frame = design.bounds || map?.bounds;
    if (frame) { const seen = previewArea(previewView(frame, 300, 300), 300, 300); include(seen.minX, seen.minZ); include(seen.maxX, seen.maxZ); }
    if (minX > maxX) { minX = minZ = -5000; maxX = maxZ = 5000; }
    const { w, h } = size.current;
    view.current = {
      cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2,
      scale: Math.min((w - 48) / Math.max(1000, maxX - minX), (h - 48) / Math.max(1000, maxZ - minZ)),
    };
    fitted.current = true;
    repaint();
  };

  React.useEffect(() => {
    const observer = new ResizeObserver(() => {
      // Layout size: the window's opening animation scales its bounding box, without a new resize.
      const width = host.current?.clientWidth || 0, height = host.current?.clientHeight || 0;
      if (width < 2 || height < 2 || !canvas.current) return;
      if (width === size.current.w && height === size.current.h) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      size.current = { w: width, h: height, dpr };
      canvas.current.width = Math.round(width * dpr);
      canvas.current.height = Math.round(height * dpr);
      // Resizing the canvas clears it: draw again now, before a blank frame reaches the screen.
      flushSync(() => { if (!fitted.current) fit(); else repaint(); });
    });
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);

  // What the map will look like, bottom layer first: [points x/z of a triangle, its colour].
  const toneRgb = (index: number) => hexToRgb(liveHex && index === activeTone ? liveHex : design.tones[index]?.hex ?? "#808080");
  const mapTriangles = () => {
    const out: { p: ArrayLike<number>; rgb: number[]; alpha: number }[] = [];
    if (design.shape && track) {
      const rank = new Int32Array(track.sources);
      track.order.forEach((s: number, at: number) => { rank[s] = at; });
      const ranked: { at: number; p: number[]; tone: number }[] = [];
      forEachMinimapTriangle(track, design.assign, (tone: number, v: ArrayLike<number>, o: number, s: number) => {
        ranked.push({ at: rank[s], tone, p: [v[o], v[o + 2], v[o + 3], v[o + 5], v[o + 6], v[o + 8]] });
      }, design.offsets);
      ranked.sort((a, b) => a.at - b.at);
      for (const { p, tone } of ranked) out.push({ p, rgb: toneRgb(tone), alpha: 1 });
    } else if (map) {
      for (const tri of map.tris) {
        const tone = design.tones[tri.swatch], recoloured = tone && (tone.hex !== original.tones[tri.swatch]?.hex || (liveHex && tri.swatch === activeTone));
        out.push({ p: tri.p, rgb: recoloured ? toneRgb(tri.swatch) : tri.rgb, alpha: tri.alpha });
      }
    }
    return out;
  };

  React.useLayoutEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    const { w, h, dpr } = size.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = CANVAS_FILL;
    ctx.fillRect(0, 0, w, h);
    const triangle = (p: ArrayLike<number>, fill: string) => {
      const [ax, ay] = toScreen(p[0], p[1]), [bx, by] = toScreen(p[2], p[3]), [cx, cy] = toScreen(p[4], p[5]);
      if (Math.max(ax, bx, cx) < 0 || Math.min(ax, bx, cx) > w || Math.max(ay, by, cy) < 0 || Math.min(ay, by, cy) > h) return;
      ctx.fillStyle = fill; ctx.strokeStyle = fill; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx, cy); ctx.closePath(); ctx.fill(); ctx.stroke();
    };
    // The track to paint on. Elements off the map are not drawn: dozens would hide it.
    if (track) for (const s of track.order) {
      const first = track.first[s];
      if (track.element[first] || track.fromMap[first] || track.canvas[first]) continue;
      const o = s * 9, v = track.sourceVerts;
      triangle([v[o], v[o + 2], v[o + 3], v[o + 5], v[o + 6], v[o + 8]], TRACK_FILL);
    }
    const drawn = mapTriangles();
    for (const { p, rgb, alpha } of drawn) triangle(p, css(rgb, alpha));
    // The stretch as it would come out, and its lines.
    if (tool === "stretch" && track) {
      const tint = css(toneRgb(activeTone)), v = track.verts;
      for (const i of stretch) triangle([v[i * 9], v[i * 9 + 2], v[i * 9 + 3], v[i * 9 + 5], v[i * 9 + 6], v[i * 9 + 8]], tint);
      const line = (place: any, colour: string, text: string, width = 3) => {
        if (!place) return;
        const [ax, ay] = toScreen(place.left[0], place.left[1]), [bx, by] = toScreen(place.right[0], place.right[1]);
        ctx.strokeStyle = colour; ctx.lineWidth = width;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        if (text) { ctx.font = "11px sans-serif"; ctx.textAlign = "left"; ctx.lineWidth = 3; ctx.strokeStyle = "#101417"; ctx.strokeText(text, bx + 6, by + 4); ctx.fillStyle = colour; ctx.fillText(text, bx + 6, by + 4); }
      };
      if (!(lines.start && lines.end)) line(hoverLine.current, "rgba(255,255,255,.55)", "", 2);
      line(lines.start, "#4ade80", "Start");
      line(lines.end, "#f87171", "End");
    }
    // The finish line and the starts orient the map against the track.
    const lap = doc.kmp.CKPT.flatMap((group: any) => group.points).find((point: any) => point.type === 0);
    if (lap) {
      const [ax, ay] = toScreen(lap.left[0], lap.left[1]), [bx, by] = toScreen(lap.right[0], lap.right[1]);
      ctx.strokeStyle = "#fb3f61"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }
    const bounds = design.bounds;
    // What the In game panel shows: the frame fitted into its square, so on the frame's shorter side
    // a little more than the frame is on the map. Painting can go anywhere; only this part shows.
    if (bounds && tool !== "frame") {
      const side = inGame.current?.width || 300, seen = previewArea(previewView(bounds, side, side), side, side);
      const [x0, y0] = toScreen(seen.minX, seen.minZ), [x1, y1] = toScreen(seen.maxX, seen.maxZ);
      ctx.strokeStyle = "rgba(255,255,255,.25)"; ctx.lineWidth = 1; ctx.setLineDash([4, 6]);
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0); ctx.setLineDash([]);
    }
    if (bounds && tool === "frame") {
      const [x0, y0] = toScreen(bounds.minX, bounds.minZ), [x1, y1] = toScreen(bounds.maxX, bounds.maxZ);
      ctx.strokeStyle = "#facc15"; ctx.lineWidth = 1; ctx.setLineDash([5, 5]);
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0); ctx.setLineDash([]);
      for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
        ctx.fillStyle = "#facc15"; ctx.strokeStyle = "#101417"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, 6.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }

    // The map on its own, as a player sees it.
    const small = inGame.current, sctx = small?.getContext("2d");
    if (!small || !sctx) return;
    // As many pixels as it has room for, so that a wider panel shows it sharper, not stretched.
    const room = Math.max(1, Math.round(small.clientWidth * dpr));
    if (small.width !== room) { small.width = room; small.height = room; }
    const sw = small.width, sh = small.height;
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.fillStyle = PREVIEW_FILL;
    sctx.fillRect(0, 0, sw, sh);
    let frame = bounds;
    if (!frame && drawn.length) {
      frame = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
      for (const { p } of drawn) for (let i = 0; i < 6; i += 2) {
        frame.minX = Math.min(frame.minX, p[i]); frame.maxX = Math.max(frame.maxX, p[i]);
        frame.minZ = Math.min(frame.minZ, p[i + 1]); frame.maxZ = Math.max(frame.maxZ, p[i + 1]);
      }
    }
    if (!frame) return;
    const { k, ox, oy } = previewView(frame, sw, sh);
    for (const { p, rgb, alpha } of drawn) {
      const fill = css(rgb, alpha, !isBattle);
      sctx.fillStyle = fill; sctx.strokeStyle = fill; sctx.lineWidth = .5;
      sctx.beginPath(); sctx.moveTo(p[0] * k + ox, p[1] * k + oy); sctx.lineTo(p[2] * k + ox, p[3] * k + oy); sctx.lineTo(p[4] * k + ox, p[5] * k + oy); sctx.closePath(); sctx.fill(); sctx.stroke();
    }
    // The game draws the finish line over the map itself, as a checkered bar across the road.
    if (lap) checkeredLine(sctx, [lap.left[0] * k + ox, lap.left[1] * k + oy], [lap.right[0] * k + ox, lap.right[1] * k + oy], dpr);
  });

  // ---- Painting ----------------------------------------------------------------------------
  const paintAt = (x: number, z: number) => {
    if (!track || !locate) return false;
    // Removed elements are out of the way of the road beneath; New from track brings them back.
    // Recolouring changes only what is on the map, and only the colour the stroke began on.
    const recolouring = tool === "recolour";
    if (recolouring && recolourFrom.current === null) {
      const onMap = (i: number) => design.assign[i] >= 0;
      const under = locate(x, z, onMap), near = under >= 0 ? under : [...locate.within(x, z, brushSize / 2 / view.current.scale, onMap)][0];
      if (near === undefined || near < 0) return false;
      recolourFrom.current = design.assign[near];
    }
    const accept = recolouring ? (i: number) => design.assign[i] === recolourFrom.current : (i: number) => !track.element[i] || design.assign[i] >= 0;
    const touched = new Set<number>();
    const touch = (hit: number, whole: boolean) => {
      if (hit < 0) return;
      if (whole) for (const i of track.parts.get(track.piece[hit])) { if (!track.covered[i]) touched.add(i); }
      else touched.add(hit);
    };
    if (tool === "fill") touch(locate(x, z, accept), true);
    else {
      // An object or the finish line is one mark; a route is painted along its length.
      for (const hit of locate.within(x, z, brushSize / 2 / view.current.scale, accept)) touch(hit, !!track.element[hit] && track.element[hit] !== MINIMAP_ELEMENT.ROUTE);
    }
    if (!touched.size) return false;
    const tone = tool === "erase" ? MINIMAP_HIDDEN : activeTone;
    let changed = false;
    for (const i of touched) if (design.assign[i] !== tone) {
      if (!changed && pendingStep.current) { pushStep(pendingStep.current); pendingStep.current = null; }
      design.assign[i] = tone;
      changed = true;
    }
    if (changed) setDesign((current) => ({ ...current, shape: true }));
    return true;
  };
  const moveBrushCursor = (sx: number, sy: number) => {
    const el = brushCursor.current;
    if (!el) return;
    el.style.display = tool === "paint" || tool === "erase" || tool === "recolour" ? "block" : "none";
    el.style.width = el.style.height = `${brushSize}px`;
    el.style.transform = `translate(${sx - brushSize / 2}px, ${sy - brushSize / 2}px)`;
  };
  const local = (e: React.PointerEvent | React.WheelEvent): [number, number] => {
    const rect = canvas.current!.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const [sx, sy] = local(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    const pan = () => { drag.current = { type: "pan", sx, sy, cx: view.current.cx, cz: view.current.cz }; };
    if (e.button !== 0 || e.altKey) return pan();
    if (tool === "stretch") {
      const [x, z] = toWorld(sx, sy), place = route && minimapRoutePlace(route, x, z);
      // A line already there is picked up, wherever along it.
      const onLine = (line: any) => {
        if (!line) return false;
        const [ax, ay] = toScreen(line.left[0], line.left[1]), [bx, by] = toScreen(line.right[0], line.right[1]);
        const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((sx - ax) * dx + (sy - ay) * dy) / (dx * dx + dy * dy || 1)));
        return Math.hypot(ax + dx * t - sx, ay + dy * t - sy) < 10;
      };
      const which = onLine(lines.end) ? "end" : onLine(lines.start) ? "start" : null;
      if (which) { drag.current = { type: "stretch", which }; return; }
      if (!place || (lines.start && lines.end)) return pan();
      setLines((current) => current.start ? { ...current, end: place } : { ...current, start: place });
      drag.current = { type: "stretch", which: lines.start ? "end" : "start" };
      return;
    }
    if (tool === "frame") {
      const bounds = design.bounds;
      if (bounds) for (const xKey of ["minX", "maxX"] as const) for (const zKey of ["minZ", "maxZ"] as const) {
        const [x, y] = toScreen(bounds[xKey], bounds[zKey]);
        if (Math.hypot(x - sx, y - sy) < 12) {
          pendingStep.current = snapshotOf(design);
          drag.current = { type: "frame", xKey, zKey, moved: false };
          return;
        }
      }
      return pan();
    }
    const [x, z] = toWorld(sx, sy);
    pendingStep.current = snapshotOf(design);
    recolourFrom.current = null;
    if (paintAt(x, z)) drag.current = { type: "paint", x: sx, y: sy };
    else { pendingStep.current = null; pan(); }
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    const [sx, sy] = local(e);
    moveBrushCursor(sx, sy);
    if (tool === "stretch" && route) {
      const [x, z] = toWorld(sx, sy), place = minimapRoutePlace(route, x, z);
      if (d?.type === "stretch") { if (place) setLines((current) => ({ ...current, [d.which]: place })); }
      else if (!d) { hoverLine.current = place; repaint(); }
    }
    if (!d) return;
    if (d.type === "pan") {
      view.current.cx = d.cx - (sx - d.sx) / view.current.scale;
      view.current.cz = d.cz - (sy - d.sy) / view.current.scale;
      repaint();
    } else if (d.type === "paint") {
      // Fast strokes must not skip the triangles between two pointer events.
      const steps = Math.max(1, Math.ceil(Math.hypot(sx - d.x, sy - d.y) / Math.max(3, brushSize / 4)));
      for (let i = 1; i <= steps; i++) {
        const [x, z] = toWorld(d.x + (sx - d.x) * i / steps, d.y + (sy - d.y) * i / steps);
        paintAt(x, z);
      }
      d.x = sx; d.y = sy;
    } else if (d.type === "frame" && design.bounds) {
      const [x, z] = toWorld(sx, sy), next = { ...design.bounds, [d.xKey]: x, [d.zKey]: z };
      if (next.minX < next.maxX && next.minZ < next.maxZ) {
        if (!d.moved && pendingStep.current) { pushStep(pendingStep.current); pendingStep.current = null; }
        d.moved = true;
        // The design object itself: the release can arrive before React renders this move.
        design.bounds = next;
        setDesign((current) => ({ ...current, bounds: next }));
      }
    }
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // A stroke that changed something has left its step: smoothing belongs to that same step.
    if (smoothOnRelease && drag.current?.type === "paint" && tool !== "fill" && !pendingStep.current && track) {
      const { offsets } = smoothMinimapEdges(track, design.assign, design.baseline, design.offsets, smoothness);
      setDesign((current) => ({ ...current, offsets }));
    }
    pendingStep.current = null;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const [sx, sy] = local(e), [x, z] = toWorld(sx, sy);
    view.current.scale = Math.max(0.00002, Math.min(2, view.current.scale * Math.exp(-e.deltaY * 0.001)));
    const [nx, nz] = toWorld(sx, sy);
    view.current.cx += x - nx; view.current.cz += z - nz;
    repaint();
  };

  // ---- Colours, frame, new map -------------------------------------------------------------
  const chooseTone = (index: number) => {
    setActive(index);
    if (tool === "erase" || tool === "frame") setTool("paint");
  };
  const commitTone = (hex: string) => {
    setLiveHex(null);
    if (design.tones[activeTone]?.hex === hex) return;
    change((current) => ({ ...current, tones: current.tones.map((tone, i) => i === activeTone ? { ...tone, hex } : tone) }));
  };
  const addTone = () => {
    change((current) => ({ ...current, tones: [...current.tones, { hex: "#808080", source: null, editable: true }] }));
    setActive(design.tones.length);
    if (tool === "erase" || tool === "frame") setTool("paint");
  };
  const setFrame = (next: Bounds) => {
    if (next.minX >= next.maxX || next.minZ >= next.maxZ) return toast.error("The frame's left must be before its right, and its top before its bottom");
    change((current) => ({ ...current, bounds: next }));
  };
  const fitFrame = () => {
    const drawn = mapTriangles();
    if (!drawn.length) return;
    const extents = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (const { p } of drawn) for (let i = 0; i < 6; i += 2) {
      extents.minX = Math.min(extents.minX, p[i]); extents.maxX = Math.max(extents.maxX, p[i]);
      extents.minZ = Math.min(extents.minZ, p[i + 1]); extents.maxZ = Math.max(extents.maxZ, p[i + 1]);
    }
    setFrame(fitMinimapBounds(extents));
  };
  const createFrom = (chosen: { id: string; hex: string }[]) => {
    if (!track) return;
    if (!chosen.length) return toast.error("Choose at least one element for the minimap");
    const made = generateMinimapDesign(track, chosen);
    change((current) => ({ ...current, ...made, shape: true, baseline: made.assign.slice(), offsets: new Map() }));
    setActive(0);
    setNewOpen(false);
    if (tool === "frame") setTool("paint");
  };

  const smoothEdges = () => {
    if (!track) return;
    const { offsets, moved } = smoothMinimapEdges(track, design.assign, design.baseline, design.offsets, smoothness);
    if (!offsets.size) return toast.info("Nothing to smooth yet", { description: "Only edges you painted are rounded." });
    if (moved) change((current) => ({ ...current, offsets }));
  };
  // With the edges already smoothed, the slider shows its effect while it moves: one step back in all.
  const changeSmoothness = (level: number) => {
    setSmoothness(level);
    if (!track || !design.offsets.size) return;
    const { offsets } = smoothMinimapEdges(track, design.assign, design.baseline, design.offsets, level);
    setDesign((current) => ({ ...current, offsets }));
  };

  // The stretch takes the chosen colour. What is not on the map stays off it.
  const colourStretch = () => {
    if (!track || !stretch.length) return;
    const assign = design.assign.slice();
    let changed = false;
    for (const i of stretch) if (assign[i] !== activeTone) { assign[i] = activeTone; changed = true; }
    if (!changed) return toast.info("This stretch already has this colour");
    const offsets = smoothOnRelease ? smoothMinimapEdges(track, assign, design.baseline, design.offsets, smoothness).offsets : design.offsets;
    change((current) => ({ ...current, assign, offsets, shape: true }));
  };

  const clearAll = () => {
    const empty = new Int16Array(design.assign.length).fill(MINIMAP_HIDDEN);
    change((current) => ({ ...current, assign: empty, baseline: empty.slice(), shape: true, offsets: new Map() }));
    if (tool === "erase" || tool === "frame") setTool("paint");
  };

  const leave = async () => {
    if (dirty && !await dialogs.confirm({ title: "Discard the changes?", description: "The changes to the minimap have not been applied to the track.", confirmLabel: "Discard", destructive: true })) return;
    close(true);
  };
  const apply = async () => {
    if (applying || !dirty) return;
    setApplying(true);
    try {
      let bytes: Uint8Array | null = data;
      let frame: Bounds | null = frameChanged ? design.bounds : null;
      if (design.shape && track) {
        const source = buildMinimapSource(track, design.assign, design.tones, design.offsets);
        if (!source.tris.length) { toast.error("The minimap is empty: paint part of the track first"); return; }
        bytes = await api.generatedMinimap(source);
        // Keep the frame while the new shape fits in it: only the look of the map was asked to change.
        const old: Bounds | null = design.bounds;
        if (!frame && old && source.tris.every((tri: any) => [0, 3, 6].every((c) => tri.v[c] >= old.minX && tri.v[c] <= old.maxX && tri.v[c + 2] >= old.minZ && tri.v[c + 2] <= old.maxZ))) frame = old;
      } else if (coloursChanged && bytes) {
        const changes = design.tones.flatMap((tone, i) => {
          const swatch = swatchOf(tone);
          return swatch && tone.hex !== original.tones[i]?.hex ? [{ swatch, hex: tone.hex }] : [];
        });
        bytes = setMinimapColors(bytes, changes);
      }
      if (!bytes) return;
      if (frame) bytes = setMinimapBounds(bytes, frame);
      editor.saveMinimapBytes("Edit minimap", bytes);
      toast.success("Minimap updated", { description: "Save the course SZS to keep it." });
      close(true);
    } catch (e: any) {
      toast.error("Could not update the minimap", { description: e.message });
    } finally {
      setApplying(false);
    }
  };
  const importFile = async () => {
    if (dirty && !await dialogs.confirm({ title: "Discard the changes?", description: "Importing a minimap replaces your changes.", confirmLabel: "Discard", destructive: true })) return;
    setDesign(seed(track, map));
    await editor.replaceMinimap();
  };
  useHistoryKeys({ undo, redo } as any, () => { void apply(); });

  const toolButton = (id: Tool, Icon: any, label: string, title: string) =>
    <Button size="sm" variant={tool === id ? "secondary" : "ghost"} className="h-8 gap-1.5 px-2.5 text-xs" title={title} aria-pressed={tool === id} onClick={() => setTool(id)}><Icon className="size-4" /> {label}</Button>;
  const boundField = (key: keyof Bounds, label: string) => design.bounds && <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
    <span className="w-14 shrink-0">{label}</span>
    <NumberField commit integer value={Math.round(design.bounds[key])} step={100} className="h-7 text-xs" aria-label={`Frame ${label}`} onValue={(value) => setFrame({ ...design.bounds!, [key]: value })} />
  </label>;
  const canPaint = !!track;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 items-start gap-2 pr-1">
        <div className="min-w-0 flex-1">
          <DialogTitle className="text-sm">Minimap (beta)</DialogTitle>
          <DialogDescription className="text-xs">
            {canPaint ? "Grey shows the track. Paint on it or anywhere around it to add to the map, erase to take off, recolour to change what is there. The dashed line is what the In game panel shows." : "This track has no collision to paint on. You can still change colours and the frame."}
          </DialogDescription>
        </div>
        <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs" onClick={importFile}><FileUp className="size-3.5" /> Import…</Button>
        <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs" disabled={!data} onClick={() => data && editor.exportBytes("map_model.brres", FILTERS.brres, data, "Export minimap BRRES")}><Download className="size-3.5" /> Export…</Button>
        <Button size="icon-sm" variant="ghost" title="Close" aria-label="Close minimap editor" onClick={leave}><X /></Button>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1">
        {toolButton("paint", Paintbrush, "Paint", "Add the area under the brush in the chosen colour")}
        {toolButton("recolour", Replace, "Recolour", "Change the colour under the brush to the chosen one: only what is on the map, and only the colour you start the stroke on")}
        {toolButton("erase", Eraser, "Erase", "Take the area under the brush off the map")}
        {toolButton("fill", PaintBucket, "Fill", "Colour everything connected on one surface. On a battle arena this can be the whole floor")}
        <Button size="sm" variant={tool === "stretch" ? "secondary" : "ghost"} className="h-8 gap-1.5 px-2.5 text-xs" disabled={!route || !track} title={route ? "Colour the track between a start line and an end line" : "This needs the track's enemy route, and this track has none"} aria-pressed={tool === "stretch"} onClick={() => setTool("stretch")}><Route className="size-4" /> Stretch</Button>
        {toolButton("frame", Frame, "Frame", "Move the map's frame by dragging its corners")}
        {(tool === "paint" || tool === "erase" || tool === "recolour") && <label className="flex items-center gap-1.5 px-2 text-[11px] text-muted-foreground">Size
          <input type="range" min={4} max={60} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} aria-label="Brush size" className="w-24" />
        </label>}
        <div className="mx-1 h-5 w-px bg-border" />
        <Button size="icon-sm" variant="ghost" disabled={!past.current.length} onClick={undo} title="Undo (Ctrl+Z)" aria-label="Undo"><Undo2 /></Button>
        <Button size="icon-sm" variant="ghost" disabled={!future.current.length} onClick={redo} title="Redo (Ctrl+Y)" aria-label="Redo"><Redo2 /></Button>
        <div className="mx-1 h-5 w-px bg-border" />
        <Button size="sm" variant="ghost" className="h-8 gap-1.5 px-2.5 text-xs" disabled={!design.shape} onClick={smoothEdges} title="Round off the stair-steps and waves along the edges you painted"><Spline className="size-4" /> Smooth edges</Button>
        <input type="range" min={1} max={MINIMAP_SMOOTH_LEVELS} value={smoothness} aria-label="Smoothness" title={`How smooth: ${smoothness} of ${MINIMAP_SMOOTH_LEVELS}. Long waves only go at high values`} className="w-20"
          onPointerDown={() => { if (design.offsets.size) pushStep(snapshotOf(design)); }} onChange={(e) => changeSmoothness(Number(e.target.value))} />
        <label className="flex cursor-pointer items-center gap-1.5 px-1 text-[11px] text-muted-foreground" title="Smooth the edges each time you release the mouse after painting or erasing">
          <input type="checkbox" checked={smoothOnRelease} onChange={(e) => setSmoothOnRelease(e.target.checked)} aria-label="Smooth on release" /> Smooth on release
        </label>
        <div className="mx-1 h-5 w-px bg-border" />
        <Button size="sm" variant="ghost" className="h-8 gap-1.5 px-2.5 text-xs" disabled={!canPaint || !triangles} onClick={clearAll} title="Take everything off the map, to start from an empty one. Undo brings it back"><Trash2 className="size-4" /> Clear all</Button>
        <div className="ml-auto flex items-center gap-1">
          {canPaint && <Popover open={newOpen} onOpenChange={setNewOpen}>
            <PopoverTrigger asChild><Button size="sm" variant="ghost" className="h-8 gap-1.5 px-2.5 text-xs"><Wand2 className="size-4" /> New from track…</Button></PopoverTrigger>
            <PopoverContent align="end" className="flex w-64 flex-col gap-1 p-3">
              <p className="pb-1 text-[11px] text-muted-foreground">Draws a new map from what is on the track now, replacing this one. Undo brings it back.</p>
              <Button size="sm" onClick={() => track && createFrom(roadOnlySources(track))}>Road only</Button>
              <div className="pb-0.5 pt-2 text-[11px] text-muted-foreground">Or choose what to include:</div>
              {sources.map((source, index) => {
                const count = sourceCounts[source.id];
                const update = (next: Partial<typeof source>) => setSources((list) => list.map((entry, i) => i === index ? { ...entry, ...next } : entry));
                return (
                  <div key={source.id} className={cn("flex h-7 items-center gap-2 text-xs", !count && "opacity-50")}>
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                      <input type="checkbox" checked={source.on && !!count} disabled={!count} onChange={(e) => update({ on: e.target.checked })} aria-label={`Include ${source.label}`} />
                      <span className="truncate">{source.label}</span>
                    </label>
                    <input type="color" value={source.hex} disabled={!count} onChange={(e) => update({ hex: e.target.value })} aria-label={`${source.label} colour`} className="h-6 w-8 shrink-0 cursor-pointer rounded border bg-transparent p-0.5 disabled:cursor-not-allowed" />
                  </div>
                );
              })}
              <Button size="sm" variant="secondary" className="mt-1" onClick={() => createFrom(sources.filter((source) => source.on && sourceCounts[source.id]))}>Create</Button>
            </PopoverContent>
          </Popover>}
          <Button size="sm" variant="ghost" className="h-8 gap-1.5 px-2.5 text-xs" onClick={fit} aria-label="Fit minimap view"><Maximize2 className="size-4" /> Fit view</Button>
        </div>
      </div>

      <ResizablePanelGroup direction="horizontal" autoSaveId="minimap-editor" className="min-h-0 flex-1">
        <ResizablePanel id="minimap-drawing" order={1} defaultSize={82} minSize={40}>
        <div ref={host} className="relative size-full select-none overflow-hidden bg-[#14181c]" data-minimap data-center-x={view.current.cx} data-center-z={view.current.cz} data-scale={view.current.scale} data-fitted={fitted.current}>
          <canvas ref={canvas} aria-label="Minimap design" className={cn("absolute inset-0 size-full touch-none", tool === "frame" ? "cursor-grab" : canPaint ? "cursor-crosshair" : "cursor-grab")}
            onContextMenu={(e) => e.preventDefault()} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onWheel={onWheel}
            onPointerLeave={() => { if (brushCursor.current) brushCursor.current.style.display = "none"; if (hoverLine.current) { hoverLine.current = null; repaint(); } }} />
          <div ref={brushCursor} aria-hidden="true" className="pointer-events-none absolute left-0 top-0 hidden rounded-full border border-white/80 mix-blend-difference" />
          <div className="pointer-events-none absolute bottom-2 left-2 bg-[#10151a]/85 px-2 py-1 text-[11px] text-white/70">Right-drag to move · wheel to zoom</div>
        </div>
        </ResizablePanel>
        <ResizableHandle className="mx-1.5" aria-label="Resize the side panel" data-minimap-handle />
        <ResizablePanel id="minimap-side" order={2} defaultSize={18} minSize={13} maxSize={50}>
        {/* The padding is the room for the ring around the chosen colour, which this scrolling box would cut. */}
        <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-1 pr-1.5" data-minimap-side>
          <section className="flex flex-col gap-1.5">
            <div className="text-xs font-semibold">Colours</div>
            <div className="flex flex-wrap gap-1.5">
              {design.tones.map((tone, i) => (
                <button key={i} type="button" onClick={() => chooseTone(i)} aria-label={`Colour ${i + 1}`} aria-pressed={activeTone === i} title={tone.hex}
                  className={cn("size-8 cursor-pointer rounded border", activeTone === i && tool !== "erase" && "ring-2 ring-foreground ring-offset-2 ring-offset-background")}
                  style={{ backgroundColor: liveHex && i === activeTone ? liveHex : tone.hex }} />
              ))}
              {canPaint && <button type="button" onClick={addTone} disabled={design.tones.length >= MAX_TONES} aria-label="Add colour" title="Add colour"
                className="flex size-8 cursor-pointer items-center justify-center rounded border border-dashed text-muted-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"><Plus className="size-4" /></button>}
            </div>
            {design.tones[activeTone] && <ToneColor value={liveHex ?? design.tones[activeTone].hex} label="Selected colour" disabled={!design.tones[activeTone].editable}
              onPreview={setLiveHex} onCommit={commitTone} />}
            {design.tones[activeTone] && !design.tones[activeTone].editable && <p className="text-[11px] text-muted-foreground">This colour is a patterned texture. Open the file in Track objects to change it.</p>}
          </section>

          {tool === "stretch" && <section className="flex flex-col gap-1.5" data-minimap-stretch={stretch.length}>
            <div className="text-xs font-semibold">Stretch</div>
            <p className="m-0 text-[11px] text-muted-foreground">{!lines.start ? "Click the road where the stretch starts." : !lines.end ? "Click the road where it ends." : "It runs from Start to End in the direction of driving. Drag a line to move it."}</p>
            <Button size="sm" disabled={!stretch.length} onClick={colourStretch}>Colour this stretch</Button>
            <div className="flex gap-1.5">
              <Button size="sm" variant="secondary" className="h-7 flex-1 gap-1 px-2 text-xs" disabled={!lines.start || !lines.end} title="Swap the lines, for the rest of the lap instead" onClick={() => setLines({ start: lines.end, end: lines.start })}><ArrowLeftRight className="size-3.5" /> Other way</Button>
              <Button size="sm" variant="ghost" className="h-7 flex-1 px-2 text-xs" disabled={!lines.start && !lines.end} onClick={() => setLines({ start: null, end: null })}>Clear lines</Button>
            </div>
            {lines.start && lines.end && !stretch.length && <p className="m-0 text-[11px] text-muted-foreground">Nothing on the map between these lines. A stretch colours what is on the map: paint it first.</p>}
          </section>}

          {tool === "frame" && <section className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span className="flex-1 text-xs font-semibold">Frame</span>
              {design.bounds && <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" onClick={fitFrame}>Fit to map</Button>}
            </div>
            {design.bounds ? <>
              {boundField("minX", "Left X")}
              {boundField("maxX", "Right X")}
              {boundField("minZ", "Top Z")}
              {boundField("maxZ", "Bottom Z")}
              <p className="text-[11px] text-muted-foreground">Keep the whole map inside. The game limits the map to an area of the screen, so a tighter frame cannot make it larger than that.</p>
            </> : <p className="text-[11px] text-muted-foreground">{data ? "This minimap has no frame." : "The frame is created with the minimap."}</p>}
            {controlAreas > 0 && <p className="text-[11px] text-muted-foreground">This track has {controlAreas} Minimap Control area{controlAreas === 1 ? "" : "s"}, which can also align and scale the map.</p>}
          </section>}

          <section className="flex flex-col gap-1.5">
            <div className="text-xs font-semibold">In game</div>
            <canvas ref={inGame} width={216} height={216} aria-label="Minimap in game" className="aspect-square w-full rounded border" />
            <p className="text-[11px] text-muted-foreground">{isBattle ? "Battle arenas show these colours." : "Races show the map in grey, so light and dark tones matter. Colours appear in battle arenas and in mods that enable them."}</p>
          </section>
          {unreadable && <p className="text-xs text-destructive">map_model.brres could not be read. Import another or paint a new one.</p>}
        </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      <div className="flex shrink-0 items-center justify-end gap-2">
        <span className={cn("mr-auto text-[11px]", triangles > MINIMAP_ORIGINAL_MAX_TRIANGLES ? "text-destructive" : "text-muted-foreground")}>
          {triangles} triangles{triangles > MINIMAP_ORIGINAL_MAX_TRIANGLES ? `: the game's own maps have at most ${MINIMAP_ORIGINAL_MAX_TRIANGLES}, and one this dense has not been tried on a Wii` : ""}
        </span>
        <Button variant="ghost" onClick={leave}>Cancel</Button>
        <Button disabled={!dirty || applying} onClick={apply}>{applying ? "Applying…" : "Apply"}</Button>
      </div>
    </div>
  );
}
