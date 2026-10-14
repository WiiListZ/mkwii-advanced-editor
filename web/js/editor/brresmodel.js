// Turns parsed BRRES data into Three.js objects and plays the game's CHR0 (bones) and SRT0 (texture) animations.

import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { decodeTexture, evalTrack, formatHasAlpha } from '../formats/brres.js';
import { canUseTEV, makeTEVMaterial, setTexMatrix } from './tevmaterial.js';

const DEG = Math.PI / 180;
const EULER = 'ZYX'; // verified against the bind matrices stored in the game's models
const WRAP = [THREE.ClampToEdgeWrapping, THREE.RepeatWrapping, THREE.MirroredRepeatWrapping];

const m4 = (w) => new THREE.Matrix4().set(w[0], w[1], w[2], w[3], w[4], w[5], w[6], w[7], w[8], w[9], w[10], w[11], 0, 0, 0, 1);

// Picks the main model of an archive: same name as the file, otherwise the first that is not a shadow/low-detail model.
export function mainModel(brres, preferred) {
  const ms = brres.models;
  return ms.find((m) => m.name === preferred)
    || ms.find((m) => !/shadow|-low|_low|lod/i.test(m.name))
    || ms[0] || null;
}

export class BrresModelBuilder {
  static tev = true; // reproduce the game's GX materials (set false for the simple look)
  static lightSets = null; // light sets of the open track (posteffect.blight)

  constructor(brres, { maxAnisotropy = 4, tev = BrresModelBuilder.tev } = {}) {
    this.brres = brres;
    this.tev = tev;
    this.textures = new Map();
    this.anisotropy = maxAnisotropy;
  }

  // raw: no colour space conversion (TEV materials combine colours in the console's gamma space).
  texture(name, layer, raw = false) {
    const key = `${name}|${layer.wrapS}|${layer.wrapT}${raw ? '|raw' : ''}`;
    if (this.textures.has(key)) return this.textures.get(key);
    const tex0 = this.brres.textures.get(name);
    let tex = null;
    if (tex0) {
      const pal = this.brres.palettes.get(layer.palette) || this.brres.palettes.get(name) || null;
      const rgba = decodeTexture(tex0, pal);
      tex = new THREE.DataTexture(rgba, tex0.width, tex0.height, THREE.RGBAFormat);
      tex.colorSpace = raw ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      tex.wrapS = WRAP[layer.wrapS] ?? THREE.RepeatWrapping;
      tex.wrapT = WRAP[layer.wrapT] ?? THREE.RepeatWrapping;
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = true;
      tex.anisotropy = this.anisotropy;
      tex.needsUpdate = true;
      tex.userData.hasAlpha = formatHasAlpha(tex0.format);
      tex.userData.brresTextureName = name;
    }
    this.textures.set(key, tex);
    return tex;
  }

  // Three.js material for an MDL0 material. Returns { material, layer } (layer = texture layer used).
  material(mat, { lit, vertexColors, uvSets = [] }) {
    if (this.tev && canUseTEV(mat)) {
      try {
        return makeTEVMaterial(mat, {
          uvSets, hasColor: vertexColors, lightSets: BrresModelBuilder.lightSets,
          textures: (id) => {
            const layer = mat.layers.find((l) => l.texId === id) || mat.layers[id];
            return layer && this.brres.textures.has(layer.texture) ? this.texture(layer.texture, layer, true) : null;
          },
        });
      } catch (e) { console.warn(`TEV material ${mat.name} failed, using the simple one:`, e); }
    }
    // Base texture: the first layer mapped with UVs (others are usually light/env maps).
    let layerIndex = mat.layers.findIndex((l, i) => (mat.srt[i]?.mapMode ?? 0) === 0 && this.brres.textures.has(l.texture));
    if (layerIndex < 0) layerIndex = mat.layers.findIndex((l) => this.brres.textures.has(l.texture));
    const layer = mat.layers[layerIndex];
    let map = layer ? this.texture(layer.texture, layer) : null;
    if (map) {
      map = map.clone(); // per-material transform (SRT), shared image
      const s = mat.srt[layerIndex];
      if (s) applySRT(map, s.scale, s.rot, s.trans, mat.texMtxMode);
      map.userData.layerIndex = layerIndex;
    }
    const side = mat.cull === 0 ? THREE.DoubleSide : mat.cull === 1 ? THREE.BackSide : THREE.FrontSide;
    const params = {
      map, side, vertexColors,
      transparent: mat.xlu,
      depthWrite: !mat.xlu,
      alphaTest: !mat.xlu && map?.userData.hasAlpha ? 0.5 : 0,
    };
    const m = lit ? new THREE.MeshLambertMaterial(params) : new THREE.MeshBasicMaterial(params);
    m.name = mat.name;
    m.visible = mat.cull !== 3;
    return m;
  }

  /**
   * Builds a Three.js group for a model.
   * skinned: build bones + SkinnedMesh (needed to play CHR0 animations); otherwise vertices are baked.
   */
  build(model, { skinned = false, lit = null } = {}) {
    const group = new THREE.Group();
    group.name = model.name;
    const bones = model.bones;
    const boneWorld = bones.map((b) => m4(b.world));
    const inverseBind = bones.map((b) => m4(b.inverse));
    const bindWorld = inverseBind.map((matrix) => matrix.clone().invert());

    let threeBones = null;
    if (skinned && bones.length) {
      threeBones = bones.map((b) => {
        const tb = new THREE.Bone();
        tb.name = b.name;
        tb.userData.rest = { scale: b.scale, rot: b.rot, trans: b.trans };
        if (b.billboard) tb.userData.billboard = b.billboard;
        return tb;
      });
      bones.forEach((b, i) => {
        // Rest pose from the stored matrices (exactly the game's bind pose).
        const parentW = b.parent >= 0 ? boneWorld[b.parent] : new THREE.Matrix4();
        const local = parentW.clone().invert().multiply(boneWorld[i]);
        local.decompose(threeBones[i].position, threeBones[i].quaternion, threeBones[i].scale);
        if (b.parent >= 0) threeBones[b.parent].add(threeBones[i]);
        else group.add(threeBones[i]);
      });
    }
    const skeleton = threeBones ? new THREE.Skeleton(threeBones, inverseBind) : null;

    // Material per object from the draw lists.
    const drawsByObject = new Map();
    for (const d of model.draws) {
      if (!drawsByObject.has(d.object)) drawsByObject.set(d.object, []);
      drawsByObject.get(d.object).push(d);
    }
    const matCache = new Map();
    const v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3();

    model.objects.forEach((obj, oi) => {
      if (!obj.triangles) return;
      const count = obj.positions.length / 3;
      // Polygons bound to one billboard bone keep bone-space vertices: the mesh sits at the bone
      // and is turned towards the camera every frame, as the game does.
      let billboard = null;
      if (!skeleton && count) {
        const id = obj.mtx[0], rigid = model.boneMatrix.get(id);
        if (rigid !== undefined && id >= 0 && bones[rigid]?.billboard && obj.mtx.every((m) => m === id)) billboard = rigid;
      }
      const pos = new Float32Array(obj.positions.length);
      const nrm = obj.normals ? new Float32Array(obj.normals.length) : null;
      const skinIndex = skeleton ? new Uint16Array(count * 4) : null;
      const skinWeight = skeleton ? new Float32Array(count * 4) : null;
      for (let i = 0; i < count; i++) {
        const id = obj.mtx[i];
        const rigid = model.boneMatrix.get(id);
        v.fromArray(obj.positions, i * 3);
        if (nrm) n.fromArray(obj.normals, i * 3);
        if (rigid !== undefined && id >= 0 && billboard === null) {
          // Single-bound vertices are stored in bone space.
          const bind = skeleton ? bindWorld[rigid] : boneWorld[rigid];
          v.applyMatrix4(bind);
          if (nrm) n.applyMatrix3(nm.setFromMatrix4(bind)).normalize();
        }
        v.toArray(pos, i * 3);
        if (nrm) n.toArray(nrm, i * 3);
        if (skeleton) {
          let infl = [];
          if (rigid !== undefined) infl = [[rigid, 1]];
          else if (model.envBone.has(id)) infl = [[model.envBone.get(id), 1]];
          else if (model.weights.has(id)) {
            infl = model.weights.get(id).map(({ id: wid, w }) => [model.boneMatrix.get(wid) ?? model.envBone.get(wid) ?? 0, w])
              .sort((a, b) => b[1] - a[1]).slice(0, 4);
          } else infl = [[0, 1]];
          const sum = infl.reduce((s, x) => s + x[1], 0) || 1;
          infl.forEach(([b, w], k) => { skinIndex[i * 4 + k] = b; skinWeight[i * 4 + k] = w / sum; });
        }
      }
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      if (nrm) geom.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      else geom.computeVertexNormals();
      if (obj.colors) geom.setAttribute('color', new THREE.BufferAttribute(obj.colors, 4));
      const uvSet = Object.keys(obj.uvs)[0];
      if (uvSet !== undefined) geom.setAttribute('uv', new THREE.BufferAttribute(obj.uvs[uvSet], 2));
      const uvSets = Object.keys(obj.uvs).map(Number).sort((a, b) => a - b);
      for (const set of uvSets) geom.setAttribute(`tc${set}`, new THREE.BufferAttribute(obj.uvs[set], 2));
      if (obj.colors) geom.setAttribute('gxColor', geom.getAttribute('color'));
      if (skeleton) {
        geom.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
        geom.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
      }
      const draws = drawsByObject.get(oi) || [{ material: 0, xlu: false }];
      for (const d of draws) {
        const mat = model.materials[d.material];
        if (!mat) continue;
        const vc = !!obj.colors;
        const key = `${d.material}|${vc}|${uvSets.join(',')}`;
        if (!matCache.has(key)) matCache.set(key, this.material(mat, { lit: lit ?? !vc, vertexColors: vc, uvSets }));
        const material = matCache.get(key);
        const mesh = skeleton ? new THREE.SkinnedMesh(geom, material) : new THREE.Mesh(geom, material);
        if (skeleton) mesh.bind(skeleton, new THREE.Matrix4());
        mesh.name = obj.name;
        if (billboard !== null) {
          const w = boneWorld[billboard], scale = new THREE.Vector3();
          w.decompose(mesh.position, new THREE.Quaternion(), scale);
          mesh.scale.copy(scale);
          mesh.userData.billboard = bones[billboard].billboard;
        }
        mesh.userData.partIndex = oi;
        mesh.userData.modelName = model.name;
        mesh.userData.modelPart = obj;
        mesh.renderOrder = d.xlu || mat.xlu ? 2 : material.userData?.opaqueBlend ? 1 : 0;
        mesh.userData.materialName = mat.name;
        mesh.frustumCulled = !skeleton;
        group.add(mesh);
      }
    });
    group.userData.materials = [...matCache.values()];
    return group;
  }
}

function applySRT(tex, scale, rot, trans, mode) {
  tex.matrixAutoUpdate = false;
  setTexMatrix(tex.matrix, scale, rot, trans, mode);
}

// ---- Animation -------------------------------------------------------------------------

// Texture swap (PAT0) and colour (CLR0) animations of TEV materials. Each binding has its own
// apply(frame), so the viewport plays it next to the SRT0 animations.
export function bindPAT(pat, group, builder, claimed = new Set()) {
  const targets = [];
  for (const mat of group.userData.materials || []) {
    const slots = mat.userData.tev && !claimed.has(mat.name) && pat.materials.get(mat.name);
    if (!slots) continue;
    claimed.add(mat.name);
    const source = mat.userData.brresMaterial;
    for (const slot of slots) {
      const layer = source?.layers[slot.index];
      const uniform = layer && mat.uniforms[`uTex${layer.texId}`];
      if (!uniform) continue;
      const keys = slot.keys.map((k) => ({ frame: k.frame, tex: builder.brres.textures.has(k.texture) ? builder.texture(k.texture, layer, true) : null })).filter((k) => k.tex);
      if (keys.length) targets.push({ uniform, keys });
    }
  }
  if (!targets.length) return null;
  return {
    frames: Math.max(1, pat.frames), loop: pat.loop,
    apply(frame) {
      for (const { uniform, keys } of targets) {
        let k = keys[0];
        for (const key of keys) if (frame >= key.frame) k = key;
        uniform.value = k.tex;
      }
    },
  };
}

const CLR_UNIFORM = [['uMat', 0], ['uMat', 1], ['uAmb', 0], ['uAmb', 1], ['uRegs', 1], ['uRegs', 2], ['uRegs', 3], ['uKonst', 0], ['uKonst', 1], ['uKonst', 2], ['uKonst', 3]];
export function bindCLR(clr, group, claimed = new Set()) {
  const targets = [];
  for (const mat of group.userData.materials || []) {
    const list = mat.userData.tev && !claimed.has(mat.name) && clr.materials.get(mat.name);
    if (!list) continue;
    claimed.add(mat.name);
    for (const t of list) {
      const [name, index] = CLR_UNIFORM[t.target] || [];
      const vec = name && mat.uniforms[name]?.value[index];
      if (vec) targets.push({ vec, base: vec.clone(), t });
    }
  }
  if (!targets.length) return null;
  return {
    frames: Math.max(1, clr.frames), loop: clr.loop,
    apply(frame) {
      for (const { vec, base, t } of targets) {
        const i0 = Math.min(t.colors.length - 1, Math.floor(frame)), i1 = Math.min(t.colors.length - 1, i0 + 1), w = frame - Math.floor(frame);
        const c = t.colors[i0].map((v, k) => v + (t.colors[i1][k] - v) * w);
        vec.set(t.keep[0] ? base.x : c[0], t.keep[1] ? base.y : c[1], t.keep[2] ? base.z : c[2], t.keep[3] ? base.w : c[3]);
      }
    },
  };
}

// Texture SRT animation bound to the materials of a built model.
export function bindSRT(srt, group, claimed = new Set()) {
  const targets = [];
  for (const mat of group.userData.materials || []) {
    const texAnims = srt.materials.get(mat.name);
    if (texAnims && mat.userData.tev) {
      for (const anim of texAnims) {
        const mtx = mat.userData.texMtx[anim.index];
        if (mtx && !claimed.has(mtx)) { targets.push({ mtx, anim, mode: srt.texMtxMode }); claimed.add(mtx); }
      }
      continue;
    }
    if (!texAnims || !mat.map) continue;
    const anim = texAnims.find((t) => t.index === mat.map.userData.layerIndex);
    if (anim && !claimed.has(mat.map)) { targets.push({ map: mat.map, anim, mode: srt.texMtxMode }); claimed.add(mat.map); }
  }
  return targets.length ? { frames: Math.max(1, srt.frames), loop: srt.loop, targets } : null;
}

export function applySRTFrame(binding, frame) {
  for (const { map, mtx, anim, mode } of binding.targets) {
    const sx = anim.scale ? evalTrack(anim.scale[0], frame) : 1;
    const sy = anim.scale ? evalTrack(anim.scale[1], frame) : 1;
    const r = anim.rot ? evalTrack(anim.rot, frame) : 0;
    const tx = anim.trans ? evalTrack(anim.trans[0], frame) : 0;
    const ty = anim.trans ? evalTrack(anim.trans[1], frame) : 0;
    setTexMatrix(mtx || map.matrix, [sx, sy], r, [tx, ty], mode);
  }
}

// Bone animation for one instance (each clone has its own bones).
export function bindCHR(chr, root) {
  const targets = [];
  root.traverse((o) => {
    if (!o.isBone) return;
    const tr = chr.bones.get(o.name);
    if (tr) targets.push({ bone: o, tr, rest: o.userData.rest });
  });
  return targets.length ? { frames: Math.max(1, chr.frames), loop: chr.loop, targets } : null;
}

const euler = new THREE.Euler();
export function applyCHRFrame(binding, frame) {
  for (const { bone, tr, rest } of binding.targets) {
    const comp = (tracks, fallback) => (tracks ? tracks.map((t, i) => evalTrack(t, frame) ?? fallback[i]) : fallback);
    const s = comp(tr.scale, rest.scale), r = comp(tr.rot, rest.rot), t = comp(tr.trans, rest.trans);
    bone.position.set(t[0], t[1], t[2]);
    bone.quaternion.setFromEuler(euler.set(r[0] * DEG, r[1] * DEG, r[2] * DEG, EULER));
    bone.scale.set(s[0], s[1], s[2]);
  }
}

// Turns billboard nodes (meshes or bones) towards the camera. Modes as stored in MDL0 bones.
const _parentQ = new THREE.Quaternion(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _dir = new THREE.Vector3();
const _m = new THREE.Matrix4(), _Y = new THREE.Vector3(0, 1, 0), _s = new THREE.Vector3(), _t = new THREE.Vector3();
export function applyBillboards(nodes, camera) {
  camera.getWorldDirection(_dir);
  for (const node of nodes) {
    const parent = node.parent;
    if (!parent) continue;
    parent.updateWorldMatrix(true, false);
    parent.matrixWorld.decompose(_t, _parentQ, _s);
    _p.copy(node.position).applyMatrix4(parent.matrixWorld);
    const mode = node.userData.billboard;
    if (mode === 5 || mode === 6) {
      const dx = mode === 6 ? camera.position.x - _p.x : -_dir.x, dz = mode === 6 ? camera.position.z - _p.z : -_dir.z;
      _q.setFromAxisAngle(_Y, Math.atan2(dx, dz));
    } else if (mode === 2 || mode === 4) {
      _q.setFromRotationMatrix(_m.lookAt(camera.position, _p, camera.up));
    } else _q.copy(camera.quaternion);
    node.quaternion.copy(_parentQ.invert().multiply(_q));
  }
}

export function collectBillboards(root) {
  const out = [];
  root.traverse((o) => { if (o.userData.billboard) out.push(o); });
  return out;
}

// Clone helper that keeps skinned meshes working.
export function cloneModel(template) {
  let skinned = false;
  template.traverse((o) => { if (o.isSkinnedMesh) skinned = true; });
  return skinned ? cloneSkinned(template) : template.clone();
}
