// Edit a real BRSTM loop in the UI, saving to a temporary workspace without re-encoding audio.
import puppeteer from "puppeteer-core";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeBRSTM, parseBRSTM } from "../web/js/formats/brstm.js";

const game = process.env.MKWII_GAME_DIR;
if (!game) throw new Error("Set MKWII_GAME_DIR to the extracted game's files folder");
const temp = mkdtempSync(join(tmpdir(), "mkwii-audio-loop-"));
const folder = join(temp, "files", "sound", "strm"), file = join(folder, "n_Farm_n.brstm");
mkdirSync(folder, { recursive: true });
copyFileSync(join(game, "sound", "strm", "n_Farm_n.brstm"), file);
const original = new Uint8Array(await Bun.file(file).arrayBuffer());
const settings = mkdtempSync(join(tmpdir(), "mkwii-audio-loop-settings-"));
await Bun.write(join(settings, "settings.json"), JSON.stringify({ tourDone: true }));
const worker = new Worker(new URL("../src/server.ts", import.meta.url).href);
const port: number = await new Promise((resolve) => { worker.onmessage = (e) => e.data?.type === "ready" && resolve(e.data.port); worker.postMessage({ type: "start", token: "audio-loop", settingsDir: settings }); });
const browser = await puppeteer.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewport({ width: 1400, height: 900 });
  await page.goto(`http://127.0.0.1:${port}/?t=audio-loop`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => !!(window as any).app?.viewport);
  if (!(await page.evaluate((root) => (window as any).app.setWorkspace(root), temp))) throw new Error("Workspace rejected");
  await page.evaluate(() => { void (window as any).app.cmd("audio"); });
  await page.waitForFunction(() => document.body.innerText.includes("Moo Moo Meadows · normal"));
  const click = async (label: string, selector = "button") => {
    const button = await page.evaluateHandle((text, query) => [...document.querySelectorAll<HTMLElement>(query)].find((element) => element.textContent?.trim().startsWith(text)) || null, label, selector);
    if (!button.asElement()) throw new Error(`Missing ${label}`);
    await (button.asElement() as any).click();
  };
  await click("Moo Moo Meadows · normal");
  await page.waitForSelector('input[aria-label="Loop start in seconds"]');
  const waveform = await page.$('button[aria-label="Seek in waveform"]');
  const bounds = await waveform?.boundingBox();
  if (!bounds) throw new Error("Music waveform missing");
  await page.mouse.click(bounds.x + bounds.width * 0.25, bounds.y + bounds.height / 2);
  await page.click('button[aria-label="Set loop start to playhead"]');
  const fromPlayhead = Number(await page.$eval('input[aria-label="Loop start in seconds"]', (input) => (input as HTMLInputElement).value));
  if (fromPlayhead < 14 || fromPlayhead > 17) throw new Error(`Playhead loop point was ${fromPlayhead}`);
  await click("Loop in file", "label");
  await page.click('input[aria-label="Loop start in seconds"]');
  await page.keyboard.down("Control"); await page.keyboard.press("A"); await page.keyboard.up("Control");
  await page.keyboard.type("1.25");
  await click("Apply loop");
  await page.waitForFunction(() => document.body.innerText.includes("Modified (not saved)"));
  if (process.env.MKWII_AUDIO_LOOP_SCREENSHOT) { await new Promise((resolve) => setTimeout(resolve, 5000)); await page.screenshot({ path: process.env.MKWII_AUDIO_LOOP_SCREENSHOT }); }
  await click("Save 1");
  await page.waitForFunction(() => document.body.innerText.includes("1 sound saved"));
  const saved = new Uint8Array(await Bun.file(file).arrayBuffer()), stream = parseBRSTM(saved);
  if (stream.loop || stream.loopStart !== Math.round(1.25 * stream.sampleRate)) throw new Error("Loop edit was not saved");
  if (!Buffer.from(saved.subarray(stream.dataOffset)).equals(Buffer.from(original.subarray(stream.dataOffset)))) throw new Error("Music was re-encoded");
  const pcm = decodeBRSTM(stream);
  if (stream.channelInfo[0].loopH1 !== pcm[0][stream.loopStart - 1] || stream.channelInfo[0].loopH2 !== pcm[0][stream.loopStart - 2]) throw new Error("Loop history is wrong");
  if (!existsSync(file + ".bak")) throw new Error("Original music backup missing");
  await page.waitForFunction(() => document.body.innerText.includes("No loop"));
  await click("Loop in file", "label");
  await click("Apply loop");
  await page.waitForFunction(() => document.body.innerText.includes("Modified (not saved)"));
  await click("Save 1");
  await page.waitForFunction(() => document.body.innerText.includes("1 sound saved"));
  if (!parseBRSTM(new Uint8Array(await Bun.file(file).arrayBuffer())).loop) throw new Error("Loop could not be enabled again");
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("Music loop toggle, playhead, sample point, save and audio preservation passed");
} finally {
  await browser.close(); worker.terminate();
  rmSync(settings, { recursive: true, force: true });
  rmSync(temp, { recursive: true, force: true });
}
