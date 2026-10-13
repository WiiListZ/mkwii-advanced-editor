// Refresh the README's Riivolution editor screenshots from real game files.
// Usage: MKWII_GAME_DIR=<extracted game files> bun run scripts/capture-riivolution.ts
import puppeteer from "puppeteer-core";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

const game = process.env.MKWII_GAME_DIR;
if (!game || !existsSync(join(game, "Race", "Common.szs"))) throw new Error("Set MKWII_GAME_DIR to the extracted game's files directory");
const temp = mkdtempSync(join(tmpdir(), "mkwii-riivo-shots-"));
const files = join(temp, "files"), sd = join(temp, "sd");
// A workspace where the editor saved a few files (each keeps a .bak of the original).
for (const rel of ["Race/Common.szs", "Race/Course/beginner_course.szs", "Race/Course/beginner_course_d.szs", "Race/Kart/mdf_kart-mr.szs", "Scene/UI/Font.szs"]) {
  const to = join(files, ...rel.split("/"));
  mkdirSync(join(to, ".."), { recursive: true });
  copyFileSync(join(game, ...rel.split("/")), to);
  if (rel !== "Race/Common.szs") copyFileSync(to, to + ".bak");
}
// A pack with several options, as an existing Riivolution XML on an SD card.
const xml = join(sd, "riivolution", "KartPack.xml");
mkdirSync(join(sd, "riivolution"), { recursive: true });
await Bun.write(xml, `<?xml version="1.0" encoding="UTF-8"?>
<wiidisc version="1">
\t<id game="RMC"><region type="P" /><region type="E" /></id>
\t<options>
\t\t<section name="Kart Pack">
\t\t\t<option name="Red item boxes" id="redBoxes" default="1">
\t\t\t\t<choice name="Enabled"><patch id="boxes" /></choice>
\t\t\t</option>
\t\t\t<option name="Mario's kart" id="kart">
\t\t\t\t<choice name="Gold"><patch id="kartGold" /></choice>
\t\t\t\t<choice name="Silver"><patch id="kartSilver" /></choice>
\t\t\t</option>
\t\t\t<option name="Skip the opening movie" id="intro">
\t\t\t\t<choice name="Enabled"><patch id="skipIntro" /></choice>
\t\t\t</option>
\t\t</section>
\t</options>
\t<patch id="boxes" root="/KartPack">
\t\t<file disc="/Race/Course/beginner_course.szs" external="Race/Course/beginner_course.szs" />
\t\t<file disc="/Race/Course/beginner_course_d.szs" external="Race/Course/beginner_course_d.szs" />
\t</patch>
\t<patch id="kartGold" root="/KartPack/Gold"><folder disc="/Race/Kart" external="Race/Kart" /></patch>
\t<patch id="kartSilver" root="/KartPack/Silver"><folder disc="/Race/Kart" external="Race/Kart" /></patch>
\t<patch id="skipIntro"><memory offset="0x80001234" value="38600001" original="38600000" /></patch>
</wiidisc>
`);
const settings = mkdtempSync(join(tmpdir(), "mkwii-riivo-shots-settings-"));
await Bun.write(join(settings, "settings.json"), JSON.stringify({ tourDone: true, workspace: files }));
const worker = new Worker(new URL("../src/server.ts", import.meta.url).href);
let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
try {
  const port: number = await new Promise((resolve) => {
    worker.onmessage = (event) => event.data?.type === "ready" && resolve(event.data.port);
    worker.postMessage({ type: "start", token: "shots", settingsDir: settings });
  });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 950, deviceScaleFactor: 1 });
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/open-dialog") return r.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ path: xml }) });
    r.continue();
  });
  await page.goto(`http://127.0.0.1:${port}/?t=shots`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => !!(window as any).app?.viewport);
  const set = (selector: string, value: string) => page.evaluate((s, v) => {
    const input = document.querySelector<HTMLInputElement>(s)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, v);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, selector, value);
  // Let animations finish and drop the focus ring of the button focused on opening.
  const settle = async () => { await new Promise((r) => setTimeout(r, 700)); await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); };

  // 1. A new mod made from the files edited in the workspace, with a Dolphin launcher.
  await page.evaluate(() => { void (window as any).app.cmd("riivolution"); });
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLInputElement>('[role="dialog"] input')].filter((i) => i.value.startsWith("/Race") || i.value.startsWith("/Scene")).length === 4, { timeout: 30000 });
  await set('[role="dialog"] input', "Red Item Box");
  await page.click('button[aria-label="Choose Riivolution regions"]');
  await page.evaluate(() => document.querySelector<HTMLInputElement>('input[aria-label="Europe (PAL) region"]')?.click());
  await page.click('button[aria-label="Choose Riivolution regions"]');
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button[role="switch"]')].pop()!.click());
  await page.waitForFunction(() => !!document.querySelector('[role="dialog"] input[placeholder^="Game image"]'));
  await set('[role="dialog"] input[placeholder^="Game image"]', "D:/Games/Mario Kart Wii (Europe).wbfs");
  await settle();
  await page.screenshot({ path: "docs/images/riivolution.png" });

  // 2. An existing pack: several options and choices, folders and a memory patch.
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent?.includes("Open XML"))!.click());
  await page.waitForFunction(() => document.body.innerText.includes("Opened KartPack.xml"), { timeout: 30000 });
  await page.evaluate(() => document.querySelectorAll("[data-sonner-toaster]").forEach((t) => ((t as HTMLElement).style.display = "none")));
  // Show the patch of one of the two choices of "Mario's kart" (a whole folder).
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="Patch"]')!.click());
  await page.waitForSelector('[role="option"]');
  await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((o) => o.textContent?.startsWith("kartGold"))!.click());
  await settle();
  await page.screenshot({ path: "docs/images/riivolution-xml.png" });
  console.log("Saved docs/images/riivolution.png and docs/images/riivolution-xml.png");
} finally {
  await browser?.close();
  worker.terminate();
  for (const dir of [settings, temp]) {
    const target = resolve(dir);
    if (!target.startsWith(resolve(tmpdir()) + sep)) throw new Error("Temporary screenshot path is outside the temp directory");
    rmSync(target, { recursive: true, force: true });
  }
}
