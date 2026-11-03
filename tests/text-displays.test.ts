import { expect, test } from "bun:test";
import { LayoutRenderer } from "../web/js/editor/layout-render.js";
import { DISPLAYS, defaultDisplay, drawDisplay, gameText, sizedGameText, messagePlacement, MESSAGE_PLACEMENTS, archivesFor } from "../web/js/editor/text-displays.js";
import { MenuAssets } from "../web/js/editor/menu-screens.js";
import { messageTextLimit } from "../web/js/editor/text-limits.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
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
  expect(sizedGameText("50cc\n{1A:080000000032}Solo kart")).toBe("50cc\n{1A:080000000032}Solo kart");
  expect(sizedGameText("{1A:0a02001000000000}\n{1A:080000000046}Punti Corsa")).toBe("1\n{1A:080000000046}Punti Corsa");
  expect(sizedGameText("1. {1A:080200170000}Salta", { buttonIcon: "" })).toBe("1. Salta");
  expect(setFontSizePercent(text, 100)).toBe("Long course name");
});

test("messages open on the screen where they appear", () => {
  expect(defaultDisplay("Common", 0x2339, "Birdo")).toBe("characterSelect");
  expect(defaultDisplay("Common", 0x238d, "Standard Kart M")).toBe("vehicleSelect");
  expect(defaultDisplay("Common", 0x23f0, "Mushroom Cup")).toBe("courseSelect");
  expect(defaultDisplay("Common", 0x2498, "Luigi Circuit")).toBe("courseSelect");
  expect(defaultDisplay("Common", 0x24b9, "Block Plaza")).toBe("battleStageSelect");
  expect(defaultDisplay("Menu", 0xbb8, "Grand Prix")).toBe("modeSelect");
  expect(defaultDisplay("Menu", 0xbf4, "A Grand Prix for beginners (karts only).")).toBe("instruction");
  expect(defaultDisplay("Menu", 0x157f, "This course is not available yet.\n\nIf you earn enough trophies in\nGrand Prix mode, you can unlock\nnew courses to race on.")).toBe("messageWindow");
  expect(defaultDisplay("Race", 0x3eb, "Continue")).toBe("pauseMenu");
  expect(defaultDisplay("Race", 0x401, "Please wait a moment, the other players are still racing...")).toBe("raceMessage");
});

test("automatic placement is tied to the message ID, never its translation, length or punctuation", () => {
  for (const [file, id, display] of [
    ["Menu", 0xd4a, "characterSelect"], ["Menu", 0xd4b, "vehicleSelect"], ["Menu", 0xcef, "vehicleSelect"],
    ["Menu", 0xbbf, "classSelect"], ["Menu", 0xce9, "driftSelect"], ["Menu", 0xcea, "driftSelect"],
    ["Menu", 0x7db, "mainMenu"], ["Menu", 0x7e2, "mainMenu"], ["Menu", 0xced, "messageWindow"],
    ["Race", 0x4b4, "raceCountdown"], ["Race", 0x515, "resultPosition"], ["Race", 0x581, "raceIntro"],
    ["Race", 0x5de, "controllerHelp"], ["Race", 0x3f1, "afterRaceMenu"], ["Common", 0x24eb, "battleStageSelect"],
  ] as const) {
    for (const text of ["", "A", "Long translated text!\n".repeat(10), "短いテキスト"])
      expect(defaultDisplay(file, id, text)).toBe(display);
  }
  for (const file of ["Menu", "Race", "Number", "StaffRoll", "Mod text"])
    expect(defaultDisplay(file, 0xffff, "Short label")).toBe(file === "Race" ? "genericRaceWindow" : "genericWindow");
  expect(defaultDisplay("Common", 0x2382, "Not a known vehicle")).toBe("genericWindow");
  expect(messagePlacement("Menu", 0xd4a)?.control).toEqual(["bg", "MenuObiTitleText", "text"]);
  expect(messagePlacement("Menu", 0xcf0)?.control).toEqual(["control", "MachineAbility", "ability_text"]);
  expect(defaultDisplay("Menu", 0xa29, "Add")).toBe("channelInstall");
});

const originalGame = process.env.MKWII_GAME_DIR;
test.skipIf(!originalGame || !existsSync(join(originalGame, "Scene/UI")))("every automatic binding resolves to an actual text pane in the original game", async () => {
  const assets = new MenuAssets(async (name: string) => new Uint8Array(await Bun.file(join(originalGame!, "Scene/UI", name)).arrayBuffer()));
  await assets.load(["Font.szs", "MenuSingle.szs", "Race.szs", "Title.szs", "Award.szs"]);
  for (const p of MESSAGE_PLACEMENTS.values()) {
    expect(Object.hasOwn(DISPLAYS, p.display)).toBe(true);
    expect(archivesFor(p.display).every((name) => !!assets.archives.get(name))).toBe(true);
    const rule = messageTextLimit(assets, p.file, p.id, "");
    expect(rule, `${p.file} 0x${p.id.toString(16)}: ${p.control.join("/")}`).not.toBeNull();
    expect(rule!.capacity).toBeGreaterThan(0);
  }
  expect(messageTextLimit(assets, "Menu", 0xd4a, "")?.capacity).toBe(40);
  expect(messageTextLimit(assets, "Menu", 0xcef, "")?.capacity).toBe(32);
  expect(messageTextLimit(assets, "Menu", 0xcec, "")?.capacity).toBe(20);
  expect(messageTextLimit(assets, "Race", 0x4b4, "")?.capacity).toBe(25);
  expect(messageTextLimit(assets, "Race", 0x515, "")?.capacity).toBe(12);
  expect(messageTextLimit(assets, "Race", 0x5de, "")?.capacity).toBe(20);
  expect(messageTextLimit(assets, "Menu", 0xffff, "Short label")).toBeNull();
  expect(assets.panePlacement("pad_recognize", "RecognizePadWindow", "RecognizePadWindow", "icon_set_null")).toEqual({ x: 0, y: -42, scale: 1 });
  for (const kind of ["han_con", "nun_con", "cla_con", "gc_con"])
    expect(assets.anim(`pad_recognize/anim/common_w055_message_connect_${kind}.brlan`)).not.toBeNull();
});

test("every manually chosen screen previews the edited text instead of a different message's sample", () => {
  const seen: { ctrl: string; variant: string; text: Record<string, string> }[] = [];
  const assets: any = {
    texture: () => null, place: () => ({ x: 0, y: 0, scale: 1 }),
    drawControl: (_ctx: any, _folder: string, ctrl: string, variant: string, opts: any = {}) => {
      if (opts.text) seen.push({ ctrl, variant, text: opts.text });
    },
  };
  const ctx: any = { canvas: { width: 608, height: 456 }, fillRect() {}, createLinearGradient: () => ({ addColorStop() {} }) };
  const text = setFontSizePercent("Edited Luigi Circuit", 80);
  const lookup = (_file: string, id: number) => `Original ${id.toString(16)}`;
  for (const display of Object.keys(DISPLAYS)) {
    seen.length = 0;
    drawDisplay(assets, ctx, display, { file: "Common", id: 0x245c, text, lookup, previewText: true });
    expect(seen.some((s) => Object.values(s.text).includes(text))).toBe(true);
    // Changing the preview must keep the unrelated labels from the real messages.
    if (display === "courseSelect") expect(seen.find((s) => s.ctrl === "CourseSelectCourse" && s.variant === "Button1")?.text.text).toBe("Original 2455");
    if (display === "battleStageSelect") expect(seen.find((s) => s.ctrl === "BattleStageSelectStage" && s.variant === "Button1")?.text.text).toBe("Original 24b8");
  }
  seen.length = 0;
  drawDisplay(assets, ctx, "courseSelect", { file: "Common", id: 0x23f2, text: "Edited Star Cup", lookup, previewText: true });
  expect(seen.find((s) => s.ctrl === "CourseSelectCup" && s.variant === "Button2")?.text.text).toBe("Edited Star Cup");
  expect(seen.find((s) => s.ctrl === "CourseSelectCourse" && s.variant === "Button0")?.text.text).toBe("Original 245d");
});

test("automatic title, vehicle-stat and arena-alias bindings replace the correct field", () => {
  const seen: any[] = [];
  const assets: any = {
    texture: () => null, place: () => ({ x: 0, y: 0, scale: 1 }),
    drawControl: (_ctx: any, _folder: string, ctrl: string, variant: string, opts: any = {}) => seen.push({ ctrl, variant, ...opts }),
  };
  const ctx: any = { canvas: { width: 608, height: 456 }, fillRect() {}, createLinearGradient: () => ({ addColorStop() {} }) };
  const lookup = (_file: string, id: number) => `Original ${id.toString(16)}`;
  drawDisplay(assets, ctx, "characterSelect", { file: "Menu", id: 0xd4a, text: "Edited title", lookup });
  expect(seen.find((s) => s.ctrl === "MenuObiTitleText")?.text.text).toBe("Edited title");
  expect(seen.find((s) => s.ctrl === "CharacterSelectName")?.text.mii_name).toBe("Original 2328");
  seen.length = 0;
  drawDisplay(assets, ctx, "vehicleSelect", { file: "Menu", id: 0xcf0, text: "Edited weight", lookup });
  expect(seen.find((s) => s.ctrl === "MachineAbility" && s.variant === "Weight")?.text.ability_text).toBe("Edited weight");
  expect(seen.find((s) => s.ctrl === "MachineSelectName")?.text.mii_name).toBe("Original 238d");
  seen.length = 0;
  drawDisplay(assets, ctx, "battleStageSelect", { file: "Common", id: 0x24eb, text: "Edited Twilight House", lookup });
  expect(seen.find((s) => s.ctrl === "BattleStageSelectStage" && s.variant === "Button4")?.text.text).toBe("Edited Twilight House");
  expect(seen.find((s) => s.ctrl === "BattleStageSelectStage" && s.variant === "Button4")?.anims).toEqual(["select@end"]);
  seen.length = 0;
  drawDisplay(assets, ctx, "raceIntro", { file: "Race", id: 0x581, text: "Edited race heading", lookup });
  expect(seen.find((s) => s.ctrl === "cup_name")?.text.cup_name).toBe("Edited race heading");
  expect(seen.find((s) => s.ctrl === "course_name")?.text.course_name).toBe("Original 245c");
  seen.length = 0;
  drawDisplay(assets, ctx, "classSelect", { file: "Menu", id: 0xbc1, text: "Edited Mirror", lookup });
  const classes = seen.filter((s) => s.ctrl === "ClassSelect2");
  expect(classes.map((s) => s.variant)).toEqual(["Button50cc", "Button100cc", "Button150cc", "ButtonMirror"]);
  expect(classes.map((s) => s.texture["tt_class_kinoko_m.tpl"])).toEqual(["tt_class_kinoko_1.tpl", "tt_class_kinoko_2.tpl", "tt_class_kinoko_3.tpl", "tt_class_kinoko_m.tpl"]);
  seen.length = 0;
  drawDisplay(assets, ctx, "genericWindow", { file: "Mod text", id: 0xffff, text: "Long unmapped text".repeat(50), lookup });
  expect(seen.find((s) => s.ctrl === "MessageWindow")?.unlimitedText).toBe(true);
  expect(messageTextLimit(assets, "Menu", 0xffff, "Short label")).toBeNull();
});

test("controller warning composes its native window and PadControl without menu bars", () => {
  const seen: any[] = [];
  const assets: any = {
    drawControl: (_ctx: any, folder: string, ctrl: string, variant: string, options: any) => seen.push({ folder, ctrl, variant, ...options }),
    panePlacement: () => ({ x: 12, y: -50, scale: 0.8 }),
  };
  const ctx: any = { canvas: { width: 608, height: 456 }, fillRect() {} };
  drawDisplay(assets, ctx, "controllerMessage", { file: "Common", id: 0x26ad, text: "Controller changed", lookup: () => "P1", controller: "gc_con" });
  expect(seen.map((s) => s.ctrl)).toEqual(["BlackBack", "RecognizePadWindow", "RecognizePad"]);
  expect(seen[1].text.text).toBe("Controller changed");
  expect(seen[2].at).toEqual({ x: 12, y: -50, scale: 0.8 });
  expect(seen[2].anims).toContain("gc_con");
  expect(seen[2].anims).toContain("connect@end");
  expect(seen[2].text.text_set_p).toBe("P1");
  seen.length = 0;
  drawDisplay(assets, ctx, "controllerMessage", { file: "Common", id: 0x26ac, text: "Controller disconnected", lookup: () => "P1" });
  expect(seen[2].anims).toContain("disconnect@end");
});

test("cup icons replace all three native star placeholder layers, including selection highlights", () => {
  const seen: any[] = [];
  const assets: any = {
    texture: () => null, place: () => ({ x: 0, y: 0, scale: 1 }),
    drawControl: (_ctx: any, _folder: string, ctrl: string, variant: string, opts: any = {}) => seen.push({ ctrl, variant, ...opts }),
  };
  const ctx: any = { canvas: { width: 608, height: 456 }, fillRect() {} };
  const lookup = () => "Original name";
  for (const id of [0x24b9, 0x24bf]) {
    seen.length = 0;
    drawDisplay(assets, ctx, "battleStageSelect", { file: "Common", id, text: "Edited arena", lookup });
    for (const [variant, texture] of [["Button0", "tt_wii_icon_128.tpl"], ["Button1", "tt_classic_icon_sphere_128.tpl"]]) {
      const icon = seen.find((s) => s.ctrl === "BattleStageSelectCup" && s.variant === variant);
      expect(icon.texture).toEqual({ icon: texture, icon_light_01: texture, icon_light_02: texture });
    }
  }
  seen.length = 0;
  drawDisplay(assets, ctx, "courseSelect", { file: "Common", id: 0x245c, text: "Edited course", lookup });
  const mushroom = seen.find((s) => s.ctrl === "CourseSelectCup" && s.variant === "Button0");
  expect(Object.values(mushroom.texture)).toEqual(Array(3).fill("tt_cup_icon_kinoko_00.tpl"));
});

test("named-pane attachment respects parent transforms from custom layouts", () => {
  const assets = new MenuAssets(async () => null);
  const pane = (name: string, trans: number[], scale: number[], rot: number[], children: any[] = []) => ({ name, trans, scale, rot, children });
  const root = pane("root", [10, 0, 0], [1, 1], [0, 0, 90], [pane("parent", [0, -50, 0], [0.5, 0.5], [0, 0, 0], [pane("icon_set_null", [20, 10, 0], [1, 1], [0, 0, 0])])]);
  assets.ctrl = () => ({ layout: "custom", variants: [{ name: "Window", standard: { x: 100, y: 40, sx: 2, sy: 2 } }] });
  assets.layout = () => ({ root });
  const at = assets.panePlacement("pad_recognize", "Window", "Window", "icon_set_null")!;
  expect(at.x).toBeCloseTo(210);
  expect(at.y).toBeCloseTo(60);
  expect(at.scale).toBeCloseTo(1);
  expect(assets.panePlacement("pad_recognize", "Window", "Window", "missing")).toBeNull();
});

function withCanvasGlobals<T>(fn: () => T): T {
  const prev = { DOMMatrix: globalThis.DOMMatrix, ImageData: globalThis.ImageData, document: globalThis.document };
  class MockMatrix {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    constructor(init?: string | MockMatrix) {
      if (init && typeof init === "object") Object.assign(this, init);
    }
    private mul(a: number, b: number, c: number, d: number, e: number, f: number) {
      const na = this.a * a + this.c * b, nb = this.b * a + this.d * b;
      const nc = this.a * c + this.c * d, nd = this.b * c + this.d * d;
      const ne = this.a * e + this.c * f + this.e, nf = this.b * e + this.d * f + this.f;
      this.a = na; this.b = nb; this.c = nc; this.d = nd; this.e = ne; this.f = nf;
      return this;
    }
    translate(tx: number, ty: number) { return this.mul(1, 0, 0, 1, tx, ty); }
    scale(sx: number, sy: number) { return this.mul(sx, 0, 0, sy, 0, 0); }
    rotate(deg: number) { const r = (deg * Math.PI) / 180; return this.mul(Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0); }
    toString() { return this as unknown as string; }
  }
  class MockImageData {
    width: number;
    height: number;
    data: Uint8ClampedArray;
    constructor(a: number | Uint8ClampedArray, b: number, c?: number) {
      if (typeof a === "number") { this.width = a; this.height = b; this.data = new Uint8ClampedArray(a * b * 4); }
      else { this.data = a; this.width = b; this.height = c!; }
    }
  }
  (globalThis as any).DOMMatrix = MockMatrix;
  (globalThis as any).ImageData = MockImageData;
  (globalThis as any).document = {
    createElement: () => {
      const canvas: any = { width: 0, height: 0, imageData: null };
      canvas.getContext = () => ({ putImageData: (img: any) => { canvas.imageData = img; } });
      return canvas;
    },
  };
  try {
    return fn();
  } finally {
    (globalThis as any).DOMMatrix = prev.DOMMatrix;
    (globalThis as any).ImageData = prev.ImageData;
    (globalThis as any).document = prev.document;
  }
}

test("layout text renderer fits tall multi-line blocks, composites overlapping glyph borders and preserves colour icon fonts", () => {
  withCanvasGlobals(() => {
    // 1. 11-line drift help (0x0ced) squeezes vertically and horizontally inside MessageWindow's text box.
    const iaFont: any = {
      width: 42, height: 51, lineFeed: 51, ascent: 40, baseline: 40, alterChar: 0,
      cellW: 8, cellH: 8, cols: 2, rows: 1,
      defaultWidth: { left: 0, glyph: 8, advance: 25 },
      widths: new Map([[0, { left: 0, glyph: 8, advance: 8 }], [1, { left: -4, glyph: 8, advance: 8 }]]),
      chars: new Map([[68, 0], [101, 1], [32, 0]]),
      sheets: [{ width: 18, height: 8, format: 3, _rgba: new Uint8Array(18 * 8 * 4) }],
    };
    const sheet = iaFont.sheets[0]._rgba;
    // Cell 0 ('D', x=0..7): opaque fill (I=255, A=255) across x=0..7.
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const p = (y * 18 + x) * 4;
      sheet[p] = sheet[p + 1] = sheet[p + 2] = 255; sheet[p + 3] = 255;
    }
    // Cell 1 ('e', x=9..16, left=-4 so x=0..3 overlaps 'D'): faint white border (I=0, A=25) at x=0..3, fill at x=4..7.
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const p = (y * 18 + (9 + x)) * 4;
      const border = x < 4;
      sheet[p] = sheet[p + 1] = sheet[p + 2] = border ? 0 : 255;
      sheet[p + 3] = border ? 25 : 255;
    }

    // Full-colour icon font (format 5 = RGB5A3) for U+F041 ([B] button): pure white body + red accent.
    const iconFont: any = {
      width: 43, height: 51, lineFeed: 51, ascent: 40, baseline: 40, alterChar: 0,
      cellW: 8, cellH: 8, cols: 1, rows: 1,
      defaultWidth: { left: 0, glyph: 8, advance: 8 },
      widths: new Map([[0, { left: 0, glyph: 8, advance: 8 }]]),
      chars: new Map([[0xf041, 0]]),
      sheets: [{ width: 8, height: 8, format: 5, _rgba: new Uint8Array(8 * 8 * 4) }],
    };
    for (let i = 0; i < 64; i++) {
      iconFont.sheets[0]._rgba.set(i < 32 ? [255, 255, 255, 255] : [220, 40, 40, 255], i * 4);
    }

    const blits: { img: any; rect: { x: number; y: number; w: number; h: number } }[] = [];
    const ctx: any = {
      canvas: { width: 1216, height: 912 },
      save() {}, restore() {}, setTransform() {},
      drawImage(c: any) { blits.push({ img: c.imageData, rect: lastRect! }); },
    };
    let lastRect: { x: number; y: number; w: number; h: number } | null = null;
    const renderer = new LayoutRenderer({
      textures: () => null,
      fonts: () => iaFont,
      fallbackFonts: () => [iconFont],
    });
    const origBlit = renderer.blit.bind(renderer);
    renderer.blit = (c, m, img, rect, op) => { lastRect = rect; origBlit(c, m, img, rect, op); };

    const makeLayout = (text: string, size: [number, number], fontSize: [number, number], lineSpace = -7) => ({
      fonts: ["kart_kanji_font.brfnt"],
      textures: [],
      materials: [{ name: "text", black: [255, 255, 255, 0], white: [128, 128, 128, 255], matColor: [255, 255, 255, 255] }],
      root: {
        kind: "txt", name: "text", visible: true, influencedAlpha: true, alpha: 255,
        origin: 4, trans: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1], size,
        font: 0, material: 0, fontSize, charSpace: 0, lineSpace,
        textOrigin: 4, textAlign: 0, textCapacity: 500,
        topColor: [255, 255, 255, 255], bottomColor: [255, 255, 255, 255],
        text, children: [],
      },
    });

    // 11 lines at fontSize [34.2, 41.31] would be 384.41 units tall unsqueezed; squeezeY fits them into h = 303.78.
    const elevenLines = Array.from({ length: 11 }, () => "DeDeDeDeDe").join("\n");
    renderer.draw(ctx, makeLayout(elevenLines, [523.33, 303.78], [34.2, 41.31]));
    const marginY = 12 * (41.31 / 51);
    const renderedBlockH = blits[0]!.rect.h - marginY * 2;
    expect(renderedBlockH).toBeCloseTo(303.78, 1);

    // Overlap check ("De" at 1:1 scale): 'D' grey fill (128) overlapped by 'e' A=25 white border blends to ~140, not 255.
    blits.length = 0;
    renderer.draw(ctx, makeLayout("De", [200, 100], [42, 51], 0));
    const deImg = blits[0]!.img;
    // The line feed also contains leading below this deliberately short glyph.
    // Sample the glyph's painted rows, rather than the centre of the line box.
    const paintedRows: number[] = [];
    for (let y = 0; y < deImg.height; y++) {
      if (Array.from({ length: deImg.width }, (_, x) => deImg.data[(y * deImg.width + x) * 4 + 3]).some((a) => a > 200)) paintedRows.push(y);
    }
    expect(paintedRows.length).toBeGreaterThan(0);
    const midY = paintedRows[Math.floor(paintedRows.length / 2)];
    const rowReds: number[] = [];
    for (let x = 0; x < deImg.width; x++) {
      const a = deImg.data[(midY * deImg.width + x) * 4 + 3];
      if (a > 200) rowReds.push(deImg.data[(midY * deImg.width + x) * 4]);
    }
    expect(rowReds.length).toBeGreaterThan(8);
    // None of the opaque stroke/overlap pixels should be blown out to pure white (255).
    expect(Math.max(...rowReds)).toBeLessThan(180);

    // Native colour changes tint the fill, then reset to the material's original colour.
    blits.length = 0;
    renderer.draw(ctx, makeLayout("{1A:080000010032}D{1A:080000010000}D", [200, 100], [42, 51], 0));
    const coloured = blits[0]!.img.data;
    let redPixels = 0, greyPixels = 0;
    for (let p = 0; p < coloured.length; p += 4) if (coloured[p + 3] > 200) {
      if (coloured[p] > 100 && coloured[p + 1] < 10 && coloured[p + 2] < 10) redPixels++;
      if (coloured[p] > 100 && Math.abs(coloured[p] - coloured[p + 1]) < 2 && Math.abs(coloured[p] - coloured[p + 2]) < 2) greyPixels++;
    }
    expect(redPixels).toBeGreaterThan(0);
    expect(greyPixels).toBeGreaterThan(0);

    // Colour icon check ("\uf041"): preserves white (255,255,255) and red (220,40,40) instead of inverting to mat.white (128).
    blits.length = 0;
    renderer.draw(ctx, makeLayout("\uf041", [200, 100], [43, 51], 0));
    const iconData = blits[0]!.img.data;
    let sawWhite = false, sawRed = false;
    for (let i = 0; i < iconData.length; i += 4) {
      if (iconData[i + 3] < 200) continue;
      if (iconData[i] > 245 && iconData[i + 1] > 245 && iconData[i + 2] > 245) sawWhite = true;
      if (iconData[i] > 200 && iconData[i + 1] < 60 && iconData[i + 2] < 60) sawRed = true;
    }
    expect(sawWhite).toBe(true);
    expect(sawRed).toBe(true);

    // Inline mid-string font size tag scales subsequent lines.
    blits.length = 0;
    renderer.draw(ctx, makeLayout("De\nDe", [200, 200], [42, 51], 0));
    const twoFullH = blits[0]!.rect.h;
    blits.length = 0;
    renderer.draw(ctx, makeLayout("De\n{1A:080000000032}De", [200, 200], [42, 51], 0));
    const halfSecondH = blits[0]!.rect.h;
    expect(halfSecondH).toBeLessThan(twoFullH - 20);
  });
});

test("messageWindow omits unset button icon tags while Back button keeps its B icon", () => {
  const seen: Record<string, any>[] = [];
  const fakeAssets: any = {
    texture: () => null,
    place: () => ({ x: 0, y: 0, scale: 1 }),
    drawControl: (_ctx: any, _folder: string, ctrl: string, _variant: string, opts: any = {}) => {
      if (opts.text) seen.push({ ctrl, text: opts.text });
    },
  };
  const fakeCtx: any = {
    canvas: { width: 608, height: 456 },
    fillRect() {}, createLinearGradient: () => ({ addColorStop() {} }),
  };
  const lookup = (_f: string, id: number) => (id === 0x7d1 ? "←{1A:080200170000}Indietro" : "");

  drawDisplay(fakeAssets, fakeCtx, "messageWindow", {
    file: "Menu", id: 0xced,
    text: "1. {1A:080200170000}Salta mentre curvi.",
    lookup,
  });
  expect(seen.find((s) => s.ctrl === "MessageWindow")?.text.text).toBe("1. Salta mentre curvi.");

  seen.length = 0;
  drawDisplay(fakeAssets, fakeCtx, "menuButton", {
    file: "Menu", id: 0x7d1,
    text: "←{1A:080200170000}Indietro",
    lookup,
  });
  expect(seen.find((s) => s.ctrl === "Back")?.text.text).toBe("←\uf041Indietro");
});
