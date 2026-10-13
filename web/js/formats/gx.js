// GX state of an MDL0 material: the BP/XF register writes stored in its display lists
// (TEV stages, colour registers, swap tables, alpha test, blending, texture coordinate generation)
// plus its light channels. Used to render materials the way the Wii's TEV pipeline does.

// Reads the display list commands in [start, end): BP writes (0x61) and XF writes (0x10).
function readDisplayList(r, start, end, bp, xf) {
  let mask = 0xFFFFFF;
  let p = start;
  while (p < end) {
    const op = r.u8(p);
    if (op === 0x00) { p++; continue; }
    if (op === 0x61) {
      if (p + 5 > end) break;
      const reg = r.u8(p + 1), value = (r.u8(p + 2) << 16) | (r.u8(p + 3) << 8) | r.u8(p + 4);
      if (reg === 0xFE) mask = value;
      else {
        // Colour registers and konst colours share 0xE0-0xE7: bit 23 selects the konst bank.
        const key = reg >= 0xE0 && reg <= 0xE7 && (value & 0x800000) ? reg | 0x100 : reg;
        bp.set(key, ((bp.get(key) ?? 0) & ~mask) | (value & mask));
        mask = 0xFFFFFF;
      }
      p += 5;
    } else if (op === 0x10) {
      if (p + 5 > end) break;
      const count = r.u16(p + 1) + 1, addr = r.u16(p + 3);
      for (let i = 0; i < count && p + 5 + i * 4 + 4 <= end; i++) xf.set(addr + i, r.u32(p + 5 + i * 4));
      p += 5 + count * 4;
    } else if (op === 0x08) {
      p += 6; // CP register write
    } else break;
  }
}

const bits = (v, shift, count) => (v >>> shift) & ((1 << count) - 1);
const s11 = (v) => (v & 0x400 ? v - 0x800 : v);

export function parseGXMaterial(r, o, version) {
  const numTexGens = r.u8(o + 0x14), numChans = r.u8(o + 0x15), numStages = r.u8(o + 0x16), numIndStages = r.u8(o + 0x17);
  const lightSet = r.s8(o + 0x1D), fogSet = r.s8(o + 0x1E);
  const shaderOff = r.s32(o + 0x28), dlOff = r.s32(o + 0x3C);
  if (!shaderOff || !dlOff || numStages < 1 || numStages > 16) return null;
  const bp = new Map(), xf = new Map();
  readDisplayList(r, o + dlOff, o + dlOff + 0x180, bp, xf);
  const shader = o + shaderOff, shaderSize = r.u32(shader);
  if (shaderSize < 0x20 || shaderSize > 0x1000) return null;
  readDisplayList(r, shader + 0x20, shader + shaderSize, bp, xf);

  const stages = [];
  for (let i = 0; i < numStages; i++) {
    const order = bp.get(0x28 + (i >> 1)) ?? 0, half = (i & 1) * 12;
    const c = bp.get(0xC0 + i * 2) ?? 0, a = bp.get(0xC1 + i * 2) ?? 0;
    const ksel = bp.get(0xF6 + (i >> 1)) ?? 0;
    stages.push({
      texMap: bits(order, half, 3), texCoord: bits(order, half + 3, 3), texEnabled: !!bits(order, half + 6, 1), channel: bits(order, half + 7, 3),
      color: { d: bits(c, 0, 4), c: bits(c, 4, 4), b: bits(c, 8, 4), a: bits(c, 12, 4), bias: bits(c, 16, 2), sub: bits(c, 18, 1), clamp: bits(c, 19, 1), scale: bits(c, 20, 2), dest: bits(c, 22, 2) },
      alpha: { rswap: bits(a, 0, 2), tswap: bits(a, 2, 2), d: bits(a, 4, 3), c: bits(a, 7, 3), b: bits(a, 10, 3), a: bits(a, 13, 3), bias: bits(a, 16, 2), sub: bits(a, 18, 1), clamp: bits(a, 19, 1), scale: bits(a, 20, 2), dest: bits(a, 22, 2) },
      kcsel: bits(ksel, (i & 1) ? 14 : 4, 5), kasel: bits(ksel, (i & 1) ? 19 : 9, 5),
      indirect: bp.get(0x10 + i) ?? 0,
    });
  }
  // Swap tables: table i is stored in the low bits of KSEL registers 2i (red, green) and 2i+1 (blue, alpha).
  const swap = [];
  for (let i = 0; i < 4; i++) {
    const lo = bp.get(0xF6 + i * 2) ?? 0, hi = bp.get(0xF7 + i * 2) ?? 0;
    swap.push([bits(lo, 0, 2), bits(lo, 2, 2), bits(hi, 0, 2), bits(hi, 2, 2)]);
  }
  if (!bp.has(0xF6)) swap.splice(0, 4, [0, 1, 2, 3], [0, 0, 0, 3], [1, 1, 1, 3], [2, 2, 2, 3]);
  // Colour registers: 0xE0 + 2i = red/alpha, 0xE1 + 2i = blue/green; bit 23 selects the konst bank.
  const regs = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], konst = [[1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1]];
  for (let i = 0; i < 4; i++) {
    for (const base of [0xE0 + i * 2, 0xE1 + i * 2]) {
      for (const isKonst of [false, true]) {
        const key = isKonst ? base | 0x100 : base;
        if (!bp.has(key)) continue;
        const v = bp.get(key), target = isKonst ? konst[i] : regs[i];
        const lo = isKonst ? bits(v, 0, 8) / 255 : s11(bits(v, 0, 11)) / 255, hi = isKonst ? bits(v, 12, 8) / 255 : s11(bits(v, 12, 11)) / 255;
        if (base & 1) { target[2] = lo; target[1] = hi; } else { target[0] = lo; target[3] = hi; }
      }
    }
  }
  const ac = bp.get(0xF3) ?? 0, blend = bp.get(0x41) ?? 0, z = bp.get(0x40) ?? 0x17;
  const texGens = [];
  for (let i = 0; i < numTexGens; i++) {
    const v = xf.get(0x1040 + i) ?? 0;
    texGens.push({ projection: bits(v, 1, 1), inputForm: bits(v, 2, 1), type: bits(v, 4, 3), source: bits(v, 7, 5), embossSource: bits(v, 12, 3), embossLight: bits(v, 15, 3) });
  }
  // Light channels follow the texture SRT block (8 SRT entries + 8 effect matrices).
  const chanBase = o + (version >= 10 ? 0x1A8 : 0x1A0) + 8 + 8 * 20 + 8 * 52;
  const chans = [];
  for (let i = 0; i < Math.min(numChans, 2); i++) {
    const c = chanBase + i * 0x14;
    const ctrl = (v) => ({ matSrc: bits(v, 0, 1), enabled: !!bits(v, 1, 1), lights: bits(v, 2, 4) | (bits(v, 11, 4) << 4), ambSrc: bits(v, 6, 1), diffuse: bits(v, 7, 2), attn: bits(v, 9, 2) });
    const rgba = (at) => [r.u8(at) / 255, r.u8(at + 1) / 255, r.u8(at + 2) / 255, r.u8(at + 3) / 255];
    chans.push({ flags: r.u32(c), matColor: rgba(c + 4), ambColor: rgba(c + 8), color: ctrl(r.u32(c + 12)), alpha: ctrl(r.u32(c + 16)) });
  }
  return {
    stages, swap, regs, konst, texGens, chans, lightSet, fogSet, numIndStages,
    alphaTest: { ref0: bits(ac, 0, 8) / 255, ref1: bits(ac, 8, 8) / 255, comp0: bits(ac, 16, 3), comp1: bits(ac, 19, 3), op: bits(ac, 22, 2) },
    blend: { enabled: !!bits(blend, 0, 1), logic: !!bits(blend, 1, 1), dst: bits(blend, 5, 3), src: bits(blend, 8, 3), subtract: !!bits(blend, 11, 1), colorUpdate: !!bits(blend, 3, 1), alphaUpdate: !!bits(blend, 4, 1) },
    zmode: { test: !!bits(z, 0, 1), func: bits(z, 1, 3), write: !!bits(z, 4, 1) },
  };
}

// posteffect.blight (LGHT): the track's light objects and ambient colours. With every light
// enabled (as in all Nintendo tracks) light set k is light object k with its ambient colour.
export function parseBLIGHT(data) {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (String.fromCharCode(data[0], data[1], data[2], data[3]) !== 'LGHT') return null;
  const count = v.getUint16(0x10), ambCount = v.getUint16(0x12);
  const ambBase = 0x28 + count * 0x50;
  const ambients = Array.from({ length: ambCount }, (_, i) => [0, 1, 2, 3].map((k) => data[ambBase + i * 8 + k] / 255));
  const lights = [];
  for (let i = 0; i < count; i++) {
    const o = 0x28 + i * 0x50;
    if (o + 0x50 > data.length) break;
    const flags = v.getUint16(o + 0x16);
    const pos = [0, 1, 2].map((k) => v.getFloat32(o + 0x18 + k * 4)), aim = [0, 1, 2].map((k) => v.getFloat32(o + 0x24 + k * 4));
    const intensity = v.getFloat32(o + 0x30);
    let dir = pos.map((p, k) => p - aim[k]);
    const len = Math.hypot(...dir) || 1;
    dir = dir.map((d) => d / len);
    lights.push({
      enabled: !!(flags & 1), type: data[o + 0x13], view: data[o + 0x12] === 2, dir,
      color: [0, 1, 2].map((k) => Math.min(1, Math.max(0, intensity * data[o + 0x34 + k] / 255))),
      ambient: ambients[v.getUint16(o + 0x14)] || [0, 0, 0, 1],
    });
  }
  return lights.filter((l) => l.enabled);
}
