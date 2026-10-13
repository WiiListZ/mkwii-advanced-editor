import * as React from "react";
import { ArrowDown, ArrowUp, BookOpen, Camera, Clapperboard, Crosshair, Eye, ListPlus, Play, Plus, Scissors, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CAMERA_TYPES } from "../../../js/data/defs.js";
import { OPENING_TYPES, cameraFrames, introChain, introIndex, selectionIndex } from "../../../js/editor/cameras.js";
import { useEditor } from "../hooks";
import { dialogs } from "../dialogs-store";
import { SectionTitle } from "../common";
import { NumberField } from "../number-field";
import { cn } from "@/lib/utils";

const seconds = (frames: number) => `${(frames / 60).toFixed(1)} s`;
// One colour per shot so the timeline and the list match.
const SHOT_COLORS = ["#e879f9", "#60a5fa", "#34d399", "#fbbf24", "#f87171", "#a78bfa", "#2dd4bf", "#fb923c"];

// Left sidebar tab: the intro fly-over (shots in order, timeline, playback) and the other cameras.
export function CamerasPanel() {
  const ed = useEditor("doc", "selection", "intro");
  const k = ed.doc.kmp;
  const chain = introChain(k);
  const timeline = ed.introTimeline();
  const selected = ed.selectedCamera();
  const inIntro = new Set(chain);
  const others = k.CAME.map((c: any, i: number) => ({ c, i })).filter(({ i }: any) => !inIntro.has(i));
  const select = (i: number) => { ed.doc.select([String(k.CAME[i].uid)]); };
  const sel = selectionIndex(k);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-3">
      <div className="mb-2.5 flex items-baseline gap-2 text-[11px] text-muted-foreground">
        <span className="text-sm font-semibold text-foreground">Intro</span>
        <span className="ml-auto tabular-nums">{chain.length ? `${chain.length + 1} keyframes` : "no keyframes"} · {seconds(timeline.total)}</span>
      </div>
      <IntroKeyframes />
      <Button size="sm" variant="ghost" className="mt-1.5 self-start text-muted-foreground" onClick={() => dialogs.open("help", { tab: "tutorials", tutorial: "intro" })}><BookOpen /> How to make an intro</Button>

      <SectionTitle>Shots (between keyframes)</SectionTitle>
      {!chain.length && <p className="m-0 text-[11px] leading-relaxed text-muted-foreground">None yet.</p>}
      <div className="flex flex-col gap-0.5">
        {chain.map((i: number, n: number) => {
          const c = k.CAME[i];
          return (
            <div key={c.uid} onClick={() => ed.setIntroPlayhead(timeline.shots[n].start)} onDoubleClick={() => ed.viewFromCamera(i)}
              className={cn("group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/60", i === selected && "bg-accent")}>
              <span className="size-2.5 shrink-0 rounded-sm" style={{ background: SHOT_COLORS[n % SHOT_COLORS.length] }} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px]">Keyframe {n + 1} → {n + 2} <span className="text-muted-foreground">· camera {i}</span></div>
                <div className="truncate text-[10.5px] text-muted-foreground">{c.route !== 0xff ? `Follows route ${c.route}` : "Fixed position"} · {seconds(cameraFrames(c))}</div>
              </div>
              <div className="flex opacity-0 group-hover:opacity-100">
                <IconButton label="Earlier" disabled={n === 0} onClick={() => ed.moveIntroShot(i, -1)}><ArrowUp /></IconButton>
                <IconButton label="Later" disabled={n === chain.length - 1} onClick={() => ed.moveIntroShot(i, 1)}><ArrowDown /></IconButton>
                <IconButton label="Remove from the intro (the camera stays)" onClick={() => ed.removeFromIntro(i)}><X /></IconButton>
              </div>
            </div>
          );
        })}
      </div>

      <SectionTitle>Course selection camera</SectionTitle>
      <p className="mb-2 mt-0 text-[11px] leading-relaxed text-muted-foreground">Shown behind the menu while players choose the course.</p>
      <Select value={String(sel)} onValueChange={(v) => ed.setSelectionCamera(Number(v))}>
        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="255">None</SelectItem>
          {k.CAME.map((c: any, i: number) => <SelectItem key={c.uid} value={String(i)}>Camera {i} · {CAMERA_TYPES[c.type] ?? c.type}</SelectItem>)}
        </SelectContent>
      </Select>

      <SectionTitle>Other cameras</SectionTitle>
      <p className="mb-2 mt-0 text-[11px] leading-relaxed text-muted-foreground">Replay and goal cameras. Areas of type Camera choose which replay camera is used.</p>
      <div className="flex flex-col gap-0.5">
        {others.map(({ c, i }: any) => (
          <div key={c.uid} onClick={() => select(i)} onDoubleClick={() => ed.viewFromCamera(i)}
            className={cn("group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/60", i === selected && "bg-accent")}>
            <Camera className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-[12.5px]">Camera {i} <span className="text-muted-foreground">· {CAMERA_TYPES[c.type] ?? c.type}</span></span>
            {i === sel && <span className="text-[10px] text-muted-foreground">selection</span>}
            {OPENING_TYPES.has(c.type) && (
              <span className="opacity-0 group-hover:opacity-100"><IconButton label="Add to the end of the intro" onClick={() => ed.appendToIntro(i)}><ListPlus /></IconButton></span>
            )}
          </div>
        ))}
        {!others.length && <p className="m-0 text-[11px] text-muted-foreground">None.</p>}
      </div>
      <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">Click a camera to edit it in the Inspector (its view is shown in the corner of the 3D view). Double-click moves the 3D view to it.</p>
    </div>
  );
}

// Keyframe timeline of the intro: scrub the playhead, fly the 3D view, press "Add keyframe".
// The camera flies from each keyframe to the next one in the time between them.
function IntroKeyframes() {
  const ed = useEditor("doc", "intro", "selection");
  const { keys, shots, total } = ed.introKeyframes();
  const bar = React.useRef<HTMLDivElement>(null);
  const press = React.useRef<{ key: any | null; moved: boolean } | null>(null);
  const [dragFrame, setDragFrame] = React.useState<number | null>(null);
  // Room after the end of the intro, where a click places the next keyframe.
  const span = Math.max(240, total + Math.max(180, Math.round(total * 0.2)));
  const head = Math.min(ed.introPlayhead, span);
  const at = ed.introKeyAtPlayhead();
  const atIndex = at ? keys.indexOf(keys.find((k: any) => k.frame === at.frame)) : -1;
  const pct = (f: number) => `${(f / span) * 100}%`;
  const frameAt = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    const f = Math.round(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * span);
    const near = keys.find((k: any) => Math.abs(k.frame - f) / span * r.width < 6);
    return near ? near.frame : f;
  };
  const step = span > 60 * 40 ? 600 : span > 60 * 15 ? 300 : 60;
  const ticks = Array.from({ length: Math.floor(span / step) + 1 }, (_, n) => n * step);
  const onDown = (e: React.PointerEvent, key: any = null) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { key, moved: false };
    ed.setIntroPlayhead(key ? key.frame : frameAt(e.clientX));
  };
  const onMove = (e: React.PointerEvent) => {
    const p = press.current;
    if (!p) return;
    const f = frameAt(e.clientX);
    if (p.key) {
      if (p.key.before === null) return; // the first keyframe stays at 0
      p.moved = p.moved || f !== p.key.frame;
      setDragFrame(f);
    } else ed.setIntroPlayhead(f);
  };
  const onUp = () => {
    const p = press.current;
    press.current = null;
    if (p?.key && p.moved && dragFrame !== null) ed.moveIntroKey(p.key, dragFrame);
    setDragFrame(null);
  };
  const inShot = !at && head < total ? shots.findIndex((s: any) => head < s.start + s.frames) : -1;
  const where = at ? `Keyframe ${atIndex + 1}` : !shots.length ? "Empty intro" : head >= total ? "After the end" : `Between keyframes ${inShot + 1} and ${inShot + 2}`;

  return (
    <div className="flex flex-col gap-2">
      <div className="select-none px-2" onPointerDown={(e) => onDown(e)} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <div ref={bar} className="relative h-14 cursor-pointer rounded-sm border bg-muted/30" aria-label="Intro timeline">
          {ticks.map((t) => (
            <div key={t} className="pointer-events-none absolute top-0 h-full border-l border-border/60" style={{ left: pct(t) }}>
              <span className="absolute left-0.5 top-0 text-[9px] tabular-nums text-muted-foreground">{t / 60}s</span>
            </div>
          ))}
          {shots.map((s: any, n: number) => (
            <div key={s.index} className="pointer-events-none absolute bottom-2 h-3 border-r border-black/40"
              style={{ left: pct(s.start), width: pct(s.frames), background: SHOT_COLORS[n % SHOT_COLORS.length], opacity: 0.55 }} />
          ))}
          {keys.map((k: any, n: number) => {
            const f = dragFrame !== null && press.current?.key?.frame === k.frame ? dragFrame : k.frame;
            const on = at?.frame === k.frame;
            return (
              <button key={n} type="button" aria-label={`Keyframe ${n + 1}`} title={`Keyframe ${n + 1} · ${seconds(k.frame)}${k.linked ? "" : " · cut"}${k.before !== null ? " · drag to change its time" : ""}`}
                onPointerDown={(e) => onDown(e, k)}
                className={cn("absolute bottom-1.5 size-4 -translate-x-1/2 rotate-45 cursor-grab border-2 active:cursor-grabbing", on ? "border-foreground bg-primary" : "border-foreground/70 bg-background",
                  !k.linked && "rounded-none border-dashed")}
                style={{ left: pct(f) }} />
            );
          })}
          <div className="pointer-events-none absolute inset-y-0 w-px bg-primary" style={{ left: pct(head) }} />
        </div>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="tabular-nums text-foreground">{seconds(head)}</span>
        <span className="truncate">{where}</span>
        <Button size="sm" variant="ghost" className="ml-auto h-6 px-1.5 text-[11px]" disabled={!shots.length} onClick={() => ed.watchIntro(Math.min(head, Math.max(0, total - 1)))}><Play /> Watch</Button>
      </div>

      <div className="flex gap-1.5">
        <Button size="sm" className="flex-1" onClick={() => ed.setIntroKeyFromView()} title="Uses the position, look-at point (the point the view orbits around) and zoom of the 3D view">
          <Camera /> {at ? "Set keyframe from view" : "Add keyframe from view"}
        </Button>
        <Button size="sm" variant="secondary" disabled={!shots.length} onClick={() => ed.viewFromPlayhead()} title="Moves the 3D view to the intro camera at the playhead"><Eye /> Go to</Button>
      </div>
      {shots.length > 0 && <Button size="sm" variant="outline" onClick={() => ed.appendIntroKey(3)} title="New keyframe 3 seconds after the last one, from the 3D view"><Plus /> Keyframe 3 s after the end</Button>}

      {at && (
        <div className="flex flex-col gap-1.5 rounded-md border p-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-medium">Keyframe {atIndex + 1}</span>
            <span className="ml-auto text-[11px] text-muted-foreground">time (s)</span>
            <NumberField commit aria-label="Keyframe time" className="h-7 w-20 text-xs" value={Math.round((at.frame / 60) * 100) / 100} min={0} step={0.1}
              disabled={at.before === null} onValue={(v) => ed.moveIntroKey(at, Math.round(v * 60))} />
          </div>
          {at.before !== null && at.after !== null && (at.linked
            ? <p className="m-0 text-[11px] leading-relaxed text-muted-foreground">The camera flies through this keyframe without a cut.</p>
            : <p className="m-0 text-[11px] leading-relaxed text-muted-foreground">Cut: the shot before ends on one view, the next one starts on another.</p>)}
          {at.before !== null && at.after !== null && !at.linked ? (
            <div className="grid grid-cols-[1fr_auto_auto] items-center gap-1 text-[11px]">
              <span>End of the shot before</span>
              <Button size="sm" variant="outline" className="h-6 px-1.5 text-[11px]" onClick={() => ed.setIntroKeyFromView("before")}>From view</Button>
              <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" onClick={() => ed.viewFromPose(at.beforePose)}>Go to</Button>
              <span>Start of the shot after</span>
              <Button size="sm" variant="outline" className="h-6 px-1.5 text-[11px]" onClick={() => ed.setIntroKeyFromView("after")}>From view</Button>
              <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" onClick={() => ed.viewFromPose(at.afterPose)}>Go to</Button>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-1">
            {at.before !== null && at.after !== null && at.linked && (
              <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => ed.setIntroKeyFromView("after")} title="Only the next shot starts from the 3D view; the shot before still ends on the old view">
                <Scissors /> Cut to view
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-7 text-[11px] text-muted-foreground hover:text-destructive" onClick={() => ed.removeIntroKey(at)}><Trash2 /> Delete keyframe</Button>
          </div>
        </div>
      )}
      {!shots.length && <p className="m-0 text-[11px] leading-relaxed text-muted-foreground">Fly the 3D view to where the intro starts and press <b className="text-foreground">Add keyframe from view</b>. Then click later on the timeline, move the view and add the next keyframe: the camera flies from one keyframe to the next.</p>}
    </div>
  );
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="flex size-6 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground disabled:pointer-events-none disabled:opacity-30 [&_svg]:size-3.5">
      {children}
    </button>
  );
}

// Inspector section for one selected camera: corner preview with a frame slider, view sync.
export function CameraTools({ index }: { index: number }) {
  const ed = useEditor("doc", "intro", "settings", "live");
  const k = ed.doc.kmp;
  const cam = k.CAME[index];
  if (!cam) return null;
  const chain = introChain(k);
  const frames = cameraFrames(cam);
  const opening = OPENING_TYPES.has(cam.type);
  const shot = ed.introTimeline().shots.find((s: any) => s.index === index);
  const frame = Math.min(ed.cameraFrame, frames - 1);
  return (
    <div className="flex flex-col gap-2 rounded-md border p-2.5">
      <div className="flex items-center gap-2 text-xs">
        <Clapperboard className="size-3.5 text-muted-foreground" />
        <span className="font-medium">{shot ? `Intro shot ${chain.indexOf(index) + 1} of ${chain.length}` : opening ? "Opening camera, not in the intro" : "Replay / goal camera"}</span>
        <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
          <input type="checkbox" className="accent-primary" checked={ed.settings.cameraPreview} onChange={(e) => { ed.setSetting("cameraPreview", e.target.checked); ed.refreshCameraViews(); }} /> Preview
        </label>
      </div>
      {frames > 1 && (
        <div className="flex items-center gap-2">
          <input aria-label="Preview frame" type="range" min={0} max={frames - 1} value={frame} onChange={(e) => ed.setCameraFrame(Number(e.target.value))} className="min-w-0 flex-1 accent-primary" />
          <span className="w-16 text-right text-[11px] tabular-nums text-muted-foreground">{seconds(frame)} / {seconds(frames)}</span>
        </div>
      )}
      {!opening && <p className="m-0 text-[11px] leading-relaxed text-muted-foreground">This camera follows the kart in the game; the preview uses the first start position.</p>}
      <div className="flex flex-wrap gap-1.5">
        {shot && <Button size="sm" onClick={() => ed.watchIntro(shot.start + frame)}><Play /> Watch from here</Button>}
        <Button size="sm" variant="secondary" onClick={() => ed.viewFromCamera(index, frame)} title="Moves the 3D view to this camera"><Eye /> Go to camera</Button>
        {opening && !shot && <Button size="sm" variant="secondary" onClick={() => ed.appendToIntro(index)}><ListPlus /> Add to intro</Button>}
      </div>
      {opening && (
        <>
          <div className="text-[11px] text-muted-foreground">Set from the current 3D view (look-at = the point the view orbits around):</div>
          <div className="grid grid-cols-3 gap-1">
            <Button size="sm" variant="outline" className="h-7 px-1 text-[11px]" onClick={() => ed.setShotFromView(index, "position")}><Camera /> Position</Button>
            <Button size="sm" variant="outline" className="h-7 px-1 text-[11px]" onClick={() => ed.setShotFromView(index, "start")}><Crosshair /> Start</Button>
            <Button size="sm" variant="outline" className="h-7 px-1 text-[11px]" onClick={() => ed.setShotFromView(index, "end")}><Crosshair /> End</Button>
          </div>
          {cam.route !== 0xff && <p className="m-0 text-[11px] leading-relaxed text-muted-foreground">It follows route {cam.route}: its position comes from the route, and each route point's Setting 1 is the speed from that point (units per frame).</p>}
          {cam.viewSpeed === 0 && cam.viewStart.some((v: number, a: number) => v !== cam.viewEnd[a]) && <p className="m-0 text-[11px] leading-relaxed text-warning">Look-at speed is 0: the look-at point stays at the start.</p>}
        </>
      )}
      {introIndex(k) === 0xff && opening && <p className="m-0 text-[11px] text-muted-foreground">This track has no intro yet.</p>}
    </div>
  );
}
