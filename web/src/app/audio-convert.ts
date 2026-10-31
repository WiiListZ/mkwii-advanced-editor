// Audio files to the game's music format: decoding any file the browser can read (WAV, MP3, Ogg,
// FLAC, AAC…) or a BRSTM, resampling, and building a BRSTM shaped like the stream it replaces.
// Used by the audio editor and by Cups and tracks (music of a cup position).

import { buildBRSTM, decodeBRSTM, parseBRSTM } from "../../js/formats/brstm.js";
import { toFloat32, toInt16 } from "../../js/editor/audio.js";

let context: AudioContext | null = null;
export const audioContext = () => (context ||= new AudioContext());
export const suspendAudio = () => void context?.suspend();

export async function resample(channels: Float32Array[], from: number, to: number) {
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
export async function decodeFile(name: string, data: Uint8Array): Promise<{ rate: number; channels: Float32Array[] }> {
  if (/\.brstm$/i.test(name)) {
    const s = parseBRSTM(data);
    return { rate: s.sampleRate, channels: decodeBRSTM(s).map(toFloat32) };
  }
  const buffer = await audioContext().decodeAudioData(data.slice().buffer);
  return { rate: buffer.sampleRate, channels: Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i).slice()) };
}

export type MusicOptions = { loop: boolean; loopStart: number; volume: number; speed?: number };

// A BRSTM of `audio` shaped like `template` (the stream it replaces: rate, channels, stereo tracks),
// so the game plays it as it played the original. loopStart in seconds, volume in percent; speed > 1
// plays faster and higher (the final-lap version).
export async function musicLike(template: Uint8Array, audio: { rate: number; channels: Float32Array[] }, { loop, loopStart, volume, speed = 1 }: MusicOptions) {
  if (!audio.channels.length || !audio.channels[0].length) throw new Error("The audio file is empty");
  const clip = parseBRSTM(template);
  const gain = volume / 100;
  const at = await resample(audio.channels.map((c) => (gain === 1 ? c : c.map((v) => v * gain))), Math.round(audio.rate * speed), clip.sampleRate);
  const pcm = at.map(toInt16);
  // Every stereo track gets the new left/right channels.
  const channels = Array.from({ length: clip.channels }, (_, c) => {
    const track = clip.tracks?.find((t: any) => t.channels.includes(c));
    const side = track ? track.channels.indexOf(c) : c;
    return pcm[Math.min(side, pcm.length - 1)];
  });
  const start = Math.min(Math.max(0, Math.round(loopStart / speed * clip.sampleRate)), channels[0].length - 1);
  return buildBRSTM({ channels, sampleRate: clip.sampleRate, loop, loopStart: start, tracks: clip.tracks, trackType: clip.trackType });
}
