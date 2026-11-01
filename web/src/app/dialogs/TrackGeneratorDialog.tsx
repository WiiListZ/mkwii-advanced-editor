import { NumberField } from "../number-field";
import * as React from "react";
import { CircleAlert, CircleCheck, Info, FlipHorizontal2, Maximize, MousePointer2, PenLine, Redo2, Sparkles, TriangleAlert, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PRESETS, DEFAULT_PARAMS, trackSamples, layoutIssues, pointsFromStroke, reverseLayout, scaleLayout } from "../../../js/editor/trackgen.js";
import { Hint, InfoTip } from "../common";
import { cn } from "@/lib/utils";

const W = 640, H = 430, PH = 84; // drawing and height profile (canvas pixels)
const KART = 300; // a kart is about 300 units wide
type P = { x: number; y: number; z: number; w: number };
type Mode = "edit" | "draw";

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
  const pts = React.useRef<P[]>(PRESETS.Oval().map((p: any) => ({ ...p, w: 1 })));
  const view = React.useRef({ cx: 0, cz: 0, scale: 0.008 });
  const drag = React.useRef<any>(null);
  const stroke = React.useRef<{ x: number; z: number }[] | null>(null);
  const history = React.useRef<{ undo: P[][]; redo: P[][] }>({ undo: [], redo: [] });
  const [params, setParams] = React.useState<any>({ ...DEFAULT_PARAMS });
  const [selected, setSelected] = React.useState(0);
  const [hover, setHover] = React.useState<{ point: number } | { segment: number; x: number; z: number } | null>(null);
  const [mode, setMode] = React.useState<Mode>("edit");
  const [keepSzs, setKeepSzs] = React.useState(false);
  const [tab, setTab] = React.useState("layout");
  const [revision, redraw] = React.useReducer((x) => x + 1, 0);

  // Layout changes can be undone (Ctrl+Z / Ctrl+Y); the copy is taken before the change.
  const remember = () => {
    history.current.undo.push(pts.current.map((p) => ({ ...p })));
    if (history.current.undo.length > 100) history.current.undo.shift();
    history.current.redo = [];
  };
  const step = (from: "undo" | "redo") => {
    const h = history.current, to = from === "undo" ? "redo" : "undo";
    const prev = h[from].pop();
    if (!prev) return;
    h[to].push(pts.current.map((p) => ({ ...p })));
    pts.current = prev;
    setSelected((s) => Math.min(s, prev.length - 1));
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
  const zoom = (factor: number) => { view.current.scale *= factor; redraw(); };

  // The centreline as it is built (bridges and spread-out slopes included), for the drawing and the height profile.
  const spline = React.useMemo(() => pts.current.length >= 3 ? trackSamples(pts.current, { ...params, step: 300 }) : null, [revision, params]); // eslint-disable-line react-hooks/exhaustive-deps
  const issues = React.useMemo(() => layoutIssues(pts.current, params), [revision, params]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (spline && mode === "edit") {
      const { samples } = spline;
      const ys = samples.map((s: number[]) => s[1]);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      const n = samples.length;
      // Off-road first, then the road coloured by height (darker = lower), then the walls' outline.
      for (const [extra, color] of [[params.offroadWidth, "#2f5a26"], [0, null]] as const) {
        for (let i = 0; i < n; i++) {
          const a = samples[i], b = samples[(i + 1) % n];
          const half = (params.roadWidth * a[3]) / 2 + extra;
          const t = maxY > minY ? (a[1] - minY) / (maxY - minY) : 0;
          ctx.strokeStyle = color || `hsl(${220 - t * 180}, 12%, ${38 + t * 22}%)`;
          ctx.lineWidth = Math.max(2, half * 2 * v.scale);
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(...(toScreen(a[0], a[2]) as [number, number]));
          ctx.lineTo(...(toScreen(b[0], b[2]) as [number, number]));
          ctx.stroke();
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
      const s0 = samples[0], s1 = samples[1];
      const [sx, sy] = toScreen(s0[0], s0[2]);
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(Math.atan2(s1[2] - s0[2], s1[0] - s0[0]));
      const half = ((params.roadWidth * s0[3]) / 2) * v.scale;
      ctx.fillStyle = "#fff";
      ctx.fillRect(-2, -half, 4, half * 2);
      ctx.restore();
      ctx.font = "600 11px Inter, system-ui";
      ctx.fillText("START", sx + 8, sy - 8);
      // Problems found in the layout, where they are.
      for (const issue of issues) for (const [x, z] of issue.at) {
        const [px, py] = toScreen(x, z);
        ctx.strokeStyle = issue.level === "error" ? "#ef4444" : issue.level === "warning" ? "#f59e0b" : "#60a5fa";
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(px, py, Math.max(12, params.roadWidth * v.scale * 0.8), 0, Math.PI * 2); ctx.stroke();
      }
    }
    if (mode === "edit") {
      // Where a click adds a point: on the segment under the cursor.
      if (hover && "segment" in hover) {
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
        ctx.fillStyle = "#e5e7eb";
        ctx.font = "11px Inter, system-ui";
        ctx.fillText(String(i), x + 9, y + 4);
      });
    }
    // A line being drawn by hand.
    const s = stroke.current;
    if (s && s.length > 1) {
      ctx.strokeStyle = "#facc15"; ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath();
      s.forEach((p, i) => { const [x, y] = toScreen(p.x, p.z); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
      const [fx, fy] = toScreen(s[0].x, s[0].z);
      ctx.fillStyle = "#ff4d6d"; ctx.beginPath(); ctx.arc(fx, fy, 6, 0, Math.PI * 2); ctx.fill();
    } else if (mode === "draw") {
      ctx.fillStyle = "#9ca3af"; ctx.font = "13px Inter, system-ui"; ctx.textAlign = "center";
      ctx.fillText("Hold the left button and draw the track in one stroke.", W / 2, H / 2 - 8);
      ctx.fillText("Where you start is the finish line; the end joins the start by itself.", W / 2, H / 2 + 12);
      ctx.textAlign = "start";
    }
  }, [params, selected, hover, mode, spline, issues]); // eslint-disable-line react-hooks/exhaustive-deps

  // Height along the track: the road from the start line round to it again, with the control points.
  const drawProfile = React.useCallback(() => {
    const ctx = profile.current?.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#14161b"; ctx.fillRect(0, 0, W, PH);
    if (!spline) return;
    const { samples } = spline;
    const ys = samples.map((s: number[]) => s[1]);
    const lo = Math.min(-500, ...ys), hi = Math.max(1500, ...ys);
    const yOf = (y: number) => PH - 12 - ((y - lo) / (hi - lo)) * (PH - 26);
    ctx.strokeStyle = "#20242d"; ctx.beginPath(); ctx.moveTo(0, yOf(0)); ctx.lineTo(W, yOf(0)); ctx.stroke();
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

  React.useEffect(() => { fit(); redraw(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { draw(); drawProfile(); });

  // Keys inside the dialog: Delete removes the selected point, arrows nudge it, Ctrl+Z / Ctrl+Y undo.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, [role=slider]")) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === "z") { e.preventDefault(); e.stopPropagation(); step(e.shiftKey ? "redo" : "undo"); return; }
      if (ctrl && e.key.toLowerCase() === "y") { e.preventDefault(); e.stopPropagation(); step("redo"); return; }
      const p = pts.current[selected];
      if (!p || mode !== "edit") return;
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
  }, [selected, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const nearestPoint = (sx: number, sy: number) => {
    let best = -1, bd = 14 * 14;
    pts.current.forEach((p, i) => { const [x, y] = toScreen(p.x, p.z); const d = (x - sx) ** 2 + (y - sy) ** 2; if (d < bd) { bd = d; best = i; } });
    return best;
  };
  const nearestSegment = (wx: number, wz: number) => {
    const p = pts.current;
    let best = 0, bd = Infinity, at = [wx, wz];
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      const abx = b.x - a.x, abz = b.z - a.z;
      const t = Math.max(0, Math.min(1, ((wx - a.x) * abx + (wz - a.z) * abz) / (abx * abx + abz * abz || 1)));
      const d = (a.x + abx * t - wx) ** 2 + (a.z + abz * t - wz) ** 2;
      if (d < bd) { bd = d; best = i; at = [a.x + abx * t, a.z + abz * t]; }
    }
    return { segment: best, distance: Math.sqrt(bd), at };
  };
  const local = (e: React.PointerEvent | React.WheelEvent) => { const r = canvas.current!.getBoundingClientRect(); return [(e.clientX - r.left) * (W / r.width), (e.clientY - r.top) * (H / r.height)]; };

  const onPointerDown = (e: React.PointerEvent) => {
    const [sx, sy] = local(e);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (e.button === 1 || (e.button === 0 && e.altKey)) { drag.current = { pan: true, sx, sy, cx: view.current.cx, cz: view.current.cz }; return; }
    if (mode === "draw") {
      if (e.button !== 0) return;
      const [wx, wz] = toWorld(sx, sy);
      stroke.current = [{ x: wx, z: wz }];
      return;
    }
    const i = nearestPoint(sx, sy);
    const p = pts.current;
    if (e.button === 2) {
      if (i >= 0 && p.length > 3) { remember(); p.splice(i, 1); setSelected((s) => Math.min(s, p.length - 1)); setHover(null); redraw(); }
      return;
    }
    if (e.button !== 0) return;
    remember();
    if (i >= 0) { setSelected(i); drag.current = { i }; }
    else {
      const [wx, wz] = toWorld(sx, sy);
      const { segment } = nearestSegment(wx, wz);
      const a = p[segment], b = p[(segment + 1) % p.length];
      p.splice(segment + 1, 0, { x: Math.round(wx / 50) * 50, z: Math.round(wz / 50) * 50, y: Math.round((a.y + b.y) / 2), w: (a.w + b.w) / 2 });
      setSelected(segment + 1);
      drag.current = { i: segment + 1 };
    }
    redraw();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const [sx, sy] = local(e);
    const dg = drag.current;
    if (stroke.current) {
      const [wx, wz] = toWorld(sx, sy);
      const last = stroke.current[stroke.current.length - 1];
      if (Math.hypot(wx - last.x, wz - last.z) * view.current.scale > 3) { stroke.current.push({ x: wx, z: wz }); draw(); }
      return;
    }
    if (!dg) {
      if (mode !== "edit") return;
      const i = nearestPoint(sx, sy);
      if (i >= 0) { if (!(hover && "point" in hover && hover.point === i)) setHover({ point: i }); return; }
      const [wx, wz] = toWorld(sx, sy);
      const near = nearestSegment(wx, wz);
      setHover(near.distance * view.current.scale < 40 ? { segment: near.segment, x: near.at[0], z: near.at[1] } : null);
      return;
    }
    if (dg.pan) { view.current.cx = dg.cx - (sx - dg.sx) / view.current.scale; view.current.cz = dg.cz - (sy - dg.sy) / view.current.scale; }
    else { const [wx, wz] = toWorld(sx, sy); pts.current[dg.i].x = Math.round(wx / 50) * 50; pts.current[dg.i].z = Math.round(wz / 50) * 50; redraw(); }
    draw();
  };
  const onPointerUp = () => {
    drag.current = null;
    if (stroke.current) {
      const made = pointsFromStroke(stroke.current);
      stroke.current = null;
      if (made) { remember(); pts.current = made; setSelected(0); setMode("edit"); fit(); }
      redraw();
    }
  };
  const onWheel = (e: React.WheelEvent) => {
    const [sx, sy] = local(e);
    const [wx, wz] = toWorld(sx, sy);
    view.current.scale *= e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const [nx, nz] = toWorld(sx, sy);
    view.current.cx += wx - nx;
    view.current.cz += wz - nz;
    draw();
  };

  const sp = pts.current[selected];
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

  const modeHelp = mode === "draw"
    ? "Draw: hold the left button and trace the whole track in one stroke. Releasing turns the line into control points you can then adjust."
    : "Drag a point to move it · click the road (yellow +) to add a point there · right-click or Delete removes the selected point · arrows nudge it · wheel zooms · middle-drag or Alt+drag pans";

  return (
    <>
      <DialogHeader>
        <DialogTitle>Create a new track</DialogTitle>
        <DialogDescription>Three steps: draw the shape seen from above, choose how wide the road is, then the race settings. The editor builds the road, walls, collision, checkpoints, CPU and item routes, respawns, item boxes and cameras.</DialogDescription>
      </DialogHeader>
      <div className="grid min-h-0 grid-cols-[640px_1fr] gap-5 overflow-hidden">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex items-center gap-1" role="toolbar" aria-label="Drawing tools">
            <Hint title="Edit points" text="Move, add and remove the control points of the layout."><Button size="sm" variant={mode === "edit" ? "secondary" : "ghost"} aria-pressed={mode === "edit"} onClick={() => setMode("edit")}><MousePointer2 /> Edit points</Button></Hint>
            <Hint title="Draw by hand" text="Trace the whole track with the mouse in one stroke; it replaces the current layout (Undo brings it back)."><Button size="sm" variant={mode === "draw" ? "secondary" : "ghost"} aria-pressed={mode === "draw"} onClick={() => setMode("draw")}><PenLine /> Draw by hand</Button></Hint>
            <span className="mx-1 h-5 w-px bg-border" />
            <Hint title="Undo" shortcut="Ctrl+Z" text="Undo the last change to the layout."><span className="inline-flex"><Button size="icon-sm" variant="ghost" aria-label="Undo" disabled={!history.current.undo.length} onClick={() => step("undo")}><Undo2 /></Button></span></Hint>
            <Hint title="Redo" shortcut="Ctrl+Y" text="Redo the change you undid."><span className="inline-flex"><Button size="icon-sm" variant="ghost" aria-label="Redo" disabled={!history.current.redo.length} onClick={() => step("redo")}><Redo2 /></Button></span></Hint>
            <span className="mx-1 h-5 w-px bg-border" />
            <Hint title="Reverse direction" text="Drive the same layout the other way round."><Button size="icon-sm" variant="ghost" aria-label="Reverse direction" onClick={() => { remember(); pts.current = reverseLayout(pts.current); redraw(); }}><FlipHorizontal2 /></Button></Hint>
            <Hint title="Make smaller" text="Shrink the whole layout by 10% (heights stay)."><Button size="icon-sm" variant="ghost" aria-label="Make the layout smaller" onClick={() => { remember(); pts.current = scaleLayout(pts.current, 0.9); redraw(); }}><ZoomOut /></Button></Hint>
            <Hint title="Make larger" text="Grow the whole layout by 10% (heights stay)."><Button size="icon-sm" variant="ghost" aria-label="Make the layout larger" onClick={() => { remember(); pts.current = scaleLayout(pts.current, 1.1); redraw(); }}><ZoomIn /></Button></Hint>
            <Hint title="Fit view" text="Show the whole layout."><Button size="icon-sm" variant="ghost" aria-label="Fit view" onClick={() => { fit(); redraw(); }}><Maximize /></Button></Hint>
            <span className="ml-auto text-[11px] text-muted-foreground">grid square = 5000 units ≈ {Math.round(5000 / KART)} karts</span>
          </div>
          <canvas ref={canvas} width={W} height={H} className={cn("rounded-lg border", mode === "draw" ? "cursor-crosshair" : hover && "point" in hover ? "cursor-grab" : hover ? "cursor-copy" : "cursor-default")} onContextMenu={(e) => e.preventDefault()}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={() => setHover(null)} onWheel={onWheel} data-testid="generator-canvas" />
          <p className="m-0 min-h-8 text-[11px] leading-relaxed text-muted-foreground">{modeHelp}</p>
          <div>
            <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">Height along the track, from the start line <InfoTip text="Each dot is a control point. Select a point and change its Height on the right to make hills, dips or a bridge." /></div>
            <canvas ref={profile} width={W} height={PH} className="w-full rounded-md border" aria-label="Height profile" />
          </div>
        </div>
        <div className="flex min-h-0 flex-col overflow-hidden">
          <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
            <TabsList className="grid w-full shrink-0 grid-cols-3">
              <TabsTrigger value="layout">1 · Shape</TabsTrigger>
              <TabsTrigger value="road">2 · Road</TabsTrigger>
              <TabsTrigger value="race">3 · Race</TabsTrigger>
            </TabsList>
            <div className="min-h-0 flex-1 overflow-y-auto pr-1 pt-3">
              <TabsContent value="layout" className="mt-0 flex flex-col gap-3">
                <p className="m-0 text-xs leading-relaxed text-muted-foreground">Start from a ready shape or draw your own, then drag the points. The red point is the start and finish line; the arrows show the driving direction.</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {Object.keys(PRESETS).map((name) => (
                    <button key={name} type="button" className="cursor-pointer rounded-md border px-2.5 py-2 text-left hover:bg-accent"
                      onClick={() => { remember(); pts.current = PRESETS[name]().map((p: any) => ({ ...p, w: p.w ?? 1 })); setSelected(0); setMode("edit"); fit(); redraw(); }}>
                      <span className="block text-xs font-medium">{name}</span>
                      <span className="block text-[11px] leading-snug text-muted-foreground">{PRESET_HELP[name]}</span>
                    </button>
                  ))}
                  <button type="button" className="cursor-pointer rounded-md border px-2.5 py-2 text-left hover:bg-accent" onClick={() => setMode("draw")}>
                    <span className="block text-xs font-medium">Draw by hand</span>
                    <span className="block text-[11px] leading-snug text-muted-foreground">Trace the track with the mouse.</span>
                  </button>
                </div>
                {sp && (
                  <div className="rounded-md border p-3">
                    <div className="mb-2 text-xs font-medium">Selected point {selected}{selected === 0 ? " (start)" : ""} <span className="font-normal text-muted-foreground">of {pts.current.length}</span></div>
                    <div className="grid grid-cols-[64px_1fr_52px] items-center gap-x-3 gap-y-2" onPointerDownCapture={remember}>
                      <Label>Height</Label>
                      <Slider min={-3000} max={8000} step={100} value={[sp.y]} onValueChange={([v]) => { sp.y = v; redraw(); }} aria-label="Height" />
                      <span className="text-right text-xs tabular-nums">{sp.y}</span>
                      <Label>Width ×</Label>
                      <Slider min={0.5} max={2.5} step={0.05} value={[sp.w]} onValueChange={([v]) => { sp.w = v; redraw(); }} aria-label="Width" />
                      <span className="text-right text-xs tabular-nums">{sp.w.toFixed(2)}</span>
                    </div>
                    <p className="m-0 mt-2 text-[11px] leading-snug text-muted-foreground">Height raises the road at this point (hills, bridges); the road between points follows smoothly. Width × makes the road wider or narrower here.</p>
                  </div>
                )}
              </TabsContent>
              <TabsContent value="road" className="mt-0 flex flex-col gap-3">
                {num("roadWidth", "Road width", 800, 8000, 100, "Width of the drivable road.", karts)}
                {num("offroadWidth", "Off-road width", 0, 6000, 100, "Grass on both sides of the road: karts slow down on it. 0 = none.")}
                <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5">
                  <Label>Walls</Label>
                  <Switch checked={params.walls} onCheckedChange={(v) => setParam("walls", v)} aria-label="Walls" />
                  <p className="col-span-2 m-0 text-[11px] leading-snug text-muted-foreground">Walls along both edges keep karts on the track. Without them, falling off the edge brings Lakitu.</p>
                </div>
                {params.walls && num("wallHeight", "Wall height", 100, 5000, 50, "How high the walls are. Bridges must be higher than this above the road below.")}
                {num("boostPads", "Boost panels", 0, 6, 1, "Placed by themselves on the straightest parts of the road.")}
              </TabsContent>
              <TabsContent value="race" className="mt-0 flex flex-col gap-3">
                {num("laps", "Laps", 1, 9, 1, "Laps of a race (the game normally uses 3).")}
                {num("itemRows", "Item box rows", 0, 8, 1, "Rows of four item boxes across the road, spread around the track.")}
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
            <div className="mb-1 text-xs font-medium">Check</div>
            {issues.length ? (
              <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[11px] leading-snug">
                {issues.map((i: any) => <li key={i.message} className={cn("flex items-start gap-1.5", i.level === "error" ? "text-destructive" : i.level === "warning" ? "text-warning" : "text-muted-foreground")}>{i.level === "error" ? <CircleAlert className="mt-px size-3 shrink-0" /> : i.level === "warning" ? <TriangleAlert className="mt-px size-3 shrink-0" /> : <Info className="mt-px size-3 shrink-0 text-sky-400" />} {i.message}</li>)}
              </ul>
            ) : <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><CircleCheck className="size-3 text-success" /> No problems found in the layout.</div>}
          </div>
        </div>
      </div>
      <DialogFooter className="items-center sm:justify-between">
        <span className="text-xs text-muted-foreground">Length ≈ {(length / 1000).toFixed(1)}k units · {pts.current.length} points</span>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => close(null)}>Cancel</Button>
          {tab !== "race" && <Button variant="secondary" onClick={() => setTab(tab === "layout" ? "road" : "race")}>Next step</Button>}
          <Hint title="Generate track" text={errors.length ? "Fix the problems in red first." : "Build the track with these settings. Everything can still be edited afterwards."}>
            <span className="inline-flex"><Button disabled={errors.length > 0 || pts.current.length < 3} onClick={() => close({ points: pts.current.map((p) => ({ ...p })), params: { ...params }, keepSzs })}><Sparkles /> Generate track</Button></span>
          </Hint>
        </div>
      </DialogFooter>
    </>
  );
}
