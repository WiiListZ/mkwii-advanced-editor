// Riivolution mod editor: the files edited in the workspace are listed, and Export writes the XML,
// copies the files where the XML points and writes a Dolphin launcher.
// Usage: MKWII_GAME_DIR=<extracted game>/files bun run tests/riivolution.smoke.ts [screenshot.png]
import puppeteer from "puppeteer-core";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRiivolution } from "../web/js/formats/riivolution.js";

const game = process.env.MKWII_GAME_DIR;
if (!game) throw new Error("Set MKWII_GAME_DIR to the extracted game's files folder");
const root = mkdtempSync(join(tmpdir(), "mkwii-riivo-")), files = join(root, "files"), dest = join(root, "sd");
const settings = mkdtempSync(join(tmpdir(), "mkwii-riivo-settings-"));
mkdirSync(join(files, "Race", "Course"), { recursive: true });
copyFileSync(join(game, "Race", "Common.szs"), join(files, "Race", "Common.szs"));
const track = join(files, "Race", "Course", "beginner_course.szs");
copyFileSync(join(game, "Race", "Course", "beginner_course.szs"), track);
copyFileSync(track, track + ".bak"); // edited by the editor: it kept the original
copyFileSync(join(game, "Race", "Course", "castle_course.szs"), join(files, "Race", "Course", "castle_course.szs")); // not edited
await Bun.write(join(settings, "settings.json"), JSON.stringify({ tourDone: true, workspace: files }));
const worker = new Worker(new URL("../src/server.ts", import.meta.url).href);
const port: number = await new Promise((r) => { worker.onmessage = (e) => e.data?.type === "ready" && r(e.data.port); worker.postMessage({ type: "start", token: "riivo", settingsDir: settings }); });
const browser = await puppeteer.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const errors: string[] = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewport({ width: 1600, height: 950 });
  // Windows dialogs answered by the test: the export folder and the launcher file.
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    const path = new URL(r.url()).pathname;
    if (path === "/api/folder-dialog") return r.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ path: dest }) });
    if (path === "/api/save-dialog") return r.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ path: join(dest, "RedItemBox.json") }) });
    r.continue();
  });
  await page.goto(`http://127.0.0.1:${port}/?t=riivo`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => !!(window as any).app?.viewport);
  await page.evaluate(() => { void (window as any).app.cmd("riivolution"); });
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLInputElement>('[role="dialog"] input')].some((i) => i.value === "/Race/Course/beginner_course.szs"), { timeout: 30000 });
  const discPaths = await page.evaluate(() => [...document.querySelectorAll<HTMLInputElement>('[role="dialog"] input')].map((i) => i.value).filter((v) => v.startsWith("/Race")));
  if (discPaths.join() !== "/Race/Course/beginner_course.szs") throw new Error("Edited files listed: " + discPaths.join());
  const typeInto = async (index: number, text: string) => {
    await page.evaluate((i, t) => {
      const input = document.querySelectorAll<HTMLInputElement>('[role="dialog"] input')[i];
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, t);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, index, text);
  };
  await typeInto(0, "Red Item Box"); // mod name
  // Unsaved changes: the X asks first (Cancel keeps the editor open).
  await page.click('button[aria-label="Close Riivolution editor"]');
  await page.waitForFunction(() => document.body.innerText.includes("Close the Riivolution editor?"));
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find((b) => b.textContent?.trim() === "Cancel")!.click());
  await page.waitForFunction(() => !document.querySelector('[role="alertdialog"]'));
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button[role="switch"]')].pop()!.click()); // Dolphin launcher
  await page.waitForFunction(() => !!document.querySelector('[role="dialog"] input[placeholder^="Game image"]'));
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('[role="dialog"] input[placeholder^="Game image"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "D:/Games/Mario Kart Wii.wbfs");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  if (process.argv[2]) { await new Promise((r) => setTimeout(r, 600)); await page.screenshot({ path: process.argv[2] }); }
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent?.includes("Export mod folder"))!.click());
  await page.waitForFunction(() => document.body.innerText.includes("Mod folder exported"), { timeout: 60000 });

  const xmlPath = join(dest, "riivolution", "RedItemBox.xml");
  if (!existsSync(xmlPath)) throw new Error("No XML at " + xmlPath);
  const mod = parseRiivolution(readFileSync(xmlPath, "utf8"));
  if (mod.game !== "RMC" || mod.sections[0].name !== "Red Item Box" || mod.patches[0].attrs.root !== "/RedItemBox") throw new Error("Unexpected XML: " + readFileSync(xmlPath, "utf8"));
  const copied = join(dest, "RedItemBox", "Race", "Course", "beginner_course.szs");
  if (!existsSync(copied) || !readFileSync(copied).equals(readFileSync(track))) throw new Error("The edited track was not copied into the mod folder");
  if (existsSync(join(dest, "RedItemBox", "Race", "Course", "castle_course.szs"))) throw new Error("An unedited file was copied");
  const launcher = JSON.parse(readFileSync(join(dest, "RedItemBox.json"), "utf8"));
  if (launcher["base-file"] !== "D:/Games/Mario Kart Wii.wbfs" || !launcher.riivolution.patches[0].xml.endsWith("riivolution/RedItemBox.xml")) throw new Error("Unexpected launcher: " + JSON.stringify(launcher));
  // Exported: the X closes straight away.
  await page.click('button[aria-label="Close Riivolution editor"]');
  await page.waitForFunction(() => !document.querySelector('button[aria-label="Close Riivolution editor"]'), { timeout: 5000 });
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("Riivolution mod exported: XML, edited files and Dolphin launcher");
} finally {
  await browser.close(); worker.terminate();
  rmSync(settings, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true });
}
