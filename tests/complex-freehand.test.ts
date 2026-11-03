import { expect, test } from 'bun:test';
import { pointsFromStroke, sampleSpline, trackSamples, generateTrack, generatedTrackIssues, MAX_TRACK_SAMPLES } from '../web/js/editor/trackgen.js';
import { buildKCL } from '../web/js/formats/kcl.js';
import { buildKMP, parseKMP } from '../web/js/formats/kmp.js';

test('a long complex freehand stroke stays renderable without overflowing JavaScript arguments', () => {
  const stroke=Array.from({length:721},(_,i)=>{const t=i/720*Math.PI*2;return {x:245*Math.cos(t*3)*500000/640,z:160*Math.sin(t*7)*500000/640};});
  const points=pointsFromStroke(stroke,{tolerance:2*500000/640})!;
  expect(points).not.toBeNull();expect(points.length).toBeGreaterThan(100);
  const saved=JSON.stringify(points), requested=sampleSpline(points,400);
  expect(requested.samples.length).toBeGreaterThan(10000);
  const sampled=trackSamples(points),track=generateTrack(points);
  expect(sampled.samples.length).toBe(MAX_TRACK_SAMPLES);
  expect(sampled.sampleStep).toBeGreaterThan(400);
  expect(JSON.stringify(points)).toBe(saved);
  expect(track.flags.length).toBeLessThan(65534);
  expect(track.verts.every(Number.isFinite)).toBe(true);
  expect(track.model.tris.length).toBeGreaterThan(10000);
  const fall=track.verts.slice(-18), lowRoad=track.verts.reduce((m,v,i)=>i%3===1&&i<track.verts.length-18?Math.min(m,v):m,Infinity);
  for(const i of [1,4,7,10,13,16])expect(lowRoad-fall[i]).toBeGreaterThanOrEqual(3999);
  expect(buildKCL(track.verts,track.flags).length).toBeGreaterThan(0);
  const reparsed=parseKMP(buildKMP(track.kmp));
  expect(track.kmp.ENPT[0].points.length).toBeLessThanOrEqual(255);
  expect(reparsed.ENPT[0].points.length).toBe(track.kmp.ENPT[0].points.length);
  expect(reparsed.ITPT[0].points.length).toBe(track.kmp.ITPT[0].points.length);
  const checkpoints=track.kmp.CKPT[0].points.length;
  expect(generatedTrackIssues(track).length).toBe(checkpoints>255?1:0);
});

test('unsupported checkpoint counts produce an actionable issue instead of an invalid export', () => {
  expect(generatedTrackIssues({kmp:{CKPT:[{points:Array(255)}]}})).toEqual([]);
  expect(generatedTrackIssues({kmp:{CKPT:[{points:Array(256)}]}})[0].message).toContain('Simplify');
});
