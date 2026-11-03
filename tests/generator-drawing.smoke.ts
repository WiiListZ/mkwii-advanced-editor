// Native freehand fidelity, actual map dimensions, view size and Undo/Redo.
import puppeteer from 'puppeteer-core';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
const temp = await mkdtemp(join(tmpdir(), 'mkwii-generator-drawing-'));
await writeFile(join(temp, 'settings.json'), JSON.stringify({ tourDone: true, discordActivity: false, tracksMovedNoticeSeen: true }));
const reservation = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('') }), port = reservation.port; reservation.stop(true);
const child = Bun.spawn([resolve(process.env.MKWII_TEST_EXE || 'release/MKWiiAdvancedEditor.exe')], {
  env: { ...process.env, MKWII_SETTINGS_DIR: temp, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` }, stdout: 'ignore', stderr: 'inherit', windowsHide: true,
});
let browser: any;
const check = (ok: boolean, text: string) => { if (!ok) throw Error(text); console.log('ok: ' + text); };
try {
  for (let i = 0; ; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch {} if (i === 150) throw Error('Native debugger unavailable'); await Bun.sleep(100); }
  browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` }); let page: any;
  for (let i = 0; ; i++) { page = (await browser.pages()).find((p: any) => p.url().startsWith('http://127.0.0.1:')); if (page) break; if (i === 150) throw Error('Native page unavailable'); await Bun.sleep(100); }
  const errors: string[] = []; page.on('pageerror', (e: Error) => errors.push(e.message));
  await page.setViewport({ width: 1400, height: 1050 }); await page.waitForFunction(() => !!(window as any).app);
  await page.evaluate(() => { void (window as any).app.cmd('newTrack'); }); await page.waitForSelector('[aria-label="Track map width"]');
  await page.$eval('[role="dialog"]', async (el: HTMLElement) => { await Promise.all(el.getAnimations().map((a) => a.finished.catch(() => {}))); });
  await page.evaluate(() => document.fonts.ready);
  const settle = () => page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  const value = (label: string) => page.$eval(`[aria-label="${label}"]`, (e: HTMLInputElement) => Number(e.value));
  const enter = async (label: string, text: string) => { await page.click(`[aria-label="${label}"]`); await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control'); await page.keyboard.type(text); await page.keyboard.press('Tab'); await settle(); };
  const tool = (text: string) => page.evaluate((text: string) => { ([...document.querySelectorAll('[role="toolbar"] button')].find((e) => e.textContent?.trim() === text) as HTMLElement).click(); }, text);
  const dimensionsBox = await (await page.$('[data-map-size]')).boundingBox(), canvasBox = await (await page.$('[data-testid="generator-canvas"]')).boundingBox();
  check(dimensionsBox.y + dimensionsBox.height <= canvasBox.y && Math.abs(dimensionsBox.x - canvasBox.x) < 5, 'Track dimensions is above the preview in the left column');
  await page.click('[role="tab"][id$="-trigger-road"]');
  check(await page.$eval('[aria-label="Automatic bridges"]', (e: HTMLElement) => e.getAttribute('aria-checked')) === 'false', 'automatic bridges are off by default');
  await page.click('[aria-label="Automatic bridges"]'); await page.click('[aria-label="Undo"]');
  await page.waitForFunction(() => document.querySelector('[aria-label="Automatic bridges"]')?.getAttribute('aria-checked') === 'false');
  check(true, 'automatic bridge changes can be undone');
  await page.click('[role="tab"][id$="-trigger-layout"]');
  check(await page.evaluate(() => {
    const fields = ['Selected road point width', 'Selected curve radius'];
    return fields.every(label => {
      const matches = document.querySelectorAll(`[aria-label="${label}"]`);
      return matches.length === 1 && !!matches[0].closest('[data-selected-point]') && !matches[0].closest('[data-height-controls]');
    });
  }), 'local width and curve radius appear only in Selected point');
  check(await value('Track map width') === 44000 && await value('Track map depth') === 26000, 'map fields show the current world-space layout dimensions');
  await page.click('[aria-label="Road control point"]');
  await page.evaluate(() => { ([...document.querySelectorAll('[role="option"]')].find(e => e.textContent === 'Point 2') as HTMLElement).click(); });
  const radiusSlider = await (await page.$('[aria-label="Curve radius"]')).boundingBox();
  await page.mouse.move(radiusSlider.x + 8, radiusSlider.y + radiusSlider.height / 2); await page.mouse.down();
  await page.mouse.move(radiusSlider.x + radiusSlider.width * .55, radiusSlider.y + radiusSlider.height / 2, { steps: 8 }); await page.mouse.up(); await settle();
  const draggedRadius = await value('Selected curve radius');
  check(draggedRadius > 0 && draggedRadius < 10000, 'radius slider updates the numeric value over the useful range of this bend');
  await page.click('[aria-label="Undo"]'); await settle(); check(await value('Selected curve radius') === 0, 'one Undo restores the entire radius slider drag');
  await page.click('[aria-label="Redo"]'); await settle(); check(await value('Selected curve radius') === draggedRadius, 'Redo restores the radius slider drag');
  await page.focus('[aria-label="Curve radius"] [role="slider"]'); await page.keyboard.press('ArrowRight'); await settle();
  check(await value('Selected curve radius') === draggedRadius + 100, 'radius slider supports keyboard adjustments');
  await page.click('[aria-label="Undo"]'); await settle(); check(await value('Selected curve radius') === draggedRadius, 'keyboard radius changes can be undone');
  await enter('Selected curve radius', '0');
  await enter('Selected curve radius', '5000');
  check(await page.$eval('[data-curve-radius-status]', (e: HTMLElement) => e.textContent?.includes('Applied: 5000')), 'selected bend applies the requested circular radius');
  check(await value('Selected road point height') === 0 && await value('Track map width') === 44000, 'radius edits keep point heights and map control points unchanged');
  await page.click('[aria-label="Undo"]'); await settle(); check(await value('Selected curve radius') === 0, 'curve radius can be undone');
  await page.click('[aria-label="Redo"]'); await settle(); check(await value('Selected curve radius') === 5000, 'curve radius can be redone');
  await enter('Selected curve radius', '200000');
  check(await page.$eval('[data-curve-radius-status]', (e: HTMLElement) => e.textContent?.includes('limited by neighbouring points')), 'oversized radius shows the effective available radius');
  await page.click('[aria-label="Show 3D preview"]'); await page.waitForSelector('[aria-label="3D track preview"]');
  await page.mouse.move(1260, 80); await page.screenshot({ path: '.cache/curve-radius-native-3d.png' });
  await page.click('[aria-label="Show 2D layout"]'); await enter('Selected curve radius', '5000');
  await page.mouse.move(1260, 80); await page.screenshot({ path: '.cache/curve-radius-native-2d.png' });
  await enter('Selected curve radius', '0');
  await enter('Track map width', '66000');
  check(await value('Track map width') === 66000 && await value('Track map depth') === 39000, 'linked map dimensions resize both axes proportionally');
  check(await value('Overall road width') === 3200 && await value('Selected road point height') === 0, 'resizing the map retains the road width and height');
  await page.click('[aria-label="Undo"]'); await settle(); check(await value('Track map width') === 44000, 'map resizing can be undone');
  await page.click('[aria-label="Redo"]'); await settle(); check(await value('Track map width') === 66000, 'map resizing can be redone');
  await page.click('[aria-label="Undo"]'); await page.click('[aria-label="Keep map proportions"]'); await enter('Track map depth', '20000');
  check(await value('Track map width') === 44000 && await value('Track map depth') === 20000, 'map depth can be changed independently');
  await page.click('[aria-label="Undo"]');
  await tool('Draw by hand'); await enter('Drawing area width', '500000');
  check(await value('Drawing area width') === 500000 && await value('Drawing area depth') > 200000, 'the drawing view can show the largest supported map in both axes');
  await enter('Drawing area width', '100000');
  check(await value('Drawing area width') === 100000 && Math.abs(await value('Drawing area depth') - 100000 * 430 / 640) < 1, 'drawing area controls set the visible world dimensions');
  check(await value('Track map width') === 44000 && await value('Track map depth') === 26000, 'drawing area size changes the view without resizing the map');
  await enter('Drawing area depth', '50000');
  await page.waitForFunction(() => Math.abs(Number((document.querySelector('[aria-label="Drawing area width"]') as HTMLInputElement).value) - 50000 * 640 / 430) < 1);
  check(Math.abs(await value('Drawing area width') - 50000 * 640 / 430) < 1, 'drawing area depth follows the canvas proportions');
  const previous = await value('Drawing area width'); await page.click('[aria-label="Zoom 2D map out"]'); await settle(); check(await value('Drawing area width') > previous, 'drawing area has working zoom buttons');
  await enter('Drawing area width', '100000');
  const shape = Array.from({ length: 161 }, (_, i) => { const t = i / 160 * Math.PI * 2, r = 1 + .12 * Math.sin(t * 5); return { x: 320 + Math.cos(t) * 190 * r, z: 215 + Math.sin(t) * 130 * r }; });
  const box = await (await page.$('[data-testid="generator-canvas"]')).boundingBox(), screen = (p: any) => [box.x + p.x / 640 * box.width, box.y + p.z / 430 * box.height];
  await page.mouse.move(...screen(shape[0])); await page.mouse.down(); for (const p of shape.slice(1)) await page.mouse.move(...screen(p)); await page.mouse.up();
  await page.waitForSelector('[data-height-controls]');
  const width = await value('Track map width'), depth = await value('Track map depth');
  const drawnWidth = (Math.max(...shape.map(p => p.x)) - Math.min(...shape.map(p => p.x))) * 100000 / 640;
  const drawnDepth = (Math.max(...shape.map(p => p.z)) - Math.min(...shape.map(p => p.z))) * 100000 / 640;
  check(Math.abs(width - drawnWidth) < 750 && Math.abs(depth - drawnDepth) < 750, 'the freehand fit retains the drawn world-space extents');
  await page.click('[aria-label="Road control point"]'); const count = await page.$$eval('[role="option"]', (els: Element[]) => els.length); await page.keyboard.press('Escape');
  check(count > 24 && count <= 256, 'freehand preserves detailed bends using adaptive control points');
  await tool('Draw by hand'); check(await value('Drawing area width') === 100000, 'finishing a stroke preserves the chosen drawing view'); await tool('Edit points');
  await page.mouse.move(1260, 80); await page.screenshot({ path: '.cache/freehand-size-preview.png' });
  await page.click('[aria-label="Undo"]'); check(await value('Track map width') === 44000, 'Undo restores the layout before drawing');
  await page.click('[aria-label="Redo"]'); check(await value('Track map width') === width, 'Redo restores the hand-drawn layout');
  await page.click('[aria-label="Road control point"]');
  await page.evaluate(() => { ([...document.querySelectorAll('[role="option"]')].find(e => e.textContent === 'Point 15') as HTMLElement).click(); });
  await enter('Selected curve radius', '1000');
  check(await value('Selected curve radius') === 1000, 'a hand-drawn bend can be rounded before exporting');
  await page.evaluate(() => { ([...document.querySelectorAll('button')].find((e) => e.textContent?.trim() === 'Generate track') as HTMLElement).click(); });
  let editor: any;
  for (let i = 0; ; i++) {
    for (const p of await browser.pages()) if (p !== page && p.url().startsWith('http://127.0.0.1:') && await p.evaluate(() => !!(window as any).app?.doc.kcl && (window as any).app.viewport?.hasCourseModel).catch(() => false)) { editor = p; break; }
    if (editor) break; if (i === 900) throw Error('Generated editor unavailable'); await Bun.sleep(100);
  }
  check(await editor.evaluate(() => {
    const k = (window as any).app.doc.kcl;
    for (let i = 0; i < k.count; i++) if ([0, 3, 6].includes(k.flags[i] & 31)) for (const v of [1, 4, 7]) if (Math.abs(k.verts[i * 9 + v] - 10000) > .1) return false;
    return true;
  }), 'the saved hand-drawn track retains flat road collision with no automatic elevations');
  check(!errors.length, 'drawing and resizing produce no browser errors');
} finally {
  if (browser) { for (const page of await browser.pages()) await page.evaluate(() => { if ((window as any).__winctl) void (window as any).__winctl('close'); }).catch(() => {}); browser.disconnect(); }
  child.kill(); await child.exited;
  if (!resolve(temp).startsWith(resolve(tmpdir()) + sep)) throw Error('Unsafe cleanup');
  for (let i = 0; ; i++) { try { await rm(temp, { recursive: true, force: true }); break; } catch (e: any) { if (i === 120 || !['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(e.code)) throw e; await Bun.sleep(250); } }
}
