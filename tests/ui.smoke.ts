// UI smoke test: runs the real UI in headless Edge, reports errors and saves screenshots.
// Usage: bun run tests/ui.smoke.ts <screenshot-dir>
import puppeteer from "puppeteer-core";
import { AREA_TYPES } from "../web/js/data/defs.js";
import { AREA_TYPE_HELP } from "../web/js/data/help.js";

// Screenshots go to the folder given on the command line, or to a temporary folder (never the project).
const outDir = process.argv[2] || mkdtempSync(joinPath(tmpdir(), "mkwii-shots-"));
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
// Isolated settings and temp files: tests never touch the real user settings.
const testDir = mkdtempSync(joinPath(tmpdir(), "mkwii-test-"));
await Bun.write(joinPath(testDir, "settings.json"), JSON.stringify({ tourDone: true }));
const worker = new Worker(new URL("../src/server.ts", import.meta.url).href);
const port: number = await new Promise((res) => {
  worker.onmessage = (e) => e.data?.type === "ready" && res(e.data.port);
  worker.postMessage({ type: "start", token: "smoke", settingsDir: testDir });
});
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1600,950"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 950 });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warn") errors.push(m.type() + ": " + m.text()); });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const shot = (name: string) => page.screenshot({ path: `${outDir}/${name}.png` });

// Simulated native window bridge: records the calls made by the integrated title bar.
await page.evaluateOnNewDocument(() => {
  (window as any).__winCalls = [];
  (window as any).__winctl = async (action: string) => { (window as any).__winCalls.push(action); return { maximized: action === "toggle" }; };
});
await page.goto(`http://127.0.0.1:${port}/?t=smoke`, { waitUntil: "networkidle0" });
await wait(800);
await shot("1-welcome");
await page.evaluate(() => ([...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Game text")) as HTMLElement)?.click());
await page.waitForSelector('[role="dialog"]');
if (!(await page.evaluate(() => document.querySelector('[role="dialog"]')?.textContent?.includes("Game text"))))
  throw new Error("Game text editor did not open from Home without a track");
await page.evaluate(() => (document.querySelector('[role="dialog"] button[aria-label="Close game text editor"]') as HTMLElement)?.click());
await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
await page.mouse.move(1598, 450);
await page.mouse.down();
await page.mouse.move(1580, 450, { steps: 3 });
await page.mouse.up();
const resizeCalls = await page.evaluate(() => (window as any).__winCalls);
if (!resizeCalls.includes("resize"))
  throw new Error("Invisible window resize edge did not send native controls: " + JSON.stringify(resizeCalls));
for (const label of ["Minimize", "Maximize"]) await page.click(`button[aria-label="${label}"]`);
await new Promise((r) => setTimeout(r, 200));
console.log("window controls:", JSON.stringify(await page.evaluate(() => (window as any).__winCalls)));
await page.mouse.move(650, 20);
await page.mouse.down();
await page.mouse.move(670, 20, { steps: 3 });
await page.mouse.up();
if (!(await page.evaluate(() => (window as any).__winCalls.includes("drag")))) throw new Error("Title bar no longer drags the window");
const controlsBeforeTitleClick = await page.evaluate(() => (window as any).__winCalls.length);
await page.mouse.click(650, 2, { clickCount: 2 });
const controlsAfterTitleClick = await page.evaluate(() => (window as any).__winCalls.length);
if (controlsAfterTitleClick !== controlsBeforeTitleClick) throw new Error("Clicking the title bar edge triggered a window action");
const nativeMenuBlocked = await page.evaluate(() => {
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  document.querySelector("header")?.dispatchEvent(event);
  return event.defaultPrevented;
});
if (!nativeMenuBlocked) throw new Error("Native right-click menu is not blocked in the desktop window");

// The dedicated Settings section updates the view and persists changes across a restart.
await page.click('button[aria-label="Settings"]');
await page.waitForSelector('[data-settings-panel]');
if (await page.evaluate(() => (window as any).app.settings.hideCursorWhileLooking !== true))
  throw new Error("Hide cursor must be enabled by default");
await shot("1-settings");
await page.click('#setting-flySpeed');
await page.evaluate(() => ([...document.querySelectorAll('[role="option"]')].find((el) => el.textContent === "Fast") as HTMLElement)?.click());
await page.click('#setting-showLabels');
await page.click('#setting-hideCursorWhileLooking');
await page.click('#setting-textureBrushSize', { clickCount: 3 });
await page.keyboard.type("12");
await page.keyboard.press("Tab");
await page.waitForFunction(() => {
  const app = (window as any).app;
  return app.settings.flySpeed === 1.5 && app.viewport.flySpeed === 1.5 && app.settings.showLabels === false && app.settings.hideCursorWhileLooking === false && app.settings.textureBrushSize === 12;
});
for (let attempt = 0; attempt < 30; attempt++) {
  const saved = await Bun.file(joinPath(testDir, "settings.json")).json();
  if (saved.flySpeed === 1.5 && saved.showLabels === false && saved.hideCursorWhileLooking === false && saved.textureBrushSize === 12) break;
  if (attempt === 29) throw new Error("Settings changes did not persist");
  await wait(100);
}
await page.reload({ waitUntil: "networkidle0" });
await page.waitForFunction(() => (window as any).app.settings.flySpeed === 1.5);
const restoredSettings = await page.evaluate(() => {
  const app = (window as any).app;
  return { speed: app.viewport.flySpeed, labels: app.settings.showLabels, hideCursor: app.settings.hideCursorWhileLooking, brush: app.settings.textureBrushSize };
});
if (restoredSettings.speed !== 1.5 || restoredSettings.labels !== false || restoredSettings.hideCursor !== false || restoredSettings.brush !== 12)
  throw new Error("Settings did not restore after restart: " + JSON.stringify(restoredSettings));
await page.evaluate(() => {
  const app = (window as any).app;
  app.setSettings({ flySpeed: 1, showLabels: true, hideCursorWhileLooking: true, textureBrushSize: 8 });
  app.cmd("preferences");
});
await page.waitForSelector('[data-settings-panel]');
await page.keyboard.press("Escape");
await page.waitForFunction(() => !document.querySelector("[role=dialog]"));
await page.evaluate(() => (window as any).app.setTab("outline"));

// Create a new track through the generator dialog.
await page.evaluate(() => { (window as any).app.cmd("newTrack"); });
await wait(500);
await shot("2-generator");
const clickButton = (text: string) => page.evaluate((t) => { ([...document.querySelectorAll("[role=dialog] button, [role=alertdialog] button")].find((b) => b.textContent?.includes(t)) as HTMLElement)?.click(); }, text);
await clickButton("Generate track");
await wait(1500);
await clickButton("Start editing");
await wait(500);
await shot("3-generated");
const trackSidebar = await page.evaluate(() => ({
  tabs: [...document.querySelectorAll("#sidebar-tabs [role=tab]")].map((tab) => tab.textContent?.trim()),
  modelPartRows: document.querySelectorAll('[data-outliner] [data-key^="MODEL_PART_"]').length,
  objectRows: [...document.querySelectorAll<HTMLElement>('[data-outliner] [data-key]')].filter((row) => row.getAttribute("data-key") === String((window as any).app.doc.kmp.GOBJ[0]?.uid)).length,
}));
if (trackSidebar.tabs?.includes("Objects") || trackSidebar.tabs?.length !== 4 || trackSidebar.modelPartRows || trackSidebar.objectRows)
  throw new Error("Track sidebar should start collapsed with no visible Objects tab: " + JSON.stringify(trackSidebar));
await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-outliner] span')].find((el) => el.textContent?.trim() === "Objects")?.click());
await page.waitForFunction(() => {
  const id = String((window as any).app.doc.kmp.GOBJ[0]?.uid);
  return !!document.querySelector(`[data-outliner] [data-key="${id}"]`);
});
await page.evaluate(() => {
  const label = [...document.querySelectorAll<HTMLElement>('[data-outliner] .sticky span')].find((el) => el.textContent?.trim() === "Objects");
  label?.closest<HTMLElement>(".sticky")?.querySelectorAll<HTMLButtonElement>("button")?.item(1)?.click();
});
await page.waitForSelector('[role="dialog"] input[placeholder^="Search objects"]');
await page.keyboard.press("Escape");
await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));

if (AREA_TYPE_HELP.length !== AREA_TYPES.length || AREA_TYPE_HELP.some((h) => !h.what || !h.use))
  throw new Error("Every AREA type needs an effect and usage explanation");
await page.evaluate(() => { (window as any).app.ops.add("AREA", [0, 0, 0]); });
await page.waitForSelector("[data-area-type-info]");
for (const type of [0, 3, 9, 10]) {
  await page.evaluate((n) => {
    const app = (window as any).app;
    app.doc.change("Change area type", () => { app.doc.kmp.AREA.at(-1).type = n; }, { structural: true });
  }, type);
  await page.waitForFunction((n) => document.querySelector("[data-area-type-info]")?.textContent?.includes(`Type ${n}:`), {}, type);
  const details = await page.$eval("[data-area-type-info]", (el) => el.textContent || "");
  if (!details.includes("What it does:") || !details.includes("When to use it:"))
    throw new Error(`AREA type ${type} is missing its explanation`);
}

// Select an item box and switch to rotate mode.
await page.evaluate(() => {
  const app = (window as any).app;
  const box = app.doc.kmp.GOBJ[0];
  app.doc.select(String(box.uid));
  app.viewport.focusSelection();
  app.viewport.setMode("rotate");
});
await wait(700);
await shot("4-object-selected");

// Simulate a gizmo move through the document API and check undo.
const res = await page.evaluate(() => {
  const app = (window as any).app;
  const before = [...app.doc.kmp.GOBJ[0].pos];
  app.ops.setField("pos", 0, before[0] + 500, "Move");
  const moved = app.doc.kmp.GOBJ[0].pos[0];
  app.doc.undo();
  return { before: before[0], moved, after: app.doc.kmp.GOBJ[0].pos[0] };
});
console.log("move/undo:", res);

await page.evaluate(() => { const a = (window as any).app; a.viewport.setMode("translate"); a.setTab("collision"); a.doc.clearSelection(); a.viewport.frameAll(); });
await wait(600);
await shot("5-collision-tab");
await page.evaluate(() => ([...document.querySelectorAll('[aria-label="Collision mode"] [role="tab"]')].find((b) => b.textContent?.includes("Paint")) as HTMLElement)?.click());
await page.waitForSelector('[aria-label="Collision paint opacity"]');
const paintView = await page.evaluate(() => {
  const vp = (window as any).app.viewport;
  const standIn = vp.hasCourseModel ? null : vp.kclMesh.clone();
  if (standIn) { standIn.material = vp.kclMesh.material.clone(); vp.courseGroup.add(standIn); }
  vp.paintOpacity = 0.4; vp.applyDisplayMode();
  const state = { model: vp.courseGroup.visible, collision: vp.kclGroup.visible, opacity: vp.kclMesh.material.opacity, wire: vp.kclWire?.visible };
  if (standIn) { vp.courseGroup.remove(standIn); standIn.material.dispose(); }
  vp.paintOpacity = 0.35; vp.applyDisplayMode();
  return state;
});
if (!paintView.model || !paintView.collision || Math.abs(paintView.opacity - 0.4) > 0.001 || !paintView.wire)
  throw new Error("Paint opacity or model overlay is not applied: " + JSON.stringify(paintView));
await shot("5-collision-paint");
await page.evaluate(() => ([...document.querySelectorAll('[aria-label="Collision mode"] [role="tab"]')].find((b) => b.textContent?.includes("Show")) as HTMLElement)?.click());
const collisionMove = await page.evaluate(() => {
  const app = (window as any).app, vp = app.viewport;
  app.startGeometryEditing("collision");
  vp.selectGeometry({ type: "collision", tri: 0 });
  const before = app.doc.kcl.verts[0];
  vp.onGizmoDragging(true);
  vp.pivot.position.x += 120;
  vp.onGizmoChange();
  vp.onGizmoDragging(false);
  const moved = app.doc.kcl.verts[0];
  const bytes = app.kclBytes();
  app.doc.undo();
  const undone = app.doc.kcl.verts[0];
  app.stopTool();
  return { before, moved, undone, bytes: bytes.length };
});
if (Math.abs(collisionMove.moved - collisionMove.before - 120) > 0.01 || Math.abs(collisionMove.undone - collisionMove.before) > 0.01 || !collisionMove.bytes)
  throw new Error("Collision move, KCL rebuild or undo failed: " + JSON.stringify(collisionMove));
console.log("collision move/undo:", collisionMove);
const collisionEdit = await page.evaluate(() => {
  const app = (window as any).app, vp = app.viewport;
  app.startGeometryEditing("collision");
  vp.selectGeometry({ type: "collision", tri: 0 });
  const count = app.doc.kcl.count, x = app.doc.kcl.verts[0], type = app.doc.kcl.flags[0] & 31;
  app.editCollisionVertex(0, 0, x + 20);
  app.editCollisionType((type + 1) & 31);
  const edited = app.doc.kcl.verts[0] === x + 20 && (app.doc.kcl.flags[0] & 31) === ((type + 1) & 31);
  app.duplicateCollisionTriangle();
  const duplicated = app.doc.kcl.count === count + 1;
  app.doc.undo(); app.doc.undo(); app.doc.undo();
  app.stopTool();
  return { edited, duplicated, restored: app.doc.kcl.count === count && app.doc.kcl.verts[0] === x && (app.doc.kcl.flags[0] & 31) === type };
});
if (!Object.values(collisionEdit).every(Boolean)) throw new Error("Collision editing failed: " + JSON.stringify(collisionEdit));
console.log("collision editor:", collisionEdit);
const collisionMulti = await page.evaluate(() => {
  const app = (window as any).app, vp = app.viewport;
  app.startGeometryEditing("collision");
  vp.selectGeometry({ type: "collision", tris: [0, 1], tri: 1 });
  const before = [app.doc.kcl.verts[0], app.doc.kcl.verts[9]];
  const flags = [app.doc.kcl.flags[0], app.doc.kcl.flags[1]];
  const count = app.doc.kcl.count;
  vp.onGizmoDragging(true);
  vp.pivot.position.x += 75;
  vp.onGizmoChange();
  vp.onGizmoDragging(false);
  const moved = [app.doc.kcl.verts[0], app.doc.kcl.verts[9]];
  app.editCollisionType(6);
  const painted = [app.doc.kcl.flags[0] & 31, app.doc.kcl.flags[1] & 31];
  app.duplicateCollisionTriangle();
  const duplicated = app.doc.kcl.count === count + 2;
  app.deleteCollisionTriangle();
  const deleted = app.doc.kcl.count === count;
  for (let i = 0; i < 4; i++) app.doc.undo();
  vp.selectGeometry(null); app.stopTool();
  return { moved, before, painted, duplicated, deleted, restored: app.doc.kcl.count === count && app.doc.kcl.verts[0] === before[0] && app.doc.kcl.verts[9] === before[1] && app.doc.kcl.flags[0] === flags[0] && app.doc.kcl.flags[1] === flags[1] };
});
if (collisionMulti.moved.some((v: number, i: number) => Math.abs(v - collisionMulti.before[i] - 75) > 0.01) || collisionMulti.painted.some((t: number) => t !== 6) || !collisionMulti.duplicated || !collisionMulti.deleted || !collisionMulti.restored)
  throw new Error("Multi-selection collision editing failed: " + JSON.stringify(collisionMulti));
console.log("collision multi-selection:", collisionMulti);
const collisionClick = await page.evaluate(() => {
  const app = (window as any).app, vp = app.viewport;
  app.startGeometryEditing("collision");
  vp.selectGeometry({ type: "collision", tri: 0 });
  (vp as any).originalPickGeometry = vp.pickGeometry;
  vp.pickGeometry = () => ({ type: "collision", tri: 1 });
  const r = vp.canvas.getBoundingClientRect();
  return { x: r.left + 40, y: r.top + 85 };
});
await page.keyboard.down("Shift"); await page.mouse.click(collisionClick.x, collisionClick.y); await page.keyboard.up("Shift");
const collisionAdded = await page.evaluate(() => [...(window as any).app.viewport.geometrySelection.tris]);
await page.keyboard.down("Control"); await page.mouse.click(collisionClick.x, collisionClick.y); await page.keyboard.up("Control");
const collisionModifiers = await page.evaluate(() => {
  const app = (window as any).app, vp = app.viewport;
  const removed = [...vp.geometrySelection.tris];
  vp.pickGeometry = vp.originalPickGeometry;
  delete vp.originalPickGeometry;
  vp.selectGeometry(null); app.stopTool();
  return { removed };
});
if (JSON.stringify(collisionAdded) !== "[0,1]" || JSON.stringify(collisionModifiers.removed) !== "[0]")
  throw new Error("Shift/Ctrl collision selection failed: " + JSON.stringify({ collisionAdded, collisionModifiers }));
const marqueeCount = await page.evaluate(() => {
  const app = (window as any).app, vp = app.viewport, r = vp.canvas.getBoundingClientRect();
  app.startGeometryEditing("collision");
  vp.marqueeCollision({ x: r.left, y: r.top }, { clientX: r.right, clientY: r.bottom });
  const count = vp.geometrySelection?.tris.length || 0;
  vp.selectGeometry(null); app.stopTool();
  return count;
});
if (marqueeCount < 10) throw new Error("Collision area selection found too few triangles: " + marqueeCount);
const collisionBeforeDraw = await page.evaluate(() => { const a = (window as any).app; a.startCollisionDrawing(); return a.doc.kcl.count; });
const collisionCanvas = await page.evaluate(() => { const r = (window as any).app.viewport.canvas.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
await page.mouse.click(collisionCanvas.x - 65, collisionCanvas.y - 35);
await page.mouse.click(collisionCanvas.x + 65, collisionCanvas.y - 35);
await page.mouse.click(collisionCanvas.x, collisionCanvas.y + 55);
const collisionDraw = await page.evaluate(() => {
  const a = (window as any).app;
  const added = a.doc.kcl.count;
  const selected = a.geometrySelection?.type === "collision" && a.geometrySelection.tri === added - 1;
  a.doc.undo(); a.stopTool();
  return { added, selected, restored: a.doc.kcl.count };
});
if (collisionDraw.added !== collisionBeforeDraw + 1 || !collisionDraw.selected || collisionDraw.restored !== collisionBeforeDraw)
  throw new Error("Drawing a custom collision triangle or undo failed: " + JSON.stringify(collisionDraw));
console.log("custom collision draw:", collisionDraw);
const flyBefore = await page.evaluate(() => { const vp = (window as any).app.viewport; vp.canvas.focus(); return vp.camera.position.toArray(); });
await page.keyboard.down("w");
await wait(250);
await page.keyboard.up("w");
const flyAfter = await page.evaluate(() => (window as any).app.viewport.camera.position.toArray());
if (Math.hypot(...flyAfter.map((v: number, i: number) => v - flyBefore[i])) < 1) throw new Error("WASD without right mouse button did not move camera");
console.log("free WASD moved camera:", Math.round(Math.hypot(...flyAfter.map((v: number, i: number) => v - flyBefore[i]))));
await page.keyboard.down("e");
await wait(180);
await page.keyboard.up("e");
const flyUp = await page.evaluate(() => (window as any).app.viewport.camera.position.y);
if (flyUp <= flyAfter[1] + 1) throw new Error("Free vertical camera movement did not work");
const lookBefore = await page.evaluate(() => (window as any).app.viewport.controls.target.toArray());
await page.evaluate(() => (window as any).app.setSetting("hideCursorWhileLooking", false));
await page.mouse.move(800, 430);
await page.mouse.down({ button: "right" });
const cursorWhileLooking = await page.evaluate(() => (window as any).app.viewport.canvas.style.cursor);
await page.mouse.move(890, 465, { steps: 3 });
await page.mouse.up({ button: "right" });
const cursorAfterLooking = await page.evaluate(() => (window as any).app.viewport.canvas.style.cursor);
if (cursorWhileLooking !== "" || cursorAfterLooking !== "") throw new Error("Right-drag cursor should remain visible with Hide cursor off");
const lookAfter = await page.evaluate(() => (window as any).app.viewport.controls.target.toArray());
if (Math.hypot(...lookAfter.map((v: number, i: number) => v - lookBefore[i])) < 1) throw new Error("Free right-drag look did not rotate the camera");
await page.evaluate(() => (window as any).app.setSetting("hideCursorWhileLooking", true));
await page.mouse.down({ button: "right" });
if (await page.evaluate(() => (window as any).app.viewport.canvas.style.cursor) !== "none")
  throw new Error("Enabled setting did not hide the cursor during right-drag");
await page.mouse.move(920, 465, { steps: 2 });
await page.mouse.up({ button: "right" });
if (await page.evaluate(() => (window as any).app.viewport.canvas.style.cursor) !== "")
  throw new Error("Cursor did not return after right-drag");
await page.evaluate(() => (window as any).app.setSetting("hideCursorWhileLooking", false));
await page.evaluate(() => (window as any).app.setTab("validate"));
await wait(500);
await shot("6-validate");
await page.evaluate(() => { const a = (window as any).app; a.setTab("objects"); const cp = a.doc.kmp.CKPT[0].points[3]; a.doc.select(String(cp.uid)); a.viewport.focusSelection(); });
await wait(600);
await shot("7-checkpoint");

// Real mouse interaction: click an item box from the top view, then drag the gizmo X arrow.
const scr = async () => page.evaluate(() => {
  const a = (window as any).app, vp = a.viewport;
  const box = a.doc.kmp.GOBJ[0];
  a.doc.clearSelection();
  vp.controls.target.set(box.pos[0], box.pos[1], box.pos[2]);
  vp.camera.position.set(box.pos[0], box.pos[1] + 6000, box.pos[2] + 1);
  vp.controls.update();
  vp.rebuildKMP();
  vp.renderer.render(vp.scene, vp.camera);
  const r = vp.canvas.getBoundingClientRect();
  const v = vp.camera.position.clone().set(box.pos[0], box.pos[1] + 100, box.pos[2]).project(vp.camera);
  return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
});
const p0 = await scr();
await wait(200);
await page.mouse.click(p0.x, p0.y);
await wait(300);
const selected = await page.evaluate(() => { const a = (window as any).app; return a.doc.selection.has(String(a.doc.kmp.GOBJ[0].uid)); });
console.log("click selects item box:", selected);
const before = await page.evaluate(() => (window as any).app.doc.kmp.GOBJ[0].pos[0]);
await page.mouse.move(p0.x + 70, p0.y);
await wait(100);
await page.mouse.move(p0.x + 75, p0.y);
await wait(100);
await page.mouse.down();
await page.mouse.move(p0.x + 120, p0.y, { steps: 5 });
await page.mouse.move(p0.x + 175, p0.y, { steps: 5 });
await page.mouse.up();
await wait(300);
const after = await page.evaluate(() => { const a = (window as any).app; return { x: a.doc.kmp.GOBJ[0].pos[0], undo: a.doc.undoStack.at(-1)?.label }; });
console.log("gizmo drag moved X by:", Math.round(after.x - before), "undo label:", after.undo);
const objectCount = await page.evaluate(() => (window as any).app.doc.kmp.GOBJ.length);
await page.keyboard.down("Control"); await page.keyboard.press("d"); await page.keyboard.up("Control");
const afterDuplicate = await page.evaluate(() => (window as any).app.doc.kmp.GOBJ.length);
if (afterDuplicate !== objectCount + 1) throw new Error("Ctrl+D did not duplicate the selected object");
await page.evaluate(() => (window as any).app.doc.undo());
await page.evaluate(() => { const a = (window as any).app; a.doc.select(String(a.doc.kmp.GOBJ[0].uid)); });
await page.keyboard.down("Control"); await page.keyboard.press("x"); await page.keyboard.up("Control");
const afterDelete = await page.evaluate(() => (window as any).app.doc.kmp.GOBJ.length);
if (afterDelete !== objectCount - 1) throw new Error("Ctrl+X did not delete the selected object");
await page.evaluate(() => (window as any).app.doc.undo());
await shot("8-after-drag");

// Save to a temporary SZS through the backend, then reopen it.
const tmp = joinPath(testDir, "mkwii_ui_test.szs");
const saved = await page.evaluate(async (path) => {
  const a = (window as any).app;
  const vp = a.viewport;
  a.startGeometryEditing("collision");
  vp.selectGeometry({ type: "collision", tri: 0 });
  vp.onGizmoDragging(true);
  vp.pivot.position.y += 80;
  vp.onGizmoChange();
  vp.onGizmoDragging(false);
  const movedY = a.doc.kcl.verts[1];
  a.stopTool();
  a.doc.filePath = path; a.doc.fileKind = "szs"; a.doc.fileName = "mkwii_ui_test.szs";
  const ok = await a.save(false);
  const counts = { gobj: a.doc.kmp.GOBJ.length, ck: a.doc.kmp.CKPT[0].points.length, tris: a.doc.kcl.count };
  a.doc.dirty = false;
  await a.openPath(path);
  return { ok, counts, movedY, reopened: { gobj: a.doc.kmp.GOBJ.length, ck: a.doc.kmp.CKPT[0].points.length, tris: a.doc.kcl.count, y: a.doc.kcl.verts[1] } };
}, tmp);
if (!saved.ok || Math.abs(saved.movedY - saved.reopened.y) > 0.01) throw new Error("Moved collision did not survive save/reopen: " + JSON.stringify(saved));
console.log("save + reopen:", JSON.stringify(saved));

console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "No console errors");
await browser.close();
worker.terminate();
await import("node:fs").then((fs) => fs.rmSync(testDir, { recursive: true, force: true }));
process.exit(0);
