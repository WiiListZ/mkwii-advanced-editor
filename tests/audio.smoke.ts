// Sounds and music editor on a copy of the game's sound files: workspace, listening, exports and
// replacements of a music stream and a voice, saved and read back.
// Usage: MKWII_GAME_DIR=<extracted game>/files bun run tests/audio.smoke.ts
import puppeteer from "puppeteer-core";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseBRSTM, decodeBRSTM } from "../web/js/formats/brstm.js";
import { parseBRSAR, listWaves, readWave } from "../web/js/formats/brsar.js";
import { encodeWAV } from "../web/js/editor/audio.js";

const game = process.env.MKWII_GAME_DIR;
if (!game) throw new Error("Set MKWII_GAME_DIR to the extracted game's files folder");
const temp = mkdtempSync(join(tmpdir(), "mkwii-audio-"));
const workspace = join(temp, "files"), exports = join(temp, "exports");
mkdirSync(join(workspace, "sound", "strm"), { recursive: true }); mkdirSync(exports);
for (const f of ["n_Farm_n.brstm", "n_Farm_F.brstm", "STRM_N_WATER_N.brstm"]) copyFileSync(join(game, "sound", "strm", f), join(workspace, "sound", "strm", f));
copyFileSync(join(game, "sound", "revo_kart.brsar"), join(workspace, "sound", "revo_kart.brsar"));
// A replacement: 3 seconds of a rising tone.
const rate = 44100, tone = new Int16Array(rate * 3);
for (let i = 0; i < tone.length; i++) tone[i] = Math.round(Math.sin(2 * Math.PI * (300 + i / 200) * i / rate) * 12000);
const replacement = join(temp, "tone.wav");
await Bun.write(replacement, encodeWAV([tone, tone], rate));

const settings = mkdtempSync(join(tmpdir(), "mkwii-audio-settings-"));
await Bun.write(join(settings, "settings.json"), JSON.stringify({ tourDone: true }));
const worker = new Worker(new URL("../src/server.ts", import.meta.url).href);
const port: number = await new Promise((r) => { worker.onmessage = (e) => e.data?.type === "ready" && r(e.data.port); worker.postMessage({ type: "start", token: "audio", settingsDir: settings }); });
const browser = await puppeteer.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true, args: ["--autoplay-policy=no-user-gesture-required"], protocolTimeout: 240000 });
const errors: string[] = [];
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let saveName = "";
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.stack || e.message));
  await page.setViewport({ width: 1400, height: 900 });
  await page.setRequestInterception(true);
  let intercept = true;
  page.on("request", (q) => {
    if (!intercept) return;
    if (q.url().includes("/api/open-dialog")) q.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ path: replacement }) });
    else if (q.url().includes("/api/save-dialog")) q.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ path: join(exports, saveName) }) });
    else q.continue();
  });
  await page.goto(`http://127.0.0.1:${port}/?t=audio`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => !!(window as any).app?.viewport);
  const ok = await page.evaluate((w) => (window as any).app.setWorkspace(w), temp); // the folder above "files"
  if (!ok || !(await page.evaluate(() => (window as any).app.workspace().endsWith("files")))) throw new Error("Workspace was not set to the files folder");
  await page.evaluate(() => { (window as any).app.cmd("audio"); });
  await page.waitForFunction(() => document.body.innerText.includes("Moo Moo Meadows · normal"));
  // Real mouse clicks (menus open on pointer down).
  const click = async (text: string, selector = "button", exact = false) => {
    const handle = await page.evaluateHandle((t, s, e) => [...document.querySelectorAll<HTMLElement>(s)].find((x) => (e ? x.textContent?.trim() === t : x.textContent?.trim().startsWith(t))) || null, text, selector, exact);
    const element = handle.asElement();
    if (!element) throw new Error("Missing " + text);
    await (element as any).click();
  };
  await click("Moo Moo Meadows · normal");
  await page.waitForFunction(() => document.body.innerText.includes("Loops from"));
  const timeline = await page.waitForSelector('input[aria-label="Playback position"]');
  const bounds = await timeline?.boundingBox();
  if (!bounds) throw new Error("Playback timeline missing");
  await page.mouse.click(bounds.x + bounds.width * 0.7, bounds.y + bounds.height / 2);
  if (Number(await page.$eval('input[aria-label="Playback position"]', (x) => (x as HTMLInputElement).value)) < 20) throw new Error("Timeline did not seek");
  await click("Play"); await wait(400);
  const waveform = await page.$('button[aria-label="Seek in waveform"]');
  const waveBounds = await waveform?.boundingBox();
  if (!waveBounds) throw new Error("Clickable waveform missing");
  await page.mouse.click(waveBounds.x + waveBounds.width * 0.3, waveBounds.y + waveBounds.height / 2);
  await wait(150);
  const seeked = await page.$eval('input[aria-label="Playback position"]', (x) => { const input = x as HTMLInputElement; return Number(input.value) / Number(input.max); });
  if (seeked < 0.28 || seeked > 0.34) throw new Error(`Waveform seek landed at ${seeked}`);
  await click("Stop");
  const aac = await page.evaluate(() => AudioEncoder.isConfigSupported({ codec: "mp4a.40.2", sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 }).then((r) => !!r.supported).catch(() => false));
  const formats = [["WAV", "wav"], ["MP3", "mp3"], ...(aac ? [["M4A (AAC)", "m4a"]] : []), ["FLAC", "flac"], ["Ogg Opus", "ogg"], ["AIFF", "aiff"], ["BRSTM", "brstm"]];
  if (!aac) console.log("AAC encoder not available in this browser: M4A export skipped");
  for (const [label, ext] of formats) {
    saveName = `farm.${ext}`;
    await click("Export", '[role="dialog"] button');
    await page.waitForSelector('[role="menuitem"]');
    await click(label, '[role="menuitem"]');
    for (let i = 0; i < 240 && !existsSync(join(exports, saveName)); i++) await wait(250);
    if (!existsSync(join(exports, saveName))) throw new Error(`${label} export missing`);
    await wait(300);
    console.log("exported", saveName, Bun.file(join(exports, saveName)).size, "bytes");
  }
  // The compressed exports decode back to the length of the WAV export (within 0.2 s of encoder delay).
  const seconds = await page.evaluate(async (paths: string[]) => {
    const token = new URLSearchParams(location.search).get("t")!;
    const out: Record<string, number> = {};
    for (const path of paths) {
      const data = await (await fetch(`/api/read?path=${encodeURIComponent(path)}`, { headers: { "x-token": token } })).arrayBuffer();
      out[path.split(/[\\/]/).pop()!] = (await new OfflineAudioContext(2, 1, 48000).decodeAudioData(data)).duration;
    }
    return out;
  }, ["wav", "mp3", ...(aac ? ["m4a"] : []), "flac"].map((ext) => join(exports, `farm.${ext}`)));
  for (const [name, duration] of Object.entries(seconds)) if (Math.abs(duration - seconds["farm.wav"]) > 0.2) throw new Error(`${name} decodes to ${duration} s, WAV is ${seconds["farm.wav"]} s`);
  console.log("decoded lengths", seconds);
  await click("Koopa Cape · normal");
  await page.waitForFunction(() => document.body.innerText.includes("4 tracks"));
  await click("Separate tracks", "button");
  await page.waitForFunction(() => document.body.innerText.includes("Track 4"));
  if (!(await page.evaluate(() => [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('Separate tracks'))?.getAttribute('aria-expanded') === 'true'))) throw new Error("Separate tracks did not expand");
  const trackRow = await page.evaluateHandle(() => [...document.querySelectorAll("div")].find((d) => d.className.includes("min-h-10") && d.textContent?.includes("Track 3")) || null);
  const trackPlay = await (trackRow.asElement() as any).$("button");
  await trackPlay.click(); await wait(400); await trackPlay.click();
  if (await page.$$eval('button[aria-label^="Seek and play track"]', (buttons) => buttons.length) !== 4) throw new Error("Per-track waveforms missing");
  await (await page.$('button[aria-label="Seek and play track 3"]'))!.click();
  await page.waitForFunction(() => [...document.querySelectorAll("div")].some((d) => d.className.includes("min-h-10") && d.textContent?.includes("Track 3") && d.textContent?.includes("Stop")));
  await trackPlay.click();
  saveName = "koopa_track_3.brstm";
  const trackExport = await (trackRow.asElement() as any).$("button[title='Export track 3']");
  await trackExport.click();
  await click("BRSTM", '[role="menuitem"]');
  for (let i = 0; i < 120 && !existsSync(join(exports, saveName)); i++) await wait(250);
  if (!existsSync(join(exports, saveName))) throw new Error("Isolated track export missing");
  const isolated = parseBRSTM(new Uint8Array(await Bun.file(join(exports, saveName)).arrayBuffer()));
  if (isolated.channels !== 2 || isolated.tracks.length !== 1) throw new Error("Export was not isolated");
  console.log("isolated track:", isolated.channels, "channels,", isolated.tracks.length, "track");
  await click("Separate tracks", "button");
  await page.waitForFunction(() => !document.body.innerText.includes("Track 4"));
  if (!(await page.evaluate(() => [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('Separate tracks'))?.getAttribute('aria-expanded') === 'false'))) throw new Error("Separate tracks did not collapse");
  await click("Moo Moo Meadows · normal");
  await page.waitForFunction(() => document.body.innerText.includes("Loops from"));
  // Replace the music, then a voice.
  await click("Replace…");
  await page.waitForFunction(() => document.body.innerText.includes("Loop start (seconds)"));
  await click("Replace", '[role="dialog"] button', true);
  await page.waitForFunction(() => document.body.innerText.includes("Modified (not saved)"), { timeout: 120000 });
  console.log("music replacement prepared");
  await click("Sound effects and voices", '[role="tab"]');
  await page.waitForFunction(() => document.body.innerText.includes("VO_MR_ATK"), { timeout: 30000 })
    .catch(async () => { throw new Error("Sound archive did not load: " + (await page.evaluate(() => document.body.innerText.slice(0, 1200))) + " page errors: " + errors.join(" | ")); });
  console.log("sound archive tab loaded");
  await page.type('input[placeholder^="Find a sound"]', "VO_MR_ATK");
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent?.trim().startsWith("VO_MR_ATK")), { timeout: 60000 })
    .catch(async () => { throw new Error("Sound list: " + (await page.evaluate(() => document.body.innerText.slice(0, 800)))); });
  await click("VO_MR_ATK");
  await page.waitForFunction(() => /16\D?000 Hz/.test(document.body.innerText), { timeout: 60000 });
  console.log("voice loaded");
  await click("Replace…");
  await page.waitForFunction(() => document.body.innerText.includes("Volume (%)"));
  await click("Replace", '[role="dialog"] button', true);
  await page.waitForFunction(() => /Save 2/.test(document.body.innerText), { timeout: 120000 });
  console.log("voice replacement prepared");
  await page.waitForFunction(() => document.querySelectorAll("[role=dialog]").length === 1);
  // Interception would slow the 100 MB upload of the sound archive to a crawl.
  intercept = false;
  await page.setRequestInterception(false);
  await click("Save 2");
  await page.waitForFunction(() => document.body.innerText.includes("2 sounds saved"), { timeout: 240000 })
    .catch(async () => { throw new Error("After save: " + (await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.trim().startsWith("Save")) as HTMLButtonElement; return `${b?.textContent} disabled=${b?.disabled} toasts=` + [...document.querySelectorAll("[data-sonner-toast]")].map((t) => (t as HTMLElement).innerText).join(" | "); })) + ` bak music=${existsSync(join(workspace, "sound", "strm", "n_Farm_n.brstm.bak"))} brsar=${existsSync(join(workspace, "sound", "revo_kart.brsar.bak"))}`); });
} finally {
  await browser.close(); worker.terminate(); rmSync(settings, { recursive: true, force: true });
}
try {
  // Read the saved files back.
  const music = parseBRSTM(new Uint8Array(await Bun.file(join(workspace, "sound", "strm", "n_Farm_n.brstm")).arrayBuffer()));
  const pcm = decodeBRSTM(music);
  console.log("music:", music.channels, "channels,", (music.samples / music.sampleRate).toFixed(2), "s, loop", music.loop, music.loopStart);
  if (Math.abs(music.samples / music.sampleRate - 3) > 0.01 || pcm[0].every((v) => v === 0)) throw new Error("Replaced music is wrong");
  const archive = parseBRSAR(new Uint8Array(await Bun.file(join(workspace, "sound", "revo_kart.brsar")).arrayBuffer()));
  const voice = readWave(archive, listWaves(archive).find((w: any) => w.name === "VO_MR_ATK"));
  console.log("voice:", voice.sampleRate, "Hz,", (voice.channels[0].length / voice.sampleRate).toFixed(2), "s");
  if (Math.abs(voice.channels[0].length / voice.sampleRate - 3) > 0.01) throw new Error("Replaced voice is wrong");
  if (!existsSync(join(workspace, "sound", "revo_kart.brsar.bak"))) throw new Error("No backup of the sound archive");
  console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "No page errors");
  if (errors.length) process.exitCode = 1;
} finally { rmSync(temp, { recursive: true, force: true }); }
