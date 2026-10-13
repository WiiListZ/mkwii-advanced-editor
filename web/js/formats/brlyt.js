// NW4R 2D layouts of the game menus (Scene/UI/*.szs): BRLYT layouts, TPL textures, BRLAN
// animations and Mario Kart Wii's BRCTR control files, read to draw the menu screens.

class View {
  constructor(d) { this.d = d; this.v = new DataView(d.buffer, d.byteOffset, d.byteLength); }
  u8(o) { return this.d[o]; }
  s8(o) { return this.v.getInt8(o); }
  u16(o) { return this.v.getUint16(o); }
  s16(o) { return this.v.getInt16(o); }
  u32(o) { return this.v.getUint32(o); }
  f32(o) { return this.v.getFloat32(o); }
  str(o, max = 256) {
    let s = '';
    for (let i = 0; i < max && o + i < this.d.length && this.d[o + i]; i++) s += String.fromCharCode(this.d[o + i]);
    return s;
  }
  magic(o) { return String.fromCharCode(...this.d.subarray(o, o + 4)); }
}

const nameList = (r, at) => {
  const count = r.u16(at + 8), table = at + 12, out = [];
  for (let i = 0; i < count; i++) out.push(r.str(table + r.u32(table + i * 8)));
  return out;
};
const rgba8 = (r, o) => [r.u8(o), r.u8(o + 1), r.u8(o + 2), r.u8(o + 3)];
const rgba16 = (r, o) => [r.s16(o), r.s16(o + 2), r.s16(o + 4), r.s16(o + 6)];

function parseMaterial(r, o) {
  const m = {
    name: r.str(o, 20),
    black: rgba16(r, o + 0x14), white: rgba16(r, o + 0x1c), color2: rgba16(r, o + 0x24),
    konst: [0, 1, 2, 3].map((i) => rgba8(r, o + 0x2c + i * 4)),
  };
  const flags = r.u32(o + 0x3c);
  let p = o + 0x40;
  const texMaps = flags & 0xf, texSRTs = (flags >> 4) & 0xf, texGens = (flags >> 8) & 0xf;
  m.textures = [];
  for (let i = 0; i < texMaps; i++, p += 4) m.textures.push({ index: r.u16(p), wrapS: r.u8(p + 2), wrapT: r.u8(p + 3) });
  m.srts = [];
  for (let i = 0; i < texSRTs; i++, p += 20) m.srts.push({ tx: r.f32(p), ty: r.f32(p + 4), rot: r.f32(p + 8), sx: r.f32(p + 12), sy: r.f32(p + 16) });
  p += texGens * 4;
  if ((flags >> 25) & 1) p += 4; // channel control
  m.matColor = (flags >> 27) & 1 ? rgba8(r, p) : [255, 255, 255, 255];
  if ((flags >> 27) & 1) p += 4;
  if ((flags >> 12) & 1) p += 4; // TEV swap table
  p += ((flags >> 13) & 3) * 20; // indirect SRTs
  p += ((flags >> 15) & 7) * 4; // indirect orders
  m.tevStages = (flags >> 18) & 0x1f;
  p += m.tevStages * 16;
  if ((flags >> 23) & 1) p += 4; // alpha compare
  if ((flags >> 24) & 1) m.blend = { type: r.u8(p), src: r.u8(p + 1), dst: r.u8(p + 2), op: r.u8(p + 3) };
  return m;
}

function paneBase(r, o, kind) {
  const flags = r.u8(o + 8);
  return {
    kind, children: [],
    visible: !!(flags & 1), influencedAlpha: !!(flags & 2),
    origin: r.u8(o + 9), alpha: r.u8(o + 10),
    name: r.str(o + 12, 16), userData: r.str(o + 28, 8),
    trans: [r.f32(o + 0x24), r.f32(o + 0x28), r.f32(o + 0x2c)],
    rot: [r.f32(o + 0x30), r.f32(o + 0x34), r.f32(o + 0x38)],
    scale: [r.f32(o + 0x3c), r.f32(o + 0x40)],
    size: [r.f32(o + 0x44), r.f32(o + 0x48)],
  };
}
const PANE_END = 0x4c;

function quad(r, p) {
  const colors = [0, 1, 2, 3].map((i) => rgba8(r, p + i * 4)); // top left, top right, bottom left, bottom right
  const material = r.u16(p + 16), coordCount = r.u8(p + 18);
  const uvs = [];
  for (let i = 0; i < coordCount; i++) {
    const q = p + 20 + i * 32;
    uvs.push([0, 1, 2, 3].map((k) => [r.f32(q + k * 8), r.f32(q + k * 8 + 4)]));
  }
  return { colors, material, uvs, end: p + 20 + coordCount * 32 };
}

export function parseBRLYT(data) {
  const r = new View(data);
  if (r.magic(0) !== 'RLYT') throw new Error('Not a BRLYT layout');
  const sections = r.u16(0xe);
  const layout = { width: 608, height: 456, textures: [], fonts: [], materials: [], root: null, groups: [] };
  const stack = [];
  let last = null;
  let o = r.u16(0xc);
  for (let s = 0; s < sections && o < data.length; s++) {
    const magic = r.magic(o), size = r.u32(o + 4);
    if (magic === 'lyt1') { layout.width = r.f32(o + 12); layout.height = r.f32(o + 16); }
    else if (magic === 'txl1') layout.textures = nameList(r, o);
    else if (magic === 'fnl1') layout.fonts = nameList(r, o);
    else if (magic === 'mat1') {
      const count = r.u16(o + 8);
      for (let i = 0; i < count; i++) layout.materials.push(parseMaterial(r, o + r.u32(o + 12 + i * 4)));
    } else if (magic === 'pan1' || magic === 'pic1' || magic === 'txt1' || magic === 'wnd1' || magic === 'bnd1') {
      const pane = paneBase(r, o, magic.slice(0, 3));
      if (magic === 'pic1') Object.assign(pane, quad(r, o + PANE_END));
      else if (magic === 'txt1') {
        const p = o + PANE_END;
        const textOffset = r.u32(p + 12), stringBytes = r.u16(p + 2);
        let text = '';
        for (let i = 0; i + 1 < stringBytes; i += 2) {
          const c = r.u16(o + textOffset + i);
          if (!c) break;
          text += String.fromCharCode(c);
        }
        Object.assign(pane, {
          material: r.u16(p + 4), font: r.u16(p + 6), textOrigin: r.u8(p + 8), textAlign: r.u8(p + 9),
          topColor: rgba8(r, p + 16), bottomColor: rgba8(r, p + 20),
          fontSize: [r.f32(p + 24), r.f32(p + 28)], charSpace: r.f32(p + 32), lineSpace: r.f32(p + 36), text,
        });
      } else if (magic === 'wnd1') {
        const p = o + PANE_END;
        pane.inflation = { l: r.f32(p), r: r.f32(p + 4), t: r.f32(p + 8), b: r.f32(p + 12) };
        const frameCount = r.u8(p + 16), content = r.u32(p + 20), frames = r.u32(p + 24);
        pane.content = quad(r, o + content);
        pane.frames = [];
        for (let i = 0; i < frameCount; i++) {
          const f = o + r.u32(o + frames + i * 4);
          pane.frames.push({ material: r.u16(f), flip: r.u8(f + 2) });
        }
      }
      const parent = stack[stack.length - 1];
      if (parent) { pane.parent = parent; parent.children.push(pane); } else layout.root = pane;
      last = pane;
    } else if (magic === 'pas1') stack.push(last);
    else if (magic === 'pae1') { last = stack.pop(); }
    else if (magic === 'grp1') layout.groups.push({ name: r.str(o + 8, 16) });
    o += size;
  }
  return layout;
}

// Panes by name, children first-to-last as drawn.
export function findPane(layout, name) {
  const walk = (p) => {
    if (!p) return null;
    if (p.name === name) return p;
    for (const c of p.children) { const f = walk(c); if (f) return f; }
    return null;
  };
  return walk(layout.root);
}

// TPL: one or more GX textures (formats as in TEX0, decoded by brres.js decodeTexture).
export function parseTPL(data) {
  const r = new View(data);
  if (r.u32(0) !== 0x0020af30) throw new Error('Not a TPL texture');
  const count = r.u32(4), table = r.u32(8), images = [];
  for (let i = 0; i < count; i++) {
    const header = r.u32(table + i * 8), paletteHeader = r.u32(table + i * 8 + 4);
    const image = { height: r.u16(header), width: r.u16(header + 2), format: r.u32(header + 4), dataOffset: r.u32(header + 8), reader: r };
    let palette = null;
    if (paletteHeader) {
      const n = r.u16(paletteHeader), fmt = r.u32(paletteHeader + 4), at = r.u32(paletteHeader + 8);
      const colors = new Uint8Array(n * 4);
      for (let k = 0; k < n; k++) {
        const v = r.u16(at + k * 2);
        let c;
        if (fmt === 0) c = [v & 0xff, v & 0xff, v & 0xff, v >> 8]; // IA8
        else if (fmt === 1) c = [((v >> 11) & 31) * 255 / 31, ((v >> 5) & 63) * 255 / 63, (v & 31) * 255 / 31, 255];
        else c = v & 0x8000
          ? [((v >> 10) & 31) * 255 / 31, ((v >> 5) & 31) * 255 / 31, (v & 31) * 255 / 31, 255]
          : [((v >> 8) & 15) * 17, ((v >> 4) & 15) * 17, (v & 15) * 17, ((v >> 12) & 7) * 255 / 7];
        colors.set(c.map(Math.round), k * 4);
      }
      palette = { colors };
    }
    images.push({ image, palette });
  }
  return images;
}

// BRLAN: pane and material animations. Only what is needed to pose a layout at one frame.
const TAG_TYPES = ['RLPA', 'RLTS', 'RLVC', 'RLMC', 'RLTP', 'RLVI', 'RLIM'];
export function parseBRLAN(data) {
  const r = new View(data);
  if (r.magic(0) !== 'RLAN') throw new Error('Not a BRLAN animation');
  const sections = r.u16(0xe);
  let o = r.u16(0xc);
  const anim = { frames: 0, loop: false, textures: [], panes: [] };
  for (let s = 0; s < sections && o < data.length; s++) {
    const magic = r.magic(o), size = r.u32(o + 4);
    if (magic === 'pai1') {
      anim.frames = r.u16(o + 8);
      anim.loop = !!r.u8(o + 10);
      const timgCount = r.u16(o + 12), entryCount = r.u16(o + 14), entryTable = r.u32(o + 16);
      const timgTable = o + 20;
      for (let i = 0; i < timgCount; i++) anim.textures.push(r.str(timgTable + r.u32(timgTable + i * 4)));
      for (let i = 0; i < entryCount; i++) {
        const e = o + r.u32(o + entryTable + i * 4);
        const entry = { name: r.str(e, 20), material: !!r.u8(e + 21), tags: [] };
        const tagCount = r.u8(e + 20);
        for (let t = 0; t < tagCount; t++) {
          const g = e + r.u32(e + 24 + t * 4);
          const type = r.magic(g);
          if (!TAG_TYPES.includes(type)) continue;
          const count = r.u8(g + 4);
          for (let k = 0; k < count; k++) {
            const a = g + r.u32(g + 8 + k * 4);
            const index = r.u8(a), target = r.u8(a + 1), dataType = r.u8(a + 2), keyCount = r.u16(a + 4), keys = [];
            const first = a + r.u32(a + 8);
            for (let j = 0; j < keyCount; j++) {
              if (dataType === 2) { const q = first + j * 12; keys.push({ frame: r.f32(q), value: r.f32(q + 4), slope: r.f32(q + 8) }); }
              else { const q = first + j * 8; keys.push({ frame: r.f32(q), value: r.u16(q + 4), step: true }); }
            }
            entry.tags.push({ type, index, target, keys });
          }
        }
        anim.panes.push(entry);
      }
    }
    o += size;
  }
  return anim;
}

// Hermite curve value at a frame (steps for texture and visibility keys).
export function keyValue(keys, frame) {
  if (!keys.length) return 0;
  if (frame <= keys[0].frame) return keys[0].value;
  const last = keys[keys.length - 1];
  if (frame >= last.frame) return last.value;
  for (let i = 0; i + 1 < keys.length; i++) {
    const a = keys[i], b = keys[i + 1];
    if (frame < a.frame || frame > b.frame) continue;
    if (a.step || b.step) return a.value;
    const len = b.frame - a.frame;
    if (len <= 0) return b.value;
    const t = (frame - a.frame) / len, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * a.value + (-2 * t3 + 3 * t2) * b.value + (t3 - 2 * t2 + t) * a.slope * len + (t3 - t2) * b.slope * len;
  }
  return last.value;
}

// BRCTR (Mario Kart Wii): a control made of a layout, its animations and named placements
// ("Button0", "Button1"…) with a position and scale for 4:3 and 16:9 screens.
export function parseBRCTR(data) {
  const r = new View(data);
  if (r.magic(0) !== 'bctr') throw new Error('Not a BRCTR control');
  const strings = r.u16(0x10);
  const name = (off) => r.str(strings + off);
  const variantTable = r.u16(0x0e);
  const ctrl = { layout: name(1), variants: [] };
  // Variants: name, then (x, y, z, scale x, scale y) for 4:3 and for 16:9.
  const count = r.u16(variantTable + 2);
  const first = variantTable + r.u16(variantTable);
  for (let i = 0; i < count; i++) {
    const v = first + i * 0x3c;
    const set = (q) => ({ x: r.f32(q), y: r.f32(q + 4), z: r.f32(q + 8), sx: r.f32(q + 12), sy: r.f32(q + 16) });
    ctrl.variants.push({ name: name(r.u16(v)), standard: set(v + 12), wide: set(v + 32) });
  }
  return ctrl;
}
