import * as React from "react";
import { escapes, fontSizePercent, plainText } from "../../../js/formats/bmg.js";
import { bmgColour } from "../../../js/formats/bmg-style.js";
import { drawText } from "../../../js/formats/brfnt.js";
import { gameTextAssetsFor } from "../game-text-assets";
import { CONTROLLER_PREVIEWS, DISPLAYS, archivesFor, defaultDisplay, drawDisplay } from "../../../js/editor/text-displays.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LoaderCircle } from "lucide-react";

type Lookup = (file: string, id: number) => string | null;

// Screens are laid out in the Wii's 608x456 units and drawn at twice that, so the small menu text
// stays sharp instead of showing the jagged edges of a 608-pixel image scaled up.
const RESOLUTION = 2;
const SCREEN_W = 608 * RESOLUTION, SCREEN_H = 456 * RESOLUTION;

// One set of game files per Scene/UI folder, kept while the editor runs (parsed layouts, decoded
// textures and drawn panes are reused by every message).

export const DEFAULT_GAME_SCREEN_VH = 30;
export const MIN_GAME_SCREEN_VH = 18;
export const MAX_GAME_SCREEN_VH = 65;

export function GameTextPreview({ folder, file, id, font, text, originalText, place, lookup, inGamePreview, onInGamePreviewChange, screenVh = DEFAULT_GAME_SCREEN_VH, onScreenVhChange }: {
  folder: string; file: string; id: number; font: any; text: string; originalText: string; place: string; lookup: Lookup;
  inGamePreview: boolean; onInGamePreviewChange: (enabled: boolean) => void;
  screenVh?: number; onScreenVhChange?: (vh: number) => void;
}) {
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const [choice, setChoice] = React.useState("auto");
  const [controller, setController] = React.useState("han_con");
  const [result, setResult] = React.useState<{ key: string; state: "screen" | "font" | "missing" }>({ key: "", state: "font" });
  const display = choice === "auto" ? defaultDisplay(file, id, originalText) : choice;
  const screenPreview = inGamePreview && display !== "font";
  const renderKey = JSON.stringify([folder, display, inGamePreview, display === "controllerMessage" ? controller : ""]);
  const state = result.key === renderKey ? result.state : "drawing";

  React.useEffect(() => {
    const c = canvas.current, g = c?.getContext("2d");
    if (!c || !g) return;
    if (!screenPreview || !folder) { drawMessage(g, c, font, text); setResult({ key: renderKey, state: "font" }); return; }
    let cancelled = false;
    // While typing, redraw at most once per frame.
    const frame = requestAnimationFrame(async () => {
      try {
        const assets = gameTextAssetsFor(folder);
        await assets.load(archivesFor(display));
        if (cancelled) return;
        if (archivesFor(display).some((name) => !assets.archives.get(name))) { drawMessage(g, c, font, text); setResult({ key: renderKey, state: "missing" }); return; }
        const off = document.createElement("canvas");
        off.width = SCREEN_W; off.height = SCREEN_H;
        const og = off.getContext("2d")!;
        og.fillStyle = "#000"; og.fillRect(0, 0, SCREEN_W, SCREEN_H);
        drawDisplay(assets, og, display, { file, id, text, lookup, previewText: choice !== "auto", controller });
        if (cancelled) return;
        c.width = SCREEN_W; c.height = SCREEN_H;
        g.drawImage(off, 0, 0);
        setResult({ key: renderKey, state: "screen" });
      } catch (error) {
        if (cancelled) return;
        console.warn("Could not draw the game screen preview:", error);
        drawMessage(g, c, null, text);
        setResult({ key: renderKey, state: "missing" });
      }
    });
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [folder, display, file, id, text, lookup, font, inGamePreview, choice, renderKey, controller]);

  return (
    <div className="shrink-0">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <span className="font-medium text-foreground">{screenPreview ? "Game screen" : "Font preview"}</span>
        <div className="flex flex-wrap items-center gap-3">
          {inGamePreview && (
            <>
              {onScreenVhChange && (
                <label className="flex items-center gap-1.5 text-muted-foreground" title="Resize the game screen preview">
                  <span>Size</span>
                  <input
                    type="range"
                    aria-label="Game screen size"
                    min={MIN_GAME_SCREEN_VH}
                    max={MAX_GAME_SCREEN_VH}
                    step={1}
                    value={Math.min(MAX_GAME_SCREEN_VH, Math.max(MIN_GAME_SCREEN_VH, screenVh))}
                    onChange={(e) => onScreenVhChange(Number(e.target.value))}
                    className="w-24 accent-primary"
                  />
                </label>
              )}
              <Select value={choice} onValueChange={setChoice}>
                <SelectTrigger className="h-7 w-56 text-[11px]" aria-label="Game screen to show"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Automatic · {(DISPLAYS as Record<string, string>)[defaultDisplay(file, id, originalText)] || "Text only (screen not mapped)"}</SelectItem>
                  {Object.entries(DISPLAYS).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
              {display === "controllerMessage" && <Select value={controller} onValueChange={setController}>
                <SelectTrigger className="h-7 w-52 text-[11px]" aria-label="Controller in preview"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(CONTROLLER_PREVIEWS).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent>
              </Select>}
            </>
          )}
          <label className="flex cursor-pointer items-center gap-1.5 text-muted-foreground">
            <input type="checkbox" aria-label="Preview in game screen" className="accent-primary" checked={inGamePreview} onChange={(e) => onInGamePreviewChange(e.target.checked)} />
            Game screen
          </label>
        </div>
      </div>
      <div className="relative w-fit max-w-full">
      <canvas ref={canvas} role="img" width={screenPreview && folder ? SCREEN_W : 608} height={screenPreview && folder ? SCREEN_H : 90}
        data-preview-state={state}
        aria-label={screenPreview ? `${(DISPLAYS as Record<string, string>)[display]} preview for ${place}` : `Text preview for ${place}`}
        className="block h-auto w-auto max-w-full rounded-md border border-white/15 shadow-md"
        style={{ imageRendering: "auto", maxHeight: `${screenPreview ? screenVh : 52}vh` }} />
      {state === "drawing" && screenPreview && folder && <div role="status" className="absolute inset-0 flex items-center justify-center gap-2 rounded-md bg-background/85 text-xs text-muted-foreground"><LoaderCircle className="size-4 animate-spin" /> Loading preview…</div>}
      </div>
      <div className="mt-1 text-[10.5px] leading-relaxed text-muted-foreground">
        {state === "screen"
          ? display === "genericWindow" || display === "genericRaceWindow"
            ? "Generic preview using the game's message-window layout. The exact screen and text capacity for this message ID have not been identified."
            : "Drawn from the game's own files in Scene\\UI (layouts, textures, animations and fonts), with this text in its place and limited to the text box's capacity. Text is fitted to its layout box, including multi-line messages. Character and vehicle models, trophies and course movies are 3D or video and are not drawn."
          : state === "missing"
            ? "The game files for this screen are missing or could not be read from Scene\\UI. Showing the font only."
            : state === "font" ? (inGamePreview ? display === "font" ? "No verified game screen for this message ID. Showing the text; choose a layout above to preview it there." : "Choose the game's Scene\\UI folder to see the game screen." : "Game screen preview is off; showing the font only.") : "Drawing…"}
      </div>
      {state === "screen" && choice !== "auto" && display !== defaultDisplay(file, id, originalText) && <p className="mb-0 mt-1 text-[10.5px] text-muted-foreground">Changing this preview does not move the message to a different game screen.</p>}
      {state === "screen" && display === "controllerMessage" && <p className="mb-0 mt-1 text-[10.5px] text-muted-foreground">The controller is a preview example. In the game it depends on the connected controller; the paused screen appears behind this warning.</p>}
    </div>
  );
}

function drawMessage(g: CanvasRenderingContext2D, c: HTMLCanvasElement, font: any, text: string) {
  const width = 608, pad = 22, runs = toRuns(text, "#ffffff"), scale = .6 * fontSizePercent(text) / 100;
  const lines = plainText(text).split("\n");
  let size = { width: 0, height: lines.length * 26 };
  if (font) size = drawText(document.createElement("canvas").getContext("2d")!, font, runs, 0, 0, { scale, maxWidth: width - pad * 2 });
  else size.height = drawPlainRuns(g, runs, pad, width, 20 * fontSizePercent(text) / 100, false);
  // drawText measures line feeds; a glyph can extend below the last line feed.
  const glyphOverflow = font ? Math.max(0, ((font.cellH || font.height) - (font.lineFeed || font.height)) * scale) : 0;
  const height = Math.max(90, Math.ceil(size.height + glyphOverflow + pad * 2));
  c.width = width; c.height = height;
  g.fillStyle = "#101010";
  g.fillRect(0, 0, width, height);
  if (font) drawText(g, font, runs, pad, (height - size.height) / 2, { scale, maxWidth: width - pad * 2 });
  else {
    drawPlainRuns(g, runs, pad, width, 20 * fontSizePercent(text) / 100, true);
  }
}

function drawPlainRuns(g: CanvasRenderingContext2D, runs: { text: string; color: string; alpha?: number }[], pad: number, width: number, size: number, draw: boolean) {
  g.font = `600 ${size}px sans-serif`;
  const line = size * 1.3;
  let x = pad, y = pad + size;
  for (const run of runs) {
    g.fillStyle = run.color;
    for (const ch of run.text) {
      if (ch === "\n") { x = pad; y += line; continue; }
      const advance = g.measureText(ch).width;
      if (x + advance > width - pad && x > pad) { x = pad; y += line; }
      if (draw && run.alpha !== 0) g.fillText(ch, x, y);
      x += advance;
    }
  }
  return y - pad + line - size;
}

function toRuns(text: string, color: string) {
  const runs: { text: string; color: string; alpha?: number }[] = [];
  const defaultColor = color;
  let alpha = 1;
  let last = 0;
  for (const e of escapes(text)) {
    if (e.start > last) runs.push({ text: text.slice(last, e.start), color, alpha });
    if (e.bytes[1] === 0 && e.bytes[2] === 0 && e.bytes[3] === 1) {
      const rgba = bmgColour(e.bytes[4] * 256 + e.bytes[5]);
      color = rgba ? `rgb(${rgba[0]},${rgba[1]},${rgba[2]})` : defaultColor;
      alpha = rgba?.[3] === 0 ? 0 : 1;
    } else if (!(e.bytes[1] === 0 && e.bytes[2] === 0 && e.bytes[3] === 0)) runs.push({ text: "◆", color: "#9aa4b8", alpha });
    last = e.end;
  }
  if (last < text.length) runs.push({ text: text.slice(last), color, alpha });
  return runs;
}
