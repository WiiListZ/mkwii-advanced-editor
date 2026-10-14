// Preview NW4R menu resources directly from an open SZS archive.
import * as React from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { listFiles } from "../../../js/formats/u8.js";
import { decodeTexture, TEXTURE_FORMATS } from "../../../js/formats/brres.js";
import { parseBRLYT, parseBRLAN, parseTPL } from "../../../js/formats/brlyt.js";
import { parseBRFNT } from "../../../js/formats/brfnt.js";
import { MenuAssets } from "../../../js/editor/menu-screens.js";

export type MenuResourceFormat = "brlyt" | "brlan" | "brfnt" | "tpl";

const label: Record<MenuResourceFormat, string> = {
  brlyt: "Menu layout (BRLYT)", brlan: "Menu animation (BRLAN)", brfnt: "Font (BRFNT)", tpl: "Texture (TPL)",
};
const basename = (path: string) => path.split("/").pop() || path;
const stem = (path: string) => basename(path).replace(/\.[^.]+$/, "").toLowerCase();
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

function PaneList({ pane, depth = 0 }: { pane: any; depth?: number }) {
  return <>
    <div className="flex gap-2 border-b border-border/50 py-1 text-xs" style={{ paddingLeft: depth * 12 }}>
      <span className="min-w-0 flex-1 truncate font-mono" title={pane.name}>{pane.name || "(unnamed)"}</span>
      <span className="text-muted-foreground">{pane.kind}</span>
    </div>
    {pane.children?.map((child: any, i: number) => <PaneList key={`${child.name}-${i}`} pane={child} depth={depth + 1} />)}
  </>;
}

export function MenuResourceDialog({ tree, filePath, format, close }: {
  tree: any; filePath: string; format: MenuResourceFormat; close: (value: any) => void;
}) {
  const files = React.useMemo(() => listFiles(tree), [tree]);
  const data = files.find((file: any) => file.path === filePath)?.node.data as Uint8Array | undefined;
  const layoutPaths = React.useMemo(() => files.map((file: any) => file.path as string).filter((path: string) => /\.brlyt$/i.test(path)), [files]);
  const animationPaths = React.useMemo(() => files.map((file: any) => file.path as string).filter((path: string) => /\.brlan$/i.test(path)), [files]);
  const assets = React.useMemo(() => {
    const result = new MenuAssets(async () => null);
    result.archives.set("open archive", new Map(files.map((file: any) => [file.path.toLowerCase(), file.node.data])));
    return result;
  }, [files]);
  const parsed = React.useMemo((): { value: any; error: string } => {
    try {
      if (!data) throw new Error("File not found in this archive.");
      return { value: format === "brlyt" ? parseBRLYT(data) : format === "brlan" ? parseBRLAN(data) : format === "brfnt" ? parseBRFNT(data) : parseTPL(data), error: "" };
    } catch (error) { return { value: null, error: errorText(error) }; }
  }, [data, format]);
  const suggestedLayout = React.useMemo(() => {
    if (format === "brlyt") return filePath;
    return [...layoutPaths].sort((a, b) => stem(b).length - stem(a).length)
      .find((path) => stem(filePath).startsWith(`${stem(path)}_`)) || layoutPaths[0] || "";
  }, [filePath, format, layoutPaths]);
  const [layoutPath, setLayoutPath] = React.useState(suggestedLayout);
  const [animationPath, setAnimationPath] = React.useState(format === "brlan" ? filePath : "");
  const [frame, setFrame] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [imageIndex, setImageIndex] = React.useState(0);
  const [renderError, setRenderError] = React.useState("");
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const layout = layoutPath ? assets.layout(layoutPath) : null;
  const animation = animationPath ? assets.anim(animationPath) : null;

  React.useEffect(() => {
    if (!playing || !animation?.frames) return;
    const timer = window.setInterval(() => setFrame((current) => current >= animation.frames ? (animation.loop ? 0 : animation.frames) : current + 1), 1000 / 60);
    return () => window.clearInterval(timer);
  }, [playing, animation]);

  React.useEffect(() => {
    const target = canvas.current;
    if (!target || !parsed.value) return;
    try {
      if (format === "brlyt" || format === "brlan") {
        if (!layout?.root) return;
        target.width = 608; target.height = 456;
        const context = target.getContext("2d")!;
        context.fillStyle = "#1a1a1a";
        context.fillRect(0, 0, target.width, target.height);
        assets.drawLayout(context, layout, { anims: animationPath ? [animationPath] : [], frame });
      } else {
        const item = format === "tpl" ? parsed.value[imageIndex] : parsed.value.sheets[imageIndex];
        if (!item) return;
        const image = format === "tpl" ? item.image : item;
        const rgba = decodeTexture(image, format === "tpl" ? item.palette : null);
        const pixels = new Uint8ClampedArray(rgba);
        if (format === "brfnt" && (image.format === 0 || image.format === 1)) {
          for (let i = 0; i < pixels.length; i += 4) { pixels[i + 3] = pixels[i]; pixels[i] = pixels[i + 1] = pixels[i + 2] = 255; }
        }
        target.width = image.width; target.height = image.height;
        target.getContext("2d")!.putImageData(new ImageData(pixels, image.width, image.height), 0, 0);
      }
      setRenderError("");
    } catch (error) { setRenderError(errorText(error)); }
  }, [assets, parsed, format, layout, animationPath, frame, imageIndex]);

  const images = format === "tpl" ? parsed.value as any[] | null : format === "brfnt" ? parsed.value?.sheets as any[] | undefined : null;
  const showLayout = format === "brlyt" || format === "brlan";

  return <div className="flex h-full min-h-0 flex-col gap-3">
    <Button size="icon-sm" variant="ghost" className="absolute right-3 top-3" title="Close" aria-label="Close preview" onClick={() => close(null)}><X /></Button>
    <div className="shrink-0 pr-8">
      <DialogTitle className="truncate text-sm" title={filePath}>{basename(filePath)}</DialogTitle>
      <DialogDescription className="text-xs">{label[format]} · {filePath} · read-only preview</DialogDescription>
    </div>
    {parsed.error ? <p className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">Could not read this file: {parsed.error}</p> : <>
      {showLayout && <div className="flex shrink-0 flex-wrap items-end gap-3 text-xs">
        {format === "brlan" && <label className="flex min-w-48 flex-1 flex-col gap-1">Layout
          <select className="h-8 rounded-md border bg-background px-2" value={layoutPath} onChange={(event) => setLayoutPath(event.target.value)}>
            {!layoutPaths.length && <option value="">No BRLYT in this archive</option>}
            {layoutPaths.map((path) => <option key={path} value={path}>{path}</option>)}
          </select>
        </label>}
        {format === "brlyt" && !!animationPaths.length && <label className="flex min-w-48 flex-1 flex-col gap-1">Animation
          <select className="h-8 rounded-md border bg-background px-2" value={animationPath} onChange={(event) => { setAnimationPath(event.target.value); setFrame(0); }}>
            <option value="">None</option>
            {animationPaths.map((path) => <option key={path} value={path}>{path}</option>)}
          </select>
        </label>}
        {!!animation?.frames && <>
          <Button size="sm" variant="secondary" onClick={() => setPlaying(!playing)}>{playing ? "Pause" : "Play"}</Button>
          <label className="flex min-w-44 flex-1 items-center gap-2">Frame
            <input type="range" min="0" max={animation.frames} value={frame} onChange={(event) => { setPlaying(false); setFrame(Number(event.target.value)); }} className="min-w-20 flex-1" />
            <span className="w-14 text-right tabular-nums">{frame}/{animation.frames}</span>
          </label>
        </>}
      </div>}
      {!!images && images.length > 1 && <label className="flex shrink-0 items-center gap-2 text-xs">{format === "tpl" ? "Texture" : "Font sheet"}
        <select className="h-8 rounded-md border bg-background px-2" value={imageIndex} onChange={(event) => setImageIndex(Number(event.target.value))}>
          {images.map((_, index) => <option key={index} value={index}>{index + 1} / {images.length}</option>)}
        </select>
      </label>}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto lg:flex-row">
        <div className="flex min-h-64 min-w-0 flex-[2] items-center justify-center overflow-auto rounded-md border bg-[#1a1a1a] p-3">
          {showLayout && !layout?.root ? <p className="text-center text-xs text-muted-foreground">No readable BRLYT layout is available for this preview. The file details are shown beside it.</p>
            : renderError ? <p className="text-center text-xs text-destructive">Preview failed: {renderError}</p>
            : <canvas ref={canvas} className="max-h-full max-w-full object-contain [image-rendering:pixelated]" aria-label={`${label[format]} preview`} />}
        </div>
        <div className="min-w-0 flex-1 overflow-y-auto rounded-md border p-3 text-xs">
          {format === "brlyt" && parsed.value && <>
            <p className="mb-2 font-medium">{parsed.value.width} × {parsed.value.height} · {parsed.value.materials.length} materials · {parsed.value.textures.length} textures</p>
            {!!parsed.value.textures.length && <p className="mb-3 break-words text-muted-foreground">Textures: {parsed.value.textures.join(", ")}</p>}
            {!!parsed.value.fonts.length && <p className="mb-3 break-words text-muted-foreground">Fonts: {parsed.value.fonts.join(", ")}</p>}
            <p className="mb-1 font-medium">Panes</p>
            {parsed.value.root && <PaneList pane={parsed.value.root} />}
          </>}
          {format === "brlan" && parsed.value && <>
            <p className="mb-2 font-medium">{parsed.value.frames} frames · {parsed.value.loop ? "looping" : "one shot"} · {parsed.value.panes.length} animated entries</p>
            {parsed.value.panes.map((entry: any, index: number) => <div key={`${entry.name}-${index}`} className="border-b py-1.5">
              <div className="truncate font-mono" title={entry.name}>{entry.name}</div>
              <div className="text-muted-foreground">{entry.material ? "Material" : "Pane"} · {entry.tags.length} channels · {entry.tags.reduce((sum: number, tag: any) => sum + tag.keys.length, 0)} keys</div>
            </div>)}
          </>}
          {format === "brfnt" && parsed.value && <>
            <p className="font-medium">{parsed.value.sheets.length} sheets · {parsed.value.chars.size} mapped characters</p>
            <p className="mt-2 text-muted-foreground">Glyph {parsed.value.width} × {parsed.value.height} · cell {parsed.value.cellW} × {parsed.value.cellH} · ascent {parsed.value.ascent}</p>
            {!!parsed.value.sheets[imageIndex] && <p className="mt-2 text-muted-foreground">Sheet {parsed.value.sheets[imageIndex].width} × {parsed.value.sheets[imageIndex].height} · {TEXTURE_FORMATS[parsed.value.sheets[imageIndex].format] || `format ${parsed.value.sheets[imageIndex].format}`}</p>}
          </>}
          {format === "tpl" && !!images?.[imageIndex] && <>
            <p className="font-medium">{images.length} texture{images.length === 1 ? "" : "s"}</p>
            <p className="mt-2 text-muted-foreground">{images[imageIndex].image.width} × {images[imageIndex].image.height} · {TEXTURE_FORMATS[images[imageIndex].image.format] || `format ${images[imageIndex].image.format}`}</p>
            <p className="mt-2 text-muted-foreground">{images[imageIndex].palette ? "Indexed palette" : "No palette"}</p>
          </>}
        </div>
      </div>
    </>}
    <div className="flex shrink-0 justify-end"><Button onClick={() => close(null)}>Done</Button></div>
  </div>;
}
