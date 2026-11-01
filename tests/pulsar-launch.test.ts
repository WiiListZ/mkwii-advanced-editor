import { expect, test } from "bun:test";
import { buildPulsarLaunch, pulsarInstructions, pulsarLaunchPaths } from "../web/js/editor/pulsar-launch.js";
import { parseRiivolution } from "../web/js/formats/riivolution.js";

const template = await Bun.file(new URL("../vendor/pulsar/Base.xml", import.meta.url)).text();

test("a new pack enables its loader and keeps unrelated My Stuff patches off", () => {
  const { xml, instructions } = buildPulsarLaunch(template, "MyCups", "E:\\");
  const original = parseRiivolution(template.replaceAll("{$pack}", "MyCups"));
  const mod = parseRiivolution(xml);
  expect(mod.sections[0].options.map((o: any) => [o.attrs.name, o.attrs.default])).toEqual([["Pack", "1"], ["My Stuff", "0"]]);
  // All regional hooks, the memory-loaded Loader.pul and disc folder mappings survive.
  expect(mod.patches).toEqual(original.patches);
  expect(xml).toContain('valuefile="/MyCups/Binaries/Loader.pul"');
  expect(xml).toContain('external="/MyCups/Binaries" disc="/Binaries"');
  expect(xml).not.toContain("{$pack}");
  expect(instructions).toContain("riivolution/MyCups.xml");
  expect(instructions).toContain("Pack to Enabled");
});

test("SD drive roots and trailing separators point at the same files", () => {
  expect(pulsarLaunchPaths("Test", "E:\\")).toEqual({
    sdRoot: "E:/", xmlPath: "E:/riivolution/Test.xml", instructionsPath: "E:/Test/HOW TO PLAY.txt",
  });
  expect(pulsarLaunchPaths("Test", "D:/packs/")).toEqual(pulsarLaunchPaths("Test", "D:/packs"));
});

test("play instructions follow the selected original-cup mode", () => {
  expect(pulsarInstructions("Pack", 0)).toContain("custom cups only");
  expect(pulsarInstructions("Pack", 1)).toContain("starts with the original cups");
  expect(pulsarInstructions("Pack", 2)).toContain("starts with your custom cups");
  expect(pulsarInstructions("Pack", 2)).toContain("available together");
});
