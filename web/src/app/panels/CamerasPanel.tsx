import * as React from "react";
import { ArrowDown, ArrowUp, BookOpen, Camera, Clapperboard, Crosshair, Eye, ListPlus, Play, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CAMERA_TYPES } from "../../../js/data/defs.js";
import { OPENING_TYPES, cameraFrames, introChain, introIndex, selectionIndex } from "../../../js/editor/cameras.js";
import { useEditor } from "../hooks";
import { dialogs } from "../dialogs-store";
import { SectionTitle } from "../common";
import { NumberField } from "../number-field";
import { SHOT_COLORS, seconds } from "../IntroTimeline";
import { introShotIssues, shotSpeedLimits } from "../../../js/editor/intro-keys.js";
import { cn } from "@/lib/utils";

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
  const issues = introShotIssues(k);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-3">
      <div className="mb-2.5 flex items-baseline gap-2 text-[11px] text-muted-foreground">
        <span className="text-sm font-semibold text-foreground">Intro</span>
        <span className="ml-auto tabular-nums">{chain.length ? `${chain.length + 1} keyframes` : "no keyframes"} · {seconds(timeline.total, 1)}</span>
      </div>
      {issues.length > 0 && (
        <div className="mb-2.5 flex flex-col gap-1.5 rounded-md border p-2 text-[11px] leading-relaxed">
          <span><b>{issues.length} shot{issues.length === 1 ? "" : "s"}</b> {issues.length === 1 ? "plays" : "play"} differently in the game than in this preview (made by an older version of the editor): {[...new Set(issues.flatMap((i: any) => i.problems))].join("; ")}.</span>
          <Button size="sm" variant="secondary" className="self-start" onClick={() => ed.fixIntroCameras()}>Fix intro cameras</Button>
        </div>
      )}
      <IntroKeyframes />
      <Button size="sm" variant="ghost" className="mt-1.5 self-start text-muted-foreground" onClick={() => dialogs.open("help", { tab: "tutorials", tutorial: "intro" })}><BookOpen /> How to make an intro</Button>

      {chain.length > 0 && <SectionTitle>Shots (game cameras between keyframes)</SectionTitle>}
      <div className="flex flex-col gap-0.5">
        {chain.map((i: number, n: number) => {
          const c = k.CAME[i];
          return (
            <div key={c.uid} onClick={() => ed.setIntroPlayhead(timeline.shots[n].start)} onDoubleClick={() => ed.viewFromCamera(i)}
              className={cn("group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/60", i === selected && "bg-accent")}>
              <span className="size-2.5 shrink-0 rounded-sm" style={{ background: SHOT_COLORS[n % SHOT_COLORS.length] }} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px]">Keyframe {n + 1} → {n + 2} <span className="text-muted-foreground">· camera {i}</span></div>
                <div className="truncate text-[10.5px] text-muted-foreground">{c.route !== 0xff ? `Follows route ${c.route}` : "Fixed position"} · {seconds(cameraFrames(c), 1)}</div>
                {shotSpeedLimits(c).length > 0 && <div className="text-[10.5px] leading-snug text-warning">Too short: its {shotSpeedLimits(c).join(" and ")} cannot reach the next keyframe in time. Make it longer.</div>}
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

// Keyframes of the intro in time order; the one at the playhead opens with its values.
function IntroKeyframes() {
  const ed = useEditor("doc", "intro", "selection");
  const { keys, shots } = ed.introKeyframes();
  const at = ed.intro ? null : ed.introKeyAtPlayhead();
  if (!shots.length) return (
    <ol className="m-0 flex list-decimal flex-col gap-1.5 pl-4 text-[11px] leading-relaxed text-muted-foreground">
      <li>Fly the 3D view to where the intro starts (right-drag and W A S D).</li>
      <li>Press <b className="text-foreground">K</b> (or <b className="text-foreground">Add keyframe</b> under the 3D view).</li>
      <li>Click later on the timeline, frame the next view and press K again. The camera flies from one keyframe to the next.</li>
    </ol>
  );
  return (
    <div className="flex flex-col gap-0.5">
      {keys.map((k: any, n: number) => {
        const on = at?.frame === k.frame;
        return (
          <div key={n} className={cn("rounded-md", on && "bg-accent/60")}>
            <button type="button" onClick={() => ed.setIntroPlayhead(k.frame)}
              className={cn("flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent/60", on && "hover:bg-transparent")}>
              <span className={cn("size-2.5 shrink-0 rotate-45 border-2", on ? "border-foreground bg-primary" : "border-foreground/70", !k.linked && "border-dashed")} />
              <span className="flex-1 text-[12.5px]">Keyframe {n + 1}</span>
              {!k.linked && <span className="text-[10.5px] text-muted-foreground">cut</span>}
              <span className="w-14 text-right text-[11px] tabular-nums text-muted-foreground">{seconds(k.frame)}</span>
            </button>
            {on && <KeyframeDetails k={k} />}
          </div>
        );
      })}
    </div>
  );
}

type Pose = { position: number[]; target: number[]; fov: number };

// Time, transition and camera values of the keyframe at the playhead.
function KeyframeDetails({ k }: { k: any }) {
  const ed = useEditor("doc", "intro");
  const middle = k.before !== null && k.after !== null;
  // A smooth keyframe shows one view; "Cut" shows the two sides so each can be set on its own.
  const [split, setSplit] = React.useState(false);
  const cut = middle && (!k.linked || split);
  return (
    <div className="flex flex-col gap-2.5 px-2 pb-2.5 pt-1">
      <div className="grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1.5 text-[11px]">
        <span className="text-muted-foreground">Time (s)</span>
        <NumberField commit aria-label="Keyframe time" className="h-7 w-24 text-xs" value={Math.round((k.frame / 60) * 100) / 100} min={0} step={0.1}
          disabled={k.before === null} title={k.before === null ? "The first keyframe is the start of the intro" : undefined} onValue={(v) => ed.moveIntroKey(k, Math.round(v * 60))} />
        {middle && <>
          <span className="text-muted-foreground">Transition</span>
          <div className="flex rounded-md border p-0.5">
            <button type="button" className={cn("cursor-pointer rounded px-2 py-0.5", !cut ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}
              title="The camera flies through this keyframe" onClick={() => { setSplit(false); if (!k.linked) ed.joinIntroCut(k); }}>Smooth</button>
            <button type="button" className={cn("cursor-pointer rounded px-2 py-0.5", cut ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}
              title="The shot before ends on one view and the next one starts on another" onClick={() => setSplit(true)}>Cut</button>
          </div>
        </>}
      </div>
      {cut ? <>
        <PoseFields title="End of the shot before" pose={k.beforePose} onPose={(p) => ed.setIntroKeyPose(k, p, "before")} onFromView={() => ed.setIntroKeyFromView("before")} />
        <PoseFields title="Start of the shot after" pose={k.afterPose} onPose={(p) => ed.setIntroKeyPose(k, p, "after")} onFromView={() => ed.setIntroKeyFromView("after")} />
      </> : <PoseFields pose={k.pose} onPose={(p) => ed.setIntroKeyPose(k, p)} onFromView={() => ed.setIntroKeyFromView()} />}
      <Button size="sm" variant="ghost" className="self-start text-muted-foreground hover:text-destructive" onClick={() => ed.removeIntroKey(k)}><Trash2 /> Delete keyframe</Button>
    </div>
  );
}

function PoseFields({ title, pose, onPose, onFromView }: { title?: string; pose: Pose; onPose: (pose: Pose) => void; onFromView: () => void }) {
  const ed = useEditor("doc");
  const vector = (label: string, field: "position" | "target") => (
    <>
      <span className="text-muted-foreground">{label}</span>
      {[0, 1, 2].map((a) => (
        <NumberField key={a} commit aria-label={`${label} ${"XYZ"[a]}`} title={"XYZ"[a]} className="h-7 min-w-0 px-1.5 text-xs" value={Math.round(pose[field][a])} step={10}
          onValue={(v) => { const next = [...pose[field]]; next[a] = v; onPose({ ...pose, [field]: next }); }} />
      ))}
    </>
  );
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        {title && <span className="text-[11px] font-medium">{title}</span>}
        <Button size="sm" variant="outline" className="ml-auto h-6 px-1.5 text-[11px]" onClick={onFromView} title="Uses the 3D view: its position, the point it orbits around and its zoom"><Camera /> From view</Button>
        <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" onClick={() => ed.viewFromPose(pose)} title="Moves the 3D view to this camera"><Eye /> Go to</Button>
      </div>
      <div className="grid grid-cols-[auto_1fr_1fr_1fr] items-center gap-1 text-[11px]">
        {vector("Position", "position")}
        {vector("Looks at", "target")}
        <span className="text-muted-foreground">Zoom (°)</span>
        <NumberField commit aria-label="Zoom" title="Field of view in degrees: smaller is more zoomed in" className="h-7 min-w-0 px-1.5 text-xs" value={Math.round(pose.fov * 10) / 10} min={1} max={170} step={1}
          onValue={(v) => onPose({ ...pose, fov: v })} />
      </div>
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
          <span className="w-16 text-right text-[11px] tabular-nums text-muted-foreground">{seconds(frame, 1)} / {seconds(frames, 1)}</span>
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
