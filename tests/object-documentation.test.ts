import { expect, test } from "bun:test";
import { BUILTIN_OBJECT_DOCUMENTATION, DEFAULT_OBJECT_DOCUMENTATION_JSON, defaultDocumentation, documentationStatus, mergeDocumentationUpdate, objectDocumentation, useDefaultDocumentation, parseObjectDocumentation, settingDisplayValue, settingGuidance, settingStoredValue } from "../web/js/data/object-documentation.js";

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

test("the default documentation is the shipped JSON file", async () => {
  const json = await Bun.file(new URL("../web/js/data/object-documentation.json", import.meta.url)).json();
  expect(Object.keys(BUILTIN_OBJECT_DOCUMENTATION)).toEqual(Object.keys(json.objects));
  expect(DEFAULT_OBJECT_DOCUMENTATION_JSON.version).toBe(1);
  // Every default entry says how well it is documented (no estimates).
  for (const entry of Object.values<any>(BUILTIN_OBJECT_DOCUMENTATION)) expect(documentationStatus(entry).estimated).toBe(false);
  expect(documentationStatus(BUILTIN_OBJECT_DOCUMENTATION.sun)).toEqual({ status: "documented", percent: 100, estimated: false });
  expect(documentationStatus(BUILTIN_OBJECT_DOCUMENTATION.itembox).status).toBe("partial");
});

test("a newer default documentation (downloaded) is used in place of the shipped one", () => {
  const newer = { version: 1, objects: { itembox: { description: "Newer text", status: "documented", documented: 100 } } };
  useDefaultDocumentation(newer, { kind: "online", fetched: "2026-10-31T00:00:00Z" });
  try {
    expect(objectDocumentation(0x65, "itembox").description).toBe("Newer text");
    expect(defaultDocumentation().source).toEqual({ kind: "online", fetched: "2026-10-31T00:00:00Z" });
    expect(defaultDocumentation().json).toBe(newer);
    // A JSON chosen by the person still comes first.
    expect(objectDocumentation(0x65, "itembox", { itembox: { description: "Mine" } }).description).toBe("Mine");
    expect(() => useDefaultDocumentation({ version: 2, objects: {} }, { kind: "online", fetched: "" })).toThrow();
    expect(objectDocumentation(0x65, "itembox").description).toBe("Newer text");
  } finally { useDefaultDocumentation(null, null); }
  expect(defaultDocumentation().source).toEqual({ kind: "built-in" });
  expect(objectDocumentation(0x65, "itembox").description).toContain("item lottery");
});

test("a newer default reaches the person's documentation without touching their own entries", () => {
  const base = { itembox: { description: "Box v1" }, kuribo: { description: "Goomba v1" }, cow: { description: "Cow v1" }, sun: { description: "Sun v1" } };
  const custom = {
    itembox: { description: "Box v1" },              // unchanged by the person
    kuribo: { description: "My Goomba notes" },      // changed by the person
    myObject: { description: "An object of mine" },  // added by the person
    // cow: removed by the person
    sun: { description: "Sun v1" },                  // unchanged, then removed from the default
  };
  const next = { itembox: { description: "Box v2" }, kuribo: { description: "Goomba v2" }, cow: { description: "Cow v2" }, coin: { description: "Coin v1" } };
  const r = mergeDocumentationUpdate(custom, base, next);
  expect(r.objects.itembox.description).toBe("Box v2");
  expect(r.objects.kuribo.description).toBe("My Goomba notes");
  expect(r.objects.myObject.description).toBe("An object of mine");
  expect(r.objects.cow).toBeUndefined();
  expect(r.objects.sun).toBeUndefined();
  expect(r.objects.coin.description).toBe("Coin v1");
  expect(r).toMatchObject({ updated: 1, added: 1, removed: 1, kept: 2 });
  // Nothing new: nothing changes.
  expect(mergeDocumentationUpdate(custom, base, base).objects).toEqual({ ...custom } as any);
});

test("a chosen JSON replaces the default documentation; name and ID entries combine", () => {
  const custom = parseObjectDocumentation({ version: 1, objects: {
    itembox: { description: "Custom description", settings: { 2: { label: "Player override" } } },
    "0x0065": { label: "Custom Item Box", settings: { 3: { label: "CPU override", description: "Custom help", values: "0=custom", limits: "0–1 tested" } } },
    "0100": { description: "Another ID" },
  } });
  expect(custom["101"]).toBeDefined();
  expect(custom["100"]).toBeDefined();
  const box = objectDocumentation(101, "itembox", custom);
  expect(box.label).toBe("Custom Item Box");
  expect(box.description).toBe("Custom description");
  expect(box.settings[2].label).toBe("Player override");
  expect(box.settings[2].options).toBeUndefined();
  expect(box.settings[3].label).toBe("CPU override");
  expect(box.settings[3].values).toBe("0=custom");
  expect(box.settings[3].limits).toBe("0–1 tested");
  expect(box.settings[4]).toBeUndefined();
  expect(objectDocumentation(0xd1, "car_body", custom).description).toBeUndefined();
  // Empty (Restore default): the default documentation again.
  expect(objectDocumentation(101, "itembox", {}).settings[4].label).toBe("Disable shadow");
});

test("objects are labelled Documented, Partially documented or Unknown, with a percentage", () => {
  expect(documentationStatus({ settings: {} })).toEqual({ status: "unknown", percent: 0, estimated: true });
  expect(documentationStatus({ description: "x", settings: {} })).toEqual({ status: "partial", percent: 50, estimated: true });
  const all = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [i + 1, { label: `S${i + 1}` }]));
  expect(documentationStatus({ description: "x", settings: all })).toEqual({ status: "documented", percent: 100, estimated: true });
  expect(documentationStatus({ status: "documented" })).toEqual({ status: "documented", percent: 100, estimated: false });
  expect(documentationStatus({ status: "partial", documented: 35 })).toEqual({ status: "partial", percent: 35, estimated: false });
  expect(documentationStatus({ documented: 0 }).status).toBe("unknown");
  expect(documentationStatus({ description: "x", status: "partial", settings: all }).percent).toBe(99);
  const parsed = parseObjectDocumentation({ version: 1, objects: { kuribo: { status: "partial", documented: 70 } } });
  expect(parsed.kuribo).toEqual({ status: "partial", documented: 70 });
  expect(() => parseObjectDocumentation({ version: 1, objects: { kuribo: { status: "done" } } })).toThrow();
  expect(() => parseObjectDocumentation({ version: 1, objects: { kuribo: { documented: 101 } } })).toThrow();
  expect(() => parseObjectDocumentation({ version: 1, objects: { kuribo: { documented: 12.5 } } })).toThrow();
  expect(() => parseObjectDocumentation({ version: 1, objects: { kuribo: { status: "documented", documented: 80 } } })).toThrow();
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
