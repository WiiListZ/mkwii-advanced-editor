import { expect, test } from 'bun:test';
import { smoothRoadWidths } from '../web/js/editor/road-widths.js';
import { generateTrack, roadFrames, trackSamples, reverseLayout, PRESETS } from '../web/js/editor/trackgen.js';
import { uncoveredStartGrid } from '../web/js/editor/start-grid.js';

// Three successive bends like the reported layout: the inside used to gain
// small hooks where the neighbourhood's minimum radius switched sides.
const bends = [[0,-14000],[9000,-14000],[18000,-10000],[6000,2000],[22000,0],[18000,10000],[9000,14000],[0,14000],[-9000,14000],[-20000,9000],[-24000,-2000],[-19000,-11000]]
  .map(([x,z]) => ({ x,z,y:0,w:1 }));

test('successive tight bends have gradual asphalt and grass widths without inner notches', () => {
  for (const points of [bends, reverseLayout(bends)]) for (const step of [200,400,800]) {
    const {samples} = trackSamples(points,{step}), frames = roadFrames(samples,{step}), n = frames.length;
    const runs = frames.map((f:any,i:number) => Math.hypot(f.c[0]-frames[(i+1)%n].c[0], f.c[2]-frames[(i+1)%n].c[2]));
    for (const widths of [frames.map((f:any)=>f.hl),frames.map((f:any)=>f.hr),frames.map((f:any)=>f.hl+f.ol),frames.map((f:any)=>f.hr+f.or)]) {
      for (let i=0;i<n;i++) {
        const a=(i+n-1)%n,b=(i+1)%n, next=(widths[b]-widths[i])/runs[i],previous=(widths[i]-widths[a])/runs[a];
        expect(widths[i]).toBeGreaterThan(0);
        // A notch changed the edge width/slope abruptly within one sample.
        expect(Math.abs(next-previous)*2/(runs[a]+runs[i])).toBeLessThan(.0004);
      }
    }
    frames.forEach((f:any,i:number) => expect(f.c).toEqual(samples[i].slice(0,3)));
    const track=generateTrack(points,{step});
    for (const tri of track.model.tris.filter((t:any)=>['road','startline','boost','offroad','curb'].includes(t.mat))) {
      const v=tri.v;
      expect((v[5]-v[2])*(v[6]-v[0])-(v[3]-v[0])*(v[8]-v[2])).toBeGreaterThan(0);
    }
  }
});

test('rounded width limits stay safe and leave requested width variations alone where there is room', () => {
  const frames=Array.from({length:100},(_,i)=>({c:[Math.cos(i/100*Math.PI*2)*15000,0,Math.sin(i/100*Math.PI*2)*15000]}));
  const limits=frames.map((_,i)=>[i===25?500:3000,3000]);
  const smoothed=limits.map(p=>[...p]);smoothRoadWidths(frames,smoothed);
  smoothed.forEach((p,i)=>{expect(p[0]).toBeLessThanOrEqual(limits[i][0]+1e-8);expect(p[0]).toBeGreaterThanOrEqual(500-1e-8);expect(p[1]).toBeCloseTo(3000,8);});
  const requested=frames.map((_,i)=>[1000+Math.sin(i/100*Math.PI*2)*500,1200]);
  const original=requested.map(p=>[...p]);
  smoothRoadWidths(frames,requested,{limits:frames.map(()=>[5000,5000])});
  expect(requested).toEqual(original);
});

test('a road without grass keeps its full surface and a covered start grid', () => {
  const params={offroadWidth:0}, frames=roadFrames(trackSamples(PRESETS.Oval(),params).samples,params);
  expect(uncoveredStartGrid(frames)).toEqual([]);
  for(const f of frames) {expect(f.ol).toBe(0);expect(f.or).toBe(0);expect(f.L).toEqual(f.LO);expect(f.R).toEqual(f.RO);}
});
