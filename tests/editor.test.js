import { test, expect } from 'bun:test';
import { generateTrack, PRESETS } from '../web/js/editor/trackgen.js';
import { TrackDocument } from '../web/js/editor/document.js';
import { Ops } from '../web/js/editor/ops.js';
import { validate } from '../web/js/editor/validate.js';
import { buildKCL, parseKCL, kclLookup } from '../web/js/formats/kcl.js';
import { buildKMP, parseKMP, make } from '../web/js/formats/kmp.js';

const settings = { checkpointWidth: 3000, autoCheckpointWidth: true, iconSize: 150, pathWidth: 20, viewCenter: () => [0, 0, 0] };

function docFromPreset(name) {
  const out = generateTrack(PRESETS[name](), {});
  const kclBytes = buildKCL(out.verts, out.flags);
  const doc = new TrackDocument();
  doc.kmp = parseKMP(buildKMP(out.kmp));
  doc.kcl = parseKCL(kclBytes);
  doc.loaded();
  return { doc, out, kclBytes };
}

for (const name of ['Oval', 'Figure eight', 'Kidney', 'Hilly']) {
  test(`Generator "${name}": valid collision and KMP with no validator errors`, () => {
    const { doc, out, kclBytes } = docFromPreset(name);
    expect(doc.kcl.count).toBe(out.flags.length);
    // Every start position and respawn has collision right below it, found through the octree.
    for (const p of [...doc.kmp.KTPT, ...doc.kmp.JGPT]) {
      const list = kclLookup(kclBytes, [p.pos[0], p.pos[1] + 10, p.pos[2]]);
      expect(list && list.length > 0).toBe(true);
    }
    const ops = new Ops(doc, settings);
    const issues = validate(doc, ops, null);
    const errors = issues.filter((i) => i.level === 'error');
    if (errors.length) console.log(errors.map((e) => e.msg));
    expect(errors.length).toBe(0);
  });
}

test('Checkpoints face the driving direction (left/right convention)', () => {
  const { doc } = docFromPreset('Oval');
  const ops = new Ops(doc, settings);
  for (const cp of doc.kmp.CKPT[0].points) {
    const mx = (cp.left[0] + cp.right[0]) / 2, mz = (cp.left[1] + cp.right[1]) / 2;
    const dir = ops.nearestEnemyDir(mx, mz);
    const fx = cp.right[1] - cp.left[1], fz = -(cp.right[0] - cp.left[0]);
    expect(fx * dir[0] + fz * dir[1]).toBeGreaterThan(0);
  }
});

test('Deleting remaps indices (respawns, routes, groups)', () => {
  const doc = new TrackDocument();
  const ops = new Ops(doc, settings);
  const k = doc.kmp;
  k.JGPT.push(make.JGPT([0, 0, 0]), make.JGPT([1, 0, 0]), make.JGPT([2, 0, 0]));
  const cp = make.CKPT();
  cp.respawn = 2;
  k.CKPT.push(make.group([cp]));
  k.POTI.push(make.route([make.routePoint(), make.routePoint()]), make.route([make.routePoint(), make.routePoint()]));
  const obj = make.GOBJ(0x65);
  obj.route = 1;
  k.GOBJ.push(obj);
  k.ENPT.push(make.group([make.ENPT()]), make.group([make.ENPT()]), make.group([make.ENPT()]));
  k.ENPT[0].next = [1, 2]; k.ENPT[2].prev = [0, 1];
  doc.loaded();

  doc.select([String(k.JGPT[0].uid), String(k.POTI[0].uid), String(k.ENPT[1].uid)]);
  ops.deleteSelection();
  expect(doc.kmp.JGPT.length).toBe(2);
  expect(doc.kmp.CKPT[0].points[0].respawn).toBe(1);
  expect(doc.kmp.GOBJ[0].route).toBe(0);
  expect(doc.kmp.ENPT.length).toBe(2);
  expect(doc.kmp.ENPT[0].next).toEqual([1]);
  expect(doc.kmp.ENPT[1].prev).toEqual([0]);

  // Undo brings everything back.
  doc.undo();
  expect(doc.kmp.JGPT.length).toBe(3);
  expect(doc.kmp.CKPT[0].points[0].respawn).toBe(2);
  expect(doc.kmp.ENPT[0].next).toEqual([1, 2]);
});

test('Adding points inserts after the selected one', () => {
  const doc = new TrackDocument();
  const ops = new Ops(doc, settings);
  ops.add('ENPT', [0, 0, 0]);
  ops.add('ENPT', [1000, 0, 0]);
  const first = doc.kmp.ENPT[0].points[0];
  doc.select(String(first.uid));
  ops.add('ENPT', [500, 0, 0]);
  expect(doc.kmp.ENPT[0].points.map((p) => p.pos[0])).toEqual([0, 500, 1000]);
  ops.add('CKPT', [0, 0, 0]);
  expect(doc.kmp.CKPT[0].points[0].type).toBe(0);
  ops.duplicateSelection();
  expect(doc.kmp.CKPT[0].points.length).toBe(2);
  expect(doc.kmp.CKPT[0].points[1].type).toBe(0xFF);
});
