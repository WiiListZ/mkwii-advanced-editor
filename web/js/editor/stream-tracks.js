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
