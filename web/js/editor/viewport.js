// 3D viewport: collision, real game models, KMP entities, selection, gizmo, placement,
// collision painting and in-game animations.
// Performance: entity objects are cached between rebuilds (only changed ones are recreated),
// raycasts use a BVH, the camera is damped and the scene is only redrawn when something changes.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { KCL_TYPES, OBJECT_DISPLAY, categorizeObject, objectDisplayY } from '../data/defs.js';
import { polygonPieces } from '../formats/brres.js';
import { ModelLibrary, modelKeyForObject } from './models.js';
import { EffectPreview } from './effect-preview.js';
import { cloneModel, bindCHR, applyCHRFrame, applySRTFrame, applyBillboards, collectBillboards } from './brresmodel.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export const COLORS = {
  KTPT: 0xef4444, ENPT: 0xff6b6b, ITPT: 0x4ade80, CKPT: 0x3b82f6, CKPT_LAP: 0xff2d55, CKPT_KEY: 0xfacc15,
  GOBJ: 0xf59e0b, ITEMBOX: 0xffb020, POTI: 0xa855f7, AREA: 0x22d3ee, AREA_EDGE: 0x67f3ff, CAME: 0xe879f9, JGPT: 0x60a5fa,
  CNPT: 0xfb7185, MSPT: 0x94a3b8,
};
const CATEGORY_COLOR = { Race: 0xffb020, Enemies: 0xe11d48, Vehicles: 0x2563eb, Vegetation: 0x16a34a, Effects: 0xfacc15, Sounds: 0x38bdf8, Decoration: 0xa855f7, Mechanisms: 0x71717a, Other: 0xf59e0b };

const DEG = Math.PI / 180;
const EULER_ORDER = 'ZYX';

// Area outline colour by type: camera red, effect violet, fog grey-blue, pull green, enemy route orange,
// minimap yellow, bloom pink, Boos lilac, object group lime, object unload teal, fall boundary amber.
export const AREA_TYPE_COLORS = [0xff3b3b, 0xb07cff, 0x9fb4c8, 0x4ade80, 0xff9f40, 0xfde047, 0xff6ec7, 0xd8b4fe, 0xa3e635, 0x2dd4bf, 0xffb020];

export const LAYERS = ['VISUAL', 'SKY', 'KCL', 'MODEL', 'GRID', 'KTPT', 'ENPT', 'ITPT', 'CKPT', 'GOBJ', 'POTI', 'AREA', 'CAME', 'JGPT', 'CNPT', 'MSPT'];

// Geometries indexed by three-mesh-bvh (without `indirect`) have a reordered index buffer;
// faceIndex then refers to that buffer, while face.a still identifies the original triangle.
const sourceTriangle = (hit) => hit.object.geometry.index && hit.face ? Math.floor(hit.face.a / 3) : hit.faceIndex;

export class Viewport extends EventTarget {
  constructor(container, doc) {
    super();
    this.container = container;
    this.doc = doc;
    this.layers = Object.fromEntries(LAYERS.map((l) => [l, true]));
    this.kclHidden = new Set([0x10]); // fall boundaries hide everything below the track
    this.kclOpacity = 1;
    this.kclWireframe = true; // triangle edges help to read the collision shape
    this.paintOverModel = true;
    this.paintOpacity = 0.55;
    this.paintShowTriangles = true;
    this.iconSize = 150;
    this.mode = 'translate';
    this.tool = null;
    this.groundSnap = false;
    this.smartAlignment = false;
    this.translationSnap = 0;
    this.rotationSnap = 0;
    this.needsRender = true;
    this.keys = new Set();
    this.rmbDown = false;
    // Display settings (changed from the app/preferences).
    this.displayMode = 'auto';   // auto | visual | collision | both
    this.collisionFocus = false; // Collision tab open: Auto shows the collision over the model
    this.modelMode = 'real';     // real | simple | markers
    this.animations = true;      // play in-game animations
    this.showLabels = true;      // names above unknown objects
    this.flySpeed = 1;
    this.selectionBox = false; // yellow bounding box around the selection (Settings)
    this.showAreaVolumes = true; // transparent AREA boxes and outlines (Settings)
    this.areaOutlinesThroughWalls = false; // show a faint copy of occluded AREA edges
    this.lookSensitivity = 1;
    this.hideCursorWhileLooking = false;
    this.objectModelProvider = null; // (objectId) => { template, chr } | null
    this.startModelProvider = null;  // () => { template, chr } | null (Mario's kart for start positions)
    this.respawnModelProvider = null; // () => { template, chr } | null (Lakitu for respawn points)
    this.objectNameProvider = () => null;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x1c1c1e);
    container.append(this.renderer.domElement);
    this.canvas = this.renderer.domElement;
    this.canvas.addEventListener('webglcontextrestored', () => { this.needsRender = true; this.scheduleRebuild(); });
    this.canvas.tabIndex = 0;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 5, 4e6);
    this.camera.position.set(0, 25000, 30000);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(0.5, 1, 0.3);
    this.scene.add(sun);

    this.grid = new THREE.GridHelper(400000, 200, 0x3c3c40, 0x2a2a2e);
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.6;
    this.scene.add(this.grid);

    this.skyGroup = new THREE.Group();
    this.courseGroup = new THREE.Group();
    this.kclGroup = new THREE.Group();
    this.modelGroup = new THREE.Group();
    this.kmpGroup = new THREE.Group();
    this.overlayGroup = new THREE.Group();
    this.geometryOverlay = new THREE.Group();
    this.collisionToolOverlay = new THREE.Group();
    this.scene.add(this.skyGroup, this.courseGroup, this.kclGroup, this.modelGroup, this.kmpGroup, this.overlayGroup, this.geometryOverlay, this.collisionToolOverlay);
    // Particle effects of the track's objects (Settings › Show effects).
    this.effects = new EffectPreview(this.scene);
    this.effectNamesProvider = null;

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: null };
    this.controls.zoomToCursor = true;
    this.controls.screenSpacePanning = false;
    this.controls.maxPolarAngle = Math.PI;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.14;
    this.controls.zoomSpeed = 1.4;
    this.controls.addEventListener('change', () => (this.needsRender = true));

    this.pivot = new THREE.Object3D();
    this.scene.add(this.pivot);
    this.gizmo = new TransformControls(this.camera, this.canvas);
    this.gizmo.setSize(0.9);
    this.gizmo.addEventListener('change', () => (this.needsRender = true));
    this.gizmo.addEventListener('dragging-changed', (e) => this.onGizmoDragging(e.value));
    this.gizmo.addEventListener('objectChange', () => this.onGizmoChange());
    this.scene.add(this.gizmo);

    this.raycaster = new THREE.Raycaster();
    this.raycaster.firstHitOnly = true;
    this.pickables = [];
    this.kclMesh = null;
    this.kclTriMap = null;
    this.geometrySelection = null;
    this.queuedCourseModel = null;
    this.modelEditingEnabled = true;
    this.models = new ModelLibrary();
    this.cache = new Map();      // entity key -> { obj, sig }
    this.animated = [];          // instances with CHR0 bindings
    this.courseCHRBindings = [];
    this.srtBindings = [];       // texture animations (shared materials)
    this.spinners = [];          // item boxes etc.
    this.billboards = [];        // object parts that always face the camera
    this.courseBillboards = [];
    this.animTime = 0;
    this.camAnim = null;
    // KMP camera previews: `cameraShot` replaces the editor view (intro playback), `cameraInset`
    // is drawn in a corner. Both are { position, target, fov } from editor/cameras.js.
    this.shotCamera = new THREE.PerspectiveCamera(45, 16 / 9, 5, 4e6);
    this.cameraShot = null;
    this.cameraInset = null;

    this.makeSharedAssets();
    this.bindInput();

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();

    doc.on('load', () => { this.selectGeometry(null); this.clearCache(); this.rebuildKCL(); this.rebuildKMP(); this.frameAll(true); });
    doc.on('kcl', () => this.rebuildKCL());
    doc.on('change', () => this.scheduleRebuild());
    doc.on('live', () => this.scheduleRebuild());
    doc.on('selection', () => {
      if (doc.selection.size && this.geometrySelection && !this.preserveGeometrySelection) this.selectGeometry(null);
      this.scheduleRebuild(); this.updateGizmo();
    });

    let last = performance.now();
    const loop = (now) => {
      try {
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        this.flyStep(dt);
        this.cameraStep(now);
        if (this.controls.update()) this.needsRender = true;
        if (this.rebuildPending) {
          this.rebuildPending = false;
          this.rebuildKMP();
          if (!this.dragging) this.updateGizmo();
        }
        if (this.animations && !document.hidden) this.animStep(dt);
        if (this.needsRender) this.renderNow();
      } catch (error) {
        // A transient model/renderer error must not permanently stop the viewport.
        console.error('Viewport frame failed:', error);
        this.needsRender = true;
      } finally { requestAnimationFrame(loop); }
    };
    requestAnimationFrame(loop);
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  on(type, fn) { this.addEventListener(type, (e) => fn(e.detail)); }

  renderNow() {
    this.needsRender = false;
    if (this.cameraShot) { this.renderShot(this.cameraShot, this.gameRect()); return; }
    if (this.billboards.length) applyBillboards(this.billboards, this.camera);
    if (this.courseBillboards.length) applyBillboards(this.courseBillboards, this.camera);
    if (this.kclOverlay) this.renderOverlaid();
    else this.renderer.render(this.scene, this.camera);
    if (this.cameraInset) this.renderShot(this.cameraInset, this.insetRect());
  }

  // Collision over the model (Both, Paint): first the track with the collision colours on top, then
  // markers, objects, gizmo and highlights over them, so the colours never tint or hide them. The
  // second pass is depth-tested against the collision surface the first one left in the depth buffer.
  renderOverlaid() {
    const front = [this.kmpGroup, this.overlayGroup, this.geometryOverlay, this.collisionToolOverlay, this.pivot, this.gizmo];
    const back = [this.skyGroup, this.courseGroup, this.kclGroup, this.modelGroup, this.grid];
    const frontShown = front.map((o) => o.visible);
    front.forEach((o) => { o.visible = false; });
    this.renderer.render(this.scene, this.camera);
    const backShown = back.map((o) => o.visible);
    back.forEach((o) => { o.visible = false; });
    front.forEach((o, i) => { o.visible = frontShown[i]; });
    this.renderer.autoClear = false;
    try { this.renderer.render(this.scene, this.camera); } finally {
      this.renderer.autoClear = true;
      back.forEach((o, i) => { o.visible = backShown[i]; });
    }
  }

  resize() {
    const w = this.container.clientWidth || 1, hgt = this.container.clientHeight || 1;
    const size = this.renderer.getSize(new THREE.Vector2());
    const ratio = this.renderer.getPixelRatio();
    if (size.x === w && size.y === hgt && this.lastPixelRatio === ratio) return;
    this.lastPixelRatio = ratio;
    this.renderer.setSize(w, hgt);
    for (const m of this.mats?.values() || []) if (m.isLineMaterial) m.resolution.set(this.renderer.domElement.width, this.renderer.domElement.height);
    this.camera.aspect = w / hgt;
    this.camera.updateProjectionMatrix();
    // Resizing clears the canvas: draw again right away (ResizeObserver runs before the page is
    // painted) instead of on the next frame, or dragging a side panel shows empty frames (flicker).
    this.renderNow();
  }

  scheduleRebuild() { this.rebuildPending = true; this.needsRender = true; }

  // ---- KMP camera previews ----------------------------------------------------------
  setCameraShot(pose) { this.cameraShot = pose; this.needsRender = true; }
  setCameraInset(pose) { this.cameraInset = pose; this.needsRender = true; }
  // Bottom-right corner, 16:9, in CSS pixels (matches the frame drawn by the UI).
  insetRect() {
    const w = Math.round(Math.min(this.container.clientWidth * 0.3, 420)), h = Math.round((w * 9) / 16);
    return { x: this.container.clientWidth - w - 12, y: 12, w, h };
  }
  // The largest 16:9 area in the middle of the view: the game's picture, with black bars around it.
  gameRect() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const gw = Math.min(w, Math.round((h * 16) / 9)), gh = Math.round((gw * 9) / 16);
    return { x: Math.round((w - gw) / 2), y: Math.round((h - gh) / 2), w: gw, h: gh, full: true };
  }
  // Renders the scene as the game camera sees it: editor markers, gizmo and grid hidden.
  renderShot(pose, rect) {
    const cam = this.shotCamera;
    const width = rect ? rect.w : this.container.clientWidth, height = rect ? rect.h : this.container.clientHeight;
    cam.position.set(...pose.position);
    cam.up.set(0, 1, 0);
    cam.lookAt(...pose.target);
    cam.fov = Math.max(1, Math.min(170, pose.fov || 45));
    cam.aspect = width / Math.max(1, height);
    cam.updateProjectionMatrix();
    const hidden = [this.kmpGroup, this.overlayGroup, this.geometryOverlay, this.collisionToolOverlay, this.gizmo, this.grid, this.pivot, ...(this.hasCourseModel ? [this.kclGroup] : [])].filter((o) => o.visible);
    for (const o of hidden) o.visible = false;
    if (this.billboards.length) applyBillboards(this.billboards, cam);
    if (this.courseBillboards.length) applyBillboards(this.courseBillboards, cam);
    if (rect?.full) {
      // Black bars outside the picture.
      const r = this.renderer, color = r.getClearColor(new THREE.Color()), alpha = r.getClearAlpha();
      r.setClearColor(0x000000, 1);
      r.clear();
      r.setClearColor(color, alpha);
    }
    if (rect) {
      const r = this.renderer;
      r.setScissorTest(true);
      r.setScissor(rect.x, rect.y, rect.w, rect.h);
      r.setViewport(rect.x, rect.y, rect.w, rect.h);
      r.clear();
      r.render(this.scene, cam);
      r.setScissorTest(false);
      r.setViewport(0, 0, this.container.clientWidth, this.container.clientHeight);
    } else this.renderer.render(this.scene, cam);
    for (const o of hidden) o.visible = true;
    if (rect) {
      // The main view's billboards face the editor camera again.
      if (this.billboards.length) applyBillboards(this.billboards, this.camera);
      if (this.courseBillboards.length) applyBillboards(this.courseBillboards, this.camera);
    }
  }
  clearCache() { this.cache.clear(); this.scheduleRebuild(); }

  // ---- Shared geometries and materials -------------------------------------
  makeSharedAssets() {
    const g = {};
    g.sphere = new THREE.SphereGeometry(1, 16, 12);
    g.box = new THREE.BoxGeometry(1, 1, 1);
    g.boxBase = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    g.cone = new THREE.ConeGeometry(1, 2, 16).rotateX(Math.PI / 2); // points +Z
    g.arrow = new THREE.ConeGeometry(0.6, 1.6, 12).rotateX(Math.PI / 2);
    g.post = new THREE.CylinderGeometry(0.25, 0.25, 1, 10).translate(0, 0.5, 0);
    g.cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 40).translate(0, 0.5, 0);
    g.octa = new THREE.OctahedronGeometry(1);
    g.areaBoxEdges = new THREE.EdgesGeometry(g.boxBase);
    g.areaCylEdges = new THREE.EdgesGeometry(new THREE.CylinderGeometry(0.5, 0.5, 1, 40, 1, true).translate(0, 0.5, 0));
    // Thick (screen-space) versions for the area outlines: plain WebGL lines are always 1 pixel wide.
    g.areaBoxFat = new LineSegmentsGeometry().fromEdgesGeometry(g.areaBoxEdges);
    g.areaCylFat = new LineSegmentsGeometry().fromEdgesGeometry(g.areaCylEdges);
    this.geo = g;
    this.mats = new Map();
    this.tinted = new Map();
  }

  // Thick line material (width in pixels); its resolution follows the canvas size.
  fatLine(color, { width = 2.5, opacity = 1, overlay = false } = {}) {
    const key = `fat|${color}|${width}|${opacity}|${overlay}`;
    let m = this.mats.get(key);
    if (m) return m;
    m = new LineMaterial({ color, linewidth: width, transparent: true, opacity, depthTest: !overlay, depthWrite: false });
    m.resolution.set(this.renderer.domElement.width, this.renderer.domElement.height);
    this.mats.set(key, m);
    return m;
  }

  mat(color, { selected = false, transparent = false, opacity = 1, kind = 'std', map = null } = {}) {
    const key = `${color}|${selected}|${transparent}|${opacity}|${kind}|${map?.uuid}`;
    let m = this.mats.get(key);
    if (m) return m;
    if (kind === 'line') m = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: !selected });
    else if (kind === 'lineOver') m = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false });
    else if (kind === 'basic' || selected) {
      const c = new THREE.Color(color);
      if (selected) c.lerp(new THREE.Color(0xffffff), 0.55);
      m = new THREE.MeshBasicMaterial({ color: c, map, transparent: transparent || selected, opacity: selected ? (transparent ? Math.max(opacity, 0.45) : 0.95) : opacity, depthTest: !selected, side: THREE.DoubleSide, depthWrite: !transparent });
    } else {
      m = new THREE.MeshLambertMaterial({ color, map, transparent, opacity, emissive: new THREE.Color(color).multiplyScalar(0.25), depthWrite: !transparent, side: transparent ? THREE.DoubleSide : THREE.FrontSide });
    }
    this.mats.set(key, m);
    return m;
  }

  // Selected models keep their look but get brighter (cached tinted copy of each material).
  highlight(obj) {
    obj.traverse((o) => {
      if (!o.isMesh || o.userData.isLabel) return;
      const base = o.material;
      let t = this.tinted.get(base.uuid);
      if (!t && base.userData?.tev) {
        // Shares the uniforms (textures, animated texture matrices) and only brightens the result.
        t = base.clone();
        t.uniforms = { ...base.uniforms, uHighlight: { value: 0.45 } };
        this.tinted.set(base.uuid, t);
      }
      if (!t) {
        t = base.clone();
        if (t.color) t.color = t.color.clone().lerp(new THREE.Color(0xffe08a), 0.45);
        if (t.emissive) t.emissive = new THREE.Color(0x553300);
        this.tinted.set(base.uuid, t);
      }
      o.material = t;
    });
  }

  // ---- Visual model / skybox ------------------------------------------------
  setCourseModel(group) {
    if (group && this.geometryDrag?.selection.type === 'model') {
      if (this.queuedCourseModel && this.queuedCourseModel !== group) this.disposeModelGroup(this.queuedCourseModel);
      this.queuedCourseModel = group;
      return;
    }
    this.queuedCourseModel = null;
    this.courseCHRBindings = group?.userData.chrBindings || [];
    const previous = this.geometrySelection?.type === 'model' ? this.modelSelections(this.geometrySelection) : [];
    const oldGroups = [...this.courseGroup.children];
    this.courseGroup.clear();
    for (const old of oldGroups) this.disposeModelGroup(old);
    if (group) {
      const seen = new Set();
      group.traverse((o) => {
        if (o.isMesh && !o.isSkinnedMesh && !seen.has(o.geometry)) {
          seen.add(o.geometry);
          // indirect: the BVH keeps its own triangle order instead of reordering the index buffer,
          // so the triangles are still drawn in the file's order. Blended layers (the Dry Dry Ruins
          // sand) depend on it: reordered, their depth test shows dark triangles of the road below.
          o.geometry.computeBoundsTree?.({ indirect: true });
        }
      });
      this.courseGroup.add(group);
    }
    this.courseBillboards = group ? collectBillboards(group) : [];
    if (previous.length) {
      const restored = [];
      for (const item of previous) {
        let mesh = null;
        group?.traverse((o) => {
          if (o.isMesh && o.userData.partIndex === item.partIndex && o.userData.modelName === item.modelName
            && o.userData.materialName === item.mesh?.userData.materialName) mesh = o;
        });
        const part = mesh?.userData.modelPart;
        const piece = part && polygonPieces(part).pieces[item.pieceIndex];
        if (piece) restored.push(this.modelPieceSelection(mesh, piece.triangles[0]));
      }
      this.selectGeometry(restored.length ? { ...restored.at(-1), pieces: restored } : null);
    }
    this.applyDisplayMode();
  }

  disposeModelGroup(group) {
    const geometries = new Set(), materials = new Set(), textures = new Set();
    group.traverse((object) => {
      if (object.isMesh) {
        if (object.geometry) geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          if (!material) continue;
          materials.add(material);
          for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
          for (const value of Object.values(material.uniforms || {})) if (value?.value?.isTexture) textures.add(value.value);
          for (const texture of material.userData?.tevTextures || []) if (texture?.isTexture) textures.add(texture);
        }
      }
    });
    for (const geometry of geometries) { geometry.disposeBoundsTree?.(); geometry.dispose(); }
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
  }

  setSkyModel(group) {
    const oldGroups = [...this.skyGroup.children];
    this.skyGroup.clear();
    for (const old of oldGroups) this.disposeModelGroup(old);
    if (group) {
      group.traverse((o) => { if (o.isMesh) { o.renderOrder = -10; o.material.depthWrite = false; o.frustumCulled = false; } });
      this.skyGroup.add(group);
    }
    this.needsRender = true;
  }

  setSRTBindings(list) { this.srtBindings = list.filter(Boolean); this.needsRender = true; }

  // Update every material using a TEX0 image without rebuilding the track model.
  previewCourseTexture(name, rgba) { return this.previewTexture(this.courseGroup, name, rgba); }
  previewSkyTexture(name, rgba) { return this.previewTexture(this.skyGroup, name, rgba); }

  previewTexture(group, name, rgba) {
    const images = new Set();
    group.traverse((object) => {
      if (!object.isMesh) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        for (const map of material?.userData?.tevTextures || [material?.map]) {
          if (map?.userData.brresTextureName !== name || !map.image?.data) continue;
          if (!images.has(map.image)) {
            if (map.image.data.length !== rgba.length) continue;
            map.image.data.set(rgba);
            images.add(map.image);
          }
          map.needsUpdate = true;
        }
      }
    });
    if (images.size) this.needsRender = true;
    return images.size > 0;
  }

  get hasCourseModel() { return this.courseGroup.children.length > 0; }

  effectiveDisplay() {
    if (this.tool?.type === 'paint') return this.paintOverModel && this.hasCourseModel ? 'both' : 'collision';
    if (this.tool?.type === 'collision-create') return this.hasCourseModel ? 'both' : 'collision';
    if (this.tool?.type === 'geometry') return this.tool.target === 'collision' ? 'collision' : 'visual';
    if (this.displayMode === 'auto') return this.hasCourseModel ? (this.collisionFocus ? 'both' : 'visual') : 'collision';
    if (this.displayMode !== 'collision' && !this.hasCourseModel) return 'collision';
    return this.displayMode;
  }

  applyDisplayMode() {
    const mode = this.effectiveDisplay();
    const both = mode === 'both';
    const painting = this.tool?.type === 'paint';
    this.courseGroup.visible = this.layers.VISUAL && mode !== 'collision';
    this.skyGroup.visible = this.layers.SKY && mode !== 'collision';
    this.kclGroup.visible = this.layers.KCL && mode !== 'visual';
    this.kmpGroup.visible = !painting;
    if (this.kclMesh) {
      // Both looks exactly like Paint over the model and shares its opacity (paintOpacity).
      const op = both ? this.paintOpacity : painting || this.tool?.type === 'collision-create' ? 1 : this.kclOpacity;
      const materialChanged = this.kclMesh.material.opacity !== op || this.kclMesh.material.transparent !== (op < 1);
      this.kclMesh.material.opacity = op;
      this.kclMesh.material.transparent = op < 1;
      this.kclMesh.material.depthWrite = op >= 1;
      // KCL and the visible course mesh rarely occupy exactly the same surface, so over the model the
      // colour pass ignores the course depth: a depth-only pre-pass (kclDepth) clears the depth buffer
      // and writes the nearest collision surface, then the colour pass draws only that surface.
      // Testing against the collision itself matters: without it the triangles behind (under the
      // road, walls further away) could cover the one being painted.
      const overlay = both;
      if (this.kclDepth) this.kclDepth.visible = overlay;
      this.kclMesh.material.depthTest = true;
      // After the translucent (xlu) course meshes (renderOrder 2), or they would hide the paint.
      this.kclMesh.renderOrder = overlay ? 41 : -1;
      this.kclMesh.material.forceSinglePass = true;
      // The collision can contain overlapping faces. Limit the transparent
      // overlay to one colour pass per pixel so alpha cannot build up to solid.
      this.kclMesh.material.stencilWrite = overlay;
      this.kclMesh.material.stencilRef = 1;
      this.kclMesh.material.stencilFunc = THREE.NotEqualStencilFunc;
      this.kclMesh.material.stencilFail = THREE.KeepStencilOp;
      this.kclMesh.material.stencilZFail = THREE.KeepStencilOp;
      this.kclMesh.material.stencilZPass = THREE.ReplaceStencilOp;
      if (materialChanged) this.kclMesh.material.needsUpdate = true;
    }
    // Drawn in two passes (renderNow): markers and objects go over the collision colours.
    this.kclOverlay = both && !!this.kclMesh && this.kclGroup.visible;
    if (this.kclWire) {
      this.kclWire.visible = painting || both ? this.paintShowTriangles : this.kclWireframe;
      this.kclWire.material.depthTest = true;
      // Over the model the edges are tested against the collision depth written by kclDepth.
      this.kclWire.renderOrder = both ? 42 : 0;
      const edgeOpacity = painting || both ? 0.25 : 0.4;
      if (this.kclWire.material.opacity !== edgeOpacity) {
        this.kclWire.material.opacity = edgeOpacity;
        this.kclWire.material.needsUpdate = true;
      }
    }
    this.grid.visible = this.layers.GRID;
    this.modelGroup.visible = this.layers.MODEL;
    this.needsRender = true;
  }

  // ---- KCL mesh -------------------------------------------------------------
  rebuildKCL() {
    this.kclGroup.clear();
    this.clearCollisionToolOverlay();
    this.kclWire?.geometry.dispose();
    this.kclWire?.material.dispose();
    this.kclWire = null;
    if (this.kclMesh) { this.kclMesh.geometry.disposeBoundsTree?.(); this.kclMesh.geometry.dispose(); }
    this.kclDepth?.material.dispose();
    this.kclMesh = null;
    this.kclDepth = null;
    const kcl = this.doc.kcl;
    if (!kcl) { this.applyDisplayMode(); return; }
    const tris = [];
    for (let t = 0; t < kcl.count; t++) {
      if (kcl.valid && !kcl.valid[t]) continue;
      if (this.kclHidden.has(kcl.flags[t] & 0x1F)) continue;
      tris.push(t);
    }
    const pos = new Float32Array(tris.length * 9);
    const col = new Float32Array(tris.length * 9);
    this.kclTriMap = Int32Array.from(tris);
    this.kclDrawIndex = new Int32Array(kcl.count).fill(-1);
    tris.forEach((t, i) => {
      pos.set(kcl.verts.subarray(t * 9, t * 9 + 9), i * 9);
      this.kclDrawIndex[t] = i;
    });
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geom.computeVertexNormals();
    geom.computeBoundsTree();
    this.kclMesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.DoubleSide, transparent: this.kclOpacity < 1, opacity: this.kclOpacity,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, depthWrite: this.kclOpacity >= 1, forceSinglePass: true,
    }));
    this.kclMesh.renderOrder = -1;
    this.refreshKCLColors();
    this.kclGroup.add(this.kclMesh);
    // Depth-only pre-pass for the Paint overlay (see applyDisplayMode). Transparent so it is drawn
    // in the same list as the colour pass, after every course mesh.
    const depth = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({
      side: THREE.DoubleSide, colorWrite: false, depthWrite: true, depthTest: true, transparent: true,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    }));
    depth.renderOrder = 40;
    depth.visible = false;
    depth.raycast = () => {};
    depth.onBeforeRender = (renderer) => {
      renderer.state.buffers.depth.setMask(true); // clear() leaves the mask of the last material
      renderer.clearDepth();
    };
    this.kclDepth = depth;
    this.kclGroup.add(depth);
    if (this.kclWireframe || this.paintShowTriangles) {
      const wire = new THREE.LineSegments(new THREE.WireframeGeometry(geom), new THREE.LineBasicMaterial({ color: 0x0b0d12, transparent: true, opacity: 0.4, depthWrite: false }));
      this.kclWire = wire;
      this.kclGroup.add(wire);
    }
    this.applyDisplayMode();
    if (this.geometrySelection?.type === 'collision') this.showGeometrySelection();
  }

  refreshKCLColors(only) {
    if (!this.kclMesh) return;
    const kcl = this.doc.kcl;
    const col = this.kclMesh.geometry.attributes.color;
    const c = new THREE.Color();
    const list = only || this.kclTriMap;
    for (const t of list) {
      const i = this.kclDrawIndex[t];
      if (i < 0) continue;
      const flag = kcl.flags[t];
      c.set(KCL_TYPES[flag & 0x1F].color);
      // Variants get a slightly different shade so painted areas are distinguishable.
      const v = (flag >> 5) & 7;
      if (v) c.offsetHSL(0, 0, v * 0.03);
      for (let k = 0; k < 3; k++) col.setXYZ(i * 3 + k, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
    this.needsRender = true;
  }

  clearCollisionToolOverlay() {
    for (const child of this.collisionToolOverlay.children) {
      child.geometry?.dispose();
      child.material?.dispose();
    }
    this.collisionToolOverlay.clear();
    this.paintHoverTri = -1;
    this.needsRender = true;
  }

  showPaintHover(tri) {
    if (this.paintHoverTri === tri) return;
    this.clearCollisionToolOverlay();
    if (tri == null || tri < 0 || tri >= (this.doc.kcl?.count ?? 0)) return;
    this.paintHoverTri = tri;
    const v = this.doc.kcl.verts.subarray(tri * 9, tri * 9 + 9);
    const lines = new Float32Array([...v.subarray(0, 6), ...v.subarray(3, 9), ...v.subarray(6, 9), ...v.subarray(0, 3)]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(lines, 3));
    const outline = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.95 }));
    outline.renderOrder = 100;
    this.collisionToolOverlay.add(outline);
    this.needsRender = true;
  }

  // Clicked points of the shape being drawn, and the triangles it would make (`tris`: [[a, b, c], …]).
  showCollisionDraft(points, tris = []) {
    this.clearCollisionToolOverlay();
    if (tris.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tris.flat(2)), 3));
      const fill = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffdd57, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }));
      fill.renderOrder = 99;
      this.collisionToolOverlay.add(fill);
      const edges = new THREE.LineSegments(new THREE.WireframeGeometry(geo), new THREE.LineBasicMaterial({ color: 0xffdd57, transparent: true, opacity: 0.8, depthTest: false }));
      edges.renderOrder = 100;
      this.collisionToolOverlay.add(edges);
    }
    for (const point of points) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(Math.max(18, this.iconSize * 0.13), 10, 8),
        new THREE.MeshBasicMaterial({ color: 0xffdd57, depthTest: false }));
      dot.position.set(...point);
      dot.renderOrder = 101;
      this.collisionToolOverlay.add(dot);
    }
    if (points.length > 1) {
      const line = new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(...p)));
      const path = new THREE.Line(line, new THREE.LineBasicMaterial({ color: 0xffdd57, depthTest: false }));
      path.renderOrder = 100;
      this.collisionToolOverlay.add(path);
    }
    this.needsRender = true;
  }

  // ---- KMP entities ---------------------------------------------------------
  rebuildKMP() {
    for (const child of this.kmpGroup.children) {
      if (child.userData.ownGeometry) child.geometry.dispose();
      if (child.userData.ownInstance) child.dispose();
    }
    this.kmpGroup.clear();
    this.pickables = [];
    this.animated = [];
    this.spinners = [];
    this.billboards = [];
    const doc = this.doc, k = doc.kmp, s = this.iconSize;
    const sel = doc.selection;
    const isSel = (key) => sel.has(String(key));
    const lines = {}; // color -> positions
    const arrows = []; // { from, to, color }
    const addLine = (color, a, b) => { (lines[color] ||= []).push(...a, ...b); };
    const nextCache = new Map();
    const outlines = [];

    // Reuses the cached object for a key when its "signature" (look) did not change.
    const obtain = (key, sig, make) => {
      let e = this.cache.get(key);
      if (!e || e.sig !== sig) e = { obj: make(), sig };
      nextCache.set(key, e);
      return e.obj;
    };
    const place = (obj, key, pos, { rot, scale = [1, 1, 1], size = 1, pick = true } = {}) => {
      obj.position.set(pos[0], pos[1], pos[2]);
      if (rot) obj.rotation.set(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG, EULER_ORDER);
      else obj.rotation.set(0, 0, 0);
      obj.scale.set(scale[0] * size, scale[1] * size, scale[2] * size);
      obj.userData.key = String(key);
      this.kmpGroup.add(obj);
      if (pick) this.pickables.push(obj);
      return obj;
    };
    // Simple shape marker (sphere, post...).
    const marker = (key, geom, color, pos, opts = {}) => {
      const selFlag = opts.selected ?? isSel(key);
      const sig = `m|${geom.uuid}|${color}|${selFlag}|${opts.transparent}|${opts.opacity}`;
      const obj = obtain(String(key) + (opts.suffix || ''), sig, () => new THREE.Mesh(geom, this.mat(color, { selected: selFlag, transparent: opts.transparent, opacity: opts.opacity })));
      obj.userData.batchable = !selFlag;
      obj.renderOrder = selFlag ? 10 : 0;
      return place(obj, key, pos, opts);
    };
    // Detailed model (procedural); falls back to a marker in "markers" mode.
    const model = (key, modelKey, fallbackGeom, color, pos, opts = {}) => {
      // markerScale: proportions of the plain marker only (the model keeps its own).
      if (this.modelMode === 'markers') return marker(key, fallbackGeom, color, pos, { ...opts, scale: opts.markerScale ?? opts.scale });
      const selFlag = opts.selected ?? isSel(key);
      const obj = obtain(String(key), `p|${modelKey}|${color}|${selFlag}`, () => {
        const o = this.models.instance(modelKey, { color });
        if (selFlag) this.highlight(o);
        return o;
      });
      obj.userData.batchable = !selFlag;
      if (selFlag) outlines.push(obj);
      return place(obj, key, pos, opts);
    };

    // Enemy / item routes.
    for (const kind of ['ENPT', 'ITPT']) {
      if (!this.layers[kind]) continue;
      const color = COLORS[kind];
      const groups = k[kind];
      groups.forEach((g) => {
        const groupSel = isSel(g.uid);
        g.points.forEach((p, i) => {
          const selected = groupSel || isSel(p.uid);
          if (kind === 'ITPT' && this.modelMode !== 'markers') model(p.uid, 'shell', this.geo.sphere, color, p.pos, { size: s, selected });
          else marker(p.uid, this.geo.sphere, color, p.pos, { size: s * 0.45, selected });
          if (i > 0) arrows.push({ from: g.points[i - 1].pos, to: p.pos, color });
        });
        const last = g.points[g.points.length - 1];
        for (const n of g.next) {
          const ng = groups[n];
          if (last && ng?.points[0]) arrows.push({ from: last.pos, to: ng.points[0].pos, color });
        }
      });
    }

    // Checkpoints.
    if (this.layers.CKPT) {
      const fill = [];
      const groups = k.CKPT;
      const yOf = (cp, side) => doc.checkpointY(cp, cp[side][0], cp[side][1]);
      const checker = this.models.checkerTexture();
      groups.forEach((g) => {
        const groupSel = isSel(g.uid);
        const pts = g.points.map((cp) => ({
          cp,
          L: [cp.left[0], yOf(cp, 'left'), cp.left[1]],
          R: [cp.right[0], yOf(cp, 'right'), cp.right[1]],
        }));
        pts.forEach(({ cp, L, R }, i) => {
          const color = cp.type === 0 ? COLORS.CKPT_LAP : cp.type === 0xFF ? COLORS.CKPT : COLORS.CKPT_KEY;
          const whole = groupSel || isSel(cp.uid);
          const ph = s * 4;
          marker(cp.uid + ':L', this.geo.post, color, L, { scale: [s, ph, s], selected: whole || isSel(cp.uid + ':L') });
          marker(cp.uid + ':R', this.geo.post, color, R, { scale: [s, ph, s], selected: whole || isSel(cp.uid + ':R') });
          // Clickable bar between the posts selects the whole checkpoint (checkered for the finish line).
          const mid = [(L[0] + R[0]) / 2, (L[1] + R[1]) / 2 + ph * 0.8, (L[2] + R[2]) / 2];
          const dx = R[0] - L[0], dy = R[1] - L[1], dz = R[2] - L[2];
          const length = Math.hypot(dx, dy, dz);
          const lap = cp.type === 0 && this.modelMode !== 'markers';
          const sig = `bar|${color}|${whole}|${lap}`;
          const bar = obtain(String(cp.uid), sig, () => new THREE.Mesh(this.geo.box, lap
            ? this.mat(whole ? 0xffe08a : 0xffffff, { kind: 'basic', map: checker, transparent: true, opacity: 0.85 })
            : this.mat(color, { selected: whole, transparent: true, opacity: 0.38 })));
          if (lap) { bar.material.map.wrapS = bar.material.map.wrapT = THREE.RepeatWrapping; bar.material.map.repeat.set(Math.max(1, length / (s * 4)), 1); }
          place(bar, cp.uid, mid);
          bar.scale.set(length, s * 0.6, s * 0.25);
          bar.rotation.set(0, -Math.atan2(dz, dx), 0);
          // Arrow showing the driving direction implied by left/right.
          const fwd = new THREE.Vector3(dz, 0, -dx).normalize().multiplyScalar(s * 3);
          arrows.push({ from: mid, to: [mid[0] + fwd.x, mid[1], mid[2] + fwd.z], color, short: true });
          if (i > 0) {
            const prev = pts[i - 1];
            addLine(COLORS.CKPT, prev.L, L);
            addLine(COLORS.CKPT, prev.R, R);
            fill.push(...prev.L, ...prev.R, ...R, ...prev.L, ...R, ...L);
          }
          if (whole && this.layers.JGPT) {
            const jg = k.JGPT[cp.respawn];
            if (jg) addLine(COLORS.JGPT, mid, jg.pos);
          }
        });
        const last = pts[pts.length - 1];
        for (const n of g.next) {
          const ng = groups[n];
          if (!last || !ng?.points[0]) continue;
          const f = ng.points[0];
          const nL = [f.left[0], yOf(f, 'left'), f.left[1]], nR = [f.right[0], yOf(f, 'right'), f.right[1]];
          addLine(COLORS.CKPT, last.L, nL);
          addLine(COLORS.CKPT, last.R, nR);
          fill.push(...last.L, ...last.R, ...nR, ...last.L, ...nR, ...nL);
        }
      });
      if (fill.length) {
        const geom = new THREE.BufferGeometry();
        const arr = new Float32Array(fill);
        for (let i = 1; i < arr.length; i += 3) arr[i] += 15;
        geom.setAttribute('position', new THREE.BufferAttribute(arr, 3));
        const m = new THREE.Mesh(geom, this.mat(COLORS.CKPT, { kind: 'basic', transparent: true, opacity: 0.12 }));
        m.userData.ownGeometry = true;
        this.kmpGroup.add(m);
      }
    }

    // Start positions: a kart.
    if (this.layers.KTPT) for (const e of k.KTPT) {
      const real = this.modelMode === 'real' ? this.startModelProvider?.() : null;
      if (!real) { model(e.uid, 'kart', this.geo.boxBase, COLORS.KTPT, e.pos, { rot: e.rot, size: s * 1.2, markerScale: [1, 0.5, 1.6] }); continue; }
      const selFlag = isSel(e.uid);
      const obj = obtain(String(e.uid), `kart|${selFlag}|${real.template.uuid}`, () => {
        const o = cloneModel(real.template);
        if (selFlag) this.highlight(o);
        o.userData.chrBinding = real.chr ? bindCHR(real.chr, o) : null;
        return o;
      });
      // Real size, resting on the collision below the point as the game drops the kart onto the
      // floor (a start point slightly inside the road would otherwise cut the kart's bottom off).
      const ground = this.doc.heights?.groundBelow(e.pos[0], e.pos[2], e.pos[1] + 300, 0);
      const y = ground != null && Math.abs(ground - e.pos[1]) < 1500 ? ground : e.pos[1];
      place(obj, e.uid, [e.pos[0], y, e.pos[2]], { rot: e.rot });
      if (obj.userData.chrBinding) this.animated.push(obj);
      if (selFlag) outlines.push(obj);
    }

    // Objects: real game model when available, otherwise a recognisable low-poly model.
    if (this.layers.GOBJ) {
      for (const e of k.GOBJ) {
        const selFlag = isSel(e.uid);
        const sc = e.scale.map((v) => (Math.abs(v) < 0.001 ? 0.001 : v));
        const name = this.objectNameProvider(e.objectId);
        const real = this.modelMode === 'real' ? this.objectModelProvider?.(e.objectId) : null;
        const display = OBJECT_DISPLAY[name] || (e.objectId === 0x65 ? OBJECT_DISPLAY.itembox : null);
        let obj;
        if (real) {
          obj = obtain(String(e.uid), `r|${e.objectId}|${selFlag}|${real.template.uuid}`, () => {
            const o = cloneModel(real.template);
            if (selFlag) this.highlight(o);
            o.userData.chrBinding = real.chr ? bindCHR(real.chr, o) : null;
            o.userData.billboards = collectBillboards(o);
            return o;
          });
          const lift = this.groundLift(real.template, e, !!display?.ground);
          place(obj, e.uid, display ? [e.pos[0], e.pos[1] + objectDisplayY(display, e) + lift, e.pos[2]] : e.pos, { rot: e.rot, scale: display?.scale ? sc.map((v) => v * display.scale) : sc });
          if (obj.userData.chrBinding) this.animated.push(obj);
          if (obj.userData.billboards.length) this.billboards.push(...obj.userData.billboards);
        } else if (this.modelMode !== 'markers') {
          const key = modelKeyForObject(name, e.objectId);
          const color = key === 'crate' ? CATEGORY_COLOR[categorizeObject(name || '')] ?? COLORS.GOBJ : undefined;
          obj = obtain(String(e.uid), `p|${key}|${color}|${selFlag}|${name}|${this.showLabels}`, () => {
            const o = this.models.instance(key, { color });
            if (selFlag) this.highlight(o);
            if (key === 'crate' && this.showLabels) {
              const label = this.models.label(name || `0x${e.objectId.toString(16)}`);
              label.position.set(0, 1.5, 0);
              o.add(label);
            }
            return o;
          });
          obj.userData.batchable = !selFlag && key !== 'itembox';
          place(obj, e.uid, display ? [e.pos[0], e.pos[1] + objectDisplayY(display, e), e.pos[2]] : e.pos, { rot: e.rot, scale: sc, size: s * (key === 'itembox' ? 1.2 : 1.4) });
        } else {
          obj = marker(e.uid, this.geo.boxBase, e.objectId === 0x65 ? COLORS.ITEMBOX : COLORS.GOBJ, e.pos, { rot: e.rot, scale: sc.map(Math.abs), size: s * 1.4 });
        }
        if (selFlag && obj && !obj.isMesh) outlines.push(obj);
        if (e.objectId === 0x65) this.spinners.push(obj);
        if (selFlag && e.route !== 0xFFFF && k.POTI[e.route]) {
          const rp = k.POTI[e.route].points[0];
          if (rp) addLine(COLORS.POTI, e.pos, rp.pos);
        }
      }
    }

    // Routes.
    if (this.layers.POTI) {
      for (const r of k.POTI) {
        const groupSel = isSel(r.uid);
        r.points.forEach((p, i) => {
          // Cubes resting on the point: fully above the road, so they are easy to see and click.
          marker(p.uid, this.geo.boxBase, COLORS.POTI, p.pos, { size: s * 0.5, selected: groupSel || isSel(p.uid) });
          if (i > 0) arrows.push({ from: r.points[i - 1].pos, to: p.pos, color: COLORS.POTI });
        });
        if (r.loop === 0 && r.points.length > 2) addLine(COLORS.POTI, r.points[r.points.length - 1].pos, r.points[0].pos);
      }
    }

    // Areas.
    if (this.layers.AREA) {
      for (const e of k.AREA) {
        if (!this.showAreaVolumes && !isSel(e.uid)) continue;
        const scale = [e.scale[0] * 10000, e.scale[1] * 10000, e.scale[2] * 10000];
        const selected = isSel(e.uid);
        const areaColor = AREA_TYPE_COLORS[e.type] ?? COLORS.AREA;
        const solid = marker(e.uid, e.shape === 1 ? this.geo.cyl : this.geo.boxBase, areaColor, e.pos, { rot: e.rot, scale, transparent: true, opacity: selected ? 0.18 : 0.06, selected: false });
        solid.userData.isArea = true;
        solid.renderOrder = 5;
        const edgeGeo = e.shape === 1 ? this.geo.areaCylFat : this.geo.areaBoxFat;
        // Depth-tested perimeter; an optional faint copy also shows edges behind course geometry.
        const edges = obtain(e.uid + ':edges', `fat|${e.shape}|${selected}`, () => new LineSegments2(edgeGeo, this.fatLine(selected ? 0xffffff : areaColor, { width: selected ? 3.5 : 2.5, opacity: 1 })));
        const outlines = [edges];
        if (this.areaOutlinesThroughWalls) {
          const hidden = obtain(e.uid + ':edges-hidden', `fatx|${e.shape}|${selected}`, () => new LineSegments2(edgeGeo, this.fatLine(selected ? 0xffffff : areaColor, { width: 1.5, opacity: selected ? 0.6 : 0.35, overlay: true })));
          hidden.renderOrder = 6;
          outlines.push(hidden);
        }
        for (const l of outlines) {
          l.position.copy(solid.position);
          l.rotation.copy(solid.rotation);
          l.scale.copy(solid.scale);
          this.kmpGroup.add(l);
        }
      }
    }

    // Cameras.
    if (this.layers.CAME) {
      for (const e of k.CAME) {
        model(e.uid, 'camera', this.geo.cone, COLORS.CAME, e.pos, { rot: e.rot, size: s * 1.4 });
        if (isSel(e.uid)) {
          for (const [i, v] of [e.viewStart, e.viewEnd].entries()) {
            const m = obtain(`${e.uid}:view${i}`, 'view', () => new THREE.Mesh(this.geo.octa, this.mat(COLORS.CAME, { kind: 'basic' })));
            m.position.set(...v);
            m.scale.setScalar(s * 0.4);
            this.kmpGroup.add(m);
            addLine(COLORS.CAME, e.pos, v);
          }
        }
      }
    }

    if (this.layers.JGPT) for (const e of k.JGPT) {
      const real = this.modelMode === 'real' ? this.respawnModelProvider?.() : null;
      if (!real) { model(e.uid, 'lakitu', this.geo.cone, COLORS.JGPT, e.pos, { rot: e.rot, size: s * 1.5 }); continue; }
      const selFlag = isSel(e.uid);
      const obj = obtain(String(e.uid), `lakitu|${selFlag}|${real.template.uuid}`, () => {
        const o = cloneModel(real.template);
        if (selFlag) this.highlight(o);
        o.userData.chrBinding = real.chr ? bindCHR(real.chr, o) : null;
        return o;
      });
      // Lakitu floats above the point where the kart is put back, at the game's size (x2 the model).
      place(obj, e.uid, [e.pos[0], e.pos[1] + 250, e.pos[2]], { rot: e.rot, scale: [2, 2, 2] });
      if (obj.userData.chrBinding) this.animated.push(obj);
      if (selFlag) outlines.push(obj);
    }
    if (this.layers.CNPT) for (const e of k.CNPT) model(e.uid, 'cannon', this.geo.cone, COLORS.CNPT, e.pos, { rot: e.rot, size: s * 1.8 });
    if (this.layers.MSPT) for (const e of k.MSPT) model(e.uid, 'trophy', this.geo.cyl, COLORS.MSPT, e.pos, { rot: e.rot, size: s * 1.5 });

    // Direction arrows: one instanced mesh per color.
    const byColor = new Map();
    const tmp = new THREE.Object3D();
    for (const a of arrows) {
      addLine(a.color, a.from, a.to);
      const from = new THREE.Vector3(...a.from), to = new THREE.Vector3(...a.to);
      const dir = to.clone().sub(from);
      if (dir.lengthSq() < 1) continue;
      tmp.position.copy(a.short ? to : from.lerp(to, 0.5));
      tmp.lookAt(tmp.position.clone().add(dir));
      tmp.scale.setScalar(s * (a.short ? 0.5 : 0.6));
      tmp.updateMatrix();
      if (!byColor.has(a.color)) byColor.set(a.color, []);
      byColor.get(a.color).push(tmp.matrix.clone());
    }
    for (const [color, mats] of byColor) {
      const im = new THREE.InstancedMesh(this.geo.arrow, this.mat(color, { kind: 'basic' }), mats.length);
      mats.forEach((m, i) => im.setMatrixAt(i, m));
      im.instanceMatrix.needsUpdate = true;
      this.kmpGroup.add(im);
    }
    for (const [color, arr] of Object.entries(lines)) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      const l = new THREE.LineSegments(geom, this.mat(Number(color), { kind: 'line', opacity: 0.95 }));
      l.userData.ownGeometry = true;
      this.kmpGroup.add(l);
    }
    // Yellow box around selected models (optional in Settings).
    for (const o of this.selectionBox ? outlines : []) {
      o.updateMatrixWorld(true);
      const box = new THREE.BoxHelper(o, 0xffd34d);
      box.material.depthTest = false;
      box.renderOrder = 30;
      box.userData.ownGeometry = true;
      this.kmpGroup.add(box);
    }

    this.batchKMPVisuals();

    this.cache = nextCache;
    this.applyDisplayMode();
    this.syncEffects();
    this.needsRender = true;
  }

  // Models made around their centre (the Chain Chomp's ball) sink into the road when drawn at their
  // KMP point, while the game shows them standing on it (OBJECT_DISPLAY ground). Display only: the
  // saved position is unchanged. Objects the game really shows half underground (Monty Mole, a fire
  // snake in lava) are not in that list and keep their position.
  groundLift(template, e, ground) {
    return ground ? modelExtent(template).below * (Math.abs(e.scale[1]) || 1) : 0;
  }

  syncEffects() {
    const objects = this.layers.GOBJ ? (this.doc.kmp?.GOBJ || []).map((e) => ({ uid: e.uid, objectId: e.objectId, position: e.pos, rotation: e.rot, scale: e.scale })) : [];
    this.effects.sync(this.doc.szs, objects, (id) => this.effectNamesProvider?.(id) || []);
  }

  // Repeated editor icons share geometry and materials. Draw each component once
  // as instances, while retaining the original roots for per-object raycasting.
  batchKMPVisuals() {
    this.kmpGroup.updateMatrixWorld(true);
    const batches = new Map();
    for (const root of this.pickables) {
      if (!root.userData.batchable || root.userData.isArea || this.spinners.includes(root)) continue;
      const meshes = [];
      let supported = true;
      root.traverse((o) => {
        if (o.isSprite || o.isLine || o.isSkinnedMesh) supported = false;
        else if (o.isMesh) {
          if (Array.isArray(o.material) || o.material.transparent || !o.material.visible) supported = false;
          else meshes.push(o);
        }
      });
      if (!supported || !meshes.length) continue;
      const signature = meshes.map((m) => `${m.geometry.uuid}|${m.material.uuid}|${m.renderOrder}`).join(';');
      if (!batches.has(signature)) batches.set(signature, []);
      batches.get(signature).push({ root, meshes });
    }
    for (const entries of batches.values()) {
      if (entries.length < 2) continue;
      for (let part = 0; part < entries[0].meshes.length; part++) {
        const sample = entries[0].meshes[part];
        const batch = new THREE.InstancedMesh(sample.geometry, sample.material, entries.length);
        batch.renderOrder = sample.renderOrder;
        batch.frustumCulled = false;
        batch.userData.ownInstance = true;
        entries.forEach(({ meshes }, index) => batch.setMatrixAt(index, meshes[part].matrixWorld));
        batch.instanceMatrix.needsUpdate = true;
        this.kmpGroup.add(batch);
      }
      for (const { root } of entries) this.kmpGroup.remove(root);
    }
  }

  // ---- Animation --------------------------------------------------------------
  // Puts every animation at one frame (60 fps), e.g. while scrubbing a timeline.
  setAnimationFrame(frame) {
    this.animTime = Math.max(0, frame) / 60;
    this.animStep(0);
    this.needsRender = true;
  }

  animStep(dt) {
    if (this.effects.step(dt, this.renderer.domElement.height)) this.needsRender = true;
    const any = this.animated.length || this.courseCHRBindings.length || this.srtBindings.length || this.spinners.length;
    if (!any) return;
    this.animTime += dt;
    const frame = this.animTime * 60;
    for (const b of this.srtBindings) {
      const f = b.loop ? frame % b.frames : b.rest ? 0 : Math.min(frame, b.frames);
      if (b.apply) b.apply(f); else applySRTFrame(b, f);
    }
    for (const b of this.courseCHRBindings) applyCHRFrame(b, b.loop ? frame % b.frames : Math.min(frame, b.frames));
    for (const o of this.animated) {
      const b = o.userData.chrBinding;
      if (b) applyCHRFrame(b, b.loop ? frame % b.frames : Math.min(frame, b.frames));
    }
    for (const o of this.spinners) o.rotateY(dt * 1.6);
    this.needsRender = true;
  }

  resetAnimations() {
    this.animTime = 0;
    this.clearCache();
  }

  // ---- Gizmo ----------------------------------------------------------------
  pickGeometry(e) {
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    if (this.tool?.target === 'collision') {
      const hit = this.kclMesh && this.raycaster.intersectObject(this.kclMesh, false)[0];
      return hit ? { type: 'collision', tri: this.kclTriMap[sourceTriangle(hit)] } : null;
    }
    const hit = this.raycaster.intersectObject(this.courseGroup, true).find((h) => h.object.userData.partIndex !== undefined);
    if (!hit) return null;
    return this.modelPieceSelection(hit.object, sourceTriangle(hit));
  }

  modelPieceSelection(mesh, faceIndex) {
    const { partIndex, modelName, modelPart, materialName } = mesh.userData;
    const { pieces, triangleToPiece } = polygonPieces(modelPart);
    const piece = pieces[triangleToPiece[faceIndex]];
    const label = /kinoko/i.test(materialName) ? 'Mushroom' : materialName || mesh.name;
    return { type: 'model', partIndex, modelName, name: `${label} ${piece.index + 1}`, mesh,
      pieceIndex: piece.index, positionIndices: piece.positionIndices, vertexIndices: piece.vertexIndices, min: piece.min, max: piece.max };
  }

  modelSelections(selection = this.geometrySelection) {
    return selection?.type === 'model' ? selection.pieces || [selection] : [];
  }

  selectEntity(key, mode = 'replace') {
    if (mode === 'replace') this.selectGeometry(null);
    this.preserveGeometrySelection = mode !== 'replace';
    try { this.doc.select(key, mode); }
    finally { this.preserveGeometrySelection = false; }
    this.updateGizmo();
  }

  selectModelPiece(partIndex, pieceIndex, focus = false, mode = 'replace') {
    if (!this.modelEditingEnabled) return;
    let mesh = null;
    this.courseGroup.traverse((o) => { if (!mesh && o.isMesh && o.userData.partIndex === partIndex) mesh = o; });
    if (!mesh) return;
    const piece = polygonPieces(mesh.userData.modelPart).pieces[pieceIndex];
    if (!piece) return;
    if (mode === 'replace') this.doc.clearSelection();
    this.selectGeometry(this.modelPieceSelection(mesh, piece.triangles[0]), mode);
    if (focus) this.focusSelection();
  }

  selectGeometry(selection, mode = 'replace') {
    if (selection?.type === 'model') {
      let pieces = selection.pieces || [selection];
      if (mode !== 'replace') {
        pieces = [...this.modelSelections()];
        const at = pieces.findIndex((p) => p.partIndex === selection.partIndex && p.pieceIndex === selection.pieceIndex && p.modelName === selection.modelName);
        if (at >= 0 && mode === 'toggle') pieces.splice(at, 1);
        else if (at < 0) pieces.push(selection);
      }
      selection = pieces.length ? { ...pieces.at(-1), pieces } : null;
    }
    if (selection?.type === 'collision') {
      const tris = [...new Set(selection.tris || [selection.tri])].filter((tri) => Number.isInteger(tri) && tri >= 0 && tri < (this.doc.kcl?.count ?? 0));
      selection = tris.length ? { type: 'collision', tris, tri: tris.includes(selection.tri) ? selection.tri : tris[tris.length - 1] } : null;
    }
    this.geometrySelection = selection;
    this.showGeometrySelection();
    this.updateGizmo();
    this.emit('geometry-selection', selection);
  }

  geometryBox(selection) {
    const box = new THREE.Box3();
    const point = new THREE.Vector3();
    if (selection.type === 'model') {
      for (const part of this.modelSelections(selection)) {
        const attr = part.mesh?.geometry?.attributes.position;
        if (attr) for (const index of part.vertexIndices) box.expandByPoint(point.fromBufferAttribute(attr, index));
      }
    } else {
      const verts = this.geometryDrag?.selection === selection && this.geometryDrag.previewVertices;
      if (verts) for (let k = 0; k < verts.length / 3; k++) box.expandByPoint(point.fromArray(verts, k * 3));
      else for (const tri of selection.tris || [selection.tri]) {
        const source = this.doc.kcl?.verts?.subarray(tri * 9, tri * 9 + 9);
        if (source) for (let k = 0; k < 3; k++) box.expandByPoint(point.fromArray(source, k * 3));
      }
    }
    return box;
  }

  showGeometrySelection() {
    for (const child of this.geometryOverlay.children) {
      // The model tint shares the part's position buffer: disposing its geometry would free that buffer too.
      if (!child.userData.sharesGeometry) child.geometry?.dispose?.();
      child.material?.dispose?.();
    }
    this.geometryOverlay.clear();
    const s = this.geometrySelection;
    if (!s) { this.needsRender = true; return; }
    if (s.type === 'collision') {
      if (!this.doc.kcl) return;
      const tris = s.tris || [s.tri], preview = this.geometryDrag?.selection === s && this.geometryDrag.previewVertices;
      const lines = new Float32Array(tris.length * 18);
      tris.forEach((tri, index) => {
        if (tri < 0 || tri >= this.doc.kcl.count) return;
        const verts = preview ? preview.subarray(index * 9, index * 9 + 9) : this.doc.kcl.verts.subarray(tri * 9, tri * 9 + 9);
        lines.set([...verts.subarray(0, 6), ...verts.subarray(3, 9), ...verts.subarray(6, 9), ...verts.subarray(0, 3)], index * 18);
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(lines, 3));
      this.geometryOverlay.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xffff00, depthTest: false })));
    } else if (s.mesh?.parent) {
      const box = this.geometryBox(s);
      if (box.isEmpty()) return;
      // Yellow tint over the selected piece, like selected objects. Same position attribute as the
      // part, so it follows the gizmo while dragging; the transform is copied from the part each frame.
      for (const part of this.modelSelections(s)) {
        if (!part.mesh?.parent) continue;
        const tintGeo = new THREE.BufferGeometry();
        tintGeo.setAttribute('position', part.mesh.geometry.attributes.position);
        tintGeo.setIndex(part.vertexIndices);
        const tint = new THREE.Mesh(tintGeo, new THREE.MeshBasicMaterial({
          color: 0xffe08a, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false,
          polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
        }));
        tint.userData.sharesGeometry = true;
        tint.renderOrder = 3;
        tint.matrixAutoUpdate = false;
        tint.frustumCulled = false;
        const mesh = part.mesh;
        tint.onBeforeRender = () => tint.matrixWorld.copy(mesh.matrixWorld);
        this.geometryOverlay.add(tint);
      }
      if (this.selectionBox) {
        const helper = new THREE.Box3Helper(box, 0xffff00);
        helper.material.depthTest = false;
        this.geometryOverlay.add(helper);
      }
    }
    this.needsRender = true;
  }

  setMode(mode) {
    this.mode = mode;
    this.updateGizmo();
    this.emit('mode', mode);
  }

  entityVisualPosition(info) {
    const pos = this.doc.getPos(info);
    if (!pos) return null;
    if (info.kind !== 'GOBJ' || this.modelMode === 'markers') return new THREE.Vector3(...pos);
    const displayed = this.cache.get(String(info.item.uid))?.obj;
    if (displayed) return displayed.position.clone();
    const name = this.objectNameProvider(info.item.objectId);
    const display = OBJECT_DISPLAY[name] || (info.item.objectId === 0x65 ? OBJECT_DISPLAY.itembox : null);
    return new THREE.Vector3(pos[0], pos[1] + objectDisplayY(display, info.item), pos[2]);
  }

  updateGizmo() {
    if ((this.tool?.type === 'geometry' || !this.tool && this.modelEditingEnabled) && this.geometrySelection) {
      const s = this.geometrySelection;
      const box = this.geometryBox(s);
      if (s.type === 'model') for (const info of this.doc.selectedInfos({ expandGroups: true })) {
        const pos = this.doc.getPos(info);
        if (pos) box.expandByPoint(new THREE.Vector3(...pos));
      }
      if (box.isEmpty()) { this.gizmo.detach(); return; }
      box.getCenter(this.pivot.position);
      this.pivot.rotation.set(0, 0, 0);
      this.pivot.scale.set(1, 1, 1);
      this.gizmo.setMode(this.mode);
      this.gizmo.setSpace(this.mode === 'translate' ? 'world' : 'local');
      this.gizmo.showX = this.gizmo.showY = this.gizmo.showZ = true;
      this.gizmo.setTranslationSnap(this.translationSnap || null);
      this.gizmo.setRotationSnap(this.rotationSnap ? this.rotationSnap * DEG : null);
      this.gizmo.attach(this.pivot);
      this.needsRender = true;
      return;
    }
    const infos = this.doc.selectedInfos({ expandGroups: true }).filter((i) => this.doc.getPos(i));
    if (!infos.length || this.tool) { this.gizmo.detach(); this.needsRender = true; return; }
    const c = new THREE.Vector3();
    for (const i of infos) c.add(this.entityVisualPosition(i));
    c.divideScalar(infos.length);
    this.pivot.position.copy(c);
    this.pivot.scale.set(1, 1, 1);
    const single = infos.length === 1 ? infos[0].item : null;
    if (single?.rot) this.pivot.rotation.set(single.rot[0] * DEG, single.rot[1] * DEG, single.rot[2] * DEG, EULER_ORDER);
    else this.pivot.rotation.set(0, 0, 0, EULER_ORDER);

    let mode = this.mode;
    const canRotate = infos.some((i) => i.item.rot || (i.kind === 'CKPT' && !i.side));
    const canScale = infos.some((i) => i.item.scale || (i.kind === 'CKPT' && !i.side));
    if ((mode === 'rotate' && !canRotate) || (mode === 'scale' && !canScale)) mode = 'translate';
    this.gizmo.setMode(mode);
    this.gizmo.setSpace(mode === 'translate' ? 'world' : 'local');
    const onlyCk = infos.every((i) => i.kind === 'CKPT');
    if (onlyCk) {
      this.gizmo.showY = mode === 'rotate';
      this.gizmo.showX = mode !== 'rotate';
      this.gizmo.showZ = mode === 'translate';
    } else {
      this.gizmo.showX = this.gizmo.showY = this.gizmo.showZ = true;
    }
    this.gizmo.setTranslationSnap(this.translationSnap || null);
    this.gizmo.setRotationSnap(this.rotationSnap ? this.rotationSnap * DEG : null);
    this.gizmo.attach(this.pivot);
    this.needsRender = true;
  }

  onGizmoDragging(dragging) {
    this.controls.enabled = !dragging;
    this.dragging = dragging;
    const canStartGeometryDrag = this.geometrySelection && (this.tool?.type === 'geometry' || !this.tool && this.modelEditingEnabled);
    if (this.geometryDrag || (dragging && canStartGeometryDrag)) {
      if (dragging && canStartGeometryDrag) {
        this.doc.beginEdit();
        const selection = this.geometrySelection;
        const targets = selection.type === 'model' ? new Map() : null;
        if (targets) for (const piece of this.modelSelections(selection)) {
          let target = targets.get(piece.mesh);
          if (!target) {
            target = { mesh: piece.mesh, modelName: piece.modelName, partIndex: piece.partIndex,
              originalPositions: piece.mesh.geometry.attributes.position.array.slice(), vertexIndices: new Set(), positionIndices: new Set() };
            targets.set(piece.mesh, target);
          }
          for (const index of piece.vertexIndices) target.vertexIndices.add(index);
          for (const index of piece.positionIndices) target.positionIndices.add(index);
        }
        this.geometryDrag = {
          selection, mode: this.gizmo.mode, pos: this.pivot.position.clone(),
          box: this.geometryBox(selection).clone(),
          quat: this.pivot.quaternion.clone(), scale: this.pivot.scale.clone(),
          targets: targets ? [...targets.values()] : null,
          items: selection.type === 'model' ? this.doc.selectedInfos({ expandGroups: true }).filter((i) => this.doc.getPos(i)).map((info) => ({ info, start: structuredClone(info.item), pos: this.doc.getPos(info) })) : [],
          positions: selection.type === 'model' ? null
            : Float32Array.from((selection.tris || [selection.tri]).flatMap((tri) => [...this.doc.kcl.verts.subarray(tri * 9, tri * 9 + 9)])),
          previewVertices: null,
        };
      } else if (!dragging && this.geometryDrag) {
        const drag = this.geometryDrag;
        const { selection, positions, mode } = drag;
        const transform = this.geometryTransform();
        const changed = mode === 'translate' ? transform.translation.lengthSq() > 1e-12
          : mode === 'rotate' ? 1 - Math.abs(transform.rotation.w) > 1e-12
            : transform.scale.toArray().some((v) => Math.abs(v - 1) > 1e-6);
        this.geometryDrag = null;
        if (selection.type === 'model' && !changed) {
          for (const target of drag.targets) {
            const attr = target.mesh.geometry.attributes.position;
            attr.array.set(target.originalPositions);
            attr.needsUpdate = true;
          }
        }
        if (!changed) { this.doc.pending = null; this.showGeometrySelection(); this.updateGizmo(); }
        else if (selection.type === 'collision') {
          const kcl = this.doc.kcl;
          const verts = kcl.verts.slice();
          const transformed = drag.previewVertices || this.transformedCollisionVertices(drag, transform);
          (selection.tris || [selection.tri]).forEach((tri, index) => verts.set(transformed.subarray(index * 9, index * 9 + 9), tri * 9));
          kcl.verts = verts;
          this.doc.setKCL(kcl, true);
          this.doc.endEdit(`${{ translate: 'Move', rotate: 'Rotate', scale: 'Scale' }[mode]} collision triangle${(selection.tris || [selection.tri]).length === 1 ? '' : 's'}`);
          this.showGeometrySelection();
          this.updateGizmo();
        } else {
          const box = this.geometryBox(selection);
          selection.min = box.min.toArray();
          selection.max = box.max.toArray();
          this.showGeometrySelection();
          this.updateGizmo();
          this.emit('move-model-parts', { targets: drag.targets, mode, center: drag.pos.toArray(),
            translation: transform.translation.toArray(), rotation: transform.rotation.toArray(), scale: transform.scale.toArray(),
          });
        }
        if (this.queuedCourseModel) {
          const queued = this.queuedCourseModel;
          this.queuedCourseModel = null;
          if (!changed) this.setCourseModel(queued);
          else this.disposeModelGroup(queued);
        }
      }
      return;
    }
    if (dragging) {
      this.doc.beginEdit();
      this.dragStart = {
        pos: this.pivot.position.clone(),
        quat: this.pivot.quaternion.clone(),
        items: this.doc.selectedInfos({ expandGroups: true }).filter((i) => this.doc.getPos(i)).map((info) => ({
          info,
          start: structuredClone(info.item),
          pos: this.doc.getPos(info),
          visualPos: this.entityVisualPosition(info),
        })),
      };
      this.dragStart.box = new THREE.Box3();
      for (const { pos } of this.dragStart.items) this.dragStart.box.expandByPoint(new THREE.Vector3(...pos));
    } else if (this.dragStart) {
      const label = { translate: 'Move', rotate: 'Rotate', scale: 'Scale' }[this.gizmo.mode];
      this.dragStart = null;
      this.doc.endEdit(label);
      this.updateGizmo();
    }
  }

  geometryTransform() {
    const drag = this.geometryDrag;
    const translation = this.pivot.position.clone().sub(drag.pos);
    if (this.smartAlignment && drag.mode === 'translate' && drag.selection.type === 'model') {
      this.alignTranslation(drag.box, translation, new Set(drag.targets.map((target) => target.mesh)), new Set(drag.items.map((item) => item.info.item.uid)));
      this.pivot.position.copy(drag.pos).add(translation);
    }
    return {
      translation,
      rotation: this.pivot.quaternion.clone().multiply(drag.quat.clone().invert()).normalize(),
      scale: this.pivot.scale.clone().divide(drag.scale),
    };
  }

  // Magnetically align a dragged selection with the road or nearby unselected parts.
  // Only small corrections are applied; the setting is off until the user enables it.
  alignTranslation(box, delta, selectedMeshes, selectedUids) {
    if (!box || box.isEmpty()) return;
    const radius = Math.max(25, this.iconSize * 0.75);
    const best = [radius, radius, radius], correction = [0, 0, 0];
    const match = (axis, source, target) => {
      const distance = Math.abs(target - source);
      if (distance < best[axis]) { best[axis] = distance; correction[axis] = target - source; }
    };
    const center = box.getCenter(new THREE.Vector3()).add(delta);
    const movedMin = box.min.clone().add(delta), movedMax = box.max.clone().add(delta);
    if (this.doc.heights) {
      const ground = this.doc.heights.groundBelow(center.x, center.z, movedMin.y + radius + 2000, 0);
      if (ground !== null) match(1, movedMin.y, ground);
    }
    const seen = new Set();
    this.courseGroup.traverse((object) => {
      if (!object.isMesh || selectedMeshes.has(object) || seen.has(object.geometry)) return;
      seen.add(object.geometry);
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      const other = object.geometry.boundingBox;
      if (!other) return;
      const c = other.getCenter(new THREE.Vector3());
      for (const axis of [0, 2]) {
        const name = axis === 0 ? 'x' : 'z';
        for (const source of [center[name], movedMin[name], movedMax[name]])
          for (const target of [c[name], other.min[name], other.max[name]]) match(axis, source, target);
      }
    });
    for (const info of this.doc.index().values()) {
      if (selectedUids.has(info.item.uid) || !info.item.pos) continue;
      for (const axis of [0, 2]) match(axis, center.getComponent(axis), info.item.pos[axis]);
    }
    delta.add(new THREE.Vector3(...correction));
  }

  transformedGeometryPoint(point, drag, transform) {
    return point.sub(drag.pos).multiply(transform.scale).applyQuaternion(transform.rotation)
      .add(drag.pos).add(transform.translation);
  }

  transformedCollisionVertices(drag, transform) {
    const out = new Float32Array(drag.positions.length), point = new THREE.Vector3();
    for (let k = 0; k < drag.positions.length / 3; k++) {
      this.transformedGeometryPoint(point.fromArray(drag.positions, k * 3), drag, transform).toArray(out, k * 3);
    }
    return out;
  }

  onGizmoChange() {
    if (this.geometryDrag) {
      const drag = this.geometryDrag;
      const { selection } = drag;
      const transform = this.geometryTransform();
      if (selection.type === 'model') {
        const point = new THREE.Vector3();
        for (const target of drag.targets) {
          const attr = target.mesh.geometry.attributes.position;
          for (const i of target.vertexIndices) {
            this.transformedGeometryPoint(point.fromArray(target.originalPositions, i * 3), drag, transform);
            attr.setXYZ(i, point.x, point.y, point.z);
          }
          attr.needsUpdate = true;
        }
        if (drag.items.length) this.updateEntityDrag({ pos: drag.pos, quat: drag.quat, items: drag.items }, transform);
      } else {
        drag.previewVertices = this.transformedCollisionVertices(drag, transform);
        if (this.kclMesh) {
          const attr = this.kclMesh.geometry.attributes.position;
          (selection.tris || [selection.tri]).forEach((tri, index) => {
            const drawIndex = this.kclDrawIndex?.[tri];
            if (drawIndex == null || drawIndex < 0) return;
            for (let k = 0; k < 3; k++) {
              const at = index * 9 + k * 3, v = drag.previewVertices;
              attr.setXYZ(drawIndex * 3 + k, v[at], v[at + 1], v[at + 2]);
            }
          });
          attr.needsUpdate = true;
          this.kclMesh.geometry.computeVertexNormals();
        }
      }
      this.showGeometrySelection();
      this.needsRender = true;
      return;
    }
    if (this.dragStart) this.updateEntityDrag(this.dragStart);
  }

  updateEntityDrag(ds, geometryTransform = null) {
    const mode = geometryTransform ? this.geometryDrag.mode : this.gizmo.mode;
    const center = ds.pos;
    if (mode === 'translate') {
      const d = geometryTransform?.translation || this.pivot.position.clone().sub(center);
      if (!geometryTransform && this.smartAlignment) {
        this.alignTranslation(ds.box, d, new Set(), new Set(ds.items.map((item) => item.info.item.uid)));
        this.pivot.position.copy(center).add(d);
      }
      for (const { info, start } of ds.items) {
        this.doc.translate(info, start, [d.x, d.y, d.z]);
        if ((this.groundSnap || this.smartAlignment) && this.doc.heights && info.item.pos) {
          const p = info.item.pos;
          const y = this.doc.heights.groundBelow(p[0], p[2], p[1] + 2000, 0);
          if (y !== null && (this.groundSnap || Math.abs(p[1] - y) < this.iconSize)) p[1] = y;
        }
      }
    } else if (mode === 'rotate') {
      const dq = geometryTransform?.rotation || this.pivot.quaternion.clone().multiply(ds.quat.clone().invert());
      const multi = ds.items.length > 1;
      for (const { info, start, pos, visualPos } of ds.items) {
        const it = info.item;
        if (info.kind === 'CKPT') {
          const rotXZ = (p) => {
            const v = new THREE.Vector3(p[0], 0, p[1]).sub(new THREE.Vector3(center.x, 0, center.z)).applyQuaternion(dq);
            return [center.x + v.x, center.z + v.z];
          };
          if (info.side !== 'R') it.left = rotXZ(start.left);
          if (info.side !== 'L') it.right = rotXZ(start.right);
          continue;
        }
        if (start.rot) {
          const q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(start.rot[0] * DEG, start.rot[1] * DEG, start.rot[2] * DEG, EULER_ORDER));
          const e = new THREE.Euler().setFromQuaternion(dq.clone().multiply(q0), EULER_ORDER);
          it.rot = [e.x, e.y, e.z].map((r) => Math.round((r / DEG) * 1000) / 1000);
        }
        if (multi && it.pos) {
          const raw = new THREE.Vector3(...pos);
          const visual = visualPos || raw;
          const v = visual.clone().sub(center).applyQuaternion(dq).add(center).sub(visual.clone().sub(raw));
          it.pos = [v.x, v.y, v.z];
        }
      }
    } else if (mode === 'scale') {
      const f = geometryTransform?.scale || this.pivot.scale;
      for (const { info, start } of ds.items) {
        const it = info.item;
        if (start.scale) it.scale = [start.scale[0] * f.x, start.scale[1] * f.y, start.scale[2] * f.z].map((v) => Math.round(v * 1000) / 1000);
        else if (info.kind === 'CKPT' && !info.side) {
          const mx = (start.left[0] + start.right[0]) / 2, mz = (start.left[1] + start.right[1]) / 2;
          it.left = [mx + (start.left[0] - mx) * f.x, mz + (start.left[1] - mz) * f.x];
          it.right = [mx + (start.right[0] - mx) * f.x, mz + (start.right[1] - mz) * f.x];
        }
      }
    }
    this.doc.live();
  }

  // ---- Input ----------------------------------------------------------------
  ndc(e) {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  keyOf(o) {
    while (o && !o.userData.key) o = o.parent;
    return o;
  }

  pickEntity(e) {
    return this.pickEntityHit(e)?.key ?? null;
  }

  pickEntityHit(e) {
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    this.raycaster.firstHitOnly = false;
    const visible = (o) => { while (o) { if (!o.visible) return false; o = o.parent; } return true; };
    const hits = this.raycaster.intersectObjects(this.pickables, true).filter((h) => visible(h.object));
    this.raycaster.firstHitOnly = true;
    if (!hits.length) return null;
    // Areas are drawn by their edges (the fill is almost invisible): they are picked near an edge,
    // never through the fill, and not from inside. Clicking the sky through a camera area then
    // clears the selection instead of selecting the area.
    const rect = this.renderer.domElement.getBoundingClientRect();
    const onEdge = (h) => {
      const geometry = h.object.geometry;
      if (!geometry) return false;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      const box = geometry.boundingBox;
      if (box.containsPoint(h.object.worldToLocal(this.camera.position.clone()))) return false;
      // The outline in the object's own space: the 12 box edges, or the two rims of a cylinder.
      const { min, max } = box, segments = [];
      if (geometry === this.geo.cyl) {
        const c = box.getCenter(new THREE.Vector3()), r = Math.max(max.x - min.x, max.z - min.z) / 2;
        for (const y of [min.y, max.y]) for (let i = 0; i < 32; i++) {
          const a = i / 32 * Math.PI * 2, b = (i + 1) / 32 * Math.PI * 2;
          segments.push([new THREE.Vector3(c.x + Math.cos(a) * r, y, c.z + Math.sin(a) * r), new THREE.Vector3(c.x + Math.cos(b) * r, y, c.z + Math.sin(b) * r)]);
        }
      } else {
        const corner = (i) => new THREE.Vector3(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z);
        for (const [a, b] of [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]) segments.push([corner(a), corner(b)]);
      }
      // Distance on screen from the click to the nearest edge: within a few pixels counts as the edge.
      const toScreen = (v) => {
        const p = h.object.localToWorld(v.clone()).project(this.camera);
        return p.z > 1 ? null : { x: rect.left + (p.x + 1) / 2 * rect.width, y: rect.top + (1 - p.y) / 2 * rect.height };
      };
      for (const [a, b] of segments) {
        const pa = toScreen(a), pb = toScreen(b);
        if (!pa || !pb) continue;
        const dx = pb.x - pa.x, dy = pb.y - pa.y, len2 = dx * dx + dy * dy;
        const t = len2 ? Math.max(0, Math.min(1, ((e.clientX - pa.x) * dx + (e.clientY - pa.y) * dy) / len2)) : 0;
        if (Math.hypot(e.clientX - (pa.x + dx * t), e.clientY - (pa.y + dy * t)) <= 8) return true;
      }
      return false;
    };
    const roots = hits.map((h) => ({ root: this.keyOf(h.object), distance: h.distance, object: h.object, h }))
      .filter((h) => h.root && !(h.root.userData.isArea && !onEdge(h.h)));
    const hit = roots.find((h) => !h.root.userData.isArea) || roots[0];
    return hit ? { key: hit.root.userData.key, distance: hit.distance } : null;
  }

  pickModelHit(e) {
    if (!this.modelEditingEnabled || !this.courseGroup.visible) return null;
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    this.raycaster.firstHitOnly = true;
    const hit = this.raycaster.intersectObject(this.courseGroup, true).find((h) => h.object.userData.partIndex !== undefined);
    return hit ? { selection: this.modelPieceSelection(hit.object, sourceTriangle(hit)), distance: hit.distance } : null;
  }

  // Point on the collision (or on the visual model / y=0 plane when there is none under the cursor).
  pickGround(e) {
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    if (this.kclMesh) {
      const hit = this.raycaster.intersectObject(this.kclMesh, false)[0];
      if (hit) return { point: hit.point.toArray(), tri: this.kclTriMap[sourceTriangle(hit)], normal: hit.face?.normal };
    }
    if (this.hasCourseModel && this.courseGroup.visible) {
      const hit = this.raycaster.intersectObject(this.courseGroup, true)[0];
      if (hit) return { point: hit.point.toArray(), tri: -1 };
    }
    const p = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p)) return { point: p.toArray(), tri: -1 };
    return null;
  }

  updateCursor() {
    this.canvas.style.cursor = this.rmbDown && this.hideCursorWhileLooking ? 'none'
      : this.tool ? (this.tool.type === 'paint' ? 'cell' : 'crosshair') : '';
  }

  bindInput() {
    const c = this.canvas;
    let down = null;
    const marquee = document.createElement('div');
    marquee.className = 'marquee';
    this.container.append(marquee);

    c.addEventListener('contextmenu', (e) => e.preventDefault());
    let rmb = null;
    // In the desktop window the cursor is kept in place natively (src/window.ts): the browser's
    // pointer lock would show a "press Esc to show your cursor" banner. Pointer lock is only the
    // fallback when the editor runs in a normal browser.
    const nativeCursor = (action, arg) => {
      try { Promise.resolve(window.__winctl(action, arg)).catch(() => {}); } catch { /* window closing */ }
    };
    const RECENTER = 150; // CSS px from the view's centre before the hidden cursor is put back
    // Capture phase: runs before OrbitControls so Alt+left can switch it to orbit.
    c.addEventListener('pointerdown', (e) => {
      c.focus();
      this.camAnim = null;
      if (e.button === 2) {
        e.preventDefault();
        this.rmbDown = true;
        const native = this.hideCursorWhileLooking && typeof window.__winctl === 'function';
        // The hidden cursor is put back at the centre of the 3D view (not where the button was
        // pressed, which can be near the screen edge: the cursor would stop there before moving far
        // enough to be put back, and the view would stop turning).
        const r = c.getBoundingClientRect();
        const ax = r.left + r.width / 2, ay = r.top + r.height / 2;
        rmb = { moved: 0, x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, native, warpAt: 0, ax, ay,
          radius: Math.max(20, Math.min(RECENTER, Math.min(r.width, r.height) / 2 - 20)),
          // The centre as a fraction of the window: the same point whatever the display scaling.
          warpArg: `${(ax / window.innerWidth).toFixed(5)},${(ay / window.innerHeight).toFixed(5)}` };
        if (native) nativeCursor('cursor-save');
        this.controls.enabled = false;
        this.updateCursor();
        try { c.setPointerCapture(e.pointerId); } catch { /* pointer locked */ }
      }
      if (e.button === 0 && e.altKey) { this.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE; return; }
      this.controls.mouseButtons.LEFT = null;
      if (e.button !== 0) return;
      if (this.gizmo.dragging || this.gizmo.axis) return;
      down = { x: e.clientX, y: e.clientY, e, moved: false };
      if (this.tool?.type === 'paint') {
        this.paintStroke = true;
        this.emit('paint-start');
        this.paintAt(e);
      }
    }, { capture: true });
    c.addEventListener('wheel', () => { this.camAnim = null; }, { passive: true });
    // While looking around (right button held) or flying with WASD, the wheel sets the camera speed
    // instead of zooming. Capture phase so OrbitControls never sees it.
    c.addEventListener('wheel', (e) => {
      const flying = document.activeElement === c && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'].some((k) => this.keys.has(k));
      if (!this.rmbDown && !flying) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const factor = Math.pow(1.15, -Math.sign(e.deltaY));
      this.flySpeed = Math.min(20, Math.max(0.05, Math.round(this.flySpeed * factor * 100) / 100));
      this.emit('fly-speed', this.flySpeed);
    }, { capture: true, passive: false });
    window.addEventListener('pointerup', (e) => {
      if (e.button === 2) {
        this.rmbDown = false;
        this.controls.enabled = true;
        this.updateCursor();
        if (c.hasPointerCapture(e.pointerId)) c.releasePointerCapture(e.pointerId);
        if (document.pointerLockElement === c) document.exitPointerLock();
        if (rmb?.native) nativeCursor('cursor-restore');
        // Right click without dragging opens the context menu. Movement is summed while dragging
        // because clientX/Y stay frozen while the pointer is locked (and jump back when recentred).
        if (rmb && rmb.moved < 4 && e.target === c) {
          const at = { clientX: rmb.x, clientY: rmb.y };
          const entity = this.pickEntityHit(at);
          const model = this.pickModelHit(at);
          if (model && (!entity || model.distance < entity.distance - this.iconSize * 1.5)) {
            this.doc.clearSelection();
            this.selectGeometry(model.selection);
          } else if (entity) {
            this.selectGeometry(null);
            this.doc.select(entity.key);
          } else {
            this.selectGeometry(null);
            this.doc.clearSelection();
          }
          this.emit('context', { x: rmb.x, y: rmb.y });
        }
        rmb = null;
      }
      if (e.button !== 0 || !down) return;
      const d = down;
      down = null;
      marquee.style.display = 'none';
      if (this.paintStroke) { this.paintStroke = false; this.emit('paint-end'); return; }
      if (d.moved) {
        if (this.tool?.type === 'geometry' && this.tool.target === 'collision') this.marqueeCollision(d, e);
        else this.marqueeSelect(d, e);
        return;
      }
      if (this.tool?.type === 'place') {
        const g = this.pickGround(e);
        if (g) this.emit('place', { point: g.point, shift: e.shiftKey });
        return;
      }
      if (this.tool?.type === 'collision-create') {
        const g = this.pickGround(e);
        if (g) this.emit('collision-point', g.point);
        return;
      }
      if (this.tool?.type === 'geometry') {
        const picked = this.pickGeometry(e);
        if (this.tool.target === 'collision' && (e.shiftKey || e.ctrlKey || e.metaKey)) {
          const current = this.geometrySelection?.type === 'collision' ? [...(this.geometrySelection.tris || [this.geometrySelection.tri])] : [];
          if (picked) {
            const at = current.indexOf(picked.tri);
            if (at >= 0 && (e.ctrlKey || e.metaKey)) current.splice(at, 1);
            else if (at < 0) current.push(picked.tri);
          }
          this.selectGeometry(current.length ? { type: 'collision', tris: current, tri: picked && current.includes(picked.tri) ? picked.tri : current[current.length - 1] } : null);
        } else this.selectGeometry(picked);
        return;
      }
      const entity = this.pickEntityHit(e);
      const model = !this.tool ? this.pickModelHit(e) : null;
      // Markers sit on (or partly in) the road: the track model only wins when it is clearly in front.
      if (model && (!entity || model.distance < entity.distance - this.iconSize * 1.5)) {
        const mode = e.ctrlKey || e.metaKey ? 'toggle' : e.shiftKey ? 'add' : 'replace';
        if (mode === 'replace') this.doc.clearSelection();
        this.selectGeometry(model.selection, mode);
        this.emit('click', { key: null, ground: this.pickGround(e) });
        return;
      }
      const key = entity?.key ?? null;
      const mode = e.ctrlKey || e.metaKey ? 'toggle' : e.shiftKey ? 'add' : 'replace';
      if (key) this.selectEntity(key, mode);
      else if (mode === 'replace') { this.selectGeometry(null); this.doc.clearSelection(); }
      this.emit('click', { key, ground: this.pickGround(e) });
    });
    let hoverQueued = null;
    c.addEventListener('pointermove', (e) => {
      if (this.rmbDown) {
        let dx = e.movementX, dy = e.movementY;
        if (rmb?.native) {
          // The cursor is put back at the view's centre whenever it gets far from it, so it never
          // stops at the screen edge. Movement is measured from positions: the first event after the
          // jump is the one nearer the centre than the previous event. It does not move the view
          // (wherever the cursor landed), and a jump that never shows up is asked again, otherwise the
          // cursor would reach the screen edge and the view would stop turning.
          const now = performance.now();
          if (rmb.warpAt && Math.hypot(e.clientX - rmb.ax, e.clientY - rmb.ay) < Math.hypot(e.clientX - rmb.lastX, e.clientY - rmb.lastY)) {
            rmb.lastX = e.clientX; rmb.lastY = e.clientY; rmb.warpAt = 0;
          } else if (rmb.warpAt && now - rmb.warpAt > 250) rmb.warpAt = 0;
          dx = e.clientX - rmb.lastX; dy = e.clientY - rmb.lastY;
          rmb.lastX = e.clientX; rmb.lastY = e.clientY;
          if (!rmb.warpAt && Math.max(Math.abs(e.clientX - rmb.ax), Math.abs(e.clientY - rmb.ay)) > rmb.radius) {
            rmb.warpAt = now;
            nativeCursor('cursor-recenter', rmb.warpArg);
          }
        } else if (rmb && !rmb.locked && this.hideCursorWhileLooking && c.requestPointerLock) {
          // Browser fallback. Asked on the first move, not on pointerdown: a pending lock makes other
          // pointerdown handlers (gizmo, orbit) fail to capture the pointer.
          rmb.locked = true;
          try { c.requestPointerLock()?.catch?.(() => {}); } catch { /* refused: capture still works */ }
        }
        if (rmb) rmb.moved += Math.abs(dx) + Math.abs(dy);
        const direction = this.controls.target.clone().sub(this.camera.position);
        const distance = Math.max(direction.length(), 1);
        const spherical = new THREE.Spherical().setFromVector3(direction);
        spherical.theta -= dx * 0.003 * this.lookSensitivity;
        spherical.phi = THREE.MathUtils.clamp(spherical.phi + dy * 0.003 * this.lookSensitivity, 0.001, Math.PI - 0.001);
        this.controls.target.copy(this.camera.position).add(new THREE.Vector3().setFromSpherical(spherical).normalize().multiplyScalar(distance));
        this.camera.lookAt(this.controls.target);
        this.needsRender = true;
        return;
      }
      const collisionBox = this.tool?.type === 'geometry' && this.tool.target === 'collision' && down?.e.shiftKey;
      if (down && !this.paintStroke && (!this.tool || collisionBox) && (Math.abs(e.clientX - down.x) > 4 || Math.abs(e.clientY - down.y) > 4)) {
        down.moved = true;
        const r = this.container.getBoundingClientRect();
        const x0 = Math.min(down.x, e.clientX) - r.left, y0 = Math.min(down.y, e.clientY) - r.top;
        Object.assign(marquee.style, { display: 'block', left: x0 + 'px', top: y0 + 'px', width: Math.abs(e.clientX - down.x) + 'px', height: Math.abs(e.clientY - down.y) + 'px' });
      }
      if (this.paintStroke) this.paintAt(e);
      // Hover picking at most once per frame.
      if (!hoverQueued) {
        hoverQueued = e;
        requestAnimationFrame(() => {
          const ev = hoverQueued;
          hoverQueued = null;
          if (this.rmbDown || this.dragging) return;
          const g = this.pickGround(ev);
          this.emit('hover', g);
          if (this.tool?.type === 'place' && g) this.showGhost(g.point);
          if (this.tool?.type === 'paint') this.showPaintHover(g?.tri);
        });
      } else hoverQueued = e;
    });
    c.addEventListener('dblclick', (e) => {
      const key = this.pickEntity(e);
      if (key) this.focusSelection();
    });

    c.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      this.keys.add(e.code);
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'].includes(e.code)) this.camAnim = null;
    });
    c.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    // The lock is granted asynchronously: after a quick right click it can arrive once the button
    // is already up, and must not stay (it would freeze the cursor and block pointer capture).
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === c && !this.rmbDown) document.exitPointerLock();
    });
    c.addEventListener('blur', () => {
      if (this.rmbDown && rmb?.native) nativeCursor('cursor-restore');
      this.keys.clear(); this.rmbDown = false; this.controls.enabled = true; this.updateCursor();
      if (document.pointerLockElement === c) document.exitPointerLock();
    });

    // Drag & drop from the object palette.
    c.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('application/x-mkwii-object')) e.preventDefault(); });
    c.addEventListener('drop', (e) => {
      const id = e.dataTransfer.getData('application/x-mkwii-object');
      if (!id) return;
      e.preventDefault();
      const g = this.pickGround(e);
      if (g) this.emit('drop-object', { objectId: Number(id), point: g.point });
    });
  }

  marqueeSelect(d, e) {
    const r = this.canvas.getBoundingClientRect();
    const x0 = Math.min(d.x, e.clientX) - r.left, x1 = Math.max(d.x, e.clientX) - r.left;
    const y0 = Math.min(d.y, e.clientY) - r.top, y1 = Math.max(d.y, e.clientY) - r.top;
    const keys = new Set();
    const v = new THREE.Vector3();
    for (const m of this.pickables) {
      if (m.userData.isArea) continue;
      v.copy(m.position).project(this.camera);
      if (v.z > 1) continue;
      const sx = (v.x + 1) / 2 * r.width, sy = (1 - v.y) / 2 * r.height;
      if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) keys.add(m.userData.key);
    }
    // Both ends of a checkpoint inside the box -> select the whole checkpoint.
    for (const key of [...keys]) {
      const [uid, side] = key.split(':');
      if (side === 'L' && keys.has(uid + ':R')) { keys.delete(uid + ':L'); keys.delete(uid + ':R'); keys.add(uid); }
    }
    for (const key of [...keys]) if (!key.includes(':') && (keys.has(key + ':L') || keys.has(key + ':R'))) { keys.delete(key + ':L'); keys.delete(key + ':R'); }
    const mode = e.ctrlKey ? 'toggle' : e.shiftKey ? 'add' : 'replace';
    const pieces = [];
    if (this.modelEditingEnabled && this.courseGroup.visible) this.courseGroup.traverse((mesh) => {
      if (!mesh.isMesh || mesh.userData.partIndex === undefined) return;
      for (const piece of polygonPieces(mesh.userData.modelPart).pieces) {
        const center = new THREE.Vector3((piece.min[0] + piece.max[0]) / 2, (piece.min[1] + piece.max[1]) / 2, (piece.min[2] + piece.max[2]) / 2).project(this.camera);
        if (center.z < -1 || center.z > 1) continue;
        const sx = (center.x + 1) / 2 * r.width, sy = (1 - center.y) / 2 * r.height;
        if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) pieces.push(this.modelPieceSelection(mesh, piece.triangles[0]));
      }
    });
    this.preserveGeometrySelection = true;
    try { this.doc.select([...keys], mode); }
    finally { this.preserveGeometrySelection = false; }
    if (mode === 'replace') this.selectGeometry(pieces.length ? { ...pieces.at(-1), pieces } : null);
    else for (const piece of pieces) this.selectGeometry(piece, mode);
    this.updateGizmo();
  }

  marqueeCollision(d, e) {
    if (!this.doc.kcl) return;
    const r = this.canvas.getBoundingClientRect();
    const x0 = Math.min(d.x, e.clientX) - r.left, x1 = Math.max(d.x, e.clientX) - r.left;
    const y0 = Math.min(d.y, e.clientY) - r.top, y1 = Math.max(d.y, e.clientY) - r.top;
    const current = this.geometrySelection?.type === 'collision' ? [...this.geometrySelection.tris] : [];
    const selected = new Set(current), v = this.doc.kcl.verts, point = new THREE.Vector3();
    for (const tri of this.kclTriMap || []) {
      const at = tri * 9;
      point.set((v[at] + v[at + 3] + v[at + 6]) / 3, (v[at + 1] + v[at + 4] + v[at + 7]) / 3, (v[at + 2] + v[at + 5] + v[at + 8]) / 3).project(this.camera);
      if (point.z < -1 || point.z > 1) continue;
      const x = (point.x + 1) / 2 * r.width, y = (1 - point.y) / 2 * r.height;
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) selected.add(tri);
    }
    const tris = [...selected];
    this.selectGeometry(tris.length ? { type: 'collision', tris, tri: tris[tris.length - 1] } : null);
  }

  paintAt(e) {
    const g = this.pickGround(e);
    if (g && g.tri >= 0) this.emit('paint', g);
  }

  setTool(tool) {
    if (this.tool?.type === 'geometry' && (tool?.type !== 'geometry' || tool.target !== this.tool.target)) this.selectGeometry(null);
    if (tool && tool.type !== 'geometry' && this.geometrySelection) this.selectGeometry(null);
    if (tool?.type === 'geometry' && tool.target === 'collision' && this.geometrySelection?.type === 'model') this.selectGeometry(null);
    this.tool = tool;
    this.updateCursor();
    this.clearCollisionToolOverlay();
    if (!tool) this.overlayGroup.clear();
    this.applyDisplayMode();
    this.updateGizmo();
    this.emit('tool', tool);
  }

  showGhost(point) {
    this.overlayGroup.clear();
    const m = new THREE.Mesh(this.geo.sphere, this.mat(0xffffff, { kind: 'basic', transparent: true, opacity: 0.5 }));
    m.position.set(...point);
    m.scale.setScalar(this.iconSize * 0.6);
    this.overlayGroup.add(m);
    this.needsRender = true;
  }

  // ---- Camera ---------------------------------------------------------------
  flyStep(dt) {
    const freeFly = document.activeElement === this.canvas && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'].some((k) => this.keys.has(k));
    if ((!this.rmbDown && !freeFly) || !this.keys.size) { this.flyVel?.set(0, 0, 0); return; }
    const dist = this.camera.position.distanceTo(this.controls.target);
    const speed = Math.max(2000, dist * 1.2) * this.flySpeed * (this.keys.has('ShiftLeft') ? 3 : 1);
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    const right = new THREE.Vector3().crossVectors(fwd, this.camera.up).normalize();
    const want = new THREE.Vector3();
    if (this.keys.has('KeyW')) want.add(fwd);
    if (this.keys.has('KeyS')) want.sub(fwd);
    if (this.keys.has('KeyD')) want.add(right);
    if (this.keys.has('KeyA')) want.sub(right);
    if (this.keys.has('KeyE')) want.y += 1;
    if (this.keys.has('KeyQ')) want.y -= 1;
    if (want.lengthSq()) want.normalize().multiplyScalar(speed);
    // Smooth acceleration.
    this.flyVel ||= new THREE.Vector3();
    this.flyVel.lerp(want, Math.min(1, dt * 10));
    if (this.flyVel.lengthSq() < 1) return;
    const move = this.flyVel.clone().multiplyScalar(dt);
    this.camera.position.add(move);
    this.controls.target.add(move);
    this.needsRender = true;
  }

  // Smooth camera transitions (focus, frame, top view).
  animateCamera(target, position, duration = 450) {
    this.camAnim = {
      t0: performance.now(), duration,
      fromT: this.controls.target.clone(), fromP: this.camera.position.clone(),
      toT: target.clone(), toP: position.clone(),
    };
    this.needsRender = true;
  }

  cameraStep(now) {
    const a = this.camAnim;
    if (!a) return;
    let t = Math.min(1, (now - a.t0) / a.duration);
    const e = 1 - Math.pow(1 - t, 3); // ease-out cubic
    this.controls.target.lerpVectors(a.fromT, a.toT, e);
    this.camera.position.lerpVectors(a.fromP, a.toP, e);
    if (t >= 1) this.camAnim = null;
    this.needsRender = true;
  }

  bounds() {
    const box = new THREE.Box3();
    const kcl = this.doc.kcl;
    if (kcl) {
      // Ignore fall boundaries: they are huge planes far below the track.
      const v = new THREE.Vector3();
      for (let t = 0; t < kcl.count; t++) {
        if ((kcl.valid && !kcl.valid[t]) || (kcl.flags[t] & 0x1F) === 0x10) continue;
        for (let k = 0; k < 3; k++) box.expandByPoint(v.fromArray(kcl.verts, t * 9 + k * 3));
      }
    }
    if (box.isEmpty() && this.hasCourseModel) box.setFromObject(this.courseGroup);
    if (box.isEmpty()) for (const m of this.pickables) if (!m.userData.isArea) box.expandByPoint(m.position);
    return box;
  }

  frameBox(box, instant = false) {
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = Math.max(box.getSize(new THREE.Vector3()).length(), 2000);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    if (!Number.isFinite(dir.x) || dir.lengthSq() < 0.5) dir.set(0, 0.8, 0.6).normalize();
    const pos = center.clone().add(dir.multiplyScalar(size * 0.75));
    if (instant) {
      this.camAnim = null;
      this.controls.target.copy(center);
      this.camera.position.copy(pos);
      this.needsRender = true;
    } else this.animateCamera(center, pos);
  }

  frameAll(instant = false) { this.frameBox(this.bounds(), instant); }

  focusSelection() {
    if (this.geometrySelection?.type === 'model') {
      const s = this.geometrySelection;
      this.frameBox(this.geometryBox(s).expandByScalar(this.iconSize * 3));
      return;
    }
    const box = new THREE.Box3();
    for (const info of this.doc.selectedInfos({ expandGroups: true })) {
      const it = info.item;
      if (info.kind === 'CKPT' && !info.side) {
        const y = this.doc.getPos(info)[1];
        box.expandByPoint(new THREE.Vector3(it.left[0], y, it.left[1]));
        box.expandByPoint(new THREE.Vector3(it.right[0], y, it.right[1]));
        continue;
      }
      const p = this.entityVisualPosition(info);
      if (p) box.expandByPoint(p);
      if (info.kind === 'AREA') box.expandByScalar(Math.max(...it.scale) * 5000);
    }
    if (box.isEmpty()) return;
    box.expandByScalar(this.iconSize * 12);
    this.frameBox(box);
  }

  topView() {
    const t = this.controls.target;
    const h = Math.max(this.camera.position.distanceTo(t), 5000);
    this.animateCamera(t.clone(), new THREE.Vector3(t.x, t.y + h, t.z + h * 0.001));
  }

  // Screen-center ground point (used to place new things when no click position exists).
  viewCenterPoint() {
    return this.controls.target.toArray();
  }

  setReferenceModel(object3d) {
    this.modelGroup.clear();
    if (object3d) this.modelGroup.add(object3d);
    this.needsRender = true;
  }
}

// Extent of a model below its origin and its height, in its own units (cached per model).
function modelExtent(template) {
  if (!template.userData.extent) {
    template.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(template);
    template.userData.extent = box.isEmpty() ? { below: 0, height: 0 } : { below: Math.max(0, -box.min.y), height: box.max.y - box.min.y };
  }
  return template.userData.extent;
}
