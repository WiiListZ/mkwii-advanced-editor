// Exercises the flat 2D editor against a real extracted track without changing game files.
// Usage: MKWII_GAME_DIR=<game>/files bun run tests/map2d.smoke.ts
import puppeteer from "puppeteer-core";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

const game = process.env.MKWII_GAME_DIR;
if (!game || !existsSync(join(game, "Race", "Common.szs"))) {
  console.log("MKWII_GAME_DIR not set (or no Race/Common.szs): skipped");
  process.exit(0);
}
const temp = mkdtempSync(join(tmpdir(), "mkwii-map2d-"));
await Bun.write(join(temp, "settings.json"), JSON.stringify({ tourDone: true }));
const worker = new Worker(new URL("../src/server.ts", import.meta.url).href);
let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
try {
  const port: number = await new Promise((res, rej) => {
    worker.onmessage = (e) => { if (e.data?.type === "ready") res(e.data.port); if (e.data?.type === "error") rej(new Error(e.data.message)); };
    worker.postMessage({ type: "start", token: "map2d-smoke", settingsDir: temp });
  });
  browser = await puppeteer.launch({
    executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1600,950"],
  });
  const page = await browser.newPage();
  page.on("pageerror", (error) => console.error("Browser error:", error));
  await page.setViewport({ width: 1600, height: 950 });
  await page.goto(`http://127.0.0.1:${port}/?t=map2d-smoke`, { waitUntil: "networkidle0" });
  await page.evaluate(async (common, track) => {
    const app = (window as any).app;
    await app.loadCommonFrom(common, true);
    await app.openPath(track);
  }, join(game, "Race", "Common.szs"), join(game, "Race", "Course", "castle_course.szs"));
  const viewButtons = await page.evaluate(() => {
    const view = document.querySelector('[data-group="editor-view"]');
    const add = document.querySelector('[data-group="create"]');
    return !!view && !!add && !!(view.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  if (!viewButtons) throw new Error("2D/3D switch is not before Add in the toolbar");
  await page.click('[data-group="editor-view"] [aria-label="2D editor"]');
  if (!(await page.evaluate(() => (window as any).app.map2D))) throw new Error("2D view switch did not activate");
  await page.waitForSelector('[data-map2d] canvas[aria-label="2D track map"]');
  await page.waitForFunction(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-map2d] canvas[aria-label="2D track map"]');
    return !!canvas && canvas.width > 300 && canvas.height > 300 && document.querySelector('[data-map2d]')?.getAttribute('data-fitted') === 'true';
  });
  const layout = await page.evaluate(() => {
    const app = (window as any).app, k = app.doc.kmp;
    const canvas = document.querySelector<HTMLCanvasElement>('[data-map2d] canvas[aria-label="2D track map"]')!;
    const rect = canvas.getBoundingClientRect(), map = document.querySelector<HTMLElement>('[data-map2d]')!;
    const cx = Number(map.dataset.centerX), cz = Number(map.dataset.centerZ), scale = Number(map.dataset.scale);
    const cp = k.CKPT[0].points[0], x = (cp.left[0] + cp.right[0]) / 2, z = (cp.left[1] + cp.right[1]) / 2;
    return { x: rect.left + rect.width / 2 + (x - cx) * scale,
      y: rect.top + rect.height / 2 + (z - cz) * scale,
      before: [cp.left.slice(), cp.right.slice()], scale };
  });
  if (!(layout.scale > 0)) throw new Error("2D map did not fit the track");
  if (process.env.MKWII_MAP2D_SCREENSHOT) {
    await new Promise((done) => setTimeout(done, 3200));
    await page.screenshot({ path: process.env.MKWII_MAP2D_SCREENSHOT });
  }
  await page.mouse.move(layout.x, layout.y);
  await page.mouse.down();
  await page.mouse.move(layout.x + 25, layout.y + 12, { steps: 5 });
  await page.mouse.up();
  const moved = await page.evaluate(() => {
    const a = (window as any).app, cp = a.doc.kmp.CKPT[0].points[0];
    return { left: cp.left.slice(), right: cp.right.slice(), selected: a.doc.selection.has(String(cp.uid)), label: a.doc.undoStack.at(-1)?.label };
  });
  if (!moved.selected || moved.label !== "Move in 2D" || Math.abs(moved.left[0] - layout.before[0][0]) < 100 || Math.abs(moved.right[0] - layout.before[1][0]) < 100)
    throw new Error(`Dragging the checkpoint in 2D did not move both ends with undo history: ${JSON.stringify({ layout, moved })}`);
  await page.evaluate(() => (window as any).app.cmd("undo"));
  const restored = await page.evaluate(() => (window as any).app.doc.kmp.CKPT[0].points[0].left.slice());
  if (Math.abs(restored[0] - layout.before[0][0]) > 0.01) throw new Error("Undo did not restore the checkpoint");
  console.log("ok  2D checkpoint drag, selection and undo");

  await page.click('[data-map2d] button[aria-label="Fit 2D map"]');
  const leftHandle = await page.evaluate(() => {
    const app = (window as any).app, k = app.doc.kmp, c = document.querySelector<HTMLCanvasElement>('[data-map2d] canvas[aria-label="2D track map"]')!;
    const r = c.getBoundingClientRect(), map = document.querySelector<HTMLElement>('[data-map2d]')!;
    const cx = Number(map.dataset.centerX), cz = Number(map.dataset.centerZ), s = Number(map.dataset.scale);
    const p = k.CKPT[0].points[0];
    return { x: r.left + r.width / 2 + (p.left[0] - cx) * s,
      y: r.top + r.height / 2 + (p.left[1] - cz) * s };
  });
  await page.mouse.move(leftHandle.x, leftHandle.y);
  await page.mouse.down();
  await page.mouse.move(leftHandle.x + 18, leftHandle.y, { steps: 4 });
  await page.mouse.up();
  const side = await page.evaluate(() => {
    const p = (window as any).app.doc.kmp.CKPT[0].points[0];
    return { left: p.left.slice(), right: p.right.slice() };
  });
  if (Math.abs(side.left[0] - layout.before[0][0]) < 100 || Math.abs(side.right[0] - layout.before[1][0]) > 0.01)
    throw new Error("Dragging a checkpoint endpoint also changed the other endpoint");
  await page.evaluate(() => (window as any).app.cmd("undo"));
  console.log("ok  2D checkpoint endpoint drag");

  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[data-map2d] button')].find((b) => b.textContent?.includes("Enemy routes"))?.click());
  await page.click('[data-map2d] button[aria-label="Add 2D item"]');
  const beforeEnemy = await page.evaluate(() => (window as any).app.doc.kmp.ENPT.reduce((n: number, g: any) => n + g.points.length, 0));
  const canvas = await page.$('[data-map2d] canvas[aria-label="2D track map"]');
  const box = await canvas!.boundingBox();
  await page.mouse.click(box!.x + box!.width * 0.45, box!.y + box!.height * 0.55);
  const afterEnemy = await page.evaluate(() => (window as any).app.doc.kmp.ENPT.reduce((n: number, g: any) => n + g.points.length, 0));
  if (afterEnemy !== beforeEnemy + 1) throw new Error("2D map did not add an enemy route point");
  await page.evaluate(() => (window as any).app.cmd("undo"));
  console.log("ok  2D route point placement and undo");

  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[data-map2d] button')].find((b) => b.textContent?.includes("Item routes"))?.click());
  await page.click('[data-map2d] button[aria-label="Add 2D item"]');
  const beforeItems = await page.evaluate(() => (window as any).app.doc.kmp.ITPT.reduce((n: number, g: any) => n + g.points.length, 0));
  await page.mouse.click(box!.x + box!.width * 0.48, box!.y + box!.height * 0.54);
  if (await page.evaluate(() => (window as any).app.doc.kmp.ITPT.reduce((n: number, g: any) => n + g.points.length, 0)) !== beforeItems + 1)
    throw new Error("2D map did not add an item route point");
  await page.evaluate(() => (window as any).app.cmd("undo"));
  console.log("ok  2D item route placement and undo");

  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[data-map2d] button')].find((b) => b.textContent?.includes("Object routes"))?.click());
  const beforeRoutes = await page.evaluate(() => (window as any).app.doc.kmp.POTI.length);
  await page.click('[data-map2d] button[aria-label="New route or group"]');
  if (await page.evaluate(() => (window as any).app.doc.kmp.POTI.length) !== beforeRoutes + 1)
    throw new Error("2D map did not create an object route");
  await page.evaluate(() => (window as any).app.cmd("undo"));
  console.log("ok  2D object route creation and undo");

  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[data-map2d] button')].find((b) => b.textContent?.includes("Starts"))?.click());
  await page.click('[data-map2d] button[aria-label="Add 2D item"]');
  const beforeStarts = await page.evaluate(() => (window as any).app.doc.kmp.KTPT.length);
  await page.mouse.click(box!.x + box!.width * 0.49, box!.y + box!.height * 0.55);
  if (await page.evaluate(() => (window as any).app.doc.kmp.KTPT.length) !== beforeStarts + 1)
    throw new Error("2D map did not add a start position");
  await page.evaluate(() => (window as any).app.cmd("undo"));
  console.log("ok  2D start placement and undo");

  const beforePan = await page.evaluate(() => ({
    x: Number(document.querySelector<HTMLElement>('[data-map2d]')!.dataset.centerX),
    dirty: (window as any).app.doc.dirty,
  }));
  await page.mouse.move(box!.x + 30, box!.y + box!.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(box!.x + 65, box!.y + box!.height * 0.55, { steps: 4 });
  await page.mouse.up();
  const afterPan = await page.evaluate(() => ({
    x: Number(document.querySelector<HTMLElement>('[data-map2d]')!.dataset.centerX),
    dirty: (window as any).app.doc.dirty,
  }));
  if (Math.abs(afterPan.x - beforePan.x) < 100 || afterPan.dirty !== beforePan.dirty)
    throw new Error("Dragging empty map space did not pan without editing the track");
  await page.click('[data-map2d] button[aria-label="Fit 2D map"]');
  console.log("ok  2D empty-space pan");

  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[data-map2d] button')].find((b) => b.textContent?.trim().endsWith("Objects"))?.click());
  await page.click('[data-map2d] button[aria-label="Add 2D item"]');
  await page.waitForSelector('[role="dialog"] [cmdk-item]');
  await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[role="dialog"] [cmdk-item]')].find((e) => e.textContent?.includes("0x0065"))?.click());
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent?.includes("Add to track"))?.click());
  await page.waitForFunction(() => (window as any).app.tool?.kind === "GOBJ");
  await page.waitForSelector('[role="dialog"]', { hidden: true });
  const beforeObjects = await page.evaluate(() => (window as any).app.doc.kmp.GOBJ.length);
  await page.mouse.click(box!.x + box!.width * 0.55, box!.y + box!.height * 0.60);
  const afterObjects = await page.evaluate(() => (window as any).app.doc.kmp.GOBJ.length);
  if (afterObjects !== beforeObjects + 1) throw new Error("2D map did not add an object");
  const saved = join(temp, "map-edited.szs");
  await page.evaluate(async (path) => {
    const app = (window as any).app;
    app.doc.filePath = path;
    app.doc.fileKind = "szs";
    await app.save(false);
    await app.openPath(path);
  }, saved);
  if (!existsSync(saved) || await page.evaluate(() => (window as any).app.doc.kmp.GOBJ.length) !== afterObjects)
    throw new Error("2D edits did not survive save and reopen");
  console.log("ok  2D object placement and temporary SZS save/reopen");
  await page.click('[data-map2d] button[aria-label="Fit 2D map"]');
  await page.click('[data-group="editor-view"] [aria-label="3D view"]');
  await page.waitForFunction(() => document.querySelector('[data-group="editor-view"] [aria-label="3D view"]')?.getAttribute('aria-pressed') === 'true');
  if (await page.$('[data-map2d]')) throw new Error("3D switch did not close the 2D map");
  console.log("ok  2D/3D view switch");
} finally {
  await browser?.close();
  worker.terminate();
  const target = resolve(temp);
  if (!target.startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe temporary test path");
  rmSync(target, { recursive: true, force: true });
}
