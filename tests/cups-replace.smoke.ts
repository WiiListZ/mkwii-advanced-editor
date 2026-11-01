// Direct Rename and Replace → Create a new track in the vanilla cups, including cancellation
// while an existing document is dirty. Generated archives are checked, without running the game.
// Usage: bun run tests/cups-replace.smoke.ts [screenshot.png]
import puppeteer from "puppeteer-core";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { findFile, parseU8 } from "../web/js/formats/u8.js";
import { parseKMP } from "../web/js/formats/kmp.js";
import { parseBRRES } from "../web/js/formats/brres.js";
import { yaz0Decompress } from "../web/js/formats/yaz0.js";

const temp = mkdtempSync(join(tmpdir(), "mkwii-cups-replace-"));
const files = join(temp, "files"), original = join(files, "Race", "Course", "farm_course.szs");
let generated = "";
mkdirSync(join(files, "Race", "Course"), { recursive: true });
await Bun.write(original, "Original slot must stay unchanged until Apply");
await Bun.write(join(temp, "settings.json"), JSON.stringify({ tourDone: true, workspace: files }));
const worker = new Worker(new URL("../src/server.ts", import.meta.url).href);
let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
const check = (ok: boolean, message: string) => { if (!ok) throw new Error(message); console.log(`ok  ${message}`); };
try {
  const port: number = await new Promise((done) => {
    worker.onmessage = (e) => e.data?.type === "ready" && done(e.data.port);
    worker.postMessage({ type: "start", token: "cup-replace", settingsDir: temp });
  });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 940 });
  const errors: string[] = [];
  page.on("pageerror", (e) => { errors.push(e.message); console.error(e.message); });
  let saves = 0;
  let failModels = false;
  page.on("response", (r) => { if (new URL(r.url()).pathname === "/api/cup-track" && r.request().method() === "POST") void r.json().then((v) => { generated = v.path; }); });
  await page.setRequestInterception(true);
  page.on("request", (q) => {
    if (new URL(q.url()).pathname === "/api/generated-track-models" && failModels) return void q.respond({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Model converter fixture failure" }) });
    if (new URL(q.url()).pathname !== "/api/save-dialog") return void q.continue();
    saves++;
    void q.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ path: null }) });
  });
  const clickText = async (scope: string, text: string) => {
    const handle = await page.evaluateHandle((scope, text) => [...document.querySelectorAll<HTMLElement>(scope)].find((el) => el.textContent?.trim() === text) || null, scope, text);
    const element = handle.asElement();
    if (!element) throw new Error(`Missing ${text}`);
    await (element as any).click();
    await handle.dispose();
  };
  await page.goto(`http://127.0.0.1:${port}/?t=cup-replace`, { waitUntil: "networkidle0" });
  await page.evaluate(() => { void (window as any).app.cmd("cups"); });
  const row = '[data-slot="farm_course"]';
  await page.waitForSelector(row);
  check(await page.$eval(row, (el) => {
    const buttons = [...el.querySelectorAll("button")].map((b) => b.textContent?.trim());
    return buttons.indexOf("Rename…") === buttons.indexOf("Replace") + 1;
  }), "Rename is a button directly beside Replace");
  await clickText(`${row} button`, "Replace");
  check(!await page.$eval('[role="menu"]', (el) => el.textContent?.includes("Rename")), "Replace no longer contains Rename");
  await clickText('[role="menuitem"]', "Create a new track…");
  await page.waitForFunction(() => document.body.textContent?.includes("Three steps: draw the shape"));
  await page.evaluate(() => { (window as any).app.doc.dirty = true; });
  await clickText('[role="dialog"] button', "Cancel");
  await page.waitForFunction(() => !document.body.textContent?.includes("Three steps: draw the shape"));
  check(saves === 0 && !existsSync(generated), "cancelling the generator does not save the previously open document");
  check(!await page.$eval(row, (el) => el.textContent?.includes("from file")), "cancelling leaves the selected slot unchanged");
  check(await page.evaluate(() => (window as any).app.doc.dirty), "cancelling keeps the existing document's unsaved changes");
  await page.evaluate(() => { (window as any).app.doc.dirty = false; });
  failModels = true;
  await page.evaluate(() => { (window as any).__oldTrack = (window as any).app.doc.kmp; });
  await clickText(`${row} button`, "Replace");
  await clickText('[role="menuitem"]', "Create a new track…");
  await page.waitForFunction(() => document.body.textContent?.includes("Three steps: draw the shape"));
  await clickText('[role="dialog"] button', "Generate track");
  await page.waitForFunction(() => document.body.textContent?.includes("Track generation failed"));
  check(saves === 0 && !existsSync(generated) && await page.evaluate(() => (window as any).app.doc.kmp === (window as any).__oldTrack), "conversion failure preserves the existing document and saves no incomplete archive");
  await clickText('[role="alertdialog"] button', "OK");
  await page.waitForFunction(() => !document.body.textContent?.includes("Track generation failed"));
  failModels = false;
  await clickText(`${row} button`, "Replace");
  await clickText('[role="menuitem"]', "Create a new track…");
  await page.waitForFunction(() => document.body.textContent?.includes("Three steps: draw the shape"));
  await clickText('[role="dialog"] button', "Generate track");
  await page.waitForFunction(() => document.querySelector('[data-slot="farm_course"]')?.textContent?.includes("New Mushroom Cup - Track 2") && document.querySelector('[data-slot="farm_course"]')?.textContent?.includes("ready to use"), { timeout: 60000 });
  check(saves === 0 && existsSync(generated), "the new track is assigned directly to its cup position without a Save as dialog");
  check(!await page.$eval('[data-slot="beginner_course"]', (el) => el.textContent?.includes("from file")), "other positions keep their tracks");
  check(!await page.$eval("body", (el) => el.textContent?.includes("Track created")), "the standalone creation dialog does not cover the replacement flow");
  const childTarget = await browser.waitForTarget((target) => new URL(target.url() || "about:blank").searchParams.get("open") === generated);
  const child = await childTarget.page();
  await child!.waitForFunction(() => !!(window as any).app?.cupTrackLink?.pending && (window as any).app.doc.kcl.count > 0);
  check(await page.evaluate(() => (window as any).app.doc.kmp === (window as any).__oldTrack), "creating a cup track opens its own editor without replacing the previous document");
  await child!.setRequestInterception(true);
  child!.on("request", (q) => { if (new URL(q.url()).pathname === "/api/save-dialog") { saves++; void q.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ path: null }) }); } else void q.continue(); });
  await child!.evaluate(async () => { const a = (window as any).app; a.doc.change("Set laps", () => { a.doc.kmp.STGI[0].laps = 4; }); await a.save(); });
  check(saves === 0 && parseKMP(findFile(parseU8(yaz0Decompress(new Uint8Array(readFileSync(generated)))), "course.kmp").data).STGI[0].laps === 4, "Save before Apply keeps the cup track's edits automatically without touching the game");
  check(await page.$$eval('button', (buttons) => buttons.some((b) => b.textContent?.trim() === "Apply changes…" && !b.disabled)), "the generated track passes its checks and can be applied immediately");
  const tree = parseU8(yaz0Decompress(new Uint8Array(readFileSync(generated))));
  const kmp = parseKMP(findFile(tree, "course.kmp").data);
  check(kmp.KTPT.length > 0 && kmp.CKPT[0].points.length > 0 && !!findFile(tree, "course.kcl"), "the saved archive contains the generated start, checkpoints and collision");
  for (const name of ["course_model.brres", "vrcorn_model.brres", "map_model.brres"]) {
    const brres = parseBRRES(findFile(tree, name)!.data);
    check(brres.models.some((m: any) => m.objects.some((o: any) => o.triangles > 0)) && brres.textures.size > 0, `the saved ${name} contains real geometry and textures`);
  }
  await clickText(`${row} button`, "Rename…");
  await page.waitForSelector(`${row} input[aria-label="New name"]`);
  await page.click(`${row} input[aria-label="New name"]`, { clickCount: 3 });
  await page.type(`${row} input[aria-label="New name"]`, "My New Track");
  await clickText(`${row} button`, "OK");
  check(await page.$eval(row, (el) => el.textContent?.includes("My New Track")), "the separate Rename button renames the replacement track");
  check(readFileSync(original, "utf8") === "Original slot must stay unchanged until Apply", "the game's original track has not been overwritten");
  await clickText('[role="dialog"] button', "Apply changes…");
  await page.waitForFunction(() => document.body.textContent?.includes("Apply the new cups?"));
  await clickText('[role="dialog"] label', "Make a backup first?");
  await clickText('[role="dialog"] button', "Apply without backup");
  await child!.waitForFunction((path) => (window as any).app.doc.filePath === path && !(window as any).app.cupTrackLink?.pending, { timeout: 15000 }, original);
  check(parseKMP(findFile(parseU8(yaz0Decompress(new Uint8Array(readFileSync(original)))), "course.kmp").data).STGI[0].laps === 4, "Apply installs the generated track into the selected cup's game archive");
  await child!.evaluate(async () => { const a = (window as any).app; a.doc.change("Set laps again", () => { a.doc.kmp.STGI[0].laps = 5; }); await a.save(); });
  check(saves === 0 && parseKMP(findFile(parseU8(yaz0Decompress(new Uint8Array(readFileSync(original)))), "course.kmp").data).STGI[0].laps === 5 && parseKMP(findFile(parseU8(yaz0Decompress(new Uint8Array(readFileSync(generated)))), "course.kmp").data).STGI[0].laps === 4, "after Apply the same editor saves directly to that cup position, with no destination prompt");
  if (process.argv[2]) await page.screenshot({ path: process.argv[2] });
  check(errors.length === 0, "no browser errors");
} finally {
  await browser?.close();
  worker.terminate();
  const target = resolve(temp);
  if (!target.startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe temporary test path");
  rmSync(target, { recursive: true, force: true });
}
