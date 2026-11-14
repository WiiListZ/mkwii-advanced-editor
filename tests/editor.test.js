import { test, expect } from 'bun:test';
import { generateTrack, PRESETS } from '../web/js/editor/trackgen.js';
import { TrackDocument } from '../web/js/editor/document.js';
import { Ops } from '../web/js/editor/ops.js';
import { validate } from '../web/js/editor/validate.js';
import { buildKCL, parseKCL, kclLookup } from '../web/js/formats/kcl.js';
import { buildKMP, parseKMP, make } from '../web/js/formats/kmp.js';
import { newSzsTree } from '../web/js/formats/u8.js';
import { BUILTIN_OBJECT_DOCUMENTATION, objectDocumentation, parseObjectDocumentation } from '../web/js/data/object-documentation.js';
import { ROUTE_REQUIRED_OBJECTS, routeRequired } from '../web/js/data/route-objects.js';

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

test('Route-following objects without a route are reported, fixed and never created', () => {
  const { doc } = docFromPreset('Oval');
  const ops = new Ops(doc, settings);
  // A w_woodbox (0xd3) with route 0xFFFF crashes the game: invalid read from 0x00000000.
  const box = make.GOBJ(0xd3, [100, 200, 300]);
  box.rot = [0, 90, 0];
  doc.kmp.GOBJ.push(box);
  doc.invalidate();
  const issue = validate(doc, ops, null).find((i) => i.key === String(box.uid));
  expect(issue?.level).toBe('error');
  const routes = doc.kmp.POTI.length;
  expect(ops.addMissingObjectRoutes()).toBe(1);
  expect(box.route).toBe(routes);
  const points = doc.kmp.POTI[routes].points.map((p) => p.pos.map(Math.round));
  expect(points).toEqual([[100, 200, 300], [1100, 200, 300]]);
  expect(validate(doc, ops, null).some((i) => i.key === String(box.uid))).toBe(false);
  // Placing one creates its route straight away; item boxes stay without a route.
  ops.add('GOBJ', [0, 0, 0], { objectId: 0xd3 });
  expect(doc.kmp.GOBJ.at(-1).route).toBe(routes + 1);
  expect(doc.kmp.POTI[routes + 1].points).toHaveLength(2);
  ops.add('GOBJ', [0, 0, 0], { objectId: 0x65 });
  expect(doc.kmp.GOBJ.at(-1).route).toBe(0xFFFF);
});

test('Object documentation decides required routes and settings', () => {
  const { doc } = docFromPreset('Oval');
  const ops = new Ops(doc, settings);
  const docs = parseObjectDocumentation({ version: 1, objects: {
    '0x03e8': { route: { required: true, description: 'Moves along it.' }, settings: { 2: { label: 'Speed', required: true } } },
    w_woodbox: { route: { required: false } },
  } });
  ops.objectDocumentation = (id) => objectDocumentation(id, id === 0xd3 ? 'w_woodbox' : '', docs);
  const custom = make.GOBJ(0x3e8, [0, 0, 0]), box = make.GOBJ(0xd3, [0, 0, 0]);
  doc.kmp.GOBJ.push(custom, box);
  doc.invalidate();
  const issues = validate(doc, ops, null);
  const mine = (o) => issues.filter((i) => i.key === String(o.uid));
  // A custom object the documentation says needs a route, and a required setting left at 0.
  expect(mine(custom).map((i) => i.level).sort()).toEqual(['error', 'warning']);
  expect(mine(custom).find((i) => i.level === 'warning').msg).toContain('setting 2 (Speed)');
  // The documentation overrides the built-in list: this w_woodbox needs no route here.
  expect(mine(box)).toEqual([]);
  custom.settings[1] = 5;
  expect(validate(doc, ops, null).filter((i) => i.key === String(custom.uid)).map((i) => i.level)).toEqual(['error']);
  expect(ops.addMissingObjectRoutes()).toBe(1);
  expect(box.route).toBe(0xFFFF);
  // Malformed route documentation is refused.
  expect(() => parseObjectDocumentation({ version: 1, objects: { a: { route: true } } })).toThrow('route');
  expect(() => parseObjectDocumentation({ version: 1, objects: { a: { settings: { 1: { label: 'x', required: 1 } } } } })).toThrow('required');
  // The default documentation states the route of every route-following object of the built-in list.
  const stated = Object.values(BUILTIN_OBJECT_DOCUMENTATION).filter((entry) => entry.route?.required).length;
  expect(stated).toBe(ROUTE_REQUIRED_OBJECTS.size);
  expect(objectDocumentation(0xd3, 'w_woodbox').route).toEqual({ required: true });
  expect(routeRequired(0x65, (id) => objectDocumentation(id, 'itembox'))).toBe(false);
});

test('Track check finds cannons without destinations, missing object files and broken camera links', () => {
  const { doc } = docFromPreset('Oval');
  const ops = new Ops(doc, settings);
  doc.kcl.flags[0] = 0x11 | (1 << 5); // cannon 1, with no CNPT
  doc.szs = newSzsTree();
  doc.kmp.GOBJ.push(make.GOBJ(0xd3, [0, 0, 0]));
  doc.kmp.GOBJ.at(-1).route = 0;
  doc.kmp.POTI.push(make.route([make.routePoint([0, 0, 0]), make.routePoint([10, 0, 0])]));
  doc.kmp.extras = { ...(doc.kmp.extras || {}), CAME: (200 << 8) | 0xff };
  doc.invalidate();
  const issues = validate(doc, ops, null), messages = issues.map((i) => `${i.level}: ${i.msg}`);
  expect(messages.some((m) => m.startsWith('error') && m.includes('cannon 1') && m.includes('0 cannon destinations'))).toBe(true);
  // What crashes the game is told apart from the other errors.
  expect(issues.find((i) => i.msg.includes('cannon 1')).crash).toBe(true);
  expect(issues.find((i) => i.msg.includes('woodbox.brres')).crash).toBe(true);
  expect(messages.some((m) => m.startsWith('error') && m.includes('woodbox.brres'))).toBe(true);
  expect(messages.some((m) => m.startsWith('warning') && m.includes('rk_woodbox.breff'))).toBe(true);
  expect(messages.some((m) => m.startsWith('warning') && m.includes('camera 200'))).toBe(true);
  // Files that saving copies from the tracks folder are not reported.
  ops.objectFilesAvailable = (id) => id === 0xd3;
  expect(validate(doc, ops, null).some((i) => i.msg.includes('woodbox.brres'))).toBe(false);
});

test("What the game's own tracks have is not an error: arenas, scenes, route-searching cameras", () => {
  const { doc } = docFromPreset('Oval');
  const ops = new Ops(doc, settings);
  // A route-searching camera (type 2) without a route, and a fixed camera (type 3) linking a missing
  // route, as in boardcross_course and old_koopa_gba; a one-point route as in shopping_course.
  doc.kmp.CAME.push({ ...make.CAME([0, 0, 0]), type: 2 }, { ...make.CAME([0, 0, 0]), type: 3, route: 251 });
  doc.kmp.POTI.push(make.route([make.routePoint([0, 0, 0])]));
  doc.invalidate();
  expect(validate(doc, ops, null).filter((i) => i.level === 'error').map((i) => i.msg)).toEqual([]);
  // An arena has no checkpoints or item routes; a race track without them is told.
  doc.kmp.CKPT = []; doc.kmp.ITPT = [];
  expect(validate(doc, ops, null).some((i) => i.level === 'error' && i.msg.startsWith('Checkpoints: no groups'))).toBe(true);
  doc.kmp.MSPT.push(make.MSPT([0, 0, 0]));
  expect(validate(doc, ops, null).filter((i) => i.msg.includes('no groups'))).toEqual([]);
});

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
