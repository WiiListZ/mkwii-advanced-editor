// Paint a real BRRES texture, verify Save texture, undo, and SZS persistence.
// Usage: bun run tests/ui.texture.smoke.ts <path-to-track.szs>
import puppeteer from "puppeteer-core";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const source = process.argv[2];
if (!source) { console.log("Track path missing: skipped"); process.exit(0); }
const dir = mkdtempSync(join(tmpdir(), "mkwii-texture-test-"));
const track = join(dir, "paint-test.szs");
copyFileSync(source, track);
await Bun.write(join(dir, "settings.json"), JSON.stringify({ tourDone: true }));
const worker = new Worker(new URL("../src/server.ts", import.meta.url).href);
const port: number = await new Promise((resolve) => {
  worker.onmessage = (e) => e.data?.type === "ready" && resolve(e.data.port);
  worker.postMessage({ type: "start", token: "texture-smoke", settingsDir: dir });
});
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1600,950"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 950 });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(`http://127.0.0.1:${port}/?t=texture-smoke`, { waitUntil: "networkidle0" });
  await page.evaluate(async (path) => { await (window as any).app.openPath(path); }, track);
  await page.waitForFunction(() => (window as any).app.viewport?.hasCourseModel, { timeout: 30000 });
  const name = await page.evaluate((preferred) => {
    const a = (window as any).app, seen = new Set<number>();
    let chosen = "", chosenPart = -1;
    a.viewport.courseGroup.traverse((o: any) => {
      const part = o.userData.partIndex;
      if (part === undefined || seen.has(part) || (chosen && !preferred)) return;
      seen.add(part);
      a.viewport.selectModelPiece(part, 0);
      const displayed = [...(o.material?.userData?.tevTextures || []), o.material?.map].filter(Boolean).map((t: any) => t.userData.brresTextureName);
      const tex = a.selectedModelTextures()[0];
      if (!displayed.includes(tex?.name) || ![0, 1, 2, 3, 4, 5, 6, 14].includes(tex.format)) return;
      if (tex && (!chosen || tex.name === preferred)) { chosen = tex.name; chosenPart = part; }
    });
    if (chosenPart >= 0) a.viewport.selectModelPiece(chosenPart, 0);
    return chosen;
  }, process.env.MKWII_TEXTURE_PREFERRED || "");
  if (!name) throw new Error("No editable model texture found");
  console.log("Selected texture:", name);
  // The painter opens in a dialog from the Inspector.
  await page.evaluate(() => ([...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Edit texture")) as HTMLElement)?.click());
  await page.waitForSelector("[data-texture-painter] canvas", { timeout: 10000 });
  const canvas = await page.$("[data-texture-painter] canvas");
  await canvas!.evaluate((el) => el.scrollIntoView({ block: "center" }));
  if (process.env.MKWII_TEXTURE_SCREENSHOT) {
    await new Promise((r) => setTimeout(r, 3500));
    await page.screenshot({ path: process.env.MKWII_TEXTURE_SCREENSHOT });
  }
  await page.click('button[aria-label="Zoom in"]');
  await page.click('button[aria-label="Zoom in"]');
  const zoomed = await page.$eval("[data-texture-painter] canvas", (el: HTMLCanvasElement) => ({ actual: el.getBoundingClientRect().width, expected: el.width * 2 }));
  if (Math.abs(zoomed.actual - zoomed.expected) > 1) throw new Error("Texture zoom failed: " + JSON.stringify(zoomed));
  await page.click('button[aria-label="Zoom out"]');
  await page.click('button[aria-label="Zoom out"]');
  await page.$eval('input[aria-label="Brush color"]', (el: any) => { el.value = "#ff00ff"; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); });
  const box = await canvas!.boundingBox();
  if (!box) throw new Error("Texture canvas is not visible");
  let x = box.x + box.width / 2, y = box.y + box.height / 2;
  const before = await page.evaluate((textureName) => {
    const a = (window as any).app;
    const el = document.querySelector("[data-texture-painter] canvas") as HTMLCanvasElement;
    const i = ((el.height >> 1) * el.width + (el.width >> 1)) * 4;
    let map: any = null;
    a.viewport.courseGroup.traverse((o: any) => { if (!map && o.isMesh) map = [...(o.material?.userData?.tevTextures || []), o.material?.map].find((t: any) => t?.userData.brresTextureName === textureName) || null; });
    (window as any).__textureBeforeBytes = a.doc.snapshot().modelBytes;
    return { pixel: [...el.getContext("2d")!.getImageData(el.width >> 1, el.height >> 1, 1, 1).data], map: [...map.image.data.slice(i, i + 4)] };
  }, name);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await new Promise((r) => setTimeout(r, 350));
  const live = await page.evaluate((textureName) => {
    const a = (window as any).app;
    const el = document.querySelector("[data-texture-painter] canvas") as HTMLCanvasElement;
    const i = ((el.height >> 1) * el.width + (el.width >> 1)) * 4;
    let map: any = null;
    a.viewport.courseGroup.traverse((o: any) => { if (!map && o.isMesh) map = [...(o.material?.userData?.tevTextures || []), o.material?.map].find((t: any) => t?.userData.brresTextureName === textureName) || null; });
    return { pixel: [...el.getContext("2d")!.getImageData(el.width >> 1, el.height >> 1, 1, 1).data], map: [...map.image.data.slice(i, i + 4)], bytesSame: a.doc.snapshot().modelBytes === (window as any).__textureBeforeBytes };
  }, name);
  if (live.pixel.join() === before.pixel.join() || live.map.join() === before.map.join() || !live.bytesSame)
    throw new Error("Live texture preview failed: " + JSON.stringify({ before, live }));
  console.log("Live preview verified");
  await page.mouse.up();
  await page.waitForFunction(() => !!document.querySelector('[data-texture-painter] button[title^="Apply the painted texture"]:not(:disabled)'));
  const stagedBytesSame = await page.evaluate(() => (window as any).app.doc.snapshot().modelBytes === (window as any).__textureBeforeBytes);
  if (!stagedBytesSame) throw new Error("A stroke changed the model before Save texture");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent?.trim() === "Done")?.click());
  await page.waitForFunction(() => document.body.innerText.includes("The painted strokes have not been saved"));
  console.log("Unsaved warning shown");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find((b) => b.textContent?.trim() === "Cancel")?.click());
  await page.waitForFunction(() => !document.querySelector('[role="alertdialog"]') && !!document.querySelector("[data-texture-painter] canvas"));
  const resumedBox = await canvas!.boundingBox();
  if (!resumedBox) throw new Error("Texture canvas disappeared after cancelling close");
  x = resumedBox.x + resumedBox.width / 2; y = resumedBox.y + resumedBox.height / 2;
  await page.evaluate(() => ([...document.querySelectorAll("[data-texture-painter] button")].find((b) => b.textContent?.trim() === "Undo") as HTMLButtonElement).click());
  const undonePixel = await page.evaluate(() => {
    const el = document.querySelector("[data-texture-painter] canvas") as HTMLCanvasElement;
    return [...el.getContext("2d")!.getImageData(el.width >> 1, el.height >> 1, 1, 1).data];
  });
  await page.evaluate(() => ([...document.querySelectorAll("[data-texture-painter] button")].find((b) => b.textContent?.trim() === "Redo") as HTMLButtonElement).click());
  const redonePixel = await page.evaluate(() => {
    const el = document.querySelector("[data-texture-painter] canvas") as HTMLCanvasElement;
    return [...el.getContext("2d")!.getImageData(el.width >> 1, el.height >> 1, 1, 1).data];
  });
  if (undonePixel.join() !== before.pixel.join() || redonePixel.join() === before.pixel.join()) throw new Error("Texture Undo/Redo buttons failed");
  const restoreEnabled = await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Eraser");
    if (!button || button.disabled) return false;
    button.click();
    return true;
  });
  if (!restoreEnabled) throw new Error("Eraser brush is unavailable");
  const eraserBox = await canvas!.boundingBox();
  if (!eraserBox) throw new Error("Texture canvas disappeared before erasing");
  x = eraserBox.x + eraserBox.width / 2; y = eraserBox.y + eraserBox.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await new Promise((r) => setTimeout(r, 120));
  const restoredPixel = await page.evaluate(() => {
    const el = document.querySelector("[data-texture-painter] canvas") as HTMLCanvasElement;
    return [...el.getContext("2d")!.getImageData(el.width >> 1, el.height >> 1, 1, 1).data];
  });
  await page.mouse.up();
  if (restoredPixel.join() !== before.pixel.join()) throw new Error("Restore original did not bring back the source pixel: " + JSON.stringify({ before: before.pixel, restoredPixel }));
  console.log("Restore original verified");
  await page.evaluate(() => ([...document.querySelectorAll("[data-texture-painter] button")].find((b) => b.textContent?.trim() === "Undo") as HTMLButtonElement).click());
  const beforePick = await page.evaluate(() => {
    const el = document.querySelector("[data-texture-painter] canvas") as HTMLCanvasElement;
    const pixel = el.getContext("2d")!.getImageData(el.width >> 1, el.height >> 1, 1, 1).data;
    (window as any).__beforePickBytes = (window as any).app.doc.snapshot().modelBytes;
    return `#${[...pixel.slice(0, 3)].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  });
  await page.evaluate(() => ([...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Pick color")) as HTMLButtonElement).click());
  await page.mouse.click(x, y);
  const picked = await page.evaluate(() => ({ color: (document.querySelector('input[aria-label="Brush color"]') as HTMLInputElement).value, bytesSame: (window as any).app.doc.snapshot().modelBytes === (window as any).__beforePickBytes }));
  if (picked.color !== beforePick || !picked.bytesSame) throw new Error("Texture color picker failed: " + JSON.stringify({ beforePick, picked }));
  console.log("Zoom and color picker verified");
  await page.evaluate(() => ([...document.querySelectorAll("[data-texture-painter] button")].find((b) => b.textContent?.trim() === "Save texture") as HTMLButtonElement).click());
  await page.waitForFunction(() => (window as any).app.doc.snapshot().modelBytes !== (window as any).__textureBeforeBytes);
  const history = await page.evaluate(() => {
    const a = (window as any).app;
    const painted = a.doc.snapshot().modelBytes;
    a.doc.undo();
    const undone = a.doc.snapshot().modelBytes === (window as any).__textureBeforeBytes;
    a.doc.redo();
    return { undone, redone: a.doc.snapshot().modelBytes === painted, dirty: a.doc.dirty };
  });
  if (!history.undone || !history.redone || !history.dirty) throw new Error("Saved texture history failed: " + JSON.stringify(history));
  const saved = await page.evaluate(async () => (window as any).app.save());
  console.log("Save finished:", saved);
  if (!saved) throw new Error("Saving painted SZS failed");
  const reopened = await page.evaluate(async (path) => {
    const a = (window as any).app;
    const before = a.doc.snapshot().modelBytes;
    await a.openPath(path);
    const after = a.doc.snapshot().modelBytes;
    return { same: before.length === after.length && before.every((v: number, i: number) => v === after[i]), model: a.doc.fileName };
  }, track);
  if (!reopened.same) throw new Error("Painted texture did not survive SZS reopen");
  const modelTransform = await page.evaluate(() => {
    const a = (window as any).app, vp = a.viewport;
    vp.selectModelPiece(14, 0);
    if (vp.geometrySelection?.type !== "model") return { selected: false };
    const before = a.doc.snapshot().modelBytes;
    vp.setMode("rotate");
    const rotateMode = vp.gizmo.mode === "rotate";
    vp.onGizmoDragging(true);
    vp.pivot.rotation.y += Math.PI / 4;
    vp.onGizmoChange();
    vp.onGizmoDragging(false);
    const rotated = a.doc.snapshot().modelBytes !== before;
    const immediate = vp.pivot.position.clone();
    const centre = vp.geometryBox(vp.geometrySelection).getCenter(vp.pivot.position.clone());
    return { selected: true, rotateMode, rotated, pivotError: immediate.distanceTo(centre) };
  });
  if (!modelTransform.selected || !modelTransform.rotateMode || !modelTransform.rotated || modelTransform.pivotError > 1)
    throw new Error("Model rotation or gizmo position failed: " + JSON.stringify(modelTransform));
  await new Promise((r) => setTimeout(r, 400));
  const modelScale = await page.evaluate(() => {
    const a = (window as any).app, vp = a.viewport;
    const before = a.doc.snapshot().modelBytes;
    vp.setMode("scale");
    const scaleMode = vp.gizmo.mode === "scale";
    vp.onGizmoDragging(true);
    vp.pivot.scale.set(1.2, 1.2, 1.2);
    vp.onGizmoChange();
    vp.onGizmoDragging(false);
    return { scaleMode, scaled: a.doc.snapshot().modelBytes !== before };
  });
  if (!modelScale.scaleMode || !modelScale.scaled) throw new Error("Model scaling failed: " + JSON.stringify(modelScale));
  await page.evaluate(async () => (window as any).app.save());
  const modelReopened = await page.evaluate(async (path) => {
    const a = (window as any).app, before = a.doc.snapshot().modelBytes;
    await a.openPath(path);
    const after = a.doc.snapshot().modelBytes;
    return before.length === after.length && before.every((v: number, i: number) => v === after[i]);
  }, track);
  if (!modelReopened) throw new Error("Rotated/scaled model did not survive SZS reopen");
  console.log("Model rotate, scale, pivot and reopen verified", modelTransform, modelScale);
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("Texture painted and previewed live:", name, JSON.stringify({ before, live, history, reopened }));
} finally {
  await browser.close();
  worker.terminate();
  rmSync(dir, { recursive: true, force: true });
}
