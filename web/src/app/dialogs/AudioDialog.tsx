// Sounds and music: the game's music streams (sound/strm/*.brstm) and the sound effects and voices
// of sound/revo_kart.brsar. Listen, export (WAV, MP3, M4A, Ogg Opus, FLAC, AIFF, BRSTM) and replace them with any
// audio file; replacements are kept until Save, which writes the game files (optionally with a .bak copy).

import * as React from "react";
import { BookOpen, Check, Download, FileAudio, MoveHorizontal, Volume, Volume1, Volume2, VolumeX, LoaderCircle, LocateFixed, Paintbrush, Play, Plus, Repeat, RotateCcw, Save, Search, Square, Trash2, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api, FILTERS } from "../../../js/api.js";
import { buildBRSTM, decodeBRSTM, parseBRSTM, setBRSTMLoop, setBRSTMTrackMix } from "../../../js/formats/brstm.js";
import { listWaves, parseBRSAR, readWave, replaceWave, setStreamRoom, streamSound, streamTrackCount } from "../../../js/formats/brsar.js";
import { MAX_CHANNELS, MAX_TRACKS, musicTriggers, SOUND_TRIGGER, trackPlays } from "../../../js/data/music-tracks.js";
import { replaceTrack, withoutTrack, withTrack } from "../../../js/editor/stream-tracks.js";
import { encodeFLAC, encodeWAV, isolateTrack, mixTracks, musicLabel, panGains, toFloat32, toInt16 } from "../../../js/editor/audio.js";
import { encodeOggOpus } from "../../../js/editor/ogg-opus.js";
import { AAC_RATE, aacSupported, encodeAIFF, encodeM4A, encodeMP3, mp3Rate } from "../../../js/editor/audio-export.js";
import { audioContext, decodeFile, resample, suspendAudio } from "../audio-convert";
import { editor, winPath } from "../editor";
import { dialogs } from "../dialogs-store";
import { WorkspaceCard } from "../panels/WorkspaceCard";
import { useEditor } from "../hooks";
import { cn } from "@/lib/utils";
import { useActivityNote } from "../discord-activity";

// Every sound is listed (the game has thousands): rows have one height, and only those in sight
// and a few around them are drawn while the list scrolls.
const ROW = 44, OVERSCAN = 8;
function VirtualRows<T>({ items, row }: { items: T[]; row: (item: T) => React.ReactNode }) {
  const box = React.useRef<HTMLDivElement>(null);
  const [view, setView] = React.useState({ top: 0, height: 600 });
  React.useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setView({ top: el.scrollTop, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // A new search starts at the top of its results.
  React.useEffect(() => { if (box.current) { box.current.scrollTop = 0; setView((v) => ({ ...v, top: 0 })); } }, [items]);
  const first = Math.max(0, Math.floor(view.top / ROW) - OVERSCAN), last = Math.min(items.length, Math.ceil((view.top + view.height) / ROW) + OVERSCAN);
  return <div ref={box} className="min-h-0 flex-1 overflow-y-auto p-1" onScroll={(e) => setView({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}>
    <div className="relative" style={{ height: items.length * ROW }}>
      <div className="absolute inset-x-0" style={{ top: first * ROW }}>{items.slice(first, last).map(row)}</div>
    </div>
  </div>;
}
type Tab = "music" | "sounds";
interface Item { key: string; label: string; detail: string; kind: "music" | "wave"; path?: string; wave?: any }
// Decoded audio: Int16 channels, rate, loop and (music) the stereo tracks.
interface Clip { sampleRate: number; channels: Int16Array[]; loop: boolean; loopStart: number; tracks?: { volume: number; pan: number; channels: number[] }[]; trackType?: number }

// Export formats, in the order of the Export menu.
type ExportFormat = "wav" | "mp3" | "m4a" | "ogg" | "flac" | "aiff" | "brstm";
const EXPORT_FORMATS: { id: ExportFormat; label: string; detail: string; extension: string; fileType: string }[] = [
  { id: "wav", label: "WAV", detail: "Uncompressed, opens in every program", extension: "wav", fileType: "WAV audio" },
  { id: "mp3", label: "MP3", detail: "192 kbps, plays on every device", extension: "mp3", fileType: "MP3 audio" },
  { id: "m4a", label: "M4A (AAC)", detail: "192 kbps, phones, iTunes and video editors", extension: "m4a", fileType: "M4A audio (AAC)" },
  { id: "ogg", label: "Ogg Opus", detail: "Small files, good quality", extension: "ogg", fileType: "Ogg Opus audio" },
  { id: "flac", label: "FLAC", detail: "Lossless, smaller than WAV", extension: "flac", fileType: "FLAC audio (lossless)" },
  { id: "aiff", label: "AIFF", detail: "Uncompressed, for Mac and audio editors", extension: "aiff", fileType: "AIFF audio" },
  { id: "brstm", label: "BRSTM", detail: "The game's own format, with its loop", extension: "brstm", fileType: "BRSTM stream (game format)" },
];

function ExportMenu({ onExport }: { onExport: (format: ExportFormat) => void }) {
  // AAC needs the system's encoder (WebCodecs); the item explains when it is missing.
  const [aac, setAac] = React.useState<boolean | null>(null);
  React.useEffect(() => { void aacSupported().then(setAac); }, []);
  return (
    <DropdownMenuContent className="w-72">
      {EXPORT_FORMATS.map((f) => {
        const off = f.id === "m4a" && aac === false;
        return (
          <DropdownMenuItem key={f.id} disabled={off} onSelect={() => onExport(f.id)} className="flex-col items-start gap-0">
            <span className="text-[13px]">{f.label}</span>
            <span className="text-[11px] text-muted-foreground">{off ? "Not available: this computer has no AAC encoder" : f.detail}</span>
          </DropdownMenuItem>
        );
      })}
    </DropdownMenuContent>
  );
}


// Two channels to listen to: each track at its volume and pan, as the game places them (mixTracks).
const stereo = (clip: Clip, trackIndex: number | null = null) => mixTracks(clip, trackIndex);

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

const seconds = (n: number, rate: number) => `${(n / rate).toFixed(n / rate < 10 ? 2 : 1)} s`;
const timestamp = (value: number) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;

// `file`: a .brstm or .brsar opened from disk. `loose`: a browser-picked or dropped file.
export function AudioDialog({ file, loose, close }: { file?: string; loose?: { name: string; data: Uint8Array }; close: (v: any) => void }) {
  useEditor("settings");
  const selectedFile = file || loose?.name || "";
  const looseMusic = /\.brstm$/i.test(selectedFile) ? selectedFile : "", looseArchive = /\.brsar$/i.test(selectedFile) ? selectedFile : "";
  const root = editor.workspace() || (selectedFile ? "loose" : "");
  const strm = selectedFile ? "" : editor.workspacePath("sound", "strm"), brsarPath = file && looseArchive ? file : selectedFile ? "" : editor.workspacePath("sound", "revo_kart.brsar");
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
    if (looseArchive && loose) {
      if (archive) return;
      try { const parsed = parseBRSAR(loose.data); setArchive(parsed); setWaves(listWaves(parsed)); }
      catch (e: any) { toast.error("Could not read the sound archive", { description: e.message }); }
      return;
    }
    // Also for music: it says how much of each music the game plays (its tracks and channels).
    if (archive || !brsarPath) return;
    if (tab === "sounds") setLoading("Reading revo_kart.brsar…");
    api.readPath(brsarPath).then(async (f: any) => {
      const a = parseBRSAR(await api.decodeArchiveBytes(f.data, f.path));
      setArchive(a); setWaves(listWaves(a));
    }).catch((e: any) => toast.error("Could not read the sound archive", { description: e.message })).finally(() => setLoading(""));
  }, [tab, archive, brsarPath, loose]);

  const items: Item[] = React.useMemo(() => tab === "music"
    ? (music || []).map((f) => looseMusic ? { key: `m:${f}`, label: f.split(/[\\/]/).pop()!, detail: f, kind: "music" as const, path: f }
      : { key: `m:${f}`, label: musicLabel(f), detail: f, kind: "music" as const, path: winPath(strm, f) })
    : (waves || []).map((w) => ({ key: w.key, label: w.name, detail: `${w.kind} · ${w.group || "no group"}`, kind: "wave" as const, wave: w })),
  [tab, music, waves, strm]);
  const q = query.trim().toLowerCase();
  const filtered = React.useMemo(() => q ? items.filter((i) => i.label.toLowerCase().includes(q) || i.detail.toLowerCase().includes(q)) : items, [items, q]);
  const current = items.find((i) => i.key === selected) || null;
  const pendingCount = Object.keys(pendingMusic).length + changedWaves.size;

  const save = async () => {
    setSaving(true);
    try {
      for (const [path, bytes] of Object.entries(pendingMusic)) {
        if (loose) {
          if (!(await editor.writeLoose(null, loose.name, bytes))) { setSaving(false); return; }
        } else await api.writeFile(path, bytes, { backup: editor.settings.keepBackups, edited: true });
        setPendingMusic((current) => { const next = { ...current }; if (next[path] === bytes) delete next[path]; return next; });
      }
      if (archiveChanged && archive) {
        setLoading("Saving revo_kart.brsar…");
        if (loose) {
          if (!(await editor.writeLoose(null, loose.name, archive.data))) { setLoading(""); setSaving(false); return; }
        } else await api.writeFile(brsarPath, archive.data, { backup: editor.settings.keepBackups, edited: true });
        setChangedWaves(new Set()); setArchiveChanged(false);
      }
      toast.success(`${pendingCount} sound${pendingCount === 1 ? "" : "s"} saved`, { description: loose ? "The edited file was exported." : editor.settings.keepBackups ? "The first save keeps a .bak copy of each original file." : "Backups are off in Settings." });
    } catch (e: any) { toast.error("Could not save", { description: e.message }); }
    setLoading(""); setSaving(false);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <DialogTitle className="text-sm">Sounds and music</DialogTitle>
          {selectedFile ? <DialogDescription className="m-0 truncate text-xs" title={selectedFile}>{selectedFile}. {loose ? "Save exports the edited file." : "Save writes this file."}</DialogDescription>
            : <DialogDescription className="m-0 text-xs">Music streams (sound\strm) and sound effects and voices (sound\revo_kart.brsar) of the workspace.</DialogDescription>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button size="icon" variant="ghost" title="Close" aria-label="Close" disabled={saving} onClick={async () => {
            if (pendingCount && !(await dialogs.confirm({ title: "Unsaved sounds", description: `${pendingCount} unsaved sound change${pendingCount === 1 ? "" : "s"} will be lost.`, confirmLabel: "Close without saving", destructive: true }))) return;
            suspendAudio();
            close(null);
          }}><X /></Button>
        </div>
      </div>
      {!root ? <WorkspaceCard /> : (
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <div role="tablist" className={cn("flex max-w-full rounded-md border bg-muted/30 p-0.5", selectedFile && "hidden")}>
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
                {loading || `${filtered.length.toLocaleString()} ${tab === "music" ? "streams" : "sounds"}`}
              </div>
              <VirtualRows items={filtered} row={(i) => (
                  <button key={i.key} onClick={() => setSelected(i.key)} style={{ height: ROW }} className={cn("flex w-full cursor-pointer flex-col items-start justify-center rounded px-2 text-left hover:bg-accent/60", i.key === selected && "bg-accent")}>
                    <span className="flex w-full items-center gap-1.5 text-[12.5px]">
                      <span className="min-w-0 flex-1 truncate">{i.label}</span>
                      {(pendingMusic[i.path || ""] || changedWaves.has(i.key)) && <span className="size-1.5 shrink-0 rounded-full bg-primary" title="Unsaved changes" />}
                    </span>
                    <span className="w-full truncate text-[10.5px] text-muted-foreground">{i.detail}</span>
                  </button>
                )} />
            </div>
            <div className="min-h-0 overflow-y-auto">
              {current ? (
                <SoundPanel key={current.key + (changedWaves.has(current.key) ? ":c" : "")} item={current} archive={archive}
                  pending={current.path ? pendingMusic[current.path] : undefined} brsarPath={brsarPath} sourceBytes={looseMusic ? loose?.data : undefined}
                  onReplaceMusic={(bytes) => setPendingMusic((p) => { const next = { ...p }; if (bytes) next[current.path!] = bytes; else delete next[current.path!]; return next; })}
                  onReplaceWave={(next) => { setArchive(next); setArchiveChanged(true); setChangedWaves((s) => new Set(s).add(current.key)); }}
                  onArchiveChange={(next, key) => { setArchive(next); setArchiveChanged(true); setChangedWaves((s) => new Set(s).add(key)); }}
                  onPaintTrigger={(variant) => {
                    if (pendingCount) { toast.warning("Save the sounds first", { description: "Painting closes this window." }); return; }
                    suspendAudio();
                    close(null);
                    editor.setPaint({ type: SOUND_TRIGGER, variant });
                    editor.startPainting();
                  }} />
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

function SoundPanel({ item, archive, pending, brsarPath, sourceBytes, onReplaceMusic, onReplaceWave, onArchiveChange, onPaintTrigger }: {
  item: Item; archive: any; pending?: Uint8Array; brsarPath: string; sourceBytes?: Uint8Array;
  onReplaceMusic: (bytes: Uint8Array | null) => void; onReplaceWave: (archive: any) => void;
  onArchiveChange: (archive: any, key: string) => void; onPaintTrigger: (variant: number) => void;
}) {
  const [clip, setClip] = React.useState<Clip | null>(null);
  const [error, setError] = React.useState("");
  const [playing, setPlaying] = React.useState(false);
  const [playingTrack, setPlayingTrack] = React.useState<number | null>(null);
  useActivityNote(playing ? `Listening to ${item.label}` : null);
  const [elapsed, setElapsed] = React.useState(0);
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
  // While playing: the other tracks' sources, and each track's gains (see play).
  const others = React.useRef<AudioBufferSourceNode[]>([]);
  const live = React.useRef(new Map<number, { gains: GainNode[][]; count: number }>());
  // Set when only a track's volume or pan changed: the music is not read again, and goes on playing.
  const mixOnly = React.useRef<Uint8Array | null>(null);
  const scrubbing = React.useRef(false);
  const wave = React.useRef<HTMLCanvasElement>(null);
  const musicBytes = async () => pending || sourceBytes || await api.decodeArchiveBytes((await api.readPath(item.path!)).data, item.path!);

  // Decode the sound (the replacement when there is one).
  React.useEffect(() => {
    if (pending && pending === mixOnly.current) {
      mixOnly.current = null;
      const tracks = parseBRSTM(pending).tracks;
      setClip((c) => c && { ...c, tracks, trackType: 1 });
      return;
    }
    mixOnly.current = null;
    stop();
    let cancelled = false;
    setClip(null); setError("");
    setElapsed(0); buffers.current.clear();
    (async () => {
      if (item.kind === "music") {
        const data = await musicBytes();
        const s = parseBRSTM(data);
        const c = { sampleRate: s.sampleRate, channels: decodeBRSTM(s), loop: s.loop, loopStart: s.loopStart, tracks: s.tracks, trackType: s.trackType };
        if (!cancelled) { setClip(c); setLoopEnabled(c.loop); setLoopStartText(String(c.loopStart / c.sampleRate)); }
        setHasBackup(!sourceBytes && await api.exists(item.path + ".bak"));
      } else {
        const c = readWave(archive, item.wave);
        if (!cancelled) { setClip(c); setLoopEnabled(c.loop); setLoopStartText(String(c.loopStart / c.sampleRate)); }
        setHasBackup(!!brsarPath && await api.exists(brsarPath + ".bak"));
      }
    })().catch((e) => !cancelled && setError(e.message));
    // A change of a track's volume or pan only (mixOnly) leaves it playing.
    return () => { cancelled = true; if (!mixOnly.current) stop(); };
    // A music does not depend on the sound archive (read later, for its tracks' room): it is not read again then.
  }, [item.key, pending, item.kind === "wave" ? archive : null]);

  // Whatever plays stops when another sound is chosen or the window closes, also after a volume or
  // pan change, which leaves the music playing (mixOnly) and so has nothing of its own to stop.
  React.useEffect(() => () => stop(), []);

  // RMS envelope of the stereo mix, scaled to the clip's loudest sample.
  React.useEffect(() => {
    if (wave.current && clip) drawWaveform(wave.current, stereo(clip)[0], clip.loop ? clip.loopStart : undefined);
  }, [clip]);

  const stop = () => {
    generation.current++;
    try { source.current?.stop(); } catch { /* not started */ }
    for (const node of others.current) { try { node.stop(); } catch { /* not started */ } }
    others.current = []; live.current = new Map();
    source.current = null; playback.current = null;
    if (ticker.current) clearInterval(ticker.current);
    ticker.current = null;
    setPlaying(false); setPlayingTrack(null);
  };
  // One source per track, played together: each side of a track goes to the left and the right
  // through gains set from its volume and pan (panGains), so that both can change while it plays.
  const tracksOf = (c: Clip) => c.tracks?.length ? c.tracks : [{ volume: 127, pan: 64, channels: c.channels.map((_, i) => i) }];
  const sideGains = (track: { volume: number; pan: number; channels: number[] }, count: number) => {
    const norm = (track.volume / 127) / Math.max(1, count) ** 0.5, sides = Math.min(2, track.channels.length);
    return [0, 1].map((side) => panGains(track.pan ?? 64, Math.min(side, sides - 1), sides).map((g) => g * norm * (sides < 2 && side === 1 ? 0 : 1)));
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
    const all = tracksOf(clip), chosen = trackIndex !== null ? [trackIndex] : all.map((_, i) => i);
    const at = ctx.currentTime + 0.05;
    const nodes: AudioBufferSourceNode[] = [];
    live.current = new Map();
    for (const index of chosen) {
      const track = all[index];
      let buffer = buffers.current.get(index);
      if (!buffer) {
        buffer = ctx.createBuffer(2, clip.channels[0].length, clip.sampleRate);
        [0, 1].forEach((side) => {
          const data = clip.channels[track.channels[Math.min(side, track.channels.length - 1)]], out = new Float32Array(data.length);
          for (let i = 0; i < data.length; i++) out[i] = data[i] / 32768;
          buffer!.copyToChannel(out, side);
        });
        buffers.current.set(index, buffer);
      }
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      if (clip.loop && loopPreview) { node.loop = true; node.loopStart = clip.loopStart / clip.sampleRate; node.loopEnd = duration; }
      const split = ctx.createChannelSplitter(2), merge = ctx.createChannelMerger(2);
      node.connect(split);
      const gains = sideGains(track, chosen.length).map((pair, side) => pair.map((value, to) => {
        const gain = ctx.createGain();
        gain.gain.value = value;
        split.connect(gain, side);
        gain.connect(merge, 0, to);
        return gain;
      }));
      merge.connect(ctx.destination);
      live.current.set(index, { gains, count: chosen.length });
      nodes.push(node);
    }
    const node = nodes[0];
    node.onended = () => { if (source.current === node) { stop(); setElapsed(duration); } };
    for (const n of nodes) n.start(at, offset);
    source.current = node;
    others.current = nodes.slice(1);
    playback.current = { start: at, offset };
    setElapsed(offset);
    ticker.current = setInterval(() => {
      if (!playback.current || scrubbing.current) return;
      const raw = playback.current.offset + Math.max(0, ctx.currentTime - playback.current.start);
      const loopStart = clip.loopStart / clip.sampleRate;
      const position = node.loop && raw >= duration && loopStart < duration
        ? loopStart + (raw - duration) % (duration - loopStart)
        : Math.min(raw, duration);
      setElapsed(position);
    }, 50);
    setPlaying(true);
    setPlayingTrack(trackIndex);
  };
  // A track's volume or pan while it plays: heard at once.
  const liveMix = (index: number, mix: { volume: number; pan: number }) => {
    const entry = live.current.get(index);
    if (!entry || !clip) return;
    const track = { ...tracksOf(clip)[index], ...mix };
    sideGains(track, entry.count).forEach((pair, side) => pair.forEach((value, to) => { entry.gains[side][to].gain.value = value; }));
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
      const bytes = await musicBytes();
      onReplaceMusic(setBRSTMLoop(bytes, loopEnabled, loopStartSample));
      toast.success("Loop updated", { description: "Save to write the BRSTM file." });
    } catch (e: any) { toast.error("Could not update the loop", { description: e.message }); }
    finally { setBusy(""); }
  };

  const baseName = item.kind === "music" ? item.detail.replace(/\.brstm$/i, "") : item.label;
  const exportAs = async (format: ExportFormat, trackIndex: number | null = null) => {
    if (!clip) return;
    const spec = EXPORT_FORMATS.find((f) => f.id === format)!;
    setBusy(`Encoding ${spec.label}…`);
    try {
      let bytes: Uint8Array;
      if (format === "mp3" || format === "m4a" || format === "aiff") {
        const pair = trackIndex !== null || clip.channels.length > 2 ? stereo(clip, trackIndex).map(toInt16) : clip.channels;
        if (format === "aiff") bytes = encodeAIFF(pair, clip.sampleRate);
        else if (format === "mp3") {
          // MP3 stores only some sample rates (the game's 32 kHz is one of them); others are resampled.
          const rate = mp3Rate(clip.sampleRate);
          const pcm = rate === clip.sampleRate ? pair : (await resample(pair.map(toFloat32), clip.sampleRate, rate)).map(toInt16);
          bytes = encodeMP3(pcm, rate, 192);
        } else bytes = await encodeM4A(await resample(pair.map(toFloat32), clip.sampleRate, AAC_RATE));
      } else if (format === "brstm") {
        if (trackIndex === null && item.kind === "music" && !pending) bytes = await musicBytes();
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
      const filters = [{ name: spec.fileType, extensions: [spec.extension] }];
      const name = `${baseName}${trackIndex === null ? "" : `_track_${trackIndex + 1}`}`;
      await editor.exportBytes(`${name}.${spec.extension}`, filters, bytes, `Export ${name}`);
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
              <ExportMenu onExport={(format) => exportAs(format)} />
            </DropdownMenu>
            {pending && <Button size="sm" variant="ghost" onClick={() => onReplaceMusic(null)}><Undo2 /> Undo changes</Button>}
            {hasBackup && !pending && <Button size="sm" variant="ghost" disabled={!!busy} onClick={restore}><RotateCcw /> Restore original</Button>}
            {busy && <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" /> {busy}</span>}
          </div>
          {item.kind === "music" && <TracksSection item={item} clip={clip} archive={archive} busy={busy} setBusy={setBusy} elapsed={elapsed}
            playing={playing} playingTrack={playingTrack} play={play} stop={stop} setElapsed={setElapsed} exportAs={exportAs} liveMix={liveMix}
            musicBytes={musicBytes} onReplaceMusic={onReplaceMusic} onMixOnly={(bytes) => { mixOnly.current = bytes; onReplaceMusic(bytes); }} onArchiveChange={onArchiveChange} onPaintTrigger={onPaintTrigger} />}
          <p className="m-0 text-[11px] leading-relaxed text-muted-foreground">
            {item.kind === "music"
              ? (clip.tracks?.length || 0) > 1
                ? "Most courses have normal and final-lap versions: replace both, and change their tracks alike. Mix exports combine the audio tracks into stereo; BRSTM keeps them separate."
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

// A music's tracks: each played, replaced, exported, mixed or taken out on its own, new ones added up
// to what the game can play (see music-tracks.js), and when the game plays each.
function TracksSection({ item, clip, archive, busy, setBusy, elapsed, playing, playingTrack, play, stop, setElapsed, exportAs, liveMix, musicBytes, onReplaceMusic, onMixOnly, onArchiveChange, onPaintTrigger }: {
  item: Item; clip: Clip; archive: any; busy: string; setBusy: (text: string) => void; elapsed: number; playing: boolean; playingTrack: number | null;
  play: (track?: number | null, from?: number) => Promise<void>; stop: () => void; setElapsed: (at: number) => void; exportAs: (format: ExportFormat, track?: number | null) => Promise<void>;
  liveMix: (index: number, mix: { volume: number; pan: number }) => void; onMixOnly: (bytes: Uint8Array) => void;
  musicBytes: () => Promise<Uint8Array>; onReplaceMusic: (bytes: Uint8Array | null) => void; onArchiveChange: (archive: any, key: string) => void; onPaintTrigger: (variant: number) => void;
}) {
  const tracks = clip.tracks?.length ? clip.tracks : [{ volume: 127, pan: 64, channels: clip.channels.map((_, i) => i) }];
  const file = item.path || item.detail;
  const triggers = musicTriggers(file);
  const sound = archive && item.path ? streamSound(archive, item.path) : null;
  const room = sound ? { tracks: streamTrackCount(sound.stream), channels: sound.stream.channels } : null;
  const canAdd = tracks.length < MAX_TRACKS && clip.channels.length + 2 <= MAX_CHANNELS;
  const canPaint = !!editor.doc.kcl;
  const [mix, setMix] = React.useState(tracks.map((t) => ({ volume: t.volume, pan: t.pan })));
  React.useEffect(() => { setMix(tracks.map((t) => ({ volume: t.volume, pan: t.pan }))); }, [clip]);

  const write = (next: any) => onReplaceMusic(buildBRSTM({ channels: next.channels, sampleRate: next.sampleRate, loop: next.loop, loopStart: next.loopStart, tracks: next.tracks, trackType: next.trackType }));
  const audio = async (title: string, description: string) => {
    const f = await api.openFile(FILTERS.audio, title);
    if (!f) return null;
    const options: any = await dialogs.form({ title, description, fields: [{ key: "volume", label: "Volume (%)", type: "number", value: 100, min: 10, max: 400, step: 5 }], confirmLabel: "Use it" });
    if (!options) return null;
    const decoded = await decodeFile(f.name, f.data);
    if (!decoded.channels.length || !decoded.channels[0].length) throw new Error("The audio file is empty");
    const gain = Number(options.volume) / 100;
    return (await resample(decoded.channels.map((c) => (gain === 1 ? c : c.map((v) => v * gain))), decoded.rate, clip.sampleRate)).map(toInt16);
  };
  const length = seconds(clip.channels[0].length, clip.sampleRate);
  const add = async () => {
    const count = tracks.length + 1, channels = clip.channels.length + 2;
    // More than the game sets aside for this music: its room in revo_kart.brsar grows with it.
    const grow = !!room && (count > room.tracks || channels > room.channels);
    try {
      const pcm = await audio(`Add track ${count} to ${item.label}`, `The audio is converted to the game's format (DSP-ADPCM, ${clip.sampleRate} Hz, 2 channels) and fitted to this music's length (${length}): cut if longer, silent at the end if shorter. It loops with the music.${grow ? ` The game sets aside room for ${room!.tracks} track${room!.tracks === 1 ? "" : "s"} of this music: revo_kart.brsar is changed to play ${count}, and saved with it.` : ""}`);
      if (!pcm) return;
      setBusy("Adding the track…");
      write(withTrack(clip, pcm));
      if (grow) onArchiveChange(setStreamRoom(archive, sound, Math.max(room!.channels, channels), Math.max(room!.tracks, count)), `stream:${sound.name}`);
      toast.success(`Track ${count} added`, { description: triggers ? "Save to write it into the game files." : "This music's tracks all play together, all the time. Save to write it into the game files." });
    } catch (e: any) { toast.error("Could not add the track", { description: e.message }); }
    setBusy("");
  };
  const replace = async (index: number) => {
    try {
      const pcm = await audio(`Replace track ${index + 1} of ${item.label}`, `Only this track changes. The audio is converted to the game's format and fitted to the music's length (${length}).`);
      if (!pcm) return;
      setBusy("Replacing the track…");
      write(replaceTrack(clip, index, pcm));
    } catch (e: any) { toast.error("Could not replace the track", { description: e.message }); }
    setBusy("");
  };
  const remove = async (index: number) => {
    if (!await dialogs.confirm({ title: `Take out track ${index + 1}?`, description: "Its audio leaves this music. The tracks after it move up, so the course's Sound Triggers then play other tracks than before.", confirmLabel: "Take out", destructive: true })) return;
    setBusy("Taking the track out…");
    try { stop(); write(withoutTrack(clip, index)); } catch (e: any) { toast.error("Could not take out the track", { description: e.message }); }
    setBusy("");
  };
  const applyMix = async (index: number) => {
    const { volume, pan } = mix[index];
    if (volume === tracks[index].volume && pan === tracks[index].pan) return;
    try {
      // In the header only, when the file keeps them; else written again with them.
      if (clip.trackType === 1) onMixOnly(setBRSTMTrackMix(await musicBytes(), index, volume, pan));
      else write({ ...clip, tracks: tracks.map((t, i) => i === index ? { ...t, volume, pan } : t), trackType: 1 });
    } catch (e: any) { toast.error("Could not change the track", { description: e.message }); }
  };
  // When a track plays, in words, when no Sound Trigger list says it.
  const plainly = (index: number) => {
    const when = trackPlays(file, index);
    if (when.always) return index === 0 ? "all the time." : "all the time, with the others: the game changes no tracks of this music.";
    if (!when.variants.length) return when.unsaid.length ? `not documented: ${triggers!.course}'s music changes on Sound Triggers ${when.unsaid.map((v: any) => v.variant).join(", ")}, but which track each plays is not known.` : "never: no Sound Trigger of this course plays it.";
    return null;
  };
  const panText = (pan: number) => pan === 64 ? "middle" : pan < 64 ? `L ${64 - pan}` : `R ${pan - 64}`;

  return <div className="border-t pt-3" data-music-tracks>
    <div className="mb-1 flex flex-wrap items-center gap-2">
      <div className="text-xs font-medium">Tracks</div>
      <span className="text-[11px] text-muted-foreground" data-music-room>{tracks.length} of up to {MAX_TRACKS}{room ? ` · the game plays ${room.tracks} of this music (revo_kart.brsar)` : ""}</span>
      <div className="flex-1" />
      <Button size="sm" variant="ghost" title="A tutorial: tracks, when the game plays each, and Sound Triggers" onClick={() => dialogs.open("help", { tab: "tutorials", tutorial: "music-tracks" })}><BookOpen /> How it works</Button>
      <Button size="sm" variant="secondary" disabled={!canAdd || !!busy} title={canAdd ? "Add a track of your own audio to this music" : `The game plays at most ${MAX_TRACKS} tracks (${MAX_CHANNELS} channels) of a music`} onClick={add}><Plus /> Add a track…</Button>
    </div>
    <p className="m-0 mb-2 text-[11px] leading-relaxed text-muted-foreground">
      {triggers ? `In ${triggers.course}'s position the game turns these tracks up and down when a kart drives over Sound Trigger collision (KCL type 0x18); what each variant does is fixed by the game for this position. Paint it where the music should change.`
        : "The game changes no tracks of this music: every track plays all the time, mixed together. Only some positions change tracks as a kart drives: Toad's Factory, Wario's Gold Mine, Koopa Cape, Dry Dry Ruins, Moonview Highway and Bowser's Castle."}
    </p>
    <div className="space-y-1.5">
      {tracks.map((track, index) => {
        const when = trackPlays(file, index), text = plainly(index), on = playing && playingTrack === index;
        return <div key={index} className="flex flex-col gap-1.5 rounded border px-2 py-1.5" data-music-track={index + 1}>
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="min-w-0 flex-1 text-xs"><span className="font-medium">Track {index + 1}</span><span className="ml-2 text-[11px] text-muted-foreground">{track.channels.length} channel{track.channels.length === 1 ? "" : "s"}</span></div>
            <Button size="sm" variant={on ? "default" : "ghost"} onClick={() => on ? stop() : play(index)} title={on ? `Stop track ${index + 1}` : `Play track ${index + 1}`}>{on ? <Square /> : <Play />}{on ? "Stop" : "Play"}</Button>
            <Button size="sm" variant="ghost" disabled={!!busy} title={`Replace only track ${index + 1}`} onClick={() => replace(index)}><FileAudio /> Replace…</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button size="sm" variant="ghost" disabled={!!busy} title={`Export track ${index + 1}`}><Download /> Export</Button></DropdownMenuTrigger>
              <ExportMenu onExport={(format) => exportAs(format, index)} />
            </DropdownMenu>
            {tracks.length > 1 && <Button size="icon-sm" variant="ghost" disabled={!!busy} aria-label={`Take out track ${index + 1}`} title="Take this track out of the music" onClick={() => remove(index)}><Trash2 /></Button>}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            {(["volume", "pan"] as const).map((key) => <label key={key} className="flex items-center gap-1.5" title={key === "volume" ? "Volume" : "Pan (left to right)"}>
              {key === "pan" ? <MoveHorizontal className="size-3.5" aria-hidden="true" />
                : (() => { const v = mix[index]?.volume ?? 127, Icon = v === 0 ? VolumeX : v < 43 ? Volume : v < 86 ? Volume1 : Volume2; return <Icon className="size-3.5" aria-hidden="true" />; })()}
              <span>{key === "volume" ? "Volume" : "Pan"}</span>
              <input type="range" min="0" max="127" step="1" aria-label={`Track ${index + 1} ${key}`} value={mix[index]?.[key] ?? 64} className="w-28 cursor-pointer accent-primary"
                onChange={(e) => { const value = Number(e.currentTarget.value); setMix((m) => m.map((x, i) => i === index ? { ...x, [key]: value } : x)); liveMix(index, { ...mix[index], [key]: value }); }}
                onPointerUp={() => applyMix(index)} onKeyUp={() => applyMix(index)} />
              <span className="w-12 tabular-nums">{key === "pan" ? panText(mix[index]?.pan ?? 64) : mix[index]?.volume}</span>
            </label>)}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]" data-music-track-plays>
            <span className="text-muted-foreground">Plays</span>
            {text ? <span className="text-muted-foreground">{text}</span>
              : when.variants.map((v: any) => <span key={v.variant} className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5">
                on Sound Trigger {v.variant}: {v.text}
                {canPaint && <button type="button" className="cursor-pointer text-muted-foreground hover:text-foreground" aria-label={`Paint Sound Trigger variant ${v.variant}`} title={`Paint Sound Trigger variant ${v.variant} on the open track's collision, where this should start`} onClick={() => onPaintTrigger(v.variant)}><Paintbrush className="size-3" /></button>}
              </span>)}
          </div>
          <TrackWaveform clip={clip} index={index} elapsed={elapsed} active={on} onPlay={(at) => { setElapsed(at); void play(index, at); }} />
        </div>;
      })}
    </div>
    {triggers && !canPaint && <p className="m-0 mt-1.5 text-[11px] text-muted-foreground">Open the track to paint its Sound Triggers from here.</p>}
  </div>;
}
