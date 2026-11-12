// Where to draw a ghost on its track. A ghost file holds the buttons pressed, not positions, and only
// the game's physics can turn one into the other. This is an approximation that stays faithful to
// what the file does say: the kart follows the enemy route, reaches each lap line at the ghost's real
// lap time, goes faster or slower along the lap as its accelerate and brake do, and moves across the
// road as its stick does. A trick press also says where it was, for it only counts on leaving a
// surface that allows tricks, so such a press pulls the kart to the nearest place to take off from.
// Jumps come from the track's own collision: it leaves the ground where the ground falls away and
// jump pads throw it up. It is not where the real ghost drives.
//
// Most ghosts have more: the path the game drives them on, worked out from the buttons with Kinoko, a
// reimplementation of the game's physics (src/ghost-path.ts), or read from the game in Dolphin
// (src/race-path.ts). With that, the kart is shown where it is in the game (attachRecordedPath).

import { COUNTDOWN_FRAMES, FRAMES_PER_SECOND, inputFrames, inputsAtFrame } from '../formats/rkg.js';
import { walled } from './geometry-check.js';

const CROSS_RATE = 8; // units per frame, with the stick fully over and the road straight
const CROSS_RETURN = .97; // towards the middle of the road, each frame
const TURN_RADIUS = 1500; // units: the bend a kart takes with the stick fully over
const CURVE_SPAN = 600; // units before and after a point over which the route's bend is measured
const ROAD_SAMPLE = 200; // units along the route between looks at how wide the road is
const ROAD_STEP = 100; // units across
const ROAD_REACH = 3000; // units across at most
const ROAD_CLIFF = 250; // a change of height across the road larger than this is its edge
const ROAD_MARGIN = 150; // units kept from the edge: the kart has a width
const ROAD_NEARBY = 800; // units: off-road under the route's line with road this near means the line cut a corner
const GROUND_RISE = 800; // a road this far over the kart, with nothing under it, is the one it should be on
const SIDE_EASE = 10; // frames either side over which its place across the road is averaged

const GRAVITY = 1.3; // units per frame, each frame
// How far the ground must fall below the kart's path for it to leave the road. A kart holds on to the
// road over crests and small bumps: only a real lip or drop throws it.
const LEAVE_GROUND = 35;
const MAX_CLIMB = 50; // units per frame it can come up to the road, when the road is suddenly higher
const MAX_FALL = 70; // units per frame it can fall
const TRICK_RISE = 18; // Y velocity of a jump known only from a trick press
const GROUND_ABOVE = 150; // a surface higher than this over the kart is not what it stands on
const GROUND_BELOW = 2500; // and one this far under the route is not the road
const LOST_BELOW = 2500; // nor is the kart ever this far under the route
const LOST_ABOVE = 6000; // or this far over it
const TYPE_BOOST_RAMP = 0x07, TYPE_JUMP_PAD = 0x08, TYPE_HALF_PIPE = 0x13, TYPE_STICKY = 0x16;
const FLAG_TRICKABLE = 0x2000;
const JUMP_PAD_RISE = [35, 47, 30, 45, 53, 50, 35, 50]; // Y velocity of each jump pad variant
const TRICK_GRACE = 6; // frames after a surface that allows tricks in which leaving the ground still counts
const TRICK_EARLY = 12; // a press this many frames before leaving the ground still does a trick
const TRICK_FRAMES = 40; // one rotation, when the jump is long enough
const MIN_TRICK_FLIGHT = 12, MIN_TAKEOFF_FLIGHT = 8; // frames in the air
const ANCHOR_REACH = 15000; // how far a trick press can move the kart along the route
const ANCHOR_REACH_WHEELIE = 2000; // up on a bike is mostly a wheelie, so it has to be right there
const ANCHOR_PACE = [.6, 1.5]; // and the speeds that leaves it, to the lap's average
const WHEELIE_FRAMES = 180, WHEELIE_EASE = 12, WHEELIE_TILT = .4;
const HOP_FRAMES = 10, HOP_HEIGHT = 14;
const FIRST_BIKE = 18;
const CAMERA_EASE = 12; // frames either side the camera averages the kart's height over
const MUSHROOMS = 3; // a Time Trial starts with three
const MUSHROOM_FRAMES = 90; // how long one lasts
const MUSHROOM_PACE = .35; // how much faster than accelerating it goes
const MUSHROOM_EASE = [6, 24]; // frames it takes to come on and to wear off

// The route around one lap: from group to group by each group's first exit, starting at the point
// nearest the start, as a closed line with the length up to each point.
function lapRoute(kmp) {
  const points = [], seen = new Set();
  for (let g = 0; kmp.ENPT[g] && !seen.has(g); g = kmp.ENPT[g].next?.[0]) {
    seen.add(g);
    points.push(...kmp.ENPT[g].points);
  }
  if (points.length < 3) throw new Error('This track has no enemy route to follow');
  const start = kmp.KTPT[0]?.pos || points[0].pos;
  let first = 0, best = Infinity;
  points.forEach((point, i) => {
    const d = Math.hypot(point.pos[0] - start[0], point.pos[2] - start[2]);
    if (d < best) { best = d; first = i; }
  });
  const line = [...points.slice(first), ...points.slice(0, first)].map((point) => ({ pos: point.pos, half: Math.max(200, (point.width || 10) * 100) }));
  const along = [0];
  for (let i = 1; i <= line.length; i++) {
    const a = line[i - 1].pos, b = line[i % line.length].pos;
    along.push(along[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  }
  return { line, along, length: along[line.length] };
}

function pointOnRoute(route, distance) {
  const { line, along, length } = route;
  const d = ((distance % length) + length) % length;
  let low = 0, high = line.length;
  while (high - low > 1) { const middle = (low + high) >> 1; if (along[middle] <= d) low = middle; else high = middle; }
  const a = line[low], b = line[(low + 1) % line.length], t = (d - along[low]) / (along[low + 1] - along[low] || 1);
  const dx = b.pos[0] - a.pos[0], dz = b.pos[2] - a.pos[2], size = Math.hypot(dx, dz) || 1;
  return {
    position: [0, 1, 2].map((k) => a.pos[k] + (b.pos[k] - a.pos[k]) * t),
    direction: [dx / size, dz / size],
    half: a.half + (b.half - a.half) * t,
  };
}

// The frames each lap ends on, from the ghost's lap times; even laps if the file has none.
function lapEnds(ghost, total) {
  const seconds = (t) => t.minutes * 60 + t.seconds + t.milliseconds / 1000;
  const laps = Math.max(1, ghost.laps), times = ghost.splits.slice(0, Math.min(5, laps)).map(seconds);
  const raceFrames = Math.max(1, total - COUNTDOWN_FRAMES);
  if (times.length !== laps || times.some((t) => t <= 0)) return Array.from({ length: laps }, (_, i) => COUNTDOWN_FRAMES + raceFrames * (i + 1) / laps);
  let at = 0;
  return times.map((time) => { at += time; return COUNTDOWN_FRAMES + at * FRAMES_PER_SECOND; });
}

// Fills in the distance driven by each frame, from fixed { frame, distance } in order: between two
// of them it is spent as the frames' pace says.
function spendDistance(distance, pace, knots) {
  distance.fill(0);
  for (let k = 0; k + 1 < knots.length; k++) {
    const from = knots[k], to = knots[k + 1];
    let sum = 0, run = 0;
    for (let f = from.frame; f < to.frame; f++) sum += pace[f];
    for (let f = from.frame; f < to.frame; f++) { run += pace[f]; distance[f] = from.distance + (to.distance - from.distance) * run / (sum || 1); }
  }
  const last = knots[knots.length - 1];
  for (let f = last.frame; f < distance.length; f++) distance[f] = last.distance;
}

// The surface the kart stands on at (x, z): the highest one that is not above it.
function groundAt(heights, x, z, y, routeY) {
  if (!heights) return { y: routeY, flag: 0 };
  let best = null, over = null;
  for (const surface of heights.surfacesAt(x, z, true)) {
    if (surface.y > y + GROUND_ABOVE) {
      if (surface.y <= y + GROUND_RISE && (!over || surface.y < over.y)) over = surface;
      continue;
    }
    if (surface.y < routeY - GROUND_BELOW) continue;
    if (!best || surface.y > best.y) best = surface;
  }
  // A kart that came down lower than the road it is at climbs back to it, rather than run beneath it.
  best ||= over;
  // Over a gap the road carries on where the route does.
  return best ? { y: best.y, flag: heights.kcl.flags[best.tri] } : { y: routeY, flag: 0 };
}

const allowsTricks = (flag) => {
  const type = flag & 0x1F;
  return type === TYPE_BOOST_RAMP || type === TYPE_JUMP_PAD || type === TYPE_HALF_PIPE || !!(flag & FLAG_TRICKABLE);
};

// One frame of the kart's height, on the road or in the air.
function flightStep(state, ground, routeY) {
  const type = ground.flag & 0x1F;
  if (state.air) {
    state.vy = Math.max(-MAX_FALL, state.vy - GRAVITY);
    state.y += state.vy;
    if (state.y <= ground.y) { state.y = Math.min(ground.y, state.y + Math.max(-state.vy, MAX_CLIMB)); state.vy = 0; state.air = false; }
  } else if (type === TYPE_JUMP_PAD) {
    state.vy = JUMP_PAD_RISE[(ground.flag >> 5) & 7];
    state.y = ground.y + state.vy;
    state.air = true;
  } else if (type !== TYPE_STICKY && ground.y < state.y + state.vy - GRAVITY - LEAVE_GROUND) {
    state.vy -= GRAVITY;
    state.y += state.vy;
    state.air = true;
  } else {
    // Its climb is averaged over a few frames: the collision's facets are not a smooth slope.
    const climb = Math.max(-MAX_CLIMB, Math.min(ground.y - state.y, MAX_CLIMB));
    state.vy += (climb - state.vy) * .5;
    state.y += climb;
  }
  if (!state.air || type === TYPE_JUMP_PAD) {
    if (allowsTricks(ground.flag)) {
      state.grace = TRICK_GRACE;
      // Boost ramps of the first variant give a double flip.
      state.turns = type === TYPE_BOOST_RAMP && !((ground.flag >> 5) & 7) ? 2 : 1;
    } else if (state.grace > 0) state.grace--;
  }
  if (state.y < routeY - LOST_BELOW || state.y > routeY + LOST_ABOVE) {
    const to = Math.max(routeY - LOST_BELOW, Math.min(routeY + LOST_ABOVE, state.y));
    state.y += Math.max(-MAX_CLIMB, Math.min(MAX_CLIMB, to - state.y));
    state.vy = 0;
    state.air = false;
  }
}

const newFlight = (y) => ({ y, vy: 0, air: false, grace: 0, turns: 1 });

// The places to take off from around a lap that allow tricks, driving down the middle of the road
// and along each side of it, as { distance, lane }: lane is across the road, -1 to 1. Also, as
// edges, where such a surface ends without the kart being thrown off it.
function findTakeoffs(route, heights, speed, limits) {
  const found = [], edges = [];
  for (const lane of [0, -.5, .5, -1, 1]) {
    let state = null, takeoff = null, wasOn = false, lastOn = 0;
    for (let d = 0; d < route.length; d += speed) {
      const here = pointOnRoute(route, d), across = lane * here.half * .75;
      // Only where the kart can be: not beyond a wall, or on the wrong level.
      const look = Math.floor(d / ROAD_SAMPLE) % limits.low.length;
      if (across < limits.low[look] - ROAD_MARGIN || across > limits.high[look] + ROAD_MARGIN) { takeoff = null; state = null; wasOn = false; continue; }
      const x = here.position[0] - here.direction[1] * across, z = here.position[2] + here.direction[0] * across, routeY = here.position[1];
      state ||= newFlight(groundAt(heights, x, z, routeY + GROUND_ABOVE, routeY).y);
      const flying = state.air, ground = groundAt(heights, x, z, state.y, routeY);
      flightStep(state, ground, routeY);
      const on = !flying && allowsTricks(ground.flag);
      if (wasOn && !on) edges.push({ distance: lastOn, lane });
      if (on) lastOn = d;
      wasOn = on;
      if (!flying && state.air) takeoff = state.grace > 0 ? { distance: d, lane, frames: 0 } : null;
      else if (state.air && takeoff) takeoff.frames++;
      else if (!state.air) {
        if (takeoff && takeoff.frames >= MIN_TAKEOFF_FLIGHT) found.push(takeoff);
        takeoff = null;
      }
    }
  }
  return { found, edges };
}

const tricksOf = (ghost, total) => {
  const presses = [];
  let held = null;
  for (let f = COUNTDOWN_FRAMES; f < total; f++) {
    const trick = inputsAtFrame(ghost.inputs, f).trick;
    if (trick && trick !== held) presses.push({ frame: f, direction: trick });
    held = trick;
  }
  return presses;
};

// Moves the kart along the lap so that each trick press falls on a place to take off from, when one
// is near enough for the speeds around it to stay likely. Returns the lanes that takes it to.
function anchorToTakeoffs(drive, pace, knots, presses, takeoffs, meanSpeed, heights, isBike) {
  const { distance, route } = drive, anchors = [];
  const nearestOf = (list, frame, lap, reach) => {
    let best = null, nearest = reach;
    for (const takeoff of list) {
      const target = lap * route.length + takeoff.distance, off = Math.abs(target - distance[frame]);
      if (off >= nearest) continue;
      const after = knots.findIndex((knot) => knot.frame > frame);
      const previous = knots[after - 1], next = knots[after];
      if (!previous || !next || previous.frame === frame) continue;
      const before = (target - previous.distance) / (frame - previous.frame), then = (next.distance - target) / (next.frame - frame);
      const likely = (speed) => speed >= meanSpeed * ANCHOR_PACE[0] && speed <= meanSpeed * ANCHOR_PACE[1];
      if (!likely(before) || !likely(then)) continue;
      best = { knot: { frame, distance: target }, lane: takeoff.lane, index: after };
      nearest = off;
    }
    return best;
  };
  for (const { frame, direction } of presses) {
    const lap = Math.floor(distance[frame] / route.length);
    const reach = isBike && direction === 'up' ? ANCHOR_REACH_WHEELIE : ANCHOR_REACH;
    let best = nearestOf(takeoffs.found, frame, lap, reach);
    if (!best) {
      const { x, z, routeY } = placeOnRoad(drive, frame);
      if (allowsTricks(groundAt(heights, x, z, routeY + GROUND_ABOVE, routeY).flag)) continue;
      best = nearestOf(takeoffs.edges, frame, lap, reach);
    }
    if (!best) continue;
    knots.splice(best.index, 0, best.knot);
    spendDistance(distance, pace, knots);
    anchors.push({ frame, lane: best.lane });
  }
  return anchors;
}

const ease = (t) => t * t * (3 - 2 * t);

const OFF_ROAD = { 2: 1, 3: 2, 4: 3, 0x0A: 9, 0x10: 9 }; // how much worse than road a surface is
const surfaceRank = (flag) => OFF_ROAD[flag & 0x1F] || 0;

// How far across the road the kart can be, from the collision: for each look along the route, the
// stretch around its line that is one surface, up to a wall, a drop or worse ground. A route's line
// can lie off the road where it cuts a corner: then the stretch does not contain it, and the kart is
// moved back onto the road. Where there is no ground at all there is nothing to go by.
function roadLimits(route, heights) {
  const count = Math.ceil(route.length / ROAD_SAMPLE), low = new Float32Array(count), high = new Float32Array(count);
  const groundNear = (x, z, y) => {
    let best = null;
    for (const surface of heights.surfacesAt(x, z, true)) {
      if (Math.abs(surface.y - y) > ROAD_CLIFF) continue;
      if (!best || Math.abs(surface.y - y) < Math.abs(best.y - y)) best = surface;
    }
    return best && { y: best.y, rank: surfaceRank(heights.kcl.flags[best.tri]) };
  };
  for (let i = 0; i < count; i++) {
    const here = pointOnRoute(route, i * ROAD_SAMPLE), [px, routeY, pz] = here.position, [dx, dz] = here.direction;
    const at = (across) => [px - dz * across, pz + dx * across];
    // Where to start: the ground under the line, or the nearest ground to it.
    let seed = null, seedAt = 0;
    const reach = Math.min(ROAD_REACH, here.half * 1.2);
    for (let step = 0; !seed && step * ROAD_STEP <= reach; step++) {
      for (const across of step ? [step * ROAD_STEP, -step * ROAD_STEP] : [0]) {
        const [x, z] = at(across);
        // The nearest to the route: a ramp can rise above its line, and a bridge can pass over it.
        const found = heights.surfacesAt(x, z, true).filter((surface) => surface.y <= routeY + GROUND_RISE && surface.y >= routeY - GROUND_BELOW);
        if (!found.length) continue;
        const nearest = found.reduce((one, two) => Math.abs(two.y - routeY) < Math.abs(one.y - routeY) ? two : one);
        const rank = surfaceRank(heights.kcl.flags[nearest.tri]);
        if (rank > 3) continue;
        seed = { y: nearest.y, rank };
        seedAt = across;
        break;
      }
    }
    // Off-road under the line with road right beside it: the line cut a corner, and the road is the place.
    if (seed?.rank > 0) {
      for (let step = 1; step * ROAD_STEP <= ROAD_NEARBY && seed.rank > 0; step++) {
        for (const across of [seedAt + step * ROAD_STEP, seedAt - step * ROAD_STEP]) {
          const [x, z] = at(across), ground = groundNear(x, z, seed.y);
          if (ground?.rank === 0) { seed = ground; seedAt = across; break; }
        }
      }
    }
    if (!seed) { const open = Math.min(ROAD_REACH, here.half * .25); low[i] = -open; high[i] = open; continue; }
    const extend = (sign) => {
      let last = seedAt, y = seed.y;
      for (let across = seedAt + sign * ROAD_STEP; Math.abs(across) <= ROAD_REACH; across += sign * ROAD_STEP) {
        const [x, z] = at(across), ground = groundNear(x, z, y);
        if (!ground || ground.rank > seed.rank) break;
        const [lx, lz] = at(last);
        if (heights.cells && walled(heights.kcl, heights, [lx, y, lz], [x, ground.y, z])) break;
        last = across;
        y = ground.y;
      }
      return last;
    };
    const from = extend(-1), to = extend(1);
    // Kept off the edges, unless the road is too narrow for that.
    const middle = (from + to) / 2, room = Math.max(0, (to - from) / 2 - ROAD_MARGIN);
    low[i] = middle - room;
    high[i] = middle + room;
  }
  return { low, high };
}

// Which way the route bends here, as how far the stick would be over to follow it: -1 left to 1 right.
function stickFollowingRoute(route, distance) {
  const before = pointOnRoute(route, distance - CURVE_SPAN), after = pointOnRoute(route, distance + CURVE_SPAN);
  const here = pointOnRoute(route, distance);
  const to = (a, b) => { const x = b.position[0] - a.position[0], z = b.position[2] - a.position[2], size = Math.hypot(x, z) || 1; return [x / size, z / size]; };
  const one = to(before, here), two = to(here, after);
  // Towards the side that counts as right: see placeOnRoad.
  const turn = Math.atan2(two[0] * -one[1] + two[1] * one[0], two[0] * one[0] + two[1] * one[1]);
  return Math.max(-1, Math.min(1, turn / CURVE_SPAN * TURN_RADIUS));
}

// The stick moves the kart across the road only for what is more than the road's own bend needs:
// holding it over through a long bend is what keeps the kart in its place on the road.
function steerAcross(drive, ghost) {
  const { total, cross, distance, route } = drive;
  let sideways = 0;
  for (let f = 0; f < total; f++) {
    const beyond = inputsAtFrame(ghost.inputs, f).stickX - stickFollowingRoute(route, distance[f]);
    if (f >= COUNTDOWN_FRAMES) sideways = sideways * CROSS_RETURN + beyond * CROSS_RATE;
    cross[f] = sideways;
  }
}

// Its final place across the road on each frame, within the road, without sudden moves.
function keepOnRoad(drive, limits) {
  const { total, cross, distance, route } = drive, side = new Float32Array(total), count = limits.low.length;
  const held = new Float32Array(total);
  for (let f = 0; f < total; f++) {
    const at = (((distance[f] % route.length) + route.length) % route.length) / ROAD_SAMPLE;
    const one = Math.floor(at) % count, two = (one + 1) % count, t = at - Math.floor(at);
    const low = limits.low[one] + (limits.low[two] - limits.low[one]) * t, high = limits.high[one] + (limits.high[two] - limits.high[one]) * t;
    held[f] = Math.max(low, Math.min(high, cross[f]));
  }
  for (let f = 0; f < total; f++) {
    let sum = 0, n = 0;
    for (let k = Math.max(0, f - SIDE_EASE); k <= Math.min(total - 1, f + SIDE_EASE); k++) { sum += held[k]; n++; }
    side[f] = sum / n;
  }
  return side;
}

// In a Time Trial the item button uses one of the three mushrooms. For each frame: how strong the
// boost is, 0 to 1, and how many mushrooms are left.
function mushroomBoosts(inputs, total) {
  const boost = new Float32Array(total), left = new Uint8Array(total);
  let remaining = MUSHROOMS, until = -1, began = -1, held = false;
  for (let f = 0; f < total; f++) {
    const item = inputsAtFrame(inputs, f).item;
    if (f >= COUNTDOWN_FRAMES && item && !held && remaining > 0) {
      remaining--;
      if (f >= until) began = f;
      until = f + MUSHROOM_FRAMES;
    }
    held = item;
    left[f] = remaining;
    if (f < until) boost[f] = Math.min(1, (f - began + 1) / MUSHROOM_EASE[0], (until - f) / MUSHROOM_EASE[1]);
  }
  return { boost, left };
}

// The stick's own line across the road gives way to the one that reaches the place it took off from.
function steerToLanes(drive, anchors) {
  const { cross, route, distance, total } = drive;
  for (const { frame, lane } of anchors) {
    const target = lane * pointOnRoute(route, distance[frame]).half * .75;
    for (let f = Math.max(0, frame - 60); f < Math.min(total, frame + 30); f++) {
      const weight = f <= frame ? ease((f - (frame - 60)) / 60) : ease(1 - (f - frame) / 30);
      cross[f] += (target - cross[f]) * weight;
    }
  }
}

// Where on the road a frame's distance and stick put the kart.
function placeOnRoad(drive, f) {
  const here = pointOnRoute(drive.route, drive.distance[f]);
  // Looking a little ahead keeps the heading from jumping at each corner of the route.
  const ahead = pointOnRoute(drive.route, drive.distance[f] + 500);
  const dx = ahead.position[0] - here.position[0], dz = ahead.position[2] - here.position[2], size = Math.hypot(dx, dz) || 1;
  const forward = size > 1 ? [dx / size, dz / size] : here.direction;
  const limit = here.half * .75, sideways = drive.side ? drive.side[f] : Math.max(-limit, Math.min(limit, drive.cross[f]));
  // Right of the way the kart goes, for a stick pushed right.
  return { x: here.position[0] - forward[1] * sideways, z: here.position[2] + forward[0] * sideways, routeY: here.position[1], forward };
}

// The kart's height on every frame, so that any frame can be shown at once and the same way.
function flyGhost(drive, heights, ghost, presses) {
  const { total, distance } = drive;
  // A trick press where tricks are allowed says the kart was in the air, even if this road would
  // not have thrown it: not up on a bike, which is a wheelie.
  const isBike = ghost.vehicle >= FIRST_BIKE;
  const thrown = new Set(presses.filter((press) => !(isBike && press.direction === 'up')).map((press) => press.frame));
  const y = new Float32Array(total), rise = new Float32Array(total), air = new Uint8Array(total), trickable = new Uint8Array(total), turns = new Uint8Array(total);
  let state = null, takeoffAllows = false, takeoffTurns = 1;
  for (let f = 0; f < total; f++) {
    const { x, z, routeY } = placeOnRoad(drive, f);
    state ||= newFlight(groundAt(heights, x, z, routeY + GROUND_ABOVE, routeY).y);
    const flying = state.air, ground = groundAt(heights, x, z, state.y, routeY);
    flightStep(state, ground, routeY);
    if (thrown.has(f) && !state.air && state.grace > 0) {
      state.vy = Math.max(state.vy, TRICK_RISE);
      state.air = true;
    }
    if (!flying && state.air) { takeoffAllows = state.grace > 0; takeoffTurns = state.turns; }
    y[f] = state.y;
    rise[f] = state.vy;
    air[f] = state.air ? 1 : 0;
    trickable[f] = state.air && takeoffAllows ? 1 : 0;
    turns[f] = takeoffTurns;
  }
  // Nose up on the way up and down on the way down, as far as the speed makes it so.
  const tilt = new Float32Array(total);
  let smooth = 0;
  for (let f = 0; f < total; f++) {
    const speed = Math.max(30, f ? distance[f] - distance[f - 1] : 0);
    smooth += (Math.atan2(rise[f], speed) - smooth) * .25;
    tilt[f] = smooth;
  }
  const focus = new Float32Array(total);
  for (let f = 0; f < total; f++) {
    let sum = 0, count = 0;
    for (let k = Math.max(0, f - CAMERA_EASE); k <= Math.min(total - 1, f + CAMERA_EASE); k++) { sum += y[k]; count++; }
    focus[f] = sum / count;
  }
  // The small hop of pressing the drift button while accelerating.
  const hop = new Float32Array(total);
  let braking = false;
  for (let f = 0; f < total; f++) {
    const held = inputsAtFrame(ghost.inputs, f);
    if (held.brake && !braking && held.accelerate && !air[f]) {
      for (let k = 0; k < HOP_FRAMES && f + k < total && !air[f + k]; k++) { const t = k / HOP_FRAMES; hop[f + k] = 4 * HOP_HEIGHT * t * (1 - t); }
    }
    braking = held.brake;
  }
  return { y, focus, tilt, hop, air, trickable, turns };
}

// A trick turns the kart over while it is in the air: down and up flip it, left and right spin it,
// over on a bike and around on a kart. On the ground the game does nothing with a press, but up
// lifts a bike's front wheel.
function performTricks(drive, presses, isBike) {
  const { total, flight } = drive;
  const angle = new Float32Array(total), axis = new Uint8Array(total), wheelie = new Float32Array(total);
  const axes = { up: ['pitch', -1], down: ['pitch', 1], left: [isBike ? 'roll' : 'yaw', 1], right: [isBike ? 'roll' : 'yaw', -1] };
  const axisCode = { pitch: 1, yaw: 2, roll: 3 };
  let busy = -1;
  for (const { frame, direction } of presses) {
    if (frame < busy) continue;
    let start = frame;
    while (start < Math.min(total, frame + TRICK_EARLY) && !flight.air[start]) start++;
    if (start < total && flight.air[start] && flight.trickable[start]) {
      let land = start;
      while (land < total && flight.air[land]) land++;
      if (land - start < MIN_TRICK_FLIGHT) continue;
      const [name, sign] = axes[direction], turns = flight.turns[start];
      const length = Math.min(land - start, TRICK_FRAMES * turns);
      for (let k = 0; k < length; k++) { angle[start + k] = sign * ease((k + 1) / length) * turns * Math.PI * 2; axis[start + k] = axisCode[name]; }
      busy = land;
    } else if (isBike && direction === 'up' && !flight.air[frame]) {
      let end = frame;
      for (; end < Math.min(total, frame + WHEELIE_FRAMES); end++) {
        const held = inputsAtFrame(drive.ghostInputs, end);
        if (flight.air[end] || held.brake || (end > frame && held.trick === 'down')) break;
      }
      for (let f = frame; f < end; f++) wheelie[f] = Math.min(1, (f - frame) / WHEELIE_EASE, (end - f) / WHEELIE_EASE);
      busy = end;
    }
  }
  return { angle, axis, wheelie };
}

// heights is the track's ground (see heightmap.js): without it, the kart keeps to the route's height.
export function buildGhostDrive(ghost, kmp, heights = null) {
  const route = lapRoute(kmp);
  const total = Math.max(1, inputFrames(ghost.inputs.face), inputFrames(ghost.inputs.direction));
  const pace = new Float32Array(total), cross = new Float32Array(total), stick = new Float32Array(total), trick = new Uint8Array(total);
  const { boost, left } = mushroomBoosts(ghost.inputs, total);
  let smooth = .5, sideways = 0;
  for (let f = 0; f < total; f++) {
    const held = inputsAtFrame(ghost.inputs, f);
    // Eased, as a kart's speed is: a press does not change it from one frame to the next.
    const want = held.accelerate ? (held.brake ? .85 : 1) : held.brake ? .25 : .55;
    smooth += (want - smooth) * .02;
    pace[f] = smooth * (1 + boost[f] * MUSHROOM_PACE);
    stick[f] = held.stickX;
    trick[f] = held.trick ? 1 : 0;
    if (f >= COUNTDOWN_FRAMES) sideways = sideways * CROSS_RETURN + held.stickX * CROSS_RATE;
    cross[f] = sideways;
  }
  // Each lap is one length of the route.
  const distance = new Float64Array(total);
  const ends = lapEnds(ghost, total);
  const knots = [{ frame: Math.min(total, COUNTDOWN_FRAMES), distance: 0 }];
  ends.forEach((end, lap) => {
    const frame = Math.min(total, Math.round(end));
    if (frame > knots[knots.length - 1].frame) knots.push({ frame, distance: (lap + 1) * route.length });
  });
  spendDistance(distance, pace, knots);
  const drive = { route, total, distance, cross, stick, trick, boost, mushrooms: left, side: null, ghostInputs: ghost.inputs };
  const presses = tricksOf(ghost, total);
  const limits = heights ? roadLimits(route, heights) : null;
  steerAcross(drive, ghost);
  if (heights && presses.length) {
    const raceFrames = Math.max(1, knots[knots.length - 1].frame - COUNTDOWN_FRAMES);
    const meanSpeed = knots[knots.length - 1].distance / raceFrames;
    const takeoffs = findTakeoffs(route, heights, meanSpeed, limits);
    const anchors = anchorToTakeoffs(drive, pace, knots, presses, takeoffs, meanSpeed, heights, ghost.vehicle >= FIRST_BIKE);
    // Moved along the lap: the bends come at other frames now.
    steerAcross(drive, ghost);
    steerToLanes(drive, anchors);
  }
  if (limits) drive.side = keepOnRoad(drive, limits);
  drive.flight = flyGhost(drive, heights, ghost, presses);
  drive.tricks = performTricks(drive, presses, ghost.vehicle >= FIRST_BIKE);
  return drive;
}

// Whether the open track is the one this ghost was driven on. The file's name says it for the game's
// own tracks. Otherwise only signs are left: the number of laps, and the speed the ghost's time would
// mean along this track's route. On the game's tracks that speed is between about 58 and 132 units a
// frame, so one far outside that is another track; but many other tracks fall within it as well.
const LIKELY_SPEED = [46, 158];
export function ghostTrackCheck(ghost, { fileName = '', laps = null, routeLength = 0, trackNames = {}, courseNames = [] } = {}) {
  const expected = courseNames[ghost.track] ?? `track ${ghost.track}`;
  const stem = String(fileName).split(/[\\/]/).pop().replace(/\.szs$/i, '').replace(/_d$/i, '');
  const named = trackNames[stem] || null;
  const problems = [];
  if (named && named !== expected) problems.push({ level: 'wrong', text: `This ghost was driven on ${expected}, but this is ${named}.` });
  if (laps && ghost.laps && laps !== ghost.laps) problems.push({ level: 'unlikely', text: `This ghost raced ${ghost.laps} laps, but this track has ${laps}.` });
  const seconds = ghost.time.minutes * 60 + ghost.time.seconds + ghost.time.milliseconds / 1000;
  if (routeLength > 0 && seconds > 0) {
    const speed = routeLength * (ghost.laps || laps || 3) / (seconds * FRAMES_PER_SECOND);
    if (speed < LIKELY_SPEED[0]) problems.push({ level: 'unlikely', text: `Its time is far too long for a track this short.` });
    if (speed > LIKELY_SPEED[1]) problems.push({ level: 'unlikely', text: `Its time is far too short for a track this long.` });
  }
  const sure = named === expected;
  return { expected, named, sure, ok: !problems.length, problems };
}

// A path from the game or from Kinoko: rows of the ghost's frame, x, y, z and the rotation as a
// quaternion x, y, z, w, as little-endian floats. Frames between two rows are eased from one to the
// other. info: where it comes from, { source: 'game' | 'kinoko', synced, from, row } (from: the first
// lap that is not the game's, when not synced; row: floats per frame, 8, or 12 when each frame also
// says what the kart does: its drift 0-3, its boost 0-3, in the air, in a wheelie). Returns the drive,
// now showing that path.
const PATH_ROW = 8;
const HEADING_SPAN = 6; // frames either side over which the way the kart goes is measured
const VIEW_EASE = 18; // frames either side the camera's direction is averaged over
// The game's place for a kart is the middle of its body, about this far over the road (measured on
// Luigi Circuit), where a kart drawn here stands on it.
const BODY_HEIGHT = 55;
export function attachRecordedPath(drive, bytes, info = { source: 'game', synced: true, from: 0 }) {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = info.row >= 12 ? info.row : PATH_ROW;
  const count = Math.floor(bytes.byteLength / 4 / width);
  const rows = [];
  for (let i = 0; i < count; i++) {
    const row = Array.from({ length: width }, (_, k) => data.getFloat32((i * width + k) * 4, true));
    if (row.every(Number.isFinite) && (!rows.length || row[0] > rows[rows.length - 1][0])) rows.push(row);
  }
  if (rows.length < 2) return drive;
  const total = drive.total, position = new Float32Array(total * 3), rotation = new Float32Array(total * 4);
  // What the kart does, as the last row at or before each frame says.
  const state = width >= 12 ? { drift: new Uint8Array(total), boost: new Uint8Array(total), air: new Uint8Array(total), wheelie: new Uint8Array(total) } : null;
  let r = 0;
  for (let f = 0; f < total; f++) {
    while (r < rows.length - 2 && rows[r + 1][0] <= f) r++;
    const a = rows[r], b = rows[r + 1];
    const t = Math.max(0, Math.min(1, (f - a[0]) / (b[0] - a[0])));
    for (let k = 0; k < 3; k++) position[f * 3 + k] = a[1 + k] + (b[1 + k] - a[1 + k]) * t;
    position[f * 3 + 1] -= BODY_HEIGHT;
    // The shorter way round from one rotation to the next.
    const dot = a[4] * b[4] + a[5] * b[5] + a[6] * b[6] + a[7] * b[7], sign = dot < 0 ? -1 : 1;
    const q = [0, 1, 2, 3].map((k) => a[4 + k] * (1 - t) + b[4 + k] * sign * t), size = Math.hypot(...q) || 1;
    for (let k = 0; k < 4; k++) rotation[f * 4 + k] = q[k] / size;
    if (state) {
      const now = f >= b[0] ? b : a;
      state.drift[f] = now[8]; state.boost[f] = now[9]; state.air[f] = now[10]; state.wheelie[f] = now[11];
    }
  }
  // The camera follows the height eased, as it does the approximate path.
  const focus = new Float32Array(total);
  for (let f = 0; f < total; f++) {
    let sum = 0, n = 0;
    for (let g = Math.max(0, f - CAMERA_EASE); g <= Math.min(total - 1, f + CAMERA_EASE); g++, n++) sum += position[g * 3 + 1];
    focus[f] = sum / n;
  }
  // Where the camera looks along: the way the kart goes, not the way its body points. In a drift the
  // body turns well across the road, and a camera behind the body would swing out to the side; the
  // game's own camera follows the motion, eased.
  const heading = new Float32Array(total * 2);
  const body = (f) => { const [x, y, z, w] = rotation.subarray(f * 4, f * 4 + 4); return [2 * (x * z + w * y), 1 - 2 * (x * x + y * y)]; };
  for (let f = 0; f < total; f++) {
    const a = Math.max(0, f - HEADING_SPAN), b = Math.min(total - 1, f + HEADING_SPAN);
    let dx = position[b * 3] - position[a * 3], dz = position[b * 3 + 2] - position[a * 3 + 2];
    // Standing still or barely moving (the countdown, a stop): the way the body points.
    if (Math.hypot(dx, dz) < (b - a) * 2) [dx, dz] = body(f);
    const size = Math.hypot(dx, dz) || 1;
    heading[f * 2] = dx / size; heading[f * 2 + 1] = dz / size;
  }
  const view = new Float32Array(total * 2);
  for (let f = 0; f < total; f++) {
    let sx = 0, sz = 0;
    for (let g = Math.max(0, f - VIEW_EASE); g <= Math.min(total - 1, f + VIEW_EASE); g++) { sx += heading[g * 2]; sz += heading[g * 2 + 1]; }
    const size = Math.hypot(sx, sz) || 1;
    view[f * 2] = sx / size; view[f * 2 + 1] = sz / size;
  }
  drive.recorded = { position, rotation, focus, state, view, first: rows[0][0], last: rows[rows.length - 1][0], source: info.source, synced: info.synced !== false, lap: info.from || 0 };
  return drive;
}

// The pose of a frame of a recorded path: the rotation as angles about X, Y and Z to apply as Y, X, Z.
function recordedPose(drive, f) {
  const { position, rotation, focus, state, view } = drive.recorded;
  const [x, y, z, w] = rotation.subarray(f * 4, f * 4 + 4);
  const m13 = 2 * (x * z + w * y), m33 = 1 - 2 * (x * x + y * y), m23 = 2 * (y * z - w * x);
  const m21 = 2 * (x * y + w * z), m22 = 1 - 2 * (x * x + z * z), m31 = 2 * (x * z - w * y), m11 = 1 - 2 * (y * y + z * z);
  const pitch = Math.asin(-Math.max(-1, Math.min(1, m23)));
  const level = Math.abs(m23) < .9999999;
  const yaw = level ? Math.atan2(m13, m33) : Math.atan2(-m31, m11), roll = level ? Math.atan2(m21, m22) : 0;
  const flat = Math.hypot(m13, m33) || 1;
  return {
    position: [position[f * 3], position[f * 3 + 1], position[f * 3 + 2]],
    forward: [m13 / flat, m33 / flat], yaw, lean: 0,
    // The camera's way: the kart's motion, eased (see attachRecordedPath).
    view: [view[f * 2], view[f * 2 + 1]],
    focusY: focus[f],
    airborne: !!state?.air[f],
    trick: !!drive.trick[f],
    tricking: false,
    wheelie: !!state?.wheelie[f],
    // The game's own boost when the path says it (a mini-turbo's too), else the mushrooms pressed.
    boost: state ? (state.boost[f] ? 1 : 0) : drive.boost[f],
    boostKind: state?.boost[f] ?? 0,
    // 0 not drifting, 1 drifting, 2 mini-turbo charged (blue sparks), 3 super mini-turbo (orange).
    drift: state?.drift[f] ?? 0,
    mushrooms: drive.mushrooms[f],
    rotation: [pitch, yaw, roll],
    recorded: true,
  };
}

// The kart on one frame: where it is, which way it faces, whether it is in the air, and its rotation
// about the X, Y and Z axes, in that order of names, to apply as Y, X, Z.
export function ghostPoseAt(drive, frame) {
  const f = Math.max(0, Math.min(drive.total - 1, Math.floor(frame)));
  if (drive.recorded) return recordedPose(drive, f);
  const { x, z, forward } = placeOnRoad(drive, f);
  const { flight, tricks } = drive;
  const yaw = Math.atan2(forward[0], forward[1]) - drive.stick[f] * .3, lean = drive.stick[f];
  const axis = tricks.axis[f], angle = tricks.angle[f];
  return {
    position: [x, flight.y[f] + flight.hop[f], z], forward, yaw, lean,
    focusY: flight.focus[f],
    airborne: !!flight.air[f],
    trick: !!drive.trick[f],
    tricking: axis !== 0,
    wheelie: tricks.wheelie[f] > 0,
    boost: drive.boost[f],
    mushrooms: drive.mushrooms[f],
    rotation: [
      -flight.tilt[f] - tricks.wheelie[f] * WHEELIE_TILT + (axis === 1 ? angle : 0),
      yaw + (axis === 2 ? angle : 0),
      -lean * .12 + (axis === 3 ? angle : 0),
    ],
  };
}

// Where each view looks from, for a kart at this pose. It follows the kart's height eased, so that a
// jump is seen as one.
export function ghostCamera(pose, view) {
  // Along the way the kart goes when the path says it, which is not where its body points in a drift.
  const [x, , z] = pose.position, y = pose.focusY ?? pose.position[1], [fx, fz] = pose.view || pose.forward;
  if (view === 'above') return { position: [x, y + 6000, z - 200], target: [x, y, z], fov: 50 };
  if (view === 'side') return { position: [x - fz * 1400, y + 350, z + fx * 1400], target: [x, y + 100, z], fov: 45 };
  // Behind, a boost pulls the view back and widens it.
  const boost = pose.boost || 0, back = 900 + boost * 120;
  return { position: [x - fx * back, y + 380, z - fz * back], target: [x + fx * 300, y + 130, z + fz * 300], fov: 62 + boost * 10 };
}
