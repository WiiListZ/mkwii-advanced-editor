import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { THP_LAYOUTS, buildTHP, jpegToTHPFrame, parseTHP, thpFrameToJPEG, thpLayout, thpVideoData } from "../web/js/formats/thp.js";

// A minimal baseline JPEG header (SOF0 16×16, 4:2:0) around some scan data.
function jpeg(scan: number[], stuffed: boolean) {
  const sof = [0xff, 0xc0, 0, 17, 8, 0, 16, 0, 16, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  const sos = [0xff, 0xda, 0, 12, 3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0];
  const data = stuffed ? scan.flatMap((b) => (b === 0xff ? [0xff, 0] : [b])) : scan;
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 1, 2, ...sof, ...sos, ...data, 0xff, 0xd9]);
}

// A THP with one video component and the given frames.
function movie(frames: Uint8Array[]) {
  const head = new Uint8Array(0x50), v = new DataView(head.buffer);
  head.set([0x54, 0x48, 0x50, 0]);
  v.setUint32(4, 0x11000); v.setFloat32(0x10, 59.94); v.setUint32(0x14, frames.length);
  v.setUint32(0x20, 0x30); v.setUint32(0x28, 0x50);
  v.setUint32(0x30, 1); head.fill(0xff, 0x35, 0x44); head[0x34] = 0;
  v.setUint32(0x44, 16); v.setUint32(0x48, 16);
  const seed = parseTHPShell(head, frames.length);
  return buildTHP(seed, frames);
}
// parseTHP needs real frames; for the first build the frame list is made by hand.
function parseTHPShell(head: Uint8Array, count: number) {
  return { data: head, header: { firstFrameOffset: 0x50 }, types: [0], frames: Array.from({ length: count }, () => ({ parts: [[0, 0]] })) } as any;
}

describe("THP", () => {
  test("frames convert between THP and standard JPEG", () => {
    const scan = [1, 0xff, 2, 0xff, 0xff, 3];
    const thp = jpegToTHPFrame(jpeg(scan, true), 16, 16);
    expect(thp.length % 4).toBe(0);
    expect(thp.includes(0xe0)).toBe(false); // APP0 left out
    const back = thpFrameToJPEG(thp);
    expect(back.subarray(back.length - 2)).toEqual(Uint8Array.of(0xff, 0xd9));
    expect(jpegToTHPFrame(back, 16, 16)).toEqual(thp);
    expect(() => jpegToTHPFrame(jpeg(scan, true), 32, 16)).toThrow();
  });

  test("a rebuilt movie keeps its frames and sizes", () => {
    const a = jpegToTHPFrame(jpeg([1, 2, 3], true), 16, 16), b = jpegToTHPFrame(jpeg([4, 0xff, 5, 6, 7, 8, 9], true), 16, 16);
    const data = movie([a, b]);
    const parsed = parseTHP(data);
    expect(parsed.video).toEqual({ width: 16, height: 16, type: 0 });
    expect(parsed.frames.length).toBe(2);
    expect(thpVideoData(parsed, 1)).toEqual(b);
    expect(buildTHP(parsed, [])).toEqual(data);
    const v = new DataView(data.buffer);
    expect(v.getUint32(8)).toBe(Math.max(...parsed.frames.map((f: any) => f.size)));
    expect(parsed.frames.every((f: any) => f.size % 32 === 0)).toBe(true);
    // The first frame's "previous" size is the last frame: the movie loops.
    expect(v.getUint32(0x50 + 4)).toBe(parsed.frames[1].size);
  });

  test("layouts name the track previews of every cup", () => {
    expect(thpLayout("C:\\game\\files\\thp\\course\\kinoko.thp")?.regions.map((r: any) => r.slot)).toEqual([0x08, 0x01, 0x02, 0x04]);
    const cups = Object.values(THP_LAYOUTS).filter((l: any) => l.cup !== undefined).map((l: any) => l.cup).sort((a, b) => a - b);
    expect(cups).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  const game = process.env.MKWII_GAME_DIR;
  test.skipIf(!game || !existsSync(join(game || "", "thp", "course", "kinoko.thp")))("every THP of the game rebuilds byte for byte", () => {
    for (const file of ["course/kinoko.thp", "course/cup_select.thp", "battle/battle_wii.thp", "title/top_menu.thp"]) {
      const data = new Uint8Array(readFileSync(join(game!, "thp", ...file.split("/"))));
      const parsed = parseTHP(data);
      expect(buildTHP(parsed, [])).toEqual(data);
      const frame = thpVideoData(parsed, 0);
      expect(jpegToTHPFrame(thpFrameToJPEG(frame), parsed.video.width, parsed.video.height)).toEqual(frame);
    }
  });
});
