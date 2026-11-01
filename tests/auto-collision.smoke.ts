// Generate course KCL from a real track model part and a placed object, then save and reopen.
// Usage: MKWII_GAME_DIR=<extracted game>/files bun run tests/auto-collision.smoke.ts
import puppeteer from "puppeteer-core";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findFile, parseU8 } from "../web/js/formats/u8.js";
import { yaz0Decompress } from "../web/js/formats/yaz0.js";
import { parseKCL } from "../web/js/formats/kcl.js";

const game = process.env.MKWII_GAME_DIR;
if (!game) throw new Error("Set MKWII_GAME_DIR to the extracted game's files folder");
const temp = mkdtempSync(join(tmpdir(), "mkwii-auto-collision-"));
const settings = mkdtempSync(join(tmpdir(), "mkwii-auto-collision-settings-"));
const trackDir = join(temp, "Race", "Course");
mkdirSync(trackDir, { recursive: true });
const track = join(trackDir, "beginner_course.szs");
copyFileSync(join(game, "Race", "Course", "beginner_course.szs"), track);
await Bun.write(join(settings, "settings.json"), JSON.stringify({ tourDone: true }));
const worker = new Worker(new URL("../src/server.ts", import.meta.url).href);
const port: number = await new Promise((resolve) => { worker.onmessage = (event) => event.data?.type === "ready" && resolve(event.data.port); worker.postMessage({ type: "start", token: "collision", settingsDir: settings }); });
const browser = await puppeteer.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"], protocolTimeout: 240000 });
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewport({ width: 1600, height: 950 });
  await page.goto(`http://127.0.0.1:${port}/?t=collision`, { waitUntil: "networkidle0" });
  const initial = await page.evaluate(async (common, path) => {
    const app = (window as any).app;
    await app.loadCommonFrom(common, true);
    await app.openPath(path);
    await app.loadTrackAssets();
    app.startGeometryEditing("model");
    const candidates: any[] = [];
    app.viewport.courseGroup.traverse((mesh: any) => { if (mesh.isMesh && mesh.userData.partIndex !== undefined && mesh.userData.modelPart?.triangles) candidates.push(mesh); });
    const mesh = candidates.sort((a, b) => a.userData.modelPart.triangles - b.userData.modelPart.triangles)[0];
    if (!mesh) throw new Error("No course model part to select");
    app.viewport.selectModelPiece(mesh.userData.partIndex, 0);
    return { count: app.doc.kcl?.count || 0, partTriangles: app.geometrySelection.vertexIndices.length / 3, partIndex: mesh.userData.partIndex };
  }, join(game, "Race", "Common.szs"), track);
  const generateCollision = async (shape: "mesh" | "box", mobileForm = false) => {
    if (mobileForm) await page.setViewport({ width: 390, height: 844 });
    await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Generate collision…")?.click());
    await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"]')].some((dialog) => dialog.textContent?.includes("Generate collision ·")));
    if (mobileForm) {
      if (process.env.MKWII_COLLISION_FORM_MOBILE_SCREENSHOT) await page.screenshot({ path: process.env.MKWII_COLLISION_FORM_MOBILE_SCREENSHOT });
      const overflow = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[role="dialog"] button, [role="dialog"] input:not([aria-hidden="true"])')]
        .map((element) => ({ text: element.textContent?.trim() || element.getAttribute("role") || element.tagName, box: element.getBoundingClientRect() }))
        .filter(({ box }) => box.left < -1 || box.right > 391).map(({ text, box }) => `${text} (${Math.round(box.left)}–${Math.round(box.right)})`));
      if (overflow.length) throw new Error(`Collision dialog controls overflow the mobile viewport: ${overflow.join(", ")}`);
    }
    // Copy everything, even where the course already has collision, so the counts are exact.
    await page.evaluate(() => document.querySelector<HTMLButtonElement>('[role="dialog"] button[role="switch"][aria-checked="true"]')?.click());
    if (shape === "box") {
      await page.evaluate(() => document.querySelector<HTMLButtonElement>('[role="dialog"] button[role="combobox"]')?.click());
      await page.waitForSelector('[role="option"]');
      await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) => option.textContent?.includes("Bounding box"))?.click());
    }
    await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => button.textContent?.trim() === "Generate")?.click());
    if (mobileForm) await page.setViewport({ width: 1600, height: 950 });
  };
  await generateCollision("mesh", true);
  await page.waitForFunction((count, added) => (window as any).app.doc.kcl?.count === count + added, { timeout: 120000 }, initial.count, initial.partTriangles);
  const undo = await page.evaluate(() => { const app = (window as any).app; app.doc.undo(); const count = app.doc.kcl?.count; app.doc.redo(); return { count, redone: app.doc.kcl?.count }; });
  if (undo.count !== initial.count || undo.redone !== initial.count + initial.partTriangles) throw new Error("Generated model-part collision did not undo/redo");
  const removeCollision = async (confirm: boolean) => {
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLButtonElement>("button")].some((button) => button.textContent?.trim() === "Remove all collision…"));
    await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Remove all collision…")!.click());
    await page.waitForSelector('[role="alertdialog"]');
    await page.evaluate((confirm) => [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find((button) => button.textContent?.trim() === (confirm ? "Remove collision" : "Cancel"))!.click(), confirm);
    await page.waitForSelector('[role="alertdialog"]', { hidden: true });
  };
  const modelRemoval = await page.evaluate((partIndex) => {
    const app = (window as any).app;
    app.startGeometryEditing("model"); app.viewport.selectModelPiece(partIndex, 0);
    return { count: app.doc.kcl.count, matched: app.collisionOfSelectedModelParts().length, history: app.doc.undoStack.length };
  }, initial.partIndex);
  if (modelRemoval.matched < initial.partTriangles) throw new Error("Generated model collision was not found for removal");
  await removeCollision(false);
  if (!(await page.evaluate((before) => (window as any).app.doc.kcl.count === before.count && (window as any).app.doc.undoStack.length === before.history, modelRemoval))) throw new Error("Cancelling changed collision or history");
  await removeCollision(true);
  const removedModel = await page.evaluate(() => {
    const app = (window as any).app, count = app.doc.kcl.count, keptModel = app.geometrySelection?.type === "model";
    app.doc.undo(); const restored = app.doc.kcl.count; app.doc.redo(); const redone = app.doc.kcl.count; app.doc.undo();
    return { count, keptModel, restored, redone };
  });
  if (removedModel.count !== modelRemoval.count - modelRemoval.matched || !removedModel.keptModel || removedModel.restored !== modelRemoval.count || removedModel.redone !== removedModel.count) throw new Error(`Model collision removal/undo/redo failed: ${JSON.stringify(removedModel)}`);
  console.log(`Removed ${modelRemoval.matched} selected-model triangles after confirmation; cancellation, model retention and undo/redo passed`);
  const objectFound = await page.evaluate(() => {
    const app = (window as any).app;
    const object = app.doc.kmp.GOBJ.find((item: any) => app.assets.objectModel(item.objectId)?.template);
    if (!object) return false;
    app.viewport.setTool(null);
    app.doc.select([String(object.uid)]);
    return true;
  });
  if (!objectFound) throw new Error("No placed object with a real model in this track");
  await page.waitForFunction(() => document.body.innerText.includes("Generate collision…"));
  await generateCollision("box");
  await page.waitForFunction((count, added) => (window as any).app.doc.kcl?.count === count + added + 12, { timeout: 120000 }, initial.count, initial.partTriangles);
  const pixelCheck = async () => page.evaluate(() => {
    const viewport = (window as any).app.viewport;
    viewport.renderNow();
    const canvas = viewport.renderer.domElement as HTMLCanvasElement;
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl!.readPixels(0, 0, canvas.width, canvas.height, gl!.RGBA, gl!.UNSIGNED_BYTE, pixels);
    let visible = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 80) visible++;
    return visible;
  });
  if (process.env.MKWII_COLLISION_DESKTOP_SCREENSHOT) await page.screenshot({ path: process.env.MKWII_COLLISION_DESKTOP_SCREENSHOT });
  const desktopPixels = await pixelCheck();
  if (desktopPixels <= 500) throw new Error(`The 3D collision view is blank on desktop (${desktopPixels} non-dark pixels)`);
  await page.setViewport({ width: 390, height: 844 });
  if (process.env.MKWII_COLLISION_MOBILE_SCREENSHOT) await page.screenshot({ path: process.env.MKWII_COLLISION_MOBILE_SCREENSHOT });
  const mobilePixels = await pixelCheck();
  if (mobilePixels <= 500) throw new Error(`The 3D collision view is blank on mobile (${mobilePixels} non-dark pixels)`);
  if (!(await page.evaluate(() => (window as any).app.save()))) throw new Error("Could not save generated collision");
  const saved = new Uint8Array(await Bun.file(track).arrayBuffer());
  const tree = parseU8(yaz0Decompress(saved));
  const kcl = parseKCL(findFile(tree, "course.kcl")!.data);
  if (kcl.count !== initial.count + initial.partTriangles + 12) throw new Error(`Saved KCL has ${kcl.count} triangles instead of ${initial.count + initial.partTriangles + 12}`);
  const reopened = await page.evaluate(async (path) => { const app = (window as any).app; await app.openPath(path); return app.doc.kcl?.count; }, track);
  if (reopened !== kcl.count) throw new Error("Generated collision was not retained after reopening the track");
  // Deleting the object removes the collision generated for it (found again from its model after
  // reopening), and Undo brings both back.
  const deletion = await page.evaluate(async (partTriangles) => {
    const app = (window as any).app;
    await app.loadTrackAssets?.();
    const before = app.doc.kcl.count;
    const object = app.doc.kmp.GOBJ.find((item: any) => app.assets.objectModel(item.objectId)?.template);
    app.doc.select([String(object.uid)]);
    const found = app.collisionOfSelectedObjects().length;
    await app.cmd("delete");
    const after = app.doc.kcl.count;
    app.doc.undo();
    return { before, found, after, undone: app.doc.kcl.count, objects: app.doc.kmp.GOBJ.length, partTriangles };
  }, initial.partTriangles);
  if (deletion.found < 12 || deletion.after !== deletion.before - deletion.found || deletion.undone !== deletion.before) throw new Error(`Deleting the object did not remove its collision: ${JSON.stringify(deletion)}`);
  console.log(`Deleting the object removed ${deletion.found} collision triangles (its generated box), undo restored them`);
  // Objects without generated collision take none of the track's collision with them.
  const others = await page.evaluate(() => {
    const app = (window as any).app;
    const out: Record<string, number> = {};
    app.doc.kmp.GOBJ.forEach((item: any, i: number) => {
      if (!app.assets.objectModel(item.objectId)?.template) return;
      app.doc.select([String(item.uid)]);
      const found = app.collisionOfSelectedObjects().length;
      if (found) out[`${app.objectNames[item.objectId] || item.objectId}#${i}`] = found;
    });
    return { out, objects: app.doc.kmp.GOBJ.length };
  });
  console.log(`Other objects of the track with collision found: ${JSON.stringify(others.out)} (of ${others.objects} objects)`);
  const objectRemoval = await page.evaluate(() => {
    const app = (window as any).app;
    const object = app.doc.kmp.GOBJ.find((item: any) => app.assets.objectModel(item.objectId)?.template);
    app.viewport.setTool(null); app.doc.select([String(object.uid)]);
    return { count: app.doc.kcl.count, objects: app.doc.kmp.GOBJ.length, matched: app.collisionOfSelectedObjects().length };
  });
  if (objectRemoval.matched < 12) throw new Error("Generated object collision not found");
  await removeCollision(true);
  if (!(await page.evaluate((before) => (window as any).app.doc.kcl.count === before.count - before.matched && (window as any).app.doc.kmp.GOBJ.length === before.objects, objectRemoval))) throw new Error("Removing object collision deleted its model or the wrong triangles");
  if (!(await page.evaluate(() => (window as any).app.save()))) throw new Error("Could not save removed collision");
  const afterRemoval = await page.evaluate(async (path) => { const app = (window as any).app; await app.openPath(path); return app.doc.kcl.count; }, track);
  if (afterRemoval !== objectRemoval.count - objectRemoval.matched) throw new Error("Removed collision returned after save/reopen");
  console.log("Object collision removal kept the object and survived save/reopen");
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("Model-part and object collision generation, undo/redo, save/reopen passed");
} finally {
  await browser.close(); worker.terminate();
  rmSync(settings, { recursive: true, force: true });
  rmSync(temp, { recursive: true, force: true });
}
