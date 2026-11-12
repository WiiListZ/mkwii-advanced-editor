// The object documentation editor: it opens as a form, whose edits are the raw JSON's, and the raw
// JSON is coloured and says where it is not valid.
// Usage: bun run tests/object-docs-editor.smoke.ts (MKWII_TEST_BROWSER: a Chromium browser to use)
import puppeteer from "puppeteer-core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const settings = mkdtempSync(join(tmpdir(), "mkwii-doc-editor-"));
await Bun.write(join(settings, "settings.json"), JSON.stringify({ tourDone: true, discordActivity: false }));
const worker = new Worker(new URL("../src/server.ts", import.meta.url).href);
const port: number = await new Promise((r) => { worker.onmessage = (e) => e.data?.type === "ready" && r(e.data.port); worker.postMessage({ type: "start", token: "docs", settingsDir: settings, dolphin: false }); });
const browser = await puppeteer.launch({ executablePath: process.env.MKWII_TEST_BROWSER || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const check = (ok: boolean, what: string) => { if (!ok) throw new Error(`Check failed: ${what}`); console.log(`ok  ${what}`); };
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.setViewport({ width: 1300, height: 900 });
  await page.goto(`http://127.0.0.1:${port}/?t=docs`, { waitUntil: "networkidle0" });
  await page.waitForSelector("[data-documentation-source]");
  await page.click('button[aria-label="Edit JSON…"]');
  await page.waitForSelector("[data-doc-visual]");
  const raw = () => page.$eval('textarea[aria-label="Object documentation JSON"]', (t: any) => t.value as string);
  const status = () => page.$eval("[data-json-check]", (e) => e.textContent || "");
  const tab = (name: string) => page.evaluate((n) => [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) => b.textContent === n)?.click(), name);

  // The form first, on the first object.
  check(await page.$eval('[data-doc-object]', (e) => e.getAttribute("data-doc-object")) === "itembox", "the editor opens as a form, on the first object");
  check(await page.$$eval('[data-doc-setting]', (cards) => cards.map((c) => c.getAttribute('data-doc-setting')).join(',')) === '1,2,3,4,5,6,7,8', "all eight KMP settings are shown in order");
  check(await page.$('select[aria-label="Add a setting"]') === null, "there is no add-setting combobox");
  await page.type('input[aria-label="Find an object"]', "ITEMBOX");
  check(await page.$$eval('[role="option"]', (rows) => rows.length === 1 && rows[0].textContent?.includes("itembox")), "objects are filtered by name regardless of case");
  check(await page.$$eval('[data-doc-setting]', (cards) => cards.length) === 8, "object search leaves all eight settings visible");
  await page.click('input[aria-label="Find an object"]', { clickCount: 3 });
  await page.keyboard.type("no-such-object");
  check(await page.$$eval('[role="option"]', (rows) => rows.length) === 0, "unmatched object searches show no results");
  await page.click('input[aria-label="Find an object"]', { clickCount: 3 });
  await page.keyboard.press("Backspace");
  check(await page.$$eval('[role="option"]', (rows) => rows.length) === 43, "clearing the search restores all objects");
  const toggleFilters = () => page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')].find((b) => b.textContent?.includes("Filters"))?.click());
  const chooseFilter = async (name: string, option: string) => {
    await page.click(`[role="combobox"][aria-label="${name}"]`);
    await page.waitForSelector('[role="option"][data-radix-collection-item]');
    await page.evaluate((text) => [...document.querySelectorAll<HTMLElement>('[role="option"][data-radix-collection-item]')].find((e) => e.textContent === text)?.click(), option);
    await page.waitForFunction(() => !document.querySelector('[role="option"][data-radix-collection-item]'));
  };
  check(await page.$eval('[role="combobox"][aria-label="Filter objects by status"]', (e) => !e.getBoundingClientRect().height), "filters are hidden initially");
  await toggleFilters();
  await chooseFilter("Filter objects by status", "Partially documented");
  check(await page.$$eval('[role="option"]', (rows) => rows.length > 0 && rows.every((row) => row.textContent?.includes("Partially documented"))), "status filters the object list");
  const filteredCount = await page.$$eval('[role="option"]', (rows) => rows.length);
  await toggleFilters();
  check(await page.$eval('[role="combobox"][aria-label="Filter objects by status"]', (e) => !e.getBoundingClientRect().height), "the button hides filters");
  check(await page.$$eval('[role="option"]', (rows) => rows.length) === filteredCount, "hidden filters remain applied");
  await toggleFilters();
  check(await page.$eval('[role="combobox"][aria-label="Filter objects by status"]', (e) => e.textContent) === "Partially documented", "reopening preserves filter choices");
  await chooseFilter("Filter objects by percentage", "100%");
  check(await page.$$eval('[role="option"]', (rows) => rows.length) === 0, "status and percentage filters combine");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === "Reset filters")?.click());
  await chooseFilter("Filter objects by settings documentation", "No settings named");
  check(await page.$$eval('[role="option"]', (rows) => rows.every((row) => !row.textContent?.includes("itembox"))), "settings coverage filters objects with named settings");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === "Reset filters")?.click());
  check(await page.$$eval('[role="option"]', (rows) => rows.length) === 43, "reset restores all objects and filter defaults");
  await chooseFilter("Status", "Worked out from what is filled in");
  check(await page.$eval('[role="combobox"][aria-label="Status"]', (e) => e.textContent) === "Worked out from what is filled in", "the themed status combobox supports automatic status");
  await chooseFilter("Status", "Partially documented");
  // A field of the form is the JSON's.
  await page.click('input[aria-label="Name shown"]');
  await page.keyboard.type("Item Box");
  await page.click('input[aria-label="Choice 2 name"]');
  await page.keyboard.press("End");
  await page.keyboard.type(" (edited)");
  await tab("Raw JSON");
  await page.waitForSelector('textarea[aria-label="Object documentation JSON"]');
  const json = JSON.parse(await raw());
  check(json.objects.itembox.label === "Item Box" && json.objects.itembox.settings["2"].options["1"] === "Banana (edited)", "edits in the form are in the raw JSON");
  check((await status()).startsWith("Valid: 43 objects."), "and still valid");
  // Coloured, and where it is not valid is marked.
  check(await page.$$eval("[data-json-colours] span", (spans) => spans.length > 1000), "the raw JSON is coloured");
  await page.focus('textarea[aria-label="Object documentation JSON"]');
  await page.evaluate(() => { const t = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Object documentation JSON"]')!; t.setSelectionRange(t.value.indexOf('"status"'), t.value.indexOf('"status"')); });
  await page.keyboard.type("oops ");
  await page.waitForSelector("[data-json-error-line]");
  check(/line \d+, column \d+/.test(await status()), "an error says its line and column, and its line is marked");
  // The form cannot show what is not JSON; fixed, it shows it again.
  await tab("Visual");
  await page.waitForSelector("[data-doc-visual-unreadable]");
  check(true, "the form says when the JSON is not valid");
  await tab("Raw JSON");
  await page.waitForSelector('textarea[aria-label="Object documentation JSON"]');
  await page.focus('textarea[aria-label="Object documentation JSON"]');
  await page.evaluate(() => { const t = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Object documentation JSON"]')!; t.setSelectionRange(t.value.indexOf("oops "), t.value.indexOf("oops ") + 5); });
  await page.keyboard.press("Delete");
  await tab("Visual");
  await page.waitForSelector("[data-doc-visual]");
  // Empty slots are shown without adding documentation to the JSON.
  await page.type('input[aria-label="New object name or ID"]', "MyObject");
  await page.keyboard.press("Enter");
  check(await page.$eval('[data-doc-object]', (e) => e.getAttribute("data-doc-object")) === "MyObject", "an added object is the one shown");
  check(await page.$$eval('[data-doc-setting]', (cards) => cards.length) === 8, "new objects also show all eight slots");
  check((await status()).startsWith("Valid: 44 objects."), "untouched empty slots do not invalidate the documentation");
  await page.type('[data-doc-setting="3"] textarea[aria-label="Description"]', "Movement speed");
  check((await status()).includes("MyObject.settings.3.label"), "a setting without a name is not valid");
  await page.type('[data-doc-setting="3"] input[aria-label="Name"]', "Speed");
  check((await status()).startsWith("Valid: 44 objects."), "named, it is");
  await page.click('button[aria-label="Clear setting 3"]');
  check(await page.$eval('[data-doc-setting="3"] input[aria-label="Name"]', (e: any) => e.value) === "", "clearing documentation leaves the empty slot visible");
  check((await status()).startsWith("Valid: 44 objects."), "cleared slots leave valid documentation");
  await page.type('[data-doc-setting="3"] input[aria-label="Name"]', "Speed");
  // Saved: it is the documentation in use.
  await page.keyboard.down("Control"); await page.keyboard.press("s"); await page.keyboard.up("Control");
  await page.waitForFunction(() => !document.querySelector("[data-doc-visual]"));
  const used = await page.evaluate(() => (window as any).app.customObjectDocumentation.MyObject?.settings?.["3"]?.label);
  check(used === "Speed", "Ctrl+S saves it as the documentation in use");
  check(!errors.length, `no page errors ${errors.join(" ")}`);
} finally {
  await browser.close();
  worker.terminate();
  rmSync(settings, { recursive: true, force: true });
}
process.exit(0);
