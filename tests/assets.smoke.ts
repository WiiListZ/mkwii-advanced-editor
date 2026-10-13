// Real game asset browser: character models, 3D preview, animation edit and shared objects.
// Usage: MKWII_GAME_DIR=<extracted game>/files bun run tests/assets.smoke.ts
import puppeteer from "puppeteer-core";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findFile, parseU8 } from "../web/js/formats/u8.js";
import { decodeTexture, parseBRRES } from "../web/js/formats/brres.js";
import { yaz0Decompress } from "../web/js/formats/yaz0.js";
import { importResourceAnimation } from "../src/asset-operations.ts";
import { setBRRESBoneRestTransform } from "../web/js/editor/brres-bones.js";

const game = process.env.MKWII_GAME_DIR;
if (!game) throw new Error("Set MKWII_GAME_DIR to the extracted game's files folder");
console.log("Preparing game asset smoke test");
const source = new Uint8Array(await Bun.file(join(game, "Race", "Kart", "la_bike-bk.szs")).arrayBuffer());
const donor = new Uint8Array(await Bun.file(join(game, "Race", "Kart", "la_bike-bk_2.szs")).arrayBuffer());
const resource = findFile(parseU8(yaz0Decompress(source)), "driver_model.brres")!.data;
const donorResource = findFile(parseU8(yaz0Decompress(donor)), "driver_model.brres")!.data;
const beforeImport = parseBRRES(resource), donorAnimations = parseBRRES(donorResource);
const originalBone = beforeImport.models[0].bones[1];
const changedBoneBytes = setBRRESBoneRestTransform(resource, beforeImport.models[0].name, 1, {
  trans: [originalBone.trans[0] + 2, originalBone.trans[1], originalBone.trans[2]],
});
const changedBone = parseBRRES(changedBoneBytes).models[0].bones[1];
if (Math.abs(changedBone.trans[0] - originalBone.trans[0] - 2) > .001 || !changedBone.world.some((value: number, index: number) => Math.abs(value - originalBone.world[index]) > .001) || changedBone.inverse.some((value: number, index: number) => value !== originalBone.inverse[index]))
  throw new Error("Bone rest transform did not update the character model");
for (const chr of beforeImport.chr.values()) {
  const size = new DataView(resource.buffer, resource.byteOffset, resource.byteLength).getUint32(chr.offset + 4);
  if (Buffer.compare(Buffer.from(resource.subarray(chr.offset, chr.offset + size)), Buffer.from(changedBoneBytes.subarray(chr.offset, chr.offset + size))))
    throw new Error("Editing the skeleton changed a CHR0 animation");
}
const imported = parseBRRES(await importResourceAnimation(resource, donorResource, [...donorAnimations.chr.keys()][0]));
if (imported.models.length !== beforeImport.models.length || imported.textures.size !== beforeImport.textures.size || imported.chr.size !== beforeImport.chr.size + 1)
  throw new Error("Animation-only import changed model geometry or textures");
const temp = mkdtempSync(join(tmpdir(), "mkwii-assets-"));
const files = join(temp, "files"), kart = join(files, "Race", "Kart");
mkdirSync(kart, { recursive: true });
copyFileSync(join(game, "Race", "Kart", "la_bike-bk.szs"), join(kart, "la_bike-bk.szs"));
// Same driver: an identical copy (ldf_bike) and a different version of the model (lb_bike).
copyFileSync(join(game, "Race", "Kart", "ldf_bike-bk.szs"), join(kart, "ldf_bike-bk.szs"));
copyFileSync(join(game, "Race", "Kart", "lb_bike-bk.szs"), join(kart, "lb_bike-bk.szs"));
copyFileSync(join(game, "Race", "Common.szs"), join(files, "Race", "Common.szs"));
const settings = mkdtempSync(join(tmpdir(), "mkwii-assets-settings-"));
await Bun.write(join(settings, "settings.json"), JSON.stringify({ tourDone: true }));
const worker = new Worker(new URL("../src/server.ts", import.meta.url).href);
const port: number = await new Promise((resolve) => { worker.onmessage = (event) => event.data?.type === "ready" && resolve(event.data.port); worker.postMessage({ type: "start", token: "assets", settingsDir: settings }); });
console.log("Server ready", port);
const browser = await puppeteer.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"], protocolTimeout: 240000 });
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (request.url().includes("/api/open-dialog")) request.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ path: join(process.cwd(), "web", "icon.png") }) });
    else if (request.url().includes("/api/save-dialog")) request.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ path: join(temp, "export.glb") }) });
    else request.continue();
  });
  await page.setViewport({ width: 1600, height: 950 });
  await page.goto(`http://127.0.0.1:${port}/?t=assets`, { waitUntil: "networkidle0" });
  console.log("Home loaded");
  await page.waitForFunction(() => !!(window as any).app?.viewport);
  if (!(await page.evaluate((folder) => (window as any).app.setWorkspace(folder), temp))) throw new Error("Workspace was rejected");
  console.log("Workspace set");
  await page.evaluate(() => { void (window as any).app.cmd("assets"); });
  await page.waitForFunction(() => document.body.innerText.includes("driver_model.brres") && document.body.innerText.includes("Animations (27)"), { timeout: 60000 });
  console.log("Character resource loaded");
  if (!(await page.evaluate(() => document.body.innerText.includes("Dry Bowser") && document.body.innerText.includes("Flame Runner"))))
    throw new Error("The character and vehicle names are not readable in the archive list");
  const actions = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')];
    const action = (label: string) => buttons.find((button) => button.textContent?.trim().startsWith(label))?.disabled;
    return [action("Replace with 3D file"), action("Replace selected part"), action("Move part")];
  });
  if (actions[0] !== true || actions[1] !== true || actions[2] !== true) throw new Error(`Wrong initial character actions: ${actions}`);
  await page.click('button[aria-label="Collapse model"]');
  if (await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].some((button) => button.textContent?.trim() === "polygon0"))) throw new Error("Collapsed model still shows its polygons");
  await page.click('button[aria-label="Expand model"]');
  await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"] button')].some((button) => button.textContent?.trim() === "polygon0"));
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => button.textContent?.trim() === "polygon0")?.click());
  const selectedActions = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')];
    return ["Replace selected part", "Move part"].map((label) => buttons.find((button) => button.textContent?.trim().startsWith(label))?.disabled);
  });
  if (selectedActions[0] !== true || selectedActions[1] !== false) throw new Error(`Wrong selected polygon actions: ${selectedActions}`);
  await page.waitForFunction(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[role="dialog"] canvas');
    if (!canvas || canvas.width < 100 || canvas.height < 100) return false;
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!gl) return false;
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let visible = 0;
    for (let i = 0; i < pixels.length; i += 4) if (Math.abs(pixels[i] - 17) + Math.abs(pixels[i + 1] - 21) + Math.abs(pixels[i + 2] - 28) > 45) visible++;
    return visible > 500;
  }, { timeout: 60000 });
  console.log("WebGL preview rendered");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => button.textContent?.trim() === "3D model")?.click());
  await page.waitForFunction(() => document.body.innerText.includes("3D model exported"), { timeout: 60000 });
  const glb = new Uint8Array(await Bun.file(join(temp, "export.glb")).arrayBuffer());
  const gltf = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + new DataView(glb.buffer).getUint32(12, true))));
  if (gltf.skins?.[0]?.joints.length !== beforeImport.models[0].bones.length || gltf.animations?.length !== beforeImport.chr.size || !gltf.images?.length)
    throw new Error(`The exported 3D model misses bones, animations or textures: ${gltf.skins?.[0]?.joints.length} joints, ${gltf.animations?.length} animations, ${gltf.images?.length} images`);
  console.log("3D model exported with skeleton, textures and animations");
  const previewPixels = async () => page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[role="dialog"] canvas')!;
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl")!;
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let hash = 2166136261;
    for (let i = 0; i < pixels.length; i += 16) hash = Math.imul(hash ^ pixels[i], 16777619);
    return hash >>> 0;
  });
  const initialPreview = await previewPixels();
  const previewBounds = await page.evaluate(() => {
    const { x, y, width, height } = document.querySelector<HTMLCanvasElement>('[role="dialog"] canvas')!.getBoundingClientRect();
    return { x, y, width, height };
  });
  const dragX = previewBounds.x + previewBounds.width / 2, dragY = previewBounds.y + previewBounds.height / 2;
  await page.mouse.move(dragX, dragY);
  await page.mouse.down();
  await page.mouse.move(dragX + 95, dragY + 45, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction((previous) => {
    const canvas = document.querySelector<HTMLCanvasElement>('[role="dialog"] canvas')!;
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl")!;
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let hash = 2166136261;
    for (let i = 0; i < pixels.length; i += 16) hash = Math.imul(hash ^ pixels[i], 16777619);
    return (hash >>> 0) !== previous;
  }, { timeout: 10000 }, initialPreview);
  console.log("WebGL orbit control moved the character");
  await page.evaluate(() => {
    const button = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent?.trim() === "Edit skeleton…");
    button?.click();
  });
  await page.waitForFunction(() => document.querySelectorAll('[role="dialog"]').length === 2);
  await page.click('[role="dialog"] input[aria-label$=" Position X"]', { clickCount: 3 });
  await page.keyboard.type("2");
  await page.keyboard.press("Enter");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"]')][1]?.querySelectorAll("button")?.forEach((button) => { if (button.textContent?.trim() === "Done") button.click(); }));
  await page.waitForFunction(() => document.querySelectorAll('[role="dialog"]').length === 1 && document.body.innerText.includes("Save 1"));
  await page.setViewport({ width: 390, height: 844 });
  await page.waitForFunction(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[role="dialog"] canvas');
    if (!canvas || canvas.width < 100 || canvas.height < 100) return false;
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!gl) return false;
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let visible = 0;
    for (let i = 0; i < pixels.length; i += 4) if (Math.abs(pixels[i] - 17) + Math.abs(pixels[i + 1] - 21) + Math.abs(pixels[i + 2] - 28) > 45) visible++;
    return visible > 500;
  });
  if (process.env.MKWII_ASSET_CHARACTER_MOBILE_SCREENSHOT) await page.screenshot({ path: process.env.MKWII_ASSET_CHARACTER_MOBILE_SCREENSHOT });
  await page.setViewport({ width: 1600, height: 950 });
  if (process.env.MKWII_ASSET_SCREENSHOT) {
    await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => button.textContent?.trim() === "model")?.click());
    await new Promise((resolve) => setTimeout(resolve, 5000));
    await page.screenshot({ path: process.env.MKWII_ASSET_SCREENSHOT });
  }
  const firstTexture = [...beforeImport.textures.keys()][0];
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((tab) => tab.textContent?.startsWith("Textures"))?.click());
  await page.evaluate((name) => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => button.textContent?.trim().startsWith(name))?.click(), firstTexture);
  await page.waitForFunction(() => document.querySelectorAll('[role="dialog"]').length === 2);
  if (!(await page.evaluate((name) => [...document.querySelectorAll('[role="dialog"]')][1]?.textContent?.includes(`Texture · ${name}`), firstTexture))) throw new Error("Texture painter did not open in its own modal");
  const texturePixels = () => page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("[data-texture-painter] canvas")!;
    return [...canvas.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height).data];
  });
  const baseTexture = await texturePixels();
  if (process.env.MKWII_ASSET_TEXTURE_SCREENSHOT) await page.screenshot({ path: process.env.MKWII_ASSET_TEXTURE_SCREENSHOT });
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>("[data-texture-painter] button")].find((button) => button.textContent?.includes("Overlay PNG"))?.click());
  await page.waitForFunction(() => !!document.querySelector('[data-texture-painter] button[title="Delete the PNG overlay and restore the texture underneath"]'));
  await page.click('[data-texture-painter] button[title="Delete the PNG overlay and restore the texture underneath"]');
  await page.waitForFunction(() => !document.querySelector('[data-texture-painter] button[title="Delete the PNG overlay and restore the texture underneath"]'));
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>("[data-texture-painter] button")].find((b) => b.textContent?.trim() === "Save texture")?.click());
  await page.waitForFunction(() => !!document.querySelector<HTMLButtonElement>('[data-texture-painter] button[title^="Apply the painted texture"]')?.disabled);
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"]')][1]?.querySelector<HTMLButtonElement>('button[aria-label="Close"]')?.click());
  await page.waitForFunction(() => document.querySelectorAll('[role="dialog"]').length === 1);
  await page.evaluate((name) => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => button.textContent?.trim().startsWith(name))?.click(), firstTexture);
  await page.waitForFunction(() => document.querySelectorAll('[role="dialog"]').length === 2);
  if (await page.$('[data-texture-painter] button[title="Delete the PNG overlay and restore the texture underneath"]')) throw new Error("Deleted PNG overlay returned after reopening the texture");
  const restoredTexture = await texturePixels();
  const averageDifference = baseTexture.reduce((sum, channel, index) => sum + Math.abs(channel - restoredTexture[index]), 0) / baseTexture.length;
  if (averageDifference > 8) throw new Error(`Deleting the PNG overlay did not restore the base texture (${averageDifference.toFixed(1)} average channel difference)`);
  const paintCanvas = await page.evaluate(() => {
    const canvas = [...document.querySelectorAll('[role="dialog"]')][1]?.querySelector("canvas");
    const bounds = canvas?.getBoundingClientRect();
    return bounds ? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 } : null;
  });
  if (!paintCanvas) throw new Error("Texture painter canvas missing");
  await page.mouse.click(paintCanvas.x, paintCanvas.y);
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>("[data-texture-painter] button")].find((b) => b.textContent?.trim() === "Save texture")?.click());
  await page.waitForFunction(() => !!document.querySelector<HTMLButtonElement>('[data-texture-painter] button[title^="Apply the painted texture"]')?.disabled);
  await page.waitForFunction(() => document.body.innerText.includes("Save 1"));
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"]')][1]?.querySelector<HTMLButtonElement>('button[aria-label="Close"]')?.click());
  await page.waitForFunction(() => document.querySelectorAll('[role="dialog"]').length === 1);
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((tab) => tab.textContent?.startsWith("Animations"))?.click());
  await page.waitForFunction(() => document.body.innerText.includes("Import CHR0 from BRRES"));
  const before = await Bun.file(join(kart, "la_bike-bk.szs")).arrayBuffer();
  const original = parseBRRES(findFile(parseU8(yaz0Decompress(new Uint8Array(before))), "driver_model.brres")!.data);
  const name = [...original.chr.keys()][0];
  await page.evaluate((animation) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === animation)?.click(), name);
  await page.waitForFunction(() => document.body.innerText.includes(" frames"));
  // The name only opens the animation; the play button plays it and turns into Stop.
  if (await page.$(`button[aria-label="Stop ${name}"]`)) throw new Error("Opening an animation started it");
  await page.click(`button[aria-label="Play ${name}"]`);
  await page.waitForSelector(`button[aria-label="Stop ${name}"]`);
  if (process.env.MKWII_ASSETS_ANIMATIONS_SCREENSHOT) await page.screenshot({ path: process.env.MKWII_ASSETS_ANIMATIONS_SCREENSHOT });
  await page.click('[role="dialog"] input[type="checkbox"]');
  await page.waitForFunction(() => document.body.innerText.includes("Save 1"));
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => button.textContent?.trim() === "Save 1")?.click());
  // The same driver on other bikes: the identical copy and the other version (for the painted texture).
  await page.waitForFunction(() => document.body.innerText.includes("Update the other copies?"), { timeout: 120000 });
  const offer = await page.evaluate(() => document.querySelector('[role="dialog"]:last-of-type')?.textContent || "");
  if (!/other vehicles and split screen \(2\)/.test(offer)) throw new Error("Unexpected copies offered: " + offer.slice(0, 600));
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].filter((b) => b.textContent?.trim() === "Save").pop()!.click());
  await page.waitForFunction(() => document.body.innerText.includes("Game archive saved"), { timeout: 120000 });
  if (!existsSync(join(kart, "la_bike-bk.szs.bak"))) throw new Error("No backup of character archive");
  const saved = parseBRRES(findFile(parseU8(yaz0Decompress(new Uint8Array(await Bun.file(join(kart, "la_bike-bk.szs")).arrayBuffer()))), "driver_model.brres")!.data);
  if (saved.chr.get(name)?.loop === original.chr.get(name)?.loop) throw new Error("Animation loop was not saved");
  const driverIn = async (file: string) => findFile(parseU8(yaz0Decompress(new Uint8Array(await Bun.file(join(kart, file)).arrayBuffer()))), "driver_model.brres")!.data as Uint8Array;
  if (parseBRRES(await driverIn("ldf_bike-bk.szs")).chr.get(name)?.loop !== saved.chr.get(name)?.loop) throw new Error("The identical copy did not get the change");
  // The other version gets the painted texture only: its own animation stays as it was.
  const lbBefore = parseBRRES(findFile(parseU8(yaz0Decompress(new Uint8Array(await Bun.file(join(game, "Race", "Kart", "lb_bike-bk.szs")).arrayBuffer()))), "driver_model.brres")!.data);
  const lbAfter = parseBRRES(await driverIn("lb_bike-bk.szs"));
  if (lbAfter.chr.get(name)?.loop !== lbBefore.chr.get(name)?.loop) throw new Error("An animation change reached a different version of the model");
  const painted = [...saved.textures.keys()][0];
  if (decodeTexture(lbAfter.textures.get(painted)).some((v: number, i: number) => v !== decodeTexture(saved.textures.get(painted))[i])) throw new Error("The painted texture did not reach the other version of the model");
  if (Math.abs(saved.models[0].bones[0].trans[0] - original.models[0].bones[0].trans[0] - 2) > .001) throw new Error("Skeleton-only edit was not saved");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((tab) => tab.textContent?.trim() === "Objects")?.click());
  await page.waitForFunction(() => document.body.innerText.includes("banana.brres"), { timeout: 60000 });
  await page.setViewport({ width: 390, height: 844 });
  await page.waitForFunction(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[role="dialog"] canvas');
    if (!canvas || canvas.width < 100 || canvas.height < 100) return false;
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!gl) return false;
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let visible = 0;
    for (let i = 0; i < pixels.length; i += 4) if (Math.abs(pixels[i] - 17) + Math.abs(pixels[i + 1] - 21) + Math.abs(pixels[i + 2] - 28) > 45) visible++;
    return visible > 500;
  }, { timeout: 60000 });
  if (process.env.MKWII_ASSET_MOBILE_SCREENSHOT) await page.screenshot({ path: process.env.MKWII_ASSET_MOBILE_SCREENSHOT });
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("Character preview, animation save, backup and shared objects passed");
} finally {
  await browser.close(); worker.terminate();
  rmSync(settings, { recursive: true, force: true });
  rmSync(temp, { recursive: true, force: true });
}
