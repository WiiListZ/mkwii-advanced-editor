// Game assets: real 3D models from the open SZS (course model, skybox, track objects),
// from Race/Common.szs (shared objects such as item boxes) and from the other track archives
// of the tracks folder (object models of other tracks, including custom ones).

import * as THREE from 'three';
import { findFile, isU8, newSzsTree, parseU8, setFilePath } from '../formats/u8.js';
import { isYaz0, yaz0Decompress } from '../formats/yaz0.js';
import { parseBRRES } from '../formats/brres.js';
import { BrresModelBuilder, mainModel, bindSRT, bindCHR, bindPAT, bindCLR } from './brresmodel.js';
import { parseBLIGHT } from '../formats/gx.js';

export class GameAssets {
  constructor(viewport) {
    this.viewport = viewport;
    this.track = null;        // U8 tree of the open SZS
    this.common = null;       // U8 tree of Common.szs
    this.objectInfo = {};     // id -> { name, resources }
    this.objects = new Map(); // objectId -> { template, chr } | null
    this.brresCache = new Map();
    this.srt = [];
    this.status = '';
    this.trackVersion = 0;
    // Tracks folder library: { find(name) -> entry | null, fetch(entry) -> Promise<[{ path, data }]> }.
    this.library = null;
    this.libraryTree = newSzsTree(); // object files already fetched from the library
    this.libraryPending = new Map();
    this.onLibraryLoaded = null;
  }

  // Start position model: Mario on the Standard Kart M, built from the game's own files
  // (Race/Kart/mdf_kart-mr.szs, wheel positions and ride height from Common.szs bsp/mdf_kart.bsp).
  // Without them the editor draws its own Mario on the kart (models.js).
  async loadKart(readFile, raceDir, kartFile = 'mdf_kart-mr.szs', force = false) {
    if (!raceDir || (!force && this.kartDir === raceDir + kartFile)) return;
    this.kartDir = raceDir + kartFile;
    try {
      let bytes = await readFile(`${raceDir}\\Kart\\${kartFile}`);
      if (isYaz0(bytes)) bytes = yaz0Decompress(bytes);
      if (!isU8(bytes)) throw new Error(`${kartFile} is not an SZS archive`);
      const tree = parseU8(bytes);
      const stem = kartFile.replace(/-.*$/, '');
      const bsp = this.common && findFile(this.common, `bsp/${stem}.bsp`);
      const disp = this.common && findFile(this.common, 'kartDriverDispParam.bin');
      this.kart = buildKart(tree, bsp?.data || null, driverOffset(disp?.data, VEHICLE_ID[stem] ?? 1, 0));
      this.viewport.clearCache();
    } catch (e) {
      console.warn('Kart model not loaded:', e);
      this.kart = null;
    }
  }

  // Respawn point model: Lakitu (jugemu.brres in Common.szs) with its hair tuft, playing "wait".
  // Without Common.szs the editor draws its own Lakitu (models.js).
  lakitu() {
    if (!this.common) return null; // asked again once Common.szs is loaded
    if (this.lakituModel !== undefined) return this.lakituModel;
    const b = this.brres(this.common, 'jugemu.brres');
    try {
      this.lakituModel = b ? buildLakitu(b) : null;
    } catch (e) {
      console.warn('Lakitu model not built:', e);
      this.lakituModel = null;
    }
    return this.lakituModel;
  }

  setLibrary(library) {
    this.library = library;
    for (const [id, v] of this.objects) if (!v) this.objects.delete(id);
  }

  // Resource names an object's model can have (ObjFlow resources, then its own name).
  resourceNames(objectId) {
    const info = this.objectInfo[objectId];
    const names = [];
    if (info?.resources && info.resources !== '-') names.push(...info.resources.split(/[;,\s]+/).filter(Boolean));
    if (info?.name) names.push(info.name);
    if (objectId === 0x65) names.push('itembox');
    return [...new Set(names)];
  }

  // Where the model of an object comes from: 'track', 'common', the library entry, or null.
  modelSource(objectId, trackFiles, commonFiles) {
    const names = this.resourceNames(objectId);
    if (names.some((n) => trackFiles.has(`${n}.brres`.toLowerCase()))) return 'track';
    if (names.some((n) => commonFiles.has(`${n}.brres`.toLowerCase()))) return 'common';
    for (const n of names) {
      const entry = this.library?.find(n);
      if (entry) return entry;
    }
    return null;
  }

  // Fetches the files of an object model from the tracks folder, then rebuilds the objects using it.
  loadFromLibrary(entry) {
    const key = `${entry.archive}|${entry.stem}`;
    if (this.libraryPending.has(key)) return this.libraryPending.get(key);
    const pending = this.library.fetch(entry).then((files) => {
      for (const f of files) setFilePath(this.libraryTree, f.path, f.data);
      for (const k of [...this.brresCache.keys()]) if (k.startsWith('library:')) this.brresCache.delete(k);
      for (const [id, v] of this.objects) if (!v) this.objects.delete(id);
      this.viewport.clearCache();
      this.onLibraryLoaded?.(entry);
      return files;
    }).catch((e) => { console.warn(`Could not load ${entry.stem} from ${entry.archive}:`, e); return []; });
    this.libraryPending.set(key, pending);
    return pending;
  }

  setObjectInfo(info) {
    this.objectInfo = info || {};
    this.objects.clear();
  }

  setCommon(tree) {
    this.common = tree;
    this.lakituModel = undefined;
    this.objects.clear();
    this.brresCache.clear();
    this.refreshSRT();
  }

  // Loads the course model and skybox of a track archive (async so the UI stays responsive).
  async setTrack(tree) {
    if (tree && tree === this.track && this.built) return this.refreshTrack(tree);
    const version = ++this.trackVersion;
    this.track = tree;
    this.objects.clear();
    this.brresCache.clear();
    this.srt = [];
    this.built = null;
    const vp = this.viewport;
    if (!tree) {
      vp.setCourseModel(null);
      vp.setSkyModel(null);
      vp.setSRTBindings([]);
      return { course: false, sky: false };
    }
    // The track's lights (posteffect.blight) light the materials that use a light set.
    const blight = findFile(tree, 'posteffect.blight');
    try { BrresModelBuilder.lightSets = blight ? parseBLIGHT(blight.data) : null; } catch { BrresModelBuilder.lightSets = null; }
    await tick();
    if (version !== this.trackVersion) return { course: false, sky: false };
    const course = this.buildFromArchive(tree, 'course_model.brres', 'course', { lit: false });
    await tick();
    if (version !== this.trackVersion) return { course: false, sky: false };
    const sky = this.buildFromArchive(tree, 'vrcorn_model.brres', 'vrcorn', { lit: false });
    if (version !== this.trackVersion) return { course: false, sky: false };
    vp.setCourseModel(course?.group || null);
    vp.setSkyModel(sky?.group || null);
    this.built = { course, sky, files: this.trackFileData(tree) };
    this.collectTrackSRT();
    vp.clearCache();
    return { course: !!course, sky: !!sky };
  }

  // Data of every file in the archive, to tell which ones an edit replaced.
  trackFileData(tree) {
    const files = new Map();
    const walk = (node, path) => {
      if (node.data) files.set(path.toLowerCase(), node.data);
      for (const child of node.children || []) walk(child, path ? `${path}/${child.name}` : child.name);
    };
    walk(tree, '');
    return files;
  }

  collectTrackSRT() {
    const { course, sky } = this.built;
    this.srt = [...(course?.srts || []), ...(sky?.srts || []), ...(course?.extra || []), ...(sky?.extra || [])];
    this.refreshSRT();
  }

  // Same archive after an edit (a model part moved, a texture painted…): rebuild only what changed,
  // keeping Common.szs, the tracks folder models and untouched track files, so the view never stalls.
  async refreshTrack(tree) {
    const version = ++this.trackVersion;
    const files = this.trackFileData(tree), before = this.built.files;
    const changed = new Set([...files.keys(), ...before.keys()].filter((path) => files.get(path) !== before.get(path)));
    if (!changed.size) return { course: !!this.built.course, sky: !!this.built.sky };
    const touched = (name) => [...changed].some((path) => path === name || path.endsWith('/' + name));
    for (const key of [...this.brresCache.keys()]) {
      if (key.startsWith('track:') && touched(key.slice(6))) this.brresCache.delete(key);
    }
    if (touched('posteffect.blight')) {
      const blight = findFile(tree, 'posteffect.blight');
      try { BrresModelBuilder.lightSets = blight ? parseBLIGHT(blight.data) : null; } catch { BrresModelBuilder.lightSets = null; }
    }
    // Object models: only when one of their own files changed (or one appeared in the archive).
    let objectsChanged = false;
    if ([...changed].some((path) => !/(^|\/)(course|vrcorn)_model\.brres$/.test(path))) {
      for (const [id, found] of this.objects) {
        if (!found || found.from === 'track') { this.objects.delete(id); objectsChanged = true; }
      }
    }
    const vp = this.viewport;
    await tick();
    if (version !== this.trackVersion) return { course: false, sky: false };
    if (touched('course_model.brres')) {
      this.built.course = this.buildFromArchive(tree, 'course_model.brres', 'course', { lit: false });
      vp.setCourseModel(this.built.course?.group || null);
    }
    if (touched('vrcorn_model.brres')) {
      this.built.sky = this.buildFromArchive(tree, 'vrcorn_model.brres', 'vrcorn', { lit: false });
      vp.setSkyModel(this.built.sky?.group || null);
    }
    this.built.files = files;
    this.collectTrackSRT();
    if (objectsChanged) vp.clearCache();
    vp.needsRender = true;
    return { course: !!this.built.course, sky: !!this.built.sky };
  }

  refreshSRT() {
    const objectSRT = [...this.objects.values()].filter(Boolean).flatMap((o) => [...(o.srts || []), ...(o.extra || [])]);
    this.viewport.setSRTBindings([...this.srt, ...objectSRT]);
  }

  brres(tree, file) {
    const key = (tree === this.common ? 'common:' : tree === this.libraryTree ? 'library:' : 'track:') + file.toLowerCase();
    if (this.brresCache.has(key)) return this.brresCache.get(key);
    let parsed = null;
    const node = tree && findFile(tree, file);
    if (node) {
      try { parsed = parseBRRES(node.data); } catch (e) { console.warn(`Could not read ${file}:`, e); }
    }
    // The open track's own model keeps how its polygons split into objects (see polygonPieces).
    if (parsed && key === 'track:course_model.brres') for (const m of parsed.models) for (const o of m.objects) o._rememberPieces = true;
    this.brresCache.set(key, parsed);
    return parsed;
  }

  buildFromArchive(tree, file, preferred, opts = {}) {
    const b = this.brres(tree, file);
    if (!b) return null;
    const model = mainModel(b, preferred);
    if (!model) return null;
    const chr = b.chr.get(model.name) || b.chr.get(preferred) || [...b.chr.values()][0] || null;
    try {
      const builder = new BrresModelBuilder(b);
      const group = builder.build(model, { skinned: !!chr && opts.skinned !== false, lit: opts.lit });
      group.userData.chrBindings = [...b.chr.values()].map((animation) => bindCHR(animation, group)).filter(Boolean);
      // A BRRES can have several SRT0 groups ("course", "course2"…), each animating different
      // materials. Bind all of them; prefer the model's own group if a slot appears twice.
      const ordered = (map) => [...map.values()].sort((x, y) => Number(y.name === model.name || y.name === preferred) - Number(x.name === model.name || x.name === preferred));
      const srtClaimed = new Set();
      const srts = ordered(b.srt).map((animation) => bindSRT(animation, group, srtClaimed)).filter(Boolean);
      // Texture swaps and colour animations follow the same model-name priority.
      const patClaimed = new Set(), clrClaimed = new Set();
      const extra = [...ordered(b.pat).map((a) => bindPAT(a, group, builder, patClaimed)), ...ordered(b.clr).map((a) => bindCLR(a, group, clrClaimed))].filter(Boolean);
      return { group, chr, srts, extra, brres: b, model };
    } catch (e) {
      console.warn(`Could not build ${file}:`, e);
      return null;
    }
  }

  // Real model for a KMP object (cached). Looks in the track archive first, then in Common.szs.
  objectModel(objectId) {
    if (this.objects.has(objectId)) return this.objects.get(objectId);
    const info = this.objectInfo[objectId];
    // Huge camera-facing billboards (sun, lens flare) would cover the whole view: keep the simple model.
    if (info?.name && /^(sun|sunds|lensfx)$/i.test(info.name)) { this.objects.set(objectId, null); return null; }
    const names = this.resourceNames(objectId);
    let found = null;
    for (const tree of [this.track, this.common, this.libraryTree]) {
      for (const n of names) {
        if (!tree) continue;
        const built = this.buildFromArchive(tree, `${n}.brres`, n, { lit: null });
        if (built) {
          // One-shot texture swaps and colour changes (a Thwomp's face when it lands) play on game
          // events: at rest the object shows their first frame, which is also the texture people paint.
          for (const b of built.extra) if (!b.loop) b.rest = true;
          found = { template: built.group, chr: built.chr, srts: built.srts, extra: built.extra, source: n,
            from: tree === this.track ? 'track' : tree === this.common ? 'common' : 'library' };
          break;
        }
      }
      if (found) break;
    }
    if (!found && this.library) {
      // Not cached: asked again once the model has arrived from the tracks folder.
      const entry = names.map((n) => this.library.find(n)).find(Boolean);
      if (entry && !this.libraryPending.has(`${entry.archive}|${entry.stem}`)) { this.loadFromLibrary(entry); return null; }
      if (entry) return null;
    }
    this.objects.set(objectId, found);
    if (found?.srts?.length || found?.extra?.length) this.refreshSRT();
    return found;
  }

  // Names of every .brres model available (for the palette "has model" hint).
  hasModel(objectId) {
    return !!this.objectModel(objectId);
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function buildLakitu(brres) {
  const model = brres.models.find((m) => m.name === 'jugemu');
  if (!model) throw new Error('jugemu model missing');
  const chr = brres.chr.get('wait') || [...brres.chr.values()][0] || null;
  const builder = new BrresModelBuilder(brres);
  const group = builder.build(model, { skinned: !!chr, lit: null });
  const hairModel = brres.models.find((m) => m.name === 'jugemu_hair');
  let head = null;
  group.traverse((o) => { if (o.isBone && o.name === 'ef_head') head = o; });
  if (hairModel && head) {
    const hair = builder.build(hairModel, { lit: null });
    hair.position.set(0, -8, -6);
    head.add(hair);
    group.userData.materials = [...(group.userData.materials || []), ...(hair.userData.materials || [])];
  }
  return { template: group, chr };
}

// Kart + driver assembled like the game: body at the ride height, four wheels from the BSP
// (the game mirrors the two right wheels), suspension arms at the wheels, driver playing "drive".
// Vehicle IDs (game order) of the karts whose files can be used for the start model.
const VEHICLE_ID = { mdf_kart: 1, ma_kart: 4, mb_kart: 7, mc_kart: 10, md_kart: 13, me_kart: 16 };

// kartDriverDispParam.bin: 36 vehicles x 48 characters, 0x38 bytes each (index vehicle * 48 + character);
// the first two floats move the driver up/down (Y) and forward/back (Z) on that vehicle.
function driverOffset(data, vehicle, character) {
  if (!data || data.length < 8) return { y: 0, z: 0 };
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const characters = v.getInt32(4), at = 8 + (vehicle * characters + character) * 0x38;
  if (at + 8 > data.length) return { y: 0, z: 0 };
  return { y: v.getFloat32(at), z: v.getFloat32(at + 4) };
}

function buildKart(tree, bspData, seat = { y: 0, z: 0 }) {
  const kartFile = findFile(tree, 'kart_model.brres'), driverFile = findFile(tree, 'driver_model.brres');
  if (!kartFile || !driverFile) throw new Error('kart_model.brres or driver_model.brres missing');
  const kb = parseBRRES(kartFile.data), db = parseBRRES(driverFile.data);
  const kartBuilder = new BrresModelBuilder(kb);
  const part = (name) => { const m = kb.models.find((x) => x.name === name); return m ? kartBuilder.build(m, { lit: null }) : null; };
  // Ride height and wheels (front right, back right) from the BSP; Standard Kart M values otherwise.
  let rideHeight = 66;
  let wheels = [{ x: 68, z: 89, radius: 35 }, { x: 68, z: -89, radius: 34 }];
  if (bspData && bspData.length >= 0x1FC) {
    const v = new DataView(bspData.buffer, bspData.byteOffset, bspData.byteLength);
    rideHeight = v.getFloat32(0);
    wheels = [0x1A4, 0x1D0].map((o) => ({ x: Math.abs(v.getFloat32(o + 0x10)), z: v.getFloat32(o + 0x18), radius: v.getFloat32(o + 0x20) }));
  }
  // Radius of a tire model: half of its extent across the wheel (Y and Z, the axle being X).
  const tireRadius = (name) => {
    const m = kb.models.find((x) => x.name === name);
    let r = 0;
    for (const o of m?.objects || []) for (let i = 0; i < o.positions.length; i += 3) r = Math.max(r, Math.hypot(o.positions[i + 1], o.positions[i + 2]));
    return r || 36;
  };
  const group = new THREE.Group();
  group.name = 'start-kart';
  const materials = [];
  const add = (g, x, y, z, scale = 1) => {
    if (!g) return;
    g.position.set(x, y, z);
    g.scale.setScalar(scale);
    group.add(g);
    materials.push(...(g.userData.materials || []));
  };
  add(part('body'), 0, rideHeight, 0);
  wheels.forEach((w, i) => {
    const front = i === 0;
    for (const side of [1, -1]) {
      const right = side > 0;
      // Scale the tire model from its own radius to the wheel radius of the BSP.
      const tireName = right ? 'tire_fr' : 'tire_fl';
      add(part(tireName), side * w.x, w.radius, w.z, w.radius / tireRadius(tireName));
      add(part(`arm_${front ? 'f' : 'r'}${right ? 'r' : 'l'}`), side * w.x, w.radius, w.z);
    }
  });
  const driverModel = db.models.find((m) => m.name === 'model') || db.models[0];
  const chr = db.chr.get('drive') || db.chr.get('wait') || [...db.chr.values()][0] || null;
  const driver = new BrresModelBuilder(db).build(driverModel, { skinned: !!chr, lit: null });
  driver.name = 'driver';
  add(driver, 0, rideHeight + seat.y, seat.z);
  group.userData.materials = materials;
  return { template: group, chr };
}
