// Home and editor remain separate views of the same open track.
import puppeteer from "puppeteer-core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildKMP, emptyKMP } from "../web/js/formats/kmp.js";

const settings = mkdtempSync(join(tmpdir(), "mkwii-home-"));
await Bun.write(join(settings, "settings.json"), JSON.stringify({ tourDone: true }));
const worker = new Worker(new URL("../src/server.ts", import.meta.url).href);
const port: number = await new Promise((resolve) => {
  worker.onmessage = (event) => event.data?.type === "ready" && resolve(event.data.port);
  worker.postMessage({ type: "start", token: "home-test", settingsDir: settings });
});
const browser = await puppeteer.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/?t=home-test`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => !!(window as any).app?.viewport);
  await page.evaluate(() => {
    (window as any).__windowActions = [];
    (window as any).__winctl = async (action: string) => {
      (window as any).__windowActions.push(action);
      return { maximized: action === "maximize" };
    };
  });
  const bytes = [...buildKMP(emptyKMP())];
  await page.evaluate(async (data) => {
    await (window as any).app.loadFile({ path: null, name: "navigation.kmp", data: new Uint8Array(data) });
  }, bytes);
  await page.waitForSelector('button[aria-label="Home"]');
  console.log("Editor loaded");
  if (!(await page.evaluate(() => (window as any).__windowActions.includes("maximize")))) throw new Error("Editor did not maximize the window");
  const canvas = await page.$("canvas");
  if (!canvas) throw new Error("3D canvas missing");
  const rect = await canvas.boundingBox();
  if (!rect) throw new Error("3D canvas has no bounds");
  const x = Math.round(rect.x + rect.width / 2), y = Math.round(rect.y + rect.height / 2);
  await page.evaluate((startX) => {
    const app = (window as any).app, vp = app.viewport;
    (window as any).__rightClick = [];
    (window as any).__rightClickOriginals = { entity: vp.pickEntityHit, model: vp.pickModelHit, select: vp.doc.select, geometry: vp.selectGeometry };
    vp.pickEntityHit = (point: any) => ({ key: point.clientX === startX ? "clicked" : "neighbor", distance: 20 });
    vp.pickModelHit = () => null;
    vp.doc.select = (key: string) => (window as any).__rightClick.push(key);
    vp.selectGeometry = () => {};
  }, x);
  await page.mouse.move(x, y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(x + 1, y);
  await page.mouse.up({ button: "right" });
  const rightClick = await page.evaluate(() => (window as any).__rightClick);
  if (rightClick.length !== 1 || rightClick[0] !== "clicked") throw new Error(`Right click selected the wrong element: ${JSON.stringify(rightClick)}`);
  await page.evaluate(() => {
    const app = (window as any).app, vp = app.viewport, original = (window as any).__rightClickOriginals;
    vp.pickEntityHit = original.entity; vp.pickModelHit = original.model;
    vp.doc.select = original.select; vp.selectGeometry = original.geometry;
    app.contextMenuAt = null; app.bump("ui");
  });
  console.log("Right click selection passed");
  await page.evaluate(() => { (window as any).app.doc.dirty = true; });
  await page.click('button[aria-label="Home"]');
  await page.waitForFunction(() => document.body.innerText.includes("Continue editing"));
  console.log("Home opened");
  const kept = await page.evaluate(() => {
    const app = (window as any).app;
    return app.homeVisible && app.doc.fileName === "navigation.kmp" && app.doc.dirty;
  });
  if (!kept) throw new Error("Home discarded the open track");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Continue editing"))?.click());
  await page.waitForSelector('button[aria-label="Home"]');
  await page.click('button[aria-label="Home"]');
  await page.click('button[aria-label="Close track"]');
  await page.waitForSelector('[role="alertdialog"]');
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find((button) => button.textContent?.trim() === "Cancel")?.click());
  await page.waitForSelector('[role="alertdialog"]', { hidden: true });
  if (!(await page.evaluate(() => (window as any).app.doc.dirty))) throw new Error("Cancel closed the track");
  await page.click('button[aria-label="Close track"]');
  await page.waitForSelector('[role="alertdialog"]');
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find((button) => button.textContent?.includes("Discard changes"))?.click());
  await page.waitForFunction(() => (window as any).app.isEmpty && (window as any).app.homeVisible);
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("Home navigation, dirty-state preservation and Close track passed");
} finally {
  await browser.close();
  worker.terminate();
  rmSync(settings, { recursive: true, force: true });
}
