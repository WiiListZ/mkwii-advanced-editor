// Chooses an ambient sound to place on the track: the game's sound emitters, each with Listen
// (its samples from revo_kart.brsar, when the game folder is chosen). Resolves with the object ID.

import * as React from "react";
import { Play, Square, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { api } from "../../../js/api.js";
import { listWaves, parseBRSAR, readWave } from "../../../js/formats/brsar.js";
import { AMBIENT_SOUNDS, ambientSoundSamples } from "../../../js/data/ambient-sounds.js";
import { audioContext } from "../audio-convert";
import { editor } from "../editor";

export function AmbientSoundDialog({ close }: { close: (objectId: number | null) => void }) {
  const [archive, setArchive] = React.useState<any>(null);
  const [state, setState] = React.useState("Reading revo_kart.brsar…");
  const [playing, setPlaying] = React.useState<number | null>(null);
  const source = React.useRef<AudioBufferSourceNode[]>([]);
  const path = editor.workspacePath("sound", "revo_kart.brsar");
  React.useEffect(() => {
    if (!path) { setState("Choose the game folder (Settings › Game files) to listen to the sounds."); return; }
    api.readPath(path).then(async (f: any) => { setArchive(parseBRSAR(await api.decodeArchiveBytes(f.data, f.path))); setState(""); })
      .catch((e: any) => setState(`Could not read the sound archive: ${e.message}`));
  }, [path]);
  const waves = React.useMemo(() => archive ? listWaves(archive) : [], [archive]);
  const stop = () => { for (const s of source.current) { try { s.stop(); } catch { /* already stopped */ } } source.current = []; setPlaying(null); };
  React.useEffect(() => stop, []);
  const listen = async (objectId: number) => {
    stop();
    const ambient = AMBIENT_SOUNDS.find((a) => a.objectId === objectId)!, found = archive && ambientSoundSamples(archive, ambient, waves);
    if (!found?.samples.length) return toast.error("This sound's samples were not found in revo_kart.brsar");
    try {
      const ctx = audioContext();
      await ctx.resume();
      // Every sample of the bank at once, looping, as the emitter plays them.
      for (const sample of found.samples) {
        const clip = readWave(archive, sample), length = clip.channels[0].length;
        const buffer = ctx.createBuffer(clip.channels.length, length, clip.sampleRate);
        clip.channels.forEach((c: Int16Array, i: number) => buffer.copyToChannel(Float32Array.from(c, (v) => v / 32768), i));
        const node = ctx.createBufferSource();
        node.buffer = buffer; node.loop = clip.loop; node.loopStart = clip.loopStart / clip.sampleRate;
        node.connect(ctx.destination); node.start();
        source.current.push(node);
      }
      setPlaying(objectId);
    } catch (e: any) { toast.error("Could not play the sound", { description: e.message }); }
  };
  return <div className="flex flex-col gap-3" data-ambient-sounds>
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <DialogTitle className="text-base">Add a sound here</DialogTitle>
        <DialogDescription className="text-xs">The game's ambient sounds: an invisible emitter plays one in a loop, heard as karts come near it and its route. Its own sound can be replaced in Sounds and music, for every track at once.</DialogDescription>
      </div>
      <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={() => { stop(); close(null); }}><X /></Button>
    </div>
    {state && <p className="m-0 text-xs text-muted-foreground">{state}</p>}
    <div className="flex flex-col divide-y rounded-md border">
      {AMBIENT_SOUNDS.map((a) => <div key={a.objectId} className="flex items-center gap-2 px-2.5 py-1.5" data-ambient={a.object}>
        <Button size="icon-sm" variant="ghost" disabled={!archive} aria-label={playing === a.objectId ? `Stop ${a.label}` : `Listen to ${a.label}`} onClick={() => playing === a.objectId ? stop() : void listen(a.objectId)}>
          {playing === a.objectId ? <Square className="fill-current" /> : <Play className="fill-current" />}
        </Button>
        <div className="min-w-0 flex-1"><div className="text-xs font-medium">{a.label}</div><div className="font-mono text-[10.5px] text-muted-foreground">{a.object} · {a.sound}</div></div>
        <Button size="sm" variant="secondary" onClick={() => { stop(); close(a.objectId); }}>Add</Button>
      </div>)}
    </div>
    <p className="m-0 text-[11px] text-muted-foreground">The emitter gets a short route of its own: stretch it along a river or a shore to spread the sound. Listen plays its samples on their own; in the game they loop with the emitter's sequence.</p>
  </div>;
}
