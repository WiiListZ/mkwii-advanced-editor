import { expect, test } from "bun:test";
import { compareVersions, selectRelease } from "../src/updater.ts";
import { ReleaseUpdater } from "../src/updater.ts";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

test("release versions compare numerically and respect prereleases", () => {
  expect(compareVersions("v1.10.0", "1.9.9")).toBe(1);
  expect(compareVersions("1.2.0-beta.2", "1.2.0")).toBe(-1);
  expect(compareVersions("1.2.0", "v1.2.0")).toBe(0);
});

test("only a newer release with the expected executable and checksum is selected", () => {
  const base = "https://github.com/WiiListZ/mkwii-advanced-editor/releases/download/v1.2.0/";
  const release = { tag_name: "v1.2.0", name: "Version 1.2", body: "New tools", html_url: "https://github.com/WiiListZ/mkwii-advanced-editor/releases/tag/v1.2.0",
    assets: [
      { name: "MKWiiAdvancedEditor.exe", browser_download_url: base + "MKWiiAdvancedEditor.exe", size: 100_000_000 },
      { name: "MKWiiAdvancedEditor.exe.sha256", browser_download_url: base + "MKWiiAdvancedEditor.exe.sha256", size: 100 },
    ] };
  expect(selectRelease(release, "1.1.0")?.notes).toBe("New tools");
  expect(selectRelease(release, "1.2.0")).toBeNull();
  expect(selectRelease({ ...release, assets: release.assets.slice(0, 1) }, "1.1.0")).toBeNull();
});

test("updater downloads and verifies the release executable", async () => {
  if (process.platform !== "win32") return;
  const directory = mkdtempSync(join(tmpdir(), "mkwii-updater-test-"));
  const realFetch = globalThis.fetch;
  const bytes = Buffer.from([0x4d, 0x5a, 1, 2, 3]);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const prefix = "https://github.com/WiiListZ/mkwii-advanced-editor/releases/download/v1.1.0/";
  const release = { tag_name: "v1.1.0", name: "Release 1.1", body: "Patch notes", html_url: prefix,
    assets: [
      { name: "MKWiiAdvancedEditor.exe", browser_download_url: prefix + "MKWiiAdvancedEditor.exe", size: 2_000_000 },
      { name: "MKWiiAdvancedEditor.exe.sha256", browser_download_url: prefix + "MKWiiAdvancedEditor.exe.sha256", size: 70 },
    ] };
  globalThis.fetch = (async (url: string) => {
    if (url.includes("api.github.com")) return Response.json(release);
    if (url.endsWith(".sha256")) return new Response(`${checksum}  MKWiiAdvancedEditor.exe`);
    if (url.endsWith(".exe")) return new Response(bytes);
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  try {
    const updater = new ReleaseUpdater("1.0.0", "C:/Program Files/MKWiiAdvancedEditor.exe", directory);
    expect((await updater.check()).notes).toBe("Patch notes");
    expect((await updater.download()).ready).toBe(true);
  } finally {
    globalThis.fetch = realFetch;
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe temporary cleanup path");
    rmSync(directory, { recursive: true, force: true });
  }
});

// A real local server sends the executable slowly: the download runs in the background, its
// progress can be followed, and an intact earlier download is not fetched again.
test("updater downloads slowly in the background and reports progress", async () => {
  if (process.platform !== "win32") return;
  const seconds = Number(process.env.MKWII_SLOW_DOWNLOAD_SECONDS || 2);
  const directory = mkdtempSync(join(tmpdir(), "mkwii-updater-slow-"));
  const bytes = new Uint8Array(3_000_000).map((_, i) => (i * 31) & 0xff);
  bytes[0] = 0x4d; bytes[1] = 0x5a;
  const checksum = createHash("sha256").update(bytes).digest("hex");
  let downloads = 0;
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", idleTimeout: 0, fetch(req) {
    const url = new URL(req.url), prefix = `http://127.0.0.1:${server.port}/download/`;
    if (url.pathname === "/latest") return Response.json({ tag_name: "v1.1.0", name: "Release 1.1", body: "", html_url: prefix,
      assets: [{ name: "MKWiiAdvancedEditor.exe", browser_download_url: prefix + "MKWiiAdvancedEditor.exe", size: bytes.length },
        { name: "MKWiiAdvancedEditor.exe.sha256", browser_download_url: prefix + "MKWiiAdvancedEditor.exe.sha256", size: 70 }] });
    if (url.pathname.endsWith(".sha256")) return new Response(`${checksum}  MKWiiAdvancedEditor.exe`);
    downloads++;
    const parts = 20;
    return new Response(new ReadableStream({ async start(controller) {
      for (let i = 0; i < parts; i++) {
        controller.enqueue(bytes.slice((i * bytes.length) / parts, ((i + 1) * bytes.length) / parts));
        await Bun.sleep((seconds * 1000) / parts);
      }
      controller.close();
    } }), { headers: { "content-length": String(bytes.length) } });
  } });
  const source = { releasesUrl: `http://127.0.0.1:${server.port}/latest`, downloadPrefix: `http://127.0.0.1:${server.port}/download/` };
  try {
    const updater = new ReleaseUpdater("1.0.0", "C:/Program Files/MKWiiAdvancedEditor.exe", directory, source);
    expect((await updater.check()).available).toBe(true);
    const started = Date.now();
    expect(updater.startDownload().phase).toBe("downloading");
    expect(Date.now() - started).toBeLessThan(500); // returns at once, whatever the download time
    const seen: number[] = [];
    while (updater.progress().phase === "downloading") { seen.push(updater.progress().received); await Bun.sleep(100); }
    expect(updater.progress()).toMatchObject({ phase: "ready", received: bytes.length, total: bytes.length });
    expect(seen.some((n) => n > 0 && n < bytes.length)).toBe(true);
    // A new editor session finds the verified file and skips the download.
    const again = new ReleaseUpdater("1.0.0", "C:/Program Files/MKWiiAdvancedEditor.exe", directory, source);
    await again.check();
    again.startDownload();
    while (again.progress().phase === "downloading") await Bun.sleep(50);
    expect(again.progress().phase).toBe("ready");
    expect(downloads).toBe(1);
  } finally {
    server.stop(true);
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe temporary cleanup path");
    rmSync(directory, { recursive: true, force: true });
  }
}, 60000);
