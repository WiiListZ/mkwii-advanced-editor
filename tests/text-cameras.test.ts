// Game text (BMG) round trip and KMP camera logic.
import { expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isYaz0, yaz0Decompress } from "../web/js/formats/yaz0.js";
import { listFiles, parseU8 } from "../web/js/formats/u8.js";
import { buildBMG, messagePlace, messageScene, parseBMG } from "../web/js/formats/bmg.js";
import { introChain, introTimeline, selectionIndex, setCameraHeader, simulateCamera } from "../web/js/editor/cameras.js";

const ui = process.env.MKWII_GAME_DIR ? join(process.env.MKWII_GAME_DIR, "Scene/UI") : "";

test.skipIf(!ui || !existsSync(ui))("every English BMG survives an edit, escape codes included", async () => {
  let checked = 0;
  for (const f of readdirSync(ui).filter((x) => x.endsWith("_E.szs"))) {
    let data = new Uint8Array(await Bun.file(join(ui, f)).arrayBuffer());
    if (isYaz0(data)) data = yaz0Decompress(data);
    for (const file of listFiles(parseU8(data)).filter((x: any) => x.path.endsWith(".bmg"))) {
      const bmg = parseBMG(file.node.data);
      expect(buildBMG(bmg, {})).toBe(file.node.data); // unchanged text keeps the file as it was
      const target = bmg.messages.find((m: any) => m.text.includes("{1A:")) || bmg.messages[1];
      const again = parseBMG(buildBMG(bmg, { [target.id]: target.text + " edited" }));
      expect(again.messages.map((m: any) => m.id)).toEqual(bmg.messages.map((m: any) => m.id));
      for (const [i, m] of again.messages.entries()) {
        expect(m.text).toBe(m.id === target.id ? target.text + " edited" : bmg.messages[i].text);
        expect([...m.attributes]).toEqual([...bmg.messages[i].attributes]);
      }
      checked++;
    }
  }
  expect(checked).toBeGreaterThan(5);
});

test("message places come from the file and the ID", () => {
  expect(messagePlace("Common", 0x2454)).toBe("Track name");
  expect(messagePlace("Common", 0x2328)).toBe("Character name");
  expect(messagePlace("Menu", 0x1234)).toBe("Menus");
});

test("context previews are limited to menu messages with known placements", () => {
  expect(messageScene("Common", 0x2328)).toBe("character");
  expect(messageScene("Common", 0x2382)).toBe("vehicle");
  expect(messageScene("Common", 0x23f0)).toBe("cup");
  expect(messageScene("Common", 0x2454)).toBe("track");
  expect(messageScene("Common", 0x24b8)).toBe("arena");
  expect(messageScene("Race", 0x2454)).toBeNull();
  expect(messageScene("Common", 0x2600)).toBeNull();
});

const cam = (extra: any) => ({ uid: Math.random(), type: 5, next: 0xff, shake: 0, route: 0xff, pointSpeed: 0, zoomSpeed: 0, viewSpeed: 0, start: 0, movie: 0, pos: [0, 0, 0], rot: [0, 0, 0], zoomStart: 40, zoomEnd: 40, viewStart: [0, 0, 0], viewEnd: [0, 0, 0], time: 60, ...extra });

test("intro chain follows the header and the next links, and stops at loops", () => {
  const kmp: any = { extras: {}, KTPT: [], ENPT: [], POTI: [], CAME: [cam({ next: 2 }), cam({}), cam({ next: 0 })] };
  setCameraHeader(kmp, 0, 1);
  expect(introChain(kmp)).toEqual([0, 2]);
  expect(selectionIndex(kmp)).toBe(1);
  expect(introTimeline(kmp).total).toBe(120);
});

test("opening cameras move along their route at the point speeds and turn toward the look-at end", () => {
  const route = { smooth: 0, loop: 0, points: [{ pos: [0, 0, 0], setting1: 10, setting2: 0 }, { pos: [1000, 0, 0], setting1: 10, setting2: 0 }] };
  const kmp: any = { extras: {}, KTPT: [], ENPT: [], POTI: [route], CAME: [cam({ route: 0, time: 50, viewStart: [0, 0, 100], viewEnd: [0, 0, 300], viewSpeed: 200, zoomStart: 40, zoomEnd: 50, zoomSpeed: 10 })] };
  const poses = simulateCamera(kmp, 0);
  expect(poses).toHaveLength(50);
  expect(poses[0].position[0]).toBeCloseTo(0);
  expect(poses[10].position[0]).toBeCloseTo(100); // 10 units per frame
  expect(poses[10].target[2]).toBeCloseTo(120); // 2 units per frame (viewSpeed 200 / 100)
  expect(poses[49].target[2]).toBeCloseTo(198);
  expect(poses[10].fov).toBeCloseTo(41); // 0.1 degree per frame
});
