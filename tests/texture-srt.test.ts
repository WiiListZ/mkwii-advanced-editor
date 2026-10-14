import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { parseBRRES } from '../web/js/formats/brres.js';
import { findFile, parseU8 } from '../web/js/formats/u8.js';
import { yaz0Decompress } from '../web/js/formats/yaz0.js';
import { GameAssets } from '../web/js/editor/assets.js';
import { applySRTFrame, bindSRT } from '../web/js/editor/brresmodel.js';
import { setTexMatrix } from '../web/js/editor/tevmaterial.js';

const uv = (matrix: THREE.Matrix3, x: number, y: number) => new THREE.Vector2(x, y).applyMatrix3(matrix);

test('Maya SRT moves V in the stored direction and rotates around the texture center', () => {
  const matrix = new THREE.Matrix3();
  setTexMatrix(matrix, [1, 1], 0, [0.25, 0.3], 0);
  expect(uv(matrix, 0, 0).x).toBeCloseTo(-0.25);
  expect(uv(matrix, 0, 0).y).toBeCloseTo(0.3);
  setTexMatrix(matrix, [1, 1], 90, [0, 0], 0);
  expect(uv(matrix, 0, 0).x).toBeCloseTo(0);
  expect(uv(matrix, 0, 0).y).toBeCloseTo(1);
  expect(uv(matrix, 0.5, 0.5).x).toBeCloseTo(0.5);
  expect(uv(matrix, 0.5, 0.5).y).toBeCloseTo(0.5);
});

test('SRT modes produce their distinct scale and rotation matrices', () => {
  const matrix = new THREE.Matrix3();
  setTexMatrix(matrix, [2, 3], 0, [0, 0], 0);
  expect(uv(matrix, 0, 0).y).toBeCloseTo(-2);
  setTexMatrix(matrix, [2, 3], 0, [0, 0], 2);
  expect(uv(matrix, 0, 0).x).toBeCloseTo(-0.5);
  expect(uv(matrix, 0, 0).y).toBeCloseTo(-1);
  setTexMatrix(matrix, [2, 3], 90, [0, 0], 1);
  expect(uv(matrix, 0, 0).x).toBeCloseTo(2);
  expect(uv(matrix, 0, 0).y).toBeCloseTo(1);
});

test('SRT0 replaces missing channels with identity values in TEV and simple materials', () => {
  const anim = { index: 0, scale: null, rot: null, trans: [{ const: 0.2 }, { const: 0.4 }] };
  const srt = { frames: 2, loop: true, texMtxMode: 0, materials: new Map([['Road', [anim]]]) };
  const tevMatrix = new THREE.Matrix3();
  const map = new THREE.Texture();
  map.matrixAutoUpdate = false;
  map.userData.layerIndex = 0;
  const tev = { name: 'Road', userData: { tev: true, texMtx: [tevMatrix] } };
  const simple = { name: 'Road', map, userData: {} };
  const tevBinding = bindSRT(srt, { userData: { materials: [tev] } });
  const simpleBinding = bindSRT(srt, { userData: { materials: [simple] } });
  applySRTFrame(tevBinding!, 0);
  applySRTFrame(simpleBinding!, 0);
  for (const matrix of [tevMatrix, map.matrix]) {
    expect(uv(matrix, 0.5, 0.5).x).toBeCloseTo(0.3);
    expect(uv(matrix, 0.5, 0.5).y).toBeCloseTo(0.9);
  }
});

test('SRT0 groups claim each material slot only once', () => {
  const matrix = new THREE.Matrix3();
  const group = { userData: { materials: [{ name: 'Road', userData: { tev: true, texMtx: [matrix] } }] } };
  const animation = { frames: 30, loop: true, texMtxMode: 0, materials: new Map([['Road', [{ index: 0, trans: [{ const: 0 }, { const: 0.25 }] }]]]) };
  const claimed = new Set();
  expect(bindSRT(animation, group, claimed)?.targets).toHaveLength(1);
  expect(bindSRT(animation, group, claimed)).toBeNull();
});

for (const [file, animationName, materialName, targetCount] of [
  ['shopping_course.szs', 'course', 'ef_dushBoard', 3],
  ['water_course.szs', 'course2', 'ef_hpipeBoard', 2],
] as const) {
  const course = process.env.MKWII_GAME_DIR && join(process.env.MKWII_GAME_DIR, 'Race/Course', file);
  test.skipIf(!course || !existsSync(course))(`${file} binds every SRT0 group and animates ${materialName}`, async () => {
    const tree = parseU8(yaz0Decompress(readFileSync(course!)));
    const viewport = { setCourseModel() {}, setSkyModel() {}, setSRTBindings(bindings: unknown[]) { this.bindings = bindings; }, clearCache() {}, bindings: [] as any[] };
    const assets = new GameAssets(viewport);
    await assets.setTrack(tree);
    const model = parseBRRES(findFile(tree, 'course_model.brres')!.data);
    expect(assets.built.course.srts).toHaveLength(model.srt.size);
    const animation = model.srt.get(animationName);
    expect(animation?.materials.has(materialName)).toBe(true);
    const binding = assets.built.course.srts.find((entry: any) => entry.frames === animation.frames);
    expect(binding?.targets).toHaveLength(targetCount);
    const before = binding.targets.map((target: any) => [...target.mtx.elements]);
    applySRTFrame(binding, 10);
    expect(binding.targets.every((target: any, i: number) => target.mtx.elements.some((value: number, k: number) => Math.abs(value - before[i][k]) > 0.001))).toBe(true);
  });
}

for (const version of [4, 5]) test(`SRT0 v${version} reads its own matrix mode and header fields`, () => {
  const bytes = new Uint8Array(0x200), view = new DataView(bytes.buffer);
  const str = (at: number, value: string) => { for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i); };
  const group = (at: number, name: string, target: number) => {
    view.setUint32(at + 4, 1);
    view.setUint32(at + 0x20, 0x30);
    view.setUint32(at + 0x24, target - at);
    str(at + 0x30, name);
  };
  str(0, 'bres'); view.setUint16(0x0C, 0x18);
  group(0x20, 'AnmTexSrt(NW4R)', 0x80);
  group(0x80, 'Probe', 0x100);
  str(0x100, 'SRT0'); view.setUint32(0x108, version);
  view.setInt32(0x110, 0x80); // empty material dictionary at 0x180
  const header = version === 5 ? 0x20 : 0x1C;
  view.setUint16(0x100 + header, 37);
  view.setUint32(0x100 + header + 4, 2);
  view.setUint32(0x100 + header + 8, 1);
  const parsed = parseBRRES(bytes).srt.get('Probe');
  expect(parsed?.frames).toBe(37);
  expect(parsed?.texMtxMode).toBe(2);
  expect(parsed?.loop).toBe(true);
});
