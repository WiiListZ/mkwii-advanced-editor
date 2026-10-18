import * as React from "react";
import { Diamond, Pause, Play, SkipBack, SkipForward, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Switch } from "@/components/ui/switch";
import { useEditor } from "./hooks";
import { shotSpeedLimits } from "../../js/editor/intro-keys.js";
import { cn } from "@/lib/utils";

// One colour per shot so the timeline and the Cameras tab match.
export const SHOT_COLORS = ["#e879f9", "#60a5fa", "#34d399", "#fbbf24", "#f87171", "#a78bfa", "#2dd4bf", "#fb923c"];
export const seconds = (frames: number, digits = 2) => `${(frames / 60).toFixed(digits)} s`;

// Keyframe timeline of the intro, docked under the 3D view while the Cameras tab is open.
// Click or drag to move the playhead (the 3D view follows the intro camera there), frame the view
// and press K: the keyframe at the playhead takes the view, or a new one is added there.
export function IntroTimeline() {
  const ed = useEditor("doc", "intro", "selection", "settings");
  const { keys, shots, total } = ed.introKeyframes();
  const bar = React.useRef<HTMLDivElement>(null);
  // `to` is kept here too: the release can come before React shows the last move.
  const press = React.useRef<{ key: any | null; moved: boolean; to?: number } | null>(null);
  const [drag, setDrag] = React.useState<{ from: number; to: number } | null>(null);
  // Height of the whole timeline, dragged from its top edge (saved when the drag ends).
  const [height, setHeight] = React.useState<number | null>(null);
  const resize = React.useRef<{ y: number; h: number; now?: number } | null>(null);
  const shown = Math.round(height ?? ed.settings.introTimelineHeight ?? 118);
  const clampHeight = (h: number) => Math.max(96, Math.min(Math.round(window.innerHeight * 0.6), h));
  const playing = !!ed.intro;
  const head = ed.intro ? ed.intro.frame : ed.introPlayhead;
  const at = playing ? null : ed.introKeyAtPlayhead();
  const atIndex = at ? keys.findIndex((k: any) => k.frame === at.frame) : -1;
  // Room after the end of the intro, where the next keyframe goes.
  const span = Math.max(600, total + Math.max(240, Math.round(total * 0.25)), head + 60);
  const pct = (f: number) => `${(f / span) * 100}%`;
  const label = span <= 1500 ? 60 : span <= 4800 ? 300 : 600;
  const tick = span <= 4800 ? 60 : 300;
  const ticks = Array.from({ length: Math.floor(span / tick) + 1 }, (_, n) => n * tick);

  const frameAt = (clientX: number, snap = true) => {
    const r = bar.current!.getBoundingClientRect();
    const f = Math.round(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * span);
    const near = snap && keys.find((k: any) => (Math.abs(k.frame - f) / span) * r.width < 7);
    return near ? near.frame : f;
  };
  const seek = (f: number) => (ed.intro ? ed.seekIntro(f) : ed.setIntroPlayhead(f));
  const onDown = (e: React.PointerEvent, key: any = null) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { key, moved: false };
    seek(key ? key.frame : frameAt(e.clientX));
  };
  const onMove = (e: React.PointerEvent) => {
    const p = press.current;
    if (!p) return;
    if (p.key) {
      if (p.key.before === null || playing) return; // the first keyframe stays at 0
      const f = frameAt(e.clientX, false);
      p.moved = p.moved || f !== p.key.frame;
      if (p.moved) { p.to = f; setDrag({ from: p.key.frame, to: f }); }
    } else seek(frameAt(e.clientX));
  };
  const onUp = () => {
    const p = press.current;
    press.current = null;
    if (p?.key && p.moved && p.to !== undefined) ed.moveIntroKey(p.key, p.to);
    setDrag(null);
  };

  const inShot = !at && head < total ? shots.findIndex((s: any) => head < s.start + s.frames) : -1;
  const where = playing ? "Playing" : at ? `Keyframe ${atIndex + 1}${at.linked ? "" : " · cut"}` : !shots.length ? "No keyframes yet" : head >= total ? "After the end: K adds a keyframe here" : `Between keyframes ${inShot + 1} and ${inShot + 2}: K adds a keyframe here`;

  return (
    <div className="relative flex shrink-0 select-none flex-col border-t bg-sidebar text-xs" style={{ height: shown }} data-intro-timeline>
      <div role="separator" aria-orientation="horizontal" aria-label="Resize the timeline" title="Drag to make the timeline taller or shorter"
        className="absolute inset-x-0 -top-1 z-30 h-2 cursor-row-resize hover:bg-primary/40"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); resize.current = { y: e.clientY, h: shown }; }}
        onPointerMove={(e) => { const r = resize.current; if (r) setHeight(r.now = clampHeight(r.h - (e.clientY - r.y))); }}
        onPointerUp={() => { const r = resize.current; if (r?.now !== undefined) ed.setSetting("introTimelineHeight", r.now); resize.current = null; setHeight(null); }}
        onPointerCancel={() => { resize.current = null; setHeight(null); }}
        onDoubleClick={() => ed.setSetting("introTimelineHeight", 118)} />
      <div className="flex h-10 shrink-0 items-center gap-1 border-b px-2">
        <TimelineButton label="Previous keyframe (,)" disabled={!keys.some((k: any) => k.frame < head - 2)} onClick={() => ed.stepIntroKey(-1)}><SkipBack /></TimelineButton>
        <Button size="icon-sm" aria-label={playing ? "Pause (Space)" : "Play (Space)"} title={playing ? "Pause (Space)" : "Play from the playhead (Space)"} disabled={!shots.length} onClick={() => ed.toggleIntroTimelinePlay()}>
          {playing ? <Pause /> : <Play />}
        </Button>
        <TimelineButton label="Next keyframe (.)" disabled={!keys.some((k: any) => k.frame > head + 2)} onClick={() => ed.stepIntroKey(1)}><SkipForward /></TimelineButton>
        <span className="ml-2 tabular-nums text-foreground">{seconds(drag ? drag.to : head)}</span>
        <span className="tabular-nums text-muted-foreground">/ {seconds(total)}</span>
        <span className="ml-3 min-w-0 truncate text-muted-foreground">{where}</span>
        <label className="ml-auto flex shrink-0 cursor-pointer items-center gap-2 pl-3 text-muted-foreground" title="When on, moving the playhead puts the 3D view on the intro camera at that time">
          <Switch checked={ed.settings.introFollow} onCheckedChange={(v) => { ed.setSetting("introFollow", v); if (v) ed.setIntroPlayhead(ed.introPlayhead); }} />
          View follows playhead
        </label>
        {at && (
          <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => ed.removeIntroKey(at)} title="Delete the keyframe at the playhead (Del)">
            <Trash2 /> Delete
          </Button>
        )}
        <Button size="sm" disabled={playing} onClick={() => ed.setIntroKeyFromView()} title="Saves the 3D view (position, the point it orbits around and zoom) as the keyframe at the playhead">
          <Diamond /> {at ? "Update keyframe" : "Add keyframe"} <Kbd className="ml-0.5 border-primary-foreground/30 bg-transparent text-primary-foreground/80">K</Kbd>
        </Button>
      </div>

      <div className="min-h-0 flex-1 px-4 pb-2 pt-1" onPointerDown={(e) => onDown(e)} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <div ref={bar} className="relative h-full cursor-pointer" aria-label="Intro timeline">
          {ticks.map((t) => (
            <div key={t} className={cn("pointer-events-none absolute top-0 border-l", t % label ? "h-1.5 border-border/70" : "h-full border-border/50")} style={{ left: pct(t) }}>
              {t % label === 0 && span - t > label / 3 && <span className="absolute left-1 top-0 text-[10px] tabular-nums text-muted-foreground">{t / 60}s</span>}
            </div>
          ))}
          {total < span && (
            <div className="pointer-events-none absolute bottom-3 top-5 flex items-center rounded-sm border border-dashed border-border px-2 text-[11px] text-muted-foreground"
              style={{ left: shots.length ? `calc(${pct(total)} + 12px)` : 0, right: 0 }}>
              <span className="truncate">{shots.length ? "Click here, frame the view, press K: the camera flies there" : "Frame the 3D view where the intro starts and press K"}</span>
            </div>
          )}
          {shots.map((s: any, n: number) => (
            <div key={s.index} title={shotSpeedLimits(ed.doc.kmp.CAME[s.index]).length ? "Too short: it cannot reach the next keyframe in time" : undefined}
              className={cn("absolute bottom-3 top-[22px] flex items-center overflow-hidden rounded-[2px] pl-3 pr-1 text-[10px] text-black/75",
                shotSpeedLimits(ed.doc.kmp.CAME[s.index]).length ? "outline-2 outline-dashed -outline-offset-2 outline-red-600" : "pointer-events-none")}
              style={{ left: pct(s.start), width: pct(s.frames), background: SHOT_COLORS[n % SHOT_COLORS.length], opacity: 0.7 }}>
              <span className="truncate">camera {s.index}</span>
            </div>
          ))}
          {keys.map((k: any, n: number) => {
            const f = drag && drag.from === k.frame ? drag.to : k.frame;
            const on = at?.frame === k.frame;
            return (
              <button key={n} type="button" aria-label={`Keyframe ${n + 1}`}
                title={`Keyframe ${n + 1} · ${seconds(k.frame)}${k.linked ? "" : " · cut"}${k.before !== null ? " · drag to change its time" : ""}`}
                onPointerDown={(e) => onDown(e, k)}
                className={cn("absolute top-[calc(50%+5px)] z-10 size-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border-2", k.before !== null && "cursor-grab active:cursor-grabbing",
                  on ? "border-foreground bg-primary" : "border-foreground/80 bg-background hover:bg-accent", !k.linked && "border-dashed")}
                style={{ left: pct(f) }} />
            );
          })}
          <div className="pointer-events-none absolute inset-y-0 z-20 w-px bg-primary" style={{ left: pct(drag ? drag.to : head) }}>
            <div className="absolute -left-[5px] top-0 h-2.5 w-[11px] rounded-b-sm bg-primary" />
          </div>
        </div>
      </div>
    </div>
  );
}

function TimelineButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return <Button size="icon-sm" variant="ghost" aria-label={label} title={label} disabled={disabled} onClick={onClick}>{children}</Button>;
}
