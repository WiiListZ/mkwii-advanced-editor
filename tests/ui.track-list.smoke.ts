// Run with: bun run tests/ui.track-list.smoke.ts
// Uses an isolated workspace to verify pagination, search and live folder updates.
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
  await page.waitForFunction(() => document.body.textContent?.includes("100 files"));
  await page.screenshot({ path: join(dir, "track-list.png") });
  if (!(await page.$('button[aria-label="Next track page"]'))) throw new Error("Track pagination is missing");
  await page.click('button[aria-label="Next track page"]');
  await page.waitForFunction(() => document.body.textContent?.includes("49–96 of 100"));
  await page.type('input[aria-label="Search tracks"]', "73");
  await page.waitForFunction(() => document.body.textContent?.includes("1 of 1"));
  await page.keyboard.down("Control"); await page.keyboard.press("A"); await page.keyboard.up("Control"); await page.keyboard.press("Backspace");
  await page.waitForFunction(() => document.body.textContent?.includes("100 shown"));
  await writeFile(join(folder, "100.szs"), new Uint8Array());
  await page.waitForFunction(() => document.body.textContent?.includes("101 files"), { timeout: 6000 });
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
  await page.waitForFunction(() => document.body.textContent?.includes("1 file"), { timeout: 6000 });
  console.log(`Track list updated: ${join(dir, "track-list.png")}`);
} finally {
  await browser.close();
  worker.terminate();
  // The screenshot stays in the temporary directory for visual inspection.
}
