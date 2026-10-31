import { expect, test } from "bun:test";
import { isAllowedUrl } from "../src/dialogs.ts";
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
