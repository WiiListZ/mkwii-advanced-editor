// Low-poly 3D models for every kind of track element and for the known game objects.
// Models are built once from primitives (shared geometries/materials) and cloned per instance.
// Units: 1 = one "marker size" (Preferences › Marker size). Models stand on y = 0 and face +Z.

import * as THREE from 'three';

const TAU = Math.PI * 2;

// Which model to use for an object, from its internal name (ObjFlow.bin). Order matters.
const NAME_RULES = [
  [/^itembox|itembox/i, 'itembox'],
  [/kuribo/i, 'goomba'],
  [/wanwan/i, 'chomp'],
  [/dossun/i, 'thwomp'],
  [/pakkun/i, 'piranha'],
  [/sanbo/i, 'pokey'],
  [/choropu/i, 'mole'],
  [/^cow|_cow/i, 'cow'],
  [/heyho|shyguy/i, 'shyguy'],
  [/hanachan/i, 'wiggler'],
  [/teresa|boo/i, 'boo'],
  [/basabasa|bat/i, 'bat'],
  [/poihana|duck/i, 'duck'],
  [/crab/i, 'crab'],
  [/puku|fish/i, 'fish'],
  [/bomb/i, 'bomb'],
  [/bird|gull|seagull|kamome|penguin/i, 'bird'],
  [/begoman|spike/i, 'spikedtop'],
  [/firebar|fireball|firesnake|fire|lava|flame|volcano/i, 'fire'],
  [/propeller|windmill|fan|kazaguruma/i, 'propeller'],
  [/press|piston/i, 'press'],
  [/rock|stone|boulder|iwa/i, 'rock'],
  [/dokan|pipe/i, 'pipe'],
  [/coin/i, 'coin'],
  [/kinoko|mushroom|mash/i, 'mushroom'],
  [/cannon/i, 'cannon'],
  [/palm|yashi/i, 'palm'],
  [/flower|hana/i, 'flower'],
  [/grass|kusa|bush|leaf/i, 'bush'],
  [/tree|wood|ki_|forest/i, 'tree'],
  [/wagon|truckwagon|cart|trolley/i, 'minecart'],
  [/bus/i, 'bus'],
  [/truck/i, 'truck'],
  [/car|taxi|kart|vehicle/i, 'car'],
  [/ship|boat|fune/i, 'boat'],
  [/train|kisha/i, 'train'],
  [/plane|heli|airship|blimp|balloon/i, 'balloon'],
  [/flag|banner|hata/i, 'flag'],
  [/^sun|_sun|sunds/i, 'sun'],
  [/sea|nami|wave|water|river|lake|psea/i, 'water'],
  [/sound|se_|audio/i, 'speaker'],
  [/lens|fx|effect|light|spark|glow|star|kira/i, 'sparkle'],
  [/smoke|cloud|fog|dust/i, 'cloud'],
  [/sign|kanban|board/i, 'sign'],
  [/light|lamp|lantern/i, 'lamp'],
];

export function modelKeyForObject(name, id) {
  if (id === 0x65) return 'itembox';
  if (!name) return 'crate';
  for (const [re, key] of NAME_RULES) if (re.test(name)) return key;
  return 'crate';
}

const hashColor = (text) => {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return new THREE.Color().setHSL((h % 360) / 360, 0.55, 0.55).getHex();
};

export class ModelLibrary {
  constructor() {
    this.templates = new Map();
    this.geos = new Map();
    this.mats = new Map();
    this.labelTex = new Map();
  }

  // ---- Shared building blocks --------------------------------------------------------
  geo(key, make) {
    let g = this.geos.get(key);
    if (!g) this.geos.set(key, (g = make()));
    return g;
  }
  mat(color, opts = {}) {
    const key = `${color}|${JSON.stringify(opts)}`;
    let m = this.mats.get(key);
    if (!m) {
      const { basic, ...rest } = opts;
      m = basic
        ? new THREE.MeshBasicMaterial({ color, ...rest })
        : new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.05, flatShading: true, ...rest });
      this.mats.set(key, m);
    }
    return m;
  }
  sphere(r = 1) { return this.geo('sphere', () => new THREE.SphereGeometry(1, 14, 10)); }
  box() { return this.geo('box', () => new THREE.BoxGeometry(1, 1, 1)); }
  cyl(seg = 12) { return this.geo('cyl' + seg, () => new THREE.CylinderGeometry(1, 1, 1, seg)); }
  cone(seg = 12) { return this.geo('cone' + seg, () => new THREE.ConeGeometry(1, 1, seg)); }
  torus() { return this.geo('torus', () => new THREE.TorusGeometry(1, 0.28, 8, 16)); }
  hemi() { return this.geo('hemi', () => new THREE.SphereGeometry(1, 14, 8, 0, TAU, 0, Math.PI / 2)); }

  // Adds a mesh to a group: p = position, s = scale, r = rotation (radians).
  part(group, geometry, material, p = [0, 0, 0], s = [1, 1, 1], r = [0, 0, 0]) {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(...p);
    m.scale.set(...(typeof s === 'number' ? [s, s, s] : s));
    m.rotation.set(...r);
    group.add(m);
    return m;
  }

  // ---- Public API -------------------------------------------------------------------
  // Returns a new instance (clone sharing geometry/materials) of the model.
  instance(key, opts = {}) {
    const tkey = key === 'crate' || key === 'kart' ? `${key}|${opts.color ?? ''}` : key;
    let t = this.templates.get(tkey);
    if (!t) {
      t = this.build(key, opts);
      t.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.matrixAutoUpdate = true; } });
      this.templates.set(tkey, t);
    }
    return t.clone();
  }

  // A camera-facing text label (cached texture per text).
  label(text, height = 0.45) {
    let entry = this.labelTex.get(text);
    if (!entry) {
      const c = document.createElement('canvas');
      const ctx = c.getContext('2d');
      const font = 'bold 40px Segoe UI, system-ui, sans-serif';
      ctx.font = font;
      const w = Math.ceil(ctx.measureText(text).width) + 28;
      c.width = w; c.height = 60;
      ctx.font = font;
      ctx.fillStyle = 'rgba(20,22,28,0.82)';
      ctx.beginPath(); ctx.roundRect(0, 0, w, 60, 14); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 14, 32);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      entry = { mat: new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }), aspect: w / 60 };
      this.labelTex.set(text, entry);
    }
    const s = new THREE.Sprite(entry.mat);
    s.scale.set(height * entry.aspect, height, 1);
    s.renderOrder = 20;
    s.userData.isLabel = true;
    return s;
  }

  canvasTexture(key, draw, size = 128) {
    return this.geo('tex:' + key, () => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      draw(c.getContext('2d'), size);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    });
  }

  // White round badge with a red "M" (Mario's cap and kart), on a transparent background.
  emblemTexture() {
    return this.canvasTexture('emblem', (ctx, n) => {
      ctx.clearRect(0, 0, n, n);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(n / 2, n / 2, n * 0.47, 0, TAU); ctx.fill();
      ctx.fillStyle = '#e0262c';
      ctx.font = `900 ${Math.round(n * 0.62)}px Arial Black, Arial, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('M', n / 2, n * 0.54);
    });
  }

  checkerTexture() {
    return this.canvasTexture('checker', (ctx, n) => {
      const q = n / 8;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        ctx.fillStyle = (x + y) % 2 ? '#111' : '#fafafa';
        ctx.fillRect(x * q, y * q, q, q);
      }
    });
  }

  // ---- Model definitions -------------------------------------------------------------
  build(key, opts) {
    const g = new THREE.Group();
    const P = (...a) => this.part(g, ...a);
    const M = (c, o) => this.mat(c, o);
    const S = this.sphere(), B = this.box(), C = this.cyl(), K = this.cone(), T = this.torus();
    const eyes = (y, z, spread, r = 0.12, pupil = 0.07, white = 0xffffff) => {
      for (const sx of [-1, 1]) {
        P(S, M(white), [sx * spread, y, z], [r, r * 1.3, r * 0.6]);
        P(S, M(0x111111), [sx * spread, y, z + r * 0.45], [pupil, pupil * 1.3, pupil * 0.6]);
      }
    };
    const wheel = (x, y, z, r = 0.22, w = 0.16) => P(C, M(0x1d1d1f), [x, y, z], [r, w, r], [0, 0, Math.PI / 2]);

    switch (key) {
      // --------------------------------------------------- track elements
      case 'kart': { // start position: Mario on the Standard Kart (front is +z, about 2 long)
        const red = opts.color ?? 0xd8262c, cap = 0xe0262c, blue = 0x2742b8, silver = 0xb9bec6, steel = 0x6f757d;
        const dark = 0x1f2125, skin = 0xffc79c, white = 0xf7f7f7, brown = 0x5a3216;
        const badge = M(0xffffff, { map: this.emblemTexture(), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide });
        const plane = this.geo('plane', () => new THREE.PlaneGeometry(1, 1));
        // Chassis: steel floor and silver side rails.
        P(B, M(steel), [0, 0.2, -0.05], [0.62, 0.07, 1.5]);
        for (const sx of [-1, 1]) P(C, M(silver), [sx * 0.3, 0.27, -0.05], [0.035, 1.5, 0.035], [Math.PI / 2, 0, 0]);
        // Front cowl: a thick red U around the front wheels, white stripe down the middle of the nose.
        const arc = this.geo('kart-cowl', () => new THREE.TorusGeometry(1, 0.34, 10, 24, Math.PI));
        P(arc, M(red), [0, 0.26, 0.34], [0.58, 0.62, 0.55], [Math.PI / 2, 0, 0]);
        P(B, M(red), [0, 0.2, 0.62], [0.72, 0.12, 0.62]);
        P(B, M(white), [0, 0.38, 0.97], [0.1, 0.22, 0.05], [-0.25, 0, 0]);
        P(B, M(white), [0, 0.45, 0.82], [0.1, 0.02, 0.26], [0.15, 0, 0]);
        // Blue nose tower up to the steering wheel, with the "M" badge.
        P(B, M(blue), [0, 0.52, 0.5], [0.19, 0.42, 0.13], [-0.45, 0, 0]);
        P(B, M(blue), [0, 0.62, 0.34], [0.15, 0.12, 0.2]);
        P(plane, badge, [0, 0.55, 0.58], [0.13, 0.13, 1], [-0.45, 0, 0]);
        // Steering column and wheel.
        P(C, M(silver), [0, 0.7, 0.24], [0.025, 0.2, 0.025], [-0.9, 0, 0]);
        P(T, M(dark), [0, 0.78, 0.17], [0.13, 0.13, 0.11], [-0.75, 0, 0]);
        // Sides: chequered panels behind the front wheels, red pods by the rear wheels.
        const checks = M(0xffffff, { map: this.checkerTexture() });
        for (const sx of [-1, 1]) {
          P(B, checks, [sx * 0.36, 0.33, 0.12], [0.05, 0.2, 0.42]);
          P(S, M(red), [sx * 0.4, 0.36, -0.5], [0.2, 0.17, 0.32]);
        }
        // Seat with the silver roll bar behind it.
        P(B, M(dark), [0, 0.36, -0.22], [0.42, 0.08, 0.36]);
        P(B, M(dark), [0, 0.6, -0.42], [0.42, 0.42, 0.08], [0.25, 0, 0]);
        for (const sx of [-1, 1]) P(C, M(silver), [sx * 0.24, 0.62, -0.5], [0.03, 0.62, 0.03], [0.25, 0, 0]);
        P(C, M(silver), [0, 0.9, -0.57], [0.03, 0.5, 0.03], [0, 0, Math.PI / 2]);
        // Rear: engine block, four exhaust pipes pointing up and back, bumper with the "M" plate.
        P(B, M(silver), [0, 0.45, -0.78], [0.5, 0.3, 0.32]);
        for (const [x, lift] of [[-0.3, 0.06], [-0.12, 0], [0.12, 0], [0.3, 0.06]]) {
          const y = 0.64 + lift;
          P(C, M(0x4b5058, { metalness: 0.5, roughness: 0.4 }), [x, y, -0.92], [0.095, 0.46, 0.095], [Math.PI / 2 - 0.4, 0, Math.sign(x) * -0.15]);
          P(T, M(0xc9ced6, { metalness: 0.6, roughness: 0.3 }), [x * 1.04, y + 0.09, -1.13], [0.09, 0.09, 0.09], [-0.4, 0, 0]);
          P(C, M(0x0b0b0b), [x * 1.04, y + 0.09, -1.13], [0.07, 0.02, 0.07], [Math.PI / 2 - 0.4, 0, 0]);
        }
        P(B, M(steel), [0, 0.28, -1.0], [0.75, 0.1, 0.08]);
        P(plane, badge, [0, 0.29, -1.045], [0.13, 0.13, 1], [0, Math.PI, 0]);
        // Wheels: small at the front (under the cowl), big ones at the back; grey hubs.
        for (const [z, r, w, x] of [[0.66, 0.17, 0.14, 0.56], [-0.6, 0.29, 0.26, 0.62]]) for (const sx of [-1, 1]) {
          wheel(sx * x, r, z, r, w);
          P(C, M(silver), [sx * (x + 0.01), r, z], [r * 0.5, w + 0.01, r * 0.5], [0, 0, Math.PI / 2]);
          P(C, M(steel), [sx * (x + 0.015), r, z], [r * 0.18, w + 0.02, r * 0.18], [0, 0, Math.PI / 2]);
        }
        // Mario: brown shoes on the pedals, blue overalls with yellow buttons, red shirt, white gloves.
        for (const sx of [-1, 1]) {
          P(S, M(brown), [sx * 0.1, 0.33, 0.42], [0.08, 0.07, 0.12]);
          P(C, M(blue), [sx * 0.1, 0.42, 0.18], [0.075, 0.42, 0.075], [Math.PI / 2 - 0.25, 0, 0]);
        }
        P(S, M(blue), [0, 0.5, -0.18], [0.24, 0.15, 0.22]);
        P(C, M(blue), [0, 0.68, -0.22], [0.22, 0.3, 0.19]);
        P(S, M(cap), [0, 0.86, -0.22], [0.27, 0.17, 0.22]);
        for (const sx of [-1, 1]) {
          P(B, M(blue), [sx * 0.11, 0.82, -0.06], [0.055, 0.16, 0.03]);
          P(S, M(0xffd400), [sx * 0.11, 0.76, -0.04], 0.035);
          P(C, M(cap), [sx * 0.22, 0.82, -0.05], [0.07, 0.32, 0.07], [1.2, 0, sx * -0.45]);
          P(S, M(white), [sx * 0.12, 0.78, 0.15], [0.085, 0.08, 0.09]);
        }
        // Head (big, as on the game's Mario): round nose, black moustache, blue eyes, eyebrows,
        // ears, sideburns and brown hair at the back.
        P(S, M(skin), [0, 1.13, -0.17], [0.25, 0.25, 0.24]);
        P(S, M(skin), [0, 1.08, 0.1], [0.09, 0.08, 0.08]);
        for (const sx of [-1, 1]) {
          P(S, M(0x121212), [sx * 0.08, 1.0, 0.06], [0.1, 0.045, 0.06], [0, sx * 0.35, sx * 0.25]);
          P(S, M(white), [sx * 0.075, 1.18, 0.05], [0.045, 0.07, 0.025]);
          P(S, M(0x2563eb), [sx * 0.07, 1.17, 0.068], [0.026, 0.042, 0.012]);
          P(S, M(0x080808), [sx * 0.07, 1.17, 0.075], [0.012, 0.02, 0.008]);
          P(B, M(0x2a1a0c), [sx * 0.08, 1.27, 0.05], [0.07, 0.018, 0.018], [0, 0, sx * -0.2]);
          P(S, M(skin), [sx * 0.245, 1.12, -0.19], [0.05, 0.075, 0.04]);
          P(S, M(brown), [sx * 0.19, 1.06, -0.25], [0.07, 0.11, 0.09]);
        }
        P(S, M(brown), [0, 1.04, -0.36], [0.2, 0.12, 0.09]);
        // Cap: red dome, brim to the front, white badge with the "M".
        P(this.hemi(), M(cap), [0, 1.2, -0.17], [0.265, 0.2, 0.27]);
        P(C, M(cap), [0, 1.205, 0.07], [0.19, 0.026, 0.12]);
        P(plane, badge, [0, 1.31, 0.065], [0.15, 0.15, 1], [-0.5, 0, 0]);
        break;
      }
      case 'shell': // item route point
        P(this.hemi(), M(0x34c759), [0, 0.05, 0], [0.42, 0.34, 0.42]);
        P(T, M(0xffffff), [0, 0.05, 0], [0.42, 0.42, 0.42], [Math.PI / 2, 0, 0]);
        P(C, M(0xfff3c4), [0, 0.03, 0], [0.4, 0.06, 0.4]);
        break;
      case 'camera': {
        P(B, M(0x2b2d34), [0, 0, 0], [0.7, 0.5, 0.9]);
        P(C, M(0x111111), [0, 0, 0.6], [0.2, 0.35, 0.2], [Math.PI / 2, 0, 0]);
        P(C, M(0x7dd3fc, { emissive: 0x0b4a6f }), [0, 0, 0.78], [0.16, 0.02, 0.16], [Math.PI / 2, 0, 0]);
        for (const z of [-0.2, 0.25]) P(C, M(0xe879f9), [0, 0.45, z], [0.22, 0.08, 0.22], [0, 0, Math.PI / 2]);
        P(B, M(0x555555), [0, -0.45, 0], [0.12, 0.4, 0.12]);
        break;
      }
      case 'lakitu': { // respawn point: Lakitu sitting in his cloud (front is +z)
        const yellow = 0xf5c518, green = 0x2e9b3a, deep = 0x145a1c, black = 0x111111;
        const ring = this.geo('thin-ring', () => new THREE.TorusGeometry(1, 0.08, 8, 28));
        const frame = this.geo('goggle-frame', () => new THREE.TorusGeometry(1, 0.22, 8, 24));
        const smile = this.geo('smile', () => new THREE.TorusGeometry(1, 0.12, 6, 16, Math.PI));
        // Cloud: one smooth puffy shape, a little flat underneath, with its small face at the front.
        P(S, M(0xffffff), [0, 0.45, 0], [0.5, 0.4, 0.46]);
        for (const [x, y, z, r] of [[0.3, 0.42, 0.12, 0.26], [-0.3, 0.42, 0.12, 0.26], [0.28, 0.45, -0.18, 0.26], [-0.28, 0.45, -0.18, 0.26], [0, 0.55, -0.28, 0.28]]) P(S, M(0xffffff), [x, y, z], r);
        P(S, M(0xe3e6ea), [0, 0.2, 0], [0.42, 0.14, 0.4]);
        for (const sx of [-1, 1]) P(S, M(black), [sx * 0.09, 0.42, 0.45], [0.028, 0.05, 0.02]);
        P(smile, M(black), [0, 0.39, 0.455], [0.06, 0.045, 0.3], [0, 0, Math.PI]);
        // Shell on his back: green dome with darker bands and a white rim.
        P(this.hemi(), M(green), [0, 1.02, -0.22], [0.32, 0.34, 0.32], [-1.25, 0, 0]);
        for (const [k, r] of [[0.1, 0.3], [0.2, 0.24], [0.28, 0.15]]) P(ring, M(deep), [0, 1.02 + k * 0.32, -0.22 - k], [r, r, 0.5], [-1.25 + Math.PI / 2, 0, 0]);
        P(this.geo('shell-rim', () => new THREE.TorusGeometry(1, 0.12, 8, 28)), M(0xf4f1e6), [0, 1.02, -0.22], [0.32, 0.32, 0.4], [-1.25 + Math.PI / 2, 0, 0]);
        // Yellow body leaning forward, arms folded with a hand under the chin.
        P(S, M(yellow), [0, 0.98, 0.02], [0.22, 0.27, 0.19], [0.25, 0, 0]);
        for (const sx of [-1, 1]) P(C, M(yellow), [sx * 0.12, 1.08, 0.2], [0.055, 0.28, 0.055], [1.1, 0, sx * 0.95]);
        P(S, M(yellow), [0.03, 1.16, 0.3], [0.075, 0.065, 0.065]);
        // Big round head with the snout and mouth.
        P(S, M(yellow), [0, 1.42, 0.06], [0.24, 0.26, 0.23]);
        P(S, M(yellow), [0, 1.3, 0.25], [0.12, 0.1, 0.1]);
        P(smile, M(0x9a6b00), [0, 1.28, 0.33], [0.06, 0.04, 0.2], [0, 0, Math.PI]);
        // Goggles over the eyes: thick black frames, amber lenses, a thin white strap.
        for (const sx of [-1, 1]) {
          P(frame, M(black), [sx * 0.105, 1.46, 0.26], [0.1, 0.1, 0.12], [-0.15, sx * 0.25, 0]);
          P(C, M(0xf6cf4f, { emissive: 0x4a3200 }), [sx * 0.105, 1.46, 0.255], [0.085, 0.01, 0.085], [Math.PI / 2 - 0.15, 0, sx * -0.25]);
          P(S, M(black), [sx * 0.09, 1.45, 0.24], [0.03, 0.045, 0.015]);
        }
        P(ring, M(0xf2f2f2), [0, 1.46, 0.06], [0.245, 0.245, 0.3], [Math.PI / 2 + 0.1, 0, 0]);
        // Editor marks: the spot where the kart is put back and the direction it faces.
        P(C, M(0x60a5fa, { transparent: true, opacity: 0.5 }), [0, 0.01, 0], [0.6, 0.02, 0.6]);
        P(K, M(0x60a5fa, { emissive: 0x1d4ed8 }), [0, 0.05, 0.75], [0.14, 0.4, 0.14], [Math.PI / 2, 0, 0]);
        break;
      }
      case 'cannon': {
        P(C, M(0x5b4636), [0, 0.2, 0], [0.6, 0.4, 0.6]);
        P(C, M(0x2f2f35), [0, 0.75, 0.2], [0.32, 1.3, 0.32], [Math.PI / 3, 0, 0]);
        P(T, M(0xfb7185), [0, 1.08, 0.75], [0.33, 0.33, 0.33], [Math.PI / 3 - Math.PI / 2, 0, 0]);
        for (const x of [-0.5, 0.5]) wheel(x, 0.35, 0, 0.35, 0.1);
        break;
      }
      case 'trophy': { // battle end point
        P(C, M(0x555b66), [0, 0.1, 0], [0.5, 0.2, 0.5]);
        P(C, M(0xf5c542, { metalness: 0.6, roughness: 0.3 }), [0, 0.35, 0], [0.08, 0.35, 0.08]);
        P(this.hemi(), M(0xf5c542, { metalness: 0.6, roughness: 0.3, side: THREE.DoubleSide }), [0, 0.95, 0], [0.35, -0.45, 0.35]);
        for (const x of [-0.4, 0.4]) P(T, M(0xf5c542), [x, 0.8, 0], [0.13, 0.13, 0.13], [0, Math.PI / 2, 0]);
        break;
      }
      case 'routepoint':
        P(this.geo('octa', () => new THREE.OctahedronGeometry(1)), M(0xa855f7, { emissive: 0x3b0764 }), [0, 0.45, 0], 0.4);
        break;

      // --------------------------------------------------- objects
      case 'itembox': {
        const tex = this.canvasTexture('itembox', (ctx, n) => {
          const gr = ctx.createLinearGradient(0, 0, n, n);
          ['#ff4d6d', '#ffb020', '#ffe14d', '#4ade80', '#38bdf8', '#a78bfa'].forEach((c, i, a) => gr.addColorStop(i / (a.length - 1), c));
          ctx.fillStyle = gr; ctx.fillRect(0, 0, n, n);
          ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(10, 10, n - 20, n - 20);
          ctx.fillStyle = '#fff'; ctx.font = `bold ${n * 0.7}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.strokeStyle = '#b45309'; ctx.lineWidth = 6; ctx.strokeText('?', n / 2, n / 2 + 4); ctx.fillText('?', n / 2, n / 2 + 4);
        });
        // The KMP coordinate is the centre of the item box, as in its BRRES model.
        P(B, this.geo('itembox-mat', () => new THREE.MeshStandardMaterial({ map: tex, transparent: true, opacity: 0.88, roughness: 0.3, emissive: 0x332200 })), [0, 0, 0], 1.25, [0.4, 0.6, 0.2]);
        break;
      }
      case 'goomba':
        P(S, M(0x8b4513), [0, 0.85, 0], [0.62, 0.5, 0.62]);
        P(C, M(0xf3d9b1), [0, 0.38, 0], [0.34, 0.42, 0.34]);
        for (const x of [-0.24, 0.24]) P(S, M(0x3b2314), [x, 0.1, 0.1], [0.2, 0.12, 0.3]);
        eyes(0.82, 0.5, 0.15, 0.12, 0.07);
        for (const x of [-0.15, 0.15]) P(B, M(0x111111), [x, 0.98, 0.52], [0.18, 0.05, 0.05], [0, 0, x > 0 ? 0.4 : -0.4]);
        break;
      case 'chomp':
        P(S, M(0x15161a, { roughness: 0.3, metalness: 0.4 }), [0, 0.9, 0], 0.85);
        eyes(1.15, 0.62, 0.32, 0.18, 0.09);
        P(B, M(0xcc1e2b), [0, 0.65, 0.62], [0.9, 0.22, 0.35]);
        for (let i = -3; i <= 3; i++) P(K, M(0xffffff), [i * 0.12, 0.76, 0.74], [0.06, 0.14, 0.06], [Math.PI, 0, 0]);
        for (let i = 0; i < 4; i++) P(T, M(0x555555, { metalness: 0.6 }), [0, 0.35, -0.9 - i * 0.28], [0.13, 0.13, 0.13], [0, i % 2 ? Math.PI / 2 : 0, 0]);
        P(C, M(0x6b4f2a), [0, 0.3, -2.0], [0.1, 0.6, 0.1]);
        break;
      case 'thwomp':
        P(B, M(0x8d95a5), [0, 0.95, 0], [1.4, 1.7, 0.9]);
        for (const [x, y] of [[-0.75, 0.5], [-0.75, 1.4], [0.75, 0.5], [0.75, 1.4]]) P(K, M(0x6b7280), [x, y, 0], [0.18, 0.4, 0.18], [0, 0, x > 0 ? -Math.PI / 2 : Math.PI / 2]);
        for (const x of [-0.35, 0.35]) P(B, M(0x111111), [x, 1.35, 0.46], [0.3, 0.14, 0.05]);
        eyes(1.15, 0.46, 0.33, 0.13, 0.08);
        P(B, M(0x111111), [0, 0.6, 0.46], [0.8, 0.2, 0.05]);
        break;
      case 'piranha':
        P(C, M(0x2e9e44), [0, 0.45, 0], [0.08, 0.9, 0.08]);
        for (const x of [-0.25, 0.25]) P(S, M(0x3fbf5a), [x, 0.35, 0], [0.25, 0.06, 0.12], [0, 0, x > 0 ? 0.4 : -0.4]);
        P(S, M(0xd42a2a), [0, 1.2, 0.05], 0.45);
        for (const [x, y, z] of [[0.25, 1.45, 0.2], [-0.28, 1.3, 0.25], [0.05, 1.6, -0.1], [0.38, 1.1, -0.1], [-0.3, 1.5, -0.15]]) P(S, M(0xffffff), [x, y, z], 0.08);
        P(T, M(0xffffff), [0, 1.15, 0.4], [0.28, 0.12, 0.28], [0, 0, 0]);
        break;
      case 'pokey':
        for (let i = 0; i < 4; i++) {
          P(S, M(0xe9c64a), [0, 0.3 + i * 0.5, 0], 0.28);
          for (const a of [0, 1, 2, 3]) P(K, M(0xffffff), [Math.cos(a * Math.PI / 2) * 0.28, 0.3 + i * 0.5, Math.sin(a * Math.PI / 2) * 0.28], [0.03, 0.12, 0.03], [0, 0, Math.PI / 2]);
        }
        eyes(1.9, 0.24, 0.1, 0.07, 0.04);
        P(S, M(0xff6fae), [0, 2.15, 0], [0.12, 0.06, 0.12]);
        break;
      case 'mole':
        P(this.hemi(), M(0x6b4423), [0, 0, 0], [0.7, 0.35, 0.7]);
        P(S, M(0x4a3426), [0, 0.45, 0.1], [0.35, 0.4, 0.33]);
        P(S, M(0xf3a6a6), [0, 0.5, 0.42], 0.08);
        eyes(0.62, 0.36, 0.1, 0.06, 0.04, 0x111111);
        for (const x of [-0.25, 0.25]) P(S, M(0xf3d9b1), [x, 0.38, 0.3], [0.1, 0.06, 0.08]);
        break;
      case 'cow':
        P(B, M(0xfafafa), [0, 0.75, 0], [0.7, 0.55, 1.2]);
        for (const [x, y, z, sx, sz] of [[0.36, 0.85, 0.2, 0.02, 0.4], [-0.36, 0.7, -0.25, 0.02, 0.35], [0.1, 1.03, -0.3, 0.35, 0.3]]) P(B, M(0x111111), [x, y, z], [sx || 0.02, 0.25, sz]);
        P(B, M(0xfafafa), [0, 0.95, 0.75], [0.45, 0.45, 0.4]);
        P(B, M(0xf3a6a6), [0, 0.85, 0.97], [0.36, 0.2, 0.06]);
        for (const x of [-0.18, 0.18]) P(K, M(0xe8dcc0), [x, 1.25, 0.75], [0.05, 0.18, 0.05]);
        for (const [x, z] of [[-0.25, 0.45], [0.25, 0.45], [-0.25, -0.45], [0.25, -0.45]]) P(B, M(0xf0f0f0), [x, 0.25, z], [0.14, 0.5, 0.14]);
        break;
      case 'shyguy':
        P(C, M(0xd62828), [0, 0.45, 0], [0.32, 0.6, 0.32]);
        P(S, M(0xd62828), [0, 0.85, 0], 0.34);
        P(S, M(0xffffff), [0, 0.85, 0.17], [0.26, 0.3, 0.2]);
        for (const x of [-0.08, 0.08]) P(S, M(0x111111), [x, 0.92, 0.36], [0.04, 0.07, 0.02]);
        P(S, M(0x111111), [0, 0.74, 0.36], [0.06, 0.04, 0.02]);
        for (const x of [-0.14, 0.14]) P(S, M(0x3b4cca), [x, 0.08, 0.05], [0.13, 0.08, 0.18]);
        break;
      case 'wiggler':
        for (let i = 0; i < 5; i++) P(S, M(0xf5c518), [0, 0.38, -i * 0.5], 0.36);
        P(S, M(0xf5a518), [0, 0.6, 0.45], 0.42);
        eyes(0.72, 0.85, 0.15, 0.1, 0.06);
        P(S, M(0xff6fae), [0, 1.05, 0.4], [0.15, 0.06, 0.15]);
        for (let i = 0; i < 5; i++) for (const x of [-0.25, 0.25]) P(S, M(0xff8c00), [x, 0.05, -i * 0.5], [0.1, 0.06, 0.14]);
        break;
      case 'boo':
        P(S, M(0xf8f8ff, { emissive: 0x222233 }), [0, 0.9, 0], 0.6);
        eyes(1.0, 0.52, 0.18, 0.07, 0.06, 0x111111);
        P(S, M(0xe11d48), [0, 0.72, 0.5], [0.15, 0.1, 0.1]);
        for (const x of [-0.6, 0.6]) P(S, M(0xf8f8ff), [x, 0.85, 0.1], [0.18, 0.12, 0.12]);
        break;
      case 'bat':
        P(S, M(0x5b3a8c), [0, 0.6, 0], 0.25);
        for (const x of [-1, 1]) P(B, M(0x3e2766), [x * 0.45, 0.62, 0], [0.6, 0.04, 0.35], [0, 0, x * 0.3]);
        eyes(0.68, 0.2, 0.08, 0.06, 0.03, 0xffe14d);
        break;
      case 'duck':
        P(S, M(0x2f6fd6), [0, 0.45, 0], [0.45, 0.38, 0.6]);
        P(S, M(0x2f6fd6), [0, 0.9, 0.35], 0.28);
        P(K, M(0xff9f1c), [0, 0.88, 0.7], [0.1, 0.3, 0.06], [Math.PI / 2, 0, 0]);
        eyes(1.0, 0.55, 0.12, 0.07, 0.04);
        break;
      case 'crab':
        P(S, M(0xff6b35), [0, 0.35, 0], [0.55, 0.28, 0.4]);
        for (const x of [-1, 1]) {
          P(S, M(0xff6b35), [x * 0.75, 0.45, 0.35], [0.22, 0.16, 0.16]);
          for (const z of [-0.2, 0, 0.2]) P(B, M(0xe85a2a), [x * 0.6, 0.15, z], [0.4, 0.05, 0.05], [0, 0, x * -0.5]);
        }
        for (const x of [-0.15, 0.15]) P(C, M(0xff6b35), [x, 0.65, 0.2], [0.03, 0.2, 0.03]);
        eyes(0.78, 0.2, 0.15, 0.06, 0.035);
        break;
      case 'fish':
        P(S, M(0xef4444), [0, 0.6, 0], [0.32, 0.4, 0.45]);
        P(K, M(0xfacc15), [0, 0.6, -0.55], [0.25, 0.3, 0.1], [-Math.PI / 2, 0, 0]);
        eyes(0.72, 0.32, 0.15, 0.08, 0.05);
        break;
      case 'bomb':
        P(S, M(0x111111, { metalness: 0.3, roughness: 0.4 }), [0, 0.55, 0], 0.5);
        P(C, M(0x666666), [0, 1.08, 0], [0.12, 0.1, 0.12]);
        P(C, M(0xd9c7a0), [0, 1.22, 0], [0.03, 0.2, 0.03]);
        P(S, M(0xffaa00, { emissive: 0xff5500 }), [0, 1.35, 0], 0.06);
        eyes(0.62, 0.45, 0.13, 0.08, 0.04);
        for (const x of [-0.2, 0.2]) P(S, M(0xf5c518), [x, 0.06, 0.08], [0.15, 0.08, 0.22]);
        break;
      case 'bird':
        P(S, M(0xffffff), [0, 0.6, 0], [0.25, 0.22, 0.45]);
        for (const x of [-1, 1]) P(B, M(0xe5e7eb), [x * 0.45, 0.7, 0], [0.7, 0.03, 0.25], [0, 0, x * 0.25]);
        P(K, M(0xff9f1c), [0, 0.62, 0.5], [0.05, 0.15, 0.05], [Math.PI / 2, 0, 0]);
        break;
      case 'spikedtop':
        P(K, M(0x8d95a5, { metalness: 0.5 }), [0, 0.35, 0], [0.55, 0.7, 0.55], [Math.PI, 0, 0]);
        P(C, M(0xe11d48), [0, 0.72, 0], [0.55, 0.12, 0.55]);
        for (let i = 0; i < 8; i++) P(K, M(0xdddddd), [Math.cos(i * TAU / 8) * 0.58, 0.72, Math.sin(i * TAU / 8) * 0.58], [0.06, 0.2, 0.06], [0, 0, 0]);
        break;
      case 'fire':
        for (const [x, z, h] of [[0, 0, 1.1], [0.2, 0.1, 0.7], [-0.18, -0.1, 0.8]]) {
          P(K, M(0xff5a1f, { emissive: 0xff3300 }), [x, h / 2, z], [0.25, h, 0.25]);
          P(K, M(0xffd23f, { emissive: 0xffaa00 }), [x, h * 0.35, z], [0.13, h * 0.6, 0.13]);
        }
        break;
      case 'propeller':
        P(C, M(0x777777), [0, 0.6, 0], [0.08, 1.2, 0.08]);
        P(S, M(0xbbbbbb), [0, 1.2, 0.1], 0.15);
        for (let i = 0; i < 3; i++) P(B, M(0xe5e7eb), [Math.cos(i * TAU / 3) * 0.45, 1.2 + Math.sin(i * TAU / 3) * 0.45, 0.12], [0.8, 0.18, 0.04], [0, 0, i * TAU / 3]);
        break;
      case 'press':
        P(B, M(0x52525b), [0, 1.6, 0], [1.2, 0.3, 1.2]);
        P(C, M(0xa1a1aa, { metalness: 0.7 }), [0, 1.1, 0], [0.15, 0.8, 0.15]);
        P(B, M(0x71717a), [0, 0.35, 0], [1.1, 0.7, 1.1]);
        break;
      case 'rock':
        P(this.geo('dodeca', () => new THREE.DodecahedronGeometry(1, 0)), M(0x8a8178), [0, 0.5, 0], [0.7, 0.55, 0.65], [0.3, 0.5, 0.1]);
        break;
      case 'pipe':
        P(C, M(0x16a34a), [0, 0.5, 0], [0.42, 1.0, 0.42]);
        P(C, M(0x22c55e), [0, 1.05, 0], [0.52, 0.22, 0.52]);
        P(C, M(0x052e16), [0, 1.17, 0], [0.38, 0.02, 0.38]);
        break;
      case 'coin':
        P(C, M(0xfacc15, { metalness: 0.7, roughness: 0.25, emissive: 0x553300 }), [0, 0.6, 0], [0.4, 0.08, 0.4], [Math.PI / 2, 0, 0]);
        break;
      case 'mushroom':
        P(C, M(0xfff3e0), [0, 0.35, 0], [0.25, 0.7, 0.25]);
        P(this.hemi(), M(0xe53935), [0, 0.65, 0], [0.65, 0.5, 0.65]);
        for (const [x, y, z] of [[0, 1.1, 0], [0.42, 0.85, 0.2], [-0.4, 0.85, 0.25], [0.1, 0.9, -0.45]]) P(S, M(0xffffff), [x, y, z], 0.12);
        eyes(0.45, 0.24, 0.08, 0.05, 0.035, 0x111111);
        break;
      case 'tree':
        P(C, M(0x7a4a24), [0, 0.6, 0], [0.16, 1.2, 0.16]);
        P(K, M(0x2f7d32), [0, 1.5, 0], [0.75, 1.1, 0.75]);
        P(K, M(0x388e3c), [0, 2.1, 0], [0.55, 0.9, 0.55]);
        break;
      case 'palm':
        P(C, M(0x9c6b3c), [0.1, 0.9, 0], [0.12, 1.8, 0.12], [0, 0, -0.12]);
        for (let i = 0; i < 6; i++) P(B, M(0x3fa34d), [0.2 + Math.cos(i * TAU / 6) * 0.45, 1.8, Math.sin(i * TAU / 6) * 0.45], [0.9, 0.03, 0.22], [0, -i * TAU / 6, -0.35]);
        P(S, M(0x6b4423), [0.2, 1.75, 0], 0.12);
        break;
      case 'flower':
        P(C, M(0x2e9e44), [0, 0.3, 0], [0.04, 0.6, 0.04]);
        for (let i = 0; i < 6; i++) P(S, M(0xff6fae), [Math.cos(i * TAU / 6) * 0.17, 0.65, Math.sin(i * TAU / 6) * 0.17], [0.12, 0.05, 0.12]);
        P(S, M(0xffe14d), [0, 0.67, 0], 0.09);
        break;
      case 'bush':
        for (const [x, z, r] of [[0, 0, 0.45], [0.35, 0.1, 0.32], [-0.35, -0.05, 0.34], [0.05, 0.3, 0.3]]) P(S, M(0x3b8f3e), [x, r * 0.8, z], r);
        break;
      case 'car': case 'bus': case 'truck': {
        const col = opts.color ?? (key === 'bus' ? 0xfacc15 : key === 'truck' ? 0x2563eb : 0xef4444);
        const L = key === 'bus' ? 2.6 : key === 'truck' ? 2.4 : 1.6, H = key === 'car' ? 0.4 : 0.9;
        P(B, M(col), [0, 0.25 + H / 2, 0], [0.9, H, L]);
        if (key === 'car') P(B, M(0x9fd3ff, { transparent: true, opacity: 0.7 }), [0, 0.85, -0.1], [0.75, 0.32, 0.8]);
        if (key === 'truck') P(B, M(0xdddddd), [0, 0.95, -0.35], [0.9, 1.1, 1.6]);
        if (key === 'bus') for (let i = 0; i < 4; i++) for (const x of [-0.46, 0.46]) P(B, M(0x9fd3ff), [x, 0.95, -0.9 + i * 0.55], [0.02, 0.3, 0.4]);
        for (const z of [L / 2 - 0.35, -L / 2 + 0.35]) for (const x of [-0.48, 0.48]) wheel(x, 0.22, z);
        break;
      }
      case 'minecart':
        P(B, M(0x7a4a24), [0, 0.55, 0], [0.9, 0.5, 1.2]);
        P(B, M(0x3b2314), [0, 0.81, 0], [0.8, 0.02, 1.1]);
        for (const z of [-0.4, 0.4]) for (const x of [-0.45, 0.45]) wheel(x, 0.2, z, 0.2, 0.1);
        break;
      case 'boat':
        P(B, M(0xf5f5f5), [0, 0.3, 0], [0.9, 0.5, 2.0]);
        P(K, M(0xf5f5f5), [0, 0.3, 1.2], [0.45, 0.5, 0.45], [Math.PI / 2, 0, 0]);
        P(C, M(0x8b5a2b), [0, 1.2, 0], [0.04, 1.6, 0.04]);
        P(B, M(0xffffff), [0, 1.3, 0.25], [0.02, 1.0, 0.5]);
        break;
      case 'train':
        P(B, M(0x1f2937), [0, 0.7, 0], [0.9, 0.9, 2.2]);
        P(C, M(0x111827), [0, 0.8, 0.9], [0.38, 1.0, 0.38], [Math.PI / 2, 0, 0]);
        P(C, M(0x374151), [0, 1.35, 0.8], [0.12, 0.4, 0.12]);
        for (const z of [-0.7, 0, 0.7]) for (const x of [-0.48, 0.48]) wheel(x, 0.25, z, 0.25);
        break;
      case 'balloon':
        P(S, M(0xef4444), [0, 1.8, 0], [0.8, 1.0, 0.8]);
        P(B, M(0x8b5a2b), [0, 0.4, 0], [0.4, 0.3, 0.4]);
        for (const x of [-0.15, 0.15]) P(C, M(0x444444), [x, 0.95, 0], [0.01, 0.9, 0.01]);
        break;
      case 'flag':
        P(C, M(0xd4d4d8), [0, 1.0, 0], [0.04, 2.0, 0.04]);
        P(B, this.geo('flag-mat', () => new THREE.MeshStandardMaterial({ map: this.checkerTexture(), side: THREE.DoubleSide })), [0, 1.65, 0.35], [0.02, 0.5, 0.7]);
        break;
      case 'sun':
        P(S, M(0xffd23f, { basic: true }), [0, 1.0, 0], 0.6);
        for (let i = 0; i < 8; i++) P(K, M(0xffaa00, { basic: true }), [Math.cos(i * TAU / 8) * 0.85, 1.0 + Math.sin(i * TAU / 8) * 0.85, 0], [0.12, 0.35, 0.12], [0, 0, i * TAU / 8 - Math.PI / 2]);
        break;
      case 'water':
        P(C, M(0x38bdf8, { transparent: true, opacity: 0.55, emissive: 0x0c4a6e }), [0, 0.02, 0], [1.2, 0.04, 1.2]);
        for (const r of [0.5, 0.9]) P(T, M(0xe0f2fe), [0, 0.05, 0], [r, r, 0.15], [Math.PI / 2, 0, 0]);
        break;
      case 'speaker':
        P(B, M(0x334155), [0, 0.45, 0], [0.5, 0.7, 0.4]);
        P(C, M(0x0f172a), [0, 0.5, 0.21], [0.17, 0.04, 0.17], [Math.PI / 2, 0, 0]);
        for (const r of [0.45, 0.7]) P(this.geo('arc', () => new THREE.TorusGeometry(1, 0.05, 6, 12, Math.PI / 2)), M(0x7dd3fc, { emissive: 0x0369a1 }), [0, 0.5, 0.2], [r, r, r], [0, -Math.PI / 2, -Math.PI / 4]);
        break;
      case 'sparkle':
        P(this.geo('octa', () => new THREE.OctahedronGeometry(1)), M(0xfff7ae, { emissive: 0xffd23f }), [0, 0.8, 0], [0.25, 0.5, 0.25]);
        P(T, M(0xffe680, { emissive: 0xaa8800 }), [0, 0.8, 0], [0.45, 0.45, 0.2], [Math.PI / 2, 0, 0]);
        break;
      case 'cloud':
        for (const [x, y, r] of [[0, 0.7, 0.45], [0.4, 0.6, 0.35], [-0.42, 0.62, 0.33]]) P(S, M(0xd1d5db, { transparent: true, opacity: 0.85 }), [x, y, 0], r);
        break;
      case 'sign':
        P(C, M(0x7a4a24), [0, 0.5, 0], [0.05, 1.0, 0.05]);
        P(B, M(0xfacc15), [0, 1.1, 0.03], [0.9, 0.5, 0.05]);
        break;
      case 'lamp':
        P(C, M(0x3f3f46), [0, 0.9, 0], [0.05, 1.8, 0.05]);
        P(S, M(0xfff1a8, { emissive: 0xffcc33 }), [0, 1.85, 0], 0.18);
        break;
      default: { // generic crate, colored by category
        const col = opts.color ?? 0xf59e0b;
        P(B, M(col), [0, 0.5, 0], 0.95);
        const edge = M(new THREE.Color(col).multiplyScalar(0.55).getHex());
        for (const [x, z] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]]) P(B, edge, [x, 0.5, z], [0.1, 1.0, 0.1]);
        for (const y of [0.05, 0.95]) for (const [x, z, sx, sz] of [[0, -0.45, 1, 0.1], [0, 0.45, 1, 0.1], [-0.45, 0, 0.1, 1], [0.45, 0, 0.1, 1]]) P(B, edge, [x, y, z], [sx, 0.1, sz]);
        break;
      }
    }
    return g;
  }
}

export { hashColor };
