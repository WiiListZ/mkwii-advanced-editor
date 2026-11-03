import * as React from "react";
import { ImagePlus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { NumberField } from "../number-field";
import { Hint } from "../common";
import { api } from "../../../js/api.js";
import { MATERIAL_ROLES, SURFACES, TRACK_STYLES } from "../../../js/editor/track-styles.js";
import { type PreviewTexture, type PreviewTextures } from "../track-texture-preview";
import { TrackLayoutPreview } from "../track-layout-preview";

function TextureSample({ texture, label, small = false }: { texture?: PreviewTexture; label: string; small?: boolean }) {
  const canvas = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    const ctx = canvas.current!.getContext("2d")!, size = canvas.current!.width;
    ctx.clearRect(0, 0, size, size);
    if (!texture) return;
    if (texture.native) {
      let renderer: TrackLayoutPreview;
      try { renderer = new TrackLayoutPreview(size, size); } catch { return; }
      const model = { tris: [
        { mat: "boost", v: [0, 0, 0, 0, 0, size, size, 0, size], uv: [0, 0, 0, 1, 1, 1] },
        { mat: "boost", v: [0, 0, 0, size, 0, size, size, 0, 0], uv: [0, 0, 1, 1, 1, 0] },
      ] };
      let frame = 0, last = 0;
      const tick = (now: number) => { if (now - last >= 1000 / 30) { ctx.clearRect(0, 0, size, size); renderer.draw(ctx, model, { boost: texture }, { cx: size / 2, cz: size / 2, scale: 1 }); last = now; } frame = requestAnimationFrame(tick); };
      frame = requestAnimationFrame(tick); return () => { cancelAnimationFrame(frame); renderer.dispose(); };
    }
    const pattern = ctx.createPattern(texture.bitmap, "repeat")!;
    ctx.save(); ctx.setTransform(size / (texture.width * texture.uvScale[0]), 0, 0, -size / (texture.height * texture.uvScale[1]), 0, size / texture.uvScale[1]);
    ctx.fillStyle = pattern; ctx.fillRect(0, texture.height * (1 - texture.uvScale[1]), texture.width * texture.uvScale[0], texture.height * texture.uvScale[1]); ctx.restore();
  }, [texture]);
  return <canvas ref={canvas} width={96} height={96} role="img" aria-label={`${label} texture preview`} data-texture-source={texture?.source || "loading"} className={small ? "size-8 rounded border" : "size-16 shrink-0 rounded border"} style={{ background: "repeating-conic-gradient(#303030 0% 25%, #454545 0% 50%) 0 / 12px 12px" }} />;
}

export function TrackStylePicker({ params, change, textures }: { params: any; change: (key: string, value: any) => void; textures: PreviewTextures }) {
  const style = TRACK_STYLES[params.style] || TRACK_STYLES.circuit;
  return <div className="flex flex-col gap-1.5">
    <Label>Track style</Label>
    <Select value={params.style || "circuit"} onValueChange={(v) => change("style", v)}>
      <SelectTrigger aria-label="Track style"><SelectValue /></SelectTrigger>
      <SelectContent>{Object.entries(TRACK_STYLES).map(([id, entry]: any) => <SelectItem key={id} value={id}>{entry.label}</SelectItem>)}</SelectContent>
    </Select>
    <div className="flex items-center gap-2"><div className="flex shrink-0 gap-0.5">{["road", "offroad", "wall"].map((role) => <TextureSample key={role} texture={textures[role]} label={MATERIAL_ROLES[role].label} small />)}</div><p className="m-0 text-[11px] leading-snug text-muted-foreground">{style.description}</p></div>
  </div>;
}

export function TrackTextures({ params, change, busy, textures }: { params: any; change: (key: string, value: any) => void; busy: (value: boolean) => void; textures: PreviewTextures }) {
  const [loading, setLoading] = React.useState<string | null>(null), [error, setError] = React.useState("");
  const alive = React.useRef(true);
  React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const style = TRACK_STYLES[params.style] || TRACK_STYLES.circuit;
  const update = (role: string, value: any) => change("textures", { ...params.textures, [role]: value });
  const image = async (role: string) => {
    setLoading(role); busy(true); setError("");
    let bitmap: ImageBitmap | null = null;
    try {
      const file = await api.openFile([{ name: "Texture image", extensions: ["png", "jpg", "jpeg", "webp"] }], `Texture for ${MATERIAL_ROLES[role].label}`);
      if (!file || !alive.current) return;
      bitmap = await createImageBitmap(new Blob([file.data]));
      if (bitmap.width > 16384 || bitmap.height > 16384) throw new Error("Choose an image no larger than 16384 pixels on either side.");
      const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
      const dimension = (v: number) => Math.max(8, Math.min(1024, 2 ** Math.round(Math.log2(v * scale))));
      const canvas = document.createElement("canvas"); canvas.width = dimension(bitmap.width); canvas.height = dimension(bitmap.height);
      const ctx = canvas.getContext("2d")!; ctx.imageSmoothingQuality = "high"; ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      // Keep compatible PNGs byte for byte: a canvas round trip can alter
      // translucent RGB values through premultiplied-alpha rounding.
      const compatiblePNG = [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => file.data[i] === v) && canvas.width === bitmap.width && canvas.height === bitmap.height;
      const png = compatiblePNG ? await new Promise<string>((done, fail) => {
        const reader = new FileReader(); reader.onload = () => done(String(reader.result)); reader.onerror = () => fail(Error("Could not read this PNG")); reader.readAsDataURL(new Blob([file.data], { type: "image/png" }));
      }) : canvas.toDataURL("image/png");
      if (alive.current) update(role, { ...params.textures?.[role], image: png, name: file.name, surface: undefined });
    } catch (e: any) { if (alive.current) setError(e.message || "Could not read this image."); }
    finally { bitmap?.close(); if (alive.current) setLoading(null); busy(false); }
  };
  return <>
    <TrackStylePicker params={params} change={change} textures={textures} />
    <p className="m-0 text-[11px] text-muted-foreground">Style changes the appearance. Road grip and race settings stay as configured. Custom choices below override the style.</p>
    <div className="flex flex-col gap-1.5"><Label>Road and ground textures</Label><Select value={params.textureSource || "game"} onValueChange={(v) => change("textureSource", v)}><SelectTrigger aria-label="Default textures"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="game">Use game textures when available</SelectItem><SelectItem value="builtin">Use editor textures</SelectItem></SelectContent></Select></div>
    <p className="m-0 text-[11px] leading-snug text-muted-foreground">Images are embedded in the SZS. PNG, JPEG and WebP are fitted to game-compatible dimensions, up to 1024 × 1024. Boost panels use the game's original animated material when available.</p>
    {error && <p role="alert" className="m-0 text-xs text-destructive">{error}</p>}
    {Object.entries(MATERIAL_ROLES).map(([role, entry]: any) => {
      const value = params.textures?.[role], tile = textures[role];
      return <div key={role} className="flex flex-col gap-2 rounded-md border p-2.5">
        <div className="flex items-center gap-2"><TextureSample texture={tile} label={entry.label} /><span className="min-w-0 flex-1 text-xs font-medium">{entry.label}<span className="block truncate font-normal text-muted-foreground">{tile ? `${tile.native ? "Game material · Animated" : tile.source === "game" ? "Game texture" : tile.source === "custom" ? value?.name || "Custom image" : "Editor texture"} · ${tile.width} × ${tile.height}` : "Loading texture…"}</span></span>
          <Hint title="Reset texture" text="Use the selected style's texture and its original scale."><span className="inline-flex"><Button size="icon-sm" variant="ghost" disabled={!value || !!loading} aria-label={`Reset ${entry.label} texture`} onClick={() => update(role, undefined)}><RotateCcw /></Button></span></Hint>
        </div>
        <Select value={value?.image ? "custom" : value?.surface || "style"} onValueChange={(v) => update(role, { repeat: value?.repeat ?? 1, ...(v === "style" ? {} : { surface: v }) })} disabled={!!loading}>
          <SelectTrigger aria-label={`${entry.label} texture`}><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="style">Style default ({SURFACES[style.surfaces[role] || entry.surface].label})</SelectItem>{Object.entries(SURFACES).map(([id, item]: any) => <SelectItem key={id} value={id}>{item.label}</SelectItem>)}{value?.image && <SelectItem value="custom">Custom image</SelectItem>}</SelectContent>
        </Select>
        <div className="flex items-center gap-2"><Button size="sm" variant="outline" disabled={!!loading} onClick={() => void image(role)} aria-label={`Choose image for ${entry.label}`}><ImagePlus />{loading === role ? "Loading…" : "Image…"}</Button><Label className="ml-auto text-[11px]">Repeat</Label><NumberField className="w-20" aria-label={`${entry.label} texture repeat`} min={.25} max={16} step={.25} value={value?.repeat ?? 1} onValue={(v) => update(role, { ...value, repeat: v })} /></div>
      </div>;
    })}
    <Button variant="outline" size="sm" disabled={!!loading || !Object.values(params.textures || {}).some(Boolean)} onClick={() => change("textures", {})}><RotateCcw /> Reset all textures</Button>
  </>;
}
