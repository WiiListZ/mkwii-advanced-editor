import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

async function withServer(run: (request: (route: string, body?: unknown) => Promise<Response>) => Promise<void>, windowCommand?: string[]) {
  const dir = await mkdtemp(join(tmpdir(), "mkwii-window-loading-"));
  await Bun.write(join(dir, "settings.json"), JSON.stringify({ discordActivity: false }));
  const worker = new Worker(new URL("../src/server.ts", import.meta.url).href);
  try {
    const port = await new Promise<number>((done, reject) => {
      worker.onmessage = (e) => { if (e.data?.type === "ready") done(e.data.port); if (e.data?.type === "error") reject(Error(e.data.message)); };
      worker.onerror = reject;
      worker.postMessage({ type: "start", token: "loading-test", settingsDir: dir, windowCommand });
    });
    await run((route, body) => fetch(`http://127.0.0.1:${port}/api/${route}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "x-token": "loading-test", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }));
  } finally {
    worker.terminate();
    if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw Error("Unsafe test cleanup");
    await rm(dir, { recursive: true, force: true });
  }
}

test("opening an editor stays pending until that specific window reports ready or failed", async () => {
  await withServer(async (request) => {
    const first = await (await request("editor-window", { create: "empty" })).json();
    const second = await (await request("editor-window", { create: "empty" })).json();
    expect(new URL(first.url).searchParams.get("launch")).toBe(first.launch);
    expect(first.launch).not.toBe(second.launch);
    const status = (id: string, body?: unknown) => request(`editor-window-status?id=${id}`, body).then((r) => r.json());
    expect(await status(first.launch)).toEqual({ state: "opening" });
    expect(await status(second.launch)).toEqual({ state: "opening" });
    expect(await status(first.launch, {})).toEqual({ state: "ready" });
    expect(await status(first.launch)).toEqual({ state: "ready" });
    expect(await status(second.launch)).toEqual({ state: "opening" });
    expect(await status(second.launch, { error: "Invalid track archive" })).toEqual({ state: "error", error: "Invalid track archive" });
    // A late/repeated acknowledgement must not erase an earlier failure.
    expect(await status(second.launch, {})).toEqual({ state: "error", error: "Invalid track archive" });
    expect((await request("editor-window-status?id=unknown")).status).toBe(404);
    expect((await fetch(new URL(first.url).origin + "/api/editor-window-status?id=" + first.launch)).status).toBe(403);
  });
});

test("an editor process that exits during startup releases the opener with an error", async () => {
  await withServer(async (request) => {
    const opened = await (await request("editor-window", { create: "empty" })).json();
    expect(opened.native).toBe(true);
    let progress: any;
    for (let i = 0; i < 100; i++) {
      progress = await (await request(`editor-window-status?id=${opened.launch}`)).json();
      if (progress.state === "error") break;
      await Bun.sleep(25);
    }
    expect(progress.state).toBe("error");
    expect(progress.error).toContain("closed before the track was ready");
  }, [process.execPath, "-e", "await Bun.sleep(80)"]);
});

test("the requested model view is passed to the new window without changing other launches", async () => {
  await withServer(async (request) => {
    const model = await (await request("editor-window?view=visual", { create: "empty" })).json();
    expect(new URL(model.url).searchParams.get("view")).toBe("visual");
    const normal = await (await request("editor-window", { create: "empty" })).json();
    expect(new URL(normal.url).searchParams.has("view")).toBe(false);
    const invalid = await (await request("editor-window?view=unknown", { create: "empty" })).json();
    expect(new URL(invalid.url).searchParams.has("view")).toBe(false);
  });
});
