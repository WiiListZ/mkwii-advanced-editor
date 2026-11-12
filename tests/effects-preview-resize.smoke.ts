// Inspect the effect preview in ResizeObserver, after the drawing buffer changes and before paint.
// MKWII_GAME_DIR=<files> bun run tests/effects-preview-resize.smoke.ts
import puppeteer from "puppeteer-core";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

const game = process.env.MKWII_GAME_DIR;
if (!game || !existsSync(join(game, "Race", "Course", "beginner_course.szs"))) {
  console.log("MKWII_GAME_DIR not set (or no beginner_course.szs): skipped");
  process.exit(0);
}
const temp = mkdtempSync(join(tmpdir(), "mkwii-effects-resize-"));
await Bun.write(join(temp, "settings.json"), JSON.stringify({ tourDone: true, discordActivity: false }));
const worker = new Worker(new URL("../src/server.ts", import.meta.url).href);
let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
try {
  const port: number = await new Promise((res, rej) => {
    worker.onmessage = (e) => { if (e.data?.type === "ready") res(e.data.port); if (e.data?.type === "error") rej(new Error(e.data.message)); };
    worker.postMessage({ type: "start", token: "effects-resize", settingsDir: temp });
  });
  browser = await puppeteer.launch({
    executablePath: process.env.MKWII_TEST_BROWSER || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1500,950"],
  });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.setViewport({ width: 1500, height: 950 });
  await page.goto(`http://127.0.0.1:${port}/?t=effects-resize`, { waitUntil: "networkidle0" });
  await page.evaluate(async (track) => { await (window as any).app.openPath(track); }, join(game, "Race", "Course", "beginner_course.szs"));
  await page.evaluate(() => { void (window as any).app.cmd("effects"); }); // stays pending until the window closes
  const viewer = () => [...document.querySelectorAll<HTMLCanvasElement>('[role="dialog"] canvas')].find((c) => c.getContext("webgl2") || c.getContext("webgl"));
  await page.waitForFunction(`(${viewer})()?.width > 100`);
  await page.evaluate(`(() => {
    const c = (${viewer})(), host = c.parentElement, gl = c.getContext("webgl2") || c.getContext("webgl");
    const samples = []; window.resizeSamples = samples;
    let width = host.clientWidth, height = host.clientHeight;
    new ResizeObserver(() => {
      if (width === host.clientWidth && height === host.clientHeight) return;
      width = host.clientWidth; height = host.clientHeight;
      const d = new Uint8Array(c.width * c.height * 4); gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, d);
      let painted = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) painted++;
      samples.push({ width, height, share: painted / (c.width * c.height), same: c === (${viewer})() });
    }).observe(host);
  })()`);
  for (const label of ["Resize the effect list", "Resize the emitter list"]) {
    const handle = await page.$(`[role="separator"][aria-label="${label}"]`), box = await handle!.boundingBox();
    if (!box) throw new Error(`Missing resize handle: ${label}`);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2, { steps: 10 });
    await page.mouse.move(box.x + box.width / 2 - 30, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();
  }
  const samples = await page.evaluate("window.resizeSamples") as any[];
  if (samples.length < 8) throw new Error(`Not enough live resize samples: ${samples.length}`);
  const blank = samples.filter((s) => s.share < .99 || !s.same);
  console.log(JSON.stringify({ samples: samples.length, blank: blank.length }));
  if (blank.length) throw new Error("The effect preview went blank before paint during a panel resize");
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("ok  both panel dividers keep the effect preview painted in every resize");
} finally {
  await browser?.close();
  worker.terminate();
  const target = resolve(temp);
  if (!target.startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe temporary test path");
  rmSync(target, { recursive: true, force: true });
}
