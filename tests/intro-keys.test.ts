import { test, expect } from "bun:test";
import { emptyKMP } from "../web/js/formats/kmp.js";
import { introChain, routeSectionLengths, simulateCamera } from "../web/js/editor/cameras.js";
import { appendShot, fixIntroShots, introKeyframes, introShotIssues, moveKey, removeKey, setKeyPose, shotSpeedLimits, splitShot } from "../web/js/editor/intro-keys.js";
import { headingOf, turnYaw } from "../web/js/editor/heading.js";
import { TrackDocument } from "../web/js/editor/document.js";
import { Ops } from "../web/js/editor/ops.js";

const pose = (x: number, tx: number, fov = 40) => ({ position: [x, 1000, 0], target: [tx, 0, 0], fov });

function twoKeyIntro() {
  const kmp: any = emptyKMP();
  appendShot(kmp, pose(0, 500), 0); // a still first keyframe
  kmp.CAME[0].time = 120;
  setKeyPose(kmp, introKeyframes(kmp).keys[1], pose(1200, 2000, 60));
  return kmp;
}

test("keyframes: the camera reaches the next keyframe at its time", () => {
  const kmp = twoKeyIntro();
  const { keys, total } = introKeyframes(kmp);
  expect(keys.map((k: any) => k.frame)).toEqual([0, 120]);
  expect(total).toBe(120);
  const poses = simulateCamera(kmp, 0);
  expect(poses[0].position[0]).toBeCloseTo(0);
  expect(poses[119].position[0]).toBeGreaterThan(1150);
  expect(poses[119].target[0]).toBeGreaterThan(1950);
  expect(poses[119].fov).toBeGreaterThan(59);
});

test("keyframes: adding one inside a shot splits it without changing the motion", () => {
  const kmp = twoKeyIntro();
  const before = simulateCamera(kmp, 0)[80];
  const added = splitShot(kmp, 0, 60);
  expect(introChain(kmp)).toEqual([0, added]);
  const { keys } = introKeyframes(kmp);
  expect(keys.map((k: any) => k.frame)).toEqual([0, 60, 120]);
  expect(keys[1].linked).toBe(true);
  const after = simulateCamera(kmp, added)[20];
  expect(after.position[0]).toBeCloseTo(before.position[0], -1);
  expect(after.target[0]).toBeCloseTo(before.target[0], -1);
});

test("keyframes: moving one retimes both neighbours, deleting one merges them", () => {
  const kmp = twoKeyIntro();
  splitShot(kmp, 0, 60);
  let { keys } = introKeyframes(kmp);
  expect(moveKey(kmp, keys[1], 90)).toBe(90);
  ({ keys } = introKeyframes(kmp));
  expect(keys.map((k: any) => k.frame)).toEqual([0, 90, 120]);
  const dropped = removeKey(kmp, keys[1]);
  expect(dropped).toHaveLength(1);
  ({ keys } = introKeyframes(kmp));
  expect(keys.map((k: any) => k.frame)).toEqual([0, 120]);
  expect(keys[1].pose.position[0]).toBeCloseTo(1200);
});

test("keyframes: setting only the next shot makes a cut", () => {
  const kmp = twoKeyIntro();
  splitShot(kmp, 0, 60);
  setKeyPose(kmp, introKeyframes(kmp).keys[1], pose(-5000, -5000), "after");
  expect(introKeyframes(kmp).keys[1].linked).toBe(false);
});

test("heading: plain yaw stays plain and wraps", () => {
  expect(turnYaw([0, 170, 0], 20)).toEqual([0, -170, 0]);
  expect(headingOf([0, 90, 0])).toBeCloseTo(90);
  const tilted = turnYaw([180, 0, 180], 30);
  expect(headingOf([180, 0, 180])).toBeCloseTo(180);
  expect(headingOf(tilted)).toBeCloseTo(-150); // 180 + 30, wrapped
});

test("copy and paste KMP elements", () => {
  const doc = new TrackDocument();
  const ops = new Ops(doc, { iconSize: 150, checkpointWidth: 3000 });
  ops.add("GOBJ", [0, 0, 0]);
  ops.add("CKPT", [0, 0, 0]);
  doc.select([String(doc.kmp.GOBJ[0].uid), `${doc.kmp.CKPT[0].points[0].uid}:L`]);
  const copied = ops.copySelection();
  expect(copied.map((e: any) => e.kind).sort()).toEqual(["CKPT", "GOBJ"]);
  expect(ops.pasteCopies(copied, [1000, 0, 500])).toBe(2);
  expect(doc.kmp.GOBJ).toHaveLength(2);
  expect(doc.kmp.GOBJ[1].pos).toEqual([1000, 0, 500]);
  expect(doc.kmp.CKPT[0].points).toHaveLength(2);
  expect(doc.kmp.CKPT[0].points[1].type).toBe(0xff);
  expect(doc.selection.size).toBe(2);
  doc.undo();
  expect(doc.kmp.GOBJ).toHaveLength(1);
});

test("keyframes: shots are written like the original intros and arrive on time", () => {
  const kmp = twoKeyIntro();
  splitShot(kmp, 0, 50);
  setKeyPose(kmp, introKeyframes(kmp).keys[1], pose(700, 900, 50));
  for (const i of introChain(kmp)) {
    const cam = kmp.CAME[i], route = kmp.POTI[cam.route];
    expect(cam.type).toBe(5);
    expect(route.loop).toBe(1);
    if (route.points.length < 3) expect(route.smooth).toBe(0);
    const speeds = route.points.map((p: any) => p.setting1);
    expect(speeds[speeds.length - 1]).toBe(speeds[speeds.length - 2]);
    // After `time` frames of whole-unit speeds the camera is within one frame of the keyframe.
    const end = route.points[route.points.length - 1].pos, poses = simulateCamera(kmp, i);
    const lastStep = Math.hypot(...[0, 1, 2].map((a) => poses[poses.length - 1].position[a] - end[a]));
    expect(lastStep).toBeLessThanOrEqual(speeds[0] * 1.6);
  }
  expect(introShotIssues(kmp)).toEqual([]);
});

test("keyframes: shots of older versions are found and fixed", () => {
  const kmp = twoKeyIntro();
  const cam = kmp.CAME[0], route = kmp.POTI[cam.route];
  cam.type = 6; route.loop = 0; route.smooth = 1;
  for (const p of route.points) p.setting1 += 40; // arrives early and goes on
  const issues = introShotIssues(kmp);
  expect(issues).toHaveLength(1);
  expect(issues[0].problems).toHaveLength(3);
  expect(fixIntroShots(kmp)).toBe(1);
  expect(introShotIssues(kmp)).toEqual([]);
  expect(cam.type).toBe(5);
  expect(shotSpeedLimits({ ...cam, viewStart: [0, 0, 0], viewEnd: [100000, 0, 0], time: 10 })).toEqual(["look-at point"]);
});

test("keyframes: a route of several sections arrives on time whether or not speeds blend", () => {
  const kmp = twoKeyIntro();
  const cam = kmp.CAME[0], route = kmp.POTI[cam.route];
  // A bent route with different speeds, as a split of an original route leaves it.
  route.points.splice(1, 0, { ...route.points[0], uid: 999, pos: [600, 1400, 900], setting1: 3 });
  route.points[0].setting1 = 40;
  setKeyPose(kmp, introKeyframes(kmp).keys[1], pose(1500, 2000, 60));
  const speeds = route.points.map((p: any) => p.setting1);
  expect(Math.max(...speeds) - Math.min(...speeds)).toBeLessThanOrEqual(1);
  // Constant speed per section (wkmpt): the route takes the shot's time.
  const sections = routeSectionLengths(route);
  const time = sections.reduce((s: number, d: number, i: number) => s + d / route.points[i].setting1, 0);
  expect(Math.abs(time - cam.time)).toBeLessThan(1.01);
  // Blended speeds (preview): one frame after the shot the camera is on the keyframe.
  cam.time += 1;
  const end = simulateCamera(kmp, 0).at(-1)!.position;
  cam.time -= 1;
  expect(Math.hypot(...[0, 1, 2].map((a) => end[a] - route.points.at(-1).pos[a]))).toBeLessThan(3);
});
