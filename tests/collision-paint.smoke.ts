// Visual check against extracted game assets: bun run tests/collision-paint.smoke.ts <output-dir>
import puppeteer from "puppeteer-core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const game = process.env.MKWII_GAME_DIR;
if (!game) throw new Error("Set MKWII_GAME_DIR to the extracted game's files folder");
const output = process.argv[2] || tmpdir();
const track = process.argv[3] || "castle_course";
const settings = mkdtempSync(join(tmpdir(), "mkwii-paint-"));
await Bun.write(join(settings, "settings.json"), JSON.stringify({ tourDone: true }));
const worker = new Worker(new URL("../src/server.ts", import.meta.url).href);
const port: number = await new Promise((resolve) => {
  worker.onmessage = (event) => event.data?.type === "ready" && resolve(event.data.port);
  worker.postMessage({ type: "start", token: "paint", settingsDir: settings });
});
const browser = await puppeteer.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(`http://127.0.0.1:${port}/?t=paint`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => !!(window as any).app?.viewport);
  await page.evaluate(async (path, common) => {
    const app = (window as any).app;
    await app.loadCommonFrom(common, true);
    await app.openPath(path);
    await app.loadTrackAssets();
    app.setSetting("displayMode", "visual");
    app.setTab("collision");
    app.viewport.frameAll(true);
    app.startPainting();
  }, join(game, `Race/Course/${track}.szs`), join(game, "Race/Common.szs"));
  await new Promise((resolve) => setTimeout(resolve, 1400));
  const initial = await page.evaluate(() => {
    const vp = (window as any).app.viewport;
    return { triangles: vp.paintShowTriangles, wireVisible: vp.kclWire?.visible, markersVisible: vp.kmpGroup.visible };
  });
  if (!initial.triangles || !initial.wireVisible || initial.markersVisible) throw new Error("Paint must show triangle edges over the clean track by default: " + JSON.stringify(initial));
  await page.click('button[role="switch"][aria-label="Show triangle edges in paint"]');
  if (await page.evaluate(() => (window as any).app.viewport.kclWire?.visible)) throw new Error("Triangle edge switch did not hide the edges");
  await page.click('button[role="switch"][aria-label="Show triangle edges in paint"]');
  for (const opacity of [0.01, 0.35, 0.7]) {
    const info = await page.evaluate((value) => {
      const vp = (window as any).app.viewport;
      vp.paintOpacity = value;
      vp.applyDisplayMode();
      const m = vp.kclMesh.material;
      return { opacity: m.opacity, transparent: m.transparent, depthTest: m.depthTest, depthWrite: m.depthWrite, stencilWrite: m.stencilWrite, stencil: vp.renderer.getContext().getContextAttributes().stencil, triangles: vp.paintShowTriangles, wireVisible: vp.kclWire?.visible };
    }, opacity);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await page.screenshot({ path: join(output, `paint-${opacity}.png`) });
    console.log(JSON.stringify(info));
  }
} finally {
  await browser.close();
  worker.terminate();
  rmSync(settings, { recursive: true, force: true });
}
