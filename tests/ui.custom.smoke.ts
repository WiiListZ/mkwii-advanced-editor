// Renders a custom track built from loose files (course_model.brres + course.kcl + course.kmp), in memory only.
// Usage: bun run tests/ui.custom.smoke.ts <screenshot-dir> <folder with the files>
import puppeteer from "puppeteer-core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [outDir = ".", folder] = process.argv.slice(2);
if (!folder) { console.log("folder missing: skipped"); process.exit(0); }
const testDir = mkdtempSync(join(tmpdir(), "mkwii-test-"));
await Bun.write(join(testDir, "settings.json"), JSON.stringify({ tourDone: true }));
const worker = new Worker(new URL("../src/server.ts", import.meta.url).href);
const port: number = await new Promise((res) => {
  worker.onmessage = (e) => e.data?.type === "ready" && res(e.data.port);
  worker.postMessage({ type: "start", token: "smoke", settingsDir: testDir });
});
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1600,950"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 950 });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warn") errors.push(m.type() + ": " + m.text()); });
await page.goto(`http://127.0.0.1:${port}/?t=smoke`, { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 500));
const info = await page.evaluate(async (dir) => {
  const a = (window as any).app;
  const files: { name: string; data: Uint8Array }[] = [];
  for (const n of ["course_model.brres", "course.kcl", "course.kmp", "vrcorn_model.brres"]) {
    const res = await fetch(`/api/read?path=${encodeURIComponent(dir + "/" + n)}`, { headers: { "x-token": "smoke" } });
    if (res.ok) files.push({ name: n, data: new Uint8Array(await res.arrayBuffer()) });
  }
  await a.loadFiles(files);
  await new Promise((r) => setTimeout(r, 500));
  let tris = 0, textured = 0, meshes = 0;
  a.viewport.courseGroup.traverse((o: any) => { if (o.isMesh) { meshes++; tris += o.geometry.attributes.position.count / 3; if (o.material.map) textured++; } });
  return { files: files.map((f) => f.name), course: a.viewport.hasCourseModel, meshes, textured, tris, objects: a.doc.kmp.GOBJ.length, srt: a.viewport.srtBindings.length };
}, folder.split(String.fromCharCode(92)).join("/"));
console.log("custom track:", JSON.stringify(info));
await page.evaluate(() => { const a = (window as any).app; a.setSetting("displayMode", "visual"); a.viewport.frameAll(true); });
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: `${outDir}/custom-track.png` });

await browser.close();
worker.terminate();
rmSync(testDir, { recursive: true, force: true });
console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "No console errors");
process.exit(0);
