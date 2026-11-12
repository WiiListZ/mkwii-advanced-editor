// Two ghosts side by side, from what their files say: lap times, and how their inputs differ. They are
// lined up by the race's start, since that is the one moment both files have in common.

import { COUNTDOWN_FRAMES, FRAMES_PER_SECOND, inputFrames, inputsAtFrame } from '../formats/rkg.js';

const STICK_DIFFERENCE = 3 / 7; // of the stick's whole travel to one side: less is the same steering
const MERGE_GAP = 15; // frames: differences this close count as one

const millis = (time) => (time.minutes * 60 + time.seconds) * 1000 + time.milliseconds;

// How a ghost drove, in numbers that can be set against another's.
function drivingOf(ghost) {
  const total = Math.max(1, inputFrames(ghost.inputs.face), inputFrames(ghost.inputs.direction));
  let accelerating = 0, braking = 0, items = 0, tricks = 0, hops = 0, steering = 0;
  let before = { accelerate: false, brake: false, item: false, trick: null };
  const raceFrames = Math.max(1, total - COUNTDOWN_FRAMES);
  for (let f = COUNTDOWN_FRAMES; f < total; f++) {
    const held = inputsAtFrame(ghost.inputs, f);
    if (held.accelerate) accelerating++;
    if (held.brake) braking++;
    if (held.item && !before.item) items++;
    if (held.trick && held.trick !== before.trick) tricks++;
    if (held.brake && !before.brake && held.accelerate) hops++;
    steering += Math.abs(held.stickX);
    before = held;
  }
  return {
    frames: total,
    acceleratingShare: accelerating / raceFrames,
    brakingShare: braking / raceFrames,
    steeringShare: steering / raceFrames,
    items, tricks, hops,
  };
}

// The stretches of the race in which they pressed different things, as frames from the start.
function differencesOf(a, b) {
  const end = Math.min(inputFrames(a.inputs.face), inputFrames(b.inputs.face));
  const spans = [];
  let first = null;
  for (let f = COUNTDOWN_FRAMES; f < end; f++) {
    const one = inputsAtFrame(a.inputs, f), two = inputsAtFrame(b.inputs, f);
    const differ = one.accelerate !== two.accelerate || one.brake !== two.brake || one.item !== two.item || one.trick !== two.trick
      || Math.abs(one.stickX - two.stickX) >= STICK_DIFFERENCE;
    if (!differ) continue;
    if (first === null) first = f;
    const last = spans[spans.length - 1];
    if (last && f - last.to <= MERGE_GAP) last.to = f;
    else spans.push({ from: f, to: f });
  }
  return { first, spans, compared: Math.max(0, end - COUNTDOWN_FRAMES) };
}

// Times are in milliseconds, and each difference is the second ghost's time less the first's: below
// zero, the second was faster.
export function compareGhosts(a, b) {
  const lapsOf = (ghost) => ghost.splits.slice(0, Math.min(5, Math.max(1, ghost.laps))).map(millis);
  const lapsA = lapsOf(a), lapsB = lapsOf(b), laps = [];
  let runningA = 0, runningB = 0;
  for (let i = 0; i < Math.max(lapsA.length, lapsB.length); i++) {
    const timeA = lapsA[i] ?? null, timeB = lapsB[i] ?? null;
    const both = timeA !== null && timeB !== null;
    runningA += timeA ?? 0;
    runningB += timeB ?? 0;
    laps.push({ lap: i + 1, a: timeA, b: timeB, difference: both ? timeB - timeA : null, running: both ? runningB - runningA : null });
  }
  const { first, spans, compared } = differencesOf(a, b);
  const differing = spans.reduce((sum, span) => sum + span.to - span.from + 1, 0);
  return {
    sameTrack: a.track === b.track,
    sameVehicle: a.vehicle === b.vehicle,
    sameCharacter: a.character === b.character,
    sameInputs: first === null && inputFrames(a.inputs.face) === inputFrames(b.inputs.face),
    total: { a: millis(a.time), b: millis(b.time), difference: millis(b.time) - millis(a.time) },
    laps,
    driving: { a: drivingOf(a), b: drivingOf(b) },
    firstDifference: first,
    firstDifferenceSeconds: first === null ? null : (first - COUNTDOWN_FRAMES) / FRAMES_PER_SECOND,
    spans,
    differingShare: compared ? differing / compared : 0,
  };
}

// A difference as text, as lap tables show it: +0.125 or -1.003.
export function differenceText(ms) {
  if (ms === null || ms === undefined) return '–';
  const size = Math.abs(ms), minutes = Math.floor(size / 60000), seconds = (size - minutes * 60000) / 1000;
  const text = minutes ? `${minutes}:${seconds.toFixed(3).padStart(6, '0')}` : seconds.toFixed(3);
  return `${ms < 0 ? '-' : ms > 0 ? '+' : ''}${text}`;
}
