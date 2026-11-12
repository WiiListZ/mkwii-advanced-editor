// The ghost editor on copies of the game's staff ghosts, in a temporary game folder.
// MKWII_GAME_DIR=<game>/files bun run tests/ghost.smoke.ts
import puppeteer from "puppeteer-core";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { kartArchiveName } from "../web/js/editor/kart-archives.js";
import { buildRKG, inputFrames, parseRKG, timeText } from "../web/js/formats/rkg.js";

const game = process.env.MKWII_GAME_DIR;
if (!game || !existsSync(join(game, "Race", "TimeAttack", "ghost1", "ghost1_comp_00.rkg"))) {
  console.log("MKWII_GAME_DIR not set (or no staff ghosts): skipped");
  process.exit(0);
}
const temp = mkdtempSync(join(tmpdir(), "mkwii-ghost-")), files = join(temp, "files");
mkdirSync(join(files, "Race", "TimeAttack", "ghost1"), { recursive: true });
const copy = join(files, "Race", "TimeAttack", "ghost1", "ghost1_comp_00.rkg");
copyFileSync(join(game, "Race", "TimeAttack", "ghost1", "ghost1_comp_00.rkg"), copy);
await Bun.write(join(temp, "settings.json"), JSON.stringify({ tourDone: true, discordActivity: false, workspace: files }));
// The game's data and the driver of this ghost, for its kart in the 3D preview.
const sample = parseRKG(new Uint8Array(readFileSync(copy)));
const kartFile = kartArchiveName(sample.vehicle, sample.character)!;
mkdirSync(join(files, "Race", "Kart"), { recursive: true });
copyFileSync(join(game, "Race", "Common.szs"), join(files, "Race", "Common.szs"));
copyFileSync(join(game, "Race", "Kart", kartFile), join(files, "Race", "Kart", kartFile));
const bikeFile = kartArchiveName(22, 7)!;
copyFileSync(join(game, "Race", "Kart", bikeFile), join(files, "Race", "Kart", bikeFile));
// A ghost already recorded, on Luigi Circuit like the slot it will replace.
const recordedFile = join(temp, "recorded-ghosts", "Luigi Circuit 1-11-111.rkg");
mkdirSync(join(temp, "recorded-ghosts"));
await Bun.write(recordedFile, buildRKG({ ...sample, time: { minutes: 1, seconds: 11, milliseconds: 111 } }));
const recorded = parseRKG(new Uint8Array(readFileSync(recordedFile)));
const worker = new Worker(new URL("../src/server.ts", import.meta.url).href);
let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
try {
  const port: number = await new Promise((res, rej) => {
    worker.onmessage = (e) => { if (e.data?.type === "ready") res(e.data.port); if (e.data?.type === "error") rej(new Error(e.data.message)); };
    worker.postMessage({ type: "start", token: "ghost-smoke", settingsDir: temp, dolphin: false });
  });
  browser = await puppeteer.launch({
    executablePath: process.env.MKWII_TEST_BROWSER || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1500,950"],
  });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => { errors.push(String(error)); console.error("Browser error:", error); });
  await page.setViewport({ width: 1500, height: 950 });
  await page.goto(`http://127.0.0.1:${port}/?t=ghost-smoke`, { waitUntil: "networkidle0" });
  const shot = process.env.MKWII_GHOST_SCREENSHOT;
  const clickButton = (text: string) => page.evaluate((t) => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent?.trim() === t)?.click(), text);
  const before = parseRKG(new Uint8Array(readFileSync(copy)));

  // From its tile on the Home screen.
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent?.includes("Ghost editor")));
  if (shot) await page.screenshot({ path: `${shot}-home.png` });
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Ghost editor"))?.click());
  await page.waitForFunction(() => document.body.textContent?.includes("Staff ghosts of the game"));
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent?.includes("ghost1_comp_00"))?.click());
  await page.waitForSelector('[aria-label="Finish time seconds"]');
  await page.waitForFunction(() => {
    const c = document.querySelector<HTMLCanvasElement>('canvas[aria-label="Ghost inputs over time"]')!, d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < d.length; i += 4) if (d[i + 1] > 150 && d[i] < 120) return true; // the green of accelerate
    return false;
  });
  // The list shows which ghost is open, and only that one.
  const open = await page.$$eval("[data-ghost-open]", (items) => items.map((item) => item.textContent || ""));
  if (open.length !== 1 || !open[0].includes("ghost1_comp_00")) throw new Error(`The open ghost is not the one marked in the list: ${JSON.stringify(open)}`);
  if (shot) await page.screenshot({ path: `${shot}-details.png` });
  console.log("ok  staff ghost opened, with its inputs drawn, and marked in the list");

  // Preview: the real ghost's inputs play, and the clock follows the race.
  const preview = () => page.evaluate(() => {
    const root = document.querySelector<HTMLElement>("[data-ghost-preview]")!;
    return { frame: Number(root.dataset.frame), clock: root.querySelector("[data-ghost-clock]")!.textContent, accelerate: root.querySelector('[data-lamp="Accel"]')!.getAttribute("data-on") };
  });
  if ((await preview()).frame !== 0 || !(await preview()).clock?.startsWith("Start in 4")) throw new Error(`The preview should start at the countdown: ${JSON.stringify(await preview())}`);
  await page.select('[aria-label="Preview speed"]', "4");
  await page.click('[aria-label="Play"]');
  await page.waitForFunction(() => Number(document.querySelector<HTMLElement>("[data-ghost-preview]")!.dataset.frame) > 300, { timeout: 20000 });
  await page.click('[aria-label="Pause"]');
  const paused = await preview();
  await new Promise((done) => setTimeout(done, 250));
  if ((await preview()).frame !== paused.frame) throw new Error("Pause did not stop the preview");
  // This ghost holds accelerate from frame 39: past the countdown it reads a running clock.
  if (paused.accelerate !== "true" || !/^0:/.test(paused.clock || "")) throw new Error(`The preview does not follow the inputs: ${JSON.stringify(paused)}`);
  // Clicking the timeline jumps there, and the frame buttons step one at a time.
  const bar = (await (await page.$('canvas[aria-label="Ghost inputs over time"]'))!.boundingBox())!;
  await page.mouse.click(bar.x + bar.width / 2, bar.y + 30);
  const middle = await preview();
  if (Math.abs(middle.frame - inputFrames(before.inputs.face) / 2) > inputFrames(before.inputs.face) * .02) throw new Error(`Seeking landed on frame ${middle.frame}`);
  await page.click('[aria-label="Next frame"]');
  if ((await preview()).frame !== middle.frame + 1) throw new Error("Next frame did not step one frame");
  if (shot) await page.screenshot({ path: `${shot}-preview.png` });
  // In the editor too, but not while typing in a field or from a button that has the focus.
  const playingHere = () => page.evaluate(() => document.querySelector("[data-ghost-preview]")!.getAttribute("data-playing"));
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press("Space");
  await new Promise((done) => setTimeout(done, 150));
  if (await playingHere() !== "true") throw new Error("Space did not start the editor's preview");
  await page.keyboard.press("Space");
  await new Promise((done) => setTimeout(done, 150));
  if (await playingHere() !== "false") throw new Error("Space did not pause the editor's preview");
  await page.focus('[aria-label="Preview speed"]');
  await page.keyboard.press("Escape");
  await page.focus('[aria-label="Finish time seconds"]');
  await page.keyboard.press("Space");
  await new Promise((done) => setTimeout(done, 150));
  if (await playingHere() !== "false") throw new Error("Space in a field played the preview");
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  console.log("ok  preview plays, pauses and seeks on a real ghost");

  // Watch in 3D asks for the track's window, with the ghost, for the ghost's own position.
  const windowRequest = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/editor-window");
  await page.evaluate(() => {
    window.open = (() => { const fake: any = { closed: false, close() {}, location: { replace(url: string) { (window as any).ghostWindow = url; } }, document: {} }; return fake; }) as any;
  });
  const track = join(files, "Race", "Course", "beginner_course.szs");
  mkdirSync(join(files, "Race", "Course"), { recursive: true });
  copyFileSync(join(game, "Race", "Course", "beginner_course.szs"), track);
  // With the game's Common.szs too, Kinoko works out the path the game drives the ghost on.
  copyFileSync(join(game, "Race", "Common.szs"), join(files, "Race", "Common.szs"));
  await clickButton("Watch in 3D (beta)");
  await windowRequest;
  await page.waitForFunction(() => !!(window as any).ghostWindow, { timeout: 30000 });
  const opened = new URL(await page.evaluate(() => (window as any).ghostWindow));
  if (resolve(opened.searchParams.get("open") || "") !== resolve(track)) throw new Error(`Watch in 3D opened ${opened.searchParams.get("open")}`);
  const sent = opened.searchParams.get("ghost") || "";
  if (!existsSync(sent) || timeText(parseRKG(new Uint8Array(readFileSync(sent))).time) !== timeText(before.time)) throw new Error("The window did not get this ghost");
  console.log("ok  watch in 3D opens the ghost's track with this ghost");

  // That window itself, opened as the desktop app opens it: only the track and the ghost, driving.
  const preview3D = await browser.newPage();
  preview3D.on("pageerror", (error) => { errors.push(String(error)); console.error("Browser error:", error); });
  await preview3D.setViewport({ width: 1500, height: 950 });
  await preview3D.goto(opened.href, { waitUntil: "domcontentloaded" });
  await preview3D.waitForSelector("[data-ghost-player]", { timeout: 120000 });
  // The window reported itself ready, which ends the waiting in the ghost editor.
  // (By timer: a page behind another gets no animation frames.)
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), { timeout: 30000, polling: 300 });
  if (existsSync(sent)) throw new Error("The ghost's temporary file was left behind");
  // The ghost's own character and vehicle, from the game's files.
  if (await preview3D.evaluate(() => (window as any).app.ghostView.kart.name) !== "start-kart") throw new Error("The ghost's kart model was not loaded");
  // The staff ghost on its own track: Kinoko's path, which reaches its own time.
  const pathNote = await preview3D.evaluate(() => document.querySelector("[data-ghost-path]")?.getAttribute("data-ghost-path"));
  if (process.platform === "win32" && pathNote !== "kinoko") throw new Error(`The preview does not show Kinoko's path: ${pathNote}`);
  const chrome = await preview3D.evaluate(() => ({
    toolbar: !!document.querySelector('[data-group="transform"]'), left: !!document.getElementById("left"), right: !!document.getElementById("right"),
    status: !!document.getElementById("statusbar"), menus: document.querySelector("[data-window-chrome]")?.querySelectorAll('[role="menubar"]').length,
  }));
  if (chrome.toolbar || chrome.left || chrome.right || chrome.status || chrome.menus) throw new Error(`Editor parts are still showing: ${JSON.stringify(chrome)}`);
  const kart = () => preview3D.evaluate(() => (window as any).app.ghostView.kart.position.toArray());
  const start = await kart();
  await new Promise((done) => setTimeout(done, 1200));
  if (shot) await preview3D.screenshot({ path: `${shot}-3d-start.png` });
  await preview3D.select('[aria-label="Preview speed"]', "4");
  await preview3D.click('[aria-label="Play"]');
  await preview3D.waitForFunction(() => Number(document.querySelector<HTMLElement>("[data-ghost-preview]")!.dataset.frame) > 700, { timeout: 60000 });
  await preview3D.click('[aria-label="Pause"]');
  await new Promise((done) => setTimeout(done, 500));
  if (shot) await preview3D.screenshot({ path: `${shot}-3d-race.png` });
  const moved = await kart();
  // Space plays and pauses, also with the Pause button still focused from the click above: once each.
  const playing3D = () => preview3D.evaluate(() => document.querySelector("[data-ghost-preview]")!.getAttribute("data-playing"));
  const frame3D = () => preview3D.evaluate(() => Number(document.querySelector<HTMLElement>("[data-ghost-preview]")!.dataset.frame));
  if (await playing3D() !== "false") throw new Error("The preview should be paused here");
  await preview3D.keyboard.press("Space");
  await new Promise((done) => setTimeout(done, 500));
  const spaceFrom = await frame3D();
  if (await playing3D() !== "true") throw new Error("Space did not start the preview");
  await preview3D.waitForFunction((from) => Number(document.querySelector<HTMLElement>("[data-ghost-preview]")!.dataset.frame) > from, { timeout: 30000 }, spaceFrom);
  await preview3D.keyboard.press("Space");
  await new Promise((done) => setTimeout(done, 300));
  if (await playing3D() !== "false") throw new Error("Space did not pause the preview");
  // With the focus nowhere, and held down it counts once.
  await preview3D.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await preview3D.keyboard.down("Space");
  await preview3D.keyboard.down("Space");
  await preview3D.keyboard.down("Space");
  await preview3D.keyboard.up("Space");
  await new Promise((done) => setTimeout(done, 200));
  if (await playing3D() !== "true") throw new Error("Holding Space should toggle once");
  await preview3D.keyboard.press("Space");
  await new Promise((done) => setTimeout(done, 200));
  if (Math.hypot(moved[0] - start[0], moved[2] - start[2]) < 500) throw new Error(`The kart did not move: ${start} -> ${moved}`);
  // As in a Time Trial, the track's item boxes are not there, though the track holds them.
  const boxes = await preview3D.evaluate(() => {
    const app = (window as any).app, ids = new Set(app.doc.kmp.GOBJ.filter((o: any) => o.objectId === 0x65).map((o: any) => String(o.uid)));
    let drawn = 0, others = 0;
    app.viewport.kmpGroup.traverse((node: any) => { const key = node.userData?.key; if (key === undefined) return; if (ids.has(String(key))) drawn++; else others++; });
    return { held: ids.size, drawn, others };
  });
  if (!boxes.held || boxes.drawn || !boxes.others) throw new Error(`Item boxes in the preview: ${JSON.stringify(boxes)}`);
  // A mushroom: the item button, in this ghost's inputs, gives its boost, flames and count.
  const boosted = await preview3D.evaluate(() => {
    const state = (window as any).app.ghostView, frame = state.drive.boost.findIndex((b: number) => b === 1);
    const before = state.drive.mushrooms[frame - 10];
    (window as any).app.showGhostFrame(frame, "chase");
    return { frame, before, flames: state.kart.userData.boostFlames.visible, left: state.drive.mushrooms[frame] };
  });
  if (boosted.frame < 0 || !boosted.flames || boosted.left >= 3) throw new Error(`No mushroom boost in this ghost: ${JSON.stringify(boosted)}`);
  await new Promise((done) => setTimeout(done, 300));
  if (shot) await preview3D.screenshot({ path: `${shot}-3d-boost.png` });
  const editing = await preview3D.evaluate(() => {
    const app = (window as any).app, before = app.viewport.mode;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "r", bubbles: true }));
    return { dirty: app.doc.dirty, unchanged: app.viewport.mode === before };
  });
  if (editing.dirty || !editing.unchanged) throw new Error(`The preview reacted as an editor: ${JSON.stringify(editing)}`);
  for (const view of ["Above", "Side", "Behind"]) {
    await preview3D.evaluate((t) => [...document.querySelectorAll<HTMLButtonElement>("[data-ghost-player] button")].find((b) => b.textContent?.trim() === t)?.click(), view);
    await new Promise((done) => setTimeout(done, 400));
    if (shot && view !== "Behind") await preview3D.screenshot({ path: `${shot}-3d-${view.toLowerCase()}.png` });
  }
  await preview3D.close();
  await page.bringToFront();
  console.log("ok  3D preview window shows only the track and the ghost, driving");

  // On its own track the preview has nothing to warn about; another track's ghost is said to be so.
  if (await preview3D.evaluate(() => !!document.querySelector("[data-ghost-track-check]")).catch(() => false)) throw new Error("A warning on the ghost's own track");
  const elsewhereDir = mkdtempSync(join(tmpdir(), "mkwii-temp-"));
  const elsewhere = join(elsewhereDir, "ghost.rkg");
  writeFileSync(elsewhere, buildRKG({ ...parseRKG(new Uint8Array(readFileSync(copy))), track: 1 }));
  const elsewhereUrl = new URL(opened.href);
  elsewhereUrl.searchParams.set("ghost", elsewhere);
  const previewElsewhere = await browser.newPage();
  await previewElsewhere.setViewport({ width: 1500, height: 950 });
  await previewElsewhere.goto(elsewhereUrl.href, { waitUntil: "domcontentloaded" });
  await previewElsewhere.waitForSelector("[data-ghost-player]", { timeout: 120000 });
  const warning = await previewElsewhere.evaluate(() => { const note = document.querySelector("[data-ghost-track-check]"); return note ? { level: note.getAttribute("data-ghost-track-check"), text: note.textContent } : null; });
  if (warning?.level !== "wrong" || !warning.text?.includes("Moo Moo Meadows") || !warning.text.includes("Luigi Circuit")) throw new Error(`No warning for another track's ghost: ${JSON.stringify(warning)}`);
  // Its buttons were pressed on Luigi Circuit, which is the track shown: Kinoko drives it to its time.
  const sameNote = await previewElsewhere.evaluate(() => document.querySelector("[data-ghost-path]")?.getAttribute("data-ghost-path"));
  if (process.platform === "win32" && sameNote !== "kinoko") throw new Error(`Kinoko's path is missing for buttons pressed on this track: ${sameNote}`);
  if (shot) await previewElsewhere.screenshot({ path: `${shot}-3d-wrong-track.png` });
  await previewElsewhere.close();
  // Moo Moo Meadows' staff ghost, driven there, on Luigi Circuit: Kinoko's path is said not to be the
  // game's, with a way to read the game's.
  if (process.platform === "win32") {
    const drivenElsewhere = join(mkdtempSync(join(tmpdir(), "mkwii-temp-")), "moo-moo.rkg");
    copyFileSync(join(game, "Race", "TimeAttack", "ghost1", "ghost1_comp_01.rkg"), drivenElsewhere);
    const offUrl = new URL(opened.href);
    offUrl.searchParams.set("ghost", drivenElsewhere);
    const previewOff = await browser.newPage();
    await previewOff.setViewport({ width: 1500, height: 950 });
    await previewOff.goto(offUrl.href, { waitUntil: "domcontentloaded" });
    await previewOff.waitForSelector("[data-ghost-player]", { timeout: 120000 });
    const offNote = await previewOff.evaluate(() => { const note = document.querySelector("[data-ghost-path]"); return { kind: note?.getAttribute("data-ghost-path"), text: note?.textContent, button: [...document.querySelectorAll("button")].some((b) => b.textContent?.includes("Read the path from the game")) }; });
    if (offNote.kind !== "kinoko-off" || !offNote.button || !/from lap \d|at the finish/.test(offNote.text || "")) throw new Error(`No note that Kinoko's path is not the game's: ${JSON.stringify(offNote)}`);
    if (shot) await previewOff.screenshot({ path: `${shot}-3d-kinoko-off.png` });
    await previewOff.close();
  }
  await page.bringToFront();
  console.log("ok  the preview says when the track is not the ghost's");

  // On a bike, which is built of other parts: two wheels on the ground, handlebars, a swingarm.
  const bikeDir = mkdtempSync(join(tmpdir(), "mkwii-temp-"));
  const bikeGhost = join(bikeDir, "ghost.rkg");
  writeFileSync(bikeGhost, buildRKG({ ...parseRKG(new Uint8Array(readFileSync(copy))), vehicle: 22, character: 7 }));
  opened.searchParams.set("ghost", bikeGhost);
  const previewBike = await browser.newPage();
  previewBike.on("pageerror", (error) => { errors.push(String(error)); console.error("Browser error:", error); });
  await previewBike.setViewport({ width: 1500, height: 950 });
  await previewBike.goto(opened.href, { waitUntil: "domcontentloaded" });
  await previewBike.waitForSelector("[data-ghost-player]", { timeout: 120000 });
  const parts = await previewBike.evaluate(() => {
    const kart = (window as any).app.ghostView.kart;
    return Object.fromEntries(kart.children.map((part: any) => [part.name, [part.position.y, part.position.z]]));
  });
  for (const name of ["handle", "tire_f", "tire_r", "swingarm", "driver"]) if (!parts[name]) throw new Error(`The bike has no ${name}: ${Object.keys(parts)}`);
  const [frontY, frontZ] = parts.tire_f, [rearY, rearZ] = parts.tire_r;
  if (frontY < 20 || frontY > 50 || rearY < 20 || rearY > 50) throw new Error(`The bike's wheels are off the ground: ${frontY}, ${rearY}`);
  if (frontZ < 40 || rearZ > -40) throw new Error(`The bike's wheels are in the wrong places: ${frontZ}, ${rearZ}`);
  await previewBike.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>("[data-ghost-player] button")].find((b) => b.textContent?.trim() === "Side")?.click());
  await new Promise((done) => setTimeout(done, 800));
  if (shot) await previewBike.screenshot({ path: `${shot}-3d-bike.png` });
  await previewBike.close();
  await page.bringToFront();
  console.log("ok  a ghost on a bike shows its bike");

  // Details: a new time and vehicle, written to the file with a backup beside it.
  const type = async (label: string, value: string) => {
    await page.click(`[aria-label="${label}"]`, { count: 3 });
    await page.keyboard.type(value);
    await page.keyboard.press("Enter");
  };
  await type("Finish time seconds", "07");
  await page.select('[aria-label="Vehicle"]', "22");
  await clickButton("Save");
  await page.waitForFunction(() => !document.body.textContent?.includes("· not saved") && document.body.textContent?.includes("Ghost saved"));
  const saved = parseRKG(new Uint8Array(readFileSync(copy)));
  if (saved.time.seconds !== 7 || saved.vehicle !== 22 || !saved.crcValid || !saved.compressed) throw new Error(`The details were not saved: ${timeText(saved.time)} vehicle ${saved.vehicle}`);
  if (JSON.stringify(saved.inputs) !== JSON.stringify(before.inputs)) throw new Error("Saving the details changed the inputs");
  console.log("ok  details saved to the file, with the inputs untouched");

  // Inputs: one entry longer, in the file; the mismatch between sections is pointed out.
  await clickButton("Inputs");
  await page.waitForSelector('[aria-label="Frames of entry 0"]');
  const frames = await page.$eval('[aria-label="Frames of entry 0"]', (el: any) => Number(el.value));
  await type("Frames of entry 0", String(Math.max(1, frames - 1)));
  await page.waitForFunction(() => document.body.textContent?.includes("last different times"));
  if (shot) await page.screenshot({ path: `${shot}-inputs.png` });
  await clickButton("Save");
  await page.waitForFunction(() => !document.body.textContent?.includes("· not saved"));
  const edited = parseRKG(new Uint8Array(readFileSync(copy)));
  if (edited.inputs.face[0].frames !== Math.max(1, frames - 1) || !edited.crcValid) throw new Error("The edited input was not saved");
  if (inputFrames(edited.inputs.direction) !== inputFrames(before.inputs.direction)) throw new Error("Editing buttons changed the stick");
  console.log("ok  input entry edited and saved");

  await clickButton("Close");
  await page.waitForFunction(() => !document.querySelector('canvas[aria-label="Ghost inputs over time"]'));

  // The ghost against another: the recorded one, made from it with a changed time.
  await page.waitForFunction(() => !document.querySelector('[aria-label="Close ghost editor"]'));
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Ghost editor"))?.click());
  await page.waitForFunction(() => document.body.textContent?.includes("Staff ghosts of the game"));
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent?.includes("ghost1_comp_00"))?.click());
  await page.waitForSelector('[aria-label="Finish time seconds"]');
  await clickButton("Compare");
  await page.waitForSelector("[data-ghost-compare]");
  const choice = await page.evaluate(() => [...document.querySelectorAll<HTMLOptionElement>('[aria-label="Ghost to compare with"] option')].find((o) => o.textContent?.includes("Luigi Circuit 1-11-111"))?.value);
  if (!choice) throw new Error("The recorded ghost is not offered for comparing");
  await page.select('[aria-label="Ghost to compare with"]', choice);
  await page.waitForSelector("[data-compare-total]");
  const compared = await page.evaluate(() => ({ total: Number(document.querySelector("[data-compare-total]")!.getAttribute("data-compare-total")), laps: document.querySelectorAll("[data-compare-lap]").length, note: document.querySelector("[data-compare-inputs]")!.textContent }));
  // 1:11.111 against the staff ghost's own time.
  const openTime = parseRKG(new Uint8Array(readFileSync(copy))).time, openMs = (openTime.minutes * 60 + openTime.seconds) * 1000 + openTime.milliseconds;
  if (compared.total !== 71111 - openMs) throw new Error(`Compared finish difference ${compared.total}`);
  if (compared.laps !== 3) throw new Error(`Compared ${compared.laps} laps`);
  // This copy had an input entry changed above, so that is what it finds.
  if (!compared.note?.includes("first differ")) throw new Error(`Compared inputs: ${compared.note}`);
  if (shot) await page.screenshot({ path: `${shot}-compare.png` });
  await clickButton("Close");
  await page.waitForFunction(() => !document.querySelector('[aria-label="Close ghost editor"]'));
  console.log("ok  ghost compared with another");

  // Recording is a button of the ghost editor, not on Home, with no track open.
  await page.waitForFunction(() => !document.querySelector('[aria-label="Close ghost editor"]'));
  if (await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent?.includes("Record a ghost")))) throw new Error("Record a ghost is still on Home");
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Ghost editor"))?.click());
  await page.waitForFunction(() => document.body.textContent?.includes("Staff ghosts of the game"));
  const openRecording = async () => {
    await clickButton("Record a ghost…");
    await page.waitForSelector('[data-record-step="game"]');
  };
  const watching = () => page.evaluate(async () => (await (await fetch("/api/ghost-capture", { headers: { "x-token": "ghost-smoke" } })).json()).watching);
  await openRecording();
  await page.waitForFunction(() => document.querySelector("[data-recorded-ghosts]")?.textContent?.includes("Luigi Circuit"), { timeout: 30000 }).catch(async (e) => { if (shot) await page.screenshot({ path: `${shot}-record-list.png` }); throw e; });
  // It watches from the moment it opens: there is no button to forget.
  if (!await watching()) throw new Error("Recording did not start watching by itself");
  if (await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].some((b) => /watching/i.test(b.textContent || "")))) throw new Error("A watching button is still there");
  // Each state of the game points at the step to do, as Dolphin would report it.
  await page.evaluate(() => {
    const real = window.fetch;
    window.fetch = ((input: any, init?: any) => {
      const fake = (window as any).fakeCapture;
      return fake && String(input).includes("ghost-capture") ? Promise.resolve(new Response(JSON.stringify(fake), { headers: { "content-type": "application/json" } })) : real(input, init);
    }) as typeof fetch;
  });
  const showState = async (state: any, current: string, name: string) => {
    await page.evaluate((fake) => { (window as any).fakeCapture = fake; }, state);
    await page.waitForFunction((id) => document.querySelector(`[data-record-step="${id}"]`)?.getAttribute("aria-current") === "step" || (id === "done" && document.querySelector('[data-record-step="done"]')?.getAttribute("data-step-state") === "done"), { timeout: 5000 }, current);
    await new Promise((done) => setTimeout(done, 200));
    if (shot) await page.screenshot({ path: `${shot}-record-${name}.png` });
  };
  const fakeStatus = { watching: true, dolphin: true, game: "RMCP01", stage: -1, saves: [{ path: "rksys.dat", region: "PAL" }], captured: [] as any[] };
  await showState({ ...fakeStatus, dolphin: false, game: null, stage: null }, "game", "closed");
  if (!await page.evaluate(() => [...document.querySelectorAll('[data-record-step="game"] button')].some((b) => b.textContent?.includes("Open the game in Dolphin")))) throw new Error("No button to open the game");
  await showState({ ...fakeStatus, stage: -1 }, "race", "menu");
  if (await page.evaluate(() => !!document.querySelector('[data-record-step="game"] button'))) throw new Error("Still offering to open the game");
  await showState({ ...fakeStatus, stage: 0 }, "drive", "ready");
  if (await page.evaluate(() => !!document.querySelector("[data-recording]"))) throw new Error("Recording shown before the race started");
  await showState({ ...fakeStatus, stage: 2 }, "drive", "racing");
  await page.waitForSelector("[data-recording]", { timeout: 5000 }).catch(() => { throw new Error("The recording is not shown during the race"); });
  await showState({ ...fakeStatus, stage: 3 }, "save", "finished");
  const saveText = () => page.evaluate(() => document.querySelector('[data-record-step="save"]')!.textContent || "");
  if (!(await saveText()).includes("Nothing to press")) throw new Error(`Save step: ${await saveText()}`);
  // The game saves without a new ghost: the step says it did not keep this run.
  await showState({ ...fakeStatus, stage: 3, savedWithoutGhost: Date.now() + 60000 }, "save", "not-kept");
  await page.waitForFunction(() => document.querySelector('[data-record-step="save"]')!.textContent?.includes("did not keep this run"));
  const ghostOnList = await page.evaluate(() => document.querySelector("[data-recorded-ghosts] button[aria-label^='Edit ']")?.getAttribute("aria-label")?.replace("Edit ", ""));
  const newGhost = { file: recordedFile, track: 8, time: "1:11.111", character: 7, vehicle: 16 };
  await showState({ ...fakeStatus, stage: 3, captured: [newGhost] }, "done", "saved");
  if (!await page.evaluate(() => document.querySelector("[data-recorded-latest]")?.textContent?.includes("1:11.111"))) throw new Error("The new ghost is not named");
  if (!await page.evaluate(() => !!document.querySelector("[data-recorded-new]"))) throw new Error(`The new ghost ${ghostOnList} is not marked`);
  const doneText = () => page.evaluate(() => document.querySelector('[data-record-step="done"]')!.textContent || "");
  if ((await doneText()).includes("did not keep")) throw new Error(`A saved ghost said not kept: ${await doneText()}`);
  // A run the game did not keep, read from its memory: recorded all the same, and said how.
  await showState({ ...fakeStatus, stage: 4, captured: [{ ...newGhost, source: "memory", kept: false }] }, "done", "from-memory");
  await page.waitForFunction(() => document.querySelector('[data-record-step="done"]')!.textContent?.includes("read from the game's memory as the race ended (beta)"), { timeout: 5000 });
  if (!await page.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].some((d) => d.textContent?.includes("also one the game does not keep (beta)")))) throw new Error("The window does not say reading from memory is in beta");
  await showState({ ...fakeStatus, stage: 3, captured: [newGhost] }, "done", "saved-again");
  await page.waitForFunction(() => !document.querySelector('[data-record-step="done"]')!.textContent?.includes("did not keep"), { timeout: 5000 });
  // The ghost just recorded can be watched in 3D at once, on its own track.
  await page.evaluate(() => { (window as any).ghostWindow = null; });
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[data-record-step="done"] button')].find((b) => b.textContent?.includes("Watch in 3D"))!.click());
  await page.waitForFunction(() => !!(window as any).ghostWindow, { timeout: 30000 }).catch(async (e) => { if (shot) await page.screenshot({ path: `${shot}-record-watch.png` }); throw e; });
  const recordedWindow = new URL(await page.evaluate(() => (window as any).ghostWindow));
  if (!/beginner_course\.szs$/i.test(recordedWindow.searchParams.get("open") || "")) throw new Error(`The recorded ghost opened ${recordedWindow.searchParams.get("open")}`);
  if (timeText(parseRKG(new Uint8Array(readFileSync(recordedWindow.searchParams.get("ghost")!))).time) !== "1:11.111") throw new Error("The preview did not get the recorded ghost");
  const previewRecorded = await browser.newPage();
  await previewRecorded.setViewport({ width: 1500, height: 950 });
  await previewRecorded.goto(recordedWindow.href, { waitUntil: "domcontentloaded" });
  await previewRecorded.waitForSelector("[data-ghost-player]", { timeout: 120000 });
  // The editor that opened it waits for the window to say it is ready: closed before, it would wait on.
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), { timeout: 60000, polling: 300 });
  await previewRecorded.close();
  await page.bringToFront();
  // And from the list, each one.
  if (!await page.evaluate(() => !!document.querySelector('[data-recorded-ghosts] button[aria-label^="Watch "]'))) throw new Error("The list has no 3D preview button");
  // The next race starts again from driving, with the last ghost still in the list.
  await showState({ ...fakeStatus, stage: 2, captured: [newGhost] }, "drive", "again");
  await showState({ ...fakeStatus, stage: 3, captured: [newGhost] }, "save", "again-finished");
  await page.evaluate(() => { (window as any).fakeCapture = null; });
  await clickButton("Done");
  await page.waitForFunction(() => !document.querySelector("[data-record-step]"));
  if (await watching()) throw new Error("Still watching after closing");
  // The ghost editor is still there underneath, and the pencil brings a recorded ghost into it.
  if (!await page.evaluate(() => document.body.textContent?.includes("Staff ghosts of the game"))) throw new Error("Recording closed the ghost editor");
  await openRecording();
  await page.waitForFunction(() => document.querySelector("[data-recorded-ghosts]")?.textContent?.includes("Luigi Circuit"));
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[data-recorded-ghosts] button[aria-label^="Edit "]')!.click());
  await page.waitForFunction(() => !document.querySelector("[data-record-step]"));
  await page.waitForSelector('canvas[aria-label="Ghost inputs over time"]');
  const editors = await page.evaluate(() => document.querySelectorAll('[aria-label="Close ghost editor"]').length);
  if (editors !== 1) throw new Error(`${editors} ghost editors open`);
  await clickButton("Close");
  await page.waitForFunction(() => !document.querySelector('[aria-label="Close ghost editor"]'));
  console.log("ok  recording opens from the ghost editor and lists the recorded ghosts");

  // On a track: Luigi Circuit's staff ghost replaced with the recorded one, from the track's own window.
  await page.evaluate(async (track) => { await (window as any).app.openPath(track); }, join(game, "Race", "Course", "beginner_course.szs"));
  await page.evaluate(() => { void (window as any).app.cmd("trackGhosts"); });
  await page.waitForSelector("[data-ghost-slot]");
  const position = await page.$eval('[aria-label="Position"]', (el: any) => Number(el.value));
  if (position !== 8) throw new Error(`The open track's position was not found: ${position}`);
  if (await page.evaluate(() => document.querySelectorAll("[data-ghost-slot]").length) !== 1) throw new Error("Only the copied ghost should be listed for this position");
  // Its preview: the window of the ghost in this slot, on the track being edited.
  await page.evaluate(() => { (window as any).ghostWindow = null; });
  await clickButton("Preview (beta)");
  await page.waitForFunction(() => !!(window as any).ghostWindow, { timeout: 30000 });
  const slotWindow = new URL(await page.evaluate(() => (window as any).ghostWindow));
  const openTrack = await page.evaluate(() => (window as any).app.doc.filePath);
  if (resolve(slotWindow.searchParams.get("open") || "") !== resolve(openTrack)) throw new Error(`The slot's preview opened ${slotWindow.searchParams.get("open")}, not ${openTrack}`);
  const slotGhost = slotWindow.searchParams.get("ghost") || "";
  if (timeText(parseRKG(new Uint8Array(readFileSync(slotGhost))).time) !== timeText(parseRKG(new Uint8Array(readFileSync(copy))).time)) throw new Error("The slot's preview did not get the slot's ghost");
  const previewSlot = await browser.newPage();
  await previewSlot.setViewport({ width: 1500, height: 950 });
  await previewSlot.goto(slotWindow.href, { waitUntil: "domcontentloaded" });
  await previewSlot.waitForSelector("[data-ghost-player]", { timeout: 120000 });
  // The editor that opened it waits for the window to say it is ready: closed before, it would wait on.
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), { timeout: 60000, polling: 300 });
  await previewSlot.close();
  await page.bringToFront();
  console.log("ok  a slot's ghost opens in the preview");
  await clickButton("Use a recorded ghost");
  await page.waitForSelector("[data-ghost-choices] button");
  if (shot) await page.screenshot({ path: `${shot}-track.png` });
  const replacedBefore = readFileSync(copy);
  await page.evaluate(() => document.querySelector<HTMLButtonElement>("[data-ghost-choices] button")?.click());
  await page.waitForFunction(() => !document.querySelector("[data-ghost-choices]") && document.body.textContent?.includes("replaced"));
  const replaced = parseRKG(new Uint8Array(readFileSync(copy)));
  if (replaced.track !== 8 || replaced.ghostType !== before.ghostType || timeText(replaced.time) !== timeText(recorded.time)) throw new Error(`The slot did not take the recorded ghost: ${timeText(replaced.time)}`);
  if (!existsSync(`${copy}.bak`)) throw new Error("No backup was kept");
  void replacedBefore;
  // Restore brings the file before it back.
  await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"] button')].some((b) => b.textContent?.trim() === "Restore"));
  await clickButton("Restore");
  await page.waitForFunction(() => document.body.textContent?.includes("Put the previous ghost back?"));
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find((b) => b.textContent?.trim() === "Restore")?.click());
  await page.waitForFunction(() => document.body.textContent?.includes("Ghost restored"));
  const restored = parseRKG(new Uint8Array(readFileSync(copy)));
  if (restored.track !== 8 || timeText(restored.time) === timeText(recorded.time)) throw new Error("Restore did not bring the previous ghost back");
  console.log("ok  track's ghost replaced with a recorded one, and restored");
  await clickButton("Done");

  if (errors.length) throw new Error(`Browser errors: ${errors.join("; ")}`);
} finally {
  await browser?.close();
  worker.terminate();
  const target = resolve(temp);
  if (!target.startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe temporary test path");
  rmSync(target, { recursive: true, force: true });
}
