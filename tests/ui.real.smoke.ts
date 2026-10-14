// Opens real tracks from an extracted game in headless Edge and saves screenshots.
// Usage: MKWII_GAME_DIR=<path to .../files> bun run tests/ui.real.smoke.ts <screenshot-dir> [track.szs ...]
import puppeteer from "puppeteer-core";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const game = process.env.MKWII_GAME_DIR;
if (!game || !existsSync(join(game, "Race/Common.szs"))) {
  console.log("MKWII_GAME_DIR not set (or no Race/Common.szs): skipped");
  process.exit(0);
}
// Screenshots go to the folder given on the command line, or to a temporary folder (never the project).
const outDir = process.argv[2] || mkdtempSync(join(tmpdir(), "mkwii-shots-"));
const tracks = process.argv.slice(3).length ? process.argv.slice(3) : ["castle_course.szs"];
const testDir = mkdtempSync(join(tmpdir(), "mkwii-test-"));
await Bun.write(join(testDir, "settings.json"), JSON.stringify({ tourDone: true }));
const worker = new Worker(new URL("../src/server.ts", import.meta.url).href);
const port: number = await new Promise((res) => {
  worker.onmessage = (e) => e.data?.type === "ready" && res(e.data.port);
  worker.postMessage({ type: "start", token: "smoke", settingsDir: testDir });
});
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1600,950"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 950 });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warn") errors.push(m.type() + ": " + m.text()); });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
await page.goto(`http://127.0.0.1:${port}/?t=smoke`, { waitUntil: "networkidle0" });
await wait(500);
await page.evaluate(async (p) => { await (window as any).app.loadCommonFrom(p, true); }, join(game, "Race/Common.szs"));
if (process.env.MKWII_PROFILE) await page.evaluate(() => {
  const vp = (window as any).app.viewport;
  vp.profileTimes = [];
  for (const name of ["rebuildKMP", "batchKMPVisuals", "setCourseModel"]) {
    const original = vp[name];
    vp[name] = function (...args: any[]) {
      const start = performance.now();
      const value = original.apply(this, args);
      vp.profileTimes.push({ name, ms: Math.round(performance.now() - start) });
      return value;
    };
  }
});
for (const t of tracks) {
  const t0 = Date.now();
  const info = await page.evaluate(async (p, profile) => {
    const a = (window as any).app;
    const phases: Record<string, number> = {};
    let start = performance.now();
    a.doc.dirty = false;
    await a.openPath(p);
    phases.open = Math.round(performance.now() - start);
    start = performance.now();
    await a.loadTrackAssets();
    phases.assets = Math.round(performance.now() - start);
    await new Promise((r) => setTimeout(r, 300));
    start = performance.now();
    const real = a.doc.kmp.GOBJ.filter((o: any) => a.assets.objectModel(o.objectId)).length;
    phases.objects = Math.round(performance.now() - start);
    return { objects: a.doc.kmp.GOBJ.length, withRealModel: real, course: a.viewport.hasCourseModel, tris: a.doc.kcl?.count, ...(profile ? { phases } : {}) };
  }, join(game, "Race/Course", t), !!process.env.MKWII_PROFILE);
  console.log(t, JSON.stringify(info), `${Date.now() - t0} ms`);
  if (t === "castle_course.szs") {
    const areaView = await page.evaluate(() => {
      const a = (window as any).app, vp = a.viewport;
      const count = () => { let n = 0; vp.kmpGroup.traverse((o: any) => { if (o.userData.isArea) n++; }); return n; };
      const hiddenEdges = () => [...vp.cache.keys()].filter((key: string) => key.endsWith(":edges-hidden")).length;
      a.doc.select([]);
      vp.rebuildKMP();
      const shown = count();
      const defaultHiddenEdges = hiddenEdges();
      const visibleEdges = [...vp.cache.keys()].filter((key: string) => key.endsWith(":edges"));
      const visibleEdgesUseDepth = visibleEdges.every((key: string) => vp.cache.get(key).obj.material.depthTest === true);
      a.setSetting("areaOutlinesThroughWalls", true);
      vp.rebuildKMP();
      const throughWalls = hiddenEdges();
      a.setSetting("areaOutlinesThroughWalls", false);
      vp.rebuildKMP();
      const afterDisable = hiddenEdges();
      a.setSetting("showAreaVolumes", false);
      vp.rebuildKMP();
      const hidden = count();
      a.doc.select(String(a.doc.kmp.AREA[0].uid));
      vp.rebuildKMP();
      const selected = count();
      a.setSetting("showAreaVolumes", true);
      return { areas: a.doc.kmp.AREA.length, shown, hidden, selected, defaultHiddenEdges, visibleEdgeCount: visibleEdges.length, visibleEdgesUseDepth, throughWalls, afterDisable };
    });
    if (areaView.areas && (areaView.shown !== areaView.areas || areaView.hidden !== 0 || areaView.selected !== 1
      || areaView.defaultHiddenEdges !== 0 || areaView.visibleEdgeCount !== areaView.areas || !areaView.visibleEdgesUseDepth
      || areaView.throughWalls !== areaView.areas || areaView.afterDisable !== 0))
      throw new Error("Show area volumes setting failed: " + JSON.stringify(areaView));
    const itemBox = await page.evaluate(() => {
      const a = (window as any).app;
      const box = a.doc.kmp.GOBJ.find((o: any) => a.objectNames[o.objectId] === "itembox");
      if (box) a.doc.select(String(box.uid));
      return !!box;
    });
    if (itemBox) {
      await page.waitForSelector("[data-object-settings]");
      const settingsRows = await page.evaluate(() => {
        const panel = document.querySelector("[data-object-settings]");
        const rows = [...(panel?.children || [])] as HTMLElement[];
        return { count: rows.length, labels: rows.map((row) => row.textContent || ""), tops: rows.map((row) => row.getBoundingClientRect().top) };
      });
      if (settingsRows.count !== 8 || !settingsRows.labels[1].includes("Player item type") || !settingsRows.labels[1].includes("1=Banana")
        || !settingsRows.labels[1].includes("Limits:") || settingsRows.tops.some((top, i) => i > 0 && top <= settingsRows.tops[i - 1]))
        throw new Error("Object setting documentation or vertical layout failed: " + JSON.stringify(settingsRows));
      await page.evaluate(() => {
        const a = (window as any).app;
        a.importedObjectDocumentation = { ...a.importedObjectDocumentation, 101: { notes: "Object picker note check" } };
        void a.pickObject(0x65);
      });
      await page.waitForSelector("[cmdk-item]");
      await page.evaluate(() => ([...document.querySelectorAll("[cmdk-item]")].find((el) => el.textContent?.includes("Item Box")) as HTMLElement)?.click());
      await page.waitForSelector("[data-object-setting-guide]");
      const pickerGuide = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]')!;
        const guide = dialog.querySelector("[data-object-setting-guide]")!;
        return { rows: guide.children.length - 1, text: guide.textContent || "", note: dialog.textContent?.includes("Object picker note check"), add: dialog.textContent?.includes("Add to track"), change: dialog.textContent?.includes("Change selected object") };
      });
      if (pickerGuide.rows !== 8 || !pickerGuide.text.includes("1=Banana") || !pickerGuide.text.includes("Limits:") || !pickerGuide.note || !pickerGuide.add || !pickerGuide.change)
        throw new Error("Object selector documentation failed: " + JSON.stringify(pickerGuide));
      await page.screenshot({ path: `${outDir}/real-object-selector.png` });
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.querySelector("[data-object-setting-guide]"));
      const objectGizmo = await page.evaluate(() => {
        const a = (window as any).app, vp = a.viewport;
        const box = a.doc.kmp.GOBJ.find((o: any) => a.objectNames[o.objectId] === "itembox");
        a.doc.select(String(box.uid));
        vp.rebuildKMP();
        vp.setMode("translate");
        const rawY = box.pos[1], visualY = vp.cache.get(String(box.uid)).obj.position.y;
        const pivotY = vp.pivot.position.y;
        vp.onGizmoDragging(true);
        vp.pivot.position.y += 100;
        vp.onGizmoChange();
        const movedY = box.pos[1];
        vp.onGizmoDragging(false);
        a.doc.undo();
        return { rawY, visualY, pivotY, movedY };
      });
      if (Math.abs(objectGizmo.visualY - objectGizmo.pivotY) > 0.01
        || objectGizmo.visualY <= objectGizmo.rawY
        || Math.abs(objectGizmo.movedY - objectGizmo.rawY - 100) > 0.01)
        throw new Error("Raised object gizmo or translation failed: " + JSON.stringify(objectGizmo));
      console.log("object settings and area view:", JSON.stringify({ rows: settingsRows.count, areaView }));
      console.log("item box gizmo:", JSON.stringify(objectGizmo));
    }
  }
  if (process.env.MKWII_PROFILE) console.log("load phases:", JSON.stringify(await page.evaluate(() => (window as any).app.viewport.profileTimes.splice(0))));
  if (process.env.MKWII_PROFILE) {
    const perf = await page.evaluate(() => {
      const vp = (window as any).app.viewport;
      const canvas = vp.canvas.getBoundingClientRect();
      const at = { clientX: canvas.left + canvas.width / 2, clientY: canvas.top + canvas.height / 2 };
      const timed = (count: number, fn: () => void) => {
        const start = performance.now();
        for (let i = 0; i < count; i++) fn();
        return Math.round((performance.now() - start) / count * 100) / 100;
      };
      return {
        pixelRatio: vp.renderer.getPixelRatio(),
        calls: vp.renderer.info.render.calls,
        triangles: vp.renderer.info.render.triangles,
        groups: ["courseGroup", "skyGroup", "kmpGroup", "kclGroup"].map((name) => {
          const group = vp[name];
          let meshes = 0, instanced = 0, lines = 0, uniqueGeometries = new Set(), uniqueMaterials = new Set();
          group.traverse((o: any) => {
            if (o.isMesh) { meshes++; if (o.isInstancedMesh) instanced++; uniqueGeometries.add(o.geometry.uuid); uniqueMaterials.add(o.material.uuid); }
            if (o.isLine) lines++;
          });
          return { name, meshes, instanced, lines, geometries: uniqueGeometries.size, materials: uniqueMaterials.size };
        }),
        kmpMeshes: (() => {
          const counts = new Map<string, number>();
          for (const root of vp.kmpGroup.children) root.traverse((o: any) => {
            if (!o.isMesh) return;
            const key = `${o.geometry.uuid}|${o.material.uuid}`;
            counts.set(key, (counts.get(key) || 0) + 1);
          });
          return [...counts.values()].sort((a, b) => b - a).slice(0, 15);
        })(),
        renderMs: timed(8, () => vp.renderer.render(vp.scene, vp.camera)),
        groundMs: timed(30, () => vp.pickGround(at)),
        entityMs: timed(30, () => vp.pickEntityHit(at)),
        rebuildMs: timed(4, () => vp.rebuildKMP()),
      };
    });
    console.log("viewport performance:", JSON.stringify(perf));
  }
  if (t === "boardcross_course_d.szs") {
    const modelMove = await page.evaluate(() => {
      const a = (window as any).app, vp = a.viewport;
      const mesh = vp.courseGroup.children[0]?.children.find((o: any) => o.isMesh && o.userData.partIndex === 0);
      if (!mesh) return { found: false };
      const original = a.doc.snapshot().modelBytes;
      a.startGeometryEditing("model");
      vp.selectGeometry(vp.modelPieceSelection(mesh, 0));
      vp.onGizmoDragging(true);
      vp.pivot.position.x += 16;
      vp.onGizmoChange();
      vp.onGizmoDragging(false);
      const moved = a.doc.snapshot().modelBytes !== original;
      a.doc.undo();
      const undone = a.doc.snapshot().modelBytes === original;
      a.stopTool();
      return { found: true, moved, undone };
    });
    if (!modelMove.found || !modelMove.moved || !modelMove.undone) throw new Error("Real BRRES model move/undo failed: " + JSON.stringify(modelMove));
    console.log("real model move/undo:", JSON.stringify(modelMove));
  }
  if (t === "beginner_course.szs") {
    const batchedMarker = await page.evaluate(() => {
      const vp = (window as any).app.viewport;
      const root = vp.pickables.find((o: any) => o.userData.batchable && !o.parent && o.isMesh && o.geometry === vp.geo.sphere);
      if (!root) return null;
      vp.setTool(null);
      vp.controls.target.copy(root.position);
      vp.camera.position.copy(root.position).add(new (vp.camera.position.constructor)(0, 1500, 400));
      vp.camera.lookAt(vp.controls.target);
      vp.camera.updateMatrixWorld();
      const rect = vp.canvas.getBoundingClientRect();
      const at = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
      return { key: root.userData.key, picked: vp.pickEntityHit(at)?.key };
    });
    if (!batchedMarker || batchedMarker.picked !== batchedMarker.key) throw new Error("Batched marker picking failed: " + JSON.stringify(batchedMarker));
    console.log("batched marker click:", JSON.stringify(batchedMarker));
    const target = await page.evaluate(() => {
      const a = (window as any).app, vp = a.viewport;
      const mesh = vp.courseGroup.children[0]?.children.find((o: any) => o.isMesh && o.userData.materialName === "kinoko_m");
      const selected = vp.modelPieceSelection(mesh, 0);
      const center = selected.min.map((v: number, i: number) => (v + selected.max[i]) / 2);
      vp.setTool(null);
      vp.controls.target.set(...center);
      vp.camera.position.set(center[0], center[1] + 4000, center[2] + 1000);
      vp.camera.lookAt(vp.controls.target);
      vp.camera.updateMatrixWorld();
      const rect = vp.canvas.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, name: selected.name };
    });
    await page.mouse.click(target.x, target.y);
    await wait(150);
    const direct = await page.evaluate(() => ({ selected: (window as any).app.geometrySelection?.name, row: !!document.querySelector('[data-key="MODEL_PART_14_0"][data-selected="true"]') }));
    if (direct.selected !== target.name || !direct.row) throw new Error("Direct model click or Track hierarchy selection failed: " + JSON.stringify(direct));
    await page.evaluate(() => (window as any).app.setSetting("modelEditing", false));
    await page.mouse.click(target.x, target.y);
    const disabled = await page.evaluate(() => (window as any).app.geometrySelection === null);
    if (!disabled) throw new Error("Disabling model editing did not block viewport selection");
    await page.evaluate(() => (window as any).app.setSetting("modelEditing", true));
    console.log("direct model click:", JSON.stringify(direct));
    const mushroomMove = await page.evaluate(async () => {
      const a = (window as any).app, vp = a.viewport;
      const mesh = vp.courseGroup.children[0]?.children.find((o: any) => o.isMesh && o.userData.materialName === "kinoko_m");
      if (!mesh) return { found: false };
      const selected = vp.modelPieceSelection(mesh, 0);
      const center = selected.min.map((v: number, i: number) => (v + selected.max[i]) / 2);
      vp.controls.target.set(...center);
      vp.camera.position.set(center[0], center[1] + 4000, center[2] + 1000);
      vp.camera.lookAt(vp.controls.target);
      vp.camera.updateMatrixWorld();
      const rect = vp.canvas.getBoundingClientRect();
      const picked = vp.pickGeometry({ clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 });
      const before = mesh.geometry.attributes.position.array.slice();
      const staticVertex = before.findIndex((_: number, i: number) => i % 3 === 0 && !selected.vertexIndices.includes(i / 3)) / 3;
      a.startGeometryEditing("model");
      vp.selectGeometry(selected);
      vp.onGizmoDragging(true);
      vp.pivot.position.x += 200;
      vp.onGizmoChange();
      vp.onGizmoDragging(false);
      const visibleDuringReload = vp.hasCourseModel && vp.courseGroup.visible;
      const previewDelta = mesh.geometry.attributes.position.array[selected.vertexIndices[0] * 3] - before[selected.vertexIndices[0] * 3];
      let next: any = null;
      for (let i = 0; i < 100; i++) {
        next = vp.courseGroup.children[0]?.children.find((o: any) => o.isMesh && o.userData.partIndex === mesh.userData.partIndex);
        if (next && next !== mesh) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      const after = next?.geometry.attributes.position.array;
      const moved = after ? after[selected.vertexIndices[0] * 3] - before[selected.vertexIndices[0] * 3] : 0;
      const stayed = after ? after[staticVertex * 3] - before[staticVertex * 3] : NaN;
      const keptSelection = vp.geometrySelection?.mesh === next && vp.geometrySelection?.name === selected.name && vp.gizmo.object === vp.pivot;
      a.doc.undo();
      a.stopTool();
      return { found: true, picked: picked?.name, expected: selected.name, pieces: mesh.userData.modelPart._pieces?.pieces.length, moved, stayed, visibleDuringReload, previewDelta, keptSelection };
    });
    if (!mushroomMove.found || mushroomMove.picked !== mushroomMove.expected || mushroomMove.pieces < 2 || Math.abs(mushroomMove.moved - 200) > 0.1 || Math.abs(mushroomMove.stayed) > 0.1 || !mushroomMove.visibleDuringReload || Math.abs(mushroomMove.previewDelta - 200) > 0.1 || !mushroomMove.keptSelection)
      throw new Error("Individual mushroom move failed: " + JSON.stringify(mushroomMove));
    console.log("individual mushroom move:", JSON.stringify(mushroomMove));
    const savedModel = await page.evaluate(async (path) => {
      const a = (window as any).app, vp = a.viewport;
      await new Promise((r) => setTimeout(r, 150));
      const mesh = vp.courseGroup.children[0]?.children.find((o: any) => o.isMesh && o.userData.materialName === "kinoko_m");
      const piece = vp.modelPieceSelection(mesh, 0);
      const vertex = piece.vertexIndices[0];
      const before = mesh.geometry.attributes.position.array[vertex * 3];
      vp.setTool(null);
      vp.selectGeometry(piece);
      vp.onGizmoDragging(true);
      vp.pivot.position.x += 200;
      vp.onGizmoChange();
      vp.onGizmoDragging(false);
      a.doc.filePath = path;
      a.doc.fileKind = "szs";
      a.doc.fileName = "model-save.szs";
      const saved = await a.save();
      await a.openPath(path);
      await a.loadTrackAssets();
      const reopened = vp.courseGroup.children[0]?.children.find((o: any) => o.isMesh && o.userData.materialName === "kinoko_m");
      return { saved, delta: reopened?.geometry.attributes.position.array[vertex * 3] - before };
    }, join(testDir, "model-save.szs"));
    if (!savedModel.saved || Math.abs(savedModel.delta - 200) > 0.1) throw new Error("Model save/reopen failed: " + JSON.stringify(savedModel));
    console.log("model save/reopen:", JSON.stringify(savedModel));
    const dragTarget = await page.evaluate(() => {
      const a = (window as any).app, vp = a.viewport;
      const mesh = vp.courseGroup.children[0]?.children.find((o: any) => o.isMesh && o.userData.materialName === "kinoko_m");
      const piece = vp.modelPieceSelection(mesh, 0);
      const center = piece.min.map((v: number, i: number) => (v + piece.max[i]) / 2);
      vp.setTool(null);
      vp.controls.target.set(...center);
      vp.camera.position.set(center[0], center[1] + 4000, center[2] + 1000);
      vp.camera.lookAt(vp.controls.target);
      vp.camera.updateMatrixWorld();
      const rect = vp.canvas.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, vertex: piece.vertexIndices[0], before: mesh.geometry.attributes.position.array[piece.vertexIndices[0] * 3] };
    });
    await page.mouse.click(dragTarget.x, dragTarget.y);
    let xHandle: number | null = null;
    for (let dx = 10; dx <= 130; dx += 5) {
      await page.mouse.move(dragTarget.x + dx, dragTarget.y);
      const axis = await page.evaluate(() => (window as any).app.viewport.gizmo.axis);
      if (axis === "X") { xHandle = dragTarget.x + dx; break; }
    }
    if (xHandle === null) throw new Error("Could not find the model X translation handle");
    await page.mouse.move(xHandle, dragTarget.y);
    await page.mouse.down();
    await page.mouse.move(xHandle + 90, dragTarget.y, { steps: 8 });
    await page.mouse.up();
    const draggedModel = await page.evaluate(async ({ path, vertex, before }) => {
      const a = (window as any).app, vp = a.viewport;
      const inMemory = vp.courseGroup.children[0]?.children.find((o: any) => o.isMesh && o.userData.materialName === "kinoko_m");
      const liveDelta = inMemory.geometry.attributes.position.array[vertex * 3] - before;
      const saved = await a.save();
      await a.openPath(path);
      await a.loadTrackAssets();
      const reopened = vp.courseGroup.children[0]?.children.find((o: any) => o.isMesh && o.userData.materialName === "kinoko_m");
      return { saved, liveDelta, reopenedDelta: reopened.geometry.attributes.position.array[vertex * 3] - before, position: reopened.geometry.attributes.position.array[vertex * 3] };
    }, { path: join(testDir, "model-save.szs"), vertex: dragTarget.vertex, before: dragTarget.before });
    if (!draggedModel.saved || Math.abs(draggedModel.liveDelta) < 1 || Math.abs(draggedModel.liveDelta - draggedModel.reopenedDelta) > 0.1)
      throw new Error("Mouse dragged model save/reopen failed: " + JSON.stringify(draggedModel));
    console.log("mouse dragged model save/reopen:", JSON.stringify(draggedModel));
    const freshPage = await browser.newPage();
    await freshPage.goto(`http://127.0.0.1:${port}/?t=smoke`, { waitUntil: "networkidle0" });
    const freshPosition = await freshPage.evaluate(async ({ path, vertex }) => {
      const a = (window as any).app;
      await a.openPath(path);
      await a.loadTrackAssets();
      const mesh = a.viewport.courseGroup.children[0]?.children.find((o: any) => o.isMesh && o.userData.materialName === "kinoko_m");
      return mesh?.geometry.attributes.position.array[vertex * 3];
    }, { path: join(testDir, "model-save.szs"), vertex: dragTarget.vertex });
    await freshPage.close();
    if (Math.abs(freshPosition - draggedModel.position) > 0.1) throw new Error("Model moved position is lost after fresh editor start");
    console.log("fresh editor model position:", freshPosition);
    const reloadDuringDrag = await page.evaluate(async (path) => {
      const a = (window as any).app, vp = a.viewport;
      const mesh = vp.courseGroup.children[0]?.children.find((o: any) => o.isMesh && o.userData.materialName === "kinoko_m");
      const piece = vp.modelPieceSelection(mesh, 0);
      const vertex = piece.vertexIndices[0];
      const before = mesh.geometry.attributes.position.array[vertex * 3];
      const oldBytes = a.doc.snapshot().modelBytes;
      vp.selectGeometry(piece);
      vp.onGizmoDragging(true);
      vp.pivot.position.x += 150;
      vp.onGizmoChange();
      const group = vp.courseGroup.children[0];
      vp.setCourseModel(group.clone());
      const deferred = vp.courseGroup.children[0] === group && vp.geometrySelection === piece;
      vp.selectGeometry(null);
      vp.onGizmoDragging(false);
      const committed = a.doc.snapshot().modelBytes !== oldBytes;
      const saved = await a.save();
      await a.openPath(path);
      await a.loadTrackAssets();
      const reopened = vp.courseGroup.children[0]?.children.find((o: any) => o.isMesh && o.userData.materialName === "kinoko_m");
      return { deferred, committed, saved, delta: reopened.geometry.attributes.position.array[vertex * 3] - before };
    }, join(testDir, "model-save.szs"));
    if (!reloadDuringDrag.deferred || !reloadDuringDrag.committed || !reloadDuringDrag.saved || Math.abs(reloadDuringDrag.delta - 150) > 0.1)
      throw new Error("Model reload during drag lost the edit: " + JSON.stringify(reloadDuringDrag));
    console.log("model reload during drag:", JSON.stringify(reloadDuringDrag));
    const copiedModel = await page.evaluate(async (path) => {
      const a = (window as any).app, vp = a.viewport;
      const brres = a.assets.brres(a.doc.szs, "course_model.brres");
      const model = brres.models.find((m: any) => m.name === "course");
      const index = model.objects.findIndex((o: any) => o.name === "polygon39");
      const before = model.objects[index].triangles;
      vp.selectModelPiece(index, 0);
      await a.cmd("copy");
      await a.cmd("paste");
      const after = a.assets.brres(a.doc.szs, "course_model.brres").models[0].objects.find((o: any) => o.name === "polygon39");
      const selected = vp.geometrySelection?.type === "model" && vp.geometrySelection?.mesh?.userData.modelPart?.name === "polygon39";
      const saved = await a.save();
      await a.openPath(path);
      await a.loadTrackAssets();
      const reopened = a.assets.brres(a.doc.szs, "course_model.brres").models[0].objects.find((o: any) => o.name === "polygon39");
      return { before, after: after.triangles, reopened: reopened.triangles, colors: !!reopened.colors, selected, saved };
    }, join(testDir, "model-save.szs"));
    if (!copiedModel.saved || copiedModel.after <= copiedModel.before || copiedModel.reopened !== copiedModel.after || !copiedModel.colors || !copiedModel.selected)
      throw new Error("Model copy/paste save/reopen failed: " + JSON.stringify(copiedModel));
    console.log("model copy/paste save/reopen:", JSON.stringify(copiedModel));
  }
  await wait(1200);
  await page.screenshot({ path: `${outDir}/real-${t.replace(".szs", "")}.png` });
  // A closer look at an object.
  await page.evaluate(() => { const a = (window as any).app; const o = a.doc.kmp.GOBJ.find((x: any) => x.objectId !== 0x65) || a.doc.kmp.GOBJ[0]; if (o) { a.doc.select(String(o.uid)); a.viewport.focusSelection(); } });
  await wait(1500);
  await page.screenshot({ path: `${outDir}/real-${t.replace(".szs", "")}-object.png` });
  // Animations: bones (CHR0) and texture scrolling (SRT0) must change over time.
  const anim = await page.evaluate(async () => {
    const vp = (window as any).app.viewport;
    // Every bone of the animated instances and every texture transform (TEV texture matrix or map SRT).
    const bones = vp.animated.flatMap((o: any) => (o.userData.chrBinding?.targets || []).map((t: any) => t.bone));
    const srts = vp.srtBindings.flatMap((b: any) => b.targets || []);
    const snap = () => ({
      q: bones.map((bone: any) => bone.quaternion.toArray().map((v: number) => v.toFixed(4)).join() + bone.position.toArray().map((v: number) => v.toFixed(2)).join()).join('|'),
      o: srts.map((t: any) => (t.mtx || t.map?.matrix)?.elements.map((v: number) => v.toFixed(4)).join() || '').join('|'),
    });
    const a = snap();
    await new Promise((r) => setTimeout(r, 700));
    const b = snap();
    return { animatedInstances: vp.animated.length, textureAnimations: vp.srtBindings.length, boneMoves: bones.length > 0 && a.q !== b.q, textureMoves: srts.length > 0 && a.o !== b.o };
  });
  console.log("animations:", JSON.stringify(anim));
  await page.evaluate(() => { const a = (window as any).app; const k = a.doc.kmp.GOBJ.find((x: any) => a.objectNames[x.objectId] === "kuribo"); if (k) { a.doc.select(String(k.uid)); a.viewport.focusSelection(); } });
  await wait(1500);
  await page.screenshot({ path: `${outDir}/real-${t.replace(".szs", "")}-goomba.png` });
}
console.log(errors.length ? "ERRORS:\n" + errors.slice(0, 20).join("\n") : "No console errors");
await browser.close();
worker.terminate();
rmSync(testDir, { recursive: true, force: true });
process.exit(0);
