// Smoke test: starts the server worker and calls a few endpoints.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
// Isolated settings and temp files: tests never touch the real user settings.
const testDir = mkdtempSync(joinPath(tmpdir(), "mkwii-test-"));
const worker = new Worker(new URL("../src/server.ts", import.meta.url).href);
const port: number = await new Promise((res) => {
  worker.onmessage = (e) => e.data?.type === "ready" && res(e.data.port);
  worker.postMessage({ type: "start", token: "abc", settingsDir: testDir });
});
const base = `http://127.0.0.1:${port}`;
const page = await fetch(base + "/");
console.log("index:", page.status, (await page.text()).includes("app.js"));
console.log("app.js:", (await fetch(base + "/app.js")).status);
console.log("no token:", (await fetch(base + "/api/info")).status);
console.log("info:", await (await fetch(base + "/api/info", { headers: { "x-token": "abc" } })).json());
const tmp = joinPath(testDir, "mkwii_smoke.bin");
const data = new Uint8Array(5000).fill(7);
const w = await fetch(base + "/api/write?compress=yaz0&path=" + encodeURIComponent(tmp), { method: "POST", headers: { "x-token": "abc" }, body: data });
console.log("write:", await w.json());
const r = new Uint8Array(await (await fetch(base + "/api/read?path=" + encodeURIComponent(tmp), { headers: { "x-token": "abc" } })).arrayBuffer());
console.log("read back yaz0 header:", String.fromCharCode(...r.slice(0, 4)), r.length);
worker.terminate();
await import("node:fs").then((fs) => fs.rmSync(testDir, { recursive: true, force: true }));
process.exit(0);
