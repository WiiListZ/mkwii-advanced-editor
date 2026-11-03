import * as React from "react";
import { api } from "../../js/api.js";
import { trackMaterials } from "../../js/editor/track-styles.js";

export type PreviewTexture = { image: string; bitmap: HTMLImageElement; width: number; height: number; uvScale: number[]; source: string; label: string; native?: any };
export type PreviewTextures = Record<string, PreviewTexture>;
const EMPTY_TEXTURES: PreviewTextures = {};

export function useTrackTextures(params: any) {
  const request = React.useMemo(() => JSON.stringify(trackMaterials(params)), [params.style, params.textureSource, params.textures]);
  const [state, setState] = React.useState<{ key: string; textures: PreviewTextures; error: string }>({ key: "", textures: {}, error: "" });
  React.useEffect(() => {
    let current = true;
    const timer = setTimeout(async () => {
      try {
        const result = await api.generatedTrackTextures(JSON.parse(request)), textures: PreviewTextures = {};
        const images = new Map<string, Promise<HTMLImageElement>>();
        await Promise.all(Object.entries(result).map(async ([role, tile]: [string, any]) => {
          if (!images.has(tile.image)) images.set(tile.image, (async () => { const image = new Image(); image.src = tile.image; await image.decode(); return image; })());
          textures[role] = { ...tile, bitmap: await images.get(tile.image) };
        }));
        if (current) setState({ key: request, textures, error: "" });
      } catch (e: any) { if (current) setState({ key: request, textures: {}, error: e.message }); }
    }, 120);
    return () => { current = false; clearTimeout(timer); };
  }, [request]);
  return { textures: state.key === request ? state.textures : EMPTY_TEXTURES, loading: state.key !== request, error: state.key === request ? state.error : "" };
}

// Canvas uses a top-left image origin. ABMatt changes OBJ V to 1-V when
// writing the BRRES, so apply that same transform before sampling the PNG.
export function textureTriangle(ctx: CanvasRenderingContext2D, points: number[][], uv: number[], texture: PreviewTexture, pattern: CanvasPattern) {
  const q = [0, 1, 2].map((i) => [uv[i * 2] * texture.uvScale[0] * texture.width, (1 - uv[i * 2 + 1] * texture.uvScale[1]) * texture.height]);
  const ux = q[1][0] - q[0][0], uy = q[1][1] - q[0][1], vx = q[2][0] - q[0][0], vy = q[2][1] - q[0][1], det = ux * vy - uy * vx;
  if (Math.abs(det) < 1e-10) return;
  const dx = points[1][0] - points[0][0], dy = points[1][1] - points[0][1], ex = points[2][0] - points[0][0], ey = points[2][1] - points[0][1];
  const a = (dx * vy - ex * uy) / det, b = (dy * vy - ey * uy) / det, c = (ex * ux - dx * vx) / det, d = (ey * ux - dy * vx) / det;
  ctx.save(); ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); ctx.clip();
  ctx.transform(a, b, c, d, points[0][0] - a * q[0][0] - c * q[0][1], points[0][1] - b * q[0][0] - d * q[0][1]);
  const x = Math.min(...q.map((p) => p[0])), y = Math.min(...q.map((p) => p[1]));
  ctx.fillStyle = pattern; ctx.fillRect(x - 1, y - 1, Math.max(...q.map((p) => p[0])) - x + 2, Math.max(...q.map((p) => p[1])) - y + 2); ctx.restore();
}
