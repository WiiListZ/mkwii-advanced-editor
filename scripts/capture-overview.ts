// Refresh the README's Home and Sounds and music screenshots from real game files.
// Usage: MKWII_GAME_DIR=<extracted game files> bun run scripts/capture-overview.ts
import puppeteer from "puppeteer-core";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

const game = process.env.MKWII_GAME_DIR;
if (!game || !existsSync(join(game, "sound", "strm"))) throw new Error("Set MKWII_GAME_DIR to the extracted game's files directory");
const settings = mkdtempSync(join(tmpdir(), "mkwii-overview-"));
// A few recent files of the game folder, so Home shows its list (they are only listed, not opened).
const recent = ["Race/Course/castle_course.szs", "Race/Course/shopping_course.szs", "Race/Course/farm_course.szs", "Scene/UI/MenuSingle_E.szs"]
  .map((p) => join(game, ...p.split("/"))).filter((p) => existsSync(p));
await Bun.write(join(settings, "settings.json"), JSON.stringify({ tourDone: true, workspace: game, recent }));
const worker = new Worker(new URL("../src/server.ts", import.meta.url).href);
let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
try {
  const port: number = await new Promise((resolve) => {
    worker.onmessage = (event) => event.data?.type === "ready" && resolve(event.data.port);
    worker.postMessage({ type: "start", token: "overview", settingsDir: settings });
  });
  browser = await puppeteer.launch({
    executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 950, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}/?t=overview`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.body.innerText.includes("music streams"), { timeout: 30000 });
  await page.screenshot({ path: "docs/images/welcome.png" });
  await page.evaluate(() => { void (window as any).app.cmd("settingsDialog"); });
  await page.waitForSelector('button[aria-label="Keep .bak backups"]');
  await page.$eval('button[aria-label="Keep .bak backups"]', (button) => button.scrollIntoView({ block: "center" }));
  await new Promise((resolve) => setTimeout(resolve, 250));
  await page.screenshot({ path: "docs/images/settings.png" });
  await page.keyboard.press("Escape");
  await page.evaluate(() => { (window as any).app.cmd("audio"); });
  await page.waitForFunction(() => document.body.innerText.includes("Moo Moo Meadows · normal"), { timeout: 30000 });
  await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("button")].find((button) => button.textContent?.trim().startsWith("Koopa Cape · normal"))?.click());
  await page.waitForFunction(() => document.body.innerText.includes("4 tracks"), { timeout: 30000 });
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Separate tracks"))?.click());
  await page.waitForFunction(() => document.body.innerText.includes("Track 4"), { timeout: 30000 });
  await new Promise((resolve) => setTimeout(resolve, 650));
  await page.screenshot({ path: "docs/images/audio.png" });
  console.log("Updated docs/images/welcome.png, settings.png and audio.png");
} finally {
  await browser?.close();
  worker.terminate();
  const target = resolve(settings), parent = resolve(tmpdir()) + sep;
  if (!target.startsWith(parent)) throw new Error("Temporary settings path is outside the temp directory");
  rmSync(target, { recursive: true, force: true });
}
