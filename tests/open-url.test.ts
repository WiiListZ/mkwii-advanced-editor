import { expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { isAllowedUrl, revealInExplorer } from "../src/dialogs.ts";
import { OBJECT_INFO_REPO } from "../web/js/data/object-documentation.js";

test("only the project's GitHub pages and its Discord can be opened in the browser", () => {
  expect(isAllowedUrl("https://github.com/WiiListZ/mkwii-advanced-editor")).toBe(true);
  expect(isAllowedUrl("https://github.com/WiiListZ/mkwii-advanced-editor/issues/new?body=Version%3A%201.0.0")).toBe(true);
  // The buttons of the editor: Discord and the object-info repository.
  expect(isAllowedUrl("https://discord.gg/wrDyU9E7zs")).toBe(true);
  expect(isAllowedUrl(OBJECT_INFO_REPO)).toBe(true);
  expect(isAllowedUrl(`${OBJECT_INFO_REPO}/blob/main/data/objects.json`)).toBe(true);
  expect(isAllowedUrl("https://github.com/WiiListZ/mkwii-advanced-editor-fake")).toBe(false);
  expect(isAllowedUrl("https://github.com/WiiListZ/mkwii-advanced-editor-object-info-fake")).toBe(false);
  expect(isAllowedUrl("https://discord.gg/another")).toBe(false);
  expect(isAllowedUrl("http://discord.gg/wrDyU9E7zs")).toBe(false);
  expect(isAllowedUrl("http://github.com/WiiListZ/mkwii-advanced-editor")).toBe(false);
  expect(isAllowedUrl("https://github.com.evil.example/WiiListZ/mkwii-advanced-editor")).toBe(false);
  expect(isAllowedUrl("https://github.com/someone-else/repo")).toBe(false);
  expect(isAllowedUrl("file:///C:/Windows/System32/calc.exe")).toBe(false);
  expect(isAllowedUrl("not a url")).toBe(false);
});

test.skipIf(process.platform !== "win32")("Explorer receives a native absolute path for XML paths from the UI", () => {
  const temp = mkdtempSync(join(tmpdir(), "mkwii-reveal-"));
  const file = join(temp, "a pack, with spaces.xml");
  writeFileSync(file, "<wiidisc/>");
  const launch = spyOn(Bun, "spawn").mockImplementation((() => ({})) as any);
  try {
    revealInExplorer(file.replace(/\\/g, "/"));
    expect(launch.mock.calls[0][0]).toEqual(["explorer.exe", `/select,${file}`]);
    expect(() => revealInExplorer(join(temp, "missing.xml"))).toThrow("no longer exists");
    expect(launch).toHaveBeenCalledTimes(1);
  } finally {
    launch.mockRestore();
    if (!resolve(temp).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe test cleanup");
    rmSync(temp, { recursive: true, force: true });
  }
});
