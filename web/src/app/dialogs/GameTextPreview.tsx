import * as React from "react";
import { escapes, fontSizePercent, plainText } from "../../../js/formats/bmg.js";
import { drawText } from "../../../js/formats/brfnt.js";
import { api } from "../../../js/api.js";
import { MenuAssets } from "../../../js/editor/menu-screens.js";
import { DISPLAYS, archivesFor, defaultDisplay, drawDisplay } from "../../../js/editor/text-displays.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Lookup = (file: string, id: number) => string | null;

// Screens are laid out in the Wii's 608x456 units and drawn at twice that, so the small menu text
// stays sharp instead of showing the jagged edges of a 608-pixel image scaled up.
const RESOLUTION = 2;
const SCREEN_W = 608 * RESOLUTION, SCREEN_H = 456 * RESOLUTION;

// One set of game files per Scene/UI folder, kept while the editor runs (parsed layouts, decoded
// textures and drawn panes are reused by every message).
const assetsByFolder = new Map<string, any>();
function assetsFor(folder: string) {
  let assets = assetsByFolder.get(folder);
  if (!assets) {
    assets = new MenuAssets(async (name: string) => {
      const path = `${folder.replace(/[\\/]+$/, "")}\\${name}`;
      return api.decodeArchiveBytes((await api.readPath(path)).data, path);
    });
    assetsByFolder.set(folder, assets);
  }
  return assets;
}

export function GameTextPreview({ folder, file, id, font, text, originalText, place, lookup, inGamePreview, onInGamePreviewChange }: {
  folder: string; file: string; id: number; font: any; text: string; originalText: string; place: string; lookup: Lookup;
  inGamePreview: boolean; onInGamePreviewChange: (enabled: boolean) => void;
}) {
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const [choice, setChoice] = React.useState("auto");
  const [state, setState] = React.useState<"drawing" | "screen" | "font" | "missing">("drawing");
  const display = choice === "auto" ? defaultDisplay(file, id, originalText) : choice;

  React.useEffect(() => {
    const c = canvas.current, g = c?.getContext("2d");
    if (!c || !g) return;
    if (!inGamePreview || !folder) { drawMessage(g, c, font, text); setState("font"); return; }
    let cancelled = false;
    // While typing, redraw at most once per frame.
    const frame = requestAnimationFrame(async () => {
      const assets = assetsFor(folder);
      await assets.load(archivesFor(display));
      if (cancelled) return;
      if (archivesFor(display).some((name) => !assets.archives.get(name))) { drawMessage(g, c, font, text); setState("missing"); return; }
      const off = document.createElement("canvas");
      off.width = SCREEN_W; off.height = SCREEN_H;
      const og = off.getContext("2d")!;
      og.fillStyle = "#000"; og.fillRect(0, 0, SCREEN_W, SCREEN_H);
      drawDisplay(assets, og, display, { file, id, text, lookup });
      if (cancelled) return;
      c.width = SCREEN_W; c.height = SCREEN_H;
      g.drawImage(off, 0, 0);
      setState("screen");
    });
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [folder, display, file, id, text, lookup, font, inGamePreview]);

  return (
    <div className="shrink-0">
      <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px]">
        <span className="font-medium text-foreground">{inGamePreview ? "Game screen" : "Font preview"}</span>
        <div className="flex items-center gap-2">
          {inGamePreview && (
            <Select value={choice} onValueChange={setChoice}>
              <SelectTrigger className="h-7 w-56 text-[11px]" aria-label="Game screen to show"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Automatic · {(DISPLAYS as Record<string, string>)[defaultDisplay(file, id, originalText)]}</SelectItem>
                {Object.entries(DISPLAYS).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <label className="flex cursor-pointer items-center gap-1.5 text-muted-foreground">
            <input type="checkbox" aria-label="Preview in game screen" className="accent-primary" checked={inGamePreview} onChange={(e) => onInGamePreviewChange(e.target.checked)} />
            Game screen
          </label>
        </div>
      </div>
      <canvas ref={canvas} role="img" width={608} height={456}
        aria-label={inGamePreview ? `${(DISPLAYS as Record<string, string>)[display]} preview for ${place}` : `Text preview for ${place}`}
        className="block h-auto max-h-[52vh] w-auto max-w-full rounded-md border border-white/15 shadow-md" style={{ imageRendering: "auto" }} />
      <div className="mt-1 text-[10.5px] leading-relaxed text-muted-foreground">
        {state === "screen"
          ? "Drawn from the game's own files in Scene\\UI (layouts, textures, animations and fonts), with this text in its place. Text wider than its box is squeezed to fit, like in the game. Character and vehicle models, trophies and course movies are 3D or video and are not drawn."
          : state === "missing"
            ? "The game files for this screen were not found in the Scene\\UI folder. Showing the font only."
            : state === "font" ? (inGamePreview ? "Choose the game's Scene\\UI folder to see the game screen." : "Game screen preview is off; showing the font only.") : "Drawing…"}
      </div>
    </div>
  );
}

function drawMessage(g: CanvasRenderingContext2D, c: HTMLCanvasElement, font: any, text: string) {
  const width = 608, pad = 22, runs = toRuns(text, "#ffffff"), scale = .6 * fontSizePercent(text) / 100;
  const lines = plainText(text).split("\n");
  let size = { width: 0, height: lines.length * 26 };
  if (font) size = drawText(document.createElement("canvas").getContext("2d")!, font, runs, 0, 0, { scale, maxWidth: width - pad * 2 });
  // drawText measures line feeds; a glyph can extend below the last line feed.
  const glyphOverflow = font ? Math.max(0, ((font.cellH || font.height) - (font.lineFeed || font.height)) * scale) : 0;
  const height = Math.max(90, Math.ceil(size.height + glyphOverflow + pad * 2));
  c.width = width; c.height = height;
  g.fillStyle = "#101010";
  g.fillRect(0, 0, width, height);
  if (font) drawText(g, font, runs, pad, (height - size.height) / 2, { scale, maxWidth: width - pad * 2 });
  else {
    g.fillStyle = "#fff"; g.font = `600 ${20 * fontSizePercent(text) / 100}px sans-serif`;
    lines.forEach((line, i) => g.fillText(line, pad, pad + 20 + i * 26, width - pad * 2));
  }
}

function toRuns(text: string, color: string) {
  const runs: { text: string; color: string }[] = [];
  let last = 0;
  for (const e of escapes(text)) {
    if (e.start > last) runs.push({ text: text.slice(last, e.start), color });
    if (!(e.bytes[1] === 0 && e.bytes[2] === 0 && e.bytes[3] === 0)) runs.push({ text: "◆", color: "#9aa4b8" });
    last = e.end;
  }
  if (last < text.length) runs.push({ text: text.slice(last), color });
  return runs;
}
