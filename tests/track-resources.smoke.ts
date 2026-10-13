// Characters and models › Track objects on the track open in the editor: Save writes the changed
// resource into the track's SZS right away (not only into the open track), with a backup.
// Usage: MKWII_GAME_DIR=<extracted game>/files bun run tests/track-resources.smoke.ts
import puppeteer from "puppeteer-core";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findFile, parseU8 } from "../web/js/formats/u8.js";
import { yaz0Decompress } from "../web/js/formats/yaz0.js";

const game = process.env.MKWII_GAME_DIR;
if (!game) throw new Error("Set MKWII_GAME_DIR to the extracted game's files folder");
const root = mkdtempSync(join(tmpdir(), "mkwii-track-res-"));
const settings = mkdtempSync(join(tmpdir(), "mkwii-track-res-settings-"));
mkdirSync(join(root, "Race", "Course"), { recursive: true });
copyFileSync(join(game, "Race", "Common.szs"), join(root, "Race", "Common.szs"));
const track = join(root, "Race", "Course", "beginner_course.szs");
copyFileSync(join(game, "Race", "Course", "beginner_course.szs"), track);
// The split-screen version and another track hold identical copies of the pipe.
const twin = join(root, "Race", "Course", "beginner_course_d.szs"), otherTrack = join(root, "Race", "Course", "old_mario_sfc.szs");
copyFileSync(join(game, "Race", "Course", "beginner_course_d.szs"), twin);
copyFileSync(join(game, "Race", "Course", "old_mario_sfc.szs"), otherTrack);
const resourceBytes = async (file = track) => findFile(parseU8(yaz0Decompress(new Uint8Array(await Bun.file(file).arrayBuffer()))), "dokan_sfc.brres")!.data as Uint8Array;
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
const before = await resourceBytes();
await Bun.write(join(settings, "settings.json"), JSON.stringify({ tourDone: true, workspace: root }));
const worker = new Worker(new URL("../src/server.ts", import.meta.url).href);
const port: number = await new Promise((r) => { worker.onmessage = (e) => e.data?.type === "ready" && r(e.data.port); worker.postMessage({ type: "start", token: "res", settingsDir: settings }); });
const browser = await puppeteer.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"], protocolTimeout: 240000 });
const errors: string[] = [];
const click = (page: any, text: string, selector = "button") => page.evaluate((t: string, s: string) => {
  const el = [...document.querySelectorAll<HTMLElement>(s)].find((x) => x.textContent?.trim() === t);
  if (!el) throw new Error("Missing " + t);
  el.click();
}, text, selector);
let page: any;
try {
  page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewport({ width: 1600, height: 950 });
  await page.goto(`http://127.0.0.1:${port}/?t=res`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => !!(window as any).app?.viewport);
  await page.evaluate(async (p) => { const app = (window as any).app; await app.openPath(p); app.cmd("assets"); }, track);
  await page.waitForFunction(() => [...document.querySelectorAll('[role="tab"]')].some((t) => t.textContent?.trim() === "Track objects"));
  await click(page, "Track objects", '[role="tab"]');
  await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"] button')].some((b) => b.textContent?.trim() === "beginner_course.szs"), { timeout: 60000 });
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent?.trim() === "beginner_course.szs")!.click());
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent?.trim() === "dokan_sfc.brres"), { timeout: 60000 });
  await click(page, "dokan_sfc.brres");
  await page.waitForFunction(() => document.body.innerText.includes("Models ("));
  // Moves the first part of the first model: a resource change without other dialogs.
  const movePart = async () => {
    if (!(await page.$('[role="dialog"] button.pl-9'))) await page.evaluate(() => document.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label^="Expand"]')?.click());
    await page.waitForFunction(() => !!document.querySelector('[role="dialog"] button.pl-9'));
    await page.evaluate(() => document.querySelector<HTMLButtonElement>('[role="dialog"] button.pl-9')!.click());
    await click(page, "Move part…");
    await page.waitForFunction(() => document.body.innerText.includes("Move model part"));
    await page.evaluate(() => { const input = document.querySelectorAll<HTMLInputElement>('[role="dialog"] input[inputmode]')[0]; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; set.call(input, "40"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await click(page, "OK", '[role="dialog"] button');
    await page.waitForFunction(() => document.body.innerText.includes("Save 1"), { timeout: 60000 });
    await click(page, "Save 1", '[role="dialog"] button');
  };
  await movePart();
  // Copies found: the split-screen version is on by default, other tracks off.
  await page.waitForFunction(() => document.body.innerText.includes("Update the other copies?"), { timeout: 120000 });
  const switches = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button[role="switch"]')].map((b) => b.getAttribute("aria-checked")));
  if (switches.join() !== "true,false,true") throw new Error("Unexpected copy options: " + switches.join());
  // Turn off "Ask about other copies next time" (the copies are still updated this time).
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button[role="switch"]')].pop()!.click());
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].filter((b) => b.textContent?.trim() === "Save").pop()!.click());
  await page.waitForFunction(() => document.body.innerText.includes("Game archive saved"), { timeout: 120000 });
  const after = await resourceBytes();
  if (after.length === before.length && after.every((v, i) => v === before[i])) throw new Error("The resource was not written to the track file");
  if (!existsSync(track + ".bak")) throw new Error("No backup of the track file");
  if (!same(await resourceBytes(twin), after)) throw new Error("The split-screen version was not updated");
  if (!same(await resourceBytes(otherTrack), before)) throw new Error("Another track was changed although that option was off");
  const dirty = await page.evaluate(() => (window as any).app.doc.dirty);
  if (dirty) throw new Error("The open track is still marked unsaved although only the saved resource changed");
  // Asking is now off: the next save writes only this track, without looking for copies.
  if (await page.evaluate(() => (window as any).app.settings.offerCopyUpdates)) throw new Error("Turning off the question did not change the setting");
  const twinBefore = await resourceBytes(twin);
  // Count "Game archive saved" toasts as they appear (they also disappear on their own).
  await page.evaluate(() => {
    (window as any).__savedToasts = 0;
    new MutationObserver((records) => { for (const r of records) for (const n of r.addedNodes) if ((n as HTMLElement).textContent?.includes("Game archive saved")) (window as any).__savedToasts++; })
      .observe(document.body, { childList: true, subtree: true });
  });
  await movePart();
  await page.waitForFunction(() => ((window as any).__savedToasts ?? 0) > 0, { timeout: 120000 });

  if (await page.evaluate(() => document.body.innerText.includes("Update the other copies?"))) throw new Error("Asked about copies although it was turned off");
  if (same(await resourceBytes(), after)) throw new Error("The second change was not saved");
  if (!same(await resourceBytes(twin), twinBefore)) throw new Error("The split-screen version changed although copies were turned off");
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("Track resource saved into the open track's SZS and its split-screen copy, with backups");
} catch (error) {
  console.log("TOASTS:", await page?.evaluate(() => [...document.querySelectorAll("[data-sonner-toast]")].map((t) => t.textContent)).catch(() => ""));
  console.log("DIALOG TEXT:", await page?.evaluate(() => document.querySelector('[role="dialog"]')?.textContent?.slice(0, 600)).catch(() => ""));
  throw error;
} finally {
  await browser.close(); worker.terminate();
  rmSync(settings, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true });
}
