import { NumberField } from "../number-field";
import * as React from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PRESETS, DEFAULT_PARAMS, sampleSpline } from "../../../js/editor/trackgen.js";
import { InfoTip, SectionTitle } from "../common";

const W = 640, H = 500;
type P = { x: number; y: number; z: number; w: number };

export function TrackGeneratorDialog({ hasSzs, close }: { hasSzs: boolean; close: (v: any) => void }) {
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const pts = React.useRef<P[]>(PRESETS.Oval().map((p: any) => ({ ...p, w: 1 })));
  const view = React.useRef({ cx: 0, cz: 0, scale: 0.008 });
  const drag = React.useRef<any>(null);
  const [params, setParams] = React.useState<any>({ ...DEFAULT_PARAMS });
  const [selected, setSelected] = React.useState(0);
  const [keepSzs, setKeepSzs] = React.useState(false);
  const [info, setInfo] = React.useState("");
  const [, redraw] = React.useReducer((x) => x + 1, 0);

  const toScreen = (x: number, z: number) => { const v = view.current; return [W / 2 + (x - v.cx) * v.scale, H / 2 + (z - v.cz) * v.scale]; };
  const toWorld = (sx: number, sy: number) => { const v = view.current; return [(sx - W / 2) / v.scale + v.cx, (sy - H / 2) / v.scale + v.cz]; };

  const fit = () => {
    const p = pts.current;
    const xs = p.map((q) => q.x), zs = p.map((q) => q.z);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    view.current = { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, scale: Math.min((W - 120) / Math.max(1, maxX - minX), (H - 120) / Math.max(1, maxZ - minZ)) };
  };

  const draw = React.useCallback(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    const v = view.current, points = pts.current;
    ctx.fillStyle = "#14161b";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#20242d";
    ctx.lineWidth = 1;
    const step = 5000 * v.scale;
    const [ox, oy] = toScreen(0, 0);
    for (let x = ((ox % step) + step) % step; x < W; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = ((oy % step) + step) % step; y < H; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    if (points.length >= 3) {
      const { samples, length } = sampleSpline(points, 300);
      const ys = samples.map((s: number[]) => s[1]);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      const n = samples.length;
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
      for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 12))) {
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
      setInfo(`Length ≈ ${(length / 1000).toFixed(1)}k units · ${points.length} control points · height ${Math.round(minY)} – ${Math.round(maxY)}`);
    }
    points.forEach((p, i) => {
      const [x, y] = toScreen(p.x, p.z);
      ctx.fillStyle = i === selected ? "#facc15" : i === 0 ? "#ff4d6d" : "#60a5fa";
      ctx.beginPath(); ctx.arc(x, y, i === selected ? 8 : 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#e5e7eb";
      ctx.font = "11px Inter, system-ui";
      ctx.fillText(String(i), x + 9, y + 4);
    });
  }, [params, selected]);

  React.useEffect(() => { fit(); draw(); }, []);
  React.useEffect(() => { draw(); });

  const nearestPoint = (sx: number, sy: number) => {
    let best = -1, bd = 14 * 14;
    pts.current.forEach((p, i) => { const [x, y] = toScreen(p.x, p.z); const d = (x - sx) ** 2 + (y - sy) ** 2; if (d < bd) { bd = d; best = i; } });
    return best;
  };
  const nearestSegment = (wx: number, wz: number) => {
    const p = pts.current;
    let best = 0, bd = Infinity;
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      const abx = b.x - a.x, abz = b.z - a.z;
      const t = Math.max(0, Math.min(1, ((wx - a.x) * abx + (wz - a.z) * abz) / (abx * abx + abz * abz || 1)));
      const d = (a.x + abx * t - wx) ** 2 + (a.z + abz * t - wz) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  };
  const local = (e: React.PointerEvent | React.WheelEvent) => { const r = canvas.current!.getBoundingClientRect(); return [(e.clientX - r.left) * (W / r.width), (e.clientY - r.top) * (H / r.height)]; };

  const onPointerDown = (e: React.PointerEvent) => {
    const [sx, sy] = local(e);
    const i = nearestPoint(sx, sy);
    const p = pts.current;
    if (e.button === 2) {
      if (i >= 0 && p.length > 3) { p.splice(i, 1); setSelected((s) => Math.min(s, p.length - 1)); redraw(); }
      return;
    }
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (e.button === 1) { drag.current = { pan: true, sx, sy, cx: view.current.cx, cz: view.current.cz }; return; }
    if (i >= 0) { setSelected(i); drag.current = { i }; }
    else {
      const [wx, wz] = toWorld(sx, sy);
      const seg = nearestSegment(wx, wz);
      const a = p[seg], b = p[(seg + 1) % p.length];
      p.splice(seg + 1, 0, { x: wx, z: wz, y: (a.y + b.y) / 2, w: (a.w + b.w) / 2 });
      setSelected(seg + 1);
      drag.current = { i: seg + 1 };
    }
    redraw();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const dg = drag.current;
    if (!dg) return;
    const [sx, sy] = local(e);
    if (dg.pan) { view.current.cx = dg.cx - (sx - dg.sx) / view.current.scale; view.current.cz = dg.cz - (sy - dg.sy) / view.current.scale; }
    else { const [wx, wz] = toWorld(sx, sy); pts.current[dg.i].x = Math.round(wx / 50) * 50; pts.current[dg.i].z = Math.round(wz / 50) * 50; }
    draw();
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
  const num = (key: string, label: string, min: number, max: number, step: number, help?: string) => (
    <React.Fragment key={key}>
      <Label className="flex items-center gap-1.5">{label}{help && <InfoTip text={help} />}</Label>
      <NumberField aria-label={label} value={params[key]} min={min} max={max} step={step} onValue={(n) => setParams({ ...params, [key]: n })} />
    </React.Fragment>
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle>Create a new track</DialogTitle>
        <DialogDescription>Draw the layout from above. The editor builds the road, walls, collision, checkpoints, CPU and item routes, respawns and item boxes.</DialogDescription>
      </DialogHeader>
      <div className="grid min-h-0 grid-cols-[640px_1fr] gap-5 overflow-hidden">
        <div className="flex flex-col gap-2">
          <canvas ref={canvas} width={W} height={H} className="cursor-crosshair rounded-lg border" onContextMenu={(e) => e.preventDefault()}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => (drag.current = null)} onWheel={onWheel} />
          <div className="text-xs text-muted-foreground">{info}</div>
          <p className="m-0 text-[11px] leading-relaxed text-muted-foreground">
            Drag points to move · click empty space to add a point on the nearest segment · right-click a point to delete · wheel zooms · middle-drag pans · red point = start
          </p>
        </div>
        <div className="flex min-h-0 flex-col overflow-y-auto pr-1">
          <SectionTitle>Start from a shape</SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {Object.keys(PRESETS).map((name) => (
              <Button key={name} size="sm" variant="secondary" onClick={() => { pts.current = PRESETS[name]().map((p: any) => ({ ...p, w: p.w ?? 1 })); setSelected(0); fit(); redraw(); }}>{name}</Button>
            ))}
          </div>
          {sp && (<>
            <SectionTitle>Control point {selected}</SectionTitle>
            <div className="grid grid-cols-[70px_1fr_44px] items-center gap-x-3 gap-y-3">
              <Label>Height</Label>
              <Slider min={-3000} max={8000} step={100} value={[sp.y]} onValueChange={([v]) => { sp.y = v; redraw(); }} />
              <span className="text-right text-xs tabular-nums">{sp.y}</span>
              <Label>Width ×</Label>
              <Slider min={0.5} max={2.5} step={0.05} value={[sp.w]} onValueChange={([v]) => { sp.w = v; redraw(); }} />
              <span className="text-right text-xs tabular-nums">{sp.w.toFixed(2)}</span>
            </div>
          </>)}
          <SectionTitle>Road</SectionTitle>
          <div className="grid grid-cols-[1fr_110px] items-center gap-x-3 gap-y-2">
            {num("roadWidth", "Road width", 800, 8000, 100, "A kart is about 300 units wide.")}
            {num("offroadWidth", "Off-road width", 0, 6000, 100, "Grass strip on both sides of the road.")}
            <Label>Walls</Label>
            <Switch checked={params.walls} onCheckedChange={(v) => setParams({ ...params, walls: v })} />
            {num("wallHeight", "Wall height", 100, 5000, 50)}
            {num("boostPads", "Boost panels", 0, 6, 1, "Placed automatically on the straightest parts.")}
          </div>
          <SectionTitle>Race</SectionTitle>
          <div className="grid grid-cols-[1fr_110px] items-center gap-x-3 gap-y-2">
            {num("laps", "Laps", 1, 9, 1)}
            {num("itemRows", "Item box rows", 0, 8, 1)}
            {num("keyCheckpoints", "Key checkpoints", 0, 10, 1, "Checkpoints that must be crossed in order: they stop shortcuts.")}
            {num("checkpointSpacing", "Checkpoint spacing", 500, 6000, 100)}
            {num("respawnEvery", "Respawn every N checkpoints", 1, 10, 1)}
          </div>
          {hasSzs && (
            <label className="mt-4 flex cursor-pointer items-start gap-2 text-[13px]">
              <Switch checked={keepSzs} onCheckedChange={setKeepSzs} className="mt-0.5" />
              <span>Keep the other files of the open SZS <span className="block text-xs text-muted-foreground">Models, textures and effects of the current archive are reused.</span></span>
            </label>
          )}
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => close(null)}>Cancel</Button>
        <Button onClick={() => close({ points: pts.current.map((p) => ({ ...p })), params: { ...params }, keepSzs })}><Sparkles /> Generate track</Button>
      </DialogFooter>
    </>
  );
}
