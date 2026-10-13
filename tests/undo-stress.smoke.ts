// Regression smoke test for repeated undo and model refreshes.
// Usage: bun run tests/undo-stress.smoke.ts <path-to-track.szs>
import puppeteer from "puppeteer-core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const track = process.argv[2];
if (!track) throw new Error("Pass a track SZS path");
const settingsDir = mkdtempSync(join(tmpdir(), "mkwii-undo-stress-"));
await Bun.write(join(settingsDir, "settings.json"), JSON.stringify({ tourDone: true }));
const worker = new Worker(new URL("../src/server.ts", import.meta.url).href);
const port: number = await new Promise((resolve) => {
  worker.onmessage = (e) => e.data?.type === "ready" && resolve(e.data.port);
  worker.postMessage({ type: "start", token: "undo-stress", settingsDir });
});
const browser = await puppeteer.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 950 });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (e) => { if (e.type() === "error") errors.push(e.text()); });
try {
  await page.goto(`http://127.0.0.1:${port}/?t=undo-stress`, { waitUntil: "networkidle0" });
  await page.evaluate(async (path) => (window as any).app.openPath(path), track);
  await page.waitForFunction(() => (window as any).app.viewport?.hasCourseModel);
  await page.evaluate(() => {
    const app = (window as any).app;
    for (let i = 0; i < 50; i++) app.doc.change(`Move object ${i}`, () => { app.doc.kmp.GOBJ[0].pos[0] += 1; });
  });
  await page.keyboard.down("Control");
  for (let i = 0; i < 60; i++) await page.keyboard.press("z");
  await page.keyboard.up("Control");
  await page.evaluate(() => {
    const app = (window as any).app;
    const find = (node: any): any => node.name === "course_model.brres" ? node : node.children?.map(find).find(Boolean);
    const node = find(app.doc.szs);
    if (!node) throw new Error("No course_model.brres");
    for (let i = 0; i < 25; i++) app.doc.changeArchiveFile(`Refresh model ${i}`, "course_model.brres", node.data.slice());
  });
  await page.keyboard.down("Control");
  for (let i = 0; i < 30; i++) await page.keyboard.press("z");
  await page.keyboard.up("Control");
  await new Promise((r) => setTimeout(r, 1500));
  const state = await page.evaluate(() => {
    const app = (window as any).app;
    const canvas = app.viewport.renderer.domElement;
    return { rootChildren: document.getElementById("root")?.childElementCount, canvas: canvas.isConnected,
      canvasSize: [canvas.width, canvas.height], undo: app.doc.undoStack.length, redo: app.doc.redoStack.length,
      track: !!app.viewport.courseGroup.children.length, contextLost: app.viewport.renderer.getContext().isContextLost() };
  });
  console.log(JSON.stringify({ state, errors }));
  if (!state.rootChildren || !state.canvas || state.contextLost || errors.length) throw new Error("Editor failed after repeated undo");
  const group = await page.evaluate(async () => {
    const app = (window as any).app, vp = app.viewport;
    if (app.settings.smartAlignment || vp.smartAlignment) throw new Error("Alignment must be off by default");
    app.setSetting("smartAlignment", true);
    if (!vp.smartAlignment) throw new Error("Alignment setting did not reach the viewport");
    app.setSetting("smartAlignment", false);
    const parts: any[] = [];
    vp.courseGroup.traverse((mesh: any) => {
      if (mesh.isMesh && mesh.userData.modelPart?.triangles && !parts.some((x) => x.index === mesh.userData.partIndex)) parts.push({ index: mesh.userData.partIndex, part: mesh.userData.modelPart });
    });
    const independent = parts.filter((x) => !parts.some((y) => x !== y && x.part.positionArrayId === y.part.positionArrayId && x.part.positionIndices.some((id: number) => y.part.positionIndices.includes(id))));
    if (independent.length < 2) throw new Error(`Track needs two independent model parts for group test; found ${independent.length}`);
    vp.selectModelPiece(independent[0].index, 0);
    vp.selectModelPiece(independent[1].index, 0, false, "add");
    vp.selectEntity(String(app.doc.kmp.GOBJ[0].uid), "add");
    if (vp.geometrySelection.pieces.length !== 2 || app.doc.selection.size !== 1) throw new Error("Mixed selection failed");
    const before = app.doc.snapshot().modelBytes;
    const position = [...app.doc.kmp.GOBJ[0].pos];
    vp.setMode("translate");
    vp.onGizmoDragging(true);
    vp.pivot.position.x += 30;
    vp.onGizmoChange();
    vp.onGizmoDragging(false);
    if (app.doc.kmp.GOBJ[0].pos[0] !== position[0] + 30) throw new Error("Object did not move with model selection");
    const modelChanged = app.doc.snapshot().modelBytes !== before;
    const history = app.doc.undoStack.length;
    app.doc.undo();
    await new Promise((resolve) => setTimeout(resolve, 200));
    return { modelChanged, history, objectRestored: app.doc.kmp.GOBJ[0].pos[0] === position[0],
      modelRestored: app.doc.snapshot().modelBytes === before, contextLost: vp.renderer.getContext().isContextLost() };
  });
  console.log(JSON.stringify({ group, errors }));
  if (!group.modelChanged || !group.objectRestored || !group.modelRestored || group.contextLost || errors.length) throw new Error("Group transform or undo failed");
} finally {
  await browser.close();
  worker.terminate();
  rmSync(settingsDir, { recursive: true, force: true });
}
