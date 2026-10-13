// Uses an extracted game's Common.szs and Mario Circuit to check real object resources.
// Usage: MKWII_GAME_DIR=<extracted game files> bun run tests/object-appearance.smoke.ts
import puppeteer from "puppeteer-core";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";

const game = process.env.MKWII_GAME_DIR;
if (!game || !existsSync(join(game, "Race/Common.szs"))) {
  console.log("MKWII_GAME_DIR not set (or no Race/Common.szs): skipped");
  process.exit(0);
}
const settingsDir = mkdtempSync(join(tmpdir(), "mkwii-object-appearance-"));
await Bun.write(join(settingsDir, "settings.json"), JSON.stringify({ tourDone: true }));
const worker = new Worker(new URL("../src/server.ts", import.meta.url).href);
const port: number = await new Promise((resolve) => {
  worker.onmessage = (event) => event.data?.type === "ready" && resolve(event.data.port);
  worker.postMessage({ type: "start", token: "appearance", settingsDir });
});
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1600,950"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 950 });
const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); console.log("ok", message); };
try {
  await page.goto(`http://127.0.0.1:${port}/?t=appearance`, { waitUntil: "networkidle0" });
  const source = await page.evaluate(async (common, track) => {
    const app = (window as any).app;
    await app.loadCommonFrom(common, true);
    await app.openPath(track);
    await app.loadTrackAssets();
    app.setTab("objects");
    return app.objectAppearanceResources(0x65).find((r: any) => r.name === "itembox")?.source;
  }, join(game, "Race/Common.szs"), join(game, "Race/Course/castle_course.szs"));
  check(source === "track", "Mario Circuit provides its own item box BRRES");
  const initiallyHidden = await page.evaluate(() => ![...document.querySelectorAll("button")].some((b) => b.textContent?.includes("Add to track")));
  check(initiallyHidden, "object preview and add action are hidden before a click");
  await page.evaluate(() => {
    const row = [...document.querySelectorAll<HTMLElement>('div[draggable="true"]')].find((x) => x.textContent?.includes("0x0065"));
    row?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
  });
  check(await page.evaluate(() => ![...document.querySelectorAll("button")].some((b) => b.textContent?.includes("Add to track"))), "hover does not reveal the preview");
  await page.evaluate(() => {
    const row = [...document.querySelectorAll<HTMLElement>('div[draggable="true"]')].find((x) => x.textContent?.includes("0x0065"));
    row?.click();
  });
  check(await page.evaluate(() => !![...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Add to track")) && !(window as any).app.tool), "click selects the object without placing it");
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Add to track"))?.click());
  check(await page.evaluate(() => (window as any).app.tool?.kind === "GOBJ"), "Add to track starts placement after selection");
  await page.evaluate(() => { const app = (window as any).app; app.stopTool(); void app.pickObject(0x65, "add"); });
  await page.waitForSelector('[role="dialog"] [aria-label="Object categories"]');
  check(await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]')!;
    return !!dialog.querySelector('[aria-label="Object categories"] button[aria-pressed="true"]')
      && ![...dialog.querySelectorAll("button")].some((b) => b.textContent?.includes("Add to track"));
  }), "object picker has categories and hides preview and Add to track before selection");
  await page.keyboard.press("ArrowDown");
  check(await page.evaluate(() => ![...document.querySelectorAll('[role="dialog"] button')].some((b) => b.textContent?.includes("Add to track"))), "keyboard highlight alone does not reveal the object picker preview");
  await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]')!;
    ([...dialog.querySelectorAll<HTMLElement>('[aria-label="Object categories"] button')].find((b) => b.querySelector("span")?.textContent === "Race"))?.click();
  });
  check(await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]')!;
    return !!dialog.querySelector('[aria-label="Object categories"] button[aria-pressed="true"]')?.textContent?.includes("Race")
      && [...dialog.querySelectorAll('[cmdk-item]')].every((item) => !item.textContent?.includes("Goomba"));
  }), "object picker filters by category");
  await page.evaluate(() => {
    const row = [...document.querySelectorAll<HTMLElement>('[role="dialog"] [cmdk-item]')].find((item) => item.textContent?.includes("0x0065"));
    row?.click();
  });
  check(await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]')!;
    return !!dialog.querySelector("canvas") && !![...dialog.querySelectorAll("button")].find((b) => b.textContent?.includes("Add to track"))
      && !(window as any).app.tool;
  }), "object picker click reveals preview and Add to track without placing");
  if (process.env.MKWII_OBJECT_PICKER_SCREENSHOT) {
    await new Promise((done) => setTimeout(done, 4500));
    await page.screenshot({ path: process.env.MKWII_OBJECT_PICKER_SCREENSHOT });
  }
  await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent?.includes("Add to track"))?.click());
  check(await page.evaluate(() => (window as any).app.tool?.kind === "GOBJ" && (window as any).app.tool?.objectId === 0x65), "object picker Add to track places only the clicked object");
  await page.evaluate(() => {
    const app = (window as any).app;
    app.stopTool();
    (window as any).__changedObject = null;
    void app.pickObject(0x65, "change").then((id: number | null) => { (window as any).__changedObject = id; });
  });
  await page.waitForSelector('[role="dialog"] [cmdk-item]');
  await page.evaluate(() => {
    [...document.querySelectorAll<HTMLElement>('[role="dialog"] [cmdk-item]')].find((item) => item.textContent?.includes("0x0065"))?.click();
  });
  await page.waitForFunction(() => !![...document.querySelectorAll<HTMLElement>('[role="dialog"] button')].find((button) => button.textContent?.includes("Change selected object")));
  await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[role="dialog"] button')].find((button) => button.textContent?.includes("Change selected object"))?.click());
  await page.waitForFunction(() => (window as any).__changedObject === 0x65);
  check(await page.evaluate(() => !(window as any).app.tool), "object picker still changes a selected track object without starting placement");
  await page.evaluate(() => {
    const app = (window as any).app;
    app.stopTool(); app.setTab("outline");
    app.doc.select(app.doc.kmp.GOBJ.find((o: any) => o.objectId === 0x65).uid);
  });
  const appearance = await page.waitForSelector("button");
  check(!!appearance, "inspector is rendered");
  check(await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent?.includes("Track objects"))
    && ![...document.querySelectorAll("button")].some((b) => b.textContent?.includes("Appearance in this track"))), "inspector shows only the Track objects button");
  await page.evaluate(() => { const app = (window as any).app; void app.openObjectAppearance(0x65); });
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent?.includes("Paint texture in editor")));
  const initial = await page.evaluate(() => {
    const app = (window as any).app;
    const r = app.objectAppearanceResources(0x65).find((x: any) => x.name === "itembox");
    (window as any).__itemboxBefore = r.data.slice();
    return r.textures.length;
  });
  check(initial > 0, "item box textures are listed");
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Paint texture in editor"));
    button?.click();
  });
  const canvas = await page.waitForSelector("canvas[aria-label^='Edit texture']");
  const box = await canvas!.boundingBox();
  if (!box) throw new Error("Texture canvas is not visible");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  check(await page.evaluate(() => {
    const app = (window as any).app;
    const now = app.objectAppearanceResources(0x65).find((x: any) => x.name === "itembox").data;
    return now.every((b: number, i: number) => b === (window as any).__itemboxBefore[i]);
  }), "painting waits for Save texture");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>("[data-texture-painter] button")].find((b) => b.textContent?.trim() === "Save texture")?.click());
  await page.waitForFunction(() => (window as any).app.doc.undoStack.some((s: any) => s.label.startsWith("Paint itembox texture")));
  const changed = await page.evaluate(() => {
    const app = (window as any).app;
    const now = app.objectAppearanceResources(0x65).find((x: any) => x.name === "itembox").data;
    return now.some((b: number, i: number) => b !== (window as any).__itemboxBefore[i]);
  });
  check(changed, "painting changes the course-local BRRES");
  const restored = await page.evaluate(() => {
    const app = (window as any).app;
    app.doc.undo();
    const now = app.objectAppearanceResources(0x65).find((x: any) => x.name === "itembox").data;
    return now.every((b: number, i: number) => b === (window as any).__itemboxBefore[i]);
  });
  check(restored, "undo restores the original object texture");
  const shared = await page.evaluate(() => {
    const app = (window as any).app;
    for (const id of Object.keys(app.assets.objectInfo).map(Number)) {
      const resource = app.objectAppearanceResources(id).find((r: any) =>
        r.source === "common" && r.textures.some((t: any) => [0, 1, 2, 3, 4, 5, 6, 14].includes(t.format)));
      if (!resource) continue;
      const tex = resource.textures.find((t: any) => [0, 1, 2, 3, 4, 5, 6, 14].includes(t.format));
      const sharedBytes = resource.data.slice();
      const pixels = new Uint8ClampedArray(tex.width * tex.height * 4);
      for (let i = 0; i < pixels.length; i += 4) { pixels[i] = 255; pixels[i + 3] = 255; }
      if (!app.commitObjectTexture(id, resource.name, tex.name, pixels)) throw new Error("Could not paint shared object");
      const local = app.objectAppearanceResources(id).find((r: any) => r.name === resource.name);
      const commonUnchanged = resource.data.every((b: number, i: number) => b === sharedBytes[i]);
      app.doc.undo();
      const reverted = app.objectAppearanceResources(id).find((r: any) => r.name === resource.name);
      return { local: local.source, commonUnchanged, reverted: reverted.source };
    }
    return null;
  });
  check(shared?.local === "track" && shared.commonUnchanged && shared.reverted === "common", `shared object creates an undoable per-track override (${JSON.stringify(shared)})`);
} finally {
  await browser.close();
  worker.terminate();
  if (!resolve(settingsDir).startsWith(resolve(tmpdir()) + sep) || !basename(settingsDir).startsWith("mkwii-object-appearance-")) throw new Error("Unsafe temporary settings path");
  rmSync(settingsDir, { recursive: true, force: true });
}
