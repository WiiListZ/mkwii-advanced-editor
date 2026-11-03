import * as THREE from "three";
import { type PreviewTextures } from "./track-texture-preview";
import { BrresModelBuilder, bindSRT, applySRTFrame } from "../../js/editor/brresmodel.js";

// Render the actual generated top surfaces with the same UVs and filtering as
// the 3D viewport. Canvas clips leave seams between adjacent textured triangles.
export class TrackLayoutPreview {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera();
  meshes = new THREE.Group();
  model: any = null;
  textures: PreviewTextures | null = null;
  top = 10000;
  bindings: any[] = [];
  builders: any[] = [];
  constructor(readonly width: number, readonly height: number, readonly fullModel = false) {
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: fullModel });
    this.renderer.setSize(width, height, false); this.renderer.setClearColor(0, 0);
    this.camera.up.set(0, 0, -1); this.scene.add(this.meshes);
  }
  clear() {
    this.bindings = [];
    for (const builder of this.builders) for (const texture of builder.textures.values()) texture?.dispose(); this.builders = [];
    for (const mesh of [...this.meshes.children] as THREE.Mesh[]) {
      mesh.geometry.dispose(); const material = mesh.material as THREE.MeshBasicMaterial;
      material.map?.dispose(); material.dispose(); this.meshes.remove(mesh);
    }
  }
  updateModel(model: any, textures: PreviewTextures) {
    if (this.model !== model || this.textures !== textures) {
      this.clear(); this.model = model; this.textures = textures;
      const groups = new Map<string, any[]>(); let highest = 0, lowest = 0;
      for (const tri of model.tris) if (this.fullModel || ["road", "offroad", "startline", "boost", "curb"].includes(tri.mat)) {
        if (!groups.has(tri.mat)) groups.set(tri.mat, []);
        groups.get(tri.mat)!.push(tri);
        highest = Math.max(highest, tri.v[1], tri.v[4], tri.v[7]); lowest = Math.min(lowest, tri.v[1], tri.v[4], tri.v[7]);
      }
      this.top = highest + 10000; this.camera.near = 1; this.camera.far = this.top - lowest + 10000;
      for (const [role, tris] of groups) {
        const geometry = new THREE.BufferGeometry(), tile = textures[role];
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(tris.flatMap((t) => t.v), 3));
        geometry.setAttribute("uv", new THREE.Float32BufferAttribute(tris.flatMap((t) => t.uv.map((v: number, i: number) => tile?.native ? (i % 2 ? 1 - v * tile.uvScale[1] : v * tile.uvScale[0]) : v)), 2));
        geometry.computeVertexNormals();
        if (tile?.native) {
          geometry.setAttribute("tc0", geometry.getAttribute("uv"));
          const native = tile.native;
          const textures = new Map(Object.entries(native.textures).map(([name, t]: [string, any]) => {
            const data = Uint8Array.from(atob(t.data), (c) => c.charCodeAt(0)), view = new DataView(data.buffer);
            return [name, { ...t, dataOffset: 0, reader: { d: data, u16: (o: number) => view.getUint16(o) } }];
          }));
          const builder = new BrresModelBuilder({ textures, palettes: new Map() }); this.builders.push(builder);
          const material = builder.material(native.material, { lit: false, vertexColors: false, uvSets: [0] });
          if (this.fullModel) material.side = THREE.DoubleSide;
          const claimed = new Set();
          for (const animation of native.animations) {
            const binding = bindSRT({ ...animation, materials: new Map(animation.materials) }, { userData: { materials: [material] } }, claimed);
            if (binding) this.bindings.push(binding);
          }
          const mesh = new THREE.Mesh(geometry, material); mesh.userData.role = role; this.meshes.add(mesh); continue;
        }
        let map: THREE.Texture | null = null, transparent = false;
        if (tile) {
          map = new THREE.Texture(tile.bitmap); map.colorSpace = THREE.SRGBColorSpace;
          map.wrapS = map.wrapT = THREE.RepeatWrapping; map.repeat.set(tile.uvScale[0], tile.uvScale[1]);
          map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearMipmapLinearFilter;
          map.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy()); map.needsUpdate = true;
          if (tile.source === "custom") {
            const canvas = document.createElement("canvas"); canvas.width = tile.width; canvas.height = tile.height;
            const sample = canvas.getContext("2d")!; sample.drawImage(tile.bitmap, 0, 0);
            transparent = sample.getImageData(0, 0, tile.width, tile.height).data.some((v, i) => i % 4 === 3 && v < 255);
          }
        }
        const options = { color: tile ? 0xffffff : this.fullModel ? new THREE.Color(...(model.materials[role]?.color || [.35, .35, .35])) : 0x555555, map, transparent, depthWrite: !transparent, side: this.fullModel ? THREE.DoubleSide : THREE.FrontSide };
        const material = this.fullModel ? new THREE.MeshLambertMaterial(options) : new THREE.MeshBasicMaterial(options);
        const mesh = new THREE.Mesh(geometry, material); mesh.userData.role = role; this.meshes.add(mesh);
      }
    }
  }
  animate(now = performance.now()) {
    for (const binding of this.bindings) applySRTFrame(binding, (now * .06) % binding.frames);
  }
  draw(ctx: CanvasRenderingContext2D, model: any, textures: PreviewTextures, view: { cx: number; cz: number; scale: number }) {
    this.updateModel(model, textures);
    const camera = this.camera;
    camera.left = -this.width / (2 * view.scale); camera.right = -camera.left;
    camera.top = this.height / (2 * view.scale); camera.bottom = -camera.top;
    camera.position.set(view.cx, this.top, view.cz); camera.lookAt(view.cx, this.top - 1000, view.cz); camera.updateProjectionMatrix();
    this.animate();
    this.renderer.render(this.scene, camera); ctx.drawImage(this.renderer.domElement, 0, 0);
  }
  dispose() { this.clear(); this.renderer.dispose(); this.renderer.forceContextLoss(); }
}
