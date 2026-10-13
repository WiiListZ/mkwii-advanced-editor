// Read-only 2D map check for an external custom track.
// MKWII_GAME_DIR=<original game>/files MKWII_MOD_TRACK=<track>.szs bun run tests/map2d-mod.smoke.ts
import puppeteer from "puppeteer-core";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

const game = process.env.MKWII_GAME_DIR, track = process.env.MKWII_MOD_TRACK;
if (!game || !track || !existsSync(join(game, "Race", "Common.szs")) || !existsSync(track)) {
  console.log("MKWII_GAME_DIR or MKWII_MOD_TRACK unavailable: skipped");
  process.exit(0);
}
const temp = mkdtempSync(join(tmpdir(), "mkwii-map2d-mod-"));
await Bun.write(join(temp, "settings.json"), JSON.stringify({ tourDone: true }));
const worker = new Worker(new URL("../src/server.ts", import.meta.url).href);
let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
try {
  const port: number = await new Promise((res, rej) => {
    worker.onmessage = (e) => { if (e.data?.type === "ready") res(e.data.port); if (e.data?.type === "error") rej(new Error(e.data.message)); };
    worker.postMessage({ type: "start", token: "map2d-mod", settingsDir: temp });
  });
  browser = await puppeteer.launch({
    executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1600,950"],
  });
  const page = await browser.newPage();
  page.on("pageerror", (error) => console.error("Browser error:", error));
  await page.setViewport({ width: 1600, height: 950 });
  await page.goto(`http://127.0.0.1:${port}/?t=map2d-mod`, { waitUntil: "networkidle0" });
  await page.evaluate(async (common, path) => {
    const app = (window as any).app;
    await app.loadCommonFrom(common, true);
    await app.openPath(path);
  }, join(game, "Race", "Common.szs"), track);
  await page.click('[data-group="editor-view"] [aria-label="2D editor"]');
  await page.waitForFunction(() => {
    const map = document.querySelector<HTMLElement>('[data-map2d]');
    const canvas = map?.querySelector<HTMLCanvasElement>('canvas[aria-hidden="true"]');
    return map?.dataset.fitted === "true" && !!canvas && canvas.width > 300;
  });
  await new Promise((done) => setTimeout(done, 1000));
  const result = await page.evaluate(() => {
    const app = (window as any).app, map = document.querySelector<HTMLElement>('[data-map2d]')!;
    const canvas = map.querySelector<HTMLCanvasElement>('canvas[aria-hidden="true"]')!;
    const { data, width, height } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    let surface = 0;
    for (let y = 0; y < height; y += 4) for (let x = 0; x < width; x += 4) {
      const p = (y * width + x) * 4, r = data[p], g = data[p + 1], b = data[p + 2];
      if (r >= 45 && g >= 55 && g > r && g > b) surface++;
    }
    return { file: app.doc.fileName, collisionTriangles: app.doc.kcl?.count || 0,
      model: !!app.assets?.built?.course, scale: Number(map.dataset.scale), surfaceSamples: surface };
  });
  if (process.env.MKWII_MAP2D_SCREENSHOT) await page.screenshot({ path: process.env.MKWII_MAP2D_SCREENSHOT });
  console.log(result);
  if (!result.surfaceSamples || !(result.scale > 0)) throw new Error("Custom track map has no visible surface");
} finally {
  await browser?.close();
  worker.terminate();
  const target = resolve(temp);
  if (!target.startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe temporary test path");
  rmSync(target, { recursive: true, force: true });
}
