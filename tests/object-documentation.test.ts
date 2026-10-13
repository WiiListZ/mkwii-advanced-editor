import { expect, test } from "bun:test";
import { BUILTIN_OBJECT_DOCUMENTATION, objectDocumentation, parseObjectDocumentation, settingGuidance } from "../web/js/data/object-documentation.js";

test("built-in documentation covers object behavior and known setting slots", () => {
  expect(Object.keys(BUILTIN_OBJECT_DOCUMENTATION).length).toBeGreaterThanOrEqual(40);
  const box = objectDocumentation(0x65, "itembox");
  expect(box.description).toContain("item lottery");
  expect(box.settings[2].label).toBe("Player item type");
  expect(settingGuidance(box.settings[2]).values).toContain("1=Banana");
  expect(settingGuidance(box.settings[2]).limits).toContain("0–16");
  expect(settingGuidance(box.settings[7]).limits).toContain("−32768–32767");
  expect(settingGuidance(box.settings[1]).limits).toContain("game-specific limit not documented");
  expect(box.settings[1]).toBeUndefined();
});

test("JSON import normalizes IDs and merges name, ID, and built-in documentation", () => {
  const imported = parseObjectDocumentation({ version: 1, objects: {
    itembox: { description: "Custom description", settings: { 2: { label: "Player override" } } },
    "0x0065": { label: "Custom Item Box", settings: { 3: { label: "CPU override", description: "Custom help", values: "0=custom", limits: "0–1 tested" } } },
    "0100": { description: "Another ID" },
  } });
  expect(imported["101"]).toBeDefined();
  expect(imported["100"]).toBeDefined();
  const box = objectDocumentation(101, "itembox", imported);
  expect(box.label).toBe("Custom Item Box");
  expect(box.description).toBe("Custom description");
  expect(box.settings[2].label).toBe("Player override");
  expect(box.settings[2].values).toContain("1=Banana");
  expect(box.settings[3].label).toBe("CPU override");
  expect(box.settings[3].values).toBe("0=custom");
  expect(box.settings[3].limits).toBe("0–1 tested");
  expect(box.settings[4].label).toBe("Disable shadow");
});

test("JSON import rejects invalid records without allowing prototype keys to alter lookup", () => {
  expect(() => parseObjectDocumentation({ version: 2, objects: {} })).toThrow();
  expect(() => parseObjectDocumentation({ version: 1, objects: { itembox: { settings: { 9: { label: "Bad" } } } } })).toThrow();
  expect(() => parseObjectDocumentation({ version: 1, objects: { "0x10000": { label: "Too large" } } })).toThrow();
  expect(() => parseObjectDocumentation({ version: 1, objects: { itembox: { settings: { 2: { label: "Item", limits: 10 } } } } })).toThrow();
  const imported = parseObjectDocumentation(JSON.parse('{"version":1,"objects":{"__proto__":{"description":"Safe"}}}'));
  expect(Object.getPrototypeOf(imported)).toBeNull();
  expect(objectDocumentation(42, "__proto__", imported).description).toBe("Safe");
  expect(objectDocumentation(42, "toString", imported).description).toBeUndefined();
});
