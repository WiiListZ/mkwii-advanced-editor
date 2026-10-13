// Editor controller: owns the document, the 3D viewport, file handling, commands and settings.
// It has no UI of its own: React components subscribe to it and call its methods.

import * as THREE from "three";
import { toast } from "sonner";
import { api, FILTERS, hasBackend, startupFile } from "../../js/api.js";
import { TrackDocument, KIND_LABEL, SECTION_LABEL } from "../../js/editor/document.js";
import { Viewport, LAYERS } from "../../js/editor/viewport.js";
import { Ops, copiesCenter } from "../../js/editor/ops.js";
import { GameAssets } from "../../js/editor/assets.js";
import { generateTrack } from "../../js/editor/trackgen.js";
import { validate } from "../../js/editor/validate.js";
import { isYaz0, yaz0Decompress } from "../../js/formats/yaz0.js";
import { isU8, parseU8, buildU8, findFile, setFile, setFilePath, newSzsTree, listFiles } from "../../js/formats/u8.js";
import { parseKMP, buildKMP, make } from "../../js/formats/kmp.js";
import { introChain, introIndex, introPose, introTimeline, selectionIndex, setCameraHeader, setIntroChain, simulateCamera } from "../../js/editor/cameras.js";
import { appendShot, introKeyframes, moveKey, removeKey, setKeyPose, splitShot } from "../../js/editor/intro-keys.js";
import { COLLISION_SHAPES, KCL_MAX_TRIANGLES, appendCollisionTriangles, buildCollisionShape, collisionBoxFromTriangles, collisionCoverage, deleteCollisionTriangles, duplicateCollisionTriangles, flipCollisionTriangles, isFloorTriangle, modelCollisionTriangles, simplifyCollisionTriangles, transformCollisionTriangles } from "../../js/editor/collision.js";
import { parseKCL, buildKCL, patchKCLFlags } from "../../js/formats/kcl.js";
import { parseOBJ, kclToOBJ, modelToOBJ } from "../../js/formats/obj.js";
import { clearBRRESPolygon, isBRRES, parseBRRES, polygonPieces, resetPieceMemory, replaceBRRESTexture, setCHR0Loop, transformBRRESPart, translateBRRESPart } from "../../js/formats/brres.js";
import { BrresModelBuilder, mainModel } from "../../js/editor/brresmodel.js";
import { BUILTIN_OBJECTS, KCL_TYPES, OBJECT_DISPLAY, OBJECT_INFO, makeFlag, parseObjFlow, trackLabel } from "../../js/data/defs.js";
import { objectDocumentation, parseObjectDocumentation } from "../../js/data/object-documentation.js";
import { externalPath, parseRiivolution } from "../../js/formats/riivolution.js";
import { findRiivolutionWorkspace, findWorkspaceRoot, resolveRiivolutionPath } from "../../js/editor/workspace.js";
import { dialogs } from "./dialogs-store";
import { isItemSlot, isStatsFile } from "../../js/formats/params.js";

export const PATH_KINDS = ["ENPT", "ITPT", "CKPT", "POTI"];
export const LAYER_LABEL: Record<string, string> = { VISUAL: "Track model", SKY: "Sky", KCL: "Collision", MODEL: "Reference model", GRID: "Grid", ...SECTION_LABEL };
const PERSISTED = ["workspace", "riivolutionXml", "cameraPreview", "hideGrid", "confirmModelDrop", "partsFolder", "favoriteObjects", "favoriteModelSources", "favoriteModelParts", "iconSize", "checkpointWidth", "autoCheckpointWidth", "pathWidth", "modelMode", "displayMode", "modelEditing", "smartAlignment", "animations", "showLabels", "selectionBox", "showAreaVolumes", "areaOutlinesThroughWalls", "showEffects", "showDescriptions", "quality", "flySpeed", "lookSensitivity", "hideCursorWhileLooking", "textureBrushSize", "uiFont", "offerCopyUpdates", "keepBackups", "map2DAddSeveral"] as const;
const VIEW_SETTINGS = new Set<keyof Settings>(["hideGrid", "iconSize", "modelMode", "displayMode", "modelEditing", "smartAlignment", "animations", "showLabels", "selectionBox", "showAreaVolumes", "areaOutlinesThroughWalls", "showEffects", "quality", "flySpeed", "lookSensitivity", "hideCursorWhileLooking"]);
const textEncoder = new TextEncoder();
const sameBytes = (a: Uint8Array, b: Uint8Array) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

export type Channel = "doc" | "selection" | "live" | "hover" | "ui" | "settings" | "kcl" | "intro";

export interface Settings {
  iconSize: number; checkpointWidth: number; autoCheckpointWidth: boolean; pathWidth: number; recent: string[];
  modelMode: "real" | "simple" | "markers"; displayMode: "auto" | "visual" | "collision" | "both";
  modelEditing: boolean; smartAlignment: boolean;
  animations: boolean; showLabels: boolean; selectionBox: boolean; showAreaVolumes: boolean; areaOutlinesThroughWalls: boolean; showEffects: boolean; showDescriptions: boolean; quality: "high" | "medium" | "low";
  flySpeed: number; lookSensitivity: number; hideCursorWhileLooking: boolean; textureBrushSize: number;
  workspace: string; riivolutionXml: string; partsFolder: string; favoriteObjects: number[]; favoriteModelSources: string[]; favoriteModelParts: string[];
  confirmModelDrop: boolean; hideGrid: boolean; cameraPreview: boolean; offerCopyUpdates: boolean; keepBackups: boolean; map2DAddSeveral: boolean;
  uiFont: "default" | "game";
  viewCenter: () => number[];
}

// Preferences that "Reset to defaults" restores. Recent files, favourites and folders are kept.
export const DEFAULT_SETTINGS = {
  iconSize: 150, checkpointWidth: 3000, autoCheckpointWidth: true, pathWidth: 20,
  modelMode: "real", displayMode: "auto", modelEditing: true, smartAlignment: false, animations: true, showLabels: true, selectionBox: false, showAreaVolumes: true, areaOutlinesThroughWalls: false, showEffects: true, showDescriptions: true, quality: "high",
  flySpeed: 1, lookSensitivity: 1, hideCursorWhileLooking: false, textureBrushSize: 8, confirmModelDrop: true, hideGrid: false, cameraPreview: true, uiFont: "default", offerCopyUpdates: true, keepBackups: true, map2DAddSeveral: false,
} satisfies Partial<Settings>;

export type CollisionShapeKind = keyof typeof COLLISION_SHAPES;
export interface CollisionShapeState { kind: CollisionShapeKind; height: number; segments: number }

export interface PaintState { type: number; variant: number; shadow: number; brush: "single" | "radius" | "fill" | "plane"; radius: number; showAll: boolean }

const MODEL_FILE = /\.(obj|fbx|gltf|glb|dae|stl|ply|blend)$/i;

// Game files that open on their own (not as a track) in the editor that changes them.
export type LooseKind = "model" | "text" | "effect" | "params" | "music" | "sounds" | "riivolution";
export type LooseFile = { path: string | null; name: string; data: Uint8Array };
export function looseKind(name: string, data: Uint8Array): LooseKind | null {
  const magic = String.fromCharCode(...data.subarray(0, 8));
  if (isBRRES(data)) return "model";
  if (magic === "MESGbmg1") return "text";
  if (magic.startsWith("REFF") || magic.startsWith("REFT")) return "effect";
  if (magic.startsWith("RSTM")) return "music";
  if (magic.startsWith("RSAR")) return "sounds";
  if (/\.xml$/i.test(name) && /<wiidisc[\s>]/i.test(new TextDecoder().decode(data.subarray(0, 4096)))) return "riivolution";
  if (isStatsFile(name, data) || isItemSlot(name, data)) return "params";
  return null;
}

// Windows path from a folder and names below it.
export const winPath = (root: string, ...parts: string[]) => [root.replace(/[\\/]+$/, ""), ...parts].join("\\");

// Interface font. "game" is M PLUS 1, a free (OFL) font close to the Rodin lettering of the game's
// menus, bundled with the editor. Remembered in localStorage too so index.html applies it before
// the first paint instead of switching fonts once settings arrive.
export function applyUiFont(font: Settings["uiFont"]) {
  if (font === "game") document.documentElement.dataset.font = "game";
  else delete document.documentElement.dataset.font;
  try { localStorage.setItem("uiFont", font); } catch {}
}

export const hex = (v: number, pad = 4) => "0x" + (v >>> 0).toString(16).toUpperCase().padStart(pad, "0");

export class Editor {
  doc = new TrackDocument();
  viewport: any = null;
  ops: any;
  assets: any = null;
  settings: Settings = {
    ...DEFAULT_SETTINGS, recent: [],
    workspace: "", riivolutionXml: "", partsFolder: "", favoriteObjects: [], favoriteModelSources: [], favoriteModelParts: [],
    viewCenter: () => this.viewport?.viewCenterPoint() ?? [0, 0, 0],
  };
  objectNames: Record<number, string> = { ...BUILTIN_OBJECTS };
  importedObjectDocumentation: Record<string, any> = {};
  commonPath: string | null = null;
  library: { folder: string; tracks: number; models: number; loading: boolean; error?: string } | null = null;
  trackFiles: { folder: string; files: string[] } | null = null; // .szs of the tracks folder, for the track switcher
  private trackRefreshBusy = false;
  private trackRefreshTimer: ReturnType<typeof setInterval> | null = null;
  selectedAnimation: string | null = null; // CHR0 of course_model.brres shown in the Inspector
  private pointPick: ((point: number[] | null) => void) | null = null;

  // Lets the user click a point on the track (like placing an object). Esc gives null.
  pickPoint(message: string): Promise<number[] | null> {
    if (!this.viewport) return Promise.resolve(null);
    this.pointPick?.(null);
    return new Promise((resolve) => {
      this.pointPick = resolve;
      this.viewport.setTool({ type: "place", kind: "PICK" });
      this.setHint(message);
    });
  }

  // Moves a model part up or down so its lowest point rests on `point` (it was centred there).
  restPartOnPoint(data: Uint8Array, modelName: string, partIndex: number, point: number[]) {
    const model = parseBRRES(data).models.find((m: any) => m.name === modelName);
    const part = model?.objects[partIndex];
    if (!part?.triangles) return data;
    let low = Infinity;
    for (let i = 0; i < part.positions.length / 3; i++) {
      const rigid = model.boneMatrix.get(part.mtx[i]);
      const w = rigid !== undefined && part.mtx[i] >= 0 ? model.bones[rigid]?.world : null;
      const x = part.positions[i * 3], y = part.positions[i * 3 + 1], z = part.positions[i * 3 + 2];
      low = Math.min(low, w ? w[4] * x + w[5] * y + w[6] * z + w[7] : y);
    }
    const dy = point[1] - low;
    return Number.isFinite(dy) && Math.abs(dy) > 0.01 ? translateBRRESPart(data, modelName, partIndex, [0, dy, 0]) : data;
  }
  tab = "outline";
  homeVisible = true;
  map2D = false;
  busy: string | null = null;
  hint = "";
  hover: any = null;
  tool: any = null;
  mode = "translate";
  issues: any[] = [];
  paint: PaintState = { type: 0, variant: 0, shadow: 0, brush: "single", radius: 600, showAll: false };
  collisionDraft: number[][] = [];
  collisionShape: CollisionShapeState = { kind: "triangle", height: 1000, segments: 16 };
  geometrySelection: any = null;
  modelClipboard: { modelName: string; partName: string; center: number[]; size: number[]; triangles: number[] } | null = null;
  kmpClipboard: any[] | null = null; // copied KMP elements (Ctrl+C on points, objects, areas…)
  lastClipboard: "model" | "kmp" | null = null; // what Ctrl+V pastes
  // The 2D map's view and the world X/Z under the mouse, so paste and duplicate can use them.
  map2DView = { cx: 0, cz: 0, scale: 0.01 };
  map2DPointer: [number, number] | null = null;
  textureOriginals = new Map<string, Uint8ClampedArray>();
  tourActive = false;
  maximized = false;
  private versions: Record<Channel, number> = { doc: 0, selection: 0, live: 0, hover: 0, ui: 0, settings: 0, kcl: 0, intro: 0 };
  private listeners = new Set<() => void>();
  private painted: Set<number> | null = null;
  private adjacency: { verts: any; list: number[][] } | null = null;
  private validateTimer: any = null;
  private flySpeedSave: any = null;
  private settingsSave: Promise<unknown> = Promise.resolve();

  constructor() {
    this.ops = new Ops(this.doc, this.settings);
    const d = this.doc;
    d.on("change", () => { this.introCache.clear(); this.bump("doc"); this.scheduleValidate(); this.refreshCameraViews(); });
    d.on("load", () => { resetPieceMemory(); this.textureOriginals.clear(); this.bump("doc"); this.bump("selection"); this.scheduleValidate(); });
    d.on("selection", () => { if (d.selection.size) this.selectedAnimation = null; this.cameraFrame = 0; this.bump("selection"); this.refreshCameraViews(); });
    d.on("live", () => { this.introCache.clear(); this.bump("live"); this.refreshCameraViews(); });
    d.on("kcl", () => { this.bump("kcl"); this.scheduleValidate(); });
    d.on("model", () => { void this.assets?.setTrack(d.szs).then(() => this.bump("doc")).catch((error: any) => console.error("Could not refresh track model:", error)); });
  }

  // ---- Subscriptions --------------------------------------------------------------------
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  version(channels: Channel[]) { return channels.map((c) => this.versions[c]).join("."); }
  bump(...channels: Channel[]) {
    for (const c of channels) this.versions[c]++;
    for (const fn of this.listeners) fn();
  }

  // ---- Viewport -------------------------------------------------------------------------
  attachViewport(container: HTMLElement) {
    if (this.viewport) { container.append(this.viewport.renderer.domElement); this.viewport.resize(); return; }
    const vp = new Viewport(container, this.doc);
    this.viewport = vp;
    this.assets = new GameAssets(vp);
    vp.objectModelProvider = (id: number) => this.assets.objectModel(id);
    vp.startModelProvider = () => this.assets.kart || null;
    vp.respawnModelProvider = () => this.assets.lakitu();
    this.assets.onLibraryLoaded = () => this.bump("doc");
    vp.objectNameProvider = (id: number) => this.objectNames[id];
    vp.effectNamesProvider = (id: number) => this.assets?.resourceNames(id) || [];
    vp.on("hover", (g: any) => {
      this.hover = g;
      if (this.tool?.type === "collision-create" && this.collisionDraft.length) this.showCollisionPreview(g?.point);
      this.bump("hover");
    });
    vp.on("fly-speed", (speed: number) => {
      this.settings.flySpeed = speed;
      clearTimeout(this.flySpeedSave);
      this.flySpeedSave = setTimeout(() => this.saveSettings({ flySpeed: speed }), 400);
      toast(`Camera speed ×${speed.toFixed(2)}`, { id: "fly-speed", duration: 1200 });
      this.bump("settings");
    });
    vp.on("mode", (m: string) => { this.mode = m; this.bump("ui"); });
    vp.on("tool", (t: any) => {
      this.tool = t;
      if (t?.type !== "collision-create") this.collisionDraft = [];
      if (!t) this.setHint("");
      if (t?.kind !== "PICK" && this.pointPick) { const done = this.pointPick; this.pointPick = null; done(null); }
      this.bump("ui");
    });
    vp.on("place", ({ point, shift }: any) => this.placeAt(point, shift));
    vp.on("drop-object", ({ objectId, point }: any) => this.ops.add("GOBJ", point, { objectId }));
    vp.on("collision-point", (point: number[]) => this.addCollisionPoint(point));
    vp.on("paint-start", () => { this.doc.beginEdit(); this.painted = new Set(); });
    vp.on("paint", (g: any) => this.paintAt(g));
    vp.on("paint-end", () => {
      if (this.painted?.size) {
        this.doc.kclFlagsChanged = true;
        this.doc.endEdit("Paint collision");
        this.doc.emit("kcl");
      } else this.doc.pending = null;
      this.painted = null;
    });
    vp.on("geometry-selection", (selection: any) => { this.geometrySelection = selection; this.bump("ui"); });
    vp.on("move-model-parts", ({ targets, mode, center, translation, rotation, scale }: any) => {
      const node = this.doc.szs && findFile(this.doc.szs, "course_model.brres");
      try {
        if (!node) throw new Error("This track has no course_model.brres");
        let data = node.data;
        const byPart = new Map<string, any>();
        for (const target of targets) {
          const key = `${target.modelName}:${target.partIndex}`;
          const part = byPart.get(key) || { ...target, positionIndices: new Set() };
          for (const index of target.positionIndices) part.positionIndices.add(index);
          byPart.set(key, part);
        }
        const allowed = new Map<string, number[]>();
        for (const target of byPart.values()) allowed.set(target.modelName, [...(allowed.get(target.modelName) || []), target.partIndex]);
        const written = new Map<string, Set<number>>();
        for (const target of byPart.values()) {
          const arrayKey = `${target.modelName}:${target.mesh.userData.modelPart.positionArrayId}`;
          const seen = written.get(arrayKey) || new Set<number>();
          const indices = [...target.positionIndices].filter((index: number) => !seen.has(index));
          if (!indices.length) continue;
          indices.forEach((index: number) => seen.add(index));
          written.set(arrayKey, seen);
          data = mode === "translate"
            ? translateBRRESPart(data, target.modelName, target.partIndex, translation, indices, allowed.get(target.modelName))
            : transformBRRESPart(data, target.modelName, target.partIndex, indices, { center, translation, rotation, scale }, allowed.get(target.modelName));
        }
        node.data = data;
        this.doc.endEdit(`${{ translate: "Move", rotate: "Rotate", scale: "Scale" }[mode] || "Transform"} ${targets.length} track model part${targets.length === 1 ? "" : "s"}`);
        this.doc.emit("model");
      } catch (e: any) {
        console.error("Could not move selected model parts:", e?.message || e);
        if (this.doc.pending) this.doc.cancelEdit();
        for (const target of targets) {
          const attr = target.mesh?.geometry?.attributes.position;
          if (attr) { attr.array.set(target.originalPositions); attr.needsUpdate = true; }
        }
        this.viewport.showGeometrySelection();
        this.viewport.updateGizmo();
        toast.error("Could not move this model part", { description: e.message });
      }
    });
    vp.on("context", (e: any) => {
      this.contextMenuAt = { x: e.x, y: e.y };
      this.bump("ui");
    });
    this.applyViewSettings();
    void this.loadSettings().finally(() => {
      void this.refreshTrackFiles();
      if (!this.trackRefreshTimer) this.trackRefreshTimer = setInterval(() => void this.refreshTrackFiles(), 2000);
    });
    this.watchWindowState();
  }
  contextMenuAt: { x: number; y: number } | null = null;

  // ---- Settings -------------------------------------------------------------------------
  async loadSettings() {
    try {
      const s = await api.getSettings();
      for (const key of PERSISTED) if (s[key] !== undefined) (this.settings as any)[key] = s[key];
      this.settings.favoriteObjects = Array.isArray(s.favoriteObjects) ? s.favoriteObjects.filter((id: unknown) => Number.isInteger(id) && (id as number) >= 0) : [];
      this.settings.favoriteModelSources = Array.isArray(s.favoriteModelSources) ? s.favoriteModelSources.filter((key: unknown) => typeof key === "string") : [];
      this.settings.favoriteModelParts = Array.isArray(s.favoriteModelParts) ? s.favoriteModelParts.filter((key: unknown) => typeof key === "string") : [];
      this.settings.recent = s.recent || [];
      if (s.riivolutionXml) {
        try { this.riivolutionWorkspace = await this.readRiivolutionWorkspace(s.riivolutionXml); }
        catch (error) { console.warn("Riivolution workspace unavailable", error); }
        if (!this.riivolutionWorkspace) { this.settings.workspace = ""; this.settings.riivolutionXml = ""; }
      }
      applyUiFont(this.settings.uiFont);
      if (s.objectNames) this.objectNames = { ...BUILTIN_OBJECTS, ...Object.fromEntries(Object.entries(s.objectNames).map(([k, v]) => [Number(k), v as string])) };
      if (s.objectDocumentation && Object.keys(s.objectDocumentation).length) {
        try { this.importedObjectDocumentation = parseObjectDocumentation({ version: 1, objects: s.objectDocumentation }); }
        catch (error) { console.warn("Object documentation could not be loaded:", error); }
      }
      if (s.objectResources) this.assets.setObjectInfo(Object.fromEntries(Object.entries(s.objectResources).map(([k, v]) => [Number(k), { name: this.objectNames[Number(k)], resources: v }])));
      this.applyViewSettings();
      this.bump("settings", "doc");
      if (this.riivolutionWorkspace) {
        const common = this.workspacePath("Race", "Common.szs");
        const manual = s.commonPath && s.commonPath.toLowerCase() !== common?.toLowerCase();
        const loaded = manual && await this.loadCommonFrom(s.commonPath, true);
        if (!loaded && common && await api.exists(common)) await this.loadCommonFrom(common, true);
      } else if (s.workspace && !s.commonPath && this.workspacePath("Race", "Common.szs")) await this.loadCommonFrom(this.workspacePath("Race", "Common.szs"), true);
      else if (s.commonPath) { this.commonPath = s.commonPath; await this.loadCommonFrom(s.commonPath, true); }
      this.loadLibrary();
      this.refreshWorkspaceInfo();
      if (!s.tourDone) setTimeout(() => { this.tourActive = true; this.bump("ui"); }, 700);
      if (startupFile) this.openPath(startupFile);
    } catch (e) {
      console.warn("Settings not loaded", e);
    }
  }

  saveSettings(patch: Record<string, unknown>) {
    this.settingsSave = this.settingsSave.then(() => api.saveSettings(patch)).catch((e: any) => console.warn("Settings not saved", e));
  }

  setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    this.settings[key] = value;
    this.saveSettings({ [key]: value });
    if (key === "uiFont") applyUiFont(this.settings.uiFont);
    if (VIEW_SETTINGS.has(key)) this.applyViewSettings();
    this.bump("settings");
  }

  setSettings(patch: Partial<Settings>) {
    Object.assign(this.settings, patch);
    this.saveSettings(patch as any);
    if ("uiFont" in patch) applyUiFont(this.settings.uiFont);
    if (Object.keys(patch).some((key) => VIEW_SETTINGS.has(key as keyof Settings))) this.applyViewSettings();
    this.bump("settings");
  }

  resetSettings() {
    this.setSettings({ ...DEFAULT_SETTINGS });
    toast.success("Settings reset to defaults");
  }

  toggleFavoriteObject(id: number) {
    const current = this.settings.favoriteObjects;
    this.setSetting("favoriteObjects", current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  toggleFavoriteModelSource(key: string) {
    const current = this.settings.favoriteModelSources;
    this.setSetting("favoriteModelSources", current.includes(key) ? current.filter((value) => value !== key) : [...current, key]);
  }

  toggleFavoriteModelPart(key: string) {
    const current = this.settings.favoriteModelParts;
    this.setSetting("favoriteModelParts", current.includes(key) ? current.filter((value) => value !== key) : [...current, key]);
  }

  applyViewSettings() {
    const s = this.settings, vp = this.viewport;
    if (!vp) return;
    const modelsChanged = vp.modelMode !== s.modelMode || vp.showLabels !== s.showLabels || vp.iconSize !== s.iconSize;
    vp.iconSize = s.iconSize;
    vp.modelMode = s.modelMode;
    vp.displayMode = s.displayMode;
    vp.modelEditingEnabled = s.modelEditing;
    vp.smartAlignment = s.smartAlignment;
    if (vp.layers.GRID === s.hideGrid) { vp.layers.GRID = !s.hideGrid; vp.grid.visible = !s.hideGrid; vp.needsRender = true; }
    if (!s.modelEditing && vp.geometrySelection?.type === "model") vp.selectGeometry(null);
    vp.animations = s.animations;
    vp.showLabels = s.showLabels;
    if (vp.effects.enabled !== s.showEffects) { vp.effects.setEnabled(s.showEffects); vp.needsRender = true; }
    if (vp.selectionBox !== s.selectionBox) { vp.selectionBox = s.selectionBox; vp.clearCache(); vp.showGeometrySelection(); }
    if (vp.showAreaVolumes !== s.showAreaVolumes) { vp.showAreaVolumes = s.showAreaVolumes; vp.scheduleRebuild(); }
    if (vp.areaOutlinesThroughWalls !== s.areaOutlinesThroughWalls) { vp.areaOutlinesThroughWalls = s.areaOutlinesThroughWalls; vp.scheduleRebuild(); }
    vp.flySpeed = s.flySpeed;
    vp.lookSensitivity = s.lookSensitivity;
    vp.hideCursorWhileLooking = s.hideCursorWhileLooking;
    vp.updateCursor();
    vp.renderer.setPixelRatio(s.quality === "low" ? 0.75 : s.quality === "medium" ? 1 : Math.min(window.devicePixelRatio, 2));
    vp.resize();
    if (modelsChanged) vp.clearCache();
    vp.applyDisplayMode();
  }

  finishTour() {
    this.tourActive = false;
    this.saveSettings({ tourDone: true });
    this.bump("ui");
  }

  addRecent(path: string | null) {
    if (!path) return;
    this.settings.recent = [path, ...this.settings.recent.filter((p) => p !== path)].slice(0, 10);
    this.saveSettings({ recent: this.settings.recent });
    this.bump("settings");
  }

  objectLabel(id: number) {
    const name = this.objectNames[id];
    return this.getObjectDocumentation(id).label || (OBJECT_INFO as any)[name]?.label || name || `Object ${hex(id)}`;
  }

  getObjectDocumentation(id: number) {
    return objectDocumentation(id, this.objectNames[id] || "", this.importedObjectDocumentation);
  }

  async importObjectDocumentation() {
    const file = await api.openFile(FILTERS.json, "Import object documentation");
    if (!file) return;
    try {
      if (file.data.length > 2_000_000) throw new Error("The JSON file is larger than 2 MB");
      const imported = parseObjectDocumentation(JSON.parse(new TextDecoder().decode(file.data)));
      this.importedObjectDocumentation = { ...this.importedObjectDocumentation, ...imported };
      this.saveSettings({ objectDocumentation: this.importedObjectDocumentation });
      this.bump("settings", "doc");
      toast.success(`${Object.keys(imported).length} object documentation entries imported`, { description: "Descriptions and setting labels are available immediately and remembered for the next launch." });
    } catch (error: any) { toast.error("Could not import documentation", { description: error.message }); }
  }

  async clearImportedObjectDocumentation() {
    if (!Object.keys(this.importedObjectDocumentation).length) return;
    if (!(await dialogs.confirm({ title: "Remove imported object documentation?", description: "Built-in object descriptions stay available.", confirmLabel: "Remove", destructive: true }))) return;
    this.importedObjectDocumentation = {};
    this.saveSettings({ objectDocumentation: {} });
    this.bump("settings", "doc");
  }

  // ---- UI state -------------------------------------------------------------------------
  setTab(tab: string) {
    this.tab = tab;
    const vp = this.viewport;
    if (vp && vp.collisionFocus !== (tab === "collision")) { vp.collisionFocus = tab === "collision"; vp.applyDisplayMode(); }
    this.bump("ui");
    if (tab === "validate") this.runValidate();
  }
  setMap2D(active: boolean) {
    if (this.map2D === active) return;
    this.stopTool();
    this.map2D = active;
    this.bump("ui");
    if (!active) this.viewport?.resize();
  }
  setHint(text: string) { this.hint = text; this.bump("ui"); }
  async withBusy<T>(text: string, fn: () => Promise<T>): Promise<T> {
    this.busy = text;
    this.bump("ui");
    await new Promise((r) => setTimeout(r, 30));
    try { return await fn(); } finally { this.busy = null; this.bump("ui"); }
  }

  get isEmpty() {
    const d = this.doc;
    return !d.kcl && d.fileKind === "new" && !d.kmp.KTPT.length && !d.kmp.GOBJ.length && !d.kmp.ENPT.length;
  }

  scheduleValidate() {
    clearTimeout(this.validateTimer);
    this.validateTimer = setTimeout(() => this.runValidate(), 400);
  }

  runValidate() {
    try { this.issues = validate(this.doc, this.ops, this.objectNames); } catch (e: any) { this.issues = [{ level: "error", msg: "Validator failed: " + e.message }]; }
    const order: Record<string, number> = { error: 0, warning: 1, info: 2 };
    this.issues.sort((a, b) => order[a.level] - order[b.level]);
    this.bump("ui");
  }

  // ---- Files ----------------------------------------------------------------------------
  async confirmDiscard() {
    if (!this.doc.dirty) return true;
    return dialogs.confirm({ title: "Unsaved changes", description: `"${this.doc.fileName}" has unsaved changes. Discard them?`, confirmLabel: "Discard changes", destructive: true });
  }

  openAssetEditor(options: { category?: "characters" | "objects" | "courses"; archive?: string; resource?: string; loose?: LooseFile } = {}) {
    return dialogs.open("assetEditor", { initialCategory: options.category, initialArchive: options.archive, initialResource: options.resource, looseFile: options.loose });
  }

  // Writes a file opened on its own back where it came from (Save as when it has no path yet).
  // Returns the path written, or null when cancelled.
  async writeLoose(path: string | null, name: string, data: Uint8Array) {
    const target = path || await api.chooseSavePath(name, [{ name: name.split(".").pop()!.toUpperCase(), extensions: [name.split(".").pop()!] }], `Save ${name}`);
    if (!target) return null;
    const result = await api.writeFile(target, data, { backup: this.settings.keepBackups, edited: true });
    toast.success(`${target.split(/[\\/]/).pop()} saved`, { description: result?.backup ? "The original is kept as a .bak file." : undefined });
    this.addRecent(hasBackend ? target : null);
    return target;
  }

  // Opens a model, text, effect, parameter, music or Riivolution file in its editor. The open track
  // (if any) stays as it is.
  async openLooseFile(file: LooseFile, kind: LooseKind) {
    this.addRecent(file.path);
    switch (kind) {
      case "model": return this.openAssetEditor({ category: "courses", loose: file });
      case "text": return dialogs.open("gameText", { loose: file });
      case "riivolution": return dialogs.open("riivolution", { initialFile: file });
      case "music": case "sounds":
        if (!file.path) return toast.info(`Open ${file.name} with File › Open`, { description: "Music is played and saved from its file on disk." });
        return dialogs.open("audio", { file: file.path });
      case "effect": case "params": {
        // A one-file archive in memory, so the archive editors work on it unchanged. An effect
        // also gets its other half (.breff with .breft) when it sits next to it.
        const files: LooseFile[] = [file];
        if (kind === "effect" && file.path) {
          const other = file.path.replace(/\.(breff|breft)$/i, (_m, ext: string) => ext.toLowerCase() === "breff" ? ".breft" : ".breff");
          if (other !== file.path && hasBackend && await api.exists(other)) files.push(await api.readPath(other));
        }
        const tree = newSzsTree();
        for (const f of files) setFilePath(tree, f.name, f.data);
        const saved = new Map(files.map((f) => [f.name, f.data]));
        const paths = new Map(files.map((f) => [f.name, f.path]));
        const onSave = async () => {
          for (const f of listFiles(tree)) {
            if (saved.get(f.path) === f.node.data) continue;
            const written = await this.writeLoose(paths.get(f.path) ?? null, f.path, f.node.data);
            if (!written) return false;
            saved.set(f.path, f.node.data);
            paths.set(f.path, written);
          }
          return true;
        };
        const onChange = (path: string, data: Uint8Array) => { const target = listFiles(tree).find((f: any) => f.path === path); if (target) target.node.data = data; };
        return dialogs.open(kind === "effect" ? "effects" : "params", { tree, archiveName: file.name, initialPath: file.name, onChange, onSave });
      }
    }
  }

  openObjectAppearance(objectId: number) {
    return dialogs.open("objectAppearance", { objectId });
  }

  // "Characters and models" on the Track objects tab with the open track, at an object's own BRRES.
  openTrackObjects(objectId: number | null = null) {
    const names: string[] = objectId == null ? [] : this.assets?.resourceNames(objectId) || [];
    const local = this.doc.szs && names.length ? listFiles(this.doc.szs).find((file: any) =>
      names.some((name) => file.path.toLowerCase().endsWith(`${name}.brres`.toLowerCase()))) : null;
    return this.openAssetEditor({ category: "courses", archive: "$open-track", resource: local?.path });
  }

  openSelectedAssetEditor() {
    if (this.geometrySelection?.type === "model") {
      return this.openAssetEditor({ category: "courses", archive: "$open-track", resource: "course_model.brres" });
    }
    const selected = this.doc.primary;
    if (selected?.kind !== "GOBJ") return this.openAssetEditor();
    const names = this.assets?.resourceNames(selected.item.objectId) || [];
    const findResource = (tree: any) => tree && listFiles(tree).find((file: any) => names.some((name: string) => file.path.toLowerCase().endsWith(`${name}.brres`.toLowerCase())));
    const local = findResource(this.doc.szs);
    if (local) return this.openAssetEditor({ category: "courses", archive: "$open-track", resource: local.path });
    const common = findResource(this.assets?.common);
    if (common) return this.openAssetEditor({ category: "objects", archive: this.workspacePath("Race", "Common.szs"), resource: common.path });
    return this.openAssetEditor({ category: "courses" });
  }

  showHome() {
    if (this.intro) this.stopIntro();
    this.homeVisible = true;
    this.bump("ui");
  }

  enterEditor() {
    if (this.isEmpty) return;
    this.homeVisible = false;
    this.bump("ui");
    if (this.hasWindowControls && !this.maximized) void this.windowAction("maximize");
  }

  async closeTrack() {
    if (this.isEmpty || !(await this.confirmDiscard())) return;
    if (this.intro) this.stopIntro();
    this.viewport?.setTool(null);
    this.viewport?.selectGeometry(null);
    this.doc.reset();
    this.doc.loaded();
    await this.assets?.setTrack(null);
    this.homeVisible = true;
    this.bump("ui");
  }

  async openPath(path: string) {
    try {
      await this.loadFile(await api.readPath(path));
    } catch (e: any) {
      toast.error(`Could not open ${path}`, { description: e.message });
      this.settings.recent = this.settings.recent.filter((p) => p !== path);
      this.saveSettings({ recent: this.settings.recent });
      this.bump("settings");
    }
  }

  // Opens an archive (no track editing) in the archive window, optionally straight in one tool.
  async openArchiveWindow(path: string, initialTool?: "params") {
    try {
      const file = await api.readPath(path);
      const bytes = await api.decodeArchiveBytes(file.data, path, this.commonPath || this.partsFolder());
      if (!isU8(bytes)) throw new Error("Not an SZS archive");
      await dialogs.open("archive", { path, name: file.name, tree: parseU8(bytes), compressed: !isU8(file.data), initialTool });
    } catch (e: any) { toast.error(`Could not open ${path}`, { description: e.message }); }
  }

  async loadFile({ path, name, data }: { path: string | null; name: string; data: Uint8Array }) {
    // Archives without a track open in their own window and leave the open track alone.
    const quick = (() => { try { return isYaz0(data) ? yaz0Decompress(data) : isU8(data) ? data : null; } catch { return null; } })();
    // So do models, game text, effects, parameters, music and Riivolution files.
    const loose = !(quick && isU8(quick)) ? looseKind(name, quick || data) : null;
    if (loose) return this.openLooseFile({ path, name, data: quick || data }, loose);
    const archiveOnly = !!quick && isU8(quick) && (() => { const t = parseU8(quick); return !["course.kmp", "course.kcl", "course_model.brres"].some((f) => findFile(t, f)); })();
    if (!archiveOnly && !(await this.confirmDiscard())) return;
    const d = this.doc;
    // An archive without a track (menus, characters, effects…) opens in the archive window instead.
    let archive: { path: string | null; name: string; tree: any; compressed: boolean } | null = null;
    await this.withBusy(`Opening ${name}…`, async () => {
      try {
        let bytes = data;
        bytes = await api.decodeArchiveBytes(bytes, path, this.commonPath || this.partsFolder());
        const tree = isU8(bytes) ? parseU8(bytes) : null;
        if (tree && !["course.kmp", "course.kcl", "course_model.brres"].some((file) => findFile(tree, file))) {
          archive = { path, name, tree, compressed: !isU8(data) };
          return;
        }
        d.reset();
        if (tree) {
          d.szs = tree;
          d.fileKind = "szs";
          const kmp = findFile(d.szs, "course.kmp");
          const kcl = findFile(d.szs, "course.kcl");
          if (kmp) d.kmp = parseKMP(kmp.data);
          else toast.warning("This SZS has no course.kmp: an empty one will be created.");
          if (kcl) d.kcl = parseKCL(kcl.data);
        } else if (String.fromCharCode(...bytes.slice(0, 4)) === "RKMD") {
          d.kmp = parseKMP(bytes);
          d.fileKind = "kmp";
        } else if (/\.kcl$/i.test(name) || bytes.length > 0x3c) {
          d.kcl = parseKCL(bytes);
          d.fileKind = "kcl";
        } else throw new Error("Unknown file format");
        d.filePath = path;
        d.fileName = name;
        d.loaded();
        this.enterEditor();
        this.addRecent(path);
        this.loadTrackAssets();
        const k = d.kmp;
        toast.success(`Opened ${name}`, { description: `${k.GOBJ.length} objects · ${k.CKPT.reduce((s: number, g: any) => s + g.points.length, 0)} checkpoints${d.kcl ? ` · ${d.kcl.count.toLocaleString()} collision triangles` : ""}` });
      } catch (e: any) {
        console.error(e);
        d.reset();
        d.loaded();
        this.showHome();
        dialogs.alert({ title: "Could not open the file", description: `${name}: ${e.message}` });
      }
    });
    if (archive) {
      this.addRecent(path);
      await dialogs.open("archive", archive);
    }
  }

  async loadTrackAssets() {
    const d = this.doc;
    if (!this.assets) return;
    if (!d.szs) { this.assets.setTrack(null); return; }
    this.setHint("Loading 3D models…");
    try {
      const res = await this.assets.setTrack(d.szs);
      this.setHint(res.course ? "" : "This archive has no course_model.brres: showing the collision.");
      if (res.course) this.viewport.frameAll(true);
    } catch (e) {
      console.error(e);
      this.setHint("Could not load the 3D models of this track.");
    }
    this.bump("doc");
  }

  kclBytes() {
    const d = this.doc, k = d.kcl;
    if (!k) return null;
    if (d.kclGeometryChanged || !k.raw) return buildKCL(k.verts, k.flags);
    return patchKCLFlags(k);
  }

  afterKclSaved(bytes: Uint8Array) {
    const d = this.doc;
    if (d.kclGeometryChanged || !d.kcl.raw) {
      d.kclGeometryChanged = false;
      d.setKCL(parseKCL(bytes), false);
    } else d.kcl.raw = bytes;
    d.kclFlagsChanged = false;
  }

  async save(saveAs = false) {
    const d = this.doc;
    let path = d.filePath;
    let kind = d.fileKind;
    if (saveAs || !path || kind === "new" || /\.(wu8|wlz|wbz)$/i.test(path)) {
      const filters = kind === "kmp" ? FILTERS.kmp : kind === "kcl" ? FILTERS.kcl : [...FILTERS.szs, ...FILTERS.kmp, ...FILTERS.kcl];
      const def = d.fileName.replace(/\.(szs|wlz|wbz|wu8|kmp|kcl)$/i, "") + (kind === "kmp" ? ".kmp" : kind === "kcl" ? ".kcl" : ".szs");
      path = await api.chooseSavePath(d.filePath ? d.filePath.replace(/[^\\/]+$/, def) : def, filters, "Save track as");
      if (!path) return false;
      if (!/\.(szs|kmp|kcl)$/i.test(path)) path += ".szs";
      kind = path.match(/\.(szs|kmp|kcl)$/i)[1].toLowerCase();
    }
    return this.withBusy("Saving…", async () => {
      try {
        let result: any;
        let written: Uint8Array;
        if (kind === "szs") {
          if (!d.szs) d.szs = newSzsTree();
          const copied = await this.copyLibraryObjects();
          if (copied.length) toast.info(`${copied.length} object file${copied.length > 1 ? "s" : ""} copied from the tracks folder`, { description: copied.slice(0, 6).join(", ") + (copied.length > 6 ? "…" : ""), duration: 9000 });
          setFile(d.szs, "course.kmp", buildKMP(d.kmp));
          const kcl = this.kclBytes();
          if (kcl) { setFile(d.szs, "course.kcl", kcl); this.afterKclSaved(kcl); }
          const missing = ["course_model.brres", "vrcorn_model.brres"].filter((f) => !findFile(d.szs, f));
          written = buildU8(d.szs);
          result = await api.writeFile(path, written, { backup: this.settings.keepBackups, edited: true, compress: "yaz0" });
          if (missing.length) toast.warning(`The SZS has no ${missing.join(" / ")}`, { description: "The game needs them: add them with File › SZS contents.", duration: 9000 });
        } else if (kind === "kmp") {
          written = buildKMP(d.kmp);
          result = await api.writeFile(path, written, { backup: this.settings.keepBackups, edited: true });
        } else {
          const kcl = this.kclBytes();
          if (!kcl) throw new Error("There is no collision to save");
          written = kcl;
          result = await api.writeFile(path, kcl, { backup: this.settings.keepBackups, edited: true });
          this.afterKclSaved(kcl);
        }
        if (hasBackend) {
          const disk = (await api.readPath(path)).data;
          const actual = kind === "szs" ? (isYaz0(disk) ? yaz0Decompress(disk) : null) : disk;
          if (!actual || !sameBytes(actual, written)) throw new Error(`The saved file could not be verified: ${path}`);
        }
        d.filePath = hasBackend ? path : null;
        d.fileName = path.split(/[\\/]/).pop();
        d.fileKind = kind;
        d.dirty = false;
        this.addRecent(d.filePath);
        this.bump("doc");
        toast.success(`Saved ${d.fileName}`, { description: hasBackend ? `${path}${result?.backup ? " · Original kept as .bak" : ""}` : undefined, duration: 8000 });
        return true;
      } catch (e: any) {
        console.error(e);
        dialogs.alert({ title: "Save failed", description: e.message });
        return false;
      }
    });
  }

  async exportBytes(defaultName: string, filters: any, bytes: Uint8Array, title: string) {
    const path = await api.chooseSavePath(this.doc.filePath ? this.doc.filePath.replace(/[^\\/]+$/, defaultName) : defaultName, filters, title);
    if (!path) return null;
    await api.writeFile(path, bytes);
    toast.success(`Exported ${path.split(/[\\/]/).pop()}`);
    return path;
  }

  modelSource(partIndex: number, pieceIndex: number) {
    const brres = this.doc.szs && this.assets?.brres(this.doc.szs, "course_model.brres");
    const model = brres && mainModel(brres, "course");
    const part = model?.objects[partIndex], piece = part && polygonPieces(part).pieces[pieceIndex];
    if (!model || !part || !piece) return null;
    return { modelName: model.name, partName: part.name, triangles: [...piece.triangles] as number[],
      center: piece.min.map((v: number, i: number) => (v + piece.max[i]) / 2),
      size: piece.min.map((v: number, i: number) => piece.max[i] - v) };
  }

  selectedModelTextures() {
    const s = this.geometrySelection;
    if (s?.type !== "model" || !this.doc.szs) return [];
    const brres = this.assets?.brres(this.doc.szs, "course_model.brres");
    const model = brres && mainModel(brres, "course");
    const draw = model?.draws.find((d: any) => d.object === s.partIndex);
    const mat = draw && model.materials[draw.material];
    return (mat?.layers || []).map((l: any) => brres.textures.get(l.texture)).filter(Boolean);
  }

  previewSelectedTexture(textureName: string, rgba: Uint8Array | Uint8ClampedArray) {
    return this.viewport?.previewCourseTexture(textureName, rgba) ?? false;
  }

  commitSelectedTexture(textureName: string, rgba: Uint8Array | Uint8ClampedArray) {
    const node = this.doc.szs && findFile(this.doc.szs, "course_model.brres");
    if (!node) return false;
    try {
      const next = replaceBRRESTexture(node.data, textureName, rgba);
      this.doc.change(`Paint texture ${textureName}`, () => { node.data = next; }, { structural: false });
      this.doc.emit("model");
      return true;
    } catch (e: any) {
      toast.error("Could not save the texture", { description: e.message });
      return false;
    }
  }

  async replaceSelectedTexture(textureName: string) {
    const node = this.doc.szs && findFile(this.doc.szs, "course_model.brres");
    const tex = this.selectedModelTextures().find((t: any) => t.name === textureName);
    if (!node || !tex) return toast.error("Select a track model texture first");
    const file = await api.openFile(FILTERS.png, `Choose PNG for ${textureName}`);
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(new Blob([file.data], { type: "image/png" }));
      const canvas = document.createElement("canvas");
      canvas.width = tex.width; canvas.height = tex.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("Canvas is unavailable");
      ctx.drawImage(bitmap, 0, 0, tex.width, tex.height);
      bitmap.close();
      const rgba = ctx.getImageData(0, 0, tex.width, tex.height).data;
      const next = replaceBRRESTexture(node.data, textureName, rgba);
      this.doc.change(`Replace texture ${textureName}`, () => { node.data = next; }, { structural: false });
      this.doc.emit("model");
      toast.success(`Texture ${textureName} replaced`, { description: "The PNG is stored in course_model.brres. Save the SZS to keep it." });
    } catch (e: any) { toast.error("Could not replace the texture", { description: e.message }); }
  }

  // GOBJ resources can live in the course archive, Common.szs, or the model library.
  // Editing always writes a course-local BRRES, so other tracks keep their appearance.
  objectAppearanceResources(objectId: number) {
    const assets = this.assets;
    if (!assets || !this.doc.szs) return [];
    return (assets.resourceNames(objectId) as string[]).map((name: string) => {
      const file = `${name}.brres`;
      const candidates = [["track", this.doc.szs], ["common", assets.common], ["library", assets.libraryTree]] as const;
      for (const [source, tree] of candidates) {
        if (!tree) continue;
        const found = listFiles(tree).find((f: any) => f.path.toLowerCase() === file.toLowerCase() || f.path.toLowerCase().endsWith(`/${file.toLowerCase()}`));
        if (found) {
          let parsed: any = null;
          try { parsed = parseBRRES(found.node.data); } catch { /* Show the file so it can be replaced. */ }
          return { name, path: source === "track" ? found.path : file, source, data: found.node.data, textures: parsed ? [...parsed.textures.values()] : [], models: parsed?.models.map((m: any) => m.name) || [] };
        }
      }
      return { name, path: file, source: assets.library?.find(name) ? "library-pending" : "missing", data: null, textures: [], models: [] };
    });
  }

  async replaceObjectModel(objectId: number, resourceName: string) {
    const resource = this.objectAppearanceResources(objectId).find((r: any) => r.name === resourceName);
    if (!resource) return toast.error("This object has no known BRRES resource");
    const file = await api.openFile(FILTERS.brres, `Choose ${resourceName}.brres`);
    if (!file) return;
    try {
      if (!isBRRES(file.data)) throw new Error("This is not a BRRES archive");
      const incoming = parseBRRES(file.data);
      const required = resource.models.length ? resource.models : resource.data ? [] : [resourceName];
      const missing = required.filter((name: string) => !incoming.models.some((m: any) => m.name === name));
      if (missing.length) throw new Error(`Missing model(s): ${missing.join(", ")}. Keep the original model names for the game.`);
      this.doc.changeArchiveFile(`Replace ${resourceName} appearance`, resource.path, file.data);
      toast.success(`${resourceName} updated in this track`, { description: "Save the course SZS to keep the change." });
    } catch (e: any) { toast.error("Could not replace the object model", { description: e.message }); }
  }

  async replaceObjectTexture(objectId: number, resourceName: string, textureName: string) {
    const resource = this.objectAppearanceResources(objectId).find((r: any) => r.name === resourceName);
    const tex = resource?.textures.find((t: any) => t.name === textureName);
    if (!resource?.data || !tex) return toast.error("Object texture unavailable");
    const file = await api.openFile(FILTERS.png, `Choose PNG for ${textureName}`);
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(new Blob([file.data], { type: "image/png" }));
      const canvas = document.createElement("canvas");
      canvas.width = tex.width; canvas.height = tex.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("Canvas is unavailable");
      ctx.drawImage(bitmap, 0, 0, tex.width, tex.height);
      bitmap.close();
      const next = replaceBRRESTexture(resource.data, textureName, ctx.getImageData(0, 0, tex.width, tex.height).data);
      this.doc.changeArchiveFile(`Replace ${resourceName} texture ${textureName}`, resource.path, next);
      toast.success(`${textureName} updated in this track`, { description: "Save the course SZS to keep the change." });
    } catch (e: any) { toast.error("Could not replace the object texture", { description: e.message }); }
  }

  commitObjectTexture(objectId: number, resourceName: string, textureName: string, rgba: Uint8ClampedArray) {
    const resource = this.objectAppearanceResources(objectId).find((r: any) => r.name === resourceName);
    if (!resource?.data) return false;
    try {
      const next = replaceBRRESTexture(resource.data, textureName, rgba);
      this.doc.changeArchiveFile(`Paint ${resourceName} texture ${textureName}`, resource.path, next);
      return true;
    } catch (e: any) {
      toast.error("Could not paint the object texture", { description: e.message });
      return false;
    }
  }

  // Painted textures, applied when the painter's Save is pressed (one undo step per save).
  saveCourseModelBytes(textureName: string, bytes: Uint8Array) {
    const node = this.doc.szs && findFile(this.doc.szs, "course_model.brres");
    if (!node) return false;
    this.doc.change(`Paint texture ${textureName}`, () => { node.data = bytes; }, { structural: false });
    this.doc.emit("model");
    return true;
  }

  saveObjectResourceBytes(objectId: number, resourceName: string, textureName: string, bytes: Uint8Array) {
    const resource = this.objectAppearanceResources(objectId).find((r: any) => r.name === resourceName);
    if (!resource) return false;
    this.doc.changeArchiveFile(`Paint ${resourceName} texture ${textureName}`, resource.path, bytes);
    return true;
  }

  saveSkyBytes(textureName: string, bytes: Uint8Array) {
    const sky = this.skyResource();
    if (!sky) return false;
    this.doc.changeArchiveFile(`Paint sky texture ${textureName}`, sky.path, bytes);
    return true;
  }

  // ---- Sky (vrcorn_model.brres of the open track) ----------------------------------------------
  skyResource() {
    const found = this.doc.szs && listFiles(this.doc.szs).find((f: any) => /(^|\/)vrcorn_model\.brres$/i.test(f.path));
    if (!found) return null;
    let parsed: any = null;
    try { parsed = parseBRRES(found.node.data); } catch { /* Still listed so it can be replaced. */ }
    return { path: found.path, data: found.node.data as Uint8Array, parsed };
  }

  previewSkyTexture(textureName: string, rgba: Uint8Array | Uint8ClampedArray) {
    return this.viewport?.previewSkyTexture(textureName, rgba) ?? false;
  }

  commitSkyTexture(textureName: string, rgba: Uint8ClampedArray) {
    const sky = this.skyResource();
    if (!sky) return false;
    try {
      this.doc.changeArchiveFile(`Paint sky texture ${textureName}`, sky.path, replaceBRRESTexture(sky.data, textureName, rgba));
      return true;
    } catch (e: any) {
      toast.error("Could not paint the sky texture", { description: e.message });
      return false;
    }
  }

  // A sky from another track or a BRRES made elsewhere. The game draws the model named "vrcorn".
  async replaceSkyModel() {
    if (!this.doc.szs) return toast.error("Open a track archive first");
    const file = await api.openFile(FILTERS.brres, "Choose the sky BRRES (vrcorn_model.brres)");
    if (!file) return;
    try {
      if (!isBRRES(file.data)) throw new Error("This is not a BRRES archive");
      const models = parseBRRES(file.data).models.map((m: any) => m.name);
      if (!models.includes("vrcorn")) throw new Error(`The game needs a model named "vrcorn" (this BRRES has ${models.join(", ") || "no models"}).`);
      this.doc.changeArchiveFile("Replace sky", this.skyResource()?.path || "vrcorn_model.brres", file.data);
      toast.success("Sky replaced", { description: "Save the course SZS to keep it." });
    } catch (e: any) { toast.error("Could not replace the sky", { description: e.message }); }
  }

  copySelectedModel() {
    const s = this.geometrySelection;
    if (s?.type !== "model") return false;
    const source = this.modelSource(s.partIndex, s.pieceIndex);
    if (!source) return false;
    this.modelClipboard = source;
    this.lastClipboard = "model";
    toast.success(`Copied ${s.name}`, { duration: 1500 });
    this.bump("ui");
    return true;
  }

  copyElements() {
    const entries = this.ops.copySelection();
    if (!entries.length) { toast.warning("Select something to copy"); return false; }
    this.kmpClipboard = entries;
    this.lastClipboard = "kmp";
    toast.success(`Copied ${entries.length} element${entries.length > 1 ? "s" : ""}`, { duration: 1500 });
    this.bump("ui");
    return true;
  }

  // Pastes the copied elements under the mouse on the 2D map, or around the point the 3D view
  // orbits. Heights follow the ground between the two places.
  pasteElements() {
    const entries = this.kmpClipboard;
    if (!entries?.length) return toast.warning("Copy something first (Ctrl+C)");
    const center = copiesCenter(entries);
    if (!center) return;
    let target: number[] | null;
    if (this.map2D) {
      const v = this.map2DView, at = this.map2DPointer ?? [v.cx, v.cz];
      target = [at[0], 0, at[1]];
    } else target = this.viewport?.viewCenterPoint() ?? null;
    if (!target?.every(Number.isFinite)) target = [center[0], 0, center[2]];
    const delta = [target[0] - center[0], 0, target[2] - center[2]];
    // Pasting on top of the originals would look like nothing happened.
    const minimum = this.map2D ? 24 / this.map2DView.scale : (this.settings.iconSize || 150) * 2;
    if (Math.hypot(delta[0], delta[2]) < minimum) { delta[0] += minimum * 2; delta[2] += minimum * 2; }
    const h = this.doc.heights;
    if (h) {
      const from = h.heightAt(center[0], center[2], center[1]), to = h.heightAt(center[0] + delta[0], center[2] + delta[2], center[1]);
      if (from !== null && to !== null) delta[1] = to - from;
    }
    const n = this.ops.pasteCopies(entries, delta, "Paste");
    if (n) toast(`Pasted ${n} element${n > 1 ? "s" : ""}`, { duration: 1500 });
  }

  async addModelFromPart(partIndex: number, pieceIndex = 0) {
    const source = this.modelSource(partIndex, pieceIndex);
    if (source) await this.pasteModel(source, true);
  }

  // Mario's kart for start positions, from the game folder next to Common.szs (Race/Kart).
  loadKartModel() {
    const race = this.commonPath?.replace(/[\\/][^\\/]+$/, "") || this.settings.partsFolder?.replace(/[\\/][^\\/]+$/, "");
    if (!race || !hasBackend) return;
    this.assets?.loadKart(async (p: string) => api.decodeArchiveBytes((await api.readPath(p)).data, p, this.commonPath || ""), race).then(() => this.bump("doc"));
  }

  // ---- Workspace: the extracted game's "files" folder ---------------------------------------------
  // Everything else is found inside it: Race/Common.szs (objects), Race/Course (tracks and model
  // parts), Scene/UI (game text and menu screens) and sound (music and sound effects).
  riivolutionWorkspace: any = null;
  async readRiivolutionWorkspace(path: string) {
    const file = await api.readPath(path);
    return findRiivolutionWorkspace(path, new TextDecoder().decode(file.data), {
      exists: api.exists, listDir: api.listDir, join: winPath, parse: parseRiivolution, externalPath,
    });
  }
  workspace() {
    if (this.settings.workspace) return this.settings.workspace;
    // Older settings: the folder above Race/Common.szs.
    return this.commonPath ? this.commonPath.replace(/[\\/][^\\/]+[\\/][^\\/]+$/, "") : "";
  }
  workspacePath(...parts: string[]) {
    if (this.riivolutionWorkspace) return resolveRiivolutionPath(this.riivolutionWorkspace, parts, winPath);
    const root = this.workspace();
    return root ? winPath(root, ...parts) : "";
  }
  workspaceInfo: { common: boolean; tracks: number; ui: boolean; music: number; soundArchive: boolean } | null = null;

  async refreshWorkspaceInfo() {
    const root = this.workspace();
    if (!root || !hasBackend) { this.workspaceInfo = null; this.bump("settings"); return; }
    const count = (path: string, ext: string[]) => path ? api.listDir(path, ext).then((l: string[]) => l.length).catch(() => 0) : Promise.resolve(0);
    const [common, tracks, ui, music, soundArchive] = await Promise.all([
      api.exists(this.workspacePath("Race", "Common.szs")), count(this.workspacePath("Race", "Course"), ["szs"]),
      count(this.workspacePath("Scene", "UI"), ["szs"]).then((n: number) => n > 0), count(this.workspacePath("sound", "strm"), ["brstm"]),
      api.exists(this.workspacePath("sound", "revo_kart.brsar")),
    ]);
    this.workspaceInfo = { common, tracks, ui, music, soundArchive };
    this.bump("settings");
  }

  async useWorkspaceCommon(path: string) {
    if (!path || !(await api.exists(path))) return;
    if (this.assets?.common && this.commonPath?.toLowerCase() === path.toLowerCase()) return;
    if (this.assets?.common && this.commonPath && !(await dialogs.confirm({
      title: "Common.szs found in this workspace",
      description: "A different Common.szs is already loaded. Use the one from this workspace for object names and shared models?",
      confirmLabel: "Use workspace Common.szs",
      cancelLabel: "Keep current Common.szs",
    }))) return;
    if (!(await this.loadCommonFrom(path, true))) toast.error("Could not load the workspace Common.szs", { description: path });
  }

  // Sets the game folder and loads what the editor uses from it. Accepts the "files" folder
  // itself or a folder that contains it (e.g. the root of an extracted disc).
  async setWorkspace(path: string) {
    const root = await findWorkspaceRoot(path, { exists: api.exists, listDir: api.listDir, join: winPath });
    if (!root) {
      toast.error("No Mario Kart Wii files found", { description: "Choose a Riivolution XML to locate the mod files instead.", action: { label: "Open XML…", onClick: () => void this.chooseRiivolutionWorkspace() } });
      return false;
    }
    if (root === this.settings.workspace && !this.riivolutionWorkspace) {
      await this.useWorkspaceCommon(winPath(root, "Race", "Common.szs"));
      await this.refreshWorkspaceInfo();
      return true;
    }
    this.riivolutionWorkspace = null;
    this.workspaceInfo = null;
    this.trackFiles = null;
    this.setSettings({ workspace: root, riivolutionXml: "", partsFolder: "" });
    localStorage.setItem("mkwii-ui-folder", winPath(root, "Scene", "UI"));
    await this.useWorkspaceCommon(winPath(root, "Race", "Common.szs"));
    this.loadLibrary();
    await this.refreshWorkspaceInfo();
    const info = this.workspaceInfo;
    toast.success("Workspace set", { description: info ? `${info.tracks} tracks · ${info.music} music streams${this.assets?.common ? " · Common.szs loaded" : ""}${info.ui ? " · menus and game text" : ""}` : root });
    return true;
  }

  async chooseWorkspace() {
    const path = await api.chooseFolder("Choose the extracted game's files folder (with Race, Scene and sound)", this.workspace());
    if (path) await this.setWorkspace(path);
  }

  async chooseRiivolutionWorkspace() {
    const file = await api.openFile([{ name: "Riivolution XML", extensions: ["xml"] }], "Choose the Riivolution XML for the mod files");
    if (!file?.path) return;
    try {
      const workspace = await findRiivolutionWorkspace(file.path, new TextDecoder().decode(file.data), {
        exists: api.exists, listDir: api.listDir, join: winPath, parse: parseRiivolution, externalPath,
      });
      if (!workspace) throw new Error("The XML does not point to available Mario Kart Wii resources under its SD root.");
      this.riivolutionWorkspace = workspace;
      this.workspaceInfo = null;
      this.trackFiles = null;
      this.setSettings({ workspace: workspace.sdRoot, riivolutionXml: file.path, partsFolder: "" });
      const ui = this.workspacePath("Scene", "UI");
      if (ui) localStorage.setItem("mkwii-ui-folder", ui);
      const common = this.workspacePath("Race", "Common.szs");
      await this.useWorkspaceCommon(common);
      this.loadLibrary();
      await this.refreshWorkspaceInfo();
      toast.success("Riivolution workspace set", { description: file.path });
    } catch (error: any) { toast.error("Could not use this Riivolution XML", { description: error.message }); }
  }

  // Folder with the game's track archives used by the model part browser: the chosen one,
  // otherwise Race/Course of the workspace, otherwise the open track's folder.
  partsFolder() {
    if (this.settings.partsFolder) return this.settings.partsFolder;
    if (this.settings.workspace) return this.workspacePath("Race", "Course");
    if (this.commonPath) return this.commonPath.replace(/[\\/][^\\/]+$/, "") + "\\Course";
    return this.doc.filePath?.replace(/[\\/][^\\/]+$/, "") || "";
  }

  async choosePartsFolder() {
    const path = await api.chooseFolder("Choose the folder with the track .szs files (e.g. files\\Race\\Course)", this.partsFolder());
    if (path) { this.setSetting("partsFolder", path); this.trackFiles = null; void this.loadLibrary(); }
    return path;
  }

  // Listing filenames is cheap. Keep the picker current even while the model archive index
  // is still processing a large mod (which can have thousands of tracks).
  async refreshTrackFiles() {
    if (this.trackRefreshBusy || !hasBackend) return;
    const folder = this.partsFolder();
    if (!folder) { if (this.trackFiles) { this.trackFiles = null; this.bump("settings"); } return; }
    this.trackRefreshBusy = true;
    try {
      const files: string[] = await api.listDir(folder, ["szs", "wlz", "wbz", "wu8"]);
      if (this.partsFolder() !== folder) return;
      const previous = this.trackFiles;
      const changed = previous?.folder !== folder || previous.files.length !== files.length || previous.files.some((file, i) => file !== files[i]);
      if (changed) this.trackFiles = { folder, files };
      const infoChanged = !!this.workspaceInfo && folder === this.workspacePath("Race", "Course") && this.workspaceInfo.tracks !== files.length;
      if (infoChanged)
        this.workspaceInfo = { ...this.workspaceInfo, tracks: files.length };
      if (changed || infoChanged) this.bump("settings", "doc");
    } catch {
      if (this.partsFolder() === folder && this.trackFiles?.folder === folder) { this.trackFiles = null; this.bump("settings"); }
    } finally { this.trackRefreshBusy = false; }
  }

  // Indexes the object models of every track in the tracks folder, so objects whose model is
  // neither in this track nor in Common.szs (for example custom objects of modded tracks) are shown,
  // and their files are copied into this track when it is saved.
  async loadLibrary() {
    const folder = this.partsFolder();
    if (!folder || !hasBackend || !this.assets) { this.library = null; this.trackFiles = null; this.assets?.setLibrary(null); this.bump("settings"); return; }
    if (this.library?.folder !== folder) this.assets.setLibrary(null);
    this.library = { folder, tracks: 0, models: 0, loading: true };
    this.bump("settings");
    await this.refreshTrackFiles();
    try {
      const index = await api.archiveIndex(folder);
      const byName = new Map<string, any>();
      const SKIP = /^(course_model|vrcorn_model|map_model|course|course_d)$/i;
      // Single-player archives first, so the _d copies are used only for models found nowhere else.
      const archives = [...index.archives].sort((a: any, b: any) => Number(/_d\.(szs|wlz|wbz|wu8)$/i.test(a.name)) - Number(/_d\.(szs|wlz|wbz|wu8)$/i.test(b.name)));
      for (const archive of archives) {
        for (const path of archive.files) {
          const m = path.match(/^([^/]+)\.brres$/i);
          if (!m || SKIP.test(m[1]) || byName.has(m[1].toLowerCase())) continue;
          const stem = m[1].toLowerCase();
          const files = archive.files.filter((p: string) => {
            const parts = p.toLowerCase().split("/");
            return parts.length === 1 ? parts[0].replace(/\.[^.]+$/, "") === stem : parts.slice(0, -1).includes(stem);
          });
          byName.set(stem, { stem: m[1], archive: `${folder}\\${archive.name}`, archiveName: archive.name, label: trackLabel(archive.name), files });
        }
      }
      if (this.partsFolder() !== folder) return;
      this.assets.setLibrary({
        find: (name: string) => byName.get(name.toLowerCase()) || null,
        fetch: (entry: any) => Promise.all(entry.files.map(async (path: string) => ({ path, data: await api.readArchiveFile(entry.archive, path) }))),
      });
      this.library = { folder, tracks: index.archives.length, models: byName.size, loading: false };
      await this.refreshTrackFiles();
      this.viewport?.clearCache();
    } catch (e: any) {
      if (this.partsFolder() !== folder) return;
      this.library = { folder, tracks: 0, models: 0, loading: false, error: e.message };
      this.assets.setLibrary(null);
    }
    this.bump("settings", "doc");
  }

  // Before saving: copies into the SZS the files of placed objects whose model comes from another
  // track of the tracks folder, so the game finds them too.
  async copyLibraryObjects() {
    const d = this.doc, assets = this.assets, lib = assets?.library;
    if (!lib || !d.szs) return [] as string[];
    const copied: string[] = [];
    for (const id of new Set<number>(d.kmp.GOBJ.map((o: any) => o.objectId))) {
      const names: string[] = assets.resourceNames(id);
      if (names.some((n) => findFile(d.szs, `${n}.brres`) || (assets.common && findFile(assets.common, `${n}.brres`)))) continue;
      const entry = names.map((n) => lib.find(n)).find(Boolean);
      if (!entry) continue;
      for (const f of await assets.loadFromLibrary(entry)) {
        if (findFile(d.szs, f.path)) continue;
        setFilePath(d.szs, f.path, f.data);
        copied.push(`${f.path} (${entry.label})`);
      }
    }
    return copied;
  }

  // ---- Track switcher (tracks folder) ---------------------------------------------------
  currentTrackFile() {
    const t = this.trackFiles, path = this.doc.filePath;
    if (!t || !path) return null;
    const dir = path.replace(/[\\/][^\\/]+$/, "").toLowerCase(), name = path.split(/[\\/]/).pop()!;
    return dir === t.folder.replace(/[\\/]+$/, "").toLowerCase() && t.files.includes(name) ? name : null;
  }

  async switchTrack(file: string) {
    const t = this.trackFiles;
    if (!t || file === this.currentTrackFile()) return;
    await this.openPath(`${t.folder}\\${file}`);
  }

  // Previous / next track of the folder, staying among single-player or multiplayer (_d) archives.
  async adjacentTrack(direction: number) {
    const t = this.trackFiles;
    if (!t?.files.length) return;
    const current = this.currentTrackFile();
    const multi = !!current && /_d\.(szs|wlz|wbz|wu8)$/i.test(current);
    const list = t.files.filter((f) => /_d\.(szs|wlz|wbz|wu8)$/i.test(f) === multi);
    if (!list.length) return;
    const index = current ? list.indexOf(current) : -1;
    await this.switchTrack(list[(index + direction + list.length) % list.length]);
  }

  openModelParts() {
    if (!this.doc.szs || !findFile(this.doc.szs, "course_model.brres")) return toast.error("Open a track with course_model.brres first");
    if (!hasBackend) return toast.error("Adding game model parts requires the desktop app and ABMatt");
    dialogs.open("modelParts");
  }

  // Adds one polygon (or one connected piece of it) from any game BRRES to course_model.brres.
  async addGamePart(source: Uint8Array, opts: { model: string; part: string; piece: number[] | null; placement: "view" | "original" | "click"; tag: string; label: string;
    collision?: { tris: number[]; verts: Float32Array; flags: Uint16Array; box: { min: number[]; max: number[] } } | null }) {
    const node = this.doc.szs && findFile(this.doc.szs, "course_model.brres");
    if (!node) { toast.error("This track has no course_model.brres"); return false; }
    let clicked: number[] | null = null;
    if (opts.placement === "click") {
      clicked = await this.pickPoint(`Click on the track where ${opts.label} goes · Esc to cancel`);
      if (!clicked) return false;
    }
    try {
      await this.withBusy(`Adding ${opts.label}…`, async () => {
        const before = parseBRRES(node.data), prior = mainModel(before, "course");
        const target = clicked || (opts.placement === "view" ? this.viewport?.viewCenterPoint() || [0, 0, 0] : null);
        let next = await api.importModelPart(node.data, source, { model: opts.model, part: opts.part, piece: opts.piece, target, tag: opts.tag });
        const model = parseBRRES(next).models.find((m: any) => m.name === prior?.name);
        const oldNames = new Set(prior?.objects.map((o: any) => o.name));
        const partIndex = model?.objects.findIndex((o: any) => !oldNames.has(o.name)) ?? -1;
        if (partIndex < 0) throw new Error("The added model part was not found");
        if (clicked) next = this.restPartOnPoint(next, model.name, partIndex, clicked);
        // Collision copied with the part: moved by the same offset as the model (box centre to box centre).
        let kcl: any = null;
        if (opts.collision?.tris.length) {
          const placed = parseBRRES(next).models.find((m: any) => m.name === prior?.name).objects[partIndex];
          const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
          for (let i = 0; i < placed.positions.length; i++) { const a = i % 3; lo[a] = Math.min(lo[a], placed.positions[i]); hi[a] = Math.max(hi[a], placed.positions[i]); }
          const { box, tris, verts, flags } = opts.collision;
          const delta = [0, 1, 2].map((a) => (lo[a] + hi[a]) / 2 - (box.min[a] + box.max[a]) / 2);
          const old = this.doc.kcl, oldCount = old?.count || 0;
          const newVerts = new Float32Array((oldCount + tris.length) * 9), newFlags = new Uint16Array(oldCount + tris.length);
          if (old) { newVerts.set(old.verts.subarray(0, oldCount * 9)); newFlags.set(old.flags.subarray(0, oldCount)); }
          tris.forEach((t, i) => {
            for (let k = 0; k < 9; k++) newVerts[(oldCount + i) * 9 + k] = verts[t * 9 + k] + delta[k % 3];
            newFlags[oldCount + i] = flags[t];
          });
          kcl = { ...(old || {}), verts: newVerts, flags: newFlags, count: oldCount + tris.length, valid: null };
        }
        this.viewport?.selectGeometry(null);
        this.doc.change(`Add model part ${opts.label}`, () => { node.data = next; if (kcl) this.doc.setKCL(kcl, true); }, { structural: true });
        this.doc.emit("model");
        await this.assets?.setTrack(this.doc.szs);
        this.viewport?.selectModelPiece(partIndex, 0);
        this.bump("doc");
      });
      toast.success(`${opts.label} added`, { description: `${opts.collision?.tris.length ? `${opts.collision.tris.length} collision triangles came with it. ` : ""}It is selected under Track model. Move, rotate or scale it, then save the SZS.` });
      return true;
    } catch (e: any) {
      toast.error("Could not add the model part", { description: e.message });
      return false;
    }
  }

  async importTrackModel() {
    const node = this.doc.szs && findFile(this.doc.szs, "course_model.brres");
    if (!node) return toast.error("Open a track with course_model.brres first");
    const picked = await api.openFile(FILTERS.importModel, "Choose a 3D model");
    if (!picked) return;
    if (!picked.path) return toast.error("Choose a model file in the desktop app so its materials can be loaded");
    return this.importTrackModelPath(picked.path);
  }

  // 3D models dropped on the window: ask (unless turned off), copy them with the files dropped
  // alongside (textures, .bin, .mtl) to a temporary folder, then import each model.
  async importDroppedModels(files: { name: string; data: Uint8Array }[], point: number[] | null = null) {
    const models = files.filter((f) => MODEL_FILE.test(f.name));
    if (!this.doc.szs || !findFile(this.doc.szs, "course_model.brres")) return toast.error("Open a track with course_model.brres first", { description: "Dropped 3D models are added to the track model." });
    if (!hasBackend) return toast.error("Importing 3D models requires the desktop app");
    if (this.settings.confirmModelDrop) {
      const answer = await dialogs.open<{ dontAsk: boolean }>("importDrop", { names: models.map((m) => m.name), extra: files.length - models.length });
      if (!answer) return;
      if (answer.dontAsk) this.setSetting("confirmModelDrop", false);
    }
    let paths: Record<string, string>;
    try { paths = await this.withBusy("Reading dropped files…", () => api.stageFiles(files)); }
    catch (e: any) { return toast.error("Could not read the dropped files", { description: e.message }); }
    for (const m of models) await this.importTrackModelPath(paths[m.name], point);
  }

  // ---- Track model animations (CHR0 in course_model.brres) -------------------------------
  courseAnimations() {
    const brres = this.doc.szs && this.assets?.brres(this.doc.szs, "course_model.brres");
    return brres ? [...brres.chr.values()] : [];
  }

  selectAnimation(name: string | null) {
    this.selectedAnimation = name;
    if (name) { this.viewport?.selectGeometry(null); this.doc.clearSelection(); }
    this.bump("ui");
  }

  // Shows one frame (pauses playback so the frame stays on screen).
  showAnimationFrame(frame: number) {
    if (this.settings.animations) this.setSetting("animations", false);
    this.viewport?.setAnimationFrame(frame);
    this.bump("ui");
  }

  setAnimationLoop(name: string, loop: boolean) {
    const node = this.doc.szs && findFile(this.doc.szs, "course_model.brres");
    if (!node) return;
    try {
      const next = setCHR0Loop(node.data, name, loop);
      this.doc.change(`${loop ? "Loop" : "Play once"} animation ${name}`, () => { node.data = next; }, { structural: false });
      this.doc.emit("model");
    } catch (e: any) { toast.error("Could not change the animation", { description: e.message }); }
  }

  async deleteAnimation(name: string) {
    const node = this.doc.szs && findFile(this.doc.szs, "course_model.brres");
    if (!node) return;
    if (!(await dialogs.confirm({ title: "Delete animation", description: `Remove the animation "${name}" from course_model.brres? The model parts it moved stay where they are in their rest pose.`, confirmLabel: "Delete", destructive: true }))) return;
    try {
      await this.withBusy("Removing animation…", async () => {
        const next = await api.deleteAnimation(node.data, name);
        this.doc.change(`Delete animation ${name}`, () => { node.data = next; }, { structural: true });
        this.doc.emit("model");
        await this.assets?.setTrack(this.doc.szs);
      });
      this.selectAnimation(null);
      toast.success(`Animation ${name} removed`, { description: "Save the SZS to keep the change." });
    } catch (e: any) { toast.error("Could not remove the animation", { description: e.message }); }
  }

  // Imports a 3D model file on disk (with its animation, if any) into course_model.brres.
  // point: where to put it (drop position); undefined asks for a click, null uses the view centre.
  async importTrackModelPath(path: string, point?: number[] | null) {
    const node = this.doc.szs && findFile(this.doc.szs, "course_model.brres");
    if (!node) return toast.error("Open a track with course_model.brres first");
    const picked = { path };
    // Files that can hold animations: let the user choose one when there are several.
    let animation = "";
    if (/\.(fbx|gltf|glb|dae)$/i.test(path)) {
      let list: { name: string; frames: number; objects: number }[] = [];
      try { list = await this.withBusy("Reading animations…", () => api.modelAnimations(path)); }
      catch (e: any) { console.warn("Could not list the animations", e); }
      if (list.length > 1) {
        const chosen = await dialogs.open<string>("animationChoice", { file: path.split(/[\\/]/).pop(), animations: list });
        if (chosen === null) return;
        animation = chosen;
      } else if (list.length === 1) animation = list[0].name;
    }
    if (point === undefined) point = await this.pickPoint(`Click on the track where ${path.split(/[\\/]/).pop()} goes · Esc for the centre of the view`);
    try {
      let importedAnimation: any = null;
      await this.withBusy("Importing 3D model…", async () => {
        const before = parseBRRES(node.data);
        const target = point || this.viewport?.viewCenterPoint() || [0, 0, 0];
        let next = await api.import3DModel(node.data, picked.path, target, animation);
        const parsed = parseBRRES(next);
        importedAnimation = [...parsed.chr.values()].find((animation: any) => !before.chr.has(animation.name));
        const model = parsed.models.find((m: any) => m.name === "course") || parsed.models[0];
        const prior = before.models.find((m: any) => m.name === model.name);
        const oldNames = new Set(prior?.objects.map((o: any) => o.name));
        const partIndex = model.objects.findIndex((o: any) => !oldNames.has(o.name));
        if (partIndex < 0) throw new Error("The imported model object was not found");
        // Static models rest on the chosen point; animated ones keep the placement of their bones.
        if (point && !importedAnimation) next = this.restPartOnPoint(next, model.name, partIndex, point);
        this.viewport?.selectGeometry(null);
        this.doc.change("Import 3D track model", () => { node.data = next; }, { structural: true });
        this.doc.emit("model");
        await this.assets?.setTrack(this.doc.szs);
        this.viewport?.selectModelPiece(partIndex, 0);
        if (importedAnimation) this.setSetting("animations", true);
        this.bump("doc");
      });
      toast.success(importedAnimation ? "Animated 3D model imported" : "3D model imported", {
        description: importedAnimation
          ? `${importedAnimation.frames} animation frames are playing in the 3D view. Save the SZS to store the CHR0 for Mario Kart Wii.`
          : "It is selected under Track model. Move, rotate or scale it, then save the SZS.",
      });
    } catch (e: any) { toast.error("Could not import 3D model", { description: e.message }); }
  }

  editCollisionVertex(vertex: number, axis: number, value: number) {
    const selected = this.selectedCollisionTriangles();
    const tri = selected.length === 1 ? selected[0] : -1;
    const kcl = this.doc.kcl;
    if (!kcl || tri < 0 || tri >= kcl.count || !Number.isFinite(value) || vertex < 0 || vertex > 2 || axis < 0 || axis > 2) return;
    const index = tri * 9 + vertex * 3 + axis;
    if (kcl.verts[index] === value) return;
    this.doc.change("Edit collision vertex", () => {
      kcl.verts = kcl.verts.slice();
      kcl.verts[index] = value;
      this.doc.setKCL(kcl, true);
    }, { structural: false });
    this.viewport?.showGeometrySelection();
    this.viewport?.updateGizmo();
  }

  editCollisionType(type: number) {
    const selected = this.selectedCollisionTriangles();
    const kcl = this.doc.kcl;
    if (!kcl || !selected.length || type < 0 || type > 31) return;
    this.doc.change("Edit collision type", () => { for (const tri of selected) kcl.flags[tri] = (kcl.flags[tri] & ~31) | type; }, { structural: false, kclFlags: true });
  }

  // Where a placed object's model is drawn: KMP position, rotation and scale plus the display offset.
  private objectModelTransform(object: any) {
    const display = OBJECT_DISPLAY[this.objectNames[object.objectId]] || (object.objectId === 0x65 ? OBJECT_DISPLAY.itembox : null);
    const pos = object.pos, rot = object.rot, scale = object.scale;
    return new THREE.Matrix4().compose(
      new THREE.Vector3(pos[0], pos[1] + (display?.y || 0), pos[2]),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0] * Math.PI / 180, rot[1] * Math.PI / 180, rot[2] * Math.PI / 180, "ZYX")),
      new THREE.Vector3(...scale.map((value: number) => (Math.abs(value) < .001 ? .001 : value) * (display?.scale || 1))),
    );
  }

  // Static course collision from the selected model part, or from every selected object that has a
  // loaded model. Surfaces can be copied as they are, simplified, or replaced by one box each.
  async generateCollisionForSelection() {
    if (!this.doc.szs) return toast.error("Open a track SZS to add collision");
    const part = this.geometrySelection?.type === "model" ? this.geometrySelection : null;
    // Each source: its triangles in model space and where they are placed in the course.
    const sources: { tris: number[][][]; transform: THREE.Matrix4 | null }[] = [];
    let label = "", skipped = 0, objects = 0;
    if (part?.mesh?.parent) {
      for (const piece of part.pieces || [part]) {
        if (piece.mesh?.parent) sources.push({ tris: modelCollisionTriangles(piece.mesh, { vertexIndices: piece.vertexIndices }), transform: null });
      }
      label = sources.length === 1 ? part.name : `${sources.length} track model parts`;
    } else {
      const selected = this.doc.selectedInfos().filter((info: any) => info.kind === "GOBJ").map((info: any) => info.item);
      const local = new Map<number, number[][][]>();
      for (const object of selected) {
        if (!local.has(object.objectId)) {
          const template = this.assets?.objectModel(object.objectId)?.template;
          local.set(object.objectId, template ? modelCollisionTriangles(template) : []);
        }
        const tris = local.get(object.objectId)!;
        if (!tris.length) { skipped++; continue; }
        sources.push({ tris, transform: this.objectModelTransform(object) });
      }
      objects = sources.length;
      if (!selected.length) return toast.error("Select a track model part or an object first");
      if (!objects) return toast.error(selected.length > 1 ? "None of the selected objects has a loaded 3D model" : "This object has no loaded 3D model");
      const names = [...new Set(selected.map((object: any) => this.objectLabel(object.objectId)))];
      label = objects === 1 ? names[0] : `${objects} objects`;
    }

    const archive = this.doc.szs;
    const n = (value: number) => value.toLocaleString();
    const placed = sources.map((source) => transformCollisionTriangles(source.tris, source.transform));
    const all = placed.flat();
    if (!all.length) return toast.error("The selected model has no usable triangles");
    // Large models take a moment to compare with the course collision.
    const coverage = all.length > 20000 ? await this.withBusy("Checking existing collision…", async () => collisionCoverage(all, this.doc.kcl, 60)) : collisionCoverage(all, this.doc.kcl, 60);
    const covered = coverage.filter(Boolean).length;
    // The only hard limit is the KCL format's: 65,534 triangles for the whole course.
    const room = KCL_MAX_TRIANGLES - (this.doc.kcl?.count ?? 0);
    if (room < 12) return toast.error("course.kcl is full", { description: `The KCL format holds ${n(KCL_MAX_TRIANGLES)} triangles. Delete or simplify some collision first.` });
    const tooBig = all.length > room;
    const detail = tooBig ? room : Math.min(1500, all.length);
    const values = await dialogs.form({
      title: `Generate collision · ${label}`,
      description: [
        `${n(all.length)} model triangles${skipped ? ` (${skipped} selected object${skipped > 1 ? "s have" : " has"} no loaded model and ${skipped > 1 ? "are" : "is"} skipped)` : ""}.`,
        covered ? `${n(covered)} of them already lie on course collision.` : "None of them has collision yet.",
        tooBig ? `course.kcl has room for ${n(room)} more triangles (the KCL format holds ${n(KCL_MAX_TRIANGLES)}), so the model is simplified to fit.` : "",
        `The result is added to course.kcl and can be undone. It is static${objects ? ": it stays where the object is now and does not follow routes or animations" : ": animated model parts will not move it"}.`,
      ].filter(Boolean).join(" "),
      fields: [
        {
          key: "shape", label: "Shape", type: "select", value: tooBig ? "simple" : "mesh",
          options: [["mesh", `Model surfaces (${n(all.length)})`], ["simple", "Simplified surfaces"], ["box", `Bounding box (${sources.length * 12} triangles)`]],
        },
        { key: "detail", label: "Simplified triangles", type: "number", value: detail, min: 12, max: room, step: 1, hint: "Fewer triangles keep the KCL light; more follow the model closer.", visible: (v) => v.shape === "simple" },
        { key: "surface", label: "Surface", type: "select", value: "auto", options: [["auto", "Auto: road on top, wall on the sides"], ...KCL_TYPES.map((type: any) => [String(type.id), type.name] as [string, string])] },
        { key: "uncovered", label: "Only where there is no collision", type: "switch", value: covered > 0, hint: covered ? `Skips the ${n(covered)} triangles that already have collision, so nothing is doubled.` : "Nothing to skip: none of the model has collision yet." },
      ],
      confirmLabel: "Generate",
    });
    if (!values || this.doc.szs !== archive) return;

    let index = 0;
    const keep = placed.map((tris) => tris.filter(() => !(values.uncovered && coverage[index++])));
    const remaining = keep.flat();
    if (!remaining.length) return toast.info("This model already has collision everywhere", { description: "Turn off \"Only where there is no collision\" to add it again." });
    let chosen: number[][][];
    if (values.shape === "box") {
      // One box per source, measured in the model's own space so rotated objects get a turned box.
      chosen = sources.flatMap((source, i) => {
        if (!keep[i].length) return [];
        const kept = values.uncovered ? transformCollisionTriangles(keep[i], source.transform ? source.transform.clone().invert() : null) : source.tris;
        return collisionBoxFromTriangles(kept, source.transform);
      });
    } else if (values.shape === "simple") {
      const target = Math.max(12, Math.min(room, Math.round(Number(values.detail)) || detail));
      chosen = await this.withBusy("Simplifying the model…", async () => simplifyCollisionTriangles(remaining, target));
    } else chosen = remaining;
    if (chosen.length > room) return toast.error("Not enough room in course.kcl", { description: `${n(chosen.length)} triangles, but the KCL format holds ${n(KCL_MAX_TRIANGLES)} and only ${n(room)} are free. Choose Simplified surfaces with at most ${n(room)} triangles.` });
    const flags = values.surface === "auto" ? chosen.map((tri) => isFloorTriangle(tri) ? 0x00 : 0x0C) : Number(values.surface);
    try {
      await this.withBusy("Generating collision…", async () => {
        const first = this.doc.kcl?.count ?? 0;
        const next = appendCollisionTriangles(this.doc.kcl, chosen, flags);
        buildKCL(next.verts, next.flags); // Validate the full course before committing an undoable edit.
        this.doc.change(`Generate collision for ${label}`, () => this.doc.setKCL(next, true));
        this.setTab("collision");
        this.viewport?.setTool({ type: "geometry", target: "collision" });
        // Select what was added so its surface can be changed in one go.
        const added = Array.from({ length: chosen.length }, (_, i) => first + i);
        this.viewport?.selectGeometry({ type: "collision", tris: added, tri: first });
      });
      toast.success(`${n(chosen.length)} collision triangles added`, { description: "They are selected: change their surface in Collision if needed, then save the SZS." });
    } catch (error: any) { toast.error("Could not generate collision", { description: error.message }); }
  }

  private selectedCollisionTriangles(): number[] {
    const s = this.geometrySelection;
    return s?.type === "collision" ? [...new Set(s.tris || [s.tri])].filter((tri: number) => tri >= 0 && tri < (this.doc.kcl?.count ?? 0)) as number[] : [];
  }

  startCollisionDrawing(kind: CollisionShapeKind = this.collisionShape.kind) {
    this.collisionShape.kind = kind;
    this.collisionDraft = [];
    this.viewport?.showCollisionDraft([]);
    this.viewport?.setTool({ type: "collision-create" });
    this.setTab("collision");
    this.setHint(this.collisionHint());
  }

  setCollisionShape(patch: Partial<CollisionShapeState>) {
    Object.assign(this.collisionShape, patch);
    if (patch.kind && this.tool?.type === "collision-create") this.startCollisionDrawing(patch.kind);
    else if (this.collisionDraft.length) this.showCollisionPreview(this.hover?.point);
    this.bump("ui");
  }

  collisionHint() {
    const shape = COLLISION_SHAPES[this.collisionShape.kind], n = this.collisionDraft.length;
    const count = Number.isFinite(shape.points) ? `${n} of ${shape.points} points` : `${n} point${n === 1 ? "" : "s"}`;
    const close = this.collisionShape.kind === "polygon" && n >= 3 ? " · Enter or click the first point to close" : "";
    return `${shape.label}: ${shape.help} ${count} placed${close} · Backspace removes the last point · Esc cancels`;
  }

  private shapeTriangles(points: number[][]) {
    const { kind, height, segments } = this.collisionShape;
    return buildCollisionShape(kind, points, { height, segments, eye: this.viewport?.camera.position.toArray() });
  }

  // Draft points plus the shape it would make with the point under the cursor.
  private showCollisionPreview(hover?: number[]) {
    const draft = this.collisionDraft, need = COLLISION_SHAPES[this.collisionShape.kind].points;
    let tris: number[][][] = [];
    const points = hover && draft.length < need ? [...draft, hover] : draft;
    if (points.length >= Math.min(need, 3)) {
      try { tris = this.shapeTriangles(points); } catch { /* not a valid shape yet */ }
    }
    this.viewport?.showCollisionDraft(draft, tris);
  }

  private addCollisionPoint(point: number[]) {
    if (this.tool?.type !== "collision-create") return;
    const shape = COLLISION_SHAPES[this.collisionShape.kind], draft = this.collisionDraft;
    // Polygon: clicking near the first corner closes it.
    if (this.collisionShape.kind === "polygon" && draft.length >= 3) {
      const first = draft[0], size = Math.max(150, this.settings.iconSize);
      if (Math.hypot(point[0] - first[0], point[1] - first[1], point[2] - first[2]) < size) { this.finishCollisionShape(); return; }
    }
    draft.push([...point]);
    if (draft.length < shape.points) {
      this.showCollisionPreview(point);
      this.setHint(this.collisionHint());
      this.bump("ui");
      return;
    }
    this.finishCollisionShape();
  }

  undoCollisionPoint() {
    if (!this.collisionDraft.length) return;
    this.collisionDraft.pop();
    this.showCollisionPreview(this.hover?.point);
    this.setHint(this.collisionHint());
  }

  finishCollisionShape() {
    if (this.tool?.type !== "collision-create") return;
    const kind = this.collisionShape.kind, first = this.doc.kcl?.count ?? 0;
    try {
      const tris = this.shapeTriangles(this.collisionDraft);
      const next = appendCollisionTriangles(this.doc.kcl, tris, this.paint.type);
      const label = COLLISION_SHAPES[kind].label.toLowerCase();
      this.doc.change(tris.length === 1 ? "Add collision triangle" : `Add collision ${label}`, () => this.doc.setKCL(next, true));
      this.collisionDraft = [];
      this.viewport?.setTool({ type: "geometry", target: "collision" });
      this.viewport?.selectGeometry({ type: "collision", tris: tris.map((_, i) => first + i), tri: first + tris.length - 1 });
      this.setHint(`${COLLISION_SHAPES[kind].label} added (${tris.length} triangle${tris.length === 1 ? "" : "s"}). Move, rotate or scale it with the gizmo; change its surface in Collision › Edit.`);
    } catch (e: any) {
      // The last click did not make a valid shape: keep the others.
      if (Number.isFinite(COLLISION_SHAPES[kind].points)) this.collisionDraft.pop();
      this.showCollisionPreview(this.hover?.point);
      toast.warning(e.message);
      this.bump("ui");
    }
  }

  flipCollisionTriangle() {
    const selected = this.selectedCollisionTriangles();
    const kcl = this.doc.kcl;
    if (!kcl || !selected.length) return;
    this.doc.change("Flip collision normal", () => this.doc.setKCL(flipCollisionTriangles(kcl, selected), true));
    this.viewport?.showGeometrySelection();
  }

  duplicateCollisionTriangle() {
    const selected = this.selectedCollisionTriangles();
    const kcl = this.doc.kcl;
    if (!kcl || !selected.length) return;
    try {
      const next = duplicateCollisionTriangles(kcl, selected);
      this.doc.change("Duplicate collision triangles", () => this.doc.setKCL(next, true));
      this.viewport?.selectGeometry({ type: "collision", tris: selected.map((_, i) => kcl.count + i), tri: kcl.count + selected.length - 1 });
    } catch (e: any) { toast.warning(e.message); }
  }

  deleteCollisionTriangle() {
    const selected = this.selectedCollisionTriangles();
    const kcl = this.doc.kcl;
    if (!kcl || !selected.length) return;
    let next;
    try { next = deleteCollisionTriangles(kcl, selected); }
    catch (e: any) { toast.warning(e.message); return; }
    this.viewport?.selectGeometry(null);
    this.doc.change("Delete collision triangles", () => this.doc.setKCL(next, true));
  }

  async pasteModel(source = this.modelClipboard, atView = true) {
    if (!source) return toast.warning("Copy a track model object first");
    const node = this.doc.szs && findFile(this.doc.szs, "course_model.brres");
    if (!node) return toast.error("This track has no course_model.brres");
    const offset = Math.max(1500, source.size[0] * 1.5);
    const target = atView ? this.viewport?.viewCenterPoint() : null;
    const delta = target?.every(Number.isFinite) ? target.map((v: number, i: number) => v - source.center[i]) : [offset, 0, 0];
    if (Math.hypot(...delta) < Math.max(...source.size, 300)) { delta[0] += offset; }
    try {
      await this.withBusy("Adding track model…", async () => {
        // The copy becomes a polygon of its own, so it never merges with the original (or with
        // other copies) when they are placed next to each other.
        const before = parseBRRES(node.data), prior = before.models.find((m: any) => m.name === source.modelName);
        const oldNames = new Set(prior?.objects.map((o: any) => o.name));
        const targetCenter = source.center.map((v: number, i: number) => v + delta[i]);
        const next = await api.importModelPart(node.data, node.data, { model: source.modelName, part: source.partName, triangles: source.triangles, target: targetCenter, tag: "Copy" });
        const model = parseBRRES(next).models.find((m: any) => m.name === source.modelName);
        const partIndex = model?.objects.findIndex((o: any) => !oldNames.has(o.name)) ?? -1;
        if (partIndex < 0) throw new Error("The copied model object is missing");
        this.viewport?.selectGeometry(null);
        this.doc.change("Add track model object", () => { node.data = next; }, { structural: true });
        this.doc.emit("model");
        await this.assets?.setTrack(this.doc.szs);
        this.viewport?.selectModelPiece(partIndex, 0);
        this.bump("doc");
      });
      toast.success("Track model object added", { description: "Drag the arrows to move it, then save the SZS." });
    } catch (e: any) { toast.error("Could not add the model object", { description: e.message }); }
  }

  async deleteSelectedModel() {
    const s = this.geometrySelection;
    if (s?.type !== "model") return;
    const selected = (s.pieces || [s]).slice().sort((a: any, b: any) => b.partIndex - a.partIndex || b.pieceIndex - a.pieceIndex);
    const node = this.doc.szs && findFile(this.doc.szs, "course_model.brres");
    if (!node) return toast.error("The selected model object is unavailable");
    // A polygon that is a single object (e.g. a part added from another track) is emptied directly:
    // ABMatt cannot remove the last faces of a polygon.
    const brres = this.assets?.brres(this.doc.szs, "course_model.brres");
    const parts = brres && mainModel(brres, "course")?.objects;
    try {
      await this.withBusy("Deleting model object…", async () => {
        let next = node.data;
        const counts = new Map<number, number>();
        for (const piece of selected) counts.set(piece.partIndex, (counts.get(piece.partIndex) || 0) + 1);
        const cleared = new Set<number>();
        for (const piece of selected) {
          if (cleared.has(piece.partIndex)) continue;
          const source = this.modelSource(piece.partIndex, piece.pieceIndex);
          const part = parts?.[piece.partIndex];
          if (!source || !part) throw new Error("A selected model part is unavailable");
          if (counts.get(piece.partIndex) === polygonPieces(part).pieces.length) {
            next = clearBRRESPolygon(next, source.modelName, source.partName);
            cleared.add(piece.partIndex);
          } else next = await api.deleteModel(next, source.modelName, source.partName, source.center, source.triangles);
        }
        this.viewport?.selectGeometry(null);
        this.doc.change(`Delete ${selected.length} track model part${selected.length === 1 ? "" : "s"}`, () => { node.data = next; }, { structural: true });
        this.doc.emit("model");
        await this.assets?.setTrack(this.doc.szs);
        this.bump("doc");
      });
      toast.success("Model object deleted", { description: "Save the SZS to keep the change." });
    } catch (e: any) { toast.error("Could not delete this model object", { description: e.message }); }
  }

  // ---- Commands -------------------------------------------------------------------------
  async cmd(name: string) {
    const d = this.doc, vp = this.viewport, ops = this.ops;
    switch (name) {
      case "open": {
        const f = await api.openFile(FILTERS.editable, "Open");
        if (f) await this.loadFile(f);
        break;
      }
      case "save": return this.save(false);
      case "saveAs": return this.save(true);
      case "home": this.showHome(); break;
      case "editor": this.enterEditor(); break;
      case "closeTrack": return this.closeTrack();
      case "newEmpty": {
        if (!(await this.confirmDiscard())) return;
        d.reset();
        d.fileKind = "szs";
        d.fileName = "New Track.szs";
        d.loaded();
        this.enterEditor();
        this.assets?.setTrack(null);
        toast("Empty project created", { description: "Import a collision (Collision tab) or start placing elements." });
        break;
      }
      case "newTrack": return this.newTrack();
      case "importTrackModel": return this.importTrackModel();
      case "modelParts": return this.openModelParts();
      case "undo": { const l = d.undo(); if (l) toast(`Undo: ${l}`, { duration: 1500 }); break; }
      case "redo": { const l = d.redo(); if (l) toast(`Redo: ${l}`, { duration: 1500 }); break; }
      case "delete": {
        if (this.geometrySelection?.type === "collision") this.deleteCollisionTriangle();
        else if (this.geometrySelection?.type === "model") await this.deleteSelectedModel();
        else {
          const n = ops.deleteSelection();
          if (n) toast(`Deleted ${n} element${n > 1 ? "s" : ""}`, { duration: 1500 });
        }
        break;
      }
      case "copy": if (!this.copySelectedModel()) this.copyElements(); break;
      case "paste":
        if (this.lastClipboard === "model" || (!this.kmpClipboard && this.modelClipboard)) await this.pasteModel();
        else this.pasteElements();
        break;
      case "duplicate": {
        const s = this.geometrySelection;
        if (s?.type === "collision") this.duplicateCollisionTriangle();
        else if (s?.type === "model") {
          const source = this.modelSource(s.partIndex, s.pieceIndex);
          if (source) await this.pasteModel(source, false);
        } else if (this.map2D) ops.duplicateSelection(48 / this.map2DView.scale); // 48 px on the map
        else ops.duplicateSelection();
        break;
      }
      case "snapGround": {
        if (!d.heights) return toast.warning("No collision loaded: nothing to snap to.");
        const n = ops.snapSelectionToGround();
        toast(`${n} element${n !== 1 ? "s" : ""} placed on the ground`, { duration: 1500 });
        break;
      }
      case "alignRoute": ops.alignSelectionToRoute(); break;
      case "distribute": if (!ops.distributeSelection()) toast.warning("Select at least 3 points"); break;
      case "selectAll": this.selectAllSimilar(); break;
      case "exportKMP": await this.exportBytes(d.fileName.replace(/\.\w+$/, "") + ".kmp", FILTERS.kmp, buildKMP(d.kmp), "Export KMP"); break;
      case "exportKCL": {
        const b = this.kclBytes();
        if (!b) return toast.warning("No collision to export");
        await this.exportBytes("course.kcl", FILTERS.kcl, b, "Export KCL");
        break;
      }
      case "exportKCLObj": {
        if (!d.kcl) return toast.warning("No collision to export");
        const { obj, mtl } = kclToOBJ(d.kcl);
        const p = await this.exportBytes("collision.obj", FILTERS.obj, textEncoder.encode(obj), "Export collision as OBJ");
        if (p) await api.writeFile(p.replace(/[^\\/]+$/, "collision.mtl"), textEncoder.encode(mtl));
        break;
      }
      case "exportModelBrres": {
        const node = d.szs && findFile(d.szs, "course_model.brres");
        if (!node) return toast.warning("This track has no course_model.brres");
        await this.exportBytes("course_model.brres", FILTERS.brres, node.data, "Export track model (BRRES)");
        break;
      }
      case "exportModel3D": {
        const node = d.szs && findFile(d.szs, "course_model.brres");
        if (!node) return toast.warning("This track has no course_model.brres");
        const base = (d.fileName || "course").replace(/\.[^.]+$/, "");
        const path = await api.chooseSavePath(d.filePath ? d.filePath.replace(/[^\\/]+$/, `${base}_model.dae`) : `${base}_model.dae`, FILTERS.exportModel, "Export track model with textures");
        if (!path) break;
        try {
          const files = await this.withBusy("Exporting track model…", () => api.exportModel(node.data, path));
          toast.success("Track model exported", { description: `${files.length} files (model, textures, materials) in ${path.replace(/[\\/][^\\/]+$/, "")}` });
          api.reveal(path);
        } catch (e: any) { toast.error("Could not export the track model", { description: e.message }); }
        break;
      }
      case "exportModelObj": {
        if (!d.extraModel) return toast.warning("Only available for tracks created with the generator.");
        const { obj, mtl } = modelToOBJ(d.extraModel);
        const p = await this.exportBytes("course_model.obj", FILTERS.obj, textEncoder.encode(obj), "Export track model as OBJ");
        if (p) await api.writeFile(p.replace(/[^\\/]+$/, "course_model.mtl"), textEncoder.encode(mtl));
        break;
      }
      case "importKMP": {
        const f = await api.openFile(FILTERS.kmp, "Import KMP");
        if (!f) return;
        try {
          const kmp = parseKMP(f.data);
          d.change("Import KMP", () => { d.kmp = kmp; d.selection.clear(); });
          d.emit("selection");
          toast.success("KMP imported");
        } catch (e: any) { dialogs.alert({ title: "Import failed", description: e.message }); }
        break;
      }
      case "importKCL": {
        const f = await api.openFile(FILTERS.kcl, "Import KCL");
        if (!f) return;
        try {
          let bytes = f.data;
          bytes = await api.decodeArchiveBytes(bytes, f.path, this.commonPath || this.partsFolder());
          const kcl = parseKCL(bytes);
          d.change("Import KCL", () => { d.kcl = kcl; });
          d.kclGeometryChanged = false;
          d.setKCL(kcl, false);
          vp.frameAll();
          toast.success(`Collision imported: ${kcl.count.toLocaleString()} triangles`);
        } catch (e: any) { dialogs.alert({ title: "Import failed", description: e.message }); }
        break;
      }
      case "importOBJCollision": return this.importObjCollision();
      case "referenceModel": return this.loadReferenceModel();
      case "szsContents": return dialogs.open("szs", {});
      case "objflow": return this.loadObjFlow();
      case "stageSettings": {
        if (!d.kmp.STGI[0]) { toast.warning("This track has no track settings (STGI)"); break; }
        return dialogs.open("trackSettings");
      }
      case "preferences": return this.cmd("settingsDialog");
      case "settingsDialog": return dialogs.open("settings");
      case "gameText": return dialogs.open("gameText", { search: "" });
      case "trackNameText": {
        // The name of the open track in the game's text (Common.bmg), found by its English name.
        const file = this.currentTrackFile() || this.doc.fileName || "";
        return dialogs.open("gameText", { search: trackLabel(file) !== file ? trackLabel(file) : "" });
      }
      case "help": return dialogs.open("help", { tab: "start" });
      case "workspace": return dialogs.open("workspace", {});
      case "audio": return dialogs.open("audio", {});
      case "riivolution": return dialogs.open("riivolution", {});
      case "assets": return this.openAssetEditor();
      case "gameParams": {
        const common = this.workspacePath("Race", "Common.szs");
        if (!common) return toast.warning("Choose the game folder first", { description: "Vehicle stats and item chances are in Race/Common.szs of the workspace." });
        return this.openArchiveWindow(common, "params");
      }
      case "workspaceEffects": return this.workspace() ? dialogs.open("effects", { workspace: true }) : toast.warning("Choose the game folder first", { description: "The effects are read from every archive of the game folder." });
      case "effects": return this.doc.szs ? dialogs.open("effects", {}) : toast.warning("Open a track archive (.szs) to edit its effects.");
      case "sky": return this.doc.szs ? dialogs.open("sky", {}) : toast.warning("Open a track archive (.szs) to edit its sky.");
      case "trackObjects": return this.doc.szs ? this.openTrackObjects() : toast.warning("Open a track archive (.szs) to edit its objects.");
      case "about": return dialogs.open("about", {});
      case "tour": this.tourActive = true; this.bump("ui"); break;
    }
  }

  async newTrack() {
    const d = this.doc;
    const res: any = await dialogs.open("generator", { hasSzs: !!d.szs });
    if (!res) return;
    if (!res.keepSzs && !(await this.confirmDiscard())) return;
    await this.withBusy("Building the track…", async () => {
      try {
        const out = generateTrack(res.points, res.params);
        const kclBytes = buildKCL(out.verts, out.flags);
        const szs = res.keepSzs ? d.szs : null;
        d.reset();
        d.szs = szs || newSzsTree();
        d.kmp = out.kmp;
        d.kcl = parseKCL(kclBytes);
        d.kclGeometryChanged = false;
        d.extraModel = out.model;
        d.fileKind = "szs";
        d.fileName = "New Track.szs";
        this.assets?.setTrack(szs || null);
        d.loaded();
        this.enterEditor();
        d.dirty = true;
        this.bump("doc");
        dialogs.open("trackCreated", { length: out.length, tris: d.kcl.count, keptSzs: !!szs });
      } catch (e: any) {
        console.error(e);
        dialogs.alert({ title: "Track generation failed", description: e.message });
      }
    });
  }

  async importObjCollision() {
    const f = await api.openFile(FILTERS.obj, "Import OBJ as collision");
    if (!f) return;
    let groups: any[];
    try { groups = parseOBJ(new TextDecoder().decode(f.data)); } catch (e: any) { return dialogs.alert({ title: "Invalid OBJ", description: e.message }); }
    if (!groups.length) return dialogs.alert({ title: "Invalid OBJ", description: "No faces found." });
    const res: any = await dialogs.open("importObj", { groups });
    if (!res) return;
    const verts: number[] = [], flags: number[] = [];
    for (const g of groups) {
      const flag = res.flags[g.material];
      for (let i = 0; i < g.verts.length; i += 9) {
        for (let k = 0; k < 9; k += 3) {
          const x = g.verts[i + k] * res.scale, y = g.verts[i + k + 1] * res.scale, z = g.verts[i + k + 2] * res.scale;
          if (res.zUp) verts.push(x, z, -y); else verts.push(x, y, z);
        }
        flags.push(flag);
      }
    }
    await this.withBusy("Building collision…", async () => {
      try {
        const kcl = parseKCL(buildKCL(verts, flags));
        const d = this.doc;
        d.change("Import OBJ collision", () => { d.kcl = kcl; });
        d.kclGeometryChanged = false;
        d.setKCL(kcl, false);
        this.viewport.frameAll();
        toast.success(`Collision built: ${kcl.count.toLocaleString()} triangles`);
      } catch (e: any) {
        dialogs.alert({ title: "Could not build the collision", description: e.message });
      }
    });
  }

  // Reference model: any BRRES (custom objects/tracks), a model inside an SZS, or an OBJ.
  async loadReferenceModel() {
    const f = await api.openFile(FILTERS.model, "Load reference model");
    if (!f) return;
    try {
      let bytes = f.data;
      bytes = await api.decodeArchiveBytes(bytes, f.path, this.commonPath || this.partsFolder());
      const root = new THREE.Group();
      let label = "";
      if (isBRRES(bytes) || isU8(bytes)) {
        const archives = isU8(bytes)
          ? listFiles(parseU8(bytes)).filter((x: any) => /\.brres$/i.test(x.path) && !/map_model|vrcorn/i.test(x.path)).map((x: any) => x.node.data)
          : [bytes];
        let models = 0;
        for (const data of archives) {
          const b = parseBRRES(data);
          const m = mainModel(b, f.name.replace(/\.\w+$/, ""));
          if (!m) continue;
          root.add(new BrresModelBuilder(b).build(m, { skinned: false }));
          models++;
        }
        if (!models) throw new Error("No 3D model found in this file");
        label = `${models} model${models > 1 ? "s" : ""} from ${f.name}`;
      } else {
        const groups = parseOBJ(new TextDecoder().decode(bytes));
        groups.forEach((g: any, i: number) => {
          const geom = new THREE.BufferGeometry();
          geom.setAttribute("position", new THREE.BufferAttribute(g.verts, 3));
          geom.computeVertexNormals();
          root.add(new THREE.Mesh(geom, new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL((i * 0.17) % 1, 0.35, 0.55), side: THREE.DoubleSide })));
        });
        label = `${groups.length} materials from ${f.name}`;
      }
      this.viewport.setReferenceModel(root);
      this.viewport.frameBox(new THREE.Box3().setFromObject(root));
      toast.success("Reference model loaded", { description: `${label}. Toggle it in View › Layers.` });
    } catch (e: any) {
      dialogs.alert({ title: "Could not load the model", description: e.message });
    }
  }

  // Loose track files dropped together (course_model.brres, course.kcl, course.kmp, object .brres…)
  // are assembled into a new SZS archive in memory.
  // point: where the files were dropped on the track (used for 3D models).
  async loadFiles(files: { name: string; data: Uint8Array }[], point: number[] | null = null) {
    if (files.some((f) => MODEL_FILE.test(f.name))) return this.importDroppedModels(files, point);
    if (files.length === 1) return this.loadFile({ path: null, ...files[0] });
    if (!(await this.confirmDiscard())) return;
    const d = this.doc;
    await this.withBusy("Assembling track files…", async () => {
      try {
        d.reset();
        d.szs = newSzsTree();
        for (const f of files) {
          let data = f.data;
          if (/\.(kmp|kcl|brres)$/i.test(f.name)) data = await api.decodeArchiveBytes(data, null, this.commonPath || this.partsFolder());
          setFile(d.szs, f.name, data);
        }
        const kmp = findFile(d.szs, "course.kmp"), kcl = findFile(d.szs, "course.kcl");
        if (kmp) d.kmp = parseKMP(kmp.data);
        if (kcl) d.kcl = parseKCL(kcl.data);
        d.fileKind = "szs";
        d.fileName = "Custom Track.szs";
        d.loaded();
        this.enterEditor();
        d.dirty = true;
        await this.loadTrackAssets();
        toast.success(`${files.length} files assembled into a new SZS`, { description: "Use Save as to write the .szs archive." });
      } catch (e: any) {
        console.error(e);
        dialogs.alert({ title: "Could not open these files", description: e.message });
      }
    });
  }

  // Race/Common.szs: official object list + shared object models.
  async loadObjFlow() {
    const f = await api.openFile(FILTERS.objflow, "Open Race/Common.szs (or ObjFlow.bin)");
    if (f) await this.applyCommon(f, false);
  }

  async loadCommonFrom(path: string, quiet: boolean) {
    try { return await this.applyCommon(await api.readPath(path), quiet); }
    catch (e: any) { if (!quiet) dialogs.alert({ title: "Could not read Common.szs", description: e.message }); return false; }
  }

  async applyCommon({ path, data }: { path: string | null; data: Uint8Array }, quiet: boolean) {
    try {
      let bytes = data;
      bytes = await api.decodeArchiveBytes(bytes, path, this.commonPath || this.partsFolder());
      let tree = null;
      if (isU8(bytes)) {
        tree = parseU8(bytes);
        const node = findFile(tree, "ObjFlow.bin");
        if (!node) throw new Error("ObjFlow.bin was not found in this archive (use Race/Common.szs)");
        bytes = node.data;
      }
      const parsed = parseObjFlow(bytes);
      const names = Object.fromEntries(Object.entries(parsed).map(([id, v]: any) => [id, v.name]));
      const resources = Object.fromEntries(Object.entries(parsed).map(([id, v]: any) => [id, v.resources]));
      this.objectNames = { ...BUILTIN_OBJECTS, ...Object.fromEntries(Object.entries(names).map(([k, v]) => [Number(k), v as string])) };
      this.assets.setObjectInfo(Object.fromEntries(Object.entries(parsed).map(([k, v]) => [Number(k), v])));
      if (tree) this.assets.setCommon(tree);
      if (tree && path) { this.commonPath = path; this.loadKartModel(); }
      this.saveSettings({ objectNames: names, objectResources: resources, ...(tree && path ? { commonPath: path } : {}) });
      this.viewport.clearCache();
      this.bump("doc", "settings");
      if (!quiet) toast.success(`${Object.keys(names).length} object names loaded`, { description: tree ? "Shared object models are available too." : undefined });
      return true;
    } catch (e: any) {
      if (!quiet) dialogs.alert({ title: "Could not read the object list", description: e.message });
      return false;
    }
  }

  async pickObject(current: number, purpose: "add" | "change" = "change"): Promise<number | null> {
    return dialogs.open("objectPicker", { current, purpose }) as Promise<number | null>;
  }

  // ---- Placing / painting -----------------------------------------------------------------
  startPlacing(kind: string, extra: any = {}) {
    if (kind === "STGI" || !this.viewport) return;
    this.viewport.setTool({ type: "place", kind, ...extra });
  }

  // Shared by the 3D viewport and the flat map so both placement modes use
  // the same document operation, selection and undo history.
  // `single`: one element per Add, whatever its kind (the 2D map unless "Add several" is on).
  placeAt(point: number[], shift = false, single = false) {
    const t = this.viewport?.tool;
    if (t?.type !== "place") return;
    if (t.kind === "PICK") {
      const done = this.pointPick;
      this.pointPick = null;
      this.viewport.setTool(null);
      done?.(point);
      return;
    }
    this.ops.add(t.kind, point, { objectId: t.objectId });
    if (single || (!PATH_KINDS.includes(t.kind) && !shift)) this.viewport.setTool(null);
  }

  startPainting() {
    if (!this.doc.kcl) return toast.warning("Load or create a collision first.");
    this.viewport.setTool({ type: "paint" });
    this.setTab("collision");
  }

  startGeometryEditing(target: "collision" | "model") {
    if (target === "collision" && !this.doc.kcl) return toast.warning("Load collision first.");
    if (target === "model" && !(this.doc.szs && findFile(this.doc.szs, "course_model.brres"))) return toast.warning("Load a track with course_model.brres first.");
    if (target === "model") {
      this.setSetting("modelEditing", true);
      this.viewport.setTool(null);
      this.setTab("outline");
      return;
    }
    this.viewport.setTool({ type: "geometry", target });
    this.setTab("collision");
  }

  stopTool() { this.viewport?.setTool(null); }

  get paintFlag() { return makeFlag(this.paint.type, this.paint.variant, this.paint.shadow); }
  setPaint(patch: Partial<PaintState>) { Object.assign(this.paint, patch); this.bump("ui"); }

  private paintAt(g: any) {
    const p = this.paint, d = this.doc;
    if (!this.painted) return;
    if ((p.brush === "fill" || p.brush === "plane") && this.painted.has(g.tri)) return;
    const flag = this.paintFlag;
    const changed = this.paintTargets(g).filter((t) => d.kcl.flags[t] !== flag);
    for (const t of changed) { d.kcl.flags[t] = flag; this.painted.add(t); }
    this.painted.add(g.tri);
    if (changed.length) this.viewport.refreshKCLColors(changed);
  }

  private paintTargets(g: any): number[] {
    const kcl = this.doc.kcl, p = this.paint;
    if (p.brush === "single") return [g.tri];
    const v = kcl.verts;
    if (p.brush === "radius") {
      const out = [], r2 = p.radius * p.radius;
      for (let t = 0; t < kcl.count; t++) {
        const cx = (v[t * 9] + v[t * 9 + 3] + v[t * 9 + 6]) / 3, cy = (v[t * 9 + 1] + v[t * 9 + 4] + v[t * 9 + 7]) / 3, cz = (v[t * 9 + 2] + v[t * 9 + 5] + v[t * 9 + 8]) / 3;
        if ((cx - g.point[0]) ** 2 + (cy - g.point[1]) ** 2 + (cz - g.point[2]) ** 2 <= r2) out.push(t);
      }
      return out;
    }
    const adj = this.kclAdjacency();
    const seedFlag = kcl.flags[g.tri];
    const normal = (t: number) => {
      const ax = v[t * 9 + 3] - v[t * 9], ay = v[t * 9 + 4] - v[t * 9 + 1], az = v[t * 9 + 5] - v[t * 9 + 2];
      const bx = v[t * 9 + 6] - v[t * 9], by = v[t * 9 + 7] - v[t * 9 + 1], bz = v[t * 9 + 8] - v[t * 9 + 2];
      const n = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
      const l = Math.hypot(n[0], n[1], n[2]) || 1;
      return n.map((x) => x / l);
    };
    const n0 = normal(g.tri);
    const ok = p.brush === "fill"
      ? (t: number) => kcl.flags[t] === seedFlag
      : (t: number) => { const n = normal(t); return Math.abs(n[0] * n0[0] + n[1] * n0[1] + n[2] * n0[2]) > 0.985; };
    const seen = new Set([g.tri]), queue = [g.tri];
    while (queue.length && seen.size < 60000) {
      const t = queue.pop();
      for (const nb of adj[t]) if (!seen.has(nb) && ok(nb)) { seen.add(nb); queue.push(nb); }
    }
    return [...seen];
  }

  private kclAdjacency() {
    const kcl = this.doc.kcl;
    if (this.adjacency?.verts === kcl.verts) return this.adjacency.list;
    const byVertex = new Map<string, number[]>();
    const key = (t: number, k: number) => `${Math.round(kcl.verts[t * 9 + k * 3])},${Math.round(kcl.verts[t * 9 + k * 3 + 1])},${Math.round(kcl.verts[t * 9 + k * 3 + 2])}`;
    for (let t = 0; t < kcl.count; t++) for (let k = 0; k < 3; k++) {
      const kk = key(t, k);
      if (!byVertex.has(kk)) byVertex.set(kk, []);
      byVertex.get(kk).push(t);
    }
    const list: number[][] = Array.from({ length: kcl.count }, () => []);
    for (const tris of byVertex.values()) for (const a of tris) for (const b of tris) if (a !== b) list[a].push(b);
    this.adjacency = { verts: kcl.verts, list };
    return list;
  }

  // ---- Selection helpers --------------------------------------------------------------------
  selectChildren(info: any) { this.doc.select(info.item.points.map((p: any) => String(p.uid))); }

  selectObjectsById(id: number) {
    this.doc.select(this.doc.kmp.GOBJ.filter((o: any) => o.objectId === id).map((o: any) => String(o.uid)));
    this.viewport.focusSelection();
  }

  selectAllSimilar() {
    const d = this.doc, p = d.primary;
    if (!p) return;
    let keys: any[];
    if (p.group) keys = p.group.points.map((x: any) => x.uid);
    else if (p.route) keys = p.route.points.map((x: any) => x.uid);
    else if (p.kind === "GOBJ") keys = d.kmp.GOBJ.filter((o: any) => o.objectId === p.item.objectId).map((o: any) => o.uid);
    else if (p.list) keys = p.list.map((x: any) => x.uid);
    if (keys) d.select(keys.map(String));
  }

  toggleLayer(layer: string) {
    const vp = this.viewport;
    vp.layers[layer] = !vp.layers[layer];
    if (layer === "GRID") { this.settings.hideGrid = !vp.layers.GRID; this.saveSettings({ hideGrid: this.settings.hideGrid }); this.bump("settings"); }
    vp.scheduleRebuild();
    vp.applyDisplayMode();
    this.bump("ui", "doc");
  }

  // ---- KMP cameras: corner preview of the selected camera and the intro -----------------------
  cameraFrame = 0; // frame of the selected camera shown in the corner preview
  intro: { frame: number; playing: boolean } | null = null; // intro watched in the 3D view
  private introCache = new Map<number, any[]>();
  private introRaf = 0;

  selectedCamera(): number {
    const infos = this.doc.selectedInfos();
    return infos.length === 1 && infos[0].kind === "CAME" ? infos[0].index : -1;
  }
  cameraPoses(index: number) {
    let poses = this.introCache.get(index);
    if (!poses) { poses = simulateCamera(this.doc.kmp, index); this.introCache.set(index, poses); }
    return poses;
  }
  refreshCameraViews() {
    const vp = this.viewport;
    if (!vp) return;
    if (this.intro) { this.showIntroFrame(); return; }
    const i = this.selectedCamera();
    if (i < 0 || !this.settings.cameraPreview) { vp.setCameraInset(null); return; }
    const poses = this.cameraPoses(i);
    vp.setCameraInset(poses[Math.min(this.cameraFrame, poses.length - 1)] || null);
  }
  setCameraFrame(frame: number) { this.cameraFrame = Math.max(0, frame | 0); this.refreshCameraViews(); this.bump("intro"); }
  introTimeline() { return introTimeline(this.doc.kmp); }

  watchIntro(fromFrame = 0) {
    const timeline = this.introTimeline();
    if (!timeline.shots.length) { toast.warning("This track has no intro cameras", { description: "Add shots in the Cameras tab." }); return; }
    this.stopTool();
    this.intro = { frame: Math.max(0, Math.min(fromFrame, timeline.total - 1)), playing: true };
    this.viewport?.setCameraInset(null);
    this.showIntroFrame();
    cancelAnimationFrame(this.introRaf);
    let last = performance.now(), pending = 0;
    const tick = (now: number) => {
      if (!this.intro) return;
      if (this.intro.playing) {
        pending += ((now - last) * 60) / 1000; // the game runs cameras at 60 frames per second
        const steps = Math.floor(pending);
        pending -= steps;
        if (steps) {
          const total = this.introTimeline().total;
          this.intro.frame = Math.min(total - 1, this.intro.frame + steps);
          if (this.intro.frame >= total - 1) this.intro.playing = false;
          this.showIntroFrame();
          this.bump("intro");
        }
      } else pending = 0;
      last = now;
      this.introRaf = requestAnimationFrame(tick);
    };
    this.introRaf = requestAnimationFrame(tick);
    this.bump("intro", "ui");
  }
  showIntroFrame() {
    if (!this.intro) return;
    const at = introPose(this.doc.kmp, this.introTimeline(), this.intro.frame, this.introCache);
    this.viewport?.setCameraShot(at?.pose ?? null);
  }
  seekIntro(frame: number) { if (!this.intro) return; this.intro.frame = Math.max(0, Math.min(this.introTimeline().total - 1, frame | 0)); this.showIntroFrame(); this.bump("intro"); }
  toggleIntroPlay() {
    if (!this.intro) return;
    if (!this.intro.playing && this.intro.frame >= this.introTimeline().total - 1) this.intro.frame = 0;
    this.intro.playing = !this.intro.playing;
    this.bump("intro");
  }
  stopIntro() {
    if (!this.intro) return;
    cancelAnimationFrame(this.introRaf);
    this.intro = null;
    this.viewport?.setCameraShot(null);
    this.refreshCameraViews();
    this.bump("intro", "ui");
  }

  // Editing the intro chain. The editor view (position, orbit target, field of view) becomes a shot.
  viewPose() {
    const vp = this.viewport;
    return { position: vp.camera.position.toArray().map(Math.round), target: vp.controls.target.toArray().map(Math.round), fov: Math.round(vp.camera.fov) };
  }
  private rewriteIntro(k: any, chain: number[]) { setIntroChain(k, chain); }
  addIntroShot() {
    const view = this.viewPose();
    this.doc.change("Add intro shot", () => {
      const k = this.doc.kmp;
      const cam = { ...make.CAME(view.position), type: 5, viewStart: view.target, viewEnd: [...view.target], zoomStart: view.fov, zoomEnd: view.fov, time: 180 };
      k.CAME.push(cam);
      this.rewriteIntro(k, [...introChain(k), k.CAME.length - 1]);
      this.doc.selection = new Set([String(cam.uid)]);
    });
    this.doc.emit("selection");
  }
  setShotFromView(index: number, part: "position" | "start" | "end") {
    const view = this.viewPose();
    this.doc.change(part === "position" ? "Camera position from view" : `Camera look-at ${part} from view`, () => {
      const cam = this.doc.kmp.CAME[index];
      if (!cam) return;
      if (part === "position") cam.pos = view.position;
      else if (part === "start") { cam.viewStart = view.target; cam.zoomStart = view.fov; }
      else { cam.viewEnd = view.target; cam.zoomEnd = view.fov; }
    });
  }
  // Puts the editor view where a camera is at a frame (to adjust it from there).
  viewFromCamera(index: number, frame = 0) {
    const pose = this.cameraPoses(index)[Math.min(frame, this.cameraPoses(index).length - 1)];
    if (!pose) return;
    const vp = this.viewport;
    vp.camera.fov = pose.fov;
    vp.camera.updateProjectionMatrix();
    vp.animateCamera(new THREE.Vector3(...pose.target), new THREE.Vector3(...pose.position));
  }
  moveIntroShot(index: number, direction: number) {
    const chain = introChain(this.doc.kmp), at = chain.indexOf(index), to = at + direction;
    if (at < 0 || to < 0 || to >= chain.length) return;
    [chain[at], chain[to]] = [chain[to], chain[at]];
    this.doc.change("Reorder intro", () => this.rewriteIntro(this.doc.kmp, chain));
  }
  removeFromIntro(index: number) {
    this.doc.change("Remove shot from intro", () => this.rewriteIntro(this.doc.kmp, introChain(this.doc.kmp).filter((i) => i !== index)));
  }
  appendToIntro(index: number) {
    this.doc.change("Add camera to intro", () => this.rewriteIntro(this.doc.kmp, [...introChain(this.doc.kmp).filter((i) => i !== index), index]));
  }
  // ---- Intro keyframes (Cameras tab timeline) ----
  // The playhead is a frame of the whole intro; the corner preview shows the intro there.
  introPlayhead = 0;
  introKeyframes() { return introKeyframes(this.doc.kmp); }
  // Keyframe under the playhead (within 2 frames), if any.
  introKeyAtPlayhead() {
    return this.introKeyframes().keys.find((k: any) => Math.abs(k.frame - this.introPlayhead) <= 2) || null;
  }
  setIntroPlayhead(frame: number) {
    const timeline = this.introTimeline();
    this.introPlayhead = Math.max(0, Math.round(frame));
    if (timeline.shots.length) {
      const f = Math.min(this.introPlayhead, timeline.total - 1);
      const shot = timeline.shots.find((s: any) => f < s.start + s.frames) || timeline.shots[timeline.shots.length - 1];
      const uid = String(this.doc.kmp.CAME[shot.index].uid);
      if (this.doc.selection.size !== 1 || !this.doc.selection.has(uid)) this.doc.select([uid]);
      this.cameraFrame = f - shot.start;
      this.refreshCameraViews();
    }
    this.bump("intro");
  }
  // Runs an intro edit; cameras and routes it leaves unused are deleted afterwards.
  private editIntro(label: string, fn: (k: any) => number[] | void) {
    const k = this.doc.kmp;
    const before = new Set<number>(introChain(k).map((i) => k.CAME[i].route).filter((r) => r !== 0xff));
    const routes = k.POTI.length;
    this.doc.change(label, () => {
      const dropped = fn(k) || [];
      const intro = new Set(introChain(k)), area = new Set(k.AREA.map((a: any) => a.camera));
      const removable = dropped.filter((i) => !intro.has(i) && !area.has(i) && i !== selectionIndex(k) && !k.CAME.some((c: any) => c.next === i));
      if (removable.length) this.ops.removeFlat("CAME", new Set(removable));
      const users = (r: number) => [...k.CAME, ...k.GOBJ, ...k.AREA].filter((e: any) => e.route === r).length;
      const unused = [...before, ...Array.from({ length: Math.max(0, k.POTI.length - routes) }, (_, n) => routes + n)].filter((r) => r < k.POTI.length && !users(r));
      if (unused.length) this.ops.removeRoutes(new Set(unused));
      this.doc.invalidate();
    });
  }
  // Puts the view's pose on the keyframe under the playhead, or adds a keyframe there: inside a
  // shot it splits the shot, after the end it adds a shot that flies from the last keyframe.
  setIntroKeyFromView(side: "both" | "before" | "after" = "both") {
    const pose = this.viewPose();
    const key = this.introKeyAtPlayhead();
    const { shots, total } = this.introTimeline();
    if (key) {
      this.editIntro("Intro keyframe from view", (k) => { setKeyPose(k, key, pose, side); });
      this.setIntroPlayhead(key.frame);
      return;
    }
    const frame = this.introPlayhead;
    if (!shots.length || frame > total) {
      this.editIntro("Add intro keyframe", (k) => { appendShot(k, pose, shots.length ? frame - total : 180); });
      this.setIntroPlayhead(shots.length ? frame : 180);
      return;
    }
    const shot = shots.find((s: any) => frame < s.start + s.frames) || shots[shots.length - 1];
    this.editIntro("Add intro keyframe", (k) => {
      const added = splitShot(k, shot.index, frame - shot.start);
      setKeyPose(k, { before: shot.index, after: added }, pose, "both");
    });
    this.setIntroPlayhead(frame);
  }
  // A new keyframe `seconds` after the end of the intro, from the current view.
  appendIntroKey(seconds = 3) {
    const { total, shots } = this.introTimeline();
    this.introPlayhead = shots.length ? total + Math.round(seconds * 60) : 0;
    this.setIntroKeyFromView();
  }
  moveIntroKey(key: any, frame: number) {
    let to = key.frame;
    this.editIntro("Move intro keyframe", (k) => { to = moveKey(k, key, frame); });
    this.setIntroPlayhead(to);
  }
  removeIntroKey(key: any) {
    this.editIntro("Delete intro keyframe", (k) => removeKey(k, key));
    this.setIntroPlayhead(Math.min(this.introPlayhead, this.introTimeline().total));
  }
  // Moves the 3D view to the pose of a keyframe (or of the intro at the playhead).
  viewFromPose(pose: { position: number[]; target: number[]; fov: number } | null) {
    if (!pose) return;
    const vp = this.viewport;
    vp.camera.fov = pose.fov;
    vp.camera.updateProjectionMatrix();
    vp.animateCamera(new THREE.Vector3(...pose.target), new THREE.Vector3(...pose.position));
  }
  viewFromPlayhead() {
    const key = this.introKeyAtPlayhead();
    if (key) return this.viewFromPose(key.pose);
    const { total } = this.introTimeline();
    if (!total) return;
    this.viewFromPose(introPose(this.doc.kmp, this.introTimeline(), Math.min(this.introPlayhead, total - 1), this.introCache)?.pose ?? null);
  }

  setSelectionCamera(index: number) {
    this.doc.change("Selection screen camera", () => setCameraHeader(this.doc.kmp, introIndex(this.doc.kmp), index));
  }

  // ---- Window (desktop app) ------------------------------------------------------------------
  get hasWindowControls() { return typeof (window as any).__winctl === "function"; }
  private windowStateTimer: any = null;
  // Windows can maximize or restore the window by itself (snap, Win+arrows): read the state back.
  watchWindowState() {
    if (!this.hasWindowControls) return;
    window.addEventListener("resize", () => {
      clearTimeout(this.windowStateTimer);
      this.windowStateTimer = setTimeout(() => this.windowAction("state"), 80);
    });
    this.windowAction("state");
  }
  async windowAction(action: string, arg?: string) {
    if (!this.hasWindowControls) return;
    if (action === "close" && this.doc.dirty) {
      const ok = await dialogs.confirm({ title: "Unsaved changes", description: `"${this.doc.fileName}" has unsaved changes. Close anyway?`, confirmLabel: "Close without saving", destructive: true });
      if (!ok) return;
    }
    const state = await (window as any).__winctl(action, arg);
    this.maximized = !!state?.maximized;
    this.bump("ui");
  }

  // ---- Keyboard ----------------------------------------------------------------------------
  handleKey(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || document.querySelector("[role=dialog]") || this.tourActive) return;
    const vp = this.viewport;
    if (!vp) return;
    if (this.homeVisible) {
      const ctrl = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
      if (ctrl && key === "o") this.cmd("open");
      else if (ctrl && key === "n") this.cmd("newTrack");
      else if (ctrl && key === ",") this.cmd("settingsDialog");
      else if (key === "f1") this.cmd("help");
      else return;
      e.preventDefault();
      return;
    }
    // Watching the intro: Space plays / pauses, arrows step, Esc goes back to editing.
    if (this.intro) {
      const step = e.shiftKey ? 60 : 1;
      if (e.key === "Escape") this.stopIntro();
      else if (e.key === " ") this.toggleIntroPlay();
      else if (e.key === "ArrowLeft") this.seekIntro(this.intro.frame - step);
      else if (e.key === "ArrowRight") this.seekIntro(this.intro.frame + step);
      else return;
      e.preventDefault();
      return;
    }
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (e.target === vp.canvas && !ctrl && !e.altKey && ["w", "a", "s", "d", "q", "e"].includes(k)) return;
    if (vp.rmbDown && !ctrl) return; // flying with WASD
    let handled = true;
    if (ctrl && k === "z" && !e.shiftKey) this.cmd("undo");
    else if (ctrl && (k === "y" || (k === "z" && e.shiftKey))) this.cmd("redo");
    else if (ctrl && k === "s") this.cmd(e.shiftKey ? "saveAs" : "save");
    else if (ctrl && k === "o") this.cmd("open");
    else if (ctrl && k === "n") this.cmd("newTrack");
    else if (ctrl && k === "d") this.cmd("duplicate");
    else if (ctrl && k === "x") this.cmd("delete");
    else if (ctrl && k === "c") this.cmd("copy");
    else if (ctrl && k === "v") this.cmd("paste");
    else if (ctrl && k === "a") this.cmd("selectAll");
    else if (ctrl && k === ",") this.cmd("settingsDialog");
    else if (ctrl && (e.key === "PageUp" || e.key === "PageDown")) { e.preventDefault(); this.adjacentTrack(e.key === "PageUp" ? -1 : 1); }
    else if (ctrl) handled = false;
    else if (k === "enter" && this.tool?.type === "collision-create") this.finishCollisionShape();
    else if (k === "backspace" && this.tool?.type === "collision-create") this.undoCollisionPoint();
    else if (k === "delete" || k === "backspace") this.cmd("delete");
    else if (k === "escape") {
      if (vp.tool) vp.setTool(null);
      else if (vp.dragging) this.doc.cancelEdit();
      else if (vp.geometrySelection) vp.selectGeometry(null);
      else this.doc.clearSelection();
    }
    // 2D map: Q / E turn the selection anticlockwise / clockwise on the map by 15° (Shift: 90°).
    // The map shows +Z downward, so a growing yaw turns anticlockwise there.
    else if (this.map2D && (k === "q" || k === "e")) {
      if (!this.ops.rotateSelectionYaw((k === "q" ? 1 : -1) * (e.shiftKey ? 90 : 15))) handled = false;
    }
    else if (k === "w") vp.setMode("translate");
    else if (k === "e") vp.setMode("rotate");
    else if (k === "r") vp.setMode("scale");
    else if (k === "g") this.cmd("snapGround");
    else if (k === "f") vp.focusSelection();
    else if (k === "home") vp.frameAll();
    else if (k === "t") vp.topView();
    else if (k === "a") {
      const p = this.doc.primary;
      if (p && (PATH_KINDS.includes(p.kind) || p.kind === "GROUP" || p.kind === "ROUTE")) this.startPlacing(p.kind === "GROUP" ? p.section : p.kind === "ROUTE" ? "POTI" : p.kind);
      else handled = false;
    }
    else if (k === "f1") this.cmd("help");
    else handled = false;
    if (handled) e.preventDefault();
  }
}

export const editor = new Editor();
(window as any).app = editor; // used by the automated UI tests
export { KIND_LABEL, SECTION_LABEL, LAYERS, hasBackend };
