// Sounds and music: the game's music streams (sound/strm/*.brstm) and the sound effects and voices
// of sound/revo_kart.brsar. Listen, export (WAV, FLAC, Ogg Opus, BRSTM) and replace them with any
// audio file; replacements are kept until Save, which writes the game files (optionally with a .bak copy).

import * as React from "react";
import { Check, ChevronRight, Download, FileAudio, LoaderCircle, LocateFixed, Play, Repeat, RotateCcw, Save, Search, Square, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api, FILTERS } from "../../../js/api.js";
import { buildBRSTM, decodeBRSTM, parseBRSTM, setBRSTMLoop } from "../../../js/formats/brstm.js";
import { listWaves, parseBRSAR, readWave, replaceWave } from "../../../js/formats/brsar.js";
import { encodeFLAC, encodeWAV, isolateTrack, musicLabel, toFloat32, toInt16 } from "../../../js/editor/audio.js";
import { encodeOggOpus } from "../../../js/editor/ogg-opus.js";
import { editor, winPath } from "../editor";
import { dialogs } from "../dialogs-store";
import { WorkspaceCard } from "../panels/WorkspaceCard";
import { useEditor } from "../hooks";
import { cn } from "@/lib/utils";

const LIST_LIMIT = 400;
type Tab = "music" | "sounds";
interface Item { key: string; label: string; detail: string; kind: "music" | "wave"; path?: string; wave?: any }
// Decoded audio: Int16 channels, rate, loop and (music) the stereo tracks.
interface Clip { sampleRate: number; channels: Int16Array[]; loop: boolean; loopStart: number; tracks?: { volume: number; pan: number; channels: number[] }[]; trackType?: number }

let context: AudioContext | null = null;
const audioContext = () => (context ||= new AudioContext());

// Two channels to listen to: each track's pair at its volume, summed.
function stereo(clip: Clip, trackIndex: number | null = null) {
  const n = clip.channels[0].length;
  const left = new Float32Array(n), right = new Float32Array(n);
  const tracks = trackIndex !== null ? [clip.tracks![trackIndex]] : clip.tracks?.length ? clip.tracks : [{ volume: 127, pan: 64, channels: clip.channels.map((_, i) => i) }];
  const gain = 1 / Math.max(1, tracks.length) ** 0.5;
  for (const t of tracks) {
    const l = clip.channels[t.channels[0]], r = clip.channels[t.channels[1] ?? t.channels[0]];
    const g = (t.volume / 127) * gain / 32768;
    for (let i = 0; i < n; i++) { left[i] += l[i] * g; right[i] += r[i] * g; }
  }
  return [left, right];
}

function drawWaveform(canvas: HTMLCanvasElement, samples: Float32Array, loopAt?: number) {
  const g = canvas.getContext("2d");
  if (!g) return;
  const dpr = devicePixelRatio || 1;
  const w = canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
  g.clearRect(0, 0, w, h);
  g.fillStyle = "rgba(255,255,255,0.75)";
  let peak = 1e-6;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  const k = 0.95 / peak;
  for (let x = 0; x < w; x++) {
    let sum = 0;
    const from = Math.floor(x * samples.length / w), to = Math.floor((x + 1) * samples.length / w);
    for (let i = from; i < to; i++) sum += samples[i] * samples[i];
    const half = Math.sqrt(sum / Math.max(1, to - from)) * k * h / 2;
    g.fillRect(x, h / 2 - half, 1, Math.max(1, half * 2));
  }
  if (loopAt !== undefined) {
    g.fillStyle = "rgba(96,165,250,0.9)";
    g.fillRect(Math.round(loopAt / samples.length * w), 0, Math.max(1, dpr), h);
  }
}

function TrackWaveform({ clip, index, elapsed, active, onPlay }: { clip: Clip; index: number; elapsed: number; active: boolean; onPlay: (at: number) => void }) {
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const duration = clip.channels[0].length / clip.sampleRate;
  React.useEffect(() => {
    if (canvas.current) drawWaveform(canvas.current, stereo(clip, index)[0], clip.loop ? clip.loopStart : undefined);
  }, [clip, index]);
  return (
    <button type="button" className="relative block h-9 w-full cursor-pointer overflow-hidden rounded-sm bg-black/40 text-left" title={`Play track ${index + 1} from position`} aria-label={`Seek and play track ${index + 1}`}
      onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); onPlay((event.clientX - rect.left) / rect.width * duration); }}>
      <canvas ref={canvas} className="h-full w-full" aria-hidden="true" />
      {active && <span className="pointer-events-none absolute inset-y-0 w-px bg-primary" style={{ left: `${Math.min(100, elapsed / duration * 100)}%` }} />}
    </button>
  );
}

async function resample(channels: Float32Array[], from: number, to: number) {
  if (from === to) return channels;
  const length = Math.max(1, Math.round(channels[0].length * to / from));
  const offline = new OfflineAudioContext(channels.length, length, to);
  const buffer = offline.createBuffer(channels.length, channels[0].length, from);
  channels.forEach((c, i) => buffer.copyToChannel(c as Float32Array<ArrayBuffer>, i));
  const source = offline.createBufferSource();
  source.buffer = buffer; source.connect(offline.destination); source.start();
  const out = await offline.startRendering();
  return Array.from({ length: out.numberOfChannels }, (_, i) => out.getChannelData(i).slice());
}

// Any audio file the browser can decode (WAV, MP3, Ogg, FLAC, AAC…) or a BRSTM.
async function decodeFile(name: string, data: Uint8Array): Promise<{ rate: number; channels: Float32Array[] }> {
  if (/\.brstm$/i.test(name)) {
    const s = parseBRSTM(data);
    return { rate: s.sampleRate, channels: decodeBRSTM(s).map(toFloat32) };
  }
  const buffer = await audioContext().decodeAudioData(data.slice().buffer);
  return { rate: buffer.sampleRate, channels: Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i).slice()) };
}

const seconds = (n: number, rate: number) => `${(n / rate).toFixed(n / rate < 10 ? 2 : 1)} s`;
const timestamp = (value: number) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;

// `file`: a .brstm or .brsar opened on its own (File › Open, Explorer) instead of the workspace's.
export function AudioDialog({ file, close }: { file?: string; close: (v: any) => void }) {
  useEditor("settings");
  const looseMusic = file && /\.brstm$/i.test(file) ? file : "", looseArchive = file && /\.brsar$/i.test(file) ? file : "";
  const root = editor.workspace() || (file ? "loose" : "");
  const strm = looseArchive ? "" : editor.workspacePath("sound", "strm"), brsarPath = looseArchive || (looseMusic ? "" : editor.workspacePath("sound", "revo_kart.brsar"));
  const [tab, setTab] = React.useState<Tab>(looseArchive ? "sounds" : "music");
  const [music, setMusic] = React.useState<string[] | null>(null);
  const [archive, setArchive] = React.useState<any>(null);
  const [waves, setWaves] = React.useState<any[] | null>(null);
  const [loading, setLoading] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [selected, setSelected] = React.useState<string | null>(null);
  // Audio and loop edits not saved yet: music files by path, and the changed sound archive.
  const [pendingMusic, setPendingMusic] = React.useState<Record<string, Uint8Array>>({});
  const [changedWaves, setChangedWaves] = React.useState<Set<string>>(new Set());
  const [archiveChanged, setArchiveChanged] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (looseMusic) { setMusic([looseMusic]); setSelected(`m:${looseMusic}`); return; }
    if (!strm) return;
    api.listDir(strm, ["brstm"]).then(setMusic).catch(() => setMusic([]));
  }, [strm]);

  React.useEffect(() => {
    if (tab !== "sounds" || archive || !brsarPath) return;
    setLoading("Reading revo_kart.brsar…");
    api.readPath(brsarPath).then(async (f: any) => {
      const a = parseBRSAR(await api.decodeArchiveBytes(f.data, f.path));
      setArchive(a); setWaves(listWaves(a));
    }).catch((e: any) => toast.error("Could not read the sound archive", { description: e.message })).finally(() => setLoading(""));
  }, [tab, archive, brsarPath]);

  const items: Item[] = React.useMemo(() => tab === "music"
    ? (music || []).map((f) => looseMusic ? { key: `m:${f}`, label: f.split(/[\\/]/).pop()!, detail: f, kind: "music" as const, path: f }
      : { key: `m:${f}`, label: musicLabel(f), detail: f, kind: "music" as const, path: winPath(strm, f) })
    : (waves || []).map((w) => ({ key: w.key, label: w.name, detail: `${w.kind} · ${w.group || "no group"}`, kind: "wave" as const, wave: w })),
  [tab, music, waves, strm]);
  const q = query.trim().toLowerCase();
  const filtered = q ? items.filter((i) => i.label.toLowerCase().includes(q) || i.detail.toLowerCase().includes(q)) : items;
  const current = items.find((i) => i.key === selected) || null;
  const pendingCount = Object.keys(pendingMusic).length + changedWaves.size;

  const save = async () => {
    setSaving(true);
    try {
      for (const [path, bytes] of Object.entries(pendingMusic)) {
        await api.writeFile(path, bytes, { backup: editor.settings.keepBackups, edited: true });
        setPendingMusic((current) => { const next = { ...current }; if (next[path] === bytes) delete next[path]; return next; });
      }
      if (archiveChanged && archive) {
        setLoading("Saving revo_kart.brsar…");
        await api.writeFile(brsarPath, archive.data, { backup: editor.settings.keepBackups, edited: true });
        setChangedWaves(new Set()); setArchiveChanged(false);
      }
      toast.success(`${pendingCount} sound${pendingCount === 1 ? "" : "s"} saved`, { description: editor.settings.keepBackups ? "The first save keeps a .bak copy of each original file." : "Backups are off in Settings." });
    } catch (e: any) { toast.error("Could not save", { description: e.message }); }
    setLoading(""); setSaving(false);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <DialogTitle className="text-sm">Sounds and music</DialogTitle>
          {file ? <DialogDescription className="m-0 truncate text-xs" title={file}>{file}. Save writes this file.</DialogDescription>
            : <DialogDescription className="m-0 text-xs">Music streams (sound\strm) and sound effects and voices (sound\revo_kart.brsar) of the workspace.</DialogDescription>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button size="icon" variant="ghost" title="Close" aria-label="Close" disabled={saving} onClick={async () => {
            if (pendingCount && !(await dialogs.confirm({ title: "Unsaved sounds", description: `${pendingCount} unsaved sound change${pendingCount === 1 ? "" : "s"} will be lost.`, confirmLabel: "Close without saving", destructive: true }))) return;
            context?.suspend();
            close(null);
          }}><X /></Button>
        </div>
      </div>
      {!root ? <WorkspaceCard /> : (
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <div role="tablist" className={cn("flex max-w-full rounded-md border bg-muted/30 p-0.5", file && "hidden")}>
              {([["music", "Music"], ["sounds", "Sound effects and voices"]] as const).map(([id, label]) => (
                <button key={id} role="tab" aria-selected={tab === id} onClick={() => { setTab(id); setSelected(null); }}
                  className={cn("cursor-pointer rounded px-2 py-1 text-xs sm:px-3", tab === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>{label}</button>
              ))}
            </div>
            <div className="relative min-w-0 flex-1 basis-48">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder={tab === "music" ? "Find music (course name, file)" : "Find a sound (SE_, VO_MR, group…)"} className="h-8 pl-7 text-xs" />
            </div>
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-[minmax(0,260px)_minmax(0,1fr)] lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
            <div className="flex min-h-0 max-h-48 flex-col rounded-md border sm:max-h-none">
              <div className="shrink-0 border-b px-2.5 py-1.5 text-[11px] text-muted-foreground">
                {loading || `${filtered.length.toLocaleString()} ${tab === "music" ? "streams" : "sounds"}${filtered.length > LIST_LIMIT ? ` · first ${LIST_LIMIT} shown, refine the search` : ""}`}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-1">
                {filtered.slice(0, LIST_LIMIT).map((i) => (
                  <button key={i.key} onClick={() => setSelected(i.key)} className={cn("flex w-full cursor-pointer flex-col items-start rounded px-2 py-1.5 text-left hover:bg-accent/60", i.key === selected && "bg-accent")}>
                    <span className="flex w-full items-center gap-1.5 text-[12.5px]">
                      <span className="min-w-0 flex-1 truncate">{i.label}</span>
                      {(pendingMusic[i.path || ""] || changedWaves.has(i.key)) && <span className="size-1.5 shrink-0 rounded-full bg-primary" title="Unsaved changes" />}
                    </span>
                    <span className="w-full truncate text-[10.5px] text-muted-foreground">{i.detail}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="min-h-0 overflow-y-auto">
              {current ? (
                <SoundPanel key={current.key + (pendingMusic[current.path || ""] ? ":p" : "") + (changedWaves.has(current.key) ? ":c" : "")} item={current} archive={archive}
                  pending={current.path ? pendingMusic[current.path] : undefined} brsarPath={brsarPath}
                  onReplaceMusic={(bytes) => setPendingMusic((p) => { const next = { ...p }; if (bytes) next[current.path!] = bytes; else delete next[current.path!]; return next; })}
                  onReplaceWave={(next) => { setArchive(next); setArchiveChanged(true); setChangedWaves((s) => new Set(s).add(current.key)); }} />
              ) : <div className="grid h-full place-items-center text-xs text-muted-foreground">{loading ? <LoaderCircle className="size-5 animate-spin" /> : "Choose a sound on the left."}</div>}
            </div>
          </div>
        </>
      )}
      <div className="flex shrink-0 justify-end border-t pt-2">
        <Button size="sm" disabled={!pendingCount || saving} onClick={save}>{saving ? <LoaderCircle className="animate-spin" /> : <Save />} Save {pendingCount || ""}</Button>
      </div>
    </div>
  );
}

function SoundPanel({ item, archive, pending, brsarPath, onReplaceMusic, onReplaceWave }: {
  item: Item; archive: any; pending?: Uint8Array; brsarPath: string;
  onReplaceMusic: (bytes: Uint8Array | null) => void; onReplaceWave: (archive: any) => void;
}) {
  const [clip, setClip] = React.useState<Clip | null>(null);
  const [error, setError] = React.useState("");
  const [playing, setPlaying] = React.useState(false);
  const [playingTrack, setPlayingTrack] = React.useState<number | null>(null);
  const [elapsed, setElapsed] = React.useState(0);
  const [separateTracks, setSeparateTracks] = React.useState(false);
  const [loopPreview, setLoopPreview] = React.useState(true);
  const [loopEnabled, setLoopEnabled] = React.useState(false);
  const [loopStartText, setLoopStartText] = React.useState("0");
  const [busy, setBusy] = React.useState("");
  const [hasBackup, setHasBackup] = React.useState(false);
  const source = React.useRef<AudioBufferSourceNode | null>(null);
  const playback = React.useRef<{ start: number; offset: number } | null>(null);
  const ticker = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const generation = React.useRef(0);
  const buffers = React.useRef(new Map<number, AudioBuffer>());
  const scrubbing = React.useRef(false);
  const wave = React.useRef<HTMLCanvasElement>(null);

  // Decode the sound (the replacement when there is one).
  React.useEffect(() => {
    let cancelled = false;
    setClip(null); setError("");
    setElapsed(0); buffers.current.clear();
    (async () => {
      if (item.kind === "music") {
        const data = pending || await api.decodeArchiveBytes((await api.readPath(item.path!)).data, item.path!);
        const s = parseBRSTM(data);
        const c = { sampleRate: s.sampleRate, channels: decodeBRSTM(s), loop: s.loop, loopStart: s.loopStart, tracks: s.tracks, trackType: s.trackType };
        if (!cancelled) { setClip(c); setLoopEnabled(c.loop); setLoopStartText(String(c.loopStart / c.sampleRate)); }
        setHasBackup(await api.exists(item.path + ".bak"));
      } else {
        const c = readWave(archive, item.wave);
        if (!cancelled) { setClip(c); setLoopEnabled(c.loop); setLoopStartText(String(c.loopStart / c.sampleRate)); }
        setHasBackup(await api.exists(brsarPath + ".bak"));
      }
    })().catch((e) => !cancelled && setError(e.message));
    return () => { cancelled = true; stop(); };
  }, [item.key, pending, archive]);

  // RMS envelope of the stereo mix, scaled to the clip's loudest sample.
  React.useEffect(() => {
    if (wave.current && clip) drawWaveform(wave.current, stereo(clip)[0], clip.loop ? clip.loopStart : undefined);
  }, [clip]);

  const stop = () => {
    generation.current++;
    try { source.current?.stop(); } catch { /* not started */ }
    source.current = null; playback.current = null;
    if (ticker.current) clearInterval(ticker.current);
    ticker.current = null;
    setPlaying(false); setPlayingTrack(null);
  };
  const play = async (trackIndex: number | null = null, from = elapsed) => {
    if (!clip) return;
    stop();
    const run = generation.current;
    const ctx = audioContext();
    await ctx.resume();
    if (run !== generation.current) return;
    const duration = clip.channels[0].length / clip.sampleRate;
    const offset = from >= duration ? 0 : Math.max(0, from);
    const key = trackIndex ?? -1;
    let buffer = buffers.current.get(key);
    if (!buffer) {
      const [l, r] = stereo(clip, trackIndex);
      buffer = ctx.createBuffer(2, l.length, clip.sampleRate);
      buffer.copyToChannel(l, 0); buffer.copyToChannel(r, 1);
      buffers.current.set(key, buffer);
    }
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    if (clip.loop && loopPreview) { node.loop = true; node.loopStart = clip.loopStart / clip.sampleRate; node.loopEnd = duration; }
    node.connect(ctx.destination);
    node.onended = () => { if (source.current === node) { stop(); setElapsed(duration); } };
    node.start(0, offset);
    source.current = node;
    playback.current = { start: ctx.currentTime, offset };
    setElapsed(offset);
    ticker.current = setInterval(() => {
      if (!playback.current || scrubbing.current) return;
      const raw = playback.current.offset + ctx.currentTime - playback.current.start;
      const loopStart = clip.loopStart / clip.sampleRate;
      const position = node.loop && raw >= duration && loopStart < duration
        ? loopStart + (raw - duration) % (duration - loopStart)
        : Math.min(raw, duration);
      setElapsed(position);
    }, 50);
    setPlaying(true);
    setPlayingTrack(trackIndex);
  };
  const seek = (position: number) => {
    if (!clip) return;
    const duration = clip.channels[0].length / clip.sampleRate;
    const next = Math.max(0, Math.min(duration, position));
    scrubbing.current = false;
    setElapsed(next);
    if (playing) {
      if (next >= duration && !loopPreview) stop();
      else void play(playingTrack, next);
    }
  };

  const loopStartSample = clip ? Math.round(Number(loopStartText) * clip.sampleRate) : 0;
  const loopChanged = !!clip && (loopEnabled !== clip.loop || loopStartSample !== clip.loopStart);
  const applyLoop = async () => {
    if (!clip || item.kind !== "music") return;
    if (!Number.isFinite(Number(loopStartText)) || loopStartSample < 0 || loopStartSample >= clip.channels[0].length) {
      toast.error("Loop start must be inside the music stream");
      return;
    }
    setBusy("Updating loop…");
    try {
      const bytes = pending || await api.decodeArchiveBytes((await api.readPath(item.path!)).data, item.path!);
      onReplaceMusic(setBRSTMLoop(bytes, loopEnabled, loopStartSample));
      toast.success("Loop updated", { description: "Save to write the BRSTM file." });
    } catch (e: any) { toast.error("Could not update the loop", { description: e.message }); }
    finally { setBusy(""); }
  };

  const baseName = item.kind === "music" ? item.detail.replace(/\.brstm$/i, "") : item.label;
  const exportAs = async (format: "wav" | "flac" | "ogg" | "brstm", trackIndex: number | null = null) => {
    if (!clip) return;
    setBusy(`Encoding ${format.toUpperCase()}…`);
    try {
      let bytes: Uint8Array;
      if (format === "brstm") {
        if (trackIndex === null && item.kind === "music" && !pending) bytes = await api.decodeArchiveBytes((await api.readPath(item.path!)).data, item.path!);
        else {
          const part = trackIndex === null ? clip : isolateTrack(clip, trackIndex);
          bytes = trackIndex === null && pending ? pending : buildBRSTM({ channels: part.channels, sampleRate: part.sampleRate, loop: part.loop, loopStart: part.loopStart, tracks: part.tracks, trackType: part.trackType });
        }
      }
      else {
        const pair = trackIndex !== null || clip.channels.length > 2 ? stereo(clip, trackIndex).map(toInt16) : clip.channels;
        if (format === "wav") bytes = encodeWAV(pair, clip.sampleRate);
        else if (format === "flac") bytes = encodeFLAC(pair, clip.sampleRate);
        else bytes = await encodeOggOpus(await resample(pair.map(toFloat32), clip.sampleRate, 48000), { inputRate: clip.sampleRate });
      }
      const filters = { wav: FILTERS.wav, flac: FILTERS.flac, ogg: FILTERS.ogg, brstm: FILTERS.brstm }[format];
      const name = `${baseName}${trackIndex === null ? "" : `_track_${trackIndex + 1}`}`;
      await editor.exportBytes(`${name}.${format}`, filters, bytes, `Export ${name}`);
    } catch (e: any) { toast.error("Could not export", { description: e.message }); }
    setBusy("");
  };

  const replace = async () => {
    if (!clip) return;
    const f = await api.openFile(FILTERS.audio, `Replace ${item.label}`);
    if (!f) return;
    const isMusic = item.kind === "music";
    const options: any = await dialogs.form({
      title: `Replace ${item.label}`,
      description: isMusic
        ? `The new music is converted to the game's format (DSP-ADPCM, ${clip.sampleRate} Hz, ${clip.channels.length} channels). Music loops back to the loop start when it ends.`
        : `The new sound is converted to the game's format (DSP-ADPCM, ${clip.sampleRate} Hz). It may be longer or shorter than the original.`,
      fields: [
        { key: "loop", label: "Loop", type: "switch", value: clip.loop },
        ...(isMusic ? [{ key: "loopStart", label: "Loop start (seconds)", type: "number" as const, value: clip.loopStart / clip.sampleRate, min: 0, hint: "Where the music starts again after its end. 0 loops the whole track." }] : []),
        { key: "volume", label: "Volume (%)", type: "number", value: 100, min: 10, max: 400, step: 5 },
      ],
      confirmLabel: "Replace",
    });
    if (!options) return;
    setBusy("Converting…");
    try {
      const decoded = await decodeFile(f.name, f.data);
      if (!decoded.channels.length || !decoded.channels[0].length) throw new Error("The audio file is empty");
      const gain = Number(options.volume) / 100;
      const at = await resample(decoded.channels.map((c) => (gain === 1 ? c : c.map((v) => v * gain))), decoded.rate, clip.sampleRate);
      const pcm = at.map(toInt16);
      if (isMusic) {
        // Every stereo track gets the new left/right channels.
        const channels = clip.channels.map((_, c) => {
          const track = clip.tracks?.find((t) => t.channels.includes(c));
          const side = track ? track.channels.indexOf(c) : c;
          return pcm[Math.min(side, pcm.length - 1)];
        });
        const loopStart = Math.min(Math.max(0, Math.round(Number(options.loopStart || 0) * clip.sampleRate)), channels[0].length - 1);
        onReplaceMusic(buildBRSTM({ channels, sampleRate: clip.sampleRate, loop: !!options.loop, loopStart, tracks: clip.tracks, trackType: clip.trackType }));
      } else {
        onReplaceWave(parseBRSAR(replaceWave(archive, item.wave, pcm, { loop: !!options.loop, loopStart: 0 })));
      }
      toast.success(`${item.label} replaced`, { description: "Save to write it into the game files." });
    } catch (e: any) { toast.error("Could not use this audio file", { description: e.message }); }
    setBusy("");
  };

  const restore = async () => {
    setBusy("Restoring the original…");
    try {
      if (item.kind === "music") {
        if (pending) onReplaceMusic(null);
        else onReplaceMusic(await api.decodeArchiveBytes((await api.readPath(item.path + ".bak")).data, item.path + ".bak"));
      } else {
        const original = readWave(parseBRSAR(await api.decodeArchiveBytes((await api.readPath(brsarPath + ".bak")).data, brsarPath + ".bak")), item.wave);
        onReplaceWave(parseBRSAR(replaceWave(archive, item.wave, original.channels, { loop: original.loop, loopStart: original.loopStart })));
      }
    } catch (e: any) { toast.error("Could not restore the original", { description: e.message }); }
    setBusy("");
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-sm font-semibold">{item.label}</div>
        <div className="text-[11px] text-muted-foreground">{item.detail}</div>
      </div>
      {error ? <p className="m-0 text-xs text-destructive">{error}</p> : !clip ? <LoaderCircle className="size-5 animate-spin text-muted-foreground" /> : (
        <>
          <button type="button" className="relative block h-24 w-full cursor-pointer overflow-hidden rounded-md border bg-black/40 text-left" title="Seek in waveform" aria-label="Seek in waveform"
            onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); seek((event.clientX - rect.left) / rect.width * clip.channels[0].length / clip.sampleRate); }}>
            <canvas ref={wave} className="h-full w-full" aria-hidden="true" />
            <div className="pointer-events-none absolute inset-y-0 w-px bg-primary" style={{ left: `${Math.min(100, elapsed / (clip.channels[0].length / clip.sampleRate) * 100)}%` }} />
          </button>
          <div className="flex items-center gap-2 text-[11px] tabular-nums text-muted-foreground">
            <span className="w-10 text-right">{timestamp(elapsed)}</span>
            <input aria-label="Playback position" type="range" min="0" max={clip.channels[0].length / clip.sampleRate} step="0.01" value={elapsed}
              className="min-w-0 flex-1 cursor-pointer accent-primary" onPointerDown={() => { scrubbing.current = true; }}
              onChange={(e) => setElapsed(Number(e.currentTarget.value))}
              onPointerUp={(e) => seek(Number(e.currentTarget.value))}
              onPointerCancel={() => { scrubbing.current = false; }}
              onKeyUp={(e) => seek(Number(e.currentTarget.value))}
              onBlur={(e) => { if (scrubbing.current) seek(Number(e.currentTarget.value)); }} />
            <span className="w-10">{timestamp(clip.channels[0].length / clip.sampleRate)}</span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span>{seconds(clip.channels[0].length, clip.sampleRate)}</span>
            <span>{clip.sampleRate.toLocaleString()} Hz</span>
            <span>{clip.channels.length} channel{clip.channels.length === 1 ? "" : "s"}{clip.tracks && clip.tracks.length > 1 ? ` in ${clip.tracks.length} tracks` : ""}</span>
            <span>{clip.loop ? `Loops from ${seconds(clip.loopStart, clip.sampleRate)}` : "No loop"}</span>
            {pending && <span className="text-foreground">Modified (not saved)</span>}
          </div>
          {item.kind === "music" && <div className="flex flex-wrap items-end gap-2 border-y py-2 text-xs">
            <label className="flex h-8 cursor-pointer items-center gap-1.5 pr-2"><input type="checkbox" className="accent-primary" checked={loopEnabled} onChange={(e) => setLoopEnabled(e.target.checked)} /> Loop in file</label>
            <label className="flex items-center gap-1.5 text-muted-foreground">Start (s)
              <Input aria-label="Loop start in seconds" type="number" min="0" max={(clip.channels[0].length - 1) / clip.sampleRate} step="0.001" value={loopStartText} onChange={(e) => setLoopStartText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void applyLoop(); } }} className="h-8 w-24 text-xs tabular-nums" />
            </label>
            <Button size="icon-sm" variant="ghost" title="Set loop start to the playback position" aria-label="Set loop start to playhead" onClick={() => setLoopStartText(Math.min(elapsed, (clip.channels[0].length - 1) / clip.sampleRate).toFixed(6))}><LocateFixed /></Button>
            <span className="self-center text-[11px] text-muted-foreground">End: {seconds(clip.channels[0].length, clip.sampleRate)}</span>
            <Button size="sm" variant="secondary" disabled={!loopChanged || !!busy} onClick={applyLoop}><Check /> Apply loop</Button>
          </div>}
          <div className="flex flex-wrap items-center gap-1.5">
            {playing && playingTrack === null ? <Button size="sm" onClick={stop}><Square /> Stop</Button> : <Button size="sm" onClick={() => play()}><Play /> Play mix</Button>}
            {clip.loop && (
              <label className="flex cursor-pointer items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
                <input type="checkbox" className="accent-primary" checked={loopPreview} onChange={(e) => setLoopPreview(e.target.checked)} /><Repeat className="size-3.5" /> Preview loop
              </label>
            )}
            <Button size="sm" variant="secondary" disabled={!!busy || (item.kind === "wave" && !archive)} onClick={replace}><FileAudio /> Replace…</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button size="sm" variant="secondary" disabled={!!busy}><Download /> Export</Button></DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => exportAs("wav")}>WAV (uncompressed)</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportAs("flac")}>FLAC (lossless)</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportAs("ogg")}>Ogg Opus (small)</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportAs("brstm")}>BRSTM (game format)</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {pending && <Button size="sm" variant="ghost" onClick={() => onReplaceMusic(null)}><Undo2 /> Undo changes</Button>}
            {hasBackup && !pending && <Button size="sm" variant="ghost" disabled={!!busy} onClick={restore}><RotateCcw /> Restore original</Button>}
            {busy && <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" /> {busy}</span>}
          </div>
          {item.kind === "music" && (clip.tracks?.length || 0) > 1 && (
            <div className="border-t pt-3">
              <button type="button" className="flex w-fit cursor-pointer items-center gap-2 text-xs font-medium hover:text-primary" aria-expanded={separateTracks} aria-controls={separateTracks ? "separate-audio-tracks" : undefined} onClick={() => { stop(); setSeparateTracks((open) => !open); }}>
                <ChevronRight className={cn("size-4 transition-transform", separateTracks && "rotate-90")} aria-hidden="true" />
                Separate tracks
              </button>
              {separateTracks && (
                <div id="separate-audio-tracks" className="mt-2 space-y-1">
                  {clip.tracks!.map((track, index) => (
                    <div key={index} className="flex min-h-10 flex-wrap items-center gap-1.5 rounded border px-2 py-1">
                      <div className="min-w-0 flex-1 text-xs">
                        <span className="font-medium">Track {index + 1}</span>
                        <span className="ml-2 text-[11px] text-muted-foreground">{track.channels.length} channel{track.channels.length === 1 ? "" : "s"}</span>
                      </div>
                      <Button size="sm" variant={playing && playingTrack === index ? "default" : "ghost"} onClick={() => playing && playingTrack === index ? stop() : play(index)} title={playing && playingTrack === index ? `Stop track ${index + 1}` : `Play track ${index + 1}`}>
                        {playing && playingTrack === index ? <Square /> : <Play />}
                        {playing && playingTrack === index ? "Stop" : "Play"}
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button size="sm" variant="ghost" disabled={!!busy} title={`Export track ${index + 1}`}><Download /> Export</Button></DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onSelect={() => exportAs("wav", index)}>WAV (uncompressed)</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => exportAs("flac", index)}>FLAC (lossless)</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => exportAs("ogg", index)}>Ogg Opus (small)</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => exportAs("brstm", index)}>BRSTM (game format)</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <TrackWaveform clip={clip} index={index} elapsed={elapsed} active={playing && playingTrack === index}
                        onPlay={(at) => { setElapsed(at); void play(index, at); }} />
                    </div>
                  ))}
                  <p className="m-0 text-[11px] leading-relaxed text-muted-foreground">These are the game's actual audio layers. A layer may contain several instruments; the file does not name them.</p>
                </div>
              )}
            </div>
          )}
          <p className="m-0 text-[11px] leading-relaxed text-muted-foreground">
            {item.kind === "music"
              ? (clip.tracks?.length || 0) > 1
                ? "Most courses have normal and final-lap versions: replace both. Mix exports combine the audio tracks into stereo; BRSTM keeps them separate."
                : "This stream is a single stereo mix; its original instruments cannot be extracted. Most courses have normal and final-lap versions: replace both."
              : item.wave?.kind === "Sound"
                ? "Every sound that plays this wave changes. Voices and effects are mono at their original sample rate."
                : "A sample of an instrument bank: sequenced sounds and some music play it at different pitches."}
          </p>
        </>
      )}
    </div>
  );
}
