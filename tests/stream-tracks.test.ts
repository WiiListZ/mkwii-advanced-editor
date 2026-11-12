import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-ignore Shared editor code used by the frontend.
import { replaceTrack, withoutTrack, withTrack, withTrackMix } from "../web/js/editor/stream-tracks.js";
// @ts-ignore Shared editor code used by the frontend.
import { mixTracks, panGains } from "../web/js/editor/audio.js";
// @ts-ignore Shared data used by the frontend.
import { MAX_CHANNELS, MAX_TRACKS, musicTriggers, trackPlays } from "../web/js/data/music-tracks.js";
// @ts-ignore Shared Wii format readers used by the frontend.
import { buildBRSTM, decodeBRSTM, parseBRSTM, setBRSTMTrackMix } from "../web/js/formats/brstm.js";
// @ts-ignore Shared Wii format readers used by the frontend.
import { parseBRSAR, setStreamRoom, streamSound, streamTrackCount } from "../web/js/formats/brsar.js";

const game = process.env.MKWII_GAME_DIR;
const tone = (length: number, value: number) => Int16Array.from({ length }, (_, i) => (i % 2 ? value : -value));
const stereo = (length: number, value: number) => ({ sampleRate: 32000, loop: true, loopStart: 100, channels: [tone(length, value), tone(length, value + 1)], tracks: [{ volume: 127, pan: 64, channels: [0, 1] }], trackType: 1 });

test("a music's tracks can be added, replaced, mixed and taken out, and stay in the file so", () => {
  const one = stereo(3000, 1000);
  // Added: its two channels after the others, cut or padded to the music's length.
  const two = withTrack(one, [tone(5000, 2000), tone(5000, 3000)], { volume: 90 });
  expect(two.channels.length).toBe(4);
  expect(two.tracks).toEqual([{ volume: 127, pan: 64, channels: [0, 1] }, { volume: 90, pan: 64, channels: [2, 3] }]);
  expect(two.channels[2].length).toBe(3000);
  const three = withTrack(two, [tone(100, 4000)]);
  expect(three.channels[4].length).toBe(3000);
  expect([three.channels[4][99], three.channels[4][100], three.channels[5][1]]).toEqual([4000, 0, 4000]); // mono on both sides, then silence
  // Replaced: only that track's channels.
  const replaced = replaceTrack(three, 1, [tone(3000, 7000), tone(3000, 7001)]);
  expect([replaced.channels[0][1], replaced.channels[2][1], replaced.channels[3][1], replaced.channels[4][1]]).toEqual([1000, 7000, 7001, 4000]);
  // Mixed, within the file's 0-127.
  expect(withTrackMix(replaced, 2, { volume: 300, pan: -5 }).tracks[2]).toMatchObject({ volume: 127, pan: 0 });
  // Taken out: the others keep their audio, with their channels counted again.
  const back = withoutTrack(replaced, 1);
  expect(back.tracks.map((t: any) => t.channels)).toEqual([[0, 1], [2, 3]]);
  expect([back.channels[0][1], back.channels[2][1]]).toEqual([1000, 4000]);
  expect(() => withoutTrack(one, 0)).toThrow();
  // Written and read back: the same tracks, volumes, pans and loop.
  const file = parseBRSTM(buildBRSTM({ channels: replaced.channels, sampleRate: 32000, loop: true, loopStart: 100, tracks: replaced.tracks, trackType: 1 }));
  expect(file.tracks).toEqual(replaced.tracks);
  expect(file.loopStart).toBe(100);
  expect(decodeBRSTM(file).length).toBe(6);
  // Volume and pan changed in place: the audio is the same bytes.
  const bytes = buildBRSTM({ channels: replaced.channels, sampleRate: 32000, loop: true, loopStart: 100, tracks: replaced.tracks, trackType: 1 });
  const mixed = setBRSTMTrackMix(bytes, 2, 40, 100);
  expect(parseBRSTM(mixed).tracks[2]).toMatchObject({ volume: 40, pan: 100 });
  expect(parseBRSTM(mixed).tracks[0]).toEqual(replaced.tracks[0]);
  expect([...mixed].filter((b: number, i: number) => b !== bytes[i]).length).toBe(2);
  expect(() => setBRSTMTrackMix(bytes, 9, 1, 1)).toThrow();
});

test("each music says when its tracks play, as the game's Sound Triggers do", () => {
  expect(musicTriggers("n_Circuit32_n.brstm")).toBeNull();
  expect(trackPlays("n_Circuit32_n.brstm", 1)).toMatchObject({ always: true });
  // Koopa Cape: underwater on variant 3, riverside on 6, the fourth track with the normal and riverside music.
  expect(musicTriggers("C:\\game\\sound\\strm\\STRM_N_WATER_F.brstm")!.course).toBe("Koopa Cape");
  expect(trackPlays("STRM_N_WATER_N.brstm", 2).variants.map((v: any) => v.variant)).toEqual([3]);
  expect(trackPlays("STRM_N_WATER_N.brstm", 1).variants.map((v: any) => v.variant)).toEqual([6]);
  expect(trackPlays("STRM_N_WATER_N.brstm", 3).variants.map((v: any) => v.variant)).toEqual([0, 1, 5, 6]);
  // Dry Dry Ruins changes music, but which track each change plays is not documented: not made up.
  const ruins = trackPlays("STRM_N_DESERT_N.brstm", 1);
  expect(ruins.variants).toEqual([]);
  expect(ruins.unsaid.length).toBe(4);
  expect([MAX_TRACKS, MAX_CHANNELS]).toEqual([4, 8]);
});

test.skipIf(!game || !existsSync(join(game || "", "sound", "revo_kart.brsar")))("the game sets aside room for each music, and that room can be made larger", () => {
  const archive = parseBRSAR(new Uint8Array(readFileSync(join(game!, "sound", "revo_kart.brsar"))));
  const room = (file: string) => { const s = streamSound(archive, file)!; return [s.name, s.stream.channels, streamTrackCount(s.stream)]; };
  expect(room("STRM_N_WATER_N.brstm")).toEqual(["STRM_N_WATER_N", 8, 4]);
  expect(room("strm/STRM_N_KOOPA_F.brstm")).toEqual(["STRM_N_KOOPA_F", 6, 3]);
  expect(room("n_Circuit32_n.brstm")).toEqual(["STRM_N_CIRCUIT1_N", 2, 1]);
  expect(streamSound(archive, "nothing.brstm")).toBeNull();
  // Two more tracks for Luigi Circuit's music: only its two numbers change.
  const sound = streamSound(archive, "n_Circuit32_n.brstm");
  const larger = setStreamRoom(archive, sound, 6, 3);
  expect([streamSound(larger, "n_Circuit32_n.brstm").stream.channels, streamTrackCount(streamSound(larger, "n_Circuit32_n.brstm").stream)]).toEqual([6, 3]);
  const changed = [...larger.data].map((b: number, i: number) => b !== archive.data[i] ? i : -1).filter((i: number) => i >= 0);
  expect(changed.every((i: number) => i >= sound.stream.at + 4 && i < sound.stream.at + 8)).toBe(true);
  expect(larger.data.length).toBe(archive.data.length);
  expect(room("STRM_N_WATER_N.brstm")).toEqual(["STRM_N_WATER_N", 8, 4]); // the original is left as it was
});

test("the preview places each track as the game does: volume, and pan with its channels' own sides", () => {
  // In the middle a stereo track stays as it is: its left only on the left, its right only on the right.
  expect(panGains(64, 0, 2)).toEqual([1, 0]);
  expect(panGains(64, 1, 2)).toEqual([0, 1]);
  // Panned right: part of its left side moves to the right; its right side stays right.
  const [l, r] = panGains(96, 0, 2);
  const x = -1 + 32 / 63; // its left side's place, moved half way right
  expect(l).toBeCloseTo(Math.sqrt((1 - x) / 2), 6);
  expect(r).toBeCloseTo(Math.sqrt((1 + x) / 2), 6);
  expect(l * l + r * r).toBeCloseTo(1, 5); // the same power, placed elsewhere
  expect(panGains(96, 1, 2)).toEqual([0, 1]);
  // All the way: the other side's channel reaches the middle (the track's pan is added to each side's
  // place, as the game does). A single channel sits in the middle until panned.
  expect(panGains(127, 0, 2)[0]).toBeCloseTo(Math.SQRT1_2, 5);
  expect(panGains(127, 0, 2)[1]).toBeCloseTo(Math.SQRT1_2, 5);
  expect(panGains(0, 1, 2)[1]).toBeCloseTo(Math.SQRT1_2, 5);
  expect(panGains(127, 0, 1)).toEqual([0, 1]);
  expect(panGains(64, 0, 1)[0]).toBeCloseTo(Math.SQRT1_2, 5);
  // The mix: a track panned all the way left is heard only on the left, at its volume.
  const left = Int16Array.from({ length: 4 }, () => 16384), right = Int16Array.from({ length: 4 }, () => 8192);
  const clip = { sampleRate: 32000, channels: [left, right], tracks: [{ volume: 127, pan: 0, channels: [0, 1] }] };
  const [ml, mr] = mixTracks(clip);
  expect(ml[0]).toBeCloseTo(0.5 + 0.25 * Math.SQRT1_2, 3); // its left on the left, its right moved to the middle
  expect(mr[0]).toBeCloseTo(0.25 * Math.SQRT1_2, 3);
  const half = mixTracks({ ...clip, tracks: [{ volume: 64, pan: 64, channels: [0, 1] }] });
  expect(half[0][0]).toBeCloseTo(0.5 * 64 / 127, 3);
  expect(half[1][0]).toBeCloseTo(0.25 * 64 / 127, 3);
});
