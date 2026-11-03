// Inspect the preview in ResizeObserver, after the drawing buffer changes and before paint.
// MKWII_GAME_DIR=<files> bun tests/asset-preview-resize.smoke.ts
// Set MKWII_TEST_EXE to exercise the compiled native app instead of the source server.
import puppeteer from 'puppeteer-core';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

const game = process.env.MKWII_GAME_DIR;
if (!game) throw Error('Set MKWII_GAME_DIR to the extracted game files');
const temp = mkdtempSync(join(tmpdir(), 'mkwii-preview-resize-')), files = join(temp, 'files');
mkdirSync(join(files, 'Race', 'Kart'), { recursive: true });
mkdirSync(join(files, 'Race', 'Course'), { recursive: true });
copyFileSync(join(game, 'Race/Kart/mdf_kart-mr.szs'), join(files, 'Race/Kart/mdf_kart-mr.szs'));
await Bun.write(join(temp, 'settings.json'), JSON.stringify({ tourDone: true, discordActivity: false, workspace: files }));
let browser: any = null, worker: Worker | null = null, child: ReturnType<typeof Bun.spawn> | null = null;
try {
  let page: any;
  if (process.env.MKWII_TEST_EXE) {
    const reservation = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('') });
    const port = reservation.port; reservation.stop(true);
    child = Bun.spawn([resolve(process.env.MKWII_TEST_EXE)], { env: { ...process.env, MKWII_SETTINGS_DIR: temp, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` }, stdout: 'ignore', stderr: 'inherit', windowsHide: true });
    for (let i = 0; ; i++) {
      try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch {}
      if (i === 150) throw Error('Native debugger unavailable');
      await Bun.sleep(100);
    }
    browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` });
    for (let i = 0; ; i++) {
      page = (await browser.pages()).find((p: any) => p.url().startsWith('http://127.0.0.1:'));
      if (page) break;
      if (i === 100) throw Error('Native page missing');
      await Bun.sleep(100);
    }
    await page.waitForFunction(() => !!(window as any).app);
    if (!await page.evaluate(() => (window as any).__nativeEditorWindow())) throw Error('Expected native window');
  } else {
    worker = new Worker(new URL('../src/server.ts', import.meta.url).href);
    const port = await new Promise<number>((done) => { worker!.onmessage = (e) => e.data?.type === 'ready' && done(e.data.port); worker!.postMessage({ type: 'start', token: 'resize', settingsDir: temp }); });
    browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    page = await browser.newPage(); await page.setViewport({ width: 1500, height: 950 });
    await page.goto(`http://127.0.0.1:${port}/?t=resize`, { waitUntil: 'networkidle0' });
  }
  const errors: string[] = []; page.on('pageerror', (e: Error) => errors.push(e.message));
  await page.evaluate(() => { void (window as any).app.cmd('assets'); });
  await page.waitForFunction(() => document.body.innerText.includes('driver_model.brres'));
  await page.waitForFunction(() => {
    const c = document.querySelector<HTMLCanvasElement>('[role="dialog"] canvas');
    if (!c || c.width < 100) return false;
    const gl = c.getContext('webgl2') || c.getContext('webgl'); if (!gl) return false;
    const d = new Uint8Array(c.width * c.height * 4); gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, d);
    return d.some((v, i) => i % 4 === 0 && v > 70 && d[i + 3] > 0);
  });
  await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('[role="dialog"] canvas')!, host = c.parentElement!;
    const gl = (c.getContext('webgl2') || c.getContext('webgl'))!;
    const samples: any[] = []; (window as any).resizeSamples = samples; (window as any).originalPreview = c;
    let width = host.clientWidth, height = host.clientHeight;
    const observer = new ResizeObserver(() => {
      if (width === host.clientWidth && height === host.clientHeight) return;
      width = host.clientWidth; height = host.clientHeight;
      const d = new Uint8Array(c.width * c.height * 4); gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, d);
      let visible = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && Math.abs(d[i] - 17) + Math.abs(d[i + 1] - 21) + Math.abs(d[i + 2] - 28) > 45) visible++;
      samples.push({ width, height, visible, sameCanvas: c === document.querySelector('[role="dialog"] canvas') });
    });
    observer.observe(host); (window as any).resizeProbe = observer;
  });
  for (const label of ['Resize the archive list', 'Resize the resource list']) {
    const handle = await page.$(`[role="separator"][aria-label="${label}"]`), box = await handle.boundingBox();
    if (!box) throw Error('Missing resize handle: ' + label);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 12 });
    await page.mouse.move(box.x + box.width / 2 - 35, box.y + box.height / 2, { steps: 12 }); await page.mouse.up();
  }
  const samples = await page.evaluate(() => (window as any).resizeSamples);
  if (samples.length < 8) throw Error('Not enough live resize samples: ' + samples.length);
  const blank = samples.filter((s: any) => s.visible < 100 || !s.sameCanvas);
  console.log(JSON.stringify({ samples: samples.length, blank: blank.length, minimumModelPixels: Math.min(...samples.map((s: any) => s.visible)) }));
  if (blank.length) throw Error('The preview disappeared before paint during panel resize');
  if (errors.length) throw Error(errors.join('\n'));
  console.log('ok: both panel dividers keep the same model canvas visible in every resize callback');
} finally {
  if (child) {
    browser?.disconnect(); child.kill(); await child.exited;
  } else await browser?.close();
  worker?.terminate();
  if (!resolve(temp).startsWith(resolve(tmpdir()) + sep)) throw Error('Unsafe cleanup');
  for (let i = 0; ; i++) {
    try { rmSync(temp, { recursive: true, force: true }); break; }
    catch (e: any) { if (i === 120 || !['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(e.code)) throw e; await Bun.sleep(250); }
  }
}
