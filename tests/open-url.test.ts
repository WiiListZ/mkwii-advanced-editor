import { expect, test } from "bun:test";
import { isRepoUrl } from "../src/dialogs.ts";

test("only the project's GitHub pages can be opened in the browser", () => {
  expect(isRepoUrl("https://github.com/WiiListZ/mkwii-advanced-editor")).toBe(true);
  expect(isRepoUrl("https://github.com/WiiListZ/mkwii-advanced-editor/issues/new?body=Version%3A%201.0.0")).toBe(true);
  expect(isRepoUrl("https://github.com/WiiListZ/mkwii-advanced-editor-fake")).toBe(false);
  expect(isRepoUrl("http://github.com/WiiListZ/mkwii-advanced-editor")).toBe(false);
  expect(isRepoUrl("https://github.com.evil.example/WiiListZ/mkwii-advanced-editor")).toBe(false);
  expect(isRepoUrl("https://github.com/someone-else/repo")).toBe(false);
  expect(isRepoUrl("file:///C:/Windows/System32/calc.exe")).toBe(false);
  expect(isRepoUrl("not a url")).toBe(false);
});
