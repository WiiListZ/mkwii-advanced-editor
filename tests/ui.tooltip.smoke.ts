// Custom hints work inside the active Cups dialog, including disabled controls, and close when
// a menu, Select or newer dialog opens. No native title tooltip should compete with a row hint.
// Usage: bun run tests/ui.tooltip.smoke.ts [screenshot.png]
import puppeteer from "puppeteer-core";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

const testDir = mkdtempSync(join(tmpdir(), "mkwii-tooltips-"));
const files = join(testDir, "files");
mkdirSync(join(files, "Race", "Course"), { recursive: true });
await Bun.write(join(testDir, "settings.json"), JSON.stringify({ tourDone: true, workspace: files }));
const worker = new Worker(new URL("../src/server.ts", import.meta.url).href);
let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
const check = (ok: boolean, message: string) => { if (!ok) throw new Error(message); console.log(`ok  ${message}`); };
try {
  const port: number = await new Promise((done) => {
    worker.onmessage = (e) => e.data?.type === "ready" && done(e.data.port);
    worker.postMessage({ type: "start", token: "tooltips", settingsDir: testDir });
  });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 940 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/?t=tooltips`, { waitUntil: "networkidle0" });
  await page.evaluate(() => { void (window as any).app.cmd("cups"); });
  const row = '[data-slot="beginner_course"]';
  await page.waitForSelector(row);
  check(await page.$eval(row, (el) => !el.hasAttribute("title") && !el.querySelector("[title]")), "track rows have no competing native title tooltips");
  const control = async (label: string, disabledWrapper = false) => {
    const handle = await page.evaluateHandle((row, label, disabledWrapper) => {
      const el = [...document.querySelectorAll<HTMLElement>(`${row} button, ${row} span`)].find((el) => el.getAttribute("aria-label") === label || el.textContent?.trim() === label);
      return disabledWrapper && el?.matches("[disabled]") ? el.parentElement : el || null;
    }, row, label, disabledWrapper);
    const element = handle.asElement();
    if (!element) throw new Error(`Control not found: ${label}`);
    return element as any;
  };
  const hover = async (label: string, text: string) => {
    // Escape returns keyboard focus to a menu trigger, whose focus tooltip remains until blur.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.mouse.move(20, 20, { steps: 8 });
    await page.mouse.move(21, 20);
    await page.waitForSelector('[role="tooltip"]', { hidden: true });
    const element = await control(label, true);
    await element.hover();
    await element.dispose();
    await page.waitForFunction((text) => document.querySelector('[role="tooltip"]')?.textContent?.includes(text), {}, text);
    check(true, `${label}: the custom tooltip explains the action`);
  };
  await hover("Luigi Circuit", "unapplied cup changes");
  await hover("beginner_course.szs", "Race/Course/beginner_course.szs");
  await hover("Music of this position", "Mario Circuit / Luigi Circuit");
  await hover("Track preview video", "Each cup shares one THP file");
  check(await page.$eval('[role="tooltip"]', (el) => {
    const content = el.closest('[data-radix-popper-content-wrapper]')?.firstElementChild;
    return content?.getAttribute("data-side") === "bottom" && getComputedStyle(content).pointerEvents === "none";
  }), "THP tooltip appears below its control and lets pointer events through");
  // Move directly from THP to music, without clearing the tooltip through another area first.
  const musicAfterPreview = await control("Music of this position");
  await musicAfterPreview.hover();
  await page.waitForFunction(() => document.querySelector('[role="tooltip"]')?.textContent?.includes("Choose another track's music"));
  await musicAfterPreview.click(); await musicAfterPreview.dispose();
  await page.waitForSelector('[role="menu"]');
  await page.waitForSelector('[role="tooltip"]', { hidden: true });
  check(true, "music can be hovered and opened directly after the THP tooltip");
  await page.waitForFunction(() => [...document.querySelectorAll('[role="menu"]')].every((el) => getComputedStyle(el).pointerEvents === "auto" && el.getAnimations({ subtree: true }).every((a) => a.playState !== "running")));
  await page.keyboard.press("Escape");
  await page.waitForSelector('[role="menu"]', { hidden: true });
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Music of this position");
  await hover("Move up", "There is no previous track position");
  await hover("Move down", "Moo Moo Meadows");
  await hover("Move to the previous cup", "There is no previous cup");
  await hover("Move to the next cup", "Flower Cup 1");
  await hover("Swap with…", "Both tracks trade positions");
  await hover("Replace", "create a new track");
  await hover("Rename…", "game text editor");
  await hover("Reset this position", "no unapplied changes");
  await hover("Replace", "create a new track");
  if (process.argv[2]) {
    await page.waitForFunction(() => [...document.querySelectorAll('[data-radix-popper-content-wrapper]')].every((el) => el.getAnimations({ subtree: true }).every((a) => a.playState !== "running")));
    await page.screenshot({ path: process.argv[2] });
  }
  const replace = await control("Replace");
  await replace.click(); await replace.dispose();
  await page.waitForSelector('[role="menu"]');
  await page.waitForFunction(() => [...document.querySelectorAll('[role="menu"]')].every((el) => getComputedStyle(el).pointerEvents === "auto" && el.getAnimations({ subtree: true }).every((a) => a.playState !== "running")));
  await page.waitForSelector('[role="tooltip"]', { hidden: true });
  check(true, "opening Replace closes its tooltip");
  await page.keyboard.press("Escape");
  await page.waitForSelector('[role="menu"]', { hidden: true });
  await hover("Music of this position", "Choose another track's music");
  await page.click(`${row} [aria-label="Music of this position"]`);
  await page.waitForSelector('[role="menu"]');
  await page.waitForFunction(() => [...document.querySelectorAll('[role="menu"]')].every((el) => getComputedStyle(el).pointerEvents === "auto" && el.getAnimations({ subtree: true }).every((a) => a.playState !== "running")));
  await page.waitForSelector('[role="tooltip"]', { hidden: true });
  check(true, "opening the music menu closes its tooltip");
  await page.keyboard.press("Escape");
  await page.waitForSelector('[role="menu"]', { hidden: true });
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Music of this position");
  await hover("Rename…", "game text editor");
  await page.click("#cups-source");
  await page.waitForSelector('[role="listbox"]');
  await page.waitForSelector('[role="tooltip"]', { hidden: true });
  check(true, "Select menus remain free of tooltip overlays");
  await page.keyboard.press("Escape");
  await page.waitForSelector('[role="listbox"]', { hidden: true });
  await hover("Replace", "create a new track");
  await page.evaluate(() => { void (window as any).app.cmd("settingsDialog"); });
  await page.waitForSelector("[data-settings-panel]");
  await page.waitForSelector('[role="tooltip"]', { hidden: true });
  check(true, "opening a newer dialog also closes the covered dialog's tooltip");
  check(errors.length === 0, "no browser errors");
} finally {
  await browser?.close();
  worker.terminate();
  const target = resolve(testDir);
  if (!target.startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe temporary test path");
  rmSync(target, { recursive: true, force: true });
}
