import { expect, test } from "bun:test";
import { buildBRSTM, decodeBRSTM, decodeDSP, dspCoefficients, encodeDSP, parseBRSTM, setBRSTMLoop } from "../web/js/formats/brstm.js";
import { encodeFLAC, encodeWAV, isolateTrack, musicLabel } from "../web/js/editor/audio.js";

const tone = (n: number, f: number, rate = 32000) => Int16Array.from({ length: n }, (_, i) => Math.round(Math.sin(2 * Math.PI * f * i / rate) * 9000 + Math.sin(2 * Math.PI * f * 3.1 * i / rate) * 3000));
const snr = (a: Int16Array, b: Int16Array) => { let e = 0, s = 0; for (let i = 0; i < a.length; i++) { e += (a[i] - b[i]) ** 2; s += a[i] ** 2; } return 10 * Math.log10(s / e); };

test("DSP-ADPCM encodes and decodes with little error", () => {
  const pcm = tone(32000, 440);
  const coefs = dspCoefficients(pcm);
  expect(coefs.length).toBe(16);
  const frames = encodeDSP(pcm, coefs);
  expect(frames.length).toBe(Math.ceil(pcm.length / 14) * 8);
  expect(snr(pcm, decodeDSP(frames, 0, pcm.length, coefs))).toBeGreaterThan(30);
});

test("a BRSTM written with tracks, loop and several blocks reads back", () => {
  const n = 0x3800 * 2 + 1000; // two full blocks and a short last one
  const channels = [tone(n, 300), tone(n, 500), tone(n, 700), tone(n, 900)];
  const tracks = [{ volume: 120, pan: 64, channels: [0, 1] }, { volume: 100, pan: 64, channels: [2, 3] }];
  const s = parseBRSTM(buildBRSTM({ channels, sampleRate: 32000, loop: true, loopStart: 5000, tracks }));
  expect([s.channels, s.samples, s.blocks, s.loop, s.loopStart, s.sampleRate]).toEqual([4, n, 3, true, 5000, 32000]);
  expect(s.tracks.map((t: any) => t.channels)).toEqual([[0, 1], [2, 3]]);
  const pcm = decodeBRSTM(s);
  pcm.forEach((ch: Int16Array, c: number) => expect(snr(channels[c], ch)).toBeGreaterThan(28));
  // The loop context is the decoder state just before the loop start.
  expect([s.channelInfo[0].loopH1, s.channelInfo[0].loopH2]).toEqual([pcm[0][4999], pcm[0][4998]]);
});

test("loop start can change across blocks without re-encoding audio", () => {
  const channels = [new Int16Array(36000), new Int16Array(36000)];
  channels.forEach((channel, c) => channel.forEach((_, i) => { channel[i] = Math.round(Math.sin(i * 0.03 + c) * 12000); }));
  const original = buildBRSTM({ channels, sampleRate: 32000, loop: true, loopStart: 100 });
  const decoded = decodeBRSTM(parseBRSTM(original));
  const updated = setBRSTMLoop(original, false, 18005);
  const changed = parseBRSTM(updated);
  expect([changed.loop, changed.loopStart, changed.samples, changed.tracks.length]).toEqual([false, 18005, 36000, 1]);
  expect([changed.channelInfo[0].loopH1, changed.channelInfo[0].loopH2]).toEqual([decoded[0][18004], decoded[0][18003]]);
  expect(Array.from(updated.subarray(changed.dataOffset))).toEqual(Array.from(original.subarray(changed.dataOffset)));
  const enabled = parseBRSTM(setBRSTMLoop(updated, true, 0));
  expect([enabled.loop, enabled.loopStart, enabled.channelInfo[0].loopH1, enabled.channelInfo[0].loopH2]).toEqual([true, 0, 0, 0]);
  expect(() => setBRSTMLoop(original, true, 36000)).toThrow();
});

test("a native music track exports without the other tracks", () => {
  const channels = [tone(1000, 300), tone(1000, 500), tone(1000, 700), tone(1000, 900)];
  const clip = { channels, sampleRate: 32000, loop: true, loopStart: 100, tracks: [
    { volume: 127, pan: 64, channels: [0, 1] }, { volume: 90, pan: 64, channels: [2, 3] },
  ] };
  const part = isolateTrack(clip, 1);
  expect(part.channels).toEqual([channels[2], channels[3]]);
  expect(part.tracks).toEqual([{ volume: 90, pan: 64, channels: [0, 1] }]);
  const file = parseBRSTM(buildBRSTM(part));
  expect([file.channels, file.tracks.length, file.loop, file.loopStart]).toEqual([2, 1, true, 100]);
  decodeBRSTM(file).forEach((ch: Int16Array, i: number) => expect(snr(channels[i + 2], ch)).toBeGreaterThan(28));
  expect(() => isolateTrack(clip, 2)).toThrow(RangeError);
});

test("WAV and FLAC exports have valid headers", () => {
  const ch = [tone(10000, 440), tone(10000, 660)];
  const wav = encodeWAV(ch, 32000);
  expect(String.fromCharCode(...wav.subarray(0, 4), ...wav.subarray(8, 12))).toBe("RIFFWAVE");
  expect(wav.length).toBe(44 + 10000 * 4);
  const flac = encodeFLAC(ch, 32000);
  expect(String.fromCharCode(...flac.subarray(0, 4))).toBe("fLaC");
  expect(flac.length).toBeLessThan(wav.length); // smaller, still lossless
  const v = new DataView(flac.buffer, flac.byteOffset);
  expect(v.getUint32(18) >>> 12).toBe(32000); // STREAMINFO sample rate
});

test("music streams get readable names", () => {
  expect(musicLabel("n_Farm_F.brstm")).toBe("Moo Moo Meadows · final lap");
  expect(musicLabel("STRM_N_RIDGEHIGHWAY_N.brstm")).toBe("Moonview Highway · normal");
  expect(musicLabel("r_64_Sherbet32_n.brstm")).toBe("N64 Sherbet Land · normal");
  expect(musicLabel("o_Option_32.brstm")).toBe("Menus");
});
