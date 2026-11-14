// Design of the track's minimap (map_model.brres), seen from above over the track's own surfaces.
// The game's minimaps colour their triangles with vertex colours; generated ones use small solid
// textures. Colours and position bones are patched in place; a new shape is rebuilt from collision.

import * as THREE from 'three';
import { isDriveableType } from '../data/defs.js';
import { decodeTexture, parseBRRES, replaceBRRESTexture } from '../formats/brres.js';
import { setBRRESBoneRestTransform } from './brres-bones.js';

export const MINIMAP_HIDDEN = -1;
// Above this the map is denser than any of the game's own (Rainbow Road: 4,479 triangles).
export const MINIMAP_ORIGINAL_MAX_TRIANGLES = 4479;
// The game's maps keep height differences small; this also preserves which road passes on top.
const MAP_HEIGHT = 1000;
const OFFROAD_AND_HAZARDS = new Set([2, 3, 4, 0x0A, 0x0B]);

const DEG = Math.PI / 180;
const byteOf = (value) => Math.max(0, Math.min(255, Math.round(value * 255)));
const hexOf = (rgb) => '#' + rgb.map((value) => value.toString(16).padStart(2, '0')).join('');
export const hexToRgb = (hex) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));

const mapModel = (brres) => brres.models.find((model) => model.name === 'map') || brres.models[0] || null;

// From each bone's SRT, as the game does: bind matrices of converted minimaps can be unusable.
function boneWorlds(model) {
  const worlds = [];
  const worldOf = (index) => {
    if (worlds[index]) return worlds[index];
    const bone = model.bones[index];
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3(...bone.trans),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...bone.rot.map((value) => value * DEG), 'ZYX')),
      new THREE.Vector3(...bone.scale),
    );
    worlds[index] = bone.parent >= 0 ? worldOf(bone.parent).clone().multiply(local) : local;
    return worlds[index];
  };
  model.bones.forEach((_, index) => worldOf(index));
  return worlds;
}

function textureColor(brres, texture, paletteName) {
  const pixels = decodeTexture(texture, paletteName ? brres.palettes?.get(paletteName) : null);
  const count = pixels.length / 4, low = [255, 255, 255], high = [0, 0, 0], sum = [0, 0, 0];
  for (let i = 0; i < pixels.length; i += 4) for (let c = 0; c < 3; c++) {
    low[c] = Math.min(low[c], pixels[i + c]); high[c] = Math.max(high[c], pixels[i + c]); sum[c] += pixels[i + c];
  }
  // Block compression can round a solid colour slightly differently from one block to the next.
  return { rgb: sum.map((value) => Math.round(value / count)), uniform: low.every((value, c) => high[c] - value <= 8) };
}

export function readMinimap(data) {
  const brres = parseBRRES(data), model = mapModel(brres);
  if (!model) return null;
  const worlds = boneWorlds(model);
  const swatches = [], byKey = new Map(), tris = [];
  const swatchFor = (key, make) => {
    if (!byKey.has(key)) { byKey.set(key, swatches.length); swatches.push({ key, count: 0, ...make() }); }
    return byKey.get(key);
  };
  const point = new THREE.Vector3();
  model.objects.forEach((object, objectIndex) => {
    const draw = model.draws.find((entry) => entry.object === objectIndex);
    const layer = model.materials[draw?.material ?? 0]?.layers?.[0];
    const texture = layer?.texture ? brres.textures.get(layer.texture) : null;
    const tex = texture ? textureColor(brres, texture, layer.palette) : null;
    const { positions, colors, mtx } = object;
    for (let t = 0; t < object.triangles; t++) {
      const p = [];
      let y = 0;
      const mean = [0, 0, 0, 0];
      for (let corner = 0; corner < 3; corner++) {
        const at = t * 3 + corner;
        point.set(positions[at * 3], positions[at * 3 + 1], positions[at * 3 + 2]);
        const rigid = model.boneMatrix.get(mtx?.[at]);
        if (rigid !== undefined && mtx[at] >= 0 && worlds[rigid]) point.applyMatrix4(worlds[rigid]);
        p.push(point.x, point.z);
        y += point.y / 3;
        for (let c = 0; c < 4; c++) mean[c] += (colors ? colors[at * 4 + c] : 1) / 3;
      }
      const first = colors ? [0, 1, 2, 3].map((c) => byteOf(colors[t * 12 + c])) : [255, 255, 255, 255];
      const white = first.every((value) => value === 255);
      let swatch;
      if (tex && white) {
        swatch = swatchFor(`t:${texture.name}`, () => ({ kind: 'texture', texture: texture.name, hex: hexOf(tex.rgb), editable: tex.uniform && ![8, 9, 10].includes(texture.format) }));
      } else {
        swatch = swatchFor(`v:${first.join(',')}`, () => ({ kind: 'vertex', rgba: first, hex: hexOf(first.slice(0, 3)), editable: true }));
      }
      swatches[swatch].count++;
      const tint = tex ? tex.rgb : [255, 255, 255];
      tris.push({ p, y, swatch, alpha: mean[3], rgb: [0, 1, 2].map((c) => Math.round(mean[c] * tint[c])) });
    }
  });
  tris.sort((a, b) => a.y - b.y);
  let extents = null;
  for (const tri of tris) for (let i = 0; i < 6; i += 2) {
    extents ||= { minX: tri.p[0], maxX: tri.p[0], minZ: tri.p[1], maxZ: tri.p[1] };
    extents.minX = Math.min(extents.minX, tri.p[i]); extents.maxX = Math.max(extents.maxX, tri.p[i]);
    extents.minZ = Math.min(extents.minZ, tri.p[i + 1]); extents.maxZ = Math.max(extents.maxZ, tri.p[i + 1]);
  }
  const boneAt = (name) => {
    const index = model.bones.findIndex((bone) => bone.name === name);
    return index < 0 ? null : new THREE.Vector3().setFromMatrixPosition(worlds[index]);
  };
  const ld = boneAt('posLD'), ru = boneAt('posRU');
  return {
    model: model.name, tris, swatches, extents, triangles: tris.length,
    bounds: ld && ru ? { minX: ld.x, maxX: ru.x, minZ: ru.z, maxZ: ld.z } : null,
  };
}

// The same 10% of the larger side the game's maps roughly keep around their road.
export function fitMinimapBounds(extents) {
  const margin = Math.max(extents.maxX - extents.minX, extents.maxZ - extents.minZ, 2000) * 0.1;
  return { minX: extents.minX - margin, maxX: extents.maxX + margin, minZ: extents.minZ - margin, maxZ: extents.maxZ + margin };
}

export function setMinimapBounds(data, bounds) {
  if (!['minX', 'maxX', 'minZ', 'maxZ'].every((key) => Number.isFinite(bounds[key]))) throw new Error('Invalid minimap frame');
  if (bounds.minX >= bounds.maxX || bounds.minZ >= bounds.maxZ) throw new Error('The minimap frame needs a left side before its right and a top before its bottom');
  const model = mapModel(parseBRRES(data));
  if (!model) throw new Error('This BRRES has no minimap model');
  const worlds = boneWorlds(model);
  let output = data;
  for (const [name, x, z] of [['posLD', bounds.minX, bounds.maxZ], ['posRU', bounds.maxX, bounds.minZ]]) {
    const index = model.bones.findIndex((bone) => bone.name === name);
    if (index < 0) throw new Error(`This minimap has no ${name} bone`);
    const bone = model.bones[index];
    const parent = bone.parent >= 0 ? worlds[bone.parent] : new THREE.Matrix4();
    const y = new THREE.Vector3().setFromMatrixPosition(worlds[index]).y;
    const local = new THREE.Vector3(x, y, z).applyMatrix4(parent.clone().invert());
    output = setBRRESBoneRestTransform(output, model.name, index, { trans: [local.x, local.y, local.z] });
  }
  return output;
}

function writeColor(view, at, format, [r, g, b, a]) {
  const scale = (value, max) => Math.round(value * max / 255);
  switch (format) {
    case 0: view.setUint16(at, (scale(r, 31) << 11) | (scale(g, 63) << 5) | scale(b, 31)); break;
    case 1: case 2: view.setUint8(at, r); view.setUint8(at + 1, g); view.setUint8(at + 2, b); break;
    case 3: view.setUint16(at, (scale(r, 15) << 12) | (scale(g, 15) << 8) | (scale(b, 15) << 4) | scale(a, 15)); break;
    case 4: {
      const packed = (scale(r, 63) << 18) | (scale(g, 63) << 12) | (scale(b, 63) << 6) | scale(a, 63);
      view.setUint8(at, packed >> 16); view.setUint8(at + 1, (packed >> 8) & 255); view.setUint8(at + 2, packed & 255);
      break;
    }
    default: view.setUint8(at, r); view.setUint8(at + 1, g); view.setUint8(at + 2, b); view.setUint8(at + 3, a);
  }
}

// Recolours swatches from readMinimap, [{ swatch, hex }], all at once: two colours can trade places.
// Alpha stays: mission maps use it for see-through parts.
export function setMinimapColors(data, changes) {
  const brres = parseBRRES(data), model = mapModel(brres);
  for (const { hex } of changes) if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error('Invalid colour');
  const vertex = new Map(changes.filter(({ swatch }) => swatch.kind === 'vertex').map(({ swatch, hex }) => [swatch.rgba.join(','), hexToRgb(hex)]));
  let output = data.slice();
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  const found = new Set();
  for (const array of model.arrays.clr.values()) for (let i = 0; i < array.count; i++) {
    const current = [0, 1, 2, 3].map((c) => byteOf(array.data[i * 4 + c])), key = current.join(','), rgb = vertex.get(key);
    if (!rgb) continue;
    found.add(key);
    writeColor(view, array.dataOffset + i * array.stride, array.format, [...rgb, current[3]]);
  }
  if (found.size !== vertex.size) throw new Error('This colour is no longer in the minimap');
  for (const { swatch, hex } of changes) {
    if (swatch.kind !== 'texture') continue;
    const texture = brres.textures.get(swatch.texture), rgb = hexToRgb(hex);
    if (!texture) throw new Error(`Texture ${swatch.texture} not found`);
    const pixels = new Uint8ClampedArray(texture.width * texture.height * 4);
    for (let i = 0; i < pixels.length; i += 4) pixels.set([...rgb, 255], i);
    output = replaceBRRESTexture(output, swatch.texture, pixels);
  }
  return output;
}

export const setMinimapSwatchColor = (data, swatch, hex) => setMinimapColors(data, [{ swatch, hex }]);

// ---- The track as seen from above ------------------------------------------------------------

const ITEM_BOX = 0x65;
export const MINIMAP_ELEMENT = { LINE: 1, OBJECT: 2, ITEM_BOX: 3, ROUTE: 4 };

// What is placed on the track now, as flat shapes (one part per element, one per route group).
export function minimapElements(kmp) {
  let lowX = Infinity, highX = -Infinity, lowZ = Infinity, highZ = -Infinity;
  const note = (x, z) => {
    lowX = Math.min(lowX, x); highX = Math.max(highX, x);
    lowZ = Math.min(lowZ, z); highZ = Math.max(highZ, z);
  };
  for (const group of kmp.ENPT) for (const point of group.points) note(point.pos[0], point.pos[2]);
  for (const group of kmp.CKPT) for (const point of group.points) { note(point.left[0], point.left[1]); note(point.right[0], point.right[1]); }
  for (const point of [...kmp.KTPT, ...kmp.GOBJ]) note(point.pos[0], point.pos[2]);
  if (lowX > highX) return [];
  // Large enough to be seen at the size the game draws the map.
  const size = Math.max(400, Math.max(highX - lowX, highZ - lowZ) * 0.012);
  const elements = [];
  const quad = (a, b, half) => {
    const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
    if (!length) return [];
    const nx = -dz / length * half, nz = dx / length * half;
    return [
      [a[0] + nx, a[1] + nz, b[0] + nx, b[1] + nz, b[0] - nx, b[1] - nz],
      [a[0] + nx, a[1] + nz, b[0] - nx, b[1] - nz, a[0] - nx, a[1] - nz],
    ];
  };
  const lap = kmp.CKPT.flatMap((group) => group.points).find((point) => point.type === 0);
  if (lap) elements.push({ kind: MINIMAP_ELEMENT.LINE, tris: quad(lap.left, lap.right, size * 0.35) });
  for (const object of kmp.GOBJ) {
    const [x, z] = [object.pos[0], object.pos[2]];
    elements.push({ kind: object.objectId === ITEM_BOX ? MINIMAP_ELEMENT.ITEM_BOX : MINIMAP_ELEMENT.OBJECT,
      tris: [[x - size, z, x, z - size, x + size, z], [x - size, z, x + size, z, x, z + size]] });
  }
  kmp.ENPT.forEach((group) => {
    const tris = [];
    const line = group.points.map((point) => [point.pos[0], point.pos[2]]);
    const next = kmp.ENPT[group.next?.[0]]?.points[0];
    if (next) line.push([next.pos[0], next.pos[2]]);
    for (let i = 1; i < line.length; i++) tris.push(...quad(line[i - 1], line[i], 1600));
    if (tris.length) elements.push({ kind: MINIMAP_ELEMENT.ROUTE, tris });
  });
  return elements.filter((element) => element.tris.length);
}

// Grain of painting, in world units, and the most triangles the editor paints and redraws smoothly.
const PAINT_CELL = 400;
const MAP_SOURCE_TYPE = 254; // not a collision surface
const MAX_PAINT_TRIANGLES = 120000;
// The canvas: the whole area a map can show, under the track, so a map can have shapes off the
// collision too (outlines, grounds, water…). Big tiles: one painted all in one colour stays two
// triangles in the game. The frame of the file and the track, with room around for a new frame.
const CANVAS_SOURCE_TYPE = 253;
const CANVAS_TILES = 8, CANVAS_PIECES = 40000, CANVAS_MARGIN = 0.25;
// Which pieces share corners: the file's own, the canvas and the collision are separate layers.
const pieceLayer = (track, i) => track.fromMap[i] ? 1 : track.canvas?.[i] ? 2 : 0;

// Driveable collision triangles and the placed elements above them. Collision triangles joined by
// a shared corner with the same surface form a part. `count` triangles are the painted grain;
// each of the `sources` holds the range first[s]..first[s + 1] of them.
export function minimapTrack(kcl, elements = [], options = {}) {
  const map = options.map || null;
  if (!kcl?.count && !elements.length && !map?.tris.length) return null;
  const keep = [];
  const v = kcl?.verts;
  for (let t = 0; t < (kcl?.count || 0); t++) {
    if (kcl.valid && !kcl.valid[t]) continue;
    if (!isDriveableType(kcl.flags[t] & 0x1f)) continue;
    const o = t * 9;
    const ux = v[o + 3] - v[o], uy = v[o + 4] - v[o + 1], uz = v[o + 5] - v[o + 2];
    const wx = v[o + 6] - v[o], wy = v[o + 7] - v[o + 1], wz = v[o + 8] - v[o + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const length = Math.hypot(nx, ny, nz);
    // Nothing of a vertical face shows on a map seen from above.
    if (!length || Math.abs(ny) / length < 0.2 || Math.abs(ny) < 2) continue;
    keep.push(t);
  }
  const surfaces = keep.length, mapTris = map?.tris.length || 0;
  // The canvas covers the track, the file's map and its frame, with a margin all round.
  let canvas = null;
  if (options.canvas) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const include = (x, z) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); };
    for (const t of keep) for (let c = 0; c < 9; c += 3) include(v[t * 9 + c], v[t * 9 + c + 2]);
    for (const tri of map?.tris || []) for (let c = 0; c < 6; c += 2) include(tri.p[c], tri.p[c + 1]);
    for (const item of elements) for (const tri of item.tris) for (let c = 0; c < 6; c += 2) include(tri[c], tri[c + 1]);
    // A frame shows as a square on the map (the In game panel): the canvas covers that square.
    for (const b of [map?.bounds, options.bounds]) if (b) {
      const half = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
      include(cx - half, cz - half); include(cx + half, cz + half);
    }
    if (minX < maxX && minZ < maxZ) {
      const margin = Math.max(maxX - minX, maxZ - minZ) * CANVAS_MARGIN;
      canvas = { minX: minX - margin, maxX: maxX + margin, minZ: minZ - margin, maxZ: maxZ + margin };
      const w = canvas.maxX - canvas.minX, h = canvas.maxZ - canvas.minZ;
      // Each tile is two right triangles cut into n × n rows of pieces.
      canvas.cell = Math.max(PAINT_CELL, Math.sqrt(4 * w * h / CANVAS_PIECES));
      canvas.divisions = Math.max(1, Math.ceil(Math.max(w, h) / CANVAS_TILES / canvas.cell));
    }
  }
  const canvasSources = canvas ? 2 * CANVAS_TILES * CANVAS_TILES : 0;
  const sources = surfaces + mapTris + elements.reduce((sum, item) => sum + item.tris.length, 0) + canvasSources;
  const sourceVerts = new Float32Array(sources * 9), sourceTypes = new Uint8Array(sources), sourceKinds = new Uint8Array(sources), parent = new Int32Array(sources);
  const sourceFromMap = new Uint8Array(sources), sourceSwatch = new Int16Array(sources).fill(MINIMAP_HIDDEN);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const corners = new Map();
  keep.forEach((t, i) => {
    sourceVerts.set(v.subarray(t * 9, t * 9 + 9), i * 9);
    sourceTypes[i] = kcl.flags[t] & 0x1f;
    parent[i] = i;
    for (let c = 0; c < 3; c++) {
      const at = i * 9 + c * 3;
      const key = `${sourceTypes[i]}/${Math.round(sourceVerts[at])}/${Math.round(sourceVerts[at + 1])}/${Math.round(sourceVerts[at + 2])}`;
      const other = corners.get(key);
      if (other === undefined) corners.set(key, i); else parent[find(i)] = find(other);
    }
  });
  let top = 0, bottom = 0;
  for (let i = 0; i < surfaces * 9; i += 3) {
    top = i ? Math.max(top, sourceVerts[i + 1]) : sourceVerts[i + 1];
    bottom = i ? Math.min(bottom, sourceVerts[i + 1]) : sourceVerts[i + 1];
  }
  let nextSource = surfaces;
  // The file's own triangles, in their height order within the track's range: the game's maps
  // squeeze heights their own way. They join into parts the same way, by colour.
  if (mapTris) {
    const lowest = map.tris[0].y, range = map.tris.at(-1).y - lowest || 1, spread = top - bottom || MAP_HEIGHT;
    const mapCorners = new Map();
    for (const tri of map.tris) {
      const y = bottom + (tri.y - lowest) / range * spread, at = nextSource;
      for (let c = 0; c < 3; c++) sourceVerts.set([tri.p[c * 2], y, tri.p[c * 2 + 1]], at * 9 + c * 3);
      sourceTypes[at] = MAP_SOURCE_TYPE; sourceFromMap[at] = 1; sourceSwatch[at] = tri.swatch; parent[at] = at;
      for (let c = 0; c < 3; c++) {
        const key = `${tri.swatch}/${Math.round(tri.p[c * 2])}/${Math.round(tri.p[c * 2 + 1])}`, other = mapCorners.get(key);
        if (other === undefined) mapCorners.set(key, at); else parent[find(at)] = find(other);
      }
      nextSource++;
    }
  }
  for (const item of elements) {
    const first = nextSource;
    for (const tri of item.tris) {
      const y = top + 1;
      sourceVerts.set([tri[0], y, tri[1], tri[2], y, tri[3], tri[4], y, tri[5]], nextSource * 9);
      sourceTypes[nextSource] = 255;
      sourceKinds[nextSource] = item.kind;
      parent[nextSource] = first;
      nextSource++;
    }
  }
  // Under everything, so the track and the file's map stay on top where they overlap. One part:
  // Fill on an empty place fills the whole background.
  if (canvas) {
    const first = nextSource, y = bottom - Math.max(100, (top - bottom) * 0.05);
    const tw = (canvas.maxX - canvas.minX) / CANVAS_TILES, th = (canvas.maxZ - canvas.minZ) / CANVAS_TILES;
    for (let tx = 0; tx < CANVAS_TILES; tx++) for (let tz = 0; tz < CANVAS_TILES; tz++) {
      const x0 = canvas.minX + tx * tw, x1 = x0 + tw, z0 = canvas.minZ + tz * th, z1 = z0 + th;
      for (const tri of [[x0, z0, x1, z0, x0, z1], [x1, z1, x0, z1, x1, z0]]) {
        sourceVerts.set([tri[0], y, tri[1], tri[2], y, tri[3], tri[4], y, tri[5]], nextSource * 9);
        sourceTypes[nextSource] = CANVAS_SOURCE_TYPE;
        parent[nextSource] = first;
        nextSource++;
      }
    }
  }

  // Collision can hold one triangle for half a battle arena, and painting needs a finer grain.
  // Elements stay whole: their exact shape is how a map is read back.
  const longestEdge = (s) => {
    const o = s * 9, w = sourceVerts;
    return Math.max(Math.hypot(w[o] - w[o + 3], w[o + 2] - w[o + 5]), Math.hypot(w[o + 3] - w[o + 6], w[o + 5] - w[o + 8]), Math.hypot(w[o + 6] - w[o], w[o + 8] - w[o + 2]));
  };
  let lowX = Infinity, highX = -Infinity, lowZ = Infinity, highZ = -Infinity;
  for (let i = 0; i < (surfaces + mapTris) * 9; i += 3) {
    lowX = Math.min(lowX, sourceVerts[i]); highX = Math.max(highX, sourceVerts[i]);
    lowZ = Math.min(lowZ, sourceVerts[i + 2]); highZ = Math.max(highZ, sourceVerts[i + 2]);
  }
  // The canvas has a grain of its own, outside the budget of the track's.
  const isCanvas = (s) => sourceTypes[s] === CANVAS_SOURCE_TYPE;
  const divisionsOf = (s, size) => isCanvas(s) ? canvas.divisions : sourceKinds[s] ? 1 : Math.max(1, Math.ceil(longestEdge(s) / size));
  const total = (size, withCanvas = false) => { let sum = 0; for (let s = 0; s < sources; s++) if (withCanvas || !isCanvas(s)) sum += divisionsOf(s, size) ** 2; return sum; };
  let cell = options.cell ?? Math.max(PAINT_CELL, (Math.max(highX - lowX, highZ - lowZ) || 0) / 160);
  while (Number.isFinite(cell) && total(cell) > MAX_PAINT_TRIANGLES) cell *= 1.25;

  const count = total(cell, true), verts = new Float32Array(count * 9), types = new Uint8Array(count), element = new Uint8Array(count);
  const fromMap = new Uint8Array(count), swatch = new Int16Array(count), onCanvas = new Uint8Array(count);
  const piece = new Int32Array(count), source = new Int32Array(count), first = new Int32Array(sources + 1), groups = new Map();
  let next = 0;
  const push = (s, a, b, c) => {
    verts.set(a, next * 9); verts.set(b, next * 9 + 3); verts.set(c, next * 9 + 6);
    types[next] = sourceTypes[s]; element[next] = sourceKinds[s]; source[next] = s;
    fromMap[next] = sourceFromMap[s]; swatch[next] = sourceSwatch[s]; onCanvas[next] = isCanvas(s) ? 1 : 0;
    const root = find(s);
    piece[next] = root;
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(next);
    next++;
  };
  for (let s = 0; s < sources; s++) {
    first[s] = next;
    const o = s * 9, n = divisionsOf(s, cell);
    const at = (i, j) => [0, 1, 2].map((c) => sourceVerts[o + c] + (sourceVerts[o + 3 + c] - sourceVerts[o + c]) * i / n + (sourceVerts[o + 6 + c] - sourceVerts[o + c]) * j / n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n - i; j++) {
      push(s, at(i, j), at(i + 1, j), at(i, j + 1));
      if (i + j < n - 1) push(s, at(i + 1, j), at(i + 1, j + 1), at(i, j + 1));
    }
  }
  first[sources] = next;
  const meanY = (i) => (verts[i * 9 + 1] + verts[i * 9 + 4] + verts[i * 9 + 7]) / 3;
  // Canvas pieces under the collision or the file's map cannot be painted: the track above already
  // shows there, and painting both would put every triangle on the map twice.
  const covered = new Uint8Array(count);
  if (canvas) {
    const under = triangleLocator(surfaces + mapTris, (s) => { const o = s * 9; return [sourceVerts[o], sourceVerts[o + 2], sourceVerts[o + 3], sourceVerts[o + 5], sourceVerts[o + 6], sourceVerts[o + 8]]; }, () => 0);
    for (let i = 0; i < count; i++) if (onCanvas[i] && surfaces + mapTris) {
      const o = i * 9;
      if (under((verts[o] + verts[o + 3] + verts[o + 6]) / 3, (verts[o + 2] + verts[o + 5] + verts[o + 8]) / 3) >= 0) covered[i] = 1;
    }
  }
  const sourceY = (s) => (sourceVerts[s * 9 + 1] + sourceVerts[s * 9 + 4] + sourceVerts[s * 9 + 7]) / 3;
  const order = Array.from({ length: sources }, (_, i) => i).sort((a, b) => sourceY(a) - sourceY(b));
  return { count, verts, types, element, fromMap, swatch, canvas: onCanvas, covered, canvasBounds: canvas, piece, parts: groups, meanY, cell, sources, sourceVerts, source, first, order };
}

function segmentDistance(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - ax - t * dx, z - az - t * dz);
}

// Finds the topmost triangle under a point, from arrays of [ax, az, bx, bz, cx, cz] and height.
function triangleLocator(count, corners, heightOf, skip = null) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < count; i++) {
    const p = corners(i);
    for (let c = 0; c < 6; c += 2) {
      minX = Math.min(minX, p[c]); maxX = Math.max(maxX, p[c]);
      minZ = Math.min(minZ, p[c + 1]); maxZ = Math.max(maxZ, p[c + 1]);
    }
  }
  const cells = 128, sizeX = Math.max(1, maxX - minX) / cells, sizeZ = Math.max(1, maxZ - minZ) / cells;
  const cellX = (x) => Math.max(0, Math.min(cells - 1, Math.floor((x - minX) / sizeX)));
  const cellZ = (z) => Math.max(0, Math.min(cells - 1, Math.floor((z - minZ) / sizeZ)));
  const grid = new Map();
  for (let i = 0; i < count; i++) {
    if (skip?.[i]) continue;
    const p = corners(i);
    const x0 = cellX(Math.min(p[0], p[2], p[4])), x1 = cellX(Math.max(p[0], p[2], p[4]));
    const z0 = cellZ(Math.min(p[1], p[3], p[5])), z1 = cellZ(Math.max(p[1], p[3], p[5]));
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const key = x * cells + z;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(i);
    }
  }
  const under = (x, z, accept, visit) => {
    if (x < minX || x > maxX || z < minZ || z > maxZ) return;
    for (const i of grid.get(cellX(x) * cells + cellZ(z)) || []) {
      if (accept && !accept(i)) continue;
      const p = corners(i);
      const side = (ax, az, bx, bz) => (bx - ax) * (z - az) - (bz - az) * (x - ax);
      const a = side(p[0], p[1], p[2], p[3]), b = side(p[2], p[3], p[4], p[5]), c = side(p[4], p[5], p[0], p[1]);
      if ((a >= 0 && b >= 0 && c >= 0) || (a <= 0 && b <= 0 && c <= 0)) visit(i);
    }
  };
  const top = (x, z, accept = null) => {
    let best = -1, bestY = -Infinity;
    under(x, z, accept, (i) => { const y = heightOf(i); if (y > bestY) { bestY = y; best = i; } });
    return best;
  };
  // A map is seen from above: whatever lies under one point shows as one place.
  top.all = (x, z, accept = null) => { const hits = []; under(x, z, accept, (i) => hits.push(i)); return hits; };
  // Every triangle a circle touches, on all layers: what a brush paints.
  top.within = (x, z, radius, accept = null) => {
    const hits = new Set();
    under(x, z, accept, (i) => hits.add(i));
    const seen = new Set();
    for (let cx = cellX(x - radius); cx <= cellX(x + radius); cx++) for (let cz = cellZ(z - radius); cz <= cellZ(z + radius); cz++) {
      for (const i of grid.get(cx * cells + cz) || []) {
        if (seen.has(i)) continue;
        seen.add(i);
        if (accept && !accept(i)) continue;
        const p = corners(i);
        if (segmentDistance(x, z, p[0], p[1], p[2], p[3]) <= radius || segmentDistance(x, z, p[2], p[3], p[4], p[5]) <= radius || segmentDistance(x, z, p[4], p[5], p[0], p[1]) <= radius) hits.add(i);
      }
    }
    return [...hits];
  };
  return top;
}

const trackCorners = (track) => (i) => {
  const o = i * 9, v = track.verts;
  return [v[o], v[o + 2], v[o + 3], v[o + 5], v[o + 6], v[o + 8]];
};
export const trackLocator = (track) => triangleLocator(track.count, trackCorners(track), track.meanY, track.covered);

// The design starts as the file: its triangles keep their colours, and collision and elements stay
// off until painted or generated. Without a file, the road and boosts are on the map and off-road
// is left out, as the game's maps do.
export function seedMinimapDesign(track, map) {
  const tones = (map?.swatches || []).map((swatch) => ({ hex: swatch.hex, source: swatch.key, editable: swatch.editable }));
  const assign = new Int16Array(track?.count || 0).fill(MINIMAP_HIDDEN);
  if (!track) return { tones, assign };
  let fromFile = 0;
  for (let i = 0; i < track.count; i++) if (track.fromMap[i]) { assign[i] = track.swatch[i]; fromFile++; }
  if (!fromFile) {
    if (!tones.length) tones.push({ hex: '#ffffff', source: null, editable: true });
    for (let i = 0; i < track.count; i++) if (!track.element[i] && onMainRoad(track, i)) assign[i] = 0;
  }
  return { tones, assign };
}

// The road a player follows. Collision also holds small driveable pieces away from it, which would
// show as stray dots. A piece stays if it is large, or touches what stays even without shared
// corners: boost panels and patches are often cut into the road that way.
const STRAY_PIECE_SHARE = 0.02;
const TOUCHING = 150; // world units
function mainRoad(track) {
  if (track.mainRoad) return track.mainRoad;
  const v = track.sourceVerts, n = track.sources, keep = new Uint8Array(n), parent = new Int32Array(n);
  const eligible = (s) => {
    const i = track.first[s];
    return !track.fromMap[i] && !track.element[i] && !track.canvas[i] && !OFFROAD_AND_HAZARDS.has(track.types[i]);
  };
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const corners = new Map();
  for (let s = 0; s < n; s++) {
    parent[s] = s;
    if (!eligible(s)) continue;
    for (let c = 0; c < 9; c += 3) {
      const key = `${Math.round(v[s * 9 + c])}/${Math.round(v[s * 9 + c + 1])}/${Math.round(v[s * 9 + c + 2])}`, other = corners.get(key);
      if (other === undefined) corners.set(key, s); else parent[find(s)] = find(other);
    }
  }
  const area = new Map(), members = new Map();
  for (let s = 0; s < n; s++) {
    if (!eligible(s)) continue;
    const o = s * 9, root = find(s);
    area.set(root, (area.get(root) || 0) + Math.abs((v[o + 3] - v[o]) * (v[o + 8] - v[o + 2]) - (v[o + 5] - v[o + 2]) * (v[o + 6] - v[o])) / 2);
    if (!members.has(root)) members.set(root, []);
    members.get(root).push(s);
  }
  const largest = Math.max(0, ...area.values());
  const small = [];
  for (const [root, list] of members) {
    if (area.get(root) >= largest * STRAY_PIECE_SHARE) for (const s of list) keep[s] = 1;
    else small.push(list);
  }
  const locate = trackLocator(track), kept = (i) => keep[track.source[i]] === 1;
  // Patches can touch the road through one another.
  for (let changed = true, pass = 0; changed && pass < 4; pass++) {
    changed = false;
    for (let k = small.length - 1; k >= 0; k--) {
      const touches = small[k].some((s) => [0, 3, 6].some((c) => locate.within(v[s * 9 + c], v[s * 9 + c + 2], TOUCHING, kept).length));
      if (!touches) continue;
      for (const s of small[k]) keep[s] = 1;
      small.splice(k, 1);
      changed = true;
    }
  }
  track.mainRoad = keep;
  return keep;
}

// What can go on a generated map. `road`, `boost` and `offroad` are collision surfaces.
const BOOSTS = new Set([6, 7, 8]);
const onMainRoad = (track, i) => mainRoad(track)[track.source[i]] === 1;
const MINIMAP_SOURCES = {
  road: (track, i) => !track.fromMap[i] && !track.element[i] && !BOOSTS.has(track.types[i]) && onMainRoad(track, i),
  boost: (track, i) => BOOSTS.has(track.types[i]) && onMainRoad(track, i),
  offroad: (track, i) => OFFROAD_AND_HAZARDS.has(track.types[i]),
  line: (track, i) => track.element[i] === MINIMAP_ELEMENT.LINE,
  objects: (track, i) => track.element[i] === MINIMAP_ELEMENT.OBJECT,
  itemBoxes: (track, i) => track.element[i] === MINIMAP_ELEMENT.ITEM_BOX,
  route: (track, i) => track.element[i] === MINIMAP_ELEMENT.ROUTE,
};

// One click: the road and what is part of it. A track without collision only has its route to show.
export function roadOnlySources(track, hex = '#ffffff') {
  const counts = minimapSourceCounts(track);
  return (counts.road || counts.boost ? ['road', 'boost'] : ['route']).map((id) => ({ id, hex }));
}

export function minimapSourceCounts(track) {
  const counts = Object.fromEntries(Object.keys(MINIMAP_SOURCES).map((id) => [id, 0]));
  if (track) for (let i = 0; i < track.count; i++) for (const id in MINIMAP_SOURCES) if (MINIMAP_SOURCES[id](track, i)) counts[id]++;
  return counts;
}

// A new design from the chosen sources, [{ id, hex }]; sources of equal colour share one tone.
export function generateMinimapDesign(track, sources) {
  const tones = [], assign = new Int16Array(track.count).fill(MINIMAP_HIDDEN);
  for (const { id, hex } of sources) {
    const accepts = MINIMAP_SOURCES[id];
    if (!accepts) continue;
    let tone = tones.findIndex((entry) => entry.hex === hex);
    for (let i = 0; i < track.count; i++) {
      if (!accepts(track, i)) continue;
      if (tone < 0) { tone = tones.length; tones.push({ hex, source: null, editable: true }); }
      assign[i] = tone;
    }
  }
  return { tones, assign };
}

// Input of the minimap converter. Triangles face up so that the map's back-face culling keeps them.
export function buildMinimapSource(track, assign, tones, offsets = null) {
  let low = Infinity, high = -Infinity;
  for (let i = 0; i < track.count; i++) if (assign[i] >= 0) {
    for (let c = 1; c < 9; c += 3) { low = Math.min(low, track.verts[i * 9 + c]); high = Math.max(high, track.verts[i * 9 + c]); }
  }
  const scale = high > low ? MAP_HEIGHT / (high - low) : 0;
  const tris = [], materials = {};
  const emit = (tone, verts, o) => {
    const mat = `map_t${tone}`;
    if (!materials[mat]) materials[mat] = { color: hexToRgb(tones[tone].hex).map((value) => value / 255) };
    const corner = (c) => [verts[o + c * 3], (verts[o + c * 3 + 1] - low) * scale, verts[o + c * 3 + 2]];
    const a = corner(0), b = corner(1), c = corner(2);
    const up = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]) > 0;
    tris.push({ mat, v: up ? [...a, ...b, ...c] : [...a, ...c, ...b], uv: [0, 0, 0, 0, 0, 0] });
  };
  forEachMinimapTriangle(track, assign, (tone, verts, o) => emit(tone, verts, o), offsets);
  return { materials, tris };
}

// Smoothing also eases the corners around an edge by next to nothing. A move this small is under a
// pixel on a map, and is not worth keeping a piece separate for. It counts as no move for every
// piece alike, so that the corners they share stay together and no crack opens.
const UNSEEN_SHIFT = 60;
const seenShift = (shift) => shift && Math.hypot(shift[0], shift[1]) >= UNSEEN_SHIFT ? shift : null;

// The pieces of a source a brush crossed, joined back wherever they are one colour. They lie on a
// grid of rows, and each row alternates triangles pointing each way, so a run of one colour along a
// row is a trapezoid; runs with the same sides in rows one above the other are one larger trapezoid,
// which is two triangles. So what it costs is the length of the stroke's edge, not the size of the
// source. Pieces with a corner moved by smoothing stay as they are: joining would skip that corner.
function emitJoinedPieces(track, assign, s, visit, isFree, sendPiece) {
  const from = track.first[s], pieces = track.first[s + 1] - from, n = Math.round(Math.sqrt(pieces));
  const o = s * 9, v = track.sourceVerts, out = new Float32Array(9);
  const corner = (at, i, j) => { for (let c = 0; c < 3; c++) out[at + c] = v[o + c] + (v[o + 3 + c] - v[o + c]) * i / n + (v[o + 6 + c] - v[o + c]) * j / n; };
  const triangle = (tone, [ai, aj], [bi, bj], [ci, cj]) => { corner(0, ai, aj); corner(3, bi, bj); corner(6, ci, cj); visit(tone, out, 0, s); };
  // A side of a run is on a line of the grid: j constant, or i + j constant.
  const onSide = (kind, line, i) => [i, kind === 'j' ? line : line - i];
  const close = (stack) => {
    const a = onSide(stack.leftKind, stack.left, stack.low), b = onSide(stack.leftKind, stack.left, stack.high + 1);
    const c = onSide(stack.rightKind, stack.right, stack.high + 1), d = onSide(stack.rightKind, stack.right, stack.low);
    const sameCorner = (p, q) => p[0] === q[0] && p[1] === q[1];
    if (sameCorner(a, d)) triangle(stack.tone, a, b, c);
    else if (sameCorner(b, c)) triangle(stack.tone, a, b, d);
    else { triangle(stack.tone, a, b, c); triangle(stack.tone, a, c, d); }
  };
  let open = new Map(), index = from;
  for (let i = 0; i < n; i++) {
    const next = new Map(), count = 2 * (n - i) - 1;
    for (let p = 0; p < count;) {
      const at = index + p, tone = assign[at];
      if (tone < 0) { p++; continue; }
      if (!isFree(at)) { sendPiece(tone, at); p++; continue; }
      let last = p;
      while (last + 1 < count && assign[index + last + 1] === tone && isFree(index + last + 1)) last++;
      // Even places point one way and start or end on these lines; odd places the other way.
      const startJ = p >> 1, endJ = last >> 1;
      const leftKind = p % 2 ? 'sum' : 'j', left = p % 2 ? i + startJ + 1 : startJ;
      const rightKind = last % 2 ? 'j' : 'sum', right = last % 2 ? endJ + 1 : i + endJ + 1;
      const key = `${tone}/${leftKind}${left}/${rightKind}${right}`, below = open.get(key);
      if (below) { below.high = i; next.set(key, below); open.delete(key); }
      else next.set(key, { tone, leftKind, left, rightKind, right, low: i, high: i });
      p = last + 1;
    }
    for (const stack of open.values()) close(stack);
    open = next;
    index += count;
  }
  for (const stack of open.values()) close(stack);
}

// What a design becomes: a source painted in one tone stays one triangle, and in the ones a brush
// crossed the small pieces are joined by colour, so painting adds what its edge needs.
export function forEachMinimapTriangle(track, assign, visit, offsets = null) {
  const moved = new Float32Array(9);
  const send = (tone, verts, o, s) => {
    if (!offsets?.size) return visit(tone, verts, o, s);
    const layer = pieceLayer(track, track.first[s]);
    for (let c = 0; c < 9; c += 3) {
      const shift = seenShift(offsets.get(vertexKey(layer, verts[o + c], verts[o + c + 2])));
      moved[c] = verts[o + c] + (shift ? shift[0] : 0);
      moved[c + 1] = verts[o + c + 1];
      moved[c + 2] = verts[o + c + 2] + (shift ? shift[1] : 0);
    }
    visit(tone, moved, 0, s);
  };
  for (let s = 0; s < track.sources; s++) {
    const from = track.first[s], to = track.first[s + 1], tone = assign[from];
    let uniform = true;
    for (let i = from + 1; i < to && uniform; i++) uniform = assign[i] === tone;
    if (uniform) { if (tone >= 0) send(tone, track.sourceVerts, s * 9, s); continue; }
    const layer = pieceLayer(track, from), v = track.verts;
    const isFree = !offsets?.size ? () => true : (piece) => {
      for (let c = 0; c < 9; c += 3) if (seenShift(offsets.get(vertexKey(layer, v[piece * 9 + c], v[piece * 9 + c + 2])))) return false;
      return true;
    };
    emitJoinedPieces(track, assign, s, visit, isFree, (pieceTone, piece) => send(pieceTone, v, piece * 9, s));
  }
}

const vertexKey = (layer, x, z) => `${layer}/${Math.round(x)}/${Math.round(z)}`;

// The pieces as a mesh, built once for a track: smoothing can run at every release of the mouse.
function paintMesh(track) {
  if (track.paintMesh) return track.paintMesh;
  const ids = new Map(), keys = [], xs = [], zs = [], rims = [], rimHits = [];
  const corners = new Int32Array(track.count * 3).fill(-1);
  const w = track.sourceVerts, v = track.verts;
  for (let i = 0; i < track.count; i++) {
    if (track.element[i]) continue;
    const layer = pieceLayer(track, i), s = track.source[i], o = s * 9;
    for (let c = 0; c < 3; c++) {
      const x = v[i * 9 + c * 3], z = v[i * 9 + c * 3 + 2], key = vertexKey(layer, x, z);
      let id = ids.get(key);
      if (id === undefined) {
        id = keys.length;
        ids.set(key, id);
        keys.push(key); xs.push(x); zs.push(z);
        // Which edges of its collision triangle the vertex lies on.
        let dir = null, hits = 0;
        for (let e = 0; e < 3; e++) {
          const f = (e + 1) % 3, ax = w[o + e * 3], az = w[o + e * 3 + 2], bx = w[o + f * 3], bz = w[o + f * 3 + 2];
          if (segmentDistance(x, z, ax, az, bx, bz) > 1) continue;
          const length = Math.hypot(bx - ax, bz - az) || 1;
          dir = [(bx - ax) / length, (bz - az) / length];
          hits++;
        }
        rims.push(hits === 1 ? dir : null);
        rimHits.push(hits);
      }
      corners[i * 3 + c] = id;
    }
  }
  const size = keys.length, edgeIds = new Map(), edgeA = [], edgeB = [], edgeOf = new Int32Array(track.count * 3).fill(-1);
  const near = Array.from({ length: size }, () => []);
  for (let i = 0; i < track.count; i++) {
    if (track.element[i]) continue;
    for (let c = 0; c < 3; c++) {
      const a = corners[i * 3 + c], b = corners[i * 3 + (c + 1) % 3];
      if (a === b) continue;
      const code = Math.min(a, b) * size + Math.max(a, b);
      let edge = edgeIds.get(code);
      if (edge === undefined) {
        edge = edgeA.length;
        edgeIds.set(code, edge);
        edgeA.push(a); edgeB.push(b);
        near[a].push(b); near[b].push(a);
      }
      edgeOf[i * 3 + c] = edge;
    }
  }
  track.paintMesh = { keys, xs, zs, rims, rimHits, size, edgeA, edgeB, edgeOf, near };
  return track.paintMesh;
}

// Painting follows the grain of the pieces, which leaves stair-steps along a stroke, and a hand
// adds slow waves. This rounds both: vertices on an edge between two tones slide towards their
// neighbours along that edge, and the mesh nearby follows so triangles do not fold. Only edges that
// painting changed since `baseline` count, so the road's real outline and the straight corners of
// the file's own colours stay. Taubin's two steps keep a painted shape from shrinking as it rounds.
// `level` (1 to 10) sets how long a wave still counts as noise. The result depends on the level
// alone, from the unmoved pieces: pressing again changes nothing, and a lower level goes back.
export const MINIMAP_SMOOTH_LEVELS = 10;
export const MINIMAP_SMOOTH_DEFAULT = 6;
const MESH_RINGS = 3;
export function smoothMinimapEdges(track, assign, baseline, offsets = new Map(), level = MINIMAP_SMOOTH_DEFAULT) {
  const amount = Math.max(1, Math.min(MINIMAP_SMOOTH_LEVELS, level)) / MINIMAP_SMOOTH_LEVELS;
  const cycles = Math.round(8 + 1400 * amount * amount);
  const reachInPieces = 1 + 5 * amount;
  // Taubin's two steps, with a narrow pass band whatever the level: a wider one makes waves just
  // below it grow with each cycle. The level is how long it runs, so more always takes out more.
  const grow = .6, shrink = 1 / (.01 - 1 / grow);
  const gain = (k) => (1 - grow * k) * (1 - shrink * k);
  const mesh = paintMesh(track), { xs, zs, rims, keys, size: vertices, edgeA, edgeB, edgeOf } = mesh;
  const edgeCount = edgeA.length, firstTone = new Int16Array(edgeCount).fill(-2), mixed = new Uint8Array(edgeCount), painted = new Uint8Array(edgeCount);
  for (let i = 0; i < track.count; i++) {
    if (track.element[i]) continue;
    for (let c = 0; c < 3; c++) {
      const e = edgeOf[i * 3 + c];
      if (e < 0) continue;
      if (firstTone[e] === -2) firstTone[e] = assign[i]; else if (firstTone[e] !== assign[i]) mixed[e] = 1;
      if (assign[i] !== baseline[i]) painted[e] = 1;
    }
  }
  const chain = new Map();
  const link = (a, b) => { if (!chain.has(a)) chain.set(a, []); if (!chain.get(a).includes(b)) chain.get(a).push(b); };
  for (let e = 0; e < edgeCount; e++) if (mixed[e] && painted[e]) { link(edgeA[e], edgeB[e]); link(edgeB[e], edgeA[e]); }
  // A stroke crossing from one collision triangle to the next breaks into pieces that share no
  // vertex. Join the loose ends across that border, or each would stay put and leave a bump.
  const span = Number.isFinite(track.cell) ? track.cell : 1000, loose = new Map(), ends = [];
  const bucket = (x, z) => `${Math.floor(x / span)}/${Math.floor(z / span)}`;
  const layerOf = (id) => keys[id].charCodeAt(0);
  for (const [id, list] of chain) {
    if (list.length !== 1 || !rims[id]) continue;
    const cell = bucket(xs[id], zs[id]);
    if (!loose.has(cell)) loose.set(cell, []);
    loose.get(cell).push(id);
    ends.push(id);
  }
  for (const id of ends) {
    if (chain.get(id).length !== 1) continue;
    let best = -1, bestDistance = span * 1.5;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      for (const other of loose.get(bucket(xs[id] + dx * span, zs[id] + dz * span)) || []) {
        if (other === id || chain.get(other).length !== 1 || layerOf(other) !== layerOf(id)) continue;
        const distance = Math.hypot(xs[other] - xs[id], zs[other] - zs[id]);
        if (distance < bestDistance) { bestDistance = distance; best = other; }
      }
    }
    if (best < 0) continue;
    link(id, best); link(best, id);
  }
  // Where the edge ends a vertex stays, or strokes would come away from the outline. Where two
  // pieces touch at a corner the edge branches: those move too, or each would hold a bump in place.
  const free = [...chain].filter(([, list]) => list.length >= 2).map(([id]) => id);
  if (!free.length) return { offsets: new Map(), moved: 0 };

  const px = new Float64Array(vertices), pz = new Float64Array(vertices);
  for (let id = 0; id < vertices; id++) { px[id] = xs[id]; pz[id] = zs[id]; }
  const reach = new Float64Array(vertices);
  for (const id of free) {
    const longest = Math.max(...chain.get(id).map((other) => Math.hypot(xs[other] - xs[id], zs[other] - zs[id])));
    reach[id] = reachInPieces * (Number.isFinite(track.cell) ? Math.min(longest, track.cell) : longest);
  }
  // A short edge is a mark or a dot: its whole outline is one wave, and removing that would close
  // it. So each edge runs only as long as its longest wave keeps most of its size.
  const stopAt = new Int32Array(vertices), visited = new Uint8Array(vertices);
  for (const start of free) {
    if (visited[start]) continue;
    const part = [start];
    visited[start] = 1;
    for (let k = 0; k < part.length; k++) for (const other of chain.get(part[k])) {
      if (!visited[other]) { visited[other] = 1; part.push(other); }
    }
    const longest = gain(1 - Math.cos(2 * Math.PI / Math.max(4, part.length)));
    const allowed = longest < 1 ? Math.floor(Math.log(.9) / Math.log(longest)) : cycles;
    for (const id of part) stopAt[id] = 2 * Math.max(4, Math.min(cycles, allowed));
  }
  const nx = new Float64Array(free.length), nz = new Float64Array(free.length);
  for (let pass = 0; pass < 2 * cycles; pass++) {
    const weight = pass % 2 ? shrink : grow;
    for (let k = 0; k < free.length; k++) {
      const id = free[k], list = chain.get(id);
      if (pass >= stopAt[id]) { nx[k] = px[id]; nz[k] = pz[id]; continue; }
      let mx = 0, mz = 0;
      for (const other of list) { mx += px[other]; mz += pz[other]; }
      mx /= list.length; mz /= list.length;
      let dx = px[id] + (mx - px[id]) * weight - xs[id];
      let dz = pz[id] + (mz - pz[id]) * weight - zs[id];
      // On the border of a collision triangle it only slides along it: the piece stays against
      // its neighbour, whose pieces do not meet it, with no gap between them.
      if (rims[id]) {
        const [rx, rz] = rims[id], along = dx * rx + dz * rz;
        dx = rx * along; dz = rz * along;
      }
      const length = Math.hypot(dx, dz);
      if (length > reach[id]) { dx *= reach[id] / length; dz *= reach[id] / length; }
      nx[k] = xs[id] + dx; nz[k] = zs[id] + dz;
    }
    for (let k = 0; k < free.length; k++) { px[free[k]] = nx[k]; pz[free[k]] = nz[k]; }
  }
  // The pieces beside the edge follow it, keeping their shapes even. Those on the border of a
  // collision triangle stay: they touch a neighbour with other pieces.
  const pinned = new Uint8Array(vertices);
  for (const id of chain.keys()) pinned[id] = 1;
  for (let id = 0; id < vertices; id++) if (mesh.rimHits[id]) pinned[id] = 1;
  const seen = new Uint8Array(vertices), soft = [];
  let ring = free;
  for (let r = 0; r < MESH_RINGS; r++) {
    const next = [];
    for (const id of ring) for (const other of mesh.near[id]) {
      if (seen[other]) continue;
      seen[other] = 1;
      next.push(other);
      if (!pinned[other]) soft.push(other);
    }
    ring = next;
  }
  for (let pass = 0; pass < 8; pass++) {
    for (const id of soft) {
      let x = 0, z = 0;
      for (const other of mesh.near[id]) { x += px[other]; z += pz[other]; }
      px[id] = x / mesh.near[id].length; pz[id] = z / mesh.near[id].length;
    }
  }

  const result = new Map();
  let moved = 0;
  for (const id of free) {
    const old = offsets.get(keys[id]), dx = px[id] - xs[id], dz = pz[id] - zs[id];
    if (Math.hypot(dx - (old?.[0] || 0), dz - (old?.[1] || 0)) > .5) moved++;
    result.set(keys[id], [dx, dz]);
  }
  for (const id of soft) result.set(keys[id], [px[id] - xs[id], pz[id] - zs[id]]);
  return { offsets: result, moved };
}

// ---- Stretches of the track: between two lines across the road ---------------------------------
// Measured along the enemy route, not by what is connected on the map: a road that passes over or
// under the stretch stays out of it, and "between" has one meaning: in the order of driving.
const ROUTE_REACH = 5000; // units: a triangle farther than this from the route belongs to no stretch
const ROAD_REACH = 2500; // and it can be this far from it, or twice the route's width, if that is more
const ROUTE_RISE = 1500; // nor one this far above or below it: that is another road, passing over or under
const HEIGHT_WEIGHT = 3; // height counts this much more than distance on the map: roads cross on levels

export function minimapRoute(kmp) {
  const groups = kmp.ENPT || [], segments = [];
  if (!groups.some((group) => group.points.length)) return null;
  const startOf = new Map(), endOf = new Map();
  // The points of a chain of groups, with the link from each one to the next, and from where it
  // leaves and to where it joins.
  const lay = (chain, from, to, opening, closing) => {
    const points = opening ? [opening] : [], marks = [];
    for (const g of chain) {
      marks.push([g, points.length, points.length + groups[g].points.length - 1]);
      points.push(...groups[g].points);
    }
    if (closing) points.push(closing);
    const gaps = points.slice(1).map((point, i) => Math.hypot(point.pos[0] - points[i].pos[0], point.pos[1] - points[i].pos[1], point.pos[2] - points[i].pos[2]));
    const total = gaps.reduce((sum, gap) => sum + gap, 0), span = to === null ? total : to - from;
    const reached = [from];
    gaps.forEach((gap, i) => {
      reached.push(reached[i] + (total ? gap / total * span : 0));
      segments.push({ a: points[i].pos, b: points[i + 1].pos, from: reached[i], to: reached[i + 1], half: Math.max(200, (points[i].width || 10) * 100) });
    });
    for (const [g, first, last] of marks) { startOf.set(g, reached[first]); endOf.set(g, reached[last]); }
    return total;
  };
  // The way round first, by each group's first exit.
  const main = [], seen = new Set();
  for (let g = 0; groups[g] && !seen.has(g); g = groups[g].next?.[0]) { if (!groups[g].points.length) break; seen.add(g); main.push(g); }
  const lastExit = groups[main[main.length - 1]].next?.[0];
  const length = lay(main, 0, null, null, seen.has(lastExit) ? groups[lastExit].points[0] : null);
  // Then branches, each fitted between where it leaves the way round and where it joins it again.
  for (let found = true; found;) {
    found = false;
    for (const g of [...seen]) for (const first of groups[g].next || []) {
      if (seen.has(first) || !groups[first]?.points.length) continue;
      const chain = [];
      let at = first;
      while (groups[at]?.points.length && !seen.has(at) && !chain.includes(at)) { chain.push(at); at = groups[at].next?.[0]; }
      const from = endOf.get(g), joins = seen.has(at) ? at : null;
      let to = joins === null ? null : startOf.get(joins);
      if (to !== null && to < from) to += length;
      lay(chain, from, to, groups[g].points[groups[g].points.length - 1], joins === null ? null : groups[joins].points[0]);
      for (const member of chain) seen.add(member);
      found = true;
    }
  }
  return { segments, length: length || 1 };
}

const distanceToSegment = (segment, x, z) => {
  const dx = segment.b[0] - segment.a[0], dz = segment.b[2] - segment.a[2], size = dx * dx + dz * dz;
  const t = size ? Math.max(0, Math.min(1, ((x - segment.a[0]) * dx + (z - segment.a[2]) * dz) / size)) : 0;
  return { t, gap: Math.hypot(segment.a[0] + dx * t - x, segment.a[2] + dz * t - z) };
};

// The place on the route nearest a point of the map, or null if it is not near the road. A line
// across the road there runs from `left` to `right`.
export function minimapRoutePlace(route, x, z) {
  let best = null, nearest = Infinity;
  for (const segment of route.segments) {
    const { t, gap } = distanceToSegment(segment, x, z);
    if (gap < nearest) { nearest = gap; best = { segment, t }; }
  }
  if (!best || nearest > Math.min(ROUTE_REACH, best.segment.half * 1.5)) return null;
  const { segment, t } = best;
  const dx = segment.b[0] - segment.a[0], dz = segment.b[2] - segment.a[2], size = Math.hypot(dx, dz) || 1;
  const px = segment.a[0] + dx * t, pz = segment.a[2] + dz * t, half = Math.min(ROUTE_REACH, segment.half);
  return {
    distance: (segment.from + (segment.to - segment.from) * t) % route.length,
    left: [px + dz / size * half, pz - dx / size * half], right: [px - dz / size * half, pz + dx / size * half],
  };
}

// How far along the route each painted triangle is, or -1 for those that belong to no stretch.
export function minimapAlong(track, route) {
  const along = new Float32Array(track.count).fill(-1), { segments } = route;
  for (let i = 0; i < track.count; i++) {
    if (track.element[i] && track.element[i] !== MINIMAP_ELEMENT.ROUTE) continue;
    const o = i * 9, v = track.verts;
    const x = (v[o] + v[o + 3] + v[o + 6]) / 3, y = (v[o + 1] + v[o + 4] + v[o + 7]) / 3, z = (v[o + 2] + v[o + 5] + v[o + 8]) / 3;
    // A file's own triangles have no true height: only the map can place them.
    const flat = !!track.fromMap[i] || !!track.canvas[i];
    let best = Infinity, at = -1;
    for (const segment of segments) {
      const { t, gap } = distanceToSegment(segment, x, z);
      if (gap > Math.min(ROUTE_REACH, Math.max(ROAD_REACH, segment.half * 2))) continue;
      const rise = flat ? 0 : y - (segment.a[1] + (segment.b[1] - segment.a[1]) * t);
      if (Math.abs(rise) > ROUTE_RISE) continue;
      const cost = gap * gap + (rise * HEIGHT_WEIGHT) ** 2;
      if (cost < best) { best = cost; at = (segment.from + (segment.to - segment.from) * t) % route.length; }
    }
    along[i] = at;
  }
  return along;
}

// Driving from start to end, over the finish line if that is the way there.
export const inMinimapStretch = (distance, start, end) => distance >= 0 && (start <= end ? distance >= start && distance <= end : distance >= start || distance <= end);

// The triangles of a stretch that are on the map: it colours what is there, and adds nothing.
export function minimapStretchTriangles(assign, along, start, end) {
  const out = [];
  for (let i = 0; i < along.length; i++) if (assign[i] >= 0 && inMinimapStretch(along[i], start, end)) out.push(i);
  return out;
}

export function minimapTriangleCount(track, assign) {
  let count = 0;
  forEachMinimapTriangle(track, assign, () => { count++; });
  return count;
}
