import { expect, test } from "bun:test";
import { audioSpecificConfig, encodeAIFF, encodeMP3, mp3Rate, muxM4A } from "../web/js/editor/audio-export.js";

const tone = (frames: number, rate: number) => Int16Array.from({ length: frames }, (_, i) => Math.round(Math.sin((i / rate) * 440 * Math.PI * 2) * 12000));

test("MP3: frames with sync words at the game's sample rate", () => {
  const left = tone(32000, 32000), right = tone(32000, 32000);
  const mp3 = encodeMP3([left, right], 32000, 192);
  expect(mp3.length).toBeGreaterThan(20000);
  expect(mp3[0]).toBe(0xff);
  expect(mp3[1] & 0xe0).toBe(0xe0); // frame sync
  expect(encodeMP3([left], 32000, 128).length).toBeGreaterThan(1000); // mono
  expect(() => encodeMP3([left], 32728)).toThrow();
  expect(mp3Rate(32000)).toBe(32000);
  expect(mp3Rate(32728)).toBe(44100);
  expect(mp3Rate(96000)).toBe(48000);
});

test("AIFF: header, 80-bit sample rate and big-endian samples", () => {
  const data = encodeAIFF([Int16Array.of(1, -2), Int16Array.of(3, 4)], 32000);
  const v = new DataView(data.buffer);
  expect(new TextDecoder().decode(data.subarray(0, 4))).toBe("FORM");
  expect(new TextDecoder().decode(data.subarray(8, 12))).toBe("AIFF");
  expect(v.getUint16(20)).toBe(2); // channels
  expect(v.getUint32(22)).toBe(2); // frames
  // 32000 = 1.953125 × 2^14
  expect(v.getUint16(28)).toBe(16383 + 14);
  expect(Number(v.getBigUint64(30) >> 48n)).toBe(32000 << 1);
  expect([v.getInt16(54), v.getInt16(56), v.getInt16(58), v.getInt16(60)]).toEqual([1, 3, -2, 4]);
  expect(v.getUint32(4)).toBe(data.length - 8);
});

test("M4A: boxes point at the AAC frames", () => {
  const frames = [Uint8Array.of(1, 2, 3), Uint8Array.of(4, 5)];
  const m4a = muxM4A(frames, { sampleRate: 48000, channels: 2, config: audioSpecificConfig(48000, 2), bitrate: 192000 });
  const text = new TextDecoder("latin1").decode(m4a);
  for (const type of ["ftyp", "moov", "mvhd", "trak", "mdia", "stsd", "mp4a", "esds", "stsz", "stco", "mdat"]) expect(text).toContain(type);
  const v = new DataView(m4a.buffer);
  const stco = text.indexOf("stco");
  const offset = v.getUint32(stco + 12);
  expect([...m4a.subarray(offset, offset + 5)]).toEqual([1, 2, 3, 4, 5]);
  expect(audioSpecificConfig(48000, 2)).toEqual(Uint8Array.of(0x11, 0x90));
});
