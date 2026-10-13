// Draws NW4R 2D layouts (the game's menu screens, see formats/brlyt.js) on a 2D canvas, the way the
// Wii's layout library does: pane hierarchy and transforms, inherited alpha, textures with wrap and
// texture SRT, material black/white colour interpolation, vertex colours, windows with frames and
// text boxes in the game's bitmap fonts. TEV stages beyond that default combiner are approximated.

import { decodeTexture } from '../formats/brres.js';
import { keyValue } from '../formats/brlyt.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Texture with its RGBA texels, sampled with the GX wrap modes (0 clamp, 1 repeat, 2 mirror).
function sampler(tex) {
  const { width: w, height: h, rgba } = tex;
  const wrap = (c, n, mode) => {
    if (mode === 1) return ((c % n) + n) % n;
    if (mode === 2) { const p = ((c % (2 * n)) + 2 * n) % (2 * n); return p < n ? p : 2 * n - 1 - p; }
    return c < 0 ? 0 : c >= n ? n - 1 : c;
  };
  // Bilinear, like the hardware.
  return (u, v, ws, wt, out) => {
    const x = u * w - 0.5, y = v * h - 0.5;
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const xa = wrap(x0, w, ws), xb = wrap(x0 + 1, w, ws), ya = wrap(y0, h, wt), yb = wrap(y0 + 1, h, wt);
    const a = (ya * w + xa) * 4, b = (ya * w + xb) * 4, c = (yb * w + xa) * 4, d = (yb * w + xb) * 4;
    for (let k = 0; k < 4; k++) {
      const top = rgba[a + k] + (rgba[b + k] - rgba[a + k]) * fx, bottom = rgba[c + k] + (rgba[d + k] - rgba[c + k]) * fx;
      out[k] = top + (bottom - top) * fy;
    }
    return out;
  };
}

// UV transform of a texture SRT (rotation and scale around the texture centre).
function srtTransform(srt) {
  if (!srt) return null;
  const r = (srt.rot * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return (u, v) => {
    const x = (u - 0.5) * srt.sx, y = (v - 0.5) * srt.sy;
    return [c * x - s * y + 0.5 + srt.tx, s * x + c * y + 0.5 + srt.ty];
  };
}

const originOffset = (origin, w, h) => {
  const hx = origin % 3, vy = Math.floor(origin / 3);
  // Box of the pane relative to its position, y up: left/top edges.
  return [hx === 0 ? 0 : hx === 1 ? -w / 2 : -w, vy === 0 ? 0 : vy === 1 ? h / 2 : h];
};

const blendOp = (m) => (m?.blend && m.blend.type === 1 && m.blend.dst === 1 ? 'lighter' : 'source-over');

export class LayoutRenderer {
  // textures(name) -> { width, height, rgba } | null; fonts(name) -> parsed BRFNT | null
  // fallbackFonts() -> fonts used, in order, for characters the layout's font lacks (the layout
  // fonts only hold a few styled characters; the rest come from the main font).
  constructor({ textures, fonts, fallbackFonts = () => [] }) {
    this.getTexture = textures;
    this.getFont = fonts;
    this.getFallbacks = fallbackFonts;
    this.sheets = new Map();
    // Rasters by what they depend on (not by position): redrawing a screen after a text edit
    // reuses every other pane.
    this.rasters = new Map();
  }

  // pose: { panes: Map(name -> props), materials: Map(name -> props) } from posed()
  // overrides: { text: { pane: string }, texture: { material: textureName }, hide: Set, show: Set }
  draw(ctx, layout, { x = 0, y = 0, scale = 1, alpha = 1, pose = null, overrides = {} } = {}) {
    const k = ctx.canvas.width / 608;
    const base = new DOMMatrix().translate(ctx.canvas.width / 2, ctx.canvas.height / 2).scale(k, -k).translate(x, y).scale(scale, scale);
    this.layout = layout;
    this.pose = pose;
    this.overrides = overrides;
    this.drawPane(ctx, layout.root, base, alpha, true);
  }

  paneProps(pane) {
    const p = this.pose?.panes.get(pane.name);
    const hide = this.overrides.hide?.has(pane.name), show = this.overrides.show?.has(pane.name);
    return {
      trans: p?.trans || pane.trans, rot: p?.rot || pane.rot, scale: p?.scale || pane.scale, size: p?.size || pane.size,
      alpha: p?.alpha ?? pane.alpha, visible: show ? true : hide ? false : p?.visible ?? pane.visible,
      colors: p?.colors || null,
    };
  }

  material(index) {
    const m = this.layout.materials[index];
    if (!m) return null;
    const p = this.pose?.materials.get(m.name);
    return p ? { ...m, ...p } : m;
  }

  drawPane(ctx, pane, parent, parentAlpha, influence) {
    const props = this.paneProps(pane);
    if (!props.visible) return;
    const m = new DOMMatrix(parent.toString())
      .translate(props.trans[0], props.trans[1])
      .rotate(props.rot[2])
      .scale(props.scale[0], props.scale[1]);
    const alpha = (props.alpha / 255) * (influence ? parentAlpha : 1);
    if (alpha > 0.001) {
      if (pane.kind === 'pic') this.drawQuad(ctx, m, pane, props, pane, alpha);
      else if (pane.kind === 'wnd') this.drawWindow(ctx, m, pane, props, alpha);
      else if (pane.kind === 'txt') this.drawText(ctx, m, pane, props, alpha);
    }
    for (const child of pane.children) this.drawPane(ctx, child, m, alpha, pane.influencedAlpha);
  }

  // Rasterizes a textured, vertex-coloured rectangle (box in pane units) and draws it with the
  // pane transform. `quad` has colors (TL, TR, BL, BR), material and uvs.
  drawQuad(ctx, m, pane, props, quad, alpha, box = null, uvsOverride = null, materialIndex = null) {
    const [w, h] = props.size;
    const [ox, oy] = originOffset(pane.origin, w, h);
    const rect = box || { x: ox, y: oy, w, h };
    if (rect.w <= 0 || rect.h <= 0) return;
    const mat = this.material(materialIndex ?? quad.material);
    const colors = props.colors && !box ? props.colors : quad.colors;
    // Raster resolution from the screen scale of the pane.
    const sx = Math.hypot(m.a, m.b), sy = Math.hypot(m.c, m.d);
    const pw = Math.min(2048, Math.max(1, Math.ceil(rect.w * sx))), ph = Math.min(2048, Math.max(1, Math.ceil(rect.h * sy)));
    const texEntry = mat?.textures?.[0];
    // Overrides by material name or by the texture the layout uses (the game swaps icons at runtime).
    const baseName = texEntry && (mat.textureNames?.[0] || this.layout.textures[texEntry.index]);
    const texName = texEntry && (this.overrides.texture?.[mat.name] || this.overrides.texture?.[baseName] || baseName);
    const tex = texName ? this.getTexture(texName) : null;
    const sample = tex ? sampler(tex) : null;
    const srt = srtTransform(mat?.srts?.[0]);
    const uvs = uvsOverride || quad.uvs?.[0] || [[0, 0], [1, 0], [0, 1], [1, 1]];
    const black = mat?.black || [0, 0, 0, 0], white = mat?.white || [255, 255, 255, 255], mc = mat?.matColor || [255, 255, 255, 255];
    const key = JSON.stringify(['q', pw, ph, colors, black, white, mc, texName, texEntry?.wrapS, texEntry?.wrapT, mat?.srts?.[0], uvs, alpha]);
    const cached = this.rasters.get(key);
    if (cached) { this.blit(ctx, m, cached, rect, blendOp(mat)); return; }
    const img = new ImageData(pw, ph);
    const out = img.data;
    const texel = [0, 0, 0, 0];
    for (let j = 0; j < ph; j++) {
      const t = (j + 0.5) / ph;
      for (let i = 0; i < pw; i++) {
        const s = (i + 0.5) / pw;
        // Vertex colour: bilinear between the corners.
        const vc = [0, 0, 0, 0];
        for (let c = 0; c < 4; c++) {
          const top = colors[0][c] + (colors[1][c] - colors[0][c]) * s, bottom = colors[2][c] + (colors[3][c] - colors[2][c]) * s;
          vc[c] = (top + (bottom - top) * t) / 255;
        }
        let r, g, b, a;
        if (sample) {
          let u = uvs[0][0] + (uvs[1][0] - uvs[0][0]) * s + (uvs[2][0] - uvs[0][0]) * t;
          let v = uvs[0][1] + (uvs[1][1] - uvs[0][1]) * s + (uvs[2][1] - uvs[0][1]) * t;
          if (srt) [u, v] = srt(u, v);
          sample(u, v, texEntry.wrapS, texEntry.wrapT, texel);
          // Default combiner: colour between the material's black and white by the texture.
          r = black[0] + (white[0] - black[0]) * texel[0] / 255;
          g = black[1] + (white[1] - black[1]) * texel[1] / 255;
          b = black[2] + (white[2] - black[2]) * texel[2] / 255;
          a = black[3] + (white[3] - black[3]) * texel[3] / 255;
        } else { r = white[0]; g = white[1]; b = white[2]; a = white[3]; }
        const at = (j * pw + i) * 4;
        out[at] = clamp01((r / 255) * vc[0] * (mc[0] / 255)) * 255;
        out[at + 1] = clamp01((g / 255) * vc[1] * (mc[1] / 255)) * 255;
        out[at + 2] = clamp01((b / 255) * vc[2] * (mc[2] / 255)) * 255;
        out[at + 3] = clamp01((a / 255) * vc[3] * (mc[3] / 255) * alpha) * 255;
      }
    }
    this.blit(ctx, m, this.keep(key, img), rect, blendOp(mat));
  }

  keep(key, img) {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    c.getContext('2d').putImageData(img, 0, 0);
    if (this.rasters.size > 1500) this.rasters.clear();
    this.rasters.set(key, c);
    return c;
  }

  blit(ctx, m, c, rect, op = 'source-over') {
    const img = c;
    ctx.save();
    ctx.globalCompositeOperation = op;
    // Raster row 0 is the top of the box (y up in layout space).
    const t = new DOMMatrix(m.toString()).translate(rect.x, rect.y).scale(rect.w / img.width, -rect.h / img.height);
    ctx.setTransform(t);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(c, 0, 0);
    ctx.restore();
  }

  // Window: content and up to 4 frames drawn at their texture size, with the edge pixels
  // stretched across the rest of the window (like GX clamp).
  drawWindow(ctx, m, pane, props, alpha) {
    const [w, h] = props.size;
    const [ox, oy] = originOffset(pane.origin, w, h);
    const frames = pane.frames;
    const size = (f) => {
      const mat = this.material(f.material), entry = mat?.textures?.[0];
      const tex = entry && this.getTexture(this.layout.textures[entry.index]);
      return tex ? [tex.width, tex.height] : [0, 0];
    };
    // Like nw4r::lyt::Window, the content fills the window inside the frames (left/top from the
    // top-left frame, right/bottom from the bottom-right one), grown by the content inflation. It
    // does not reach under the frames' rounded outer corners.
    const [l, t] = frames.length ? size(frames[0]) : [0, 0];
    const [r, b] = frames.length ? size(frames[frames.length === 1 ? 0 : 3]) : [0, 0];
    const inf = pane.inflation;
    const content = { x: ox + l - inf.l, y: oy - t + inf.t, w: w - l - r + inf.l + inf.r, h: h - t - b + inf.t + inf.b };
    this.drawQuad(ctx, m, pane, props, pane.content, alpha, content);
    if (!frames.length) return;
    const white = [[255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255]];
    // A frame texture keeps its pixel size from its own corner of the window; past the texture the
    // edge texels stretch (GX clamp). `right`/`bottom`: the corner it hangs from; flips mirror it.
    // `grow` extends the far end (in the stretched part) by one screen pixel under the next piece,
    // so the antialiased edges of two pieces do not leave a see-through seam between them.
    const pixel = 1 / Math.max(1e-6, Math.hypot(m.a, m.b));
    const piece = (f, rect, right, bottom, flipH, flipV, tw, th, grow) => {
      if (rect.w <= 0 || rect.h <= 0 || !tw || !th) return;
      if (grow === 'r') rect = { ...rect, w: rect.w + pixel };
      else if (grow === 'b') rect = { ...rect, h: rect.h + pixel };
      else if (grow === 'l') rect = { ...rect, x: rect.x - pixel, w: rect.w + pixel };
      else if (grow === 't') rect = { ...rect, y: rect.y + pixel, h: rect.h + pixel };
      let uL = right ? 1 - rect.w / tw : 0, uR = right ? 1 : rect.w / tw;
      let vT = bottom ? 1 - rect.h / th : 0, vB = bottom ? 1 : rect.h / th;
      if (flipH) { uL = 1 - uL; uR = 1 - uR; }
      if (flipV) { vT = 1 - vT; vB = 1 - vB; }
      const uvs = [[uL, vT], [uR, vT], [uL, vB], [uR, vB]];
      this.drawQuad(ctx, m, pane, props, { colors: white, material: f.material }, alpha, rect, uvs, f.material);
    };
    // Flip codes: 0 none, 1 horizontal, 2 vertical, 4 rotate 180 (90° rotations are not used by the menus).
    const flips = (f) => [f.flip === 1 || f.flip === 4, f.flip === 2 || f.flip === 4];
    if (frames.length === 1) {
      // One texture for the top-left corner, mirrored for the other three.
      const f = frames[0], [tw, th] = size(f);
      piece(f, { x: ox, y: oy, w: w - tw, h: th }, false, false, false, false, tw, th, 'r');
      piece(f, { x: ox + w - tw, y: oy, w: tw, h: h - th }, true, false, true, false, tw, th, 'b');
      piece(f, { x: ox + tw, y: oy - h + th, w: w - tw, h: th }, true, true, true, true, tw, th, 'l');
      piece(f, { x: ox, y: oy - th, w: tw, h: h - th }, false, true, false, true, tw, th, 't');
      return;
    }
    const [lt, rt, lb, rb] = frames;
    const [ltw, lth] = size(lt), [rtw, rth] = size(rt), [lbw, lbh] = size(lb), [rbw, rbh] = size(rb);
    piece(lt, { x: ox, y: oy, w: w - rtw, h: lth }, false, false, ...flips(lt), ltw, lth, 'r');
    piece(rt, { x: ox + w - rtw, y: oy, w: rtw, h: h - rbh }, true, false, ...flips(rt), rtw, rth, 'b');
    piece(rb, { x: ox + lbw, y: oy - h + rbh, w: w - lbw, h: rbh }, true, true, ...flips(rb), rbw, rbh, 'l');
    piece(lb, { x: ox, y: oy - lth, w: lbw, h: h - lth }, false, true, ...flips(lb), lbw, lbh, 't');
  }

  sheetTexels(font, index) {
    let cache = this.sheets.get(font);
    if (!cache) { cache = []; this.sheets.set(font, cache); }
    if (!cache[index]) cache[index] = decodeTexture(font.sheets[index]);
    return cache[index];
  }

  // Text box: the game's font scaled to the box font size, lines placed by the text position and
  // alignment, glyphs coloured by the material (black = outline, white = fill) and the top/bottom
  // gradient.
  drawText(ctx, m, pane, props, alpha) {
    const rawText = this.overrides.text?.[pane.name] ?? pane.text;
    if (!rawText) return;
    const sizeCode = rawText.match(/\{1A:0800000000([0-9a-f]{2})\}/i);
    const fontPercent = sizeCode ? Math.max(1, parseInt(sizeCode[1], 16)) : 100;
    const text = rawText.replace(/\{1A:0800000000[0-9a-f]{2}\}/gi, '');
    if (!text) return;
    const font = this.getFont(this.layout.fonts[pane.font]);
    const chain = [font, ...this.getFallbacks()].filter(Boolean);
    if (!chain.length) return;
    const main = font || chain[0];
    const mat = this.material(pane.material);
    const scaleX = pane.fontSize[0] / (main.width || main.cellW) * fontPercent / 100;
    const scaleY = pane.fontSize[1] / main.height * fontPercent / 100;
    const lineH = (main.lineFeed || main.height) * scaleY + pane.lineSpace;
    const glyphOf = (ch) => {
      const code = ch.codePointAt(0);
      const f = chain.find((x) => x.chars.has(code)) || main;
      const index = f.chars.get(code) ?? f.chars.get(f.alterChar) ?? f.alterChar;
      // Every font is scaled to the same text height.
      const sx = scaleX * (main.height / f.height), sy = scaleY * (main.height / f.height);
      return { font: f, index, w: f.widths.get(index) || f.defaultWidth, sx, sy };
    };
    const lines = text.split('\n').map((line) => {
      const glyphs = [...line].map(glyphOf);
      const width = glyphs.reduce((sum, g, i) => sum + g.w.advance * g.sx + (i < glyphs.length - 1 ? pane.charSpace : 0), 0);
      return { glyphs, width };
    });
    const [w, h] = props.size;
    const [ox, oy] = originOffset(pane.origin, w, h);
    // Text wider than its box is squeezed horizontally to fit, as the game does with long names.
    const widest = Math.max(0, ...lines.map((l) => l.width));
    const squeeze = widest > w && w > 0 ? w / widest : 1;
    const charSpace = pane.charSpace * squeeze;
    if (squeeze < 1) for (const line of lines) { line.width *= squeeze; for (const g of line.glyphs) g.sx *= squeeze; }
    const blockW = widest * squeeze;
    const blockH = lines.length * (main.lineFeed || main.height) * scaleY + (lines.length - 1) * pane.lineSpace;
    // Text block inside the box (y up: oy is the top edge).
    const hx = pane.textOrigin % 3, vy = Math.floor(pane.textOrigin / 3);
    const bx = ox + (hx === 0 ? 0 : hx === 1 ? (w - blockW) / 2 : w - blockW);
    const by = oy - (vy === 0 ? 0 : vy === 1 ? (h - blockH) / 2 : h - blockH);
    const align = pane.textAlign === 0 ? hx : pane.textAlign - 1;
    // Raster of the text block, with room for glyphs past their advance and for glyphs of another
    // font that reach above or below the line (the vertical room does not shrink with the squeeze).
    const marginX = 8 * scaleX, marginY = 12 * scaleY;
    const rect = { x: bx - marginX, y: by + marginY, w: blockW + marginX * 2, h: blockH + marginY * 2 };
    const sx = Math.hypot(m.a, m.b), sy = Math.hypot(m.c, m.d);
    const pw = Math.min(2048, Math.max(1, Math.ceil(rect.w * sx))), ph = Math.min(2048, Math.max(1, Math.ceil(rect.h * sy)));
    const textKey = JSON.stringify(['t', pw, ph, text, fontPercent, squeeze, pane.font, pane.fontSize, pane.charSpace, pane.lineSpace, align, mat?.black, mat?.white, pane.topColor, pane.bottomColor, alpha]);
    const cached = this.rasters.get(textKey);
    if (cached) { this.blit(ctx, m, cached, rect, blendOp(mat)); return; }
    const img = new ImageData(pw, ph), out = img.data;
    const px = pw / rect.w, py = ph / rect.h; // raster pixels per layout unit
    const black = mat?.black || [0, 0, 0, 0], white = mat?.white || [255, 255, 255, 255];
    const top = pane.topColor, bottom = pane.bottomColor;
    // Characters missing from the layout's font come from the other game fonts: every glyph sits on
    // the line's baseline, which is the main font's baseline in its cell (not its ascent: the menu
    // font and kart_kanji_font put the baseline 36 and 40 pixels down cells of different heights).
    const baseOf = (f) => f.baseline ?? f.ascent ?? 0;
    lines.forEach((line, row) => {
      let pen = marginX + (align === 0 ? 0 : align === 1 ? (blockW - line.width) / 2 : blockW - line.width);
      const lineTop = marginY + row * lineH;
      for (const { font: f, index, w: gw, sx: gsx, sy: gsy } of line.glyphs) {
        const perSheet = f.cols * f.rows, pitchX = f.cellW + 1, pitchY = f.cellH + 1;
        const intensityOnly = f.sheets[0]?.format === 0 || f.sheets[0]?.format === 1;
        const sheet = Math.floor(index / perSheet), cell = index % perSheet;
        if (sheet < f.sheets.length && gw.glyph > 0) {
          const tex = f.sheets[sheet], texels = this.sheetTexels(f, sheet);
          const cx = (cell % f.cols) * pitchX, cy = Math.floor(cell / f.cols) * pitchY;
          const gx0 = pen + gw.left * gsx, gy0 = lineTop + baseOf(main) * scaleY - baseOf(f) * gsy;
          const x0 = Math.max(0, Math.floor(gx0 * px)), x1 = Math.min(pw, Math.ceil((gx0 + gw.glyph * gsx) * px));
          const y0 = Math.max(0, Math.floor(gy0 * py)), y1 = Math.min(ph, Math.ceil((gy0 + f.cellH * gsy) * py));
          for (let j = y0; j < y1; j++) {
            const fy = ((j + 0.5) / py - gy0) / gsy / f.cellH;
            const ty = fy * f.cellH - .5, iy = Math.floor(ty), vy = ty - iy;
            const yA = Math.max(0, Math.min(f.cellH - 1, iy)), yB = Math.max(0, Math.min(f.cellH - 1, iy + 1));
            const grad = [0, 1, 2, 3].map((c) => (top[c] + (bottom[c] - top[c]) * clamp01(fy)) / 255);
            for (let i = x0; i < x1; i++) {
              const tx = ((i + 0.5) / px - gx0) / gsx - .5, ix = Math.floor(tx), vx = tx - ix;
              const xA = Math.max(0, Math.min(gw.glyph - 1, ix)), xB = Math.max(0, Math.min(gw.glyph - 1, ix + 1));
              const ta = ((cy + yA) * tex.width + cx + xA) * 4, tb = ((cy + yA) * tex.width + cx + xB) * 4;
              const tc = ((cy + yB) * tex.width + cx + xA) * 4, td = ((cy + yB) * tex.width + cx + xB) * 4;
              const blend = (channel) => (texels[ta + channel] * (1 - vx) + texels[tb + channel] * vx) * (1 - vy) + (texels[tc + channel] * (1 - vx) + texels[td + channel] * vx) * vy;
              const intensity = intensityOnly ? 255 : blend(0), coverage = blend(intensityOnly ? 0 : 3);
              if (!coverage) continue;
              const fi = intensity / 255;
              const a = clamp01(((black[3] + (white[3] - black[3]) * (coverage / 255)) / 255) * grad[3] * alpha);
              const at = (j * pw + i) * 4;
              // Glyphs of one string do not overlap: the later one simply wins.
              for (let c = 0; c < 3; c++) out[at + c] = clamp01(((black[c] + (white[c] - black[c]) * fi) / 255) * grad[c]) * 255;
              out[at + 3] = Math.max(out[at + 3], a * 255);
            }
          }
        }
        pen += gw.advance * gsx + charSpace;
      }
    });
    this.blit(ctx, m, this.keep(textKey, img), rect, blendOp(mat));
  }
}

// Pose of a layout at one frame of an animation: per pane and per material values.
export function posed(layout, anims = []) {
  const panes = new Map(), materials = new Map();
  const paneOf = (name) => {
    let p = panes.get(name);
    if (!p) {
      const src = findByName(layout.root, name);
      if (!src) return null;
      p = { trans: [...src.trans], rot: [...src.rot], scale: [...src.scale], size: [...src.size], alpha: src.alpha, visible: src.visible,
        colors: src.colors ? src.colors.map((c) => [...c]) : null };
      panes.set(name, p);
    }
    return p;
  };
  const matOf = (name) => {
    let p = materials.get(name);
    if (!p) {
      const src = layout.materials.find((x) => x.name === name);
      if (!src) return null;
      p = { black: [...src.black], white: [...src.white], matColor: [...src.matColor], srts: src.srts.map((s) => ({ ...s })), textureNames: null };
      materials.set(name, p);
    }
    return p;
  };
  for (const { anim, frame } of anims) {
    for (const entry of anim.panes) {
      for (const tag of entry.tags) {
        const value = keyValue(tag.keys, frame);
        if (tag.type === 'RLPA' || tag.type === 'RLVC' || tag.type === 'RLVI') {
          const p = paneOf(entry.name);
          if (!p) continue;
          if (tag.type === 'RLVI') p.visible = !!value;
          else if (tag.type === 'RLPA') {
            const t = tag.target;
            if (t < 3) p.trans[t] = value; else if (t < 6) p.rot[t - 3] = value; else if (t < 8) p.scale[t - 6] = value; else if (t < 10) p.size[t - 8] = value;
          } else if (tag.target === 16) p.alpha = Math.max(0, Math.min(255, value));
          else if (p.colors && tag.target < 16) p.colors[tag.target >> 2][tag.target & 3] = Math.max(0, Math.min(255, value));
        } else {
          const p = matOf(entry.name);
          if (!p) continue;
          if (tag.type === 'RLMC') {
            const t = tag.target, v = Math.round(value);
            if (t < 4) p.matColor[t] = v; else if (t < 8) p.black[t - 4] = v; else if (t < 12) p.white[t - 8] = v;
          } else if (tag.type === 'RLTS' && p.srts[tag.index]) {
            p.srts[tag.index][['tx', 'ty', 'rot', 'sx', 'sy'][tag.target]] = value;
          } else if (tag.type === 'RLTP') {
            p.textureNames = p.textureNames || [];
            p.textureNames[tag.index] = anim.textures[value];
          }
        }
      }
    }
  }
  return { panes, materials };
}

function findByName(pane, name) {
  if (!pane) return null;
  if (pane.name === name) return pane;
  for (const c of pane.children) { const f = findByName(c, name); if (f) return f; }
  return null;
}
