// Exercises the separate minimap editor against a real extracted track without changing game files.
// Usage: MKWII_GAME_DIR=<game>/files bun run tests/minimap.smoke.ts
import puppeteer from "puppeteer-core";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

const game = process.env.MKWII_GAME_DIR;
if (!game || !existsSync(join(game, "Race", "Common.szs"))) {
  console.log("MKWII_GAME_DIR not set (or no Race/Common.szs): skipped");
  process.exit(0);
}
const temp = mkdtempSync(join(tmpdir(), "mkwii-minimap-"));
await Bun.write(join(temp, "settings.json"), JSON.stringify({ tourDone: true, discordActivity: false }));
const worker = new Worker(new URL("../src/server.ts", import.meta.url).href);
let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
try {
  const port: number = await new Promise((res, rej) => {
    worker.onmessage = (e) => { if (e.data?.type === "ready") res(e.data.port); if (e.data?.type === "error") rej(new Error(e.data.message)); };
    worker.postMessage({ type: "start", token: "minimap-smoke", settingsDir: temp });
  });
  browser = await puppeteer.launch({
    executablePath: process.env.MKWII_TEST_BROWSER || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1600,950"],
  });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => { errors.push(String(error)); console.error("Browser error:", error); });
  await page.setViewport({ width: 1600, height: 950 });
  await page.goto(`http://127.0.0.1:${port}/?t=minimap-smoke`, { waitUntil: "networkidle0" });
  await page.evaluate(async (common, track) => {
    const app = (window as any).app;
    await app.loadCommonFrom(common, true);
    await app.openPath(track);
  }, join(game, "Race", "Common.szs"), join(game, "Race", "Course", "castle_course.szs"));

  const open = async () => {
    await page.evaluate(() => { (window as any).app.cmd("minimap"); }); // stays pending until the window closes
    await page.waitForFunction(() => document.querySelector('[data-minimap]')?.getAttribute("data-fitted") === "true");
    // The opening animation scales the window: positions on screen are only right after it.
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]')?.getAnimations({ subtree: true }).some((item) => item.playState === "running"));
  };
  const closed = () => page.waitForFunction(() => !document.querySelector("[data-minimap]"));
  const shot = process.env.MKWII_MINIMAP_SCREENSHOT;
  const fileBytes = () => page.evaluate(() => Array.from((window as any).app.minimapResource().data as Uint8Array));
  const same = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);
  const label = () => page.evaluate(() => (window as any).app.doc.undoStack.at(-1)?.label);
  const clickButton = (text: string) => page.evaluate((t) => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button, [data-radix-popper-content-wrapper] button')].find((b) => b.textContent?.trim() === t)?.click(), text);
  const enabled = (text: string, on: boolean) => page.waitForFunction((t, v) => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent?.trim() === t)?.disabled === !v, {}, text, on);
  const swatches = () => page.evaluate(() => document.querySelectorAll('button[aria-label^="Colour "]').length);
  const inGame = () => page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('canvas[aria-label="Minimap in game"]')!, d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let light = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 120) light++;
    return light;
  });
  const setColour = (hex: string) => page.evaluate((h) => {
    const input = document.querySelector<HTMLInputElement>('[aria-label="Selected colour"]')!;
    input.value = h;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, hex);
  const worldPoint = (x: number, z: number) => page.evaluate((px, pz) => {
    const map = document.querySelector<HTMLElement>("[data-minimap]")!, rect = map.getBoundingClientRect(), s = Number(map.dataset.scale);
    return { x: rect.left + rect.width / 2 + (px - Number(map.dataset.centerX)) * s, y: rect.top + rect.height / 2 + (pz - Number(map.dataset.centerZ)) * s };
  }, x, z);
  // Light pixels are the map; the track beneath it and the background are dark.
  const mapped = (at: { x: number; y: number }, within: number | null = null) => page.evaluate((point, radius) => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[aria-label="Minimap design"]')!, rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width, cx = (point.x - rect.left) * scale, cy = (point.y - rect.top) * scale;
    const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let light = 0;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      if (radius !== null && Math.hypot(x - cx, y - cy) > radius * scale) continue;
      const i = (y * canvas.width + x) * 4;
      if (data[i] > 120 && data[i + 1] > 120 && data[i + 2] > 120) light++;
    }
    return light;
  }, at, within);
  const gate = await page.evaluate(() => {
    const p = (window as any).app.doc.kmp.CKPT[0].points[0];
    return { x: (p.left[0] + p.right[0]) / 2, z: (p.left[1] + p.right[1]) / 2 };
  });

  await open();
  if (shot) await page.screenshot({ path: `${shot}-open.png` });
  const original = await fileBytes();
  if (!(await inGame() > 100)) throw new Error("The in-game preview shows no map");
  await enabled("Apply", false);

  // A colour changes nothing until Apply, steps back with Ctrl+Z, then patches the file in place.
  await setColour("#336699");
  await enabled("Apply", true);
  if (!same(await fileBytes(), original)) throw new Error("Changing a colour wrote the file before Apply");
  await page.keyboard.down("Control"); await page.keyboard.press("z"); await page.keyboard.up("Control");
  await enabled("Apply", false);
  await setColour("#336699");
  await enabled("Apply", true);
  await clickButton("Apply");
  await closed();
  const recoloured = await fileBytes();
  if (recoloured.length !== original.length || same(recoloured, original) || await label() !== "Edit minimap") throw new Error("Apply did not patch the colour in place");
  await page.evaluate(() => (window as any).app.cmd("undo"));
  if (!same(await fileBytes(), original)) throw new Error("Undo in the main window did not restore the minimap");
  console.log("ok  colour staged, stepped back, applied in place and undone");

  // New from track fills the drawing and can be stepped back; item boxes stay off unless chosen.
  await open();
  const fileColours = await swatches();
  await clickButton("New from track…");
  await page.waitForSelector('[aria-label="Include Item boxes"]');
  const defaults = await page.evaluate(() => ["Item boxes", "Objects"].map((name) => document.querySelector<HTMLInputElement>(`[aria-label="Include ${name}"]`)!.checked));
  if (defaults.some(Boolean)) throw new Error(`Elements on by default: ${defaults}`);
  await page.click('[aria-label="Include Item boxes"]');
  if (shot) await page.screenshot({ path: `${shot}-new.png` });
  await clickButton("Create");
  await page.waitForFunction(() => document.querySelectorAll('button[aria-label^="Colour "]').length === 2);
  if (!same(await fileBytes(), original)) throw new Error("New from track wrote the file before Apply");
  if (shot) await page.screenshot({ path: `${shot}-generated.png` });
  await page.click('button[aria-label="Undo"]');
  await page.waitForFunction((n) => document.querySelectorAll('button[aria-label^="Colour "]').length === n, {}, fileColours);
  await enabled("Apply", false);
  console.log("ok  new from track, with item boxes off by default, stepped back");

  // Road only is one click: one colour, nothing written until Apply.
  await clickButton("New from track…");
  await page.waitForSelector('[aria-label="Include Item boxes"]');
  await clickButton("Road only");
  await page.waitForFunction(() => document.querySelectorAll('button[aria-label^="Colour "]').length === 1);
  await enabled("Apply", true);
  if (shot) await page.screenshot({ path: `${shot}-road.png` });
  await page.click('button[aria-label="Undo"]');
  await enabled("Apply", false);
  console.log("ok  road only in one click, stepped back");

  // Erasing clears under the brush and leaves the rest, and Apply keeps the map's size.
  await clickButton("Fit view");
  const point = await worldPoint(gate.x, gate.z);
  const near = { x: point.x, y: point.y };
  await clickButton("Erase");
  const before = await mapped(near), spot = await mapped(near, 5);
  await page.mouse.click(near.x, near.y);
  await enabled("Apply", true);
  if (spot > 40 && await mapped(near, 5) !== 0) throw new Error("Erase left the map under the brush");
  if (await mapped(near) < before * .95) throw new Error("A small erase changed too much of the map");
  await page.click('button[aria-label="Undo"]');
  await enabled("Apply", false);
  await page.mouse.click(near.x, near.y);
  await enabled("Apply", true);
  if (shot) await page.screenshot({ path: `${shot}-painted.png` });
  await clickButton("Apply");
  await page.waitForFunction(() => !document.querySelector("[data-minimap]"), { timeout: 120000 });
  if (await label() !== "Edit minimap") throw new Error("Apply did not rebuild the minimap");
  console.log("ok  erase stepped back and applied by rebuilding the minimap");

  // Dragging a corner of the frame is applied to the position bones.
  await open();
  await clickButton("Frame");
  await page.waitForSelector('[aria-label="Frame Left X"]');
  const frame = await page.evaluate(() => {
    const value = (name: string) => Number(document.querySelector<HTMLInputElement>(`[aria-label="Frame ${name}"]`)!.value);
    return { left: value("Left X"), top: value("Top Z") };
  });
  const corner = await worldPoint(frame.left, frame.top);
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(corner.x - 30, corner.y, { steps: 4 });
  await page.mouse.up();
  await enabled("Apply", true);
  await new Promise((done) => setTimeout(done, 200)); // the last move renders after the release
  const movedTo = await page.evaluate(() => Number(document.querySelector<HTMLInputElement>('[aria-label="Frame Left X"]')!.value));
  if (!(movedTo < frame.left - 100)) throw new Error(`Dragging the frame corner did not move it: ${frame.left} -> ${movedTo}`);
  await clickButton("Apply");
  await closed();
  await open();
  await clickButton("Frame");
  await page.waitForSelector('[aria-label="Frame Left X"]');
  const kept = await page.evaluate(() => Number(document.querySelector<HTMLInputElement>('[aria-label="Frame Left X"]')!.value));
  if (Math.abs(kept - movedTo) > 1) throw new Error(`The frame was not applied: ${movedTo} -> ${kept}`);
  await clickButton("Cancel");
  await closed();
  console.log("ok  frame corner drag applied");

  // Everything is kept in the saved archive, written only to the temporary folder.
  const saved = join(temp, "map-edited.szs");
  const expected = await fileBytes();
  await page.evaluate(async (path) => {
    const app = (window as any).app;
    app.doc.filePath = path;
    app.doc.fileKind = "szs";
    await app.save(false);
    await app.openPath(path);
  }, saved);
  if (!same(await fileBytes(), expected)) throw new Error("The minimap did not survive save and reopen");
  console.log("ok  minimap kept after temporary SZS save/reopen");

  // On an arena one collision part is the whole floor: a small stroke must still stay small,
  // and leaving with it asks first.
  await page.evaluate(async (path) => { await (window as any).app.openPath(path); }, join(game, "Race", "Course", "old_battle4_sfc.szs"));
  await page.waitForFunction(() => /battle4/.test((window as any).app.doc.fileName));
  await open();
  await clickButton("Erase");
  const floor = await page.evaluate(() => {
    const rect = document.querySelector<HTMLCanvasElement>('canvas[aria-label="Minimap design"]')!.getBoundingClientRect();
    return { x: rect.left + rect.width * .42, y: rect.top + rect.height * .42 };
  });
  const lightBefore = await mapped(floor), spotBefore = await mapped(floor, 5);
  await page.mouse.click(floor.x, floor.y);
  await enabled("Apply", true);
  const lightAfter = await mapped(floor), spotAfter = await mapped(floor, 5);
  if (shot) await page.screenshot({ path: `${shot}-arena.png` });
  // Smooth edges rounds the stroke, as one step back, without closing it.
  await page.mouse.move(floor.x - 60, floor.y + 110);
  await page.mouse.down();
  await page.mouse.move(floor.x + 90, floor.y + 170, { steps: 12 });
  await page.mouse.up();
  const clip = { x: floor.x - 90, y: floor.y + 70, width: 220, height: 140 };
  if (shot) await page.screenshot({ path: `${shot}-stroke.png`, clip });
  await clickButton("Smooth edges");
  await page.waitForFunction(() => document.querySelector<HTMLButtonElement>('button[aria-label="Undo"]')?.disabled === false);
  await new Promise((done) => setTimeout(done, 200));
  if (shot) await page.screenshot({ path: `${shot}-smoothed.png`, clip });
  if (await mapped(floor, 5) !== 0) throw new Error("Smooth edges closed the erased spot");
  // The slider shows its effect at once, and is one step back in all.
  const pixelsAt = () => page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('canvas[aria-label="Minimap design"]')!, d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum = (sum * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) % 1000000007;
    return sum;
  });
  const setSmoothness = (level: number) => page.evaluate((value) => {
    const input = document.querySelector<HTMLInputElement>('[aria-label="Smoothness"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, String(value));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, level);
  const atDefault = await pixelsAt();
  await setSmoothness(10);
  await new Promise((done) => setTimeout(done, 200));
  if (await pixelsAt() === atDefault) throw new Error("The smoothness slider changed nothing");
  if (shot) await page.screenshot({ path: `${shot}-smoothed-max.png`, clip });
  await setSmoothness(1);
  await new Promise((done) => setTimeout(done, 200));
  if (shot) await page.screenshot({ path: `${shot}-smoothed-min.png`, clip });
  await setSmoothness(6);
  await new Promise((done) => setTimeout(done, 200));
  if (await pixelsAt() !== atDefault) throw new Error("Going back to the same smoothness did not give the same result");

  // Smooth on release is off until chosen, and joins the stroke's own step back.
  if (await page.evaluate(() => document.querySelector<HTMLInputElement>('[aria-label="Smooth on release"]')!.checked)) throw new Error("Smooth on release should start off");
  const beforeAuto = await mapped(floor);
  await page.click('[aria-label="Smooth on release"]');
  await page.mouse.move(floor.x + 180, floor.y - 90);
  await page.mouse.down();
  await page.mouse.move(floor.x + 280, floor.y - 20, { steps: 10 });
  await page.mouse.up();
  await new Promise((done) => setTimeout(done, 200));
  if (shot) await page.screenshot({ path: `${shot}-auto.png`, clip: { x: floor.x + 140, y: floor.y - 130, width: 200, height: 160 } });
  if (!(await mapped(floor) < beforeAuto)) throw new Error("The stroke with Smooth on release changed nothing");
  await page.click('button[aria-label="Undo"]');
  await new Promise((done) => setTimeout(done, 100));
  if (await mapped(floor) !== beforeAuto) throw new Error("One step back did not undo both the stroke and its smoothing");

  // Clear all empties the map, one step back from it returning.
  await clickButton("Clear all");
  await new Promise((done) => setTimeout(done, 100));
  if (await mapped(floor) !== 0) throw new Error("Clear all left something on the map");
  if (await inGame() !== 0) throw new Error("Clear all left something in the in-game preview");
  await page.click('button[aria-label="Undo"]');
  await new Promise((done) => setTimeout(done, 100));
  if (await mapped(floor) !== beforeAuto) throw new Error("Undo did not bring the map back after Clear all");
  if (!(spotBefore > 40) || spotAfter !== 0) throw new Error(`The stroke did not clear the map under the brush: ${spotBefore} -> ${spotAfter} light pixels`);
  if (lightAfter < lightBefore * .97) throw new Error(`A small stroke changed too much of the arena map: ${lightBefore} -> ${lightAfter} light pixels`);
  await clickButton("Cancel");
  await page.waitForFunction(() => document.body.textContent?.includes("Discard the changes?"));
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find((b) => b.textContent?.trim() === "Discard")?.click());
  await closed();
  console.log("ok  small stroke on an arena floor stays small, and Cancel asks first");
  // The side panel: nothing of the chosen colour's ring is cut off, and it can be resized, with the
  // drawing following and both sharp, and is remembered.
  const panel = () => page.evaluate(() => {
    const side = document.querySelector<HTMLElement>("[data-minimap-side]")!, box = side.getBoundingClientRect();
    const swatches = [...document.querySelectorAll<HTMLElement>('button[aria-label^="Colour "]')].map((b) => b.getBoundingClientRect());
    const small = document.querySelector<HTMLCanvasElement>('canvas[aria-label="Minimap in game"]')!, drawing = document.querySelector<HTMLCanvasElement>('canvas[aria-label="Minimap design"]')!;
    return {
      width: box.width, drawing: drawing.getBoundingClientRect().width, drawingPixels: drawing.width, room: swatches.map((rect) => Math.min(rect.left - box.left, rect.top - box.top)),
      small: small.clientWidth, smallPixels: small.width, smallSquare: small.width === small.height,
      drawingLit: (() => { const d = drawing.getContext("2d")!.getImageData(0, 0, drawing.width, drawing.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 120) n++; return n; })(),
    };
  });
  await page.waitForFunction(() => !document.querySelector("[data-minimap]"));
  await open();
  const narrow = await panel();
  // Ring and its gap: 2 + 2.
  if (narrow.room.some((room) => room < 4)) throw new Error(`A colour's ring is cut off: ${narrow.room}`);
  const handle = await page.evaluate(() => { const rect = document.querySelector("[data-minimap-handle]")!.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; });
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(handle.x - 250, handle.y, { steps: 10 });
  await page.mouse.up();
  await new Promise((done) => setTimeout(done, 300));
  const wide = await panel();
  if (!(wide.width > narrow.width + 200) || !(wide.drawing < narrow.drawing - 200)) throw new Error(`The panel did not resize: ${JSON.stringify({ narrow, wide })}`);
  if (wide.smallPixels !== wide.small || !wide.smallSquare || !(wide.small > narrow.small + 150)) throw new Error(`The in-game preview did not follow: ${JSON.stringify(wide)}`);
  if (!(wide.drawingLit > 100)) throw new Error("The drawing went blank after resizing");
  if (wide.room.some((room) => room < 4)) throw new Error("A colour's ring is cut off when wide");
  if (shot) await page.screenshot({ path: `${shot}-panel.png` });
  await clickButton("Cancel");
  await page.waitForFunction(() => !document.querySelector("[data-minimap]"));
  await open();
  const reopened = await panel();
  if (Math.abs(reopened.width - wide.width) > 8) throw new Error(`The panel's size was not remembered: ${wide.width} -> ${reopened.width}`);
  await clickButton("Cancel");
  console.log("ok  side panel resizes with its ring whole, and is remembered");

  // Recolour and Stretch change what is on the map and add nothing to it. On a race track: a stretch
  // goes along a lap, which a battle arena does not have.
  await page.waitForFunction(() => !document.querySelector("[data-minimap]"));
  await page.evaluate(async (track) => { const app = (window as any).app; app.doc.dirty = false; await app.openPath(track); }, join(game, "Race", "Course", "castle_course.szs"));
  await open();
  await clickButton("New from track…");
  await page.waitForSelector('[aria-label="Include Item boxes"]');
  await clickButton("Road only");
  await page.waitForFunction(() => !document.querySelector('[aria-label="Include Item boxes"]'));
  const addColour = async (hex: string) => {
    await page.click('[aria-label="Add colour"]');
    await page.waitForFunction(() => !!document.querySelector('[aria-label="Selected colour"]'));
    await setColour(hex);
    await new Promise((done) => setTimeout(done, 150));
  };
  // How much of the drawing is a colour, and how much is on the map at all (not the two dark backgrounds).
  const shares = () => page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[aria-label="Minimap design"]')!, data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    const out = { white: 0, red: 0, blue: 0, map: 0 };
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const dark = r < 70 && g < 70 && b < 80;
      if (!dark) out.map++;
      if (r > 240 && g > 240 && b > 240) out.white++;
      if (r > 240 && g < 30 && b < 30) out.red++;
      if (b > 240 && r < 30 && g < 30) out.blue++;
    }
    return out;
  });
  const choose = (name: string) => page.evaluate((text) => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent?.trim() === text)?.click(), name);
  const stroke = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
    await new Promise((done) => setTimeout(done, 100));
  };
  const enemy = await page.evaluate(() => (window as any).app.doc.kmp.ENPT.flatMap((group: any) => group.points).map((point: any) => point.pos));
  const pointAt = (share: number) => enemy[Math.floor(enemy.length * share)];
  const worldAt = (share: number) => worldPoint(pointAt(share)[0], pointAt(share)[2]);
  const roadOnly = await shares();
  await addColour("#ff0000");
  await choose("Recolour");
  const strokeFrom = await worldAt(.5), strokeTo = await worldAt(.54);
  await stroke(strokeFrom, strokeTo);
  const red = await shares();
  if (!(red.red > 20)) throw new Error(`Recolour did not change the road: ${JSON.stringify(red)}`);
  if (Math.abs(red.map - roadOnly.map) > roadOnly.map * .01) throw new Error(`Recolour added to the map: ${roadOnly.map} -> ${red.map}`);
  if (shot) await page.screenshot({ path: `${shot}-recolour.png` });
  // A stroke that starts off the map moves the view, and changes nothing on it. Back again, it is as it was.
  const bare = await page.evaluate(() => { const map = document.querySelector<HTMLElement>("[data-minimap]")!.getBoundingClientRect(); return { x: map.left + 12, y: map.top + 12 }; });
  await stroke(bare, { x: bare.x + 30, y: bare.y + 30 });
  await stroke({ x: bare.x + 30, y: bare.y + 30 }, bare);
  const still = await shares();
  if (Math.abs(still.red - red.red) > red.red * .05 || Math.abs(still.map - red.map) > red.map * .02) throw new Error(`A stroke off the map changed it: ${JSON.stringify({ red, still })}`);
  // Started on red, blue takes only the red: the white around it stays, though the brush crosses it.
  await addColour("#0000ff");
  await stroke(strokeFrom, strokeTo);
  const blue = await shares();
  if (!(blue.blue > 20) || blue.red > red.red) throw new Error(`Recolour from one colour: ${JSON.stringify(blue)}`);
  if (Math.abs(blue.white - still.white) > still.white * .02) throw new Error(`Recolour took other colours too: ${still.white} -> ${blue.white}`);
  await page.keyboard.down("Control"); await page.keyboard.press("z"); await page.keyboard.up("Control");
  await page.keyboard.down("Control"); await page.keyboard.press("z"); await page.keyboard.up("Control");
  console.log("ok  recolour changes only what is on the map, and only the colour it began on");

  // Stretch: two lines, a preview, and only that part coloured; the other way is the rest of the lap.
  await addColour("#0000ff");
  const beforeStretch = await shares();
  await choose("Stretch");
  await page.waitForSelector("[data-minimap-stretch]");
  await new Promise((done) => setTimeout(done, 400));
  const lineStart = await worldAt(.2), lineEnd = await worldAt(.4);
  await page.mouse.click(lineStart.x, lineStart.y);
  await new Promise((done) => setTimeout(done, 100));
  await page.mouse.click(lineEnd.x, lineEnd.y);
  await page.waitForFunction(() => Number(document.querySelector("[data-minimap-stretch]")!.getAttribute("data-minimap-stretch")) > 0, { timeout: 30000 });
  const stretchSize = () => page.evaluate(() => Number(document.querySelector("[data-minimap-stretch]")!.getAttribute("data-minimap-stretch")));
  const oneWay = await stretchSize();
  if (shot) await page.screenshot({ path: `${shot}-stretch.png` });
  await clickButton("Other way");
  await new Promise((done) => setTimeout(done, 150));
  const otherWay = await stretchSize();
  if (!(otherWay > oneWay)) throw new Error(`A fifth of the lap should be shorter than the rest: ${oneWay}, ${otherWay}`);
  await clickButton("Other way");
  await new Promise((done) => setTimeout(done, 150));
  if (await stretchSize() !== oneWay) throw new Error("Other way twice should be where it began");
  await clickButton("Colour this stretch");
  await new Promise((done) => setTimeout(done, 200));
  await clickButton("Clear lines");
  await new Promise((done) => setTimeout(done, 200));
  const coloured = await shares();
  if (!(coloured.blue > beforeStretch.blue + 50)) throw new Error(`The stretch was not coloured: ${JSON.stringify({ beforeStretch, coloured })}`);
  if (Math.abs(coloured.map - roadOnly.map) > roadOnly.map * .02) throw new Error(`The stretch added to the map: ${roadOnly.map} -> ${coloured.map}`);
  if (!(coloured.white > roadOnly.white * .3)) throw new Error("The stretch coloured far more than its part");
  if (shot) await page.screenshot({ path: `${shot}-stretch-done.png` });
  await page.keyboard.down("Control"); await page.keyboard.press("z"); await page.keyboard.up("Control");
  await new Promise((done) => setTimeout(done, 200));
  if ((await shares()).blue > 10) throw new Error("Undo did not take the stretch back");
  await page.keyboard.down("Control"); await page.keyboard.press("y"); await page.keyboard.up("Control");
  await enabled("Apply", true);
  await clickButton("Apply");
  await closed();
  await page.evaluate(() => (window as any).app.cmd("undo"));
  console.log("ok  stretch colours between its lines, undoes, and applies");

  if (errors.length) throw new Error(`Browser errors: ${errors.join("; ")}`);
} finally {
  await browser?.close();
  worker.terminate();
  const target = resolve(temp);
  if (!target.startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe temporary test path");
  rmSync(target, { recursive: true, force: true });
}
