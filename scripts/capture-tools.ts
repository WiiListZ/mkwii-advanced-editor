// Refresh the README's screenshots of the archive window, the effects editor, the game parameters
// editor, the sky editor, the skeleton editor and the Home screen's tools, from real game files (read only: nothing is saved).
// Usage: MKWII_GAME_DIR=<extracted game files> bun run scripts/capture-tools.ts
import puppeteer from "puppeteer-core";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep, win32 } from "node:path";

const game = process.env.MKWII_GAME_DIR;
if (!game || !existsSync(join(game, "Race", "Common.szs"))) throw new Error("Set MKWII_GAME_DIR to the extracted game's files directory");
const files = win32.normalize(resolve(game));
const out = (name: string) => join(import.meta.dir, "..", "docs", "images", name);
const settings = mkdtempSync(join(tmpdir(), "mkwii-tool-shots-"));
await Bun.write(join(settings, "settings.json"), JSON.stringify({ tourDone: true, workspace: files, commonPath: win32.join(files, "Race", "Common.szs") }));
const worker = new Worker(new URL("../src/server.ts", import.meta.url).href);
let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
try {
  const port: number = await new Promise((r) => {
    worker.onmessage = (event) => event.data?.type === "ready" && r(event.data.port);
    worker.postMessage({ type: "start", token: "shots", settingsDir: settings });
  });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 950, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await page.goto(`http://127.0.0.1:${port}/?t=shots`, { waitUntil: "networkidle0" });
  const app = (fn: string, ...args: any[]) => page.evaluate((fn, args) => { void (window as any).app[fn](...args); }, fn, args);
  const topDialogClick = (text: string) => page.evaluate((text) => {
    const all = [...document.querySelectorAll('[role="dialog"]')]; const top = all[all.length - 1];
    ([...top.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(text)) as HTMLElement | undefined)?.click();
  }, text);
  const closeAll = async () => { for (let i = 0; i < 4; i++) { await page.keyboard.press("Escape"); await sleep(200); } await page.evaluate(() => document.querySelectorAll('[role="dialog"] button[aria-label^="Close"]').forEach((b) => (b as HTMLElement).click())); await sleep(400); };

  // Home: the editing actions, Effects and Vehicle stats among them.
  await page.waitForFunction(() => document.body.textContent?.includes("Vehicle stats and item chances"), { timeout: 20000 });
  await sleep(800);
  await page.evaluate(() => {
    const action = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Open a track"));
    action?.scrollIntoView({ block: "start" });
    (document.activeElement as HTMLElement)?.blur();
  });
  await sleep(400);
  await page.screenshot({ path: out("home-tools.png") });

  // Archive window: Common.szs (no track inside).
  await app("openPath", win32.join(files, "Race", "Common.szs"));
  await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.textContent?.includes("Common.szs"));
  await sleep(800);
  await page.evaluate(() => { const box = document.querySelector('[role="dialog"] .overflow-y-auto'); if (box) box.scrollTop = 120; });
  await page.screenshot({ path: out("archive.png") });

  // Game parameters: vehicle stats, then item chances.
  await page.evaluate(() => { const rows = [...document.querySelectorAll('[role="dialog"] div.border-b')].filter((r) => r.textContent?.includes("kartParam.bin")); (rows[0]?.querySelector("button") as HTMLElement)?.click(); });
  await page.waitForFunction(() => document.body.textContent?.includes("Game parameters"));
  await sleep(600);
  await topDialogClick("Flame Runner");
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await sleep(400);
  await page.screenshot({ path: out("game-params.png") });
  await topDialogClick("ItemSlot.bin");
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await sleep(500);
  await page.screenshot({ path: out("item-chances.png") });
  await closeAll();

  // Effects of the game folder, at Bowser's Castle's torches.
  await page.evaluate(() => { void (window as any).app.cmd("workspaceEffects"); });
  await page.waitForFunction(() => document.body.textContent?.includes("archives with effects"), { timeout: 300000 });
  await sleep(1000);
  await topDialogClick("koopa_course.szs");
  await page.waitForFunction(() => document.body.textContent?.includes("rk_taimatsu") || document.body.textContent?.includes("taimatsu"), { timeout: 60000 });
  await sleep(800);
  await page.evaluate(() => {
    const all = [...document.querySelectorAll('[role="dialog"]')]; const top = all[all.length - 1];
    ([...top.querySelectorAll("button")].find((b) => /taimatsu/i.test(b.textContent || "") && b.textContent?.includes("effect/")) as HTMLElement | undefined)?.click();
  });
  await sleep(800);
  await page.screenshot({ path: out("effects.png") });
  await page.evaluate(() => {
    const all = [...document.querySelectorAll('[role="dialog"]')]; const top = all[all.length - 1];
    ([...top.querySelectorAll("button")].find((b) => b.querySelector("canvas") && b.textContent?.includes("×")) as HTMLElement | undefined)?.click();
  });
  await sleep(1200);
  await page.screenshot({ path: out("effects-texture.png") });
  await closeAll();

  // Sky of Rainbow Road.
  await page.evaluate(async (p) => { await (window as any).app.openPath(p); }, win32.join(files, "Race", "Course", "rainbow_course.szs"));
  await sleep(1500);
  await page.evaluate(() => { void (window as any).app.cmd("sky"); });
  await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.textContent?.includes("Sky"));
  await sleep(2500);
  await page.screenshot({ path: out("sky.png") });
  await closeAll();

  // Skeleton editor of Donkey Kong's driver model.
  await page.evaluate((k) => { void (window as any).app.openAssetEditor({ category: "characters", archive: k, resource: "driver_model.brres" }); }, win32.join(files, "Race", "Kart", "ldf_kart-dk.szs"));
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent?.includes("Edit skeleton")), { timeout: 60000 });
  await sleep(1500);
  await topDialogClick("Edit skeleton");
  await page.waitForSelector('input[aria-label="Find a bone"]');
  await sleep(800);
  await topDialogClick("arm_l2");
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await sleep(2000);
  await page.screenshot({ path: out("skeleton.png") });
  console.log("Screenshots written to docs/images");
} finally {
  await browser?.close();
  worker.terminate();
  if (!resolve(settings).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe temporary path");
  rmSync(settings, { recursive: true, force: true });
}
