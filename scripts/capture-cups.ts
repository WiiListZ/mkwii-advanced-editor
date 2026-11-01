// Screenshots of Cups and tracks and of the track generator for the README, and an end-to-end check
// of a cup change: Coconut Mall and Luigi Circuit swap places, Moo Moo Meadows is replaced by a
// track file, the change is applied with a backup, checked on disk, then restored from the backup.
// Everything runs on a temporary copy of the game files: the real game folder is only read.
// Usage: MKWII_GAME_DIR=<extracted game files> bun run --preload ./scripts/readme-privacy.ts scripts/capture-cups.ts
// Add --cups-only to refresh just the Cups and tracks screenshots.
import puppeteer from "puppeteer-core";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep, win32 } from "node:path";
import { yaz0Decompress } from "../web/js/formats/yaz0.js";
import { findFile, parseU8 } from "../web/js/formats/u8.js";
import { parseBMG } from "../web/js/formats/bmg.js";
import { parseTHP } from "../web/js/formats/thp.js";
import { parseBRSTM } from "../web/js/formats/brstm.js";
import { encodeWAV, toInt16 } from "../web/js/editor/audio.js";

const game = process.env.MKWII_GAME_DIR;
const cupsOnly = process.argv.includes("--cups-only");
if (!game || !existsSync(join(game, "Race", "Common.szs"))) throw new Error("Set MKWII_GAME_DIR to the extracted game's files directory");
const out = (name: string) => join(import.meta.dir, "..", "docs", "images", name);
const temp = mkdtempSync(join(tmpdir(), "mkwii-cups-shots-"));
const files = win32.join(win32.normalize(temp), "files");

// The copy holds what the cups change: the tracks of two cups, their music and every language archive.
const copy = (...parts: string[]) => {
  const from = join(game, ...parts), to = join(files, ...parts);
  if (!existsSync(from)) return;
  mkdirSync(join(to, ".."), { recursive: true });
  copyFileSync(from, to);
};
copy("Race", "Common.szs");
for (const t of ["beginner_course", "farm_course", "kinoko_course", "factory_course", "castle_course", "shopping_course", "boardcross_course", "truck_course"])
  for (const suffix of ["", "_d"]) copy("Race", "Course", `${t}${suffix}.szs`);
for (const f of readdirSync(join(game, "sound", "strm"))) if (/^(n_Circuit32|n_Shopping32|n_Farm)_/i.test(f)) copy("sound", "strm", f);
for (const f of readdirSync(join(game, "Scene", "UI"))) if (/_[A-Z]\.szs$/i.test(f) || /^(Font|MenuSingle)\.szs$/i.test(f)) copy("Scene", "UI", f);
for (const f of ["kinoko.thp", "flower.thp", "cup_select.thp"]) copy("thp", "course", f);
// A "custom track" chosen from disk: a retro track under another name.
const custom = win32.join(win32.normalize(temp), "My tracks", "Sunset Raceway.szs");
mkdirSync(join(temp, "My tracks"), { recursive: true });
copyFileSync(join(game, "Race", "Course", "old_mario_gc.szs"), custom);

// An audio file of the person's for the music of a position: 20 seconds of a chord, as WAV.
const song = win32.join(win32.normalize(temp), "My music", "Sunset theme.wav");
mkdirSync(join(temp, "My music"), { recursive: true });
{
  const rate = 32000, n = rate * 20;
  const tone = (shift: number) => Float32Array.from({ length: n }, (_, i) => 0.25 * (Math.sin(2 * Math.PI * (220 + shift) * i / rate) + Math.sin(2 * Math.PI * (330 + shift) * i / rate)) * (0.6 + 0.4 * Math.sin(i / rate * 3)));
  writeFileSync(song, encodeWAV([toInt16(tone(0)), toInt16(tone(2))], rate));
}

const original = (...parts: string[]) => readFileSync(join(files, ...parts));
const before = {
  luigi: original("Race", "Course", "beginner_course.szs"), mall: original("Race", "Course", "shopping_course.szs"),
  moo: original("Race", "Course", "farm_course.szs"), mallMusic: original("sound", "strm", "n_Shopping32_n.brstm"),
  luigiMusic: original("sound", "strm", "n_Circuit32_n.brstm"), farmMusic: original("sound", "strm", "n_Farm_n.brstm"), menu: original("Scene", "UI", "MenuSingle_E.szs"),
  kinoko: original("thp", "course", "kinoko.thp"), flower: original("thp", "course", "flower.thp"),
};
const commonText = (path: string, id: number) => {
  const tree = parseU8(yaz0Decompress(new Uint8Array(readFileSync(path))));
  return parseBMG(findFile(tree, "Common.bmg").data).messages.find((m: any) => m.id === id)?.text;
};
const check = (ok: boolean, what: string) => { if (!ok) throw new Error(`Check failed: ${what}`); console.log(`ok  ${what}`); };

await Bun.write(join(temp, "settings.json"), JSON.stringify({ tourDone: true, workspace: files, commonPath: win32.join(files, "Race", "Common.szs"), keepBackups: false }));
const worker = new Worker(new URL("../src/server.ts", import.meta.url).href);
let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
try {
  capture: {
  const port: number = await new Promise((r) => {
    worker.onmessage = (event) => event.data?.type === "ready" && r(event.data.port);
    worker.postMessage({ type: "start", token: "shots", settingsDir: temp });
  });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"], protocolTimeout: 240000 });
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 940, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    // The file chooser answers with the track file, or the audio file when music is asked for.
    if (path === "/api/open-dialog") request.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ path: /Music for/.test(request.postData() || "") ? song : custom }) });
    else request.continue();
  });
  await page.goto(`http://127.0.0.1:${port}/?t=shots`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => !!(window as any).app?.viewport);
  const settle = async (ms = 600) => { await sleep(ms); await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); };
  const hideToasts = () => page.evaluate(() => document.querySelectorAll("[data-sonner-toaster]").forEach((t) => ((t as HTMLElement).style.display = "none")));
  const showToasts = () => page.evaluate(() => document.querySelectorAll("[data-sonner-toaster]").forEach((t) => ((t as HTMLElement).style.display = "")));
  // Real mouse clicks (Radix menus open on pointer events).
  const clickIn = async (scope: string, text: string) => {
    const handle = await page.evaluateHandle((scope, text) => {
      const roots = [...document.querySelectorAll(scope)];
      const root = roots[roots.length - 1] || document.body;
      return [...root.querySelectorAll("button, [role=menuitem], label")].find((b) => b.textContent?.trim().startsWith(text)) || null;
    }, scope, text);
    const element = handle.asElement();
    if (!element) throw new Error(`Not found: ${text} in ${scope}`);
    await (element as any).evaluate((e: Element) => e.scrollIntoView({ block: "center" }));
    await (element as any).click();
    await sleep(250);
  };
  const dialog = '[role="dialog"]';

  // Home with the new tile.
  await page.evaluate(() => (window as any).app.refreshWorkspaceInfo());
  await settle(800);

  // The cups window, with its explanation opened by "How it works".
  await page.evaluate(() => { void (window as any).app.cmd("cups"); });
  await page.waitForFunction(() => document.body.innerText.includes("names in language"), { timeout: 60000 });
  await clickIn(dialog, "How it works");
  await settle();
  await page.screenshot({ path: out("cups.png") });
  console.log("cups.png");

  // Coconut Mall goes where Luigi Circuit was.
  await clickIn(dialog, "Hide");
  await clickIn("nav[aria-label=Cups]", "Flower Cup");
  if (cupsOnly) {
    await page.waitForFunction(() => [...document.querySelectorAll('[data-slot] canvas')].some((c) => (c as HTMLCanvasElement).width > 0), { timeout: 60000 });
    await settle(1500);
    await page.mouse.move(1450, 900);
    await page.screenshot({ path: out("cups-previews.png") });
    console.log("cups-previews.png");
  }
  await clickIn(`${dialog} [data-slot="shopping_course"]`, "Swap with");
  await clickIn("[role=menu]", "Mushroom Cup 1");
  // Moo Moo Meadows is replaced by a track file.
  await clickIn("nav[aria-label=Cups]", "Mushroom Cup");
  await clickIn(`${dialog} [data-slot="farm_course"]`, "Replace");
  await clickIn("[role=menu]", "Track file");
  await page.waitForFunction(() => document.body.innerText.includes("ready to use"), { timeout: 60000 });
  await settle();
  await page.screenshot({ path: out("cups-swap.png") });
  console.log("cups-swap.png");

  // Apply always offers the per-operation backup checkbox, also with .bak backups off in Settings.
  await clickIn(dialog, "Apply changes");
  await page.waitForFunction(() => document.body.innerText.includes("Make a backup first?"));
  await settle();
  await page.screenshot({ path: out("cups-apply.png") });
  console.log("cups-apply.png");
  await clickIn(dialog, "Back up and apply");
  await page.waitForFunction(() => document.body.innerText.includes("Cups changed"), { timeout: 240000 });
  await sleep(500);

  const after = (...parts: string[]) => readFileSync(join(files, ...parts));
  check(after("Race", "Course", "beginner_course.szs").equals(before.mall), "Luigi Circuit's slot holds Coconut Mall");
  check(after("Race", "Course", "shopping_course.szs").equals(before.luigi), "Coconut Mall's slot holds Luigi Circuit");
  check(after("Race", "Course", "farm_course.szs").equals(readFileSync(custom)), "Moo Moo Meadows' slot holds the track file");
  check(after("sound", "strm", "n_Shopping32_n.brstm").equals(before.luigiMusic), "Luigi Circuit's music moved with it");
  check(after("sound", "strm", "n_Circuit32_n.brstm").equals(before.luigiMusic), "the music shared with Mario Circuit stayed");
  const menu = join(files, "Scene", "UI", "MenuSingle_E.szs");
  check(commonText(menu, 0x245c) === "Coconut Mall" && commonText(menu, 0x2498) === "Coconut Mall", "Mushroom Cup 1 is named Coconut Mall");
  check(commonText(menu, 0x2459) === "Luigi Circuit", "Flower Cup 2 is named Luigi Circuit");
  check(commonText(menu, 0x2455) === "Sunset Raceway", "the track file got its name");
  check(commonText(join(files, "Scene", "UI", "MenuSingle_I.szs"), 0x245c) === commonText(join(game, "Scene", "UI", "MenuSingle_I.szs"), 0x2459), "the Italian name followed the track too");
  check(!existsSync(join(files, "Race", "Course", "beginner_course.szs.bak")), "no .bak was made (backups off), only the cup backup");
  {
    const kinoko = parseTHP(new Uint8Array(after("thp", "course", "kinoko.thp"))), flower = parseTHP(new Uint8Array(after("thp", "course", "flower.thp")));
    check(kinoko.frames.length === 480 && flower.frames.length === 480 && kinoko.header.maxBufferSize <= parseTHP(new Uint8Array(before.kinoko)).header.maxBufferSize, "the cup preview videos were encoded again within the original frame size");
    check(!after("thp", "course", "kinoko.thp").equals(before.kinoko) && !after("thp", "course", "flower.thp").equals(before.flower), "the Mushroom and Flower Cup previews changed");
  }

  // The window shows the new names straight away.
  await page.waitForFunction(() => document.querySelector('[data-slot="beginner_course"]')?.textContent?.includes("Coconut Mall"), { timeout: 30000 });
  await hideToasts();
  await clickIn(dialog, "Backups");
  await page.waitForFunction(() => document.body.innerText.includes("files ·"), { timeout: 30000 });
  await settle();
  await page.screenshot({ path: out("cups-backups.png") });
  console.log("cups-backups.png");

  // Restore: the files come back as they were.
  await showToasts();
  await clickIn(dialog, "Restore");
  await page.waitForFunction(() => document.body.innerText.includes("Put these files back?"));
  await clickIn('[role="alertdialog"]', "Restore");
  await page.waitForFunction(() => document.body.innerText.includes("Backup restored"), { timeout: 120000 });
  check(after("Race", "Course", "beginner_course.szs").equals(before.luigi), "restore: Luigi Circuit is back");
  check(after("Race", "Course", "farm_course.szs").equals(before.moo), "restore: Moo Moo Meadows is back");
  check(after("sound", "strm", "n_Shopping32_n.brstm").equals(before.mallMusic), "restore: Coconut Mall's music is back");
  check(after("Scene", "UI", "MenuSingle_E.szs").equals(before.menu), "restore: game text is back byte for byte");
  check(after("thp", "course", "kinoko.thp").equals(before.kinoko), "restore: the Mushroom Cup preview video is back byte for byte");

  // Music: Moo Moo Meadows gets an audio file of the person's, converted when applied.
  await hideToasts();
  await clickIn(dialog, "Backups");
  await clickIn("nav[aria-label=Cups]", "Mushroom Cup");
  await page.waitForSelector('[data-slot="farm_course"] [aria-label="Music of this position"]', { timeout: 30000 });
  await (await page.$('[data-slot="farm_course"] [aria-label="Music of this position"]'))!.click();
  await sleep(300);
  await clickIn("[role=menu]", "Audio file");
  await page.waitForFunction(() => document.body.innerText.includes("Use this music"), { timeout: 30000 });
  await clickIn('[role="dialog"]', "Use this music");
  await page.waitForFunction(() => document.querySelector('[data-slot="farm_course"]')?.textContent?.includes("Sunset theme (audio file)"), { timeout: 30000 });
  // Toad's Factory takes the music of Coconut Mall: the menu with the other tracks, for the README.
  await (await page.$('[data-slot="factory_course"] [aria-label="Music of this position"]'))!.click();
  await sleep(300);
  const sub = await page.evaluateHandle(() => [...document.querySelectorAll("[role=menuitem]")].find((e) => e.textContent?.includes("Music of another track")));
  await (sub.asElement() as any).hover();
  await page.waitForFunction(() => document.querySelectorAll("[role=menu]").length > 1, { timeout: 10000 });
  await settle(400);
  await page.screenshot({ path: out("cups-music.png") });
  console.log("cups-music.png");
  if (cupsOnly) break capture;
  // Closes the menu without choosing (the menu is the top layer, so the window stays open).
  await page.keyboard.press("Escape");
  await sleep(300);
  await showToasts();
  await clickIn(dialog, "Apply changes");
  await page.waitForFunction(() => document.body.innerText.includes("Make a backup first?"));
  await clickIn(dialog, "Back up and apply");
  // Applied: the choice stays visible, while the pending-change badge disappears.
  await page.waitForFunction(() => {
    const text = document.querySelector('[data-slot="farm_course"]')?.textContent || "";
    return text.includes("(audio file)") && !text.includes("music changed") && !(window as any).app.busy;
  }, { timeout: 240000 });
  await sleep(500);
  {
    const normal = parseBRSTM(new Uint8Array(after("sound", "strm", "n_Farm_n.brstm")));
    const old = parseBRSTM(new Uint8Array(before.farmMusic));
    const finalName = readdirSync(join(files, "sound", "strm")).find((f) => /^n_Farm_f\.brstm$/i.test(f))!;
    const final = parseBRSTM(new Uint8Array(readFileSync(join(files, "sound", "strm", finalName))));
    check(normal.sampleRate === old.sampleRate && normal.channels === old.channels && normal.tracks.length === old.tracks.length, "the audio file became Moo Moo Meadows' music in the original's format");
    check(Math.abs(normal.samples - old.sampleRate * 20) < old.sampleRate * 0.1 && normal.loop, `the converted music is 20 seconds and loops (${normal.samples} samples at ${normal.sampleRate} Hz, loop ${normal.loop})`);
    check(final.samples < normal.samples * 0.95, "the final lap version plays faster");
    check(after("Race", "Course", "farm_course.szs").equals(before.moo), "the track itself is unchanged");
  }
  await hideToasts();
  await clickIn(dialog, "Backups");
  await page.waitForFunction(() => document.body.innerText.includes("files ·"), { timeout: 30000 });
  await clickIn(dialog, "Restore");
  await page.waitForFunction(() => document.body.innerText.includes("Put these files back?"));
  await clickIn('[role="alertdialog"]', "Restore");
  for (let i = 0; i < 240 && !after("sound", "strm", "n_Farm_n.brstm").equals(before.farmMusic); i++) await sleep(500);
  check(after("sound", "strm", "n_Farm_n.brstm").equals(before.farmMusic), "restore: Moo Moo Meadows' music is back byte for byte");
  await sleep(1000);
  await showToasts();
  await page.keyboard.press("Escape");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[aria-label="Close cups editor"]')?.click());
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), { timeout: 10000 });
  await hideToasts();

  // Preview videos: Coconut Mall's preview into Luigi Circuit's part of the Mushroom Cup video.
  await page.evaluate(() => { void (window as any).app.cmd("thp"); });
  await page.waitForSelector('[data-testid="thp-canvas"]', { timeout: 60000 });
  await settle(800);
  await clickIn(`${dialog} aside`, "1 ·");
  await clickIn(`${dialog} aside`, "From another preview");
  await clickIn("[role=menu]", "Flower Cup 2");
  await page.evaluate(() => { const r = document.querySelector<HTMLInputElement>('input[aria-label="Frame"]')!; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; set.call(r, "240"); r.dispatchEvent(new Event("input", { bubbles: true })); });
  await settle(1200);
  await page.screenshot({ path: out("thp.png") });
  console.log("thp.png");
  await clickIn(dialog, "Save video");
  await page.waitForFunction(() => document.body.innerText.includes("Save the preview video?"));
  await clickIn(dialog, "Back up and save");
  await page.waitForFunction(() => document.body.innerText.includes("Preview video saved"), { timeout: 240000 });
  {
    const saved = parseTHP(new Uint8Array(after("thp", "course", "kinoko.thp")));
    check(saved.frames.length === 480 && saved.video.width === 400 && !after("thp", "course", "kinoko.thp").equals(before.kinoko), "Preview videos: the edited THP was saved and reads back");
  }
  await hideToasts();
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[aria-label="Close preview video editor"]')?.click());
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), { timeout: 10000 });

  // Sounds and music: the export formats.
  await page.evaluate(() => { void (window as any).app.cmd("audio"); });
  await page.waitForFunction(() => document.body.innerText.includes("Moo Moo Meadows · normal"), { timeout: 60000 });
  await clickIn(dialog, "Moo Moo Meadows · normal");
  await page.waitForFunction(() => document.body.innerText.includes("Loops from"), { timeout: 60000 });
  await clickIn(dialog, "Export");
  await page.waitForSelector('[role="menuitem"]');
  await settle(500);
  await page.screenshot({ path: out("audio-export.png") });
  console.log("audio-export.png");
  await page.keyboard.press("Escape");
  await sleep(300);
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.getAttribute("aria-label")?.startsWith("Close"))?.click());
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), { timeout: 10000 });

  // The track generator: its three steps, the drawing tools and the layout check.
  await page.evaluate(() => { void (window as any).app.cmd("newTrack"); });
  await page.waitForSelector('[data-testid="generator-canvas"]');
  await settle(1000);
  await page.screenshot({ path: out("track-generator.png") });
  console.log("track-generator.png");

  // Drawing a figure of eight by hand, without a bridge: the check marks where the road crosses itself, which is built as a bridge.
  await clickIn(dialog, "Draw by hand");
  const box = (await (await page.$('[data-testid="generator-canvas"]'))!.boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  // Started on the right loop, so the start line is not at the crossing.
  const at = (t: number) => [cx + Math.sin(t + Math.PI / 2) * box.width * 0.36, cy + Math.sin(t + Math.PI / 2) * Math.cos(t + Math.PI / 2) * box.height * 0.62];
  await page.mouse.move(...(at(0) as [number, number]));
  await page.mouse.down();
  for (let i = 1; i <= 90; i++) await page.mouse.move(...(at((i / 90) * Math.PI * 2 * 0.97) as [number, number]));
  await sleep(200);
  await page.screenshot({ path: out("track-generator-draw.png") });
  console.log("track-generator-draw.png");
  await page.mouse.up();
  await page.waitForFunction(() => document.body.innerText.includes("built as a bridge"));
  await settle();
  await page.screenshot({ path: out("track-generator-check.png") });
  console.log("track-generator-check.png");
  await clickIn(dialog, "Cancel");
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), { timeout: 10000 });

  // Track rows: the cup's video plays behind them, and a click on a row opens that track.
  await page.evaluate(() => { void (window as any).app.cmd("cups"); });
  await page.waitForFunction(() => document.body.innerText.includes("names in language"), { timeout: 60000 });
  await clickIn("nav[aria-label=Cups]", "Flower Cup");
  await page.waitForFunction(() => [...document.querySelectorAll('[data-slot] canvas')].some((c) => (c as HTMLCanvasElement).width > 0), { timeout: 60000 });
  await settle(1500);
  await page.screenshot({ path: out("cups-previews.png") });
  console.log("cups-previews.png");

  // All tracks: every track file with search, version and type filters and the preview videos.
  await clickIn("nav[aria-label=Cups]", "All tracks");
  await page.waitForFunction(() => [...document.querySelectorAll("[data-previews] canvas")].some((c) => (c as HTMLCanvasElement).width > 0), { timeout: 60000 });
  await settle(1500);
  await page.screenshot({ path: out("library-cups.png") });
  console.log("library-cups.png");
  await clickIn("nav[aria-label=Cups]", "Flower Cup");
  await page.waitForSelector('[data-slot="castle_course"]');
  const row = await page.$('[data-slot="castle_course"] .truncate');
  await row!.click();
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]') && (window as any).app.doc.fileName === "castle_course.szs", { timeout: 120000 });
  check(true, "a click on a track row opens it in the editor");
  await page.evaluate(() => (window as any).app.cmd("home"));
  await settle(800);

  // Object documentation: the picker with each object's label (Documented, Partially documented or
  // Unknown and its percentage), and an object's documentation beside it.
  await page.evaluate(() => { void (window as any).app.pickObject(0x65, "add"); });
  await page.waitForSelector("[role=option]", { timeout: 30000 });
  await page.evaluate(() => ([...document.querySelectorAll("[role=option]")].find((o) => /itembox/.test(o.textContent || "")) as HTMLElement)?.click());
  await page.waitForSelector("[data-documentation-status]", { timeout: 30000 });
  await settle(1500);
  await page.screenshot({ path: out("object-documentation-status.png") });
  console.log("object-documentation-status.png");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), { timeout: 10000 });

  // The documentation JSON edited in the editor: a mistake is found at once, with where it is.
  await page.evaluate(() => { void (window as any).app.cmd("home"); });
  await clickIn("body", "Edit JSON");
  await page.waitForSelector('textarea[aria-label="Object documentation JSON"]', { timeout: 30000 });
  await page.evaluate(() => {
    const area = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Object documentation JSON"]')!;
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    set.call(area, area.value.replace('"documented": 75', '"documented": 175'));
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelector("[data-json-check]")?.textContent?.includes("0 to 100"), { timeout: 10000 });
  await settle(400);
  await page.screenshot({ path: out("object-documentation-editor.png") });
  console.log("object-documentation-editor.png");
  check(true, "the documentation JSON editor finds a wrong value as it is typed");
  await clickIn('[role="dialog"]', "Cancel");
  await clickIn('[role="alertdialog"]', "Close without saving");
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), { timeout: 10000 });

  // Game data of Common.szs: the rumble patterns (vibration.krm) and the Grand Prix time limits (ranktimeGP.krt).
  await page.evaluate(() => { void (window as any).app.cmd("gameParams"); });
  await page.waitForFunction(() => document.body.innerText.includes("vibration.krm"), { timeout: 60000 });
  await clickIn('[role="dialog"]', "vibration.krm");
  await clickIn('[role="dialog"]', "Pattern 8");
  await page.waitForSelector('input[aria-label="Rumble pattern"]');
  await settle(400);
  await page.screenshot({ path: out("game-data-krm.png") });
  console.log("game-data-krm.png");
  await clickIn('[role="dialog"]', "ranktimeGP.krt");
  await clickIn('[role="dialog"]', "Luigi Circuit");
  await settle(400);
  await page.screenshot({ path: out("game-data-krt.png") });
  console.log("game-data-krt.png");
  check(await page.evaluate(() => document.body.innerText.includes("150cc and Mirror time limit")), "ranktimeGP.krt opens with its time limits");
  await clickIn('[role="dialog"]', "minigame.kmg");
  check(await page.evaluate(() => document.body.innerText.includes("Balloon Battle · points")), "minigame.kmg opens with the Battle settings");
  }
} catch (error) {
  // Where it stopped, for the person running the script (not a README picture).
  if (process.env.CAPTURE_FAILURE) await (await browser?.pages())?.at(-1)?.screenshot({ path: process.env.CAPTURE_FAILURE }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  worker.terminate();
  if (!resolve(temp).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe temporary path");
  rmSync(temp, { recursive: true, force: true });
}
