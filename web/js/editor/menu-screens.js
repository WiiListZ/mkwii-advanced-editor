// Menu screens of the game generated from its own files (Scene/UI/*.szs): layouts, textures and
// fonts drawn by LayoutRenderer, with the text being edited placed in the game's text box.
// The screens list which controls the game shows and where (as the game code does); 3D models and
// course movies are not drawn.

import { isYaz0, yaz0Decompress } from '../formats/yaz0.js';
import { parseU8, listFiles } from '../formats/u8.js';
import { decodeTexture } from '../formats/brres.js';
import { parseBRFNT } from '../formats/brfnt.js';
import { parseBRLYT, parseBRLAN, parseBRCTR, parseTPL } from '../formats/brlyt.js';
import { LayoutRenderer, posed } from './layout-render.js';

export class MenuAssets {
  // read(name) -> Promise<Uint8Array | null>, name relative to the Scene/UI folder ("MenuSingle.szs")
  constructor(read) {
    this.read = read;
    this.archives = new Map();
    this.textures = new Map();
    this.fonts = new Map();
    this.parsed = new Map();
    this.renderer = new LayoutRenderer({
      textures: (n) => this.texture(n), fonts: (n) => this.font(n),
      fallbackFonts: () => ['kart_kanji_font.brfnt', 'tt_kart_extension_font.brfnt'].map((n) => this.font(n)),
    });
  }

  // Loads archives (in order: later ones override files of earlier ones, like the language archive).
  async load(names) {
    for (const name of names) {
      if (this.archives.has(name)) continue;
      let data = await this.read(name).catch(() => null);
      if (!data) { this.archives.set(name, null); continue; }
      if (isYaz0(data)) data = yaz0Decompress(data);
      const files = new Map();
      for (const f of listFiles(parseU8(data))) files.set(f.path.replace(/^\.\//, '').toLowerCase(), f.node.data);
      this.archives.set(name, files);
    }
  }

  file(path) {
    const lower = path.toLowerCase();
    let found = null;
    for (const files of this.archives.values()) {
      if (!files) continue;
      if (files.has(lower)) found = files.get(lower);
      else if (!found) for (const [p, d] of files) if (p.endsWith('/' + lower)) { found = d; break; }
    }
    return found;
  }

  get(path, parse) {
    const key = path.toLowerCase();
    if (!this.parsed.has(key)) {
      const data = this.file(path);
      let value = null;
      try { value = data ? parse(data) : null; } catch (e) { console.warn(`Could not read ${path}:`, e); }
      this.parsed.set(key, value);
    }
    return this.parsed.get(key);
  }

  layout(path) { return this.get(path, parseBRLYT); }
  anim(path) { return this.get(path, parseBRLAN); }
  ctrl(path) { return this.get(path, parseBRCTR); }

  texture(name) {
    if (this.textures.has(name)) return this.textures.get(name);
    let tex = null;
    const data = this.file(name);
    if (data) {
      try {
        const [{ image, palette }] = parseTPL(data);
        tex = { width: image.width, height: image.height, rgba: decodeTexture(image, palette) };
      } catch (e) { console.warn(`Could not decode ${name}:`, e); }
    }
    this.textures.set(name, tex);
    return tex;
  }

  font(name) {
    if (this.fonts.has(name)) return this.fonts.get(name);
    const data = this.file(name);
    let font = null;
    try { font = data ? parseBRFNT(data) : null; } catch { font = null; }
    this.fonts.set(name, font);
    return font;
  }

  // Draws one control (BRCTR) at a placement, posed by animations at their first frame.
  // Placement of a control variant, e.g. an anchor of a "NULL" control the game puts others under.
  place(folder, ctrlName, variant) {
    const ctrl = this.ctrl(`${folder}/ctrl/${ctrlName}.brctr`);
    // No variant: the layout at the origin (the caller places it).
    const v = variant === null ? null : ctrl?.variants.find((x) => x.name === variant) || ctrl?.variants[0];
    return v ? { x: v.standard.x, y: v.standard.y, scale: v.standard.sx } : { x: 0, y: 0, scale: 1 };
  }

  // Draws one control (BRCTR) at its placement (moved by `at`), posed by animations at a frame.
  drawControl(ctx, folder, ctrlName, variant, { at = null, anims = [], text = {}, texture = {}, hide = [], show = [], frame = 0 } = {}) {
    const ctrl = this.ctrl(`${folder}/ctrl/${ctrlName}.brctr`);
    if (!ctrl) return false;
    const layout = this.layout(`${folder}/blyt/${ctrl.layout}.brlyt`);
    if (!layout) return false;
    const place = this.place(folder, ctrlName, variant);
    const prefix = `${folder}/anim/${ctrl.layout}_`;
    this.drawLayout(ctx, layout, {
      x: place.x * (at?.scale ?? 1) + (at?.x ?? 0), y: place.y * (at?.scale ?? 1) + (at?.y ?? 0), scale: place.scale * (at?.scale ?? 1),
      anims: anims.map((a) => (a.includes('/') ? a : `${prefix}${a.replace(/@.*$/, '')}.brlan${a.match(/@.*$/)?.[0] ?? ''}`)), text, texture, hide, show, frame,
    });
    return true;
  }

  drawLayout(ctx, layout, { x = 0, y = 0, scale = 1, folder = '', anims = [], text = {}, texture = {}, hide = [], show = [], frame = 0 } = {}) {
    // "name@end" poses an animation at its last frame (a settled state), "name@12" at frame 12.
    const poses = anims.map((spec) => {
      const [path, at] = spec.split('@');
      const anim = this.anim(path.includes('/') ? path : `${folder}/anim/${path}`);
      return { anim, frame: at === 'end' ? anim?.frames ?? 0 : at ? Number(at) : frame };
    }).filter((a) => a.anim);
    this.renderer.draw(ctx, layout, { x, y, scale, pose: posed(layout, poses), overrides: { text, texture, hide: new Set(hide), show: new Set(show) } });
  }
}
