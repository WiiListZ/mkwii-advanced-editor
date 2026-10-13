// Adds parts of other game models to a real track through the UI in headless Edge (needs ABMatt).
// Usage: MKWII_GAME_DIR=<path to .../files> bun run tests/model-parts.smoke.ts <screenshot-dir>
import puppeteer from "puppeteer-core";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const game = process.env.MKWII_GAME_DIR;
if (!game || !existsSync(join(game, "Race/Common.szs"))) {
  console.log("MKWII_GAME_DIR not set (or no Race/Common.szs): skipped");
  process.exit(0);
}
// Screenshots go to the folder given on the command line, or to a temporary folder (never the project).
const outDir = process.argv[2] || mkdtempSync(join(tmpdir(), "mkwii-shots-"));
const testDir = mkdtempSync(join(tmpdir(), "mkwii-test-"));
await Bun.write(join(testDir, "settings.json"), JSON.stringify({ tourDone: true, partsFolder: join(game, "Race", "Course") }));
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
const failures: string[] = [];
const check = (ok: unknown, message: string) => { if (!ok) failures.push(message); console.log(`${ok ? "ok  " : "FAIL"} ${message}`); };
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 950 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const clickText = async (text: string, selector = "[role=dialog] div") => {
    const found = await page.evaluate((t, sel) => {
      const el = [...document.querySelectorAll<HTMLElement>(sel)].reverse().find((e) => e.children.length <= 6 && (e.textContent?.trim() === t || e.querySelector("span")?.textContent?.trim() === t || e.textContent?.trim().startsWith(t + "\n")))
        || [...document.querySelectorAll<HTMLElement>(sel)].reverse().find((e) => e.children.length <= 6 && e.textContent?.trim().startsWith(t));
      el?.click();
      return !!el;
    }, text, selector);
    if (!found) throw new Error(`Not found: ${text}`);
    await wait(400);
  };
  // Placement is "click on the track" by default: click the middle of the 3D view after adding.
  const placeByClick = async () => {
    await page.waitForFunction(() => (window as any).app.viewport?.tool?.kind === "PICK", { timeout: 10000 });
    const r = await page.evaluate(() => { const c = (window as any).app.viewport.canvas.getBoundingClientRect(); return { x: c.left + c.width / 2, y: c.top + c.height * 0.6 }; });
    await page.mouse.click(r.x, r.y);
  };
  const kclCount = () => page.evaluate(() => (window as any).app.doc.kcl?.count || 0);
  const objectCount = () => page.evaluate(() => {
    const a = (window as any).app;
    const brres = a.assets.brres(a.doc.szs, "course_model.brres");
    return brres.models.find((m: any) => m.name === "course").objects.length;
  });
  await page.goto(`http://127.0.0.1:${port}/?t=smoke`, { waitUntil: "networkidle0" });
  await wait(500);
  await page.evaluate(async (common, track) => {
    const a = (window as any).app;
    await a.loadCommonFrom(common, true);
    await a.openPath(track);
    await a.loadTrackAssets();
  }, join(game, "Race/Common.szs"), join(game, "Race/Course/beginner_course.szs"));
  await wait(800);
  const before = await objectCount();

  // Whole polygon from another track, at the view centre.
  await page.evaluate(() => (window as any).app.cmd("modelParts"));
  await wait(800);
  await clickText("Mario Circuit");
  await wait(1500);
  await clickText("denchu1 · polygon27");
  await wait(800);
  await page.screenshot({ path: join(outDir, "parts-1-preview.png") });
  await clickText("Object 3");
  await wait(600);
  await page.screenshot({ path: join(outDir, "parts-2-piece.png") });
  const kclBefore = await kclCount();
  await clickText("Add to track", "[role=dialog] button");
  await placeByClick();
  await page.waitForFunction(() => !document.querySelector("[role=dialog]") && !(window as any).app.busy && (window as any).app.viewport.tool === null, { timeout: 120000 });
  await page.waitForFunction((n) => (window as any).app.assets.brres((window as any).app.doc.szs, "course_model.brres").models.find((m: any) => m.name === "course").objects.length > n, { timeout: 120000 }, before);
  await wait(800);
  check(await objectCount() === before + 1, "piece of Mario Circuit added as a new model part (placed by clicking)");
  console.log("collision triangles", kclBefore, "→", await kclCount());
  check(await page.evaluate(() => (window as any).app.geometrySelection?.type === "model"), "added part is selected");
  await page.screenshot({ path: join(outDir, "parts-3-added.png") });

  // Object model from Common.szs, with a texture-swap animation.
  await page.evaluate(() => (window as any).app.cmd("modelParts"));
  await wait(800);
  await clickText("Race/Common.szs");
  await wait(800);
  await clickText("bomb.brres");
  await wait(600);
  await clickText("b_body · polygon1");
  await wait(800);
  await page.screenshot({ path: join(outDir, "parts-4-common.png") });
  await clickText("Add to track", "[role=dialog] button");
  await placeByClick();
  await page.waitForFunction((n) => (window as any).app.assets.brres((window as any).app.doc.szs, "course_model.brres").models.find((m: any) => m.name === "course").objects.length > n + 1, { timeout: 120000 }, before);
  await wait(500);
  check(await objectCount() === before + 2, "Common.szs part added");
  await page.evaluate(() => (window as any).app.cmd("undo"));
  await wait(800);
  check(await objectCount() === before + 1, "undo removes the added part");
  // The toolbar's Add menu opens the same browser.
  await page.evaluate(() => {
    const add = [...document.querySelectorAll<HTMLButtonElement>("[data-group=create] button")].find((b) => b.textContent?.includes("Add"));
    add?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
  });
  await wait(400);
  await clickText("Model part from the game…", "[role=menuitem]");
  await wait(600);
  check(await page.evaluate(() => !!document.querySelector("[role=dialog]")?.textContent?.includes("Add a part from the game's models")), "Add menu opens the model part browser");
  await page.keyboard.press("Escape");
  await wait(400);

  // An object of another track (Mario Circuit's tree) gets its model from the tracks folder
  // and its files are copied into the SZS when saving.
  await page.waitForFunction(() => (window as any).app.library && !(window as any).app.library.loading, { timeout: 60000 });
  const library = await page.evaluate(() => (window as any).app.library);
  check(library.models > 50 && !library.error, `tracks folder indexed (${library.models} models in ${library.tracks} tracks)`);
  const treeId = await page.evaluate(() => {
    const a = (window as any).app;
    const id = Number(Object.entries(a.objectNames).find(([, n]) => n === "castletree1")?.[0]);
    a.ops.add("GOBJ", a.viewport.viewCenterPoint(), { objectId: id });
    return id;
  });
  await page.waitForFunction((id) => !!(window as any).app.assets.objects.get(id), { timeout: 30000 }, treeId);
  check(true, "castletree1 model loaded from Mario Circuit");
  const saved = join(testDir, "luigi-with-tree.szs");
  await page.evaluate(async (path) => {
    const a = (window as any).app;
    a.doc.filePath = path;
    a.doc.fileKind = "szs";
    await a.save(false);
  }, saved);
  await wait(500);
  await page.evaluate(async (path) => { (window as any).app.doc.dirty = false; await (window as any).app.openPath(path); }, saved);
  await wait(500);
  const hasTree = await page.evaluate(() => {
    const a = (window as any).app;
    const files: string[] = [];
    const walk = (n: any, p = "") => { for (const c of n.children || []) { const q = c.name === "." ? p : p ? `${p}/${c.name}` : c.name; c.children ? walk(c, q) : files.push(q); } };
    walk(a.doc.szs);
    return files.includes("castletree1.brres");
  });

  check(hasTree, "saved SZS contains castletree1.brres copied from the tracks folder");
  await page.evaluate(() => (window as any).app.setTab("objects"));
  await wait(800);
  await page.screenshot({ path: join(outDir, "parts-5-objects.png") });

  check(!errors.length, `no page errors${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);
} finally {
  await browser.close();
  worker.terminate();
  rmSync(testDir, { recursive: true, force: true });
}
if (failures.length) process.exit(1);
