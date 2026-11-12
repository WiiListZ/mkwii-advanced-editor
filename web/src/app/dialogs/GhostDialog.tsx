// Ghost editor: reads and changes .rkg files. Recording them is in GhostRecordDialog.
// A ghost holds the buttons pressed, not the kart's path, which is what the notes here warn about.

import * as React from "react";
import { Box, FileUp, Pause, Play, Plus, Save, SkipBack, Trash2, Video, X } from "lucide-react";
import { compareGhosts, differenceText } from "../../../js/editor/ghost-compare.js";
import { ghostPoseAt } from "../../../js/editor/ghost-drive.js";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { api } from "../../../js/api.js";
import { CHARACTERS, VEHICLES } from "../../../js/formats/params.js";
import { buildRKG, CONTROLLERS, COUNTDOWN_FRAMES, COURSE_NAMES, FRAMES_PER_SECOND, ghostClock, inputFrames, inputsAtFrame, parseRKG, timeText } from "../../../js/formats/rkg.js";
import { dialogs } from "../dialogs-store";
import { editor } from "../editor";
import { NumberField } from "../number-field";

const RKG_FILTER = [{ name: "Ghost file", extensions: ["rkg"] }];
// path: the .rkg file it is saved to. save and key: for a ghost of a Dolphin save, which save and which
// ghost in it, so that the list can show it as the one open (it has no file of its own to save to).
type Source = { kind: "file" | "game" | "save"; label: string; path?: string; save?: string; key?: string };
// Which entry of the list a source is: a file by its path, a save's ghost by the save and its key.
const sourceId = (source: { path?: string; save?: string; key?: string } | null) =>
  source?.save && source.key !== undefined ? `s|${source.save.toLowerCase()}|${source.key}` : source?.path ? `p|${source.path.toLowerCase()}` : null;
// An entry of the list of ghosts; the one open stands out, with a bar at its side.
function GhostEntry({ open, onClick, title, detail }: { open: boolean; onClick: () => void; title: string; detail: string }) {
  // Opened from elsewhere (a file, the recording window), it is brought into sight in the list.
  const ref = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => { if (open) ref.current?.scrollIntoView({ block: "nearest" }); }, [open]);
  return <button ref={ref} type="button" onClick={onClick} aria-current={open ? "true" : undefined} data-ghost-open={open || undefined}
    className={cn("flex w-full cursor-pointer flex-col border-b border-l-2 px-2 py-1 text-left text-[11px]", open ? "border-l-foreground bg-accent text-accent-foreground" : "border-l-transparent hover:bg-accent/60")}>
    <span className={cn("truncate", open && "font-semibold")}>{title}</span>
    <span className={cn("truncate", open ? "text-accent-foreground/80" : "text-muted-foreground")}>{detail}</span>
  </button>;
}
type Section = "face" | "direction" | "tricks";
const PAGE = 40;

const nameOf = (list: string[], id: number, fallback: string) => list[id] ?? `${fallback} ${id}`;
const characterName = (id: number) => id <= 0x17 ? CHARACTERS[id] : id <= 0x29 ? `Mii outfit ${id}` : `Character ${id}`;

function Pick({ label, value, options, onChange }: { label: string; value: number; options: [number, string][]; onChange: (value: number) => void }) {
  return <label className="flex items-center gap-2 text-xs">
    <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
    <select aria-label={label} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-7 min-w-0 flex-1 rounded-md border bg-background px-1.5 text-xs">
      {options.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
    </select>
  </label>;
}

function Num({ label, value, min, max, onChange, width = "w-16" }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void; width?: string }) {
  return <label className="flex items-center gap-1 text-xs">
    <span className="sr-only">{label}</span>
    <NumberField commit integer aria-label={label} value={value} min={min} max={max} onValue={onChange} className={cn("h-7 px-1.5 text-xs", width)} />
  </label>;
}

function TimeField({ label, value, onChange }: { label: string; value: any; onChange: (value: any) => void }) {
  return <div className="flex items-center gap-1 text-xs">
    <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
    <Num label={`${label} minutes`} value={value.minutes} min={0} max={127} width="w-12" onChange={(minutes) => onChange({ ...value, minutes })} /> :
    <Num label={`${label} seconds`} value={value.seconds} min={0} max={59} width="w-12" onChange={(seconds) => onChange({ ...value, seconds })} /> .
    <Num label={`${label} milliseconds`} value={value.milliseconds} min={0} max={999} width="w-14" onChange={(milliseconds) => onChange({ ...value, milliseconds })} />
  </div>;
}

// What was pressed, along the race: one lane per button, and the stick as two lines.
function Timeline({ inputs, frame, total, onSeek }: { inputs: any; frame: number; total: number; onSeek: (frame: number) => void }) {
  const canvas = React.useRef<HTMLCanvasElement>(null);
  React.useLayoutEffect(() => {
    const c = canvas.current, ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const width = c.clientWidth || 600, height = 120, dpr = Math.min(2, devicePixelRatio || 1);
    c.width = width * dpr; c.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#14181c"; ctx.fillRect(0, 0, width, height);
    const scale = width / total;
    const lanes: [string, number, string][] = [["Accel", 1, "#4ade80"], ["Brake", 2, "#fbbf24"], ["Item", 4, "#38bdf8"]];
    lanes.forEach(([, mask, color], lane) => {
      let at = 0;
      for (const entry of inputs.face) {
        if (entry.state & mask) { ctx.fillStyle = color; ctx.fillRect(at * scale, 4 + lane * 14, Math.max(1, entry.frames * scale), 10); }
        at += entry.frames;
      }
    });
    let at = 0;
    for (const entry of inputs.tricks) {
      if (entry.state & 0x70) { ctx.fillStyle = "#c084fc"; ctx.fillRect(at * scale, 46, Math.max(1, entry.frames * scale), 10); }
      at += entry.frames;
    }
    const stick = (shift: number, color: string) => {
      ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath();
      let position = 0;
      for (const [i, entry] of inputs.direction.entries()) {
        const y = 90 - (((entry.state >> shift) & 15) - 7) * 3.5;
        if (i) ctx.lineTo(position * scale, y); else ctx.moveTo(0, y);
        position += entry.frames;
        ctx.lineTo(position * scale, y);
      }
      ctx.stroke();
    };
    stick(4, "#fb7185"); stick(0, "#e5e7eb");
  }, [inputs, total]);
  const seek = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(total - 1, Math.round((e.clientX - rect.left) / rect.width * total))));
  };
  return <div className="relative h-[120px] w-full cursor-pointer touch-none overflow-hidden rounded border"
    onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); seek(e); }} onPointerMove={(e) => { if (e.buttons & 1) seek(e); }}>
    <canvas ref={canvas} aria-label="Ghost inputs over time" className="block h-[120px] w-full" />
    <div className="pointer-events-none absolute inset-y-0 w-px bg-white" style={{ left: `${frame / total * 100}%` }} data-ghost-playhead />
  </div>;
}

function Lamp({ on, label, color }: { on: boolean; label: string; color: string }) {
  return <span data-lamp={label} data-on={on} className="flex h-7 min-w-16 items-center justify-center rounded border px-2 text-[11px] font-medium"
    style={on ? { backgroundColor: color, borderColor: color, color: "#101417" } : undefined}>{label}</span>;
}

// Plays the ghost's inputs. The file holds no positions: seeing the kart itself would take the game.
function GhostPreview({ ghost, onFrame, inline = true }: { ghost: any; onFrame?: (frame: number) => void; inline?: boolean }) {
  const total = Math.max(1, inputFrames(ghost.inputs.face), inputFrames(ghost.inputs.direction), inputFrames(ghost.inputs.tricks));
  const [frame, setFrame] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [speed, setSpeed] = React.useState(1);
  const shown = Math.min(frame, total - 1);
  React.useEffect(() => {
    if (!playing) return;
    let handle = 0, last = performance.now(), position = shown;
    const step = (now: number) => {
      position += (now - last) / 1000 * FRAMES_PER_SECOND * speed;
      last = now;
      if (position >= total - 1) { setFrame(total - 1); setPlaying(false); return; }
      setFrame(Math.floor(position));
      handle = requestAnimationFrame(step);
    };
    handle = requestAnimationFrame(step);
    return () => cancelAnimationFrame(handle);
  }, [playing, speed, total]);
  React.useEffect(() => { onFrame?.(shown); }, [shown, onFrame]);
  const held = inputsAtFrame(ghost.inputs, shown), { clock, lap, finished } = ghostClock(ghost, shown);
  const time = (value: number) => {
    const size = Math.abs(value), minutes = Math.floor(size / 60);
    return `${value < 0 ? "-" : ""}${minutes}:${(size - minutes * 60).toFixed(3).padStart(6, "0")}`;
  };
  const togglePlay = () => {
    if (!playing && shown >= total - 1) setFrame(0);
    setPlaying(!playing);
  };
  const seek = (next: number) => { setPlaying(false); setFrame(next); };
  // Space plays and pauses. In the 3D window nothing else wants it. In the ghost editor it stays with
  // whatever has the focus, such as a field being typed in, and with any window opened over this one.
  const section = React.useRef<HTMLElement>(null), toggle = React.useRef(togglePlay);
  toggle.current = togglePlay;
  React.useEffect(() => {
    let ours = false;
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.ctrlKey || e.altKey || e.metaKey) return;
      const target = e.target as Element | null;
      if (inline) {
        const box = section.current?.closest('[role="dialog"]');
        if (box && target && target !== document.body && !box.contains(target)) return;
        if (document.querySelector('[role="alertdialog"]')) return;
        if (target?.closest?.('input, select, textarea, button, a, [role="button"], [role="menuitem"], [role="option"], [contenteditable="true"]')) return;
      }
      e.preventDefault();
      ours = true;
      if (!e.repeat) toggle.current();
    };
    // A focused button clicks itself when the key comes back up: that press was already used.
    const up = (e: KeyboardEvent) => { if (e.code === "Space" && ours) { e.preventDefault(); ours = false; } };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    return () => { window.removeEventListener("keydown", down, true); window.removeEventListener("keyup", up, true); };
  }, [inline]);
  const size = 76, center = size / 2, reach = size / 2 - 9;
  return <section ref={section} className="flex flex-col gap-2" data-ghost-preview data-frame={shown} data-playing={playing}>
    {inline && <div className="flex items-center gap-2"><span className="flex-1 text-xs font-semibold">Preview</span>
      <Button size="sm" variant="secondary" className="h-7 gap-1 px-2 text-xs" title="Opens the track in its own window, showing only this ghost" onClick={() => editor.openGhostPreview(ghost)}><Box className="size-3.5" /> Watch in 3D (beta)</Button>
    </div>}
    <div className="flex flex-wrap items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label="Stick" className="shrink-0">
        <circle cx={center} cy={center} r={center - 1} fill="#14181c" stroke="currentColor" strokeOpacity={.3} />
        <line x1={center} y1={4} x2={center} y2={size - 4} stroke="currentColor" strokeOpacity={.15} />
        <line x1={4} y1={center} x2={size - 4} y2={center} stroke="currentColor" strokeOpacity={.15} />
        <circle cx={center + held.stickX * reach} cy={center - held.stickY * reach} r={7} fill="#fb7185" data-stick-x={held.stickX} data-stick-y={held.stickY} />
      </svg>
      <div className="flex flex-wrap gap-1.5">
        <Lamp on={held.accelerate} label="Accel" color="#4ade80" />
        <Lamp on={held.brake} label="Brake" color="#fbbf24" />
        <Lamp on={held.item} label="Item" color="#38bdf8" />
        <Lamp on={!!held.trick} label={held.trick ? `Trick ${held.trick}` : "Trick"} color="#c084fc" />
      </div>
      <div className="ml-auto text-right">
        <div className="font-mono text-lg tabular-nums leading-none" data-ghost-clock>{clock < 0 ? `Start in ${Math.ceil((COUNTDOWN_FRAMES - shown) / 60)}` : time(clock)}</div>
        <div className="mt-1 text-[11px] text-muted-foreground">{finished ? "Finished" : clock < 0 ? "Countdown" : `Lap ${lap} of ${ghost.laps}`} · frame {shown}</div>
      </div>
    </div>
    <Timeline inputs={ghost.inputs} frame={shown} total={total} onSeek={seek} />
    <div className="flex flex-wrap items-center gap-1.5">
      <Button size="sm" variant="secondary" className="h-7 gap-1 px-2 text-xs" title="Space" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>{playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}{playing ? "Pause" : "Play"}</Button>
      <Button size="icon-sm" variant="ghost" aria-label="To the start" title="To the start" onClick={() => seek(0)}><SkipBack /></Button>
      <Button size="icon-sm" variant="ghost" aria-label="Previous frame" title="Previous frame" onClick={() => seek(Math.max(0, shown - 1))}>‹</Button>
      <Button size="icon-sm" variant="ghost" aria-label="Next frame" title="Next frame" onClick={() => seek(Math.min(total - 1, shown + 1))}>›</Button>
      <label className="ml-1 flex items-center gap-1 text-[11px] text-muted-foreground">Speed
        <select aria-label="Preview speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="h-7 rounded-md border bg-background px-1 text-[11px]">
          {[.25, .5, 1, 2, 4].map((value) => <option key={value} value={value}>{value}×</option>)}
        </select></label>
    </div>
    {inline && <p className="text-[11px] text-muted-foreground">From the top: accelerate, brake or drift, item, trick; below, the stick (left and right in red, up and down in white). This plays what the driver pressed. Watch in 3D shows it on the track: the file holds no positions, so the path is worked out from these inputs with Kinoko, as the game drives it, when the game's files are in the game folder; otherwise it is approximate.</p>}
  </section>;
}

// Two ghosts along the race, from its start: the first above, the second below, and between them
// where they pressed something different.
function CompareTimeline({ a, b, spans }: { a: any; b: any; spans: { from: number; to: number }[] }) {
  const canvas = React.useRef<HTMLCanvasElement>(null);
  React.useLayoutEffect(() => {
    const c = canvas.current, ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const width = c.clientWidth || 600, height = 132, dpr = Math.min(2, devicePixelRatio || 1);
    c.width = width * dpr; c.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#14181c"; ctx.fillRect(0, 0, width, height);
    const total = Math.max(inputFrames(a.inputs.face), inputFrames(b.inputs.face), 1), scale = width / total;
    const draw = (ghost: any, top: number, color: string) => {
      let at = 0;
      for (const entry of ghost.inputs.face) {
        if (entry.state & 1) { ctx.fillStyle = "#4ade80"; ctx.fillRect(at * scale, top, Math.max(1, entry.frames * scale), 5); }
        if (entry.state & 2) { ctx.fillStyle = "#fbbf24"; ctx.fillRect(at * scale, top + 6, Math.max(1, entry.frames * scale), 4); }
        if (entry.state & 4) { ctx.fillStyle = "#38bdf8"; ctx.fillRect(at * scale, top + 11, Math.max(1, entry.frames * scale), 4); }
        at += entry.frames;
      }
      ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath();
      at = 0;
      for (const [i, entry] of ghost.inputs.direction.entries()) {
        const y = top + 30 - (((entry.state >> 4) & 15) - 7) * 1.9;
        if (i) ctx.lineTo(at * scale, y); else ctx.moveTo(0, y);
        at += entry.frames;
        ctx.lineTo(at * scale, y);
      }
      ctx.stroke();
    };
    draw(a, 3, "#fb7185");
    draw(b, 83, "#e5e7eb");
    ctx.fillStyle = "#f97316";
    for (const span of spans) ctx.fillRect(span.from * scale, 62, Math.max(1, (span.to - span.from + 1) * scale), 16);
  }, [a, b, spans]);
  return <canvas ref={canvas} aria-label="The two ghosts over time" className="block h-[132px] w-full rounded border" />;
}

// The ghost open in the editor against another one. Nothing here changes either of them.
function GhostCompare({ ghost, label, sources }: { ghost: any; label: string; sources: any }) {
  const [other, setOther] = React.useState<{ ghost: any; label: string } | null>(null);
  const choices = [
    ...(sources.recorded || []).map((item: any) => ({ id: `r|${item.path}`, track: item.track, text: `${nameOf(COURSE_NAMES, item.track, "Track")} · ${item.time} · ${item.name}`, read: async () => (await api.readPath(item.path)).data })),
    ...sources.saves.flatMap((save: any) => save.ghosts.map((item: any) => ({ id: `s|${save.path}|${item.key}`, track: item.track, text: `${nameOf(COURSE_NAMES, item.track, "Track")} · ${item.time} · ${save.region} save, license ${item.license + 1}`, read: () => api.ghostSaveFile(save.path, item.key) }))),
    ...sources.game.map((item: any) => ({ id: `g|${item.path}`, track: item.track, text: `${nameOf(COURSE_NAMES, item.track, "Track")} · ${item.time} · ${item.name}`, read: async () => (await api.readPath(item.path)).data })),
  ].sort((one: any, two: any) => Number(two.track === ghost.track) - Number(one.track === ghost.track));
  const take = (data: Uint8Array, text: string) => {
    try { setOther({ ghost: parseRKG(data), label: text }); } catch (e: any) { toast.error("Could not read the ghost", { description: e.message }); }
  };
  const pick = async (id: string) => {
    const choice = choices.find((item: any) => item.id === id);
    if (!choice) return setOther(null);
    try { take(await choice.read(), choice.text); } catch (e: any) { toast.error("Could not read the ghost", { description: e.message }); }
  };
  const openOther = async () => {
    const file = await api.openFile(RKG_FILTER, "Choose the ghost to compare with");
    if (file) take(file.data, file.name);
  };
  const result = other ? compareGhosts(ghost, other.ghost) : null;
  const percent = (share: number) => `${Math.round(share * 100)}%`;
  const row = (name: string, one: string | number, two: string | number) => <tr key={name} className="border-b last:border-b-0">
    <td className="py-1 pr-3 text-muted-foreground">{name}</td><td className="py-1 pr-3 tabular-nums">{one}</td><td className="py-1 tabular-nums">{two}</td>
  </tr>;
  const swing = (ms: number | null) => <span className="tabular-nums">{differenceText(ms)}</span>;
  return <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1" data-ghost-compare>
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">Compare with</span>
      <select aria-label="Ghost to compare with" value={choices.find((item: any) => item.text === other?.label)?.id || ""} onChange={(e) => void pick(e.target.value)} className="h-7 min-w-0 flex-1 rounded-md border bg-background px-1.5 text-xs">
        <option value="">Choose a ghost…</option>
        {choices.map((item: any) => <option key={item.id} value={item.id}>{item.text}</option>)}
      </select>
      <Button size="sm" variant="secondary" className="h-7 px-2 text-xs" onClick={openOther}><FileUp /> Open .rkg…</Button>
    </div>
    {!result ? <p className="text-xs text-muted-foreground">Choose a second ghost to see the lap times and inputs of both. Ghosts of the same track are listed first.</p> : <>
      {!result.sameTrack && <p className="m-0 text-xs text-amber-400">These ghosts are on different tracks, so their inputs say little about each other.</p>}
      <div data-compare-total={result.total.difference}>
        <div className="text-xs font-semibold">Times</div>
        <table className="mt-1 w-full border-collapse text-xs">
          <thead><tr className="border-b text-left text-[11px] text-muted-foreground"><th className="py-1 pr-3 font-normal"></th><th className="py-1 pr-3 font-normal">This ghost</th><th className="py-1 pr-3 font-normal">The other</th><th className="py-1 pr-3 font-normal">Lap difference</th><th className="py-1 font-normal">Since the start</th></tr></thead>
          <tbody>
            {result.laps.map((lap: any) => <tr key={lap.lap} className="border-b" data-compare-lap={lap.lap}>
              <td className="py-1 pr-3 text-muted-foreground">Lap {lap.lap}</td>
              <td className="py-1 pr-3 tabular-nums">{lap.a === null ? "–" : differenceText(lap.a).replace("+", "")}</td>
              <td className="py-1 pr-3 tabular-nums">{lap.b === null ? "–" : differenceText(lap.b).replace("+", "")}</td>
              <td className="py-1 pr-3">{swing(lap.difference)}</td>
              <td className="py-1">{swing(lap.running)}</td>
            </tr>)}
            <tr className="font-semibold"><td className="py-1 pr-3">Finish</td><td className="py-1 pr-3 tabular-nums">{timeText(ghost.time)}</td><td className="py-1 pr-3 tabular-nums">{timeText(other!.ghost.time)}</td><td className="py-1 pr-3">{swing(result.total.difference)}</td><td></td></tr>
          </tbody>
        </table>
        <p className="mb-0 mt-1 text-[11px] text-muted-foreground">A minus means the other ghost was faster. {label} against {other!.label}.</p>
      </div>
      <div>
        <div className="mb-1 text-xs font-semibold">Inputs</div>
        <CompareTimeline a={ghost} b={other!.ghost} spans={result.spans} />
        <p className="mb-0 mt-1 text-[11px] text-muted-foreground" data-compare-inputs>This ghost above and the other below: accelerate, brake and item, then the steering. Orange in the middle marks where they press something different. {result.sameInputs ? "Their inputs are the same." : result.firstDifferenceSeconds === null ? "They press the same things while both last." : `They first differ ${result.firstDifferenceSeconds.toFixed(2)} s into the race, and for ${percent(result.differingShare)} of it. Early differences move everything after them, so later ones may mean little.`}</p>
      </div>
      <table className="w-full border-collapse text-xs">
        <thead><tr className="border-b text-left text-[11px] text-muted-foreground"><th className="py-1 pr-3 font-normal">How they drove</th><th className="py-1 pr-3 font-normal">This ghost</th><th className="py-1 font-normal">The other</th></tr></thead>
        <tbody>
          {row("Vehicle", nameOf(VEHICLES, ghost.vehicle, "Vehicle"), nameOf(VEHICLES, other!.ghost.vehicle, "Vehicle"))}
          {row("Character", characterName(ghost.character), characterName(other!.ghost.character))}
          {row("Accelerating", percent(result.driving.a.acceleratingShare), percent(result.driving.b.acceleratingShare))}
          {row("Brake or drift held", percent(result.driving.a.brakingShare), percent(result.driving.b.brakingShare))}
          {row("Hops and drifts", result.driving.a.hops, result.driving.b.hops)}
          {row("Mushrooms used", Math.min(3, result.driving.a.items), Math.min(3, result.driving.b.items))}
          {row("Trick and wheelie presses", result.driving.a.tricks, result.driving.b.tricks)}
        </tbody>
      </table>
    </>}
  </div>;
}

// Where the path shown comes from, and when it is not the game's, a way to read the game's.
function GhostPathNote({ state }: { state: any }) {
  const path = state.drive.recorded;
  const readFromGame = <Button size="sm" variant="secondary" className="h-7 shrink-0 px-2 text-xs" title="The game races this ghost in Dolphin, and the path its kart drives is read" onClick={() => dialogs.open("ghostReplay", { ghost: state.ghost })}>Read the path from the game…</Button>;
  if (path?.source === "game") return <p className="m-0 text-[11px] text-muted-foreground" data-ghost-path="recorded">Beta: the path the kart really drove, read from the game in Dolphin.</p>;
  if (path?.source === "kinoko" && path.synced) return <p className="m-0 text-[11px] text-muted-foreground" data-ghost-path="kinoko">Beta: the path the game drives this ghost on, worked out from its buttons with Kinoko, a reimplementation of the game's physics. It reaches the ghost's own finish time, as in the game.</p>;
  if (path?.source === "kinoko") return <div className="flex items-start gap-2"><p className="m-0 flex-1 text-[11px] text-amber-300" data-ghost-path="kinoko-off">Beta: worked out from its buttons with Kinoko, a reimplementation of the game's physics, but on this track the ghost does not reach its own time{path.lap ? `, from lap ${path.lap}` : " at the finish"}. The track differs from the one it was driven on, or the game does something there that Kinoko does not yet: from that point it is not where the game drives it.</p>{readFromGame}</div>;
  return <div className="flex items-start gap-2"><p className="m-0 flex-1 text-[11px] text-muted-foreground" data-ghost-path="approximate">Beta: approximate path. A ghost file holds the buttons pressed, not positions: here the kart follows the track's enemy route and reaches each lap line at the ghost's real lap time, with its pace and steering taken from the inputs. Jumps come from the track's collision, and a trick press moves the kart to the nearest ramp. The game's path is worked out with Kinoko when the game's files are in the game folder, or read from the game itself.</p>{readFromGame}</div>;
}

// The window of a ghost preview: the track behind, these controls in front of everything else.
export function GhostPlayer() {
  const state = editor.ghostView!;
  const [view, setView] = React.useState("chase");
  const viewRef = React.useRef(view), frameRef = React.useRef(0);
  viewRef.current = view;
  const [shownFrame, setShownFrame] = React.useState(0);
  const onFrame = React.useCallback((frame: number) => { frameRef.current = frame; setShownFrame(frame); editor.showGhostFrame(frame, viewRef.current); }, []);
  React.useEffect(() => { editor.showGhostFrame(frameRef.current, view); }, [view]);
  const { ghost } = state;
  const pose = ghostPoseAt(state.drive, shownFrame);
  return <div className="absolute inset-0 z-10 flex flex-col justify-between" data-ghost-player onContextMenu={(e) => e.preventDefault()}>
    <div className="flex items-start gap-3 p-3">
      <div className="min-w-0 rounded bg-[#10151a]/85 px-2.5 py-1.5 text-white">
        <div className="text-xs font-semibold">{COURSE_NAMES[ghost.track] ?? "Track"} · {timeText(ghost.time)}</div>
        <div className="text-[11px] text-white/70">{characterName(ghost.character)} · {nameOf(VEHICLES, ghost.vehicle, "Vehicle")}{ghost.miiName ? ` · ${ghost.miiName}` : ""}</div>
        {state.check && !state.check.ok && <div className="mt-1 max-w-[340px] text-[11px] text-amber-300" data-ghost-track-check={state.check.problems.some((p: any) => p.level === "wrong") ? "wrong" : "unlikely"}>
          {state.check.problems.map((p: any) => p.text).join(" ")} A ghost holds the buttons pressed, so on another track it does not drive where it did.{!state.check.named ? ` This file's name is not one of the game's tracks, so it may still be ${state.check.expected} under another name.` : ""}
        </div>}
        <div className="text-[11px] text-white/70" data-ghost-mushrooms={pose.mushrooms} data-ghost-boost={pose.boost > 0} data-ghost-drift={pose.drift || 0}>Mushrooms left: {pose.mushrooms}{pose.boost > 0 ? " · boost" : ""}{pose.drift >= 3 ? " · super mini-turbo" : pose.drift === 2 ? " · mini-turbo" : pose.drift === 1 ? " · drifting" : ""}</div>
      </div>
      <div className="ml-auto flex gap-1 rounded bg-[#10151a]/85 p-1">
        {([["chase", "Behind"], ["side", "Side"], ["above", "Above"]] as const).map(([id, text]) => <Button key={id} size="sm" variant={view === id ? "secondary" : "ghost"} className="h-7 px-2 text-xs text-white hover:text-white" aria-pressed={view === id} onClick={() => setView(id)}>{text}</Button>)}
      </div>
    </div>
    <div className="flex flex-col gap-1.5 bg-background/90 p-3">
      <GhostPreview ghost={ghost} onFrame={onFrame} inline={false} />
      <GhostPathNote state={state} />
    </div>
  </div>;
}

function InputTable({ inputs, onChange }: { inputs: any; onChange: (inputs: any) => void }) {
  const [section, setSection] = React.useState<Section>("face");
  const [page, setPage] = React.useState(0);
  const list = inputs[section], pages = Math.max(1, Math.ceil(list.length / PAGE)), current = Math.min(page, pages - 1);
  const maxFrames = section === "tricks" ? 4095 : 255;
  const update = (index: number, next: any) => onChange({ ...inputs, [section]: list.map((entry: any, i: number) => i === index ? { ...entry, ...next } : entry) });
  const insert = (index: number) => onChange({ ...inputs, [section]: [...list.slice(0, index + 1), { ...list[index] ?? { state: 0 }, frames: 1 }, ...list.slice(index + 1)] });
  const remove = (index: number) => onChange({ ...inputs, [section]: list.filter((_: any, i: number) => i !== index) });
  const frames = [inputFrames(inputs.face), inputFrames(inputs.direction), inputFrames(inputs.tricks)];
  const row = (entry: any) => {
    if (section === "face") return (i: number) => <>
      {([[1, "Accel"], [2, "Brake"], [4, "Item"]] as const).map(([mask, text]) => <label key={mask} className="flex items-center gap-1 text-[11px]"><input type="checkbox" aria-label={`${text} on entry ${i}`} checked={!!(entry.state & mask)} onChange={(e) => update(i, { state: e.target.checked ? entry.state | mask : entry.state & ~mask })} />{text}</label>)}
    </>;
    if (section === "direction") return (i: number) => <>
      <label className="flex items-center gap-1 text-[11px]">Left–right <input type="range" aria-label={`Left to right on entry ${i}`} min={0} max={14} value={(entry.state >> 4) & 15} onChange={(e) => update(i, { state: (Number(e.target.value) << 4) | (entry.state & 15) })} className="w-20" /></label>
      <label className="flex items-center gap-1 text-[11px]">Down–up <input type="range" aria-label={`Down to up on entry ${i}`} min={0} max={14} value={entry.state & 15} onChange={(e) => update(i, { state: (entry.state & 0xF0) | Number(e.target.value) })} className="w-20" /></label>
    </>;
    return (i: number) => <select aria-label={`Trick on entry ${i}`} value={entry.state & 0x70} onChange={(e) => update(i, { state: Number(e.target.value) })} className="h-6 rounded border bg-background text-[11px]">
      {[[0, "None"], [0x10, "Up"], [0x20, "Down"], [0x30, "Left"], [0x40, "Right"]].map(([value, text]) => <option key={value} value={value}>{text}</option>)}
    </select>;
  };
  return <div className="flex min-h-0 flex-col gap-1.5">
    <div className="flex flex-wrap items-center gap-1">
      {([["face", "Buttons"], ["direction", "Stick"], ["tricks", "Tricks"]] as const).map(([id, text]) =>
        <Button key={id} size="sm" variant={section === id ? "secondary" : "ghost"} className="h-7 px-2 text-xs" aria-pressed={section === id} onClick={() => { setSection(id); setPage(0); }}>{text} ({inputs[id].length})</Button>)}
      <span className="ml-auto text-[11px] text-muted-foreground">{inputFrames(list)} frames</span>
      <Button size="icon-sm" variant="ghost" disabled={current <= 0} aria-label="Previous entries" onClick={() => setPage(current - 1)}>‹</Button>
      <span className="text-[11px] tabular-nums text-muted-foreground">{current + 1}/{pages}</span>
      <Button size="icon-sm" variant="ghost" disabled={current >= pages - 1} aria-label="Next entries" onClick={() => setPage(current + 1)}>›</Button>
    </div>
    {(frames[0] !== frames[1] || frames[1] !== frames[2]) && <p className="text-[11px] text-amber-400">Buttons, stick and tricks last different times ({frames.join(", ")} frames). Keep them equal, or the ghost's inputs end early.</p>}
    <div className="min-h-0 overflow-y-auto border">
      {list.slice(current * PAGE, (current + 1) * PAGE).map((entry: any, offset: number) => {
        const index = current * PAGE + offset;
        return <div key={index} className="flex h-8 items-center gap-2 border-b px-2 last:border-b-0">
          <span className="w-10 shrink-0 text-[11px] tabular-nums text-muted-foreground">{index}</span>
          {row(entry)(index)}
          <span className="ml-auto text-[11px] text-muted-foreground">frames</span>
          <Num label={`Frames of entry ${index}`} value={entry.frames} min={0} max={maxFrames} onChange={(value) => update(index, { frames: value })} />
          <Button size="icon-sm" variant="ghost" aria-label={`Add after entry ${index}`} title="Add an entry after this one" onClick={() => insert(index)}><Plus /></Button>
          <Button size="icon-sm" variant="ghost" aria-label={`Remove entry ${index}`} title="Remove this entry" onClick={() => remove(index)}><Trash2 /></Button>
        </div>;
      })}
      {!list.length && <div className="p-2 text-xs text-muted-foreground">No entries.</div>}
    </div>
  </div>;
}

export function GhostDialog({ close, initial }: { close: (value: any) => void; initial?: { path: string; label: string } }) {
  const [tab, setTab] = React.useState<"edit" | "inputs" | "compare">("edit");
  const [sources, setSources] = React.useState<any>({ game: [], saves: [], recorded: [] });
  const [source, setSource] = React.useState<Source | null>(null);
  const [ghost, setGhost] = React.useState<any>(null);
  const [dirty, setDirty] = React.useState(false);
  const [compress, setCompress] = React.useState(true);

  const loadSources = async () => {
    try { setSources(await api.ghostSources()); } catch (e: any) { toast.error("Could not list the ghosts", { description: e.message }); }
  };
  React.useEffect(() => {
    void loadSources();
    if (initial) void api.readPath(initial.path).then((file: any) => openBytes(file.data, { kind: "file", label: initial.label, path: initial.path })).catch((e: any) => toast.error("Could not read the ghost", { description: e.message }));
  }, []);

  const confirmLeave = async () => !dirty || dialogs.confirm({ title: "Discard the changes?", description: "This ghost has changes that have not been saved.", confirmLabel: "Discard", destructive: true });
  const openBytes = (data: Uint8Array, next: Source) => {
    try {
      const parsed = parseRKG(data);
      setGhost(parsed); setSource(next); setDirty(false); setCompress(true);
      setTab("edit");
      if (!parsed.crcValid) toast.warning("This ghost's checksum is wrong", { description: "Saving it writes a correct one." });
    } catch (e: any) { toast.error("Could not read the ghost", { description: e.message }); }
  };
  // Recording opens over this window; what it recorded is in the list on return, and its pencil
  // brings a ghost here.
  const record = async () => {
    const chosen = await dialogs.open<any>("ghostRecord", { fromEditor: true });
    await loadSources();
    if (chosen?.path) void openPath(chosen.path, chosen.label, "file");
  };
  const openFile = async () => {
    if (!await confirmLeave()) return;
    const file = await api.openFile(RKG_FILTER, "Open a ghost file");
    if (file) openBytes(file.data, { kind: "file", label: file.name, path: file.path });
  };
  const openPath = async (path: string, label: string, kind: Source["kind"]) => {
    if (!await confirmLeave()) return;
    try { openBytes((await api.readPath(path)).data, { kind, label, path }); }
    catch (e: any) { toast.error("Could not read the ghost", { description: e.message }); }
  };
  const openSave = async (path: string, key: string, label: string) => {
    if (!await confirmLeave()) return;
    try { openBytes(await api.ghostSaveFile(path, key), { kind: "save", label, save: path, key }); }
    catch (e: any) { toast.error("Could not read the ghost", { description: e.message }); }
  };
  const edit = (patch: any) => { setGhost((current: any) => ({ ...current, ...patch })); setDirty(true); };
  const bytes = () => buildRKG(ghost, { compressed: compress });
  const save = async (path: string) => {
    await api.writeFile(path, bytes(), { backup: editor.settings.keepBackups !== false });
    setDirty(false);
    void loadSources();
    toast.success("Ghost saved", { description: path });
  };
  const saveHere = async () => {
    try { if (source?.path) await save(source.path); }
    catch (e: any) { toast.error("Could not save the ghost", { description: e.message }); }
  };
  const saveAs = async () => {
    try {
      const path = await api.chooseSavePath("ghost.rkg", RKG_FILTER, "Save the ghost as");
      if (!path) return;
      await save(path);
      setSource({ kind: "file", label: path.split(/[\\/]/).pop() || path, path });
    } catch (e: any) { toast.error("Could not save the ghost", { description: e.message }); }
  };
  const leave = async () => { if (await confirmLeave()) close(true); };
  const options = (list: string[]) => list.map((text, id) => [id, text] as [number, string]);
  const characters = Array.from({ length: 48 }, (_, id) => [id, characterName(id)] as [number, string]);
  const tabButton = (id: typeof tab, text: string) => <Button size="sm" variant={tab === id ? "secondary" : "ghost"} className="h-8 px-3 text-xs" aria-pressed={tab === id} onClick={() => setTab(id)}>{text}</Button>;
  const inputSeconds = ghost ? inputFrames(ghost.inputs.face) / FRAMES_PER_SECOND : 0;

  return <div className="flex h-full min-h-0 flex-col gap-3">
    <div className="flex shrink-0 items-start gap-2">
      <div className="min-w-0 flex-1">
        <DialogTitle className="text-sm">Ghost editor</DialogTitle>
        <DialogDescription className="text-xs">Change the details and inputs of ghost files (.rkg).</DialogDescription>
      </div>
      <Button size="icon-sm" variant="ghost" title="Close" aria-label="Close ghost editor" onClick={leave}><X /></Button>
    </div>
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-[260px_minmax(0,1fr)]">
      <div className="flex min-h-0 flex-col gap-1.5">
        <Button size="sm" variant="secondary" onClick={openFile}><FileUp /> Open .rkg…</Button>
        <Button size="sm" variant="secondary" title="Drive a Time Trial in Dolphin and keep each ghost the game saves" onClick={record}><Video /> Record a ghost…</Button>
        <div className="min-h-0 flex-1 overflow-y-auto border">
          {sources.recorded?.length > 0 && <div className="sticky top-0 border-b bg-background px-2 py-1 text-[11px] font-semibold">Recorded</div>}
          {sources.recorded?.map((item: any) => <GhostEntry key={item.path} open={sourceId(source) === sourceId({ path: item.path })} onClick={() => openPath(item.path, item.name, "file")}
            title={nameOf(COURSE_NAMES, item.track, "Track")} detail={`${item.time} · ${item.name}`} />)}
          {sources.saves.map((save: any) => <div key={save.path}>
            <div className="sticky top-0 border-b bg-background px-2 py-1 text-[11px] font-semibold">Dolphin save ({save.region})</div>
            {save.ghosts.map((item: any) => <GhostEntry key={item.key} open={sourceId(source) === sourceId({ save: save.path, key: item.key })} onClick={() => openSave(save.path, item.key, `${save.region} save, license ${item.license + 1}`)}
              title={nameOf(COURSE_NAMES, item.track, "Track")} detail={`${item.time} · license ${item.license + 1}${item.kind === "downloaded" ? " · downloaded" : ""}`} />)}
          </div>)}
          {sources.game.length > 0 && <div className="sticky top-0 border-b bg-background px-2 py-1 text-[11px] font-semibold">Staff ghosts of the game</div>}
          {sources.game.map((item: any) => <GhostEntry key={item.path} open={sourceId(source) === sourceId({ path: item.path })} onClick={() => openPath(item.path, item.name, "game")}
            title={nameOf(COURSE_NAMES, item.track, "Track")} detail={`${item.time} · ${item.folder}/${item.name}`} />)}
          {!sources.game.length && !sources.saves.length && !sources.recorded?.length && <p className="p-2 text-[11px] text-muted-foreground">No ghosts found. Choose the game folder in the settings, or open a file.</p>}
        </div>
      </div>
      <div className="flex min-h-0 flex-col gap-2">
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          {tabButton("edit", "Details")}
          {tabButton("inputs", "Inputs")}
          {tabButton("compare", "Compare")}
          {source && <span className="ml-auto truncate text-[11px] text-muted-foreground">{source.label}{dirty ? " · not saved" : ""}</span>}
        </div>
        {!ghost ? <p className="text-xs text-muted-foreground">Choose a ghost on the left, or open a file.</p>
          : tab === "edit" ? <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
            <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 lg:grid-cols-2">
              <TimeField label="Finish time" value={ghost.time} onChange={(time) => edit({ time })} />
              <Pick label="Track" value={ghost.track} options={options(COURSE_NAMES)} onChange={(track) => edit({ track })} />
              <Pick label="Character" value={ghost.character} options={characters} onChange={(character) => edit({ character })} />
              <Pick label="Vehicle" value={ghost.vehicle} options={options(VEHICLES)} onChange={(vehicle) => edit({ vehicle })} />
              <Pick label="Controller" value={ghost.controller} options={options(CONTROLLERS)} onChange={(controller) => edit({ controller })} />
              <Pick label="Drift" value={ghost.automatic ? 1 : 0} options={[[0, "Manual"], [1, "Automatic"]]} onChange={(value) => edit({ automatic: !!value })} />
              <div className="flex items-center gap-1 text-xs">
                <span className="w-24 shrink-0 text-muted-foreground">Date</span>
                <Num label="Day" value={ghost.day} min={1} max={31} width="w-12" onChange={(day) => edit({ day })} /> /
                <Num label="Month" value={ghost.month} min={1} max={12} width="w-12" onChange={(month) => edit({ month })} /> /
                <Num label="Year" value={ghost.year} min={2000} max={2127} onChange={(year) => edit({ year })} />
              </div>
              <div className="flex items-center gap-1 text-xs">
                <span className="w-24 shrink-0 text-muted-foreground">Laps · type</span>
                <Num label="Laps" value={ghost.laps} min={1} max={9} width="w-12" onChange={(laps) => edit({ laps })} /> ·
                <Num label="Ghost type" value={ghost.ghostType} min={0} max={127} width="w-12" onChange={(ghostType) => edit({ ghostType })} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="text-xs font-semibold">Lap times</div>
              {ghost.splits.slice(0, Math.min(5, ghost.laps)).map((split: any, i: number) => <TimeField key={i} label={`Lap ${i + 1}`} value={split} onChange={(next) => edit({ splits: ghost.splits.map((old: any, k: number) => k === i ? next : old) })} />)}
            </div>
            <GhostPreview key={source?.label} ghost={ghost} />
            <p className="text-[11px] text-muted-foreground">Driver {ghost.miiName || "unnamed"} · {timeText(ghost.time)} shown · inputs last {inputSeconds.toFixed(1)} s. These details are only what the file says: the ghost drives from its inputs, so a different time does not make it faster, and a different vehicle can send it off the road. The same goes for a changed track.</p>
          </div>
          : tab === "compare" ? <GhostCompare key={source?.label} ghost={ghost} label={source?.label || "This ghost"} sources={sources} />
          : <InputTable inputs={ghost.inputs} onChange={(inputs) => edit({ inputs })} />}
      </div>
    </div>
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
      {ghost && <label className="mr-auto flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground" title="Compressed is how the game's own staff ghosts are stored">
        <input type="checkbox" checked={compress} onChange={(e) => { setCompress(e.target.checked); setDirty(true); }} aria-label="Compress the ghost" /> Compressed file
      </label>}
      <Button variant="ghost" onClick={leave}>Close</Button>
      <Button variant="secondary" disabled={!ghost} onClick={saveAs}>Save as…</Button>
      <Button disabled={!ghost || !source?.path || !dirty} onClick={saveHere}><Save /> Save</Button>
    </div>
  </div>;
}
