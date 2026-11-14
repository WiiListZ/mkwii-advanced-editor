// Changes a texture's format, size and mipmaps, from its own pixels or from an image of any size.
// The texture is written again (writeTEX0) and the BRRES rebuilt around it; resolves with the new
// BRRES, or null. Palette formats keep their palette and are edited in the texture painter.

import * as React from "react";
import { ImagePlus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { api } from "../../../js/api.js";
import { DIRECT_FORMATS, maxTextureLevels, parseBRRES, TEXTURE_FORMATS, textureLevelsSize, textureRGBA, writeTEX0 } from "../../../js/formats/brres.js";

const FORMAT_NOTES: Record<number, string> = {
  0: "4-bit grey", 1: "8-bit grey", 2: "4-bit grey and alpha", 3: "8-bit grey and alpha", 4: "16-bit colour, no alpha",
  5: "16-bit colour with 3-bit alpha (or opaque 15-bit)", 6: "32-bit colour and alpha (largest, exact)", 14: "Compressed colour, 1-bit alpha (smallest colour format)",
};
const SIZES = [4, 8, 16, 32, 64, 128, 256, 512, 1024];

// Bilinear resampling of RGBA pixels.
function resample(src: Uint8ClampedArray | Uint8Array, sw: number, sh: number, dw: number, dh: number) {
  if (sw === dw && sh === dh) return new Uint8Array(src);
  const out = new Uint8Array(dw * dh * 4);
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const fx = Math.max(0, (x + 0.5) * sw / dw - 0.5), fy = Math.max(0, (y + 0.5) * sh / dh - 0.5);
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
    for (let c = 0; c < 4; c++) {
      const a = src[(y0 * sw + x0) * 4 + c], b = src[(y0 * sw + x1) * 4 + c], d = src[(y1 * sw + x0) * 4 + c], e = src[(y1 * sw + x1) * 4 + c];
      out[(y * dw + x) * 4 + c] = Math.round((a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty);
    }
  }
  return out;
}

export function TextureFormatDialog({ brres, name, close }: { brres: Uint8Array; name: string; close: (v: Uint8Array | null) => void }) {
  const parsed = React.useMemo(() => parseBRRES(brres), [brres]);
  const tex = parsed.textures.get(name);
  const [image, setImage] = React.useState<{ pixels: Uint8ClampedArray | Uint8Array; width: number; height: number; label: string } | null>(() => tex ? { pixels: textureRGBA(parsed, tex), width: tex.width, height: tex.height, label: "the texture as it is" } : null);
  const [format, setFormat] = React.useState<number>(() => tex && DIRECT_FORMATS.includes(tex.format) ? tex.format : 14);
  const [width, setWidth] = React.useState(tex?.width ?? 64), [height, setHeight] = React.useState(tex?.height ?? 64);
  const [levels, setLevels] = React.useState(Math.max(1, tex?.mipmaps ?? 1));
  const [busy, setBusy] = React.useState(false);
  if (!tex || !image) return <p className="text-xs">Texture {name} not found.</p>;
  const sizes = [...new Set([...SIZES, tex.width, tex.height, image.width, image.height])].filter((n) => n >= 1 && n <= 1024).sort((a, b) => a - b);
  const maxLevels = maxTextureLevels(width, height);
  const bytes = textureLevelsSize(width, height, format, Math.min(levels, maxLevels));

  const loadImage = async () => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const bitmap = await createImageBitmap(file), canvas = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = canvas.getContext("2d")!;
        ctx.drawImage(bitmap, 0, 0);
        if (bitmap.width > 4096 || bitmap.height > 4096) throw new Error("The image is larger than 4096 pixels");
        setImage({ pixels: ctx.getImageData(0, 0, bitmap.width, bitmap.height).data, width: bitmap.width, height: bitmap.height, label: file.name });
        const fit = (n: number) => SIZES.reduce((best, s) => Math.abs(s - n) < Math.abs(best - n) ? s : best, 4);
        setWidth(fit(bitmap.width)); setHeight(fit(bitmap.height));
      } catch (e: any) { toast.error("Could not read the image", { description: e.message }); }
    };
    input.click();
  };
  const apply = async () => {
    setBusy(true);
    try {
      const pixels = resample(image.pixels, image.width, image.height, width, height);
      const data = writeTEX0(name, pixels, width, height, format, Math.min(levels, maxLevels));
      close(await api.changeBRRESResources(brres, [{ folder: "Textures(NW4R)", name, data }]));
    } catch (e: any) { toast.error("Could not write the texture", { description: e.message }); }
    finally { setBusy(false); }
  };
  const select = (label: string, value: number, options: [number, string][], onChange: (v: number) => void) => <label className="flex items-center gap-2 text-xs">
    <span className="w-28 shrink-0">{label}</span>
    <select aria-label={label} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-7 min-w-0 flex-1 rounded-md border bg-background px-1.5 text-xs">
      {options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
    </select>
  </label>;

  return <div className="flex flex-col gap-3" data-texture-format onKeyDown={(e) => e.stopPropagation()}>
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <DialogTitle className="text-base">Format and size · {name}</DialogTitle>
        <DialogDescription className="text-xs">Now {tex.width} × {tex.height}, {TEXTURE_FORMATS[tex.format]}, {tex.mipmaps} mipmap level{tex.mipmaps === 1 ? "" : "s"}. The texture is written again from {image.label}.</DialogDescription>
      </div>
      <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={() => close(null)}><X /></Button>
    </div>
    <Button size="sm" variant="secondary" className="self-start" onClick={() => void loadImage()}><ImagePlus /> Use an image of any size…</Button>
    {select("Format", format, DIRECT_FORMATS.map((f: number) => [f, `${TEXTURE_FORMATS[f]} · ${FORMAT_NOTES[f]}`]), setFormat)}
    {select("Width", width, sizes.map((s) => [s, `${s} px`]), setWidth)}
    {select("Height", height, sizes.map((s) => [s, `${s} px`]), setHeight)}
    {select("Mipmaps", Math.min(levels, maxLevels), Array.from({ length: maxLevels }, (_, i) => [i + 1, i ? `${i + 1} levels` : "None (1 level)"]), setLevels)}
    <p className="m-0 text-[11px] text-muted-foreground">{(bytes / 1024).toFixed(1)} KB of texture data (now {(textureLevelsSize(tex.width, tex.height, tex.format, tex.mipmaps) / 1024).toFixed(1)} KB). Powers of two (4 to 1024) are what the game expects. Palette formats (C4, C8, C14X2) are kept by the texture painter, which recalculates a palette only this texture uses.</p>
    <div className="flex justify-end gap-2 border-t pt-2">
      <Button size="sm" variant="outline" onClick={() => close(null)}>Cancel</Button>
      <Button size="sm" disabled={busy} onClick={() => void apply()}>{busy ? "Writing…" : "Apply"}</Button>
    </div>
  </div>;
}
