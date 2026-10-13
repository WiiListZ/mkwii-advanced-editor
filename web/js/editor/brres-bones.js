import * as THREE from 'three';
import { parseBRRES } from '../formats/brres.js';

const DEG = Math.PI / 180;
const matrixOf = (values) => new THREE.Matrix4().set(...values, 0, 0, 0, 1);
const poseOf = (bone) => new THREE.Matrix4().compose(
  new THREE.Vector3(...bone.trans),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(...bone.rot.map((value) => value * DEG), 'ZYX')),
  new THREE.Vector3(...bone.scale),
);
const same = (a, b) => a.every((value, index) => value === b[index]);

function writeMatrix(view, offset, matrix) {
  const e = matrix.elements;
  const rowMajor = [e[0], e[4], e[8], e[12], e[1], e[5], e[9], e[13], e[2], e[6], e[10], e[14]];
  rowMajor.forEach((value, index) => view.setFloat32(offset + index * 4, value));
}

// Move an MDL0 rest skeleton while keeping inverse bind matrices and CHR0 keyframes intact.
export function setBRRESBoneRestTransform(data, modelName, boneIndex, values) {
  const model = parseBRRES(data).models.find((entry) => entry.name === modelName);
  const bone = model?.bones[boneIndex];
  if (!bone) throw new Error('Model bone not found');
  const next = { scale: values.scale || bone.scale, rot: values.rot || bone.rot, trans: values.trans || bone.trans };
  for (const key of ['scale', 'rot', 'trans']) {
    if (!Array.isArray(next[key]) || next[key].length !== 3 || !next[key].every(Number.isFinite)) throw new Error(`Invalid bone ${key}`);
  }
  if (next.scale.some((value) => Math.abs(value) < 0.0001)) throw new Error('Bone scale cannot be zero');
  if (same(next.scale, bone.scale) && same(next.rot, bone.rot) && same(next.trans, bone.trans)) return data;

  const oldWorld = model.bones.map((entry) => matrixOf(entry.world));
  const world = new Map();
  const changed = new Set();
  const resolve = (index) => {
    if (world.has(index)) return world.get(index);
    const entry = model.bones[index];
    const parent = entry.parent;
    const parentOld = parent >= 0 ? oldWorld[parent] : new THREE.Matrix4();
    const parentNew = parent >= 0 ? resolve(parent) : new THREE.Matrix4();
    const local = parentOld.clone().invert().multiply(oldWorld[index]);
    if (index === boneIndex) local.premultiply(poseOf(next).multiply(poseOf(bone).invert()));
    const result = parentNew.clone().multiply(local);
    if (index === boneIndex || parent >= 0 && changed.has(parent)) changed.add(index);
    world.set(index, result);
    return result;
  };
  model.bones.forEach((_, index) => resolve(index));

  const output = data.slice(), view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  [['scale', 0x20], ['rot', 0x2c], ['trans', 0x38]].forEach(([key, offset]) =>
    next[key].forEach((value, axis) => view.setFloat32(bone.offset + offset + axis * 4, value)));
  // Clear SRT identity/shortcut flags; the edited bone now uses its explicit transform.
  view.setUint32(bone.offset + 0x14, bone.flags & ~0x1f);
  for (const index of changed) {
    const entry = model.bones[index], bind = world.get(index);
    writeMatrix(view, entry.offset + 0x70, bind);
  }
  return output;
}
