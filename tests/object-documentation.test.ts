import { expect, test } from "bun:test";
import { BUILTIN_OBJECT_DOCUMENTATION, objectDocumentation, parseObjectDocumentation, settingDisplayValue, settingGuidance, settingStoredValue } from "../web/js/data/object-documentation.js";

test("built-in documentation covers object behavior and known setting slots", () => {
  expect(Object.keys(BUILTIN_OBJECT_DOCUMENTATION).length).toBeGreaterThanOrEqual(40);
  const box = objectDocumentation(0x65, "itembox");
  expect(box.description).toContain("item lottery");
  expect(box.settings[2].label).toBe("Player item type");
  expect(settingGuidance(box.settings[2]).options).toContainEqual([1, "Banana"]);
  expect(settingGuidance(box.settings[2]).options).toContainEqual([597, "Default (0x255)"]);
  expect(settingGuidance(box.settings[2]).otherValues).toBe(true);
  expect(settingGuidance(box.settings[7])).toMatchObject({ signed: true, min: -32768, max: 32767 });
  expect(settingGuidance(box.settings[7]).limits).toContain("-32768–32767");
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
  expect(box.settings[2].options[1]).toBe("Banana");
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

test("settings can carry real limits, signed values and a list of choices", () => {
  const imported = parseObjectDocumentation({ version: 1, objects: { car_body: { settings: {
    1: { label: "Speed", min: 0, max: 120 },
    2: { label: "Offset", signed: true, min: -500, max: 500 },
    4: { label: "Colour", options: { "0": "Blue", "1": "Red" }, otherValues: true },
  } } } });
  const doc = objectDocumentation(0xd1, "car_body", imported);
  expect(settingGuidance(doc.settings[1])).toMatchObject({ min: 0, max: 120, limits: "0–120" });
  expect(settingGuidance(doc.settings[2])).toMatchObject({ signed: true, min: -500, max: 500 });
  expect(settingGuidance(doc.settings[4]).options).toEqual([[0, "Blue"], [1, "Red"]]);
  // Signed values are stored as their 16-bit raw value.
  expect(settingStoredValue(-1)).toBe(65535);
  expect(settingDisplayValue(65535, doc.settings[2])).toBe(-1);
  expect(settingDisplayValue(65535, doc.settings[1])).toBe(65535);
  const bad = (setting: any) => () => parseObjectDocumentation({ version: 1, objects: { x: { settings: { 1: { label: "S", ...setting } } } } });
  expect(bad({ min: 5, max: 1 })).toThrow();
  expect(bad({ max: 70000 })).toThrow();
  expect(bad({ min: -1 })).toThrow();
  expect(bad({ signed: "yes" })).toThrow();
  expect(bad({ options: { a: "Bad" } })).toThrow();
  expect(bad({ options: { "9": "Outside" }, max: 5 })).toThrow();
  expect(bad({ options: {} })).toThrow();
});
