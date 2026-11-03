// Real generator controls, imported image, new editor window and SZS save/reopen.
import puppeteer from "puppeteer-core";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { rgbaPNG } from "../src/generated-textures.ts";
import { parseU8, findFile } from "../web/js/formats/u8.js";
import { isYaz0, yaz0Decompress } from "../web/js/formats/yaz0.js";
import { parseBRRES, decodeTexture } from "../web/js/formats/brres.js";

const dir = await mkdtemp(join(tmpdir(), "mkwii-generator-ui-"));
const imagePath = join(dir, "Custom blue.png"), savedPath = join(dir, "My snowy track.szs");
const pixels = new Uint8Array(32 * 32 * 4);
for (let i = 0; i < pixels.length; i += 4) pixels.set((i / 4) % 32 < 16 ? [40, 80, 240, 128] : [240, 80, 40, 128], i);
await writeFile(imagePath, rgbaPNG(32, 32, pixels));
await writeFile(join(dir, "settings.json"), JSON.stringify({ tourDone: true, discordActivity: false, tracksMovedNoticeSeen: true, ...(process.env.MKWII_PREVIEW_GAME ? { workspace: process.env.MKWII_PREVIEW_GAME } : {}) }));
const worker = new Worker(new URL("../src/server.ts", import.meta.url).href);
let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
const check = (ok: boolean, message: string) => { if (!ok) throw Error(message); console.log("ok  " + message); };
try {
  const port = await new Promise<number>((done, fail) => {
    worker.onmessage = (e) => { if (e.data?.type === "ready") done(e.data.port); if (e.data?.type === "error") fail(Error(e.data.message)); };
    worker.postMessage({ type: "start", token: "generator-ui", settingsDir: dir });
  });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage(), errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewport({ width: 1600, height: 1100 });
  await page.setRequestInterception(true);
  page.on("request", (r) => new URL(r.url()).pathname === "/api/open-dialog"
    ? void r.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ path: imagePath }) }) : void r.continue());
  await page.goto(`http://127.0.0.1:${port}/?t=generator-ui`, { waitUntil: "networkidle0" });
  await page.evaluate(() => { void (window as any).app.cmd("newTrack"); });
  await page.waitForSelector('[aria-label="Track style"]');
  await page.waitForSelector(`[aria-label="Road texture preview"][data-texture-source="${process.env.MKWII_PREVIEW_GAME ? "game" : "editor"}"]`);
  if (process.env.MKWII_PREVIEW_GAME) await page.screenshot({ path: ".cache/generator-game-texture-previews.png" });
  await page.click('[aria-label="Track style"]');
  await page.waitForSelector('[role="option"]');
  await page.evaluate(() => { ([...document.querySelectorAll('[role="option"]')].find((e) => e.textContent === "Snow") as HTMLElement).click(); });
  await page.waitForFunction(() => document.querySelector('[aria-label="Track style"]')?.textContent?.includes("Snow"));
  check(true, "the style can be selected before drawing");
  // Draw a closed loop using the actual pointer tool, then keep its control points.
  await page.evaluate(() => { ([...document.querySelectorAll('[role="toolbar"] button')].find((e) => e.textContent?.includes("Draw by hand")) as HTMLElement).click(); });
  const rect = await (await page.$('[data-testid="generator-canvas"]'))!.boundingBox();
  if (!rect) throw Error("Drawing canvas unavailable");
  await page.mouse.move(rect.x + rect.width * .8, rect.y + rect.height / 2); await page.mouse.down();
  for (let i = 1; i <= 64; i++) { const a = i * Math.PI * 2 / 64; await page.mouse.move(rect.x + rect.width * (.5 + .3 * Math.cos(a)), rect.y + rect.height * (.5 + .3 * Math.sin(a))); }
  await page.mouse.up();
  await page.click('[role="tab"][id$="-trigger-road"]');
  await page.evaluate(() => { ([...document.querySelectorAll('button')].find((e) => e.textContent?.trim() === "Remove all") as HTMLElement).click(); });
  await page.click('[aria-label="Place boost panels"]');
  const drawing = await (await page.$('[data-testid="generator-canvas"]'))!.boundingBox();
  if (!drawing) throw Error("Drawing canvas unavailable");
  const px = drawing.x + drawing.width / 2, top = drawing.y + drawing.height * 70 / 430, bottom = drawing.y + drawing.height * 360 / 430;
  await page.mouse.click(px, top); await page.mouse.click(px, bottom);
  await page.waitForFunction(() => document.body.textContent?.includes("2 manually placed boost panels"));
  await page.mouse.click(px, top, { button: "right" });
  await page.waitForFunction(() => document.body.textContent?.includes("1 manually placed boost panels"));
  await page.keyboard.down("Control"); await page.keyboard.press("KeyZ"); await page.keyboard.up("Control");
  await page.waitForFunction(() => document.body.textContent?.includes("2 manually placed boost panels"));
  check(true, "boost panels can be placed, removed and restored with Undo directly on the drawing");
  if (process.env.MKWII_PREVIEW_GAME) {
    const hash = () => page.evaluate(() => { const c = document.querySelector<HTMLCanvasElement>('[data-testid="generator-canvas"]')!, p = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data; let h = 0; for (const v of p) h = Math.imul(h, 31) + v | 0; return h; });
    const before = await hash(); await new Promise((done) => setTimeout(done, 400));
    check(await hash() !== before, "the original game boost material animates in the generator preview");
    await page.screenshot({ path: ".cache/generator-animated-boosts.png" });
  }
  await page.click('[role="tab"][id$="-trigger-textures"]');
  await page.waitForSelector('[aria-label="Choose image for Road"]');
  await page.click('[aria-label="Choose image for Road"]');
  await page.waitForFunction(() => document.querySelector('[aria-label="Road texture"]')?.textContent?.includes("Custom image"));
  await page.waitForSelector('[aria-label="Road texture preview"][data-texture-source="custom"]');
  const thumb = await page.evaluate(() => {
    const canvas = [...document.querySelectorAll<HTMLCanvasElement>('[aria-label="Road texture preview"]')].find((c) => c.width === 96)!;
    return [...canvas.getContext("2d")!.getImageData(24, 48, 1, 1).data];
  });
  check(thumb[0] === 40 && thumb[1] === 80 && Math.abs(thumb[2] - 240) <= 1 && thumb[3] === 128, "the thumbnail samples the actual image pixels and transparency");
  await page.click('[aria-label="Road texture repeat"]');
  await page.keyboard.down("Control"); await page.keyboard.press("KeyA"); await page.keyboard.up("Control"); await page.keyboard.type("2"); await page.keyboard.press("Tab");
  await page.waitForFunction(() => {
    const canvas = [...document.querySelectorAll<HTMLCanvasElement>('[aria-label="Road texture preview"]')].find((c) => c.width === 96);
    if (!canvas || canvas.dataset.textureSource !== "custom") return false;
    const p = canvas.getContext("2d")!.getImageData(60, 48, 1, 1).data; return p[0] === 40 && p[2] > 230;
  });
  check(true, "changing Repeat updates the texture sampling rather than just its label");
  const layoutColours = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="generator-canvas"]')!, pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let red = 0, blue = 0;
    for (let i = 0; i < pixels.length; i += 4) { if (pixels[i] - pixels[i + 2] > 40) red++; if (pixels[i + 2] - pixels[i] > 40) blue++; }
    return { red, blue };
  });
  check(layoutColours.red > 1000 && layoutColours.blue > 1000, "the layout shows both colours of the texture instead of an average swatch");
  await page.screenshot({ path: ".cache/generator-custom-textures.png" });
  check(true, "a personal image is imported and previewed for the road");
  const generatedTarget = browser.waitForTarget((t) => !!new URL(t.url() || "about:blank").searchParams.get("document"));
  await page.evaluate(() => { ([...document.querySelectorAll('button')].find((e) => e.textContent?.trim() === "Generate track") as HTMLElement).click(); });
  const editor = (await (await generatedTarget).page())!;
  editor.on("pageerror", (e) => errors.push(e.message));
  await editor.waitForFunction(() => (window as any).app?.doc.fileName === "New Track.szs" && (window as any).app.viewport?.hasCourseModel, { timeout: 30000 });
  await editor.setRequestInterception(true);
  editor.on("request", (r) => new URL(r.url()).pathname === "/api/save-dialog"
    ? void r.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ path: savedPath }) }) : void r.continue());
  await editor.evaluate(() => (window as any).app.save());
  const bytes = new Uint8Array(await readFile(savedPath));
  const saved = parseU8(isYaz0(bytes) ? yaz0Decompress(bytes) : bytes), course = parseBRRES(findFile(saved, "course_model.brres")!.data);
  check([...decodeTexture(course.textures.get("road")).slice(0, 4)].join(",") === "40,80,240,128", "the saved SZS contains the custom texture with its exact colour and transparency");
  check(decodeTexture(course.textures.get("offroad"))[0] > 180, "the other surfaces retain the chosen snow style");
  check(course.models[0].objects.filter((o: any) => /^boost(?:_part\d+)?$/.test(o.name)).reduce((n: number, o: any) => n + o.triangles, 0) === 12, "both manually placed boost panels are saved in the SZS");
  if (process.env.MKWII_PREVIEW_GAME) check([...course.srt.values()].some((s: any) => s.loop && s.materials.has("boost")), "the original looping boost animation is saved in the SZS");
  check(!errors.length, "drawing, image selection, generation and saving produce no browser errors: " + errors.join("; "));
} finally {
  await browser?.close(); worker.terminate();
  if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw Error("Unsafe generator UI cleanup");
  await rm(dir, { recursive: true, force: true });
}
