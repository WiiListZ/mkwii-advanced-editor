// Cups of mods with their own cups, end to end on temporary copies (the originals are only read):
// - a Pulsar pack (MKWII_PULSAR_DIR = the pack folder with Binaries/Config.pul, e.g. Insane Kart Wii's IKWv2):
//   two tracks change places, a new cup with four tracks from a file and its own icon is added;
// - an LE-CODE distribution (MKWII_LECODE_BIN = an official lecode-PAL.bin) built from the game files:
//   two tracks change places and a new cup with four new tracks is added.
// The written files are read back and checked; screenshots go to docs/images.
// Usage: MKWII_GAME_DIR=<game files> MKWII_PULSAR_DIR=<pack> MKWII_LECODE_BIN=<lecode-PAL.bin>
//        bun run --preload ./scripts/readme-privacy.ts scripts/capture-mod-cups.ts
import puppeteer from "puppeteer-core";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep, win32 } from "node:path";
import { parsePulsarConfig, crc32 } from "../web/js/formats/pulsar.js";
import { parseLECode } from "../web/js/formats/lecode.js";
import { parseBMG } from "../web/js/formats/bmg.js";
import { findFile, parseU8 } from "../web/js/formats/u8.js";
import { yaz0Decompress } from "../web/js/formats/yaz0.js";

const game = process.env.MKWII_GAME_DIR, pulsarDir = process.env.MKWII_PULSAR_DIR, lecodeBin = process.env.MKWII_LECODE_BIN;
if (!game || !existsSync(join(game, "Race", "Common.szs"))) throw new Error("Set MKWII_GAME_DIR to the extracted game's files directory");
const out = (name: string) => join(import.meta.dir, "..", "docs", "images", name);
const temp = mkdtempSync(join(tmpdir(), "mkwii-mod-cups-"));
const check = (ok: boolean, what: string) => { if (!ok) throw new Error(`Check failed: ${what}`); console.log(`ok  ${what}`); };
const copy = (from: string, to: string) => { mkdirSync(join(to, ".."), { recursive: true }); copyFileSync(from, to); };
const custom = win32.join(win32.normalize(temp), "My tracks", "Sunset Raceway.szs");
copy(join(game, "Race", "Course", "old_mario_gc.szs"), custom);
const iconPng = win32.join(win32.normalize(temp), "My tracks", "icon.png");
copyFileSync(join(import.meta.dir, "..", "web", "icon.png"), iconPng);

// The Pulsar pack: its config, icons, the tracks and expert ghosts of the first cups.
let pack = "";
if (pulsarDir && existsSync(join(pulsarDir, "Binaries", "Config.pul"))) {
  pack = win32.join(win32.normalize(temp), "IKWv2");
  for (const f of ["Binaries/Config.pul", "Assets/UIAssets.szs", "Ghosts/FolderToTrackName.txt"]) if (existsSync(join(pulsarDir, f))) copy(join(pulsarDir, f), join(pack, f));
  for (let i = 0; i < 12; i++) {
    copy(join(pulsarDir, "Tracks", `${i}.szs`), join(pack, "Tracks", `${i}.szs`));
    for (const mode of ["150", "200", "150F", "200F"]) if (existsSync(join(pulsarDir, "Ghosts", "Experts", `${i}_${mode}.rkg`))) copy(join(pulsarDir, "Ghosts", "Experts", `${i}_${mode}.rkg`), join(pack, "Ghosts", "Experts", `${i}_${mode}.rkg`));
  }
}

// The LE-CODE distribution: the official binary, the original tracks under their slot numbers, and the game text.
let distribution = "";
if (lecodeBin && existsSync(lecodeBin)) {
  distribution = win32.join(win32.normalize(temp), "lecode", "files");
  copy(lecodeBin, join(distribution, "rel", "lecode-PAL.bin"));
  const names: Record<number, string> = { 0x00: "castle_course", 0x01: "farm_course", 0x02: "kinoko_course", 0x04: "factory_course", 0x05: "shopping_course", 0x06: "boardcross_course", 0x07: "truck_course", 0x08: "beginner_course" };
  for (const [slot, name] of Object.entries(names)) copy(join(game, "Race", "Course", `${name}.szs`), join(distribution, "Race", "Course", `${Number(slot).toString(16).padStart(3, "0")}.szs`));
  copy(join(game, "Race", "Common.szs"), join(distribution, "Race", "Common.szs"));
  for (const f of readdirSync(join(game, "Scene", "UI"))) if (/_[A-Z]\.szs$/i.test(f)) copy(join(game, "Scene", "UI", f), join(distribution, "Scene", "UI", f));
}

await Bun.write(join(temp, "settings.json"), JSON.stringify({ tourDone: true, workspace: win32.normalize(resolve(game)), commonPath: win32.join(win32.normalize(resolve(game)), "Race", "Common.szs"), keepBackups: false }));
const worker = new Worker(new URL("../src/server.ts", import.meta.url).href);
let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
try {
  const port: number = await new Promise((r) => {
    worker.onmessage = (event) => event.data?.type === "ready" && r(event.data.port);
    worker.postMessage({ type: "start", token: "shots", settingsDir: temp });
  });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"], protocolTimeout: 240000 });
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 940, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  // File dialogs: the mod to open, the track file and the icon picture.
  let modToOpen = "";
  // Where "New cup" creates a new mod (a temporary "SD card").
  const newModFolder = win32.join(win32.normalize(temp), "SD");
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path === "/api/open-dialog") {
      const title = String(JSON.parse(request.postData() || "{}").title || "");
      const answer = /^Open the cups of a mod/.test(title) ? modToOpen : /^Icon for/.test(title) ? iconPng : custom;
      request.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ path: answer }) });
    } else if (path === "/api/folder-dialog") request.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ path: newModFolder }) });
    else request.continue();
  });
  await page.goto(`http://127.0.0.1:${port}/?t=shots`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => !!(window as any).app?.viewport);
  const dialog = '[role="dialog"]';
  const clickIn = async (scope: string, text: string) => {
    const handle = await page.evaluateHandle((scope, text) => {
      const roots = [...document.querySelectorAll(scope)];
      const root = roots[roots.length - 1] || document.body;
      return [...root.querySelectorAll("button, [role=menuitem], [role=option], label")].find((b) => b.textContent?.trim().startsWith(text)) || null;
    }, scope, text);
    const element = handle.asElement();
    if (!element) throw new Error(`Not found: ${text} in ${scope}`);
    await (element as any).evaluate((e: Element) => e.scrollIntoView({ block: "center" }));
    await (element as any).click();
    await sleep(250);
  };
  const hideToasts = () => page.evaluate(() => document.querySelectorAll("[data-sonner-toaster]").forEach((t) => ((t as HTMLElement).style.display = "none")));
  const showToasts = () => page.evaluate(() => document.querySelectorAll("[data-sonner-toaster]").forEach((t) => ((t as HTMLElement).style.display = "")));
  setInterval(() => { page.evaluate(() => (window as any).app?.busy).then((b) => b && console.log("[busy]", b)).catch(() => {}); }, 15000);
  const settle = async (ms = 700) => { await sleep(ms); await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); };

  await page.evaluate(() => { void (window as any).app.cmd("cups"); });
  await page.waitForFunction(() => document.body.innerText.includes("Cups of"), { timeout: 60000 });

  // A new mod with a cup of its own, made from the game's cups view.
  {
    await clickIn(`${dialog} nav[aria-label=Cups]`, "New cup");
    await page.waitForFunction(() => document.body.innerText.includes("Name of the new mod"));
    const field = await page.$('[role="dialog"] form input[type="text"]');
    await field!.click({ clickCount: 3 });
    await field!.type("TestCups");
    await clickIn(dialog, "Continue");
    await page.waitForFunction(() => document.body.innerText.includes("TestCups (new Pulsar mod)"), { timeout: 60000 });
    for (let k = 0; k < 4; k++) {
      await clickIn(`${dialog} [data-pack-track="${k}"]`, "Add a track");
      await clickIn("[role=menu]", "Track file");
    }
    await page.waitForFunction(() => document.body.innerText.split("ready to use").length > 4, { timeout: 120000 });
    await settle(800);
    await page.screenshot({ path: out("cups-new-mod.png") });
    console.log("cups-new-mod.png");
    await clickIn(dialog, "Apply changes");
    await page.waitForFunction(() => document.body.innerText.includes("Make a backup first?"));
    await clickIn(dialog, "Back up and apply");
    await page.waitForFunction(() => document.body.innerText.includes("Mod cups changed") || !!document.querySelector("[role=alertdialog]"), { timeout: 400000 });
    const failure = await page.evaluate(() => document.querySelector("[role=alertdialog]")?.textContent || "");
    if (failure) throw new Error(`Apply failed: ${failure}`);
    const root = join(newModFolder, "TestCups");
    for (const f of ["Binaries/Code.pul", "Binaries/Loader.pul", "Binaries/Config.pul", "Assets/UIAssets.szs", "Assets/CommonAssets.szs", "Assets/RaceAssets.szs", "Tracks/0.szs", "Tracks/3.szs", "Ghosts/FolderToTrackName.txt"]) check(existsSync(join(root, f)), `new mod: ${f}`);
    check(readFileSync(join(import.meta.dir, "..", "vendor", "pulsar", "Code.pul")).equals(readFileSync(join(root, "Binaries", "Code.pul"))), "new mod: the engine is the bundled Pulsar engine");
    const xml = readFileSync(join(newModFolder, "riivolution", "TestCups.xml"), "utf8");
    check(xml.includes('external="/TestCups/Tracks" disc="/Race/Course"') && !xml.includes("{$pack}"), "new mod: its Riivolution XML points at its folders");
    const made = parsePulsarConfig(new Uint8Array(readFileSync(join(root, "Binaries", "Config.pul"))));
    const texts = new Map(parseBMG(made.bmg).messages.map((m: any) => [m.id, m.text]));
    check(made.folder === "/TestCups" && made.cupCount === 1 && made.regsMode === 1 && made.info.iconCount === 1, "new mod: Config.pul has one custom cup after the game's cups");
    check(texts.get(0x10000) === "My Cup 1" && texts.get(0x20000) === "Sunset Raceway" && texts.has(0x2847) && texts.has(0x7e8), "new mod: names and the engine's texts are in its BMG");
    check(new Set(made.tracks.map((t: any) => t.crc)).size === 4 && new Set(made.alphabetical).size === 4, "new mod: four tracks with their own CRC, alphabetical order complete");
    // The window now shows the mod made, and a rename opens the game text editor on its names.
    await page.waitForFunction(() => document.body.innerText.includes("TestCups (Pulsar)"), { timeout: 60000 });
    await hideToasts();
    await page.click('[title^="Rename this cup"]');
    await page.waitForFunction(() => document.body.innerText.includes("TestCups names") && document.body.innerText.includes("My Cup 1"), { timeout: 60000 });
    await settle(800);
    await page.screenshot({ path: out("cups-rename.png") });
    console.log("cups-rename.png");
    check(true, "a cup's name opens in the game text editor");
    await page.evaluate(() => document.querySelector<HTMLButtonElement>('[aria-label="Close game text editor"]')?.click());
    await sleep(500);
    await showToasts();
    // Back to the game's cups for the next mods.
    await page.click("#cups-source");
    await clickIn('[role="listbox"]', "The game (8 cups");
    await sleep(500);
  }

  if (pack) {
    const config = join(pack, "Binaries", "Config.pul");
    const before = parsePulsarConfig(new Uint8Array(readFileSync(config)));
    const beforeNames = new Map(parseBMG(before.bmg).messages.map((m: any) => [m.id, m.text]));
    const t0 = readFileSync(join(pack, "Tracks", "0.szs")), t5 = readFileSync(join(pack, "Tracks", "5.szs"));
    modToOpen = win32.normalize(config);
    await clickIn(dialog, "Open a mod");
    await page.waitForFunction(() => document.body.innerText.includes("(Pulsar)"), { timeout: 120000 });
    await settle(1500);
    await page.screenshot({ path: out("cups-pulsar.png") });
    console.log("cups-pulsar.png");
    // Track 1 of cup 1 and track 2 of cup 2 change places.
    await clickIn(`${dialog} [data-pack-track="0"]`, "Swap with");
    await page.type('input[aria-label="Find a track to swap with"]', String(beforeNames.get(0x20005)));
    await sleep(300);
    await clickIn("[data-radix-popper-content-wrapper]", String(beforeNames.get(0x20005)));
    // A new cup at the end with four tracks from a file and its own icon.
    await clickIn(dialog, "New cup");
    await sleep(500);
    for (let k = 0; k < 4; k++) {
      await clickIn(`${dialog} [data-pack-track="${before.cupCount * 4 + k}"]`, "Replace");
      await clickIn("[role=menu]", "Track file");
    }
    await page.waitForFunction((n) => document.body.innerText.split("ready to use").length > n, { timeout: 120000 }, 4);
    await clickIn(dialog, "Change icon");
    await settle(800);
    await page.screenshot({ path: out("cups-pulsar-new.png") });
    console.log("cups-pulsar-new.png");
    await clickIn(dialog, "Apply changes");
    await page.waitForFunction(() => document.body.innerText.includes("Make a backup first?"));
    await clickIn(dialog, "Back up and apply");
    await page.waitForFunction(() => document.body.innerText.includes("Mod cups changed") || !!document.querySelector("[role=alertdialog]"), { timeout: 400000 });
    const failure = await page.evaluate(() => document.querySelector("[role=alertdialog]")?.textContent || "");
    if (failure) throw new Error(`Apply failed: ${failure}`);

    const after = parsePulsarConfig(new Uint8Array(readFileSync(config)));
    const names = new Map(parseBMG(after.bmg).messages.map((m: any) => [m.id, m.text]));
    check(after.cupCount === before.cupCount + 1, `the pack has ${after.cupCount} cups`);
    check(readFileSync(join(pack, "Tracks", "0.szs")).equals(t5) && readFileSync(join(pack, "Tracks", "5.szs")).equals(t0), "tracks 0 and 5 changed places");
    check(names.get(0x20000) === beforeNames.get(0x20005) && names.get(0x20005) === beforeNames.get(0x20000), "their names changed places");
    check(after.tracks[0].crc === before.tracks[5].crc && after.tracks[5].crc === before.tracks[0].crc, "their CRCs (ghost folders) changed places");
    const n = before.cupCount * 4;
    const written = readFileSync(join(pack, "Tracks", `${n}.szs`));
    check(written.equals(readFileSync(custom)) && after.tracks[n].crc === crc32(new Uint8Array(written)), "the new cup's tracks were copied, the first with the CRC-32 of its file");
    // The same file in four places: each still gets its own CRC (Pulsar tells tracks apart by it).
    check(new Set(after.tracks.map((t: any) => t.crc)).size === after.tracks.length, "every track of the pack has a different CRC");
    if (existsSync(join(pulsarDir!, "Ghosts", "FolderToTrackName.txt"))) {
      const list = readFileSync(join(pack, "Ghosts", "FolderToTrackName.txt"), "utf8");
      check([0, 1, 2, 3].every((k) => list.includes(`Sunset Raceway = ${after.tracks[n + k].crc.toString(16).toUpperCase().padStart(8, "0")}`)), "the ghost folder list names the new tracks");
    }
    check(names.get(0x10000 + before.cupCount) === `New cup ${before.cupCount + 1}` && names.get(0x20000 + n) === "Sunset Raceway", "the new cup and track have names");
    check(new Set(after.alphabetical).size === after.tracks.length && after.alphabetical.length === after.tracks.length, "the alphabetical order lists every track once");
    check(after.info.iconCount === after.cupCount, "the icon count covers the new cup");
    const ui = parseU8(yaz0Decompress(new Uint8Array(readFileSync(join(pack, "Assets", "UIAssets.szs")))));
    check(!!findFile(ui, `icon_${String(before.cupCount).padStart(4, "0")}.tpl`) || !!findFile(ui, `icon_${before.cupCount}.tpl`), "the new cup has an icon");
    check(after.info.iconCount === after.cupCount && after.data.subarray(0, 0x24).every((b: number, i: number) => i >= 0x0c && i < 0x14 ? true : b === before.data[i]), "the pack header and other settings are unchanged");
    await showToasts(); await hideToasts();
  }

  if (distribution) {
    const bin = join(distribution, "rel", "lecode-PAL.bin");
    const before = parseLECode(new Uint8Array(readFileSync(bin)));
    modToOpen = win32.normalize(bin);
    await clickIn(dialog, "Open a mod");
    // Opening the distribution makes it the workspace: keep the Common.szs already loaded.
    await page.waitForFunction(() => document.body.innerText.includes("Keep current Common.szs") || document.body.innerText.includes("Cup 1 of"), { timeout: 120000 });
    if (await page.evaluate(() => document.body.innerText.includes("Keep current Common.szs"))) await clickIn("[role=alertdialog]", "Keep current Common.szs");
    await page.waitForFunction(() => document.body.innerText.includes("LE-CODE v"), { timeout: 120000 });
    await settle(1500);
    // The first cup's tracks 1 and 2 change places, then a new cup with four tracks from a file.
    await page.click(`${dialog} [data-pack-track="0"] button[aria-label="Move down"]`);
    await sleep(300);
    await clickIn(dialog, "New cup");
    await sleep(500);
    for (let k = 0; k < 4; k++) {
      await clickIn(`${dialog} [data-pack-track="${before.cups.length * 4 + k}"]`, "Replace");
      await clickIn("[role=menu]", "Track file");
    }
    await page.waitForFunction((n) => document.body.innerText.split("ready to use").length > n, { timeout: 120000 }, 4);
    await settle(800);
    await page.screenshot({ path: out("cups-lecode.png") });
    console.log("cups-lecode.png");
    await clickIn(dialog, "Apply changes");
    await page.waitForFunction(() => document.body.innerText.includes("Make a backup first?"));
    await clickIn(dialog, "Back up and apply");
    await page.waitForFunction(() => document.body.innerText.includes("Mod cups changed") || !!document.querySelector("[role=alertdialog]"), { timeout: 400000 });
    const failure = await page.evaluate(() => document.querySelector("[role=alertdialog]")?.textContent || "");
    if (failure) throw new Error(`Apply failed: ${failure}`);
    const after = parseLECode(new Uint8Array(readFileSync(bin)));
    check(after.cups.length === before.cups.length + 1, `the distribution has ${after.cups.length} cups`);
    check(after.cups[0][0] === before.cups[0][1] && after.cups[0][1] === before.cups[0][0], "the first cup lists its first two tracks the other way round");
    const newSlots = after.cups[after.cups.length - 1];
    check(newSlots.every((s: number, k: number) => s === 0x44 + k) && after.slots.length === 0x48, "the new tracks got slots 0x44–0x47");
    check(newSlots.every((s: number) => readFileSync(join(distribution, "Race", "Course", `${s.toString(16).padStart(3, "0")}.szs`)).equals(readFileSync(custom))), "their archives are Race/Course/044–047.szs");
    const menu = parseU8(yaz0Decompress(new Uint8Array(readFileSync(join(distribution, "Scene", "UI", "MenuSingle_E.szs")))));
    const texts = new Map(parseBMG(findFile(menu, "Common.bmg").data).messages.map((m: any) => [m.id, m.text]));
    check(texts.get(0x7044) === "Sunset Raceway" && texts.get(0x6800 + before.cups.length) === `New cup ${before.cups.length + 1}`, "track and cup names were added to Common.bmg");
    check(after.data.length === before.data.length, "the binary keeps its size (written in place)");
  }
} finally {
  await browser?.close();
  worker.terminate();
  if (!resolve(temp).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe temporary path");
  rmSync(temp, { recursive: true, force: true });
}
