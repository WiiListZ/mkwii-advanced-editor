// Checks the music display against both saved lap streams, after Apply, reopening and restoring.
// Usage: bun run tests/cups-music.smoke.ts [confirmation-screenshot.png]
import puppeteer from "puppeteer-core";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { listSnapshots } from "../src/snapshots.ts";

const temp = mkdtempSync(join(tmpdir(), "mkwii-cups-music-"));
const files = join(temp, "files"), sound = join(files, "sound", "strm");
mkdirSync(sound, { recursive: true });
mkdirSync(join(files, "Race", "Course"), { recursive: true });
for (const stream of ["n_Farm", "n_Circuit32", "n_Kinoko", "n_Shopping32"]) {
  for (const lap of ["n", "f"]) await Bun.write(join(sound, `${stream}_${lap}.brstm`), `${stream} ${lap}`);
}
await Bun.write(join(temp, "settings.json"), JSON.stringify({ tourDone: true, workspace: files, keepBackups: true }));
const worker = new Worker(new URL("../src/server.ts", import.meta.url).href);
let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
const check = (ok: boolean, message: string) => { if (!ok) throw new Error(message); console.log(`ok  ${message}`); };
try {
  const port: number = await new Promise((done) => {
    worker.onmessage = (e) => e.data?.type === "ready" && done(e.data.port);
    worker.postMessage({ type: "start", token: "cup-music", settingsDir: temp });
  });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const clickText = async (scope: string, text: string, prefix = false) => {
    const handle = await page.evaluateHandle((scope, text, prefix) => [...document.querySelectorAll<HTMLElement>(scope)].find((el) => prefix ? el.textContent?.trim().startsWith(text) : el.textContent?.trim() === text) || null, scope, text, prefix);
    const element = handle.asElement();
    if (!element) throw new Error(`Missing ${text}`);
    await (element as any).click();
    await handle.dispose();
  };
  const music = (slot: string) => `[data-slot="${slot}"] [aria-label="Music of this position"]`;
  const openCups = async () => {
    await page.evaluate(() => { void (window as any).app.cmd("cups"); });
    await page.waitForSelector(music("farm_course"));
  };
  const choose = async (slot: string, track: string) => {
    await page.click(music(slot));
    await clickText('[role="menuitem"]', "Music of another track");
    await clickText('[role="menuitem"]', track, true);
  };
  const confirmation = async () => {
    await clickText('[role="dialog"] button', "Apply changes…");
    await page.waitForSelector('[role="dialog"] [role="checkbox"]');
    check(await page.$eval('[role="dialog"] [role="checkbox"]', (el) => el.getAttribute("aria-checked") === "true"), "Apply always offers a checked backup checkbox");
  };
  const apply = async (backup: boolean) => {
    await confirmation();
    if (!backup) await page.click('[role="dialog"] [role="checkbox"]');
    await clickText('[role="dialog"] button', backup ? "Back up and apply" : "Apply without backup");
    await page.waitForSelector('[role="dialog"] [role="checkbox"]', { hidden: true });
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLButtonElement>("button")].some((b) => b.textContent?.trim() === "Apply changes…" && b.disabled));
    await page.evaluate(() => (window as any).app.settingsSave);
  };
  const shown = async (slot: string, stream: string) => {
    const labels: Record<string, string> = {
      n_Circuit32: "Mario Circuit / Luigi Circuit", n_Shopping32: "Coconut Mall", n_Farm: "Moo Moo Meadows", n_Kinoko: "Mushroom Gorge",
    };
    return (await page.$eval(music(slot), (el) => el.textContent!.trim())) === `${stream} (${labels[stream]})`;
  };
  const written = (target: string, source: string) => ["n", "f"].every((lap) => readFileSync(join(sound, `${target}_${lap}.brstm`), "utf8") === `${source} ${lap}`);
  await page.goto(`http://127.0.0.1:${port}/?t=cup-music`, { waitUntil: "networkidle0" });
  await openCups();
  await choose("farm_course", "Mario Circuit");
  await confirmation();
  if (process.argv[2]) await page.screenshot({ path: process.argv[2] });
  await page.click('[role="dialog"] [role="checkbox"]');
  await clickText('[role="dialog"] button', "Cancel");
  await page.waitForSelector('[role="dialog"] [role="checkbox"]', { hidden: true });
  check(written("n_Farm", "n_Farm") && (await listSnapshots(temp)).length === 0, "cancelling the confirmation writes no music or backups");
  await apply(false);
  check(written("n_Farm", "n_Circuit32"), "Apply writes both normal and final-lap music");
  check(await shown("farm_course", "n_Circuit32"), "the selected music stays visible after Apply");
  check((await listSnapshots(temp)).length === 0 && !existsSync(join(sound, "n_Farm_n.brstm.bak")) && !existsSync(join(sound, "n_Farm_f.brstm.bak")), "unchecking backup creates neither a snapshot nor .bak files with global backups on");
  await page.click('[aria-label="Close cups editor"]');
  await page.waitForSelector('[data-slot="farm_course"]', { hidden: true });
  await openCups();
  check(await shown("farm_course", "n_Circuit32"), "reopening Cups keeps the applied music visible");
  await page.reload({ waitUntil: "networkidle0" });
  await openCups();
  check(await shown("farm_course", "n_Circuit32"), "restarting the editor restores the music display");
  await page.evaluate(() => (window as any).app.setSetting("keepBackups", false));
  await choose("kinoko_course", "Moo Moo Meadows");
  await apply(true);
  check(written("n_Kinoko", "n_Circuit32") && await shown("kinoko_course", "n_Circuit32") && await shown("farm_course", "n_Circuit32"), "subsequent changes copy the current music and preserve applied choices");
  check((await listSnapshots(temp)).length === 1 && !existsSync(join(sound, "n_Kinoko_n.brstm.bak")), "checking backup creates a snapshot with global backups off");
  await choose("farm_course", "Coconut Mall");
  await apply(true);
  check(written("n_Farm", "n_Shopping32") && await shown("farm_course", "n_Shopping32"), "a different choice replaces the previously applied music");
  const restoreLatest = async (expected: string) => {
    await clickText('[role="dialog"] button', "Backups");
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Restore…"));
    await clickText('[role="dialog"] button', "Restore…");
    await page.waitForFunction(() => document.body.textContent?.includes("Put these files back?"));
    await clickText('[role="alertdialog"] button', "Restore");
    await page.waitForSelector('[role="alertdialog"]', { hidden: true });
    await page.waitForFunction((expected) => {
      const app = (window as any).app;
      return !app.busy && (Object.values(app.cupMusicByFolder) as any[]).some((m) => m.n_Farm?.from === expected);
    }, {}, expected);
    await page.click('[aria-label="Back"]');
    await page.waitForSelector(music("farm_course"));
  };
  await restoreLatest("n_Circuit32");
  check(written("n_Farm", "n_Circuit32") && await shown("farm_course", "n_Circuit32"), "restoring a backup restores both music bytes and the displayed source");
  check(await shown("kinoko_course", "n_Circuit32"), "restoring Farm music leaves other slots alone");
  await restoreLatest("n_Shopping32");
  check(written("n_Farm", "n_Shopping32") && await shown("farm_course", "n_Shopping32"), "the pre-restore backup can undo restoration, including the display");
  await page.click('[aria-label="Close cups editor"]');
  await page.waitForSelector('[aria-label="Close cups editor"]', { hidden: true });
  await page.evaluate(() => { void (window as any).app.cmd("thp"); });
  await page.waitForSelector('[aria-label="Close preview video editor"]');
  await clickText('[role="dialog"] button', "Backups");
  await page.waitForSelector('[aria-label="Back"]');
  await page.click('[aria-label="Back"]');
  await page.waitForSelector('[aria-label="Back"]', { hidden: true });
  check(!!await page.$('[aria-label="Close preview video editor"]') && !!await page.$('nav[aria-label="Videos"]'), "Back returns to preview videos without closing the modal");
  check(errors.length === 0, "no browser errors");
} finally {
  await browser?.close();
  worker.terminate();
  const target = resolve(temp);
  if (!target.startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe temporary test path");
  rmSync(target, { recursive: true, force: true });
}
