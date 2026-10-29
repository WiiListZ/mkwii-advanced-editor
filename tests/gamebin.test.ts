import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { binTable, guessBinLayout, isCompressedBin, objFlowNames, readBinValue, readRgba, writeBinValue, writeRgba } from '../web/js/formats/gamebin.js';
import { isItemSlot, isStatsFile } from '../web/js/formats/params.js';
import { listFiles, parseU8 } from '../web/js/formats/u8.js';
import { yaz0Decompress } from '../web/js/formats/yaz0.js';

const bytes = (size: number, fill: (v: DataView) => void) => { const d = new Uint8Array(size); fill(new DataView(d.buffer)); return d; };

test('layouts are read from the count header', () => {
  // One count: 3 rows of 8 bytes.
  const one = bytes(4 + 3 * 8, (v) => { v.setUint32(0, 3); v.setFloat32(4, 1.5); v.setUint32(8, 7); });
  expect(guessBinLayout(one)).toEqual({ header: 4, rowSize: 8, counts: [3], type: 'auto' });
  const table = binTable('one.bin', one);
  expect(table.rows.length).toBe(3);
  expect(table.rows[0].fields.map((f: any) => f.type)).toEqual(['f32', 's32']);
  // Two counts (vehicles × characters): 2 × 3 rows of 4 bytes.
  const two = bytes(8 + 6 * 4, (v) => { v.setUint32(0, 2); v.setUint32(4, 3); });
  expect(guessBinLayout(two)).toMatchObject({ header: 8, rowSize: 4, counts: [2, 3] });
  expect(binTable('two.bin', two).rows[4].label).toBe('Entry 2.2');
  // No header: rows of 16 bytes; a layout chosen by hand wins.
  const plain = bytes(32, (v) => v.setFloat32(0, 65));
  expect(guessBinLayout(plain)).toMatchObject({ header: 0, rowSize: 16 });
  expect(binTable('plain.bin', plain, { override: { header: 0, rowSize: 8, type: 'u16' } }).rows[0].fields.length).toBe(4);
});

test('values are written in place with their type and limits', () => {
  const d = new Uint8Array(8);
  const f = writeBinValue(d, 0, 'f32', 2.5);
  expect(f.length).toBe(8);
  expect(readBinValue(f, 0, 'f32')).toBe(2.5);
  expect(readBinValue(writeBinValue(d, 4, 's16', -3), 4, 's16')).toBe(-3);
  expect(() => writeBinValue(d, 6, 'u8', 300)).toThrow();
  expect(() => writeBinValue(d, 6, 'u32', 1)).toThrow();
  expect(d.every((b) => b === 0)).toBe(true);
});

test('ObjFlow and GeoHitTable rows are named after the objects', () => {
  const entry = 0x74;
  const flow = bytes(2 + 2 * entry + 4, (v) => {
    v.setUint16(0, 2);
    [[0x65, 'itembox', 'itembox'], [0xd1, 'car_body', 'car_body;car_light']].forEach(([id, name, res], i) => {
      const base = 2 + i * entry;
      v.setUint16(base, id as number);
      [...(name as string)].forEach((c, k) => v.setUint8(base + 2 + k, c.charCodeAt(0)));
      [...(res as string)].forEach((c, k) => v.setUint8(base + 0x22 + k, c.charCodeAt(0)));
      v.setInt16(base + 0x6a, i + 1);
    });
  });
  const flowTable = binTable('ObjFlow.bin', flow);
  expect(flowTable.kind).toBe('objflow');
  expect(flowTable.rows[1].label).toBe('car_body');
  expect(flowTable.rows[1].fields.find((f: any) => f.label === 'Solidity').at).toBe(2 + entry + 0x6a);
  const names = objFlowNames(flow);
  const geo = bytes(4 + 2 * (2 + 3 * 2), (v) => { v.setUint16(0, 2); v.setUint16(2, 3); v.setUint16(4, 0x65); v.setUint16(12, 0xd1); v.setInt16(14, 30); });
  const geoTable = binTable('GeoHitTableKart.bin', geo, { objectNames: names });
  expect(geoTable.kind).toBe('geohit');
  expect(geoTable.rows.map((r: any) => r.label)).toEqual(['itembox', 'car_body']);
  expect(geoTable.rows[1].fields.map((f: any) => f.label)).toEqual(['No power-up', 'Star', 'Mega Mushroom']);
  expect(readBinValue(geo, geoTable.rows[1].fields[0].at, 'u16')).toBe(30);
});

test('LZ77-compressed files are recognised and not edited', () => {
  const lz = new Uint8Array([0x10, 0x00, 0x01, 0x00, 1, 2, 3, 4, 5, 6, 7, 8]);
  expect(isCompressedBin(lz)).toBe(true);
  expect(binTable('letter.bin', lz).kind).toBe('compressed');
});

// Every .bin of the real Race/Common.szs opens (MKWII_GAME_DIR = extracted game files).
test('every .bin of Race/Common.szs opens', () => {
  const game = process.env.MKWII_GAME_DIR;
  if (!game || !existsSync(join(game, 'Race', 'Common.szs'))) return;
  const tree = parseU8(yaz0Decompress(new Uint8Array(readFileSync(join(game, 'Race', 'Common.szs')))));
  const bins = listFiles(tree).filter((f: any) => /\.bin$/i.test(f.path));
  const names = objFlowNames(bins.find((f: any) => /ObjFlow/i.test(f.path)).node.data);
  expect(bins.length).toBeGreaterThan(15);
  for (const f of bins) {
    const data = f.node.data;
    if (isStatsFile(f.path, data) || isItemSlot(f.path, data)) continue;
    const table = binTable(f.path, data, { objectNames: names });
    expect(table.rows.length).toBeGreaterThan(0);
    for (const row of table.rows) for (const field of row.fields) if (field.at !== undefined) expect(field.at + 1).toBeLessThanOrEqual(data.length);
    if (/GeoHitTable/i.test(f.path)) expect(table.rows.find((r: any) => r.label === 'itembox')).toBeTruthy();
  }
});

// The documented layouts match the real files: every one of them is recognised, not read as a generic table.
test('documented .bin files of the game use their documented layout', () => {
  const game = process.env.MKWII_GAME_DIR;
  if (!game || !existsSync(join(game, 'Race', 'Common.szs'))) return;
  const open = (path: string) => parseU8(yaz0Decompress(new Uint8Array(readFileSync(join(game, ...path.split('/'))))));
  const files = [...listFiles(open('Race/Common.szs')), ...listFiles(open('Scene/UI/Award.szs')), ...listFiles(open('Scene/UI/MenuSingle.szs')), ...listFiles(open('Scene/UI/Channel_E.szs'))]
    .filter((f: any) => /\.bin$/i.test(f.path));
  const generic = files.filter((f: any) => !isStatsFile(f.path, f.node.data) && !isItemSlot(f.path, f.node.data) && binTable(f.path, f.node.data).kind === 'table');
  expect(generic.map((f: any) => f.path)).toEqual([]);
  const camera = binTable('kartCameraParam.bin', files.find((f: any) => /kartCameraParam/.test(f.path)).node.data);
  expect(camera.rows[0].label).toBe('Small vehicles · race');
  expect(readBinValue(files.find((f: any) => /kartCameraParam/.test(f.path)).node.data, camera.rows[0].fields[0].at, 'f32')).toBe(65);
  const driver = files.find((f: any) => /kartDriverDispParam/.test(f.path)).node.data;
  const rows = binTable('kartDriverDispParam.bin', driver).rows;
  // Baby Mario on the Standard Kart S has a seat position, Bowser (a large character) none.
  const at = (label: string) => readBinValue(driver, rows.find((r: any) => r.label === label).fields[0].at, 'f32');
  expect(at('Standard Kart S · Baby Mario')).not.toBe(0);
  expect(at('Standard Kart S · Bowser')).toBe(0);
});

// Opening cameras (.bcp) and vehicle physics (.bsp) of Race/Common.szs.
test('.bcp and .bsp files open with their documented fields', () => {
  const game = process.env.MKWII_GAME_DIR;
  if (!game || !existsSync(join(game, 'Race', 'Common.szs'))) return;
  const files = listFiles(parseU8(yaz0Decompress(new Uint8Array(readFileSync(join(game, 'Race', 'Common.szs'))))));
  const bcps = files.filter((f: any) => /\.bcp$/i.test(f.path)), bsps = files.filter((f: any) => /\.bsp$/i.test(f.path));
  expect(bcps.length).toBe(4);
  expect(bsps.length).toBe(36);
  for (const f of [...bcps, ...bsps]) {
    const table = binTable(f.path, f.node.data);
    expect(table.kind).toBe('schema');
    for (const row of table.rows) for (const field of row.fields) expect(field.at + 4).toBeLessThanOrEqual(f.node.data.length);
  }
  const race = bcps.find((f: any) => /race_camera/.test(f.path));
  const settings = binTable(race.path, race.node.data).rows[0];
  expect(readBinValue(race.node.data, settings.fields.find((x: any) => x.label === 'First point to ignore').at, 'u16')).toBe(7);
  const flame = bsps.find((f: any) => /la_bike\.bsp$/.test(f.path));
  const physics = binTable(flame.path, flame.node.data);
  expect(physics.title).toBe('Vehicle physics · Flame Runner');
  expect(physics.rows.map((r: any) => r.label)).toContain('Hitbox 16');
  expect(physics.rows.map((r: any) => r.label)).toContain('Front wheel');
  // Every vehicle file has a name and an enabled first wheel.
  for (const f of bsps) {
    const t = binTable(f.path, f.node.data);
    expect(t.title).not.toBe('Vehicle physics');
    const wheel = t.rows.find((r: any) => /^Front wheel/.test(r.label));
    expect(readBinValue(f.node.data, wheel.fields[0].at, 'u16')).toBe(1);
  }
});

test('colours are read and written as RGBA', () => {
  const d = new Uint8Array(8);
  const out = writeRgba(d, 4, '#ff8000', 200);
  expect(readRgba(out, 4)).toEqual({ hex: '#ff8000', alpha: 200 });
  expect(() => writeRgba(d, 6, '#ffffff', 255)).toThrow();
  expect(() => writeRgba(d, 0, 'red', 255)).toThrow();
});

// Lights (.blight) and light maps (.blmap) of the tracks and of Race/Common.szs.
test('.blight and .blmap files open with their documented fields', () => {
  const game = process.env.MKWII_GAME_DIR;
  if (!game || !existsSync(join(game, 'Race', 'Common.szs'))) return;
  const open = (path: string) => listFiles(parseU8(yaz0Decompress(new Uint8Array(readFileSync(join(game, ...path.split('/')))))));
  const files = [...open('Race/Common.szs'), ...open('Race/Course/castle_course.szs'), ...open('Race/Course/kinoko_course.szs')]
    .filter((f: any) => /\.(blight|blmap)$/i.test(f.path));
  expect(files.filter((f: any) => /\.blight$/i.test(f.path)).length).toBeGreaterThanOrEqual(3);
  for (const f of files) {
    const table = binTable(f.path, f.node.data);
    expect(table.kind).toBe('lighting');
    for (const row of table.rows) for (const field of row.fields) if (field.at !== undefined) expect(field.at + 1).toBeLessThanOrEqual(f.node.data.length);
  }
  const blight = files.find((f: any) => /castle_course|posteffect\.blight$/i.test(f.path) && /\.blight$/i.test(f.path));
  const lights = binTable(blight.path, blight.node.data);
  expect(lights.rows.map((r: any) => r.label)).toEqual(['General', ...Array.from({ length: 16 }, (_, i) => `Light ${i}${i < 8 ? '' : ' (not usable from the KCL)'}`), 'Ambient colours']);
  expect(lights.rows[0].fields[0].type).toBe('rgba');
  expect(readRgba(blight.node.data, lights.rows[0].fields[0].at)).toEqual({ hex: '#000000', alpha: 255 });
  const blmap = files.find((f: any) => /\.blmap$/i.test(f.path));
  const maps = binTable(blmap.path, blmap.node.data);
  expect(maps.rows.length).toBe(2);
  expect(maps.rows[0].fields.filter((x: any) => /intensity/.test(x.label)).length).toBe(32);
});
