// The default object documentation downloaded from the object-info repository: the answer of GitHub
// is simulated (a newer data/objects.json), then the editor must use it and say so on the Home card;
// with GitHub unreachable the copy shipped with the editor stays in use.
// Usage: bun run tests/object-info.smoke.ts
import puppeteer from "puppeteer-core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_OBJECT_DOCUMENTATION_JSON, OBJECT_INFO_URL } from "../web/js/data/object-documentation.js";

const newer = { version: 1, objects: { itembox: { description: "Downloaded item box text", status: "documented", documented: 100 } } };
const settings = mkdtempSync(join(tmpdir(), "mkwii-object-info-"));
await Bun.write(join(settings, "settings.json"), JSON.stringify({ tourDone: true }));
const worker = new Worker(new URL("../src/server.ts", import.meta.url).href);
const port: number = await new Promise((r) => { worker.onmessage = (e) => e.data?.type === "ready" && r(e.data.port); worker.postMessage({ type: "start", token: "objinfo", settingsDir: settings }); });
const browser = await puppeteer.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const check = (ok: boolean, what: string) => { if (!ok) throw new Error(`Check failed: ${what}`); console.log(`ok  ${what}`); };
try {
  for (const online of [false, true]) {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", (q) => {
      if (q.url() !== OBJECT_INFO_URL) return void q.continue();
      if (online) q.respond({ status: 200, contentType: "text/plain", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(newer) });
      else q.respond({ status: 404, headers: { "Access-Control-Allow-Origin": "*" }, body: "404: Not Found" });
    });
    await page.goto(`http://127.0.0.1:${port}/?t=objinfo`, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => !!(window as any).app?.viewport);
    await new Promise((r) => setTimeout(r, 800));
    const state = await page.evaluate(() => ({
      card: document.querySelector("[data-documentation-source]")?.textContent || "",
      description: (window as any).app.getObjectDocumentation(0x65).description || "",
    }));
    if (online) {
      check(state.card.includes("updated from GitHub"), "the card says the documentation was updated from GitHub");
      check(state.description === "Downloaded item box text", "the downloaded documentation is used");
    } else {
      check(state.card.includes("shipped with the editor"), "offline: the card says the shipped documentation is in use");
      check(state.description.includes("item lottery"), "offline: the shipped documentation is used");
    }
    await page.close();
  }
  // The downloaded copy is kept for the next start, also without GitHub.
  const saved = await Bun.file(join(settings, "settings.json")).json();
  check(saved.objectDocumentationOnline?.json?.objects?.itembox?.description === "Downloaded item box text", "the downloaded copy is kept in the settings");

  // With a documentation of the person's (the shipped one, a changed Goomba and an object of their
  // own), a newer default changes only what they did not touch.
  const shipped = DEFAULT_OBJECT_DOCUMENTATION_JSON.objects as Record<string, any>;
  const mine = { ...shipped, kuribo: { ...shipped.kuribo, description: "My own Goomba notes" }, myObject: { description: "An object of mine" } };
  const update = { version: 1, objects: { ...shipped, itembox: { ...shipped.itembox, description: "Updated item box text" }, kuribo: { ...shipped.kuribo, description: "Updated Goomba text" } } };
  await Bun.write(join(settings, "settings.json"), JSON.stringify({ tourDone: true, customObjectDocumentation: { name: "my-docs.json", objects: mine, base: shipped } }));
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on("request", (q) => q.url() === OBJECT_INFO_URL
    ? q.respond({ status: 200, contentType: "text/plain", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(update) }) : q.continue());
  await page.goto(`http://127.0.0.1:${port}/?t=objinfo`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => !!(window as any).app?.viewport);
  await page.waitForFunction(() => (window as any).app.getObjectDocumentation(0x65).description === "Updated item box text", { timeout: 15000 }).catch(() => {});
  const merged = await page.evaluate(() => {
    const a = (window as any).app;
    return { box: a.getObjectDocumentation(0x65).description, goomba: a.customObjectDocumentation.kuribo?.description, mine: a.customObjectDocumentation.myObject?.description, name: a.customObjectDocumentationName };
  });
  check(merged.box === "Updated item box text", "an entry the person did not change takes the update");
  check(merged.goomba === "My own Goomba notes", "an entry the person changed is kept");
  check(merged.mine === "An object of mine", "an object of the person's is kept");
  check(merged.name === "my-docs.json", "their documentation stays in use");
  await new Promise((r) => setTimeout(r, 500));
  const after = await Bun.file(join(settings, "settings.json")).json();
  check(after.customObjectDocumentation?.base?.itembox?.description === "Updated item box text", "the update becomes the new base, so it is not applied twice");
  await page.close();
} finally {
  await browser.close();
  worker.terminate();
  rmSync(settings, { recursive: true, force: true });
}
