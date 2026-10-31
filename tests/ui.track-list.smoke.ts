// Run with: bun run tests/ui.track-list.smoke.ts
// Uses an isolated workspace to verify the track list (Cups and tracks › All tracks): pagination,
// search and live folder updates, and the Home notice that the list moved there.
import puppeteer from "puppeteer-core";
import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "mkwii-track-list-"));
const folder = join(dir, "files", "Race", "Course");
await mkdir(folder, { recursive: true });
for (let i = 0; i < 100; i++) await writeFile(join(folder, `${i}.szs`), new Uint8Array());
await writeFile(join(dir, "settings.json"), JSON.stringify({ tourDone: true, workspace: join(dir, "files") }));
const worker = new Worker(new URL("../src/server.ts", import.meta.url).href);
const port: number = await new Promise((resolve) => {
  worker.onmessage = (event) => event.data?.type === "ready" && resolve(event.data.port);
  worker.postMessage({ type: "start", token: "tracks-smoke", settingsDir: dir });
});
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1200,900"],
});
try {
  const page = await browser.newPage();
  page.on("pageerror", (error) => { throw error; });
  await page.setViewport({ width: 1200, height: 900 });
  await page.goto(`http://127.0.0.1:${port}/?t=tracks-smoke`);
  // Home says once where the track list went; its button opens Cups and tracks.
  await page.waitForSelector("[data-tracks-moved]");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>("[data-tracks-moved] button")].find((b) => b.textContent?.includes("Open Cups and tracks"))!.click());
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent?.startsWith("All tracks")));
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.startsWith("All tracks"))!.click());
  await page.waitForFunction(() => document.body.textContent?.includes("of 100 files"));
  await page.screenshot({ path: join(dir, "track-list.png") });
  if (!(await page.$('button[aria-label="Next track page"]'))) throw new Error("Track pagination is missing");
  await page.click('button[aria-label="Next track page"]');
  await page.waitForFunction(() => document.body.textContent?.includes("49–96 of 100"));
  await page.type('input[aria-label="Search tracks"]', "73");
  await page.waitForFunction(() => document.body.textContent?.includes("1 of 1"));
  await page.keyboard.down("Control"); await page.keyboard.press("A"); await page.keyboard.up("Control"); await page.keyboard.press("Backspace");
  await page.waitForFunction(() => document.body.textContent?.includes("100 of 100 files"));
  await writeFile(join(folder, "100.szs"), new Uint8Array());
  await page.waitForFunction(() => document.body.textContent?.includes("of 101 files"), { timeout: 6000 });
  const next = join(dir, "next-files");
  await mkdir(join(next, "Race", "Course"), { recursive: true });
  await writeFile(join(next, "Race", "Course", "new.szs"), new Uint8Array());
  await writeFile(join(next, "Race", "Common.szs"), new Uint8Array());
  const switchWorkspace = page.evaluate(async (nextWorkspace) => {
    const app = (window as any).app;
    app.commonPath = "C:\\manual\\Common.szs";
    app.assets.setCommon({ name: "root", children: [] });
    await app.setWorkspace(nextWorkspace);
    return app.commonPath === "C:\\manual\\Common.szs" && !!app.assets.common;
  }, next);
  await page.waitForFunction(() => document.body.textContent?.includes("Common.szs found in this workspace"));
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Keep current Common.szs"))?.click());
  const keptCommon = await switchWorkspace;
  if (!keptCommon) throw new Error("Changing workspace discarded the manually loaded Common.szs");
  await page.waitForFunction(() => document.body.textContent?.includes("of 1 files"), { timeout: 6000 });
  const noticeGone = await page.evaluate(() => localStorage.getItem("mkwii-tracks-moved-seen") === "1");
  if (!noticeGone) throw new Error("The Home notice was not marked as read");
  console.log(`Track list updated: ${join(dir, "track-list.png")}`);
} finally {
  await browser.close();
  worker.terminate();
  // The screenshot stays in the temporary directory for visual inspection.
}
