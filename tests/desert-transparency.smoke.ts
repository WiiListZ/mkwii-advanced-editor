import puppeteer from 'puppeteer-core';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The blended sand must render smoothly and write depth like in the game, hiding what is behind it:
// depth-tested editor guides and the dark bases of the sandfalls (translucent course meshes).
// It is smooth only when its triangles keep the file's draw order (no reordered BVH index).
// Usage: MKWII_GAME_DIR=<extracted game files> bun run tests/desert-transparency.smoke.ts
const source = process.env.MKWII_GAME_DIR && join(process.env.MKWII_GAME_DIR, 'Race/Course/desert_course.szs');
if (!source || !existsSync(source)) {
  console.log('MKWII_GAME_DIR not set (or no desert_course.szs): skipped');
  process.exit(0);
}
const testDir = mkdtempSync(join(tmpdir(), 'mkwii-desert-'));
const track = join(testDir, 'desert_course.szs');
copyFileSync(source, track);
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
  await page.goto(`http://127.0.0.1:${port}/?t=smoke`, { waitUntil: 'networkidle0' });
  const info = await page.evaluate(async (path) => {
    const app = (window as any).app;
    await app.openPath(path);
    await app.loadTrackAssets();
    const vp = app.viewport;
    vp.displayMode = 'visual';
    vp.areaOutlinesThroughWalls = false;
    vp.applyDisplayMode();
    vp.rebuildKMP();
    vp.controls.target.set(20500, 3500, 45000);
    vp.camera.position.set(17000, 9500, 49000);
    vp.camera.lookAt(vp.controls.target);
    vp.controls.update();
    vp.needsRender = true;
    const sand = vp.courseGroup.getObjectByName('polygon71');
    return { sand: !!sand, depthWrite: sand?.material.depthWrite, indexed: !!sand?.geometry.index, areas: app.doc.kmp.AREA.length,
      throughWallOutlines: vp.kmpGroup.children.filter((o: any) => o.material?.isLineMaterial && !o.material.depthTest).length };
  }, track);
  console.log(info);
  if (!info.sand || !info.depthWrite || info.indexed || !info.areas || info.throughWallOutlines) throw new Error(JSON.stringify(info));
  const visibility = await page.evaluate(() => {
    const vp = (window as any).app.viewport;
    let ndc: any, hit: any;
    for (let y = -0.1; y >= -0.7 && !hit; y -= 0.1) for (let x = 0; x <= 0.8 && !hit; x += 0.1) {
      vp.raycaster.setFromCamera({ x, y }, vp.camera);
      const first = vp.raycaster.intersectObject(vp.courseGroup, true)[0];
      if (first?.object.name === 'polygon71') { ndc = { x, y }; hit = first; }
    }
    if (!hit) return { hit: false };
    const gl = vp.renderer.getContext(), canvas = vp.renderer.domElement;
    const pixel = () => {
      vp.needsRender = true; vp.renderNow();
      const rgba = new Uint8Array(4);
      gl.readPixels(Math.round((ndc.x + 1) * canvas.width / 2), Math.round((ndc.y + 1) * canvas.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
      return [...rgba];
    };
    const template = vp.kmpGroup.children.find((o: any) => o.isMesh && !o.userData.isArea);
    const marker = template.clone();
    marker.geometry = vp.geo.sphere;
    marker.material = vp.mat(0xff00ff, { kind: 'basic' });
    marker.material.depthTest = true;
    marker.scale.setScalar(250);
    marker.renderOrder = 100;
    vp.kmpGroup.add(marker);
    marker.position.copy(hit.point).addScaledVector(vp.raycaster.ray.direction, -500);
    const front = pixel();
    marker.position.copy(hit.point).addScaledVector(vp.raycaster.ray.direction, 500);
    const behind = pixel();
    vp.kmpGroup.remove(marker);
    return { hit: true, ndc, point: hit.point.toArray(), front, behind };
  });
  console.log(visibility);
  if (!visibility.hit || visibility.front?.[0] < 200 || visibility.front?.[2] < 200 ||
      visibility.behind?.[0] > 200 && visibility.behind?.[2] > 200) throw new Error(JSON.stringify(visibility));
  if (process.env.MKWII_DESERT_SCREENSHOT) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await page.screenshot({ path: process.env.MKWII_DESERT_SCREENSHOT });
  }
} finally {
  await browser.close();
  worker.terminate();
  rmSync(testDir, { recursive: true, force: true });
}
