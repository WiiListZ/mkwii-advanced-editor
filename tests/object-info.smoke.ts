// The default object documentation downloaded from the object-info repository: the answer of GitHub
// is simulated (a newer data/objects.json), then the editor must use it and say so on the Home card;
// Manual syncs update the same persisted timestamp, including when the content has not changed;
// failures keep the last successful timestamp and documentation, also after restarting offline.
// Usage: bun run tests/object-info.smoke.ts
import puppeteer, { type HTTPRequest } from "puppeteer-core";
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
    let status = online ? 200 : 404;
    let body = online ? JSON.stringify(newer) : "404: Not Found";
    let hold = false, requests = 0;
    let held: HTTPRequest | null = null;
    await page.setRequestInterception(true);
    page.on("request", (q) => {
      if (q.url() !== OBJECT_INFO_URL) return void q.continue();
      requests++;
      if (hold) { held = q; return; }
      void q.respond({ status, contentType: "text/plain", headers: { "Access-Control-Allow-Origin": "*" }, body });
    });
    await page.goto(`http://127.0.0.1:${port}/?t=objinfo`, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => !!(window as any).app?.viewport);
    await new Promise((r) => setTimeout(r, 800));
    const state = await page.evaluate(() => ({
      card: document.querySelector("[data-documentation-source]")?.textContent || "",
      description: (window as any).app.getObjectDocumentation(0x65).description || "",
      synced: (window as any).app.objectDocumentationUpdated,
      displayedSync: document.querySelector("[data-documentation-sync] time")?.getAttribute("datetime"),
    }));
    if (online) {
      check(state.card.includes("updated from GitHub"), "the card says the documentation was updated from GitHub");
      check(state.description === "Downloaded item box text", "the downloaded documentation is used");
      check(!!state.synced && state.displayedSync === state.synced, "the automatic sync date and time are displayed");

      const button = 'button[aria-label="Sync object documentation from GitHub"]';
      check(await page.$eval(button, (b) => b.textContent?.trim() === "Sync"), "the sync button is labelled Sync");
      hold = true;
      const request = page.waitForRequest((q) => q.url() === OBJECT_INFO_URL);
      await page.click(button);
      await request;
      check(await page.$eval(button, (b) => (b as HTMLButtonElement).disabled && b.textContent?.includes("Syncing")), "the sync button is disabled and shows progress during the download");
      const requestCount = requests;
      await page.evaluate(() => (window as any).app.updateDefaultObjectDocumentation(undefined, true));
      check(requests === requestCount, "a sync already in progress is not duplicated");
      hold = false;
      body = JSON.stringify({ version: 1, objects: { itembox: { description: "Manually synced item box text" } } });
      await held!.respond({ status: 200, contentType: "text/plain", headers: { "Access-Control-Allow-Origin": "*" }, body });
      await page.waitForFunction((previous) => !(window as any).app.objectDocumentationSyncing && (window as any).app.objectDocumentationUpdated !== previous, {}, state.synced);
      check(await page.evaluate(() => (window as any).app.getObjectDocumentation(0x65).description === "Manually synced item box text"), "the button downloads and applies the latest documentation");
      check(await page.evaluate(() => document.body.textContent?.includes("Object documentation synced")), "a manual sync confirms success");
      const manualSync = await page.$eval("[data-documentation-sync] time", (t) => t.getAttribute("datetime"));
      await page.click(button);
      await page.waitForFunction((previous) => !(window as any).app.objectDocumentationSyncing && (window as any).app.objectDocumentationUpdated !== previous, {}, manualSync);
      const latestSync = await page.$eval("[data-documentation-sync] time", (t) => t.getAttribute("datetime"));
      check(latestSync !== manualSync, "a successful sync with unchanged content also updates the date and time");

      for (const failure of [404, 200]) {
        status = failure;
        body = failure === 404 ? "404: Not Found" : JSON.stringify({ version: 2, objects: {} });
        const failed = page.waitForResponse((r) => r.url() === OBJECT_INFO_URL);
        await page.click(button);
        await failed;
        await page.waitForFunction(() => !(window as any).app.objectDocumentationSyncing);
        check(await page.$eval("[data-documentation-sync] time", (t, expected) => t.getAttribute("datetime") === expected, latestSync), `HTTP ${failure}: a failed or invalid download keeps the last successful sync date`);
        check(await page.evaluate(() => (window as any).app.getObjectDocumentation(0x65).description === "Manually synced item box text"), `HTTP ${failure}: the last valid documentation stays in use`);
      }
      check(await page.evaluate(() => document.body.textContent?.includes("Could not sync object documentation")), "a manual sync reports failure");
      await page.evaluate(() => (window as any).app.settingsSave);
    } else {
      check(state.card.includes("shipped with the editor"), "offline: the card says the shipped documentation is in use");
      check(state.description.includes("item lottery"), "offline: the shipped documentation is used");
      check(!state.synced && await page.$eval("[data-documentation-sync]", (el) => el.textContent?.includes("Never")), "before the first successful sync the card says Never");
    }
    await page.close();
  }
  // The downloaded copy is kept for the next start, also without GitHub.
  const saved = await Bun.file(join(settings, "settings.json")).json();
  check(saved.objectDocumentationOnline?.json?.objects?.itembox?.description === "Manually synced item box text", "the downloaded copy is kept in the settings");
  const offline = await browser.newPage();
  await offline.setRequestInterception(true);
  offline.on("request", (q) => q.url() === OBJECT_INFO_URL
    ? q.respond({ status: 404, headers: { "Access-Control-Allow-Origin": "*" }, body: "404: Not Found" }) : q.continue());
  await offline.goto(`http://127.0.0.1:${port}/?t=objinfo`, { waitUntil: "networkidle0" });
  await offline.waitForFunction(() => !!(window as any).app?.viewport && !(window as any).app.objectDocumentationSyncing);
  check(await offline.$eval("[data-documentation-sync] time", (t, expected) => t.getAttribute("datetime") === expected, saved.objectDocumentationOnline.fetched), "restarting offline restores the last successful sync date");
  check(await offline.evaluate(() => (window as any).app.getObjectDocumentation(0x65).description === "Manually synced item box text"), "restarting offline restores the last valid downloaded documentation");
  await offline.close();

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
  check(!!await page.$("[data-documentation-sync] time"), "the sync date stays visible with a custom JSON in use");
  await new Promise((r) => setTimeout(r, 500));
  const after = await Bun.file(join(settings, "settings.json")).json();
  check(after.customObjectDocumentation?.base?.itembox?.description === "Updated item box text", "the update becomes the new base, so it is not applied twice");
  await page.close();
} finally {
  await browser.close();
  worker.terminate();
  rmSync(settings, { recursive: true, force: true });
}
