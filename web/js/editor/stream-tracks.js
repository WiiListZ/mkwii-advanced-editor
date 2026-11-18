// The tracks of a decoded music stream: { sampleRate, channels: Int16Array[], loop, loopStart,
// tracks: [{ volume, pan, channels: [channel indices] }], trackType }. Each change returns a new
// stream: a track added, replaced, taken out, or its volume and pan. All channels of a stream are
// as long as each other, so new audio is cut or padded with silence to the stream's length.

const tracksOf = (clip) => clip.tracks?.length ? clip.tracks : [{ volume: 127, pan: 64, channels: clip.channels.map((_, i) => i) }];

// Two channels of the stream's length from new audio (one channel is used for both sides).
function fit(pcm, length) {
  const pair = pcm.length === 1 ? [pcm[0], pcm[0]] : pcm.slice(0, 2);
  return pair.map((channel) => {
    const out = new Int16Array(length);
    out.set(channel.subarray(0, length));
    return out;
  });
}

// trackType 1 keeps each track's volume and pan in the file.
const result = (clip, channels, tracks) => ({ ...clip, channels, tracks, trackType: 1 });

export function withTrack(clip, pcm, { volume = 127, pan = 64 } = {}) {
  const length = clip.channels[0].length, start = clip.channels.length;
  const added = fit(pcm, length);
  return result(clip, [...clip.channels, ...added], [...tracksOf(clip), { volume, pan, channels: [start, start + 1] }]);
}

export function replaceTrack(clip, index, pcm) {
  const tracks = tracksOf(clip), length = clip.channels[0].length, fresh = fit(pcm, length);
  const channels = clip.channels.slice();
  tracks[index].channels.forEach((channel, side) => { channels[channel] = fresh[Math.min(side, 1)]; });
  return result(clip, channels, tracks.map((t) => ({ ...t, channels: t.channels.slice() })));
}

export function withoutTrack(clip, index) {
  const tracks = tracksOf(clip);
  if (tracks.length < 2) throw new Error('A stream keeps at least one track');
  const gone = new Set(tracks[index].channels);
  const kept = clip.channels.map((_, i) => i).filter((i) => !gone.has(i));
  const renumber = new Map(kept.map((old, i) => [old, i]));
  return result(clip, kept.map((i) => clip.channels[i]), tracks.filter((_, i) => i !== index).map((t) => ({ ...t, channels: t.channels.map((c) => renumber.get(c)) })));
}

// volume and pan as the file keeps them: 0 to 127 (pan 64 is the middle).
export function withTrackMix(clip, index, { volume, pan }) {
  const clamp = (n) => Math.max(0, Math.min(127, Math.round(n)));
  return result(clip, clip.channels, tracksOf(clip).map((t, i) => i === index ? { ...t, ...(volume !== undefined && { volume: clamp(volume) }), ...(pan !== undefined && { pan: clamp(pan) }) } : t));
}

// A track's own loop: its audio from `from` to `to` (samples) repeats from `from` up to the end of
// the stream; what is before `from` stays. The game loops the whole stream at one point (its loop
// start), every track together, so a track's loop is written into its audio.
export function loopTrack(clip, index, from, to) {
  const length = clip.channels[0].length;
  from = Math.max(0, Math.round(from)); to = Math.min(length, Math.round(to));
  if (to - from < 1) throw new Error("The track's loop must end after it starts");
  const tracks = tracksOf(clip), channels = clip.channels.slice(), period = to - from;
  for (const c of new Set(tracks[index].channels)) {
    const source = clip.channels[c], out = new Int16Array(length);
    out.set(source.subarray(0, to));
    for (let i = to; i < length; i++) out[i] = source[from + ((i - from) % period)];
    channels[c] = out;
  }
  return result(clip, channels, tracks.map((t) => ({ ...t, channels: t.channels.slice() })));
}

// Where the stream's loop should start for a track looping from `from` every `period` samples to
// go on without a jump when the stream starts again (its loop then lasts whole repeats of the
// track's), as near as possible to `near`; null when the track's loop is longer than what follows it.
export function seamlessLoopStart(length, from, period, near) {
  const most = Math.floor((length - from) / period);
  if (most < 1 || period < 1) return null;
  const k = Math.max(1, Math.min(most, Math.round((length - near) / period)));
  return length - k * period;
}

// A track without a loop of its own: its audio up to `to` (samples), then silence to the end of the
// stream, so it does not repeat (the stream's own loop still starts it again from its loop start).
export function endTrack(clip, index, to) {
  const length = clip.channels[0].length;
  to = Math.max(0, Math.min(length, Math.round(to)));
  const tracks = tracksOf(clip), channels = clip.channels.slice();
  for (const c of new Set(tracks[index].channels)) {
    const out = new Int16Array(length);
    out.set(clip.channels[c].subarray(0, to));
    channels[c] = out;
  }
  return result(clip, channels, tracks.map((t) => ({ ...t, channels: t.channels.slice() })));
}

// The loop start near `near` (samples) where the stream goes on without a jump when it loops: where
// what comes before it sounds most like what comes before the stream's end, as the stream (every
// channel together) is heard at the jump. Searched within `range` samples, first on a coarse copy
// of the sound, then sample by sample around the best place.
export function seamlessStreamLoop(channels, near, rate, range = Math.round(rate * 0.5)) {
  const length = channels[0].length;
  const mono = new Float32Array(length);
  for (const c of channels) for (let i = 0; i < length; i++) mono[i] += c[i];
  const step = 8, coarse = new Float32Array(Math.floor(length / step));
  for (let i = 0; i < coarse.length; i++) { let sum = 0; for (let k = 0; k < step; k++) sum += mono[i * step + k]; coarse[i] = sum / step; }
  const difference = (data, end, at, window) => {
    let sum = 0;
    for (let k = 1; k <= window; k++) { const d = data[end - k] - data[at - k]; sum += d * d; }
    return sum;
  };
  const window = Math.round(rate * 0.1), small = Math.round(window / step);
  const lowest = Math.max(window + 1, near - range), highest = Math.min(length - window - 1, near + range);
  if (highest <= lowest) return Math.max(0, Math.min(length - 1, near));
  // Of places that match about as well, the nearest to the one chosen: a small cost for the distance.
  const energy = (data, end, window) => { let sum = 0; for (let k = 1; k <= window; k++) sum += data[end - k] * data[end - k]; return sum; };
  const weight = energy(coarse, coarse.length, small) * 0.01 / range;
  const cost = (at) => weight * Math.abs(at * step - near);
  let best = near, bestScore = Infinity;
  for (let at = Math.ceil(lowest / step); at * step <= highest; at++) {
    const score = difference(coarse, coarse.length, at, small) + cost(at);
    if (score < bestScore) { bestScore = score; best = at * step; }
  }
  let fine = best; bestScore = Infinity;
  for (let at = Math.max(lowest, best - step * 2); at <= Math.min(highest, best + step * 2); at++) {
    const score = difference(mono, length, at, window);
    if (score < bestScore) { bestScore = score; fine = at; }
  }
  return fine;
}
