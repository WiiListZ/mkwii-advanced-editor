// Capture genuine UI screenshots and animation frames for the README.
// Usage: MKWII_GAME_DIR=<extracted game files> bun run scripts/capture-readme.ts <output-dir>
import puppeteer from "puppeteer-core";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const game = process.env.MKWII_GAME_DIR;
if (!game || !existsSync(join(game, "Race/Common.szs"))) throw new Error("Set MKWII_GAME_DIR to an extracted game's files directory");
const output = process.argv[2] || join("docs", "images");
mkdirSync(output, { recursive: true });
const frames = join(output, "frames");
mkdirSync(frames, { recursive: true });
const settings = mkdtempSync(join(tmpdir(), "mkwii-readme-"));
await Bun.write(join(settings, "settings.json"), JSON.stringify({ tourDone: true, workspace: game, animations: true }));
const worker = new Worker(new URL("../src/server.ts", import.meta.url).href);
const port: number = await new Promise((resolve) => {
  worker.onmessage = (event) => event.data?.type === "ready" && resolve(event.data.port);
  worker.postMessage({ type: "start", token: "readme", settingsDir: settings });
});
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1600,950"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 950, deviceScaleFactor: 1 });
// The Windows file dialog cannot be driven: "Overlay PNG…" gets the editor icon instead.
await page.setRequestInterception(true);
page.on("request", (request) => {
  if (request.url().includes("/api/open-dialog")) {
    request.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ path: join(process.cwd(), "web", "icon.png") }) });
  } else request.continue();
});
const screens = join(output, "text-screens");
mkdirSync(screens, { recursive: true });
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const shot = async (name: string) => { await pause(450); await page.screenshot({ path: join(output, name) }); console.log(name); };
const frame = async (name: string) => {
  await pause(90);
  const element = await page.$("[data-panel-id=viewport]");
  if (!element) throw new Error("Viewport missing");
  await element.screenshot({ path: join(frames, name) });
};
try {
  await page.goto(`http://127.0.0.1:${port}/?t=readme`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => !!(window as any).app?.viewport);
  await page.waitForFunction(() => document.body.innerText.includes("music streams"), { timeout: 30000 });
  await shot("welcome.png");
  await page.evaluate(async (common, track) => {
    const app = (window as any).app;
    await app.loadCommonFrom(common, true);
    await app.openPath(track);
    await app.loadTrackAssets();
    app.setSetting("displayMode", "visual");
    app.setTab("outline");
    for (const layer of ["ITPT", "CAME", "JGPT", "CNPT", "MSPT"]) app.viewport.layers[layer] = false;
    app.viewport.scheduleRebuild();
    const area = app.doc.kmp.AREA[0];
    if (area) app.doc.select([String(area.uid)]);
    app.viewport.frameAll(true);
  }, join(game, "Race/Common.szs"), join(game, "Race/Course/castle_course.szs"));
  await page.evaluate(async () => {
    for (const name of ["Track model", "Enemy Routes (CPU)", "Item Routes", "Checkpoints", "Objects"]) {
      [...document.querySelectorAll<HTMLElement>("[data-outliner] span")].find((element) => element.textContent?.trim() === name)?.click();
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    document.querySelector<HTMLElement>("[data-outliner]")!.scrollTop = 0;
  });
  await pause(3500);
  await shot("editor-elements.png");
  await page.evaluate(() => {
    const app = (window as any).app;
    app.doc.clearSelection();
    for (const layer of ["KTPT", "ENPT", "ITPT", "CKPT", "POTI", "AREA", "CAME", "JGPT", "CNPT", "MSPT"]) app.viewport.layers[layer] = false;
    app.viewport.scheduleRebuild();
    app.viewport.applyDisplayMode();
    app.viewport.frameAll(true);
  });
  await pause(900);
  await shot("editor.png");

  await page.evaluate(() => {
    const app = (window as any).app;
    app.setTab("objects");
    const object = app.doc.kmp.GOBJ.find((o: any) => o.objectId === 0x65) || app.doc.kmp.GOBJ[0];
    if (object) app.doc.select([String(object.uid)]);
  });
  await page.waitForSelector('[draggable="true"]');
  await page.evaluate(() => {
    const item = [...document.querySelectorAll<HTMLElement>('[draggable="true"]')].find((row) => row.textContent?.includes('0x0065'));
    item?.click();
  });
  await shot("objects.png");
  await page.evaluate(() => (window as any).app.viewport.focusSelection());
  await pause(1000);
  for (let i = 0; i < 14; i++) {
    await frame(`object-${String(i).padStart(2, "0")}.png`);
    await pause(90);
  }

  await page.evaluate(() => { const app = (window as any).app; app.doc.clearSelection(); app.setTab("collision"); app.viewport.frameAll(true); });
  await page.click('[role=tablist][aria-label="Collision mode"] [role=tab]:nth-child(2)');
  await shot("collision.png");

  await page.click('[role=tablist][aria-label="Collision mode"] [role=tab]:nth-child(3)');
  await page.evaluate(() => {
    const app = (window as any).app, vp = app.viewport;
    app.setSetting("displayMode", "both");
    const rect = vp.canvas.getBoundingClientRect(), triangles: number[] = [];
    for (const [x, y] of [[0.52, 0.73], [0.54, 0.72], [0.56, 0.71], [0.58, 0.7]]) {
      const tri = vp.pickGround({ clientX: rect.left + rect.width * x, clientY: rect.top + rect.height * y })?.tri;
      if (tri >= 0 && !triangles.includes(tri)) triangles.push(tri);
    }
    if (triangles.length) vp.selectGeometry({ type: "collision", tris: triangles, tri: triangles[triangles.length - 1] });
  });
  await shot("collision-edit.png");

  // Drawing a shape: the cylinder previewed under the cursor before the second click.
  await page.evaluate(() => {
    const app = (window as any).app, vp = app.viewport;
    vp.selectGeometry(null);
    app.setCollisionShape({ kind: "cylinder", height: 1600, segments: 16 });
    app.startCollisionDrawing();
    const rect = vp.canvas.getBoundingClientRect();
    const at = (x: number, y: number) => vp.pickGround({ clientX: rect.left + rect.width * x, clientY: rect.top + rect.height * y })?.point;
    const centre = at(0.5, 0.62), edge = at(0.56, 0.62);
    if (centre && edge) { vp.emit("collision-point", centre); vp.emit("hover", { point: edge }); }
  });
  await shot("collision-shapes.png");
  await page.evaluate(() => { const app = (window as any).app; app.stopTool(); app.setTab("outline"); app.setSetting("displayMode", "both"); app.viewport.frameAll(true); });
  await pause(800);
  await shot("both.png");
  await page.evaluate(() => (window as any).app.setSetting("displayMode", "visual"));

  // Texture editor with a PNG overlay being moved.
  await page.evaluate(() => (window as any).app.viewport.selectModelPiece(0, 0, true));
  await pause(900);
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes("Edit texture"))?.click());
  await page.waitForSelector("[data-texture-painter]", { timeout: 30000 });
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>("[data-texture-painter] button")].find((b) => b.textContent?.includes("Overlay PNG"))?.click());
  await page.waitForFunction(() => document.body.innerText.includes("Overlay PNG ·"), { timeout: 30000 });
  await shot("texture-overlay.png");
  // Close the painter and discard the overlay (Escape alone keeps it open while it has unsaved strokes).
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent?.trim() === "Done")?.click());
  await pause(500);
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button, [role="dialog"] button')].find((b) => /^(Discard|Close without)/.test(b.textContent?.trim() || ""))?.click());
  await page.waitForFunction(() => !document.querySelector("[data-texture-painter]"), { timeout: 10000 });
  await pause(400);
  await page.evaluate(() => (window as any).app.viewport.selectGeometry(null));

  await page.evaluate(() => { (window as any).app.cmd("help"); });
  await page.waitForSelector('[role="tab"]');
  await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent?.includes("Tutorials"))?.click());
  await shot("tutorials.png");
  await page.keyboard.press("Escape");
  await pause(400);

  await page.evaluate(() => {
    const app = (window as any).app;
    app.stopTool(); app.setSetting("displayMode", "visual"); app.setTab("cameras");
    const shot = app.introTimeline().shots[0];
    if (shot) app.doc.select([String(app.doc.kmp.CAME[shot.index].uid)]);
    app.refreshCameraViews();
  });
  await shot("cameras.png");
  await page.evaluate(() => { const app = (window as any).app; app.watchIntro(0); app.toggleIntroPlay(); });
  await shot("intro.png");
  const total = await page.evaluate(() => (window as any).app.introTimeline().total);
  for (let i = 0; i < 18; i++) {
    await page.evaluate((at) => (window as any).app.seekIntro(at), Math.round((total - 1) * i / 40));
    await frame(`intro-${String(i).padStart(2, "0")}.png`);
  }
  await page.evaluate(() => (window as any).app.stopIntro());

  // Game text: every screen is drawn from the game's Scene/UI files with the edited text in place.
  await page.evaluate(() => { (window as any).app.cmd("gameText"); });
  await page.waitForSelector('input[placeholder^="Find text"]', { timeout: 30000 });
  const showMessage = async (query: string, display?: string) => {
    await page.click('input[placeholder^="Find text"]', { clickCount: 3 });
    await page.keyboard.type(query);
    await pause(700);
    if (display) {
      await page.click('[aria-label="Game screen to show"]');
      await page.evaluate((label) => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((o) => o.textContent === label)?.click(), display);
    }
    await page.waitForFunction(() => document.body.innerText.includes("Drawn from the game's own files"), { timeout: 30000 });
    await pause(500);
  };
  await showMessage("0x2339");
  await shot("game-text.png");
  const screensToCapture: [string, string, string?][] = [
    ["character", "0x2339"], ["vehicle", "0x238d"], ["course", "0x2456"], ["battle", "0x24b9"],
    ["race-intro", "0x245c", "Course introduction (race start)"], ["menu-button", "0x0bb8"], ["instruction", "0x0bf4"],
    ["message-window", "0x157f"], ["pause-menu", "0x03eb"], ["race-message", "0x0401", "Race message window"],
  ];
  for (const [name, query, display] of screensToCapture) {
    await showMessage(query, display);
    const canvas = await page.$('[role="dialog"] canvas[role="img"]');
    await canvas!.screenshot({ path: join(screens, `${name}.png`) });
    console.log(`text-screens/${name}.png`);
  }
  // Sounds and music.
  await page.keyboard.press("Escape");
  await pause(500);
  await page.evaluate(() => { (window as any).app.cmd("audio"); });
  await page.waitForFunction(() => document.body.innerText.includes("Moo Moo Meadows · normal"), { timeout: 30000 });
  await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("button")].find((b) => b.textContent?.trim().startsWith("Moo Moo Meadows · normal"))?.click());
  await page.waitForFunction(() => document.body.innerText.includes("Loops from"), { timeout: 30000 });
  await shot("audio.png");
} finally {
  await browser.close();
  worker.terminate();
  rmSync(settings, { recursive: true, force: true });
}
