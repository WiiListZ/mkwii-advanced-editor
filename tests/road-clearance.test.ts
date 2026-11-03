import { expect, test } from 'bun:test';
import { generateTrack, roadFrames, trackSamples, reverseLayout, DEFAULT_PARAMS } from '../web/js/editor/trackgen.js';
import { limitRoadClearance } from '../web/js/editor/road-clearance.js';

// A non-crossing, twelve-point loop whose inner offsets used to intersect
// themselves three times, even though every individual quad faced upwards.
const loop = [[6506,0],[20257,11696],[3975,6884],[0,12228],[-9147,15843],[-14772,8529],[-18115,0],[-12479,-7205],[-6291,-10896],[0,-13045],[7655,-13258],[5658,-3267]]
  .map(([x,z]) => ({x,z,y:0,w:1}));
const cross = (a:number[], b:number[], c:number[]) => (b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]);

test('inner walls cannot fold across a nearby part of the same bend', () => {
  for (const points of [loop, reverseLayout(loop)]) for (const step of [200,400,800]) {
    const params = {step}, {samples} = trackSamples(points, params), frames = roadFrames(samples, params);
    const edges = frames.flatMap((f:any,i:number) => ['LO','RO'].map(side => ({i,a:f[side],b:frames[(i+1)%frames.length][side]})));
    for (let i=0;i<edges.length;i++) for (let j=i+1;j<edges.length;j++) {
      const a=edges[i], b=edges[j], gap=Math.min(Math.abs(a.i-b.i),frames.length-Math.abs(a.i-b.i));
      if(gap<=2) continue;
      expect(cross(a.a,a.b,b.a)*cross(a.a,a.b,b.b)<-.001 && cross(b.a,b.b,a.a)*cross(b.a,b.b,a.b)<-.001).toBe(false);
    }
    // The correction acts on widths, not on the person's centreline/heights.
    frames.forEach((f:any,i:number) => expect(f.c).toEqual(samples[i].slice(0,3)));
    const out=generateTrack(points,params);
    for (const tri of out.model.tris.filter((t:any)=>['road','startline','boost','offroad','curb'].includes(t.mat))) {
      const v=tri.v;
      expect((v[5]-v[2])*(v[6]-v[0])-(v[3]-v[0])*(v[8]-v[2])).toBeGreaterThan(0);
    }
    const walls=out.model.tris.filter((t:any)=>t.mat==='wall');
    expect(walls[0].v.slice(0,3)).toEqual(frames[0].LO);
  }
});

test('road clearance leaves separated bridge levels and ordinary road widths alone', () => {
  const frames=[{c:[0,0,0],left:[0,1]},{c:[0,0,2000],left:[0,1]}];
  const close=[[3000,3000],[3000,3000]];
  limitRoadClearance(frames,close,DEFAULT_PARAMS);
  expect(close[0][0]+close[1][1]).toBeLessThan(2000);
  expect(close[0][1]).toBe(3000);expect(close[1][0]).toBe(3000);
  const bridge=[[3000,3000],[3000,3000]];
  limitRoadClearance([frames[0],{...frames[1],c:[0,3000,2000]}],bridge,DEFAULT_PARAMS);
  expect(bridge).toEqual([[3000,3000],[3000,3000]]);
  const straight=[[1600,1600],[1600,1600]];
  limitRoadClearance([{c:[0,0,0],left:[0,1]},{c:[400,0,0],left:[0,1]}],straight,DEFAULT_PARAMS);
  expect(straight).toEqual([[1600,1600],[1600,1600]]);
});
