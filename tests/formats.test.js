import { test, expect } from 'bun:test';
import { isWLZ, isWU8, isWBZ, isYBZ, WLZ_MESSAGE, yaz0Compress, yaz0Decompress } from '../web/js/formats/yaz0.js';
import { compressSync as lzmaCompress } from 'lzma-web/sync';
import { parseU8, buildU8, findFile, setFile, newSzsTree } from '../web/js/formats/u8.js';
import { parseKMP, buildKMP, emptyKMP, make } from '../web/js/formats/kmp.js';
import { parseKCL, buildKCL, kclLookup, patchKCLFlags } from '../web/js/formats/kcl.js';
import { decodeTexture, parseBRRES, replaceBRRESTexture, translateBRRESPart, transformBRRESPart } from '../web/js/formats/brres.js';

test('BRRES CMPR texture replacement writes pixels and mip levels in place', () => {
  const bytes = new Uint8Array(0x200), v = new DataView(bytes.buffer);
  const str = (at, s) => { for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i); };
  const group = (at, name, target) => {
    v.setUint32(at + 4, 1); v.setUint32(at + 0x20, 0x30); v.setUint32(at + 0x24, target - at);
    str(at + 0x30, name);
  };
  str(0, 'bres'); v.setUint16(0x0C, 0x18);
  group(0x20, 'Textures(NW4R)', 0x80);
  group(0x80, 'custom', 0x100);
  str(0x100, 'TEX0'); v.setUint32(0x104, 0x80);
  v.setInt32(0x110, 0x40); v.setUint16(0x11C, 8); v.setUint16(0x11E, 8);
  v.setUint32(0x120, 14); v.setUint32(0x124, 2);
  const rgba = new Uint8Array(8 * 8 * 4);
  for (let i = 0; i < 64; i++) rgba.set([230, 30, 40, i < 16 ? 0 : 255], i * 4);
  const changed = replaceBRRESTexture(bytes, 'custom', rgba);
  const tex = parseBRRES(changed).textures.get('custom');
  const decoded = decodeTexture(tex);
  expect(changed.length).toBe(bytes.length);
  expect(bytes.slice(0x140, 0x180).every((x) => x === 0)).toBe(true);
  expect(changed.slice(0x160, 0x180).some((x) => x !== 0)).toBe(true);
  expect(decoded[3]).toBe(0);
  expect(decoded[4 * 63]).toBeGreaterThan(215);
  expect(decoded[4 * 63 + 3]).toBe(255);
});

test('BRRES part move patches only its position array and bounds', () => {
  const bytes = new Uint8Array(0x600), v = new DataView(bytes.buffer);
  const u16 = (at, x) => v.setUint16(at, x), u32 = (at, x) => v.setUint32(at, x), s32 = (at, x) => v.setInt32(at, x), f32 = (at, x) => v.setFloat32(at, x);
  const str = (at, s) => { for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i); };
  const group = (at, name, target) => {
    u32(at + 4, 1);
    u32(at + 0x18 + 8, 0x30);
    u32(at + 0x18 + 12, target - at);
    str(at + 0x30, name);
  };
  str(0, 'bres'); u16(0x0C, 0x18);
  group(0x20, '3DModels(NW4R)', 0x80);
  group(0x80, 'course', 0x100);
  str(0x100, 'MDL0'); u32(0x108, 11);
  s32(0x118, 0x100); // vertex group (section 2)
  s32(0x138, 0x150); // polygon group (section 10)
  group(0x200, 'Positions', 0x300);
  group(0x250, 'Road', 0x400);
  s32(0x308, 0x40); u32(0x314, 1); u32(0x318, 4); bytes[0x31D] = 12; u16(0x31E, 3);
  [[0, 0, 0], [100, 0, 0], [0, 0, 100]].forEach((p, i) => p.forEach((x, c) => f32(0x340 + i * 12 + c * 4, x)));
  u32(0x40C, 2 << 9); u32(0x424, 6); s32(0x42C, 0xDC); u16(0x448, 0);
  for (let at = 0x44A; at <= 0x45E; at += 2) v.setInt16(at, -1);
  bytes.set([0x90, 0, 3, 0, 1, 2], 0x500);
  const before = parseBRRES(bytes).models[0];
  expect(before.objects[0].positions[0]).toBe(0);
  const moved = translateBRRESPart(bytes, 'course', 0, [25, 10, -5]);
  const after = parseBRRES(moved).models[0];
  expect(after.objects[0].positions.slice(0, 3)).toEqual(new Float32Array([25, 10, -5]));
  expect(v.getFloat32(0x340)).toBe(0); // input stays untouched
  expect(new DataView(moved.buffer).getFloat32(0x320)).toBe(25); // vertex minimum X
  expect(new DataView(moved.buffer).getFloat32(0x32C)).toBe(125); // vertex maximum X
  const angle = Math.PI / 2;
  const transformed = transformBRRESPart(bytes, 'course', 0, null, {
    center: [0, 0, 0], rotation: [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)], scale: [2, 2, 2],
  });
  const points = parseBRRES(transformed).models[0].objects[0].positions;
  expect(points[3]).toBeCloseTo(200, 2);
  expect(Math.abs(points[6])).toBeLessThan(0.001);
  expect(points[8]).toBeCloseTo(-200, 2);
});

const rand = (seed) => () => ((seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF) / 0x7FFFFFFF);

test('Yaz0: compress + decompress returns the same bytes', () => {
  const r = rand(42);
  const src = new Uint8Array(200000);
  for (let i = 0; i < src.length; i++) src[i] = i % 1000 < 500 ? (i * 7) & 0xFF : Math.floor(r() * 4);
  const comp = yaz0Compress(src);
  expect(comp.length).toBeLessThan(src.length);
  expect(yaz0Decompress(comp)).toEqual(src);
  // Random (incompressible) and empty data
  const noise = new Uint8Array(5000).map(() => Math.floor(r() * 256));
  expect(yaz0Decompress(yaz0Compress(noise))).toEqual(noise);
  expect(yaz0Decompress(yaz0Compress(new Uint8Array(0)))).toEqual(new Uint8Array(0));
});

test('YLZ: LZMA stream inside Yaz0 header decompresses', () => {
  const raw = new Uint8Array([0x55, 0xaa, 0x38, 0x2d, ...Array.from({ length: 512 }, (_, i) => i & 0xff)]);
  const compressed = lzmaCompress(raw);
  const file = new Uint8Array(16 + compressed.length);
  file.set([0x59, 0x61, 0x7a, 0x30, raw.length >>> 24, raw.length >>> 16, raw.length >>> 8, raw.length & 255], 0);
  file.set(raw.slice(0, 4), 12);
  file.set(compressed, 16);
  expect(yaz0Decompress(file)).toEqual(raw);
});

test('WLZ archives are recognized with a specific explanation', () => {
  expect(isWLZ(new Uint8Array([0x57, 0x4c, 0x5a, 0x61, ...Array(12).fill(0)]))).toBe(true);
  expect(isWU8(new Uint8Array([0x57, 0x55, 0x38, 0x61, ...Array(12).fill(0)]))).toBe(true);
  expect(isWBZ(new Uint8Array([0x57, 0x42, 0x5a, 0x61, ...Array(12).fill(0)]))).toBe(true);
  expect(isYBZ(new Uint8Array([0x59, 0x61, 0x7a, 0x30, ...Array(12).fill(0), 0x42, 0x5a, 0x68]))).toBe(true);
  expect(WLZ_MESSAGE).toContain('Race/Course');
});

test('U8: nested archive round trip', () => {
  const root = newSzsTree();
  setFile(root, 'course.kmp', new Uint8Array([1, 2, 3]));
  setFile(root, 'course.kcl', new Uint8Array([4, 5, 6, 7]));
  root.children[0].children.push({ name: 'posteffect', children: [{ name: 'posteffect.bfg', data: new Uint8Array([9]) }] });
  const parsed = parseU8(buildU8(root));
  expect(findFile(parsed, 'course.kcl').data).toEqual(new Uint8Array([4, 5, 6, 7]));
  expect(findFile(parsed, 'posteffect.bfg').data).toEqual(new Uint8Array([9]));
  expect(buildU8(parsed)).toEqual(buildU8(root));
});

test('KMP: write + read keeps the data', () => {
  const doc = emptyKMP();
  doc.KTPT.push(make.KTPT([10, 20, 30], [0, 90, 0]));
  doc.ENPT.push(make.group([make.ENPT([0, 0, 0]), make.ENPT([100, 0, 0])]), make.group([make.ENPT([200, 0, 0])]));
  doc.ENPT[0].next = [1]; doc.ENPT[1].prev = [0]; doc.ENPT[1].next = [0]; doc.ENPT[0].prev = [1];
  doc.CKPT.push(make.group([make.CKPT(), make.CKPT([-5, 5], [5, 5]), make.CKPT()]));
  doc.CKPT[0].points[0].type = 0;
  doc.GOBJ.push(make.GOBJ(0x65, [1, 2, 3]));
  doc.POTI.push(make.route([make.routePoint([1, 1, 1]), make.routePoint([2, 2, 2])]));
  doc.AREA.push(make.AREA());
  doc.CAME.push(make.CAME());
  doc.JGPT.push(make.JGPT());
  const bin = buildKMP(doc);
  const back = parseKMP(bin);
  expect(back.KTPT[0].pos).toEqual([10, 20, 30]);
  expect(back.ENPT.length).toBe(2);
  expect(back.ENPT[0].points.length).toBe(2);
  expect(back.ENPT[1].prev).toEqual([0]);
  expect(back.CKPT[0].points[1].left).toEqual([-5, 5]);
  expect(back.CKPT[0].points[1].prev).toBe(0);
  expect(back.CKPT[0].points[1].next).toBe(2);
  expect(back.CKPT[0].points[0].type).toBe(0);
  expect(back.GOBJ[0].objectId).toBe(0x65);
  expect(back.POTI[0].points[1].pos).toEqual([2, 2, 2]);
  expect(back.extras.POTI).toBe(2);
  expect(back.STGI[0].laps).toBe(3);
  expect(buildKMP(back)).toEqual(bin);
});

test('KCL: every triangle is found by the game-style octree lookup', () => {
  // 40x40 wavy grid (3200 triangles).
  const verts = [], flags = [];
  const N = 40, S = 500;
  const hgt = (x, z) => Math.sin(x * 0.7) * 300 + Math.cos(z * 0.4) * 200;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const p = (a, b) => [a * S - 10000, hgt(a, b), b * S - 10000];
    const a = p(i, j), b = p(i + 1, j), c = p(i + 1, j + 1), d = p(i, j + 1);
    verts.push(...a, ...d, ...c, ...a, ...c, ...b);
    flags.push(0x0000, 0x0003);
  }
  const kclData = buildKCL(verts, flags);
  const kcl = parseKCL(kclData);
  expect(kcl.count).toBe(flags.length);
  // Rebuilt vertices match the originals.
  for (let t = 0; t < 50; t++) for (let k = 0; k < 9; k++) expect(kcl.verts[t * 9 + k]).toBeCloseTo(verts[t * 9 + k], 1);
  expect(kcl.flags[1]).toBe(3);
  // Every centroid must find its own triangle in the octree list.
  for (let t = 0; t < flags.length; t++) {
    const c = [0, 1, 2].map((k) => (verts[t * 9 + k] + verts[t * 9 + 3 + k] + verts[t * 9 + 6 + k]) / 3);
    const list = kclLookup(kclData, c);
    expect(list).not.toBeNull();
    expect(list.includes(t)).toBe(true);
  }
  // Outside the area: no result.
  expect(kclLookup(kclData, [1e6, 0, 0])).toBeNull();
  // Flag patching
  kcl.flags[0] = 0x000C;
  expect(parseKCL(patchKCLFlags(kcl)).flags[0]).toBe(0x000C);
});

test('KCL: detailed collision up to the format limit is encoded (shared normals)', () => {
  // 180x180 curved terrain: 64,800 triangles, about four different normals each before sharing.
  const N = 180, S = 40000 / N, verts = new Float32Array(N * N * 18);
  const hgt = (x, z) => Math.sin(x / 1700) * 900 + Math.cos(z / 1300) * 700 + Math.sin((x + z) / 530) * 120;
  let o = 0;
  const put = (x, z) => { verts[o++] = x; verts[o++] = hgt(x, z); verts[o++] = z; };
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const x0 = i * S - 20000, z0 = j * S - 20000, x1 = x0 + S, z1 = z0 + S;
    put(x0, z0); put(x0, z1); put(x1, z0);
    put(x1, z0); put(x0, z1); put(x1, z1);
  }
  const kcl = parseKCL(buildKCL(verts, new Uint16Array(N * N * 2)));
  expect(kcl.count).toBe(N * N * 2);
  // Corners rebuilt from the shared normals stay within a few units of the model.
  let worst = 0, total = 0;
  for (let i = 0; i < verts.length; i++) { const e = Math.abs(kcl.verts[i] - verts[i]); worst = Math.max(worst, e); total += e; }
  expect(total / verts.length).toBeLessThan(0.5);
  expect(worst).toBeLessThan(8); // a kart is about 200 units long
  expect(() => buildKCL(new Float32Array(65535 * 9).map((_, i) => (i % 9 === 3 ? 100 : i % 9 === 8 ? 100 : 0) + Math.floor(i / 9) * 1000 * (i % 3 === 0)), new Uint16Array(65535))).toThrow(/65,534/);
});

test('Foreign model part DAE: renames, moves and keeps only the chosen triangles', async () => {
  const { foreignPartDae } = await import('../src/model-operations.ts');
  const xml = `<COLLADA><asset><up_axis>Y_UP</up_axis></asset>
<library_images><image id="tex.1-image" name="tex.1"><init_from>part_maps\tex.1.png</init_from></image></library_images>
<library_materials><material id="road" name="road"><instance_effect url="#road-fx"/></material></library_materials>
<library_effects><effect id="road-fx" name="road"><profile_COMMON><newparam sid="tex.1-surface"><surface type="2D"><init_from>tex.1-image</init_from></surface></newparam>
<newparam sid="tex.1-sampler"><sampler2D><source>tex.1-surface</source></sampler2D></newparam><technique sid="COMMON"><phong><diffuse><texture texture="tex.1-sampler" texcoord="CHANNEL0"/></diffuse></phong></technique></profile_COMMON></effect></library_effects>
<library_geometries><geometry id="poly-lib" name="poly"><mesh><source id="poly-POSITION"><float_array id="poly-POSITION-array" count="12">0 0 0 1 0 0 0 1 0 5 5 5</float_array></source>
<vertices id="poly-VERTEX"><input semantic="POSITION" source="#poly-POSITION"/></vertices>
<triangles count="2" material="road"><input semantic="VERTEX" source="#poly-VERTEX" offset="0"/><p>0 1 2 1 2 3</p></triangles></mesh></geometry></library_geometries>
<library_visual_scenes><visual_scene id="s"><node id="bone" type="JOINT"/></visual_scene></library_visual_scenes></COLLADA>`;
  const materials = { road: { settings: { name: 'road' }, layers: [{ name: 'tex.1' }], polygons: { poly: { draw_priority: 3 } }, pat0: { frames: [{ frame: 0, texture: 'tex.1' }] } }, other: {} };
  const out = foreignPartDae(xml, materials, {
    polygon: 'poly', name: 'src_poly', materialNames: { road: 'src_road' }, textureNames: { 'tex.1': 'src_tex.1' },
    wanted: [[[0, 1, 0], [0, 0, 0], [1, 0, 0.001]]], delta: [10, 0, 0],
  });
  expect(out.triangles).toBe(1);
  expect(out.xml).toContain('<p>0 1 2</p>');
  expect(out.xml).toContain('count="1" material="src_road"');
  expect(out.xml).toContain('10 0 0 11 0 0 10 1 0 15 5 5');
  expect(out.xml).toContain('<geometry id="src_poly-lib" name="src_poly">');
  expect(out.xml).toContain('<instance_geometry url="#src_poly-lib">');
  expect(out.xml).not.toContain('JOINT');
  expect(out.xml).toContain('<material id="src_road" name="src_road"><instance_effect url="#src_road-fx"/>');
  expect(out.xml).toContain('<init_from>maps/src_tex.1.png</init_from>');
  expect(out.xml).toContain('texture="src_tex.1-sampler"');
  expect(Object.keys(out.json)).toEqual(['src_road']);
  expect(out.json.src_road.layers[0].name).toBe('src_tex.1');
  expect(out.json.src_road.pat0.frames[0].texture).toBe('src_tex.1');
  expect(out.json.src_road.polygons).toEqual({ src_poly: { draw_priority: 3 } });
});
