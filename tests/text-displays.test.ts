import { expect, test } from "bun:test";
import { defaultDisplay, gameText, sizedGameText } from "../web/js/editor/text-displays.js";
import { fontSizePercent, plainText, setFontSizePercent, stripFontSizePrefix } from "../web/js/formats/bmg.js";

test("game text escapes become the characters and sample values the game shows", () => {
  expect(gameText("←{1A:080200170000}Back")).toBe("←\uf041Back"); // B button icon
  expect(gameText("{1A:080100002460}")).toBe("\u2460"); // inserted character
  expect(gameText("{1A:0e030000f044001ef047001e}")).toBe("\uf044"); // first controller's icon
  expect(gameText("Rank: {1A:080000000046}A")).toBe("Rank: A"); // size change dropped
  expect(gameText("{1A:080200110000}Add Wii Remote")).toBe("Add Wii Remote"); // message chosen by the screen, not a number
  expect(gameText("View {1A:06020000}'s records.")).toBe("View Player's records.");
});

test("font size code is saved with the BMG text but hidden from the editor body", () => {
  const text = setFontSizePercent("Long course name", 72);
  expect(text).toBe("{1A:080000000048}Long course name");
  expect(fontSizePercent(text)).toBe(72);
  expect(stripFontSizePrefix(text)).toBe("Long course name");
  expect(plainText(text)).toBe("Long course name");
  expect(sizedGameText(text)).toBe(text);
  expect(setFontSizePercent(text, 100)).toBe("Long course name");
});

test("messages open on the screen where they appear", () => {
  expect(defaultDisplay("Common", 0x2339, "Birdo")).toBe("characterSelect");
  expect(defaultDisplay("Common", 0x238d, "Standard Kart M")).toBe("vehicleSelect");
  expect(defaultDisplay("Common", 0x23f0, "Mushroom Cup")).toBe("courseSelect");
  expect(defaultDisplay("Common", 0x2498, "Luigi Circuit")).toBe("courseSelect");
  expect(defaultDisplay("Common", 0x24b9, "Block Plaza")).toBe("battleStageSelect");
  expect(defaultDisplay("Menu", 0xbb8, "Grand Prix")).toBe("menuButton");
  expect(defaultDisplay("Menu", 0xbf4, "A Grand Prix for beginners (karts only).")).toBe("instruction");
  expect(defaultDisplay("Menu", 0x157f, "This course is not available yet.\n\nIf you earn enough trophies in\nGrand Prix mode, you can unlock\nnew courses to race on.")).toBe("messageWindow");
  expect(defaultDisplay("Race", 0x3eb, "Continue")).toBe("pauseMenu");
  expect(defaultDisplay("Race", 0x401, "Please wait a moment, the other players are still racing...")).toBe("raceMessage");
});
