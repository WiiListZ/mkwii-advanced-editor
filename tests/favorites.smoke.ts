// Checks favorites in both catalogs with real game files and persisted settings.
// Usage: MKWII_GAME_DIR=<extracted game files> bun run tests/favorites.smoke.ts
import puppeteer from "puppeteer-core";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";

const game = process.env.MKWII_GAME_DIR;
if (!game || !existsSync(join(game, "Race/Common.szs"))) {
  console.log("MKWII_GAME_DIR not set (or no Race/Common.szs): skipped");
  process.exit(0);
}
const settingsDir = mkdtempSync(join(tmpdir(), "mkwii-favorites-"));
await Bun.write(join(settingsDir, "settings.json"), JSON.stringify({ tourDone: true, partsFolder: join(game, "Race/Course") }));
const worker = new Worker(new URL("../src/server.ts", import.meta.url).href);
const port: number = await new Promise((resolve) => {
  worker.onmessage = (event) => event.data?.type === "ready" && resolve(event.data.port);
  worker.postMessage({ type: "start", token: "favorites", settingsDir });
});
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1600,950"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 950 });
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); console.log("ok", message); };
try {
  await page.goto(`http://127.0.0.1:${port}/?t=favorites`, { waitUntil: "networkidle0" });
  await page.evaluate(async (common, track) => {
    const app = (window as any).app;
    await app.loadCommonFrom(common, true);
    await app.openPath(track);
    await app.loadTrackAssets();
    app.setTab("objects");
  }, join(game, "Race/Common.szs"), join(game, "Race/Course/castle_course.szs"));
  await page.waitForSelector('div[draggable="true"]');
  const clickedObject = await page.evaluate(() => {
    const row = [...document.querySelectorAll<HTMLElement>('div[draggable="true"]')].find((item) => item.textContent?.includes("0x0065"));
    const button = row?.querySelector<HTMLButtonElement>('button[aria-label*="favorites"]');
    button?.click();
    return !!button;
  });
  check(clickedObject, "item-box favorite button is available");
  check(await page.evaluate(() => (window as any).app.settings.favoriteObjects.includes(0x65)), "favorite object recorded");
  check(await page.evaluate(() => !![...document.querySelectorAll("*" )].find((element) => element.children.length === 0 && element.textContent === "Favorites")), "favorites section shown before catalog");

  await page.evaluate(() => { (window as any).app.cmd("modelParts"); });
  await page.waitForSelector('input[placeholder="Find a track"]');
  await page.waitForSelector('button[aria-label="Add DK Summit to favorites"]');
  await page.click('button[aria-label="Add DK Summit to favorites"]');
  check(await page.evaluate(() => {
    const button = document.querySelector('button[aria-label="Remove DK Summit from favorites"]');
    const row = button?.parentElement?.parentElement;
    return row && row.parentElement?.firstElementChild === row;
  }), "favorite model source moved to the top");

  await page.evaluate(() => {
    const button = document.querySelector('button[aria-label="Add Mario Circuit to favorites"]');
    (button?.parentElement?.parentElement as HTMLElement)?.click();
  });
  await page.waitForSelector('button[aria-label="Add denchu1 · polygon27 to favorites"]', { timeout: 30000 });
  await page.click('button[aria-label="Add denchu1 · polygon27 to favorites"]');
  check(await page.evaluate(() => {
    const button = document.querySelector('button[aria-label="Remove denchu1 · polygon27 from favorites"]');
    const row = button?.parentElement;
    const siblingRows = [...(row?.parentElement?.children || [])].filter((element) => element.querySelector('button[aria-label*="favorites"]'));
    return siblingRows[0] === row;
  }), "favorite model part moved above other parts");

  await wait(500);
  const saved = await Bun.file(join(settingsDir, "settings.json")).json();
  check(saved.favoriteObjects.includes(0x65) && saved.favoriteModelSources.length === 1 && saved.favoriteModelParts.length === 1, "favorites saved in settings");
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForFunction(() => (window as any).app?.settings?.favoriteObjects?.includes(0x65));
  check(await page.evaluate(() => (window as any).app.settings.favoriteModelSources.length === 1 && (window as any).app.settings.favoriteModelParts.length === 1), "model favorites restored after reload");
  await page.evaluate(async (track) => { await (window as any).app.openPath(track); }, join(game, "Race/Course/castle_course.szs"));
  await page.evaluate(() => (window as any).app.setTab("objects"));
  await page.waitForSelector('button[aria-label="Remove Item Box from favorites"]');
  await page.click('button[aria-label="Remove Item Box from favorites"]');
  check(await page.evaluate(() => !(window as any).app.settings.favoriteObjects.includes(0x65)), "favorite object can be removed");
  await page.evaluate(() => { (window as any).app.cmd("modelParts"); });
  await page.waitForSelector('button[aria-label="Remove DK Summit from favorites"]');
  check(await page.evaluate(() => {
    const button = document.querySelector('button[aria-label="Remove DK Summit from favorites"]');
    const row = button?.parentElement?.parentElement;
    const common = document.querySelector('button[aria-label="Add Race/Common.szs to favorites"]')?.parentElement?.parentElement;
    const rows = [...(row?.parentElement?.children || [])];
    return row && common && rows.indexOf(row) < rows.indexOf(common);
  }), "favorite source remains ahead of nonfavorites after reload");
  await page.evaluate(() => {
    const button = document.querySelector('button[aria-label="Add Mario Circuit to favorites"]');
    (button?.parentElement?.parentElement as HTMLElement)?.click();
  });
  await page.waitForSelector('button[aria-label="Remove denchu1 · polygon27 from favorites"]');
  await page.click('button[aria-label="Remove denchu1 · polygon27 from favorites"]');
  check(await page.evaluate(() => (window as any).app.settings.favoriteModelParts.length === 0), "favorite model part can be removed");
} finally {
  await browser.close();
  worker.terminate();
  if (!resolve(settingsDir).startsWith(resolve(tmpdir()) + sep) || !basename(settingsDir).startsWith("mkwii-favorites-")) throw new Error("Unsafe temporary settings path");
  rmSync(settingsDir, { recursive: true, force: true });
}
