// Integration test with an original extracted game and a WLZ track supplied by the tester.
// MKWII_GAME_DIR=<game>/files MKWII_WLZ_FILE=<mod track>.szs bun run tests/wiimm.smoke.ts
import puppeteer from "puppeteer-core";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

const game = process.env.MKWII_GAME_DIR || "";
const source = process.env.MKWII_WLZ_FILE || "";
if (!existsSync(join(game, "Race", "Common.szs")) || !existsSync(source))
  throw new Error("Set MKWII_GAME_DIR to the original files folder and MKWII_WLZ_FILE to a WLZ track");
const temp = mkdtempSync(join(tmpdir(), "mkwii-wiimm-smoke-"));
const track = join(temp, "track.szs");
const trackNoBackup = join(temp, "track-no-backup.szs");
copyFileSync(source, track);
copyFileSync(source, trackNoBackup);
writeFileSync(join(temp, "settings.json"), JSON.stringify({ tourDone: true, workspace: game, commonPath: join(game, "Race", "Common.szs") }));
const worker = new Worker(new URL("../src/server.ts", import.meta.url).href);
let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
try {
  const port: number = await new Promise((resolve) => {
    worker.onmessage = (event) => event.data?.type === "ready" && resolve(event.data.port);
    worker.postMessage({ type: "start", token: "wiimm-smoke", settingsDir: temp });
  });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/?t=wiimm-smoke`);
  await page.waitForFunction(() => !!(window as any).app?.viewport);
  await page.evaluate(async (path) => (window as any).app.openPath(path), track);
  const objects = await page.evaluate(() => (window as any).app.doc.kmp.GOBJ.length);
  if (!objects) throw new Error("WLZ track opened without its KMP objects");
  const saved = await page.evaluate(async () => (window as any).app.save());
  if (!saved) throw new Error("Could not save the reconstructed track");
  const bytes = readFileSync(track), original = readFileSync(track + ".bak");
  if (bytes.toString("ascii", 0, 4) !== "Yaz0" || original.toString("ascii", 0, 4) !== "WLZa")
    throw new Error("Save did not write Yaz0 and retain the original WLZ backup");
  await page.evaluate(() => { void (window as any).app.cmd("settingsDialog"); });
  await page.click('button[aria-label="Keep .bak backups"]');
  await page.waitForFunction(() => document.body.textContent?.includes("Turn off .bak backups?"));
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Turn off backups")?.click());
  await page.waitForFunction(() => (window as any).app.settings.keepBackups === false);
  await page.keyboard.press("Escape");
  await page.evaluate(async (path) => (window as any).app.openPath(path), trackNoBackup);
  if (!(await page.evaluate(async () => (window as any).app.save()))) throw new Error("Could not save with backups off");
  if (existsSync(trackNoBackup + ".bak")) throw new Error("Save created a .bak while backups were off");
  const edited = await page.evaluate(async (folder) => {
    const res = await fetch(`/api/modified-files?path=${encodeURIComponent(folder)}`, { headers: { "x-token": "wiimm-smoke" } });
    return (await res.json()).files as string[];
  }, temp);
  if (!edited.includes("track-no-backup.szs")) throw new Error("Riivolution edit tracking lost the file saved without a backup");
  console.log(`Opened WLZ with ${objects} KMP objects; Yaz0 saves respected the backup setting and retained edit tracking`);
} finally {
  await browser?.close();
  worker.terminate();
  const target = resolve(temp);
  if (!target.startsWith(resolve(tmpdir()) + sep)) throw new Error("Temporary test path is outside the temp directory");
  rmSync(target, { recursive: true, force: true });
}
