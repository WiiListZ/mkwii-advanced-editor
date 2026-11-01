// Downloading an update waits for a separate, explicit restart/install action.
// Usage: bun run tests/update-consent.smoke.ts
import puppeteer from 'puppeteer-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const testDir = mkdtempSync(join(tmpdir(), 'mkwii-update-consent-'));
await Bun.write(join(testDir, 'settings.json'), JSON.stringify({ tourDone: true }));
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
try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    const original = window.fetch.bind(window);
    const calls = { check: 0, download: 0, progress: 0, apply: 0, close: 0 };
    (window as any).__updateCalls = calls;
    (window as any).__winctl = async (action: string) => {
      if (action === 'close') calls.close++;
      return { maximized: false };
    };
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input), method = init?.method || 'GET';
      if (url.startsWith('/api/updates') && method === 'GET') {
        calls.check++;
        return Response.json({ supported: true, currentVersion: '1.0.1', available: true, version: '1.0.2',
          title: 'Version 1.0.2', notes: 'Test release notes', url: 'https://example.test/release' });
      }
      if (url.startsWith('/api/updates') && method === 'POST') {
        calls.download++;
        return Response.json({ phase: 'downloading', received: 0, total: 100, error: '' });
      }
      if (url.startsWith('/api/update-progress')) {
        calls.progress++;
        return Response.json({ phase: 'ready', received: 100, total: 100, error: '' });
      }
      if (url.startsWith('/api/update-apply')) {
        calls.apply++;
        return Response.json({ restarting: true });
      }
      return original(input, init);
    }) as typeof fetch;
  });
  const url = `http://127.0.0.1:${port}/?t=smoke`;
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelector('[role="alertdialog"]')?.textContent?.includes('Update to version 1.0.2?'));
  await page.evaluate(() => [...document.querySelectorAll('[role="alertdialog"] button')].find((b) => b.textContent?.trim() === 'Later')?.click());
  await page.waitForFunction(() => !document.querySelector('[role="alertdialog"]'));
  const declined = await page.evaluate(() => ({ ...(window as any).__updateCalls }));
  if (declined.check !== 1 || declined.download || declined.apply || declined.close) throw new Error(`Declining started an update: ${JSON.stringify(declined)}`);

  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelector('[role="alertdialog"]')?.textContent?.includes('Update to version 1.0.2?'));
  await page.evaluate(() => [...document.querySelectorAll('[role="alertdialog"] button')].find((b) => b.textContent?.trim() === 'Download update')?.click());
  await page.waitForFunction(() => document.querySelector('[role="alertdialog"]')?.textContent?.includes('ready to install'));
  const downloaded = await page.evaluate(() => ({ ...(window as any).__updateCalls }));
  if (downloaded.download !== 1 || downloaded.apply || downloaded.close) throw new Error(`Downloading applied or closed automatically: ${JSON.stringify(downloaded)}`);
  await page.evaluate(() => [...document.querySelectorAll('[role="alertdialog"] button')].find((b) => b.textContent?.trim() === 'Later')?.click());
  await page.waitForFunction(() => !document.querySelector('[role="alertdialog"]'));
  const postponed = await page.evaluate(() => ({ ...(window as any).__updateCalls }));
  if (postponed.apply || postponed.close) throw new Error('Postponing a downloaded update restarted the editor');
  await page.evaluate(() => { void (window as any).app.cmd('about'); });
  await page.waitForFunction(() => document.body.innerText.includes('Updates from GitHub Releases'));
  await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent?.trim() === 'Check now')?.click());
  await page.waitForFunction(() => document.querySelector('[role="alertdialog"]')?.textContent?.includes('ready to install'));
  if (!(await page.evaluate(() => (window as any).__updateCalls.download === 1 && (window as any).__updateCalls.apply === 0))) throw new Error('Checking again lost the verified download');
  await page.evaluate(() => [...document.querySelectorAll('[role="alertdialog"] button')].find((b) => b.textContent?.trim() === 'Later')?.click());
  await page.waitForFunction(() => !document.querySelector('[role="alertdialog"]'));
  await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent?.trim() === 'Restart & install update')?.click());
  await page.waitForFunction(() => (window as any).__updateCalls.apply === 1 && (window as any).__updateCalls.close === 1, { timeout: 10000 });
  const accepted = await page.evaluate(() => ({ ...(window as any).__updateCalls }));
  if (accepted.download !== 1 || accepted.progress < 1) throw new Error(`Accepting did not download and apply: ${JSON.stringify(accepted)}`);
  console.log({ declined, downloaded, postponed, accepted });
} finally {
  await browser.close();
  worker.terminate();
  rmSync(testDir, { recursive: true, force: true });
}
