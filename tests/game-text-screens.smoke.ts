// Game text editor: every kind of game screen is drawn from the game's Scene/UI files, with the
// edited text in its place. Usage: MKWII_GAME_DIR=<extracted game>/files bun run tests/game-text-screens.smoke.ts <screenshot-dir>
import puppeteer from "puppeteer-core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const out = process.argv[2] || tmpdir();
const game = process.env.MKWII_GAME_DIR;
if (!game) throw new Error("Set MKWII_GAME_DIR to the extracted game's files folder");
const settings = mkdtempSync(join(tmpdir(), "mkwii-gt-"));
await Bun.write(join(settings, "settings.json"), JSON.stringify({ tourDone: true }));
const worker = new Worker(new URL("../src/server.ts", import.meta.url).href);
const port: number = await new Promise((r) => { worker.onmessage = (e) => e.data?.type === "ready" && r(e.data.port); worker.postMessage({ type: "start", token: "gt", settingsDir: settings }); });
const browser = await puppeteer.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const errors: string[] = [];
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.stack || e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.setViewport({ width: 1500, height: 950 });
  await page.goto(`http://127.0.0.1:${port}/?t=gt`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => !!(window as any).app?.viewport);
  await page.evaluate(async (common) => { const app = (window as any).app; await app.loadCommonFrom(common, true); app.cmd("gameText"); }, join(game, "Race/Common.szs"));
  await page.waitForFunction(() => document.body.innerText.includes(" messages"), { timeout: 60000 });
  const search = async (q: string, name: string, edit?: string) => {
    const input = await page.$('input[placeholder^="Find text"]');
    await input!.click({ clickCount: 3 });
    await input!.type(q);
    await wait(600);
    if (edit !== undefined) {
      const ta = await page.$("textarea");
      await ta!.click({ clickCount: 3 });
      await page.keyboard.type(edit);
    }
    await page.waitForFunction(() => document.body.innerText.includes("Drawn from the game's own files"), { timeout: 30000 }).catch(() => {});
    await wait(500);
    await page.screenshot({ path: join(out, name + ".png") });
    const caption = await page.evaluate(() => document.querySelector('canvas[role="img"]')?.getAttribute("aria-label"));
    const drawn = await page.evaluate(() => document.body.innerText.includes("Drawn from the game's own files"));
    if (!drawn) throw new Error(`${name}: the game screen was not drawn`);
    console.log(name, caption);
  };
  await search("Mushroom Gorge", "gt-course");
  await search("0x2339", "gt-character", "Birdo Edit");
  await search("Standard Kart M", "gt-vehicle");
  await search("Block Plaza", "gt-battle");
  await search("Grand Prix for beginners", "gt-instruction");
  await search("not available yet", "gt-window");
  await search("Change Character", "gt-pause");
  // Text wider than its box is squeezed like in the game; there is no overflow warning any more.
  await search("0x24B9", "gt-overflow", "Block Plaza Expanded Arena");
  if (await page.evaluate(() => document.body.innerText.includes("Text exceeds"))) throw new Error("Overflow warning is still shown");
  await search("Wii System Memory. Either", "gt-system-memory");
  await search("0x0857", "gt-button-overflow", "This button label is much longer than the original");
  const buttonCaption = await page.evaluate(() => document.querySelector('canvas[role="img"]')?.getAttribute('aria-label'));
  if (!buttonCaption?.includes("Menu button")) throw new Error("Automatic screen changed while editing a button label");
} finally {
  console.log(errors.length ? "ERRORS:\n" + errors.slice(0, 10).join("\n") : "No page errors");
  await browser.close(); worker.terminate(); rmSync(settings, { recursive: true, force: true });
}
