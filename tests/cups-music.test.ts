import { expect, test } from "bun:test";
import { buildBRSTM, decodeBRSTM, parseBRSTM } from "../web/js/formats/brstm.js";
import { musicLike } from "../web/src/app/audio-convert";

test("an audio file becomes a BRSTM shaped like the music it replaces", async () => {
  // The original: 4 channels in two stereo tracks (like the game's music with its extra layer).
  const silence = () => new Int16Array(32000 * 2);
  const template = buildBRSTM({ channels: [silence(), silence(), silence(), silence()], sampleRate: 32000, loop: true, loopStart: 100,
    tracks: [{ volume: 127, pan: 64, channels: [0, 1] }, { volume: 100, pan: 64, channels: [2, 3] }], trackType: 1 });
  const n = 32000 * 3;
  const left = Float32Array.from({ length: n }, (_, i) => Math.sin(i / 20) * 0.5);
  const right = Float32Array.from({ length: n }, (_, i) => Math.cos(i / 30) * 0.5);
  const out = parseBRSTM(await musicLike(template, { rate: 32000, channels: [left, right] }, { loop: true, loopStart: 1.5, volume: 100 }));
  expect(out.sampleRate).toBe(32000);
  expect(out.channels).toBe(4);
  expect(out.tracks.map((t: any) => t.channels)).toEqual([[0, 1], [2, 3]]);
  expect(out.loop).toBe(true);
  expect(out.loopStart).toBe(48000);
  expect(out.samples).toBe(n);
  // Each track gets left and right.
  const pcm = decodeBRSTM(out);
  const close = (a: Int16Array, b: Float32Array) => Math.max(...Array.from({ length: 2000 }, (_, i) => Math.abs(a[i + 1000] / 32767 - b[i + 1000])));
  expect(close(pcm[0], left)).toBeLessThan(0.05);
  expect(close(pcm[1], right)).toBeLessThan(0.05);
  expect(close(pcm[2], left)).toBeLessThan(0.05);
  expect(close(pcm[3], right)).toBeLessThan(0.05);
  await expect(musicLike(template, { rate: 32000, channels: [] }, { loop: true, loopStart: 0, volume: 100 })).rejects.toThrow();
});
