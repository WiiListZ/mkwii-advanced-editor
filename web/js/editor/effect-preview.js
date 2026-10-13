// Approximate preview of particle effects in the 3D view. Objects whose effect folder is in the
// track (effect/<object name>/*.breff, like effect/wanwan/ for Chain Chomps) emit the particles of
// every emitter: emission rate, particle life, speeds, colour, size and first texture come from
// the BREFF/BREFT. Curves, animations and event triggers of the game's engine are not simulated:
// one-shot effects (smoke when landing…) simply repeat.

import * as THREE from 'three';
import { listFiles } from '../formats/u8.js';
import { parseBREFF, parseBREFT, decodeBREFTTexture } from '../formats/effects.js';

const MAX_PARTICLES = 160;      // per emitter
const MAX_SYSTEMS = 300;        // per track
const DEG = Math.PI / 180;

const VERTEX = `
attribute float aSize;
attribute float aAlpha;
varying float vAlpha;
uniform float uScale;
void main() {
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = max(1.0, aSize * uScale / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const FRAGMENT = `
uniform sampler2D uMap;
uniform vec3 uColor;
uniform float uHasMap;
varying float vAlpha;
void main() {
  vec4 tex = uHasMap > 0.5 ? texture2D(uMap, gl_PointCoord) : vec4(1.0, 1.0, 1.0, 1.0 - smoothstep(0.35, 0.5, length(gl_PointCoord - 0.5)));
  float a = tex.a * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(tex.rgb * uColor, a);
}`;

export class EffectPreview {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'effect-preview';
    this.group.renderOrder = 20;
    scene.add(this.group);
    this.enabled = true;
    this.systems = [];
    this.textures = new Map(); // `${file data identity}:${texture}` -> THREE texture
    this.signature = '';
    this.viewportHeight = 800;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    this.group.visible = enabled;
  }

  clear() {
    for (const s of this.systems) { s.points.geometry.dispose(); s.points.material.dispose(); }
    this.systems = [];
    this.group.clear();
  }

  // objects: [{ uid, objectId, position, rotation, scale }]; names(objectId) gives its resource names.
  sync(tree, objects, names) {
    const effects = tree ? this.effectFolders(tree) : new Map();
    const placed = [];
    if (effects.size) for (const o of objects) {
      const folder = names(o.objectId).map((n) => effects.get(n.toLowerCase())).find(Boolean);
      if (folder) placed.push({ o, folder });
    }
    const signature = placed.map(({ o, folder }) => `${o.uid}|${folder.id}|${o.position}|${o.rotation}|${o.scale}`).join(';');
    if (signature === this.signature) return;
    this.signature = signature;
    this.clear();
    for (const { o, folder } of placed) {
      if (this.systems.length >= MAX_SYSTEMS) break;
      const holder = new THREE.Group();
      holder.position.fromArray(o.position);
      holder.rotation.set(o.rotation[0] * DEG, o.rotation[1] * DEG, o.rotation[2] * DEG);
      holder.scale.fromArray(o.scale.map((s) => s || 1));
      this.group.add(holder);
      for (const emitter of folder.emitters) {
        if (this.systems.length >= MAX_SYSTEMS) break;
        this.systems.push(this.system(holder, emitter, folder));
      }
    }
  }

  // One effect on its own at the origin (the effects editor's preview). key changes when the files do.
  // textures: Map of texture name -> { data, tex } from the effect's BREFT.
  showEffect(key, emitters, textures) {
    if (key === this.signature) return;
    this.signature = key;
    this.clear();
    const holder = new THREE.Group();
    this.group.add(holder);
    for (const emitter of emitters.slice(0, MAX_SYSTEMS)) this.systems.push(this.system(holder, emitter, { textures }));
  }

  // Rough size of the effect (emitter offsets, how far particles travel, particle size) to frame a camera.
  static extent(emitters) {
    let radius = 50;
    for (const emitter of emitters) {
      const e = emitter.values.emitter, p = emitter.values.particle;
      const offset = Math.hypot(...e.translate);
      const speed = Math.abs(e.velPowerRadiationDir) + Math.abs(e.velPowerYAxis) + Math.abs(e.velPowerRandomDir) + Math.abs(e.velPowerNormalDir);
      radius = Math.max(radius, offset + speed / (1 - DRAG) + Math.abs(p.size[0] * (p.scale[0] || 1)));
    }
    return radius;
  }

  // effect/<folder>/... grouped by folder name, with their emitters and textures.
  effectFolders(tree) {
    const folders = new Map();
    for (const f of listFiles(tree)) {
      const m = f.path.match(/^effect\/([^/]+)\/[^/]+\.(breff|breft)$/i);
      if (!m) continue;
      const key = m[1].toLowerCase();
      const folder = folders.get(key) || { id: '', emitters: [], textures: new Map() };
      try {
        if (m[2].toLowerCase() === 'breff') folder.emitters.push(...parseBREFF(f.node.data).emitters);
        else for (const t of parseBREFT(f.node.data).textures) folder.textures.set(t.name, { data: f.node.data, tex: t });
        folder.id += `${f.path}:${f.node.data.length}:${dataId(f.node.data)};`;
      } catch { /* unreadable effect: skipped */ }
      folders.set(key, folder);
    }
    return folders;
  }

  texture(folder, name) {
    const entry = name && folder.textures.get(name);
    if (!entry) return null;
    const key = `${dataId(entry.data)}:${name}`;
    if (this.textures.has(key)) return this.textures.get(key);
    let texture = null;
    try {
      const pixels = decodeBREFTTexture(entry.data, entry.tex);
      if (pixels) {
        texture = new THREE.DataTexture(new Uint8Array(pixels), entry.tex.width, entry.tex.height, THREE.RGBAFormat);
        texture.flipY = false;
        texture.needsUpdate = true;
      }
    } catch { /* drawn as a soft dot */ }
    this.textures.set(key, texture);
    return texture;
  }

  system(holder, emitter, folder) {
    const e = emitter.values.emitter, p = emitter.values.particle;
    const life = Math.max(1, e.ptclLife || 30);
    const interval = Math.max(1, e.emitInterval || 1);
    const perEmit = Math.max(0, e.emitEmit);
    const capacity = Math.min(MAX_PARTICLES, Math.max(4, Math.ceil(perEmit * life / interval) + 2));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(capacity), 1));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(capacity), 1));
    const map = this.texture(folder, emitter.textures[0]);
    const [r, g, b, a] = p.color1Primary;
    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false,
      uniforms: { uMap: { value: map }, uHasMap: { value: map ? 1 : 0 }, uColor: { value: new THREE.Color(r / 255, g / 255, b / 255) }, uScale: { value: this.viewportHeight / 2 } },
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    const local = new THREE.Group();
    local.position.fromArray(e.translate);
    local.rotation.set(...e.rotate);
    local.scale.fromArray(e.scale.map((s) => s || 1));
    local.add(points);
    holder.add(local);
    return {
      points, capacity, life, interval, perEmit, alpha: (a || 255) / 255,
      size: Math.abs(p.size[0] * (p.scale[0] || 1)) || 10,
      emitLife: e.emitLife && e.emitLife < 65535 ? e.emitLife : Infinity,
      start: e.emitStart || 0,
      speed: { out: e.velPowerRadiationDir, up: e.velPowerYAxis, random: e.velPowerRandomDir, normal: e.velPowerNormalDir },
      particles: [], frame: 0, carry: 0,
    };
  }

  step(dt, viewportHeight) {
    if (!this.enabled || !this.systems.length) return false;
    this.viewportHeight = viewportHeight || this.viewportHeight;
    const frames = dt * 60;
    for (const s of this.systems) {
      s.points.material.uniforms.uScale.value = this.viewportHeight / 2;
      const from = s.frame;
      s.frame += frames;
      // Frames of this step inside the emitter's active time. Emitters with a limited life
      // (often one frame: a burst) restart once their particles are gone.
      const active = activeFrames(from, s.frame, s.start, s.emitLife, s.life);
      if (active > 0) {
        s.carry += Math.max(active, s.emitLife < s.interval ? 1 : 0) / s.interval * s.perEmit;
        while (s.carry >= 1 && s.particles.length < s.capacity) { s.carry -= 1; s.particles.push(spawn(s)); }
        if (s.particles.length >= s.capacity) s.carry = 0;
      }
      const pos = s.points.geometry.attributes.position, size = s.points.geometry.attributes.aSize, alpha = s.points.geometry.attributes.aAlpha;
      let n = 0;
      for (const q of s.particles) {
        q.age += frames;
        if (q.age >= s.life) continue;
        q.x += q.vx * frames; q.y += q.vy * frames; q.z += q.vz * frames;
        // Rough air resistance: particles slow down instead of flying away for their whole life.
        const drag = Math.pow(DRAG, frames);
        q.vx *= drag; q.vy *= drag; q.vz *= drag;
        const k = q.age / s.life;
        pos.setXYZ(n, q.x, q.y, q.z);
        size.setX(n, s.size);
        alpha.setX(n, s.alpha * Math.min(1, k * 8) * (1 - k));
        s.particles[n++] = q;
      }
      s.particles.length = n;
      s.points.geometry.setDrawRange(0, n);
      pos.needsUpdate = size.needsUpdate = alpha.needsUpdate = true;
    }
    return true;
  }
}

const DRAG = 0.9;

function activeFrames(from, to, start, life, ptclLife) {
  if (life === Infinity) return Math.max(0, to - Math.max(from, start));
  const cycle = start + life + ptclLife;
  let total = 0;
  for (let k = Math.floor(from / cycle); k <= Math.floor(to / cycle); k++) {
    const a = k * cycle + start, b = a + life;
    total += Math.max(0, Math.min(to, b) - Math.max(from, a));
  }
  return total;
}

function spawn(s) {
  const { out, up, random, normal } = s.speed;
  const angle = Math.random() * Math.PI * 2;
  const u = Math.random() * 2 - 1, phi = Math.random() * Math.PI * 2, rr = Math.sqrt(1 - u * u);
  return {
    age: 0, x: 0, y: 0, z: 0,
    vx: Math.cos(angle) * out + rr * Math.cos(phi) * random,
    vy: up + normal + u * random,
    vz: Math.sin(angle) * out + rr * Math.sin(phi) * random,
  };
}

// Identity of a file's bytes (edits replace the array), to know when to rebuild.
const ids = new WeakMap();
let nextId = 1;
export function dataId(data) {
  if (!ids.has(data)) ids.set(data, nextId++);
  return ids.get(data);
}
