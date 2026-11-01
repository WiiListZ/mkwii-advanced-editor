import { expect, test } from "bun:test";
import { fitMessageText, messageTextLength } from "../web/js/formats/bmg.js";
import { parseBRLYT } from "../web/js/formats/brlyt.js";
import { messageTextError, messageTextLimit } from "../web/js/editor/text-limits.js";

test("BRLYT reads the actual UTF-16 capacity, excluding the terminator", () => {
  const data = new Uint8Array(0x90), view = new DataView(data.buffer);
  data.set([82, 76, 89, 84]); view.setUint16(12, 16); view.setUint16(14, 1);
  data.set([116, 120, 116, 49], 16); view.setUint32(20, 0x80);
  data.set([116, 101, 120, 116], 28);
  view.setUint16(92, 66); view.setUint16(94, 2); view.setUint32(104, 116);
  const layout = parseBRLYT(data);
  expect(layout.root.textCapacity).toBe(32);
  const assets = { ctrl: () => ({ layout: "custom" }), layout: () => layout };
  const rule = messageTextLimit(assets, "Common", 0x245c, "Luigi Circuit");
  expect(rule?.capacity).toBe(32);
  expect(rule?.singleLine).toBe(true);
  expect(messageTextError("X".repeat(32), rule)).toBe("");
  expect(messageTextError("X".repeat(33), rule)).toContain("32");
  expect(messageTextError("Name\nAnother line", rule)).toContain("one line");
  layout.root.textCapacity = 73;
  expect(messageTextLimit(assets, "Common", 0x245c, "Luigi Circuit")?.capacity).toBe(73);
  expect(messageTextLimit(assets, "Mod names", 0x20000, "A mod track")).toBeNull();
  expect(messageTextLimit(null, "Common", 0x245c, "Luigi Circuit")).toBeNull();
});

test("text budgets include encoded game codes and UTF-16 pairs without cutting either", () => {
  const icon = "{1A:080100002460}";
  expect(messageTextLength(icon)).toBe(4);
  expect(messageTextLength("A😀" + icon)).toBe(7);
  expect(fitMessageText("A😀" + icon + "B", 7)).toBe("A😀" + icon);
  expect(fitMessageText("A😀" + icon, 2)).toBe("A");
  expect(fitMessageText(icon, 3)).toBe("");
  expect(fitMessageText("Unchanged", undefined)).toBe("Unchanged");
  expect(messageTextError("\0", null)).toContain("null");
});
