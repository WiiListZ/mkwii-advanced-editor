import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mtlImageName, resourceFinder } from '../src/model-operations.ts';

test('MTL map options are removed from the image name', () => {
  expect(mtlImageName('grass.png')).toBe('grass.png');
  expect(mtlImageName('-s 1 1 1 -bm 0.5 grass.png')).toBe('grass.png');
  expect(mtlImageName('-o 0.5 my grass.png')).toBe('my grass.png');
  expect(mtlImageName('-blendu on -clamp off C:\\Textures\\grass.png')).toBe('C:\\Textures\\grass.png');
});

test('OBJ resources are found inside the model folder, also from foreign paths', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mkwii-obj-resources-'));
  try {
    const model = join(dir, 'model');
    await mkdir(join(model, 'textures'), { recursive: true });
    await writeFile(join(model, 'model.mtl'), '');
    await writeFile(join(model, 'textures', 'Wood.png'), '');
    await writeFile(join(dir, 'outside.png'), '');
    const find = resourceFinder(model);
    expect(await find('model.mtl')).toBe(join(model, 'model.mtl'));
    expect(await find('textures/Wood.png')).toBe(join(model, 'textures', 'Wood.png'));
    expect(await find('C:\\Users\\Author\\Desktop\\wood.png')).toBe(join(model, 'textures', 'Wood.png'));
    expect(await find('../textures/wood.png')).toBe(join(model, 'textures', 'Wood.png'));
    // A file outside the model folder is never read, even when the path points to it.
    expect(await find('../outside.png')).toBeNull();
    expect(await find('missing.png')).toBeNull();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
