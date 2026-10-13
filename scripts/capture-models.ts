// Refresh the README's Characters and models screenshots (skeleton, 3D export, converting every
// animation) plus the Check tab and the track generator, from real game files (nothing is saved
// into the game folder: the exported model goes to a temporary folder).
// Usage: MKWII_GAME_DIR=<extracted game files> bun run --preload ./scripts/readme-privacy.ts scripts/capture-models.ts
import puppeteer from "puppeteer-core";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep, win32 } from "node:path";

const game = process.env.MKWII_GAME_DIR;
if (!game || !existsSync(join(game, "Race", "Common.szs"))) throw new Error("Set MKWII_GAME_DIR to the extracted game's files directory");
const files = win32.normalize(resolve(game));
const out = (name: string) => join(import.meta.dir, "..", "docs", "images", name);
const temp = mkdtempSync(join(tmpdir(), "mkwii-model-shots-"));
const glb = win32.join(win32.normalize(temp), "model.glb");
await Bun.write(join(temp, "settings.json"), JSON.stringify({ tourDone: true, workspace: files, commonPath: win32.join(files, "Race", "Common.szs") }));
const worker = new Worker(new URL("../src/server.ts", import.meta.url).href);
let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
try {
  const port: number = await new Promise((r) => {
    worker.onmessage = (event) => event.data?.type === "ready" && r(event.data.port);
    worker.postMessage({ type: "start", token: "shots", settingsDir: temp });
  });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"], protocolTimeout: 240000 });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 950, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  // The Windows file dialogs cannot be driven: the export is saved to, and the conversion reads, a temporary model.glb.
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path === "/api/save-dialog" || path === "/api/open-dialog") request.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ path: glb }) });
    else request.continue();
  });
  await page.goto(`http://127.0.0.1:${port}/?t=shots`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => !!(window as any).app?.viewport);
  const click = (text: string) => page.evaluate((text) => {
    const all = [...document.querySelectorAll('[role="dialog"]')]; const top = all[all.length - 1] || document.body;
    ([...top.querySelectorAll("button, label")].find((b) => b.textContent?.trim().startsWith(text)) as HTMLElement | undefined)?.click();
  }, text);
  const settle = async (ms = 600) => { await sleep(ms); await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); };
  const hideToasts = () => page.evaluate(() => document.querySelectorAll("[data-sonner-toaster]").forEach((t) => ((t as HTMLElement).style.display = "none")));
  const showToasts = () => page.evaluate(() => document.querySelectorAll("[data-sonner-toaster]").forEach((t) => ((t as HTMLElement).style.display = "")));

  // Donkey Kong's driver model with the bones drawn over it.
  await page.evaluate((k) => { void (window as any).app.openAssetEditor({ category: "characters", archive: k, resource: "driver_model.brres" }); }, win32.join(files, "Race", "Kart", "ldf_kart-dk.szs"));
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent?.includes("Edit skeleton")), { timeout: 60000 });
  await page.evaluate(() => [...document.querySelectorAll<HTMLLabelElement>('[role="dialog"] label')].find((l) => l.textContent?.includes("Show bones"))?.querySelector("input")?.click());
  await settle(2500);
  await page.screenshot({ path: out("assets-skeleton.png") });
  console.log("assets-skeleton.png");

  // Export as a glTF model with its animations: the confirmation lists bones and animations.
  await click("3D model");
  await page.waitForFunction(() => document.body.innerText.includes("3D model exported"), { timeout: 120000 });
  await settle(900);
  await page.screenshot({ path: out("export-3d.png") });
  console.log("export-3d.png");
  await hideToasts();

  // Converting that model back: every animation can become its own CHR0.
  await click("Convert 3D to BRRES");
  await page.waitForFunction(() => document.body.innerText.includes("Convert model and skeleton"), { timeout: 180000 });
  await settle();
  await page.screenshot({ path: out("convert-animations.png") });
  console.log("convert-animations.png");
  await click("Cancel");
  await sleep(500);
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="Close"]')?.click());
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), { timeout: 10000 });
  await showToasts();

  // The Check tab on Mario Circuit.
  await page.evaluate(async (p) => {
    const app = (window as any).app;
    await app.openPath(p);
    await app.loadTrackAssets();
    app.setTab("validate");
    app.viewport.frameAll(true);
  }, win32.join(files, "Race", "Course", "castle_course.szs"));
  await hideToasts();
  await settle(3500);
  await page.screenshot({ path: out("check.png") });
  console.log("check.png");

  // The track generator.
  await page.evaluate(() => { void (window as any).app.cmd("newTrack"); });
  await page.waitForSelector('[role="dialog"]');
  await settle(1500);
  await page.screenshot({ path: out("track-generator.png") });
  console.log("track-generator.png");
} finally {
  await browser?.close();
  worker.terminate();
  if (!resolve(temp).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe temporary path");
  rmSync(temp, { recursive: true, force: true });
}
