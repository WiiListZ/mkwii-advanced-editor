// Exports a BRRES model as glTF binary (.glb): skinned mesh, skeleton, textures and the CHR0 bone
// animations as glTF animations. Texture (SRT0/PAT0/CLR0) animations have no glTF counterpart.

import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { BrresModelBuilder, applyCHRFrame, bindCHR } from './brresmodel.js';

const FPS = 60; // the game plays CHR0 frames at 60 per second

// Samples a CHR0 animation on the bones of a built (skinned) model, one key per game frame.
// Tracks address bones by uuid: bone names may hold characters glTF track names cannot.
export function chrClip(chr, group) {
  const binding = bindCHR(chr, group);
  if (!binding) return null;
  const saved = binding.targets.map(({ bone }) => [bone.position.clone(), bone.quaternion.clone(), bone.scale.clone()]);
  const count = binding.frames + 1;
  const times = Float32Array.from({ length: count }, (_, i) => i / FPS);
  const tracks = binding.targets.map(() => ({ t: new Float32Array(count * 3), r: new Float32Array(count * 4), s: new Float32Array(count * 3) }));
  for (let i = 0; i < count; i++) {
    // A looping animation ends where it starts, so the clip loops without a jump.
    applyCHRFrame(binding, binding.loop && i === binding.frames ? 0 : i);
    binding.targets.forEach(({ bone }, k) => {
      const q = bone.quaternion, out = tracks[k];
      // Keep each rotation on the same side as the previous one so interpolation takes the short way.
      if (i > 0 && q.x * out.r[i * 4 - 4] + q.y * out.r[i * 4 - 3] + q.z * out.r[i * 4 - 2] + q.w * out.r[i * 4 - 1] < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      bone.position.toArray(out.t, i * 3);
      q.toArray(out.r, i * 4);
      bone.scale.toArray(out.s, i * 3);
    });
  }
  binding.targets.forEach(({ bone }, k) => { bone.position.copy(saved[k][0]); bone.quaternion.copy(saved[k][1]); bone.scale.copy(saved[k][2]); });
  const keyframes = binding.targets.flatMap(({ bone }, k) => [
    new THREE.VectorKeyframeTrack(`${bone.uuid}.position`, times, tracks[k].t),
    new THREE.QuaternionKeyframeTrack(`${bone.uuid}.quaternion`, times, tracks[k].r),
    new THREE.VectorKeyframeTrack(`${bone.uuid}.scale`, times, tracks[k].s),
  ]);
  return new THREE.AnimationClip(chr.name, (count - 1) / FPS, keyframes);
}

// glTF knows standard (lit) and unlit materials: lit ones become rough, non-metallic standard materials.
function exportMaterial(m) {
  if (m.isMeshBasicMaterial || m.isMeshStandardMaterial) return m;
  const out = new THREE.MeshStandardMaterial({
    name: m.name, color: m.color, map: m.map, side: m.side, vertexColors: m.vertexColors,
    transparent: m.transparent, depthWrite: m.depthWrite, alphaTest: m.alphaTest, metalness: 0, roughness: 1,
  });
  out.visible = m.visible;
  return out;
}

// Returns the .glb bytes of one model of a parsed BRRES, with the given CHR0 animations (all by default).
export async function exportBRRESModelGLB(brres, model, { animations = [...brres.chr.values()] } = {}) {
  const group = new BrresModelBuilder(brres, { tev: false }).build(model, { skinned: model.bones.length > 1 || animations.length > 0, lit: null });
  const materials = new Map();
  group.traverse((o) => {
    if (!o.isMesh) return;
    if (!materials.has(o.material)) materials.set(o.material, exportMaterial(o.material));
    o.material = materials.get(o.material);
    // Attributes only the game material shaders read.
    for (const name of Object.keys(o.geometry.attributes)) if (/^tc\d+$|^gxColor$/.test(name)) o.geometry.deleteAttribute(name);
  });
  group.updateMatrixWorld(true);
  const clips = animations.map((chr) => chrClip(chr, group)).filter(Boolean);
  try {
    const glb = await new GLTFExporter().parseAsync(group, { binary: true, trs: true, onlyVisible: true, animations: clips });
    return { data: new Uint8Array(glb), animations: clips.length };
  } finally {
    group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    for (const m of materials.values()) m.dispose();
  }
}
