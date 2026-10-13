// Heading of KMP rotations seen from above (the 2D map): 0 = facing +Z, growing toward +X.
// Rotations are degrees applied in ZYX order, like the 3D view.
import * as THREE from 'three';

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
const quat = (rot) => new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG, 'ZYX'));
const wrap = (deg) => { const d = ((deg + 180) % 360 + 360) % 360 - 180; return d === -180 ? 180 : d; };
const round = (deg) => Math.round(deg * 1000) / 1000;

// Map heading of an element's forward axis, in degrees.
export function headingOf(rot) {
  if (!rot) return 0;
  if (!rot[0] && !rot[2]) return wrap(rot[1]);
  const f = new THREE.Vector3(0, 0, 1).applyQuaternion(quat(rot));
  return Math.atan2(f.x, f.z) / DEG;
}

// The rotation turned around the vertical axis by `delta` degrees. A plain yaw stays a plain yaw
// (only Y changes), so the Inspector shows the number the user expects.
export function turnYaw(rot, delta) {
  if (!rot[0] && !rot[2]) return [0, round(wrap(rot[1] + delta)), 0];
  const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromAxisAngle(UP, delta * DEG).multiply(quat(rot)), 'ZYX');
  return [e.x, e.y, e.z].map((r) => round(r / DEG));
}
