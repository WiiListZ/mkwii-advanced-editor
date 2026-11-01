// Exercises the vanilla → new cup → Apply flow and its platform-independent Riivolution export,
// with and without a backup. The synthetic track checks packaging, without running the game.
// Usage: bun run tests/new-cups.smoke.ts [screenshot-directory]
import puppeteer from "puppeteer-core";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { buildKMP, emptyKMP, make } from "../web/js/formats/kmp.js";
import { buildU8, findFile, parseU8 } from "../web/js/formats/u8.js";
import { yaz0Decompress } from "../web/js/formats/yaz0.js";
import { parseBRRES } from "../web/js/formats/brres.js";
import { parsePulsarConfig } from "../web/js/formats/pulsar.js";
import { parseRiivolution } from "../web/js/formats/riivolution.js";
import { listSnapshots } from "../src/snapshots.ts";

const temp = mkdtempSync(join(tmpdir(), "mkwii-new-cups-"));
const files = join(temp, "vanilla", "files"), destination = join(temp, "SD");
mkdirSync(join(files, "Race", "Course"), { recursive: true });
const original = join(files, "Race", "Course", "original.szs"), track = join(temp, "Fixture.szs");
await Bun.write(original, "Original game track: must stay unchanged");
const kmp = emptyKMP();
kmp.KTPT.push(make.KTPT());
kmp.CKPT.push(make.group([make.CKPT()]));
await Bun.write(track, buildU8({ name: "root", children: [
  { name: "course.kmp", data: buildKMP(kmp) },
  ...["course.kcl", "course_model.brres", "vrcorn_model.brres", "map_model.brres"].map((name) => ({ name, data: new Uint8Array(32) })),
] }));
await Bun.write(join(temp, "settings.json"), JSON.stringify({ tourDone: true, workspace: files, keepBackups: true }));
const worker = new Worker(new URL("../src/server.ts", import.meta.url).href);
let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
const check = (ok: boolean, message: string) => { if (!ok) throw new Error(message); console.log(`ok  ${message}`); };
try {
  const port: number = await new Promise((done) => {
    worker.onmessage = (e) => e.data?.type === "ready" && done(e.data.port);
    worker.postMessage({ type: "start", token: "new-cups", settingsDir: temp });
  });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  for (const backup of [true, false]) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1500, height: 940 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const name = backup ? "BackupCups" : "NoBackupCups";
    let generatedPath = "", saves = 0;
    page.on("response", (r) => { if (new URL(r.url()).pathname === "/api/cup-track" && r.request().method() === "POST") void r.json().then((v) => { generatedPath = v.path; }); });
    let imageChoices = 0;
    const reveals: string[] = [];
    let revealFailure = false;
    await page.setRequestInterception(true);
    page.on("request", (q) => {
      const path = new URL(q.url()).pathname;
      if (path === "/api/reveal") {
        reveals.push(new URL(q.url()).searchParams.get("path") || "");
        void q.respond({ status: revealFailure ? 500 : 200, contentType: "application/json", body: JSON.stringify(revealFailure ? { error: "XML file is no longer available" } : { ok: true }) });
      } else if (path === "/api/open-dialog") {
        const game = String(JSON.parse(q.postData() || "{}").title).includes("game image");
        if (game) imageChoices++;
        void q.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ path: track }) });
      } else if (path === "/api/save-dialog") {
        saves++;
        void q.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ path: null }) });
      } else if (path === "/api/folder-dialog") {
        void q.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ path: destination }) });
      } else void q.continue();
    });
    const clickText = async (scope: string, text: string) => {
      const handle = await page.evaluateHandle((scope, text) => [...document.querySelectorAll<HTMLElement>(scope)].find((el) => el.textContent?.trim() === text && el.closest('[role="dialog"]')?.getAttribute("data-state") !== "closed") || null, scope, text);
      const element = handle.asElement();
      if (!element) throw new Error(`Missing ${text}`);
      await (element as any).click();
      await handle.dispose();
    };
    await page.goto(`http://127.0.0.1:${port}/?t=new-cups`, { waitUntil: "networkidle0" });
    await page.evaluate(() => { void (window as any).app.cmd("cups"); });
    await page.waitForSelector('nav[aria-label="Cups"]');
    await clickText('nav[aria-label="Cups"] button', "New cup…");
    await page.waitForSelector('[role="dialog"] form input[type="text"]');
    const input = await page.$('[role="dialog"] form input[type="text"]');
    await input!.click({ clickCount: 3 });
    await input!.type(name);
    check(await page.$$eval('[role="dialog"] form [role="combobox"]', (els) => els.length === 1), `${name}: New cup only asks for its destination pack and name`);
    check(!await page.$eval('[role="dialog"] form', (el) => el.textContent?.includes("Play on")), `${name}: no platform selector is shown`);
    if (process.argv[2]) {
      await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"] form')].every((form) => form.closest('[role="dialog"]')!.getAnimations().every((a) => a.playState !== "running")));
      await page.screenshot({ path: join(process.argv[2], `new-cups-${name}-setup.png`) });
    }
    await clickText('[role="dialog"] form button', "Continue");
    await page.waitForSelector("[data-cup-play]");
    await page.waitForSelector('[role="dialog"] form', { hidden: true });
    const originals = '[aria-label="Keep original game cups"]';
    check(await page.$eval(originals, (el) => el.getAttribute("aria-checked") === "true") && await page.$$eval("[data-original-cup]", (els) => els.length === 8), `${name}: the original eight cups coexist with the custom cup by default`);
    await page.click('[data-original-cup="0"]');
    await page.waitForSelector('[data-original-cup-view="0"]');
    check(await page.$$eval("[data-original-track]", (els) => els.length === 4) && await page.$eval('[data-original-cup-view="0"]', (el) => el.textContent?.includes("Luigi Circuit")), `${name}: original cups can be browsed without replacing their tracks`);
    if (process.argv[2]) await page.screenshot({ path: join(process.argv[2], `new-cups-${name}-originals.png`) });
    await clickText('[data-original-cup-view] button', "Back to custom cups");
    await page.click(originals);
    check(await page.$$eval("[data-original-cup]", (els) => els.length === 0), `${name}: hiding original cups keeps the custom cup intact`);
    await page.click(originals);
    check(imageChoices === 0, `${name}: creating a Riivolution pack never asks for a game image`);
    check(!existsSync(join(destination, name)), `${name}: nothing is written before Apply`);
    await clickText('[role="dialog"] button', "Discard");
    await page.waitForFunction(() => document.querySelectorAll("[data-pack-track]").length === 4);
    check(errors.length === 0, `${name}: discarding a new pack keeps the first cup selected`);
    check(await page.$$eval('button', (buttons) => buttons.some((b) => b.textContent?.trim() === "Apply changes…" && b.disabled)) && await page.$eval('body', (b) => b.textContent?.includes("Add at least one track before applying.")), `${name}: an entirely empty cup explains why Apply is disabled`);
    for (let i = 0; i < (backup ? 1 : 4); i++) {
      await page.click(`[data-pack-track="${i}"] [aria-label="Add a track to position ${i + 1}"]`);
      await page.waitForSelector('[role="menu"]');
      if (backup && i === 0) {
        await clickText('[role="menuitem"]', "New custom track (draw it)…");
        await page.waitForFunction(() => document.body.textContent?.includes("Three steps: draw the shape"));
        await clickText('[role="dialog"] button', "Generate track");
      } else await clickText('[role="menuitem"]', "Track file (.szs, .wbz…)…");
      await page.waitForFunction((i) => document.querySelector(`[data-pack-track="${i}"]`)?.textContent?.includes("ready to use"), {}, i);
    }
    await page.waitForFunction((n) => document.body.textContent!.split("ready to use").length === n + 1, {}, backup ? 1 : 4);
    check(saves === 0, `${name}: creating a track for this cup never asks where to save its SZS`);
    if (backup) {
      check(await page.$$eval('button', (buttons) => buttons.some((b) => b.textContent?.trim() === "Apply changes…" && !b.disabled)), `${name}: Apply works with one valid track and three empty positions`);
      await clickText('[role="dialog"] button', "Apply changes…");
      await page.waitForSelector('[role="dialog"] form');
      check(await page.$eval('[role="dialog"] form', (el) => el.textContent?.includes("3 positions are still empty")), `${name}: Apply explains that cups need four races and offers an explicit repeat choice`);
      if (process.argv[2]) await page.screenshot({ path: join(process.argv[2], `new-cups-${name}-fill.png`) });
      await clickText('[role="dialog"] form button', "Cancel");
      await page.waitForSelector('[role="dialog"] form', { hidden: true });
      check(await page.$$eval('[data-pack-track] [aria-label^="Add a track to position"]', (els) => els.length === 3) && !existsSync(join(destination, name)), `${name}: cancelling the fill choice leaves the three empty positions and files unchanged`);
    }
    const replaceHint = await page.evaluateHandle(() => [...document.querySelectorAll<HTMLButtonElement>('[data-pack-track="0"] button')].find((b) => b.textContent?.trim() === "Replace")!);
    await (replaceHint.asElement() as any).hover();
    await page.waitForFunction(() => document.querySelector('[role="tooltip"]')?.textContent?.includes("this mod position"));
    await replaceHint.dispose();
    check(true, `${name}: mod track controls show their custom tooltips inside the dialog`);
    await clickText('[data-pack-track="0"] button', "Rename…");
    await page.waitForSelector('[data-pack-track="0"] input[aria-label="New name"]');
    await page.click('[data-pack-track="0"] input[aria-label="New name"]', { clickCount: 3 });
    await page.type('[data-pack-track="0"] input[aria-label="New name"]', "Named from button");
    await clickText('[data-pack-track="0"] button', "OK");
    check(await page.$eval('[data-pack-track="0"]', (el) => el.textContent?.includes("Named from button")), `${name}: mod tracks have a working Rename button beside Replace`);
    await clickText('[data-pack-track="0"] button', "Replace");
    check(!await page.$eval('[role="menu"]', (el) => el.textContent?.includes("Rename")), `${name}: Replace does not contain Rename`);
    await clickText('[role="menuitem"]', "Create a new track…");
    await page.waitForFunction(() => document.body.textContent?.includes("Three steps: draw the shape"));
    await clickText('[role="dialog"] button', "Cancel");
    await page.waitForFunction(() => !document.body.textContent?.includes("Three steps: draw the shape"));
    check(await page.$eval('[data-pack-track="0"]', (el) => el.textContent?.includes("Named from button")), `${name}: cancelling creation leaves the mod track in place`);
    if (process.argv[2]) await page.screenshot({ path: join(process.argv[2], `new-cups-${name}-before.png`) });
    await clickText('[role="dialog"] button', "Apply changes…");
    if (backup) {
      await page.waitForSelector('[role="dialog"] form');
      await clickText('[role="dialog"] form button', "Fill and review…");
      await page.waitForFunction(() => document.body.textContent?.includes("Apply the new cups to the mod?"));
      await page.waitForSelector('[role="dialog"] form', { hidden: true });
      check(await page.$eval('body', (el) => el.textContent!.split("Named from button").length >= 5), `${name}: the final summary includes the names of all four repeated races`);
      await clickText('[role="dialog"] button', "Cancel");
      await page.waitForFunction(() => !document.body.textContent?.includes("Apply the new cups to the mod?"));
      check(await page.$$eval('[data-pack-track] [aria-label^="Add a track to position"]', (els) => els.length === 3) && !existsSync(join(destination, name)), `${name}: cancelling the final review leaves the arrangement and files unchanged`);
      await clickText('[role="dialog"] button', "Apply changes…");
      await page.waitForSelector('[role="dialog"] form');
      await clickText('[role="dialog"] form button', "Fill and review…");
    }
    await page.waitForFunction(() => document.body.textContent?.includes("Apply the new cups to the mod?"));
    await page.waitForSelector('[role="dialog"] [role="checkbox"]');
    const backupCount = (await listSnapshots(temp)).length;
    if (!backup) await clickText('[role="dialog"] label', "Make a backup first?");
    await clickText('[role="dialog"] button', backup ? "Back up and apply" : "Apply without backup");
    await page.waitForFunction((name) => document.body.textContent?.includes(`${name} (Pulsar)`) || !!document.querySelector('[role="alertdialog"]'), { timeout: 60000 }, name);
    const failure = await page.$eval("body", (b) => b.querySelector('[role="alertdialog"]')?.textContent);
    if (failure) throw new Error(failure);
    check((await listSnapshots(temp)).length === backupCount + (backup ? 1 : 0), `${name}: mod cups respect the backup checkbox`);
    await page.waitForFunction(() => document.querySelector("[data-cup-play]")?.textContent?.includes("Show Riivolution XML"));
    check(!!await page.$(`[data-cup-play] button`), `${name}: the Riivolution instructions and XML button stay visible after Apply`);
    await page.waitForSelector('[data-sonner-toast] [data-action]', { visible: true });
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll<HTMLElement>('[data-sonner-toast] [data-action]')].find((b) => b.textContent === "Show Riivolution XML");
      if (!button) return false;
      const r = button.getBoundingClientRect();
      return r.top > 0 && r.bottom < innerHeight;
    });
    const toastReveal = page.waitForRequest((q) => new URL(q.url()).pathname === "/api/reveal", { timeout: 5000 });
    toastReveal.catch(() => {});
    await clickText('[data-sonner-toast] button', "Show Riivolution XML");
    await toastReveal;
    check(resolve(reveals.at(-1)!) === join(destination, "riivolution", `${name}.xml`), `${name}: the creation toast's XML button works while Cups and tracks stays open`);
    check(!!await page.$('[data-cup-play]'), `${name}: clicking the toast does not dismiss Cups and tracks`);
    const bannerReveal = page.waitForRequest((q) => new URL(q.url()).pathname === "/api/reveal", { timeout: 5000 });
    await clickText('[data-cup-play] button', "Show Riivolution XML");
    await bannerReveal;
    check(reveals.length === 2 && reveals[0] === reveals[1], `${name}: the persistent XML button reveals the same file`);
    revealFailure = true;
    await clickText('[data-cup-play] button', "Show Riivolution XML");
    await page.waitForFunction(() => document.querySelector('[data-sonner-toast][data-type="error"]')?.textContent?.includes("XML file is no longer available"));
    check(true, `${name}: a reveal failure is shown to the user instead of silently doing nothing`);
    revealFailure = false;
    if (process.argv[2]) await page.screenshot({ path: join(process.argv[2], `new-cups-${name}-after.png`) });
    const config = parsePulsarConfig(new Uint8Array(readFileSync(join(destination, name, "Binaries", "Config.pul")))) as any;
    check(config.cupCount === 1 && config.regsMode === 1 && config.tracks.length === 4, `${name}: one custom cup follows the original game cups`);
    check(new Set(config.tracks.map((t: any) => t.crc)).size === 4, `${name}: repeated files have separate track identities`);
    if (backup) {
      const generatedTarget = await browser.waitForTarget((t) => new URL(t.url() || "about:blank").searchParams.get("open") === generatedPath);
      const generatedEditor = (await generatedTarget.page())!;
      await generatedEditor.waitForFunction((path) => (window as any).app?.doc.filePath === path && !(window as any).app.cupTrackLink?.pending, {}, join(destination, name, "Tracks", "0.szs"));
      check(true, `${name}: after Apply the generated track editor is linked directly to its pack position`);
      const archive = readFileSync(join(destination, name, "Tracks", "0.szs"));
      check([1, 2, 3].every((i) => readFileSync(join(destination, name, "Tracks", `${i}.szs`)).equals(archive)), `${name}: a single generated track produces all four race archives`);
      const generated = parseU8(yaz0Decompress(new Uint8Array(archive)));
      for (const resource of ["course_model.brres", "vrcorn_model.brres", "map_model.brres"]) {
        const brres = parseBRRES(findFile(generated, resource)!.data);
        check(brres.models[0]?.objects.some((o: any) => o.triangles > 0), `${name}: the track created directly in the mod retains ${resource} after Apply`);
      }
    }
    const xml = parseRiivolution(readFileSync(join(destination, "riivolution", `${name}.xml`), "utf8"));
    check(xml.sections[0].options[0].attrs.default === "1" && xml.sections[0].options[1].attrs.default === "0", `${name}: Pack starts enabled and My Stuff stays off`);
    for (const file of ["Code.pul", "Loader.pul"]) check(readFileSync(join(destination, name, "Binaries", file)).equals(readFileSync(new URL(`../vendor/pulsar/${file}`, import.meta.url))), `${name}: the full ${file} engine is included`);
    check(existsSync(join(destination, name, "HOW TO PLAY.txt")), `${name}: Riivolution instructions are saved with the pack`);
    check(!existsSync(join(destination, `${name}.json`)), `${name}: no platform-specific launcher is generated`);
    if (backup) {
      const customBefore = readFileSync(join(destination, name, "Tracks", "0.szs"));
      for (const enabled of [false, true]) {
        await page.click(originals);
        await clickText('[role="dialog"] button', "Apply changes…");
        await page.waitForFunction(() => document.body.textContent?.includes("Apply the new cups to the mod?"));
        await clickText('[role="dialog"] button', "Back up and apply");
        await page.waitForFunction((enabled) => document.querySelector('[aria-label="Keep original game cups"]')?.getAttribute("aria-checked") === String(enabled) && document.body.textContent?.includes("No changes"), {}, enabled);
        const changed = parsePulsarConfig(new Uint8Array(readFileSync(join(destination, name, "Binaries", "Config.pul"))));
        check(changed.regsMode === (enabled ? 1 : 0) && changed.cupCount === 1 && readFileSync(join(destination, name, "Tracks", "0.szs")).equals(customBefore), `${name}: original-cup availability persists after Apply without changing custom tracks`);
        const guide = readFileSync(join(destination, name, "HOW TO PLAY.txt"), "utf8");
        check(guide.includes(enabled ? "available together" : "custom cups only"), `${name}: Riivolution instructions match the saved original-cup setting`);
      }
      await clickText('[role="dialog"] button', "New cup");
      await page.waitForSelector('[data-pack-track="4"]');
      await clickText('[role="dialog"] button', "Apply changes…");
      await page.waitForSelector('[role="dialog"] form');
      await clickText('[role="dialog"] form button', "Fill and review…");
      await page.waitForFunction(() => document.body.textContent?.includes("Apply the new cups to the mod?"));
      await clickText('[role="dialog"] button', "Back up and apply");
      await page.waitForFunction(() => document.body.textContent?.includes("No changes") || !!document.querySelector('[role="alertdialog"]'));
      const repeatError = await page.$eval('body', (b) => b.querySelector('[role="alertdialog"]')?.textContent);
      if (repeatError) throw new Error(repeatError);
      const repeated = parsePulsarConfig(new Uint8Array(readFileSync(join(destination, name, "Binaries", "Config.pul"))));
      check(repeated.cupCount === 2 && new Set(repeated.tracks.map((t: any) => t.crc)).size === 8 && repeated.tracks[0].crc === config.tracks[0].crc && [4, 5, 6, 7].every((i) => readFileSync(join(destination, name, "Tracks", `${i}.szs`)).equals(customBefore)), `${name}: an additional empty cup can repeat a saved track with fresh identities while keeping the original custom tracks intact`);
    }
    await clickText('[data-cup-play] button', "Open Riivolution editor…");
    await page.waitForSelector('[aria-label="Close Riivolution editor"]');
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLInputElement>('input[aria-label="Option name"]')].some((input) => input.value === "Pack"));
    check(true, `${name}: the generated XML opens directly in the Riivolution editor`);
    await page.click('[aria-label="Close Riivolution editor"]');
    await page.waitForSelector('[aria-label="Close Riivolution editor"]', { hidden: true });
    check(readFileSync(original, "utf8") === "Original game track: must stay unchanged", `${name}: the original game files stay intact`);
    check(errors.length === 0, `${name}: no browser errors`);
    await page.close();
  }
} finally {
  await browser?.close();
  worker.terminate();
  const target = resolve(temp);
  if (!target.startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe temporary test path");
  rmSync(target, { recursive: true, force: true });
}
