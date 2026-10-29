// Release notes render as Markdown in a modal: once at the first start after an in-app update,
// and from the update banner. Usage: bun run tests/release-notes.smoke.ts [screenshot folder]
import puppeteer from 'puppeteer-core';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import packageJson from '../package.json' with { type: 'json' };

const NOTES = [
  '## Intro cameras',
  '',
  '- **Keyframe timeline under the 3D view.** Press **K** to add a keyframe.',
  '- **Shortcuts:**',
  '  - **Space** plays the intro',
  '  - `,` and `.` jump between keyframes',
  '',
  '### Fixes',
  '',
  '1. Texture animations move the right way (#1).',
  '2. Models keep their textures.',
  '',
  '**Full Changelog**: https://github.com/WiiListZ/mkwii-advanced-editor/compare/v1.0.1...v1.0.2',
].join('\n');
const shots = process.argv[2];
if (shots) mkdirSync(shots, { recursive: true });

const testDir = mkdtempSync(join(tmpdir(), 'mkwii-release-notes-'));
mkdirSync(join(testDir, 'updates'));
const record = join(testDir, 'updates', 'installed-release.json');
await Bun.write(join(testDir, 'settings.json'), JSON.stringify({ tourDone: true }));
await Bun.write(record, JSON.stringify({ version: packageJson.version, title: `v${packageJson.version}`, notes: NOTES,
  url: `https://github.com/WiiListZ/mkwii-advanced-editor/releases/tag/v${packageJson.version}`, shown: false }));
const worker = new Worker(new URL('../src/server.ts', import.meta.url).href);
const port: number = await new Promise((resolve) => {
  worker.onmessage = (event) => event.data?.type === 'ready' && resolve(event.data.port);
  worker.postMessage({ type: 'start', token: 'smoke', settingsDir: testDir });
});
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const url = `http://127.0.0.1:${port}/?t=smoke`;
const dialogText = () => document.querySelector('[role="dialog"]')?.textContent || '';
try {
  // 1. First start after the update: the notes open by themselves, rendered.
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForFunction((version) => document.querySelector('[role="dialog"]')?.textContent?.includes(`What's new in version ${version}`), {}, packageJson.version);
  const rendered = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]')!;
    return { h2: dialog.querySelectorAll('h2').length, h3: dialog.querySelectorAll('h3').length, nested: dialog.querySelectorAll('ul ul li').length,
      ol: dialog.querySelectorAll('ol li').length, strong: dialog.querySelectorAll('strong').length, code: dialog.querySelectorAll('code').length,
      links: [...dialog.querySelectorAll('a')].map((a) => a.getAttribute('href')), raw: dialog.textContent!.includes('**') || dialog.textContent!.includes('## ') };
  });
  if (rendered.h2 < 1 || rendered.h3 !== 1 || rendered.nested !== 2 || rendered.ol !== 2 || rendered.strong < 4 || rendered.code !== 2 || rendered.raw || rendered.links.length !== 2)
    throw new Error(`Markdown not rendered: ${JSON.stringify(rendered)}`);
  if (shots) await page.screenshot({ path: join(shots, 'after-update.png') });
  await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent?.trim() === 'Close')?.click());
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  await Bun.sleep(300);
  if (!JSON.parse(readFileSync(record, 'utf8')).shown) throw new Error('Closing the notes did not mark them as read');

  // 2. Next start: the notes stay closed.
  await page.reload({ waitUntil: 'networkidle0' });
  await Bun.sleep(1500);
  if (await page.evaluate(dialogText)) throw new Error('The notes opened again after they were read');

  // 3. An available update: its notes are rendered in the offer and open from Help › About,
  // which also keeps the notes of the installed version.
  const offer = await browser.newPage();
  await offer.setViewport({ width: 1280, height: 800 });
  await offer.evaluateOnNewDocument((notes) => {
    const original = window.fetch.bind(window);
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith('/api/updates') && (init?.method || 'GET') === 'GET')
        return Response.json({ supported: true, currentVersion: '1.0.1', available: true, version: '9.9.9', title: 'v9.9.9', notes,
          url: 'https://github.com/WiiListZ/mkwii-advanced-editor/releases/tag/v9.9.9' });
      return original(input, init);
    }) as typeof fetch;
  }, NOTES);
  await offer.goto(url, { waitUntil: 'networkidle0' });
  await offer.waitForFunction(() => document.querySelector('[role="alertdialog"]')?.textContent?.includes('Update to version 9.9.9?'));
  const offerRendered = await offer.evaluate(() => document.querySelectorAll('[role="alertdialog"] li').length);
  if (offerRendered < 4) throw new Error(`Update offer notes not rendered (${offerRendered} list items)`);
  if (shots) await offer.screenshot({ path: join(shots, 'update-offer.png') });
  await offer.evaluate(() => [...document.querySelectorAll('[role="alertdialog"] button')].find((b) => b.textContent?.trim() === 'Later')?.click());
  await offer.waitForFunction(() => !document.querySelector('[role="alertdialog"]'));
  const clickText = async (selector: string, text: string) => {
    const handle = await offer.waitForFunction((s, t) => [...document.querySelectorAll(s)].find((e) => e.textContent?.trim() === t), {}, selector, text);
    await (handle as any).click();
  };
  const dialogWith = (text: string) => offer.waitForFunction((t) => [...document.querySelectorAll('[role="dialog"]')].some((d) => d.textContent?.includes(t)), {}, text);
  await clickText('button[role="menuitem"], [role="menubar"] button', 'Help');
  await clickText('[role="menuitem"]', 'About');
  await dialogWith('Updates from GitHub Releases');
  if (!(await offer.evaluate((v) => [...document.querySelectorAll('[role="dialog"] button')].some((b) => b.textContent?.trim() === `What's new in ${v}`), packageJson.version)))
    throw new Error('About does not offer the notes of the installed version');
  await clickText('[role="dialog"] button', 'Release notes');
  await dialogWith("What's new in version 9.9.9");
  if (shots) await offer.screenshot({ path: join(shots, 'about-notes.png') });
  // Closing the notes returns to About.
  await offer.keyboard.press('Escape');
  await offer.waitForFunction(() => ![...document.querySelectorAll('[role="dialog"]')].some((d) => d.textContent?.includes("What's new in version")));
  await dialogWith('Updates from GitHub Releases');
  console.log({ rendered, offerListItems: offerRendered });
} finally {
  await browser.close();
  worker.terminate();
  rmSync(testDir, { recursive: true, force: true });
}
