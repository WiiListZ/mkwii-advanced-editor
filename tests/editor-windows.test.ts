import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { EditorWindows } from "../src/editor-windows.ts";

test("the shared server waits for every native editor process after Home closes", async () => {
  const temp = mkdtempSync(join(tmpdir(), "mkwii-window-host-"));
  try {
    const script = join(temp, "window.ts");
    await Bun.write(script, 'await Bun.write(process.argv.at(-1), "window started"); await Bun.sleep(250);');
    const host = new EditorWindows([process.execPath, script]);
    const a = join(temp, "a.txt"), b = join(temp, "b.txt");
    expect(host.open(a)).toEqual({ native: true });
    host.open(b);
    expect(host.count).toBe(2);
    let closed = false;
    const stopped = host.whenIdle().then(() => { closed = true; });
    await Bun.sleep(30);
    expect(closed).toBe(false);
    await stopped;
    expect(host.count).toBe(0);
    expect(readFileSync(a, "utf8")).toBe("window started");
    expect(readFileSync(b, "utf8")).toBe("window started");
    expect(new EditorWindows().open("http://127.0.0.1/")).toEqual({ url: "http://127.0.0.1/" });
  } finally {
    if (!resolve(temp).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe test cleanup");
    rmSync(temp, { recursive: true, force: true });
  }
});
