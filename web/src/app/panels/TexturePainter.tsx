import * as React from "react";
import { Eraser, ImagePlus, Layers, Move, Paintbrush, Pipette, Redo2, Save, Trash2, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { api, FILTERS } from "../../../js/api.js";
import { decodeTexture, parseBRRES, TEXTURE_FORMATS } from "../../../js/formats/brres.js";
import { editor } from "../editor";
import { useEditHistory, useHistoryKeys } from "../edit-history";

function restoreStroke(pixels: Uint8ClampedArray, original: Uint8ClampedArray, width: number, height: number, from: { x: number; y: number }, to: { x: number; y: number }, radius: number) {
  // Include pixels touched by a brush centered on a texel boundary (especially a 1 px brush).
  const reach = radius + Math.SQRT1_2;
  const left = Math.max(0, Math.floor(Math.min(from.x, to.x) - reach));
  const right = Math.min(width - 1, Math.ceil(Math.max(from.x, to.x) + reach));
  const top = Math.max(0, Math.floor(Math.min(from.y, to.y) - reach));
  const bottom = Math.min(height - 1, Math.ceil(Math.max(from.y, to.y) + reach));
  const dx = to.x - from.x, dy = to.y - from.y, length2 = dx * dx + dy * dy;
  for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
    const t = length2 ? Math.max(0, Math.min(1, ((x + 0.5 - from.x) * dx + (y + 0.5 - from.y) * dy) / length2)) : 0;
    const px = from.x + dx * t, py = from.y + dy * t;
    if ((x + 0.5 - px) ** 2 + (y + 0.5 - py) ** 2 > reach ** 2) continue;
    const i = (y * width + x) * 4;
    pixels.set(original.subarray(i, i + 4), i);
  }
}

// A PNG placed over the texture that stays editable: it can be moved and resized at any time,
// and the texture holds the result (base + overlay) after every change.
type Overlay = { img: HTMLImageElement; url: string; x: number; y: number; w: number; h: number };
type Layered = { base: Uint8ClampedArray; overlay: Overlay };
// Per archive version (the BRRES bytes, also restored by undo/redo) and texture: the pixels
// under the overlay and where the overlay was, so undo brings the overlay back editable.
const overlayMemory = new WeakMap<Uint8Array, Map<string, Layered>>();
type Handle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const HANDLES: Exclude<Handle, "move">[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const HANDLE_CURSOR: Record<Handle, string> = { move: "move", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", ne: "nesw-resize", sw: "nesw-resize", nw: "nwse-resize", se: "nwse-resize" };

// decode: reads the texture from containers other than a BRRES (effect textures in a BREFT).
// staged: strokes stay in a working copy with its own Undo / Redo until Save hands the bytes to
// staged.save; onDirtyChange tells the window whether there is something unsaved (to warn on close).
// Leaving with unsaved strokes puts the saved texture back in the 3D preview.
export function TexturePainter({ name, bytes: savedBytes, tall = false, originalKey = name, onPreview, onCommit, decode, staged, onDirtyChange }: {
  name: string; bytes: Uint8Array; tall?: boolean; originalKey?: string;
  onPreview?: (pixels: Uint8ClampedArray) => void;
  onCommit?: (pixels: Uint8ClampedArray) => boolean;
  decode?: (bytes: Uint8Array, name: string) => { width: number; height: number; format: number; pixels: Uint8ClampedArray } | null;
  staged?: { encode: (bytes: Uint8Array, pixels: Uint8ClampedArray) => Uint8Array; save: (bytes: Uint8Array) => boolean | void };
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [working, setWorking] = React.useState(savedBytes);
  const history = useEditHistory((_path, data) => setWorking(data));
  React.useEffect(() => { if (!history.unsaved) setWorking(savedBytes); }, [savedBytes]);
  const bytes = staged ? working : savedBytes;
  const dirty = !!staged && history.unsaved && working !== savedBytes;
  React.useEffect(() => { onDirtyChange?.(dirty); }, [dirty]);
  const decodeBytes = (data: Uint8Array) => {
    try {
      if (decode) return decode(data, name);
      const tex = parseBRRES(data).textures.get(name);
      return tex ? { width: tex.width, height: tex.height, format: tex.format, pixels: Uint8ClampedArray.from(decodeTexture(tex)) } : null;
    } catch { return null; }
  };
  const saveStaged = () => {
    if (!staged || !dirty) return;
    try { if (staged.save(working) !== false) { history.saved(); onDirtyChange?.(false); } }
    catch (error: any) { toast.error("Could not save the texture", { description: error.message }); }
  };
  useHistoryKeys(history, saveStaged, !!staged);
  const unsavedRef = React.useRef(false);
  unsavedRef.current = dirty;
  const restoreRef = React.useRef<() => void>(() => {});
  restoreRef.current = () => {
    const saved = decodeBytes(savedBytes);
    if (saved) (onPreview || ((pixels: Uint8ClampedArray) => editor.previewSelectedTexture(name, pixels)))(saved.pixels);
  };
  React.useEffect(() => () => { if (unsavedRef.current) restoreRef.current(); }, []);
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const brushPreview = React.useRef<HTMLDivElement>(null);
  const pixelReadout = React.useRef<HTMLSpanElement>(null);
  const savedPixels = React.useRef<Uint8ClampedArray | null>(null);
  const stroke = React.useRef<{ x: number; y: number } | null>(null);
  const previewFrame = React.useRef<number | null>(null);
  const scroller = React.useRef<HTMLDivElement>(null);
  const wheelAnchor = React.useRef<{ u: number; v: number; ox: number; oy: number } | null>(null);
  // Right (or middle) button drag scrolls the zoomed texture.
  const pan = React.useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [panning, setPanning] = React.useState(false);
  const [color, setColor] = React.useState("#ff3030");
  const [size, setSize] = React.useState(() => editor.settings.textureBrushSize);
  const [eraser, setEraser] = React.useState(false);
  const [picking, setPicking] = React.useState(false);
  const [zoom, setZoom] = React.useState(0);
  const [moving, setMoving] = React.useState(false); // "Move overlay" tool
  const [overlay, setOverlayState] = React.useState<Overlay | null>(null);
  const overlayRef = React.useRef<Overlay | null>(null);
  const setOverlay = (next: Overlay | null) => { overlayRef.current = next; setOverlayState(next); };
  // Set by our own commit and picked up when the new bytes arrive (undefined: not our change).
  const pendingLayer = React.useRef<Layered | null | undefined>(undefined);
  const committed = React.useRef<Layered | null>(null);
  const overlayDrag = React.useRef<{ handle: Handle; x: number; y: number; start: Overlay; scale: number } | null>(null);
  const source = React.useMemo(() => decodeBytes(bytes), [bytes, name]);

  React.useEffect(() => {
    const el = canvas.current;
    if (!el || !source) return;
    if (previewFrame.current !== null) cancelAnimationFrame(previewFrame.current);
    previewFrame.current = null;
    stroke.current = null;
    el.width = source.width;
    el.height = source.height;
    const ctx = el.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    if (!editor.textureOriginals.has(originalKey)) editor.textureOriginals.set(originalKey, new Uint8ClampedArray(source.pixels));
    let layered = overlayMemory.get(bytes)?.get(name) || null;
    if (pendingLayer.current !== undefined) {
      if (pendingLayer.current) {
        if (!overlayMemory.has(bytes)) overlayMemory.set(bytes, new Map());
        overlayMemory.get(bytes)!.set(name, pendingLayer.current);
        layered = pendingLayer.current;
      } else overlayMemory.get(bytes)?.delete(name);
      pendingLayer.current = undefined;
    }
    committed.current = layered;
    const base = layered && layered.base.length === source.pixels.length ? layered.base : source.pixels;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(base), source.width, source.height), 0, 0);
    if (staged) (onPreview || ((pixels: Uint8ClampedArray) => editor.previewSelectedTexture(name, pixels)))(source.pixels);
    setOverlay(layered && base === layered.base ? { ...layered.overlay } : null);
    savedPixels.current = base;
    return () => {
      if (previewFrame.current !== null) cancelAnimationFrame(previewFrame.current);
      previewFrame.current = null;
      if (stroke.current && savedPixels.current) (onPreview || ((pixels) => editor.previewSelectedTexture(name, pixels)))(savedPixels.current);
      stroke.current = null;
    };
  }, [source, bytes, name, originalKey, onPreview]);

  const zoomSteps = [0, 1, 2, 4, 8, 16];
  const changeZoom = (direction: number) => setZoom((current) => zoomSteps[Math.max(0, Math.min(zoomSteps.length - 1, zoomSteps.indexOf(current) + direction))]);
  // Mouse wheel zoom keeps the texel under the cursor in place.
  const onWheel = (e: WheelEvent) => {
    const box = scroller.current, el = canvas.current;
    if (!box || !el || !e.deltaY) return;
    const index = zoomSteps.indexOf(zoom), next = zoomSteps[Math.max(0, Math.min(zoomSteps.length - 1, index + (e.deltaY < 0 ? 1 : -1)))];
    if (next === zoom) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect(), boxRect = box.getBoundingClientRect();
    const u = (e.clientX - rect.left) / rect.width, v = (e.clientY - rect.top) / rect.height;
    const ox = e.clientX - boxRect.left, oy = e.clientY - boxRect.top;
    wheelAnchor.current = { u, v, ox, oy };
    setZoom(next);
  };
  // Native, non-passive listener: the page only stops scrolling when the zoom actually changes.
  const wheelHandler = React.useRef(onWheel);
  wheelHandler.current = onWheel;
  React.useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const listener = (e: WheelEvent) => wheelHandler.current(e);
    box.addEventListener("wheel", listener, { passive: false });
    return () => box.removeEventListener("wheel", listener);
  }, [source]);
  // Size of the drawing area: "Fit" shows the whole texture inside it, whatever its shape.
  const [area, setArea] = React.useState({ w: 0, h: 0 });
  React.useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const observer = new ResizeObserver(() => setArea({ w: box.clientWidth, h: box.clientHeight }));
    observer.observe(box);
    return () => observer.disconnect();
  }, [source]);
  React.useLayoutEffect(() => {
    const a = wheelAnchor.current, box = scroller.current, el = canvas.current;
    if (!a || !box || !el) return;
    wheelAnchor.current = null;
    const rect = el.getBoundingClientRect(), boxRect = box.getBoundingClientRect();
    box.scrollLeft += rect.left - boxRect.left + a.u * rect.width - a.ox;
    box.scrollTop += rect.top - boxRect.top + a.v * rect.height - a.oy;
  }, [zoom]);

  if (!source) return <p className="text-xs text-muted-foreground">Texture preview unavailable.</p>;

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(source.width - 1, (e.clientX - r.left) * source.width / r.width)),
      y: Math.max(0, Math.min(source.height - 1, (e.clientY - r.top) * source.height / r.height)),
    };
  };
  const showBrush = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    const preview = brushPreview.current;
    if (preview) {
      const diameter = Math.max(4, size * rect.width / source.width);
      Object.assign(preview.style, { display: "block", left: `${x}px`, top: `${y}px`, width: `${diameter}px`, height: `${diameter}px` });
    }
    if (pixelReadout.current) pixelReadout.current.textContent = `${Math.floor(x * source.width / rect.width)}, ${Math.floor(y * source.height / rect.height)}`;
  };
  const hideBrush = () => { if (brushPreview.current) brushPreview.current.style.display = "none"; };
  const showPreview = (pixels: Uint8ClampedArray) => (onPreview || ((data) => editor.previewSelectedTexture(name, data)))(pixels);
  const commitPixels = (pixels: Uint8ClampedArray) => {
    if (staged) {
      try { history.record("texture", bytes, staged.encode(bytes, pixels), `Paint ${name}`); onDirtyChange?.(true); return true; }
      catch (e: any) { toast.error("Could not paint the texture", { description: e.message }); return false; }
    }
    return (onCommit || ((data) => editor.commitSelectedTexture(name, data)))(pixels);
  };
  // The texture as the game will show it: the painted pixels with the overlay drawn on top.
  const composite = (layer: Overlay | null = overlayRef.current) => {
    const ctx = canvas.current?.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    const base = ctx.getImageData(0, 0, source.width, source.height);
    if (!layer) return base.data;
    const out = document.createElement("canvas");
    out.width = source.width;
    out.height = source.height;
    const o = out.getContext("2d", { willReadFrequently: true })!;
    o.putImageData(base, 0, 0);
    o.drawImage(layer.img, layer.x, layer.y, layer.w, layer.h);
    return o.getImageData(0, 0, source.width, source.height).data;
  };
  // Saves base + overlay into the texture; on failure goes back to the last saved state.
  const commit = (layer: Overlay | null = overlayRef.current) => {
    const ctx = canvas.current?.getContext("2d", { willReadFrequently: true });
    const pixels = composite(layer);
    if (!ctx || !pixels) return false;
    showPreview(pixels);
    const base = ctx.getImageData(0, 0, source.width, source.height).data;
    pendingLayer.current = layer ? { base: new Uint8ClampedArray(base), overlay: { ...layer } } : null;
    if (commitPixels(pixels)) return true;
    pendingLayer.current = undefined;
    const last = committed.current;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(last?.base || savedPixels.current || base), source.width, source.height), 0, 0);
    setOverlay(last ? { ...last.overlay } : null);
    const restored = composite(last ? last.overlay : null);
    if (restored) showPreview(restored);
    return false;
  };
  const pickColor = (at: { x: number; y: number }) => {
    const pixels = composite();
    if (!pixels) return;
    const i = (Math.floor(at.y) * source.width + Math.floor(at.x)) * 4;
    const rgb = pixels.subarray(i, i + 3);
    setColor(`#${[rgb[0], rgb[1], rgb[2]].map((n) => n.toString(16).padStart(2, "0")).join("")}`);
    setPicking(false);
    setEraser(false);
  };
  const preview = () => {
    if (previewFrame.current !== null) return;
    previewFrame.current = requestAnimationFrame(() => {
      previewFrame.current = null;
      const pixels = composite();
      if (pixels) showPreview(pixels);
    });
  };
  const draw = (next: { x: number; y: number }) => {
    const ctx = canvas.current?.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    const last = stroke.current;
    if (eraser) {
      const original = editor.textureOriginals.get(originalKey);
      if (!original || original.length !== source.pixels.length) return;
      const frame = ctx.getImageData(0, 0, source.width, source.height);
      restoreStroke(frame.data, original, source.width, source.height, last || next, next, size / 2);
      ctx.putImageData(frame, 0, 0);
      stroke.current = next;
      preview();
      return;
    }
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = size;
    if (last) {
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(next.x, next.y);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(next.x, next.y, size / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    stroke.current = next;
    preview();
  };
  const finish = () => {
    if (!stroke.current) return;
    stroke.current = null;
    if (previewFrame.current !== null) cancelAnimationFrame(previewFrame.current);
    previewFrame.current = null;
    commit();
  };

  const loadPNG = async (mode: "replace" | "overlay") => {
    const file = await api.openFile(FILTERS.png, mode === "overlay" ? `Overlay PNG on ${name}` : `Replace ${name} with PNG`);
    if (!file) return;
    const ctx = canvas.current?.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    try {
      const url = URL.createObjectURL(new Blob([file.data], { type: "image/png" }));
      const img = new Image();
      img.src = url;
      await img.decode();
      if (mode === "replace") {
        ctx.clearRect(0, 0, source.width, source.height);
        ctx.drawImage(img, 0, 0, source.width, source.height);
        URL.revokeObjectURL(url);
        commit();
        return;
      }
      // A previous overlay becomes part of the texture, the new one floats on top.
      const previous = overlayRef.current;
      if (previous) ctx.drawImage(previous.img, previous.x, previous.y, previous.w, previous.h);
      // Same proportions as the PNG, as large as fits, centred.
      const fit = Math.min(source.width / img.naturalWidth, source.height / img.naturalHeight);
      const w = Math.max(1, img.naturalWidth * fit), h = Math.max(1, img.naturalHeight * fit);
      const next = { img, url, x: (source.width - w) / 2, y: (source.height - h) / 2, w, h };
      setOverlay(next);
      setMoving(true);
      setEraser(false);
      setPicking(false);
      commit(next);
    } catch (error: any) { toast.error("Could not load PNG", { description: error.message }); }
  };
  const mergeOverlay = () => {
    const ctx = canvas.current?.getContext("2d", { willReadFrequently: true }), layer = overlayRef.current;
    if (!ctx || !layer) return;
    ctx.drawImage(layer.img, layer.x, layer.y, layer.w, layer.h);
    setOverlay(null);
    setMoving(false);
    commit(null);
  };
  const removeOverlay = () => {
    if (!overlayRef.current) return;
    setOverlay(null);
    if (commit(null)) setMoving(false);
  };
  const fitOverlay = () => {
    const layer = overlayRef.current;
    if (!layer) return;
    const next = { ...layer, x: 0, y: 0, w: source.width, h: source.height };
    setOverlay(next);
    commit(next);
  };
  const startOverlayDrag = (e: React.PointerEvent, handle: Handle) => {
    const layer = overlayRef.current, el = canvas.current;
    if (!layer || !el || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    overlayDrag.current = { handle, x: e.clientX, y: e.clientY, start: { ...layer }, scale: source.width / el.getBoundingClientRect().width };
  };
  const moveOverlay = (e: React.PointerEvent) => {
    const drag = overlayDrag.current;
    if (!drag) return;
    e.stopPropagation();
    const dx = (e.clientX - drag.x) * drag.scale, dy = (e.clientY - drag.y) * drag.scale, s = drag.start;
    let { x, y, w, h } = s;
    const hd = drag.handle;
    if (hd === "move") { x += dx; y += dy; }
    else {
      if (hd.includes("e")) w = s.w + dx;
      if (hd.includes("w")) w = s.w - dx;
      if (hd.includes("s")) h = s.h + dy;
      if (hd.includes("n")) h = s.h - dy;
      // Corners keep the proportions (Shift: free).
      if (hd.length === 2 && !e.shiftKey) {
        const k = Math.max(w / s.w, h / s.h);
        w = s.w * k;
        h = s.h * k;
      }
      w = Math.max(1, w);
      h = Math.max(1, h);
      if (hd.includes("w")) x = s.x + s.w - w;
      if (hd.includes("n")) y = s.y + s.h - h;
    }
    setOverlay({ ...s, x, y, w, h });
    preview();
  };
  const endOverlayDrag = (e: React.PointerEvent) => {
    if (!overlayDrag.current) return;
    e.stopPropagation();
    overlayDrag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    commit();
  };
  const pct = (value: number, total: number) => `${(value / total) * 100}%`;

  return (
    <div data-texture-painter className={tall ? "flex min-h-0 flex-1 flex-col gap-2.5" : "space-y-3 rounded-md border bg-muted/20 p-2.5"}>
      <div className="flex items-center gap-2">
        <Paintbrush className="size-4 text-primary" />
        <span className="text-xs font-semibold">Edit texture</span>
        <span className="ml-auto text-[11px] text-muted-foreground">{source.width} × {source.height} · {TEXTURE_FORMATS[source.format] || source.format}</span>
      </div>
      <div role="toolbar" aria-label="Texture tools" className="flex flex-wrap gap-1">
        <Button size="sm" variant={!eraser && !picking && !moving ? "default" : "secondary"} aria-pressed={!eraser && !picking && !moving} onClick={() => { setEraser(false); setPicking(false); setMoving(false); }}><Paintbrush /> Paint</Button>
        <Button size="sm" variant={eraser ? "default" : "secondary"} aria-pressed={eraser} onClick={() => { setEraser(true); setPicking(false); setMoving(false); }}><Eraser /> Eraser</Button>
        <Button size="sm" variant={picking ? "default" : "secondary"} aria-pressed={picking} title="Click a pixel to use its color" onClick={() => { setPicking(true); setEraser(false); setMoving(false); }}><Pipette /> Pick color</Button>
        {overlay && <Button size="sm" variant={moving ? "default" : "secondary"} aria-pressed={moving} title="Select the overlay PNG to move or resize it" onClick={() => { setMoving(true); setEraser(false); setPicking(false); }}><Move /> Move overlay</Button>}
        {overlay && <Button size="sm" variant="secondary" title="Delete the PNG overlay and restore the texture underneath" onClick={removeOverlay}><Trash2 /> Delete overlay</Button>}
        <Button size="sm" variant="secondary" onClick={() => loadPNG("replace")}><ImagePlus /> Replace PNG…</Button>
        <Button size="sm" variant="secondary" onClick={() => loadPNG("overlay")}><ImagePlus /> Overlay PNG…</Button>
      </div>
      <label className="flex items-center gap-2 text-[11px] text-muted-foreground">Color
        <input aria-label="Brush color" type="color" value={color} onChange={(e) => { setColor(e.target.value); setEraser(false); setPicking(false); setMoving(false); }} className="size-7 cursor-pointer rounded border bg-transparent" />
        <span className="font-mono text-foreground">{color.toUpperCase()}</span>
      </label>
      <div className="flex items-center gap-2">
        <label htmlFor={`brush-size-${name}`} className="w-14 shrink-0 text-[11px] text-muted-foreground">Brush</label>
        <input id={`brush-size-${name}`} aria-label="Brush size" type="range" min="1" max={Math.min(128, Math.max(source.width, source.height))} value={size} onChange={(e) => setSize(Number(e.target.value))} onPointerUp={(e) => editor.setSetting("textureBrushSize", Number(e.currentTarget.value))} onKeyUp={(e) => editor.setSetting("textureBrushSize", Number(e.currentTarget.value))} className="min-w-0 flex-1 accent-primary" />
        <span className="w-10 text-right text-[11px] tabular-nums">{size} px</span>
      </div>
      {overlay && (
        <div className="flex flex-wrap items-center gap-1 rounded border px-2 py-1.5 text-[11px] text-muted-foreground">
          <Layers className="size-3.5" />
          <span className="mr-auto">Overlay PNG · {Math.round(overlay.w)} × {Math.round(overlay.h)} at {Math.round(overlay.x)}, {Math.round(overlay.y)}</span>
          <Button size="sm" variant="ghost" onClick={fitOverlay} title="Stretch the overlay over the whole texture">Fit to texture</Button>
          <Button size="sm" variant="ghost" onClick={mergeOverlay} title="Make the overlay part of the texture (it can no longer be moved)">Merge</Button>
        </div>
      )}
      <div className="flex items-center gap-1 border-t pt-2">
        {staged ? <>
          <Button size="sm" variant="ghost" disabled={!history.canUndo} onClick={history.undo} title="Undo the last stroke (Ctrl+Z)"><Undo2 /> Undo</Button>
          <Button size="sm" variant="ghost" disabled={!history.canRedo} onClick={history.redo} title="Redo (Ctrl+Y)"><Redo2 /> Redo</Button>
          <Button size="sm" variant={dirty ? "default" : "secondary"} disabled={!dirty} onClick={saveStaged} title="Apply the painted texture (Ctrl+S)"><Save /> Save texture</Button>
          {dirty && <span className="text-[11px] text-muted-foreground">Unsaved</span>}
        </> : <>
          <Button size="sm" variant="ghost" disabled={!editor.doc.undoStack.length} onClick={() => editor.cmd("undo")} title="Undo last edit (Ctrl+Z)"><Undo2 /> Undo</Button>
          <Button size="sm" variant="ghost" disabled={!editor.doc.redoStack.length} onClick={() => editor.cmd("redo")} title="Redo last edit (Ctrl+Y)"><Redo2 /> Redo</Button>
        </>}
        <div className="ml-auto flex items-center gap-0.5">
          <Button size="icon-sm" variant="ghost" aria-label="Zoom out" title="Zoom out" disabled={zoom === zoomSteps[0]} onClick={() => changeZoom(-1)}><ZoomOut /></Button>
          <span className="w-9 text-center text-[11px] tabular-nums">{zoom ? `${zoom * 100}%` : "Fit"}</span>
          <Button size="icon-sm" variant="ghost" aria-label="Zoom in" title="Zoom in" disabled={zoom === zoomSteps[zoomSteps.length - 1]} onClick={() => changeZoom(1)}><ZoomIn /></Button>
        </div>
      </div>
      <div ref={scroller} className={`${tall ? "min-h-[160px] flex-1" : "max-h-[420px]"} overflow-auto rounded border`} style={{ background: "repeating-conic-gradient(#505057 0% 25%, #414148 0% 50%) 0 0 / 16px 16px" }}>
        {/* Fit: the whole texture is visible, also tall ones (e.g. 64 × 512). */}
        <div className="relative mx-auto" style={{ width: zoom ? `${source.width * zoom}px` : tall && area.h ? `${Math.max(1, Math.min(area.w, area.h * source.width / source.height))}px` : `min(100%, calc(420px * ${source.width / source.height}))` }}>
          <canvas ref={canvas} aria-label={`Edit texture ${name}`} className="block h-auto w-full touch-none" style={{ imageRendering: "pixelated", cursor: panning ? "grabbing" : moving ? "default" : picking ? "copy" : "crosshair" }}
            onContextMenu={(e) => e.preventDefault()}
            onPointerDown={(e) => {
              if (e.button === 1 || e.button === 2) {
                e.preventDefault();
                const box = scroller.current;
                if (!box) return;
                pan.current = { x: e.clientX, y: e.clientY, left: box.scrollLeft, top: box.scrollTop };
                setPanning(true);
                hideBrush();
                e.currentTarget.setPointerCapture(e.pointerId);
                return;
              }
              if (e.button !== 0 || moving) return; e.preventDefault(); if (picking) { pickColor(point(e)); return; } e.currentTarget.setPointerCapture(e.pointerId); showBrush(e); draw(point(e));
            }}
            onPointerMove={(e) => {
              const p = pan.current, box = scroller.current;
              if (p && box) { box.scrollLeft = p.left - (e.clientX - p.x); box.scrollTop = p.top - (e.clientY - p.y); return; }
              if (!moving) showBrush(e); if (stroke.current) draw(point(e));
            }}
            onPointerLeave={hideBrush}
            onPointerUp={(e) => { if (pan.current) { pan.current = null; setPanning(false); if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); return; } finish(); }}
            onPointerCancel={() => { pan.current = null; setPanning(false); finish(); }}
            onLostPointerCapture={() => { if (pan.current) { pan.current = null; setPanning(false); return; } finish(); }} />
          {overlay && (
            <>
              <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <img src={overlay.url} alt="" draggable={false} className="absolute max-w-none select-none"
                  style={{ left: pct(overlay.x, source.width), top: pct(overlay.y, source.height), width: pct(overlay.w, source.width), height: pct(overlay.h, source.height), imageRendering: "pixelated" }} />
              </div>
              {/* Selection frame: drag inside to move, handles to resize. Only in the Move overlay tool, so painting goes through. */}
              <div className={`absolute ${moving ? "outline outline-1 outline-white shadow-[0_0_0_2px_#000]" : "pointer-events-none"}`}
                style={{ left: pct(overlay.x, source.width), top: pct(overlay.y, source.height), width: pct(overlay.w, source.width), height: pct(overlay.h, source.height), cursor: moving ? "move" : undefined }}
                onPointerDown={(e) => startOverlayDrag(e, "move")} onPointerMove={moveOverlay} onPointerUp={endOverlayDrag} onPointerCancel={endOverlayDrag}>
                {moving && HANDLES.map((handle) => (
                  <div key={handle} className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 border border-black bg-white"
                    style={{ left: handle.includes("w") ? "0%" : handle.includes("e") ? "100%" : "50%", top: handle.includes("n") ? "0%" : handle.includes("s") ? "100%" : "50%", cursor: HANDLE_CURSOR[handle] }}
                    onPointerDown={(e) => startOverlayDrag(e, handle)} onPointerMove={moveOverlay} onPointerUp={endOverlayDrag} onPointerCancel={endOverlayDrag} />
                ))}
              </div>
            </>
          )}
          <div ref={brushPreview} className="pointer-events-none absolute hidden -translate-x-1/2 -translate-y-1/2 rounded-full border border-white shadow-[0_0_0_1px_#000]" />
        </div>
      </div>
      <div className="flex items-start gap-3 text-[11px] leading-relaxed text-muted-foreground">
        <p className="m-0 flex-1">{staged ? "Strokes stay in this window until Save texture applies them (Undo and Redo step through them); closing with unsaved strokes asks first." : onCommit ? "Paint updates the 3D object after each stroke." : "Paint updates the 3D model as you draw."} Overlay PNG places the PNG over the texture: with Move overlay, drag it to move it and drag the handles to resize it (corners keep the proportions, Shift resizes freely), whenever you want. Merge makes it part of the texture. Replace PNG replaces all the pixels, stretched to the texture. Eraser brings back the original pixels under the brush. Wheel zooms, right-drag moves around.{staged ? "" : " Save the SZS (Ctrl+S) to keep the changes."}</p>
        <span className="shrink-0">Pixel <span ref={pixelReadout} className="tabular-nums">–</span></span>
      </div>
    </div>
  );
}
