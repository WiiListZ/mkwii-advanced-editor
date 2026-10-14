// Right-drag look with the hidden cursor must keep turning without limit, also when the drag starts
// near the screen edge: the desktop window puts the cursor back at the 3D view's centre.
// The native SetCursorPos is simulated by moving the mouse where the editor asked.
// Usage: bun run tests/mouse-look.smoke.ts
import puppeteer from 'puppeteer-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const testDir = mkdtempSync(join(tmpdir(), 'mkwii-mouse-look-'));
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
  await page.setViewport({ width: 1200, height: 800 });
  await page.evaluateOnNewDocument(() => {
    (window as any).__recenters = [];
    (window as any).__winctl = async (action: string, arg?: string) => {
      if (action === 'cursor-recenter') (window as any).__recenters.push(arg);
      return { maximized: false };
    };
  });
  await page.goto(`http://127.0.0.1:${port}/?t=smoke`, { waitUntil: 'networkidle0' });
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const clickButton = (text: string) => page.evaluate((t) => { ([...document.querySelectorAll('[role=dialog] button, [role=alertdialog] button')].find((b) => b.textContent?.includes(t)) as HTMLElement)?.click(); }, text);
  // A generated track, as in ui.smoke.ts.
  await page.evaluate(() => { (window as any).app.cmd('newTrack'); });
  await wait(500);
  await clickButton('Generate track');
  await wait(1500);
  await clickButton('Start editing');
  await wait(500);
  await page.evaluate(() => (window as any).app.setSetting('hideCursorWhileLooking', true));
  const rect = await page.evaluate(() => {
    const r = (window as any).app.viewport.canvas.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
  const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  // The "screen edge": the cursor cannot go further right than this.
  const edge = rect.left + rect.width - 4;
  const yaw = () => page.evaluate(() => {
    const vp = (window as any).app.viewport;
    const d = vp.controls.target.clone().sub(vp.camera.position);
    return Math.atan2(d.x, d.z);
  });
  let x = edge - 10;
  const y = center.y;
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'right' });
  if (!(await page.evaluate(() => (window as any).app.viewport.rmbDown))) throw new Error('Right button did not start looking');
  let turned = 0, last = await yaw(), handled = 0;
  for (let i = 0; i < 120; i++) {
    const recenters = await page.evaluate(() => (window as any).__recenters.length);
    if (recenters > handled) {
      // SetCursorPos: the cursor jumps to the saved position plus the requested offset.
      handled = recenters;
      x = center.x;
      await page.mouse.move(x, y);
    }
    x = Math.min(edge, x + 40);
    await page.mouse.move(x, y);
    const now = await yaw();
    let step = now - last;
    if (step > Math.PI) step -= 2 * Math.PI;
    if (step < -Math.PI) step += 2 * Math.PI;
    turned += Math.abs(step);
    last = now;
  }
  await page.mouse.up({ button: 'right' });
  const result = { turned: +turned.toFixed(2), recenters: handled };
  console.log(result);
  if (turned < 2 * Math.PI) throw new Error(`Mouse look stopped turning near the screen edge: ${JSON.stringify(result)}`);
} finally {
  await browser.close();
  worker.terminate();
  rmSync(testDir, { recursive: true, force: true });
}
