// Text limits from the real game's layouts, editing and saving on a temporary copy only.
// Usage: MKWII_GAME_DIR=<files> bun run tests/game-text-limits.smoke.ts
import puppeteer from "puppeteer-core";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createBMG, parseBMG } from "../web/js/formats/bmg.js";
import { buildU8, findFile, newSzsTree, parseU8, setFilePath } from "../web/js/formats/u8.js";
import { yaz0Decompress } from "../web/js/formats/yaz0.js";

const game = process.env.MKWII_GAME_DIR;
if (!game) throw new Error("Set MKWII_GAME_DIR to the extracted game's files folder");
const temp = mkdtempSync(join(tmpdir(), "mkwii-text-limits-")), files = join(temp, "files"), ui = join(files, "Scene", "UI");
mkdirSync(ui, { recursive: true }); mkdirSync(join(files, "Race", "Course"), { recursive: true });
for (const name of ["MenuSingle.szs", "Race.szs", "Font.szs"]) copyFileSync(join(game, "Scene", "UI", name), join(ui, name));
const archive = join(ui, "MenuSingle_E.szs");
const fixture = newSzsTree();
setFilePath(fixture, "message/Common.bmg", createBMG([[0x2328, "Mario"], [0x238c, "Standard Kart S"], [0x23f0, "Mushroom Cup"], [0x245c, "Luigi Circuit"]]));
setFilePath(fixture, "message/Menu.bmg", createBMG([[0x7d1, "Back"], [0xbb8, "Grand Prix"], [0xbf4, "A Grand Prix for beginners (karts only)."], [0x157f, "This course is not available yet.\n\nIf you earn enough trophies in\nGrand Prix mode, you can unlock\nnew courses to race on."]]));
setFilePath(fixture, "message/Race.bmg", createBMG([[0x3eb, "Continue"], [0x401, "Please wait a moment, the other players are still racing..."]]));
await Bun.write(archive, buildU8(fixture));
await Bun.write(join(temp, "settings.json"), JSON.stringify({ tourDone: true, workspace: files, keepBackups: false }));
const worker = new Worker(new URL("../src/server.ts", import.meta.url).href);
let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
const check = (ok: boolean, text: string) => { if (!ok) throw new Error(text); console.log(`ok  ${text}`); };
try {
  const port: number = await new Promise((done) => { worker.onmessage = (e) => e.data?.type === "ready" && done(e.data.port); worker.postMessage({ type: "start", token: "limits", settingsDir: temp }); });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage(); await page.setViewport({ width: 1500, height: 950 });
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/?t=limits`, { waitUntil: "networkidle0" });
  await page.evaluate(() => { void (window as any).app.cmd("gameText"); });
  await page.waitForSelector('textarea[aria-label="Message text"]:not([disabled])');
  const setText = async (selector: string, text: string) => page.$eval(selector, (el, text) => {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
  for (const [id, capacity] of [[0x2328, 40], [0x238c, 40], [0x23f0, 20], [0x245c, 32]]) {
    await setText('input[placeholder^="Find text"]', `0x${id.toString(16)}`);
    await page.waitForFunction((id) => document.body.innerText.includes(`Common.bmg · 0x${id.toString(16).toUpperCase()}`), {}, id);
    await page.waitForSelector(`[data-text-limit="${capacity}"]`);
    await setText('textarea[aria-label="Message text"]', "");
    await page.type('textarea[aria-label="Message text"]', "X".repeat(capacity + 1));
    check(await page.$eval("textarea", (el, expected) => el.value === "X".repeat(expected), capacity), `${id.toString(16)} stops at its actual ${capacity}-character limit`);
    await setText("textarea", "Name\nSecond line");
    check(await page.$eval("textarea", (el, expected) => el.value === "X".repeat(expected), capacity), "names cannot continue onto a second line");
  }
  for (const [file, id, capacity, singleLine] of [
    ["Menu", 0x7d1, 20, true], ["Menu", 0xbb8, 32, true], ["Menu", 0xbf4, 100, false], ["Menu", 0x157f, 350, false], ["Race", 0x3eb, 32, true], ["Race", 0x401, 200, false],
  ] as const) {
    await setText('input[placeholder^="Find text"]', `0x${id.toString(16)}`);
    await page.waitForFunction((file, id) => document.body.innerText.includes(`${file}.bmg · 0x${id.toString(16).toUpperCase().padStart(4, "0")}`), {}, file, id);
    await page.waitForSelector(`[data-text-limit="${capacity}"]`);
    await setText("textarea", "X".repeat(capacity));
    await setText("textarea", "X".repeat(capacity + 1));
    check(await page.$eval("textarea", (el, expected) => el.value === "X".repeat(expected), capacity), `${file} ${id.toString(16)}: its button/instruction/message layout enforces ${capacity} characters`);
    await setText("textarea", "First line\nSecond line");
    check(await page.$eval("textarea", (el, singleLine) => el.value.includes("\n") === !singleLine, singleLine), singleLine ? "button labels stay on one line" : "generic messages retain their supported line breaks");
  }
  await setText('input[placeholder^="Find text"]', "0x245c");
  await page.waitForFunction(() => document.body.innerText.includes("Common.bmg · 0x245C"));
  await setText("textarea", "{1A:080100002460}" + "A".repeat(28));
  check(await page.$eval("#game-text-limit", (el) => el.textContent?.includes("32 / 32")), "encoded icons use their buffer space rather than their visible escape spelling");
  await setText("textarea", "{1A:080100002460}" + "A".repeat(29));
  check(await page.$eval("textarea", (el) => el.value === "{1A:080100002460}" + "A".repeat(28)), "pasting over the limit is rejected without breaking a game code");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent?.trim().startsWith("Save "))!.click());
  await page.waitForFunction(() => document.body.innerText.includes("Game text saved"));
  const saved = parseBMG(findFile(parseU8(yaz0Decompress(new Uint8Array(await Bun.file(archive).arrayBuffer()))), "Common.bmg")!.data);
  check(saved.messages.find((m: any) => m.id === 0x245c)?.text === "{1A:080100002460}" + "A".repeat(28), "the saved BMG respects the limit and keeps the complete icon code");
  check(errors.length === 0, "no browser errors");
} finally {
  await browser?.close(); worker.terminate();
  const target = resolve(temp); if (!target.startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe temporary path"); rmSync(target, { recursive: true, force: true });
}
