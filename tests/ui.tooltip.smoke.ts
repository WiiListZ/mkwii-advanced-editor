// Regression test: a tooltip must not stay on top of an open Select menu.
import puppeteer from "puppeteer-core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testDir = mkdtempSync(join(tmpdir(), "mkwii-test-"));
await Bun.write(join(testDir, "settings.json"), JSON.stringify({ tourDone: true }));
const worker = new Worker(new URL("../src/server.ts", import.meta.url).href);
const port: number = await new Promise((res) => {
  worker.onmessage = (e) => e.data?.type === "ready" && res(e.data.port);
  worker.postMessage({ type: "start", token: "smoke", settingsDir: testDir });
});
const browser = await puppeteer.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 950 });
await page.goto(`http://127.0.0.1:${port}/?t=smoke`, { waitUntil: "networkidle0" });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const trigger = await page.$("[data-group=transform] button[role=combobox]");
const box = (await trigger!.boundingBox())!;
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await wait(900);
const before = await page.$$eval("[data-radix-popper-content-wrapper] [data-side]", (els) => els.length);
await page.mouse.down();
await page.mouse.up();
await wait(600);
const state = await page.evaluate(() => ({
  listbox: !!document.querySelector("[role=listbox]"),
  tooltip: !!document.querySelector("[role=tooltip]"),
}));
console.log("tooltip shown on hover:", before > 0, "| after click:", JSON.stringify(state));
console.log(state.listbox && !state.tooltip ? "PASS" : "FAIL");
await browser.close();
worker.terminate();
rmSync(testDir, { recursive: true, force: true });
process.exit(0);
