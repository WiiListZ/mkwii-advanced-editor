// Real pages and disk writes: two track editors must never share a document or Undo history.
import puppeteer, { type Page } from "puppeteer-core";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { buildKMP, emptyKMP, make, parseKMP } from "../web/js/formats/kmp.js";

const temp = mkdtempSync(join(tmpdir(), "mkwii-windows-"));
const first = join(temp, "First track.kmp"), second = join(temp, "Second track.kmp");
const kmp = emptyKMP(); kmp.KTPT.push(make.KTPT());
await Bun.write(first, buildKMP(kmp)); await Bun.write(second, buildKMP(kmp));
await Bun.write(join(temp, "settings.json"), JSON.stringify({ tourDone: true, keepBackups: false }));
const worker = new Worker(new URL("../src/server.ts", import.meta.url).href);
let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
const check = (ok: boolean, label: string) => { if (!ok) throw new Error(label); console.log(`ok  ${label}`); };
const x = (page: Page) => page.evaluate(() => (window as any).app.doc.kmp.KTPT[0].pos[0]);
const change = (page: Page, value: number) => page.evaluate((value) => {
  const a = (window as any).app; a.doc.change("Move start", () => { a.doc.kmp.KTPT[0].pos[0] = value; });
}, value);
const diskX = (path: string) => parseKMP(new Uint8Array(readFileSync(path))).KTPT[0].pos[0];
const errors: string[] = [];
try {
  const port: number = await new Promise((done) => {
    worker.onmessage = (e) => e.data?.type === "ready" && done(e.data.port);
    worker.postMessage({ type: "start", token: "multi-window", settingsDir: temp });
  });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const parent = await browser.newPage();
  parent.on("pageerror", (e) => errors.push(e.message));
  await parent.goto(`http://127.0.0.1:${port}/?t=multi-window`, { waitUntil: "networkidle0" });
  await parent.waitForFunction(() => !!(window as any).app?.viewport);
  // A dirty document in the launcher makes replacement or an unwanted discard prompt detectable.
  await parent.evaluate(async (data) => {
    const a = (window as any).app;
    await a.loadFile({ path: null, name: "Keep me.kmp", data: new Uint8Array(data) });
    a.doc.change("Existing work", () => { a.doc.kmp.KTPT[0].pos[0] = 77; });
    a.showHome();
  }, [...buildKMP(kmp)]);
  let picked = first;
  await parent.setRequestInterception(true);
  parent.on("request", (q) => {
    if (new URL(q.url()).pathname === "/api/open-dialog") void q.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ path: picked }) });
    else void q.continue();
  });
  const opened = async (path: string) => {
    const target = await browser!.waitForTarget((t) => new URL(t.url() || "about:blank").searchParams.get("open") === path);
    const page = (await target.page())!;
    page.on("pageerror", (e) => errors.push(e.message));
    await page.waitForFunction((path) => (window as any).app?.doc.filePath === path, {}, path);
    return page;
  };
  await parent.evaluate(() => { void (window as any).app.cmd("open"); });
  const a = await opened(first);
  picked = second;
  await parent.evaluate(() => { void (window as any).app.cmd("open"); });
  const b = await opened(second);
  check(await x(parent) === 77 && await parent.evaluate(() => (window as any).app.doc.dirty && (window as any).app.homeVisible), "opening two tracks leaves the launcher's existing work intact");
  await change(a, 100); await change(b, 200);
  await a.evaluate(() => (window as any).app.cmd("undo"));
  check(await x(a) === 0 && await x(b) === 200, "each editor has its own document and Undo history");
  await a.evaluate(() => (window as any).app.cmd("redo"));
  check(await x(a) === 100 && (await a.title()).includes("First track.kmp") && (await b.title()).includes("Second track.kmp"), "Redo and window titles identify the correct track");
  await Promise.all([a.evaluate(() => (window as any).app.save()), b.evaluate(() => (window as any).app.save())]);
  check(diskX(first) === 100 && diskX(second) === 200, "simultaneous saves write to the respective track files");
  const preferences = await a.evaluate(async () => {
    const token = new URLSearchParams(location.search).get("t")!;
    await Promise.all(Array.from({ length: 12 }, (_, i) => fetch('/api/settings', { method: 'POST', headers: { 'x-token': token, 'content-type': 'application/json' }, body: JSON.stringify({ [`windowPreference${i}`]: i }) })));
    const saved = await (await fetch('/api/settings', { headers: { 'x-token': token } })).json();
    return Array.from({ length: 12 }, (_, i) => saved[`windowPreference${i}`] === i).every(Boolean);
  });
  check(preferences, "concurrent preferences from editor windows are merged without losing other changes");
  // A second copy of the same file detects another window's intervening save.
  const oldTarget = a.target();
  await b.evaluate((path) => (window as any).app.openPath(path, { newWindow: true }), first);
  const copyTarget = await browser.waitForTarget((t) => t !== oldTarget && new URL(t.url() || "about:blank").searchParams.get("open") === first);
  const copy = (await copyTarget.page())!;
  copy.on("pageerror", (e) => errors.push(e.message));
  await copy.waitForFunction((path) => (window as any).app?.doc.filePath === path, {}, first);
  await change(a, 150); await a.evaluate(() => (window as any).app.save());
  await change(copy, 999);
  await copy.evaluate(() => { void (window as any).app.save(); });
  await copy.waitForFunction(() => document.querySelector('[role="alertdialog"]')?.textContent?.includes("This track changed on disk"));
  await copy.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find((b) => b.textContent === "Cancel")!.click());
  check(diskX(first) === 150 && await copy.evaluate(() => (window as any).app.doc.dirty), "a stale window cannot silently overwrite another window's saved changes");
  await copy.close(); await a.close(); await parent.close();
  await change(b, 250); await b.evaluate(() => (window as any).app.save());
  check(diskX(second) === 250, "the remaining editor stays usable after Home and another editor close");
  // In-memory drops cross the window boundary without acquiring a path or overwriting the source.
  await b.evaluate(async (data) => { await (window as any).app.loadFiles([{ name: "Dropped.kmp", data: new Uint8Array(data) }], null, { newWindow: true }); }, [...buildKMP(kmp)]);
  const dropTarget = await browser.waitForTarget((t) => !!new URL(t.url() || "about:blank").searchParams.get("document"));
  const drop = (await dropTarget.page())!;
  await drop.waitForFunction(() => (window as any).app?.doc.fileName === "Dropped.kmp");
  check(await drop.evaluate(() => (window as any).app.doc.dirty && !(window as any).app.doc.filePath) && await x(b) === 250, "a dropped track opens independently and requests Save as for its own file");
  await drop.close();
  await b.evaluate(() => { void (window as any).app.cmd("newTrack"); });
  const generatorTarget = await browser.waitForTarget((t) => new URL(t.url() || "about:blank").searchParams.get("new") === "generator");
  const generator = (await generatorTarget.page())!;
  await generator.waitForFunction(() => document.body.textContent?.includes("Three steps: draw the shape"));
  await generator.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent === "Cancel")!.click());
  check(await x(b) === 250, "creating and cancelling a new track never replaces the other editor's track");
  check(errors.length === 0, `no browser errors (${errors.join(", ")})`);
} finally {
  await browser?.close(); worker.terminate();
  if (!resolve(temp).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe test cleanup");
  rmSync(temp, { recursive: true, force: true });
}
