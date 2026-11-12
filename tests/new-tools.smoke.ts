// Materials, primitives, sculpting, emitters and the game's minimap colour in the real interface,
// on a real track, saving only to a temporary folder.
// MKWII_GAME_DIR=<game>/files bun run tests/new-tools.smoke.ts
import puppeteer from "puppeteer-core";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { readMapColours, MAP_LAYOUT } from "../web/js/formats/map-layout.js";
import { findFile, parseU8 } from "../web/js/formats/u8.js";
import { yaz0Decompress } from "../web/js/formats/yaz0.js";

const game = process.env.MKWII_GAME_DIR;
if (!game || !existsSync(join(game, "Race", "Common.szs"))) {
  console.log("MKWII_GAME_DIR not set (or no Race/Common.szs): skipped");
  process.exit(0);
}
const temp = mkdtempSync(join(tmpdir(), "mkwii-tools-")), files = join(temp, "files");
mkdirSync(join(files, "Scene", "UI"), { recursive: true });
mkdirSync(join(files, "Race", "Course"), { recursive: true });
copyFileSync(join(game, "Scene", "UI", "Race.szs"), join(files, "Scene", "UI", "Race.szs"));
copyFileSync(join(game, "Race", "Common.szs"), join(files, "Race", "Common.szs"));
copyFileSync(join(game, "Race", "Course", "castle_course.szs"), join(files, "Race", "Course", "castle_course.szs"));
await Bun.write(join(temp, "settings.json"), JSON.stringify({ tourDone: true, discordActivity: false, workspace: files }));
const worker = new Worker(new URL("../src/server.ts", import.meta.url).href);
let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
try {
  const port: number = await new Promise((res, rej) => {
    worker.onmessage = (e) => { if (e.data?.type === "ready") res(e.data.port); if (e.data?.type === "error") rej(new Error(e.data.message)); };
    worker.postMessage({ type: "start", token: "tools-smoke", settingsDir: temp });
  });
  browser = await puppeteer.launch({
    executablePath: process.env.MKWII_TEST_BROWSER || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1500,950"], protocolTimeout: 240000,
  });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => { errors.push(String(error)); console.error("Browser error:", error); });
  await page.setViewport({ width: 1500, height: 950 });
  await page.goto(`http://127.0.0.1:${port}/?t=tools-smoke`, { waitUntil: "networkidle0" });
  await page.evaluate(async (track) => { await (window as any).app.openPath(track); }, join(files, "Race", "Course", "castle_course.szs"));
  const shot = process.env.MKWII_TOOLS_SCREENSHOT;
  const open = async (command: string, selector: string) => {
    await page.evaluate((c) => { void (window as any).app.cmd(c); }, command);
    await page.waitForSelector(selector);
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]')?.getAnimations({ subtree: true }).some((a) => a.playState === "running"));
  };
  const clickButton = (text: string) => page.evaluate((t) => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent?.trim() === t)?.click(), text);
  const closed = () => page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  const label = () => page.evaluate(() => (window as any).app.doc.undoStack.at(-1)?.label);

  // The track's own editors are in the list too, in the order of the look of the track.
  const rows = await page.evaluate(() => [...document.querySelectorAll("[data-outline-tool]")].map((row) => row.getAttribute("data-outline-tool")));
  if (rows.join() !== "lighting,fog,effects") throw new Error(`Outline rows: ${rows}`);
  const closeWindow = () => page.evaluate(() => {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')];
    (buttons.find((b) => b.getAttribute("aria-label")?.startsWith("Close")) || buttons.find((b) => ["Cancel", "Close", "Done"].includes(b.textContent?.trim() || "")))?.click();
  });
  for (const [row, selector] of [["lighting", '[role="dialog"]'], ["fog", '[aria-label="The track with this fog"]'], ["effects", '[role="dialog"]']]) {
    // A click selects it, with what the track holds of it beside; it does not open anything.
    await page.click(`[data-outline-tool="${row}"] span`);
    await page.waitForSelector(`[data-look-inspector="${row}"]`);
    if (await page.evaluate(() => !!document.querySelector('[role="dialog"]'))) throw new Error(`Selecting ${row} opened its editor`);
    const chosen = await page.evaluate((id) => document.querySelector(`[data-outline-tool="${id}"]`)!.getAttribute("data-selected"), row);
    if (chosen !== "true") throw new Error(`${row} is not marked as selected`);
    if (shot) await page.screenshot({ path: `${shot}-look-${row}.png` });
    // The button beside it, and the one in the Inspector, and a double click all open it.
    await page.click(`[data-outline-tool="${row}"] button`);
    await page.waitForSelector(selector);
    await new Promise((done) => setTimeout(done, 300));
    await closeWindow();
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), { timeout: 10000 });
    await page.evaluate((id) => document.querySelector<HTMLButtonElement>(`[data-look-inspector="${id}"] button`)!.click(), row);
    await page.waitForSelector(selector);
    await new Promise((done) => setTimeout(done, 300));
    await closeWindow();
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), { timeout: 10000 });
    await page.click(`[data-outline-tool="${row}"] span`, { count: 2 });
    await page.waitForSelector(selector);
    await new Promise((done) => setTimeout(done, 300));
    await closeWindow();
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), { timeout: 10000 });
    await new Promise((done) => setTimeout(done, 200));
  }
  // Selecting something else on the track takes its place in the Inspector.
  await page.evaluate(() => { const app = (window as any).app; app.doc.select(String(app.doc.kmp.GOBJ[0].uid)); });
  await page.waitForFunction(() => !document.querySelector("[data-look-inspector]") && !document.querySelector('[data-outline-tool][data-selected="true"]'));
  await page.evaluate(() => (window as any).app.doc.clearSelection());
  // Searching finds them, by what is in them.
  await page.type('input[placeholder^="Find"]', "smoke");
  await page.waitForFunction(() => { const list = [...document.querySelectorAll("[data-outline-tool]")].map((row) => row.getAttribute("data-outline-tool")); return list.join() === "effects"; });
  await page.evaluate(() => { const box = document.querySelector<HTMLInputElement>('input[placeholder^="Find"]')!; box.focus(); box.select(); });
  await page.keyboard.press("Backspace");
  await page.waitForFunction(() => document.querySelectorAll("[data-outline-tool]").length === 3);
  // Dragged as narrow as it goes, nothing of a row goes past the panel: every button stays whole.
  const narrowed = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('[data-panel-id="left"]')!.getBoundingClientRect();
    const handle = document.querySelector<HTMLElement>('[data-panel-group] [data-panel-resize-handle-id]')!.getBoundingClientRect();
    return { from: panel.width, x: handle.left + handle.width / 2, y: handle.top + handle.height / 2 };
  });
  await page.mouse.move(narrowed.x, narrowed.y);
  await page.mouse.down();
  await page.mouse.move(narrowed.x - 300, narrowed.y, { steps: 8 });
  await page.mouse.up();
  await new Promise((done) => setTimeout(done, 300));
  const overflow = await page.evaluate(() => {
    const edge = document.querySelector<HTMLElement>('[data-panel-id="left"]')!.getBoundingClientRect();
    const rows = [...document.querySelectorAll<HTMLElement>('[data-panel-id="left"] button')].filter((b) => b.offsetParent && b.getBoundingClientRect().height > 0);
    const past = rows.map((b) => ({ text: b.textContent?.trim() || b.getAttribute("aria-label") || "", over: Math.round(b.getBoundingClientRect().right - edge.right) })).filter((row) => row.over > 0);
    return { width: Math.round(edge.width), past: past.slice(0, 8), count: past.length };
  });
  if (shot) await page.screenshot({ path: `${shot}-outline-narrow.png`, clip: { x: 0, y: 40, width: 700, height: 700 } });
  console.log("    narrow panel:", JSON.stringify(overflow));
  if (!(overflow.width < narrowed.from - 40)) throw new Error(`The panel did not get narrower: ${narrowed.from} -> ${overflow.width}`);
  if (overflow.count) throw new Error(`Buttons go past the panel: ${JSON.stringify(overflow)}`);
  // Back to where it was, for the rest of this test.
  const back = await page.evaluate(() => { const handle = document.querySelector<HTMLElement>('[data-panel-group] [data-panel-resize-handle-id]')!.getBoundingClientRect(); return { x: handle.left + handle.width / 2, y: handle.top + handle.height / 2 }; });
  await page.mouse.move(back.x, back.y);
  await page.mouse.down();
  await page.mouse.move(narrowed.x, back.y, { steps: 8 });
  await page.mouse.up();
  console.log(`ok  lighting, fog and effects in the outline, found by search, and not cut off (${Math.round(overflow.width)} wide)`);

  // Fog: a picture of the track that follows the settings, and a file that keeps them.
  await open("fog", '[aria-label="The track with this fog"]');
  const picture = () => page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[aria-label="The track with this fog"]')!;
    const { data } = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
    let sum = 0, red = 0;
    for (let i = 0; i < data.length; i += 4) { sum += data[i] + data[i + 1] + data[i + 2]; red += data[i] - data[i + 1]; }
    return { sum: sum / data.length, red: red / data.length };
  });
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent?.trim() === "The start line")?.click());
  await new Promise((done) => setTimeout(done, 600));
  // Every option explains itself, and the line under Kind follows the kind chosen.
  for (const [name, words] of [["Kind", "how the fog grows"], ["Colour", "fades things into"], ["Starts at", "begins"], ["Thickest at", "main control"], ["Fade, in frames", "33 seconds"], ["Range correction", "across the screen"], ["Settings", "four fog settings"], ["Seen from", "picture is taken"]]) {
    // In steps, as a hand moves it: a tooltip waits for the pointer to arrive, not to appear.
    const tip = await page.evaluate((id) => { const rect = document.querySelector(`[data-fog-help="${id}"] svg`)!.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; }, name);
    await page.mouse.move(tip.x, tip.y, { steps: 12 });
    await page.mouse.move(tip.x + 1, tip.y, { steps: 2 });
    await page.waitForFunction((text) => [...document.querySelectorAll('[role="tooltip"]')].some((item) => item.textContent?.toLowerCase().includes(text)), { timeout: 5000 }, words);
    if (shot && name === "Thickest at") await page.screenshot({ path: `${shot}-fog-help.png` });
    await page.mouse.move(tip.x + 300, tip.y + 400, { steps: 12 });
    await page.waitForFunction(() => !document.querySelector('[role="tooltip"]'), { timeout: 5000 });
  }
  const kindLine = () => page.evaluate(() => document.querySelector("[data-fog-kind-help]")!.textContent);
  if (!(await kindLine())?.includes("no fog")) throw new Error(`Kind line: ${await kindLine()}`);
  await page.select('[aria-label="Fog kind"]', "4");
  await page.waitForFunction(() => document.querySelector("[data-fog-kind-help]")!.textContent?.includes("The usual one"));
  await page.select('[aria-label="Fog kind"]', "0");
  const clear = await picture();
  if (!(clear.sum > 5)) throw new Error(`The fog preview is empty: ${JSON.stringify(clear)}`);
  if (shot) await page.screenshot({ path: `${shot}-fog-before.png` });
  await page.select('[aria-label="Fog kind"]', "1");
  await page.evaluate(() => {
    const color = document.querySelector<HTMLInputElement>('[aria-label="Fog colour"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(color, "#ff0000");
    color.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const setField = async (selector: string, value: string) => {
    await page.click(selector, { count: 3 });
    await page.keyboard.type(value);
    await page.keyboard.press("Tab");
  };
  await setField('[aria-label="Fog start"]', "0");
  await setField('[aria-label="Fog end"]', "5000");
  await new Promise((done) => setTimeout(done, 400));
  const fogged = await picture();
  if (!(fogged.red > clear.red + 10)) throw new Error(`Red fog does not show: ${JSON.stringify({ clear, fogged })}`);
  if (shot) await page.screenshot({ path: `${shot}-fog-after.png` });
  // An area for another entry, then the file is written and can be undone.
  await clickButton("Fog 2");
  const areasBefore = await page.evaluate(() => (window as any).app.doc.kmp.AREA.length);
  await clickButton("Add an area for Fog 2");
  await page.waitForFunction((n) => { const list = (window as any).app.doc.kmp.AREA; return list.length === n + 1 && list[n].type === 2 && list[n].setting1 === 2; }, {}, areasBefore);
  await clickButton("Apply");
  await closed();
  const written = await page.evaluate(() => {
    const app = (window as any).app;
    const find = (node: any, path = ""): any => { for (const child of node.children || []) { if (child.children) { const hit = find(child); if (hit) return hit; } else if (/posteffect\.bfg$/i.test(child.name)) return child; } return null; };
    const node = find(app.doc.szs), view = new DataView(node.data.buffer, node.data.byteOffset, node.data.byteLength);
    return { label: app.doc.undoStack.at(-1)?.label, type: view.getInt32(0), end: view.getFloat32(8), red: node.data[0x0C], green: node.data[0x0D], size: node.data.length };
  });
  if (written.label !== "Fog" || written.type !== 1 || written.end !== 5000 || written.red !== 255 || written.green !== 0 || written.size < 112) throw new Error(`Fog not written: ${JSON.stringify(written)}`);
  // Opened again it reads what was written.
  await open("fog", '[aria-label="The track with this fog"]');
  const reread = await page.evaluate(() => ({ kind: document.querySelector<HTMLSelectElement>('[aria-label="Fog kind"]')!.value, end: document.querySelector<HTMLInputElement>('[aria-label="Fog end"]')!.value, colour: document.querySelector<HTMLInputElement>('[aria-label="Fog colour"]')!.value }));
  if (reread.kind !== "1" || reread.end !== "5000" || reread.colour !== "#ff0000") throw new Error(`Fog read back wrong: ${JSON.stringify(reread)}`);
  await clickButton("Cancel");
  await closed();
  await page.evaluate(() => { const app = (window as any).app; app.cmd("undo"); app.cmd("undo"); });
  console.log("ok  fog changed with a picture of it, written and undone");

  // Versions: two saves leave what they replaced; compared, marked on the track, and gone back to.
  const trackFile = join(files, "Race", "Course", "castle_course.szs");
  const originalBytes = readFileSync(trackFile);
  const moved = await page.evaluate(async () => {
    const app = (window as any).app, object = app.doc.kmp.GOBJ.find((o: any) => o.objectId === 0x65);
    app.doc.change("Move a box", () => { object.pos[0] += 700; });
    await app.save(false);
    app.doc.change("Remove an object", () => { app.doc.kmp.GOBJ.splice(app.doc.kmp.GOBJ.length - 1, 1); });
    await app.save(false);
    return object.uid;
  });
  await open("versions", "[data-version]");
  if (await page.evaluate(() => document.querySelectorAll("[data-version]").length) !== 2) throw new Error("Saving did not keep two versions");
  if (shot) await page.screenshot({ path: `${shot}-versions.png` });
  // The older one is the file as it first was: the box moved, and one object gone.
  await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("[data-version]")].at(-1)!.querySelector<HTMLButtonElement>("button")!.click());
  await page.waitForSelector("[data-track-compare]");
  await new Promise((done) => setTimeout(done, 400));
  const listed = await page.evaluate(() => [...document.querySelectorAll("[data-difference]")].map((row) => row.getAttribute("data-difference")));
  if (!listed.includes("moved") || !listed.includes("removed")) throw new Error(`Compare found: ${listed}`);
  if (shot) await page.screenshot({ path: `${shot}-compare.png` });
  await clickButton("Show on the track");
  await page.waitForSelector("[data-comparison-bar]");
  await new Promise((done) => setTimeout(done, 800));
  if (shot) await page.screenshot({ path: `${shot}-compare-track.png` });
  const onTrack = await page.evaluate((key) => {
    const app = (window as any).app, marks = app.viewport.scene.getObjectByName("comparison");
    return { marks: marks?.children.length, selected: [...app.doc.selection], places: app.comparison.places.length, wanted: String(key) };
  }, moved);
  if (!onTrack.marks || onTrack.places < 2) throw new Error(`Nothing marked on the track: ${JSON.stringify(onTrack)}`);
  await page.click('[aria-label="Next difference"]');
  await page.waitForFunction(() => document.querySelector("[data-comparison-bar]")?.getAttribute("data-comparison-bar") === "1");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>("[data-comparison-bar] button")].find((b) => b.textContent?.includes("Stop comparing"))?.click());
  await page.waitForFunction(() => !document.querySelector("[data-comparison-bar]") && !(window as any).app.viewport.scene.getObjectByName("comparison"));
  // Going back: the file is as it was, the track reopens, and what it held is kept as a version.
  const objectsNow = await page.evaluate(() => (window as any).app.doc.kmp.GOBJ.length);
  await open("versions", "[data-version]");
  await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("[data-version]")].at(-1)!.querySelectorAll<HTMLButtonElement>("button")[1].click());
  await page.waitForFunction(() => document.body.textContent?.includes("Go back to this version?"));
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find((b) => b.textContent?.trim() === "Go back")?.click());
  await page.waitForFunction(() => !document.querySelector("[data-versions]"), { timeout: 60000 });
  await page.waitForFunction((n) => (window as any).app.doc.kmp.GOBJ.length === n && !(window as any).app.doc.dirty, { timeout: 60000 }, objectsNow + 1);
  if (!Buffer.from(readFileSync(trackFile)).equals(originalBytes)) throw new Error("Going back did not restore the file's bytes");
  console.log("ok  versions kept on save, compared, marked on the track, and gone back to");

  // Check: an original track has no errors, and its size is measured and within the originals.
  await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find((tab) => tab.textContent?.trim() === "Check")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })));
  await page.waitForSelector("[data-track-usage]");
  await page.evaluate(() => document.querySelector<HTMLDetailsElement>("[data-track-usage]")!.open = true);
  await new Promise((done) => setTimeout(done, 300));
  if (shot) await page.screenshot({ path: `${shot}-check.png` });
  const checked = await page.evaluate(() => ({
    errors: (window as any).app.issues.filter((issue: any) => issue.level === "error").map((issue: any) => issue.msg),
    high: document.querySelector("[data-track-usage]")!.getAttribute("data-usage-high"),
    rows: document.querySelectorAll("[data-usage-row]").length,
    archive: document.querySelector('[data-usage-row="archive"]')!.textContent,
  }));
  if (checked.errors.length) throw new Error(`An original track has errors in Check: ${checked.errors}`);
  if (checked.high !== "0" || checked.rows < 10 || /^Archive, unpacked0\.00/.test(checked.archive || "")) throw new Error(`Track size: ${JSON.stringify(checked)}`);
  await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find((tab) => tab.textContent?.trim() === "Track")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })));
  console.log("ok  check runs on an original track without errors, with its size");

  // A complete template sets the shape and the look together.
  await page.evaluate(() => { void (window as any).app.newTrack({ inPlace: true }); });
  await page.waitForSelector('[data-track-templates]');
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>("[data-track-templates] button")].find((b) => b.textContent?.includes("Mountain rally"))?.click());
  await new Promise((done) => setTimeout(done, 800));
  if (shot) await page.screenshot({ path: `${shot}-templates.png` });
  const look = await page.evaluate(() => document.querySelector('[aria-label="Track style"]')?.textContent || "");
  if (!look.includes("Dirt rally")) throw new Error(`The template did not choose its style: ${look}`);
  console.log("ok  template sets the shape and style");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent?.trim() === "Cancel")?.click());
  await page.waitForFunction(() => !document.querySelector("[data-track-templates]"));

  // Materials: a change goes into the model, with a step back in the main window.
  await open("materials", '[aria-label="Faces shown"]');
  if (shot) await page.screenshot({ path: `${shot}-materials.png` });
  await page.select('[aria-label="Faces shown"]', "0");
  await page.waitForFunction(() => (window as any).app.doc.undoStack.at(-1)?.label?.startsWith("Faces shown"));
  await clickButton("Done");
  await closed();
  await page.evaluate(() => (window as any).app.cmd("undo"));
  console.log("ok  material changed and undone");

  // Primitive: the preview draws, values move it, and placing adds it to the model with collision.
  await open("primitive", "[data-primitive-preview] canvas");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent?.trim() === "Ramp")?.click());
  await page.select('[role="dialog"] select[aria-label="Collision"]', "0");
  await new Promise((done) => setTimeout(done, 300));
  if (shot) await page.screenshot({ path: `${shot}-primitive.png` });
  const before = await page.evaluate(() => ({ count: (window as any).app.doc.kcl.count, history: (window as any).app.doc.undoStack.length }));
  await clickButton("Place on the track…");
  await closed();
  // The shape asks where to go; the centre of the view answers Esc.
  await new Promise((done) => setTimeout(done, 300));
  await page.keyboard.press("Escape");
  await page.waitForFunction((n) => (window as any).app.doc.kcl.count > n, { timeout: 120000 }, before.count);
  if (await label() !== "Add primitive collision") throw new Error(`The collision step is missing: ${await label()}`);
  console.log("ok  primitive placed in the model, with collision");

  // Sculpt: a stroke lifts the model; Apply writes it and the collision.
  await open("sculpt", "[data-sculpt] canvas");
  await new Promise((done) => setTimeout(done, 500));
  if (shot) await page.screenshot({ path: `${shot}-sculpt.png` });
  const box = (await (await page.$("[data-sculpt] canvas"))!.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 10, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent === "Apply")?.disabled === false, { timeout: 60000 });
  await new Promise((done) => setTimeout(done, 300));
  if (shot) await page.screenshot({ path: `${shot}-sculpted.png` });
  await clickButton("Apply");
  await closed();
  const steps = await page.evaluate(() => (window as any).app.doc.undoStack.slice(-2).map((s: any) => s.label));
  if (!steps.includes("Sculpt the track model")) throw new Error(`Sculpting left no step: ${steps}`);
  console.log("ok  stroke applied to the model and collision");

  // Emitters: a copy appears and goes away again.
  await open("effects", '[role="dialog"] canvas');
  await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"] button')].some((b) => b.textContent?.trim() === "Duplicate"));
  const emitters = () => page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].filter((b) => b.querySelector("svg") && /_copy/.test(b.textContent || "")).length);
  await clickButton("Duplicate");
  await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.textContent?.includes("_copy"));
  if (await emitters() !== 1) throw new Error("The emitter copy is not in the list");
  await clickButton("Remove");
  await page.waitForFunction(() => document.body.textContent?.includes("The game can crash"));
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find((b) => b.textContent?.trim() === "Remove")?.click());
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]')?.textContent?.includes("_copy"));
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.getAttribute("aria-label")?.startsWith("Close") || b.title === "Close")?.click());
  await page.waitForFunction(() => { const d = document.querySelector('[role="dialog"]'); return !d || document.querySelector('[role="alertdialog"]'); });
  console.log("ok  emitter duplicated and removed");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find((b) => /discard|close|leave/i.test(b.textContent || ""))?.click());
  await closed();

  // The game's minimap colour goes to Race.szs in the temporary game folder.
  await open("mapColour", '[aria-label="Top colour"]');
  await page.evaluate(() => {
    const set = (label: string, value: string) => {
      const input = document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    set("Top colour", "#ff0000"); set("Bottom colour", "#0000ff");
  });
  if (shot) await page.screenshot({ path: `${shot}-colour.png` });
  await clickButton("Save to the game folder");
  await closed();
  const race = parseU8(yaz0Decompress(new Uint8Array(readFileSync(join(files, "Scene", "UI", "Race.szs")))));
  const colours = readMapColours(findFile(race, MAP_LAYOUT)!.data);
  if (colours[0][0] !== 255 || colours[0][2] !== 0 || colours[3][2] !== 255) throw new Error(`The colour was not saved: ${colours}`);
  console.log("ok  minimap colour saved in Race.szs");

  // The track creator: a shortcut drawn with the mouse, smoothing and scenery, built for real.
  await page.evaluate(() => { void (window as any).app.newTrack({ inPlace: true }); });
  await page.waitForSelector('[data-testid="generator-canvas"]');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]')?.getAnimations({ subtree: true }).some((a) => a.playState === "running"));
  await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent?.includes("Race"))?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })));
  await page.waitForSelector('[aria-label="Scenery"]');
  await page.select('[aria-label="Scenery"]', "light");
  await clickButton("Draw a shortcut (beta)");
  await new Promise((done) => setTimeout(done, 300));
  // The road is the light shape on the drawing: find it going in from two sides.
  const road = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="generator-canvas"]')!, rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width, ctx = canvas.getContext("2d")!;
    const back = ctx.getImageData(2, 2, 1, 1).data;
    const differs = (x: number, y: number) => { const d = ctx.getImageData(x, y, 1, 1).data; return Math.abs(d[0] - back[0]) + Math.abs(d[1] - back[1]) + Math.abs(d[2] - back[2]) > 30; };
    const midY = Math.round(canvas.height / 2), midX = Math.round(canvas.width / 2);
    let left = 0, top = 0;
    for (let x = 0; x < canvas.width; x++) if (differs(x, midY)) { left = x; break; }
    // From below: the start line is at the top, where a shortcut is refused.
    for (let y = canvas.height - 1; y >= 0; y--) if (differs(midX, y)) { top = y; break; }
    return { a: { x: rect.left + (left + 12 * scale) / scale, y: rect.top + midY / scale }, b: { x: rect.left + midX / scale, y: rect.top + (top - 12 * scale) / scale } };
  });
  await page.mouse.click(road.a.x, road.a.y);
  await new Promise((done) => setTimeout(done, 100));
  // Inside the loop, away from any road: a bend of the shortcut.
  await page.mouse.click(road.b.x - (road.b.x - road.a.x) * .35, road.a.y + 40);
  await new Promise((done) => setTimeout(done, 100));
  await page.mouse.click(road.b.x, road.b.y);
  await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.textContent?.includes("1 on this track"), { timeout: 30000 });
  await new Promise((done) => setTimeout(done, 500));
  if (shot) await page.screenshot({ path: `${shot}-shortcut.png` });
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[aria-label="Smooth curves"]')?.click());
  await clickButton("Generate track");
  // The earlier steps left this track unsaved, and the new one replaces it here.
  await page.waitForFunction(() => document.body.textContent?.includes("Discard them?"));
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find((b) => b.textContent?.trim() === "Discard changes")?.click());
  await page.waitForFunction(() => (window as any).app.doc.kmp?.CKPT?.length === 4 && !document.querySelector('[data-testid="generator-canvas"]'), { timeout: 200000 });
  const built = await page.evaluate(() => {
    const app = (window as any).app, tree = app.doc.szs;
    const names = (function walk(node: any, out: string[] = []) { for (const child of node.children || []) { out.push(child.name); walk(child, out); } return out; })(tree.root || tree);
    return { groups: app.doc.kmp.ENPT.length, areas: app.doc.kmp.AREA.filter((a: any) => a.type === 0).length, objects: app.doc.kmp.GOBJ.map((o: any) => o.objectId), names };
  });
  if (built.groups !== 4 || built.areas < 6) throw new Error(`The track was not built with its groups and cameras: ${JSON.stringify({ ...built, names: 0 })}`);
  if (!built.objects.includes(0x12F)) throw new Error("The scenery was not placed");
  if (!built.names.some((n: string) => /castletree1\.brres/i.test(n))) throw new Error(`The scenery's model was not copied: ${built.names.slice(0, 20)}`);
  await new Promise((done) => setTimeout(done, 800));
  if (shot) await page.screenshot({ path: `${shot}-built.png` });
  console.log("ok  shortcut drawn, smoothed, built with scenery and replay cameras");

  if (errors.length) throw new Error(`Browser errors: ${errors.join("; ")}`);
} finally {
  await browser?.close();
  worker.terminate();
  const target = resolve(temp);
  if (!target.startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe temporary test path");
  rmSync(target, { recursive: true, force: true });
}
