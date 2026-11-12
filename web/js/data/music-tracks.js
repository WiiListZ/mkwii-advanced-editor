// The tracks of a course's music, and when the game plays each. A music stream (.brstm) can hold
// several stereo tracks played together; the game turns them up and down as a kart drives over Sound
// Trigger collision (KCL type 0x18), and what each of its variants does is fixed for each course
// position (slot) by the game's code: only these slots change music that way. From the Sound Trigger
// tables of mkwiiki.org (KCL flag), where "channel" and "stream" are the music's tracks.

export const SOUND_TRIGGER = 0x18;

// The most the game is known to play for one music: Koopa Cape's 4 tracks of 2 channels.
export const MAX_TRACKS = 4, MAX_CHANNELS = 8;

// By the music's file name without its _N (normal) or _F (final lap) ending. tracks: the tracks each
// variant plays, 1 first, as the tables say them; null when it changes no music, or when the tables
// do not say which track (then the text still says what changes).
const TRIGGERS = {
  STRM_N_FACTORY: { course: "Toad's Factory", variants: [
    [0, [1], 'no sound effects (factory entrance)'], [1, [1], 'hydraulic press area'], [2, [1], 'shipping dock area'],
    [3, [2], 'quiet siren and echo (curved conveyor area)'], [4, [2], 'loud siren and echo (steam room)'],
    [5, [1], 'music starts again, with the audience cheering'], [6, [1], 'no sound effects (bulldozer area)'], [7, [1], 'audience cheering (default)'],
  ] },
  STRM_N_TRUCK: { course: "Wario's Gold Mine", variants: [
    [0, [1], 'no echo (default)'], [1, [2], 'weak echo'], [2, [2], 'moderate echo'], [3, [2], 'strong echo'],
  ] },
  STRM_N_WATER: { course: 'Koopa Cape', variants: [
    [0, [1, 4], 'no sound effects'], [1, [1, 4], 'weak echo'], [2, null, 'strong echo, whatever plays'],
    [3, [3], 'underwater music'], [4, null, 'water ambience, whatever plays'],
    [5, [1, 4], 'normal music, strongest echo'], [6, [2, 4], 'riverside music'],
  ] },
  STRM_N_DESERT: { course: 'Dry Dry Ruins', variants: [
    [0, null, 'music change: normal'], [1, null, 'music change: indoors, where the bats come from the sides'],
    [2, null, 'music change: indoors, where the half-pipes are'], [3, null, 'music change: indoors, where the Pokeys are'],
  ] },
  STRM_N_RIDGEHIGHWAY: { course: 'Moonview Highway', variants: [
    [0, [1], 'default music, no city ambience'], [1, [2], 'adds the flute, weak city ambience'],
  ] },
  STRM_N_KOOPA: { course: "Bowser's Castle", variants: [
    [4, [2], 'adds drums and echo'], [6, null, 'music change: adds drums without echo'], [7, [1], 'back to the normal music'],
  ] },
};

const base = (fileName) => String(fileName).split(/[\\/]/).pop().replace(/\.brstm$/i, '').replace(/_[NF]$/i, '').toUpperCase();

// The course whose music this is and the variants that change it, or null when the game never
// changes this music's tracks (they then all play, all the time).
export function musicTriggers(fileName) {
  const entry = TRIGGERS[base(fileName)];
  return entry ? { course: entry.course, variants: entry.variants.map(([variant, tracks, text]) => ({ variant, tracks, text })) } : null;
}

// When a track (0 first) plays: the variants that turn it on. Music changes whose track the tables do
// not say are in unsaid.
export function trackPlays(fileName, index) {
  const entry = musicTriggers(fileName);
  if (!entry) return { always: true, variants: [], unsaid: [] };
  return { always: false, variants: entry.variants.filter((v) => v.tracks?.includes(index + 1)), unsaid: entry.variants.filter((v) => !v.tracks && v.text.startsWith('music change')) };
}
