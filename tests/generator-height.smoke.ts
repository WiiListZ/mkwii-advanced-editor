// Native controls, vertical dragging, Undo/Redo and the height in the generated BRRES.
// bun run build && bun tests/generator-height.smoke.ts
import puppeteer from 'puppeteer-core';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { PRESETS } from '../web/js/editor/trackgen.js';
import { parseBRRES } from '../web/js/formats/brres.js';

const temp = await mkdtemp(join(tmpdir(), 'mkwii-generator-height-'));
await writeFile(join(temp, 'settings.json'), JSON.stringify({ tourDone: true, discordActivity: false, tracksMovedNoticeSeen: true, ...(process.env.MKWII_PREVIEW_GAME ? { workspace: process.env.MKWII_PREVIEW_GAME } : {}) }));
const reservation = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('') }), port = reservation.port; reservation.stop(true);
const child = Bun.spawn([resolve(process.env.MKWII_TEST_EXE || 'release/MKWiiAdvancedEditor.exe')], {
  env: { ...process.env, MKWII_SETTINGS_DIR: temp, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` }, stdout: 'ignore', stderr: 'inherit', windowsHide: true,
});
let browser: any;
const check = (ok: boolean, text: string) => { if (!ok) throw Error(text); console.log('ok: ' + text); };
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch {}
    if (i === 150) throw Error('Native debugger unavailable'); await Bun.sleep(100);
  }
  browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` }); let page: any;
  for (let i = 0; ; i++) {
    page = (await browser.pages()).find((p: any) => p.url().startsWith('http://127.0.0.1:'));
    if (page) break; if (i === 100) throw Error('Native page missing'); await Bun.sleep(100);
  }
  const errors: string[] = []; page.on('pageerror', (e: Error) => errors.push(e.message));
  await page.setViewport({ width: 1400, height: 1000 });
  await page.waitForFunction(() => !!(window as any).app); await page.evaluate(() => { void (window as any).app.cmd('newTrack'); });
  const field = '[aria-label="Selected road point height"]';
  await page.waitForSelector(field); await page.click('[aria-label="Edit road height"]');
  await page.click('[role="tab"][id$="-trigger-textures"]');
  await page.click(field); await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control'); await page.keyboard.type('1500'); await page.keyboard.press('Tab');
  check(await page.$eval(field, (e: HTMLInputElement) => e.value) === '1500', 'exact height can be edited above the road while the Textures tab is open');
  const profileBefore = await page.$eval('[aria-label="Height profile"]', (e: HTMLCanvasElement) => e.toDataURL());
  const pts = PRESETS.Oval(), xs = pts.map((p: any) => p.x), zs = pts.map((p: any) => p.z);
  const scale = Math.min((640 - 140) / (Math.max(...xs) - Math.min(...xs)), (430 - 140) / (Math.max(...zs) - Math.min(...zs)));
  const sx = 320 + pts[0].x * scale, sy = 215 + pts[0].z * scale;
  const box = await (await page.$('[data-testid="generator-canvas"]')).boundingBox();
  const x = box.x + sx / 640 * box.width, y = box.y + sy / 430 * box.height;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y - 20 * box.height / 430, { steps: 8 }); await page.mouse.up();
  await page.waitForFunction(() => (document.querySelector('[aria-label="Selected road point height"]') as HTMLInputElement)?.value === '2500');
  check(await page.$eval(field, (e: HTMLInputElement) => e.value) === '2500', 'dragging a road point upward changes its height');
  check(await page.$eval('[data-testid="generator-canvas"]', (c: HTMLCanvasElement, p: number[]) => { const d = c.getContext('2d')!.getImageData(Math.round(p[0]), Math.round(p[1]), 1, 1).data; return d[0] > 240 && d[1] > 180 && d[2] < 50; }, [sx, sy]), 'height dragging keeps the point at the same plan coordinates');
  check(await page.$eval('[aria-label="Height profile"]', (e: HTMLCanvasElement) => e.toDataURL()) !== profileBefore, 'the elevation profile follows the edited height');
  await page.click('[role="toolbar"] [aria-label="Undo"]');
  check(await page.$eval(field, (e: HTMLInputElement) => e.value) === '1500', 'one Undo restores the whole height drag');
  await page.click('[role="toolbar"] [aria-label="Redo"]');
  await page.waitForFunction(() => (document.querySelector('[aria-label="Selected road point height"]') as HTMLInputElement)?.value === '2500');
  check(await page.$eval(field, (e: HTMLInputElement) => e.value) === '2500', 'Redo restores the height drag');
  await page.mouse.move(x, y); await page.keyboard.down('Shift'); await page.mouse.down(); await page.mouse.move(x, y + 20 * box.height / 430, { steps: 8 }); await page.mouse.up(); await page.keyboard.up('Shift');
  await page.waitForFunction(() => (document.querySelector('[aria-label="Selected road point height"]') as HTMLInputElement)?.value === '2300');
  check(true, 'Shift-drag lowers the road with finer control');
  await page.click('[role="toolbar"] [aria-label="Undo"]');
  await page.waitForFunction(() => (document.querySelector('[aria-label="Selected road point height"]') as HTMLInputElement)?.value === '2500');
  await page.keyboard.press('ArrowUp');
  await page.waitForFunction(() => (document.querySelector('[aria-label="Selected road point height"]') as HTMLInputElement)?.value === '2600');
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => (document.querySelector('[aria-label="Selected road point height"]') as HTMLInputElement)?.value === '2500');
  check(true, 'keyboard arrows raise and lower the selected road point');
  await page.click('[aria-label="Lower selected road point"]'); await page.click('[aria-label="Raise selected road point"]');
  check(await page.$eval(field, (e: HTMLInputElement) => e.value) === '2500', 'the step buttons lower and raise the selected road point');
  await page.click('[aria-label="Road control point"]'); await page.click('[role="option"][data-state="unchecked"]');
  check(await page.$eval(field, (e: HTMLInputElement) => e.value) === '0', 'another road point keeps its own height');
  await page.click('[aria-label="Road control point"]');
  await page.evaluate(() => { ([...document.querySelectorAll('[role="option"]')].find((e) => e.textContent === 'Point 0 (start)') as HTMLElement).click(); });
  check(await page.$eval(field, (e: HTMLInputElement) => e.value) === '2500', 'switching back preserves the edited point height');
  await page.screenshot({ path: '.cache/generator-height-controls.png' });
  await page.click('[aria-label="Show 3D preview"]');
  const preview = '[aria-label="3D track preview"]';
  await page.waitForSelector(preview);
  if (process.env.MKWII_PREVIEW_GAME) await page.waitForSelector('[aria-label="Road texture preview"][data-texture-source="game"]');
  await page.waitForFunction(() => {
    const c = document.querySelector<HTMLCanvasElement>('[aria-label="3D track preview"]')!, gl = c?.getContext('webgl2'); if (!gl) return false;
    const d = new Uint8Array(c.width * c.height * 4); gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, d);
    let coloured = 0; for (let i = 0; i < d.length; i += 4) if (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 20) coloured++;
    return coloured > 1000;
  });
  check(true, 'the generator renders the textured track in an embedded 3D view');
  await page.screenshot({ path: '.cache/generator-3d-initial.png' });
  const image = () => page.$eval(preview, (e: HTMLCanvasElement) => e.toDataURL());
  const settle = () => page.evaluate(() => new Promise<void>((done) => { let n = 0; const tick = () => ++n >= 70 ? done() : requestAnimationFrame(tick); requestAnimationFrame(tick); }));
  const initial3D = await image(), bounds3D = await (await page.$(preview)).boundingBox();
  await page.mouse.move(bounds3D.x + bounds3D.width / 2, bounds3D.y + bounds3D.height / 2); await page.mouse.down();
  await page.mouse.move(bounds3D.x + bounds3D.width / 2 + 90, bounds3D.y + bounds3D.height / 2 + 25, { steps: 10 }); await page.mouse.up();
  await settle(); const orbited = await image(); check(orbited !== initial3D, 'dragging orbits the 3D camera');
  const setHeight = async (value: string) => { await page.click(field); await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control'); await page.keyboard.type(value); await page.keyboard.press('Tab'); await settle(); };
  await setHeight('3500'); check(await image() !== orbited, 'height changes update the 3D road immediately');
  await setHeight('2500');
  const difference = await page.evaluate(async (before: string) => {
    const c = document.querySelector<HTMLCanvasElement>('[aria-label="3D track preview"]')!;
    const read = async (url: string) => { const image = new Image(); image.src = url; await image.decode(); const copy = document.createElement('canvas'); copy.width = c.width; copy.height = c.height; const g = copy.getContext('2d')!; g.drawImage(image, 0, 0); return g.getImageData(0, 0, c.width, c.height).data; };
    const a = await read(before), b = await read(c.toDataURL()); let total = 0; for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]); return total / a.length;
  }, orbited);
  check(difference < 1, 'restoring the height restores the mesh without resetting the orbit camera (mean pixel difference ' + difference.toFixed(3) + ')');
  const marker = await page.$eval(preview, (c: HTMLCanvasElement) => {
    const gl = c.getContext('webgl2')!, d = new Uint8Array(c.width * c.height * 4); gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, d);
    for (let y = 5; y < c.height - 5; y++) for (let x = 5; x < c.width - 5; x++) {
      const p = (y * c.width + x) * 4;
      if (Math.abs(d[p] - 96) < 3 && Math.abs(d[p + 1] - 165) < 3 && Math.abs(d[p + 2] - 250) < 3) {
        // A second pixel below the same colour avoids choosing the antialiased edge of a dot.
        const q = ((y + 2) * c.width + x) * 4; if (Math.abs(d[q] - 96) < 3 && Math.abs(d[q + 2] - 250) < 3) return { x: x / c.width, y: 1 - (y + 1) / c.height };
      }
    }
    return null;
  });
  check(!!marker, '3D control points remain visible and large enough to select');
  await page.mouse.click(bounds3D.x + marker.x * bounds3D.width, bounds3D.y + marker.y * bounds3D.height);
  await page.waitForFunction(() => !document.querySelector('[aria-label="Road control point"]')?.textContent?.includes('Point 0 (start)'));
  check(true, 'clicking a 3D point selects it for height editing');
  await page.click('[aria-label="Road control point"]'); await page.evaluate(() => { ([...document.querySelectorAll('[role="option"]')].find((e) => e.textContent === 'Point 0 (start)') as HTMLElement).click(); });
  await settle(); await page.screenshot({ path: '.cache/generator-3d-preview.png' });
  await page.setViewport({ width: 1200, height: 900 });
  await page.waitForFunction(() => {
    const c = document.querySelector<HTMLCanvasElement>('[aria-label="3D track preview"]')!, rect = c.getBoundingClientRect();
    return c.width > 100 && Math.abs(c.width - rect.width * Math.min(devicePixelRatio, 2)) < 2;
  });
  check(true, 'the embedded 3D canvas follows the resized window');
  await page.setViewport({ width: 1400, height: 1000 });
  if (process.env.MKWII_PREVIEW_GAME) { await settle(); const a = await image(); await settle(); check(await image() !== a, 'the original game boost material animates in the 3D preview'); }
  await page.click('[aria-label="Edit road height"]');
  await page.waitForSelector('[data-testid="generator-canvas"]');
  check(await page.$eval(field, (e: HTMLInputElement) => e.value) === '2500', 'the Height tool returns to the 2D drawing without losing the edited track');
  await page.evaluate(() => { ([...document.querySelectorAll('button')].find((e) => e.textContent?.trim() === 'Generate track') as HTMLElement).click(); });
  let editor: any;
  for (let i = 0; ; i++) {
    for (const p of await browser.pages()) {
      if (p !== page && p.url().startsWith('http://127.0.0.1:') && await p.evaluate(() => (window as any).app?.doc.fileName === 'New Track.szs' && (window as any).app.viewport?.hasCourseModel).catch(() => false)) { editor = p; break; }
    }
    if (editor) break; if (i === 900) throw Error('Generated editor unavailable'); await Bun.sleep(100);
  }
  const bytes = await editor.evaluate(() => {
    const find = (n: any): any => n.name === 'course_model.brres' ? n : n.children?.map(find).find(Boolean);
    return Array.from(find((window as any).app.doc.szs).data);
  });
  const course = parseBRRES(Uint8Array.from(bytes));
  const heights = course.models[0].objects.filter((o: any) => /^road(?:_part\d+)?$/.test(o.name)).flatMap((o: any) => Array.from(o.positions).filter((_: any, i: number) => i % 3 === 1));
  check(heights.length > 100 && Math.max(...heights) >= 2450, 'the generated track model contains the edited road height');
  check(!errors.length, 'the generator produces no browser errors');
} finally {
  // Close only the windows started with this test's isolated settings directory.
  if (browser) {
    for (const page of await browser.pages()) await page.evaluate(() => { if ((window as any).__winctl) void (window as any).__winctl('close'); }).catch(() => {});
    browser.disconnect();
  }
  child.kill(); await child.exited;
  if (!resolve(temp).startsWith(resolve(tmpdir()) + sep)) throw Error('Unsafe cleanup');
  for (let i = 0; ; i++) {
    try { await rm(temp, { recursive: true, force: true }); break; }
    catch (e: any) { if (i === 120 || !['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(e.code)) throw e; await Bun.sleep(250); }
  }
}
